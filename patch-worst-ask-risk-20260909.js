// Owner-published Hirose ASK risk overlay.
// usdTryAskDayHigh is the calendar-day maximum ASK: adverse reference for USD/TRY shorts.
(() => {
  const root = document.documentElement;
  if (root.dataset.worstAskRisk === '1') return;

  const publishedRateAt = (date) => {
    try {
      const row = window.__DTL_HIROSE_RATE_AT__?.(date) || null;
      return row && row.date === date ? row : null;
    } catch (_) {
      return null;
    }
  };

  const worstAskAt = (date) => {
    const value = Number(publishedRateAt(date)?.usdTryAskDayHigh);
    return value > 0 ? value : null;
  };

  const installPublisherEntry = () => {
    if ($('openRatePublisherBtn')) return;
    const head = document.querySelector('#view-daily .section-head');
    if (!head) return;
    const button = document.createElement('button');
    button.id = 'openRatePublisherBtn';
    button.type = 'button';
    button.className = 'outline-btn';
    button.textContent = 'ヒロセレート配信';
    button.style.cssText = 'min-height:34px;padding:7px 11px;font-size:11px;margin-left:auto';
    button.addEventListener('click', () => { window.location.href = './publish.html'; });
    const meta = head.querySelector('.section-meta');
    if (meta) meta.before(button); else head.appendChild(button);
  };

  const baseRenderRiskChartsWorstAsk = renderRiskCharts;
  renderRiskCharts = function() {
    if (activeTab !== 'risk' || typeof Chart === 'undefined') return;
    const d = derivedDaily();

    if ($('lcChart')) {
      destroyChart('lcChart');
      const worst = d.map((row) => worstAskAt(row.date));
      const base = chartBase();
      base.interaction = { mode:'index', intersect:false };
      base.scales.y.ticks.callback = (v) => Number(v).toFixed(2);
      charts.lcChart = new Chart($('lcChart'), {
        type:'line',
        data:{
          labels:d.map((x) => x.date.slice(5)),
          datasets:[
            {label:'23:00 ASK Close',data:d.map((x) => x.rate),borderColor:'#f2f5f8',borderWidth:2,pointRadius:0,tension:.15},
            {label:'日中最大ASK',data:worst,borderColor:'#ffd166',backgroundColor:'rgba(255,209,102,.08)',borderWidth:1.7,pointRadius:2.4,pointHoverRadius:4,spanGaps:false,tension:.12},
            {label:'推定LC',data:d.map((x) => x.lc),borderColor:'#ff7582',borderDash:[5,5],borderWidth:1.6,pointRadius:0,spanGaps:true}
          ]
        },
        options:base
      });
      const title = $('lcChart')?.closest('.risk-chart-block')?.querySelector('.chart-title span');
      if (title) title.textContent = '日中最大ASK＝売り建玉の当日最悪値 / LCは23時スナップショット基準';
    }

    if ($('maintenanceChart')) {
      destroyChart('maintenanceChart');
      const base = chartBase();
      base.scales.y.ticks.callback = (v) => `${Number(v).toFixed(0)}%`;
      charts.maintenanceChart = new Chart($('maintenanceChart'), {
        type:'line',
        data:{labels:d.map((x)=>x.date.slice(5)),datasets:[
          {label:'維持率',data:d.map((x)=>Number.isFinite(x.maintenance)?x.maintenance:null),borderColor:'#7ee787',backgroundColor:'rgba(126,231,135,.05)',borderWidth:2.1,pointRadius:0,fill:true},
          {label:`LC ${state.settings.lcThreshold}%`,data:d.map(()=>Number(state.settings.lcThreshold)),borderColor:'#ff7582',borderDash:[5,5],borderWidth:1.4,pointRadius:0}
        ]},
        options:base
      });
    }
  };

  const baseRenderRiskFactsWorstAsk = renderRiskFacts;
  renderRiskFacts = function() {
    baseRenderRiskFactsWorstAsk();
    const host = $('riskFacts');
    const snapshot = latestSnapshot();
    if (!host || !snapshot) return;
    const worst = worstAskAt(snapshot.date);
    if (!(worst > 0)) return;

    const lc = Number(snapshot.lc);
    const gap = lc > 0 ? (lc / worst - 1) * 100 : null;
    const worstFact = document.createElement('div');
    worstFact.className = 'risk-fact';
    worstFact.innerHTML = `<span>当日最大ASK</span><strong>${rateFmt(worst)}</strong>`;
    host.appendChild(worstFact);

    const gapFact = document.createElement('div');
    gapFact.className = 'risk-fact';
    if (gap == null || !Number.isFinite(gap)) {
      gapFact.innerHTML = '<span>最大ASK→LC</span><strong>—</strong>';
    } else if (gap >= 0) {
      gapFact.innerHTML = `<span>最大ASK→23時基準LC</span><strong>+${gap.toFixed(2)}%</strong>`;
    } else {
      gapFact.innerHTML = `<span>最大ASK vs 23時基準LC</span><strong class="negative-text">${Math.abs(gap).toFixed(2)}% 超過</strong>`;
    }
    host.appendChild(gapFact);
  };

  const refresh = () => {
    installPublisherEntry();
    try { renderRiskFacts(); } catch (_) {}
    if (activeTab === 'risk') requestAnimationFrame(() => {
      try { renderRiskCharts(); } catch (_) {}
    });
  };

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === 'data-hirose-rate-history-ready')) refresh();
  });
  observer.observe(root, { attributes:true, attributeFilter:['data-hirose-rate-history-ready'] });

  window.__DTL_WORST_ASK_AT__ = worstAskAt;
  installPublisherEntry();
  root.dataset.worstAskRisk = '1';
})();
