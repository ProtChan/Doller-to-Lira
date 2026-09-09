import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });

try {
  // Owner-only publisher remains directly reachable, but must not be linked from the public app.
  const publisher = await context.newPage();
  await publisher.goto(new URL('publish.html', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await publisher.locator('#date').fill('2026-09-08');
  await publisher.locator('#usdTryClose').fill('48.4610');
  await publisher.locator('#usdJpyClose').fill('154.005');
  await publisher.locator('#usdTryHigh').fill('48.9000');
  await publisher.locator('#usdJpyHigh').fill('155.100');
  const issueHref = await publisher.locator('#publish').getAttribute('href');
  assert.ok(issueHref?.startsWith('https://github.com/ProtChan/Doller-to-Lira/issues/new?'), 'publisher did not build GitHub issue URL');
  const issueUrl = new URL(issueHref);
  assert.equal(issueUrl.searchParams.get('title'), '[HIROSE-RATE] 2026-09-08');
  const body = issueUrl.searchParams.get('body') || '';
  const match = body.match(/<!-- DTL_HIROSE_RATE_V1\n(\{.*\})\n-->/s);
  assert.ok(match, 'machine-readable publisher payload missing');
  assert.deepEqual(JSON.parse(match[1]), {
    date:'2026-09-08',
    usdTryAskClose23:48.461,
    usdJpyAskClose23:154.005,
    usdTryAskDayHigh:48.9,
    usdJpyAskDayHigh:155.1
  });
  console.log(`direct publisher (${browserName}): PASS`);
  await publisher.close();

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.worstAskRisk === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.privatePublisherDailyLayout === '1', { timeout: 15000 });

  // Give the published high-ASK dates a live short position so stressed maintenance is finite.
  await page.evaluate(() => {
    const key = 'dollar-to-lira:v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved.settings = { ...(saved.settings || {}), capital: 500000, unitsPerLot: 1000, lcThreshold: 100 };
    saved.positions = [{
      id:'worst-ask-risk-test',
      date:'2026-09-01',
      side:'short',
      entryRate:48.2772,
      lots:20,
      memo:'risk overlay test',
      closeDate:null,
      closeRate:null
    }];
    saved.updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.worstAskRisk === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.privatePublisherDailyLayout === '1', { timeout: 15000 });

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#openRatePublisherBtn').count(), 0, 'publisher link leaked into public daily UI');
  console.log(`publisher hidden from public UI (${browserName}): PASS`);

  // At desktop width, all daily-entry controls must share the same input baseline even
  // though USD/TRY and Swap have source notes underneath them.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(100);
  const alignment = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      return r ? { top:r.top, bottom:r.bottom, height:r.height } : null;
    };
    return {
      date:rect('#dailyDate'),
      rate:rect('#dailyRate'),
      usdJpy:rect('#dailyUsdJpy'),
      swap:rect('#dailySwap'),
      save:rect('#dailyForm > button[type="submit"]'),
      rateNote:!!document.querySelector('#dailyForm .rate-source-note'),
      swapNote:!!document.querySelector('#dailyForm .swap-source-note')
    };
  });
  assert.equal(alignment.rateNote, true, 'rate source note missing from daily form');
  assert.equal(alignment.swapNote, true, 'swap source note missing from daily form');
  const tops = [alignment.date, alignment.rate, alignment.usdJpy, alignment.swap, alignment.save].map((x) => Number(x?.top));
  const heights = [alignment.date, alignment.rate, alignment.usdJpy, alignment.swap, alignment.save].map((x) => Number(x?.height));
  assert.ok(tops.every(Number.isFinite), `daily control geometry missing: ${JSON.stringify(alignment)}`);
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 1.5, `daily controls are vertically misaligned: ${JSON.stringify(alignment)}`);
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 1.5, `daily controls have inconsistent heights: ${JSON.stringify(alignment)}`);
  console.log(`daily input alignment (${browserName}): PASS`);

  await page.locator('[data-tab="risk"]').click();
  await page.waitForFunction(() => {
    const lc = window.Chart?.getChart?.(document.querySelector('#lcChart'));
    const maintenance = window.Chart?.getChart?.(document.querySelector('#maintenanceChart'));
    return !!lc?.data?.datasets?.some((dataset) => dataset.label === '日中最大ASK') &&
      !!maintenance?.data?.datasets?.some((dataset) => dataset.label === '日中最大ASK時 維持率');
  }, { timeout: 10000 });

  const risk = await page.evaluate(() => {
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
      helpers: {
        sep4: window.__DTL_WORST_ASK_AT__?.('2026-09-04'),
        sep7: window.__DTL_WORST_ASK_AT__?.('2026-09-07'),
        sep8: window.__DTL_WORST_ASK_AT__?.('2026-09-08'),
        sep8Maintenance: window.__DTL_WORST_ASK_MAINTENANCE_AT__?.('2026-09-08')
      },
      lcNote: document.querySelector('#lcChart')?.closest('.risk-chart-block')?.querySelector('.chart-title span')?.textContent || '',
      maintenanceNote: document.querySelector('#maintenanceChart')?.closest('.risk-chart-block')?.querySelector('.chart-title span')?.textContent || '',
      facts: document.querySelector('#riskFacts')?.innerText || ''
    };
  });

  assert.equal(risk.helpers.sep4, 48.4947, 'Sep 4 published high ASK missing');
  assert.equal(risk.helpers.sep7, 48.4922, 'Sep 7 published high ASK missing');
  assert.equal(risk.helpers.sep8, 48.553, 'Sep 8 published high ASK missing');
  assert.ok(Number.isFinite(risk.helpers.sep8Maintenance), 'worst-ASK maintenance helper is not finite');

  for (const [label, expected] of [['09-04',48.4947],['09-07',48.4922],['09-08',48.553]]) {
    const index = risk.labels.indexOf(label);
    assert.ok(index >= 0, `${label} missing from risk chart`);
    assert.equal(Number(risk.worstValues[index]), expected, `${label} high ASK was not plotted`);
    assert.ok(Number.isFinite(Number(risk.worstMaintenanceValues[index])), `${label} stressed maintenance missing`);
    assert.ok(
      Number(risk.worstMaintenanceValues[index]) < Number(risk.closeMaintenanceValues[index]),
      `${label} short-position stressed maintenance should be below 23:00 maintenance`
    );
  }

  assert.match(risk.lcNote, /日中最大ASK/);
  assert.match(risk.maintenanceNote, /23:00 USD\/JPY/);
  assert.match(risk.facts, /最大ASK時維持率/);
  console.log(`three published worst ASK points + stressed maintenance (${browserName}): PASS`);
} finally {
  await browser.close();
}
