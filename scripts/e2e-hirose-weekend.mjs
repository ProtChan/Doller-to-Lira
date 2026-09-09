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
  assert.equal(mapping.mondayCredit?.row?.sellJpy, 117.5, 'Friday 2026-07-10 sell swap must credit Monday');
  assert.equal(mapping.saturdayResolution?.status, 'zero', 'Saturday daily input must resolve to zero swap');
  assert.equal(mapping.saturdayResolution?.weekend, true, 'Saturday must be marked as weekend zero');
  assert.equal(mapping.sundayResolution?.status, 'zero', 'Sunday daily input must resolve to zero swap');
  assert.equal(mapping.sundayResolution?.weekend, true, 'Sunday must be marked as weekend zero');
  assert.equal(mapping.mondayResolution?.status, 'official', 'Monday must resolve to Friday official row');
  assert.equal(mapping.mondayResolution?.sourceDate, '2026-07-10', 'Monday input must reference Friday source date');
  assert.equal(mapping.mondayResolution?.shortPerLot, 117.5, 'Monday input must receive Friday 117.5 JPY');
  console.log('Friday -> Monday mapping and weekend zero: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-07-11');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 0, { timeout: 5000 });
  assert.equal(Number(await page.locator('#dailySwap').inputValue()), 0, 'Saturday input must display 0 swap');

  await page.locator('#dailyDate').fill('2026-07-12');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 0, { timeout: 5000 });
  assert.equal(Number(await page.locator('#dailySwap').inputValue()), 0, 'Sunday input must display 0 swap');

  await page.locator('#dailyDate').fill('2026-07-13');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 117.5, { timeout: 5000 });
  await page.waitForFunction(() => /2026-07-10表記 → 2026-07-13計上/.test(document.querySelector('#dailySwap')?.closest('label')?.innerText || ''), { timeout: 5000 });
  assert.equal(Number(await page.locator('#dailySwap').inputValue()), 117.5, 'Monday input must display Friday swap');
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-07-10表記 → 2026-07-13計上/, 'Monday note must show Friday source date');
  console.log('weekend daily input 0 / Monday Friday-source auto-fill: PASS');

  // Submit the existing position form programmatically. This exercises the app's real
  // save handler without relying on a WebKit-sensitive click/re-render sequence.
  await page.evaluate(() => {
    document.getElementById('positionDate').value = '2026-07-10';
    document.getElementById('positionSide').value = 'short';
    document.getElementById('entryRate').value = '48.0000';
    document.getElementById('entryLots').value = '1';
    document.getElementById('positionMemo').value = 'weekend credit e2e';
    document.getElementById('positionForm').requestSubmit();
  });
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return Array.isArray(saved.positions) && saved.positions.some((p) => p.date === '2026-07-10' && p.side === 'short' && Number(p.lots) === 1);
  }, { timeout: 10000 });

  const positionRules = await page.evaluate(() => ({
    throughFriday: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-10', side: 'short', lots: 1 }, '2026-07-10'),
    throughSaturday: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-10', side: 'short', lots: 1 }, '2026-07-11'),
    throughSunday: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-10', side: 'short', lots: 1 }, '2026-07-12'),
    throughMonday: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-10', side: 'short', lots: 1 }, '2026-07-13'),
    openedMonday: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-13', side: 'short', lots: 1 }, '2026-07-13'),
    closedMonday: window.__DTL_HIROSE_POSITION_SWAP__?.({ date: '2026-07-10', closeDate: '2026-07-13', side: 'short', lots: 1 }, '2026-07-13')
  }));
  assert.equal(positionRules.throughFriday, 0, 'Friday source amount must not be credited on Friday itself');
  assert.equal(positionRules.throughSaturday, 0, 'Friday source amount must not be credited on Saturday');
  assert.equal(positionRules.throughSunday, 0, 'Friday source amount must not be credited on Sunday');
  assert.equal(positionRules.throughMonday, 117.5, 'Friday source amount must be credited Monday');
  assert.equal(positionRules.openedMonday, 0, 'position opened Monday must not receive Monday credit');
  assert.equal(positionRules.closedMonday, 117.5, 'position closed Monday must receive Monday credit');
  console.log('weekend accrual + open-day exclusion + close-day inclusion: PASS');

  await page.locator('[data-tab="calendar"]').click();
  // Historical rate backfill currently ends in September, so move September -> August -> July.
  await page.locator('#prevMonthBtn').click();
  await page.locator('#prevMonthBtn').click();
  assert.match(await page.locator('#calendarTitle').innerText(), /2026\s*\/\s*07/, 'calendar did not move to July 2026');
  const monday = page.locator('.calendar-day[data-date="2026-07-13"]');
  assert.equal(await monday.count(), 1, 'July 13 Monday calendar cell is missing');
  const mondayValues = await monday.locator('.calendar-value-mobile').allTextContents();
  assert.ok(mondayValues.some((value) => /¥117/.test(value)), `Monday calendar must show Friday swap ¥117: ${mondayValues.join(' | ')}`);
  console.log('calendar Monday shows Friday swap instead of weekend: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE WEEKEND E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
