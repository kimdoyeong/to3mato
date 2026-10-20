import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareSite } from '../scripts/prepare-cloudflare-site.mjs';

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'to3mato-site-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'release');
  await fs.mkdir(directory);
  const bytes = Buffer.from('signed fixture');
  const release = {
    version: '0.4.2',
    filename: 'To3mato-0.4.2-arm64.dmg',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signed: true,
    notarized: true,
  };
  await fs.writeFile(path.join(directory, release.filename), bytes);
  await fs.writeFile(
    path.join(directory, 'release.json'),
    JSON.stringify(release),
  );
  await fs.writeFile(
    path.join(directory, 'SHA256SUMS.txt'),
    `${release.sha256}  ${release.filename}\n`,
  );
  return { directory, release, output: path.join(temp, 'site') };
}

test('site is generated from verified release without changing copy or bundling old installers', async (t) => {
  const options = await fixture(t);
  await prepareSite(options);
  const html = await fs.readFile(
    path.join(options.output, 'download.html'),
    'utf8',
  );
  assert.match(html, /v0\.4\.2/);
  assert.match(
    html,
    /https:\/\/downloads\.to3mato\.doyeong\.dev\/To3mato-0\.4\.2-arm64\.dmg/,
  );
  assert.match(html, /DMG · 0\.0 MB · arm64/);
  assert.match(html, /v0\.2\.0 · 2026\.10\.20/); // Existing release notes remain intact.
  assert.doesNotMatch(html, /v0\.3\.0|To3mato-0\.3\.0/);
  assert.deepEqual(
    (await fs.readdir(path.join(options.output, 'downloads'))).sort(),
    ['SHA256SUMS.txt', 'release.json'],
  );
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(options.output, 'downloads/release.json'),
      'utf8',
    ),
  );
  assert.deepEqual(manifest, options.release);
});

test('site rejects damaged, unsigned and mismatched release files before replacing output', async (t) => {
  const options = await fixture(t);
  await fs.mkdir(options.output);
  await fs.writeFile(
    path.join(options.output, 'sentinel'),
    'previous deployment',
  );
  const write = (release) =>
    fs.writeFile(
      path.join(options.directory, 'release.json'),
      JSON.stringify(release),
    );
  for (const change of [
    { signed: false },
    { notarized: false },
    { bytes: 1 },
    { sha256: '0'.repeat(64) },
    { filename: '../wrong.dmg' },
  ]) {
    await write({ ...options.release, ...change });
    await assert.rejects(prepareSite(options));
    assert.equal(
      await fs.readFile(path.join(options.output, 'sentinel'), 'utf8'),
      'previous deployment',
    );
  }
  await write(options.release);
  await fs.writeFile(
    path.join(options.directory, 'SHA256SUMS.txt'),
    'stale checksum',
  );
  await assert.rejects(prepareSite(options), /checksum missing/);
});
