// Compatibility facade: all summaries and screens consume the same record queries.
(function (root) {
  'use strict';
  const Queries = typeof module === 'object' ? require('./operating-records/queries.js') : root.OperatingQueries;
  const Views = typeof module === 'object' ? require('./operating-records/views.js') : root.OperatingViews;
  const api = {
    ...Queries,
    ...Views
  };
  if (typeof module === 'object') module.exports = api; else root.OperatingRecords = api;
})(typeof globalThis === 'object' ? globalThis : {});
