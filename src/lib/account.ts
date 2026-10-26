import type { AccountStatus } from './types';
import { backupMedia, adoptMedia } from './media-sync';
import { syncContext } from './sync-context';

/** Error text from an IPC failure without Electron's remote-method prefix. */
export function errorText(failure: unknown) {
  return failure instanceof Error
    ? failure.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      )
    : '요청을 처리하지 못했습니다.';
}

/** Turns on sync for this device and reloads into the account's data. */
export async function enableSync(account: AccountStatus | null) {
  const adopt = account?.adoptLocalMedia;
  const backup = await backupMedia(adopt ? 'local' : account?.scope);
  const next = await window.to3mato!.account.enable();
  const loaded = await window.to3mato!.load();
  syncContext.set(loaded.syncContext);
  // Adoption is explicitly allowed only for the first account bound to local data.
  if (adopt && next.adoptLocalMedia) {
    await adoptMedia(backup);
    await window.to3mato!.account.mediaAdopted();
  }
  location.reload();
}
