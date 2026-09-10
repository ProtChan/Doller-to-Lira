// Hirose swap accounting convention:
// - The broker-published table date is the site's accounting/credit date.
// - Multi-day rows (3x/4x/etc.) stay on that published date; weekends without a row are 0.
// - Positions opened on the published date do not receive that day's row; positions closed
//   on the published date do receive it (handled by the history accounting layer).
// Missing future table data remains provisional 0 JPY and upgrades automatically.
(() => {
  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const isAuto = () => localStorage.getItem(MODE_KEY) === 'hirose';
  const root = document.documentElement;

  const parseIsoDate = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const isWeekend = (date) => {
    const d = parseIsoDate(date);
    if (!d) return false;
    const day = d.getUTCDay();
    return day === 0 || day === 6;
  };

  // Retained name for compatibility with older callers. The source is now the
  // selected broker table date itself; there is no next-business-day shift.
  const sourceDateForCredit = (creditDate) => creditDate;

  const historyRows = () => {
    try {
      return typeof window.__DTL_HIROSE_HISTORY__ === 'function'
        ? window.__DTL_HIROSE_HISTORY__()
        : [];
    } catch (_) {
      return [];
    }
  };

  const resolutionForCreditDate = (creditDate) => {
    const sourceDate = sourceDateForCredit(creditDate);
    const rows = historyRows();
    const row = rows.find((item) => item?.date === sourceDate) || null;
    if (row) return { status: 'official', creditDate, sourceDate, row, weekend: false };

    // An unpublished weekend is a confirmed zero. If a broker exceptionally publishes
    // a weekend row, the exact-row branch above still wins.
    if (isWeekend(creditDate)) {
      return { status: 'zero', creditDate, sourceDate, row: null, weekend: true };
    }

    const latestSourceDate = rows.length ? String(rows[rows.length - 1]?.date || '') : '';
    if (latestSourceDate && sourceDate <= latestSourceDate) {
      return { status: 'zero', creditDate, sourceDate, row: null, weekend: false };
    }
    return { status: 'pending', creditDate, sourceDate, row: null, weekend: false };
  };

  const scaledOfficial = (creditDate) => {
    const resolution = resolutionForCreditDate(creditDate);
    if (resolution.status !== 'official' || !resolution.row) return { ...resolution, shortPerLot: 0, longPerLot: 0 };
    const sourceUnit = Number(resolution.row.unit || 1000);
    const siteUnit = Number(state.settings.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return { ...resolution, status: 'pending', shortPerLot: 0, longPerLot: 0 };
    const factor = siteUnit / sourceUnit;
    return {
      ...resolution,
      shortPerLot: Number(resolution.row.sellJpy || 0) * factor,
      longPerLot: Number(resolution.row.buyJpy || 0) * factor
    };
  };

  const noteFor = (prefix) => $(prefix + 'Swap')?.closest('label')?.querySelector('.swap-source-note') || null;

  const syncPendingInput = (prefix) => {
    const input = $(prefix + 'Swap');
    const date = $(prefix + 'Date')?.value;
    if (!input || !date || !isAuto()) {
      if (input) {
        delete input.dataset.hirosePending;
        delete input.dataset.hiroseZero;
      }
      return;
    }

    delete input.dataset.hirosePending;
    delete input.dataset.hiroseZero;
    input.readOnly = true;
    input.dataset.hiroseAuto = '1';

    const official = scaledOfficial(date);
    const note = noteFor(prefix);
    if (official.status === 'official') {
      input.value = String(official.shortPerLot);
      if (note) {
        const sourceUnit = Number(official.row.unit || 1000);
        note.textContent = `ヒロセ ${date}付与 · ${official.row.days}日分 · ${sourceUnit.toLocaleString()}通貨 ${official.row.sellJpy}円 → ${Number(state.settings.unitsPerLot).toLocaleString()}通貨 ${official.shortPerLot.toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
      }
      return;
    }

    input.value = '0';
    if (official.status === 'zero') {
      input.dataset.hiroseZero = '1';
      if (note) {
        note.textContent = official.weekend
          ? `${date}は週末のためSwap 0円`
          : `${date}はヒロセ表記なし → Swap 0円`;
      }
      return;
    }

    input.dataset.hirosePending = '1';
    if (note) note.textContent = `${date}分 未確定 → 現在0円（取得後に同日へ自動反映）`;
  };

  const sourceFieldsFor = (resolution) => {
    if (resolution.status === 'official') {
      return {
        swapPerLot: resolution.shortPerLot,
        swapSource: 'hirose',
        swapPending: false,
        swapLongPerLot: resolution.longPerLot,
        swapSourceDate: resolution.sourceDate,
        swapCreditDate: resolution.creditDate,
        swapSourceDays: Number(resolution.row.days || 0),
        swapSourceUnit: Number(resolution.row.unit || 1000),
        swapSourceSellJpy: Number(resolution.row.sellJpy || 0),
        swapSourceBuyJpy: Number(resolution.row.buyJpy || 0)
      };
    }
    if (resolution.status === 'zero') {
      return {
        swapPerLot: 0,
        swapSource: 'hirose-zero',
        swapPending: false,
        swapLongPerLot: 0,
        swapSourceDate: resolution.sourceDate,
        swapCreditDate: resolution.creditDate,
        swapSourceDays: 0,
        swapSourceUnit: 1000,
        swapSourceSellJpy: 0,
        swapSourceBuyJpy: 0
      };
    }
    return {
      swapPerLot: 0,
      swapSource: 'hirose-pending',
      swapPending: true,
      swapLongPerLot: 0,
      swapSourceDate: resolution.sourceDate,
      swapCreditDate: resolution.creditDate,
      swapSourceDays: 0,
      swapSourceUnit: 1000,
      swapSourceSellJpy: 0,
      swapSourceBuyJpy: 0
    };
  };

  const reconcileAutoRows = () => {
    if (!Array.isArray(state.daily)) return false;
    let changed = false;
    state.daily = state.daily.map((row) => {
      const isHiroseRow = row?.swapPending || String(row?.swapSource || '').startsWith('hirose');
      if (!isHiroseRow || !row?.date) return row;
      const resolution = scaledOfficial(row.date);
      const next = { ...row, ...sourceFieldsFor(resolution) };
      const keys = [
        'swapPerLot','swapSource','swapPending','swapLongPerLot','swapSourceDate','swapCreditDate',
        'swapSourceDays','swapSourceUnit','swapSourceSellJpy','swapSourceBuyJpy'
      ];
      if (keys.some((key) => row[key] !== next[key])) changed = true;
      return next;
    });
    if (changed) {
      state.updatedAt = new Date().toISOString();
      localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
    }
    return changed;
  };

  const baseSaveDailyFromPending = saveDailyFrom;
  saveDailyFrom = function(prefix) {
    if (!isAuto()) return baseSaveDailyFromPending(prefix);

    const date = $(prefix + 'Date')?.value;
    const rate = Number($(prefix + 'Rate')?.value);
    const usdJpy = Number($(prefix + 'UsdJpy')?.value);
    if (!date || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(usdJpy) || usdJpy <= 0) {
      toast('日付・USD/TRY・USD/JPYを入力してください');
      return false;
    }

    const resolution = scaledOfficial(date);
    const tryJpy = usdJpy / rate;
    const idx = state.daily.findIndex((d) => d.date === date);
    const existing = idx >= 0 ? state.daily[idx] : {};
    const row = {
      ...existing,
      date,
      rate,
      usdJpy,
      tryJpy,
      ...sourceFieldsFor(resolution)
    };
    if (idx >= 0) state.daily[idx] = row;
    else state.daily.push(row);
    calendarCursor = monthFromLatest();

    const suffix = resolution.status === 'pending'
      ? ' · Swap未確定'
      : resolution.status === 'zero'
        ? ' · Swap 0円'
        : ` · ${resolution.sourceDate}付与分`;
    saveState(`${idx >= 0 ? '日次データを更新しました' : '日次データを保存しました'}${suffix}`);
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
    const changed = reconcileAutoRows();
    syncPendingInput('daily');
    syncPendingInput('quickDaily');
    const status = $('hiroseFeedStatus');
    if (status && !status.textContent.includes('表記日計上')) status.textContent += ' · 表記日計上';
    root.dataset.hiroseSwapCreditRule = 'same-day-table-date';
    root.dataset.hiroseSwapCalendarRule = 'same-day-table-date';
    if (changed) {
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

  window.__DTL_HIROSE_SWAP_RESOLUTION__ = (creditDate) => {
    const resolution = scaledOfficial(creditDate);
    return {
      status: resolution.status,
      sourceDate: resolution.sourceDate,
      creditDate: resolution.creditDate,
      shortPerLot: resolution.shortPerLot,
      longPerLot: resolution.longPerLot,
      weekend: resolution.weekend === true,
      row: resolution.row ? { ...resolution.row } : null
    };
  };

  window.__DTL_HIROSE_PREVIOUS_BUSINESS_SOURCE__ = (creditDate) => sourceDateForCredit(creditDate);

  refresh();
  root.dataset.hirosePendingEntries = '1';
  root.dataset.hiroseSwapCreditRule = 'same-day-table-date';
  root.dataset.hiroseSwapCalendarRule = 'same-day-table-date';
})();
