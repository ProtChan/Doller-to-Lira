// Closed USD/TRY positions must use the broker's actual TRY/JPY conversion rate
// at settlement, not the later 23:00 synthetic USDJPY/USDTRY cross.
(() => {
  const ensureCloseConversionInput = () => {
    if ($('closeTryJpy')) return $('closeTryJpy');
    const form = $('closePositionForm');
    const modalForm = form?.querySelector('.modal-form') || form?.querySelector('.close-grid') || form;
    if (!modalForm) return null;
    const label = document.createElement('label');
    label.className = 'close-conversion-field';
    label.innerHTML = '円換算レート (TRY/JPY)<input type="number" id="closeTryJpy" step="0.000001" min="0" inputmode="decimal" required /><small>ヒロセの約定履歴に表示される「円換算レート」を入力</small>';
    const footer = form?.querySelector('.modal-footer');
    if (modalForm === form && footer) footer.before(label);
    else modalForm.appendChild(label);
    if (!document.querySelector('style[data-close-conversion]')) {
      const style = document.createElement('style');
      style.dataset.closeConversion = '1';
      style.textContent = '.close-conversion-field small{display:block;margin-top:5px;color:var(--muted2);font-size:8px;line-height:1.4;font-weight:500}';
      document.head.appendChild(style);
    }
    return $('closeTryJpy');
  };

  ensureCloseConversionInput();

  const closeTryJpyValue = (p, fallback = 0) => {
    const explicit = Number(p?.closeTryJpy);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const legacy = Number(p?.closeDate ? tryJpyAt(p.closeDate) : 0);
    return legacy > 0 ? legacy : Number(fallback || 0);
  };

  const basePositionFxAsOfCloseConversion = positionFxAsOf;
  positionFxAsOf = function(p, date, rate, tryJpy) {
    if (p.date > date) return 0;
    if (p.closeDate && p.closeDate <= date) {
      return positionFx(p, Number(p.closeRate), closeTryJpyValue(p, tryJpy));
    }
    return basePositionFxAsOfCloseConversion(p, date, rate, tryJpy);
  };

  const basePositionSnapshotCloseConversion = positionSnapshot;
  positionSnapshot = function(p) {
    if (!p?.closeDate) return basePositionSnapshotCloseConversion(p);
    const asOf = p.closeDate;
    const rate = Number(p.closeRate);
    const tj = closeTryJpyValue(p, tryJpyAt(p.closeDate));
    const fx = rate > 0 && tj > 0 ? positionFx(p, rate, tj) : null;
    const swap = positionSwapAsOf(p, asOf);
    return { asOf, rate, tryJpy: tj, fx, swap, net: fx === null ? null : fx + swap, closed: true };
  };

  const baseOpenCloseDialogConversion = openCloseDialog;
  openCloseDialog = function(id) {
    const p = state.positions.find((x) => x.id === id);
    if (!p) return;
    ensureCloseConversionInput();
    baseOpenCloseDialogConversion(id);
    const date = p.closeDate || $('closeDate')?.value || latestSnapshot()?.date || isoToday();
    if ($('closeDate')) $('closeDate').value = date;
    if ($('closeRate')) $('closeRate').value = p.closeRate || latestSnapshot()?.rate || '';
    if ($('closeTryJpy')) {
      const existing = Number(p.closeTryJpy);
      const suggested = Number(tryJpyAt(date));
      $('closeTryJpy').value = existing > 0 ? String(existing) : (suggested > 0 ? String(Number(suggested.toFixed(6))) : '');
    }
  };

  const form = $('closePositionForm');
  if (form && !form.dataset.closeConversionBound) {
    form.dataset.closeConversionBound = '1';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const p = state.positions.find((x) => x.id === $('closePositionId')?.value);
      const date = $('closeDate')?.value;
      const rate = Number($('closeRate')?.value);
      const closeTryJpy = Number($('closeTryJpy')?.value);
      if (!p || !date || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(closeTryJpy) || closeTryJpy <= 0) {
        toast('決済日・決済レート・円換算レートを入力してください');
        return;
      }
      if (date < p.date) {
        toast('決済日は約定日以降にしてください');
        return;
      }
      p.closeDate = date;
      p.closeRate = rate;
      p.closeTryJpy = closeTryJpy;
      $('closePositionDialog')?.close?.();
      saveState('決済を保存しました');
    }, true);
  }

  const closeDateInput = $('closeDate');
  if (closeDateInput && !closeDateInput.dataset.closeConversionBound) {
    closeDateInput.dataset.closeConversionBound = '1';
    closeDateInput.addEventListener('change', () => {
      const p = state.positions.find((x) => x.id === $('closePositionId')?.value);
      if (p?.closeTryJpy) return;
      const suggested = Number(tryJpyAt(closeDateInput.value));
      if ($('closeTryJpy') && suggested > 0) $('closeTryJpy').value = String(Number(suggested.toFixed(6)));
    });
  }

  const baseRenderPositionDetailConversion = renderPositionDetail;
  renderPositionDetail = function() {
    baseRenderPositionDetailConversion();
    const p = state.positions.find((x) => x.id === selectedPositionId);
    if (!p?.closeDate) return;

    const actions = $('positionDetail')?.querySelector('.detail-actions');
    if (actions && !actions.querySelector('#detailEditCloseBtn')) {
      const btn = document.createElement('button');
      btn.className = 'mini-btn';
      btn.id = 'detailEditCloseBtn';
      btn.type = 'button';
      btn.textContent = '決済編集';
      actions.insertBefore(btn, actions.firstChild);
      btn.addEventListener('click', () => openCloseDialog(p.id));
    }

    const grid = $('positionDetail')?.querySelector('.detail-grid');
    if (grid && !grid.querySelector('[data-close-conversion-rate]')) {
      const cell = document.createElement('div');
      cell.dataset.closeConversionRate = '1';
      const rate = closeTryJpyValue(p);
      cell.innerHTML = `<span>円換算レート</span><strong>${rate > 0 ? num(rate, 6) : '—'}</strong>`;
      grid.appendChild(cell);
    }
  };

  window.__DTL_CLOSED_FX__ = (position) => {
    const tj = closeTryJpyValue(position);
    return position?.closeDate && Number(position.closeRate) > 0 && tj > 0
      ? positionFx(position, Number(position.closeRate), tj)
      : null;
  };

  document.documentElement.dataset.closeConversionRate = '1';
  try { renderAll(); } catch (_) {}
})();
