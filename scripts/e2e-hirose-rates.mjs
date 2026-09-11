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

  const [primaryResponse, backfillResponse] = await Promise.all([
    page.request.get(new URL('data/hirose-ask-close-23.json', targetUrl).href),
    page.request.get(new URL('data/hirose-ask-4h-backfill.json', targetUrl).href)
  ]);
  assert.equal(primaryResponse.ok(), true, `primary rate feed failed: ${primaryResponse.status()}`);
  assert.equal(backfillResponse.ok(), true, `4h backfill feed failed: ${backfillResponse.status()}`);
  const primary = await primaryResponse.json();
  const backfill = await backfillResponse.json();
  const primaryRows = Array.isArray(primary?.history) ? primary.history : [];
  const backfillRows = Array.isArray(backfill?.history) ? backfill.history : [];
  const expectedByDate = new Map();
  backfillRows.forEach((row) => row?.date && expectedByDate.set(row.date, { ...row }));
  primaryRows.forEach((row) => row?.date && expectedByDate.set(row.date, { ...(expectedByDate.get(row.date) || {}), ...row }));
  const expectedRows = [...expectedByDate.values()]
    .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  assert.ok(expectedRows.length > 0, 'expected rate feed is empty');
  const expectedStart = expectedRows[0].date;
  const expectedEnd = expectedRows.at(-1).date;
  const latestExpected = expectedRows.at(-1);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });

  const history = await page.evaluate(({ expectedEnd }) => ({
    start: document.documentElement.dataset.hiroseRateHistoryStart,
    end: document.documentElement.dataset.hiroseRateHistoryEnd,
    records: Number(document.documentElement.dataset.hiroseRateHistoryRecords || 0),
    backfill4h: Number(document.documentElement.dataset.hiroseRateBackfill4h || 0),
    jul1: window.__DTL_HIROSE_RATE_AT__?.('2026-07-01') || null,
    jul10: window.__DTL_HIROSE_RATE_AT__?.('2026-07-10') || null,
    sep8: window.__DTL_HIROSE_RATE_AT__?.('2026-09-08') || null,
    sep9: window.__DTL_HIROSE_RATE_AT__?.('2026-09-09') || null,
    sep10: window.__DTL_HIROSE_RATE_AT__?.('2026-09-10') || null,
    latest: window.__DTL_HIROSE_RATE_AT__?.(expectedEnd) || null,
    storedJul1: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === '2026-07-01') || null,
    storedLatest: JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === expectedEnd) || null
  }), { expectedEnd });

  assert.equal(history.start, expectedStart, `unexpected rate history start: ${history.start}`);
  assert.equal(history.end, expectedEnd, `unexpected rate history end: ${history.end}`);
  assert.equal(history.records, expectedRows.length, `unexpected rate history record count: ${history.records}`);
  assert.equal(history.backfill4h, backfillRows.length, `unexpected 4h backfill rows: ${history.backfill4h}`);
  assert.equal(history.jul1?.usdTryAskClose23, 46.6672, '2026-07-01 USDTRY 20:00 4h ASK close is wrong');
  assert.equal(history.jul1?.usdJpyAskClose23, 162.398, '2026-07-01 USDJPY 20:00 4h ASK close is wrong');
  assert.equal(history.jul1?.usdTryAskDayHigh, 46.7319, '2026-07-01 USDTRY day high is wrong');
  assert.equal(history.jul1?.sourceTimeframe, '4h', '2026-07-01 source timeframe marker is wrong');
  assert.equal(history.jul1?.sourceBarTime, '20:00 JST', '2026-07-01 source bar marker is wrong');
  assert.equal(history.jul10?.usdTryAskClose23, 46.9859, '2026-07-10 close changed unexpectedly');
  assert.equal(history.jul10?.usdTryAskDayHigh, 47.0635, '2026-07-10 4h day high was not merged');
  assert.equal(history.sep8?.usdTryAskClose23, 48.461, '2026-09-08 USDTRY close is wrong');
  assert.equal(history.sep8?.usdJpyAskClose23, 154.005, '2026-09-08 USDJPY close is wrong');
  assert.equal(history.sep9?.usdTryAskClose23, 48.4787, '2026-09-09 USDTRY close is wrong');
  assert.equal(history.sep9?.usdJpyAskClose23, 153.21, '2026-09-09 USDJPY close is wrong');
  assert.equal(history.sep10?.usdTryAskClose23, 48.4959, '2026-09-10 published USDTRY close is wrong');
  assert.equal(history.sep10?.usdJpyAskClose23, 153.889, '2026-09-10 published USDJPY close is wrong');
  assert.equal(history.sep10?.usdTryAskDayHigh, 48.5472, '2026-09-10 published day high is wrong');
  assert.equal(history.latest?.usdTryAskClose23, Number(latestExpected.usdTryAskClose23), 'latest USDTRY row was not loaded');
  assert.equal(history.latest?.usdJpyAskClose23, Number(latestExpected.usdJpyAskClose23), 'latest USDJPY row was not loaded');
  assert.equal(history.storedJul1?.rate, 46.6672, '2026-07-01 historical USDTRY row was not backfilled');
  assert.equal(history.storedJul1?.usdJpy, 162.398, '2026-07-01 historical USDJPY row was not backfilled');
  assert.equal(history.storedLatest?.rate, Number(latestExpected.usdTryAskClose23), 'latest published USDTRY row was not backfilled');
  assert.equal(history.storedLatest?.usdJpy, Number(latestExpected.usdJpyAskClose23), 'latest published USDJPY row was not backfilled');
  console.log(`${expectedRows.length} Hirose ASK rows through ${expectedEnd}: PASS`);

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill(expectedEnd);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(({ rate, usdJpy }) =>
    Number(document.querySelector('#dailyRate')?.value) === Number(rate)
    && Number(document.querySelector('#dailyUsdJpy')?.value) === Number(usdJpy),
    { rate: latestExpected.usdTryAskClose23, usdJpy: latestExpected.usdJpyAskClose23 },
    { timeout: 10000 }
  );
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), Number(latestExpected.usdTryAskClose23), 'latest form USDTRY auto-fill is wrong');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), Number(latestExpected.usdJpyAskClose23), 'latest form USDJPY auto-fill is wrong');
  console.log(`latest ${expectedEnd} auto-fill: PASS`);

  // A user-edited exact daily row must remain authoritative on reload.
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
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-08');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(
    ([rate, usdJpy]) =>
      Number(document.querySelector('#dailyRate')?.value) === rate
      && Number(document.querySelector('#dailyUsdJpy')?.value) === usdJpy,
    [49.9999, 150.123],
    { timeout: 10000 }
  );
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 49.9999, 'existing user USDTRY row was overwritten by history');
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 150.123, 'existing user USDJPY row was overwritten by history');
  console.log('existing daily rows remain authoritative: PASS');

  const actionablePageErrors = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionablePageErrors.length) throw new Error(`Browser page errors: ${actionablePageErrors.join(' | ')}`);
  console.log(`HIROSE RATE HISTORY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
