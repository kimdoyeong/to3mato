import { localDate, usedPomodoros } from './domain.mjs';

/** @typedef {import('./types').AppState} AppState */
/** @typedef {import('./types').Ticket} Ticket */

/**
 * Numbers shown on a project cover and the diary header.
 * @param {AppState} state
 * @param {string} projectId
 */
export function projectSummary(state, projectId) {
  const tasks = state.tasks.filter((t) => t.project === projectId);
  const open = tasks.filter((t) => !t.done);
  const used = tasks.reduce((sum, t) => sum + usedPomodoros(state, t.id), 0);
  const remaining = open.reduce((sum, t) => sum + t.remaining, 0);
  const tickets = state.tickets.filter(
    (t) => t.projectId === projectId && !t.voided,
  );
  return {
    tickets: tickets.length,
    left: open.length,
    used,
    remaining,
    progress: used + remaining ? used / (used + remaining) : 0,
    recent: tickets.slice(-2).reverse(),
  };
}

/** Local Monday 00:00 of the week holding `at`. */
function weekStart(at) {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
const short = (date) =>
  date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

/**
 * Group tickets by week, newest week and newest ticket first. The week id
 * is the Monday's date, which is also the weekly delivery id.
 * @param {Ticket[]} tickets
 */
export function ticketWeeks(tickets) {
  const weeks = new Map();
  for (const ticket of [...tickets].sort(
    (a, b) => b.completedAt - a.completedAt,
  )) {
    const start = weekStart(ticket.completedAt);
    const id = localDate(start);
    let week = weeks.get(id);
    if (!week) {
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const last = new Date(end.getTime() - 1);
      week = {
        id,
        start,
        end,
        label: `${short(start)} ~ ${short(last)}`,
        tickets: [],
      };
      weeks.set(id, week);
    }
    week.tickets.push(ticket);
  }
  return [...weeks.values()];
}

/**
 * The id of the latest 3-second clip recorded for the ticket's task before
 * it was completed, or '' when none matches. Clip ids are `${taskId}:${at}`.
 * @param {{ taskId: string; completedAt: number }} ticket
 * @param {Iterable<string>} clipIds
 */
export function clipIdFor(ticket, clipIds) {
  let best = '';
  let bestAt = -1;
  for (const id of clipIds) {
    const separator = id.lastIndexOf(':');
    if (separator < 0) continue;
    const taskId = id.slice(0, separator);
    const time = Number(id.slice(separator + 1));
    if (taskId !== ticket.taskId || !(time <= ticket.completedAt)) continue;
    if (time > bestAt) {
      best = id;
      bestAt = time;
    }
  }
  return best;
}
