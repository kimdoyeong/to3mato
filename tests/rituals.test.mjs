import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInitialState } from '../src/lib/domain.mjs';
import { sevenDayAverage, planIsDue } from '../src/lib/rituals.mjs';
import {
  nextReminder,
  createTimerNotifications,
} from '../electron/notifications.mjs';
import {
  createRitualLedger,
  emptyLedger,
  normalizeLedger,
} from '../electron/ritual-ledger.mjs';

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
test('automatic plan opening respects clock, weekdays and the dismissal date', () => {
  const every = { planAt: '09:00', remindDays: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(
    planIsDue({ ...every, planAt: '' }, at('2026-10-26T10:00:00'), ''),
    false,
  );
  assert.equal(planIsDue(every, at('2026-10-26T08:59:59'), ''), false);
  assert.equal(planIsDue(every, at('2026-10-26T09:00:00'), ''), true);
  assert.equal(
    planIsDue(every, at('2026-10-26T10:00:00'), '2026-10-26'),
    false,
  );
  assert.equal(planIsDue(every, at('2026-10-27T10:00:00'), '2026-10-26'), true);
  // Weekend days left out of the reminder days keep the card closed too.
  const weekdays = { planAt: '09:00', remindDays: [1, 2, 3, 4, 5] };
  assert.equal(planIsDue(weekdays, at('2026-10-31T10:00:00'), ''), false);
  assert.equal(planIsDue(weekdays, at('2026-11-01T10:00:00'), ''), false);
  assert.equal(planIsDue(weekdays, at('2026-11-02T10:00:00'), ''), true);
});
const none = { reminder: null, settled: [] };
const ledger = (sent = {}, done = {}) => ({
  sent: { plan: '', review: '', ...sent },
  done: { plan: '', review: '', ...done },
});
test('reminders are disabled by default and honor weekdays, time and the sent ledger', () => {
  const s = createInitialState();
  const now = at('2026-10-26T18:00:00');
  assert.deepEqual(nextReminder(s, now, ledger()), none);
  s.settings.planAt = '09:00';
  s.settings.reviewAt = '18:00';
  const before = structuredClone(s);
  const empty = ledger();
  assert.deepEqual(nextReminder(s, at('2026-10-26T08:59:59'), empty), none);
  assert.deepEqual(nextReminder(s, at('2026-10-26T09:00:00'), empty), {
    reminder: { kind: 'plan', title: '계획 시작', body: '' },
    settled: ['plan'],
  });
  assert.deepEqual(s, before);
  assert.deepEqual(empty, ledger());
  const planSent = ledger({ plan: '2026-10-26' });
  assert.deepEqual(nextReminder(s, at('2026-10-26T17:59:59'), planSent), none);
  assert.deepEqual(nextReminder(s, now, planSent), {
    reminder: { kind: 'review', title: '돌아보기', body: '' },
    settled: ['review'],
  });
  const bothSent = ledger({ plan: '2026-10-26', review: '2026-10-26' });
  assert.deepEqual(nextReminder(s, now, bothSent), none);
  assert.equal(
    nextReminder(s, at('2026-10-27T10:00:00'), bothSent).reminder.kind,
    'plan',
  );
  // Saturday is not a default reminder day.
  assert.deepEqual(nextReminder(s, at('2026-10-31T20:00:00'), empty), none);
  s.settings.remindDays = [];
  assert.deepEqual(nextReminder(s, now, empty), none);
  s.settings.remindDays = [0];
  assert.equal(
    nextReminder(s, at('2026-11-01T10:00:00'), empty).reminder.kind,
    'plan',
  );
});
test('a late launch shows only the latest overdue reminder and settles the earlier one', () => {
  const s = createInitialState();
  s.settings.planAt = '09:00';
  s.settings.reviewAt = '18:00';
  const late = at('2026-10-26T23:00:00');
  assert.deepEqual(nextReminder(s, late, ledger()), {
    reminder: { kind: 'review', title: '돌아보기', body: '' },
    settled: ['plan', 'review'],
  });
  // The order follows the configured times, not a fixed kind order.
  s.settings.planAt = '20:00';
  s.settings.reviewAt = '07:00';
  assert.deepEqual(nextReminder(s, late, ledger()), {
    reminder: { kind: 'plan', title: '계획 시작', body: '' },
    settled: ['review', 'plan'],
  });
  // Equal times still produce a single notice.
  s.settings.planAt = '00:00';
  s.settings.reviewAt = '00:00';
  const result = nextReminder(s, at('2026-10-26T00:00:00'), ledger());
  assert.equal(result.settled.length, 2);
  assert.ok(result.reminder);
});
test('a ritual finished today suppresses its reminder but not the other one', () => {
  const s = createInitialState();
  s.settings.planAt = '09:00';
  s.settings.reviewAt = '18:00';
  const planned = ledger({}, { plan: '2026-10-26' });
  assert.deepEqual(nextReminder(s, at('2026-10-26T10:00:00'), planned), none);
  assert.deepEqual(nextReminder(s, at('2026-10-26T18:30:00'), planned), {
    reminder: { kind: 'review', title: '돌아보기', body: '' },
    settled: ['review'],
  });
  const reviewed = ledger({}, { plan: '2026-10-26', review: '2026-10-26' });
  assert.deepEqual(nextReminder(s, at('2026-10-26T18:30:00'), reviewed), none);
  // A dismissal from yesterday does not carry over.
  assert.equal(
    nextReminder(s, at('2026-10-27T10:00:00'), reviewed).reminder.kind,
    'plan',
  );
});
test('the ritual ledger survives restarts and ignores malformed data', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-ritual-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = createRitualLedger(directory);
  assert.deepEqual(first.get(), emptyLedger());
  first.markSent(['plan', 'review', 'other'], '2026-10-26');
  assert.equal(first.markDone('plan', '2026-10-26'), true);
  assert.equal(first.markDone('plan', '2026-10-25'), true);
  assert.equal(first.markDone('other', '2026-10-26'), false);
  assert.equal(first.markDone('review', '26-10-2026'), false);
  const expected = {
    sent: { plan: '2026-10-26', review: '2026-10-26' },
    done: { plan: '2026-10-26', review: '' },
  };
  assert.deepEqual(first.get(), expected);
  // A relaunch reads the same ledger, so nothing is sent twice in a day.
  const second = createRitualLedger(directory);
  assert.deepEqual(second.get(), expected);
  const s = createInitialState();
  s.settings.planAt = '09:00';
  s.settings.reviewAt = '18:00';
  assert.deepEqual(
    nextReminder(s, at('2026-10-26T20:00:00'), second.get()),
    none,
  );
  fs.writeFileSync(path.join(directory, 'rituals.json'), '{not json');
  assert.deepEqual(createRitualLedger(directory).get(), emptyLedger());
  assert.deepEqual(
    normalizeLedger({ sent: { plan: 5, review: '2026-10-26' }, done: null }),
    {
      sent: { plan: '', review: '2026-10-26' },
      done: { plan: '', review: '' },
    },
  );
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
