// Swap decimal input extension.
// Keep swap-per-lot values as entered, then truncate only after multiplying by lot.
(() => {
  const swapInputIds = ['quickDailySwap', 'dailySwap', 'settingSwap'];
  swapInputIds.forEach((id) => {
    const input = document.getElementById(id);
    if (input) stepAny(input);
  });

  function stepAny(input) {
    input.step = 'any';
    input.setAttribute('inputmode', 'decimal');
  }

  const swapRateText = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}`;
  };

  // Preserve decimals in the per-lot display. Credited swap remains integer JPY
  // because swapCreditForPositionDayV2 uses Math.trunc after lot multiplication.
  renderDailyTable = function() {
    const body = $('dailyTableBody');
    if (!body) return;
    const rows = [...derivedDaily()].reverse();
    body.innerHTML = rows.length ? rows.map((r) => `<tr><td>${r.date}</td><td>${rateFmt(r.rate)}</td><td>${num(r.usdJpy,3)}</td><td>${rateFmt(r.tryJpy)}</td><td>${swapRateText(swapPerLotValueV2(r))}</td><td>${num(r.lots,2)}</td><td class="${r.fxPnl>=0?'positive-text':'negative-text'}">${money(r.fxPnl)}</td><td class="${r.swap>=0?'positive-text':'negative-text'}">${money(r.swap)}</td><td class="${r.total>=0?'positive-text':'negative-text'}">${money(r.total)}</td><td class="${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</td><td><button class="mini-btn danger" data-delete-daily="${r.date}">削除</button></td></tr>`).join('') : '<tr><td colspan="11" style="text-align:center;color:#596373;padding:36px">日次データがありません</td></tr>';
    body.querySelectorAll('[data-delete-daily]').forEach((btn) => btn.addEventListener('click', () => {
      if (confirm(`${btn.dataset.deleteDaily} の日次データを削除しますか？`)) {
        state.daily = state.daily.filter((d) => d.date !== btn.dataset.deleteDaily);
        calendarCursor = monthFromLatest();
        saveState('日次データを削除しました');
      }
    }));
  };

  renderDailyTable();
  document.documentElement.dataset.swapDecimals = '1';
})();
