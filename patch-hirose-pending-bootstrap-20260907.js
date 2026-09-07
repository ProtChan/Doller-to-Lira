// Load the provisional-Hirose-entry patch only after the async Hirose integration
// has installed its form handlers. Direct eval keeps access to the app lexical scope.
(() => {
  const root = document.documentElement;
  let loaded = false;

  const loadPendingPatch = () => {
    if (loaded || root.dataset.hiroseMargin !== '1') return;
    loaded = true;
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

  if (root.dataset.hiroseMargin === '1') loadPendingPatch();
  else {
    const observer = new MutationObserver(() => {
      if (root.dataset.hiroseMargin !== '1') return;
      observer.disconnect();
      loadPendingPatch();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-margin'] });
  }
})();
