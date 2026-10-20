import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DOWNLOAD_URL, FEED_NAME, verifyRelease } from './release-files.mjs';

export function uploadObject(directory, filename, cacheControl) {
  const contentType = filename.endsWith('.yml')
    ? 'application/yaml'
    : filename.endsWith('.json')
      ? 'application/json'
      : filename.endsWith('.txt')
        ? 'text/plain'
        : filename.endsWith('.zip')
          ? 'application/zip'
          : 'application/octet-stream';
  execFileSync(
    'npx',
    [
      '--yes',
      'wrangler@4.151.2',
      'r2',
      'object',
      'put',
      `to3mato-downloads/${filename}`,
      '--remote',
      '--file',
      path.join(directory, filename),
      '--content-type',
      contentType,
      '--cache-control',
      cacheControl,
    ],
    { stdio: 'inherit' },
  );
}

async function verifyRemote(filename, expected, fetchImpl) {
  const url = new URL(filename, DOWNLOAD_URL);
  url.searchParams.set('verify', expected.sha256);
  const response = await fetchImpl(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Remote download failed: ${filename} (${response.status})`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (hash.digest('hex') !== expected.sha256 || bytes !== expected.bytes)
    throw new Error(`Remote checksum/size mismatch: ${filename}`);
}

export async function uploadRelease({
  directory,
  version,
  upload = uploadObject,
  fetchImpl = fetch,
}) {
  const verified = await verifyRelease(directory, version);
  // Verify publicly served artifacts before making the new feed visible.
  for (const artifact of verified.artifacts) {
    // Versioned objects are immutable; allow a retry of the same bytes only.
    const existing = await fetchImpl(new URL(artifact.filename, DOWNLOAD_URL), {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (existing.ok) await verifyRemote(artifact.filename, artifact, fetchImpl);
    else if (existing.status !== 404)
      throw new Error(
        `Cannot check existing object: ${artifact.filename} (${existing.status})`,
      );
    await upload(
      directory,
      artifact.filename,
      'public, max-age=31536000, immutable',
    );
    await verifyRemote(artifact.filename, artifact, fetchImpl);
  }
  await upload(directory, 'release.json', 'no-cache');
  await upload(directory, 'SHA256SUMS.txt', 'no-cache');
  // Revalidate in case a local build was changed while the upload was running.
  const final = await verifyRelease(directory, version);
  if (final.feedHash.sha256 !== verified.feedHash.sha256)
    throw new Error('Release changed during upload');
  await upload(directory, FEED_NAME, 'no-cache');
  await verifyRemote(FEED_NAME, verified.feedHash, fetchImpl);
  const zip = verified.artifacts.find((file) => file.filename.endsWith('.zip'));
  await verifyRemote(zip.filename, zip, fetchImpl);
  return verified;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--dry-run'))
      throw new Error('Usage: upload-release.mjs [--dry-run]');
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const { version } = JSON.parse(
      await fs.readFile(path.join(root, 'package.json'), 'utf8'),
    );
    const directory = path.join(root, 'release/distribution');
    if (process.argv.includes('--dry-run')) {
      const { artifacts } = await verifyRelease(directory, version);
      console.log(
        [
          ...artifacts.map((file) => file.filename),
          'release.json',
          'SHA256SUMS.txt',
          FEED_NAME,
        ].join('\n'),
      );
      console.log('Local release verified. No files uploaded.');
    } else {
      await uploadRelease({ directory, version });
      console.log(`Release ${version} uploaded and verified.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
