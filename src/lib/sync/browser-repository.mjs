import { createEnvelope, emptyState, projectedState } from './protocol.mjs';

/** Test-client adapter. The document, cursor, view and outbox commit together. */
export async function openBrowserRepository(
  owner,
  seed = emptyState(),
  indexedDB = globalThis.indexedDB,
) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(owner))
    throw new Error('잘못된 계정입니다.');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(`to3mato-sync-${owner}`, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let value = await new Promise((resolve, reject) => {
    const request = db
      .transaction('documents')
      .objectStore('documents')
      .get('current');
    request.onsuccess = () =>
      resolve(request.result?.envelope || createEnvelope(seed, owner));
    request.onerror = () => reject(request.error);
  });
  return {
    read: () => structuredClone(value),
    async write(next) {
      if (next.owner !== owner)
        throw new Error('계정 저장소가 일치하지 않습니다.');
      const record = {
        envelope: structuredClone(next),
        state: projectedState(next),
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        tx.objectStore('documents').put(record, 'current');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
      value = record.envelope;
    },
    close: () => db.close(),
  };
}
