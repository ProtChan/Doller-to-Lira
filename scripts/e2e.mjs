import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('BROWSER=', browserName);
  console.log('TEST_URL=', targetUrl);

  // Simulate an old client that previously selected manual rate/swap modes.
  await page.addInitScript(() => {
    localStorage.setItem('dollar-to-lira:rate-source:v1', 'manual');
    localStorage.setItem('dollar-to-lira:swap-mode:v1', 'manual');
  });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  for (const [key, value] of Object.entries({
    appReady: '1',
    hiroseMargin: '1',
    hiroseFeedReady: '1',
    hiroseHistoryReady: '1',
    backendCore: '1',
    shiftedSwapDisplay: '1',
    shiftedSwapAccountingActive: '1',
    dailyDataService: '1'
  })) {
    await page.waitForFunction(({ key, value }) => document.documentElement.dataset[key] === value, { key, value }, { timeout: 15000 });
  }
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.dailyDataMode === 'provider-readonly', { timeout: 15000 });

  const modes = await page.evaluate(() => ({
    storedRateMode: localStorage.getItem('dollar-to-lira:rate-source:v1'),
    storedSwapMode: localStorage.getItem('dollar-to-lira:swap-mode:v1'),
    rateMode: document.documentElement.dataset.rateSourceMode,
    swapMode: document.documentElement.dataset.swapInputMode,
    rateAuthority: document.documentElement.dataset.dailyRateAuthority,
    swapAuthority: document.documentElement.dataset.dailySwapAuthority
  }));
  assert.deepEqual(modes, {
    storedRateMode: 'auto', storedSwapMode: 'hirose', rateMode: 'auto', swapMode: 'hirose',
    rateAuthority: 'published-feed', swapAuthority: 'hirose-feed'
  });
  console.log('legacy manual modes -> provider service modes: PASS');

  const marginBands = await page.evaluate(() => ({
    at155: window.__DTL_MARGIN_PER_1000__(155),
    below1575: window.__DTL_MARGIN_PER_1000__(157.4999),
    at1575: window.__DTL_MARGIN_PER_1000__(157.5),
    below160: window.__DTL_MARGIN_PER_1000__(159.9999),
    at160: window.__DTL_MARGIN_PER_1000__(160)
  }));
  assert.deepEqual(marginBands, { at155: 6300, below1575: 6300, at1575: 6400, below160: 6400, at160: 6500 });
  console.log('Hirose USDJPY margin boundary rules: PASS');

  const manifestResponse = await page.request.get(new URL('manifest.webmanifest', targetUrl).href);
  assert.equal(manifestResponse.ok(), true);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.short_name, 'ドルとリラ');
  console.log('PWA manifest: PASS');

  const reference = await page.evaluate(() => {
    const rates = (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
      .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const credits = window.__DTL_HIROSE_CREDIT_HISTORY__?.() || [];
    return { rates, credits, sampleRate: rates.at(-1) || null, sampleCredit: credits.find((x) => Number(x?.row?.days || 0) > 1) || credits[0] || null };
  });
  assert.ok(reference.rates.length > 1, 'provider rate history missing');
  assert.ok(reference.credits.length > 0, 'provider swap credit history missing');

  await page.locator('[data-tab="daily"]').click();
  assert.equal((await page.locator('[data-tab="daily"]').textContent())?.trim(), '日次データ');
  assert.equal((await page.locator('#view-daily h2').textContent())?.trim(), '日次データ');
  assert.equal(await page.locator('#dailyForm').isVisible(), false, 'daily edit form must not be public');
  assert.equal(await page.locator('#quickDailyForm').isVisible(), false, 'quick daily edit form must not be public');
  assert.equal(await page.locator('#dailyTableBody [data-delete-daily]').count(), 0, 'read-only daily rows must have no delete action');
  assert.ok(await page.locator('#dailyTableBody tr[data-daily-readonly="1"]').count() > 0, 'read-only daily table is empty');

  const serviceRow = await page.evaluate((date) => {
    const source = window.__DTL_HIROSE_RATE_AT__?.(date) || null;
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').daily?.find((row) => row.date === date) || null;
    const derived = typeof derivedDaily === 'function' ? derivedDaily().find((row) => row.date === date) || null : null;
    return { source, saved, derived };
  }, reference.sampleRate.date);
  assert.ok(serviceRow.source && serviceRow.saved && serviceRow.derived, 'provider daily row unavailable');
  near(serviceRow.saved.rate, serviceRow.source.usdTryAskClose23, 'provider USDTRY authority');
  near(serviceRow.saved.usdJpy, serviceRow.source.usdJpyAskClose23, 'provider USDJPY authority');
  near(serviceRow.saved.tryJpy, Number(serviceRow.source.usdJpyAskClose23) / Number(serviceRow.source.usdTryAskClose23), 'provider TRYJPY derivation');
  assert.equal(serviceRow.saved.rateSource, 'provider');
  near(serviceRow.derived.total, Number(serviceRow.derived.fxPnl || 0) + Number(serviceRow.derived.swap || 0), 'Net identity');
  console.log('published rate -> read-only daily state: PASS');

  await page.locator('#openSettingsBtn').click();
  for (const id of ['settingSwap','settingSwapMode','settingRateSource','settingTryJpy']) {
    const control = page.locator(`#${id}`);
    if (await control.count()) assert.equal(await control.isVisible(), false, `${id} must not be exposed in service settings`);
  }
  assert.equal(await page.locator('#settingCapital').isVisible(), true);
  assert.equal(await page.locator('#settingUnits').isVisible(), true);
  await page.locator('#closeSettingsBtn').click();
  console.log('rate/swap settings removed from public Settings: PASS');

  // Position management remains editable; only Daily Data became provider-owned.
  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill(reference.rates[0].date);
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill(String(Number(reference.rates[0].usdTryAskClose23)));
  await page.locator('#entryLots').fill('1');
  await page.locator('#positionForm button[type="submit"]').click();
  const savedPosition = await page.evaluate(() => JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}').positions?.at(-1) || null);
  assert.ok(savedPosition, 'position was not persisted');
  assert.equal(Number(savedPosition.lots), 1);
  console.log('position management remains writable: PASS');

  const swapRule = await page.evaluate((credit) => {
    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__?.(credit.creditDate) || null;
    const openedOnCredit = window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: credit.creditDate, side:'short', lots:1 }, credit.creditDate);
    const openedBeforeCredit = window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: credit.sourceDate, side:'short', lots:1 }, credit.creditDate);
    const closedOnCredit = window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__?.({ date: credit.sourceDate, closeDate:credit.creditDate, side:'short', lots:1 }, credit.creditDate);
    return { resolution, openedOnCredit, openedBeforeCredit, closedOnCredit };
  }, reference.sampleCredit);
  assert.equal(swapRule.openedOnCredit, 0, 'credit-day opening must not receive that swap');
  near(swapRule.openedBeforeCredit, swapRule.resolution.shortPerLot, 'position open before credit date receives swap');
  near(swapRule.closedOnCredit, swapRule.resolution.shortPerLot, 'credit-day closing position receives swap');
  console.log('shifted swap entitlement rules: PASS');

  const backendStats = await page.evaluate(() => window.__DTL_BACKEND_STATS__?.() || null);
  assert.ok(backendStats, 'canonical backend stats unavailable');

  const actionablePageErrors = pageErrors.filter((message) => !(
    browserName === 'webkit' && /sw\.js/i.test(message) && /access control checks/i.test(message)
  ));
  if (actionablePageErrors.length) throw new Error(`Browser page errors: ${actionablePageErrors.join(' | ')}`);
  console.log(`E2E PROVIDER DAILY SERVICE (${browserName}): PASS`);
} finally {
  await browser.close();
}
