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

  for (const [key, value] of Object.entries({
    appReady: '1',
    accountingV2: '1',
    swapDecimals: '1',
    hiroseMargin: '1',
    hiroseFeedReady: '1',
    hiroseHistoryReady: '1',
    hiroseHistoryAccounting: '1',
    calendarBreakdown: '1',
    calendarMobileCompact: '1',
    sameDaySwapValuation: '1',
    sameDaySwapReinforce: '1',
    sameDaySwapAccountingActive: '1'
  })) {
    await page.waitForFunction(({ key, value }) => document.documentElement.dataset[key] === value, { key, value }, { timeout: 15000 });
  }
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapCreditRule === 'same-day-table-date', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapEntitlementRule === 'table-date-open-exclusive-close-inclusive', { timeout: 15000 });

  const marginBands = await page.evaluate(() => ({
    at155: window.__DTL_MARGIN_PER_1000__(155),
    below1575: window.__DTL_MARGIN_PER_1000__(157.4999),
    at1575: window.__DTL_MARGIN_PER_1000__(157.5),
    below160: window.__DTL_MARGIN_PER_1000__(159.9999),
    at160: window.__DTL_MARGIN_PER_1000__(160)
  }));
  assert.deepEqual(marginBands, { at155: 6300, below1575: 6300, at1575: 6400, below160: 6400, at160: 6500 });
  console.log('Hirose USDJPY margin bands: PASS');

  const manifestUrl = new URL('manifest.webmanifest', targetUrl).href;
  const manifestResponse = await page.request.get(manifestUrl);
  assert.equal(manifestResponse.ok(), true);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.short_name, 'ドルとリラ');
  assert.ok(manifest.icons?.some((icon) => /icon-dollar-lira\.svg/.test(icon.src)));
  console.log('PWA manifest: PASS');

  await page.locator('[data-tab="positions"]').click();
  assert.equal(await page.locator('#view-positions').evaluate((el) => el.classList.contains('active')), true);
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill('2026-09-01');
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill('48.0000');
  await page.locator('#entryLots').fill('1.23');
  await page.locator('#positionForm button[type="submit"]').click();
  assert.match(await page.locator('#positionTableBody').innerText(), /1\.23/);
  console.log('position save: PASS');

  await page.locator('#openSettingsBtn').click();
  assert.equal(Number(await page.locator('#settingUnits').inputValue()), 1000);
  assert.equal(await page.locator('#settingSwapMode').count(), 1);
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.waitForFunction(() => document.documentElement.dataset.swapInputMode === 'hirose', { timeout: 5000 });

  const history = await page.evaluate(() => {
    const rows = window.__DTL_HIROSE_HISTORY__?.() || [];
    return {
      start: document.documentElement.dataset.hiroseHistoryStart,
      records: rows.length,
      jul2: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-02') || null,
      sep3: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-09-03') || null,
      openedSameDay: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: '2026-09-03', side: 'short', lots: 1 }, '2026-09-03'),
      openedBefore: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: '2026-09-02', side: 'short', lots: 1 }, '2026-09-03')
    };
  });
  assert.equal(history.start, '2026-07-01');
  assert.ok(history.records >= 47);
  assert.equal(history.jul2?.creditDate, '2026-07-02');
  assert.equal(history.jul2?.shortPerLot, 346.81);
  assert.equal(history.jul2?.row?.days, 3);
  assert.equal(history.sep3?.creditDate, '2026-09-03');
  assert.equal(history.sep3?.shortPerLot, 473.94);
  assert.equal(history.sep3?.row?.days, 4);
  assert.equal(history.openedSameDay, 0);
  assert.ok(Math.abs(history.openedBefore - 473.94) < 1e-9);
  console.log('same-day Hirose multi-day accounting: PASS');

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#dailyValuationTryJpy').count(), 1);
  assert.equal(await page.locator('#quickDailyValuationTryJpy').count(), 1);

  await page.locator('#dailyDate').fill('2026-07-02');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#dailySwap')?.value) - 346.81) < 1e-9, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-07-02付与/);
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /3日分/);

  await page.locator('#dailyDate').fill('2026-09-03');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#dailySwap')?.value) - 473.94) < 1e-9, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-09-03付与/);
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /4日分/);
  console.log('daily same-day auto-fill: PASS');

  await page.locator('#dailyRate').fill('50.0000');
  await page.locator('#dailyUsdJpy').fill('160.000');
  const synthetic = Number(await page.locator('#dailyValuationTryJpy').inputValue());
  assert.ok(Math.abs(synthetic - 3.2) < 1e-6, `synthetic TRYJPY=${synthetic}`);
  await page.locator('#dailyValuationTryJpy').fill('3.150001');
  await page.locator('#dailyForm button[type="submit"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dollar-to-lira:v1')).daily.find((row) => row.date === '2026-09-03'));
  assert.equal(saved.valuationTryJpy, 3.150001);
  assert.equal(saved.valuationTryJpySource, 'manual');
  assert.equal(saved.swapSourceDate, '2026-09-03');
  assert.equal(saved.swapCreditDate, '2026-09-03');
  assert.equal(saved.swapSourceDays, 4);
  console.log('actual TRYJPY valuation override: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('manual');
  await page.locator('#settingRateSource').selectOption('manual');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('#dailyDate').fill('2026-09-10');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForTimeout(25);
  assert.equal(await page.locator('#dailySwap').isEditable(), true);
  await page.locator('#dailyRate').fill('48.0000');
  await page.locator('#dailyUsdJpy').fill('158.400');
  await page.locator('#dailySwap').fill('100.78901');
  await page.locator('#dailyForm button[type="submit"]').click();
  const manualSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('dollar-to-lira:v1')).daily.find((row) => row.date === '2026-09-10'));
  assert.equal(manualSaved.usdJpy, 158.4);
  assert.equal(manualSaved.swapPerLot, 100.78901);
  console.log('manual fallback mode: PASS');

  await page.locator('#openSettingsBtn').click();
  assert.equal(await page.locator('#openBackupFromSettingsBtn').isVisible(), true);
  await page.locator('#openBackupFromSettingsBtn').click();
  assert.equal(await page.locator('#backupDialog').evaluate((el) => el.open), true);
  await page.locator('#closeBackupBtn').click();
  console.log('mobile backup access: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
