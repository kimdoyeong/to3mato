/** @typedef {import('./types').AppState} AppState */
import { dateInZone, shiftDay } from './calendar-time.mjs';
export const MAX_TASK_ESTIMATE = 2;
export const MAX_LEGACY_ESTIMATE = 48;
export const TICKET_STICKERS = ['', 'star', 'heart', 'leaf'];
export const DEFAULT_REMIND_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_DAILY_CAPACITY = 8;
export const MAX_TEMPLATE_STEPS = 20;
export const MAX_TEMPLATES = 500;
export const localDate = dateInZone;
export function offsetDate(offset, base = localDate()) {
  return shiftDay(base, offset);
}
export function dateLabel(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}
/** @returns {AppState} */
export function createInitialState(date = localDate()) {
  return {
    version: 1,
    settings: {
      focus: 1500,
      rest: 300,
      trayDisplay: 'clock',
      dailyCapacity: DEFAULT_DAILY_CAPACITY,
      planAt: '',
      reviewAt: '',
      remindDays: [...DEFAULT_REMIND_DAYS],
    },
    projects: [
      {
        id: 'p1',
        name: '사이드 프로젝트',
        icon: 'folder',
        color: '#d08c6f',
        outcome: '',
        image: '',
      },
      {
        id: 'p2',
        name: '디자인 학습',
        icon: 'book',
        color: '#84956c',
        outcome: '',
        image: '',
      },
      {
        id: 'p3',
        name: '독서',
        icon: 'leaf',
        color: '#b49b65',
        outcome: '',
        image: '',
      },
    ],
    tasks: [
      {
        id: 't1',
        title: '프로젝트 아이디어 정리',
        estimate: 2,
        remaining: 2,
        followUpOf: '',
        project: 'p1',
        date,
        done: false,
      },
      {
        id: 't2',
        title: '디자인 강의 수강',
        estimate: 2,
        remaining: 2,
        followUpOf: '',
        project: 'p2',
        date,
        done: false,
      },
      {
        id: 't3',
        title: '도서 읽기',
        estimate: 1,
        remaining: 1,
        followUpOf: '',
        project: 'p3',
        date,
        done: false,
      },
      {
        id: 't4',
        title: '첫 화면 참고 자료 조사',
        estimate: 2,
        remaining: 2,
        followUpOf: '',
        project: 'p1',
        date: offsetDate(1, date),
        done: false,
      },
      {
        id: 't5',
        title: '주간 할 일 정리',
        estimate: 1,
        remaining: 1,
        followUpOf: '',
        project: '',
        date: '',
        done: false,
      },
    ],
    records: [],
    tickets: [],
    templates: [],
    timer: null,
  };
}
function text(value, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('입력 내용을 확인하세요.');
  return value.trim();
}
function number(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error('숫자 범위를 확인하세요.');
  return value;
}
function optionalText(value, max = 120) {
  if (value === undefined || value === null || value === '') return '';
  return text(value, max);
}
function integer(value, min, max) {
  const result = number(value, min, max);
  if (!Number.isInteger(result)) throw new Error('숫자 범위를 확인하세요.');
  return result;
}
function validTime(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('시간 형식이 올바르지 않습니다.');
  return value;
}
function weekdays(value) {
  if (value === undefined || value === null) return [...DEFAULT_REMIND_DAYS];
  if (
    !Array.isArray(value) ||
    value.length > 7 ||
    value.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new Error('요일 선택을 확인하세요.');
  return [...new Set(value)].sort((a, b) => a - b);
}
function imageName(value) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9_-]{1,100}\.(png|jpe?g|webp|gif)$/.test(value)
    ? value
    : '';
}
function validDate(value) {
  if (value === '') return '';
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    localDate(new Date(value + 'T12:00:00Z'), 'UTC') !== value
  )
    throw new Error('날짜 형식이 올바르지 않습니다.');
  return value;
}
function taskFields(raw, projects, existingEstimate = null) {
  const { title, estimate, date, project } = taskValues(raw);
  // Older tasks may keep their original estimate when editing other fields.
  if (estimate !== existingEstimate) number(estimate, 1, MAX_TASK_ESTIMATE);
  if (project && !projects.some((p) => p.id === project))
    throw new Error('프로젝트를 찾을 수 없습니다.');
  return { title, estimate, date, project };
}
function taskValues(raw) {
  const title = text(raw.title);
  const estimate = number(raw.estimate, 1, MAX_LEGACY_ESTIMATE);
  if (!Number.isInteger(estimate))
    throw new Error('예상 포모도로는 정수로 입력하세요.');
  const date = validDate(raw.date);
  const project = raw.project ? text(raw.project) : '';
  return { title, estimate, date, project };
}
function remainingValue(value, estimate) {
  return value === undefined || value === null
    ? estimate
    : integer(value, 0, MAX_LEGACY_ESTIMATE);
}
function position(value) {
  const result = number(value, 0, 100000);
  if (!Number.isInteger(result)) throw new Error('숫자 범위를 확인하세요.');
  return result;
}
// Row validators are shared with sync. Callers check references between rows.
/** @returns {import('./types').Project & { position: number }} */
export function validateProjectRow(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('지원하지 않는 데이터 형식입니다.');
  return {
    id: text(raw.id),
    name: text(raw.name, 80),
    icon: ['folder', 'book', 'leaf'].includes(raw.icon) ? raw.icon : 'folder',
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#84956c',
    outcome: optionalText(raw.outcome, 120),
    image: imageName(raw.image),
    position: position(raw.position),
  };
}
/** @returns {import('./types').Task & { position: number }} */
export function validateTaskRow(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('지원하지 않는 데이터 형식입니다.');
  const values = taskValues(raw);
  return {
    id: text(raw.id),
    ...values,
    remaining: remainingValue(raw.remaining, values.estimate),
    followUpOf: optionalText(raw.followUpOf, 120),
    done: raw.done === true,
    position: position(raw.position),
  };
}
// Tickets are issued when a task is completed. They are history, like records.
/** @returns {import('./types').Ticket} */
export function validateTicketRow(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('지원하지 않는 데이터 형식입니다.');
  return {
    id: text(raw.id),
    taskId: text(raw.taskId),
    title: text(raw.title, 120),
    projectId: optionalText(raw.projectId, 120),
    completedAt: number(raw.completedAt, 0, 8640000000000000),
    estimate: integer(raw.estimate, 1, MAX_LEGACY_ESTIMATE),
    used: number(raw.used, 0, 100000),
    clipId: optionalText(raw.clipId, 160),
    note: optionalText(raw.note, 200),
    highlight: raw.highlight === true,
    sticker: TICKET_STICKERS.includes(raw.sticker) ? raw.sticker : '',
    voided: raw.voided === true,
  };
}
function templateSteps(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_TEMPLATE_STEPS
  )
    throw new Error(`템플릿 단계는 1~${MAX_TEMPLATE_STEPS}개여야 합니다.`);
  return value.map((step) => {
    if (!step || typeof step !== 'object')
      throw new Error('입력 내용을 확인하세요.');
    return {
      title: text(step.title, 120),
      estimate: integer(step.estimate, 1, MAX_TASK_ESTIMATE),
    };
  });
}
/** @returns {import('./types').Template & { position: number }} */
export function validateTemplateRow(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('지원하지 않는 데이터 형식입니다.');
  return {
    id: text(raw.id),
    name: text(raw.name, 80),
    steps: templateSteps(raw.steps),
    position: position(raw.position),
  };
}
// Records have no position. They are ordered by time so devices never conflict.
/** @returns {import('./types').FocusRecord} */
export function validateRecordRow(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('지원하지 않는 데이터 형식입니다.');
  return {
    id: text(raw.id),
    taskId: text(raw.taskId),
    seconds: number(raw.seconds, 0, 86400),
    pomodoros: number(raw.pomodoros, 0, 1),
    duration: number(raw.duration, 1, 86400),
    at: number(raw.at, 0, 8640000000000000),
  };
}
/** @returns {AppState['settings']} */
export function validateSettings(raw) {
  return {
    focus: number(raw?.focus, 1, 86400),
    rest: number(raw?.rest, 1, 86400),
    trayDisplay: ['clock', 'bar', 'ring', 'hourglass'].includes(
      raw?.trayDisplay,
    )
      ? raw.trayDisplay
      : 'clock',
    dailyCapacity:
      raw?.dailyCapacity === undefined || raw?.dailyCapacity === null
        ? DEFAULT_DAILY_CAPACITY
        : integer(raw.dailyCapacity, 1, 16),
    planAt: validTime(raw?.planAt),
    reviewAt: validTime(raw?.reviewAt),
    remindDays: weekdays(raw?.remindDays),
  };
}
// FNV-1a 32-bit with two seeds. Fixed length keeps IDs within sync limits.
function fnv(value, seed) {
  let hash = seed;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
/** Deterministic ID for records saved before IDs existed. */
export function legacyRecordId(record) {
  const key = JSON.stringify([
    record.taskId,
    record.at,
    record.seconds,
    record.duration,
    record.pomodoros,
  ]);
  return `legacy-${fnv(key, 0x811c9dc5)}${fnv(key, 0x050c5d1f)}`;
}
function withoutPosition({ position: _position, ...row }) {
  return row;
}
/** Validate imports and disk state before accepting any changes. @returns {AppState} */
export function normalizeState(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.tasks) ||
    !Array.isArray(raw.projects) ||
    !Array.isArray(raw.records) ||
    raw.tasks.length > 20000 ||
    raw.records.length > 100000
  )
    throw new Error('지원하지 않는 데이터 형식입니다.');
  const settings = validateSettings(raw.settings);
  const projects = raw.projects.map((p) =>
    withoutPosition(validateProjectRow({ ...p, position: 0 })),
  );
  if (new Set(projects.map((p) => p.id)).size !== projects.length)
    throw new Error('프로젝트 ID가 중복됩니다.');
  const tasks = raw.tasks.map((t) => {
    const task = withoutPosition(validateTaskRow({ ...t, position: 0 }));
    if (task.project && !projects.some((p) => p.id === task.project))
      throw new Error('프로젝트를 찾을 수 없습니다.');
    return task;
  });
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
    throw new Error('할 일 ID가 중복됩니다.');
  const explicit = new Set();
  for (const r of raw.records) {
    if (r?.id === undefined) continue;
    const id = text(r.id);
    if (explicit.has(id)) throw new Error('집중 기록 ID가 중복됩니다.');
    explicit.add(id);
  }
  // Legacy records get stable IDs. Identical legacy rows get a numbered suffix.
  const used = new Set(explicit);
  const records = raw.records.map((r) => {
    if (!r || typeof r !== 'object')
      throw new Error('지원하지 않는 데이터 형식입니다.');
    let id = r.id;
    if (id === undefined) {
      const base = legacyRecordId(r);
      id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
    }
    return validateRecordRow({ ...r, id });
  });
  const rawTickets = raw.tickets ?? [],
    rawTemplates = raw.templates ?? [];
  if (
    !Array.isArray(rawTickets) ||
    !Array.isArray(rawTemplates) ||
    rawTickets.length > 20000 ||
    rawTemplates.length > MAX_TEMPLATES
  )
    throw new Error('지원하지 않는 데이터 형식입니다.');
  const tickets = rawTickets.map(validateTicketRow);
  if (new Set(tickets.map((t) => t.id)).size !== tickets.length)
    throw new Error('티켓 ID가 중복됩니다.');
  const templates = rawTemplates.map((t) =>
    withoutPosition(validateTemplateRow({ ...t, position: 0 })),
  );
  if (new Set(templates.map((t) => t.id)).size !== templates.length)
    throw new Error('템플릿 ID가 중복됩니다.');
  let timer = null;
  if (raw.timer) {
    const t = raw.timer;
    if (!['focus', 'checkin', 'rest'].includes(t.phase))
      throw new Error('타이머 상태가 올바르지 않습니다.');
    if (
      t.phase !== 'rest' &&
      !tasks.some((task) => task.id === t.taskId && !task.done)
    )
      throw new Error('실행 중인 작업을 찾을 수 없습니다.');
    timer = {
      taskId: t.phase === 'rest' ? null : t.taskId,
      phase: t.phase,
      duration: number(t.duration, 1, 86400),
      elapsed: number(t.elapsed, 0, t.duration),
      startedAt: number(t.startedAt, 0, 8640000000000000),
      // A check-in waits for the user and never runs down.
      running: t.phase === 'checkin' ? false : t.running === true,
    };
  }
  return {
    version: 1,
    settings,
    projects,
    tasks,
    records,
    tickets,
    templates,
    timer,
  };
}
export const roundedPomodoros = (elapsed, duration) =>
  Math.min(1, Math.max(0, Math.floor((elapsed / duration) * 2 + 0.5) / 2));
