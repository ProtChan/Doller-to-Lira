// Presentation-only PnL date alignment.
// Accounting/cumulative totals remain owned by the canonical backend. This layer
// derives displayed daily movements from differences in those cumulative totals,
// so FX movement and every swap credit since the previous snapshot land in the
// same visible date bucket. Hirose swap itself is still credited by the shifted
// accounting layer on the next business day.
(() => {
  const root = document.documentElement;
  if (root.dataset.pnlDateAlignment === '1') return;

  const accountingDerivedDaily = derivedDaily;
  const baseRenderCalendar = renderCalendar;

  const presentationRows = () => {
    const rows = accountingDerivedDaily();
    let previousFx = 0;
    let previousSwap = 0;
    let previousTotal = 0;
    return rows.map((row) => {
      const fxPnl = Number(row.fxPnl || 0);
      const swap = Number(row.swap || 0);
      const total = Number.isFinite(Number(row.total)) ? Number(row.total) : fxPnl + swap;
      const next = {
        ...row,
        dailyFxPnl: fxPnl - previousFx,
        dailySwap: swap - previousSwap,
        dailyPnl: total - previousTotal
      };
      previousFx = fxPnl;
      previousSwap = swap;
      previousTotal = total;
      return next;
    });
  };

  window.__DTL_PRESENTATION_DAILY__ = () => presentationRows().map((row) => ({ ...row }));

  // Calendar breakdown must use the same visible daily buckets as the chart.
  // Temporarily substitute the presentation rows only while the existing renderer
  // runs; the canonical accounting function itself is left untouched.
  renderCalendar = function() {
    const currentDerived = derivedDaily;
    try {
      derivedDaily = presentationRows;
      return baseRenderCalendar.apply(this, arguments);
    } finally {
      derivedDaily = currentDerived;
    }
  };

  renderOverviewChart = function() {
    if (activeTab !== 'overview' || typeof Chart === 'undefined' || !$('overviewChart')) return;
    destroyChart('overviewChart');
    const d = presentationRows();
    const base = chartBase();
    base.scales.y.ticks.callback = (v) => overviewMode === 'pnl'
      ? `¥${Number(v).toLocaleString()}`
      : Number(v).toLocaleString();

    if (overviewMode === 'pnl') {
      const datasets = [
        {
          type: 'bar',
          label: '日次FX',
          data: d.map((x) => x.dailyFxPnl),
          backgroundColor: 'rgba(103,179,255,.42)',
          borderColor: '#67b3ff',
          borderWidth: 1,
          borderRadius: 2,
          categoryPercentage: .82,
          barPercentage: .9
        },
        {
          type: 'bar',
          label: '日次Swap（翌営業日計上）',
          data: d.map((x) => x.dailySwap),
          backgroundColor: 'rgba(255,209,102,.42)',
          borderColor: '#ffd166',
          borderWidth: 1,
          borderRadius: 2,
          categoryPercentage: .82,
          barPercentage: .9
        },
        {
          type: 'line',
          label: '日次Net',
          data: d.map((x) => x.dailyPnl),
          borderColor: '#7ee787',
          backgroundColor: 'rgba(126,231,135,.04)',
          borderWidth: 1.8,
          tension: 0,
          pointRadius: d.length <= 40 ? 1.5 : 0,
          fill: false
        }
      ];
      charts.overviewChart = new Chart($('overviewChart'), {
        type: 'bar',
        data: { labels: d.map((x) => x.date.slice(5)), datasets },
        options: base
      });
    } else {
      charts.overviewChart = new Chart($('overviewChart'), {
        type: 'line',
        data: {
          labels: d.map((x) => x.date.slice(5)),
          datasets: [{
            label: '保有lot',
            data: d.map((x) => x.lots),
            borderColor: '#67b3ff',
            backgroundColor: 'rgba(103,179,255,.05)',
            borderWidth: 2.2,
            tension: .2,
            pointRadius: 0,
            fill: true
          }]
        },
        options: base
      });
    }
  };

  // Position detail remains cumulative, but swap must visibly jump on the actual
  // shifted credit point instead of being smoothed across the prior interval.
  renderPositionChart = function(p) {
    if (activeTab !== 'positions' || typeof Chart === 'undefined' || !$('positionPnlChart')) return;
    destroyChart('positionPnlChart');
    const rows = accountingDerivedDaily()
      .filter((d) => d.date >= p.date && (!p.closeDate || d.date <= p.closeDate))
      .map((d) => {
        const fx = positionFxAsOf(p, d.date, d.rate, d.tryJpy);
        const swap = positionSwapAsOf(p, d.date);
        return { date: d.date, fx, swap, net: fx + swap };
      });
    const base = chartBase();
    base.scales.y.ticks.callback = (v) => `¥${Number(v).toLocaleString()}`;
    charts.positionPnlChart = new Chart($('positionPnlChart'), {
      type: 'line',
      data: {
        labels: rows.map((x) => x.date.slice(5)),
        datasets: [
          { label: 'Net', data: rows.map((x) => x.net), borderColor: '#7ee787', backgroundColor: 'rgba(126,231,135,.05)', borderWidth: 2.2, tension: 0, pointRadius: 0, fill: true },
          { label: 'FX', data: rows.map((x) => x.fx), borderColor: '#67b3ff', borderWidth: 1.5, tension: 0, pointRadius: 0 },
          { label: 'Swap（翌営業日計上）', data: rows.map((x) => x.swap), borderColor: '#ffd166', borderWidth: 1.5, tension: 0, pointRadius: 0, stepped: true }
        ]
      },
      options: base
    });
  };

  const note = document.querySelector('#view-overview .chart-note');
  if (note) note.textContent = '日次FX / 翌営業日Swap / Net';

  root.dataset.pnlDateAlignment = '1';
  root.dataset.swapPresentationRule = 'cumulative-delta-per-visible-snapshot';

  try { renderCalendar(); } catch (_) {}
  if (activeTab === 'overview') requestAnimationFrame(() => { try { renderOverviewChart(); } catch (_) {} });
})();
