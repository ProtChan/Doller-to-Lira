import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });

const currentResponse = await context.request.get(new URL('data/hirose-ask-close-23.json', targetUrl).href);
assert.equal(currentResponse.ok(), true, `current Hirose rate feed failed: ${currentResponse.status()}`);
const currentFeed = await currentResponse.json();
const currentRows = Array.isArray(currentFeed?.history)
  ? currentFeed.history
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
  : [];
assert.ok(currentRows.length >= 2, 'need at least two Hirose rate rows for stale-session test');
const latest = currentRows.at(-1);
const previous = currentRows.at(-2);

// Initial historical load is stale by one publication. The later live no-store
// refresh sees the current feed, emulating a long-lived client.
await context.route(/\/data\/hirose-ask-close-23\.json\?rates=/, async (route) => {
  const response = await route.fetch();
  const data = await response.json();
  const history = Array.isArray(data?.history)
    ? data.history.filter((row) => row?.date !== latest.date)
    : [];
  await route.fulfill({
    response,
    contentType: 'application/json',
    body: JSON.stringify({ ...data, history, historyEnd: history.at(-1)?.date || '', records: history.length })
  });
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

  // Service mode triggers/accepts live publication without any user source toggle.
  await page.evaluate(() => window.__DTL_REFRESH_HIROSE_RATES__?.(true));
  await page.waitForFunction(({ date, rate, usdJpy }) => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    const row = state.daily?.find((item) => item.date === date);
    return document.documentElement.dataset.liveRateRefreshReady === '1'
      && row?.rateSource === 'provider'
      && Math.abs(Number(row.rate) - Number(rate)) < 1e-10
      && Math.abs(Number(row.usdJpy) - Number(usdJpy)) < 1e-10;
  }, { date: latest.date, rate: latest.usdTryAskClose23, usdJpy: latest.usdJpyAskClose23 }, { timeout: 10000 });

  const live = await page.evaluate((latestDate) => ({
    mode: document.documentElement.dataset.rateSourceMode,
    service: document.documentElement.dataset.dailyDataMode,
    ready: document.documentElement.dataset.liveRateRefreshReady,
    end: document.documentElement.dataset.liveRateRefreshEnd,
    row: window.__DTL_LIVE_HIROSE_RATE_AT__?.(latestDate) || null,
    stored: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === latestDate) || null
  }), latest.date);

  assert.equal(live.mode, 'auto');
  assert.equal(live.service, 'provider-readonly');
  assert.equal(live.ready, '1');
  assert.equal(live.end, latest.date);
  assert.equal(live.row?.usdTryAskClose23, Number(latest.usdTryAskClose23));
  assert.equal(live.row?.usdJpyAskClose23, Number(latest.usdJpyAskClose23));
  assert.equal(live.stored?.rateSource, 'provider');
  assert.equal(live.stored?.rate, Number(latest.usdTryAskClose23));
  assert.equal(live.stored?.usdJpy, Number(latest.usdJpyAskClose23));

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#dailyForm').isVisible(), false);
  assert.equal(await page.locator('#dailyTableBody [data-delete-daily]').count(), 0);
  console.log(`stale session -> automatic latest publication ${latest.date}: PASS`);

  const actionablePageErrors = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionablePageErrors.length) throw new Error(`Browser page errors: ${actionablePageErrors.join(' | ')}`);
  console.log(`LIVE PROVIDER REFRESH E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
