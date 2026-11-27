// Key, tempo and tuning from audio samples (mono Float32Array), written for Nabbit from the standard
// textbook methods (no third-party code):
//   tempo   spectral-flux onset strength → autocorrelation with a tempo prior around 120 BPM → refined to
//           0.05 BPM by lining a beat grid up with the onsets (which also gives where the first beat is)
//   tuning  spectral peaks' distance from equal temperament → the A the song is tuned to (A=440 ± a few Hz)
//   key     a pitch-class profile (chroma) of the whole song, compared with the published key profiles of
//           Krumhansl–Kessler and Temperley in all 24 keys (Pearson correlation)
// Loads in Node (main.js runs it in a worker thread; tests) and as a plain script (window.Analyzer).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Analyzer = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  // ---------- FFT (radix-2, in place) ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
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
  const hann = (n) => Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  /** Magnitude spectra of frames: calls each(mags, frameIndex). */
  function stft(x, size, hop, each) {
    const w = hann(size);
    const re = new Float64Array(size), im = new Float64Array(size);
    const mags = new Float64Array(size / 2);
    for (let start = 0, f = 0; start + size <= x.length; start += hop, f++) {
      for (let i = 0; i < size; i++) { re[i] = x[start + i] * w[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < size / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
      each(mags, f);
    }
  }

  // ---------- Tempo ----------
  /**
   * → { bpm, confidence (0–1), offset (s, first beat), half, double, envelope: { fps } }
   * Tempos are searched in 50–220 BPM, preferring ones near 120 (as listeners do). Whether a song is
   * "90" or "180" is often a matter of taste (Auto-Key and DJ software differ too): the window offers ÷2 / ×2.
   */
  function tempo(x, sr) {
    const size = 1024, hop = 256, fps = sr / hop;
    const bins = Math.min(size / 2, Math.round((8000 / sr) * size)); // up to 8 kHz
    let prev = null;
    const flux = [];
    stft(x, size, hop, (m) => {
      const cur = new Float64Array(bins);
      let s = 0;
      for (let k = 1; k < bins; k++) {
        cur[k] = Math.log1p(100 * m[k]);
        if (prev) { const d = cur[k] - prev[k]; if (d > 0) s += d; }
      }
      flux.push(s);
      prev = cur;
    });
    const n = flux.length;
    if (n < fps * 4) return null; // under ~4 s: not enough to tell
    // Onset strength: flux minus its local average (½ s), negatives dropped.
    const half = Math.round(fps * 0.25);
    const env = new Float64Array(n);
    let acc = 0;
    const pre = [0];
    for (let i = 0; i < n; i++) pre.push((acc += flux[i]));
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
      env[i] = Math.max(0, flux[i] - (pre[b] - pre[a]) / (b - a));
    }
    // Autocorrelation over the lags of 50–220 BPM, weighted toward 120 BPM (log-normal, 1 octave wide).
    const lagOf = (bpm) => (60 * fps) / bpm;
    const minLag = Math.floor(lagOf(220)), maxLag = Math.ceil(lagOf(50));
    const ac = new Float64Array(maxLag + 2);
    let zero = 0;
    for (let i = 0; i < n; i++) zero += env[i] * env[i];
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
      ac[lag] = s / (n - lag);
    }
    const prior = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    // A lag's score also counts its double (a beat every 2 lags agrees with the tempo).
    const score = (lag) => {
      const l = Math.round(lag);
      const at = (k) => (k < ac.length ? ac[k] : 0);
      return (at(l) + 0.5 * at(2 * l) + 0.25 * at(Math.round(lag / 2))) * prior((60 * fps) / lag);
    };
    let best = minLag, bestS = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const sc = score(lag);
      if (sc > bestS) { bestS = sc; best = lag; }
    }
    // Parabolic peak between lags.
    const y0 = score(best - 1), y1 = score(best), y2 = score(best + 1);
    const shift = y0 - 2 * y1 + y2 ? (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2) : 0;
    let bpm = (60 * fps) / (best + Math.max(-0.5, Math.min(0.5, shift)));
    // Refine: the grid (tempo ± 3 %, any phase) that lands on the most onset strength.
    const grid = (b) => {
      const period = lagOf(b);
      let top = -1, phase = 0;
      for (let p = 0; p < period; p += 0.5) {
        let s = 0, c = 0;
        for (let t = p; t < n - 1; t += period) {
          const i = Math.floor(t), f = t - i;
          s += env[i] * (1 - f) + env[i + 1] * f;
          c++;
        }
        s /= c || 1;
        if (s > top) { top = s; phase = p; }
      }
      return { top, phase };
    };
    let fine = { bpm, ...grid(bpm) };
    for (let b = bpm * 0.97; b <= bpm * 1.03; b += 0.05) {
      const g = grid(b);
      if (g.top > fine.top) fine = { bpm: b, ...g };
    }
    bpm = fine.bpm;
    const phase = fine.phase;
    // Whole numbers when it's that close (most music is recorded to a click).
    const rounded = Math.round(bpm);
    if (Math.abs(bpm - rounded) < 0.25) bpm = rounded; else bpm = Math.round(bpm * 10) / 10;
    // Confidence: how far the peak stands above the autocorrelation's average.
    let mean = 0, cnt = 0;
    for (let lag = minLag; lag <= maxLag; lag++) { mean += ac[lag]; cnt++; }
    mean /= cnt;
    const confidence = Math.max(0, Math.min(1, (ac[best] / (mean || 1) - 1) / 2));
    return { bpm, confidence, offset: (phase % lagOf(bpm)) / fps, half: Math.round((bpm / 2) * 10) / 10, double: Math.round(bpm * 20) / 10, fps, zero };
  }

  // ---------- Tuning + key ----------
  const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // How each key is usually written (fewest accidentals): major / minor tonic → flats or sharps.
  const MAJOR_FLATS = new Set([1, 3, 5, 8, 10]); // Db Eb F Ab Bb (and Gb → F#)
  const MINOR_FLATS = new Set([0, 2, 3, 5, 7, 10]); // Cm Dm Ebm Fm Gm Bbm
  function noteName(pc, mode = 'major') {
    const flats = mode === 'minor' ? MINOR_FLATS.has(pc) : MAJOR_FLATS.has(pc);
    return (flats ? NOTES_FLAT : NOTES_SHARP)[pc];
  }
  // Published key profiles (probe-tone ratings / corpus frequencies), tonic first.
  const PROFILES = {
    krumhansl: { major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] },
    temperley: { major: [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400], minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330] },
  };
  function pearson(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  // Camelot wheel: major keys B, minor keys A; C major = 8B, A minor = 8A, a fifth up = +1.
  function camelot(tonic, mode) {
    const majorOf = mode === 'major' ? tonic : (tonic + 3) % 12;
    const n = ((((majorOf * 7) % 12) + 12) % 12 + 8 - 1) % 12 + 1; // C (0) → 8, G (7) → 9 …
    return `${n}${mode === 'major' ? 'B' : 'A'}`;
  }

  /**
   * → { tonic (0–11), mode, name ("Ab Major"), camelot, confidence (0–1), tuningHz,
   *     relative: { tonic, mode, name }, alternatives: [{ name, camelot, score }], chroma: [12] }
   */
  function key(x, sr) {
    const size = 8192, hop = 4096;
    const binHz = sr / size;
    // 1. Tuning: where strong spectral peaks sit relative to the equal-tempered grid (A = 440).
    let cs = 0, sn = 0;
    const peaks = [];
    stft(x, size, hop, (m, f) => {
      if (f % 2) return; // every other frame is plenty for tuning
      let max = 0;
      for (let k = 1; k < m.length; k++) if (m[k] > max) max = m[k];
      for (let k = Math.ceil(100 / binHz); k < Math.min(m.length - 1, 2000 / binHz); k++) {
        if (m[k] < max * 0.05 || m[k] < m[k - 1] || m[k] < m[k + 1]) continue;
        const a = m[k - 1], b = m[k], c = m[k + 1];
        const p = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
        const freq = (k + p) * binHz;
        const cents = 1200 * Math.log2(freq / 440);
        const ang = (2 * Math.PI * cents) / 100;
        cs += Math.cos(ang) * b; sn += Math.sin(ang) * b;
      }
    });
    const dev = (Math.atan2(sn, cs) / (2 * Math.PI)) * 100; // cents, −50…50
    const tuningHz = Math.round(440 * 2 ** (dev / 1200) * 10) / 10;
    const ref = 440 * 2 ** (dev / 1200);
    // 2. Chroma: each frame's spectral peaks (55 Hz – 5 kHz) folded into 12 pitch classes; frames
    //    normalised so loud passages don't outvote quiet ones; low notes count a little more.
    const chroma = new Float64Array(12);
    stft(x, size, hop, (m) => {
      const c = new Float64Array(12);
      let max = 0;
      for (let k = 1; k < m.length; k++) if (m[k] > max) max = m[k];
      if (max < 1e-4) return;
      for (let k = Math.ceil(55 / binHz); k < Math.min(m.length - 1, 5000 / binHz); k++) {
        if (m[k] < max * 0.02 || m[k] < m[k - 1] || m[k] < m[k + 1]) continue;
        const freq = k * binHz;
        const midi = 12 * Math.log2(freq / ref) + 69;
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        const w = 1 + Math.max(0, (60 - midi) / 24); // bass emphasis
        c[pc] += Math.sqrt(m[k]) * w;
      }
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += c[i];
      if (sum) for (let i = 0; i < 12; i++) chroma[i] += c[i] / sum;
    });
    // 3. The 24 keys: average correlation with both profile sets.
    const scores = [];
    for (const mode of ['major', 'minor']) {
      for (let t = 0; t < 12; t++) {
        const rot = Array.from({ length: 12 }, (_, i) => chroma[(i + t) % 12]);
        const s = (pearson(rot, PROFILES.krumhansl[mode]) + pearson(rot, PROFILES.temperley[mode])) / 2;
        scores.push({ tonic: t, mode, score: s });
      }
    }
    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];
    const label = (k) => `${noteName(k.tonic, k.mode)} ${k.mode === 'major' ? 'Major' : 'Minor'}`;
    const relTonic = top.mode === 'major' ? (top.tonic + 9) % 12 : (top.tonic + 3) % 12;
    const relMode = top.mode === 'major' ? 'minor' : 'major';
    // Confidence: the winner's correlation and its lead over the runner-up (relative keys excepted).
    const runner = scores.find((k) => !(k.mode !== top.mode && k.tonic === relTonic) && k !== top) || scores[1];
    // Confidence: how well the best key fits, and how far ahead of the next one it is.
    const confidence = Math.max(0, Math.min(1, ((top.score - 0.4) / 0.5) * 0.4 + (top.score - scores[1].score) * 3 + (top.score - runner.score) * 0.5));
    const total = chroma.reduce((a, b) => a + b, 0) || 1;
    return {
      tonic: top.tonic, mode: top.mode, name: label(top), camelot: camelot(top.tonic, top.mode), confidence, tuningHz,
      relative: { tonic: relTonic, mode: relMode, name: label({ tonic: relTonic, mode: relMode }), camelot: camelot(relTonic, relMode) },
      alternatives: scores.slice(1, 4).map((k) => ({ tonic: k.tonic, mode: k.mode, name: label(k), camelot: camelot(k.tonic, k.mode), score: Math.round(k.score * 100) / 100 })),
      chroma: Array.from(chroma, (v) => Math.round((v / total) * 1000) / 1000),
    };
  }

  // ---------- Scales (for the piano) ----------
  const SCALES = {
    major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
    harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
    melodicMinor: { name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
    dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
    locrian: { name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
    majorPentatonic: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
    minorPentatonic: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
    blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
    chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  };
  /** Pitch classes in a scale on a tonic. */
  const scaleNotes = (tonic, scale) => (SCALES[scale] || SCALES.major).steps.map((s) => (tonic + s) % 12);

  /** Everything at once (main.js's worker). */
  function analyze(x, sr) {
    return { tempo: tempo(x, sr), key: key(x, sr) };
  }

  return { fft, tempo, key, analyze, camelot, noteName, scaleNotes, SCALES, PROFILES, NOTES_SHARP, NOTES_FLAT };
});
