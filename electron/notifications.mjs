import { elapsedSeconds } from '../src/lib/domain.mjs';

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
    body: task
      ? `${task.title} · 1포모도로 완료. 휴식 시간입니다`
      : '1포모도로 완료. 휴식 시간입니다',
  };
}

export function startedTimerNotification(previous, next, now = Date.now()) {
  const timer = next.timer;
  if (!timer?.running) return null;
  const before = previous.timer;
  // Focus completion already announces the automatically started rest.
  if (
    before?.running &&
    before.phase === 'focus' &&
    timer.phase === 'rest' &&
    elapsedSeconds(before, now) >= before.duration
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

export function createTimerNotifications({
  Notification,
  getWindow,
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
        notification = new Notification({ ...content, icon, silent: false });
        active.add(notification);
        notification.once('click', () => {
          active.delete(notification);
          const window = getWindow();
          if (!window || window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
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
