const STORE_KEY = 'dollar-to-lira:v1';
const DEFAULT_STATE = {
  settings: { capital: 500000, unitsPerLot: 10000, leverage: 25, lcThreshold: 100, defaultTryJpy: 3.25, defaultSwap: 0 },
  positions: [], daily: [], updatedAt: null
};

let state = loadState();
let charts = {};
let calendarCursor = latestCalendarMonth();
let activeTab = 'overview';
let overviewMode = 'pnl';
let selectedPositionId = null;
let settingsTimer = null;

const $ = id => document.getElementById(id);
const money = (v, digits = 0) => Number.isFinite(v) ? `${v < 0 ? '-' : ''}¥${Math.abs(v).toLocaleString('ja-JP',{maximumFractionDigits:digits})}` : '—';
const num = (v, digits = 2) => Number.isFinite(v) ? Number(v).toLocaleString('ja-JP',{maximumFractionDigits:digits}) : '—';
const rateFmt = v => Number.isFinite(v) ? Number(v).toLocaleString('ja-JP',{minimumFractionDigits:4,maximumFractionDigits:4}) : '—';
const isoToday = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone = obj => JSON.parse(JSON.stringify(obj));

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return clone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      settings:{...DEFAULT_STATE.settings,...(parsed.settings||{})},
      positions:Array.isArray(parsed.positions)?parsed.positions:[],
      daily:Array.isArray(parsed.daily)?parsed.daily:[],
      updatedAt:parsed.updatedAt||null
    };
  }catch{return clone(DEFAULT_STATE)}
}
function persist(message){
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY,JSON.stringify(state));
  renderAll();
  if(message) toast(message);
}
function toast(message){
  const el=$('toast'); el.textContent=message; el.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),1700);
}

