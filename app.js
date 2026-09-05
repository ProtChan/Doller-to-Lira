const STORE_KEY = 'dollar-to-lira:v1';
const DEFAULT_STATE = {
  settings: { capital: 500000, unitsPerLot: 10000, leverage: 25, lcThreshold: 100, defaultTryJpy: 3.25, defaultSwap: 0 },
  positions: [],
  daily: [],
  updatedAt: null
};

const $ = (id) => document.getElementById(id);
const clone = (obj) => JSON.parse(JSON.stringify(obj));
const isoToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const num = (v, d = 2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('ja-JP', { maximumFractionDigits: d }) : '—';
const rateFmt = (v) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('ja-JP', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—';
const money = (v) => Number.isFinite(Number(v)) ? `${Number(v) < 0 ? '-' : ''}¥${Math.abs(Number(v)).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}` : '—';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>'\"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '\"':'&quot;' }[c]));

let state = loadState();
let activeTab = 'overview';
let overviewMode = 'pnl';
let selectedPositionId = null;
let calendarCursor = monthFromLatest();
let charts = {};
let settingsTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return clone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      daily: Array.isArray(parsed.daily) ? parsed.daily : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch (e) {
    console.error('loadState failed', e);
    return clone(DEFAULT_STATE);
  }
}

function saveState(message = '') {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  renderAll();
  if (message) toast(message);
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 1600);
}

