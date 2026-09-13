import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
// This test measures actual provider requests made by the page. Service Worker cache/
// interception behavior is guarded separately in the production SW architecture test.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  serviceWorkers: 'block'
});

const currentResponse = await context.request.get(new URL('data/hirose-ask-close-23.json', targetUrl).href);
assert.equal(currentResponse.ok(), true, `current Hirose rate feed failed: ${currentResponse.status()}`);
const currentFeed = await currentResponse.json();
const currentRows = Array.isArray(currentFeed?.history)
  ? currentFeed.history
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
  : [];
assert.ok(currentRows.length >= 3, 'need at least three Hirose rate rows for correction test');
const latest = currentRows.at(-1);
const correctionTarget = currentRows.slice(0, -1).reverse().find((row) => row?.publishedAt) || currentRows.at(-2);
const previous = currentRows.at(-2);
const staleRate = Number((Number(correctionTarget.usdTryAskClose23) * 1.0007).toFixed(6));
const staleUsdJpy = Number((Number(correctionTarget.usdJpyAskClose23) * 0.9993).toFixed(6));
let liveFetchCount = 0;

// The historical bootstrap is intentionally stale in two ways:
// 1) latest publication is missing, and 2) an already-known historical date has an
// obsolete close. The live no-store feed must repair both without a full reload.
await context.route(/\/data\/hirose-ask-close-23\.json\?rates=/, async (route) => {
  const response = await route.fetch();
  const data = await response.json();
  const history = Array.isArray(data?.history)
    ? data.history
        .filter((row) => row?.date !== latest.date)
        .map((row) => row?.date === correctionTarget.date
          ? { ...row, usdTryAskClose23: staleRate, usdJpyAskClose23: staleUsdJpy, publishedAt: '' }
          : row)
    : [];
  await route.fulfill({
    response,
    contentType: 'application/json',
    body: JSON.stringify({ ...data, history, historyEnd: history.at(-1)?.date || '', records: history.length })
  });
});

await context.route(/\/data\/hirose-ask-close-23\.json\?live=/, async (route) => {
  liveFetchCount += 1;
  await route.continue();
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.addInitScript(() => {
    // Legacy preference must no longer prevent provider updates.
    localStorage.setItem('dollar-to-lira:rate-source:v1', 'manual');
  });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.liveRateRefresh === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.dailyDataService === '1', { timeout: 15000 });

  assert.equal(
    await page.locator('html').getAttribute('data-hirose-rate-history-end'),
    previous.date,
    `stale-session fixture did not hide latest ${latest.date} publication initially`
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('dollar-to-lira:rate-source:v1')), 'auto');
  assert.equal(await page.locator('html').getAttribute('data-live-rate-refresh-policy'), 'boot-focus-visible-2min-manual-full-reconcile');

  // No manual API call here: boot refresh itself must add the missing latest date and
  // overwrite the stale value for the already-existing historical correction date.
  await page.waitForFunction(({ latest, correction }) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    const latestRow = saved.daily?.find((item) => item.date === latest.date);
    const correctedRow = saved.daily?.find((item) => item.date === correction.date);
    return Number(document.documentElement.dataset.liveRateRefreshGeneration || 0) >= 1
      && latestRow?.rateSource === 'provider'
      && correctedRow?.rateSource === 'provider'
      && Math.abs(Number(latestRow.rate) - Number(latest.rate)) < 1e-10
      && Math.abs(Number(latestRow.usdJpy) - Number(latest.usdJpy)) < 1e-10
      && Math.abs(Number(correctedRow.rate) - Number(correction.rate)) < 1e-10
      && Math.abs(Number(correctedRow.usdJpy) - Number(correction.usdJpy)) < 1e-10;
  }, {
    latest: { date: latest.date, rate: latest.usdTryAskClose23, usdJpy: latest.usdJpyAskClose23 },
    correction: { date: correctionTarget.date, rate: correctionTarget.usdTryAskClose23, usdJpy: correctionTarget.usdJpyAskClose23 }
  }, { timeout: 10000 });

  const live = await page.evaluate(({ latestDate, correctionDate }) => ({
    mode: document.documentElement.dataset.rateSourceMode,
    service: document.documentElement.dataset.dailyDataMode,
    ready: document.documentElement.dataset.liveRateRefreshReady,
    end: document.documentElement.dataset.liveRateRefreshEnd,
    updated: Number(document.documentElement.dataset.liveRateRefreshUpdated || 0),
    generation: Number(document.documentElement.dataset.liveRateRefreshGeneration || 0),
    latest: window.__DTL_LIVE_HIROSE_RATE_AT__?.(latestDate) || null,
    corrected: window.__DTL_LIVE_HIROSE_RATE_AT__?.(correctionDate) || null,
    storedLatest: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === latestDate) || null,
    storedCorrected: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === correctionDate) || null
  }), { latestDate: latest.date, correctionDate: correctionTarget.date });

  assert.equal(live.mode, 'auto');
  assert.equal(live.service, 'provider-readonly');
  assert.equal(live.ready, '1');
  assert.equal(live.end, latest.date);
  assert.ok(live.generation >= 1);
  assert.equal(live.latest?.usdTryAskClose23, Number(latest.usdTryAskClose23));
  assert.equal(live.corrected?.usdTryAskClose23, Number(correctionTarget.usdTryAskClose23));
  assert.equal(live.storedLatest?.rateSource, 'provider');
  assert.equal(live.storedCorrected?.rateSource, 'provider');
  assert.equal(live.storedCorrected?.rate, Number(correctionTarget.usdTryAskClose23));
  assert.equal(live.storedCorrected?.usdJpy, Number(correctionTarget.usdJpyAskClose23));
  assert.notEqual(live.storedCorrected?.rate, staleRate, 'historical stale rate survived boot reconciliation');
  console.log(`automatic historical correction ${correctionTarget.date} + latest ${latest.date}: PASS`);

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#dailyForm').isVisible(), false);
  assert.equal(await page.locator('#dailyTableBody [data-delete-daily]').count(), 0);
  assert.equal(await page.locator('#refreshDailyDataBtn').count(), 1, 'manual provider refresh button missing');

  const beforeGeneration = Number(await page.locator('html').getAttribute('data-live-rate-refresh-generation') || 0);
  const beforeFetches = liveFetchCount;
  await page.locator('#refreshDailyDataBtn').click();
  await page.waitForFunction((generation) => Number(document.documentElement.dataset.liveRateRefreshGeneration || 0) > generation, beforeGeneration, { timeout: 10000 });
  await page.waitForFunction(() => document.documentElement.dataset.liveRateRefreshReason === 'manual-api', { timeout: 10000 });
  await page.waitForFunction(() => /最終同期/.test(document.getElementById('dailyRefreshStatus')?.textContent || ''), { timeout: 10000 });
  assert.ok(liveFetchCount > beforeFetches, 'manual refresh did not issue a fresh provider request');
  assert.match(await page.locator('#dailyRefreshStatus').textContent(), /最終同期/);
  console.log('manual Daily Data provider refresh: PASS');

  const correctedAfterManual = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return saved.daily?.find((row) => row.date === date) || null;
  }, correctionTarget.date);
  assert.equal(correctedAfterManual?.rate, Number(correctionTarget.usdTryAskClose23));
  assert.equal(correctedAfterManual?.usdJpy, Number(correctionTarget.usdJpyAskClose23));

  const actionablePageErrors = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionablePageErrors.length) throw new Error(`Browser page errors: ${actionablePageErrors.join(' | ')}`);
  console.log(`LIVE PROVIDER REFRESH E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
