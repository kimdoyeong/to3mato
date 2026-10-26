import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  applyCommand,
  advanceTimer,
  normalizeState,
  timerMenuState,
  validateTicketRow,
  validateTemplateRow,
  validateSettings,
  usedPomodoros,
} from '../src/lib/domain.mjs';

const FOCUS_END = 1000 + 1500 * 1000;
function finishedFocus(id = 't1') {
  const started = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id } },
    1000,
  );
  const state = structuredClone(started);
  assert.equal(advanceTimer(state, FOCUS_END), true);
  return state;
}

test('a finished focus waits in check-in: record written, clock stopped, tray offers rest', () => {
  const s = finishedFocus();
  assert.deepEqual(s.timer, {
    taskId: 't1',
    phase: 'checkin',
    duration: 1500,
    elapsed: 1500,
    startedAt: FOCUS_END,
    running: false,
  });
  assert.equal(s.records.length, 1);
  assert.equal(s.tasks[0].done, false);
  const view = timerMenuState(s, FOCUS_END + 60000);
  assert.equal(view.status, '진척 확인');
  assert.equal(view.clock, '00:00');
  assert.equal(view.paused, true);
  assert.equal(view.phase, 'checkin');
  assert.equal(view.primary, '휴식 시작');
  assert.deepEqual(view.command, { type: 'checkin:skip' });
  assert.equal(view.end, '집중 종료');
  assert.equal(view.endEnabled, true);
  // Nothing happens on its own and the state round-trips.
  assert.equal(advanceTimer(s, FOCUS_END + 10 * 60 * 1000), false);
  assert.deepEqual(normalizeState(structuredClone(s)), s);
});

test('checkin:save adjusts the remaining estimate and starts rest', () => {
  const s = finishedFocus();
  const saved = applyCommand(
    s,
    { type: 'checkin:save', payload: { remaining: 1 } },
    FOCUS_END + 5000,
  );
  assert.equal(saved.tasks[0].remaining, 1);
  assert.equal(saved.tasks[0].estimate, 2);
  assert.equal(saved.tasks[0].done, false);
  assert.deepEqual(saved.timer, {
    taskId: null,
    phase: 'rest',
    duration: 300,
    elapsed: 0,
    startedAt: FOCUS_END + 5000,
    running: true,
  });
  assert.equal(saved.tickets.length, 0);
  for (const remaining of [-1, 1.5, 49, 'x', undefined])
    assert.throws(() =>
      applyCommand(s, { type: 'checkin:save', payload: { remaining } }),
    );
});

test('checkin:done completes the task and issues a ticket with the used pomodoros', () => {
  const s = finishedFocus();
  const done = applyCommand(
    s,
    { type: 'checkin:done', payload: { clipId: 't1:123' } },
    FOCUS_END + 1,
  );
  assert.equal(done.tasks[0].done, true);
  assert.equal(done.timer.phase, 'rest');
  assert.equal(done.tickets.length, 1);
  const ticket = done.tickets[0];
  assert.match(ticket.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...ticket, id: 'x' },
    {
      id: 'x',
      taskId: 't1',
      title: '프로젝트 아이디어 정리',
      projectId: 'p1',
      completedAt: FOCUS_END + 1,
      estimate: 2,
      used: 1,
      clipId: 't1:123',
      note: '',
      highlight: false,
      sticker: '',
      voided: false,
    },
  );
  assert.equal(usedPomodoros(done, 't1'), 1);
});

test('checkin:followup carries the rest into a new task right after the original', () => {
  const s = finishedFocus();
  const next = applyCommand(s, { type: 'checkin:followup' }, FOCUS_END);
  const [original, followUp] = next.tasks;
  assert.equal(original.id, 't1');
  assert.equal(original.remaining, 0);
  assert.equal(original.done, false);
  assert.equal(followUp.title, original.title);
  assert.equal(followUp.estimate, 1);
  assert.equal(followUp.remaining, 1);
  assert.equal(followUp.followUpOf, 't1');
  assert.equal(followUp.date, original.date);
  assert.equal(followUp.project, original.project);
  assert.equal(followUp.done, false);
  assert.equal(next.tasks.length, s.tasks.length + 1);
  assert.equal(next.timer.phase, 'rest');
  const titled = applyCommand(
    s,
    { type: 'checkin:followup', payload: { title: '본문 마무리' } },
    FOCUS_END,
  );
  assert.equal(titled.tasks[1].title, '본문 마무리');
  assert.deepEqual(normalizeState(structuredClone(titled)), titled);
});

