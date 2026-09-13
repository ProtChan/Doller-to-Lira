// Keep published Hirose ASK rates fresh in long-lived tabs/PWAs.
// The live no-store feed is authoritative for every published date, including
// historical corrections to dates that already exist in localStorage.
(() => {
  const root = document.documentElement;
  if (root.dataset.liveRateRefresh === '1') return;

  const FEED_URL = './data/hirose-ask-close-23.json';
  const STATE_KEY = 'dollar-to-lira:v1';
  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  const AUTO_REFRESH_MS = 2 * 60 * 1000;
  const LIFECYCLE_MIN_GAP_MS = 10000;
  let liveByDate = new Map();
  let refreshPromise = null;
  let lastRefreshAt = 0;
  let fallbackRateAt = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
    ? window.__DTL_HIROSE_RATE_AT__
    : null;
  let fallbackHistory = typeof window.__DTL_HIROSE_RATE_HISTORY__ === 'function'
    ? window.__DTL_HIROSE_RATE_HISTORY__
    : null;

  const isAuto = () => {
    const value = localStorage.getItem(RATE_SOURCE_KEY) || 'auto';
    return value !== 'saved' && value !== 'manual';
  };

  const liveRateAt = (date) => liveByDate.get(date) || null;
  const supplementalHighAt = (date) => {
    try {
      const row = typeof window.__DTL_ASK_DAY_HIGH_AT__ === 'function'
        ? window.__DTL_ASK_DAY_HIGH_AT__(date)
        : null;
      return Number(row?.usdTryAskDayHigh) > 0 ? row : null;
    } catch (_) {
      return null;
    }
  };
  const withSupplementalHigh = (row, date) => {
    if (!row) return null;
    const existingHigh = Number(row.usdTryAskDayHigh);
    if (existingHigh > 0) return { ...row, usdTryAskDayHigh: existingHigh };
    const extra = supplementalHighAt(date || row.date);
    if (!extra) return { ...row };
    return {
      ...row,
      usdTryAskDayHigh: Number(extra.usdTryAskDayHigh),
      usdTryAskDayHighSource: extra.source
        || extra.usdTryAskDayHighSource
        || (extra.sourceTimeframe === '4h' ? 'uploaded-hirose-4h-ask-csv' : 'uploaded-hirose-60m-ask-csv')
    };
  };

  function wrappedRateAt(date) {
    const live = liveRateAt(date);
    if (live) return withSupplementalHigh(live, date);
    try {
      const row = typeof fallbackRateAt === 'function' ? fallbackRateAt(date) : null;
      return row ? withSupplementalHigh(row, date) : null;
    } catch (_) {
      return null;
    }
  }

  function wrappedHistory() {
    const merged = new Map();
    try {
      const base = typeof fallbackHistory === 'function' ? fallbackHistory() : [];
      if (Array.isArray(base)) base.forEach((row) => { if (row?.date) merged.set(row.date, { ...row }); });
    } catch (_) {}
    liveByDate.forEach((row, date) => merged.set(date, withSupplementalHigh(row, date)));
    return [...merged.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  const installRateLookup = () => {
    const currentRateAt = window.__DTL_HIROSE_RATE_AT__;
    const currentHistory = window.__DTL_HIROSE_RATE_HISTORY__;
    if (typeof currentRateAt === 'function' && currentRateAt !== wrappedRateAt) fallbackRateAt = currentRateAt;
    if (typeof currentHistory === 'function' && currentHistory !== wrappedHistory) fallbackHistory = currentHistory;
    window.__DTL_HIROSE_RATE_AT__ = wrappedRateAt;
    window.__DTL_HIROSE_RATE_HISTORY__ = wrappedHistory;
  };

  const applyCurrentInputs = () => {
    if (!isAuto()) return;
    if (typeof window.__DTL_APPLY_SELECTED_RATE_SOURCE__ !== 'function') return;
    ['daily', 'quickDaily'].forEach((prefix) => {
      const date = document.getElementById(`${prefix}Date`)?.value;
      if (date) window.__DTL_APPLY_SELECTED_RATE_SOURCE__(prefix, date);
    });
  };

  const same = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-10;

  // Reconcile every published date, not only missing dates. This is the key rule
  // that makes owner corrections replace stale client-side snapshots without
  // clearing the user's positions/settings.
  const reconcilePublishedRows = () => {
    if (!Array.isArray(state?.daily) || !liveByDate.size) return { added: 0, updated: 0 };
    const byDate = new Map(state.daily.map((row) => [row?.date, row]).filter(([date]) => date));
    let added = 0;
    let updated = 0;

    [...liveByDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((rawSource) => {
      const source = withSupplementalHigh(rawSource, rawSource?.date) || rawSource;
      if (!source?.date) return;
      const rate = Number(source.usdTryAskClose23);
      const usdJpy = Number(source.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) return;

      const existing = byDate.get(source.date) || null;
      const next = {
        ...(existing || { date: source.date, swapPerLot: 0 }),
        date: source.date,
        rate,
        usdJpy,
        tryJpy: usdJpy / rate,
        valuationTryJpySource: 'synthetic',
        rateSource: 'provider',
        rateSourcePrice: 'ASK',
        rateSourceTimeframe: source.sourceTimeframe || '60m',
        rateSourceBarTime: source.sourceBarTime || '23:00 JST',
        rateSourcePublishedAt: source.publishedAt || undefined,
        ...(Number(source.usdTryAskDayHigh) > 0 ? {
          usdTryAskDayHigh: Number(source.usdTryAskDayHigh),
          usdTryAskDayHighSource: source.verification || source.usdTryAskDayHighSource || 'owner-published'
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
      state.daily = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      state.updatedAt = new Date().toISOString();
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      try { calendarCursor = monthFromLatest(); } catch (_) {}
      try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
      try { window.__DTL_BACKEND_INVALIDATE__?.(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    }
    return { added, updated };
  };

  const publishRefreshState = (data, rows, result, reason) => {
    const finishedAt = new Date().toISOString();
    const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const publication = data?.lastManualPublication
      || sorted.map((row) => row?.publishedAt).filter(Boolean).sort().at(-1)
      || '';
    root.dataset.liveRateRefreshReady = '1';
    root.dataset.liveRateRefreshRecords = String(rows.length);
    root.dataset.liveRateRefreshEnd = sorted.at(-1)?.date || '';
    root.dataset.liveRateRefreshAdded = String(result.added || 0);
    root.dataset.liveRateRefreshUpdated = String(result.updated || 0);
    root.dataset.liveRateRefreshLastAt = finishedAt;
    root.dataset.liveRateRefreshPublication = publication;
    root.dataset.liveRateRefreshReason = reason || 'auto';
    root.dataset.liveRateRefreshGeneration = String(Number(root.dataset.liveRateRefreshGeneration || 0) + 1);
    delete root.dataset.liveRateRefreshError;
    window.dispatchEvent(new CustomEvent('dtl:provider-rates-refreshed', {
      detail: { ...result, records: rows.length, end: sorted.at(-1)?.date || '', publication, finishedAt, reason }
    }));
  };

  const refresh = ({ force = false, reason = 'auto' } = {}) => {
    const now = Date.now();
    if (!force && now - lastRefreshAt < 1500 && liveByDate.size) {
      installRateLookup();
      applyCurrentInputs();
      return Promise.resolve({ refreshed: false, records: liveByDate.size, added: 0, updated: 0 });
    }
    if (refreshPromise) return refreshPromise;

    root.dataset.liveRateRefreshPending = '1';
    refreshPromise = fetch(`${FEED_URL}?live=${now}`, { cache: 'no-store' })
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
        installRateLookup();
        const result = reconcilePublishedRows();
        try { window.__DTL_SYNC_PUBLISHED_DAILY__?.(); } catch (_) {}
        applyCurrentInputs();
        publishRefreshState(data, rows, result, reason);
        return { refreshed: true, records: rows.length, ...result };
      })
      .catch((error) => {
        root.dataset.liveRateRefreshReady = '0';
        root.dataset.liveRateRefreshError = error?.message || String(error);
        window.dispatchEvent(new CustomEvent('dtl:provider-rates-refresh-error', { detail: { message: error?.message || String(error), reason } }));
        console.warn('Hirose live rate refresh failed', error);
        throw error;
      })
      .finally(() => {
        delete root.dataset.liveRateRefreshPending;
        refreshPromise = null;
      });
    return refreshPromise;
  };

  const refreshForDateIfNeeded = (prefix) => {
    if (!isAuto()) return;
    const date = document.getElementById(`${prefix}Date`)?.value;
    if (!date) return;
    installRateLookup();
    const current = window.__DTL_HIROSE_RATE_AT__?.(date) || null;
    if (current) {
      applyCurrentInputs();
      return;
    }
    refresh({ force: true, reason: 'date-miss' }).catch(() => {});
  };

  const bind = () => {
    const select = document.getElementById('settingRateSource');
    if (select) select.dataset.liveRateRefreshBound = '1';

    ['daily', 'quickDaily'].forEach((prefix) => {
      const dateInput = document.getElementById(`${prefix}Date`);
      if (!dateInput || dateInput.dataset.liveRateRefreshBound) return;
      dateInput.dataset.liveRateRefreshBound = '1';
      const handler = () => setTimeout(() => refreshForDateIfNeeded(prefix), 0);
      dateInput.addEventListener('input', handler);
      dateInput.addEventListener('change', handler);
    });
  };

  const lifecycleRefresh = (reason) => {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastRefreshAt < LIFECYCLE_MIN_GAP_MS && liveByDate.size) return;
    refresh({ force: true, reason }).catch(() => {});
  };

  const observer = new MutationObserver((mutations) => {
    installRateLookup();
    bind();
    const switchedToAuto = mutations.some((mutation) =>
      mutation.attributeName === 'data-rate-source-mode' && root.dataset.rateSourceMode === 'auto'
    );
    if (switchedToAuto) {
      refresh({ force: true, reason: 'mode-auto' }).catch(() => {});
      return;
    }
    if (root.dataset.hiroseRateHistoryReady === '1') applyCurrentInputs();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-hirose-rate-history-ready', 'data-rate-source-mode']
  });

  window.__DTL_REFRESH_HIROSE_RATES__ = (force = true) => refresh({ force: !!force, reason: 'manual-api' });
  window.__DTL_LIVE_HIROSE_RATE_AT__ = (date) => {
    const row = liveRateAt(date);
    return row ? withSupplementalHigh(row, date) : null;
  };

  window.addEventListener('pageshow', () => lifecycleRefresh('pageshow'));
  window.addEventListener('focus', () => lifecycleRefresh('focus'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lifecycleRefresh('visible');
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') refresh({ force: true, reason: 'interval' }).catch(() => {});
  }, AUTO_REFRESH_MS);

  installRateLookup();
  bind();
  root.dataset.liveRateRefresh = '1';
  root.dataset.liveRateRefreshPolicy = 'boot-focus-visible-2min-manual-full-reconcile';

  // Defer the first network reconciliation until after app bootstrap. app.js
  // registered its DOMContentLoaded handler earlier in the bundle, so this avoids
  // racing renderAll/fillDefaults while still refreshing immediately on startup.
  const bootRefresh = () => refresh({ force: true, reason: 'boot' }).catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootRefresh, { once:true });
  else setTimeout(bootRefresh, 0);
})();