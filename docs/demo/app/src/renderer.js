const $ = (id) => document.getElementById(id);
const MEDIA_FILTERS = [
  { name: 'Media', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'gif', 'mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'opus'] },
  { name: 'All files', extensions: ['*'] },
];

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab, .panel').forEach((el) => el.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.tool).classList.add('active');
  })
);

// ---------- Pickers ----------
document.querySelectorAll('[data-file]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const p = await window.api.pickFile(MEDIA_FILTERS);
    if (!p) return;
    $(btn.dataset.file).value = p;
  })
);
document.querySelectorAll('[data-folder]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const p = await window.api.pickFolder();
    if (p) $(btn.dataset.folder).value = p;
  })
);
window.api.defaultFolder().then((p) => ($('dl-out').value = p));

// ---------- Job queue UI ----------
const jobEls = new Map();
const baseName = (p) => p.split(/[\\/]/).pop();

const removedJobs = new Set(); // dismissed with ✕ / Clear all: never shown again
function addJob(id, title) {
  if (jobEls.has(id) || removedJobs.has(id)) return;
  const empty = document.querySelector('#jobs .empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = 'job';
  el.innerHTML = `
    <div class="job-head"><span class="job-title"></span><button type="button" class="job-x" aria-label="Remove">✕</button></div>
    <div class="bar"><div></div></div>
    <div class="job-status">Starting…</div>
    <div class="job-actions"><button class="ghost cancel">Cancel</button></div>
    <details><summary>Log</summary><pre class="log"></pre></details>`;
  el.querySelector('.job-title').textContent = title;
  el.querySelector('.job-title').title = title;
  el.querySelector('.cancel').onclick = () => window.api.cancelJob(id);
  el.querySelector('.job-x').onclick = () => removeJob(id);
  el.querySelector('.job-x').title = 'Remove from the list (a running job is cancelled)';
  $('jobs').prepend(el);
  jobEls.set(id, el);
  jobsCount();
}

const jobRunning = (el) => !el.classList.contains('ok') && !el.classList.contains('err');
// ✕: removes a job from the list; a job still running is cancelled first.
function removeJob(id) {
  const el = jobEls.get(id);
  if (!el) return;
  if (jobRunning(el)) window.api.cancelJob(id);
  removedJobs.add(id);
  jobEls.delete(id);
  jobState.delete(id);
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 220);
  jobsCount();
}
// Clear all: removes every finished job (done or failed); running ones stay (✕ cancels one).
$('jobs-clear').onclick = () => {
  for (const [id, el] of [...jobEls]) if (!jobRunning(el)) removeJob(id);
};

// The collapsed "Jobs" header shows how many are running (accent), or how many there are.
function jobsCount() {
  const all = [...jobEls.values()];
  const running = all.filter((el) => !el.classList.contains('ok') && !el.classList.contains('err')).length;
  const badge = $('jobs-count');
  badge.textContent = running || all.length;
  badge.title = running ? `${running} running` : `${all.length} finished`;
  badge.classList.toggle('busy', running > 0);
  badge.classList.toggle('hidden', !all.length);
  // Clear all: only when something has finished; the empty note when nothing's left.
  $('jobs-clear').classList.toggle('hidden', !all.some((el) => !jobRunning(el)));
  if (!all.length && !document.querySelector('#jobs .empty')) {
    setTimeout(() => { if (!jobEls.size && !document.querySelector('#jobs .empty')) $('jobs').append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No jobs yet.' })); }, 240);
  }
}

const jobState = new Map(); // id -> { status, percent }
function paintStatus(id) {
  const el = jobEls.get(id);
  const st = jobState.get(id);
  if (!el || !st || el.classList.contains('ok') || el.classList.contains('err')) return;
  el.querySelector('.job-status').textContent = [st.status, st.percent != null ? st.percent.toFixed(1) + '%' : ''].filter(Boolean).join(' · ');
}
window.api.onProgress(({ id, percent }) => {
  const el = jobEls.get(id);
  if (!el) return;
  el.querySelector('.bar > div').style.width = percent + '%';
  jobState.set(id, { ...jobState.get(id), percent });
  paintStatus(id);
});
window.api.onStatus(({ id, text }) => {
  jobState.set(id, { ...jobState.get(id), status: text });
  paintStatus(id);
});
window.api.onLog(({ id, line }) => {
  const log = jobEls.get(id)?.querySelector('.log');
  if (!log) return;
  log.textContent += line + '\n';
  log.scrollTop = log.scrollHeight;
});
window.api.onDone(({ id, ok, output, outputs, error }) => {
  const el = jobEls.get(id);
  if (!el) return;
  el.classList.add(ok ? 'ok' : 'err');
  jobsCount();
  el.querySelector('.job-status').textContent = ok
    ? (outputs && outputs.length > 1 ? `Done · ${outputs.length} files` : 'Done')
    : error;
  if (ok) el.querySelector('.bar > div').style.width = '100%';
  const actions = el.querySelector('.job-actions');
  actions.innerHTML = '';
  if (ok && output) {
    const b = document.createElement('button');
    b.className = 'ghost';
    b.textContent = 'Show in folder';
    b.onclick = () => window.api.showItem(output);
    actions.append(b);
  }
});

async function start(type, opts, title) {
  try {
    const { id } = await window.api.runJob(type, opts, title);
    addJob(id, title);
  } catch (e) {
    alert(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

// ---------- Tool actions ----------



// ---------- Converter (built-in engine) ----------
let presets = [];
let cvFiles = [];
const extOf = (p) => (p.split('.').pop() || '').toLowerCase();

async function loadPresets(list) {
  presets = list || (await window.api.convPresets());
  renderPresets();
}

function renderPresets() {
  const exts = [...new Set(cvFiles.map(extOf))];
  // Only show presets that accept every selected file type (like File Converter's right-click menu)
  const usable = presets.filter((p) => exts.every((e) => p.inputTypes.includes(e)));
  const list = cvFiles.length ? usable : presets;
  const sel = $('cv-preset');
  const prev = sel.value;
  sel.innerHTML = '';
  const groups = new Map();
  for (const p of list) {
    const parts = p.name.split('/');
    const group = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ value: p.name, label: parts[parts.length - 1] });
  }
  for (const [group, items] of groups) {
    const parent = group ? Object.assign(document.createElement('optgroup'), { label: group }) : sel;
    for (const it of items) parent.append(new Option(it.label, it.value));
    if (group) sel.append(parent);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  pkGroups = groups;
  pickerShow();
  $('cv-go').disabled = !cvFiles.length || !list.length;
  $('cv-preset-hint').textContent = cvFiles.length && !usable.length
    ? 'No preset accepts all of these file types together. Try converting them separately.'
    : cvFiles.length ? `${usable.length} presets fit ${exts.map((e) => '.' + e).join(', ')}` : '';
}

// ---------- Preset picker: the presets with collapsible groups (the select underneath keeps the value) ----------
let pkGroups = new Map();
const pkOpen = new Set(); // groups opened by hand
function pickerShow() {
  const sel = $('cv-preset');
  const o = sel.selectedOptions[0];
  $('cv-pk-val').textContent = o ? (o.parentElement.tagName === 'OPTGROUP' ? `${o.parentElement.label} / ${o.textContent}` : o.textContent) : 'Choose a preset';
  $('cv-pk-btn').disabled = !sel.options.length;
  if (!$('cv-pk-pop').classList.contains('hidden')) pickerList();
}
function pickerList() {
  const box = $('cv-pk-list');
  const q = $('cv-pk-filter').value.trim().toLowerCase();
  const cur = $('cv-preset').value;
  box.innerHTML = '';
  const item = (it) => {
    const b = el('button', { type: 'button', className: 'pk-item' + (it.value === cur ? ' on' : ''), textContent: it.label });
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(it.value === cur));
    b.onclick = () => pickerPick(it.value);
    return b;
  };
  for (const [group, items] of pkGroups) {
    const shown = q ? items.filter((it) => `${group} ${it.label}`.toLowerCase().includes(q)) : items;
    if (!shown.length) continue;
    if (!group) { shown.forEach((it) => box.append(item(it))); continue; }
    // Open when filtering, when opened by hand, or when it holds the current preset.
    const open = !!q || pkOpen.has(group) || items.some((it) => it.value === cur);
    const head = el('button', { type: 'button', className: 'pk-group' + (open ? ' open' : '') },
      el('span', { className: 'pk-tw', textContent: open ? '▾' : '▸' }), el('span', { className: 'pk-gname', textContent: group }),
      el('span', { className: 'pk-n', textContent: String(shown.length) }));
    head.setAttribute('aria-expanded', String(open));
    // A group holding the current preset, closed by hand, stays closed ("!group").
    const closedByHand = pkOpen.has(`!${group}`) && !q && !pkOpen.has(group);
    if (closedByHand) { head.classList.remove('open'); head.querySelector('.pk-tw').textContent = '▸'; head.setAttribute('aria-expanded', 'false'); }
    head.onclick = () => {
      if (head.classList.contains('open')) { pkOpen.delete(group); pkOpen.add(`!${group}`); } else { pkOpen.add(group); pkOpen.delete(`!${group}`); }
      pickerList();
    };
    box.append(head);
    if (head.classList.contains('open')) {
      const wrap = el('div', { className: 'pk-sub' });
      shown.forEach((it) => wrap.append(item(it)));
      box.append(wrap);
    }
  }
  if (!box.childNodes.length) box.append(el('p', { className: 'pk-none', textContent: 'No presets match.' }));
}
function pickerPick(value) {
  const sel = $('cv-preset');
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
  pickerClose();
  pickerShow();
  $('cv-pk-btn').focus();
}
function pickerOpen() {
  $('cv-pk-pop').classList.remove('hidden');
  $('cv-pk-btn').setAttribute('aria-expanded', 'true');
  $('cv-pk-filter').value = '';
  pickerList();
  $('cv-pk-filter').focus();
  const on = $('cv-pk-list').querySelector('.pk-item.on');
  if (on) on.scrollIntoView({ block: 'center' });
}
function pickerClose() {
  $('cv-pk-pop').classList.add('hidden');
  $('cv-pk-btn').setAttribute('aria-expanded', 'false');
}
$('cv-pk-btn').onclick = () => { if ($('cv-pk-pop').classList.contains('hidden')) pickerOpen(); else pickerClose(); };
$('cv-pk-filter').addEventListener('input', pickerList);
$('cv-pk-filter').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const first = $('cv-pk-list').querySelector('.pk-item'); if (first) { e.preventDefault(); first.click(); } }
  if (e.key === 'ArrowDown') { const first = $('cv-pk-list').querySelector('button'); if (first) { e.preventDefault(); first.focus(); } }
});
$('cv-pk-pop').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); pickerClose(); $('cv-pk-btn').focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const all = [...$('cv-pk-pop').querySelectorAll('.pk-filter, .pk-list button')];
    const i = all.indexOf(document.activeElement);
    if (i >= 0) { e.preventDefault(); (all[i + (e.key === 'ArrowDown' ? 1 : -1)] || all[i]).focus(); }
  }
});
document.addEventListener('pointerdown', (e) => { if (!$('cv-pk').contains(e.target)) pickerClose(); });

function renderFiles() {
  const ul = $('cv-list');
  ul.innerHTML = '';
  cvFiles.forEach((p, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p;
    name.title = p;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.title = 'Remove';
    rm.onclick = () => { cvFiles.splice(i, 1); renderFiles(); };
    li.append(name, rm);
    ul.append(li);
  });
  renderPresets();
}

function addFiles(paths) {
  for (const p of paths) if (p && !cvFiles.includes(p)) cvFiles.push(p);
  renderFiles();
}

