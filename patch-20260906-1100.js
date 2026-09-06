// Loaded in the same eval scope immediately after app.js.
// V2 accounting rules: daily inputs are USD/TRY + USD/JPY; TRY/JPY is derived.
// Swap credited in JPY discards sub-yen fractions after multiplying by lot.

const swapPerLotValueV2 = (d) => {
  const value = Number(d?.swapPerLot);
  return Number.isFinite(value) ? value : Number(state.settings.defaultSwap || 0);
};

const usdJpyValueV2 = (d) => {
  const explicit = Number(d?.usdJpy);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const rate = Number(d?.rate);
  const legacyTryJpy = Number(d?.tryJpy);
  if (Number.isFinite(rate) && rate > 0 && Number.isFinite(legacyTryJpy) && legacyTryJpy > 0) return rate * legacyTryJpy;
  return 0;
};

const tryJpyValueV2 = (d) => {
  const rate = Number(d?.rate);
  const usdJpy = usdJpyValueV2(d);
  if (rate > 0 && usdJpy > 0) return usdJpy / rate;
  const legacy = Number(d?.tryJpy);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : Number(state.settings.defaultTryJpy || 0);
};

const swapCreditForPositionDayV2 = (p, d) => {
  const sign = p.side === 'short' ? 1 : -1;
  return Math.trunc(sign * Number(p.lots || 0) * swapPerLotValueV2(d));
};

const dailySwapCreditV2 = (date) => {
  const d = state.daily.find((x) => x.date === date);
  if (!d) return 0;
  return state.positions
    .filter((p) => isPositionOpenOn(p, date))
    .reduce((sum, p) => sum + swapCreditForPositionDayV2(p, d), 0);
};

tryJpyAt = function(date) {
  const d = getDailyOnOrBefore(date);
  return d ? tryJpyValueV2(d) : Number(state.settings.defaultTryJpy || 0);
};

positionSwapAsOf = function(p, date) {
  return sortedDaily()
    .filter((d) => d.date >= p.date && d.date <= date && (!p.closeDate || d.date < p.closeDate))
    .reduce((sum, d) => sum + swapCreditForPositionDayV2(p, d), 0);
};

findLcRate = function(date, currentRate, currentTryJpy, currentUsdJpy) {
  const usdJpy = Number(currentUsdJpy) > 0
    ? Number(currentUsdJpy)
    : Number(currentRate) * Number(currentTryJpy);
  if (!openPositionsOn(date).length || !currentRate || !usdJpy) return null;
  const target = Number(state.settings.lcThreshold || 100);
  const f = (r) => maintenance(date, r, usdJpy / r) - target;
  const low = Math.max(0.0001, Number(currentRate) * 0.1);
  const high = Number(currentRate) * 4;
  let prevX = low;
  let prevF = f(low);
  let bracket = null;
  for (let i = 1; i <= 500; i++) {
    const x = low + (high - low) * i / 500;
    const fx = f(x);
    if (Number.isFinite(prevF) && Number.isFinite(fx) && prevF * fx <= 0) {
      bracket = [prevX, x];
      break;
    }
    prevX = x;
    prevF = fx;
  }
  if (!bracket) return null;
  let [a, b] = bracket;
  let fa = f(a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fa * fm <= 0) b = m;
    else { a = m; fa = fm; }
  }
  return (a + b) / 2;
};

derivedDaily = function() {
  let prevTotal = 0;
  return sortedDaily().map((d) => {
    const rate = Number(d.rate);
    const usdJpy = usdJpyValueV2(d);
    const tj = tryJpyValueV2(d);
    const fxPnl = portfolioFx(d.date, rate, tj);
    const swap = portfolioSwap(d.date);
    const total = fxPnl + swap;
    const row = {
      ...d,
      rate,
      usdJpy,
      tryJpy: tj,
      fxPnl,
      swap,
      dailySwap: dailySwapCreditV2(d.date),
      total,
      dailyPnl: total - prevTotal,
      lots: grossLotsOn(d.date),
      signedLots: signedLotsOn(d.date)
    };
    row.margin = marginRequired(d.date, rate, tj);
    row.maintenance = maintenance(d.date, rate, tj);
    row.lc = findLcRate(d.date, rate, tj, usdJpy);
    prevTotal = total;
    return row;
  });
};

const renderKpisV1 = renderKpis;
renderKpis = function() {
  renderKpisV1();
  const s = latestSnapshot();
  if ($('kpiSwapDaily')) $('kpiSwapDaily').textContent = s ? `直近 ${money(s.dailySwap)}/日` : '日次データ未入力';
  if ($('latestSnapshotLabel')) $('latestSnapshotLabel').textContent = s
    ? `${s.date} · USD/TRY ${rateFmt(s.rate)} · USD/JPY ${num(s.usdJpy, 3)}`
    : '日次データ未入力';
};

renderDailyTable = function() {
  const body = $('dailyTableBody');
  if (!body) return;
  const rows = [...derivedDaily()].reverse();
  body.innerHTML = rows.length ? rows.map((r) => `<tr><td>${r.date}</td><td>${rateFmt(r.rate)}</td><td>${num(r.usdJpy,3)}</td><td>${rateFmt(r.tryJpy)}</td><td>${money(swapPerLotValueV2(r))}</td><td>${num(r.lots,2)}</td><td class="${r.fxPnl>=0?'positive-text':'negative-text'}">${money(r.fxPnl)}</td><td class="${r.swap>=0?'positive-text':'negative-text'}">${money(r.swap)}</td><td class="${r.total>=0?'positive-text':'negative-text'}">${money(r.total)}</td><td class="${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</td><td><button class="mini-btn danger" data-delete-daily="${r.date}">削除</button></td></tr>`).join('') : '<tr><td colspan="11" style="text-align:center;color:#596373;padding:36px">日次データがありません</td></tr>';
  body.querySelectorAll('[data-delete-daily]').forEach((btn) => btn.addEventListener('click', () => {
    if (confirm(`${btn.dataset.deleteDaily} の日次データを削除しますか？`)) {
      state.daily = state.daily.filter((d) => d.date !== btn.dataset.deleteDaily);
      calendarCursor = monthFromLatest();
      saveState('日次データを削除しました');
    }
  }));
};