function sortedDaily(){return [...state.daily].sort((a,b)=>a.date.localeCompare(b.date))}
function getDailyOnOrBefore(date){const rows=sortedDaily().filter(d=>d.date<=date);return rows[rows.length-1]||null}
function tryJpyAt(date){return Number(getDailyOnOrBefore(date)?.tryJpy||state.settings.defaultTryJpy)||0}
function positionOpenOn(p,date){return p.date<=date&&(!p.closeDate||p.closeDate>date)}
function openPositionsOnDate(date){return state.positions.filter(p=>positionOpenOn(p,date))}
function grossLotsOnDate(date){return openPositionsOnDate(date).reduce((s,p)=>s+Number(p.lots||0),0)}
function signedLotsOnDate(date){return openPositionsOnDate(date).reduce((s,p)=>s+(p.side==='short'?1:-1)*Number(p.lots||0),0)}
function weightedAvgEntry(date){
  const open=openPositionsOnDate(date), lots=open.reduce((s,p)=>s+Number(p.lots||0),0);
  return lots?open.reduce((s,p)=>s+Number(p.entryRate)*Number(p.lots),0)/lots:null;
}
function positionPnlJPY(p,markRate,markTryJpy){
  const units=Number(state.settings.unitsPerLot)*Number(p.lots||0), dir=p.side==='long'?1:-1;
  return (Number(markRate)-Number(p.entryRate))*units*dir*Number(markTryJpy);
}
function positionFxAsOf(p,date,markRate,markTryJpy){
  if(p.date>date) return 0;
  if(p.closeDate&&p.closeDate<=date){
    const tj=tryJpyAt(p.closeDate)||markTryJpy;
    return positionPnlJPY(p,Number(p.closeRate),tj);
  }
  return positionPnlJPY(p,markRate,markTryJpy);
}
function positionSwapAsOf(p,date){
  const sign=p.side==='short'?1:-1;
  return sortedDaily().filter(d=>d.date>=p.date&&d.date<=date&&(!p.closeDate||d.date<p.closeDate)).reduce((sum,d)=>{
    const perLot=Number.isFinite(Number(d.swapPerLot))?Number(d.swapPerLot):Number(state.settings.defaultSwap||0);
    return sum+sign*Number(p.lots)*perLot;
  },0);
}
function fxPnlAsOf(date,rate,tj){return state.positions.reduce((sum,p)=>sum+positionFxAsOf(p,date,rate,tj),0)}
function accruedSwapAsOf(date){return state.positions.reduce((sum,p)=>sum+positionSwapAsOf(p,date),0)}
function marginRequired(date,rate,tj){
  const units=grossLotsOnDate(date)*Number(state.settings.unitsPerLot);
  return units&&rate&&tj?units*Number(rate)*Number(tj)/Number(state.settings.leverage):0;
}
function equityAsOf(date,rate,tj){return Number(state.settings.capital)+fxPnlAsOf(date,rate,tj)+accruedSwapAsOf(date)}
function maintenanceAsOf(date,rate,tj){const m=marginRequired(date,rate,tj);return m>0?equityAsOf(date,rate,tj)/m*100:Infinity}
function findLcRate(date,currentRate,tj){
  if(!openPositionsOnDate(date).length||!currentRate||!tj) return null;
  const target=Number(state.settings.lcThreshold), f=x=>maintenanceAsOf(date,x,tj)-target;
  const low=Math.max(.0001,currentRate*.08),high=currentRate*5,steps=650;
  let px=low,pf=f(low),pairs=[];
  for(let i=1;i<=steps;i++){
    const x=low+(high-low)*i/steps,fx=f(x);
    if(Number.isFinite(pf)&&Number.isFinite(fx)&&pf*fx<=0)pairs.push([px,x]);
    px=x;pf=fx;
  }
  if(!pairs.length)return null;
  pairs.sort((a,b)=>Math.abs((a[0]+a[1])/2-currentRate)-Math.abs((b[0]+b[1])/2-currentRate));
  let [a,b]=pairs[0],fa=f(a);
  for(let i=0;i<65;i++){const m=(a+b)/2,fm=f(m);if(fa*fm<=0)b=m;else{a=m;fa=fm}}
  return(a+b)/2;
}
function derivedDaily(){
  let prevTotal=0;
  return sortedDaily().map(d=>{
    const rate=Number(d.rate),tj=Number(d.tryJpy||state.settings.defaultTryJpy),fxPnl=fxPnlAsOf(d.date,rate,tj),swap=accruedSwapAsOf(d.date),total=fxPnl+swap;
    const row={...d,rate,tryJpy:tj,fxPnl,swap,total,dailyPnl:total-prevTotal,lots:grossLotsOnDate(d.date),signedLots:signedLotsOnDate(d.date)};
    row.margin=marginRequired(d.date,rate,tj);row.maintenance=maintenanceAsOf(d.date,rate,tj);row.lc=findLcRate(d.date,rate,tj);prevTotal=total;return row;
  });
}
function latestSnapshot(){const rows=derivedDaily();return rows[rows.length-1]||null}
function latestCalendarMonth(){const rows=sortedDaily(),base=rows[rows.length-1]?.date||isoToday();return new Date(`${base.slice(0,7)}-01T12:00:00`)}
function latestMark(){
  const snap=latestSnapshot();
  return snap?{date:snap.date,rate:Number(snap.rate),tryJpy:Number(snap.tryJpy)}:{date:isoToday(),rate:null,tryJpy:Number(state.settings.defaultTryJpy)};
}
function positionSnapshot(p){
  const mark=latestMark(),asOf=p.closeDate&&p.closeDate<=mark.date?p.closeDate:mark.date;
  const rate=p.closeDate&&p.closeDate<=mark.date?Number(p.closeRate):mark.rate;
  const tj=p.closeDate&&p.closeDate<=mark.date?tryJpyAt(p.closeDate):mark.tryJpy;
  const fx=rate?positionFxAsOf(p,asOf,rate,tj):null,swap=positionSwapAsOf(p,asOf),net=fx===null?null:fx+swap;
  return{asOf,rate,tj,fx,swap,net,isOpen:!p.closeDate};
}

