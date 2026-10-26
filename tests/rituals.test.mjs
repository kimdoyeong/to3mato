import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createInitialState, localDate } from '../src/lib/domain.mjs';
import { sevenDayAverage, planIsDue } from '../src/lib/rituals.mjs';
import {
  dueReminder,
  createTimerNotifications,
} from '../electron/notifications.mjs';

const at = (value) => new Date(value).getTime();
test('seven-day average includes local midnight boundaries, fractional records and empty days', () => {
  const records = [
    ['2026-10-18T23:59:59', 99],
    ['2026-10-19T00:00:00', 2.5],
    ['2026-10-25T23:59:59', 8],
    ['2026-10-26T00:00:00', 99],
    ['2026-10-27T00:00:00', 99],
  ].map(([date, pomodoros]) => ({ at: at(date), pomodoros }));
  assert.equal(sevenDayAverage(records, '2026-10-26'), 2);
  assert.equal(sevenDayAverage([], '2026-10-26'), 0);
  assert.equal(
    sevenDayAverage(
      [{ at: at('2025-12-31T12:00:00'), pomodoros: 7 }],
      '2026-01-01',
    ),
    1,
  );
});
test('automatic plan opening respects clock and local dismissal date', () => {
  assert.equal(planIsDue({ planAt: '' }, at('2026-10-26T10:00:00'), ''), false);
  assert.equal(
    planIsDue({ planAt: '09:00' }, at('2026-10-26T08:59:59'), ''),
    false,
  );
  assert.equal(
    planIsDue({ planAt: '09:00' }, at('2026-10-26T09:00:00'), ''),
    true,
  );
  assert.equal(
    planIsDue({ planAt: '09:00' }, at('2026-10-26T10:00:00'), '2026-10-26'),
    false,
  );
  assert.equal(
    planIsDue({ planAt: '09:00' }, at('2026-10-27T10:00:00'), '2026-10-26'),
    true,
  );
});
test('reminders are disabled by default and honor weekdays, time and each daily ledger', () => {
  const s = createInitialState();
  const now = at('2026-10-26T18:00:00');
  assert.equal(dueReminder(s, now, {}), null);
  s.settings.planAt = '09:00';
  s.settings.reviewAt = '18:00';
  const fired = {};
  const before = structuredClone(s);
  assert.equal(dueReminder(s, at('2026-10-26T08:59:59'), fired), null);
  assert.deepEqual(dueReminder(s, at('2026-10-26T09:00:00'), fired), {
    kind: 'plan',
    title: '계획 시작',
    body: '',
  });
  assert.deepEqual(s, before);
  assert.deepEqual(fired, {});
  fired.plan = localDate(new Date(now));
  assert.equal(dueReminder(s, at('2026-10-26T17:59:59'), fired), null);
  assert.deepEqual(dueReminder(s, now, fired), {
    kind: 'review',
    title: '돌아보기',
    body: '',
  });
  fired.review = fired.plan;
  assert.equal(dueReminder(s, now, fired), null);
  assert.equal(dueReminder(s, at('2026-10-27T10:00:00'), fired).kind, 'plan');
  assert.equal(dueReminder(s, at('2026-10-31T20:00:00'), fired), null);
  s.settings.remindDays = [];
  assert.equal(dueReminder(s, now, {}), null);
  s.settings.remindDays = [0];
  assert.equal(dueReminder(s, at('2026-11-01T20:00:00'), fired).kind, 'plan');
});
test('both overdue reminders can fire in the same minute and remain separate', () => {
  const s = createInitialState();
  s.settings.planAt = '00:00';
  s.settings.reviewAt = '00:00';
  const now = at('2026-10-26T00:00:00');
  const fired = {};
  const kinds = [];
  let reminder;
  while ((reminder = dueReminder(s, now, fired))) {
    kinds.push(reminder.kind);
    fired[reminder.kind] = localDate(new Date(now));
  }
  assert.deepEqual(kinds, ['plan', 'review']);
  assert.equal(dueReminder(s, now + 60000, fired), null);
});
test('ritual notification clicks show main before dispatching the renderer event', () => {
  const actions = [];
  let notice;
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
      notice = this;
    }
    show() {}
    close() {}
  }
  const notifications = createTimerNotifications({
    Notification,
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (...args) => actions.push(args) },
    }),
    showMain: () => actions.push('showMain'),
  });
  notifications.show({ kind: 'review', title: '돌아보기', body: '' });
  assert.equal('kind' in notice.options, false);
  notice.emit('click');
  assert.deepEqual(actions, ['showMain', ['ritual:open', 'review']]);
  notifications.destroy();
});
