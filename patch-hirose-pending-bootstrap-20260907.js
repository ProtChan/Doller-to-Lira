// Load provisional-Hirose-entry handling after both async Hirose layers have settled.
// This ensures the initial reconciliation can immediately upgrade previously pending
// rows when the official date has appeared in the persisted history.
(() => {
  const root = document.documentElement;
  let loaded = false;
  let observer = null;

  const historySettled = () => root.dataset.hiroseHistoryReady === '1' || root.dataset.hiroseHistoryReady === '0';
  const readyToLoad = () => root.dataset.hiroseMargin === '1' && historySettled();

  const loadPendingPatch = () => {
    if (loaded || !readyToLoad()) return;
    loaded = true;
    observer?.disconnect();
    fetch(`./patch-hirose-pending-20260907.js?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Hirose pending patch HTTP ${r.status}`);
        return r.text();
      })
      .then((source) => eval(source))
      .catch((error) => {
        loaded = false;
        root.dataset.hirosePendingEntries = '0';
        root.dataset.hirosePendingError = error?.message || String(error);
        console.warn('Hirose pending-entry patch failed', error);
      });
  };

  if (readyToLoad()) loadPendingPatch();
  else {
    observer = new MutationObserver(loadPendingPatch);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-hirose-margin', 'data-hirose-history-ready']
    });
  }
})();