export const elapsedSeconds = (timer, now = Date.now()) =>
  Math.min(
    timer.duration,
    Math.max(
      0,
      timer.elapsed +
        (timer.running ? Math.max(0, now - timer.startedAt) / 1000 : 0),
    ),
  );
export function settleTimer(state, now = Date.now()) {
  const t = state.timer;
  if (!t) return null;
  const seconds = elapsedSeconds(t, now);
  let record = null;
  if (t.phase === 'focus' && t.taskId && seconds > 0) {
    record = {
      id: crypto.randomUUID(),
      taskId: t.taskId,
      seconds,
      pomodoros: roundedPomodoros(seconds, t.duration),
      duration: t.duration,
      at: now,
    };
    state.records.push(record);
  }
  state.timer = null;
  return record;
}
export function startTask(state, taskId, duration, now = Date.now()) {
  if (state.timer?.phase === 'focus' && state.timer.taskId === taskId) {
    if (!state.timer.running) {
      state.timer.startedAt = now;
      state.timer.running = true;
    }
    return null;
  }
  const record = settleTimer(state, now);
  state.timer = {
    taskId,
    duration,
    elapsed: 0,
    startedAt: now,
    running: true,
    phase: 'focus',
  };
  return record;
}
export function startRest(state, now = Date.now()) {
  state.timer = {
    taskId: null,
    phase: 'rest',
    duration: state.settings.rest,
    elapsed: 0,
    startedAt: now,
    running: true,
  };
}
/**
 * A finished focus writes its record at once and then waits in `checkin`
 * until the user saves progress, completes the task, or skips. Rest starts
 * from the check-in commands, never from the clock.
 */
