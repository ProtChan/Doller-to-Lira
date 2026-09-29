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

// Keep one critical provider feed slow enough to prove that the loading screen is
// tied to real readiness rather than a fixed splash timeout.
await context.route(/\/data\/hirose-usdtry-margin\.json/, async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await route.continue();
});

try {
  console.log('STARTUP BROWSER=', browserName);
  console.log('STARTUP TEST_URL=', targetUrl);

  await page.goto(targetUrl, { waitUntil:'domcontentloaded' });

  const loading = page.locator('#appLoadingScreen');
  assert.equal(await loading.count(), 1, 'startup loading screen missing');
  assert.equal(await loading.isVisible(), true, 'loading screen disappeared before delayed critical data settled');
  assert.notEqual(await page.locator('html').getAttribute('data-startup-ready'), '1', 'startup marked ready while a critical feed was delayed');

  await page.waitForFunction(() => document.documentElement.dataset.startupReady === '1', { timeout:15000 });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('appLoadingScreen');
    return !overlay || overlay.hidden || overlay.getAttribute('aria-hidden') === 'true';
  }, { timeout:3000 });

  const visible = await page.evaluate(() => {
    const chart = charts?.overviewChart || window.Chart?.getChart?.(document.getElementById('overviewChart'));
    return {
      total:document.getElementById('kpiTotalPnl')?.textContent?.trim() || '',
      snapshot:document.getElementById('latestSnapshotLabel')?.textContent?.trim() || '',
      chart:Boolean(chart),
      chartPoints:Number(chart?.data?.labels?.length || 0),
      canvasWidth:Number(chart?.canvas?.width || 0),
      canvasHeight:Number(chart?.canvas?.height || 0),
      diag:window.__DTL_STARTUP_DIAGNOSTICS__?.() || null
    };
  });

  assert.notEqual(visible.total, '—', 'KPI placeholder survived startup gate');
  assert.ok(visible.snapshot && visible.snapshot !== '日次データ未入力', 'latest snapshot label not ready');
  assert.equal(visible.chart, true, 'overview chart was not created before loader dismissal');
  assert.ok(visible.chartPoints > 0, 'overview chart has no data before loader dismissal');
  assert.ok(visible.canvasWidth > 0 && visible.canvasHeight > 0, 'overview chart canvas has no rendered size');
  assert.ok(visible.diag?.ready, 'startup diagnostics did not mark ready');
  assert.ok(Number(visible.diag?.startupMs || 0) >= 250, 'readiness ignored the intentionally delayed provider feed');
  assert.ok(Number(visible.diag?.startupMs || 0) < 15000, 'startup exceeded readiness timeout');

  console.log('STARTUP DIAGNOSTICS=', JSON.stringify(visible.diag));

  const actionable = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionable.length) throw new Error(`Browser page errors: ${actionable.join(' | ')}`);
  console.log(`STARTUP READINESS E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
