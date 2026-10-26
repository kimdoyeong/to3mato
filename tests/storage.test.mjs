import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  SQLiteStore,
  SCHEMA_V3,
  SCHEMA_VERSION,
  formatHLC,
} from '../electron/storage.mjs';
import {
  createInitialState,
  applyCommand,
  legacyRecordId,
  normalizeState,
} from '../src/lib/domain.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-sqlite-'));
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store: () => {
      const store = new SQLiteStore(directory);
      stores.push(store);
      return store;
    },
  };
}
test('new SQLite store persists normalized state and only updates changed rows', (t) => {
  const f = fixture(t),
    store = f.store();
  const state = store.load();
  assert.equal(
    fs.readFileSync(store.file).subarray(0, 16).toString(),
    'SQLite format 3\0',
  );
  const before = store.db.prepare('SELECT total_changes() AS n').get().n;
  state.tasks[0].title = 'SQLite 저장';
  store.save(state);
  assert.equal(
    store.db.prepare('SELECT total_changes() AS n').get().n - before,
    1,
  );
  store.close();
  assert.deepEqual(f.store().load(), state);
  assert.equal(fs.existsSync(path.join(f.directory, 'state.json')), false);
});
test('legacy JSON migrates once with IDs, history, order, settings and timer intact', (t) => {
  const f = fixture(t),
    store = f.store();
  const state = createInitialState('2026-10-19');
  state.records = [
    {
      taskId: 'deleted-task',
      seconds: 30.5,
      pomodoros: 0,
      duration: 1500,
      at: 42,
    },
  ];
  state.timer = {
    phase: 'focus',
    taskId: 't1',
    duration: 1500,
    elapsed: 15.25,
    startedAt: 100,
    running: false,
  };
  const bytes = JSON.stringify(state, null, 2);
  fs.writeFileSync(store.legacyFile, bytes);
  // Records saved before IDs existed receive a deterministic ID on load.
  const expected = structuredClone(state);
  expected.records[0].id = legacyRecordId(state.records[0]);
  assert.deepEqual(store.load(), expected);
  assert.equal(fs.readFileSync(store.migrationBackup, 'utf8'), bytes);
  expected.tasks[0].title = '이전 후 수정';
  store.save(expected);
  store.close();
  assert.deepEqual(f.store().load(), expected);
  assert.equal(fs.readFileSync(store.legacyFile, 'utf8'), bytes);
  assert.equal(fs.readFileSync(store.migrationBackup, 'utf8'), bytes);
});
test('invalid legacy JSON is not replaced by seed data and migration can be retried', (t) => {
  const f = fixture(t),
    store = f.store();
  fs.writeFileSync(store.legacyFile, 'invalid');
  assert.throws(() => store.load());
  assert.equal(fs.readFileSync(store.legacyFile, 'utf8'), 'invalid');
  const db = new DatabaseSync(store.file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  db.close();
  const state = createInitialState();
  fs.writeFileSync(store.legacyFile, JSON.stringify(state));
  assert.deepEqual(store.load(), state);
});
test('failed migration rolls back its schema and can retry without duplicating tasks', (t) => {
  const f = fixture(t),
    store = f.store();
  fs.writeFileSync(store.legacyFile, JSON.stringify(createInitialState()));
  const original = store.writeChanges;
  store.writeChanges = function (next, previous) {
    original.call(this, next, previous);
    throw new Error('interrupted migration');
  };
  assert.throws(() => store.load(), /interrupted migration/);
  store.writeChanges = original;
  assert.deepEqual(store.load(), createInitialState());
});
test('SQL failure mid-batch rolls back all rows and the next attempt succeeds', (t) => {
  const f = fixture(t),
    store = f.store(),
    before = store.load();
  store.db.exec(
    "CREATE TRIGGER fail_task BEFORE INSERT ON tasks WHEN NEW.title = 'fail' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
  );
  const next = applyCommand(before, {
    type: 'task:batch',
    payload: {
      project: 'p1',
      tasks: [
        { title: 'first', estimate: 1, date: '' },
        { title: 'fail', estimate: 1, date: '' },
      ],
    },
  });
  assert.throws(() => store.save(next), /injected failure/);
  assert.deepEqual(store.load(), before);
  store.db.exec('DROP TRIGGER fail_task');
  store.save(next);
  assert.deepEqual(store.load(), next);
});
test('task deletion keeps history and settles the related timer atomically', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  store.save(state);
  state = applyCommand(
    state,
    { type: 'task:delete', payload: { id: 't1' } },
    501000,
  );
  store.save(state);
  assert.equal(store.load().records[0].taskId, 't1');
  assert.equal(store.load().timer, null);
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
test('JSON replacement backs up committed WAL content and retains the JSON export shape', (t) => {
  const f = fixture(t),
    store = f.store(),
    old = store.load();
  old.tasks[0].title = '가져오기 직전';
  store.save(old);
  const replacement = createInitialState();
  replacement.tasks = [];
  replacement.projects = [];
  store.replace(replacement);
  const backup = new DatabaseSync(store.importBackup, { readOnly: true });
  assert.equal(
    backup.prepare("SELECT title FROM tasks WHERE id = 't1'").get().title,
    '가져오기 직전',
  );
  backup.close();
  assert.deepEqual(store.load(), replacement);
  assert.throws(() => store.replace({ version: 999 }));
  assert.deepEqual(store.load(), replacement);
});
test('corrupt and unsupported databases are not overwritten or replaced from old JSON', (t) => {
  const f = fixture(t),
    store = f.store();
  fs.writeFileSync(store.file, 'invalid SQLite');
  fs.writeFileSync(store.legacyFile, JSON.stringify(createInitialState()));
  assert.throws(() => store.load());
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'invalid SQLite');
  fs.unlinkSync(store.file);
  const db = new DatabaseSync(store.file);
  db.exec('PRAGMA user_version=999');
  db.close();
  const bytes = fs.readFileSync(store.file);
  assert.throws(() => store.load(), /DB 버전/);
  assert.deepEqual(fs.readFileSync(store.file), bytes);
});
test('committed data survives process exit without a graceful close', (t) => {
  const f = fixture(t);
  const script = `import {SQLiteStore} from ${JSON.stringify(new URL('../electron/storage.mjs', import.meta.url).href)}; const s=new SQLiteStore(process.argv[1]);const state=s.load();state.tasks[0].title='crash recovery';s.save(state);process.exit(0);`;
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    f.directory,
  ]);
  assert.equal(child.status, 0, child.stderr.toString());
  assert.equal(f.store().load().tasks[0].title, 'crash recovery');
});

