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
  console.log('HIROSE SAME-DAY BROWSER=', browserName);
  console.log('HIROSE SAME-DAY TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.sameDaySwapValuation === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapCalendarRule === 'same-day-table-date', { timeout: 15000 });

  const mapping = await page.evaluate(() => ({
    friday: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-10') || null,
    saturday: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-11') || null,
    sunday: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-12') || null,
    monday: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-13') || null,
    identityCredit: window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__?.('2026-07-10')
  }));
  assert.equal(mapping.identityCredit, '2026-07-10', 'broker table date must no longer shift to the next business day');
  assert.equal(mapping.friday?.sourceDate, '2026-07-10');
  assert.equal(mapping.friday?.creditDate, '2026-07-10');
  assert.equal(mapping.friday?.shortPerLot, 117.5, 'Friday row must credit Friday');
  assert.equal(mapping.saturday?.status, 'zero', 'Saturday must be zero');
  assert.equal(mapping.sunday?.status, 'zero', 'Sunday must be zero');
  assert.equal(mapping.monday?.sourceDate, '2026-07-13');
  assert.equal(mapping.monday?.creditDate, '2026-07-13');
  assert.equal(mapping.monday?.shortPerLot, 231.02, 'Monday must use Monday table row, not Friday');
  assert.equal(mapping.monday?.row?.days, 2, 'exceptional 2-day row must stay on its published date');
  console.log('broker table date -> same calendar date: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="daily"]').click();

  await page.locator('#dailyDate').fill('2026-07-10');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 117.5, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-07-10付与/, 'Friday note must show same-day credit');

  for (const date of ['2026-07-11', '2026-07-12']) {
    await page.locator('#dailyDate').fill(date);
    await page.locator('#dailyDate').dispatchEvent('change');
    await page.waitForFunction(() => Number(document.querySelector('#dailySwap')?.value) === 0, { timeout: 5000 });
  }

  await page.locator('#dailyDate').fill('2026-07-13');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#dailySwap')?.value) - 231.02) < 1e-9, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-07-13付与/, 'Monday note must show Monday credit');
  console.log('daily swap input uses same-day broker row: PASS');

  const entitlement = await page.evaluate(() => ({
    openedThursdayFriday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-09', side:'short', lots:1 }, '2026-07-10'),
    openedWednesdayThursday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-08', side:'short', lots:1 }, '2026-07-09'),
    openedThursdayClosedFriday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-09', closeDate:'2026-07-10', side:'short', lots:1 }, '2026-07-10'),
    openedFridayClosedMonday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-10', closeDate:'2026-07-13', side:'short', lots:1 }, '2026-07-13'),
    sameDayExcluded: window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__?.({ date:'2026-07-10', side:'short', lots:1 }, '2026-07-10')
  }));
  assert.ok(Math.abs(entitlement.openedThursdayFriday - 117.5) < 1e-9, `Friday same-day credit wrong: ${entitlement.openedThursdayFriday}`);
  assert.ok(Math.abs(entitlement.openedWednesdayThursday - 291.31) < 1e-9, `Thursday 3-day credit wrong: ${entitlement.openedWednesdayThursday}`);
  assert.ok(Math.abs(entitlement.openedThursdayClosedFriday - 117.5) < 1e-9, `closing-date inclusion wrong: ${entitlement.openedThursdayClosedFriday}`);
  assert.ok(Math.abs(entitlement.openedFridayClosedMonday - 231.02) < 1e-9, `Monday 2-day credit wrong: ${entitlement.openedFridayClosedMonday}`);
  assert.equal(entitlement.sameDayExcluded, false, 'opening calendar date must stay excluded');
  console.log('same-day entitlement / open-exclusive / close-inclusive: PASS');

  // Exact regression from the production screenshot: a 155-lot short opened on
  // 2026-09-04 must NOT inherit the 2026-09-03 four-day swap (473.94/lot).
  // The 9/4 broker row itself is zero, so cumulative swap starts at zero and only
  // 9/7, 9/8 and 9/9 accrue before the 9/10 close.
  const sep4Position = await page.evaluate(() => {
    const p = { date:'2026-09-04', closeDate:'2026-09-10', side:'short', lots:155 };
    const dates = ['2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10'];
    return {
      eligibleSep4: window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__?.(p, '2026-09-04'),
      helper: dates.map((date) => window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.(p, date)),
      chartPath: dates.map((date) => positionSwapAsOf(p, date))
    };
  });
  const expectedSep4 = [0, 116.22 * 155, (116.22 + 115.85) * 155, (116.22 + 115.85 + 110.42) * 155, (116.22 + 115.85 + 110.42) * 155];
  assert.equal(sep4Position.eligibleSep4, false, '9/4 opening date must not earn swap');
  sep4Position.helper.forEach((value, index) => assert.ok(Math.abs(value - expectedSep4[index]) < 1e-8, `9/4 helper regression at index ${index}: ${value}`));
  sep4Position.chartPath.forEach((value, index) => assert.ok(Math.abs(value - expectedSep4[index]) < 1e-8, `9/4 chart/summary regression at index ${index}: ${value}`));
  assert.ok(Math.abs(sep4Position.chartPath.at(-1) - 53085.95) < 1e-8, `9/4 position cumulative swap must be 53,085.95 before 9/10 close, got ${sep4Position.chartPath.at(-1)}`);
  console.log('9/4 155-lot screenshot regression: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE SAME-DAY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
