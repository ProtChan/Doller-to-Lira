// Keep broker-date swap accounting authoritative if older async patches reinstall
// their legacy next-business-day wrappers after startup.
(() => {
  const root = document.documentElement;
  if (root.dataset.sameDaySwapReinforce === '1') return;

  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const isHirose = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(MODE_KEY) === 'hirose';
  const originalPositionSwap = positionSwapAsOf;
  const originalPortfolioSwap = portfolioSwap;

  const sameDayPositionSwap = (position, date) => {
    try {
      const helper = window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__;
      const value = typeof helper === 'function' ? Number(helper(position, date)) : NaN;
      return Number.isFinite(value) ? value : null;
    } catch (_) {
      return null;
    }
  };

  const install = () => {
    positionSwapAsOf = function(position, date) {
      if (isHirose()) {
        const value = sameDayPositionSwap(position, date);
        if (value != null) return value;
      }
      return originalPositionSwap(position, date);
    };

    portfolioSwap = function(date) {
      if (isHirose()) {
        let usable = true;
        const value = state.positions.reduce((sum, position) => {
          const amount = sameDayPositionSwap(position, date);
          if (amount == null) usable = false;
          return sum + (amount == null ? 0 : amount);
        }, 0);
        if (usable) return value;
      }
      return originalPortfolioSwap(date);
    };

    root.dataset.hiroseSwapCreditRule = 'same-day-table-date';
    root.dataset.hiroseSwapCalendarRule = 'same-day-table-date';
    root.dataset.hiroseSwapEntitlementRule = 'table-date-open-exclusive-close-inclusive';
    root.dataset.sameDaySwapAccountingActive = '1';
  };

  const reinstallSoon = () => setTimeout(() => {
    install();
    try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
    try { renderAll(); } catch (_) {}
  }, 0);

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => [
      'data-hirose-margin',
      'data-hirose-feed-ready',
      'data-hirose-history-ready',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready'
    ].includes(mutation.attributeName))) return;
    reinstallSoon();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-hirose-margin',
      'data-hirose-feed-ready',
      'data-hirose-history-ready',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready'
    ]
  });

  const units = document.getElementById('settingUnits');
  if (units && !units.dataset.sameDaySwapReinforceBound) {
    units.dataset.sameDaySwapReinforceBound = '1';
    units.addEventListener('input', reinstallSoon);
    units.addEventListener('change', reinstallSoon);
  }

  install();
  root.dataset.sameDaySwapReinforce = '1';
})();
