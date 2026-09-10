// Keep broker-date swap accounting authoritative if older async patches reinstall
// their legacy next-business-day wrappers after startup.
(() => {
  const root = document.documentElement;
  if (root.dataset.sameDaySwapReinforce === '1') return;

  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const isHirose = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(MODE_KEY) === 'hirose';
  const originalPositionSwap = positionSwapAsOf;
  const originalPortfolioSwap = portfolioSwap;

  const rows = () => {
    try {
      const value = typeof window.__DTL_HIROSE_HISTORY__ === 'function' ? window.__DTL_HIROSE_HISTORY__() : [];
      return Array.isArray(value) ? value.filter((row) => row?.date).sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
    } catch (_) {
      return [];
    }
  };
  const dateObject = (date) => {
    const value = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(value.getTime()) ? value : null;
  };
  const weekend = (date) => {
    const value = dateObject(date);
    if (!value) return false;
    const day = value.getUTCDay();
    return day === 0 || day === 6;
  };
  const scaled = (row) => {
    const sourceUnit = Number(row?.unit || 1000);
    const siteUnit = Number(state.settings.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return { shortPerLot: 0, longPerLot: 0 };
    const factor = siteUnit / sourceUnit;
    return {
      shortPerLot: Number(row?.sellJpy || 0) * factor,
      longPerLot: Number(row?.buyJpy || 0) * factor
    };
  };
  const resolution = (date) => {
    const history = rows();
    const row = history.find((item) => item.date === date) || null;
    if (row) {
      const amount = scaled(row);
      return {
        status: 'official', sourceDate: date, creditDate: date, weekend: false,
        row: { ...row }, shortPerLot: amount.shortPerLot, longPerLot: amount.longPerLot
      };
    }
    if (weekend(date)) {
      return { status: 'zero', sourceDate: date, creditDate: date, weekend: true, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    const latest = history.at(-1)?.date || '';
    if (latest && date <= latest) {
      return { status: 'zero', sourceDate: date, creditDate: date, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    return { status: 'pending', sourceDate: date, creditDate: date, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
  };
  const eligible = (position, date) => Boolean(position?.date && date && position.date < date && (!position.closeDate || position.closeDate >= date));
  const entitledPositionSwap = (position, date) => {
    const lots = Number(position?.lots || 0);
    return rows()
      .filter((row) => row.date <= date && eligible(position, row.date))
      .reduce((sum, row) => {
        const amount = scaled(row);
        return sum + lots * (position.side === 'short' ? amount.shortPerLot : amount.longPerLot);
      }, 0);
  };
  const entitledDailySwap = (date) => {
    const current = resolution(date);
    if (current.status !== 'official') return 0;
    return state.positions
      .filter((position) => eligible(position, date))
      .reduce((sum, position) => sum + Number(position.lots || 0) * (position.side === 'short' ? current.shortPerLot : current.longPerLot), 0);
  };

  const install = () => {
    // Reinstall ALL public helpers, not only portfolio wrappers. Some legacy async
    // loaders publish their old previous-day resolver after the history request ends.
    window.__DTL_HIROSE_SWAP_RESOLUTION__ = (date) => ({ ...resolution(date) });
    window.__DTL_HIROSE_CREDIT_AT__ = (date) => {
      const current = resolution(date);
      return current.status === 'official'
        ? { sourceDate: date, creditDate: date, row: { ...current.row } }
        : null;
    };
    window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__ = (date) => date;
    window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__ = (position, date) => eligible(position, date);
    window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__ = (position, date) => entitledPositionSwap(position, date);
    window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ = (date) => entitledDailySwap(date);
    window.__DTL_HIROSE_SAME_DAY_SWAP_AT__ = (date) => ({ ...resolution(date) });

    positionSwapAsOf = function(position, date) {
      if (isHirose() && rows().length) return entitledPositionSwap(position, date);
      return originalPositionSwap(position, date);
    };

    portfolioSwap = function(date) {
      if (isHirose() && rows().length) {
        return state.positions.reduce((sum, position) => sum + entitledPositionSwap(position, date), 0);
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
