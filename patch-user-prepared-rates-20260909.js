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

  const applySelectedSource = (prefix, date) => {
    if (rawMode() === 'prepared') return applyPreparedTo(prefix, date);
    if (typeof window.__DTL_APPLY_RATE_SOURCE__ === 'function') {
      return window.__DTL_APPLY_RATE_SOURCE__(prefix, date);
    }
    return false;
  };

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
    const mode = rawMode();
    if (['auto', 'prepared', 'saved', 'hirose'].includes(mode)) select.value = mode;

    if (!select.dataset.preparedSourceBound) {
      select.dataset.preparedSourceBound = '1';
      // Own the selector in capture phase. The older selector patch does not know
      // about `prepared`, so handling all four modes here avoids stale mode state
      // when the user switches away from the prepared source.
      select.addEventListener('change', (event) => {
        event.stopImmediatePropagation();
        const next = ['auto', 'prepared', 'saved', 'hirose'].includes(select.value) ? select.value : 'auto';
        localStorage.setItem(RATE_SOURCE_KEY, next);
        root.dataset.rateSourceMode = next;
        applySelectedSource('daily', $('dailyDate')?.value || isoToday());
        applySelectedSource('quickDaily', $('quickDailyDate')?.value || isoToday());
        const labels = {
          auto: '保存済み過去レート優先に切り替えました',
          prepared: 'こちらが用意した過去レートを使います',
          saved: '過去の保存済みレートを使います',
          hirose: 'ヒロセ23:00 ASKレートを使います'
        };
        toast(labels[next]);
      }, true);
    }
  };

  const baseFillDailyFormPrepared = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormPrepared(prefix, date);
    applySelectedSource(prefix, date);
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    const sync = () => setTimeout(() => applySelectedSource(prefix, dateInput?.value), 0);
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
      applySelectedSource('daily', $('dailyDate')?.value || isoToday());
      applySelectedSource('quickDaily', $('quickDailyDate')?.value || isoToday());
    })
    .catch((error) => {
      root.dataset.userPreparedRateReady = '0';
      root.dataset.userPreparedRateError = error?.message || String(error);
      console.warn('user-prepared rate history load failed', error);
    });

  root.dataset.userPreparedRates = '1';
})();
