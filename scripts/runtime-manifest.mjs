export const BUILD = '20260913-2126';

// Canonical execution order for the browser application. Production never loads
// these files individually: scripts/build-app.mjs concatenates them into one bundle.
// Keep this list as the single source of truth for backend/runtime composition.
export const SOURCE_FILES = [
  'app.js',
  // Legacy V2 utility/base compatibility. Remaining provider modules still use its
  // usdJpy/TRYJPY helpers and CSV/export surface; manual Daily Data UI is overridden.
  'patch-20260906-1100.js',

  // One owner for Hirose margin + shifted next-business-day swap accounting.
  'patch-hirose-core-20260913.js',

  // Current calendar presentation and PWA/layout infrastructure.
  'patch-calendar-breakdown-20260906.js',
  'patch-mobile-pwa-20260906.js',
  'patch-access-layout-20260906.js',

  // Provider rate history and user-owned position/capital features.
  'patch-hirose-rate-history-20260907.js',
  'patch-close-conversion-20260908.js',
  'patch-capital-history-20260908.js',
  'patch-position-edit-fast-lc-20260913.js',

  // Read-only provider risk/reference feeds.
  'patch-ask-day-high-20260913.js',
  'patch-worst-ask-risk-20260909.js',
  'patch-private-publisher-layout-20260913.js',
  'patch-live-rate-refresh-20260910.js',

  // One derived-data cache/backend, then presentation and final public policy.
  'patch-backend-core-20260913.js',
  'patch-calendar-swap-days-20260913.js',
  'patch-pnl-date-alignment-20260911.js',
  'patch-readonly-daily-service-20260912.js'
];

// Kept in the repository as migration history/rollback material but excluded from
// production. These layers either implement retired manual Daily Data behavior or
// duplicate accounting/caching now owned by the provider cores above.
export const RETIRED_RUNTIME_FILES = [
  'patch-swap-decimals-20260906.js',
  'patch-hirose-swap-margin-20260906.js',
  'patch-swap-precision-20260906.js',
  'patch-hirose-history-20260906.js',
  'patch-rate-source-edit-performance-20260908.js',
  'patch-user-prepared-rates-20260909.js',
  'patch-reference-data-rebuild-20260909.js',
  'patch-private-publisher-daily-layout-20260909.js',
  'patch-valuation-ui-20260911.js',
  'patch-shifted-swap-display-20260911.js',
  'patch-shifted-swap-ui-guard-20260911.js',
  'patch-backend-final-20260911.js',
  'patch-hirose-input-settle-20260909.js',
  'patch-hirose-pending-20260907.js',
  'patch-hirose-pending-bootstrap-20260907.js',
  'patch-same-day-swap-valuation-20260911.js',
  'patch-same-day-swap-reinforce-20260911.js',
  'patch-valuation-save-final-20260911.js'
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