test('check-in commands are refused outside check-in and other commands leave it intact', () => {
  const idle = createInitialState();
  const focusing = applyCommand(
    idle,
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  const resting = applyCommand(finishedFocus(), { type: 'checkin:skip' });
  for (const state of [idle, focusing, resting])
    for (const type of [
      'checkin:save',
      'checkin:done',
      'checkin:followup',
      'checkin:skip',
    ])
      assert.throws(
        () => applyCommand(state, { type, payload: { remaining: 1 } }, 2000),
        /진척 확인 중이 아닙니다/,
      );
  const s = finishedFocus();
  // Pause and toggle do nothing; settings keep the check-in.
  for (const command of [
    { type: 'timer:toggle' },
    { type: 'timer:pause' },
    { type: 'settings:save', payload: { focus: 900 } },
  ])
    assert.deepEqual(applyCommand(s, command, FOCUS_END + 10).timer, s.timer);
  // Starting any task, even the same one, begins a fresh focus without a record.
  for (const id of ['t1', 't2']) {
    const played = applyCommand(
      s,
      { type: 'timer:play', payload: { id } },
      FOCUS_END + 10,
    );
    assert.equal(played.records.length, 1);
    assert.equal(played.timer.phase, 'focus');
    assert.equal(played.timer.taskId, id);
    assert.equal(played.timer.elapsed, 0);
  }
  const ended = applyCommand(s, { type: 'timer:end' }, FOCUS_END + 10);
  assert.equal(ended.timer, null);
  assert.equal(ended.records.length, 1);
  // Completing or deleting the task from the list settles the check-in too.
  assert.equal(
    applyCommand(s, { type: 'task:toggle', payload: { id: 't1' } }).timer,
    null,
  );
  assert.equal(
    applyCommand(s, { type: 'task:delete', payload: { id: 't1' } }).timer,
    null,
  );
});

test('normalizeState keeps a valid check-in, stops it, and rejects stale ones', () => {
  const s = finishedFocus();
  const running = structuredClone(s);
  running.timer.running = true;
  assert.equal(normalizeState(running).timer.running, false);
  const done = structuredClone(s);
  done.tasks[0].done = true;
  assert.throws(
    () => normalizeState(done),
    /실행 중인 작업을 찾을 수 없습니다/,
  );
  const missing = structuredClone(s);
  missing.timer.taskId = 'nope';
  assert.throws(
    () => normalizeState(missing),
    /실행 중인 작업을 찾을 수 없습니다/,
  );
  const other = structuredClone(s);
  other.timer.phase = 'other';
  assert.throws(() => normalizeState(other), /타이머 상태가 올바르지 않습니다/);
});

test('completing a task issues a ticket, undoing voids it and redoing issues a new one', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't3' } },
    1000,
  );
  s = applyCommand(s, { type: 'task:toggle', payload: { id: 't3' } }, 751000);
  assert.equal(s.timer, null);
  assert.equal(s.tickets.length, 1);
  assert.equal(s.tickets[0].used, 0.5);
  assert.equal(s.tickets[0].estimate, 1);
  assert.equal(s.tickets[0].completedAt, 751000);
  s = applyCommand(s, { type: 'task:toggle', payload: { id: 't3' } }, 760000);
  assert.equal(s.tasks[2].done, false);
  assert.equal(s.tickets[0].voided, true);
  s = applyCommand(s, { type: 'task:toggle', payload: { id: 't3' } }, 770000);
  assert.equal(s.tickets.length, 2);
  assert.equal(s.tickets[1].voided, false);
  // Deleting the task keeps its tickets.
  s = applyCommand(s, { type: 'task:delete', payload: { id: 't3' } });
  assert.equal(s.tickets.length, 2);
  assert.deepEqual(normalizeState(structuredClone(s)), s);
});

