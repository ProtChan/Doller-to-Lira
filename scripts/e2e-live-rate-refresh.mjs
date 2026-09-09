import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });

// Simulate a tab that was already open before Sep 9 was published: the initial
// historical request only knows through Sep 8, while the later ?live= refresh
// sees the current repository file containing Sep 9.
await context.route(/\/data\/hirose-ask-close-23\.json\?rates=/, async (route) => {
  const response = await route.fetch();
  const data = await response.json();
  const history = Array.isArray(data?.history)
    ? data.history.filter((row) => row?.date !== '2026-09-09')
    : [];
  await route.fulfill({
    response,
    contentType: 'application/json',
    body: JSON.stringify({
      ...data,
      history,
      historyEnd: history.at(-1)?.date || '',
      records: history.length
    })
  });
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.addInitScript(() => {
    localStorage.setItem('dollar-to-lira:rate-source:v1', 'saved');
  });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.userPreparedRateReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.liveRateRefresh === '1', { timeout: 15000 });

  assert.equal(await page.locator('html').getAttribute('data-hirose-rate-history-end'), '2026-09-08', 'stale-session fixture did not hide Sep 9 initially');

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-09');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#dailyRate').inputValue(), '', 'manual stale session unexpectedly had Sep 9 USDTRY');
  assert.equal(await page.locator('#dailyUsdJpy').inputValue(), '', 'manual stale session unexpectedly had Sep 9 USDJPY');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingRateSource').selectOption('auto');
  await page.locator('#closeSettingsBtn').click();

  await page.waitForFunction(() =>
    Number(document.querySelector('#dailyRate')?.value) === 48.4787 &&
    Number(document.querySelector('#dailyUsdJpy')?.value) === 153.21,
    { timeout: 10000 }
  );

  const live = await page.evaluate(() => ({
    mode: document.documentElement.dataset.rateSourceMode,
    ready: document.documentElement.dataset.liveRateRefreshReady,
    end: document.documentElement.dataset.liveRateRefreshEnd,
    row: window.__DTL_LIVE_HIROSE_RATE_AT__?.('2026-09-09') || null,
    stored: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-09-09') || null
  }));

  assert.equal(live.mode, 'auto');
  assert.equal(live.ready, '1');
  assert.equal(live.end, '2026-09-09');
  assert.equal(live.row?.usdTryAskClose23, 48.4787);
  assert.equal(live.row?.usdJpyAskClose23, 153.21);
  assert.equal(live.stored?.rate, 48.4787, 'live-published Sep 9 rate was not imported into daily state');
  assert.equal(live.stored?.usdJpy, 153.21, 'live-published Sep 9 USDJPY was not imported into daily state');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`STALE SESSION -> AUTO -> SEP 9 LIVE RATE (${browserName}): PASS`);
} finally {
  await browser.close();
}
