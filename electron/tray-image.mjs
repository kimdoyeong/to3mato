import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const theme = readFileSync(
  new URL('../src/styles/theme.css', import.meta.url),
  'utf8',
);
const color = (name) =>
  theme
    .match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i'))[1]
    .match(/../g)
    .map((v) => parseInt(v, 16));
const focusColor = color('red'),
  restColor = color('green');
const widths = { bar: 74, ring: 46, hourglass: 44 };
const steps = { bar: 48, ring: 48, hourglass: 32 };
export const ratioBucket = (display, ratio) =>
  Math.round(Math.max(0, Math.min(1, ratio || 0)) * (steps[display] ?? 1));
export const trayImageKey = (display, view) =>
  `${display}:${view.phase}:${view.paused}:${ratioBucket(display, view.ratio)}`;

// The checked-in mascot PNGs are non-interlaced, 8-bit RGBA. Decode just this
// format so rendering remains synchronous and needs no canvas/window dependency.
export function decodePNG(png) {
  let width, height;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset),
      type = png.toString('ascii', offset + 4, offset + 8);
    const bytes = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(0);
      height = bytes.readUInt32BE(4);
      if (bytes[8] !== 8 || bytes[9] !== 6 || bytes[12] !== 0)
        throw new Error('Unsupported tray PNG format');
    }
    if (type === 'IDAT') chunks.push(bytes);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Unsupported PNG filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= 4 ? pixels[i - 4] : 0,
        b = y ? pixels[i - stride] : 0,
        c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      pixels[i] =
        raw[y * (stride + 1) + 1 + x] +
        [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  return { width, height, pixels };
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export function encodePNG(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    pixels.copy(
      raw,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4,
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const mascots = new Map(
  [1, 2].map((scale) => [
    scale,
    decodePNG(
      readFileSync(
        new URL(
          `./assets/mascot-tray${scale === 2 ? '@2x' : ''}.png`,
          import.meta.url,
        ),
      ),
    ),
  ]),
);

export function renderTrayPNG(display, view, scale = 1) {
  if (!widths[display] || !mascots.has(scale))
    throw new Error('Invalid tray image options');
  const width = widths[display] * scale,
    height = 22 * scale;
  const pixels = Buffer.alloc(width * height * 4),
    mascot = mascots.get(scale);
  for (let y = 0; y < height; y++)
    mascot.pixels.copy(
      pixels,
      y * width * 4,
      y * mascot.width * 4,
      (y + 1) * mascot.width * 4,
    );
  const ratio = ratioBucket(display, view.ratio) / steps[display];
  const rgb = view.phase === 'rest' ? restColor : focusColor;
  const active = view.phase !== 'idle',
    opacity = view.paused ? 0.45 : 1;
  const capsule = (x, y, x1, x2, cy, r) =>
    Math.hypot(x - Math.max(x1 + r, Math.min(x2 - r, x)), y - cy) <= r;
  const sample = (x, y) => {
    let outline = false,
      fill = false;
    if (display === 'bar') {
      const outer = capsule(x, y, 25, 73, 11, 4),
        inner = capsule(x, y, 26, 72, 11, 3);
      outline = outer && !inner;
      fill = inner && x < 26 + 46 * ratio;
    } else if (display === 'ring') {
      const distance = Math.hypot(x - 35, y - 11);
      outline = distance >= 6 && distance <= 9;
      const angle =
        (Math.atan2(y - 11, x - 35) + Math.PI / 2 + Math.PI * 2) %
        (Math.PI * 2);
      fill = outline && angle < ratio * Math.PI * 2;
    } else {
      const half = 1 + Math.abs(y - 11) * 0.72;
      const inside = y >= 3 && y <= 19 && Math.abs(x - 34) <= half;
      outline = inside && (Math.abs(x - 34) >= half - 1 || y <= 4 || y >= 18);
      // Equal triangle areas move between the chambers as time elapses.
      fill =
        inside &&
        !outline &&
        (y < 11
          ? y >= 11 - 7 * Math.sqrt(ratio)
          : y >= 18 - 7 * Math.sqrt(1 - ratio));
    }
    if (active && fill) return [...rgb, opacity];
    // A light keyline remains visible on both dark and light menu bars.
    if (outline)
      return display === 'ring'
        ? [185, 170, 153, 0.7 * opacity]
        : [130, 112, 98, opacity];
    return [0, 0, 0, 0];
  };
  for (let py = 0; py < height; py++)
    for (let px = 24 * scale; px < width; px++) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const c = sample(
            (px + (sx + 0.5) / 4) / scale,
            (py + (sy + 0.5) / 4) / scale,
          );
          for (let i = 0; i < 3; i++) sums[i] += c[i] * c[3];
          sums[3] += c[3];
        }
      const offset = (py * width + px) * 4;
      if (sums[3])
        for (let i = 0; i < 3; i++)
          pixels[offset + i] = Math.round(sums[i] / sums[3]);
      pixels[offset + 3] = Math.round((sums[3] / 16) * 255);
    }
  return encodePNG(width, height, pixels);
}
export function createTrayImage(nativeImage, display, view) {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2])
    image.addRepresentation({
      scaleFactor,
      buffer: renderTrayPNG(display, view, scaleFactor),
    });
  image.setTemplateImage(false);
  return image;
}
