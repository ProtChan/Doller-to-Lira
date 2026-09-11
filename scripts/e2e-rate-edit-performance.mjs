import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

try {
  const started = Date.now();
  console.log('RATE/EDIT/PERF INVARIANTS BROWSER=', browserName);
  console.log('RATE/EDIT/PERF INVARIANTS TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.rateEditPerformance === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.userPreparedRateReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.rateSourceSimplified === '1', { timeout: 15000 });
  console.log('startup appReady ms=', Date.now() - started);

  const markers = await page.evaluate(() => ({
    runtime: document.documentElement.dataset.runtimeBuild,
    rateChoice: document.documentElement.dataset.rateSourceChoice,
    simplified: document.documentElement.dataset.rateSourceSimplified,
    editing: document.documentElement.dataset.positionEditing,
    cache: document.documentElement.dataset.performanceCache,
    derivedCache: document.documentElement.dataset.derivedCache,
    fastLc: document.documentElement.dataset.fastLc,
    prepared: document.documentElement.dataset.userPreparedRateReady
  }));
  assert.equal(markers.rateChoice, '1');
  assert.equal(markers.simplified, '1');
  assert.equal(markers.editing, '1');
  assert.equal(markers.cache, '1');
  assert.equal(markers.derivedCache, '1');
  assert.equal(markers.fastLc, '1');
  assert.equal(markers.prepared, '1');

  const fixture = await page.evaluate(() => {
    const prepared = (window.__DTL_USER_PREPARED_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTry) > 0 && Number(row.usdJpy) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const hirose = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const preparedDates = new Set(prepared.map((row) => row.date));
    const fetched = hirose.find((row) => !preparedDates.has(row.date)) || null;
    return {
      prepared: prepared[0] || null,
      fetched,
      earliestDate: [...prepared.map((row) => row.date), ...hirose.map((row) => row.date)].sort()[0] || '',
      positionRate: Number((hirose[0] || prepared[0])?.usdTryAskClose23 || prepared[0]?.usdTry || 0)
    };
  });
  assert.ok(fixture.prepared, 'at least one user-prepared Hirose row is required');
  assert.ok(fixture.fetched, 'at least one fetched-only Hirose row is required');
  assert.ok(fixture.earliestDate && fixture.positionRate > 0, 'dynamic rate/edit fixture is incomplete');

  await page.locator('#openSettingsBtn').click();
  const options = await page.locator('#settingRateSource option').allTextContents();
  assert.deepEqual(options, ['自動', '手入力']);
  assert.match(await page.locator('#settingRateSource').locator('xpath=..').innerText(), /レート入力/);
  assert.match(await page.locator('#rateSourceStatus').innerText(), /ヒロセ23:00 ASK/);
  await page.locator('#closeSettingsBtn').click();

  await page.locator('[data-tab="daily"]').click();

  // Auto mode must treat user-prepared and fetched Hirose rows as one logical source.
  await page.locator('#dailyDate').fill(fixture.prepared.date);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#dailyRate')?.dataset.rateSource === 'auto');
  near(await page.locator('#dailyRate').inputValue(), fixture.prepared.usdTry, 'prepared Hirose USDTRY auto-fill');
  near(await page.locator('#dailyUsdJpy').inputValue(), fixture.prepared.usdJpy, 'prepared Hirose USDJPY auto-fill');
  const autoPrepared = await page.evaluate((date) => window.__DTL_AUTO_RATE_AT__?.(date) || null, fixture.prepared.date);
  assert.equal(autoPrepared?.date, fixture.prepared.date);
  near(autoPrepared?.rate, fixture.prepared.usdTry, 'prepared auto resolver USDTRY');
  near(autoPrepared?.usdJpy, fixture.prepared.usdJpy, 'prepared auto resolver USDJPY');
  assert.equal(autoPrepared?.origin, 'hirose-supplied');
  assert.match(await page.locator('#dailyRate').locator('xpath=..').innerText(), /自動.*ヒロセ/);
  console.log('auto supplied-Hirose source: PASS');

  await page.locator('#dailyDate').fill(fixture.fetched.date);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#dailyRate')?.dataset.rateSource === 'auto');
  const hiroseCompare = await page.evaluate((date) => ({
    inputRate: Number(document.querySelector('#dailyRate')?.value),
    inputUsdJpy: Number(document.querySelector('#dailyUsdJpy')?.value),
    source: window.__DTL_HIROSE_RATE_AT__?.(date) || null,
    auto: window.__DTL_AUTO_RATE_AT__?.(date) || null
  }), fixture.fetched.date);
  assert.ok(hiroseCompare.source, 'fetched Hirose historical rate source missing');
  near(hiroseCompare.inputRate, hiroseCompare.source.usdTryAskClose23, 'fetched Hirose USDTRY auto-fill');
  near(hiroseCompare.inputUsdJpy, hiroseCompare.source.usdJpyAskClose23, 'fetched Hirose USDJPY auto-fill');
  assert.equal(hiroseCompare.auto?.origin, 'hirose');
  console.log('auto fetched-Hirose source: PASS');

  // Manual mode on a date before every known source must start empty and persist user input.
  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingRateSource').selectOption('manual');
  await page.locator('#closeSettingsBtn').click();
  const missingDate = addDays(fixture.earliestDate, -1);
  await page.locator('#dailyDate').fill(missingDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#dailyRate').inputValue(), '');
  assert.equal(await page.locator('#dailyUsdJpy').inputValue(), '');
  assert.match(await page.locator('#dailyRate').locator('xpath=..').innerText(), /手入力/);

  // Match the actual HTML input steps so native form validation allows submit.
  const manualRate = Number((fixture.positionRate * 1.007).toFixed(4));
  const manualUsdJpy = Number((Number(fixture.fetched.usdJpyAskClose23) * 1.003).toFixed(3));
  const manualSwap = 100.25;
  await page.locator('#dailyRate').fill(String(manualRate));
  await page.locator('#dailyUsdJpy').fill(String(manualUsdJpy));
  await page.locator('#dailySwap').fill(String(manualSwap));
  await page.locator('#dailyForm button[type="submit"]').click();

  const adjacentMissingDate = addDays(missingDate, -1);
  await page.locator('#dailyDate').fill(adjacentMissingDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForTimeout(40);
  await page.locator('#dailyDate').fill(missingDate);
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#dailyRate')?.dataset.rateSource === 'manual');
  near(await page.locator('#dailyRate').inputValue(), manualRate, 'manual rate save/reload');
  near(await page.locator('#dailyUsdJpy').inputValue(), manualUsdJpy, 'manual USDJPY save/reload');
  console.log('manual rate save/reload: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingRateSource').selectOption('auto');
  assert.deepEqual(await page.locator('#settingRateSource option').allTextContents(), ['自動', '手入力']);
  await page.locator('#closeSettingsBtn').click();

  // Position editing is tested as a transformation from the saved value, not a production position fixture.
  const initialLots = 1;
  const editedLots = initialLots * 2.5;
  const editedRate = Number((fixture.positionRate * 0.99).toFixed(4));
  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill(fixture.earliestDate);
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill(String(fixture.positionRate));
  await page.locator('#entryLots').fill(String(initialLots));
  await page.locator('#positionMemo').fill('before edit');
  await page.locator('#positionForm button[type="submit"]').click();
  await page.waitForSelector('#detailEditBtn');
  await page.locator('#detailEditBtn').click();
  await page.waitForFunction(() => document.querySelector('#editPositionDialog')?.open === true);
  await page.locator('#editPositionRate').fill(String(editedRate));
  await page.locator('#editPositionLots').fill(String(editedLots));
  await page.locator('#editPositionMemo').fill('after edit');
  await page.locator('#editPositionForm button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#editPositionDialog')?.open === false);
  await page.waitForSelector('#detailEditBtn');
  await page.locator('#detailEditBtn').click();
  near(await page.locator('#editPositionRate').inputValue(), editedRate, 'edited position rate');
  near(await page.locator('#editPositionLots').inputValue(), editedLots, 'edited position lots');
  assert.equal(await page.locator('#editPositionMemo').inputValue(), 'after edit');
  await page.locator('#cancelEditPositionBtn').click();
  console.log('open position editing transformation: PASS');

  const perf = await page.evaluate(() => window.__DTL_PERF_STATS__?.());
  assert.ok(perf, 'performance stats unavailable');
  assert.ok(perf.derivedComputations >= 1, `derived computations invalid: ${JSON.stringify(perf)}`);
  assert.ok(perf.derivedCacheHits >= 1, `derived cache was never used: ${JSON.stringify(perf)}`);
  assert.ok(Number.isFinite(perf.lastDerivedMs));
  assert.ok(Number.isFinite(perf.lastRenderMs));
  console.log('performance stats=', perf);

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`RATE/EDIT/PERF INVARIANTS E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
