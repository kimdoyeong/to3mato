// Usage analytics shared by the desktop app, the website and the public
// profile page. Events carry names, counts and enumerated values only. Titles,
// notes, project names, email addresses and file names never leave the device.
//
// The project token is public by design: PostHog accepts events with it and
// returns nothing. An empty token turns every client into a no-op.
export const POSTHOG_KEY = 'phc_vRtA3xJbYkjXQoMVQmZM8nFhEGbRjJnNBtuEpn2chJ5j';
export const POSTHOG_HOST = 'https://us.i.posthog.com';

export const SCREENS = [
  'todo',
  'projects',
  'calendar',
  'log',
  'settings',
  'review',
];

/**
 * Events the renderer may report, with the values each property accepts.
 * Anything else is dropped in the main process.
 */
export const RENDERER_EVENTS = {
  screen_viewed: { screen: SCREENS },
};

const created = (payload) => !payload?.id;

/**
 * Maps a successfully applied command to one event. `before` is the state the
 * command was applied to.
 * @returns {{ event: string, properties: Record<string, string | number | boolean> } | null}
 */
export function commandEvent(command, before) {
  const p = command?.payload || {};
  const event = (name, properties = {}) => ({ event: name, properties });
  switch (command?.type) {
    case 'task:save':
      return created(p)
        ? event('task_created', {
            has_date: !!p.date,
            has_project: !!p.project,
            estimate: count(p.estimate),
          })
        : event('task_updated');
    case 'task:batch':
      return event('task_batch_created', {
        count: Array.isArray(p.tasks) ? p.tasks.length : 0,
        has_project: !!p.project,
      });
    case 'task:delete':
      return event('task_deleted');
    case 'task:toggle': {
      const task = before?.tasks?.find((item) => item.id === p.id);
      return event(task?.done ? 'task_reopened' : 'task_completed');
    }
    case 'task:move':
      return event('task_moved', { has_date: !!p.date });
    case 'task:reorder':
      return event('task_reordered');
    case 'project:save':
      return event(created(p) ? 'project_created' : 'project_updated');
    case 'project:delete':
      return event('project_deleted');
    case 'ticket:update':
      return event('ticket_updated', {
        note: Object.hasOwn(p, 'note'),
        highlight: Object.hasOwn(p, 'highlight'),
        sticker: Object.hasOwn(p, 'sticker'),
        clip: Object.hasOwn(p, 'clipId'),
      });
    case 'template:save':
      return event(created(p) ? 'template_created' : 'template_updated', {
        steps: Array.isArray(p.steps) ? p.steps.length : 0,
      });
    case 'template:delete':
      return event('template_deleted');
    case 'template:apply':
      return event('template_applied', {
        has_date: !!p.date,
        has_project: !!p.project,
      });
    case 'timer:play':
      return event('timer_started');
    case 'timer:toggle': {
      const timer = before?.timer;
      if (!timer || timer.phase === 'checkin') return null;
      return event(timer.running ? 'timer_paused' : 'timer_resumed', {
        phase: timer.phase === 'rest' ? 'rest' : 'focus',
      });
    }
    case 'timer:pause':
      return before?.timer?.running ? event('timer_paused') : null;
    case 'timer:end':
      return before?.timer ? event('timer_ended') : null;
    case 'checkin:save':
      return event('checkin_saved', { remaining: count(p.remaining) });
    case 'checkin:done':
      return event('checkin_done', { clip: !!p.clipId });
    case 'checkin:followup':
      return event('checkin_followup');
    case 'checkin:skip':
      return event('checkin_skipped');
    case 'settings:save':
      return event('settings_changed', {
        fields: Object.keys(p)
          .filter((key) => SETTING_FIELDS.includes(key))
          .sort()
          .join(','),
      });
    default:
      return null;
  }
}

const SETTING_FIELDS = [
  'focus',
  'rest',
  'trayDisplay',
  'dailyCapacity',
  'planAt',
  'reviewAt',
  'remindDays',
];

function count(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(999, Math.trunc(number)))
    : 0;
}

/**
 * Focus records that appeared between two states. A bulk change such as an
 * import or a first sync is not usage, so more than a few at once is ignored.
 */
export function recordEvents(previous, next) {
  const before = previous?.records || [],
    after = next?.records || [];
  if (after.length <= before.length || after.length - before.length > 3)
    return [];
  const known = new Set(before.map((record) => record.id));
  return after
    .filter((record) => !known.has(record.id))
    .map((record) => ({
      event: 'focus_recorded',
      properties: {
        pomodoros: count(record.pomodoros),
        minutes: count(record.duration / 60),
        completed: record.seconds >= record.duration,
      },
    }));
}

/** Keeps only the allowlisted event and its enumerated property values. */
export function rendererEvent(name, properties) {
  if (typeof name !== 'string' || !Object.hasOwn(RENDERER_EVENTS, name))
    return null;
  const allowed = RENDERER_EVENTS[name];
  const clean = {};
  for (const [key, values] of Object.entries(allowed)) {
    const value = properties?.[key];
    if (!values.includes(value)) return null;
    clean[key] = value;
  }
  return { event: name, properties: clean };
}
