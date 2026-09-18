// Canonical provider-readonly derived/accounting backend.
// Daily Data persistence is owned by the provider sync layer; this core only derives
// portfolio state and caches it. No manual Daily Data save/mode branches live here.
(() => {
  const root = document.documentElement;
  if (root.dataset.backendCore === '1') return;

  let cache = null;

  const usdJpyFor = (row) => {
    const explicit = Number(row?.usdJpy);
    if (explicit > 0) return explicit;
    const rate = Number(row?.rate);
    const legacyTryJpy = Number(row?.tryJpy);
    return rate > 0 && legacyTryJpy > 0 ? rate * legacyTryJpy : 0;
  };
  const valuationFor = (row) => {
    const explicit = Number(row?.valuationTryJpy);
    if (explicit > 0 && row?.rateSource !== 'provider') return { value: explicit, source:'manual' };
    const rate = Number(row?.rate);
    const usdJpy = usdJpyFor(row);
    const synthetic = rate > 0 && usdJpy > 0 ? usdJpy / rate : Number(row?.tryJpy || state.settings.defaultTryJpy || 0);
    return { value: synthetic, source:'synthetic' };
  };
  const swapFields = (date) => {
    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__?.(date) || null;
    if (!resolution) return {};
    const broker = resolution.row || {};
    if (resolution.status === 'official') {
      return {
        swapPerLot:Number(resolution.shortPerLot || 0),
        swapLongPerLot:Number(resolution.longPerLot || 0),
        swapSource:'hirose', swapPending:false,
        swapSourceDate:resolution.sourceDate || '',
        swapCreditDate:resolution.creditDate || date,
        swapSourceDays:Number(broker.days || 0),
        swapSourceUnit:Number(broker.unit || 1000),
        swapSourceSellJpy:Number(broker.sellJpy || 0),
        swapSourceBuyJpy:Number(broker.buyJpy || 0)
      };
    }
    return {
      swapPerLot:0, swapLongPerLot:0,
      swapSource:resolution.status === 'pending' ? 'hirose-pending' : 'hirose-zero',
      swapPending:resolution.status === 'pending',
      swapSourceDate:resolution.sourceDate || '', swapCreditDate:resolution.creditDate || date,
      swapSourceDays:0, swapSourceUnit:1000, swapSourceSellJpy:0, swapSourceBuyJpy:0
    };
  };

  const signature = () => [
    state.updatedAt || '',
    state.positions.length,
    state.daily.length,
    Number(state.settings.capital || 0),
    Number(state.settings.unitsPerLot || 0),
    Number(state.settings.leverage || 0),
    Number(state.settings.lcThreshold || 0),
    root.dataset.hiroseHistoryEnd || '',
    root.dataset.hiroseHistoryRecords || '',
    root.dataset.hiroseRateHistoryEnd || '',
    root.dataset.hiroseMarginReady || '',
    root.dataset.hiroseMarginOfficialThrough || '',
    root.dataset.hiroseMarginRecords || '',
    root.dataset.liveRateRefreshEnd || '',
    root.dataset.capitalHistoryAccounting || ''
  ].join('|');

  const invalidate = () => { cache = null; };
  const build = () => {
    let previousFx = 0;
    let previousSwap = 0;
    let previousTotal = 0;
    return sortedDaily().map((saved) => {
      const rate = Number(saved.rate);
      const usdJpy = usdJpyFor(saved);
      const valuation = valuationFor(saved);
      const tryJpy = Number(valuation.value || 0);
      const fxPnl = rate > 0 && tryJpy > 0 ? portfolioFx(saved.date, rate, tryJpy) : 0;
      const swap = Number(portfolioSwap(saved.date) || 0);
      const total = fxPnl + swap;
      const dailySwap = typeof window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ === 'function'
        ? Number(window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__(saved.date) || 0)
        : swap - previousSwap;
      const marginInfo = typeof window.__DTL_MARGIN_RESOLUTION__ === 'function'
        ? window.__DTL_MARGIN_RESOLUTION__(saved.date, usdJpy)
        : {
            per1000:Number(window.__DTL_MARGIN_PER_1000__?.(usdJpy) || 0),
            source:'rate-estimate', status:'estimate', official:false,
            reference:'', referenceDate:'', basisUsdJpy:usdJpy
          };
      const row = {
        ...saved,
        ...swapFields(saved.date),
        rate, usdJpy, tryJpy,
        valuationTryJpy:valuation.source === 'manual' ? tryJpy : undefined,
        valuationTryJpySource:valuation.source,
        fxPnl,
        dailyFxPnl:fxPnl - previousFx,
        swap,
        dailySwap,
        total,
        dailyPnl:total - previousTotal,
        lots:grossLotsOn(saved.date),
        signedLots:signedLotsOn(saved.date),
        marginPer1000:Number(marginInfo?.per1000 || 0),
        marginSource:marginInfo?.source || 'rate-estimate',
        marginStatus:marginInfo?.status || 'estimate',
        marginOfficial:marginInfo?.official === true,
        marginReference:marginInfo?.reference || '',
        marginReferenceDate:marginInfo?.referenceDate || '',
        marginBasisUsdJpy:Number(marginInfo?.basisUsdJpy || 0) || undefined
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

  const canonicalDerived = function() {
    const key = signature();
    if (cache?.signature === key) {
      root.dataset.backendDerivedCacheHits = String(Number(root.dataset.backendDerivedCacheHits || 0) + 1);
      return cache.rows;
    }
    const started = performance.now();
    const rows = build();
    cache = { signature:key, rows };
    root.dataset.backendDerivedMs = (performance.now() - started).toFixed(1);
    root.dataset.backendDerivedComputations = String(Number(root.dataset.backendDerivedComputations || 0) + 1);
    return rows;
  };
  canonicalDerived.__dtlCanonicalBackend = true;
  derivedDaily = canonicalDerived;

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-hirose-rate-history-ready',
      'data-hirose-margin-ready',
      'data-hirose-margin-official-through',
      'data-hirose-margin-records',
      'data-live-rate-refresh-ready',
      'data-capital-history-accounting'
    ].includes(mutation.attributeName));
    if (!relevant) return;
    invalidate();
  });
  observer.observe(root, {
    attributes:true,
    attributeFilter:[
      'data-hirose-history-ready','data-hirose-feed-ready','data-hirose-rate-history-ready',
      'data-hirose-margin-ready','data-hirose-margin-official-through','data-hirose-margin-records',
      'data-live-rate-refresh-ready','data-capital-history-accounting'
    ]
  });

  window.__DTL_BACKEND_INVALIDATE__ = invalidate;
  window.__DTL_BACKEND_STATS__ = () => ({
    architecture:'provider-readonly-core',
    derivedComputations:Number(root.dataset.backendDerivedComputations || 0),
    derivedCacheHits:Number(root.dataset.backendDerivedCacheHits || 0),
    lastDerivedMs:Number(root.dataset.backendDerivedMs || 0)
  });

  root.dataset.backendCore = '1';
  root.dataset.backendCoreReady = '1';
  root.dataset.backendCoreVersion = '20260913-provider-core';
})();
