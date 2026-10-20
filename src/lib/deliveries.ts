import { get, writable } from 'svelte/store';
import {
  listClips,
  openDatabase,
  weekBounds,
  logRevision,
  mediaError,
  type ClipSummary,
} from './focus-log';
import { exportWeek } from './video';
import { now } from './client';
import { localDate } from './domain.mjs';

export type Delivery = {
  id: string;
  start: number;
  end: number;
  deliveredAt: number;
  clipCount: number;
  duration: number;
  seen: boolean;
};
export const deliveries = writable<Delivery[]>([]);
export const deliveryWork = writable<{ id: string; progress: number } | null>(
  null,
);
export const deliveryError = writable('');
export function deliveryTime(end: Date) {
  const date = new Date(end);
  date.setHours(9, 0, 0, 0);
  return date;
}
export async function listDeliveries(): Promise<Delivery[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('deliveries')
      .objectStore('deliveries')
      .getAll();
    request.onsuccess = () =>
      resolve(
        request.result.sort((a: Delivery, b: Delivery) => b.start - a.start),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function readDelivery(id: string): Promise<Blob> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('deliveryVideos')
      .objectStore('deliveryVideos')
      .get(id);
    request.onsuccess = () =>
      request.result
        ? resolve(request.result.blob)
        : reject(new Error('배달된 영상을 찾을 수 없습니다.'));
    request.onerror = () => reject(request.error);
  });
}
async function saveDelivery(delivery: Delivery, blob: Blob) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['deliveries', 'deliveryVideos'], 'readwrite');
    tx.objectStore('deliveries').put(delivery);
    tx.objectStore('deliveryVideos').put({ id: delivery.id, blob });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  deliveries.set(await listDeliveries());
}
export async function markDeliverySeen(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('deliveries', 'readwrite'),
      store = tx.objectStore('deliveries');
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, seen: true });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  deliveries.set(await listDeliveries());
}
export function dueWeeks(
  clips: ClipSummary[],
  delivered: Delivery[],
  time: number,
) {
  const groups = new Map<
    string,
    { start: Date; end: Date; clips: ClipSummary[] }
  >();
  for (const clip of clips) {
    const { start, end } = weekBounds(0, new Date(clip.at));
    const id = localDate(start);
    if (
      deliveryTime(end).getTime() > time ||
      delivered.some((item) => item.id === id)
    )
      continue;
    if (!groups.has(id)) groups.set(id, { start, end, clips: [] });
    groups.get(id)!.clips.push(clip);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, group]) => ({
      id,
      ...group,
      clips: group.clips.sort((a, b) => a.at - b.at),
    }));
}

// Runs inside the app. Missed deliveries are prepared on the next visible launch.
export function startDeliveries() {
  let disposed = false,
    busy = false,
    controller: AbortController | undefined,
    lastCheck = 0;
  async function check(force = false) {
    const time = Date.now();
    if (
      disposed ||
      busy ||
      document.hidden ||
      (!force && time - lastCheck < 30000)
    )
      return;
    busy = true;
    lastCheck = time;
    try {
      const existing = await listDeliveries();
      if (disposed) return;
      deliveries.set(existing);
      const pending = dueWeeks(await listClips(), existing, time);
      for (const week of pending) {
        if (disposed || document.hidden) break;
        // Coordinate browser tabs so one weekly parcel is prepared only once.
        const prepare = async () => {
          if (
            (await listDeliveries()).some((delivery) => delivery.id === week.id)
          )
            return;
          if (disposed || document.hidden) return;
          controller = new AbortController();
          deliveryError.set('');
          deliveryWork.set({ id: week.id, progress: 0 });
          const blob = await exportWeek(
            week.clips,
            controller.signal,
            (progress) => deliveryWork.set({ id: week.id, progress }),
          );
          controller.signal.throwIfAborted();
          await saveDelivery(
            {
              id: week.id,
              start: week.start.getTime(),
              end: week.end.getTime(),
              deliveredAt: Date.now(),
              clipCount: week.clips.length,
              duration: week.clips.reduce(
                (total, clip) => total + clip.duration,
                0,
              ),
              seen: false,
            },
            blob,
          );
        };
        if (navigator.locks)
          await navigator.locks.request(
            'to3mato-weekly-delivery',
            { ifAvailable: true },
            async (lock) => {
              if (lock) await prepare();
            },
          );
        else await prepare();
      }
    } catch (cause) {
      if (!controller?.signal.aborted && !disposed)
        deliveryError.set(mediaError(cause));
    } finally {
      busy = false;
      deliveryWork.set(null);
    }
  }
  const offClock = now.subscribe(() => {
    void check();
  });
  const offClips = logRevision.subscribe(() => {
    void check(true);
  });
  const visibility = () => {
    if (document.hidden) controller?.abort();
    else void check(true);
  };
  document.addEventListener('visibilitychange', visibility);
  return () => {
    disposed = true;
    controller?.abort();
    offClock();
    offClips();
    document.removeEventListener('visibilitychange', visibility);
  };
}
