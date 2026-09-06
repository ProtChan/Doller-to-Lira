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

  console.log('appReady=', await page.locator('html').getAttribute('data-app-ready'));
  console.log('accountingV2=', await page.locator('html').getAttribute('data-accounting-v2'));
  console.log('swapDecimals=', await page.locator('html').getAttribute('data-swap-decimals'));

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
  console.log('settings open: PASS');
  await page.locator('#closeSettingsBtn').click();
  assert.equal(await page.locator('#settingsDrawer').evaluate((el) => el.classList.contains('show')), false, 'settings drawer did not close');
  console.log('settings close: PASS');

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

  await page.locator('[data-tab="risk"]').click();
  assert.equal(await page.locator('#view-risk').evaluate((el) => el.classList.contains('active')), true, 'risk view did not become active');
  console.log('daily/risk tabs: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`REAL DOM E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
