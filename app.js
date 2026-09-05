const STORE_KEY = 'dollar-to-lira:v1';
const DEFAULT_STATE = {
  settings: { capital: 500000, unitsPerLot: 10000, leverage: 25, lcThreshold: 100, defaultTryJpy: 3.25, defaultSwap: 0 },
  positions: [],
  daily: [],
  updatedAt: null
};

let state = loadState();
let charts = {};
let calendarCursor = latestCalendarMonth();

const $ = (id) => document.getElementById(id);
const money = (v, digits = 0) => Number.isFinite(v) ? `${v < 0 ? '-' : ''}¥${Math.abs(v).toLocaleString('ja-JP', { maximumFractionDigits: digits })}` : '—';
const num = (v, digits = 2) => Number.isFinite(v) ? v.toLocaleString('ja-JP', { maximumFractionDigits: digits }) : '—';
const rateFmt = (v) => Number.isFinite(v) ? v.toLocaleString('ja-JP', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—';
const isoToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
function loadState(){
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
  } catch { return clone(DEFAULT_STATE); }
}
function saveState(message = '保存しました'){
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  renderAll();
  toast(message);
}
function toast(message){
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

function sortedDaily(){ return [...state.daily].sort((a,b) => a.date.localeCompare(b.date)); }
function dailyMap(){ return new Map(sortedDaily().map(d => [d.date, d])); }
function getDailyOnOrBefore(date){
  const list = sortedDaily().filter(d => d.date <= date);
  return list[list.length - 1] || null;
}
function tryJpyAt(date){ return Number(getDailyOnOrBefore(date)?.tryJpy || state.settings.defaultTryJpy) || 0; }
function signedLotsOnDate(date){
  return state.positions.reduce((sum,p) => {
    if (p.date > date || (p.closeDate && p.closeDate <= date)) return sum;
    return sum + (p.side === 'short' ? Number(p.lots) : -Number(p.lots));
  }, 0);
}
function grossLotsOnDate(date){
  return state.positions.reduce((sum,p) => {
    if (p.date > date || (p.closeDate && p.closeDate <= date)) return sum;
    return sum + Number(p.lots || 0);
  }, 0);
}
function openPositionsOnDate(date){
  return state.positions.filter(p => p.date <= date && (!p.closeDate || p.closeDate > date));
}
function positionPnlJPY(p, markRate, markTryJpy){
  const units = Number(state.settings.unitsPerLot) * Number(p.lots);
  const dir = p.side === 'long' ? 1 : -1;
  return (Number(markRate) - Number(p.entryRate)) * units * dir * Number(markTryJpy);
}
function fxPnlAsOf(date, currentRate, currentTryJpy){
  let total = 0;
  for (const p of state.positions) {
    if (p.date > date) continue;
    if (p.closeDate && p.closeDate <= date) {
      const tj = tryJpyAt(p.closeDate) || currentTryJpy;
      total += positionPnlJPY(p, Number(p.closeRate), tj);
    } else {
      total += positionPnlJPY(p, currentRate, currentTryJpy);
    }
  }
  return total;
}
function accruedSwapAsOf(date){
  return sortedDaily().filter(d => d.date <= date).reduce((sum,d) => {
    const signedLots = signedLotsOnDate(d.date);
    const perLot = Number.isFinite(Number(d.swapPerLot)) ? Number(d.swapPerLot) : Number(state.settings.defaultSwap || 0);
    return sum + signedLots * perLot;
  }, 0);
}
function marginRequired(date, rate, tryJpy){
  const lots = grossLotsOnDate(date);
  const units = lots * Number(state.settings.unitsPerLot);
  if (!units || !rate || !tryJpy) return 0;
  return units * Number(rate) * Number(tryJpy) / Number(state.settings.leverage);
}
function equityAsOf(date, rate, tryJpy){
  return Number(state.settings.capital) + fxPnlAsOf(date, rate, tryJpy) + accruedSwapAsOf(date);
}
function maintenanceAsOf(date, rate, tryJpy){
  const margin = marginRequired(date, rate, tryJpy);
  return margin > 0 ? equityAsOf(date, rate, tryJpy) / margin * 100 : Infinity;
}
function weightedAvgEntry(date){
  const open = openPositionsOnDate(date);
  const lots = open.reduce((s,p)=>s+Number(p.lots),0);
  if (!lots) return null;
  return open.reduce((s,p)=>s+Number(p.entryRate)*Number(p.lots),0)/lots;
}
function findLcRate(date, currentRate, tryJpy){
  const open = openPositionsOnDate(date);
  if (!open.length || !currentRate || !tryJpy) return null;
  const target = Number(state.settings.lcThreshold);
  const f = (x) => maintenanceAsOf(date, x, tryJpy) - target;
  const low = Math.max(0.0001, currentRate * 0.08), high = currentRate * 5;
  const steps = 700;
  let prevX = low, prevF = f(low), candidates = [];
  for (let i=1;i<=steps;i++) {
    const x = low + (high-low) * i/steps, fx = f(x);
    if (Number.isFinite(prevF) && Number.isFinite(fx) && prevF * fx <= 0) candidates.push([prevX,x]);
    prevX = x; prevF = fx;
  }
  if (!candidates.length) return null;
  candidates.sort((a,b) => Math.abs((a[0]+a[1])/2-currentRate)-Math.abs((b[0]+b[1])/2-currentRate));
  let [a,b] = candidates[0], fa = f(a);
  for (let i=0;i<70;i++) {
    const m=(a+b)/2, fm=f(m);
    if (fa*fm<=0) b=m; else { a=m; fa=fm; }
  }
  return (a+b)/2;
}

function derivedDaily(){
  const list = sortedDaily();
  let prevTotal = 0;
  return list.map(d => {
    const tj = Number(d.tryJpy || state.settings.defaultTryJpy);
    const rate = Number(d.rate);
    const fxPnl = fxPnlAsOf(d.date, rate, tj);
    const swap = accruedSwapAsOf(d.date);
    const total = fxPnl + swap;
    const lots = grossLotsOnDate(d.date);
    const signedLots = signedLotsOnDate(d.date);
    const margin = marginRequired(d.date, rate, tj);
    const maintenance = maintenanceAsOf(d.date, rate, tj);
    const lc = findLcRate(d.date, rate, tj);
    const row = { ...d, tryJpy:tj, fxPnl, swap, total, dailyPnl: total-prevTotal, lots, signedLots, margin, maintenance, lc };
    prevTotal = total;
    return row;
  });
}

function latestSnapshot(){ const d = derivedDaily(); return d[d.length-1] || null; }
function latestCalendarMonth(){
  const list = sortedDaily();
  const base = list[list.length-1]?.date || isoToday();
  return new Date(`${base.slice(0,7)}-01T12:00:00`);
}

function renderKpis(){
  const snap = latestSnapshot();
  const today = snap?.date || isoToday();
  const lots = snap ? snap.lots : grossLotsOnDate(today);
  const units = lots * Number(state.settings.unitsPerLot);
  const avg = weightedAvgEntry(today);
  setValue('kpiLots', `${num(lots,2)} lot`);
  setValue('kpiUnits', `${Math.round(units).toLocaleString()} 通貨`);
  setValue('kpiTotalPnl', snap ? money(snap.total) : '—', snap?.total);
  setValue('kpiSwap', snap ? money(snap.swap) : '—', snap?.swap);
  setValue('kpiSwapDaily', snap ? `直近 ${money((Number(snap.swapPerLot)||Number(state.settings.defaultSwap))*snap.signedLots)}/日` : '日次データ未入力');
  setValue('kpiFxPnl', snap ? money(snap.fxPnl) : '—', snap?.fxPnl);
  setValue('kpiAvgEntry', avg ? `平均約定 ${rateFmt(avg)}` : '建玉なし');
  setValue('kpiMaintenance', snap ? (Number.isFinite(snap.maintenance) ? `${num(snap.maintenance,1)}%` : '∞') : '—', snap ? snap.maintenance-Number(state.settings.lcThreshold) : null);
  setValue('kpiMargin', snap ? `必要証拠金 ${money(snap.margin)}` : '—');
  setValue('kpiLc', snap?.lc ? rateFmt(snap.lc) : '—');
  setValue('kpiLcDistance', snap?.lc ? `現値から ${((snap.lc/Number(snap.rate)-1)*100).toFixed(2)}%` : '計算対象なし');
}
function setValue(id, text, sign){
  const el=$(id); el.textContent=text; el.classList.remove('positive-text','negative-text');
  if (Number.isFinite(sign)) el.classList.add(sign>=0?'positive-text':'negative-text');
}

function chartBase(){
  return {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    animation:{duration:280},
    plugins:{
      legend:{labels:{color:'#7d8a9e',boxWidth:9,boxHeight:9,usePointStyle:true,font:{size:10}}},
      tooltip:{backgroundColor:'#0a0f16',borderColor:'#2a3648',borderWidth:1,titleColor:'#f5f7fb',bodyColor:'#9aa7ba',padding:12,displayColors:true}
    },
    scales:{x:{grid:{display:false},ticks:{color:'#5e6b7d',maxTicksLimit:7,font:{size:9}}},y:{grid:{color:'rgba(115,130,150,.10)'},ticks:{color:'#5e6b7d',font:{size:9}}}}
  };
}
function makeChart(id, config){
  if (charts[id]) charts[id].destroy();
  charts[id]=new Chart($(id),config);
}
function renderCharts(){
  if (typeof Chart === 'undefined') return;
  const d=derivedDaily(), labels=d.map(x=>x.date.slice(5));
  const base1=chartBase(); base1.scales.y.ticks.callback=(v)=>`¥${Number(v).toLocaleString()}`;
  makeChart('pnlChart',{type:'line',data:{labels,datasets:[
    {label:'為替差損益',data:d.map(x=>x.fxPnl),borderColor:'#52a8ff',backgroundColor:'rgba(82,168,255,.08)',borderWidth:2,tension:.28,pointRadius:0,pointHoverRadius:4},
    {label:'累積スワップ',data:d.map(x=>x.swap),borderColor:'#ffd166',backgroundColor:'rgba(255,209,102,.06)',borderWidth:2,tension:.28,pointRadius:0,pointHoverRadius:4},
    {label:'総損益',data:d.map(x=>x.total),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.08)',borderWidth:2.5,tension:.28,pointRadius:0,pointHoverRadius:4,fill:true}
  ]},options:base1});

  const base2=chartBase();
  makeChart('lotSwapChart',{data:{labels,datasets:[
    {type:'line',label:'保有lot',data:d.map(x=>x.lots),borderColor:'#52a8ff',backgroundColor:'rgba(82,168,255,.08)',yAxisID:'y',borderWidth:2.3,tension:.25,pointRadius:0},
    {type:'bar',label:'日次スワップ',data:d.map(x=>(Number(x.swapPerLot)||Number(state.settings.defaultSwap))*x.signedLots),backgroundColor:'rgba(126,231,135,.42)',borderRadius:5,yAxisID:'y1'}
  ]},options:{...base2,scales:{x:base2.scales.x,y:{...base2.scales.y,position:'left',title:{display:true,text:'lot',color:'#566479',font:{size:9}}},y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'#5e6b7d',font:{size:9},callback:v=>`¥${Number(v).toLocaleString()}`}}}}});

  const base3=chartBase(); base3.scales.y.ticks.callback=v=>Number(v).toFixed(2);
  makeChart('lcChart',{type:'line',data:{labels,datasets:[
    {label:'USD/TRY',data:d.map(x=>Number(x.rate)),borderColor:'#f5f7fb',borderWidth:2.3,tension:.22,pointRadius:0},
    {label:'推定LC',data:d.map(x=>x.lc),borderColor:'#ff6b7a',borderDash:[6,5],borderWidth:2,tension:.2,pointRadius:0,spanGaps:true}
  ]},options:base3});

  const base4=chartBase(); base4.scales.y.ticks.callback=v=>`${Number(v).toFixed(0)}%`;
  makeChart('maintenanceChart',{type:'line',data:{labels,datasets:[
    {label:'維持率',data:d.map(x=>Number.isFinite(x.maintenance)?x.maintenance:null),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.08)',borderWidth:2.4,tension:.25,pointRadius:0,fill:true},
    {label:`LC ${state.settings.lcThreshold}%`,data:d.map(()=>Number(state.settings.lcThreshold)),borderColor:'#ff6b7a',borderDash:[5,5],borderWidth:1.5,pointRadius:0}
  ]},options:base4});
}