test('ticket:update changes decoration only and rejects unknown values', () => {
  let s = applyCommand(createInitialState(), {
    type: 'task:toggle',
    payload: { id: 't3' },
  });
  const id = s.tickets[0].id;
  s = applyCommand(s, {
    type: 'ticket:update',
    payload: { id, note: ' 메모 ', highlight: true, sticker: 'heart' },
  });
  assert.equal(s.tickets[0].note, '메모');
  assert.equal(s.tickets[0].highlight, true);
  assert.equal(s.tickets[0].sticker, 'heart');
  assert.equal(s.tickets[0].title, '도서 읽기');
  s = applyCommand(s, { type: 'ticket:update', payload: { id, sticker: '' } });
  assert.equal(s.tickets[0].sticker, '');
  assert.throws(
    () =>
      applyCommand(s, { type: 'ticket:update', payload: { id, sticker: 'x' } }),
    /입력 내용을 확인하세요/,
  );
  assert.throws(
    () =>
      applyCommand(s, {
        type: 'ticket:update',
        payload: { id, note: 'a'.repeat(201) },
      }),
    /입력 내용을 확인하세요/,
  );
  assert.throws(
    () => applyCommand(s, { type: 'ticket:update', payload: { id: 'nope' } }),
    /티켓을 찾을 수 없습니다/,
  );
});

test('ticket and template rows validate, strip unknown fields and fall back safely', () => {
  const ticket = {
    id: 'k1',
    taskId: 't1',
    title: '제목',
    projectId: 'p1',
    completedAt: 5,
    estimate: 2,
    used: 1.5,
    clipId: '',
    note: '',
    highlight: false,
    sticker: '',
    voided: false,
  };
  assert.deepEqual(
    validateTicketRow({ ...ticket, sticker: 'x', highlight: 'yes', extra: 1 }),
    ticket,
  );
  assert.throws(() => validateTicketRow({ ...ticket, used: -1 }));
  assert.throws(() => validateTicketRow({ ...ticket, estimate: 0 }));
  assert.throws(() => validateTicketRow({ ...ticket, note: 'a'.repeat(201) }));
  assert.throws(() => validateTicketRow({ ...ticket, title: '' }));
  const template = {
    id: 'm1',
    name: '학습',
    steps: [
      { title: '읽기', estimate: 1 },
      { title: '문제 풀기', estimate: 2 },
    ],
    position: 0,
  };
  assert.deepEqual(
    validateTemplateRow({
      ...template,
      steps: template.steps.map((s) => ({ ...s, extra: 1 })),
    }),
    template,
  );
  assert.throws(() => validateTemplateRow({ ...template, steps: [] }));
  assert.throws(
    () =>
      validateTemplateRow({
        ...template,
        steps: Array(21).fill(template.steps[0]),
      }),
    /템플릿 단계는 1~20개여야 합니다/,
  );
  assert.throws(() =>
    validateTemplateRow({
      ...template,
      steps: [{ title: '긴 단계', estimate: 3 }],
    }),
  );
  assert.throws(() =>
    validateTemplateRow({ ...template, name: 'a'.repeat(81) }),
  );
});

test('templates save, apply one round at once and delete', () => {
  let s = applyCommand(createInitialState(), {
    type: 'template:save',
    payload: {
      name: '학습 1회차',
      steps: [
        { title: '%n%강 읽기', estimate: 1 },
        { title: '%n%강 문제 풀기', estimate: 2 },
        { title: '%n%강 답 맞추기', estimate: 1 },
      ],
    },
  });
  assert.equal(s.templates.length, 1);
  const id = s.templates[0].id;
  const before = s.tasks.length;
  s = applyCommand(s, {
    type: 'template:apply',
    payload: { id, date: '2026-10-27', project: 'p2' },
  });
  const added = s.tasks.slice(before);
  assert.deepEqual(
    added.map((t) => [
      t.title,
      t.estimate,
      t.remaining,
      t.date,
      t.project,
      t.done,
    ]),
    [
      ['1강 읽기', 1, 1, '2026-10-27', 'p2', false],
      ['1강 문제 풀기', 2, 2, '2026-10-27', 'p2', false],
      ['1강 답 맞추기', 1, 1, '2026-10-27', 'p2', false],
    ],
  );
  // Project-less application into the unscheduled list works too.
  const loose = applyCommand(s, { type: 'template:apply', payload: { id } });
  assert.deepEqual(
    loose.tasks.slice(-3).map((t) => [t.date, t.project]),
    [
      ['', ''],
      ['', ''],
      ['', ''],
    ],
  );
  assert.throws(
    () =>
      applyCommand(s, {
        type: 'template:apply',
        payload: { id, date: '', project: 'missing' },
      }),
    /프로젝트를 찾을 수 없습니다/,
  );
  s = applyCommand(s, {
    type: 'template:save',
    payload: { id, name: '학습', steps: [{ title: '읽기', estimate: 1 }] },
  });
  assert.equal(s.templates[0].name, '학습');
  assert.equal(s.templates[0].steps.length, 1);
  assert.throws(
    () =>
      applyCommand(s, {
        type: 'template:save',
        payload: {
          id: 'nope',
          name: 'x',
          steps: [{ title: 'a', estimate: 1 }],
        },
      }),
    /템플릿을 찾을 수 없습니다/,
  );
  s = applyCommand(s, { type: 'template:delete', payload: { id } });
  assert.deepEqual(s.templates, []);
  assert.throws(
    () => applyCommand(s, { type: 'template:apply', payload: { id } }),
    /템플릿을 찾을 수 없습니다/,
  );
  assert.deepEqual(normalizeState(structuredClone(s)), s);
});

