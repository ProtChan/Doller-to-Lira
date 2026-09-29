// Startup readiness coordinator.
// Keeps the page covered until the critical provider data and derived values are
// ready. Optional margin/chart enhancements hydrate after first paint so slow
// secondary resources never hold the whole application behind the loader.
(() => {
  const root = document.documentElement;
  if (root.dataset.startupCoordinator === '1') return;

  const startedAt = Number(window.__DTL_BOOT_T0__);
  const t0 = Number.isFinite(startedAt) ? startedAt : performance.now();
  const overlay = document.getElementById('appLoadingScreen');
  const label = document.getElementById('appLoadingLabel');
  const detail = document.getElementById('appLoadingDetail');
  const retry = document.getElementById('appLoadingRetry');
  const marks = {};
  let startupRenderQueued = false;
  let startupRenderArgs = [];
  let startupRenderCount = 0;
  let startupRenderTotalMs = 0;
  let finalRenderAt = 0;
  let readyCommitted = false;
  let checkTimer = 0;

  root.dataset.startupCoordinator = '1';
  root.dataset.startupLoading = '1';

  const elapsed = () => performance.now() - t0;
  const mark = (name) => {
    if (marks[name] == null) marks[name] = Number(elapsed().toFixed(1));
  };

  const providerSettled = (name) => root.dataset[name] === '1';
  const criticalState = () => ({
    bundle: root.dataset.backendBundle === '1',
    app: root.dataset.appReady === '1',
    backend: root.dataset.backendCoreReady === '1',
    rates: providerSettled('hiroseRateHistoryReady'),
    liveRates: providerSettled('liveRateRefreshReady'),
    swap: providerSettled('hiroseFeedReady'),
    daily: root.dataset.dailyDataService === '1',
    // Optional enhancement markers are still tracked for diagnostics, but they
    // intentionally do not block first usable paint.
    margin: providerSettled('hiroseMarginReady'),
    chartLibrary: typeof window.Chart !== 'undefined'
  });
  const CRITICAL_KEYS = ['bundle', 'app', 'backend', 'rates', 'liveRates', 'swap', 'daily'];

  const updateMarks = (state) => {
    Object.entries(state).forEach(([key, value]) => { if (value) mark(key); });
    if (document.readyState !== 'loading') mark('domReady');
  };

  const setLoadingCopy = (state) => {
    if (!label || !detail || readyCommitted) return;
    if (!state.bundle || !state.app || !state.backend) {
      label.textContent = 'アプリを準備しています';
      detail.textContent = '計算エンジンを初期化中…';
      return;
    }
    if (!state.rates || !state.liveRates || !state.swap || !state.daily) {
      label.textContent = '配信データを同期しています';
      detail.textContent = 'レート・Swapを確認中…';
      return;
    }
    label.textContent = '表示を仕上げています';
    detail.textContent = '最新の数値を描画中…';
  };

  const chartIsReady = () => {
    try {
      const chart = charts?.overviewChart || window.Chart?.getChart?.(document.getElementById('overviewChart'));
      return Boolean(
        chart
        && Array.isArray(chart.data?.labels)
        && chart.data.labels.length > 0
        && chart.canvas?.width > 0
        && chart.canvas?.height > 0
      );
    } catch (_) {
      return false;
    }
  };

  const valuesAreReady = () => {
    try {
      const rows = typeof derivedDaily === 'function' ? derivedDaily() : [];
      const total = document.getElementById('kpiTotalPnl')?.textContent?.trim() || '';
      const snapshot = document.getElementById('latestSnapshotLabel')?.textContent?.trim() || '';
      return rows.length > 0 && total !== '' && total !== '—' && snapshot !== '' && snapshot !== '日次データ未入力';
    } catch (_) {
      return false;
    }
  };

  const commitReady = () => {
    if (readyCommitted) return;
    readyCommitted = true;
    mark('visualReady');
    const totalMs = Number(elapsed().toFixed(1));
    root.dataset.startupReady = '1';
    root.dataset.startupLoading = '0';
    root.dataset.startupMs = String(totalMs);
    root.dataset.startupRenderCount = String(startupRenderCount);
    root.dataset.startupRenderTotalMs = startupRenderTotalMs.toFixed(1);
    if (label) label.textContent = '準備完了';
    if (detail) detail.textContent = '最新データを表示します';
    if (overlay) {
      overlay.setAttribute('aria-busy', 'false');
      overlay.classList.add('is-ready');
      setTimeout(() => {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
      }, 240);
    }
    clearTimeout(checkTimer);
  };

  const runFinalRender = () => {
    const now = performance.now();
    if (now - finalRenderAt < 120) return;
    finalRenderAt = now;
    const started = performance.now();
    try { baseRenderAll(); } catch (error) { console.warn('startup final render failed', error); }
    startupRenderCount += 1;
    startupRenderTotalMs += performance.now() - started;
  };

  const check = () => {
    if (readyCommitted) return;
    const state = criticalState();
    updateMarks(state);
    setLoadingCopy(state);
    const coreReady = CRITICAL_KEYS.every((key) => state[key]);
    if (coreReady) {
      runFinalRender();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (valuesAreReady()) {
          commitReady();
        } else {
          scheduleCheck(45);
        }
      }));
      return;
    }
    scheduleCheck(45);
  };

  const scheduleCheck = (delay = 0) => {
    if (readyCommitted) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, delay);
  };

  const baseRenderAll = renderAll;
  const hydrateChart = () => {
    if (typeof window.Chart === 'undefined') return;
    mark('chartLibrary');
    // If Chart.js arrived before critical data, the normal final render will draw it.
    // If it arrived after first paint, hydrate the chart without reopening the loader.
    if (!readyCommitted) {
      scheduleCheck();
      return;
    }
    requestAnimationFrame(() => {
      try { baseRenderAll(); } catch (error) { console.warn('chart hydration render failed', error); }
    });
  };
  window.addEventListener('dtl:chart-library-ready', hydrateChart);
  if (typeof window.Chart !== 'undefined') queueMicrotask(hydrateChart);

  renderAll = function(...args) {
    // Keep the bootstrap render synchronous so data-app-ready retains its historical
    // meaning. Only later feed-driven startup renders are coalesced.
    if (root.dataset.appReady !== '1' || root.dataset.startupReady === '1') {
      const started = performance.now();
      const result = baseRenderAll.apply(this, args);
      startupRenderCount += root.dataset.startupReady === '1' ? 0 : 1;
      startupRenderTotalMs += root.dataset.startupReady === '1' ? 0 : performance.now() - started;
      scheduleCheck();
      return result;
    }

    startupRenderArgs = args;
    if (startupRenderQueued) return;
    startupRenderQueued = true;
    requestAnimationFrame(() => {
      startupRenderQueued = false;
      const started = performance.now();
      try { baseRenderAll.apply(this, startupRenderArgs); }
      finally {
        startupRenderCount += 1;
        startupRenderTotalMs += performance.now() - started;
        scheduleCheck();
      }
    });
  };

  const observer = new MutationObserver(() => scheduleCheck());
  observer.observe(root, { attributes:true });

  document.addEventListener('DOMContentLoaded', () => { mark('domContentLoaded'); scheduleCheck(); }, { once:true });
  window.addEventListener('load', () => { mark('windowLoad'); scheduleCheck(); }, { once:true });
  retry?.addEventListener('click', () => location.reload());

  setTimeout(() => {
    if (readyCommitted) return;
    if (label) label.textContent = '読み込みに時間がかかっています';
    if (detail) detail.textContent = '通信状態を確認してください。再読み込みもできます。';
    if (retry) retry.hidden = false;
    root.dataset.startupSlow = '1';
  }, 12000);

  window.__DTL_STARTUP_DIAGNOSTICS__ = () => {
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => /app\.bundle\.js|chart\.umd\.min\.js|data\/hirose-/.test(entry.name))
      .map((entry) => ({
        name:entry.name.split('?')[0].split('/').slice(-2).join('/'),
        startTime:Number(entry.startTime.toFixed(1)),
        duration:Number(entry.duration.toFixed(1)),
        transferSize:Number(entry.transferSize || 0)
      }));
    return {
      startupMs:Number(root.dataset.startupMs || elapsed().toFixed(1)),
      ready:root.dataset.startupReady === '1',
      slow:root.dataset.startupSlow === '1',
      renderCount:Number(root.dataset.startupRenderCount || startupRenderCount),
      renderTotalMs:Number(root.dataset.startupRenderTotalMs || startupRenderTotalMs.toFixed(1)),
      backendDerivedMs:Number(root.dataset.backendDerivedMs || 0),
      marks:{ ...marks },
      resources
    };
  };

  scheduleCheck();
})();
