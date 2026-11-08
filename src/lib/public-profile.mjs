// Public profile: the snapshot the app uploads and the HTML both the app preview
// and the me.to3mato.com Worker render from it. No DOM, Node or Electron APIs here.
import { dateInZone, shiftDay } from './calendar-time.mjs';

export const PROFILE_ORIGIN = 'https://me.to3mato.com';
export const VISIBILITY_KEYS = ['video', 'focus', 'projects', 'tasks', 'memo'];
/** @type {Readonly<import('./types').Visibility>} */
export const DEFAULT_VISIBILITY = Object.freeze(
  /** @type {any} */ (Object.fromEntries(VISIBILITY_KEYS.map((key) => [key, false]))),
);
export const MAX_NAME = 20;
export const GRASS_WEEKS = 20;
const DAYS = 140;
const GRADIENTS = 6;

export const profileUrl = (slug) => `${PROFILE_ORIGIN}/${slug}`;

/** @returns {import('./types').Visibility} */
export function normalizeVisibility(raw) {
  return /** @type {any} */ (Object.fromEntries(
    VISIBILITY_KEYS.map((key) => [key, raw?.[key] === true]),
  ));
}
/** Trims and checks a display name. Returns '' when it cannot be used. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...value].length <= MAX_NAME ? value : '';
}

const round1 = (value) => Math.round(value * 10) / 10;
const cut = (value, max) =>
  [...String(value || '').trim()].slice(0, max).join('');
const color = (value) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#9ba580');

/**
 * Builds the upload. Common sections are always present; the others only when
 * their switch is on, so turned-off data never leaves the device.
 * @param {{ state: import('./types').AppState, visibility: Record<string, boolean>,
 *   now?: Date, timeZone: string, video?: { path: string, weekStart: string } | null }} input
 */
export function buildSnapshot({
  state,
  visibility,
  now = new Date(),
  timeZone,
  video = null,
}) {
  const on = normalizeVisibility(visibility);
  const today = dateInZone(now, timeZone);
  const first = shiftDay(today, -(DAYS - 1));
  const dayIndex = (at) => {
    const day = dateInZone(new Date(at), timeZone);
    if (day < first || day > today) return -1;
    let index = 0,
      cursor = first;
    // Dates are ISO strings; walk at most 140 steps.
    while (cursor < day && index < DAYS) {
      cursor = shiftDay(cursor, 1);
      index++;
    }
    return index;
  };
  const days = new Array(DAYS).fill(0);
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const projects = new Map(
    state.projects.map((project) => [project.id, project]),
  );
  const perProject = new Map();
  let focusSeconds = 0;
  for (const record of state.records) {
    const index = dayIndex(record.at);
    if (index < 0) continue;
    days[index] += record.pomodoros;
    if (index === DAYS - 1) focusSeconds += record.seconds;
    const projectId = tasks.get(record.taskId)?.project;
    if (projectId && projects.has(projectId))
      perProject.set(
        projectId,
        (perProject.get(projectId) || 0) + record.pomodoros,
      );
  }
  const snapshot = {
    v: 1,
    date: today,
    timeZone,
    days: days.map((value) => Math.min(500, round1(value))),
    today: Math.min(500, round1(days[DAYS - 1])),
  };
  if (on.focus) snapshot.focusSeconds = Math.min(86400, Math.round(focusSeconds));
  if (on.projects)
    snapshot.projects = [...perProject]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, count]) => ({
        name: cut(projects.get(id).name, 80) || '-',
        color: color(projects.get(id).color),
        count: round1(count),
      }));
  if (on.tasks)
    snapshot.tasks = state.tickets
      .filter(
        (ticket) =>
          !ticket.voided &&
          dateInZone(new Date(ticket.completedAt), timeZone) === today &&
          cut(ticket.title, 120),
      )
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, 30)
      .map((ticket) => {
        const item = {
          title: cut(ticket.title, 120),
          used: Math.min(100, round1(ticket.used)),
          estimate: Math.min(100, round1(ticket.estimate)),
          at: ticket.completedAt,
        };
        const project = projects.get(ticket.projectId);
        if (on.projects && project)
          item.project = {
            name: cut(project.name, 80) || '-',
            color: color(project.color),
          };
        if (on.memo && cut(ticket.note, 500))
          item.note = cut(ticket.note, 500);
        return item;
      });
  if (on.video && video) snapshot.video = { ...video };
  return snapshot;
}

/** Monday of the week before the one containing `day`: the week the latest delivery covers. */
export function lastWeekStart(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7) - 7);
}

