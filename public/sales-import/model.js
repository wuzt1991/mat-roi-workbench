(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object') module.exports = api; else root.SalesImportModel = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const S = typeof module === 'object' ? require('../sales-import.js') : root.SalesImport;
  const text = v => String(v ?? '').trim();
  const uid = () => root.crypto?.randomUUID?.() || 'sales-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  async function buildCandidate(options = {}) {
    const c = options.getContext?.() || ({}), session = options.session || ({}), planItems = options.planItems || c.plan?.items || [];
    const meta = {
      importId: options.importId || session.sessionId || uid(),
      sessionId: session.sessionId || '',
      ownerToken: session.ownerToken,
      workspaceId: c.workspaceId || '',
      storageEpoch: c.storageEpoch,
      shopId: c.shopId || '',
      planId: c.planId || '',
      filename: text(options.filename),
      period: text(options.period),
      basis: options.basis === 'units' ? 'units' : 'orders',
      missingPolicy: options.missingPolicy || 'keep',
      unitsAcknowledged: !!options.unitsAcknowledged,
      skuFingerprint: options.skuFingerprint || c.itemsFingerprint || '',
      items: planItems,
      bindings: Object.values(options.bindings || ({})),
      additions: options.additions || [],
      matchBy: options.matchBy,
      sourceKey: options.sourceKey || '',
      expectedSessionRevision: options.revision
    };
    let source;
    if (options.aggregate) source = await options.aggregate(session, meta); else if (options.fileJobs?.salesCandidate) source = await options.fileJobs.salesCandidate(session.sessionId, meta); else if (options.request && session.sessionId) source = await options.request('/api/file-sessions/' + encodeURIComponent(session.sessionId) + '/sales-candidate', {
      method: 'POST',
      body: JSON.stringify(meta)
    });
    if (!source?.items?.length && source?.total === undefined) {
      if (options.pageComplete === true && Array.isArray(options.rows)) source = {
        items: options.rows,
        total: options.rows.filter(r => !r.excluded).reduce((n, r) => n + Number(r.count || 0), 0)
      }; else throw Error('销售会话尚未生成全量汇总，请等待后台识别完成。');
    }
    return {
      ...meta,
      ...source,
      itemsFingerprint: meta.skuFingerprint,
      items: (source.items || []).map((r, i) => ({
        ...r,
        id: r.id || r.rowId || 'summary-' + i,
        itemId: r.itemId || '',
        count: ((r.count ?? r.quantity) ?? r.sales) ?? 0,
        productId: r.productId || '',
        skuId: r.skuId || '',
        excluded: !!r.excluded,
        bind: options.matchBy === 'size' ? false : !!r.bind
      }))
    };
  }
  function prepareCommit(state, payload, context = {}, workspace = {}) {
    if (!S?.prepare || !S?.apply) throw Error('销售保存规则未加载，请重新打开工作台');
    const targetPlanId = payload?.planId || context.planId || workspace.planId || state.active || '';
    const plan = state.plans.find(p => p.id === targetPlanId && !p.deleted);
    if (!plan) throw Error('目标计划不存在或已删除，请重新选择计划');
    const expectedWorkspace = context.workspaceId || workspace.workspaceId;
    const expectedEpoch = context.storageEpoch ?? workspace.storageEpoch;
    if (payload?.workspaceId !== undefined && payload.workspaceId !== expectedWorkspace) throw Error('销售候选所属工作区已变化，请重新复核');
    if (payload?.storageEpoch !== undefined && payload.storageEpoch !== expectedEpoch) throw Error('销售候选所属数据版本已变化，请重新复核');
    if (context.expectedRevision !== undefined && context.expectedRevision !== workspace.revision) throw Error('当前计划已发生变化，请重新复核销售候选');
    const fingerprint = S.fingerprint(plan);
    if (!payload?.skuFingerprint || payload.skuFingerprint !== fingerprint) throw Error('当前商品规格已发生变化，请重新复核销售候选');
    const draft = S.prepare(state, targetPlanId, payload.items || [], {
      ...payload,
      planId: targetPlanId,
      shopId: plan.shopId,
      skuFingerprint: fingerprint
    });
    draft.workspaceId = expectedWorkspace;
    draft.storageEpoch = expectedEpoch;
    draft.itemsFingerprint = fingerprint;
    const applied = S.apply(state, draft, {
      planId: targetPlanId,
      workspaceId: expectedWorkspace,
      storageEpoch: expectedEpoch
    });
    if (applied.duplicate) return {
      duplicate: true,
      undoToken: null
    };
    return {
      state: applied.state,
      undoToken: applied.undo || null,
      importId: draft.importId
    };
  }
  return {
    buildCandidate,
    prepareCommit
  };
});
