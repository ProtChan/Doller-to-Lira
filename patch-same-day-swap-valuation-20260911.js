// Broker-date swap accounting + explicit TRY/JPY valuation conversion.
// Hirose's table date is the actual credit/trading date. USD/TRY multi-day swap is
// credited on Thursday (or the broker-published exceptional date), so do not shift
// the table row to the following business day.
(() => {
  const root = document.documentElement;
  if (root.dataset.sameDaySwapValuation === '1') return;

  const SWAP_MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  const isHiroseMode = () => root.dataset.swapInputMode === 'hirose' || localStorage.getItem(SWAP_MODE_KEY) === 'hirose';

  const parseIsoDateV4 = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const isWeekendV4 = (date) => {
    const d = parseIsoDateV4(date);
    if (!d) return false;
    return d.getUTCDay() === 0 || d.getUTCDay() === 6;
  };
  const hiroseHistoryV4 = () => {
    try {
      const rows = typeof window.__DTL_HIROSE_HISTORY__ === 'function' ? window.__DTL_HIROSE_HISTORY__() : [];
      return Array.isArray(rows) ? rows.filter((row) => row?.date).sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
    } catch (_) {
      return [];
    }
  };
  const exactSwapRowV4 = (date) => hiroseHistoryV4().find((row) => row.date === date) || null;
  const scaledSwapV4 = (row) => {
    if (!row) return { shortPerLot: 0, longPerLot: 0 };
    const sourceUnit = Number(row.unit || 1000);
    const siteUnit = Number(state.settings.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return { shortPerLot: 0, longPerLot: 0 };
    const factor = siteUnit / sourceUnit;
    return {
      shortPerLot: Number(row.sellJpy || 0) * factor,
      longPerLot: Number(row.buyJpy || 0) * factor
    };
  };
  const eligibleForSwapDateV4 = (position, date) => {
    if (!position?.date || !date) return false;
    return position.date < date && (!position.closeDate || position.closeDate >= date);
  };
  const swapResolutionV4 = (date) => {
    const row = exactSwapRowV4(date);
    if (row) {
      const scaled = scaledSwapV4(row);
      return {
        status: 'official', sourceDate: date, creditDate: date, weekend: false,
        row: { ...row }, shortPerLot: scaled.shortPerLot, longPerLot: scaled.longPerLot
      };
    }
    if (isWeekendV4(date)) {
      return { status: 'zero', sourceDate: date, creditDate: date, weekend: true, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    const rows = hiroseHistoryV4();
    const latest = rows.at(-1)?.date || '';
    if (latest && date <= latest) {
      return { status: 'zero', sourceDate: date, creditDate: date, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
    }
    return { status: 'pending', sourceDate: date, creditDate: date, weekend: false, row: null, shortPerLot: 0, longPerLot: 0 };
  };
  const swapFieldsV4 = (resolution) => {
    if (resolution.status === 'official') {
      const row = resolution.row || {};
      return {
        swapPerLot: resolution.shortPerLot,
        swapLongPerLot: resolution.longPerLot,
        swapSource: 'hirose',
        swapPending: false,
        swapSourceDate: resolution.sourceDate,
        swapCreditDate: resolution.creditDate,
        swapSourceDays: Number(row.days || 0),
        swapSourceUnit: Number(row.unit || 1000),
        swapSourceSellJpy: Number(row.sellJpy || 0),
        swapSourceBuyJpy: Number(row.buyJpy || 0)
      };
    }
    return {
      swapPerLot: 0,
      swapLongPerLot: 0,
      swapSource: resolution.status === 'pending' ? 'hirose-pending' : 'hirose-zero',
      swapPending: resolution.status === 'pending',
      swapSourceDate: resolution.sourceDate,
      swapCreditDate: resolution.creditDate,
      swapSourceDays: 0,
      swapSourceUnit: 1000,
      swapSourceSellJpy: 0,
      swapSourceBuyJpy: 0
    };
  };
  const positionSwapSameDayV4 = (position, date) => {
    const lots = Number(position?.lots || 0);
    return hiroseHistoryV4()
      .filter((row) => row.date <= date && eligibleForSwapDateV4(position, row.date))
      .reduce((sum, row) => {
        const scaled = scaledSwapV4(row);
        return sum + lots * (position.side === 'short' ? scaled.shortPerLot : scaled.longPerLot);
      }, 0);
  };
  const dailySwapSameDayV4 = (date) => {
    const resolution = swapResolutionV4(date);
    if (resolution.status !== 'official') return 0;
    return state.positions
      .filter((position) => eligibleForSwapDateV4(position, date))
      .reduce((sum, position) => sum + Number(position.lots || 0) * (position.side === 'short' ? resolution.shortPerLot : resolution.longPerLot), 0);
  };

  const syntheticTryJpyV4 = (row) => {
    const rate = Number(row?.rate);
    const usdJpy = typeof usdJpyValueV2 === 'function' ? Number(usdJpyValueV2(row)) : Number(row?.usdJpy);
    return rate > 0 && usdJpy > 0 ? usdJpy / rate : Number(row?.tryJpy || 0);
  };
  const valuationTryJpyV4 = (row) => {
    const explicit = Number(row?.valuationTryJpy);
    return explicit > 0 ? explicit : syntheticTryJpyV4(row);
  };
  const exactDailyV4 = (date) => state.daily.find((row) => row?.date === date) || null;

  // Reinstall the public helpers with broker-date semantics so all later UI listeners
  // (including the existing WebKit settle layer) resolve the same date synchronously.
  window.__DTL_HIROSE_SWAP_RESOLUTION__ = (date) => ({ ...swapResolutionV4(date) });
  window.__DTL_HIROSE_CREDIT_AT__ = (date) => {
    const resolution = swapResolutionV4(date);
    return resolution.status === 'official'
      ? { sourceDate: date, creditDate: date, row: { ...resolution.row } }
      : null;
  };
  window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__ = (date) => date;
  window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__ = (position, date) => positionSwapSameDayV4(position, date);
  window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__ = (position, date) => eligibleForSwapDateV4(position, date);
  window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ = (date) => dailySwapSameDayV4(date);
  window.__DTL_HIROSE_SAME_DAY_SWAP_AT__ = (date) => ({ ...swapResolutionV4(date) });
  window.__DTL_VALUATION_TRYJPY_AT__ = (date) => {
    const row = exactDailyV4(date);
    return row ? valuationTryJpyV4(row) : null;
  };

  const basePositionSwapV4 = positionSwapAsOf;
  positionSwapAsOf = function(position, date) {
    if (!isHiroseMode() || !hiroseHistoryV4().length) return basePositionSwapV4(position, date);
    return positionSwapSameDayV4(position, date);
  };
  const basePortfolioSwapV4 = portfolioSwap;
  portfolioSwap = function(date) {
    if (!isHiroseMode() || !hiroseHistoryV4().length) return basePortfolioSwapV4(date);
    return state.positions.reduce((sum, position) => sum + positionSwapSameDayV4(position, date), 0);
  };

  const baseTryJpyAtV4 = tryJpyAt;
  tryJpyAt = function(date) {
    const row = getDailyOnOrBefore(date);
    if (row) {
      const value = valuationTryJpyV4(row);
      if (value > 0) return value;
    }
    return baseTryJpyAtV4(date);
  };

  const baseDerivedDailyV4 = derivedDaily;
  derivedDaily = function() {
    const rows = baseDerivedDailyV4();
    let previousTotal = 0;
    let previousFx = 0;
    return rows.map((row) => {
      const rate = Number(row.rate);
      const usdJpy = typeof usdJpyValueV2 === 'function' ? Number(usdJpyValueV2(row)) : Number(row.usdJpy);
      const conversionTryJpy = valuationTryJpyV4(row);
      const fxPnl = portfolioFx(row.date, rate, conversionTryJpy);
      const swap = isHiroseMode() && hiroseHistoryV4().length ? portfolioSwap(row.date) : Number(row.swap || 0);
      const resolution = swapResolutionV4(row.date);
      const dailySwap = isHiroseMode() && hiroseHistoryV4().length ? dailySwapSameDayV4(row.date) : Number(row.dailySwap || 0);
      const total = fxPnl + swap;
      const next = {
        ...row,
        rate,
        usdJpy,
        tryJpy: conversionTryJpy,
        valuationTryJpy: Number(row.valuationTryJpy) > 0 ? Number(row.valuationTryJpy) : undefined,
        valuationTryJpySource: Number(row.valuationTryJpy) > 0 ? 'manual' : 'synthetic',
        fxPnl,
        dailyFxPnl: fxPnl - previousFx,
        swap,
        dailySwap,
        total,
        dailyPnl: total - previousTotal
      };
      if (isHiroseMode()) Object.assign(next, swapFieldsV4(resolution));
      next.margin = marginRequired(row.date, rate, conversionTryJpy);
      next.maintenance = maintenance(row.date, rate, conversionTryJpy);
      next.lc = findLcRate(row.date, rate, conversionTryJpy, rate > 0 && conversionTryJpy > 0 ? rate * conversionTryJpy : usdJpy);
      previousFx = fxPnl;
      previousTotal = total;
      return next;
    });
  };

  const ensureConversionFieldV4 = (prefix) => {
    const id = `${prefix}ValuationTryJpy`;
    if ($(id)) return $(id);
    const form = $(prefix + 'Form');
    if (!form) return null;
    const label = document.createElement('label');
    label.className = 'valuation-conversion-field';
    label.innerHTML = `円換算 TRY/JPY<input type="number" id="${id}" step="0.000001" min="0" inputmode="decimal" /><small>実口座の円換算レートがあれば入力 · <button type="button" data-synthetic-conversion="${prefix}">合成値に戻す</button></small>`;
    if (prefix === 'daily') {
      const usdJpyLabel = $('dailyUsdJpy')?.closest('label');
      if (usdJpyLabel) usdJpyLabel.after(label); else form.appendChild(label);
    } else {
      const two = form.querySelector('.form-two');
      if (two) two.after(label); else form.appendChild(label);
    }
    const input = $(id);
    input?.addEventListener('input', () => { input.dataset.conversionSource = 'manual'; });
    label.querySelector('[data-synthetic-conversion]')?.addEventListener('click', () => {
      delete input.dataset.conversionSource;
      const date = $(prefix + 'Date')?.value;
      const rate = Number($(prefix + 'Rate')?.value);
      const usdJpy = Number($(prefix + 'UsdJpy')?.value);
      input.value = rate > 0 && usdJpy > 0 ? String(Number((usdJpy / rate).toFixed(6))) : '';
      input.dataset.conversionSource = 'synthetic';
    });
    return input;
  };
  const syncConversionFieldV4 = (prefix, date) => {
    const input = ensureConversionFieldV4(prefix);
    if (!input || !date) return;
    const saved = exactDailyV4(date);
    const explicit = Number(saved?.valuationTryJpy);
    if (explicit > 0) {
      input.value = String(Number(explicit.toFixed(6)));
      input.dataset.conversionSource = 'manual';
      return;
    }
    const rate = Number($(prefix + 'Rate')?.value);
    const usdJpy = Number($(prefix + 'UsdJpy')?.value);
    input.value = rate > 0 && usdJpy > 0 ? String(Number((usdJpy / rate).toFixed(6))) : '';
    input.dataset.conversionSource = 'synthetic';
  };
  const syncSwapInputV4 = (prefix) => {
    if (!isHiroseMode()) return;
    const date = $(prefix + 'Date')?.value;
    const input = $(prefix + 'Swap');
    if (!date || !input) return;
    const resolution = swapResolutionV4(date);
    input.readOnly = true;
    input.value = String(Number(resolution.shortPerLot || 0));
    input.dataset.hiroseAuto = '1';
    delete input.dataset.hirosePending;
    delete input.dataset.hiroseZero;
    if (resolution.status === 'pending') input.dataset.hirosePending = '1';
    if (resolution.status === 'zero') input.dataset.hiroseZero = '1';
    const note = input.closest('label')?.querySelector('.swap-source-note');
    if (!note) return;
    if (resolution.status === 'official') {
      const row = resolution.row || {};
      note.textContent = `ヒロセ ${date}付与 · ${Number(row.days || 0)}日分 · ${Number(row.unit || 1000).toLocaleString()}通貨 ${Number(row.sellJpy || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円 → ${Number(state.settings.unitsPerLot || 1000).toLocaleString()}通貨 ${Number(resolution.shortPerLot || 0).toLocaleString('ja-JP', { maximumFractionDigits: 10 })}円`;
    } else if (resolution.status === 'pending') {
      note.textContent = `${date}分 未確定 → 現在0円（取得後に同日へ自動反映）`;
    } else {
      note.textContent = resolution.weekend ? `${date}は週末のためSwap 0円` : `${date}はヒロセ表記なし → Swap 0円`;
    }
  };

  const baseFillDailyFormV4 = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    baseFillDailyFormV4(prefix, date);
    setTimeout(() => {
      syncConversionFieldV4(prefix, date);
      syncSwapInputV4(prefix);
    }, 0);
  };

  const baseSaveDailyFromV4 = saveDailyFrom;
  saveDailyFrom = function(prefix) {
    const date = $(prefix + 'Date')?.value;
    const conversionInput = ensureConversionFieldV4(prefix);
    const conversion = Number(conversionInput?.value);
    const conversionSource = conversionInput?.dataset.conversionSource || 'synthetic';
    const result = baseSaveDailyFromV4(prefix);
    if (!result || !date) return result;
    const row = exactDailyV4(date);
    if (!row) return result;

    if (conversion > 0 && conversionSource === 'manual') {
      row.valuationTryJpy = conversion;
      row.valuationTryJpySource = 'manual';
    } else {
      delete row.valuationTryJpy;
      row.valuationTryJpySource = 'synthetic';
    }
    if (isHiroseMode()) Object.assign(row, swapFieldsV4(swapResolutionV4(date)));
    const fallback = syntheticTryJpyV4(row);
    row.tryJpy = Number(row.valuationTryJpy) > 0 ? Number(row.valuationTryJpy) : fallback;
    state.updatedAt = new Date(Date.now() + 1).toISOString();
    localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
    try { renderAll(); } catch (_) {}
    setTimeout(() => {
      syncConversionFieldV4(prefix, date);
      syncSwapInputV4(prefix);
    }, 0);
    return result;
  };

  const reconcileSavedRowsV4 = () => {
    if (!Array.isArray(state.daily) || !isHiroseMode()) return false;
    let changed = false;
    state.daily.forEach((row) => {
      if (!row?.date) return;
      const fields = swapFieldsV4(swapResolutionV4(row.date));
      Object.entries(fields).forEach(([key, value]) => {
        if (row[key] !== value) {
          row[key] = value;
          changed = true;
        }
      });
    });
    if (changed) {
      state.updatedAt = new Date(Date.now() + 1).toISOString();
      localStorage.setItem('dollar-to-lira:v1', JSON.stringify(state));
    }
    return changed;
  };

  const baseRenderDailyTableV4 = renderDailyTable;
  renderDailyTable = function() {
    baseRenderDailyTableV4();
    const body = $('dailyTableBody');
    if (!body) return;
    const map = new Map(derivedDaily().map((row) => [row.date, row]));
    [...body.querySelectorAll('tr')].forEach((tr) => {
      const date = tr.children?.[0]?.textContent?.trim();
      const row = map.get(date);
      if (!row) return;
      const conversionCell = tr.children?.[3];
      if (conversionCell) {
        conversionCell.innerHTML = `${rateFmt(row.tryJpy)}<small class="valuation-basis-badge ${row.valuationTryJpySource === 'manual' ? 'manual' : ''}">${row.valuationTryJpySource === 'manual' ? '実測' : '合成'}</small>`;
      }
      const swapCell = tr.children?.[4];
      if (swapCell && Number(row.swapSourceDays) > 1 && !swapCell.querySelector('.swap-days-badge')) {
        const badge = document.createElement('small');
        badge.className = 'swap-days-badge';
        badge.textContent = `${Number(row.swapSourceDays)}日分`;
        swapCell.appendChild(badge);
      }
    });
    const header = body.closest('table')?.querySelector('thead tr th:nth-child(4)');
    if (header) header.innerHTML = '円換算 TRY/JPY<br><small>実測優先</small>';
  };

  const baseRenderCalendarV4 = renderCalendar;
  renderCalendar = function() {
    baseRenderCalendarV4();
    const rows = new Map(derivedDaily().map((row) => [row.date, row]));
    document.querySelectorAll('.calendar-day[data-date]').forEach((cell) => {
      const row = rows.get(cell.dataset.date);
      if (!row || Number(row.swapSourceDays) <= 1 || cell.querySelector('.swap-days-calendar')) return;
      const badge = document.createElement('span');
      badge.className = 'swap-days-calendar';
      badge.textContent = `S×${Number(row.swapSourceDays)}`;
      cell.appendChild(badge);
    });
  };

  const style = document.createElement('style');
  style.dataset.sameDaySwapValuation = '1';
  style.textContent = `
    .valuation-conversion-field small{display:block;margin-top:4px;color:var(--muted2);font-size:8px;line-height:1.35;font-weight:500}
    .valuation-conversion-field small button{border:0;background:none;color:var(--accent);font:inherit;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
    #quickDailyForm .valuation-conversion-field{margin-top:2px}
    .valuation-basis-badge,.swap-days-badge{display:block;margin-top:2px;font-size:7px;line-height:1.15;color:#687586;font-weight:800;white-space:nowrap}
    .valuation-basis-badge.manual{color:#78c6ff}.swap-days-badge{color:#d9a441}
    .calendar-day{position:relative}.swap-days-calendar{position:absolute;right:5px;top:5px;font-size:6px;font-weight:900;letter-spacing:.03em;color:#d9a441}
    @media(max-width:700px){.valuation-conversion-field{min-width:0}.swap-days-calendar{right:3px;top:3px;font-size:5.5px}}
  `;
  document.head.appendChild(style);

  ['daily', 'quickDaily'].forEach((prefix) => {
    ensureConversionFieldV4(prefix);
    const dateInput = $(prefix + 'Date');
    const rateInput = $(prefix + 'Rate');
    const usdJpyInput = $(prefix + 'UsdJpy');
    const resync = () => setTimeout(() => {
      syncConversionFieldV4(prefix, dateInput?.value);
      syncSwapInputV4(prefix);
    }, 0);
    dateInput?.addEventListener('input', resync);
    dateInput?.addEventListener('change', resync);
    [rateInput, usdJpyInput].forEach((input) => input?.addEventListener('input', () => {
      const conversionInput = ensureConversionFieldV4(prefix);
      if (conversionInput?.dataset.conversionSource === 'manual') return;
      const rate = Number(rateInput?.value);
      const usdJpy = Number(usdJpyInput?.value);
      conversionInput.value = rate > 0 && usdJpy > 0 ? String(Number((usdJpy / rate).toFixed(6))) : '';
      conversionInput.dataset.conversionSource = 'synthetic';
    }));
  });

  const refreshV4 = () => {
    const changed = reconcileSavedRowsV4();
    root.dataset.hiroseSwapCreditRule = 'same-day-table-date';
    root.dataset.hiroseSwapCalendarRule = 'same-day-table-date';
    root.dataset.hiroseSwapEntitlementRule = 'table-date-open-exclusive-close-inclusive';
    ['daily', 'quickDaily'].forEach((prefix) => {
      syncConversionFieldV4(prefix, $(prefix + 'Date')?.value);
      syncSwapInputV4(prefix);
    });
    try { renderAll(); } catch (_) {}
    if (changed) root.dataset.sameDaySwapReconciled = '1';
  };

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => ['data-hirose-history-ready', 'data-swap-input-mode', 'data-live-rate-refresh-ready'].includes(m.attributeName))) return;
    setTimeout(refreshV4, 0);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-history-ready', 'data-swap-input-mode', 'data-live-rate-refresh-ready'] });

  const quickNote = document.querySelector('#quickDailyForm > small');
  if (quickNote) quickNote.textContent = 'USD/TRYはASKで評価。円換算TRY/JPYは実測値を優先し、未入力時のみUSD/JPY÷USD/TRYを使用。Swapはヒロセ表の日付へ同日計上。';

  root.dataset.sameDaySwapValuation = '1';
  root.dataset.hiroseSwapCreditRule = 'same-day-table-date';
  root.dataset.hiroseSwapCalendarRule = 'same-day-table-date';
  root.dataset.hiroseSwapEntitlementRule = 'table-date-open-exclusive-close-inclusive';
  refreshV4();
})();
