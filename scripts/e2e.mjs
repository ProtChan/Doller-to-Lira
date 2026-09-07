import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[browser console error]', msg.text());
});

try {
  console.log('BROWSER=', browserName);
  console.log('TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.accountingV2 === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.swapDecimals === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseMargin === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseFeedReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryAccounting === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.calendarBreakdown === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.calendarMobileCompact === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.swapAccounting === 'fractional-internal-truncated-display', { timeout: 15000 });

  console.log('appReady=', await page.locator('html').getAttribute('data-app-ready'));
  console.log('accountingV2=', await page.locator('html').getAttribute('data-accounting-v2'));
  console.log('swapDecimals=', await page.locator('html').getAttribute('data-swap-decimals'));
  console.log('hiroseMargin=', await page.locator('html').getAttribute('data-hirose-margin'));
  console.log('hiroseFeedReady=', await page.locator('html').getAttribute('data-hirose-feed-ready'));
  console.log('hiroseHistoryReady=', await page.locator('html').getAttribute('data-hirose-history-ready'));
  console.log('hiroseHistoryAccounting=', await page.locator('html').getAttribute('data-hirose-history-accounting'));
  console.log('calendarBreakdown=', await page.locator('html').getAttribute('data-calendar-breakdown'));
  console.log('calendarMobileCompact=', await page.locator('html').getAttribute('data-calendar-mobile-compact'));
  console.log('swapAccounting=', await page.locator('html').getAttribute('data-swap-accounting'));

  const marginBands = await page.evaluate(() => ({
    at155: window.__DTL_MARGIN_PER_1000__(155),
    below1575: window.__DTL_MARGIN_PER_1000__(157.4999),
    at1575: window.__DTL_MARGIN_PER_1000__(157.5),
    below160: window.__DTL_MARGIN_PER_1000__(159.9999),
    at160: window.__DTL_MARGIN_PER_1000__(160)
  }));
  assert.deepEqual(marginBands, { at155: 6300, below1575: 6300, at1575: 6400, below160: 6400, at160: 6500 }, `Hirose margin bands are wrong: ${JSON.stringify(marginBands)}`);
  console.log('Hirose USDJPY margin bands: PASS');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  assert.match(manifestHref || '', /manifest\.webmanifest/, 'PWA manifest link is missing');
  const manifestUrl = new URL('manifest.webmanifest', targetUrl).href;
  const manifestResponse = await page.request.get(manifestUrl);
  assert.equal(manifestResponse.ok(), true, `manifest request failed: ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone', 'manifest display is not standalone');
  assert.equal(manifest.short_name, 'ドルとリラ', 'manifest short name is wrong');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.some((icon) => /icon-dollar-lira\.svg/.test(icon.src)), 'Dollar-Lira PWA icon is missing from manifest');
  const iconResponse = await page.request.get(new URL('icon-dollar-lira.svg', targetUrl).href);
  assert.equal(iconResponse.ok(), true, `PWA icon request failed: ${iconResponse.status()}`);
  assert.match(await iconResponse.text(), /\$₺/, 'PWA icon does not contain the Dollar-Lira mark');
  console.log('PWA manifest/icon: PASS');

  if (targetUrl.startsWith('https://')) {
    await page.waitForFunction(() => document.documentElement.dataset.pwaReady === '1', { timeout: 15000 });
    console.log('service worker registration: PASS');
  }

  await page.locator('[data-tab="positions"]').click();
  assert.equal(await page.locator('[data-tab="positions"]').evaluate((el) => el.classList.contains('active')), true, 'positions tab did not become active');
  assert.equal(await page.locator('#view-positions').evaluate((el) => el.classList.contains('active')), true, 'positions view did not become active');
  console.log('tab positions: PASS');

  await page.locator('#togglePositionFormBtn').click();
  assert.equal(await page.locator('#positionEditor').evaluate((el) => el.classList.contains('hidden')), false, 'position editor stayed hidden');
  console.log('position editor: PASS');

  await page.locator('#positionDate').fill('2026-09-06');
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill('48.0000');
  await page.locator('#entryLots').fill('1.23');
  await page.locator('#positionForm button[type="submit"]').click();
  assert.match(await page.locator('#positionTableBody').innerText(), /1\.23/, 'position lot was not saved');
  console.log('position save: PASS');

  await page.locator('#openSettingsBtn').click();
  assert.equal(await page.locator('#settingsDrawer').evaluate((el) => el.classList.contains('show')), true, 'settings drawer did not open');
  assert.equal(await page.locator('#settingsBackdrop').evaluate((el) => el.classList.contains('show')), true, 'settings backdrop did not open');
  assert.equal(await page.locator('#settingSwap').getAttribute('step'), 'any', 'default swap input is not arbitrary-decimal');
  assert.equal(Number(await page.locator('#settingUnits').inputValue()), 1000, 'new-install default must be 1 lot = 1,000 units');
  console.log('default 1 lot = 1,000 units: PASS');

  assert.equal(await page.locator('#settingSwapMode').count(), 1, 'Hirose swap mode setting is missing');
  await page.locator('#settingSwapMode').selectOption('hirose');
  assert.equal(await page.locator('html').getAttribute('data-swap-input-mode'), 'hirose', 'Hirose swap mode was not activated');
  assert.match(await page.locator('#hiroseFeedStatus').innerText(), /USD\/TRY公式データ/, 'Hirose feed status is missing');

  const historyCheck = await page.evaluate(() => {
    const rows = window.__DTL_HIROSE_HISTORY__?.() || [];
    return {
      start: document.documentElement.dataset.hiroseHistoryStart,
      records: Number(document.documentElement.dataset.hiroseHistoryRecords || 0),
      first: rows[0] || null,
      july1to3Short: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-01', side: 'short', lots: 1 }, '2026-07-03')
    };
  });
  assert.equal(historyCheck.start, '2026-07-01', `Hirose history did not start on 2026-07-01: ${historyCheck.start}`);
  assert.ok(historyCheck.records >= 47, `Hirose history is unexpectedly short: ${historyCheck.records}`);
  assert.equal(historyCheck.first?.date, '2026-07-01', 'first Hirose historical row is missing');
  assert.equal(historyCheck.first?.sellJpy, 116.3, '2026-07-01 Hirose sell swap is wrong');
  assert.ok(Math.abs(historyCheck.july1to3Short - 580) < 1e-9, `Hirose auto history did not accrue all July 1-3 rows at 1,000 units: ${historyCheck.july1to3Short}`);
  console.log('Hirose history 2026-07-01 onward + multi-day accrual: PASS');

  assert.equal(await page.locator('#openBackupFromSettingsBtn').isVisible(), true, 'mobile backup button is not visible at phone viewport');
  await page.locator('#openBackupFromSettingsBtn').click();
  assert.equal(await page.locator('#settingsDrawer').evaluate((el) => el.classList.contains('show')), false, 'settings drawer did not close when opening mobile backup');
  assert.equal(await page.locator('#backupDialog').evaluate((el) => el.open), true, 'backup dialog did not open from mobile settings');
  assert.equal(await page.locator('#exportJsonBtn').isVisible(), true, 'JSON backup action is not visible on mobile');
  assert.equal(await page.locator('#exportCsvBtn').isVisible(), true, 'CSV backup action is not visible on mobile');
  assert.equal(await page.locator('#importJsonInput').count(), 1, 'JSON restore input is missing on mobile');
  console.log('mobile backup access: PASS');
  await page.locator('#closeBackupBtn').click();
  assert.equal(await page.locator('#backupDialog').evaluate((el) => el.open), false, 'backup dialog did not close');

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#view-daily').evaluate((el) => el.classList.contains('active')), true, 'daily view did not become active');
  assert.equal(await page.locator('#dailyUsdJpy').count(), 1, 'USD/JPY input is missing');
  assert.equal(await page.locator('#dailyTryJpy').count(), 0, 'legacy TRY/JPY input is still visible in daily form');
  assert.equal(await page.locator('#dailySwap').getAttribute('step'), 'any', 'daily swap input is not arbitrary-decimal');

  // Past official rows are available immediately in Hirose auto mode at the 1,000-unit default.
  await page.locator('#dailyDate').fill('2026-07-01');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(await page.locator('#dailySwap').isEditable(), false, 'Hirose auto swap input should be read-only');
  assert.equal(Number(await page.locator('#dailySwap').inputValue()), 116.3, '2026-07-01 Hirose history was not applied at the 1,000-unit default');
  console.log('Hirose historical auto-fill 2026-07-01: PASS');

  // 2026-09-03 official sell swap is 473.94 JPY per 1,000 USD.
  await page.locator('#dailyDate').fill('2026-09-03');
  await page.locator('#dailyDate').dispatchEvent('change');
  assert.equal(await page.locator('#dailySwap').isEditable(), false, 'Hirose auto swap input should be read-only');
  assert.equal(Number(await page.locator('#dailySwap').inputValue()), 473.94, 'Hirose auto swap was not kept on the 1,000-unit lot scale');
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /4日分/, 'Hirose rollover day count is not shown');
  console.log('Hirose USDTRY auto swap 473.94 / 1,000 units: PASS');

  // Return to manual mode for fractional accounting / display truncation test.
  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('manual');
  await page.locator('#closeSettingsBtn').click();
  assert.equal(await page.locator('html').getAttribute('data-swap-input-mode'), 'manual', 'manual swap mode was not restored');

  await page.locator('#dailyDate').fill('2026-09-08');
  await page.locator('#dailyRate').fill('48.0000');
  await page.locator('#dailyUsdJpy').fill('158.400');
  await page.locator('#dailySwap').fill('100.78901');
  await page.locator('#dailyForm button[type="submit"]').click();

  const stored = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = state.daily.find((d) => d.date === '2026-09-08');
    return {
      row,
      swapSnapshot: window.__DTL_SWAP_SNAPSHOT__?.() || null,
      swapText: document.getElementById('kpiSwap')?.textContent || '',
      dailySwapText: document.getElementById('kpiSwapDaily')?.textContent || '',
      marginText: document.getElementById('kpiMargin')?.textContent || '',
      tableText: document.getElementById('dailyTableBody')?.innerText || ''
    };
  });
  assert.equal(stored.row.usdJpy, 158.4, 'USD/JPY was not saved');
  assert.ok(Math.abs(stored.row.tryJpy - 3.3) < 1e-10, `TRY/JPY was not derived correctly: ${stored.row.tryJpy}`);
  assert.equal(stored.row.swapPerLot, 100.78901, 'swap-per-lot decimal value was not preserved');
  assert.ok(stored.swapSnapshot, 'precise swap snapshot helper is missing');
  assert.ok(Math.abs(stored.swapSnapshot.dailySwap - 123.9704823) < 1e-9, `daily swap lost fractional precision: ${stored.swapSnapshot.dailySwap}`);
  assert.ok(Math.abs(stored.swapSnapshot.cumulativeSwap - 123.9704823) < 1e-9, `cumulative swap lost fractional precision: ${stored.swapSnapshot.cumulativeSwap}`);
  assert.match(stored.swapText, /¥123/, `cumulative swap display should truncate to ¥123: ${stored.swapText}`);
  assert.match(stored.dailySwapText, /¥123\/日/, `daily swap display should truncate to ¥123/day: ${stored.dailySwapText}`);
  assert.match(stored.marginText, /¥7,872/, `1.23 lot at 1,000 units/lot and USDJPY 158.4 should require ¥7,872: ${stored.marginText}`);
  assert.match(stored.tableText, /100\.78901/, 'swap-per-lot decimals are not displayed in daily table');
  assert.match(stored.tableText, /158\.4/, 'USD/JPY is not displayed in daily table');
  assert.match(stored.tableText, /3\.3000/, 'calculated TRY/JPY is not displayed in daily table');
  console.log('USDJPY -> TRYJPY derivation: PASS');
  console.log('swap 100.78901 x 1.23 -> internal 123.9704823 / display ¥123: PASS');
  console.log('margin 6400/1000 x 1230 units -> 7872 yen: PASS');

  // Add a second day with an FX move; at the 1,000-unit default the phone calendar
  // remains in full-yen display because these values stay below 10,000 yen.
  await page.locator('#dailyDate').fill('2026-09-09');
  await page.locator('#dailyRate').fill('47.0000');
  await page.locator('#dailyUsdJpy').fill('158.400');
  await page.locator('#dailySwap').fill('100.78901');
  await page.locator('#dailyForm button[type="submit"]').click();

  await page.locator('[data-tab="calendar"]').click();
  assert.equal(await page.locator('#view-calendar').evaluate((el) => el.classList.contains('active')), true, 'calendar view did not become active');
  const weekdayTexts = await page.locator('.calendar-weekdays span').allTextContents();
  assert.deepEqual(weekdayTexts, ['日','月','火','水','木','金','土'], `calendar weekdays are not Sunday-first: ${weekdayTexts.join(',')}`);
  const leadingEmpty = await page.locator('#calendarGrid > .calendar-day.empty').evaluateAll((els) => {
    let count = 0;
    for (const el of els) {
      if (el.previousElementSibling && !el.previousElementSibling.classList.contains('empty')) break;
      count++;
    }
    return count;
  });
  assert.equal(leadingEmpty, 2, `September 2026 should have 2 leading cells in Sunday-first calendar, got ${leadingEmpty}`);

  const sep8 = page.locator('.calendar-day[data-date="2026-09-08"]');
  assert.equal(await sep8.count(), 1, 'September 8 calendar cell is missing');
  assert.equal(await sep8.locator('.calendar-label-mobile').nth(0).innerText(), 'F', 'mobile FX label is not compact');
  assert.equal(await sep8.locator('.calendar-label-mobile').nth(1).innerText(), 'S', 'mobile SWAP label is not compact');
  assert.match(await sep8.innerText(), /¥123/, 'small mobile calendar values should truncate sub-yen fractions');

  const sep9 = page.locator('.calendar-day[data-date="2026-09-09"]');
  assert.equal(await sep9.count(), 1, 'September 9 calendar cell is missing');
  const mobileValues = await sep9.locator('.calendar-value-mobile').allTextContents();
  assert.ok(mobileValues.some((v) => /¥4,269/.test(v)), `mobile NET should remain full yen below 10,000: ${mobileValues.join(' | ')}`);
  assert.ok(mobileValues.some((v) => /¥4,145/.test(v)), `mobile FX should remain full yen below 10,000: ${mobileValues.join(' | ')}`);
  assert.ok(mobileValues.some((v) => /¥123/.test(v)), `mobile swap under 10,000 should truncate to full yen: ${mobileValues.join(' | ')}`);
  assert.equal(await sep9.locator('.calendar-value-mobile').first().isVisible(), true, 'mobile compact calendar value is not visible on phone');
  assert.equal(await sep9.locator('.calendar-value-desktop').first().isVisible(), false, 'desktop full calendar value is visible on phone');
  console.log('mobile calendar 1,000-unit values: PASS');

  // Desktop keeps full-yen calendar representation while truncating sub-yen fractions.
  await page.setViewportSize({ width: 1200, height: 900 });
  assert.equal(await sep9.locator('.calendar-value-desktop').first().isVisible(), true, 'desktop full calendar value is not visible at desktop width');
  assert.equal(await sep9.locator('.calendar-value-mobile').first().isVisible(), false, 'mobile compact calendar value is visible at desktop width');
  const desktopValues = await sep9.locator('.calendar-value-desktop').allTextContents();
  assert.ok(desktopValues.some((v) => /¥4,269/.test(v)), `desktop NET should remain full yen: ${desktopValues.join(' | ')}`);
  assert.ok(desktopValues.some((v) => /¥4,145/.test(v)), `desktop FX should truncate sub-yen fraction: ${desktopValues.join(' | ')}`);
  console.log('desktop calendar full values preserved: PASS');

  await page.locator('[data-tab="risk"]').click();
  assert.equal(await page.locator('#view-risk').evaluate((el) => el.classList.contains('active')), true, 'risk view did not become active');
  assert.match(await page.locator('#riskFacts').innerText(), /¥6,400\/千通貨/, 'risk view does not show Hirose per-1000 margin band');
  console.log('risk margin band display: PASS');
  console.log('daily/calendar/risk tabs: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`REAL DOM E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
