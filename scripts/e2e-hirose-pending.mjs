import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  serviceWorkers: 'block'
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const displayDate = '2026-12-30';
const sourceDate = '2026-12-29';

try {
  console.log('PENDING SHIFTED-DISPLAY BROWSER=', browserName);
  console.log('PENDING SHIFTED-DISPLAY TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="daily"]').click();

  await page.locator('#dailyDate').fill(displayDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction((date) => {
    const dateInput = document.getElementById('dailyDate');
    const swap = document.getElementById('dailySwap');
    return dateInput?.value === date && swap?.dataset.hirosePending === '1';
  }, displayDate, { timeout: 5000 });

  assert.equal(await page.locator('#dailySwap').inputValue(), '0', 'missing shifted Hirose swap must provisionally display 0');
  assert.equal(await page.locator('#dailySwap').isEditable(), false, 'pending Hirose swap remains read-only');
  const pendingNote = await page.locator('#dailySwap').locator('xpath=..').innerText();
  assert.match(pendingNote, new RegExp(`${sourceDate}分 未確定`), 'pending note must name the previous broker/source date');
  assert.match(pendingNote, new RegExp(`${displayDate}表示`), 'pending note must name the shifted display date');

  await page.locator('#dailyRate').fill('50.0000');
  await page.locator('#dailyUsdJpy').fill('160.000');
  await page.locator('#dailyForm button[type="submit"]').click();

  const pendingSaved = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return saved.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.ok(pendingSaved, 'daily row with missing shifted Hirose swap was not saved');
  assert.equal(pendingSaved.swapPerLot, 0);
  assert.equal(pendingSaved.swapSource, 'hirose-pending');
  assert.equal(pendingSaved.swapPending, true);
  assert.equal(pendingSaved.swapSourceDate, sourceDate, 'pending source date must be the previous business day');
  assert.equal(pendingSaved.swapCreditDate, displayDate, 'pending credit/display date must be the visible daily date');
  console.log('missing source row -> shifted pending display row: PASS');

  await page.route('**/data/hirose-usdtry-swap.json*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const history = Array.isArray(data.history) ? [...data.history] : [];
    history.push({ date: sourceDate, days: 3, unit: 1000, sellJpy: 333.33, buyJpy: -400.0 });
    history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    await route.fulfill({ response, json: { ...data, history } });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });
  await page.waitForFunction((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = saved.daily.find((item) => item.date === date);
    return row?.swapSource === 'hirose' && row?.swapPending === false && Math.abs(Number(row.swapPerLot) - 333.33) < 1e-9;
  }, displayDate, { timeout: 10000 });

  const upgraded = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return saved.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.equal(upgraded.swapPerLot, 333.33);
  assert.equal(upgraded.swapLongPerLot, -400);
  assert.equal(upgraded.swapSource, 'hirose');
  assert.equal(upgraded.swapPending, false);
  assert.equal(upgraded.swapSourceDate, sourceDate);
  assert.equal(upgraded.swapCreditDate, displayDate);
  assert.equal(upgraded.swapSourceDays, 3);
  console.log('new broker source row -> shifted display row official upgrade: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE PENDING SHIFTED-DISPLAY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
