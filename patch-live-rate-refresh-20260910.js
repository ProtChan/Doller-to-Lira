// Keep published Hirose ASK rates fresh in long-lived tabs/PWAs.
// The live no-store feed is authoritative for every published date, including
// historical corrections, date moves, and withdrawals of previously-published rows.
(() => {
  const root = document.documentElement;
  if (root.dataset.liveRateRefresh === '1') return;

  const FEED_URL = './data/hirose-ask-close-23.json';
  const STATE_KEY = 'dollar-to-lira:v1';
  const AUTO_REFRESH_MS = 2 * 60 * 1000;
  const LIFECYCLE_MIN_GAP_MS = 10000;
  let liveByDate = new Map();
  let refreshPromise = null;
  let lastRefreshAt = 0;
  let baseRateAt = null;

  const supplementalHighAt = (date) => {
    try {
      const row = window.__DTL_ASK_DAY_HIGH_AT__?.(date) || null;
      return Number(row?.usdTryAskDayHigh) > 0 ? row : null;
    } catch (_) {
      return null;
    }
  };

  const enrich = (row, date) => {
    if (!row) return null;
    if (Number(row.usdTryAskDayHigh) > 0) return { ...row };
    const extra = supplementalHighAt(date || row.date);
    return extra ? {
      ...row,
      usdTryAskDayHigh:Number(extra.usdTryAskDayHigh),
      usdTryAskDayHighSource:extra.source || extra.usdTryAskDayHighSource || 'supplemental-high-feed'
    } : { ...row };
  };

  const liveRateAt = (date) => {
    const row = liveByDate.get(date) || null;
    return row ? enrich(row, date) : null;
  };

  function authoritativeRateAt(date) {
    const live = liveRateAt(date);
    if (live) return live;
    try {
      const row = typeof baseRateAt === 'function' ? baseRateAt(date) : null;
      return row ? enrich(row, date) : null;
    } catch (_) {
      return null;
    }
  }

  // Install only after the ordinary historical-rate module has finished. This keeps
  // its bootstrap ownership intact while making all later lookups prefer live data.
  const installRateOverlay = () => {
    const current = window.__DTL_HIROSE_RATE_AT__;
    if (typeof current === 'function' && current !== authoritativeRateAt) baseRateAt = current;
    if (baseRateAt) window.__DTL_HIROSE_RATE_AT__ = authoritativeRateAt;
  };

  const same = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-10;

  const reconcilePublishedRows = () => {
    if (!Array.isArray(state?.daily) || !liveByDate.size) return { added:0, updated:0, removed:0 };
    const byDate = new Map(state.daily.map((row) => [row?.date, row]).filter(([date]) => date));
    const liveDates = new Set(liveByDate.keys());
    const liveEnd = [...liveDates].sort().at(-1) || '';
    let added = 0;
    let updated = 0;
    let removed = 0;

    // A publish correction may move a row to a different date. Remove the old local
    // provider row when it is no longer present in the authoritative live feed.
    // Historical CSV/backfill rows without publication metadata are preserved. The
    // extra hirose-ask-23close rule only removes a stale bootstrap row newer than the
    // current feed end, covering clients that closed before provider normalization.
    [...byDate.entries()].forEach(([date, row]) => {
      if (liveDates.has(date)) return;
      const withdrawnPublication = row?.rateSource === 'provider' && !!row?.rateSourcePublishedAt;
      const staleBootstrapTail = row?.rateSource === 'hirose-ask-23close' && liveEnd && date > liveEnd;
      if (!withdrawnPublication && !staleBootstrapTail) return;
      byDate.delete(date);
      updated += 1;
      removed += 1;
    });

    [...liveByDate.values()].sort((a,b) => String(a.date).localeCompare(String(b.date))).forEach((raw) => {
      const source = enrich(raw, raw?.date) || raw;
      if (!source?.date) return;
      const rate = Number(source.usdTryAskClose23);
      const usdJpy = Number(source.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) return;

      const existing = byDate.get(source.date) || null;
      const next = {
        ...(existing || { date:source.date, swapPerLot:0 }),
        date:source.date,
        rate,
        usdJpy,
        tryJpy:usdJpy / rate,
        valuationTryJpySource:'synthetic',
        rateSource:'provider',
        rateSourcePrice:'ASK',
        rateSourceTimeframe:source.sourceTimeframe || '60m',
        rateSourceBarTime:source.sourceBarTime || '23:00 JST',
        rateSourcePublishedAt:source.publishedAt || undefined,
        ...(Number(source.usdTryAskDayHigh) > 0 ? {
          usdTryAskDayHigh:Number(source.usdTryAskDayHigh),
          usdTryAskDayHighSource:source.verification || source.usdTryAskDayHighSource || 'owner-published'
        } : {})
      };
      delete next.valuationTryJpy;

      const differs = !existing
        || !same(existing.rate, next.rate)
        || !same(existing.usdJpy, next.usdJpy)
        || !same(existing.tryJpy, next.tryJpy)
        || Number(existing.valuationTryJpy) > 0
        || existing.valuationTryJpySource !== 'synthetic'
        || existing.rateSource !== 'provider'
        || existing.rateSourcePrice !== 'ASK'
        || existing.rateSourceTimeframe !== next.rateSourceTimeframe
        || existing.rateSourceBarTime !== next.rateSourceBarTime
        || String(existing.rateSourcePublishedAt || '') !== String(next.rateSourcePublishedAt || '')
        || (Number(next.usdTryAskDayHigh) > 0 && !same(existing.usdTryAskDayHigh, next.usdTryAskDayHigh));
      if (!differs) return;
      byDate.set(source.date, next);
      if (existing) updated += 1;
      else added += 1;
    });

    if (added || updated) {
      state.daily = [...byDate.values()].sort((a,b) => String(a.date).localeCompare(String(b.date)));
      state.updatedAt = new Date().toISOString();
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      try { calendarCursor = monthFromLatest(); } catch (_) {}
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { window.__DTL_BACKEND_INVALIDATE__?.(); } catch (_) {}
    }
    return { added, updated, removed };
  };

  const publishState = (data, rows, result, reason) => {
    const finishedAt = new Date().toISOString();
    const sorted = [...rows].sort((a,b) => String(a.date).localeCompare(String(b.date)));
    const publication = data?.lastManualPublication
      || sorted.map((row) => row?.publishedAt).filter(Boolean).sort().at(-1)
      || '';
    root.dataset.liveRateRefreshReady = '1';
    root.dataset.liveRateRefreshRecords = String(rows.length);
    root.dataset.liveRateRefreshEnd = sorted.at(-1)?.date || '';
    root.dataset.liveRateRefreshAdded = String(result.added || 0);
    root.dataset.liveRateRefreshUpdated = String(result.updated || 0);
    root.dataset.liveRateRefreshRemoved = String(result.removed || 0);
    root.dataset.liveRateRefreshLastAt = finishedAt;
    root.dataset.liveRateRefreshPublication = publication;
    root.dataset.liveRateRefreshReason = reason || 'auto';
    root.dataset.liveRateRefreshGeneration = String(Number(root.dataset.liveRateRefreshGeneration || 0) + 1);
    delete root.dataset.liveRateRefreshError;
    window.dispatchEvent(new CustomEvent('dtl:provider-rates-refreshed', {
      detail:{ ...result, records:rows.length, end:sorted.at(-1)?.date || '', publication, finishedAt, reason }
    }));
  };

  const refresh = ({ force=false, reason='auto' } = {}) => {
    const now = Date.now();
    if (!force && now - lastRefreshAt < 1500 && liveByDate.size) {
      installRateOverlay();
      return Promise.resolve({ refreshed:false, records:liveByDate.size, added:0, updated:0, removed:0 });
    }
    if (refreshPromise) return refreshPromise;

    root.dataset.liveRateRefreshPending = '1';
    refreshPromise = fetch(`${FEED_URL}?live=${now}`, { cache:'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Hirose live rate HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const rows = Array.isArray(data?.history)
          ? data.history.filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
          : [];
        liveByDate = new Map(rows.map((row) => [row.date, { ...row }]));
        lastRefreshAt = Date.now();
        installRateOverlay();
        const result = reconcilePublishedRows();
        try {
          if (typeof window.__DTL_SYNC_PUBLISHED_DAILY__ === 'function') window.__DTL_SYNC_PUBLISHED_DAILY__();
          else renderAll();
        } catch (_) {}
        publishState(data, rows, result, reason);
        return { refreshed:true, records:rows.length, ...result };
      })
      .catch((error) => {
        root.dataset.liveRateRefreshReady = '0';
        root.dataset.liveRateRefreshError = error?.message || String(error);
        window.dispatchEvent(new CustomEvent('dtl:provider-rates-refresh-error', {
          detail:{ message:error?.message || String(error), reason }
        }));
        console.warn('Hirose live rate refresh failed', error);
        throw error;
      })
      .finally(() => {
        delete root.dataset.liveRateRefreshPending;
        refreshPromise = null;
      });
    return refreshPromise;
  };

  // A user's explicit refresh must always perform a new network read. If an automatic
  // lifecycle/interval refresh is already in flight, wait for it to settle and then
  // issue one additional no-store request rather than merely sharing that promise.
  const manualRefresh = async () => {
    const inFlight = refreshPromise;
    if (inFlight) {
      try { await inFlight; } catch (_) {}
    }
    return refresh({ force:true, reason:'manual-api' });
  };

  const lifecycleRefresh = (reason) => {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastRefreshAt < LIFECYCLE_MIN_GAP_MS && liveByDate.size) return;
    refresh({ force:true, reason }).catch(() => {});
  };

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.attributeName === 'data-hirose-rate-history-ready')) return;
    if (root.dataset.hiroseRateHistoryReady === '1') installRateOverlay();
  });
  observer.observe(root, { attributes:true, attributeFilter:['data-hirose-rate-history-ready'] });

  window.__DTL_REFRESH_HIROSE_RATES__ = () => manualRefresh();
  window.__DTL_LIVE_HIROSE_RATE_AT__ = (date) => liveRateAt(date);
  window.__DTL_LIVE_HIROSE_RATE_HISTORY__ = () => [...liveByDate.values()].map((row) => enrich(row, row.date));

  window.addEventListener('pageshow', () => lifecycleRefresh('pageshow'));
  window.addEventListener('focus', () => lifecycleRefresh('focus'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lifecycleRefresh('visible');
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') refresh({ force:true, reason:'interval' }).catch(() => {});
  }, AUTO_REFRESH_MS);

  root.dataset.liveRateRefresh = '1';
  root.dataset.liveRateRefreshPolicy = 'boot-focus-visible-2min-manual-full-reconcile';

  const bootRefresh = () => {
    installRateOverlay();
    refresh({ force:true, reason:'boot' }).catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootRefresh, { once:true });
  else setTimeout(bootRefresh, 0);
})();