function sortedDaily() {
  return [...state.daily].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function latestDaily() {
  const rows = sortedDaily();
  return rows[rows.length - 1] || null;
}
function getDailyOnOrBefore(date) {
  const rows = sortedDaily().filter((d) => d.date <= date);
  return rows[rows.length - 1] || null;
}
function monthFromLatest() {
  const base = latestDaily()?.date || isoToday();
  return new Date(`${base.slice(0, 7)}-01T12:00:00`);
}
function isPositionOpenOn(p, date) {
  return p.date <= date && (!p.closeDate || p.closeDate > date);
}
function openPositionsOn(date) {
  return state.positions.filter((p) => isPositionOpenOn(p, date));
}
function grossLotsOn(date) {
  return openPositionsOn(date).reduce((s, p) => s + Number(p.lots || 0), 0);
}
function signedLotsOn(date) {
  return openPositionsOn(date).reduce((s, p) => s + (p.side === 'short' ? 1 : -1) * Number(p.lots || 0), 0);
}
function tryJpyAt(date) {
  return Number(getDailyOnOrBefore(date)?.tryJpy || state.settings.defaultTryJpy || 0);
}
function positionFx(p, markRate, markTryJpy) {
  const units = Number(state.settings.unitsPerLot) * Number(p.lots || 0);
  const dir = p.side === 'long' ? 1 : -1;
  return (Number(markRate) - Number(p.entryRate)) * units * dir * Number(markTryJpy);
}
function positionSwapAsOf(p, date) {
  const sign = p.side === 'short' ? 1 : -1;
  return sortedDaily()
    .filter((d) => d.date >= p.date && d.date <= date && (!p.closeDate || d.date < p.closeDate))
    .reduce((sum, d) => {
      const perLot = Number.isFinite(Number(d.swapPerLot)) ? Number(d.swapPerLot) : Number(state.settings.defaultSwap || 0);
      return sum + sign * Number(p.lots || 0) * perLot;
    }, 0);
}
function positionFxAsOf(p, date, rate, tryJpy) {
  if (p.date > date) return 0;
  if (p.closeDate && p.closeDate <= date) {
    return positionFx(p, Number(p.closeRate), tryJpyAt(p.closeDate) || tryJpy);
  }
  return positionFx(p, rate, tryJpy);
}
function portfolioFx(date, rate, tryJpy) {
  return state.positions.reduce((sum, p) => sum + positionFxAsOf(p, date, rate, tryJpy), 0);
}
function portfolioSwap(date) {
  return state.positions.reduce((sum, p) => sum + positionSwapAsOf(p, date), 0);
}
function marginRequired(date, rate, tryJpy) {
  const units = grossLotsOn(date) * Number(state.settings.unitsPerLot);
  const lev = Number(state.settings.leverage || 1);
  return units && rate && tryJpy ? units * Number(rate) * Number(tryJpy) / lev : 0;
}
function maintenance(date, rate, tryJpy) {
  const margin = marginRequired(date, rate, tryJpy);
  if (!margin) return Infinity;
  const equity = Number(state.settings.capital) + portfolioFx(date, rate, tryJpy) + portfolioSwap(date);
  return equity / margin * 100;
}
function findLcRate(date, currentRate, tryJpy) {
  if (!openPositionsOn(date).length || !currentRate || !tryJpy) return null;
  const target = Number(state.settings.lcThreshold || 100);
  const f = (r) => maintenance(date, r, tryJpy) - target;
  const low = Math.max(0.0001, currentRate * 0.1);
  const high = currentRate * 4;
  let prevX = low, prevF = f(low), bracket = null;
  for (let i = 1; i <= 500; i++) {
    const x = low + (high - low) * i / 500;
    const fx = f(x);
    if (Number.isFinite(prevF) && Number.isFinite(fx) && prevF * fx <= 0) {
      bracket = [prevX, x];
      break;
    }
    prevX = x; prevF = fx;
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
}
function derivedDaily() {
  let prevTotal = 0;
  return sortedDaily().map((d) => {
    const rate = Number(d.rate);
    const tj = Number(d.tryJpy || state.settings.defaultTryJpy || 0);
    const fxPnl = portfolioFx(d.date, rate, tj);
    const swap = portfolioSwap(d.date);
    const total = fxPnl + swap;
    const row = {
      ...d,
      rate,
      tryJpy: tj,
      fxPnl,
      swap,
      total,
      dailyPnl: total - prevTotal,
      lots: grossLotsOn(d.date),
      signedLots: signedLotsOn(d.date)
    };
    row.margin = marginRequired(d.date, rate, tj);
    row.maintenance = maintenance(d.date, rate, tj);
    row.lc = findLcRate(d.date, rate, tj);
    prevTotal = total;
    return row;
  });
}
function latestSnapshot() {
  const rows = derivedDaily();
  return rows[rows.length - 1] || null;
}
function latestMark() {
  const s = latestSnapshot();
  return s ? { date:s.date, rate:s.rate, tryJpy:s.tryJpy } : { date:isoToday(), rate:null, tryJpy:Number(state.settings.defaultTryJpy || 0) };
}
function weightedAverageEntry(date) {
  const open = openPositionsOn(date);
  const lots = open.reduce((s, p) => s + Number(p.lots || 0), 0);
  if (!lots) return null;
  return open.reduce((s, p) => s + Number(p.entryRate) * Number(p.lots || 0), 0) / lots;
}
function positionSnapshot(p) {
  const mark = latestMark();
  const closed = !!p.closeDate;
  const asOf = closed ? p.closeDate : mark.date;
  const rate = closed ? Number(p.closeRate) : mark.rate;
  const tj = closed ? tryJpyAt(p.closeDate) : mark.tryJpy;
  const fx = rate ? positionFxAsOf(p, asOf, rate, tj) : null;
  const swap = positionSwapAsOf(p, asOf);
  return { asOf, rate, tryJpy:tj, fx, swap, net:fx === null ? null : fx + swap, closed };
}

function setSigned(id, text, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('positive-text', 'negative-text');
  if (Number.isFinite(Number(value))) el.classList.add(Number(value) >= 0 ? 'positive-text' : 'negative-text');
}

function renderKpis() {
  const s = latestSnapshot();
  const date = s?.date || isoToday();
  const lots = s?.lots ?? grossLotsOn(date);
  const avg = weightedAverageEntry(date);
  setSigned('kpiTotalPnl', s ? money(s.total) : '—', s?.total);
  if ($('kpiTotalPnlSub')) $('kpiTotalPnlSub').textContent = s ? `Equity ${money(Number(state.settings.capital) + s.total)}` : 'FX + Swap';
  if ($('kpiLots')) $('kpiLots').textContent = `${num(lots, 2)} lot`;
  if ($('kpiUnits')) $('kpiUnits').textContent = `${Math.round(lots * Number(state.settings.unitsPerLot)).toLocaleString()} 通貨`;
  setSigned('kpiSwap', s ? money(s.swap) : '—', s?.swap);
  if ($('kpiSwapDaily')) $('kpiSwapDaily').textContent = s ? `直近 ${money((Number(s.swapPerLot || state.settings.defaultSwap)) * s.signedLots)}/日` : '日次データ未入力';
  setSigned('kpiFxPnl', s ? money(s.fxPnl) : '—', s?.fxPnl);
  if ($('kpiAvgEntry')) $('kpiAvgEntry').textContent = avg ? `平均 ${rateFmt(avg)}` : '建玉なし';
  setSigned('kpiMaintenance', s ? (Number.isFinite(s.maintenance) ? `${num(s.maintenance,1)}%` : '∞') : '—', s ? s.maintenance - Number(state.settings.lcThreshold) : null);
  if ($('kpiMargin')) $('kpiMargin').textContent = s ? `必要 ${money(s.margin)}` : '—';
  if ($('kpiLc')) $('kpiLc').textContent = s?.lc ? rateFmt(s.lc) : '—';
  if ($('kpiLcDistance')) $('kpiLcDistance').textContent = s?.lc ? `現値比 ${((s.lc / s.rate - 1) * 100).toFixed(2)}%` : '計算対象なし';
  if ($('latestSnapshotLabel')) $('latestSnapshotLabel').textContent = s ? `${s.date} · USD/TRY ${rateFmt(s.rate)}` : '日次データ未入力';
}

function renderOverviewPositions() {
  const host = $('overviewPositionList');
  if (!host) return;
  const mark = latestMark();
  const open = state.positions.filter((p) => !p.closeDate).sort((a,b) => b.date.localeCompare(a.date));
  if (!open.length) {
    host.innerHTML = '<div class="empty-state">保有中ポジションはありません。ポジションタブから追加してください。</div>';
    return;
  }
  host.innerHTML = open.slice(0,6).map((p) => {
    const s = positionSnapshot(p);
    return `<div class="position-line" data-position-id="${p.id}"><div class="name"><strong>${p.side === 'short' ? 'USD/TRY Short' : 'USD/TRY Long'} · ${num(p.lots,2)} lot</strong><span>${p.date} · ${escapeHtml(p.memo || 'メモなし')}</span></div><div class="cell"><span>Entry</span><strong>${rateFmt(p.entryRate)}</strong></div><div class="cell"><span>Current</span><strong>${rateFmt(mark.rate)}</strong></div><div class="cell"><span>FX</span><strong class="${(s.fx || 0) >= 0 ? 'positive-text':'negative-text'}">${s.fx === null ? '—' : money(s.fx)}</strong></div><div class="cell"><span>Swap</span><strong class="${s.swap >= 0 ? 'positive-text':'negative-text'}">${money(s.swap)}</strong></div><div class="cell"><span>Net</span><strong class="${(s.net || 0) >= 0 ? 'positive-text':'negative-text'}">${s.net === null ? '—' : money(s.net)}</strong></div></div>`;
  }).join('');
  host.querySelectorAll('[data-position-id]').forEach((el) => el.addEventListener('click', () => {
    selectedPositionId = el.dataset.positionId;
    switchTab('positions');
  }));
}

function renderPositionTable() {
  const body = $('positionTableBody');
  if (!body) return;
  const rows = [...state.positions].sort((a,b) => b.date.localeCompare(a.date));
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#596373;padding:36px">ポジションがありません</td></tr>';
    renderPositionDetail();
    return;
  }
  body.innerHTML = rows.map((p) => {
    const s = positionSnapshot(p);
    return `<tr class="${p.id === selectedPositionId ? 'selected':''}" data-position-id="${p.id}"><td>${p.date}</td><td><span class="side-pill ${p.side}">${p.side === 'short' ? 'SHORT':'LONG'}</span></td><td>${rateFmt(p.entryRate)}</td><td>${num(p.lots,2)}</td><td>${rateFmt(s.rate)}</td><td class="${(s.fx||0)>=0?'positive-text':'negative-text'}">${s.fx===null?'—':money(s.fx)}</td><td class="${s.swap>=0?'positive-text':'negative-text'}">${money(s.swap)}</td><td class="${(s.net||0)>=0?'positive-text':'negative-text'}">${s.net===null?'—':money(s.net)}</td><td><span class="status-pill ${p.closeDate?'closed':'open'}">${p.closeDate?'CLOSED':'OPEN'}</span></td><td><button class="mini-btn" data-action="detail" data-id="${p.id}">詳細</button></td></tr>`;
  }).join('');
  body.querySelectorAll('tr[data-position-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    selectedPositionId = tr.dataset.positionId;
    renderPositionTable();
  }));
  body.querySelectorAll('[data-action="detail"]').forEach((btn) => btn.addEventListener('click', () => {
    selectedPositionId = btn.dataset.id;
    renderPositionTable();
  }));
  renderPositionDetail();
}

