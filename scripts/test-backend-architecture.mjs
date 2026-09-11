import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BUILD, SOURCE_FILES, RETIRED_RUNTIME_FILES, OUTPUT_DIR } from './runtime-manifest.mjs';

const root = process.cwd();
const out = path.join(root, OUTPUT_DIR);

assert.equal(new Set(SOURCE_FILES).size, SOURCE_FILES.length, 'runtime manifest contains duplicate source files');
assert.ok(SOURCE_FILES[0] === 'app.js', 'app.js must be the first runtime source');
assert.ok(SOURCE_FILES.includes('patch-hirose-swap-margin-20260906.js'), 'Hirose margin integration must be bundled directly');
assert.ok(SOURCE_FILES.includes('patch-valuation-ui-20260911.js'), 'valuation UI must be isolated from accounting');
assert.equal(SOURCE_FILES.at(-4), 'patch-shifted-swap-display-20260911.js', 'shifted swap accounting must be the authoritative swap layer');
assert.equal(SOURCE_FILES.at(-3), 'patch-shifted-swap-ui-guard-20260911.js', 'shifted swap UI guard must follow accounting');
assert.equal(SOURCE_FILES.at(-2), 'patch-backend-final-20260911.js', 'canonical backend must own the final accounting hot path');
assert.equal(SOURCE_FILES.at(-1), 'patch-pnl-date-alignment-20260911.js', 'PnL date-alignment presentation must be the final runtime layer');
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

assert.match(bundle, /backendArchitecture = 'single-bundle'/, 'single-bundle marker missing');
assert.match(bundle, /backendCoreVersion = '20260911-1422'/, 'canonical backend marker missing');
assert.match(bundle, /dataset\.pnlDateAlignment = '1'/, 'PnL date-alignment marker missing');
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
assert.match(sw, new RegExp(`app\\.bundle\\.js\\?v=${BUILD}`), 'service worker does not cache the canonical bundle');
assert.doesNotMatch(sw, /runtime-[0-9-]+\.js/, 'service worker still references legacy runtime');

console.log(`Backend architecture: PASS (${SOURCE_FILES.length} active sources -> 1 production bundle; ${RETIRED_RUNTIME_FILES.length} wrappers retired)`);
