/* Selected micro-star cursor trail; see docs/ui-material-studies.md. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(pointer: fine)');
  const layer = document.createElement('div');
  layer.id = 'ui-cursor-trail-layer';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.id = 'ui-cursor-trail';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  layer.append(canvas);
  document.body.append(layer);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = 272, center = size / 2, reach = 108, life = 420, spacing = 6;
  const palettes = {
    rays: { halo: '#aedee7', core: '#e4f5f7', accent: '#c3dcd1', star: '#eaf9f9' },
    pearl: { halo: '#b1c9ce', core: '#738a95', accent: '#819c91', star: '#647e8a' }
  };
  // Fixed storage bounds the visual density, independent of refresh rate and event frequency.
  const points = Array.from({ length: 64 }, () => ({ x: 0, y: 0, born: 0, active: false, seed: 0 }));
  let head = 0, serial = 0, raf = 0, last = null, x = 0, y = 0, dpr = 0;
  const enabled = () => root.dataset.uiRefine === 'true' && ['rays', 'pearl'].includes(root.dataset.uiMaterial)
    && root.dataset.uiMotion === 'true' && root.dataset.uiCursorTrail === 'spark'
    && fine.matches && !reduced.matches && !document.hidden;

  function resize() {
    // Native resolution; no frame-rate cap or automatic quality reduction.
    dpr = devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function reset() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; last = null; head = 0;
    points.forEach(p => { p.active = false; });
    ctx.clearRect(0, 0, size, size);
    canvas.hidden = true;
  }
  function add(px, py, born) {
    const p = points[head];
    p.x = px; p.y = py; p.born = born; p.active = true; p.seed = serial++;
    head = (head + 1) % points.length;
  }
  function move(event) {
    if (!enabled() || event.pointerType === 'touch' || event.buttons
      || event.target?.closest?.('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]')) {
      reset(); return;
    }
    const now = performance.now();
    x = event.clientX; y = event.clientY;
    if (dpr !== (devicePixelRatio || 1)) resize();
    if (last && now - last.time > life) last = null;
    if (!last) {
      last = { x, y, time: now }; add(x, y, now);
    } else {
      const dx = x - last.x, dy = y - last.y;
      const distance = Math.hypot(dx, dy);
      if (distance < spacing) return;
      const count = Math.ceil(Math.min(distance, reach) / spacing);
      // Reconstruct only the last local segment of a fast move, never a line across the page.
      for (let i = count - 1; i >= 0; i--) {
        const t = 1 - i * spacing / distance;
        add(last.x + dx * t, last.y + dy * t, now - (now - last.time) * (1 - t));
      }
      last = { x, y, time: now };
    }
    canvas.hidden = false;
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function stroke(ax, ay, bx, by, width, color, alpha) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  function draw(now) {
    raf = 0;
    if (!enabled()) { reset(); return; }
    canvas.style.transform = `translate3d(${x - center}px,${y - center}px,0)`;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    // Leave the native cursor tip and immediate click target clear.
    ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.moveTo(center + 7, center); ctx.arc(center, center, 7, 0, Math.PI * 2);
    ctx.clip('evenodd');
    ctx.lineCap = 'round';
    // Keep the same particles legible on moon-white surfaces with a muted silver/green tint.
    const palette = palettes[root.dataset.uiMaterial];
    let alive = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[(head - 1 - i + points.length) % points.length];
      const age = now - p.born;
      if (!p.active || age >= life) { p.active = false; continue; }
      const distance = Math.hypot(p.x - x, p.y - y);
      if (distance > reach) { p.active = false; continue; }
      const fade = Math.pow(1 - Math.max(0, age) / life, 1.5);
      const edge = Math.min(1, (reach - distance) / 24);
      const alpha = fade * edge;
      let px = p.x - x + center, py = p.y - y + center;
      alive = true;
      const progress = Math.max(0, age) / life;
      const angle = p.seed * 2.39996;
      px += Math.cos(angle) * (2 + progress * 10);
      py += Math.sin(angle) * (2 + progress * 10);
      const radius = (p.seed % 4 === 0 ? 2 : 1.1) * (1 - progress * .6);
      ctx.globalAlpha = alpha * .14; ctx.fillStyle = palette.halo;
      ctx.beginPath(); ctx.arc(px, py, radius * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha * .95; ctx.fillStyle = p.seed % 3 ? palette.core : palette.accent;
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
      if (p.seed % 7 === 0) {
        stroke(px - 3.5, py, px + 3.5, py, .7, palette.star, alpha * .55);
        stroke(px, py - 3.5, px, py + 3.5, .7, palette.star, alpha * .55);
      }
    }
    ctx.restore();
    if (alive) raf = requestAnimationFrame(draw);
    else reset();
  }
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) reset(); });
  document.addEventListener('pointerdown', reset, { passive: true });
  document.addEventListener('pointercancel', reset, { passive: true });
  document.addEventListener('scroll', reset, { passive: true, capture: true });
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('blur', reset);
  window.addEventListener('pagehide', reset);
  window.addEventListener('resize', () => { reset(); resize(); }, { passive: true });
  reduced.addEventListener('change', reset);
  fine.addEventListener('change', reset);
  new MutationObserver(reset).observe(root, { attributes: true,
    attributeFilter: ['data-ui-refine', 'data-ui-motion', 'data-ui-material', 'data-ui-cursor-trail'] });
  resize();
})();
