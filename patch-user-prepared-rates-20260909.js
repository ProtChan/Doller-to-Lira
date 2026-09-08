// Explicit user-prepared historical rate source.
(() => {
  const root = document.documentElement;
  if (root.dataset.userPreparedRates === '1') return;

  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  const FEED_URL = './data/user-prepared-rates.json?v=20260909-0303';
  let history = [];
  let historyByDate = new Map();

  const rawMode = () => localStorage.getItem(RATE_SOURCE_KEY) || 'auto';
  const rateAt = (date) => historyByDate.get(date) || null;

  const ensurePreparedOption = () => {
    const select = $('settingRateSource');
    if (!select) return;
    if (!select.querySelector('option[value="prepared"]')) {
      const option = document.createElement('option');
      option.value = 'prepared';
      option.textContent = 'こちらが用意したレート';
      const saved = select.querySelector('option[value="saved"]');
      if (saved) select.insertBefore(option, saved);
      else select.appendChild(option);
    }
    if (rawMode() === 'prepared') select.value = 'prepared';
    if (!select.dataset.preparedSourceBound) {
      select.dataset.preparedSourceBound = '1';
      select.addEventListener('change', (event) => {
        if (select.value !== 'prepared') return;
        event.stopImmediatePropagation();
        localStorage.setItem(RATE_SOURCE_KEY, 'prepared');
        root.dataset.rateSourceMode = 'prepared';
        applyPreparedTo('daily', $('dailyDate')?.value || isoToday());
        applyPreparedTo('quickDaily', $('quickDailyDate')?.value || isoToday());
        toast('こちらが用意した過去レートを使います');
      }, true);
    }
  };

  const noteFor = (prefix) => {
    const input = $(prefix + 'Rate');
    const label = input?.closest('label');
    if (!label) return null;
    let note = label.querySelector('.rate-source-note');
    if (!note) {
      note = document.createElement('small');
      note.className = 'rate-source-note';
      label.appendChild(note);
    }
    return note;
  };

  const applyPreparedTo = (prefix, date) => {
    if (rawMode() !== 'prepared') return false;
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!rateInput || !usdJpyInput || !date) return false;
    const note = noteFor(prefix);
    const row = rateAt(date);

    delete rateInput.dataset.rateSource;
    delete usdJpyInput.dataset.rateSource;

    if (!row) {
      rateInput.value = '';
      usdJpyInput.value = '';
      if (note) note.textContent = `${date} の用意済みレートなし · 手入力可`;
      return false;
    }

    rateInput.value = Number(row.usdTry).toFixed(4);
    usdJpyInput.value = Number(row.usdJpy).toFixed(3);
    rateInput.dataset.rateSource = 'prepared';
    usdJpyInput.dataset.rateSource = 'prepared';
    if (note) note.textContent = `${date} · 用意済みレート USD/TRY ${Number(row.usdTry).toFixed(4)} · USD/JPY ${Number(row.usdJpy).toFixed(3)}`;
    return true;
  };

  const baseFillDailyFormPrepared = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormPrepared(prefix, date);
    applyPreparedTo(prefix, date);
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    const sync = () => setTimeout(() => applyPreparedTo(prefix, dateInput?.value), 0);
    dateInput?.addEventListener('input', sync);
    dateInput?.addEventListener('change', sync);
  });

  ensurePreparedOption();
  const uiObserver = new MutationObserver(() => ensurePreparedOption());
  uiObserver.observe(root, { attributes: true, attributeFilter: ['data-hirose-rate-history-ready'] });

  fetch(FEED_URL, { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      history = Array.isArray(data?.history)
        ? data.history
            .filter((row) => row?.date && Number(row.usdTry) > 0 && Number(row.usdJpy) > 0)
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
      historyByDate = new Map(history.map((row) => [row.date, row]));
      window.__DTL_USER_PREPARED_RATE_HISTORY__ = () => history.map((row) => ({ ...row }));
      window.__DTL_USER_PREPARED_RATE_AT__ = (date) => {
        const row = rateAt(date);
        return row ? { ...row } : null;
      };
      root.dataset.userPreparedRateReady = '1';
      root.dataset.userPreparedRateRecords = String(history.length);
      root.dataset.userPreparedRateEnd = history.at(-1)?.date || '';
      ensurePreparedOption();
      applyPreparedTo('daily', $('dailyDate')?.value || isoToday());
      applyPreparedTo('quickDaily', $('quickDailyDate')?.value || isoToday());
    })
    .catch((error) => {
      root.dataset.userPreparedRateReady = '0';
      root.dataset.userPreparedRateError = error?.message || String(error);
      console.warn('user-prepared rate history load failed', error);
    });

  root.dataset.userPreparedRates = '1';
})();