const DEVICE = '00000000-0000-4000-8000-000000000001';
const hlc = (wall, counter = 0) => formatHLC(wall, counter, DEVICE);
/** A real v3 database with history, a pending change log and a focus timer. */
function createV3Database(file, { version = 3 } = {}) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_V3);
  db.exec(`
    INSERT INTO projects VALUES ('p1', 0, '사이드 프로젝트', 'folder', '#d08c6f', '${hlc(1)}', 0);
    INSERT INTO projects VALUES ('gone', 1, '지운 프로젝트', 'leaf', '#b49b65', '${hlc(2)}', 1);
    INSERT INTO tasks VALUES ('big', 0, '예상 4짜리 기존 작업', 4, 'p1', '2026-10-20', 0, '${hlc(3)}', 0);
    INSERT INTO tasks VALUES ('small', 1, '예상 1짜리 작업', 1, NULL, '', 0, '${hlc(4)}', 0);
    INSERT INTO focus_records VALUES ('r1', 'big', 1500, 1, 1500, 100, '${hlc(5)}', 0);
    INSERT INTO settings VALUES (1, 900, 300, '${hlc(6)}', 'ring');
    INSERT INTO timer VALUES (1, 'big', 'focus', 900, 30, 50, 0);
    INSERT INTO sync_state VALUES (1, '${DEVICE}', 1, 7, 123);
    INSERT INTO changes (seq, entity, id, data, hlc) VALUES (3, 'task', 'small', '{"id":"small"}', '${hlc(4)}');
    INSERT INTO changes (seq, entity, id, data, hlc) VALUES (9, 'project', 'gone', NULL, '${hlc(2)}');
  `);
  if (version === 2) db.exec('ALTER TABLE settings DROP COLUMN tray_display;');
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}
function assertMigratedV3(f, store, state) {
  assert.equal(
    store.db.prepare('PRAGMA user_version').get().user_version,
    SCHEMA_VERSION,
  );
  assert.equal(SCHEMA_VERSION, 5);
  // Existing estimates above the new cap are kept; remaining starts equal.
  assert.deepEqual(
    state.tasks.map((task) => [
      task.id,
      task.estimate,
      task.remaining,
      task.followUpOf,
    ]),
    [
      ['big', 4, 4, ''],
      ['small', 1, 1, ''],
    ],
  );
  assert.deepEqual(state.projects, [
    {
      id: 'p1',
      name: '사이드 프로젝트',
      icon: 'folder',
      color: '#d08c6f',
      outcome: '',
      image: '',
    },
  ]);
  assert.deepEqual(state.tickets, []);
  assert.deepEqual(state.templates, []);
  assert.equal(state.settings.focus, 900);
  assert.equal(state.settings.dailyCapacity, 8);
  assert.deepEqual(state.settings.remindDays, [1, 2, 3, 4, 5]);
  assert.equal(state.timer.taskId, 'big');
  assert.equal(state.timer.phase, 'focus');
  // Sync metadata and the pending log survive the table rebuild in order.
  assert.deepEqual(store.syncState(), {
    deviceId: DEVICE,
    logging: true,
    cursor: 7,
    lastSyncAt: 123,
  });
  assert.deepEqual(
    store.pendingChanges().map((c) => [c.seq, c.entity, c.id, c.data]),
    [
      [3, 'task', 'small', { id: 'small' }],
      [9, 'project', 'gone', null],
    ],
  );
  assert.ok(fs.existsSync(path.join(f.directory, 'to3mato.pre-v4.sqlite3')));
  const backup = new DatabaseSync(
    path.join(f.directory, 'to3mato.pre-v4.sqlite3'),
    { readOnly: true },
  );
  assert.ok(backup.prepare('PRAGMA user_version').get().user_version < 4);
  backup.close();
}

