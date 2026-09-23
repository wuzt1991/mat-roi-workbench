(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('../domain.js') : root.MatModel;
  const O = typeof module === 'object' ? require('./queries.js') : root.OperatingQueries;
  const {e, n, money, roi, icon, btn, field, option, sizeName, production, paramField, refundSummaryText} = typeof module === 'object' ? require('../ui-format.js') : root.WorkbenchFormat;
  const {ruleText} = typeof module === 'object' ? require('../rules-views.js') : root.RulesViews;
  function create({state, modal}) {
    const frame = (...args) => args, shopName = id => state.shops.find(s => s.id === id)?.name || '店铺';
    function entryShipping() {
      const t = modal.frame.shippingTemplates[0], input = (key, label) => {
        const weight = ['firstWeight', 'stepWeight', 'maxWeight'].includes(key);
        return `<label class="field"><span>${label}</span><input type="number" data-entry-shipping-key="${key}" ${weight ? 'data-unit="g"' : ''} aria-label="本次 ${label}" value="${e(weight ? M.toGrams(t[key]) : t[key])}" step="any"></label>`;
      };
      const rules = t.type === 'regional' ? '<p class="note">内置区域规则，面单费不计入。</p>' : t.type === 'fixed' ? input('fee', '每单运费 / 元') : t.type === 'step' ? ['firstWeight', 'firstFee', 'stepWeight', 'stepFee', 'maxWeight'].map((k, i) => input(k, ['首重 / g', '首重费用 / 元', '续重 / g', '每续重费用 / 元', '最高重量 / g'][i])).join('') : t.tiers.map((r, i) => `<div class="dialog-grid"><label class="field"><span>第 ${i + 1} 档上限 / g</span><input type="number" data-entry-tier="${i}" data-key="upTo" data-unit="g" aria-label="本次第 ${i + 1} 档上限 / g" value="${e(M.toGrams(r.upTo))}" step="any"></label><label class="field"><span>第 ${i + 1} 档运费 / 元</span><input type="number" data-entry-tier="${i}" data-key="fee" aria-label="本次第 ${i + 1} 档运费" value="${e(r.fee)}" step="any"></label></div>`).join('');
      return `<label class="field"><span>本次采用的运费模板</span><select data-entry-shipping aria-label="入账运费模板">${option('frozen', '保持本次规则 · ' + t.name, 'frozen')}${state.shippingTemplates.filter(x => x.active).map(x => option(x.id, '采用当前模板 · ' + x.name, 'frozen')).join('')}</select></label><p class="note" id="entry-shipping-description">${e(ruleText(t))}</p><details class="advanced stack-gap"><summary>核对本次运费规则</summary><div class="stack-gap">${rules}</div><p class="note">这里填写的规则随本次账目保存。</p></details>`;
    }
    function entryMaterialFields(f) {
      if (f.calculationVersion !== 4) return '';
      const pairs = new Map();
      for (const i of f.plan.items) {
        const m = f.materials.find(x => x.id === (i.materialId || f.plan.materialId)), r = M.materialRule(m, i.materialId ? i : f.plan);
        if (m && r) pairs.set(m.id + '|' + r.id, {
          m,
          r
        });
      }
      if (pairs.size === 1) {
        const {m, r} = [...pairs.values()][0];
        if (m.id === f.plan.materialId && r.id === f.plan.materialRuleId) return '';
      }
      if (!pairs.size) return '';
      return [...pairs.values()].map(({m, r}) => `<label class="field"><span>${e(m.name)} · ${e(r.thickness === '' ? '标准厚度' : r.thickness + ' mm')} / ㎡</span><input type="number" min="0" step="any" data-entry-material="${e(m.id)}" data-entry-rule="${e(r.id)}" aria-label="${e(m.name + ' ' + r.thickness + ' 材料单价')}" value="${e(r.costPerSqm)}"></label>`).join('');
    }
    function entryForm() {
      const f = modal.frame, p = f.plan, m = f.materials.find(x => x.id === p.materialId) || f.materials[0], r = M.calculate(f, p), quotes = state.materials.find(x => x.id === m.id)?.history || m.history || [], amount = p.params.revenueInput === 'amount';
      return frame(modal.previousId ? '更正经营记录' : '记录经营数据', `<div class="entry-context"><span>${e(shopName(p.shopId))}</span>${icon('chevron-right')}<strong>${e(state.plans.find(x => x.id === p.id)?.name)}</strong><span class="tag">${modal.previousId ? '保留原记录' : '确认后计入总账'}</span></div><div class="dialog-grid operating-entry-fields">${field('记录日期', 'date', modal.date, 'date', `max="${M.today()}"`)}${field('备注（选填）', 'note', modal.note, 'text', 'maxlength="100"')}${paramField('spend', '广告消耗', '元', p.params, true)}${f.calculationVersion === 4 ? `<label class="field"><span>成交数据录入方式</span><select name="entry-revenue-mode" data-entry-revenue-mode aria-label="成交数据录入方式">${option('amount', '填写成交金额', amount ? 'amount' : 'roi')}${option('roi', '填写支付 ROI', amount ? 'amount' : 'roi')}</select></label>` : ''}${amount ? paramField('actualGmv', '支付成交金额', '元', p.params, true) : paramField('actualRoi', '支付 ROI', '', p.params, true)}<div class="operating-entry-derived"><span>${amount ? '支付 ROI（自动计算）' : '支付成交金额（自动计算）'}</span><strong id="entry-revenue-derived">${amount ? n(p.params.spend > 0 && r.gmv !== null ? r.gmv / p.params.spend : null) : money(r.gmv)}</strong></div></div><div class="operating-source-note">${icon('calendar-days')}<span>${e(O.sourceLabel(p))}</span></div><p class="note">占比参考周期仅用于估算成本，不代表记录当天的实际销量。</p><details class="operating-entry-details"><summary>退款与费用核对</summary><div class="dialog-grid stack-gap">${entryRefundFields(p.params)}${paramField('fee', '平台服务费', '%', p.params, true)}${paramField('tax', '税率', '%', p.params, true)}${paramField('recovery', '退货回收比例', '%', p.params, true)}${paramField('other', '其他费用', '元/单', p.params, true)}${paramField('returnCost', '每退货单额外费用', '元', p.params, true)}<label class="field"><span>其他费用发生范围</span><select data-entry-param="otherFeeScope" aria-label="入账其他费用发生范围">${option('shipped', '已发货订单', p.params.otherFeeScope)}${option('all', '所有订单', p.params.otherFeeScope)}</select></label></div></details><details class="operating-entry-details"><summary>材料、运费与规格核对</summary><div class="entry-columns stack-gap"><section><h3>本次用料成本</h3>${entryMaterialFields(f) || `<p class="note">${e(m.name)}</p><label class="field"><span>参考报价</span><select data-quote aria-label="选择历史材料报价"><option value="">选择报价或直接填单价</option>${quotes.slice().reverse().map(h => `<option value="${h.price}">${e(h.date)} · ${money(h.price)}/㎡</option>`).join('')}</select></label><label class="field"><span>本次材料单价 / ㎡</span><input type="number" data-entry-price aria-label="本次材料单价" value="${e(M.frameMaterialPrice(f))}" min="0" step="any"></label>`}<p class="note">混用不同批次时，按实际耗用面积算平均价。</p></section><section>${entryShipping()}</section></div><div class="table-scroll stack-gap"><table><thead><tr><th>规格 / 生产尺寸</th><th>售价 / 元</th><th>订单占比 / %</th><th>重量 / g</th></tr></thead><tbody>${p.items.map(i => {
        const s = f.sizes.find(s => s.id === i.sizeId);
        return `<tr><td>${e(sizeName(s))}</td>${['price', 'share', 'weight'].map(k => `<td><input type="number" data-entry-item="${i.id || i.sizeId}" data-key="${k}" ${k === 'weight' ? 'data-unit="g"' : ''} aria-label="入账 ${e(sizeName(s))} ${({
          price: '售价',
          share: '占比',
          weight: '重量 / g'
        })[k]}" value="${e(k === 'weight' ? M.toGrams(i[k]) : i[k])}" step="any"></td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div></details>${modal.previousId ? field('更正原因（必填）', 'reason', modal.reason, 'text', 'maxlength="200"') : ''}<div id="entry-summary" class="operating-entry-summary" aria-live="polite">${entrySummary(r)}</div><p class="note">确认后保存本次售价、成本和占比。之后调整计划不会改写历史。</p>`, btn('close', '取消') + btn('confirm-record', modal.previousId ? '确认更正并入账' : '确认入账', 'book-check', 'confirm-entry'));
    }
    function entrySummary(r) {
      return `<div><span>支付成交金额</span><strong>${money(r.gmv)}</strong></div><div><span>本次预估经营利润</span><strong class="${r.profit < 0 ? 'negative' : 'positive'}">${money(r.profit)}</strong></div>${r.valid ? '' : `<p class="message-error">${e(r.errors[0])}</p>`}`;
    }
    function entryRefundFields(params) {
      const rates = params.refundRates || ({});
      return ['unshipped', 'shippedOnly', 'returnRefund', 'firstHour'].map(k => `<label class="field"><span class="field-label">${({
        unshipped: '未发货仅退款率',
        shippedOnly: '已发货仅退款率',
        returnRefund: '退货退款率',
        firstHour: '1 小时内退款率（选填）'
      })[k]}</span><div class="input-unit"><input type="number" data-entry-refund-rate="${k}" value="${e(rates[k] ?? (k === 'firstHour' ? '' : 0))}" min="0" max="100" step="any"><span>%</span></div></label>`).join('') + `<p id="entry-refund-breakdown" class="note">${e(refundSummaryText(params))}</p>`;
    }
    function recordDetail() {
      const h = state.records.find(h => h.id === modal.id), f = h.frame, fr = f ? M.refundMetrics(f.plan.params) : null;
      return frame('经营记录明细', `<div class="entry-context"><strong>${h.date} · ${e(h.shopName)} · ${e(h.planName)}</strong><span class="tag">${h.kind === 'snapshot' ? '旧版试算' : ({
        confirmed: '已入账',
        superseded: '已更正',
        void: '已作废'
      })[h.status]}</span></div><div class="record-summary"><div><span>预估经营利润</span><strong class="${h.result.profit < 0 ? 'negative' : 'positive'}">${money(h.result.profit)}</strong></div><div><span>材料单价 / ㎡</span><strong>${f ? e(frameCostLabel(f)) : money(h.legacy?.materialPrice)}</strong></div><div><span>保本 ROI</span><strong>${roi(h.result.roi)}</strong></div></div><p class="note">${e(h.note || '无备注')}${h.reason ? ' · 更正原因：' + e(h.reason) : ''}</p>${h.previousId ? `<p class="note">由原记录更正，原值保留。${btn('record-detail', '查看原记录', '', 'ghost', `data-id="${h.previousId}"`)}</p>` : ''}${h.replacedBy ? `<p class="note">这笔旧记录已不计入合计。${btn('record-detail', '查看更正后的记录', '', 'ghost', `data-id="${h.replacedBy}"`)}</p>` : ''}${f ? `<div class="operating-source-note">${e(O.sourceLabel(f.plan))}</div><div class="ledger-row"><span>支付成交金额</span><span>${money(h.result.gmv)}</span></div><div class="ledger-row"><span>广告消耗 / 支付 ROI</span><span>${money(f.plan.params.spend)} / ${n(f.plan.params.spend > 0 ? h.result.gmv / f.plan.params.spend : null)}</span></div><div class="ledger-row"><span>退款类型</span><span>未发货 ${n(fr.unshipped)}% · 已发货仅退款 ${n(fr.shippedOnly)}% · 退货退款 ${n(fr.returnRefund)}% · 1 小时内 ${fr.firstHour === '' ? '未填' : n(fr.firstHour) + '%'}</span></div><div class="ledger-row"><span>其他费用发生范围</span><span>${f.plan.params.otherFeeScope === 'all' ? '所有订单' : '已发货订单'} · 平台费 ${n(f.plan.params.fee)}% · 税率 ${n(f.plan.params.tax)}%</span></div><div class="ledger-row"><span>运费模板（当时）</span><span>${e(f.shippingTemplates[0].name)}</span></div><p class="note stack-gap">${e(ruleText(f.shippingTemplates[0]))}</p><div class="table-scroll stack-gap"><table><thead><tr><th scope="col">规格</th><th scope="col">生产尺寸</th><th scope="col">售价</th><th scope="col">占比</th><th scope="col">材料成本</th><th scope="col">每单总成本</th></tr></thead><tbody>${M.calculate(f, f.plan).rows.map(i => `<tr><td>${e(sizeName(i.size))}</td><td>${e(production(i.size))}</td><td>${money(i.price)}</td><td>${n(i.share)}%</td><td>${money(i.material)}</td><td>${money(i.cost)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note stack-gap">这是旧版保存的记录，原值保留。旧版试算不计入总账。</p>'}`, h.kind === 'daily' && h.status === 'confirmed' ? (f ? btn('correct-record', '更正这笔账', 'pencil', '', `data-id="${h.id}"`) : '') + btn('void-record', '作废记录', 'archive', 'ghost danger', `data-id="${h.id}"`) + '<span class="grow"></span>' + btn('close', '关闭') : btn('close', '关闭'));
    }
    function frameCostLabel(f) {
      if (!f) return '—';
      if (f.calculationVersion !== 4) return money(M.frameMaterialPrice(f)) + '/㎡';
      const pairs = new Map();
      for (const i of f.plan.items) {
        const m = f.materials.find(x => x.id === (i.materialId || f.plan.materialId)), r = M.materialRule(m, i.materialId ? i : f.plan);
        if (m) pairs.set(m.id + '|' + (r?.id || ''), {
          m,
          r
        });
      }
      return [...pairs.values()].map(({m, r}) => m.name + (r && r.thickness !== '' ? ' ' + r.thickness + 'mm' : '') + ' ' + money(r?.costPerSqm ?? m.price) + '/㎡').join('；');
    }
    return {
      entryForm,
      recordDetail,
      entrySummary
    };
  }
  const api = {
    create
  };
  if (typeof module === 'object') module.exports = api; else root.OperatingEntryViews = api;
})(typeof globalThis === 'object' ? globalThis : {});
