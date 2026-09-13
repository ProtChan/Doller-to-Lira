// Read-only supplemental ASK-high feed. Reference-data rebuild and manual-rate
// preservation were retired when Daily Data became provider-owned.
(() => {
  const root = document.documentElement;
  if (root.dataset.askDayHighCore === '1') return;

  const FEED_URL = './data/hirose-ask-day-high.json';
  let highHistory = [];

  const combined = () => {
    const map = new Map(highHistory.map((row) => [row.date, { ...row }]));
    try {
      const rates = typeof window.__DTL_HIROSE_RATE_HISTORY__ === 'function' ? window.__DTL_HIROSE_RATE_HISTORY__() : [];
      if (Array.isArray(rates)) {
        rates.forEach((row) => {
          const high = Number(row?.usdTryAskDayHigh);
          if (!row?.date || !(high > 0)) return;
          map.set(row.date, {
            ...(map.get(row.date) || {}),
            date: row.date,
            usdTryAskDayHigh: high,
            sourceTimeframe: row.sourceTimeframe || map.get(row.date)?.sourceTimeframe || '60m',
            sourceBarTime: row.sourceBarTime || map.get(row.date)?.sourceBarTime || null,
            source: row.usdTryAskDayHighSource || row.verification || map.get(row.date)?.source || 'provider'
          });
        });
      }
    } catch (_) {}
    return [...map.values()].sort((a,b) => String(a.date).localeCompare(String(b.date)));
  };

  const publishApi = () => {
    window.__DTL_ASK_DAY_HIGH_HISTORY__ = () => combined().map((row) => ({ ...row }));
    window.__DTL_ASK_DAY_HIGH_AT__ = (date) => {
      const row = combined().find((item) => item.date === date) || null;
      return row ? { ...row } : null;
    };
    const rows = combined();
    root.dataset.askDayHighRecords = String(rows.length);
    root.dataset.askDayHighStart = rows[0]?.date || '';
    root.dataset.askDayHighEnd = rows.at(-1)?.date || '';
  };

  root.dataset.askDayHighCore = '1';
  fetch(`${FEED_URL}?high=${Date.now()}`, { cache:'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`ASK high HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      highHistory = Array.isArray(data?.history)
        ? data.history.filter((row) => row?.date && Number(row.usdTryAskDayHigh) > 0).sort((a,b) => String(a.date).localeCompare(String(b.date)))
        : [];
      publishApi();
      root.dataset.askDayHighReady = '1';
      delete root.dataset.askDayHighError;
      try { renderRiskFacts(); } catch (_) {}
      if (activeTab === 'risk') requestAnimationFrame(() => { try { renderRiskCharts(); } catch (_) {} });
    })
    .catch((error) => {
      publishApi();
      root.dataset.askDayHighReady = '0';
      root.dataset.askDayHighError = error?.message || String(error);
      console.warn('ASK high feed load failed', error);
    });
})();