$('cv-add').onclick = async () => addFiles(await window.api.pickFiles([{ name: 'All files', extensions: ['*'] }]));
const drop = $('cv-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  addFiles([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)));
});

// Remember the hardware encoding choice
// Saved with the other settings (also used for conversions from Explorer's right-click menu).
$('cv-hw').onchange = () => saveSetting({ hwAccel: $('cv-hw').value });

$('cv-go').onclick = () => {
  if (!cvFiles.length) return;
  const preset = $('cv-preset').value;
  const hwAccel = $('cv-hw').value;
  // One job per file, so each gets its own progress bar
  for (const input of cvFiles) start('convert', { input, preset, hwAccel }, `Convert · ${baseName(input)} → ${preset}`);
  cvFiles = [];
  renderFiles();
};

$('cv-edit').onclick = () => window.api.convEditPresets();
$('cv-reload').onclick = () => loadPresets();
$('cv-reset').onclick = async () => {
  if (confirm('Replace your presets with the built-in defaults?')) loadPresets(await window.api.convResetPresets());
};
// Presets may have been edited, so reload them whenever the tab opens
document.querySelector('[data-tool="convert"]').addEventListener('click', () => loadPresets());
loadPresets();
window.api.convEngine().then((e) => {
  $('cv-engine').textContent = `Engine: ${e.ffmpeg}` + (e.ghostscript ? ' · Ghostscript' : ' · no Ghostscript (PDF input disabled)') +
    (e.office ? ' · Office documents need Microsoft Office' : '');
});

// ---------- Video Downloader ----------
// The bottom bar (format, folder, Download) shows on the Downloader tab once a video is found.
function updateDlBar() {
  const card = !$('dl-card').classList.contains('hidden');
  const album = !$('mu-album').classList.contains('hidden');
  const show = $('download').classList.contains('active') && (card || album);
  const music = $('download').classList.contains('music');
  const song = music && card && !album;
  $('dl-bar').classList.toggle('hidden', !show);
  // Music: the format options sit in the bar, and "Get album" / "Get song" asks where to save.
  $('dl-bar').classList.toggle('album-mode', music && album);
  $('dl-bar').classList.toggle('song-mode', song);
  placeOptions(song);
  $('dl-go').textContent = music && album ? `Get ${($('mu-kind').textContent || 'album').toLowerCase()}` : song ? 'Get song' : 'Download';
  $('dl-play').classList.toggle('hidden', !(music && (album || song)));
  $('dl-play').textContent = album ? '▶ Play all' : '▶ Play';
  // Music extras (cover art / lyrics) apply to songs and albums.
  $('mu-extras').classList.toggle('hidden', !(music && (card || album)));
}
// A song's audio options move into the bottom bar (music); videos keep them under the card.
const optsHome = { parent: $('dl-options').parentNode, next: $('dl-options').nextSibling };
function placeOptions(inBar) {
  const opts = $('dl-options');
  if (inBar && opts.parentNode !== $('dl-bar').querySelector('.bar-inner')) {
    $('dl-bar').querySelector('.bar-inner').insertBefore(opts, $('dl-bar').querySelector('.folder-pick'));
  } else if (!inBar && opts.parentNode !== optsHome.parent) {
    optsHome.parent.insertBefore(opts, optsHome.next);
  }
}
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', updateDlBar));
let dlInfo = null;      // metadata of the video on the card
let dlSearchSeq = 0;    // ignores answers from searches that were replaced

function dlState(kind, text) {
  const el = $('dl-state');
  el.className = 'dl-state' + (kind === 'error' ? ' error' : '') + (kind ? '' : ' hidden');
  el.innerHTML = '';
  if (kind === 'loading') el.append(Object.assign(document.createElement('span'), { className: 'spinner' }));
  if (text) el.append(document.createTextNode(text));
}

// Builds "a · b · c" from the parts that exist. Parts are strings or DOM nodes.
function dotLine(el, parts) {
  el.innerHTML = '';
  parts.filter(Boolean).forEach((part, i) => {
    if (i) el.append(Object.assign(document.createElement('span'), { className: 'dot', textContent: '·' }));
    el.append(typeof part === 'string' ? document.createTextNode(part) : part);
  });
  el.classList.toggle('hidden', !el.childNodes.length);
}

function extLink(text, url, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-btn' + (className ? ' ' + className : '');
  b.textContent = text;
  b.onclick = () => window.api.openExternal(url);
  return b;
}

// Small ⓘ icon button that opens a website (used for the Return YouTube Dislike credit).
function infoLink(tooltip, url) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'info-btn';
  b.title = tooltip;
  b.setAttribute('aria-label', tooltip);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }).forEach(([k, v]) => circle.setAttribute(k, v));
  const stem = document.createElementNS(NS, 'path');
  Object.entries({ d: 'M8 7.2v4', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }).forEach(([k, v]) => stem.setAttribute(k, v));
  const dot = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 8, cy: 4.9, r: 0.95, fill: 'currentColor' }).forEach(([k, v]) => dot.setAttribute(k, v));
  svg.append(circle, stem, dot);
  b.append(svg);
  b.onclick = () => window.api.openExternal(url);
  return b;
}

const exact = (n) => (n == null ? '' : Number(n).toLocaleString());
function stat(compact, exactValue, label) {
  if (!compact) return null;
  const span = document.createElement('span');
  span.textContent = `${compact} ${label}`;
  span.title = `${exact(exactValue)} ${label}`;
  return span;
}

function renderCard(info) {
  dlInfo = info;
  const thumb = $('dl-thumb');
  thumb.parentElement.classList.toggle('hidden', !info.thumbnail);
  if (info.thumbnail) thumb.src = info.thumbnail;
  $('dl-duration-badge').textContent = info.isLive ? 'LIVE' : info.duration || '';
  $('dl-duration-badge').classList.toggle('hidden', !info.isLive && !info.duration);

  renderThumbMenu(info);

  $('dl-title').textContent = info.title;
  $('dl-title').title = info.title;
  // Music mode: artist (falls back to the uploader) and album when the site provides them.
  const who = dlMode === 'music' && info.artist ? info.artist : info.uploader;
  dotLine($('dl-uploader'), [
    dlMode === 'music' && info.artistLinks && info.artistLinks.length ? artistNodes({ artist: who, artistLinks: info.artistLinks })
      : who && (info.uploaderUrl && who === info.uploader ? extLink(who, info.uploaderUrl) : who),
    dlMode === 'music' && info.album ? albumLine(info) : null,
  ]);

  // Duration · Views · Likes · Dislikes (Return YouTube Dislike)
  let dislikes = stat(info.dislikes, info.dislikesExact, 'dislikes');
  if (dislikes && info.dislikesFromRyd) {
    const wrap = document.createElement('span');
    dislikes.title += ' (estimate)';
    wrap.append(dislikes, infoLink(
      'Dislikes are estimates from Return YouTube Dislike. Click to open returnyoutubedislike.com',
      'https://returnyoutubedislike.com'));
    dislikes = wrap;
  }
  dotLine($('dl-stats'), [
    info.isLive ? 'Live' : info.duration,
    stat(info.views, info.viewsExact, 'views'),
    stat(info.likes, info.likesExact, 'likes'),
    dislikes,
  ]);
  dotLine($('dl-date'), [info.date]);
  dotLine($('dl-tech'), [info.resolution, info.fps, info.bitrate]);

  const source = [];
  if (info.domain || info.site) {
    const label = info.domain || info.site;
    source.push(info.webpageUrl ? extLink(label, info.webpageUrl) : label);
  }
  if (info.site && info.domain && info.site.toLowerCase() !== info.domain.split('.')[0]) source.push(info.site);
  dotLine($('dl-source'), source);
  if (source.length) $('dl-source').prepend(Object.assign(document.createElement('span'), { className: 'label', textContent: 'Source:' }));

  $('dl-card').classList.remove('hidden');
  if (dlMode === 'music') showMusicView('card');
  renderOptions(info);
  updateDlBar();
}

const URL_PREFIX = 'https://';
// "https://https://site/x" (prefix + pasted link) → "https://site/x"
const cleanUrl = (v) => v.trim().replace(/^(https?:\/\/)+(?=https?:\/\/)/i, '');

async function dlSearch() {
  const url = cleanUrl($('dl-url').value);
  $('dl-url').value = url;
  if (!url || /^https?:\/\/$/i.test(url)) return $('dl-url').focus();
  // Music Downloader: words → search; a link → song card or album view.
  if (dlMode === 'music') return /^https?:\/\//i.test(url) ? musicOpen(url) : musicSearch(url);
  const seq = ++dlSearchSeq;
  $('dl-card').classList.add('hidden');
  $('dl-options').classList.add('hidden');
  updateDlBar();
  dlInfo = null;
  dlState('loading', 'Looking up video…');
  $('dl-search').disabled = true;
  try {
    const info = await window.api.videoInfo(url);
    if (seq !== dlSearchSeq) return;
    dlState(null);
    renderCard(info);
  } catch (e) {
    if (seq !== dlSearchSeq) return;
    const msg = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (msg === 'cancelled') dlState(null);
    else dlState('error', msg);
  } finally {
    if (seq === dlSearchSeq) $('dl-search').disabled = false;
  }
}

$('dl-form').addEventListener('submit', (e) => {
  e.preventDefault();
  dlSearch();
});
// Pasting a full link replaces the box (instead of "https://https://…") and searches right away
$('dl-url').addEventListener('paste', (e) => {
  const text = (e.clipboardData.getData('text') || '').trim();
  if (/^https?:\/\/\S+$/i.test(text)) {
    e.preventDefault();
    $('dl-url').value = text;
    dlSearch();
  } else {
    setTimeout(() => { if (/^https?:\/\/\S+\.\S+$/i.test($('dl-url').value.trim())) dlSearch(); }, 0);
  }
});
// Clicking into the box puts the cursor after "https://"
$('dl-url').addEventListener('focus', () => {
  const el = $('dl-url');
  if (el.value === URL_PREFIX) setTimeout(() => el.setSelectionRange(el.value.length, el.value.length), 0);
});
$('dl-clear').onclick = () => {
  dlSearchSeq++;
  window.api.cancelVideoInfo();
  $('dl-url').value = dlMode === 'music' ? '' : URL_PREFIX;
  $('dl-card').classList.add('hidden');
  $('dl-options').classList.add('hidden');
  if (dlMode === 'music') { muResults = null; muAlbum = null; showMusicView(null); }
  updateDlBar();
  $('dl-search').disabled = false;
  dlInfo = null;
  dlState(null);
  $('dl-url').focus();
};

