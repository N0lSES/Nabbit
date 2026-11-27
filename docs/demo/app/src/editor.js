// Audio Tools · Key & BPM finder. Laid out like a key-detection plugin: pick the source (a file, or
// manual), read the result (BPM with ÷2 / ×2, key with its relative major / minor, tuning, Camelot),
// choose a scale, and see it on the piano. The analysis is analyzer.js, run by main.js on the file.
(function () {
  const $ = (id) => document.getElementById(id);
  const A = window.Analyzer;
  if (!A || !$('ak-piano')) return;

  const state = {
    method: 'file',
    file: null,
    bpm: null,          // shown (after ÷2 / ×2)
    baseBpm: null,      // detected / typed; ÷2 and ×2 go one step either way from it
    factor: 1,          // 0.5 · 1 · 2
    tonic: null,        // 0–11
    mode: 'major',
    scale: 'major',
    tuning: 440,
    result: null,       // the analysis
    busy: false,
  };
  const keyLabel = (t, m) => `${A.noteName(t, m)} ${m === 'major' ? 'Major' : 'Minor'}`;
  const relOf = (t, m) => (m === 'major' ? { tonic: (t + 9) % 12, mode: 'minor' } : { tonic: (t + 3) % 12, mode: 'major' });
  const tagKey = () => (state.tonic == null ? '' : A.noteName(state.tonic, state.mode) + (state.mode === 'minor' ? 'm' : ''));
  const fmtBpm = (b) => (b == null ? '---' : Number.isInteger(b) ? String(b) : b.toFixed(1));

  // ---------- Selects ----------
  for (const [v, s] of Object.entries(A.SCALES)) $('ak-scale').append(new Option(s.name, v));
  for (let i = 0; i < 12; i++) $('ak-root').append(new Option(A.NOTES_FLAT[i] === A.NOTES_SHARP[i] ? A.NOTES_SHARP[i] : `${A.NOTES_SHARP[i]} / ${A.NOTES_FLAT[i]}`, String(i)));

  // ---------- Piano: two octaves from C; the scale's keys are lit and named, the tonic in red ----------
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  // The note sound: a recorded middle C (assets/note.wav, C4 = MIDI 60) played faster or slower
  // for each key (playback rate = the interval as a frequency ratio, at the song's tuning).
  const NOTE_MIDI = 60;
  const sample = new Audio('assets/note.wav');
  sample.preload = 'auto';
  function tone(midi) {
    try {
      const a = sample.cloneNode();
      a.preservesPitch = false;
      a.playbackRate = 2 ** ((midi - NOTE_MIDI) / 12) * (state.tuning / 440);
      a.volume = 0.9;
      a.play().catch(() => {});
    } catch { /* no audio output */ }
  }
  function renderPiano() {
    const box = $('ak-piano');
    box.innerHTML = '';
    const lit = state.tonic == null ? new Set() : new Set(A.scaleNotes(state.tonic, state.scale));
    const flats = state.tonic == null || !A.noteName(state.tonic, state.mode).includes('#');
    const names = flats ? A.NOTES_FLAT : A.NOTES_SHARP;
    const whites = [];
    for (let oct = 0; oct < 2; oct++) for (const pc of WHITE) whites.push({ pc, midi: 60 + oct * 12 + pc });
    whites.push({ pc: 0, midi: 84 });
    const W = 100 / whites.length;
    const key = (pc, midi, black, left) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pk ${black ? 'black' : 'white'}${lit.has(pc) ? ' lit' : ''}${pc === state.tonic ? ' root' : ''}`;
      b.style.left = `${left}%`;
      b.style.width = `${black ? W * 0.62 : W}%`;
      b.setAttribute('aria-label', `${names[pc]}${lit.has(pc) ? ' (in the scale)' : ''}`);
      if (lit.has(pc)) b.append(Object.assign(document.createElement('span'), { textContent: names[pc] }));
      b.onclick = () => tone(midi);
      return b;
    };
    whites.forEach((w, i) => box.append(key(w.pc, w.midi, false, i * W)));
    whites.forEach((w, i) => {
      if (i === whites.length - 1 || [4, 11].includes(w.pc)) return; // no black key after E and B
      box.append(key((w.pc + 1) % 12, w.midi + 1, true, (i + 1) * W - W * 0.31));
    });
  }

  // ---------- Result box ----------
  function render() {
    $('ak-bpm').textContent = fmtBpm(state.bpm);
    $('ak-half').disabled = state.bpm == null || state.factor <= 0.5;
    $('ak-dbl').disabled = state.bpm == null || state.factor >= 2;
    $('ak-half').classList.toggle('on', state.factor === 0.5);
    $('ak-dbl').classList.toggle('on', state.factor === 2);
    if (state.tonic == null) {
      $('ak-key').textContent = '-- -----';
      $('ak-relname').textContent = '—';
      $('ak-cam').textContent = 'Camelot --';
      $('ak-swap').disabled = true;
    } else {
      $('ak-key').textContent = keyLabel(state.tonic, state.mode);
      const r = relOf(state.tonic, state.mode);
      $('ak-relname').textContent = keyLabel(r.tonic, r.mode);
      $('ak-cam').textContent = `Camelot ${A.camelot(state.tonic, state.mode)}`;
      $('ak-swap').disabled = false;
    }
    const t = Math.round(state.tuning * 10) / 10;
    $('ak-tune').textContent = `A=${Number.isInteger(t) ? t : t.toFixed(1)}Hz`;
    $('ak-tune').classList.toggle('off', Math.abs(state.tuning - 440) >= 0.5);
    $('ak-scale').value = state.scale;
    $('ak-tags').disabled = !(state.method === 'file' && state.file && (state.bpm != null || state.tonic != null)) || state.busy;
    renderPiano();
  }
  function setKey(tonic, mode) {
    state.tonic = tonic;
    state.mode = mode;
    // The scale follows the key's mode unless a non-major/minor scale was picked.
    if (['major', 'minor'].includes(state.scale) || state.scale === 'chromatic') state.scale = mode === 'major' ? 'major' : 'minor';
    $('ak-root').value = String(tonic);
    $('ak-mode').value = mode;
    render();
  }

  // ---------- Methods ----------
  function setMethod(m) {
    state.method = m;
    for (const b of document.querySelectorAll('.ak-method')) {
      const on = b.dataset.m === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    $('ak-manual').classList.toggle('hidden', m !== 'manual');
    if (m === 'manual' && state.tonic == null) setKey(Number($('ak-root').value) || 0, $('ak-mode').value);
    status(m === 'manual' ? 'Pick a key to see its scale; tap along for the tempo.' : state.file ? '' : 'Drop a song on “Use file”, or click it to choose one.');
    render();
  }
  const status = (text, err) => { $('ak-status').textContent = text || ''; $('ak-status').classList.toggle('err', !!err); };

  async function analyze(file) {
    if (!file || state.busy) return;
    state.file = file;
    state.busy = true;
    setMethod('file');
    $('ak-file').textContent = file.split(/[\\/]/).pop();
    $('ak-file').title = file;
    $('ak-result').classList.add('busy');
    status('Listening to the song…');
    try {
      const r = await window.api.edAnalyze(file);
      state.result = r;
      setBpm(r.tempo ? r.tempo.bpm : null);
      state.tuning = r.key.tuningHz || 440;
      setKey(r.key.tonic, r.key.mode);
      const sure = Math.round(r.key.confidence * 100);
      const alt = r.key.alternatives && r.key.alternatives[0];
      status(`Key ${sure}% sure${alt && sure < 70 ? ` · could also be ${alt.name}` : ''}${r.tempo ? ` · first beat at ${r.tempo.offset.toFixed(2)} s` : ' · too short for a tempo'}`);
    } catch (e) {
      status(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    } finally {
      state.busy = false;
      $('ak-result').classList.remove('busy');
      render();
    }
  }

  $('ak-m-file').addEventListener('click', async () => {
    if (state.method !== 'file' && state.file) return setMethod('file');
    const f = await window.api.pickFile([{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'wma', 'alac', 'ape', 'wv', 'mp4', 'mkv', 'webm', 'mov'] }]);
    if (f) analyze(f);
  });
  $('ak-m-manual').addEventListener('click', () => setMethod('manual'));
  // ---------- Tool list: each tool folds down to one row; all start folded ----------
  const tools = [...document.querySelectorAll('#ed-tools > .ed-tool')];
  const allBtn = $('ed-tools-all');
  for (const t of tools) t.open = false;
  try { localStorage.removeItem('nabbit.edTools'); } catch { /* no storage */ }
  const syncAll = () => {
    allBtn.textContent = tools.some((t) => t.open) ? 'Collapse all' : 'Expand all';
    $('ed-tools-n').textContent = String(tools.length);
  };
  for (const t of tools) t.addEventListener('toggle', syncAll);
  allBtn.addEventListener('click', () => { const open = !tools.some((t) => t.open); for (const t of tools) t.open = open; syncAll(); });
  syncAll();

  // Drop anywhere on the finder (it opens if it was folded).
  const ak = document.querySelector('.ak');
  ak.addEventListener('dragover', (e) => { e.preventDefault(); ak.classList.add('over'); });
  ak.addEventListener('dragleave', (e) => { if (!ak.contains(e.relatedTarget)) ak.classList.remove('over'); });
  ak.addEventListener('drop', (e) => {
    e.preventDefault();
    ak.classList.remove('over');
    ak.open = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    const p = f && window.api.pathForFile(f);
    if (p) analyze(p);
  });

  // ---------- Controls ----------
  // One step either way: ×2 then ÷2 comes back to the detected tempo, never 4× or ¼.
  const setBpm = (b) => { state.baseBpm = b; state.factor = 1; state.bpm = b; };
  const step = (f) => {
    if (state.baseBpm == null) return;
    state.factor = Math.max(0.5, Math.min(2, state.factor * f));
    state.bpm = Math.round(state.baseBpm * state.factor * 10) / 10;
    render();
  };
  $('ak-half').onclick = () => step(0.5);
  $('ak-dbl').onclick = () => step(2);
  $('ak-swap').onclick = () => { if (state.tonic != null) { const r = relOf(state.tonic, state.mode); setKey(r.tonic, r.mode); } };
  $('ak-scale').onchange = () => { state.scale = $('ak-scale').value; render(); };
  $('ak-root').onchange = () => setKey(Number($('ak-root').value), $('ak-mode').value);
  $('ak-mode').onchange = () => setKey(Number($('ak-root').value), $('ak-mode').value);
  $('ak-bpm-in').oninput = () => { const v = Number($('ak-bpm-in').value); setBpm(v > 0 ? v : null); render(); };

  // Tap tempo: the average of the last taps; a pause of 2 s starts over.
  let taps = [];
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    taps = taps.slice(-12);
    $('ak-tap').classList.add('hit');
    setTimeout(() => $('ak-tap').classList.remove('hit'), 90);
    if (taps.length < 3) { status(`Keep tapping… (${taps.length})`); return; }
    const gap = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(Math.round((60000 / gap) * 10) / 10);
    if (state.method === 'manual') $('ak-bpm-in').value = state.bpm;
    status(`Tapped ${taps.length} times`);
    render();
  }
  $('ak-tap').onclick = tap;
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!$('editor').classList.contains('active') || !ak.open || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    tap();
  });

  $('ak-copy').onclick = async () => {
    const text = [state.bpm != null ? `${fmtBpm(state.bpm)} BPM` : null, state.tonic != null ? `${keyLabel(state.tonic, state.mode)} (${A.camelot(state.tonic, state.mode)})` : null,
      Math.abs(state.tuning - 440) >= 0.5 ? `A=${state.tuning}Hz` : null].filter(Boolean).join(' · ');
    try { await navigator.clipboard.writeText(text); status(`Copied: ${text}`); } catch { status(text); }
  };
  $('ak-tags').onclick = async () => {
    if (!state.file) return;
    $('ak-tags').disabled = true;
    try {
      await window.api.edTags(state.file, { bpm: state.bpm, key: tagKey() });
      status(`Saved in the file's tags: ${[state.bpm != null ? `${Math.round(state.bpm)} BPM` : null, tagKey() || null].filter(Boolean).join(' · ')}`);
    } catch (e) {
      status(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    } finally { render(); }
  };

  window.EditorUI = { analyze };
  render();
})();
