// me.to3mato.com: public profile pages rendered from the anonymous `public_profile` RPC.
// Static files (styles, fonts, profile.js) are served by Workers static assets before
// this code runs; see scripts/build-profile-worker.mjs.
import {
  escapeHtml,
  profileUrl,
  renderProfile,
} from '../../../src/lib/public-profile.mjs';

const SLUG = /^[a-hjkmnp-z2-9]{10}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Same shapes the Storage upload policy accepts, plus the owner folder.
const PHOTO_PATH = new RegExp(`^${UUID}/photo-[0-9a-f-]{36}\\.jpg$`);
const VIDEO_PATH = new RegExp(`^${UUID}/video-[A-Za-z0-9_-]{1,80}\\.(mp4|webm)$`);
// The only inline style values renderProfile emits. Anything else is dropped.
const STYLE_VALUE =
  /^(?:grid-(?:column|row):\d{1,2}(?:;grid-row:\d{1,2})?|background:#[0-9a-fA-F]{6})$/;
const SITE = 'https://to3mato.com';
const STYLESHEETS = [
  '/fonts/gamja-flower/index.css',
  '/fonts/poor-story/index.css',
  '/styles/tokens.css',
  '/styles/components.css',
  '/styles/public-profile.css',
  '/styles/page.css',
];

function supabaseOrigin(env) {
  try {
    const url = new URL(env.SUPABASE_URL);
    return url.protocol === 'https:' || url.hostname === '127.0.0.1'
      ? url.origin
      : '';
  } catch {
    return '';
  }
}

function csp(origin, styleHashes = []) {
  const styles = ["'self'", ...styleHashes.map((hash) => `'sha256-${hash}'`)];
  return [
    "default-src 'none'",
    `style-src ${styles.join(' ')}`,
    "font-src 'self'",
    "script-src 'self'",
    `img-src 'self'${origin ? ` ${origin}` : ''}`,
    `media-src ${origin || "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function headers(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}

function htmlResponse(request, status, body, policy) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': policy,
    }),
  });
}

const page = (head, body) =>
  `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${head}
</head>
<body>
${body}
</body>
</html>
`;

// No visible text until the 404 copy is approved.
function notFound(request) {
  const head = '<link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/page.css">';
  return htmlResponse(request, 404, page(head, ''), csp(''));
}

function unavailable(request) {
  const head = '<link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/page.css">';
  return new Response(request.method === 'HEAD' ? null : page(head, ''), {
    status: 503,
    headers: headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp(''),
      'Retry-After': '30',
    }),
  });
}

const storageUrl = (origin, path) =>
  `${origin}/storage/v1/object/public/profiles/${path}`;

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => (typeof value === 'string' ? value : '');

function validZone(zone) {
  if (typeof zone !== 'string' || !zone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/** Coerces the stored snapshot into the shapes renderProfile expects. */
export function cleanSnapshot(raw) {
  const snapshot = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) ? snapshot.date : '1970-01-01';
  const clean = {
    date,
    timeZone: validZone(snapshot.timeZone),
    days: Array.isArray(snapshot.days) ? snapshot.days.slice(-140).map(finite) : [],
    today: finite(snapshot.today),
  };
  if (snapshot.focusSeconds !== undefined)
    clean.focusSeconds = Math.max(0, finite(snapshot.focusSeconds));
  if (Array.isArray(snapshot.projects))
    clean.projects = snapshot.projects
      .filter((p) => p && typeof p === 'object')
      .slice(0, 20)
      .map((p) => ({ name: text(p.name), color: text(p.color), count: finite(p.count) }));
  if (Array.isArray(snapshot.tasks))
    clean.tasks = snapshot.tasks
      .filter((t) => t && typeof t === 'object' && Number.isFinite(t.at))
      .slice(0, 30)
      .map((t) => {
        const item = {
          title: text(t.title),
          used: Math.max(0, finite(t.used)),
          estimate: Math.max(0, finite(t.estimate)),
          at: t.at,
        };
        if (t.project && typeof t.project === 'object')
          item.project = { name: text(t.project.name), color: text(t.project.color) };
        if (text(t.note)) item.note = text(t.note);
        return item;
      });
  const video = snapshot.video;
  if (video && typeof video === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(video.weekStart))
    clean.video = { path: text(video.path), weekStart: video.weekStart };
  return clean;
}

/**
 * Moves renderProfile's inline style attributes into one <style> element so the
 * CSP can allow it by hash instead of 'unsafe-inline'. Values outside the known
 * set are dropped.
 */
export function extractStyles(html) {
  const values = new Map();
  const body = html.replace(/ style="([^"]*)"/g, (_, value) => {
    if (!STYLE_VALUE.test(value)) return '';
    if (!values.has(value)) values.set(value, values.size);
    return ` data-s="${values.get(value)}"`;
  });
  const css = [...values]
    .map(([value, index]) => {
      const rules = value
        .split(';')
        .map((rule) => `${rule} !important`)
        .join(';');
      return `[data-s="${index}"]{${rules}}`;
    })
    .join('');
  return { body, css };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadProfile(env, slug) {
  const response = await fetch(`${supabaseOrigin(env)}/rest/v1/rpc/public_profile`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`public_profile ${response.status}`);
  const data = await response.json();
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

export async function renderPage(raw, slug, origin, now = new Date()) {
  const name = text(raw.name);
  const snapshot = cleanSnapshot(raw.snapshot);
  const photoUrl =
    typeof raw.photo === 'string' && PHOTO_PATH.test(raw.photo)
      ? storageUrl(origin, raw.photo)
      : '';
  const videoUrl =
    snapshot.video && VIDEO_PATH.test(snapshot.video.path)
      ? storageUrl(origin, snapshot.video.path)
      : '';
  const { body, css } = extractStyles(
    renderProfile({ slug, name, photoUrl, videoUrl, snapshot }, { now }),
  );
  const title = escapeHtml(name);
  const head = [
    `<title>${title}</title>`,
    `<meta property="og:title" content="${title}">`,
    '<meta property="og:type" content="profile">',
    `<meta property="og:url" content="${escapeHtml(profileUrl(slug))}">`,
    ...STYLESHEETS.map((href) => `<link rel="stylesheet" href="${href}">`),
    css ? `<style>${css}</style>` : '',
    '<script src="/profile.js" defer></script>',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    html: page(head, body),
    policy: csp(origin, css ? [await sha256(css)] : []),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (path === '/') {
      if (!read) return notFound(request);
      return new Response(null, {
        status: 302,
        headers: headers({ Location: SITE }),
      });
    }
    const slug = path.slice(1);
    if (!SLUG.test(slug)) return notFound(request);
    if (!read)
      return new Response(null, {
        status: 405,
        headers: headers({ Allow: 'GET, HEAD' }),
      });
    const origin = supabaseOrigin(env);
    if (!origin || !env.SUPABASE_PUBLISHABLE_KEY) return unavailable(request);
    let profile;
    try {
      profile = await loadProfile(env, slug);
    } catch {
      return unavailable(request);
    }
    if (!profile || profile.slug !== slug || !text(profile.name))
      return notFound(request);
    try {
      const { html, policy } = await renderPage(profile, slug, origin, new Date());
      return htmlResponse(request, 200, html, policy);
    } catch {
      return unavailable(request);
    }
  },
};
