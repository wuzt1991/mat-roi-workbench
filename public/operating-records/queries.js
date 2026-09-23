(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('../domain.js') : root.MatModel, H = typeof module === 'object' ? require('../trends.js') : root.MatTrends;
  function validRange(f) {
    if (f.from && !M.validDate(f.from) || f.to && !M.validDate(f.to) || f.from && f.to && f.from > f.to) throw Error('请检查开始和结束日期');
  }
  const spend = h => (h.frame?.plan.params.spend ?? h.legacy?.spend) ?? 0;
  function summarize(rows) {
    const effective = rows.filter(h => h.kind === 'daily' && h.status === 'confirmed');
    const r = effective.reduce((a, h) => ({
      count: a.count + 1,
      spend: a.spend + spend(h),
      gmv: a.gmv + h.result.gmv,
      profit: a.profit + h.result.profit
    }), {
      count: 0,
      spend: 0,
      gmv: 0,
      profit: 0
    });
    return {
      ...r,
      roi: r.spend > 0 ? r.gmv / r.spend : null,
      days: new Set(effective.map(h => h.date)).size
    };
  }
  function summary(state, f = {}) {
    validRange(f);
    return summarize(M.ledger(state, {
      ...f,
      includeOld: false
    }).rows);
  }
  function groups(state, f = {}, kind = 'plan', sort = 'profit-desc') {
    validRange(f);
    const map = new Map();
    for (const h of M.ledger(state, {
      ...f,
      includeOld: false
    }).rows) {
      const id = kind === 'shop' ? h.shopId : h.planId;
      let group = map.get(id);
      if (!group) {
        const p = state.plans.find(p => p.id === h.planId), shop = state.shops.find(s => s.id === h.shopId);
        group = {
          id,
          shopId: h.shopId,
          name: kind === 'shop' ? shop?.name || h.shopName : p?.name || h.planName,
          shopName: shop?.name || h.shopName,
          deleted: kind === 'shop' ? !!shop?.deleted : !!p?.deleted,
          rows: []
        };
        map.set(id, group);
      }
      group.rows.push(h);
    }
    const values = [...map.values()].map(g => ({
      ...g,
      ...summarize(g.rows),
      planCount: new Set(g.rows.map(h => h.planId)).size
    }));
    return values.sort((a, b) => (sort === 'profit-asc' ? a.profit - b.profit : sort === 'spend-desc' ? b.spend - a.spend : b.profit - a.profit) || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
  }
  function missingRangeTooLarge(f) {
    return !!(f.from && f.to && (Date.parse((f.to < M.today() ? f.to : M.today()) + 'T00:00:00Z') - Date.parse(f.from + 'T00:00:00Z')) / 86400000 >= 4000);
  }
  function dailyRows(state, f = {}) {
    validRange(f);
    const rows = M.ledger(state, f).rows;
    if (!f.planId || f.includeOld || !f.from || !f.to || missingRangeTooLarge(f)) return rows;
    const seen = new Set(rows.map(h => h.date)), result = [...rows];
    let date = f.from;
    while (date <= f.to && date <= M.today()) {
      if (!seen.has(date)) result.push({
        date,
        missing: true
      });
      date = H.shift(date, 1);
    }
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }
  function period(date, unit) {
    const d = new Date(date + 'T00:00:00Z');
    if (unit === 'month') d.setUTCDate(1); else if (unit === 'week') d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  }
  function series(state, f = {}) {
    validRange(f);
    const s = H.series(state, f), map = new Map();
    for (const h of M.ledger(state, {
      ...f,
      includeOld: false
    }).rows) {
      const key = period(h.date, f.unit || 'day');
      map.set(key, (map.get(key) || 0) + spend(h));
    }
    return {
      ...s,
      points: s.points.map(p => ({
        ...p,
        spend: p.count ? map.get(p.key) ?? 0 : null
      }))
    };
  }
  function sourceLabel(plan) {
    const s = plan?.salesSource;
    return s ? `占比参考：${s.period} · ${s.basis === 'units' ? '成交件数估算' : '成交订单数'}${s.editedAfterImport ? ' · 导入后已调整' : ''}` : '订单占比：按本次计划填写';
  }
  const api = {
    validRange,
    spend,
    summarize,
    summary,
    groups,
    missingRangeTooLarge,
    dailyRows,
    period,
    series,
    sourceLabel
  };
  if (typeof module === 'object') module.exports = api; else root.OperatingQueries = api;
})(typeof globalThis === 'object' ? globalThis : {});
