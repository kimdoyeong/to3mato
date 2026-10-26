import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('project batch preview highlights templates and saves independent edited tasks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-batch-'));
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  const app = await electron.launch({
    executablePath: process.env.TO3MATO_EXECUTABLE,
    args: process.env.TO3MATO_EXECUTABLE ? [] : ['.'],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page
      .getByRole('button', { name: '여러 개 추가', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '여러 할 일 추가' });
    await dialog.getByLabel('할 일 이름 규칙').fill('독서 %unknown%');
    await expect(dialog.locator('.template-invalid')).toHaveText('%unknown%');
    await expect(dialog.getByLabel('할 일 이름 규칙')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await dialog
      .getByRole('button', { name: '목록 생성', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText('템플릿');
    await dialog.getByLabel('할 일 이름 규칙').fill('독서 (%n%) · %date%');
    await expect(dialog.locator('.template-number')).toHaveText('%n%');
    await expect(dialog.locator('.template-date')).toHaveText('%date%');
    await dialog.getByLabel('생성 개수', { exact: true }).fill('7');
    await dialog.getByLabel('시작 날짜').fill('2026-10-19');
    await dialog.getByLabel('금요일', { exact: true }).fill('3');
    await dialog.getByLabel('할 일 이름 규칙').scrollIntoViewIfNeeded();
    await dialog.evaluate((element) =>
      element.getAnimations().forEach((animation) => animation.finish()),
    );
    await page.screenshot({ path: 'test-results/batch-setup.png' });
    await dialog
      .getByRole('button', { name: '목록 생성', exact: true })
      .click();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tasks,
    ).toHaveLength(5);
    await expect(
      dialog.getByLabel('1번 할 일 이름', { exact: true }),
    ).toHaveValue('독서 (1) · 2026-10-19');
    await expect(dialog.getByLabel('3번 예정일', { exact: true })).toHaveValue(
      '2026-10-21',
    );
    await expect(dialog.getByLabel('7번 예정일', { exact: true })).toHaveValue(
      '2026-10-23',
    );
    await dialog
      .getByLabel('1번 할 일 이름', { exact: true })
      .fill('직접 수정한 이름');
    await dialog.getByLabel('1번 예정일', { exact: true }).fill('2026-11-01');
    await dialog.getByLabel('2번 예정일', { exact: true }).fill('2026-11-02');
    await dialog.getByLabel('2번 예상 포모도로', { exact: true }).fill('2');
    await expect(
      dialog.getByLabel('2번 할 일 이름', { exact: true }),
    ).toHaveValue('독서 (2) · 2026-11-02');
    await page.screenshot({ path: 'test-results/batch-review.png' });
    await dialog.getByLabel('1번 할 일 이름', { exact: true }).fill('   ');
    await dialog.getByRole('button', { name: '7개 추가', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tasks,
    ).toHaveLength(5);
    await dialog
      .getByLabel('1번 할 일 이름', { exact: true })
      .fill('직접 수정한 이름');
    await dialog.getByRole('button', { name: '7개 추가', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const saved = await page.evaluate(() => window.to3mato!.load());
    expect(saved.tasks).toHaveLength(12);
    const added = saved.tasks.slice(5);
    expect(new Set(added.map((task) => task.id)).size).toBe(7);
    expect(added[0]).toMatchObject({
      title: '직접 수정한 이름',
      date: '2026-11-01',
      project: 'p1',
    });
    expect(added[1]).toMatchObject({
      title: '독서 (2) · 2026-11-02',
      estimate: 2,
    });
    expect(Object.keys(added[0]).sort()).toEqual([
      'date',
      'done',
      'estimate',
      'followUpOf',
      'id',
      'project',
      'remaining',
      'title',
    ]);
    await page
      .getByRole('button', { name: '직접 수정한 이름 완료', exact: true })
      .click();
    await page.reload();
    const restored = await page.evaluate(() => window.to3mato!.load());
    expect(restored.tasks.find((task) => task.id === added[0].id)?.done).toBe(
      true,
    );
    expect(restored.tasks.find((task) => task.id === added[1].id)?.done).toBe(
      false,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
