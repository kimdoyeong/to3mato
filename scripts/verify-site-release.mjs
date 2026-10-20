import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { ensureReleaseIsCurrent } from './upload-release.mjs';
import { DOWNLOAD_URL } from './release-files.mjs';

const directory = process.env.SITE_RELEASE_DIR || 'website/dist/downloads';
const expected = JSON.parse(
  await fs.readFile(path.join(directory, 'release.json'), 'utf8'),
);
const checksums = await fs.readFile(
  path.join(directory, 'SHA256SUMS.txt'),
  'utf8',
);
await ensureReleaseIsCurrent(expected.version);
// Pages may take a short time to propagate to its production custom domain.
for (let attempt = 0; ; attempt++) {
  try {
    const read = async (file) => {
      const response = await fetch(
        `https://to3mato.doyeong.dev/${file}?verify=${Date.now()}`,
        {
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error(`Site ${file}: ${response.status}`);
      return response.text();
    };
    const [html, manifest, sums] = await Promise.all([
      read('download.html'),
      read('downloads/release.json'),
      read('downloads/SHA256SUMS.txt'),
    ]);
    const actual = JSON.parse(manifest);
    if (
      actual.version !== expected.version ||
      actual.sha256 !== expected.sha256 ||
      sums !== checksums ||
      !html.includes(`v${expected.version}`) ||
      !html.includes(`href="${DOWNLOAD_URL}${expected.filename}"`) ||
      !html.includes(
        `DMG · ${(expected.bytes / 1024 / 1024).toFixed(1)} MB · arm64`,
      )
    )
      throw new Error('Public website does not match the published release');
    console.log(`Production website verified: ${expected.version}`);
    break;
  } catch (error) {
    if (attempt >= 11) throw error;
    await setTimeout(10_000);
  }
}
