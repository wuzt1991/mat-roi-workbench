// Keep dispatch policy separate from formulas. A frame's calculation version
// and a workspace's storage version are intentionally different contracts.
(function (root) {
  'use strict';
  const calculation = state => state.calculationVersion === 4 || state.version === 4 ? 'current' : 'v3';
  const frame = state => state.version === 4 ? 'current' : 'v3';
  function workspace(input) {
    if (!input || ![1, 2, 3, 4].includes(input.version)) throw Error('不支持此工作区版本');
    return input.version === 4 ? 'current' : input.version === 3 ? 'v3' : 'legacy';
  }
  const workbookTables = format => format < 5 ? 'v3' : 'current';
  const workbookData = (format, state) => format < 5 && state.version !== 4 ? 'v3' : 'current';
  const workbookVersionValid = (format, state) => format >= 5 ? state.version === 4 : [3, 4].includes(state.version);
  const api = {
    calculation,
    frame,
    workspace,
    workbookTables,
    workbookData,
    workbookVersionValid
  };
  if (typeof module === 'object') module.exports = api; else root.WorkbenchCompatibility = api;
})(typeof globalThis === 'object' ? globalThis : {});