export function advanceTimer(state, now = Date.now()) {
  const t = state.timer;
  if (!t?.running || elapsedSeconds(t, now) < t.duration) return false;
  const { phase, taskId, duration } = t;
  settleTimer(state, now);
  if (phase === 'focus')
    state.timer = {
      taskId,
      phase: 'checkin',
      duration,
      elapsed: duration,
      startedAt: now,
      running: false,
    };
  return true;
}
/** Sum of recorded pomodoros for one task. */
export const usedPomodoros = (state, taskId) =>
  state.records
    .filter((r) => r.taskId === taskId)
    .reduce((sum, r) => sum + r.pomodoros, 0);
function issueTicket(state, task, now, clipId = '') {
  state.tickets.push({
    id: crypto.randomUUID(),
    taskId: task.id,
    title: task.title,
    projectId: task.project,
    completedAt: now,
    estimate: task.estimate,
    used: usedPomodoros(state, task.id),
    clipId,
    note: '',
    highlight: false,
    sticker: '',
    voided: false,
  });
}
function checkinTask(state) {
  if (state.timer?.phase !== 'checkin')
    throw new Error('진척 확인 중이 아닙니다.');
  const task = state.tasks.find((t) => t.id === state.timer.taskId);
  if (!task) throw new Error('할 일을 찾을 수 없습니다.');
  return task;
}
const TASK_LIMIT_ERROR =
  '한 번에 1~500개의 할 일을 추가할 수 있습니다. 전체 한도는 20,000개입니다.';
