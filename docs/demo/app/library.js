// Player mode's music library: which files count as music, how ffprobe's output becomes a track, and
// how tracks group into albums. Pure functions (main.js does the scanning; tests run these directly).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LibraryCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const AUDIO_EXTS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'mp4', 'm4v', 'mkv', 'mov'];
const VIDEO_EXTS = ['mp4', 'm4v', 'webm', 'mkv', 'mov'];
// What Chromium's <audio> plays; anything else in a music folder is listed but greyed out.
const PLAYABLE = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'mp4', 'm4v', 'mkv', 'mov'];
const isAudio = (name) => AUDIO_EXTS.includes(String(name).split('.').pop().toLowerCase());

// Tag names differ by format and tool (ID3, Vorbis comments, MP4 atoms): read them case-blind.
function tagGetter(tags) {
  const map = new Map();
  for (const [k, v] of Object.entries(tags || {})) map.set(k.toLowerCase(), String(v));
  return (...names) => {
    for (const n of names) {
      const v = map.get(n.toLowerCase());
      if (v != null && v.trim() !== '') return v.trim();
    }
    return '';
  };
}
// "A; B; C" (and ID3's null-separated lists) → ['A', 'B', 'C'].
const splitArtists = (s) => [...new Set(String(s || '').split(/\s*[;\u0000]\s*/).map((x) => x.trim()).filter(Boolean))];
const firstInt = (s) => { const m = /\d+/.exec(String(s || '')); return m ? parseInt(m[0], 10) : 0; };

// ffprobe -show_format -show_streams JSON → a track (null when there's no audio stream).
function trackFromProbe(file, json, stat = {}) {
  const streams = (json && json.streams) || [];
  const a = streams.find((s) => s.codec_type === 'audio');
  if (!a) return null;
  const fmt = (json && json.format) || {};
  const get = tagGetter({ ...(a.tags || {}), ...(fmt.tags || {}) });
  const base = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  // No tags: "Artist - Title" file names (how Nabbit names downloads).
  const dash = /^(.+?) - (.+)$/.exec(base);
  const title = get('title') || (dash ? dash[2] : base);
  const artist = get('artist', 'album_artist', 'albumartist') || (dash ? dash[1] : '');
  const ext = String(file).split('.').pop().toLowerCase();
  const year = firstInt(get('date', 'year', 'originaldate', 'tdrc', 'tyer'));
  const lyrics = get('lyrics', 'unsyncedlyrics', 'lyrics-eng', 'uslt', '©lyr');
  const bits = Number(a.bits_per_raw_sample) || (/(\d+)/.test(a.sample_fmt || '') && /s(16|24|32)/.test(a.sample_fmt) ? Number(/s(16|24|32)/.exec(a.sample_fmt)[1]) : 0);
  return {
    path: file,
    ext,
    title,
    artist,
    albumArtist: get('album_artist', 'albumartist', 'album artist') || artist,
    album: get('album'),
    track: firstInt(get('track', 'tracknumber')),
    disc: firstInt(get('disc', 'discnumber')) || 1,
    year: year >= 1000 && year <= 9999 ? year : 0,
    genre: get('genre'),
    duration: Number(fmt.duration || a.duration) || 0,
    codec: String(a.codec_name || ext).toUpperCase(),
    rate: Number(a.sample_rate) || 0,
    bits: ['flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le'].some((c) => String(a.codec_name || '').startsWith(c.split('_')[0])) ? bits : 0,
    kbps: Math.round((Number(fmt.bit_rate) || Number(a.bit_rate) || 0) / 1000),
    channels: Number(a.channels) || 0,
    hasCover: streams.some((s) => s.codec_type === 'video' && ((s.disposition && s.disposition.attached_pic) || /mjpeg|png/.test(s.codec_name || ''))),
    hasLyrics: !!lyrics,
    // A real picture track (a music video), not just embedded cover art.
    hasVideo: streams.some((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic) && !/^(mjpeg|png|bmp|gif)$/.test(s.codec_name || '')),
    playable: PLAYABLE.includes(ext),
    size: stat.size || 0,
    mtime: stat.mtimeMs || 0,
  };
}

