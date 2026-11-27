// Audio Tools · Mastering. A song plays through the chain (mastering.js) live, so every slider and
// on / off switch is heard as it changes. Export renders the same chain over the whole file in Nabbit's
// main process (ffmpeg in, chain, ffmpeg out) and saves "<name> (master).<ext>" next to the song.
(() => {
  const $ = (id) => document.getElementById(id);
  const M = window.Mastering;
  if (!M || !$('tool-master')) return;

  // ---------- Settings (kept between runs) ----------
  const KEY = 'nabbit.master';
  let settings;
  try { settings = M.normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { settings = M.normalize(null); }
  if (settings.spectral.output === 10.03) settings.spectral.output = 10; // the old default
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* no storage */ } }, 300);
  };
  const apply = () => { if (chain) chain.set(settings); save(); };

  // ---------- Playback: the decoded song, played through the chain ----------
  let ctx = null, node = null, chain = null, volume = null;
  let buffer = null, file = null, pos = 0, playing = false;
  // What the chain put out, kept with a running sample count and the time each block reaches the
  // speakers, so the scopes and meters show exactly what's being heard at every screen frame (not one
  // update per 4096-sample block).
  const clipMtr = { clipL: 0, clipR: 0 };
  const RING = 32768;
  const ringL = new Float32Array(RING), ringR = new Float32Array(RING);
  let written = 0, blockIdx = 0, blockTime = null;
  function ensureAudio() {
    if (ctx) return;
    ctx = new AudioContext({ latencyHint: 'playback' });
    chain = new M.Chain(ctx.sampleRate, settings);
    // A ScriptProcessor (not a worklet): it loads from file:// in the app and from the web in the demo
    // alike, and the chain needs only a few % of one core.
    node = ctx.createScriptProcessor(4096, 1, 2);
    // Listening volume: after the chain and the meters, so it changes neither the export nor the readings.
    volume = ctx.createGain();
    volume.gain.value = volGain();
    node.connect(volume);
    volume.connect(ctx.destination);
    node.onaudioprocess = (e) => {
      const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
      const n = L.length;
      if (!playing || !buffer) { L.fill(0); R.fill(0); return; }
      const a = buffer.getChannelData(0), b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
      const len = Math.max(0, Math.min(n, buffer.length - pos));
      L.set(a.subarray(pos, pos + len)); R.set(b.subarray(pos, pos + len));
      if (len < n) { L.fill(0, len); R.fill(0, len); }
      pos += len;
      chain.process(L, R, n);
      clipMtr.clipL = Math.max(clipMtr.clipL, chain.meter.clipL);
      clipMtr.clipR = Math.max(clipMtr.clipR, chain.meter.clipR);
      blockIdx = written;
      blockTime = Number.isFinite(e.playbackTime) ? e.playbackTime : ctx.currentTime + n / ctx.sampleRate;
      for (let i = 0; i < n; i++) { const j = (written + i) % RING; ringL[j] = L[i]; ringR[j] = R[i]; }
      written += n;
      if (pos >= buffer.length) { playing = false; pos = 0; queueMicrotask(renderTransport); }
    };
  }

  // Volume slider: 0–100 on a squared curve (finer control at the quiet end), remembered.
  const volEl = $('ms-vol');
  try { const v = localStorage.getItem('nabbit.masterVol'); if (v !== null) volEl.value = v; } catch { /* default */ }
  function volGain() { const v = Number(volEl.value) / 100; return v * v; }
  volEl.addEventListener('input', () => {
    if (volume) volume.gain.setTargetAtTime(volGain(), ctx.currentTime, 0.015);
    try { localStorage.setItem('nabbit.masterVol', volEl.value); } catch { /* none */ }
  });
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function renderTransport() {
    const dur = buffer ? buffer.duration : 0;
    $('ms-play').textContent = playing ? '❚❚' : '▶';
    $('ms-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('ms-play').disabled = !buffer;
    $('ms-seek').disabled = !buffer;
    $('ms-export').disabled = !file;
    $('ms-dur').textContent = fmtTime(dur);
    $('ms-time').textContent = fmtTime(buffer ? pos / buffer.sampleRate : 0);
    if (buffer && !seeking) $('ms-seek').value = String(Math.round((pos / buffer.length) * 1000));
  }
  let seeking = false;
  $('ms-seek').addEventListener('input', () => {
    if (!buffer) return;
    seeking = true;
    pos = Math.floor((Number($('ms-seek').value) / 1000) * buffer.length);
    if (chain) chain.reset();
    $('ms-time').textContent = fmtTime(pos / buffer.sampleRate);
  });
  $('ms-seek').addEventListener('change', () => { seeking = false; });
  $('ms-play').addEventListener('click', async () => {
    if (!buffer) return;
    ensureAudio();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!playing && pos === 0) chain.reset();
    playing = !playing;
    // Only one thing plays at a time: pause the music player.
    if (playing && window.Player && window.Player.pause) window.Player.pause();
    renderTransport();
  });
  $('ms-ab').addEventListener('click', () => {
    ensureAudio();
    chain.bypass = !chain.bypass;
    $('ms-ab').setAttribute('aria-pressed', String(chain.bypass));
    $('ms-ab').textContent = chain.bypass ? 'A/B · Original' : 'A/B · Chain';
    $('ms-ab').classList.toggle('on', chain.bypass);
  });

  // Meters, scopes and the playhead, every screen frame while the tool is open.
  const dbText = (g) => (g > 1e-6 ? (20 * Math.log10(g)).toFixed(1) : '-∞');
  const shown = { outL: 0, outR: 0, clipL: 0, clipR: 0 };
  let lastFrame = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    if (!$('editor').classList.contains('active') || !$('tool-master').open) { lastFrame = now; return; }
    const dt = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    if (playing) renderTransport();
    const fr = frameSamples();
    // Peak meters: instant rise, fall of about 20 dB a second.
    const fall = 10 ** (-20 * dt / 20);
    shown.outL = Math.max(fr.peakL, shown.outL * fall);
    shown.outR = Math.max(fr.peakR, shown.outR * fall);
    shown.clipL = Math.max(clipMtr.clipL, shown.clipL - 12 * dt);
    shown.clipR = Math.max(clipMtr.clipR, shown.clipR - 12 * dt);
    clipMtr.clipL = 0; clipMtr.clipR = 0;
    for (const c of ['l', 'r']) {
      const g = shown[c === 'l' ? 'outL' : 'outR'], cl = shown[c === 'l' ? 'clipL' : 'clipR'];
      const pd = g > 1e-6 ? 20 * Math.log10(g) : -60;
      $(`ms-out-${c}v`).textContent = dbText(g);
      $(`ms-out-${c}`).style.width = `${Math.max(0, Math.min(100, ((pd + 48) / 48) * 100))}%`;
      $(`ms-out-${c}`).classList.toggle('hot', pd > -0.1);
      $(`ms-clip-${c}v`).textContent = cl.toFixed(1);
      $(`ms-clip-${c}`).style.width = `${Math.min(100, (cl / 12) * 100)}%`;
    }
    if (fr.fresh || scopeDirty) drawScopes(fr, dt);
    if (fr.fresh || eqEd.isDirty()) eqEd.draw();
  }
  requestAnimationFrame(tick);

  // The sample being heard right now (by the audio clock), and what's new since the last frame.
  let lastEnd = 0;
  function frameSamples() {
    let end = lastEnd;
    if (playing && ctx && blockTime != null) {
      const t = ctx.currentTime - (ctx.outputLatency || 0);
      end = Math.floor(blockIdx + (t - blockTime) * ctx.sampleRate);
      end = Math.max(written - RING + 8192, Math.min(written, end));
    }
    const fresh = end > lastEnd;
    const count = fresh ? Math.min(8192, end - lastEnd) : 0;
    lastEnd = Math.max(lastEnd, end);
    let peakL = 0, peakR = 0;
    for (let i = end - count; i < end; i++) {
      const j = ((i % RING) + RING) % RING;
      const a = Math.abs(ringL[j]), b = Math.abs(ringR[j]);
      if (a > peakL) peakL = a; if (b > peakR) peakR = b;
    }
    return { end, count, fresh, peakL, peakR };
  }

  // ---------- Visualizers (visualizers.js) ----------
  let scopeDirty = true;
  const viz = window.Visualizers.create({
    lis: $('vz-lis'), osc: $('vz-osc'), fft: $('vz-fft'), vu: $('vz-vu'),
    corr: $('ms-corr'), corrBar: $('ms-corr-bar'), pitch: $('vz-pitch'), read: $('vz-read'),
    modes: [...document.querySelectorAll('#ms-viz .vz-modes .vz-btn')], keyA: $('vz-key-a'), keyB: $('vz-key-b'),
    lufsM: $('vz-m'), lufsS: $('vz-s'), lufsI: $('vz-i'), peak: $('vz-peak'), lufsBar: $('vz-m-bar'), resetBtn: $('vz-reset'),
  }, () => ({ L: ringL, R: ringR, size: RING }));
  function drawScopes(fr, dt) {
    scopeDirty = false;
    viz.frame({ ...fr, dt, sr: ctx ? ctx.sampleRate : 48000, playing });
  }
  new ResizeObserver(() => { scopeDirty = true; }).observe($('ms-viz'));

  // ---------- Loading a song ----------
  async function load(path) {
    $('ms-name').textContent = 'Loading…';
    $('ms-status').textContent = '';
    playing = false;
    try {
      ensureAudio();
      const r = await window.api.msLoad(path);
      const bytes = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
      buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      file = path;
      pos = 0;
      // A new song starts from the preset's settings (the save format stays as chosen).
      settings = M.normalize(null);
      chain.set(settings);
      chain.bypass = false;
      $('ms-ab').setAttribute('aria-pressed', 'false');
      $('ms-ab').textContent = 'A/B · Chain';
      $('ms-ab').classList.remove('on');
      for (const c of controls) c.refresh();
      renderOn(); save();
      eqEd.select(-1);
      viz.reset(); scopeDirty = true;
      chain.reset();
      $('ms-name').textContent = r.name;
      $('ms-src').title = path;
    } catch (e) {
      buffer = null; file = null;
      $('ms-name').textContent = 'Drop a song here, or click';
      $('ms-status').textContent = `Couldn't open it: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
    }
    renderTransport();
  }
  $('ms-src').addEventListener('click', async () => {
    const f = await window.api.pickFile([{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'wma', 'alac', 'ape', 'wv', 'mp4', 'mkv', 'webm', 'mov'] }]);
    if (f) load(f);
  });
  const tool = $('tool-master');
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

  // ---------- Controls ----------
  function slider(box, label, get, set, { min, max, step = 0.1, unit = '', fmt, warn, def, digits = step < 1 ? 1 : 0 }) {
    const wrap = document.createElement('div');
    wrap.className = 'ms-ctl';
    const head = document.createElement('div');
    head.className = 'ms-ctl-head';
    const lab = Object.assign(document.createElement('span'), { textContent: label });
    const val = Object.assign(document.createElement('em'), { className: 'ms-val' });
    head.append(lab, val);
    const r = Object.assign(document.createElement('input'), { type: 'range', min, max, step, className: 'cp-range ms-range' });
    r.setAttribute('aria-label', label);
    const show = () => {
      const v = get();
      val.textContent = fmt ? fmt(v) : `${v > 0 && unit === ' dB' ? '+' : ''}${Number(v).toFixed(digits)}${unit}`;
      if (warn) wrap.classList.toggle('warn', warn(v));
    };
    r.value = String(get());
    r.addEventListener('input', () => { set(Number(r.value)); show(); apply(); });
    // Double-click: back to the preset's value.
    r.addEventListener('dblclick', () => { set(def); r.value = String(def); show(); apply(); });
    const ends = document.createElement('div');
    ends.className = 'cp-ends';
    const endFmt = (v) => (fmt ? fmt(v) : `${v}${unit}`);
    ends.append(Object.assign(document.createElement('span'), { textContent: endFmt(min) }), Object.assign(document.createElement('span'), { textContent: endFmt(max) }));
    wrap.append(head, r, ends);
    if (warn) wrap.append(Object.assign(document.createElement('div'), { className: 'ms-warn', textContent: warn.text }));
    box.append(wrap);
    show();
    return { refresh: () => { r.value = String(get()); show(); } };
  }
  const D = M.DEFAULTS;
  const pct = (v) => `${Math.round(v)}%`;
  const panFmt = (v) => (Math.round(v) === 0 ? 'C' : v < 0 ? `L${Math.round(-v)}` : `R${Math.round(v)}`);
  const hotWarn = Object.assign((v) => v > 10, { text: 'Above 10 dB this distorts hard.' });
  let controls = [];
  function buildControls() {
    for (const id of ['ms-stereo', 'ms-spectral', 'ms-clipper']) $(id).textContent = '';
    controls = [
      slider($('ms-stereo'), 'Mid', () => settings.stereo.mid, (v) => (settings.stereo.mid = v), { min: 0, max: 100, step: 1, fmt: pct, def: D.stereo.mid }),
      slider($('ms-stereo'), 'Width', () => settings.stereo.width, (v) => (settings.stereo.width = v), { min: 0, max: 200, step: 1, fmt: pct, def: D.stereo.width }),
      slider($('ms-stereo'), 'Pan', () => settings.stereo.pan, (v) => (settings.stereo.pan = v), { min: -100, max: 100, step: 1, fmt: panFmt, def: D.stereo.pan }),
      slider($('ms-spectral'), 'Amount', () => settings.spectral.output, (v) => (settings.spectral.output = v), { min: 0, max: 20, step: 0.01, digits: 2, unit: ' dB', def: D.spectral.output }),
      slider($('ms-clipper'), 'Input', () => settings.clip.input, (v) => (settings.clip.input = v), { min: 0, max: 15, unit: ' dB', def: D.clip.input, warn: hotWarn }),
    ];
    const sp = D.spectral;
    $('ms-spectral').append(Object.assign(document.createElement('p'), { className: 'hint small ms-note',
      textContent: `Window ${sp.window} · overlap ${sp.overlap} · ${sp.attack} / ${sp.release} ms. Every band above ${sp.downThreshold} dB is held down at ${sp.downRatio}:1; Amount lifts that compressed half, then it's mixed ${Math.round(sp.mix * 100)} / ${100 - Math.round(sp.mix * 100)} with the original.` }));
    $('ms-clipper').append(Object.assign(document.createElement('p'), { className: 'hint small ms-note', textContent: 'Cubic soft clip, ceiling 0 dB.' }));
    $('ms-stereo').append(Object.assign(document.createElement('p'), { className: 'hint small ms-note', textContent: 'Mid: how much of the mono content passes. Width: the sides (needs a stereo song).' }));
  }
  buildControls();
  function renderOn() {
    for (const b of document.querySelectorAll('#tool-master .ms-on')) {
      const on = settings.on[b.dataset.on];
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'On' : 'Off';
      b.closest('.ms-fx').classList.toggle('off', !on);
    }
  }
  for (const b of document.querySelectorAll('#tool-master .ms-on')) {
    b.addEventListener('click', () => { settings.on[b.dataset.on] = !settings.on[b.dataset.on]; renderOn(); apply(); });
  }
  renderOn();
  $('ms-reset').addEventListener('click', () => {
    settings = M.normalize(null);
    for (const c of controls) c.refresh();
    renderOn(); apply(); eqEd.select(-1);
  });
  $('ms-eq-flat').addEventListener('click', () => {
    for (const b of settings.eq.bands) if (b.type !== 'hp' && b.type !== 'lp') b.gain = 0;
    apply(); eqEd.dirty(); eqEd.read();
  });
  try { $('ms-format').value = localStorage.getItem('nabbit.masterFormat') || 'auto'; } catch { /* default */ }
  $('ms-format').addEventListener('change', () => { try { localStorage.setItem('nabbit.masterFormat', $('ms-format').value); } catch { /* none */ } });

  // ---------- EQ: the response curve with a point per band, over the live spectrum (eq-editor.js) ----------
  const eqEd = window.NabbitEqEditor($('ms-eq'), {
    bands: () => settings.eq.bands, on: () => settings.on.eq, sampleRate: () => (ctx ? ctx.sampleRate : 48000),
    spectrum: () => (playing ? viz.spectrum : null), changed: apply, readout: $('ms-eq-read'), height: 190,
  });
  tool.addEventListener('toggle', () => { if (tool.open) { eqEd.dirty(); requestAnimationFrame(eqEd.draw); } });

  // ---------- Export ----------
  const jobs = new Map();
  $('ms-export').addEventListener('click', async () => {
    if (!file) return;
    const name = file.split(/[\\/]/).pop();
    const title = `Master · ${name}`;
    $('ms-status').textContent = 'Mastering…';
    try {
      const { id } = await window.api.runJob('master', { input: file, settings, format: $('ms-format').value }, title);
      jobs.set(id, true);
      if (typeof addJob === 'function') addJob(id, title);
    } catch (e) { $('ms-status').textContent = String(e.message || e); }
  });
  window.api.onProgress(({ id, percent }) => { if (jobs.has(id)) $('ms-status').textContent = `Mastering… ${Math.round(percent)}%`; });
  window.api.onDone(({ id, ok, output, error }) => {
    if (!jobs.has(id)) return;
    jobs.delete(id);
    const st = $('ms-status');
    st.textContent = '';
    if (!ok) { st.textContent = /cancel/i.test(error || '') ? 'Cancelled.' : `Failed: ${error}`; return; }
    const a = Object.assign(document.createElement('a'), { href: '#', textContent: `Saved ${String(output).split(/[\\/]/).pop()}` });
    a.addEventListener('click', (e) => { e.preventDefault(); window.api.showItem(output); });
    st.append(a);
  });

  renderTransport();
})();
