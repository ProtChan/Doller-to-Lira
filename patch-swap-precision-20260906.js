// Preserve swap fractions in accounting; truncate only when formatting JPY for display.
(() => {
  const preciseSwapForPositionDay = (p, d) => {
    const lots = Number(p?.lots || 0);
    if (d?.swapSource === 'hirose' && Number.isFinite(Number(d.swapLongPerLot))) {
      const perLot = p.side === 'short' ? Number(d.swapPerLot || 0) : Number(d.swapLongPerLot || 0);
      return lots * perLot;
    }
    const sign = p?.side === 'short' ? 1 : -1;
    return sign * lots * swapPerLotValueV2(d);
  };

  const preciseDailySwap = (date) => {
    const d = state.daily.find((row) => row.date === date);
    if (!d) return 0;
    return state.positions
      .filter((p) => isPositionOpenOn(p, date))
      .reduce((sum, p) => sum + preciseSwapForPositionDay(p, d), 0);
  };

  const installPreciseAccounting = () => {
    positionSwapAsOf = function(p, date) {
      return sortedDaily()
        .filter((d) => d.date >= p.date && d.date <= date && (!p.closeDate || d.date < p.closeDate))
        .reduce((sum, d) => sum + preciseSwapForPositionDay(p, d), 0);
    };

    portfolioSwap = function(date) {
      return state.positions.reduce((sum, p) => sum + positionSwapAsOf(p, date), 0);
    };

    derivedDaily = function() {
      let prevTotal = 0;
      let prevFx = 0;
      return sortedDaily().map((d) => {
        const rate = Number(d.rate);
        const usdJpy = usdJpyValueV2(d);
        const tj = tryJpyValueV2(d);
        const fxPnl = portfolioFx(d.date, rate, tj);
        const swap = portfolioSwap(d.date);
        const dailySwap = preciseDailySwap(d.date);
        const total = fxPnl + swap;
        const row = {
          ...d,
          rate,
          usdJpy,
          tryJpy: tj,
          fxPnl,
          dailyFxPnl: fxPnl - prevFx,
          swap,
          dailySwap,
          total,
          dailyPnl: total - prevTotal,
          lots: grossLotsOn(d.date),
          signedLots: signedLotsOn(d.date)
        };
        if (typeof window.__DTL_MARGIN_PER_1000__ === 'function') {
          row.marginPer1000 = window.__DTL_MARGIN_PER_1000__(usdJpy);
        }
        row.margin = marginRequired(d.date, rate, tj);
        row.maintenance = maintenance(d.date, rate, tj);
        row.lc = findLcRate(d.date, rate, tj, usdJpy);
        prevTotal = total;
        prevFx = fxPnl;
        return row;
      });
    };

    window.__DTL_SWAP_SNAPSHOT__ = () => {
      const rows = derivedDaily();
      const latest = rows[rows.length - 1] || null;
      return latest ? {
        date: latest.date,
        dailySwap: latest.dailySwap,
        cumulativeSwap: latest.swap,
        total: latest.total
      } : null;
    };

    window.__DTL_SWAP_CREDIT_PRECISE__ = (position, daily) => preciseSwapForPositionDay(position, daily);
    document.documentElement.dataset.swapAccounting = 'fractional-internal-truncated-display';

    const quickHelp = document.querySelector('#quickDailyForm > small');
    if (quickHelp) quickHelp.textContent = 'TRY/JPY は USD/JPY ÷ USD/TRY で内部計算。Swap は小数まで内部記録し、表示時だけ1円未満を切り捨て。';

    try { renderAll(); } catch (_) {}
  };

  installPreciseAccounting();

  // The Hirose integration is fetched asynchronously by the calendar bootstrap and
  // temporarily replaces these accounting functions. Re-apply precision as soon as
  // that integration becomes ready.
  const root = document.documentElement;
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.attributeName === 'data-hirose-margin' || m.attributeName === 'data-hirose-feed-ready')) return;
    if (root.dataset.hiroseMargin === '1') installPreciseAccounting();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-hirose-margin', 'data-hirose-feed-ready'] });
})();