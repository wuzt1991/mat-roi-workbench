(function (root) {
  'use strict';
  const M = typeof module === 'object' ? require('../domain.js') : root.MatModel;
  const H = typeof module === 'object' ? require('../trends.js') : root.MatTrends;
  function create() {
    const local = {
      ledger: {
        shopId: '',
        planId: '',
        from: H.shift(M.today(), -6),
        to: M.today(),
        includeOld: false
      },
      operating: {
        from: H.shift(M.today(), -6),
        to: M.today(),
        unit: 'day',
        includeOld: false
      },
      metric: 'spend',
      page: 0,
      group: 'plan',
      sort: 'profit-desc'
    };
    const filters = all => all ? local.ledger : local.operating;
    function range(all, days) {
      Object.assign(filters(all), {
        from: days ? H.shift(M.today(), 1 - days) : '',
        to: days ? M.today() : ''
      });
      local.page = 0;
    }
    function setFilter(all, key, value) {
      filters(all)[key] = value;
      if (all && key === 'shopId') local.ledger.planId = '';
      local.page = 0;
    }
    function group(value) {
      local.group = value;
      local.page = 0;
    }
    function shop(id) {
      local.ledger.shopId = id;
      local.ledger.planId = '';
      group('plan');
    }
    function drillPlan(id, available) {
      if (available) Object.assign(local.operating, {
        from: local.ledger.from,
        to: local.ledger.to,
        includeOld: false
      }); else {
        local.ledger.planId = id;
        local.group = 'records';
      }
      local.page = 0;
    }
    function entryDate(date) {
      const f = local.operating;
      if (f.from && date < f.from || f.to && date > f.to) {
        f.from = H.shift(date, -6);
        f.to = date;
      }
      local.page = 0;
    }
    function clear() {
      local.ledger = {
        shopId: '',
        planId: '',
        from: '',
        to: '',
        includeOld: false
      };
    }
    return {
      state: local,
      filters,
      range,
      setFilter,
      group,
      shop,
      drillPlan,
      entryDate,
      clear
    };
  }
  const api = {
    create
  };
  if (typeof module === 'object') module.exports = api; else root.OperatingController = api;
})(typeof globalThis === 'object' ? globalThis : {});
