// Builds the static assets for the me.to3mato.com Worker into workers/profile/public/.
// Layout matches the URLs the Worker's HTML and tokens.css reference.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'workers/profile/public');
const statics = join(root, 'workers/profile/static');

async function copy(from, to) {
  await mkdir(dirname(join(out, to)), { recursive: true });
  await cp(join(root, from), join(out, to));
}

// Fontsource CSS lists a woff fallback after each woff2; every browser that
// honours unicode-range loads woff2, so only those files ship.
async function font(name) {
  const source = join(root, 'node_modules/@fontsource', name);
  const css = await readFile(join(source, 'index.css'), 'utf8');
  const trimmed = css.replace(/,\s*url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g, '');
  const files = [...trimmed.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g)].map((m) => m[1]);
  if (!files.length || /\.woff\)/.test(trimmed)) throw new Error(`unexpected CSS in @fontsource/${name}`);
  await mkdir(join(out, 'fonts', name, 'files'), { recursive: true });
  await writeFile(join(out, 'fonts', name, 'index.css'), trimmed);
  for (const file of new Set(files))
    await cp(join(source, 'files', file), join(out, 'fonts', name, 'files', file));
}

async function size(dir) {
  let total = 0, count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    total += (await stat(join(entry.parentPath, entry.name))).size;
    count++;
  }
  return { total, count };
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['tokens.css', 'components.css', 'public-profile.css'])
  await copy(`src/styles/${file}`, `styles/${file}`);
await copy('public/fonts/poor-story-digits.woff2', 'fonts/poor-story-digits.woff2');
await font('poor-story');
await font('gamja-flower');
await cp(join(statics, 'page.css'), join(out, 'styles/page.css'));
await cp(join(statics, 'profile.js'), join(out, 'profile.js'));
await cp(join(statics, '_headers'), join(out, '_headers'));

const { total, count } = await size(out);
console.log(`workers/profile/public: ${count} files, ${(total / 1024 / 1024).toFixed(1)} MB`);
