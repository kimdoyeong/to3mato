// The desktop app keeps first-run state in the main process (onboarding.json
// beside the database). The browser preview keeps it in localStorage.
const KEY = 'to3mato-onboarding-v1';
const STATE_KEYS = ['to3mato-state-v1', 'to3mato-demo-v1'];

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
// Read on import, before the client writes its first state, so an existing
// browser profile is told apart from a fresh one. A fresh profile is marked
// pending at once: after the first save it would otherwise look existing.
const browserState = (() => {
  const store = storage();
  if (!store) return 'done';
  try {
    const stored = store.getItem(KEY);
    if (stored) return stored === 'done' ? 'done' : 'fresh';
    if (STATE_KEYS.some((key) => store.getItem(key))) return 'existing';
    store.setItem(KEY, 'pending');
    return 'fresh';
  } catch {
    return 'done';
  }
})();

export async function onboardingPending(): Promise<boolean> {
  if (window.to3mato) return window.to3mato.onboarding.status();
  if (browserState === 'existing') {
    try {
      storage()?.setItem(KEY, 'done');
    } catch {}
  }
  return browserState === 'fresh';
}

export async function finishOnboarding() {
  if (window.to3mato) return window.to3mato.onboarding.finish();
  try {
    storage()?.setItem(KEY, 'done');
  } catch {}
}
