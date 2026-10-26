import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createInitialState,
  localDate,
  offsetDate,
} from '../src/lib/domain.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-site-'));
const out = path.resolve('website/dist/assets');
await mkdir(out, { recursive: true });
const today = localDate();
const state = createInitialState(today);
state.projects[0].name = '개인 웹사이트';
state.tasks[0].title = '소개 페이지 구성';
state.tasks[1].title = '타이포그래피 강의 수강';
state.tasks[2].title = '책 1장 읽기';
state.tasks[3].title = '참고 사이트 조사';
state.tasks.push(
  {
    id: 't6',
    title: '첫 화면 시안 제작',
    estimate: 3,
    project: 'p1',
    date: offsetDate(2),
    done: false,
  },
  {
    id: 't7',
    title: '모바일 화면 검토',
    estimate: 2,
    project: 'p1',
    date: offsetDate(4),
    done: false,
  },
  {
    id: 't8',
    title: '책 2장 읽기',
    estimate: 1,
    project: 'p3',
    date: offsetDate(2),
    done: false,
  },
);
state.records = [
  {
    taskId: 't1',
    seconds: 1500,
    pomodoros: 1,
    duration: 1500,
    at: Date.now() - 3600000,
  },
];
state.timer = {
  taskId: 't1',
  phase: 'focus',
  duration: 1500,
  // Far enough into the session that the 3D tomato plant carries fruit.
  elapsed: 1290,
  startedAt: Date.now(),
  running: false,
};
await writeFile(path.join(directory, 'state.json'), JSON.stringify(state));
const env = { ...process.env, TO3MATO_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.TO3MATO_DEV_URL;
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 860),
  );
  await page.getByRole('button', { name: '프로젝트', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const shot = async (name, locator = page) => {
    await page.mouse.move(0, 0);
    await page.locator('.toast.visible').waitFor({ state: 'hidden' });
    await page.evaluate(() =>
      document.getAnimations().forEach((a) => {
        if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish();
        else a.pause();
      }),
    );
    await locator.screenshot({
      path: path.join(out, name + '.png'),
      animations: 'disabled',
    });
    console.log('Captured ' + name);
  };
  await page.evaluate(() => window.to3mato.dispatch({ type: 'timer:toggle' }));
  await page.locator('.tomato-growth[data-ready="true"]').waitFor();
  await shot('app-today');
  await page.getByRole('button', { name: '프로젝트', exact: true }).click();
  const openProject = () =>
    page
      .getByRole('button', { name: /개인 웹사이트/ })
      .first()
      .click();
  await openProject();
  await shot('app-project');
  await page.getByRole('button', { name: '캘린더', exact: true }).click();
  await shot('app-calendar');
  await page.getByRole('button', { name: '프로젝트', exact: true }).click();
  if (
    !(await page
      .getByRole('button', { name: '할 일 추가', exact: true })
      .count())
  )
    await openProject();
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByRole('button', { name: '여러 개 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '여러 할 일 추가' });
  await dialog.getByLabel('할 일 이름 규칙').fill('책 읽기 (%n%) · %date%');
  await dialog.getByLabel('생성 개수', { exact: true }).fill('7');
  await dialog.getByLabel('시작 날짜').fill(today);
  await dialog.getByLabel('금요일', { exact: true }).fill('3');
  await dialog.getByLabel('할 일 이름 규칙').scrollIntoViewIfNeeded();
  await dialog.getByRole('heading').click();
  await shot('app-batch');
  await shot('batch-detail', dialog);
  await dialog.getByRole('button', { name: '목록 생성', exact: true }).click();
  await shot('app-review');
  await shot('review-detail', dialog);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '집중 로그', exact: true }).click();
  await shot('app-focus-log');
  await page.getByRole('button', { name: '할 일', exact: true }).click();
  await page.evaluate(async () => {
    await window.to3mato.dispatch({ type: 'timer:end' });
    await window.to3mato.dispatch({
      type: 'settings:save',
      payload: { focus: 10 },
    });
    await window.to3mato.dispatch({
      type: 'timer:play',
      payload: { id: 't1' },
    });
  });
  await page
    .getByRole('region', { name: '인증샷 제안' })
    .waitFor({ timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('app-capture-prompt');
  await writeFile(
    path.resolve('website/capture.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: 'Electron application',
        viewport: { width: 1280, height: 860 },
        data: 'Isolated sample data. User data was not accessed.',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
