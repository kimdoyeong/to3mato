import { get, writable } from 'svelte/store';
import { localDate } from './domain.mjs';
const key = 'to3mato-rituals-v1';
type Dates = { plannedDate: string; reviewedDate: string };
function read(): Dates {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      plannedDate:
        typeof data?.plannedDate === 'string' ? data.plannedDate : '',
      reviewedDate:
        typeof data?.reviewedDate === 'string' ? data.reviewedDate : '',
    };
  } catch {
    return { plannedDate: '', reviewedDate: '' };
  }
}
export const ritualDates = writable<Dates>(read());
export const planOpen = writable(false);
export function finishRitual(kind: 'plan' | 'review', date = localDate()) {
  const dates = {
    ...get(ritualDates),
    [kind === 'plan' ? 'plannedDate' : 'reviewedDate']: date,
  };
  ritualDates.set(dates);
  // Ritual visibility must still work when browser storage is unavailable.
  try {
    localStorage.setItem(key, JSON.stringify(dates));
  } catch {}
  if (kind === 'plan') planOpen.set(false);
}
