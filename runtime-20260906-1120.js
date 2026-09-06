(() => {
  const BUILD = '20260906-1120';
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
    })
  ])
    .then(([appSource, accountingSource, swapDecimalSource, calendarSource]) => {
      (0, eval)(`${appSource}\n${accountingSource}\n${swapDecimalSource}\n${calendarSource}\n//# sourceURL=dollar-to-lira-${BUILD}.js`);
      document.documentElement.dataset.runtimeBuild = BUILD;
    })
    .catch((error) => showError(error?.message || String(error)));
})();