/**
 * Moves a stored snapshot to the visitor's "now" in the owner's time zone.
 * A snapshot from an earlier day still shows its history, with today at zero.
 */
export function alignSnapshot(snapshot, now = new Date()) {
  const timeZone = snapshot.timeZone || 'UTC';
  let today;
  try {
    today = dateInZone(now, timeZone);
  } catch {
    today = dateInZone(now, 'UTC');
  }
  let gap = 0,
    cursor = snapshot.date;
  while (cursor < today && gap <= DAYS) {
    cursor = shiftDay(cursor, 1);
    gap++;
  }
  const source = Array.isArray(snapshot.days) ? snapshot.days : [];
  const padded = [...new Array(DAYS - source.length).fill(0), ...source];
  const days = [...padded, ...new Array(gap).fill(0)].slice(-DAYS);
  const fresh = gap === 0;
  return {
    today,
    days,
    count: fresh ? Number(snapshot.today) || 0 : 0,
    focusSeconds:
      snapshot.focusSeconds === undefined
        ? undefined
        : fresh
          ? snapshot.focusSeconds
          : 0,
    projects: snapshot.projects,
    tasks: snapshot.tasks ? (fresh ? snapshot.tasks : []) : undefined,
    video:
      snapshot.video && snapshot.video.weekStart >= lastWeekStart(today)
        ? snapshot.video
        : null,
  };
}

