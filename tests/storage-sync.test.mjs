import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SQLiteStore,
  SCHEMA_V1,
  SCHEMA_VERSION,
  formatHLC,
  parseHLC,
} from '../electron/storage.mjs';
import {
  createInitialState,
  applyCommand,
  legacyRecordId,
} from '../src/lib/domain.mjs';

const REMOTE = '00000000-0000-4000-8000-000000000002';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 20);

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-sync-'));
  const stores = [];
  const clock = { now: T0 };
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    clock,
    store: () => {
      const store = new SQLiteStore(directory, { now: () => clock.now });
      stores.push(store);
      return store;
    },
  };
}
const remote = (wall, counter = 0) => formatHLC(wall, counter, REMOTE);
const row = (store, table, id) =>
  store.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
const taskRow = (task, position) => ({ ...task, position });

test('v1 database migrates to v2 with history, timer and a backup', (t) => {
  const f = fixture(t);
  const file = path.join(f.directory, 'to3mato.sqlite3');
  const v1 = new DatabaseSync(file);
  v1.exec(SCHEMA_V1);
  v1.exec(`
    INSERT INTO projects VALUES ('p1', 0, '사이드 프로젝트', 'folder', '#d08c6f');
    INSERT INTO tasks VALUES ('b', 0, '두 번째로 만든 작업', 2, 'p1', '2026-10-20', 0);
    INSERT INTO tasks VALUES ('a', 1, '첫 번째로 만든 작업', 1, NULL, '', 1);
    INSERT INTO focus_records VALUES (1, 'b', 750, 0.5, 1500, 100);
    INSERT INTO focus_records VALUES (2, 'deleted', 1500, 1, 1500, 200);
    INSERT INTO focus_records VALUES (3, 'deleted', 1500, 1, 1500, 200);
    INSERT INTO settings VALUES (1, 900, 300);
    INSERT INTO timer VALUES (1, 'b', 'focus', 900, 30, 50, 0);
    PRAGMA user_version = 1;
  `);
  v1.close();
  const store = f.store();
  const state = store.load();
  assert.deepEqual(
    state.tasks.map((task) => task.id),
    ['b', 'a'],
  );
  assert.equal(state.tasks[0].project, 'p1');
  assert.deepEqual(state.settings, {
    focus: 900,
    rest: 300,
    trayDisplay: 'clock',
    dailyCapacity: 8,
    planAt: '',
    reviewAt: '',
    remindDays: [1, 2, 3, 4, 5],
  });
  assert.equal(state.timer.taskId, 'b');
  assert.deepEqual(
    state.tasks.map((task) => [task.remaining, task.followUpOf]),
    [
      [2, ''],
      [1, ''],
    ],
  );
  assert.deepEqual(state.tickets, []);
  assert.deepEqual(state.templates, []);
  // Identical legacy records stay separate.
  const base = legacyRecordId({
    taskId: 'deleted',
    seconds: 1500,
    pomodoros: 1,
    duration: 1500,
    at: 200,
  });
  assert.deepEqual(
    state.records.map((record) => record.id),
    [
      legacyRecordId({
        taskId: 'b',
        seconds: 750,
        pomodoros: 0.5,
        duration: 1500,
        at: 100,
      }),
      base,
      `${base}-2`,
    ],
  );
  assert.equal(
    store.db.prepare('PRAGMA user_version').get().user_version,
    SCHEMA_VERSION,
  );
  const sync = store.syncState();
  assert.match(sync.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(sync.logging, false);
  assert.equal(store.pendingChanges().length, 0);
  // The backup is the untouched v1 database.
  const backup = new DatabaseSync(store.v2Backup, { readOnly: true });
  assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    backup.prepare('SELECT count(*) AS n FROM focus_records').get().n,
    3,
  );
  backup.close();
  store.close();
  assert.deepEqual(f.store().load(), state);
});

test('new record IDs survive a restart', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(state, { type: 'timer:play', payload: { id: 't1' } }, 0);
  state = applyCommand(state, { type: 'timer:end' }, 600000);
  store.save(state);
  store.close();
  assert.deepEqual(f.store().load().records, state.records);
});

test('local deletes leave tombstones and nothing is logged until sync starts', (t) => {
  const f = fixture(t),
    store = f.store();
  const state = store.load();
  store.save(
    applyCommand(state, { type: 'task:delete', payload: { id: 't5' } }),
  );
  assert.equal(row(store, 'tasks', 't5').deleted, 1);
  assert.equal(
    store.load().tasks.some((task) => task.id === 't5'),
    false,
  );
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM changes').get().n,
    0,
  );
});

