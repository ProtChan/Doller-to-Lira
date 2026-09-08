// Explicit user-prepared historical rate source.
(() => {
  const root = document.documentElement;
  if (root.dataset.userPreparedRates === '1') return;

  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  const FEED_URL = './data/user-prepared-rates.json?v=20260909-0303';
  const MODES = new Set(['auto', 'prepared', 'saved', 'hirose']);
  let history = [];
  let historyByDate = new Map();

  const rawMode = () => {
    const value = localStorage.getItem(RATE_SOURCE_KEY) || 'auto';
    return MODES.has(value) ? value : 'auto';
  };
  const rateAt = (date) => historyByDate.get(date) || null;

  const exactDaily = (date) => state.daily.find((row) => row?.date === date) || null;
  const savedRateAt = (date) => {
    const row = exactDaily(date);
    // Rows automatically imported from Hirose are not user-saved historical rates.
    if (!row || row.rateSource === 'hirose-ask-23close') return null;
    const rate = Number(row.rate);
    const usdJpy = usdJpyValueV2(row);
    if (!(rate > 0) || !(usdJpy > 0)) return null;
    return { date, rate, usdJpy, source: 'saved', row };
  };
  const hiroseRateAt = (date) => {
    try {
      const row = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
        ? window.__DTL_HIROSE_RATE_AT__(date)
        : null;
      const rate = Number(row?.usdTryAskClose23);
      const usdJpy = Number(row?.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) return null;
      return { date, rate, usdJpy, source: 'hirose', row };
    } catch (_) {
      return null;
    }
  };
  const preparedRateAt = (date) => {
    const row = rateAt(date);
    const rate = Number(row?.usdTry);
    const usdJpy = Number(row?.usdJpy);
    if (!(rate > 0) || !(usdJpy > 0)) return null;
    return { date, rate, usdJpy, source: 'prepared', row };
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

  const clearSourceMarkers = (rateInput, usdJpyInput) => {
    delete rateInput.dataset.rateSource;
    delete usdJpyInput.dataset.rateSource;
    delete rateInput.dataset.hiroseAskClose23;
    delete usdJpyInput.dataset.hiroseAskClose23;
  };

  const sourceFor = (mode, date) => {
    if (mode === 'prepared') return preparedRateAt(date);
    if (mode === 'saved') return savedRateAt(date);
    if (mode === 'hirose') return hiroseRateAt(date);
    // Auto keeps the original behavior: a user-saved row is authoritative;
    // otherwise use the Hirose historical 23:00 ASK close when available.
    return savedRateAt(date) || hiroseRateAt(date);
  };

  const applySelectedSource = (prefix, date) => {
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!rateInput || !usdJpyInput || !date) return false;

    const mode = rawMode();
    const note = noteFor(prefix);
    const source = sourceFor(mode, date);
    clearSourceMarkers(rateInput, usdJpyInput);

    if (!source) {
      // Explicit source modes should not silently retain a different date/source.
      if (mode !== 'auto') {
        rateInput.value = '';
        usdJpyInput.value = '';
      }
      if (note) {
        note.textContent = mode === 'prepared'
          ? `${date} の用意済みレートなし · 手入力可`
          : mode === 'saved'
            ? `${date} の保存済み過去レートなし · 手入力可`
            : mode === 'hirose'
              ? `${date} のヒロセ23:00 ASKレートなし · 手入力可`
              : '保存済み過去レートを優先し、なければヒロセ23:00 ASK';
      }
      return false;
    }

    rateInput.value = source.source === 'prepared'
      ? Number(source.rate).toFixed(4)
      : String(Number(source.rate));
    usdJpyInput.value = source.source === 'prepared'
      ? Number(source.usdJpy).toFixed(3)
      : String(Number(Number(source.usdJpy).toFixed(3)));
    rateInput.dataset.rateSource = source.source;
    usdJpyInput.dataset.rateSource = source.source;
    if (source.source === 'hirose') {
      rateInput.dataset.hiroseAskClose23 = '1';
      usdJpyInput.dataset.hiroseAskClose23 = '1';
    }

    if (note) {
      if (source.source === 'prepared') {
        note.textContent = `${date} · 用意済みレート USD/TRY ${Number(source.rate).toFixed(4)} · USD/JPY ${Number(source.usdJpy).toFixed(3)}`;
      } else if (source.source === 'saved') {
        note.textContent = `${date} · 過去の保存済みレートを使用`;
      } else {
        note.textContent = `${date} · ヒロセ 60分足 23:00 ASK終値を使用`;
      }
    }
    return true;
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
    select.value = rawMode();

    if (!select.dataset.preparedSourceBound) {
      select.dataset.preparedSourceBound = '1';
      // Own the selector in capture phase. The older selector layer predates the
      // `prepared` mode, so this keeps all four modes deterministic.
      select.addEventListener('change', (event) => {
        event.stopImmediatePropagation();
        const next = MODES.has(select.value) ? select.value : 'auto';
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

  // Install last, after the legacy Hirose/rate-source wrappers. This guarantees
  // that the currently selected source wins after any older fill logic runs.
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
      window.__DTL_APPLY_SELECTED_RATE_SOURCE__ = (prefix, date) => applySelectedSource(prefix, date);
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

  root.dataset.rateSourceMode = rawMode();
  root.dataset.userPreparedRates = '1';
})();
