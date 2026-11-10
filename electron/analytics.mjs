import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FLUSH_INTERVAL = 30_000;
const FLUSH_SIZE = 20;
const BATCH_SIZE = 100;
const QUEUE_LIMIT = 500;

/**
 * 'on' only for the packaged app with its real data folder. Development and
 * test runs never send events unless TO3MATO_ANALYTICS=on asks for it.
 */
export function analyticsMode(env = process.env, isPackaged = false) {
  if (env.TO3MATO_ANALYTICS === 'on' || env.TO3MATO_ANALYTICS === 'off')
    return env.TO3MATO_ANALYTICS;
  return isPackaged && !env.TO3MATO_USER_DATA ? 'on' : 'off';
}

/**
 * Anonymous usage events for this install. The install ID is random, stays in
 * this device's data folder and is never tied to the account. It is not synced.
 */
export function createAnalytics({
  directory,
  key,
  host,
  mode = 'off',
  fetch,
  context = () => ({}),
  now = () => Date.now(),
  onError = () => {},
}) {
  const available = mode === 'on' && !!key && !!host;
  const file = path.join(directory, 'analytics.json');
  let id = '',
    enabled = false,
    queue = [],
    sending = false,
    timer = null;
  const write = (pending = []) => {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = file + '.tmp';
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, id, enabled, pending }),
        { mode: 0o600 },
      );
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  if (available) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof stored.id !== 'string' || typeof stored.enabled !== 'boolean')
        throw new Error('invalid analytics state');
      id = stored.id;
      enabled = stored.enabled;
      if (Array.isArray(stored.pending) && stored.pending.length) {
        if (enabled) queue = stored.pending.slice(-QUEUE_LIMIT);
        // They live in memory from here; leaving them would send them twice.
        write();
      }
    } catch (error) {
      id = crypto.randomUUID();
      // A damaged file may have held an opt-out, so it stays off until the
      // switch is turned on again. Only a missing file starts enabled.
      enabled = error?.code === 'ENOENT';
      try {
        write();
      } catch (failure) {
        enabled = false;
        onError(failure);
      }
    }
    timer = setInterval(() => void flush(), FLUSH_INTERVAL);
    timer.unref?.();
  }
  async function flush() {
    if (!available || !enabled || sending || !queue.length) return;
    sending = true;
    const batch = queue.splice(0, BATCH_SIZE);
    let retry = false;
    try {
      const response = await fetch(new URL('/batch/', host).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, batch }),
        signal: AbortSignal.timeout(10_000),
      });
      // A rejected request would be rejected again; only server and network
      // failures are worth another attempt.
      retry = response.status >= 500 || response.status === 429;
    } catch {
      retry = true;
    }
    if (retry && enabled) queue = [...batch, ...queue].slice(-QUEUE_LIMIT);
    sending = false;
  }
  return {
    status: () => ({ available, enabled }),
    track(event, properties = {}) {
      if (!available || !enabled) return;
      let shared = {};
      try {
        shared = context();
      } catch (error) {
        onError(error);
      }
      queue.push({
        event,
        distinct_id: id,
        timestamp: new Date(now()).toISOString(),
        properties: {
          ...shared,
          ...properties,
          // No person profile: events stay anonymous in PostHog.
          $process_person_profile: false,
        },
      });
      if (queue.length > QUEUE_LIMIT) queue = queue.slice(-QUEUE_LIMIT);
      if (queue.length >= FLUSH_SIZE) void flush();
    },
    setEnabled(value) {
      if (!available) return { available, enabled };
      enabled = value === true;
      if (!enabled) queue = [];
      write();
      return { available, enabled };
    },
    flush,
    /** Keeps unsent events for the next launch; quitting cannot wait for the network. */
    destroy() {
      clearInterval(timer);
      if (!available || !enabled || !queue.length) return;
      try {
        write(queue);
      } catch (error) {
        onError(error);
      }
    },
  };
}
