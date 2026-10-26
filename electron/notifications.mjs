import { elapsedSeconds, localDate } from '../src/lib/domain.mjs';

// Capture the completed timer before advanceTimer/applyCommand replaces it.
export function completedTimerNotification(state, now = Date.now()) {
  const timer = state.timer;
  if (!timer?.running || elapsedSeconds(timer, now) < timer.duration)
    return null;
  if (timer.phase === 'rest')
    return {
      title: '휴식 끝',
      body: '휴식 시간이 끝났습니다. 다음 할 일을 시작하세요.',
    };
  const task = state.tasks.find((item) => item.id === timer.taskId);
  return {
    title: '집중 타이머 끝',
    body: task ? `${task.title} · 1포모도로 완료.` : '1포모도로 완료.',
  };
}

export function startedTimerNotification(previous, next, now = Date.now()) {
  const timer = next.timer;
  if (!timer?.running) return null;
  const before = previous.timer;
  // Focus completion already announced the end; the rest that follows a
  // finished focus or its check-in needs no second notice.
  if (
    timer.phase === 'rest' &&
    ((before?.running &&
      before.phase === 'focus' &&
      elapsedSeconds(before, now) >= before.duration) ||
      before?.phase === 'checkin')
  )
    return null;
  if (
    before?.running &&
    before.phase === timer.phase &&
    before.taskId === timer.taskId &&
    elapsedSeconds(before, now) < before.duration
  )
    return null;
  const task = next.tasks.find((item) => item.id === timer.taskId);
  return {
    title: timer.phase === 'rest' ? '휴식 시작' : '집중 시작',
    body: task?.title || '',
  };
}

const RITUALS = [
  ['plan', 'planAt', '계획 시작'],
  ['review', 'reviewAt', '돌아보기'],
];
/**
 * Decide this minute's ritual reminder from settings and the per-day ledger
 * ({ sent, done }), without mutating either. A reminder is due once its time
 * has passed on a selected weekday, unless it was already shown or the user
 * already finished that ritual today. When several are due at once (the app
 * was off), only the latest-scheduled one is shown and the earlier ones are
 * settled with it, so a late launch never produces a burst.
 */
export function nextReminder(state, now = Date.now(), ledger = {}) {
  const date = new Date(now);
  if (!state.settings.remindDays.includes(date.getDay()))
    return { reminder: null, settled: [] };
  const today = localDate(date);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const due = RITUALS.filter(([kind, key]) => {
    const at = state.settings[key];
    return (
      at &&
      time >= at &&
      ledger.sent?.[kind] !== today &&
      ledger.done?.[kind] !== today
    );
  }).sort((a, b) => (state.settings[a[1]] < state.settings[b[1]] ? -1 : 1));
  if (!due.length) return { reminder: null, settled: [] };
  const [kind, , title] = due.at(-1);
  return {
    reminder: { kind, title, body: '' },
    settled: due.map(([name]) => name),
  };
}

export function createTimerNotifications({
  Notification,
  getWindow,
  showMain,
  icon,
  onError = console.error,
}) {
  // Retain native objects so click callbacks continue to work after show().
  const active = new Set();
  const report = (error) => onError(error);
  return {
    show(content) {
      if (!content) return;
      let notification;
      try {
        if (!Notification.isSupported()) return;
        const { kind, ...options } = content;
        notification = new Notification({ ...options, icon, silent: false });
        active.add(notification);
        notification.once('click', () => {
          active.delete(notification);
          const window = getWindow();
          if (!window || window.isDestroyed()) return;
          if (showMain) showMain();
          else {
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
          }
          if (kind === 'plan' || kind === 'review')
            window.webContents.send('ritual:open', kind);
        });
        notification.once('close', () => active.delete(notification));
        notification.once('failed', (_event, error) => {
          active.delete(notification);
          report(error || '알림을 표시할 수 없습니다.');
        });
        notification.show();
      } catch (error) {
        if (notification) active.delete(notification);
        report(error);
      }
    },
    destroy() {
      for (const notification of active) {
        notification.removeAllListeners();
        notification.close();
      }
      active.clear();
    },
  };
}
