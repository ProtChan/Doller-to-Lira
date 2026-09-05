(() => {
  const BUILD = '20260906-1616';
  const showError = (message) => {
    document.documentElement.dataset.appLoadError = message;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:12px 14px;border:1px solid #ff7582;background:#180b0e;color:#ffd9dd;border-radius:10px;font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif';
    bar.textContent = `ドルとリラ runtime ${BUILD}: ${message}`;
    document.body.appendChild(bar);
  };

  window.__DTL_BUILD__ = BUILD;
  fetch(`./app.js?runtime=${BUILD}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`app.js HTTP ${response.status}`);
      return response.text();
    })
    .then((source) => {
      (0, eval)(`${source}\n//# sourceURL=dollar-to-lira-app-${BUILD}.js`);
      document.documentElement.dataset.runtimeBuild = BUILD;
    })
    .catch((error) => showError(error?.message || String(error)));
})();
