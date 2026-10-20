import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseBranch } from '../scripts/check-release-branch.mjs';
import { ensureReleaseIsCurrent } from '../scripts/upload-release.mjs';

const pkg = { version: '0.4.0' };
const lock = {
  version: pkg.version,
  packages: { '': { version: pkg.version } },
};
test('release branch must match both package versions, including manual deployment', () => {
  assert.equal(
    validateReleaseBranch('release/0.4.0', pkg, lock, true),
    '0.4.0',
  );
  assert.equal(validateReleaseBranch('main', pkg, lock), '0.4.0');
  for (const branch of [
    'main',
    '',
    'release/0.3.0',
    'release/v0.4.0',
    'release/0.4.0/extra',
  ])
    assert.throws(
      () => validateReleaseBranch(branch, pkg, lock, true),
      /Expected release/,
    );
  assert.throws(
    () =>
      validateReleaseBranch('release/0.4.0', pkg, {
        ...lock,
        version: '0.3.0',
      }),
    /must match/,
  );
  assert.throws(
    () =>
      validateReleaseBranch('release/0.4.0', pkg, { ...lock, packages: {} }),
    /must match/,
  );
  assert.throws(
    () =>
      validateReleaseBranch(
        'release/0.4.0-beta.1',
        { version: '0.4.0-beta.1' },
        lock,
      ),
    /stable release/,
  );
});
test('publication rejects downgrades and malformed or unavailable update feeds', async () => {
  const feed = (version) => async () => new Response(`version: ${version}\n`);
  await ensureReleaseIsCurrent('0.4.0', feed('0.3.9'), false);
  await ensureReleaseIsCurrent('0.10.0', feed('0.9.0'), false);
  await ensureReleaseIsCurrent('1.0.0', feed('0.99.99'), false);
  await ensureReleaseIsCurrent('0.4.0', feed('0.4.0')); // Retry exact artifacts; hashes are checked by uploadRelease.
  await ensureReleaseIsCurrent(
    '0.4.0',
    async () => new Response(null, { status: 404 }),
    false,
  );
  await assert.rejects(
    ensureReleaseIsCurrent('0.4.0', feed('0.4.0'), false),
    /newer/,
  );
  await assert.rejects(ensureReleaseIsCurrent('0.3.9', feed('0.4.0')), /newer/);
  await assert.rejects(
    ensureReleaseIsCurrent('0.4.0', feed('invalid')),
    /stable/,
  );
  await assert.rejects(
    ensureReleaseIsCurrent(
      '0.4.0',
      async () => new Response(null, { status: 503 }),
    ),
    /Cannot read/,
  );
});
