// Video Downloader · Batch: paste many links (or playlists), pick one format for all of them, and they
// download as a queue, a few at a time. Each download is an ordinary job (shown under "Now" in the
// Recent box too), started through the same path as the browser extension's quick downloads.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('bq')) return;
  const PARALLEL = 2;
  const queue = []; // { key, url, title, duration, thumbnail, site, state: 'looking'|'queued'|'running'|'done'|'err', jobId, percent, status, error }
  let paused = false, nextKey = 1, mode = 'one';
  const byJob = new Map();

  // ---------- One link / Batch ----------
  function setMode(m) {
    mode = m;
    for (const b of document.querySelectorAll('.dl-mode')) {
      const on = b.dataset.bmode === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    $('dl-form').classList.toggle('hidden', m === 'batch');
    $('bq-in').classList.toggle('hidden', m !== 'batch');
    $('download').classList.toggle('batching', m === 'batch');
    document.body.classList.toggle('dl-batching', m === 'batch'); // the single-link Download button hides
    renderList();
    if (m === 'batch') $('bq-links').focus();
  }
  for (const b of document.querySelectorAll('.dl-mode')) b.addEventListener('click', () => setMode(b.dataset.bmode));

  // ---------- Format for the whole batch ----------
  const qualities = [['best', 'Best quality'], ...[2160, 1440, 1080, 720, 480, 360].map((h) => [String(h), `${h}p`])];
  for (const [v, l] of qualities) $('bq-quality').append(new Option(l, v));
  $('bq-quality').value = '1080';
  try {
    const saved = JSON.parse(localStorage.getItem('nabbit.batchFormat') || '{}');
    if (saved.quality) $('bq-quality').value = saved.quality;
    if (saved.container) $('bq-container').value = saved.container;
  } catch { /* defaults */ }
  const audioOnly = () => ['mp3', 'm4a'].includes($('bq-container').value);
  function syncFormat() {
    $('bq-quality').disabled = audioOnly();
    try { localStorage.setItem('nabbit.batchFormat', JSON.stringify({ quality: $('bq-quality').value, container: $('bq-container').value })); } catch { /* none */ }
  }
  $('bq-quality').addEventListener('change', syncFormat);
  $('bq-container').addEventListener('change', syncFormat);
  syncFormat();

  // ---------- Adding links ----------
  const links = (text) => [...new Set(String(text).split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\/\S+\.\S+/i.test(s)))];
  function countIn() {
    const n = links($('bq-links').value).length;
    $('bq-note').textContent = n ? `${n} link${n === 1 ? '' : 's'}` : '';
    $('bq-add').disabled = !n;
  }
  $('bq-links').addEventListener('input', countIn);
  $('bq-clear-in').addEventListener('click', () => { $('bq-links').value = ''; countIn(); $('bq-links').focus(); });
  countIn();
  $('bq-add').addEventListener('click', () => {
    const urls = links($('bq-links').value);
    if (!urls.length) return;
    const fmt = { quality: $('bq-quality').value, container: $('bq-container').value };
    $('bq-links').value = '';
    countIn();
    for (const url of urls) {
      // A placeholder row while the link is looked up (a playlist becomes one row per video).
      const row = { key: nextKey++, url, title: url, state: 'looking', fmt };
      queue.push(row);
      window.api.batchResolve(url).then(({ items }) => {
        const at = queue.indexOf(row);
        if (at < 0) return; // removed meanwhile
        const rows = items.map((it) => ({ key: nextKey++, ...it, state: 'queued', fmt }));
        queue.splice(at, 1, ...rows);
        renderList(); pump();
      }).catch(() => {
        // Couldn't look it up: download it anyway, by its link.
        row.state = 'queued';
        renderList(); pump();
      });
    }
    renderList();
  });

  // ---------- Running ----------
  const fmtLabel = (f) => (['mp3', 'm4a'].includes(f.container) ? `Audio · ${f.container.toUpperCase()}` : `${f.container.toUpperCase()} · ${f.quality === 'best' ? 'best' : `${f.quality}p`}`);
  async function startRow(row) {
    row.state = 'running'; row.percent = 0; row.status = 'Starting';
    const audio = ['mp3', 'm4a'].includes(row.fmt.container);
    const options = audio ? { format: row.fmt.container === 'mp3' ? 'convert:mp3' : 'orig:m4a', kbps: 320 } : { quality: row.fmt.quality, container: row.fmt.container };
    const title = `Batch · ${row.title}`;
    try {
      const { id } = await window.api.runJob('quick', { url: row.url, mode: audio ? 'music' : 'video', options, outDir: $('dl-out').value }, title);
      row.jobId = id;
      byJob.set(id, row);
      if (typeof addJob === 'function') addJob(id, title);
    } catch (e) {
      row.state = 'err'; row.error = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      pump();
    }
    renderList();
  }
  function pump() {
    if (paused) return;
    while (queue.filter((r) => r.state === 'running').length < PARALLEL) {
      const next = queue.find((r) => r.state === 'queued');
      if (!next) break;
      startRow(next);
    }
    renderList();
  }
  window.api.onProgress(({ id, percent }) => { const r = byJob.get(id); if (r) { r.percent = percent; paintRow(r); } });
  window.api.onStatus(({ id, text }) => { const r = byJob.get(id); if (r) { r.status = text; paintRow(r); } });
  window.api.onDone(({ id, ok, error }) => {
    const r = byJob.get(id);
    if (!r) return;
    byJob.delete(id);
    r.state = ok ? 'done' : 'err';
    r.percent = ok ? 100 : r.percent;
    r.error = ok ? null : (/cancel/i.test(error || '') ? 'Cancelled' : error);
    pump();
  });
  $('bq-pause').addEventListener('click', () => {
    paused = !paused;
    $('bq-pause').textContent = paused ? 'Resume' : 'Pause';
    $('bq-pause').classList.toggle('on', paused);
    $('bq-pause').title = paused ? 'Start the next ones again' : 'Let the running downloads finish, start no new ones';
    pump();
  });
  $('bq-clear-done').addEventListener('click', () => {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state === 'done' || queue[i].state === 'err') queue.splice(i, 1);
    renderList();
  });

  // ---------- The list ----------
  const fmtDur = (s) => { s = Math.round(s || 0); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const STATE = { looking: 'LOOKING UP…', queued: 'QUEUED', done: 'DONE ✓' };
  const rowEls = new Map();
  let dragKey = null;
  function stateText(r) {
    if (r.state === 'running') return `${(r.status || 'Downloading').toUpperCase()} ${r.percent ? Math.floor(r.percent) + '%' : ''}`.trim();
    if (r.state === 'err') return r.error === 'Cancelled' ? 'CANCELLED' : 'FAILED';
    return STATE[r.state];
  }
  function paintRow(r) {
    const el = rowEls.get(r.key);
    if (!el) return;
    el.className = `bq-row ${r.state}`;
    el.querySelector('.bq-bar b').style.width = `${r.state === 'done' ? 100 : r.percent || 0}%`;
    const st = el.querySelector('.bq-state');
    st.textContent = stateText(r);
    st.title = r.state === 'err' && r.error ? r.error : '';
    renderHead();
  }
  function renderHead() {
    const n = queue.length;
    $('bq').classList.toggle('hidden', !n || (mode !== 'batch' && !queue.some((r) => r.state === 'running' || r.state === 'queued' || r.state === 'looking')));
    $('bq-count').textContent = String(n).padStart(2, '0');
    const left = queue.filter((r) => r.state === 'queued' || r.state === 'running' || r.state === 'looking').length;
    const done = queue.filter((r) => r.state === 'done').length;
    $('bq-left').textContent = n ? `${done} done · ${left} to go` : '';
    $('bq-mode-n').textContent = left ? ` · ${left}` : '';
  }
  function renderList() {
    const ol = $('bq-list');
    ol.textContent = '';
    rowEls.clear();
    queue.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = `bq-row ${r.state}`;
      li.dataset.key = r.key;
      li.draggable = r.state === 'queued';
      const n = Object.assign(document.createElement('span'), { className: 'bq-n', textContent: String(i + 1).padStart(2, '0') });
      const th = document.createElement('span');
      th.className = 'bq-thumb';
      th.setAttribute('aria-hidden', 'true');
      if (r.thumbnail && /^https:/i.test(r.thumbnail)) th.style.backgroundImage = `url("${r.thumbnail.replace(/"/g, '%22')}")`;
      const tx = document.createElement('span');
      tx.className = 'bq-tx';
      tx.append(Object.assign(document.createElement('b'), { textContent: r.title || r.url, title: r.url }),
        Object.assign(document.createElement('small'), { textContent: [host(r.url), fmtDur(r.duration), fmtLabel(r.fmt)].filter(Boolean).join(' · ') }));
      const bar = document.createElement('span');
      bar.className = 'bq-bar';
      bar.append(document.createElement('b'));
      tx.append(bar);
      const st = Object.assign(document.createElement('span'), { className: 'bq-state' });
      const x = Object.assign(document.createElement('button'), { type: 'button', className: 'rc-btn', textContent: '✕' });
      x.setAttribute('aria-label', r.state === 'running' ? 'Cancel this download' : 'Remove from the queue');
      x.title = r.state === 'running' ? 'Cancel' : 'Remove';
      x.addEventListener('click', () => {
        if (r.state === 'running' && r.jobId) { window.api.cancelJob(r.jobId); return; }
        const at = queue.indexOf(r);
        if (at >= 0) queue.splice(at, 1);
        renderList();
      });
      li.append(n, th, tx, st, x);
      // Reorder queued rows by dragging.
      li.addEventListener('dragstart', (e) => { dragKey = r.key; e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => { dragKey = null; li.classList.remove('dragging'); });
      li.addEventListener('dragover', (e) => { if (dragKey != null) { e.preventDefault(); li.classList.add('drop'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drop');
        const from = queue.findIndex((q) => q.key === dragKey);
        const to = queue.indexOf(r);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = queue.splice(from, 1);
        queue.splice(to, 0, moved);
        renderList();
      });
      ol.append(li);
      rowEls.set(r.key, li);
      paintRow(r);
    });
    renderHead();
  }
  // Leaving the Video Downloader for the Music one hides the batch controls; the queue keeps running.
  new MutationObserver(() => { if ($('download').classList.contains('music') && mode === 'batch') setMode('one'); }).observe($('download'), { attributes: true, attributeFilter: ['class'] });
  renderList();
})();
