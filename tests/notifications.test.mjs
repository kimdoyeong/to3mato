import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createInitialState,
  applyCommand,
  advanceTimer,
} from '../src/lib/domain.mjs';
import {
  completedTimerNotification,
  startedTimerNotification,
  createTimerNotifications,
} from '../electron/notifications.mjs';

test('focus start, task switch, resume and rest start notify only on a running transition', () => {
  let state = createInitialState();
  const dispatch = (command, now) => {
    const next = applyCommand(state, command, now);
    const notice = startedTimerNotification(state, next, now);
    state = next;
    return notice;
  };
  assert.deepEqual(
    dispatch({ type: 'timer:play', payload: { id: 't1' } }, 1000),
    {
      title: '집중 시작',
      body: '프로젝트 아이디어 정리',
    },
  );
  assert.equal(
    dispatch({ type: 'timer:play', payload: { id: 't1' } }, 2000),
    null,
  );
  assert.equal(
    dispatch({ type: 'settings:save', payload: { focus: 1800 } }, 3000),
    null,
  );
  assert.equal(dispatch({ type: 'timer:toggle' }, 4000), null);
  assert.equal(dispatch({ type: 'timer:toggle' }, 5000).title, '집중 시작');
  assert.equal(dispatch({ type: 'timer:pause' }, 6000), null);
  assert.equal(
    dispatch({ type: 'timer:play', payload: { id: 't1' } }, 7000).title,
    '집중 시작',
  );
  assert.deepEqual(
    dispatch({ type: 'timer:play', payload: { id: 't2' } }, 8000),
    {
      title: '집중 시작',
      body: '디자인 강의 수강',
    },
  );
  advanceTimer(state, 1808000);
  assert.equal(dispatch({ type: 'timer:pause' }, 1808500), null);
  assert.deepEqual(dispatch({ type: 'timer:toggle' }, 1809000), {
    title: '휴식 시작',
    body: '',
  });
  assert.equal(dispatch({ type: 'timer:end' }, 1810000), null);
});

test('restarting the same task at expiry produces both completion and start notices', () => {
  const state = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  const next = applyCommand(
    state,
    { type: 'timer:play', payload: { id: 't1' } },
    1501000,
  );
  assert.equal(
    completedTimerNotification(state, 1501000).title,
    '집중 타이머 끝',
  );
  assert.equal(
    startedTimerNotification(state, next, 1501000).title,
    '집중 시작',
  );
});

test('only natural focus/rest completion produces a notification, once per transition', () => {
  let state = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  assert.equal(completedTimerNotification(state, 1500999), null);
  assert.deepEqual(completedTimerNotification(state, 1501000), {
    title: '집중 타이머 끝',
    body: '프로젝트 아이디어 정리 · 1포모도로 완료. 휴식 시간입니다',
  });
  advanceTimer(state, 1501000);
  assert.equal(state.timer.running, true);
  assert.equal(completedTimerNotification(state, 1800999), null);
  assert.equal(completedTimerNotification(state, 1801000).title, '휴식 끝');
  advanceTimer(state, 1801000);
  assert.equal(state.timer, null);
  assert.equal(state.records.length, 1);
  assert.equal(completedTimerNotification(state, 1802000), null);
});

test('pause, manual end, task switch, and completed-task actions before expiry do not alert', () => {
  const initial = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  for (const command of [
    { type: 'timer:pause' },
    { type: 'timer:end' },
    { type: 'timer:play', payload: { id: 't2' } },
    { type: 'task:toggle', payload: { id: 't1' } },
  ]) {
    assert.equal(completedTimerNotification(initial, 100000), null);
    const next = applyCommand(initial, command, 100000);
    assert.equal(completedTimerNotification(next, 100000), null);
  }
  const paused = applyCommand(initial, { type: 'timer:pause' }, 100000);
  assert.equal(completedTimerNotification(paused, 5000000), null);
});

test('expiry handled during a command still notifies the old task only once', () => {
  let state = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  const content = completedTimerNotification(state, 1501000);
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: 't2' } },
    1501000,
  );
  assert.match(content.body, /프로젝트 아이디어 정리/);
  assert.equal(state.records.length, 1);
  assert.equal(state.timer.taskId, 't2');
  assert.equal(completedTimerNotification(state, 1501001), null);
});

test('native notification clicks restore the window and delivery failures do not throw', () => {
  const sent = [],
    errors = [],
    actions = [];
  class FakeNotification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
      sent.push(this);
    }
    show() {}
    close() {
      this.closed = true;
    }
  }
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => actions.push('restore'),
    show: () => actions.push('show'),
    focus: () => actions.push('focus'),
  };
  const notifier = createTimerNotifications({
    Notification: FakeNotification,
    getWindow: () => window,
    icon: '/icon.png',
    onError: (e) => errors.push(e),
  });
  notifier.show({ title: '휴식 끝', body: '휴식 종료' });
  assert.equal(sent[0].options.silent, false);
  sent[0].emit('click');
  assert.deepEqual(actions, ['restore', 'show', 'focus']);
  notifier.show({ title: '집중 타이머 끝', body: '집중 종료' });
  sent[1].emit('failed', {}, 'Permission denied');
  assert.deepEqual(errors, ['Permission denied']);
  notifier.show({ title: '휴식 끝', body: '휴식 종료' });
  notifier.destroy();
  assert.equal(sent[2].closed, true);
  assert.equal(sent[2].listenerCount('click'), 0);
});

test('an unrelated command at focus expiry starts rest without a duplicate start notice', () => {
  const state = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  const next = applyCommand(
    state,
    { type: 'settings:save', payload: { focus: 1800 } },
    1501000,
  );
  assert.equal(
    completedTimerNotification(state, 1501000).title,
    '집중 타이머 끝',
  );
  assert.equal(next.timer.phase, 'rest');
  assert.equal(next.timer.running, true);
  assert.equal(startedTimerNotification(state, next, 1501000), null);
  assert.equal(completedTimerNotification(next, 1501000), null);
});
