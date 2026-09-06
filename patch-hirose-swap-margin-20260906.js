// Hirose LION FX integration for USD/TRY.
// - Optional automatic USD/TRY swap input sourced from data/hirose-usdtry-swap.json.
// - Hirose-style USD/JPY banded margin requirement per 1,000 USD.
(() => {
  const HIROSE_MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const HIROSE_FEED_URL = './data/hirose-usdtry-swap.json';
  let hiroseFeed = null;
  let hiroseFeedError = '';

  const getSwapMode = () => localStorage.getItem(HIROSE_MODE_KEY) === 'hirose' ? 'hirose' : 'manual';
  const setSwapMode = (mode) => {
    localStorage.setItem(HIROSE_MODE_KEY, mode === 'hirose' ? 'hirose' : 'manual');
    document.documentElement.dataset.swapInputMode = getSwapMode();
  };

  const marginPer1000Hirose = (usdJpy) => {
    const n = Number(usdJpy);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // User-requested band convention: 155.0 <= x < 157.5 => 6,300,
    // 157.5 <= x < 160.0 => 6,400, etc.
    return (Math.floor((n + 1e-10) / 2.5) + 1) * 100;
  };
  window.__DTL_MARGIN_PER_1000__ = marginPer1000Hirose;

  const hiroseRowForDate = (date) => {
    const fromFeed = hiroseFeed?.history?.find?.((row) => row.date === date);
    if (fromFeed) return fromFeed;
    const saved = state.daily.find((row) => row.date === date && row.swapSource === 'hirose');
    if (!saved) return null;
    return {
      date,
      days: Number(saved.swapSourceDays || 0),
      unit: Number(saved.swapSourceUnit || 1000),
      sellJpy: Number(saved.swapSourceSellJpy ?? 0),
      buyJpy: Number(saved.swapSourceBuyJpy ?? 0)
    };
  };

  const hiroseSiteLotValues = (date) => {
    const row = hiroseRowForDate(date);
    if (!row) return null;
    const sourceUnit = Number(row.unit || 1000);
    const siteUnit = Number(state.settings.unitsPerLot || 10000);
    if (!sourceUnit || !siteUnit) return null;
    const factor = siteUnit / sourceUnit;
    return {
      row,
      shortPerLot: Number(row.sellJpy) * factor,
      longPerLot: Number(row.buyJpy) * factor
    };
  };

  const swapCreditForPositionDayHirose = (p, d) => {
    const lots = Number(p.lots || 0);
    if (d?.swapSource === 'hirose' && Number.isFinite(Number(d.swapLongPerLot))) {
      const perLot = p.side === 'short' ? Number(d.swapPerLot || 0) : Number(d.swapLongPerLot || 0);
      return Math.trunc(lots * perLot);
    }
    const sign = p.side === 'short' ? 1 : -1;
    return Math.trunc(sign * lots * swapPerLotValueV2(d));
  };

  const dailySwapCreditHirose = (date) => {
    const d = state.daily.find((row) => row.date === date);
    if (!d) return 0;
    return state.positions
      .filter((p) => isPositionOpenOn(p, date))
      .reduce((sum, p) => sum + swapCreditForPositionDayHirose(p, d), 0);
  };

  positionSwapAsOf = function(p, date) {
    return sortedDaily()
      .filter((d) => d.date >= p.date && d.date <= date && (!p.closeDate || d.date < p.closeDate))
      .reduce((sum, d) => sum + swapCreditForPositionDayHirose(p, d), 0);
  };

  portfolioSwap = function(date) {
    return state.positions.reduce((sum, p) => sum + positionSwapAsOf(p, date), 0);
  };

  marginRequired = function(date, rate, tryJpy) {
    const units = grossLotsOn(date) * Number(state.settings.unitsPerLot || 0);
    const usdJpy = Number(rate) * Number(tryJpy);
    const per1000 = marginPer1000Hirose(usdJpy);
    return units > 0 && per1000 > 0 ? (units / 1000) * per1000 : 0;
  };

  maintenance = function(date, rate, tryJpy) {
    const margin = marginRequired(date, rate, tryJpy);
    if (!margin) return Infinity;
    const equity = Number(state.settings.capital) + portfolioFx(date, rate, tryJpy) + portfolioSwap(date);
    return equity / margin * 100;
  };

  findLcRate = function(date, currentRate, currentTryJpy, currentUsdJpy) {
    const usdJpy = Number(currentUsdJpy) > 0
      ? Number(currentUsdJpy)
      : Number(currentRate) * Number(currentTryJpy);
    if (!openPositionsOn(date).length || !currentRate || !usdJpy) return null;
    const target = Number(state.settings.lcThreshold || 100);
    const f = (r) => maintenance(date, r, usdJpy / r) - target;
    const low = Math.max(0.0001, Number(currentRate) * 0.1);
    const high = Number(currentRate) * 4;
    let prevX = low;
    let prevF = f(low);
    let bracket = null;
    for (let i = 1; i <= 500; i++) {
      const x = low + (high - low) * i / 500;
      const fx = f(x);
      if (Number.isFinite(prevF) && Number.isFinite(fx) && prevF * fx <= 0) {
        bracket = [prevX, x];
        break;
      }
      prevX = x;
      prevF = fx;
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
  };

  derivedDaily = function() {
    let prevTotal = 0;
    return sortedDaily().map((d) => {
      const rate = Number(d.rate);
      const usdJpy = usdJpyValueV2(d);
      const tj = tryJpyValueV2(d);
      const fxPnl = portfolioFx(d.date, rate, tj);
      const swap = portfolioSwap(d.date);
      const total = fxPnl + swap;
      const row = {
        ...d,
        rate,
        usdJpy,
        tryJpy: tj,
        fxPnl,
        swap,
        dailySwap: dailySwapCreditHirose(d.date),
        total,
        dailyPnl: total - prevTotal,
        lots: grossLotsOn(d.date),
        signedLots: signedLotsOn(d.date),
        marginPer1000: marginPer1000Hirose(usdJpy)
      };
      row.margin = marginRequired(d.date, rate, tj);
      row.maintenance = maintenance(d.date, rate, tj);
      row.lc = findLcRate(d.date, rate, tj, usdJpy);
      prevTotal = total;
      return row;
    });
  };

  const ensureHiroseSettingsUi = () => {
    if ($('settingSwapMode')) return;
    const defaultSwapLabel = $('settingSwap')?.closest('label');
    if (!defaultSwapLabel) return;
    const label = document.createElement('label');
    label.className = 'hirose-swap-mode-setting';
    label.innerHTML = '<span>Swap入力 <em>方式</em></span><select id="settingSwapMode"><option value="manual">手動</option><option value="hirose">ヒロセ通商 自動</option></select><small id="hiroseFeedStatus">取得中…</small>';
    defaultSwapLabel.after(label);

    const style = document.createElement('style');
    style.textContent = `
      .hirose-swap-mode-setting select{border:1px solid var(--line2);background:#0a0d12;color:var(--text);border-radius:9px;padding:11px 12px;outline:none;width:100%}
      .hirose-swap-mode-setting small{display:block;color:var(--muted2);font-size:8px;line-height:1.55;margin-top:7px;font-weight:500}
      .swap-source-note{display:block;margin-top:5px;color:var(--muted2);font-size:7.5px;line-height:1.45;font-weight:500}
      input[data-hirose-auto="1"]{opacity:.86;background:#0e1317!important}
    `;
    document.head.appendChild(style);

    $('settingSwapMode').value = getSwapMode();
    $('settingSwapMode').addEventListener('change', () => {
      setSwapMode($('settingSwapMode').value);
      updateHiroseUi();
      fillDailyForm('daily', $('dailyDate')?.value || isoToday());
      fillDailyForm('quickDaily', $('quickDailyDate')?.value || isoToday());
      toast(getSwapMode() === 'hirose' ? 'ヒロセ通商のSwap自動入力に切り替えました' : 'Swapを手動入力に切り替えました');
    });
  };

  const ensureSwapSourceNote = (prefix) => {
    const input = $(prefix + 'Swap');
    if (!input) return null;
    const label = input.closest('label');
    if (!label) return null;
    let note = label.querySelector('.swap-source-note');
    if (!note) {
      note = document.createElement('small');
      note.className = 'swap-source-note';
      label.appendChild(note);
    }
    return note;
  };

  const autoSwapForDate = (date) => hiroseSiteLotValues(date);

  const applySwapInputMode = (prefix, date) => {
    const input = $(prefix + 'Swap');
    if (!input) return;
    const note = ensureSwapSourceNote(prefix);
    if (getSwapMode() !== 'hirose') {
      input.readOnly = false;
      delete input.dataset.hiroseAuto;
      if (note) note.textContent = '手動入力';
      return;
    }

    input.readOnly = true;
    input.dataset.hiroseAuto = '1';
    const auto = autoSwapForDate(date);
    if (!auto) {
      input.value = '';
      if (note) note.textContent = hiroseFeedError ? 'ヒロセデータ取得エラー' : 'この日のヒロセSwapは未取得';
      return;
    }
    input.value = String(auto.shortPerLot);
    if (note) note.textContent = `ヒロセ USD/TRY 売り · ${auto.row.days}日分 · 1,000通貨 ${auto.row.sellJpy}円 → ${Number(state.settings.unitsPerLot).toLocaleString()}通貨 ${auto.shortPerLot.toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
  };

  const updateFeedStatus = () => {
    const el = $('hiroseFeedStatus');
    if (!el) return;
    if (hiroseFeedError) {
      el.textContent = `取得エラー: ${hiroseFeedError}`;
      return;
    }
    const rows = hiroseFeed?.history || [];
    const latest = rows[rows.length - 1];
    el.textContent = latest
      ? `USD/TRY公式データ · 最新 ${latest.date} · ${latest.days}日分 · 自動更新`
      : 'USD/TRY公式データを取得中…';
  };

  const updateHiroseUi = () => {
    ensureHiroseSettingsUi();
    const mode = getSwapMode();
    if ($('settingSwapMode')) $('settingSwapMode').value = mode;
    if ($('settingSwap')) $('settingSwap').disabled = mode === 'hirose';
    updateFeedStatus();
    document.documentElement.dataset.swapInputMode = mode;
  };

  const baseFillDailyFormHirose = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormHirose(prefix, date);
    applySwapInputMode(prefix, date);
  };

  saveDailyFrom = function(prefix) {
    const date = $(prefix + 'Date')?.value;
    const rate = Number($(prefix + 'Rate')?.value);
    const usdJpy = Number($(prefix + 'UsdJpy')?.value);
    if (!date || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(usdJpy) || usdJpy <= 0) {
      toast('日付・USD/TRY・USD/JPYを入力してください');
      return false;
    }

    let swapPerLot;
    let sourceFields = {};
    if (getSwapMode() === 'hirose') {
      const auto = autoSwapForDate(date);
      if (!auto) {
        toast('この日のヒロセUSD/TRY Swapをまだ取得できていません');
        return false;
      }
      swapPerLot = auto.shortPerLot;
      sourceFields = {
        swapSource: 'hirose',
        swapLongPerLot: auto.longPerLot,
        swapSourceDays: Number(auto.row.days || 0),
        swapSourceUnit: Number(auto.row.unit || 1000),
        swapSourceSellJpy: Number(auto.row.sellJpy || 0),
        swapSourceBuyJpy: Number(auto.row.buyJpy || 0)
      };
    } else {
      const rawSwap = $(prefix + 'Swap')?.value;
      swapPerLot = rawSwap === '' || rawSwap == null ? Number(state.settings.defaultSwap || 0) : Number(rawSwap);
      if (!Number.isFinite(swapPerLot)) {
        toast('Swap / lot を確認してください');
        return false;
      }
    }

    const tryJpy = usdJpy / rate;
    const row = { date, rate, usdJpy, tryJpy, swapPerLot, ...sourceFields };
    const idx = state.daily.findIndex((d) => d.date === date);
    if (idx >= 0) state.daily[idx] = row;
    else state.daily.push(row);
    calendarCursor = monthFromLatest();
    saveState(idx >= 0 ? '日次データを更新しました' : '日次データを保存しました');
    return true;
  };

  const baseRenderRiskFactsHirose = renderRiskFacts;
  renderRiskFacts = function() {
    baseRenderRiskFactsHirose();
    const s = latestSnapshot();
    const host = $('riskFacts');
    if (!s || !host) return;
    const facts = host.querySelectorAll('.risk-fact');
    if (facts[1]) {
      const label = facts[1].querySelector('span');
      if (label) label.textContent = `必要証拠金 · ${money(s.marginPer1000)}/千通貨`;
    }
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    const dateInput = $(prefix + 'Date');
    dateInput?.addEventListener('change', () => applySwapInputMode(prefix, dateInput.value));
    dateInput?.addEventListener('input', () => applySwapInputMode(prefix, dateInput.value));
  });

  ensureHiroseSettingsUi();
  updateHiroseUi();
  fillDailyForm('daily', $('dailyDate')?.value || isoToday());
  fillDailyForm('quickDaily', $('quickDailyDate')?.value || isoToday());
  renderAll();

  fetch(`${HIROSE_FEED_URL}?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      if (!Array.isArray(data?.history)) throw new Error('データ形式エラー');
      hiroseFeed = data;
      hiroseFeedError = '';
      updateHiroseUi();
      applySwapInputMode('daily', $('dailyDate')?.value || isoToday());
      applySwapInputMode('quickDaily', $('quickDailyDate')?.value || isoToday());
      document.documentElement.dataset.hiroseFeedReady = '1';
    })
    .catch((error) => {
      hiroseFeedError = error?.message || String(error);
      updateHiroseUi();
      document.documentElement.dataset.hiroseFeedReady = '0';
    });

  setSwapMode(getSwapMode());
  document.documentElement.dataset.hiroseMargin = '1';
})();
