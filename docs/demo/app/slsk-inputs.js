// Soulseek batch inputs: turns what you paste or drop into a list of things to find.
// Input types follow sockseek's (github.com/fiso64/sockseek; ideas, not code):
//   search string   "free text" · "Artist - Album" · "title=…, artist=…, album=…, length=215"
//   CSV file        columns found by name (Artist, Title, Album, Length…; Exportify's headers too)
//   list file       one input per line: input ["conditions"] ["preferred conditions"]; s: = song; # = comment
//   YouTube / YouTube Music playlist or video, SoundCloud track or set (read with yt-dlp)
//   Spotify playlist / album / track (read from Spotify's public embed page, no account needed)
//   Bandcamp track / album / artist page
//   MusicBrainz release / release-group / recording / collection (the public web service)
//   slsk://user/path/file (a file) or slsk://user/path/folder/ (a folder)
// Each item: { mode: 'albums' | 'songs' | 'link', target: { artist, title, album, length, tracks }, prefs?, label, link? }

// Loads in Node (main.js, tests) and as a plain script (the interface demo: window.SlskInputs).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlskInputs = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const SPLIT = /\s[-–—]\s/;

  // ---------- Strings ----------
  // "Song (Official Video) [HD]" → "Song"; "Artist - Topic" → "Artist"
  const JUNK = /\s*[([](?:official\s*(?:music\s*)?(?:video|audio|lyric(?:s)?\s*video|visuali[sz]er)|lyrics?(?:\s*video)?|audio|hd|hq|4k|mv|m\/v|visuali[sz]er|explicit|clean)[)\]]/gi;
  const cleanTitle = (s) => String(s || '').replace(JUNK, '').replace(/\s{2,}/g, ' ').trim();
  const cleanChannel = (s) => String(s || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();

  /** "Artist - Title" from a video / track title, else the channel as the artist. */
  function artistTitle(title, channel) {
    const t = cleanTitle(title);
    const i = t.search(SPLIT);
    if (i > 0) return { artist: t.slice(0, i).trim(), title: t.slice(i + 3).trim() };
    return { artist: cleanChannel(channel), title: t };
  }

  /** "title=Song, artist=Name, length=215" → target, or null when it isn't a field list. */
  function parseFieldList(s) {
    const str = String(s || '').trim();
    if (!/^(?:title|artist|album|length|tracks|album-track-count)\s*=/i.test(str)) return null;
    const t = {};
    for (const part of str.split(/\s*,\s*(?=(?:title|artist|album|length|tracks|album-track-count)\s*=)/i)) {
      const m = /^([\w-]+)\s*=\s*(.*)$/.exec(part);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim().replace(/^"(.*)"$/, '$1');
      if (k === 'length') t.length = parseLength(v);
      else if (k === 'tracks' || k === 'album-track-count') t.tracks = Number(v) || null;
      else t[k] = v;
    }
    return t.title || t.album || t.artist ? t : null;
  }
  // "3:35" / "1:02:03" / "215" seconds; ms when asked (Exportify's "Duration (ms)").
  function parseLength(v, ms = false) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(s)) return s.split(':').reduce((n, x) => n * 60 + Number(x), 0);
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(ms || n > 20000 ? n / 1000 : n);
  }

  /**
   * Conditions as sockseek writes them: "format=flac; br >= 320; strict-album=true; album-track-count>=13".
   * → { prefs (required conditions as Nabbit prefs), pref (preferred: prefFormat, hiRes), tracks: { min, max } }
   */
  function parseConditions(s, preferred = false) {
    const out = { prefs: {}, tracks: null };
    for (const raw of String(s || '').split(/\s*;\s*/)) {
      const m = /^\s*([\w-]+)\s*(>=|<=|=|>|<)\s*(.+?)\s*$/.exec(raw);
      if (!m) continue;
      const key = m[1].toLowerCase(), op = m[2], val = m[3].replace(/^"(.*)"$/, '$1');
      const bool = /^(true|1|yes)$/i.test(val);
      switch (key) {
        case 'format': case 'formats': {
          const list = val.split(/\s*,\s*/).map((x) => x.toLowerCase()).filter(Boolean);
          if (preferred) out.prefs.prefFormat = list.includes('flac') ? 'flac' : list.includes('mp3') ? 'mp3' : 'any';
          else out.prefs.formats = list;
          break;
        }
        case 'br': case 'bitrate': case 'min-bitrate':
          if (!preferred && (op === '>=' || op === '>' || key === 'min-bitrate')) out.prefs.minBitrate = Number(val) || 0;
          break;
        case 'length-tol': out.prefs.lengthTol = Number(val); break;
        case 'strict-title': case 'strict-album': if (!preferred) out.prefs.strictTitle = bool; break;
        case 'strict-artist': if (!preferred) out.prefs.strictArtist = bool; break;
        case 'banned-users': out.prefs.bannedUsers = val.split(/\s*,\s*/).filter(Boolean); break;
        case 'album-track-count': case 'tracks': {
          const n = parseInt(val, 10);
          if (!Number.isFinite(n)) break;
          out.tracks = op === '>=' || op === '>' ? { min: n } : op === '<=' || op === '<' ? { max: n } : { min: n, max: n };
          break;
        }
        default:
      }
    }
    return out;
  }

  /** One input → its kind. */
  function detect(input) {
    const s = String(input || '').trim();
    if (/^slsk:\/\//i.test(s)) return 'slsk';
    if (/^https?:\/\//i.test(s)) {
      if (/(^|\.)spotify\.com\//i.test(new URL(s).hostname + '/')) return 'spotify';
      if (/youtube\.com|youtu\.be/i.test(s)) return 'youtube';
      if (/soundcloud\.com/i.test(s)) return 'soundcloud';
      if (/musicbrainz\.org/i.test(s)) return 'musicbrainz';
      if (/bandcamp\.com/i.test(s) || /\/(album|track)\/[^/?#]+/i.test(s)) return 'bandcamp';
      return 'url';
    }
    if (/\.csv$/i.test(s)) return 'csv';
    if (/\.(txt|list)$/i.test(s)) return 'list';
    return 'string';
  }

  /** slsk://user/path/to/file (a file) or …/folder/ (a folder) → { user, path (Soulseek's backslashes), folder } */
  function parseSlskLink(s) {
    const m = /^slsk:\/\/([^/]+)\/(.+)$/i.exec(String(s).trim());
    if (!m) return null;
    let p = m[2];
    try { p = decodeURIComponent(p); } catch {}
    const folder = p.endsWith('/') || p.endsWith('\\');
    return { user: decodeURIComponent(m[1]), path: p.replace(/[\\/]+$/, '').replace(/\//g, '\\'), folder };
  }

  // ---------- CSV ----------
  function csvRows(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    const s = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' && !s.slice(0, 200).includes(',')) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  const COLS = {
    artist: ['artist', 'artists', 'artist name', 'artist name(s)', 'artist(s)', 'performer'],
    title: ['title', 'track', 'track name', 'song', 'song name', 'name', 'track title'],
    album: ['album', 'album name', 'album title', 'release'],
    length: ['length', 'duration', 'duration (ms)', 'time', 'track duration (ms)', 'duration_ms'],
    tracks: ['album track count', 'track count', 'tracks', 'total tracks'],
  };
  /** CSV → items: rows with a title are songs, rows with only an album are albums. */
  function parseCsv(text, cols = {}) {
    const rows = csvRows(text);
    if (rows.length < 2) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (k) => (cols[k] ? head.indexOf(String(cols[k]).toLowerCase()) : head.findIndex((h) => COLS[k].includes(h)));
    const at = { artist: find('artist'), title: find('title'), album: find('album'), length: find('length'), tracks: find('tracks') };
    if (at.title < 0 && at.album < 0) throw new Error('This CSV has no Title or Album column.');
    const ms = at.length >= 0 && /ms/.test(head[at.length]);
    const items = [];
    for (const r of rows.slice(1)) {
      const v = (k) => (at[k] >= 0 ? (r[at[k]] || '').trim() : '');
      // Exportify lists several artists "A, B": the first one searches best.
      const artist = v('artist').split(/\s*[;,]\s*(?=\S)/)[0] || '';
      const title = v('title'), album = v('album');
      if (!title && !album) continue;
      const target = { artist, title, album, length: parseLength(v('length'), ms), tracks: Number(v('tracks')) || null };
      items.push(title ? { mode: 'songs', target, label: `${artist ? `${artist} - ` : ''}${title}` } : { mode: 'albums', target: { ...target, title: album }, label: `${artist ? `${artist} - ` : ''}${album}` });
    }
    return items;
  }

  // ---------- List files ----------
  // A line: input ["conditions"] ["preferred conditions"]; tokens are "quoted" or bare words.
  function parseListLine(line, defaultMode = 'albums') {
    const s = String(line).trim();
    if (!s || s.startsWith('#')) return null;
    const tokens = [];
    const re = /(s:)?(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;
    let m;
    let song = false;
    // An unquoted input runs to the first quoted part.
    const firstQuote = s.indexOf('"');
    if (firstQuote !== 0 && !/^s:"/.test(s)) {
      const input = (firstQuote > 0 ? s.slice(0, firstQuote) : s).trim();
      if (input.startsWith('s:')) song = true;
      tokens.push(song ? input.slice(2) : input);
      re.lastIndex = firstQuote > 0 ? firstQuote : s.length;
    }
    while ((m = re.exec(s))) {
      if (!tokens.length && m[1]) song = true;
      tokens.push(m[2] != null ? m[2].replace(/\\"/g, '"') : m[3]);
    }
    if (!tokens.length) return null;
    const conds = parseConditions(tokens[1]);
    const pref = parseConditions(tokens[2], true);
    return { input: tokens[0], mode: song ? 'songs' : defaultMode, prefs: { ...conds.prefs, ...pref.prefs }, tracks: conds.tracks };
  }

  // ---------- Pages and services ----------
  const htmlDecode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  /** Bandcamp album / track page → items; an artist page → its album links (to read next). */
  function parseBandcamp(html, pageUrl) {
    const m = /data-tralbum="([^"]+)"/.exec(html);
    if (m) {
      const d = JSON.parse(htmlDecode(m[1]));
      const artist = d.artist || '';
      const tracks = (d.trackinfo || []).filter((t) => t.title);
      if (d.item_type === 'track' || (d.current && d.current.type === 'track')) {
        const t = tracks[0] || {};
        return { items: [{ mode: 'songs', target: { artist, title: t.title || (d.current && d.current.title), length: Math.round(t.duration) || null }, label: `${artist} - ${t.title || d.current.title}` }] };
      }
      const album = (d.current && d.current.title) || '';
      return { items: [{ mode: 'albums', target: { artist, title: album, album, tracks: tracks.length || null }, label: `${artist} - ${album}` }] };
    }
    // Artist page: the album / track grid.
    const base = new URL(pageUrl);
    const links = [...new Set([...html.matchAll(/href="((?:https?:\/\/[^"?#]+?)?\/(?:album|track)\/[^"?#]+)[^"]*"/g)].map((x) => new URL(htmlDecode(x[1]), base.origin).href))];
    if (links.length) return { links };
    throw new Error("Couldn't read this Bandcamp page (it may be behind a Cloudflare check).");
  }

  /** Spotify's public embed page (open.spotify.com/embed/<type>/<id>) → items. */
  function parseSpotifyEmbed(html, type) {
    const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) throw new Error("Couldn't read the Spotify page. Export the playlist to CSV (e.g. with Exportify) and use that instead.");
    const data = JSON.parse(m[1]);
    const e = (((data.props || {}).pageProps || {}).state || {}).data && data.props.pageProps.state.data.entity;
    if (!e) throw new Error("Couldn't read the Spotify page. Export the playlist to CSV (e.g. with Exportify) and use that instead.");
    const artistsOf = (x) => (x.artists ? x.artists.map((a) => a.name).join(', ') : x.subtitle || '');
    if (type === 'album') {
      const artist = artistsOf(e);
      return [{ mode: 'albums', target: { artist: artist.split(', ')[0], title: e.name || e.title, album: e.name || e.title, tracks: (e.trackList || []).length || null }, label: `${artist} - ${e.name || e.title}` }];
    }
    const list = e.trackList || (e.type === 'track' ? [{ title: e.name || e.title, subtitle: artistsOf(e), duration: e.duration }] : []);
    return list.map((t) => {
      const artist = (t.subtitle || artistsOf(t)).split(/,\s*/)[0];
      return { mode: 'songs', target: { artist, title: t.title || t.name, length: t.duration ? Math.round(t.duration / 1000) : null }, label: `${artist} - ${t.title || t.name}` };
    });
  }

  /** yt-dlp's JSON for a YouTube / SoundCloud video, track or playlist → song items. */
  function parseYtDlp(json) {
    const entries = json.entries ? json.entries.filter(Boolean) : [json];
    return entries.filter((e) => e.title && !/^\[(deleted|private) video\]$/i.test(e.title)).map((e) => {
      const t = e.track && (e.artist || e.creator) ? { artist: String(e.artist || e.creator).split(/,\s*/)[0], title: e.track } : artistTitle(e.title, e.channel || e.uploader);
      return { mode: 'songs', target: { ...t, length: e.duration ? Math.round(e.duration) : null }, label: `${t.artist ? `${t.artist} - ` : ''}${t.title}` };
    });
  }

  const mbArtist = (credit) => (credit || []).map((c) => c.name + (c.joinphrase || '')).join('').trim();
  const mbFirstArtist = (credit) => (credit && credit[0] ? credit[0].name : '');
  /** A MusicBrainz release → an album item. */
  function mbRelease(r) {
    const tracks = (r.media || []).reduce((n, m) => n + (m['track-count'] || (m.tracks || []).length || 0), 0) || null;
    return { mode: 'albums', target: { artist: mbFirstArtist(r['artist-credit']), title: r.title, album: r.title, tracks }, label: `${mbArtist(r['artist-credit'])} - ${r.title}` };
  }
  // Release groups: the most common track count among their releases (the usual version).
  function mbReleaseGroup(releases) {
    if (!releases.length) throw new Error('That release group has no releases.');
    const count = (r) => (r.media || []).reduce((n, m) => n + (m['track-count'] || 0), 0);
    const tally = new Map();
    for (const r of releases) tally.set(count(r), (tally.get(count(r)) || 0) + 1);
    const common = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    return mbRelease(releases.find((r) => count(r) === common));
  }

  /**
   * Turns text (one input per line; files as paths) into items. deps: { readFile(path) → text,
   * fetchText(url) → text, fetchJson(url) → object, ytJson(url) → object }. defaultMode applies to plain
   * search strings. → { items, errors: [{ input, message }] }
   */
  async function resolveInputs(text, defaultMode, deps, onProgress = () => {}) {
    const items = [];
    const errors = [];
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const [i, line] of lines.entries()) {
      onProgress(i, lines.length, line);
      try { items.push(...(await resolveOne(line, defaultMode, deps))); } catch (e) { errors.push({ input: line, message: e.message }); }
      if (items.length > 5000) { errors.push({ input: line, message: 'Stopped at 5000 items.' }); break; }
    }
    return { items, errors };
  }
  async function resolveOne(line, defaultMode, deps, depth = 0) {
    // A list-file line (conditions in quotes) or a plain input.
    const parsed = /"/.test(line) || /^s:/.test(line) ? parseListLine(line, defaultMode) : { input: line, mode: defaultMode, prefs: {}, tracks: null };
    if (!parsed) return [];
    const { input } = parsed;
    const kind = detect(input);
    const withConds = (list) => list.map((it) => ({ ...it, prefs: { ...(it.prefs || {}), ...parsed.prefs },
      target: parsed.tracks && it.mode === 'albums' ? { ...it.target, tracksMin: parsed.tracks.min, tracksMax: parsed.tracks.max } : it.target }));
    switch (kind) {
      case 'string': {
        const f = parseFieldList(input);
        if (f) return withConds([f.title ? { mode: 'songs', target: f, label: `${f.artist ? `${f.artist} - ` : ''}${f.title}` } : { mode: 'albums', target: { ...f, title: f.album }, label: `${f.artist ? `${f.artist} - ` : ''}${f.album}` }]);
        const i = input.search(SPLIT);
        const artist = i > 0 ? input.slice(0, i).trim() : '';
        const title = i > 0 ? input.slice(i + 3).trim() : input;
        return withConds([{ mode: parsed.mode, target: parsed.mode === 'albums' ? { artist, title, album: title } : { artist, title }, label: input }]);
      }
      case 'slsk': {
        const l = parseSlskLink(input);
        if (!l) throw new Error('Not a slsk:// link (slsk://user/path/to/file, or …/folder/ for a folder).');
        return [{ mode: 'link', link: l, target: {}, label: `${l.user}: ${l.path.split('\\').pop()}${l.folder ? ' (folder)' : ''}` }];
      }
      case 'csv': return withConds(parseCsv(await deps.readFile(input)));
      case 'list': {
        if (depth) throw new Error('A list file inside a list file isn\'t supported.');
        const out = [];
        for (const l of (await deps.readFile(input)).split(/\r?\n/)) {
          const t = l.trim();
          if (t && !t.startsWith('#')) out.push(...(await resolveOne(t, defaultMode, deps, depth + 1)));
        }
        return out;
      }
      case 'youtube': case 'soundcloud': return withConds(parseYtDlp(await deps.ytJson(input)));
      case 'spotify': {
        const m = /spotify\.com\/(?:intl-\w+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]+)/.exec(input);
        if (!m) throw new Error('Use a Spotify playlist, album or track link (liked songs: export them to CSV with Exportify).');
        return withConds(parseSpotifyEmbed(await deps.fetchText(`https://open.spotify.com/embed/${m[1]}/${m[2]}`), m[1]));
      }
      case 'bandcamp': {
        const r = parseBandcamp(await deps.fetchText(input), input);
        if (r.items) return withConds(r.items);
        if (depth) return [];
        const out = [];
        for (const link of r.links.slice(0, 100)) { try { out.push(...(await resolveOne(link, defaultMode, deps, depth + 1))); } catch {} }
        return withConds(out);
      }
      case 'musicbrainz': {
        const m = /musicbrainz\.org\/(release|release-group|recording|collection)\/([0-9a-f-]{36})/i.exec(input);
        if (!m) throw new Error('Use a MusicBrainz release, release group, recording or collection link.');
        const api = 'https://musicbrainz.org/ws/2';
        if (m[1] === 'release') return withConds([mbRelease(await deps.fetchJson(`${api}/release/${m[2]}?inc=artist-credits+media&fmt=json`))]);
        if (m[1] === 'release-group') return withConds([mbReleaseGroup((await deps.fetchJson(`${api}/release?release-group=${m[2]}&inc=artist-credits+media&limit=100&fmt=json`)).releases || [])]);
        if (m[1] === 'recording') {
          const r = await deps.fetchJson(`${api}/recording/${m[2]}?inc=artist-credits&fmt=json`);
          return withConds([{ mode: 'songs', target: { artist: mbFirstArtist(r['artist-credit']), title: r.title, length: r.length ? Math.round(r.length / 1000) : null }, label: `${mbArtist(r['artist-credit'])} - ${r.title}` }]);
        }
        const rel = (await deps.fetchJson(`${api}/release?collection=${m[2]}&inc=artist-credits+media&limit=100&fmt=json`)).releases || [];
        return withConds(rel.map(mbRelease));
      }
      default: throw new Error('Nabbit can\'t read this kind of link for Soulseek.');
    }
  }

  return { artistTitle, cleanTitle, parseFieldList, parseLength, parseConditions, detect, parseSlskLink, csvRows, parseCsv,
    parseListLine, parseBandcamp, parseSpotifyEmbed, parseYtDlp, mbRelease, mbReleaseGroup, resolveInputs, resolveOne };
});
