// Refresh newly-published Hirose ASK rates without requiring a full page reload.
// This layers a live no-store feed on top of the historical in-memory rate map.
(() => {
  const root = document.documentElement;
  if (root.dataset.liveRateRefresh === '1') return;

  const FEED_URL = './data/hirose-ask-close-23.json';
  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  let liveByDate = new Map();
  let refreshPromise = null;
  let lastRefreshAt = 0;

  const isAuto = () => {
    const value = localStorage.getItem(RATE_SOURCE_KEY) || 'auto';
    return value !== 'saved' && value !== 'manual';
  };

  const originalRateAt = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
    ? window.__DTL_HIROSE_RATE_AT__
    : null;

  const liveRateAt = (date) => liveByDate.get(date) || null;

  const installRateLookup = () => {
    const fallback = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
      && window.__DTL_HIROSE_RATE_AT__ !== wrappedRateAt
      ? window.__DTL_HIROSE_RATE_AT__
      : originalRateAt;
    if (fallback && fallback !== wrappedRateAt) wrappedRateAt._fallback = fallback;
    window.__DTL_HIROSE_RATE_AT__ = wrappedRateAt;
  };

  function wrappedRateAt(date) {
    const live = liveRateAt(date);
    if (live) return { ...live };
    const fallback = wrappedRateAt._fallback;
    try {
      const row = typeof fallback === 'function' ? fallback(date) : null;
      return row ? { ...row } : null;
    } catch (_) {
      return null;
    }
  }

  const applyCurrentInputs = () => {
    if (!isAuto()) return;
    if (typeof window.__DTL_APPLY_SELECTED_RATE_SOURCE__ !== 'function') return;
    ['daily', 'quickDaily'].forEach((prefix) => {
      const date = document.getElementById(`${prefix}Date`)?.value;
      if (date) window.__DTL_APPLY_SELECTED_RATE_SOURCE__(prefix, date);
    });
  };

  const importMissingPublishedRows = () => {
    if (!Array.isArray(state?.daily) || !liveByDate.size) return 0;
    const existing = new Set(state.daily.map((row) => row?.date).filter(Boolean));
    let added = 0;
    [...liveByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).forEach((source) => {
      if (!source?.date || existing.has(source.date)) return;
      const rate = Number(source.usdTryAskClose23);
      const usdJpy = Number(source.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) return;
      state.daily.push({
        date: source.date,
        rate,
        usdJpy,
        tryJpy: usdJpy / rate,
        swapPerLot: 0,
        rateSource: 'hirose-ask-23close',
        rateSourcePrice: 'ASK',
        rateSourceTimeframe: source.sourceTimeframe || '60m',
        rateSourceBarTime: source.sourceBarTime || '23:00 JST',
        ...(Number(source.usdTryAskDayHigh) > 0 ? {
          usdTryAskDayHigh: Number(source.usdTryAskDayHigh),
          usdTryAskDayHighSource: source.verification || source.usdTryAskDayHighSource || 'owner-published'
        } : {})
      });
      existing.add(source.date);
      added += 1;
    });
    if (added) {
      state.daily.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      state.updatedAt = new Date().toISOString();
      localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
      try { calendarCursor = monthFromLatest(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    }
    return added;
  };

  const refresh = ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && now - lastRefreshAt < 1500 && liveByDate.size) {
      installRateLookup();
      applyCurrentInputs();
      return Promise.resolve({ refreshed: false, records: liveByDate.size });
    }
    if (refreshPromise) return refreshPromise;

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
        const added = importMissingPublishedRows();
        root.dataset.liveRateRefreshReady = '1';
        root.dataset.liveRateRefreshRecords = String(rows.length);
        root.dataset.liveRateRefreshEnd = [...rows].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date || '';
        root.dataset.liveRateRefreshImported = String(added);
        delete root.dataset.liveRateRefreshError;
        applyCurrentInputs();
        return { refreshed: true, records: rows.length, added };
      })
      .catch((error) => {
        root.dataset.liveRateRefreshReady = '0';
        root.dataset.liveRateRefreshError = error?.message || String(error);
        console.warn('Hirose live rate refresh failed', error);
        throw error;
      })
      .finally(() => { refreshPromise = null; });
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
    refresh({ force: true }).catch(() => {});
  };

  const bind = () => {
    // The simplified source selector uses a capture listener with
    // stopImmediatePropagation. Its persistMode() writes data-rate-source-mode,
    // so the MutationObserver below is the reliable trigger for Auto refresh.
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

  const observer = new MutationObserver((mutations) => {
    installRateLookup();
    bind();
    const switchedToAuto = mutations.some((mutation) =>
      mutation.attributeName === 'data-rate-source-mode' && root.dataset.rateSourceMode === 'auto'
    );
    if (switchedToAuto) {
      refresh({ force: true }).catch(() => {});
      return;
    }
    if (root.dataset.hiroseRateHistoryReady === '1') applyCurrentInputs();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-hirose-rate-history-ready', 'data-user-prepared-rate-ready', 'data-rate-source-mode']
  });

  window.__DTL_REFRESH_HIROSE_RATES__ = (force = true) => refresh({ force: !!force });
  window.__DTL_LIVE_HIROSE_RATE_AT__ = (date) => {
    const row = liveRateAt(date);
    return row ? { ...row } : null;
  };

  installRateLookup();
  bind();
  root.dataset.liveRateRefresh = '1';
})();
