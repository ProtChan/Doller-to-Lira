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

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);
const nextBusinessDate = (sourceDate) => {
  const d = new Date(`${sourceDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

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
    shiftedSwapDisplay: '1',
    shiftedSwapAccountingActive: '1'
  })) {
    await page.waitForFunction(({ key, value }) => document.documentElement.dataset[key] === value, { key, value }, { timeout: 15000 });
  }
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapCreditRule === 'next-business-day-display-open-exclusive-close-inclusive', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapEntitlementRule === 'display-date-open-exclusive-close-inclusive', { timeout: 15000 });

  // These are broker margin-band boundaries, not a production position fixture.
  const marginBands = await page.evaluate(() => ({
    at155: window.__DTL_MARGIN_PER_1000__(155),
    below1575: window.__DTL_MARGIN_PER_1000__(157.4999),
    at1575: window.__DTL_MARGIN_PER_1000__(157.5),
    below160: window.__DTL_MARGIN_PER_1000__(159.9999),
    at160: window.__DTL_MARGIN_PER_1000__(160)
  }));
  assert.deepEqual(marginBands, { at155: 6300, below1575: 6300, at1575: 6400, below160: 6400, at160: 6500 });
  console.log('Hirose USDJPY margin boundary rules: PASS');

  const manifestUrl = new URL('manifest.webmanifest', targetUrl).href;
  const manifestResponse = await page.request.get(manifestUrl);
  assert.equal(manifestResponse.ok(), true);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.short_name, 'ドルとリラ');
  assert.ok(manifest.icons?.some((icon) => /icon-dollar-lira\.svg/.test(icon.src)));
  console.log('PWA manifest: PASS');

  const fixture = await page.evaluate(() => {
    const rows = (window.__DTL_HIROSE_HISTORY__?.() || [])
      .filter((row) => row?.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const credits = window.__DTL_HIROSE_CREDIT_HISTORY__?.() || [];
    const multi = credits.find((entry) => Number(entry?.row?.days || 0) > 1) || credits[0] || null;
    return {
      historyStart: document.documentElement.dataset.hiroseHistoryStart || '',
      rows,
      credits,
      first: credits[0] || null,
      multi,
      last: credits.at(-1) || null
    };
  });
  assert.ok(fixture.rows.length > 1, 'history must contain multiple rows');
  assert.ok(fixture.first && fixture.multi && fixture.last, 'credit history must be available');
  assert.equal(fixture.historyStart, fixture.rows[0].date, 'history start marker must match the first loaded source row');
  assert.equal(fixture.credits.length, fixture.rows.filter((row) => {
    const day = new Date(`${row.date}T12:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  }).length, 'each business-day source row must have one credit entry');
  assert.equal(fixture.first.creditDate, nextBusinessDate(fixture.first.sourceDate));

  await page.locator('[data-tab="positions"]').click();
  assert.equal(await page.locator('#view-positions').evaluate((el) => el.classList.contains('active')), true);
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill(fixture.rows[0].date);
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill('50');
  await page.locator('#entryLots').fill('1');
  await page.locator('#positionForm button[type="submit"]').click();
  const savedPosition = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return current.positions.at(-1) || null;
  });
  assert.ok(savedPosition, 'position was not persisted');
  assert.equal(savedPosition.date, fixture.rows[0].date);
  assert.equal(savedPosition.side, 'short');
  assert.equal(Number(savedPosition.lots), 1);
  console.log('position save: PASS');

  await page.locator('#openSettingsBtn').click();
  assert.equal(Number(await page.locator('#settingUnits').inputValue()), 1000);
  assert.equal(await page.locator('#settingSwapMode').count(), 1);
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.waitForFunction(() => document.documentElement.dataset.swapInputMode === 'hirose', { timeout: 5000 });

  const ruleCheck = await page.evaluate(({ first, multi }) => ({
    firstResolution: window.__DTL_HIROSE_SWAP_RESOLUTION__?.(first.creditDate) || null,
    multiResolution: window.__DTL_HIROSE_SWAP_RESOLUTION__?.(multi.creditDate) || null,
    openedOnDisplayDay: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: multi.creditDate, side: 'short', lots: 1 }, multi.creditDate),
    openedOnSourceDay: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: multi.sourceDate, side: 'short', lots: 1 }, multi.creditDate)
  }), { first: fixture.first, multi: fixture.multi });

  assert.equal(ruleCheck.firstResolution?.sourceDate, fixture.first.sourceDate);
  assert.equal(ruleCheck.firstResolution?.creditDate, fixture.first.creditDate);
  assert.equal(ruleCheck.multiResolution?.sourceDate, fixture.multi.sourceDate);
  assert.equal(ruleCheck.multiResolution?.creditDate, fixture.multi.creditDate);
  assert.equal(ruleCheck.openedOnDisplayDay, 0, 'opening display date must not receive that displayed swap');
  near(ruleCheck.openedOnSourceDay, ruleCheck.multiResolution?.shortPerLot, 'opening on the source date must receive the row on its later display date');
  console.log('next-business-day swap accounting rules: PASS');

  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#dailyValuationTryJpy').count(), 1);
  assert.equal(await page.locator('#quickDailyValuationTryJpy').count(), 1);

  for (const entry of [fixture.first, fixture.multi]) {
    const expected = await page.evaluate((creditDate) => window.__DTL_HIROSE_SWAP_RESOLUTION__?.(creditDate) || null, entry.creditDate);
    await page.locator('#dailyDate').fill(entry.creditDate);
    await page.locator('#dailyDate').dispatchEvent('change');
    await page.waitForFunction(
      ({ expectedSwap }) => Math.abs(Number(document.querySelector('#dailySwap')?.value) - expectedSwap) < 1e-8,
      { expectedSwap: Number(expected.shortPerLot) },
      { timeout: 5000 }
    );
    const note = await page.locator('#dailySwap').locator('xpath=..').innerText();
    assert.ok(note.includes(`${entry.sourceDate}表記`));
    assert.ok(note.includes(`${entry.creditDate}表示`));
    if (Number(entry.row?.days || 0) > 1) assert.ok(note.includes(`${Number(entry.row.days)}日分`));
  }
  console.log('daily shifted auto-fill follows current source/display mapping: PASS');

  await page.locator('#dailyDate').fill(fixture.multi.creditDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  const currentResolution = await page.evaluate((date) => window.__DTL_HIROSE_SWAP_RESOLUTION__?.(date) || null, fixture.multi.creditDate);
  await page.waitForFunction(
    ({ expectedSwap }) => Math.abs(Number(document.querySelector('#dailySwap')?.value) - expectedSwap) < 1e-8,
    { expectedSwap: Number(currentResolution.shortPerLot) },
    { timeout: 5000 }
  );
  await page.locator('#dailyRate').fill('50');
  await page.locator('#dailyUsdJpy').fill('160');
  const synthetic = Number(await page.locator('#dailyValuationTryJpy').inputValue());
  assert.ok(synthetic > 0, 'synthetic TRYJPY must be positive');
  const manualConversion = Number((synthetic * 0.99).toFixed(6));
  await page.locator('#dailyValuationTryJpy').fill(String(manualConversion));
  await page.locator('#dailyForm button[type="submit"]').click();
  const saved = await page.evaluate((date) => JSON.parse(localStorage.getItem('dollar-to-lira:v1')).daily.find((row) => row.date === date), fixture.multi.creditDate);
  near(saved.valuationTryJpy, manualConversion, 'actual TRYJPY valuation override');
  assert.equal(saved.valuationTryJpySource, 'manual');
  assert.equal(saved.swapSourceDate, fixture.multi.sourceDate);
  assert.equal(saved.swapCreditDate, fixture.multi.creditDate);
  assert.equal(Number(saved.swapSourceDays), Number(fixture.multi.row.days || 0));
  near(saved.swapPerLot, currentResolution.shortPerLot, 'saved swap amount follows current resolution');
  console.log('actual TRYJPY valuation override: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('manual');
  await page.locator('#settingRateSource').selectOption('manual');
  await page.locator('#closeSettingsBtn').click();
  const manualDate = nextBusinessDate(fixture.last.creditDate);
  await page.locator('#dailyDate').fill(manualDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForTimeout(25);
  assert.equal(await page.locator('#dailySwap').isEditable(), true);
  const sentinel = { rate: 50.25, usdJpy: 160.8, swap: 123.456789 };
  await page.locator('#dailyRate').fill(String(sentinel.rate));
  await page.locator('#dailyUsdJpy').fill(String(sentinel.usdJpy));
  await page.locator('#dailySwap').fill(String(sentinel.swap));
  await page.locator('#dailyForm button[type="submit"]').click();
  const manualSaved = await page.evaluate((date) => JSON.parse(localStorage.getItem('dollar-to-lira:v1')).daily.find((row) => row.date === date), manualDate);
  near(manualSaved.rate, sentinel.rate, 'manual USDTRY value');
  near(manualSaved.usdJpy, sentinel.usdJpy, 'manual USDJPY value');
  near(manualSaved.swapPerLot, sentinel.swap, 'manual swap value');
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
