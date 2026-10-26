import fs from 'node:fs';
import path from 'node:path';

// Per-day ritual bookkeeping kept beside the database, outside sync:
// `sent` is the last day a reminder was shown, `done` the last day the user
// finished the plan card or the review. Both survive restarts so a relaunch
// never repeats a reminder and the main process knows what was dismissed.
const KINDS = ['plan', 'review'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isRitualKind = (kind) => KINDS.includes(kind);
export const isRitualDate = (date) =>
  typeof date === 'string' && DATE.test(date);

export function emptyLedger() {
  return { sent: { plan: '', review: '' }, done: { plan: '', review: '' } };
}
export function normalizeLedger(raw) {
  const ledger = emptyLedger();
  for (const group of ['sent', 'done'])
    for (const kind of KINDS) {
      const value = raw?.[group]?.[kind];
      if (isRitualDate(value)) ledger[group][kind] = value;
    }
  return ledger;
}

export function createRitualLedger(directory) {
  const file = path.join(directory, 'rituals.json');
  let ledger = emptyLedger();
  try {
    ledger = normalizeLedger(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // Missing or unreadable bookkeeping only means reminders may show once.
  }
  const save = () => {
    const temporary = file + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) {
      console.warn('Ritual ledger save failed:', error);
    }
  };
  return {
    get: () => structuredClone(ledger),
    /** Record that reminders of these kinds were handled today. */
    markSent(kinds, date) {
      for (const kind of kinds)
        if (isRitualKind(kind)) ledger.sent[kind] = date;
      save();
    },
    /** Record that the user finished a ritual; later dates win. */
    markDone(kind, date) {
      if (!isRitualKind(kind) || !isRitualDate(date)) return false;
      if (date > ledger.done[kind]) {
        ledger.done[kind] = date;
        save();
      }
      return true;
    },
  };
}
