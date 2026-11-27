// The time shaper's editor (Audio Tools → Change pitch and tempo → Rhythm → Shaper), laid out like
// ShaperBox's TimeShaper: one cycle (a note length to 32 bars) across, how late the sound plays down
// (0 at the top, the whole cycle at the bottom), the song's beat grid behind. The curve:
//  - drag a point (snaps to the grid; Alt: free); the first and last only move up and down
//  - double-click empty space: a new point; double-click a point (or right-click): remove it
//  - Ctrl + double-click a point: a second point at the same place, for a jump (then drag one of them)
//  - drag a line up or down: bend it
// Presets, the cycle's length, Smooth / Steps, 2× (twice as fast), ◀ ▶ (move by a sixteenth), clear,
// undo / redo. window.ShaperEditor(box, { onChange, playhead }) → { get(), set(shape) }.
(function () {
  const P = () => window.NabbitPitch;
  const LENGTHS = [
    ['Triplet', [['1/16T', 1 / 6], ['1/8T', 1 / 3], ['1/4T', 2 / 3], ['1/2T', 4 / 3]]],
    ['Straight', [['1/128', 1 / 32], ['1/64', 1 / 16], ['1/32', 1 / 8], ['1/16', 1 / 4], ['1/8', 1 / 2], ['1/4', 1], ['1/2', 2], ['1 Bar', 4], ['2 Bars', 8], ['4 Bars', 16], ['8 Bars', 32], ['16 Bars', 64], ['32 Bars', 128]]],
    ['Dotted', [['1/16d', 3 / 8], ['1/8d', 3 / 4], ['1/4d', 1.5], ['3/4', 3], ['1.5 Bars', 6], ['3 Bars', 12]]],
  ];
  const PRESETS = [['halftime', 'Half-time'], ['tripletize', 'Tripletize'], ['pitch', 'Pitch'], ['stutter', 'Stutter'], ['tapestop', 'Tape stop'], ['reverse', 'Reverse'], ['flat', 'Flat']];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // A length in beats as a note value: 1 → 1/4, 0.25 → 1/16, 4 → 4/4.
  const noteText = (beats) => {
    if (Math.abs(beats) < 1e-9) return '0';
    for (const d of [4, 8, 16, 32, 64, 128]) { const n = (beats * d) / 4; if (Math.abs(n - Math.round(n)) < 1e-6) return `${Math.round(n)}/${d}`; }
    return `${Math.round(beats * 100) / 100} b`;
  };

  window.ShaperEditor = function ShaperEditor(box, { onChange = () => {}, playhead = () => null } = {}) {
    let shape = null, undo = [], redo = [];
    const presetShape = (name, keep) => {
      const s = clone(P().SHAPES[name]);
      if (keep) { s.cycle = keep.cycle; s.steps = keep.steps; }
      s.steps = !!s.steps;
      return s;
    };
    try { const saved = JSON.parse(localStorage.getItem('nabbit.ptShape') || 'null'); if (saved && saved.points && saved.points.length >= 2) shape = saved; } catch { /* none */ }
    if (!shape) shape = presetShape('halftime');

    box.textContent = '';
    box.classList.add('sh');
    const presets = el('div', 'sh-presets');
    for (const [k, name] of PRESETS) {
      const b = el('button', 'chip', name); b.type = 'button'; b.dataset.k = k;
      b.title = k === 'flat' ? 'No change' : `The ${name} shape (its own length: ${noteText(P().SHAPES[k].cycle)})`;
      b.onclick = () => commit(() => { shape = presetShape(k); shape.preset = k; });
      presets.append(b);
    }
    const cv = el('canvas', 'sh-cv');
    cv.setAttribute('aria-label', 'Time shape: how late the sound plays across one cycle');
    const bar = el('div', 'sh-bar');
    const len = el('select', 'sh-len');
    len.title = 'The cycle: how long one pass of the shape is';
    for (const [group, items] of LENGTHS) {
      const og = document.createElement('optgroup'); og.label = group;
      for (const [t, v] of items) { const o = el('option', '', t); o.value = String(v); og.append(o); }
      len.append(og);
    }
    const keep = (fn) => { fn.keep = true; return fn; };
    len.onchange = () => commit(keep(() => { shape.cycle = Number(len.value); }));
    const mode = el('div', 'tm-seg cp-seg sh-mode');
    for (const [v, t, tip] of [[false, 'Smooth', 'The speed follows the curve: pitch and tempo together, like a record or tape'], [true, 'Steps', 'Held for each sixteenth of the cycle: pieces moved, the pitch untouched']]) {
      const b = el('button', 'chip', t); b.type = 'button'; b.dataset.v = String(v); b.title = tip;
      b.onclick = () => commit(keep(() => { shape.steps = v; }));
      mode.append(b);
    }
    const btn = (t, tip, fn) => { const b = el('button', 'ghost sh-btn', t); b.type = 'button'; b.title = tip; b.onclick = fn; return b; };
    const dbl = btn('2×', 'Twice as fast: the shape twice in one cycle', () => commit(() => {
      const pts = [], cur = [];
      for (const half of [0, 0.5]) { shape.points.forEach((p) => pts.push({ x: half + p.x / 2, y: p.y })); cur.push(...shape.curves, 0); }
      shape.points = pts; shape.curves = cur.slice(0, pts.length - 1);
    }));
    const left = btn('◀', 'Move the shape a sixteenth earlier', () => commit(() => rotate(-1 / 16)));
    const right = btn('▶', 'Move the shape a sixteenth later', () => commit(() => rotate(1 / 16)));
    const clear = btn('🗑', 'Flat (no change)', () => commit(() => { shape = { ...presetShape('flat'), cycle: shape.cycle, steps: shape.steps }; }));
    const un = btn('↶', 'Undo', () => { if (!undo.length) return; redo.push(clone(shape)); shape = undo.pop(); changed(); });
    const re = btn('↷', 'Redo', () => { if (!redo.length) return; undo.push(clone(shape)); shape = redo.pop(); changed(); });
    const hint = el('span', 'dim sh-hint', 'Drag a point · double-click: add / remove · Ctrl + double-click a point: a jump · drag a line: bend · Alt: off the grid');
    bar.append(len, mode, dbl, left, right, clear, un, re, hint);
    box.append(presets, cv, bar);

    // Move the whole shape along by d (wrapping round): sampled at its points and the new ends.
    function rotate(d) {
      const old = clone(shape), pts = [];
      const at = (x) => P().curveAt(old, ((x % 1) + 1) % 1);
      for (const p of old.points) { if (p.x >= 1 - 1e-9) continue; pts.push({ x: (((p.x + d) % 1) + 1) % 1, y: p.y }); }
      pts.push({ x: 0, y: at(-d) }, { x: 1, y: at(1 - d - 1e-9) });
      pts.sort((a, b) => a.x - b.x);
      shape.points = pts; shape.curves = pts.slice(1).map(() => 0);
    }
    function commit(fn) { undo.push(clone(shape)); if (undo.length > 60) undo.shift(); redo = []; const was = shape.preset; delete shape.preset; fn(); if (shape.preset === undefined && fn.keep) shape.preset = was; changed(); }
    function changed() {
      try { localStorage.setItem('nabbit.ptShape', JSON.stringify(shape)); } catch { /* not kept */ }
      len.value = String(shape.cycle);
      if (len.selectedIndex < 0) { const o = el('option', '', noteText(shape.cycle)); o.value = String(shape.cycle); len.append(o); len.value = o.value; }
      for (const b of mode.children) b.classList.toggle('active', b.dataset.v === String(!!shape.steps));
      for (const b of presets.children) b.classList.toggle('active', b.dataset.k === shape.preset);
      draw();
      onChange(shape);
    }

    // ---------- Drawing ----------
    const M = { l: 44, r: 12, t: 18, b: 8 };
    let W = 0, H = 0, hover = -1, hoverSeg = -1;
    const px = (x) => M.l + x * (W - M.l - M.r), py = (y) => M.t + y * (H - M.t - M.b);
    const ux = (X) => (X - M.l) / (W - M.l - M.r), uy = (Y) => (Y - M.t) / (H - M.t - M.b);
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      W = cv.clientWidth; H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'), cs = getComputedStyle(document.documentElement);
      const col = (n, d) => cs.getPropertyValue(n).trim() || d;
      const accent = col('--red', '#ff2a1f'), text = col('--text', '#ddd'), muted = col('--muted', '#888'), line = col('--line', '#444');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // The part that reads from the cycle before (below the diagonal): hatched.
      g.save();
      g.beginPath(); g.moveTo(px(0), py(0)); g.lineTo(px(1), py(1)); g.lineTo(px(0), py(1)); g.closePath(); g.clip();
      g.strokeStyle = line; g.globalAlpha = 0.5; g.lineWidth = 1;
      for (let k = -H; k < W; k += 9) { g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
      g.restore();
      // The grid: 16 across (stronger every 4), 4 down, labelled like note values.
      g.font = '9px ' + (col('--mono', 'monospace'));
      g.fillStyle = muted;
      for (let k = 0; k <= 16; k++) {
        const x = Math.round(px(k / 16)) + 0.5;
        g.strokeStyle = line; g.globalAlpha = k % 4 === 0 ? 0.9 : 0.35;
        g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, H - M.b); g.stroke();
        if (k % 4 === 0) { g.globalAlpha = 1; g.textAlign = k === 0 ? 'left' : k === 16 ? 'right' : 'center'; g.fillText(noteText((k / 16) * shape.cycle), x, 11); }
      }
      for (let k = 0; k <= 4; k++) {
        const y = Math.round(py(k / 4)) + 0.5;
        g.strokeStyle = line; g.globalAlpha = 0.6;
        g.beginPath(); g.moveTo(M.l, y); g.lineTo(W - M.r, y); g.stroke();
        g.globalAlpha = 1; g.textAlign = 'right';
        g.fillText(k ? `−${noteText((k / 4) * shape.cycle)}` : '0', M.l - 6, y + 3);
      }
      g.globalAlpha = 1;
      // The curve (steps: as it'll be held).
      g.strokeStyle = accent; g.lineWidth = 2.5; g.lineJoin = 'round';
      g.beginPath();
      const steps = 400;
      for (let i = 0; i <= steps; i++) {
        let p = i / steps;
        if (shape.steps) p = Math.min(15 / 16, Math.floor(p * 16) / 16);
        const y = P().curveAt(shape, Math.min(p, 1 - 1e-9));
        if (i === 0) g.moveTo(px(i / steps), py(y)); else g.lineTo(px(i / steps), py(y));
      }
      g.stroke();
      // Jumps drawn as vertical lines; the segment being bent, highlighted.
      for (let i = 0; i < shape.points.length - 1; i++) {
        const a = shape.points[i], b = shape.points[i + 1];
        if (b.x - a.x < 1e-9) { g.beginPath(); g.moveTo(px(a.x), py(a.y)); g.lineTo(px(b.x), py(b.y)); g.stroke(); }
      }
      if (hoverSeg >= 0 && !shape.steps) {
        const a = shape.points[hoverSeg], b = shape.points[hoverSeg + 1];
        g.strokeStyle = text; g.lineWidth = 3; g.globalAlpha = 0.5;
        g.beginPath();
        for (let i = 0; i <= 40; i++) { const u = i / 40, x = a.x + (b.x - a.x) * u, y = P().curveAt(shape, Math.min(x, 1 - 1e-9)); if (i === 0) g.moveTo(px(x), py(y)); else g.lineTo(px(x), py(y)); }
        g.stroke(); g.globalAlpha = 1;
      }
      // Points.
      shape.points.forEach((p, i) => {
        g.beginPath(); g.arc(px(p.x), py(p.y), i === hover ? 6.5 : 5, 0, 2 * Math.PI);
        g.fillStyle = text; g.fill(); g.lineWidth = 1.5; g.strokeStyle = accent; g.stroke();
      });
      // The playhead.
      const ph = playhead(shape);
      if (ph != null) { g.fillStyle = text; g.globalAlpha = 0.8; g.fillRect(Math.round(px(ph)), M.t, 1.5, H - M.t - M.b); g.globalAlpha = 1; }
    }
    new ResizeObserver(draw).observe(cv);
    // While the player plays, the playhead moves.
    (function loop() { if (box.isConnected && box.offsetParent) draw(); requestAnimationFrame(loop); })();

    // ---------- Editing ----------
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { X: e.clientX - r.left, Y: e.clientY - r.top }; };
    const pointAt = (X, Y) => { let best = -1, bd = 9; shape.points.forEach((p, i) => { const d = Math.hypot(px(p.x) - X, py(p.y) - Y); if (d < bd) { bd = d; best = i; } }); return best; };
    const segAt = (X, Y) => {
      const x = ux(X);
      for (let i = 0; i < shape.points.length - 1; i++) {
        const a = shape.points[i], b = shape.points[i + 1];
        if (b.x - a.x < 1e-9 || x < a.x || x > b.x) continue;
        if (Math.abs(py(P().curveAt(shape, Math.min(x, 1 - 1e-9))) - Y) < 8) return i;
      }
      return -1;
    };
    const snap = (x, free) => (free ? x : Math.round(x * 32) / 32);
    let drag = null;
    cv.addEventListener('pointermove', (e) => {
      const { X, Y } = pos(e);
      if (!drag) {
        const h = pointAt(X, Y), s = h < 0 ? segAt(X, Y) : -1;
        if (h !== hover || s !== hoverSeg) { hover = h; hoverSeg = s; cv.style.cursor = h >= 0 ? 'grab' : s >= 0 ? 'ns-resize' : 'crosshair'; draw(); }
        return;
      }
      if (drag.kind === 'point') {
        const i = drag.i, pts = shape.points, last = pts.length - 1;
        const y = Math.max(0, Math.min(1, e.altKey ? uy(Y) : Math.round(uy(Y) * 64) / 64));
        pts[i].y = y;
        // The ends keep their place across; the rest stay between their neighbours.
        if (pts[i].x > 0 && pts[i].x < 1) pts[i].x = Math.max(pts[i - 1].x, Math.min(pts[i + 1] ? pts[i + 1].x : 1, snap(ux(X), e.altKey)));
        if (i === 0 || i === last) { /* only up and down */ }
      } else if (drag.kind === 'bend') {
        shape.curves[drag.i] = Math.max(-1, Math.min(1, drag.c0 + (Y - drag.Y0) / 90 * (shape.points[drag.i + 1].y >= shape.points[drag.i].y ? 1 : -1)));
      }
      draw(); onChange(shape);
    });
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const { X, Y } = pos(e), i = pointAt(X, Y);
      if (i >= 0) { undo.push(clone(shape)); redo = []; drag = { kind: 'point', i }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; return; }
      const s = segAt(X, Y);
      if (s >= 0 && !shape.steps) { undo.push(clone(shape)); redo = []; drag = { kind: 'bend', i: s, c0: shape.curves[s] || 0, Y0: Y }; cv.setPointerCapture(e.pointerId); }
    });
    cv.addEventListener('pointerup', () => { if (drag) { drag = null; delete shape.preset; changed(); } });
    cv.addEventListener('dblclick', (e) => {
      const { X, Y } = pos(e), i = pointAt(X, Y), pts = shape.points;
      if (i >= 0) {
        if (e.ctrlKey || e.metaKey) commit(() => { pts.splice(i + 1, 0, { ...pts[i] }); shape.curves.splice(i, 0, 0); });
        else if (i > 0 && i < pts.length - 1) commit(() => { pts.splice(i, 1); shape.curves.splice(Math.max(0, i - 1), 1); });
        return;
      }
      const x = snap(Math.max(0, Math.min(1, ux(X))), e.altKey), y = Math.max(0, Math.min(1, e.altKey ? uy(Y) : Math.round(uy(Y) * 64) / 64));
      if (x <= 0 || x >= 1) return;
      commit(() => {
        let k = pts.findIndex((p) => p.x > x);
        if (k < 0) k = pts.length - 1;
        pts.splice(k, 0, { x, y });
        shape.curves.splice(k - 1, 1, 0, 0);
      });
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { X, Y } = pos(e), i = pointAt(X, Y);
      if (i > 0 && i < shape.points.length - 1) commit(() => { shape.points.splice(i, 1); shape.curves.splice(Math.max(0, i - 1), 1); });
    });
    cv.addEventListener('pointerleave', () => { if (!drag && (hover >= 0 || hoverSeg >= 0)) { hover = -1; hoverSeg = -1; draw(); } });

    changed();
    return { get: () => clone(shape), set(s) { shape = clone(s); changed(); }, draw };
  };
})();
