// Pause control for the weekly video cover. Loaded with `defer`; no inline script.
(() => {
  const video = document.querySelector('.pp-video');
  const button = document.querySelector('.pp-pause');
  if (!video || !button) return;
  // Same paths as icon('pause') / icon('play') in src/lib/public-profile.mjs.
  const ICONS = {
    pause: '<path d="M8 5v14m8-14v14" stroke-width="3"/>',
    play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  };
  const svg = button.querySelector('svg');
  const show = (paused) => {
    if (svg) svg.innerHTML = ICONS[paused ? 'play' : 'pause'];
    const label = button.getAttribute(paused ? 'data-label-play' : 'data-label-pause');
    if (label) button.setAttribute('aria-label', label);
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let chosen = false;
  video.addEventListener('play', () => {
    // Autoplay can start after this script runs; keep it stopped until the visitor asks.
    if (reduce && !chosen) video.pause();
    else show(false);
  });
  video.addEventListener('pause', () => show(true));
  button.addEventListener('click', () => {
    chosen = true;
    if (video.paused) video.play().catch(() => show(true));
    else video.pause();
  });
  if (reduce) {
    video.removeAttribute('autoplay');
    video.pause();
    show(true);
  } else {
    show(video.paused && !video.autoplay);
  }
})();
