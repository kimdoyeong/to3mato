import { writable, get } from 'svelte/store';
import {
  createInitialState,
  normalizeState,
  applyCommand,
  advanceTimer,
  elapsedSeconds,
  localDate,
} from './domain.mjs';
import type { AppState, Command } from './types';
import { finishRitual } from './ritual-state';
import { capturePrompt, completedMoment } from './focus-log';
import { syncContext, currentTime } from './sync-context';
import { setCalendarTimeZone } from './calendar-time.mjs';
export const state = writable<AppState>(createInitialState());
export const now = writable(Date.now());
export const ready = writable(false);
export const message = writable('');
export const loadError = writable('');
export const isDesktop = !!window.to3mato;
/** Reports a usage event. The main process drops anything off its allowlist. */
export function track(name: string, properties?: Record<string, string>) {
  window.to3mato?.analytics.track(name, properties).catch(() => {});
}
let notification: ReturnType<typeof setTimeout>;
export function notify(text: string) {
  message.set(text);
  clearTimeout(notification);
  notification = setTimeout(() => message.set(''), 3500);
}
const key = 'to3mato-state-v1';
function receiveState(next: AppState) {
  const previous = get(state);
  syncContext.set(next.syncContext);
  setCalendarTimeZone(next.syncContext?.timeZone);
  const moment = completedMoment(previous, next);
  if (
    (!next.syncContext ||
      next.syncContext.controller === next.syncContext.deviceId) &&
    next.timer?.phase === 'focus' &&
    next.timer.running &&
    (!previous.timer?.running ||
      previous.timer.phase !== 'focus' ||
      previous.timer.taskId !== next.timer.taskId ||
      previous.timer.startedAt !== next.timer.startedAt)
  ) {
    finishRitual('plan');
  }
  state.set(next);
  if (moment) capturePrompt.set(moment);
}
function persist(next: AppState) {
  localStorage.setItem(key, JSON.stringify(next));
  receiveState(next);
}
let queue: Promise<unknown> = Promise.resolve();
export async function send(
  type: string,
  payload?: Record<string, unknown>,
): Promise<boolean> {
  const operation = async () => {
    try {
      const command: Command = { type, payload };
      if (window.to3mato) receiveState(await window.to3mato.dispatch(command));
      else persist(applyCommand(get(state), command));
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message.replace(
              /^Error invoking remote method 'state:command': (?:Error: )?/,
              '',
            )
          : '작업을 처리할 수 없습니다.',
      );
      return false;
    }
  };
  const next = queue.then(operation, operation);
  queue = next;
  return next;
}
export async function initialize() {
  let unsubscribe = () => {},
    unsubscribeError = () => {};
  try {
    if (window.to3mato) {
      unsubscribe = window.to3mato.subscribe(receiveState);
      unsubscribeError = window.to3mato.onError(notify);
      const loaded = await window.to3mato.load();
      syncContext.set(loaded.syncContext);
      setCalendarTimeZone(loaded.syncContext?.timeZone);
      state.set(loaded);
    } else {
      const raw =
        localStorage.getItem(key) || localStorage.getItem('to3mato-demo-v1');
      const initial = raw
        ? normalizeState(JSON.parse(raw))
        : createInitialState();
      advanceTimer(initial);
      persist(initial);
    }
    ready.set(true);
  } catch (error) {
    loadError.set(
      '데이터를 불러오지 못했습니다. 기존 저장 데이터는 유지됩니다. ' +
        (error instanceof Error ? error.message : ''),
    );
  }
  const interval = setInterval(() => {
    now.set(currentTime());
    if (!window.to3mato && get(ready)) {
      const next = structuredClone(get(state));
      if (advanceTimer(next)) {
        try {
          persist(next);
        } catch {
          state.set(next);
          notify('집중 기록 저장에 실패했습니다. 데이터를 내보내세요.');
        }
      }
    }
  }, 250);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key && event.newValue) {
      try {
        state.set(normalizeState(JSON.parse(event.newValue)));
      } catch {}
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    clearInterval(interval);
    unsubscribe();
    unsubscribeError();
    window.removeEventListener('storage', onStorage);
  };
}
export async function exportData() {
  try {
    if (window.to3mato) {
      if (await window.to3mato.exportData()) notify('데이터를 내보냈습니다.');
      return;
    }
    const data = structuredClone(get(state));
    if (data.timer) {
      data.timer.elapsed = elapsedSeconds(data.timer);
      data.timer.running = false;
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `to3mato-${localDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('데이터를 내보냈습니다.');
  } catch {
    notify('데이터를 내보낼 수 없습니다.');
  }
}
export async function importNative() {
  try {
    const value = await window.to3mato?.importData();
    if (value) {
      state.set(value);
      notify('데이터를 가져왔습니다.');
    }
  } catch (error) {
    notify(
      error instanceof Error ? error.message : '데이터를 가져올 수 없습니다.',
    );
  }
}
export async function importBrowser(file: File) {
  try {
    if (file.size > 20 * 1024 * 1024)
      throw new Error('파일 크기는 20MB 이하여야 합니다.');
    const value = normalizeState(JSON.parse(await file.text()));
    if (value.timer) value.timer.running = false;
    if (!confirm('현재 데이터를 가져온 파일로 교체합니다. 계속하시겠습니까?'))
      return;
    localStorage.setItem(key + '-backup', JSON.stringify(get(state)));
    persist(value);
    notify('데이터를 가져왔습니다.');
  } catch (error) {
    notify(error instanceof Error ? error.message : '파일을 읽을 수 없습니다.');
  }
}