test('resetSync queues a snapshot and later changes are logged in order', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(state, { type: 'task:delete', payload: { id: 't5' } });
  store.save(state);
  store.resetSync();
  const snapshot = store.pendingChanges(1000);
  // 3 projects + 4 live tasks + 1 tombstone + settings.
  assert.equal(snapshot.length, 9);
  assert.deepEqual(
    snapshot.find((c) => c.id === 't5'),
    {
      seq: snapshot.find((c) => c.id === 't5').seq,
      entity: 'task',
      id: 't5',
      data: null,
      hlc: row(store, 'tasks', 't5').updated_at,
    },
  );
  assert.deepEqual(snapshot.find((c) => c.id === 't1').data, {
    ...taskRow(state.tasks[0], 0),
  });
  assert.deepEqual(snapshot.at(-1).data, {
    focus: 1500,
    rest: 300,
    trayDisplay: 'clock',
    dailyCapacity: 8,
    planAt: '',
    reviewAt: '',
    remindDays: [1, 2, 3, 4, 5],
  });
  assert.equal(store.syncState().logging, true);
  store.markPushed(snapshot.map((c) => c.seq));
  assert.equal(store.pendingChanges().length, 0);

  state = applyCommand(state, {
    type: 'task:save',
    payload: { ...state.tasks[1], title: '수정한 작업' },
  });
  state = applyCommand(state, { type: 'task:delete', payload: { id: 't1' } });
  store.save(state);
  const changes = store.pendingChanges();
  // t1 removed, t2 edited and moved up, t3 and t4 moved up.
  assert.deepEqual(
    changes.map((c) => [c.entity, c.id, c.data?.position ?? null]),
    [
      ['task', 't1', null],
      ['task', 't2', 0],
      ['task', 't3', 1],
      ['task', 't4', 2],
    ],
  );
  assert.equal(changes[1].data.title, '수정한 작업');
  for (let i = 1; i < changes.length; i++)
    assert.ok(changes[i].hlc > changes[i - 1].hlc);

  store.disableSync();
  assert.deepEqual(store.pendingChanges(), changes);
  store.save(
    applyCommand(state, { type: 'settings:save', payload: { focus: 900 } }),
  );
  assert.deepEqual(store.pendingChanges(), changes);
});

test('the clock never repeats, even when time stands still or goes backwards', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  const stamps = [];
  for (const now of [T0, T0, T0 - DAY, T0 + 1]) {
    f.clock.now = now;
    state = applyCommand(state, {
      type: 'task:save',
      payload: { ...state.tasks[0], title: `제목 ${stamps.length}` },
    });
    store.save(state);
    stamps.push(row(store, 'tasks', 't1').updated_at);
  }
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] > stamps[i - 1]);
  const last = stamps.at(-1);
  store.close();
  // A reopened store continues after the newest stored HLC.
  f.clock.now = T0 - DAY;
  const reopened = f.store();
  reopened.load();
  reopened.save(
    applyCommand(state, {
      type: 'task:save',
      payload: { ...state.tasks[0], title: '재시작 후' },
    }),
  );
  assert.ok(row(reopened, 'tasks', 't1').updated_at > last);
  assert.equal(
    parseHLC(row(reopened, 'tasks', 't1').updated_at).device,
    reopened.syncState().deviceId,
  );
});

test('remote changes apply by row with the later HLC winning', (t) => {
  const f = fixture(t),
    store = f.store();
  const state = store.load();
  const local = row(store, 'tasks', 't1').updated_at;
  const older = remote(parseHLC(local).wall - 1);
  const newer = remote(T0 + 1000);
  const result = store.applyRemote(
    [
      {
        entity: 'task',
        id: 't1',
        data: taskRow({ ...state.tasks[0], title: '오래된 원격' }, 0),
        hlc: older,
      },
      {
        entity: 'task',
        id: 't2',
        data: taskRow({ ...state.tasks[1], title: '새 원격' }, 1),
        hlc: newer,
      },
      {
        entity: 'settings',
        id: 'settings',
        data: { focus: 3000, rest: 600, trayDisplay: 'clock' },
        hlc: newer,
      },
      { entity: 'task', id: 't3', data: null, hlc: newer },
      {
        entity: 'record',
        id: 'r-remote',
        data: {
          id: 'r-remote',
          taskId: 't2',
          seconds: 1500,
          pomodoros: 1,
          duration: 1500,
          at: 5,
        },
        hlc: newer,
      },
    ],
    { cursor: 42 },
  );
  assert.equal(result.applied, 4);
  assert.equal(result.skipped, 0);
  const loaded = store.load();
  assert.deepEqual(result.state, loaded);
  assert.equal(
    loaded.tasks.find((task) => task.id === 't1').title,
    '프로젝트 아이디어 정리',
  );
  assert.equal(loaded.tasks.find((task) => task.id === 't2').title, '새 원격');
  assert.equal(
    loaded.tasks.some((task) => task.id === 't3'),
    false,
  );
  // A settings payload from an older device still validates with defaults.
  assert.deepEqual(loaded.settings, {
    focus: 3000,
    rest: 600,
    trayDisplay: 'clock',
    dailyCapacity: 8,
    planAt: '',
    reviewAt: '',
    remindDays: [1, 2, 3, 4, 5],
  });
  assert.deepEqual(
    loaded.records.map((record) => record.id),
    ['r-remote'],
  );
  assert.equal(store.syncState().cursor, 42);
  // Applying the same batch again changes nothing.
  assert.equal(
    store.applyRemote([{ entity: 'task', id: 't3', data: null, hlc: newer }])
      .applied,
    0,
  );
  // Later local edits order after the remote HLC.
  store.save(
    applyCommand(loaded, {
      type: 'task:save',
      payload: { ...loaded.tasks[0], title: '로컬 최신' },
    }),
  );
  assert.ok(row(store, 'tasks', 't1').updated_at > newer);
});

