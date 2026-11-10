import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { POSTHOG_KEY, POSTHOG_HOST } from '../src/lib/analytics.mjs';
import { csp } from '../workers/profile/src/index.mjs';

const file = 'website/dist/assets/analytics.js';
const source = fs.readFileSync(file, 'utf8');
const constant = (name) =>
  source.match(new RegExp(`const ${name} = '([^']*)';`))?.[1];

test('the web script uses the same project as the app', () => {
  assert.match(POSTHOG_KEY, /^(phc_[A-Za-z0-9]+)?$/);
  assert.equal(constant('KEY'), POSTHOG_KEY);
  assert.equal(constant('HOST'), POSTHOG_HOST);
  assert.match(POSTHOG_HOST, /^https:\/\/(us|eu)\.i\.posthog\.com$/);
});

test('every site page loads the script', () => {
  for (const name of ['index', 'about', 'download', 'privacy', 'terms']) {
    const html = fs.readFileSync(`website/dist/${name}.html`, 'utf8');
    assert.equal(
      html.split('<script src="assets/analytics.js" defer></script>').length,
      2,
      name,
    );
  }
});

function run({ key, hostname }) {
  const appended = [],
    listeners = [],
    captured = [];
  let options;
  const script = {};
  const context = {
    location: { hostname },
    Element: class {},
    document: {
      createElement: () => script,
      head: { appendChild: (node) => appended.push(node) },
      addEventListener: (type, listener) => listeners.push([type, listener]),
    },
  };
  context.window = context;
  vm.runInNewContext(
    source.replace(/const KEY = '[^']*';/, `const KEY = '${key}';`),
    context,
  );
  return {
    appended,
    load() {
      context.posthog = {
        init: (token, value) => (options = { token, ...value }),
        capture: (...args) => captured.push(args),
      };
      script.onload();
      return { options, listeners, captured, Element: context.Element };
    },
  };
}

test('without a key or on a local preview nothing is loaded', () => {
  assert.equal(run({ key: '', hostname: 'to3mato.com' }).appended.length, 0);
  assert.equal(run({ key: 'phc_x', hostname: '127.0.0.1' }).appended.length, 0);
  assert.equal(run({ key: 'phc_x', hostname: '' }).appended.length, 0);
});

test('with a key it counts visits without cookies and reports DMG clicks', () => {
  const page = run({ key: 'phc_x', hostname: 'to3mato.com' });
  assert.equal(page.appended.length, 1);
  assert.equal(
    page.appended[0].src,
    POSTHOG_HOST.replace('.i.', '-assets.i.') + '/static/array.js',
  );
  const { options, listeners, captured, Element } = page.load();
  assert.equal(options.token, 'phc_x');
  assert.equal(options.api_host, POSTHOG_HOST);
  assert.equal(options.cookieless_mode, 'always');
  assert.equal(options.person_profiles, 'never');
  assert.equal(options.autocapture, false);
  assert.equal(options.disable_session_recording, true);
  const [type, click] = listeners[0];
  assert.equal(type, 'click');
  const target = (link) =>
    Object.assign(new Element(), { closest: () => link });
  click({ target: target(null) });
  click({ target: {} });
  assert.equal(captured.length, 0);
  click({ target: target({ pathname: '/downloads/To3mato-0.7.0-arm64.dmg' }) });
  // Objects made inside the VM have another realm's prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(captured)), [
    ['download_clicked', { file: 'To3mato-0.7.0-arm64.dmg' }],
  ]);
});

test('the profile page allows PostHog only when a host is given', () => {
  assert.ok(csp('', []).includes("script-src 'self';"));
  assert.ok(!csp('', []).includes('connect-src'));
  const policy = csp('', [], 'https://us.i.posthog.com');
  assert.ok(
    policy.includes("script-src 'self' https://us-assets.i.posthog.com;"),
  );
  assert.ok(
    policy.includes(
      'connect-src https://us.i.posthog.com https://us-assets.i.posthog.com;',
    ),
  );
  assert.ok(!policy.includes('unsafe'));
});
