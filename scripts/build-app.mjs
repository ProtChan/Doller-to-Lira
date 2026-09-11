import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILD, SOURCE_FILES, PUBLIC_FILES, DATA_DIR, OUTPUT_DIR } from './runtime-manifest.mjs';

const root = process.cwd();
const out = path.join(root, OUTPUT_DIR);
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

const assertChanged = (before, after, label) => {
  if (before === after) throw new Error(`build transform target missing: ${label}`);
  return after;
};

const normalizeAppSource = (source) => {
  const oldMoneyBody = "${Number(v) < 0 ? '-' : ''}¥${Math.abs(Number(v)).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}";
  const newMoneyBody = "${Math.trunc(Number(v)) < 0 ? '-' : ''}¥${Math.abs(Math.trunc(Number(v))).toLocaleString('ja-JP')}";
  let next = source.replace(oldMoneyBody, newMoneyBody);
  next = assertChanged(source, next, 'JPY display formatter');
  const beforeUnits = next;
  next = next.replace('unitsPerLot: 10000', 'unitsPerLot: 1000');
  return assertChanged(beforeUnits, next, 'default lot size');
};

const removeLegacyCalendarLoader = (source) => {
  const startMarker = '  const hiroseReady = document.documentElement.dataset.hiroseMargin';
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error('calendar dynamic Hirose loader marker missing');
  const end = source.indexOf('\n})();', start);
  if (end < 0) throw new Error('calendar dynamic Hirose loader end missing');
  return `${source.slice(0, start)}  // Hirose integration is already part of the production bundle.\n  installCalendar();\n${source.slice(end)}`;
};

const transformModule = (file, source) => {
  let next = source;
  if (file === 'app.js') next = normalizeAppSource(next);
  if (file === 'patch-calendar-breakdown-20260906.js') next = removeLegacyCalendarLoader(next);
  return next;
};

const transformIndex = (source) => {
  const pattern = /<script src="\.\/runtime-[^"]+\.js\?v=[^"]+" defer><\/script>/;
  const replacement = `<script src="./app.bundle.js?v=${BUILD}" defer></script>`;
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error('index runtime script tag was not found');
  return next;
};

const transformServiceWorker = (source) => {
  let next = source;
  const cacheBefore = next;
  next = next.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'dollar-to-lira-pwa-${BUILD}';`);
  if (next === cacheBefore) throw new Error('service worker cache name target missing');

  const shellBefore = next;
  next = next.replace(/'\.\/runtime-[^']+\.js\?v=[^']+'/, `'./app.bundle.js?v=${BUILD}'`);
  if (next === shellBefore) throw new Error('service worker runtime shell target missing');

  const runtimeBefore = next;
  next = next.replace(
    "const isRuntime = /\\/runtime-[^/]+\\.js$/.test(url.pathname);",
    "const isRuntime = /\\/app\\.bundle\\.js$/.test(url.pathname);"
  );
  if (next === runtimeBefore) throw new Error('service worker runtime matcher target missing');
  return next;
};

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const pieces = [];
for (const file of SOURCE_FILES) {
  const source = transformModule(file, await read(file));
  pieces.push(`\n/* ===== ${file} ===== */\n${source.trim()}\n`);
}

const header = `/* GENERATED FILE — DO NOT EDIT.\n * Canonical sources: scripts/runtime-manifest.mjs\n * Build: ${BUILD}\n */\nwindow.__DTL_BUILD__ = '${BUILD}';\ndocument.documentElement.dataset.backendBundle = 'loading';\ndocument.documentElement.dataset.backendArchitecture = 'single-bundle';\n`;
const footer = `\n/* ===== bundle finalizer ===== */\ndocument.documentElement.dataset.backendBundle = '1';\ndocument.documentElement.dataset.runtimeBuild = '${BUILD}';\n{ const status = document.querySelector('.local-status'); if (status) status.innerHTML = '<i></i>LOCAL · ${BUILD.slice(-4)}'; }\n`;
const bundle = `${header}${pieces.join('')}${footer}`;

if (/\beval\s*\(/.test(bundle)) throw new Error('production bundle still contains eval()');
if (/fetch\s*\([^\n;]*\.js(?:[?`'\"]|\b)/.test(bundle)) throw new Error('production bundle still dynamically fetches JavaScript');
if (/runtime-[0-9-]+\.js/.test(bundle)) throw new Error('production bundle still references a legacy runtime loader');

await fs.writeFile(path.join(out, 'app.bundle.js'), bundle);
await fs.writeFile(path.join(out, 'index.html'), transformIndex(await read('index.html')));

for (const file of PUBLIC_FILES) {
  const src = path.join(root, file);
  const dst = path.join(out, file);
  if (file === 'sw.js') {
    await fs.writeFile(dst, transformServiceWorker(await read(file)));
  } else {
    await fs.copyFile(src, dst);
  }
}
await fs.cp(path.join(root, DATA_DIR), path.join(out, DATA_DIR), { recursive: true });

const hash = crypto.createHash('sha256').update(bundle).digest('hex');
const meta = {
  build: BUILD,
  architecture: 'single-bundle',
  bundle: 'app.bundle.js',
  sha256: hash,
  bytes: Buffer.byteLength(bundle),
  sources: SOURCE_FILES
};
await fs.writeFile(path.join(out, 'build-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`Built ${OUTPUT_DIR}/app.bundle.js: ${meta.bytes} bytes, ${SOURCE_FILES.length} sources, sha256 ${hash.slice(0, 16)}…`);