function renderPositionDetail() {
  const host = $('positionDetail');
  if (!host) return;
  const p = state.positions.find((x) => x.id === selectedPositionId);
  if (!p) {
    host.className = 'position-detail empty';
    host.innerHTML = '<div class="detail-empty"><span>POSITION DETAIL</span><strong>ポジションを選択</strong><p>行をタップすると、そのポジションだけの損益推移・スワップ・詳細を表示します。</p></div>';
    return;
  }
  const s = positionSnapshot(p);
  const units = Number(p.lots) * Number(state.settings.unitsPerLot);
  host.className = 'position-detail';
  host.innerHTML = `<div class="detail-top"><div><span class="tag">${p.side==='short'?'SHORT POSITION':'LONG POSITION'}</span><h3>${num(p.lots,2)} lot</h3></div><div class="detail-actions">${!p.closeDate?'<button class="mini-btn" id="detailCloseBtn">決済</button>':''}<button class="mini-btn danger" id="detailDeleteBtn">削除</button></div></div><div class="detail-net"><span>このポジションのNet損益</span><strong class="${(s.net||0)>=0?'positive-text':'negative-text'}">${s.net===null?'—':money(s.net)}</strong></div><div class="detail-grid"><div><span>FX損益</span><strong class="${(s.fx||0)>=0?'positive-text':'negative-text'}">${s.fx===null?'—':money(s.fx)}</strong></div><div><span>累積Swap</span><strong class="${s.swap>=0?'positive-text':'negative-text'}">${money(s.swap)}</strong></div><div><span>約定レート</span><strong>${rateFmt(p.entryRate)}</strong></div><div><span>現在 / 決済</span><strong>${rateFmt(s.rate)}</strong></div><div><span>通貨数</span><strong>${Math.round(units).toLocaleString()}</strong></div><div><span>期間</span><strong>${p.date} → ${p.closeDate || s.asOf}</strong></div></div><div class="detail-chart-title">ポジション単体の累積損益</div><div class="detail-chart"><canvas id="positionPnlChart"></canvas></div>${p.memo?`<div class="detail-memo">${escapeHtml(p.memo)}</div>`:''}`;
  $('detailCloseBtn')?.addEventListener('click', () => openCloseDialog(p.id));
  $('detailDeleteBtn')?.addEventListener('click', () => {
    if (confirm('このポジションを削除しますか？')) {
      state.positions = state.positions.filter((x) => x.id !== p.id);
      selectedPositionId = null;
      saveState('ポジションを削除しました');
    }
  });
  renderPositionChart(p);
}

