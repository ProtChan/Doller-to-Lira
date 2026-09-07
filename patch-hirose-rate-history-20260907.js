// Persist and apply Hirose LION FX 60m ASK 23:00 close history.
// Existing user-entered daily rows are never overwritten.
(() => {
  const FEED_URL = './data/hirose-ask-close-23.json';
  const IMPORT_THROUGH_KEY = 'dollar-to-lira:hirose-rate-imported-through:v1';
  const root = document.documentElement;
  let history = [];
  let historyByDate = new Map();

  const exactDaily = (date) => state.daily.find((row) => row?.date === date) || null;

  const sourceRate = (date) => historyByDate.get(date) || null;

  const setRateInputs = (prefix, date) => {
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!date || !rateInput || !usdJpyInput) return false;

    const saved = exactDaily(date);
    if (saved) {
      const savedRate = Number(saved.rate);
      const savedUsdJpy = usdJpyValueV2(saved);
      if (savedRate > 0) rateInput.value = String(savedRate);
      if (savedUsdJpy > 0) usdJpyInput.value = String(Number(savedUsdJpy.toFixed(3)));
      delete rateInput.dataset.hiroseAskClose23;
      delete usdJpyInput.dataset.hiroseAskClose23;
      return true;
    }

    const source = sourceRate(date);
    if (!source) {
      delete rateInput.dataset.hiroseAskClose23;
      delete usdJpyInput.dataset.hiroseAskClose23;
      return false;
    }

    rateInput.value = String(Number(source.usdTryAskClose23));
    usdJpyInput.value = String(Number(Number(source.usdJpyAskClose23).toFixed(3)));
    rateInput.dataset.hiroseAskClose23 = '1';
    usdJpyInput.dataset.hiroseAskClose23 = '1';
    return true;
  };

  const importMissingHistory = (historyEnd) => {
    if (!Array.isArray(state.daily) || !history.length) return 0;
    const importedThrough = localStorage.getItem(IMPORT_THROUGH_KEY) || '';
    const existing = new Set(state.daily.map((row) => row?.date).filter(Boolean));
    let added = 0;

    history.forEach((source) => {
      if (importedThrough && source.date <= importedThrough) return;
      if (existing.has(source.date)) return;
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
        rateSourceTimeframe: '60m',
        rateSourceBarTime: '23:00 JST'
      });
      existing.add(source.date);
      added += 1;
    });

    if (historyEnd) localStorage.setItem(IMPORT_THROUGH_KEY, historyEnd);
    if (added) {
      state.updatedAt = new Date().toISOString();
      localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
      calendarCursor = monthFromLatest();
      try { renderAll(); } catch (_) {}
    }
    return added;
  };

  const baseFillDailyFormRateHistory = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormRateHistory(prefix, date);
    setRateInputs(prefix, date);
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    const sync = () => setTimeout(() => setRateInputs(prefix, dateInput?.value), 0);
    dateInput?.addEventListener('input', sync);
    dateInput?.addEventListener('change', sync);
  });

  fetch(`${FEED_URL}?rates=${Date.now()}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      history = Array.isArray(data?.history)
        ? data.history
            .filter((row) => row?.date && Number(row.usdTryAskClose23) > 0 && Number(row.usdJpyAskClose23) > 0)
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
      if (!history.length) throw new Error('Hirose 23:00 ASK history is empty');
      historyByDate = new Map(history.map((row) => [row.date, row]));

      const start = history[0].date;
      const end = history[history.length - 1].date;
      const added = importMissingHistory(end);

      window.__DTL_HIROSE_RATE_HISTORY__ = () => history.map((row) => ({ ...row }));
      window.__DTL_HIROSE_RATE_AT__ = (date) => {
        const row = sourceRate(date);
        return row ? { ...row } : null;
      };

      root.dataset.hiroseRateHistoryReady = '1';
      root.dataset.hiroseRateHistoryStart = start;
      root.dataset.hiroseRateHistoryEnd = end;
      root.dataset.hiroseRateHistoryRecords = String(history.length);
      root.dataset.hiroseRateHistoryImported = String(added);

      setRateInputs('daily', $('dailyDate')?.value);
      setRateInputs('quickDaily', $('quickDailyDate')?.value);
    })
    .catch((error) => {
      root.dataset.hiroseRateHistoryReady = '0';
      root.dataset.hiroseRateHistoryError = error?.message || String(error);
      console.warn('Hirose 23:00 ASK history load failed', error);
    });
})();
