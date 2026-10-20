/** @typedef {import('./types').AppState} AppState */
export const MAX_TASK_ESTIMATE = 6;
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function offsetDate(offset, base = localDate()) {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  return localDate(d);
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
    settings: { focus: 1500, rest: 300, trayDisplay: 'clock' },
    projects: [
      { id: 'p1', name: '사이드 프로젝트', icon: 'folder', color: '#d08c6f' },
      { id: 'p2', name: '디자인 학습', icon: 'book', color: '#84956c' },
      { id: 'p3', name: '독서', icon: 'leaf', color: '#b49b65' },
    ],
    tasks: [
      {
        id: 't1',
        title: '프로젝트 아이디어 정리',
        estimate: 2,
        project: 'p1',
        date,
        done: false,
      },
      {
        id: 't2',
        title: '디자인 강의 수강',
        estimate: 2,
        project: 'p2',
        date,
        done: false,
      },
      {
        id: 't3',
        title: '도서 읽기',
        estimate: 1,
        project: 'p3',
        date,
        done: false,
      },
      {
        id: 't4',
        title: '첫 화면 참고 자료 조사',
        estimate: 2,
        project: 'p1',
        date: offsetDate(1, date),
        done: false,
      },
      {
        id: 't5',
        title: '주간 할 일 정리',
        estimate: 1,
        project: '',
        date: '',
        done: false,
      },
    ],
    records: [],
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
function validDate(value) {
  if (value === '') return '';
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    localDate(new Date(value + 'T12:00:00')) !== value
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
  const estimate = number(raw.estimate, 1, 48);
  if (!Number.isInteger(estimate))
    throw new Error('예상 포모도로는 정수로 입력하세요.');
  const date = validDate(raw.date);
  const project = raw.project ? text(raw.project) : '';
  return { title, estimate, date, project };
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
    position: position(raw.position),
  };
}
/** @returns {import('./types').Task & { position: number }} */
export function validateTaskRow(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('지원하지 않는 데이터 형식입니다.');
  return {
    id: text(raw.id),
    ...taskValues(raw),
    done: raw.done === true,
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
  let timer = null;
  if (raw.timer) {
    const t = raw.timer;
    if (!['focus', 'rest'].includes(t.phase))
      throw new Error('타이머 상태가 올바르지 않습니다.');
    if (
      t.phase === 'focus' &&
      !tasks.some((task) => task.id === t.taskId && !task.done)
    )
      throw new Error('실행 중인 작업을 찾을 수 없습니다.');
    timer = {
      taskId: t.phase === 'focus' ? t.taskId : null,
      phase: t.phase,
      duration: number(t.duration, 1, 86400),
      elapsed: number(t.elapsed, 0, t.duration),
      startedAt: number(t.startedAt, 0, 8640000000000000),
      running: t.running === true,
    };
  }
  return { version: 1, settings, projects, tasks, records, timer };
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
export function advanceTimer(state, now = Date.now()) {
  const t = state.timer;
  if (!t?.running || elapsedSeconds(t, now) < t.duration) return false;
  const phase = t.phase;
  settleTimer(state, now);
  if (phase === 'focus')
    state.timer = {
      taskId: null,
      phase: 'rest',
      duration: state.settings.rest,
      elapsed: 0,
      startedAt: now,
      running: true,
    };
  return true;
}
/** @param {AppState} input @param {{type:string,payload?:Record<string,any>}} command @returns {AppState} */
export function applyCommand(input, command, now = Date.now()) {
  if (!command || typeof command.type !== 'string')
    throw new Error('잘못된 요청입니다.');
  const state = structuredClone(input),
    p = command.payload || {};
  advanceTimer(state, now);
  switch (command.type) {
    case 'task:save': {
      const existing = state.tasks.find((t) => t.id === p.id);
      const fields = taskFields(p, state.projects, existing?.estimate);
      if (p.id) {
        const task = state.tasks.find((t) => t.id === p.id);
        if (!task) throw new Error('할 일을 찾을 수 없습니다.');
        Object.assign(task, fields);
      } else
        state.tasks.push({ id: crypto.randomUUID(), ...fields, done: false });
      break;
    }
    case 'task:batch': {
      if (
        typeof p.project !== 'string' ||
        !state.projects.some((project) => project.id === p.project)
      )
        throw new Error('프로젝트를 찾을 수 없습니다.');
      if (
        !Array.isArray(p.tasks) ||
        p.tasks.length < 1 ||
        p.tasks.length > 500 ||
        state.tasks.length + p.tasks.length > 20000
      )
        throw new Error(
          '한 번에 1~500개의 할 일을 추가할 수 있습니다. 전체 한도는 20,000개입니다.',
        );
      // Validate the entire batch before allocating IDs or changing any tasks.
      const fields = p.tasks.map((task) =>
        taskFields({ ...task, project: p.project }, state.projects),
      );
      state.tasks.push(
        ...fields.map((task) => ({
          id: crypto.randomUUID(),
          ...task,
          done: false,
        })),
      );
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
      if (!task.done && state.timer?.taskId === p.id) settleTimer(state, now);
      task.done = !task.done;
      break;
    }
    case 'task:move': {
      const task = state.tasks.find((t) => t.id === p.id);
      if (!task) throw new Error('할 일을 찾을 수 없습니다.');
      task.date = validDate(p.date);
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
      } else
        state.projects.push({
          id: crypto.randomUUID(),
          name,
          icon: 'folder',
          color: '#84956c',
        });
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
      if (!t) break;
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
    case 'settings:save': {
      const focus = p.focus ?? state.settings.focus,
        rest = p.rest ?? state.settings.rest;
      state.settings = validateSettings({
        focus,
        rest,
        trayDisplay: Object.hasOwn(p, 'trayDisplay')
          ? p.trayDisplay
          : state.settings.trayDisplay,
      });
      break;
    }
    default:
      throw new Error('지원하지 않는 작업입니다.');
  }
  return state;
}
/** @param {import('./types').Task[]} tasks */
export function getTodoSections(tasks, today = localDate()) {
  const tomorrow = offsetDate(1, today),
    upcoming = [
      ...new Set([
        ...Array.from({ length: 7 }, (_, i) => offsetDate(i, today)),
        ...tasks.map((t) => t.date).filter((d) => d >= today),
      ]),
    ].sort(),
    past = [...new Set(tasks.map((t) => t.date).filter((d) => d && d < today))]
      .sort()
      .reverse();
  return ['', ...upcoming, ...past].map((date) => ({
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
  const rest = timer?.phase === 'rest';
  const next = state.tasks.find(
    (task) => task.date === localDate(new Date(now)) && !task.done,
  );
  const status = !timer
    ? '집중 대기'
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
      : rest
        ? '휴식 시작'
        : timer
          ? '집중 재개'
          : '집중 시작',
    primaryEnabled: !!timer || !!next,
    end: rest ? '휴식 종료' : '집중 종료',
    endEnabled: !!timer,
    command: timer
      ? { type: 'timer:toggle' }
      : next
        ? { type: 'timer:play', payload: { id: next.id } }
        : null,
  };
}
