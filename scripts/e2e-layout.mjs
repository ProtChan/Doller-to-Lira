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
  await mobile.waitForFunction(() => document.documentElement.dataset.mobileDailyNormalized === '1', { timeout: 15000 });
  await mobile.locator('[data-tab="daily"]').click();
  const mobileLayout = await mobile.evaluate(() => {
    const form = document.getElementById('dailyForm');
    const view = document.getElementById('view-daily');
    const tableWrap = document.querySelector('#view-daily .daily-table-wrap');
    const inputs = [...form.querySelectorAll('input')].map((el) => el.getBoundingClientRect());
    const button = form.querySelector('button[type="submit"]').getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    const wrapRect = tableWrap.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      formLeft: formRect.left,
      formRight: formRect.right,
      viewLeft: viewRect.left,
      viewRight: viewRect.right,
      wrapLeft: wrapRect.left,
      wrapRight: wrapRect.right,
      inputWidths: inputs.map((r) => r.width),
      buttonWidth: button.width,
      gridColumns: getComputedStyle(form).gridTemplateColumns,
    };
  });
  assert.ok(mobileLayout.htmlScrollWidth <= mobileLayout.innerWidth + 1, `mobile html overflows: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.bodyScrollWidth <= mobileLayout.innerWidth + 1, `mobile body overflows: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.formLeft >= -0.5 && mobileLayout.formRight <= mobileLayout.innerWidth + 0.5, `daily form leaves viewport: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.wrapRight <= mobileLayout.innerWidth + 0.5, `daily table wrapper leaves viewport: ${JSON.stringify(mobileLayout)}`);
  assert.ok(mobileLayout.inputWidths.every((width) => width > 100 && width < 200), `daily mobile inputs have abnormal scale: ${mobileLayout.inputWidths.join(',')}`);
  assert.ok(mobileLayout.buttonWidth > 300, `daily save button should span mobile form: ${mobileLayout.buttonWidth}`);
  console.log('mobile Daily Input width/scale: PASS');
  await mobile.close();

  const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await desktop.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await desktop.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await desktop.waitForFunction(() => document.documentElement.dataset.desktopViewportCompact === '1', { timeout: 15000 });

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
  await checkPanel('daily', '#view-daily .daily-table-wrap', 'daily history panel');
  await checkPanel('risk', '#view-risk .risk-grid', 'risk chart panel');
  console.log('1366x768 primary panels fit viewport: PASS');
  await desktop.close();

  console.log(`LAYOUT E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