$('dl-play').onclick = () => {
  if (dlMode !== 'music') return;
  if (muAlbum && !$('mu-album').classList.contains('hidden')) return playAlbum();
  if (!dlInfo) return;
  window.Player.play(playItem({ url: dlInfo.webpageUrl || $('dl-url').value.trim(), title: dlInfo.title, artist: dlInfo.artist || dlInfo.uploader,
    artistLinks: dlInfo.artistLinks, album: dlInfo.album, albumUrl: dlInfo.albumUrl, thumbnail: dlInfo.thumbnail, duration: dlInfo.duration }));
};
// Music asks where to save (starting in the folder used last time); videos use the folder in the bar.
async function pickMusicFolder(kind) {
  let last = '';
  try { last = localStorage.getItem('muAlbumDir') || ''; } catch {}
  const dir = await window.api.pickFolder({ title: `Save ${kind} to`, defaultPath: last || $('dl-out').value });
  if (dir) try { localStorage.setItem('muAlbumDir', dir); } catch {}
  return dir;
}
$('dl-go').onclick = async () => {
  if (dlMode === 'music' && muAlbum && !$('mu-album').classList.contains('hidden')) return downloadAlbum();
  if (!dlInfo) return;
  let outDir = $('dl-out').value;
  if (dlMode === 'music') {
    outDir = await pickMusicFolder('song');
    if (!outDir || !dlInfo) return;
  }
  const url = dlInfo.webpageUrl || $('dl-url').value.trim();
  const v = selectedVideo();
  const a = selectedAudio();
  const plan = dlFormats ? Formats.planDownload($('dl-vfmt').value, v, $('dl-afmt').value, a,
    videoKind() === 'convert' || audioConverting() ? currentTarget() : videoTransform) : null;
  if (dlFormats && !plan) return;
  const audio = plan && plan.audioId ? a : null;
  start('download', {
    url,
    videoId: plan ? plan.videoId : null,
    audioId: plan ? plan.audioId : null,
    container: plan ? plan.merge : null,
    post: plan ? plan.post : null,
    weights: [v && v.size ? v.size.bytes : 0, audio && audio.size ? audio.size.bytes : 0],
    music: dlMode === 'music',
    cover: $('mu-cover-on').checked,
    lyrics: $('mu-lyrics-on').checked,
    outDir,
  }, `${dlMode === 'music' ? 'Music' : 'Download'} · ${dlInfo.title}` + (plan && plan.post ? ` → ${plan.post.ext.toUpperCase()}` : '') +
    (plan && plan.post && plan.post.height ? ` · ${plan.post.height}p ${plan.post.fps} fps` : '') +
    (plan && plan.post && plan.post.videoKbps ? ` · ${Formats.formatKbps(plan.post.videoKbps)}` : ''));
};

// ---------- Thumbnail download (hover icon on the card's thumbnail) ----------
function closeThumbMenu() {
  $('dl-thumb-menu').classList.add('hidden');
  $('dl-thumb-btn').setAttribute('aria-expanded', 'false');
  $('dl-thumb').parentElement.classList.remove('menu-open');
}

function renderThumbMenu(info) {
  closeThumbMenu();
  const menu = $('dl-thumb-menu');
  menu.innerHTML = '';
  const options = info.thumbnails || [];
  $('dl-thumb-btn').classList.toggle('hidden', !options.length);
  menu.append(Object.assign(document.createElement('div'), { className: 'menu-title', textContent: 'Download thumbnail' }));
  for (const t of options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.append(document.createTextNode(t.label));
    if (t.ext) item.append(Object.assign(document.createElement('span'), { className: 'fmt', textContent: t.ext.toUpperCase() }));
    item.onclick = () => {
      closeThumbMenu();
      start('thumbnail', { url: t.url, label: t.label, title: info.title, outDir: $('dl-out').value },
        `Thumbnail · ${t.label} · ${info.title}`);
    };
    menu.append(item);
  }
}

$('dl-thumb-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('dl-thumb-menu');
  const open = menu.classList.contains('hidden');
  closeThumbMenu();
  if (open) {
    menu.classList.remove('hidden');
    $('dl-thumb-btn').setAttribute('aria-expanded', 'true');
    $('dl-thumb').parentElement.classList.add('menu-open');
    const first = menu.querySelector('button');
    if (first) first.focus();
  }
});
document.addEventListener('click', (e) => { if (!$('dl-thumb-menu').contains(e.target)) closeThumbMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeThumbMenu(); });

// ---------- Download options (cascading dropdowns) ----------
// Video: Format → Resolution → FPS → Bitrate.  Audio: Format → Sample rate → Bitrate.
// Format lists are grouped: Original (the site's streams), Remux (copied into another container,
// no quality loss) and Convert (re-encoded with the Converter's presets).
// Each later list only offers what exists for the choices to its left.
const NONE = '__none__';
let dlFormats = null;      // parsed formats of the video on the card
let audioTouched = false;  // once the user picks an audio format, stop auto-matching it to the video

// Fills a <select> from items or groups, keeping the current value if it's still offered.
function fillSelect(sel, entries, preferred) {
  const keep = preferred !== undefined ? preferred : sel.value;
  sel.innerHTML = '';
  const values = [];
  for (const e of entries) {
    if (e.group) {
      const og = Object.assign(document.createElement('optgroup'), { label: e.group });
      for (const it of e.items) { og.append(new Option(it.label, it.value)); values.push(it.value); }
      sel.append(og);
    } else {
      const opt = new Option(e.label, e.value);
      if (e.oor) {
        opt.className = 'oor';
        opt.title = "The site doesn't offer this. The closest stream is downloaded and re-encoded to it.";
      }
      sel.append(opt);
      values.push(e.value);
    }
  }
  // Fallback: the first value the site actually has (never an upscaled / out-of-range one).
  sel.value = values.includes(keep) ? keep : (entries.find((e) => !e.group && !e.oor && e.real !== false) || {}).value || values[0] || '';
  sel.disabled = values.length <= 1;
  markOutOfRange(sel);
  return sel.value;
}
// The closed dropdown turns red while an out-of-range value is selected.
function markOutOfRange(sel) {
  const opt = sel.selectedOptions[0];
  sel.classList.toggle('oor', !!(opt && opt.classList.contains('oor')));
  sel.title = opt && opt.classList.contains('oor') ? opt.title : sel.dataset.title || sel.title;
}
for (const id of ['dl-vres', 'dl-vfps']) $(id).dataset.title = $(id).title;
function disableSelects(ids, label) {
  for (const id of ids) {
    const sel = $(id);
    sel.innerHTML = '';
    sel.append(new Option(label, ''));
    sel.disabled = true;
    sel.classList.remove('oor');
  }
}
let videoTransform = null; // resolution / fps that differ from the source stream (remux out of range, or convert)
let convertVideoSource = null; // Convert: best real stream for the chosen size (the bitrate list is the output target)
let convertAudioSource = null; // Convert audio: best real stream for the chosen format / sample rate
const numOrNull = (v) => (v === 'null' || v === '' ? null : Number(v));
const isNone = (id) => $(id).value === NONE || !$(id).value;

const videoKind = () => Formats.parseChoice($('dl-vfmt').value).kind;
// Audio is re-encoded when converting a video (not GIF) or converting audio only.
function audioConverting() {
  if (isNone('dl-afmt')) return false;
  const vc = Formats.parseChoice($('dl-vfmt').value);
  if (vc.kind === 'convert') return vc.ext !== 'gif';
  return isNone('dl-vfmt') && Formats.parseChoice($('dl-afmt').value).kind === 'convert';
}
const selectedVideo = () => {
  if (!dlFormats || isNone('dl-vfmt')) return null;
  if (videoKind() === 'convert') return convertVideoSource;
  return dlFormats.video.find((f) => f.id === $('dl-vbr').value) || null;
};
const selectedAudio = () => {
  if (!dlFormats || isNone('dl-afmt')) return null;
  if (audioConverting()) return convertAudioSource;
  return dlFormats.audio.find((f) => f.id === $('dl-abr').value) || null;
};
const kbpsValue = (id) => (/^\d+$/.test($(id).value) ? Number($(id).value) : null);

// Bitrate options; mixed pools (remux/convert) also show the codec.
function bitrateItems(list, mixed) {
  return list.map((f, i) => ({
    value: f.id,
    label: (Formats.formatKbps(f.kbps) || 'Default') + (mixed ? ` · ${f.codec}` : '') +
      (list.some((g, j) => j !== i && g.kbps === f.kbps && g.codec === f.codec) ? ` (${f.id})` : ''),
  }));
}

function cascadeVideo() {
  const p = dlFormats;
  const value = $('dl-vfmt').value;
  videoTransform = null;
  if (value === NONE || !value) return disableSelects(['dl-vres', 'dl-vfps', 'dl-vbr'], '—');
  const pool = Formats.videoPool(p, value);
  const mixed = Formats.parseChoice(value).kind !== 'original';
  const kind = Formats.parseChoice(value).kind;
  if ((kind === 'remux' || kind === 'convert') && pool.some((f) => f.height)) {
    // Remux and Convert: any standard resolution / fps. For Remux, values the site doesn't have are
    // out of range (red, re-encoded). Convert re-encodes anyway, so nothing is restricted or flagged.
    const flag = kind === 'remux';
    const h = numOrNull(fillSelect($('dl-vres'), Formats.remuxHeights(pool).map((x) => ({
      value: String(x.height), label: `${x.height}p` + (flag && x.oor ? ' (out of range)' : ''), oor: flag && x.oor, real: !x.oor,
    }))));
    const fr = numOrNull(fillSelect($('dl-vfps'), Formats.remuxFps(pool, h).map((x) => ({
      value: String(x.fps), label: `${x.fps} fps` + (flag && x.oor ? ' (out of range)' : ''), oor: flag && x.oor, real: !x.oor,
    }))));
    const { streams, transform } = Formats.remuxStreams(pool, h, fr);
    videoTransform = transform;
    if (kind === 'convert') {
      // Convert: download the best real stream; the bitrate list is the output bitrate (any value).
      convertVideoSource = streams[0] || null;
      if (Formats.parseChoice(value).ext === 'gif') return disableSelects(['dl-vbr'], 'N/A for GIF');
      fillSelect($('dl-vbr'), [{ value: 'auto', label: 'Auto (preset quality)' },
        ...Formats.VIDEO_KBPS.map((k) => ({ value: String(k), label: Formats.formatKbps(k) }))], undefined);
      return;
    }
    fillSelect($('dl-vbr'), bitrateItems(streams, true));
    return;
  }
  const h = numOrNull(fillSelect($('dl-vres'), Formats.resolutionsIn(pool).map((x) => ({ value: String(x), label: x ? `${x}p` : 'Default' }))));
  const fr = numOrNull(fillSelect($('dl-vfps'), Formats.fpsIn(pool, h).map((x) => ({ value: String(x), label: x ? `${x} fps` : 'Default' }))));
  fillSelect($('dl-vbr'), bitrateItems(Formats.bitratesIn(pool, h, fr), mixed));
}

function showSampleSize(show) {
  $('dl-abits').classList.toggle('slot-hidden', !show);
  if (show && !$('dl-abits').options.length) {
    fillSelect($('dl-abits'), Formats.SAMPLE_BITS.map((b) => ({ value: String(b), label: `${b}-bit` })), '16');
    $('dl-abits').disabled = false;
  }
}
// Lossless audio-only conversion (FLAC / WAV): sample size instead of bitrate.
const losslessAudio = () => audioConverting() && isNone('dl-vfmt') &&
  Formats.LOSSLESS.includes(Formats.parseChoice($('dl-afmt').value).ext);

