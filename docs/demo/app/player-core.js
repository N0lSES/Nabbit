// Player core: the parts of Player mode that are plain logic (no page, no audio device), so they can
// be tested in Node: time formats, the waveform's bars, playlist edits, the plugin delay buffer and
// the gapless hand-over decision. Loads as a CommonJS module (tests), as window.PlayerCore (the page)
// and as globalThis.PlayerCore inside the effects' AudioWorklet.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlayerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Times ----------
  /** 3:07, 1:02:03 */
  function fmtTime(s) {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  }
  /** A long total: days first once it's a day or more ("26 days 6:10:21", "1 day 0:01:05"). */
  function fmtLong(s) {
    s = Math.max(0, Math.round(s || 0));
    const d = Math.floor(s / 86400);
    if (!d) return fmtTime(s);
    const r = s % 86400, h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), x = r % 60;
    return `${d} day${d === 1 ? '' : 's'} ${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  }

  // ---------- Waveform ----------
  /** Loudness values (any scale) → heights 0 … 1: relative to the loudest part, on a curve. */
  function waveShape(values, curve = 1.6) {
    if (!Array.isArray(values) || !values.length) return null;
    const top = Math.max(0.01, ...values);
    return values.map((v) => Math.min(1, Math.max(0, v / top) ** curve));
  }
  /** Shape → n bars (each the highest value in its slice; at least `floor`). */
  function waveBars(shape, n, floor = 0.04) {
    const out = new Array(Math.max(0, n)).fill(floor);
    if (!shape || !shape.length) return out;
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * shape.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * shape.length));
      for (let k = a; k < b && k < shape.length; k++) if (shape[k] > out[i]) out[i] = shape[k];
    }
    return out;
  }

  // ---------- Playlists ----------
  // A playlist: { id, name, items: [path …], created, changed }. Every function returns a new one.
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Playlist';
  function newPlaylist(name, items = [], now = Date.now()) {
    return { id: `pl${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name: cleanName(name), items: dedupe(items), created: now, changed: now };
  }
  function dedupe(items) { return [...new Set((items || []).filter((x) => typeof x === 'string' && x))]; }
  /** Adds songs at the end (ones already in it stay where they are). */
  function addTo(pl, paths, now = Date.now()) { return { ...pl, items: dedupe([...pl.items, ...paths]), changed: now }; }
  function removeAt(pl, index, now = Date.now()) { return { ...pl, items: pl.items.filter((_, i) => i !== index), changed: now }; }
  /** Moves the song at `from` so it ends up at `to` (indices in the list as it was). */
  function moveItem(pl, from, to, now = Date.now()) {
    const items = pl.items.slice();
    if (from < 0 || from >= items.length) return pl;
    const [x] = items.splice(from, 1);
    items.splice(Math.max(0, Math.min(items.length, to > from ? to - 1 : to)), 0, x);
    return { ...pl, items, changed: now };
  }
  function rename(pl, name, now = Date.now()) { return { ...pl, name: cleanName(name), changed: now }; }
  /** Checks a stored list: drops broken entries, keeps the first of any repeated id. */
  function normalizePlaylists(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter((p) => p && typeof p.id === 'string' && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ id: p.id, name: cleanName(p.name), items: dedupe(p.items), created: Number(p.created) || 0, changed: Number(p.changed) || 0 }));
  }

  // ---------- Plugin delay buffer ----------
  // The audio goes to the plugin host in blocks of B samples (each starting on a multiple of B) and
  // plays `delay` samples later, from what came back; a block that isn't back in time plays without
  // the plugins. Each late block makes the delay 2 blocks longer (at most every half second, up to
  // `maxBlocks`), so a slow moment crackles once rather than over and over.
  class HostDelay {
    constructor(B, { startBlocks = 6, maxBlocks = 24, ringBlocks = 32 } = {}) {
      this.B = B;
      this.delay = startBlocks * B;
      this.max = maxBlocks * B;
      this.ring = [new Float32Array(B * ringBlocks), new Float32Array(B * ringBlocks)];
      this.pos = 0;
      this.fill = 0;
      this.send = [new Float32Array(B), new Float32Array(B)];
      this.back = new Map();
      this.lateAt = -1e9;
      this.st = { sent: 0, back: 0, late: 0, peak: 0 };
    }
    reset() { this.back.clear(); this.fill = 0; }
    /** A block came back from the host. */
    receive(seq, L, R) { this.back.set(seq, [L, R]); this.st.back++; }
    /** Runs n samples in place; out(seq, L, R) is called with each full block to send. t: seconds now. */
    process(L, R, n, t, out) {
      const B = this.B, ring = this.ring, RS = ring[0].length;
      for (let i = 0; i < n; i++) {
        const p = this.pos + i;
        ring[0][p % RS] = L[i]; ring[1][p % RS] = R[i];
        const a = Math.abs(L[i]); if (a > this.st.peak) this.st.peak = a;
        if (this.fill > 0 || p % B === 0) {
          this.send[0][this.fill] = L[i]; this.send[1][this.fill] = R[i];
          if (++this.fill === B) {
            out((p + 1) / B - 1, this.send[0], this.send[1]);
            this.send = [new Float32Array(B), new Float32Array(B)];
            this.fill = 0;
            this.st.sent++;
          }
        }
        const q = p - this.delay;
        if (q < 0) { L[i] = 0; R[i] = 0; continue; }
        const blk = this.back.get(Math.floor(q / B));
        if (blk) { const j = q % B; L[i] = blk[0][j]; R[i] = blk[1][j]; }
        else {
          L[i] = ring[0][q % RS]; R[i] = ring[1][q % RS];
          if (q % B === 0) {
            this.st.late++;
            if (this.delay < this.max && t - this.lateAt > 0.5) { this.delay += 2 * B; this.lateAt = t; }
          }
        }
      }
      this.pos += n;
      const keep = Math.floor((this.pos - this.delay) / B) - 1;
      for (const k of this.back.keys()) if (k < keep) this.back.delete(k);
    }
  }

  // ---------- Gapless ----------
  /** Whether the next song can be loaded ahead and started right as this one ends. */
  function canGapless(cur, next, { videoShown = false } = {}) {
    return !!(cur && next && !cur.stream && !next.stream && next.playable !== false && next.path && !videoShown && !next.hasVideo);
  }
  /** Time to start the next song: within `lead` seconds of the end (one screen frame or so). */
  function handoverDue(currentTime, duration, lead = 0.035) {
    return Number.isFinite(duration) && duration > 1 && duration - currentTime <= lead;
  }

  // ---------- Scrobbling ----------
  /** Last.fm's rule: a song over 30 s counts once you've heard half of it, or 4 minutes. */
  function scrobbleDue(played, duration) {
    return Number(duration) > 30 && played >= Math.min(duration / 2, 240);
  }


  // ---------- DJ mode ----------
  // a / b: a song's analysis { bpm, offset (first beat, s), conf, camelot ("8A"), start / end (where the
  // sound starts and stops, s), duration }.
  const beatOf = (a) => 60 / a.bpm;
  const hasTempo = (a) => !!(a && a.bpm > 0 && (a.conf == null || a.conf >= 0.15));
  /** The rate to play b at so its beats meet a's: b's tempo, halved or doubled if that's nearer
   *  (a 70 BPM song against 140), within ±max. null when they're too far apart. */
  function tempoMatch(a, b, max = 0.08) {
    if (!hasTempo(a) || !hasTempo(b)) return null;
    let best = null;
    for (const m of [0.5, 1, 2]) {
      const rate = a.bpm / (b.bpm * m);
      if (!best || Math.abs(Math.log(rate)) < Math.abs(Math.log(best.rate))) best = { rate, mult: m };
    }
    return Math.abs(best.rate - 1) <= max ? best : null;
  }
  /** Steps apart on the Camelot wheel: 0 same key, 1 next door (±1, or the relative major / minor),
   *  2 and up clash more. null if either key is unknown. */
  function camelotDist(a, b) {
    const pa = /^(\d{1,2})([AB])$/.exec(String(a || '')), pb = /^(\d{1,2})([AB])$/.exec(String(b || ''));
    if (!pa || !pb) return null;
    const d = Math.abs(Number(pa[1]) - Number(pb[1])) % 12;
    return Math.min(d, 12 - d) + (pa[2] === pb[2] ? 0 : 1);
  }
  /** How well b follows a (lower is better): the tempo gap (after halving / doubling) and the key. */
  function mixScore(a, b) {
    if (!a || !b) return 99;
    let s = 0;
    if (hasTempo(a) && hasTempo(b)) {
      const m = [0.5, 1, 2].map((k) => Math.abs(Math.log(a.bpm / (b.bpm * k)))).reduce((x, y) => Math.min(x, y));
      s += Math.min(6, m * 50); // 2 % apart ≈ 1
    } else s += 3;
    const k = camelotDist(a.camelot, b.camelot);
    s += k == null ? 2 : [0, 0.5, 2.5, 4, 5, 6, 6][Math.min(6, k)];
    return s;
  }
  /** Where a song's main part (the action) starts and ends, from its loudness every half second (env,
   *  and the bass, low, in dB): the first and last stretch within 6 dB of its usual loud level, on a bar
   *  line when the tempo is known. Not more than 40 % in from either end; null when it can't tell. */
  function actionSpan(a) {
    if (!a || !Array.isArray(a.env) || a.env.length < 40) return null;
    const n = a.env.length, low = Array.isArray(a.low) && a.low.length === n ? a.low : a.env;
    const e = a.env.map((v, i) => (v + low[i]) / 2);
    const s0 = Math.max(0, Math.floor((a.start || 0) * 2)), s1 = Math.min(n, Math.ceil((a.end || n / 2) * 2));
    if (s1 - s0 < 40) return null;
    const sorted = e.slice(s0, s1).sort((x, y) => x - y);
    const thr = sorted[Math.floor(sorted.length * 0.7)] - 6;
    const sm = e.map((_, i) => { let t = 0, c = 0; for (let j = Math.max(0, i - 4); j < Math.min(n, i + 4); j++) { t += e[j]; c++; } return t / c; });
    let i = s0; while (i < s1 && sm[i] < thr) i++;
    while (i > s0 && e[i - 1] >= thr - 3) i--;
    let j = s1 - 1; while (j > i && sm[j] < thr) j--;
    while (j < s1 - 1 && e[j + 1] >= thr - 3) j++;
    let start = i / 2, end = (j + 1) / 2;
    const dur = a.duration || n / 2;
    if (hasTempo(a)) {
      const bar = 4 * beatOf(a);
      start = a.offset + Math.round((start - a.offset) / bar) * bar;
      end = a.offset + Math.round((end - a.offset) / bar) * bar;
    }
    start = Math.max(a.start || 0, start);
    end = Math.min(a.end || dur, end);
    if (end - start < dur * 0.2) return null;
    return { start: start <= dur * 0.4 ? start : null, end: end >= dur * 0.6 ? end : null };
  }
  // ---------- DJ mode: shifting the next song into key ----------
  // Camelot numbers and their keys; a semitone up is 7 steps round the wheel.
  const CAMELOT_KEYS = { '1A': 'A♭ minor', '2A': 'E♭ minor', '3A': 'B♭ minor', '4A': 'F minor', '5A': 'C minor', '6A': 'G minor', '7A': 'D minor', '8A': 'A minor', '9A': 'E minor', '10A': 'B minor', '11A': 'F♯ minor', '12A': 'D♭ minor',
    '1B': 'B major', '2B': 'F♯ major', '3B': 'D♭ major', '4B': 'A♭ major', '5B': 'E♭ major', '6B': 'B♭ major', '7B': 'F major', '8B': 'C major', '9B': 'G major', '10B': 'D major', '11B': 'A major', '12B': 'E major' };
  /** The Camelot number k semitones up (down when negative). */
  function shiftCamelot(c, k) {
    const m = /^(\d{1,2})([AB])$/.exec(String(c || ''));
    if (!m) return c;
    return `${((((Number(m[1]) - 1 + 7 * Math.round(k)) % 12) + 12) % 12) + 1}${m[2]}`;
  }
  /** The best whole-semitone shift (min … max) for b to follow a, a itself shifted by aShift semitones:
   *  played faster or slower like a different sample rate, so its key and tempo move together. Weighs
   *  the key on the Camelot wheel, how near the tempos come, and the size of the shift. matched: close
   *  enough in tempo (within tol) to hold the beats, at rel (b's speed over a's); else rel puts b
   *  exactly on its shifted key. */
  // tempo: the playing song's tempo factor when it isn't its pitch's (a Stretch on top of Speed).
  function keyFit(a, aShift, b, { min = -5, max = 8, tol = 0.012, stretch = 0.08, shifter = false, tempo = null } = {}) {
    if (!a || !b || !b.camelot) return null;
    const fa = tempo > 0 ? tempo : 2 ** (aShift / 12), aBpm = hasTempo(a) ? a.bpm * fa : 0, aCam = shiftCamelot(a.camelot, aShift);
    // With a pitch shifter, key and tempo are separate: the shift is chosen for the key (smaller wins
    // ties), and the tempo is stretched to meet the playing song's (pitch kept) when it's within
    // stretch (half or double counts). rel: the next song's speed over the playing one's, as before.
    if (shifter) {
      let mult = 1, terr = Infinity;
      if (aBpm && hasTempo(b)) for (const m of [0.5, 1, 2]) { const e = Math.abs(Math.log(aBpm / (b.bpm * m))); if (e < terr) { terr = e; mult = m; } }
      const held = terr <= Math.log(1 + stretch);
      let best = null;
      for (let k = min; k <= max; k++) {
        const kd = camelotDist(aCam, shiftCamelot(b.camelot, k));
        const score = (kd == null ? 2 : [0, 0.5, 2.5, 4, 5, 6, 6][Math.min(6, kd)]) + Math.abs(k) * 0.5 + (held ? 0 : 2.5);
        if (!best || score < best.score - 1e-9) best = { k, kd, score };
      }
      return { k: best.k, kd: best.kd, camelot: shiftCamelot(b.camelot, best.k), matched: held, mult: held ? mult : 1, shifter: true,
        rel: held ? a.bpm / (b.bpm * mult) : 2 ** (best.k / 12) / fa, score: best.score };
    }
    let best = null;
    for (let k = min; k <= max; k++) {
      const kd = camelotDist(aCam, shiftCamelot(b.camelot, k));
      let terr = 1, mult = 1;
      if (aBpm && hasTempo(b)) for (const m of [0.5, 1, 2]) { const e = Math.abs(Math.log(aBpm / (b.bpm * 2 ** (k / 12) * m))); if (e < terr) { terr = e; mult = m; } }
      // No shift: the tempo can be matched with the pitch kept instead (within stretch).
      const kept = k === 0 && !!stretch && terr > tol && terr <= Math.log(1 + stretch);
      if (kept) terr = 0;
      // A shift earns its keep by fitting the key, or the tempo closely enough to hold the beats; nearer
      // but still too far apart counts for nothing. Smaller shifts win ties.
      const held = !!aBpm && hasTempo(b) && terr <= tol;
      const score = (kd == null ? 2 : [0, 0.5, 2.5, 4, 5, 6, 6][Math.min(6, kd)]) + (held ? 0 : 2.5) + Math.abs(k) * 0.5;
      if (!best || score < best.score - 1e-9) best = { k, kd, terr, mult, score, kept };
    }
    // Unshifted and matched by stretching (pitch kept): the usual tempo match does it.
    if (best.kept) return { k: 0, kd: best.kd, camelot: b.camelot, matched: true, stretch: true, mult: best.mult, rel: a.bpm / (b.bpm * best.mult), score: best.score };
    const matched = !!aBpm && hasTempo(b) && best.terr <= tol;
    const rel = matched ? a.bpm / (b.bpm * best.mult) : 2 ** (best.k / 12) / fa;
    return { k: best.k, kd: best.kd, camelot: shiftCamelot(b.camelot, best.k), matched, mult: matched ? best.mult : 1, rel, score: best.score };
  }
  // ---------- DJ mode: the action from the lyrics ----------
  const lyricKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  /** Where the first chorus starts: the first two lines in a row that come back, in the same order,
   *  later in the song. lines: [{ t, text }] (sung lines only). null when nothing repeats. */
  function chorusStart(lines) {
    const k = lines.map((l) => lyricKey(l.text));
    for (let i = 0; i + 1 < k.length; i++) {
      if (!k[i] || !k[i + 1]) continue;
      for (let j = i + 2; j + 1 < k.length; j++) if (k[j] === k[i] && k[j + 1] === k[i + 1]) return lines[i].t;
    }
    return null;
  }
  /** The action from synced lyrics: from the first sung line (or, with mode 'chorus', the first chorus) to
   *  the end of the last one, on bar lines when the tempo is known (a half-beat pickup before the bar
   *  counts as on it). Same limits as actionSpan (start in the first half, end in the second); null
   *  without enough sung lines. a: the song's analysis; lines: [{ t, text }] (Core.parseLrc). */
  function lyricsSpan(lines, a, mode = 'vocals') {
    const L = (Array.isArray(lines) ? lines : []).filter((l) => l && Number.isFinite(l.t) && lyricKey(l.text)).sort((x, y) => x.t - y.t);
    if (L.length < 4 || !a) return null;
    const dur = a.duration || a.end || 0;
    if (!dur) return null;
    const beat = hasTempo(a) ? beatOf(a) : 0, bar = beat * 4;
    const down = (t) => (bar ? a.offset + Math.floor((t - a.offset + beat / 2) / bar) * bar : t);
    const up = (t) => (bar ? a.offset + Math.ceil((t - a.offset - 0.05) / bar) * bar : t);
    let from = L[0].t;
    if (mode === 'chorus') { const c = chorusStart(L); if (c != null) from = c; }
    // The last line lasts about as long as a line usually does (the gap between lines), 8 s at most.
    const gaps = L.slice(1).map((l, i) => l.t - L[i].t).filter((g) => g > 0 && g < 15).sort((x, y) => x - y);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 4;
    const to = L[L.length - 1].t + Math.min(8, typical * 1.2);
    const start = Math.max(a.start || 0, down(from)), end = Math.min(a.end || dur, up(to));
    return { start: start <= dur * 0.5 ? start : null, end: end >= dur * 0.5 ? end : null };
  }
  /** When the mix starts in a (outAt, its time) and where b starts (inAt, its time), for a crossfade of
   *  fade seconds: a starts handing over on a bar line, fade seconds before its sound stops; b starts
   *  on its first beat where its sound starts. With cut: a hands over as its main part ends (its outro
   *  skipped), and b starts so that its main part arrives as the crossfade ends (its intro skipped).
   *  rate: b's speed during the mix (1 when not matching). */
  function mixPlan(a, b, { fade = 12, match = true, max = 0.08, cut = false, fit = null } = {}) {
    const aEnd = a && a.end > 0 ? a.end : a && a.duration > 0 ? a.duration : 0;
    const act = (x) => (cut ? x.action !== undefined ? x.action : (x.action = actionSpan(x)) : null);
    const aAct = a ? act(a) : null, bAct = b ? act(b) : null;
    const aOut = aAct && aAct.end ? Math.min(aEnd, aAct.end) : aEnd;
    const bDur = b && (b.end || b.duration) > 0 ? (b.end || b.duration) - (b.start || 0) : Infinity;
    let len = Math.max(0, Math.min(fade, aOut / 3, bDur / 3));
    let outAt = aOut - len;
    // fit (keyFit): b plays at fit.rel, its beats held only when matched.
    const tm = fit ? (fit.matched ? { rate: fit.rel, mult: fit.mult } : null) : match ? tempoMatch(a, b, max) : null;
    const relRate = fit ? fit.rel : tm ? tm.rate : 1;
    if ((tm || fit) && hasTempo(a)) {
      const bar = 4 * beatOf(a);
      const snapped = a.offset + Math.floor((outAt - a.offset) / bar + 1e-6) * bar;
      if (snapped >= 0 && aOut - snapped <= len + bar) { outAt = snapped; len = aOut - snapped; }
    }
    const first = b && b.start > 0 ? b.start : 0;
    const onBeat = (t) => { const bb = beatOf(b) / tm.mult; return b.offset + Math.ceil((t - b.offset - 0.05) / bb) * bb; };
    let inAt = first, cutIn = false;
    // Straight to b's main part only with the beats held; else it comes in from its intro.
    if (tm && bAct && bAct.start != null) {
      // b's main part lands as the crossfade ends: len of a's time is len × rate of b's.
      const t = bAct.start - len * relRate;
      if (t > first + 1) { inAt = t; cutIn = true; }
    }
    if (tm && hasTempo(b)) inAt = Math.max(0, cutIn ? b.offset + Math.round((inAt - b.offset) / (beatOf(b) / tm.mult)) * (beatOf(b) / tm.mult) : onBeat(inAt));
    return { outAt: Math.max(0, outAt), inAt, len, rate: relRate, mult: tm ? tm.mult : 1, matched: !!tm, shift: fit ? fit.k : 0, fitted: !!fit,
      cutOut: aOut < aEnd - 1 ? aEnd - aOut : 0, cutIn: cutIn ? inAt - first : 0 };
  }
  /** How far b's beat is from a's, in beats (−0.5 … 0.5; positive: b is ahead), with a at aPos and b at
   *  bPos (each in its own time) and b's beat scaled by mult. */
  function beatPhaseError(a, aPos, b, bPos, mult = 1) {
    const pa = (aPos - a.offset) / beatOf(a), pb = (bPos - b.offset) / (beatOf(b) / mult);
    let e = (pb - pa) % 1;
    if (e > 0.5) e -= 1; else if (e < -0.5) e += 1;
    return e;
  }
  /** Equal-power crossfade at x (0 … 1): [outgoing gain, incoming gain]. */
  const fadeGains = (x) => { x = Math.max(0, Math.min(1, x)); return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)]; };
  /** The next song for a mix: of the candidates (analysed songs), the one that follows a best. */
  /** The best of cands to play after a: songs in the same key (as they'll be heard: keyDist gives the
   *  Camelot distance) come first, then the lowest score (tempo and key). → its index, or -1. */
  function pickNext(a, cands, score = mixScore, keyDist = (x, c) => camelotDist(x.camelot, c.camelot)) {
    let best = -1, bs = Infinity, bt = Infinity;
    cands.forEach((c, i) => {
      if (!c) return;
      const t = keyDist(a, c) === 0 ? 0 : 1, s = score(a, c);
      if (t < bt || (t === bt && s < bs - 1e-9)) { bt = t; bs = s; best = i; }
    });
    return best;
  }

  return { scrobbleDue, fmtTime, fmtLong, waveShape, waveBars, newPlaylist, addTo, removeAt, moveItem, rename, normalizePlaylists, dedupe, HostDelay, canGapless, handoverDue,
    tempoMatch, camelotDist, mixScore, mixPlan, actionSpan, lyricsSpan, chorusStart, beatPhaseError, fadeGains, pickNext, shiftCamelot, keyFit, CAMELOT_KEYS };
});
