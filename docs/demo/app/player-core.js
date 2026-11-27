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

  return { scrobbleDue, fmtTime, fmtLong, waveShape, waveBars, newPlaylist, addTo, removeAt, moveItem, rename, normalizePlaylists, dedupe, HostDelay, canGapless, handoverDue };
});
