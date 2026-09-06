// Apply the persisted Hirose USD/TRY history to accounting while auto mode is enabled.
// This is intentionally non-destructive: manual daily rows stay untouched in localStorage.
(() => {
  const FEED_URL = './data/hirose-usdtry-swap.json';
  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  let history = [];
  let historyByDate = new Map();

  const isAuto = () => localStorage.getItem(MODE_KEY) === 'hirose';

  const scaledValues = (row) => {
    if (!row) return null;
    const sourceUnit = Number(row.unit || 1000);
    const siteUnit = Number(state.settings.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return null;
    const factor = siteUnit / sourceUnit;
    return {
      shortPerLot: Number(row.sellJpy || 0) * factor,
      longPerLot: Number(row.buyJpy || 0) * factor,
    };
  };

  const positionSwapFromHistory = (p, date) => {
    const lots = Number(p?.lots || 0);
    return history
      .filter((row) => row.date >= p.date && row.date <= date && (!p.closeDate || row.date < p.closeDate))
      .reduce((sum, row) => {
        const values = scaledValues(row);
        if (!values) return sum;
        const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
        return sum + lots * perLot;
      }, 0);
  };

  const dailySwapFromHistory = (date) => {
    const row = historyByDate.get(date);
    const values = scaledValues(row);
    if (!row || !values) return null;
    return openPositionsOn(date).reduce((sum, p) => {
      const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
      return sum + Number(p.lots || 0) * perLot;
    }, 0);
  };

  const basePositionSwapAsOf = positionSwapAsOf;
  const baseDerivedDaily = derivedDaily;

  positionSwapAsOf = function(p, date) {
    if (!isAuto() || !history.length) return basePositionSwapAsOf(p, date);
    return positionSwapFromHistory(p, date);
  };

  portfolioSwap = function(date) {
    return state.positions.reduce((sum, p) => sum + positionSwapAsOf(p, date), 0);
  };

  derivedDaily = function() {
    const rows = baseDerivedDaily();
    if (!isAuto() || !history.length) return rows;
    return rows.map((row) => {
      const source = historyByDate.get(row.date);
      const values = scaledValues(source);
      if (!source || !values) return row;
      const dailySwap = dailySwapFromHistory(row.date);
      return {
        ...row,
        swapPerLot: values.shortPerLot,
        swapLongPerLot: values.longPerLot,
        swapSource: 'hirose',
        swapSourceDays: Number(source.days || 0),
        swapSourceUnit: Number(source.unit || 1000),
        swapSourceSellJpy: Number(source.sellJpy || 0),
        swapSourceBuyJpy: Number(source.buyJpy || 0),
        dailySwap: dailySwap == null ? row.dailySwap : dailySwap,
      };
    });
  };

  const bindControls = () => {
    const modeSelect = $('settingSwapMode');
    if (modeSelect && !modeSelect.dataset.historyAccountingBound) {
      modeSelect.dataset.historyAccountingBound = '1';
      modeSelect.addEventListener('change', () => setTimeout(() => {
        try { renderAll(); } catch (_) {}
      }, 0));
    }

    const unitsInput = $('settingUnits');
    if (unitsInput && !unitsInput.dataset.historyAccountingBound) {
      unitsInput.dataset.historyAccountingBound = '1';
      const rerender = () => setTimeout(() => {
        try { renderAll(); } catch (_) {}
      }, 0);
      unitsInput.addEventListener('input', rerender);
      unitsInput.addEventListener('change', rerender);
    }
  };

  const root = document.documentElement;
  const observer = new MutationObserver(() => bindControls());
  observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-margin', 'data-hirose-feed-ready'] });
  bindControls();

  fetch(`${FEED_URL}?history=${Date.now()}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      history = Array.isArray(data?.history)
        ? data.history.filter((row) => row && row.date >= '2026-07-01').sort((a, b) => a.date.localeCompare(b.date))
        : [];
      if (!history.length || history[0].date !== '2026-07-01') {
        throw new Error(`Hirose history start is ${history[0]?.date || 'missing'}`);
      }
      historyByDate = new Map(history.map((row) => [row.date, row]));
      window.__DTL_HIROSE_HISTORY__ = () => history.map((row) => ({ ...row }));
      root.dataset.hiroseHistoryReady = '1';
      root.dataset.hiroseHistoryStart = history[0].date;
      root.dataset.hiroseHistoryRecords = String(history.length);
      bindControls();
      try { renderAll(); } catch (_) {}
    })
    .catch((error) => {
      root.dataset.hiroseHistoryReady = '0';
      root.dataset.hiroseHistoryError = error?.message || String(error);
      console.warn('Hirose history load failed', error);
    });
})();
