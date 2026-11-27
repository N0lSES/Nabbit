// Mastering chain: Stereo → Spectral compressor → EQ → Clipper, written for Nabbit (no plugin code is
// used; the stages follow what the FL Studio preset's plugins do, with its settings as the defaults).
//
//   1 Stereo     mid / side: how much mono content passes (Mid), side level (Width), balance (Pan).
//   2 Spectral   a compressor per FFT bin (2048-point window, 16× overlap). Each bin's level is followed
//                with attack / release and pushed down above its threshold; output gain is applied to
//                that compressed signal, which is then mixed with the dry signal.
//   3 EQ         nine bands of biquads: low cut, low shelf, five bells, high shelf, high cut.
//   4 Clipper    input gain into a cubic soft clipper with a 0 dB ceiling.
//
// Loads as a CommonJS module (Node: the export worker, tests) or as window.Mastering (the app's live
// preview). Every stage keeps its latency whether it is on or off, so switching one live never jumps.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mastering = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const dbToGain = (db) => 10 ** (db / 20);
  const gainToDb = (g) => (g > 1e-12 ? 20 * Math.log10(g) : -240);

  // ---------- Settings ----------
  // Spectral: the preset's values exactly (global threshold 0 dB, center 420 Hz, slope and curve 0;
  // downwards -50 dB, 500:1, 6 dB knee, no roll-off; upwards 0 dB, 1:1, 6 dB knee, 75 % roll-off;
  // 150 / 300 ms; window 2048, overlap 16; mix 49.93 %; channel link 80 %). Output gain (shown as Amount) defaults to 10 dB.
  const EQ_BANDS = [
    { type: 'hp', freq: 30, gain: 0, q: 0.71, on: false },
    { type: 'ls', freq: 80, gain: 0, q: 0.71, on: true },
    { type: 'bell', freq: 200, gain: 0, q: 1, on: true },
    { type: 'bell', freq: 500, gain: 0, q: 1, on: true },
    { type: 'bell', freq: 1200, gain: 0, q: 1, on: true },
    { type: 'bell', freq: 3000, gain: 0, q: 1, on: true },
    { type: 'bell', freq: 7000, gain: 0, q: 1, on: true },
    { type: 'hs', freq: 12000, gain: 0, q: 0.71, on: true },
    { type: 'lp', freq: 20000, gain: 0, q: 0.71, on: false },
  ];
  const DEFAULTS = {
    on: { stereo: true, spectral: true, eq: true, clip: true },
    stereo: { mid: 100, width: 100, pan: 0 }, // % · % · -100 (left) … 100 (right)
    spectral: {
      output: 10, mix: 0.49932587, attack: 150, release: 300, window: 2048, overlap: 16, link: 0.8,
      downThreshold: -50, downRatio: 500, downKnee: 6, downRolloff: 0,
      upThreshold: 0, upRatio: 1, upKnee: 6, upRolloff: 0.75,
    },
    eq: { bands: EQ_BANDS, output: 0 },
    clip: { input: 8, ceiling: 0, output: 0 },
  };
  const RANGES = {
    'stereo.mid': [0, 100], 'stereo.width': [0, 200], 'stereo.pan': [-100, 100],
    'spectral.output': [0, 20], 'clip.input': [0, 15], 'eq.gain': [-18, 18], 'eq.freq': [20, 20000], 'eq.q': [0.1, 18],
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

  // Settings from storage or the UI, checked and filled in from the defaults.
  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    const d = clone(DEFAULTS);
    const on = s.on || {};
    for (const k of Object.keys(d.on)) if (typeof on[k] === 'boolean') d.on[k] = on[k];
    const st = s.stereo || {};
    d.stereo.mid = clamp(st.mid, ...RANGES['stereo.mid'], d.stereo.mid);
    d.stereo.width = clamp(st.width, ...RANGES['stereo.width'], d.stereo.width);
    d.stereo.pan = clamp(st.pan, ...RANGES['stereo.pan'], d.stereo.pan);
    d.spectral.output = clamp((s.spectral || {}).output, ...RANGES['spectral.output'], d.spectral.output);
    d.clip.input = clamp((s.clip || {}).input, ...RANGES['clip.input'], d.clip.input);
    const bands = (s.eq && Array.isArray(s.eq.bands)) ? s.eq.bands : [];
    d.eq.bands = d.eq.bands.map((b, i) => {
      const x = bands[i] || {};
      return {
        type: b.type,
        freq: clamp(x.freq, ...RANGES['eq.freq'], b.freq),
        gain: clamp(x.gain, ...RANGES['eq.gain'], b.gain),
        q: clamp(x.q, ...RANGES['eq.q'], b.q),
        on: typeof x.on === 'boolean' ? x.on : b.on,
      };
    });
    return d;
  }

  // ---------- FFT (radix-2, in place) ----------
  function makeFft(n) {
    const levels = Math.log2(n);
    if (levels % 1) throw new Error('FFT size must be a power of two');
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    // inverse: conjugate twiddles, no scaling (the caller scales).
    return function fft(re, im, inverse) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      const sgn = inverse ? 1 : -1;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let k = 0; k < half; k++) {
            const wr = cos[k * step], wi = sgn * sin[k * step];
            const a = start + k, b = a + half;
            const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr; im[a] += xi;
          }
        }
      }
    };
  }

  // ---------- 1 Stereo ----------
  function stereoStage(L, R, n, p) {
    const mid = p.mid / 100, side = p.width / 100;
    const pan = p.pan / 100;
    const gl = Math.min(1, 1 - pan), gr = Math.min(1, 1 + pan);
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5 * mid, s = (L[i] - R[i]) * 0.5 * side;
      L[i] = (m + s) * gl;
      R[i] = (m - s) * gr;
    }
  }

  // Soft-knee gain computer, in dB. Downward: above the threshold the level rises 1/ratio as fast.
  // Upward: below the threshold it is brought up the same way.
  function downGain(x, t, r, w) {
    if (r <= 1) return 0;
    const d = x - t;
    if (2 * d < -w) return 0;
    if (2 * Math.abs(d) <= w) { const k = d + w / 2; return ((1 / r - 1) * k * k) / (2 * w); }
    return (1 / r - 1) * d;
  }
  function upGain(x, t, r, w) {
    if (r <= 1) return 0;
    const d = x - t;
    if (2 * d > w) return 0;
    if (2 * Math.abs(d) <= w) { const k = d - w / 2; return ((1 - 1 / r) * k * k) / (2 * w); }
    return (1 / r - 1) * d;
  }

  // ---------- 2 Spectral compressor ----------
  // Gain staging as in the plugin: the signal is scaled by √(1 / (1.5 · overlap/4 · window)) before the
  // FFT (so with a 2048 window and 16× overlap a full-scale sine reads about +13 dB in its band), the
  // output gain is applied to the compressed signal only, and the dry signal is mixed in after it.
  // Left and right share one complex FFT (left real, right imaginary), which halves the work.
  class Spectral {
    constructor(sr, p = DEFAULTS.spectral) {
      this.sr = sr;
      this.n = p.window;
      this.hop = this.n / p.overlap;
      this.latency = this.n;
      this.fft = makeFft(this.n);
      const n = this.n;
      this.win = new Float64Array(n);
      for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); // periodic Hann
      let s2 = 0;
      for (let i = 0; i < n; i++) s2 += this.win[i] * this.win[i];
      const comp = 1 / ((p.overlap / 4) * 1.5) / n;
      this.inGain = Math.sqrt(comp);
      // Analysis and synthesis windows overlap-add to s2 / hop; the inverse FFT needs 1 / n.
      this.olaScale = 1 / (s2 / this.hop) / n / this.inGain;
      const bins = n / 2 + 1;
      this.bins = bins;
      this.inBuf = [new Float64Array(n), new Float64Array(n)];
      this.ola = [new Float64Array(n), new Float64Array(n)];
      this.outQ = [new Float64Array(this.hop), new Float64Array(this.hop)];
      this.dryQ = [new Float64Array(this.hop), new Float64Array(this.hop)];
      this.env = [new Float64Array(bins), new Float64Array(bins)];
      this.re = new Float64Array(n);
      this.im = new Float64Array(n);
      // Per-channel spectra (bins 0 … n/2) and their levels.
      this.Lr = new Float64Array(bins); this.Li = new Float64Array(bins);
      this.Rr = new Float64Array(bins); this.Ri = new Float64Array(bins);
      this.mag = [new Float64Array(bins), new Float64Array(bins)];
      this.fill = 0; // samples gathered towards the next hop (also the read position in outQ / dryQ)
      // Ratio roll-off across frequency: 0 at 20 Hz … 1 at Nyquist, on a log scale.
      this.binPos = new Float64Array(bins);
      for (let k = 0; k < bins; k++) {
        const f = Math.max(20, (k * sr) / n);
        this.binPos[k] = Math.min(1, Math.max(0, Math.log(f / 20) / Math.log(sr / 2 / 20)));
      }
      this.set(p);
    }
    set(p) {
      this.p = p;
      const framesPerSec = this.sr / this.hop;
      this.att = Math.exp(-1 / ((Math.max(1, p.attack) / 1000) * framesPerSec));
      this.rel = Math.exp(-1 / ((Math.max(1, p.release) / 1000) * framesPerSec));
    }
    reset() {
      for (const a of [...this.inBuf, ...this.ola, ...this.outQ, ...this.dryQ, ...this.env]) a.fill(0);
      this.fill = 0;
    }
    // One hop: analyse the last n samples, compress each bin, add the result to the overlap-add buffer.
    frame(on) {
      const { n, hop, bins, win, p, re, im } = this;
      const [xl, xr] = this.inBuf;
      // The oldest hop of the window, delayed by n: the dry signal.
      this.dryQ[0].set(xl.subarray(0, hop));
      this.dryQ[1].set(xr.subarray(0, hop));
      if (on) {
        const g = this.inGain;
        for (let i = 0; i < n; i++) { const w = win[i] * g; re[i] = xl[i] * w; im[i] = xr[i] * w; }
        this.fft(re, im, false);
        const { Lr, Li, Rr, Ri } = this;
        const [ml, mr] = this.mag;
        for (let k = 0; k < bins; k++) {
          const j = (n - k) % n;
          Lr[k] = (re[k] + re[j]) / 2; Li[k] = (im[k] - im[j]) / 2;
          Rr[k] = (im[k] + im[j]) / 2; Ri[k] = (re[j] - re[k]) / 2;
          ml[k] = Math.hypot(Lr[k], Li[k]); mr[k] = Math.hypot(Rr[k], Ri[k]);
        }
        // Each channel follows a blend of its own level and the channels' average (channel link).
        const link = Math.min(1, Math.max(0, p.link));
        const out = dbToGain(p.output);
        // Below the downward knee (and no upward compression) a band is left alone: skip the dB maths.
        const quiet = dbToGain(p.downThreshold - p.downKnee / 2);
        for (let k = 0; k < bins; k++) {
          const avg = (ml[k] + mr[k]) / 2;
          const pos = this.binPos[k];
          const rd = 1 + (p.downRatio - 1) * (1 - p.downRolloff * pos);
          const ru = 1 + (p.upRatio - 1) * (1 - p.upRolloff * pos);
          for (let c = 0; c < 2; c++) {
            const lvl = (1 - link) * this.mag[c][k] + link * avg;
            const e = this.env[c];
            e[k] = lvl > e[k] ? this.att * e[k] + (1 - this.att) * lvl : this.rel * e[k] + (1 - this.rel) * lvl;
            if (e[k] < quiet && ru <= 1) { if (out !== 1) { if (c === 0) { Lr[k] *= out; Li[k] *= out; } else { Rr[k] *= out; Ri[k] *= out; } } continue; }
            const x = gainToDb(e[k]);
            let gdb = downGain(x, p.downThreshold, rd, p.downKnee);
            // Upward gain only for bins with something in them (not the noise floor), at most +24 dB.
            if (ru > 1 && x > -100) gdb += Math.min(24, upGain(x, p.upThreshold, ru, p.upKnee));
            const lin = (gdb === 0 ? 1 : dbToGain(gdb)) * out;
            if (c === 0) { Lr[k] *= lin; Li[k] *= lin; } else { Rr[k] *= lin; Ri[k] *= lin; }
          }
        }
        // Back to one complex spectrum (left + i·right) for a single inverse FFT.
        for (let k = 0; k < bins; k++) {
          re[k] = Lr[k] - Ri[k]; im[k] = Li[k] + Rr[k];
          if (k > 0 && k < n / 2) { re[n - k] = Lr[k] + Ri[k]; im[n - k] = Rr[k] - Li[k]; }
        }
        this.fft(re, im, true);
        const [ol, or] = this.ola;
        const s = this.olaScale;
        for (let i = 0; i < n; i++) { const w = win[i] * s; ol[i] += re[i] * w; or[i] += im[i] * w; }
      }
      for (let c = 0; c < 2; c++) {
        const ola = this.ola[c];
        this.outQ[c].set(ola.subarray(0, hop));
        ola.copyWithin(0, hop);
        ola.fill(0, n - hop);
        this.inBuf[c].copyWithin(0, hop);
      }
    }
    // In place, any block size. Output is the input delayed by `latency` samples. On: dry · (1 − mix) +
    // compressed · output gain · mix. Off: the dry signal alone.
    process(chans, len, on) {
      const { hop, n, p } = this;
      const wet = Math.min(1, Math.max(0, p.mix)), dry = 1 - wet;
      const [L, R] = chans;
      const [il, ir] = this.inBuf, [dl, dr] = this.dryQ, [wl, wr] = this.outQ;
      for (let i = 0; i < len; i++) {
        const f = this.fill;
        il[n - hop + f] = L[i]; ir[n - hop + f] = R[i];
        L[i] = on ? dl[f] * dry + wl[f] * wet : dl[f];
        R[i] = on ? dr[f] * dry + wr[f] * wet : dr[f];
        if (++this.fill === hop) { this.fill = 0; this.frame(on); }
      }
    }
  }

  // ---------- 3 EQ (RBJ biquads) ----------
  function biquad(b, sr) {
    const f = Math.min(b.freq, sr * 0.45);
    const w = (2 * Math.PI * f) / sr, cw = Math.cos(w), sw = Math.sin(w);
    const A = 10 ** (b.gain / 40);
    const out = [];
    const push = (b0, b1, b2, a0, a1, a2) => out.push([b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]);
    if (b.type === 'hp' || b.type === 'lp') {
      // 24 dB / octave: two Butterworth stages.
      for (const q of [0.5412, 1.3066]) {
        const al = sw / (2 * q);
        if (b.type === 'hp') push((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
        else push((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al);
      }
    } else if (b.type === 'bell') {
      const al = sw / (2 * b.q);
      push(1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
    } else {
      const al = sw / (2 * b.q), sq = 2 * Math.sqrt(A) * al;
      if (b.type === 'ls') push(A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq), (A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq);
      else push(A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq), (A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq);
    }
    return out;
  }
  // A band does something: cuts are on, shelves and bells are on with gain.
  const bandActive = (b) => b.on && (b.type === 'hp' || b.type === 'lp' || Math.abs(b.gain) > 0.01);
  // The EQ's response in dB at frequency f (for drawing the curve).
  function eqResponse(bands, f, sr) {
    let db = 0;
    const w = (2 * Math.PI * f) / sr;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    for (const b of bands) {
      if (!bandActive(b)) continue;
      for (const [b0, b1, b2, a1, a2] of biquad(b, sr)) {
        const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
        const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
        db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
      }
    }
    return db;
  }
  class Eq {
    constructor(sr, channels = 2) { this.sr = sr; this.ch = channels; this.stages = []; this.key = ''; }
    set(p) {
      const key = JSON.stringify(p.bands);
      if (key === this.key) return;
      this.key = key;
      const old = this.stages;
      this.stages = [];
      p.bands.forEach((b, i) => {
        if (!bandActive(b)) return;
        biquad(b, this.sr).forEach((c, j) => {
          // Keep a stage's memory when only its settings change, so dragging a band doesn't click.
          const prev = old.find((s) => s.id === `${i}.${j}`);
          this.stages.push({ id: `${i}.${j}`, c, z: prev ? prev.z : Array.from({ length: this.ch }, () => new Float64Array(2)) });
        });
      });
    }
    reset() { for (const s of this.stages) for (const z of s.z) z.fill(0); }
    process(chans, len) {
      for (const { c: [b0, b1, b2, a1, a2], z } of this.stages) {
        for (let ch = 0; ch < this.ch; ch++) {
          const x = chans[ch], s = z[ch];
          let z1 = s[0], z2 = s[1];
          for (let i = 0; i < len; i++) {
            const v = x[i];
            const y = b0 * v + z1;
            z1 = b1 * v - a1 * y + z2;
            z2 = b2 * v - a2 * y;
            x[i] = y;
          }
          s[0] = Math.abs(z1) < 1e-30 ? 0 : z1; s[1] = Math.abs(z2) < 1e-30 ? 0 : z2;
        }
      }
    }
  }

  // ---------- 4 Clipper ----------
  // Cubic soft clip: unity gain for small signals, bending smoothly until it reaches the ceiling at
  // 1.5 × the ceiling, flat beyond. Returns the biggest reduction in this block, in dB.
  function clipStage(chans, len, p) {
    const gin = dbToGain(p.input), c = dbToGain(p.ceiling), gout = dbToGain(p.output);
    const knee = 1.5 * c, k3 = 4 / (27 * c * c);
    let most = 0;
    for (const x of chans) {
      for (let i = 0; i < len; i++) {
        const v = x[i] * gin;
        const a = Math.abs(v);
        const y = a >= knee ? c : a - k3 * a * a * a;
        if (a > 1e-9) { const r = a / y; if (r > most) most = r; }
        x[i] = (v < 0 ? -y : y) * gout;
      }
    }
    return most > 1 ? gainToDb(most) : 0;
  }

  // ---------- The chain ----------
  class Chain {
    constructor(sr, settings) {
      this.sr = sr;
      this.spectral = new Spectral(sr, DEFAULTS.spectral);
      this.eq = new Eq(sr, 2);
      this.latency = this.spectral.latency;
      this.bypass = false;
      this.meter = { inPeak: 0, outPeak: 0, outL: 0, outR: 0, clipDb: 0, clipL: 0, clipR: 0 };
      this.set(settings);
    }
    set(settings) {
      this.s = normalize(settings);
      this.spectral.set({ ...DEFAULTS.spectral, output: this.s.spectral.output });
      this.eq.set(this.s.eq);
    }
    reset() { this.spectral.reset(); this.eq.reset(); }
    // L and R: Float32Array / Float64Array, processed in place.
    process(L, R, len = L.length) {
      const on = this.bypass ? { stereo: false, spectral: false, eq: false, clip: false } : this.s.on;
      let ip = 0;
      for (let i = 0; i < len; i++) ip = Math.max(ip, Math.abs(L[i]), Math.abs(R[i]));
      if (on.stereo) stereoStage(L, R, len, this.s.stereo);
      this.spectral.process([L, R], len, on.spectral);
      if (on.eq) this.eq.process([L, R], len);
      // Per channel: the clipper's reduction and the output peak (stereo meters).
      const clipL = on.clip ? clipStage([L], len, this.s.clip) : 0;
      const clipR = on.clip ? clipStage([R], len, this.s.clip) : 0;
      let pl = 0, pr = 0;
      for (let i = 0; i < len; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pl) pl = a; if (b > pr) pr = b; }
      this.meter = { inPeak: ip, outPeak: Math.max(pl, pr), outL: pl, outR: pr, clipDb: Math.max(clipL, clipR), clipL, clipR };
    }
  }

  return { DEFAULTS, RANGES, normalize, Chain, Spectral, Eq, eqResponse, biquad, makeFft, dbToGain, gainToDb, clipStage, stereoStage, downGain };
});
