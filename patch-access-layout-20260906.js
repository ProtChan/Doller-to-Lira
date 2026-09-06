// Lightweight pageview counter + Hirose auto-swap form alignment.
// No visible UI, cookies, localStorage, URL path, or referrer are sent by this patch.
(() => {
  const COUNTER_HIT = 'https://countapi.mileshilliard.com/api/v1/hit/protchan-doller-to-lira-pageviews-v1';
  const COUNTER_GET = 'https://countapi.mileshilliard.com/api/v1/get/protchan-doller-to-lira-pageviews-v1';

  const style = document.createElement('style');
  style.dataset.dtlAccessLayout = '1';
  style.textContent = `
    /* Keep Hirose source metadata in the DOM, but remove it from visual layout. */
    .compact-form .swap-source-note,
    .daily-entry-bar .swap-source-note {
      position:absolute!important;
      width:1px!important;
      height:1px!important;
      padding:0!important;
      margin:-1px!important;
      overflow:hidden!important;
      clip:rect(0,0,0,0)!important;
      white-space:nowrap!important;
      border:0!important;
    }
    .compact-form input[data-hirose-auto="1"],
    .daily-entry-bar input[data-hirose-auto="1"] {
      min-height:39px;
    }
  `;
  document.head.appendChild(style);

  document.documentElement.dataset.swapAutoAligned = '1';
  window.__DTL_ACCESS_COUNT_URL__ = COUNTER_GET;

  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isAutomation = navigator.webdriver === true;
  const isRealPagesHost = host === 'protchan.github.io';

  if (isRealPagesHost && !isLocal && !isAutomation) {
    fetch(COUNTER_HIT, {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      keepalive: true
    }).catch(() => {});
  }

  document.documentElement.dataset.accessCounter = isRealPagesHost && !isAutomation ? 'active' : 'skipped';
})();
