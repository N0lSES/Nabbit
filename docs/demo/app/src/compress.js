// Compressor screen: a queue of any mix of files (video, audio, image, GIF, PDF), one set of settings per
// kind (edited in the right-hand panel for the selected file's kind), size estimates, and one job per file
// run one after another. The rules (ffmpeg / Ghostscript arguments, estimates) are in ../compressor.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const C = window.Compressor;
  const KEY = 'nabbit-compressor';
  const BADGE = { video: 'VID', audio: 'AUD', image: 'IMG', gif: 'GIF', pdf: 'PDF' };
  const TITLE = { video: 'Video', audio: 'Audio', image: 'Image', gif: 'GIF', pdf: 'PDF' };

  // Settings per kind, remembered between sessions.
  let settings = JSON.parse(JSON.stringify(C.DEFAULTS));
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k of Object.keys(settings)) Object.assign(settings[k], saved[k] || {}); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

  let items = [];      // { id, path, name, kind, size, duration, width, height, state, progress, outSize, outPath, error, jobId }
  let sel = 0;
  let running = false;
  let nextId = 1;

  const mb = (b) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e7 ? `${Math.round(b / 1e6)} MB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const after = (it) => (it.state === 'done' ? it.outSize : it.state === 'kept' ? it.size : C.estimate(it, settings[it.kind]));

  // ---------- Adding files ----------
  async function add(paths) {
    if (!paths || !paths.length) return;
    document.querySelector('.tab[data-tool="compress"]')?.click();
    $('cp-empty').textContent = 'Reading the files…';
    $('cp-empty').classList.remove('hidden');
    let found = [];
    try { found = await window.api.cpScan(paths); } catch {}
    const have = new Set(items.map((i) => i.path));
    for (const f of found) if (!have.has(f.path)) items.push({ ...f, id: nextId++, state: 'queued', progress: 0 });
    $('cp-empty').textContent = items.length ? '' : "None of those can be compressed here (video, audio, images, GIFs and PDFs can).";
    if (found.length && !items[sel]) sel = 0;
    render();
  }

  // ---------- Settings panel (for the selected file's kind) ----------
  function group(label, options, value, onPick, extra = '') {
    const box = document.createElement('div');
    box.className = 'tm-opt cp-opt';
    const lab = document.createElement('span');
    lab.className = 'tm-lab';
    lab.textContent = label;
    const seg = document.createElement('div');
    seg.className = `tm-seg cp-seg ${extra}`;
    for (const [v, text, tip] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (v === value ? ' active' : '');
      b.textContent = text;
      if (tip) b.title = tip;
      b.onclick = () => { onPick(v); save(); render(); };
      seg.append(b);
    }
    box.append(lab, seg);
    return box;
  }
  const word = (q) => (q >= 80 ? 'High' : q >= 50 ? 'Balanced' : q >= 25 ? 'Small' : 'Tiny');
  function slider(label, value, onInput, { min = 0, max = 100, fmt = word, ends = ['Smaller', 'Better'], fun = false } = {}) {
    const box = document.createElement('div');
    box.className = 'tm-opt cp-opt';
    const lab = document.createElement('span');
    lab.className = 'tm-lab';
    lab.textContent = `${label} · ${fmt(value)}`;
    const r = Object.assign(document.createElement('input'), { type: 'range', min, max, value, className: 'cp-range' + (fun ? ' fun' : '') });
    r.setAttribute('aria-label', label);
    r.oninput = () => { onInput(Number(r.value)); lab.textContent = `${label} · ${fmt(Number(r.value))}`; renderNumbers(); };
    r.onchange = save;
    const e = document.createElement('div');
    e.className = 'cp-ends';
    for (const t of ends) e.append(Object.assign(document.createElement('span'), { textContent: t }));
    box.append(lab, r, e);
    return box;
  }
  // Fun mode: deliberately crushed. Sliders for compression amount, resolution and audio, all going very low.
  function funSliders(body, k, s, it) {
    s.fun = { ...C.DEFAULTS[k].fun, ...(s.fun || {}) };
    const f = s.fun;
    const aud = (q) => { const a = C.funAudio(q); return `${a.rate >= 44100 ? '44.1' : a.rate / 1000} kHz${a.mono ? ' · mono' : ''}${a.bits ? ` · ${a.bits}-bit` : ''}`; };
    const p = document.createElement('p');
    p.className = 'hint small cp-fun-note';
    p.textContent = k === 'audio' ? 'Crunchy on purpose: phone-call, walkie-talkie, deep-fried. Saved as MP3.' : k === 'image' ? 'Deep-fried on purpose. Saved as a JPEG.' : 'Deep-fried on purpose. Saved as an MP4 (H.264).';
    body.append(p);
    body.append(slider('Compression', f.crush, (v) => (f.crush = v), {
      fmt: (v) => (k === 'audio' ? `${v}% · ${C.funAudio(100 - v).kbps} kbps` : `${v}%`), ends: ['Light', 'Destroyed'], fun: true }));
    if (k !== 'audio') {
      body.append(slider('Resolution', f.res, (v) => (f.res = v), {
        min: 1, fmt: (v) => { const d = C.funSize(it.width, it.height, v); return `${v}%${d ? ` · ${d[0]}×${d[1]}` : ''}`; }, ends: ['Tiny', 'Full'], fun: true }));
    }
    if (k !== 'image') {
      body.append(slider('Audio', f.audio, (v) => (f.audio = v), {
        fmt: (v) => (k === 'video' ? `${C.funAudio(v).kbps} kbps · ${aud(v)}` : aud(v)), ends: ['Crunchy', 'Clean'], fun: true }));
    }
  }
  function toggle(label, value, onChange) {
    const l = document.createElement('label');
    l.className = 'check cp-toggle';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: value });
    cb.onchange = () => { onChange(cb.checked); save(); render(); };
    l.append(cb, ` ${label}`);
    return l;
  }
  function renderSettings() {
    const body = $('cp-set-body');
    body.innerHTML = '';
    const it = items[sel];
    if (!it) { $('cp-set-title').textContent = '■ Settings'; $('cp-set-count').textContent = ''; body.innerHTML = '<p class="hint small">Add files to see their settings.</p>'; return; }
    const k = it.kind, s = settings[k];
    const n = items.filter((x) => x.kind === k).length;
    $('cp-set-title').textContent = `■ ${TITLE[k]} settings`;
    $('cp-set-count').textContent = `${n} file${n > 1 ? 's' : ''}`;
    if (k === 'video') {
      body.append(group('Mode', [['size', 'Fit size', 'Aim for a file size (e.g. an upload limit)'], ['quality', 'Quality', 'Pick a quality; the size follows'], ['fun', 'Fun', 'Deliberately crushed, for laughs']], s.mode, (v) => (s.mode = v)));
      if (s.mode === 'fun') return funSliders(body, k, s, it);
      if (s.mode === 'size') body.append(group('Fit to', [8, 10, 25, 50, 100].map((v) => [v, `${v} MB`]), s.targetMB, (v) => (s.targetMB = v), 'wrap'));
      else body.append(slider('Quality', s.q, (v) => (s.q = v)));
      body.append(group('Codec', [['h264', 'H.264', 'Plays everywhere'], ['h265', 'H.265', 'About 40% smaller at the same quality; most devices play it'], ['av1', 'AV1', 'Smallest; newer devices and browsers']], s.codec, (v) => (s.codec = v)));
      body.append(group('Resolution', [[null, 'Keep'], [1080, '1080p'], [720, '720p'], [480, '480p']], s.height, (v) => (s.height = v)));
      body.append(group('Audio', [['keep', 'Keep'], ['128', '128k'], ['96', '96k'], ['mute', 'Mute']], s.audio, (v) => (s.audio = v)));
      body.append(group('Encoder', [['cpu', 'CPU', 'Best quality per MB'], ['nvenc', 'NVIDIA', 'Much faster (NVENC); falls back to the CPU without one'], ['amf', 'AMD', 'Much faster (AMF); falls back to the CPU without one']], s.hw, (v) => (s.hw = v)));
      body.append(group('Effort', [['fast', 'Fast', 'Quick, a bit bigger or blurrier'], ['balanced', 'Balanced', 'Slow presets: better picture for the size'], ['best', 'Best', 'Slowest presets: the most picture per MB']], s.effort || 'balanced', (v) => (s.effort = v)));
    } else if (k === 'image') {
      body.append(group('Mode', [['normal', 'Normal'], ['fun', 'Fun', 'Deliberately crushed, for laughs']], s.mode || 'normal', (v) => (s.mode = v)));
      if (s.mode === 'fun') return funSliders(body, k, s, it);
      body.append(slider('Quality', s.q, (v) => (s.q = v)));
      body.append(group('Format', [['keep', 'Keep', 'HEIC, BMP and TIFF become JPEG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['avif', 'AVIF']], s.format, (v) => (s.format = v)));
      body.append(group('Longest side', [[null, 'Keep'], [2560, '2560'], [1920, '1920'], [1280, '1280']], s.maxSide, (v) => (s.maxSide = v)));
      const p = document.createElement('p');
      p.className = 'hint small';
      p.textContent = 'Location and camera info is removed. PNGs below High quality are reduced to 256 colours.';
      body.append(p);
    } else if (k === 'audio') {
      body.append(group('Mode', [['normal', 'Normal'], ['fun', 'Fun', 'Deliberately crushed, for laughs']], s.mode || 'normal', (v) => (s.mode = v)));
      if (s.mode === 'fun') return funSliders(body, k, s, it);
      body.append(group('Bitrate', [64, 96, 128, 192, 256].map((v) => [v, `${v}k`]), s.kbps, (v) => (s.kbps = v), 'wrap'));
      body.append(group('Format', [['mp3', 'MP3'], ['aac', 'AAC'], ['opus', 'Opus', 'Best sound per MB'], ['keep', 'Keep', 'WAV / FLAC become MP3']], s.format, (v) => (s.format = v)));
      body.append(group('Channels', [[false, 'Stereo'], [true, 'Mono', 'Half the size; fine for speech']], s.mono, (v) => (s.mono = v)));
    } else if (k === 'gif') {
      body.append(toggle('Save as MP4 instead (far smaller, plays everywhere)', s.toMp4, (v) => (s.toMp4 = v)));
      if (!s.toMp4) body.append(group('Colours', [64, 128, 192, 256].map((v) => [v, String(v)]), s.colors, (v) => (s.colors = v)));
      body.append(group('Frame rate', [[10, '10'], [15, '15'], [24, '24'], [null, 'Keep']], s.fps, (v) => (s.fps = v)));
    } else {
      body.append(group('Preset', [['screen', 'Screen · 72 dpi, smallest'], ['ebook', 'eBook · 150 dpi, balanced'], ['printer', 'Printer · 300 dpi, sharp']], s.preset, (v) => (s.preset = v), 'stack'));
    }
  }

  // ---------- Queue ----------
  function renderList() {
    const list = $('cp-list');
    list.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'cp-item';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-row' + (i === sel ? ' on' : '') + ` st-${it.state}`;
      b.innerHTML = '<span class="badge"></span><span class="nm"><span class="n"></span><span class="bar"><i></i></span></span><span class="sz"><span class="old"></span> → <span class="new"></span></span><span class="sv"></span>';
      b.querySelector('.badge').textContent = BADGE[it.kind];
      b.querySelector('.n').textContent = it.name;
      b.title = it.path + (it.error ? `\n${it.error}` : '');
      b.dataset.id = it.id;
      b.onclick = () => { sel = i; render(); };
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'cp-x';
      x.textContent = '✕';
      x.setAttribute('aria-label', `Remove ${it.name}`);
      x.disabled = it.state === 'running';
      x.onclick = () => { items.splice(i, 1); if (sel >= items.length) sel = Math.max(0, items.length - 1); render(); };
      // Video and audio: ▶ plays the result once there is one (else the original) in the player.
      const media = (it.kind === 'video' || it.kind === 'audio');
      const file = it.state === 'done' && it.outPath ? it.outPath : it.path;
      if (!media || typeof filePlayButton !== 'function') { const sp = document.createElement('span'); sp.className = 'fp-spacer'; li.prepend(sp); }
      else li.prepend(filePlayButton(() => items.filter((x) => x.kind === 'video' || x.kind === 'audio').map((x) => (x.state === 'done' && x.outPath ? x.outPath : x.path)), file));
      li.append(b, x);
      list.append(li);
    });
    $('cp-empty').classList.toggle('hidden', !!items.length);
    renderNumbers();
  }
  // Sizes, savings, totals and progress (also while dragging the quality slider).
  function renderNumbers() {
    for (const it of items) {
      const row = document.querySelector(`.cp-row[data-id="${it.id}"]`);
      if (!row) continue;
      const a = after(it);
      row.querySelector('.old').textContent = mb(it.size);
      row.querySelector('.new').textContent = (it.state === 'done' ? '' : '~') + mb(a);
      const pct = Math.round((1 - a / (it.size || 1)) * 100);
      const sv = row.querySelector('.sv');
      sv.textContent = it.state === 'err' ? '✕' : it.state === 'kept' ? 'kept' : `−${Math.max(0, pct)}%`;
      sv.classList.toggle('good', pct >= 50 && it.state !== 'kept');
      row.querySelector('.bar i').style.width = `${it.state === 'done' || it.state === 'kept' ? 100 : Math.round(it.progress || 0)}%`;
    }
    const totB = items.reduce((n, i) => n + (i.size || 0), 0), totA = items.reduce((n, i) => n + after(i), 0);
    $('cp-tot-label').textContent = `${items.length} file${items.length === 1 ? '' : 's'}`;
    $('cp-tot').innerHTML = items.length ? `<span class="dim">${mb(totB)}</span> → <b>~${mb(totA)}</b> <span class="red">−${Math.max(0, Math.round((1 - totA / (totB || 1)) * 100))}%</span>` : '—';
    const it = items[sel];
    $('cp-sel-before').textContent = it ? `${mb(it.size)} →` : '—';
    $('cp-sel-after').textContent = it ? `${it.state === 'done' ? '' : '~'}${mb(after(it))}` : '';
    const left = items.filter((i) => i.state === 'queued' || i.state === 'err').length;
    $('cp-go').disabled = running || !left;
    const doneN = items.filter((i) => ['done', 'kept', 'err'].includes(i.state)).length;
    $('cp-go').textContent = running ? `Compressing ${Math.min(items.length, doneN + 1)} / ${items.length}` : left && left < items.length ? `Compress ${left} more` : 'Compress';
  }
  function render() { renderList(); renderSettings(); }

  // ---------- Running: one job per file, one after another ----------
  const byJob = new Map();
  async function runNext() {
    const it = items.find((i) => i.state === 'queued' || (i.state === 'err' && !i.tried));
    if (!it) { running = false; renderNumbers(); return; }
    it.state = 'running'; it.progress = 0; it.tried = true;
    renderList();
    const title = `Compress · ${it.name}`;
    try {
      const { id } = await window.api.runJob('compress', { input: it.path, kind: it.kind, settings: settings[it.kind], keepIfBigger: $('cp-keep').checked }, title);
      it.jobId = id;
      byJob.set(id, it);
      if (typeof addJob === 'function') addJob(id, title);
    } catch (e) {
      it.state = 'err'; it.error = String(e.message || e);
      runNext();
    }
  }
  window.api.onProgress(({ id, percent }) => {
    const it = byJob.get(id);
    if (!it) return;
    it.progress = percent;
    renderNumbers();
  });
  window.api.onDone(async ({ id, ok, output, error }) => {
    const it = byJob.get(id);
    if (!it) return;
    byJob.delete(id);
    if (ok && output === it.path) it.state = 'kept';
    else if (ok) { it.state = 'done'; it.outPath = output; it.outSize = await window.api.cpSize(output); }
    else { it.state = 'err'; it.error = error; }
    renderList();
    if (!ok && /cancel/i.test(error || '')) { running = false; renderNumbers(); return; } // Cancel stops the queue
    runNext();
  });

  // ---------- Buttons, drop ----------
  $('cp-go').onclick = () => {
    if (running) return;
    for (const i of items) if (i.state === 'err') i.tried = false;
    running = true;
    runNext();
  };
  $('cp-clear').onclick = () => { items = items.filter((i) => i.state === 'running'); sel = 0; render(); };
  $('cp-drop').onclick = async () => {
    const all = Object.values(C.KINDS).flat();
    const picked = await window.api.pickFiles([{ name: 'Video, audio, images, GIF, PDF', extensions: all }, { name: 'All files', extensions: ['*'] }]);
    add(picked);
  };
  const panel = $('compress');
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('cp-over'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('cp-over'); });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    panel.classList.remove('cp-over');
    add([...(e.dataTransfer.files || [])].map((f) => window.api.pathForFile(f)).filter(Boolean));
  });
  // The hardware encoder chosen in Settings → Converter is the starting choice for video.
  window.api.settingsGet().then((st) => {
    if (!localStorage.getItem(KEY)) { settings.video.hw = { cuda: 'nvenc', amf: 'amf' }[st.hwAccel] || 'cpu'; }
    render();
  }).catch(() => render());

  window.CompressorUI = { add };
})();
