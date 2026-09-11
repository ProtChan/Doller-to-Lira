import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('CLOSE CONVERSION RULE BROWSER=', browserName);
  console.log('CLOSE CONVERSION RULE TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.closeConversionRate === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });

  const fixture = await page.evaluate(() => {
    const rows = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { first: rows[0] || null, last: rows.at(-1) || null };
  });
  assert.ok(fixture.first && fixture.last && fixture.first.date < fixture.last.date, 'close-conversion test needs at least two ordered rate rows');

  await page.locator('#openSettingsBtn').click();
  const unitsPerLot = Number(await page.locator('#settingUnits').inputValue());
  assert.ok(unitsPerLot > 0, 'units per lot must be positive');
  await page.locator('#closeSettingsBtn').click();

  const openDate = fixture.first.date;
  const closeDate = fixture.last.date;
  const entryRate = Number(fixture.first.usdTryAskClose23);
  const closeRate = Number(fixture.last.usdTryAskClose23);
  const syntheticTryJpy = Number(fixture.last.usdJpyAskClose23) / closeRate;
  const closeTryJpy = Number((syntheticTryJpy * 1.001234).toFixed(6));
  const lots = 1; // normalized unit-position test, not a production lot fixture
  const expectedFx = (closeRate - entryRate) * unitsPerLot * lots * -1 * closeTryJpy;

  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill(openDate);
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill(String(entryRate));
  await page.locator('#entryLots').fill(String(lots));
  await page.locator('#positionForm button[type="submit"]').click();

  await page.locator('#detailCloseBtn').click();
  await page.waitForFunction(() => document.getElementById('closePositionDialog')?.open === true);
  assert.equal(await page.locator('#closeTryJpy').count(), 1, 'settlement TRY/JPY input is missing');
  assert.match(await page.locator('#closeTryJpy').locator('xpath=..').innerText(), /円換算レート/, 'conversion-rate field label is missing');

  await page.locator('#closeDate').fill(closeDate);
  await page.locator('#closeRate').fill(String(closeRate));
  await page.locator('#closeTryJpy').fill(String(closeTryJpy));
  await page.locator('#closePositionForm button[type="submit"]').click();

  const result = await page.evaluate(({ openDate, entryRate }) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    const p = saved.positions.find((x) => x.date === openDate && Number(x.entryRate) === Number(entryRate) && Number(x.lots) === 1);
    return {
      p,
      fx: window.__DTL_CLOSED_FX__?.(p),
      detail: document.getElementById('positionDetail')?.innerText || ''
    };
  }, { openDate, entryRate });

  assert.ok(result.p, 'closed unit test position was not saved');
  assert.equal(result.p.closeDate, closeDate, 'close date was not saved');
  near(result.p.closeRate, closeRate, 'close rate was not saved');
  near(result.p.closeTryJpy, closeTryJpy, 'actual TRY/JPY conversion rate was not saved');
  near(result.fx, expectedFx, 'realized FX must use the stored settlement TRY/JPY conversion');

  const truncatedFx = Math.trunc(expectedFx);
  const expectedMoney = `${truncatedFx < 0 ? '-' : ''}¥${Math.abs(truncatedFx).toLocaleString('ja-JP')}`;
  assert.ok(result.detail.includes(expectedMoney), `closed detail should show computed FX ${expectedMoney}: ${result.detail}`);
  assert.ok(result.detail.includes(String(closeTryJpy)), 'closed detail does not show stored conversion rate');
  assert.match(result.detail, /決済編集/, 'closed position cannot reopen the settlement editor');
  console.log('settlement FX identity using stored TRY/JPY: PASS');

  await page.locator('#detailEditCloseBtn').click();
  near(await page.locator('#closeTryJpy').inputValue(), closeTryJpy, 'settlement editor restores conversion rate');
  near(await page.locator('#closeRate').inputValue(), closeRate, 'settlement editor restores close rate');
  await page.locator('#closePositionDialog .modal-footer .outline-btn').click();
  console.log('closed-position settlement editing: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`CLOSE CONVERSION RULE E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
