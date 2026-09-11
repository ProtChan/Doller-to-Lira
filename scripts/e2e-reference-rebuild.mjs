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
const isWeekday = (date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
};

try {
  console.log('REFERENCE REBUILD RULES BROWSER=', browserName);
  console.log('REFERENCE REBUILD RULES TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.askDayHighReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.referenceDataRebuild === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });

  const reference = await page.evaluate(() => {
    const rates = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const highs = (window.__DTL_ASK_DAY_HIGH_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskDayHigh) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const resolved = rates.map((row) => ({
      date: row.date,
      mergedRate: window.__DTL_HIROSE_RATE_AT__?.(row.date) || null,
      high: window.__DTL_ASK_DAY_HIGH_AT__?.(row.date) || null,
      swap: window.__DTL_HIROSE_SWAP_RESOLUTION__?.(row.date) || null
    }));
    return {
      rates,
      highs,
      resolved,
      highRecords: Number(document.documentElement.dataset.askDayHighRecords || 0)
    };
  });

  assert.ok(reference.rates.length > 1, 'reference rate history must contain multiple rows');
  assert.ok(reference.highs.length > 0, 'ASK-high history must not be empty');
  assert.equal(reference.highs.every((row) => {
    const day = new Date(`${row.date}T12:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  }), true, 'ASK-high history must contain weekdays only');
  assert.equal(reference.rates.every((row) => isWeekday(row.date)), true, 'rebuild source rate history must contain weekdays only');
  assert.equal(reference.highRecords, reference.highs.length, 'ASK-high dataset metadata must match the published history');

  for (const item of reference.resolved) {
    assert.ok(item.mergedRate, `merged rate missing for ${item.date}`);
    near(item.mergedRate.usdTryAskClose23, reference.rates.find((row) => row.date === item.date).usdTryAskClose23, `USDTRY reference close ${item.date}`);
    near(item.mergedRate.usdJpyAskClose23, reference.rates.find((row) => row.date === item.date).usdJpyAskClose23, `USDJPY reference close ${item.date}`);
    if (item.high) near(item.mergedRate.usdTryAskDayHigh, item.high.usdTryAskDayHigh, `merged ASK high ${item.date}`);
  }
  console.log('published reference histories are internally consistent: PASS');

  assert.equal(await page.locator('#rebuildReferenceDataBtn').count(), 1, 'bulk reference rebuild button missing');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#openSettingsBtn').click();
  await page.locator('#resetAllBtn').click();
  await page.waitForFunction(() => {
    const current = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return Array.isArray(current.daily) && current.daily.length === 0;
  });

  const rebuilt = await page.evaluate(() => window.__DTL_REBUILD_REFERENCE_DATA__?.({ silent:true }));
  assert.equal(rebuilt?.ok, true, `reference rebuild failed: ${JSON.stringify(rebuilt)}`);
  assert.equal(rebuilt.rows, reference.rates.length, 'rebuild must restore every valid published rate day');

  const expectedHighCount = reference.resolved.filter((item) => Number(item.mergedRate?.usdTryAskDayHigh) > 0).length;
  const expectedOfficialSwapCount = reference.resolved.filter((item) => item.swap?.status === 'official').length;
  assert.equal(rebuilt.highs, expectedHighCount, 'rebuild high count must equal rate days with a published/merged high');
  assert.equal(rebuilt.swaps, expectedOfficialSwapCount, 'rebuild official-swap count must equal official display-date resolutions');

  const rebuiltState = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return {
      daily: Array.isArray(current.daily) ? current.daily : [],
      derived: typeof derivedDaily === 'function' ? derivedDaily() : []
    };
  });
  assert.equal(rebuiltState.daily.length, reference.rates.length, 'rebuilt daily row count mismatch');
  assert.equal(rebuiltState.daily.every((row) => {
    const day = new Date(`${row.date}T12:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  }), true, 'rebuild must never create weekend daily rows');

  const dailyByDate = new Map(rebuiltState.daily.map((row) => [row.date, row]));
  const resolutionByDate = new Map(reference.resolved.map((item) => [item.date, item]));
  for (const source of reference.rates) {
    const row = dailyByDate.get(source.date);
    const expected = resolutionByDate.get(source.date);
    assert.ok(row, `rebuilt row missing for ${source.date}`);
    assert.ok(expected?.mergedRate, `reference row missing for ${source.date}`);

    near(row.rate, expected.mergedRate.usdTryAskClose23, `rebuilt USDTRY ${source.date}`);
    near(row.usdJpy, expected.mergedRate.usdJpyAskClose23, `rebuilt USDJPY ${source.date}`);
    near(row.tryJpy, Number(expected.mergedRate.usdJpyAskClose23) / Number(expected.mergedRate.usdTryAskClose23), `rebuilt TRYJPY ${source.date}`);
    assert.equal(row.rateSource, 'reference-bulk');
    assert.equal(row.rateSourcePrice, 'ASK');
    assert.equal(row.rateSourceTimeframe, source.sourceTimeframe || '60m');
    assert.equal(row.rateSourceBarTime, source.sourceBarTime || '23:00 JST');

    const expectedHigh = Number(expected.mergedRate.usdTryAskDayHigh || 0);
    if (expectedHigh > 0) near(row.usdTryAskDayHigh, expectedHigh, `rebuilt ASK high ${source.date}`);

    const swap = expected.swap;
    assert.ok(swap, `swap resolution missing for rebuilt date ${source.date}`);
    assert.equal(row.swapCreditDate, swap.creditDate || source.date, `swap display date ${source.date}`);
    assert.equal(row.swapSourceDate, swap.sourceDate || '', `swap source date ${source.date}`);
    if (swap.status === 'official') {
      assert.equal(row.swapSource, 'hirose');
      assert.equal(row.swapPending, false);
      near(row.swapPerLot, swap.shortPerLot, `rebuilt short swap ${source.date}`);
      near(row.swapLongPerLot, swap.longPerLot, `rebuilt long swap ${source.date}`);
      assert.equal(Number(row.swapSourceDays), Number(swap.row?.days || 0));
    } else if (swap.status === 'pending') {
      assert.equal(row.swapSource, 'hirose-pending');
      assert.equal(row.swapPending, true);
      near(row.swapPerLot, 0, `pending rebuilt swap ${source.date}`);
    } else {
      assert.equal(row.swapSource, 'hirose-zero');
      assert.equal(row.swapPending, false);
      near(row.swapPerLot, 0, `zero rebuilt swap ${source.date}`);
    }
  }
  console.log('reset -> rebuild reproduces rate/high/swap reference semantics for every row: PASS');

  const derivedByDate = new Map(rebuiltState.derived.map((row) => [row.date, row]));
  for (const row of rebuiltState.daily) {
    const derived = derivedByDate.get(row.date);
    assert.ok(derived, `derived row missing for ${row.date}`);
    near(derived.total, Number(derived.fxPnl || 0) + Number(derived.swap || 0), `derived Net identity ${row.date}`);
  }
  console.log('rebuilt derived rows satisfy Net = FX + cumulative Swap: PASS');

  await page.locator('[data-tab="risk"]').click();
  await page.waitForFunction(() => {
    const chart = window.Chart?.getChart?.(document.getElementById('lcChart'));
    return chart?.data?.datasets?.some((dataset) => dataset.label === '日中最大ASK');
  });
  const chartCheck = await page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById('lcChart'));
    const dataset = chart.data.datasets.find((item) => item.label === '日中最大ASK');
    const rows = derivedDaily();
    return {
      labels: chart.data.labels,
      data: dataset.data,
      pointRadius: dataset.pointRadius,
      expectedLabels: rows.map((row) => row.date.slice(5)),
      expectedData: rows.map((row) => Number(row.usdTryAskDayHigh) > 0 ? Number(row.usdTryAskDayHigh) : null)
    };
  });
  assert.deepEqual(chartCheck.labels, chartCheck.expectedLabels, 'ASK-high chart labels must follow derived daily dates');
  assert.equal(chartCheck.data.length, chartCheck.expectedData.length, 'ASK-high chart series length mismatch');
  chartCheck.data.forEach((value, index) => {
    const expected = chartCheck.expectedData[index];
    if (expected === null) assert.equal(value, null, `ASK-high chart should have a gap at index ${index}`);
    else near(value, expected, `ASK-high chart value index ${index}`);
  });
  assert.equal(Number(chartCheck.pointRadius), 0, 'ASK-high series should remain a pure line without visible point markers');
  console.log('ASK-high risk chart mirrors rebuilt daily high data: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`REFERENCE REBUILD RULES E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