function renderCalendar(){
  const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth();
  $('calendarTitle').textContent=`${y} / ${String(m+1).padStart(2,'0')}`;
  const first=new Date(y,m,1,12), days=new Date(y,m+1,0,12).getDate();
  const offset=(first.getDay()+6)%7;
  const dmap=new Map(derivedDaily().map(d=>[d.date,d]));
  const monthRows=[...dmap.values()].filter(d=>d.date.startsWith(`${y}-${String(m+1).padStart(2,'0')}`));
  const maxAbs=Math.max(1,...monthRows.map(d=>Math.abs(d.dailyPnl)));
  let html='';
  for(let i=0;i<offset;i++) html+='<div class="calendar-day empty"></div>';
  for(let day=1;day<=days;day++){
    const date=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const r=dmap.get(date), cls=r?(r.dailyPnl>=0?'positive':'negative'):'';
    const heat=r?Math.min(.22,.055+Math.abs(r.dailyPnl)/maxAbs*.18):0;
    html+=`<div class="calendar-day ${cls} ${date===isoToday()?'today':''}" style="--heat:${heat}"><span class="calendar-date">${day}</span>${r?`<strong class="calendar-pnl ${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</strong><span class="calendar-sub">累計 ${money(r.total)}</span>`:'<span class="calendar-sub">—</span>'}</div>`;
  }
  $('calendarGrid').innerHTML=html;
}

