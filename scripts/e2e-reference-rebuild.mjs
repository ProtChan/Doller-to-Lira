import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  console.log('REFERENCE REBUILD BROWSER=', browserName);
  console.log('REFERENCE REBUILD TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hirosePendingEntries === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.askDayHighReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.referenceDataRebuild === '1', { timeout: 15000 });

  const highChecks = await page.evaluate(() => ({
    records: Number(document.documentElement.dataset.askDayHighRecords || 0),
    sep3: window.__DTL_ASK_DAY_HIGH_AT__?.('2026-09-03') || null,
    sep4Merged: window.__DTL_HIROSE_RATE_AT__?.('2026-09-04') || null,
    weekend: window.__DTL_ASK_DAY_HIGH_AT__?.('2026-09-05') || null,
    hasWeekend: (window.__DTL_ASK_DAY_HIGH_HISTORY__?.() || []).some((row) => {
      const d = new Date(`${row.date}T12:00:00Z`).getUTCDay();
      return d === 0 || d === 6;
    })
  }));
  assert.equal(highChecks.records, 41, `unexpected ASK-high record count: ${JSON.stringify(highChecks)}`);
  assert.equal(highChecks.sep3?.usdTryAskDayHigh, 48.4657, 'Sep 3 ASK high from uploaded CSV was not loaded');
  assert.equal(highChecks.weekend, null, 'Saturday must not have a standalone ASK-high row');
  assert.equal(highChecks.hasWeekend, false, 'ASK-high feed contains a weekend row');
  // Primary owner-manual publication remains authoritative over the supplemental CSV on overlapping dates.
  assert.equal(highChecks.sep4Merged?.usdTryAskDayHigh, 48.4947, 'owner-published Sep 4 high should remain authoritative');
  console.log('weekday-only ASK-high backfill: PASS');

  await page.locator('#openBackupBtn').click();
  assert.equal(await page.locator('#rebuildReferenceDataBtn').count(), 1, 'bulk reference rebuild button missing');
  await page.locator('#closeBackupBtn').click();

  // Exercise the real reset path, then rebuild all server-side reference inputs in one pass.
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#openSettingsBtn').click();
  await page.locator('#resetAllBtn').click();
  await page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return Array.isArray(state.daily) && state.daily.length === 0;
  });

  const rebuilt = await page.evaluate(() => window.__DTL_REBUILD_REFERENCE_DATA__?.({ silent:true }));
  assert.equal(rebuilt?.ok, true, `reference rebuild failed: ${JSON.stringify(rebuilt)}`);
  assert.equal(rebuilt.rows, 43, `reference rebuild should restore 43 rate days: ${JSON.stringify(rebuilt)}`);
  assert.equal(rebuilt.highs, 42, `reference rebuild should restore 42 known daily highs: ${JSON.stringify(rebuilt)}`);
  assert.equal(rebuilt.swaps, 43, `reference rebuild should resolve swap for all 43 rate days: ${JSON.stringify(rebuilt)}`);

  const stateChecks = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    const byDate = Object.fromEntries((state.daily || []).map((row) => [row.date, row]));
    return {
      count: state.daily?.length || 0,
      weekendRows: (state.daily || []).filter((row) => {
        const d = new Date(`${row.date}T12:00:00Z`).getUTCDay();
        return d === 0 || d === 6;
      }).map((row) => row.date),
      sep3: byDate['2026-09-03'] || null,
      sep5: byDate['2026-09-05'] || null,
      sep8: byDate['2026-09-08'] || null
    };
  });
  assert.equal(stateChecks.count, 43, 'bulk rebuild daily row count mismatch');
  assert.deepEqual(stateChecks.weekendRows, [], `bulk rebuild created weekend rows: ${stateChecks.weekendRows}`);
  assert.equal(stateChecks.sep5, null, 'Saturday Sep 5 must not be created');
  assert.equal(Number(stateChecks.sep3?.rate), 48.3153, 'Sep 3 USD/TRY was not restored');
  assert.equal(Number(stateChecks.sep3?.usdJpy), 155.422, 'Sep 3 USD/JPY was not restored');
  assert.equal(Number(stateChecks.sep3?.usdTryAskDayHigh), 48.4657, 'Sep 3 daily high was not restored');
  assert.equal(Number(stateChecks.sep3?.swapPerLot), 118.26, 'Sep 3 credited swap was not restored from Sep 2 source');
  assert.equal(stateChecks.sep3?.swapSourceDate, '2026-09-02', 'Sep 3 swap source date mismatch');
  assert.equal(Number(stateChecks.sep8?.swapPerLot), 116.22, 'Sep 8 credited swap was not restored from Sep 7 source');
  assert.equal(stateChecks.sep8?.swapSourceDate, '2026-09-07', 'Sep 8 swap source date mismatch');
  console.log('reset -> one-click reference data rebuild: PASS');

  await page.locator('[data-tab="risk"]').click();
  await page.waitForFunction(() => {
    const chart = window.Chart?.getChart?.(document.getElementById('lcChart'));
    return chart?.data?.datasets?.some((d) => d.label === '日中最大ASK');
  });
  const chartCheck = await page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById('lcChart'));
    const ds = chart.data.datasets.find((d) => d.label === '日中最大ASK');
    const idx = chart.data.labels.indexOf('09-03');
    return { value: idx >= 0 ? ds.data[idx] : null, pointRadius: ds.pointRadius };
  });
  assert.equal(Number(chartCheck.value), 48.4657, 'backfilled ASK high is not visible on risk chart');
  assert.equal(Number(chartCheck.pointRadius), 0, 'ASK-high series should remain a pure line without visible point markers');
  console.log('backfilled ASK high risk line: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`REFERENCE REBUILD E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