function renderDailyTable() {
  const body = $('dailyTableBody');
  if (!body) return;
  const rows = [...derivedDaily()].reverse();
  body.innerHTML = rows.length ? rows.map((r) => `<tr><td>${r.date}</td><td>${rateFmt(r.rate)}</td><td>${rateFmt(r.tryJpy)}</td><td>${money(Number(r.swapPerLot ?? state.settings.defaultSwap))}</td><td>${num(r.lots,2)}</td><td class="${r.fxPnl>=0?'positive-text':'negative-text'}">${money(r.fxPnl)}</td><td class="${r.swap>=0?'positive-text':'negative-text'}">${money(r.swap)}</td><td class="${r.total>=0?'positive-text':'negative-text'}">${money(r.total)}</td><td class="${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</td><td><button class="mini-btn danger" data-delete-daily="${r.date}">削除</button></td></tr>`).join('') : '<tr><td colspan="10" style="text-align:center;color:#596373;padding:36px">日次データがありません</td></tr>';
  body.querySelectorAll('[data-delete-daily]').forEach((btn) => btn.addEventListener('click', () => {
    if (confirm(`${btn.dataset.deleteDaily} の日次データを削除しますか？`)) {
      state.daily = state.daily.filter((d) => d.date !== btn.dataset.deleteDaily);
      calendarCursor = monthFromLatest();
      saveState('日次データを削除しました');
    }
  }));
}