renderCalendar = function() {
  if (!$('calendarTitle') || !$('calendarGrid')) return;
  const y = calendarCursor.getFullYear();
  const m = calendarCursor.getMonth();
  const key = `${y}-${String(m+1).padStart(2,'0')}`;
  $('calendarTitle').textContent = `${y} / ${String(m+1).padStart(2,'0')}`;
  const map = new Map(derivedDaily().map((d) => [d.date, d]));
  const monthRows = [...map.values()].filter((d) => d.date.startsWith(key));
  const maxAbs = Math.max(1, ...monthRows.map((d) => Math.abs(d.dailyPnl)));
  const total = monthRows.reduce((s,r) => s + r.dailyPnl, 0);
  const swap = monthRows.reduce((s,r) => s + r.dailySwap, 0);
  const positive = monthRows.filter((r) => r.dailyPnl > 0).length;
  const negative = monthRows.filter((r) => r.dailyPnl < 0).length;
  if ($('calendarSummary')) $('calendarSummary').innerHTML = `<div><span>月間損益</span><strong class="${total>=0?'positive-text':'negative-text'}">${money(total)}</strong></div><div><span>Swap計</span><strong class="${swap>=0?'positive-text':'negative-text'}">${money(swap)}</strong></div><div><span>プラス日</span><strong>${positive}</strong></div><div><span>マイナス日</span><strong>${negative}</strong></div>`;
  const first = new Date(y,m,1,12);
  const days = new Date(y,m+1,0,12).getDate();
  const offset = (first.getDay()+6)%7;
  let html = '';
  for (let i=0;i<offset;i++) html += '<div class="calendar-day empty"></div>';
  for (let day=1;day<=days;day++) {
    const date = `${key}-${String(day).padStart(2,'0')}`;
    const r = map.get(date);
    const cls = r ? (r.dailyPnl >= 0 ? 'positive':'negative') : '';
    const heat = r ? Math.min(.18, .035 + Math.abs(r.dailyPnl)/maxAbs*.145) : 0;
    html += `<div class="calendar-day ${cls} ${date===isoToday()?'today':''}" style="--heat:${heat}"><span class="calendar-date">${day}</span>${r?`<div><div class="calendar-pnl ${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</div><div class="calendar-sub">Net ${money(r.total)} · ${num(r.lots,1)} lot</div></div>`:''}</div>`;
  }
  $('calendarGrid').innerHTML = html;
};

fillDailyForm = function(prefix, date = isoToday()) {
  const prev = getDailyOnOrBefore(date);
  if ($(prefix+'Date')) $(prefix+'Date').value = date;
  if ($(prefix+'UsdJpy')) {
    const usdJpy = prev ? usdJpyValueV2(prev) : 0;
    $(prefix+'UsdJpy').value = usdJpy > 0 ? String(Number(usdJpy.toFixed(3))) : '';
  }
  if ($(prefix+'Swap')) $(prefix+'Swap').value = Number.isFinite(Number(prev?.swapPerLot)) ? prev.swapPerLot : state.settings.defaultSwap;
};

saveDailyFrom = function(prefix) {
  const date = $(prefix+'Date')?.value;
  const rate = Number($(prefix+'Rate')?.value);
  const usdJpy = Number($(prefix+'UsdJpy')?.value);
  const rawSwap = $(prefix+'Swap')?.value;
  const swapPerLot = rawSwap === '' || rawSwap == null ? Number(state.settings.defaultSwap || 0) : Number(rawSwap);
  if (!date || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(usdJpy) || usdJpy <= 0) {
    toast('日付・USD/TRY・USD/JPYを入力してください');
    return false;
  }
  if (!Number.isFinite(swapPerLot)) {
    toast('Swap / lot を確認してください');
    return false;
  }
  const tryJpy = usdJpy / rate;
  const row = { date, rate, usdJpy, tryJpy, swapPerLot };
  const idx = state.daily.findIndex((d) => d.date === date);
  if (idx >= 0) state.daily[idx] = row;
  else state.daily.push(row);
  calendarCursor = monthFromLatest();
  saveState(idx >= 0 ? '日次データを更新しました' : '日次データを保存しました');
  return true;
};

// Replace the old CSV click handler before it reaches the target-phase listener.
$('exportCsvBtn')?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const rows = derivedDaily();
  const head = ['date','usdtry','usdjpy','tryjpy_calculated','swap_per_lot','lots','daily_swap_jpy','fx_pnl_jpy','cumulative_swap_jpy','total_pnl_jpy','daily_pnl_jpy','maintenance_pct','lc_rate'];
  const csv = [head.join(','), ...rows.map((r) => [r.date,r.rate,r.usdJpy,r.tryJpy,swapPerLotValueV2(r),r.lots,r.dailySwap,r.fxPnl,r.swap,r.total,r.dailyPnl,Number.isFinite(r.maintenance)?r.maintenance:'',r.lc||''].join(','))].join('\n');
  download(`dollar-to-lira_daily_${isoToday()}.csv`, csv, 'text/csv;charset=utf-8');
}, true);

// Re-run the visible state using V2 calculations after the original bootstrap.
fillDefaults();
renderAll();
document.documentElement.dataset.accountingV2 = '1';
