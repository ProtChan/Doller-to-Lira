// Presentation-only PnL date alignment.
// Accounting/cumulative totals remain owned by the canonical backend. This layer
// keeps daily calendar breakdowns aligned to the shifted Hirose credit date while
// preserving the original cumulative line-chart presentation.
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

  // Calendar breakdown uses the same visible daily buckets. The accounting function
  // itself remains untouched; only the rows passed to the calendar renderer carry
  // daily deltas derived from the already-shifted cumulative totals.
  renderCalendar = function() {
    const currentDerived = derivedDaily;
    try {
      derivedDaily = presentationRows;
      return baseRenderCalendar.apply(this, arguments);
    } finally {
      derivedDaily = currentDerived;
    }
  };

  // Restore the original cumulative overview chart design. The cumulative swap
  // series comes from canonical accounting, so its jump occurs on the shifted next
  // business-day credit date rather than the broker source date.
  renderOverviewChart = function() {
    if (activeTab !== 'overview' || typeof Chart === 'undefined' || !$('overviewChart')) return;
    destroyChart('overviewChart');
    const d = accountingDerivedDaily();
    const base = chartBase();
    base.scales.y.ticks.callback = (v) => overviewMode === 'pnl'
      ? `¥${Number(v).toLocaleString()}`
      : Number(v).toLocaleString();

    const datasets = overviewMode === 'pnl' ? [
      {
        label: '総損益',
        data: d.map((x) => x.total),
        borderColor: '#7ee787',
        backgroundColor: 'rgba(126,231,135,.06)',
        borderWidth: 2.4,
        tension: .25,
        pointRadius: 0,
        fill: true
      },
      {
        label: '為替差損益',
        data: d.map((x) => x.fxPnl),
        borderColor: '#67b3ff',
        borderWidth: 1.6,
        tension: .25,
        pointRadius: 0
      },
      {
        label: '累積Swap',
        data: d.map((x) => x.swap),
        borderColor: '#ffd166',
        borderWidth: 1.6,
        tension: .25,
        pointRadius: 0
      }
    ] : [
      {
        label: '保有lot',
        data: d.map((x) => x.lots),
        borderColor: '#67b3ff',
        backgroundColor: 'rgba(103,179,255,.05)',
        borderWidth: 2.2,
        tension: .2,
        pointRadius: 0,
        fill: true
      }
    ];

    charts.overviewChart = new Chart($('overviewChart'), {
      type: 'line',
      data: { labels: d.map((x) => x.date.slice(5)), datasets },
      options: base
    });
  };

  // Position detail also keeps the original cumulative line style. Only the
  // underlying cumulative swap timing is shifted by the accounting layer.
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
          { label: 'Net', data: rows.map((x) => x.net), borderColor: '#7ee787', backgroundColor: 'rgba(126,231,135,.05)', borderWidth: 2.2, tension: .25, pointRadius: 0, fill: true },
          { label: 'FX', data: rows.map((x) => x.fx), borderColor: '#67b3ff', borderWidth: 1.5, tension: .25, pointRadius: 0 },
          { label: 'Swap', data: rows.map((x) => x.swap), borderColor: '#ffd166', borderWidth: 1.5, tension: .25, pointRadius: 0 }
        ]
      },
      options: base
    });
  };

  const note = document.querySelector('#view-overview .chart-note');
  if (note) note.textContent = '日次スナップショット';

  root.dataset.pnlDateAlignment = '1';
  root.dataset.swapPresentationRule = 'cumulative-lines-shifted-next-business-day';

  try { renderCalendar(); } catch (_) {}
  if (activeTab === 'overview') requestAnimationFrame(() => { try { renderOverviewChart(); } catch (_) {} });
})();
