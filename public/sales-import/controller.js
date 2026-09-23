// DOM adapters send values; only this controller changes review state.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object') module.exports = api; else root.SalesImportController = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const Model = typeof module === 'object' ? require('./model.js') : root.SalesImportModel;
  const text = v => String(v ?? '').trim();
  const uid = () => root.crypto?.randomUUID?.() || 'sales-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  function create(options = {}) {
    const cfg = {
      getState: () => ({}),
      getContext: () => ({}),
      toast: () => {},
      ...options
    }, ports = cfg.ports || ({});
    const local = {
      step: 'upload',
      busy: false,
      session: null,
      sheets: [],
      sheetId: '',
      mapping: {},
      quantityColumn: '',
      titleColumn: '',
      filename: '',
      period: '',
      basis: 'orders',
      unitsAcknowledged: false,
      missingPolicy: 'keep',
      sourceKey: '',
      bindings: {},
      summary: null,
      additions: [],
      error: '',
      notice: '',
      revision: 0,
      undoToken: null,
      page: 0,
      filter: 'all',
      epoch: 0,
      snapshot: null
    };
    const jobs = () => cfg.fileJobs || root.FileJobs, state = () => cfg.getState() || ({});
    const message = e => text(e?.message) || '销售导入失败，请重试。';
    const resetDrag = () => ports.resetDrag?.(), close = () => ports.close?.();
    function paint() {
      local.page = Math.max(0, Math.min(local.page, Math.max(0, Math.ceil(selectedGroups().length / 100) - 1)));
      ports.paint?.();
    }
    function context() {
      const c = cfg.getContext() || ({}), s = state(), plan = c.plan || s.plans?.find(p => p.id === (c.planId || s.active));
      return {
        ...c,
        plan,
        planId: c.planId || plan?.id || '',
        shopId: c.shopId || plan?.shopId || ''
      };
    }
    function planItems() {
      return (context().plan?.items || []).map(i => {
        const s = state().sizes?.find(s => s.id === i.sizeId), d = s && !s.needsReview ? root.MatModel?.productionDimensions?.(s) || ({
          width: s.irregular ? s.productionW : s.salesW,
          height: s.irregular ? s.productionH : s.salesH
        }) : {};
        return {
          id: i.id,
          productId: i.productId || '',
          skuId: i.skuId || '',
          width: d.width || 0,
          height: d.height || 0,
          label: d.width && d.height ? d.width + ' × ' + d.height + ' cm' : s?.name || '尺寸待完善'
        };
      });
    }
    function reviewItems() {
      return [...planItems(), ...local.additions.map(a => ({
        id: a.itemId,
        productId: '',
        skuId: '',
        width: a.width,
        height: a.height,
        label: a.width + ' × ' + a.height + ' cm（待添加）'
      }))];
    }
    function currentSnapshot() {
      const c = context();
      return {
        workspaceId: c.workspaceId,
        storageEpoch: c.storageEpoch,
        shopId: c.shopId,
        planId: c.planId,
        itemsFingerprint: c.itemsFingerprint || JSON.stringify((c.plan?.items || []).map(i => [i.id, i.productId || '', i.skuId || '']).sort((a, b) => a[0].localeCompare(b[0]))),
        items: planItems()
      };
    }
    function assertSnapshot() {
      if (JSON.stringify(local.snapshot) !== JSON.stringify(currentSnapshot())) throw Error('当前计划或商品尺寸已变化，请重新导入销售报表。');
    }
    function setError(value) {
      local.error = value;
      local.notice = '';
      paint();
    }
    function reset() {
      local.epoch++;
      local.step = 'upload';
      local.busy = false;
      local.session = null;
      local.sheets = [];
      local.sheetId = '';
      local.mapping = {};
      local.quantityColumn = '';
      local.titleColumn = '';
      local.filename = '';
      local.period = '';
      local.basis = 'orders';
      local.unitsAcknowledged = false;
      local.missingPolicy = 'keep';
      local.sourceKey = '';
      local.bindings = {};
      local.summary = null;
      local.additions = [];
      local.error = '';
      local.notice = '';
      local.revision = 0;
      local.undoToken = null;
      local.page = 0;
      local.filter = 'all';
      local.snapshot = null;
      resetDrag();
    }
    async function discard() {
      if (local.busy) return;
      const token = local.epoch;
      local.busy = true;
      paint();
      try {
        if (local.session && jobs().discard) await jobs().discard(local.session.sessionId, {
          ownerToken: local.session.ownerToken
        });
        if (token !== local.epoch) return;
        reset();
        close();
      } catch (e) {
        if (token === local.epoch) setError(message(e));
      } finally {
        if (token === local.epoch) {
          local.busy = false;
          paint();
        }
      }
    }
    function columns() {
      return local.sheets.find(s => String(s.id ?? s.sheetId) === String(local.sheetId))?.columns || [];
    }
    function selectColumns() {
      const s = local.sheets.find(s => String(s.id ?? s.sheetId) === String(local.sheetId)) || local.sheets[0];
      local.mapping = {
        ...s?.mapping || ({})
      };
      local.titleColumn = Number.isInteger(local.mapping.specName) ? String(local.mapping.specName) : '';
      chooseQuantity();
    }
    function chooseQuantity() {
      const n = local.mapping[local.basis === 'orders' ? 'orderCount' : 'unitCount'];
      local.quantityColumn = Number.isInteger(n) ? String(n) : '';
    }
    function selectedGroups() {
      const rows = local.summary?.groups || [];
      return local.filter === 'unresolved' ? rows.filter(r => !r.excluded && (!r.itemId || r.issue)) : local.filter === 'excluded' ? rows.filter(r => r.excluded) : rows;
    }
    function canApply() {
      return !!local.summary?.ready && !!local.period.trim() && (local.basis !== 'units' || local.unitsAcknowledged) && !local.busy;
    }
    async function poll(ready, token) {
      for (let i = 0; i < 240; i++) {
        if (token !== local.epoch) throw Error('导入已取消。');
        const s = await jobs().status(local.session.sessionId);
        if (s.error) throw Error(s.error.message || s.error);
        if (['failed', 'canceled', 'interrupted'].includes(s.phase)) throw Error('文件处理未完成，请重新导入。');
        if (ready(s)) return s;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw Error('文件处理仍未完成，请稍后重新读取。');
    }
    async function startFile(file) {
      if (local.busy) {
        cfg.toast('正在处理文件，请勿重复拖入。');
        return;
      }
      if (!file) return;
      if (!(/\.xlsx$/i).test(file.name)) {
        setError('请选择单个 .xlsx 销售报表。');
        return;
      }
      if (file.size === 0 || file.size > 100 * 1024 * 1024) {
        setError('文件为空或超过 100 MiB，请重新选择。');
        return;
      }
      const token = ++local.epoch;
      local.snapshot = currentSnapshot();
      local.filename = file.name;
      local.busy = true;
      local.error = '';
      local.notice = '正在读取销售报表…';
      local.summary = null;
      local.bindings = {};
      local.sourceKey = '';
      local.additions = [];
      local.undoToken = null;
      resetDrag();
      paint();
      try {
        const created = await jobs().create('sales', {
          workspaceId: local.snapshot.workspaceId,
          storageEpoch: local.snapshot.storageEpoch,
          shopId: local.snapshot.shopId,
          planId: local.snapshot.planId,
          itemsFingerprint: local.snapshot.itemsFingerprint
        });
        if (token !== local.epoch) return;
        local.session = created;
        await jobs().upload(local.session.sessionId, file, {
          ownerToken: local.session.ownerToken
        });
        const s = await poll(s => (s.candidateSheets || s.sheets || []).length > 0, token);
        if (token !== local.epoch) return;
        local.sheets = s.candidateSheets || s.sheets;
        local.revision = s.revision || 0;
        local.sheetId = String(local.sheets[0].id ?? local.sheets[0].sheetId);
        selectColumns();
        local.step = 'mapping';
        local.notice = '已识别销售字段，请核对后按尺寸汇总。';
      } catch (e) {
        if (token === local.epoch) setError(message(e));
      } finally {
        if (token === local.epoch) {
          local.busy = false;
          paint();
        }
      }
    }
    async function selectSheet() {
      if (local.busy) return;
      if (local.titleColumn === '' || local.quantityColumn === '') {
        setError('请选择商品 SKU 标题列和数量列。');
        return;
      }
      if (local.basis === 'units' && !local.unitsAcknowledged) {
        setError('请确认按成交件数估算订单占比。');
        return;
      }
      const token = local.epoch;
      local.busy = true;
      local.error = '';
      local.notice = '正在按尺寸汇总所有图案…';
      paint();
      try {
        assertSnapshot();
        await jobs().selectSheet(local.session.sessionId, {
          ownerToken: local.session.ownerToken,
          sheetId: local.sheetId,
          mapping: {
            ...local.mapping,
            specName: Number(local.titleColumn),
            sales: Number(local.quantityColumn)
          },
          basis: local.basis,
          matchBy: 'size',
          expectedSessionRevision: local.revision
        });
        const s = await poll(s => ['reviewing', 'ready', 'completed'].includes(s.phase), token);
        if (token !== local.epoch) return;
        local.revision = s.revision || 0;
        local.step = 'review';
        await refreshSummary(false);
        local.notice = '';
      } catch (e) {
        if (token === local.epoch) setError(message(e));
      } finally {
        if (token === local.epoch) {
          local.busy = false;
          paint();
        }
      }
    }
    async function candidate() {
      assertSnapshot();
      return Model.buildCandidate({
        getContext: () => local.snapshot,
        planItems: [...local.snapshot.items, ...local.additions.map(a => ({
          id: a.itemId,
          width: a.width,
          height: a.height
        }))],
        additions: local.additions,
        skuFingerprint: local.snapshot.itemsFingerprint,
        fileJobs: jobs(),
        session: local.session,
        filename: local.filename,
        period: local.period,
        basis: local.basis,
        missingPolicy: local.missingPolicy,
        unitsAcknowledged: local.unitsAcknowledged,
        matchBy: 'size',
        sourceKey: local.sourceKey,
        bindings: local.bindings,
        revision: local.revision
      });
    }
    async function refreshSummary(render = true) {
      const token = local.epoch;
      if (render) {
        if (local.busy) return;
        local.busy = true;
        local.error = '';
        paint();
      }
      try {
        const result = await candidate();
        if (token !== local.epoch) return;
        local.summary = result;
        local.sourceKey = result.sourceKey || '';
        if (!local.period && result.periods?.length === 1) local.period = result.periods[0];
        local.revision = result.revision ?? local.revision;
      } catch (e) {
        if (token === local.epoch) {
          local.summary = null;
          setError(message(e));
        }
      } finally {
        if (render && token === local.epoch) {
          local.busy = false;
          paint();
        }
      }
    }
    function removeAddition(itemId) {
      local.additions = local.additions.filter(a => a.itemId !== itemId);
      for (const [key, binding] of Object.entries(local.bindings)) if (binding.itemId === itemId) delete local.bindings[key];
    }
    async function addSize(rowId) {
      if (local.busy || local.step !== 'review') return;
      try {
        assertSnapshot();
        const row = local.summary?.groups.find(r => String(r.rowId) === String(rowId));
        if (!row?.canAdd || !row.width || !row.height) return;
        const itemId = 'item-' + uid(), sizeId = 'size-' + uid();
        local.additions.push({
          itemId,
          sizeId,
          width: row.width,
          height: row.height
        });
        local.bindings[rowId] = {
          rowId,
          itemId,
          excluded: false
        };
        await refreshSummary();
      } catch (e) {
        setError(message(e));
      }
    }
    async function apply() {
      if (!canApply()) return;
      const token = local.epoch;
      local.busy = true;
      local.step = 'applying';
      local.error = '';
      paint();
      try {
        if (cfg.flush && await cfg.flush() === false) throw Error('当前修改尚未保存，请稍后重试。');
        if (token !== local.epoch) return;
        const payload = await candidate();
        if (token !== local.epoch) return;
        if (!payload.ready) throw Error('请处理所有未匹配尺寸，并确认未出现的规格。');
        assertSnapshot();
        const c = context();
        if (!cfg.commit) throw Error('销售保存接口未接入。');
        const result = await cfg.commit(payload, {
          ...c,
          expectedRevision: c.revision,
          sessionId: local.session.sessionId
        });
        if (token !== local.epoch) return;
        local.undoToken = result?.undoToken || result?.undo || local.undoToken;
        local.snapshot = currentSnapshot();
        local.additions = [];
        if (cfg.flush && await cfg.flush() === false) throw Error('订单占比已更新，但尚未保存成功，请重试保存。');
        if (token !== local.epoch) return;
        local.step = 'done';
        cfg.toast('已按尺寸回填销量与订单占比');
      } catch (e) {
        if (token === local.epoch) {
          local.step = 'review';
          local.error = message(e);
        }
      } finally {
        if (token === local.epoch) {
          local.busy = false;
          paint();
        }
      }
    }
    async function undoImport() {
      if (local.busy || !local.undoToken) return;
      const token = local.epoch;
      local.busy = true;
      paint();
      try {
        if (!cfg.undo) throw Error('当前窗口没有撤销接口。');
        await cfg.undo(local.undoToken, context());
        if (token !== local.epoch) return;
        local.undoToken = null;
        local.snapshot = currentSnapshot();
        local.additions = [];
        const ids = new Set(local.snapshot.items.map(i => i.id));
        for (const [key, binding] of Object.entries(local.bindings)) if (!binding.excluded && !ids.has(binding.itemId)) delete local.bindings[key];
        local.step = 'review';
        await refreshSummary(false);
        if (token !== local.epoch) return;
        local.notice = '本次导入已撤销。';
      } catch (e) {
        if (token === local.epoch) local.error = message(e);
      } finally {
        if (token === local.epoch) {
          local.busy = false;
          paint();
        }
      }
    }
    function begin(initial = {}) {
      if (!local.snapshot || local.step === 'done' || JSON.stringify(local.snapshot) !== JSON.stringify(currentSnapshot())) {
        reset();
        local.snapshot = currentSnapshot();
        local.period = text(initial.period);
      }
    }
    function back() {
      if (local.busy) return;
      reset();
      local.snapshot = currentSnapshot();
      paint();
    }
    function setFilter(value) {
      if (local.busy) return;
      local.filter = value;
      local.page = 0;
      paint();
    }
    function movePage(delta) {
      if (local.busy) return;
      local.page += delta;
      paint();
    }
    function setPeriod(value) {
      if (!local.busy) local.period = value;
    }
    function change(field, value) {
      if (local.busy) return;
      switch (field) {
        case 'basis':
          local.basis = value;
          local.unitsAcknowledged = false;
          chooseQuantity();
          break;
        case 'unitsAcknowledged':
          local.unitsAcknowledged = value;
          break;
        case 'sheetId':
          local.sheetId = value;
          selectColumns();
          break;
        case 'titleColumn':
          local.titleColumn = value;
          return;
        case 'quantityColumn':
          local.quantityColumn = value;
          return;
        case 'sourceKey':
          local.sourceKey = value;
          local.page = 0;
          local.additions = [];
          local.bindings = {};
          return refreshSummary();
        case 'missingPolicy':
          local.missingPolicy = value;
          return refreshSummary();
        default:
          throw Error('未知销售字段');
      }
      paint();
    }
    function bind(id, field, value) {
      if (local.busy) return;
      const row = local.summary?.groups.find(r => String(r.rowId) === String(id));
      if (!row) return;
      if (local.additions.some(a => a.itemId === row.itemId) && (field === 'excluded' && value || field === 'itemId' && value !== row.itemId)) removeAddition(row.itemId);
      local.bindings[id] = {
        rowId: id,
        itemId: field === 'itemId' ? value : row.itemId,
        excluded: field === 'excluded' ? value : row.excluded
      };
      return refreshSummary();
    }
    function cancelAddition(itemId) {
      if (local.busy) return;
      removeAddition(itemId);
      return refreshSummary();
    }
    return {
      state: local,
      begin,
      back,
      setFilter,
      movePage,
      setPeriod,
      change,
      bind,
      cancelAddition,
      paint,
      context,
      planItems,
      reviewItems,
      currentSnapshot,
      assertSnapshot,
      setError,
      reset,
      discard,
      columns,
      selectColumns,
      chooseQuantity,
      selectedGroups,
      canApply,
      poll,
      startFile,
      selectSheet,
      candidate,
      refreshSummary,
      removeAddition,
      addSize,
      apply,
      undoImport
    };
  }
  return {
    create
  };
});