test('remote deletes of unknown rows block older copies from returning', (t) => {
  const f = fixture(t),
    store = f.store();
  store.load();
  const record = {
    id: 'r1',
    taskId: 't1',
    seconds: 10,
    pomodoros: 0,
    duration: 1500,
    at: 1,
  };
  store.applyRemote([
    { entity: 'record', id: 'r1', data: null, hlc: remote(T0, 5) },
  ]);
  assert.equal(row(store, 'focus_records', 'r1').deleted, 1);
  const result = store.applyRemote([
    { entity: 'record', id: 'r1', data: record, hlc: remote(T0, 4) },
  ]);
  assert.equal(result.applied, 0);
  assert.deepEqual(result.state.records, []);
  // A newer copy revives the row.
  assert.deepEqual(
    store.applyRemote([
      { entity: 'record', id: 'r1', data: record, hlc: remote(T0, 6) },
    ]).state.records,
    [record],
  );
});

test('tasks keep their project link once the project arrives', (t) => {
  const f = fixture(t),
    store = f.store();
  store.load();
  const task = {
    id: 'remote-task',
    title: '원격 작업',
    estimate: 2,
    project: 'remote-project',
    date: '',
    done: false,
    position: 5,
  };
  let state = store.applyRemote([
    { entity: 'task', id: task.id, data: task, hlc: remote(T0 + 1) },
  ]).state;
  assert.equal(state.tasks.find((x) => x.id === task.id).project, '');
  state = store.applyRemote([
    {
      entity: 'project',
      id: 'remote-project',
      data: {
        id: 'remote-project',
        name: '원격 프로젝트',
        icon: 'book',
        color: '#123456',
        position: 3,
      },
      hlc: remote(T0 + 2),
    },
  ]).state;
  assert.equal(
    state.tasks.find((x) => x.id === task.id).project,
    'remote-project',
  );
  // Deleting the project leaves the task without a project.
  state = store.applyRemote([
    {
      entity: 'project',
      id: 'remote-project',
      data: null,
      hlc: remote(T0 + 3),
    },
  ]).state;
  assert.equal(state.tasks.find((x) => x.id === task.id).project, '');
});

test('positions shared with remote rows are renumbered and logged', (t) => {
  const f = fixture(t),
    store = f.store();
  store.load();
  store.resetSync();
  store.markPushed(store.pendingChanges(1000).map((c) => c.seq));
  const task = {
    id: '0-first',
    title: '원격 첫 작업',
    estimate: 1,
    project: '',
    date: '',
    done: false,
    position: 0,
  };
  const { state } = store.applyRemote([
    { entity: 'task', id: task.id, data: task, hlc: remote(T0 + 1) },
  ]);
  // Ties sort by ID, so the remote task comes first and the others move down.
  assert.deepEqual(
    state.tasks.map((x) => x.id),
    ['0-first', 't1', 't2', 't3', 't4', 't5'],
  );
  assert.deepEqual(
    store.db
      .prepare(
        'SELECT id, position FROM tasks WHERE deleted = 0 ORDER BY position',
      )
      .all()
      .map((r) => [r.id, r.position]),
    state.tasks.map((x, i) => [x.id, i]),
  );
  // Remote rows are not sent back. Only the local renumbering is.
  assert.deepEqual(
    store.pendingChanges().map((c) => [c.id, c.data.position]),
    [
      ['t1', 1],
      ['t2', 2],
      ['t3', 3],
      ['t4', 4],
      ['t5', 5],
    ],
  );
  // The order survives the next local save.
  store.save(state);
  assert.deepEqual(
    store.load().tasks.map((x) => x.id),
    state.tasks.map((x) => x.id),
  );
});

