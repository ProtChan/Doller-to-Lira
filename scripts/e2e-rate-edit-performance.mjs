import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  const started = Date.now();
  console.log('RATE/EDIT/PERF BROWSER=', browserName);
  console.log('RATE/EDIT/PERF TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.rateEditPerformance === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.userPreparedRateReady === '1', { timeout: 15000 });
  console.log('startup appReady ms=', Date.now() - started);

  const markers = await page.evaluate(() => ({
    runtime: document.documentElement.dataset.runtimeBuild,
    rateChoice: document.documentElement.dataset.rateSourceChoice,
    editing: document.documentElement.dataset.positionEditing,
    cache: document.documentElement.dataset.performanceCache,
    derivedCache: document.documentElement.dataset.derivedCache,
    fastLc: document.documentElement.dataset.fastLc,
    prepared: document.documentElement.dataset.userPreparedRateReady
  }));
  assert.equal(markers.runtime, '20260909-0303');
  assert.equal(markers.rateChoice, '1');
  assert.equal(markers.editing, '1');
  assert.equal(markers.cache, '1');
  assert.equal(markers.derivedCache, '1');
  assert.equal(markers.fastLc, '1');
  assert.equal(markers.prepared, '1');

  // Explicit historical-rate source choices.
  await page.locator('#openSettingsBtn').click();
  const options = await page.locator('#settingRateSource option').allTextContents();
  assert.deepEqual(options, ['保存済み優先 → ヒロセ', 'こちらが用意したレート', '過去の保存済みレート', 'ヒロセ 23:00 ASK']);
  await page.locator('#settingRateSource').selectOption('prepared');
  await page.locator('#closeSettingsBtn').click();

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDate').fill('2026-09-08');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#dailyRate')?.dataset.rateSource === 'prepared');
  assert.equal(await page.locator('#dailyRate').inputValue(), '48.4610');
  assert.equal(await page.locator('#dailyUsdJpy').inputValue(), '154.005');
  const prepared = await page.evaluate(() => window.__DTL_USER_PREPARED_RATE_AT__?.('2026-09-08') || null);
  assert.deepEqual(prepared, { date: '2026-09-08', usdTry: 48.461, usdJpy: 154.005 });
  console.log('user-prepared Sep 8 rate source: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingRateSource').selectOption('saved');
  await page.locator('#closeSettingsBtn').click();

  await page.locator('#dailyDate').fill('2026-06-30');
  await page.locator('#dailyDate').dispatchEvent('change');
  // Date-source listeners settle on a zero-delay timer. A real user cannot type
  // before that turn completes, so let the browser reach the same stable state.
  await page.waitForTimeout(50);
  await page.locator('#dailyRate').fill('47.1234');
  await page.locator('#dailyUsdJpy').fill('158.25');
  await page.locator('#dailySwap').fill('100.25');
  await page.locator('#dailyForm button[type="submit"]').click();

  await page.locator('#dailyDate').fill('2026-06-29');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.locator('#dailyDate').fill('2026-06-30');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#dailyRate')?.dataset.rateSource === 'saved');
  assert.equal(Number(await page.locator('#dailyRate').inputValue()), 47.1234);
  assert.equal(Number(await page.locator('#dailyUsdJpy').inputValue()), 158.25);
  console.log('saved historical rate source: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#settingRateSource').selectOption('hirose');
  await page.locator('#closeSettingsBtn').click();
  await page.locator('#dailyDate').fill('2026-09-07');
  await page.locator('#dailyDate').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#dailyRate')?.dataset.rateSource === 'hirose');
  const hiroseCompare = await page.evaluate(() => ({
    inputRate: Number(document.querySelector('#dailyRate')?.value),
    inputUsdJpy: Number(document.querySelector('#dailyUsdJpy')?.value),
    source: window.__DTL_HIROSE_RATE_AT__?.('2026-09-07') || null
  }));
  assert.ok(hiroseCompare.source, 'Hirose historical rate source missing');
  assert.equal(hiroseCompare.inputRate, Number(hiroseCompare.source.usdTryAskClose23));
  assert.equal(hiroseCompare.inputUsdJpy, Number(Number(hiroseCompare.source.usdJpyAskClose23).toFixed(3)));
  console.log('Hirose historical rate source: PASS');

  // Add and edit an open position through the real UI.
  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill('2026-09-01');
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill('48.0000');
  await page.locator('#entryLots').fill('1');
  await page.locator('#positionMemo').fill('before edit');
  await page.locator('#positionForm button[type="submit"]').click();
  await page.waitForSelector('#detailEditBtn');
  await page.locator('#detailEditBtn').click();
  await page.waitForFunction(() => document.querySelector('#editPositionDialog')?.open === true);
  await page.locator('#editPositionRate').fill('47.5000');
  await page.locator('#editPositionLots').fill('2.5');
  await page.locator('#editPositionMemo').fill('after edit');
  await page.locator('#editPositionForm button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#editPositionDialog')?.open === false);
  await page.waitForSelector('#detailEditBtn');
  await page.locator('#detailEditBtn').click();
  assert.equal(Number(await page.locator('#editPositionRate').inputValue()), 47.5);
  assert.equal(Number(await page.locator('#editPositionLots').inputValue()), 2.5);
  assert.equal(await page.locator('#editPositionMemo').inputValue(), 'after edit');
  await page.locator('#cancelEditPositionBtn').click();
  console.log('open position editing: PASS');

  const perf = await page.evaluate(() => window.__DTL_PERF_STATS__?.());
  assert.ok(perf, 'performance stats unavailable');
  assert.ok(perf.derivedComputations >= 1, `derived computations invalid: ${JSON.stringify(perf)}`);
  assert.ok(perf.derivedCacheHits >= 1, `derived cache was never used: ${JSON.stringify(perf)}`);
  assert.ok(Number.isFinite(perf.lastDerivedMs));
  assert.ok(Number.isFinite(perf.lastRenderMs));
  console.log('performance stats=', perf);

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`RATE/EDIT/PERF E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