function newTask(fields) {
  return {
    id: crypto.randomUUID(),
    ...fields,
    remaining: fields.estimate,
    followUpOf: '',
    done: false,
  };
}
/** @param {AppState} input @param {{type:string,payload?:Record<string,any>}} command @returns {AppState} */
export function applyCommand(input, command, now = Date.now(), options = {}) {
  if (!command || typeof command.type !== 'string')
    throw new Error('잘못된 요청입니다.');
  const state = structuredClone(input),
    p = command.payload || {};
  if (options.advance !== false) advanceTimer(state, now);
  switch (command.type) {
    case 'task:save': {
      const existing = state.tasks.find((t) => t.id === p.id);
      const fields = taskFields(p, state.projects, existing?.estimate);
      if (p.id) {
        const task = state.tasks.find((t) => t.id === p.id);
        if (!task) throw new Error('할 일을 찾을 수 없습니다.');
        const previousEstimate = task.estimate;
        Object.assign(task, fields);
        // The remaining estimate follows a changed estimate unless given.
        if (p.remaining !== undefined && p.remaining !== null)
          task.remaining = integer(p.remaining, 0, MAX_LEGACY_ESTIMATE);
        else if (fields.estimate !== previousEstimate)
          task.remaining = fields.estimate;
      } else state.tasks.push(newTask(fields));
      break;
    }
    case 'task:batch': {
      if (
        typeof p.project !== 'string' ||
        (p.project !== '' &&
          !state.projects.some((project) => project.id === p.project))
      )
        throw new Error('프로젝트를 찾을 수 없습니다.');
      if (
        !Array.isArray(p.tasks) ||
        p.tasks.length < 1 ||
        p.tasks.length > 500 ||
        state.tasks.length + p.tasks.length > 20000
      )
        throw new Error(TASK_LIMIT_ERROR);
      // Validate the entire batch before allocating IDs or changing any tasks.
      const fields = p.tasks.map((task) =>
        taskFields({ ...task, project: p.project }, state.projects),
      );
      state.tasks.push(...fields.map(newTask));
      break;
    }
    case 'task:delete': {
      if (!state.tasks.some((t) => t.id === p.id))
        throw new Error('할 일을 찾을 수 없습니다.');
      if (state.timer?.taskId === p.id) settleTimer(state, now);
      state.tasks = state.tasks.filter((t) => t.id !== p.id);
      break;
    }
    case 'task:toggle': {
      const task = state.tasks.find((t) => t.id === p.id);
      if (!task) throw new Error('할 일을 찾을 수 없습니다.');
      if (!task.done) {
        if (state.timer?.taskId === p.id) settleTimer(state, now);
        task.done = true;
        issueTicket(state, task, now);
      } else {
        task.done = false;
        const ticket = state.tickets
          .filter((t) => t.taskId === task.id && !t.voided)
          .at(-1);
        if (ticket) ticket.voided = true;
      }
      break;
    }
    case 'task:move': {
      const task = state.tasks.find((t) => t.id === p.id);
      if (!task) throw new Error('할 일을 찾을 수 없습니다.');
      task.date = validDate(p.date);
      break;
    }
    case 'task:reorder': {
      // Move a task directly before another one (or to the end of the list
      // when `before` is empty). Sections read tasks in array order.
      const from = state.tasks.findIndex((t) => t.id === p.id);
      if (from < 0) throw new Error('할 일을 찾을 수 없습니다.');
      if (p.before === p.id) break;
      const [task] = state.tasks.splice(from, 1);
      if (p.before) {
        const to = state.tasks.findIndex((t) => t.id === p.before);
        if (to < 0) {
          state.tasks.splice(from, 0, task);
          throw new Error('할 일을 찾을 수 없습니다.');
        }
        state.tasks.splice(to, 0, task);
      } else state.tasks.push(task);
      break;
    }
    case 'project:delete': {
      if (!state.projects.some((project) => project.id === p.id))
        throw new Error('프로젝트를 찾을 수 없습니다.');
      state.projects = state.projects.filter((project) => project.id !== p.id);
      for (const task of state.tasks)
        if (task.project === p.id) task.project = '';
      break;
    }
    case 'project:save': {
      const name = text(p.name, 80);
      if (p.id) {
        const project = state.projects.find((x) => x.id === p.id);
        if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
        project.name = name;
        if (Object.hasOwn(p, 'outcome'))
          project.outcome = optionalText(p.outcome, 120);
        if (Object.hasOwn(p, 'image')) project.image = imageName(p.image);
      } else
        state.projects.push({
          id: crypto.randomUUID(),
          name,
          icon: 'folder',
          color: '#84956c',
          outcome: optionalText(p.outcome, 120),
          image: imageName(p.image),
        });
      break;
    }
    case 'ticket:update': {
      const ticket = state.tickets.find((t) => t.id === p.id);
      if (!ticket) throw new Error('티켓을 찾을 수 없습니다.');
      if (Object.hasOwn(p, 'note')) ticket.note = optionalText(p.note, 200);
      if (Object.hasOwn(p, 'highlight'))
        ticket.highlight = p.highlight === true;
      if (Object.hasOwn(p, 'sticker')) {
        if (!TICKET_STICKERS.includes(p.sticker))
          throw new Error('입력 내용을 확인하세요.');
        ticket.sticker = p.sticker;
      }
      if (Object.hasOwn(p, 'clipId'))
        ticket.clipId = optionalText(p.clipId, 160);
      break;
    }
    case 'template:save': {
      const row = validateTemplateRow({
        id: p.id || 'new',
        name: p.name,
        steps: p.steps,
        position: 0,
      });
      if (p.id) {
        const template = state.templates.find((t) => t.id === p.id);
        if (!template) throw new Error('템플릿을 찾을 수 없습니다.');
        template.name = row.name;
        template.steps = row.steps;
      } else {
        if (state.templates.length >= MAX_TEMPLATES)
          throw new Error(
            `템플릿은 ${MAX_TEMPLATES}개까지 저장할 수 있습니다.`,
          );
        state.templates.push({
          id: crypto.randomUUID(),
          name: row.name,
          steps: row.steps,
        });
      }
      break;
    }
    case 'template:delete': {
      if (!state.templates.some((t) => t.id === p.id))
        throw new Error('템플릿을 찾을 수 없습니다.');
      state.templates = state.templates.filter((t) => t.id !== p.id);
      break;
    }
    case 'template:apply': {
      // One round of the template becomes tasks on the given date at once.
      const template = state.templates.find((t) => t.id === p.id);
      if (!template) throw new Error('템플릿을 찾을 수 없습니다.');
      const date = validDate(p.date ?? '');
      const project = p.project ? text(p.project) : '';
      if (project && !state.projects.some((x) => x.id === project))
        throw new Error('프로젝트를 찾을 수 없습니다.');
      if (state.tasks.length + template.steps.length > 20000)
        throw new Error(TASK_LIMIT_ERROR);
      state.tasks.push(
        ...template.steps.map((step) =>
          newTask({
            title: step.title.replaceAll('%n%', '1'),
            estimate: step.estimate,
            date,
            project,
          }),
        ),
      );
      break;
    }
    case 'timer:play': {
      const task = state.tasks.find((t) => t.id === p.id && !t.done);
      if (!task) throw new Error('실행할 할 일을 찾을 수 없습니다.');
      startTask(state, task.id, state.settings.focus, now);
      break;
    }
    case 'timer:toggle': {
      const t = state.timer;
      if (!t || t.phase === 'checkin') break;
      if (t.running) {
        t.elapsed = elapsedSeconds(t, now);
        t.running = false;
      } else {
        t.startedAt = now;
        t.running = true;
      }
      break;
    }
    case 'timer:pause': {
      const t = state.timer;
      if (t?.running) {
        t.elapsed = elapsedSeconds(t, now);
        t.running = false;
      }
      break;
    }
    case 'timer:end':
      settleTimer(state, now);
      break;
    case 'checkin:save': {
      const task = checkinTask(state);
      task.remaining = integer(p.remaining, 0, MAX_LEGACY_ESTIMATE);
      startRest(state, now);
      break;
    }
    case 'checkin:done': {
      const task = checkinTask(state);
      task.done = true;
      issueTicket(state, task, now, optionalText(p.clipId, 160));
      startRest(state, now);
      break;
    }
    case 'checkin:followup': {
      // The finished estimate stays on record; a new task carries the rest.
      const task = checkinTask(state);
      if (state.tasks.length >= 20000) throw new Error(TASK_LIMIT_ERROR);
      const title =
        p.title === undefined || p.title === null ? task.title : text(p.title);
      const index = state.tasks.indexOf(task);
      state.tasks.splice(index + 1, 0, {
        ...newTask({
          title,
          estimate: 1,
          date: task.date,
          project: task.project,
        }),
        followUpOf: task.id,
      });
      task.remaining = 0;
      startRest(state, now);
      break;
    }
    case 'checkin:skip':
      checkinTask(state);
      startRest(state, now);
      break;
    case 'settings:save': {
      const next = { ...state.settings };
      for (const key of [
        'focus',
        'rest',
        'trayDisplay',
        'dailyCapacity',
        'planAt',
        'reviewAt',
        'remindDays',
      ])
        if (p[key] !== undefined && p[key] !== null) next[key] = p[key];
      state.settings = validateSettings(next);
      break;
    }
    default:
      throw new Error('지원하지 않는 작업입니다.');
  }
  return state;
}
/** @param {import('./types').Task[]} tasks */
export function getTodoSections(tasks, today = localDate()) {
  const tomorrow = offsetDate(1, today);
  const dated = new Set(tasks.map((t) => t.date).filter(Boolean));
  const upcoming = [...dated].filter((d) => d > tomorrow).sort();
  const past = [...dated]
    .filter((d) => d < today)
    .filter((d) => tasks.some((t) => t.date === d && !t.done))
    .sort()
    .reverse();
  return [today, tomorrow, ...upcoming, ...past, ''].map((date) => ({
    date,
    label: !date
      ? '미지정'
      : date === today
        ? '오늘'
        : date === tomorrow
          ? '내일'
          : (date.slice(0, 4) !== today.slice(0, 4)
              ? Number(date.slice(0, 4)) + '년 '
              : '') +
            Number(date.slice(5, 7)) +
            '월 ' +
            Number(date.slice(8, 10)) +
            '일',
    tasks: tasks.filter((t) => (t.date || '') === date),
  }));
}

