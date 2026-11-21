// HUD effects layer (drawn on top of the window, never catches clicks):
//  - tether: faint points drift across the window; the ones near the pointer light up and link to it
//    (they keep drifting on their own; nothing is pulled toward the pointer). No cursor box, no click effect.
//  - glitch: a short shake + red scan bar when the theme changes (window.nabbitGlitch)
// Off with Settings → Appearance → Cursor effects, and with Windows' "show animations" turned off.
(() => {
  const cv = document.getElementById('fx');
  const bar = document.getElementById('gbar');
  if (!cv) return;
  const g = cv.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const KEY = 'nabbit-fx';
  const RED = '255,42,31';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* default on */ }

  let w = 0;
  let h = 0;
  const nodes = [];
  const m = { x: 0, y: 0, ax: 0, ay: 0, on: false };
  let ink = '233,233,230';
  let raf = 0;

  function readInk() {
    // The text colour of the current theme, as "r,g,b".
    const c = getComputedStyle(document.body).color.match(/\d+(\.\d+)?/g);
    if (c) ink = c.slice(0, 3).map((n) => Math.round(Number(n))).join(',');
  }
  function resize() {
    const d = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    g.setTransform(d, 0, 0, d, 0, 0);
    const want = Math.round((w * h) / 14000); // ~50 points at the default window size
    while (nodes.length < want) nodes.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, r: Math.random() < 0.2 ? 2.3 : 1.4, p: Math.random() * 6.28 });
    nodes.length = Math.min(nodes.length, want);
  }

  function frame(t) {
    raf = 0;
    if (!active()) { g.clearRect(0, 0, w, h); return; }
    g.clearRect(0, 0, w, h);
    m.ax += (m.x - m.ax) * 0.2; m.ay += (m.y - m.ay) * 0.2;
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < -10) n.x = w + 10; if (n.x > w + 10) n.x = -10;
      if (n.y < -10) n.y = h + 10; if (n.y > h + 10) n.y = -10;
      let a = 0.1 + 0.06 * Math.sin(t / 900 + n.p);
      let r = n.r;
      if (m.on) {
        const dx = m.ax - n.x;
        const dy = m.ay - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 180) {
          const k = 1 - dist / 180;
          a = 0.25 + 0.7 * k; r = n.r + k * 1.5;
          g.strokeStyle = `rgba(${ink},${(k * 0.7).toFixed(3)})`;
          g.lineWidth = k > 0.55 ? 1.4 : 0.8;
          g.beginPath(); g.moveTo(m.ax, m.ay); g.lineTo(n.x, n.y); g.stroke();
        }
      }
      g.fillStyle = `rgba(${ink},${a.toFixed(3)})`;
      g.beginPath(); g.arc(n.x, n.y, r, 0, 6.2832); g.fill();
    }
    schedule();
  }
  const active = () => enabled && !reduce.matches && !document.hidden;
  function schedule() { if (!raf && active()) raf = requestAnimationFrame(frame); }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => {
    if (!m.on) { m.ax = e.clientX; m.ay = e.clientY; }
    m.x = e.clientX; m.y = e.clientY; m.on = true;
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { m.on = false; });
  window.addEventListener('blur', () => { m.on = false; });
  document.addEventListener('visibilitychange', schedule);
  reduce.addEventListener('change', schedule);

  // The theme fades over 0.3 s; read the new text colour once it has.
  const themeWatch = window.matchMedia('(prefers-color-scheme: dark)');
  themeWatch.addEventListener('change', () => setTimeout(readInk, 350));

  // Theme change: a short glitch (skipped when Windows' animations are off).
  window.nabbitGlitch = () => {
    if (reduce.matches) return;
    document.body.classList.remove('glitch');
    void document.body.offsetWidth; // restart the animation
    document.body.classList.add('glitch');
    clearTimeout(window.nabbitGlitch.t);
    window.nabbitGlitch.t = setTimeout(() => document.body.classList.remove('glitch'), 480);
    setTimeout(readInk, 350);
  };

  // Settings → Appearance → Cursor effects
  window.nabbitFx = {
    get enabled() { return enabled; },
    set(on) {
      enabled = !!on;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* not saved */ }
      cv.classList.toggle('off', !enabled);
      schedule();
    },
  };
  const box = document.getElementById('st-fx');
  if (box) {
    box.checked = enabled;
    box.addEventListener('change', () => window.nabbitFx.set(box.checked));
  }
  if (bar) bar.addEventListener('animationend', () => document.body.classList.remove('glitch'));

  cv.classList.toggle('off', !enabled);
  readInk();
  resize();
  schedule();
})();
