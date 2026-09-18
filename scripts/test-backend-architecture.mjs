import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BUILD, SOURCE_FILES, RETIRED_RUNTIME_FILES, OUTPUT_DIR } from './runtime-manifest.mjs';

const root = process.cwd();
const out = path.join(root, OUTPUT_DIR);

assert.equal(new Set(SOURCE_FILES).size, SOURCE_FILES.length, 'runtime manifest contains duplicate source files');
assert.equal(SOURCE_FILES.length, 18, 'provider runtime unexpectedly regained a compatibility layer');
assert.ok(SOURCE_FILES[0] === 'app.js', 'app.js must be the first runtime source');
assert.ok(SOURCE_FILES.includes('patch-hirose-core-20260913.js'), 'unified Hirose core must be bundled');
assert.ok(SOURCE_FILES.includes('patch-position-edit-fast-lc-20260913.js'), 'position editing/fast LC core must be bundled');
assert.ok(SOURCE_FILES.includes('patch-ask-day-high-20260913.js'), 'read-only ASK-high feed must be bundled');
assert.ok(SOURCE_FILES.includes('patch-private-publisher-layout-20260913.js'), 'public compact layout must be bundled');
assert.equal(SOURCE_FILES.at(-4), 'patch-backend-core-20260913.js', 'canonical provider backend must own derived accounting');
assert.equal(SOURCE_FILES.at(-3), 'patch-calendar-swap-days-20260913.js', 'calendar swap-day badge must be presentation-only');
assert.equal(SOURCE_FILES.at(-2), 'patch-pnl-date-alignment-20260911.js', 'PnL presentation must follow accounting');
assert.equal(SOURCE_FILES.at(-1), 'patch-readonly-daily-service-20260912.js', 'provider-readonly policy must be the final runtime layer');
for (const retired of RETIRED_RUNTIME_FILES) {
  assert.ok(!SOURCE_FILES.includes(retired), `${retired} is retired and must not be in production runtime`);
}

for (const file of [...SOURCE_FILES, ...RETIRED_RUNTIME_FILES]) await fs.access(path.join(root, file));

