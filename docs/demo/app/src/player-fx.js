// Player effects (the Effects button on the play bar): a chain of Stereo, EQ (the graphic one from
// Mastering), the Mastering preset and VST3 plugins, each on or off and in any order, applied live to
// what the player plays. Then the play bar's volume, last of all.
// Uses the DSP in mastering.js (window.Mastering) and the EQ editor in eq-editor.js. Plugins run in a
// separate program (vsthost/ → bin\nabbit-vsthost.exe): blocks of audio go there and come back two
// blocks later. Nothing is routed through Web Audio until an effect is first turned on, and the audio
// clock is suspended while nothing plays.
(() => {
  const M = window.Mastering;
  const $ = (id) => document.getElementById(id);
  // The player's two players (they take turns for gapless playback); `media` is the one playing.
  const mediaEls = [$('lp-video'), $('lp-video-b')].filter(Boolean);
  let media = mediaEls[0];
  const btn = $('lp-fx');
  if (!M || !media || !btn) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------- Settings ----------
  const NAMES = { stereo: 'Stereo', eq: 'EQ', master: 'Mastering preset', vst: 'Plugins (VST3)' };
  const HINTS = {
    stereo: 'Mid level, stereo width and pan',
    eq: 'The Mastering EQ: drag the points',
    master: 'The Audio Tools chain at its preset: Stereo → Spectral compressor → EQ → Clipper',
    vst: 'Your VST3 effects, in their own windows',
  };
  const KEY = 'nabbit.lpFx';
  function fresh() {
    const d = M.normalize(null);
    return { order: ['stereo', 'eq', 'master', 'vst'], on: { stereo: false, eq: false, master: false, vst: false }, stereo: d.stereo, eq: d.eq, plugins: [], open: null };
  }
  let fx = fresh();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      const n = M.normalize({ stereo: s.stereo, eq: s.eq });
      const order = Array.isArray(s.order) ? s.order.filter((k) => k in NAMES) : [];
      for (const k of Object.keys(NAMES)) if (!order.includes(k)) order.push(k);
      const on = {};
      for (const k of Object.keys(NAMES)) on[k] = !!(s.on && s.on[k]);
      const plugins = (Array.isArray(s.plugins) ? s.plugins : []).filter((p) => p && typeof p.path === 'string')
        .map((p, i) => ({ id: Number(p.id) || i + 1, path: p.path, name: String(p.name || p.path), on: p.on !== false, comp: p.comp || '', ctrl: p.ctrl || '' }));
      fx = { order, on, stereo: n.stereo, eq: n.eq, plugins, open: s.open || null };
    }
  } catch { /* defaults */ }
  let saveTimer = 0;
  const saveNow = () => { clearTimeout(saveTimer); saveTimer = 0; try { localStorage.setItem(KEY, JSON.stringify(fx, (k, v) => (k === 'proc' || k === 'error' ? undefined : v))); } catch { /* none */ } };
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); };
  // Closing Nabbit doesn't lose the last few changes.
  window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });
  const pluginsOn = () => fx.plugins.filter((p) => p.on);
  const anyOn = () => ['stereo', 'eq', 'master'].some((k) => fx.on[k]) || (fx.on.vst && pluginsOn().length > 0);

  // ---------- Audio ----------
  // The player's element → the chain (an AudioWorklet: mastering.js's stages, in order, on the audio
  // thread) → the analyser (the EQ's spectrum) and the output volume → speakers. With every effect off
  // the chain is taken out of the path. The worklet is built from mastering.js's source in a Blob, so it
  // loads from file:// in the app and from the web in the demo alike.
  // Samples per block sent to the plugin host: small, so plugins (and their analysers) get audio ~94 times
  // a second at 48 kHz rather than in big lumps.
  const BLOCK = 512;
  let ctx = null, src = null, node = null, out = null, analyser = null, starting = null, failed = '';
  let beatAn = null, beatBuf = null, beatPrev = null; // the low end, unsmoothed, for Nabbit's dancing
  let meterL = null, meterR = null;
  let volume = (Number(($('lp-vol') || {}).value || 80) / 100) ** 2; // the play bar's volume (0 … 1, already curved)
  const stats = { sent: 0, back: 0, late: 0, peak: 0 }; // what's going through the plugins (shown in their section)
  const PROC = `
const M = globalThis.Mastering;
const B = ${BLOCK};
class NabbitFx extends AudioWorkletProcessor {
  constructor() {
    super();
    this.s = null; this.vst = false;
    this.eq = new M.Eq(sampleRate, 2);
    this.master = new M.Chain(sampleRate, M.normalize(null));
    // Plugins: player-core.js's HostDelay (blocks out to the host, back a few blocks later; grows when late).
    this.hd = new globalThis.PlayerCore.HostDelay(B);
    this.stAt = 0;
    this.send = (seq, L, R) => this.port.postMessage({ seq, L, R }, [L.buffer, R.buffer]);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.fx) { this.s = m.fx; this.eq.set(m.fx.eq); if (this.vst !== !!m.vst) { this.vst = !!m.vst; this.hd.reset(); } }
      else if (m.back) this.hd.receive(m.seq, m.L, m.R);
    };
  }
  process(inputs, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || outputs[0][0];
    const inp = inputs[0];
    if (!inp || !inp.length) { L.fill(0); R.fill(0); return true; }
    L.set(inp[0]); R.set(inp[1] || inp[0]);
    const s = this.s;
    if (!s) return true;
    const n = L.length;
    // A bad sample (NaN / infinity) would stick in the filters' memory for good: it's made silence.
    for (let i = 0; i < n; i++) { if (!(L[i] > -1e9 && L[i] < 1e9)) L[i] = 0; if (!(R[i] > -1e9 && R[i] < 1e9)) R[i] = 0; }
    for (const k of s.order) {
      if (!s.on[k]) continue;
      if (k === 'stereo') M.stereoStage(L, R, n, s.stereo);
      else if (k === 'eq') this.eq.process([L, R], n);
      else if (k === 'master') this.master.process(L, R, n);
      else if (k === 'vst' && this.vst) this.hd.process(L, R, n, currentTime, this.send);
    }
    // And if the chain itself ever goes bad, it starts afresh instead of staying broken.
    if (!Number.isFinite(L[0] + L[n - 1] + R[0] + R[n - 1])) {
      L.fill(0); R.fill(0);
      this.eq = new M.Eq(sampleRate, 2); if (s.eq) this.eq.set(s.eq);
      this.master = new M.Chain(sampleRate, M.normalize(null));
    }
    if (this.vst && currentTime - this.stAt > 0.5) {
      this.stAt = currentTime;
      this.port.postMessage({ stats: { ...this.hd.st, delay: this.hd.delay / sampleRate } });
      this.hd.st.peak = 0;
    }
    return true;
  }
}
registerProcessor('nabbit-fx', NabbitFx);
// DJ mode's pitch shifter, one per player (pitch.js): off, the sound passes straight through.
class NabbitPitchNode extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() {
    super();
    // The engines (pitch.js), made when first picked; one is used at a time. Their settings (formants,
    // a chord's voices, the robot's note) apply to whichever is in use.
    this.engines = {};
    this.extra = { formantRatio: 1, voices: null, targets: null, robotHz: 130.81 };
    this.ps = this.engine('pv');
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.algo && self.NabbitPitch.ALGOS[m.algo]) { const next = this.engine(m.algo); if (next !== this.ps) { const was = this.ps.on; this.ps.setOn(false); this.ps = next; this.ps.setOn(was); } }
      if (m.extra) { Object.assign(this.extra, m.extra); this.apply(); }
      if ('on' in m) this.ps.setOn(m.on);
    };
  }
  engine(a) { if (!this.engines[a]) { this.engines[a] = self.NabbitPitch.makeEngine(a, 2, sampleRate); } const e = this.engines[a]; this.ps = this.ps || e; this.apply(e); return e; }
  apply(e = this.ps) { if (!e) return; e.formantRatio = this.extra.formantRatio; if ('voices' in e) e.voices = this.extra.voices; if ('targets' in e) e.targets = this.extra.targets; if ('robotHz' in e) e.robotHz = this.extra.robotHz; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) { for (const o of out) o.fill(0); return true; }
    this.ps.ratio = params.ratio[0];
    // An engine that fails is replaced by a fresh one (silence for this block), never left dead.
    try { this.ps.process(inp, out); } catch (err) {
      for (const o of out) o.fill(0);
      const name = Object.keys(this.engines).find((k) => this.engines[k] === this.ps) || 'pv', was = this.ps.on;
      delete this.engines[name];
      this.ps = this.engine(name);
      this.ps.setOn(was);
      this.port.postMessage({ error: String(err && err.message || err) });
    }
    for (const o of out) for (let i = 0; i < o.length; i++) if (!(o[i] > -1e9 && o[i] < 1e9)) { o[i] = 0; this.ps.reset(); }
    return true;
  }
}
registerProcessor('nabbit-pitch', NabbitPitchNode);
// The time shaper, one per player (pitch.js): half-time / tripletize live; off, straight through.
class NabbitTimeNode extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ts = new self.NabbitPitch.TimeShaper(2, sampleRate);
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.reset) this.ts.reset();
      if (m.grid) { delete this.ts.grid.from; delete this.ts.grid.once; Object.assign(this.ts.grid, m.grid); }
      if ('shape' in m) this.ts.setShape(m.shape || null);
      if (m.clock) { this.ts.setClock(m.clock.song, m.clock.frame, m.clock.rate); if (this.sl) this.sl.setClock(m.clock.song, m.clock.frame, m.clock.rate, m.clock.playing); }
      // Live slice stretch / slice map: the song's audio (once), then its slices; null for off.
      if (m.pcm) { if (!this.sl) this.sl = new self.NabbitPitch.Slicer(sampleRate); this.sl.setPcm(m.pcm); }
      if (m.slices && this.sl) this.sl.setSlices(m.slices.cuts, m.slices.mode);
      if ('slices' in m) this.slOn = !!m.slices;
      if (m.drop) { this.sl = null; this.slOn = false; }
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    // Slicing: its own copy of the song, played on the player's clock (what comes in isn't used), then
    // the time shaper on that when it's on (DJ mode's transition effects).
    if (this.slOn && this.sl) {
      const N = out[0].length;
      if (!this.tmp || this.tmp[0].length !== N) this.tmp = [new Float32Array(N), new Float32Array(N)];
      try {
        this.sl.process(inp, this.tmp, currentFrame);
        try { this.ts.process(this.tmp, out, currentFrame); } catch { for (let c = 0; c < out.length; c++) out[c].set(this.tmp[c] || this.tmp[0]); }
      } catch (err) { for (const o of out) o.fill(0); const pcm = this.sl.pcm, { cuts, mode, clock } = this.sl; this.sl = new self.NabbitPitch.Slicer(sampleRate); this.sl.setPcm(pcm); this.sl.setSlices(cuts.slice(1), mode); this.sl.setClock(clock.song, clock.frame, clock.rate, clock.playing); }
      return true;
    }
    if (!inp || !inp.length) { for (const o of out) o.fill(0); return true; }
    try { this.ts.process(inp, out, currentFrame); } catch (err) { // off: the sound straight through (still kept, for when it's turned on)
      for (let c = 0; c < out.length; c++) out[c].set(inp[c] || inp[0]);
      const { shape, grid } = this.ts;
      this.ts = new self.NabbitPitch.TimeShaper(2, sampleRate); Object.assign(this.ts.grid, grid); this.ts.setShape(shape);
    }
    return true;
  }
}
registerProcessor('nabbit-time', NabbitTimeNode);
`;
  function ensureAudio() {
    if (ctx || starting) return starting;
    starting = (async () => {
      try {
        const code = await window.api.fxSource();
        const c = new AudioContext({ latencyHint: 'playback' });
        const url = URL.createObjectURL(new Blob([`globalThis.self = globalThis;\n${code}\n${PROC}`], { type: 'text/javascript' }));
        await c.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        node = new AudioWorkletNode(c, 'nabbit-fx', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
        node.port.onmessage = onWorklet;
        // Both players feed the chain (only the one playing makes a sound).
        src = c.createGain();
        // Each with its own level, for DJ mode's crossfades.
        // player → its pitch shifter (DJ key shifts; off: straight through) → its level → the chain.
        for (const m of mediaEls) {
          const g = c.createGain();
          let ps = null;
          try { ps = new AudioWorkletNode(c, 'nabbit-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' }); } catch { ps = null; }
          const s0 = c.createMediaElementSource(m);
          // player → its time shaper (off: straight through) → its pitch shifter → its level → the chain.
          let tn = null;
          try { tn = new AudioWorkletNode(c, 'nabbit-time', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' }); } catch { tn = null; }
          if (tn) { elTime.set(m, { node: tn, on: false }); s0.connect(tn); }
          const head = tn || s0;
          if (ps) { head.connect(ps); ps.connect(g); elPitch.set(m, { node: ps, on: false, algo: pitchAlgo, own: null }); ps.port.postMessage({ algo: pitchAlgo, extra: pitchExtra }); } else head.connect(g);
          g.connect(src);
          elGain.set(m, g);
        }
        out = c.createGain();
        out.gain.value = volume;
        analyser = c.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.75;
        beatAn = c.createAnalyser();
        beatAn.fftSize = 2048;
        beatAn.smoothingTimeConstant = 0;
        out.connect(c.destination);
        // The output, after the volume, left and right: the volume meter and the oscilloscope.
        const split = c.createChannelSplitter(2);
        out.connect(split);
        meterL = c.createAnalyser(); meterR = c.createAnalyser();
        meterL.fftSize = meterR.fftSize = 2048;
        split.connect(meterL, 0);
        split.connect(meterR, 1);
        ctx = c;
        c.addEventListener('statechange', () => { if (c.state === 'running') drawOutput(); });
        for (const m of mediaEls) m.volume = 1; // the volume now comes last, after the effects
        routed = null;
        route();
        tell();
        sync();
        // Your files now play through the local stream server (Web Audio gets silence from file:// audio).
        if (window.PlayerMedia) window.PlayerMedia.reroute();
        if (fx.on.vst && pluginsOn().length) startHost();
      } catch (e) {
        failed = `Effects couldn't start: ${e.message || e}`;
        paintIfOpen();
      } finally { starting = null; }
    })();
    return starting;
  }
  const elGain = new Map(); // player → its level (DJ mode's crossfades)
  const elPitch = new Map(); // player → { node, on } (DJ mode's key shifts)
  const elTime = new Map(); // player → { node, on } (the time shaper)
  // The time shaper follows the song: its time, the audio clock's frame then, and the playback rate.
  function timeClock(el, reset = false) {
    const t = elTime.get(el);
    if (!t || !ctx || !(t.on || t.slOn)) return;
    t.node.port.postMessage({ reset, clock: { song: el.currentTime, frame: Math.round(ctx.currentTime * ctx.sampleRate), rate: el.playbackRate || 1, playing: !el.paused && !el.ended } });
  }
  for (const m of mediaEls) {
    for (const ev of ['play', 'playing', 'ratechange', 'timeupdate', 'pause', 'ended', 'waiting']) m.addEventListener(ev, () => timeClock(m));
    for (const ev of ['seeked', 'loadeddata']) m.addEventListener(ev, () => timeClock(m, true));
  }
  const ALGO_LATENCY = { pv: 2048, wsola: 4096, pro: 4096, mono: 4096, resynth: 2048, chord: 2048 };
  let pitchAlgo = 'pv';
  try { const a = localStorage.getItem('nabbit.pitchAlgo'); if (ALGO_LATENCY[a]) pitchAlgo = a; } catch { /* default */ }
  // A player's engine: its own (DJ mode / Speed: useAlgo) or Audio Tools' (pitchAlgo).
  const algoOf = (p) => (p && p.own) || pitchAlgo;
  const NEUTRAL = { formantRatio: 1, voices: null, targets: null, robotHz: 130.81 };
  // Switches a player's engine: with a short dip when it can be heard.
  function switchAlgo(el, p, a) {
    if (p.algo === a) return;
    p.algo = a;
    const g = elGain.get(el);
    if (!p.on || !g || !ctx || el.paused) { p.node.port.postMessage({ algo: a }); return; }
    const t = ctx.currentTime, level = p.dipping ? p.level : g.gain.value;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.025);
    setTimeout(() => { p.node.port.postMessage({ algo: a }); const t2 = ctx.currentTime; g.gain.cancelScheduledValues(t2); g.gain.setValueAtTime(0, t2); g.gain.linearRampToValueAtTime(level, t2 + 0.04); }, 35);
  }
  let pitchExtra = { formantRatio: 1, voices: null, targets: null, robotHz: 130.81 };
  // Through the chain when any effect is on; straight to the volume when none is.
  let routed = null;
  function route() {
    if (!ctx) return;
    const on = anyOn();
    if (on === routed) return;
    routed = on;
    try { src.disconnect(); } catch { /* not connected */ }
    try { node.disconnect(); } catch { /* not connected */ }
    const last = on ? node : src;
    if (on) src.connect(node);
    last.connect(out);
    last.connect(analyser);
    if (beatAn) last.connect(beatAn);
  }
  // The settings, to the worklet.
  function tell() {
    if (!node) return;
    node.port.postMessage({ fx: { order: fx.order, on: fx.on, stereo: fx.stereo, eq: fx.eq }, vst: host.state === 'on' && loaded.size > 0 && fx.on.vst });
  }
  // The play bar's volume (player-mode.js calls this): true when it's applied here, after the effects.
  window.PlayerFx = {
    // How much the low end (the kick, ~40–160 Hz) rose since last asked: ≥ 0, about 0..1 for a hit;
    // null with no sound graph or nothing playing. Before the volume, so it doesn't follow the bar.
    pulse() {
      if (!beatAn || media.paused || ctx.state !== 'running') return null;
      if (!beatBuf) { beatBuf = new Uint8Array(beatAn.frequencyBinCount); beatPrev = new Float32Array(16); }
      beatAn.getByteFrequencyData(beatBuf);
      const hz = ctx.sampleRate / beatAn.fftSize, a = Math.max(1, Math.floor(40 / hz)), b = Math.min(15, Math.ceil(160 / hz));
      let f = 0;
      for (let k = a; k <= b; k++) { const v = beatBuf[k] / 255; f += Math.max(0, v - beatPrev[k]); beatPrev[k] = v; }
      return f / (b - a + 1);
    },
    output(g) {
      volume = g;
      if (!out) return false;
      out.gain.setTargetAtTime(g, ctx.currentTime, 0.015);
      return true;
    },
    // DJ mode: a player's level now (level) or along an equal-power curve over secs (fade: 'in' / 'out').
    // The curve runs on the audio clock, so it holds still while paused. false when there's no graph.
    level(el, v) {
      const g = elGain.get(el);
      if (!g) return false;
      g.gain.cancelScheduledValues(0);
      g.gain.value = v;
      return true;
    },
    // DJ mode's pitch shifter on a player: ratio (2^(semitones / 12)) turns it on, null off. Turn it on or off
    // only while that player is silent (its delay appears or goes). false when there isn't one.
    // dip: it can be heard: a 25 ms fade down, the switch, and back up (its delay comes or goes in the gap).
    pitch(el, ratio, { dip = false } = {}) {
      const p = elPitch.get(el);
      if (!p || !ctx) return false;
      const on = ratio != null && ratio > 0;
      if (on) p.node.parameters.get('ratio').setValueAtTime(Math.max(0.25, Math.min(4, ratio)), ctx.currentTime);
      if (on === p.on) return true;
      p.on = on;
      const g = elGain.get(el);
      if (!dip || !g) { p.node.port.postMessage({ on }); return true; }
      // The level to come back to: taken before the first dip (switching again mid-dip mustn't take
      // the dipped level as the real one).
      const t = ctx.currentTime;
      if (!p.dipping) p.level = g.gain.value;
      p.dipping = true;
      const level = p.level;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.025);
      clearTimeout(p.dipTimer);
      p.dipTimer = setTimeout(() => {
        p.node.port.postMessage({ on: p.on });
        const t2 = ctx.currentTime;
        g.gain.cancelScheduledValues(t2);
        g.gain.setValueAtTime(0, t2);
        g.gain.linearRampToValueAtTime(level, t2 + 0.04);
        setTimeout(() => { p.dipping = false; }, 50);
      }, 35);
      return true;
    },
    pitchOn: (el) => !!(elPitch.get(el) && elPitch.get(el).on),
    canPitch: () => elPitch.size > 0 && !!ctx,
    // Seconds a player's sound comes out later while its shifter is on (2048 samples).
    pitchLatency: (el) => (ctx && elPitch.get(el) && elPitch.get(el).on ? (ALGO_LATENCY[algoOf(elPitch.get(el))] || 2048) / ctx.sampleRate : 0),
    // A player's own engine (DJ mode's key shifts, Speed with Key lock), with plain settings (no formant
    // move, no chord); null: back to Audio Tools' engine and settings.
    useAlgo(el, a) {
      const p = elPitch.get(el);
      if (!p || !ctx) return false;
      const own = a && ALGO_LATENCY[a] ? a : null;
      if (own === p.own) return true;
      p.own = own;
      p.node.port.postMessage({ extra: own ? NEUTRAL : pitchExtra });
      switchAlgo(el, p, algoOf(p));
      return true;
    },
    // The pitch shifter's engine for every player: 'pv' (phase vocoder: smooth, best on full mixes) or
    // 'wsola' (time-domain: punchy, best on vocals and drums). Kept for next time. A player that's
    // shifting dips for a moment while it changes over (the delay changes too).
    get pitchAlgo() { return pitchAlgo; },
    // The metronome (Audio Tools' beat grid): a click at audio-clock time `when`, after the effects and
    // at the play bar's volume, so it lines up with what's heard. accent: the first beat of a bar.
    get now() { return ctx && ctx.state === 'running' ? ctx.currentTime : null; },
    clickAt(when, accent = false) {
      if (!ctx || !out) return false;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = accent ? 1760 : 1320;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(accent ? 0.55 : 0.32, when + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0005, when + 0.05);
      o.connect(g); g.connect(out);
      o.start(when); o.stop(when + 0.06);
      return true;
    },
    // The time shaper on a player: { shape: { points, curves, cycle, steps }, bpm, offset, from?, once? }, or null for
    // off. false when there isn't one.
    timeShape(el, o) {
      const t = elTime.get(el);
      if (!t || !ctx) return false;
      const on = !!(o && o.shape && o.bpm > 0);
      if (!on && !t.on) return true;
      const key = on ? JSON.stringify(o) : '';
      if (key === t.key) return true;
      t.key = key;
      t.on = on;
      // from (song s): starts there (the cycles counted from it); once: one cycle, then silence.
      t.node.port.postMessage(on ? { grid: { bpm: o.bpm, offset: o.offset || 0, ...(o.from != null ? { from: o.from, once: !!o.once } : {}) }, shape: o.shape } : { shape: null });
      if (on) timeClock(el);
      return true;
    },
    // Live slice stretch / slice map on a player: { key (the song), pcm (interleaved stereo f32 at
    // sampleRate), cuts (samples), mode: 'map' | 'stretch' }, or null for off. false when it can't.
    slices(el, o) {
      const t = elTime.get(el);
      if (!t || !ctx) return false;
      if (!o || !o.pcm) {
        if (t.slOn) { t.slOn = false; t.slKey = ''; t.node.port.postMessage({ slices: null }); }
        return true;
      }
      if (t.pcmKey !== o.key) {
        // The other player lets go of its copy (only one song is sliced at a time).
        for (const [m, u] of elTime) if (m !== el && u.pcmKey) { u.pcmKey = ''; u.slOn = false; u.slKey = ''; u.node.port.postMessage({ drop: true }); }
        t.pcmKey = o.key; t.node.port.postMessage({ pcm: o.pcm });
      }
      const sk = `${o.key}|${o.mode}|${o.cuts.length}|${o.cuts[0]}|${o.cuts[o.cuts.length - 1]}`;
      if (sk !== t.slKey || !t.slOn) { t.slKey = sk; t.slOn = true; t.node.port.postMessage({ slices: { cuts: o.cuts, mode: o.mode } }); }
      timeClock(el);
      return true;
    },
    get sampleRate() { return ctx ? ctx.sampleRate : 0; },
    // The engines' other settings: formantRatio (Pro, Mono, Resynth, Chord), targets (Chord: the notes
    // held, in Hz; null for none), robotHz (Resynth's note).
    pitchExtra(x) { Object.assign(pitchExtra, x || {}); for (const p of elPitch.values()) if (!p.own) p.node.port.postMessage({ extra: pitchExtra }); },
    setPitchAlgo(a) {
      if (!ALGO_LATENCY[a] || a === pitchAlgo) return;
      pitchAlgo = a;
      try { localStorage.setItem('nabbit.pitchAlgo', a); } catch { /* not kept */ }
      for (const [el, p] of elPitch) if (!p.own) switchAlgo(el, p, a);
    },
    // delay (s): held where it is until then (a transition effect plays out at full level first).
    fade(el, dir, secs, delay = 0) {
      const g = elGain.get(el);
      if (!g || !ctx) return false;
      const n = 64, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / (n - 1), a = (x * Math.PI) / 2; curve[i] = dir === 'in' ? Math.sin(a) : Math.cos(a); }
      g.gain.cancelScheduledValues(0);
      if (delay > 0) g.gain.setValueAtTime(dir === 'in' ? 0 : 1, ctx.currentTime);
      g.gain.setValueCurveAtTime(curve, ctx.currentTime + 0.005 + Math.max(0, delay), Math.max(0.05, secs));
      return true;
    },
    // Whether the player should play your files through the stream server (the effects are set up).
    routed: () => !!ctx,
    // Resolves once the effects are set up (so a song loaded now goes the right way from the start).
    ready: () => Promise.resolve(ensureAudio()).catch(() => {}),
    // The player switched to the other player (gapless).
    setActive(el) { if (mediaEls.includes(el)) { media = el; if (ctx) el.volume = 1; sync(); drawOutput(); } },
    // How far behind the player's clock the sound is (seconds): the processing buffer, the spectral
    // compressor's window (Mastering preset) and the plugins' delay. Lyrics and synced videos wait for it.
    delay() {
      if (!ctx || !routed) return 0;
      let d = ctx.baseLatency || 0;
      const on = (k) => fx.on[k];
      if (on('master')) d += 2048 / ctx.sampleRate;
      if (on('vst') && host.state === 'on' && loaded.size && pluginsOn().length) d += stats.delay || (6 * BLOCK) / ctx.sampleRate;
      return d;
    },
  };
  // The clock only runs while something plays.
  function sync() {
    if (!ctx) return;
    if (!media.paused && ctx.state === 'suspended') ctx.resume().catch(() => {});
    else if (media.paused && ctx.state === 'running') ctx.suspend().catch(() => {});
  }
  for (const m of mediaEls) for (const ev of ['play', 'playing', 'pause', 'ended']) m.addEventListener(ev, () => { if (m === media) sync(); });
  // Set up straight away (suspended until something plays): the volume meter and oscilloscope need it,
  // and your files then play through the stream server from the first song.
  setTimeout(() => ensureAudio(), 0);
  for (const m of mediaEls) for (const ev of ['play', 'playing']) m.addEventListener(ev, () => { ensureAudio(); if (m === media) drawOutput(); });

  // ---------- Volume meter (L/R) and oscilloscope, on the play bar ----------
  const vm = $('lp-vmeter'), osc = $('lp-osc');
  const css = (() => {
    const cache = new Map();
    let at = 0;
    return (n) => {
      const now = performance.now();
      if (now - at > 500) { cache.clear(); at = now; }
      if (!cache.has(n)) cache.set(n, getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888');
      return cache.get(n);
    };
  })();
  const fit = (c) => {
    if (!c) return null;
    const w = c.clientWidth, h = c.clientHeight, d = window.devicePixelRatio || 1;
    if (!w || !h) return null;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    return { g, w, h };
  };
  const bufL = new Float32Array(2048), bufR = new Float32Array(2048), mono = new Float32Array(2048);
  // The note's period, by autocorrelation over 40 Hz – 1 kHz (every 2nd sample), refined between samples.
  let period = 0;
  function findPeriod(sr) {
    const N = 2048, minLag = Math.floor(sr / 1000 / 2), maxLag = Math.min(N / 4, Math.ceil(sr / 40 / 2));
    const n = N / 2 - maxLag;
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += mono[i * 2] * mono[i * 2];
    if (e0 < 1e-6) return 0;
    const r = new Float32Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += mono[i * 2] * mono[(i + lag) * 2];
      r[lag] = s / e0;
    }
    let lag = minLag;
    while (lag < maxLag && r[lag] > 0.3) lag++;
    let best = -1;
    for (; lag < maxLag; lag++) if (r[lag] > 0.5 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { best = lag; break; }
    if (best < 0) return 0;
    const a = r[best - 1], b = r[best], c = r[best + 1];
    const off = (a - c) / (2 * (a - 2 * b + c)) || 0;
    return (best + Math.max(-0.5, Math.min(0.5, off))) * 2;
  }
  const lvl = { L: 0, R: 0, holdL: 0, holdR: 0, holdLAt: 0, holdRAt: 0, clipL: 0, clipR: 0 };
  let drawing = false, lastT = 0;
  const DB_MIN = -48;
  const xOfDb = (db, w) => Math.max(0, Math.min(1, (db - DB_MIN) / -DB_MIN)) * w;
  function drawMeter(t, dt, live) {
    const v = fit(vm);
    if (!v) return;
    const { g, w, h } = v;
    const fall = 10 ** ((-24 * dt) / 20); // 24 dB a second
    for (const [ch, an, buf] of [['L', meterL, bufL], ['R', meterR, bufR]]) {
      let pk = 0;
      if (live && an) { an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; } }
      lvl[ch] = Math.max(pk, lvl[ch] * fall);
      if (pk >= 0.999) lvl[`clip${ch}`] = t; // reached full scale: clipping at the output
      if (lvl[ch] >= lvl[`hold${ch}`] || t - lvl[`hold${ch}At`] > 1200) { lvl[`hold${ch}`] = lvl[ch]; lvl[`hold${ch}At`] = t; }
    }
    g.clearRect(0, 0, w, h);
    const bh = Math.floor((h - 2) / 2), red = css('--red'), text = css('--text'), line = css('--line');
    const m = 6; // the clip light at the right end
    [['L', 1], ['R', 1 + bh + 1]].forEach(([ch, y]) => {
      const W = w - m - 2;
      g.fillStyle = line; g.fillRect(0, y, W, bh);
      const db = lvl[ch] > 1e-6 ? 20 * Math.log10(lvl[ch]) : -120;
      // The whole bar turns red once that side reaches 0 dB (clipping), for a moment after.
      const clipping = t - lvl[`clip${ch}`] < 1500;
      const x = xOfDb(db, W);
      g.fillStyle = clipping ? red : text; g.fillRect(0, y, x, bh);
      const hdb = lvl[`hold${ch}`] > 1e-6 ? 20 * Math.log10(lvl[`hold${ch}`]) : -120;
      if (hdb > DB_MIN) { g.fillStyle = clipping ? red : text; g.fillRect(Math.max(0, xOfDb(hdb, W) - 1), y, 1.5, bh); }
      g.fillStyle = clipping ? red : line;
      g.fillRect(w - m, y, m, bh);
    });
    if (t - Math.max(lvl.clipL, lvl.clipR) < 1500) vm.parentElement.classList.add('clip'); else vm.parentElement.classList.remove('clip');
  }
  function drawOsc(dt, live) {
    const v = fit(osc);
    if (!v) return;
    const { g, w, h } = v;
    // Afterglow: what was there fades towards the panel colour.
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = Math.min(1, 0.5 * dt * 60);
    g.fillStyle = css('--panel'); g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.5; g.strokeStyle = css('--line'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    g.globalAlpha = 1;
    if (!live || !meterL) return;
    meterL.getFloatTimeDomainData(bufL); meterR.getFloatTimeDomainData(bufR);
    for (let i = 0; i < 2048; i++) mono[i] = (bufL[i] + bufR[i]) * 0.5;
    // Follows the pitch: 2 to 4 cycles of the note being played, ending on a rising zero crossing, so the
    // wave stands still; with no clear pitch, the last 20 ms as they come.
    const sr = ctx ? ctx.sampleRate : 48000;
    const p = findPeriod(sr);
    period = p ? (period && Math.abs(p - period) / period < 0.1 ? period * 0.7 + p * 0.3 : p) : 0;
    const span = Math.round(period ? Math.min(1800, Math.max(period * 2, Math.min(period * 4, sr * 0.03))) : Math.min(1800, sr * 0.02));
    let end = 2047;
    if (period) for (let i = 2046; i > 2046 - period * 1.5 && i > span; i--) if (mono[i] <= 0 && mono[i + 1] > 0) { end = i; break; }
    const s0 = Math.max(0, end - span);
    let pk = 0.02;
    for (let i = s0; i <= end; i++) pk = Math.max(pk, Math.abs(mono[i]));
    const gain = (h / 2 - 4) / Math.max(pk, 0.15);
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const j = s0 + (x / w) * (end - s0), i = Math.floor(j), f = j - i;
      const y = mono[i] + (mono[Math.min(2047, i + 1)] - mono[i]) * f;
      if (x) g.lineTo(x, h / 2 - y * gain); else g.moveTo(x, h / 2 - y * gain);
    }
    const light = matchMedia('(prefers-color-scheme: light)').matches && !document.documentElement.classList.contains('dark');
    g.globalCompositeOperation = light ? 'source-over' : 'lighter';
    g.strokeStyle = css('--text');
    g.globalAlpha = 0.12; g.lineWidth = 5; g.stroke();
    g.globalAlpha = 0.3; g.lineWidth = 2.2; g.stroke();
    g.globalAlpha = 0.95; g.lineWidth = 1; g.stroke();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  // Every screen frame while something plays and the play bar shows; a second more after it stops,
  // so the meter falls back and the trace fades.
  let stopAt = 0;
  function drawOutput() {
    if (drawing) return;
    drawing = true;
    stopAt = 0; // a pause from before doesn't count (the audio clock may take a moment to start again)
    lastT = performance.now();
    const step = (t) => {
      const dt = Math.min(0.1, (t - lastT) / 1000);
      lastT = t;
      const live = !media.paused && !!ctx && ctx.state === 'running';
      if (live) stopAt = 0; else if (!stopAt) stopAt = t;
      const barShown = !$('lp-bar').classList.contains('hidden') && !document.hidden;
      if (barShown) { drawMeter(t, dt, live); drawOsc(dt, live); }
      // Keeps going while the song is meant to play (the clock resuming), else stops a moment after.
      if (!live && media.paused && t - stopAt > 1500) { drawing = false; return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // The EQ's spectrum: what's heard, in 300 columns from 20 Hz to 20 kHz on a log scale (dB).
  let specBuf = null;
  const spectrum = () => {
    if (!analyser || media.paused) return null;
    if (!specBuf) specBuf = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(specBuf);
    const cols = new Float32Array(300), hz = ctx.sampleRate / analyser.fftSize;
    for (let i = 0; i < 300; i++) {
      const f0 = 20 * 1000 ** (i / 300), f1 = 20 * 1000 ** ((i + 1) / 300);
      let a = Math.floor(f0 / hz), b = Math.max(a, Math.floor(f1 / hz));
      let m = -200;
      for (let k = a; k <= b && k < specBuf.length; k++) if (specBuf[k] > m) m = specBuf[k];
      cols[i] = m + 6; // roughly the Mastering tool's scale
    }
    return cols;
  };

  // ---------- Plugins (the host program) ----------
  let host = { state: 'off', error: '' }; // off | starting | on | missing | stopped
  const loaded = new Set();
  let procAt = 0, procOrder = 0; // the host's last report (time) and how many plugins it's running
  function onWorklet(e) {
    const m = e.data;
    if (m.stats) { Object.assign(stats, m.stats); return; }
    if (m.seq == null || host.state !== 'on') return;
    const n = m.L.length;
    const buf = new ArrayBuffer(8 + 8 * n);
    const dv = new DataView(buf);
    dv.setUint32(0, m.seq, true); dv.setUint32(4, n, true);
    new Float32Array(buf, 8, n).set(m.L);
    new Float32Array(buf, 8 + 4 * n, n).set(m.R);
    window.api.vstAudio(new Uint8Array(buf));
  }
  if (window.api.onVstAudio) {
    window.api.onVstAudio((u8) => {
      if (!node) return;
      const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      if (ab.byteLength < 8) return;
      const dv = new DataView(ab);
      const seq = dv.getUint32(0, true), n = dv.getUint32(4, true);
      if (ab.byteLength < 8 + 8 * n) return;
      node.port.postMessage({ back: true, seq, L: new Float32Array(ab.slice(8, 8 + 4 * n)), R: new Float32Array(ab.slice(8 + 4 * n, 8 + 8 * n)) });
    });
    window.api.onVstEvent((m) => {
      if (m.ev === 'proc') {
        // The host's report, about once a second while audio reaches it: each plugin's blocks, result and levels.
        procAt = performance.now();
        procOrder = m.order;
        for (const r of m.plugins || []) { const p = fx.plugins.find((x) => x.id === r.id); if (p) p.proc = r; }
        return;
      }
      if (m.ev === 'state') {
        const p = fx.plugins.find((x) => x.id === m.id);
        if (p) { p.comp = m.comp || ''; p.ctrl = m.ctrl || ''; save(); }
      } else if (m.ev === 'exit') {
        loaded.clear();
        host = { state: 'stopped', error: 'The plugin host stopped (a plugin may have crashed). The music plays on without the plugins.' };
        tell();
        paintIfOpen();
      }
    });
  }
  async function startHost() {
    if (!window.api.vstStart || !ctx || host.state === 'starting') return;
    host = { state: 'starting', error: '' };
    paintIfOpen();
    const r = await window.api.vstStart(ctx.sampleRate, BLOCK).catch((e) => ({ ok: false, error: String(e.message || e) }));
    if (!r.ok) { host = { state: 'missing', error: r.error || "The plugin host couldn't start." }; paintIfOpen(); return; }
    host = { state: 'on', error: '' };
    for (const p of fx.plugins) await loadPlugin(p);
    sendOrder();
    paintIfOpen();
  }
  async function loadPlugin(p) {
    if (loaded.has(p.id) || host.state !== 'on') return;
    p.error = '';
    const r = await window.api.vstLoad(p.id, p.path, p.comp, p.ctrl).catch((e) => ({ ok: false, error: String(e.message || e) }));
    if (r.ok) { loaded.add(p.id); p.name = r.name || p.name; p.vendor = r.vendor || ''; p.editor = !!r.editor; save(); }
    else p.error = r.error || "Couldn't load.";
  }
  function sendOrder() {
    if (host.state === 'on') window.api.vstCmd('order', fx.on.vst ? fx.plugins.filter((p) => p.on && loaded.has(p.id)).map((p) => p.id) : []);
    tell();
  }
  // Settings are saved from the plugin when its window closes, and every half minute while it plays.
  setInterval(async () => {
    if (host.state !== 'on' || media.paused) return;
    for (const p of fx.plugins) {
      if (!loaded.has(p.id)) continue;
      const r = await window.api.vstState(p.id).catch(() => null);
      if (r && r.ok) { p.comp = r.comp || ''; p.ctrl = r.ctrl || ''; }
    }
    save();
  }, 30000);

  function changed() {
    if (anyOn()) ensureAudio();
    route();
    if (ctx && fx.on.vst && pluginsOn().length && (host.state === 'off')) startHost();
    sendOrder();
    btn.classList.toggle('on', anyOn());
    btn.title = anyOn() ? `Effects: ${fx.order.filter((k) => fx.on[k] && (k !== 'vst' || pluginsOn().length)).map((k) => NAMES[k]).join(' → ')}` : 'Effects';
    save();
  }

  // ---------- Panel ----------
  const pop = el('div', 'lp-fxpop hidden');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Effects');
  document.body.append(pop);
  function slider(label, min, max, step, get, set, fmt, dflt) {
    const row = el('label', 'lp-fx-sl');
    const v = el('em', '', fmt(get()));
    const r = el('input');
    r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(get());
    r.addEventListener('input', () => { set(Number(r.value)); v.textContent = fmt(get()); changed(); });
    r.addEventListener('dblclick', () => { r.value = String(dflt); r.dispatchEvent(new Event('input')); });
    r.title = 'Double-click to reset';
    row.append(el('span', '', label), r, v);
    return row;
  }
  function stereoBody() {
    const s = fx.stereo;
    const f = document.createDocumentFragment();
    f.append(
      slider('Mid', 0, 100, 1, () => s.mid, (x) => { s.mid = x; }, (x) => `${x}%`, 100),
      slider('Width', 0, 200, 1, () => s.width, (x) => { s.width = x; }, (x) => `${x}%`, 100),
      slider('Pan', -100, 100, 1, () => s.pan, (x) => { s.pan = x; }, (x) => (x ? `${Math.abs(x)}${x < 0 ? 'L' : 'R'}` : 'C'), 0),
    );
    return f;
  }
  let eqEd = null, statTimer = 0;
  function eqBody() {
    const f = document.createDocumentFragment();
    const cv = el('canvas', 'lp-fx-eqcv');
    cv.setAttribute('aria-label', 'EQ: drag a point to change a band, scroll to change its width, double-click to turn it on or off');
    const read = el('div', 'lp-fx-read');
    const tools = el('div', 'lp-fx-cuts');
    const flat = el('button', 'lp-fx-chip', 'Flat');
    flat.type = 'button';
    flat.title = 'Every band back to 0 dB';
    flat.addEventListener('click', () => { for (const b of fx.eq.bands) if (b.type !== 'hp' && b.type !== 'lp') b.gain = 0; changed(); if (eqEd) { eqEd.dirty(); eqEd.draw(); eqEd.read(); } });
    tools.append(flat);
    f.append(cv, read, tools);
    requestAnimationFrame(() => {
      eqEd = window.NabbitEqEditor(cv, { bands: () => fx.eq.bands, on: () => fx.on.eq, sampleRate: () => (ctx ? ctx.sampleRate : 48000), spectrum, changed, readout: read, height: 150 });
      eqEd.draw();
      // The spectrum moves while the song plays and the EQ is showing (about 30 times a second).
      const ed = eqEd;
      let last = 0;
      const loop = (t) => {
        if (eqEd !== ed || !cv.isConnected) return;
        if (!media.paused && routed !== null && t - last > 33) { last = t; ed.draw(); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    return f;
  }
  function vstBody() {
    const f = document.createDocumentFragment();
    if (host.error) f.append(el('p', 'lp-fx-note err', host.error));
    if (host.state === 'stopped') {
      const again = el('button', 'lp-fx-chip', 'Start the plugins again');
      again.type = 'button';
      again.addEventListener('click', () => { host = { state: 'off', error: '' }; ensureAudio(); startHost(); });
      f.append(again);
    }
    // What's going through: blocks sent to the plugins, blocks back, and the level going in.
    const list = el('ol', 'lp-fx-plugs');
    const stat = el('p', 'lp-fx-note lp-fx-stat');
    const showStat = () => {
      if (host.state !== 'on') { stat.textContent = host.state === 'starting' ? 'Starting the plugin host…' : ''; return; }
      const db = stats.peak > 1e-6 ? `${(20 * Math.log10(stats.peak)).toFixed(0)} dB` : 'silent';
      const reached = performance.now() - procAt < 2500;
      stat.textContent = media.paused ? 'Plugins ready · play something to send them audio'
        : `Sending audio · ${stats.sent} blocks out, ${stats.back} back${stats.late ? `, ${stats.late} late` : ''} · level in ${db}${stats.delay ? ` · ${Math.round(stats.delay * 1000)} ms behind` : ''}`
          + (stats.sent > 4 && !reached ? ' · the host isn\'t receiving it' : reached && !procOrder ? ' · the host has no plugins switched on' : '');
      for (const row of list.querySelectorAll('.lp-fx-plug')) {
        const p = fx.plugins.find((x) => String(x.id) === row.dataset.id);
        const line = row.querySelector('.lp-fx-proc');
        if (!p || !line) continue;
        const r = p.proc;
        const dbs = (x) => (x > 1e-6 ? `${(20 * Math.log10(x)).toFixed(0)} dB` : 'silent');
        line.textContent = !reached || !r || !p.on ? '' : r.res !== 0 ? `The plugin refused the audio (code ${r.res})` : `${r.inCh}→${r.outCh} ch · in ${dbs(r.in)} → out ${dbs(r.out)} · ${r.blocks} blocks/s`;
        line.classList.toggle('err', reached && !!r && r.res !== 0);
      }
    };
    showStat();
    clearInterval(statTimer);
    statTimer = setInterval(() => { if (!stat.isConnected) { clearInterval(statTimer); return; } showStat(); }, 500);
    f.append(stat);
    fx.plugins.forEach((p, i) => {
      const li = el('li', 'lp-fx-plug' + (p.on ? ' on' : '') + (p.error ? ' bad' : ''));
      const sw = el('button', 'lp-fx-sw small', p.on ? 'On' : 'Off');
      sw.type = 'button';
      sw.setAttribute('aria-pressed', String(p.on));
      sw.addEventListener('click', () => { p.on = !p.on; changed(); paint(); });
      const name = el('button', 'lp-fx-pname', p.name);
      name.type = 'button';
      name.title = p.error ? p.error : `${p.vendor ? `${p.vendor} · ` : ''}${p.path}\nClick to open its window`;
      name.addEventListener('click', async () => {
        if (!fx.on.vst) { fx.on.vst = true; changed(); }
        ensureAudio();
        if (host.state !== 'on') await startHost();
        await loadPlugin(p);
        sendOrder();
        if (loaded.has(p.id)) window.api.vstCmd('editor', p.id);
        paint();
      });
      const mv = (d) => {
        const b = el('button', 'lp-fx-mv', d < 0 ? '↑' : '↓');
        b.type = 'button';
        b.disabled = d < 0 ? i === 0 : i === fx.plugins.length - 1;
        b.addEventListener('click', () => { const j = i + d; [fx.plugins[i], fx.plugins[j]] = [fx.plugins[j], fx.plugins[i]]; changed(); paint(); });
        return b;
      };
      const rm = el('button', 'lp-fx-mv', '✕');
      rm.type = 'button';
      rm.setAttribute('aria-label', `Remove ${p.name}`);
      rm.addEventListener('click', () => { if (loaded.has(p.id)) { window.api.vstCmd('unload', p.id); loaded.delete(p.id); } fx.plugins.splice(i, 1); changed(); paint(); });
      li.dataset.id = String(p.id);
      li.append(sw, name, mv(-1), mv(1), rm, el('p', 'lp-fx-note lp-fx-proc'));
      if (p.error) li.append(el('p', 'lp-fx-note err', p.error));
      list.append(li);
    });
    f.append(list);
    // Adding a plugin: a list of your VST3 plugins that opens in the panel (not a drop-down: those
    // close whenever anything on the page scrolls, like the lyrics).
    const add = el('div', 'lp-fx-add');
    const pick = el('button', 'lp-fx-pick', 'Add a plugin ▾');
    pick.type = 'button';
    pick.setAttribute('aria-expanded', 'false');
    const more = el('button', 'lp-fx-chip', 'Add folder…');
    more.type = 'button';
    more.title = 'A folder with more VST3 plugins (C:\\Program Files\\Common Files\\VST3 is always looked in)';
    add.append(pick, more);
    const menu = el('div', 'lp-fx-menu hidden');
    menu.setAttribute('role', 'listbox');
    const filter = el('input', 'lp-fx-find');
    filter.type = 'text';
    filter.placeholder = 'Find a plugin…';
    filter.setAttribute('aria-label', 'Find a plugin');
    const items = el('div', 'lp-fx-items');
    menu.append(filter, items);
    f.append(add, menu);
    let found = [];
    const fill = (info) => {
      if (info) found = info.plugins || [];
      items.textContent = '';
      const q = filter.value.trim().toLowerCase();
      const list = found.filter((pl) => !q || pl.name.toLowerCase().includes(q));
      for (const pl of list) {
        const it = el('button', 'lp-fx-it', pl.name);
        it.type = 'button';
        it.title = pl.path;
        it.setAttribute('role', 'option');
        it.addEventListener('click', () => addPlugin(pl));
        items.append(it);
      }
      if (!list.length) items.append(el('p', 'lp-fx-note', found.length ? 'No match.' : 'No VST3 plugins found. Add a folder that has some.'));
    };
    const openMenu = (open) => {
      menu.classList.toggle('hidden', !open);
      pick.setAttribute('aria-expanded', String(open));
      if (open) { filter.value = ''; fill(); filter.focus(); }
    };
    pick.addEventListener('click', () => openMenu(menu.classList.contains('hidden')));
    filter.addEventListener('input', () => fill());
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); openMenu(false); pick.focus(); }
      else if (e.key === 'Enter') { const first = items.querySelector('.lp-fx-it'); if (first) first.click(); }
    });
    if (window.api.vstInfo) window.api.vstInfo().then((info) => { fill(info); if (info && !info.host && !host.error && !pop.querySelector('.lp-fx-nohost')) { const n = el('p', 'lp-fx-note err lp-fx-nohost', "The plugin host isn't built yet: see vsthost\\README.md."); add.before(n); } }).catch(() => {});
    async function addPlugin(pl) {
      openMenu(false);
      const id = Math.max(0, ...fx.plugins.map((x) => x.id)) + 1;
      const p = { id, path: pl.path, name: pl.name, on: true, comp: '', ctrl: '' };
      fx.plugins.push(p);
      fx.on.vst = true;
      changed();
      ensureAudio();
      if (host.state === 'on') { await loadPlugin(p); sendOrder(); } else await startHost();
      paint();
    }
    more.addEventListener('click', async () => { const info = await window.api.vstAddFolder().catch(() => null); if (info) fill(info); });
    return f;
  }
  function paint() {
    pop.textContent = '';
    eqEd = null;
    const head = el('div', 'lp-fx-head');
    head.append(el('b', '', 'Effects'), el('span', 'dim', 'top to bottom, then the volume'));
    pop.append(head);
    if (failed) pop.append(el('p', 'lp-fx-note err', failed));
    const list = el('ol', 'lp-fx-chain');
    fx.order.forEach((k, i) => {
      const li = el('li', 'lp-fx-item' + (fx.on[k] ? ' on' : '') + (fx.open === k ? ' open' : ''));
      const top = el('div', 'lp-fx-top');
      const sw = el('button', 'lp-fx-sw', fx.on[k] ? 'On' : 'Off');
      sw.type = 'button';
      sw.setAttribute('aria-pressed', String(fx.on[k]));
      sw.setAttribute('aria-label', `${NAMES[k]} on`);
      sw.addEventListener('click', () => { fx.on[k] = !fx.on[k]; changed(); paint(); });
      const label = k === 'vst' && fx.plugins.length ? `${NAMES[k]} · ${fx.plugins.length}` : NAMES[k];
      const name = el('button', 'lp-fx-name', label);
      name.type = 'button';
      name.title = HINTS[k];
      const hasBody = k !== 'master';
      if (hasBody) name.addEventListener('click', () => { fx.open = fx.open === k ? null : k; save(); paint(); });
      else name.classList.add('flat');
      const mv = (d) => {
        const b = el('button', 'lp-fx-mv', d < 0 ? '↑' : '↓');
        b.type = 'button';
        b.disabled = d < 0 ? i === 0 : i === fx.order.length - 1;
        b.setAttribute('aria-label', `Move ${NAMES[k]} ${d < 0 ? 'up' : 'down'}`);
        b.addEventListener('click', () => { const j = i + d; [fx.order[i], fx.order[j]] = [fx.order[j], fx.order[i]]; changed(); paint(); });
        return b;
      };
      top.append(sw, name, mv(-1), mv(1));
      li.append(top);
      if (k === 'master') li.append(el('p', 'lp-fx-note', HINTS.master));
      if (hasBody && fx.open === k) {
        const body = el('div', 'lp-fx-body');
        body.append(k === 'stereo' ? stereoBody() : k === 'eq' ? eqBody() : vstBody());
        li.append(body);
      }
      list.append(li);
    });
    pop.append(list);
  }
  const paintIfOpen = () => { if (!pop.classList.contains('hidden')) paint(); };
  function place() {
    const r = btn.getBoundingClientRect();
    pop.style.right = `${Math.max(8, window.innerWidth - r.right - 60)}px`;
    pop.style.bottom = `${window.innerHeight - r.top + 10}px`;
  }
  function toggle(open = pop.classList.contains('hidden')) {
    if (open) { paint(); place(); }
    pop.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  document.addEventListener('mousedown', (e) => { if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.classList.contains('hidden')) toggle(false); });
  window.addEventListener('resize', () => { if (!pop.classList.contains('hidden')) place(); });
  btn.classList.toggle('on', anyOn());
  btn.title = anyOn() ? `Effects: ${fx.order.filter((k) => fx.on[k] && (k !== 'vst' || pluginsOn().length)).map((k) => NAMES[k]).join(' → ')}` : 'Effects';
})();