test('projects keep an outcome line and a cover image name', () => {
  let s = applyCommand(createInitialState(), {
    type: 'project:save',
    payload: { name: '새 프로젝트', outcome: ' 보고서 1부 ', image: 'x.png' },
  });
  const project = s.projects.at(-1);
  assert.equal(project.outcome, '보고서 1부');
  assert.equal(project.image, 'x.png');
  s = applyCommand(s, {
    type: 'project:save',
    payload: { id: project.id, name: '이름만 수정' },
  });
  assert.equal(s.projects.at(-1).outcome, '보고서 1부');
  s = applyCommand(s, {
    type: 'project:save',
    payload: { id: project.id, name: '이름', outcome: '', image: '../evil' },
  });
  assert.equal(s.projects.at(-1).outcome, '');
  assert.equal(s.projects.at(-1).image, '');
  assert.throws(() =>
    applyCommand(s, {
      type: 'project:save',
      payload: { name: 'x', outcome: 'a'.repeat(121) },
    }),
  );
});

test('settings merge the given keys and validate capacity, times and weekdays', () => {
  const s = createInitialState();
  const next = applyCommand(s, {
    type: 'settings:save',
    payload: { dailyCapacity: 6, planAt: '09:00', remindDays: [5, 1, 1] },
  });
  assert.deepEqual(next.settings, {
    ...s.settings,
    dailyCapacity: 6,
    planAt: '09:00',
    remindDays: [1, 5],
  });
  const cleared = applyCommand(next, {
    type: 'settings:save',
    payload: { planAt: '', reviewAt: '18:30' },
  });
  assert.equal(cleared.settings.planAt, '');
  assert.equal(cleared.settings.reviewAt, '18:30');
  assert.equal(cleared.settings.dailyCapacity, 6);
  for (const payload of [
    { dailyCapacity: 0 },
    { dailyCapacity: 17 },
    { dailyCapacity: 1.5 },
    { planAt: '24:00' },
    { reviewAt: '9:00' },
    { remindDays: [7] },
    { remindDays: 'mon' },
  ])
    assert.throws(() => applyCommand(s, { type: 'settings:save', payload }));
  assert.deepEqual(validateSettings({ focus: 1500, rest: 300 }), s.settings);
});

test('task:reorder moves a task before another or to the end', () => {
  const s = createInitialState();
  const ids = (state) => state.tasks.map((t) => t.id);
  assert.deepEqual(
    ids(
      applyCommand(s, {
        type: 'task:reorder',
        payload: { id: 't3', before: 't1' },
      }),
    ),
    ['t3', 't1', 't2', 't4', 't5'],
  );
  assert.deepEqual(
    ids(
      applyCommand(s, {
        type: 'task:reorder',
        payload: { id: 't1', before: '' },
      }),
    ),
    ['t2', 't3', 't4', 't5', 't1'],
  );
  assert.deepEqual(
    ids(
      applyCommand(s, {
        type: 'task:reorder',
        payload: { id: 't1', before: 't1' },
      }),
    ),
    ids(s),
  );
  assert.throws(() =>
    applyCommand(s, {
      type: 'task:reorder',
      payload: { id: 'nope', before: 't1' },
    }),
  );
  assert.throws(() =>
    applyCommand(s, {
      type: 'task:reorder',
      payload: { id: 't1', before: 'nope' },
    }),
  );
});
