import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyticsMode, createAnalytics } from '../electron/analytics.mjs';
import {
  commandEvent,
  recordEvents,
  rendererEvent,
} from '../src/lib/analytics.mjs';
import { applyCommand, createInitialState } from '../src/lib/domain.mjs';

const directory = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-analytics-'));
const stored = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'analytics.json'), 'utf8'));

function server(status = 200) {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (status === 'offline') throw new Error('offline');
    return { status };
  };
  return { requests, fetch };
}
const create = (dir, fetch, options = {}) =>
  createAnalytics({
    directory: dir,
    key: 'phc_test',
    host: 'https://example.test',
    mode: 'on',
    fetch,
    context: () => ({ app_version: '1.2.3' }),
    now: () => Date.UTC(2026, 10, 10),
    ...options,
  });

test('only the packaged app with its own data folder sends events', () => {
  assert.equal(analyticsMode({}, true), 'on');
  assert.equal(analyticsMode({}, false), 'off');
  assert.equal(analyticsMode({ TO3MATO_USER_DATA: '/tmp/x' }, true), 'off');
  assert.equal(analyticsMode({ TO3MATO_ANALYTICS: 'on' }, false), 'on');
  assert.equal(analyticsMode({ TO3MATO_ANALYTICS: 'off' }, true), 'off');
});

test('without a key or outside the packaged app nothing is written or sent', async () => {
  for (const options of [{ key: '' }, { mode: 'off' }]) {
    const dir = directory(),
      { requests, fetch } = server();
    const analytics = create(dir, fetch, options);
    assert.deepEqual(analytics.status(), { available: false, enabled: false });
    analytics.track('app_opened');
    await analytics.flush();
    analytics.destroy();
    assert.deepEqual(analytics.setEnabled(true), {
      available: false,
      enabled: false,
    });
    assert.equal(requests.length, 0);
    assert.equal(fs.existsSync(path.join(dir, 'analytics.json')), false);
  }
});

test('events go out as an anonymous batch under one install ID', async () => {
  const dir = directory(),
    { requests, fetch } = server();
  const analytics = create(dir, fetch);
  assert.deepEqual(analytics.status(), { available: true, enabled: true });
  assert.equal(
    fs.statSync(path.join(dir, 'analytics.json')).mode & 0o777,
    0o600,
  );
  analytics.track('app_opened', { first_launch: true });
  analytics.track('task_created');
  await analytics.flush();
  analytics.destroy();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.test/batch/');
  const { api_key, batch } = requests[0].body;
  assert.equal(api_key, 'phc_test');
  assert.deepEqual(
    batch.map((item) => item.event),
    ['app_opened', 'task_created'],
  );
  const { id } = stored(dir);
  assert.match(id, /^[0-9a-f-]{36}$/);
  for (const item of batch) {
    assert.equal(item.distinct_id, id);
    assert.equal(item.timestamp, '2026-11-10T00:00:00.000Z');
    assert.equal(item.properties.$process_person_profile, false);
    assert.equal(item.properties.app_version, '1.2.3');
  }
  assert.equal(batch[0].properties.first_launch, true);
  // The same install keeps its ID on the next launch.
  const again = create(dir, fetch);
  again.track('app_opened');
  await again.flush();
  again.destroy();
  assert.equal(requests[1].body.batch[0].distinct_id, id);
});

test('turning it off drops queued events and survives a restart', async () => {
  const dir = directory(),
    { requests, fetch } = server();
  const analytics = create(dir, fetch);
  analytics.track('task_created');
  assert.deepEqual(analytics.setEnabled(false), {
    available: true,
    enabled: false,
  });
  analytics.track('task_created');
  await analytics.flush();
  analytics.destroy();
  assert.equal(requests.length, 0);
  assert.deepEqual(stored(dir).pending, []);
  const next = create(dir, fetch);
  assert.equal(next.status().enabled, false);
  next.track('app_opened');
  await next.flush();
  assert.equal(requests.length, 0);
  assert.equal(next.setEnabled(true).enabled, true);
  next.track('app_opened');
  await next.flush();
  next.destroy();
  assert.equal(requests.length, 1);
});

test('a damaged state file stays off until it is turned on again', () => {
  const dir = directory();
  fs.writeFileSync(path.join(dir, 'analytics.json'), '{');
  const analytics = create(dir, server().fetch);
  assert.deepEqual(analytics.status(), { available: true, enabled: false });
  analytics.destroy();
});

test('unsent events wait for the next launch and are sent once', async () => {
  const dir = directory(),
    offline = server('offline');
  const first = create(dir, offline.fetch);
  first.track('task_created');
  await first.flush();
  first.track('task_completed');
  first.destroy();
  assert.equal(offline.requests.length, 1);
  assert.equal(stored(dir).pending.length, 2);
  const online = server();
  const second = create(dir, online.fetch);
  // Moved to memory at launch so a crash cannot send them twice.
  assert.deepEqual(stored(dir).pending, []);
  await second.flush();
  second.destroy();
  assert.deepEqual(
    online.requests[0].body.batch.map((item) => item.event),
    ['task_created', 'task_completed'],
  );
  assert.deepEqual(stored(dir).pending, []);
});

