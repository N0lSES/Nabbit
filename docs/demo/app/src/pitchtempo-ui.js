// Audio Tools → Change pitch and tempo. The song plays through the player, on the play bar: its tempo
// (pitch kept) and the pitch shifter for the pitch (player-mode.js Player.pitchTempo), so every change
// is heard at once. Engines (pitch.js): phase vocoder, WSOLA, Pro (formants), Mono (PSOLA), Resynth
// (robot), Chord (harmonizer, from the keyboard / MIDI / presets). Rhythm (live: pitch.js Slicer / TimeShaper; export: rhythm.js: slice stretch /
// map, half-time, tripletize) is rendered first and played with the pitch and tempo live on top. Its
// key and BPM come from DJ mode's analysis. Export: main.js tools.pitchtempo.
(function () {
  const $ = (id) => document.getElementById(id);
  const tool = $('tool-pitch');
  if (!tool) return;
  const PC = window.PlayerCore;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const FORMATS = [['auto', 'Auto', 'MP3 stays MP3, WAV stays WAV, anything else becomes FLAC'], ['wav', 'WAV', '24-bit'], ['flac', 'FLAC', '24-bit'], ['mp3', 'MP3', '320 kbps']];
  const ALGOS = [
    ['pv', 'Phase vocoder', 'Smooth: best on full mixes and held notes. 46 ms delay.'],
    ['wsola', 'WSOLA', 'Time-domain: keeps drums punchy and voices natural, no "phasey" sound; can double a little on dense mixes. 93 ms delay.'],
    ['pro', 'Pro', 'A finer phase vocoder that keeps the formants where they were (voices don\'t go chipmunk); Formant moves them on their own, Fine goes to ±100 cents. 93 ms delay.'],
    ['mono', 'Mono', 'For one voice or instrument (PSOLA): follows its pitch period by period, formants kept. Very natural on solo vocals; not for full mixes. 93 ms delay.'],
    ['resynth', 'Resynth', 'Robot: the sound\'s tone colour sung on one steady note (the song\'s key note, moved by Pitch); Formant changes the voice. 46 ms delay.'],
    ['chord', 'Chord', 'Harmonizer: the voice sung on each note you hold (keys A–K, MIDI, or a preset), each a steady note, like Resynth but in the voice\'s own sound. Best on a vocal or one instrument. 93 ms delay.'],
  ];
  const RHYTHMS = [
    ['', 'Off', 'The timing as recorded'],
    ['slice', 'Slice stretch', 'Best for speeding a loop up (its tempo at or under the one set below), as FL Studio advises: each slice keeps its hit, and the rest of it is stretched to fit'],
    ['slicemap', 'Slice map', 'Best for slowing a loop down (its tempo at or above the one set below), as FL Studio advises: the slices are just moved, not stretched: tight drums, gaps between them when slower'],
    ['shaper', 'Shaper', 'Live, like ShaperBox\'s TimeShaper: a curve of how late the sound plays, over a cycle on the beat grid (half-time, tripletize, pitch, stutter, tape stop …) (needs the BPM)'],
  ];
  const PRESETS = [['Major', [0, 4, 7]], ['Minor', [0, 3, 7]], ['Power', [0, 7, 12]], ['Octaves', [-12, 0, 12]], ['7th', [0, 4, 7, 10]], ['Sus4', [0, 5, 7]], ['Clear', []]];
  const KEYMAP = 'awsedftgyhujk'; // C4 … C5 on the computer keyboard
  const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  let file = null, info = null, duration = 0, format = 'auto';
  let cutBy = 'auto', markers = [];
  let rhythm = '', preview = null, previewKey = '', rendering = false, shaper = null;
  let relFirst = false;
  try { relFirst = localStorage.getItem('nabbit.ptRel') === '1'; } catch { /* default */ }
  // The beat grid: a whole BPM and where the bars start (s), from the analysis or set by hand (kept per
  // song, and used by the play bar's grid, the shaper and the export).
  let grid = null, wave = null, view = 0, zoom = 8;
  const bar = () => (grid ? (4 * 60) / grid.bpm : 2);
  const held = new Set(); // chord notes (MIDI numbers)
  try { format = localStorage.getItem('nabbit.ptFormat') || 'auto'; } catch { /* default */ }

  const algo = () => (window.PlayerFx && window.PlayerFx.pitchAlgo) || 'pv';
  const semis = () => Number($('pt-semis').value) + Number($('pt-cents').value) / 100;
  const tempo = () => Number($('pt-tempo').value) / 100;
  const record = () => $('pt-record').checked;
  const ratio = () => 2 ** (semis() / 12);
  const formant = () => (['pro', 'mono', 'resynth', 'chord'].includes(algo()) && !record() ? Number($('pt-formant').value) : 0);
  const heardTempo = () => (record() ? ratio() : tempo());
  const live = () => rhythm === 'shaper'; // the time shaper, in the player
  const slicing = () => rhythm === 'slice' || rhythm === 'slicemap'; // live too (the player's slicer)
  const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const sgn = (n, unit) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}${unit}`;
  // The song's key note (pitch class 0–11), from the analysis; C when unknown.
  const tonic = () => {
    const name = info && (info.key || (info.camelot && PC.CAMELOT_KEYS[info.camelot]));
    const m = /^([A-G])([♯#♭b]?)/.exec(name || '');
    if (!m) return 0;
    let pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    if (m[2] === '♯' || m[2] === '#') pc++; else if (m[2] === '♭' || m[2] === 'b') pc--;
    return (pc + 12) % 12;
  };
  // The key note in a singing range (E3 … D♯4), for the presets and the keyboard's markings.
  const rootMidi = () => 52 + ((tonic() - 4 + 12) % 12);
  // Chord: each held note as a pitch (Hz), moved by the Pitch / Fine sliders.
  const targets = () => (algo() === 'chord' && held.size ? [...held].sort((a, b) => a - b).map((n) => 440 * 2 ** ((n + semis() - 69) / 12)) : null);
  const voices = () => null;
  const robotHz = () => 440 * 2 ** ((48 + tonic() - 69) / 12);
  const force = () => !record() && (algo() === 'resynth' || (algo() === 'chord' && held.size > 0) || Math.abs(formant()) > 0.01);
  const rhythmOpts = () => (rhythm ? { mode: rhythm, bpm: grid && grid.bpm, offset: grid ? grid.offset : 0, targetBpm: grid ? grid.bpm * tempo() : 0, cutBy: cutBy === 'auto' ? undefined : cutBy, shape: live() && shaper ? shaper.get() : null } : null);
  const rt = () => (live() && grid && shaper ? { shape: shaper.get(), bpm: grid.bpm, offset: grid.offset } : null);
  const rhyKey = () => JSON.stringify([file, rhythmOpts()]);
  const tempoLive = () => true;
  // Live slicing: the song's audio at the player's rate and where it's cut, from the main process.
  let slices = null, slicesWant = '', slicesErr = '';
  const slicesKey = () => JSON.stringify([file, cutBy, cutBy === 'auto' || cutBy === 'grid' ? grid && [grid.bpm, grid.offset] : null]);
  async function wantSlices() {
    if (!slicing() || !file) return;
    const key = slicesKey();
    if ((slices && slices.key === key) || slicesWant === key) return;
    if (cutBy === 'grid' && !grid) return;
    slicesWant = key; slicesErr = ''; paint();
    const src = file;
    try {
      if (window.PlayerFx && window.PlayerFx.ready) await window.PlayerFx.ready();
      const sr = (window.PlayerFx && window.PlayerFx.sampleRate) || 48000, pcmKey = `${src}|${sr}`;
      const have = slices && slices.pcmKey === pcmKey;
      const res = await window.api.ptSlices(src, { cutBy: cutBy === 'auto' ? undefined : cutBy, bpm: grid ? grid.bpm : 0, offset: grid ? grid.offset : 0, sr, noPcm: have });
      if (slicesWant !== key) return;
      let pcm = have ? slices.pcm : null;
      if (!pcm && res.pcm) { const u = res.pcm; pcm = new Float32Array(u.byteOffset % 4 ? u.slice().buffer : u.buffer, u.byteOffset % 4 ? 0 : u.byteOffset, Math.floor(u.byteLength / 4)); }
      slices = { key, pcmKey, pcm, cuts: res.cuts || [], markers: res.markers || 0 };
    } catch (e) { if (slicesWant === key) slicesErr = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    if (slicesWant === key) slicesWant = '';
    paint(); tell();
  }
  const sl = () => (slicing() && slices && slices.pcm && slices.key === slicesKey() ? { key: slices.pcmKey, pcm: slices.pcm, cuts: slices.cuts, mode: rhythm === 'slice' ? 'stretch' : 'map' } : null);

  // The player plays this file (or its rhythm preview) with these settings; the engine's settings too.
  function tell() {
    if (!file || !window.Player || !window.Player.pitchTempo) return;
    if (window.PlayerFx && window.PlayerFx.pitchExtra) window.PlayerFx.pitchExtra({ formantRatio: 2 ** (formant() / 12), voices: voices(), targets: targets(), robotHz: robotHz() });
    const usePreview = rhythm && !live() && !slicing() && preview && previewKey === rhyKey();
    window.Player.pitchTempo({ path: usePreview ? preview : file, semis: algo() === 'chord' && held.size ? 0 : semis(), tempo: tempo(), record: record(), force: force(), rt: rt(), sl: sl() });
    wantSlices();
  }
  function paint() {
    const st = semis(), t = heardTempo(), a = algo();
    $('pt-semis-v').textContent = sgn(Number($('pt-semis').value), ' st');
    $('pt-cents-v').textContent = sgn(Number($('pt-cents').value), ' ¢');
    $('pt-formant-v').textContent = sgn(Number($('pt-formant').value), ' st');
    $('pt-tempo-v').textContent = record() ? `${Math.round(ratio() * 1000) / 10} % ⛓` : `${Math.round(tempo() * 1000) / 10} %`;
    $('pt-tempo-v').title = record() ? 'Follows the pitch (Like a record)' : '';
    $('pt-tempo').disabled = record();
    $('pt-bpm-in').disabled = record() || !grid;
    $('pt-formant-box').classList.toggle('hidden', !['pro', 'mono', 'resynth', 'chord'].includes(a) || record());
    $('pt-chord').classList.toggle('hidden', a !== 'chord' || record());
    const k = Math.round(st);
    if (a === 'resynth' && !record()) {
      const n = 48 + tonic() + k;
      $('pt-key').textContent = `${NOTE[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1} (robot)`;
      $('pt-key0').textContent = 'one steady note';
    } else if (a === 'chord' && held.size && !record()) {
      $('pt-key').textContent = [...held].sort((x, y) => x - y).map((n) => `${NOTE[(((n + k) % 12) + 12) % 12]}${Math.floor((n + k) / 12) - 1}`).join(' · ');
      $('pt-key0').textContent = `${held.size} steady note${held.size === 1 ? '' : 's'}`;
    } else if (info && info.camelot) {
      // The key, and its relative major / minor (same Camelot number, the other letter): ⇅ swaps which
      // one is shown big (kept), like the Key & BPM finder.
      const cam = PC.shiftCamelot(info.camelot, k), rel = cam.replace(/[AB]$/, (x) => (x === 'A' ? 'B' : 'A'));
      const [big, alt] = relFirst ? [rel, cam] : [cam, rel];
      $('pt-key').textContent = `${PC.CAMELOT_KEYS[big] || big} · ${big}`;
      const from = k || Math.abs(st) > 0.004 ? `from ${info.key || PC.CAMELOT_KEYS[info.camelot]}${Math.abs(st - k) > 0.004 ? ` (${sgn(Math.round((st - k) * 100), ' ¢')} off)` : ''}` : 'as recorded';
      const small = $('pt-key0');
      small.textContent = '';
      const altName = el('span', 'pt-alt', PC.CAMELOT_KEYS[alt] || alt);
      const sw = el('button', 'pt-swap', '⇅');
      sw.type = 'button'; sw.title = 'Show the relative major / minor first'; sw.setAttribute('aria-label', 'Swap to the relative key');
      sw.onclick = () => { relFirst = !relFirst; try { localStorage.setItem('nabbit.ptRel', relFirst ? '1' : '0'); } catch { /* not kept */ } paint(); };
      small.append(altName, sw, el('span', '', ` · ${from}`));
    } else { $('pt-key').textContent = file ? (info === false ? '?' : '…') : '—'; $('pt-key0').textContent = ''; }
    if (grid) {
      $('pt-bpm').textContent = `${Math.round(grid.bpm * t * 10) / 10} BPM`;
      $('pt-bpm0').textContent = Math.abs(t - 1) > 1e-4 ? `from ${grid.bpm}` : 'as recorded';
      if (document.activeElement !== $('pt-bpm-in')) $('pt-bpm-in').value = String(Math.round(grid.bpm * tempo() * 10) / 10);
    } else { $('pt-bpm').textContent = file ? (info === false ? '?' : '…') : '—'; $('pt-bpm0').textContent = ''; }
    $('pt-len').textContent = duration ? fmtTime(duration / t) : '—';
    $('pt-len0').textContent = duration && Math.abs(t - 1) > 1e-4 ? `from ${fmtTime(duration)}` : '';
    $('pt-go').disabled = !file || (Math.abs(st) < 0.004 && Math.abs(heardTempo() - 1) < 1e-4 && !force() && !rhythm);
    for (const b of $('pt-fmt').children) b.classList.toggle('active', b.dataset.v === format);
    for (const b of $('pt-algo').children) b.classList.toggle('active', b.dataset.v === a);
    $('pt-algo-note').textContent = (ALGOS.find((x) => x[0] === a) || ALGOS[0])[2];
    paintRhythm();
    paintKeys();
    paintGrid();
  }
  const change = () => { paint(); tell(); };

  async function load(p) {
    file = p; info = null; duration = 0; preview = null; previewKey = ''; grid = null; wave = null; view = 0; markers = []; slices = null; slicesWant = ''; slicesErr = '';
    if (window.api.ptMarkers) window.api.ptMarkers(p).then((m) => { if (file === p) { markers = Array.isArray(m) ? m : []; paint(); } }).catch(() => {});
    $('pt-name').textContent = p.split(/[\\/]/).pop();
    $('pt-src').title = p;
    $('pt-note').textContent = 'It plays on the play bar below, through the player. The export is saved in Music → Nabbit → Pitch and Tempo.';
    tell();
    let ok = false;
    try { ok = window.Player && (await window.Player.playFiles([p], 0)); } catch { ok = false; }
    if (!ok) $('pt-note').textContent = "This file can't be played here (it can still be exported).";
    const slot = $('pt-play-slot');
    slot.textContent = '';
    if (typeof filePlayButton === 'function') slot.append(filePlayButton(() => [p], p, { label: 'Play / pause it on the play bar' }));
    paint();
    try { const tr = await window.api.playFilesInfo([p]); duration = (tr[0] && tr[0].duration) || 0; } catch { /* unknown */ }
    paint();
    try { info = (await window.api.djAnalyze(p)) || false; } catch { info = false; }
    if (file !== p) return;
    const kept = window.Player && window.Player.getGrid ? window.Player.getGrid(p) : null;
    grid = kept ? { ...kept } : info && info.bpm > 0 ? fromAnalysis() : null;
    paint(); tell();
    try { wave = await window.api.ptWave(p); } catch { wave = null; }
    if (file === p) drawGrid();
  }

  // ---------- Pitch, tempo, formant ----------
  for (const id of ['pt-semis', 'pt-cents', 'pt-tempo', 'pt-formant']) $(id).addEventListener('input', change);
  for (const [id, v] of [['pt-semis', '0'], ['pt-cents', '0'], ['pt-tempo', '100'], ['pt-formant', '0']]) $(id).addEventListener('dblclick', () => { $(id).value = v; change(); });
  $('pt-record').addEventListener('change', change);
  $('pt-bpm-in').addEventListener('change', () => {
    const want = Number($('pt-bpm-in').value);
    if (!(grid && want > 0)) return;
    $('pt-tempo').value = String(Math.max(50, Math.min(200, Math.round((want / grid.bpm) * 2000) / 20)));
    change();
  });
  $('pt-reset').addEventListener('click', () => {
    for (const [id, v] of [['pt-semis', '0'], ['pt-cents', '0'], ['pt-tempo', '100'], ['pt-formant', '0']]) $(id).value = v;
    $('pt-record').checked = false; held.clear(); setRhythm('');
    change();
  });

  // ---------- Beat grid ----------
  // From the analysis: the tempo rounded to a whole BPM, and its first beat.
  function fromAnalysis() {
    const bpm = Math.max(40, Math.min(300, Math.round(info.bpm)));
    const b = (4 * 60) / bpm;
    return { bpm, offset: ((((info.offset || 0) % b) + b) % b) };
  }
  function setGrid(g, keep = true) {
    if (!g) return;
    const b = (4 * 60) / g.bpm;
    grid = { bpm: g.bpm, offset: Math.round(((((g.offset % b) + b) % b)) * 1000) / 1000 };
    if (keep && file && window.Player && window.Player.setGrid) window.Player.setGrid(file, grid);
    metroNext = null; // the metronome starts again on the new grid
    change();
  }
  function paintGrid() {
    $('pt-grid').classList.toggle('hidden', !file);
    $('pt-grid').classList.toggle('off', !grid);
    if (!grid) return;
    const b = bar();
    $('pt-goff').max = String(Math.round(b * 1000));
    if (document.activeElement !== $('pt-goff')) $('pt-goff').value = String(Math.round(grid.offset * 1000));
    $('pt-goff-v').textContent = `${Math.round(grid.offset * 1000)} ms`;
    if (document.activeElement !== $('pt-gbpm')) $('pt-gbpm').value = String(grid.bpm);
    for (const z of $('pt-gzoom').children) z.classList.toggle('active', Number(z.dataset.z) === zoom);
    drawGrid();
  }
  const gx = { l: 0, w: 0 };
  function drawGrid() {
    const cv = $('pt-gcv');
    if (!cv || !grid || !cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'), cs = getComputedStyle(document.documentElement);
    const col = (n, d) => cs.getPropertyValue(n).trim() || d;
    const red = col('--red', '#ff2a1f'), text = col('--text', '#ddd'), muted = col('--muted', '#888');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const span = zoom ? zoom * bar() : (duration || (wave ? wave.peaks.length / wave.rate : 60));
    const maxView = Math.max(0, (duration || span) - span);
    view = Math.max(0, Math.min(maxView, view));
    const t2x = (t) => ((t - view) / span) * W;
    gx.span = span;
    // The waveform: the loudest moment in each pixel.
    if (wave) {
      g.fillStyle = muted; g.globalAlpha = 0.55;
      for (let x = 0; x < W; x++) {
        const a = Math.floor((view + (x / W) * span) * wave.rate), b2 = Math.max(a + 1, Math.floor((view + ((x + 1) / W) * span) * wave.rate));
        let m = 0; for (let i = a; i < b2 && i < wave.peaks.length; i++) if (wave.peaks[i] > m) m = wave.peaks[i];
        const h = Math.max(1, Math.sqrt(m) * (H - 18) * 0.85);
        g.fillRect(x, (H + 12 - h) / 2, 1, h);
      }
      g.globalAlpha = 1;
    } else { g.fillStyle = muted; g.font = '10px monospace'; g.fillText('Reading the waveform…', 10, H / 2); }
    // The grid: beats, bars (numbered), the first bar in red.
    const beat = 60 / grid.bpm, k0 = Math.floor((view - grid.offset) / beat) - 1;
    g.font = '9px ' + col('--mono', 'monospace');
    for (let k = k0; ; k++) {
      const t = grid.offset + k * beat;
      if (t > view + span) break;
      if (t < 0) continue;
      const x = Math.round(t2x(t)) + 0.5, isBar = ((k % 4) + 4) % 4 === 0;
      const pxBeat = (beat / span) * W;
      if (!isBar && pxBeat < 5) continue;
      g.strokeStyle = isBar ? (k === 0 ? red : text) : text;
      g.globalAlpha = isBar ? 0.85 : 0.25; g.lineWidth = isBar ? 1.5 : 1;
      g.beginPath(); g.moveTo(x, isBar ? 12 : 16); g.lineTo(x, H); g.stroke();
      if (isBar && (pxBeat * 4 > 26 || (k / 4) % 4 === 0)) { g.globalAlpha = 1; g.fillStyle = k === 0 ? red : text; g.fillText(String(k / 4 + 1), x + 3, 9); }
    }
    g.globalAlpha = 1;
    // The playhead.
    const ps = window.Player && window.Player.position;
    if (ps && file && ps.path.toLowerCase() === file.toLowerCase()) { g.fillStyle = red; g.fillRect(Math.round(t2x(ps.time)), 0, 2, H); }
  }
  for (const [z, t] of [[2, '2 bars'], [8, '8 bars'], [32, '32 bars'], [0, 'All']]) {
    const b = el('button', 'chip', t); b.type = 'button'; b.dataset.z = String(z);
    b.onclick = () => { zoom = z; paintGrid(); };
    $('pt-gzoom').append(b);
  }
  $('pt-gbpm').addEventListener('change', () => { const v = Math.round(Number($('pt-gbpm').value)); if (grid && v >= 40 && v <= 300) setGrid({ ...grid, bpm: v }); else paintGrid(); });
  $('pt-ghalf').onclick = () => { if (grid && grid.bpm / 2 >= 40) setGrid({ ...grid, bpm: Math.round(grid.bpm / 2) }); };
  $('pt-gdbl').onclick = () => { if (grid && grid.bpm * 2 <= 300) setGrid({ ...grid, bpm: grid.bpm * 2 }); };
  $('pt-goff').addEventListener('input', () => { if (grid) setGrid({ ...grid, offset: Number($('pt-goff').value) / 1000 }); });
  $('pt-goff').addEventListener('dblclick', () => { if (info && info.bpm) setGrid({ ...grid, offset: fromAnalysis().offset }); });
  const nudge = (ms) => { if (grid) setGrid({ ...grid, offset: grid.offset + ms / 1000 }); };
  $('pt-gl').onclick = (e) => nudge(e.shiftKey ? -1 : -5);
  $('pt-gr').onclick = (e) => nudge(e.shiftKey ? 1 : 5);
  $('pt-greset').onclick = () => { if (info && info.bpm) { if (window.Player && window.Player.setGrid) window.Player.setGrid(file, null); setGrid(fromAnalysis(), false); } };
  // ---------- Metronome ----------
  // Clicks on the grid's beats while this song plays, scheduled a little ahead on the player's own audio
  // clock (so they sit on what's heard: after the pitch shifter's delay, at the playback rate).
  let metro = false, metroNext = null, metroLast = null;
  try { metro = localStorage.getItem('nabbit.ptMetro') === '1'; } catch { /* off */ }
  const paintMetro = () => { $('pt-metro').classList.toggle('on', metro); $('pt-metro').setAttribute('aria-pressed', String(metro)); };
  $('pt-metro').onclick = () => { metro = !metro; metroNext = null; try { localStorage.setItem('nabbit.ptMetro', metro ? '1' : '0'); } catch { /* not kept */ } paintMetro(); };
  paintMetro();
  setInterval(() => {
    const fx = window.PlayerFx, ps = window.Player && window.Player.position;
    if (!metro || !grid || !file || !fx || !fx.clickAt || !ps || !ps.playing || ps.path.toLowerCase() !== file.toLowerCase()) { metroNext = null; return; }
    const now = fx.now;
    if (now == null) return;
    const beat = 60 / grid.bpm, rate = ps.rate || 1, ahead = 0.15;
    // The song's time against the audio clock, anchored once (so the clicks are evenly spaced) and only
    // set again when they drift apart by more than 20 ms (a seek, a pause, a rate change).
    if (!metroLast || metroNext === null || metroLast.rate !== rate || Math.abs(ps.time - (metroLast.time + (now - metroLast.now) * rate)) > 0.02) {
      metroLast = { time: ps.time, now, rate };
      metroNext = Math.ceil((ps.time - grid.offset) / beat - 1e-6);
    }
    const songNow = metroLast.time + (now - metroLast.now) * rate;
    const lag = fx.pitchLatency ? fx.pitchLatency(document.querySelector('video.lp-media.active') || document.getElementById('lp-video')) : 0;
    for (;;) {
      const t = grid.offset + metroNext * beat;
      if (t > songNow + ahead * rate) break;
      const when = metroLast.now + (t - metroLast.time) / rate + lag;
      if (when >= now - 0.005 && t >= 0) fx.clickAt(Math.max(now, when), ((metroNext % 4) + 4) % 4 === 0);
      metroNext++;
    }
  }, 25);

  // Drag the grid along the waveform; scroll to move along the song; click to play from there.
  {
    const cv = $('pt-gcv');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (!grid) return; drag = { x: e.clientX, off: grid.offset, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) drag.moved = true;
      if (drag.moved) setGrid({ ...grid, offset: drag.off + (dx / cv.clientWidth) * gx.span });
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && window.Player && window.Player.seekFile) {
        const r = cv.getBoundingClientRect();
        window.Player.seekFile(file, view + ((e.clientX - r.left) / r.width) * gx.span);
      }
      drag = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); view += (Math.sign(e.deltaY || e.deltaX) * gx.span) / 4; drawGrid(); }, { passive: false });
    new ResizeObserver(drawGrid).observe(cv);
    (function loop() { if (tool.open && file && grid && cv.offsetParent) drawGrid(); requestAnimationFrame(loop); })();
  }

  // ---------- Engines ----------
  for (const [v, text, tip] of ALGOS) {
    const b = el('button', 'chip', text);
    b.type = 'button'; b.title = tip; b.dataset.v = v;
    b.onclick = () => { if (window.PlayerFx && window.PlayerFx.setPitchAlgo) window.PlayerFx.setPitchAlgo(v); if (v === 'chord') startMidi(); change(); };
    $('pt-algo').append(b);
  }

  // ---------- Chord: keyboard, computer keys, MIDI, presets ----------
  function paintKeys() {
    const box = $('pt-keys');
    if (box.classList.contains('hidden') || $('pt-chord').classList.contains('hidden')) return;
    const root = rootMidi();
    if (!box.children.length) {
      // Three octaves: C3 … B5. White keys side by side; each black one over the line between two.
      const whites = [];
      for (let n = 48; n < 84; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
      for (let n = 48; n < 84; n++) {
        const black = [1, 3, 6, 8, 10].includes(n % 12);
        const k = el('button', `pt-key ${black ? 'b' : 'w'}`);
        if (black) k.style.left = `calc(${(whites.indexOf(n + 1) * 100) / whites.length}% - 7px)`;
        k.type = 'button'; k.dataset.n = String(n);
        k.title = `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`;
        k.addEventListener('mousedown', (e) => { e.preventDefault(); press(n, true); });
        k.addEventListener('mouseup', () => { if (!$('pt-latch').checked) press(n, false); });
        k.addEventListener('mouseleave', () => { if (!$('pt-latch').checked && held.has(n)) press(n, false); });
        box.append(k);
      }
    }
    for (const k of box.children) {
      const n = Number(k.dataset.n);
      k.classList.toggle('on', held.has(n));
      k.classList.toggle('root', n % 12 === root % 12);
      k.textContent = n % 12 === root % 12 ? NOTE[n % 12] : '';
    }
    $('pt-chord-note').textContent = `Each note you hold is sung as a steady note (the presets build on ${NOTE[root % 12]}, the song's key note, marked).${held.size ? '' : ' Nothing held: the song plays as it is.'}`;
  }
  function press(n, on) {
    const latch = $('pt-latch').checked;
    if (latch && on) { if (held.has(n)) held.delete(n); else held.add(n); } else if (on) held.add(n); else held.delete(n);
    change();
  }
  for (const [name, iv] of PRESETS) {
    const b = el('button', 'chip', name);
    b.type = 'button'; b.title = iv.length ? `${name}: ${iv.map((i) => sgn(i, '')).join(', ')} semitones from the key note` : 'Let go of every note';
    b.onclick = () => { held.clear(); for (const i of iv) held.add(rootMidi() + i); change(); };
    $('pt-chord-presets').append(b);
  }
  const typing = (t) => t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox') || (t && (t.tagName === 'TEXTAREA' || t.isContentEditable));
  const chordKeysOn = () => tool.open && algo() === 'chord' && !record() && $('editor').classList.contains('active');
  const down = new Set();
  document.addEventListener('keydown', (e) => {
    if (!chordKeysOn() || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const i = KEYMAP.indexOf(e.key.toLowerCase());
    if (i < 0) return;
    e.preventDefault();
    if (down.has(i)) return;
    down.add(i);
    press(rootMidi() - (rootMidi() % 12) + i, true); // the octave of the key note, from C
  });
  document.addEventListener('keyup', (e) => {
    const i = KEYMAP.indexOf(e.key.toLowerCase());
    if (i < 0 || !down.has(i)) return;
    down.delete(i);
    if (!$('pt-latch').checked) press(rootMidi() - (rootMidi() % 12) + i, false);
  });
  let midi = null;
  async function startMidi() {
    if (midi || !navigator.requestMIDIAccess) { if (!navigator.requestMIDIAccess) $('pt-midi').textContent = 'MIDI: not available'; return; }
    try {
      midi = await navigator.requestMIDIAccess();
      const hook = () => {
        const names = [];
        for (const inp of midi.inputs.values()) {
          names.push(inp.name);
          inp.onmidimessage = (m) => {
            if (algo() !== 'chord') return;
            const [st, note, vel] = m.data, cmd = st & 0xf0;
            if (cmd === 0x90 && vel > 0) press(note, true);
            else if ((cmd === 0x80 || (cmd === 0x90 && vel === 0)) && !$('pt-latch').checked) press(note, false);
          };
        }
        $('pt-midi').textContent = names.length ? `MIDI: ${names.join(', ')}` : 'MIDI: no keyboard connected';
      };
      hook();
      midi.onstatechange = hook;
    } catch { $('pt-midi').textContent = 'MIDI: not allowed'; }
  }
  if (algo() === 'chord') startMidi();

  // ---------- Rhythm ----------
  for (const [v, text, tip] of RHYTHMS) {
    const b = el('button', 'chip', text);
    b.type = 'button'; b.title = tip; b.dataset.v = v;
    b.onclick = () => setRhythm(v);
    $('pt-rhythm').append(b);
  }
  // Where the slices are cut (FL Studio's way: the file's own slice markers when it has them, else found).
  const CUTS = [['auto', 'Markers / hits', 'The file\'s slice markers if it has them (a WAV with cue points from FL Studio, Edison, ACID …, taken to be on the beat), otherwise the drum hits found in it'],
    ['hits', 'Hits', 'The drum hits found in it, ignoring any markers'], ['grid', 'Grid', 'Every sixteenth note on the beat grid']];
  const cutSeg = el('div', 'tm-seg cp-seg');
  cutSeg.setAttribute('role', 'radiogroup'); cutSeg.setAttribute('aria-label', 'Cut at');
  for (const [v, text, tip] of CUTS) {
    const b = el('button', 'chip', text);
    b.type = 'button'; b.title = tip; b.dataset.v = v;
    b.onclick = () => { cutBy = v; change(); };
    cutSeg.append(b);
  }
  const cutLab = el('span', 'dim small', 'Cut at');
  $('pt-rhy-opts').append(cutLab, cutSeg);
  function setRhythm(v) {
    const wasPreview = rhythm && !live() && preview;
    rhythm = v;
    // Back from a rendered preview to the song itself.
    if (file && wasPreview && (!v || live())) window.Player.playFiles([file], 0);
    change();
  }
  // FL Studio's advice: slice stretch when the target is faster than the loop, slice map when slower.
  function sliceHint() {
    const t = tempo();
    if (Math.abs(t - 1) < 1e-3) return '';
    const better = t > 1 ? 'slice' : 'slicemap';
    if (rhythm === better) return '';
    return t > 1 ? ' Speeding up: Slice stretch usually fits better (slices would overlap).' : ' Slowing down: Slice map keeps the drums tighter (Slice stretch smears the tails).';
  }
  function paintRhythm() {
    for (const b of $('pt-rhythm').children) b.classList.toggle('active', b.dataset.v === rhythm);
    // The shaper's editor (made the first time it's shown).
    $('pt-shaper').classList.toggle('hidden', !live());
    if (live() && !shaper && window.ShaperEditor) {
      shaper = window.ShaperEditor($('pt-shaper'), {
        onChange: () => tell(),
        // Where the song is in the cycle (the player's time, on the beat grid).
        playhead: (sh) => {
          const ps = window.Player && window.Player.position;
          if (!ps || !file || !grid || ps.path.toLowerCase() !== file.toLowerCase()) return null;
          const beats = ((ps.time - grid.offset) * grid.bpm) / 60;
          return beats < 0 ? null : (beats % sh.cycle) / sh.cycle;
        },
      });
    }
    $('pt-rhy-opts').classList.toggle('hidden', !slicing());
    for (const b of cutSeg.children) {
      b.classList.toggle('active', b.dataset.v === cutBy);
      if (b.dataset.v === 'auto') b.textContent = markers.length ? `Markers (${markers.length})` : 'Auto (no markers)';
    }
    const needBpm = rhythm && !grid && (live() || cutBy === 'grid');
    const fresh = rhythm && preview && previewKey === rhyKey();
    $('pt-rhy-go').classList.toggle('hidden', !rhythm || live() || slicing());
    $('pt-rhy-go').disabled = !file || needBpm || rendering;
    $('pt-rhy-go').textContent = rendering ? 'Rendering…' : fresh ? 'Rendered ✓' : 'Render preview';
    $('pt-rhy-note').textContent = !rhythm ? '' : needBpm ? (info === false ? 'The tempo couldn\'t be found, so this can\'t be done.' : 'Waiting for the tempo…')
      : live() ? 'Live on the beat grid: Smooth changes speed (pitch and tempo together), Steps moves pieces (pitch untouched).'
        : slicing() ? (slicesErr || (sl() ? `Live: ${slices.cuts.length + 1} slices; change the tempo while it plays.` : 'Reading the song…')) + sliceHint()
        : (fresh ? 'Playing the new rhythm at the new tempo; pitch is live on top.'
          : 'Rendered before it plays (a few seconds); the export does the same.');
  }
  $('pt-rhy-go').addEventListener('click', async () => {
    if (!file || !rhythm || rendering) return;
    rendering = true; paint();
    const key = rhyKey(), src = file;
    try {
      const p = await window.api.pitchTempoRhythmPreview(src, rhythmOpts());
      if (file === src && key === rhyKey()) {
        preview = p; previewKey = key;
        tell();
        await window.Player.playFiles([p], 0);
      }
    } catch (e) { $('pt-note').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    rendering = false; paint();
  });

  // ---------- Export ----------
  for (const [v, text, tip] of FORMATS) {
    const b = el('button', 'chip', text);
    b.type = 'button'; b.title = tip; b.dataset.v = v;
    b.onclick = () => { format = v; try { localStorage.setItem('nabbit.ptFormat', v); } catch { /* none */ } paint(); };
    $('pt-fmt').append(b);
  }
  $('pt-go').addEventListener('click', async () => {
    if (!file) return;
    const name = file.split(/[\\/]/).pop();
    const title = `Pitch & tempo · ${name}`;
    try {
      const { id } = await window.api.runJob('pitchtempo', {
        input: file, semis: algo() === 'chord' && held.size ? 0 : semis(), tempo: tempo(), record: record(), format, engine: algo(), formantRatio: 2 ** (formant() / 12),
        voices: voices(), targets: targets(), robotHz: robotHz(), force: force(), rhythm: rhythmOpts(),
      }, title);
      if (typeof addJob === 'function') addJob(id, title);
      $('pt-note').textContent = 'Exporting: progress shows under Now in Recent.';
    } catch (e) { $('pt-note').textContent = String(e.message || e); }
  });
  window.api.onDone(({ output, ok, error }) => {
    if (!file || !output || !/\(.*(st|%|speed|stretch|map|time|tripletized|shaped|pro|mono|resynth|chord|formant).*\)\.\w+$/.test(output)) return;
    $('pt-note').textContent = ok ? `Saved ${output.split(/[\\/]/).pop()}` : `Export failed: ${error}`;
  });
  window.api.pitchTempoEngine().then((e) => { if (e && e.rubberband) tool.querySelector('.ak-sub').textContent = 'Pitch · tempo · key · BPM · Rubber Band'; }).catch(() => {});

  // ---------- Choosing a song ----------
  $('pt-src').addEventListener('click', async () => {
    const f = await window.api.pickFile([{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'wma', 'alac', 'ape', 'wv', 'mp4', 'mkv', 'webm', 'mov'] }]);
    if (f) load(f);
  });
  tool.addEventListener('dragover', (e) => { e.preventDefault(); tool.classList.add('over'); });
  tool.addEventListener('dragleave', (e) => { if (!tool.contains(e.relatedTarget)) tool.classList.remove('over'); });
  tool.addEventListener('drop', (e) => {
    e.preventDefault();
    tool.classList.remove('over');
    tool.open = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    const p = f && window.api.pathForFile(f);
    if (p) load(p);
  });
  paint();
  // Other tools hand songs over (a stem, say).
  window.PitchTempoUI = { load(p) { document.querySelector('.tab[data-tool="editor"]')?.click(); tool.open = true; tool.scrollIntoView({ behavior: 'smooth', block: 'start' }); load(p); } };
})();
