import { get, writable } from 'svelte/store';
import { localDate } from './domain.mjs';
const key = 'to3mato-rituals-v1';
type Dates = { plannedDate: string; reviewedDate: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valid = (value: unknown) =>
  typeof value === 'string' && DATE.test(value) ? value : '';
function read(): Dates {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      plannedDate: valid(data?.plannedDate),
      reviewedDate: valid(data?.reviewedDate),
    };
  } catch {
    return { plannedDate: '', reviewedDate: '' };
  }
}
function store(dates: Dates) {
  ritualDates.set(dates);
  // Ritual visibility must still work when browser storage is unavailable.
  try {
    localStorage.setItem(key, JSON.stringify(dates));
  } catch {}
}
export const ritualDates = writable<Dates>(read());
export const planOpen = writable(false);
// On desktop the main process keeps the dismissal dates beside the
// database, so its reminders skip a ritual already finished today. The plan
// card waits for those dates before opening on its own.
export const ritualsReady = writable(!window.to3mato);

/** Merge the main process's dates (desktop only); the later date wins. */
export async function loadRitualDates() {
  if (!window.to3mato) return;
  try {
    const remote = await window.to3mato.ritualDates();
    const local = get(ritualDates);
    const later = (a: string, b: string) => (valid(a) > valid(b) ? a : b);
    const merged = {
      plannedDate: later(local.plannedDate, remote.plannedDate),
      reviewedDate: later(local.reviewedDate, remote.reviewedDate),
    };
    store(merged);
    // Dates finished before this build only exist locally; hand them over.
    if (merged.plannedDate && merged.plannedDate !== remote.plannedDate)
      void window.to3mato.finishRitual('plan', merged.plannedDate);
    if (merged.reviewedDate && merged.reviewedDate !== remote.reviewedDate)
      void window.to3mato.finishRitual('review', merged.reviewedDate);
  } catch {
    // Without the main process dates the local ones still apply.
  } finally {
    ritualsReady.set(true);
  }
}

export function finishRitual(kind: 'plan' | 'review', date = localDate()) {
  store({
    ...get(ritualDates),
    [kind === 'plan' ? 'plannedDate' : 'reviewedDate']: date,
  });
  if (kind === 'plan') planOpen.set(false);
  window.to3mato?.finishRitual(kind, date).catch(() => {});
}
