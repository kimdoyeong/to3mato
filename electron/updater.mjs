export const UPDATE_URL = 'https://downloads.to3mato.doyeong.dev/';
export const UPDATE_ERROR =
  '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하세요.';
export const VERIFICATION_ERROR =
  '업데이트 파일을 검증하지 못했습니다. 다운로드 페이지에서 다시 설치하세요.';

export function updateFeedURL(override) {
  if (override === undefined) return UPDATE_URL;
  const url = new URL(override);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid update URL');
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

export function updaterEnabled({ isPackaged, devURL, platform, arch }) {
  return isPackaged && !devURL && platform === 'darwin' && arch === 'arm64';
}

// Dependencies are supplied by main so unit tests never load Electron or use the network.
export function createUpdater({
  autoUpdater,
  nativeUpdater,
  enabled,
  feedURL = UPDATE_URL,
  getWindow = () => null,
  onStatus = () => {},
  prepareInstall = () => {},
  log = console.error,
  timers = globalThis,
}) {
  let current = { status: 'idle' };
  let destroyed = false;
  let checking = false;
  let installing = false;
  let downloadedVersion;
  let firstCheck, periodicCheck;
  const listeners = [];
  const status = () => ({ ...current });
  const publish = (next) => {
    if (destroyed) return;
    current = next;
    onStatus(status());
  };
  const fail = (error) => {
    if (destroyed) return;
    log(error);
    downloadedVersion = undefined;
    installing = false;
    const verification = /checksum|signature|code.?sign/i.test(
      `${error?.code || ''} ${error?.message || error}`,
    );
    const message = verification ? VERIFICATION_ERROR : UPDATE_ERROR;
    const duplicate = current.status === 'error' && current.message === message;
    publish({ status: 'error', message });
    const window = getWindow();
    if (verification && !duplicate && window && !window.isDestroyed())
      window.webContents.send('state:error', VERIFICATION_ERROR);
  };
  const listen = (emitter, event, callback) => {
    emitter.on(event, callback);
    listeners.push(() => emitter.removeListener(event, callback));
  };
  async function check() {
    if (
      !enabled ||
      destroyed ||
      checking ||
      installing ||
      ['checking', 'downloading', 'ready'].includes(current.status)
    )
      return status();
    checking = true;
    publish({ status: 'checking' });
    try {
      const result = await autoUpdater.checkForUpdates();
      // Download errors reject a separate promise from the metadata check.
      if (result?.downloadPromise) await result.downloadPromise;
      if (!destroyed && current.status === 'checking')
        publish({ status: 'idle' });
    } catch (error) {
      fail(error);
    } finally {
      checking = false;
    }
    return status();
  }
  function install() {
    if (!enabled || destroyed || installing || current.status !== 'ready')
      return false;
    try {
      // Persist a running timer before closing any windows. A failed save blocks restart.
      prepareInstall();
    } catch (error) {
      // Main reports the storage error. Keep the staged update available for retry.
      log(error);
      return false;
    }
    try {
      installing = true;
      autoUpdater.quitAndInstall();
      return true;
    } catch (error) {
      installing = false;
      fail(error);
      return false;
    }
  }
  function destroy() {
    destroyed = true;
    timers.clearTimeout(firstCheck);
    timers.clearInterval(periodicCheck);
    for (const remove of listeners) remove();
  }
  if (enabled) {
    try {
      autoUpdater.logger = { info() {}, warn() {}, debug() {}, error: log };
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowDowngrade = false;
      autoUpdater.allowPrerelease = false;
      const supported = autoUpdater.isUpdateSupported?.bind(autoUpdater);
      autoUpdater.isUpdateSupported = async (info) => {
        // Generic feeds do not filter prereleases themselves. Preserve the OS check.
        if (!/^\d+\.\d+\.\d+$/.test(info.version)) return false;
        const base = new URL(feedURL);
        if (!Array.isArray(info.files) || !info.files.length) return false;
        for (const file of info.files) {
          const url = new URL(file.url, base);
          if (url.origin !== base.origin || url.username || url.password)
            return false;
        }
        return supported ? supported(info) : true;
      };
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: feedURL,
        channel: 'latest',
        useMultipleRangeRequest: false,
      });
      listen(autoUpdater, 'error', fail);
      listen(autoUpdater, 'checking-for-update', () =>
        publish({ status: 'checking' }),
      );
      listen(autoUpdater, 'update-not-available', () =>
        publish({ status: 'idle' }),
      );
      listen(autoUpdater, 'update-available', ({ version }) => {
        downloadedVersion = undefined;
        publish({ status: 'downloading', version, percent: 0 });
      });
      listen(autoUpdater, 'download-progress', ({ percent }) => {
        if (current.status === 'downloading')
          publish({
            ...current,
            percent: Number.isFinite(percent)
              ? Math.max(0, Math.min(100, Math.round(percent)))
              : 0,
          });
      });
      listen(autoUpdater, 'update-downloaded', ({ version }) => {
        downloadedVersion = version;
        // Squirrel still needs to verify the signature and stage the app.
        publish({ status: 'downloading', version, percent: 100 });
      });
      listen(nativeUpdater, 'update-downloaded', () => {
        if (downloadedVersion)
          publish({ status: 'ready', version: downloadedVersion });
      });
      firstCheck = timers.setTimeout(() => void check(), 10_000);
      periodicCheck = timers.setInterval(
        () => void check(),
        4 * 60 * 60 * 1000,
      );
      firstCheck?.unref?.();
      periodicCheck?.unref?.();
    } catch (error) {
      destroy();
      current = { status: 'error', message: UPDATE_ERROR };
      log(error);
      onStatus(status());
    }
  }
  return { check, install, status, destroy };
}
