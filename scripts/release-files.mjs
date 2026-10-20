import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';

export const FEED_NAME = 'latest-mac.yml';
export const DOWNLOAD_URL = 'https://downloads.to3mato.doyeong.dev/';

export function releaseNames(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('A stable release version is required');
  const zip = `To3mato-${version}-arm64-mac.zip`;
  return {
    zip,
    blockmap: `${zip}.blockmap`,
    dmg: `To3mato-${version}-arm64.dmg`,
  };
}

export async function fileHashes(directory, filename) {
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  let bytes = 0;
  for await (const chunk of createReadStream(path.join(directory, filename))) {
    bytes += chunk.length;
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return {
    filename,
    bytes,
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('base64'),
  };
}

export async function readFeed(directory, version) {
  const names = releaseNames(version);
  const feed = yaml.load(
    await fs.readFile(path.join(directory, FEED_NAME), 'utf8'),
  );
  if (
    feed?.version !== version ||
    !Array.isArray(feed.files) ||
    feed.files.length !== 2
  )
    throw new Error('Invalid release version or update file list');
  for (const filename of [names.zip, names.dmg]) {
    if (feed.files.filter((file) => file.url === filename).length !== 1)
      throw new Error(`Missing or unexpected feed file: ${filename}`);
  }
  if (feed.path !== names.zip)
    throw new Error('The update path must point to the ZIP');
  return feed;
}

export async function verifyZip(directory, version, feed) {
  const zip = await fileHashes(directory, releaseNames(version).zip);
  const entry = feed.files.find((file) => file.url === zip.filename);
  if (
    entry?.sha512 !== zip.sha512 ||
    entry.size !== zip.bytes ||
    feed.sha512 !== zip.sha512
  )
    throw new Error(
      'ZIP checksum/size mismatch; rebuild without modifying the ZIP',
    );
  return zip;
}

export async function finalizeRelease(directory, version, receipt) {
  const names = releaseNames(version);
  const feed = await readFeed(directory, version);
  const zip = await verifyZip(directory, version, feed);
  const dmg = await fileHashes(directory, names.dmg);
  const blockmap = await fileHashes(directory, names.blockmap);
  const dmgEntry = feed.files.find((file) => file.url === names.dmg);
  dmgEntry.sha512 = dmg.sha512;
  dmgEntry.size = dmg.bytes;
  // The builder's DMG blockmap describes the pre-stapled image. Do not advertise it.
  delete dmgEntry.blockMapSize;
  await fs.writeFile(
    path.join(directory, FEED_NAME),
    yaml.dump(feed, { lineWidth: -1 }),
  );
  const artifacts = [zip, blockmap, dmg];
  const manifest = {
    version,
    platform: 'macOS',
    architecture: 'arm64',
    filename: names.dmg,
    bytes: dmg.bytes,
    sha256: dmg.sha256,
    signed: true,
    notarized: true,
    notarizationId: receipt.id,
    artifacts,
  };
  const feedHash = await fileHashes(directory, FEED_NAME);
  await fs.writeFile(
    path.join(directory, 'SHA256SUMS.txt'),
    [...artifacts, feedHash]
      .map((file) => `${file.sha256}  ${file.filename}\n`)
      .join(''),
  );
  // Write approval metadata last. Interrupted runs cannot pass verifyRelease.
  await fs.writeFile(
    path.join(directory, 'release.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return verifyRelease(directory, version);
}

export async function verifyRelease(directory, version) {
  const names = releaseNames(version);
  const feed = await readFeed(directory, version);
  await verifyZip(directory, version, feed);
  const manifest = JSON.parse(
    await fs.readFile(path.join(directory, 'release.json'), 'utf8'),
  );
  if (
    manifest.version !== version ||
    manifest.platform !== 'macOS' ||
    manifest.architecture !== 'arm64' ||
    manifest.filename !== names.dmg ||
    manifest.signed !== true ||
    manifest.notarized !== true ||
    !manifest.notarizationId
  )
    throw new Error('Missing or outdated notarized release metadata');
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3)
    throw new Error('Missing release artifact checksums');
  const artifacts = [];
  for (const filename of [names.zip, names.blockmap, names.dmg]) {
    const actual = await fileHashes(directory, filename);
    const recorded = manifest.artifacts.filter(
      (file) => file.filename === filename,
    );
    if (
      recorded.length !== 1 ||
      ['bytes', 'sha256', 'sha512'].some(
        (key) => actual[key] !== recorded[0][key],
      )
    )
      throw new Error(`Release checksum/size mismatch: ${filename}`);
    const entry = feed.files.find((file) => file.url === filename);
    if (
      entry &&
      (entry.sha512 !== actual.sha512 || entry.size !== actual.bytes)
    )
      throw new Error(`Feed checksum/size mismatch: ${filename}`);
    artifacts.push(actual);
  }
  const dmg = artifacts.find((file) => file.filename === names.dmg);
  if (manifest.sha256 !== dmg.sha256 || manifest.bytes !== dmg.bytes)
    throw new Error('DMG manifest checksum/size mismatch');
  const feedHash = await fileHashes(directory, FEED_NAME);
  const expectedSums = [...artifacts, feedHash]
    .map((file) => `${file.sha256}  ${file.filename}\n`)
    .join('');
  if (
    (await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')) !==
    expectedSums
  )
    throw new Error('SHA256SUMS.txt does not match release artifacts');
  return { feed, manifest, artifacts, feedHash };
}