function renderCalendar() {
  if (!$('calendarTitle') || !$('calendarGrid')) return;
  const y = calendarCursor.getFullYear();
  const m = calendarCursor.getMonth();
  const key = `${y}-${String(m+1).padStart(2,'0')}`;
  $('calendarTitle').textContent = `${y} / ${String(m+1).padStart(2,'0')}`;
  const map = new Map(derivedDaily().map((d) => [d.date, d]));
  const monthRows = [...map.values()].filter((d) => d.date.startsWith(key));
  const maxAbs = Math.max(1, ...monthRows.map((d) => Math.abs(d.dailyPnl)));
  const total = monthRows.reduce((s,r) => s + r.dailyPnl, 0);
  const swap = monthRows.reduce((s,r) => s + (Number(r.swapPerLot ?? state.settings.defaultSwap) * r.signedLots), 0);
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
}

function renderRiskFacts() {
  const host = $('riskFacts');
  if (!host) return;
  const s = latestSnapshot();
  if (!s) {
    host.innerHTML = '<div class="risk-fact"><span>STATUS</span><strong>日次データ未入力</strong></div>';
    if ($('riskStatusLabel')) $('riskStatusLabel').textContent = '日次データを入力してください';
    return;
  }
  const equity = Number(state.settings.capital) + s.total;
  const buffer = Number.isFinite(s.maintenance) ? s.maintenance - Number(state.settings.lcThreshold) : Infinity;
  const dist = s.lc ? (s.lc/s.rate - 1)*100 : null;
  if ($('riskStatusLabel')) $('riskStatusLabel').textContent = Number.isFinite(buffer) ? `LC閾値まで +${num(buffer,1)}pt` : '建玉なし';
  host.innerHTML = `<div class="risk-fact"><span>口座純資産</span><strong>${money(equity)}</strong></div><div class="risk-fact"><span>必要証拠金</span><strong>${money(s.margin)}</strong></div><div class="risk-fact"><span>維持率</span><strong>${Number.isFinite(s.maintenance)?`${num(s.maintenance,1)}%`:'∞'}</strong></div><div class="risk-fact"><span>推定LC</span><strong>${s.lc?rateFmt(s.lc):'—'}</strong></div><div class="risk-fact"><span>現値→LC</span><strong>${dist===null?'—':`${dist>=0?'+':''}${dist.toFixed(2)}%`}</strong></div>`;
}

function renderSettings() {
  const pairs = [
    ['settingCapital', state.settings.capital],
    ['settingUnits', state.settings.unitsPerLot],
    ['settingLeverage', state.settings.leverage],
    ['settingLcThreshold', state.settings.lcThreshold],
    ['settingTryJpy', state.settings.defaultTryJpy],
    ['settingSwap', state.settings.defaultSwap]
  ];
  pairs.forEach(([id, value]) => { if ($(id) && document.activeElement !== $(id)) $(id).value = value; });
  if ($('backupMeta')) $('backupMeta').textContent = `ポジション ${state.positions.length}件 / 日次 ${state.daily.length}日 / 最終保存 ${state.updatedAt ? new Date(state.updatedAt).toLocaleString('ja-JP') : '未保存'}`;
}

function renderAll() {
  renderKpis();
  renderOverviewPositions();
  renderPositionTable();
  renderDailyTable();
  renderCalendar();
  renderRiskFacts();
  renderSettings();
  requestAnimationFrame(renderActiveCharts);
}

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  requestAnimationFrame(renderActiveCharts);
}

