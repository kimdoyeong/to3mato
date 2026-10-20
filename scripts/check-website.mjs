import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const base = process.env.SITE_URL || 'http://127.0.0.1:4175';
const out = path.resolve('website/qa');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const files = new Set();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    for (const file of ['index.html', 'about.html', 'download.html']) {
      const response = await page.goto(`${base}/${file}`);
      assert.equal(response.status(), 200);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('img').evaluateAll(async (imgs) => {
        await Promise.all(
          imgs.map((img) => {
            img.loading = 'eager';
            return img.decode();
          }),
        );
      });
      const metrics = await page.evaluate(() => ({
        width: window.innerWidth,
        body: document.documentElement.scrollWidth,
        broken: [...document.images]
          .filter((i) => !i.complete || !i.naturalWidth)
          .map((i) => i.src),
        h1: document.querySelectorAll('h1').length,
      }));
      assert.ok(
        metrics.body <= width,
        `${file} ${width}px horizontal overflow ${metrics.body}`,
      );
      assert.deepEqual(metrics.broken, []);
      assert.equal(metrics.h1, 1);
      for (const ref of await page
        .locator('a[href],img[src],link[href]')
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute('href') || el.getAttribute('src')),
        )) {
        if (ref.startsWith('#'))
          assert.ok(
            await page.locator(ref).count(),
            `${file} missing anchor ${ref}`,
          );
        else files.add(new URL(ref, `${base}/${file}`).href.split('#')[0]);
      }
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: path.join(out, `${file.replace('.html', '')}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      results.push({ file, width, ...metrics });
    }
  }
  for (const url of files) {
    const response = await context.request.head(url);
    assert.equal(response.status(), 200, `Broken resource ${url}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/download.html`);
  const summaries = page.locator('summary');
  for (let i = 0; i < (await summaries.count()); i++) {
    await summaries.nth(i).click();
    assert.equal(
      await summaries.nth(i).evaluate((el) => el.parentElement.open),
      true,
    );
  }
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('link', { name: 'macOS용 다운로드', exact: false })
    .click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  const expectedRelease = JSON.parse(
    await readFile('website/dist/downloads/release.json', 'utf8'),
  );
  assert.equal(download.suggestedFilename(), expectedRelease.filename);
  const sha = createHash('sha256')
    .update(await readFile(await download.path()))
    .digest('hex');
  const release = JSON.parse(
    await readFile('website/dist/downloads/release.json', 'utf8'),
  );
  assert.equal(sha, release.sha256);
  assert.deepEqual(errors, []);
  await page.goto(`${base}/index.html`);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').innerText(), '본문으로 이동');
  await page.keyboard.press('Enter');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '소개', exact: true })
    .click();
  // Cloudflare Pages redirects .html URLs to extensionless paths.
  await page.waitForURL(/\/about(?:\.html)?$/);
  await page.goto(`${base}/index.html`);
  await page
    .getByRole('link', { name: '영상 편지 알아보기', exact: false })
    .click();
  assert.ok(page.url().endsWith('#focus-log'));
  assert.equal(await page.locator('#focus-log').count(), 1);
  assert.equal(await page.locator('#features').count(), 0);
  await page.goto('file://' + path.resolve('website/dist/index.html'));
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(
    await page.locator('link[rel=stylesheet]').evaluate((el) => !!el.sheet),
    true,
  );
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        results,
        resourcesChecked: files.size,
        download: { filename: download.suggestedFilename(), sha256: sha },
        errors,
        fileProtocol: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      pages: 3,
      viewports: [1440, 768, 390, 320],
      resources: files.size,
      downloadVerified: sha,
      errors,
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
