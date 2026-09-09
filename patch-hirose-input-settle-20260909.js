// Keep the visible Hirose swap aligned with the selected credit date immediately.
// The legacy same-date Hirose listener runs synchronously, while the next-business-day
// accounting layer normally corrects it on a zero-delay timer. WebKit can paint/read
// between those two steps. This listener is attached after the next-day layer is ready,
// so it becomes the final synchronous date-change writer and removes that stale flash.
(() => {
  const root = document.documentElement;
  const MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  let bound = false;
  let observer = null;

  const hiroseMode = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(MODE_KEY) === 'hirose';

  const stateUnits = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('dollar-to-lira:v1') || '{}');
      const units = Number(saved?.settings?.unitsPerLot);
      return units > 0 ? units : 1000;
    } catch (_) {
      return 1000;
    }
  };

  const noteFor = (input) => input?.closest('label')?.querySelector('.swap-source-note') || null;

  const settle = (prefix) => {
    if (!hiroseMode() || typeof window.__DTL_HIROSE_SWAP_RESOLUTION__ !== 'function') return;
    const dateInput = document.getElementById(`${prefix}Date`);
    const input = document.getElementById(`${prefix}Swap`);
    const date = dateInput?.value;
    if (!date || !input) return;

    const resolution = window.__DTL_HIROSE_SWAP_RESOLUTION__(date);
    if (!resolution) return;

    input.readOnly = true;
    input.dataset.hiroseAuto = '1';
    delete input.dataset.hirosePending;
    delete input.dataset.hiroseZero;

    const note = noteFor(input);
    if (resolution.status === 'official') {
      input.value = String(Number(resolution.shortPerLot || 0));
      if (note) {
        const row = resolution.row || {};
        const sourceUnit = Number(row.unit || 1000);
        const units = stateUnits();
        const sell = Number(row.sellJpy || 0);
        const days = Number(row.days || 0);
        note.textContent = `ヒロセ ${resolution.sourceDate}表記 → ${date}計上 · ${days}日分 · ${sourceUnit.toLocaleString()}通貨 ${sell}円 → ${units.toLocaleString()}通貨 ${Number(resolution.shortPerLot || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
      }
      return;
    }

    input.value = '0';
    if (resolution.status === 'zero') {
      input.dataset.hiroseZero = '1';
      if (note) {
        note.textContent = resolution.weekend
          ? `${date}は週末のためSwap計上 0円`
          : `${resolution.sourceDate}表記なし → ${date}計上 0円`;
      }
      return;
    }

    input.dataset.hirosePending = '1';
    if (note) note.textContent = `${resolution.sourceDate}表記 未確定 → ${date}は計算上0円（取得後に自動反映）`;
  };

  const bind = () => {
    if (bound || root.dataset.hirosePendingEntries !== '1' || typeof window.__DTL_HIROSE_SWAP_RESOLUTION__ !== 'function') return;
    bound = true;
    observer?.disconnect();

    ['daily', 'quickDaily'].forEach((prefix) => {
      const dateInput = document.getElementById(`${prefix}Date`);
      if (!dateInput) return;
      const onDateChange = () => settle(prefix);
      dateInput.addEventListener('input', onDateChange);
      dateInput.addEventListener('change', onDateChange);
      settle(prefix);
    });

    root.dataset.hiroseInputSettle = '1';
  };

  if (root.dataset.hirosePendingEntries === '1') bind();
  else {
    observer = new MutationObserver(bind);
    observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-pending-entries'] });
  }
})();
