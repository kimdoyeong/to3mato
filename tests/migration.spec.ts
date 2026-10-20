import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createInitialState, legacyRecordId } from '../src/lib/domain.mjs';

test('Electron migrates JSON once and imports/exports JSON through SQLite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'to3mato-migration-'));
  const seed = createInitialState();
  seed.tasks[0].title = '이전할 기존 작업';
  seed.records = [
    {
      taskId: 'deleted-task',
      seconds: 15,
      pomodoros: 0,
      duration: 1500,
      at: 100,
    },
  ];
  const legacy = JSON.stringify(seed, null, 2);
  // Records saved before IDs existed receive a deterministic ID on load.
  const migrated = structuredClone(seed);
  migrated.records[0].id = legacyRecordId(seed.records[0]);
  await writeFile(path.join(directory, 'state.json'), legacy);
  const env = { ...process.env, TO3MATO_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TO3MATO_DEV_URL;
  const launch = () =>
    electron.launch({
      executablePath: process.env.TO3MATO_EXECUTABLE,
      args: process.env.TO3MATO_EXECUTABLE ? [] : ['.'],
      env,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole('button', { name: '이전할 기존 작업 수정', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.to3mato!.load())).toEqual(migrated);
    expect(
      await readFile(path.join(directory, 'state.pre-sqlite.json'), 'utf8'),
    ).toBe(legacy);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const exportedFile = path.join(directory, 'export.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportedFile);
    await page
      .getByRole('button', { name: '데이터 내보내기', exact: true })
      .click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(exportedFile, 'utf8'));
        } catch {
          return null;
        }
      })
      .toEqual(migrated);

    const imported = createInitialState();
    imported.tasks[0].title = '가져온 새 작업';
    const importedFile = path.join(directory, 'import.json');
    await writeFile(importedFile, JSON.stringify(imported));
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, importedFile);
    await page
      .getByRole('button', { name: '데이터 가져오기', exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.to3mato!.load()))
      .toEqual(imported);
    const backup = new DatabaseSync(
      path.join(directory, 'to3mato.pre-import.sqlite3'),
      { readOnly: true },
    );
    expect(
      backup.prepare("SELECT title FROM tasks WHERE id='t1'").get()?.title,
    ).toBe('이전할 기존 작업');
    backup.close();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole('button', { name: '가져온 새 작업 수정', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.to3mato!.load())).toEqual(imported);
    expect(await readFile(path.join(directory, 'state.json'), 'utf8')).toBe(
      legacy,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
