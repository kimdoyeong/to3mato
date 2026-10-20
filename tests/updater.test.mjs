import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createUpdater,
  updateFeedURL,
  updaterEnabled,
  UPDATE_URL,
  UPDATE_ERROR,
  VERIFICATION_ERROR,
} from '../electron/updater.mjs';
import { createInitialState, applyCommand } from '../src/lib/domain.mjs';

function fixture(options = {}) {
  const engine = new EventEmitter();
  const native = new EventEmitter();
  const updates = [],
    messages = [],
    errors = [],
    schedules = [],
    cleared = [];
  let checks = 0,
    installs = 0;
  engine.setFeedURL = (feed) => {
    engine.feed = feed;
  };
  engine.checkForUpdates = async () => {
    checks++;
    engine.emit('update-not-available');
  };
  engine.quitAndInstall = () => {
    installs++;
  };
  const updater = createUpdater({
    autoUpdater: engine,
    nativeUpdater: native,
    enabled: true,
    onStatus: (value) => updates.push(value),
    log: (e) => errors.push(e),
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (...args) => messages.push(args) },
    }),
    timers: {
      setTimeout(fn, delay) {
        const token = { fn, delay };
        schedules.push(token);
        return token;
      },
      setInterval(fn, delay) {
        const token = { fn, delay };
        schedules.push(token);
        return token;
      },
      clearTimeout: (id) => cleared.push(id),
      clearInterval: (id) => cleared.push(id),
    },
    ...options,
  });
  return {
    engine,
    native,
    updater,
    updates,
    messages,
    errors,
    schedules,
    cleared,
    checks: () => checks,
    installs: () => installs,
  };
}

function stage(f) {
  f.engine.emit('update-available', { version: '0.3.1' });
  f.engine.emit('update-downloaded', { version: '0.3.1' });
  f.native.emit('update-downloaded');
}

test('only packaged Apple Silicon builds without a dev URL enable updates', () => {
  const eligible = { isPackaged: true, platform: 'darwin', arch: 'arm64' };
  assert.equal(updaterEnabled(eligible), true);
  for (const change of [
    { isPackaged: false },
    { devURL: 'http://127.0.0.1:4173' },
    { platform: 'win32' },
    { arch: 'x64' },
  ])
    assert.equal(updaterEnabled({ ...eligible, ...change }), false);
  const f = fixture({ enabled: false });
  assert.equal(f.schedules.length, 0);
  assert.equal(f.engine.listenerCount('error'), 0);
  assert.equal(f.updater.install(), false);
  f.updater.check();
  assert.equal(f.checks(), 0);
});

test('feed override permits only HTTP loopback with an optional port/path', () => {
  assert.equal(updateFeedURL(), UPDATE_URL);
  assert.equal(
    updateFeedURL('http://127.0.0.1:8989/releases'),
    'http://127.0.0.1:8989/releases/',
  );
  for (const value of [
    '',
    'junk',
    'https://127.0.0.1',
    'http://localhost:8989',
    'http://127.0.0.1.evil.test',
    'https://evil.test',
    'file:///tmp/feed',
    'http://127.0.0.1@evil.test',
    'http://user:pass@127.0.0.1',
    'http://127.0.0.1/?url=evil',
    'http://127.0.0.1/#evil',
  ])
    assert.throws(() => updateFeedURL(value));
});

test('scheduling, stable release policy and same-origin artifact policy', async () => {
  const f = fixture();
  assert.deepEqual(
    f.schedules.map((s) => s.delay),
    [10_000, 14_400_000],
  );
  assert.equal(f.engine.autoDownload, true);
  assert.equal(f.engine.autoInstallOnAppQuit, true);
  assert.equal(f.engine.allowDowngrade, false);
  assert.equal(f.engine.allowPrerelease, false);
  assert.equal(f.engine.feed.url, UPDATE_URL);
  const info = {
    version: '0.3.1',
    files: [{ url: 'To3mato-0.3.1-arm64-mac.zip' }],
  };
  assert.equal(await f.engine.isUpdateSupported(info), true);
  assert.equal(
    await f.engine.isUpdateSupported({ ...info, version: '0.4.0-beta.1' }),
    false,
  );
  for (const url of [
    'http://downloads.to3mato.doyeong.dev/file.zip',
    'https://evil.test/file.zip',
  ])
    assert.equal(
      await f.engine.isUpdateSupported({ ...info, files: [{ url }] }),
      false,
    );
  f.schedules[0].fn();
  await new Promise(setImmediate);
  assert.equal(f.checks(), 1);
  assert.deepEqual(
    f.updates.map((s) => s.status),
    ['checking', 'idle'],
  );
  f.schedules[1].fn();
  await new Promise(setImmediate);
  assert.equal(f.checks(), 2);
  f.updater.destroy();
  assert.equal(f.cleared.length, 2);
  assert.equal(f.native.listenerCount('update-downloaded'), 0);
  await f.updater.check();
  assert.equal(f.checks(), 2);
});

