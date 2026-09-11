// Keep visible Hirose swap inputs on the intentionally shifted display calendar.
// Broker/source date D is displayed on the next business day C. A position opened on C
// does not receive that displayed amount; entitlement is handled by the accounting patch.
(() => {
  const root = document.documentElement;
  if (root.dataset.shiftedSwapUiGuard === '1') return;

  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const isHirose = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(MODE_KEY) === 'hirose';

  const parseDate = (date) => {
    const value = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(value.getTime()) ? value : null;
  };
  const iso = (value) => value.toISOString().slice(0, 10);
  const isWeekend = (date) => {
    const value = parseDate(date);
    if (!value) return false;
    const day = value.getUTCDay();
    return day === 0 || day === 6;
  };
  const previousBusinessDate = (displayDate) => {
    const value = parseDate(displayDate);
    if (!value) return '';
    value.setUTCDate(value.getUTCDate() - 1);
    while (value.getUTCDay() === 0 || value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
    return iso(value);
  };
  const historyRows = () => {
    try {
      const rows = typeof window.__DTL_HIROSE_HISTORY__ === 'function' ? window.__DTL_HIROSE_HISTORY__() : [];
      return Array.isArray(rows)
        ? rows.filter((row) => row?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
        : [];
    } catch (_) {
      return [];
    }
  };
  const scaled = (row) => {
    const sourceUnit = Number(row?.unit || 1000);
    const siteUnit = Number(state?.settings?.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return { shortPerLot: 0, longPerLot: 0 };
    const factor = siteUnit / sourceUnit;
    return {
      shortPerLot: Number(row?.sellJpy || 0) * factor,
      longPerLot: Number(row?.buyJpy || 0) * factor
    };
  };
  const resolveDisplay = (displayDate) => {
    if (!displayDate) return { status: 'zero', sourceDate: '', displayDate: '', weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
    if (isWeekend(displayDate)) {
      return { status: 'zero', sourceDate: previousBusinessDate(displayDate), displayDate, weekend: true, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    const sourceDate = previousBusinessDate(displayDate);
    const rows = historyRows();
    const row = rows.find((item) => item.date === sourceDate) || null;
    if (row) {
      const amount = scaled(row);
      return {
        status: 'official', sourceDate, displayDate, weekend: false, row: { ...row },
        shortPerLot: amount.shortPerLot, longPerLot: amount.longPerLot
      };
    }
    const latestSource = rows.at(-1)?.date || '';
    if (latestSource && sourceDate && sourceDate <= latestSource) {
      return { status: 'zero', sourceDate, displayDate, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    return { status: 'pending', sourceDate, displayDate, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
  };

  const settle = (prefix) => {
    if (!isHirose()) return;
    const date = document.getElementById(`${prefix}Date`)?.value || '';
    const input = document.getElementById(`${prefix}Swap`);
    if (!date || !input) return;

    const current = resolveDisplay(date);
    input.readOnly = true;
    input.value = String(Number(current.shortPerLot || 0));
    input.dataset.hiroseAuto = '1';
    delete input.dataset.hirosePending;
    delete input.dataset.hiroseZero;
    if (current.status === 'pending') input.dataset.hirosePending = '1';
    if (current.status === 'zero') input.dataset.hiroseZero = '1';

    const note = input.closest('label')?.querySelector('.swap-source-note');
    if (!note) return;
    if (current.status === 'official') {
      const row = current.row || {};
      note.textContent = `ヒロセ ${current.sourceDate}表記 → ${current.displayDate}表示 · ${Number(row.days || 0)}日分 · ${Number(row.unit || 1000).toLocaleString()}通貨 ${Number(row.sellJpy || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円 → ${Number(state.settings.unitsPerLot || 1000).toLocaleString()}通貨 ${Number(current.shortPerLot || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
    } else if (current.status === 'pending') {
      note.textContent = `${current.sourceDate}分 未確定 → ${current.displayDate}表示は現在0円`;
    } else {
      note.textContent = current.weekend
        ? `${date}は週末のため表示Swap 0円`
        : `${current.sourceDate}はヒロセ表記なし → ${current.displayDate}表示Swap 0円`;
    }
  };

  const settleBurst = (prefix) => {
    [0, 20, 80, 250, 750].forEach((delay) => setTimeout(() => settle(prefix), delay));
  };

  const originalFillDailyForm = fillDailyForm;
  fillDailyForm = function(prefix, date) {
    const result = originalFillDailyForm.apply(this, arguments);
    settleBurst(prefix);
    return result;
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = document.getElementById(`${prefix}Date`);
    if (!dateInput || dateInput.dataset.shiftedSwapUiGuardBound) return;
    dateInput.dataset.shiftedSwapUiGuardBound = '1';
    const schedule = () => settleBurst(prefix);
    // This file loads after the legacy same-day writers. Register in the normal bubble
    // phase so our zero-delay callback is queued after theirs and wins the same event tick.
    dateInput.addEventListener('input', schedule);
    dateInput.addEventListener('change', schedule);
  });

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-hirose-margin',
      'data-hirose-pending-entries',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready',
      'data-reference-data-rebuilt-at'
    ].includes(mutation.attributeName))) return;
    settleBurst('daily');
    settleBurst('quickDaily');
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-hirose-history-ready',
      'data-hirose-feed-ready',
      'data-hirose-margin',
      'data-hirose-pending-entries',
      'data-swap-input-mode',
      'data-live-rate-refresh-ready',
      'data-reference-data-rebuilt-at'
    ]
  });

  root.dataset.hiroseSwapInputRule = 'previous-business-day-source-next-business-day-display';
  root.dataset.shiftedSwapUiGuard = '1';
  settleBurst('daily');
  settleBurst('quickDaily');
})();