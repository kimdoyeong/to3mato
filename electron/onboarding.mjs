import fs from 'node:fs';
import path from 'node:path';

/**
 * First-run walkthrough state for this device. It is never synced.
 *
 * mode
 * - 'auto': show once on a fresh install. An install that already had a
 *   database before this launch counts as finished, so existing users
 *   upgrading are not interrupted.
 * - 'on': always show until finished in this run (tests).
 * - 'off': never show (test and development runs with their own userData).
 */
export function onboardingMode(env = process.env) {
  const value = env.TO3MATO_ONBOARDING;
  if (value === 'on' || value === 'off' || value === 'auto') return value;
  return env.TO3MATO_USER_DATA ? 'off' : 'auto';
}

export function createOnboarding(directory, { mode = 'auto', existing = false } = {}) {
  const file = path.join(directory, 'onboarding.json');
  /** 'done', 'pending', or 'missing' when no state was ever written. */
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).done === true
        ? 'done'
        : 'pending';
    } catch (error) {
      // A damaged file shows the walkthrough again rather than hiding it.
      return error?.code === 'ENOENT' ? 'missing' : 'pending';
    }
  };
  const write = (done) => {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = file + '.tmp';
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, done, at: Date.now() }),
        { mode: 0o600 },
      );
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  let done = mode === 'off';
  if (mode === 'auto') {
    const stored = read();
    if (stored === 'missing') {
      // Record the decision now. Without it, quitting before the walkthrough
      // ends would look like an upgrade on the next launch, because the
      // database exists by then.
      done = existing;
      write(done);
    } else done = stored === 'done';
  }
  return {
    pending: () => !done,
    finish() {
      if (done) return;
      done = true;
      write(true);
    },
  };
}
