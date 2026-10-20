import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('tray displays and popover share the desktop timer and close with the main window', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-tray-'));
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  const app = await electron.launch({
    executablePath: process.env.TO3MATO_EXECUTABLE,
    args: process.env.TO3MATO_EXECUTABLE ? [] : ['.'],
    env,
  });
  try {
    await app.evaluate(({ Notification }) => {
      Notification.prototype.show = () => {};
    });
    const page = await app.firstWindow();
    await expect(page.locator('#clock')).toHaveText('25:00');
    await expect.poll(() => app.windows().length).toBe(2);
    const popover = app.windows().find((w) => w !== page)!;
    await popover.waitForURL('**/tray.html');
    await popover.waitForLoadState();
    await popover.evaluate(() => {
      (window as any).trayVisibility = [];
      window.to3mato!.subscribeVisibility((visible) =>
        (window as any).trayVisibility.push(visible),
      );
    });
    await expect
      .poll(() => popover.evaluate(() => (window as any).trayVisibility.at(-1)))
      .toBe(false);

    const trayAction = (action: string) =>
      app.evaluate(async ({ app }, action) => {
        const load = process
          .getBuiltinModule('module')
          .createRequire(`${app.getAppPath()}/package.json`);
        const { timerTray } = load('./electron/main.mjs');
        if (action === 'click') timerTray.tray.emit('click');
        if (action === 'blur-click') {
          timerTray.popover.emit('blur');
          timerTray.tray.emit('click');
        }
        if (action === 'open')
          timerTray.contextMenu.getMenuItemById('open').click();
        return {
          visible: timerTray.popover.isVisible(),
          title: process.platform === 'darwin' ? timerTray.tray.getTitle() : '',
          items: timerTray.contextMenu.items.map((i) => i.label),
          bounds: timerTray.popover.getBounds(),
        };
      }, action);
    expect((await trayAction('snapshot')).items).toEqual([
      'To3mato 열기',
      '종료',
    ]);
    expect((await trayAction('snapshot')).visible).toBe(false);
    const images = await app.evaluate(async ({ app, nativeImage }) => {
      const load = process
        .getBuiltinModule('module')
        .createRequire(`${app.getAppPath()}/package.json`);
      const { createTrayImage } = load('./electron/tray-image.mjs');
      const { popoverPosition } = load('./electron/tray.mjs');
      const positions = [
        popoverPosition(
          { x: -1440, y: 0, width: 22, height: 24 },
          { x: -1440, y: 24, width: 1440, height: 876 },
          { width: 280, height: 250 },
        ),
        popoverPosition(
          { x: 1430, y: 0, width: 22, height: 24 },
          { x: 0, y: 24, width: 1440, height: 876 },
          { width: 280, height: 250 },
        ),
      ];
      return {
        positions,
        modes: ['bar', 'ring', 'hourglass'].map((mode) => {
          const image = createTrayImage(nativeImage, mode, {
            ratio: 0.5,
            phase: 'focus',
            paused: false,
          });
          return {
            size: image.getSize(),
            scales: image.getScaleFactors(),
            empty: image.isEmpty(),
          };
        }),
      };
    });
    expect(images.positions).toEqual([
      { x: -1440, y: 24 },
      { x: 1160, y: 24 },
    ]);
    for (const image of images.modes) {
      expect(image.empty).toBe(false);
      expect(image.size.height).toBe(22);
      expect(image.size.width).toBeGreaterThan(22);
      expect(image.scales).toEqual([1, 2]);
    }
    await trayAction('click');
    await expect(popover.locator('#tray-clock')).toHaveText('25:00');
    await expect
      .poll(() => popover.evaluate(() => (window as any).trayVisibility.at(-1)))
      .toBe(true);

    await expect(popover.locator('#tray-task')).toHaveText(
      '프로젝트 아이디어 정리',
    );
    await expect(popover.locator('#tray-end')).toBeDisabled();
    await popover.screenshot({ path: '/private/tmp/to3mato-tray-popover.png' });
    await trayAction('click');
    expect((await trayAction('snapshot')).visible).toBe(false);

    // Change settings via the actual desktop control, then check the native title.
    await page.getByRole('button', { name: '설정', exact: true }).click();
    for (const display of ['bar', 'ring', 'hourglass', 'clock']) {
      await page.locator('#tray-display-setting').selectOption(display);
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.to3mato!.load())).settings
              .trayDisplay,
        )
        .toBe(display);
      if (process.platform === 'darwin')
        expect((await trayAction('snapshot')).title).toBe(
          display === 'clock' ? '25:00' : '',
        );
    }
    await page.evaluate(() =>
      window.to3mato!.dispatch({
        type: 'settings:save',
        payload: { focus: 60, rest: 30, trayDisplay: 'ring' },
      }),
    );
    await page.waitForTimeout(220);
    if (!(await trayAction('snapshot')).visible) await trayAction('click');
    expect((await trayAction('snapshot')).visible).toBe(true);
    await popover.locator('#tray-primary').click();
    await expect(popover.locator('#tray-status')).toHaveText('집중 중');
    await expect(page.locator('#focus-title')).toHaveText(
      '프로젝트 아이디어 정리',
    );
    try {
      await expect
        .poll(() => popover.locator('#tray-clock').innerText())
        .not.toBe('01:00');
    } catch (error) {
      console.log(
        'Clock diagnostic',
        await trayAction('snapshot'),
        await popover.evaluate(() => ({
          events: (window as any).trayVisibility,
          hidden: document.hidden,
        })),
        await page.evaluate(() => window.to3mato!.load()),
      );
      throw error;
    }
    await trayAction('click');
    await expect
      .poll(() => popover.evaluate(() => (window as any).trayVisibility.at(-1)))
      .toBe(false);
    const hiddenClock = await popover.locator('#tray-clock').innerText();
    await page.waitForTimeout(1400);
    expect(await popover.locator('#tray-clock').innerText()).toBe(hiddenClock);
    await trayAction('click');
    await expect
      .poll(() => popover.locator('#tray-clock').innerText())
      .not.toBe(hiddenClock);
    await popover.locator('#tray-primary').click();
    await expect(popover.locator('#tray-status')).toHaveText('일시정지');
    await expect(
      page.getByRole('button', { name: '집중 재개', exact: true }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).timer?.running,
    ).toBe(false);
    await popover.locator('#tray-end').click();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).records,
    ).toHaveLength(1);
    await expect(popover.locator('#tray-status')).toHaveText('집중 대기');

    // A renderer action triggers natural completion/rest in both windows.
    await page.evaluate(async () => {
      await window.to3mato!.dispatch({
        type: 'settings:save',
        payload: { focus: 1, rest: 30 },
      });
      await window.to3mato!.dispatch({
        type: 'timer:play',
        payload: { id: 't2' },
      });
    });
    await expect(popover.locator('#tray-status')).toHaveText('휴식 중');
    await expect(popover.locator('#tray-primary')).toHaveText('일시정지');
    await popover.locator('#tray-primary').click();
    await expect(popover.locator('#tray-status')).toHaveText('휴식 대기');
    await expect(popover.locator('#tray-primary')).toHaveText('휴식 시작');
    await popover.locator('#tray-primary').click();
    await expect(popover.locator('#tray-status')).toHaveText('휴식 중');
    await expect(
      page.getByRole('button', { name: '일시정지', exact: true }),
    ).toBeVisible();
    await popover.locator('#tray-end').click();
    await expect(popover.locator('#tray-status')).toHaveText('집중 대기');
    await page.evaluate(async () => {
      for (const id of ['t1', 't2', 't3'])
        await window.to3mato!.dispatch({
          type: 'task:toggle',
          payload: { id },
        });
    });
    await expect(popover.locator('#tray-primary')).toBeDisabled();
    await expect(popover.locator('#tray-end')).toBeDisabled();
    await expect(popover.locator('#tray-task')).toBeEmpty();
    // The popover is allowed timer IPC, but not data/settings IPC.
    expect(
      await popover.evaluate(async () => {
        try {
          await window.to3mato!.dispatch({
            type: 'settings:save',
            payload: { focus: 42 },
          });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    expect((await trayAction('blur-click')).visible).toBe(false);
    await expect
      .poll(() => popover.evaluate(() => (window as any).trayVisibility.at(-1)))
      .toBe(false);
    await page.waitForTimeout(220);
    expect((await trayAction('click')).visible).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith('/tray.html'))!
        .minimize(),
    );
    // Direct DOM activation also works if OS focus moved while minimizing.
    await popover
      .getByRole('button', { name: 'To3mato 열기' })
      .evaluate((el: HTMLButtonElement) => el.click());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().endsWith('/tray.html'))!
            .isMinimized(),
        ),
      )
      .toBe(false);
    expect((await trayAction('snapshot')).visible).toBe(false);
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith('/tray.html'))!
        .close(),
    );
    await closed;
  } finally {
    await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