/** Picks one of the six token gradients from the public profile ID. */
export function gradientIndex(slug) {
  let hash = 0x811c9dc5;
  for (const char of String(slug)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % GRADIENTS;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
}
const level = (n) => (n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4);
const formatCount = (n) => String(round1(n));
export function formatFocus(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}분`;
  return minutes % 60 ? `${hours}시간 ${minutes % 60}분` : `${hours}시간`;
}
const TOMATO_PATHS =
  '<path class="body" d="M12 7C7 4.5 2 8 2.5 13.5 3 18.5 7 22 12 22s9-3.5 9.5-8.5C22 8 17 4.5 12 7Z"/><path class="calyx" d="m12 8.5-4.4-.4 2-2-2.8-1.2 3-.4.4-2.2L12 4l1.8-1.7.4 2.2 3 .4-2.8 1.2 2 2Z"/>';
const tomato = (variant = 'filled') =>
  `<svg class="mini-tomato tomato ${variant}" viewBox="0 0 24 24" aria-hidden="true">${TOMATO_PATHS}</svg>`;
const ICONS = {
  pause: '<path d="M8 5v14m8-14v14" stroke-width="3"/>',
  play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
};
export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function grassHTML(days, today) {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shiftDay(today, -weekday - (GRASS_WEEKS - 1) * 7);
  const offset = DAYS - 1 - (GRASS_WEEKS - 1) * 7 - weekday; // index of `start` in days
  let html = '';
  let lastMonth = '',
    lastLabel = -9;
  for (let week = 0; week < GRASS_WEEKS; week++) {
    const monday = shiftDay(start, week * 7);
    const month = monday.slice(5, 7);
    if (month !== lastMonth) {
      const next = shiftDay(monday, 7).slice(5, 7);
      const crowded = week === 0 && next !== month;
      if (!crowded && week - lastLabel >= 3) {
        html += `<span class="m" style="grid-column:${week + 2}">${Number(month)}월</span>`;
        lastLabel = week;
      }
      lastMonth = month;
    }
  }
  ['월', '', '수', '', '금', '', ''].forEach((label, row) => {
    if (label)
      html += `<span class="w" style="grid-row:${row + 2}">${label}</span>`;
  });
  for (let cell = 0; cell < GRASS_WEEKS * 7; cell++) {
    const day = shiftDay(start, cell);
    const column = Math.floor(cell / 7) + 2,
      row = (cell % 7) + 2;
    if (day > today) {
      html += `<span class="c future" style="grid-column:${column};grid-row:${row}" aria-hidden="true"></span>`;
      continue;
    }
    const count = days[offset + cell] || 0;
    const label = `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 ${formatCount(count)}`;
    html += `<span class="c l${level(count)}${day === today ? ' today' : ''}" style="grid-column:${column};grid-row:${row}" role="img" aria-label="${label}"></span>`;
  }
  return `<div class="grass">${html}</div><div class="grass-legend" aria-hidden="true">${[0, 1, 2, 3, 4].map((l) => `<span class="c l${l}"></span>`).join('')}</div>`;
}

function ticketHTML(task, index, timeZone) {
  const slots = Math.min(6, Math.max(task.estimate, Math.ceil(task.used)));
  const full = Math.floor(task.used);
  const stamps = Array.from({ length: slots }, (_, i) =>
    tomato(i < full ? 'filled' : i === full && task.used % 1 ? 'half' : ''),
  ).join('');
  const date = dateInZone(new Date(task.at), timeZone);
  let time = '';
  try {
    time = new Date(task.at).toLocaleTimeString('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
  } catch {
    /* unknown zone */
  }
  return `<article class="ticket ${index % 2 ? 'tilt-big-b' : 'tilt-big-a'}">
    <span class="tape l ${index % 2 ? 'green' : 'pink'}" aria-hidden="true"></span>
    <div class="stub"><span class="tomatoes">${stamps}</span><span class="num muted">${formatCount(task.used)} / ${formatCount(task.estimate)}</span></div>
    <span class="notch t"></span><span class="notch b"></span>
    <div class="ticket-body"><span class="ticket-title">${escapeHtml(task.title)}</span>
      <span class="ticket-meta">${task.project ? `<span class="chip"><i class="project-dot" style="background:${color(task.project.color)}"></i>${escapeHtml(task.project.name)}</span>` : ''}<span class="muted">${escapeHtml(time)}</span></span>
      ${task.note ? `<span class="ticket-note">${escapeHtml(task.note)}</span>` : ''}
    </div>
    <div class="datestamp" aria-hidden="true">${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}<br>완료</div>
  </article>`;
}

/**
 * HTML for the profile body. URLs are resolved by the caller: the Worker uses
 * public Storage URLs, the app preview uses local data and blob URLs.
 * @param {{ slug: string, name: string, photoUrl?: string, videoUrl?: string,
 *   snapshot: object }} profile
 */
export function renderProfile(profile, { now = new Date() } = {}) {
  const data = alignSnapshot(profile.snapshot || {}, now);
  const timeZone = profile.snapshot?.timeZone || 'UTC';
  const videoUrl = data.video ? profile.videoUrl : '';
  const cover = videoUrl
    ? `<div class="pp-cover"><video class="pp-video" src="${escapeHtml(videoUrl)}" autoplay muted loop playsinline aria-hidden="true"></video><button type="button" class="icon-button pp-pause" aria-label="영상 정지" data-label-play="영상 재생" data-label-pause="영상 정지">${icon('pause')}</button></div>`
    : `<div class="pp-cover plain g${gradientIndex(profile.slug)}" aria-hidden="true"></div>`;
  const full = Math.floor(data.count);
  const stamps =
    Array.from({ length: Math.min(12, full) }, () => tomato()).join('') +
    (data.count % 1 && full < 12 ? tomato('half') : '');
  const focus =
    data.focusSeconds === undefined
      ? ''
      : `<dl class="pp-stat"><dt>집중 시간</dt><dd>${formatFocus(data.focusSeconds)}</dd></dl>`;
  const projects = data.projects?.length
    ? `<section class="paper alt pp-projects tilt-b"><h2>프로젝트</h2><ul>${data.projects
        .map(
          (p) =>
            `<li><i class="project-dot" style="background:${color(p.color)}"></i><span class="name">${escapeHtml(p.name)}</span><span class="cnt">${tomato()}${formatCount(p.count)}</span></li>`,
        )
        .join('')}</ul></section>`
    : '';
  const tasks = data.tasks?.length
    ? `<section class="pp-tickets-wrap"><h2>완료한 할 일</h2><div class="pp-tickets">${data.tasks
        .map((task, i) => ticketHTML(task, i, timeZone))
        .join('')}</div></section>`
    : '';
  const photo = profile.photoUrl
    ? `<img class="avatar" src="${escapeHtml(profile.photoUrl)}" alt="프로필 사진">`
    : '';
  return `<div class="pp">
  ${cover}
  <div class="pp-body">
    <div class="pp-side">
      <header class="paper pp-head tilt-c"><span class="tape" aria-hidden="true"></span>${photo}<h1>${escapeHtml(profile.name)}</h1></header>
      <section class="paper peach pp-today">
        <h2>오늘 완료한 포모도로</h2>
        <p class="pp-count"><span class="big">${formatCount(data.count)}</span></p>
        <div class="tomatoes" aria-hidden="true">${stamps}</div>
        ${focus}
      </section>
    </div>
    <div class="pp-main">
      <section class="paper pp-grass" aria-label="날짜별 활동">${grassHTML(data.days, data.today)}</section>
      ${projects}
      ${tasks}
    </div>
  </div>
</div>`;
}