function openSettings() {
  renderSettings();
  $('settingsDrawer')?.classList.add('show');
  $('settingsBackdrop')?.classList.add('show');
  $('settingsDrawer')?.setAttribute('aria-hidden','false');
}
function closeSettings() {
  $('settingsDrawer')?.classList.remove('show');
  $('settingsBackdrop')?.classList.remove('show');
  $('settingsDrawer')?.setAttribute('aria-hidden','true');
}
function scheduleSettingsSave() {
  const status = $('settingsSaveStatus');
  if (status) { status.classList.add('saving'); status.innerHTML = '<i></i> 保存中…'; }
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const next = {
      capital:Number($('settingCapital')?.value),
      unitsPerLot:Number($('settingUnits')?.value),
      leverage:Number($('settingLeverage')?.value),
      lcThreshold:Number($('settingLcThreshold')?.value),
      defaultTryJpy:Number($('settingTryJpy')?.value),
      defaultSwap:Number($('settingSwap')?.value)
    };
    const valid = Number.isFinite(next.capital) && next.capital >= 0 && Number.isFinite(next.unitsPerLot) && next.unitsPerLot > 0 && Number.isFinite(next.leverage) && next.leverage > 0 && Number.isFinite(next.lcThreshold) && next.lcThreshold > 0 && Number.isFinite(next.defaultTryJpy) && next.defaultTryJpy >= 0 && Number.isFinite(next.defaultSwap);
    if (!valid) { if (status) status.innerHTML = '<i></i> 入力値を確認'; return; }
    state.settings = next;
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    renderKpis(); renderOverviewPositions(); renderPositionTable(); renderDailyTable(); renderRiskFacts();
    requestAnimationFrame(renderActiveCharts);
    if (status) { status.classList.remove('saving'); status.innerHTML = '<i></i> 自動保存済み'; }
  }, 250);
}