function renderTables(){
  const pos=[...state.positions].sort((a,b)=>b.date.localeCompare(a.date));
  $('positionCount').textContent=`${pos.length}件`;
  $('positionTableBody').innerHTML=pos.length?pos.map(p=>`<tr>
    <td>${p.date}</td><td><span class="side-pill ${p.side}">${p.side==='short'?'売り':'買い'}</span></td><td>${rateFmt(Number(p.entryRate))}</td><td>${num(Number(p.lots),2)}</td>
    <td><span class="status-pill ${p.closeDate?'closed':'open'}">${p.closeDate?`${p.closeDate} 決済`:'OPEN'}</span></td><td>${escapeHtml(p.memo||'—')}</td>
    <td><div class="row-actions">${p.closeDate?'':`<button class="mini-btn" data-close="${p.id}">決済</button>`}<button class="mini-btn danger" data-delpos="${p.id}">削除</button></div></td></tr>`).join(''):'<tr class="empty-row"><td colspan="7">ポジションはまだありません</td></tr>';

  const daily=derivedDaily().reverse();
  $('dailyCount').textContent=`${daily.length}日`;
  $('dailyTableBody').innerHTML=daily.length?daily.map(d=>`<tr><td>${d.date}</td><td>${rateFmt(Number(d.rate))}</td><td>${rateFmt(Number(d.tryJpy))}</td><td>${money(Number(d.swapPerLot||0))}</td><td>${num(d.lots,2)}</td><td class="${d.total>=0?'positive-text':'negative-text'}">${money(d.total)}</td><td><button class="mini-btn danger" data-deldaily="${d.date}">削除</button></td></tr>`).join(''):'<tr class="empty-row"><td colspan="7">日次データはまだありません</td></tr>';
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function renderSettings(){
  $('settingCapital').value=state.settings.capital;
  $('settingUnits').value=state.settings.unitsPerLot;
  $('settingLeverage').value=state.settings.leverage;
  $('settingLcThreshold').value=state.settings.lcThreshold;
  $('settingTryJpy').value=state.settings.defaultTryJpy;
  $('settingSwap').value=state.settings.defaultSwap;
}
function renderBackupMeta(){
  const bytes=new Blob([JSON.stringify(state)]).size;
  $('backupMeta').innerHTML=`ポジション ${state.positions.length}件 / 日次データ ${state.daily.length}日<br>最終保存: ${state.updatedAt?new Date(state.updatedAt).toLocaleString('ja-JP'):'未保存'} / 約 ${(bytes/1024).toFixed(1)} KB`;
}
function renderAll(){ renderKpis(); renderCalendar(); renderTables(); renderSettings(); renderBackupMeta(); renderCharts(); }

function download(name, content, type){
  const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJson(){ download(`dollar-to-lira-backup-${isoToday()}.json`,JSON.stringify(state,null,2),'application/json'); toast('JSONバックアップを保存しました'); }
function exportCsv(){
  const rows=derivedDaily();
  const header=['date','usdtry','tryjpy','swap_per_lot_jpy','gross_lots','fx_pnl_jpy','accrued_swap_jpy','total_pnl_jpy','daily_pnl_jpy','margin_jpy','maintenance_pct','lc_rate'];
  const lines=[header.join(','),...rows.map(r=>[r.date,r.rate,r.tryJpy,r.swapPerLot,r.lots,Math.round(r.fxPnl),Math.round(r.swap),Math.round(r.total),Math.round(r.dailyPnl),Math.round(r.margin),Number.isFinite(r.maintenance)?r.maintenance.toFixed(4):'',r.lc?r.lc.toFixed(6):''].join(','))];
  download(`dollar-to-lira-daily-${isoToday()}.csv`,lines.join('\n'),'text/csv;charset=utf-8'); toast('CSVを保存しました');
}

function bindEvents(){
  $('positionDate').value=isoToday(); $('dailyDate').value=isoToday(); $('closeDate').value=isoToday();
  $('dailyTryJpy').value=state.settings.defaultTryJpy; $('dailySwap').value=state.settings.defaultSwap;

  $('positionForm').addEventListener('submit',e=>{
    e.preventDefault();
    state.positions.push({id:uid(),date:$('positionDate').value,side:$('positionSide').value,entryRate:Number($('entryRate').value),lots:Number($('entryLots').value),memo:$('positionMemo').value.trim(),closeDate:null,closeRate:null});
    $('entryRate').value=''; $('entryLots').value=''; $('positionMemo').value=''; saveState('ポジションを追加しました');
  });
  $('dailyForm').addEventListener('submit',e=>{
    e.preventDefault(); const date=$('dailyDate').value;
    const row={date,rate:Number($('dailyRate').value),tryJpy:Number($('dailyTryJpy').value)||Number(state.settings.defaultTryJpy),swapPerLot:$('dailySwap').value===''?Number(state.settings.defaultSwap):Number($('dailySwap').value)};
    const ix=state.daily.findIndex(d=>d.date===date); if(ix>=0) state.daily[ix]=row; else state.daily.push(row);
    calendarCursor=new Date(`${date.slice(0,7)}-01T12:00:00`); saveState(ix>=0?'日次データを更新しました':'日次データを追加しました');
  });
  $('settingsForm').addEventListener('submit',e=>{
    e.preventDefault();
    state.settings={capital:Number($('settingCapital').value),unitsPerLot:Number($('settingUnits').value),leverage:Number($('settingLeverage').value),lcThreshold:Number($('settingLcThreshold').value),defaultTryJpy:Number($('settingTryJpy').value),defaultSwap:Number($('settingSwap').value)};
    $('settingsDialog').close(); saveState('設定を保存しました');
  });
  $('openSettingsBtn').onclick=()=>{renderSettings();$('settingsDialog').showModal();};
  $('openBackupBtn').onclick=()=>{renderBackupMeta();$('backupDialog').showModal();};
  $('closeBackupBtn').onclick=()=> $('backupDialog').close();
  $('exportJsonBtn').onclick=exportJson; $('exportCsvBtn').onclick=exportCsv;
  $('importJsonInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file) return;
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed || !Array.isArray(parsed.positions) || !Array.isArray(parsed.daily)) throw new Error('format');
      state={settings:{...DEFAULT_STATE.settings,...(parsed.settings||{})},positions:parsed.positions,daily:parsed.daily,updatedAt:parsed.updatedAt||null};
      calendarCursor=latestCalendarMonth(); $('backupDialog').close(); saveState('バックアップを復元しました');
    }catch{toast('JSONを読み込めませんでした');}
    e.target.value='';
  });
  $('resetAllBtn').onclick=()=>{
    if(!confirm('すべてのローカルデータを削除します。バックアップ済みですか？')) return;
    state=clone(DEFAULT_STATE); localStorage.removeItem(STORE_KEY); calendarCursor=latestCalendarMonth(); $('settingsDialog').close(); saveState('全データを初期化しました');
  };
  $('prevMonthBtn').onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1,12);renderCalendar();};
  $('nextMonthBtn').onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1,12);renderCalendar();};
  document.addEventListener('click',e=>{
    const closeId=e.target.dataset?.close, delPos=e.target.dataset?.delpos, delDaily=e.target.dataset?.deldaily;
    if(closeId){$('closePositionId').value=closeId;$('closeDate').value=isoToday();$('closeRate').value=latestSnapshot()?.rate||'';$('closePositionDialog').showModal();}
    if(delPos && confirm('このポジションを削除しますか？')){state.positions=state.positions.filter(p=>p.id!==delPos);saveState('ポジションを削除しました');}
    if(delDaily && confirm(`${delDaily} の日次データを削除しますか？`)){state.daily=state.daily.filter(d=>d.date!==delDaily);saveState('日次データを削除しました');}
  });
  $('closePositionForm').addEventListener('submit',e=>{
    e.preventDefault(); const id=$('closePositionId').value,p=state.positions.find(x=>x.id===id); if(!p)return;
    p.closeDate=$('closeDate').value;p.closeRate=Number($('closeRate').value);$('closePositionDialog').close();saveState('決済を記録しました');
  });
  window.addEventListener('storage',e=>{if(e.key===STORE_KEY){state=loadState();renderAll();toast('別タブの変更を反映しました');}});
}

document.addEventListener('DOMContentLoaded',()=>{bindEvents();renderAll();});
