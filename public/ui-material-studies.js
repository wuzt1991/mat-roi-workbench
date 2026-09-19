/* Preview-only motion host. References and attribution: docs/ui-material-studies.md. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(pointer: fine)');
  const canvas = document.createElement('canvas');
  canvas.id = 'ui-rays-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const surfaces = '.plan-overview .main-column,.parameter-rail,.plan-detail-card,.wide-content';
  const lights = new Map();
  let renderer = null, attempted = false, contextLost = false;
  let frame = 0, previous = 0, elapsed = 0, activeSurface = null;
  const enabled = () => root.dataset.uiRefine === 'true' && root.dataset.uiMotion === 'true' && !reduced.matches;
  const isRays = () => root.dataset.uiRefine === 'true' && root.dataset.uiMaterial === 'rays';
  const canShine = () => enabled() && fine.matches && ['crystal', 'rays'].includes(root.dataset.uiMaterial)
    && (!root.dataset.uiCursorTrail || root.dataset.uiCursorTrail === 'none');

  function initRays() {
    if (attempted || contextLost) return;
    attempted = true;
    renderer = window.UiSideRays?.create(canvas) || null;
    canvas.dataset.renderer = renderer ? 'webgl' : 'unavailable';
    renderer?.resize(innerWidth, innerHeight);
  }
  function removeLights() {
    lights.forEach(light => light.layer.remove());
    lights.clear();
    activeSurface = null;
  }
  function wake() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function tick(now) {
    frame = 0;
    if (document.hidden) { previous = 0; return; }
    const dt = previous ? Math.min(now - previous, 50) : 1000 / 60;
    previous = now;
    const animateRays = isRays() && enabled() && renderer && !contextLost;
    if (animateRays) {
      elapsed += dt / 1000;
      // No default frame-rate cap: the side-light follows the display's refresh rate.
      renderer.render(elapsed);
    }
    let unsettled = false;
    // Pearl stays close to the pointer; other materials retain their broad soft reflection.
    const local = root.dataset.uiMaterial === 'pearl';
    const follow = 1 - Math.exp(-dt / (local ? 48 : 85));
    const echoFollow = 1 - Math.exp(-dt / 120);
    const fade = 1 - Math.exp(-dt / 140);
    lights.forEach((light, surface) => {
      if (!surface.isConnected) { light.layer.remove(); lights.delete(surface); return; }
      light.x += (light.targetX - light.x) * follow;
      light.y += (light.targetY - light.y) * follow;
      light.angle += (light.targetAngle - light.angle) * follow;
      light.echoX += (light.targetX - light.echoX) * echoFollow;
      light.echoY += (light.targetY - light.echoY) * echoFollow;
      if (local) {
        const lag = Math.hypot(light.x - light.targetX, light.y - light.targetY);
        if (lag > 14) {
          light.x = light.targetX + (light.x - light.targetX) * 14 / lag;
          light.y = light.targetY + (light.y - light.targetY) * 14 / lag;
        }
        const echoLag = Math.hypot(light.echoX - light.x, light.echoY - light.y);
        if (echoLag > 18) {
          light.echoX = light.x + (light.echoX - light.x) * 18 / echoLag;
          light.echoY = light.y + (light.echoY - light.y) * 18 / echoLag;
        }
      }
      light.alpha += (light.targetAlpha - light.alpha) * fade;
      light.layer.style.setProperty('--glare-x', `${light.x.toFixed(2)}px`);
      light.layer.style.setProperty('--glare-y', `${light.y.toFixed(2)}px`);
      light.layer.style.setProperty('--glare-angle', `${light.angle.toFixed(2)}deg`);
      light.layer.style.setProperty('--echo-x', `${light.echoX.toFixed(2)}px`);
      light.layer.style.setProperty('--echo-y', `${light.echoY.toFixed(2)}px`);
      light.layer.style.opacity = light.alpha.toFixed(4);
      if (!light.targetAlpha && light.alpha < 0.002) {
        light.layer.remove(); lights.delete(surface);
      } else if (Math.abs(light.x - light.targetX) > 0.1 || Math.abs(light.y - light.targetY) > 0.1 || Math.abs(light.echoX - light.targetX) > 0.1 || Math.abs(light.echoY - light.targetY) > 0.1 || Math.abs(light.angle - light.targetAngle) > 0.1 || Math.abs(light.alpha - light.targetAlpha) > 0.002) {
        unsettled = true;
      }
    });
    if (animateRays || unsettled) wake();
    else previous = 0;
  }
  function leaveSurface() {
    if (activeSurface && lights.has(activeSurface)) lights.get(activeSurface).targetAlpha = 0;
    activeSurface = null;
    if (lights.size) wake();
  }
  document.addEventListener('pointermove', event => {
    if (!canShine()) return;
    // The whole panel owns its light: crossing metrics, labels and gaps never resets it.
    const surface = event.target instanceof Element ? event.target.closest(surfaces) : null;
    if (surface !== activeSurface) {
      leaveSurface();
      activeSurface = surface;
    }
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let light = lights.get(surface);
    if (!light) {
      const layer = document.createElement('div');
      layer.className = 'ui-surface-light';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.opacity = '0';
      surface.append(layer);
      light = { layer, x, y, echoX: x, echoY: y, targetX: x, targetY: y, angle: 0, targetAngle: 0, alpha: 0, targetAlpha: 1 };
      lights.set(surface, light);
    }
    // Bounded position-based tilt cannot spin at ±180° when the pointer reverses.
    light.targetAngle = Math.max(-40, Math.min(40, (x / rect.width - 0.5) * 80));
    light.targetX = x;
    light.targetY = y;
    light.targetAlpha = 1;
    wake();
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) leaveSurface(); });
  document.addEventListener('scroll', leaveSurface, { passive: true, capture: true });
  window.addEventListener('blur', leaveSurface);

  function refresh() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = 0;
    removeLights();
    if (isRays() && !document.hidden) {
      initRays();
      if (!contextLost) renderer?.render(elapsed);
      if (enabled() && !document.hidden && renderer && !contextLost) wake();
    }
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; renderer = null;
    canvas.dataset.renderer = 'context-lost'; refresh();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; attempted = false; refresh();
  });
  new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-ui-material', 'data-ui-motion', 'data-ui-refine', 'data-ui-pearl-palette', 'data-ui-pearl-motion', 'data-ui-cursor-trail'] });
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  fine.addEventListener('change', refresh);
  window.addEventListener('resize', () => {
    renderer?.resize(innerWidth, innerHeight); refresh();
  }, { passive: true });
  window.addEventListener('pagehide', () => { if (frame) cancelAnimationFrame(frame); frame = 0; removeLights(); });
  window.addEventListener('pageshow', refresh);
  refresh();
})();
