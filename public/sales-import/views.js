(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object') module.exports = api; else root.SalesImportViews = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
  function create({state: local, selectors}) {
    const {context, planItems, reviewItems, columns, selectedGroups, canApply} = selectors;
    function columnOptions(value) {
      return '<option value="">请选择</option>' + columns().map((c, i) => '<option value="' + esc(c.id ?? i) + '" ' + (String(c.id ?? i) === value ? 'selected' : '') + '>' + esc(c.name ?? c) + '</option>').join('');
    }
    function periodField() {
      return '<label class="sales-import-field"><span>统计周期</span><input data-sales-period value="' + esc(local.period) + '" placeholder="从报表日期自动识别，也可手动填写"></label>';
    }
    function basisField() {
      return '<fieldset class="sales-import-field sales-import-basis"><legend>占比计算口径</legend><label><input type="radio" name="sales-basis" value="orders" ' + (local.basis === 'orders' ? 'checked' : '') + '>成交订单数（默认）</label><label><input type="radio" name="sales-basis" value="units" ' + (local.basis === 'units' ? 'checked' : '') + '>成交件数</label></fieldset>' + (local.basis === 'units' ? '<label class="sales-import-check"><input type="checkbox" data-sales-units-ack ' + (local.unitsAcknowledged ? 'checked' : '') + '>按一单一件估算订单占比</label>' : '');
    }
    function uploadView() {
      return '<div class="sales-import-upload"><div class="sales-import-dropzone" data-sales-upload-trigger tabindex="0" role="button" aria-disabled="' + local.busy + '"><span class="sales-import-drop-icon" aria-hidden="true">↥</span><strong data-sales-drop-label>拖入销售报表，或点击选择</strong><span>支持单个 .xlsx 文件，自动合并不同图案的相同尺寸</span><input type="file" data-sales-file accept=".xlsx" aria-label="选择销售报表" hidden ' + (local.busy ? 'disabled' : '') + '></div><div class="sales-import-meta-grid">' + periodField() + '<div>' + basisField() + '</div></div><p class="sales-import-hint">从商品 SKU 标题提取尺寸，按同尺寸汇总成交订单数，计算后回填当前计划的订单占比。</p></div>';
    }
    function mappingView() {
      return '<div class="sales-import-mapping"><p class="sales-import-file">' + esc(local.filename) + '</p><label class="sales-import-field"><span>工作表</span><select data-sales-sheet>' + local.sheets.map(s => '<option value="' + esc(s.id ?? s.sheetId) + '" ' + (String(s.id ?? s.sheetId) === String(local.sheetId) ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label><label class="sales-import-field"><span>商品 SKU 标题 / 尺寸列</span><select data-sales-title-column>' + columnOptions(local.titleColumn) + '</select></label><div class="sales-import-meta-grid"><div>' + basisField() + '</div><label class="sales-import-field"><span>数量列</span><select data-sales-quantity-column>' + columnOptions(local.quantityColumn) + '</select></label></div><p class="sales-import-hint">已识别的表头会自动选中。不同图案按尺寸合并；多个店铺或商品来源会分别显示，选择一个来源后计算。</p></div>';
    }
    function reviewView() {
      const all = selectedGroups(), pages = Math.max(1, Math.ceil(all.length / 100));
      const displayPage = Math.max(0, Math.min(local.page, pages - 1));
      const visible = all.slice(displayPage * 100, (displayPage + 1) * 100);
      const itemOptions = selected => '<option value="">请选择对应规格</option>' + reviewItems().map(i => '<option value="' + esc(i.id) + '" ' + (i.id === selected ? 'selected' : '') + '>' + esc(i.label) + '</option>').join('');
      return '<div class="sales-import-review"><p class="sales-import-file"><strong>' + esc(local.filename) + '</strong> · ' + (local.basis === 'orders' ? '成交订单数' : '成交件数') + '</p>' + periodField() + ((local.summary?.sources?.length || 0) > 1 ? '<label class="sales-import-field"><span>选择当前计划对应的来源</span><select data-sales-source><option value="">请选择来源</option>' + local.summary.sources.map(s => '<option value="' + esc(s.key) + '" ' + (s.key === local.sourceKey ? 'selected' : '') + '>' + esc(s.label) + ' · ' + s.quantity + ' ' + (local.basis === 'orders' ? '单' : '件') + '</option>').join('') + '</select></label>' : '') + '<div class="sales-import-review-head"><p class="sales-import-hint">已纳入 ' + (local.summary?.total || 0) + ' ' + (local.basis === 'orders' ? '单' : '件') + '；待处理 ' + (local.summary?.unknown || 0) + ' 组，已排除 ' + (local.summary?.excluded || 0) + ' 组。</p><div class="sales-import-filter">' + [['all', '全部'], ['unresolved', '待处理'], ['excluded', '已排除']].map(([v, n]) => '<button type="button" data-sales-filter="' + v + '" class="' + (local.filter === v ? 'active' : '') + '">' + n + '</button>').join('') + '</div></div>' + '<div class="sales-import-table-wrap sales-import-result"><table class="sales-import-table"><caption class="sr-only">按尺寸合并销售数据</caption><thead><tr><th>报表尺寸</th><th>数量合计</th><th>当前计划规格</th><th>规格占比</th><th>处理</th></tr></thead><tbody>' + (visible.map(r => '<tr data-sales-row="' + esc(r.rowId) + '"><td><strong>' + esc(r.size) + (r.size === '未识别尺寸' ? '' : ' cm') + '</strong><small title="' + esc(r.example) + '">合并 ' + r.sourceCount + ' 条记录 · ' + esc(r.example) + '</small>' + (r.issue ? '<em title="' + esc(r.issue) + '">' + esc(r.issue) + '</em>' : '') + '</td><td class="sales-import-num">' + r.count + '</td><td><select data-sales-bind aria-label="' + esc(r.size) + ' 对应规格" ' + (r.excluded ? 'disabled' : '') + '>' + itemOptions(r.itemId) + '</select>' + (r.canAdd ? '<button type="button" class="btn ghost sales-import-add-size" data-sales-add-size="' + esc(r.rowId) + '">一键添加此尺寸</button>' : local.additions.some(a => a.itemId === r.itemId) ? '<button type="button" class="btn ghost sales-import-add-size" data-sales-remove-size="' + esc(r.itemId) + '">取消添加</button>' : '') + '</td><td class="sales-import-num">' + (!r.excluded && r.itemId && local.summary.total > 0 ? Number(local.summary.items.find(i => i.itemId === r.itemId)?.share || 0).toFixed(2) + '%' : '—') + '</td><td><label class="sales-import-exclude"><input type="checkbox" data-sales-exclude ' + (r.excluded ? 'checked' : '') + '>排除</label></td></tr>').join('') || '<tr><td colspan="5">请选择来源或调整筛选。</td></tr>') + '</tbody></table></div>' + (pages > 1 ? '<div class="sales-import-pagination"><button type="button" class="btn ghost" data-sales-prev ' + (displayPage === 0 ? 'disabled' : '') + '>上一页</button><span>第 ' + (displayPage + 1) + ' / ' + pages + ' 页</span><button type="button" class="btn ghost" data-sales-next ' + (displayPage + 1 === pages ? 'disabled' : '') + '>下一页</button></div>' : '') + (local.summary?.missing?.length ? '<div class="sales-import-missing"><span>有 ' + local.summary.missing.length + ' 个计划规格未匹配到销售记录</span><label><input type="checkbox" data-sales-missing ' + (local.missingPolicy === 'zero' ? 'checked' : '') + '>确认这些规格本次按 0 处理</label></div>' : '') + (local.additions.length ? '<p class="sales-import-hint" data-sales-additions>待添加 ' + local.additions.length + ' 个尺寸，应用订单占比时一并保存；沿用计划的材料、厚度、运费和定价设置。</p>' : '') + '<p class="sales-import-hint">分母为当前来源中已匹配且未排除的数量合计；同尺寸已合并所有图案' + (local.summary?.ready ? '' : '，待处理记录解决后会重新计算') + '。</p></div>';
    }
    function html() {
      const c = context(), titles = {
        upload: '导入销售情况',
        mapping: '确认销售字段',
        review: '复核尺寸汇总',
        applying: '正在回填订单占比',
        done: '订单占比已更新'
      };
      const body = local.step === 'upload' ? uploadView() : local.step === 'mapping' ? mappingView() : local.step === 'review' ? reviewView() : local.step === 'applying' ? '<div class="sales-import-progress" role="status">正在保存…</div>' : '<div class="sales-import-success"><span aria-hidden="true">✓</span><strong>销量与订单占比已更新</strong><p>已按尺寸合并不同图案，可返回商品规格查看。</p></div>';
      const footer = local.step === 'upload' ? '<button type="button" class="btn primary" data-sales-start>选择文件</button>' : local.step === 'mapping' ? '<button type="button" class="btn ghost" data-sales-back>重新选文件</button><button type="button" class="btn primary" data-sales-map>按尺寸汇总</button>' : local.step === 'review' ? '<button type="button" class="btn ghost" data-sales-retry>刷新汇总</button><button type="button" class="btn ghost" data-sales-back>重新选文件</button><button type="button" class="btn primary" data-sales-apply ' + (canApply() ? '' : 'disabled') + '>应用订单占比</button>' : local.step === 'done' ? (local.undoToken ? '<button type="button" class="btn ghost" data-sales-undo>撤销本次导入</button>' : '') + '<button type="button" class="btn primary" data-sales-close>完成</button>' : '';
      return '<div class="sales-import-shell"><header class="sales-import-head"><div><p class="sales-import-eyebrow">' + esc(c.plan?.name || '当前计划') + ' · ' + planItems().length + ' 个规格</p><h2 id="sales-import-title">' + titles[local.step] + '</h2></div><button type="button" class="sales-import-close" data-sales-close aria-label="关闭销售导入" ' + (local.busy ? 'disabled' : '') + '>×</button></header><nav class="sales-import-steps" aria-label="导入进度">' + [['upload', '上传文件'], ['mapping', '确认字段'], ['review', '尺寸汇总'], ['done', '完成']].map(([s, n]) => '<span class="sales-import-step ' + (local.step === s ? 'active' : '') + '">' + n + '</span>').join('<span aria-hidden="true">›</span>') + '</nav><div class="sales-import-body" aria-busy="' + local.busy + '">' + (local.error ? '<div class="sales-import-alert" role="alert">' + esc(local.error) + '</div>' : '') + (local.notice ? '<div class="sales-import-notice" role="status">' + esc(local.notice) + '</div>' : '') + '<fieldset class="sales-import-controls" ' + (local.busy ? 'disabled' : '') + '>' + body + '</fieldset></div><footer class="sales-import-footer"><button type="button" class="btn ghost" data-sales-close ' + (local.busy ? 'disabled' : '') + '>' + (local.step === 'done' ? '关闭' : '暂时关闭') + '</button>' + (local.session && local.step !== 'done' ? '<button type="button" class="btn ghost" data-sales-discard ' + (local.busy ? 'disabled' : '') + '>放弃本次导入</button>' : '') + '<fieldset class="sales-import-actions" ' + (local.busy ? 'disabled' : '') + '>' + footer + '</fieldset></footer></div>';
    }
    return {
      html
    };
  }
  return {
    create
  };
});
