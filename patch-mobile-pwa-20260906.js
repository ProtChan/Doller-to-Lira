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

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
        .then((registration) => {
          registration.update().catch(() => {});
          document.documentElement.dataset.pwaReady = '1';
        })
        .catch((error) => {
          console.warn('service worker registration failed', error);
          document.documentElement.dataset.pwaReady = '0';
        });
    }, { once: true });
  } else {
    document.documentElement.dataset.pwaReady = 'unsupported';
  }
})();
