// Unified historical rate source: user-supplied Hirose 23:00 ASK rows and fetched Hirose rows
// are the same logical source. The UI intentionally exposes only Auto / Manual.
(() => {
  const root = document.documentElement;
  if (root.dataset.userPreparedRates === '1') return;

  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  const FEED_URL = './data/user-prepared-rates.json?v=20260909-0303';
  let history = [];
  let historyByDate = new Map();

  // Keep `saved` as the persisted compatibility value for manual mode because the
  // older rate-source layer understands it and therefore does not race manual input.
  const uiMode = () => {
    const value = localStorage.getItem(RATE_SOURCE_KEY) || 'auto';
    return value === 'saved' || value === 'manual' ? 'manual' : 'auto';
  };
  const persistMode = (mode) => {
    const next = mode === 'manual' ? 'manual' : 'auto';
    localStorage.setItem(RATE_SOURCE_KEY, next === 'manual' ? 'saved' : 'auto');
    root.dataset.rateSourceMode = next;
    return next;
  };

  const rateAt = (date) => historyByDate.get(date) || null;
  const exactDaily = (date) => state.daily.find((row) => row?.date === date) || null;

  const savedRateAt = (date) => {
    const row = exactDaily(date);
    if (!row || row.rateSource === 'hirose-ask-23close') return null;
    const rate = Number(row.rate);
    const usdJpy = usdJpyValueV2(row);
    if (!(rate > 0) || !(usdJpy > 0)) return null;
    return { date, rate, usdJpy, origin: 'saved', row };
  };

  const hiroseRateAt = (date) => {
    try {
      const row = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
        ? window.__DTL_HIROSE_RATE_AT__(date)
        : null;
      const rate = Number(row?.usdTryAskClose23);
      const usdJpy = Number(row?.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) return null;
      return { date, rate, usdJpy, origin: 'hirose', row };
    } catch (_) {
      return null;
    }
  };

  const suppliedHiroseRateAt = (date) => {
    const row = rateAt(date);
    const rate = Number(row?.usdTry);
    const usdJpy = Number(row?.usdJpy);
    if (!(rate > 0) || !(usdJpy > 0)) return null;
    return { date, rate, usdJpy, origin: 'hirose-supplied', row };
  };

  const automaticRateAt = (date) =>
    // Supplied rows extend/correct the same Hirose 23:00 ASK history, so prefer
    // them when both sources contain the same date.
    suppliedHiroseRateAt(date) || hiroseRateAt(date) || savedRateAt(date);

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

  const clearSourceMarkers = (rateInput, usdJpyInput) => {
    delete rateInput.dataset.rateSource;
    delete usdJpyInput.dataset.rateSource;
    delete rateInput.dataset.rateOrigin;
    delete usdJpyInput.dataset.rateOrigin;
    delete rateInput.dataset.hiroseAskClose23;
    delete usdJpyInput.dataset.hiroseAskClose23;
  };

  const applySelectedSource = (prefix, date) => {
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!rateInput || !usdJpyInput || !date) return false;

    const mode = uiMode();
    const note = noteFor(prefix);
    const source = mode === 'manual' ? savedRateAt(date) : automaticRateAt(date);
    clearSourceMarkers(rateInput, usdJpyInput);

    if (!source) {
      // Never carry another date's quote into the selected day.
      rateInput.value = '';
      usdJpyInput.value = '';
      if (note) {
        note.textContent = mode === 'manual'
          ? '手入力 · USD/TRY と USD/JPY を入力'
          : `${date} のヒロセ23:00 ASKレート未登録 · 手入力可`;
      }
      return false;
    }

    rateInput.value = Number(source.rate).toFixed(4);
    usdJpyInput.value = Number(source.usdJpy).toFixed(3);
    rateInput.dataset.rateSource = mode;
    usdJpyInput.dataset.rateSource = mode;
    rateInput.dataset.rateOrigin = source.origin;
    usdJpyInput.dataset.rateOrigin = source.origin;

    if (mode === 'auto' && source.origin !== 'saved') {
      // User-supplied rows and fetched historical rows are both Hirose 23:00 ASK.
      rateInput.dataset.hiroseAskClose23 = '1';
      usdJpyInput.dataset.hiroseAskClose23 = '1';
    }

    if (note) {
      if (mode === 'manual') {
        note.textContent = `${date} · 手入力で保存済み`;
      } else if (source.origin === 'saved') {
        note.textContent = `${date} · 自動データ未登録のため保存済みレートを使用`;
      } else {
        note.textContent = `${date} · 自動 · ヒロセ 60分足 23:00 ASK終値`;
      }
    }
    return true;
  };

  const ensureSimpleRateUi = () => {
    const select = $('settingRateSource');
    if (!select) return;

    const label = select.closest('label');
    const title = label?.querySelector('span');
    if (title) title.innerHTML = 'レート入力 <em>方式</em>';
    const status = $('rateSourceStatus');
    if (status) status.textContent = '自動＝ヒロセ23:00 ASK / 手入力＝自分で入力';

    const desired = [
      ['auto', '自動'],
      ['manual', '手入力']
    ];
    const current = [...select.options].map((o) => [o.value, o.textContent]);
    if (JSON.stringify(current) !== JSON.stringify(desired)) {
      select.replaceChildren(...desired.map(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        return option;
      }));
    }
    select.value = uiMode();

    if (!select.dataset.simpleRateSourceBound) {
      select.dataset.simpleRateSourceBound = '1';
      select.addEventListener('change', (event) => {
        // The older three-way selector handler is still present underneath this
        // compatibility patch; own the event before it can reinterpret `manual`.
        event.stopImmediatePropagation();
        const next = persistMode(select.value);
        applySelectedSource('daily', $('dailyDate')?.value || isoToday());
        applySelectedSource('quickDaily', $('quickDailyDate')?.value || isoToday());
        toast(next === 'manual' ? 'レートを手入力に切り替えました' : 'レートを自動入力に切り替えました');
      }, true);
    }
  };

  // Migrate old explicit modes. `saved` maps naturally to Manual; old prepared
  // and Hirose modes both become Auto because they are the same Hirose quote source.
  persistMode(uiMode());

  const baseFillDailyFormUnified = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormUnified(prefix, date);
    applySelectedSource(prefix, date);
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    const sync = () => setTimeout(() => applySelectedSource(prefix, dateInput?.value), 0);
    dateInput?.addEventListener('input', sync);
    dateInput?.addEventListener('change', sync);
  });

  ensureSimpleRateUi();
  const uiObserver = new MutationObserver(() => ensureSimpleRateUi());
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

      // Keep compatibility helpers, but expose the unified meaning as well.
      window.__DTL_USER_PREPARED_RATE_HISTORY__ = () => history.map((row) => ({ ...row }));
      window.__DTL_USER_PREPARED_RATE_AT__ = (date) => {
        const row = rateAt(date);
        return row ? { ...row } : null;
      };
      window.__DTL_AUTO_RATE_AT__ = (date) => {
        const row = automaticRateAt(date);
        return row ? { date: row.date, rate: row.rate, usdJpy: row.usdJpy, origin: row.origin } : null;
      };
      window.__DTL_APPLY_SELECTED_RATE_SOURCE__ = (prefix, date) => applySelectedSource(prefix, date);

      root.dataset.userPreparedRateReady = '1';
      root.dataset.userPreparedRateRecords = String(history.length);
      root.dataset.userPreparedRateEnd = history.at(-1)?.date || '';
      root.dataset.rateSourceSimplified = '1';
      ensureSimpleRateUi();
      applySelectedSource('daily', $('dailyDate')?.value || isoToday());
      applySelectedSource('quickDaily', $('quickDailyDate')?.value || isoToday());
    })
    .catch((error) => {
      root.dataset.userPreparedRateReady = '0';
      root.dataset.userPreparedRateError = error?.message || String(error);
      root.dataset.rateSourceSimplified = '1';
      ensureSimpleRateUi();
      console.warn('unified Hirose rate history load failed', error);
    });

  root.dataset.rateSourceMode = uiMode();
  root.dataset.rateSourceSimplified = '1';
  root.dataset.userPreparedRates = '1';
})();
