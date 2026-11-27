// The graphic EQ (mastering.js's bands): its response curve with a point per band, drawn on a canvas,
// optionally over a live spectrum. Drag a point (left / right: frequency, up / down: gain), scroll for
// the width (Q), double-click to turn a band on or off. Used by Audio Tools · Mastering and by the
// player's Effects.
//   const ed = NabbitEqEditor(canvas, { bands: () => [...], on: () => true, sampleRate: () => 48000,
//     spectrum: () => dBs | null, changed: () => {}, readout: element, height: 190 });
//   ed.draw(); ed.dirty(); ed.isDirty(); ed.select(-1); ed.read();
window.NabbitEqEditor = function NabbitEqEditor(cv, o) {
  const M = window.Mastering;
  const g2 = cv.getContext('2d');
  const H = o.height || 190;
  const FMIN = 20, FMAX = 20000, GMAX = 18;
  let dirtyFlag = true, selBand = -1, drag = null;
  const BAND_NAMES = { hp: 'Low cut', ls: 'Low shelf', bell: 'Bell', hs: 'High shelf', lp: 'High cut' };
  const HELP = 'Drag a point: left / right for the frequency, up / down for the gain. Scroll for the width (Q). Double-click turns a band on or off.';
  const xOf = (f, w) => (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * w;
  const fOf = (x, w) => FMIN * (FMAX / FMIN) ** Math.min(1, Math.max(0, x / w));
  const yOf = (db, h) => h / 2 - (db / GMAX) * (h / 2 - 10);
  const dbOf = (y, h) => ((h / 2 - y) / (h / 2 - 10)) * GMAX;
  const pointX = (b, w) => Math.min(w - 8, Math.max(8, xOf(b.freq, w))); // the end points stay on the canvas
  const pointY = (b, h) => (b.type === 'hp' || b.type === 'lp' ? h / 2 : yOf(b.gain, h));
  const fmtF = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`);
  // Theme colours, read at most twice a second (reading styles every frame is slow).
  const cssCache = new Map();
  let cssAt = 0;
  function css(name) {
    const now = performance.now();
    if (now - cssAt > 500) { cssCache.clear(); cssAt = now; }
    if (!cssCache.has(name)) cssCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888');
    return cssCache.get(name);
  }
  function sizeCanvas() {
    const w = cv.clientWidth;
    if (!w) return false;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  let curve = null, curveKey = '';
  function draw() {
    if (!sizeCanvas()) return;
    dirtyFlag = false;
    const w = cv.clientWidth, h = H;
    const sr = o.sampleRate ? o.sampleRate() : 48000;
    const line = css('--line'), muted = css('--muted'), text = css('--text'), red = css('--red');
    g2.clearRect(0, 0, w, h);
    g2.font = '9px ' + (css('--mono') || 'monospace');
    g2.lineWidth = 1;
    // Grid
    g2.strokeStyle = line; g2.fillStyle = muted;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(xOf(f, w)) + 0.5;
      g2.globalAlpha = 0.5; g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, h); g2.stroke(); g2.globalAlpha = 1;
      g2.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, h - 4);
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = Math.round(yOf(db, h)) + 0.5;
      g2.globalAlpha = db === 0 ? 0.9 : 0.4; g2.beginPath(); g2.moveTo(0, y); g2.lineTo(w, y); g2.stroke(); g2.globalAlpha = 1;
      g2.fillText(`${db > 0 ? '+' : ''}${db}`, 3, y - 3);
    }
    // Live spectrum of what's being heard
    const sa = o.spectrum ? o.spectrum() : null;
    if (sa) {
      const cols = sa.length;
      g2.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const db = Math.max(-90, sa[Math.min(cols - 1, Math.floor((x / w) * cols))]);
        const y = h - ((db + 90) / 90) * h;
        if (x === 0) g2.moveTo(x, y); else g2.lineTo(x, y);
      }
      g2.lineTo(w, h); g2.lineTo(0, h); g2.closePath();
      g2.globalAlpha = 0.18; g2.fillStyle = text; g2.fill(); g2.globalAlpha = 1;
    }
    // Response curve (worked out again only when a band or the size changes)
    const bands = o.bands();
    const key = `${w}|${sr}|${JSON.stringify(bands)}`;
    if (curveKey !== key) {
      curveKey = key;
      curve = new Float32Array(w + 1);
      for (let x = 0; x <= w; x += 1) curve[x] = yOf(Math.max(-GMAX - 6, Math.min(GMAX + 6, M.eqResponse(bands, fOf(x, w), sr))), h);
    }
    g2.beginPath();
    for (let x = 0; x <= w; x += 1) { if (x === 0) g2.moveTo(x, curve[x]); else g2.lineTo(x, curve[x]); }
    g2.strokeStyle = !o.on || o.on() ? red : muted; g2.lineWidth = 2; g2.stroke(); g2.lineWidth = 1;
    // Points
    bands.forEach((b, i) => {
      const x = pointX(b, w), y = pointY(b, h);
      g2.beginPath(); g2.arc(x, y, i === selBand ? 8 : 6.5, 0, Math.PI * 2);
      g2.fillStyle = b.on ? (i === selBand ? red : text) : 'transparent';
      g2.strokeStyle = b.on ? (i === selBand ? red : text) : muted;
      g2.fill(); g2.stroke();
      g2.fillStyle = b.on ? css('--panel') : muted;
      g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillText(String(i + 1), x, y + 0.5);
      g2.textAlign = 'left'; g2.textBaseline = 'alphabetic';
    });
  }
  function read() {
    if (!o.readout) return;
    const b = o.bands()[selBand];
    if (!b) { o.readout.textContent = HELP; return; }
    const cut = b.type === 'hp' || b.type === 'lp';
    o.readout.textContent = `${selBand + 1} · ${BAND_NAMES[b.type]} · ${fmtF(b.freq)}${cut ? ' · 24 dB/oct' : ` · ${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)} dB · Q ${b.q.toFixed(2)}`}${b.on ? '' : ' · off'}`;
  }
  const changed = () => { if (o.changed) o.changed(); read(); draw(); };
  const hit = (e) => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 14;
    o.bands().forEach((b, i) => { const d = Math.hypot(pointX(b, r.width) - x, pointY(b, H) - y); if (d < bd) { bd = d; best = i; } });
    return { i: best };
  };
  cv.addEventListener('pointerdown', (e) => {
    const { i } = hit(e);
    selBand = i;
    if (i >= 0) { drag = { id: e.pointerId }; cv.setPointerCapture(e.pointerId); }
    read(); dirtyFlag = true; draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || selBand < 0) { cv.style.cursor = hit(e).i >= 0 ? 'grab' : 'default'; return; }
    const r = cv.getBoundingClientRect();
    const b = o.bands()[selBand];
    b.freq = Math.round(fOf(e.clientX - r.left, r.width));
    if (b.type !== 'hp' && b.type !== 'lp') b.gain = Math.round(Math.max(-GMAX, Math.min(GMAX, dbOf(e.clientY - r.top, H))) * 10) / 10;
    b.on = true;
    changed();
  });
  const endDrag = () => { drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    const { i } = hit(e);
    const k = i >= 0 ? i : selBand;
    const b = o.bands()[k];
    if (!b || b.type === 'hp' || b.type === 'lp') return;
    e.preventDefault();
    selBand = k;
    b.q = Math.round(Math.max(0.1, Math.min(18, b.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) * 100) / 100;
    changed();
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    const { i } = hit(e);
    if (i < 0) return;
    const b = o.bands()[i];
    b.on = !b.on;
    selBand = i;
    changed();
  });
  new ResizeObserver(() => { dirtyFlag = true; draw(); }).observe(cv);
  read();
  return {
    draw,
    read,
    dirty() { dirtyFlag = true; },
    isDirty: () => dirtyFlag,
    select(i) { selBand = i; read(); dirtyFlag = true; },
  };
};
