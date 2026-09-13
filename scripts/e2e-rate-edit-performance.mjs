import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('POSITION EDIT / BACKEND CACHE BROWSER=', browserName);
  console.log('TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.positionEditCore === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.backendCore === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.dailyDataService === '1', { timeout: 15000 });

  const markers = await page.evaluate(() => ({
    editing: document.documentElement.dataset.positionEditing,
    fastLc: document.documentElement.dataset.fastLc,
    backend: document.documentElement.dataset.backendCoreVersion,
    dailyMode: document.documentElement.dataset.dailyDataMode,
    rateAuthority: document.documentElement.dataset.dailyRateAuthority
  }));
  assert.equal(markers.editing, '1');
  assert.equal(markers.fastLc, '1');
  assert.match(markers.backend || '', /provider-core/);
  assert.equal(markers.dailyMode, 'provider-readonly');
  assert.equal(markers.rateAuthority, 'published-feed');

  const fixture = await page.evaluate(() => {
    const hirose = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { date: hirose[0]?.date || '', positionRate: Number(hirose[0]?.usdTryAskClose23 || 0) };
  });
  assert.ok(fixture.date && fixture.positionRate > 0, 'dynamic position fixture unavailable');

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#dailyForm').isVisible(), false, 'Daily Data must remain read-only');
  assert.equal(await page.locator('#dailyTableBody [data-delete-daily]').count(), 0, 'Daily Data must have no delete action');

  const initialLots = 1;
  const editedLots = initialLots * 2.5;
  const editedRate = Number((fixture.positionRate * 0.99).toFixed(4));
  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill(fixture.date);
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill(String(Number(fixture.positionRate.toFixed(4))));
  await page.locator('#entryLots').fill(String(initialLots));
  await page.locator('#positionMemo').fill('before edit');
  await page.locator('#positionForm button[type="submit"]').click();
  await page.waitForSelector('#detailEditBtn');
  await page.locator('#detailEditBtn').click();
  await page.waitForFunction(() => document.querySelector('#editPositionDialog')?.open === true);
  await page.locator('#editPositionRate').fill(String(editedRate));
  await page.locator('#editPositionLots').fill(String(editedLots));
  await page.locator('#editPositionMemo').fill('after edit');
  await page.locator('#editPositionForm button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#editPositionDialog')?.open === false);
  await page.waitForSelector('#detailEditBtn');
  await page.locator('#detailEditBtn').click();
  near(await page.locator('#editPositionRate').inputValue(), editedRate, 'edited position rate');
  near(await page.locator('#editPositionLots').inputValue(), editedLots, 'edited position lots');
  assert.equal(await page.locator('#editPositionMemo').inputValue(), 'after edit');
  await page.locator('#cancelEditPositionBtn').click();
  console.log('open position editing: PASS');

  const cache = await page.evaluate(() => {
    derivedDaily();
    const before = window.__DTL_BACKEND_STATS__?.() || null;
    derivedDaily();
    const after = window.__DTL_BACKEND_STATS__?.() || null;
    return { before, after };
  });
  assert.ok(cache.before && cache.after, 'canonical backend stats unavailable');
  assert.equal(cache.after.architecture, 'provider-readonly-core');
  assert.ok(cache.after.derivedComputations >= 1, `derived computations invalid: ${JSON.stringify(cache)}`);
  assert.ok(cache.after.derivedCacheHits > cache.before.derivedCacheHits, `canonical derived cache was not reused: ${JSON.stringify(cache)}`);
  assert.ok(Number.isFinite(cache.after.lastDerivedMs));
  console.log('single canonical derived cache: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`POSITION EDIT / BACKEND CACHE (${browserName}): PASS`);
} finally {
  await browser.close();
}
