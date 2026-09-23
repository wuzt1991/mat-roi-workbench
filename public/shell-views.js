(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('./domain.js') : root.MatModel;
  const {e, option, ib, btn, roi, icon} = typeof module === 'object' ? require('./ui-format.js') : root.WorkbenchFormat;
  function nav({state, view, version: APP_VERSION, plans}) {
    return `<aside class="sidebar">
    <a class="brand" href="#" data-action="plan-view"><span class="brand-mark"><img src="assets/app-icon.png" alt="" width="34" height="34"></span><div><div class="brand-title">地垫工作台</div><div class="brand-sub">全域投放 · 盈亏测算</div></div></a>
    <div class="shop-picker"><label for="active-shop">当前店铺</label><div class="row"><select id="active-shop" aria-label="当前店铺">${state.shops.filter(s => !s.deleted).map(s => option(s.id, s.name, state.activeShop)).join('')}</select>${ib('shops', '管理店铺', 'settings-2', view === 'shops' ? 'aria-current="page"' : '')}</div></div>
    <nav class="nav-group" aria-label="主导航">${[['plan-view', '投放测算', 'layout-dashboard', 'plan'], ['ledger-view', '总账', 'chart-no-axes-combined', 'history'], ['library-view', '可复用规则', 'library', 'library'], ['product-view', '商品转表', 'table-2', 'product']].map(([a, l, i, v]) => btn(a, l, i, 'nav-item ' + (view === v ? 'active' : ''), view === v ? 'aria-current="page"' : '')).join('')}</nav>
    <section class="plan-nav-section" aria-label="我的计划"><div class="nav-title">${btn('plans-view', '我的计划', '', 'ghost')}${ib('new-plan', '新建计划', 'plus')}</div><div class="plan-list-scroll">${plans.map((p, i) => {
      const r = M.calculate(state, p);
      return `<div class="plan-nav-row ${state.active === p.id ? 'active' : ''}"><button type="button" class="plan-nav" data-action="select-plan" data-id="${e(p.id)}" ${state.active === p.id ? 'aria-current="true"' : ''}><span class="plan-symbol">${i + 1}</span><span class="grow"><span class="plan-name" title="${e(p.name)}">${e(p.name)}</span><span class="plan-roi" data-sidebar="${e(p.id)}">保本 ROI ${r.valid ? roi(r.roi) : '待完善'}</span></span></button><div class="plan-nav-tools">${ib('pin-plan', (p.pinned ? '取消置顶 ' : '置顶 ') + p.name, p.pinned ? 'pin-off' : 'pin', `data-id="${e(p.id)}" aria-pressed="${!!p.pinned}"`)}${ib('delete-plan', '删除 ' + p.name, 'x', `data-id="${e(p.id)}"`)}</div></div>`;
    }).join('') || '<p class="note sidebar-empty">暂无计划</p>'}</div></section>
    <div class="sidebar-bottom">${btn('data-view', '备份与迁移', 'file-spreadsheet', 'nav-item ' + (view === 'data' ? 'active' : ''), view === 'data' ? 'aria-current="page"' : '')}<div class="local-status"><span class="status-dot"></span>本机保存 · 手动录入</div><div class="view-label">内测版 v${APP_VERSION} · PC</div></div>
  </aside>`;
  }
  function topbar({view, shopName, planName, version: APP_VERSION, saveText, updateText, updateButton}) {
    const titles = {
      library: '可复用规则',
      history: '总账',
      plans: '计划管理',
      data: '备份与迁移',
      shops: '店铺管理',
      product: '商品转表'
    };
    return `<header class="topbar"><div class="crumbs"><span>${e(view === 'history' ? '全部经营数据' : ['library', 'data', 'shops', 'product'].includes(view) ? '工作台' : shopName)}</span>${icon('chevron-right')}<strong>${e(titles[view] || planName || '投放测算')}</strong></div><div class="topbar-right"><span class="tag">内测版 v${APP_VERSION}</span><span id="save-status" role="status">${saveText}</span><div id="update-controls" class="update-controls">${updateText}${updateButton}</div>${ib('export', '导出 Excel 备份', 'download')}</div></header><div id="save-banner"></div><div id="inline-draft-banner"></div>`;
  }
  const api = {
    nav,
    topbar
  };
  if (typeof module === 'object') module.exports = api; else root.ShellViews = api;
})(typeof globalThis === 'object' ? globalThis : {});
