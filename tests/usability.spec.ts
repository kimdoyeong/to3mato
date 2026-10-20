import {
  test,
  expect,
  _electron as electron,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ui = test.extend<{ appPage: Page }>({
  appPage: async ({}, use) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'to3mato-usability-'),
    );
    const env = { ...process.env, TO3MATO_USER_DATA: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TO3MATO_DEV_URL;
    const app = await electron.launch({ args: ['.'], env });
    try {
      const page = await app.firstWindow();
      await expect(
        page.getByRole('navigation', { name: '작업 영역 탭' }),
      ).toBeVisible();
      await use(page);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});

ui(
  'task and project forms focus names and keep errors inside the dialog',
  async ({ appPage: page }) => {
    await page
      .getByRole('button', { name: '미지정 할 일 추가', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: '할 일 추가',
      exact: true,
    });
    const name = dialog.getByLabel('할 일 이름', { exact: true });
    await expect(name).toBeFocused();
    await name.fill('   ');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tasks,
    ).toHaveLength(5);
    await name.fill('키보드로 추가');
    await name.press('Enter');
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole('button', { name: '키보드로 추가 수정', exact: true })
      .click();
    await expect(page.getByLabel('할 일 이름', { exact: true })).toBeFocused();
    // Simulate the edited task being removed while the dialog is open.
    await page.evaluate(async () => {
      const state = await window.to3mato!.load();
      const task = state.tasks.find((item) => item.title === '키보드로 추가')!;
      await window.to3mato!.dispatch({
        type: 'task:delete',
        payload: { id: task.id },
      });
    });
    const editing = page.getByRole('dialog', {
      name: '할 일 수정',
      exact: true,
    });
    await editing
      .getByLabel('할 일 이름', { exact: true })
      .fill('수정 내용 보존');
    await editing.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editing.getByRole('alert')).toHaveText(
      '할 일을 찾을 수 없습니다.',
    );
    await expect(editing.getByLabel('할 일 이름', { exact: true })).toHaveValue(
      '수정 내용 보존',
    );
    await page.screenshot({ path: 'test-results/usability-save-error.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page
      .getByRole('button', { name: '프로젝트 추가', exact: true })
      .click();
    const project = page.getByRole('dialog', {
      name: '프로젝트 추가',
      exact: true,
    });
    await expect(project.getByLabel('프로젝트 이름')).toBeFocused();
    await project.getByLabel('프로젝트 이름').fill('   ');
    await project.getByRole('button', { name: '저장', exact: true }).click();
    await expect(project.getByRole('alert')).toBeVisible();
    await project.getByLabel('프로젝트 이름').fill('새 프로젝트');
    await project.getByLabel('프로젝트 이름').press('Enter');
    await expect(project).not.toBeVisible();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).projects,
    ).toHaveLength(4);
  },
);

ui(
  'tab navigation retains the selected project and calendar date',
  async ({ appPage: page }) => {
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '사이드 프로젝트', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '캘린더', exact: true }).click();
    await page.getByRole('button', { name: '다음 주', exact: true }).click();
    await page.locator('.day-cell').nth(3).click();
    const selected = await page
      .locator('.day-cell.selected')
      .getAttribute('aria-label');
    await page.getByRole('button', { name: '할 일', exact: true }).click();
    await page.getByRole('button', { name: '캘린더', exact: true }).click();
    await expect(page.locator('.day-cell.selected')).toHaveAttribute(
      'aria-label',
      selected!,
    );
  },
);

ui(
  'batch entry focuses the template and then the first editable preview row',
  async ({ appPage: page }) => {
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page
      .getByRole('button', { name: '여러 개 추가', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '여러 할 일 추가' });
    await expect(dialog.getByLabel('할 일 이름 규칙')).toBeFocused();
    await dialog.getByLabel('할 일 이름 규칙').fill('독서 (%n%)');
    await dialog
      .getByRole('button', { name: '목록 생성', exact: true })
      .click();
    await expect(
      dialog.getByLabel('1번 할 일 이름', { exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: '설정 수정', exact: true })
      .click();
    await expect(dialog.getByLabel('할 일 이름 규칙')).toBeFocused();
    await expect(dialog.getByLabel('할 일 이름 규칙')).toHaveValue(
      '독서 (%n%)',
    );
  },
);
