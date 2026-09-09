import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

try {
  console.log('RATE HISTORY BROWSER=', browserName);
  console.log('RATE HISTORY TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });

  const history = await page.evaluate(() => ({
    start: document.documentElement.dataset.hiroseRateHistoryStart,
    end: document.documentElement.dataset.hiroseRateHistoryEnd,
    records: Number(document.documentElement.dataset.hiroseRateHistoryRecords || 0),
    sep4: window.__DTL_HIROSE_RATE_AT__?.('2026-09-04') || null,
    sep7: window.__DTL_HIROSE_RATE_AT__?.('2026-09-07') || null,
    sep8: window.__DTL_HIROSE_RATE_AT__?.('2026-09-08') || null,
    storedSep8: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-09-08') || null
  }));

  assert.equal(history.start, '2026-07-10', `unexpected rate history start: ${history.start}`);
  assert.equal(history.end, '2026-09-08', `unexpected rate history end: ${history.end}`);
  assert.equal(history.records, 43, `unexpected rate history record count: ${history.records}`);
  assert.equal(history.sep4?.usdTryAskClose23, 48.4438, '2026-09-04 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep4?.usdJpyAskClose23, 156.12, '2026-09-04 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep7?.usdTryAskClose23, 48.4531, '2026-09-07 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep7?.usdJpyAskClose23, 154.289, '2026-09-07 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep8?.usdTryAskClose23, 48.461, '2026-09-08 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep8?.usdJpyAskClose23, 154.005, '2026-09-08 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.storedSep8?.rate, 48.461, '2026-09-08 historical USDTRY row was not backfilled');
  assert.equal(history.storedSep8?.usdJpy, 154.005, '2026-09-08 historical USDJPY row was not backfilled');
  assert.equal(history.storedSep8?.rateSource, 'hirose-ask-23close', 'historical row source marker is missing');
  console.log('43 Hirose 23:00 ASK closes through Sep 8 + local backfill: PASS');

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-08');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 48.461, 'USDTRY Sep 8 form auto-fill is wrong');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 154.005, 'USDJPY Sep 8 form auto-fill is wrong');
  console.log('Sep 8 historical date form auto-fill: PASS');

  // A user-edited exact daily row must win over the repository history on reload.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = saved.daily.find((item) => item.date === '2026-09-08');
    row.rate = 49.9999;
    row.usdJpy = 150.123;
    row.tryJpy = row.usdJpy / row.rate;
    row.rateSource = 'manual-test';
    localStorage.setItem('dollar-to-lira:v1', JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-08');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 49.9999, 'existing user USDTRY row was overwritten by history');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 150.123, 'existing user USDJPY row was overwritten by history');
  console.log('existing daily rows remain authoritative: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE RATE HISTORY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
