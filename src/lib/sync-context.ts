import { get, writable } from 'svelte/store';
import type { SyncContext } from './types';
export const syncContext = writable<SyncContext | undefined>(undefined);
let base = Date.now(),
  tick = performance.now();
syncContext.subscribe((context) => {
  base = Date.now() + (context?.offset || 0);
  tick = performance.now();
});
export const currentTime = () =>
  currentSync() ? base + performance.now() - tick : Date.now();
export const currentSync = () => get(syncContext);
export const dataScope = () => currentSync()?.owner || 'local';
