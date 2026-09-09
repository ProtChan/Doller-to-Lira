(() => {
  const BUILD = '20260910-0015';
  const showError = (message) => {
    document.documentElement.dataset.appLoadError = message;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:12px 14px;border:1px solid #ff7582;background:#180b0e;color:#ffd9dd;border-radius:10px;font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif';
    bar.textContent = `ドルとリラ runtime ${BUILD}: ${message}`;
    document.body.appendChild(bar);
  };

  const source = (path, label) => fetch(`./${path}?runtime=${BUILD}`, { cache: 'force-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
    return r.text();
  });

  window.__DTL_BUILD__ = BUILD;
  Promise.all([
    source('app.js', 'app.js'),
    source('patch-20260906-1100.js', 'accounting patch'),
    source('patch-swap-decimals-20260906.js', 'swap decimal patch'),
    source('patch-calendar-breakdown-20260906.js', 'calendar patch'),
    source('patch-mobile-pwa-20260906.js', 'mobile/PWA patch'),
    source('patch-access-layout-20260906.js', 'access/layout patch'),
    source('patch-swap-precision-20260906.js', 'swap precision patch'),
    source('patch-hirose-history-20260906.js', 'Hirose history patch'),
    source('patch-hirose-rate-history-20260907.js', 'Hirose rate history patch'),
    source('patch-hirose-pending-bootstrap-20260907.js', 'Hirose pending bootstrap'),
    source('patch-hirose-input-settle-20260909.js', 'Hirose input settle patch'),
    source('patch-close-conversion-20260908.js', 'close conversion patch'),
    source('patch-capital-history-20260908.js', 'capital history patch'),
    source('patch-rate-source-edit-performance-20260908.js', 'rate/edit/performance patch'),
    source('patch-user-prepared-rates-20260909.js', 'unified rate input patch'),
    source('patch-worst-ask-risk-20260909.js', 'worst ASK risk patch'),
    source('patch-reference-data-rebuild-20260909.js', 'reference data rebuild patch'),
    source('patch-private-publisher-daily-layout-20260909.js', 'private publisher/daily layout patch'),
    source('patch-live-rate-refresh-20260910.js', 'live Hirose rate refresh patch')
  ])
    .then(([appSource, accountingSource, swapDecimalSource, calendarSource, pwaSource, accessLayoutSource, swapPrecisionSource, hiroseHistorySource, hiroseRateHistorySource, hirosePendingBootstrapSource, hiroseInputSettleSource, closeConversionSource, capitalHistorySource, rateEditPerformanceSource, userPreparedRateSource, worstAskRiskSource, referenceDataRebuildSource, privatePublisherDailyLayoutSource, liveRateRefreshSource]) => {
      const oldMoneyBody = "${Number(v) < 0 ? '-' : ''}¥${Math.abs(Number(v)).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}";
      const newMoneyBody = "${Math.trunc(Number(v)) < 0 ? '-' : ''}¥${Math.abs(Math.trunc(Number(v))).toLocaleString('ja-JP')}";
      const displayNormalizedAppSource = appSource.replace(oldMoneyBody, newMoneyBody);
      if (displayNormalizedAppSource === appSource) throw new Error('JPY display formatter patch target missing');

      const defaultUnitsNormalizedAppSource = displayNormalizedAppSource.replace('unitsPerLot: 10000', 'unitsPerLot: 1000');
      if (defaultUnitsNormalizedAppSource === displayNormalizedAppSource) throw new Error('default lot-size patch target missing');

      (0, eval)(`${defaultUnitsNormalizedAppSource}\n${accountingSource}\n${swapDecimalSource}\n${calendarSource}\n${pwaSource}\n${accessLayoutSource}\n${swapPrecisionSource}\n${hiroseHistorySource}\n${hiroseRateHistorySource}\n${hirosePendingBootstrapSource}\n${hiroseInputSettleSource}\n${closeConversionSource}\n${capitalHistorySource}\n${rateEditPerformanceSource}\n${userPreparedRateSource}\n${worstAskRiskSource}\n${referenceDataRebuildSource}\n${privatePublisherDailyLayoutSource}\n${liveRateRefreshSource}\n//# sourceURL=dollar-to-lira-${BUILD}.js`);
      document.documentElement.dataset.runtimeBuild = BUILD;
      const status = document.querySelector('.local-status');
      if (status) status.innerHTML = '<i></i>LOCAL · 0015';
    })
    .catch((error) => showError(error?.message || String(error)));
})();
