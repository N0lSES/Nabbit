// Stems screen: a queue of songs split one after another (main.js tools.stems), the settings for the
// model picked, and the models: download, delete, your own .onnx files (with an MDX-Net model's
// settings when UVR's table doesn't know it), and the folder they're kept in.
(function () {
  const $ = (id) => document.getElementById(id);
  const tool = $('tool-stems');
  if (!tool) return;
  const KEY = 'nabbit-stems';
  const AUDIO = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'alac', 'ape', 'wv', 'mp4', 'mkv', 'webm', 'mov', 'avi'];
  const FORMATS = [['wav', 'WAV', '24-bit, lossless'], ['flac', 'FLAC', 'Lossless, smaller'], ['mp3', 'MP3', '320 kbps']];

  let set = { model: '', picks: {}, format: 'wav', device: 'gpu', quality: 'fast', outDir: '' };
  try { Object.assign(set, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch { /* not kept */ } };

  let models = [], ortOk = true, dir = '';
  let items = [], running = false, nextId = 1, editing = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const mb = (b) => (!b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
  const label = (n) => String(n).replace(/^./, (c) => c.toUpperCase());
  const ready = () => models.filter((m) => m.installed && !m.needsParams);
  const current = () => { const r = ready(); return r.find((m) => m.id === set.model) || r[0] || null; };

  // ---------- Models ----------
  async function loadModels() {
    try { const r = await window.api.stemsModels(); models = r.models; ortOk = r.ort; dir = r.dir; } catch { models = []; }
    render();
  }
  function renderModels() {
    $('sp-ort').classList.toggle('hidden', ortOk);
    $('sp-dir').textContent = dir;
    $('sp-dir').title = dir;
    const list = $('sp-mlist');
    list.textContent = '';
    for (const m of models) {
      const li = el('li', `sp-m${m.installed ? ' have' : ''}`);
      const badge = el('span', 'badge', m.own ? 'OWN' : m.kind === 'mdx' ? 'MDX' : 'DMX');
      badge.title = m.kind === 'mdx' ? 'MDX-Net (UVR)' : 'Demucs';
      const info = el('span', 'nm');
      info.append(el('span', 'n', m.name));
      const sub = [m.stems && m.stems.length ? m.stems.map(label).join(' · ') : '', m.own ? '' : mb(m.size)].filter(Boolean).join(' — ');
      info.append(el('span', 'd', m.note));
      if (sub) info.append(el('span', 'd s', sub));
      if (m.credit) info.title = m.credit;
      const act = el('span', 'act');
      if (m.downloading) {
        const pct = m.downloading.total ? Math.round((m.downloading.got / m.downloading.total) * 100) : 0;
        const bar = el('span', 'bar'); const i = el('i'); i.style.width = `${pct}%`; bar.append(i);
        act.append(bar, el('span', 'pct', `${pct}%`));
        const c = el('button', 'chip', 'Cancel'); c.type = 'button'; c.onclick = () => window.api.stemsDownloadCancel(m.id); act.append(c);
      } else if (!m.own && !m.installed) {
        const d = el('button', 'chip active', `Download · ${mb(m.size)}`); d.type = 'button';
        d.onclick = () => { m.downloading = { got: 0, total: m.size }; renderModels(); window.api.stemsDownload(m.id).then(loadModels); };
        act.append(d);
      } else {
        if (m.own && m.kind === 'mdx') { const e = el('button', 'chip', m.needsParams ? 'Set up…' : 'Settings'); e.type = 'button'; e.onclick = () => { editing = editing === m.id ? null : m.id; renderModels(); }; act.append(e); }
        if (m.own && !m.installed) act.append(el('span', 'err', 'File missing'));
        const r = el('button', 'chip', m.own ? 'Remove' : 'Delete'); r.type = 'button';
        r.title = m.own ? 'Take it off the list (the file stays where it is)' : 'Delete the downloaded files';
        r.onclick = async () => { models = await window.api.stemsRemove(m.id); render(); };
        act.append(r);
      }
      li.append(badge, info, act);
      if (m.own && m.kind === 'mdx' && (editing === m.id || m.needsParams)) li.append(paramsForm(m));
      list.append(li);
    }
  }
  // An MDX-Net model's settings (UVR's names): n_fft, dim_f, dim_t (as a power of two), compensation, stem.
  function paramsForm(m) {
    const p = m.params || { nFft: 7680, dimF: 3072, dimT: 8, compensate: 1.035, primary: 'Vocals' };
    const f = el('div', 'sp-params');
    if (m.needsParams) f.append(el('p', 'dim', "UVR's list doesn't know this model, so its settings are needed (they're in the model's notes; the usual ones are filled in)."));
    const field = (k, lab, v, tip) => { const w = el('label', 'tm-opt'); w.append(el('span', 'tm-lab', lab)); const i = el('input'); i.value = v; i.dataset.k = k; i.title = tip; w.append(i); f.append(w); };
    field('nFft', 'n_fft', p.nFft, 'FFT size: 7680, 6144, 5120, ...');
    field('dimF', 'dim_f', p.dimF, 'Frequency bins the model takes: 3072 or 2048');
    field('dimT', 'dim_t', p.dimT, 'Frames as a power of two: 8 = 256');
    field('compensate', 'Compensate', p.compensate, 'Volume correction: about 1.03');
    field('primary', 'Gives', p.primary, 'The stem the model outputs: Vocals, Instrumental, Drums, ...');
    const ok = el('button', 'chip active', 'Save'); ok.type = 'button';
    ok.onclick = async () => {
      const v = {}; for (const i of f.querySelectorAll('input')) v[i.dataset.k] = i.value;
      models = await window.api.stemsOwnParams(m.id, v); editing = null; render();
    };
    f.append(ok);
    return f;
  }
  window.api.onStemsDl((d) => {
    const m = models.find((x) => x.id === d.id);
    if (!m) return;
    if (d.done || d.error) { m.downloading = null; if (d.error && d.error !== 'Cancelled') alertLine(`${m.name}: ${d.error}`); loadModels(); return; }
    m.downloading = { got: d.got, total: d.total };
    renderModels();
  });
  const alertLine = (t) => { $('sp-empty').classList.remove('hidden'); $('sp-empty').textContent = t; };

  // ---------- Settings ----------
  function chips(label, opts, value, pick, multi = false) {
    const box = el('div', 'tm-opt cp-opt');
    box.append(el('span', 'tm-lab', label));
    const seg = el('div', 'tm-seg cp-seg');
    for (const [v, text, tip] of opts) {
      const b = el('button', `chip${(multi ? value.includes(v) : v === value) ? ' active' : ''}`, text);
      b.type = 'button';
      if (tip) b.title = tip;
      b.onclick = () => { pick(v); save(); render(); };
      seg.append(b);
    }
    box.append(seg);
    return box;
  }
  function renderSettings() {
    const body = $('sp-set');
    body.textContent = '';
    const m = current();
    $('sp-dev-tag').textContent = set.device === 'cpu' ? 'CPU' : 'GPU';
    if (!m) { body.append(el('p', 'dim', 'Download a model below (or add your own) to start.')); return; }
    // Model
    const box = el('label', 'tm-opt cp-opt');
    box.append(el('span', 'tm-lab', 'Model'));
    const sel = el('select', 'sp-model');
    for (const r of ready()) { const o = el('option', '', r.name); o.value = r.id; o.selected = r.id === m.id; sel.append(o); }
    sel.onchange = () => { set.model = sel.value; save(); render(); };
    box.append(sel);
    body.append(box);
    // Stems to save (all by default).
    const all = m.stems || [];
    const picked = (set.picks[m.id] || all).filter((s) => all.includes(s));
    body.append(chips('Save', all.map((s) => [s, label(s), /instrumental/i.test(s) && m.kind !== 'mdx' ? 'Everything but the vocals' : '']), picked.length ? picked : all, (v) => {
      const cur = new Set(picked.length ? picked : all);
      if (cur.has(v) && cur.size > 1) cur.delete(v); else cur.add(v);
      set.picks[m.id] = all.filter((s) => cur.has(s));
    }, true));
    body.append(chips('Format', FORMATS, set.format, (v) => { set.format = v; }));
    body.append(chips('Run on', [['gpu', 'GPU', 'Your graphics card, through DirectML (falls back to the CPU if it can\'t)'], ['cpu', 'CPU', 'Slower, but always works']], set.device, (v) => { set.device = v; }));
    if (m.kind !== 'mdx') body.append(chips('Quality', [['fast', 'Fast', 'Segments overlap by a quarter'], ['best', 'Best', 'Segments overlap by half: smoother joins, about 1.5× slower']], set.quality, (v) => { set.quality = v; }));
    body.append(el('p', 'dim small', m.own ? m.name : m.note));
  }

  // ---------- Queue ----------
  async function add(paths) {
    if (!paths || !paths.length) return;
    document.querySelector('.tab[data-tool="editor"]')?.click();
    tool.open = true;
    const have = new Set(items.map((i) => i.path));
    for (const p of paths) {
      if (have.has(p)) continue;
      const ext = (p.split('.').pop() || '').toLowerCase();
      if (!AUDIO.includes(ext)) continue;
      items.push({ id: nextId++, path: p, name: p.split(/[\\/]/).pop(), state: 'queued', progress: 0 });
    }
    render();
  }
  // From a right-click menu (Explorer's, the Player's, Recent downloads'): the card opens with the files
  // added, and they're split straight away with the settings here.
  window.StemsUI = {
    async split(paths) {
      if (!models.length) await loadModels(); // started from Explorer before the card was ever opened
      await add(paths);
      tool.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (!running && current()) { for (const i of items) if (i.state === 'err') i.tried = false; running = true; runNext(); }
    },
  };
  function renderList() {
    const list = $('sp-list');
    list.textContent = '';
    items.forEach((it, i) => {
      const li = el('li', 'cp-item');
      const row = el('div', `cp-row st-${it.state}`);
      row.dataset.id = it.id;
      row.title = it.path + (it.error ? `\n${it.error}` : '');
      const nm = el('span', 'nm'); nm.append(el('span', 'n', it.name)); const bar = el('span', 'bar'); bar.append(el('i')); nm.append(bar);
      const st = el('span', 'sv', '');
      // The number is a ▶ for the song itself (hover); each stem has its own ▶ under it once split.
      const num = typeof filePlayButton === 'function' && canPlayFile(it.path)
        ? filePlayButton(() => items.map((x) => x.path), it.path, { num: String(i + 1).padStart(2, '0') })
        : el('span', 'badge', String(i + 1).padStart(2, '0'));
      num.classList.add('badge');
      row.append(num, nm, st);
      if (it.state === 'done' && it.outs && it.outs.length) {
        // Straight into Mastering: the vocals and the instrumental (any stem if neither was saved).
        const stemOf = (f) => (/\(([^()]+)\)\.[^.\\/]+$/.exec(f) || [])[1] || f.split(/[\\/]/).pop();
        const main = it.outs.filter((f) => /^(vocals|instrumental)$/i.test(stemOf(f)));
        const ms = el('span', 'sp-ms');
        ms.append(el('span', 'tm-lab', 'Master'));
        for (const f of main.length ? main : it.outs) {
          const b = el('button', 'chip', stemOf(f)); b.type = 'button';
          b.title = `Open ${f.split(/[\\/]/).pop()} in Mastering`;
          b.onclick = () => { if (window.MasterUI) window.MasterUI.load(f); };
          ms.append(b);
        }
        const show = el('button', 'chip', 'Show'); show.type = 'button'; show.title = 'Show the stems in Explorer'; show.onclick = () => window.api.showItem(it.outs[0]);
        const pl = el('span', 'sp-ms');
        pl.append(el('span', 'tm-lab', 'Play'));
        for (const f of it.outs) {
          if (typeof filePlayButton !== 'function') break;
          const b = filePlayButton(() => it.outs, f, { label: `Play ${stemOf(f)}` });
          b.classList.add('sp-pl');
          b.append(el('span', 'sp-pl-n', stemOf(f)));
          pl.append(b);
        }
        const acts = el('span', 'sp-acts'); acts.append(pl, ms, show);
        nm.append(acts);
        row.classList.add('tall');
      }
      const x = el('button', 'cp-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', `Remove ${it.name}`); x.disabled = it.state === 'running';
      x.onclick = () => { items.splice(i, 1); render(); };
      li.append(row, x);
      list.append(li);
    });
    $('sp-empty').classList.toggle('hidden', !!items.length);
    if (!items.length) $('sp-empty').textContent = 'No files yet. Drop some here, or use Add.';
    renderNumbers();
  }
  function renderNumbers() {
    for (const it of items) {
      const row = document.querySelector(`#sp-list .cp-row[data-id="${it.id}"]`);
      if (!row) continue;
      row.querySelector('.bar i').style.width = `${it.state === 'done' ? 100 : Math.round(it.progress || 0)}%`;
      row.querySelector('.sv').textContent = it.state === 'done' ? `${it.outs ? it.outs.length : 0} stems` : it.state === 'err' ? '✕' : it.state === 'running' ? (it.status || `${Math.round(it.progress || 0)}%`) : '';
    }
    const left = items.filter((i) => i.state === 'queued' || i.state === 'err').length;
    $('sp-go').disabled = running || !left || !current() || !ortOk;
    const doneN = items.filter((i) => ['done', 'err'].includes(i.state)).length;
    $('sp-go').textContent = running ? `Splitting ${Math.min(items.length, doneN + 1)} / ${items.length}` : left && left < items.length ? `Split ${left} more` : 'Split';
  }
  function renderDest() {
    const short = (p) => (p.length > 42 ? `…${p.slice(-40)}` : p);
    // Not set: where results go (Settings): Music\Nabbit\Stems, or next to each song.
    const beside = window.nabbitSaveLayout === 'beside';
    $('sp-out').textContent = set.outDir ? short(set.outDir) : beside ? 'Next to each song' : 'Music\\Nabbit\\Stems';
    $('sp-out').title = set.outDir ? `${set.outDir}\nClick to choose another folder (each song gets its own folder in it)` : 'Click to choose a folder for the stems instead';
    $('sp-out-reset').classList.toggle('hidden', !set.outDir);
    $('sp-out-eg').textContent = `${set.outDir || !beside ? '' : 'song folder\\'}name - stems\\name (Vocals).${set.format}`;
  }
  function render() { renderModels(); renderSettings(); renderList(); renderDest(); }

  // ---------- Running: one song at a time ----------
  const byJob = new Map();
  async function runNext() {
    const it = items.find((i) => i.state === 'queued' || (i.state === 'err' && !i.tried));
    const m = current();
    if (!it || !m) { running = false; renderNumbers(); return; }
    it.state = 'running'; it.progress = 0; it.tried = true; it.status = '';
    renderList();
    const picks = (set.picks[m.id] || []).filter((s) => (m.stems || []).includes(s));
    const title = `Stems · ${it.name}`;
    try {
      const { id } = await window.api.runJob('stems', { input: it.path, model: m.id, outputs: picks, format: set.format, device: set.device,
        overlap: set.quality === 'best' ? 0.5 : 0.25, sample: $('sp-sample').checked, outDir: set.outDir || '' }, title);
      byJob.set(id, it);
      if (typeof addJob === 'function') addJob(id, title);
    } catch (e) { it.state = 'err'; it.error = String(e.message || e); runNext(); }
  }
  window.api.onProgress(({ id, percent }) => { const it = byJob.get(id); if (!it) return; it.progress = percent; it.status = ''; renderNumbers(); });
  window.api.onStatus(({ id, text }) => { const it = byJob.get(id); if (!it) return; it.status = /^(Splitting|Reading)/.test(text) ? '' : text; renderNumbers(); });
  window.api.onDone(({ id, ok, outputs, error }) => {
    const it = byJob.get(id);
    if (!it) return;
    byJob.delete(id);
    if (ok) { it.state = 'done'; it.outs = outputs || []; } else { it.state = 'err'; it.error = error; }
    renderList();
    if (!ok && /cancel/i.test(error || '')) { running = false; renderNumbers(); return; }
    runNext();
  });

  // ---------- Buttons, drop ----------
  $('sp-go').onclick = () => { if (running) return; for (const i of items) if (i.state === 'err') i.tried = false; running = true; runNext(); };
  $('sp-clear').onclick = () => { items = items.filter((i) => i.state === 'running'); render(); };
  $('sp-drop').onclick = async () => add(await window.api.pickFiles([{ name: 'Songs and videos', extensions: AUDIO }, { name: 'All files', extensions: ['*'] }]));
  $('sp-add-own').onclick = async () => {
    const r = await window.api.stemsAddOwn();
    models = r.models;
    if (r.added && r.added.length) { set.model = r.added[0]; save(); }
    if (r.errors && r.errors.length) alertLine(r.errors.join(' · '));
    render();
  };
  $('sp-out').onclick = async () => {
    const d = await window.api.pickFolder({ title: 'Save the stems in', defaultPath: set.outDir || undefined });
    if (d) { set.outDir = d; save(); renderDest(); }
  };
  $('sp-out-reset').onclick = () => { set.outDir = ''; save(); renderDest(); };
  $('sp-dir-btn').onclick = async () => { const r = await window.api.stemsDir(); dir = r.dir; models = r.models; render(); };
  const panel = tool;
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('cp-over'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('cp-over'); });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    panel.classList.remove('cp-over');
    tool.open = true;
    const paths = [...(e.dataTransfer.files || [])].map((f) => window.api.pathForFile(f)).filter(Boolean);
    const onnx = paths.filter((p) => /\.onnx$/i.test(p));
    if (onnx.length) window.api.stemsAddOwn(onnx).then((r) => { models = r.models; if (r.added && r.added[0]) { set.model = r.added[0]; save(); } render(); });
    add(paths.filter((p) => !/\.onnx$/i.test(p)));
  });
  tool.addEventListener('toggle', () => { if (tool.open) loadModels(); });
  document.querySelector('.tab[data-tool="editor"]').addEventListener('click', () => { if (tool.open) loadModels(); });
  loadModels();
  window.StemsUI.add = add;
  window.StemsUI.refreshDest = () => renderDest();
})();
