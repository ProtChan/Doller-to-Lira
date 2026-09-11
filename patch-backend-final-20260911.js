// Canonical final accounting/persistence backend.
// Everything above this file is treated as a compatibility/data/UI provider. This
// layer owns the two hot-path functions (saveDailyFrom and derivedDaily) so runtime
// behavior no longer depends on a chain of historical wrappers.
(() => {
  const root = document.documentElement;
  if (root.dataset.backendCore === '1') return;

  const STORE_KEY = 'dollar-to-lira:v1';
  const SWAP_MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const RATE_MODE_KEY = 'dollar-to-lira:rate-source:v1';
  let cache = null;
  let canonicalSave = null;
  let canonicalDerived = null;
  let installTimer = null;

  const isHirose = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(SWAP_MODE_KEY) === 'hirose';
  const isManualRate = () => {
    const stored = localStorage.getItem(RATE_MODE_KEY) || 'auto';
    return root.dataset.rateSourceMode === 'manual' || stored === 'manual' || stored === 'saved';
  };
  const exactDaily = (date) => state.daily.find((row) => row?.date === date) || null;
  const valuationFor = (row) => {
    const explicit = Number(row?.valuationTryJpy);
    if (explicit > 0) return { value: explicit, source: 'manual' };
    const rate = Number(row?.rate);
    const usdJpy = typeof usdJpyValueV2 === 'function' ? Number(usdJpyValueV2(row)) : Number(row?.usdJpy);
    const fallback = rate > 0 && usdJpy > 0 ? usdJpy / rate : Number(row?.tryJpy || state.settings.defaultTryJpy || 0);
    return { value: fallback, source: 'synthetic' };
  };
  const swapFields = (date) => {
    if (!isHirose() || typeof window.__DTL_HIROSE_SWAP_RESOLUTION__ !== 'function') return null;
    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__(date);
    if (!resolution) return null;
    const broker = resolution.row || {};
    if (resolution.status === 'official') {
      return {
        swapPerLot: Number(resolution.shortPerLot || 0),
        swapLongPerLot: Number(resolution.longPerLot || 0),
        swapSource: 'hirose',
        swapPending: false,
        swapSourceDate: resolution.sourceDate || '',
        swapCreditDate: resolution.creditDate || resolution.displayDate || date,
        swapSourceDays: Number(broker.days || 0),
        swapSourceUnit: Number(broker.unit || 1000),
        swapSourceSellJpy: Number(broker.sellJpy || 0),
        swapSourceBuyJpy: Number(broker.buyJpy || 0)
      };
    }
    return {
      swapPerLot: 0,
      swapLongPerLot: 0,
      swapSource: resolution.status === 'pending' ? 'hirose-pending' : 'hirose-zero',
      swapPending: resolution.status === 'pending',
      swapSourceDate: resolution.sourceDate || '',
      swapCreditDate: resolution.creditDate || resolution.displayDate || date,
      swapSourceDays: 0,
      swapSourceUnit: 1000,
      swapSourceSellJpy: 0,
      swapSourceBuyJpy: 0
    };
  };

  const clearManualRateMetadata = (row) => {
    row.rateSource = 'manual';
    delete row.rateSourcePrice;
    delete row.rateSourceTimeframe;
    delete row.rateSourceBarTime;
    delete row.usdTryAskDayHigh;
    delete row.usdTryAskDayHighSource;
  };
  const clearManualSwapMetadata = (row) => {
    row.swapSource = 'manual';
    row.swapPending = false;
    delete row.swapLongPerLot;
    delete row.swapSourceDate;
    delete row.swapCreditDate;
    delete row.swapSourceDays;
    delete row.swapSourceUnit;
    delete row.swapSourceSellJpy;
    delete row.swapSourceBuyJpy;
  };

  const stateSignature = () => [
    state.updatedAt || '',
    state.positions.length,
    state.daily.length,
    Number(state.settings.capital || 0),
    Number(state.settings.unitsPerLot || 0),
    Number(state.settings.leverage || 0),
    Number(state.settings.lcThreshold || 0),
    localStorage.getItem(SWAP_MODE_KEY) || 'manual',
    root.dataset.hiroseHistoryEnd || '',
    root.dataset.hiroseHistoryRecords || '',
    root.dataset.referenceDataRebuiltAt || ''
  ].join('|');
  const invalidate = () => { cache = null; };

  const buildDerived = () => {
    let previousFx = 0;
    let previousSwap = 0;
    let previousTotal = 0;
    return sortedDaily().map((saved) => {
      const rate = Number(saved.rate);
      const usdJpy = typeof usdJpyValueV2 === 'function' ? Number(usdJpyValueV2(saved)) : Number(saved.usdJpy);
      const valuation = valuationFor(saved);
      const tryJpy = Number(valuation.value || 0);
      const fxPnl = rate > 0 && tryJpy > 0 ? portfolioFx(saved.date, rate, tryJpy) : 0;
      const swap = Number(portfolioSwap(saved.date) || 0);
      const total = fxPnl + swap;
      const sourceFields = swapFields(saved.date);
      let dailySwap = swap - previousSwap;
      if (isHirose() && typeof window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ === 'function') {
        dailySwap = Number(window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__(saved.date) || 0);
      }
      const row = {
        ...saved,
        ...(sourceFields || {}),
        rate,
        usdJpy,
        tryJpy,
        valuationTryJpy: valuation.source === 'manual' ? tryJpy : undefined,
        valuationTryJpySource: valuation.source,
        fxPnl,
        dailyFxPnl: fxPnl - previousFx,
        swap,
        dailySwap,
        total,
        dailyPnl: total - previousTotal,
        lots: grossLotsOn(saved.date),
        signedLots: signedLotsOn(saved.date),
        marginPer1000: typeof window.__DTL_MARGIN_PER_1000__ === 'function' ? window.__DTL_MARGIN_PER_1000__(usdJpy) : undefined
      };
      try { row.margin = marginRequired(saved.date, rate, tryJpy); } catch (_) { row.margin = 0; }
      try { row.maintenance = maintenance(saved.date, rate, tryJpy); } catch (_) { row.maintenance = Infinity; }
      try { row.lc = findLcRate(saved.date, rate, tryJpy, usdJpy); } catch (_) { row.lc = null; }
      previousFx = fxPnl;
      previousSwap = swap;
      previousTotal = total;
      return row;
    });
  };

  canonicalDerived = function() {
    const signature = stateSignature();
    if (cache?.signature === signature) {
      root.dataset.backendDerivedCacheHits = String(Number(root.dataset.backendDerivedCacheHits || 0) + 1);
      return cache.rows;
    }
    const started = performance.now();
    const rows = buildDerived();
    cache = { signature, rows };
    root.dataset.backendDerivedMs = (performance.now() - started).toFixed(1);
    root.dataset.backendDerivedComputations = String(Number(root.dataset.backendDerivedComputations || 0) + 1);
    return rows;
  };
  canonicalDerived.__dtlCanonicalBackend = true;

  canonicalSave = function(prefix) {
    const date = document.getElementById(`${prefix}Date`)?.value || '';
    const rateInput = document.getElementById(`${prefix}Rate`);
    const usdJpyInput = document.getElementById(`${prefix}UsdJpy`);
    const swapInput = document.getElementById(`${prefix}Swap`);
    const valuationInput = document.getElementById(`${prefix}ValuationTryJpy`);
    const rate = Number(rateInput?.value);
    const usdJpy = Number(usdJpyInput?.value);
    if (!date || !(rate > 0) || !(usdJpy > 0)) {
      toast('日付・USD/TRY・USD/JPYを入力してください');
      return false;
    }

    const prior = exactDaily(date);
    const row = prior ? { ...prior } : { date };
    row.date = date;
    row.rate = rate;
    row.usdJpy = usdJpy;

    if (isManualRate()) {
      clearManualRateMetadata(row);
    } else if (!row.rateSource && (rateInput?.dataset.hiroseAskClose23 === '1' || rateInput?.dataset.rateOrigin === 'hirose' || rateInput?.dataset.rateOrigin === 'hirose-supplied')) {
      row.rateSource = 'hirose-ask-23close';
      row.rateSourcePrice = 'ASK';
    }

    if (isHirose()) {
      Object.assign(row, swapFields(date) || { swapPerLot: 0, swapSource: 'hirose-zero', swapPending: false });
    } else {
      const raw = swapInput?.value;
      const swapPerLot = raw === '' || raw == null ? Number(state.settings.defaultSwap || 0) : Number(raw);
      if (!Number.isFinite(swapPerLot)) {
        toast('Swap / lot を確認してください');
        return false;
      }
      row.swapPerLot = swapPerLot;
      clearManualSwapMetadata(row);
    }

    const conversion = Number(valuationInput?.value);
    const manualConversion = valuationInput?.dataset.conversionSource === 'manual' && conversion > 0;
    if (manualConversion) {
      row.valuationTryJpy = conversion;
      row.valuationTryJpySource = 'manual';
      row.tryJpy = conversion;
    } else {
      delete row.valuationTryJpy;
      row.valuationTryJpySource = 'synthetic';
      row.tryJpy = usdJpy / rate;
    }

    const index = state.daily.findIndex((item) => item?.date === date);
    if (index >= 0) state.daily[index] = row;
    else state.daily.push(row);
    state.daily.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    calendarCursor = monthFromLatest();
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    invalidate();
    try { renderAll(); } catch (error) { console.error('canonical render failed', error); }
    toast(index >= 0 ? '日次データを更新しました' : '日次データを保存しました');
    return true;
  };
  canonicalSave.__dtlCanonicalBackend = true;

  const install = () => {
    let changed = false;
    if (saveDailyFrom !== canonicalSave) { saveDailyFrom = canonicalSave; changed = true; }
    if (derivedDaily !== canonicalDerived) { derivedDaily = canonicalDerived; changed = true; }
    if (changed) invalidate();
    root.dataset.backendCoreReady = '1';
  };

  const scheduleInstall = () => {
    clearTimeout(installTimer);
    installTimer = setTimeout(install, 0);
  };
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready',
      'data-reference-data-rebuilt-at',
      'data-capital-history-accounting'
    ].includes(mutation.attributeName))) return;
    invalidate();
    scheduleInstall();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready',
      'data-reference-data-rebuilt-at',
      'data-capital-history-accounting'
    ]
  });

  window.__DTL_BACKEND_INVALIDATE__ = invalidate;
  window.__DTL_BACKEND_STATS__ = () => ({
    architecture: 'canonical-final-core',
    derivedComputations: Number(root.dataset.backendDerivedComputations || 0),
    derivedCacheHits: Number(root.dataset.backendDerivedCacheHits || 0),
    lastDerivedMs: Number(root.dataset.backendDerivedMs || 0)
  });

  install();
  root.dataset.backendCore = '1';
  root.dataset.backendCoreVersion = '20260911-1422';
})();
