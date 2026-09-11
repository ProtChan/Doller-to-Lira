export const BUILD = '20260911-1422';

// Canonical execution order for the browser application. Production never loads
// these files individually: scripts/build-app.mjs concatenates them into one bundle.
// Keep this list as the single source of truth for backend/runtime composition.
export const SOURCE_FILES = [
  'app.js',
  'patch-20260906-1100.js',
  'patch-swap-decimals-20260906.js',
  // The Hirose margin integration used to be fetched dynamically by the calendar
  // patch. It is now an explicit backend dependency and is bundled synchronously.
  'patch-hirose-swap-margin-20260906.js',
  'patch-calendar-breakdown-20260906.js',
  'patch-mobile-pwa-20260906.js',
  'patch-access-layout-20260906.js',
  'patch-swap-precision-20260906.js',
  'patch-hirose-history-20260906.js',
  'patch-hirose-rate-history-20260907.js',
  'patch-hirose-input-settle-20260909.js',
  'patch-close-conversion-20260908.js',
  'patch-capital-history-20260908.js',
  'patch-rate-source-edit-performance-20260908.js',
  'patch-user-prepared-rates-20260909.js',
  'patch-worst-ask-risk-20260909.js',
  'patch-reference-data-rebuild-20260909.js',
  'patch-private-publisher-daily-layout-20260909.js',
  'patch-live-rate-refresh-20260910.js',
  'patch-same-day-swap-valuation-20260911.js',
  'patch-same-day-swap-reinforce-20260911.js',
  'patch-valuation-save-final-20260911.js',
  // Provisional-swap handling used to be fetched by a bootstrap script after the
  // async feeds settled. It is safe to install after the other synchronous wrappers;
  // its observer reconciles again when the feeds become ready.
  'patch-hirose-pending-20260907.js',
  // Final authoritative semantics must remain last so older compatibility layers
  // cannot overwrite next-business-day swap accounting.
  'patch-shifted-swap-display-20260911.js',
  'patch-shifted-swap-ui-guard-20260911.js'
];

export const PUBLIC_FILES = [
  'styles.css',
  'pwa-mobile-20260906.css',
  'manifest.webmanifest',
  'icon-dollar-lira.svg',
  'publish.html',
  'sw.js'
];

export const DATA_DIR = 'data';
export const OUTPUT_DIR = 'dist';
