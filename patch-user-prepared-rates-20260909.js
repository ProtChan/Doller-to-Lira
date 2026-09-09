// Unified historical rate source: user-supplied Hirose 23:00 ASK rows and fetched Hirose rows
// are the same logical source. The UI intentionally exposes only Auto / Manual.
(() => {
  const root = document.documentElement;
  if (root.dataset.userPreparedRates === '1') return;

  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  const FEED_URL = './data/user-prepared-rates.json?v=20260909-0303';
  let history = [];
  let historyByDate = new Map();
  const inputOverrides = new Map();

  const uiMode = () => {
    const value = localStorage.getItem(RATE_SOURCE_KEY) || 'auto';
    return value === 'saved' || value === 'manual' ? 'manual' : 'auto';
  };
  const persistMode = (mode) => {
    const next = mode === 'manual' ? 'manual' : 'auto';
    // `saved` is kept internally for compatibility with the older source layer.
    localStorage.setItem(RATE_SOURCE_KEY, next === 'manual' ? 'saved' : 'auto');
    root.dataset.rateSourceMode = next;
    return next;
  };

  const exactDaily = (date) => state.daily.find((row) => row?.date === date) || null;
  const suppliedRowAt = (date) => historyByDate.get(date) || null;

  const savedRateAt = (date) => {
    const row = exactDaily(date);
    // Auto-imported Hirose rows are not manual saved overrides.
    if (!row || row.rateSource === 'hirose-ask-23close') return null;
    const rate = Number(row.rate);
    const usdJpy = usdJpyValueV2(row);
    return rate > 0 && usdJpy > 0 ? { date, rate, usdJpy, origin: 'saved', row } : null;
  };

  const suppliedHiroseRateAt = (date) => {
    const row = suppliedRowAt(date);
    const rate = Number(row?.usdTry);
    const usdJpy = Number(row?.usdJpy);
    return rate > 0 && usdJpy > 0 ? { date, rate, usdJpy, origin: 'hirose-supplied', row } : null;
  };

  const fetchedHiroseRateAt = (date) => {
    try {
      const row = typeof window.__DTL_HIROSE_RATE_AT__ === 'function' ? window.__DTL_HIROSE_RATE_AT__(date) : null;
      const rate = Number(row?.usdTryAskClose23);
      const usdJpy = Number(row?.usdJpyAskClose23);
      return rate > 0 && usdJpy > 0 ? { date, rate, usdJpy, origin: 'hirose', row } : null;
    } catch (_) {
      return null;
    }
  };

  // Existing user-saved daily rates stay authoritative. Otherwise both the
  // supplied rows and fetched history are one logical Hirose 23:00 ASK source.
  const automaticRateAt = (date) =>
    savedRateAt(date) || suppliedHiroseRateAt(date) || fetchedHiroseRateAt(date);

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

  const clearMarkers = (rateInput, usdJpyInput) => {
    ['rateSource', 'rateOrigin', 'hiroseAskClose23'].forEach((key) => {
      delete rateInput.dataset[key];
      delete usdJpyInput.dataset[key];
    });
  };

  const overrideKey = (prefix, date) => `${prefix}:${date}`;
  const restoreOverride = (prefix, date) => {
    const override = inputOverrides.get(overrideKey(prefix, date));
    if (!override) return false;
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!rateInput || !usdJpyInput) return false;
    if (override.rate != null) rateInput.value = override.rate;
    if (override.usdJpy != null) usdJpyInput.value = override.usdJpy;
    rateInput.dataset.rateSource = 'manual-override';
    usdJpyInput.dataset.rateSource = 'manual-override';
    const note = noteFor(prefix);
    if (note) note.textContent = `${date} · 自動入力値を手修正`;
    return true;
  };

  const applySelectedSource = (prefix, date) => {
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!rateInput || !usdJpyInput || !date) return false;
    if (restoreOverride(prefix, date)) return true;

    const mode = uiMode();
    const source = mode === 'manual' ? savedRateAt(date) : automaticRateAt(date);
    const note = noteFor(prefix);
    clearMarkers(rateInput, usdJpyInput);

    if (!source) {
      rateInput.value = '';
      usdJpyInput.value = '';
      if (note) note.textContent = mode === 'manual'
        ? '手入力 · USD/TRY と USD/JPY を入力'
        : `${date} のヒロセ23:00 ASKレート未登録 · 手入力可`;
      return false;
    }

    rateInput.value = Number(source.rate).toFixed(4);
    usdJpyInput.value = Number(source.usdJpy).toFixed(3);
    rateInput.dataset.rateSource = mode;
    usdJpyInput.dataset.rateSource = mode;
    rateInput.dataset.rateOrigin = source.origin;
    usdJpyInput.dataset.rateOrigin = source.origin;
    if (mode === 'auto' && source.origin !== 'saved') {
      rateInput.dataset.hiroseAskClose23 = '1';
      usdJpyInput.dataset.hiroseAskClose23 = '1';
    }

    if (note) {
      if (mode === 'manual') note.textContent = `${date} · 手入力で保存済み`;
      else if (source.origin === 'saved') note.textContent = `${date} · 保存済み手入力レートを使用`;
      else note.textContent = `${date} · 自動 · ヒロセ 60分足 23:00 ASK終値`;
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

    const wanted = [['auto', '自動'], ['manual', '手入力']];
    const current = [...select.options].map((o) => [o.value, o.textContent]);
    if (JSON.stringify(current) !== JSON.stringify(wanted)) {
      select.replaceChildren(...wanted.map(([value, text]) => {
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
        event.stopImmediatePropagation();
        inputOverrides.clear();
        const next = persistMode(select.value);
        applySelectedSource('daily', $('dailyDate')?.value || isoToday());
        applySelectedSource('quickDaily', $('quickDailyDate')?.value || isoToday());
        toast(next === 'manual' ? 'レートを手入力に切り替えました' : 'レートを自動入力に切り替えました');
      }, true);
    }
  };

  const bindInputOverride = (prefix) => {
    const dateInput = $(prefix + 'Date');
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    const form = $(prefix + 'Form');
    if (!dateInput || !rateInput || !usdJpyInput || !form) return;

    const remember = (field, value) => {
      if (uiMode() !== 'auto' || !dateInput.value) return;
      const key = overrideKey(prefix, dateInput.value);
      inputOverrides.set(key, { ...(inputOverrides.get(key) || {}), [field]: value });
      // Reassert after legacy asynchronous source listeners settle.
      setTimeout(() => restoreOverride(prefix, dateInput.value), 0);
    };
    rateInput.addEventListener('input', () => remember('rate', rateInput.value));
    usdJpyInput.addEventListener('input', () => remember('usdJpy', usdJpyInput.value));
    form.addEventListener('submit', () => {
      if (dateInput.value) restoreOverride(prefix, dateInput.value);
    }, true);
  };

  // Migrate old explicit modes: saved -> Manual; prepared/hirose -> Auto.
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
    bindInputOverride(prefix);
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
        ? data.history.filter((row) => row?.date && Number(row.usdTry) > 0 && Number(row.usdJpy) > 0)
          .sort((a, b) => a.date.localeCompare(b.date))
        : [];
      historyByDate = new Map(history.map((row) => [row.date, row]));

      window.__DTL_USER_PREPARED_RATE_HISTORY__ = () => history.map((row) => ({ ...row }));
      window.__DTL_USER_PREPARED_RATE_AT__ = (date) => {
        const row = suppliedRowAt(date);
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