const [index, bundle, sw, metaText, marginText] = await Promise.all([
  fs.readFile(path.join(out, 'index.html'), 'utf8'),
  fs.readFile(path.join(out, 'app.bundle.js'), 'utf8'),
  fs.readFile(path.join(out, 'sw.js'), 'utf8'),
  fs.readFile(path.join(out, 'build-meta.json'), 'utf8'),
  fs.readFile(path.join(root, 'data', 'hirose-usdtry-margin.json'), 'utf8')
]);
const meta = JSON.parse(metaText);
const marginFeed = JSON.parse(marginText);
assert.equal(marginFeed.policy, 'official-history-manual-promotion-rate-estimate-future', 'Hirose margin feed policy mismatch');
assert.equal(marginFeed.officialUpdatePolicy, 'manual-on-user-instruction', 'official margin rows must only be promoted on explicit user instruction');
assert.equal(marginFeed.ruleEffectiveFrom, '2026-07-01', 'USDTRY 4% margin rule effective date mismatch');
assert.match(String(marginFeed.ruleReference || ''), /^https:\/\/hirose-fx\.co\.jp\/contents\/news\/HeView/, 'Hirose margin rule reference missing');
assert.match(String(marginFeed.estimateRule || ''), /4%.*100/, 'future margin estimate rule metadata missing');
assert.equal(marginFeed.unit, 1000, 'Hirose margin feed must be quoted per 1,000 USD');
assert.ok(Array.isArray(marginFeed.history) && marginFeed.history.length > 0, 'Hirose official margin history is empty');
const marginDates = marginFeed.history.map((row) => String(row.date || ''));
assert.equal(marginFeed.officialThrough, marginDates.at(-1), 'officialThrough must match the latest official margin date');
assert.equal(new Set(marginDates).size, marginDates.length, 'official margin history contains duplicate dates');
for (const row of marginFeed.history) {
  assert.match(String(row.date || ''), /^\d{4}-\d{2}-\d{2}$/, 'official margin row has invalid date');
  assert.ok(Number(row.marginPer1000Jpy) > 0, `official margin missing for ${row.date}`);
  assert.equal(row.verification, 'hirose-official', `margin row is not marked official: ${row.date}`);
  assert.match(String(row.reference || ''), /^https:\/\/hirose-fx\.jp\/pdf\/deposit\//, `official margin reference missing: ${row.date}`);
}

assert.match(index, new RegExp(`app\\.bundle\\.js\\?v=${BUILD}`), 'production index does not load the built bundle');
assert.doesNotMatch(index, /runtime-[0-9-]+\.js/, 'production index still loads a legacy runtime');
assert.doesNotMatch(index, /patch-[^"']+\.js/, 'production index directly exposes patch files');
const localScripts = [...index.matchAll(/<script\s+src="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((src) => src.startsWith('./'));
assert.deepEqual(localScripts, [`./app.bundle.js?v=${BUILD}`], `expected exactly one first-party JS request, got ${localScripts.join(', ')}`);
for (const asset of ['styles.css', 'pwa-mobile-20260906.css', 'manifest.webmanifest', 'icon-dollar-lira.svg']) {
  assert.match(index, new RegExp(`${asset.replaceAll('.', '\\.') }\\?v=${BUILD}`), `${asset} is not build-versioned in production index`);
}

assert.match(bundle, /backendArchitecture = 'single-bundle'/, 'single-bundle marker missing');
assert.match(bundle, /dataset\.hiroseCore = '1'/, 'unified Hirose core marker missing');
assert.match(bundle, /hiroseMarginMode = 'official-history-estimated-future'/, 'official-history/future-estimate margin policy missing');
assert.match(bundle, /__DTL_MARGIN_RESOLUTION__/, 'date-aware Hirose margin resolution API missing');
assert.match(bundle, /__DTL_MARGIN_ESTIMATE_PER_1000__/, 'future margin estimate API missing');
assert.match(bundle, /MARGIN_FEED_URL = '.\/data\/hirose-usdtry-margin\.json'/, 'official Hirose margin feed is not wired into runtime');
assert.match(bundle, /backendCoreVersion = '20260913-provider-core'/, 'provider backend marker missing');
assert.match(bundle, /architecture:'provider-readonly-core'/, 'provider backend stats marker missing');
assert.match(bundle, /dataset\.positionEditCore = '1'/, 'position-edit core marker missing');
assert.match(bundle, /dataset\.askDayHighCore = '1'/, 'ASK-high core marker missing');
assert.match(bundle, /dataset\.calendarSwapDaysBadge = '1'/, 'calendar swap badge marker missing');
assert.match(bundle, /dataset\.pnlDateAlignment = '1'/, 'PnL date-alignment marker missing');
assert.match(bundle, /dataset\.dailyDataService = '1'/, 'read-only Daily Data service marker missing');
assert.match(bundle, /dailyDataMode = 'provider-readonly'/, 'provider-driven Daily Data mode marker missing');
assert.match(bundle, /dailyRateAuthority = 'published-feed'/, 'published rate authority marker missing');
assert.match(bundle, /dailySwapAuthority = 'hirose-feed'/, 'published swap authority marker missing');
assert.match(bundle, /liveRateRefreshPolicy = 'boot-focus-visible-2min-manual-full-reconcile'/, 'live provider full-reconcile policy missing');
assert.match(bundle, /cache:'no-store'/, 'provider live refresh must bypass HTTP cache');
assert.match(bundle, /reason:'manual-api'/, 'manual provider refresh path missing');
assert.match(bundle, /sw\.js\?v=\$\{encodeURIComponent\(build\)\}/, 'service worker registration is not tied to the running build');
assert.match(bundle, /updateViaCache: 'none'/, 'service worker registration must bypass HTTP cache for update checks');
assert.match(bundle, /registration\?\.update\?\./, 'client has no service-worker-native freshness check');
assert.match(bundle, /controllerchange/, 'client does not react when a newer service worker takes control');
assert.match(bundle, /visibilitychange/, 'long-lived PWA does not check updates when it becomes visible');
assert.match(bundle, /setInterval\(/, 'long-lived PWA has no periodic update check');
assert.doesNotMatch(bundle, /build-meta\.json\?t=/, 'client must not use metadata fetches for PWA freshness');
assert.doesNotMatch(bundle, /\beval\s*\(/, 'bundle contains eval()');
assert.doesNotMatch(bundle, /fetch\s*\([^\n;]*\.js(?:[?`'\"]|\b)/, 'bundle dynamically fetches JavaScript');
assert.doesNotMatch(bundle, /runtime-[0-9-]+\.js/, 'bundle references a legacy runtime loader');
for (const file of SOURCE_FILES) assert.ok(bundle.includes(`/* ===== ${file} ===== */`), `bundle missing source boundary for ${file}`);
for (const retired of RETIRED_RUNTIME_FILES) assert.ok(!bundle.includes(`/* ===== ${retired} ===== */`), `retired runtime leaked into production bundle: ${retired}`);

assert.equal(meta.build, BUILD, 'build metadata version mismatch');
assert.equal(meta.architecture, 'single-bundle');
assert.deepEqual(meta.sources, SOURCE_FILES, 'build metadata source manifest mismatch');
assert.match(sw, new RegExp(`const CACHE_NAME = 'dollar-to-lira-pwa-${BUILD}'`), 'service worker cache is not unique to this build');
assert.match(sw, new RegExp(`app\\.bundle\\.js\\?v=${BUILD}`), 'service worker does not cache the canonical bundle');
for (const asset of ['styles.css', 'pwa-mobile-20260906.css', 'manifest.webmanifest', 'icon-dollar-lira.svg']) {
  assert.match(sw, new RegExp(`${asset.replaceAll('.', '\\.') }\\?v=${BUILD}`), `${asset} is not build-versioned in service worker shell`);
}
assert.match(sw, /isLiveProviderRate/, 'service worker has no explicit live-provider freshness path');
assert.match(sw, /url\.searchParams\.has\('live'\)/, 'service worker does not recognize live provider reads');
assert.match(sw, /if \(isLiveProviderRate\)[\s\S]*?fetch\(request, \{ cache: 'no-store' \}\)[\s\S]*?return;/, 'live provider reads must bypass Cache Storage and use network no-store');
assert.match(sw, /hadPreviousAppCache/, 'service worker does not detect upgrades from an older app cache');
assert.match(sw, /client\.navigate\(client\.url\)/, 'service worker does not reload legacy open clients on upgrade');
assert.match(sw, /self\.clients\.claim\(\)/, 'new service worker does not claim existing clients');
assert.match(sw, /self\.skipWaiting\(\)/, 'new service worker does not activate immediately');
assert.doesNotMatch(sw, /runtime-[0-9-]+\.js/, 'service worker still references legacy runtime');

console.log(`Backend architecture: PASS (${SOURCE_FILES.length} active sources; ${RETIRED_RUNTIME_FILES.length} compatibility layers retired; provider-only accounting/core + uncached live provider reads guarded)`);
