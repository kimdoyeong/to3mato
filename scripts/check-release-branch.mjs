import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { releaseNames } from './release-files.mjs';

export function validateReleaseBranch(branch, pkg, lock, publish = false) {
  releaseNames(pkg.version);
  if (
    lock.version !== pkg.version ||
    lock.packages?.['']?.version !== pkg.version
  )
    throw new Error('package.json and package-lock.json versions must match');
  if (
    (publish || branch.startsWith('release/')) &&
    branch !== `release/${pkg.version}`
  )
    throw new Error(`Expected release/${pkg.version}; received ${branch}`);
  return pkg.version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--publish'))
      throw new Error('Usage: check-release-branch.mjs [--publish]');
    const read = async (file) =>
      JSON.parse(
        await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
      );
    const version = validateReleaseBranch(
      process.env.RELEASE_BRANCH ?? '',
      await read('package.json'),
      await read('package-lock.json'),
      args.includes('--publish'),
    );
    if (args.includes('--publish')) {
      const { ensureReleaseIsCurrent } = await import('./upload-release.mjs');
      await ensureReleaseIsCurrent(version, fetch, false);
    }
    console.log(`Release version verified: ${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
