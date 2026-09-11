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

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('RATE HISTORY INVARIANTS BROWSER=', browserName);
  console.log('RATE HISTORY INVARIANTS TEST_URL=', targetUrl);

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
  assert.ok(expectedRows.length > 1, 'merged expected rate feed must contain multiple rows');
  const expectedStart = expectedRows[0].date;
  const expectedEnd = expectedRows.at(-1).date;

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });

  const history = await page.evaluate((dates) => {
    const stored = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    const storedByDate = new Map((stored.daily || []).map((row) => [row.date, row]));
    return {
      start: document.documentElement.dataset.hiroseRateHistoryStart,
      end: document.documentElement.dataset.hiroseRateHistoryEnd,
      records: Number(document.documentElement.dataset.hiroseRateHistoryRecords || 0),
      backfill4h: Number(document.documentElement.dataset.hiroseRateBackfill4h || 0),
      rows: dates.map((date) => window.__DTL_HIROSE_RATE_AT__?.(date) || null),
      stored: dates.map((date) => storedByDate.get(date) || null)
    };
  }, expectedRows.map((row) => row.date));

  assert.equal(history.start, expectedStart, 'rate history start must equal the first merged feed row');
  assert.equal(history.end, expectedEnd, 'rate history end must equal the last merged feed row');
  assert.equal(history.records, expectedRows.length, 'rate history record count must equal merged feed rows');
  assert.equal(history.backfill4h, backfillRows.length, '4h backfill metadata count must match its source feed');

  expectedRows.forEach((expected, index) => {
    const actual = history.rows[index];
    assert.ok(actual, `rate API row missing for ${expected.date}`);
    near(actual.usdTryAskClose23, expected.usdTryAskClose23, `USDTRY close ${expected.date}`);
    near(actual.usdJpyAskClose23, expected.usdJpyAskClose23, `USDJPY close ${expected.date}`);
    if (Number(expected.usdTryAskDayHigh) > 0) near(actual.usdTryAskDayHigh, expected.usdTryAskDayHigh, `ASK day high ${expected.date}`);
    if (expected.sourceTimeframe) assert.equal(actual.sourceTimeframe, expected.sourceTimeframe, `source timeframe ${expected.date}`);
    if (expected.sourceBarTime) assert.equal(actual.sourceBarTime, expected.sourceBarTime, `source bar time ${expected.date}`);

    const stored = history.stored[index];
    assert.ok(stored, `localStorage backfill row missing for ${expected.date}`);
    near(stored.rate, expected.usdTryAskClose23, `stored USDTRY ${expected.date}`);
    near(stored.usdJpy, expected.usdJpyAskClose23, `stored USDJPY ${expected.date}`);
  });
  console.log('all merged feed rows load and backfill consistently: PASS');

  const latestExpected = expectedRows.at(-1);
  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill(latestExpected.date);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(({ rate, usdJpy }) =>
    Number(document.querySelector('#dailyRate')?.value) === Number(rate)
    && Number(document.querySelector('#dailyUsdJpy')?.value) === Number(usdJpy),
    { rate: latestExpected.usdTryAskClose23, usdJpy: latestExpected.usdJpyAskClose23 },
    { timeout: 10000 }
  );
  near(await page.locator('#dailyRate').inputValue(), latestExpected.usdTryAskClose23, 'latest form USDTRY auto-fill');
  near(await page.locator('#dailyUsdJpy').inputValue(), latestExpected.usdJpyAskClose23, 'latest form USDJPY auto-fill');
  console.log('latest available feed row auto-fills the daily form: PASS');

  // Pick a real available row dynamically and verify that an explicit user edit remains authoritative.
  // Keep the edit inside the precision the actual form supports (USD/TRY 4dp, USD/JPY 3dp),
  // so the invariant tests persistence rather than impossible sub-step display precision.
  const editFixture = expectedRows[Math.floor(expectedRows.length / 2)];
  const manualRate = Number((Number(editFixture.usdTryAskClose23) * 1.012345).toFixed(4));
  const manualUsdJpy = Number((Number(editFixture.usdJpyAskClose23) * 0.98765).toFixed(3));
  assert.ok(manualRate > 0 && manualUsdJpy > 0);
  assert.notEqual(manualRate, Number(editFixture.usdTryAskClose23));
  assert.notEqual(manualUsdJpy, Number(editFixture.usdJpyAskClose23));

  await page.evaluate(({ date, manualRate, manualUsdJpy }) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = saved.daily.find((item) => item.date === date);
    if (!row) throw new Error(`daily row missing for edit fixture ${date}`);
    row.rate = manualRate;
    row.usdJpy = manualUsdJpy;
    row.tryJpy = row.usdJpy / row.rate;
    row.rateSource = 'manual-test';
    localStorage.setItem('dollar-to-lira:v1', JSON.stringify(saved));
  }, { date: editFixture.date, manualRate, manualUsdJpy });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill(editFixture.date);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(
    ({ manualRate, manualUsdJpy }) =>
      Number(document.querySelector('#dailyRate')?.value) === Number(manualRate)
      && Number(document.querySelector('#dailyUsdJpy')?.value) === Number(manualUsdJpy),
    { manualRate, manualUsdJpy },
    { timeout: 10000 }
  );
  near(await page.locator('#dailyRate').inputValue(), manualRate, 'existing user USDTRY row survives reload');
  near(await page.locator('#dailyUsdJpy').inputValue(), manualUsdJpy, 'existing user USDJPY row survives reload');
  console.log('user-edited daily rows remain authoritative over reference feeds: PASS');

  const actionablePageErrors = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionablePageErrors.length) throw new Error(`Browser page errors: ${actionablePageErrors.join(' | ')}`);
  console.log(`HIROSE RATE HISTORY INVARIANTS (${browserName}): PASS`);
} finally {
  await browser.close();
}
