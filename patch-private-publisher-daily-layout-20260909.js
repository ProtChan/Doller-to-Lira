// Keep the owner-only publisher reachable by direct URL, but remove it from the public app UI.
// Also normalize Daily Input sizing on mobile and make the main desktop panels fit common laptop heights.
(() => {
  const root = document.documentElement;
  if (root.dataset.privatePublisherDailyLayout === '2') return;

  const stripPublisherEntry = () => {
    document.getElementById('openRatePublisherBtn')?.remove();
  };

  stripPublisherEntry();
  const publisherObserver = new MutationObserver(() => stripPublisherEntry());
  publisherObserver.observe(document.body, { childList: true, subtree: true });

  const style = document.createElement('style');
  style.dataset.privatePublisherDailyLayout = '2';
  style.textContent = `
    #openRatePublisherBtn{display:none!important}
    html,body{max-width:100%;overflow-x:hidden}
    .shell,main,.view{min-width:0}

    /* Source notes must not move the input line itself. */
    .daily-entry-bar{
      position:relative;
      column-gap:10px;
      row-gap:30px;
      padding-bottom:32px;
      min-width:0;
      width:100%;
    }
    .daily-entry-bar label{
      position:relative;
      min-width:0;
      align-self:end;
    }
    .daily-entry-bar input{
      display:block;
      width:100%;
      min-width:0;
      height:40px;
    }
    .daily-entry-bar .rate-source-note,
    .daily-entry-bar .swap-source-note{
      position:absolute;
      top:calc(100% + 5px);
      left:0;
      right:0;
      height:14px;
      margin:0!important;
      line-height:14px!important;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      pointer-events:none;
    }
    .daily-entry-bar > button{
      height:40px;
      align-self:end;
      min-width:0;
    }
    #view-daily{width:100%;max-width:100%;overflow:hidden}
    #view-daily .daily-table-wrap{
      width:100%;
      max-width:100%;
      min-width:0;
      overflow-x:auto;
      overscroll-behavior-inline:contain;
      -webkit-overflow-scrolling:touch;
    }

    /* Mobile: the fixed desktop column widths previously made only Daily Input wider
       than the viewport. Keep it on the same visual scale as every other tab. */
    @media(max-width:820px){
      .daily-entry-bar{
        grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
        column-gap:10px;
        row-gap:28px;
        padding:14px 0 31px;
      }
      .daily-entry-bar > button{
        grid-column:1 / -1;
        width:100%;
      }
      .daily-entry-bar label,
      .daily-entry-bar input,
      .daily-entry-bar > button{
        max-width:100%;
      }
      #view-daily .section-head{width:100%;min-width:0}
      #view-daily .section-meta{white-space:nowrap}
      #view-daily .daily-table-wrap{margin-top:14px}
    }

    @media(max-width:460px){
      .daily-entry-bar{column-gap:8px;row-gap:27px;padding-bottom:30px}
      .daily-entry-bar label{font-size:9px}
      .daily-entry-bar input{height:39px;padding:10px 10px}
      .daily-entry-bar > button{height:39px}
      .daily-entry-bar .rate-source-note,
      .daily-entry-bar .swap-source-note{font-size:7px}
    }

    /* Laptop/desktop compact mode. At 1366x768-class viewports the old 92px header,
       58px tabs and 370px charts forced every useful panel below the fold. */
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
      .compact-form{gap:8px;margin-top:11px}
      .compact-form input{padding:9px 10px}
      .quick-divider{margin:11px 0}
      .position-line{min-height:50px}
      .open-position-list{max-height:104px;overflow:auto}
      .inline-editor{padding:11px 0;margin-bottom:14px}
      .positions-layout{min-height:0;height:calc(100dvh - 270px);max-height:calc(100dvh - 270px)}
      .positions-layout>.data-table-wrap{height:100%;overflow:auto}
      .position-detail{height:100%;overflow:auto;padding-top:15px}
      .daily-entry-bar{padding-top:12px;padding-bottom:29px}
      .daily-table-wrap{margin-top:12px;max-height:calc(100dvh - 286px);overflow:auto}
      .risk-chart-block:first-child,.risk-chart-block:last-child{padding-top:14px;padding-bottom:12px}
      .chart-medium{height:clamp(210px,calc(100dvh - 350px),284px)}
      .risk-table{margin-top:12px}
      .risk-fact{padding:10px 12px}
      .calendar-summary{padding:9px 0;margin-bottom:8px}
      .calendar-day{min-height:clamp(68px,calc((100dvh - 315px)/6),92px);padding:7px}
      .disclaimer{margin-top:16px;padding-top:11px;font-size:8px}
    }
  `;
  document.head.appendChild(style);

  root.dataset.publisherEntryHidden = '1';
  root.dataset.dailyInputAligned = '1';
  root.dataset.mobileDailyNormalized = '1';
  root.dataset.desktopViewportCompact = '1';
  root.dataset.privatePublisherDailyLayout = '2';
})();
