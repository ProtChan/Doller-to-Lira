import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });

try {
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
  console.log(`publisher issue payload (${browserName}): PASS`);
  await publisher.close();

  const page = await context.newPage();
  await page.route('**/data/hirose-ask-close-23.json*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const row = data.history.find((item) => item.date === '2026-09-08');
    if (row) row.usdTryAskDayHigh = 48.9;
    await route.fulfill({ response, json: data });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.worstAskRisk === '1', { timeout: 15000 });

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#openRatePublisherBtn').innerText(), 'ヒロセレート配信');

  await page.locator('[data-tab="risk"]').click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#lcChart');
    const chart = window.Chart?.getChart?.(canvas);
    return !!chart?.data?.datasets?.some((dataset) => dataset.label === '日中最大ASK');
  }, { timeout: 10000 });

  const risk = await page.evaluate(() => {
    const chart = Chart.getChart(document.querySelector('#lcChart'));
    const worst = chart.data.datasets.find((dataset) => dataset.label === '日中最大ASK');
    return {
      helper: window.__DTL_WORST_ASK_AT__?.('2026-09-08'),
      values: worst?.data || [],
      note: document.querySelector('#lcChart')?.closest('.risk-chart-block')?.querySelector('.chart-title span')?.textContent || ''
    };
  });
  assert.equal(risk.helper, 48.9, 'worst ASK helper did not expose published high');
  assert.ok(risk.values.some((value) => Number(value) === 48.9), 'LC chart did not plot published worst ASK');
  assert.match(risk.note, /日中最大ASK/);
  console.log(`worst ASK LC overlay (${browserName}): PASS`);
} finally {
  await browser.close();
}