function setSigned(id,text,value){
  const el=$(id);el.textContent=text;el.classList.remove('positive-text','negative-text');
  if(Number.isFinite(value))el.classList.add(value>=0?'positive-text':'negative-text');
}
function renderKpis(){
  const snap=latestSnapshot(),date=snap?.date||isoToday(),lots=snap?snap.lots:grossLotsOnDate(date),units=lots*Number(state.settings.unitsPerLot),avg=weightedAvgEntry(date);
  setSigned('kpiTotalPnl',snap?money(snap.total):'—',snap?.total);$('kpiTotalPnlSub').textContent=snap?`Equity ${money(Number(state.settings.capital)+snap.total)}`:'FX + Swap';
  $('kpiLots').textContent=`${num(lots,2)} lot`;$('kpiUnits').textContent=`${Math.round(units).toLocaleString()} 通貨`;
  setSigned('kpiSwap',snap?money(snap.swap):'—',snap?.swap);$('kpiSwapDaily').textContent=snap?`直近 ${money((Number(snap.swapPerLot)||Number(state.settings.defaultSwap))*snap.signedLots)}/日`:'日次データ未入力';
  setSigned('kpiFxPnl',snap?money(snap.fxPnl):'—',snap?.fxPnl);$('kpiAvgEntry').textContent=avg?`平均 ${rateFmt(avg)}`:'建玉なし';
  setSigned('kpiMaintenance',snap?(Number.isFinite(snap.maintenance)?`${num(snap.maintenance,1)}%`:'∞'):'—',snap?Number(snap.maintenance)-Number(state.settings.lcThreshold):null);$('kpiMargin').textContent=snap?`必要 ${money(snap.margin)}`:'—';
  $('kpiLc').textContent=snap?.lc?rateFmt(snap.lc):'—';$('kpiLcDistance').textContent=snap?.lc?`現値比 ${((snap.lc/snap.rate-1)*100).toFixed(2)}%`:'計算対象なし';
  $('latestSnapshotLabel').textContent=snap?`${snap.date} · USD/TRY ${rateFmt(snap.rate)}`:'日次データ未入力';
}

function chartBase(){return{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},animation:{duration:220},plugins:{legend:{labels:{color:'#778291',boxWidth:8,boxHeight:8,usePointStyle:true,font:{size:9}}},tooltip:{backgroundColor:'#090c10',borderColor:'#28313d',borderWidth:1,titleColor:'#f2f5f8',bodyColor:'#98a3b0',padding:11}},scales:{x:{grid:{display:false},ticks:{color:'#56616f',maxTicksLimit:7,font:{size:8}}},y:{grid:{color:'rgba(120,135,150,.09)'},ticks:{color:'#56616f',font:{size:8}}}}}}
function makeChart(id,config){if(charts[id])charts[id].destroy();const canvas=$(id);if(canvas)charts[id]=new Chart(canvas,config)}
function renderOverviewChart(){
  if(typeof Chart==='undefined'||activeTab!=='overview')return;
  const d=derivedDaily(),labels=d.map(x=>x.date.slice(5)),base=chartBase();
  if(overviewMode==='pnl'){
    base.scales.y.ticks.callback=v=>`¥${Number(v).toLocaleString()}`;
    makeChart('overviewChart',{type:'line',data:{labels,datasets:[
      {label:'総損益',data:d.map(x=>x.total),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.06)',borderWidth:2.5,tension:.26,pointRadius:0,pointHoverRadius:4,fill:true},
      {label:'為替差損益',data:d.map(x=>x.fxPnl),borderColor:'#67b3ff',borderWidth:1.7,tension:.26,pointRadius:0},
      {label:'累積Swap',data:d.map(x=>x.swap),borderColor:'#ffd166',borderWidth:1.7,tension:.26,pointRadius:0}
    ]},options:base});
  }else{
    makeChart('overviewChart',{data:{labels,datasets:[
      {type:'line',label:'保有lot',data:d.map(x=>x.lots),borderColor:'#67b3ff',borderWidth:2.3,tension:.2,pointRadius:0,yAxisID:'y'},
      {type:'bar',label:'日次Swap',data:d.map(x=>(Number(x.swapPerLot)||Number(state.settings.defaultSwap))*x.signedLots),backgroundColor:'rgba(126,231,135,.38)',borderRadius:3,yAxisID:'y1'}
    ]},options:{...base,scales:{x:base.scales.x,y:{...base.scales.y,position:'left'},y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'#56616f',font:{size:8},callback:v=>`¥${Number(v).toLocaleString()}`}}}}});
  }
}
function renderRiskCharts(){
  if(typeof Chart==='undefined'||activeTab!=='risk')return;
  const d=derivedDaily(),labels=d.map(x=>x.date.slice(5));
  const b1=chartBase();b1.scales.y.ticks.callback=v=>Number(v).toFixed(2);
  makeChart('lcChart',{type:'line',data:{labels,datasets:[
    {label:'USD/TRY',data:d.map(x=>x.rate),borderColor:'#f2f5f8',borderWidth:2.2,tension:.2,pointRadius:0},
    {label:'推定LC',data:d.map(x=>x.lc),borderColor:'#ff7582',borderDash:[5,5],borderWidth:1.8,tension:.2,pointRadius:0,spanGaps:true}
  ]},options:b1});
  const b2=chartBase();b2.scales.y.ticks.callback=v=>`${Number(v).toFixed(0)}%`;
  makeChart('maintenanceChart',{type:'line',data:{labels,datasets:[
    {label:'維持率',data:d.map(x=>Number.isFinite(x.maintenance)?x.maintenance:null),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.05)',borderWidth:2.2,tension:.24,pointRadius:0,fill:true},
    {label:`LC ${state.settings.lcThreshold}%`,data:d.map(()=>Number(state.settings.lcThreshold)),borderColor:'#ff7582',borderDash:[5,5],borderWidth:1.4,pointRadius:0}
  ]},options:b2});
}
function positionSeries(p){
  return derivedDaily().filter(d=>d.date>=p.date&&(!p.closeDate||d.date<=p.closeDate)).map(d=>{
    const fx=positionFxAsOf(p,d.date,d.rate,d.tryJpy),swap=positionSwapAsOf(p,d.date);return{date:d.date,fx,swap,net:fx+swap};
  });
}
function renderPositionChart(p){
  if(typeof Chart==='undefined'||activeTab!=='positions')return;
  const d=positionSeries(p),base=chartBase();base.scales.y.ticks.callback=v=>`¥${Number(v).toLocaleString()}`;
  makeChart('positionPnlChart',{type:'line',data:{labels:d.map(x=>x.date.slice(5)),datasets:[
    {label:'Net',data:d.map(x=>x.net),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.05)',borderWidth:2.2,tension:.24,pointRadius:0,fill:true},
    {label:'FX',data:d.map(x=>x.fx),borderColor:'#67b3ff',borderWidth:1.5,tension:.24,pointRadius:0},
    {label:'Swap',data:d.map(x=>x.swap),borderColor:'#ffd166',borderWidth:1.5,tension:.24,pointRadius:0}
  ]},options:base});
}

