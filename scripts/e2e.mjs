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
  await page.waitForFunction(() => document.documentElement.dataset.calendarBreakdown === '1', { timeout: 15000 });

  console.log('appReady=', await page.locator('html').getAttribute('data-app-ready'));
  console.log('accountingV2=', await page.locator('html').getAttribute('data-accounting-v2'));
  console.log('swapDecimals=', await page.locator('html').getAttribute('data-swap-decimals'));
  console.log('calendarBreakdown=', await page.locator('html').getAttribute('data-calendar-breakdown'));

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

  await page.locator('#dailyDate').fill('2026-09-06');
  await page.locator('#dailyRate').fill('48.0000');
  await page.locator('#dailyUsdJpy').fill('158.400');
  await page.locator('#dailySwap').fill('100.78901');
  await page.locator('#dailyForm button[type="submit"]').click();

  const stored = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = state.daily.find((d) => d.date === '2026-09-06');
    return { row, swapText: document.getElementById('kpiSwap')?.textContent || '', dailySwapText: document.getElementById('kpiSwapDaily')?.textContent || '', tableText: document.getElementById('dailyTableBody')?.innerText || '' };
  });
  assert.equal(stored.row.usdJpy, 158.4, 'USD/JPY was not saved');
  assert.ok(Math.abs(stored.row.tryJpy - 3.3) < 1e-10, `TRY/JPY was not derived correctly: ${stored.row.tryJpy}`);
  assert.equal(stored.row.swapPerLot, 100.78901, 'swap-per-lot decimal value was not preserved');
  assert.match(stored.swapText, /¥123/, `cumulative swap should be truncated to ¥123: ${stored.swapText}`);
  assert.match(stored.dailySwapText, /¥123\/日/, `daily swap should be truncated to ¥123/day: ${stored.dailySwapText}`);
  assert.match(stored.tableText, /100\.78901/, 'swap-per-lot decimals are not displayed in daily table');
  assert.match(stored.tableText, /158\.4/, 'USD/JPY is not displayed in daily table');
  assert.match(stored.tableText, /3\.3000/, 'calculated TRY/JPY is not displayed in daily table');
  console.log('USDJPY -> TRYJPY derivation: PASS');
  console.log('swap 100.78901 x 1.23 -> 123 yen truncation: PASS');

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
  const sep6 = page.locator('.calendar-day[data-date="2026-09-06"]');
  assert.equal(await sep6.count(), 1, 'September 6 calendar cell is missing');
  const sep6Text = await sep6.innerText();
  assert.match(sep6Text, /NET/i, 'calendar cell does not show NET');
  assert.match(sep6Text, /FX/i, 'calendar cell does not show FX');
  assert.match(sep6Text, /SWAP/i, 'calendar cell does not show SWAP');
  assert.match(sep6Text, /¥123/, `calendar cell does not show daily swap/net ¥123: ${sep6Text}`);
  assert.match(sep6Text, /¥0/, `calendar cell does not show daily FX ¥0: ${sep6Text}`);
  console.log('Sunday-first calendar: PASS');
  console.log('calendar Net / FX / Swap breakdown: PASS');

  await page.locator('[data-tab="risk"]').click();
  assert.equal(await page.locator('#view-risk').evaluate((el) => el.classList.contains('active')), true, 'risk view did not become active');
  console.log('daily/calendar/risk tabs: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`REAL DOM E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
