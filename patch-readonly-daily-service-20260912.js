// Provider-driven Daily Data mode.
// Published USD/TRY + USD/JPY rates and Hirose swap data are authoritative.
// Public users can inspect Daily Data, but cannot edit or delete it.
(() => {
  const root = document.documentElement;
  if (root.dataset.dailyDataService === '1') return;

  const STATE_KEY = 'dollar-to-lira:v1';
  const RATE_MODE_KEY = 'dollar-to-lira:rate-source:v1';
  const SWAP_MODE_KEY = 'dollar-to-lira:swap-mode:v1';

  localStorage.setItem(RATE_MODE_KEY, 'auto');
  localStorage.setItem(SWAP_MODE_KEY, 'hirose');
  root.dataset.rateSourceMode = 'auto';
  root.dataset.swapInputMode = 'hirose';

  const providerRateAt = (date) => {
    try {
      const row = typeof window.__DTL_HIROSE_RATE_AT__ === 'function'
        ? window.__DTL_HIROSE_RATE_AT__(date)
        : null;
      const rate = Number(row?.usdTryAskClose23);
      const usdJpy = Number(row?.usdJpyAskClose23);
      return rate > 0 && usdJpy > 0 ? { row, rate, usdJpy } : null;
    } catch (_) {
      return null;
    }
  };

  const providerDates = () => {
    const dates = new Set((state.daily || []).map((row) => row?.date).filter(Boolean));
    try {
      const history = typeof window.__DTL_HIROSE_RATE_HISTORY__ === 'function'
        ? window.__DTL_HIROSE_RATE_HISTORY__()
        : [];
      if (Array.isArray(history)) history.forEach((row) => { if (row?.date) dates.add(row.date); });
    } catch (_) {}
    return [...dates].sort();
  };

  const same = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-10;

  // Provider-covered dates replace historical manual daily-rate/conversion overrides.
  // Rows for which no published rate exists remain as read-only legacy history.
  const syncPublishedRates = () => {
    if (!Array.isArray(state?.daily)) return 0;
    const byDate = new Map(state.daily.map((row) => [row?.date, row]).filter(([date]) => date));
    let changed = 0;

    providerDates().forEach((date) => {
      const source = providerRateAt(date);
      if (!source) return;
      const existing = byDate.get(date) || { date, swapPerLot: 0 };
      const next = {
        ...existing,
        date,
        rate: source.rate,
        usdJpy: source.usdJpy,
        tryJpy: source.usdJpy / source.rate,
        valuationTryJpySource: 'synthetic',
        rateSource: 'provider',
        rateSourcePrice: 'ASK',
        rateSourceTimeframe: source.row?.sourceTimeframe || '60m',
        rateSourceBarTime: source.row?.sourceBarTime || '23:00 JST',
        ...(Number(source.row?.usdTryAskDayHigh) > 0 ? {
          usdTryAskDayHigh: Number(source.row.usdTryAskDayHigh),
          usdTryAskDayHighSource: source.row.verification || source.row.usdTryAskDayHighSource || 'provider'
        } : {})
      };
      delete next.valuationTryJpy;

      const differs = !same(existing.rate, next.rate)
        || !same(existing.usdJpy, next.usdJpy)
        || !same(existing.tryJpy, next.tryJpy)
        || Number(existing.valuationTryJpy) > 0
        || existing.valuationTryJpySource !== 'synthetic'
        || existing.rateSource !== 'provider'
        || existing.rateSourceTimeframe !== next.rateSourceTimeframe
        || existing.rateSourceBarTime !== next.rateSourceBarTime
        || (Number(next.usdTryAskDayHigh) > 0 && !same(existing.usdTryAskDayHigh, next.usdTryAskDayHigh));

      if (differs) {
        byDate.set(date, next);
        changed += 1;
      }
    });

    if (!changed) return 0;
    state.daily = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    try { calendarCursor = monthFromLatest(); } catch (_) {}
    try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
    try { window.__DTL_BACKEND_INVALIDATE__?.(); } catch (_) {}
    return changed;
  };

  const usdJpyFor = (row) => {
    const explicit = Number(row?.usdJpy);
    if (explicit > 0) return explicit;
    const synthetic = Number(row?.rate) * Number(row?.tryJpy);
    return synthetic > 0 ? synthetic : 0;
  };

  const sourceLabel = (row) => {
    const source = String(row?.rateSource || '');
    return ['provider', 'reference-bulk', 'hirose-ask-23close'].includes(source) ? '配信' : '旧履歴';
  };

  renderDailyTable = function() {
    const body = document.getElementById('dailyTableBody');
    if (!body) return;
    const rows = [...(derivedDaily() || [])].reverse();
    const head = body.closest('table')?.querySelector('thead');
    if (head) head.innerHTML = '<tr><th>日付</th><th>USD/TRY</th><th>USD/JPY</th><th>TRY/JPY</th><th>Swap/lot</th><th>保有lot</th><th>FX損益</th><th>累積Swap</th><th>総損益</th><th>日次損益</th><th>Source</th></tr>';
    body.innerHTML = rows.length ? rows.map((row) => {
      const usdJpy = usdJpyFor(row);
      const days = Number(row.swapSourceDays || 0);
      const swapText = `${money(Number(row.swapPerLot || 0))}${days > 1 ? `<small class="swap-days-badge">${days}日分</small>` : ''}`;
      const source = sourceLabel(row);
      return `<tr data-daily-readonly="1"><td>${row.date}</td><td>${rateFmt(row.rate)}</td><td>${usdJpy > 0 ? num(usdJpy, 3) : '—'}</td><td>${rateFmt(row.tryJpy)}</td><td>${swapText}</td><td>${num(row.lots,2)}</td><td class="${row.fxPnl>=0?'positive-text':'negative-text'}">${money(row.fxPnl)}</td><td class="${row.swap>=0?'positive-text':'negative-text'}">${money(row.swap)}</td><td class="${row.total>=0?'positive-text':'negative-text'}">${money(row.total)}</td><td class="${row.dailyPnl>=0?'positive-text':'negative-text'}">${money(row.dailyPnl)}</td><td><span class="daily-source-badge ${source==='配信'?'provider':'legacy'}">${source}</span></td></tr>`;
    }).join('') : '<tr><td colspan="11" style="text-align:center;color:#596373;padding:36px">配信済みの日次データがありません</td></tr>';
  };

  const forceHide = (element) => {
    if (!element) return;
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('display', 'none', 'important');
  };

  const hideControlRow = (id) => {
    const input = document.getElementById(id);
    if (!input) return;
    forceHide(input.closest('label') || input);
  };

  const ensureLatestCard = () => {
    const host = document.querySelector('#view-overview .quick-entry');
    if (!host) return;
    const title = host.querySelector('.quick-title');
    if (title) title.innerHTML = '<span>DAILY DATA</span><strong>最新配信データ</strong>';
    let card = host.querySelector('.readonly-daily-latest');
    if (!card) {
      card = document.createElement('div');
      card.className = 'readonly-daily-latest';
      document.getElementById('quickDailyForm')?.after(card);
    }
    const row = (derivedDaily() || []).at(-1) || null;
    const html = !row ? '<p>配信データを待っています。</p>' : (() => {
      const usdJpy = usdJpyFor(row);
      return `<div class="readonly-daily-date"><span>${row.date}</span><small>閲覧専用</small></div>
        <div class="readonly-daily-grid">
          <div><span>USD/TRY</span><strong>${rateFmt(row.rate)}</strong></div>
          <div><span>USD/JPY</span><strong>${usdJpy > 0 ? num(usdJpy,3) : '—'}</strong></div>
          <div><span>TRY/JPY</span><strong>${rateFmt(row.tryJpy)}</strong></div>
          <div><span>Swap / lot</span><strong>${money(Number(row.swapPerLot || 0))}</strong></div>
        </div>`;
    })();
    if (card.innerHTML !== html) card.innerHTML = html;
  };

  const enforceReadOnlyUi = () => {
    const tab = document.querySelector('[data-tab="daily"]');
    if (tab) tab.textContent = '日次データ';
    const section = document.getElementById('view-daily');
    const kicker = section?.querySelector('.section-kicker');
    const title = section?.querySelector('.section-head h2');
    const meta = section?.querySelector('.section-meta');
    if (kicker) kicker.textContent = 'DAILY DATA';
    if (title) title.textContent = '日次データ';
    if (meta) meta.textContent = '配信データ · 閲覧専用';

    forceHide(document.getElementById('dailyForm'));
    forceHide(document.getElementById('quickDailyForm'));
    ['settingTryJpy', 'settingSwap', 'settingSwapMode', 'settingRateSource'].forEach(hideControlRow);
    forceHide(document.getElementById('referenceRebuildNote'));
    forceHide(document.getElementById('rebuildReferenceDataBtn'));

    const reset = document.getElementById('resetAllBtn');
    if (reset) reset.textContent = 'ユーザーデータを初期化';
    ensureLatestCard();
  };

  const style = document.createElement('style');
  style.dataset.dailyDataService = '1';
  style.textContent = `
    .readonly-daily-latest{display:grid;gap:12px;margin-top:14px}
    .readonly-daily-latest p{margin:0;color:var(--muted2);font-size:10px;line-height:1.6}
    .readonly-daily-date{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:10px}
    .readonly-daily-date span{font-size:17px;font-weight:850;letter-spacing:-.03em}
    .readonly-daily-date small{font-size:8px;color:var(--accent);font-weight:800;letter-spacing:.08em}
    .readonly-daily-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .readonly-daily-grid>div{border:1px solid var(--line);background:#0a0d12;border-radius:10px;padding:9px 10px;min-width:0}
    .readonly-daily-grid span{display:block;font-size:7px;color:var(--muted2);font-weight:800;letter-spacing:.06em;margin-bottom:4px}
    .readonly-daily-grid strong{font-size:12px;white-space:nowrap}
    .daily-source-badge{display:inline-flex;border-radius:999px;padding:3px 7px;font-size:7px;font-weight:850;letter-spacing:.05em;border:1px solid var(--line)}
    .daily-source-badge.provider{color:var(--accent)}
    .daily-source-badge.legacy{color:var(--muted2)}
    #view-daily .daily-table-wrap{margin-top:0}
    @media(max-width:820px){.readonly-daily-latest{margin-top:10px}}
  `;
  document.head.appendChild(style);

  const baseRenderAll = renderAll;
  renderAll = function(...args) {
    syncPublishedRates();
    const result = baseRenderAll.apply(this, args);
    enforceReadOnlyUi();
    return result;
  };

  const refreshFromProvider = () => {
    syncPublishedRates();
    try { baseRenderAll(); } catch (_) {}
    enforceReadOnlyUi();
  };

  const rootObserver = new MutationObserver((mutations) => {
    const providerChanged = mutations.some((mutation) => [
      'data-hirose-rate-history-ready',
      'data-live-rate-refresh-ready',
      'data-hirose-history-ready'
    ].includes(mutation.attributeName));
    if (providerChanged) refreshFromProvider();
  });
  rootObserver.observe(root, {
    attributes: true,
    attributeFilter: ['data-hirose-rate-history-ready','data-live-rate-refresh-ready','data-hirose-history-ready']
  });

  window.__DTL_SYNC_PUBLISHED_DAILY__ = () => {
    refreshFromProvider();
    return true;
  };
  root.dataset.dailyDataService = '1';
  root.dataset.dailyDataMode = 'provider-readonly';
  root.dataset.dailyRateAuthority = 'published-feed';
  root.dataset.dailySwapAuthority = 'hirose-feed';

  refreshFromProvider();
})();
