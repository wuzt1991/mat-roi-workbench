(function(){
  'use strict';

  const content = document.querySelector('#proto-content');
  const exportButton = document.querySelector('#export-button');
  const sidebar = document.querySelector('#proto-sidebar');
  const toastEl = document.querySelector('#proto-toast');
  const TOTAL_ROWS = 268432;
  const BATCH_SIZE = 5000;
  const BATCH_COUNT = 54;
  const FILE_NAME = 'ERP商品规格_2026-09-13.xlsx';
  const FILE_SIZE = '38.6 MB';

  const state = {
    step: 'ready',
    status: 'ready',
    processedRows: 0,
    currentBatch: 0,
    failedBatch: null,
    paused: false,
    canceled: false,
    reviewTab: 'product',
    productPage: 1,
    skuPage: 1,
    productReviews: {},
    skuReviews: {},
    exported: false,
    startedAt: null,
  };

  let progressTimer = null;
  let toastTimer = null;

  const productIssues = [
    { id: 'P-10031', name: '云朵绒防滑地垫', skuCount: 18, rows: 18, issue: '同一商品存在 2 种材质名称', detail: '绒面 / 云朵绒', defaultMaterial: '云朵绒', severity: 'warning' },
    { id: 'P-10047', name: '奶油格纹厨房垫', skuCount: 12, rows: 12, issue: '缺少商品材质', detail: '12 个 SKU 待确认', defaultMaterial: '', severity: 'error' },
    { id: 'P-10106', name: '吸水速干浴室垫', skuCount: 24, rows: 24, issue: '平台商品 ID 重复', detail: '与 P-10107 合并前请确认', defaultMaterial: '超细纤维', severity: 'error' },
    { id: 'P-10122', name: '北欧条纹门垫', skuCount: 9, rows: 9, issue: '部分 SKU 未填写尺寸', detail: '3 个 SKU 缺少长宽', defaultMaterial: '涤纶', severity: 'warning' },
    { id: 'P-10158', name: '软弹记忆棉地垫', skuCount: 16, rows: 16, issue: '材质字段格式不一致', detail: '记忆棉 / 记忆海绵', defaultMaterial: '记忆棉', severity: 'warning' },
    { id: 'P-10203', name: '玄关静音防滑垫', skuCount: 21, rows: 21, issue: '缺少平台商品 ID', detail: '无法按商品边界归批', defaultMaterial: 'PVC', severity: 'error' },
    { id: 'P-10267', name: '素色短绒客厅垫', skuCount: 14, rows: 14, issue: '同商品跨店铺重复', detail: '店铺 A / 店铺 B', defaultMaterial: '短绒', severity: 'warning' },
    { id: 'P-10312', name: '儿童游戏拼接垫', skuCount: 27, rows: 27, issue: '单位疑似为厘米', detail: '已按毫米候选解析', defaultMaterial: 'XPE', severity: 'warning' },
    { id: 'P-10339', name: '轻奢渐变客厅毯', skuCount: 11, rows: 11, issue: '售价为空', detail: '导出后将无法计算 ROI', defaultMaterial: '混纺', severity: 'error' },
    { id: 'P-10401', name: '户外硅藻泥脚垫', skuCount: 8, rows: 8, issue: '材质与类目不匹配', detail: '硅藻泥 / 硅藻土', defaultMaterial: '硅藻泥', severity: 'warning' },
    { id: 'P-10426', name: '日式棉麻厨房垫', skuCount: 13, rows: 13, issue: '缺少厚度信息', detail: '5 个 SKU 缺少厚度', defaultMaterial: '棉麻', severity: 'warning' },
    { id: 'P-10483', name: '黑白棋盘格地毯', skuCount: 19, rows: 19, issue: '平台商品 ID 格式异常', detail: '包含空格和前导零', defaultMaterial: '涤纶', severity: 'warning' },
  ];

  const skuIssues = [
    { id: 'P-10031-07', productId: 'P-10031', product: '云朵绒防滑地垫', sku: '灰色 / 50×80 cm', issue: '材质为“绒面”', suggestion: '云朵绒' },
    { id: 'P-10047-02', productId: 'P-10047', product: '奶油格纹厨房垫', sku: '米白 / 45×120 cm', issue: '缺少材质', suggestion: '请填写' },
    { id: 'P-10047-09', productId: 'P-10047', product: '奶油格纹厨房垫', sku: '咖色 / 60×180 cm', issue: '缺少材质', suggestion: '请填写' },
    { id: 'P-10106-13', productId: 'P-10106', product: '吸水速干浴室垫', sku: '深灰 / 60×90 cm', issue: 'ID 与 P-10107 重复', suggestion: '保留 P-10106' },
    { id: 'P-10122-03', productId: 'P-10122', product: '北欧条纹门垫', sku: '蓝灰 / 常规', issue: '缺少长宽', suggestion: '补充尺寸' },
    { id: 'P-10122-08', productId: 'P-10122', product: '北欧条纹门垫', sku: '米灰 / 常规', issue: '缺少长宽', suggestion: '补充尺寸' },
    { id: 'P-10158-04', productId: 'P-10158', product: '软弹记忆棉地垫', sku: '浅咖 / 40×60 cm', issue: '材质为“记忆海绵”', suggestion: '记忆棉' },
    { id: 'P-10203-01', productId: 'P-10203', product: '玄关静音防滑垫', sku: '黑色 / 40×60 cm', issue: '缺少平台商品 ID', suggestion: '请补充' },
    { id: 'P-10339-06', productId: 'P-10339', product: '轻奢渐变客厅毯', sku: '灰蓝 / 160×230 cm', issue: '售价为空', suggestion: '请补充售价' },
  ];

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const number = (value) => Number(value).toLocaleString('zh-CN');
  const percent = () => Math.min(100, Math.round((state.processedRows / TOTAL_ROWS) * 100));
  const isResolved = (kind, id) => Boolean((kind === 'product' ? state.productReviews : state.skuReviews)[id]);
  const unresolvedProducts = () => productIssues.filter((item) => !isResolved('product', item.id));
  const unresolvedSkus = () => skuIssues.filter((item) => !isResolved('sku', item.id));
  const allReviewed = () => unresolvedProducts().length === 0 && unresolvedSkus().length === 0;

  function icon(name){ return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }

  function showToast(message){
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function refreshIcons(){
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  function stepClass(step){
    const order = ['ready', 'processing', 'review', 'complete'];
    const current = order.indexOf(state.step);
    const index = order.indexOf(step);
    return index === current ? 'active' : index < current ? 'done' : '';
  }

  function statusBand(type, heading, subheading, label, iconName){
    return '<div class="proto-status-band ' + type + '"><span class="proto-status-icon">' + icon(iconName) + '</span><div class="proto-status-copy"><strong>' + esc(heading) + '</strong><span>' + esc(subheading) + '</span></div><span class="proto-status-chip">' + esc(label) + '</span></div>';
  }

  function renderSteps(){
    document.querySelectorAll('.proto-step').forEach((el) => {
      const step = el.dataset.step;
      el.classList.remove('active', 'done');
      const cls = stepClass(step);
      if (cls) el.classList.add(cls);
    });
  }

  function metric(label, value, note, tone){
    return '<div class="proto-metric"><span class="proto-metric-label">' + esc(label) + '</span><strong class="proto-metric-value ' + (tone || '') + '">' + esc(value) + '</strong><span class="proto-metric-note">' + esc(note || '') + '</span></div>';
  }

  function renderReady(){
    exportButton.disabled = true;
    return '<div class="proto-overview">' +
      '<div>' +
        '<section class="proto-main-section">' +
          statusBand('ready', '文件已读取，建议自动分批', FILE_NAME + ' · ' + FILE_SIZE, '可开始', 'file-check') +
          '<div class="proto-file-row"><span class="proto-file-icon">' + icon('file-spreadsheet') + '</span><div class="proto-file-meta"><strong>' + esc(FILE_NAME) + '</strong><span>最后修改：今天 18:24 · Excel 工作簿 · 预计读取 1 个工作表</span></div><div class="proto-file-size"><strong>' + FILE_SIZE + '</strong><span>大于建议阈值</span></div></div>' +
        '</section>' +
        '<section class="proto-main-section"><div class="proto-section-head"><div><h2>导入前预检</h2><p>先读取工作表范围和商品 ID 边界，不把全部空行一次性放进内存。</p></div><span class="proto-tag amber">需要分批</span></div>' +
          '<div class="proto-metric-grid">' + metric('有效商品规格', number(TOTAL_ROWS), '预计有数据的行', 'blue') + metric('建议批次数', BATCH_COUNT + ' 批', '每批约 ' + number(BATCH_SIZE) + ' 行', 'blue') + metric('预计商品数', '18,903', '按平台商品 ID 聚合', '') + metric('空行与表头', '已过滤', '不会进入解析队列', 'green') + '</div>' +
        '</section>' +
        '<section class="proto-main-section"><div class="proto-section-head"><div><h2>处理策略</h2><p>同一平台商品的 SKU 会保持在同一批次，失败时只重试失败批次。</p></div></div>' +
          '<div class="proto-note"><strong>自动分批规则：</strong>按平台商品 ID 边界拆分，单任务最多 50 万行；解析完成后统一复核，再合并成一个最终文件。</div>' +
          '<div class="proto-inline-actions"><button type="button" class="proto-button proto-button-primary" data-action="start"><span>' + icon('play') + '</span>开始解析</button><button type="button" class="proto-button proto-button-secondary" data-action="choose-file">' + icon('upload') + '选择其他文件</button></div>' +
        '</section>' +
      '</div>' +
      '<aside>' +
        '<section class="proto-rail-section"><div class="proto-rail-block"><h3>这次导入会发生什么</h3><div class="proto-kv"><span>内存策略</span><strong>流式读取</strong></div><div class="proto-kv"><span>分批边界</span><strong>平台商品 ID</strong></div><div class="proto-kv"><span>失败恢复</span><strong>仅重试失败批次</strong></div><div class="proto-kv"><span>最终产物</span><strong>1 个合并文件</strong></div></div><div class="proto-rail-block"><div class="proto-note">单个文件超过 5 万行时，工作台会先预检，再转入后台队列。你可以关闭窗口，稍后回来查看进度。</div></div></section>' +
      '</aside>' +
    '</div>';
  }

  function batchRows(){
    const rows = [];
    const visible = Math.min(BATCH_COUNT, Math.max(8, state.currentBatch + 4));
    const start = Math.max(0, Math.min(state.currentBatch - 3, BATCH_COUNT - visible));
    for (let i = start; i < start + visible; i += 1) {
      const isCurrent = i === state.currentBatch && state.status === 'processing';
      const isFailed = state.failedBatch === i;
      const done = i < state.currentBatch || (state.currentBatch === BATCH_COUNT && i < BATCH_COUNT);
      const count = i === BATCH_COUNT - 1 ? TOTAL_ROWS - BATCH_SIZE * (BATCH_COUNT - 1) : BATCH_SIZE;
      const rowStatus = isFailed ? 'failed' : isCurrent ? 'current' : done ? 'done' : '';
      const stateText = isFailed ? '解析失败' : isCurrent ? (state.paused ? '已暂停' : '解析中') : done ? '已完成' : '排队中';
      const rowIcon = isFailed ? 'alert-triangle' : isCurrent ? (state.paused ? 'pause' : 'loader-circle') : done ? 'check' : 'clock-3';
      rows.push('<div class="proto-batch ' + rowStatus + '"><span class="proto-batch-check">' + icon(rowIcon) + '</span><div class="proto-batch-copy"><strong>批次 ' + String(i + 1).padStart(2, '0') + ' · ' + number(count) + ' 行</strong><span>平台商品 ID ' + (10000 + i * 351) + ' – ' + (10000 + i * 351 + 348) + '</span></div><span class="proto-batch-state">' + stateText + '</span></div>');
    }
    return rows.join('');
  }

  function renderProcessing(){
    exportButton.disabled = true;
    const pct = percent();
    const statusType = state.status === 'failed' ? 'failed' : state.status === 'canceled' ? 'canceled' : 'processing';
    const heading = state.status === 'failed' ? '有 1 个批次需要重试' : state.status === 'canceled' ? '解析已取消，已保留完成批次' : state.paused ? '解析已暂停' : '正在后台解析商品规格';
    const subheading = state.status === 'failed' ? '其他已完成批次不会重复处理' : state.status === 'canceled' ? '可以继续剩余批次，或重新开始' : state.paused ? '当前批次状态已保存' : '窗口可以继续操作，进度会自动保存';
    const chip = state.status === 'failed' ? '待重试' : state.status === 'canceled' ? '已取消' : state.paused ? '已暂停' : '后台运行';
    return '<div class="proto-overview">' +
      '<div>' +
        '<section class="proto-main-section">' + statusBand(statusType, heading, subheading, chip, state.status === 'failed' ? 'alert-triangle' : state.status === 'canceled' ? 'circle-stop' : state.paused ? 'pause' : 'loader-circle') + '</section>' +
        '<section class="proto-main-section"><div class="proto-section-head"><div><h2>解析进度</h2><p>按平台商品 ID 拆分，SKU 不会跨批次。</p></div><strong class="proto-metric-value blue" style="margin-top:0;font-size:20px">' + pct + '%</strong></div>' +
          '<div class="proto-progress" style="--proto-progress:' + pct + '%"><div class="proto-progress-fill"></div></div>' +
          '<div class="proto-progress-meta"><span>已处理 ' + number(state.processedRows) + ' / ' + number(TOTAL_ROWS) + ' 行</span><strong>批次 ' + Math.min(BATCH_COUNT, state.currentBatch + (state.currentBatch < BATCH_COUNT ? 1 : 0)) + ' / ' + BATCH_COUNT + '</strong></div>' +
          '<div class="proto-batch-list">' + batchRows() + '</div>' +
          '<div class="proto-inline-actions">' +
            (state.status === 'failed' ? '<button type="button" class="proto-button proto-button-primary" data-action="retry-batch">' + icon('rotate-cw') + '重试失败批次</button>' : '') +
            (state.status === 'canceled' ? '<button type="button" class="proto-button proto-button-primary" data-action="continue">' + icon('play') + '继续剩余批次</button>' : '') +
            (state.status === 'processing' && !state.paused ? '<button type="button" class="proto-button proto-button-secondary" data-action="pause">' + icon('pause') + '暂停</button>' : '') +
            (state.status === 'processing' && state.paused ? '<button type="button" class="proto-button proto-button-primary" data-action="resume">' + icon('play') + '继续</button>' : '') +
            (state.status === 'processing' ? '<button type="button" class="proto-button proto-button-danger" data-action="cancel">' + icon('circle-stop') + '取消解析</button>' : '') +
            (state.status === 'processing' ? '<button type="button" class="proto-button proto-button-quiet" data-action="simulate-fail">模拟失败批次</button>' : '') +
          '</div>' +
          (state.status === 'processing' && !state.paused ? '<div class="proto-stepper-caption"><span></span>解析服务运行中<span class="proto-loading-dot"><i></i><i></i><i></i></span></div>' : '') +
        '</section>' +
      '</div>' +
      '<aside><section class="proto-rail-section"><div class="proto-rail-block"><h3>任务详情</h3><div class="proto-kv"><span>任务编号</span><strong>IMP-260913-1824</strong></div><div class="proto-kv"><span>目标批次大小</span><strong>' + number(BATCH_SIZE) + ' 行</strong></div><div class="proto-kv"><span>已完成批次</span><strong>' + Math.min(state.currentBatch, BATCH_COUNT) + ' 批</strong></div><div class="proto-kv"><span>预计剩余时间</span><strong>' + (state.status === 'canceled' ? '已暂停' : Math.max(1, Math.ceil((TOTAL_ROWS - state.processedRows) / 24000)) + ' 分钟') + '</strong></div></div><div class="proto-rail-block"><div class="proto-note"><strong>可安全离开：</strong>进度会保存在本机，回来后可继续处理。失败时已完成批次不会回滚。</div></div></section></aside>' +
    '</div>';
  }

  function reviewSummary(){
    const resolved = productIssues.length + skuIssues.length - unresolvedProducts().length - unresolvedSkus().length;
    return '<div class="proto-review-summary">' + metric('解析规格', number(TOTAL_ROWS), '全部批次完成', 'blue') + metric('商品级异常', number(productIssues.length), unresolvedProducts().length ? '待处理 ' + unresolvedProducts().length + ' 项' : '已全部处理', unresolvedProducts().length ? 'amber' : 'green') + metric('SKU 级异常', number(skuIssues.length), unresolvedSkus().length ? '待处理 ' + unresolvedSkus().length + ' 项' : '已全部处理', unresolvedSkus().length ? 'amber' : 'green') + metric('已复核', number(resolved), '商品与 SKU 合计', resolved === productIssues.length + skuIssues.length ? 'green' : '') + '</div>';
  }

  function productTable(){
    const pageSize = 6;
    const pageCount = Math.ceil(productIssues.length / pageSize);
    state.productPage = Math.max(1, Math.min(state.productPage, pageCount));
    const start = (state.productPage - 1) * pageSize;
    const rows = productIssues.slice(start, start + pageSize).map((item) => {
      const resolved = isResolved('product', item.id);
      return '<tr><td><span class="proto-cell-strong">' + esc(item.id) + '</span><span class="proto-cell-muted">' + esc(item.name) + '</span></td><td>' + number(item.skuCount) + ' 个</td><td><span class="proto-tag ' + (item.severity === 'error' ? 'amber' : '') + '">' + (item.severity === 'error' ? '需确认' : '建议复核') + '</span></td><td><span class="proto-cell-issue">' + esc(item.issue) + '<br><span class="proto-cell-muted">' + esc(item.detail) + '</span></span></td><td><select data-review-product="' + esc(item.id) + '" aria-label="为 ' + esc(item.name) + ' 选择材质"><option value="">选择材质</option><option value="' + esc(item.defaultMaterial || '待填写') + '"' + (state.productReviews[item.id] ? ' selected' : '') + '>' + esc(item.defaultMaterial || '标记已确认') + '</option><option value="自定义">自定义材质</option></select></td><td>' + (resolved ? '<span class="proto-tag green">已复核</span>' : '<button type="button" class="proto-button proto-button-secondary" data-action="resolve-product" data-id="' + esc(item.id) + '">' + icon('check') + '确认</button>') + '</td></tr>';
    }).join('');
    return '<div class="proto-table-wrap"><table class="proto-table"><thead><tr><th>平台商品 ID</th><th>SKU 数</th><th>状态</th><th>异常说明</th><th>材质处理</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + pagination('product', state.productPage, pageCount, productIssues.length);
  }

  function skuTable(){
    const pageSize = 6;
    const pageCount = Math.ceil(skuIssues.length / pageSize);
    state.skuPage = Math.max(1, Math.min(state.skuPage, pageCount));
    const start = (state.skuPage - 1) * pageSize;
    const rows = skuIssues.slice(start, start + pageSize).map((item) => {
      const resolved = isResolved('sku', item.id);
      return '<tr><td><span class="proto-cell-strong">' + esc(item.id) + '</span><span class="proto-cell-muted">' + esc(item.product) + '</span></td><td>' + esc(item.sku) + '</td><td><span class="proto-cell-issue">' + esc(item.issue) + '</span></td><td><span class="proto-cell-muted">' + esc(item.suggestion) + '</span></td><td>' + (resolved ? '<span class="proto-tag green">已复核</span>' : '<button type="button" class="proto-button proto-button-secondary" data-action="resolve-sku" data-id="' + esc(item.id) + '">' + icon('check') + '确认</button>') + '</td></tr>';
    }).join('');
    return '<div class="proto-table-wrap"><table class="proto-table"><thead><tr><th>SKU 行</th><th>规格</th><th>异常</th><th>建议处理</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + pagination('sku', state.skuPage, pageCount, skuIssues.length);
  }

  function pagination(kind, page, pageCount, total){
    return '<div class="proto-pagination"><span>第 ' + page + ' / ' + pageCount + ' 页 · 共 ' + number(total) + ' 项</span><div class="proto-pagination-actions"><button type="button" aria-label="上一页" title="上一页" data-action="page-prev" data-kind="' + kind + '" ' + (page <= 1 ? 'disabled' : '') + '>' + icon('chevron-left') + '</button><button type="button" aria-label="下一页" title="下一页" data-action="page-next" data-kind="' + kind + '" ' + (page >= pageCount ? 'disabled' : '') + '>' + icon('chevron-right') + '</button></div></div>';
  }

  function renderReview(){
    exportButton.disabled = !allReviewed();
    const readyText = allReviewed() ? '全部异常已处理，可以生成最终商品表' : '在全部解析完成后集中复核，确认后才能导出';
    return '<section class="proto-main-section">' + statusBand(allReviewed() ? 'complete' : 'failed', allReviewed() ? '复核完成，商品表可以导出' : '解析完成，发现需要复核的异常', readyText, allReviewed() ? '可导出' : (unresolvedProducts().length + unresolvedSkus().length) + ' 项待处理', allReviewed() ? 'check-circle-2' : 'triangle-alert') + '</section>' +
      reviewSummary() +
      '<section class="proto-review-block"><div class="proto-section-head"><div><h2>异常复核</h2><p>先处理商品级异常，再查看具体 SKU；批量材质会按平台商品 ID 应用。</p></div><button type="button" class="proto-button proto-button-secondary" data-action="resolve-all" ' + (allReviewed() ? 'disabled' : '') + '>' + icon('check-check') + '一键确认可应用项</button></div>' +
        '<div class="proto-inline-actions" style="margin-top:0;margin-bottom:17px"><button type="button" class="proto-button ' + (state.reviewTab === 'product' ? 'proto-button-primary' : 'proto-button-secondary') + '" data-action="review-tab" data-tab="product">' + icon('package') + '商品级复核 <span>(' + productIssues.length + ')</span></button><button type="button" class="proto-button ' + (state.reviewTab === 'sku' ? 'proto-button-primary' : 'proto-button-secondary') + '" data-action="review-tab" data-tab="sku">' + icon('list-checks') + '逐 SKU 复核 <span>(' + skuIssues.length + ')</span></button></div>' +
        (state.reviewTab === 'product' ? productTable() : skuTable()) +
      '</section>' +
      '<section class="proto-review-block"><div class="proto-section-head"><div><h2>合并策略</h2><p>复核完成后保留原始列顺序，并将 54 个批次合并为一份固定模板。</p></div></div><div class="proto-metric-grid">' + metric('输出商品表', '1 个文件', '所有已完成批次', 'green') + metric('行顺序', '按商品 ID', '同商品 SKU 连续排列', '') + metric('未处理异常', number(unresolvedProducts().length + unresolvedSkus().length), allReviewed() ? '可以导出' : '处理后解锁导出', unresolvedProducts().length + unresolvedSkus().length ? 'amber' : 'green') + metric('原始批次', BATCH_COUNT + ' 批', '保留可追溯信息', '') + '</div></section>';
  }

  function renderComplete(){
    exportButton.disabled = false;
    return '<div class="proto-overview"><div><section class="proto-main-section"><div class="proto-complete-banner">' + icon('check-circle-2') + '<div><strong>商品表已生成，可以下载</strong><span>54 个批次已合并 · ' + number(TOTAL_ROWS) + ' 条规格 · 已通过异常复核</span></div></div></section><section class="proto-main-section"><div class="proto-section-head"><div><h2>导出结果</h2><p>文件包含完整商品规格和复核后的材质字段，可直接回传 ERP。</p></div><button type="button" class="proto-button proto-button-primary" data-action="export">' + icon('download') + '再次导出</button></div><div class="proto-file-row"><span class="proto-file-icon">' + icon('file-spreadsheet') + '</span><div class="proto-file-meta"><strong>商品转表-2026-09-13-268432条.xlsx</strong><span>生成于今天 18:31 · 固定商品模板 · 可重新导出</span></div><div class="proto-file-size"><strong>42.1 MB</strong><span>已合并</span></div></div></section><section class="proto-main-section"><div class="proto-section-head"><div><h2>处理记录</h2><p>失败批次和复核决定都会保留在本机，方便追溯。</p></div></div><div class="proto-note"><strong>本次任务已完成：</strong>预检过滤空行 → 按平台商品 ID 分成 54 批 → 后台解析 → 集中复核 → 合并导出。</div></section></div><aside><section class="proto-rail-section"><div class="proto-rail-block"><h3>任务摘要</h3><div class="proto-kv"><span>任务编号</span><strong>IMP-260913-1824</strong></div><div class="proto-kv"><span>处理规格</span><strong>' + number(TOTAL_ROWS) + ' 条</strong></div><div class="proto-kv"><span>异常复核</span><strong>21 项已确认</strong></div><div class="proto-kv"><span>导出状态</span><strong>已生成</strong></div></div><div class="proto-rail-block"><button type="button" class="proto-button proto-button-secondary" data-action="reset" style="width:100%">' + icon('rotate-ccw') + '处理另一个文件</button></div></section></aside></div>';
  }

  function render(){
    renderSteps();
    if (state.step === 'ready') content.innerHTML = renderReady();
    else if (state.step === 'processing') content.innerHTML = renderProcessing();
    else if (state.step === 'review') content.innerHTML = renderReview();
    else content.innerHTML = renderComplete();
    refreshIcons();
  }

  function stopTimer(){
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  function beginTimer(){
    stopTimer();
    progressTimer = setInterval(() => {
      if (state.status !== 'processing' || state.paused) return;
      if (state.currentBatch >= BATCH_COUNT) {
        state.processedRows = TOTAL_ROWS;
        state.step = 'review';
        state.status = 'review';
        stopTimer();
        showToast('全部批次解析完成，请开始异常复核');
        render();
        return;
      }
      const increment = Math.min(TOTAL_ROWS - state.processedRows, 18000);
      state.processedRows = Math.min(TOTAL_ROWS, state.processedRows + increment);
      state.currentBatch = Math.min(BATCH_COUNT, Math.floor(state.processedRows / BATCH_SIZE));
      if (state.processedRows >= TOTAL_ROWS) {
        state.currentBatch = BATCH_COUNT;
        state.step = 'review';
        state.status = 'review';
        stopTimer();
        showToast('全部批次解析完成，请开始异常复核');
      }
      render();
    }, 650);
  }

  function startProcessing(){
    state.step = 'processing'; state.status = 'processing'; state.processedRows = 0; state.currentBatch = 0; state.failedBatch = null; state.paused = false; state.canceled = false; state.startedAt = Date.now();
    showToast('已创建后台解析任务');
    render();
    beginTimer();
  }

  function reset(){
    stopTimer();
    Object.assign(state, { step:'ready', status:'ready', processedRows:0, currentBatch:0, failedBatch:null, paused:false, canceled:false, reviewTab:'product', productPage:1, skuPage:1, productReviews:{}, skuReviews:{}, exported:false });
    exportButton.disabled = true;
    render();
    showToast('已回到预检');
  }

  function completeExport(){
    if (!allReviewed() && state.step !== 'complete') { showToast('请先处理全部异常'); return; }
    state.step = 'complete'; state.status = 'complete'; state.exported = true;
    render();
    showToast('商品表已生成，浏览器开始下载');
  }

  function handleClick(event){
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    event.preventDefault();
    const action = trigger.dataset.action;
    if (action === 'start') return startProcessing();
    if (action === 'reset') return reset();
    if (action === 'export') return completeExport();
    if (action === 'choose-file') return showToast('原型示例固定使用 268,432 条规格');
    if (action === 'pause') { state.paused = true; render(); showToast('解析已暂停，当前进度已保存'); return; }
    if (action === 'resume' || action === 'continue') { state.paused = false; state.status = 'processing'; render(); beginTimer(); showToast('已继续后台解析'); return; }
    if (action === 'cancel') { state.status = 'canceled'; state.paused = true; stopTimer(); render(); showToast('已取消解析，完成批次已保留'); return; }
    if (action === 'simulate-fail') { if (state.currentBatch >= BATCH_COUNT) return; state.failedBatch = state.currentBatch; state.status = 'failed'; state.paused = true; stopTimer(); render(); showToast('已模拟批次失败，可单独重试'); return; }
    if (action === 'retry-batch') { state.failedBatch = null; state.status = 'processing'; state.paused = false; render(); beginTimer(); showToast('失败批次已重新加入队列'); return; }
    if (action === 'review-tab') { state.reviewTab = trigger.dataset.tab; render(); return; }
    if (action === 'resolve-product') { state.productReviews[trigger.dataset.id] = 'confirmed'; render(); showToast('已确认商品级处理'); return; }
    if (action === 'resolve-sku') { state.skuReviews[trigger.dataset.id] = 'confirmed'; render(); showToast('已确认 SKU 处理'); return; }
    if (action === 'resolve-all') { productIssues.forEach((item) => { if (item.defaultMaterial) state.productReviews[item.id] = 'confirmed'; }); skuIssues.forEach((item) => { if (item.suggestion && item.suggestion !== '请填写' && item.suggestion !== '补充尺寸' && item.suggestion !== '请补充售价' && item.suggestion !== '请补充') state.skuReviews[item.id] = 'confirmed'; }); render(); showToast('已确认可直接应用的处理项'); return; }
    if (action === 'page-prev' || action === 'page-next') { const key = trigger.dataset.kind === 'product' ? 'productPage' : 'skuPage'; state[key] += action === 'page-prev' ? -1 : 1; render(); return; }
    if (action === 'mobile-menu') { sidebar.classList.toggle('open'); return; }
    if (action === 'nav') return showToast('原型仅展示商品转表流程');
  }

  function handleChange(event){
    const select = event.target.closest('[data-review-product]');
    if (!select) return;
    const id = select.dataset.reviewProduct;
    if (select.value) { state.productReviews[id] = select.value; render(); showToast('已保存商品材质复核'); }
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  render();
})();
