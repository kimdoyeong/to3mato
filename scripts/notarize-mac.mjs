import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFeed, verifyZip, finalizeRelease } from './release-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const output = path.join(root, 'release/distribution');
const filename = `To3mato-${version}-arm64.dmg`;
const dmg = path.join(output, filename);
const receiptPath = path.join(output, 'notarization.json');
const profile = process.env.APPLE_KEYCHAIN_PROFILE || 'to3mato-notary';
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const notary = (args) =>
  JSON.parse(
    run('xcrun', [
      'notarytool',
      ...args,
      '--keychain-profile',
      profile,
      ...(process.env.APPLE_KEYCHAIN
        ? ['--keychain', process.env.APPLE_KEYCHAIN]
        : []),
      '--output-format',
      'json',
    ]),
  );
const hash = () =>
  createHash('sha256').update(fs.readFileSync(dmg)).digest('hex');
const save = (receipt) => {
  fs.writeFileSync(
    `${receiptPath}.tmp`,
    JSON.stringify(receipt, null, 2) + '\n',
  );
  fs.renameSync(`${receiptPath}.tmp`, receiptPath);
};

const validateApp = (appPath) => {
  run('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
    appPath,
  ]);
  run('xcrun', ['stapler', 'validate', appPath]);
  run('spctl', ['--assess', '--type', 'execute', appPath]);
  const appVersion = run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    path.join(appPath, 'Contents/Info.plist'),
  ]).trim();
  if (appVersion !== version)
    throw new Error('App bundle version does not match package.json');
};

const validateBundles = (zipPath) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-notary-'));
  const mount = path.join(temporary, 'dmg');
  fs.mkdirSync(mount);
  let mounted = false;
  try {
    run('hdiutil', [
      'attach',
      dmg,
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mount,
    ]);
    mounted = true;
    validateApp(path.join(mount, 'To3mato.app'));
    const unpacked = path.join(temporary, 'zip');
    run('ditto', ['-x', '-k', zipPath, unpacked]);
    validateApp(path.join(unpacked, 'To3mato.app'));
  } finally {
    // If detach fails, leave the mount intact instead of recursively removing it.
    if (mounted) run('hdiutil', ['detach', mount]);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
};

try {
  if (process.argv.slice(2).some((arg) => arg !== '--wait'))
    throw new Error('Usage: notarize-mac.mjs [--wait]');
  if (process.platform !== 'darwin') throw new Error('macOS에서 실행하세요.');
  if (!fs.existsSync(dmg))
    throw new Error('먼저 npm run dist:mac을 실행하세요.');
  const feed = await readFeed(output, version);
  const zip = await verifyZip(output, version, feed);
  validateBundles(path.join(output, zip.filename));
  run('codesign', [
    '--verify',
    '--strict',
    '-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
    dmg,
  ]);
  const sha256 = hash();
  const manifestPath = path.join(output, 'release.json');
  if (fs.existsSync(manifestPath)) {
    const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (previous.filename !== filename || previous.sha256 !== sha256) {
      // A new build must not inherit a previous build's approved metadata.
      fs.rmSync(manifestPath);
      fs.rmSync(path.join(output, 'SHA256SUMS.txt'), { force: true });
    }
  }
  let receipt = fs.existsSync(receiptPath)
    ? JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
    : null;
  if (
    !receipt ||
    receipt.filename !== filename ||
    ![receipt.submittedSha256, receipt.stapledSha256].includes(sha256)
  ) {
    const submitted = notary(['submit', dmg]);
    if (!submitted.id) throw new Error('Apple 공증 제출 ID가 없습니다.');
    receipt = {
      filename,
      submittedSha256: sha256,
      id: submitted.id,
      status: 'Submitted',
    };
    save(receipt);
    console.log(`Apple 공증 제출: ${receipt.id}`);
  }
  if (process.argv.includes('--wait'))
    notary(['wait', receipt.id, '--timeout', '45m']);
  const info = notary(['info', receipt.id]);
  receipt.status = info.status;
  save(receipt);
  console.log(`Apple 공증 상태: ${info.status}`);
  if (info.status === 'Accepted') {
    console.log(run('xcrun', ['stapler', 'staple', dmg]).trim());
    // Persist the new hash immediately so a later validation retry never reuploads.
    receipt.stapledSha256 = hash();
    save(receipt);
    console.log(run('xcrun', ['stapler', 'validate', dmg]).trim());
    run('codesign', ['--verify', '--strict', dmg]);
    run('spctl', [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      dmg,
    ]);
    run('hdiutil', ['verify', dmg]);
    await finalizeRelease(output, version, receipt);
    console.log(`배포 파일 검증 완료: ${dmg}`);
  } else if (info.status === 'In Progress') {
    console.log(
      'Apple 처리 중입니다. 잠시 후 npm run notarize:mac을 다시 실행하세요. 같은 파일은 중복 제출하지 않습니다.',
    );
  } else {
    const log = notary(['log', receipt.id]);
    fs.writeFileSync(
      path.join(output, 'notarization-log.json'),
      JSON.stringify(log, null, 2) + '\n',
    );
    throw new Error(
      '공증이 승인되지 않았습니다. release/distribution/notarization-log.json을 확인하세요.',
    );
  }
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exitCode = 1;
}
