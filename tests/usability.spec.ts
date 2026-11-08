import {
  test,
  expect,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ui = test.extend<{ appPage: Page; app: ElectronApplication }>({
  app: async ({}, use) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'to3mato-usability-'),
    );
    const env = { ...process.env, TO3MATO_USER_DATA: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TO3MATO_DEV_URL;
    const app = await electron.launch({ args: ['.'], env });
    try {
      await use(app);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  appPage: async ({ app }, use) => {
    const page = await app.firstWindow();
    await expect(
      page.getByRole('navigation', { name: '작업 영역 탭' }),
    ).toBeVisible();
    await use(page);
  },
});

ui(
  'project deletion can be cancelled and persists without deleting tasks or history',
  async ({ appPage: page }) => {
    await page.evaluate(async () => {
      await window.to3mato!.dispatch({
        type: 'timer:play',
        payload: { id: 't1' },
      });
      await window.to3mato!.dispatch({ type: 'timer:end' });
      await window.to3mato!.dispatch({
        type: 'timer:play',
        payload: { id: 't1' },
      });
    });
    const before = await page.evaluate(() => window.to3mato!.load());
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page
      .getByRole('button', { name: '프로젝트 삭제', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', { name: '프로젝트 삭제' });
    await expect(confirmation).toContainText('사이드 프로젝트');
    await confirmation
      .getByRole('button', { name: '취소', exact: true })
      .click();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).projects,
    ).toEqual(before.projects);
    await page
      .getByRole('button', { name: '프로젝트 삭제', exact: true })
      .click();
    await confirmation
      .getByRole('button', { name: '삭제', exact: true })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /사이드 프로젝트/ }),
    ).toHaveCount(0);
    await page.reload();
    const after = await page.evaluate(() => window.to3mato!.load());
    expect(after.projects).toHaveLength(before.projects.length - 1);
    expect(after.tasks).toEqual(
      before.tasks.map((task) => ({
        ...task,
        project: task.project === 'p1' ? '' : task.project,
      })),
    );
    expect(after.records).toEqual(before.records);
    expect(after.timer?.taskId).toBe('t1');
    expect(after.timer?.running).toBe(true);
  },
);

ui(
  'single and batch task estimates are limited to two',
  async ({ appPage: page }) => {
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    const single = page.getByRole('dialog', {
      name: '할 일 추가',
      exact: true,
    });
    const picker = single.getByRole('group', { name: '예상 포모도로' });
    await expect(picker.getByRole('button')).toHaveText(['1', '2']);
    await single.getByLabel('할 일 이름', { exact: true }).fill('2개 작업');
    await picker.getByRole('button', { name: '2', exact: true }).click();
    await single.getByRole('button', { name: '저장', exact: true }).click();
    const saved = (await page.evaluate(() => window.to3mato!.load())).tasks.at(
      -1,
    );
    expect(saved?.estimate).toBe(2);
    expect(saved?.remaining).toBe(2);
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await single.getByRole('button', { name: '여러 개 추가' }).click();
    const batch = page.getByRole('dialog', { name: '여러 할 일 추가' });
    await expect(
      batch.getByLabel('공통 예상 포모도로', { exact: true }),
    ).toHaveAttribute('max', '2');
    await batch.getByLabel('할 일 이름 규칙').fill('작업 %n%');
    await batch.getByLabel('공통 예상 포모도로', { exact: true }).fill('2');
    await batch.getByRole('button', { name: '목록 생성' }).click();
    await expect(
      batch.getByLabel('1번 예상 포모도로', { exact: true }),
    ).toHaveAttribute('max', '2');
    await expect(
      batch.getByLabel('1번 예상 포모도로', { exact: true }),
    ).toHaveValue('2');
  },
);

