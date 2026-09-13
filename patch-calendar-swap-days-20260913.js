// Calendar-only multi-day Swap badge. Daily TRY/JPY valuation input UI was retired
// when Daily Data became provider-owned.
(() => {
  const root = document.documentElement;
  if (root.dataset.calendarSwapDaysBadge === '1') return;

  const baseRenderCalendar = renderCalendar;
  renderCalendar = function() {
    const result = baseRenderCalendar.apply(this, arguments);
    if (typeof derivedDaily !== 'function') return result;
    const rows = new Map((derivedDaily() || []).map((row) => [row.date, row]));
    document.querySelectorAll('.calendar-day[data-date]').forEach((cell) => {
      const days = Number(rows.get(cell.dataset.date)?.swapSourceDays || 0);
      const existing = cell.querySelector('.swap-days-calendar');
      if (!(days > 1)) { existing?.remove(); return; }
      if (existing) { existing.textContent = `S×${days}`; return; }
      const badge = document.createElement('span');
      badge.className = 'swap-days-calendar';
      badge.textContent = `S×${days}`;
      cell.appendChild(badge);
    });
    return result;
  };

  const style = document.createElement('style');
  style.dataset.calendarSwapDaysBadge = '1';
  style.textContent = `.calendar-day{position:relative}.swap-days-calendar{position:absolute;right:5px;top:5px;font-size:6px;font-weight:900;letter-spacing:.03em;color:#d9a441}@media(max-width:700px){.swap-days-calendar{right:3px;top:3px;font-size:5.5px}}`;
  document.head.appendChild(style);

  root.dataset.calendarSwapDaysBadge = '1';
})();