function renderOverviewPositions(){
  const mark=latestMark(),open=state.positions.filter(p=>!p.closeDate).sort((a,b)=>b.date.localeCompare(a.date));
  if(!open.length){$('overviewPositionList').innerHTML='<div class="empty-state">保有中ポジションはありません。ポジションタブから追加してください。</div>';return}
  $('overviewPositionList').innerHTML=open.slice(0,6).map(p=>{
    const s=positionSnapshot(p);return`<div class="position-line" data-position-id="${p.id}"><div class="name"><strong>${p.side==='short'?'USD/TRY Short':'USD/TRY Long'} · ${num(Number(p.lots),2)} lot</strong><span>${p.date} · ${p.memo||'メモなし'}</span></div><div class="cell"><span>Entry</span><strong>${rateFmt(Number(p.entryRate))}</strong></div><div class="cell"><span>Current</span><strong>${rateFmt(mark.rate)}</strong></div><div class="cell"><span>FX</span><strong class="${(s.fx||0)>=0?'positive-text':'negative-text'}">${s.fx===null?'—':money(s.fx)}</strong></div><div class="cell"><span>Swap</span><strong class="${s.swap>=0?'positive-text':'negative-text'}">${money(s.swap)}</strong></div><div class="cell"><span>Net</span><strong class="${(s.net||0)>=0?'positive-text':'negative-text'}">${s.net===null?'—':money(s.net)}</strong></div></div>`
  }).join('');
  document.querySelectorAll('#overviewPositionList [data-position-id]').forEach(el=>el.addEventListener('click',()=>{selectedPositionId=el.dataset.positionId;switchTab('positions')}));
}
function renderPositionTable(){
  const rows=[...state.positions].sort((a,b)=>b.date.localeCompare(a.date));
  if(!rows.length){$('positionTableBody').innerHTML='<tr><td colspan="10" style="text-align:center;color:#596373;padding:36px">ポジションがありません</td></tr>';renderPositionDetail();return}
  $('positionTableBody').innerHTML=rows.map(p=>{
    const s=positionSnapshot(p),sel=p.id===selectedPositionId?'selected':'';
    return`<tr class="${sel}" data-position-id="${p.id}"><td>${p.date}</td><td><span class="side-pill ${p.side}">${p.side==='short'?'SHORT':'LONG'}</span></td><td>${rateFmt(Number(p.entryRate))}</td><td>${num(Number(p.lots),2)}</td><td>${rateFmt(s.rate)}</td><td class="${(s.fx||0)>=0?'positive-text':'negative-text'}">${s.fx===null?'—':money(s.fx)}</td><td class="${s.swap>=0?'positive-text':'negative-text'}">${money(s.swap)}</td><td class="${(s.net||0)>=0?'positive-text':'negative-text'}">${s.net===null?'—':money(s.net)}</td><td><span class="status-pill ${p.closeDate?'closed':'open'}">${p.closeDate?'CLOSED':'OPEN'}</span></td><td><button class="mini-btn" data-action="detail" data-id="${p.id}">詳細</button></td></tr>`
  }).join('');
  document.querySelectorAll('#positionTableBody tr[data-position-id]').forEach(tr=>tr.addEventListener('click',e=>{if(e.target.closest('button'))return;selectedPositionId=tr.dataset.positionId;renderPositionTable();renderPositionDetail()}));
  document.querySelectorAll('[data-action="detail"]').forEach(b=>b.addEventListener('click',()=>{selectedPositionId=b.dataset.id;renderPositionTable();renderPositionDetail()}));
  renderPositionDetail();
}
function renderPositionDetail(){
  const host=$('positionDetail'),p=state.positions.find(x=>x.id===selectedPositionId);
  if(!p){host.className='position-detail empty';host.innerHTML='<div class="detail-empty"><span>POSITION DETAIL</span><strong>ポジションを選択</strong><p>行をタップすると、そのポジションだけの損益推移・スワップ・詳細を表示します。</p></div>';return}
  const s=positionSnapshot(p),units=Number(p.lots)*Number(state.settings.unitsPerLot);
  host.className='position-detail';host.innerHTML=`<div class="detail-top"><div><span class="tag">${p.side==='short'?'SHORT POSITION':'LONG POSITION'}</span><h3>${num(Number(p.lots),2)} lot</h3></div><div class="detail-actions">${!p.closeDate?'<button class="mini-btn" id="detailCloseBtn">決済</button>':''}<button class="mini-btn danger" id="detailDeleteBtn">削除</button></div></div><div class="detail-net"><span>このポジションのNet損益</span><strong class="${(s.net||0)>=0?'positive-text':'negative-text'}">${s.net===null?'—':money(s.net)}</strong></div><div class="detail-grid"><div><span>FX損益</span><strong class="${(s.fx||0)>=0?'positive-text':'negative-text'}">${s.fx===null?'—':money(s.fx)}</strong></div><div><span>累積Swap</span><strong class="${s.swap>=0?'positive-text':'negative-text'}">${money(s.swap)}</strong></div><div><span>約定レート</span><strong>${rateFmt(Number(p.entryRate))}</strong></div><div><span>現在 / 決済</span><strong>${rateFmt(s.rate)}</strong></div><div><span>通貨数</span><strong>${Math.round(units).toLocaleString()}</strong></div><div><span>期間</span><strong>${p.date} → ${p.closeDate||s.asOf}</strong></div></div><div class="detail-chart-title">ポジション単体の累積損益</div><div class="detail-chart"><canvas id="positionPnlChart"></canvas></div>${p.memo?`<div class="detail-memo">${escapeHtml(p.memo)}</div>`:''}`;
  $('detailCloseBtn')?.addEventListener('click',()=>openCloseDialog(p.id));
  $('detailDeleteBtn').addEventListener('click',()=>{if(confirm('このポジションを削除しますか？')){state.positions=state.positions.filter(x=>x.id!==p.id);selectedPositionId=null;persist('ポジションを削除しました')}});
  requestAnimationFrame(()=>renderPositionChart(p));
}
function renderDailyTable(){
  const rows=[...derivedDaily()].reverse();
  $('dailyTableBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${r.date}</td><td>${rateFmt(r.rate)}</td><td>${rateFmt(r.tryJpy)}</td><td>${money(Number(r.swapPerLot||state.settings.defaultSwap))}</td><td>${num(r.lots,2)}</td><td class="${r.fxPnl>=0?'positive-text':'negative-text'}">${money(r.fxPnl)}</td><td class="${r.swap>=0?'positive-text':'negative-text'}">${money(r.swap)}</td><td class="${r.total>=0?'positive-text':'negative-text'}">${money(r.total)}</td><td class="${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</td><td><button class="mini-btn danger" data-delete-daily="${r.date}">削除</button></td></tr>`).join(''):'<tr><td colspan="10" style="text-align:center;color:#596373;padding:36px">日次データがありません</td></tr>';
  document.querySelectorAll('[data-delete-daily]').forEach(b=>b.addEventListener('click',()=>{if(confirm(`${b.dataset.deleteDaily} の日次データを削除しますか？`)){state.daily=state.daily.filter(d=>d.date!==b.dataset.deleteDaily);calendarCursor=latestCalendarMonth();persist('日次データを削除しました')}}));
}
function renderCalendar(){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),key=`${y}-${String(m+1).padStart(2,'0')}`;$('calendarTitle').textContent=`${y} / ${String(m+1).padStart(2,'0')}`;
  const map=new Map(derivedDaily().map(d=>[d.date,d])),monthRows=[...map.values()].filter(d=>d.date.startsWith(key)),maxAbs=Math.max(1,...monthRows.map(d=>Math.abs(d.dailyPnl)));
  const total=monthRows.reduce((s,r)=>s+r.dailyPnl,0),swap=monthRows.reduce((s,r)=>s+(Number(r.swapPerLot)||Number(state.settings.defaultSwap))*r.signedLots,0),positive=monthRows.filter(r=>r.dailyPnl>0).length,negative=monthRows.filter(r=>r.dailyPnl<0).length;
  $('calendarSummary').innerHTML=`<div><span>月間損益</span><strong class="${total>=0?'positive-text':'negative-text'}">${money(total)}</strong></div><div><span>Swap計</span><strong class="${swap>=0?'positive-text':'negative-text'}">${money(swap)}</strong></div><div><span>プラス日</span><strong>${positive}</strong></div><div><span>マイナス日</span><strong>${negative}</strong></div>`;
  const first=new Date(y,m,1,12),days=new Date(y,m+1,0,12).getDate(),offset=(first.getDay()+6)%7;let html='';
  for(let i=0;i<offset;i++)html+='<div class="calendar-day empty"></div>';
  for(let day=1;day<=days;day++){
    const date=`${key}-${String(day).padStart(2,'0')}`,r=map.get(date),cls=r?(r.dailyPnl>=0?'positive':'negative'):'',heat=r?Math.min(.18,.035+Math.abs(r.dailyPnl)/maxAbs*.145):0;
    html+=`<div class="calendar-day ${cls} ${date===isoToday()?'today':''}" style="--heat:${heat}"><span class="calendar-date">${day}</span>${r?`<div><div class="calendar-pnl ${r.dailyPnl>=0?'positive-text':'negative-text'}">${money(r.dailyPnl)}</div><div class="calendar-sub">Net ${money(r.total)} · ${num(r.lots,1)} lot</div></div>`:''}</div>`;
  }
  $('calendarGrid').innerHTML=html;
}
function renderRiskFacts(){
  const s=latestSnapshot();
  if(!s){$('riskFacts').innerHTML='<div class="risk-fact"><span>STATUS</span><strong>日次データ未入力</strong></div>';$('riskStatusLabel').textContent='日次データを入力してください';return}
  const equity=Number(state.settings.capital)+s.total,buffer=Number.isFinite(s.maintenance)?s.maintenance-Number(state.settings.lcThreshold):Infinity,dist=s.lc?(s.lc/s.rate-1)*100:null;
  $('riskStatusLabel').textContent=Number.isFinite(buffer)?`LC閾値まで +${num(buffer,1)}pt`:'建玉なし';
  $('riskFacts').innerHTML=`<div class="risk-fact"><span>口座純資産</span><strong>${money(equity)}</strong></div><div class="risk-fact"><span>必要証拠金</span><strong>${money(s.margin)}</strong></div><div class="risk-fact"><span>維持率</span><strong>${Number.isFinite(s.maintenance)?`${num(s.maintenance,1)}%`:'∞'}</strong></div><div class="risk-fact"><span>推定LC</span><strong>${s.lc?rateFmt(s.lc):'—'}</strong></div><div class="risk-fact"><span>現値→LC</span><strong>${dist===null?'—':`${dist>=0?'+':''}${dist.toFixed(2)}%`}</strong></div>`;
}
function renderSettings(){
  $('settingCapital').value=state.settings.capital;$('settingUnits').value=state.settings.unitsPerLot;$('settingLeverage').value=state.settings.leverage;$('settingLcThreshold').value=state.settings.lcThreshold;$('settingTryJpy').value=state.settings.defaultTryJpy;$('settingSwap').value=state.settings.defaultSwap;
  $('backupMeta').textContent=`ポジション ${state.positions.length}件 / 日次 ${state.daily.length}日 / 最終保存 ${state.updatedAt?new Date(state.updatedAt).toLocaleString('ja-JP'):'未保存'}`;
}
function renderAll(){renderKpis();renderOverviewPositions();renderPositionTable();renderDailyTable();renderCalendar();renderRiskFacts();renderSettings();requestAnimationFrame(renderActiveCharts)}
function renderActiveCharts(){if(activeTab==='overview')renderOverviewChart();if(activeTab==='risk')renderRiskCharts();if(activeTab==='positions'){const p=state.positions.find(x=>x.id===selectedPositionId);if(p)renderPositionChart(p)}}

