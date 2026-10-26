import { localDate, offsetDate } from './domain.mjs';

/** Average of the seven completed local calendar days preceding today. */
export function sevenDayAverage(records, today = localDate()) {
  const first = offsetDate(-7, today);
  const sum = records.reduce((total, record) => {
    const date = localDate(new Date(record.at));
    return date >= first && date < today ? total + record.pomodoros : total;
  }, 0);
  return Math.round(sum / 7);
}

/** The plan card opens on its own under the same rule as its reminder. */
export function planIsDue(settings, now, plannedDate) {
  const date = new Date(now);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return (
    !!settings.planAt &&
    settings.remindDays.includes(date.getDay()) &&
    time >= settings.planAt &&
    plannedDate !== localDate(date)
  );
}
