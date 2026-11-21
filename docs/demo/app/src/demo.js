// Interface demo: stands in for Nabbit's Electron backend (preload.js → main.js) with sample data, so every
// screen can be clicked through in a browser. Nothing is downloaded or converted; jobs only animate.
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const on = {}; // event name → listeners
  const listen = (name) => (cb) => { (on[name] ||= []).push(cb); };
  const emit = (name, data) => (on[name] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } });
  let st = { isWindows: true, version: '0.1.0', startWithWindows: true, startMinimized: false, closeToTray: true, shellMenu: true,
    downloadDir: 'C:\\Users\\you\\Downloads', hwAccel: 'cuda', theme: 'dark', blurNow: true, extClients: [{ name: 'Firefox' }] };
  try { const t = localStorage.getItem('nabbit-demo-theme'); if (t) st.theme = t; } catch {}
  // ?solid: no window blur (for screenshots); ?light: light theme.
  if (/solid/.test(location.search)) st.blurNow = false;
  if (/light/.test(location.search)) st.theme = 'light';

  // Fake jobs: progress over a few seconds with status lines, then "done".
  let jobN = 0;
  const jobs = new Map();
  function fakeJob(title, outputs, steps) {
    const id = 'demo' + ++jobN;
    const job = { cancelled: false };
    jobs.set(id, job);
    setTimeout(() => emit('job-added', { id, title }), 0);
    (async () => {
      await wait(150);
      const total = 3200 + Math.random() * 2200, t0 = performance.now();
      let si = -1;
      while (!job.cancelled) {
        const p = Math.min(100, ((performance.now() - t0) / total) * 100);
        const s = Math.min(steps.length - 1, Math.floor((p / 100) * steps.length));
        if (s !== si) { si = s; emit('status', { id, text: steps[s] }); emit('log', { id, line: `> ${steps[s]}` }); }
        emit('progress', { id, percent: p });
        if (p >= 100) break;
        await wait(120);
      }
      emit('done', job.cancelled ? { id, ok: false, error: 'Cancelled' } : { id, ok: true, output: outputs[0], outputs });
    })();
    return id;
  }

  const covers = (i) => `demo/cover${i % 6}.jpg`;
  const songs = ['Intro (Headlights)', 'Night Drive', 'Overpass', 'Neon Static', 'Exit 47', 'Afterglow'];
  const audioFormats = () => Formats.parseFormats({ duration: 271, formats: [
    { format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, asr: 44100, filesize: 4380000 },
    { format_id: '251', ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 141, asr: 48000, filesize: 4700000 }] });

  const api = {
    // ----- app / window -----
    settingsGet: async () => st,
    settingsSet: async (p) => { st = { ...st, ...p }; emit('settings', st); return st; },
    getTheme: async () => st.theme,
    setTheme: async (t) => { st.theme = t; try { localStorage.setItem('nabbit-demo-theme', t); } catch {} return t; },
    windowTitle: async () => 'Nabbit',
    winControl: async (a) => ({ filled: a === 'max' }),
    defaultFolder: async () => st.downloadDir,
    pickFolder: async () => st.downloadDir,
    pickFile: async () => 'demo/clip.mp4',
    pickFiles: async () => ['C:\\Users\\you\\Videos\\holiday 4k.mov', 'C:\\Users\\you\\Music\\interview.wav'],
    pathForFile: (f) => (f && f.name) || 'demo/clip.mp4',
    openExternal: async () => null, showItem: async () => null, extForget: async () => null,

    // ----- video downloader -----
    videoInfo: async () => { await wait(900); return { ...window.DEMO_INFO, thumbnail: 'demo/thumb.jpg', thumbnails: [{ url: 'demo/thumb.jpg', width: 1280, height: 720, ext: 'jpg', label: '1280x720' }] }; },
    cancelVideoInfo: async () => null,
    runJob: async (type, opts, title) => {
      const name = (opts && (opts.input || opts.url) || 'file').split(/[\\/]/).pop();
      const steps = {
        download: ['Downloading video · 2160p VP9', 'Downloading audio · Opus 141 kbps', 'Merging', 'Writing tags and thumbnail'],
        compress: ['Finding the best resolution for this size', 'Compressing video · libx265 · pass 1', 'Compressing video · libx265 · pass 2'],
        trim: ['Cutting at keyframes', 'Joining segments'],
      }[type] || ['Converting', 'Finishing'];
      const out = opts && opts.input ? opts.input.replace(/(\.[^.\\/]+)$/, type === 'compress' ? '_small$1' : '_edit$1') : `C:\\Users\\you\\Downloads\\${name}`;
      return { id: fakeJob(title || `${type} · ${name}`, [out], steps) };
    },
    cancelJob: async (id) => { const j = jobs.get(id); if (j) j.cancelled = true; },

    // ----- music downloader & player -----
    musicSearch: async (q, type) => {
      await wait(500);
      if (type === 'songs') return songs.map((t, i) => ({ type: 'songs', title: t, artist: 'Studio B', album: 'Night Drive', year: 2024, duration: 180 + i * 31, url: 'song' + i, thumbnail: covers(0) }));
      if (type === 'artists') return [{ type: 'artists', title: 'Studio B', subs: '1.2M monthly audience', url: 'artist', thumbnail: covers(4) }];
      return [
        { type: 'albums', kind: 'Album', title: 'Night Drive', artist: 'Studio B', year: 2024, url: 'album0', tracks: 6, thumbnail: covers(0) },
        { type: 'albums', kind: 'Album', title: 'Overpass Tapes', artist: 'Studio B', year: 2023, url: 'album1', tracks: 9, thumbnail: covers(1) },
        { type: 'albums', kind: 'Single', title: 'Neon Static', artist: 'Studio B', year: 2023, url: 'album2', tracks: 1, thumbnail: covers(2) },
        { type: 'albums', kind: 'EP', title: 'Exit Signs', artist: 'Studio B', year: 2022, url: 'album3', tracks: 4, thumbnail: covers(3) },
        { type: 'albums', kind: 'Playlist', title: 'Nightdrive Session 02', artist: 'B-Side Radio', url: 'album4', tracks: 24, thumbnail: covers(5) }];
    },
    musicInfo: async (url) => {
      await wait(400);
      const n = Number(String(url).replace(/\D/g, '')) || 0;
      if (/song|watch/.test(url)) return { kind: 'song', info: { title: songs[n % 6], uploader: 'Studio B', artist: 'Studio B', album: 'Night Drive', thumbnail: covers(0), duration: 271, webpageUrl: 'https://music.youtube.com/watch?v=demo' + n, formats: audioFormats() } };
      return { kind: 'album', album: { thumbnail: covers(n), title: ['Night Drive', 'Overpass Tapes', 'Neon Static', 'Exit Signs', 'Nightdrive Session 02'][n % 5], artist: 'Studio B', count: 6, year: 2024, duration: 1500,
        webpageUrl: 'https://music.youtube.com/playlist?list=demo' + n, entries: songs.map((t, i) => ({ index: i + 1, title: t, duration: 180 + i * 31, url: 'https://music.youtube.com/watch?v=song' + i })) } };
    },
    musicArtist: async () => ({ provider: 'ytmusic', name: 'Studio B', subs: '1.2M monthly audience', url: 'https://music.youtube.com/channel/demo', thumbnail: covers(4),
      description: 'Night-time synth duo making long drives longer: two analog synths, one drum machine and a lot of motorway.',
      sections: [
        { title: 'Top songs', kind: 'songs', items: songs.map((t, i) => ({ type: 'songs', title: t, album: 'Night Drive', year: '2024', duration: 180 + i * 31, url: 'song' + i, thumbnail: covers(0) })) },
        { title: 'Albums', kind: 'tiles', items: ['Night Drive', 'Overpass Tapes', 'Neon Static', 'Exit Signs'].map((t, i) => ({ type: 'albums', kind: 'Album', title: t, year: String(2024 - i), url: 'album' + i, thumbnail: covers(i) })) }] }),
    musicSource: async () => [{ id: '140', ext: 'm4a', codec: 'AAC', original: false, asr: 44100, kbps: 129 }, { id: '251', ext: 'webm', codec: 'Opus', original: false, asr: 48000, kbps: 141 }],
    musicBetter: async () => null,
    musicFindYtm: async () => null,
    streamOpen: async (url, q, o = {}) => { await wait(300); return { key: 'k' + url, src: 'demo/track.mp3', cached: true, meta: { duration: 40, ...(o.meta || {}) } }; },
    streamPrefetch: async () => null, streamWarm: async () => true,
    streamCacheInfo: async () => ({ files: 12, bytes: 61e6 }), streamCacheClear: async () => ({ files: 0, bytes: 0 }),
    streamLyrics: async () => ({ synced: '[00:00.50] Headlights on the overpass\n[00:04.00] Counting exits in the rain\n[00:08.00] Night drive, night drive\n[00:12.00] Neon static on the windscreen\n[00:16.00] Nowhere left to be\n[00:20.00] Night drive, night drive\n[00:24.00] Afterglow' }),

    // ----- converter -----
    convPresets: async () => window.DEMO_PRESETS,
    convResetPresets: async () => window.DEMO_PRESETS,
    convEditPresets: async () => null,
    convEngine: async () => ({ ffmpeg: 'ffmpeg 7.1 (NVENC, AMF, SVT-AV1)', ghostscript: true }),

    // ----- trimmer -----
    trimProbe: async () => ({ duration: 12, size: 2.35e6, fps: 30, width: 640, height: 360, hasVideo: true, format: 'mp4', tracks: [
      { index: 0, type: 'video', codec: 'H.264', label: 'V · H.264 360p', on: true }, { index: 1, type: 'audio', label: 'A1 · AAC stereo', on: true },
      { index: 2, type: 'subtitle', label: 'S1 · MOV_TEXT en', on: true }] }),
    trimKeyframes: async () => [0, 2, 4, 6, 8, 10],
    trimWaveform: async (f, n) => Array.from({ length: n }, (_, i) => Math.min(1, 0.25 + 0.55 * Math.abs(Math.sin(i * 0.045) * Math.cos(i * 0.011)) + 0.1 * Math.random())),
    trimScrubAudio: async () => {
      const r = 22050, n = r * 12, b = new Uint8Array(n * 2), v = new DataView(b.buffer);
      for (let i = 0; i < n; i++) { const t = i / r; v.setInt16(i * 2, (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) * 3000, true); }
      return { rate: r, data: b };
    },
    trimSnapshot: async () => 'demo/clip_00-00-04_000.jpg',
    trimPreview: async () => null,

    // ----- compressor -----
    cpScan: async () => { await wait(300); return [
      { path: 'C:\\Users\\you\\Videos\\holiday 4k.mov', name: 'holiday 4k.mov', kind: 'video', size: 812e6, duration: 214, width: 3840, height: 2160, fps: 60 },
      { path: 'C:\\Users\\you\\Pictures\\IMG_2041.heic', name: 'IMG_2041.heic', kind: 'image', size: 3.4e6, width: 4032, height: 3024 },
      { path: 'C:\\Users\\you\\Music\\interview.wav', name: 'interview.wav', kind: 'audio', size: 96e6, duration: 545 },
      { path: 'C:\\Users\\you\\Pictures\\reaction.gif', name: 'reaction.gif', kind: 'gif', size: 14e6, duration: 6, width: 480, height: 270 },
      { path: 'C:\\Users\\you\\Documents\\contract scan.pdf', name: 'contract scan.pdf', kind: 'pdf', size: 22e6 }]; },
    cpSize: async (p) => (/holiday/.test(p) ? 9.62e6 : /IMG/.test(p) ? 0.41e6 : /interview/.test(p) ? 8.6e6 : /reaction/.test(p) ? 0.9e6 : 3.1e6),

    // ----- events -----
    onSettings: listen('settings'), onProgress: listen('progress'), onDone: listen('done'), onStatus: listen('status'), onLog: listen('log'),
    onJobAdded: listen('job-added'),
  };
  window.api = new Proxy(api, { get: (o, k) => (k in o ? o[k] : String(k).startsWith('on') ? () => {} : async () => null) });

  // Open every tool mid-use: a video card, two files in the converter, a clip in the trimmer, a compressor queue.
  window.addEventListener('load', () => setTimeout(async () => {
    try {
      addFiles(['C:\\Users\\you\\Videos\\holiday 4k.mov', 'C:\\Users\\you\\Videos\\city lights.mkv']);
      window.Trimmer && window.Trimmer.open('demo/clip.mp4');
      window.CompressorUI && (await window.CompressorUI.add(['C:\\Users\\you\\Videos']));
      document.querySelector('.tab[data-tool="download"][data-mode="video"]').click();
      const url = document.getElementById('dl-url');
      url.value = 'https://www.youtube.com/watch?v=Xk3m9pLdEmo';
      document.getElementById('dl-form').requestSubmit();
    } catch (e) { console.error(e); }
  }, 300));
})();
