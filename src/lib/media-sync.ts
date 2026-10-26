import { writable } from 'svelte/store';
import { currentSync, dataScope, syncContext } from './sync-context';
const databases = new Map<string, Promise<IDBDatabase>>();
export const mediaRevision = writable(0);
export const mediaSyncError = writable('');
const SEQUENCE_KEY = '__sequence__';
const sequences = new Map<string, number>();
export function openMediaDatabase(scope = dataScope()): Promise<IDBDatabase> {
  if (!databases.has(scope))
    databases.set(
      scope,
      new Promise((resolve, reject) => {
        const request = indexedDB.open(
          scope === 'local'
            ? 'to3mato-focus-log'
            : `to3mato-focus-log-${scope}`,
          3,
        );
        request.onupgradeneeded = () => {
          for (const name of [
            'clips',
            'summaries',
            'deliveries',
            'deliveryVideos',
            'syncQueue',
          ])
            if (!request.result.objectStoreNames.contains(name))
              request.result.createObjectStore(name, { keyPath: 'id' });
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            databases.delete(scope);
          };
          resolve(request.result);
        };
        request.onerror = () => {
          databases.delete(scope);
          reject(request.error);
        };
      }),
    );
  return databases.get(scope)!;
}
export function allRows<T = any>(db: IDBDatabase, name: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(name).objectStore(name).getAll();
    request.onsuccess = () =>
      resolve(
        name === 'syncQueue'
          ? request.result
              .filter((row) => row.id !== SEQUENCE_KEY)
              .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
          : request.result,
      );
    request.onerror = () => reject(request.error);
  });
}
export async function remoteBlob(id: string): Promise<Blob | null> {
  if (!window.to3mato?.sync || !currentSync() || !id) return null;
  const scope = dataScope();
  const asset = await window.to3mato.sync.readAsset(id, scope);
  if (scope !== dataScope() || !asset) return null;
  return new Blob([new Uint8Array(asset.bytes)], { type: asset.mime });
}
async function uploadBlob(blob: Blob, scope: string, operationId: string) {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const mime = blob.type.split(';')[0];
  const extension =
    mime === 'video/mp4'
      ? 'mp4'
      : mime === 'video/webm'
        ? 'webm'
        : mime === 'image/png'
          ? 'png'
          : 'jpg';
  if (scope !== dataScope()) throw new Error('계정이 변경되었습니다.');
  return window.to3mato!.sync.putAsset(
    `${hex.slice(0, 32)}-${operationId}.${extension}`,
    mime,
    bytes,
    scope,
  );
}
let flush: Promise<void> | null = null;
export function flushMedia(): Promise<void> {
  if (flush || !currentSync() || !window.to3mato?.sync)
    return flush || Promise.resolve();
  const scope = dataScope();
  flush = (async () => {
    const db = await openMediaDatabase(scope);
    const jobs = await allRows(db, 'syncQueue');
    const deleted = new Set(
      jobs
        .filter((job) => job.deleted)
        .map((job) => `${job.entity}:${job.entityId}`),
    );
    const blocked = new Set<string>();
    let failure = '';
    for (const job of jobs) {
      if (scope !== dataScope()) break;
      const entityKey = `${job.entity}:${job.entityId}`;
      if (blocked.has(entityKey) && !job.deleted) continue;
      try {
        if (job.deleted || !deleted.has(entityKey)) {
          const fields = { ...job.fields };
          if (job.blob)
            fields.assetId = await uploadBlob(job.blob, scope, job.id);
          if (job.thumbnail)
            fields.thumbnailId = await uploadBlob(
              job.thumbnail,
              scope,
              job.id + '-thumb',
            );
          if (scope !== dataScope()) break;
          await window.to3mato!.sync.extra(
            job.entity,
            job.entityId,
            fields,
            job.deleted || false,
            scope,
          );
        }
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('syncQueue', 'readwrite');
          // A later edit to the same entity has its own queue ID and survives this ack.
          tx.objectStore('syncQueue').delete(job.id);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } catch (error) {
        blocked.add(entityKey);
        failure ||=
          error instanceof Error
            ? error.message
            : '파일을 동기화하지 못했습니다.';
      }
    }
    if (scope === dataScope()) mediaSyncError.set(failure);
  })()
    .catch((error) =>
      mediaSyncError.set(
        error instanceof Error
          ? error.message
          : '파일을 동기화하지 못했습니다.',
      ),
    )
    .finally(() => {
      flush = null;
    });
  return flush;
}
export function queueMedia(
  tx: IDBTransaction,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
  blob?: Blob,
  thumbnail?: Blob,
  deleted = false,
) {
  if (!currentSync()) return;
  const store = tx.objectStore('syncQueue');
  const job = {
    id: crypto.randomUUID(),
    entity,
    entityId: id,
    fields,
    blob,
    thumbnail,
    deleted,
  };
  // The durable counter preserves edit order across windows, restarts and wall-clock changes.
  const request = store.get(SEQUENCE_KEY);
  request.onsuccess = () => {
    const sequence =
      Math.max(request.result?.value || 0, sequences.get(tx.db.name) || 0) + 1;
    sequences.set(tx.db.name, sequence);
    store.put({ id: SEQUENCE_KEY, value: sequence });
    store.put({ ...job, sequence });
  };
}
/** Copy all renderer media before the first account adoption; source is retained. */
export async function backupMedia(scope = dataScope()) {
  const source = await openMediaDatabase(scope);
  const snapshot = Object.fromEntries(
    await Promise.all(
      ['clips', 'summaries', 'deliveries', 'deliveryVideos', 'syncQueue'].map(
        async (name) => [name, await allRows(source, name)],
      ),
    ),
  );
  const backup = await openMediaDatabase(`backup-${scope}`);
  await writeSnapshot(backup, snapshot);
  return snapshot;
}
async function writeSnapshot(db: IDBDatabase, snapshot: Record<string, any[]>) {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(Object.keys(snapshot), 'readwrite');
    for (const [name, rows] of Object.entries(snapshot))
      for (const row of rows) tx.objectStore(name).put(row);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export async function adoptMedia(snapshot: Record<string, any[]>) {
  const db = await openMediaDatabase();
  await writeSnapshot(db, snapshot);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    for (const clip of snapshot.clips) {
      const { id, blob, thumbnail, ...fields } = clip;
      queueMedia(tx, 'clips', id, fields, blob, thumbnail);
    }
    for (const delivery of snapshot.deliveries) {
      const { id, ...fields } = delivery;
      const video = snapshot.deliveryVideos.find((row) => row.id === id);
      queueMedia(
        tx,
        'deliveries',
        id,
        { ...fields, generation: 1 },
        video?.blob,
      );
    }
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  void flushMedia();
}
let lastExtras = '';
syncContext.subscribe((context) => {
  const signature = JSON.stringify([context?.owner, context?.extras]);
  if (signature !== lastExtras) {
    lastExtras = signature;
    mediaRevision.update((n) => n + 1);
  }
  if (context) void flushMedia();
});
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushMedia());
  setInterval(() => void flushMedia(), 30000);
}
