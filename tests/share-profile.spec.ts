import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncHttpServer } from './helpers/sync-http.mjs';

const shots = process.env.TO3MATO_SHOTS;

test('signed-in user shares, edits and stops a public profile', async () => {
  test.setTimeout(90000);
  const server = await syncHttpServer();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'to3mato-share-'));
  const env = {
    ...process.env,
    TO3MATO_USER_DATA: directory,
    TO3MATO_SUPABASE_URL: server.url,
    TO3MATO_SUPABASE_PUBLISHABLE_KEY: 'test',
    TO3MATO_SYNC_TEST: '1',
    TO3MATO_AUTH_CALLBACK_PORT: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  const app = await electron.launch({ args: ['.'], env });
  const shot = async (name: string) => {
    if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), animations: 'disabled' });
  };
  const page = await app.firstWindow();
  try {
    await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
    await expect(page.getByRole('navigation', { name: '작업 영역 탭' })).toBeVisible();
    // Signed out: no share button.
    await expect(page.getByRole('button', { name: '공유하기' })).toHaveCount(0);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByLabel('이메일', { exact: true }).fill('a@example.test');
    await page.getByRole('button', { name: '로그인 링크 받기', exact: true }).click();
    await expect(page.getByText('로그인 링크를 보냈습니다.', { exact: false })).toBeVisible();
    await fetch(server.linkFor('a@example.test'));
    await expect(page.getByRole('button', { name: '연동', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '할 일', exact: true }).first().click();
    const share = page.getByRole('button', { name: '공유하기' });
    await expect(share).toBeEnabled();
    await share.click();
    await shot('1-menu');
    await page.getByRole('menuitem', { name: '프로필 공유하기' }).click();
    const dialog = page.getByRole('dialog', { name: '프로필 공유하기' });
    await expect(dialog).toBeVisible();
    // Empty name is refused.
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByText('표시 이름을 입력하세요.')).toBeVisible();
    await dialog.getByLabel('표시 이름').fill('김토마토');
    await app.evaluate(({ dialog: native }, file) => {
      native.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.resolve('electron/assets/icon.png'));
    await dialog.getByRole('button', { name: '사진 추가' }).click();
    await expect(dialog.locator('img.photo')).toBeVisible();
    await dialog.getByRole('switch', { name: '집중 시간' }).click();
    await expect(dialog.getByRole('switch', { name: '티켓 메모' })).toBeDisabled();
    await expect(dialog.locator('.preview-screen .pp')).toBeVisible();
    await shot('2-first-share');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('링크를 복사했습니다.')).toBeVisible();
    await expect(dialog).toBeHidden();
    const link = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(link).toMatch(/^https:\/\/me\.to3mato\.com\/[a-hjkmnp-z2-9]{10}$/);

    const row = async () =>
      (
        await server.pg.db.query(
          'select slug,display_name,photo,visibility,active,snapshot from public.public_profiles',
        )
      ).rows[0] as any;
    let saved = await row();
    expect(saved).toMatchObject({ display_name: '김토마토', active: true });
    expect(saved.visibility).toMatchObject({ focus: true, video: false });
    expect(link.endsWith(saved.slug)).toBe(true);
    expect(server.profileFiles.has(saved.photo)).toBe(true);
    expect(saved.snapshot.v).toBe(1);

    // The card in the log tab edits the range.
    await page.getByRole('button', { name: '집중 로그', exact: true }).first().click();
    const card = page.getByRole('region', { name: '공유 프로필' });
    await expect(card).toContainText('김토마토');
    await card.getByRole('switch', { name: '프로젝트' }).click();
    await expect(card.getByRole('switch', { name: '프로젝트' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await row()).visibility.projects).toBe(true);
    await shot('3-card');

    // Editing the name keeps the same link.
    await card.getByRole('button', { name: '수정' }).click();
    const edit = page.getByRole('dialog', { name: '표시 이름 수정' });
    await edit.getByLabel('표시 이름').fill('이부끄');
    await edit.getByRole('button', { name: '저장' }).click();
    await expect(card).toContainText('이부끄');
    expect((await row()).slug).toBe(saved.slug);

    // Stopping keeps the slug; sharing again reactivates it.
    await card.getByRole('button', { name: '공개 중지' }).click();
    await expect(page.getByText('공개를 중지했습니다.')).toBeVisible();
    await expect.poll(async () => (await row()).active).toBe(false);
    await shot('4-stopped');
    await page.getByRole('button', { name: '공유하기' }).click();
    await page.getByRole('menuitem', { name: '프로필 공유하기' }).click();
    await expect(page.getByText('링크를 복사했습니다.')).toBeVisible();
    await expect.poll(async () => (await row()).active).toBe(true);
    expect((await row()).slug).toBe(saved.slug);
  } finally {
    await app.close();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
