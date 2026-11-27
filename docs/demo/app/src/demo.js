// Interface demo: stands in for Nabbit's Electron backend (preload.js → main.js) with sample data, so every
// screen can be clicked through in a browser. Nothing is downloaded or converted; jobs only animate.
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const on = {}; // event name → listeners
  const listen = (name) => (cb) => { (on[name] ||= []).push(cb); };
  const emit = (name, data) => (on[name] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } });
  let st = { slskUser: 'nabbit_demo', slskHasPassword: true, slskPort: 2234, slskOnline: true, isWindows: true, version: '0.2.0', startWithWindows: true, startMinimized: false, closeToTray: true, shellMenu: true,
    downloadDir: 'C:\\Users\\you\\Videos\\Nabbit\\Videos', saveLayout: 'nabbit', discordMode: 'songs', discordPicture: 'mine', discordAppId: '', discordAlbum: true, discordTime: true, discordPlay: true, discordHasApp: true, discordConnected: true, discordExact: true, hwAccel: 'cuda', theme: 'dark', blurNow: true, extClients: [{ name: 'Firefox' }] };
  try { const t = localStorage.getItem('nabbit-demo-theme'); if (t) st.theme = t; } catch {}
  // Nabbit Home: some songs already played (Listen again, On repeat), the first time the demo opens.
  try {
    if (!localStorage.getItem('nabbit.plays')) {
      const M = 'C:\\Users\\you\\Music\\', day = Math.floor(Date.now() / 86400000), plays = {};
      const add = (p, n, hoursAgo) => { plays[`p:${M}${p}`] = { n, last: Date.now() - hoursAgo * 3600000, hits: Array.from({ length: n }, (_, i) => day - (i % 25)) }; };
      add('Studio B\\Night Drive\\03 Neon Static.flac', 9, 1);
      add('Hollow Arcade\\Paper Planes\\02 Static Bloom.flac', 7, 3);
      add('Glass Harbor\\Tidewater\\02 Lighthouse Keeper.flac', 4, 20);
      add('Hollow Arcade\\Lantern Season\\03 Low Orbit.flac', 3, 30);
      add('Studio B\\Night Drive\\02 Overpass.flac', 2, 48);
      localStorage.setItem('nabbit.plays', JSON.stringify(plays));
    }
  } catch { /* none */ }
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

  let slskPrefs = { ...window.SlskSearch.DEFAULT_PREFS };
  let slskSess = null;
  function slskEmit() {
    const S = window.SlskSearch, sess = slskSess;
    const view = sess.mode === 'songs' ? S.songView(sess.answers, slskPrefs, sess.target) : S.albumView(sess.answers, slskPrefs, sess.target);
    emit('slsk-view', { id: sess.id, mode: sess.mode, items: view, total: view.length, users: sess.answers.length, status: sess.done ? '' : `Searching “${S.buildQueries(sess.target, sess.mode)[0]}”…`, done: sess.done });
  }
  const covers = (i) => `demo/cover${i % 6}.jpg`;
  const songs = ['Intro (Headlights)', 'Night Drive', 'Overpass', 'Neon Static', 'Exit 47', 'Afterglow'];
  const audioFormats = () => Formats.parseFormats({ duration: 271, formats: [
    { format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, asr: 44100, filesize: 4380000 },
    { format_id: '251', ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 141, asr: 48000, filesize: 4700000 }] });

  const demoStems = [
    { id: 'kim-vocal-2', name: 'Kim Vocal 2', kind: 'mdx', size: 63.7e6, installed: true, stems: ['Vocals', 'Instrumental'], note: 'Recommended: the fastest, and the cleanest vocals and instrumental (by Kimberley Jensen).' },
    { id: 'htdemucs', name: 'Demucs v4 · 4 stems', kind: 'htdemucs', size: 170e6, installed: true, stems: ['vocals', 'drums', 'bass', 'other', 'instrumental'], note: 'Vocals, drums, bass and other (and the instrumental: all but the vocals). For drums and bass; slower.' },
    { id: 'mdx-inst-hq3', name: 'UVR-MDX-NET Inst HQ 3', kind: 'mdx', size: 63.7e6, installed: false, stems: ['Instrumental', 'Vocals'], note: 'Instrumental and vocals: very clean instrumentals.' },
    { id: 'mdx-voc-ft', name: 'UVR-MDX-NET Voc FT', kind: 'mdx', size: 63.7e6, installed: false, stems: ['Vocals', 'Instrumental'], note: 'Vocals and instrumental: clean vocals, for acapellas.' },
    { id: 'mdx-kara-2', name: 'UVR-MDX-NET Karaoke 2', kind: 'mdx', size: 50.3e6, installed: false, stems: ['Instrumental', 'Vocals'], note: 'Takes the lead vocal out and keeps the backing vocals. Best run on a vocals stem.' },
  ];
  const api = {
    // ----- app / window -----
    settingsGet: async () => st,
    settingsSet: async (p) => { st = { ...st, ...p }; emit('settings', st); return st; },
    getTheme: async () => st.theme,
    setTheme: async (t) => { st.theme = t; try { localStorage.setItem('nabbit-demo-theme', t); } catch {} return t; },
    windowTitle: async () => 'Nabbit',
    winControl: async (a) => ({ filled: a === 'max' }),
    defaultFolder: async () => st.downloadDir,
    musicFolder: async () => 'C:\\Users\\you\\Music\\Nabbit\\Music',
    nabbitFolders: async () => [
      ...['Music', 'Masters', 'Stems', 'Converted', 'Trimmed', 'Compressed', 'Pitch and Tempo'].map((n) => ({ group: 'Music', label: n, dir: `C:\\Users\\you\\Music\\Nabbit\\${n}` })),
      ...['Videos', 'Converted', 'Trimmed', 'Compressed', 'Frames'].map((n) => ({ group: 'Videos', label: n, dir: `C:\\Users\\you\\Videos\\Nabbit\\${n}` })),
      { group: 'Documents', label: 'Misc', dir: 'C:\\Users\\you\\Documents\\Nabbit\\Misc' },
    ],
    nabbitFolderOpen: async () => true,
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
        master: ['Mastering · Stereo → Spectral → EQ → Clipper', 'Encoding FLAC · 24-bit'],
        quick: ['Downloading video', 'Downloading audio', 'Merging'],
        stems: ['Reading the audio', 'Splitting · Demucs v4 · 4 stems · GPU', 'Saving Vocals', 'Saving Drums', 'Saving Bass', 'Saving Other'],
      }[type] || ['Converting', 'Finishing'];
      if (type === 'stems') {
        const noExt = opts.input.replace(/\.[^.\\/]+$/, ''), base = noExt.split(/[\\/]/).pop();
        const dir = opts.outDir ? `${opts.outDir}\\${base}` : noExt;
        const outs = (opts.outputs && opts.outputs.length ? opts.outputs : ['vocals', 'drums', 'bass', 'other', 'instrumental']).map((n) => `${dir} - stems\\${base} (${n[0].toUpperCase()}${n.slice(1)}).${opts.format || 'wav'}`);
        return { id: fakeJob(title, outs, steps) };
      }
      const out = type === 'master' ? 'C:\\Users\\you\\Music\\Night Drive (master).flac'
        : opts && opts.input ? opts.input.replace(/(\.[^.\\/]+)$/, type === 'compress' ? '_small$1' : '_edit$1') : `C:\\Users\\you\\Downloads\\${name}`;
      return { id: fakeJob(title || `${type} · ${name}`, [out], steps) };
    },
    cancelJob: async (id) => { const j = jobs.get(id); if (j) j.cancelled = true; },

    // ----- recent downloads box + batch -----
    recentList: async () => {
      const now = Date.now(), m = 60000;
      return [
        ['Neon Static (official video).mp4', 412e6, 2 * m], ['Night Drive (live at Overpass).mp4', 1.1e9, 14 * m], ['Studio B - Neon Static.flac', 38e6, 40 * m],
        ['Overpass Tapes · trailer.webm', 96e6, 65 * m], ['Interview · B-Side Radio.m4a', 48e6, 3 * 60 * m], ['holiday 4k_small.mp4', 210e6, 26 * 60 * m],
        ['city lights_edit.mkv', 620e6, 30 * 60 * m], ['Night Drive (master).flac', 41e6, 50 * 60 * m],
      ].map(([name, size, age]) => ({ path: 'C:\\Users\\you\\Downloads\\' + name, name, size, at: now - age, exists: true, title: name, url: /\.(mp4|webm)$/.test(name) ? 'https://www.youtube.com/watch?v=demo' : null }));
    },
    recentRemove: async () => true, recentClear: async () => true, recentTrash: async () => true,
    recentOpen: async () => '', recentFolder: async () => '', recentThumb: async () => null, recentDrag: () => {},
    onRecentChanged: () => {},
    // ----- Player mode library -----
    libGet: async () => {
      const A = [
        ['Hollow Arcade', 'Paper Planes', 2006, ['First Light', 'Static Bloom', 'Afterglow', 'Hold the Wheel', 'Copper Wire', 'Northbound', 'Cassette Summer', 'Interlude (Tunnel)', 'Ferris Lights', 'Paper Planes']],
        ['Hollow Arcade', 'Lantern Season', 2008, ['Overture', 'Glasswork', 'Low Orbit', 'Saltwater Clocks', 'Harbor Gate', 'Neon Choir', 'Driftwood', 'Signal Fire']],
        ['Studio B', 'Night Drive', 2024, ['Intro (Overpass)', 'Overpass', 'Neon Static', 'Exit Signs', 'Outro (Morning)']],
        ['Glass Harbor', 'Tidewater', 2019, ['Low Tide', 'Lighthouse Keeper', 'Salt', 'Undertow', 'Breakwater', 'High Tide']],
      ];
      const tracks = [];
      let k = 0;
      for (const [artist, album, year, titles] of A) titles.forEach((title, i) => tracks.push({
        path: `C:\\Users\\you\\Music\\${artist}\\${album}\\${String(i + 1).padStart(2, '0')} ${title}.flac`, ext: 'flac', title, artist: title === 'Exit Signs' ? 'Studio B;Glass Harbor;Hollow Arcade' : artist, albumArtist: artist, album, track: i + 1, disc: 1, year,
        duration: 150 + ((k++ * 37) % 150), codec: 'FLAC', rate: album === 'Night Drive' ? 48000 : 44100, bits: 16, kbps: 900 + (k * 13) % 200, channels: 2,
        hasCover: true, hasLyrics: title === 'Static Bloom', playable: true, size: 3e7, mtime: Date.now() - k * 86400000 * 3,
        rating: title === 'Static Bloom' ? 5 : title === 'Afterglow' ? 4 : 0, loved: title === 'Static Bloom',
      }));
      // A music video beside one song (same name): the cover's Video toggle shows it.
      const ns = tracks.find((t) => t.title === 'Neon Static');
      tracks.push({ ...ns, path: ns.path.replace(/\.flac$/, '.mp4'), ext: 'mp4', codec: 'AAC', hasVideo: true, rating: 0, loved: false, track: 0, album: '' });
      return { folders: ['C:\\Users\\you\\Music', 'C:\\Users\\you\\Downloads'], tracks, scanning: false };
    },
    libScan: async () => true, libAddFolder: async () => null, libRemoveFolder: async () => ['C:\\Users\\you\\Music'],
    libRate: async (_p, o) => o,
    libCover: async (p) => { const al = ['Paper Planes', 'Lantern Season', 'Night Drive', 'Tidewater'].findIndex((a) => String(p).includes(`\\${a}\\`)); return al < 0 ? null : covers(al + 1); },
    mediaUrl: async () => 'demo/track.mp3',
    // A drum-loop-like envelope at 120 BPM (a hit every half second, from 0.1 s), 5 ms steps.
    ptWave: async () => { const n = 40 * 200, peaks = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / 200, ph = ((t - 0.1) % 0.5 + 0.5) % 0.5; peaks[i] = 0.08 + 0.8 * Math.exp(-ph / 0.06) * (Math.floor((t - 0.1) / 0.5) % 4 === 0 ? 1 : 0.6); } return { rate: 200, peaks }; },
    // Player → sources: SoundCloud signed in (sample home), YouTube Music signed out.
    scAccount: async () => ({ signedIn: true, name: 'you' }),
    scHome: async () => ({ account: { signedIn: true, name: 'you' }, sections: [
      { title: 'Made for you', kind: 'tiles', items: ['Weekly Wave', 'Daily Drops', 'Your Mix 1', 'Your Mix 2', 'Discover Station'].map((t, i) => ({ type: 'playlists', kind: 'Mix', title: t, artist: 'SoundCloud', url: `https://soundcloud.com/discover/sets/${i}` })) },
      { title: 'From your feed', kind: 'songs', items: Array.from({ length: 12 }, (_, i) => ({ type: 'songs', title: `Feed song ${i + 1}`, artist: `Artist ${i + 1}`, url: `https://soundcloud.com/a/s${i}`, duration: 150 + i * 7 })) },
      { title: 'Your likes', kind: 'songs', items: Array.from({ length: 5 }, (_, i) => ({ type: 'songs', title: `Liked ${i + 1}`, artist: 'Someone', url: `https://soundcloud.com/b/l${i}`, duration: 200 })) },
    ] }),
    scSetTracks: async () => [{ url: 'https://soundcloud.com/a/s1', title: 'Feed song 2', artist: 'Artist 2', duration: 157 }],
    scSignIn: async () => ({ signedIn: true, name: 'you' }), scSignOut: async () => ({ signedIn: false }),
    ytmAccount: async () => ({ signedIn: false }), ytmSignIn: async () => null, ytmSignOut: async () => ({ signedIn: false }),
    ytmHome: async () => { throw new Error('signed-out'); }, ytmSetTracks: async () => [],
    discLastfm: async (period) => ({ on: true, period, user: 'you', scrobbles: 48213, since: 1546300800, artists: 2310, top: [{ name: 'Neon Tide', plays: 812 }, { name: 'Glass Harbor', plays: 403 }, { name: 'Moth Radio', plays: 120 }] }),
    discSeeds: async () => [{ name: 'Glass Harbor', weight: 20 }, { name: 'Hollow Arcade', weight: 30 }, { name: 'Studio B', weight: 8 }],
    discArtist: async ({ name }) => { await new Promise((r) => setTimeout(r, 200)); const pool = ['Neon Tide', 'Paper Lanterns', 'Night Ferry', 'Low Orbit', 'Velvet Static', 'Cold Spring', 'Moth Radio', 'Silver Coast', 'Dune Club', 'Echo Park', 'Slow Fauna', 'Tin Garden'];
      let x = [...name].reduce((a, c) => a + c.charCodeAt(0), 0); const rel = []; for (let i = 0; i < 7; i++) { x = (x * 31 + 7) % 997; rel.push({ name: pool[x % pool.length], url: null, thumbnail: `https://picsum.photos/seed/${encodeURIComponent(pool[x % pool.length])}/120` }); }
      return { name, url: null, thumbnail: null, subs: '1.2M monthly audience', stats: { yourPlays: 342, listeners: 1203400, plays: 22000000, tags: ['hip-hop', 'underground', 'cloud rap'] }, related: [...new Map(rel.map((r) => [r.name, r])).values()], songs: [1, 2, 3].map((i) => ({ title: `${name} song ${i}`, url: `https://music.youtube.com/watch?v=${String(i).padStart(11, 'a')}`, duration: 180 + i })) }; },
    ptMarkers: async () => [],
    // Live slicing: the demo track decoded here, cut every half beat at 120 BPM.
    ptSlices: async (_p, o = {}) => {
      const sr = o.sr || 48000, c = new OfflineAudioContext(2, sr, sr);
      const b = await c.decodeAudioData(await (await fetch('demo/track.mp3')).arrayBuffer());
      const n = b.length, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, f = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { f[2 * i] = L[i]; f[2 * i + 1] = R[i]; }
      const cuts = []; for (let t = 0.1; t * sr < n; t += 0.25) cuts.push(Math.round(t * sr));
      return { sr, pcm: o.noPcm ? null : new Uint8Array(f.buffer), cuts, markers: 0 };
    },
    playFilesInfo: async (paths) => paths.map((p) => { const name = p.split(/[\\/]/).pop(); const ext = (name.split('.').pop() || '').toLowerCase();
      return { path: p, ext, title: name.replace(/\.[^.]+$/, ''), artist: '', album: '', duration: 62.7, playable: true, hasCover: false, size: 3e7, mtime: Date.now() }; }),
    lastfmStatus: async () => ({ key: '', hasSecret: false, user: '', on: true, love: true, pending: 0, connecting: false }),
    lastfmKeys: async () => { throw new Error('Not in the demo.'); }, lastfmConnect: async () => { throw new Error('Not in the demo.'); },
    lastfmCancel: async () => ({}), lastfmDisconnect: async () => ({}), lastfmSet: async (o) => ({ key: '', hasSecret: false, user: '', on: o.on !== false, love: o.love !== false, pending: 0 }),
    lastfmNow: async () => false, lastfmScrobble: async () => false, lastfmLove: async () => false, onLastfmStatus: () => {},
    plGet: async () => { try { return JSON.parse(localStorage.getItem('demo.playlists') || '[]'); } catch { return []; } },
    plSet: async (list) => { localStorage.setItem('demo.playlists', JSON.stringify(list)); return list; },
    wavePeaks: async (p) => Array.from({ length: 1200 }, (_, i) => Math.min(1, 0.25 + 0.55 * Math.abs(Math.sin(i / 37 + p.length)) * (0.6 + 0.4 * Math.sin(i / 7)) ** 2)),
    // Share links: pretend Tailscale Funnel is on (nothing leaves the browser).
    ...(() => {
      let list = [], on = false, hours = 24;
      const st = () => ({ state: on ? 'on' : 'off', host: 'my-pc.tail1234.ts.net', enableUrl: '', error: '', on, hours,
        list: list.map((x) => ({ ...x, exists: true, embeds: /\.(mp4|webm|mov|m4v)$/i.test(x.path), url: on ? `https://my-pc.tail1234.ts.net/nabbit/v/${x.token}` : '' })) });
      const make = (path) => { const token = Math.random().toString(36).slice(2, 13) + Math.random().toString(36).slice(2, 13); list.unshift({ token, path, title: path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), created: Date.now(), expires: hours ? Date.now() + hours * 3600e3 : 0, views: 0 }); on = true; return { token, url: `https://my-pc.tail1234.ts.net/nabbit/v/${token}`, copied: true, embeds: /\.(mp4|webm|mov|m4v)$/i.test(path) }; };
      return {
        shareStatus: async () => st(), shareSet: async (o) => { if (o.on !== undefined) on = !!o.on; if (o.hours !== undefined) hours = o.hours; return st(); },
        shareEnable: async () => {}, shareGetTailscale: async () => {}, shareCreate: async (p) => make(p), sharePick: async () => make('C:\\Users\\you\\Videos\\Clip.mp4'),
        shareCopy: async () => true, shareRevoke: async (t) => { list = list.filter((x) => x.token !== t); return st(); }, onShareStatus: () => {},
      };
    })(),
    // DJ mode: every song plays the same sample track (demo/media/track.mp3: 62.7 s, 138 BPM, first beat at
    // 0.42 s, found with analyzer.js), so its real beat grid; a made-up key per song, to show the Camelot matching.
    djAnalyze: async (p) => {
      await new Promise((r) => setTimeout(r, 400));
      const h = [...String(p)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const keys = [['8A', 'A minor'], ['9A', 'E minor'], ['8B', 'C major'], ['7A', 'D minor'], ['3B', 'D♭ major']];
      const k = keys[h % keys.length];
      const env = Array.from({ length: 80 }, (_, i) => (i >= 1 && i < 79 ? -10 + Math.sin(i) : -30));
      return { v: 2, bpm: 138, offset: 0.42, conf: 0.9, key: k[1], camelot: k[0], keyConf: 0.6, start: 0.05, end: 62.5, duration: 62.7, env, low: env };
    },
    wavePeaksStream: async () => Array.from({ length: 1200 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i / 23))),
    fxSource: async () => `${await (await fetch('../mastering.js')).text()}\n${await (await fetch('../player-core.js')).text()}\n${await (await fetch('../pitch.js')).text()}`,
    vstInfo: async () => ({ host: false, dirs: ['C:\\Program Files\\Common Files\\VST3'], plugins: [{ name: 'Demo Reverb', path: 'C:\\Program Files\\Common Files\\VST3\\Demo Reverb.vst3' }, { name: 'Demo Tape', path: 'C:\\Program Files\\Common Files\\VST3\\Demo Tape.vst3' }] }),
    vstAddFolder: async () => null,
    vstStart: async () => ({ ok: false, error: "The plugin host isn't built yet (see vsthost\\README.md)." }),
    vstLoad: async () => ({ ok: false, error: 'Not in the demo.' }),
    vstState: async () => ({ ok: false }),
    vstCmd: () => {}, vstAudio: () => {}, onVstAudio: () => {}, onVstEvent: () => {},
    libYtLoop: async () => { await wait(400); throw new Error('No music video in the demo.'); },
    streamLoop: async () => { await wait(400); throw new Error('No music video in the demo.'); },
    streamYtVideo: async (m = {}) => { await wait(900); return { id: 'demo', file: 'C:\\Users\\you\\AppData\\Local\\Temp\\nabbit-mv\\demo.mp4', title: `${m.title} (Official Music Video)`, channel: 'Demo VEVO', duration: 200 }; },
    libYtVideo: async (p, o = {}) => { await wait(900); const name = p.split('\\').pop().replace(/^\d+ |\.\w+$/g, ''); return { id: 'demo', file: 'C:\\Users\\you\\AppData\\Local\\Temp\\nabbit-mv\\demo.mp4', synced: !o.next, title: `${name} (Official Music Video)`, channel: 'Demo VEVO', duration: 200 }; },
    onLibYtProgress: () => {},
    libLyrics: async () => ({ source: 'lrclib', text: '[00:00.50]Streetlights counting down the miles\n[00:04.00]Radio hum and open skies\n[00:07.50]We were neon, we were static\n[00:11.00]Glowing out of every line' }),
    onLibChanged: () => {}, onLibProgress: () => {},
    batchResolve: async (url) => {
      await wait(600 + Math.random() * 600);
      if (/playlist|list=/.test(url)) return { playlist: 'Night Drive', items: ['Intro', 'Overpass', 'Neon Static', 'Exit Signs'].map((t, i) => ({ url: `https://www.youtube.com/watch?v=nd${i}`, title: `Studio B - ${t}`, duration: 180 + i * 41, thumbnail: null })) };
      const id = (url.match(/[?&]v=([\w-]+)/) || [])[1] || url.split('/').pop();
      return { playlist: null, items: [{ url, title: `Video ${id}`, duration: 200 + (id.length * 37) % 900, thumbnail: null }] };
    },

    // ----- music downloader & player -----
    musicSearch: async (q, type) => {
      await wait(500);
      if (type === 'songs') return songs.map((t, i) => ({ type: 'songs', title: t, artist: 'Studio B', album: 'Night Drive', year: 2024, duration: 180 + i * 31, url: 'song' + i, thumbnail: covers(0) }));
      if (type === 'artists') {
        // The sample artists whose name has what was typed (Studio B first), else Studio B.
        const pool = ['Studio B', 'Hollow Arcade', 'Glass Harbor', 'Neon Tide', 'Paper Lanterns', 'Night Ferry', 'Velvet Static', 'Moth Radio', 'Silver Coast', 'Dune Club'];
        const ql = String(q || '').toLowerCase().trim();
        const hits = pool.filter((n) => ql && n.toLowerCase().includes(ql));
        return (hits.length ? hits : ['Studio B']).slice(0, 6).map((n, i) => ({ type: 'artists', title: n, subs: `${(1.2 - i * 0.17).toFixed(1)}M monthly audience`, url: n === 'Studio B' ? 'artist' : null, thumbnail: covers(4 + i) }));
      }
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
    streamOpen: async (url, q, o = {}) => { await wait(300); return { key: 'k' + url, src: 'demo/track.mp3', cached: true, meta: { duration: 62.7, ...(o.meta || {}) } }; },
    streamPrefetch: async (url) => { await wait(200); return { key: 'k' + url, src: 'demo/track.mp3', cached: true }; }, streamWarm: async () => true,
    streamAdopt: async () => {}, streamHold: async () => {},
    djAnalyzeStream: async (key) => api.djAnalyze(String(key)),
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

    // ----- audio tools: a sample result (the real analysis runs on the file in Nabbit) -----
    edAnalyze: async (file) => {
      await wait(1400);
      const A = window.Analyzer;
      return { duration: 213, name: String(file).split(/[\\/]/).pop(),
        tempo: { bpm: 113, confidence: 0.82, offset: 0.42, half: 56.5, double: 226 },
        key: { tonic: 8, mode: 'major', name: 'Ab Major', camelot: A.camelot(8, 'major'), confidence: 0.86, tuningHz: 441,
          relative: { tonic: 5, mode: 'minor', name: 'F Minor' }, alternatives: [{ name: 'F Minor', tonic: 5, mode: 'minor' }] } };
    },
    edTags: async () => { await wait(400); return true; },
    // ----- mastering: a short made-up loop (the real app opens your song) -----
    msLoad: async (file) => {
      await wait(300);
      const sr = 44100, secs = 16, n = sr * secs;
      const L = new Float32Array(n), R = new Float32Array(n);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const beat = 0.5; // 120 BPM
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      const hz = (m) => 440 * 2 ** ((m - 69) / 12);
      for (let i = 0; i < n; i++) {
        const t = i / sr, b = t / beat, tb = (b % 1) * beat, bar = Math.floor(b / 4) % 4;
        const kick = Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 7) * 0.9;
        const hat = ((b * 2) % 1) * beat * 0.5 < 0.04 ? rnd() * Math.exp(-((b * 2) % 1) * beat * 0.5 * 90) * 0.25 : 0;
        const bass = Math.sin(2 * Math.PI * hz(chords[bar][0] - 24) * t) * 0.35 * (1 - Math.exp(-tb * 40));
        let pad = 0, padR = 0;
        chords[bar].forEach((m, k) => { pad += Math.sin(2 * Math.PI * hz(m) * t * 1.002) * 0.08; padR += Math.sin(2 * Math.PI * hz(m) * t * 0.998 + k) * 0.08; });
        L[i] = (kick + bass + hat * 0.6 + pad) * 0.5;
        R[i] = (kick + bass + hat + padR) * 0.5;
      }
      // As a 16-bit WAV, like a real file's bytes.
      const data = new DataView(new ArrayBuffer(44 + n * 4));
      const str = (o, t) => [...t].forEach((c, j) => data.setUint8(o + j, c.charCodeAt(0)));
      str(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
      data.setUint16(22, 2, true); data.setUint32(24, sr, true); data.setUint32(28, sr * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true);
      str(36, 'data'); data.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) {
        data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      }
      return { name: 'Night Drive (demo loop).wav', duration: secs, data: new Uint8Array(data.buffer) };
    },

    // ----- stems: Demucs downloaded, the UVR models not (download them to see it work) -----
    stemsModels: async () => ({ dir: 'C:\\Users\\you\\AppData\\Roaming\\Nabbit\\stem-models', ort: true, models: demoStems }),
    stemsDownload: async (id) => {
      const m = demoStems.find((x) => x.id === id);
      for (let got = 0; got <= m.size; got += m.size / 12) { await wait(220); emit('stems-dl', { id, got, total: m.size }); }
      m.installed = true; emit('stems-dl', { id, got: m.size, total: m.size, done: true }); return { ok: true };
    },
    stemsRemove: async (id) => { const m = demoStems.find((x) => x.id === id); if (m && m.own) demoStems.splice(demoStems.indexOf(m), 1); else if (m) m.installed = false; return demoStems; },
    stemsAddOwn: async () => { const m = { id: 'own-1', name: 'My UVR model', kind: 'mdx', note: 'D:\\Models\\My UVR model.onnx', size: 56e6, own: true, installed: true, needsParams: true, stems: ['Vocals', 'Instrumental'] }; demoStems.push(m); return { models: demoStems, added: [] }; },
    stemsOwnParams: async (id, p) => { const m = demoStems.find((x) => x.id === id); m.needsParams = false; m.params = p; m.stems = [p.primary, p.primary === 'Vocals' ? 'Instrumental' : 'Vocals']; return demoStems; },
    stemsDir: async () => ({ dir: 'D:\\Stem models', models: demoStems }),
    onStemsDl: listen('stems-dl'),

    // ----- compressor -----
    cpScan: async () => { await wait(300); return [
      { path: 'C:\\Users\\you\\Videos\\holiday 4k.mov', name: 'holiday 4k.mov', kind: 'video', size: 812e6, duration: 214, width: 3840, height: 2160, fps: 60 },
      { path: 'C:\\Users\\you\\Pictures\\IMG_2041.heic', name: 'IMG_2041.heic', kind: 'image', size: 3.4e6, width: 4032, height: 3024 },
      { path: 'C:\\Users\\you\\Music\\interview.wav', name: 'interview.wav', kind: 'audio', size: 96e6, duration: 545 },
      { path: 'C:\\Users\\you\\Pictures\\reaction.gif', name: 'reaction.gif', kind: 'gif', size: 14e6, duration: 6, width: 480, height: 270 },
      { path: 'C:\\Users\\you\\Documents\\contract scan.pdf', name: 'contract scan.pdf', kind: 'pdf', size: 22e6 }]; },
    cpSize: async (p) => (/holiday/.test(p) ? 9.62e6 : /IMG/.test(p) ? 0.41e6 : /interview/.test(p) ? 8.6e6 : /reaction/.test(p) ? 0.9e6 : 3.1e6),

    // ----- Soulseek: sample answers arrive over two seconds, ranked by the real rules (slsk-search.js) -----
    slskStatus: async () => ({ configured: true, online: true, port: 2234 }),
    slskAccount: async () => ({ online: true, port: 2234 }),
    slskStop: async () => null,
    slskPrefsGet: async () => slskPrefs,
    slskPrefs: async (p) => { slskPrefs = { ...slskPrefs, ...p, formats: p.formats ? (p.formats.length ? p.formats : SlskSearch.AUDIO) : slskPrefs.formats }; if (slskSess) slskEmit(); return slskPrefs; },
    slskSource: async () => [],
    // Batch inputs: the real parsers; links and files can't be read in a browser demo.
    slskResolve: async (text, mode) => window.SlskInputs.resolveInputs(text, mode, {
      readFile: async () => { throw new Error('The demo can\'t open files.'); },
      fetchText: async () => { throw new Error('The demo can\'t read web pages.'); },
      fetchJson: async () => { throw new Error('The demo can\'t reach MusicBrainz.'); },
      ytJson: async () => ({ entries: [{ title: 'Studio B - Night Drive (Official Video)', duration: 211 }, { title: 'Studio B - Overpass', duration: 242 }, { title: 'Exit 47 [Lyrics]', channel: 'Studio B - Topic', duration: 304 }] }),
    }),
    onSlskResolveProgress: listen('slsk-resolve-progress'),
    slskSearch: async (req) => {
      const S = window.SlskSearch;
      const target = req.target || (() => { const { artist, title } = S.parseQuery(req.query); return { artist, title, album: title }; })();
      slskSess = { id: ++jobN, mode: req.mode, target, answers: [], done: false };
      const sess = slskSess;
      const tracks = songs.map((t, i) => [`0${i + 1} - ${t}`, 180 + i * 31]);
      const user = (name, dir, ext, q, slot, queue, speed) => ({ user: name, slotFree: slot, queue, speed,
        files: tracks.map(([n, d]) => { const fn = `${n}.${ext}`; return { file: `@@music\\Studio B\\${dir}\\${fn}`, name: fn, ext, duration: d,
          size: Math.round(d * (q.bitrate ? q.bitrate * 125 : (q.bitDepth || 16) * (q.sampleRate || 44100) * 2 / 8 * 0.6)), ...q }; }) });
      const answers = [
        user('vinylhound', 'Night Drive (2024) [FLAC 24-96]', 'flac', { bitDepth: 24, sampleRate: 96000 }, false, 4, 2.1e6),
        user('quietkeys', 'Night Drive [16-44]', 'flac', { bitDepth: 16, sampleRate: 44100 }, true, 0, 4.8e6),
        user('night_owl', 'Studio B - Night Drive (2024) FLAC', 'flac', { bitDepth: 16, sampleRate: 44100 }, true, 0, 1.2e6),
        user('moth_radio', 'Studio B - Night Drive (V0)', 'mp3', { bitrate: 245, vbr: true }, true, 0, 900e3),
        user('tapeloop', 'Night Drive', 'mp3', { bitrate: 320 }, true, 1, 1.5e6),
        user('crate_digger', 'Overpass Tapes', 'mp3', { bitrate: 320 }, true, 0, 2e6),
      ];
      answers.forEach((a, i) => setTimeout(() => { if (slskSess !== sess) return; sess.answers.push(a); sess.done = i === answers.length - 1; slskEmit(); }, 400 + i * 350));
      return { id: sess.id, queries: S.buildQueries(target, req.mode, slskPrefs.fallbackLevel), target };
    },
    onSlskView: listen('slsk-view'), onSlskStatus: listen('slsk-status'),

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
