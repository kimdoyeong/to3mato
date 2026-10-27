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

const WELCOME = '일단 3번만 해봅시다. 토오오오마토.';

/** Art, title and description stack top to bottom; a stray flex rule once laid them out in a row. */
async function expectStacked(page: import('@playwright/test').Page) {
  const boxes = await page.evaluate(() =>
    ['.onboarding-art', '#onboarding-title', '.onboarding-body'].map((selector) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }),
  );
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top);
  expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].top);
}

function launch(directory: string, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TO3MATO_USER_DATA: directory,
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  return electron.launch({ args: ['.'], env });
}

test('first run walks through, logs in with one email flow and stays finished', async () => {
  test.setTimeout(90000);
  const server = await syncHttpServer();
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'to3mato-onboarding-'),
  );
  const env = {
    TO3MATO_ONBOARDING: 'auto',
    TO3MATO_SUPABASE_URL: server.url,
    TO3MATO_SUPABASE_PUBLISHABLE_KEY: 'test',
    TO3MATO_SYNC_TEST: '1',
  };
  try {
    // Quitting midway leaves the walkthrough pending for the next launch.
    const early = await launch(directory, env);
    const earlyPage = await early.firstWindow();
    await expect(earlyPage.getByRole('dialog', { name: WELCOME })).toBeVisible();
    await earlyPage.getByRole('button', { name: '다음', exact: true }).click();
    await early.close();

    const app = await launch(directory, env);
    const page = await app.firstWindow();
    const dialog = page.getByRole('dialog', { name: WELCOME });
    await expect(dialog).toBeVisible();
    await expectStacked(page);
    await expect(
      dialog.getByRole('button', { name: '이전', exact: true }),
    ).toHaveCount(0);
    for (const title of ['할 일을 정리', '하나를 실행', '기록을 확인']) {
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await expect(page.getByRole('dialog', { name: title })).toBeVisible();
      await expectStacked(page);
    }
    await page.getByRole('button', { name: '이전', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '하나를 실행' })).toBeVisible();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByRole('button', { name: '다음', exact: true }).click();

    const account = page.getByRole('dialog', { name: '계정' });
    await expect(account).toBeVisible();
    // One flow for new and returning users: no tabs, a first-time address works.
    await expect(account.getByRole('tab')).toHaveCount(0);
    await expect(account.getByLabel('인증 코드', { exact: true })).toHaveCount(0);
    await account.getByLabel('이메일', { exact: true }).fill('new@example.test');
    await account.getByRole('button', { name: '인증 코드 받기' }).click();
    await expect(
      account.getByText('인증 코드를 보냈습니다. 10분 안에 입력하세요.'),
    ).toBeVisible();
    await expect(account.getByLabel('인증 코드', { exact: true })).toBeFocused();
    await account.getByLabel('인증 코드', { exact: true }).fill('123456');
    await account.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(
      account.getByRole('button', { name: '연동', exact: true }),
    ).toBeVisible();
    // Logging in never starts upload on its own.
    expect(
      (await page.evaluate(() => window.to3mato!.account.status())).enabled,
    ).toBe(false);
    await account.getByRole('button', { name: '나중에', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: '작업 영역 탭' }),
    ).toBeVisible();
    await app.close();

    const again = await launch(directory, env);
    const second = await again.firstWindow();
    await expect(
      second.getByRole('navigation', { name: '작업 영역 탭' }),
    ).toBeVisible();
    expect(
      await second.evaluate(() => window.to3mato!.onboarding.status()),
    ).toBe(false);
    await expect(second.getByRole('dialog', { name: WELCOME })).toHaveCount(0);
    // The session survives the restart and the settings card uses the same form.
    await second.getByRole('button', { name: '설정', exact: true }).click();
    await expect(
      second.getByRole('button', { name: '로그아웃', exact: true }),
    ).toBeVisible();
    await again.close();
  } finally {
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('an upgrade with existing data skips the walkthrough', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'to3mato-onboarding-upgrade-'),
  );
  try {
    const first = await launch(directory, { TO3MATO_ONBOARDING: 'off' });
    const page = await first.firstWindow();
    await expect(
      page.getByRole('navigation', { name: '작업 영역 탭' }),
    ).toBeVisible();
    await first.close();
    await fs.rm(path.join(directory, 'onboarding.json'), { force: true });

    const upgraded = await launch(directory, { TO3MATO_ONBOARDING: 'auto' });
    const window = await upgraded.firstWindow();
    await expect(
      window.getByRole('navigation', { name: '작업 영역 탭' }),
    ).toBeVisible();
    expect(
      await window.evaluate(() => window.to3mato!.onboarding.status()),
    ).toBe(false);
    await expect(window.getByRole('dialog')).toHaveCount(0);
    await upgraded.close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('browser preview shows the walkthrough once without account features', async () => {
  const vite = await createServer({
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
  });
  await vite.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const url = `http://127.0.0.1:${(vite.httpServer!.address() as any).port}`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await expect(page.getByRole('dialog', { name: WELCOME })).toBeVisible();
    // A reload before finishing must not turn the fresh profile into an existing one.
    await page.reload();
    await expect(page.getByRole('dialog', { name: WELCOME })).toBeVisible();
    for (let i = 0; i < 4; i++)
      await page.getByRole('button', { name: '다음', exact: true }).click();
    const account = page.getByRole('dialog', { name: '계정' });
    await expect(
      account.getByText('이 실행 환경에서는 계정 기능을 사용할 수 없습니다.'),
    ).toBeVisible();
    await expect(account.getByRole('tab')).toHaveCount(0);
    await account.getByRole('button', { name: '시작', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('dialog', { name: WELCOME })).toHaveCount(0);

    // Escape finishes instead of leaving the walkthrough half done.
    const fresh = await (await browser.newContext()).newPage();
    await fresh.goto(url);
    await expect(fresh.getByRole('dialog', { name: WELCOME })).toBeVisible();
    await fresh.keyboard.press('Escape');
    await expect(fresh.getByRole('dialog')).toHaveCount(0);
    await fresh.reload();
    await expect(fresh.getByRole('navigation')).toBeVisible();
    await expect(fresh.getByRole('dialog', { name: WELCOME })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await vite.close();
  }
});
