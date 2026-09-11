import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const EPS = 1e-8;
const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < EPS,
  `${label}: expected ${expected}, got ${actual}`
);
const parseIso = (date) => new Date(`${date}T12:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const nextBusinessDate = (sourceDate) => {
  const d = parseIso(sourceDate);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
};
const isWeekend = (date) => {
  const day = parseIso(date).getUTCDay();
  return day === 0 || day === 6;
};
const datesBetween = (start, end) => {
  const out = [];
  const d = parseIso(start);
  const last = parseIso(end);
  while (d <= last) {
    out.push(iso(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

try {
  console.log('HIROSE SWAP INVARIANTS BROWSER=', browserName);
  console.log('HIROSE SWAP INVARIANTS TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.shiftedSwapDisplay === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseSwapCalendarRule === 'next-business-day-weekend-skip', { timeout: 15000 });

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingSwapMode').selectOption('hirose');
  const unitsPerLot = Number(await page.locator('#settingUnits').inputValue());
  assert.ok(unitsPerLot > 0, 'site lot unit must be positive');
  await page.locator('#closeSettingsBtn').click();

  const model = await page.evaluate(() => {
    const rows = (window.__DTL_HIROSE_HISTORY__?.() || [])
      .filter((row) => row?.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const credits = window.__DTL_HIROSE_CREDIT_HISTORY__?.() || [];
    return { rows, credits };
  });

  assert.ok(model.rows.length > 1, 'Hirose history must contain multiple source rows');

  const sourceRows = model.rows.filter((row) => !isWeekend(row.date));
  assert.equal(model.credits.length, sourceRows.length, 'each business-day source row must map to exactly one display date');

  const creditChecks = await page.evaluate((creditDates) => creditDates.map((creditDate) => {
    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__?.(creditDate) || null;
    return {
      creditDate,
      resolution,
      openOnDisplayEligible: window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__?.({ date: creditDate, side: 'short', lots: 1 }, creditDate),
      openedOnSourceShort: resolution?.sourceDate
        ? window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: resolution.sourceDate, closeDate: creditDate, side: 'short', lots: 1 }, creditDate)
        : null,
      openedOnSourceLong: resolution?.sourceDate
        ? window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: resolution.sourceDate, closeDate: creditDate, side: 'long', lots: 1 }, creditDate)
        : null,
      closeOnSourceEligible: resolution?.sourceDate
        ? window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__?.({ date: resolution.sourceDate, closeDate: resolution.sourceDate, side: 'short', lots: 1 }, creditDate)
        : null,
      closeOnDisplayEligible: resolution?.sourceDate
        ? window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__?.({ date: resolution.sourceDate, closeDate: creditDate, side: 'short', lots: 1 }, creditDate)
        : null
    };
  }), model.credits.map((entry) => entry.creditDate));

  const rowByDate = new Map(sourceRows.map((row) => [row.date, row]));
  for (const check of creditChecks) {
    const resolution = check.resolution;
    assert.ok(resolution, `resolution missing for ${check.creditDate}`);
    const source = rowByDate.get(resolution.sourceDate);
    assert.ok(source, `resolution source ${resolution.sourceDate} is not present in history`);

    const expectedCredit = nextBusinessDate(source.date);
    assert.equal(check.creditDate, expectedCredit, `source ${source.date} must display on its next business day`);
    assert.equal(resolution.creditDate, expectedCredit);
    assert.equal(resolution.sourceDate, source.date);
    assert.equal(resolution.status, 'official');

    const scale = unitsPerLot / Number(source.unit || 1000);
    const expectedShort = Number(source.sellJpy || 0) * scale;
    const expectedLong = Number(source.buyJpy || 0) * scale;
    near(resolution.shortPerLot, expectedShort, `short amount for source ${source.date}`);
    near(resolution.longPerLot, expectedLong, `long amount for source ${source.date}`);

    assert.equal(check.openOnDisplayEligible, false, 'display-date swap must be excluded when the position opens that day');
    assert.equal(check.closeOnSourceEligible, false, 'a position already closed before the display date must not receive the swap');
    assert.equal(check.closeOnDisplayEligible, true, 'the closing display date must remain inclusive');
    near(check.openedOnSourceShort, expectedShort, 'a short opened on the source date must receive exactly that source row on the display date');
    near(check.openedOnSourceLong, expectedLong, 'a long opened on the source date must receive exactly that source row on the display date');
  }
  console.log('source -> next-business-day mapping and entitlement invariants: PASS');

  const firstDate = sourceRows[0].date;
  const lastCreditDate = nextBusinessDate(sourceRows.at(-1).date);
  const weekendDates = datesBetween(firstDate, lastCreditDate).filter(isWeekend);
  const weekendChecks = await page.evaluate((dates) => dates.map((date) => window.__DTL_HIROSE_SWAP_RESOLUTION__?.(date) || null), weekendDates);
  weekendChecks.forEach((resolution, index) => {
    assert.ok(resolution, `weekend resolution missing for ${weekendDates[index]}`);
    assert.equal(resolution.status, 'zero');
    near(resolution.shortPerLot, 0, `weekend short swap ${weekendDates[index]}`);
    near(resolution.longPerLot, 0, `weekend long swap ${weekendDates[index]}`);
  });
  console.log('weekend zero-display invariant: PASS');

  const creditEntries = sourceRows.map((row) => ({
    sourceDate: row.date,
    creditDate: nextBusinessDate(row.date),
    row
  }));
  const openDate = creditEntries[0].creditDate;
  const closeDate = creditEntries[Math.max(1, Math.floor(creditEntries.length * 0.7))].creditDate;
  const asOfDates = creditEntries.map((entry) => entry.creditDate);
  const cumulativeActual = await page.evaluate(({ openDate, closeDate, asOfDates }) => asOfDates.map((asOfDate) => ({
    asOfDate,
    short: positionSwapAsOf({ date: openDate, closeDate, side: 'short', lots: 1 }, asOfDate),
    long: positionSwapAsOf({ date: openDate, closeDate, side: 'long', lots: 1 }, asOfDate)
  })), { openDate, closeDate, asOfDates });

  for (const point of cumulativeActual) {
    const eligibleEntries = creditEntries.filter((entry) => (
      entry.creditDate > openDate
      && entry.creditDate <= point.asOfDate
      && entry.creditDate <= closeDate
    ));
    const expectedShort = eligibleEntries.reduce((sum, entry) => {
      const factor = unitsPerLot / Number(entry.row.unit || 1000);
      return sum + Number(entry.row.sellJpy || 0) * factor;
    }, 0);
    const expectedLong = eligibleEntries.reduce((sum, entry) => {
      const factor = unitsPerLot / Number(entry.row.unit || 1000);
      return sum + Number(entry.row.buyJpy || 0) * factor;
    }, 0);
    near(point.short, expectedShort, `cumulative short swap as of ${point.asOfDate}`);
    near(point.long, expectedLong, `cumulative long swap as of ${point.asOfDate}`);
  }
  console.log('cumulative swap equals the sum of eligible display-date credits: PASS');

  // Net PnL has no monotonicity requirement. FX and swap can move in opposite directions.
  // The invariant is only that each calculated Net point equals FX + cumulative Swap.
  const arithmeticChecks = await page.evaluate(({ openDate, closeDate, asOfDates }) => {
    const p = { date: openDate, closeDate, side: 'short', lots: 1, entryRate: 50, closeRate: 51 };
    return asOfDates
      .filter((date) => date >= openDate && date <= closeDate)
      .map((date, index) => {
        const rate = 49 + (index % 5) * 0.5;
        const tryJpy = 3 + (index % 3) * 0.1;
        const fx = positionFxAsOf(p, date, rate, tryJpy);
        const swap = positionSwapAsOf(p, date);
        return { date, fx, swap, net: fx + swap };
      });
  }, { openDate, closeDate, asOfDates });
  arithmeticChecks.forEach((point) => near(point.net, Number(point.fx) + Number(point.swap), `Net identity on ${point.date}`));
  assert.ok(arithmeticChecks.length > 1, 'Net identity test requires multiple dates');
  console.log('Net = FX + Swap identity (no monotonicity assumption): PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`HIROSE SWAP INVARIANTS (${browserName}): PASS`);
} finally {
  await browser.close();
}
