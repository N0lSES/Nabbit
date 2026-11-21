// Audio scrubbing for the Trimmer, AudioStretch-style: while you drag along the timeline the audio
// follows the pointer at its speed (slow drag = slow playback) without changing pitch, and holding
// still keeps the sound at that spot ringing ("frozen" at zero speed) so you can hear the note.
//
// How: WSOLA-style granular playback. Every 40 ms a new 80 ms grain of the original audio starts near
// the (smoothed) pointer position, read at normal speed and shaped with a Hann window (half-overlapping
// Hann windows add up to a flat level). Each grain's start is nudged (±12 ms) to where the audio lines
// up best with the grain before it, so they join without phase cancellation: a held note sounds steady
// instead of warbling. Samples come from main.js (mono, 11–22 kHz).
(function () {
  const GRAIN = 0.08;   // seconds per grain
  const SEARCH = 0.012; // how far a grain's start may move to line up with the previous one (seconds)
  const MATCH = 0.008;  // length compared when lining up (seconds)
  const FOLLOW = 0.025; // how quickly the play position catches up with the pointer (seconds)
  const FADE = 0.06;    // fade in / out (seconds)

  let ctx = null, node = null, gainNode = null;
  let data = null, srcRate = 22050;
  let target = 0, cur = 0, on = false, level = 0;
  let sinceGrain = Infinity, idleBlocks = 0, last = null; // last: where the previous grain started (source samples)
  const grains = [];
  let win = null; // Hann window, one per grain length

  function ensure() {
    if (ctx) return;
    ctx = new AudioContext({ latencyHint: 'interactive' });
    // ScriptProcessor: no extra module file to load, and fine for one small mono voice.
    node = ctx.createScriptProcessor(512, 0, 1);
    gainNode = ctx.createGain();
    gainNode.gain.value = 0.9;
    node.onaudioprocess = process;
    node.connect(gainNode);
  }
  function process(e) {
    const out = e.outputBuffer.getChannelData(0);
    const sr = ctx.sampleRate;
    if (!data || (!on && level < 1e-4 && !grains.length)) { out.fill(0); if (++idleBlocks > 8) sleep(); return; }
    idleBlocks = 0;
    const glen = Math.round(GRAIN * sr), hop = glen >> 1;
    if (!win || win.length !== glen) { win = new Float32Array(glen); for (let i = 0; i < glen; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (glen - 1)); }
    const step = srcRate / sr;                  // source samples per output sample: pitch stays the same
    const follow = 1 - Math.exp(-1 / (FOLLOW * sr));
    const fade = 1 / (FADE * sr);
    const norm = 1;                              // half-overlapping Hann windows sum to 1
    const n = data.length;
    for (let i = 0; i < out.length; i++) {
      cur += (target - cur) * follow;
      level = on ? Math.min(1, level + fade) : Math.max(0, level - fade);
      if (++sinceGrain >= hop && level > 0) {
        sinceGrain = 0;
        const want = cur * srcRate;
        // Where the previous grain's audio naturally continues; start the new grain at the spot near
        // `want` that matches it best.
        const pos = last == null ? want : bestMatch(want, last + hop * step);
        grains.push({ pos, k: 0 });
        last = pos;
      }
      let v = 0;
      for (let g = grains.length - 1; g >= 0; g--) {
        const gr = grains[g];
        const p = gr.pos | 0, f = gr.pos - p;
        if (p >= 0 && p + 1 < n) v += (data[p] + (data[p + 1] - data[p]) * f) * win[gr.k];
        gr.pos += step;
        if (++gr.k >= glen) grains.splice(g, 1);
      }
      out[i] = v * norm * level;
    }
  }
  function bestMatch(want, natural) {
    const n = data.length;
    const search = Math.round(SEARCH * srcRate), len = Math.round(MATCH * srcRate);
    const nat = Math.round(natural), w = Math.round(want);
    if (nat < 0 || nat + len >= n) return want;
    let best = w, bestScore = -Infinity;
    const from = Math.max(0, w - search), to = Math.min(n - len - 1, w + search);
    for (let c = from; c <= to; c++) {
      let sc = 0;
      for (let k = 0; k < len; k++) sc += data[nat + k] * data[c + k];
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best;
  }
  // The processor only runs while connected to the speakers: connect while scrubbing, disconnect after.
  function wake() { ensure(); if (!wake.connected) { gainNode.connect(ctx.destination); wake.connected = true; } if (ctx.state === 'suspended') ctx.resume(); }
  function sleep() { if (wake.connected) { try { gainNode.disconnect(); } catch {} wake.connected = false; } if (ctx && ctx.state === 'running') ctx.suspend(); }

  window.Scrubber = {
    // samples: Int16 mono (Uint8Array from main.js), rate: its sample rate. null clears.
    load(bytes, rate) {
      grains.length = 0; on = false; level = 0; last = null;
      if (!bytes) { data = null; return; }
      const i16 = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~1)));
      data = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) data[i] = i16[i] / 32768;
      srcRate = rate || 22050;
    },
    get ready() { return !!data; },
    // Start scrubbing at time t (seconds); jumps straight there.
    start(t) { if (!data) return; wake(); target = cur = t; sinceGrain = Infinity; last = null; on = true; },
    move(t) { target = t; },
    stop() { on = false; },
  };
})();
