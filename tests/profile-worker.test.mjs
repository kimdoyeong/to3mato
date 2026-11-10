import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker, { extractStyles } from '../workers/profile/src/index.mjs';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};
const SLUG = 'abcdefgh23';
const OWNER = '0b6f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const PHOTO = `${OWNER}/photo-11111111-2222-4333-8444-555555555555.jpg`;
const today = new Date().toISOString().slice(0, 10);

function snapshot(extra = {}) {
  return {
    v: 1,
    date: today,
    timeZone: 'UTC',
    days: [...new Array(139).fill(0), 3],
    today: 3,
    ...extra,
  };
}

function stubFetch(t, reply) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return typeof reply === 'function' ? reply() : reply;
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const get = (path, method = 'GET') =>
  worker.fetch(new Request(`https://me.to3mato.com${path}`, { method }), ENV);

test('profile page renders escaped name, meta tags and headers', async (t) => {
  const calls = stubFetch(t, () =>
    json({
      slug: SLUG,
      name: '<b>토마토</b>&"',
      photo: PHOTO,
      snapshot: snapshot({
        projects: [{ name: '영어', color: '#e58a6b', count: 2 }],
      }),
    }),
  );
  const response = await get(`/${SLUG}`);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/public_profile');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_test');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_slug: SLUG });

  const h = response.headers;
  assert.equal(h.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(h.get('cache-control'), 'no-store');
  assert.equal(h.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(h.get('referrer-policy'), 'no-referrer');
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('set-cookie'), null);

  const html = await response.text();
  const escaped = '&lt;b&gt;토마토&lt;/b&gt;&amp;&quot;';
  assert.ok(html.startsWith('<!doctype html>\n<html lang="ko">'));
  assert.ok(html.includes(`<title>${escaped}</title>`));
  assert.ok(html.includes(`<meta property="og:title" content="${escaped}">`));
  assert.ok(html.includes('<meta property="og:type" content="profile">'));
  assert.ok(html.includes(`<meta property="og:url" content="https://me.to3mato.com/${SLUG}">`));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.ok(!html.includes('og:description'));
  assert.ok(!html.includes('<b>토마토'));
  assert.ok(
    html.includes(
      `src="https://example.supabase.co/storage/v1/object/public/profiles/${PHOTO}"`,
    ),
  );
  assert.ok(html.includes('<script src="/profile.js" defer></script>'));
  assert.ok(html.includes('<script src="/analytics.js" defer></script>'));
  // Inline style attributes move into one hashed <style> element.
  assert.ok(!/ style="/.test(html));
  const css = html.match(/<style>([^<]*)<\/style>/)[1];
  assert.ok(css.includes('background:#e58a6b !important'));
  const hash = createHash('sha256').update(css).digest('base64');
  const policy = h.get('content-security-policy');
  assert.equal(
    policy,
    `default-src 'none'; style-src 'self' 'sha256-${hash}'; font-src 'self'; script-src 'self' https://us-assets.i.posthog.com; connect-src https://us.i.posthog.com https://us-assets.i.posthog.com; img-src 'self' https://example.supabase.co; media-src https://example.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
  assert.ok(!policy.includes('unsafe-inline'));
});

test('HEAD returns headers without a body', async (t) => {
  stubFetch(t, () => json({ slug: SLUG, name: 'a', photo: null, snapshot: snapshot() }));
  const response = await get(`/${SLUG}`, 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('invalid slugs are 404 without calling Supabase', async (t) => {
  const calls = stubFetch(t, () => json(null));
  for (const path of ['/ABCDEFGH23', '/abcdefgh2', '/abcdefgh231', '/abcdefgh1o', '/abcdefgh23/x', '/favicon.ico']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(html.startsWith('<!doctype html>'));
    assert.equal(html.replace(/<[^>]*>/g, '').trim(), '');
  }
  assert.equal(calls.length, 0);
});

test('null profile and RPC 404 are 404', async (t) => {
  let reply = json(null);
  stubFetch(t, () => reply);
  assert.equal((await get(`/${SLUG}`)).status, 404);
  reply = json({ message: 'not found' }, 404);
  assert.equal((await get(`/${SLUG}`)).status, 404);
  // A row for another slug is not shown.
  reply = json({ slug: 'zzzzzzzzzz', name: 'x', snapshot: snapshot() });
  assert.equal((await get(`/${SLUG}`)).status, 404);
});

test('upstream failure is 503', async (t) => {
  let reply = () => new Response('boom', { status: 500 });
  stubFetch(t, () => reply());
  const response = await get(`/${SLUG}`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  reply = () => {
    throw new TypeError('network');
  };
  assert.equal((await get(`/${SLUG}`)).status, 503);
  reply = () => new Response('not json', { status: 200 });
  assert.equal((await get(`/${SLUG}`)).status, 503);
});

test('missing configuration is 503', async (t) => {
  const calls = stubFetch(t, () => json(null));
  const response = await worker.fetch(
    new Request(`https://me.to3mato.com/${SLUG}`),
    { SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' },
  );
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test('root redirects to the product site; other methods are rejected', async (t) => {
  const calls = stubFetch(t, () => json(null));
  const response = await get('/');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://to3mato.com');
  assert.equal((await get(`/${SLUG}`, 'POST')).status, 405);
  assert.equal((await get('/', 'POST')).status, 404);
  assert.equal(calls.length, 0);
});

test('bad photo and video paths are not turned into URLs', async (t) => {
  const weekStart = '2000-01-03';
  const bad = [
    'https://evil.example/x.jpg',
    '../other/photo.jpg',
    `${OWNER}/photo-x.jpg"><script>`,
    `${OWNER}/../../x.jpg`,
  ];
  for (const photo of bad) {
    stubFetch(t, () =>
      json({
        slug: SLUG,
        name: 'n',
        photo,
        snapshot: snapshot({ video: { path: photo, weekStart: today > weekStart ? today : weekStart } }),
      }),
    );
    const html = await (await get(`/${SLUG}`)).text();
    assert.ok(!html.includes('<img'), photo);
    assert.ok(!html.includes('<video'), photo);
    assert.ok(!html.includes('evil.example'), photo);
    assert.ok(!html.includes('storage/v1'), photo);
  }
});

test('a valid weekly video becomes the cover', async (t) => {
  const path = `${OWNER}/video-2026-w45.mp4`;
  stubFetch(t, () =>
    json({ slug: SLUG, name: 'n', snapshot: snapshot({ video: { path, weekStart: today } }) }),
  );
  const html = await (await get(`/${SLUG}`)).text();
  assert.ok(
    html.includes(`<video class="pp-video" src="https://example.supabase.co/storage/v1/object/public/profiles/${path}"`),
  );
});

test('malformed snapshots still render', async (t) => {
  stubFetch(t, () =>
    json({
      slug: SLUG,
      name: 'n',
      snapshot: {
        date: today,
        timeZone: 'Not/AZone',
        days: 'x',
        today: 'y',
        tasks: [{ title: 't', at: 'soon' }, { title: '<i>ok</i>', at: Date.now(), used: 'a', estimate: 1e9 }],
        projects: [null, { name: 'p', color: 'red', count: 'z' }],
      },
    }),
  );
  const response = await get(`/${SLUG}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('&lt;i&gt;ok&lt;/i&gt;'));
  stubFetch(t, () => json({ slug: SLUG, name: 'n', snapshot: { date: 5, days: [null, {}] } }));
  assert.equal((await get(`/${SLUG}`)).status, 200);
  stubFetch(t, () => json({ slug: SLUG, name: 'n', snapshot: null }));
  assert.equal((await get(`/${SLUG}`)).status, 200);
});

test('unknown inline styles are dropped', () => {
  const { body, css } = extractStyles(
    '<a style="grid-column:3"></a><b style="color:red;background:url(x)"></b><i style="grid-column:3"></i>',
  );
  assert.equal(body, '<a data-s="0"></a><b></b><i data-s="0"></i>');
  assert.equal(css, '[data-s="0"]{grid-column:3 !important}');
});
