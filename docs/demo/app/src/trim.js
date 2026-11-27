// Trimmer: preview, segments, keyframes, waveform timeline, tracks and lossless export (main.js does
// the ffprobe / ffmpeg work; trimmer.js has the rules). Loaded after renderer.js (uses start() for jobs).
(function () {
  const $ = (id) => document.getElementById(id);
  const video = $('tm-video');
  const area = $('tm-area');
  const tl = $('tm-tl');
  const ZOOMS = [1, 2, 4, 8, 16, 32, 64];

  const st = {
    file: null, info: null, kfs: [], peaks: null,
    segs: [], sel: 0, zoom: 0,
    cut: 'exact', keep: true, merge: true,
    tracks: new Set(), previewing: false, loadSeq: 0,
  };
  const dur = () => (st.info && st.info.duration) || video.duration || 0;
  const fps = () => (st.info && st.info.fps) || 30;
  const now = () => video.currentTime || 0;
  // A local path as a file:// URL ("#", "%", spaces and other characters escaped).
  const fileUrl = (p) => /^demo\//.test(p) ? p : 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '').split('/')
    .map((part, i) => (i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))).join('/');

  // 72.48 → "01:12.48" (hours when needed)
  function tc(sec, digits = 2) {
    sec = Math.max(0, sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec - h * 3600 - m * 60;
    const ss = s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0');
    return (h ? `${String(h).padStart(2, '0')}:` : '') + `${String(m).padStart(2, '0')}:${ss}`;
  }
  const len = (g) => g[1] - g[0];
  const kfBefore = (t) => { let b = null; for (const k of st.kfs) { if (k <= t + 1e-4) b = k; else break; } return b; };
  const kfAfter = (t) => st.kfs.find((k) => k > t + 1e-4) ?? null;
  const onKeyframe = (t) => st.kfs.some((k) => Math.abs(k - t) < 0.5 / fps());

  // ---------- Opening a file ----------
  async function open(file) {
    if (!file) return;
    const seq = ++st.loadSeq;
    st.file = file; st.info = null; st.kfs = []; st.peaks = null; st.segs = []; st.sel = 0; st.previewing = false;
    window.Scrubber.load(null);
    $('tm-name').textContent = file.split(/[\\/]/).pop();
    $('tm-info').textContent = 'Reading the file…';
    busy('Reading the file…');
    document.querySelector('.tab[data-tool="trim"]')?.click();
    try {
      const info = await window.api.trimProbe(file);
      if (seq !== st.loadSeq) return;
      st.info = info;
      st.segs = info.duration ? [[0, info.duration]] : [];
      st.tracks = new Set(info.tracks.filter((t) => t.on).map((t) => t.index));
      $('tm-info').textContent = describe(info);
      renderTracks();
      fillFormats(file);
      busy(null);
      video.src = fileUrl(file);
      $('tm-screen').classList.toggle('audio', !info.hasVideo);
      render();
      // In the background: keyframes (video) and the waveform (audio).
      if (info.hasVideo) window.api.trimKeyframes(file).then((k) => { if (seq === st.loadSeq) { st.kfs = k; render(); } }).catch(() => {});
      if (info.tracks.some((t) => t.type === 'audio')) {
        window.api.trimWaveform(file, 2400).then((p) => { if (seq === st.loadSeq) { st.peaks = p; drawWave(); } }).catch(() => {});
        // Audio for scrubbing (after the waveform: both read the file).
        window.api.trimScrubAudio(file).then((r) => { if (seq === st.loadSeq && r) window.Scrubber.load(r.data, r.rate); }).catch(() => {});
      }
    } catch (e) {
      if (seq !== st.loadSeq) return;
      busy(null);
      st.file = null;
      $('tm-info').textContent = clean(e);
      render();
    }
  }
  const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  function describe(i) {
    const v = i.tracks.find((t) => t.type === 'video' && !t.cover);
    const a = i.tracks.filter((t) => t.type === 'audio');
    const s = i.tracks.filter((t) => t.type === 'subtitle');
    const size = i.size ? (i.size >= 1e9 ? `${(i.size / 1e9).toFixed(2)} GB` : `${Math.round(i.size / 1e6)} MB`) : null;
    return [v ? `${v.codec} ${i.width}×${i.height}` : null, v && i.fps ? `${Math.round(i.fps * 100) / 100} fps` : null,
      a.length ? `${a.length} audio` : null, s.length ? `${s.length} subtitle${s.length > 1 ? 's' : ''}` : null, tc(i.duration), size].filter(Boolean).join(' · ');
  }
  // The built-in player can't play this (H.265, AVI, WMV …): preview a small copy instead.
  async function previewCopy() {
    if (!st.file || st.previewing) return;
    st.previewing = true;
    const seq = st.loadSeq;
    busy("This file can't play here directly. Making a preview… 0%");
    try {
      const p = await window.api.trimPreview(st.file);
      if (seq !== st.loadSeq) return;
      busy(null);
      video.src = fileUrl(p);
      $('tm-pstate').textContent = 'Preview copy';
    } catch (e) {
      if (seq === st.loadSeq) busy(`Can't preview this file: ${clean(e)}. You can still cut it.`, true);
    }
  }
  window.api.onTrimPreviewProgress((pct) => { if (st.previewing && !$('tm-busy').classList.contains('hidden')) $('tm-busy-text').textContent = `This file can't play here directly. Making a preview… ${pct}%`; });
  video.addEventListener('error', () => { if (st.file) previewCopy(); });
  video.addEventListener('loadedmetadata', () => {
    // A video track the player can't decode shows as 0×0.
    if (st.info && st.info.hasVideo && !video.videoWidth) previewCopy();
    render();
  });
  function busy(text, stay = false) {
    $('tm-busy').classList.toggle('hidden', !text);
    $('tm-busy').classList.toggle('stay', stay);
    $('tm-busy-text').textContent = text || '';
  }

  // ---------- Output format: the same as the file, or a Converter preset that takes it ----------
  // Grouped like the Converter (Video, Audio, then each folder such as "Scale 720p"); image / PDF
  // presets aren't offered here.
  const AV_OUT = { video: ['mp4', 'mkv', 'mov', 'webm', 'ogv', 'avi', 'gif'], audio: ['mp3', 'aac', 'ogg', 'flac', 'wav', 'mid', 'm4a', 'opus'] };
  async function fillFormats(file) {
    const sel = $('tm-fmt');
    const keep = sel.value;
    const ext = (file.split('.').pop() || '').toLowerCase();
    let presets = [];
    try { presets = await window.api.convPresets(); } catch {}
    const fits = presets.filter((p) => (p.inputTypes || []).includes(ext) && [...AV_OUT.video, ...AV_OUT.audio].includes(String(p.outputType).toLowerCase()));
    const groups = new Map();
    for (const p of fits) {
      const slash = p.name.lastIndexOf('/');
      const out = String(p.outputType).toLowerCase();
      const g = slash > 0 ? p.name.slice(0, slash) : AV_OUT.video.includes(out) ? 'Video' : 'Audio';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ value: p.name, label: (slash > 0 ? p.name.slice(slash + 1) : p.name).replace(/^To /, '') });
    }
    sel.innerHTML = '';
    sel.append(new Option('Same as input', ''));
    const order = [...groups.keys()].sort((a, b) => (a === 'Video' ? -2 : a === 'Audio' ? -1 : 0) - (b === 'Video' ? -2 : b === 'Audio' ? -1 : 0));
    for (const g of order) {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const it of groups.get(g)) og.append(new Option(it.label, it.value));
      sel.append(og);
    }
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
  }

  // ---------- Tracks ----------
  function renderTracks() {
    const box = $('tm-tracks');
    box.querySelectorAll('label').forEach((l) => l.remove());
    for (const t of (st.info && st.info.tracks) || []) {
      const l = document.createElement('label');
      l.className = 'tm-trk';
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: st.tracks.has(t.index) });
      cb.onchange = () => { if (cb.checked) st.tracks.add(t.index); else st.tracks.delete(t.index); render(); };
      l.append(cb, Object.assign(document.createElement('span'), { textContent: t.label }));
      box.append(l);
    }
  }

  // ---------- Segments ----------
  function select(i) { st.sel = Math.max(0, Math.min(st.segs.length - 1, i)); render(); }
  function setStart() {
    const g = st.segs[st.sel]; const t = now();
    if (!g) return addAt(t);
    if (t < g[1]) g[0] = t; else st.segs[st.sel] = [t, Math.min(dur(), t + len(g))];
    sortKeep(); render();
  }
  function setEnd() {
    const g = st.segs[st.sel]; const t = now();
    if (!g) return;
    if (t > g[0]) g[1] = t; else st.segs[st.sel] = [Math.max(0, t - len(g)), t];
    sortKeep(); render();
  }
  function addAt(t) {
    const g = [t, Math.min(dur(), t + Math.max(5, dur() / 20))];
    if (len(g) < 0.1) g[0] = Math.max(0, g[1] - 5);
    st.segs.push(g); sortKeep(g); render();
  }
  function split() {
    const t = now();
    const i = st.segs.findIndex((g) => t > g[0] + 0.05 && t < g[1] - 0.05);
    if (i < 0) return;
    const [a, b] = st.segs[i];
    st.segs.splice(i, 1, [a, t], [t, b]);
    st.sel = i + 1; render();
  }
  function remove() { if (!st.segs.length) return; st.segs.splice(st.sel, 1); st.sel = Math.max(0, Math.min(st.sel, st.segs.length - 1)); render(); }
  // Keep the list in time order, with the same segment selected.
  function sortKeep(keepSel = null) {
    const cur = keepSel || st.segs[st.sel];
    st.segs.sort((x, y) => x[0] - y[0]);
    st.sel = Math.max(0, st.segs.indexOf(cur));
  }

  // ---------- Playback ----------
  const seek = (t) => { video.currentTime = Math.max(0, Math.min(dur(), t)); tick(); };
  const toggle = () => { if (!st.file) return; if (video.paused) video.play().catch(() => {}); else video.pause(); };
  const frame = (n) => { video.pause(); seek(now() + n / fps()); };
  const keyframe = (dir) => { const k = dir < 0 ? kfBefore(now() - 0.5 / fps()) : kfAfter(now()); if (k != null) { video.pause(); seek(k); } };

  // ---------- Drawing ----------
  const pct = (t) => `${(dur() ? (t / dur()) * 100 : 0).toFixed(4)}%`;
  function render() {
    const has = !!(st.file && st.info);
    document.getElementById('trim').classList.toggle('tm-empty', !has);
    $('tm-go').disabled = !has || !st.segs.length || !st.tracks.size;
    // Segments list
    const list = $('tm-seglist');
    list.innerHTML = '';
    st.segs.forEach((g, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-srow' + (i === st.sel ? ' on' : '');
      const late = st.cut === 'keyframe' && st.kfs.length && !onKeyframe(g[0]) ? kfBefore(g[0]) : null;
      b.innerHTML = '<span class="n"></span><span class="r"></span><span class="l"></span>';
      b.querySelector('.n').textContent = String(i + 1).padStart(2, '0');
      b.querySelector('.r').textContent = `${tc(g[0])} → ${tc(g[1])}`;
      b.querySelector('.l').textContent = `${late != null ? '⚠ ' : ''}${len(g).toFixed(1)}s`;
      b.title = late != null ? `Lossless cuts start on a keyframe: this one will start at ${tc(late)} (${(g[0] - late).toFixed(2)}s earlier). Use Exact to cut on the frame.` : 'Select (and jump to its start)';
      b.onclick = () => { select(i); seek(g[0]); };
      li.append(b);
      list.append(li);
    });
    $('tm-segcount').textContent = String(st.segs.length).padStart(2, '0');
    const total = st.segs.reduce((n, g) => n + len(g), 0);
    const kept = st.keep ? total : Math.max(0, dur() - mergedLength());
    $('tm-keeplabel').textContent = st.keep ? 'Keeping' : 'After cutting';
    $('tm-keeptotal').textContent = has ? `${tc(kept, 0)} of ${tc(dur(), 0)}` : '—';
    // Timeline segments
    const row = $('tm-segrow');
    row.innerHTML = '';
    st.segs.forEach((g, i) => {
      const s = document.createElement('div');
      s.className = 'tm-sblock' + (i === st.sel ? ' on' : '') + (st.keep ? '' : ' away');
      s.style.left = pct(g[0]);
      s.style.width = pct(len(g));
      s.innerHTML = '<span class="lab"></span><span class="h l" data-edge="0"></span><span class="h r" data-edge="1"></span>';
      s.querySelector('.lab').textContent = String(i + 1).padStart(2, '0');
      s.dataset.i = i;
      row.append(s);
    });
    $('tm-zoom').textContent = `${ZOOMS[st.zoom]}×`;
    area.style.width = `${ZOOMS[st.zoom] * 100}%`;
    tl.classList.toggle('z1', st.zoom === 0);
    $('tm-dur').textContent = tc(dur());
    document.querySelectorAll('#trim [data-cut]').forEach((b) => b.classList.toggle('active', b.dataset.cut === st.cut));
    document.querySelectorAll('#trim [data-keep]').forEach((b) => b.classList.toggle('active', (b.dataset.keep === '1') === st.keep));
    document.querySelectorAll('#trim [data-merge]').forEach((b) => b.classList.toggle('active', (b.dataset.merge === '1') === st.merge));
    $('tm-pkf').disabled = $('tm-nkf').disabled = !st.kfs.length;
    drawRuler(); drawKeyframes(); drawWave(); tick();
  }
  function mergedLength() {
    let total = 0, end = -1;
    for (const [a, b] of [...st.segs].sort((x, y) => x[0] - y[0])) { if (b <= end) continue; total += b - Math.max(a, end); end = b; }
    return total;
  }
  // Canvas at the timeline's real pixel size (capped: very long zoomed timelines draw what fits).
  function sizeCanvas(c) {
    const w = Math.min(30000, area.clientWidth), h = c.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d));
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  const ink = () => getComputedStyle(document.body).getPropertyValue('--text').trim() || '#e9e9e6';
  const muted = () => getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#9c9c98';
  function drawRuler() {
    const c = $('tm-ruler'); const { g, w, h } = sizeCanvas(c); const D = dur(); if (!D) return;
    const pps = w / D;
    const steps = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find((s) => s * pps >= 80) || 3600;
    g.fillStyle = muted(); g.strokeStyle = muted(); g.font = '9px "Space Mono", Consolas, monospace'; g.textBaseline = 'top';
    for (let t = 0; t <= D + 1e-6; t += step) {
      const x = Math.round(t * pps) + 0.5;
      g.beginPath(); g.moveTo(x, h - 6); g.lineTo(x, h); g.stroke();
      const label = tc(t, step < 1 ? 1 : 0);
      g.fillText(label, Math.min(Math.max(0, x - (t ? g.measureText(label).width / 2 : 0)), w - g.measureText(label).width), 0);
    }
    g.globalAlpha = 0.4;
    for (let t = 0; t <= D; t += step / 5) { const x = Math.round(t * pps) + 0.5; g.beginPath(); g.moveTo(x, h - 3); g.lineTo(x, h); g.stroke(); }
    g.globalAlpha = 1;
  }
  function drawKeyframes() {
    const c = $('tm-kfs'); const { g, w, h } = sizeCanvas(c); const D = dur(); if (!D || !st.kfs.length) return;
    g.fillStyle = ink(); g.globalAlpha = 0.5;
    let last = -2;
    for (const k of st.kfs) { const x = Math.round((k / D) * w); if (x === last) continue; g.fillRect(x, 0, 1, h); last = x; }
  }
  function inKept(t) {
    const inside = st.segs.some((g) => t >= g[0] && t <= g[1]);
    return st.keep ? inside : !inside;
  }
  function drawWave() {
    const c = $('tm-wave'); const { g, w, h } = sizeCanvas(c); const D = dur();
    if (!D) return;
    if (!st.peaks) {
      g.fillStyle = muted(); g.font = '9px "Space Mono", Consolas, monospace'; g.textBaseline = 'middle';
      const has = st.info && st.info.tracks.some((t) => t.type === 'audio');
      if (has) g.fillText('Reading the audio…', 6, h / 2);
      return;
    }
    const n = st.peaks.length, bars = Math.max(1, Math.floor(w / 3));
    const col = ink();
    for (let b = 0; b < bars; b++) {
      const from = Math.floor((b / bars) * n), to = Math.max(from + 1, Math.floor(((b + 1) / bars) * n));
      let v = 0; for (let i = from; i < to; i++) v = Math.max(v, st.peaks[i] || 0);
      const bh = Math.max(1, v * (h - 2));
      g.fillStyle = col; g.globalAlpha = inKept(((b + 0.5) / bars) * D) ? 1 : 0.28;
      g.fillRect(b * 3, (h - bh) / 2, 2, bh);
    }
    g.globalAlpha = 1;
  }
  // Every frame while playing: time, frame number, keyframe badge, playhead.
  function tick() {
    const t = now();
    $('tm-tc').textContent = tc(t);
    $('tm-frame').textContent = st.info && st.info.hasVideo ? `FRAME ${String(Math.round(t * fps())).padStart(5, '0')}` : '';
    $('tm-ph').style.left = pct(t);
    const kf = $('tm-kf');
    if (st.kfs.length) {
      kf.classList.remove('hidden');
      const next = kfAfter(t);
      kf.textContent = onKeyframe(t) ? 'Keyframe' : next != null ? `Next KF ${tc(next)}` : 'Last keyframe passed';
      kf.classList.toggle('on', onKeyframe(t));
    } else kf.classList.add('hidden');
    $('tm-pstate').textContent = !st.file ? 'No file' : video.paused ? 'Paused' : 'Playing';
    $('trim').classList.toggle('tm-playing', !video.paused);
    $('tm-play').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    // Keep the playhead in view while playing on a zoomed timeline.
    if (!video.paused && ZOOMS[st.zoom] > 1) {
      const x = (t / (dur() || 1)) * area.clientWidth;
      if (x < tl.scrollLeft || x > tl.scrollLeft + tl.clientWidth - 30) tl.scrollLeft = x - 30;
    }
  }
  let raf = 0;
  const loop = () => { tick(); raf = video.paused ? 0 : requestAnimationFrame(loop); };
  video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(loop); });
  video.addEventListener('pause', tick);
  video.addEventListener('seeked', tick);
  video.addEventListener('timeupdate', () => { if (video.paused) tick(); });

  // ---------- Timeline mouse: seek, select, drag segment edges ----------
  const timeAt = (clientX) => { const r = area.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur(); };
  area.addEventListener('pointerdown', (e) => {
    if (!st.file || e.button !== 0) return;
    const edge = e.target.closest('.h');
    const block = e.target.closest('.tm-sblock');
    area.setPointerCapture(e.pointerId);
    if (edge && block) {
      // Drag a segment's start / end; it snaps to a keyframe when close (8 px).
      const i = Number(block.dataset.i); const which = Number(edge.dataset.edge);
      st.sel = i;
      video.pause();
      window.Scrubber.start(st.segs[i][which]);
      const move = (ev) => {
        let t = timeAt(ev.clientX);
        const px = dur() / area.clientWidth * 8;
        const k = st.kfs.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);
        if (Math.abs(k - t) < px && !ev.altKey) t = k;
        const g = st.segs[i];
        if (which === 0) g[0] = Math.min(t, g[1] - 0.05); else g[1] = Math.max(t, g[0] + 0.05);
        video.pause(); video.currentTime = g[which];
        window.Scrubber.move(g[which]);
        render();
      };
      const up = () => { window.Scrubber.stop(); area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up); sortKeep(st.segs[i]); render(); };
      area.addEventListener('pointermove', move);
      area.addEventListener('pointerup', up);
      area.addEventListener('pointercancel', up);
      return;
    }
    if (block) select(Number(block.dataset.i));
    // Scrub: the audio follows the pointer (held still, the note keeps sounding); playing resumes after.
    const wasPlaying = !video.paused;
    video.pause();
    const t0 = timeAt(e.clientX);
    seek(t0);
    window.Scrubber.start(t0);
    const move = (ev) => { const t = timeAt(ev.clientX); window.Scrubber.move(t); seek(t); };
    const up = () => {
      window.Scrubber.stop();
      area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up);
      if (wasPlaying) video.play().catch(() => {});
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', up);
  });
  // Ctrl + wheel zooms; the wheel alone scrolls a zoomed timeline sideways.
  tl.addEventListener('wheel', (e) => {
    if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1, e.clientX); }
    else if (ZOOMS[st.zoom] > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); tl.scrollLeft += e.deltaY; }
  }, { passive: false });
  function zoom(dir, clientX = null) {
    const z = Math.max(0, Math.min(ZOOMS.length - 1, st.zoom + dir));
    if (z === st.zoom) return;
    // Keep the point under the mouse (or the playhead) where it is.
    const r = tl.getBoundingClientRect();
    const anchorX = clientX != null ? clientX - r.left : Math.min(tl.clientWidth, Math.max(0, (now() / (dur() || 1)) * area.clientWidth - tl.scrollLeft));
    const t = ((tl.scrollLeft + anchorX) / area.clientWidth) * dur();
    st.zoom = z;
    render();
    tl.scrollLeft = (t / (dur() || 1)) * area.clientWidth - anchorX;
  }
  new ResizeObserver(() => { drawRuler(); drawKeyframes(); drawWave(); }).observe(tl);

  // ---------- Buttons ----------
  $('tm-open').onclick = async () => {
    const p = await window.api.pickFile([{ name: 'Video and audio', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'ts', 'mts', 'm2ts', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv', 'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'aiff'] }, { name: 'All files', extensions: ['*'] }]);
    if (p) open(p);
  };
  $('tm-play').onclick = toggle;
  $('tm-pf').onclick = () => frame(-1);
  $('tm-nf').onclick = () => frame(1);
  $('tm-pkf').onclick = () => keyframe(-1);
  $('tm-nkf').onclick = () => keyframe(1);
  $('tm-in').onclick = setStart;
  $('tm-out').onclick = setEnd;
  $('tm-split').onclick = split;
  $('tm-add').onclick = () => addAt(now());
  $('tm-del').onclick = remove;
  $('tm-zin').onclick = () => zoom(1);
  $('tm-zout').onclick = () => zoom(-1);
  $('tm-snap').onclick = async () => {
    if (!st.file || !(st.info && st.info.hasVideo)) return;
    try {
      const out = await window.api.trimSnapshot(st.file, now());
      $('tm-info').textContent = `Saved ${out.split(/[\\/]/).pop()}`;
      setTimeout(() => { if (st.info) $('tm-info').textContent = describe(st.info); }, 4000);
    } catch (e) { $('tm-info').textContent = `Snapshot failed: ${clean(e)}`; }
  };
  document.querySelectorAll('#trim [data-cut]').forEach((b) => (b.onclick = () => { if (!b.disabled) { st.cut = b.dataset.cut; render(); } }));
  document.querySelectorAll('#trim [data-keep]').forEach((b) => (b.onclick = () => { st.keep = b.dataset.keep === '1'; render(); }));
  document.querySelectorAll('#trim [data-merge]').forEach((b) => (b.onclick = () => { st.merge = b.dataset.merge === '1'; render(); }));
  $('tm-go').onclick = () => {
    if (!st.file || !st.segs.length) return;
    video.pause();
    start('trim', { input: st.file, segments: st.segs.map((g) => [g[0], g[1]]), keep: st.keep, merge: st.merge, mode: st.cut, tracks: [...st.tracks], preset: $('tm-fmt').value || null },
      `Trim · ${st.file.split(/[\\/]/).pop()}`);
  };

  // ---------- Drop a file anywhere on the Trimmer ----------
  const panel = $('trim');
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('tm-over'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('tm-over'); });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    panel.classList.remove('tm-over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) open(window.api.pathForFile(f));
  });

  // ---------- Keys (only while the Trimmer is showing, and not while typing) ----------
  document.addEventListener('keydown', (e) => {
    if (!panel.classList.contains('active') || !st.file) return;
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const act = { ' ': toggle, i: setStart, I: setStart, o: setEnd, O: setEnd, s: split, S: split, Delete: remove,
      ArrowLeft: () => (e.shiftKey ? keyframe(-1) : frame(-1)), ArrowRight: () => (e.shiftKey ? keyframe(1) : frame(1)),
      ',': () => frame(-1), '.': () => frame(1), '+': () => zoom(1), '=': () => zoom(1), '-': () => zoom(-1) }[k];
    if (!act) return;
    if (k === ' ' && e.target.closest('button')) e.target.blur();
    e.preventDefault();
    act();
  });
  // Redraw in the theme's colours.
  // (The theme switches through prefers-color-scheme; its colours fade for 0.3 s, so draw again after.)
  const redraw = () => { drawRuler(); drawKeyframes(); drawWave(); };
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { redraw(); setTimeout(redraw, 350); });

  render();
  window.Trimmer = { open };
})();
