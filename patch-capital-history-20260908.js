// Time-series account capital ledger.
// settings.capital remains the current capital anchor. Historical capital is reconstructed
// by reversing dated deposits/withdrawals after the requested date. Deposits/withdrawals
// affect margin/equity/LC only; they are never counted as trading PnL.
(() => {
  const root = document.documentElement;
  if (root.dataset.capitalHistory === '1') return;

  const flows = () => {
    const rows = Array.isArray(state.settings.capitalFlows) ? state.settings.capitalFlows : [];
    return rows
      .filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date)) && Number.isFinite(Number(row.amount)))
      .map((row) => ({
        id: String(row.id || ''),
        date: String(row.date),
        amount: Number(row.amount),
        memo: String(row.memo || ''),
        appliedToCurrent: row.appliedToCurrent === true
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  };

  const currentAnchorDate = () => isoToday();

  const capitalAsOf = (date) => {
    const target = String(date || currentAnchorDate());
    const anchorDate = currentAnchorDate();
    const anchor = Number(state.settings.capital || 0);
    const rows = flows();
    if (target < anchorDate) {
      const afterTarget = rows
        .filter((row) => row.date > target && row.date <= anchorDate)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return anchor - afterTarget;
    }
    if (target > anchorDate) {
      const afterAnchor = rows
        .filter((row) => row.date > anchorDate && row.date <= target)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return anchor + afterAnchor;
    }
    return anchor;
  };

  const saveFlows = (rows) => {
    state.settings.capitalFlows = rows
      .map((row) => ({ ...row, amount: Number(row.amount || 0) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  };

  const setCurrentCapital = (value) => {
    state.settings.capital = Number(value || 0);
    if ($('settingCapital')) $('settingCapital').value = String(state.settings.capital);
  };

  const installCapitalAccounting = () => {
    maintenance = function(date, rate, tryJpy) {
      const margin = marginRequired(date, rate, tryJpy);
      if (!margin) return Infinity;
      const equity = capitalAsOf(date) + portfolioFx(date, rate, tryJpy) + portfolioSwap(date);
      return equity / margin * 100;
    };
    root.dataset.capitalHistoryAccounting = '1';
  };

  const baseRenderKpisCapitalHistory = renderKpis;
  renderKpis = function() {
    baseRenderKpisCapitalHistory();
    const s = latestSnapshot();
    if (s && $('kpiTotalPnlSub')) {
      $('kpiTotalPnlSub').textContent = `Equity ${money(capitalAsOf(s.date) + Number(s.total || 0))} · 元本 ${money(capitalAsOf(s.date))}`;
    }
  };

  const ensureUi = () => {
    if (!$('capitalHistoryBtn')) {
      const capitalLabel = $('settingCapital')?.closest('label');
      if (capitalLabel) {
        capitalLabel.classList.add('capital-anchor-setting');
        const span = capitalLabel.querySelector('span');
        if (span) span.innerHTML = '現在の口座元本 <em>円</em>';
        const launch = document.createElement('div');
        launch.className = 'capital-history-launch';
        launch.innerHTML = '<button class="outline-btn full" id="capitalHistoryBtn" type="button">入出金・元本履歴</button><small>過去の維持率・LCは日付時点の元本で再計算</small>';
        capitalLabel.after(launch);
      }
    }

    if (!$('capitalHistoryDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'capitalHistoryDialog';
      dialog.className = 'modal';
      dialog.innerHTML = `
        <div class="modal-card capital-history-card">
          <div class="modal-head"><div><span>CAPITAL LEDGER</span><h2>入出金・元本履歴</h2></div><button id="closeCapitalHistoryBtn" type="button">×</button></div>
          <p class="capital-history-explain">「現在の口座元本」を基準に、過去の入出金を逆算して各日の元本を復元します。入出金は損益には加えず、維持率・LC・Equityだけに反映します。</p>
          <div class="capital-history-summary" id="capitalHistorySummary"></div>
          <form id="capitalFlowForm" class="capital-flow-form">
            <input type="hidden" id="capitalFlowId" />
            <label>日付<input type="date" id="capitalFlowDate" required /></label>
            <label>区分<select id="capitalFlowType"><option value="deposit">入金</option><option value="withdrawal">出金</option></select></label>
            <label>金額<input type="number" id="capitalFlowAmount" min="0" step="1" inputmode="numeric" required /></label>
            <label class="capital-flow-memo">メモ<input type="text" id="capitalFlowMemo" placeholder="任意" /></label>
            <label class="capital-flow-apply"><input type="checkbox" id="capitalFlowApplyCurrent" /><span>現在の口座元本にも反映</span></label>
            <button class="solid-btn" type="submit" id="capitalFlowSaveBtn">履歴を追加</button>
            <button class="outline-btn" type="button" id="capitalFlowCancelEditBtn" hidden>編集を取消</button>
          </form>
          <div class="capital-flow-list" id="capitalFlowList"></div>
        </div>`;
      document.body.appendChild(dialog);
    }

    if (!document.querySelector('style[data-capital-history]')) {
      const style = document.createElement('style');
      style.dataset.capitalHistory = '1';
      style.textContent = `
        .capital-history-launch{margin:-5px 0 12px}.capital-history-launch small{display:block;margin-top:6px;color:var(--muted2);font-size:8px;line-height:1.5}
        .capital-history-card{width:min(760px,calc(100vw - 24px));max-height:min(820px,92dvh);overflow:auto}
        .capital-history-explain{font-size:9px;color:var(--muted2);line-height:1.7;margin:0 0 14px}
        .capital-history-summary{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);margin-bottom:16px}
        .capital-history-summary>div{padding:12px;border-right:1px solid var(--line)}.capital-history-summary>div:last-child{border-right:0}
        .capital-history-summary span{display:block;font-size:8px;color:var(--muted2)}.capital-history-summary strong{display:block;font-size:15px;margin-top:5px}
        .capital-flow-form{display:grid;grid-template-columns:145px 105px 145px minmax(120px,1fr);gap:10px;align-items:end;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
        .capital-flow-form label{display:flex;flex-direction:column;gap:6px;font-size:9px;color:var(--muted);font-weight:700}
        .capital-flow-form input,.capital-flow-form select{border:1px solid var(--line2);background:#0a0d12;color:var(--text);border-radius:9px;padding:10px 11px;outline:none;min-width:0}
        .capital-flow-apply{grid-column:1/4;flex-direction:row!important;align-items:center;gap:8px!important}.capital-flow-apply input{width:16px;height:16px;padding:0}.capital-flow-apply span{font-size:9px;color:var(--muted)}
        .capital-flow-form>.solid-btn{grid-column:4}.capital-flow-form>#capitalFlowCancelEditBtn{grid-column:4}
        .capital-flow-list{margin-top:12px}.capital-flow-empty{padding:24px 0;text-align:center;color:var(--muted2);font-size:10px}
        .capital-flow-row{display:grid;grid-template-columns:92px 65px 115px minmax(100px,1fr) 110px 70px;gap:10px;align-items:center;min-height:54px;border-bottom:1px solid var(--line);font-size:10px}
        .capital-flow-row .flow-date{color:#aeb7c2}.capital-flow-row .flow-type{font-size:8px;font-weight:850}.capital-flow-row .flow-type.deposit{color:var(--green)}.capital-flow-row .flow-type.withdrawal{color:var(--red)}
        .capital-flow-row .flow-amount{font-weight:800}.capital-flow-row .flow-memo{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.capital-flow-row .flow-capital{font-size:9px;color:#aeb7c2;text-align:right}.capital-flow-row .flow-actions{text-align:right;white-space:nowrap}
        .capital-flow-row .flow-applied{display:block;font-size:7px;color:var(--muted2);margin-top:3px}
        @media(max-width:700px){
          .capital-history-card{width:calc(100vw - 14px);padding-left:14px!important;padding-right:14px!important}
          .capital-history-summary{grid-template-columns:1fr}.capital-history-summary>div{border-right:0;border-bottom:1px solid var(--line)}.capital-history-summary>div:last-child{border-bottom:0}
          .capital-flow-form{grid-template-columns:1fr 1fr}.capital-flow-memo{grid-column:1/3}.capital-flow-apply{grid-column:1/3}.capital-flow-form>.solid-btn,.capital-flow-form>#capitalFlowCancelEditBtn{grid-column:auto}
          .capital-flow-row{grid-template-columns:70px 45px 90px minmax(0,1fr);gap:6px;padding:9px 0}.capital-flow-row .flow-capital{grid-column:3/5;text-align:left}.capital-flow-row .flow-actions{grid-column:1/5;text-align:left}
        }
      `;
      document.head.appendChild(style);
    }
  };

  const shiftIsoDate = (date, days) => {
    const d = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(d.getTime())) return date;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const renderCapitalHistory = () => {
    ensureUi();
    const rows = flows();
    const current = Number(state.settings.capital || 0);
    const oldest = rows[0]?.date || null;
    const beforeOldest = oldest ? capitalAsOf(shiftIsoDate(oldest, -1)) : current;
    if ($('capitalHistorySummary')) {
      $('capitalHistorySummary').innerHTML = `
        <div><span>現在の元本アンカー</span><strong>${money(current)}</strong></div>
        <div><span>履歴件数</span><strong>${rows.length} 件</strong></div>
        <div><span>${oldest ? `${oldest} より前` : '履歴前元本'}</span><strong>${money(beforeOldest)}</strong></div>`;
    }
    const host = $('capitalFlowList');
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = '<div class="capital-flow-empty">入出金履歴はまだありません。</div>';
      return;
    }
    host.innerHTML = [...rows].reverse().map((row) => {
      const deposit = row.amount >= 0;
      const signed = `${deposit ? '+' : '-'}¥${Math.abs(Math.trunc(row.amount)).toLocaleString('ja-JP')}`;
      return `<div class="capital-flow-row" data-flow-id="${escapeHtml(row.id)}">
        <span class="flow-date">${escapeHtml(row.date)}</span>
        <span class="flow-type ${deposit ? 'deposit' : 'withdrawal'}">${deposit ? '入金' : '出金'}</span>
        <strong class="flow-amount ${deposit ? 'positive-text' : 'negative-text'}">${signed}</strong>
        <span class="flow-memo">${escapeHtml(row.memo || '—')}</span>
        <span class="flow-capital">当日元本 ${money(capitalAsOf(row.date))}${row.appliedToCurrent ? '<small class="flow-applied">現在元本へ反映済</small>' : ''}</span>
        <span class="flow-actions"><button class="mini-btn" data-flow-action="edit" type="button">編集</button><button class="mini-btn danger" data-flow-action="delete" type="button">削除</button></span>
      </div>`;
    }).join('');
  };

  const resetFlowForm = () => {
    if (!$('capitalFlowForm')) return;
    $('capitalFlowId').value = '';
    $('capitalFlowDate').value = isoToday();
    $('capitalFlowType').value = 'deposit';
    $('capitalFlowAmount').value = '';
    $('capitalFlowMemo').value = '';
    $('capitalFlowApplyCurrent').checked = true;
    $('capitalFlowApplyCurrent').disabled = false;
    $('capitalFlowSaveBtn').textContent = '履歴を追加';
    $('capitalFlowCancelEditBtn').hidden = true;
  };

  const openCapitalHistory = () => {
    ensureUi();
    resetFlowForm();
    renderCapitalHistory();
    $('capitalHistoryDialog')?.showModal?.();
  };

  ensureUi();
  installCapitalAccounting();

  $('capitalHistoryBtn')?.addEventListener('click', openCapitalHistory);
  $('closeCapitalHistoryBtn')?.addEventListener('click', () => $('capitalHistoryDialog')?.close?.());
  $('capitalFlowCancelEditBtn')?.addEventListener('click', resetFlowForm);

  $('capitalFlowDate')?.addEventListener('change', () => {
    if ($('capitalFlowId')?.value) return;
    const date = $('capitalFlowDate')?.value;
    const canApply = date && date <= isoToday();
    $('capitalFlowApplyCurrent').disabled = !canApply;
    $('capitalFlowApplyCurrent').checked = date === isoToday();
  });

  $('capitalFlowForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = $('capitalFlowId')?.value || uid();
    const date = $('capitalFlowDate')?.value;
    const amountAbs = Number($('capitalFlowAmount')?.value);
    const type = $('capitalFlowType')?.value;
    const memo = $('capitalFlowMemo')?.value || '';
    if (!date || !Number.isFinite(amountAbs) || amountAbs <= 0) {
      toast('日付と金額を入力してください');
      return;
    }
    const amount = type === 'withdrawal' ? -Math.abs(amountAbs) : Math.abs(amountAbs);
    const rows = flows();
    const old = rows.find((row) => row.id === id) || null;
    let current = Number(state.settings.capital || 0);
    if (old?.appliedToCurrent) current -= Number(old.amount || 0);
    const appliedToCurrent = $('capitalFlowApplyCurrent')?.checked === true && date <= isoToday();
    if (appliedToCurrent) current += amount;
    setCurrentCapital(current);

    const next = rows.filter((row) => row.id !== id);
    next.push({ id, date, amount, memo, appliedToCurrent });
    saveFlows(next);
    saveState(old ? '入出金履歴を更新しました' : '入出金履歴を追加しました');
    resetFlowForm();
    renderCapitalHistory();
  });

  $('capitalFlowList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-flow-action]');
    const rowEl = event.target.closest('[data-flow-id]');
    if (!button || !rowEl) return;
    const id = rowEl.dataset.flowId;
    const row = flows().find((item) => item.id === id);
    if (!row) return;
    if (button.dataset.flowAction === 'edit') {
      $('capitalFlowId').value = row.id;
      $('capitalFlowDate').value = row.date;
      $('capitalFlowType').value = row.amount < 0 ? 'withdrawal' : 'deposit';
      $('capitalFlowAmount').value = String(Math.abs(row.amount));
      $('capitalFlowMemo').value = row.memo || '';
      $('capitalFlowApplyCurrent').disabled = row.date > isoToday();
      $('capitalFlowApplyCurrent').checked = row.appliedToCurrent === true;
      $('capitalFlowSaveBtn').textContent = '変更を保存';
      $('capitalFlowCancelEditBtn').hidden = false;
      $('capitalFlowDate')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (button.dataset.flowAction === 'delete') {
      if (!confirm(`${row.date} の${row.amount >= 0 ? '入金' : '出金'}履歴を削除しますか？`)) return;
      if (row.appliedToCurrent) setCurrentCapital(Number(state.settings.capital || 0) - Number(row.amount || 0));
      saveFlows(flows().filter((item) => item.id !== id));
      saveState('入出金履歴を削除しました');
      resetFlowForm();
      renderCapitalHistory();
    }
  });

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => ['data-hirose-margin', 'data-hirose-feed-ready', 'data-hirose-history-accounting'].includes(m.attributeName))) return;
    setTimeout(() => {
      installCapitalAccounting();
      try { renderAll(); } catch (_) {}
    }, 0);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-margin', 'data-hirose-feed-ready', 'data-hirose-history-accounting'] });

  window.__DTL_CAPITAL_AS_OF__ = (date) => capitalAsOf(date);
  window.__DTL_CAPITAL_FLOWS__ = () => flows().map((row) => ({ ...row }));
  root.dataset.capitalHistory = '1';
  root.dataset.capitalHistoryAccounting = '1';
  try { renderAll(); } catch (_) {}
})();
