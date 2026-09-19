/* Trigger motion only for explicit navigation/disclosure. Never animate on every render. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => document.documentElement.dataset.uiRefine === 'true'
    && document.documentElement.dataset.uiMotion === 'true' && !reduced.matches;
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || !enabled()) return;
    const action = button.dataset.action;
    if (button.matches('.active, [aria-current="page"]')) return;
    const navigation = ['nav', 'tab', 'library-tab'].includes(action);
    const disclosure = action === 'sku-options' && button.getAttribute('aria-expanded') === 'false';
    if (!navigation && !disclosure) return;
    requestAnimationFrame(() => {
      if (!enabled()) return;
      const target = document.querySelector(disclosure ? '#sku-options:not([hidden])' : '#main-content');
      target?.animate(disclosure
        ? [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: .5 }, { opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }, true);
  reduced.addEventListener('change', () => {
    if (reduced.matches) document.getAnimations().forEach(animation => animation.cancel());
  });
})();
