import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless:true });
const context = await browser.newContext({
  viewport:{ width:390, height:844 },
  isMobile:true,
  serviceWorkers:'block'
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

// Hold one critical feed briefly, while intentionally making optional margin/chart
// resources much slower. Startup must wait for Swap, but it must not wait for the
// optional resources before exposing usable KPI values.
let swapReleased = false;
let marginReleased = false;
let chartReleased = false;
await context.route(/\/data\/hirose-usdtry-swap\.json/, async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  swapReleased = true;
  await route.continue();
});
await context.route(/\/data\/hirose-usdtry-margin\.json/, async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  marginReleased = true;
  await route.continue();
});
await context.route(/chart\.umd\.min\.js/, async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  chartReleased = true;
  await route.continue();
});

try {
  console.log('STARTUP BROWSER=', browserName);
  console.log('STARTUP TEST_URL=', targetUrl);

  await page.goto(targetUrl, { waitUntil:'domcontentloaded' });

  const loading = page.locator('#appLoadingScreen');
  assert.equal(await loading.count(), 1, 'startup loading screen missing');
  assert.equal(await loading.isVisible(), true, 'loading screen disappeared before delayed critical Swap settled');
  assert.equal(swapReleased, false, 'critical Swap delay fixture released too early');
  assert.notEqual(await page.locator('html').getAttribute('data-startup-ready'), '1', 'startup marked ready while critical Swap was delayed');

  await page.waitForFunction(() => document.documentElement.dataset.startupReady === '1', { timeout:15000 });
  assert.equal(swapReleased, true, 'startup became ready before critical Swap settled');
  assert.equal(marginReleased, false, 'startup incorrectly waited for optional margin feed');
  assert.equal(chartReleased, false, 'startup incorrectly waited for optional Chart.js');

  await page.waitForFunction(() => {
    const overlay = document.getElementById('appLoadingScreen');
    return !overlay || overlay.hidden || overlay.getAttribute('aria-hidden') === 'true';
  }, { timeout:3000 });

  const visible = await page.evaluate(() => ({
    total:document.getElementById('kpiTotalPnl')?.textContent?.trim() || '',
    snapshot:document.getElementById('latestSnapshotLabel')?.textContent?.trim() || '',
    marginReady:document.documentElement.dataset.hiroseMarginReady === '1',
    chartLibrary:typeof window.Chart !== 'undefined',
    diag:window.__DTL_STARTUP_DIAGNOSTICS__?.() || null
  }));

  assert.notEqual(visible.total, '—', 'KPI placeholder survived startup gate');
  assert.ok(visible.snapshot && visible.snapshot !== '日次データ未入力', 'latest snapshot label not ready');
  assert.equal(visible.marginReady, false, 'optional margin feed was required for first usable paint');
  assert.equal(visible.chartLibrary, false, 'optional chart library was required for first usable paint');
  assert.ok(visible.diag?.ready, 'startup diagnostics did not mark ready');
  assert.ok(Number(visible.diag?.startupMs || 0) < 2000, 'startup waited for a deliberately slow optional resource');

  // Optional resources must still hydrate correctly after the application is usable.
  await page.waitForFunction(() => document.documentElement.dataset.hiroseMarginReady === '1', { timeout:5000 });
  await page.waitForFunction(() => {
    const chart = charts?.overviewChart || window.Chart?.getChart?.(document.getElementById('overviewChart'));
    return Boolean(chart && Number(chart?.data?.labels?.length || 0) > 0 && chart.canvas?.width > 0 && chart.canvas?.height > 0);
  }, { timeout:5000 });

  const hydrated = await page.evaluate(() => {
    const chart = charts?.overviewChart || window.Chart?.getChart?.(document.getElementById('overviewChart'));
    return {
      chart:Boolean(chart),
      chartPoints:Number(chart?.data?.labels?.length || 0),
      canvasWidth:Number(chart?.canvas?.width || 0),
      canvasHeight:Number(chart?.canvas?.height || 0),
      diag:window.__DTL_STARTUP_DIAGNOSTICS__?.() || null
    };
  });
  assert.equal(hydrated.chart, true, 'overview chart did not hydrate after loader dismissal');
  assert.ok(hydrated.chartPoints > 0, 'hydrated overview chart has no data');
  assert.ok(hydrated.canvasWidth > 0 && hydrated.canvasHeight > 0, 'hydrated chart canvas has no rendered size');

  console.log('STARTUP DIAGNOSTICS=', JSON.stringify(hydrated.diag));

  const actionable = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionable.length) throw new Error(`Browser page errors: ${actionable.join(' | ')}`);
  console.log(`STARTUP READINESS E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
