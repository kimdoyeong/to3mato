import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTemplateBatch } from '../src/lib/templates.mjs';
import { applyCommand, createInitialState } from '../src/lib/domain.mjs';

const options = {
  steps: [
    { title: '%n%강 읽기 %date%', estimate: 1 },
    { title: '%n%강 문제', estimate: 2 },
  ],
  count: 3,
  startDate: '2026-10-27',
  weekdays: [1, 3, 5],
};
test('template rounds preserve step order, patterns and selected weekdays', () => {
  const drafts = generateTemplateBatch(options);
  assert.deepEqual(
    drafts.map((t) => [t.title, t.estimate, t.date]),
    [
      ['1강 읽기 2026-10-28', 1, '2026-10-28'],
      ['1강 문제', 2, '2026-10-28'],
      ['2강 읽기 2026-10-30', 1, '2026-10-30'],
      ['2강 문제', 2, '2026-10-30'],
      ['3강 읽기 2026-11-02', 1, '2026-11-02'],
      ['3강 문제', 2, '2026-11-02'],
    ],
  );
  const state = createInitialState();
  const next = applyCommand(state, {
    type: 'task:batch',
    payload: { project: '', tasks: drafts },
  });
  assert.equal(next.tasks.length, state.tasks.length + 6);
  assert.ok(
    next.tasks
      .slice(-6)
      .every((t) => t.project === '' && t.remaining === t.estimate),
  );
  assert.throws(() =>
    applyCommand(state, {
      type: 'task:batch',
      payload: { project: 'missing', tasks: drafts },
    }),
  );
});
test('template batches reject invalid steps, counts, dates and weekdays without saving', () => {
  for (const change of [
    { steps: [] },
    { steps: Array(21).fill(options.steps[0]) },
    { count: 251 },
    { count: 1.5 },
    { count: 0 },
    { weekdays: [] },
    { startDate: '2026-02-30' },
    { steps: [{ title: '%bad%', estimate: 1 }] },
    { steps: [{ title: 'x', estimate: 3 }] },
  ])
    assert.throws(() => generateTemplateBatch({ ...options, ...change }));
});
