import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import type { UpdateStatus } from '../src/lib/types';

test('desktop update card handles progress, errors and ready without interrupting the timer', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-update-ui-'));
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  delete env.TO3MATO_UPDATE_URL;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole('button', { name: '프로젝트 아이디어 정리 시작', exact: true })
      .click();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const card = page.getByRole('region', { name: '업데이트', exact: true });
    const check = card.getByRole('button', {
      name: '업데이트 확인',
      exact: true,
    });
    await expect(card).toContainText(
      `현재 버전 ${await app.evaluate(({ app }) => app.getVersion())}`,
    );
    await expect(card.getByRole('status')).toHaveText('최신 버전입니다.');
    const emit = (status: UpdateStatus) =>
      app.evaluate(({ BrowserWindow }, status) => {
        BrowserWindow.getAllWindows()
          .find(
            (window) => !window.webContents.getURL().endsWith('/tray.html'),
          )!
          .webContents.send('update:status', status);
      }, status);
    await emit({ status: 'checking' });
    await expect(card.getByRole('status')).toHaveText('확인 중입니다.');
    await expect(check).toBeDisabled();
    await emit({ status: 'downloading', version: '0.3.1', percent: 42 });
    await expect(card.getByRole('status')).toHaveText('0.3.1 내려받는 중 42%');
    await emit({ status: 'ready', version: '0.3.1' });
    await expect(card.getByRole('status')).toHaveText(
      '0.3.1 설치 준비가 끝났습니다. 다시 시작하면 적용됩니다.',
    );
    await expect(
      card.getByRole('button', { name: '다시 시작', exact: true }),
    ).toBeEnabled();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).timer?.running,
    ).toBe(true);
    await expect(page.locator('.toast')).not.toHaveClass(/visible/);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/update-settings-ready.png' });
    await emit({ status: 'error', message: 'internal error must not appear' });
    await expect(card.getByRole('status')).toHaveText(
      '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하세요.',
    );
    await expect(check).toBeEnabled();
    await expect(
      card.getByRole('button', { name: '다시 시작', exact: true }),
    ).toHaveCount(0);
    await check.click();
    await expect(card.getByRole('status')).toHaveText('최신 버전입니다.');
    await page.getByRole('button', { name: '할 일', exact: true }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('최신 버전입니다.');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('packaged updater checks a loopback feed and retries after network errors', async () => {
  test.skip(!process.env.TO3MATO_EXECUTABLE, 'Requires a packaged app');
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'to3mato-update-package-'),
  );
  let requests = 0;
  let statusCode = 200;
  let feedVersion = '0.3.0';
  const server = createServer((request, response) => {
    requests++;
    if (!request.url?.startsWith('/latest-mac.yml')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(statusCode, { 'Content-Type': 'application/yaml' });
    response.end(
      `version: ${feedVersion}\nfiles:\n  - url: To3mato-${feedVersion}-arm64-mac.zip\n    sha512: unused\n    size: 1\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const env = {
    ...process.env,
    TO3MATO_USER_DATA: directory,
    TO3MATO_UPDATE_URL: `http://127.0.0.1:${port}/`,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.TO3MATO_EXECUTABLE,
      args: [],
      env,
    });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const card = page.getByRole('region', { name: '업데이트', exact: true });
    const check = card.getByRole('button', {
      name: '업데이트 확인',
      exact: true,
    });
    await expect(card).toContainText(
      `현재 버전 ${await app.evaluate(({ app }) => app.getVersion())}`,
    );
    const installedVersion = await app.evaluate(({ app }) => app.getVersion());
    for (const version of [installedVersion, '0.0.1', '9999.0.0-beta.1']) {
      feedVersion = version;
      const previous = requests;
      await check.click();
      await expect.poll(() => requests).toBeGreaterThan(previous);
      await expect(card.getByRole('status')).toHaveText('최신 버전입니다.');
    }
    statusCode = 503;
    await check.click();
    await expect(card.getByRole('status')).toHaveText(
      '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하세요.',
    );
    await expect(page.locator('.toast')).not.toHaveClass(/visible/);
    statusCode = 200;
    feedVersion = installedVersion;
    await check.click();
    await expect(card.getByRole('status')).toHaveText('최신 버전입니다.');
  } finally {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
