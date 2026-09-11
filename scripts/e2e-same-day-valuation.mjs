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
const closeSettingsIfOpen = async () => {
  const drawer = page.locator('#settingsDrawer');
  if ((await drawer.getAttribute('aria-hidden')) === 'false') {
    const close = page.locator('#closeSettingsBtn');
    if (await close.isVisible()) await close.click();
  }
  await page.waitForFunction(() => document.querySelector('#settingsDrawer')?.getAttribute('aria-hidden') === 'true', { timeout: 5000 });
};
const showCalendarMonth = async (date) => {
  const [targetYear, targetMonth] = date.split('-').map(Number);
  const targetIndex = targetYear * 12 + targetMonth - 1;
  for (let attempts = 0; attempts < 36; attempts += 1) {
    const title = (await page.locator('#calendarTitle').innerText()).trim();
    const match = title.match(/(\d{4})\s*\/\s*(\d{1,2})/);
    assert.ok(match, `unparseable calendar title: ${title}`);
    const currentIndex = Number(match[1]) * 12 + Number(match[2]) - 1;
    if (currentIndex === targetIndex) return;
    await page.locator(currentIndex > targetIndex ? '#prevMonthBtn' : '#nextMonthBtn').click();
  }
  assert.fail(`calendar did not reach ${date.slice(0, 7)}`);
};

