import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const displayDate = '2026-09-04';
const sourceDate = '2026-09-03';

try {
  console.log('VALUATION BROWSER=', browserName);
  console.log('VALUATION TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.sameDaySwapValuation === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="daily"]').click();

  assert.equal(await page.locator('#dailyValuationTryJpy').count(), 1, 'daily valuation conversion input is missing');
  assert.equal(await page.locator('#quickDailyValuationTryJpy').count(), 1, 'quick valuation conversion input is missing');

  await page.locator('#dailyDate').fill(displayDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) > 400, { timeout: 5000 });
  assert.ok(Math.abs(Number(await page.locator('#dailySwap').inputValue()) - 473.94) < 1e-9, 'Sep 3 four-day broker row must display on Sep 4');
  const swapNote = await page.locator('#dailySwap').locator('xpath=..').innerText();
  assert.match(swapNote, /2026-09-03表記.*2026-09-04表示/, 'shifted source/display note is missing');
  assert.match(swapNote, /4日分/, 'multi-day swap note is missing');

  const synthetic = Number(await page.locator('#dailyValuationTryJpy').inputValue());
  assert.ok(synthetic > 0, 'synthetic TRY/JPY fallback was not filled');

  const customConversion = 3.141592;
  await page.locator('#dailyValuationTryJpy').fill(String(customConversion));
  await page.locator('#dailyForm button[type="submit"]').click();

  const saved = await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return state.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.ok(saved, 'September 4 display row was not saved');
  assert.equal(saved.valuationTryJpy, customConversion, 'manual broker TRY/JPY conversion was not persisted');
  assert.equal(saved.valuationTryJpySource, 'manual');
  assert.equal(saved.swapSourceDate, sourceDate);
  assert.equal(saved.swapCreditDate, displayDate);
  assert.equal(saved.swapSourceDays, 4);
  assert.equal(saved.swapPerLot, 473.94);

  const derived = await page.evaluate((date) => {
    const row = derivedDaily().find((item) => item.date === date);
    return row ? {
      tryJpy: row.tryJpy,
      valuationTryJpySource: row.valuationTryJpySource,
      swapSourceDate: row.swapSourceDate,
      swapCreditDate: row.swapCreditDate,
      swapSourceDays: row.swapSourceDays
    } : null;
  }, displayDate);
  assert.ok(derived, 'derived September 4 row is missing');
  assert.ok(Math.abs(Number(derived.tryJpy) - customConversion) < 1e-9, `derived valuation did not use manual conversion: ${derived.tryJpy}`);
  assert.equal(derived.valuationTryJpySource, 'manual');
  assert.equal(derived.swapSourceDate, sourceDate);
  assert.equal(derived.swapCreditDate, displayDate);
  assert.equal(derived.swapSourceDays, 4);

  const conversionCell = page.locator('#dailyTableBody tr').filter({ hasText: displayDate }).locator('td').nth(3);
  assert.match(await conversionCell.innerText(), /実測/, 'daily table must distinguish actual/manual TRY/JPY conversion');
  const swapCell = page.locator('#dailyTableBody tr').filter({ hasText: displayDate }).locator('td').nth(4);
  assert.match(await swapCell.innerText(), /4日分/, 'daily table must show multi-day swap badge on the display date');

  await page.locator('[data-tab="calendar"]').click();
  const september4 = page.locator(`.calendar-day[data-date="${displayDate}"]`);
  assert.equal(await september4.count(), 1, 'September 4 calendar cell is missing');
  assert.match(await september4.innerText(), /S×4/, 'calendar must mark the four-day swap on September 4 display date');

  await page.locator('[data-tab="daily"]').click();
  const resetState = async () => page.evaluate(() => {
    const formDate = document.querySelector('#dailyDate')?.value || '';
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = state.daily.find((item) => item.date === formDate) || null;
    const input = document.querySelector('#dailyValuationTryJpy');
    return {
      formDate,
      rate: document.querySelector('#dailyRate')?.value || '',
      usdJpy: document.querySelector('#dailyUsdJpy')?.value || '',
      conversion: input?.value || '',
      conversionSource: input?.dataset.conversionSource || '',
      finalGuard: document.documentElement.dataset.valuationSaveFinal || '',
      row
    };
  });
  console.log('SYNTHETIC RESET BEFORE=', JSON.stringify(await resetState()));
  await page.locator('[data-synthetic-conversion="daily"]').click();
  await page.waitForTimeout(50);
  console.log('SYNTHETIC RESET AFTER=', JSON.stringify(await resetState()));
  const reverted = Number(await page.locator('#dailyValuationTryJpy').inputValue());
  assert.ok(reverted > 0 && Math.abs(reverted - customConversion) > 1e-6, 'synthetic reset did not replace manual conversion');
  await page.locator('#dailyForm button[type="submit"]').click();
  const revertedSaved = await page.evaluate((date) => {
    const state = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return state.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.equal('valuationTryJpy' in revertedSaved, false, 'synthetic reset should remove explicit conversion override');
  assert.equal(revertedSaved.valuationTryJpySource, 'synthetic');
  assert.equal(revertedSaved.swapSourceDate, sourceDate, 'synthetic conversion reset must not disturb shifted swap source metadata');
  assert.equal(revertedSaved.swapCreditDate, displayDate, 'synthetic conversion reset must not disturb shifted swap display metadata');
  console.log('manual valuation conversion + synthetic fallback + shifted multi-day badge: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`VALUATION E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
