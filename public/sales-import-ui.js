(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object') module.exports = api; else root.SalesImportUI = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const Model = typeof module === 'object' ? require('./sales-import/model.js') : root.SalesImportModel;
  const Controller = typeof module === 'object' ? require('./sales-import/controller.js') : root.SalesImportController;
  const Views = typeof module === 'object' ? require('./sales-import/views.js') : root.SalesImportViews;
  function create(options = {}) {
    const cfg = {
      getState: () => ({}),
      getContext: () => ({}),
      toast: () => {},
      ...options
    };
    let dialog = null, dragDepth = 0, listening = false;
    const controller = Controller.create({
      ...cfg,
      ports: {
        paint: render,
        resetDrag,
        close
      }
    }), local = controller.state;
    const {begin, back, setFilter, movePage, setPeriod, change, bind, cancelAddition, setError, reset, discard, canApply, startFile, selectSheet, candidate, refreshSummary, addSize, apply, undoImport, paint} = controller;
    const views = Views.create({
      state: local,
      selectors: controller
    }), html = views.html;
    function isOpen() {
      return !!dialog?.open;
    }
    function show() {
      if (!dialog) {
        dialog = cfg.dialog || root.document.getElementById('sales-import-dialog');
        if (!dialog) {
          dialog = root.document.createElement('dialog');
          dialog.id = 'sales-import-dialog';
          root.document.body.appendChild(dialog);
        }
        dialog.setAttribute('aria-labelledby', 'sales-import-title');
        for (const [type, fn] of Object.entries(dialogEvents)) dialog.addEventListener(type, fn);
      }
      if (!listening && root.document) {
        for (const [type, fn] of Object.entries(dragEvents)) root.document.addEventListener(type, fn);
        listening = true;
      }
      if (!dialog.open) {
        if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      }
      paint();
    }
    function open(initial = {}) {
      begin(initial);
      show();
      return api;
    }
    function close(reason = 'close') {
      if (local.busy) {
        cfg.toast('正在处理销售文件，请稍候。');
        return;
      }
      if (local.session && local.step !== 'done') cfg.toast('销售复核尚未应用，可重新打开继续，或选择放弃本次导入后退出。');
      resetDrag();
      if (dialog?.close) dialog.close(reason); else dialog?.removeAttribute('open');
    }
    function destroy() {
      reset();
      if (listening) {
        for (const [type, fn] of Object.entries(dragEvents)) root.document.removeEventListener(type, fn);
        listening = false;
      }
      if (dialog) {
        for (const [type, fn] of Object.entries(dialogEvents)) dialog.removeEventListener(type, fn);
        dialog.close?.();
        dialog = null;
      }
    }
    function pickFile() {
      if (!local.busy) dialog?.querySelector('[data-sales-file]')?.click();
    }
    function onClick(e) {
      if (e.target.matches?.('[data-sales-file]')) return;
      const t = e.target.closest?.('[data-sales-upload-trigger],[data-sales-start],[data-sales-map],[data-sales-apply],[data-sales-close],[data-sales-back],[data-sales-filter],[data-sales-prev],[data-sales-next],[data-sales-undo],[data-sales-retry],[data-sales-discard],[data-sales-add-size],[data-sales-remove-size]');
      if (!t || local.busy) return;
      if (t.matches('[data-sales-upload-trigger],[data-sales-start]')) pickFile(); else if (t.matches('[data-sales-add-size]')) return addSize(t.dataset.salesAddSize); else if (t.matches('[data-sales-remove-size]')) return cancelAddition(t.dataset.salesRemoveSize); else if (t.matches('[data-sales-map]')) return selectSheet(); else if (t.matches('[data-sales-apply]')) return apply(); else if (t.matches('[data-sales-close]')) close(); else if (t.matches('[data-sales-discard]')) return discard(); else if (t.matches('[data-sales-back]')) back(); else if (t.matches('[data-sales-filter]')) setFilter(t.dataset.salesFilter); else if (t.matches('[data-sales-prev],[data-sales-next]')) movePage(t.matches('[data-sales-prev]') ? -1 : 1); else if (t.matches('[data-sales-retry]')) return refreshSummary(); else if (t.matches('[data-sales-undo]')) return undoImport();
    }
    function onChange(e) {
      const t = e.target;
      if (local.busy) return;
      if (t.matches('[data-sales-file]')) {
        const files = Array.from(t.files || []);
        if (files.length > 1) setError('请每次只选择一个 .xlsx 文件。'); else return startFile(files[0]);
      } else if (t.matches('[data-sales-period]')) onInput(e); else if (t.matches('[name=sales-basis]')) change('basis', t.value); else if (t.matches('[data-sales-units-ack]')) change('unitsAcknowledged', t.checked); else if (t.matches('[data-sales-sheet]')) change('sheetId', t.value); else if (t.matches('[data-sales-title-column]')) change('titleColumn', t.value); else if (t.matches('[data-sales-quantity-column]')) change('quantityColumn', t.value); else if (t.matches('[data-sales-source]')) return change('sourceKey', t.value); else if (t.matches('[data-sales-missing]')) return change('missingPolicy', t.checked ? 'zero' : 'keep'); else if (t.matches('[data-sales-bind],[data-sales-exclude]')) {
        return bind(t.closest('[data-sales-row]')?.dataset.salesRow, t.matches('[data-sales-bind]') ? 'itemId' : 'excluded', t.matches('[data-sales-bind]') ? t.value : t.checked);
      }
    }
    function onInput(e) {
      if (!local.busy && e.target.matches('[data-sales-period]')) {
        setPeriod(e.target.value);
        const button = dialog?.querySelector('[data-sales-apply]');
        if (button) button.disabled = !canApply();
      }
    }
    function onKeyDown(e) {
      if (e.target.matches?.('[data-sales-upload-trigger]') && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        pickFile();
      }
    }
    function onCancel(e) {
      e.preventDefault();
      close();
    }
    function fileDrag(e) {
      return Array.from(e.dataTransfer?.types || []).includes('Files') || e.dataTransfer?.files?.length;
    }
    function zoneFor(e) {
      const z = e.target.closest?.('[data-sales-upload-trigger]');
      return z && dialog?.contains(z) ? z : null;
    }
    function resetDrag() {
      dragDepth = 0;
      const zone = dialog?.querySelector('[data-sales-upload-trigger]');
      zone?.removeAttribute('data-dragging');
      const label = dialog?.querySelector('[data-sales-drop-label]');
      if (label) label.textContent = '拖入销售报表，或点击选择';
    }
    function onDrag(e) {
      if (!isOpen() || !fileDrag(e)) return;
      e.preventDefault();
      const zone = zoneFor(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = zone && !local.busy ? 'copy' : 'none';
      if (zone && !local.busy) {
        if (e.type === 'dragenter') dragDepth++;
        zone.setAttribute('data-dragging', 'true');
        const label = dialog.querySelector('[data-sales-drop-label]');
        if (label) label.textContent = '松开即可读取销售报表';
      } else resetDrag();
    }
    function onDragLeave(e) {
      if (!isOpen() || !zoneFor(e)) return;
      if (zoneFor(e).contains(e.relatedTarget)) return;
      if (--dragDepth <= 0) resetDrag();
    }
    async function onDrop(e) {
      if (!isOpen() || !fileDrag(e)) return;
      e.preventDefault();
      const zone = zoneFor(e);
      resetDrag();
      if (!zone) return;
      if (local.busy) {
        cfg.toast('正在处理文件，请勿重复拖入。');
        return;
      }
      const files = Array.from(e.dataTransfer.files || []), items = Array.from(e.dataTransfer.items || []);
      if (items.some(i => i.webkitGetAsEntry?.()?.isDirectory)) {
        setError('不支持文件夹，请拖入一个 .xlsx 文件。');
        return;
      }
      if (files.length !== 1) {
        setError('请每次只拖入一个 .xlsx 文件。');
        return;
      }
      return startFile(files[0]);
    }
    function render() {
      if (dialog) dialog.innerHTML = html();
    }
    const dialogEvents = {
      click: onClick,
      change: onChange,
      input: onInput,
      keydown: onKeyDown,
      cancel: onCancel
    };
    const dragEvents = {
      dragenter: onDrag,
      dragover: onDrag,
      dragleave: onDragLeave,
      drop: onDrop,
      dragend: resetDrag
    };
    const api = {
      open,
      close,
      reset,
      destroy,
      html,
      paint,
      startFile,
      selectSheet,
      addSize,
      loadRows: refreshSummary,
      apply,
      undo: undoImport,
      buildCandidate: candidate,
      getSession: () => local.session,
      getDraft: () => ({
        additions: local.additions.map(a => ({
          ...a
        })),
        filename: local.filename,
        period: local.period,
        basis: local.basis,
        missingPolicy: local.missingPolicy,
        unitsAcknowledged: local.unitsAcknowledged,
        bindings: {
          ...local.bindings
        },
        rows: local.summary?.groups || [],
        summary: local.summary
      }),
      isOpen,
      hasUnpersistedDraft: () => !!local.session && local.step !== 'done',
      canQuit: () => !local.busy && !isOpen() && (!local.session || local.step === 'done')
    };
    return api;
  }
  return {
    create,
    buildCandidate: Model.buildCandidate
  };
});
