// Apply the persisted Hirose USD/TRY history to accounting while auto mode is enabled.
// Hirose's displayed swap date is treated as the rollover night; accounting credits it
// on the following calendar day. A position receives a credit only when
// openDate < creditDate <= closeDate (or there is no closeDate).
(() => {
  const FEED_URL = './data/hirose-usdtry-swap.json';
  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  let history = [];
  let creditHistory = [];
  let historyByCreditDate = new Map();

  const isAuto = () => localStorage.getItem(MODE_KEY) === 'hirose';

  const shiftIsoDate = (date, days) => {
    const d = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const creditDateForSource = (sourceDate) => shiftIsoDate(sourceDate, 1);

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

  const eligibleForCredit = (p, creditDate) => {
    if (!p?.date || !creditDate) return false;
    return p.date < creditDate && (!p.closeDate || p.closeDate >= creditDate);
  };

  const positionSwapFromHistory = (p, date) => {
    const lots = Number(p?.lots || 0);
    return creditHistory
      .filter((entry) => entry.creditDate <= date && eligibleForCredit(p, entry.creditDate))
      .reduce((sum, entry) => {
        const values = scaledValues(entry.row);
        if (!values) return sum;
        const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
        return sum + lots * perLot;
      }, 0);
  };

  const dailySwapFromHistory = (date) => {
    const entry = historyByCreditDate.get(date);
    const values = scaledValues(entry?.row);
    if (!entry || !values) return 0;
    return state.positions
      .filter((p) => eligibleForCredit(p, date))
      .reduce((sum, p) => {
        const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
        return sum + Number(p.lots || 0) * perLot;
      }, 0);
  };

  // Captured after the precision patch has installed fractional accounting.
  // Hirose itself loads asynchronously and may overwrite these symbols later, so
  // installHistoryAccounting() is intentionally idempotent and re-applied on readiness changes.
  const basePositionSwapAsOf = positionSwapAsOf;
  const baseDerivedDaily = derivedDaily;

  const historyPositionSwapAsOf = function(p, date) {
    if (!isAuto() || !history.length) return basePositionSwapAsOf(p, date);
    return positionSwapFromHistory(p, date);
  };

  const historyPortfolioSwap = function(date) {
    return state.positions.reduce((sum, p) => sum + historyPositionSwapAsOf(p, date), 0);
  };

  const historyDerivedDaily = function() {
    const rows = baseDerivedDaily();
    if (!isAuto() || !history.length) return rows;
    return rows.map((row) => {
      const entry = historyByCreditDate.get(row.date);
      const source = entry?.row || null;
      const values = scaledValues(source);
      const dailySwap = dailySwapFromHistory(row.date);
      if (!source || !values) {
        return {
          ...row,
          dailySwap,
        };
      }
      return {
        ...row,
        swapPerLot: values.shortPerLot,
        swapLongPerLot: values.longPerLot,
        swapSource: 'hirose',
        swapSourceDate: source.date,
        swapCreditDate: row.date,
        swapSourceDays: Number(source.days || 0),
        swapSourceUnit: Number(source.unit || 1000),
        swapSourceSellJpy: Number(source.sellJpy || 0),
        swapSourceBuyJpy: Number(source.buyJpy || 0),
        dailySwap,
      };
    });
  };

  const installHistoryAccounting = () => {
    positionSwapAsOf = historyPositionSwapAsOf;
    portfolioSwap = historyPortfolioSwap;
    derivedDaily = historyDerivedDaily;
    document.documentElement.dataset.hiroseHistoryAccounting = '1';
    document.documentElement.dataset.hiroseSwapCreditRule = 'next-day-open-before-close-inclusive';
  };

  const bindControls = () => {
    const modeSelect = $('settingSwapMode');
    if (modeSelect && !modeSelect.dataset.historyAccountingBound) {
      modeSelect.dataset.historyAccountingBound = '1';
      modeSelect.addEventListener('change', () => setTimeout(() => {
        installHistoryAccounting();
        try { renderAll(); } catch (_) {}
      }, 0));
    }

    const unitsInput = $('settingUnits');
    if (unitsInput && !unitsInput.dataset.historyAccountingBound) {
      unitsInput.dataset.historyAccountingBound = '1';
      const rerender = () => setTimeout(() => {
        installHistoryAccounting();
        try { renderAll(); } catch (_) {}
      }, 0);
      unitsInput.addEventListener('input', rerender);
      unitsInput.addEventListener('change', rerender);
    }
  };

  const root = document.documentElement;
  const observer = new MutationObserver(() => {
    // Precision observer is registered before this patch, so on the same readiness
    // mutation it restores fractional accounting first and this callback layers
    // full Hirose history on top of it last.
    installHistoryAccounting();
    bindControls();
    if (history.length) {
      try { renderAll(); } catch (_) {}
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-margin', 'data-hirose-feed-ready'] });
  installHistoryAccounting();
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
      creditHistory = history.map((row) => ({
        row,
        sourceDate: row.date,
        creditDate: creditDateForSource(row.date),
      }));
      historyByCreditDate = new Map(creditHistory.map((entry) => [entry.creditDate, entry]));
      window.__DTL_HIROSE_HISTORY__ = () => history.map((row) => ({ ...row }));
      window.__DTL_HIROSE_CREDIT_HISTORY__ = () => creditHistory.map((entry) => ({
        sourceDate: entry.sourceDate,
        creditDate: entry.creditDate,
        row: { ...entry.row },
      }));
      window.__DTL_HIROSE_CREDIT_AT__ = (date) => {
        const entry = historyByCreditDate.get(date);
        return entry ? { sourceDate: entry.sourceDate, creditDate: entry.creditDate, row: { ...entry.row } } : null;
      };
      window.__DTL_HIROSE_POSITION_SWAP__ = (position, date) => positionSwapFromHistory(position, date);
      window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__ = (position, date) => eligibleForCredit(position, date);
      root.dataset.hiroseHistoryReady = '1';
      root.dataset.hiroseHistoryStart = history[0].date;
      root.dataset.hiroseHistoryRecords = String(history.length);
      root.dataset.hiroseSwapCreditRule = 'next-day-open-before-close-inclusive';
      installHistoryAccounting();
      bindControls();
      try { renderAll(); } catch (_) {}
    })
    .catch((error) => {
      root.dataset.hiroseHistoryReady = '0';
      root.dataset.hiroseHistoryError = error?.message || String(error);
      console.warn('Hirose history load failed', error);
    });
})();