/** @param {AppState} state */
export function timerMenuState(state, now = Date.now()) {
  const timer = state.timer;
  const remaining = Math.ceil(
    timer ? timer.duration - elapsedSeconds(timer, now) : state.settings.focus,
  );
  const clock = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const rest = timer?.phase === 'rest',
    checkin = timer?.phase === 'checkin';
  const next = state.tasks.find(
    (task) => task.date === localDate(new Date(now)) && !task.done,
  );
  const status = !timer
    ? '집중 대기'
    : checkin
      ? '진척 확인'
      : rest
        ? timer.running
          ? '휴식 중'
          : '휴식 대기'
        : timer.running
          ? '집중 중'
          : '일시정지';
  return {
    ratio: timer
      ? Math.max(0, 1 - elapsedSeconds(timer, now) / timer.duration)
      : 0,
    phase: timer?.phase ?? 'idle',
    paused: !!timer && !timer.running,
    taskTitle:
      (timer ? state.tasks.find((task) => task.id === timer.taskId) : next)
        ?.title ?? '',
    clock,
    status,
    primary: timer?.running
      ? '일시정지'
      : rest || checkin
        ? '휴식 시작'
        : timer
          ? '집중 재개'
          : '집중 시작',
    primaryEnabled: !!timer || !!next,
    end: rest ? '휴식 종료' : '집중 종료',
    endEnabled: !!timer,
    command: checkin
      ? { type: 'checkin:skip' }
      : timer
        ? { type: 'timer:toggle' }
        : next
          ? { type: 'timer:play', payload: { id: next.id } }
          : null,
  };
}
