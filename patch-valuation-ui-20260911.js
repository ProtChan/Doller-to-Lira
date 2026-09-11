// Pure UI layer for the explicit TRY/JPY valuation conversion.
// Accounting and persistence live in patch-backend-final-20260911.js; this file
// intentionally does not redefine swap dates, saveDailyFrom, or derivedDaily.
(() => {
  const root = document.documentElement;
  if (root.dataset.valuationUi === '1') return;

  const savedRow = (date) => Array.isArray(state?.daily)
    ? state.daily.find((row) => row?.date === date) || null
    : null;

  const synthetic = (prefix, date) => {
    const saved = savedRow(date);
    let rate = Number(document.getElementById(`${prefix}Rate`)?.value);
    let usdJpy = Number(document.getElementById(`${prefix}UsdJpy`)?.value);
    if (!(rate > 0)) rate = Number(saved?.rate);
    if (!(usdJpy > 0)) usdJpy = Number(saved?.usdJpy);
    return rate > 0 && usdJpy > 0 ? usdJpy / rate : 0;
  };

  const ensureField = (prefix) => {
    const id = `${prefix}ValuationTryJpy`;
    if (document.getElementById(id)) return document.getElementById(id);
    const form = document.getElementById(`${prefix}Form`);
    if (!form) return null;

    const label = document.createElement('label');
    label.className = 'valuation-conversion-field';
    label.innerHTML = `円換算 TRY/JPY<input type="number" id="${id}" step="0.000001" min="0" inputmode="decimal" /><small>実口座の円換算レートがあれば入力 · <button type="button" data-synthetic-conversion="${prefix}">合成値に戻す</button></small>`;
    if (prefix === 'daily') {
      const usdJpyLabel = document.getElementById('dailyUsdJpy')?.closest('label');
      if (usdJpyLabel) usdJpyLabel.after(label); else form.appendChild(label);
    } else {
      const two = form.querySelector('.form-two');
      if (two) two.after(label); else form.appendChild(label);
    }

    const input = document.getElementById(id);
    input?.addEventListener('input', () => { input.dataset.conversionSource = 'manual'; });
    label.querySelector('[data-synthetic-conversion]')?.addEventListener('click', () => {
      const date = document.getElementById(`${prefix}Date`)?.value || '';
      const value = synthetic(prefix, date);
      input.value = value > 0 ? String(Number(value.toFixed(6))) : '';
      input.dataset.conversionSource = 'synthetic';
    });
    return input;
  };

  const sync = (prefix, date) => {
    const input = ensureField(prefix);
    if (!input || !date) return;
    const saved = savedRow(date);
    const explicit = Number(saved?.valuationTryJpy);
    if (explicit > 0) {
      input.value = String(Number(explicit.toFixed(6)));
      input.dataset.conversionSource = 'manual';
      return;
    }
    const value = synthetic(prefix, date);
    input.value = value > 0 ? String(Number(value.toFixed(6))) : '';
    input.dataset.conversionSource = 'synthetic';
  };

  const originalFill = fillDailyForm;
  fillDailyForm = function(prefix, date = isoToday()) {
    const result = originalFill.apply(this, arguments);
    queueMicrotask(() => sync(prefix, date));
    return result;
  };

  ['daily', 'quickDaily'].forEach((prefix) => {
    ensureField(prefix);
    const dateInput = document.getElementById(`${prefix}Date`);
    const rateInput = document.getElementById(`${prefix}Rate`);
    const usdJpyInput = document.getElementById(`${prefix}UsdJpy`);
    const resync = () => queueMicrotask(() => sync(prefix, dateInput?.value || ''));
    dateInput?.addEventListener('input', resync);
    dateInput?.addEventListener('change', resync);
    [rateInput, usdJpyInput].forEach((input) => input?.addEventListener('input', () => {
      const conversion = ensureField(prefix);
      if (conversion?.dataset.conversionSource === 'manual') return;
      const value = synthetic(prefix, dateInput?.value || '');
      conversion.value = value > 0 ? String(Number(value.toFixed(6))) : '';
      conversion.dataset.conversionSource = 'synthetic';
    }));
  });

  const originalRenderDailyTable = renderDailyTable;
  renderDailyTable = function() {
    const result = originalRenderDailyTable.apply(this, arguments);
    const body = document.getElementById('dailyTableBody');
    if (!body || typeof derivedDaily !== 'function') return result;
    const rows = new Map((derivedDaily() || []).map((row) => [row.date, row]));
    [...body.querySelectorAll('tr')].forEach((tr) => {
      const date = tr.children?.[0]?.textContent?.trim();
      const row = rows.get(date);
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
    return result;
  };

  const originalRenderCalendar = renderCalendar;
  renderCalendar = function() {
    const result = originalRenderCalendar.apply(this, arguments);
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
  style.dataset.valuationUi = '1';
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

  ['daily', 'quickDaily'].forEach((prefix) => sync(prefix, document.getElementById(`${prefix}Date`)?.value || ''));
  root.dataset.valuationUi = '1';
})();
