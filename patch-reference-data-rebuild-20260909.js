// Weekday-only Hirose ASK high backfill + one-click rebuild of all owner/reference daily data.
(() => {
  const root = document.documentElement;
  if (root.dataset.referenceDataRebuild === '1') return;

  const HIGH_FEED_URL = './data/hirose-ask-day-high.json';
  const IMPORT_THROUGH_KEY = 'dollar-to-lira:hirose-rate-imported-through:v1';
  const STATE_KEY = 'dollar-to-lira:v1';
  let highHistory = [];
  let highByDate = new Map();
  let wrappedRateAt = false;

  const isWeekday = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(d.getTime())) return false;
    const day = d.getUTCDay();
    return day >= 1 && day <= 5;
  };

  const highAt = (date) => {
    const row = highByDate.get(date) || null;
    const value = Number(row?.usdTryAskDayHigh);
    return value > 0 ? { ...row, usdTryAskDayHigh: value } : null;
  };

  const supplementalHighSource = (row) => row?.sourceTimeframe === '4h'
    ? 'uploaded-hirose-4h-ask-csv'
    : 'uploaded-hirose-60m-ask-csv';

  const installRateHistoryMerge = () => {
    if (wrappedRateAt || typeof window.__DTL_HIROSE_RATE_AT__ !== 'function') return false;
    const baseRateAt = window.__DTL_HIROSE_RATE_AT__;
    const baseRateHistory = typeof window.__DTL_HIROSE_RATE_HISTORY__ === 'function'
      ? window.__DTL_HIROSE_RATE_HISTORY__
      : null;

    window.__DTL_HIROSE_RATE_AT__ = (date) => {
      const base = baseRateAt(date);
      if (!base) return null;
      const extra = highAt(date);
      if (!extra) return { ...base };
      const baseHasHigh = Number(base.usdTryAskDayHigh) > 0;
      return {
        ...base,
        usdTryAskDayHigh: baseHasHigh ? Number(base.usdTryAskDayHigh) : extra.usdTryAskDayHigh,
        usdTryAskDayHighSource: baseHasHigh
          ? (base.verification || base.usdTryAskDayHighSource || (base.sourceTimeframe === '4h' ? 'uploaded-hirose-4h-ask-csv' : 'primary-feed'))
          : supplementalHighSource(extra)
      };
    };

    if (baseRateHistory) {
      window.__DTL_HIROSE_RATE_HISTORY__ = () => baseRateHistory().map((row) => {
        const extra = highAt(row.date);
        if (!extra || Number(row.usdTryAskDayHigh) > 0) return { ...row };
        return {
          ...row,
          usdTryAskDayHigh: extra.usdTryAskDayHigh,
          usdTryAskDayHighSource: supplementalHighSource(extra)
        };
      });
    }

    wrappedRateAt = true;
    root.dataset.hiroseRateHighMerged = '1';
    return true;
  };

  const combinedHighHistory = () => {
    const map = new Map(highHistory.map((row) => [row.date, { ...row }]));
    try {
      const rates = typeof window.__DTL_HIROSE_RATE_HISTORY__ === 'function'
        ? window.__DTL_HIROSE_RATE_HISTORY__()
        : [];
      rates.forEach((row) => {
        if (!row?.date || !isWeekday(row.date) || !(Number(row.usdTryAskDayHigh) > 0)) return;
        map.set(row.date, {
          ...(map.get(row.date) || {}),
          date: row.date,
          usdTryAskDayHigh: Number(row.usdTryAskDayHigh),
          sourceTimeframe: row.sourceTimeframe || map.get(row.date)?.sourceTimeframe || '60m',
          sourceBarTime: row.sourceBarTime || map.get(row.date)?.sourceBarTime || null,
          source: row.usdTryAskDayHighSource || row.verification || map.get(row.date)?.source || 'primary-feed'
        });
      });
    } catch (_) {}
    return [...map.values()].sort((a,b) => a.date.localeCompare(b.date));
  };

  const refreshHighDatasetMeta = () => {
    const combined = combinedHighHistory();
    root.dataset.askDayHighRecords = String(combined.length);
    root.dataset.askDayHighStart = combined[0]?.date || '';
    root.dataset.askDayHighEnd = combined.at(-1)?.date || '';
  };

  const swapFieldsFor = (date) => {
    if (typeof window.__DTL_HIROSE_SWAP_RESOLUTION__ !== 'function') {
      return { swapPerLot:0, swapSource:'hirose-pending', swapPending:true, swapLongPerLot:0, swapCreditDate:date };
    }
    const r = window.__DTL_HIROSE_SWAP_RESOLUTION__(date);
    if (r?.status === 'official') {
      return {
        swapPerLot:Number(r.shortPerLot || 0), swapSource:'hirose', swapPending:false,
        swapLongPerLot:Number(r.longPerLot || 0), swapSourceDate:r.sourceDate || '',
        swapCreditDate:r.creditDate || date, swapSourceDays:Number(r.row?.days || 0),
        swapSourceUnit:Number(r.row?.unit || 1000), swapSourceSellJpy:Number(r.row?.sellJpy || 0),
        swapSourceBuyJpy:Number(r.row?.buyJpy || 0)
      };
    }
    if (r?.status === 'zero') {
      return {
        swapPerLot:0, swapSource:'hirose-zero', swapPending:false, swapLongPerLot:0,
        swapSourceDate:r.sourceDate || '', swapCreditDate:r.creditDate || date,
        swapSourceDays:0, swapSourceUnit:1000, swapSourceSellJpy:0, swapSourceBuyJpy:0
      };
    }
    return {
      swapPerLot:0, swapSource:'hirose-pending', swapPending:true, swapLongPerLot:0,
      swapSourceDate:r?.sourceDate || '', swapCreditDate:r?.creditDate || date,
      swapSourceDays:0, swapSourceUnit:1000, swapSourceSellJpy:0, swapSourceBuyJpy:0
    };
  };

  const isManualRateRow = (row) => {
    if (!row) return false;
    const src = String(row.rateSource || '');
    if (src === 'hirose-ask-23close' || src === 'reference-bulk') return false;
    return Number(row.rate) > 0 && Number(usdJpyValueV2(row)) > 0;
  };

  const hasManualSwap = (row) => {
    if (!row) return false;
    const src = String(row.swapSource || '');
    if (src.startsWith('hirose')) return false;
    return Number.isFinite(Number(row.swapPerLot)) && Number(row.swapPerLot) !== 0;
  };

  const rebuildReferenceData = ({ silent = false } = {}) => {
    installRateHistoryMerge();
    const rates = typeof window.__DTL_HIROSE_RATE_HISTORY__ === 'function'
      ? window.__DTL_HIROSE_RATE_HISTORY__()
      : [];
    if (!Array.isArray(rates) || !rates.length) {
      if (!silent) toast('ヒロセのレート履歴がまだ読み込まれていません');
      return { ok:false, rows:0, highs:0, swaps:0 };
    }

    const byDate = new Map((state.daily || []).map((row) => [row.date, row]));
    let rows = 0;
    let highs = 0;
    let swaps = 0;

    for (const source of rates) {
      const date = source?.date;
      if (!date || !isWeekday(date)) continue;
      const rate = Number(source.usdTryAskClose23);
      const usdJpy = Number(source.usdJpyAskClose23);
      if (!(rate > 0) || !(usdJpy > 0)) continue;

      const existing = byDate.get(date) || null;
      const manualRate = isManualRateRow(existing);
      const manualSwap = hasManualSwap(existing);
      const high = Number(source.usdTryAskDayHigh) > 0
        ? Number(source.usdTryAskDayHigh)
        : Number(highAt(date)?.usdTryAskDayHigh || 0);
      const swapFields = swapFieldsFor(date);
      const sourceTimeframe = source.sourceTimeframe || '60m';
      const sourceBarTime = source.sourceBarTime || '23:00 JST';

      const row = {
        ...(existing || {}),
        date,
        rate: manualRate ? Number(existing.rate) : rate,
        usdJpy: manualRate ? Number(usdJpyValueV2(existing)) : usdJpy,
        tryJpy: (manualRate ? Number(usdJpyValueV2(existing)) : usdJpy) / (manualRate ? Number(existing.rate) : rate),
        rateSource: manualRate ? existing.rateSource : 'reference-bulk',
        rateSourcePrice: manualRate ? existing.rateSourcePrice : 'ASK',
        rateSourceTimeframe: manualRate ? existing.rateSourceTimeframe : sourceTimeframe,
        rateSourceBarTime: manualRate ? existing.rateSourceBarTime : sourceBarTime
      };

      if (high > 0) {
        row.usdTryAskDayHigh = high;
        row.usdTryAskDayHighSource = Number(source.usdTryAskDayHigh) > 0
          ? (source.verification || source.usdTryAskDayHighSource || (sourceTimeframe === '4h' ? 'uploaded-hirose-4h-ask-csv' : 'primary-feed'))
          : supplementalHighSource(highAt(date));
        highs += 1;
      }

      if (!manualSwap) {
        Object.assign(row, swapFields);
        if (swapFields.swapSource === 'hirose') swaps += 1;
      }

      byDate.set(date, row);
      rows += 1;
    }

    state.daily = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    const end = rates.at(-1)?.date || '';
    if (end) localStorage.setItem(IMPORT_THROUGH_KEY, end);
    try { calendarCursor = monthFromLatest(); } catch (_) {}
    try { if (typeof invalidatePerformanceCaches === 'function') invalidatePerformanceCaches(); } catch (_) {}
    try { renderAll(); } catch (_) {}
    try { fillDailyForm('daily', $('dailyDate')?.value || isoToday()); } catch (_) {}
    try { fillDailyForm('quickDaily', $('quickDailyDate')?.value || isoToday()); } catch (_) {}

    root.dataset.referenceDataRows = String(rows);
    root.dataset.referenceDataHighs = String(highs);
    root.dataset.referenceDataSwaps = String(swaps);
    root.dataset.referenceDataRebuiltAt = state.updatedAt;
    refreshHighDatasetMeta();

    if (!silent) toast(`${rows}日分を一括再入力しました · 最大ASK ${highs}日 · Swap ${swaps}日`);
    return { ok:true, rows, highs, swaps };
  };

  const installRebuildUi = () => {
    if ($('rebuildReferenceDataBtn')) return;
    const actions = $('backupDialog')?.querySelector('.backup-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'rebuildReferenceDataBtn';
    button.type = 'button';
    button.className = 'outline-btn';
    button.textContent = '提供データを一括再入力';
    button.addEventListener('click', () => {
      const ok = confirm('USD/TRY・USD/JPY・日中最大ASK・ヒロセSwapを提供済みデータから一括再入力します。既存の手入力レート/Swapは残し、欠損と自動データを再構築します。');
      if (!ok) return;
      rebuildReferenceData();
    });
    actions.appendChild(button);

    const note = document.createElement('small');
    note.id = 'referenceRebuildNote';
    note.textContent = '全初期化後でも、サーバー側に保存済みの提供レート・最大ASK・Swapを一括で戻せます。土日は作成しません。';
    actions.after(note);
  };

  $('resetAllBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      if (Array.isArray(state.daily) && state.daily.length === 0) {
        localStorage.removeItem(IMPORT_THROUGH_KEY);
        root.dataset.referenceDataNeedsRestore = '1';
      }
    }, 0);
  });

  fetch(`${HIGH_FEED_URL}?v=20260909-2255`, { cache:'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      highHistory = Array.isArray(data?.history)
        ? data.history.filter((row) => row?.date && isWeekday(row.date) && Number(row.usdTryAskDayHigh) > 0)
          .sort((a,b) => a.date.localeCompare(b.date))
        : [];
      highByDate = new Map(highHistory.map((row) => [row.date, row]));
      installRateHistoryMerge();
      root.dataset.askDayHighReady = '1';
      refreshHighDatasetMeta();
      try { renderRiskFacts(); } catch (_) {}
      if (activeTab === 'risk') requestAnimationFrame(() => { try { renderRiskCharts(); } catch (_) {} });
    })
    .catch((error) => {
      root.dataset.askDayHighReady = '0';
      root.dataset.askDayHighError = error?.message || String(error);
      console.warn('Hirose ASK day-high feed load failed', error);
    });

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => ['data-hirose-rate-history-ready','data-hirose-history-ready','data-hirose-pending-entries'].includes(m.attributeName))) {
      installRateHistoryMerge();
      refreshHighDatasetMeta();
    }
  });
  observer.observe(root, { attributes:true, attributeFilter:['data-hirose-rate-history-ready','data-hirose-history-ready','data-hirose-pending-entries'] });

  installRebuildUi();
  window.__DTL_ASK_DAY_HIGH_HISTORY__ = () => combinedHighHistory().map((row) => ({ ...row }));
  window.__DTL_ASK_DAY_HIGH_AT__ = (date) => {
    const fromCombined = combinedHighHistory().find((row) => row.date === date) || null;
    return fromCombined ? { ...fromCombined } : null;
  };
  window.__DTL_REBUILD_REFERENCE_DATA__ = (options) => rebuildReferenceData(options || {});
  root.dataset.referenceDataRebuild = '1';
})();
