import { writable } from 'svelte/store';
import { send, notify, isDesktop } from './client';
import { dataScope } from './sync-context';
import { mediaRevision } from './media-sync';

// Desktop copies the chosen file into the app data folder and the project
// keeps its file name. The browser preview keeps a data URL in IndexedDB
// under a generated name, so `project.image` has the same shape in both.
const DB = 'to3mato-project-images';
const STORE = 'images';
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** Bumps whenever an image changes so covers reload. */
export const imageRevision = writable(0);
mediaRevision.subscribe(() => imageRevision.update((n) => n + 1));
const cache = new Map<string, string>();

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function readBrowserImage(name: string) {
  return new Promise<string>((resolve) => {
    openDatabase()
      .then((db) => {
        const request = db.transaction(STORE).objectStore(STORE).get(name);
        request.onsuccess = () => {
          resolve(typeof request.result === 'string' ? request.result : '');
          db.close();
        };
        request.onerror = () => {
          resolve('');
          db.close();
        };
      })
      .catch(() => resolve(''));
  });
}
function writeBrowserImage(name: string, dataUrl: string) {
  return new Promise<void>((resolve, reject) => {
    openDatabase()
      .then((db) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(dataUrl, name);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
      .catch(reject);
  });
}
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Resolve a project's image to a data URL, or '' when it has none. */
export async function loadProjectImage(name: string): Promise<string> {
  if (!name) return '';
  const cacheKey = `${dataScope()}:${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let url = '';
  try {
    url = isDesktop
      ? await window.to3mato!.readProjectImage(name)
      : await readBrowserImage(name);
  } catch {
    url = '';
  }
  if (url) cache.set(cacheKey, url);
  return url;
}

/** Desktop: open the file dialog, copy the file and save the name. */
export async function pickProjectImage(projectId: string, projectName: string) {
  try {
    const name = await window.to3mato!.pickProjectImage();
    if (!name) return;
    await saveImage(projectId, projectName, name);
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message.replace(
            /^Error invoking remote method 'image:pick': (?:Error: )?/,
            '',
          )
        : '이미지를 불러오지 못했습니다.',
    );
  }
}

/** Browser: keep the chosen file as a data URL under a generated name. */
export async function storeProjectImage(
  projectId: string,
  projectName: string,
  file: File,
) {
  const extension = TYPES[file.type];
  if (!extension) {
    notify('png, jpg, webp, gif 이미지만 사용할 수 있습니다.');
    return;
  }
  if (file.size > MAX_BYTES) {
    notify('이미지 크기는 10MB 이하여야 합니다.');
    return;
  }
  try {
    const name = `browser-${crypto.randomUUID()}.${extension}`;
    await writeBrowserImage(name, await readFileAsDataUrl(file));
    await saveImage(projectId, projectName, name);
  } catch {
    notify('이미지를 불러오지 못했습니다.');
  }
}

async function saveImage(projectId: string, projectName: string, name: string) {
  if (
    await send('project:save', {
      id: projectId,
      name: projectName,
      image: name,
    })
  ) {
    cache.delete(`${dataScope()}:${name}`);
    imageRevision.update((n) => n + 1);
  }
}
