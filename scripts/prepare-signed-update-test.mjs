import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The test app has its own bundle ID and updater cache (see README build commands).
// A bootstrap in the signed NEW app preserves isolation when Squirrel relaunches
// without inheriting the test runner's environment or debugging arguments.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'release/update-integration');
const fixture = path.join(base, 'fixture');
await fs.mkdir(fixture, { recursive: true });
for (const name of ['electron', 'dist'])
  await fs.cp(path.join(root, name), path.join(fixture, name), {
    recursive: true,
  });
await fs.mkdir(path.join(fixture, 'src/lib'), { recursive: true });
await fs.copyFile(
  path.join(root, 'src/lib/domain.mjs'),
  path.join(fixture, 'src/lib/domain.mjs'),
);
const pkg = JSON.parse(
  await fs.readFile(path.join(root, 'package.json'), 'utf8'),
);
pkg.name = 'to3mato-update-integration';
pkg.version = '0.3.1';
pkg.main = 'electron/update-test-entry.mjs';
delete pkg.scripts;
delete pkg.build;
await fs.writeFile(
  path.join(fixture, 'package.json'),
  JSON.stringify(pkg, null, 2),
);
await fs
  .symlink(
    path.join(root, 'node_modules'),
    path.join(fixture, 'node_modules'),
    'dir',
  )
  .catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
await fs.writeFile(
  path.join(fixture, 'electron/update-test-entry.mjs'),
  `// Test-only bootstrap, never included in the production app.
import fs from 'node:fs';
import { app } from 'electron';
const config = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(base, 'runtime.json'))}, 'utf8'));
process.env.TO3MATO_USER_DATA = config.userData;
process.env.TO3MATO_UPDATE_URL = config.feedURL;
delete process.env.TO3MATO_DEV_URL;
app.commandLine.appendSwitch('remote-debugging-port', String(config.debugPort));
app.whenReady().then(() => fs.appendFileSync(config.bootLog, JSON.stringify({pid: process.pid, version: app.getVersion(), userData: app.getPath('userData'), appPath: app.getAppPath()}) + '\\n'));
await import('./main.mjs');
`,
);
console.log(`Prepared isolated test fixture: ${fixture}`);
