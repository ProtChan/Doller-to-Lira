// Unified Hirose USD/TRY accounting core for provider-owned Daily Data.
// Owns swap timing/entitlement and Hirose margin calculation. It intentionally has
// no manual rate/swap inputs and no Daily Data save UI.
(() => {
  const root = document.documentElement;
  if (root.dataset.hiroseCore === '1') return;

  const FEED_URL = './data/hirose-usdtry-swap.json';
  const SWAP_MODE_KEY = 'dollar-to-lira:swap-mode:v1';
  let history = [];
  let creditHistory = [];
  let creditByDate = new Map();

  localStorage.setItem(SWAP_MODE_KEY, 'hirose');
  root.dataset.swapInputMode = 'hirose';

  const parseIso = (date) => {
    const value = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(value.getTime()) ? value : null;
  };
  const iso = (value) => value.toISOString().slice(0, 10);
  const isWeekend = (date) => {
    const value = parseIso(date);
    if (!value) return false;
    const day = value.getUTCDay();
    return day === 0 || day === 6;
  };
  const nextBusinessDate = (sourceDate) => {
    const value = parseIso(sourceDate);
    if (!value) return '';
    value.setUTCDate(value.getUTCDate() + 1);
    while (value.getUTCDay() === 0 || value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() + 1);
    return iso(value);
  };
  const previousBusinessDate = (creditDate) => {
    const value = parseIso(creditDate);
    if (!value) return '';
    value.setUTCDate(value.getUTCDate() - 1);
    while (value.getUTCDay() === 0 || value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
    return iso(value);
  };

  const marginPer1000 = (usdJpy) => {
    const value = Number(usdJpy);
    if (!(value > 0)) return 0;
    return (Math.floor((value + 1e-10) / 2.5) + 1) * 100;
  };

  const scaled = (row) => {
    if (!row) return { shortPerLot: 0, longPerLot: 0 };
    const sourceUnit = Number(row.unit || 1000);
    const siteUnit = Number(state?.settings?.unitsPerLot || 1000);
    if (!(sourceUnit > 0) || !(siteUnit > 0)) return { shortPerLot: 0, longPerLot: 0 };
    const factor = siteUnit / sourceUnit;
    return {
      shortPerLot: Number(row.sellJpy || 0) * factor,
      longPerLot: Number(row.buyJpy || 0) * factor
    };
  };

  const resolution = (creditDate) => {
    if (!creditDate) return { status:'zero', sourceDate:'', creditDate:'', weekend:false, row:null, shortPerLot:0, longPerLot:0 };
    if (isWeekend(creditDate)) {
      return { status:'zero', sourceDate:previousBusinessDate(creditDate), creditDate, weekend:true, row:null, shortPerLot:0, longPerLot:0 };
    }
    const entry = creditByDate.get(creditDate) || null;
    if (entry) {
      const amount = scaled(entry.row);
      return {
        status:'official', sourceDate:entry.sourceDate, creditDate, weekend:false,
        row:{ ...entry.row }, shortPerLot:amount.shortPerLot, longPerLot:amount.longPerLot
      };
    }
    const sourceDate = previousBusinessDate(creditDate);
    const latestSource = history.at(-1)?.date || '';
    if (latestSource && sourceDate && sourceDate <= latestSource) {
      return { status:'zero', sourceDate, creditDate, weekend:false, row:null, shortPerLot:0, longPerLot:0 };
    }
    return { status:'pending', sourceDate, creditDate, weekend:false, row:null, shortPerLot:0, longPerLot:0 };
  };

  const eligibleForCredit = (position, creditDate) => Boolean(
    position?.date && creditDate && position.date < creditDate && (!position.closeDate || position.closeDate >= creditDate)
  );
  const eligibleForSource = (position, sourceDate) => eligibleForCredit(position, nextBusinessDate(sourceDate));

  const positionSwap = (position, asOfDate) => {
    const lots = Number(position?.lots || 0);
    return creditHistory
      .filter((entry) => entry.creditDate <= asOfDate && eligibleForCredit(position, entry.creditDate))
      .reduce((sum, entry) => {
        const amount = scaled(entry.row);
        const perLot = position.side === 'short' ? amount.shortPerLot : amount.longPerLot;
        return sum + lots * perLot;
      }, 0);
  };
  const portfolioSwapValue = (date) => state.positions.reduce((sum, position) => sum + positionSwap(position, date), 0);
  const dailySwapValue = (creditDate) => {
    const current = resolution(creditDate);
    if (current.status !== 'official') return 0;
    return state.positions
      .filter((position) => eligibleForCredit(position, creditDate))
      .reduce((sum, position) => {
        const perLot = position.side === 'short' ? current.shortPerLot : current.longPerLot;
        return sum + Number(position.lots || 0) * perLot;
      }, 0);
  };

  const installAccounting = () => {
    window.__DTL_MARGIN_PER_1000__ = marginPer1000;
    positionSwapAsOf = (position, date) => positionSwap(position, date);
    portfolioSwap = (date) => portfolioSwapValue(date);
    marginRequired = (date, rate, tryJpy) => {
      const units = grossLotsOn(date) * Number(state.settings.unitsPerLot || 0);
      const usdJpy = Number(rate) * Number(tryJpy);
      const per1000 = marginPer1000(usdJpy);
      return units > 0 && per1000 > 0 ? (units / 1000) * per1000 : 0;
    };
    maintenance = (date, rate, tryJpy) => {
      const margin = marginRequired(date, rate, tryJpy);
      if (!margin) return Infinity;
      const equity = Number(state.settings.capital || 0) + portfolioFx(date, rate, tryJpy) + portfolioSwapValue(date);
      return equity / margin * 100;
    };
  };

  const installPublicApi = () => {
    window.__DTL_HIROSE_HISTORY__ = () => history.map((row) => ({ ...row }));
    window.__DTL_HIROSE_CREDIT_HISTORY__ = () => creditHistory.map((entry) => ({
      sourceDate:entry.sourceDate, creditDate:entry.creditDate, row:{ ...entry.row }
    }));
    window.__DTL_HIROSE_NEXT_BUSINESS_CREDIT__ = (sourceDate) => nextBusinessDate(sourceDate);
    window.__DTL_HIROSE_SWAP_RESOLUTION__ = (creditDate) => ({ ...resolution(creditDate) });
    window.__DTL_HIROSE_SAME_DAY_SWAP_AT__ = (creditDate) => ({ ...resolution(creditDate) });
    window.__DTL_HIROSE_CREDIT_AT__ = (creditDate) => {
      const current = resolution(creditDate);
      return current.status === 'official'
        ? { sourceDate:current.sourceDate, creditDate:current.creditDate, row:{ ...current.row } }
        : null;
    };
    window.__DTL_HIROSE_ELIGIBLE_FOR_CREDIT__ = (position, creditDate) => eligibleForCredit(position, creditDate);
    window.__DTL_HIROSE_ELIGIBLE_FOR_SOURCE__ = (position, sourceDate) => eligibleForSource(position, sourceDate);
    window.__DTL_HIROSE_POSITION_SWAP__ = (position, date) => positionSwap(position, date);
    window.__DTL_HIROSE_POSITION_SWAP_ENTITLED__ = (position, date) => positionSwap(position, date);
    window.__DTL_HIROSE_DAILY_SWAP_ENTITLED__ = (date) => dailySwapValue(date);
  };

  const publishMarkers = () => {
    root.dataset.hiroseCore = '1';
    root.dataset.hiroseMargin = '1';
    root.dataset.shiftedSwapDisplay = '1';
    root.dataset.shiftedSwapAccountingActive = '1';
    root.dataset.hiroseSwapCreditRule = 'next-business-day-display-open-exclusive-close-inclusive';
    root.dataset.hiroseSwapCalendarRule = 'next-business-day-weekend-skip';
    root.dataset.hiroseSwapEntitlementRule = 'display-date-open-exclusive-close-inclusive';
    root.dataset.swapAccounting = 'fractional-internal-truncated-display';
  };

  installAccounting();
  installPublicApi();
  publishMarkers();

  fetch(`${FEED_URL}?history=${Date.now()}`, { cache:'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Hirose swap HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      history = Array.isArray(data?.history)
        ? data.history.filter((row) => row?.date && Number(row.unit || 0) > 0).sort((a,b) => String(a.date).localeCompare(String(b.date)))
        : [];
      if (!history.length) throw new Error('Hirose swap history is empty');
      creditHistory = history
        .filter((row) => !isWeekend(row.date))
        .map((row) => ({ sourceDate:row.date, creditDate:nextBusinessDate(row.date), row:{ ...row } }));
      creditByDate = new Map(creditHistory.map((entry) => [entry.creditDate, entry]));

      installAccounting();
      installPublicApi();
      root.dataset.hiroseFeedReady = '1';
      root.dataset.hiroseHistoryReady = '1';
      root.dataset.hiroseHistoryStart = history[0]?.date || '';
      root.dataset.hiroseHistoryEnd = history.at(-1)?.date || '';
      root.dataset.hiroseHistoryRecords = String(history.length);
      delete root.dataset.hiroseFeedError;
      delete root.dataset.hiroseHistoryError;
      try { window.__DTL_BACKEND_INVALIDATE__?.(); } catch (_) {}
      try { renderAll(); } catch (_) {}
    })
    .catch((error) => {
      root.dataset.hiroseFeedReady = '0';
      root.dataset.hiroseHistoryReady = '0';
      root.dataset.hiroseFeedError = error?.message || String(error);
      root.dataset.hiroseHistoryError = error?.message || String(error);
      console.warn('Unified Hirose swap feed load failed', error);
    });
})();
