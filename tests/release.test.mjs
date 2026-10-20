import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';
import {
  FEED_NAME,
  releaseNames,
  fileHashes,
  finalizeRelease,
  verifyRelease,
} from '../scripts/release-files.mjs';
import { uploadRelease } from '../scripts/upload-release.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'to3mato-release-test-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const version = '0.3.0';
  const names = releaseNames(version);
  for (const filename of Object.values(names))
    await fs.writeFile(path.join(directory, filename), filename);
  const zip = await fileHashes(directory, names.zip);
  const dmg = await fileHashes(directory, names.dmg);
  await fs.writeFile(
    path.join(directory, FEED_NAME),
    yaml.dump({
      version,
      files: [zip, dmg].map((file) => ({
        url: file.filename,
        sha512: file.sha512,
        size: file.bytes,
      })),
      path: zip.filename,
      sha512: zip.sha512,
    }),
  );
  const finish = () =>
    finalizeRelease(directory, version, { id: 'test-notarization' });
  return { directory, version, names, finish };
}

test('finalization updates stapled DMG metadata and leaves ZIP bytes unchanged', async (t) => {
  const f = await fixture(t);
  const original = await fs.readFile(path.join(f.directory, f.names.zip));
  await fs.appendFile(path.join(f.directory, f.names.dmg), '-stapled');
  const result = await f.finish();
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, f.names.zip)),
    original,
  );
  assert.equal(
    result.manifest.bytes,
    (await fs.stat(path.join(f.directory, f.names.dmg))).size,
  );
  assert.equal(result.feed.files[1].size, result.manifest.bytes);
  await verifyRelease(f.directory, f.version);
});

test('ZIP modification after generation prevents finalization', async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.directory, f.names.zip), 'changed');
  await assert.rejects(f.finish(), /ZIP checksum/);
});

test('release validation blocks missing artifacts and stale checksums', async (t) => {
  for (const name of ['zip', 'blockmap', 'dmg']) {
    const f = await fixture(t);
    await f.finish();
    await fs.appendFile(path.join(f.directory, f.names[name]), 'changed');
    await assert.rejects(verifyRelease(f.directory, f.version), /checksum/);
  }
  const f = await fixture(t);
  await f.finish();
  await fs.rm(path.join(f.directory, f.names.blockmap));
  await assert.rejects(verifyRelease(f.directory, f.version), /ENOENT/);
});

test('feed cannot point outside the release directory or to an unrelated version', async (t) => {
  const f = await fixture(t);
  await f.finish();
  const file = path.join(f.directory, FEED_NAME);
  const feed = yaml.load(await fs.readFile(file, 'utf8'));
  feed.files[0].url = 'https://example.com/foreign.zip';
  await fs.writeFile(file, yaml.dump(feed));
  await assert.rejects(verifyRelease(f.directory, f.version), /feed file/);
  await assert.rejects(verifyRelease(f.directory, '0.3.1'), /release version/);
});

function remote(f, corrupt) {
  const objects = new Map(),
    uploads = [],
    reads = [];
  return {
    uploads,
    reads,
    objects,
    upload: async (directory, filename, cache) => {
      uploads.push({ filename, cache });
      objects.set(filename, await fs.readFile(path.join(directory, filename)));
    },
    fetchImpl: async (url, options) => {
      const filename = new URL(url).pathname.slice(1);
      reads.push({ filename, method: options.method || 'GET' });
      if (!objects.has(filename)) return new Response(null, { status: 404 });
      if (options.method === 'HEAD') return new Response(null, { status: 200 });
      return new Response(
        corrupt === filename ? 'corrupt response' : objects.get(filename),
      );
    },
  };
}

test('upload verifies public files before publishing feed last with no-cache, then verifies feed and ZIP', async (t) => {
  const f = await fixture(t);
  await f.finish();
  const r = remote(f);
  await uploadRelease({ ...f, ...r });
  assert.deepEqual(
    r.uploads.map((item) => item.filename),
    [
      f.names.zip,
      f.names.blockmap,
      f.names.dmg,
      'release.json',
      'SHA256SUMS.txt',
      FEED_NAME,
    ],
  );
  assert.equal(r.uploads.at(-1).cache, 'no-cache');
  assert.deepEqual(
    r.reads.slice(-2).map((item) => item.filename),
    [FEED_NAME, f.names.zip],
  );
});

test('public checksum mismatch stops release before publishing a feed', async (t) => {
  const f = await fixture(t);
  await f.finish();
  const r = remote(f, f.names.zip);
  await assert.rejects(uploadRelease({ ...f, ...r }), /Remote checksum/);
  assert.equal(
    r.uploads.some((item) => item.filename === FEED_NAME),
    false,
  );
});

test('a previously published version cannot be overwritten with different bytes', async (t) => {
  const f = await fixture(t);
  await f.finish();
  const r = remote(f);
  r.objects.set(f.names.zip, Buffer.from('previous version bytes'));
  await assert.rejects(uploadRelease({ ...f, ...r }), /Remote checksum/);
  assert.equal(r.uploads.length, 0);
});

test('local validation failure prevents all network access', async (t) => {
  const f = await fixture(t);
  await f.finish();
  await fs.writeFile(path.join(f.directory, 'SHA256SUMS.txt'), 'stale');
  let called = false;
  await assert.rejects(
    uploadRelease({
      ...f,
      fetchImpl: () => {
        called = true;
      },
    }),
    /SHA256SUMS/,
  );
  assert.equal(called, false);
});
