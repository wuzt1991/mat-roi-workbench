// Build a candidate only. Persistence and modal lifetime belong to the shell.
(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./domain.js') : root.MatModel, typeof module === 'object' ? require('./reusable-rules.js') : root.ReusableRules);
  if (typeof module === 'object') module.exports = api; else root.RulesEditor = api;
})(typeof globalThis === 'object' ? globalThis : this, function (M, R) {
  'use strict';
  function fail(message, selector) {
    const error = Error(message);
    error.selector = selector;
    error.ruleValidation = true;
    throw error;
  }
  function save(input, editor, planId) {
    let state = M.clone(input);
    const modal = M.clone(editor), d = modal.draft, kind = modal.type;
    let addedSizeId = null;
    if (kind === 'reusable') return {
      state: R.save(state, modal.kind, {
        ...d,
        id: modal.id || M.uid('rule')
      })
    };
    if (kind === 'save-rule-copy') return {
      state: modal.kind === 'sizeSchemes' && !modal.sourceId ? R.saveSizeScheme(state, planId, d.name) : R.copy(state, modal.kind, modal.sourceId, d.name)
    };
    if (!['material', 'size', 'shipping'].includes(kind)) throw Error('未知规则编辑类型');
    if (kind === 'material' || kind === 'shipping') {
      if (!d.name.trim()) fail('请填写名称', '[data-field="name"]');
      d.name = d.name.trim();
    }
    if (kind === 'material') {
      if (state.materials.some(m => m.id !== modal.id && M.materialNameKey(m.name) === M.materialNameKey(d.name))) return fail('已有同名材料，请使用不同名称；空格、全半角和大小写不区分。', '[data-field="name"]');
      const rules = (d.weightRules || []).map((r, i) => ({
        ...r,
        id: r.id || M.uid('rule'),
        thickness: r.thickness === '' || r.thickness === undefined ? '' : Number(r.thickness),
        variant: r.variant || '',
        coefficient: r.coefficient === '' ? '' : Number(r.coefficient),
        costPerSqm: r.costPerSqm === '' ? '' : Number(r.costPerSqm),
        default: !!r.default,
        deleted: !!r.deleted
      }));
      if (!rules.length) return fail('请至少添加一条厚度规则');
      for (const [i, r] of rules.entries()) {
        if (r.thickness !== '' && (!M.positive(r.thickness) || r.thickness > 10000)) return fail('厚度需为大于 0、不超过 10000 mm 的数字；不限厚度请留空。', `[data-material-rule="${i}"][data-rule-key="thickness"]`);
        for (const key of ['coefficient', 'costPerSqm']) if (!M.nonnegative(r[key])) return fail('请填写有效的非负重量系数和规则成本。', `[data-material-rule="${i}"][data-rule-key="${key}"]`);
      }
      if (new Set(rules.filter(r => !r.deleted).map(r => `${r.thickness}|${r.variant}`)).size !== rules.filter(r => !r.deleted).length) return fail('同一材料的厚度与变体组合不能重复');
      if (!rules.some(r => !r.deleted && r.default) && rules.some(r => !r.deleted)) rules.find(r => !r.deleted).default = true;
      let m = state.materials.find(x => x.id === modal.id);
      if (!m) {
        const price = rules.find(r => r.default)?.costPerSqm ?? rules[0].costPerSqm;
        m = {
          id: M.uid('material'),
          name: d.name,
          price,
          description: '',
          active: true,
          deleted: false,
          history: []
        };
        state.materials.push(m);
      }
      const current = rules.find(r => !r.deleted && r.default) || rules.find(r => !r.deleted);
      if (!current) return fail('至少保留一条可用厚度规则');
      if (m.price !== current.costPerSqm || !m.history.length || d.note?.trim()) m.history.push({
        id: M.uid('quote'),
        date: M.today(),
        price: current.costPerSqm,
        note: d.note || '默认厚度规则'
      });
      Object.assign(m, {
        name: d.name,
        price: current.costPerSqm,
        weightRules: rules
      });
      state = R.save(state, 'materials', m);
    }
    if (kind === 'size') {
      const value = {
        id: modal.id || M.uid('size'),
        name: d.name.trim(),
        salesW: d.salesW,
        salesH: d.salesH,
        irregular: false,
        productionW: '',
        productionH: '',
        active: d.active ?? true,
        deleted: d.deleted ?? false,
        needsReview: false
      };
      if (!M.validSize(value)) {
        const key = ['salesW', 'salesH'].find(key => !M.positive(value[key]) || value[key] > 10000) || 'name';
        return fail('请填写大于 0、不超过 10000 cm 的实际生产长宽', `[data-field="${key}"]`);
      }
      const old = state.sizes.findIndex(x => x.id === modal.id);
      if (old >= 0) state.sizes[old] = value; else state.sizes.push(value);
      addedSizeId = value.id;
    }
    if (kind === 'shipping') {
      const t = {
        ...M.clone(d),
        id: modal.id || M.uid('shipping'),
        active: d.active ?? true,
        deleted: d.deleted ?? false
      };
      const existing = state.shippingTemplates.find(x => x.id === modal.id);
      if (existing?.type === 'regional') Object.assign(t, {
        type: 'regional',
        provider: existing.provider,
        rates: M.clone(existing.rates),
        ignoreWaybillFee: existing.ignoreWaybillFee
      });
      if (!M.validTemplate(t)) {
        let selector = '[data-field="name"]';
        if (t.type === 'fixed') selector = '[data-field="fee"]';
        if (t.type === 'step') {
          const key = ['firstWeight', 'firstFee', 'stepWeight', 'stepFee', 'maxWeight'].find(key => key.endsWith('Fee') ? !M.nonnegative(t[key]) : !M.positive(t[key]) || t[key] > 1000 || key === 'maxWeight' && t[key] < t.firstWeight);
          selector = `[data-field="${key || 'maxWeight'}"]`;
        }
        if (t.type === 'tiers') {
          const index = t.tiers.findIndex((r, i) => !M.positive(r.upTo) || r.upTo > 1000 || !M.nonnegative(r.fee) || i > 0 && r.upTo <= t.tiers[i - 1].upTo), key = !M.nonnegative(t.tiers[index]?.fee) ? 'fee' : 'upTo';
          selector = `[data-tier="${Math.max(0, index)}"][data-key="${key}"]`;
        }
        return fail('请检查计费规则：费用不能为负，重量需大于 0，分档上限需递增，最高重量不能低于首重', selector);
      }
      const i = state.shippingTemplates.findIndex(x => x.id === modal.id);
      if (i >= 0) state.shippingTemplates[i] = t; else state.shippingTemplates.push(t);
    }
    return {
      state,
      addedSizeId
    };
  }
  return {
    save
  };
});
