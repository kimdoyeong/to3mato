import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { timerMenuState } from '../src/lib/domain.mjs';
import { createTrayImage, trayImageKey } from './tray-image.mjs';
export { timerMenuState } from '../src/lib/domain.mjs';

export function popoverPosition(bounds, workArea, size) {
  const clamp = (value, start, length, extent) =>
    Math.max(start, Math.min(value, start + length - extent));
  return {
    x: Math.round(
      clamp(
        bounds.x + bounds.width / 2 - size.width / 2,
        workArea.x,
        workArea.width,
        size.width,
      ),
    ),
    y: Math.round(
      clamp(bounds.y + bounds.height, workArea.y, workArea.height, size.height),
    ),
  };
}

export function createTimerTray({ getState, onError, showMain, dev }) {
  const icon = nativeImage.createFromPath(
    fileURLToPath(new URL('./assets/mascot-tray.png', import.meta.url)),
  );
  if (icon.isEmpty()) throw new Error('트레이 아이콘을 불러올 수 없습니다.');
  icon.setTemplateImage(false);
  const tray = new Tray(icon);
  const popover = new BrowserWindow({
    width: 280,
    height: 250,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    paintWhenInitiallyHidden: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#fff3e3',
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popover.setMenu(null);
  popover.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popover.webContents.on('will-navigate', (event, url) => {
    const allowed = dev
      ? new URL(url).origin === new URL(dev).origin
      : url.startsWith('app://to3mato/');
    if (!allowed) event.preventDefault();
  });
  let ready = false,
    lastBlur = -Infinity,
    previousImage = '',
    previousText = '';
  popover.webContents.once('did-finish-load', () => {
    ready = true;
  });
  for (const event of ['show', 'hide']) {
    popover.on(event, () =>
      popover.webContents.send('window:visibility', popover.isVisible()),
    );
  }
  popover.on('blur', () => {
    lastBlur = Date.now();
    popover.hide();
  });
  const toggle = () => {
    if (!ready || popover.isDestroyed()) return;
    if (popover.isVisible()) {
      popover.hide();
      return;
    }
    if (Date.now() - lastBlur < 200) return;
    const bounds = tray.getBounds();
    const { workArea } = screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y),
    });
    const { x, y } = popoverPosition(bounds, workArea, popover.getBounds());
    popover.setPosition(x, y);
    popover.show();
    popover.focus();
  };
  const contextMenu = Menu.buildFromTemplate([
    { id: 'open', label: 'To3mato 열기', click: showMain },
    { id: 'quit', label: '종료', click: () => app.quit() },
  ]);
  tray.on('click', toggle);
  tray.on('right-click', () => {
    popover.hide();
    tray.popUpContextMenu(contextMenu);
  });
  // Linux status notifier implementations require a context menu to activate.
  if (process.platform === 'linux') tray.setContextMenu(contextMenu);
  const update = () => {
    if (tray.isDestroyed()) return;
    const state = getState(),
      view = timerMenuState(state);
    const display = state.settings.trayDisplay ?? 'clock';
    const text = `${display}:${view.clock}:${view.status}`;
    if (text !== previousText) {
      previousText = text;
      tray.setToolTip(`${view.clock} · ${view.status}`);
      if (process.platform === 'darwin')
        tray.setTitle(display === 'clock' ? view.clock : '', {
          fontType: 'monospacedDigit',
        });
    }
    const key = trayImageKey(display, view);
    if (key !== previousImage) {
      tray.setImage(createTrayImage(nativeImage, display, view));
      previousImage = key;
    }
  };
  // Loading is deferred until the caller has registered this window as an IPC sender.
  const load = () =>
    popover
      .loadURL(dev ? new URL('tray.html', dev).href : 'app://to3mato/tray.html')
      .catch(onError);
  update();
  return {
    tray,
    popover,
    contextMenu,
    load,
    update,
    destroy: () => {
      if (!popover.isDestroyed()) popover.destroy();
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
