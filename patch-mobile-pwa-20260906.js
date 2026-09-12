// Mobile backup access + PWA registration/update handoff.
(() => {
  const mobileBackupBtn = document.getElementById('openBackupFromSettingsBtn');
  mobileBackupBtn?.addEventListener('click', () => {
    closeSettings();
    renderSettings();
    document.getElementById('backupDialog')?.showModal?.();
  });

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  document.documentElement.dataset.displayMode = standalone ? 'standalone' : 'browser';

  const canUseServiceWorker = 'serviceWorker' in navigator && (
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  );

  if (!canUseServiceWorker) {
    document.documentElement.dataset.pwaReady = 'unsupported';
    return;
  }

  const build = String(window.__DTL_BUILD__ || document.documentElement.dataset.runtimeBuild || 'dev');
  const hadControllerAtBoot = Boolean(navigator.serviceWorker.controller);
  let registration = null;
  let lastUpdateCheck = 0;
  let reloading = false;

  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    document.documentElement.dataset.pwaReloading = '1';
    location.reload();
  };

  const checkForUpdate = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && now - lastUpdateCheck < 30000) return;
    lastUpdateCheck = now;

    try {
      registration ||= await navigator.serviceWorker.getRegistration('./');
      await registration?.update?.();
    } catch (_) {}

    try {
      const response = await fetch(`./build-meta.json?t=${now}`, { cache: 'no-store' });
      if (!response.ok) return;
      const meta = await response.json();
      const latest = String(meta?.build || '');
      if (latest && latest !== build) {
        document.documentElement.dataset.updateAvailable = latest;
        try { await registration?.update?.(); } catch (_) {}
        // Even if an older controller is still finishing its update cycle, a
        // navigation is network-first and loads the versioned newest bundle.
        reloadOnce();
      }
    } catch (_) {
      // Offline is fine; keep the current cached build.
    }
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Do not reload on a user's first-ever service-worker installation. Do reload
    // when an existing installation hands control to a newer worker.
    if (hadControllerAtBoot) reloadOnce();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'DTL_UPDATE_READY') reloadOnce();
    if (event.data?.type === 'DTL_BUILD' && event.data?.build) {
      document.documentElement.dataset.serviceWorkerBuild = String(event.data.build);
    }
  });

  const registerPwa = async () => {
    try {
      registration = await navigator.serviceWorker.register(
        `./sw.js?v=${encodeURIComponent(build)}`,
        { scope: './', updateViaCache: 'none' }
      );
      document.documentElement.dataset.pwaReady = '1';
      document.documentElement.dataset.pwaBuild = build;
      await registration.update().catch(() => {});
      navigator.serviceWorker.controller?.postMessage?.({ type: 'DTL_GET_BUILD' });
      await checkForUpdate({ force: true });
    } catch (error) {
      console.warn('service worker registration failed', error);
      document.documentElement.dataset.pwaReady = '0';
      document.documentElement.dataset.pwaError = error?.message || String(error);
    }
  };

  if (document.readyState === 'complete') registerPwa();
  else window.addEventListener('load', registerPwa, { once: true });

  // Installed PWAs can stay alive for a long time. Check again whenever the user
  // returns to the app, and periodically while it remains open.
  window.addEventListener('pageshow', () => checkForUpdate({ force: true }));
  window.addEventListener('focus', () => checkForUpdate({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate({ force: true });
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdate();
  }, 15 * 60 * 1000);
})();
