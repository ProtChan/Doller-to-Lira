import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[browser console error]', msg.text());
});

try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', { timeout: 10000 });

  console.log('appReady=', await page.locator('html').getAttribute('data-app-ready'));

  // 1) Tab navigation: overview -> positions
  await page.locator('[data-tab="positions"]').click();
  assert.equal(await page.locator('[data-tab="positions"]').evaluate((el) => el.classList.contains('active')), true, 'positions tab did not become active');
  assert.equal(await page.locator('#view-positions').evaluate((el) => el.classList.contains('active')), true, 'positions view did not become active');
  console.log('tab positions: PASS');

  // 2) New position editor opens
  await page.locator('#togglePositionFormBtn').click();
  assert.equal(await page.locator('#positionEditor').evaluate((el) => el.classList.contains('hidden')), false, 'position editor stayed hidden');
  console.log('position editor: PASS');

  // 3) Settings drawer opens and closes
  await page.locator('#openSettingsBtn').click();
  assert.equal(await page.locator('#settingsDrawer').evaluate((el) => el.classList.contains('show')), true, 'settings drawer did not open');
  assert.equal(await page.locator('#settingsBackdrop').evaluate((el) => el.classList.contains('show')), true, 'settings backdrop did not open');
  console.log('settings open: PASS');
  await page.locator('#closeSettingsBtn').click();
  assert.equal(await page.locator('#settingsDrawer').evaluate((el) => el.classList.contains('show')), false, 'settings drawer did not close');
  console.log('settings close: PASS');

  // 4) Daily and risk tabs
  await page.locator('[data-tab="daily"]').click();
  assert.equal(await page.locator('#view-daily').evaluate((el) => el.classList.contains('active')), true, 'daily view did not become active');
  await page.locator('[data-tab="risk"]').click();
  assert.equal(await page.locator('#view-risk').evaluate((el) => el.classList.contains('active')), true, 'risk view did not become active');
  console.log('daily/risk tabs: PASS');

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
  console.log('REAL DOM E2E: PASS');
} finally {
  await browser.close();
}
