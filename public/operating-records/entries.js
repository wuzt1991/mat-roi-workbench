(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('../domain.js') : root.MatModel, H = typeof module === 'object' ? require('../trends.js') : root.MatTrends;
  function fail(message, selector) {
    const error = Error(message);
    error.selector = selector;
    throw error;
  }
  function validate(modal) {
    const f = modal.frame, p = f.plan, r = M.calculate(f, p);
    if (!M.validDate(modal.date) || modal.date > M.today()) {
      fail('请选择今天或过去的有效日期。', '[data-field="date"]');
      return false;
    }
    if (modal.previousId && !modal.reason.trim()) {
      fail('请填写更正原因。', '[data-field="reason"]');
      return false;
    }
    for (const key of ['spend', p.params.revenueInput === 'amount' ? 'actualGmv' : 'actualRoi', 'fee', 'tax', 'recovery', 'other', 'returnCost']) if (!M.nonnegative(p.params[key]) || ['fee', 'tax', 'recovery'].includes(key) && p.params[key] > 100) {
      fail('请填写有效的费用和比例。', `[data-entry-param="${key}"]`);
      return false;
    }
    const materials = M.frameMaterials(f), single = materials.length === 1 && materials[0].materialId === p.materialId && materials[0].ruleId === p.materialRuleId;
    for (const material of materials) if (!M.nonnegative(material.costPerSqm)) {
      fail('请填写有效的非负材料单价。', single || f.calculationVersion !== 4 ? '[data-entry-price]' : `[data-entry-material="${material.materialId}"][data-entry-rule="${material.ruleId}"]`);
    }
    if (!materials.length) fail('请填写有效的非负材料单价。', '[data-entry-price]');
    const rates = p.params.refundRates || ({}), summary = M.refundMetrics(p.params);
    for (const key of ['unshipped', 'shippedOnly', 'returnRefund', 'firstHour']) if (!(key === 'firstHour' && rates[key] === '') && (!M.nonnegative(rates[key]) || rates[key] > 100) || summary.refundTotal > 100 || summary.firstHour > summary.refundTotal) {
      fail('请核对退款率；三类合计不超过 100%，1 小时内退款率不超过合计。', `[data-entry-refund-rate="${key}"]`);
      return false;
    }
    for (const item of p.items) for (const key of ['price', 'share', 'weight']) if (key === 'price' && !M.positive(item[key]) || key === 'share' && (!M.nonnegative(item[key]) || item[key] > 100 || Math.abs(r.total - 100) > 1e-6) || key === 'weight' && item[key] !== '' && (!M.positive(item[key]) || M.shippingCost(f.shippingTemplates[0], item[key]).error)) {
      fail('请核对售价、占比和模板支持的含包装重量；占比合计需为 100%。', `[data-entry-item="${item.id || item.sizeId}"][data-key="${key}"]`);
      return false;
    }
    if (!r.valid) {
      fail(r.errors.join('；'), '[data-entry-shipping]');
      return false;
    }
    return true;
  }
  function start(state, plan, record, date = M.today()) {
    if (!record && !plan) return null;
    if (!record) {
      const existing = state.records.find(h => h.kind === 'daily' && h.status === 'confirmed' && h.planId === plan.id && h.date === date);
      if (existing) return {
        type: 'record-detail',
        id: existing.id
      };
    }
    const frame = record ? M.clone(record.frame) : M.makeFrame(state, plan);
    if (!frame) throw Error('这笔旧记录缺少完整成本，无法直接更正');
    if (!record) {
      const result = M.calculate(frame, frame.plan);
      frame.plan.params.revenueInput = 'amount';
      frame.plan.params.actualGmv = result.gmv ?? '';
    }
    return {
      type: 'entry',
      frame,
      date: record?.date || date,
      note: record?.note || '',
      reason: '',
      previousId: record?.id || null
    };
  }
  function confirm(state, draft) {
    const next = M.clone(state);
    if (!draft.committed) {
      validate(draft);
      M.confirmRecord(next, draft);
    }
    if (!M.validateBackup(next)) throw Error('入账数据未通过检查，请核对费用和规格');
    return next;
  }
  function voidRecord(state, id) {
    const next = M.clone(state), record = next.records.find(h => h.id === id);
    if (!record || record.status !== 'confirmed' || record.kind !== 'daily') throw Error('记录已变化，请重新查看');
    record.status = 'void';
    record.voidedAt = new Date().toISOString();
    return next;
  }
  const api = {
    start,
    validate,
    confirm,
    voidRecord
  };
  if (typeof module === 'object') module.exports = api; else root.OperatingEntries = api;
})(typeof globalThis === 'object' ? globalThis : {});
