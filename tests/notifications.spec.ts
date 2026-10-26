import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('background focus and rest completion notify once and clicking restores the app', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-notify-'));
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('#clock')).toHaveText('25:00');
    // Observe native API calls without depending on the tester's OS permissions.
    await app.evaluate(({ Notification }) => {
      (globalThis as any).timerNotices = [];
      Notification.isSupported = () => true;
      Notification.prototype.show = function () {
        (globalThis as any).timerNotices.push({
          title: this.title,
          body: this.body,
          instance: this,
        });
      };
    });
    const notices = () =>
      app.evaluate(() =>
        (globalThis as any).timerNotices.map(({ title, body }: any) => ({
          title,
          body,
        })),
      );
    await page.evaluate(() =>
      window.to3mato!.dispatch({
        type: 'settings:save',
        payload: { focus: 1, rest: 3 },
      }),
    );
    await page
      .getByRole('button', { name: '프로젝트 아이디어 정리 시작', exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => !window.webContents.getURL().endsWith('/tray.html'))!
        .hide(),
    );
    await expect.poll(notices).toEqual([
      {
        title: '집중 시작',
        body: '프로젝트 아이디어 정리',
      },
      {
        title: '집중 타이머 끝',
        body: '프로젝트 아이디어 정리 · 1포모도로 완료. 휴식 시간입니다',
      },
    ]);
    // The finished focus waits in the check-in until the user continues.
    expect(
      (await page.evaluate(() => window.to3mato!.load())).timer,
    ).toMatchObject({ phase: 'checkin', running: false });
    await app.evaluate(() =>
      (globalThis as any).timerNotices[1].instance.emit('click'),
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(
            (window) => !window.webContents.getURL().endsWith('/tray.html'),
          )!
          .isVisible(),
      ),
    ).toBe(true);
    await page.reload();
    await page.evaluate(() =>
      window.to3mato!.dispatch({ type: 'checkin:skip' }),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => !window.webContents.getURL().endsWith('/tray.html'))!
        .hide(),
    );
    await expect
      .poll(async () => (await notices()).map((n: any) => n.title))
      .toEqual(['집중 시작', '집중 타이머 끝', '휴식 끝']);
    const rested = await page.evaluate(() => window.to3mato!.load());
    expect(rested.timer).toBe(null);
    expect(rested.records).toHaveLength(1);
    await app.evaluate(() =>
      (globalThis as any).timerNotices[2].instance.emit('click'),
    );
    await page.evaluate(() =>
      window.to3mato!.dispatch({
        type: 'settings:save',
        payload: { focus: 30, rest: 30 },
      }),
    );
    await page
      .getByRole('button', { name: '프로젝트 아이디어 정리 시작', exact: true })
      .click();
    await page
      .getByRole('button', { name: '디자인 강의 수강 시작', exact: true })
      .click();
    await page.getByRole('button', { name: '집중 종료', exact: true }).click();
    await page.reload();
    await expect(page.locator('#clock')).toHaveText('00:30');
    expect((await notices()).map((n: any) => n.title)).toEqual([
      '집중 시작',
      '집중 타이머 끝',
      '휴식 끝',
      '집중 시작',
      '집중 시작',
    ]);
    expect((await page.evaluate(() => window.to3mato!.load())).timer).toBe(
      null,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
