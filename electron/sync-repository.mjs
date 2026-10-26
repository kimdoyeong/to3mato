import fs from 'node:fs';
import path from 'node:path';
import { SQLiteStore } from './storage.mjs';
import {
  createEnvelope,
  emptyState,
  projectedState,
} from '../src/lib/sync/protocol.mjs';

export function accountDirectory(root, userId) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  )
    throw new Error('잘못된 계정입니다.');
  return path.join(root, 'accounts', userId);
}
export function openAccountRepository(root, userId, { seed, deviceId } = {}) {
  const directory = accountDirectory(root, userId);
  const store = new SQLiteStore(directory);
  store.load();
  let value = store.readEnvelope();
  if (value && value.owner !== userId) {
    store.close();
    throw new Error('계정 저장소가 일치하지 않습니다.');
  }
  if (!value) {
    value = createEnvelope(seed || emptyState(), userId, deviceId);
    store.saveEnvelope(value, projectedState(value));
  }
  return {
    directory,
    store,
    read: () => structuredClone(value),
    write(next) {
      if (next.owner !== userId || next.deviceId !== value.deviceId)
        throw new Error('계정 저장소가 일치하지 않습니다.');
      store.saveEnvelope(next, projectedState(next));
      value = structuredClone(next);
    },
    backup() {
      const target = path.join(directory, 'before-sync');
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      store.snapshot(path.join(target, 'to3mato.sqlite3'), false);
      for (const name of ['project-images', 'assets']) {
        const source = path.join(directory, name),
          destination = path.join(target, name);
        if (fs.existsSync(source) && !fs.existsSync(destination))
          fs.cpSync(source, destination, { recursive: true });
      }
    },
    close: () => store.close(),
  };
}
