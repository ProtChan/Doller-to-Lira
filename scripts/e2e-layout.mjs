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

  // The desktop restoration must not leak into the current smartphone calendar.
  await mobile.locator('[data-tab="calendar"]').click();
  const mobileCalendar = await mobile.evaluate(() => {
    const panel = document.getElementById('view-calendar');
    const grid = document.getElementById('calendarGrid');
    const day = grid.querySelector('.calendar-day:not(.empty)');
    const panelStyle = getComputedStyle(panel);
    const gridStyle = getComputedStyle(grid);
    const dayStyle = getComputedStyle(day);
    return {
      panelRadius: panelStyle.borderTopLeftRadius,
      panelBorder: panelStyle.borderTopWidth,
      gap: gridStyle.columnGap,
      dayRadius: dayStyle.borderTopLeftRadius,
      dayBorder: dayStyle.borderTopWidth,
      dayMinHeight: dayStyle.minHeight,
      dayPaddingTop: dayStyle.paddingTop,
      dayPaddingRight: dayStyle.paddingRight,
    };
  });
  assert.equal(mobileCalendar.panelRadius, '0px', `desktop calendar panel styling leaked into mobile: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.panelBorder, '0px', `desktop calendar panel border leaked into mobile: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.gap, '1px', `mobile calendar grid gap changed: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.dayRadius, '0px', `mobile calendar day radius changed: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.dayBorder, '0px', `mobile calendar day border changed: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.dayMinHeight, '94px', `mobile calendar day height changed: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.dayPaddingTop, '6px', `mobile calendar vertical padding changed: ${JSON.stringify(mobileCalendar)}`);
  assert.equal(mobileCalendar.dayPaddingRight, '4px', `mobile calendar horizontal padding changed: ${JSON.stringify(mobileCalendar)}`);
  console.log('mobile calendar current design preserved: PASS');
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

  await desktop.locator('[data-tab="calendar"]').click();
  const desktopCalendar = await desktop.evaluate(() => {
    const panel = document.getElementById('view-calendar');
    const grid = document.getElementById('calendarGrid');
    const day = grid.querySelector('.calendar-day:not(.empty)');
    const monthButton = document.getElementById('prevMonthBtn');
    const panelStyle = getComputedStyle(panel);
    const gridStyle = getComputedStyle(grid);
    const dayStyle = getComputedStyle(day);
    const buttonStyle = getComputedStyle(monthButton);
    return {
      marker: document.documentElement.dataset.calendarDesktopStyle,
      panelRadius: panelStyle.borderTopLeftRadius,
      panelBorder: panelStyle.borderTopWidth,
      panelPadding: panelStyle.paddingTop,
      gap: gridStyle.columnGap,
      gridBackground: gridStyle.backgroundColor,
      dayRadius: dayStyle.borderTopLeftRadius,
      dayBorder: dayStyle.borderTopWidth,
      dayMinHeight: dayStyle.minHeight,
      dayPadding: dayStyle.paddingTop,
      buttonWidth: buttonStyle.width,
      buttonHeight: buttonStyle.height,
      buttonRadius: buttonStyle.borderTopLeftRadius,
    };
  });
  assert.equal(desktopCalendar.marker, 'pre-20260905-rounded-cards', `historical desktop marker missing: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.panelRadius, '22px', `desktop calendar panel radius is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.panelBorder, '1px', `desktop calendar panel border is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.panelPadding, '20px', `desktop calendar panel padding is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.gap, '7px', `desktop calendar grid gap is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.dayRadius, '14px', `desktop calendar day radius is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.dayBorder, '1px', `desktop calendar day border is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.dayMinHeight, '92px', `desktop calendar day height is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.dayPadding, '10px', `desktop calendar day padding is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.buttonWidth, '36px', `desktop calendar month button width is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.buttonHeight, '36px', `desktop calendar month button height is not historical: ${JSON.stringify(desktopCalendar)}`);
  assert.equal(desktopCalendar.buttonRadius, '11px', `desktop calendar month button radius is not historical: ${JSON.stringify(desktopCalendar)}`);
  console.log('pre-2026-09-05 desktop calendar card design restored: PASS');
  await desktop.close();

  console.log(`LAYOUT E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
