// Final guard for explicit TRY/JPY valuation persistence and derived accounting.
// Some Hirose layers are loaded asynchronously and can replace saveDailyFrom after
// the same-day valuation patch has already wrapped it. Keep the manual conversion
// authoritative regardless of wrapper load order, including derived PnL/risk metrics.
(() => {
  const root = document.documentElement;
  if (root.dataset.valuationSaveFinal === '1') return;

  const STORE_KEY = 'dollar-to-lira:v1';
  const SWAP_MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  let installedSaveWrapper = null;
  let installedDerivedWrapper = null;
  let installedCalendarWrapper = null;

  const isHiroseMode = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(SWAP_MODE_KEY) === 'hirose';

  const capture = (prefix) => {
    const date = document.getElementById(`${prefix}Date`)?.value || '';
    const input = document.getElementById(`${prefix}ValuationTryJpy`);
    const value = Number(input?.value);
    return {
      prefix,
      date,
      manual: input?.dataset.conversionSource === 'manual' && Number.isFinite(value) && value > 0,
      value
    };
  };

  const savedRowFor = (date) => Array.isArray(state?.daily)
    ? state.daily.find((row) => row?.date === date) || null
    : null;

  const syntheticFor = (row) => {
    const rate = Number(row?.rate);
    const usdJpy = Number(row?.usdJpy);
    return rate > 0 && usdJpy > 0 ? usdJpy / rate : 0;
  };

  const restoreSavedForm = (prefix, date) => {
    if (!prefix || !date) return;
    const saved = savedRowFor(date);
    if (!saved) return;

    const dateInput = document.getElementById(`${prefix}Date`);
    const rateInput = document.getElementById(`${prefix}Rate`);
    const usdJpyInput = document.getElementById(`${prefix}UsdJpy`);
    const conversionInput = document.getElementById(`${prefix}ValuationTryJpy`);
    if (dateInput) dateInput.value = date;
    if (rateInput && Number(saved.rate) > 0) rateInput.value = String(saved.rate);
    if (usdJpyInput && Number(saved.usdJpy) > 0) usdJpyInput.value = String(saved.usdJpy);

    if (conversionInput) {
      const explicit = Number(saved.valuationTryJpy);
      if (explicit > 0) {
        conversionInput.value = String(explicit);
        conversionInput.dataset.conversionSource = 'manual';
      } else {
        const synthetic = syntheticFor(saved);
        conversionInput.value = synthetic > 0 ? String(Number(synthetic.toFixed(6))) : '';
        conversionInput.dataset.conversionSource = 'synthetic';
      }
    }
  };

  const resetToSynthetic = (prefix) => {
    const dateInput = document.getElementById(`${prefix}Date`);
    const date = dateInput?.value || '';
    const input = document.getElementById(`${prefix}ValuationTryJpy`);
    if (!input || !date) return;

    let rate = Number(document.getElementById(`${prefix}Rate`)?.value);
    let usdJpy = Number(document.getElementById(`${prefix}UsdJpy`)?.value);
    const saved = savedRowFor(date);
    if (!(rate > 0)) rate = Number(saved?.rate);
    if (!(usdJpy > 0)) usdJpy = Number(saved?.usdJpy);

    if (!(rate > 0) || !(usdJpy > 0)) {
      try {
        const published = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
          ? window.__DTL_HIROSE_RATE_AT__(date)
          : null;
        if (!(rate > 0)) rate = Number(published?.usdTryAskClose23);
        if (!(usdJpy > 0)) usdJpy = Number(published?.usdJpyAskClose23);
      } catch (_) {}
    }

    if (rate > 0 && usdJpy > 0) {
      input.value = String(Number((usdJpy / rate).toFixed(6)));
      input.dataset.conversionSource = 'synthetic';
    }
  };

  const bindSyntheticResetGuards = () => {
    document.querySelectorAll('[data-synthetic-conversion]').forEach((button) => {
      if (button.dataset.valuationSaveFinalBound) return;
      button.dataset.valuationSaveFinalBound = '1';
      const prefix = button.dataset.syntheticConversion;
      button.addEventListener('click', () => resetToSynthetic(prefix));
    });
  };

  const applyCalendarSwapBadges = () => {
    if (typeof derivedDaily !== 'function') return;
    const rows = new Map((derivedDaily() || []).map((row) => [row.date, row]));
    document.querySelectorAll('.calendar-day[data-date]').forEach((cell) => {
      const days = Number(rows.get(cell.dataset.date)?.swapSourceDays || 0);
      const existing = cell.querySelector('.swap-days-calendar');
      if (!(days > 1)) {
        existing?.remove();
        return;
      }
      if (existing) {
        existing.textContent = `S×${days}`;
        return;
      }
      const badge = document.createElement('span');
      badge.className = 'swap-days-calendar';
      badge.textContent = `S×${days}`;
      cell.appendChild(badge);
    });
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
      const synthetic = syntheticFor(row);
      if (synthetic > 0) row.tryJpy = synthetic;
    }

    state.updatedAt = new Date(Date.now() + 1).toISOString();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    try { renderAll(); } catch (_) {}
    try { applyCalendarSwapBadges(); } catch (_) {}
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

  const sameDaySwapFields = (date) => {
    if (!isHiroseMode() || typeof window.__DTL_HIROSE_SWAP_RESOLUTION__ !== 'function') return null;
    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__(date);
    if (!resolution) return null;
    const row = resolution.row || {};
    if (resolution.status === 'official') {
      return {
        swapPerLot: Number(resolution.shortPerLot || 0),
        swapLongPerLot: Number(resolution.longPerLot || 0),
        swapSource: 'hirose',
        swapPending: false,
        swapSourceDate: date,
        swapCreditDate: date,
        swapSourceDays: Number(row.days || 0),
        swapSourceUnit: Number(row.unit || 1000),
        swapSourceSellJpy: Number(row.sellJpy || 0),
        swapSourceBuyJpy: Number(row.buyJpy || 0)
      };
    }
    return {
      swapPerLot: 0,
      swapLongPerLot: 0,
      swapSource: resolution.status === 'pending' ? 'hirose-pending' : 'hirose-zero',
      swapPending: resolution.status === 'pending',
      swapSourceDate: date,
      swapCreditDate: date,
      swapSourceDays: 0,
      swapSourceUnit: 1000,
      swapSourceSellJpy: 0,
      swapSourceBuyJpy: 0
    };
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
          ...(sameDaySwapFields(row.date) || {}),
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

  const installCalendarGuard = () => {
    if (typeof renderCalendar !== 'function' || renderCalendar === installedCalendarWrapper) return;
    const base = renderCalendar;
    const wrapper = function(...args) {
      const result = base.apply(this, args);
      applyCalendarSwapBadges();
      return result;
    };
    renderCalendar = wrapper;
    installedCalendarWrapper = wrapper;
  };

  const install = () => {
    installSaveGuard();
    installDerivedGuard();
    installCalendarGuard();
    bindSyntheticResetGuards();
  };

  // Capture the row before the base submit handler runs. The base handler clears the
  // rate and calls fillDailyForm() with today's date after save; restore the date the
  // user just saved so "合成値に戻す" still targets that same historical row.
  [['dailyForm', 'daily'], ['quickDailyForm', 'quickDaily']].forEach(([formId, prefix]) => {
    const form = document.getElementById(formId);
    if (!form || form.dataset.valuationSaveFinalBound) return;
    form.dataset.valuationSaveFinalBound = '1';
    form.addEventListener('submit', () => {
      const payload = capture(prefix);
      queueMicrotask(() => {
        persist(payload);
        restoreSavedForm(prefix, payload.date);
      });
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
