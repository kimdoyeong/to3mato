import {
  test,
  expect,
  _electron as electron,
  chromium,
} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { syncHttpServer } from './helpers/sync-http.mjs';

test('two Macs and browser share tasks, timer and media with optional sync', async () => {
  test.setTimeout(120000);
  const server = await syncHttpServer();
  const vite = await createServer({
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
  });
  await vite.listen();
  const directories = await Promise.all(
    [1, 2].map(() => fs.mkdtemp(path.join(os.tmpdir(), 'to3mato-live-sync-'))),
  );
  const apps: any[] = [];
  let browser: any;
  try {
    for (const directory of directories) {
      const env = {
        ...process.env,
        TO3MATO_USER_DATA: directory,
        TO3MATO_SUPABASE_URL: server.url,
        TO3MATO_SUPABASE_PUBLISHABLE_KEY: 'test',
        TO3MATO_SYNC_TEST: '1',
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.TO3MATO_DEV_URL;
      apps.push(await electron.launch({ args: ['.'], env }));
    }
    const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
    for (const page of [a, b]) {
      await expect(
        page.getByRole('navigation', { name: '작업 영역 탭' }),
      ).toBeVisible();
      await page.getByRole('button', { name: '설정', exact: true }).click();
      await expect(
        page.getByText(
          '연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.',
          { exact: true },
        ),
      ).toBeVisible();
      await page.getByLabel('이메일', { exact: true }).fill('a@example.test');
      await page
        .getByRole('button', { name: '인증 코드 받기', exact: true })
        .click();
      await page.getByLabel('인증 코드', { exact: true }).fill('123456');
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '연동', exact: true }),
      ).toBeVisible();
      expect(
        (await page.evaluate(() => window.to3mato!.account.status())).enabled,
      ).toBe(false);
    }
    // Existing local clips and weekly videos must survive first-account adoption.
    await a.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 60;
      canvas.getContext('2d')!.fillRect(0, 0, 80, 60);
      const stream = canvas.captureStream(10),
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 250));
      recorder.stop();
      await done;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      const thumbnail = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), 'image/png'),
      );
      const request = indexedDB.open('to3mato-focus-log', 3);
      request.onupgradeneeded = () => {
        for (const name of [
          'clips',
          'summaries',
          'deliveries',
          'deliveryVideos',
          'syncQueue',
        ])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: 'id' });
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ['clips', 'summaries', 'deliveries', 'deliveryVideos'],
          'readwrite',
        );
        const summary = {
          id: 'adopted-clip',
          taskTitle: 'existing video',
          at: Date.now(),
          duration: 250,
          focusSeconds: 1500,
          thumbnail,
        };
        tx.objectStore('clips').put({ ...summary, blob });
        tx.objectStore('summaries').put(summary);
        tx.objectStore('deliveries').put({
          id: '2026-10-12',
          start: Date.now() - 14 * 86400000,
          end: Date.now() - 7 * 86400000,
          deliveredAt: Date.now(),
          clipCount: 1,
          duration: 250,
          seen: true,
        });
        tx.objectStore('deliveryVideos').put({ id: '2026-10-12', blob });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    });
    await Promise.all([
      a.waitForEvent('load'),
      a.getByRole('button', { name: '연동', exact: true }).click(),
    ]);
    await expect
      .poll(
        async () =>
          (await a.evaluate(() => window.to3mato!.account.status())).enabled,
      )
      .toBe(true);
    await a.evaluate(() => window.to3mato!.account.syncNow());
    await b.evaluate(() => window.to3mato!.account.enable());
    await b.evaluate(() => window.to3mato!.account.syncNow());
    await a.getByRole('button', { name: '설정', exact: true }).click();
    await a.screenshot({
      path: 'test-results/sync-settings.png',
      fullPage: true,
    });
    const title = 'shared ' + Date.now();
    await a.evaluate(
      (title) =>
        window.to3mato!.dispatch({
          type: 'task:save',
          payload: { title, estimate: 1, date: '', project: '' },
        }),
      title,
    );
    await expect
      .poll(async () =>
        (await b.evaluate(() => window.to3mato!.load())).tasks.some(
          (t: any) => t.title === title,
        ),
      )
      .toBe(true);
    const task = (await a.evaluate(() => window.to3mato!.load())).tasks.find(
      (t: any) => t.title === title,
    );
    await a.evaluate(
      (id) => window.to3mato!.dispatch({ type: 'timer:play', payload: { id } }),
      task.id,
    );
    await expect
      .poll(
        async () =>
          (await b.evaluate(() => window.to3mato!.load())).timer?.running,
      )
      .toBe(true);
    await b.evaluate(() => window.to3mato!.dispatch({ type: 'timer:pause' }));
    await expect
      .poll(
        async () =>
          (await a.evaluate(() => window.to3mato!.load())).timer?.running,
      )
      .toBe(false);
    await a.evaluate(() => window.to3mato!.dispatch({ type: 'timer:toggle' }));
    await expect
      .poll(
        async () =>
          (await b.evaluate(() => window.to3mato!.load())).timer?.running,
      )
      .toBe(true);
    await Promise.all(
      [a, b].map((page) =>
        page.evaluate(() => window.to3mato!.dispatch({ type: 'timer:end' })),
      ),
    );
    await expect
      .poll(
        async () =>
          (await a.evaluate(() => window.to3mato!.load())).records.length,
      )
      .toBe(1);
    await b.evaluate(() => window.to3mato!.account.syncNow());
    expect(
      (await b.evaluate(() => window.to3mato!.load())).records,
    ).toHaveLength(1);
    await a.evaluate(async () => {
      const bytes = new TextEncoder().encode('image test').buffer;
      await window.to3mato!.sync.putAsset('test.png', 'image/png', bytes);
      await window.to3mato!.account.syncNow();
    });
    await expect
      .poll(async () => {
        await b.evaluate(() => window.to3mato!.account.syncNow());
        return b.evaluate(async () => {
          const file = await window.to3mato!.sync.readAsset('test.png');
          return file ? new TextDecoder().decode(file.bytes) : null;
        });
      })
      .toBe('image test');
    await expect
      .poll(
        async () =>
          (await b.evaluate(() => window.to3mato!.load())).syncContext?.extras
            .clips.length,
      )
      .toBe(1);
    await b.getByRole('button', { name: '집중 로그', exact: true }).click();
    await expect(b.locator('.moment-card')).toHaveCount(1);
    await b.locator('.moment-play').click();
    await expect
      .poll(() =>
        b
          .locator('video.log-preview')
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await b.getByRole('button', { name: '영상 닫기', exact: true }).click();
    await expect(b.locator('.delivery-card')).toHaveCount(1);
    await b
      .getByRole('button', { name: '영상 편지 보기', exact: true })
      .click();
    await expect
      .poll(() =>
        b
          .locator('video.log-preview')
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await b.getByRole('button', { name: '영상 닫기', exact: true }).click();
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(
      `http://127.0.0.1:${(vite.httpServer!.address() as any).port}/tests/sync-harness.html`,
    );
    await page.waitForFunction(
      () => typeof (window as any).openSync === 'function',
    );
    await page.evaluate((url) => (window as any).openSync(url), server.url);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).syncClient.engine.state().tasks.length,
        ),
      )
      .toBe((await a.evaluate(() => window.to3mato!.load())).tasks.length);
    await page.evaluate(() =>
      (window as any).syncClient.engine.dispatch({
        type: 'project:save',
        payload: { name: 'browser project' },
      }),
    );
    await expect
      .poll(async () =>
        (await a.evaluate(() => window.to3mato!.load())).projects.some(
          (p: any) => p.name === 'browser project',
        ),
      )
      .toBe(true);
    await b.evaluate(() => window.to3mato!.account.disable());
    await b.evaluate(() =>
      window.to3mato!.dispatch({
        type: 'task:save',
        payload: { title: 'offline task', estimate: 1, date: '', project: '' },
      }),
    );
    expect(
      (await b.evaluate(() => window.to3mato!.account.status())).pending,
    ).toBeGreaterThan(0);
    expect(
      (await a.evaluate(() => window.to3mato!.load())).tasks.some(
        (t: any) => t.title === 'offline task',
      ),
    ).toBe(false);
    await b.evaluate(() => window.to3mato!.account.enable());
    await expect
      .poll(async () =>
        (await a.evaluate(() => window.to3mato!.load())).tasks.some(
          (t: any) => t.title === 'offline task',
        ),
      )
      .toBe(true);
    const delays: number[] = [];
    for (let i = 0; i < 10; i++) {
      const name = `latency-${i}`,
        start = Date.now();
      await a.evaluate(
        (name) =>
          window.to3mato!.dispatch({ type: 'project:save', payload: { name } }),
        name,
      );
      await expect
        .poll(
          async () =>
            (await b.evaluate(() => window.to3mato!.load())).projects.some(
              (p: any) => p.name === name,
            ),
          { intervals: [10, 25, 50] },
        )
        .toBe(true);
      delays.push(Date.now() - start);
    }
    const p95 = [...delays].sort((a, b) => a - b)[
      Math.ceil(delays.length * 0.95) - 1
    ];
    await fs.writeFile(
      'test-results/sync-latency.json',
      JSON.stringify({ samples: delays, p95 }, null, 2),
    );
    expect(p95).toBeLessThan(1000);
    // Restart preserves the account session; a subsequent different account sees no old data.
    await apps[1].close();
    apps.pop();
    const env = {
      ...process.env,
      TO3MATO_USER_DATA: directories[1],
      TO3MATO_SUPABASE_URL: server.url,
      TO3MATO_SUPABASE_PUBLISHABLE_KEY: 'test',
      TO3MATO_SYNC_TEST: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TO3MATO_DEV_URL;
    const restarted = await electron.launch({ args: ['.'], env });
    apps.push(restarted);
    const restored = await restarted.firstWindow();
    await expect
      .poll(
        async () =>
          (await restored.evaluate(() => window.to3mato!.account.status()))
            .scope,
      )
      .toBe('00000000-0000-4000-8000-000000000001');
    expect(
      (await restored.evaluate(() => window.to3mato!.load())).tasks.some(
        (t: any) => t.title === 'offline task',
      ),
    ).toBe(true);
    await restored.evaluate(async () => {
      await window.to3mato!.account.logout();
      await window.to3mato!.account.verify('b@example.test', '123456');
      await window.to3mato!.account.enable();
      await window.to3mato!.account.syncNow();
    });
    expect(
      (await restored.evaluate(() => window.to3mato!.load())).tasks,
    ).toHaveLength(0);
  } catch (error) {
    console.log('Sync diagnostics', server.events);
    for (const app of apps) {
      const page = await app.firstWindow();
      console.log(await page.evaluate(() => window.to3mato!.account.status()));
    }
    throw error;
  } finally {
    await browser?.close();
    for (const app of apps) await app.close();
    await vite.close();
    await server.close();
    for (const directory of directories)
      await fs.rm(directory, { recursive: true, force: true });
  }
});
