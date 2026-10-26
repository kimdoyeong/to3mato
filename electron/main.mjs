import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  powerMonitor,
  Menu,
  Notification,
  autoUpdater as nativeUpdater,
  safeStorage,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SQLiteStore } from './storage.mjs';
import { createAccountSync } from './sync.mjs';
import { setCalendarTimeZone } from '../src/lib/calendar-time.mjs';
import { createTimerTray } from './tray.mjs';
import {
  createUpdater,
  updateFeedURL,
  updaterEnabled,
  UPDATE_ERROR,
} from './updater.mjs';
import {
  completedTimerNotification,
  startedTimerNotification,
  createTimerNotifications,
  nextReminder,
} from './notifications.mjs';
import {
  createRitualLedger,
  isRitualKind,
  isRitualDate,
} from './ritual-ledger.mjs';
import {
  applyCommand,
  advanceTimer,
  normalizeState,
  elapsedSeconds,
  localDate,
} from '../src/lib/domain.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.setName('To3mato');
if (process.env.TO3MATO_USER_DATA)
  app.setPath('userData', process.env.TO3MATO_USER_DATA);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const dev = process.env.TO3MATO_DEV_URL;
if (dev && new URL(dev).origin !== 'http://127.0.0.1:4173')
  throw new Error('Invalid development URL');