function switchTab(name){
  activeTab=name;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  window.scrollTo({top:0,behavior:'smooth'});requestAnimationFrame(renderActiveCharts);
}
function fillDailyForm(prefix,date=isoToday()){
  const prev=getDailyOnOrBefore(date);$(prefix+'Date').value=date;$(prefix+'TryJpy').value=prev?.tryJpy||state.settings.defaultTryJpy;$(prefix+'Swap').value=Number.isFinite(Number(prev?.swapPerLot))?prev.swapPerLot:state.settings.defaultSwap;
}
function saveDailyFrom(prefix){
  const date=$(prefix+'Date').value,rate=Number($(prefix+'Rate').value),tryJpy=Number($(prefix+'TryJpy').value||state.settings.defaultTryJpy),swapPerLot=Number($(prefix+'Swap').value||state.settings.defaultSwap);
  if(!date||!rate){toast('日付とUSD/TRYを入力してください');return false}
  const row={date,rate,tryJpy,swapPerLot},idx=state.daily.findIndex(d=>d.date===date);if(idx>=0)state.daily[idx]=row;else state.daily.push(row);calendarCursor=latestCalendarMonth();persist(idx>=0?'日次データを更新しました':'日次データを保存しました');return true;
}
function openSettings(){renderSettings();$('settingsDrawer').classList.add('show');$('settingsBackdrop').classList.add('show');$('settingsDrawer').setAttribute('aria-hidden','false')}
function closeSettings(){$('settingsDrawer').classList.remove('show');$('settingsBackdrop').classList.remove('show');$('settingsDrawer').setAttribute('aria-hidden','true')}
function scheduleSettingsSave(){
  const status=$('settingsSaveStatus');status.classList.add('saving');status.innerHTML='<i></i> 保存中…';clearTimeout(settingsTimer);settingsTimer=setTimeout(()=>{
    const next={capital:Number($('settingCapital').value),unitsPerLot:Number($('settingUnits').value),leverage:Number($('settingLeverage').value),lcThreshold:Number($('settingLcThreshold').value),defaultTryJpy:Number($('settingTryJpy').value),defaultSwap:Number($('settingSwap').value)};
    if(!Number.isFinite(next.capital)||next.capital<0||!Number.isFinite(next.unitsPerLot)||next.unitsPerLot<=0||!Number.isFinite(next.leverage)||next.leverage<=0||!Number.isFinite(next.lcThreshold)||next.lcThreshold<=0||!Number.isFinite(next.defaultTryJpy)||next.defaultTryJpy<0){status.innerHTML='<i></i> 入力値を確認';return}
    state.settings=next;state.updatedAt=new Date().toISOString();localStorage.setItem(STORE_KEY,JSON.stringify(state));renderKpis();renderOverviewPositions();renderPositionTable();renderDailyTable();renderRiskFacts();requestAnimationFrame(renderActiveCharts);status.classList.remove('saving');status.innerHTML='<i></i> 自動保存済み';
  },350);
}
function openCloseDialog(id){const p=state.positions.find(x=>x.id===id);if(!p)return;$('closePositionId').value=id;$('closeDate').value=latestSnapshot()?.date||isoToday();$('closeRate').value=latestSnapshot()?.rate||'';$('closePositionDialog').showModal()}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function download(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}

