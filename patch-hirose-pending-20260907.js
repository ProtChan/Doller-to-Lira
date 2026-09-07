// Allow daily snapshots even when the Hirose swap for that date is not published yet.
// Missing official swap is stored as a provisional 0 JPY and automatically upgraded
// once the persisted Hirose history contains that date.
(() => {
  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const isAuto = () => localStorage.getItem(MODE_KEY) === 'hirose';
  const root = document.documentElement;

  const historyRows = () => {
    try {
      return typeof window.__DTL_HIROSE_HISTORY__ === 'function'
        ? window.__DTL_HIROSE_HISTORY__()
        : [];
    } catch (_) {
      return [];
    }
  };

  const officialRow = (date) => historyRows().find((row) => row?.date === date) || null;

  const scaledOfficial = (date) => {
    const row = officialRow(date);
    if (!row) return null;
    const sourceUnit = Number(row.unit || 1000);
    const siteUnit = Number(state.settings.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return null;
    const factor = siteUnit / sourceUnit;
    return {
      row,
      shortPerLot: Number(row.sellJpy || 0) * factor,
      longPerLot: Number(row.buyJpy || 0) * factor
    };
  };

  const noteFor = (prefix) => $(prefix + 'Swap')?.closest('label')?.querySelector('.swap-source-note') || null;

  const syncPendingInput = (prefix) => {
    const input = $(prefix + 'Swap');
    const date = $(prefix + 'Date')?.value;
    if (!input || !date || !isAuto()) {
      if (input) delete input.dataset.hirosePending;
      return;
    }

    const official = scaledOfficial(date);
    if (official) {
      delete input.dataset.hirosePending;
      // The main Hirose patch normally fills this value. Re-assert it here so an
      // entry that was provisional becomes official immediately after history refresh.
      input.value = String(official.shortPerLot);
      input.readOnly = true;
      input.dataset.hiroseAuto = '1';
      const note = noteFor(prefix);
      if (note) note.textContent = `ヒロセ USD/TRY 売り · ${official.row.days}日分 · 1,000通貨 ${official.row.sellJpy}円 → ${Number(state.settings.unitsPerLot).toLocaleString()}通貨 ${official.shortPerLot.toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
      return;
    }

    input.value = '0';
    input.readOnly = true;
    input.dataset.hiroseAuto = '1';
    input.dataset.hirosePending = '1';
    const note = noteFor(prefix);
    if (note) note.textContent = '未確定 · 計算上は0円として保存（公式Swap取得後に自動反映）';
  };

  const upgradePendingRows = () => {
    if (!Array.isArray(state.daily)) return false;
    let changed = false;
    state.daily = state.daily.map((row) => {
      if (!row?.swapPending && row?.swapSource !== 'hirose-pending') return row;
      const official = scaledOfficial(row.date);
      if (!official) return row;
      changed = true;
      return {
        ...row,
        swapPerLot: official.shortPerLot,
        swapSource: 'hirose',
        swapPending: false,
        swapLongPerLot: official.longPerLot,
        swapSourceDays: Number(official.row.days || 0),
        swapSourceUnit: Number(official.row.unit || 1000),
        swapSourceSellJpy: Number(official.row.sellJpy || 0),
        swapSourceBuyJpy: Number(official.row.buyJpy || 0)
      };
    });
    if (changed) {
      state.updatedAt = new Date().toISOString();
      localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
    }
    return changed;
  };

  const baseSaveDailyFromPending = saveDailyFrom;
  saveDailyFrom = function(prefix) {
    const input = $(prefix + 'Swap');
    if (!isAuto() || input?.dataset.hirosePending !== '1') {
      return baseSaveDailyFromPending(prefix);
    }

    const date = $(prefix + 'Date')?.value;
    const rate = Number($(prefix + 'Rate')?.value);
    const usdJpy = Number($(prefix + 'UsdJpy')?.value);
    if (!date || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(usdJpy) || usdJpy <= 0) {
      toast('日付・USD/TRY・USD/JPYを入力してください');
      return false;
    }

    const tryJpy = usdJpy / rate;
    const row = {
      date,
      rate,
      usdJpy,
      tryJpy,
      swapPerLot: 0,
      swapSource: 'hirose-pending',
      swapPending: true
    };
    const idx = state.daily.findIndex((d) => d.date === date);
    if (idx >= 0) state.daily[idx] = row;
    else state.daily.push(row);
    calendarCursor = monthFromLatest();
    saveState(idx >= 0 ? '日次データを更新しました · Swap未確定' : '日次データを保存しました · Swap未確定');
    setTimeout(() => syncPendingInput(prefix), 0);
    return true;
  };

  const baseFillDailyFormPending = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormPending(prefix, date);
    syncPendingInput(prefix);
  };

  const baseRenderDailyTablePending = renderDailyTable;
  renderDailyTable = function() {
    baseRenderDailyTablePending();
    const body = $('dailyTableBody');
    if (!body) return;
    [...body.querySelectorAll('tr')].forEach((tr) => {
      const date = tr.children?.[0]?.textContent?.trim();
      if (!date) return;
      const row = state.daily.find((d) => d.date === date);
      if (!row?.swapPending && row?.swapSource !== 'hirose-pending') return;
      const cell = tr.children?.[4];
      if (!cell || cell.querySelector('.hirose-pending-badge')) return;
      const badge = document.createElement('small');
      badge.className = 'hirose-pending-badge';
      badge.textContent = '未確定';
      cell.appendChild(badge);
    });
  };

  const style = document.createElement('style');
  style.textContent = `
    input[data-hirose-pending="1"]{border-color:rgba(238,181,64,.42)!important}
    .hirose-pending-badge{display:block;margin-top:2px;font-size:7px;line-height:1.2;color:#c99b3c;font-weight:750;white-space:nowrap}
  `;
  document.head.appendChild(style);

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    const resync = () => setTimeout(() => syncPendingInput(prefix), 0);
    dateInput?.addEventListener('input', resync);
    dateInput?.addEventListener('change', resync);
  });

  const refresh = () => {
    const upgraded = upgradePendingRows();
    syncPendingInput('daily');
    syncPendingInput('quickDaily');
    if (upgraded) {
      try { renderAll(); } catch (_) {}
    } else {
      try { renderDailyTable(); } catch (_) {}
    }
  };

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => ['data-hirose-feed-ready', 'data-hirose-history-ready', 'data-swap-input-mode'].includes(m.attributeName))) return;
    setTimeout(refresh, 0);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-feed-ready', 'data-hirose-history-ready', 'data-swap-input-mode'] });

  refresh();
  root.dataset.hirosePendingEntries = '1';
})();
