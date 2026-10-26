import { writable } from 'svelte/store';
import type { AppState } from './types';
import { currentSync } from './sync-context';
import { calendarWeek } from './calendar-time.mjs';
import {
  openMediaDatabase,
  queueMedia,
  flushMedia,
  remoteBlob,
  mediaRevision,
  allRows,
} from './media-sync';

export type Moment = {
  id: string;
  taskTitle: string;
  at: number;
  focusSeconds: number;
};
export type Clip = Moment & { duration: number; blob: Blob; thumbnail: Blob };
export type ClipSummary = Omit<Clip, 'blob'>;
export const capturePrompt = writable<Moment | null>(null);
export const logRevision = writable(0);
mediaRevision.subscribe(() => logRevision.update((value) => value + 1));

export function completedMoment(
  previous: AppState,
  next: AppState,
): Moment | null {
  const timer = previous.timer;
  if (
    next.syncContext &&
    (next.syncContext.controller !== next.syncContext.deviceId ||
      previous.syncContext?.owner !== next.syncContext.owner)
  )
    return null;
  if (
    !timer?.running ||
    timer.phase !== 'focus' ||
    next.records.length <= previous.records.length
  )
    return null;
  const record = next.records
    .filter((record) => !previous.records.some((old) => old.id === record.id))
    .find(
      (r) =>
        r.taskId === timer.taskId &&
        r.duration === timer.duration &&
        r.seconds >= timer.duration &&
        timer.elapsed + (r.at - timer.startedAt) / 1000 >= timer.duration,
    );
  return record
    ? {
        id: `${record.taskId}:${record.at}`,
        taskTitle:
          previous.tasks.find((task) => task.id === record.taskId)?.title ||
          '삭제된 할 일',
        at: record.at,
        focusSeconds: record.seconds,
      }
    : null;
}

export function openDatabase() {
  return openMediaDatabase();
}
export async function saveClip(clip: Clip) {
  const db = await openDatabase();
  const { blob, ...summary } = clip;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['clips', 'summaries', 'syncQueue'], 'readwrite');
    // Svelte state can be a Proxy; IndexedDB requires a plain cloneable object.
    tx.objectStore('clips').put({ ...clip });
    tx.objectStore('summaries').put(summary);
    const { id, thumbnail, ...fields } = summary;
    queueMedia(tx, 'clips', id, fields, blob, thumbnail);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('저장 공간이 부족합니다.'));
    tx.onerror = () => reject(tx.error);
  });
  logRevision.update((value) => value + 1);
  void flushMedia();
}
export async function listClips(): Promise<ClipSummary[]> {
  const db = await openDatabase();
  const local: ClipSummary[] = await new Promise((resolve, reject) => {
    const request = db
      .transaction('summaries')
      .objectStore('summaries')
      .getAll();
    request.onsuccess = () =>
      resolve(request.result.sort((a: Clip, b: Clip) => a.at - b.at));
    request.onerror = () => reject(request.error);
  });
  if (!currentSync()) return local;
  const rows = currentSync()!.extras.clips || [];
  const pending = new Set(
    (await allRows(db, 'syncQueue'))
      .filter((job) => job.entity === 'clips' && !job.deleted)
      .map((job) => job.entityId),
  );
  const merged = new Map(
    local
      .filter(
        (row) =>
          pending.has(row.id) || rows.some((remote) => remote.id === row.id),
      )
      .map((row) => [row.id, row]),
  );
  for (const row of rows) {
    const cached = merged.get(row.id);
    merged.set(row.id, {
      ...row,
      thumbnail:
        cached?.thumbnail || (await remoteBlob(row.thumbnailId)) || new Blob(),
    } as ClipSummary);
  }
  return [...merged.values()].sort((a, b) => a.at - b.at);
}
export async function readClip(id: string): Promise<Clip> {
  const db = await openDatabase();
  if (
    currentSync() &&
    !currentSync()!.extras.clips.some((row) => row.id === id) &&
    !(await allRows(db, 'syncQueue')).some(
      (job) => job.entity === 'clips' && job.entityId === id && !job.deleted,
    )
  )
    throw new Error('영상을 찾을 수 없습니다.');
  const local: Clip | null = await new Promise((resolve, reject) => {
    const request = db.transaction('clips').objectStore('clips').get(id);
    request.onsuccess = () =>
      request.result ? resolve(request.result) : resolve(null);
    request.onerror = () => reject(request.error);
  });
  if (local) return local;
  const row = currentSync()?.extras.clips.find((row) => row.id === id);
  if (row) {
    const blob = await remoteBlob(row.assetId),
      thumbnail = await remoteBlob(row.thumbnailId);
    if (blob && thumbnail) return { ...row, blob, thumbnail } as Clip;
  }
  throw new Error('영상을 찾을 수 없습니다.');
}
export async function deleteClip(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['clips', 'summaries', 'syncQueue'], 'readwrite');
    tx.objectStore('clips').delete(id);
    tx.objectStore('summaries').delete(id);
    queueMedia(tx, 'clips', id, {}, undefined, undefined, true);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  logRevision.update((value) => value + 1);
  void flushMedia();
}
export function weekBounds(offset = 0, now = new Date()) {
  return calendarWeek(offset, now);
}
export function mediaError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return '카메라 권한이 필요합니다. 브라우저 또는 시스템 설정에서 카메라 접근을 허용한 뒤 다시 시도하세요.';
    if (error.name === 'NotFoundError')
      return '연결된 카메라가 없습니다. 웹캠을 연결한 뒤 다시 시도하세요.';
    if (error.name === 'NotReadableError')
      return '카메라를 열 수 없습니다. 다른 앱에서 사용 중인지 확인하세요.';
    if (error.name === 'QuotaExceededError')
      return '저장 공간이 부족합니다. 이전 영상을 내보내고 삭제한 뒤 다시 저장하세요.';
  }
  return error instanceof Error
    ? error.message
    : '영상을 처리하지 못했습니다. 다시 시도하세요.';
}