test('a rejected batch is dropped and a server failure is retried', async () => {
  const rejected = server(400);
  const a = create(directory(), rejected.fetch);
  a.track('task_created');
  await a.flush();
  await a.flush();
  a.destroy();
  assert.equal(rejected.requests.length, 1);
  const failing = server(503);
  const b = create(directory(), failing.fetch);
  b.track('task_created');
  await b.flush();
  await b.flush();
  b.destroy();
  assert.equal(failing.requests.length, 2);
});

test('a full queue sends without waiting for the timer', async () => {
  const { requests, fetch } = server();
  const analytics = create(directory(), fetch);
  for (let index = 0; index < 20; index++) analytics.track('task_created');
  await new Promise((resolve) => setImmediate(resolve));
  analytics.destroy();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.batch.length, 20);
});

test('command events carry no user text', () => {
  let state = createInitialState();
  const run = (type, payload) => {
    const before = state;
    const command = { type, payload };
    state = applyCommand(state, command, 1_000);
    return commandEvent(command, before);
  };
  const secret = '비밀 제목';
  const events = [];
  events.push(run('project:save', { name: secret }));
  const project = state.projects.at(-1).id;
  events.push(
    run('task:save', { title: secret, estimate: 2, date: '', project }),
  );
  const id = state.tasks.at(-1).id;
  assert.deepEqual(events.at(-1), {
    event: 'task_created',
    properties: { has_date: false, has_project: true, estimate: 2 },
  });
  events.push(
    run('task:save', {
      id,
      title: secret + '2',
      estimate: 1,
      date: '',
      project: '',
    }),
  );
  assert.equal(events.at(-1).event, 'task_updated');
  events.push(
    run('task:batch', {
      project: '',
      tasks: [
        { title: secret, estimate: 1, date: '' },
        { title: secret, estimate: 1, date: '' },
      ],
    }),
  );
  assert.deepEqual(events.at(-1).properties, { count: 2, has_project: false });
  events.push(run('timer:play', { id }));
  events.push(run('timer:toggle'));
  assert.deepEqual(events.at(-1), {
    event: 'timer_paused',
    properties: { phase: 'focus' },
  });
  events.push(run('timer:toggle'));
  assert.equal(events.at(-1).event, 'timer_resumed');
  events.push(run('timer:end'));
  events.push(run('task:toggle', { id }));
  assert.equal(events.at(-1).event, 'task_completed');
  events.push(run('task:toggle', { id }));
  assert.equal(events.at(-1).event, 'task_reopened');
  events.push(run('settings:save', { focus: 1500, rest: 300 }));
  assert.deepEqual(events.at(-1).properties, { fields: 'focus,rest' });
  events.push(run('project:save', { id: project, name: secret }));
  events.push(run('task:delete', { id }));
  events.push(run('project:delete', { id: project }));
  assert.ok(events.every(Boolean));
  assert.ok(!JSON.stringify(events).includes('비밀'));
  assert.ok(!JSON.stringify(events).includes(id));
  // Nothing happened, so nothing is reported.
  assert.equal(commandEvent({ type: 'timer:toggle' }, state), null);
  assert.equal(commandEvent({ type: 'timer:end' }, state), null);
  assert.equal(commandEvent({ type: 'unknown' }, state), null);
});

test('new focus records are reported; bulk changes are not', () => {
  const record = (id, seconds) => ({
    id,
    taskId: 'task',
    seconds,
    pomodoros: seconds >= 1500 ? 1 : 0,
    duration: 1500,
    at: 0,
  });
  const before = { records: [record('a', 1500)] };
  assert.deepEqual(
    recordEvents(before, { records: [record('a', 1500), record('b', 1500)] }),
    [
      {
        event: 'focus_recorded',
        properties: { pomodoros: 1, minutes: 25, completed: true },
      },
    ],
  );
  assert.equal(
    recordEvents(before, { records: [record('a', 1500), record('c', 600)] })[0]
      .properties.completed,
    false,
  );
  assert.deepEqual(recordEvents(before, before), []);
  assert.deepEqual(
    recordEvents(
      { records: [] },
      { records: ['a', 'b', 'c', 'd'].map((id) => record(id, 1500)) },
    ),
    [],
  );
});

test('the renderer can only report allowlisted values', () => {
  assert.deepEqual(rendererEvent('screen_viewed', { screen: 'calendar' }), {
    event: 'screen_viewed',
    properties: { screen: 'calendar' },
  });
  assert.deepEqual(
    rendererEvent('screen_viewed', { screen: 'log', title: '비밀' }).properties,
    { screen: 'log' },
  );
  assert.equal(rendererEvent('screen_viewed', { screen: '비밀' }), null);
  assert.equal(rendererEvent('screen_viewed'), null);
  assert.equal(rendererEvent('task_created', {}), null);
  assert.equal(rendererEvent('constructor', {}), null);
});
