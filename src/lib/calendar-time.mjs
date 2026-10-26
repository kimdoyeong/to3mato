let zone;
export function setCalendarTimeZone(value) {
  if (value) new Intl.DateTimeFormat('en', { timeZone: value }).format();
  zone = value || undefined;
}
export const calendarTimeZone = () => zone;
export function dateInZone(date = new Date(), timeZone = zone) {
  if (!timeZone)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function atCalendarTime(day, hour = 0, minute = 0, timeZone = zone) {
  if (!timeZone)
    return new Date(
      `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
    );
  const desired = Date.parse(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
  let instant = desired;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    );
    const local = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const correction = desired - local;
    instant += correction;
    if (!correction) break;
  }
  return new Date(instant);
}
export function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateInZone(date, 'UTC');
}
export function calendarWeek(offset = 0, now = new Date()) {
  const day = dateInZone(now),
    weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(day, -((weekday + 6) % 7) + offset * 7);
  return {
    start: atCalendarTime(monday),
    end: atCalendarTime(shiftDay(monday, 7)),
  };
}
