import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });

try {
  console.log('LAYOUT BROWSER=', browserName);
  console.log('LAYOUT TEST_URL=', targetUrl);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await mobile.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await mobile.waitForFunction(() => document.documentElement.dataset.dailyDataService === '1', { timeout: 15000 });
  await mobile.locator('[data-tab="daily"]').click();
  const mobileLayout = await mobile.evaluate(() => {
    const view = document.getElementById('view-daily');
    const wrap = document.querySelector('#view-daily .daily-table-wrap');
    const viewRect = view.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewLeft: viewRect.left,
      viewRight: viewRect.right,
      wrapLeft: wrapRect.left,
      wrapRight: wrapRect.right,
      formVisible: !!(document.getElementById('dailyForm')?.offsetParent),
      deleteButtons: document.querySelectorAll('#dailyTableBody [data-delete-daily]').length
    };
  });
  assert.ok(mobileLayout.htmlScrollWidth <= mobileLayout.innerWidth + 1, `mobile html overflows: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.bodyScrollWidth <= mobileLayout.innerWidth + 1, `mobile body overflows: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.viewLeft >= -0.5 && mobileLayout.viewRight <= mobileLayout.innerWidth + 0.5, `Daily Data view leaves viewport: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.wrapRight <= mobileLayout.innerWidth + 0.5, `Daily Data table wrapper leaves viewport: ${JSON.stringify(mobileLayout)}`);
  assert.equal(mobileLayout.formVisible, false, 'daily editor must stay hidden on mobile');
  assert.equal(mobileLayout.deleteButtons, 0, 'read-only daily rows must have no delete controls');
  console.log('mobile Daily Data read-only layout: PASS');
  await mobile.close();

  const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await desktop.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await desktop.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await desktop.waitForFunction(() => document.documentElement.dataset.desktopViewportCompact === '1', { timeout: 15000 });
  await desktop.waitForFunction(() => document.documentElement.dataset.dailyDataService === '1', { timeout: 15000 });

  const checkPanel = async (tab, selector, label) => {
    await desktop.locator(`[data-tab="${tab}"]`).click();
    const rect = await desktop.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top:r.top, bottom:r.bottom, height:r.height, innerHeight:window.innerHeight, scrollWidth:document.documentElement.scrollWidth, innerWidth:window.innerWidth };
    });
    assert.ok(rect.bottom <= rect.innerHeight + 1, `${label} requires page scroll at 1366x768: ${JSON.stringify(rect)}`);
    assert.ok(rect.scrollWidth <= rect.innerWidth + 1, `${label} causes horizontal page overflow: ${JSON.stringify(rect)}`);
  };

  await checkPanel('overview', '#view-overview .overview-layout', 'overview main panel');
  await checkPanel('positions', '#view-positions .positions-layout', 'positions panel');
  await checkPanel('daily', '#view-daily .daily-table-wrap', 'Daily Data history panel');
  await checkPanel('risk', '#view-risk .risk-grid', 'risk chart panel');

  await desktop.locator('[data-tab="daily"]').click();
  assert.equal(await desktop.locator('#dailyForm').isVisible(), false, 'desktop daily editor must stay hidden');
  assert.equal(await desktop.locator('#dailyTableBody [data-delete-daily]').count(), 0, 'desktop Daily Data must be read-only');
  console.log('1366x768 primary panels + read-only Daily Data fit viewport: PASS');
  await desktop.close();

  console.log(`LAYOUT E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
