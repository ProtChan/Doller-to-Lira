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
    storedSep7: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-09-07') || null
  }));

  assert.equal(history.start, '2026-07-10', `unexpected rate history start: ${history.start}`);
  assert.equal(history.end, '2026-09-07', `unexpected rate history end: ${history.end}`);
  assert.equal(history.records, 42, `unexpected rate history record count: ${history.records}`);
  assert.equal(history.sep4?.usdTryAskClose23, 48.4438, '2026-09-04 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep4?.usdJpyAskClose23, 156.12, '2026-09-04 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep7?.usdTryAskClose23, 48.4351, '2026-09-07 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep7?.usdJpyAskClose23, 154.289, '2026-09-07 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.storedSep7?.rate, 48.4351, '2026-09-07 historical USDTRY row was not backfilled');
  assert.equal(history.storedSep7?.usdJpy, 154.289, '2026-09-07 historical USDJPY row was not backfilled');
  assert.equal(history.storedSep7?.rateSource, 'hirose-ask-23close', 'historical row source marker is missing');
  console.log('42 Hirose 23:00 ASK closes through Sep 7 + local backfill: PASS');

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-07');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 48.4351, 'USDTRY Sep 7 form auto-fill is wrong');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 154.289, 'USDJPY Sep 7 form auto-fill is wrong');
  console.log('Sep 7 historical date form auto-fill: PASS');

  // A user-edited exact daily row must win over the repository history on reload.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = saved.daily.find((item) => item.date === '2026-09-07');
    row.rate = 49.9999;
    row.usdJpy = 150.123;
    row.tryJpy = row.usdJpy / row.rate;
    row.rateSource = 'manual-test';
    localStorage.setItem('dollar-to-lira:v1', JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-07');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 49.9999, 'existing user USDTRY row was overwritten by history');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 150.123, 'existing user USDJPY row was overwritten by history');
  console.log('existing daily rows remain authoritative: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE RATE HISTORY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
