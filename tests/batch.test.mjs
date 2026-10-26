import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTaskBatch,
  tokenizeTemplate,
  renderTaskTemplate,
} from '../src/lib/batch.mjs';
import { applyCommand, createInitialState } from '../src/lib/domain.mjs';
const options = {
  template: '독서 (%n%) · %date%',
  count: 10,
  estimate: 2,
  startDate: '2026-10-19',
  weekdays: [1, 3, 5],
  perDay: 2,
  overrides: { 5: 3 },
};

test('batch assigns selected weekdays with a daily default and weekday overrides', () => {
  const drafts = generateTaskBatch(options);
  assert.deepEqual(
    drafts.map((draft) => draft.date),
    [
      '2026-10-19',
      '2026-10-19',
      '2026-10-21',
      '2026-10-21',
      '2026-10-23',
      '2026-10-23',
      '2026-10-23',
      '2026-10-26',
      '2026-10-26',
      '2026-10-28',
    ],
  );
  assert.equal(drafts[0].title, '독서 (1) · 2026-10-19');
  assert.equal(drafts[9].title, '독서 (10) · 2026-10-28');
  assert.ok(drafts.every((draft) => draft.estimate === 2));
});
test('batch skips unselected start days and crosses month/year and leap days', () => {
  assert.deepEqual(
    generateTaskBatch({ ...options, startDate: '2026-12-31', count: 4 }).map(
      (draft) => draft.date,
    ),
    ['2027-01-01', '2027-01-01', '2027-01-01', '2027-01-04'],
  );
  assert.deepEqual(
    generateTaskBatch({
      ...options,
      startDate: '2028-02-28',
      count: 3,
      weekdays: [1, 2, 3, 4, 5, 6, 0],
      perDay: 1,
      overrides: {},
    }).map((draft) => draft.date),
    ['2028-02-28', '2028-02-29', '2028-03-01'],
  );
});
test('template recognizes complete, incomplete and unknown tokens without rendering HTML', () => {
  assert.deepEqual(
    tokenizeTemplate('독서 %n% %date% %foo% %da').map((piece) => piece.kind),
    ['text', 'number', 'text', 'date', 'text', 'invalid', 'text', 'incomplete'],
  );
  assert.equal(
    renderTaskTemplate('%n% / %n% / %date%', 3, '2026-10-19'),
    '3 / 3 / 2026-10-19',
  );
  assert.equal(renderTaskTemplate('<b>%n%</b>', 1, '2026-10-19'), '<b>1</b>');
});
test('invalid schedules and templates fail before generating tasks', () => {
  for (const patch of [
    { count: 0 },
    { count: 501 },
    { count: 1.5 },
    { estimate: 0 },
    { estimate: 7 },
    { estimate: 48 },
    { estimate: 1.5 },
    { weekdays: [] },
    { weekdays: [8] },
    { startDate: '2026-02-30' },
    { perDay: 0 },
    { overrides: { 5: 0 } },
    { template: '%missing%' },
    { template: '%date' },
    { template: 'x'.repeat(121) },
  ]) {
    assert.throws(() => generateTaskBatch({ ...options, ...patch }));
  }
});
test('batch commit is atomic and results are ordinary independent tasks', () => {
  const state = createInitialState();
  const tasks = generateTaskBatch({ ...options, count: 3 });
  const before = structuredClone(state);
  assert.throws(() =>
    applyCommand(state, {
      type: 'task:batch',
      payload: {
        project: 'p1',
        tasks: [tasks[0], { ...tasks[1], title: ' ' }],
      },
    }),
  );
  assert.throws(() =>
    applyCommand(state, {
      type: 'task:batch',
      payload: { project: 'missing', tasks },
    }),
  );
  assert.deepEqual(state, before);
  const saved = applyCommand(state, {
    type: 'task:batch',
    payload: { project: 'p1', tasks },
  });
  const added = saved.tasks.slice(state.tasks.length);
  assert.equal(new Set(added.map((task) => task.id)).size, 3);
  assert.deepEqual(Object.keys(added[0]).sort(), [
    'date',
    'done',
    'estimate',
    'followUpOf',
    'id',
    'project',
    'remaining',
    'title',
  ]);
  assert.ok(added.every((task) => task.project === 'p1' && !task.done));
  const changed = applyCommand(saved, {
    type: 'task:save',
    payload: { ...added[0], title: '개별 수정', date: '2026-11-01' },
  });
  const completed = applyCommand(changed, {
    type: 'task:toggle',
    payload: { id: added[0].id },
  });
  assert.deepEqual(completed.tasks.at(-1), added[2]);
  assert.equal(
    completed.tasks.find((task) => task.id === added[0].id).done,
    true,
  );
});
