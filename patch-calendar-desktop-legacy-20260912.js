// Desktop-only restoration of the pre-2026-09-05 calendar visual design.
// Accounting, calendar dates, and the current compact mobile presentation stay untouched.
(() => {
  const root = document.documentElement;
  if (root.dataset.calendarDesktopLegacy === '1') return;

  const style = document.createElement('style');
  style.dataset.dtlCalendarDesktopLegacy = '1';
  style.textContent = `
    @media (min-width:821px) {
      /* Historical panel treatment from immediately before the dashboard redesign. */
      #view-calendar.active {
        background:linear-gradient(180deg,rgba(255,255,255,.018),transparent),#0e131b;
        border:1px solid #202b3a;
        border-radius:22px;
        padding:20px;
        margin-bottom:12px;
      }
      #view-calendar .calendar-header {
        align-items:center;
        margin-bottom:18px;
      }
      #view-calendar .section-kicker {
        font-size:10px;
        font-weight:800;
        letter-spacing:.19em;
        color:#66758b;
        margin-bottom:0;
      }
      #view-calendar .section-head h2 {
        margin:5px 0 0;
        font-size:18px;
        letter-spacing:-.025em;
      }
      #view-calendar .month-switch {
        gap:10px;
      }
      #view-calendar .month-switch button {
        width:36px;
        height:36px;
        display:grid;
        place-items:center;
        border-radius:11px;
        background:#111822;
        border:1px solid #202b3a;
        color:#f5f7fb;
        font-size:22px;
      }
      #view-calendar .month-switch strong {
        min-width:100px;
        text-align:center;
        font-size:13px;
      }

      /* Restore the separated rounded day cards instead of the later joined grid. */
      #view-calendar .calendar-weekdays,
      #view-calendar .calendar-grid {
        gap:7px;
        background:transparent;
      }
      #view-calendar .calendar-weekdays {
        padding-bottom:8px;
        margin-bottom:0;
      }
      #view-calendar .calendar-weekdays span {
        font-size:9px;
        color:#647187;
      }
      #view-calendar .calendar-day {
        min-height:92px;
        border:1px solid #202b3a;
        border-radius:14px;
        padding:10px;
        background:#0b1017;
        position:relative;
        overflow:hidden;
      }
      #view-calendar .calendar-day.empty {
        opacity:.25;
      }
      #view-calendar .calendar-day.today {
        box-shadow:none;
        outline:1px solid rgba(82,168,255,.8);
      }
      #view-calendar .calendar-date {
        font-size:10px;
        color:#76849a;
      }
      #view-calendar .calendar-net strong {
        font-size:13px;
        letter-spacing:-.02em;
      }
      #view-calendar .calendar-day.positive {
        background:linear-gradient(145deg,rgba(126,231,135,var(--heat,.08)),rgba(11,16,23,.8));
      }
      #view-calendar .calendar-day.negative {
        background:linear-gradient(145deg,rgba(255,107,122,var(--heat,.08)),rgba(11,16,23,.8));
      }
    }
  `;
  document.head.appendChild(style);

  root.dataset.calendarDesktopLegacy = '1';
  root.dataset.calendarDesktopStyle = 'pre-20260905-rounded-cards';
})();
