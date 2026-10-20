import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  applyCommand,
  roundedPomodoros,
  elapsedSeconds,
  advanceTimer,
  getTodoSections,
  normalizeState,
  legacyRecordId,
  validateProjectRow,
  validateTaskRow,
  validateRecordRow,
  validateSettings,
} from '../src/lib/domain.mjs';
test('half-pomodoro rounding boundaries', () => {
  for (const [seconds, value] of [
    [0, 0],
    [374, 0],
    [375, 0.5],
    [750, 0.5],
    [1124, 0.5],
    [1125, 1],
    [1500, 1],
  ])
    assert.equal(roundedPomodoros(seconds, 1500), value);
});
test('A to B stores A and starts B from zero', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  s = applyCommand(s, { type: 'timer:play', payload: { id: 't2' } }, 751000);
  assert.equal(s.records[0].seconds, 750);
  assert.equal(s.records[0].pomodoros, 0.5);
  assert.equal(s.timer.taskId, 't2');
  assert.equal(elapsedSeconds(s.timer, 751000), 0);
});
test('pause excludes elapsed wall-clock time while paused', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  s = applyCommand(s, { type: 'timer:toggle' }, 101000);
  s = applyCommand(s, { type: 'timer:toggle' }, 601000);
  assert.equal(elapsedSeconds(s.timer, 651000), 150);
});
test('timer completion records once and does not complete the task', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    0,
  );
  assert.equal(advanceTimer(s, 1600000), true);
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].seconds, 1500);
  assert.equal(s.timer.phase, 'rest');
  assert.equal(s.timer.running, false);
  assert.equal(s.tasks[0].done, false);
  advanceTimer(s, 1700000);
  assert.equal(s.records.length, 1);
});
test('changing settings leaves current timer duration unchanged', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    0,
  );
  s = applyCommand(s, { type: 'settings:save', payload: { focus: 900 } }, 1000);
  assert.equal(s.timer.duration, 1500);
  s = applyCommand(s, { type: 'timer:play', payload: { id: 't2' } }, 2000);
  assert.equal(s.timer.duration, 900);
});
test('completing or deleting active task preserves actual time', () => {
  for (const type of ['task:toggle', 'task:delete']) {
    let s = applyCommand(
      createInitialState(),
      { type: 'timer:play', payload: { id: 't1' } },
      0,
    );
    s = applyCommand(s, { type, payload: { id: 't1' } }, 600000);
    assert.equal(s.timer, null);
    assert.equal(s.records[0].seconds, 600);
    assert.equal(s.records[0].pomodoros, 0.5);
  }
});
test('date sections keep undated, today, tomorrow, future and past tasks', () => {
  const tasks = [
    { id: 'u', date: '' },
    { id: 't', date: '2026-12-31' },
    { id: 'n', date: '2027-01-01' },
    { id: 'f', date: '2027-03-12' },
    { id: 'p', date: '2026-12-01', done: true },
  ];
  const s = getTodoSections(tasks, '2026-12-31');
  assert.deepEqual(
    s.slice(0, 4).map((x) => x.label),
    ['미지정', '오늘', '내일', '2027년 1월 2일'],
  );
  assert.equal(s.flatMap((x) => x.tasks).length, tasks.length);
});
test('moving dates and editing retains history', () => {
  let s = createInitialState();
  s.records.push({
    taskId: 't1',
    seconds: 1500,
    pomodoros: 1,
    duration: 1500,
    at: 1,
  });
  s = applyCommand(s, { type: 'task:move', payload: { id: 't1', date: '' } });
  assert.equal(s.tasks[0].date, '');
  assert.equal(s.records.length, 1);
});
test('invalid commands do not mutate original data', () => {
  const s = createInitialState(),
    before = JSON.stringify(s);
  assert.throws(() =>
    applyCommand(s, { type: 'settings:save', payload: { focus: NaN } }),
  );
  assert.throws(() =>
    applyCommand(s, {
      type: 'task:move',
      payload: { id: 't1', date: '2026-02-31' },
    }),
  );
  assert.equal(JSON.stringify(s), before);
});
test('import rejects malformed and duplicate data', () => {
  assert.throws(() => normalizeState({ version: 1, tasks: [], records: [] }));
  const s = createInitialState();
  s.tasks.push(s.tasks[0]);
  assert.throws(() => normalizeState(s));
  assert.deepEqual(normalizeState(createInitialState()), createInitialState());
});

test('resuming with a stale UI clock never subtracts previously focused time', () => {
  let state = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  state = applyCommand(state, { type: 'timer:pause' }, 301000);
  state = applyCommand(state, { type: 'timer:toggle' }, 601000);
  assert.equal(elapsedSeconds(state.timer, 600750), 300);
  assert.equal(elapsedSeconds(state.timer, 602000), 301);
});