function fillDailyForm(prefix, date = isoToday()) {
  const prev = getDailyOnOrBefore(date);
  if ($(prefix+'Date')) $(prefix+'Date').value = date;
  if ($(prefix+'TryJpy')) $(prefix+'TryJpy').value = prev?.tryJpy ?? state.settings.defaultTryJpy;
  if ($(prefix+'Swap')) $(prefix+'Swap').value = Number.isFinite(Number(prev?.swapPerLot)) ? prev.swapPerLot : state.settings.defaultSwap;
}
function saveDailyFrom(prefix) {
  const date = $(prefix+'Date')?.value;
  const rate = Number($(prefix+'Rate')?.value);
  const tryJpy = Number($(prefix+'TryJpy')?.value || state.settings.defaultTryJpy);
  const swapPerLot = Number($(prefix+'Swap')?.value || state.settings.defaultSwap);
  if (!date || !rate) { toast('日付とUSD/TRYを入力してください'); return false; }
  const row = { date, rate, tryJpy, swapPerLot };
  const idx = state.daily.findIndex((d) => d.date === date);
  if (idx >= 0) state.daily[idx] = row; else state.daily.push(row);
  calendarCursor = monthFromLatest();
  saveState(idx >= 0 ? '日次データを更新しました' : '日次データを保存しました');
  return true;
}
function openCloseDialog(id) {
  const p = state.positions.find((x) => x.id === id);
  if (!p) return;
  if ($('closePositionId')) $('closePositionId').value = id;
  if ($('closeDate')) $('closeDate').value = latestSnapshot()?.date || isoToday();
  if ($('closeRate')) $('closeRate').value = latestSnapshot()?.rate || '';
  $('closePositionDialog')?.showModal?.();
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}
function chartBase() {
  return {
    responsive:true,
    maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{ legend:{ labels:{ color:'#778291', boxWidth:8, boxHeight:8, usePointStyle:true, font:{size:9} } } },
    scales:{ x:{ grid:{display:false}, ticks:{color:'#56616f',maxTicksLimit:7,font:{size:8}} }, y:{ grid:{color:'rgba(120,135,150,.09)'}, ticks:{color:'#56616f',font:{size:8}} } }
  };
}
function renderOverviewChart() {
  if (activeTab !== 'overview' || typeof Chart === 'undefined' || !$('overviewChart')) return;
  destroyChart('overviewChart');
  const d = derivedDaily();
  const base = chartBase();
  base.scales.y.ticks.callback = (v) => overviewMode === 'pnl' ? `¥${Number(v).toLocaleString()}` : Number(v).toLocaleString();
  const datasets = overviewMode === 'pnl' ? [
    {label:'総損益',data:d.map(x=>x.total),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.06)',borderWidth:2.4,tension:.25,pointRadius:0,fill:true},
    {label:'為替差損益',data:d.map(x=>x.fxPnl),borderColor:'#67b3ff',borderWidth:1.6,tension:.25,pointRadius:0},
    {label:'累積Swap',data:d.map(x=>x.swap),borderColor:'#ffd166',borderWidth:1.6,tension:.25,pointRadius:0}
  ] : [
    {label:'保有lot',data:d.map(x=>x.lots),borderColor:'#67b3ff',backgroundColor:'rgba(103,179,255,.05)',borderWidth:2.2,tension:.2,pointRadius:0,fill:true}
  ];
  charts.overviewChart = new Chart($('overviewChart'), { type:'line', data:{labels:d.map(x=>x.date.slice(5)),datasets}, options:base });
}
function renderRiskCharts() {
  if (activeTab !== 'risk' || typeof Chart === 'undefined') return;
  const d = derivedDaily();
  if ($('lcChart')) {
    destroyChart('lcChart');
    charts.lcChart = new Chart($('lcChart'), { type:'line', data:{labels:d.map(x=>x.date.slice(5)),datasets:[{label:'USD/TRY',data:d.map(x=>x.rate),borderColor:'#f2f5f8',borderWidth:2,pointRadius:0},{label:'推定LC',data:d.map(x=>x.lc),borderColor:'#ff7582',borderDash:[5,5],borderWidth:1.6,pointRadius:0,spanGaps:true}]}, options:chartBase() });
  }
  if ($('maintenanceChart')) {
    destroyChart('maintenanceChart');
    const base = chartBase(); base.scales.y.ticks.callback = (v) => `${Number(v).toFixed(0)}%`;
    charts.maintenanceChart = new Chart($('maintenanceChart'), { type:'line', data:{labels:d.map(x=>x.date.slice(5)),datasets:[{label:'維持率',data:d.map(x=>Number.isFinite(x.maintenance)?x.maintenance:null),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.05)',borderWidth:2.1,pointRadius:0,fill:true},{label:`LC ${state.settings.lcThreshold}%`,data:d.map(()=>Number(state.settings.lcThreshold)),borderColor:'#ff7582',borderDash:[5,5],borderWidth:1.4,pointRadius:0}]}, options:base });
  }
}
function renderPositionChart(p) {
  if (activeTab !== 'positions' || typeof Chart === 'undefined' || !$('positionPnlChart')) return;
  destroyChart('positionPnlChart');
  const rows = derivedDaily().filter((d) => d.date >= p.date && (!p.closeDate || d.date <= p.closeDate)).map((d) => {
    const fx = positionFxAsOf(p,d.date,d.rate,d.tryJpy), swap = positionSwapAsOf(p,d.date); return {date:d.date,fx,swap,net:fx+swap};
  });
  const base = chartBase(); base.scales.y.ticks.callback = (v) => `¥${Number(v).toLocaleString()}`;
  charts.positionPnlChart = new Chart($('positionPnlChart'), { type:'line', data:{labels:rows.map(x=>x.date.slice(5)),datasets:[{label:'Net',data:rows.map(x=>x.net),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.05)',borderWidth:2.2,pointRadius:0,fill:true},{label:'FX',data:rows.map(x=>x.fx),borderColor:'#67b3ff',borderWidth:1.5,pointRadius:0},{label:'Swap',data:rows.map(x=>x.swap),borderColor:'#ffd166',borderWidth:1.5,pointRadius:0}]}, options:base });
}
function renderActiveCharts() {
  if (activeTab === 'overview') renderOverviewChart();
  if (activeTab === 'risk') renderRiskCharts();
  if (activeTab === 'positions') {
    const p = state.positions.find((x) => x.id === selectedPositionId);
    if (p) renderPositionChart(p);
  }
}

function download(name, text, type) {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('[data-go-tab]').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.goTab)));

  $('openSettingsBtn')?.addEventListener('click', openSettings);
  $('closeSettingsBtn')?.addEventListener('click', closeSettings);
  $('settingsBackdrop')?.addEventListener('click', closeSettings);
  document.querySelectorAll('.settings-list input').forEach((input) => input.addEventListener('input', scheduleSettingsSave));

  $('jumpAddPositionBtn')?.addEventListener('click', () => { switchTab('positions'); $('positionEditor')?.classList.remove('hidden'); });
  $('togglePositionFormBtn')?.addEventListener('click', () => $('positionEditor')?.classList.toggle('hidden'));

  document.querySelectorAll('#overviewChartMode button').forEach((btn) => btn.addEventListener('click', () => {
    overviewMode = btn.dataset.mode;
    document.querySelectorAll('#overviewChartMode button').forEach((x) => x.classList.toggle('active', x === btn));
    renderOverviewChart();
  }));

  $('positionForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = { id:uid(), date:$('positionDate')?.value, side:$('positionSide')?.value || 'short', entryRate:Number($('entryRate')?.value), lots:Number($('entryLots')?.value), memo:$('positionMemo')?.value.trim() || '', closeDate:null, closeRate:null };
    if (!p.date || !p.entryRate || !p.lots) { toast('約定日・レート・lotを入力してください'); return; }
    state.positions.push(p);
    selectedPositionId = p.id;
    e.target.reset();
    if ($('positionDate')) $('positionDate').value = isoToday();
    if ($('positionSide')) $('positionSide').value = 'short';
    $('positionEditor')?.classList.add('hidden');
    saveState('ポジションを追加しました');
  });

  $('dailyForm')?.addEventListener('submit', (e) => { e.preventDefault(); if (saveDailyFrom('daily')) { if ($('dailyRate')) $('dailyRate').value=''; fillDailyForm('daily'); } });
  $('quickDailyForm')?.addEventListener('submit', (e) => { e.preventDefault(); if (saveDailyFrom('quickDaily')) { if ($('quickDailyRate')) $('quickDailyRate').value=''; fillDailyForm('quickDaily'); } });

  $('prevMonthBtn')?.addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()-1, 1, 12); renderCalendar(); });
  $('nextMonthBtn')?.addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()+1, 1, 12); renderCalendar(); });

  $('openBackupBtn')?.addEventListener('click', () => { renderSettings(); $('backupDialog')?.showModal?.(); });
  $('closeBackupBtn')?.addEventListener('click', () => $('backupDialog')?.close?.());
  $('exportJsonBtn')?.addEventListener('click', () => download(`dollar-to-lira_${isoToday()}.json`, JSON.stringify(state,null,2), 'application/json'));
  $('exportCsvBtn')?.addEventListener('click', () => {
    const rows = derivedDaily();
    const head = ['date','usdtry','tryjpy','swap_per_lot','lots','fx_pnl_jpy','swap_jpy','total_pnl_jpy','daily_pnl_jpy','maintenance_pct','lc_rate'];
    const csv = [head.join(','), ...rows.map((r) => [r.date,r.rate,r.tryJpy,r.swapPerLot,r.lots,r.fxPnl,r.swap,r.total,r.dailyPnl,Number.isFinite(r.maintenance)?r.maintenance:'',r.lc||''].join(','))].join('\n');
    download(`dollar-to-lira_daily_${isoToday()}.csv`, csv, 'text/csv;charset=utf-8');
  });
  $('importJsonInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.positions) || !Array.isArray(data.daily)) throw new Error('invalid');
      state = { settings:{...DEFAULT_STATE.settings,...(data.settings||{})}, positions:data.positions, daily:data.daily, updatedAt:data.updatedAt||null };
      selectedPositionId = null; calendarCursor = monthFromLatest(); saveState('バックアップを復元しました'); $('backupDialog')?.close?.(); fillDefaults();
    } catch { toast('JSONを読み込めませんでした'); }
    e.target.value = '';
  });

  $('resetAllBtn')?.addEventListener('click', () => {
    if (!confirm('ポジション・日次履歴・設定をすべて初期化します。元に戻せません。')) return;
    state = clone(DEFAULT_STATE); selectedPositionId = null; calendarCursor = monthFromLatest(); saveState('全データを初期化しました'); closeSettings(); fillDefaults();
  });

  $('closePositionForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = state.positions.find((x) => x.id === $('closePositionId')?.value);
    const date = $('closeDate')?.value; const rate = Number($('closeRate')?.value);
    if (!p || !date || !rate) return;
    if (date < p.date) { toast('決済日は約定日以降にしてください'); return; }
    p.closeDate = date; p.closeRate = rate; $('closePositionDialog')?.close?.(); saveState('決済を保存しました');
  });
}

function fillDefaults() {
  if ($('positionDate')) $('positionDate').value = isoToday();
  if ($('positionSide')) $('positionSide').value = 'short';
  fillDailyForm('daily');
  fillDailyForm('quickDaily');
}

function bootstrap() {
  try {
    bindEvents();
    fillDefaults();
    renderAll();
    document.documentElement.dataset.appReady = '1';
  } catch (e) {
    console.error('bootstrap failed', e);
    const t = $('toast');
    if (t) { t.textContent = `初期化エラー: ${e.message}`; t.classList.add('show'); }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, {once:true});
else bootstrap();
