import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('PNL DATE ALIGNMENT BROWSER=', browserName);
  console.log('PNL DATE ALIGNMENT TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.pnlDateAlignment === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.backendCoreReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.swapPresentationRule === 'cumulative-lines-shifted-next-business-day', { timeout: 15000 });

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.waitForFunction(() => document.documentElement.dataset.swapInputMode === 'hirose', { timeout: 5000 });

  const fixture = await page.evaluate(() => {
    const rates = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0);
    const rateByDate = new Map(rates.map((row) => [row.date, row]));
    const credits = window.__DTL_HIROSE_CREDIT_HISTORY__?.() || [];
    const candidates = credits.filter((entry) => rateByDate.has(entry.sourceDate) && rateByDate.has(entry.creditDate));
    const credit = candidates.find((entry) => Number(entry?.row?.days || 0) > 1) || candidates[0] || null;
    if (!credit) return null;
    return {
      credit,
      sourceRate: rateByDate.get(credit.sourceDate),
      creditRate: rateByDate.get(credit.creditDate)
    };
  });

  assert.ok(fixture?.credit, 'date-alignment E2E requires a source/credit pair with rate snapshots');
  assert.notEqual(fixture.credit.sourceDate, fixture.credit.creditDate, 'source and credit dates must differ');

  await page.evaluate((fixture) => {
    const makeDaily = (date, rateRow) => ({
      date,
      rate: Number(rateRow.usdTryAskClose23),
      usdJpy: Number(rateRow.usdJpyAskClose23),
      tryJpy: Number(rateRow.usdJpyAskClose23) / Number(rateRow.usdTryAskClose23),
      rateSource: 'reference-bulk'
    });
    state.positions = [{
      id: 'pnl-date-alignment-fixture',
      date: fixture.credit.sourceDate,
      side: 'short',
      entryRate: Number(fixture.sourceRate.usdTryAskClose23),
      lots: 1,
      memo: '',
      closeDate: null,
      closeRate: null
    }];
    state.daily = [
      makeDaily(fixture.credit.sourceDate, fixture.sourceRate),
      makeDaily(fixture.credit.creditDate, fixture.creditRate)
    ];
    state.updatedAt = new Date().toISOString();
    localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
    window.__DTL_BACKEND_INVALIDATE__?.();
    renderAll();
  }, fixture);

  const result = await page.evaluate(({ sourceDate, creditDate }) => {
    const accountingSource = positionSwapAsOf(state.positions[0], sourceDate);
    const accountingCredit = positionSwapAsOf(state.positions[0], creditDate);
    const rows = window.__DTL_PRESENTATION_DAILY__?.() || [];
    const source = rows.find((row) => row.date === sourceDate) || null;
    const credit = rows.find((row) => row.date === creditDate) || null;
    return { accountingSource, accountingCredit, source, credit };
  }, { sourceDate: fixture.credit.sourceDate, creditDate: fixture.credit.creditDate });

  assert.ok(result.source && result.credit, 'presentation rows for source/credit dates are missing');
  near(result.accountingSource, 0, 'source-date cumulative swap must stay unchanged for a same-day-opened position');
  near(result.accountingCredit, Number(fixture.credit.row.sellJpy), 'credit-date cumulative swap');
  near(result.source.dailySwap, 0, 'source-date daily breakdown must not show the shifted swap');
  near(result.credit.dailySwap, result.accountingCredit - result.accountingSource, 'credit-date daily breakdown must contain the shifted swap');
  near(result.credit.dailyPnl, Number(result.credit.dailyFxPnl) + Number(result.credit.dailySwap), 'daily breakdown Net identity');

  await page.locator('[data-tab="overview"]').click();
  await page.waitForFunction(() => {
    const chart = window.Chart?.getChart(document.querySelector('#overviewChart'));
    const labels = chart?.data?.datasets?.map((dataset) => String(dataset.label)) || [];
    return chart?.config?.type === 'line'
      && labels.includes('総損益')
      && labels.includes('為替差損益')
      && labels.includes('累積Swap');
  }, { timeout: 5000 });

  const chart = await page.evaluate(({ sourceDate, creditDate }) => {
    const instance = window.Chart.getChart(document.querySelector('#overviewChart'));
    const labels = instance.data.labels.map(String);
    const swap = instance.data.datasets.find((dataset) => String(dataset.label) === '累積Swap');
    const fx = instance.data.datasets.find((dataset) => String(dataset.label) === '為替差損益');
    const total = instance.data.datasets.find((dataset) => String(dataset.label) === '総損益');
    const sourceLabel = sourceDate.slice(5);
    const creditLabel = creditDate.slice(5);
    return {
      chartType: instance.config.type,
      sourceIndex: labels.indexOf(sourceLabel),
      creditIndex: labels.indexOf(creditLabel),
      swap: swap?.data || [],
      fx: fx?.data || [],
      total: total?.data || [],
      totalFill: total?.fill,
      totalTension: total?.tension,
      fxTension: fx?.tension,
      swapTension: swap?.tension
    };
  }, { sourceDate: fixture.credit.sourceDate, creditDate: fixture.credit.creditDate });

  assert.equal(chart.chartType, 'line', 'overview PnL must remain a cumulative line chart');
  assert.ok(chart.sourceIndex >= 0 && chart.creditIndex >= 0, 'chart labels are missing the source/credit dates');
  near(chart.swap[chart.sourceIndex], result.accountingSource, 'cumulative Swap line must stay flat on the broker source date');
  near(chart.swap[chart.creditIndex], result.accountingCredit, 'cumulative Swap line must jump on the next business day');
  near(chart.total[chart.sourceIndex], Number(chart.fx[chart.sourceIndex]) + Number(chart.swap[chart.sourceIndex]), 'source-date cumulative total identity');
  near(chart.total[chart.creditIndex], Number(chart.fx[chart.creditIndex]) + Number(chart.swap[chart.creditIndex]), 'credit-date cumulative total identity');
  assert.equal(chart.totalFill, true, 'original cumulative total fill must be preserved');
  near(chart.totalTension, 0.25, 'original total line tension');
  near(chart.fxTension, 0.25, 'original FX line tension');
  near(chart.swapTension, 0.25, 'original Swap line tension');
  console.log('cumulative line design + next-business-day swap jump: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`PNL DATE ALIGNMENT E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
