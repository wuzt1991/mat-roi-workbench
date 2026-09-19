(() => {
  'use strict';
  const frame = document.querySelector('#preview');
  const motion = document.querySelector('#motion');
  const description = document.querySelector('#material-description');
  let appearance;
  function sync() {
    if (!appearance) return;
    const state = appearance.getState();
    document.documentElement.dataset.mode = state.mode;
    motion.checked = state.motion;
    description.textContent = state.mode === 'day' ? '日间月白 · 微星粒子' : '侧光模式 · 微星粒子';
  }
  function connect() {
    appearance = frame.contentWindow?.UiAppearance;
    frame.contentDocument?.addEventListener('ui-appearance-change', sync);
    sync();
  }
  motion.addEventListener('change', () => appearance?.setMotion(motion.checked));
  frame.addEventListener('load', connect);
  if (frame.contentWindow?.UiAppearance) connect();
})();
