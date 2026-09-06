// Mobile backup access + PWA registration.
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

  const registerPwa = () => {
    navigator.serviceWorker.register('./sw.js?v=20260906-1140', { scope: './', updateViaCache: 'none' })
      .then((registration) => {
        document.documentElement.dataset.pwaReady = '1';
        registration.update().catch(() => {});
      })
      .catch((error) => {
        console.warn('service worker registration failed', error);
        document.documentElement.dataset.pwaReady = '0';
        document.documentElement.dataset.pwaError = error?.message || String(error);
      });
  };

  if (canUseServiceWorker) {
    // This patch itself is loaded asynchronously. On a fast page the window load
    // event may already have fired by the time the patch executes, so register
    // immediately in that case instead of waiting for an event that will never recur.
    if (document.readyState === 'complete') registerPwa();
    else window.addEventListener('load', registerPwa, { once: true });
  } else {
    document.documentElement.dataset.pwaReady = 'unsupported';
  }
})();
