import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
// This test must intercept the Hirose JSON directly to simulate a future official row.
// Block service workers here only so the synthetic response is not hidden behind the PWA fetch layer.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  serviceWorkers: 'block'
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const pendingDate = '2026-12-31';

try {
  console.log('PENDING BROWSER=', browserName);
  console.log('PENDING TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseFeedReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hirosePendingEntries === '1', { timeout: 15000 });

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="daily"]').click();

  await page.locator('#dailyDate').fill(pendingDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction((date) => {
    const dateInput = document.getElementById('dailyDate');
    const swap = document.getElementById('dailySwap');
    return dateInput?.value === date && swap?.dataset.hirosePending === '1';
  }, pendingDate, { timeout: 5000 });

  assert.equal(await page.locator('#dailySwap').inputValue(), '0', 'missing Hirose swap must provisionally display 0');
  assert.equal(await page.locator('#dailySwap').isEditable(), false, 'provisional Hirose swap remains read-only');
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /未確定/, 'provisional Hirose status is not shown');

  await page.locator('#dailyRate').fill('50.0000');
  await page.locator('#dailyUsdJpy').fill('160.000');
  await page.locator('#dailyForm button[type="submit"]').click();

  const pendingSaved = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return saved.daily.find((row) => row.date === date) || null;
  }, pendingDate);
  assert.ok(pendingSaved, 'daily row with missing Hirose swap was not saved');
  assert.equal(pendingSaved.swapPerLot, 0, 'provisional Hirose swap must be stored as 0');
  assert.equal(pendingSaved.swapSource, 'hirose-pending', 'provisional source marker is missing');
  assert.equal(pendingSaved.swapPending, true, 'provisional pending flag is missing');
  assert.match(await page.locator('#dailyTableBody').innerText(), /未確定/, 'daily table does not show pending status');
  console.log('missing Hirose swap -> 0 JPY pending daily save: PASS');

  // Simulate the same official date appearing in the persisted Hirose feed later.
  await page.route('**/data/hirose-usdtry-swap.json*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const history = Array.isArray(data.history) ? [...data.history] : [];
    history.push({ date: pendingDate, days: 1, unit: 1000, sellJpy: 123.45, buyJpy: -140.67 });
    history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    await route.fulfill({ response, json: { ...data, history } });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.hirosePendingEntries === '1', { timeout: 15000 });
  await page.waitForFunction((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = saved.daily.find((item) => item.date === date);
    return row?.swapSource === 'hirose' && row?.swapPending === false && Math.abs(Number(row.swapPerLot) - 123.45) < 1e-9;
  }, pendingDate, { timeout: 10000 });

  const upgraded = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return saved.daily.find((row) => row.date === date) || null;
  }, pendingDate);
  assert.equal(upgraded.swapPerLot, 123.45, 'pending row did not upgrade to official sell swap');
  assert.equal(upgraded.swapLongPerLot, -140.67, 'pending row did not store official buy swap');
  assert.equal(upgraded.swapSource, 'hirose', 'pending row source did not upgrade to official');
  assert.equal(upgraded.swapPending, false, 'pending flag was not cleared after official data arrived');
  console.log('pending row -> official Hirose value automatic upgrade: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE PENDING E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
