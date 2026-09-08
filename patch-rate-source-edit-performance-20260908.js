// Rate-source chooser + position editing + render/accounting performance improvements.
// Loaded last so it can layer on top of the existing accounting/history patches.
(() => {
  const root = document.documentElement;
  if (root.dataset.rateEditPerformance === '1') return;

  const RATE_SOURCE_KEY = 'dollar-to-lira:rate-source:v1';
  const getRateSourceMode = () => {
    const value = localStorage.getItem(RATE_SOURCE_KEY);
    return ['auto', 'saved', 'hirose'].includes(value) ? value : 'auto';
  };
  const setRateSourceMode = (value) => {
    const mode = ['auto', 'saved', 'hirose'].includes(value) ? value : 'auto';
    localStorage.setItem(RATE_SOURCE_KEY, mode);
    root.dataset.rateSourceMode = mode;
    return mode;
  };

  const exactDaily = (date) => state.daily.find((row) => row?.date === date) || null;
  const savedPreparedRate = (date) => {
    const row = exactDaily(date);
    if (!row || row.rateSource === 'hirose-ask-23close') return null;
    const rate = Number(row.rate);
    const usdJpy = usdJpyValueV2(row);
    if (!(rate > 0) || !(usdJpy > 0)) return null;
    return { date, rate, usdJpy, row };
  };
  const hirosePreparedRate = (date) => {
    try {
      const row = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
        ? window.__DTL_HIROSE_RATE_AT__(date)
        : null;
      const rate = Number(row?.usdTryAskClose23);
      const usdJpy = Number(row?.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) return null;
      return { date, rate, usdJpy, row };
    } catch (_) {
      return null;
    }
  };

  const ensureRateNote = (prefix) => {
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

  const applyRateSource = (prefix, date) => {
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    if (!rateInput || !usdJpyInput || !date) return false;
    const mode = getRateSourceMode();
    const saved = savedPreparedRate(date);
    const hirose = hirosePreparedRate(date);
    const source = mode === 'saved' ? saved : mode === 'hirose' ? hirose : (saved || hirose);
    const note = ensureRateNote(prefix);

    delete rateInput.dataset.rateSource;
    delete usdJpyInput.dataset.rateSource;

    if (!source) {
      // In explicit source modes, do not silently carry a previous day's rate into this date.
      if (mode !== 'auto') {
        rateInput.value = '';
        usdJpyInput.value = '';
      }
      if (note) {
        note.textContent = mode === 'saved'
          ? `${date} の保存済み過去レートなし · 手入力可`
          : mode === 'hirose'
            ? `${date} のヒロセ23:00 ASKレートなし · 手入力可`
            : '保存済み過去レートを優先し、なければヒロセ23:00 ASK';
      }
      return false;
    }

    rateInput.value = String(source.rate);
    usdJpyInput.value = String(Number(source.usdJpy.toFixed(3)));
    const sourceName = source === saved ? 'saved' : 'hirose';
    rateInput.dataset.rateSource = sourceName;
    usdJpyInput.dataset.rateSource = sourceName;
    if (note) {
      note.textContent = sourceName === 'saved'
        ? `${date} · 過去の保存済みレートを使用`
        : `${date} · ヒロセ 60分足 23:00 ASK終値を使用`;
    }
    return true;
  };

  const ensureRateSourceUi = () => {
    if ($('settingRateSource')) return;
    const host = document.querySelector('.settings-list');
    if (!host) return;
    const label = document.createElement('label');
    label.className = 'rate-source-setting';
    label.innerHTML = `
      <span>過去レート <em>方式</em></span>
      <select id="settingRateSource">
        <option value="auto">保存済み優先 → ヒロセ</option>
        <option value="saved">過去の保存済みレート</option>
        <option value="hirose">ヒロセ 23:00 ASK</option>
      </select>
      <small id="rateSourceStatus">日次入力の日付に合わせて自動入力</small>`;
    host.appendChild(label);
    $('settingRateSource').value = getRateSourceMode();
    $('settingRateSource').addEventListener('change', () => {
      const mode = setRateSourceMode($('settingRateSource').value);
      applyRateSource('daily', $('dailyDate')?.value || isoToday());
      applyRateSource('quickDaily', $('quickDailyDate')?.value || isoToday());
      const labels = {
        auto: '保存済み過去レート優先に切り替えました',
        saved: '過去の保存済みレートを使います',
        hirose: 'ヒロセ23:00 ASKレートを使います'
      };
      toast(labels[mode]);
    });
  };

  const baseFillDailyFormRateChoice = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormRateChoice(prefix, date);
    applyRateSource(prefix, date);
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    const resync = () => setTimeout(() => applyRateSource(prefix, dateInput?.value), 0);
    dateInput?.addEventListener('input', resync);
    dateInput?.addEventListener('change', resync);
  });

  // ---- Position editing ----------------------------------------------------
  const ensurePositionEditDialog = () => {
    if ($('editPositionDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'editPositionDialog';
    dialog.className = 'modal';
    dialog.innerHTML = `
      <form class="modal-card position-edit-card" id="editPositionForm">
        <div class="modal-head"><div><span>EDIT POSITION</span><h2>ポジション編集</h2></div><button type="button" id="closeEditPositionBtn">×</button></div>
        <input type="hidden" id="editPositionId" />
        <div class="position-edit-grid">
          <label>約定日<input type="date" id="editPositionDate" required /></label>
          <label>売買<select id="editPositionSide"><option value="short">売り</option><option value="long">買い</option></select></label>
          <label>約定レート<input type="number" id="editPositionRate" step="0.0001" min="0" required /></label>
          <label>lot<input type="number" id="editPositionLots" step="0.01" min="0.01" required /></label>
          <label class="position-edit-memo">メモ<input type="text" id="editPositionMemo" /></label>
        </div>
        <div class="modal-footer"><button class="outline-btn" type="button" id="cancelEditPositionBtn">キャンセル</button><button class="solid-btn" type="submit">変更を保存</button></div>
      </form>`;
    document.body.appendChild(dialog);

    $('closeEditPositionBtn')?.addEventListener('click', () => dialog.close());
    $('cancelEditPositionBtn')?.addEventListener('click', () => dialog.close());
    $('editPositionForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = $('editPositionId')?.value;
      const p = state.positions.find((row) => row.id === id);
      if (!p) return;
      const date = $('editPositionDate')?.value;
      const side = $('editPositionSide')?.value === 'long' ? 'long' : 'short';
      const entryRate = Number($('editPositionRate')?.value);
      const lots = Number($('editPositionLots')?.value);
      const memo = $('editPositionMemo')?.value?.trim() || '';
      if (!date || !(entryRate > 0) || !(lots > 0)) {
        toast('約定日・レート・lotを確認してください');
        return;
      }
      if (p.closeDate && p.closeDate < date) {
        toast('約定日は決済日以前にしてください');
        return;
      }
      p.date = date;
      p.side = side;
      p.entryRate = entryRate;
      p.lots = lots;
      p.memo = memo;
      dialog.close();
      invalidatePerformanceCaches();
      saveState('ポジションを更新しました');
    });
  };

  const openPositionEdit = (id) => {
    ensurePositionEditDialog();
    const p = state.positions.find((row) => row.id === id);
    if (!p) return;
    $('editPositionId').value = p.id;
    $('editPositionDate').value = p.date || isoToday();
    $('editPositionSide').value = p.side === 'long' ? 'long' : 'short';
    $('editPositionRate').value = String(Number(p.entryRate || 0));
    $('editPositionLots').value = String(Number(p.lots || 0));
    $('editPositionMemo').value = p.memo || '';
    $('editPositionDialog')?.showModal?.();
  };

  const baseRenderPositionDetailEdit = renderPositionDetail;
  renderPositionDetail = function() {
    baseRenderPositionDetailEdit();
    const p = state.positions.find((row) => row.id === selectedPositionId);
    const actions = $('positionDetail')?.querySelector('.detail-actions');
    if (!p || !actions || $('detailEditBtn')) return;
    const button = document.createElement('button');
    button.className = 'mini-btn';
    button.id = 'detailEditBtn';
    button.type = 'button';
    button.textContent = '編集';
    actions.prepend(button);
    button.addEventListener('click', () => openPositionEdit(p.id));
  };

  // ---- Performance ---------------------------------------------------------
  const perf = {
    derivedComputations: 0,
    derivedCacheHits: 0,
    lcCalls: 0,
    renderCount: 0,
    lastDerivedMs: 0,
    lastRenderMs: 0
  };
  let derivedGeneration = 0;
  let derivedCache = null;

  function invalidatePerformanceCaches() {
    derivedGeneration += 1;
    derivedCache = null;
  }

  const stateSignature = () => [
    derivedGeneration,
    state.updatedAt || '',
    state.positions.length,
    state.daily.length,
    Number(state.settings.capital || 0),
    Number(state.settings.unitsPerLot || 0),
    Number(state.settings.leverage || 0),
    Number(state.settings.lcThreshold || 0),
    localStorage.getItem('dollar-to-lira:swap-mode:v1') || 'manual',
    root.dataset.hiroseMargin || '',
    root.dataset.hiroseHistoryReady || ''
  ].join('|');

  const installFastLc = () => {
    findLcRate = function(date, currentRate, currentTryJpy, currentUsdJpy) {
      perf.lcCalls += 1;
      const rate = Number(currentRate);
      const usdJpy = Number(currentUsdJpy) > 0
        ? Number(currentUsdJpy)
        : rate * Number(currentTryJpy);
      if (!openPositionsOn(date).length || !(rate > 0) || !(usdJpy > 0)) return null;
      const target = Number(state.settings.lcThreshold || 100);
      const f = (r) => maintenance(date, r, usdJpy / r) - target;
      const low = Math.max(0.0001, rate * 0.1);
      const high = rate * 4;
      const currentF = f(rate);
      if (Number.isFinite(currentF) && Math.abs(currentF) < 1e-10) return rate;

      const lowF = f(low);
      const highF = f(high);
      let bracket = null;
      if (Number.isFinite(lowF) && Number.isFinite(currentF) && lowF * currentF <= 0) bracket = [low, rate, lowF];
      else if (Number.isFinite(currentF) && Number.isFinite(highF) && currentF * highF <= 0) bracket = [rate, high, currentF];
      else if (Number.isFinite(lowF) && Number.isFinite(highF) && lowF * highF <= 0) bracket = [low, high, lowF];

      if (!bracket) {
        // Mixed long/short books can be non-obvious. Fall back to a compact scan,
        // then use high-precision bisection once a sign change is found.
        const steps = 64;
        let prevX = low;
        let prevF = lowF;
        for (let i = 1; i <= steps; i += 1) {
          const x = low + (high - low) * i / steps;
          const fx = i === steps ? highF : f(x);
          if (Number.isFinite(prevF) && Number.isFinite(fx) && prevF * fx <= 0) {
            bracket = [prevX, x, prevF];
            break;
          }
          prevX = x;
          prevF = fx;
        }
      }
      if (!bracket) return null;

      let [a, b, fa] = bracket;
      for (let i = 0; i < 42; i += 1) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (!Number.isFinite(fm)) return null;
        if (fa * fm <= 0) b = m;
        else { a = m; fa = fm; }
      }
      return (a + b) / 2;
    };
    root.dataset.fastLc = '1';
  };

  const installDerivedCache = () => {
    if (derivedDaily?.__dtlCachedDerived === true) return;
    const baseDerived = derivedDaily;
    const wrapped = function() {
      const sig = stateSignature();
      if (derivedCache && derivedCache.base === baseDerived && derivedCache.sig === sig) {
        perf.derivedCacheHits += 1;
        return derivedCache.rows;
      }
      const started = performance.now();
      const rows = baseDerived();
      perf.derivedComputations += 1;
      perf.lastDerivedMs = performance.now() - started;
      derivedCache = { base: baseDerived, sig, rows };
      root.dataset.lastDerivedMs = perf.lastDerivedMs.toFixed(1);
      return rows;
    };
    wrapped.__dtlCachedDerived = true;
    wrapped.__dtlBaseDerived = baseDerived;
    derivedDaily = wrapped;
    root.dataset.derivedCache = '1';
  };

  const baseRenderAllPerformance = renderAll;
  renderAll = function() {
    const started = performance.now();
    const result = baseRenderAllPerformance();
    perf.renderCount += 1;
    perf.lastRenderMs = performance.now() - started;
    root.dataset.lastRenderMs = perf.lastRenderMs.toFixed(1);
    return result;
  };

  const baseSaveStatePerformance = saveState;
  saveState = function(message = '') {
    invalidatePerformanceCaches();
    return baseSaveStatePerformance(message);
  };

  installFastLc();
  installDerivedCache();
  ensureRateSourceUi();
  ensurePositionEditDialog();
  setRateSourceMode(getRateSourceMode());

  // The Hirose margin/history layers arrive asynchronously and replace accounting
  // symbols. Re-apply only the performance wrappers after those layers settle.
  const accountingObserver = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => [
      'data-hirose-margin',
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-swap-input-mode',
      'data-hirose-rate-history-ready'
    ].includes(mutation.attributeName));
    if (!relevant) return;
    invalidatePerformanceCaches();
    setTimeout(() => {
      installFastLc();
      installDerivedCache();
      ensureRateSourceUi();
      applyRateSource('daily', $('dailyDate')?.value || isoToday());
      applyRateSource('quickDaily', $('quickDailyDate')?.value || isoToday());
    }, 0);
  });
  accountingObserver.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-hirose-margin',
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-swap-input-mode',
      'data-hirose-rate-history-ready'
    ]
  });

  const style = document.createElement('style');
  style.dataset.rateEditPerformance = '1';
  style.textContent = `
    .rate-source-setting select,.position-edit-grid select{border:1px solid var(--line2);background:#0a0d12;color:var(--text);border-radius:9px;padding:11px 12px;outline:none;width:100%}
    .rate-source-setting small{display:block;color:var(--muted2);font-size:8px;line-height:1.55;margin-top:7px;font-weight:500}
    .rate-source-note{display:block;margin-top:5px;color:var(--muted2);font-size:7.5px;line-height:1.45;font-weight:500}
    .position-edit-card{width:min(680px,calc(100vw - 24px))}
    .position-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0 18px}
    .position-edit-grid label{display:flex;flex-direction:column;gap:6px;font-size:9px;color:var(--muted);font-weight:700}
    .position-edit-grid input{border:1px solid var(--line2);background:#0a0d12;color:var(--text);border-radius:9px;padding:11px 12px;outline:none;min-width:0}
    .position-edit-memo{grid-column:1/3}
    @media(max-width:700px){.position-edit-grid{grid-template-columns:1fr}.position-edit-memo{grid-column:auto}.position-edit-card{width:calc(100vw - 14px)}}
  `;
  document.head.appendChild(style);

  window.__DTL_APPLY_RATE_SOURCE__ = (prefix, date) => applyRateSource(prefix, date);
  window.__DTL_RATE_SOURCE_MODE__ = () => getRateSourceMode();
  window.__DTL_OPEN_POSITION_EDIT__ = (id) => openPositionEdit(id);
  window.__DTL_PERF_STATS__ = () => ({ ...perf, generation: derivedGeneration });

  root.dataset.rateSourceChoice = '1';
  root.dataset.positionEditing = '1';
  root.dataset.performanceCache = '1';
  root.dataset.rateEditPerformance = '1';
})();
