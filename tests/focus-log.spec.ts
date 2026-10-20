import {
  test,
  expect,
  chromium,
  type Browser,
  type Page,
} from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { readFile } from 'node:fs/promises';

let server: ViteDevServer, browser: Browser;
test.beforeAll(async () => {
  server = await createServer({ server: { port: 4178, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({
    channel: 'chrome',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
});
test.afterAll(async () => {
  await browser?.close();
  await server?.close();
});
async function open() {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4178');
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    (window as any).cameraCalls = 0;
    (window as any).cameraTracks = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      (window as any).cameraCalls++;
      const stream = await original(constraints);
      (window as any).cameraTracks.push(...stream.getTracks());
      return stream;
    };
  });
  return { context, page };
}
async function finish(page: Page, phase = 'focus') {
  await page.evaluate(async (phase) => {
    const client = await import(/* @vite-ignore */ '/src/lib/client.ts');
    const unsubscribe = client.state.subscribe((state: any) => {
      (window as any).latestState = state;
    });
    const state = structuredClone((window as any).latestState);
    unsubscribe();
    state.timer = {
      taskId: phase === 'focus' ? state.tasks[0].id : null,
      phase,
      duration: 10,
      elapsed: 9.7,
      startedAt: Date.now(),
      running: true,
    };
    client.state.set(state);
  }, phase);
}

test('completion opt-in records locally and automatically delivers a downloadable weekly film', async () => {
  const { context, page } = await open();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await finish(page);
    await expect(page.getByText('인증샷을 남길까요?')).toBeVisible();
    expect(await page.evaluate(() => (window as any).cameraCalls)).toBe(0);
    await page.getByRole('button', { name: '촬영', exact: true }).click();
    await expect(page.getByText('촬영 중')).toBeVisible({
      timeout: 10000,
    });
    await page.screenshot({ path: 'test-results/focus-log-recording.png' });
    await expect(
      page.getByRole('dialog', { name: '3초 촬영' }),
    ).not.toBeVisible({ timeout: 10000 });
    expect(
      await page.evaluate(() =>
        (window as any).cameraTracks.every(
          (t: MediaStreamTrack) => t.readyState === 'ended',
        ),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '집중 로그', exact: true }).click();
    await expect(page.locator('.moment-card')).toHaveCount(1);
    // Seed two past-week moments; delivery must begin without an export action.
    await page.evaluate(async () => {
      const log = await import(/* @vite-ignore */ '/src/lib/focus-log.ts');
      const [summary] = await log.listClips();
      const clip = await log.readClip(summary.id);
      const at = log.weekBounds(-2).start.getTime() + 3600000;
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      await log.saveClip({
        ...clip,
        id: 'past-first',
        taskTitle: '첫 번째 순간',
        at,
      });
      await log.saveClip({
        ...clip,
        id: 'past-second',
        taskTitle: '두 번째 순간',
        at: at + 1000,
      });
    });
    await page.reload();
    await expect(
      page.getByRole('region', { name: '주간 영상 배달' }),
    ).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: '영상 보기', exact: true }).click();
    await expect(page.locator('.delivery-card')).toHaveCount(1);
    await expect(page.locator('.delivery-card')).toContainText('영상 2개');
    await page.screenshot({ path: 'test-results/focus-log-delivery.png' });
    await page.reload();
    await page.getByRole('button', { name: '집중 로그', exact: true }).click();
    await expect(page.locator('.delivery-card')).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: '주간 영상 배달' }),
    ).not.toBeVisible();
    await page.getByRole('button', { name: '이전 기록 주' }).click();
    await expect(page.locator('.moment-card')).toHaveCount(0);
    await page.getByRole('button', { name: '이전 기록 주' }).click();
    await expect(page.locator('.moment-card')).toHaveCount(2);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '다운로드', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/^to3mato-.*\.webm$/);
    const bytes = await readFile((await download.path())!);
    expect(bytes.length).toBeGreaterThan(5000);
    const duration = await page.evaluate(async (data) => {
      const blob = new Blob([new Uint8Array(data)], { type: 'video/webm' });
      const url = URL.createObjectURL(blob),
        video = document.createElement('video');
      video.muted = true;
      video.src = url;
      return await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Montage did not play to completion')),
          15000,
        );
        video.onerror = () => reject(new Error('Invalid video'));
        video.onended = () => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          resolve(video.currentTime);
        };
        video.play().catch(reject);
      });
    }, Array.from(bytes));
    expect(duration).toBeGreaterThan(5.5);
    expect(duration).toBeLessThan(7);
    await page.getByRole('button', { name: '영상 편지 보기' }).click();
    await expect(
      page.getByRole('dialog', { name: '집중 기록 재생' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '영상 닫기' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '두 번째 순간 영상 삭제' }).click();
    await expect(page.locator('.moment-card')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('rest completion and skipped capture never access camera; denied access is recoverable', async () => {
  const { context, page } = await open();
  try {
    await finish(page, 'rest');
    await expect(page.locator('#clock')).not.toHaveText('00:01');
    await expect(page.getByText('인증샷을 남길까요?')).not.toBeVisible();
    await finish(page);
    await page.getByRole('button', { name: '건너뛰기' }).click();
    expect(await page.evaluate(() => (window as any).cameraCalls)).toBe(0);
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      };
    });
    await finish(page);
    await page.getByRole('button', { name: '촬영', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      '카메라 권한이 필요합니다',
    );
    await page.getByRole('button', { name: '촬영 닫기' }).click();
    await page.getByRole('button', { name: '집중 로그', exact: true }).click();
    await expect(page.getByText('이번 주 기록 없음')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('cancel during countdown stops every camera track without saving', async () => {
  const { context, page } = await open();
  try {
    await finish(page);
    await page.getByRole('button', { name: '촬영', exact: true }).click();
    await expect(
      page.getByText('카운트다운 후 3초 동안 촬영합니다.'),
    ).toBeVisible();
    await page.getByRole('button', { name: '촬영 닫기' }).click();
    expect(
      await page.evaluate(() =>
        (window as any).cameraTracks.every(
          (t: MediaStreamTrack) => t.readyState === 'ended',
        ),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '집중 로그', exact: true }).click();
    await expect(page.getByText('이번 주 기록 없음')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('delivery schedule is Monday at 9, chronological, once per nonempty week', async () => {
  const { context, page } = await open();
  try {
    const result = await page.evaluate(async () => {
      const { dueWeeks, deliveryTime } = await import(
        /* @vite-ignore */ '/src/lib/deliveries.ts'
      );
      const end = new Date(2026, 9, 19),
        due = deliveryTime(end).getTime();
      const base = {
        taskTitle: 'test',
        focusSeconds: 1500,
        duration: 3000,
        thumbnail: new Blob(),
      };
      const clips = [
        { ...base, id: 'sunday', at: new Date(2026, 9, 18, 23, 59).getTime() },
        { ...base, id: 'monday', at: new Date(2026, 9, 12, 0, 0).getTime() },
        { ...base, id: 'next-week', at: end.getTime() },
      ];
      const ready = dueWeeks(clips, [], due);
      return {
        before: dueWeeks(clips, [], due - 1).length,
        ready: ready.map((week: any) => ({
          id: week.id,
          clips: week.clips.map((clip: any) => clip.id),
        })),
        repeat: dueWeeks(clips, [{ id: '2026-10-12' }], due).length,
        empty: dueWeeks([], [], due).length,
        hour: new Date(due).getHours(),
      };
    });
    expect(result).toEqual({
      before: 0,
      ready: [{ id: '2026-10-12', clips: ['monday', 'sunday'] }],
      repeat: 0,
      empty: 0,
      hour: 9,
    });
  } finally {
    await context.close();
  }
});