ui(
  'task and project forms focus names and keep errors inside the dialog',
  async ({ appPage: page }) => {
    // The quick-add line in a section saves without opening a dialog.
    const backlog = page.getByRole('region', { name: '미지정', exact: true });
    const name = backlog.getByLabel('할 일 이름', { exact: true });
    await name.fill('   ');
    await backlog
      .getByRole('button', { name: '미지정 할 일 추가', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText(
      '할 일 이름을 입력하세요.',
    );
    await expect(name).toBeFocused();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tasks,
    ).toHaveLength(5);
    await name.fill('키보드로 추가');
    await name.press('Enter');
    await expect(backlog).toContainText('키보드로 추가');
    await expect(name).toHaveValue('');
    await page
      .getByRole('button', { name: '키보드로 추가 수정', exact: true })
      .click();
    const editing = page.getByRole('dialog', {
      name: '할 일 수정',
      exact: true,
    });
    await expect(
      editing.getByLabel('할 일 이름', { exact: true }),
    ).toBeFocused();
    // Simulate the edited task being removed while the dialog is open.
    await page.evaluate(async () => {
      const state = await window.to3mato!.load();
      const task = state.tasks.find((item) => item.title === '키보드로 추가')!;
      await window.to3mato!.dispatch({
        type: 'task:delete',
        payload: { id: task.id },
      });
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

ui(
  'completing a task issues a ticket that the project diary shows and decorates',
  async ({ appPage: page }) => {
    const today = page.getByRole('region', { name: '오늘', exact: true });
    await today
      .getByRole('button', { name: '프로젝트 아이디어 정리 완료', exact: true })
      .click();
    await expect(page.locator('.ticket-pop')).toContainText(
      '프로젝트 아이디어 정리',
    );
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    const cover = page.getByRole('button', { name: /사이드 프로젝트/ });
    await expect(cover).toContainText('티켓');
    await cover.click();
    await page
      .getByRole('button', { name: '프로젝트 수정', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: '프로젝트 수정',
      exact: true,
    });
    await dialog.getByLabel('결과물').fill('제안서 초안 PDF');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '사이드 프로젝트' }),
    ).toBeVisible();
    await expect(page.locator('.diary-outcome')).toContainText(
      '제안서 초안 PDF',
    );
    const ticket = page
      .getByRole('region', { name: '작업 영역', exact: true })
      .getByRole('article', { name: '티켓 프로젝트 아이디어 정리' });
    await expect(ticket).toContainText('0 / 2');
    await ticket
      .getByRole('button', { name: '프로젝트 아이디어 정리 티켓 꾸미기' })
      .click();
    const tools = page.getByRole('group', { name: '티켓 꾸미기' });
    await tools.getByRole('button', { name: '형광펜', exact: true }).click();
    await tools.getByRole('button', { name: '스티커 별', exact: true }).click();
    await tools.getByLabel('메모').fill('첫 티켓');
    await tools.getByLabel('메모').press('Enter');
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.to3mato!.load())).tickets.map(
          (t) => ({
            title: t.title,
            highlight: t.highlight,
            sticker: t.sticker,
            note: t.note,
          }),
        ),
      )
      .toEqual([
        {
          title: '프로젝트 아이디어 정리',
          highlight: true,
          sticker: 'star',
          note: '첫 티켓',
        },
      ]);
    await expect(ticket).toContainText('첫 티켓');
    // Undoing the completion voids the ticket but keeps it on the page.
    await page.getByRole('button', { name: '할 일', exact: true }).click();
    await today
      .getByRole('button', {
        name: '프로젝트 아이디어 정리 완료 취소',
        exact: true,
      })
      .click();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tickets[0].voided,
    ).toBe(true);
  },
);

