import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BUILD, SOURCE_FILES, RETIRED_RUNTIME_FILES, OUTPUT_DIR } from './runtime-manifest.mjs';

const root = process.cwd();
const out = path.join(root, OUTPUT_DIR);

assert.equal(new Set(SOURCE_FILES).size, SOURCE_FILES.length, 'runtime manifest contains duplicate source files');
assert.ok(SOURCE_FILES[0] === 'app.js', 'app.js must be the first runtime source');
assert.ok(SOURCE_FILES.includes('patch-hirose-swap-margin-20260906.js'), 'Hirose margin integration must be bundled directly');
assert.ok(SOURCE_FILES.includes('patch-valuation-ui-20260911.js'), 'valuation UI compatibility layer must remain bundled');
assert.equal(SOURCE_FILES.at(-5), 'patch-shifted-swap-display-20260911.js', 'shifted swap accounting must be the authoritative swap layer');
assert.equal(SOURCE_FILES.at(-4), 'patch-shifted-swap-ui-guard-20260911.js', 'shifted swap UI guard must follow accounting');
assert.equal(SOURCE_FILES.at(-3), 'patch-backend-final-20260911.js', 'canonical backend must own the final accounting hot path');
assert.equal(SOURCE_FILES.at(-2), 'patch-pnl-date-alignment-20260911.js', 'PnL date-alignment presentation must follow accounting');
assert.equal(SOURCE_FILES.at(-1), 'patch-readonly-daily-service-20260912.js', 'provider-driven read-only Daily Data mode must be the final public policy layer');
for (const retired of RETIRED_RUNTIME_FILES) {
  assert.ok(!SOURCE_FILES.includes(retired), `${retired} is retired and must not be in production runtime`);
}

for (const file of [...SOURCE_FILES, ...RETIRED_RUNTIME_FILES]) {
  await fs.access(path.join(root, file));
}

const [index, bundle, sw, metaText] = await Promise.all([
  fs.readFile(path.join(out, 'index.html'), 'utf8'),
  fs.readFile(path.join(out, 'app.bundle.js'), 'utf8'),
  fs.readFile(path.join(out, 'sw.js'), 'utf8'),
  fs.readFile(path.join(out, 'build-meta.json'), 'utf8')
]);
const meta = JSON.parse(metaText);

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
assert.match(bundle, /backendCoreVersion = '20260911-1422'/, 'canonical backend marker missing');
assert.match(bundle, /dataset\.pnlDateAlignment = '1'/, 'PnL date-alignment marker missing');
assert.match(bundle, /dataset\.dailyDataService = '1'/, 'read-only Daily Data service marker missing');
assert.match(bundle, /dailyDataMode = 'provider-readonly'/, 'provider-driven Daily Data mode marker missing');
assert.match(bundle, /dailyRateAuthority = 'published-feed'/, 'published rate authority marker missing');
assert.match(bundle, /dailySwapAuthority = 'hirose-feed'/, 'published swap authority marker missing');
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
for (const file of SOURCE_FILES) {
  assert.ok(bundle.includes(`/* ===== ${file} ===== */`), `bundle missing source boundary for ${file}`);
}
for (const retired of RETIRED_RUNTIME_FILES) {
  assert.ok(!bundle.includes(`/* ===== ${retired} ===== */`), `retired runtime leaked into production bundle: ${retired}`);
}

assert.equal(meta.build, BUILD, 'build metadata version mismatch');
assert.equal(meta.architecture, 'single-bundle');
assert.deepEqual(meta.sources, SOURCE_FILES, 'build metadata source manifest mismatch');
assert.match(sw, new RegExp(`const CACHE_NAME = 'dollar-to-lira-pwa-${BUILD}'`), 'service worker cache is not unique to this build');
assert.match(sw, new RegExp(`app\\.bundle\\.js\\?v=${BUILD}`), 'service worker does not cache the canonical bundle');
for (const asset of ['styles.css', 'pwa-mobile-20260906.css', 'manifest.webmanifest', 'icon-dollar-lira.svg']) {
  assert.match(sw, new RegExp(`${asset.replaceAll('.', '\\.') }\\?v=${BUILD}`), `${asset} is not build-versioned in service worker shell`);
}
assert.match(sw, /hadPreviousAppCache/, 'service worker does not detect upgrades from an older app cache');
assert.match(sw, /client\.navigate\(client\.url\)/, 'service worker does not reload legacy open clients on upgrade');
assert.match(sw, /self\.clients\.claim\(\)/, 'new service worker does not claim existing clients');
assert.match(sw, /self\.skipWaiting\(\)/, 'new service worker does not activate immediately');
assert.doesNotMatch(sw, /runtime-[0-9-]+\.js/, 'service worker still references legacy runtime');

console.log(`Backend architecture: PASS (${SOURCE_FILES.length} active sources -> 1 production bundle; ${RETIRED_RUNTIME_FILES.length} wrappers retired; provider-readonly Daily Data + legacy PWA auto-upgrade guarded)`);
