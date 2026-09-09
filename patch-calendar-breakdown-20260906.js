// Calendar V3 + Hirose integration bootstrap.
// The main runtime already fetches this file with cache:no-store, so load the Hirose
// patch here before wrapping derivedDaily. This keeps older installed PWA runtimes fresh.
(() => {
  const installCalendar = () => {
    if (document.documentElement.dataset.calendarBreakdown === '1') return;
    const baseDerivedDailyForCalendar = derivedDaily;

    derivedDaily = function() {
      const rows = baseDerivedDailyForCalendar();
      let prevFx = 0;
      return rows.map((row) => {
        const dailyFxPnl = Number(row.fxPnl || 0) - prevFx;
        prevFx = Number(row.fxPnl || 0);
        return { ...row, dailyFxPnl };
      });
    };

    const compactCalendarMoney = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}億`;
      if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`;
      return `${sign}¥${Math.trunc(abs).toLocaleString('ja-JP')}`;
    };

    const calendarMoneyMarkup = (value) => `
      <span class="calendar-value-desktop">${money(value)}</span>
      <span class="calendar-value-mobile calendar-pnl">${compactCalendarMoney(value)}</span>`;

    const calendarLabelMarkup = (desktop, mobile) => `
      <span class="calendar-label-desktop">${desktop}</span>
      <span class="calendar-label-mobile" aria-label="${desktop}" title="${desktop}">${mobile}</span>`;

    const calendarStyle = document.createElement('style');
    calendarStyle.textContent = `
      .calendar-weekdays span:first-child{color:#ff8994}
      .calendar-weekdays span:last-child{color:#7fbfff}
      .calendar-day.is-sunday .calendar-date{color:#ff8994}
      .calendar-day.is-saturday .calendar-date{color:#7fbfff}
      .calendar-metrics{margin-top:auto;display:grid;gap:5px;min-width:0}
      .calendar-net{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
      .calendar-net>span{font-size:7px;letter-spacing:.08em;color:#5d6775;font-weight:800}
      .calendar-net strong{font-size:14px;font-weight:850;letter-spacing:-.025em;min-width:0}
      .calendar-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:5px;border-top:1px solid rgba(127,138,153,.14);padding-top:5px}
      .calendar-breakdown div{min-width:0}
      .calendar-breakdown .calendar-label-desktop{display:block;font-size:6.5px;letter-spacing:.07em;color:#596373;font-weight:800}
      .calendar-breakdown strong{display:block;font-size:8px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .calendar-value-mobile,.calendar-label-mobile{display:none}
      @media(max-width:700px){
        .calendar-day{min-height:94px;padding:6px 4px;overflow:hidden}
        .calendar-date{font-size:8px}
        .calendar-metrics{gap:3px}
        .calendar-net{display:block}
        .calendar-net>span{display:none}
        .calendar-net strong{font-size:11px;display:block;margin-top:1px;white-space:nowrap;overflow:visible;text-overflow:clip;letter-spacing:-.04em}
        .calendar-breakdown{grid-template-columns:1fr;gap:2px;padding-top:4px}
        .calendar-breakdown div{display:grid;grid-template-columns:10px minmax(0,1fr);align-items:center;gap:1px}
        .calendar-breakdown strong{font-size:7px;margin:0;overflow:visible;text-overflow:clip;letter-spacing:-.035em;text-align:right}
        .calendar-value-desktop,.calendar-label-desktop{display:none!important}
        .calendar-value-mobile,.calendar-label-mobile{display:inline!important}
        .calendar-label-mobile{font-size:6px;line-height:1;color:#596373;font-weight:850;text-align:left}
      }
    `;
    document.head.appendChild(calendarStyle);

    renderCalendar = function() {
      if (!$('calendarTitle') || !$('calendarGrid')) return;
      const weekdays = document.querySelector('.calendar-weekdays');
      if (weekdays) weekdays.innerHTML = '<span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>';

      const y = calendarCursor.getFullYear();
      const m = calendarCursor.getMonth();
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      $('calendarTitle').textContent = `${y} / ${String(m + 1).padStart(2, '0')}`;

      const map = new Map(derivedDaily().map((d) => [d.date, d]));
      const monthRows = [...map.values()].filter((d) => d.date.startsWith(key));
      const maxAbs = Math.max(1, ...monthRows.map((d) => Math.abs(d.dailyPnl)));
      const total = monthRows.reduce((s, r) => s + r.dailyPnl, 0);
      const swap = monthRows.reduce((s, r) => s + r.dailySwap, 0);
      const fx = monthRows.reduce((s, r) => s + r.dailyFxPnl, 0);
      const positive = monthRows.filter((r) => r.dailyPnl > 0).length;
      const negative = monthRows.filter((r) => r.dailyPnl < 0).length;

      if ($('calendarSummary')) $('calendarSummary').innerHTML = `
        <div><span>月間損益</span><strong class="${total >= 0 ? 'positive-text' : 'negative-text'}">${money(total)}</strong></div>
        <div><span>FX計</span><strong class="${fx >= 0 ? 'positive-text' : 'negative-text'}">${money(fx)}</strong></div>
        <div><span>Swap計</span><strong class="${swap >= 0 ? 'positive-text' : 'negative-text'}">${money(swap)}</strong></div>
        <div><span>プラス日</span><strong>${positive}</strong></div>
        <div><span>マイナス日</span><strong>${negative}</strong></div>`;

      const first = new Date(y, m, 1, 12);
      const days = new Date(y, m + 1, 0, 12).getDate();
      const offset = first.getDay();
      let html = '';
      for (let i = 0; i < offset; i++) html += '<div class="calendar-day empty"></div>';

      for (let day = 1; day <= days; day++) {
        const date = `${key}-${String(day).padStart(2, '0')}`;
        const r = map.get(date);
        const dow = new Date(y, m, day, 12).getDay();
        const weekendClass = dow === 0 ? 'is-sunday' : dow === 6 ? 'is-saturday' : '';
        const cls = r ? (r.dailyPnl >= 0 ? 'positive' : 'negative') : '';
        const heat = r ? Math.min(.18, .035 + Math.abs(r.dailyPnl) / maxAbs * .145) : 0;
        html += `<div class="calendar-day ${cls} ${weekendClass} ${date === isoToday() ? 'today' : ''}" data-date="${date}" style="--heat:${heat}">
          <span class="calendar-date">${day}</span>
          ${r ? `<div class="calendar-metrics">
            <div class="calendar-net"><span>NET</span><strong class="${r.dailyPnl >= 0 ? 'positive-text' : 'negative-text'}">${calendarMoneyMarkup(r.dailyPnl)}</strong></div>
            <div class="calendar-breakdown">
              <div>${calendarLabelMarkup('FX', 'F')}<strong class="${r.dailyFxPnl >= 0 ? 'positive-text' : 'negative-text'}">${calendarMoneyMarkup(r.dailyFxPnl)}</strong></div>
              <div>${calendarLabelMarkup('SWAP', 'S')}<strong class="${r.dailySwap >= 0 ? 'positive-text' : 'negative-text'}">${calendarMoneyMarkup(r.dailySwap)}</strong></div>
            </div>
          </div>` : ''}
        </div>`;
      }
      $('calendarGrid').innerHTML = html;
    };

    renderCalendar();
    document.documentElement.dataset.calendarBreakdown = '1';
    document.documentElement.dataset.calendarMobileCompact = '1';
  };

  const hiroseReady = document.documentElement.dataset.hiroseMargin === '1'
    ? Promise.resolve()
    : fetch(`./patch-hirose-swap-margin-20260906.js?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`Hirose patch HTTP ${r.status}`);
          return r.text();
        })
        .then((source) => eval(source));

  hiroseReady
    .catch((error) => {
      console.warn('Hirose integration load failed', error);
      document.documentElement.dataset.hiroseMargin = '0';
    })
    .finally(installCalendar);
})();
