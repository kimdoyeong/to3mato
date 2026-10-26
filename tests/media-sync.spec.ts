import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'vite';

test('media queue keeps edit order and permits metadata/deletion while a file exceeds quota', async () => {
  const vite = await createServer({
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
  });
  await vite.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.goto(
      `http://127.0.0.1:${(vite.httpServer!.address() as any).port}/tests/sync-harness.html`,
    );
    const result = await page.evaluate(async () => {
      const modulePath = '/src/lib/media-sync.ts',
        contextPath = '/src/lib/sync-context.ts';
      const media = await import(modulePath),
        context = await import(contextPath);
      context.syncContext.set({
        owner: 'queue-test',
        deviceId: 'device',
        offset: 0,
        timeZone: 'UTC',
        extras: { rituals: [], clips: [], deliveries: [], assets: [] },
      });
      const db = await media.openMediaDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('syncQueue', 'readwrite');
        media.queueMedia(
          tx,
          'clips',
          'blocked',
          {},
          new Blob(['video'], { type: 'video/webm' }),
        );
        media.queueMedia(tx, 'deliveries', 'weekly', { seen: true });
        media.queueMedia(tx, 'deliveries', 'weekly', { seen: false });
        media.queueMedia(
          tx,
          'clips',
          'removed',
          {},
          new Blob(['cancel'], { type: 'video/webm' }),
        );
        media.queueMedia(
          tx,
          'clips',
          'removed',
          {},
          undefined,
          undefined,
          true,
        );
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const before = await media.allRows(db, 'syncQueue'),
        calls: any[] = [];
      let uploads = 0;
      (window as any).to3mato = {
        sync: {
          putAsset: async () => {
            uploads++;
            throw new Error('파일 저장 용량을 초과했습니다.');
          },
          extra: async (...args: any[]) => {
            calls.push(args);
          },
        },
      };
      await media.flushMedia();
      return {
        order: before.map((job: any) => job.sequence),
        calls: calls.map((call) => ({
          id: call[1],
          fields: call[2],
          deleted: call[3],
        })),
        pending: (await media.allRows(db, 'syncQueue')).map(
          (job: any) => job.entityId,
        ),
        uploads,
      };
    });
    expect(result.order).toEqual([1, 2, 3, 4, 5]);
    expect(result.uploads).toBe(1);
    expect(result.pending).toEqual(['blocked']);
    expect(result.calls).toEqual([
      { id: 'weekly', fields: { seen: true }, deleted: false },
      { id: 'weekly', fields: { seen: false }, deleted: false },
      { id: 'removed', fields: {}, deleted: true },
    ]);
  } finally {
    await browser.close();
    await vite.close();
  }
});