test('v3 database migrates to v4 with estimates, log order, sync state and a backup', (t) => {
  const f = fixture(t);
  createV3Database(path.join(f.directory, 'to3mato.sqlite3'));
  const store = f.store();
  let state = store.load();
  assertMigratedV3(f, store, state);
  // New log rows continue after the copied sequence numbers.
  state = applyCommand(state, {
    type: 'settings:save',
    payload: { dailyCapacity: 6, planAt: '09:00' },
  });
  store.save(state);
  const last = store.pendingChanges().at(-1);
  assert.ok(last.seq > 9);
  assert.equal(last.entity, 'settings');
  assert.equal(last.data.dailyCapacity, 6);
  assert.equal(last.data.planAt, '09:00');
  // The rebuilt tables accept the new phase and entities.
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: 'small' } },
    1000,
  );
  state = applyCommand(state, { type: 'checkin:done' }, 1_501_000 + 1000);
  store.save(state);
  assert.equal(state.tickets.length, 1);
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM changes WHERE entity = 'ticket'")
      .get().n,
    1,
  );
  store.close();
  assert.deepEqual(f.store().load(), state);
});

test('v2 database migrates through v3 to v4 and keeps both backups', (t) => {
  const f = fixture(t);
  createV3Database(path.join(f.directory, 'to3mato.sqlite3'), { version: 2 });
  const store = f.store();
  const state = store.load();
  assertMigratedV3(f, store, state);
  assert.equal(state.settings.trayDisplay, 'clock');
  assert.ok(fs.existsSync(path.join(f.directory, 'to3mato.pre-v3.sqlite3')));
  store.close();
  assert.deepEqual(f.store().load(), state);
});

test('a check-in timer persists across restarts and does not advance on its own', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  state = applyCommand(
    state,
    { type: 'settings:save', payload: { rest: 600 } },
    1_501_000 + 1000,
  );
  assert.equal(state.timer.phase, 'checkin');
  store.save(state);
  store.close();
  const reopened = f.store();
  const loaded = reopened.load();
  assert.deepEqual(loaded, state);
  assert.equal(loaded.timer.running, false);
  assert.equal(
    reopened.db.prepare('SELECT phase, task_id FROM timer WHERE id = 1').get()
      .phase,
    'checkin',
  );
});

test('tickets and templates round-trip and old exports normalize to the full shape', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(state, {
    type: 'template:save',
    payload: {
      name: '학습 1회차',
      steps: [
        { title: '%n%강 읽기', estimate: 1 },
        { title: '%n%강 문제 풀기', estimate: 2 },
      ],
    },
  });
  state = applyCommand(
    state,
    { type: 'task:toggle', payload: { id: 't3' } },
    5000,
  );
  state = applyCommand(state, {
    type: 'ticket:update',
    payload: {
      id: state.tickets[0].id,
      highlight: true,
      sticker: 'star',
      note: '메모',
    },
  });
  state = applyCommand(state, {
    type: 'project:save',
    payload: {
      id: 'p1',
      name: '사이드 프로젝트',
      outcome: '제안서 초안 PDF',
      image: 'cover.png',
    },
  });
  store.save(state);
  store.close();
  assert.deepEqual(f.store().load(), state);
  const stripped = structuredClone(createInitialState());
  delete stripped.tickets;
  delete stripped.templates;
  for (const task of stripped.tasks) {
    delete task.remaining;
    delete task.followUpOf;
  }
  for (const project of stripped.projects) {
    delete project.outcome;
    delete project.image;
  }
  stripped.settings = { focus: 1500, rest: 300 };
  assert.deepEqual(
    normalizeState(stripped),
    createInitialState(stripped.tasks[0].date),
  );
});
