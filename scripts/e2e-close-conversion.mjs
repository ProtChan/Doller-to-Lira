import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

try {
  console.log('CLOSE CONVERSION BROWSER=', browserName);
  console.log('CLOSE CONVERSION TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.closeConversionRate === '1', { timeout: 15000 });

  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill('2026-08-19');
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill('47.9359');
  await page.locator('#entryLots').fill('20');
  await page.locator('#positionForm button[type="submit"]').click();

  await page.locator('#detailCloseBtn').click();
  await page.waitForFunction(() => document.getElementById('closePositionDialog')?.open === true);
  assert.equal(await page.locator('#closeTryJpy').count(), 1, 'settlement TRY/JPY input is missing');
  assert.match(await page.locator('#closeTryJpy').locator('xpath=..').innerText(), /円換算レート/, 'conversion-rate field label is missing');

  await page.locator('#closeDate').fill('2026-09-03');
  await page.locator('#closeRate').fill('48.3167');
  await page.locator('#closeTryJpy').fill('3.232');
  await page.locator('#closePositionForm button[type="submit"]').click();

  const result = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const p = saved.positions.find((x) => x.date === '2026-08-19' && Number(x.entryRate) === 47.9359 && Number(x.lots) === 20);
    return {
      p,
      fx: window.__DTL_CLOSED_FX__?.(p),
      detail: document.getElementById('positionDetail')?.innerText || ''
    };
  });

  assert.ok(result.p, 'closed test position was not saved');
  assert.equal(result.p.closeDate, '2026-09-03', 'close date was not saved');
  assert.equal(result.p.closeRate, 48.3167, 'close rate was not saved');
  assert.equal(result.p.closeTryJpy, 3.232, 'actual TRY/JPY conversion rate was not saved');
  assert.ok(Math.abs(result.fx - (-24614.912)) < 1e-9, `realized FX does not use actual TRY/JPY: ${result.fx}`);
  assert.match(result.detail, /-¥24,614/, `closed detail should show -¥24,614 FX: ${result.detail}`);
  assert.match(result.detail, /円換算レート[\s\S]*3\.232/, 'closed detail does not show stored conversion rate');
  assert.match(result.detail, /決済編集/, 'closed position cannot reopen the settlement editor');
  console.log('20 lot: 47.9359 -> 48.3167 x TRYJPY 3.232 = -24614.912 JPY: PASS');

  await page.locator('#detailEditCloseBtn').click();
  assert.equal(Number(await page.locator('#closeTryJpy').inputValue()), 3.232, 'settlement editor did not restore conversion rate');
  assert.equal(Number(await page.locator('#closeRate').inputValue()), 48.3167, 'settlement editor did not restore close rate');
  await page.locator('#closePositionDialog [value="cancel"]').first().click();
  console.log('closed-position settlement editing: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`CLOSE CONVERSION E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
