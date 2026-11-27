// Soulseek search: turning what you want into queries, and the answers into a ranked list.
// Ideas (not code) from sockseek (github.com/fiso64/sockseek): "Artist - Title" splitting, cleaned-up
// queries with fallbacks (first artist, each artist, no artist), required conditions that remove files
// and preferred ones that only reorder, album folders judged by how many of their files pass, grouping
// the same album / song shared by many users, downranking users whose downloads failed, and a search
// rate limit (the server penalises clients that search too often).
//
// Pure functions; main.js runs the searches with slsk.js and sends the views to the window.

// Loads in Node (main.js, tests) and as a plain script (the interface demo: window.SlskSearch).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlskSearch = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const AUDIO = ['flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'wma', 'dsf', 'dff'];
  const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'dsf', 'dff']);

  // What the filters and preferences are unless Settings says otherwise.
  const DEFAULT_PREFS = {
    // Required: files that fail these are hidden.
    formats: AUDIO,          // allowed formats
    minBitrate: 0,           // kbps; lossless files always pass
    lengthTol: 3,            // seconds off the known length (songs opened from YouTube Music / SoundCloud); -1 = off
    strictTitle: false,      // the title must be in the file name (songs) / the album in the path (albums)
    strictArtist: false,     // the artist must be in the path
    bannedUsers: [],
    // Preferred: these only reorder.
    prefFormat: 'flac',      // 'flac' | 'mp3' | 'any'
    hiRes: true,             // prefer 24-bit / higher sample rates among lossless files
    fallbackLevel: 2,        // 0 = the query only, 1 = + first artist, 2 = + each artist, 3 = + without the artist
  };

  // ---------- Text ----------
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const FEAT = /\s*[([]?\b(?:feat|ft|featuring)\b\.?.*?(?:[)\]]|$)/i;
  const removeFeat = (s) => String(s || '').replace(FEAT, ' ').trim();
  const removeBrackets = (s) => String(s || '').replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ').trim();
  // Soulseek matches whole words; punctuation only hurts.
  const searchWords = (s) => String(s || '').replace(/[^\p{L}\p{N}'\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  // "A, B & C feat. D" → ['A', 'B', 'C']
  const splitArtists = (s) => removeFeat(s).split(/\s*(?:,|&|\/|;|\bx\b|\band\b|\bvs\.?)\s*/i).map((x) => x.trim()).filter(Boolean);

  /**
   * What a typed query asks for: "Artist - Title" splits on a spaced hyphen.
   * → { artist, title } (title is the album name in album mode)
   */
  function parseQuery(q) {
    const s = String(q || '').trim();
    const i = s.search(/\s[-–—]\s/);
    if (i > 0) return { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() };
    return { artist: '', title: s };
  }

  /**
   * The searches to run, best first. target: { artist, title, album?, length?, tracks? }; mode 'albums' | 'songs'.
   * Level 0: the query (featured artists removed). 1: + the first artist with the title's brackets removed.
   * 2: + each other artist. 3: + the title / album alone (no artist). At most 8, no repeats.
   */
  function buildQueries(target, mode, level = DEFAULT_PREFS.fallbackLevel) {
    const what = mode === 'albums' ? target.album || target.title : target.title;
    const artists = splitArtists(target.artist);
    const out = [];
    const add = (...parts) => {
      const q = searchWords(parts.filter(Boolean).join(' '));
      if (q && q.split(' ').some((w) => w.length > 1) && !out.includes(q)) out.push(q);
    };
    add(removeFeat(target.artist), removeFeat(what));
    if (level >= 1 && artists.length) add(artists[0], removeBrackets(removeFeat(what)));
    if (level >= 2) for (const a of artists.slice(1)) add(a, removeBrackets(removeFeat(what)));
    if (level >= 3 || !artists.length) add(removeBrackets(removeFeat(what)));
    if (level >= 3 && mode === 'albums' && artists.length && target.title && target.album && target.title !== target.album) add(artists[0], target.title);
    return out.slice(0, 8);
  }

  // ---------- Matching ----------
  // The track title from a file name: "03 - Artist - Title (Remaster).flac" → "Artist - Title (Remaster)".
  const trackName = (name) => String(name).replace(/\.[^.]+$/, '').replace(/^\s*(?:disc\s*\d+\s*)?[\d]{1,3}(?:[-.]\d{1,3})?\s*[-._)\]]*\s*/i, '').trim();
  const has = (hay, needle) => { const n = norm(needle); return !n || ` ${norm(hay)} `.includes(` ${n} `); };
  // Every word of the needle appears somewhere (looser than has()).
  const hasWords = (hay, needle) => { const h = new Set(norm(hay).split(' ')); return norm(needle).split(' ').filter(Boolean).every((w) => h.has(w)); };

  /** Does a file meet the required conditions? Unknown values pass (many clients don't report them). */
  function fileOk(f, prefs, target = {}, mode = 'songs') {
    if (!prefs.formats.includes(f.ext)) return false;
    if (prefs.minBitrate && !LOSSLESS.has(f.ext) && f.bitrate && f.bitrate < prefs.minBitrate) return false;
    if (mode === 'songs') {
      if (target.length && prefs.lengthTol >= 0 && f.duration && Math.abs(f.duration - target.length) > prefs.lengthTol) return false;
      if (prefs.strictTitle && target.title && !hasWords(trackName(f.name), removeBrackets(removeFeat(target.title)))) return false;
    }
    if (prefs.strictArtist && target.artist && !splitArtists(target.artist).some((a) => hasWords(f.file, a))) return false;
    return true;
  }

  // Quality points for one file: lossless above lossy, then (if hi-res is preferred) bit depth and rate.
  function qualityPoints(f, prefs) {
    let p = 0;
    if (LOSSLESS.has(f.ext)) p += prefs.prefFormat === 'mp3' ? 200 : 1000;
    if (prefs.prefFormat === 'mp3' && f.ext === 'mp3') p += 1000;
    if (prefs.prefFormat !== 'any' && f.ext === prefs.prefFormat) p += 300;
    if (LOSSLESS.has(f.ext)) {
      if (prefs.hiRes) p += (f.bitDepth || 16) * 8 + Math.min(f.sampleRate || 44100, 192000) / 1000;
      else p -= Math.max(0, (f.sampleRate || 44100) - 48000) / 1000 + Math.max(0, (f.bitDepth || 16) - 16) * 4; // big files for nothing
    } else {
      const br = f.bitrate || 0;
      p += br >= 200 && br <= 2500 ? 150 + br / 5 : br / 4;
    }
    return p;
  }
  // Availability points for a user's answer: free slot, short queue, speed; failed downloads cost a lot.
  function userPoints(u, fails = 0) {
    return (u.slotFree ? 120 : 0) - Math.min(u.queue || 0, 200) * 2 + Math.min(Math.log10((u.speed || 0) + 1) * 12, 90) - fails * 400;
  }

  // ---------- Views ----------
  const folderOf = (file) => file.replace(/[\\/][^\\/]*$/, '');
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  // An album's name without the format / year / rip tags that differ between copies.
  // "Artist - Album (2024) [FLAC]" and "Album [16-44]" are the same album: drop the artist prefix too.
  const albumKeyName = (name) => norm(String(name).replace(/^[^-–]+?\s[-–]\s(?=\S)/, '')
    .replace(/[([{][^)\]}]*(?:flac|mp3|320|v0|v2|24|16|bit|khz|web|cd|vinyl|lossless|hi-?res|kbps|\d{4})[^)\]}]*[)\]}]/gi, ' ')
    .replace(/\b(?:flac|mp3|320|v0|web|cd|vinyl|lossless|24-?bit|16-?bit|\d{2,3}(?:\.\d)?\s?khz)\b/gi, ' ')
    .replace(/^\s*\d{4}\s*[-.]\s*/, ''));

  /**
   * Album view: each user's folders, judged by how many audio files pass (≥ 70 % "coverage"), grouped
   * with the same album from other users (name + track count), best first.
   * answers: [{ user, slotFree, speed, queue, files: [file entries] }], fails: Map user → count
   * → [{ key, name, tracks, quality, users, sources: [{ user, folder, name, files, size, formats, lossless,
   *      bitDepth, sampleRate, bitrate, slotFree, speed, queue, score, matches }] }]
   */
  function albumView(answers, prefs = DEFAULT_PREFS, target = {}, fails = new Map()) {
    const banned = new Set(prefs.bannedUsers.map((u) => u.toLowerCase()));
    const sources = [];
    for (const a of answers) {
      if (banned.has(a.user.toLowerCase()) || (fails.get(a.user) || 0) >= 2) continue; // ignored after 2 failures
      const by = new Map();
      for (const f of a.files) {
        if (!AUDIO.includes(f.ext)) continue;
        const k = folderOf(f.file);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(f);
      }
      for (const [folder, files] of by) {
        const ok = files.filter((f) => fileOk(f, prefs, target, 'albums'));
        if (ok.length / files.length < 0.7) continue;
        if (target.tracks && files.length < Math.max(1, Math.floor(target.tracks * 0.8))) continue;
        if ((target.tracksMin && files.length < target.tracksMin) || (target.tracksMax && files.length > target.tracksMax)) continue;
        files.sort((x, y) => x.file.localeCompare(y.file, undefined, { numeric: true }));
        const name = baseName(folder) || folder;
        const wantAlbum = target.album || (target.title && !target.artist ? null : target.title);
        const nameMatch = wantAlbum ? (has(folder, wantAlbum) ? 2 : hasWords(folder, wantAlbum) ? 1 : 0) : 1;
        if (prefs.strictTitle && wantAlbum && !nameMatch) continue;
        const artistMatch = target.artist ? splitArtists(target.artist).some((x) => hasWords(folder, x)) : true;
        const q = files.reduce((n, f) => n + qualityPoints(f, prefs), 0) / files.length;
        const max = (k) => files.reduce((m, f) => Math.max(m, f[k] || 0), 0) || null;
        const formats = [...new Set(files.map((f) => f.ext))];
        const score = q + userPoints(a, fails.get(a.user)) + nameMatch * 250 + (artistMatch ? 80 : 0)
          + (target.tracks ? (files.length === target.tracks ? 120 : -Math.abs(files.length - target.tracks) * 15) : 0);
        sources.push({ user: a.user, folder, name, files, size: files.reduce((n, f) => n + f.size, 0), formats,
          lossless: files.every((f) => LOSSLESS.has(f.ext)), bitDepth: max('bitDepth'), sampleRate: max('sampleRate'), bitrate: max('bitrate'),
          slotFree: a.slotFree, speed: a.speed, queue: a.queue, failed: fails.get(a.user) || 0, score, matches: nameMatch > 0 && artistMatch });
      }
    }
    // The same album from many users: one entry, sources best first. More copies = more likely the right one.
    const groups = new Map();
    for (const s of sources) {
      const key = `${albumKeyName(s.name) || norm(s.name)}#${s.files.length}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    return [...groups].map(([key, list]) => {
      list.sort((x, y) => y.score - x.score);
      const best = list[0];
      const users = new Set(list.map((s) => s.user)).size;
      return { key, name: best.name, tracks: best.files.length, users, matches: list.some((x) => x.matches), quality: qualitySummary(list), sources: list.slice(0, 25),
        score: best.score + Math.min(Math.log2(users) * 40, 160) };
    }).sort((x, y) => y.score - x.score);
  }

  /**
   * Song view: files passing the required conditions, grouped by track title (+ length within 3 s) across
   * users, sources best first. → [{ key, name, duration, users, quality, sources: [{ user, file, name, size,
   *   ext, bitrate, sampleRate, bitDepth, duration, slotFree, speed, queue, folder, score }] }]
   */
  function songView(answers, prefs = DEFAULT_PREFS, target = {}, fails = new Map()) {
    const banned = new Set(prefs.bannedUsers.map((u) => u.toLowerCase()));
    const groups = [];
    const index = new Map(); // title key → group indices
    for (const a of answers) {
      if (banned.has(a.user.toLowerCase()) || (fails.get(a.user) || 0) >= 2) continue;
      for (const f of a.files) {
        if (!AUDIO.includes(f.ext) || !fileOk(f, prefs, target, 'songs')) continue;
        const title = trackName(f.name);
        const titleMatch = target.title ? (has(title, removeFeat(target.title)) ? 2 : hasWords(title, removeBrackets(removeFeat(target.title))) ? 1 : 0) : 1;
        const artistMatch = target.artist ? splitArtists(target.artist).some((x) => hasWords(f.file, x)) : true;
        const lengthMatch = target.length && f.duration ? Math.abs(f.duration - target.length) <= 3 : false;
        const score = qualityPoints(f, prefs) + userPoints(a, fails.get(a.user)) + titleMatch * 250 + (artistMatch ? 100 : 0) + (lengthMatch ? 150 : 0);
        const src = { user: a.user, file: f.file, name: f.name, size: f.size, ext: f.ext, bitrate: f.bitrate, sampleRate: f.sampleRate, bitDepth: f.bitDepth,
          vbr: f.vbr, duration: f.duration, slotFree: a.slotFree, speed: a.speed, queue: a.queue, folder: baseName(folderOf(f.file)), failed: fails.get(a.user) || 0, score,
          matches: titleMatch > 0 && artistMatch };
        const key = norm(title.replace(FEAT, ' '));
        const near = (index.get(key) || []).find((i) => !f.duration || !groups[i].duration || Math.abs(groups[i].duration - f.duration) <= 3);
        if (near != null) groups[near].sources.push(src);
        else { index.set(key, [...(index.get(key) || []), groups.length]); groups.push({ key: `${key}#${groups.length}`, name: title, duration: f.duration || null, sources: [src] }); }
      }
    }
    return groups.map((g) => {
      g.sources.sort((x, y) => y.score - x.score);
      const users = new Set(g.sources.map((s) => s.user)).size;
      return { ...g, users, matches: g.sources.some((x) => x.matches), quality: qualitySummary(g.sources), sources: g.sources.slice(0, 25), score: g.sources[0].score + Math.min(Math.log2(users) * 40, 160) };
    }).sort((x, y) => y.score - x.score);
  }

  // "FLAC 24/96 ×2 · FLAC 16/44.1 ×5 · MP3 320 ×3"
  function qualityLabel(x) {
    const ext = (x.formats ? x.formats.join('/') : x.ext || '').toUpperCase();
    if (x.bitDepth || x.sampleRate) return `${ext} ${x.bitDepth || '?'}/${x.sampleRate ? +(x.sampleRate / 1000).toFixed(1) : '?'}`;
    if (x.bitrate) return `${ext} ${x.bitrate}`;
    return ext;
  }
  function qualitySummary(list) {
    const counts = new Map();
    for (const s of list) counts.set(qualityLabel(s), (counts.get(qualityLabel(s)) || 0) + 1);
    return [...counts].slice(0, 4).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(' · ');
  }

  // ---------- Rate limit ----------
  /** Allows `count` searches per `windowMs` (default 34 per 220 s); wait() resolves when one may start. */
  class RateLimiter {
    constructor(count = 34, windowMs = 220000, now = () => Date.now()) { this.count = count; this.windowMs = windowMs; this.now = now; this.times = []; }
    delay() {
      const t = this.now();
      this.times = this.times.filter((x) => t - x < this.windowMs);
      return this.times.length < this.count ? 0 : this.windowMs - (t - this.times[0]);
    }
    async wait(onWait) {
      for (let d; (d = this.delay()) > 0;) { if (onWait) onWait(d); await new Promise((r) => setTimeout(r, Math.min(d, 1000))); }
      this.times.push(this.now());
    }
  }

  /**
   * Which files of another source stand in for the ones still missing: the same track title, else (when
   * the album has as many files) the same position. missing: [{ name, index, total }] → [{ m, f }]
   */
  function matchRemaining(missing, source) {
    const byName = new Map(source.files.map((f) => [norm(trackName(f.name)), f]));
    const out = [];
    for (const m of missing) {
      const f = byName.get(norm(trackName(m.name))) || (source.files.length === m.total ? source.files[m.index] : null);
      if (f && !out.some((x) => x.f === f)) out.push({ m, f });
    }
    return out;
  }

  return { AUDIO, LOSSLESS, DEFAULT_PREFS, norm, removeFeat, removeBrackets, searchWords, splitArtists, parseQuery, buildQueries,
    trackName, has, hasWords, fileOk, qualityPoints, userPoints, albumView, songView, albumKeyName, qualityLabel, qualitySummary, RateLimiter, matchRemaining };
});
