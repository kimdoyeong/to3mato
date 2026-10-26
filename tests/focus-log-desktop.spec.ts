import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SQLiteStore } from '../electron/storage.mjs';

test('desktop captures, automatically delivers missed weeks and downloads through native save dialog', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-camera-'));
  const db = new SQLiteStore(directory);
  const state = db.load();
  state.timer = {
    taskId: state.tasks[0].id,
    phase: 'focus',
    duration: 10,
    elapsed: 7,
    startedAt: Date.now(),
    running: true,
  };
  db.save(state);
  db.close();
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [
        '.',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
      env,
    });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '촬영', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '3초 촬영' }),
    ).not.toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: '집중 로그', exact: true }).click();
    await expect(page.locator('.moment-card')).toHaveCount(1);
    // Move the saved moment to a closed week, then restart to test missed delivery recovery.
    await page.evaluate(async () => {
      const request = indexedDB.open('to3mato-focus-log');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['clips', 'summaries'], 'readwrite');
        const read = tx.objectStore('clips').getAll();
        read.onsuccess = () => {
          const clip = read.result[0];
          clip.at -= 14 * 86400000;
          const { blob, ...summary } = clip;
          tx.objectStore('clips').put(clip);
          tx.objectStore('summaries').put(summary);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    });
    await app.close();
    app = undefined;
    app = await electron.launch({ args: ['.'], env });
    const restarted = await app.firstWindow();
    await restarted
      .getByRole('button', { name: '집중 로그', exact: true })
      .click();
    await expect(restarted.locator('.delivery-card')).toHaveCount(1, {
      timeout: 15000,
    });
    const output = path.join(directory, 'week.webm');
    await app.evaluate(({ dialog }, output) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: output,
      });
    }, output);
    await restarted.getByRole('button', { name: '배달 알림 닫기' }).click();
    await restarted
      .getByRole('button', { name: '다운로드', exact: true })
      .click();
    await expect(restarted.getByRole('status')).toContainText(
      '다운로드했습니다',
      { timeout: 12000 },
    );
    expect((await stat(output)).size).toBeGreaterThan(5000);
    expect((await readFile(output)).subarray(0, 4).toString('hex')).toBe(
      '1a45dfa3',
    );
    await app.close();
    app = undefined;
    app = await electron.launch({ args: ['.'], env });
    const finalPage = await app.firstWindow();
    await finalPage
      .getByRole('button', { name: '집중 로그', exact: true })
      .click();
    await expect(finalPage.locator('.delivery-card')).toHaveCount(1);
    await expect(
      finalPage.getByRole('region', { name: '주간 영상 배달' }),
    ).not.toBeVisible();
    await expect(
      finalPage.getByText('인증샷을 남길까요?', { exact: true }),
    ).not.toBeVisible();
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
