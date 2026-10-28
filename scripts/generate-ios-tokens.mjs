// src/styles/tokens.css의 색, 글자 크기, 간격, 모서리, 기울기 값을 iOS 앱의 Swift 상수로 옮긴다.
// 실행: node scripts/generate-ios-tokens.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}src/styles/tokens.css`, 'utf8');
const target = `${root}ios/To3mato/Design/Tokens.swift`;

const tokens = [...source.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(
  ([, name, value]) => [name, value.replace(/\s+/g, ' ').trim()],
);
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const pick = (prefix) =>
  tokens
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, value]) => [camel(name.slice(prefix.length)), value]);

const colors = tokens
  .filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value))
  .map(([name, value]) => `  static let ${camel(name)} = Color(hex: 0x${value.slice(1)})`);

const px = (prefix, swiftName) =>
  pick(prefix).map(([name, value]) => {
    const key = /^\d/.test(name) ? `${swiftName}${name}` : name;
    return `  static let ${key}: CGFloat = ${parseFloat(value)}`;
  });

// "24px 30px 22px 28px / 28px 22px 30px 24px" 또는 "50% 46% ..." 형식
const wobble = pick('wobble-')
  .concat(pick('blob').map(([, value]) => ['blob', value]))
  .map(([name, value]) => {
    const [h, v] = value.split('/').map((part) => part.trim().split(' '));
    const relative = h[0].endsWith('%');
    const num = (list) => list.map((x) => parseFloat(x) / (relative ? 100 : 1)).join(', ');
    return `  static let ${name} = WobbleRadii(h: [${num(h)}], v: [${num(v)}], relative: ${relative})`;
  });

const tilt = pick('tilt-').map(
  ([name, value]) => `  static let ${name}: Double = ${parseFloat(value)}`,
);

const swift = `// 자동 생성 파일: node scripts/generate-ios-tokens.mjs
// 원본은 src/styles/tokens.css다. 이 파일을 직접 고치지 않는다.
import SwiftUI

enum Palette {
${colors.join('\n')}
}

enum TextSize {
${px('text-', 'size').join('\n')}
}

enum Space {
${px('space-', 's').join('\n')}
}

enum Wobble {
${wobble.join('\n')}
}

enum Tilt {
${tilt.join('\n')}
}
`;

writeFileSync(target, swift);
console.log(`wrote ${target}`);