test('a remote delete of the focused task settles the timer first', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: 't1' } },
    T0,
  );
  store.save(state);
  store.resetSync();
  store.markPushed(store.pendingChanges(1000).map((c) => c.seq));
  f.clock.now = T0 + 600000;
  const result = store.applyRemote([
    { entity: 'task', id: 't1', data: null, hlc: remote(T0 + 600000) },
  ]);
  assert.equal(result.state.timer, null);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].taskId, 't1');
  assert.equal(result.state.records[0].pomodoros, 0.5);
  // The settled record, then the remaining tasks moving up one position.
  assert.deepEqual(
    store
      .pendingChanges()
      .map((c) => [c.entity, c.data.position ?? c.data.taskId]),
    [
      ['record', 't1'],
      ['task', 0],
      ['task', 1],
      ['task', 2],
      ['task', 3],
    ],
  );
  // Completing it remotely does the same.
  state = applyCommand(
    result.state,
    { type: 'timer:play', payload: { id: 't2' } },
    T0 + 600000,
  );
  store.save(state);
  f.clock.now = T0 + 700000;
  const done = store.applyRemote([
    {
      entity: 'task',
      id: 't2',
      data: taskRow({ ...state.tasks[0], done: true }, 0),
      hlc: remote(T0 + 700000),
    },
  ]);
  assert.equal(done.state.timer, null);
  assert.equal(done.state.records.length, 2);
});

test('invalid remote changes are skipped and a failed batch rolls back', (t) => {
  const f = fixture(t),
    store = f.store();
  const state = store.load();
  const good = {
    entity: 'task',
    id: 't1',
    data: taskRow({ ...state.tasks[0], title: '적용' }, 0),
    hlc: remote(T0 + 1),
  };
  const result = store.applyRemote([
    null,
    { ...good, hlc: 'not-an-hlc' },
    { ...good, entity: 'timer' },
    { ...good, id: 't2' },
    { ...good, data: { ...good.data, estimate: 0 } },
    { ...good, data: { ...good.data, title: 'x'.repeat(121) } },
    { entity: 'settings', id: 'settings', data: null, hlc: remote(T0 + 1) },
    {
      entity: 'settings',
      id: 'other',
      data: { focus: 1, rest: 1 },
      hlc: remote(T0 + 1),
    },
    good,
  ]);
  assert.equal(result.skipped, 8);
  assert.equal(result.applied, 1);
  assert.equal(result.state.tasks[0].title, '적용');

  const before = store.load();
  const readState = store.readState;
  store.readState = () => {
    throw new Error('검증 실패');
  };
  assert.throws(
    () =>
      store.applyRemote(
        [
          {
            ...good,
            data: { ...good.data, title: '롤백' },
            hlc: remote(T0 + 2),
          },
        ],
        { cursor: 7 },
      ),
    /검증 실패/,
  );
  store.readState = readState;
  assert.deepEqual(store.load(), before);
  assert.equal(store.syncState().cursor, 0);
});

test('JSON import tombstones missing rows and revives deleted IDs', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(state, { type: 'task:delete', payload: { id: 't5' } });
  store.save(state);
  store.resetSync();
  store.markPushed(store.pendingChanges(1000).map((c) => c.seq));
  const imported = createInitialState('2026-10-20');
  imported.tasks = imported.tasks.filter((task) => task.id !== 't1');
  imported.projects = imported.projects.filter((p) => p.id !== 'p3');
  imported.tasks = imported.tasks.filter((task) => task.project !== 'p3');
  store.replace(imported);
  assert.deepEqual(store.load(), imported);
  assert.equal(row(store, 'tasks', 't5').deleted, 0);
  const changes = store.pendingChanges();
  const deleted = changes.filter((c) => c.data === null).map((c) => c.id);
  assert.deepEqual(deleted.sort(), ['p3', 't1', 't3']);
  assert.ok(
    changes.some((c) => c.id === 't5' && c.data?.title === '주간 할 일 정리'),
  );
});

test('old tombstones remain until an explicit snapshot retention policy permits collection', (t) => {
  const f = fixture(t),
    store = f.store();
  let state = store.load();
  state = applyCommand(state, { type: 'task:delete', payload: { id: 't4' } });
  state = applyCommand(state, { type: 'task:delete', payload: { id: 't5' } });
  store.save(state);
  store.resetSync();
  const pending = store.pendingChanges(1000);
  // t5's delete is still waiting to be pushed.
  store.markPushed(pending.filter((c) => c.id !== 't5').map((c) => c.seq));
  store.close();
  f.clock.now = T0 + 29 * DAY;
  let reopened = f.store();
  reopened.load();
  assert.ok(row(reopened, 'tasks', 't4'));
  reopened.close();
  f.clock.now = T0 + 31 * DAY;
  reopened = f.store();
  reopened.load();
  assert.equal(row(reopened, 'tasks', 't4').deleted, 1);
  assert.equal(row(reopened, 'tasks', 't5').deleted, 1);
});