// An album's folder: the folder its songs are in, or the one above a "CD 1" / "Disc 2" folder.
const DISC_DIR = /^(cd|dis[ck])[\s._-]*\d+\b/i;
function albumFolder(p) {
  const parts = String(p).split(/[\\/]/);
  parts.pop();
  if (parts.length > 1 && DISC_DIR.test(parts[parts.length - 1])) parts.pop();
  return parts.join('\\');
}
const VARIOUS = /^(various( artists)?|va|v\.a\.)$/i;
const COMPILATION_DIR = /^(various( artists)?|va|v\.a\.|compilations?|soundtracks?|ost|singles|music|downloads?|unknown( artist)?)$/i;
// Who an album is by: the one artist all its songs share; else the artist folder it sits in
// (…\Artist\Album, not a library folder or a "Compilations"-style one); else the first artist of
// most of its songs; else "Various artists".
function albumArtistOf(tracks, folder, roots = []) {
  const named = [...new Set(tracks.map((t) => t.albumArtist || t.artist).filter((a) => a && !VARIOUS.test(a.trim())))];
  const tagged = tracks.some((t) => VARIOUS.test(String(t.albumArtist || '').trim()));
  if (named.length === 1 && !tagged) return named[0];
  const parts = String(folder).split(/[\\/]/).filter(Boolean);
  const parent = parts.length > 1 ? parts.slice(0, -1).join('\\').toLowerCase() : '';
  const isRoot = roots.some((r) => String(r).replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\') === parent.replace(/\//g, '\\'));
  const dir = parts.length > 1 ? parts[parts.length - 2] : '';
  if (dir && !isRoot && !/^[a-z]:$/i.test(dir) && !COMPILATION_DIR.test(dir)) return dir;
  const firsts = tracks.map((t) => splitArtists(String(t.artist || '').replace(/\s*(,|\bfeat\.|\bft\.|\bfeaturing\b)\s*/gi, ';'))[0]).filter(Boolean);
  const count = new Map();
  for (const a of firsts) count.set(a.toLowerCase(), [(count.get(a.toLowerCase()) || [0])[0] + 1, a]);
  const top = [...count.values()].sort((a, b) => b[0] - a[0])[0];
  if (top && top[0] * 2 >= tracks.length) return top[1];
  return named.length || tagged ? 'Various artists' : '';
}

// Tracks → albums: [{ key, album, artist, year, tracks, duration, codec }], sorted by artist, year,
// album; tracks by disc, number, title. Songs group by album name within their album folder (so a
// song "feat." someone else stays with its album); files without an album tag group by their folder.
function groupAlbums(tracks, roots = []) {
  const by = new Map();
  for (const t of tracks) {
    const folder = albumFolder(t.path);
    const key = t.album ? `${t.album.toLowerCase()}|${folder.toLowerCase()}` : `dir|${folder.toLowerCase()}`;
    if (!by.has(key)) by.set(key, { key, album: t.album || folder.split(/[\\/]/).pop() || 'Unknown album', artist: '', year: 0, tracks: [], folder });
    const g = by.get(key);
    g.tracks.push(t);
    if (t.year && (!g.year || t.year < g.year)) g.year = t.year;
  }
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const albums = [...by.values()];
  for (const g of albums) {
    g.tracks.sort((a, b) => (a.disc - b.disc) || ((a.track || 999) - (b.track || 999)) || cmp(a.title, b.title));
    g.duration = g.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const codecs = [...new Set(g.tracks.map((t) => t.ext))];
    g.codec = codecs.join(' / ');
    g.discs = new Set(g.tracks.map((t) => t.disc)).size;
    g.artist = albumArtistOf(g.tracks, g.folder, roots) || 'Unknown artist';
  }
  albums.sort((a, b) => cmp(a.artist, b.artist) || ((a.year || 9999) - (b.year || 9999)) || cmp(a.album, b.album));
  return albums;
}

// Tracks → folders, for "Sort: Folder": one group per folder, in folder-path order (as Explorer would
// list them), tracks by file name. The header is the album's name (else the folder's); `path` is the
// folder's path under its library folder.
function groupFolders(tracks, roots = []) {
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const by = new Map();
  for (const t of tracks) {
    const folder = String(t.path).replace(/[\\/][^\\/]*$/, '');
    if (!by.has(folder)) {
      const root = roots.filter((r) => folder.toLowerCase().startsWith(String(r).toLowerCase())).sort((a, b) => b.length - a.length)[0];
      const rel = root ? folder.slice(root.length).replace(/^[\\/]+/, '') : folder;
      const rootName = root ? String(root).split(/[\\/]/).filter(Boolean).pop() : '';
      by.set(folder, { key: `dir|${folder.toLowerCase()}`, folder, path: [rootName, ...rel.split(/[\\/]/).filter(Boolean)].filter(Boolean).join(' › ') || folder, album: '', artist: '', year: 0, tracks: [] });
    }
    by.get(folder).tracks.push(t);
  }
  const groups = [...by.values()];
  for (const g of groups) {
    const name = (p) => String(p).split(/[\\/]/).pop();
    g.tracks.sort((a, b) => ((a.disc || 1) - (b.disc || 1)) || cmp(name(a.path), name(b.path)));
    g.duration = g.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    g.codec = [...new Set(g.tracks.map((t) => t.ext))].join(' / ');
    g.artist = albumArtistOf(g.tracks, DISC_DIR.test(g.folder.split(/[\\/]/).pop()) ? albumFolder(`${g.folder}\\x`) : g.folder, roots);
    const years = g.tracks.map((t) => t.year).filter(Boolean);
    g.year = years.length ? Math.min(...years) : 0;
    g.discs = new Set(g.tracks.map((t) => t.disc || 1)).size;
    // Header: the album's name when the folder holds one album, else the folder's name.
    const albums = [...new Set(g.tracks.map((t) => t.album).filter(Boolean))];
    g.album = albums.length === 1 ? albums[0] : g.folder.split(/[\\/]/).filter(Boolean).pop() || g.folder;
    g.folderView = true;
  }
  groups.sort((a, b) => cmp(a.folder.replace(/\\/g, '/'), b.folder.replace(/\\/g, '/')));
  return groups;
}

// YouTube search results → the song's music video: the title has to name the song; "(Official Music
// Video)", then "(Music Video)", then "(Video)" come first; the artist's own channel wins; lyric / live / cover / remix uploads lose (unless the song is one);
// the closer the length, the better. → { pick, synced } (synced: within 10 s, so your file's audio
// can play under the picture) or null.
function pickMusicVideo(entries, { title, artist, duration }, skip = []) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const T = norm(String(title || '').replace(/\s*[([].*?[)\]]\s*/g, ' ')), A = norm(splitArtists(artist)[0] || '');
  if (!T) return null;
  const BAD = /\b(lyrics?|lyric video|live|cover|reaction|karaoke|instrumental|8d|slowed|sped up|nightcore|remix|bass boosted|1 hour|loop|tutorial|piano|guitar)\b/;
  const own = norm(title);
  let best = null;
  for (const e of entries || []) {
    if (!e || !e.id || skip.includes(e.id)) continue;
    const name = norm(e.title), ch = norm(e.channel || e.uploader);
    if (!name.includes(T)) continue;
    let score = 0;
    // The video's own label, best first: (Official Music Video), then (Music Video) / (Official Video),
    // then (Video): worth more than the channel and the length together, so they come first.
    const notMv = /\b(lyrics?|audio|visuali[sz]er|live|dance|reaction|behind the scenes|teaser|trailer|performance)\b/.test(name);
    if (!notMv && /\bofficial music video\b|\bofficial mv\b/.test(name)) score += 24;
    else if (!notMv && /\bmusic video\b|\bofficial video\b|\bmv\b/.test(name)) score += 18;
    else if (!notMv && /\bvideo\b/.test(name)) score += 12;
    else if (/\bofficial\b/.test(name)) score += 1;
    if (/\bofficial audio\b|\baudio\b|\bvisuali[sz]er\b/.test(name)) score -= 3;
    const bad = name.match(BAD);
    if (bad && !own.includes(bad[1])) score -= 6;
    if (A && (name.includes(A) || ch.includes(A))) score += 2;
    if (/ topic$/.test(ch)) score -= 6; // YouTube's auto-made "Topic" uploads are a still picture
    if (/vevo/.test(ch) || (A && ch.replace(/ /g, '').includes(A.replace(/ /g, '')))) score += 2;
    const diff = duration && e.duration ? Math.abs(e.duration - duration) : 30;
    score -= Math.min(6, diff / 10);
    if (!best || score > best.score) best = { score, e, diff };
  }
  if (!best || best.score < 0) return null;
  return { pick: { id: best.e.id, title: best.e.title || '', channel: best.e.channel || best.e.uploader || '', duration: best.e.duration || 0 }, synced: best.diff <= 10 };
}

// Synced lyrics ("[mm:ss.xx] line") → [{ t, text }]; plain lyrics → null.
function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0), text: words });
  }
  return out.length >= 2 ? out.sort((a, b) => a.t - b.t) : null;
}

// The artist to search a song's video by: the first credited one ("Zedd, Foxes" → Zedd; "A feat. B"
// → A), keeping names like "Simon & Garfunkel" or "Lil Nas X" whole.
function firstArtist(s) {
  return String(s || '').split(/\s*(?:;|,|\bfeat\.|\bft\.|\bfeaturing\b)\s*/i).map((x) => x.trim()).filter(Boolean)[0] || '';
}
return { AUDIO_EXTS, VIDEO_EXTS, PLAYABLE, isAudio, trackFromProbe, groupAlbums, groupFolders, parseLrc, splitArtists, pickMusicVideo, firstArtist };
});