ui(
  'quick templates apply one round to the selected section and project',
  async ({ appPage: page }) => {
    await page.evaluate(() =>
      window.to3mato!.dispatch({
        type: 'template:save',
        payload: {
          name: '학습 묶음',
          steps: [
            { title: '%n%강 읽기', estimate: 1 },
            { title: '%n%강 문제', estimate: 2 },
          ],
        },
      }),
    );
    const tomorrow = page.getByRole('region', { name: '내일', exact: true });
    await tomorrow.getByRole('button', { name: '템플릿', exact: true }).click();
    await expect(
      tomorrow.getByRole('button', { name: '템플릿', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await tomorrow.getByRole('button', { name: /학습 묶음/ }).click();
    await expect(
      tomorrow.getByRole('group', { name: '템플릿', exact: true }),
    ).not.toBeVisible();
    await expect(tomorrow.locator('.task-row')).toHaveCount(3);
    const after = await page.evaluate(() => window.to3mato!.load());
    expect(
      after.tasks
        .slice(-2)
        .map((t) => [t.title, t.estimate, t.date, t.project]),
    ).toEqual([
      ['1강 읽기', 1, after.tasks[3].date, ''],
      ['1강 문제', 2, after.tasks[3].date, ''],
    ]);
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page.getByRole('button', { name: '템플릿', exact: true }).click();
    await page.getByRole('button', { name: /학습 묶음/ }).click();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tasks
        .slice(-2)
        .map((t) => [t.project, t.date]),
    ).toEqual([
      ['p1', ''],
      ['p1', ''],
    ]);
  },
);

ui(
  'template dialog saves editable steps and generates scheduled rounds without a project',
  async ({ appPage: page }) => {
    const today = page.getByRole('region', { name: '오늘', exact: true });
    await today.getByRole('button', { name: '템플릿', exact: true }).click();
    await today
      .getByRole('button', { name: '템플릿 추가', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '여러 할 일 추가' });
    await dialog.getByLabel('템플릿 이름').fill('학습 반복');
    await dialog
      .getByRole('textbox', { name: '단계 1', exact: true })
      .fill('%n%강 읽기');
    await dialog
      .getByRole('button', { name: '단계 추가', exact: true })
      .click();
    await dialog
      .getByRole('textbox', { name: '단계 2', exact: true })
      .fill('%n%강 문제');
    await dialog
      .getByRole('group', { name: '예상 포모도로', exact: true })
      .nth(1)
      .getByRole('button', { name: '2', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: '템플릿으로 저장', exact: true })
      .click();
    await expect(
      dialog.getByRole('button', { name: '학습 반복', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByLabel('회차', { exact: true }).fill('3');
    await dialog.getByLabel('시작일').fill('2026-10-27');
    await dialog.getByRole('button', { name: '화요일 배치' }).click();
    await dialog.getByRole('button', { name: '목요일 배치' }).click();
    await expect(dialog.locator('.template-preview')).toContainText('외 2개');
    await page.screenshot({ path: 'test-results/stage3-template.png' });
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const after = await page.evaluate(() => window.to3mato!.load());
    expect(after.templates).toHaveLength(1);
    expect(
      after.tasks
        .slice(-6)
        .map((t) => [t.title, t.estimate, t.date, t.project]),
    ).toEqual([
      ['1강 읽기', 1, '2026-10-28', ''],
      ['1강 문제', 2, '2026-10-28', ''],
      ['2강 읽기', 1, '2026-10-30', ''],
      ['2강 문제', 2, '2026-10-30', ''],
      ['3강 읽기', 1, '2026-11-02', ''],
      ['3강 문제', 2, '2026-11-02', ''],
    ]);
    await page.reload();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).templates,
    ).toEqual(after.templates);
  },
);

ui(
  'diary saves selected live tickets as a template and excludes voided tickets',
  async ({ appPage: page }) => {
    await page.evaluate(async () => {
      await window.to3mato!.dispatch({
        type: 'task:toggle',
        payload: { id: 't1' },
      });
      await window.to3mato!.dispatch({
        type: 'task:toggle',
        payload: { id: 't4' },
      });
      await window.to3mato!.dispatch({
        type: 'task:toggle',
        payload: { id: 't4' },
      });
    });
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page.getByRole('button', { name: /사이드 프로젝트/ }).click();
    await page
      .getByRole('button', { name: '템플릿으로 저장', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '템플릿으로 저장' });
    await expect(dialog.getByRole('checkbox')).toHaveCount(1);
    await expect(dialog.getByRole('checkbox')).toBeChecked();
    await dialog.getByLabel('템플릿 이름').fill('완료 묶음');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).templates[0],
    ).toMatchObject({
      name: '완료 묶음',
      steps: [{ title: '프로젝트 아이디어 정리', estimate: 2 }],
    });
  },
);

ui(
  'plan card carries yesterday tasks, archives, deletes and remembers dismissal',
  async ({ appPage: page }) => {
    const dates = await page.evaluate(async () => {
      const d = new Date();
      const local = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = local(d);
      d.setDate(d.getDate() - 1);
      const yesterday = local(d);
      for (const id of ['t1', 't2', 't3'])
        await window.to3mato!.dispatch({
          type: 'task:move',
          payload: { id, date: yesterday },
        });
      await window.to3mato!.dispatch({
        type: 'settings:save',
        payload: { planAt: '00:00', remindDays: [0, 1, 2, 3, 4, 5, 6] },
      });
      return { today, yesterday };
    });
    const plan = page.getByRole('region', { name: '계획 시작', exact: true });
    await expect(plan).toBeVisible();
    await page.screenshot({
      path: 'test-results/stage3-plan.png',
      fullPage: true,
    });
    await plan
      .locator('.ritual-task')
      .filter({ hasText: '프로젝트 아이디어 정리' })
      .getByRole('button', { name: '오늘로', exact: true })
      .click();
    await plan
      .locator('.ritual-task')
      .filter({ hasText: '디자인 강의 수강' })
      .getByRole('button', { name: '보관', exact: true })
      .click();
    await plan
      .locator('.ritual-task')
      .filter({ hasText: '도서 읽기' })
      .getByRole('button', { name: '삭제', exact: true })
      .click();
    await expect(plan).toContainText('어제 미완료 할 일이 없습니다.');
    await plan
      .locator('.ritual-task')
      .filter({ hasText: '주간 할 일 정리' })
      .getByRole('button', { name: '오늘에 배치' })
      .click();
    await plan
      .getByRole('button', { name: '오늘 가능 +', exact: true })
      .click();
    await plan.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(plan).not.toBeVisible();
    await page.reload();
    await expect(plan).not.toBeVisible();
    const after = await page.evaluate(() => window.to3mato!.load());
    expect(after.tasks.find((t) => t.id === 't1')?.date).toBe(dates.today);
    expect(after.tasks.find((t) => t.id === 't2')?.date).toBe('');
    expect(after.tasks.find((t) => t.id === 't3')).toBeUndefined();
    expect(after.tasks.find((t) => t.id === 't5')?.date).toBe(dates.today);
    expect(after.settings.dailyCapacity).toBe(9);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('to3mato-rituals-v1')!),
      ),
    ).toMatchObject({ plannedDate: dates.today });
  },
);

