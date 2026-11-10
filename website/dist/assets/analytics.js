// Visit counts for to3mato.com and me.to3mato.com (PostHog, cookieless).
// Nothing is stored in the browser: no cookies, no local or session storage.
// KEY and HOST must match src/lib/analytics.mjs; tests/analytics-web.test.mjs
// checks it. An empty key loads nothing.
(() => {
  const KEY = 'phc_vRtA3xJbYkjXQoMVQmZM8nFhEGbRjJnNBtuEpn2chJ5j';
  const HOST = 'https://us.i.posthog.com';
  const local = ['', 'localhost', '127.0.0.1'].includes(location.hostname);
  if (!KEY || local) return;
  const script = document.createElement('script');
  script.src =
    HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    const posthog = window.posthog;
    if (!posthog || typeof posthog.init !== 'function') return;
    posthog.init(KEY, {
      api_host: HOST,
      cookieless_mode: 'always',
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: true,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
    });
    document.addEventListener('click', (event) => {
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href$=".dmg"]')
          : null;
      if (link)
        posthog.capture('download_clicked', {
          file: link.pathname.split('/').pop(),
        });
    });
  };
  document.head.appendChild(script);
})();
