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
    backfill4h: Number(document.documentElement.dataset.hiroseRateBackfill4h || 0),
    jul1: window.__DTL_HIROSE_RATE_AT__?.('2026-07-01') || null,
    jul10: window.__DTL_HIROSE_RATE_AT__?.('2026-07-10') || null,
    sep4: window.__DTL_HIROSE_RATE_AT__?.('2026-09-04') || null,
    sep7: window.__DTL_HIROSE_RATE_AT__?.('2026-09-07') || null,
    sep8: window.__DTL_HIROSE_RATE_AT__?.('2026-09-08') || null,
    sep9: window.__DTL_HIROSE_RATE_AT__?.('2026-09-09') || null,
    storedJul1: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-07-01') || null,
    storedSep8: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-09-08') || null,
    storedSep9: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-09-09') || null
  }));

  assert.equal(history.start, '2026-07-01', `unexpected rate history start: ${history.start}`);
  assert.equal(history.end, '2026-09-09', `unexpected rate history end: ${history.end}`);
  assert.equal(history.records, 51, `unexpected rate history record count: ${history.records}`);
  assert.equal(history.backfill4h, 8, `unexpected 4h backfill rows: ${history.backfill4h}`);
  assert.equal(history.jul1?.usdTryAskClose23, 46.6672, '2026-07-01 USDTRY 20:00 4h ASK close is wrong');
  assert.equal(history.jul1?.usdJpyAskClose23, 162.398, '2026-07-01 USDJPY 20:00 4h ASK close is wrong');
  assert.equal(history.jul1?.usdTryAskDayHigh, 46.7319, '2026-07-01 USDTRY day high is wrong');
  assert.equal(history.jul1?.sourceTimeframe, '4h', '2026-07-01 source timeframe marker is wrong');
  assert.equal(history.jul1?.sourceBarTime, '20:00 JST', '2026-07-01 source bar marker is wrong');
  assert.equal(history.jul10?.usdTryAskClose23, 46.9859, '2026-07-10 close changed unexpectedly');
  assert.equal(history.jul10?.usdTryAskDayHigh, 47.0635, '2026-07-10 4h day high was not merged');
  assert.equal(history.sep4?.usdTryAskClose23, 48.4438, '2026-09-04 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep4?.usdJpyAskClose23, 156.12, '2026-09-04 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep7?.usdTryAskClose23, 48.4531, '2026-09-07 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep7?.usdJpyAskClose23, 154.289, '2026-09-07 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep8?.usdTryAskClose23, 48.461, '2026-09-08 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep8?.usdJpyAskClose23, 154.005, '2026-09-08 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep9?.usdTryAskClose23, 48.4787, '2026-09-09 USDTRY 23:00 ASK close is wrong');
  assert.equal(history.sep9?.usdJpyAskClose23, 153.21, '2026-09-09 USDJPY 23:00 ASK close is wrong');
  assert.equal(history.sep9?.usdTryAskDayHigh, 48.5472, '2026-09-09 USDTRY day high is wrong');
  assert.equal(history.storedJul1?.rate, 46.6672, '2026-07-01 historical USDTRY row was not backfilled');
  assert.equal(history.storedJul1?.usdJpy, 162.398, '2026-07-01 historical USDJPY row was not backfilled');
  assert.equal(history.storedJul1?.rateSourceTimeframe, '4h', '2026-07-01 stored source timeframe is wrong');
  assert.equal(history.storedJul1?.rateSourceBarTime, '20:00 JST', '2026-07-01 stored source bar time is wrong');
  assert.equal(history.storedJul1?.usdTryAskDayHigh, 46.7319, '2026-07-01 stored day high was not backfilled');
  assert.equal(history.storedSep8?.rate, 48.461, '2026-09-08 historical USDTRY row was not backfilled');
  assert.equal(history.storedSep8?.usdJpy, 154.005, '2026-09-08 historical USDJPY row was not backfilled');
  assert.equal(history.storedSep8?.rateSource, 'hirose-ask-23close', 'historical row source marker is missing');
  assert.equal(history.storedSep9?.rate, 48.4787, '2026-09-09 historical USDTRY row was not backfilled');
  assert.equal(history.storedSep9?.usdJpy, 153.21, '2026-09-09 historical USDJPY row was not backfilled');
  console.log('51 Hirose ASK end-of-day rows from Jul 1 through Sep 9 + 4h backfill: PASS');

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-07-01');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 46.6672, 'USDTRY Jul 1 form auto-fill is wrong');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 162.398, 'USDJPY Jul 1 form auto-fill is wrong');
  console.log('Jul 1 historical 4h date form auto-fill: PASS');

  await page.locator('#dailyDate').fill('2026-09-08');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 48.461, 'USDTRY Sep 8 form auto-fill is wrong');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 154.005, 'USDJPY Sep 8 form auto-fill is wrong');
  console.log('Sep 8 historical date form auto-fill: PASS');

  await page.locator('#dailyDate').fill('2026-09-09');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailyRate')?.value) === 48.4787);
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 48.4787, 'USDTRY Sep 9 form auto-fill is wrong');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 153.21, 'USDJPY Sep 9 form auto-fill is wrong');
  console.log('Sep 9 published date form auto-fill: PASS');

  // A user-edited exact daily row must win over repository history on reload.
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