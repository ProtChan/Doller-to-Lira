// Position editing + fast LC solver only. Daily rate-source selection and the old
// secondary derived cache were intentionally removed for provider-readonly mode.
(() => {
  const root = document.documentElement;
  if (root.dataset.positionEditCore === '1') return;

  const ensureDialog = () => {
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
      const position = state.positions.find((row) => row.id === $('editPositionId')?.value);
      if (!position) return;
      const date = $('editPositionDate')?.value;
      const side = $('editPositionSide')?.value === 'long' ? 'long' : 'short';
      const entryRate = Number($('editPositionRate')?.value);
      const lots = Number($('editPositionLots')?.value);
      const memo = $('editPositionMemo')?.value?.trim() || '';
      if (!date || !(entryRate > 0) || !(lots > 0)) {
        toast('約定日・レート・lotを確認してください');
        return;
      }
      if (position.closeDate && position.closeDate < date) {
        toast('約定日は決済日以前にしてください');
        return;
      }
      Object.assign(position, { date, side, entryRate, lots, memo });
      dialog.close();
      window.__DTL_BACKEND_INVALIDATE__?.();
      saveState('ポジションを更新しました');
    });
  };

  const openEdit = (id) => {
    ensureDialog();
    const position = state.positions.find((row) => row.id === id);
    if (!position) return;
    $('editPositionId').value = position.id;
    $('editPositionDate').value = position.date || isoToday();
    $('editPositionSide').value = position.side === 'long' ? 'long' : 'short';
    $('editPositionRate').value = String(Number(position.entryRate || 0));
    $('editPositionLots').value = String(Number(position.lots || 0));
    $('editPositionMemo').value = position.memo || '';
    $('editPositionDialog')?.showModal?.();
  };

  const baseRenderPositionDetail = renderPositionDetail;
  renderPositionDetail = function() {
    baseRenderPositionDetail();
    const position = state.positions.find((row) => row.id === selectedPositionId);
    const actions = $('positionDetail')?.querySelector('.detail-actions');
    if (!position || !actions || $('detailEditBtn')) return;
    const button = document.createElement('button');
    button.className = 'mini-btn';
    button.id = 'detailEditBtn';
    button.type = 'button';
    button.textContent = '編集';
    actions.prepend(button);
    button.addEventListener('click', () => openEdit(position.id));
  };

  findLcRate = function(date, currentRate, currentTryJpy, currentUsdJpy) {
    const rate = Number(currentRate);
    const usdJpy = Number(currentUsdJpy) > 0 ? Number(currentUsdJpy) : rate * Number(currentTryJpy);
    if (!openPositionsOn(date).length || !(rate > 0) || !(usdJpy > 0)) return null;
    const target = Number(state.settings.lcThreshold || 100);
    const f = (candidate) => maintenance(date, candidate, usdJpy / candidate) - target;
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
      const steps = 64;
      let previousX = low;
      let previousF = lowF;
      for (let i = 1; i <= steps; i += 1) {
        const x = low + (high - low) * i / steps;
        const fx = i === steps ? highF : f(x);
        if (Number.isFinite(previousF) && Number.isFinite(fx) && previousF * fx <= 0) {
          bracket = [previousX, x, previousF];
          break;
        }
        previousX = x;
        previousF = fx;
      }
    }
    if (!bracket) return null;

    let [a, b, fa] = bracket;
    for (let i = 0; i < 42; i += 1) {
      const mid = (a + b) / 2;
      const fm = f(mid);
      if (!Number.isFinite(fm)) return null;
      if (fa * fm <= 0) b = mid;
      else { a = mid; fa = fm; }
    }
    return (a + b) / 2;
  };

  ensureDialog();
  const style = document.createElement('style');
  style.dataset.positionEditCore = '1';
  style.textContent = `
    .position-edit-card{width:min(680px,calc(100vw - 24px))}
    .position-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0 18px}
    .position-edit-grid label{display:flex;flex-direction:column;gap:6px;font-size:9px;color:var(--muted);font-weight:700}
    .position-edit-grid input,.position-edit-grid select{border:1px solid var(--line2);background:#0a0d12;color:var(--text);border-radius:9px;padding:11px 12px;outline:none;min-width:0;width:100%}
    .position-edit-memo{grid-column:1/3}
    @media(max-width:700px){.position-edit-grid{grid-template-columns:1fr}.position-edit-memo{grid-column:auto}.position-edit-card{width:calc(100vw - 14px)}}
  `;
  document.head.appendChild(style);

  window.__DTL_OPEN_POSITION_EDIT__ = (id) => openEdit(id);
  root.dataset.positionEditing = '1';
  root.dataset.fastLc = '1';
  root.dataset.positionEditCore = '1';
})();
