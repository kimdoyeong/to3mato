import { writable } from 'svelte/store';
import type { AppState } from './types';

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

export function completedMoment(
  previous: AppState,
  next: AppState,
): Moment | null {
  const timer = previous.timer;
  if (
    !timer?.running ||
    timer.phase !== 'focus' ||
    next.records.length <= previous.records.length
  )
    return null;
  const record = next.records
    .slice(previous.records.length)
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

let database: Promise<IDBDatabase> | undefined;
export function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('to3mato-focus-log', 2);
    request.onupgradeneeded = () => {
      for (const name of [
        'clips',
        'summaries',
        'deliveries',
        'deliveryVideos',
      ]) {
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
export async function saveClip(clip: Clip) {
  const db = await openDatabase();
  const { blob, ...summary } = clip;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['clips', 'summaries'], 'readwrite');
    // Svelte state can be a Proxy; IndexedDB requires a plain cloneable object.
    tx.objectStore('clips').put({ ...clip });
    tx.objectStore('summaries').put(summary);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('저장 공간이 부족합니다.'));
    tx.onerror = () => reject(tx.error);
  });
  logRevision.update((value) => value + 1);
}
export async function listClips(): Promise<ClipSummary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('summaries')
      .objectStore('summaries')
      .getAll();
    request.onsuccess = () =>
      resolve(request.result.sort((a: Clip, b: Clip) => a.at - b.at));
    request.onerror = () => reject(request.error);
  });
}
export async function readClip(id: string): Promise<Clip> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('clips').objectStore('clips').get(id);
    request.onsuccess = () =>
      request.result
        ? resolve(request.result)
        : reject(new Error('영상을 찾을 수 없습니다.'));
    request.onerror = () => reject(request.error);
  });
}
export async function deleteClip(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['clips', 'summaries'], 'readwrite');
    tx.objectStore('clips').delete(id);
    tx.objectStore('summaries').delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  logRevision.update((value) => value + 1);
}
export function weekBounds(offset = 0, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
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
