// Final swap-display semantics: broker rows are shown on the following business day.
// Entitlement is judged on that shifted display/credit date, not on the broker row date:
//   openDate < creditDate <= closeDate (or no closeDate)
// This keeps total swap unchanged while aligning the cumulative chart with FX PnL dates.
(() => {
  const root = document.documentElement;
  if (root.dataset.shiftedSwapDisplay === '1') return;

  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const STORE_KEY_SHIFT = 'dollar-to-lira:v1';
  const isHirose = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(MODE_KEY) === 'hirose';

  // Capture the already-installed lower layers exactly once. Reinstallation below always
  // points back to these stable bases so async legacy observers cannot create wrapper chains.
  const fallbackPositionSwap = positionSwapAsOf;
  const fallbackPortfolioSwap = portfolioSwap;
  const fallbackRenderKpis = renderKpis;
  const fallbackDerivedDaily = derivedDaily;
  const fallbackSaveDailyFrom = saveDailyFrom;
  const fallbackReferenceRebuild = typeof window.__DTL_REBUILD_REFERENCE_DATA__ === 'function'
    ? window.__DTL_REBUILD_REFERENCE_DATA__
    : null;

  const parseDate = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const iso = (d) => d.toISOString().slice(0, 10);
  const isWeekend = (date) => {
    const d = parseDate(date);
    if (!d) return false;
    const day = d.getUTCDay();
    return day === 0 || day === 6;
  };
  const nextBusinessDate = (sourceDate) => {
    const d = parseDate(sourceDate);
    if (!d) return '';
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return iso(d);
  };
  const previousBusinessDate = (creditDate) => {
    const d = parseDate(creditDate);
    if (!d) return '';
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return iso(d);
  };

  const historyRows = () => {
    try {
      const value = typeof window.__DTL_HIROSE_HISTORY__ === 'function' ? window.__DTL_HIROSE_HISTORY__() : [];
      return Array.isArray(value)
        ? value.filter((row) => row?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
        : [];
    } catch (_) {
      return [];
    }
  };
  const creditEntries = () => historyRows()
    .filter((row) => !isWeekend(row.date))
    .map((row) => ({ sourceDate: row.date, creditDate: nextBusinessDate(row.date), row: { ...row } }));
  const creditMap = () => new Map(creditEntries().map((entry) => [entry.creditDate, entry]));

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

  const resolutionForCredit = (creditDate) => {
    if (!creditDate) return { status: 'zero', sourceDate: '', creditDate: '', weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
    if (isWeekend(creditDate)) {
      return { status: 'zero', sourceDate: previousBusinessDate(creditDate), creditDate, weekend: true, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    const entry = creditMap().get(creditDate) || null;
    if (entry) {
      const amount = scaled(entry.row);
      return {
        status: 'official',
        sourceDate: entry.sourceDate,
        creditDate,
        weekend: false,
        row: { ...entry.row },
        shortPerLot: amount.shortPerLot,
        longPerLot: amount.longPerLot
      };
    }
    const sourceDate = previousBusinessDate(creditDate);
    const rows = historyRows();
    const latestSource = rows.at(-1)?.date || '';
    if (latestSource && sourceDate && sourceDate <= latestSource) {
      return { status: 'zero', sourceDate, creditDate, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    return { status: 'pending', sourceDate, creditDate, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
  };

  const eligibleForCredit = (position, creditDate) => Boolean(
    position?.date
    && creditDate
    && position.date < creditDate
    && (!position.closeDate || position.closeDate >= creditDate)
  );
  const eligibleForSource = (position, sourceDate) => eligibleForCredit(position, nextBusinessDate(sourceDate));

  const shiftedPositionSwap = (position, asOfDate) => {
    const lots = Number(position?.lots || 0);
    return creditEntries()
      .filter((entry) => entry.creditDate <= asOfDate && eligibleForCredit(position, entry.creditDate))
      .reduce((sum, entry) => {
        const amount = scaled(entry.row);
        return sum + lots * (position.side === 'short' ? amount.shortPerLot : amount.longPerLot);
      }, 0);
  };
  const shiftedDailySwap = (creditDate) => {
    const current = resolutionForCredit(creditDate);
    if (current.status !== 'official') return 0;
    return state.positions
      .filter((position) => eligibleForCredit(position, creditDate))
      .reduce((sum, position) => sum + Number(position.lots || 0) * (position.side === 'short' ? current.shortPerLot : current.longPerLot), 0);
  };
  const shiftedPortfolioSwap = (date) => state.positions.reduce((sum, position) => sum + shiftedPositionSwap(position, date), 0);

  const swapFields = (resolution) => {
    const row = resolution?.row || {};
    if (resolution?.status === 'official') {
      return {
        swapPerLot: Number(resolution.shortPerLot || 0),
        swapLongPerLot: Number(resolution.longPerLot || 0),
        swapSource: 'hirose',
        swapPending: false,
        swapSourceDate: resolution.sourceDate,
        swapCreditDate: resolution.creditDate,
        swapSourceDays: Number(row.days || 0),
        swapSourceUnit: Number(row.unit || 1000),
        swapSourceSellJpy: Number(row.sellJpy || 0),
        swapSourceBuyJpy: Number(row.buyJpy || 0)
      };
    }
    return {
      swapPerLot: 0,
      swapLongPerLot: 0,
      swapSource: resolution?.status === 'pending' ? 'hirose-pending' : 'hirose-zero',
      swapPending: resolution?.status === 'pending',
      swapSourceDate: resolution?.sourceDate || '',
      swapCreditDate: resolution?.creditDate || '',
      swapSourceDays: 0,
      swapSourceUnit: 1000,
      swapSourceSellJpy: 0,
      swapSourceBuyJpy: 0
    };
  };

  const shiftedDerivedWrapper = function() {
    const rows = fallbackDerivedDaily();
    if (!Array.isArray(rows) || !isHirose() || !historyRows().length) return rows;
    let previousTotal = 0;
    return rows.map((row) => {
      const swap = shiftedPortfolioSwap(row.date);
      const dailySwap = shiftedDailySwap(row.date);
      const fxPnl = Number(row.fxPnl || 0);
      const total = fxPnl + swap;
      const next = {
        ...row,
        ...swapFields(resolutionForCredit(row.date)),
        swap,
        dailySwap,
        total,
        dailyPnl: total - previousTotal
      };
      previousTotal = total;
      return next;
    });
  };

  const settleVisibleInput = (prefix) => {
    if (!isHirose()) return;
    const date = document.getElementById(`${prefix}Date`)?.value || '';
    const input = document.getElementById(`${prefix}Swap`);
    if (!date || !input) return;
    const current = resolutionForCredit(date);
    input.readOnly = true;
    input.value = String(Number(current.shortPerLot || 0));
    input.dataset.hiroseAuto = '1';
    delete input.dataset.hirosePending;
    delete input.dataset.hiroseZero;
    if (current.status === 'pending') input.dataset.hirosePending = '1';
    if (current.status === 'zero') input.dataset.hiroseZero = '1';

    const note = input.closest('label')?.querySelector('.swap-source-note');
    if (!note) return;
    if (current.status === 'official') {
      const row = current.row || {};
      note.textContent = `ヒロセ ${current.sourceDate}表記 → ${current.creditDate}表示 · ${Number(row.days || 0)}日分 · ${Number(row.unit || 1000).toLocaleString()}通貨 ${Number(row.sellJpy || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円 → ${Number(state.settings.unitsPerLot || 1000).toLocaleString()}通貨 ${Number(current.shortPerLot || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
    } else if (current.status === 'pending') {
      note.textContent = `${current.sourceDate}分 未確定 → ${current.creditDate}表示は現在0円`;
    } else {
      note.textContent = current.weekend ? `${date}は週末のため表示Swap 0円` : `${current.sourceDate}はヒロセ表記なし → ${date}表示Swap 0円`;
    }
  };

  const patchSavedRow = (date) => {
    if (!isHirose() || !date || !Array.isArray(state?.daily)) return false;
    const row = state.daily.find((item) => item?.date === date);
    if (!row) return false;
    Object.assign(row, swapFields(resolutionForCredit(date)));
    return true;
  };
  const migrateSavedRows = () => {
    if (!isHirose() || !historyRows().length || !Array.isArray(state?.daily)) return;
    let changed = false;
    state.daily.forEach((row) => { if (row?.date) changed = patchSavedRow(row.date) || changed; });
    if (changed) {
      state.updatedAt = new Date().toISOString();
      localStorage.setItem(STORE_KEY_SHIFT, JSON.stringify(state));
    }
  };

  const shiftedSaveWrapper = function(prefix) {
    const date = document.getElementById(`${prefix}Date`)?.value || '';
    const result = fallbackSaveDailyFrom(prefix);
    if (date && patchSavedRow(date)) {
      state.updatedAt = new Date().toISOString();
      localStorage.setItem(STORE_KEY_SHIFT, JSON.stringify(state));
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    }
    setTimeout(() => settleVisibleInput(prefix), 0);
    return result;
  };

  const shiftedReferenceRebuild = fallbackReferenceRebuild ? function(...args) {
    const finish = (result) => {
      migrateSavedRows();
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { renderAll(); } catch (_) {}
      return result;
    };
    const result = fallbackReferenceRebuild.apply(this, args);
    return result && typeof result.then === 'function' ? result.then(finish) : finish(result);
  } : null;

  let shiftedKpiWrapper = null;
  const installKpi = () => {
    if (!shiftedKpiWrapper) {
      shiftedKpiWrapper = function(...args) {
        const result = fallbackRenderKpis.apply(this, args);
        if (isHirose() && historyRows().length) {
          const rows = shiftedDerivedWrapper();
          const latest = Array.isArray(rows) ? rows.at(-1) : null;
          const sub = document.getElementById('kpiSwapDaily');
          if (sub && latest) sub.textContent = `直近 ${money(Number(latest.dailySwap || 0))}/日`;
        }
        return result;
      };
    }
    renderKpis = shiftedKpiWrapper;
  };

  const installPublic = () => {
    window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__ = (sourceDate) => nextBusinessDate(sourceDate);
    window.__DTL_HIROSE_CREDIT_HISTORY__ = () => creditEntries().map((entry) => ({
      sourceDate: entry.sourceDate,
      creditDate: entry.creditDate,
      row: { ...entry.row }
    }));
    window.__DTL_HIROSE_SWAP_RESOLUTION__ = (creditDate) => ({ ...resolutionForCredit(creditDate) });
    // Legacy name retained for compatibility; the returned row follows shifted display semantics.
    window.__DTL_HIROSE_SAME_DAY_SWAP_AT__ = (creditDate) => ({ ...resolutionForCredit(creditDate) });
    window.__DTL_HIROSE_CREDIT_AT__ = (creditDate) => {
      const current = resolutionForCredit(creditDate);
      return current.status === 'official'
        ? { sourceDate: current.sourceDate, creditDate: current.creditDate, row: { ...current.row } }
        : null;
    };
    window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__ = (position, creditDate) => eligibleForCredit(position, creditDate);
    window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__ = (position, sourceDate) => eligibleForSource(position, sourceDate);
    window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__ = (position, date) => shiftedPositionSwap(position, date);
    window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ = (date) => shiftedDailySwap(date);

    positionSwapAsOf = function(position, date) {
      if (isHirose() && historyRows().length) return shiftedPositionSwap(position, date);
      return fallbackPositionSwap(position, date);
    };
    portfolioSwap = function(date) {
      if (isHirose() && historyRows().length) return shiftedPortfolioSwap(date);
      return fallbackPortfolioSwap(date);
    };
    derivedDaily = shiftedDerivedWrapper;
    saveDailyFrom = shiftedSaveWrapper;
    if (shiftedReferenceRebuild) window.__DTL_REBUILD_REFERENCE_DATA__ = shiftedReferenceRebuild;

    root.dataset.hiroseSwapCreditRule = 'next-business-day-display-open-exclusive-close-inclusive';
    root.dataset.hiroseSwapCalendarRule = 'next-business-day-weekend-skip';
    root.dataset.hiroseSwapEntitlementRule = 'display-date-open-exclusive-close-inclusive';
    root.dataset.shiftedSwapAccountingActive = '1';
  };

  const install = () => {
    installPublic();
    installKpi();
    migrateSavedRows();
    settleVisibleInput('daily');
    settleVisibleInput('quickDaily');
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = document.getElementById(`${prefix}Date`);
    if (!dateInput || dateInput.dataset.shiftedSwapDisplayBound) return;
    dateInput.dataset.shiftedSwapDisplayBound = '1';
    const settleSoon = () => setTimeout(() => settleVisibleInput(prefix), 0);
    dateInput.addEventListener('input', settleSoon);
    dateInput.addEventListener('change', settleSoon);
  });

  const units = document.getElementById('settingUnits');
  if (units && !units.dataset.shiftedSwapDisplayBound) {
    units.dataset.shiftedSwapDisplayBound = '1';
    const reinstall = () => setTimeout(() => {
      install();
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    }, 0);
    units.addEventListener('input', reinstall);
    units.addEventListener('change', reinstall);
  }

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-hirose-margin',
      'data-hirose-pending-entries',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready',
      'data-reference-data-rebuilt-at'
    ].includes(mutation.attributeName))) return;
    setTimeout(() => {
      install();
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    }, 0);
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-hirose-margin',
      'data-hirose-pending-entries',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready',
      'data-reference-data-rebuilt-at'
    ]
  });

  install();
  root.dataset.shiftedSwapDisplay = '1';
})();