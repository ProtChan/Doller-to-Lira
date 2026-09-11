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

const nextBusinessDate = (sourceDate) => {
  const d = new Date(`${sourceDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('PENDING SHIFTED-DISPLAY BROWSER=', browserName);
  console.log('PENDING SHIFTED-DISPLAY TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });

  const base = await page.evaluate(() => {
    const rows = (window.__DTL_HIROSE_HISTORY__?.() || [])
      .filter((row) => row?.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return rows.at(-1) || null;
  });
  assert.ok(base?.date, 'pending test requires at least one broker history row');

  const sourceDate = nextBusinessDate(base.date);
  const displayDate = nextBusinessDate(sourceDate);
  const injected = {
    days: Math.max(1, Number(base.days || 1)),
    unit: Number(base.unit || 1000),
    sellJpy: Number(base.sellJpy || 0) + 17.25,
    buyJpy: Number(base.buyJpy || 0) - 21.5
  };

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="daily"]').click();

  await page.locator('#dailyDate').fill(displayDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(({ date, source }) => {
    const dateInput = document.getElementById('dailyDate');
    const swap = document.getElementById('dailySwap');
    const note = swap?.closest('label')?.querySelector('.swap-source-note')?.textContent || '';
    return dateInput?.value === date
      && swap?.dataset.hirosePending === '1'
      && note.includes(`${source}分 未確定`)
      && note.includes(`${date}表示`);
  }, { date: displayDate, source: sourceDate }, { timeout: 5000 });

  near(await page.locator('#dailySwap').inputValue(), 0, 'missing broker source row must provisionally display zero');
  assert.equal(await page.locator('#dailySwap').isEditable(), false, 'pending broker swap remains read-only');
  const pendingNote = await page.locator('#dailySwap').locator('xpath=..').innerText();
  assert.ok(pendingNote.includes(`${sourceDate}分 未確定`), 'pending note must name the unresolved source date');
  assert.ok(pendingNote.includes(`${displayDate}表示`), 'pending note must name its display date');

  await page.locator('#dailyRate').fill('50');
  await page.locator('#dailyUsdJpy').fill('160');
  await page.locator('#dailyForm button[type="submit"]').click();

  const pendingSaved = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return saved.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.ok(pendingSaved, 'daily row with unresolved broker swap was not saved');
  near(pendingSaved.swapPerLot, 0, 'pending saved swap');
  assert.equal(pendingSaved.swapSource, 'hirose-pending');
  assert.equal(pendingSaved.swapPending, true);
  assert.equal(pendingSaved.swapSourceDate, sourceDate);
  assert.equal(pendingSaved.swapCreditDate, displayDate);
  console.log('missing source row -> pending display row: PASS');

  await page.route('**/data/hirose-usdtry-swap.json*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const history = Array.isArray(data.history) ? [...data.history] : [];
    history.push({ date: sourceDate, ...injected });
    history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    await route.fulfill({ response, json: { ...data, history } });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });
  await page.waitForFunction(({ date, expected }) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const row = saved.daily.find((item) => item.date === date);
    return row?.swapSource === 'hirose'
      && row?.swapPending === false
      && Math.abs(Number(row.swapPerLot) - expected) < 1e-8;
  }, { date: displayDate, expected: injected.sellJpy }, { timeout: 10000 });

  const upgraded = await page.evaluate((date) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return saved.daily.find((row) => row.date === date) || null;
  }, displayDate);
  near(upgraded.swapPerLot, injected.sellJpy, 'official short swap after source arrival');
  near(upgraded.swapLongPerLot, injected.buyJpy, 'official long swap after source arrival');
  assert.equal(upgraded.swapSource, 'hirose');
  assert.equal(upgraded.swapPending, false);
  assert.equal(upgraded.swapSourceDate, sourceDate);
  assert.equal(upgraded.swapCreditDate, displayDate);
  assert.equal(Number(upgraded.swapSourceDays), injected.days);
  console.log('new source row -> pending row upgrades to official: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE PENDING SHIFTED-DISPLAY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