function cascadeAudio() {
  const p = dlFormats;
  showSampleSize(false);
  const videoValue = $('dl-vfmt').value;
  const videoNone = videoValue === NONE || !videoValue;
  const v = selectedVideo();
  const ids = ['dl-asr', 'dl-abr'];
  const vc = Formats.parseChoice(videoValue);
  if (v && v.hasAudio) return disableSelects(['dl-afmt', ...ids], 'Included with video');
  const gif = vc.kind === 'convert' && vc.ext === 'gif';
  let groups = Formats.audioGroups(p, videoValue, videoNone);
  // "Highest quality possible" is for YouTube (Music) only: other sites' streams (SoundCloud's top out
  // around 128–160 kbps) gain nothing from it.
  if (!(dlInfo && isYouTubeUrl(dlInfo.webpageUrl))) groups = groups.filter((g) => g.group !== 'Best');
  if (gif) {
    // GIF has no sound: only the audio-only formats remain (picking one switches to audio only).
    groups = [{ value: NONE, label: 'No audio (GIF)' }, ...groups.filter((g) => g.group !== 'Original')];
    const value = fillSelect($('dl-afmt'), groups, NONE);
    if (value === NONE) return disableSelects(ids, '—');
  }
  if (!videoNone && !gif && groups.length) groups.push({ value: NONE, label: 'None (video only)' });
  if (!groups.length) return disableSelects(['dl-afmt', ...ids], 'No audio');
  let auto = audioTouched ? undefined : (Formats.matchingAudioKey(p, vc.kind === 'original' ? videoValue : null) || undefined);
  // Music from YouTube: start on "Highest quality possible" (FLAC).
  if (!audioTouched && dlMode === 'music' && videoNone && groups.some((g) => (g.items || []).some((i) => i.value === 'best:flac'))) auto = 'best:flac';
  const value = fillSelect($('dl-afmt'), groups, auto);
  if (value === NONE) return disableSelects(ids, '—');
  const pool = Formats.audioPool(p, value, videoValue);
  const mixed = Formats.parseChoice(value).kind !== 'original';
  if (audioConverting()) {
    // Converting: download the best stream; sample rate and bitrate are output choices (any value
    // the format supports).
    convertAudioSource = pool.slice().sort((a, b) => (b.kbps || 0) - (a.kbps || 0))[0] || null;
    const ac = Formats.parseChoice(value);
    // The audio track's format: the audio choice, or for a video conversion the video container.
    const outExt = isNone('dl-vfmt') ? ac.ext : vc.ext;
    fillSelect($('dl-asr'), [{ value: 'auto', label: 'Auto (source)' }, ...Formats.ratesFor(outExt).map((x) => ({ value: String(x), label: khz(x) }))],
      /^\d+$/.test($('dl-asr').value) && Formats.ratesFor(outExt).includes(Number($('dl-asr').value)) ? $('dl-asr').value : 'auto');
    $('dl-asr').title = 'Output sample rate';
    if (isNone('dl-vfmt') && Formats.LOSSLESS.includes(ac.ext)) {
      showSampleSize(true);
      return disableSelects(['dl-abr'], 'Lossless');
    }
    fillSelect($('dl-abr'), [{ value: 'auto', label: 'Auto (preset quality)' },
      ...Formats.AUDIO_KBPS.map((k) => ({ value: String(k), label: `${k} kbps` }))]);
    return;
  }
  $('dl-asr').title = 'Sample rate';
  const r = numOrNull(fillSelect($('dl-asr'), Formats.sampleRatesIn(pool).map((x) => ({ value: String(x), label: x ? khz(x) : 'Default' }))));
  fillSelect($('dl-abr'), bitrateItems(Formats.audioBitratesIn(pool, r), mixed));
}
const khz = (x) => `${x / 1000} kHz`; // 22050 → 22.05, 44100 → 44.1, 48000 → 48

// Size of one row: exact/estimated for originals and remuxes (same streams), unknown for conversions.
function rowSize(stream, choice, transform) {
  if (!stream) return '';
  if (Formats.parseChoice(choice).kind === 'convert' || transform) return 're-encoded';
  return Formats.formatBytes(stream.size);
}

// Everything that overrides the source when converting: size / fps differences and chosen bitrates.
function currentTarget() {
  const t = { ...(videoTransform || {}) };
  if (videoKind() === 'convert' && kbpsValue('dl-vbr')) t.videoKbps = kbpsValue('dl-vbr');
  if (audioConverting() && kbpsValue('dl-abr')) t.audioKbps = kbpsValue('dl-abr');
  if (losslessAudio()) t.sampleBits = Number($('dl-abits').value) || 16;
  if (audioConverting() && /^\d+$/.test($('dl-asr').value)) t.sampleRate = Number($('dl-asr').value);
  return Object.keys(t).length ? t : null;
}
const sizeFromKbps = (kbps) => (kbps && dlFormats && dlFormats.duration
  ? Formats.formatBytes({ bytes: (kbps * 1000 * dlFormats.duration) / 8, estimated: true }) : 're-encoded');

function updateSelection() {
  const v = selectedVideo();
  const a = v && v.hasAudio ? null : selectedAudio();
  $('dl-vsize').textContent = v && videoKind() === 'convert' ? sizeFromKbps(kbpsValue('dl-vbr')) : rowSize(v, $('dl-vfmt').value, videoTransform);
  const bestOut = a && Formats.parseChoice($('dl-afmt').value).kind === 'best' ? Formats.bestOutcome(a) : null;
  $('dl-asize').textContent = bestOut && !bestOut.keep
    ? Formats.formatBytes(Formats.losslessSize(a.asr || 48000, bestOut.bits || 24, dlFormats.duration, 'flac')) || 'FLAC'
    : a && losslessAudio()
    ? Formats.formatBytes(Formats.losslessSize(Number($('dl-asr').value) || a.asr, Number($('dl-abits').value) || 16, dlFormats.duration, Formats.parseChoice($('dl-afmt').value).ext)) || 're-encoded'
    : a && audioConverting() ? sizeFromKbps(kbpsValue('dl-abr')) : rowSize(a, $('dl-afmt').value);
  // Explain out-of-range picks: the video will be re-encoded from the closest real stream.
  const note = $('dl-oor-note');
  const remuxing = Formats.parseChoice($('dl-vfmt').value).kind === 'remux';
  if (v && videoTransform && remuxing) {
    const parts = [];
    if (videoTransform.height !== v.height) parts.push(`${videoTransform.height}p`);
    if (videoTransform.fps !== v.fps) parts.push(`${videoTransform.fps} fps`);
    note.textContent = `⚠ ${parts.join(' and ')} ${parts.length > 1 ? 'are' : 'is'} out of range: the site doesn't offer ${parts.length > 1 ? 'them' : 'it'}, ` +
      `so the ${v.height}p ${v.fps} fps stream will be downloaded and re-encoded.`;
  }
  note.classList.toggle('hidden', !(v && videoTransform && remuxing));
  // Converting always re-encodes: pass a target (possibly empty) so the line shows the output, not the source.
  const tech = Formats.techLine(v, a, videoKind() === 'convert' ? currentTarget() || {} : videoTransform);
  if (dlMode === 'music' && !v && a) {
    // Music: format · sample rate · bitrate (or bit depth).
    const c = Formats.parseChoice($('dl-afmt').value);
    const lossless = audioConverting() && Formats.LOSSLESS.includes(c.ext);
    const bo = c.kind === 'best' ? Formats.bestOutcome(a) : null;
    tech.resolution = c.kind === 'original' ? a.codec : bo && bo.keep ? bo.ext.toUpperCase() : c.ext.toUpperCase();
    const rate = audioConverting() && /^\d+$/.test($('dl-asr').value) ? Number($('dl-asr').value) : a.asr;
    tech.fps = rate ? khz(rate) : null;
    tech.bitrate = bo && !bo.keep ? `Lossless${bo.bits ? ` · ${bo.bits}-bit` : ''}` : lossless ? `Lossless · ${Number($('dl-abits').value) || 16}-bit`
      : audioConverting() ? (kbpsValue('dl-abr') ? `${kbpsValue('dl-abr')} kbps` : null) : Formats.formatKbps(a.kbps);
  } else if (!v && a && audioConverting()) {
    const lossless = Formats.LOSSLESS.includes(Formats.parseChoice($('dl-afmt').value).ext);
    tech.bitrate = bo && !bo.keep ? `Lossless${bo.bits ? ` · ${bo.bits}-bit` : ''}` : lossless ? `Lossless · ${Number($('dl-abits').value) || 16}-bit` : Formats.formatKbps(kbpsValue('dl-abr'));
  }
  dotLine($('dl-tech'), [tech.resolution, tech.fps, tech.bitrate]);
  // Converting the audio: show what it starts from (and warn when the output can't be better).
  const convExt = audioConverting() ? (isNone('dl-vfmt') ? Formats.parseChoice($('dl-afmt').value).ext : null) : null;
  if (bestOut) {
    showSource($('dl-src'), a, null); // the line above already shows the result
  } else showSource($('dl-src'), a && audioConverting() ? a : null, convExt ? { ext: convExt, kbps: kbpsValue('dl-abr'), rate: kbpsValue('dl-asr') } : { kbps: kbpsValue('dl-abr'), rate: kbpsValue('dl-asr') });
  $('dl-go').disabled = !v && !a;
}

// ---------- Source quality ----------
// What a conversion starts from, and a warning when the output promises more than the source has
// (a higher bitrate or sample rate, or lossless from a lossy stream): a bigger file, not better sound.
const LOSSY_CODEC = /Opus|AAC|MP3|Vorbis/i;
function sourceText(a) {
  if (!a) return '';
  if (a.original) return `Source: original file${a.asr ? ` · ${khz(a.asr)}` : ''}`;
  return `Source: ${[a.codec, a.asr ? khz(a.asr) : null, Formats.formatKbps(a.kbps)].filter(Boolean).join(' · ')}`;
}
// What "Highest quality possible" makes from that source.
function bestText(a) {
  const o = Formats.bestOutcome(a);
  if (!o) return '';
  if (o.keep) return `kept as ${o.ext.toUpperCase()}`;
  return `FLAC${o.bits ? ` · ${o.bits}-bit` : ''}${a.asr ? ` · ${khz(a.asr)}` : ''}`;
}
function sourceWarning(a, { ext, kbps, rate }) {
  if (!a || a.original) return null;
  const src = [Formats.formatKbps(a.kbps), a.codec].filter(Boolean).join(' ');
  if (Formats.LOSSLESS.includes(ext) && LOSSY_CODEC.test(a.codec || '')) {
    return `${ext.toUpperCase()} keeps the ${src} source exactly but can't add quality: a bigger file, not better sound.`;
  }
  const parts = [];
  if (kbps && a.kbps && kbps > a.kbps * 1.1) parts.push(`${kbps} kbps`);
  if (rate && a.asr && rate > a.asr) parts.push(khz(rate));
  if (!parts.length) return null;
  return `${parts.join(' at ')} from a ${[src, a.asr ? khz(a.asr) : null].filter(Boolean).join(' · ')} source: a bigger file, not better sound.`;
}
function showSource(line, a, out) {
  const warn = out ? sourceWarning(a, out) : null;
  line.textContent = a ? (warn ? `⚠ ${warn}` : sourceText(a)) : '';
  line.title = warn ? sourceText(a) : '';
  line.classList.toggle('warn', !!warn);
  line.classList.toggle('hidden', !a);
}

// YouTube (Music): its Opus (WebM) stream is the best audio it has (48 kHz).
const isYouTubeUrl = (u) => /(^|\.)(youtube\.com|youtu\.be)\//i.test(String(u || '').replace(/^https?:\/\//, ''));

function renderOptions(info) {
  const p = info.formats;
  dlFormats = p && (p.video.length || p.audio.length) ? p : null;
  audioTouched = false;
  $('dl-options').classList.toggle('hidden', !dlFormats);
  $('dl-go').disabled = false;
  if (!dlFormats) return; // site gave no format list: download the best available

  if (dlMode === 'music' && !p.audio.length) {
    // No separate audio stream on this site: the audio is extracted from the video as MP3.
    dlFormats = null;
    $('dl-options').classList.add('hidden');
    dlState('note', 'This site has no separate audio stream, so the audio will be extracted from the video as MP3.');
    return;
  }
  const groups = p.video.length ? Formats.videoGroups(p) : [];
  if (p.audio.length) groups.push({ value: NONE, label: p.video.length ? 'None (audio only)' : 'No video' });
  // Music Downloader: audio only (the video row is hidden).
  fillSelect($('dl-vfmt'), groups, dlMode === 'music' ? NONE : Formats.defaultVideoKey(p) || NONE);
  cascadeVideo();
  cascadeAudio();
  updateSelection();
}