test('ready waits for native signature validation and never automatically restarts a running timer', async () => {
  let state = applyCommand(
    createInitialState(),
    { type: 'timer:play', payload: { id: 't1' } },
    1000,
  );
  let saved;
  const f = fixture({
    prepareInstall: () => {
      state = applyCommand(state, { type: 'timer:pause' }, 6000);
      saved = structuredClone(state);
    },
  });
  assert.equal(f.updater.install(), false);
  f.engine.emit('update-available', { version: '0.3.1' });
  f.engine.emit('download-progress', { percent: 41.6 });
  assert.deepEqual(f.updater.status(), {
    status: 'downloading',
    version: '0.3.1',
    percent: 42,
  });
  await f.updater.check();
  assert.equal(f.checks(), 0);
  f.engine.emit('update-downloaded', { version: '0.3.1' });
  assert.equal(f.updater.install(), false);
  f.native.emit('update-downloaded');
  assert.equal(f.updater.status().status, 'ready');
  assert.equal(state.timer.running, true);
  assert.equal(f.installs(), 0);
  f.engine.quitAndInstall = () => {
    assert.equal(saved.timer.running, false);
    assert.equal(saved.timer.elapsed, 5);
  };
  assert.equal(f.updater.install(), true);
  assert.equal(f.updater.install(), false);
});

test('failed timer save prevents install', () => {
  const f = fixture({
    prepareInstall() {
      throw new Error('disk full');
    },
  });
  stage(f);
  assert.equal(f.updater.install(), false);
  assert.equal(f.installs(), 0);
  assert.equal(f.updater.status().status, 'ready');
});

test('network/download rejection is quiet, retryable and does not create unhandled promises', async () => {
  const f = fixture();
  let resolve;
  f.engine.checkForUpdates = () =>
    new Promise((done) => {
      resolve = done;
    });
  const first = f.updater.check();
  assert.equal((await f.updater.check()).status, 'checking');
  f.engine.emit('update-available', { version: '0.3.1' });
  resolve({ downloadPromise: Promise.reject(new Error('offline')) });
  await first;
  assert.deepEqual(f.updater.status(), {
    status: 'error',
    message: UPDATE_ERROR,
  });
  assert.equal(f.messages.length, 0);
  f.engine.checkForUpdates = async () => f.engine.emit('update-not-available');
  await f.updater.check();
  assert.equal(f.updater.status().status, 'idle');
});

test('checksum and signature failures block installation and show the approved error once', async () => {
  for (const error of [
    Object.assign(new Error('sha512 checksum mismatch'), {
      code: 'ERR_CHECKSUM_MISMATCH',
    }),
    new Error('Code signature did not pass validation'),
  ]) {
    const f = fixture();
    f.engine.checkForUpdates = async () => {
      f.engine.emit('error', error);
      throw error;
    };
    await f.updater.check();
    assert.deepEqual(f.messages, [['state:error', VERIFICATION_ERROR]]);
    assert.equal(f.updater.install(), false);
    f.native.emit('update-downloaded');
    assert.equal(f.updater.status().status, 'error');
  }
});

test('destroy during download ignores late events and failures', async () => {
  const f = fixture();
  let reject;
  f.engine.checkForUpdates = () =>
    new Promise((_, fail) => {
      reject = fail;
    });
  const check = f.updater.check();
  f.updater.destroy();
  reject(new Error('late network failure'));
  await check;
  f.native.emit('update-downloaded');
  assert.equal(f.updates.length, 1);
  assert.equal(f.messages.length, 0);
});
