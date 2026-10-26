import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyCommand } from '../src/lib/domain.mjs';
import { projectSummary, ticketWeeks, clipIdFor } from '../src/lib/diary.mjs';

test('project summary counts live tickets, open tasks and used pomodoros', () => {
  let s = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    0,
  );
  s = applyCommand(s, { type: 'task:toggle', payload: { id: 't1' } }, 1500000);
  const summary = projectSummary(s, 'p1');
  assert.equal(summary.tickets, 1);
  assert.equal(summary.left, 1);
  assert.equal(summary.used, 1);
  assert.equal(summary.remaining, 2);
  assert.equal(summary.progress, 1 / 3);
  assert.deepEqual(
    summary.recent.map((t) => t.taskId),
    ['t1'],
  );
  const undone = applyCommand(s, {
    type: 'task:toggle',
    payload: { id: 't1' },
  });
  assert.equal(projectSummary(undone, 'p1').tickets, 0);
  assert.equal(projectSummary(undone, 'p1').left, 2);
  assert.equal(projectSummary(createInitialState(), 'p3').progress, 0);
});

test('tickets group by Monday-based week, newest first, with the delivery id', () => {
  const at = (iso) => new Date(iso).getTime();
  const ticket = (id, when) => ({ id, taskId: 't', completedAt: at(when) });
  const weeks = ticketWeeks([
    ticket('a', '2026-10-20T10:00:00'),
    ticket('b', '2026-10-27T09:00:00'),
    ticket('c', '2026-10-25T23:30:00'),
    ticket('d', '2026-10-26T00:10:00'),
  ]);
  assert.deepEqual(
    weeks.map((w) => [w.id, w.tickets.map((t) => t.id)]),
    [
      ['2026-10-26', ['b', 'd']],
      ['2026-10-19', ['c', 'a']],
    ],
  );
  assert.equal(weeks[0].label, '10월 26일 ~ 11월 1일');
  assert.deepEqual(ticketWeeks([]), []);
});

test('a ticket picks the latest clip of its task recorded before completion', () => {
  const ticket = { taskId: 't1', completedAt: 5000 };
  const ids = ['t1:1000', 't2:4000', 't1:4500', 't1:6000', 'broken'];
  assert.equal(clipIdFor(ticket, ids), 't1:4500');
  assert.equal(clipIdFor({ taskId: 't9', completedAt: 5000 }, ids), '');
  assert.equal(clipIdFor(ticket, []), '');
});