const onVideoChange = () => { cascadeVideo(); cascadeAudio(); updateSelection(); };
$('dl-vfmt').addEventListener('change', () => {
  // Picking a video while audio is an audio-only format (remux/convert): go back to a matching original track.
  const kind = Formats.parseChoice($('dl-afmt').value).kind;
  if (!isNone('dl-vfmt') && (kind === 'remux' || kind === 'convert')) audioTouched = false;
  onVideoChange();
});
$('dl-vres').addEventListener('change', onVideoChange);
$('dl-vfps').addEventListener('change', onVideoChange);
$('dl-vbr').addEventListener('change', () => { cascadeAudio(); updateSelection(); });
$('dl-afmt').addEventListener('change', () => {
  audioTouched = true;
  // Remux/Convert audio formats are audio-only downloads: switch Video to None.
  const kind = Formats.parseChoice($('dl-afmt').value).kind;
  if ((kind === 'remux' || kind === 'convert') && !isNone('dl-vfmt')) {
    $('dl-vfmt').value = NONE;
    cascadeVideo();
  }
  cascadeAudio();
  updateSelection();
});
for (const id of ['dl-asr', 'dl-abr']) $(id).addEventListener('change', () => { cascadeAudio(); updateSelection(); });
$('dl-abits').addEventListener('change', updateSelection);

// ---------- Music Downloader (audio-only mode of the Downloader panel) ----------
// Both sidebar tabs show the same panel. Each mode keeps its own link, card and selections.
let dlMode = 'video';
const dlSaved = { video: null, music: null };
const SEL_IDS = ['dl-vfmt', 'dl-vres', 'dl-vfps', 'dl-vbr', 'dl-afmt', 'dl-asr', 'dl-abr', 'dl-abits'];
const MODE_TEXT = {
  video: ['Video Downloader', 'Paste a link to a video you have the right to download.'],
  music: ['Music Downloader', 'Search YouTube Music or SoundCloud for songs, albums or playlists, or paste a link to music you have the right to download. Only the audio is saved, tagged with cover art and lyrics.'],
};

function setDlMode(mode) {
  if (mode === dlMode) return;
  dlSaved[dlMode] = {
    url: $('dl-url').value,
    info: dlInfo,
    sel: Object.fromEntries(SEL_IDS.map((id) => [id, $(id).value])),
    audioTouched,
    music: dlMode === 'music' ? saveMusicState() : null,
  };
  // Drop a search that's still running for the mode we're leaving.
  dlSearchSeq++;
  window.api.cancelVideoInfo();
  $('dl-search').disabled = false;
  dlState(null);

  dlMode = mode;
  $('download').classList.toggle('music', mode === 'music');
  [$('dl-heading').textContent, $('dl-hint').textContent] = MODE_TEXT[mode];

  const saved = dlSaved[mode];
  $('dl-url').value = saved ? saved.url : mode === 'music' ? '' : URL_PREFIX;
  $('dl-url').placeholder = mode === 'music' ? 'Search songs, albums, playlists… or paste a link' : 'https://';
  showMusicView(null);
  if (mode === 'music' && saved && saved.music && saved.music.view && saved.music.view !== 'card') {
    dlInfo = null;
    $('dl-card').classList.add('hidden');
    $('dl-options').classList.add('hidden');
    restoreMusicState(saved.music);
  } else if (saved && saved.info) {
    renderCard(saved.info);
    // Restore the dropdowns in order, so each list is rebuilt before the next is set.
    for (const id of SEL_IDS) {
      const sel = $(id);
      if (!sel.disabled && [...sel.options].some((o) => o.value === saved.sel[id]) && sel.value !== saved.sel[id]) {
        sel.value = saved.sel[id];
        sel.dispatchEvent(new Event('change'));
      }
    }
    audioTouched = saved.audioTouched;
    if (mode === 'music' && saved.music) { muResults = saved.music.results; muFromResults = !!saved.music.split; showMusicView('card'); }
  } else {
    dlInfo = null;
    $('dl-card').classList.add('hidden');
    $('dl-options').classList.add('hidden');
  }
  updateDlBar();
}
document.querySelectorAll('.tab[data-mode]').forEach((tab) => tab.addEventListener('click', () => setDlMode(tab.dataset.mode)));

// ---------- Music player hooks (player.js) ----------
const PLAY_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor"/></svg>';
// A song as the player wants it.
const playItem = (r) => ({ url: r.url, title: r.title, artist: r.artist, artistLinks: r.artistLinks || [], album: r.album || null,
  albumUrl: r.albumUrl || null, thumbnail: r.thumbnail || null, duration: r.duration || null });
// ▶ button (optionally showing a track number until hovered).
function playButton(onPlay, label, num = null, warmUrl = null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = num != null ? 'play-btn play-num' : 'play-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = (num != null ? `<span class="num">${String(num).padStart(2, '0')}</span>` : '') + PLAY_SVG;
  b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onPlay(); });
  b.addEventListener('keydown', (e) => e.stopPropagation());
  // Look the song up while the pointer rests on ▶, so it starts quicker.
  if (warmUrl) {
    let t = null;
    b.addEventListener('pointerenter', () => { t = setTimeout(() => window.Player && window.Player.warm(warmUrl), 250); });
    b.addEventListener('pointerleave', () => clearTimeout(t));
  }
  return b;
}
function markPlaying() {
  const np = window.Player && window.Player.nowPlaying;
  document.querySelectorAll('[data-play-url]').forEach((x) => x.classList.toggle('is-playing', !!np && x.dataset.playUrl === np.url));
}

// ---------- Music Downloader: search results and albums ----------
let muType = 'songs';   // what to search for: songs | albums | playlists
const PROVIDERS = { ytmusic: 'YouTube Music', soundcloud: 'SoundCloud' };
let muProvider = 'ytmusic'; // where to search: ytmusic | soundcloud (remembered between runs)
try { if (PROVIDERS[localStorage.getItem('muProvider')]) muProvider = localStorage.getItem('muProvider'); } catch {}
let muResults = null;   // last search results
let muAlbum = null;     // album / playlist on screen

// 213 → "3:33", 3725 → "1:02:05"
function clock(sec) {
  if (!sec) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const cleanMsg = (e) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Which music view is on screen: 'results' | 'album' | 'card' | null.
// An album opened from the results sits beside them ('album' with muFromResults).
let muFromResults = false;
let muView = null;      // which music view is on screen
let muArtist = null;    // the artist page last opened (for "Back to <artist>")
let muReturn = null;    // where "Back" goes from a song / album: 'results' | 'artist'
function showMusicView(view) {
  muView = view;
  $('mu-artist-page').classList.toggle('hidden', view !== 'artist');
  const split = (view === 'album' || view === 'card') && muFromResults && !!(muResults && muResults.length);
  $('mu-split').classList.toggle('split', split);
  $('mu-results').classList.toggle('hidden', !(view === 'results' || split));
  $('mu-album').classList.toggle('hidden', view !== 'album');
  $('mu-aopts').classList.toggle('hidden', view !== 'album');
  const fromArtist = (view === 'album' || view === 'card') && muReturn === 'artist' && !!muArtist;
  const toResults = !!(muResults && muResults.length) && (view === 'artist' || ((view === 'album' || view === 'card') && !split && !fromArtist));
  $('mu-back').textContent = fromArtist ? `← Back to ${muArtist.name}` : '← Back to results';
  $('mu-back').classList.toggle('hidden', !(fromArtist || toResults));
  if (view !== 'card') {
    $('dl-card').classList.add('hidden');
    $('dl-options').classList.add('hidden');
  }
  updateDlBar();
}

document.querySelectorAll('#mu-types .chip').forEach((chip) => chip.addEventListener('click', () => {
  muType = chip.dataset.type;
  document.querySelectorAll('#mu-types .chip').forEach((c) => {
    c.classList.toggle('active', c === chip);
    c.setAttribute('aria-checked', String(c === chip));
  });
  // Re-run the search for the new type when the box holds words.
  const q = $('dl-url').value.trim();
  if (q && !/^https?:\/\//i.test(q)) musicSearch(q);
}));

function setProvider(p) {
  if (!PROVIDERS[p]) return;
  muProvider = p;
  try { localStorage.setItem('muProvider', p); } catch {}
  document.querySelectorAll('#mu-provider .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.provider === p);
    b.setAttribute('aria-checked', String(b.dataset.provider === p));
  });
}
setProvider(muProvider);
document.querySelectorAll('#mu-provider .seg').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.provider === muProvider) return;
  setProvider(b.dataset.provider);
  // Search again on the new provider when the box holds words.
  const q = $('dl-url').value.trim();
  if (q && !/^https?:\/\//i.test(q)) musicSearch(q);
}));

async function musicSearch(query) {
  const seq = ++dlSearchSeq;
  muAlbum = null;
  showMusicView(null);
  dlState('loading', `Searching ${PROVIDERS[muProvider]} for ${muType}…`);
  $('dl-search').disabled = true;
  try {
    const results = await window.api.musicSearch(query, muType, muProvider);
    if (seq !== dlSearchSeq) return;
    muResults = results;
    dlState(results.length ? null : 'note', results.length ? null : 'No results. Try other words or another type.');
    renderResults(results);
  } catch (e) {
    if (seq !== dlSearchSeq) return;
    const msg = cleanMsg(e);
    dlState(msg === 'cancelled' ? null : 'error', msg === 'cancelled' ? null : msg);
  } finally {
    if (seq === dlSearchSeq) $('dl-search').disabled = false;
  }
}
async function drmFallback(seq, url, hint) {
  // Title and artist from the search row, else from the link (soundcloud.com/<artist>/<track-name>).
  const slug = /soundcloud\.com\/([^/?#]+)\/([^/?#]+)/i.exec(url);
  const words = (x) => decodeURIComponent(x || '').replace(/[-_]+/g, ' ').trim();
  const want = { kind: 'track', title: (hint && hint.title) || (slug && words(slug[2])), artist: (hint && hint.artist) || (slug && words(slug[1])), duration: hint && hint.duration };
  dlState('loading', "SoundCloud's copy is DRM-protected. Looking for it on YouTube Music…");
  const row = await window.api.musicFindYtm(want).catch(() => null);
  if (seq !== dlSearchSeq) return;
  if (!row) return dlState('error', "SoundCloud's copy is DRM-protected (SoundCloud Go+ only), and it isn't on YouTube Music.");
  await musicOpen(row.url, row, muFromResults);
  // Say why this is a YouTube Music song (unless something else was opened meanwhile).
  if (dlInfo && dlInfo.webpageUrl && !/soundcloud\.com/i.test(dlInfo.webpageUrl) && $('dl-state').classList.contains('hidden')) {
    dlState('note', "SoundCloud's copy is DRM-protected, so this is the same song from YouTube Music.");
  }
}

function renderResults(results) {
  const box = $('mu-results');
  box.innerHTML = '';
  for (const r of results || []) {
    // A clickable panel (not a <button>), so the artist names inside can be their own links.
    const row = document.createElement('div');
    row.className = 'result';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    if (r.thumbnail) row.append(Object.assign(document.createElement('img'), { src: r.thumbnail, alt: '' }));
    else row.append(Object.assign(document.createElement('span'), { className: 'ph' }));
    const text = document.createElement('span');
    text.className = 'r-text';
    text.append(Object.assign(document.createElement('div'), { className: 'r-title', textContent: r.title, title: r.title }));
    // Artist · Album   |   Album · Artist · 1987   |   Playlist · Owner · 120 songs. Artists link to their page.
    const sub = document.createElement('div');
    sub.className = 'r-sub';
    const kind = r.kind || (r.type === 'albums' ? 'Album' : r.type === 'playlists' ? 'Playlist' : 'Song');
    const parts = [r.type === 'songs' ? null : kind, r.artist ? artistNodes(r) : null,
      r.type === 'songs' && r.album ? albumNode(r.album, r.albumUrl, r) : null, r.year, r.tracks ? `${r.tracks} songs` : null].filter(Boolean);
    parts.forEach((part, i) => {
      if (i) sub.append(document.createTextNode(' · '));
      sub.append(part);
    });
    text.append(sub);
    row.append(text);
    if (r.duration) row.append(Object.assign(document.createElement('span'), { className: 'r-dur', textContent: clock(r.duration) }));
    // The box keeps the search words, so "Back to results" and the type chips still work.
    row.dataset.url = r.url;
    if (r.type === 'songs' && r.url) {
      row.dataset.playUrl = r.url;
      const songs = (results || []).filter((x) => x.type === 'songs' && x.url);
      row.prepend(playButton(() => window.Player.play(playItem(r), songs.map(playItem)), `Play ${r.title}`, null, r.url));
    }
    if (r.type === 'artists') {
      row.classList.add('artist-row');
      sub.textContent = ['Artist', r.subs].filter(Boolean).join(' · ');
    }
    const open = () => (r.type === 'artists' ? openArtist(r.url, r) : (muReturn = 'results', musicOpen(r.url, r, true)));
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); open(); } });
    box.append(row);
  }
  muFromResults = false;
  showMusicView(results && results.length ? 'results' : null);
  markPlaying();
}

