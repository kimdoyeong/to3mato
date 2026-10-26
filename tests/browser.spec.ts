import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'vite';
import {
  createInitialState,
  localDate,
  offsetDate,
} from '../src/lib/domain.mjs';
import { readFile } from 'node:fs/promises';

test('browser imports demo data and preserves edits and date moves', async () => {
  const server = await createServer({
    server: { port: 4174, strictPort: true },
  });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext();
    const seed = createInitialState();
    seed.tasks[0].title = '기존 데모 작업';
    await context.addInitScript((data) => {
      if (!localStorage.getItem('to3mato-state-v1')) {
        localStorage.setItem('to3mato-demo-v1', JSON.stringify(data));
      }
    }, seed);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:4174');
    await expect(
      page.getByRole('button', { name: '기존 데모 작업 수정', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: '기존 데모 작업 수정', exact: true })
      .click();
    const editing = page.getByRole('dialog', {
      name: '할 일 수정',
      exact: true,
    });
    await editing.getByLabel('할 일 이름', { exact: true }).fill('수정한 작업');
    await editing
      .getByRole('group', { name: '예상 포모도로' })
      .getByRole('button', { name: '2', exact: true })
      .click();
    await page.getByLabel('예정일', { exact: true }).fill(offsetDate(1));
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      page.getByRole('region', { name: '내일', exact: true }),
    ).toContainText('수정한 작업');
    await expect(page.getByRole('complementary')).not.toContainText(
      '수정한 작업',
    );
    await page.reload();
    await expect(
      page.getByRole('region', { name: '내일', exact: true }),
    ).toContainText('수정한 작업');

    await page.getByRole('button', { name: '캘린더', exact: true }).click();
    // On Sunday, tomorrow is outside the initially displayed week.
    if (new Date(offsetDate(1) + 'T12:00:00').getDay() === 1)
      await page.getByRole('button', { name: '다음 주', exact: true }).click();
    const calendarDate = new Date(
      offsetDate(1) + 'T12:00:00',
    ).toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    await page.getByRole('button', { name: calendarDate, exact: true }).click();
    await expect(page.locator('.workspace .task-row').first()).toContainText(
      '수정한 작업',
    );
    await page
      .getByRole('button', { name: '수정한 작업 완료', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: '수정한 작업 완료 취소', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '업데이트', exact: true }),
    ).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '데이터 내보내기', exact: true })
      .click();
    const download = await downloaded;
    const exported = JSON.parse(
      await readFile((await download.path())!, 'utf8'),
    );
    expect(exported.tasks[0]).toMatchObject({
      title: '수정한 작업',
      estimate: 2,
      remaining: 2,
      date: offsetDate(1),
      done: true,
    });
    expect(exported.tasks[0].date).not.toBe(localDate());
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('to3mato-demo-v1')!).tasks[0].title,
      ),
    ).toBe('기존 데모 작업');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await server.close();
  }
});