function bindEvents(){
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));document.querySelectorAll('[data-go-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.goTab)));
  $('jumpAddPositionBtn').addEventListener('click',()=>{switchTab('positions');$('positionEditor').classList.remove('hidden')});$('togglePositionFormBtn').addEventListener('click',()=>$('positionEditor').classList.toggle('hidden'));
  document.querySelectorAll('#overviewChartMode button').forEach(b=>b.addEventListener('click',()=>{overviewMode=b.dataset.mode;document.querySelectorAll('#overviewChartMode button').forEach(x=>x.classList.toggle('active',x===b));renderOverviewChart()}));
  $('positionForm').addEventListener('submit',e=>{e.preventDefault();const p={id:uid(),date:$('positionDate').value,side:$('positionSide').value,entryRate:Number($('entryRate').value),lots:Number($('entryLots').value),memo:$('positionMemo').value.trim(),closeDate:null,closeRate:null};if(!p.date||!p.entryRate||!p.lots)return;state.positions.push(p);selectedPositionId=p.id;e.target.reset();$('positionDate').value=isoToday();$('positionSide').value='short';$('positionEditor').classList.add('hidden');persist('ポジションを追加しました')});
  $('dailyForm').addEventListener('submit',e=>{e.preventDefault();if(saveDailyFrom('daily')){$('dailyRate').value='';fillDailyForm('daily',isoToday())}});$('quickDailyForm').addEventListener('submit',e=>{e.preventDefault();if(saveDailyFrom('quickDaily')){$('quickDailyRate').value='';fillDailyForm('quickDaily',isoToday())}});
  $('prevMonthBtn').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1,12);renderCalendar()});$('nextMonthBtn').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1,12);renderCalendar()});
  $('openSettingsBtn').addEventListener('click',openSettings);$('closeSettingsBtn').addEventListener('click',closeSettings);$('settingsBackdrop').addEventListener('click',closeSettings);document.querySelectorAll('.settings-list input').forEach(i=>i.addEventListener('input',scheduleSettingsSave));
  $('resetAllBtn').addEventListener('click',()=>{if(confirm('ポジション・日次履歴・設定をすべて初期化します。元に戻せません。')){state=clone(DEFAULT_STATE);selectedPositionId=null;calendarCursor=latestCalendarMonth();persist('全データを初期化しました');closeSettings();fillDefaults()}});
  $('openBackupBtn').addEventListener('click',()=>{renderSettings();$('backupDialog').showModal()});$('closeBackupBtn').addEventListener('click',()=>$('backupDialog').close());$('exportJsonBtn').addEventListener('click',()=>download(`dollar-to-lira_${isoToday()}.json`,JSON.stringify(state,null,2),'application/json'));
  $('exportCsvBtn').addEventListener('click',()=>{const rows=derivedDaily(),head=['date','usdtry','tryjpy','swap_per_lot','lots','fx_pnl_jpy','swap_jpy','total_pnl_jpy','daily_pnl_jpy','maintenance_pct','lc_rate'];const csv=[head.join(','),...rows.map(r=>[r.date,r.rate,r.tryJpy,r.swapPerLot,r.lots,r.fxPnl,r.swap,r.total,r.dailyPnl,Number.isFinite(r.maintenance)?r.maintenance:'',r.lc||''].join(','))].join('\n');download(`dollar-to-lira_daily_${isoToday()}.csv`,csv,'text/csv;charset=utf-8')});
  $('importJsonInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!data||!Array.isArray(data.positions)||!Array.isArray(data.daily))throw new Error();state={settings:{...DEFAULT_STATE.settings,...(data.settings||{})},positions:data.positions,daily:data.daily,updatedAt:data.updatedAt||null};selectedPositionId=null;calendarCursor=latestCalendarMonth();persist('バックアップを復元しました');$('backupDialog').close();fillDefaults()}catch{toast('JSONを読み込めませんでした')}e.target.value=''});
  $('closePositionForm').addEventListener('submit',e=>{e.preventDefault();const p=state.positions.find(x=>x.id===$('closePositionId').value),date=$('closeDate').value,rate=Number($('closeRate').value);if(!p||!date||!rate)return;if(date<p.date){toast('決済日は約定日以降にしてください');return}p.closeDate=date;p.closeRate=rate;$('closePositionDialog').close();persist('決済を保存しました')});
  window.addEventListener('resize',()=>Object.values(charts).forEach(c=>c?.resize?.()));
}
function fillDefaults(){$('positionDate').value=isoToday();$('positionSide').value='short';fillDailyForm('daily',isoToday());fillDailyForm('quickDaily',isoToday())}

bindEvents();fillDefaults();renderAll();
