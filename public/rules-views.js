(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('./domain.js') : root.MatModel;
  const {e, n, money, short, roi, icon, btn, ib, sizeName, dimensions, production, field, gramField, weightText, option, empty} = typeof module === 'object' ? require('./ui-format.js') : root.WorkbenchFormat;
  const materialRuleUsable = r => r && !r.variant && r.coefficient !== '' && r.costPerSqm !== '' && Number.isFinite(Number(r.coefficient)) && Number(r.coefficient) >= 0 && Number.isFinite(Number(r.costPerSqm)) && Number(r.costPerSqm) >= 0;
  const materialDisplayCost = m => {
    const r = (m?.weightRules || []).find(x => x.default && materialRuleUsable(x)) || (m?.weightRules || []).find(materialRuleUsable);
    return r ? money(Number(r.costPerSqm)) : '—';
  };
  const shippingTypeLabels = {
    regional: '区域重量分档（内置）',
    fixed: '固定运费',
    tiers: '重量分档',
    step: '首重续重'
  };
  const shippingTypeOptions = type => type === 'regional' ? [['regional', shippingTypeLabels.regional]] : [['fixed', shippingTypeLabels.fixed], ['tiers', shippingTypeLabels.tiers], ['step', shippingTypeLabels.step]];
  function ruleText(t) {
    if (!t) return '待选模板';
    if (t.type === 'regional') return '中通区域运费 · 0–5kg 分档，5kg以上按整公斤续重 · 不含面单费';
    if (t.type === 'fixed') return `每单 ${money(t.fee)}`;
    if (t.type === 'tiers') return t.tiers.map((r, i) => `${weightText(i ? t.tiers[i - 1].upTo : 0)}–${weightText(r.upTo)} g：${money(r.fee)}`).join('；');
    return `首 ${weightText(t.firstWeight)} g ${money(t.firstFee)}，每续 ${weightText(t.stepWeight)} g 加 ${money(t.stepFee)}；不足一档按一档，最高 ${weightText(t.maxWeight)} g`;
  }
  const ruleTabs = [['materials', '材料库'], ['sizes', '尺寸库'], ['shipping', '运费模板'], ['pricingStrategies', '定价策略'], ['sizeSchemes', '尺寸组合'], ['promotionSchemes', '活动方案']];
  function create({state, modal, libraryTab, query = '', showDeletedRules = false, showInactiveMaterials = false}) {
    const frame = (...args) => args;
    function libraryPage() {
      const sizes = libraryTab === 'sizes', shipping = libraryTab === 'shipping', custom = ['pricingStrategies', 'sizeSchemes', 'promotionSchemes'].includes(libraryTab);
      return `<div class="page-header"><div class="page-heading"><h1>可复用规则</h1><p class="page-sub">统一维护材料、尺寸、运费和可复用方案。</p></div>${btn(custom ? 'new-reusable' : sizes ? 'new-size' : shipping ? 'new-shipping' : 'new-material', '新增' + (({
        materials: '材料',
        sizes: '尺寸',
        shipping: '运费模板'
      })[libraryTab] || ruleTabs.find(x => x[0] === libraryTab)?.[1] || '规则'), 'plus', 'primary')}</div><div class="wide-content"><nav class="tabs" aria-label="规则分类">${ruleTabs.map(([id, name]) => `<button type="button" class="tab ${id === libraryTab ? 'active' : ''}" data-action="library-tab" data-tab="${id}">${name}</button>`).join('')}</nav><div class="rule-list-toolbar"><label><input type="checkbox" data-show-deleted ${showDeletedRules ? 'checked' : ''}>显示已删除</label></div>${custom ? reusableList() : sizes ? `<div class="library-tools"><label class="search-field">${icon('search')}<input data-search aria-label="搜索规格" value="${e(query)}" placeholder="搜索规格或实际生产尺寸"></label></div><div id="size-list">${sizeList()}</div>` : shipping ? shippingList() : materialList()}</div>`;
    }
    function ruleSummary(x, key) {
      if (key === 'sizeSchemes') return x.sizeIds.map(id => sizeName(state.sizes.find(s => s.id === id))).join('、');
      if (key === 'promotionSchemes') return x.steps.map(y => y.type === 'discount' ? y.discount + ' 折' : '直减 ' + money(y.amount)).join(' → ');
      if (x.type === 'uniform') return '统一毛利 ' + x.margin + '%';
      if (x.type === 'rank') return '成本从低到高：' + x.tiers.join('% / ') + '%；后续 ' + x.fallback + '%';
      return x.baseArea + '㎡ 起 ' + x.baseMargin + '%，每增加 ' + x.stepArea + '㎡ 上涨 ' + x.stepPoints + ' 个百分点，上限 ' + x.cap + '%';
    }
    function reusableList() {
      const key = libraryTab, items = (state[key] || []).filter(x => showDeletedRules || !x.deleted);
      return `<div class="rule-cards">${items.map(x => `<article class="rule-card ${x.deleted ? 'disabled-row' : ''}"><div class="row between"><h2>${e(x.name)}</h2>${x.deleted ? '<span class="tag">已删除</span>' : ''}</div><p>${e(ruleSummary(x, key))}</p><div class="row">${x.deleted ? btn('restore-rule', '恢复', 'rotate-ccw', 'ghost', `data-kind="${key}" data-id="${e(x.id)}"`) : btn('edit-reusable', '编辑', 'pencil', 'ghost', `data-id="${e(x.id)}"`) + btn('copy-reusable', '另存方案', 'copy', 'ghost', `data-id="${e(x.id)}"`) + ib('delete-rule', '删除 ' + x.name, 'trash-2', `data-kind="${key}" data-id="${e(x.id)}"`)}</div></article>`).join('') || '<p class="note">暂无方案</p>'}</div>`;
    }
    function reusableForm() {
      const d = modal.draft, k = modal.kind;
      let body = field('方案名称', 'name', d.name, 'text', 'maxlength="80"');
      if (k === 'pricingStrategies') {
        body += `<label class="field"><span>定价方式</span><select data-field="type" aria-label="定价方式">${[['uniform', '统一毛利'], ['rank', '成本排名阶梯'], ['area', '面积递增毛利']].map(([v, t]) => option(v, t, d.type)).join('')}</select></label><div class="rule-fields stack-gap">${d.type === 'uniform' ? field('目标毛利率 / %', 'margin', d.margin) : d.type === 'area' ? [['baseArea', '基准面积 / ㎡'], ['baseMargin', '基准毛利率 / %'], ['stepArea', '递增面积 / ㎡'], ['stepPoints', '递增毛利 / 百分点'], ['cap', '毛利上限 / %']].map(([key, label]) => field(label, key, d[key])).join('') : d.tiers.map((v, i) => `<label class="field"><span>第 ${i + 1} 名毛利率 / %</span><input type="number" min="0" max="99.99" step="any" data-rank-tier="${i}" value="${e(v)}"></label>`).join('') + field('后续排名毛利率 / %', 'fallback', d.fallback)}</div>${d.type === 'rank' ? '<div class="row stack-gap">' + btn('add-rank-tier', '增加档位', 'plus', 'ghost') + btn('remove-rank-tier', '减少档位', 'minus', 'ghost', d.tiers.length <= 1 ? 'disabled' : '') + '</div>' : ''}`;
      }
      if (k === 'sizeSchemes') body += `<div class="size-choice-grid stack-gap">${sizeChoices(d.sizeIds).replaceAll('data-select-size', 'data-rule-size')}</div>`;
      if (k === 'promotionSchemes') body += `<p class="note stack-gap">活动按顺序叠加，每一步基于上一步金额。</p>${d.steps.map((step, i) => `<div class="promotion-step"><select data-activity-type="${i}" aria-label="第 ${i + 1} 步活动">${option('discount', '折扣', step.type)}${option('reduction', '直减', step.type)}</select><input type="number" data-activity-value="${i}" step="0.01" min="0.01" value="${e(step.type === 'discount' ? step.discount : step.amount)}" aria-label="第 ${i + 1} 步${step.type === 'discount' ? '折扣' : '直减金额'}"><span>${step.type === 'discount' ? '折' : '元'}</span>${ib('activity-up', '上移', 'arrow-up', `data-index="${i}" ${i ? '' : 'disabled'}`)}${ib('activity-down', '下移', 'arrow-down', `data-index="${i}" ${i === d.steps.length - 1 ? 'disabled' : ''}`)}${ib('activity-remove', '移除', 'x', `data-index="${i}"`)}</div>`).join('')}${btn('activity-add', '添加活动', 'plus', 'ghost', d.steps.length >= 10 ? 'disabled' : '')}`;
      return frame(modal.id ? '编辑方案' : '保存方案', body);
    }
    function materialList() {
      const inactiveCount = state.materials.filter(m => !m.active).length;
      const visible = state.materials.filter(m => (!m.deleted || showDeletedRules) && (m.active || showInactiveMaterials || m.deleted));
      const toggle = inactiveCount ? btn('toggle-inactive-materials', showInactiveMaterials ? '隐藏停用材料' : `显示停用材料（${inactiveCount}）`, 'eye', 'ghost') : '';
      return `<div class="section-head library-intro"><p class="note">每种材料只维护厚度子规则；重量系数和规则成本由子规则决定。旧版字段仅作兼容保留。</p><div class="row">${toggle}</div></div><div class="table-scroll"><table class="material-table"><thead><tr>${['材料名称', '厚度规则', '当前成本 / ㎡', '最近报价', '状态', '操作'].map(x => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${visible.map(m => `<tr><td><strong>${e(m.name)}</strong></td><td><details><summary>${(m.weightRules || []).filter(r => !r.variant).length} 条规则</summary><div class="note">${(m.weightRules || []).filter(r => !r.variant).map(r => `${e(r.thickness === undefined || r.thickness === '' ? '不限厚度' : r.thickness + ' mm')} · 系数 ${n(r.coefficient, 2)} · 成本 ${money(r.costPerSqm)}${r.default ? ' · 默认' : ''}`).join('<br>') || '暂无厚度规则'}</div></details></td><td class="num material-unit-price">${materialDisplayCost(m)}</td><td>${e(m.history?.at(-1)?.date || '—')}</td><td>${m.active ? '启用' : '停用'}</td><td><div class="row">${btn('material', '编辑材料规则', '', 'ghost', `data-id="${m.id}"`)}${btn('toggle-material', m.active ? '停用' : '启用', '', 'ghost', `data-id="${m.id}"`)}${m.deleted ? btn('restore-rule', '恢复', 'rotate-ccw', 'ghost', `data-kind="materials" data-id="${m.id}"`) : ib('delete-rule', '删除 ' + m.name, 'trash-2', `data-kind="materials" data-id="${m.id}"`)}</div></td></tr>`).join('') || '<tr><td colspan="6" class="note">暂无启用材料</td></tr>'}</tbody></table></div>`;
    }
    function sizeList() {
      const list = state.sizes.filter(s => (showDeletedRules || !s.deleted) && (sizeName(s) + ' ' + dimensions(s)).includes(query));
      return list.length ? `<div class="table-scroll"><table class="size-table"><thead><tr>${['商品规格', '实际生产尺寸', '生产面积 / ㎡', '状态', '操作'].map(x => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${list.map(s => `<tr><td><strong>${e(sizeName(s))}</strong></td><td>${e(production(s))}</td><td>${n(M.productionArea(s), 4)}</td><td><span class="tag ${s.needsReview ? 'amber' : ''}">${s.needsReview ? '待补生产尺寸' : s.active ? '启用' : '停用'}</span></td><td>${btn('edit-size', '编辑', '', 'ghost', `data-id="${s.id}" aria-label="编辑 ${e(sizeName(s))}"`)}${s.deleted ? btn('restore-rule', '恢复', 'rotate-ccw', 'ghost', `data-kind="sizes" data-id="${s.id}"`) : btn('toggle-size', s.active ? '停用' : '启用', '', 'ghost', `data-id="${s.id}"`) + ib('delete-rule', '删除 ' + sizeName(s), 'trash-2', `data-kind="sizes" data-id="${s.id}"`)}</td></tr>`).join('')}</tbody></table></div>` : empty('没有匹配的规格', '可以新增公共规格供所有计划使用。', 'new-size', '新增规格');
    }
    function shippingList() {
      return `<p class="note library-intro">每个计划选择一个模板。重量均为含包装的发货重量，区间包含上限。</p><div class="shipping-grid">${state.shippingTemplates.filter(t => showDeletedRules || !t.deleted).map(t => `<article class="shipping-card"><div class="row between"><h2>${e(t.name)}</h2><span class="tag">${shippingTypeLabels[t.type] || '未知计费方式'}</span></div><p>${e(ruleText(t))}</p><div class="row">${btn('shipping', '编辑规则', 'pencil', '', `data-id="${t.id}"`)}${btn('toggle-shipping', t.active ? '停用' : '启用', '', 'ghost', `data-id="${t.id}"`)}${t.deleted ? btn('restore-rule', '恢复', 'rotate-ccw', 'ghost', `data-kind="shippingTemplates" data-id="${t.id}"`) : ib('delete-rule', '删除 ' + t.name, 'trash-2', `data-kind="shippingTemplates" data-id="${t.id}"`)}</div></article>`).join('')}</div>`;
    }
    function sizeChoices(ids = []) {
      return state.sizes.filter(s => s.active || ids.includes(s.id)).map(s => `<label class="select-size"><input type="checkbox" data-select-size="${s.id}" ${ids.includes(s.id) ? 'checked' : ''}><span class="size-mark"></span><div><strong>${e(sizeName(s))}</strong><div class="note">实际生产 ${e(production(s))}</div></div></label>`).join('');
    }
    function sizeForm() {
      const d = modal.draft;
      return frame(modal.id ? '编辑规格' : '新增规格', `<p class="dialog-note">填写实际生产尺寸，用于计算面积、重量和成本。历史账目保持原值。</p><div class="size-form-layout"><div class="size-fields">${field('规格名称（可选）', 'name', d.name, 'text', 'maxlength="80"')}<div class="form-group-title">实际生产尺寸</div><div class="dialog-grid">${field('生产长 / cm', 'salesW', d.salesW)}${field('生产宽 / cm', 'salesH', d.salesH)}</div></div><aside class="size-preview"><div class="shape-illustration"><span></span></div><span class="note">生产面积</span><strong id="area-preview">${n(M.productionArea({
        ...d,
        needsReview: false
      }), 4)} ㎡</strong><p class="note">材料成本 = 生产面积 × 材料单价</p></aside></div>`);
    }
    function shippingRuleFields(t) {
      if (t.type === 'regional') return `<p class="note">内置普通省份最高常规价，按重量区间计算；偏远四省需人工核价。表格中的面单费已忽略。</p>`;
      if (t.type === 'fixed') return field('每单运费 / 元', 'fee', t.fee);
      if (t.type === 'step') return `<div class="dialog-grid">${gramField('首重 / g', 'firstWeight', t.firstWeight)}${field('首重费用 / 元', 'firstFee', t.firstFee)}${gramField('续重 / g', 'stepWeight', t.stepWeight)}${field('每续重费用 / 元', 'stepFee', t.stepFee)}${gramField('最高支持重量 / g', 'maxWeight', t.maxWeight)}</div><p class="note stack-gap">超过首重后，不足一个续重按一个收取。</p>`;
      return `<div class="tier-rows"><div class="tier-head"><span>重量上限（含）/ g</span><span>整单运费 / 元</span></div>${t.tiers.map((r, i) => `<div class="tier-row"><input type="number" data-tier="${i}" data-key="upTo" data-unit="g" aria-label="第 ${i + 1} 档重量上限 / g" value="${e(M.toGrams(r.upTo))}" step="any"><input type="number" data-tier="${i}" data-key="fee" aria-label="第 ${i + 1} 档运费" value="${e(r.fee)}" step="any">${ib('remove-tier', '移除第 ' + (i + 1) + ' 档', 'x', `data-index="${i}" ${t.tiers.length === 1 ? 'disabled' : ''}`)}</div>`).join('')}</div>${btn('add-tier', '增加重量档', 'plus', 'ghost')}<p class="note">上限需从小到大填写。第一档从 0 g 起，后续档不含前一档上限，超出最后一档时提示。</p>`;
    }
    function materialRuleFields(d) {
      return `<div class="section-head stack-gap"><h3 class="form-group-title">厚度规则</h3>${btn('add-material-rule', '新增厚度规则', 'plus', 'ghost')}</div><div class="material-rule-editor">${(d.weightRules || []).map((r, i) => ({
        r,
        i
      })).filter(x => !x.r.variant && !x.r.deleted).map(({r, i}, displayIndex) => `<div class="dialog-grid material-rule-row"><label class="field"><span>厚度 / mm</span><input type="text" data-material-rule="${i}" data-rule-key="thickness" value="${e(r.thickness ?? '')}" aria-label="第 ${displayIndex + 1} 条材料规则厚度"></label><label class="field"><span>重量系数</span><input type="number" data-material-rule="${i}" data-rule-key="coefficient" value="${e(r.coefficient)}" min="0" step="any" aria-label="第 ${displayIndex + 1} 条材料规则重量系数"></label><label class="field"><span>规则成本 / ㎡</span><input type="number" data-material-rule="${i}" data-rule-key="costPerSqm" value="${e(r.costPerSqm)}" min="0" step="any" aria-label="第 ${displayIndex + 1} 条材料规则成本"></label><label class="checkbox-field"><input type="checkbox" data-material-rule="${i}" data-rule-key="default" ${r.default ? 'checked' : ''}>默认规则</label>${ib('remove-material-rule', '删除第 ' + (displayIndex + 1) + ' 条规则', 'trash-2', `data-index="${i}"`)}</div>`).join('')}</div>`;
    }
    function materialForm() {
      const d = modal.draft;
      return frame(modal.id ? '编辑材料规则' : '新增材料', `${field('材料名称', 'name', d.name, 'text', 'maxlength="80"')}${field('报价备注', 'note', d.note, 'text', 'maxlength="200"')}${materialRuleFields(d)}<p class="note stack-gap">每个厚度规则填写最终每㎡成本和重量系数；材料主单价不再单独维护。</p>`);
    }
    function shippingForm() {
      const d = modal.draft;
      return frame(modal.id ? '编辑运费规则' : '新增运费模板', `${field('模板名称', 'name', d.name, 'text', 'maxlength="80" placeholder="例如：普通地区 0–2000 g"')}<label class="field"><span>计费方式</span><select data-field="type" aria-label="计费方式" ${d.type === 'regional' ? 'disabled' : ''}>${shippingTypeOptions(d.type).map(([id, l]) => option(id, l, d.type)).join('')}</select></label><div class="stack-gap">${shippingRuleFields(d)}</div><p class="note stack-gap">模板可按快递或地区命名，计划按对应报价选用。修改只更新当前试算，历史规则保留。</p>`);
    }
    return {
      libraryPage,
      ruleSummary,
      reusableList,
      reusableForm,
      materialList,
      sizeList,
      shippingList,
      sizeChoices,
      sizeForm,
      shippingRuleFields,
      materialRuleFields,
      materialForm,
      shippingForm
    };
  }
  const api = {
    create,
    materialRuleUsable,
    materialDisplayCost,
    shippingTypeLabels,
    shippingTypeOptions,
    ruleText,
    ruleTabs
  };
  if (typeof module === 'object') module.exports = api; else root.RulesViews = api;
})(typeof globalThis === 'object' ? globalThis : {});
