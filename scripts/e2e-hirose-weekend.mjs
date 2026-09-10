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
  console.log('HIROSE WEEKEND BROWSER=', browserName);
  console.log('HIROSE WEEKEND TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hirosePendingEntries === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapCalendarRule === 'next-business-day-weekend-skip', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapEntitlementRule === 'source-date-open-exclusive-close-inclusive', { timeout: 15000 });

  const mapping = await page.evaluate(() => ({
    fridayToMonday: window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__?.('2026-07-10'),
    saturdayCredit: window.__DTL_HIROSE_CREDIT_AT__?.('2026-07-11') || null,
    sundayCredit: window.__DTL_HIROSE_CREDIT_AT__?.('2026-07-12') || null,
    mondayCredit: window.__DTL_HIROSE_CREDIT_AT__?.('2026-07-13') || null,
    saturdayResolution: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-11') || null,
    sundayResolution: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-12') || null,
    mondayResolution: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-13') || null
  }));
  assert.equal(mapping.fridayToMonday, '2026-07-13', `Friday did not map to Monday: ${mapping.fridayToMonday}`);
  assert.equal(mapping.saturdayCredit, null, 'Saturday must not receive a Hirose credit entry');
  assert.equal(mapping.sundayCredit, null, 'Sunday must not receive a Hirose credit entry');
  assert.equal(mapping.mondayCredit?.sourceDate, '2026-07-10', 'Monday credit must use Friday source row');
  assert.equal(mapping.mondayCredit?.row?.sellJpy, 117.5, 'Friday 2026-07-10 sell swap must post Monday');
  assert.equal(mapping.saturdayResolution?.status, 'zero', 'Saturday daily input must resolve to zero swap');
  assert.equal(mapping.sundayResolution?.status, 'zero', 'Sunday daily input must resolve to zero swap');
  assert.equal(mapping.mondayResolution?.status, 'official', 'Monday must resolve to Friday official row');
  assert.equal(mapping.mondayResolution?.shortPerLot, 117.5, 'Monday input must show Friday 117.5 JPY');
  console.log('Friday -> Monday mapping and weekend zero: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();

  await page.locator('[data-tab="daily"]').click();
  for (const date of ['2026-07-11', '2026-07-12']) {
    await page.locator('#dailyDate').fill(date);
    await page.locator('#dailyDate').dispatchEvent('change');
    await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 0, { timeout: 5000 });
    assert.equal(Number(await page.locator('#dailySwap').inputValue()), 0, `${date} must display 0 swap`);
  }

  await page.locator('#dailyDate').fill('2026-07-13');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 117.5, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-07-10表記 → 2026-07-13計上/, 'Monday note must show Friday source date');
  console.log('weekend daily input 0 / Monday Friday-source auto-fill: PASS');

  // Source-date entitlement is the important rule:
  // opening day's source swap is excluded, closing day's source swap is included.
  // Open positions recognize an eligible source row when its shifted credit date arrives;
  // a closed trade recognizes its closing source-date row in realized PnL immediately.
  const sourceRules = await page.evaluate(() => ({
    openedFridayThroughMonday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-10', side:'short', lots:1 }, '2026-07-13'),
    openedThursdayThroughFriday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-09', side:'short', lots:1 }, '2026-07-10'),
    openedThursdayClosedFriday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-09', closeDate:'2026-07-10', side:'short', lots:1 }, '2026-07-10'),
    openedFridayClosedMonday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-10', closeDate:'2026-07-13', side:'short', lots:1 }, '2026-07-13'),
    fridayEligibleWhenOpenedThursday: window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__?.({ date:'2026-07-09', side:'short', lots:1 }, '2026-07-10'),
    fridayEligibleWhenOpenedFriday: window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__?.({ date:'2026-07-10', side:'short', lots:1 }, '2026-07-10')
  }));
  assert.equal(sourceRules.openedFridayThroughMonday, 0, 'position opened Friday must not receive Friday source swap on Monday');
  assert.equal(sourceRules.openedThursdayThroughFriday, 0, `open position must not recognize Friday source before Monday credit: ${sourceRules.openedThursdayThroughFriday}`);
  assert.ok(Math.abs(sourceRules.openedThursdayClosedFriday - 117.5) < 1e-9, `closing-day source swap was not included correctly: ${sourceRules.openedThursdayClosedFriday}`);
  assert.ok(Math.abs(sourceRules.openedFridayClosedMonday - 231.02) < 1e-9, `opening-day exclusion / closing-day inclusion is wrong: ${sourceRules.openedFridayClosedMonday}`);
  assert.equal(sourceRules.fridayEligibleWhenOpenedThursday, true, 'Friday source should belong to a position opened before Friday');
  assert.equal(sourceRules.fridayEligibleWhenOpenedFriday, false, 'Friday source must not belong to a position opened Friday');
  console.log('source-date opening exclusion + closing inclusion: PASS');

  // Use a position opened before Friday so the Friday source amount legitimately posts Monday.
  await page.evaluate(() => {
    document.getElementById('positionDate').value = '2026-07-09';
    document.getElementById('positionSide').value = 'short';
    document.getElementById('entryRate').value = '48.0000';
    document.getElementById('entryLots').value = '1';
    document.getElementById('positionMemo').value = 'weekend credit e2e';
    document.getElementById('positionForm').requestSubmit();
  });
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return Array.isArray(saved.positions) && saved.positions.some((p) => p.date === '2026-07-09' && p.side === 'short' && Number(p.lots) === 1);
  }, { timeout: 10000 });

  const dailyPosting = await page.evaluate(() => window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__?.('2026-07-13'));
  assert.ok(Math.abs(dailyPosting - 117.5) < 1e-9, `Monday posting should be Friday 117.5 for pre-Friday position: ${dailyPosting}`);

  await page.locator('[data-tab="calendar"]').click();
  // Historical rate backfill currently lands in September; move to July.
  for (let i = 0; i < 2; i += 1) await page.locator('#prevMonthBtn').click();
  assert.match(await page.locator('#calendarTitle').innerText(), /2026\s*\/\s*07/, 'calendar did not move to July 2026');
  const monday = page.locator('.calendar-day[data-date="2026-07-13"]');
  assert.equal(await monday.count(), 1, 'July 13 Monday calendar cell is missing');
  const mondayValues = await monday.locator('.calendar-value-mobile').allTextContents();
  assert.ok(mondayValues.some((value) => /¥117/.test(value)), `Monday calendar must show Friday swap ¥117: ${mondayValues.join(' | ')}`);
  console.log('calendar Monday shows eligible Friday source swap: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE WEEKEND E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
