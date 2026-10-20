import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOWNLOAD_URL, fileHashes, releaseNames } from './release-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sizeLabel = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export async function prepareSite({
  source = path.join(root, 'website/dist'),
  output = path.join(root, 'website/cloudflare-dist'),
  directory = process.env.SITE_RELEASE_DIR || path.join(source, 'downloads'),
} = {}) {
  const releaseText = await fs.readFile(
    path.join(directory, 'release.json'),
    'utf8',
  );
  const release = JSON.parse(releaseText);
  if (!release.signed || !release.notarized)
    throw new Error('공증된 설치 파일이 필요합니다.');
  if (release.filename !== releaseNames(release.version).dmg)
    throw new Error('Release filename/version mismatch');
  const dmg = await fileHashes(directory, release.filename);
  if (dmg.sha256 !== release.sha256 || dmg.bytes !== release.bytes)
    throw new Error('설치 파일 체크섬 또는 크기가 다릅니다.');
  const checksums = await fs.readFile(
    path.join(directory, 'SHA256SUMS.txt'),
    'utf8',
  );
  if (!checksums.split('\n').includes(`${dmg.sha256}  ${release.filename}`))
    throw new Error('DMG checksum missing from SHA256SUMS.txt');
  const previous = JSON.parse(
    await fs.readFile(path.join(source, 'downloads/release.json'), 'utf8'),
  );
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(source, output, {
    recursive: true,
    filter: (name) => name !== path.join(source, 'downloads'),
  });
  for (const name of ['index.html', 'about.html', 'download.html']) {
    const file = path.join(output, name);
    let html = await fs.readFile(file, 'utf8');
    if (
      name === 'download.html' &&
      (!html.includes(`v${previous.version}`) ||
        !html.includes(`href="downloads/${previous.filename}"`) ||
        !html.includes(`DMG · ${sizeLabel(previous.bytes)} · arm64`))
    )
      throw new Error(
        'Download template no longer matches its release metadata',
      );
    html = html
      .replaceAll(`v${previous.version}`, `v${release.version}`)
      .replaceAll(
        `href="downloads/${previous.filename}"`,
        `href="${DOWNLOAD_URL}${release.filename}"`,
      )
      .replaceAll(
        `DMG · ${sizeLabel(previous.bytes)} · arm64`,
        `DMG · ${sizeLabel(release.bytes)} · arm64`,
      );
    await fs.writeFile(file, html);
  }
  await fs.mkdir(path.join(output, 'downloads'), { recursive: true });
  await fs.writeFile(path.join(output, 'downloads/release.json'), releaseText);
  await fs.writeFile(path.join(output, 'downloads/SHA256SUMS.txt'), checksums);
  await fs.writeFile(
    path.join(output, '_redirects'),
    `/downloads/${release.filename} ${DOWNLOAD_URL}${release.filename} 302\n`,
  );
  return release;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const release = await prepareSite();
  console.log(`Cloudflare 정적 사이트 준비 완료: ${release.version}`);
}