let window, store, state, ticker, updater, account;
let quitting = false;
export let timerTray;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      try {
        store = new SQLiteStore(app.getPath('userData'));
        state = store.load();
        if (advanceTimer(state)) store.save(state);
      } catch (error) {
        dialog.showErrorBox(
          '데이터를 열 수 없습니다',
          '기존 데이터는 변경하지 않았습니다.\n' + String(error),
        );
        app.quit();
      }
      if (state) {
        if (process.platform === 'darwin')
          app.dock.setIcon(path.join(root, 'electron/assets/icon.png'));
        protocol.handle('app', (request) => {
          const url = new URL(request.url);
          if (url.hostname !== 'to3mato')
            return new Response('Not found', { status: 404 });
          let pathname;
          try {
            pathname = decodeURIComponent(url.pathname);
          } catch {
            return new Response('Bad request', { status: 400 });
          }
          const file = path.resolve(
            root,
            'dist',
            '.' + (pathname === '/' ? '/index.html' : pathname),
          );
          if (!file.startsWith(path.resolve(root, 'dist') + path.sep))
            return new Response('Forbidden', { status: 403 });
          return net.fetch(pathToFileURL(file).href);
        });
        const createWindow = async () => {
          window = new BrowserWindow({
            width: 950,
            height: 700,
            minWidth: 950,
            minHeight: 700,
            title: 'To3mato',
            icon: path.join(root, 'electron/assets/icon.png'),
            backgroundColor: '#fff3e3',
            show: false,
            webPreferences: {
              preload: path.join(root, 'electron/preload.cjs'),
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          });
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          window.webContents.on('will-navigate', (event, url) => {
            const allowed = dev
              ? new URL(url).origin === new URL(dev).origin
              : url.startsWith('app://to3mato/');
            if (!allowed) event.preventDefault();
          });
          const cameraOrigin = (url) => {
            try {
              return dev
                ? new URL(url).origin === new URL(dev).origin
                : url.startsWith('app://to3mato/');
            } catch {
              return false;
            }
          };
          window.webContents.session.setPermissionRequestHandler(
            (wc, permission, callback, details) =>
              callback(
                wc === window?.webContents &&
                  permission === 'media' &&
                  details.isMainFrame &&
                  cameraOrigin(details.requestingUrl) &&
                  details.mediaTypes?.length === 1 &&
                  details.mediaTypes[0] === 'video',
              ),
          );
          window.webContents.session.setPermissionCheckHandler(
            (wc, permission, origin, details) =>
              wc === window?.webContents &&
              permission === 'media' &&
              details.isMainFrame &&
              cameraOrigin(details.requestingUrl || origin) &&
              details.mediaType === 'video',
          );
          window.once('ready-to-show', () => window.show());
          window.on('close', (event) => {
            if (quitting) return;
            event.preventDefault();
            window.hide();
          });
          window.on('closed', () => {
            window = null;
            timerTray?.destroy();
          });
          if (dev) await window.loadURL(dev);
          else await window.loadURL('app://to3mato/');
        };
        const showMain = () => {
          timerTray?.popover.hide();
          if (!window || window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        };
        app.on('activate', showMain);
        const trusted = (event, allowTray = false) => {
          const senderWindow =
            allowTray && event.sender === timerTray?.popover.webContents
              ? timerTray.popover
              : window;
          if (
            !senderWindow ||
            event.sender !== senderWindow.webContents ||
            event.senderFrame !== senderWindow.webContents.mainFrame
          )
            throw new Error('Unauthorized sender');
          const url = event.senderFrame.url;
          if (
            dev
              ? new URL(url).origin !== new URL(dev).origin
              : !url.startsWith('app://to3mato/')
          )
            throw new Error('Unauthorized origin');
        };
        const broadcast = () => {
          for (const target of [window, timerTray?.popover]) {
            if (target && !target.isDestroyed())
              target.webContents.send('state:changed', state);
          }
        };
        const notifications = createTimerNotifications({
          Notification,
          getWindow: () => window,
          showMain,
          icon: path.join(root, 'electron/assets/icon.png'),
          onError: (error) => {
            console.warn('Timer notification failed:', error);
            window?.webContents.send(
              'state:error',
              '알림을 표시하지 못했습니다. macOS 알림 설정과 앱 서명을 확인하세요.',
            );
          },
        });
        const commit = (next, backup = false, completion = null) => {
          if (backup) store.replace(next);
          else store.save(next);
          state = next;
          broadcast();
          timerTray?.update();
          notifications.show(completion);
          return state;
        };
        const dispatch = (command) => {
          if (account?.active()) return account.dispatch(command);
          const now = Date.now();
          const completion = completedTimerNotification(state, now);
          const next = applyCommand(state, command, now);
          const start = startedTimerNotification(state, next, now);
          const result = commit(next, false, completion);
          notifications.show(start);
          return result;
        };
        const report = (error) => {
          console.error(error);
          window?.webContents.send(
            'state:error',
            '저장에 실패했습니다. 데이터 폴더의 접근 권한과 여유 공간을 확인하세요.',
          );
        };
        ipcMain.handle('state:load', (event) => {
          trusted(event, true);
          return state;
        });
        ipcMain.handle('app:version', (event) => {
          trusted(event);
          return app.getVersion();
        });
        ipcMain.handle('update:status', (event) => {
          trusted(event);
          return updater.status();
        });
        ipcMain.handle('update:check', (event) => {
          trusted(event);
          // IPC responds immediately; subsequent progress arrives via subscription.
          void updater.check();
          return updater.status();
        });
        ipcMain.handle('update:install', (event) => {
          trusted(event);
          return updater.install();
        });
        ipcMain.handle('window:visible', (event) => {
          trusted(event, true);
          return (
            BrowserWindow.fromWebContents(event.sender)?.isVisible() ?? false
          );
        });
        ipcMain.handle('window:show', (event) => {
          trusted(event, true);
          showMain();
        });
        ipcMain.handle('state:command', async (event, command) => {
          trusted(event, true);
          if (
            event.sender === timerTray?.popover.webContents &&
            ![
              'timer:play',
              'timer:toggle',
              'timer:end',
              'checkin:skip',
            ].includes(command?.type)
          )
            throw new Error('Unauthorized tray command');
          try {
            return await dispatch(command);
          } catch (error) {
            throw new Error(error.message);
          }
        });
        ipcMain.handle('data:export', async (event) => {
          trusted(event);
          const { canceled, filePath } = await dialog.showSaveDialog(window, {
            defaultPath: `to3mato-${localDate()}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (canceled || !filePath) return false;
          const snapshot = structuredClone(state);
          delete snapshot.syncContext;
          if (snapshot.timer) {
            snapshot.timer.elapsed = elapsedSeconds(
              snapshot.timer,
              account?.now() || Date.now(),
            );
            snapshot.timer.running = false;
          }
          fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
          return true;
        });
        ipcMain.handle('video:export', async (event, bytes, filename) => {
          trusted(event);
          if (
            !(bytes instanceof ArrayBuffer) ||
            !bytes.byteLength ||
            bytes.byteLength > 512 * 1024 * 1024 ||
            typeof filename !== 'string' ||
            !/^to3mato-[\d-]+\.(webm|mp4)$/.test(filename)
          )
            throw new Error(
              '내보낼 영상이 올바르지 않거나 512MB를 초과합니다.',
            );
          const extension = filename.endsWith('.mp4') ? 'mp4' : 'webm';
          const { canceled, filePath } = await dialog.showSaveDialog(window, {
            defaultPath: filename,
            filters: [{ name: 'Video', extensions: [extension] }],
          });
          if (canceled || !filePath) return false;
          await fs.promises.writeFile(filePath, Buffer.from(bytes));
          return true;
        });
        // Project cover images live beside the database and are read back
        // as data URLs so the renderer's CSP (img-src data:) stays unchanged.
        const imagesDirectory = () =>
          path.join(
            account?.directory() || app.getPath('userData'),
            'project-images',
          );
        const IMAGE_NAME = /^[A-Za-z0-9_-]{1,100}\.(png|jpe?g|webp|gif)$/;
        const IMAGE_TYPES = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          gif: 'image/gif',
        };
        ipcMain.handle('image:pick', async (event) => {
          trusted(event);
          const imageDirectory = imagesDirectory();
          const result = await dialog.showOpenDialog(window, {
            properties: ['openFile'],
            filters: [
              {
                name: 'Image',
                extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
              },
            ],
          });
          if (result.canceled || !result.filePaths[0]) return null;
          const source = result.filePaths[0];
          const extension = path.extname(source).slice(1).toLowerCase();
          if (!IMAGE_TYPES[extension])
            throw new Error('png, jpg, webp, gif 이미지만 사용할 수 있습니다.');
          if (fs.statSync(source).size > 10 * 1024 * 1024)
            throw new Error('이미지 크기는 10MB 이하여야 합니다.');
          fs.mkdirSync(imageDirectory, { recursive: true });
          const name = `${crypto.randomUUID()}.${extension}`;
          await fs.promises.copyFile(source, path.join(imageDirectory, name));
          return name;
        });
        ipcMain.handle('image:read', async (event, file) => {
          trusted(event);
          const imageDirectory = imagesDirectory();
          if (typeof file !== 'string' || !IMAGE_NAME.test(file)) return '';
          const target = path.join(imageDirectory, file);
          if (!target.startsWith(imageDirectory + path.sep)) return '';
          try {
            const bytes = await fs.promises.readFile(target);
            const type = IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()];
            return `data:${type};base64,${bytes.toString('base64')}`;
          } catch {
            if (account?.active()) {
              const asset = await account.assetRead(file);
              if (asset)
                return `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`;
            }
            return '';
          }
        });
        ipcMain.handle('data:import', async (event) => {
          trusted(event);
          const result = await dialog.showOpenDialog(window, {
            properties: ['openFile'],
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (result.canceled) return null;
          const file = result.filePaths[0];
          if (fs.statSync(file).size > 20 * 1024 * 1024)
            throw new Error('파일 크기는 20MB 이하여야 합니다.');
          const imported = normalizeState(
            JSON.parse(fs.readFileSync(file, 'utf8')),
          );
          if (imported.timer) imported.timer.running = false;
          if (account?.active()) return account.importData(imported);
          const confirmation = await dialog.showMessageBox(window, {
            type: 'question',
            buttons: ['취소', '가져오기'],
            defaultId: 0,
            cancelId: 0,
            message: '현재 데이터를 가져온 파일로 교체합니다.',
            detail:
              '기존 데이터는 to3mato.pre-import.sqlite3 파일에 보관됩니다.',
          });
          if (confirmation.response !== 1) return null;
          return commit(imported, true);
        });
        const rituals = createRitualLedger(app.getPath('userData'));
        ipcMain.handle('ritual:dates', (event) => {
          trusted(event);
          if (account?.active()) {
            const rows = account.state().syncContext.extras.rituals;
            const latest = (kind) =>
              rows
                .filter((row) => row.kind === kind)
                .map((row) => row.date)
                .sort()
                .at(-1) || '';
            return {
              plannedDate: latest('plan'),
              reviewedDate: latest('review'),
            };
          }
          const { done } = rituals.get();
          return { plannedDate: done.plan, reviewedDate: done.review };
        });
        ipcMain.handle('ritual:finish', async (event, kind, date) => {
          trusted(event);
          if (!isRitualKind(kind) || !isRitualDate(date)) return false;
          if (account?.active()) {
            await account.extra('rituals', `${date}:${kind}`, { kind, date });
            return true;
          }
          return rituals.markDone(kind, date);
        });
        let reminderMinute = -1;
        ticker = setInterval(() => {
          const now = account?.now() || Date.now();
          const minute = Math.floor(now / 60000);
          if (minute !== reminderMinute) {
            reminderMinute = minute;
            const ledger = rituals.get();
            if (account?.active()) {
              const rows = account.state().syncContext.extras.rituals;
              for (const kind of ['plan', 'review'])
                ledger.done[kind] =
                  rows
                    .filter((row) => row.kind === kind)
                    .map((row) => row.date)
                    .sort()
                    .at(-1) || '';
            }
            const { reminder, settled } = nextReminder(state, now, ledger);
            if (reminder) {
              rituals.markSent(settled, localDate(new Date(now)));
              notifications.show(reminder);
            }
          }
          if (account?.active()) {
            void account.tick().catch(report);
            timerTray?.update();
            return;
          }
          const completion = completedTimerNotification(state, now);
          const next = structuredClone(state);
          if (advanceTimer(next, now)) {
            try {
              commit(next, false, completion);
            } catch (error) {
              state = next;
              if (state.timer) state.timer.running = false;
              broadcast();
              report(error);
            }
          }
          timerTray?.update();
        }, 250);
        powerMonitor.on('suspend', () => {
          if (account?.active()) return;
          try {
            commit(applyCommand(state, { type: 'timer:pause' }));
          } catch (error) {
            report(error);
          }
        });
        powerMonitor.on('resume', () => account?.resume());
        let bundledSync = {};
        const syncConfigFile = path.join(root, 'electron/supabase-config.json');
        if (fs.existsSync(syncConfigFile)) {
          try {
            bundledSync = JSON.parse(fs.readFileSync(syncConfigFile, 'utf8'));
          } catch {
            // Broken optional configuration must not prevent local use.
            bundledSync = { url: 'invalid' };
          }
        }
        account = createAccountSync({
          directory: app.getPath('userData'),
          safeStorage,
          bundled: bundledSync,
          getLocalState: () => store.load(),
          onState: (next) => {
            const previous = state;
            setCalendarTimeZone(next.syncContext?.timeZone);
            state = next;
            broadcast();
            timerTray?.update();
            if (
              next.syncContext?.controller === next.syncContext?.deviceId &&
              next.syncContext?.owner
            ) {
              const added = next.records.some(
                (record) =>
                  !previous.records.some((old) => old.id === record.id),
              );
              if (added)
                notifications.show(
                  completedTimerNotification(previous, account.now()),
                );
              notifications.show(
                startedTimerNotification(previous, next, account.now()),
              );
            }
          },
          onStatus: (value) =>
            window?.webContents.send('account:status', value),
        });
        const accountMethods = {
          status: () => account.status(),
          requestCode: (email) => account.requestCode(email),
          verify: (email, code) => account.verify(email, code),
          enable: () => {
            store.snapshot(
              path.join(app.getPath('userData'), 'to3mato.pre-sync.sqlite3'),
              false,
            );
            return account.enable();
          },
          disable: () => account.disable(),
          mediaAdopted: () => account.mediaAdopted(),
          logout: () => account.logout(),
          now: () => account.syncNow(),
          resolve: (id, action) => account.resolve(id, action),
          remove: async () => {
            const result = await dialog.showMessageBox(window, {
              type: 'warning',
              buttons: ['취소', '삭제'],
              defaultId: 0,
              cancelId: 0,
              message:
                '서버에 저장된 계정, 동기화 데이터와 파일을 삭제합니다. 이 기기에 저장된 데이터는 남습니다.',
            });
            return result.response === 1 ? account.remove() : account.status();
          },
        };
        for (const [method, handler] of Object.entries(accountMethods))
          ipcMain.handle(`account:${method}`, (event, ...args) => {
            trusted(event);
            return handler(...args);
          });
        const checkOwner = (owner) => {
          if (owner !== undefined && owner !== account.status().scope)
            throw new Error('계정이 변경되었습니다.');
        };
        ipcMain.handle(
          'sync:extra',
          (event, entity, id, fields, deleted, owner) => {
            trusted(event);
            checkOwner(owner);
            if (
              !account.active() ||
              !['rituals', 'clips', 'deliveries', 'assets'].includes(entity) ||
              typeof deleted !== 'boolean' ||
              JSON.stringify(fields).length > 16384
            )
              throw new Error('잘못된 동기화 요청입니다.');
            return account.extra(entity, id, fields, deleted);
          },
        );
        ipcMain.handle('sync:asset-put', (event, id, mime, bytes, owner) => {
          trusted(event);
          checkOwner(owner);
          if (
            !account.active() ||
            !(bytes instanceof ArrayBuffer) ||
            bytes.byteLength > 512 * 1024 * 1024
          )
            throw new Error('잘못된 파일입니다.');
          return account.assetPut(id, mime, bytes);
        });
        ipcMain.handle('sync:asset-read', (event, id, owner) => {
          trusted(event);
          checkOwner(owner);
          if (!account.active()) return null;
          return account.assetRead(id);
        });
        ipcMain.handle('sync:project-images', (event) => {
          trusted(event);
          return account.importProjectImages();
        });
        await account.restore();
        Menu.setApplicationMenu(
          Menu.buildFromTemplate([
            ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
            { role: 'editMenu' },
            { role: 'viewMenu' },
            { role: 'windowMenu' },
          ]),
        );
        try {
          const enabled = updaterEnabled({
            isPackaged: app.isPackaged,
            devURL: dev,
            platform: process.platform,
            arch: process.arch,
          });
          const feedURL = updateFeedURL(process.env.TO3MATO_UPDATE_URL);
          const autoUpdater = enabled
            ? (await import('electron-updater')).default.autoUpdater
            : null;
          updater = createUpdater({
            autoUpdater,
            nativeUpdater,
            enabled,
            feedURL,
            getWindow: () => window,
            onStatus: (status) =>
              window?.webContents.send('update:status', status),
            prepareInstall: () => {
              if (account?.active()) return;
              try {
                commit(applyCommand(state, { type: 'timer:pause' }));
              } catch (error) {
                report(error);
                throw error;
              }
            },
          });
        } catch (error) {
          console.error(error);
          const failed = () => ({ status: 'error', message: UPDATE_ERROR });
          updater = {
            status: failed,
            check: async () => failed(),
            install: () => false,
            destroy() {},
          };
        }
        const beforeQuit = () => {
          if (quitting) return;
          quitting = true;
          clearInterval(ticker);
          updater?.destroy();
          timerTray?.destroy();
          notifications.destroy();
          try {
            if (!account?.active())
              store.save(applyCommand(state, { type: 'timer:pause' }));
            account?.destroy();
          } catch (error) {
            console.error(error);
          } finally {
            store.close();
          }
        };
        app.on('before-quit', beforeQuit);
        nativeUpdater.on('before-quit-for-update', beforeQuit);
        app.on('window-all-closed', () => {
          if (!quitting) app.quit();
        });
        await createWindow();
        if (quitting || !window) return;
        timerTray = createTimerTray({
          getState: () => state,
          getNow: () => account?.now() || Date.now(),
          onError: report,
          showMain,
          dev,
        });
        timerTray.load();
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
