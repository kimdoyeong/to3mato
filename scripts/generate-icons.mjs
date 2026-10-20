import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'electron/assets');
const component = await readFile(
  path.join(root, 'src/components/Mascot.svelte'),
  'utf8',
);
const source = component.match(/<svg[\s\S]*?<\/svg\s*>/)[0];
const browser = await chromium.launch({ channel: 'chrome' });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'to3mato-icons-'));
try {
  await mkdir(assets, { recursive: true });
  const page = await browser.newPage();
  await page.setContent(source);
  const svg = await page.locator('svg').evaluate((element) => {
    element.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // Keep the same character and colors. Center its original 140 × 128 view in a square.
    element.setAttribute('viewBox', '0 -6 140 140');
    element.setAttribute('width', '1024');
    element.setAttribute('height', '1024');
    // The app animates these alternate decorations with component CSS.
    element
      .querySelectorAll('.sparkles, .rest-eyes')
      .forEach((node) => node.remove());
    return element.outerHTML;
  });
  await writeFile(path.join(assets, 'mascot.svg'), svg + '\n');
  const render = async (size, output) => {
    // Encode the SVG directly instead of capturing a resized browser viewport.
    // Compositor screenshots can contain stale tiles from the preceding size.
    const encoded = await page.evaluate(
      async ({ svg, size }) => {
        const url = URL.createObjectURL(
          new Blob([svg], { type: 'image/svg+xml' }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          canvas.getContext('2d').drawImage(image, 0, 0, size, size);
          return canvas.toDataURL('image/png').split(',')[1];
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { svg, size },
    );
    const image = Buffer.from(encoded, 'base64');
    if (output) await writeFile(output, image);
    return image;
  };
  await render(1024, path.join(assets, 'icon.png'));
  await render(22, path.join(assets, 'mascot-tray.png'));
  await render(44, path.join(assets, 'mascot-tray@2x.png'));

  // PNG-backed ICO includes small taskbar sizes and a high-resolution image.
  const sizes = [16, 32, 48, 256];
  const images = [];
  for (const size of sizes) images.push(await render(size));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  await writeFile(
    path.join(assets, 'icon.ico'),
    Buffer.concat([header, ...images]),
  );

  if (process.platform === 'darwin') {
    const iconset = path.join(temporary, 'To3mato.iconset');
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        await render(
          size * scale,
          path.join(
            iconset,
            `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`,
          ),
        );
      }
    }
    execFileSync('/usr/bin/iconutil', [
      '-c',
      'icns',
      iconset,
      '-o',
      path.join(assets, 'icon.icns'),
    ]);
  }
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
