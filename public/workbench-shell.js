// Feature lifetime only; the application owns the single state and SaveQueue.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api; else root.WorkbenchShell = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function create({product = () => null, sales = () => null, context = () => ({})} = {}) {
    let view = 'plan';
    function navigate(next) {
      if (view === 'product' && next !== 'product') product()?.deactivate?.();
      view = next;
      return view;
    }
    function mount() {
      if (view === 'product') product()?.activate?.(context());
    }
    function canQuit() {
      return product()?.canQuit?.() !== false && sales()?.canQuit?.() !== false;
    }
    function destroy() {
      product()?.destroy?.();
      sales()?.destroy?.();
    }
    return {
      navigate,
      mount,
      canQuit,
      destroy
    };
  }
  return {
    create
  };
});
