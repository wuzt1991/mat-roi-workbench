(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('./domain.js') : root.MatModel;
  const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
  const n = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('zh-CN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  }) : '—';
  const money = v => Number.isFinite(v) ? '¥' + n(v) : '—';
  const short = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e8 ? n(v / 1e8) + ' 亿' : Math.abs(v) >= 1e4 ? n(v / 1e4) + ' 万' : n(v);
  const roi = v => v === null ? '无法保本' : n(M.ceilRoi(v));
  const icon = name => `<i data-lucide="${name}" class="icon" aria-hidden="true"></i>`;
  const btn = (a, label, ico = '', cls = '', extra = '') => `<button type="button" class="btn ${cls}" data-action="${a}" ${extra}>${ico ? icon(ico) : ''}${e(label)}</button>`;
  const ib = (a, label, ico, extra = '') => `<button type="button" class="icon-btn" data-action="${a}" aria-label="${e(label)}" title="${e(label)}" ${extra}>${icon(ico)}</button>`;
  const sizeName = s => s ? M.productionSizeLabel(s) : '待选规格';
  const dimensions = s => {
    const d = M.productionDimensions(s);
    return s ? `${d.width || '—'} × ${d.height || '—'} cm` : '';
  };
  const production = s => s?.needsReview ? '待补生产尺寸' : dimensions(s);
  const field = (label, key, value, type = 'number', attrs = '') => `<label class="field"><span class="field-label">${e(label)}</span><input type="${type}" data-field="${key}" aria-label="${e(label)}" value="${e(value)}" ${type === 'number' ? 'step="any"' : ''} ${attrs}></label>`;
  const gramField = (label, key, value) => field(label, key, M.toGrams(value), 'number', 'data-unit="g" min="0"');
  const weightText = v => Number.isFinite(v) ? M.toGrams(v).toLocaleString('zh-CN', {
    maximumFractionDigits: 6
  }) : '—';
  const option = (id, name, selected) => `<option value="${e(id)}" ${id === selected ? 'selected' : ''}>${e(name)}</option>`;
  function empty(title, note, action = 'new-plan', label = '新建计划') {
    return `<div class="empty">${icon('folder-open')}<h3>${e(title)}</h3><p class="note">${e(note)}</p>${action ? btn(action, label, 'plus', 'primary') : ''}</div>`;
  }
  function paramField(key, label, unit = '', params = {}, entry = false) {
    return `<label class="field"><span class="field-label">${label}</span><div class="input-unit"><input type="number" data-${entry ? 'entry-param' : 'param'}="${key}" aria-label="${entry ? '入账 ' : ''}${label}" value="${e(params[key])}" min="0" ${['refund', 'fee', 'tax', 'recovery'].includes(key) ? 'max="100"' : ''} step="any"><span>${unit}</span></div></label>`;
  }
  function refundSummaryText(params) {
    const r = M.refundMetrics(params);
    if (!Number.isFinite(r.refundTotal)) return '三类退款率合计：待填写';
    const first = Number.isFinite(r.firstHour) ? ` · 1 小时内 ${n(r.firstHour, 2)}%` : '';
    return `三类退款率合计 ${n(r.refundTotal, 2)}% · 已发货退款 ${n(r.shippedRefund, 2)}%${first}`;
  }
  const api = {
    paramField,
    refundSummaryText,
    e,
    n,
    money,
    short,
    roi,
    icon,
    btn,
    ib,
    sizeName,
    dimensions,
    production,
    field,
    gramField,
    weightText,
    option,
    empty
  };
  if (typeof module === 'object') module.exports = api; else root.WorkbenchFormat = api;
})(typeof globalThis === 'object' ? globalThis : {});
