// Audio Tools · visualizers, after Pulse (Audio-Solutions/pulse-visualizer): a Lissajous with spline
// interpolation, an oscilloscope that follows the pitch, an FFT with mid/side or left/right and a
// frequency / dB / note readout under the mouse, a spectrogram, peak and LUFS meters (momentary,
// short-term, integrated) and analog VU meters, all drawn with phosphor glow and afterglow on a
// CRT-style screen. Written for Nabbit (Pulse is a C++ / OpenGL app; none of its code is used).
//
// Visualizers.create(els, source) → { frame(f), reset(), spectrum }
//   source(): { L, R, size }  the ring buffers the player writes into (sample n is at n % size)
//   frame(f): { end, count, fresh, dt, sr, playing }  end = the sample being heard now
(() => {
  const NOTES_S = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTES_F = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FMIN = 20, FMAX = 20000;
  const lightTheme = window.matchMedia('(prefers-color-scheme: light)');

  function create(els, source) {
    const M = window.Mastering;
    const cssCache = new Map();
    let cssAt = 0;
    const css = (n) => {
      const now = performance.now();
      if (now - cssAt > 500) { cssCache.clear(); cssAt = now; }
      if (!cssCache.has(n)) cssCache.set(n, getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888');
      return cssCache.get(n);
    };
    const dpr = () => window.devicePixelRatio || 1;
    function fit(c, h) {
      const w = c.clientWidth, d = dpr();
      h = h || c.clientHeight;
      if (!w || !h) return null;
      if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
      const g = c.getContext('2d');
      g.setTransform(d, 0, 0, d, 0, 0);
      return { g, w, h };
    }
    const at = (n, size) => ((n % size) + size) % size;
    // Phosphor: fade what's there towards the screen colour (afterglow), then draw with 'lighter' so
    // overlapping traces add up, with a wide dim pass under a thin bright one (glow).
    function fade(g, w, h, amount) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = Math.min(1, amount);
      g.fillStyle = css('--panel');
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }
    function glowStroke(g, color, width) {
      // Light traces add up on the dark screen; on the light theme they just draw over.
      g.globalCompositeOperation = lightTheme.matches ? 'source-over' : 'lighter';
      g.strokeStyle = color;
      g.globalAlpha = 0.12; g.lineWidth = width * 5; g.stroke();
      g.globalAlpha = 0.25; g.lineWidth = width * 2.2; g.stroke();
      g.globalAlpha = 0.9; g.lineWidth = width; g.stroke();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    // ---------- Lissajous ----------
    let corr = 0;
    const lisGuide = (g, s) => {
      const c = s / 2, r = s / 2 - 6, d = r * Math.SQRT1_2;
      g.strokeStyle = css('--line'); g.lineWidth = 1; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(c, c - r); g.lineTo(c, c + r); g.moveTo(c - r, c); g.lineTo(c + r, c);
      g.moveTo(c - d, c - d); g.lineTo(c + d, c + d); g.moveTo(c + d, c - d); g.lineTo(c - d, c + d); g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = css('--muted'); g.font = '9px ' + css('--mono');
      g.fillText('M', c + 3, 10); g.fillText('L', c - d - 8, c - d + 2); g.fillText('R', c + d + 3, c - d + 2); g.fillText('S', s - 10, c - 3);
    };
    function lissajous(f) {
      const v = fit(els.lis, els.lis.clientWidth);
      if (!v) return;
      const { g, w: s } = v;
      fade(g, s, s, f.fresh ? 0.35 * f.dt * 60 : 1);
      lisGuide(g, s);
      if (!f.fresh) return;
      const { L, R, size } = source();
      const n = Math.max(256, Math.min(4096, f.count));
      const c = s / 2, k = (s / 2 - 8) * 0.9;
      const px = (l, r) => c + (r - l) * Math.SQRT1_2 * k, py = (l, r) => c - (l + r) * Math.SQRT1_2 * k;
      g.beginPath();
      let sl = 0, sr = 0, slr = 0;
      // Catmull-Rom spline through the samples: 4 steps between each pair, so the trace is a smooth line.
      for (let i = 0; i < n - 1; i++) {
        const i0 = at(f.end - n + i - 1, size), i1 = at(f.end - n + i, size), i2 = at(f.end - n + i + 1, size), i3 = at(f.end - n + i + 2, size);
        const l1 = L[i1], r1 = R[i1];
        sl += l1 * l1; sr += r1 * r1; slr += l1 * r1;
        const x0 = px(L[i0], R[i0]), y0 = py(L[i0], R[i0]), x1 = px(l1, r1), y1 = py(l1, r1);
        const x2 = px(L[i2], R[i2]), y2 = py(L[i2], R[i2]), x3 = px(L[i3], R[i3]), y3 = py(L[i3], R[i3]);
        if (i === 0) g.moveTo(x1, y1);
        for (let t = 0.25; t <= 1.001; t += 0.25) {
          const t2 = t * t, t3 = t2 * t;
          const x = 0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
          const y = 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
          g.lineTo(x, y);
        }
      }
      glowStroke(g, css('--text'), 0.8);
      const cNow = sl > 1e-9 && sr > 1e-9 ? slr / Math.sqrt(sl * sr) : 0;
      corr += (cNow - corr) * Math.min(1, f.dt * 8);
      els.corr.textContent = `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`;
      els.corrBar.style.left = `${50 + Math.min(0, corr) * 50}%`;
      els.corrBar.style.width = `${Math.abs(corr) * 50}%`;
      els.corrBar.classList.toggle('neg', corr < 0);
    }

    // ---------- Oscilloscope (pitch following) ----------
    const OSC_N = 4096;
    const mono = new Float32Array(OSC_N);
    let period = 0, pitchHz = 0;
    // The period by autocorrelation over 40 Hz – 1 kHz (on every 2nd sample), with parabolic refinement.
    function findPeriod(sr) {
      const minLag = Math.floor(sr / 1000 / 2), maxLag = Math.min(OSC_N / 4, Math.ceil(sr / 40 / 2));
      const n = OSC_N / 2 - maxLag;
      let e0 = 0;
      for (let i = 0; i < n; i++) e0 += mono[i * 2] * mono[i * 2];
      if (e0 < 1e-6) return 0;
      const r = new Float32Array(maxLag + 2);
      for (let lag = minLag; lag <= maxLag + 1; lag++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += mono[i * 2] * mono[(i + lag) * 2];
        r[lag] = s / e0;
      }
      // First strong peak after the correlation has dipped (avoids picking lag ≈ 0).
      let lag = minLag;
      while (lag < maxLag && r[lag] > 0.3) lag++;
      let best = -1, bestV = 0.5;
      for (; lag < maxLag; lag++) if (r[lag] > bestV && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { best = lag; bestV = r[lag]; break; }
      if (best < 0) return 0;
      const a = r[best - 1], b = r[best], c = r[best + 1];
      const off = (a - c) / (2 * (a - 2 * b + c)) || 0;
      return (best + Math.max(-0.5, Math.min(0.5, off))) * 2;
    }
    function oscilloscope(f) {
      const v = fit(els.osc);
      if (!v) return;
      const { g, w, h } = v;
      fade(g, w, h, f.fresh ? 0.45 * f.dt * 60 : 1);
      g.strokeStyle = css('--line'); g.globalAlpha = 0.6; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5);
      for (let i = 1; i < 8; i++) { const x = Math.round((i * w) / 8) + 0.5; g.moveTo(x, h / 2 - 3); g.lineTo(x, h / 2 + 3); }
      g.stroke(); g.globalAlpha = 1;
      if (!f.fresh) return;
      const { L, R, size } = source();
      for (let i = 0; i < OSC_N; i++) { const j = at(f.end - OSC_N + i, size); mono[i] = (L[j] + R[j]) * 0.5; }
      const p = findPeriod(f.sr);
      if (p) { period = period && Math.abs(p - period) / period < 0.1 ? period * 0.7 + p * 0.3 : p; pitchHz = f.sr / period; }
      else { period = 0; pitchHz = 0; }
      // Show up to 4 cycles (cycle limit) ending on a rising zero crossing, so the wave stands still;
      // with no clear pitch, the last 20 ms.
      const span = period ? Math.min(OSC_N - 2, Math.max(period * 2, Math.min(period * 4, f.sr * 0.03))) : Math.min(OSC_N - 2, f.sr * 0.02);
      let endI = OSC_N - 1;
      if (period) {
        // The rising zero crossing nearest a whole number of periods back keeps the phase steady.
        for (let i = OSC_N - 2; i > OSC_N - 2 - period * 1.5 && i > span; i--) if (mono[i] <= 0 && mono[i + 1] > 0) { endI = i; break; }
      }
      const startI = endI - span;
      let peak = 0.05;
      for (let i = Math.floor(startI); i <= endI; i++) peak = Math.max(peak, Math.abs(mono[i]));
      const gain = (h / 2 - 6) / Math.max(peak, 0.25);
      g.beginPath();
      const steps = Math.min(w * 2, span);
      for (let s = 0; s <= steps; s++) {
        const x = startI + (s / steps) * span, i = Math.floor(x), t = x - i;
        const y = mono[i] + (mono[Math.min(OSC_N - 1, i + 1)] - mono[i]) * t;
        const sx = (s / steps) * w, sy = h / 2 - y * gain;
        if (s) g.lineTo(sx, sy); else g.moveTo(sx, sy);
      }
      glowStroke(g, css('--text'), 1);
      if (pitchHz) {
        const midi = 69 + 12 * Math.log2(pitchHz / 440);
        const note = Math.round(midi), cents = Math.round((midi - note) * 100);
        els.pitch.textContent = `${pitchHz.toFixed(1)} Hz · ${NOTES_S[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1} ${cents >= 0 ? '+' : ''}${cents}¢`;
      } else els.pitch.textContent = '—';
    }

    // ---------- FFT (M/S or L/R) + spectrogram ----------
    const SA_N = 8192;
    const fft = M.makeFft(SA_N);
    const win = new Float64Array(SA_N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SA_N));
    const re = new Float64Array(SA_N), im = new Float64Array(SA_N);
    const binA = new Float64Array(SA_N / 2 + 1), binB = new Float64Array(SA_N / 2 + 1);
    let mode = 'ms';
    let colA = null, colB = null, gram = null, gramAcc = 0, hoverX = -1;
    const GRAM_H = 70;
    const xOfF = (fq, w) => (Math.log(fq / FMIN) / Math.log(FMAX / FMIN)) * w;
    const fOfX = (x, w) => FMIN * (FMAX / FMIN) ** (x / w);
    const binDb = (arr, kf) => {
      const k = Math.max(1, Math.min(SA_N / 2 - 1, kf)), k0 = Math.floor(k), t = k - k0;
      const a = 20 * Math.log10(arr[k0] + 1e-9), b = 20 * Math.log10(arr[k0 + 1] + 1e-9);
      return a + (b - a) * t;
    };
    function analyse(f, cols) {
      const { L, R, size } = source();
      for (let j = 0; j < SA_N; j++) { const i = at(f.end - SA_N + j, size); re[j] = L[i] * win[j]; im[j] = R[i] * win[j]; }
      fft(re, im, false);
      const norm = 4 / SA_N;
      for (let k = 1; k <= SA_N / 2; k++) {
        const j = SA_N - k;
        const lr = (re[k] + re[j]) / 2, li = (im[k] - im[j]) / 2, rr = (im[k] + im[j]) / 2, ri = (re[j] - re[k]) / 2;
        if (mode === 'ms') { binA[k] = (Math.hypot(lr + rr, li + ri) / 2) * norm; binB[k] = (Math.hypot(lr - rr, li - ri) / 2) * norm; }
        else { binA[k] = Math.hypot(lr, li) * norm; binB[k] = Math.hypot(rr, ri) * norm; }
      }
      // Slope: +3 dB / octave around 1 kHz, so a mix reads about level across the range (as analysers do).
      const fall = 60 * f.dt;
      for (let x = 0; x < cols; x++) {
        const f0 = FMIN * (FMAX / FMIN) ** (x / cols), f1 = FMIN * (FMAX / FMIN) ** ((x + 1) / cols);
        const kf0 = (f0 / f.sr) * SA_N, kf1 = (f1 / f.sr) * SA_N;
        let a, b;
        if (kf1 - kf0 < 2) { const kc = (kf0 + kf1) / 2; a = binDb(binA, kc); b = binDb(binB, kc); }
        else {
          let ma = 0, mb = 0;
          for (let k = Math.floor(kf0); k < Math.min(SA_N / 2, Math.ceil(kf1)); k++) { if (binA[k] > ma) ma = binA[k]; if (binB[k] > mb) mb = binB[k]; }
          a = 20 * Math.log10(ma + 1e-9); b = 20 * Math.log10(mb + 1e-9);
        }
        const tilt = 3 * Math.log2(Math.sqrt(f0 * f1) / 1000);
        a += tilt; b += tilt;
        colA[x] = a > colA[x] ? a : Math.max(a, colA[x] - fall);
        colB[x] = b > colB[x] ? b : Math.max(b, colB[x] - fall);
      }
    }
    function spectrum(f) {
      const v = fit(els.fft);
      if (!v) return;
      const { g, w, h } = v;
      const sh = h - GRAM_H;
      const cols = Math.max(2, Math.floor(w / 2));
      if (!colA || colA.length !== cols) { colA = new Float64Array(cols).fill(-120); colB = new Float64Array(cols).fill(-120); gram = null; }
      if (f.fresh) analyse(f, cols);
      const text = css('--text'), red = css('--red'), line = css('--line'), muted = css('--muted'), panel = css('--panel');
      g.fillStyle = panel; g.fillRect(0, 0, w, sh);
      const yOf = (db) => 6 + (Math.min(6, Math.max(-84, db)) - 6) / -90 * (sh - 12);
      g.strokeStyle = line; g.lineWidth = 1; g.globalAlpha = 0.5;
      g.beginPath();
      for (const fq of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(xOfF(fq, w)) + 0.5; g.moveTo(x, 0); g.lineTo(x, sh); }
      for (const db of [-12, -36, -60]) { const y = Math.round(yOf(db)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke(); g.globalAlpha = 1;
      g.fillStyle = muted; g.font = '9px ' + css('--mono');
      for (const fq of [100, 1000, 10000]) g.fillText(fq >= 1000 ? `${fq / 1000}k` : String(fq), xOfF(fq, w) + 3, 11);
      for (const db of [-12, -36, -60]) g.fillText(String(db), 3, yOf(db) - 3);
      const cw = w / cols;
      const path = (arr) => { g.beginPath(); for (let x = 0; x < cols; x++) { const px = x * cw + cw / 2, y = yOf(arr[x]); if (x) g.lineTo(px, y); else g.moveTo(0, y); } g.lineTo(w, yOf(arr[cols - 1])); };
      path(colA); g.lineTo(w, sh); g.lineTo(0, sh); g.closePath();
      g.globalAlpha = 0.16; g.fillStyle = text; g.fill(); g.globalAlpha = 1;
      path(colB); glowStroke(g, red, 0.9);
      path(colA); glowStroke(g, text, 1.1);
      // Readout under the mouse: frequency, level, note.
      if (hoverX >= 0 && hoverX <= w) {
        const fq = fOfX(hoverX, w), x = Math.min(cols - 1, Math.max(0, Math.floor(hoverX / cw)));
        const db = colA[x];
        g.strokeStyle = red; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(Math.round(hoverX) + 0.5, 0); g.lineTo(Math.round(hoverX) + 0.5, sh); g.stroke(); g.globalAlpha = 1;
        const midi = 69 + 12 * Math.log2(fq / 440), note = Math.round(midi), cents = Math.round((midi - note) * 100);
        const names = els.flat && els.flat() ? NOTES_F : NOTES_S;
        els.read.textContent = `${fq >= 1000 ? (fq / 1000).toFixed(2) + ' kHz' : Math.round(fq) + ' Hz'} · ${db > -100 ? db.toFixed(1) : '-∞'} dB · ${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1} ${cents >= 0 ? '+' : ''}${cents}¢`;
      }
      // Spectrogram: a row every 20 ms, newest on top; brightness by level, red near the top.
      const d = dpr();
      if (!gram || gram.width !== Math.round(w * d) || gram.height !== Math.round(GRAM_H * d)) {
        gram = document.createElement('canvas');
        gram.width = Math.round(w * d); gram.height = Math.round(GRAM_H * d);
        const g0 = gram.getContext('2d'); g0.fillStyle = panel; g0.fillRect(0, 0, gram.width, gram.height);
      }
      if (f.fresh) gramAcc += f.dt;
      if (gramAcc >= 0.02) {
        const rows = Math.min(4, Math.floor(gramAcc / 0.02));
        gramAcc -= rows * 0.02;
        const gg = gram.getContext('2d');
        const step = Math.max(1, Math.round(rows * d));
        gg.drawImage(gram, 0, 0, gram.width, gram.height - step, 0, step, gram.width, gram.height - step);
        gg.fillStyle = panel; gg.fillRect(0, 0, gram.width, step);
        for (let x = 0; x < cols; x++) {
          const lv = Math.max(0, Math.min(1, (colA[x] + 84) / 78));
          const hot = colA[x] > -6;
          gg.fillStyle = hot ? red : text;
          gg.globalAlpha = hot ? 0.95 : lv * lv * lv * 0.9;
          gg.fillRect(Math.floor(x * cw * d), 0, Math.ceil(cw * d), step);
        }
        gg.globalAlpha = 1;
      }
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(gram, 0, Math.round(sh * d)); g.restore();
      g.strokeStyle = line; g.beginPath(); g.moveTo(0, sh + 0.5); g.lineTo(w, sh + 0.5); g.stroke();
    }
    els.fft.addEventListener('mousemove', (e) => { hoverX = e.clientX - els.fft.getBoundingClientRect().left; if (!playingNow) spectrum(lastFrame); });
    els.fft.addEventListener('mouseleave', () => { hoverX = -1; els.read.textContent = ''; });
    for (const b of els.modes) b.addEventListener('click', () => {
      mode = b.dataset.m;
      for (const x of els.modes) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
      els.keyA.textContent = mode === 'ms' ? 'Mid' : 'Left';
      els.keyB.textContent = mode === 'ms' ? 'Side' : 'Right';
      if (colA) { colA.fill(-120); colB.fill(-120); }
    });

    // ---------- Loudness (BS.1770 K-weighting: LUFS momentary, short-term, integrated) + peak + VU ----------
    let kw = null, kwSr = 0;
    function kWeighting(sr) {
      // Stage 1: high shelf (+4 dB above ~1.7 kHz); stage 2: high-pass (~38 Hz). The standard's filters,
      // worked out for this sample rate.
      let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196;
      const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
      let a0 = 1 + K / Q + K * K;
      const s1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
      K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773;
      a0 = 1 + K / Q + K * K;
      const s2 = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
      return { st: [s1, s2], z: [[0, 0, 0, 0], [0, 0, 0, 0]] }; // z: per channel [s1z1, s1z2, s2z1, s2z2]
    }
    const BLOCK = 0.1; // 100 ms blocks
    let blkAcc = 0, blkN = 0, blkSize = 4800, blocks = [], gatedBlocks = [];
    let peakHold = 0, vuL = 0, vuR = 0;
    const lufs = (ms) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);
    function loudnessFeed(f) {
      if (!f.fresh) return;
      if (!kw || kwSr !== f.sr) { kw = kWeighting(f.sr); kwSr = f.sr; blkSize = Math.round(f.sr * BLOCK); }
      const { L, R, size } = source();
      const [s1, s2] = kw.st;
      const vuA = 1 - Math.exp(-1 / (0.065 * f.sr)); // VU: about 300 ms to 99 %
      for (let n = f.end - f.count; n < f.end; n++) {
        const j = at(n, size);
        let sum = 0;
        for (let c = 0; c < 2; c++) {
          const x = c ? R[j] : L[j], z = kw.z[c];
          let y = s1[0] * x + z[0];
          z[0] = s1[1] * x - s1[3] * y + z[1];
          z[1] = s1[2] * x - s1[4] * y;
          const y2 = s2[0] * y + z[2];
          z[2] = s2[1] * y - s2[3] * y2 + z[3];
          z[3] = s2[2] * y - s2[4] * y2;
          sum += y2 * y2;
        }
        blkAcc += sum; blkN++;
        if (blkN >= blkSize) {
          blocks.push(blkAcc / blkN);
          if (blocks.length > 30) blocks.shift();
          // A 400 ms gating block every 100 ms (75 % overlap) for the integrated loudness.
          if (blocks.length >= 4) gatedBlocks.push((blocks[blocks.length - 1] + blocks[blocks.length - 2] + blocks[blocks.length - 3] + blocks[blocks.length - 4]) / 4);
          if (gatedBlocks.length > 36000) gatedBlocks.shift(); // an hour
          blkAcc = 0; blkN = 0;
        }
        const al = Math.abs(L[j]), ar = Math.abs(R[j]);
        if (al > peakHold) peakHold = al;
        if (ar > peakHold) peakHold = ar;
        vuL += (al - vuL) * vuA; vuR += (ar - vuR) * vuA;
      }
    }
    function integrated() {
      const abs = gatedBlocks.filter((p) => lufs(p) > -70);
      if (!abs.length) return -Infinity;
      const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const g = abs.filter((p) => lufs(p) > rel);
      return g.length ? lufs(g.reduce((a, b) => a + b, 0) / g.length) : -Infinity;
    }
    const meanLast = (n) => (blocks.length >= n ? blocks.slice(-n).reduce((a, b) => a + b, 0) / n : blocks.length ? blocks.reduce((a, b) => a + b, 0) / blocks.length : 0);
    const fmtL = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
    let lastLoudText = 0;
    function loudness(f) {
      loudnessFeed(f);
      const m = lufs(meanLast(4)), s = lufs(meanLast(30));
      const now = performance.now();
      if (now - lastLoudText > 100) {
        lastLoudText = now;
        els.lufsM.textContent = fmtL(m);
        els.lufsS.textContent = fmtL(s);
        els.lufsI.textContent = fmtL(integrated());
        els.peak.textContent = peakHold > 1e-6 ? (20 * Math.log10(peakHold)).toFixed(1) : '—';
        els.peak.classList.toggle('hot', peakHold >= 0.999);
      }
      // Momentary bar: -36 … 0 LUFS
      els.lufsBar.style.width = `${Number.isFinite(m) ? Math.max(0, Math.min(100, ((m + 36) / 36) * 100)) : 0}%`;
      // Analog VU: two needles, -20 … +3 VU, 0 VU = -12 dBFS (sine RMS).
      const v = fit(els.vu);
      if (!v) return;
      const { g, w, h } = v;
      g.fillStyle = css('--panel'); g.fillRect(0, 0, w, h);
      const half = w / 2;
      [vuL, vuR].forEach((lvl, ch) => {
        const cx = half * ch + half / 2, cy = h - 8, r = Math.min(half / 2 - 8, h - 22);
        // 0 VU: a sine at -12 dBFS RMS (a level that suits finished masters), whose rectified average
        // is 0.9003 × its RMS.
        const vu = 20 * Math.log10(lvl / (10 ** (-12 / 20) * 0.9003) + 1e-9);
        const ang = (x) => Math.PI * (1.25 + 0.5 * ((Math.max(-20, Math.min(3, x)) + 20) / 23));
        g.lineWidth = 1;
        for (const mark of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
          const a = ang(mark);
          g.strokeStyle = mark > 0 ? css('--red') : css('--muted');
          g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5)); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
        }
        g.strokeStyle = css('--line'); g.beginPath(); g.arc(cx, cy, r, ang(-20), ang(0)); g.stroke();
        g.strokeStyle = css('--red'); g.beginPath(); g.arc(cx, cy, r, ang(0), ang(3)); g.stroke();
        g.fillStyle = css('--muted'); g.font = '8px ' + css('--mono'); g.textAlign = 'center';
        g.fillText(ch ? 'R' : 'L', cx, cy - 4);
        g.fillText('-20', cx + Math.cos(ang(-20)) * (r + 7), cy + Math.sin(ang(-20)) * (r + 7) + 3);
        g.fillText('0', cx + Math.cos(ang(0)) * (r + 7), cy + Math.sin(ang(0)) * (r + 7) + 3);
        g.textAlign = 'left';
        const a = ang(vu);
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
        glowStroke(g, vu > 0 ? css('--red') : css('--text'), 1.2);
      });
    }

    function reset() {
      blocks = []; gatedBlocks = []; blkAcc = 0; blkN = 0; peakHold = 0; vuL = 0; vuR = 0; kw = null;
      if (colA) { colA.fill(-120); colB.fill(-120); }
      gram = null; corr = 0; period = 0;
      els.lufsM.textContent = els.lufsS.textContent = els.lufsI.textContent = els.peak.textContent = '—';
    }
    els.resetBtn.addEventListener('click', reset);

    let playingNow = false, lastFrame = { end: 0, count: 0, fresh: false, dt: 1 / 60, sr: 48000, playing: false };
    function frame(f) {
      playingNow = f.playing; lastFrame = { ...f, fresh: false };
      lissajous(f);
      oscilloscope(f);
      spectrum(f);
      loudness(f);
    }
    return {
      frame, reset,
      // The mid (or left) level per column, for the EQ's background.
      get spectrum() { return colA; },
    };
  }
  window.Visualizers = { create };
})();
