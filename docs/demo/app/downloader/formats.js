// Download options for the Downloader: turns yt-dlp's `formats` list into video and audio choices
// and answers "what's available for this selection?" for the cascading dropdowns.
// Loaded by Node (main process, tests) and by the window (<script>), so no require() here.
(function (root) {
  const VIDEO_CODECS = [[/^(avc|h264)/i, 'H.264'], [/^(hev|hvc|h265)/i, 'H.265'], [/^(vp0?9)/i, 'VP9'], [/^(vp0?8)/i, 'VP8'], [/^av0?1/i, 'AV1']];
  const AUDIO_CODECS = [[/^mp4a|^aac/i, 'AAC'], [/^opus/i, 'Opus'], [/^mp3/i, 'MP3'], [/^vorbis/i, 'Vorbis'], [/^flac/i, 'FLAC'], [/^ec-3|^eac3/i, 'E-AC3'], [/^ac-3|^ac3/i, 'AC3']];
  // An uploader's original file (SoundCloud's "download" format, when the artist allows downloads):
  // no codec info, just the file type. It's the best copy there is, so it's the default pick.
  const ORIGINAL_EXT = { wav: 'WAV', flac: 'FLAC', aif: 'AIFF', aiff: 'AIFF', mp3: 'MP3', m4a: 'AAC', aac: 'AAC', ogg: 'Vorbis', opus: 'Opus', alac: 'ALAC' };
  const isOriginalFile = (f) => f.format_id === 'download' || /^original$/i.test(f.format_note || '');
  const codecName = (codec, table) => {
    if (!codec || codec === 'none') return null;
    const hit = table.find(([re]) => re.test(codec));
    return hit ? hit[1] : codec.split('.')[0].toUpperCase();
  };
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);

  // Formats that aren't real media (storyboards, images).
  const isMedia = (f) => f && f.format_id && f.ext !== 'mhtml' && !/storyboard/i.test(f.format_note || '') &&
    !(f.vcodec === 'none' && f.acodec === 'none' && !/^(m4a|mp3|opus|ogg|webm|aac|flac|wav|aif|aiff)$/.test(f.ext));

  // Estimated size in bytes: exact size, yt-dlp's estimate, or bitrate × duration.
  function sizeOf(f, duration) {
    if (!f) return null;
    if (num(f.filesize)) return { bytes: f.filesize, estimated: false };
    if (num(f.filesize_approx)) return { bytes: f.filesize_approx, estimated: true };
    const kbps = num(f.tbr) || (num(f.vbr) || 0) + (num(f.abr) || 0);
    return kbps && num(duration) ? { bytes: (kbps * 1000 * duration) / 8, estimated: true } : null;
  }

  function parseFormats(json) {
    const duration = num(json.duration);
    const formats = (json.formats || []).filter(isMedia);
    const video = [];
    const audio = [];
    const languages = new Set(formats.filter((f) => f.vcodec === 'none' && f.language).map((f) => f.language));
    for (const f of formats) {
      const vcodec = codecName(f.vcodec, VIDEO_CODECS);
      const original = isOriginalFile(f) && !num(f.height);
      const acodec = codecName(f.acodec, AUDIO_CODECS) || (original ? ORIGINAL_EXT[String(f.ext || '').toLowerCase()] || 'Audio' : null);
      // Formats with unknown codecs but a height are video (some sites omit vcodec).
      const isVideo = !original && (!!vcodec || (f.vcodec == null && num(f.height)));
      if (isVideo) {
        const hdr = f.dynamic_range && f.dynamic_range !== 'SDR' ? f.dynamic_range : null;
        const codec = vcodec || 'Video';
        video.push({
          id: String(f.format_id),
          ext: String(f.ext || '').toLowerCase(),
          codec,
          key: [String(f.ext || '').toUpperCase(), codec, hdr].filter(Boolean).join(' · '),
          width: num(f.width),
          height: num(f.height),
          fps: num(f.fps) ? Math.round(f.fps) : null,
          kbps: num(f.vbr) || num(f.tbr),
          hasAudio: !!acodec || (f.acodec == null && f.vcodec == null),
          size: sizeOf(f, duration),
        });
      } else if (acodec || f.vcodec === 'none') {
        const lang = languages.size > 1 && f.language ? f.language : null;
        const codec = acodec || 'Audio';
        audio.push({
          id: String(f.format_id),
          ext: String(f.ext || '').toLowerCase(),
          codec,
          key: (original ? [String(f.ext || '').toUpperCase() || codec, 'Original file', lang]
            : [String(f.ext || '').toUpperCase(), codec, lang]).filter(Boolean).join(' · '),
          original,
          asr: num(f.asr),
          kbps: num(f.abr) || num(f.tbr),
          size: sizeOf(f, duration),
        });
      }
    }
    return { video, audio, duration };
  }

  const unique = (arr) => [...new Set(arr)];
  const byKbpsDesc = (a, b) => (b.kbps || 0) - (a.kbps || 0);

  // Format keys ordered by the best quality each offers (resolution, then fps, then bitrate).
  function keysOf(list, rank) {
    const best = new Map();
    for (const f of list) if (!best.has(f.key) || rank(f) > rank(best.get(f.key))) best.set(f.key, f);
    return [...best.entries()].sort((a, b) => rank(b[1]) - rank(a[1])).map(([key]) => key);
  }
  const videoRank = (f) => (f.height || 0) * 1e6 + (f.fps || 0) * 1e3 + (f.kbps || 0) / 1e3;
  const audioRank = (f) => (f.original ? 1e9 : 0) + (f.kbps || 0) * 1e3 + (f.asr || 0) / 1e3;

  // ---------- Remux / convert targets (the Converter's output formats) ----------
  // fits(stream): can this source stream be copied into the container as-is (remux, no quality loss)?
  // Targets with no fitting source are offered under "Convert" and re-encoded with the Converter's preset.
  const VIDEO_TARGETS = [
    { ext: 'mp4', label: 'MP4', preset: 'To Mp4', fits: (v) => v.ext === 'mp4' },
    { ext: 'mov', label: 'MOV', preset: 'To Mov', fits: (v) => v.ext === 'mp4' && /^H\.26[45]$/.test(v.codec) },
    { ext: 'mkv', label: 'MKV', preset: 'To Mkv', fits: () => true },
    { ext: 'webm', label: 'WEBM', preset: 'To Webm', fits: (v) => v.ext === 'webm' },
    { ext: 'avi', label: 'AVI', preset: 'To Avi', fits: null },
    { ext: 'ogv', label: 'OGV', preset: 'To Ogv', fits: null },
    { ext: 'gif', label: 'GIF', preset: 'To Gif', fits: null, noAudio: true },
  ];
  const AUDIO_TARGETS = [
    { ext: 'aac', label: 'AAC', preset: 'To Aac', fits: (a) => a.codec === 'AAC' },
    { ext: 'mp3', label: 'MP3', preset: 'To Mp3', fits: (a) => a.codec === 'MP3' },
    { ext: 'ogg', label: 'OGG', preset: 'To Ogg', fits: (a) => /Opus|Vorbis/.test(a.codec) },
    { ext: 'flac', label: 'FLAC', preset: 'To Flac', fits: (a) => a.codec === 'FLAC' },
    { ext: 'wav', label: 'WAV', preset: 'To Wav', fits: null },
  ];
  // Audio that yt-dlp can merge into each video remux container without re-encoding.
  const MERGE_AUDIO = { mp4: (a) => a.ext === 'm4a' || a.ext === 'mp4', mov: (a) => a.ext === 'm4a' || a.ext === 'mp4', webm: (a) => a.ext === 'webm', mkv: () => true };

  const parseChoice = (value) => {
    const m = /^(remux|convert|best):([a-z0-9]+)$/.exec(value || '');
    return m ? { kind: m[1], ext: m[2] } : { kind: 'original', key: value };
  };
  const target = (list, ext) => list.find((t) => t.ext === ext);

  // Groups for a dropdown: [{ group, items: [{ value, label }] }]
  function groupsFor(sourceKeys, list, targets) {
    const remux = [];
    const convert = [];
    for (const t of targets) {
      // Remux when a stream can be copied as-is; every format can also be converted (re-encoded).
      if (t.fits && list.some(t.fits)) remux.push({ value: `remux:${t.ext}`, label: `${t.label} (remux)` });
      convert.push({ value: `convert:${t.ext}`, label: `${t.label} (convert)` });
    }
    // Order: Remux on top, then Convert, then the site's Original streams.
    return [
      { group: 'Remux (lossless)', items: remux },
      { group: 'Convert (re-encode)', items: convert },
      { group: 'Original', items: sourceKeys.map((k) => ({ value: k, label: k })) },
    ].filter((g) => g.items.length);
  }

  // Source streams a choice can use.
  function videoPool(p, value) {
    const c = parseChoice(value);
    if (c.kind === 'original') return p.video.filter((f) => f.key === c.key);
    const t = target(VIDEO_TARGETS, c.ext);
    return c.kind === 'remux' && t && t.fits ? p.video.filter(t.fits) : p.video;
  }
  // "Highest quality possible": the stream "OGG (remux)" uses: the best Opus (YouTube's best, 48 kHz),
  // else Vorbis, else the best there is.
  // The "Best" choices: the Opus stream (as "OGG (remux)" takes it), converted, at most 48 kHz.
  const BEST_ITEMS = [
    { value: 'best:flac', label: 'Highest quality · FLAC (up to 48 kHz)' },
    { value: 'best:mp3', label: 'Highest quality · MP3 320 (up to 48 kHz)' },
  ];
  function bestSource(p) {
    const sorted = p.audio.slice().sort((a, b) => (b.kbps || 0) - (a.kbps || 0));
    return sorted.find((f) => f.codec === 'Opus') || sorted.find((f) => f.codec === 'Vorbis') || sorted[0] || null;
  }
  // What "Highest quality possible" makes from a stream: FLAC (16-bit) or MP3 (320 kbps) at the source's
  // sample rate, at most 48 kHz. Kept as-is: a file already in that format, or an MP3 when FLAC was
  // chosen (same rule as main.js).
  function bestOutcome(a, ext = 'flac') {
    if (!a) return null;
    const rate = a.asr ? Math.min(48000, a.asr) : 48000;
    const isFlac = a.ext === 'flac' || a.codec === 'FLAC', isMp3 = a.codec === 'MP3' || a.ext === 'mp3';
    if (ext === 'mp3') return isMp3 ? { keep: true, ext: 'mp3', lossless: false, rate: a.asr } : { keep: false, ext: 'mp3', lossless: false, kbps: 320, rate };
    if (isFlac) return { keep: true, ext: 'flac', lossless: true, rate: a.asr };
    if (isMp3) return { keep: true, ext: 'mp3', lossless: false, rate: a.asr };
    return { keep: false, ext: 'flac', lossless: true, bits: 16, rate };
  }

  function audioPool(p, value, videoValue) {
    const c = parseChoice(value);
    if (c.kind === 'best') { const b = bestSource(p); return b ? [b] : []; }
    let list = c.kind === 'original' ? p.audio.filter((f) => f.key === c.key)
      : c.kind === 'remux' ? p.audio.filter(target(AUDIO_TARGETS, c.ext).fits) : p.audio;
    const v = parseChoice(videoValue);
    if (v.kind === 'remux' && MERGE_AUDIO[v.ext]) list = list.filter(MERGE_AUDIO[v.ext]);
    return list;
  }

  // ---------- Out-of-range resolution / FPS for remux ----------
  // Remux targets accept any standard resolution and frame rate. Values the site doesn't offer are
  // "out of range": the closest real stream is downloaded and re-encoded to the chosen size / rate.
  const STANDARD_HEIGHTS = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
  const STANDARD_FPS = [240, 144, 120, 60, 50, 48, 30, 25, 24, 15];
  // Output bitrates offered when converting (kbps).
  const VIDEO_KBPS = [100000, 80000, 50000, 35000, 25000, 16000, 12000, 8000, 6000, 4000, 2500, 1500, 1000, 500, 250];
  const AUDIO_KBPS = [320, 256, 192, 160, 128, 96, 64, 48, 32];
  // Audio of each convert target: lossless formats have no bitrate; GIF has no audio.
  const LOSSLESS = ['flac', 'wav'];
  const SAMPLE_BITS = [16, 24];
  // Output sample rates when converting, and the highest each format's codec supports.
  const SAMPLE_RATES = [192000, 176400, 96000, 88200, 48000, 44100, 32000, 22050];
  const RATE_MAX = { mp3: 48000, aac: 96000, m4a: 96000, mp4: 96000, mov: 96000, mkv: 96000, avi: 48000, ogg: 192000, ogv: 192000, webm: 192000, flac: 192000, wav: 192000 };
  const ratesFor = (ext) => SAMPLE_RATES.filter((r) => r <= (RATE_MAX[ext] || 48000));
  const sortDesc = (arr) => unique(arr).sort((a, b) => (b || 0) - (a || 0));

  // The real stream height/fps used for a requested (height, fps): the smallest at or above the request
  // (downscaling keeps quality), else the largest available.
  function sourceFor(pool, height, fps) {
    const heights = unique(pool.map((f) => f.height)).filter(Boolean).sort((a, b) => a - b);
    const sh = heights.includes(height) ? height : heights.find((h) => h >= height) || heights[heights.length - 1] || null;
    const rates = unique(pool.filter((f) => f.height === sh).map((f) => f.fps)).filter(Boolean).sort((a, b) => a - b);
    const sf = rates.includes(fps) ? fps : rates.find((r) => r >= fps) || rates[rates.length - 1] || null;
    return { height: sh, fps: sf };
  }

  const api = {
    parseFormats,
    parseChoice,
    STANDARD_HEIGHTS,
    STANDARD_FPS,
    VIDEO_KBPS,
    AUDIO_KBPS,
    LOSSLESS,
    SAMPLE_BITS,
    SAMPLE_RATES,
    ratesFor,
    // Estimated lossless size: PCM (WAV) = rate × channels × bits; FLAC typically ~60% of that.
    losslessSize(asr, bits, duration, ext) {
      if (!num(asr) || !num(duration)) return null;
      const pcm = ((asr * 2 * bits) / 8) * duration;
      return { bytes: ext === 'flac' ? pcm * 0.6 : pcm, estimated: true };
    },
    sourceFor,
    // Remux resolution list: every standard height plus what the site has. oor = out of range.
    remuxHeights(pool) {
      const real = new Set(pool.map((f) => f.height));
      return sortDesc([...STANDARD_HEIGHTS, ...real].filter(Boolean)).map((h) => ({ height: h, oor: !real.has(h) }));
    },
    // Remux FPS list for a height: every standard rate plus the source's; oor when it differs from the source.
    remuxFps(pool, height) {
      const src = sourceFor(pool, height, Infinity);
      const real = new Set(pool.filter((f) => f.height === src.height).map((f) => f.fps));
      return sortDesc([...STANDARD_FPS, ...real].filter(Boolean)).map((fps) => ({ fps, oor: !real.has(fps) }));
    },
    // Real streams to pick a bitrate from, plus the re-encode needed (null when nothing is out of range).
    remuxStreams(pool, height, fps) {
      const src = sourceFor(pool, height, fps);
      const streams = pool.filter((f) => f.height === src.height && f.fps === src.fps).sort(byKbpsDesc);
      const transform = height !== src.height || fps !== src.fps ? { height, fps } : null;
      return { streams, transform };
    },
    VIDEO_TARGETS,
    AUDIO_TARGETS,
    videoPool,
    audioPool,
    videoGroups: (p) => groupsFor(keysOf(p.video, videoRank), p.video, VIDEO_TARGETS),
    // Audio format groups. Originals are limited to streams that fit the selected video's container.
    // Remux/Convert audio formats are always listed; with a video selected they're marked "audio only",
    // because picking one switches Video to None (the window does that).
    audioGroups(p, videoValue, videoNone) {
      const v = parseChoice(videoValue);
      const fit = !videoNone && v.kind === 'remux' ? MERGE_AUDIO[v.ext] : () => true;
      const originals = keysOf(p.audio.filter(fit), audioRank).map((k) => ({ value: k, label: k }));
      const groups = groupsFor([], p.audio, AUDIO_TARGETS);
      if (!videoNone) for (const g of groups) g.group += ' · audio only';
      const best = videoNone && p.audio.length ? [{ group: 'Best', items: BEST_ITEMS }] : [];
      return [...best, ...groups, { group: 'Original', items: originals }].filter((g) => g.items.length);
    },
    resolutionsIn: (pool) => unique(pool.map((f) => f.height)).sort((a, b) => (b || 0) - (a || 0)),
    fpsIn: (pool, height) => unique(pool.filter((f) => f.height === height).map((f) => f.fps)).sort((a, b) => (b || 0) - (a || 0)),
    bitratesIn: (pool, height, fps) => pool.filter((f) => f.height === height && f.fps === fps).sort(byKbpsDesc),
    sampleRatesIn: (pool) => unique(pool.map((f) => f.asr)).sort((a, b) => (b || 0) - (a || 0)),
    audioBitratesIn: (pool, asr) => pool.filter((f) => f.asr === asr).sort(byKbpsDesc),

    /**
     * What to download and what to do afterwards.
     * Returns { videoId, audioId, merge, post } where post is null, { type: 'remux', ext } or { type: 'convert', preset, ext }.
     */
    planDownload(videoValue, v, audioValue, a, transform = null) {
      const vc = parseChoice(videoValue);
      const ac = parseChoice(audioValue);
      if (v) {
        const t = vc.kind === 'original' ? null : target(VIDEO_TARGETS, vc.ext);
        const audio = v.hasAudio || (t && t.noAudio) ? null : a;
        const plan = { videoId: v.id, audioId: audio ? audio.id : null, merge: null, post: null };
        if (vc.kind === 'original') plan.merge = api.mergeContainer(v, audio);
        else if (vc.kind === 'remux' && transform) {
          // Out-of-range resolution / FPS: download, then re-encode into the remux container.
          if (audio) plan.merge = 'mkv';
          plan.post = { type: 'reencode', ext: vc.ext, height: transform.height, fps: transform.fps };
        } else if (vc.kind === 'remux') {
          if (audio) plan.merge = vc.ext; // pools only allow streams that fit this container
          else if (v.ext !== vc.ext) plan.post = { type: 'remux', ext: vc.ext };
        } else {
          // Convert: re-encoded with the Converter preset; any resolution / fps (transform) is applied there.
          if (audio) plan.merge = 'mkv';
          plan.post = { type: 'convert', preset: t.preset, ext: vc.ext };
          // Any set field of transform (height, fps, videoKbps, audioKbps) is passed to the Converter.
          if (transform) {
            for (const k of ['height', 'fps', 'videoKbps', 'audioKbps', 'sampleRate']) if (transform[k] != null) plan.post[k] = transform[k];
          }
        }
        return plan;
      }
      if (!a) return null;
      const plan = { videoId: null, audioId: a.id, merge: null, post: null };
      if (ac.kind === 'remux') plan.post = { type: 'remux', ext: ac.ext };
      if (ac.kind === 'best') plan.post = { type: 'best', ext: ac.ext === 'mp3' ? 'mp3' : 'flac' };
      if (ac.kind === 'convert') {
        plan.post = { type: 'convert', preset: target(AUDIO_TARGETS, ac.ext).preset, ext: ac.ext };
        if (transform && transform.audioKbps) plan.post.audioKbps = transform.audioKbps;
        if (transform && transform.sampleBits && LOSSLESS.includes(ac.ext)) plan.post.sampleBits = transform.sampleBits;
        if (transform && transform.sampleRate) plan.post.sampleRate = transform.sampleRate;
      }
      return plan;
    },
    sizeOf,
    bestSource,
    bestOutcome,
    BEST_ITEMS,
    videoKeys: (p) => keysOf(p.video, videoRank),
    resolutions: (p, key) => unique(p.video.filter((f) => f.key === key).map((f) => f.height)).sort((a, b) => (b || 0) - (a || 0)),
    fpsList: (p, key, height) => unique(p.video.filter((f) => f.key === key && f.height === height).map((f) => f.fps)).sort((a, b) => (b || 0) - (a || 0)),
    videoBitrates: (p, key, height, fps) => p.video.filter((f) => f.key === key && f.height === height && f.fps === fps).sort(byKbpsDesc),
    audioKeys: (p) => keysOf(p.audio, audioRank),
    sampleRates: (p, key) => unique(p.audio.filter((f) => f.key === key).map((f) => f.asr)).sort((a, b) => (b || 0) - (a || 0)),
    audioBitrates: (p, key, asr) => p.audio.filter((f) => f.key === key && f.asr === asr).sort(byKbpsDesc),

    // Starting choice: MP4/H.264 (plays everywhere) if offered, else the best format;
    // audio that merges cleanly with it (AAC for MP4, Opus for WebM).
    defaultVideoKey(p) {
      const keys = api.videoKeys(p);
      return keys.find((k) => /^MP4 · H\.264$/.test(k)) || keys[0] || null;
    },
    matchingAudioKey(p, videoKey) {
      const keys = api.audioKeys(p);
      if (!keys.length) return null;
      // Audio only: the uploader's original file when there is one.
      if (!videoKey) { const orig = p.audio.find((f) => f.original); if (orig) return orig.key; }
      const ext = (videoKey || '').split(' · ')[0];
      const want = ext === 'WEBM' ? /Opus/ : /AAC/;
      return keys.find((k) => want.test(k)) || keys[0];
    },

    // Container yt-dlp should merge into: MP4 for H.264/H.265/AV1 + AAC, WebM for VP9/AV1 + Opus, else MKV.
    mergeContainer(v, a) {
      if (!v || !a) return null;
      if (v.ext === 'mp4' && /AAC|MP3/.test(a.codec)) return 'mp4';
      if (v.ext === 'webm' && /Opus|Vorbis/.test(a.codec)) return 'webm';
      return 'mkv';
    },

    // Resolution · FPS · total bitrate for the card's tech line.
    techLine(v, a, transform = null) {
      if (v && transform) {
        const h = transform.height || v.height;
        const w = v.width && v.height ? Math.round((v.width * h) / v.height / 2) * 2 : null;
        // Re-encoding: the output bitrate is only known when one was chosen (audio: chosen, else the source's).
        const audioKbps = transform.audioKbps || (a && !v.hasAudio ? a.kbps || 0 : 0);
        const kbps = transform.videoKbps ? transform.videoKbps + audioKbps : null;
        return { resolution: w ? `${w}x${h}` : `${h}p`, fps: `${transform.fps || v.fps} fps`, bitrate: api.formatKbps(kbps) };
      }
      const kbps = (v ? v.kbps || 0 : 0) + (a && !(v && v.hasAudio) ? a.kbps || 0 : 0);
      return {
        resolution: v && v.width && v.height ? `${v.width}x${v.height}` : null,
        fps: v && v.fps ? `${v.fps} fps` : null,
        bitrate: api.formatKbps(kbps),
      };
    },

    formatKbps(kbps) {
      if (!num(kbps)) return null;
      return kbps >= 1000 ? `${(kbps / 1000).toFixed(1).replace(/\.0$/, '')} Mbps` : `${Math.round(kbps)} kbps`;
    },
    formatBytes(size) {
      if (!size || !num(size.bytes)) return '';
      const units = ['B', 'KB', 'MB', 'GB'];
      let b = size.bytes;
      let i = 0;
      while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
      return `${size.estimated ? '≈ ' : ''}${b.toFixed(b < 10 && i > 1 ? 1 : 0)} ${units[i]}`;
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Formats = api;
})(typeof window !== 'undefined' ? window : this);
