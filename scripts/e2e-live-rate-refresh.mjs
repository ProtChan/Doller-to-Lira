import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });

// Read the real current feed first. The test then hides only the newest publication
// from the initial historical request, simulating a tab that was already open before
// that publication. The later ?live= refresh is allowed to see the real current feed.
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

await context.route(/\/data\/hirose-ask-close-23\.json\?rates=/, async (route) => {
  const response = await route.fetch();
  const data = await response.json();
  const history = Array.isArray(data?.history)
    ? data.history.filter((row) => row?.date !== latest.date)
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

  assert.equal(
    await page.locator('html').getAttribute('data-hirose-rate-history-end'),
    previous.date,
    `stale-session fixture did not hide latest ${latest.date} publication initially`
  );

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill(latest.date);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#dailyRate').inputValue(), '', `manual stale session unexpectedly had ${latest.date} USDTRY`);
  assert.equal(await page.locator('#dailyUsdJpy').inputValue(), '', `manual stale session unexpectedly had ${latest.date} USDJPY`);

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingRateSource').selectOption('auto');
  await page.locator('#closeSettingsBtn').click();

  await page.waitForFunction(({ rate, usdJpy }) =>
    Number(document.querySelector('#dailyRate')?.value) === Number(rate) &&
    Number(document.querySelector('#dailyUsdJpy')?.value) === Number(usdJpy),
    { rate: latest.usdTryAskClose23, usdJpy: latest.usdJpyAskClose23 },
    { timeout: 10000 }
  );

  const live = await page.evaluate(({ latestDate }) => ({
    mode: document.documentElement.dataset.rateSourceMode,
    ready: document.documentElement.dataset.liveRateRefreshReady,
    end: document.documentElement.dataset.liveRateRefreshEnd,
    row: window.__DTL_LIVE_HIROSE_RATE_AT__?.(latestDate) || null,
    stored: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === latestDate) || null
  }), { latestDate: latest.date });

  assert.equal(live.mode, 'auto');
  assert.equal(live.ready, '1');
  assert.equal(live.end, latest.date);
  assert.equal(live.row?.usdTryAskClose23, Number(latest.usdTryAskClose23));
  assert.equal(live.row?.usdJpyAskClose23, Number(latest.usdJpyAskClose23));
  assert.equal(live.stored?.rate, Number(latest.usdTryAskClose23), `live-published ${latest.date} USDTRY was not imported into daily state`);
  assert.equal(live.stored?.usdJpy, Number(latest.usdJpyAskClose23), `live-published ${latest.date} USDJPY was not imported into daily state`);

  const actionablePageErrors = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionablePageErrors.length) throw new Error(`Browser page errors: ${actionablePageErrors.join(' | ')}`);
  console.log(`STALE SESSION -> AUTO -> LATEST ${latest.date} LIVE RATE (${browserName}): PASS`);
} finally {
  await browser.close();
}