// Artist names, each linking to their page (YouTube Music or SoundCloud) when the search gave one.
function artistNodes(r) {
  const frag = document.createDocumentFragment();
  const links = r.artistLinks || [];
  if (!links.length) { frag.append(r.artist); return frag; }
  links.forEach((a, i) => {
    if (i) frag.append(', ');
    const link = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn artist-link', textContent: a.name });
    link.title = `Open ${a.name}'s artist page`;
    link.addEventListener('click', (e) => {
      e.stopPropagation(); // don't open the song / album too
      if (dlMode === 'music') openArtist(a.url, { title: a.name });
      else window.api.openExternal(a.url);
    });
    link.addEventListener('keydown', (e) => e.stopPropagation());
    frag.append(link);
  });
  return frag;
}

// "Album: <name>" on the song card, linking to the album when the search gave its page.
function albumLine(info) {
  const frag = document.createDocumentFragment();
  frag.append('Album: ', albumNode(info.album, info.albumUrl, { artist: info.artist, artistLinks: info.artistLinks }));
  return frag;
}

// Album name that opens the album in Nabbit's album view (plain text when there's no link).
function albumNode(name, url, hint) {
  if (!url) return name;
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'link-btn album-link';
  link.textContent = name;
  link.title = `Open the album "${name}"`;
  link.addEventListener('click', (e) => {
    e.stopPropagation(); // don't open the song too
    musicOpen(url, { kind: 'Album', title: name, artist: hint && hint.artist, artistLinks: hint && hint.artistLinks, thumbnail: hint && hint.thumbnail });
  });
  link.addEventListener('keydown', (e) => e.stopPropagation());
  return link;
}

// Opens a song (card + audio options) or an album / playlist (track list).
function markOpenResult(url) {
  document.querySelectorAll('#mu-results .result').forEach((row) => row.classList.toggle('active', !!url && row.dataset.url === url));
}
async function musicOpen(url, hint = null, fromResults = false) {
  const seq = ++dlSearchSeq;
  hideBetter();
  muFromResults = fromResults && !!(muResults && muResults.length);
  markOpenResult(muFromResults ? url : null);
  // From the results: they stay on screen while the album loads beside them.
  if (muFromResults) {
    $('mu-album').classList.add('hidden');
    $('dl-card').classList.add('hidden');
    $('dl-options').classList.add('hidden');
    $('mu-aopts').classList.add('hidden');
    updateDlBar();
  } else {
    showMusicView(null);
  }
  dlInfo = null;
  dlState('loading', 'Looking up…');
  $('dl-search').disabled = true;
  try {
    const res = await window.api.musicInfo(url);
    if (seq !== dlSearchSeq) return;
    dlState(null);
    if (res.kind === 'album') {
      // Fill gaps in the album details with what the search row showed.
      const a = res.album;
      if (hint) {
        if (!a.title || /^(Album|Playlist|Untitled)$/i.test(a.title)) a.title = hint.title;
        a.artist = a.artist || hint.artist;
        // The search row's artwork is the provider's square album cover: prefer it.
        a.thumbnail = hint.thumbnail || a.thumbnail;
        a.year = a.year || hint.year;
        if (hint.kind) a.kind = hint.kind;
        if (hint.artistLinks && hint.artistLinks.length) a.artistLinks = hint.artistLinks;
      }
      renderAlbum(a);
      const first = (a.entries || []).find((t) => t.url);
      checkBetter(seq, { url, kind: 'album', title: a.title, artist: a.artist, count: a.count, firstUrl: first && first.url });
    }
    else {
      muAlbum = null;
      if (hint && hint.artistLinks && hint.artistLinks.length) res.info.artistLinks = hint.artistLinks;
      if (hint && hint.albumUrl) res.info.albumUrl = hint.albumUrl;
      // Prefer the search row's square cover art over a 16:9 video frame.
      if (hint && hint.thumbnail) res.info.thumbnail = hint.thumbnail;
      renderCard(res.info);
      checkBetter(seq, { url, kind: 'track', title: res.info.track || res.info.title, artist: res.info.artist || res.info.uploader });
    }
  } catch (e) {
    if (seq !== dlSearchSeq) return;
    const msg = cleanMsg(e);
    // A DRM-protected SoundCloud track (SoundCloud Go+ only): open the same song from YouTube Music.
    if (/\bDRM\b/i.test(msg) && /soundcloud\.com/i.test(url)) return drmFallback(seq, url, hint);
    dlState(msg === 'cancelled' ? null : 'error', msg === 'cancelled' ? null : msg);
  } finally {
    if (seq === dlSearchSeq) $('dl-search').disabled = false;
  }
}

// ---------- "Higher quality on YouTube Music" ----------
// After a SoundCloud song or album opens, main.js looks for the same release on YouTube Music in the
// background; when its audio is better, a notice under the details offers to open that one instead.
function hideBetter() {
  const n = document.getElementById('mu-better');
  if (n) n.remove();
}
async function checkBetter(seq, req) {
  hideBetter();
  if (!/soundcloud\.com/i.test(req.url || '') || (settings && settings.ytmCompare === false)) return;
  // At the top of the album / song card, so it's seen straight away.
  const into = req.kind === 'album' ? $('mu-album') : $('dl-card');
  if (!into) return;
  // While it looks: a small "searching" line in the same place.
  const wait = document.createElement('div');
  wait.id = 'mu-better';
  wait.className = 'mu-better mb-wait';
  wait.setAttribute('role', 'status');
  wait.innerHTML = '<span class="mb-spin" aria-hidden="true"></span><span class="mb-tag"></span>';
  wait.querySelector('.mb-tag').textContent = 'Checking YouTube Music for higher quality…';
  into.prepend(wait);
  const res = await window.api.musicBetter(req).catch(() => null);
  if (seq !== dlSearchSeq || !wait.isConnected) return; // another song opened, or dismissed
  if (!res) {
    // Nothing better: say so briefly, then fade out.
    wait.classList.add('mb-none');
    wait.querySelector('.mb-spin').textContent = '✓';
    wait.querySelector('.mb-tag').textContent = 'No higher-quality copy on YouTube Music';
    setTimeout(() => { wait.classList.add('mb-out'); setTimeout(() => wait.remove(), 400); }, 2500);
    return;
  }
  hideBetter();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const box = el('div', 'mu-better');
  box.id = 'mu-better';
  box.setAttribute('role', 'status');
  const head = el('div', 'mb-head');
  head.append(el('span', 'mb-up', '▲'), el('span', 'mb-tag', 'Higher quality on YouTube Music'));
  const x = el('button', 'mb-x', '✕');
  x.type = 'button';
  x.title = 'Dismiss';
  x.setAttribute('aria-label', 'Dismiss');
  x.onclick = hideBetter;
  head.append(x);
  const what = el('div', 'mb-what');
  what.append(el('b', null, res.title));
  if (res.artist) what.append(` — ${res.artist}`);
  if (res.duration) what.append(` · ${clock(res.duration)}`);
  const q = el('div', 'mb-q');
  // SoundCloud doesn't report its streams' sample rate; they're 44.1 kHz.
  const sc = res.sc ? { ...res.sc, asr: res.sc.asr || 44100 } : null;
  const scText = el('span', 'mb-sc', `⚠ ${sc ? qualityText(sc) : 'unknown'}`);
  if (res.sc && !res.sc.asr) scText.title = "SoundCloud doesn't report the sample rate; its streams are 44.1 kHz.";
  q.append(el('span', 'mb-yt', qualityText(res.yt)), el('span', 'mb-vs', 'vs SoundCloud'), scText);
  const open = el('button', 'ghost mb-open', req.kind === 'album' ? 'Open album' : 'Open song');
  open.type = 'button';
  open.onclick = () => {
    hideBetter();
    musicOpen(res.url, { title: res.title, artist: res.artist, thumbnail: res.thumbnail, artistLinks: res.artistLinks, albumUrl: res.albumUrl, year: res.year, kind: res.kind }, muFromResults);
  };
  box.append(head, what, q, open);
  into.prepend(box);
}
// "48 kHz · 160 kbps Opus"
function qualityText(qy) {
  if (!qy) return '';
  const khz = qy.asr ? `${(qy.asr / 1000).toFixed(qy.asr % 1000 ? 1 : 0)} kHz` : null;
  return [khz, qy.abr ? `${qy.abr} kbps` : null, qy.codec].filter(Boolean).join(' · ');
}

$('mu-back').onclick = () => {
  muAlbum = null; dlInfo = null; muFromResults = false;
  if (muView !== 'artist' && muReturn === 'artist' && muArtist) return renderArtist(muArtist);
  muReturn = null;
  renderResults(muResults);
};

// ---------- Artist pages ----------
async function openArtist(url, hint = null) {
  const seq = ++dlSearchSeq;
  showMusicView(null);
  dlInfo = null;
  dlState('loading', `Opening ${hint && hint.title ? hint.title : 'the artist'}…`);
  $('dl-search').disabled = true;
  try {
    const page = await window.api.musicArtist(url);
    if (seq !== dlSearchSeq) return;
    dlState(null);
    if (!page.thumbnail && hint && hint.thumbnail) page.thumbnail = hint.thumbnail;
    if (!page.url) page.url = url;
    renderArtist(page);
  } catch (e) {
    if (seq !== dlSearchSeq) return;
    dlState('error', cleanMsg(e));
    showMusicView(muResults && muResults.length ? 'results' : null);
  } finally {
    if (seq === dlSearchSeq) $('dl-search').disabled = false;
  }
}

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };

