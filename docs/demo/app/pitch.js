// A pitch shifter (phase vocoder) for the player: moves a song's pitch by a ratio without changing its
// tempo. DJ mode uses it with the player's own time-stretch (playbackRate with the pitch kept), so a
// song can be in another key and at another tempo at once. Written for Nabbit.
//
// How: the sound is cut into overlapping frames (2048 samples, a new one every 512) under a Hann window
// and turned into frequencies (FFT). Each peak (a note or partial) is moved with the frequencies around
// it as one block, to where the ratio puts it, and turned a little each frame so it keeps the new
// frequency (its true frequency comes from how its phase moved since the last frame). Moving whole
// peaks keeps each note in one piece. Then back to sound, overlapped. It delays the sound by
// size samples (2048: about 46 ms at 44.1 kHz); at a ratio of 1 the sound comes out unchanged.
// Off, it passes the sound straight through with no delay (switch only while silent).
// UMD: Node (tests) and the player's AudioWorklet (globalThis.NabbitPitch).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NabbitPitch = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // In-place radix-2 FFT (re, im of length n, a power of two); inverse = true for the other direction
  // (not scaled).
  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }

  class Channel {
    constructor(size, hop) {
      this.size = size; this.hop = hop;
      this.inQ = new Float32Array(size);
      this.outQ = new Float32Array(size);
      this.acc = new Float32Array(size * 2);
      this.lastPhase = new Float64Array(size / 2 + 1);
      this.peaks = []; // last frame's peaks: { bin, turn }
      this.vpeaks = []; // chord: each voice's
      this.pos = size - hop;
    }
    reset() {
      this.inQ.fill(0); this.outQ.fill(0); this.acc.fill(0); this.lastPhase.fill(0); this.peaks = []; this.vpeaks = [];
      this.pos = this.size - this.hop;
    }
  }

  class PitchShifter {
    /** channels; size: frame (power of two); overlap: frames per size (4 → hop of size / 4). */
    constructor(channels = 2, { size = 2048, overlap = 4, formant = false } = {}) {
      this.size = size; this.overlap = overlap; this.hop = size / overlap;
      // Formants (the voice's / instrument's resonances) kept where they were, or moved by formantRatio
      // on their own: the spectral envelope (cepstrum, smoothed) put back over the moved sound.
      this.formant = formant; this.formantRatio = 1;
      // Chord: several ratios at once (null: just this.ratio), each a voice of the same sound.
      this.voices = null;
      this.cr = new Float64Array(size); this.ci = new Float64Array(size); this.env = new Float64Array(size / 2 + 1);
      this.lag = size - this.hop; // where output is read in the queue
      this.latency = size; // samples the sound comes out later (while on)
      this.ratio = 1;
      this.on = false;
      this.ch = Array.from({ length: channels }, () => new Channel(size, this.hop));
      this.win = new Float64Array(size);
      for (let i = 0; i < size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      const half = size / 2 + 1;
      this.re = new Float64Array(size); this.im = new Float64Array(size);
      this.mag = new Float64Array(half); this.freq = new Float64Array(half);
      this.sMag = new Float64Array(half); this.sFreq = new Float64Array(half);
      this.expect = (2 * Math.PI * this.hop) / size; // phase a bin's own frequency moves per hop
      // The inverse FFT's size, and Hann² summed over the overlapping frames (1.5 at 4×): back to the input level.
      this.gain = 1 / (size * overlap * 0.375);
    }
    reset() { for (const c of this.ch) c.reset(); }
    /** Turn on or off (only while silent: the delay appears or goes). */
    setOn(on) { if (!!on !== this.on) { this.on = !!on; this.reset(); } }
    /** inputs / outputs: arrays of Float32Array per channel (a missing input channel copies the first). */
    process(inputs, outputs) {
      const n = outputs[0].length;
      for (let c = 0; c < outputs.length; c++) {
        const inp = inputs[c] || inputs[0], out = outputs[c];
        if (!inp) { out.fill(0); continue; }
        if (!this.on) { out.set(inp.subarray(0, n)); continue; }
        const st = this.ch[c] || (this.ch[c] = new Channel(this.size, this.hop));
        for (let i = 0; i < n; i++) {
          const x = inp[i];
          st.inQ[st.pos] = x === x && x > -1e9 && x < 1e9 ? x : 0; // NaN / infinity never gets in
          out[i] = st.outQ[st.pos - this.lag];
          if (++st.pos >= this.size) { st.pos = this.lag; this.frame(st); }
        }
      }
    }
    frame(st) {
      const { size, hop, re, im, win, mag, expect, overlap } = this;
      const half = size / 2, r = this.ratio, yr = this.sMag, yi = this.sFreq;
      for (let i = 0; i < size; i++) { re[i] = st.inQ[i] * win[i]; im[i] = 0; }
      fft(re, im, false);
      let top = 0;
      for (let k = 0; k <= half; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > top) top = mag[k]; }
      // Peaks (above −90 dB of the loudest), and how far each one's phase moved (its true frequency).
      const floor = top * 3e-5, peaks = [];
      for (let k = 1; k < half; k++) {
        const m = mag[k];
        if (m > floor && m > mag[k - 1] && m >= mag[k + 1]) peaks.push(k); // close notes stay apart
      }
      yr.fill(0); yi.fill(0);
      // The spectral envelope (for the formants): log magnitude → cepstrum, only its first ~1.4 ms kept
      // (the resonances, not the harmonics), back to a smooth curve.
      const fr = this.formantRatio || 1, useEnv = this.formant || Math.abs(fr - 1) > 1e-4;
      const env = this.env;
      if (useEnv) {
        const cr = this.cr, ci = this.ci, L = Math.max(8, Math.round(size / 34));
        for (let k = 0; k <= half; k++) { cr[k] = Math.log(mag[k] + top * 1e-6 + 1e-12); ci[k] = 0; }
        for (let k = 1; k < half; k++) { cr[size - k] = cr[k]; ci[size - k] = 0; }
        fft(cr, ci, true);
        for (let i = 0; i < size; i++) { cr[i] /= size; ci[i] = 0; }
        for (let i = L; i <= size - L; i++) cr[i] = 0;
        fft(cr, ci, false);
        for (let k = 0; k <= half; k++) env[k] = Math.exp(cr[k]);
      }
      const envAt = (x) => { if (x <= 0) return env[0]; if (x >= half) return env[half]; const i = Math.floor(x), f = x - i; return env[i] * (1 - f) + env[i + 1] * f; };
      // Each peak's true frequency (from how its phase moved since the last frame), and its block: from
      // halfway to the peak before to halfway to the one after (at the lowest point).
      const info = [];
      for (let n = 0; n < peaks.length; n++) {
        const p = peaks[n];
        let d = Math.atan2(im[p], re[p]) - st.lastPhase[p] - p * expect;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        let lo = n ? peaks[n - 1] : 0, hi = n + 1 < peaks.length ? peaks[n + 1] : half;
        if (n) { let b = lo; for (let k = lo; k <= p; k++) if (mag[k] < mag[b]) b = k; lo = b + 1; }
        if (n + 1 < peaks.length) { let b = p; for (let k = p; k <= hi; k++) if (mag[k] < mag[b]) b = k; hi = b; }
        info.push({ p, f: p + (d * overlap) / (2 * Math.PI), lo, hi });
      }
      const ratios = this.voices && this.voices.length ? this.voices : [r];
      const level = ratios.length > 1 ? 1 / Math.sqrt(ratios.length) : 1;
      if (st.vpeaks.length !== ratios.length) st.vpeaks = ratios.map(() => []);
      for (let v = 0; v < ratios.length; v++) {
        const rv = ratios[v], prev = v === 0 && ratios.length === 1 ? st.peaks : st.vpeaks[v], cur = [];
        let prevAt = 0;
        for (const { p, f, lo, hi } of info) {
          const move = f * (rv - 1); // bins to move by (fractional)
          // Its turn: last frame's (the nearest peak then, within two bins) plus this hop's at the new frequency.
          while (prevAt + 1 < prev.length && Math.abs(prev[prevAt + 1].bin - p) <= Math.abs(prev[prevAt].bin - p)) prevAt++;
          const before = prev.length && Math.abs(prev[prevAt].bin - p) <= 2 ? prev[prevAt].turn : 0;
          let turn = (before + (2 * Math.PI * hop * move) / size) % (2 * Math.PI);
          if (!Number.isFinite(turn)) turn = 0;
          cur.push({ bin: p, turn });
          const shift = Math.round(move), c = Math.cos(turn) * level, s = Math.sin(turn) * level;
          for (let k = lo; k <= hi; k++) {
            const j = k + shift;
            // Never into 0 Hz or the very top: a low note moved down there would come out as a DC offset.
            if (j < 0 || j > half || (shift && (j < 1 || j >= half))) continue;
            // Formants: the envelope where the sound now is → where it was (or moved by fr), at most ×8.
            const g = useEnv ? Math.min(8, envAt(j / fr) / (env[k] || 1e-12)) : 1;
            yr[j] += (re[k] * c - im[k] * s) * g;
            yi[j] += (re[k] * s + im[k] * c) * g;
          }
        }
        if (v === 0 && ratios.length === 1) st.peaks = cur; else st.vpeaks[v] = cur;
      }
      for (let k = 0; k <= half; k++) st.lastPhase[k] = Math.atan2(im[k], re[k]);
      // The whole spectrum back (the other half mirrored), to sound.
      for (let k = 0; k <= half; k++) { re[k] = yr[k]; im[k] = yi[k]; }
      for (let k = 1; k < half; k++) { re[size - k] = yr[k]; im[size - k] = -yi[k]; }
      fft(re, im, true);
      const g = this.gain;
      // Anything gone wrong (it shouldn't): start the channel afresh rather than carry it on.
      for (let i = 0; i < size; i += 64) if (!Number.isFinite(re[i])) { st.reset(); return; }
      for (let i = 0; i < size; i++) st.acc[i] += win[i] * re[i] * g;
      for (let i = 0; i < hop; i++) st.outQ[i] = st.acc[i];
      st.acc.copyWithin(0, hop);
      st.acc.fill(0, size * 2 - hop);
      st.inQ.copyWithin(0, hop);
    }
  }

  // ---------- WSOLA: the other engine, in the time domain ----------
  // Grains of the sound (2048 samples, a new one every 1024, Hann-windowed so they add back to the same
  // level) are read at the pitch ratio (faster for higher), and each is placed where it best continues
  // the one before: within ±512 samples of where it should start, the spot whose sound matches the
  // previous grain's natural continuation most closely (normalised cross-correlation of the left + right
  // mix; every channel uses the same spot, so the stereo image holds). No FFT: transients stay sharp and
  // there's no "phasey" sound, at the cost of some doubling on dense mixes. The idea SoundTouch is
  // built on (WSOLA); this code is Nabbit's own. Delay: 4096 samples (about 93 ms at 44.1 kHz); at a
  // ratio of 1 the sound comes out unchanged. Ratios 0.4 to 2.45 (−15 to +15 semitones).
  class Wsola {
    constructor(channels = 2, { grain = 2048, search = 512, latency = 4096 } = {}) {
      this.G = grain; this.H = grain / 2; this.W = search; this.latency = latency;
      this.R = 16384; this.mask = this.R - 1;
      this.channels = channels;
      this.ratio = 1;
      this.on = false;
      this.win = new Float64Array(grain);
      for (let i = 0; i < grain; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / grain);
      this.reset();
    }
    reset() {
      this.inp = Array.from({ length: this.channels }, () => new Float32Array(this.R));
      this.mono = new Float32Array(this.R);
      this.acc = Array.from({ length: this.channels }, () => new Float64Array(this.R));
      this.n = 0; this.nextT = 0; this.prevS = null; this.prevR = 1;
    }
    setOn(on) { if (!!on !== this.on) { this.on = !!on; this.reset(); } }
    // Linear (for matching) and cubic (for the sound) reads of a ring at a fractional position.
    lin(buf, pos) { const i = Math.floor(pos), f = pos - i, m = this.mask; return buf[i & m] * (1 - f) + buf[(i + 1) & m] * f; }
    cub(buf, pos) {
      const i = Math.floor(pos), f = pos - i, m = this.mask;
      const a = buf[(i - 1) & m], b = buf[i & m], c = buf[(i + 1) & m], d = buf[(i + 2) & m];
      if (f === 0) return b;
      return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
    }
    grain() {
      const { G, H, W, latency } = this, r = Math.max(0.4, Math.min(2.45, this.ratio || 1)), t = this.nextT;
      const nominal = t + (G / 2) * (1 - r) - latency;
      let s = nominal;
      if (this.prevS !== null) {
        // Where the last grain would carry on: matched against candidates over the first half (the overlap).
        const cont = this.prevS + this.prevR * H;
        const q = 4, len = H / q;
        const ref = new Float64Array(len);
        let er = 0;
        for (let i = 0; i < len; i++) { const v = this.lin(this.mono, cont + r * i * q); ref[i] = v; er += v * v; }
        if (er > 1e-12) {
          const score = (d) => {
            let xy = 0, xx = 0;
            for (let i = 0; i < len; i++) { const v = this.lin(this.mono, nominal + d + r * i * q); xy += v * ref[i]; xx += v * v; }
            return xx > 1e-12 ? xy / Math.sqrt(xx * er) : -1;
          };
          // The continuation itself first when it's in range (so a steady sound continues seamlessly),
          // then the rest, coarse and then fine.
          const c0 = Math.round(cont - nominal);
          let best = Math.abs(c0) <= W ? c0 : 0, bs = score(best);
          if (bs < 0.9999) {
            for (let d = -W; d <= W; d += 4) { const v = score(d); if (v > bs + 1e-9) { bs = v; best = d; } }
            const c = best;
            for (let d = c - 3; d <= c + 3; d++) if (d >= -W && d <= W && d !== c) { const v = score(d); if (v > bs + 1e-9) { bs = v; best = d; } }
          }
          s = nominal + best;
        }
      }
      for (let ch = 0; ch < this.channels; ch++) {
        const src = this.inp[ch], acc = this.acc[ch];
        for (let i = 0; i < G; i++) acc[(t + i) & this.mask] += this.win[i] * this.cub(src, s + r * i);
      }
      this.prevS = s; this.prevR = r;
      this.nextT += H;
    }
    process(inputs, outputs) {
      const n = outputs[0].length, C = outputs.length;
      if (!this.on) {
        for (let c = 0; c < C; c++) { const inp = inputs[c] || inputs[0]; if (inp) outputs[c].set(inp.subarray(0, n)); else outputs[c].fill(0); }
        return;
      }
      if (C > this.channels) { this.channels = C; this.reset(); }
      const m = this.mask;
      for (let i = 0; i < n; i++) {
        const at = this.n & m;
        let mono = 0;
        for (let c = 0; c < this.channels; c++) {
          const inp = inputs[c] || inputs[0];
          let x = inp ? inp[i] : 0;
          if (!(x > -1e9 && x < 1e9)) x = 0;
          this.inp[c][at] = x;
          mono += x;
        }
        this.mono[at] = mono;
        if (this.n === this.nextT) this.grain();
        for (let c = 0; c < C; c++) {
          let y = this.acc[c] ? this.acc[c][at] : 0;
          if (!Number.isFinite(y)) { y = 0; this.reset(); }
          outputs[c][i] = y;
          if (this.acc[c]) this.acc[c][at] = 0;
        }
        this.n++;
      }
    }
  }

  // ---------- Pitch of a single voice: YIN on the left + right mix, at half the sample rate ----------
  // → { period (samples, at the full rate, sub-sample), voiced, conf (0 best … 1), cm (its cumulative mean
  // normalised difference, by half-rate lag: for checking other octaves) }.
  function yin(ring, mask, end, { minHz = 60, maxHz = 1000, sr = 44100 } = {}) {
    const W = 512, maxLag = Math.min(400, Math.ceil(sr / 2 / minHz)), minLag = Math.max(2, Math.floor(sr / 2 / maxHz));
    const n = W + maxLag, x = yin.buf && yin.buf.length >= n ? yin.buf : (yin.buf = new Float64Array(n + 64));
    const d = yin.d && yin.d.length > maxLag + 1 ? yin.d : (yin.d = new Float64Array(maxLag + 2));
    const cm = yin.cm && yin.cm.length > maxLag + 1 ? yin.cm : (yin.cm = new Float64Array(maxLag + 2));
    let e = 0;
    for (let i = 0; i < n; i++) { const a = end - 2 * (n - i); const v = 0.5 * (ring[a & mask] + ring[(a + 1) & mask]); x[i] = v; e += v * v; }
    const energy = e / n;
    if (energy < 1e-7) return { period: 0, voiced: false, conf: 1, cm, energy };
    for (let t = 1; t <= maxLag; t++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[i] - x[i + t]; s += q * q; } d[t] = s; }
    let run = 0;
    cm[0] = 1;
    for (let t = 1; t <= maxLag; t++) { run += d[t]; cm[t] = run > 0 ? (d[t] * t) / run : 1; }
    // The first dip under 0.2 (its bottom); else the deepest, if under 0.4 (a weaker voice).
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) {
      if (cm[t] < 0.2) { while (t + 1 <= maxLag && cm[t + 1] < cm[t]) t++; tau = t; break; }
    }
    if (tau < 0) { let b = minLag; for (let t = minLag; t <= maxLag; t++) if (cm[t] < cm[b]) b = t; if (cm[b] < 0.4) tau = b; }
    if (tau < 0) return { period: 0, voiced: false, conf: 1, cm, energy };
    // Between lags: the bottom of a parabola through the three.
    let tf = tau;
    if (tau > 1 && tau < maxLag) { const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1], den = a - 2 * b + c; if (den > 1e-12) tf = tau + (0.5 * (a - c)) / den; }
    return { period: tf * 2, voiced: true, conf: cm[tau], cm, energy, maxLag, minLag };
  }

  // ---------- Mono: a single voice (TD-PSOLA); Chord: several steady notes from it ----------
  // Grains two periods long, centred on the voice's pitch marks (its waveform's peaks, a period apart),
  // laid down again a new period apart: the pitch moves and the grains' content (the formants) doesn't.
  // The pitch is tracked with care: an octave jump is only believed if the old octave no longer fits,
  // short gaps (a consonant, a breath) keep the last pitch for 80 ms, and it's the median of the last
  // three. formantRatio reads each grain faster or slower, moving the formants on their own.
  // targets (Hz): Chord: each a voice of its own, the grains laid down at that note's exact period, so
  // every voice holds a steady note (not a robot: the grains are the voice itself). Unvoiced sound
  // (breath, s, t) carries on unchanged, once. Delay: 4096.
  class Psola {
    constructor(channels = 2, { latency = 4096, sr = 44100 } = {}) {
      this.latency = latency; this.sr = sr; this.R = 32768; this.mask = this.R - 1; this.channels = channels;
      this.ratio = 1; this.formantRatio = 1; this.targets = null; this.on = false;
      this.reset();
    }
    reset() {
      this.inp = Array.from({ length: this.channels }, () => new Float32Array(this.R));
      this.mono = new Float32Array(this.R); this.lp = new Float32Array(this.R);
      this.acc = Array.from({ length: this.channels }, () => new Float64Array(this.R));
      this.n = 0; this.est = []; this.detectAt = 0; this.lastP = 0; this.lastAt = -1e9; this.recent = [];
      this.streams = [{ nextS: this.latency, mark: null }];
    }
    setOn(on) { if (!!on !== this.on) { this.on = !!on; this.reset(); } }
    // One new estimate (at input time t), kept steady.
    track(e, t) {
      let P = 0, voiced = false;
      if (e.voiced) {
        P = e.period;
        if (this.lastP && t - this.lastAt < 0.25 * this.sr) {
          // The same octave as before, if it still fits nearly as well.
          for (const f of [2, 0.5, 3, 1 / 3]) {
            const c = P * f, lag = Math.round(c / 2);
            if (lag < (e.minLag || 2) || lag > (e.maxLag || 400)) continue;
            if (Math.abs(Math.log2(c / this.lastP)) + 0.25 < Math.abs(Math.log2(P / this.lastP)) && e.cm[lag] < Math.max(0.3, e.conf + 0.15)) { P = c; break; }
          }
        }
        this.recent.push(P); if (this.recent.length > 3) this.recent.shift();
        P = [...this.recent].sort((a, b) => a - b)[this.recent.length >> 1];
        this.lastP = P; this.lastAt = t; voiced = true;
      } else if (this.lastP && t - this.lastAt < 0.08 * this.sr && e.energy > 1e-6) { P = this.lastP; voiced = true; } else this.recent = [];
      this.est.push({ t, period: P, voiced });
      if (this.est.length > 24) this.est.shift();
    }
    estAt(t) { let b = null; for (const e of this.est) if (!b || Math.abs(e.t - t) < Math.abs(b.t - t)) b = e; return b || { period: 0, voiced: false }; }
    // The peak of the smoothed signal near t (pitch marks on the smoothed wave don't jitter).
    peakNear(t, w) { let b = Math.round(t), bv = -Infinity; for (let i = Math.round(t - w); i <= Math.round(t + w); i++) { const v = this.lp[i & this.mask]; if (v > bv) { bv = v; b = i; } } return b; }
    grain(vi, ts) {
      const v = this.streams[vi], ta = ts - this.latency, e = this.estAt(ta), m = this.mask;
      const fr = Math.max(0.5, Math.min(2, this.formantRatio || 1));
      const T = this.targets, nv = T ? T.length : 1;
      let P, centre, hop, scale;
      if (e.voiced && e.period >= 30) {
        P = e.period;
        if (v.mark === null || Math.abs(v.mark - ta) > 2 * P) v.mark = this.peakNear(ta, P / 2);
        while (v.mark + P / 2 < ta) v.mark = this.peakNear(v.mark + P, P / 4);
        centre = v.mark;
        hop = T ? this.sr / T[vi] : P / Math.max(0.5, Math.min(2, this.ratio || 1));
        hop = Math.max(P / 3, Math.min(P * 3, hop));
        scale = (Math.min(hop, 2 * P) / P) / Math.sqrt(nv);
      } else {
        v.mark = null;
        if (vi > 0) { v.nextS = ts + 256; return; } // unvoiced sound: once, not once per voice
        P = 256; centre = ta; hop = P; scale = 1;
      }
      const Pi = Math.round(P);
      for (let c = 0; c < this.channels; c++) {
        const src = this.inp[c], acc = this.acc[c];
        for (let i = -Pi; i < Pi; i++) {
          const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / Pi);
          const pos = centre + i * fr, k = Math.floor(pos), f = pos - k;
          acc[(Math.round(ts) + i) & m] += w * scale * (src[k & m] * (1 - f) + src[(k + 1) & m] * f);
        }
      }
      v.nextS = ts + hop;
    }
    process(inputs, outputs) {
      const n = outputs[0].length, C = outputs.length;
      if (!this.on) { for (let c = 0; c < C; c++) { const inp = inputs[c] || inputs[0]; if (inp) outputs[c].set(inp.subarray(0, n)); else outputs[c].fill(0); } return; }
      if (C > this.channels) { this.channels = C; this.reset(); }
      const m = this.mask, T = this.targets && this.targets.length ? this.targets : null;
      if ((T ? T.length : 1) !== this.streams.length) {
        const at = this.streams[0].nextS;
        this.streams = Array.from({ length: T ? T.length : 1 }, (_, i) => this.streams[i] || { nextS: at, mark: null });
      }
      // Nothing to change: the sound as it is (just delayed), so it's exactly the original.
      const bypass = !T && Math.abs((this.ratio || 1) - 1) < 1e-4 && Math.abs((this.formantRatio || 1) - 1) < 1e-4;
      for (let i = 0; i < n; i++) {
        const at = this.n & m;
        let mono = 0;
        for (let c = 0; c < this.channels; c++) { const inp = inputs[c] || inputs[0]; let x = inp ? inp[i] : 0; if (!(x > -1e9 && x < 1e9)) x = 0; this.inp[c][at] = x; mono += x; }
        this.mono[at] = mono;
        let sm = 0; for (let j = 0; j < 8; j++) sm += this.mono[(this.n - j) & m];
        this.lp[at] = sm / 8;
        this.n++;
        if (this.n >= this.detectAt) {
          this.detectAt = this.n + 512;
          this.track(yin(this.mono, m, this.n, { sr: this.sr }), this.n - 912);
        }
        if (bypass) {
          for (const v of this.streams) v.nextS = Math.max(v.nextS, this.n + 1300);
          const o = (this.n - 1 - this.latency) & m;
          for (let c = 0; c < C; c++) { outputs[c][i] = (this.inp[c] || this.inp[0])[o]; const a = this.acc[c]; if (a) a[(this.n - 1) & m] = 0; }
          continue;
        }
        for (let vi = 0; vi < this.streams.length; vi++) while (this.streams[vi].nextS - 1300 <= this.n) this.grain(vi, this.streams[vi].nextS);
        const o = (this.n - 1) & m;
        for (let c = 0; c < C; c++) { const a = this.acc[c] || this.acc[0]; let y = a[o]; if (!Number.isFinite(y)) { y = 0; this.reset(); } outputs[c][i] = y; a[o] = 0; }
      }
    }
  }

  // ---------- Resynth: the sound's tone colour sung by a robot ----------
  // The spectral envelope of the left + right mix (cepstrum), resynthesised as one steady harmonic tone at
  // robotHz × ratio (a C3 by default), with its formants (moved by formantRatio). Level follows the
  // input. Delay: 2048.
  class Resynth {
    constructor(channels = 2, { size = 2048, sr = 44100 } = {}) {
      this.size = size; this.hop = size / 4; this.sr = sr; this.latency = size; this.channels = channels;
      this.ratio = 1; this.formantRatio = 1; this.robotHz = 130.81; this.on = false;
      this.win = new Float64Array(size); for (let i = 0; i < size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      this.re = new Float64Array(size); this.im = new Float64Array(size); this.env = new Float64Array(size / 2 + 1);
      this.reset();
    }
    reset() {
      this.inQ = new Float32Array(this.size); this.pos = 0;
      this.out = new Float32Array(this.size * 2); this.rd = 0; this.wr = this.size - this.hop; // output queue
      this.phase = 0; this.amps = new Float64Array(0); this.gain = 0;
    }
    setOn(on) { if (!!on !== this.on) { this.on = !!on; this.reset(); } }
    frame() {
      const { size, hop, re, im, win, env, sr } = this, half = size / 2;
      let e = 0;
      for (let i = 0; i < size; i++) { const v = this.inQ[i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
      const inRms = Math.sqrt(e / size);
      fft(re, im, false);
      for (let k = 0; k <= half; k++) { re[k] = Math.log(Math.hypot(re[k], im[k]) + 1e-9); im[k] = 0; }
      for (let k = 1; k < half; k++) { re[size - k] = re[k]; im[size - k] = 0; }
      fft(re, im, true);
      const L = Math.round(size / 34);
      for (let i = 0; i < size; i++) { re[i] = i < L || i > size - L ? re[i] / size : 0; im[i] = 0; }
      fft(re, im, false);
      for (let k = 0; k <= half; k++) env[k] = Math.exp(re[k]);
      const f0 = Math.max(30, Math.min(2000, this.robotHz * (this.ratio || 1))), fr = this.formantRatio || 1, H = Math.min(200, Math.floor(16000 / f0));
      const binHz = sr / size, amps = new Float64Array(H + 1);
      let q = 0;
      for (let h = 1; h <= H; h++) { const x = (h * f0) / binHz / fr, i = Math.min(half - 1, Math.floor(x)), f = Math.min(1, x - i); amps[h] = env[i] * (1 - f) + env[i + 1] * f; q += amps[h] * amps[h]; }
      const target = q > 0 ? inRms / Math.sqrt(q / 2) : 0;
      const old = this.amps.length === amps.length ? this.amps : amps, g0 = this.gain;
      // hop samples of the tone, the harmonics' levels sliding from the last frame's to this one's.
      const w = 2 * Math.PI * f0 / sr;
      // Each harmonic at its own starting phase (Schroeder's: π h² / H), so they don't all peak together:
      // the same tone, about a fifth of the peak level of a pulse.
      if (!this.sp || this.sp.length !== H + 1) { this.sp = new Float64Array(H + 1); this.cp = new Float64Array(H + 1); for (let h = 1; h <= H; h++) { const q2 = (Math.PI * h * h) / H; this.sp[h] = Math.sin(q2); this.cp[h] = Math.cos(q2); } }
      const sp = this.sp, cp = this.cp;
      for (let i = 0; i < hop; i++) {
        const a = i / hop, g = g0 + (target - g0) * a;
        this.phase += w; if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
        const c2 = 2 * Math.cos(this.phase);
        let s1 = Math.sin(this.phase), s0 = 0, k1 = Math.cos(this.phase), k0 = 1, y = 0;
        for (let h = 1; h <= H; h++) {
          y += (old[h] + (amps[h] - old[h]) * a) * (s1 * cp[h] + k1 * sp[h]); // sin(hΦ + φh)
          const s2 = c2 * s1 - s0; s0 = s1; s1 = s2;
          const k2 = c2 * k1 - k0; k0 = k1; k1 = k2;
        }
        y *= g;
        // Never louder than full scale: a soft limit above 0.8.
        if (y > 0.8) y = 0.8 + 0.2 * Math.tanh((y - 0.8) / 0.2); else if (y < -0.8) y = -0.8 - 0.2 * Math.tanh((-y - 0.8) / 0.2);
        this.out[(this.wr + i) % this.out.length] = y;
      }
      this.wr = (this.wr + hop) % this.out.length;
      this.amps = amps; this.gain = target;
    }
    process(inputs, outputs) {
      const n = outputs[0].length, C = outputs.length;
      if (!this.on) { for (let c = 0; c < C; c++) { const inp = inputs[c] || inputs[0]; if (inp) outputs[c].set(inp.subarray(0, n)); else outputs[c].fill(0); } return; }
      for (let i = 0; i < n; i++) {
        let mono = 0, k = 0;
        for (let c = 0; c < C; c++) { const inp = inputs[c] || inputs[0]; if (inp) { const x = inp[i]; if (x > -1e9 && x < 1e9) mono += x; k++; } }
        this.inQ[this.pos] = k ? mono / k : 0;
        if (++this.pos >= this.size) { this.frame(); this.inQ.copyWithin(0, this.hop); this.pos = this.size - this.hop; }
        let y = this.out[this.rd]; this.out[this.rd] = 0; this.rd = (this.rd + 1) % this.out.length;
        if (!Number.isFinite(y)) { y = 0; this.reset(); }
        for (let c = 0; c < C; c++) outputs[c][i] = y;
      }
    }
  }

  // ---------- Time shaper (like ShaperBox's TimeShaper) ----------
  // The sound goes through a delay line whose delay follows a curve drawn over a cycle (a 1/16 to 32
  // bars, on the song's beat grid): y = how late, as a fraction of the cycle (0: as it is; 0.5: half a
  // cycle late). It only ever reads what has already played, so it works live with no added delay.
  //  - Smooth: the delay changes continuously, so the playback speed changes with it, like a record or a
  //    tape: pitch and tempo together (a ramp to 0.5 over a bar: that bar at half speed, an octave down).
  //  - Steps: the delay is held for each sixteenth of the cycle: pieces moved, the pitch untouched.
  // A jump in the curve cross-fades over 3 ms, started 5 ms early so it's done on time.
  // shape: { points: [{ x 0–1, y 0–1 }] (x rising; two at one x: a jump), curves: [bend per segment,
  // −1…1], cycle (beats), steps (bool) }; grid: { bpm, offset (first beat, s) }.
  const SHAPES = {
    flat: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], curves: [0], cycle: 4 },
    halftime: { points: [{ x: 0, y: 0 }, { x: 1, y: 0.25 }, { x: 1, y: 0 }], curves: [0, 0], cycle: 4 },
    pitch: { points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 0 }], curves: [0, 0], cycle: 1 },
    // Each beat at ¾ speed: its first three sixteenths spread over the whole beat (triplets).
    tripletize: { points: [{ x: 0, y: 0 }, { x: 0.25, y: 1 / 16 }, { x: 0.25, y: 0 }, { x: 0.5, y: 1 / 16 }, { x: 0.5, y: 0 }, { x: 0.75, y: 1 / 16 }, { x: 0.75, y: 0 }, { x: 1, y: 1 / 16 }, { x: 1, y: 0 }], curves: [0, 0, 0, 0, 0, 0, 0, 0], cycle: 4 },
    stutter: { points: [{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.75, y: 0.75 }, { x: 1, y: 0.75 }], curves: [0, 0, 0, 0, 0, 0, 0], cycle: 1 },
    tapestop: { points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 0 }], curves: [0.5, 0], cycle: 4 },
    reverse: { points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }], curves: [0, 0], cycle: 2 },
  };
  // Bend: 0 a straight line; towards 1 it starts slow and ends fast, towards −1 the other way.
  const bend = (u, c) => (c ? Math.pow(u, Math.pow(4, c)) : u);
  /** The curve's y at phase p (0–1). */
  function curveAt(sh, p) {
    const P = sh.points, C = sh.curves || [];
    if (!P || P.length < 2) return 0;
    if (p <= P[0].x) return P[0].y;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if (b.x - a.x < 1e-9) continue; // a jump
      if (p < b.x || i === P.length - 2) { const u = Math.max(0, Math.min(1, (p - a.x) / (b.x - a.x))); return a.y + (b.y - a.y) * bend(u, C[i] || 0); }
    }
    return P[P.length - 1].y;
  }
  /** Delay (in beats) at song time t (s). g: { bpm, offset } (the grid); from (s): nothing before it, and
   *  the cycles counted from there; once: one cycle only, then −1 (silence: a tape stop that has stopped). */
  function delayAt(t, sh, g) {
    if (!sh || !(g.bpm > 0)) return 0;
    const cyc = sh.cycle > 0 ? sh.cycle : 4, from = g.from != null && Number.isFinite(g.from) ? g.from : null;
    const beats = ((t - (from != null ? from : g.offset || 0)) * g.bpm) / 60;
    if (beats < 0) return 0;
    if (from != null && g.once && beats >= cyc) return -1;
    let p = (beats % cyc) / cyc;
    if (sh.steps) p = Math.floor(p * 16) / 16;
    return Math.max(0, Math.min(1, curveAt(sh, p))) * cyc;
  }
  class TimeShaper {
    constructor(channels = 2, sr = 44100) {
      this.sr = sr; this.channels = channels;
      this.shape = null; this.grid = { bpm: 120, offset: 0 };
      this.clock = { song: 0, frame: 0, rate: 1 };
      this.X = Math.round(0.003 * sr); this.A = Math.round(0.005 * sr);
      this.R = 1 << 19; this.reset();
    }
    // The ring big enough for the longest delay the shape can ask for (up to about 90 s).
    fit() {
      const sh = this.shape, g = this.grid;
      if (!sh || !(g.bpm > 0)) return;
      const need = Math.ceil(((sh.cycle * 60) / g.bpm) * this.sr * 1.1) + 4 * this.sr;
      let R = 1 << 19;
      while (R < need && R < (1 << 22)) R <<= 1;
      if (R > this.R) { this.R = R; this.reset(); }
    }
    setShape(sh) { this.shape = sh && sh.points && sh.points.length >= 2 ? sh : null; this.fit(); }
    reset() {
      this.mask = this.R - 1;
      this.ring = Array.from({ length: this.channels }, () => new Float32Array(this.R));
      this.n = 0; this.d = 0; this.prevD = 0; this.fade = 0; this.gate = 1;
    }
    setClock(song, frame, rate = 1) { this.clock = { song: Number(song) || 0, frame: Number(frame) || 0, rate: rate > 0 ? rate : 1 }; }
    read(r, pos) { // cubic, at a fractional delay
      const m = this.mask, i = Math.floor(pos), f = pos - i;
      const a = r[(i - 1) & m], b = r[i & m], c = r[(i + 1) & m], d = r[(i + 2) & m];
      return f === 0 ? b : b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
    }
    process(inputs, outputs, frame0 = 0) {
      const N = outputs[0].length, C = outputs.length, m = this.mask, g = this.grid, ck = this.clock, sr = this.sr, X = this.X;
      if (C > this.channels) { this.channels = C; this.reset(); }
      const secPerBeat = 60 / (g.bpm || 120);
      for (let i = 0; i < N; i++) {
        const at = this.n & this.mask;
        for (let c = 0; c < this.channels; c++) { const inp = inputs[c] || inputs[0]; const x = inp ? inp[i] : 0; this.ring[c][at] = x > -1e9 && x < 1e9 ? x : 0; }
        this.n++;
        let want = 0, gate = 1;
        if (this.shape) {
          const t = ck.song + ((frame0 + i - ck.frame + this.A) / sr) * ck.rate;
          const dl = delayAt(t, this.shape, g);
          if (dl < 0) { gate = 0; want = this.d; } else want = ((dl * secPerBeat) / ck.rate) * sr;
          if (want > this.n - 3) want = Math.max(0, this.n - 3); // not that much heard yet
        }
        this.gate += (gate - this.gate) * 0.004;
        // A jump (more than a few samples at once): cross-faded from where it was.
        if (Math.abs(want - this.d) > 8) { this.prevD = this.d; this.fade = X; }
        this.d = want;
        const a = this.fade > 0 ? this.fade / X : 0;
        if (this.fade > 0) this.fade--;
        const pos = this.n - 1 - this.d, pos0 = this.n - 1 - this.prevD;
        for (let c = 0; c < C; c++) {
          const r = this.ring[c] || this.ring[0];
          let y = this.d === 0 && a === 0 ? r[(this.n - 1) & this.mask] : this.read(r, pos);
          if (a > 0) y = y * (1 - a) + this.read(r, pos0) * a;
          outputs[c][i] = y * this.gate;
        }
      }
    }
  }

  // Slice stretch / slice map, live (FL Studio's two): plays the song itself (decoded, interleaved
  // stereo pcm at the context's rate) cut at `cuts` (sample positions), following the player's clock
  // (the player plays at the new tempo, pitch kept; only its clock is used here). Each slice starts when
  // the player reaches it, from its own start:
  //  - map: the slice just played as recorded (gaps when slower, its tail cut when faster);
  //  - stretch: its hit (first 25 ms) as recorded, the rest time-stretched (WSOLA grains) to end just as
  //    the next slice starts.
  // Slices cross-fade over 3 ms; a seek (the clock jumping) too.
  class Slicer {
    constructor(sr = 44100) {
      this.sr = sr; this.pcm = null; this.n = 0; this.cuts = [0]; this.mode = 'map';
      this.clock = { song: 0, frame: 0, rate: 1, playing: true };
      this.X = Math.round(0.003 * sr); this.keep = Math.round(0.025 * sr);
      this.G = 2 * Math.round(0.02 * sr); this.H = this.G / 2; this.T = Math.round(0.008 * sr);
      this.win = new Float32Array(this.G); for (let i = 0; i < this.G; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.G);
      this.P = -1; this.cur = null; this.old = []; this.gain = 0; this.k = 0;
    }
    setPcm(pcm) { this.pcm = pcm && pcm.length >= 2 ? pcm : null; this.n = this.pcm ? this.pcm.length >> 1 : 0; this.P = -1; this.cur = null; this.old = []; }
    setSlices(cuts, mode) {
      const c = (Array.isArray(cuts) || ArrayBuffer.isView(cuts) ? Array.from(cuts) : []).map(Math.round).filter((x) => x > 0 && (!this.n || x < this.n)).sort((a, b) => a - b);
      this.cuts = [0, ...c.filter((x, i) => i === 0 || x !== c[i - 1])];
      this.mode = mode === 'stretch' ? 'stretch' : 'map';
      this.P = -1; // found again from the clock (cross-faded)
    }
    setClock(song, frame, rate = 1, playing = true) { this.clock = { song: Number(song) || 0, frame: Number(frame) || 0, rate: rate > 0 ? rate : 1, playing: playing !== false }; }
    sliceAt(P) { // the slice holding source sample P (from the last one found)
      const c = this.cuts;
      let k = Math.min(this.k, c.length - 1);
      while (k + 1 < c.length && c[k + 1] <= P) k++;
      while (k > 0 && c[k] > P) k--;
      this.k = k;
      return k;
    }
    at(i, ch) { const x = i >= 0 && i < this.n ? this.pcm[2 * i + ch] : 0; return x > -4 && x < 4 ? x : 0; }
    // A slice's voice from e output samples into it (state kept for its grains).
    voice(k, e, P, rate) {
      const from = this.cuts[k], to = k + 1 < this.cuts.length ? this.cuts[k + 1] : this.n, L = to - from;
      const v = { k, from, to, L, e, grains: null, fin: 0 };
      if (this.mode === 'stretch' && Math.abs(rate - 1) > 1e-3 && L / rate > this.keep + this.H) {
        // Its first grain carries on straight from the hit (so there's no dip where the grains begin).
        v.grains = [{ start: this.keep - this.H, src: from + this.keep - this.H }];
        v.rate = rate;
      }
      return v;
    }
    // The source position the stretched rest should be at, this far (P) through the slice.
    stretchedSrc(v, P) {
      const ua = Math.min(0.999, (this.keep * v.rate) / v.L), u = Math.max(ua, Math.min(1, (P - v.from) / v.L));
      return v.from + this.keep + ((u - ua) / (1 - ua)) * (v.L - this.keep);
    }
    // The grain's start nearest `want` that follows on best from where the last grain was going (WSOLA).
    align(want, next) {
      const T = this.T, M = this.H >> 1;
      let best = want, bestS = -Infinity;
      for (let d = -T; d <= T; d += 4) {
        const c = want + d;
        let s = 0;
        for (let i = 0; i < M; i += 4) s += (this.at(c + i, 0) + this.at(c + i, 1)) * (this.at(next + i, 0) + this.at(next + i, 1));
        if (s > bestS) { bestS = s; best = c; }
      }
      return best;
    }
    sample(v, ch) {
      const e = v.e;
      if (!v.grains || e < this.keep) {
        const y = this.at(v.from + e, ch);
        if (this.mode === 'map' && e >= v.L) return e - v.L < this.X ? y * (1 - (e - v.L) / this.X) : 0; // slower: silence after it
        return y;
      }
      let y = 0;
      for (const g of v.grains) { const j = e - g.start; if (j >= 0 && j < this.G) y += this.at(g.src + j, ch) * this.win[j]; }
      return y;
    }
    // The voice playing now fades out (over what's left of its fade-in, so a quick second change is smooth).
    retire() {
      if (this.cur) { this.cur.out = Math.min(this.X, Math.max(1, this.cur.fin)); this.old.push(this.cur); if (this.old.length > 4) this.old.shift(); }
      this.cur = null;
    }
    step(v, P) { // one output sample on
      v.e++;
      if (v.grains && v.e >= this.keep) {
        const last = v.grains[v.grains.length - 1];
        if (v.e - last.start >= this.H) {
          const want = Math.round(this.stretchedSrc(v, P));
          v.grains.push({ start: v.e, src: this.align(want, last.src + this.H) });
          if (v.grains.length > 2) v.grains.shift();
        }
      }
    }
    process(inputs, outputs, frame0 = 0) {
      const N = outputs[0].length, C = outputs.length, ck = this.clock, sr = this.sr, X = this.X;
      if (!this.pcm) { for (const o of outputs) o.fill(0); return; }
      for (let i = 0; i < N; i++) {
        // Where the player is (source samples), followed smoothly; a jump (a seek) is taken at once.
        // Paused: faded out, then nothing moves until it plays again.
        if (!ck.playing && this.gain < 1e-4) { this.gain = 0; for (let c = 0; c < C; c++) outputs[c][i] = 0; continue; }
        const r = ck.playing ? ck.rate : 0;
        const want = (ck.song + ((frame0 + i - ck.frame) / sr) * r) * sr;
        if (this.P < 0 || Math.abs(want - this.P) > 0.05 * sr) {
          this.retire();
          this.P = want;
        } else this.P += r + (want - this.P) * 0.002;
        const P = this.P, k = this.sliceAt(Math.max(0, P));
        if (!this.cur || this.cur.k !== k) {
          this.retire();
          this.cur = this.voice(k, Math.max(0, Math.round((P - this.cuts[k]) / ck.rate)), P, ck.rate);
        }
        // Playing or not (paused: faded out).
        const to = ck.playing && P < this.n ? 1 : 0;
        this.gain += (to - this.gain) * 0.01;
        const fin = Math.min(1, this.cur.fin / X);
        for (let c = 0; c < C; c++) {
          let y = this.sample(this.cur, c % 2) * fin;
          for (const o of this.old) y += this.sample(o, c % 2) * (o.out / X);
          outputs[c][i] = y * this.gain;
        }
        this.step(this.cur, P); this.cur.fin++;
        for (const o of this.old) { this.step(o, P); o.out--; }
        if (this.old.length && this.old[0].out <= 0) this.old = this.old.filter((o) => o.out > 0);
      }
    }
  }

  // The engines (the pitch node switches between them), with their delays in samples.
  const ALGOS = {
    pv: { name: 'Phase vocoder', latency: 2048 },
    wsola: { name: 'WSOLA', latency: 4096 },
    pro: { name: 'Pro', latency: 4096 },
    mono: { name: 'Mono', latency: 4096 },
    resynth: { name: 'Resynth', latency: 2048 },
    chord: { name: 'Chord', latency: 4096 },
  };
  function makeEngine(algo, channels = 2, sr = 44100) {
    if (algo === 'wsola') return new Wsola(channels);
    if (algo === 'pro') return new PitchShifter(channels, { size: 4096, overlap: 4, formant: true });
    if (algo === 'mono') return new Psola(channels, { sr });
    if (algo === 'resynth') return new Resynth(channels, { sr });
    if (algo === 'chord') return new Psola(channels, { sr });
    return new PitchShifter(channels);
  }
  return { PitchShifter, Wsola, Psola, Resynth, TimeShaper, Slicer, SHAPES, curveAt, delayAt, ALGOS, makeEngine, yin, fft };
});