ui(
  'ritual IPC opens the correct screen and starting focus closes the plan card',
  async ({ appPage: page, app }) => {
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const mainWindow = await app.browserWindow(page);
    await mainWindow.evaluate((window) =>
      window.webContents.send('ritual:open', 'plan'),
    );
    const plan = page.getByRole('region', { name: '계획 시작', exact: true });
    await expect(plan).toBeVisible();
    await page
      .getByRole('complementary', { name: '실행 영역' })
      .getByRole('button', { name: '프로젝트 아이디어 정리 시작' })
      .click();
    await expect(plan).not.toBeVisible();
    const plannedDate = await page.evaluate(
      () => JSON.parse(localStorage.getItem('to3mato-rituals-v1')!).plannedDate,
    );
    expect(plannedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect
      .poll(() => page.evaluate(() => window.to3mato!.ritualDates()))
      .toMatchObject({ plannedDate });
    await mainWindow.evaluate((window) =>
      window.webContents.send('ritual:open', 'review'),
    );
    await expect(
      page.getByRole('heading', { name: '돌아보기', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#clock')).toBeVisible();
  },
);

ui(
  'review processes unfinished work, keeps tomorrow capacity and saves its local date',
  async ({ appPage: page }) => {
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByLabel('계획 시각', { exact: true }).fill('09:30');
    await page.getByLabel('돌아보기 시각', { exact: true }).fill('18:30');
    await page.getByRole('button', { name: '토요일 배치' }).click();
    await page.getByRole('button', { name: '돌아보기', exact: true }).click();
    const pending = page.getByRole('region', { name: /^미완료/ });
    await expect(pending).toBeVisible();
    // Unfinished rows show no difference; only finished ones are compared.
    const table = page.locator('.review-table');
    await expect(table.locator('td.num').filter({ hasText: /\S/ })).toHaveCount(
      0,
    );
    await expect(table.locator('.mini-tomato.filled')).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/stage3-review.png',
      fullPage: true,
    });
    await pending
      .locator('.ritual-task')
      .filter({ hasText: '프로젝트 아이디어 정리' })
      .getByRole('button', { name: '내일로', exact: true })
      .click();
    await pending
      .locator('.ritual-task')
      .filter({ hasText: '디자인 강의 수강' })
      .getByRole('button', { name: '보관', exact: true })
      .click();
    await pending
      .locator('.ritual-task')
      .filter({ hasText: '도서 읽기' })
      .getByRole('button', { name: '완료', exact: true })
      .click();
    await expect(pending).toContainText('미완료 할 일이 없습니다.');
    await expect(page.locator('.review-table')).toContainText('-1');
    await page
      .getByRole('button', { name: '내일 가능 −', exact: true })
      .click();
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '돌아보기', exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: '돌아보기', exact: true }),
    ).toBeFocused();
    const after = await page.evaluate(() => window.to3mato!.load());
    expect(after.tasks.find((t) => t.id === 't1')?.date).toBe(
      after.tasks.find((t) => t.id === 't4')?.date,
    );
    expect(after.tasks.find((t) => t.id === 't2')?.date).toBe('');
    expect(after.tasks.find((t) => t.id === 't3')?.done).toBe(true);
    expect(after.tickets).toHaveLength(1);
    expect(after.settings).toMatchObject({
      dailyCapacity: 7,
      planAt: '09:30',
      reviewAt: '18:30',
      remindDays: [1, 2, 3, 4, 5, 6],
    });
    const reviewedDate = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('to3mato-rituals-v1')!).reviewedDate,
    );
    expect(reviewedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The main process records it too, so today's review reminder is skipped.
    await expect
      .poll(() => page.evaluate(() => window.to3mato!.ritualDates()))
      .toMatchObject({ reviewedDate });
    await page.getByLabel('계획 시각', { exact: true }).fill('');
    await page.getByLabel('돌아보기 시각', { exact: true }).fill('');
    await page.reload();
    expect(
      (await page.evaluate(() => window.to3mato!.load())).settings,
    ).toMatchObject({ planAt: '', reviewAt: '', dailyCapacity: 7 });
  },
);

ui(
  'a dismissed plan card stays closed after a reload even without browser storage',
  async ({ appPage: page }) => {
    const today = new Date().getDay();
    await page.evaluate(
      (day) =>
        window.to3mato!.dispatch({
          type: 'settings:save',
          payload: { planAt: '00:00', remindDays: [day] },
        }),
      today,
    );
    const plan = page.getByRole('region', { name: '계획 시작', exact: true });
    await expect(plan).toBeVisible();
    await plan.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(plan).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.to3mato!.ritualDates()))
      .toMatchObject({
        plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
    // The main process keeps the dismissal, so clearing local storage and
    // reloading does not reopen the card.
    await page.evaluate(() => localStorage.removeItem('to3mato-rituals-v1'));
    await page.reload();
    await expect(
      page.getByRole('region', { name: '오늘', exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(600);
    await expect(plan).not.toBeVisible();
  },
);
