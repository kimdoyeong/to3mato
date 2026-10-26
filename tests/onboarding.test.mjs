import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOnboarding, onboardingMode } from '../electron/onboarding.mjs';

const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-onboarding-'));

test('fresh install shows the walkthrough once', () => {
  const dir = directory();
  const first = createOnboarding(dir, { mode: 'auto' });
  assert.equal(first.pending(), true);
  first.finish();
  assert.equal(first.pending(), false);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'onboarding.json'), 'utf8'));
  assert.equal(file.done, true);
  assert.equal(fs.statSync(path.join(dir, 'onboarding.json')).mode & 0o777, 0o600);
  assert.equal(createOnboarding(dir, { mode: 'auto' }).pending(), false);
});

test('quitting before the walkthrough ends shows it again next launch', () => {
  const dir = directory();
  assert.equal(createOnboarding(dir, { mode: 'auto' }).pending(), true);
  // The database exists on the second launch, but this is not an upgrade.
  assert.equal(createOnboarding(dir, { mode: 'auto', existing: true }).pending(), true);
});

test('an existing database counts as finished for upgrades', () => {
  const dir = directory();
  assert.equal(createOnboarding(dir, { mode: 'auto', existing: true }).pending(), false);
  assert.equal(fs.existsSync(path.join(dir, 'onboarding.json')), true);
});

test('forced and disabled modes ignore the stored state', () => {
  const dir = directory();
  createOnboarding(dir, { mode: 'auto' }).finish();
  const forced = createOnboarding(dir, { mode: 'on' });
  assert.equal(forced.pending(), true);
  forced.finish();
  assert.equal(forced.pending(), false);
  const other = directory();
  const off = createOnboarding(other, { mode: 'off' });
  assert.equal(off.pending(), false);
  off.finish();
  assert.equal(fs.existsSync(path.join(other, 'onboarding.json')), false);
});

test('a damaged state file shows the walkthrough again', () => {
  const dir = directory();
  fs.writeFileSync(path.join(dir, 'onboarding.json'), '{');
  assert.equal(createOnboarding(dir, { mode: 'auto' }).pending(), true);
});

test('mode defaults off for isolated userData runs', () => {
  assert.equal(onboardingMode({}), 'auto');
  assert.equal(onboardingMode({ TO3MATO_USER_DATA: '/tmp/x' }), 'off');
  assert.equal(onboardingMode({ TO3MATO_USER_DATA: '/tmp/x', TO3MATO_ONBOARDING: 'on' }), 'on');
  assert.equal(onboardingMode({ TO3MATO_ONBOARDING: 'off' }), 'off');
  assert.equal(onboardingMode({ TO3MATO_ONBOARDING: 'nope' }), 'auto');
});
