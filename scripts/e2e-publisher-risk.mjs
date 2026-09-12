import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  const feedResponse = await context.request.get(new URL('data/hirose-ask-close-23.json', baseUrl).href);
  assert.equal(feedResponse.ok(), true, `publisher fixture feed failed: ${feedResponse.status()}`);
  const feed = await feedResponse.json();
  const feedRows = (Array.isArray(feed?.history) ? feed.history : [])
    .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  assert.ok(feedRows.length > 0, 'publisher test requires a published rate row');
  const publisherBase = feedRows.at(-1);
  const publisherValues = {
    date: publisherBase.date,
    usdTryAskClose23: Number((Number(publisherBase.usdTryAskClose23) * 1.001).toFixed(6)),
    usdJpyAskClose23: Number((Number(publisherBase.usdJpyAskClose23) * 1.0015).toFixed(6)),
    usdTryAskDayHigh: Number((Number(publisherBase.usdTryAskClose23) * 1.005).toFixed(6)),
    usdJpyAskDayHigh: Number((Number(publisherBase.usdJpyAskClose23) * 1.004).toFixed(6))
  };

  const publisher = await context.newPage();
  await publisher.goto(new URL('publish.html', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await publisher.locator('#date').fill(publisherValues.date);
  await publisher.locator('#usdTryClose').fill(String(publisherValues.usdTryAskClose23));
  await publisher.locator('#usdJpyClose').fill(String(publisherValues.usdJpyAskClose23));
  await publisher.locator('#usdTryHigh').fill(String(publisherValues.usdTryAskDayHigh));
  await publisher.locator('#usdJpyHigh').fill(String(publisherValues.usdJpyAskDayHigh));
  const issueHref = await publisher.locator('#publish').getAttribute('href');
  assert.ok(issueHref?.startsWith('https://github.com/ProtChan/Doller-to-Lira/issues/new?'), 'publisher did not build GitHub issue URL');
  const issueUrl = new URL(issueHref);
  assert.equal(issueUrl.searchParams.get('title'), `[HIROSE-RATE] ${publisherValues.date}`);
  const body = issueUrl.searchParams.get('body') || '';
  const match = body.match(/<!-- DTL_HIROSE_RATE_V1\n(\{.*\})\n-->/s);
  assert.ok(match, 'machine-readable publisher payload missing');
  assert.deepEqual(JSON.parse(match[1]), publisherValues);
  console.log(`publisher serialization invariant (${browserName}): PASS`);
  await publisher.close();

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.worstAskRisk === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.askDayHighReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.privatePublisherDailyLayout === '2', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.dailyDataService === '1', { timeout: 15000 });

  const fixture = await page.evaluate(() => {
    const rates = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const highs = (window.__DTL_ASK_DAY_HIGH_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskDayHigh) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const eligible = highs.map((high) => ({
      high,
      rate: window.__DTL_HIROSE_RATE_AT__?.(high.date) || null
    })).filter((item) => item.rate && Number(item.rate.usdTryAskClose23) > 0 && Number(item.rate.usdJpyAskClose23) > 0);
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return { rates, eligible, settings: saved.settings || {} };
  });
  assert.ok(fixture.rates.length > 0 && fixture.eligible.length > 0, 'risk test requires overlapping rate/high history');

  const settings = fixture.settings;
  const capital = Number(settings.capital || 0);
  const unitsPerLot = Number(settings.unitsPerLot || 0);
  const leverage = Number(settings.leverage || 0);
  assert.ok(capital > 0 && unitsPerLot > 0 && leverage > 0, 'risk fixture settings must be positive');
  const firstRisk = fixture.eligible[0];
  const perLotMargin = unitsPerLot * Number(firstRisk.rate.usdJpyAskClose23) / leverage;
  const lots = Math.max(1, Math.floor((capital * 0.5) / perLotMargin));
  const positionDate = fixture.rates[0].date;
  const entryRate = Number(fixture.rates[0].usdTryAskClose23);

  // Install the synthetic position into both the live app state and persistence.
  // A full page reload is unrelated to the risk invariant and, on deployed WebKit,
  // can race the PWA/data refetch immediately after a Pages deployment.
  await page.evaluate(({ positionDate, entryRate, lots }) => {
    const key = 'dollar-to-lira:v1';
    const position = {
      id:'worst-ask-risk-invariant', date:positionDate, side:'short', entryRate, lots,
      memo:'risk invariant test', closeDate:null, closeRate:null
    };
    state.positions = [position];
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(state));
    window.__DTL_BACKEND_INVALIDATE__?.();
    try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
    renderAll();
  }, { positionDate, entryRate, lots });

  await page.waitForFunction(() => Array.isArray(state?.positions) && state.positions.some((p) => p?.id === 'worst-ask-risk-invariant'));

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#openRatePublisherBtn').count(), 0, 'publisher link leaked into public Daily Data UI');
  assert.equal(await page.locator('#dailyForm').isVisible(), false, 'Daily Data unexpectedly exposes an editor');
  assert.equal(await page.locator('#dailyTableBody [data-delete-daily]').count(), 0, 'Daily Data unexpectedly exposes deletion');
  assert.equal((await page.locator('[data-tab="daily"]').textContent())?.trim(), '日次データ');
  console.log(`publisher hidden + public Daily Data read-only (${browserName}): PASS`);

  await page.locator('[data-tab="risk"]').click();
  await page.waitForFunction(() => {
    const lc = window.Chart?.getChart?.(document.querySelector('#lcChart'));
    const maintenance = window.Chart?.getChart?.(document.querySelector('#maintenanceChart'));
    return !!lc?.data?.datasets?.some((dataset) => dataset.label === '日中最大ASK') &&
      !!maintenance?.data?.datasets?.some((dataset) => dataset.label === '日中最大ASK時 維持率');
  }, { timeout: 10000 });

  const risk = await page.evaluate((dates) => {
    const lc = Chart.getChart(document.querySelector('#lcChart'));
    const maintenance = Chart.getChart(document.querySelector('#maintenanceChart'));
    const worst = lc.data.datasets.find((dataset) => dataset.label === '日中最大ASK');
    const closeMaintenance = maintenance.data.datasets.find((dataset) => dataset.label === '23:00 維持率');
    const worstMaintenance = maintenance.data.datasets.find((dataset) => dataset.label === '日中最大ASK時 維持率');
    return {
      labels: lc.data.labels,
      worstValues: worst?.data || [],
      closeMaintenanceValues: closeMaintenance?.data || [],
      worstMaintenanceValues: worstMaintenance?.data || [],
      helpers: dates.map((date) => ({
        date,
        high: window.__DTL_WORST_ASK_AT__?.(date),
        maintenance: window.__DTL_WORST_ASK_MAINTENANCE_AT__?.(date)
      })),
      lcNote: document.querySelector('#lcChart')?.closest('.risk-chart-block')?.querySelector('.chart-title span')?.textContent || '',
      maintenanceNote: document.querySelector('#maintenanceChart')?.closest('.risk-chart-block')?.querySelector('.chart-title span')?.textContent || '',
      facts: document.querySelector('#riskFacts')?.innerText || ''
    };
  }, fixture.eligible.map((item) => item.high.date));

  for (let i = 0; i < fixture.eligible.length; i++) {
    const item = fixture.eligible[i];
    const helper = risk.helpers[i];
    const expectedHigh = Number(item.high.usdTryAskDayHigh);
    near(helper.high, expectedHigh, `worst ASK helper ${item.high.date}`);
    assert.ok(Number.isFinite(Number(helper.maintenance)), `worst-ASK maintenance helper is not finite for ${item.high.date}`);

    const label = item.high.date.slice(5);
    const index = risk.labels.indexOf(label);
    assert.ok(index >= 0, `${item.high.date} missing from risk chart`);
    near(risk.worstValues[index], expectedHigh, `risk chart high ASK ${item.high.date}`);
    const closeM = Number(risk.closeMaintenanceValues[index]);
    const worstM = Number(risk.worstMaintenanceValues[index]);
    assert.ok(Number.isFinite(closeM) && Number.isFinite(worstM), `maintenance values missing for ${item.high.date}`);
    const closeRate = Number(item.rate.usdTryAskClose23);
    if (expectedHigh > closeRate + 1e-10) {
      assert.ok(worstM < closeM, `short risk must worsen when ASK high exceeds close on ${item.high.date}: close=${closeM}, high=${worstM}`);
    } else {
      assert.ok(worstM <= closeM + 1e-8, `short risk must not improve at an equal/higher ASK on ${item.high.date}`);
    }
  }

  assert.match(risk.lcNote, /日中最大ASK/);
  assert.match(risk.maintenanceNote, /23:00 USD\/JPY/);
  assert.match(risk.facts, /最大ASK時維持率/);
  console.log(`all published ASK-high points + short-risk ordering (${browserName}): PASS`);
} finally {
  await browser.close();
}