function renderArtist(a) {
  muArtist = a;
  muAlbum = null;
  const page = $('mu-artist-page');
  page.innerHTML = '';
  const where = a.provider === 'soundcloud' ? 'SoundCloud' : 'YouTube Music';
  // Header: picture in brackets, name, followers, bio, link out
  const desc = a.description ? el('p', { className: 'ap-desc', textContent: a.description, title: 'Click to show more or less' }) : null;
  if (desc) desc.onclick = () => desc.classList.toggle('open');
  const out = el('button', { type: 'button', className: 'ghost ap-out', textContent: `Open on ${where} ↗` });
  out.onclick = () => window.api.openExternal(a.url);
  page.append(el('header', { className: 'ap-head' },
    a.thumbnail ? el('div', { className: 'ap-pic' }, el('img', { src: a.thumbnail, alt: '' })) : null,
    el('div', { className: 'ap-meta' },
      el('div', { className: 'album-kind', textContent: `Artist · ${where}` }),
      el('h2', { className: 'ap-name', textContent: a.name || 'Artist' }),
      a.subs ? el('div', { className: 'meta-line', textContent: a.subs }) : null,
      desc,
      out)));
  // Sections: songs as rows, the rest as tiles (first 10, then "+ N more")
  for (const sec of a.sections || []) {
    const box = el('section', { className: 'ap-sec' });
    box.append(el('h3', { className: 'ap-title' }, el('span', { textContent: sec.title }), el('span', { className: 'ap-count', textContent: String(sec.items.length).padStart(2, '0') })));
    if (sec.kind === 'songs') {
      const list = el('ol', { className: 'ap-songs' });
      sec.items.forEach((t, i) => {
        const row = el('li', { className: 'ap-song', tabIndex: 0, title: `Open ${t.title}` },
          playButton(() => window.Player.play(playItem({ ...t, artist: t.artist || a.name, artistLinks: t.artistLinks && t.artistLinks.length ? t.artistLinks : [{ name: a.name, url: a.url }] }),
            sec.items.map((x) => playItem({ ...x, artist: x.artist || a.name, artistLinks: x.artistLinks && x.artistLinks.length ? x.artistLinks : [{ name: a.name, url: a.url }] }))), `Play ${t.title}`, i + 1, t.url),
          t.thumbnail ? el('img', { src: t.thumbnail, alt: '' }) : el('span', { className: 'ph' }),
          el('span', { className: 'ap-st' }, el('span', { className: 'ap-t', textContent: t.title }),
            el('span', { className: 'ap-s', textContent: [t.album, t.year].filter(Boolean).join(' · ') })),
          el('span', { className: 'd', textContent: clock(t.duration) }));
        row.dataset.playUrl = t.url;
        row.onclick = () => openFromArtist(t);
        row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromArtist(t); } };
        list.append(row);
      });
      box.append(list);
    } else {
      const grid = el('div', { className: 'ap-grid' });
      sec.items.forEach((t, i) => {
        const tile = el('button', { type: 'button', className: 'ap-tile' + (t.type === 'artists' ? ' is-artist' : '') + (i >= 10 ? ' extra' : '') },
          el('span', { className: 'ap-art' }, t.thumbnail ? el('img', { src: t.thumbnail, alt: '', loading: 'lazy' }) : null),
          el('span', { className: 'ap-t', textContent: t.title }),
          el('span', { className: 'ap-s', textContent: t.type === 'artists' ? (t.subs || 'Artist') : [t.kind, t.year].filter(Boolean).join(' · ') }));
        tile.title = t.type === 'artists' ? `Open ${t.title}'s artist page` : `Open ${t.title}`;
        tile.onclick = () => (t.type === 'artists' ? openArtist(t.url, t) : openFromArtist(t));
        grid.append(tile);
      });
      box.append(grid);
      if (sec.items.length > 10) {
        const more = el('button', { type: 'button', className: 'link-btn ap-more', textContent: `+ ${sec.items.length - 10} more` });
        more.onclick = () => { grid.classList.add('all'); more.remove(); };
        box.append(more);
      }
    }
    page.append(box);
  }
  if (!(a.sections || []).length) page.append(el('p', { className: 'hint', textContent: 'Nothing to list on this artist\'s page.' }));
  markPlaying();
  showMusicView('artist');
  document.querySelector('.content').scrollTop = 0;
}

// Songs and albums from an artist page open in their usual views, with "Back to <artist>".
function openFromArtist(item) {
  muReturn = 'artist';
  musicOpen(item.url, { ...item, artistLinks: item.artistLinks && item.artistLinks.length ? item.artistLinks : (muArtist ? [{ name: muArtist.name, url: muArtist.url }] : []), artist: item.artist || (muArtist && muArtist.name) }, false);
}
$('mu-lrclib').onclick = () => window.api.openExternal('https://lrclib.net');

// ----- Album view -----
const ALBUM_FORMATS = [
  { group: 'Best', items: [{ value: 'best:flac', label: 'Highest quality possible (FLAC)' }] },
  { group: 'Remux (lossless)', items: [{ value: 'remux:aac', label: 'AAC (remux)' }, { value: 'remux:ogg', label: 'OGG (remux)' }] },
  { group: 'Convert (re-encode)', items: ['aac', 'mp3', 'ogg', 'flac', 'wav'].map((x) => ({ value: `convert:${x}`, label: `${x.toUpperCase()} (convert)` })) },
  { group: 'Original', items: [{ value: 'orig:best', label: 'Best · Original file if offered' }, { value: 'orig:m4a', label: 'Best · M4A (AAC)' }, { value: 'orig:opus', label: 'Best · WEBM (Opus)' }] },
];

function renderAlbum(album, keep = null) {
  muAlbum = album;
  $('mu-cover').src = album.thumbnail || '';
  $('mu-cover').classList.toggle('hidden', !album.thumbnail);
  $('mu-kind').textContent = album.kind || (/playlist/i.test(album.webpageUrl || '') && !/OLAK5uy_/.test(album.webpageUrl || '') ? 'Playlist' : 'Album');
  $('mu-title').textContent = album.title;
  $('mu-artist').innerHTML = '';
  if (album.artist) $('mu-artist').append(artistNodes(album));
  dotLine($('mu-stats'), [`${album.count} tracks`, album.duration ? clock(album.duration) : null, album.year]);
  const list = $('mu-tracks');
  list.innerHTML = '';
  for (const t of album.entries) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: keep ? keep.includes(t.index) : true });
    cb.dataset.index = t.index;
    cb.onchange = updateAlbumSelection;
    const title = Object.assign(document.createElement('span'), { className: 't', textContent: t.title, title: t.title });
    if (t.artist && album.artist && t.artist !== album.artist) title.append(Object.assign(document.createElement('small'), { textContent: t.artist }));
    label.append(cb, Object.assign(document.createElement('span'), { className: 'n', textContent: String(t.index).padStart(2, '0') }),
      title, Object.assign(document.createElement('span'), { className: 'd', textContent: clock(t.duration) }));
    if (t.url) {
      li.dataset.playUrl = t.url;
      li.append(playButton(() => playAlbum(t.index), `Play ${t.title}`, null, t.url));
    }
    li.append(label);
    list.append(li);
  }
  markPlaying();
  // "Highest quality possible" only for YouTube Music albums. Starting format until you pick one
  // yourself: that for YouTube Music, the artist's original file (if offered) for SoundCloud.
  const yt = isYouTubeUrl(album.webpageUrl);
  const prev = $('mu-afmt').value;
  fillSelect($('mu-afmt'), yt ? ALBUM_FORMATS : ALBUM_FORMATS.filter((g) => g.group !== 'Best'), prev || undefined);
  if (!keep && (!muAfmtTouched || ($('mu-afmt').value !== prev))) $('mu-afmt').value = yt ? 'best:flac' : 'orig:best';
  $('mu-afmt').disabled = false;
  albumQuality();
  updateAlbumSelection();
  showMusicView('album');
  if (!keep || !muSource) loadAlbumSource(album);
}

// The album as a queue (the ticked tracks, or all of them), starting at track `from`.
function albumQueue() {
  if (!muAlbum) return [];
  const picked = selectedTracks();
  return muAlbum.entries.filter((t) => t.url && (!picked.length || picked.includes(t.index))).map((t) => playItem({
    url: t.url, title: t.title, artist: t.artist || muAlbum.artist, artistLinks: muAlbum.artistLinks || [],
    album: muAlbum.title, albumUrl: muAlbum.webpageUrl, thumbnail: muAlbum.thumbnail, duration: t.duration }));
}
function playAlbum(fromIndex = null) {
  const q = albumQueue();
  if (!q.length) return;
  const t = fromIndex != null ? muAlbum.entries.find((e) => e.index === fromIndex) : null;
  const i = t ? Math.max(0, q.findIndex((x) => x.url === t.url)) : 0;
  window.Player.play(q[i], q, i);
}
const albumChecks = () => [...$('mu-tracks').querySelectorAll('input[type=checkbox]')];
const selectedTracks = () => albumChecks().filter((c) => c.checked).map((c) => Number(c.dataset.index));

$('mu-all').onchange = () => { albumChecks().forEach((c) => { c.checked = $('mu-all').checked; }); updateAlbumSelection(); };

// Quality list for the album format: bitrates (lossy convert), bit depth (FLAC / WAV) or best available.
function albumQuality() {
  const [kind, ext] = $('mu-afmt').value.split(':');
  const sel = $('mu-aqual');
  // Sample rate: an output choice when converting, otherwise the source's.
  if (kind === 'convert') {
    const keep = Formats.ratesFor(ext).includes(Number($('mu-asr').value)) ? $('mu-asr').value : 'auto';
    fillSelect($('mu-asr'), [{ value: 'auto', label: 'Auto (source)' }, ...Formats.ratesFor(ext).map((x) => ({ value: String(x), label: khz(x) }))], keep);
  } else {
    disableSelects(['mu-asr'], 'Source rate');
  }
  if (kind === 'best') {
    disableSelects(['mu-aqual'], '16-bit FLAC');
  } else if (kind === 'convert' && Formats.LOSSLESS.includes(ext)) {
    fillSelect(sel, Formats.SAMPLE_BITS.map((b) => ({ value: `bits:${b}`, label: `${b}-bit` })), sel.value.startsWith('bits:') ? undefined : 'bits:16');
  } else if (kind === 'convert') {
    fillSelect(sel, [{ value: 'auto', label: 'Auto (preset quality)' }, ...Formats.AUDIO_KBPS.map((k) => ({ value: `kbps:${k}`, label: `${k} kbps` }))],
      sel.value.startsWith('kbps:') || sel.value === 'auto' ? undefined : 'auto');
  } else {
    disableSelects(['mu-aqual'], 'Best available');
  }
  updateAlbumSelection();
}
let muAfmtTouched = false;
$('mu-afmt').addEventListener('change', () => { muAfmtTouched = true; albumQuality(); });
$('mu-aqual').addEventListener('change', updateAlbumSelection);
$('mu-asr').addEventListener('change', updateAlbumSelection);

// The album's source audio (its first track's streams), looked up in the background.
let muSource = null;
async function loadAlbumSource(album) {
  muSource = null;
  $('mu-src').classList.add('hidden');
  const first = (album.entries || []).find((t) => t.url);
  if (!first) return;
  const audio = await window.api.musicSource(first.url).catch(() => null);
  if (muAlbum !== album || !audio || !audio.length) return;
  muSource = audio;
  albumSourceLine();
}
// The stream the album format starts from.
function albumSource(choice) {
  const list = muSource || [];
  const best = (f) => list.filter(f).sort((x, y) => (y.kbps || 0) - (x.kbps || 0))[0];
  const [kind] = String(choice).split(':');
  if (kind === 'best') return Formats.bestSource({ audio: list });
  if (choice === 'orig:m4a' || choice === 'remux:aac') return best((f) => f.codec === 'AAC') || best(() => true);
  if (choice === 'orig:opus' || choice === 'remux:ogg') return best((f) => /Opus|Vorbis/.test(f.codec)) || best(() => true);
  if (kind === 'orig' || kind === 'convert') return list.find((f) => f.original) || best(() => true);
  return best(() => true);
}
function albumSourceLine() {
  if (!muSource) return;
  const choice = $('mu-afmt').value;
  const [kind, ext] = choice.split(':');
  const q = $('mu-aqual').value;
  const out = kind === 'convert' ? { ext, kbps: q.startsWith('kbps:') ? Number(q.slice(5)) : null, rate: /^\d+$/.test($('mu-asr').value) ? Number($('mu-asr').value) : null } : null;
  const src = albumSource(choice);
  showSource($('mu-src'), src, out);
  const line = $('mu-src');
  if (!line.classList.contains('warn')) line.textContent += ` → ${kind === 'best' ? bestText(src) : ''}`.replace(/ → $/, '') + ' (first track)';
}

