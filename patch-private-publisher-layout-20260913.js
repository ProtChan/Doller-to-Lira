// Public layout after Daily Data became read-only. Keeps the owner publisher reachable
// by direct URL, removes its public entry point, and preserves the compact desktop UI.
(() => {
  const root = document.documentElement;
  if (root.dataset.privatePublisherLayout === '1') return;

  const stripPublisherEntry = () => document.getElementById('openRatePublisherBtn')?.remove();
  stripPublisherEntry();
  const observer = new MutationObserver(() => stripPublisherEntry());
  observer.observe(document.body, { childList:true, subtree:true });

  const style = document.createElement('style');
  style.dataset.privatePublisherLayout = '1';
  style.textContent = `
    #openRatePublisherBtn{display:none!important}
    html,body{max-width:100%;overflow-x:hidden}
    .shell,main,.view{min-width:0}
    #view-daily{width:100%;max-width:100%;overflow:hidden}
    #view-daily .daily-table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto;overscroll-behavior-inline:contain;-webkit-overflow-scrolling:touch}

    @media(max-width:820px){
      #view-daily .section-head{width:100%;min-width:0}
      #view-daily .section-meta{white-space:nowrap}
      #view-daily .daily-table-wrap{margin-top:14px}
    }

    @media(min-width:821px) and (max-height:900px){
      .shell{padding-bottom:22px}
      .header{height:68px}
      .brand-mark{width:36px;height:36px}
      .brand h1{font-size:18px}
      .tabs,.tab{height:44px}
      .tabs{gap:22px}
      .metric-strip{margin-bottom:16px}
      .metric{padding:12px 14px 11px}
      .metric span{margin-bottom:6px;font-size:9px}
      .metric strong{font-size:clamp(18px,1.75vw,26px)}
      .metric.primary strong{font-size:clamp(21px,2.1vw,30px)}
      .metric small{margin-top:4px;font-size:8px}
      .section-head{margin-bottom:11px}
      .section-head.compact-head{margin-top:16px;margin-bottom:10px}
      .section-head h2{font-size:18px}
      .section-kicker{margin-bottom:4px}
      .overview-layout{min-height:0}
      .main-chart-zone{padding-top:14px;padding-bottom:12px}
      .quick-entry{padding-top:14px;padding-bottom:12px}
      .chart-toolbar{margin-bottom:8px}
      .chart-large{height:clamp(220px,calc(100dvh - 455px),292px)}
      .quick-divider{margin:11px 0}
      .position-line{min-height:50px}
      .open-position-list{max-height:104px;overflow:auto}
      .inline-editor{padding:11px 0;margin-bottom:14px}
      .positions-layout{min-height:0;height:calc(100dvh - 270px);max-height:calc(100dvh - 270px)}
      .positions-layout>.data-table-wrap{height:100%;overflow:auto}
      .position-detail{height:100%;overflow:auto;padding-top:15px}
      .daily-table-wrap{margin-top:12px;max-height:calc(100dvh - 315px);overflow:auto}
      .risk-chart-block:first-child,.risk-chart-block:last-child{padding-top:14px;padding-bottom:12px}
      .chart-medium{height:clamp(210px,calc(100dvh - 350px),284px)}
      .risk-table{margin-top:12px}
      .risk-fact{padding:10px 12px}
      .calendar-summary{padding:9px 0;margin-bottom:8px}
      .calendar-day{min-height:clamp(68px,calc((100dvh - 315px)/6),92px);padding:7px}
      .disclaimer{margin-top:16px;padding-top:11px;font-size:8px}
    }

    @media(min-width:821px) and (max-height:800px){
      .overview-layout{height:calc(100dvh - 268px);max-height:calc(100dvh - 268px);overflow:hidden}
      .main-chart-zone,.quick-entry{min-height:0;height:100%}
      .quick-entry{overflow-y:auto;overscroll-behavior:contain}
      .chart-large{height:276px}
    }
  `;
  document.head.appendChild(style);

  root.dataset.publisherEntryHidden = '1';
  root.dataset.desktopViewportCompact = '1';
  root.dataset.privatePublisherLayout = '1';
  // Compatibility markers for older installed clients/tests; no Daily Input UI is active.
  root.dataset.privatePublisherDailyLayout = '2';
  root.dataset.mobileDailyNormalized = '1';
})();
