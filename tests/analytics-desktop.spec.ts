import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

type Sent = {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

async function collector() {
  const batches: Array<{ api_key: string; batch: Sent[] }> = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/batch/')
        batches.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"status":1}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    batches,
    events: () => batches.flatMap((item) => item.batch),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function launch(directory: string, extra: Record<string, string>) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TO3MATO_USER_DATA: directory,
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  return electron.launch({ args: ['.'], env });
}

const stored = async (directory: string) =>
  JSON.parse(await fs.readFile(path.join(directory, 'analytics.json'), 'utf8'));

test('usage events reach the collector without user text and stop when switched off', async () => {
  const server = await collector();
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'to3mato-analytics-'),
  );
  const env = {
    TO3MATO_ANALYTICS: 'on',
    TO3MATO_ANALYTICS_KEY: 'phc_test',
    TO3MATO_ANALYTICS_HOST: server.url,
  };
  const title = '비밀 할 일 제목';
  try {
    const app = await launch(directory, env);
    const page = await app.firstWindow();
    await expect(
      page.getByRole('button', { name: '설정', exact: true }),
    ).toBeVisible();
    // The launch event is sent right away.
    await expect
      .poll(() => server.events().map((item) => item.event))
      .toContain('app_opened');
    const opened = server.events().find((item) => item.event === 'app_opened')!;
    expect(server.batches[0].api_key).toBe('phc_test');
    expect(opened.properties).toMatchObject({
      first_launch: true,
      platform: 'desktop',
      $lib: 'to3mato-desktop',
      $process_person_profile: false,
      signed_in: false,
      sync_enabled: false,
    });
    await page.evaluate(
      (value) =>
        window.to3mato!.dispatch({
          type: 'task:save',
          payload: { title: value, estimate: 1, date: '', project: '' },
        }),
      title,
    );
    await page.getByRole('button', { name: '캘린더', exact: true }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const toggle = page.getByRole('switch', { name: '사용 통계 전송' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await app.close();

    // Events that were not sent yet wait in the data folder.
    const waiting = await stored(directory);
    expect(waiting.enabled).toBe(true);
    const pending = waiting.pending.map((item: Sent) => [
      item.event,
      item.properties.screen ?? item.properties.source ?? '',
    ]);
    expect(pending).toEqual(
      expect.arrayContaining([
        ['screen_viewed', 'todo'],
        ['task_created', 'window'],
        ['screen_viewed', 'calendar'],
        ['screen_viewed', 'settings'],
      ]),
    );

    const again = await launch(directory, env);
    const second = await again.firstWindow();
    await expect
      .poll(() => server.events().map((item) => item.event))
      .toContain('task_created');
    const events = server.events();
    expect(new Set(events.map((item) => item.distinct_id)).size).toBe(1);
    expect(events[0].distinct_id).toBe(waiting.id);
    expect(
      events.filter((item) => item.event === 'app_opened').at(-1)!.properties
        .first_launch,
    ).toBe(false);
    expect(JSON.stringify(server.batches)).not.toContain('비밀');

    // Switching it off stops collection on this device, across restarts.
    await second.getByRole('button', { name: '설정', exact: true }).click();
    await second.getByRole('switch', { name: '사용 통계 전송' }).click();
    await expect(
      second.getByRole('switch', { name: '사용 통계 전송' }),
    ).toHaveAttribute('aria-checked', 'false');
    await second.getByRole('button', { name: '캘린더', exact: true }).click();
    await again.close();
    const off = await stored(directory);
    expect(off.enabled).toBe(false);
    expect(off.pending).toEqual([]);

    const sent = server.batches.length;
    const last = await launch(directory, env);
    const third = await last.firstWindow();
    await third.getByRole('button', { name: '설정', exact: true }).click();
    await expect(
      third.getByRole('switch', { name: '사용 통계 전송' }),
    ).toHaveAttribute('aria-checked', 'false');
    await third.waitForTimeout(1000);
    await last.close();
    expect(server.batches.length).toBe(sent);
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a normal test or development run collects nothing and shows no switch', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'to3mato-analytics-'),
  );
  try {
    const app = await launch(directory, {});
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '업데이트' })).toBeVisible();
    await expect(
      page.getByRole('switch', { name: '사용 통계 전송' }),
    ).toHaveCount(0);
    await app.close();
    await expect(
      fs.access(path.join(directory, 'analytics.json')),
    ).rejects.toThrow();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
