// Apply the persisted Hirose USD/TRY history to accounting while auto mode is enabled.
// Hirose's displayed date is the rollover/source date; calendar display is shifted to the
// following business day. Entitlement is judged on the source date itself:
//   openDate < sourceDate <= closeDate (or no closeDate)
// This keeps the user's rule that the opening day's swap is never received, while the
// closing day's source swap is still included. Friday source rows display on Monday.
(() => {
  const FEED_URL = './data/hirose-usdtry-swap.json';
  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  let history = [];
  let creditHistory = [];
  let historyByCreditDate = new Map();

  const isAuto = () => localStorage.getItem(MODE_KEY) === 'hirose';

  const parseIsoDate = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const isoFromDate = (d) => d.toISOString().slice(0, 10);

  const isWeekendDate = (date) => {
    const d = parseIsoDate(date);
    if (!d) return false;
    const day = d.getUTCDay();
    return day === 0 || day === 6;
  };

  const nextBusinessDate = (sourceDate) => {
    const d = parseIsoDate(sourceDate);
    if (!d) return '';
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return isoFromDate(d);
  };

  const creditDateForSource = (sourceDate) => nextBusinessDate(sourceDate);

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

  // Actual entitlement rule. The broker/source date, not the shifted calendar date,
  // determines whether a position owned the swap.
  const eligibleForSource = (p, sourceDate) => {
    if (!p?.date || !sourceDate) return false;
    return p.date < sourceDate && (!p.closeDate || p.closeDate >= sourceDate);
  };

  // Legacy helper semantics are retained only for old diagnostics/tests that may still
  // call __DTL_HIROSE_POSITION_SWAP__. Accounting below never uses this rule.
  const eligibleForCreditLegacy = (p, creditDate) => {
    if (!p?.date || !creditDate) return false;
    return p.date < creditDate && (!p.closeDate || p.closeDate >= creditDate);
  };

  const entryRecognizedAsOf = (p, entry, date) => {
    if (!entry || !eligibleForSource(p, entry.sourceDate)) return false;
    // Normal open-position accounting appears on the shifted credit date.
    if (entry.creditDate <= date) return true;
    // On a closed trade, the closing source-date swap is part of the realized result
    // even though its calendar posting is shown on the following business day.
    return !!p.closeDate && date >= p.closeDate && entry.sourceDate <= p.closeDate;
  };

  const positionSwapFromHistory = (p, date) => {
    const lots = Number(p?.lots || 0);
    return creditHistory
      .filter((entry) => entryRecognizedAsOf(p, entry, date))
      .reduce((sum, entry) => {
        const values = scaledValues(entry.row);
        if (!values) return sum;
        const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
        return sum + lots * perLot;
      }, 0);
  };

  const legacyPositionSwapFromHistory = (p, date) => {
    const lots = Number(p?.lots || 0);
    return creditHistory
      .filter((entry) => entry.creditDate <= date && eligibleForCreditLegacy(p, entry.creditDate))
      .reduce((sum, entry) => {
        const values = scaledValues(entry.row);
        if (!values) return sum;
        const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
        return sum + lots * perLot;
      }, 0);
  };

  const dailySwapFromHistory = (creditDate) => {
    const entry = historyByCreditDate.get(creditDate);
    const values = scaledValues(entry?.row);
    if (!entry || !values) return 0;
    return state.positions
      .filter((p) => eligibleForSource(p, entry.sourceDate))
      .reduce((sum, p) => {
        const perLot = p.side === 'short' ? values.shortPerLot : values.longPerLot;
        return sum + Number(p.lots || 0) * perLot;
      }, 0);
  };

  // Captured after the precision patch has installed fractional accounting.
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
      if (!source || !values) return { ...row, dailySwap };
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
    const root = document.documentElement;
    root.dataset.hiroseHistoryAccounting = '1';
    // Legacy marker kept so old clients do not fail readiness checks.
    root.dataset.hiroseSwapCreditRule = 'next-day-open-before-close-inclusive';
    root.dataset.hiroseSwapCalendarRule = 'next-business-day-weekend-skip';
    root.dataset.hiroseSwapEntitlementRule = 'source-date-open-exclusive-close-inclusive';
  };

  const bindControls = () => {
    const modeSelect = $('settingSwapMode');
    if (modeSelect && !modeSelect.dataset.historyAccountingBound) {
      modeSelect.dataset.historyAccountingBound = '1';
      modeSelect.addEventListener('change', () => setTimeout(() => {
        installHistoryAccounting();
        try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
        try { renderAll(); } catch (_) {}
      }, 0));
    }

    const unitsInput = $('settingUnits');
    if (unitsInput && !unitsInput.dataset.historyAccountingBound) {
      unitsInput.dataset.historyAccountingBound = '1';
      const rerender = () => setTimeout(() => {
        installHistoryAccounting();
        try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
        try { renderAll(); } catch (_) {}
      }, 0);
      unitsInput.addEventListener('input', rerender);
      unitsInput.addEventListener('change', rerender);
    }
  };

  const root = document.documentElement;
  const observer = new MutationObserver(() => {
    // Precision observer is registered before this patch, so this layer restores
    // the Hirose history accounting last on the same readiness mutation.
    installHistoryAccounting();
    bindControls();
    if (history.length) {
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
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
      // Ignore accidental weekend source rows so Friday remains the sole Monday mapping.
      creditHistory = history
        .filter((row) => !isWeekendDate(row.date))
        .map((row) => ({ row, sourceDate: row.date, creditDate: creditDateForSource(row.date) }));
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

      // Legacy diagnostic helper; actual accounting uses the explicit entitlement helper below.
      window.__DTL_HIROSE_POSITION_SWAP__ = (position, date) => legacyPositionSwapFromHistory(position, date);
      window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__ = (position, date) => positionSwapFromHistory(position, date);
      window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__ = (position, date) => eligibleForCreditLegacy(position, date);
      window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__ = (position, sourceDate) => eligibleForSource(position, sourceDate);
      window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ = (date) => dailySwapFromHistory(date);
      window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__ = (sourceDate) => creditDateForSource(sourceDate);

      root.dataset.hiroseHistoryReady = '1';
      root.dataset.hiroseHistoryStart = history[0].date;
      root.dataset.hiroseHistoryRecords = String(history.length);
      root.dataset.hiroseSwapCreditRule = 'next-day-open-before-close-inclusive';
      root.dataset.hiroseSwapCalendarRule = 'next-business-day-weekend-skip';
      root.dataset.hiroseSwapEntitlementRule = 'source-date-open-exclusive-close-inclusive';
      installHistoryAccounting();
      bindControls();
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    })
    .catch((error) => {
      root.dataset.hiroseHistoryReady = '0';
      root.dataset.hiroseHistoryError = error?.message || String(error);
      console.warn('Hirose history load failed', error);
    });
})();
