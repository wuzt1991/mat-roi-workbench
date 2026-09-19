/* Preview appearance only; independent of business data and rendering. */
(() => {
  'use strict';
  const root = document.documentElement;
  const modeKey = 'mat-workbench-ui-study-mode-v1';
  const motionKey = 'mat-workbench-ui-study-motion-v1';
  function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch { /* Session choice still works. */ } }
  let mode = read(modeKey) === 'day' ? 'day' : 'rays';
  let motion = read(motionKey) !== 'false';
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>';
  const moon = '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>';
  function updateButton() {
    const host = document.querySelector('.topbar-right');
    if (!host) return;
    let button = host.querySelector('#ui-mode-toggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'ui-mode-toggle';
      button.type = 'button';
      button.className = 'ui-mode-toggle';
      host.append(button);
    }
    const day = mode === 'day';
    const label = day ? '侧光模式' : '日间模式';
    button.setAttribute('aria-label', `切换为${label}`);
    button.title = `当前：${day ? '日间 · 月白' : '侧光'}，点击切换为${label}`;
    button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${day ? moon : sun}</svg><span>${label}</span>`;
  }
  function apply() {
    const attrs = { uiRefine: 'true', uiMaterial: mode === 'day' ? 'pearl' : 'rays',
      uiPearlPalette: mode === 'day' ? 'moon' : '', uiPearlMotion: 'none', uiMotion: String(motion),
      uiCursorTrail: 'spark' };
    Object.entries(attrs).forEach(([key, value]) => {
      if (root.dataset[key] !== value) root.dataset[key] = value;
    });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode === 'day' ? 'light' : 'dark');
    updateButton();
    document.dispatchEvent(new CustomEvent('ui-appearance-change'));
  }
  window.UiAppearance = {
    getState: () => ({ mode, motion }),
    setMode(value) { mode = value === 'day' ? 'day' : 'rays'; save(modeKey, mode); apply(); },
    setMotion(value) {
      motion = Boolean(value); save(motionKey, String(motion)); apply();
      if (!motion) document.getAnimations().forEach(animation => animation.cancel());
    }
  };
  // Run in the head before styles and content paint to avoid a light flash on startup.
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    updateButton();
    const app = document.querySelector('#app');
    // Business rendering replaces #app's direct child. No full-subtree observer or polling.
    if (app) new MutationObserver(updateButton).observe(app, { childList: true });
    document.addEventListener('click', event => {
      if (event.target.closest('#ui-mode-toggle')) window.UiAppearance.setMode(mode === 'day' ? 'rays' : 'day');
    });
  }, { once: true });
  window.addEventListener('storage', event => {
    if (event.key !== null && ![modeKey, motionKey].includes(event.key)) return;
    mode = read(modeKey) === 'day' ? 'day' : 'rays';
    motion = read(motionKey) !== 'false'; apply();
  });
})();
