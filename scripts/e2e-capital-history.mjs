import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

const targetUrl = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

const numberFromText = (text) => Number(String(text).replace(/[^0-9.\-]/g, ''));
const near = (actual, expected, label, tolerance = 1e-8) => assert.ok(
  Math.abs(Number(actual) - Number(expected)) <= tolerance,
  `${label}: expected ${expected}, got ${actual}`
);

try {
  console.log('CAPITAL HISTORY INVARIANTS BROWSER=', browserName);
  console.log('CAPITAL HISTORY INVARIANTS TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.capitalHistory === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.capitalHistoryAccounting === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });

  const rates = await page.evaluate(() => (window.__DTL_HIROSE_RATE_HISTORY__?.() || [])
    .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))));
  assert.ok(rates.length >= 4, 'capital-history invariant test needs several historical rate rows');

  const positionDate = rates[0].date;
  const historical = rates[Math.max(1, Math.floor(rates.length / 3))];
  const funding = rates[Math.max(2, Math.floor(rates.length * 2 / 3))];
  assert.ok(positionDate <= historical.date && historical.date < funding.date, 'derived capital test dates are not ordered');

  await page.locator('#openSettingsBtn').click();
  assert.equal(await page.locator('#capitalHistoryBtn').count(), 1, 'capital history entry point is missing');
  assert.match(await page.locator('#settingCapital').locator('xpath=..').innerText(), /現在の口座元本/, 'capital setting is not labeled as current anchor');
  const currentCapital = Number(await page.locator('#settingCapital').inputValue());
  const unitsPerLot = Number(await page.locator('#settingUnits').inputValue());
  const leverage = Number(await page.locator('#settingLeverage').inputValue());
  assert.ok(currentCapital > 0 && unitsPerLot > 0 && leverage > 0, 'capital/margin settings must be positive');
  await page.locator('#closeSettingsBtn').click();

  const perLotMargin = unitsPerLot * Number(historical.usdJpyAskClose23) / leverage;
  const targetMargin = currentCapital * 0.5;
  const lots = Math.max(1, Math.floor(targetMargin / perLotMargin));
  assert.ok(lots > 0, 'derived risk lot count must be positive');

  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill(positionDate);
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill(String(Number(rates[0].usdTryAskClose23)));
  await page.locator('#entryLots').fill(String(lots));
  await page.locator('#positionForm button[type="submit"]').click();

  const readRiskAt = async (date) => {
    await page.locator('[data-tab="risk"]').click();
    await page.waitForFunction(() => {
      const maintenance = window.Chart?.getChart?.(document.querySelector('#maintenanceChart'));
      const lc = window.Chart?.getChart?.(document.querySelector('#lcChart'));
      return !!maintenance && !!lc;
    });
    return page.evaluate((date) => {
      const label = date.slice(5);
      const maintenance = Chart.getChart(document.querySelector('#maintenanceChart'));
      const lc = Chart.getChart(document.querySelector('#lcChart'));
      const index = maintenance.data.labels.indexOf(label);
      const maintenanceSet = maintenance.data.datasets.find((dataset) => dataset.label === '23:00 維持率');
      const lcSet = lc.data.datasets.find((dataset) => dataset.label === '推定LC');
      return {
        index,
        maintenance: index >= 0 ? Number(maintenanceSet?.data?.[index]) : NaN,
        lc: index >= 0 ? Number(lcSet?.data?.[index]) : NaN
      };
    }, date);
  };

  const beforeRisk = await readRiskAt(historical.date);
  assert.ok(beforeRisk.index >= 0, `historical risk point missing for ${historical.date}`);
  assert.ok(Number.isFinite(beforeRisk.maintenance) && beforeRisk.maintenance > 0, 'pre-flow historical maintenance must be finite');
  assert.ok(Number.isFinite(beforeRisk.lc) && beforeRisk.lc > 0, 'pre-flow historical LC must be finite');

  const flowAmount = Math.max(1, Math.round(currentCapital * 0.2));
  await page.locator('#openSettingsBtn').click();
  await page.locator('#capitalHistoryBtn').click();
  await page.waitForFunction(() => document.getElementById('capitalHistoryDialog')?.open === true);
  await page.locator('#capitalFlowDate').fill(funding.date);
  await page.locator('#capitalFlowDate').dispatchEvent('change');
  await page.locator('#capitalFlowType').selectOption('deposit');
  await page.locator('#capitalFlowAmount').fill(String(flowAmount));
  await page.locator('#capitalFlowMemo').fill('invariant historical funding');
  if (await page.locator('#capitalFlowApplyCurrent').isChecked()) await page.locator('#capitalFlowApplyCurrent').uncheck();
  await page.locator('#capitalFlowForm button[type="submit"]').click();

  const capitalState = await page.evaluate(({ historicalDate, fundingDate }) => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return {
      current: Number(saved.settings?.capital),
      flows: saved.settings?.capitalFlows || [],
      historical: window.__DTL_CAPITAL_AS_OF__?.(historicalDate),
      fundingDay: window.__DTL_CAPITAL_AS_OF__?.(fundingDate)
    };
  }, { historicalDate: historical.date, fundingDate: funding.date });

  near(capitalState.current, currentCapital, 'backfilled flow must not alter current capital');
  assert.equal(capitalState.flows.length, 1, 'capital flow was not persisted');
  near(capitalState.flows[0].amount, flowAmount, 'capital flow amount');
  assert.equal(capitalState.flows[0].appliedToCurrent, false, 'historical flow unexpectedly changed current capital');
  near(capitalState.historical, currentCapital - flowAmount, 'historical capital must reverse later deposit');
  near(capitalState.fundingDay, currentCapital, 'capital on funding date must include that date flow');

  const ledgerText = await page.locator('#capitalFlowList').innerText();
  assert.ok(ledgerText.includes(`+¥${flowAmount.toLocaleString('ja-JP')}`), 'capital ledger does not show the derived deposit amount');
  assert.ok(ledgerText.includes(`当日元本 ¥${Math.trunc(currentCapital).toLocaleString('ja-JP')}`), 'capital ledger does not show funding-day capital');
  await page.locator('#closeCapitalHistoryBtn').click();
  await page.locator('#closeSettingsBtn').click();

  const afterRisk = await readRiskAt(historical.date);
  assert.ok(Number.isFinite(afterRisk.maintenance), 'post-flow historical maintenance must be finite');
  assert.ok(Number.isFinite(afterRisk.lc), 'post-flow historical LC must be finite');
  assert.ok(afterRisk.maintenance < beforeRisk.maintenance, `lower historical capital must lower maintenance: before=${beforeRisk.maintenance}, after=${afterRisk.maintenance}`);
  assert.ok(afterRisk.lc < beforeRisk.lc, `for a short position, lower historical capital must move LC rate closer/down: before=${beforeRisk.lc}, after=${afterRisk.lc}`);
  console.log('historical capital reconstruction propagates to maintenance and LC: PASS');

  await page.locator('#openSettingsBtn').click();
  await page.locator('#capitalHistoryBtn').click();
  await page.locator('#capitalFlowDate').fill(historical.date);
  await page.locator('#capitalFlowDate').dispatchEvent('change');
  assert.equal(await page.locator('#capitalFlowApplyCurrent').isChecked(), false, 'past backfill should default to not altering current capital');
  console.log('past-flow safe default: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`CAPITAL HISTORY INVARIANTS E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
