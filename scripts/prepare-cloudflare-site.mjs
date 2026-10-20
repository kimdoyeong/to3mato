import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'website/dist');
const output = path.join(root, 'website/cloudflare-dist');
const downloads = 'https://downloads.to3mato.doyeong.dev';
const release = JSON.parse(
  await fs.readFile(path.join(source, 'downloads/release.json'), 'utf8'),
);
if (!release.signed || !release.notarized)
  throw new Error('공증된 설치 파일이 필요합니다.');
const dmg = await fs.readFile(path.join(source, 'downloads', release.filename));
if (createHash('sha256').update(dmg).digest('hex') !== release.sha256)
  throw new Error('설치 파일 체크섬이 다릅니다.');
await fs.rm(output, { recursive: true, force: true });
await fs.cp(source, output, {
  recursive: true,
  filter: (name) => !name.endsWith('.dmg') && !name.endsWith('.blockmap'),
});
for (const name of ['index.html', 'about.html', 'download.html']) {
  const file = path.join(output, name);
  const html = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    html.replaceAll(
      `href="downloads/${release.filename}"`,
      `href="${downloads}/${release.filename}"`,
    ),
  );
}
await fs.writeFile(
  path.join(output, '_redirects'),
  `/downloads/${release.filename} ${downloads}/${release.filename} 302\n`,
);
console.log(`Cloudflare 정적 사이트 준비 완료: ${output}`);
