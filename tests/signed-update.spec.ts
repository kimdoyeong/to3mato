import {
  test,
  expect,
  _electron as electron,
  chromium,
} from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { AppState } from '../src/lib/types';

// Explicit opt-in: these tests perform a real signed bundle replacement.
test.skip(
  process.env.TO3MATO_SIGNED_UPDATE_TEST !== '1',
  'Requires signed integration builds',
);
test.setTimeout(180_000);
const root = path.resolve('release/update-integration');
const oldBundle = path.join(root, '0.3.0-zip/mac-arm64/To3mato.app');
const newRelease = path.join(root, '0.3.1');
const cache = path.join(
  os.homedir(),
  'Library/Caches/to3mato-update-integration-updater',
);
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: 'utf8' });

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

for (const mode of ['restart', 'quit'] as const) {
  test(`signed 0.3.0 → 0.3.1 via ${mode} preserves running timer and user data`, async () => {
    const folder = await fs.mkdtemp(path.join(root, `run-${mode}-`));
    const userData = await fs.mkdtemp(path.join(folder, 'data-'));
    const bundle = path.join(folder, 'To3mato.app');
    await fs.rm(bundle, { recursive: true, force: true });
    await fs.rm(cache, { recursive: true, force: true });
    run('ditto', [oldBundle, bundle]);
    run('codesign', ['--verify', '--deep', '--strict', bundle]);
    const feed = await fs.readFile(path.join(newRelease, 'latest-mac.yml'));
    let phase: 'offline' | 'corrupt' | 'valid' =
      mode === 'restart' ? 'offline' : 'valid';
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const name = new URL(request.url!, 'http://127.0.0.1').pathname.slice(1);
      requests.push(`${phase}:${name}`);
      if (phase === 'offline') {
        response.writeHead(503).end();
        return;
      }
      if (name === 'latest-mac.yml') {
        response
          .writeHead(200, { 'Content-Type': 'application/yaml' })
          .end(feed);
        return;
      }
      if (name === 'To3mato-0.3.1-arm64-mac.zip' && phase === 'corrupt') {
        response.writeHead(200, { 'Content-Length': 9 }).end('corrupted');
        return;
      }
      if (
        ![
          'To3mato-0.3.1-arm64-mac.zip',
          'To3mato-0.3.1-arm64-mac.zip.blockmap',
        ].includes(name)
      ) {
        response.writeHead(404).end();
        return;
      }
      try {
        const filename = path.join(newRelease, name);
        const { size } = await fs.stat(filename);
        response.writeHead(200, {
          'Content-Length': size,
          'Content-Type': 'application/octet-stream',
        });
        createReadStream(filename).pipe(response);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const feedURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const debugPort = await freePort();
    const bootLog = path.join(folder, 'boot.jsonl');
    await fs.writeFile(bootLog, '');
    await fs.writeFile(
      path.join(root, 'runtime.json'),
      JSON.stringify({ userData, feedURL, debugPort, bootLog }),
    );
    const env = {
      ...process.env,
      TO3MATO_USER_DATA: userData,
      TO3MATO_UPDATE_URL: feedURL,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TO3MATO_DEV_URL;
    const executablePath = path.join(bundle, 'Contents/MacOS/To3mato');
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let reconnected:
      Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    let reopened: Awaited<ReturnType<typeof electron.launch>> | undefined;
    const stderr: string[] = [];
    try {
      app = await electron.launch({ executablePath, args: [], env });
      app.process().stderr?.on('data', (chunk) => stderr.push(String(chunk)));
      const page = await app.firstWindow();
      await expect(page.locator('#clock')).toHaveText('25:00');
      expect(await page.evaluate(() => window.to3mato!.version())).toBe(
        '0.3.0',
      );
      await page.evaluate(() =>
        window.to3mato!.dispatch({
          type: 'settings:save',
          payload: { focus: 900, rest: 600 },
        }),
      );
      await page.evaluate(() =>
        window.to3mato!.dispatch({ type: 'timer:play', payload: { id: 't2' } }),
      );
      await page.waitForTimeout(1200);
      await page.evaluate(() =>
        window.to3mato!.dispatch({ type: 'timer:end' }),
      );
      await page.evaluate(() =>
        window.to3mato!.dispatch({
          type: 'task:save',
          payload: {
            title: 'Signed update persistence test',
            estimate: 2,
            project: '',
            date: '',
          },
        }),
      );
      await page.evaluate(() =>
        window.to3mato!.dispatch({ type: 'timer:play', payload: { id: 't1' } }),
      );
      await page.getByRole('button', { name: '설정', exact: true }).click();
      const card = page.getByRole('region', { name: '업데이트', exact: true });
      const check = card.getByRole('button', {
        name: '업데이트 확인',
        exact: true,
      });
      const checkUpdate = async () => {
        await check.click();
      };
      if (mode === 'restart') {
        await checkUpdate();
        await expect(card.getByRole('status')).toHaveText(
          '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하세요.',
        );
        phase = 'corrupt';
        await checkUpdate();
        await expect(page.locator('.toast')).toHaveText(
          '업데이트 파일을 검증하지 못했습니다. 다운로드 페이지에서 다시 설치하세요.',
          { timeout: 30_000 },
        );
        await expect(
          card.getByRole('button', { name: '다시 시작', exact: true }),
        ).toHaveCount(0);
        expect(await page.evaluate(() => window.to3mato!.version())).toBe(
          '0.3.0',
        );
        phase = 'valid';
      }
      await checkUpdate();
      await expect(card.getByRole('status')).toHaveText(
        '0.3.1 설치 준비가 끝났습니다. 다시 시작하면 적용됩니다.',
        { timeout: 90_000 },
      );
      const before = await page.evaluate(() => window.to3mato!.load());
      expect(before.timer?.running).toBe(true);
      expect(before.records.length).toBeGreaterThan(0);
      expect(before.settings).toEqual({ focus: 900, rest: 600 });
      await page.waitForTimeout(1500);
      expect(
        (await page.evaluate(() => window.to3mato!.load())).timer?.running,
      ).toBe(true);
      expect(await page.evaluate(() => window.to3mato!.version())).toBe(
        '0.3.0',
      );
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(folder, 'ready.png') });
      if (mode === 'restart') {
        const closed = app.waitForEvent('close');
        await card
          .getByRole('button', { name: '다시 시작', exact: true })
          .click();
        await closed;
        app = undefined;
      } else {
        await app.close();
        app = undefined;
      }
      await expect
        .poll(
          () =>
            run('/usr/libexec/PlistBuddy', [
              '-c',
              'Print :CFBundleShortVersionString',
              path.join(bundle, 'Contents/Info.plist'),
            ]).trim(),
          { timeout: 60_000 },
        )
        .toBe('0.3.1');
      run('codesign', ['--verify', '--deep', '--strict', bundle]);
      run('xcrun', ['stapler', 'validate', bundle]);
      let after: AppState;
      if (mode === 'restart') {
        await expect
          .poll(
            async () => {
              try {
                return (await fs.readFile(bootLog, 'utf8')).includes(
                  '"version":"0.3.1"',
                );
              } catch {
                return false;
              }
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        reconnected = await chromium.connectOverCDP(
          `http://127.0.0.1:${debugPort}`,
        );
        await expect
          .poll(() =>
            reconnected!
              .contexts()[0]
              ?.pages()
              .some((p) => p.url().startsWith('app://to3mato/')),
          )
          .toBe(true);
        const updatedPage = reconnected
          .contexts()[0]
          .pages()
          .find((p) => p.url().startsWith('app://to3mato/'))!;
        await expect(
          updatedPage.getByRole('button', { name: '집중 재개', exact: true }),
        ).toBeVisible();
        expect(
          await updatedPage.evaluate(() => window.to3mato!.version()),
        ).toBe('0.3.1');
        after = await updatedPage.evaluate(() => window.to3mato!.load());
        await updatedPage
          .getByRole('button', { name: '설정', exact: true })
          .click();
        await expect(
          updatedPage.getByRole('region', { name: '업데이트', exact: true }),
        ).toContainText('현재 버전 0.3.1');
        await updatedPage
          .getByRole('region', { name: '업데이트', exact: true })
          .scrollIntoViewIfNeeded();
        await updatedPage.screenshot({
          path: path.join(folder, 'installed.png'),
        });
        await updatedPage.close();
        await reconnected.close();
        reconnected = undefined;
      } else {
        // Normal quit must install without automatically opening a new app.
        expect(await fs.readFile(bootLog, 'utf8')).toBe('');
        reopened = await electron.launch({ executablePath, args: [], env });
        const updatedPage = await reopened.firstWindow();
        await expect(
          updatedPage.getByRole('button', { name: '집중 재개', exact: true }),
        ).toBeVisible();
        expect(
          await updatedPage.evaluate(() => window.to3mato!.version()),
        ).toBe('0.3.1');
        after = await updatedPage.evaluate(() => window.to3mato!.load());
        await reopened.close();
        reopened = undefined;
      }
      expect(after.tasks).toEqual(before.tasks);
      expect(after.projects).toEqual(before.projects);
      expect(after.records).toEqual(before.records);
      expect(after.settings).toEqual(before.settings);
      expect(after.timer?.taskId).toBe(before.timer?.taskId);
      expect(after.timer?.running).toBe(false);
      expect(after.timer?.elapsed).toBeGreaterThan(0);
      await fs.writeFile(
        path.join(folder, 'result.json'),
        JSON.stringify(
          {
            passed: true,
            mode,
            from: '0.3.0',
            to: '0.3.1',
            automaticRestart: mode === 'restart',
            before,
            after,
            requests,
            userData,
            verifiedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(root, `latest-${mode}.json`),
        JSON.stringify(
          { folder, result: path.join(folder, 'result.json') },
          null,
          2,
        ),
      );
    } finally {
      await app?.close().catch(() => {});
      await reopened?.close().catch(() => {});
      if (reconnected) {
        for (const context of reconnected.contexts())
          for (const page of context.pages())
            await page.close().catch(() => {});
        await reconnected.close().catch(() => {});
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.writeFile(path.join(folder, 'stderr.log'), stderr.join(''));
    }
  });
}
