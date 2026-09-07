(() => {
  const BUILD = '20260906-1140';
  const showError = (message) => {
    document.documentElement.dataset.appLoadError = message;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:12px 14px;border:1px solid #ff7582;background:#180b0e;color:#ffd9dd;border-radius:10px;font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif';
    bar.textContent = `ドルとリラ runtime ${BUILD}: ${message}`;
    document.body.appendChild(bar);
  };

  window.__DTL_BUILD__ = BUILD;
  Promise.all([
    fetch(`./app.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`app.js HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-20260906-1100.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`accounting patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-swap-decimals-20260906.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`swap decimal patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-calendar-breakdown-20260906.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`calendar patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-mobile-pwa-20260906.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`mobile/PWA patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-access-layout-20260906.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`access/layout patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-swap-precision-20260906.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`swap precision patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-hirose-history-20260906.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`Hirose history patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-hirose-rate-history-20260907.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`Hirose rate history patch HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-hirose-pending-bootstrap-20260907.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`Hirose pending bootstrap HTTP ${r.status}`);
      return r.text();
    }),
    fetch(`./patch-close-conversion-20260908.js?runtime=${BUILD}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`close conversion patch HTTP ${r.status}`);
      return r.text();
    })
  ])
    .then(([appSource, accountingSource, swapDecimalSource, calendarSource, pwaSource, accessLayoutSource, swapPrecisionSource, hiroseHistorySource, hiroseRateHistorySource, hirosePendingBootstrapSource, closeConversionSource]) => {
      // JPY values retain their fractional precision internally. The common display
      // formatter truncates toward zero only at render time instead of rounding.
      const oldMoneyBody = "${Number(v) < 0 ? '-' : ''}¥${Math.abs(Number(v)).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}";
      const newMoneyBody = "${Math.trunc(Number(v)) < 0 ? '-' : ''}¥${Math.abs(Math.trunc(Number(v))).toLocaleString('ja-JP')}";
      const displayNormalizedAppSource = appSource.replace(oldMoneyBody, newMoneyBody);
      if (displayNormalizedAppSource === appSource) throw new Error('JPY display formatter patch target missing');

      // New installs/reset defaults use 1 lot = 1,000 units. Existing persisted
      // user settings still override this through loadState's settings merge.
      const defaultUnitsNormalizedAppSource = displayNormalizedAppSource.replace('unitsPerLot: 10000', 'unitsPerLot: 1000');
      if (defaultUnitsNormalizedAppSource === displayNormalizedAppSource) throw new Error('default lot-size patch target missing');

      (0, eval)(`${defaultUnitsNormalizedAppSource}\n${accountingSource}\n${swapDecimalSource}\n${calendarSource}\n${pwaSource}\n${accessLayoutSource}\n${swapPrecisionSource}\n${hiroseHistorySource}\n${hiroseRateHistorySource}\n${hirosePendingBootstrapSource}\n${closeConversionSource}\n//# sourceURL=dollar-to-lira-${BUILD}.js`);
      document.documentElement.dataset.runtimeBuild = BUILD;
    })
    .catch((error) => showError(error?.message || String(error)));
})();
