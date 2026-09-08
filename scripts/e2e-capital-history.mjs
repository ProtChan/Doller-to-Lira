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

try {
  console.log('CAPITAL HISTORY BROWSER=', browserName);
  console.log('CAPITAL HISTORY TEST_URL=', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.capitalHistory === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.capitalHistoryAccounting === '1', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.hiroseRateHistoryReady === '1', { timeout: 15000 });

  // Make the latest historical snapshot carry meaningful risk.
  await page.locator('[data-tab="positions"]').click();
  await page.locator('#togglePositionFormBtn').click();
  await page.locator('#positionDate').fill('2026-09-01');
  await page.locator('#positionSide').selectOption('short');
  await page.locator('#entryRate').fill('48.2772');
  await page.locator('#entryLots').fill('50');
  await page.locator('#positionForm button[type="submit"]').click();
  await page.locator('[data-tab="overview"]').click();

  const beforeMaintenanceText = await page.locator('#kpiMaintenance').innerText();
  const beforeLcText = await page.locator('#kpiLc').innerText();
  const beforeMaintenance = numberFromText(beforeMaintenanceText);
  const beforeLc = numberFromText(beforeLcText);
  assert.ok(Number.isFinite(beforeMaintenance) && beforeMaintenance > 0, `pre-flow maintenance is invalid: ${beforeMaintenanceText}`);
  assert.ok(Number.isFinite(beforeLc) && beforeLc > 0, `pre-flow LC is invalid: ${beforeLcText}`);

  await page.locator('#openSettingsBtn').click();
  assert.equal(await page.locator('#capitalHistoryBtn').count(), 1, 'capital history entry point is missing');
  assert.match(await page.locator('#settingCapital').locator('xpath=..').innerText(), /現在の口座元本/, 'capital setting is not labeled as current anchor');
  await page.locator('#settingCapital').fill('500000');
  await page.locator('#settingCapital').dispatchEvent('input');
  await page.waitForTimeout(350);
  await page.locator('#capitalHistoryBtn').click();
  await page.waitForFunction(() => document.getElementById('capitalHistoryDialog')?.open === true);

  // Current capital is already the post-deposit 500k. Backfill a 100k deposit dated today
  // without applying it again, so yesterday reconstructs to 400k.
  await page.locator('#capitalFlowDate').fill('2026-09-08');
  await page.locator('#capitalFlowDate').dispatchEvent('change');
  await page.locator('#capitalFlowType').selectOption('deposit');
  await page.locator('#capitalFlowAmount').fill('100000');
  await page.locator('#capitalFlowMemo').fill('historical funding');
  if (await page.locator('#capitalFlowApplyCurrent').isChecked()) {
    await page.locator('#capitalFlowApplyCurrent').uncheck();
  }
  await page.locator('#capitalFlowForm button[type="submit"]').click();

  const capitalState = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
    return {
      current: Number(saved.settings?.capital),
      flows: saved.settings?.capitalFlows || [],
      sep7: window.__DTL_CAPITAL_AS_OF__?.('2026-09-07'),
      sep8: window.__DTL_CAPITAL_AS_OF__?.('2026-09-08')
    };
  });
  assert.equal(capitalState.current, 500000, 'backfilled deposit must not double-add to current capital');
  assert.equal(capitalState.flows.length, 1, 'capital flow was not persisted inside settings');
  assert.equal(capitalState.flows[0].amount, 100000, 'deposit amount was not persisted');
  assert.equal(capitalState.flows[0].appliedToCurrent, false, 'backfilled flow unexpectedly changed current capital');
  assert.equal(capitalState.sep7, 400000, `Sep 7 capital should reconstruct to 400k: ${capitalState.sep7}`);
  assert.equal(capitalState.sep8, 500000, `Sep 8 current capital should remain 500k: ${capitalState.sep8}`);
  assert.match(await page.locator('#capitalFlowList').innerText(), /\+¥100,000/, 'capital ledger does not show deposit');
  assert.match(await page.locator('#capitalFlowList').innerText(), /当日元本 ¥500,000/, 'capital ledger does not show reconstructed day capital');

  await page.locator('#closeCapitalHistoryBtn').click();
  await page.locator('#closeSettingsBtn').click();
  await page.locator('[data-tab="overview"]').click();
  await page.waitForTimeout(100);

  const afterMaintenanceText = await page.locator('#kpiMaintenance').innerText();
  const afterLcText = await page.locator('#kpiLc').innerText();
  const afterMaintenance = numberFromText(afterMaintenanceText);
  const afterLc = numberFromText(afterLcText);
  assert.ok(afterMaintenance < beforeMaintenance, `historical maintenance did not fall with lower historical capital: before=${beforeMaintenanceText}, after=${afterMaintenanceText}`);
  assert.ok(afterLc < beforeLc, `short-position historical LC did not move closer after lowering historical capital: before=${beforeLcText}, after=${afterLcText}`);
  assert.match(await page.locator('#kpiTotalPnlSub').innerText(), /元本 ¥400,000/, 'latest Sep 7 snapshot does not expose reconstructed historical capital');
  console.log(`historical capital 500k current -> 400k on Sep 7: maintenance ${beforeMaintenanceText} -> ${afterMaintenanceText}, LC ${beforeLcText} -> ${afterLcText}: PASS`);

  // A past backfill defaults to not changing the current anchor.
  await page.locator('#openSettingsBtn').click();
  await page.locator('#capitalHistoryBtn').click();
  await page.locator('#capitalFlowDate').fill('2026-09-01');
  await page.locator('#capitalFlowDate').dispatchEvent('change');
  assert.equal(await page.locator('#capitalFlowApplyCurrent').isChecked(), false, 'past backfill should default to not altering current capital');
  console.log('past-flow safe default: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log(`CAPITAL HISTORY E2E (${browserName}): PASS`);
} finally {
  await browser.close();
}
