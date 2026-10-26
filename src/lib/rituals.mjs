import { localDate, offsetDate } from './domain.mjs';
import { calendarTimeZone } from './calendar-time.mjs';

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
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: calendarTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const day = localDate(date);
  return (
    !!settings.planAt &&
    settings.remindDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay()) &&
    time >= settings.planAt &&
    plannedDate !== day
  );
}
