// iOS 앱의 Supabase 공개 연결 정보를 ios/To3mato/Resources/Supabase.plist에 쓴다.
// 환경 변수 TO3MATO_SUPABASE_URL, TO3MATO_SUPABASE_PUBLISHABLE_KEY 또는 electron/supabase-config.json을 읽는다.
// 실행: node scripts/configure-ios-supabase.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = `${root}electron/supabase-config.json`;
const bundled = existsSync(desktop) ? JSON.parse(readFileSync(desktop, 'utf8')) : {};
const url = process.env.TO3MATO_SUPABASE_URL || bundled.url;
const key = process.env.TO3MATO_SUPABASE_PUBLISHABLE_KEY || bundled.publishableKey;
if (!url || !key) throw new Error('Supabase URL과 publishable key가 필요합니다.');
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
  throw new Error('publishable key만 앱에 넣을 수 있습니다.');
const escape = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const target = `${root}ios/To3mato/Resources/Supabase.plist`;
writeFileSync(
  target,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>url</key>
	<string>${escape(url)}</string>
	<key>publishableKey</key>
	<string>${escape(key)}</string>
</dict>
</plist>
`,
);
console.log(`wrote ${target}`);