const legacyRecord = {
  taskId: 't1',
  seconds: 750,
  pomodoros: 0.5,
  duration: 1500,
  at: 42,
};
test('new focus records receive unique IDs', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    0,
  );
  s = applyCommand(s, { type: 'timer:play', payload: { id: 't2' } }, 600000);
  s = applyCommand(s, { type: 'timer:end' }, 1200000);
  assert.equal(s.records.length, 2);
  for (const record of s.records)
    assert.match(
      record.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  assert.notEqual(s.records[0].id, s.records[1].id);
  assert.deepEqual(normalizeState(s), s);
});
test('legacy records get deterministic fixed-length IDs', () => {
  const id = legacyRecordId(legacyRecord);
  assert.match(id, /^legacy-[0-9a-f]{16}$/);
  assert.equal(legacyRecordId({ ...legacyRecord }), id);
  assert.notEqual(legacyRecordId({ ...legacyRecord, at: 43 }), id);
  assert.match(
    legacyRecordId({ ...legacyRecord, taskId: 'x'.repeat(120) }),
    /^legacy-[0-9a-f]{16}$/,
  );
  const s = createInitialState();
  s.records = [legacyRecord];
  const first = normalizeState(s);
  assert.equal(first.records[0].id, id);
  // Re-importing the same v1 backup yields the same IDs.
  assert.deepEqual(normalizeState(s), first);
  assert.deepEqual(normalizeState(first), first);
});
test('identical legacy records stay distinct and explicit duplicates are rejected', () => {
  const s = createInitialState();
  s.records = [legacyRecord, { ...legacyRecord }, { ...legacyRecord }];
  const base = legacyRecordId(legacyRecord);
  assert.deepEqual(
    normalizeState(s).records.map((r) => r.id),
    [base, `${base}-2`, `${base}-3`],
  );
  // A generated ID never collides with an ID that already exists in the file.
  s.records = [{ ...legacyRecord }, { ...legacyRecord, id: base }];
  assert.deepEqual(
    normalizeState(s).records.map((r) => r.id),
    [`${base}-2`, base],
  );
  s.records = [
    { ...legacyRecord, id: 'r1' },
    { ...legacyRecord, id: 'r1', at: 50 },
  ];
  assert.throws(() => normalizeState(s), /집중 기록 ID가 중복됩니다/);
  s.records = [{ ...legacyRecord, id: '' }];
  assert.throws(() => normalizeState(s));
});
test('row validators accept valid rows and strip unknown fields', () => {
  assert.deepEqual(
    validateProjectRow({
      id: 'p1',
      name: ' 독서 ',
      icon: 'leaf',
      color: '#ABCDEF',
      position: 2,
      extra: true,
    }),
    { id: 'p1', name: '독서', icon: 'leaf', color: '#ABCDEF', position: 2 },
  );
  assert.deepEqual(
    validateProjectRow({
      id: 'p1',
      name: 'a',
      icon: 'x',
      color: 'red',
      position: 0,
    }),
    { id: 'p1', name: 'a', icon: 'folder', color: '#84956c', position: 0 },
  );
  assert.deepEqual(
    validateTaskRow({
      id: 't9',
      title: '할 일',
      estimate: 3,
      project: 'missing-project',
      date: '2026-10-20',
      done: true,
      position: 0,
      owner: 'x',
    }),
    {
      id: 't9',
      title: '할 일',
      estimate: 3,
      project: 'missing-project',
      date: '2026-10-20',
      done: true,
      position: 0,
    },
  );
  assert.equal(
    validateTaskRow({
      id: 't',
      title: 'a',
      estimate: 1,
      date: '',
      done: 'yes',
      position: 0,
    }).done,
    false,
  );
  assert.deepEqual(
    validateRecordRow({ ...legacyRecord, id: 'r1', position: 5, note: 1 }),
    { ...legacyRecord, id: 'r1' },
  );
  assert.deepEqual(validateSettings({ focus: 1500, rest: 300, x: 1 }), {
    focus: 1500,
    rest: 300,
    trayDisplay: 'clock',
  });
});
test('row validators reject out-of-range values', () => {
  const task = { id: 't', title: 'a', estimate: 1, date: '', position: 0 };
  const record = { ...legacyRecord, id: 'r' };
  const project = { id: 'p', name: 'n', position: 0 };
  for (const invalid of [
    null,
    { ...task, id: '' },
    { ...task, id: 'x'.repeat(121) },
    { ...task, title: 'x'.repeat(121) },
    { ...task, estimate: 0 },
    { ...task, estimate: 49 },
    { ...task, estimate: 1.5 },
    { ...task, date: '2026-02-31' },
    { ...task, project: 7 },
    { ...task, position: -1 },
    { ...task, position: 0.5 },
    { ...task, position: 100001 },
  ])
    assert.throws(() => validateTaskRow(invalid));
  for (const invalid of [
    null,
    { ...record, id: undefined },
    { ...record, taskId: '' },
    { ...record, seconds: -1 },
    { ...record, seconds: 86401 },
    { ...record, pomodoros: 1.5 },
    { ...record, duration: 0 },
    { ...record, at: NaN },
    { ...record, at: '1' },
  ])
    assert.throws(() => validateRecordRow(invalid));
  for (const invalid of [
    null,
    { ...project, name: 'x'.repeat(81) },
    { ...project, position: undefined },
  ])
    assert.throws(() => validateProjectRow(invalid));
  for (const invalid of [null, { focus: 0, rest: 300 }, { focus: 1500 }])
    assert.throws(() => validateSettings(invalid));
});

test('tray display defaults, validates, and changes without disturbing the active timer', () => {
  for (const value of [undefined, null, 'unknown', 123])
    assert.equal(
      validateSettings({ focus: 1500, rest: 300, trayDisplay: value })
        .trayDisplay,
      'clock',
    );
  let state = createInitialState();
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: state.tasks[0].id } },
    1000,
  );
  const timer = structuredClone(state.timer);
  for (const trayDisplay of ['clock', 'bar', 'ring', 'hourglass']) {
    state = applyCommand(
      state,
      { type: 'settings:save', payload: { trayDisplay } },
      1000,
    );
    assert.equal(state.settings.trayDisplay, trayDisplay);
    assert.deepEqual(state.timer, timer);
  }
  state = applyCommand(
    state,
    { type: 'settings:save', payload: { focus: 900 } },
    1000,
  );
  assert.equal(state.settings.trayDisplay, 'hourglass');
});
