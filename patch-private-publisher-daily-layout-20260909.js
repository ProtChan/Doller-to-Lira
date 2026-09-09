// Keep the owner-only publisher reachable by direct URL, but remove it from the public app UI.
// Also keep daily inputs aligned even when rate/swap source notes are present.
(() => {
  const root = document.documentElement;
  if (root.dataset.privatePublisherDailyLayout === '1') return;

  const stripPublisherEntry = () => {
    document.getElementById('openRatePublisherBtn')?.remove();
  };

  stripPublisherEntry();
  const publisherObserver = new MutationObserver(() => stripPublisherEntry());
  publisherObserver.observe(document.body, { childList: true, subtree: true });

  const style = document.createElement('style');
  style.dataset.privatePublisherDailyLayout = '1';
  style.textContent = `
    #openRatePublisherBtn{display:none!important}

    /* Source notes must not change the vertical position of the input itself. */
    .daily-entry-bar{
      position:relative;
      column-gap:10px;
      row-gap:30px;
      padding-bottom:32px;
    }
    .daily-entry-bar label{
      position:relative;
      min-width:0;
      align-self:end;
    }
    .daily-entry-bar input{
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
    }

    @media(max-width:820px){
      .daily-entry-bar{row-gap:30px;padding-bottom:30px}
    }
    @media(max-width:520px){
      .daily-entry-bar{row-gap:30px;padding-bottom:28px}
      .daily-entry-bar .rate-source-note,
      .daily-entry-bar .swap-source-note{font-size:7px}
    }
  `;
  document.head.appendChild(style);

  root.dataset.publisherEntryHidden = '1';
  root.dataset.dailyInputAligned = '1';
  root.dataset.privatePublisherDailyLayout = '1';
})();