try {
  console.log('VALUATION RULE E2E BROWSER=', browserName);
  console.log('VALUATION RULE E2E TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.valuationUi === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.backendCoreReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await closeSettingsIfOpen();
  await page.waitForFunction(() => saveDailyFrom?.__dtlCanonicalBackend === true && derivedDaily?.__dtlCanonicalBackend === true, { timeout: 5000 });
  await page.locator('[data-tab="daily"]').click();

  assert.equal(await page.locator('#dailyValuationTryJpy').count(), 1, 'daily valuation conversion input is missing');
  assert.equal(await page.locator('#quickDailyValuationTryJpy').count(), 1, 'quick valuation conversion input is missing');

  const fixture = await page.evaluate(() => {
    const rows = (window.__DTL_HIROSE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.days || 0) > 1)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const source = rows[0] || null;
    if (!source) return null;
    const creditDate = window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__?.(source.date) || '';
    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__?.(creditDate) || null;
    return { source, creditDate, resolution };
  });

  assert.ok(fixture?.source, 'valuation E2E needs at least one multi-day broker source row');
  assert.ok(fixture.creditDate, 'multi-day source row has no next-business-day display date');
  assert.equal(fixture.resolution?.status, 'official');
  assert.equal(fixture.resolution?.sourceDate, fixture.source.date);
  assert.equal(fixture.resolution?.creditDate, fixture.creditDate);
  assert.equal(Number(fixture.resolution?.row?.days || 0), Number(fixture.source.days));

  const sourceDate = fixture.source.date;
  const displayDate = fixture.creditDate;
  const expectedSwap = Number(fixture.resolution.shortPerLot);
  const sourceDays = Number(fixture.source.days);

  await page.locator('#dailyDate').fill(displayDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(
    ({ expectedSwap }) => Math.abs(Number(document.querySelector('#dailySwap')?.value) - expectedSwap) < 1e-8,
    { expectedSwap },
    { timeout: 5000 }
  );
  near(await page.locator('#dailySwap').inputValue(), expectedSwap, 'daily form must use the selected source row amount');
  const swapNote = await page.locator('#dailySwap').locator('xpath=..').innerText();
  assert.ok(swapNote.includes(`${sourceDate}表記`), 'shifted source date note is missing');
  assert.ok(swapNote.includes(`${displayDate}表示`), 'shifted display date note is missing');
  assert.ok(swapNote.includes(`${sourceDays}日分`), 'multi-day source-day count note is missing');

  const synthetic = Number(await page.locator('#dailyValuationTryJpy').inputValue());
  assert.ok(synthetic > 0, 'synthetic TRY/JPY fallback was not filled');

  const customConversion = Number((synthetic * 0.987654321).toFixed(6));
  assert.ok(customConversion > 0 && Math.abs(customConversion - synthetic) > 1e-6, 'test conversion must differ from synthetic fallback');
  await page.locator('#dailyValuationTryJpy').fill(String(customConversion));
  await page.locator('#dailyForm button[type="submit"]').click();

  const saved = await page.evaluate((date) => {
    const current = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return current.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.ok(saved, 'selected display row was not saved');
  near(saved.valuationTryJpy, customConversion, 'manual broker TRY/JPY conversion was not persisted');
  assert.equal(saved.valuationTryJpySource, 'manual');
  assert.equal(saved.swapSourceDate, sourceDate);
  assert.equal(saved.swapCreditDate, displayDate);
  assert.equal(Number(saved.swapSourceDays), sourceDays);
  near(saved.swapPerLot, expectedSwap, 'saved swap must match the resolved display-date amount');

  const derived = await page.evaluate((date) => {
    const row = derivedDaily().find((item) => item.date === date);
    return row ? {
      tryJpy: row.tryJpy,
      valuationTryJpySource: row.valuationTryJpySource,
      swapSourceDate: row.swapSourceDate,
      swapCreditDate: row.swapCreditDate,
      swapSourceDays: row.swapSourceDays,
      swapPerLot: row.swapPerLot
    } : null;
  }, displayDate);
  assert.ok(derived, 'derived display row is missing');
  near(derived.tryJpy, customConversion, 'derived valuation must use the manual conversion');
  assert.equal(derived.valuationTryJpySource, 'manual');
  assert.equal(derived.swapSourceDate, sourceDate);
  assert.equal(derived.swapCreditDate, displayDate);
  assert.equal(Number(derived.swapSourceDays), sourceDays);
  near(derived.swapPerLot, expectedSwap, 'derived swap metadata must preserve the resolved amount');

  const conversionCell = page.locator('#dailyTableBody tr').filter({ hasText: displayDate }).locator('td').nth(3);
  assert.match(await conversionCell.innerText(), /実測/, 'daily table must distinguish actual/manual TRY/JPY conversion');
  const swapCell = page.locator('#dailyTableBody tr').filter({ hasText: displayDate }).locator('td').nth(4);
  assert.ok((await swapCell.innerText()).includes(`${sourceDays}日分`), 'daily table must show the broker source-day count');

  await page.locator('[data-tab="calendar"]').click();
  // The calendar intentionally opens on the latest stored month. The fixture may
  // be an older multi-day source row, so navigate through the actual month controls
  // before asserting the display-date cell.
  await showCalendarMonth(displayDate);
  const calendarCell = page.locator(`.calendar-day[data-date="${displayDate}"]`);
  assert.equal(await calendarCell.count(), 1, 'calendar cell for the saved display date is missing');
  assert.ok((await calendarCell.innerText()).includes(`S×${sourceDays}`), 'calendar must mark the source-day count on the display date');

  // Saving resets the daily form back to today's entry. Re-select the saved display
  // date before testing the explicit "back to synthetic" action on that row.
  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill(displayDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(
    ({ customConversion }) => Math.abs(Number(document.querySelector('#dailyValuationTryJpy')?.value) - customConversion) < 1e-8,
    { customConversion },
    { timeout: 5000 }
  );
  await page.locator('[data-synthetic-conversion="daily"]').click();
  await page.waitForTimeout(50);
  const reverted = Number(await page.locator('#dailyValuationTryJpy').inputValue());
  assert.ok(reverted > 0 && Math.abs(reverted - customConversion) > 1e-6, 'synthetic reset did not replace the manual conversion');
  await page.locator('#dailyForm button[type="submit"]').click();

  const revertedSaved = await page.evaluate((date) => {
    const current = JSON.parse(localStorage.getItem('dollar-to-lira:v1'));
    return current.daily.find((row) => row.date === date) || null;
  }, displayDate);
  assert.ok(revertedSaved, 'row disappeared after synthetic reset');
  assert.equal('valuationTryJpy' in revertedSaved, false, 'synthetic reset should remove the explicit conversion override');
  assert.equal(revertedSaved.valuationTryJpySource, 'synthetic');
  assert.equal(revertedSaved.swapSourceDate, sourceDate, 'conversion reset must not disturb swap source metadata');
  assert.equal(revertedSaved.swapCreditDate, displayDate, 'conversion reset must not disturb swap display metadata');
  assert.equal(Number(revertedSaved.swapSourceDays), sourceDays, 'conversion reset must not disturb source-day count');
  console.log('manual valuation + synthetic fallback + shifted metadata invariants: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`VALUATION RULE E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
