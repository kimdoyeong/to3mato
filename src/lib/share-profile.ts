// Public profile state in the renderer: the owner's profile row, the automatic
// snapshot upload while sharing, and the actions behind the share UI.
import { get, writable } from 'svelte/store';
import { state as appState, now } from './client';
import { deliveries, readDelivery, type Delivery } from './deliveries';
import { calendarTimeZone, dateInZone } from './calendar-time.mjs';
import {
  buildSnapshot,
  cleanName,
  DEFAULT_VISIBILITY,
  lastWeekStart,
  normalizeVisibility,
} from './public-profile.mjs';
import { COPY } from './share-copy';
import { errorText } from './account';
import type { PublicProfile, Visibility } from './types';

export const signedIn = writable(false);
export const profile = writable<PublicProfile | null>(null);
export const profileLoaded = writable(false);
export const profilePhoto = writable('');
export const visibility = writable<Visibility>({ ...DEFAULT_VISIBILITY });
export const publishError = writable('');
/** Asks the share dialog to open. */
export const dialogRequest = writable<'first' | 'edit' | null>(null);

const api = () => window.to3mato?.profile;
export const timeZone = () =>
  calendarTimeZone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => dateInZone(new Date(get(now)), timeZone());

/** The delivery covering last week, when one exists. Older weeks fall back to the gradient. */
export function freshDelivery(list: Delivery[] = get(deliveries)) {
  const target = lastWeekStart(today());
  return (
    list.find((d) => dateInZone(new Date(d.start), timeZone()) === target) ||
    null
  );
}

let uploaded: { id: string; path: string } | null = null;
async function videoFor(vis: Visibility) {
  if (!vis.video) return null;
  const delivery = freshDelivery();
  if (!delivery) return null;
  if (uploaded?.id !== delivery.id) {
    const blob = await readDelivery(delivery.id);
    const path = await api()!.uploadVideo(
      delivery.id,
      blob.type || 'video/webm',
      await blob.arrayBuffer(),
    );
    uploaded = { id: delivery.id, path };
  }
  return {
    path: uploaded.path,
    weekStart: dateInZone(new Date(delivery.start), timeZone()),
  };
}

async function snapshotFor(vis: Visibility) {
  return buildSnapshot({
    state: get(appState),
    visibility: vis,
    now: new Date(get(now)),
    timeZone: timeZone(),
    video: await videoFor(vis),
  });
}

function apply(next: PublicProfile | null) {
  profile.set(next);
  if (next) visibility.set(normalizeVisibility(next.visibility));
}
async function loadPhoto(next: PublicProfile | null) {
  profilePhoto.set(next?.photo ? await api()!.photoPreview(next.photo) : '');
}

export async function loadProfile() {
  const next = await api()!.load();
  apply(next);
  profileLoaded.set(true);
  lastKey = '';
  await loadPhoto(next);
}

/** Makes sure a (not yet shared) row exists so the preview knows its link and gradient. */
export async function ensureProfile() {
  if (get(profile)) return get(profile)!;
  const next = await api()!.save({ visibility: get(visibility), snapshot: null });
  apply(next);
  return next;
}

/** Copies the link. Shares again with the same link after a stop. */
export async function copyProfileLink() {
  let current = get(profile);
  if (!current?.name) throw new Error('name required');
  if (!current.active) {
    current = await api()!.save({
      visibility: get(visibility),
      snapshot: await snapshotFor(get(visibility)),
      activate: true,
    });
    apply(current);
    lastKey = '';
  }
  await api()!.copyLink(current.slug);
}

/** First share: name, optional photo and visibility in one step, then copy. */
export async function firstShare(input: {
  name: string;
  photo: string; // 'keep' | 'remove' | token
  visibility: Visibility;
}) {
  const name = cleanName(input.name);
  if (!name) throw new Error(COPY.nameRequired);
  const vis = normalizeVisibility(input.visibility);
  const next = await api()!.save({
    name,
    photo: input.photo,
    visibility: vis,
    snapshot: await snapshotFor(vis),
    activate: true,
  });
  apply(next);
  lastKey = '';
  await loadPhoto(next);
  await api()!.copyLink(next.slug);
}

export async function editIdentity(input: { name: string; photo: string }) {
  const name = cleanName(input.name);
  if (!name) throw new Error(COPY.nameRequired);
  const next = await api()!.save({
    name,
    photo: input.photo,
    visibility: get(visibility),
    snapshot: null,
  });
  apply(next);
  await loadPhoto(next);
}

export async function setVisibility(key: keyof Visibility, value: boolean) {
  const vis = { ...get(visibility), [key]: value };
  visibility.set(vis);
  try {
    const current = get(profile);
    const next = await api()!.save({
      visibility: vis,
      snapshot: current?.active ? await snapshotFor(vis) : null,
    });
    if (!vis.video) {
      uploaded = null;
      await api()!.removeVideos().catch(() => {});
    }
    apply(next);
    lastKey = '';
  } catch (failure) {
    visibility.set(normalizeVisibility({ ...vis, [key]: !value }));
    throw failure;
  }
}

export async function stopSharing() {
  const next = await api()!.stop();
  uploaded = null;
  apply(next);
  lastKey = '';
}

// ───────── automatic updates ─────────
let lastKey = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
function schedule(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => void publish(), delay);
}
async function publish() {
  const current = get(profile);
  if (!current?.active || !get(signedIn) || running) return;
  running = true;
  try {
    const vis = get(visibility);
    const snapshot = await snapshotFor(vis);
    const key = JSON.stringify([snapshot, vis]);
    if (key === lastKey) return;
    apply(await api()!.save({ visibility: vis, snapshot }));
    lastKey = key;
    publishError.set('');
  } catch {
    publishError.set(COPY.publishFailed);
    schedule(60_000);
  } finally {
    running = false;
  }
}

/** Starts listening to the account and app state. Returns a cleanup. */
export function startShareProfile() {
  if (!api()) return () => {};
  let user = '';
  let day = '';
  const stops = [
    window.to3mato!.account.subscribe((status) => {
      const id = status.user?.id || '';
      signedIn.set(!!id);
      if (id === user) return;
      user = id;
      uploaded = null;
      apply(null);
      profileLoaded.set(false);
      profilePhoto.set('');
      publishError.set('');
      if (id) void loadProfile().catch((failure) => console.error(errorText(failure)));
    }),
    appState.subscribe(() => schedule()),
    deliveries.subscribe(() => schedule()),
    now.subscribe(() => {
      const current = today();
      if (current !== day) {
        day = current;
        schedule(0);
      }
    }),
  ];
  return () => {
    clearTimeout(timer);
    stops.forEach((stop) => stop());
  };
}