function updateAlbumSelection() {
  if (!muAlbum) return;
  albumSourceLine();
  const picked = selectedTracks();
  const all = albumChecks();
  $('mu-all').checked = picked.length === all.length;
  $('mu-all').indeterminate = picked.length > 0 && picked.length < all.length;
  const secs = muAlbum.entries.filter((t) => picked.includes(t.index)).reduce((s, t) => s + (t.duration || 0), 0);
  $('mu-selcount').textContent = `${picked.length} of ${all.length} selected${secs ? ` · ${clock(secs)}` : ''}`;
  // Size estimate when the output bitrate is known.
  const [kind, ext] = $('mu-afmt').value.split(':');
  const q = $('mu-aqual').value;
  let size = '';
  if (secs && kind === 'convert' && q.startsWith('kbps:')) size = Formats.formatBytes({ bytes: (Number(q.slice(5)) * 1000 * secs) / 8, estimated: true });
  if (secs && kind === 'convert' && q.startsWith('bits:')) size = Formats.formatBytes(Formats.losslessSize(Number($('mu-asr').value) || 44100, Number(q.slice(5)), secs, ext));
  $('mu-asize').textContent = size;
  $('dl-go').disabled = !picked.length;
}

async function downloadAlbum() {
  const items = selectedTracks();
  if (!items.length) return;
  // Ask where to save (starts in the folder used last time).
  const outDir = await pickMusicFolder(($('mu-kind').textContent || 'Album').toLowerCase());
  if (!outDir) return;
  const q = $('mu-aqual').value;
  const folderName = [muAlbum.artist, muAlbum.title].filter(Boolean).join(' - ');
  start('album', {
    url: muAlbum.webpageUrl || $('dl-url').value.trim(),
    items,
    total: muAlbum.count,
    format: $('mu-afmt').value,
    audioKbps: q.startsWith('kbps:') ? Number(q.slice(5)) : null,
    sampleBits: q.startsWith('bits:') ? Number(q.slice(5)) : null,
    sampleRate: /^\d+$/.test($('mu-asr').value) ? Number($('mu-asr').value) : null,
    package: $('mu-pack').value,
    folderName,
    cover: $('mu-cover-on').checked,
    lyrics: $('mu-lyrics-on').checked,
    outDir,
  }, `${$('mu-kind').textContent} · ${muAlbum.title} (${items.length} track${items.length > 1 ? 's' : ''})`);
}

// ----- Save / restore the music views when switching tabs -----
function saveMusicState() {
  const view = !$('mu-artist-page').classList.contains('hidden') ? 'artist' : !$('mu-album').classList.contains('hidden') ? 'album'
    : !$('mu-results').classList.contains('hidden') ? 'results'
      : !$('dl-card').classList.contains('hidden') ? 'card' : null;
  return {
    view, results: muResults, album: muAlbum, type: muType, provider: muProvider, split: muFromResults, artist: muArtist, ret: muReturn,
    picked: muAlbum ? selectedTracks() : null,
    afmt: $('mu-afmt').value, aqual: $('mu-aqual').value, asr: $('mu-asr').value, pack: $('mu-pack').value,
  };
}
function restoreMusicState(st) {
  muResults = st.results;
  if (st.provider) setProvider(st.provider);
  const chip = document.querySelector(`#mu-types .chip[data-type="${st.type}"]`);
  if (chip && st.type !== muType) { muType = st.type; document.querySelectorAll('#mu-types .chip').forEach((c) => c.classList.toggle('active', c === chip)); }
  muArtist = st.artist || null;
  muReturn = st.ret || null;
  if (st.view === 'artist' && st.artist) { renderArtist(st.artist); return; }
  if (st.view === 'album' && st.album) {
    muFromResults = !!st.split;
    if (st.afmt) $('mu-afmt').value = st.afmt;
    renderAlbum(st.album, st.picked);
    if (st.aqual && [...$('mu-aqual').options].some((o) => o.value === st.aqual)) $('mu-aqual').value = st.aqual;
    if (st.pack) $('mu-pack').value = st.pack;
    if (st.asr && [...$('mu-asr').options].some((o) => o.value === st.asr)) $('mu-asr').value = st.asr;
    updateAlbumSelection();
  } else if (st.view === 'results') {
    renderResults(st.results);
  }
}

// ---------- Browser extension: "Open in Nabbit" ----------
// The extension sends a link and which downloader to use; it's looked up like a pasted link.
// Nothing downloads until you pick a format and click Download.
window.api.onExtOpen(({ url, mode }) => {
  const tab = document.querySelector(`.tab[data-mode="${mode === 'music' ? 'music' : 'video'}"]`);
  if (tab && !tab.classList.contains('active')) tab.click();
  $('dl-url').value = url;
  dlSearch();
});

// ---------- Tray menu: open a tool ----------
window.api.onNav(({ tool, mode, file }) => {
  const tab = document.querySelector(mode ? `.tab[data-mode="${mode}"]` : `.tab[data-tool="${tool}"]:not([data-mode])`);
  if (tab && !tab.classList.contains('active')) tab.click();
  // From Explorer's right-click menu: load the file into that tool.
  if (!file) return;
  if (tool === 'trim') window.Trimmer.open(file);
  else if (tool === 'compress') window.CompressorUI.add([file]);
  else if (tool === 'convert') addFiles([file]);
});

// ---------- Settings page ----------
// main.js keeps the settings (settings.json); the tray menu can change some, so the page follows
// 'settings-changed' as well as its own changes.
let settings = null;
function showSettings(st) {
  settings = st;
  document.body.classList.toggle('not-windows', !st.isWindows);
  $('st-login').checked = st.startWithWindows;
  $('st-min').checked = st.startMinimized;
  $('st-min').disabled = !st.startWithWindows;
  $('st-tray').checked = st.closeToTray;
  $('st-blur').checked = !!st.windowBlur;
  $('st-blur-row').classList.toggle('hidden', !st.blurSupported);
  document.documentElement.classList.toggle('blur', !!st.blurNow);
  // A blurred ("glass") window draws its own caption buttons (main.js glassWin).
  document.documentElement.classList.toggle('glass', !!st.glassWindow);
  $('tb-ctrl').classList.toggle('hidden', !st.glassWindow);
  $('st-ytm').checked = st.ytmCompare !== false;
  $('st-shell').checked = st.shellMenu;
  $('st-dir').value = st.downloadDir;
  $('st-hw').value = st.hwAccel;
  $('st-sq').value = st.streamQuality || 'normal';
  $('st-scache').value = String(st.streamCacheMB ?? 1024);
  $('cv-hw').value = st.hwAccel;
  document.querySelectorAll('#st-theme .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === st.theme);
    b.setAttribute('aria-checked', String(b.dataset.theme === st.theme));
  });
  if (typeof showTheme === 'function') showTheme(st.theme);
  const n = st.extClients.length;
  $('st-ext').textContent = n
    ? `${n} browser${n > 1 ? 's' : ''} connected: ${st.extClients.map((c) => c.name || 'Browser').join(', ')}.`
    : 'No browsers connected. Install the Nabbit extension and click Connect in its popup.';
  $('st-ext-forget').disabled = !n;
  $('app-version').textContent = `v${st.version}`;
}
async function saveSetting(patch, box) {
  if (box) box.disabled = true;
  try { showSettings(await window.api.settingsSet(patch)); } finally {
    if (box) box.disabled = false;
    if (settings) showSettings(settings); // undo the click if saving failed
  }
}
window.api.settingsGet().then(showSettings);
window.api.onSettings(showSettings);
document.querySelector('[data-tool="settings"]').addEventListener('click', () => window.api.settingsGet().then(showSettings));
$('st-login').onchange = (e) => saveSetting({ startWithWindows: e.target.checked }, e.target);
$('st-min').onchange = (e) => saveSetting({ startMinimized: e.target.checked }, e.target);
$('st-tray').onchange = (e) => saveSetting({ closeToTray: e.target.checked }, e.target);
// Own caption buttons (glass window): minimize, fill the screen / back, close. Double-clicking the
// title bar also fills the screen / goes back.
const showFilled = (st) => document.documentElement.classList.toggle('filled', !!(st && st.filled));
$('tb-min').onclick = () => window.api.winControl('min');
$('tb-max').onclick = () => window.api.winControl('max').then(showFilled);
$('tb-close').onclick = () => window.api.winControl('close');
document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
  if (document.documentElement.classList.contains('glass') && !e.target.closest('button')) window.api.winControl('max').then(showFilled);
});
window.api.onWinState(showFilled);
// Maximized / full screen: solid (main.js turns the blur off there and back on after).
window.api.onWindowBlur((on) => document.documentElement.classList.toggle('blur', !!on));
$('st-blur').onchange = (e) => saveSetting({ windowBlur: e.target.checked }, e.target);
$('st-ytm').onchange = (e) => { saveSetting({ ytmCompare: e.target.checked }, e.target); if (!e.target.checked) hideBetter(); };
$('st-shell').onchange = (e) => saveSetting({ shellMenu: e.target.checked }, e.target);
$('st-hw').onchange = (e) => saveSetting({ hwAccel: e.target.value });
$('st-sq').onchange = (e) => saveSetting({ streamQuality: e.target.value });
$('st-scache').onchange = async (e) => { await saveSetting({ streamCacheMB: Number(e.target.value) }); cacheInfo(); };
async function cacheInfo() {
  const i = await window.api.streamCacheInfo();
  $('st-scache-info').textContent = i.files ? `Cache: ${Formats.formatBytes({ bytes: i.bytes })} · ${i.files} song${i.files === 1 ? '' : 's'}` : 'Cache: empty';
}
$('st-scache-clear').onclick = async () => { await window.api.streamCacheClear(); cacheInfo(); };
document.querySelector('[data-tool="settings"]').addEventListener('click', cacheInfo);
document.querySelectorAll('#st-theme .seg').forEach((b) => b.addEventListener('click', () => {
  if (!b.classList.contains('active') && window.nabbitGlitch) window.nabbitGlitch();
  saveSetting({ theme: b.dataset.theme });
}));
$('st-dir-pick').onclick = async () => {
  const p = await window.api.pickFolder();
  if (!p) return;
  await saveSetting({ downloadDir: p });
  $('dl-out').value = settings.downloadDir;
};
$('st-dir-reset').onclick = async () => {
  await saveSetting({ downloadDir: '' });
  $('dl-out').value = settings.downloadDir;
};
$('st-ext-forget').onclick = async () => {
  await window.api.extForget();
  showSettings(await window.api.settingsGet());
};

// Jobs started from the browser extension's download menu show up in the Jobs list too.
window.api.onJobAdded(({ id, title }) => addJob(id, title));

// ---------- Theme switcher (System / Light / Dark) ----------
function showTheme(mode) {
  document.querySelectorAll('#theme-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === mode);
    b.setAttribute('aria-checked', String(b.dataset.theme === mode));
  });
}
window.api.getTheme().then(showTheme);
// The colours fade for 0.3 s by themselves (see the @property rules in styles.css).
document.querySelectorAll('#theme-switch button').forEach((b) => b.addEventListener('click', async () => {
  if (!b.classList.contains('active') && window.nabbitGlitch) window.nabbitGlitch();
  showTheme(await window.api.setTheme(b.dataset.theme));
}));
window.api.windowTitle().then((t) => { $('win-title').textContent = t; });

