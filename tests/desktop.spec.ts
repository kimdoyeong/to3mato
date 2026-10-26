import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import { SQLiteStore } from '../electron/storage.mjs';
import path from 'node:path';

// Each run owns a temporary data directory. Real user data is never changed.
test('desktop workflow persists tasks and timer records across restarts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-ui-'));
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      executablePath: process.env.TO3MATO_EXECUTABLE,
      args: process.env.TO3MATO_EXECUTABLE ? [] : ['.'],
      env,
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(
      page.getByRole('navigation', { name: '작업 영역 탭' }),
    ).toBeVisible();
    await expect(page.locator('.todo-section').first()).toContainText('오늘');
    await expect(page.locator('.todo-section').last()).toContainText('미지정');
    await expect(page.locator('#clock')).toHaveText('25:00');
    await page.screenshot({
      path: 'test-results/desktop-initial.png',
      fullPage: true,
    });
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      'undefined',
    );
    expect(await page.evaluate(() => !!window.to3mato)).toBe(true);

    const backlog = page.getByRole('region', { name: '미지정', exact: true });
    await backlog
      .getByLabel('할 일 이름', { exact: true })
      .fill('Electron 저장 확인');
    await backlog
      .getByRole('button', { name: '미지정 할 일 추가', exact: true })
      .click();
    await expect(backlog).toContainText('Electron 저장 확인');
    await page.getByRole('button', { name: '프로젝트', exact: true }).click();
    await page
      .getByRole('button', { name: '프로젝트 추가', exact: true })
      .click();
    await page.getByLabel('프로젝트 이름').fill('데스크톱 개발');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /데스크톱 개발/ }),
    ).toBeVisible();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const updateCard = page.getByRole('region', {
      name: '업데이트',
      exact: true,
    });
    await expect(updateCard).toContainText(
      `현재 버전 ${await app.evaluate(({ app }) => app.getVersion())}`,
    );
    await expect(
      updateCard.getByRole('button', { name: '업데이트 확인', exact: true }),
    ).toBeVisible();
    await expect(
      updateCard.getByRole('button', { name: '다시 시작', exact: true }),
    ).toHaveCount(0);
    if (!process.env.TO3MATO_EXECUTABLE) {
      await updateCard
        .getByRole('button', { name: '업데이트 확인', exact: true })
        .click();
      await expect(updateCard.getByRole('status')).toHaveText(
        '최신 버전입니다.',
      );
    }
    await page.getByLabel('집중 시간').selectOption('900');
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.to3mato!.load())).settings.focus,
      )
      .toBe(900);
    // Shorten durations only in the isolated test state.
    await page.evaluate(() =>
      window.to3mato!.dispatch({
        type: 'settings:save',
        payload: { focus: 10, rest: 5 },
      }),
    );
    await page
      .getByRole('button', { name: '프로젝트 아이디어 정리 시작', exact: true })
      .click();
    await expect(page.locator('#clock')).toHaveText('00:06', {
      timeout: 7_000,
    });
    await page
      .getByRole('button', { name: '디자인 강의 수강 시작', exact: true })
      .click();
    await expect(page.locator('#clock')).toHaveText('00:10');
    const switched = await page.evaluate(() => window.to3mato!.load());
    expect(switched.records).toHaveLength(1);
    expect(switched.records[0].pomodoros).toBe(0.5);
    expect(switched.records[0].seconds).toBeGreaterThanOrEqual(3);
    expect(switched.timer?.taskId).toBe('t2');
    expect(switched.timer?.elapsed).toBe(0);

    await page.getByRole('button', { name: '캘린더', exact: true }).click();
    await expect(page.locator('#focus-title')).toHaveText('디자인 강의 수강');
    // A finished focus waits in the check-in card; rest starts on 저장.
    const panel = page.getByRole('complementary', { name: '실행 영역' });
    await expect(
      panel.getByRole('heading', { name: '진척 확인', exact: true }),
    ).toBeVisible({ timeout: 13_000 });
    const completed = await page.evaluate(() => window.to3mato!.load());
    expect(completed.records).toHaveLength(2);
    expect(completed.records[1].pomodoros).toBe(1);
    expect(completed.tasks.find((task) => task.id === 't2')?.done).toBe(false);
    expect(completed.timer?.phase).toBe('checkin');
    await panel.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.locator('#focus-title')).toHaveText('휴식');
    expect(
      (await page.evaluate(() => window.to3mato!.load())).tasks.find(
        (task) => task.id === 't2',
      )?.remaining,
    ).toBe(1);
    await page.getByRole('button', { name: '휴식 종료', exact: true }).click();
    await page
      .getByRole('button', { name: '도서 읽기 시작', exact: true })
      .click();
    await expect(page.locator('#clock')).toHaveText('00:08');
    await page.reload();
    await expect(page.locator('#focus-title')).toHaveText('도서 읽기');
    await app.close();
    app = undefined;
    const database = new SQLiteStore(directory);
    const saved = database.load();
    database.close();
    expect(
      (await readFile(path.join(directory, 'to3mato.sqlite3')))
        .subarray(0, 16)
        .toString(),
    ).toBe('SQLite format 3\0');
    expect(saved.timer.running).toBe(false);
    expect(saved.timer.elapsed).toBeGreaterThanOrEqual(1);

    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole('button', { name: '집중 재개', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: '미지정', exact: true }),
    ).toContainText('Electron 저장 확인');
    const reopened = await page.evaluate(() => window.to3mato!.load());
    expect(reopened.timer).toEqual(saved.timer);
    expect(reopened.records).toHaveLength(2);
    expect(
      reopened.projects.some((project) => project.name === '데스크톱 개발'),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
