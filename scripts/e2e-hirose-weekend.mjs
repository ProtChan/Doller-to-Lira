import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const near = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - Number(expected)) < 1e-8, `${label}: expected ${expected}, got ${actual}`);

try {
  console.log('HIROSE SHIFTED-DISPLAY BROWSER=', browserName);
  console.log('HIROSE SHIFTED-DISPLAY TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapCalendarRule === 'next-business-day-weekend-skip', { timeout: 15000 });

  const mapping = await page.evaluate(() => ({
    fridayCredit: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-10') || null,
    saturday: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-11') || null,
    sunday: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-12') || null,
    mondayCredit: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-13') || null,
    tuesdayCredit: window.__DTL_HIROSE_SWAP_RESOLUTION__?.('2026-07-14') || null,
    fridaySourceCredit: window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__?.('2026-07-10')
  }));
  assert.equal(mapping.fridaySourceCredit, '2026-07-13', 'Friday source row must display on Monday');
  assert.equal(mapping.fridayCredit?.sourceDate, '2026-07-09');
  assert.equal(mapping.fridayCredit?.creditDate, '2026-07-10');
  near(mapping.fridayCredit?.shortPerLot, 291.31, '7/10 display must use 7/9 source row');
  assert.equal(mapping.saturday?.status, 'zero');
  assert.equal(mapping.sunday?.status, 'zero');
  assert.equal(mapping.mondayCredit?.sourceDate, '2026-07-10');
  near(mapping.mondayCredit?.shortPerLot, 117.5, '7/13 display must use Friday 7/10 source row');
  assert.equal(mapping.tuesdayCredit?.sourceDate, '2026-07-13');
  near(mapping.tuesdayCredit?.shortPerLot, 231.02, '7/14 display must use Monday 7/13 source row');
  assert.equal(mapping.tuesdayCredit?.row?.days, 2);
  console.log('broker source row -> following business-day display: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="daily"]').click();

  await page.locator('#dailyDate').fill('2026-09-09');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#dailySwap')?.value) - 115.85) < 1e-9, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-09-08表記.*2026-09-09表示/, '9/9 input must visibly use the 9/8 broker row');

  await page.locator('#dailyDate').fill('2026-09-10');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#dailySwap')?.value) - 110.42) < 1e-9, { timeout: 5000 });
  assert.match(await page.locator('#dailySwap').locator('xpath=..').innerText(), /2026-09-09表記.*2026-09-10表示/, '9/10 input must visibly use the 9/9 broker row');
  console.log('daily input follows shifted display dates: PASS');

  const entitlement = await page.evaluate(() => ({
    openOnCreditExcluded: window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__?.({ date:'2026-07-10', side:'short', lots:1 }, '2026-07-10'),
    openDaySourceEarnedNextBusinessDay: window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__?.({ date:'2026-07-10', side:'short', lots:1 }, '2026-07-10'),
    closeDayIncluded: window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__?.({ date:'2026-07-10', closeDate:'2026-07-13', side:'short', lots:1 }, '2026-07-13'),
    openFridayAsOfMonday: window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date:'2026-07-10', closeDate:'2026-07-13', side:'short', lots:1 }, '2026-07-13')
  }));
  assert.equal(entitlement.openOnCreditExcluded, false, 'a swap displayed on the opening date must be excluded');
  assert.equal(entitlement.openDaySourceEarnedNextBusinessDay, true, 'the opening-date source row is eligible when it appears on the next business day');
  assert.equal(entitlement.closeDayIncluded, true, 'the closing display date remains inclusive');
  near(entitlement.openFridayAsOfMonday, 117.5, 'Friday-open position should first show Friday source swap on Monday');
  console.log('display-date open-exclusive / close-inclusive entitlement: PASS');

  const regressions = await page.evaluate(() => {
    const sep4 = { date:'2026-09-04', closeDate:'2026-09-10', side:'short', lots:155 };
    const sep8 = { date:'2026-09-08', closeDate:'2026-09-10', side:'short', lots:5 };
    const sep9 = { date:'2026-09-09', closeDate:'2026-09-10', side:'short', lots:5 };
    return {
      sep4: ['2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10'].map((date) => positionSwapAsOf(sep4, date)),
      sep8: ['2026-09-08','2026-09-09','2026-09-10'].map((date) => positionSwapAsOf(sep8, date)),
      sep9: ['2026-09-09','2026-09-10'].map((date) => positionSwapAsOf(sep9, date))
    };
  });

  const expectedSep4 = [0, 0, 116.22 * 155, (116.22 + 115.85) * 155, (116.22 + 115.85 + 110.42) * 155];
  regressions.sep4.forEach((value, i) => near(value, expectedSep4[i], `9/4 155-lot shifted path index ${i}`));
  near(regressions.sep4.at(-1), 53085.95, '9/4 total must remain unchanged');

  const expectedSep8 = [0, 115.85 * 5, (115.85 + 110.42) * 5];
  regressions.sep8.forEach((value, i) => near(value, expectedSep8[i], `9/8 5-lot screenshot path index ${i}`));
  near(regressions.sep8.at(-1), 1131.35, '9/8 position total');

  const expectedSep9 = [0, 110.42 * 5];
  regressions.sep9.forEach((value, i) => near(value, expectedSep9[i], `9/9 5-lot screenshot path index ${i}`));
  near(regressions.sep9.at(-1), 552.1, '9/9 position total');
  console.log('9/4, 9/8 and 9/9 production regressions: PASS');

  const finalDayNet = await page.evaluate(() => {
    const p = {
      date: '2026-09-04', closeDate: '2026-09-10', side: 'short', lots: 155,
      entryRate: 48.4409, closeRate: 48.4970, closeTryJpy: 3.174
    };
    const rate9 = 48.4787;
    const tryJpy9 = 153.21 / rate9;
    const fx9 = positionFxAsOf(p, '2026-09-09', rate9, tryJpy9);
    const swap9 = positionSwapAsOf(p, '2026-09-09');
    const fx10 = positionFxAsOf(p, '2026-09-10', 48.4970, 3.174);
    const swap10 = positionSwapAsOf(p, '2026-09-10');
    return { fx9, swap9, net9: fx9 + swap9, fx10, swap10, net10: fx10 + swap10 };
  });
  near(finalDayNet.swap9, 35970.85, '9/9 cumulative swap');
  near(finalDayNet.swap10, 53085.95, '9/10 cumulative swap');
  near(finalDayNet.net10, 25486.433, '9/10 final net');
  assert.ok(finalDayNet.net10 > finalDayNet.net9, `final-day net must rise after 9/10 swap credit: 9/9=${finalDayNet.net9}, 9/10=${finalDayNet.net10}`);
  console.log('155-lot final-day net return no artificial drop: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE SHIFTED-DISPLAY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
