// Final guard for explicit TRY/JPY valuation persistence and derived accounting.
// Some Hirose layers are loaded asynchronously and can replace saveDailyFrom after
// the same-day valuation patch has already wrapped it. Keep the manual conversion
// authoritative regardless of wrapper load order, including derived PnL/risk metrics.
(() => {
  const root = document.documentElement;
  if (root.dataset.valuationSaveFinal === '1') return;

  const STORE_KEY = 'dollar-to-lira:v1';
  let installedSaveWrapper = null;
  let installedDerivedWrapper = null;

  const capture = (prefix) => {
    const date = document.getElementById(`${prefix}Date`)?.value || '';
    const input = document.getElementById(`${prefix}ValuationTryJpy`);
    const value = Number(input?.value);
    return {
      date,
      manual: input?.dataset.conversionSource === 'manual' && Number.isFinite(value) && value > 0,
      value
    };
  };

  const persist = (payload) => {
    if (!payload?.date || !Array.isArray(state?.daily)) return;
    const row = state.daily.find((item) => item?.date === payload.date);
    if (!row) return;

    if (payload.manual) {
      row.valuationTryJpy = payload.value;
      row.valuationTryJpySource = 'manual';
      row.tryJpy = payload.value;
    } else {
      delete row.valuationTryJpy;
      row.valuationTryJpySource = 'synthetic';
      const rate = Number(row.rate);
      const usdJpy = Number(row.usdJpy);
      if (rate > 0 && usdJpy > 0) row.tryJpy = usdJpy / rate;
    }

    state.updatedAt = new Date(Date.now() + 1).toISOString();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    try { renderAll(); } catch (_) {}
  };

  const installSaveGuard = () => {
    if (typeof saveDailyFrom !== 'function' || saveDailyFrom === installedSaveWrapper) return;
    const base = saveDailyFrom;
    const wrapper = function(prefix) {
      const payload = capture(prefix);
      const result = base(prefix);
      if (result) persist(payload);
      return result;
    };
    saveDailyFrom = wrapper;
    installedSaveWrapper = wrapper;
  };

  const installDerivedGuard = () => {
    if (typeof derivedDaily !== 'function' || derivedDaily === installedDerivedWrapper) return;
    const base = derivedDaily;
    const wrapper = function() {
      const rows = base();
      if (!Array.isArray(rows) || !Array.isArray(state?.daily)) return rows;

      let previousFx = 0;
      let previousTotal = 0;
      return rows.map((row) => {
        const saved = state.daily.find((item) => item?.date === row?.date);
        const explicit = Number(saved?.valuationTryJpy);
        const hasManual = explicit > 0;
        const conversionTryJpy = hasManual ? explicit : Number(row.tryJpy);
        const rate = Number(row.rate);
        const usdJpy = typeof usdJpyValueV2 === 'function'
          ? Number(usdJpyValueV2(saved || row))
          : Number(saved?.usdJpy ?? row.usdJpy);
        const fxPnl = rate > 0 && conversionTryJpy > 0
          ? portfolioFx(row.date, rate, conversionTryJpy)
          : Number(row.fxPnl || 0);
        const swap = Number(row.swap || 0);
        const total = fxPnl + swap;
        const next = {
          ...row,
          tryJpy: conversionTryJpy,
          valuationTryJpy: hasManual ? explicit : undefined,
          valuationTryJpySource: hasManual ? 'manual' : 'synthetic',
          fxPnl,
          dailyFxPnl: fxPnl - previousFx,
          total,
          dailyPnl: total - previousTotal
        };

        try { next.margin = marginRequired(row.date, rate, conversionTryJpy); } catch (_) {}
        try { next.maintenance = maintenance(row.date, rate, conversionTryJpy); } catch (_) {}
        try {
          next.lc = findLcRate(
            row.date,
            rate,
            conversionTryJpy,
            rate > 0 && conversionTryJpy > 0 ? rate * conversionTryJpy : usdJpy
          );
        } catch (_) {}

        previousFx = fxPnl;
        previousTotal = total;
        return next;
      });
    };
    derivedDaily = wrapper;
    installedDerivedWrapper = wrapper;
  };

  const install = () => {
    installSaveGuard();
    installDerivedGuard();
  };

  // Capture-phase fallback: even if an async layer replaces saveDailyFrom between
  // observer turns, persist the user's conversion immediately after that submit task.
  [['dailyForm', 'daily'], ['quickDailyForm', 'quickDaily']].forEach(([formId, prefix]) => {
    const form = document.getElementById(formId);
    if (!form || form.dataset.valuationSaveFinalBound) return;
    form.dataset.valuationSaveFinalBound = '1';
    form.addEventListener('submit', () => {
      const payload = capture(prefix);
      queueMicrotask(() => persist(payload));
    }, true);
  });

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => [
      'data-hirose-pending-entries',
      'data-hirose-history-ready',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready'
    ].includes(mutation.attributeName))) return;
    setTimeout(install, 0);
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-hirose-pending-entries',
      'data-hirose-history-ready',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready'
    ]
  });

  install();
  root.dataset.valuationSaveFinal = '1';
})();
