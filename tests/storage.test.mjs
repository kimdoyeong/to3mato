import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../electron/storage.mjs';
import {
  createInitialState,
  applyCommand,
  legacyRecordId,
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

test('v2 migration preserves state and sync metadata and persists tray display', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  store.resetSync();
  const sync = store.syncState(),
    pending = store.pendingChanges();
  store.db.exec(
    'ALTER TABLE settings DROP COLUMN tray_display; PRAGMA user_version = 2;',
  );
  store.close();
  const migrated = f.store();
  assert.deepEqual(migrated.load(), state);
  assert.deepEqual(migrated.syncState(), sync);
  assert.deepEqual(migrated.pendingChanges(), pending);
  assert.ok(fs.existsSync(path.join(f.directory, 'to3mato.pre-v3.sqlite3')));
  state = applyCommand(state, {
    type: 'settings:save',
    payload: { trayDisplay: 'ring' },
  });
  migrated.save(state);
  assert.equal(migrated.pendingChanges().at(-1).data.trayDisplay, 'ring');
  migrated.close();
  assert.deepEqual(f.store().load(), state);
});
