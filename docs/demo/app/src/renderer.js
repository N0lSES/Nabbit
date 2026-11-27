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
    // Back / forward (nav-history.js): this tool, in the Toolbox.
    if (window.Nav) window.Nav.record(`tool:${tab.dataset.tool}:${tab.dataset.mode || ''}`, () => { if (window.Player && window.Player.toToolbox) window.Player.toToolbox(); tab.click(); });
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
    setTimeout(() => { if (!jobEls.size && !document.querySelector('#jobs .empty')) $('jobs').append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Nothing running.' })); }, 240);
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
  // A finished job leaves "Now" after a moment: its files are in "Done" below. Failed ones stay.
  if (ok) setTimeout(() => { if (jobEls.get(id) === el) removeJob(id); }, 4000);
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
    if (canPlayFile(p)) li.append(filePlayButton(() => cvFiles, p));
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
  if (dlMode === 'music' && muProvider === 'soulseek') return slskInput(url);
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
    // A DRM music link in the Video Downloader: the Music Downloader finds it on YouTube Music.
    else if (/\bDRM\b/i.test(msg)) {
      $('dl-search').disabled = false;
      document.querySelector('.tab[data-mode="music"]').click();
      $('dl-url').value = url;
      return musicOpen(url);
    }
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
  // Starts in the folder you saved music to last, else Music\Nabbit\Music (or your download folder).
  let last = '';
  try { last = localStorage.getItem('muDir') || ''; } catch {}
  const start = last || (await window.api.musicFolder().catch(() => '')) || $('dl-out').value;
  const dir = await window.api.pickFolder({ title: `Save ${kind} to`, defaultPath: start });
  if (dir) try { localStorage.setItem('muDir', dir); } catch {}
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

// One click (right-click a streamed song → Download): the song in the format picked for albums last
// (else FLAC from YouTube Music, the original file from SoundCloud), to the folder music was saved to
// last, with cover art and lyrics as set in the Music Downloader. No folder prompt.
async function quickDownloadSong(t) {
  if (!t || !t.url) return;
  const sc = /soundcloud\.com/i.test(t.url);
  let format = muAfmtTouched ? $('mu-afmt').value : '';
  if (!format || (sc && /^best:/.test(format))) format = sc ? 'orig:best' : 'best:flac';
  let outDir = '';
  try { outDir = localStorage.getItem('muDir') || ''; } catch {}
  if (!outDir) outDir = (await window.api.musicFolder().catch(() => '')) || $('dl-out').value;
  if (!outDir) return;
  const name = [t.artist, t.title].filter(Boolean).join(' - ') || 'song';
  await start('download', { url: t.url, music: true, format, cover: $('mu-cover-on').checked, lyrics: $('mu-lyrics-on').checked, outDir },
    `Music · ${t.title || name}`);
  if (window.Player && window.Player.toast) window.Player.toast(`Downloading ${name}`);
}
window.quickDownloadSong = quickDownloadSong;

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
  // Music from YouTube: start on "Highest quality" (FLAC).
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
  const bestC = Formats.parseChoice($('dl-afmt').value);
  const bestOut = a && bestC.kind === 'best' ? Formats.bestOutcome(a, bestC.ext) : null;
  $('dl-asize').textContent = bestOut && !bestOut.keep
    ? (bestOut.ext === 'mp3' ? sizeFromKbps(320) : Formats.formatBytes(Formats.losslessSize(bestOut.rate || 48000, bestOut.bits || 16, dlFormats.duration, 'flac')) || 'FLAC')
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
    const bo = c.kind === 'best' ? Formats.bestOutcome(a, c.ext) : null;
    tech.resolution = c.kind === 'original' ? a.codec : bo && bo.keep ? bo.ext.toUpperCase() : c.ext.toUpperCase();
    const rate = bo && !bo.keep ? bo.rate : audioConverting() && /^\d+$/.test($('dl-asr').value) ? Number($('dl-asr').value) : a.asr;
    tech.fps = rate ? khz(rate) : null;
    tech.bitrate = bo && !bo.keep ? (bo.ext === 'mp3' ? '320 kbps' : `Lossless${bo.bits ? ` · ${bo.bits}-bit` : ''}`) : lossless ? `Lossless · ${Number($('dl-abits').value) || 16}-bit`
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
function bestText(a, ext = 'flac') {
  const o = Formats.bestOutcome(a, ext);
  if (!o) return '';
  if (o.keep) return `kept as ${o.ext.toUpperCase()}`;
  return o.ext === 'mp3' ? `MP3 · 320 kbps · ${khz(o.rate)}` : `FLAC${o.bits ? ` · ${o.bits}-bit` : ''} · ${khz(o.rate)}`;
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
  music: ['Music Downloader', 'Search YouTube Music, SoundCloud or Soulseek for songs, albums or playlists, or paste a link to music you have the right to download. Only the audio is saved, tagged with cover art and lyrics.'],
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
// ---------- Playing your files from the Toolbox's lists (Recent, converter, compressor, stems) ----------
// Through the player and its play bar. A list's ▶ plays that file and then the list's other files.
const MEDIA_EXT = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'mp4', 'm4v', 'mkv', 'mov'];
function canPlayFile(p) { return typeof p === 'string' && MEDIA_EXT.includes((p.split('.').pop() || '').toLowerCase()); }
const samePath = (a, b) => !!a && !!b && a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
let nowFile = { path: null, playing: false };
function paintFilePlay(b) {
  const on = samePath(nowFile.path, b.dataset.playPath);
  b.classList.toggle('now', on);
  b.classList.toggle('now-playing', on && nowFile.playing);
  b.title = on ? (nowFile.playing ? 'Pause' : 'Resume') : b.dataset.label;
}
document.addEventListener('nabbit-now', (e) => { nowFile = e.detail || { path: null, playing: false }; for (const b of document.querySelectorAll('.file-play')) paintFilePlay(b); });
// getPaths() → the list's files (playable ones only are kept); i: this one. num: shown until hovered.
function filePlayButton(getPaths, path, { num = null, label = null } = {}) {
  const b = playButton(async () => {
    if (window.Player && samePath(window.Player.nowPath, path)) { document.getElementById('lp-play').click(); return; }
    const paths = getPaths().filter(canPlayFile);
    let i = paths.findIndex((p) => samePath(p, path));
    if (i < 0) { paths.unshift(path); i = 0; }
    if (!(window.Player && (await window.Player.playFiles(paths, i)))) { b.classList.add('cant'); b.title = "This file can't be played"; }
  }, label || `Play ${path.split(/[\\/]/).pop()}`, num);
  b.classList.add('file-play');
  b.dataset.playPath = path;
  b.dataset.label = b.title;
  paintFilePlay(b);
  return b;
}

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
const PROVIDERS = { ytmusic: 'YouTube Music', soundcloud: 'SoundCloud', soulseek: 'Soulseek' };
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

document.querySelectorAll('#mu-types .chip[data-type]').forEach((chip) => chip.addEventListener('click', () => {
  muType = chip.dataset.type;
  document.querySelectorAll('#mu-types .chip[data-type]').forEach((c) => {
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

// "Search on Soulseek" (right-click menus, src/file-actions.js): the Music Downloader, on Soulseek,
// searching for songs with these words.
window.nabbitSlskSearch = (query) => {
  if (window.Player && window.Player.toToolbox) window.Player.toToolbox(); // from Player mode too
  const tab = document.querySelector('.tab[data-mode="music"]');
  if (tab && !tab.classList.contains('active')) tab.click();
  if (PROVIDERS.soulseek && muProvider !== 'soulseek') setProvider('soulseek');
  const songs = document.querySelector('#mu-types .chip[data-type="songs"]');
  if (songs && muType !== 'songs') { muType = 'songs'; document.querySelectorAll('#mu-types .chip[data-type]').forEach((c) => { c.classList.toggle('active', c === songs); c.setAttribute('aria-checked', String(c === songs)); }); }
  $('dl-url').value = query;
  musicSearch(query);
};
async function musicSearch(query) {
  if (muProvider === 'soulseek') return slskSearch(query);
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
async function drmFallback(seq, url, hint, why = 'drm') {
  const what = why === 'drm' ? "SoundCloud's copy is DRM-protected" : "SoundCloud won't give this track out here (blocked in your country, private or removed)";
  // Title and artist from the search row, else from the link (soundcloud.com/<artist>/<track-name>).
  const slug = /soundcloud\.com\/([^/?#]+)\/([^/?#]+)/i.exec(url);
  const words = (x) => decodeURIComponent(x || '').replace(/[-_]+/g, ' ').trim();
  const want = { kind: 'track', title: (hint && hint.title) || (slug && words(slug[2])), artist: (hint && hint.artist) || (slug && words(slug[1])), duration: hint && hint.duration };
  dlState('loading', `${what}. Looking for it on YouTube Music…`);
  const row = await window.api.musicFindYtm(want).catch(() => null);
  if (seq !== dlSearchSeq) return;
  if (!row) return dlState('error', why === 'drm' ? "SoundCloud's copy is DRM-protected (SoundCloud Go+ only), and it isn't on YouTube Music." : `${what}, and it isn't on YouTube Music.`);
  await musicOpen(row.url, row, muFromResults);
  // Say why this is a YouTube Music song (unless something else was opened meanwhile).
  if (dlInfo && dlInfo.webpageUrl && !/soundcloud\.com/i.test(dlInfo.webpageUrl) && $('dl-state').classList.contains('hidden')) {
    dlState('note', `${what}, so this is the same song from YouTube Music.`);
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
      if (window.StreamMenu) window.StreamMenu.attach(row, r, songs); // right-click: play, download, Soulseek, artist, album
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
  if (window.Nav) window.Nav.record(`dl-open:${url}`, () => { if (window.Player && window.Player.toToolbox) window.Player.toToolbox(); const t = document.querySelector('.tab[data-mode="music"]'); if (t && !t.classList.contains('active')) t.click(); musicOpen(url, hint, fromResults); });
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
    // A DRM service's link (Spotify, Apple Music…): this is the same music from YouTube Music.
    if (res.via && res.hint && !hint) hint = res.hint;
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
      muAlbum.byTrack = !!a.byTrack;
      if (res.via) drmNote(res.via);
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
      if (res.via) drmNote(res.via);
      checkBetter(seq, { url, kind: 'track', title: res.info.track || res.info.title, artist: res.info.artist || res.info.uploader });
    }
  } catch (e) {
    if (seq !== dlSearchSeq) return;
    const msg = cleanMsg(e);
    // A DRM-protected SoundCloud track (SoundCloud Go+ only): open the same song from YouTube Music.
    // Or one SoundCloud refuses here (403 / 404: blocked in this country, private or removed): the same.
    if (/soundcloud\.com/i.test(url)) {
      if (/\bDRM\b/i.test(msg)) return drmFallback(seq, url, hint);
      if (/HTTP Error 40[34]|Forbidden|geo.?restrict|not available (in|from) your (country|location)/i.test(msg)) return drmFallback(seq, url, hint, 'blocked');
    }
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
// Player mode → an artist's YouTube Music page: the Music Downloader finds the artist by name.
window.nabbitOpenArtist = async (name) => {
  document.querySelector('.tab[data-mode="music"]').click();
  showMusicView(null);
  dlState('loading', `Finding ${name} on YouTube Music…`);
  try {
    const list = await window.api.musicSearch(name, 'artists', 'ytmusic');
    const a = (list || []).find((x) => x.type === 'artists' && x.url);
    if (!a) throw new Error(`${name} wasn't found on YouTube Music.`);
    dlState(null);
    openArtist(a.url, a);
  } catch (e) {
    dlState('error', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
};
async function openArtist(url, hint = null) {
  if (window.Nav) window.Nav.record(`dl-artist:${url}`, () => { if (window.Player && window.Player.toToolbox) window.Player.toToolbox(); const t = document.querySelector('.tab[data-mode="music"]'); if (t && !t.classList.contains('active')) t.click(); openArtist(url, hint); });
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
  buildArtistPage(a, $('mu-artist-page'));
  markPlaying();
  showMusicView('artist');
  document.querySelector('.content').scrollTop = 0;
}
// An artist's page (header, then songs as rows and the rest as tiles) into page. o: what clicks do:
// openArtist(url, t) for a related artist, openItem(t) for a song / album (row or tile), playSong(t, list)
// for a song's ▶, top (an element above the header, e.g. a Back button), extra (more header buttons).
// The Music Downloader opens them in its own views; Player mode's YouTube Music / SoundCloud tabs play them.
function buildArtistPage(a, page, o = {}) {
  const openA = o.openArtist || ((url, t) => openArtist(url, t));
  const openI = o.openItem || ((t) => openFromArtist(t));
  page.innerHTML = '';
  if (o.top) page.append(o.top);
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
      o.extra ? el('div', { className: 'ap-btns' }, out, ...o.extra) : out)));
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
        if (window.StreamMenu) window.StreamMenu.attach(row, { ...t, artist: t.artist || a.name, artistLinks: t.artistLinks && t.artistLinks.length ? t.artistLinks : [{ name: a.name, url: a.url }] }, sec.items);
        if (o.itemTitle) row.title = o.itemTitle(t);
        row.onclick = () => openI(t, sec.items, row);
        row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openI(t, sec.items, row); } };
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
        tile.title = t.type === 'artists' ? `Open ${t.title}'s artist page` : o.itemTitle ? o.itemTitle(t) : `Open ${t.title}`;
        tile.onclick = () => (t.type === 'artists' ? openA(t.url, t) : openI(t, sec.items, tile));
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
}
window.nabbitArtistPage = buildArtistPage;

// Songs and albums from an artist page open in their usual views, with "Back to <artist>".
function openFromArtist(item) {
  muReturn = 'artist';
  musicOpen(item.url, { ...item, artistLinks: item.artistLinks && item.artistLinks.length ? item.artistLinks : (muArtist ? [{ name: muArtist.name, url: muArtist.url }] : []), artist: item.artist || (muArtist && muArtist.name) }, false);
}
$('mu-lrclib').onclick = () => window.api.openExternal('https://lrclib.net');

// ----- Album view -----
const ALBUM_FORMATS = [
  { group: 'Best', items: Formats.BEST_ITEMS },
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
  // Only a real album names the songs' album (and artist, cover); a playlist's or likes' name, owner and
  // picture aren't the songs' own: those come from each song (filled in when it's looked up).
  const al = muAlbum.isAlbum !== false;
  return muAlbum.entries.filter((t) => t.url && (!picked.length || picked.includes(t.index))).map((t) => playItem({
    url: t.url, title: t.title, artist: t.artist || (al ? muAlbum.artist : null), artistLinks: al ? muAlbum.artistLinks || [] : [],
    album: al ? muAlbum.title : null, albumUrl: al ? muAlbum.webpageUrl : null,
    thumbnail: al ? muAlbum.thumbnail || t.thumbnail : t.thumbnail || null, duration: t.duration }));
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
    disableSelects(['mu-asr'], kind === 'best' ? 'Up to 48 kHz' : 'Source rate');
  }
  if (kind === 'best') {
    disableSelects(['mu-aqual'], ext === 'mp3' ? '320 kbps' : '16-bit');
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
  if (!line.classList.contains('warn')) line.textContent += ` → ${kind === 'best' ? bestText(src, ext) : ''}`.replace(/ → $/, '') + ' (first track)';
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
    // Rebuilt from YouTube Music songs (a DRM service's playlist): each ticked song's own link.
    urls: muAlbum.byTrack ? muAlbum.entries.filter((t) => items.includes(t.index) && t.url).map((t) => t.url) : undefined,
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
// ---------- Accent colour (Settings → Appearance): the red used for highlights, meters and the like ----------
const ACCENT_DEFAULT = '#ff2a1f';
const ACCENTS = [['#ff2a1f', 'Red'], ['#ff7a1a', 'Orange'], ['#ffc21a', 'Amber'], ['#2ee66b', 'Green'], ['#1ad9c4', 'Teal'], ['#3d8bff', 'Blue'], ['#9b5cff', 'Violet'], ['#ff3fa4', 'Pink']];
function applyAccent(hex) {
  const v = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : ACCENT_DEFAULT;
  const root = document.documentElement.style;
  if (v === ACCENT_DEFAULT) { root.removeProperty('--red'); root.removeProperty('--on-red'); }
  else {
    root.setProperty('--red', v);
    // Text on the accent: dark on light colours (amber, green …), white on dark ones.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    root.setProperty('--on-red', 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0c0c0c' : '#fff');
  }
  try { localStorage.setItem('nabbit.accent', v); } catch { /* none */ }
  const pick = $('st-accent');
  if (pick && document.activeElement !== pick) pick.value = v;
  for (const s of document.querySelectorAll('#st-swatches .st-sw')) { const on = s.dataset.c === v; s.classList.toggle('on', on); s.setAttribute('aria-checked', String(on)); }
}
try { applyAccent(localStorage.getItem('nabbit.accent')); } catch { /* default */ }
{
  const box = $('st-swatches');
  for (const [c, name] of ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-sw';
    b.dataset.c = c;
    b.title = name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.style.setProperty('--sw', c);
    b.addEventListener('click', () => { applyAccent(c); saveSetting({ accent: c === ACCENT_DEFAULT ? '' : c }); });
    box.append(b);
  }
  $('st-accent').addEventListener('input', (e) => applyAccent(e.target.value)); // live while picking
  $('st-accent').addEventListener('change', (e) => saveSetting({ accent: e.target.value.toLowerCase() === ACCENT_DEFAULT ? '' : e.target.value }));
  $('st-accent-reset').addEventListener('click', () => { applyAccent(ACCENT_DEFAULT); saveSetting({ accent: '' }); });
}

function showSettings(st) {
  applyAccent(st.accent);
  settings = st;
  document.body.classList.toggle('not-windows', !st.isWindows);
  $('st-login').checked = st.startWithWindows;
  $('st-min').checked = st.startMinimized;
  $('st-min').disabled = !st.startWithWindows;
  $('st-tray').checked = st.closeToTray;
  $('st-mediakeys').checked = st.mediaKeys !== false;
  $('st-blur').checked = !!st.windowBlur;
  $('st-blur-row').classList.toggle('hidden', !st.blurSupported);
  document.documentElement.classList.toggle('blur', !!st.blurNow);
  // A blurred ("glass") window draws its own caption buttons (main.js glassWin).
  document.documentElement.classList.toggle('glass', !!st.glassWindow);
  $('tb-ctrl').classList.toggle('hidden', !st.glassWindow);
  $('st-ytm').checked = st.ytmCompare !== false;
  $('st-shell').checked = st.shellMenu;
  $('st-dir').value = st.downloadDir;
  renderWhere(st);
  renderDiscord(st);
  $('st-hw').value = st.hwAccel;
  $('st-sq').value = st.streamQuality || 'normal';
  $('st-pd').checked = st.playDownload !== false;
  $('st-albumtracks').checked = st.preferAlbumTracks !== false;
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
  if (window.AddonPromo) window.AddonPromo.update(st.extClients);
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
$('st-mediakeys').onchange = (e) => saveSetting({ mediaKeys: e.target.checked }, e.target);
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
$('st-pd').onchange = (e) => saveSetting({ playDownload: e.target.checked });
$('st-albumtracks').onchange = (e) => saveSetting({ preferAlbumTracks: e.target.checked }, e.target);
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
// Settings → Where results go: Nabbit's folders (Music, Videos, Documents → Nabbit) or next to the original.
async function renderWhere(st) {
  const layout = st.saveLayout === 'beside' ? 'beside' : 'nabbit';
  window.nabbitSaveLayout = layout;
  if (window.StemsUI && window.StemsUI.refreshDest) window.StemsUI.refreshDest();
  for (const b of document.querySelectorAll('#st-layout .seg')) { const on = b.dataset.layout === layout; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); }
  $('st-where').classList.toggle('beside', layout === 'beside');
  $('st-layout-hint').textContent = layout === 'nabbit'
    ? 'Songs go in Music → Nabbit, videos in Videos → Nabbit, everything else in Documents → Nabbit → Misc, each in a folder for what made it. Click one to open it.'
    : 'Converted, trimmed, compressed and mastered files, stems and frames are saved next to the file they came from. Downloads still go to the folder below.';
  const box = $('st-folders');
  if (box.childElementCount) return;
  let list = [];
  try { list = await window.api.nabbitFolders(); } catch { /* none */ }
  for (const group of ['Music', 'Videos', 'Documents']) {
    const g = document.createElement('span'); g.className = 'g'; g.textContent = group;
    const l = document.createElement('span'); l.className = 'l';
    for (const f of list.filter((x) => x.group === group)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = f.label; b.title = f.dir;
      b.addEventListener('click', () => window.api.nabbitFolderOpen(f.dir));
      l.append(b);
    }
    box.append(g, l);
  }
}
document.querySelectorAll('#st-layout .seg').forEach((b) => b.addEventListener('click', () => saveSetting({ saveLayout: b.dataset.layout })));
// Settings → Discord (main.js, discord-rpc.js).
function renderDiscord(st) {
  const seg = (id, v) => { for (const b of document.querySelectorAll(`#${id} .seg`)) { const on = b.dataset.v === v; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); } };
  seg('dc-mode', st.discordMode);
  seg('dc-pic', st.discordPicture);
  const off = st.discordMode === 'off';
  $('dc-group').classList.toggle('dc-off', off);
  $('dc-album').checked = st.discordAlbum; $('dc-time').checked = st.discordTime; $('dc-play').checked = st.discordPlay;
  if (document.activeElement !== $('dc-app')) $('dc-app').value = st.discordAppId || '';
  $('dc-app-row').classList.toggle('hidden', !!st.discordBuiltIn && !st.discordAppId);
  $('dc-status').textContent = off ? 'Off'
    : !st.discordHasApp ? 'Paste your Discord application ID below (discord.com/developers → New Application → its Application ID).'
      : st.discordConnected ? 'Connected to Discord' : 'Waiting for the Discord app (open it on this PC)';
  $('dc-pic-hint').textContent = st.discordPicture === 'preset'
    ? 'The ready-made Nabbit nearest his colour (no clothes).'
    : st.discordExact ? 'Exactly as he looks (clothes and colour), from your Share address.'
      : 'Exactly as he looks needs Share links on (below). Until then: the ready-made Nabbit nearest his colour.';
  const cv = $('dc-preview'), mine = document.getElementById('nb-preview');
  if (cv && mine && mine.width) {
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#141218'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(mine, 4, 4, cv.width - 8, cv.height - 8);
  }
}
document.querySelectorAll('#dc-mode .seg').forEach((b) => b.addEventListener('click', () => saveSetting({ discordMode: b.dataset.v })));
document.querySelectorAll('#dc-pic .seg').forEach((b) => b.addEventListener('click', () => saveSetting({ discordPicture: b.dataset.v })));
for (const [id, key] of [['dc-album', 'discordAlbum'], ['dc-time', 'discordTime'], ['dc-play', 'discordPlay']]) $(id).addEventListener('change', (e) => saveSetting({ [key]: e.target.checked }, e.target));
$('dc-app').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  if (v && !/^\d{15,25}$/.test(v)) { e.target.setCustomValidity('An application ID is 17 to 20 digits.'); e.target.reportValidity(); return; }
  e.target.setCustomValidity('');
  saveSetting({ discordAppId: v });
});
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



// ---------- Soulseek (Music Downloader source) ----------
// main.js runs the search (with fallback queries while too little matches), filters, ranks and groups the
// answers, and sends the view here a few times a second: albums (folders) or songs, each shared by one or
// more users, best first. Downloads try the next user who has it when one fails.
let slskId = null;           // the search session shown
let slskItems = [];
let slskMeta = {};
let slskOpen = new Set();    // expanded entries (by key)
let slskPick = new Map();    // key → the source chosen in an expanded album
let slskPrefsNow = null;
const LOSSLESS_EXT = ['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'dsf', 'dff'];
const SLSK_LOSSY = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma'];
const mbText = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
// "FLAC 24-bit/96 kHz" · "MP3 320 kbps VBR"
function slskQuality(x) {
  const ext = (x.formats ? x.formats.join('/') : x.ext || '').toUpperCase();
  if (x.bitDepth || x.sampleRate) return `${ext} ${x.bitDepth ? `${x.bitDepth}-bit` : ''}${x.bitDepth && x.sampleRate ? '/' : ''}${x.sampleRate ? `${+(x.sampleRate / 1000).toFixed(1)} kHz` : ''}`.trim();
  if (x.bitrate) return `${ext} ${x.bitrate} kbps${x.vbr ? ' VBR' : ''}`;
  return ext;
}
const slskAvail = (src) => (src.slotFree ? 'Free slot' : `Queue ${src.queue}`);
const slskMode = () => (muType === 'songs' ? 'songs' : 'albums');

async function slskSearch(query, target) {
  const seq = ++dlSearchSeq;
  slskBatchShow(false); // a single search shows its results
  muAlbum = null;
  muResults = null;
  showMusicView(null);
  if (slskId) window.api.slskStop(slskId);
  slskId = null;
  slskItems = [];
  slskOpen = new Set();
  slskPick = new Map();
  const st = await window.api.slskStatus().catch(() => ({}));
  if (!st.configured) {
    dlState('note', 'Sign in to Soulseek first: Settings → Soulseek.');
    const go = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: ' Open Settings' });
    go.onclick = () => document.querySelector('.tab[data-tool="settings"]').click();
    $('dl-state').append(go);
    return;
  }
  dlState('loading', st.online ? 'Searching Soulseek…' : 'Signing in to Soulseek…');
  $('dl-search').disabled = true;
  try {
    if (!slskPrefsNow) slskPrefsNow = await window.api.slskPrefsGet().catch(() => null);
    const r = await window.api.slskSearch(target ? { target, mode: slskMode() } : { query, mode: slskMode() });
    if (seq !== dlSearchSeq) { window.api.slskStop(r.id); return; }
    slskId = r.id;
    slskMeta = { queries: r.queries, target: r.target, status: 'Searching…', done: false };
    slskYtmLookup(r.target, seq);
    renderSlsk();
  } catch (e) {
    if (seq === dlSearchSeq) dlState('error', cleanMsg(e));
  } finally {
    if (seq === dlSearchSeq) $('dl-search').disabled = false;
  }
}
window.api.onSlskView((v) => {
  if (v.id !== slskId) return;
  slskItems = v.items;
  slskMeta = { ...slskMeta, ...v };
  renderSlsk();
});
window.api.onSlskStatus((st) => { if (!st.online && muProvider === 'soulseek' && dlMode === 'music') dlState('note', st.message); });

function renderSlsk() {
  if (muProvider !== 'soulseek') return;
  const box = $('mu-results');
  const keepScroll = box.scrollTop;
  box.innerHTML = '';
  box.classList.add('slsk-list');
  const m = slskMeta;
  const noun = slskMode() === 'albums' ? 'album' : 'song';
  // Status: what's being searched, then how much came back.
  if (!m.done) dlState('loading', m.status || 'Searching Soulseek…');
  else dlState(slskItems.length || !m.status ? null : 'note', slskItems.length ? null : m.status);
  const head = Object.assign(document.createElement('div'), { className: 'slsk-head' });
  const count = Object.assign(document.createElement('span'), { className: 'slsk-count' });
  count.textContent = m.total ? `${m.total} ${noun}${m.total === 1 ? '' : 's'} from ${m.users} user${m.users === 1 ? '' : 's'}${m.done ? '' : ' so far'} · best first` : '';
  if (m.queries && m.queries.length > 1) count.title = `Searches: ${m.queries.join(' · ')}`;
  head.append(count, slskToggles(), slskLayoutSwitch());
  box.append(head);
  for (const g of slskItems) box.append(slskLayout === 'simple' ? slskSimple(g) : slskEntry(g));
  box.scrollTop = keepScroll;
  showMusicView('results');
}
// Quick filters above the results (saved; Settings → Soulseek has the rest).
function slskToggles() {
  const p = slskPrefsNow || {};
  const wrap = Object.assign(document.createElement('span'), { className: 'slsk-toggles' });
  const fm = Array.isArray(p.formats) && p.formats.length ? p.formats : null;
  const kind = fm && fm.every((f) => LOSSLESS_EXT.includes(f)) ? 'lossless' : fm && fm.every((f) => !LOSSLESS_EXT.includes(f)) ? 'lossy' : 'all';
  // Lossy only · All · Lossless only
  const sw = Object.assign(document.createElement('span'), { className: 'mu-provider slsk-layout slsk-kind', role: 'radiogroup' });
  sw.setAttribute('aria-label', 'Formats');
  for (const [v, label, tip, formats] of [
    ['lossy', 'Lossy only', 'Only MP3, AAC, Opus, Ogg… (smaller files)', SLSK_LOSSY],
    ['all', 'All', 'Every format', []],
    ['lossless', 'Lossless only', 'Only FLAC, WAV, ALAC, APE…', LOSSLESS_EXT],
  ]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'seg' + (kind === v ? ' active' : ''), textContent: label, title: tip });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(kind === v));
    b.onclick = async () => { if (kind === v) return; slskPrefsNow = await window.api.slskPrefs({ formats }); renderSlsk(); };
    sw.append(b);
  }
  wrap.append(sw);
  const chip = (label, on, title, fn) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip' + (on ? ' active' : ''), textContent: label, title });
    b.setAttribute('aria-pressed', String(!!on));
    b.onclick = async () => { slskPrefsNow = await window.api.slskPrefs(fn(!on)); renderSlsk(); };
    return b;
  };
  wrap.append(
    chip('Exact match', p.strictTitle && p.strictArtist, 'Only files whose path has the artist and the title or album', (v) => ({ strictTitle: v, strictArtist: v })),
  );
  return wrap;
}
function slskEntry(g) {
  const isAlbum = slskMode() === 'albums';
  const best = g.sources[0];
  const wrap = Object.assign(document.createElement('div'), { className: 'slsk-item' });
  const row = Object.assign(document.createElement('div'), { className: 'result slsk-row' + (g.matches ? '' : ' weak'), tabIndex: 0 });
  row.setAttribute('role', 'button');
  const open = slskOpen.has(g.key);
  row.setAttribute('aria-expanded', String(open));
  const lossless = isAlbum ? best.lossless : LOSSLESS_EXT.includes(best.ext);
  row.append(Object.assign(document.createElement('span'), { className: 'slsk-badge' + (lossless ? ' lossless' : ''), textContent: ((isAlbum ? best.formats[0] : best.ext) || '?').toUpperCase() }));
  const text = Object.assign(document.createElement('span'), { className: 'r-text' });
  text.append(Object.assign(document.createElement('div'), { className: 'r-title', textContent: g.name, title: isAlbum ? best.folder : best.file }));
  const sub = Object.assign(document.createElement('div'), { className: 'r-sub' });
  sub.textContent = [isAlbum ? `${g.tracks} track${g.tracks === 1 ? '' : 's'}` : g.duration ? clock(g.duration) : null, g.quality,
    g.users > 1 ? `shared by ${g.users} users` : best.user].filter(Boolean).join(' · ');
  text.append(sub);
  row.append(text);
  row.append(Object.assign(document.createElement('span'), { className: 'slsk-avail' + (best.slotFree ? ' free' : ''), textContent: slskAvail(best), title: `${best.user} · about ${mbText(best.speed || 0)}/s` }));
  const dl = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost slsk-dl', textContent: isAlbum ? 'Download album' : 'Download' });
  dl.title = g.users > 1 ? 'From the best source; if it fails, from the next' : `From ${best.user}`;
  dl.onclick = (e) => { e.stopPropagation(); slskDownload(g); };
  const y = isAlbum ? slskYtmFor(g) : null;
  if (!isAlbum || y) {
    const play = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn slsk-play', textContent: '▶', title: 'Play from YouTube Music' });
    play.setAttribute('aria-label', 'Play from YouTube Music');
    play.onclick = (e) => { e.stopPropagation(); if (isAlbum) slskPlayAlbum(y, 0); else slskPlaySong(g, play); };
    row.append(play);
  }
  row.append(dl);
  const toggle = () => { if (slskOpen.has(g.key)) slskOpen.delete(g.key); else slskOpen.add(g.key); wrap.replaceWith(slskEntry(g)); };
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(); } });
  wrap.append(row);
  if (open) wrap.append(slskDetail(g));
  return wrap;
}
// Expanded: the sources (users) that have it, and for albums the chosen source's tracks.
function slskDetail(g) {
  const isAlbum = slskMode() === 'albums';
  const box = Object.assign(document.createElement('div'), { className: 'slsk-detail' });
  const chosen = slskPick.get(g.key) || 0;
  const srcList = Object.assign(document.createElement('ol'), { className: 'slsk-sources' });
  g.sources.forEach((src, i) => {
    const li = document.createElement('li');
    if (isAlbum && i === chosen) li.classList.add('on');
    const pick = Object.assign(document.createElement('button'), { type: 'button', className: 'src-pick', title: isAlbum ? 'Show this copy\'s tracks' : src.file });
    pick.append(Object.assign(document.createElement('span'), { className: 's-user', textContent: src.user }),
      Object.assign(document.createElement('span'), { className: 's-q' + ((isAlbum ? src.lossless : LOSSLESS_EXT.includes(src.ext)) ? ' lossless' : ''), textContent: slskQuality(src) }),
      Object.assign(document.createElement('span'), { className: 's-size', textContent: mbText(src.size) }),
      Object.assign(document.createElement('span'), { className: 's-av' + (src.slotFree ? ' free' : ''), textContent: slskAvail(src) + (src.failed ? ' · failed before' : '') }));
    if (isAlbum) pick.onclick = () => { slskPick.set(g.key, i); box.replaceWith(slskDetail(g)); };
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn f-dl', textContent: '↓', title: `Download from ${src.user} (then the others if it fails)` });
    b.setAttribute('aria-label', `Download from ${src.user}`);
    b.onclick = () => slskDownload(g, src);
    li.append(pick, b);
    srcList.append(li);
  });
  box.append(Object.assign(document.createElement('div'), { className: 'slsk-sub-head', textContent: isAlbum ? 'Copies' : 'Sources' }), srcList);
  if (isAlbum) {
    const src = g.sources[chosen];
    const list = Object.assign(document.createElement('ol'), { className: 'slsk-files' });
    box.append(Object.assign(document.createElement('div'), { className: 'slsk-sub-head', textContent: `Tracks · ${src.user} · ${src.folder.split(/[\\/]/).slice(-2).join(' / ')}` }), list);
    const fill = (files) => {
      for (const f of files) {
        const li = document.createElement('li');
        li.append(Object.assign(document.createElement('span'), { className: 'f-name', textContent: f.name, title: f.file }));
        li.append(Object.assign(document.createElement('span'), { className: 'f-q' + (LOSSLESS_EXT.includes(f.ext) ? ' lossless' : ''), textContent: slskQuality(f) }));
        if (f.duration) li.append(Object.assign(document.createElement('span'), { className: 'f-dur', textContent: clock(f.duration) }));
        li.append(Object.assign(document.createElement('span'), { className: 'f-size', textContent: mbText(f.size) }));
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn f-dl', textContent: '↓', title: `Download ${f.name}` });
        b.setAttribute('aria-label', `Download ${f.name}`);
        b.onclick = () => slskDownload(g, src, [f]);
        li.append(b);
        list.append(li);
      }
    };
    if (src.files) fill(src.files);
    else window.api.slskSource(slskId, g.key, src.user, src.folder).then((files) => { src.files = files; fill(files); });
  }
  return box;
}
async function slskDownload(g, src, files) {
  const isAlbum = slskMode() === 'albums';
  const y = isAlbum ? slskYtmFor(g) : null;
  const title = files && files.length === 1 ? `Soulseek · ${files[0].name}` : `Soulseek · ${y ? y.title : g.name}`;
  // Tag with YouTube Music's album: cover, title, artist, year and its track titles.
  let meta;
  if (y) {
    const full = await slskYtmAlbum(y).catch(() => null);
    meta = { album: y.title, artist: y.artist || '', year: y.year || '', cover: y.thumbnail || '', tracks: ((full && full.entries) || []).map((e) => e.title) };
  }
  start('slsk', { session: slskId, key: g.key, user: src ? src.user : undefined, folder: src && isAlbum ? src.folder : undefined, files: files ? files.map((f) => f.file) : undefined, meta }, title);
}
// Leaving Soulseek for another source: drop its results. On Soulseek only Songs / Albums apply.
document.querySelectorAll('#mu-provider .seg').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.provider !== 'soulseek') { $('mu-results').classList.remove('slsk-list'); if (slskId) window.api.slskStop(slskId); slskId = null; }
  slskChips();
}));
function slskChips() {
  const on = muProvider === 'soulseek';
  document.querySelectorAll('#mu-types .chip[data-type]').forEach((c) => c.classList.toggle('hidden', on && !['songs', 'albums'].includes(c.dataset.type)));
  $('slsk-batch-btn').classList.toggle('hidden', !on);
  if (!on && typeof slskBatchShow === 'function') slskBatchShow(false);
  if (on && !['songs', 'albums'].includes(muType)) document.querySelector('#mu-types .chip[data-type="albums"]').click();
}
slskChips();

// "Find on Soulseek" on an opened YouTube Music / SoundCloud song or album: searches with its details
// (artist, title or album, length, track count), so the results can be matched exactly.
function slskFindButton(where, getTarget, mode) {
  let b = where.querySelector('.slsk-find');
  if (!b) {
    b = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost slsk-find', textContent: 'Find on Soulseek' });
    b.title = 'Search Soulseek for this, matched by artist, title and length';
    where.append(b);
  }
  b.onclick = () => {
    const t = getTarget();
    if (!t) return;
    // The YouTube Music album on screen gives the results (and the downloads) their cover and tags.
    slskYtmSeed = mode === 'albums' && muAlbum ? { title: muAlbum.title, artist: muAlbum.artist, year: muAlbum.year, thumbnail: muAlbum.thumbnail,
      url: muAlbum.webpageUrl, entries: (muAlbum.entries || []).map((e) => ({ index: e.index, title: e.title, duration: e.duration, url: e.url, artist: e.artist })) } : null;
    muType = mode;
    document.querySelectorAll('#mu-types .chip[data-type]').forEach((c) => { c.classList.toggle('active', c.dataset.type === mode); c.setAttribute('aria-checked', String(c.dataset.type === mode)); });
    setProvider('soulseek');
    slskChips();
    $('dl-url').value = [t.artist, t.album || t.title].filter(Boolean).join(' - ');
    slskSearch(null, t);
  };
  return b;
}
// Settings → Soulseek
async function slskSettings(st) {
  $('st-slsk-user').value = st.slskUser || '';
  $('st-slsk-port').value = st.slskPort || 2234;
  $('st-slsk-pass').placeholder = st.slskHasPassword ? 'Saved (type to change)' : '';
  $('st-slsk-state').textContent = st.slskOnline ? `Signed in as ${st.slskUser}.` : st.slskUser ? 'Not signed in. Signs in when you search.' : 'Not signed in.';
}
$('st-slsk-go').addEventListener('click', async () => {
  const btn = $('st-slsk-go');
  btn.disabled = true;
  $('st-slsk-state').textContent = 'Signing in…';
  try {
    const r = await window.api.slskAccount({ username: $('st-slsk-user').value, password: $('st-slsk-pass').value, port: $('st-slsk-port').value });
    $('st-slsk-pass').value = '';
    $('st-slsk-pass').placeholder = 'Saved (type to change)';
    $('st-slsk-state').textContent = r.online ? `Signed in as ${$('st-slsk-user').value.trim()} · listening on port ${r.port}.` : 'Saved. Enter a username and password to sign in.';
  } catch (e) {
    $('st-slsk-state').textContent = cleanMsg(e);
  } finally { btn.disabled = false; }
});
window.api.settingsGet().then(slskSettings).catch(() => {});

// The "Find on Soulseek" buttons follow what's open in the Music Downloader.
{
  const base = showMusicView;
  showMusicView = function (view) {
    base(view);
    const albumMeta = document.querySelector('#mu-album .album-meta');
    const songMeta = document.querySelector('#dl-card .video-meta');
    const off = muProvider === 'soulseek' || dlMode !== 'music';
    if (albumMeta) {
      const b = slskFindButton(albumMeta, () => muAlbum && { artist: muAlbum.artist || '', album: muAlbum.title || '', title: muAlbum.title || '', tracks: (muAlbum.entries || []).length || null }, 'albums');
      b.classList.toggle('hidden', off || view !== 'album');
    }
    if (songMeta) {
      const b = slskFindButton(songMeta, () => dlInfo && { artist: dlInfo.artist || dlInfo.uploader || '', title: dlInfo.track || dlInfo.title || '', length: dlInfo.duration || null }, 'songs');
      b.classList.toggle('hidden', off || view !== 'card');
    }
  };
}

// Settings → Soulseek → Search
(async () => {
  const p = await window.api.slskPrefsGet().catch(() => null);
  if (!p) return;
  slskPrefsNow = p;
  $('st-slsk-pref').value = p.prefFormat;
  $('st-slsk-minbr').value = String(p.minBitrate || 0);
  $('st-slsk-fb').value = String(p.fallbackLevel);
  $('st-slsk-hires').checked = !!p.hiRes;
  $('st-slsk-strict').checked = !!(p.strictTitle && p.strictArtist);
  $('st-slsk-ban').value = (p.bannedUsers || []).join('\n');
  const save = async (patch) => { slskPrefsNow = await window.api.slskPrefs(patch); };
  $('st-slsk-pref').onchange = (e) => save({ prefFormat: e.target.value });
  $('st-slsk-minbr').onchange = (e) => save({ minBitrate: Number(e.target.value) });
  $('st-slsk-fb').onchange = (e) => save({ fallbackLevel: Number(e.target.value) });
  $('st-slsk-hires').onchange = (e) => save({ hiRes: e.target.checked });
  $('st-slsk-strict').onchange = (e) => save({ strictTitle: e.target.checked, strictArtist: e.target.checked });
  $('st-slsk-ban').onchange = (e) => save({ bannedUsers: e.target.value.split(/\r?\n/) });
})();

// ---------- Soulseek: other inputs (links, field lists, files) and batches ----------
// In the search box: words search as before; "title=…, artist=…" searches those fields; a playlist /
// album / track link (YouTube, Spotify, SoundCloud, Bandcamp, MusicBrainz), a slsk:// link or a file
// path is read first: one song or album searches straight away, more open in Batch to check and start.
const isFieldList = (s) => /^(?:title|artist|album|length)\s*=/i.test(s);
async function slskInput(text) {
  const plain = !/^https?:\/\//i.test(text) && !/^slsk:\/\//i.test(text) && !/\.(csv|txt|list)$/i.test(text) && !isFieldList(text);
  if (plain) return slskSearch(text);
  const seq = ++dlSearchSeq;
  dlState('loading', 'Reading that…');
  const r = await window.api.slskResolve(text, slskMode()).catch((e) => ({ items: [], errors: [{ input: text, message: cleanMsg(e) }] }));
  if (seq !== dlSearchSeq) return;
  if (r.items.length === 1 && r.items[0].mode !== 'link') {
    const it = r.items[0];
    muType = it.mode;
    document.querySelectorAll('#mu-types .chip[data-type]').forEach((c) => { c.classList.toggle('active', c.dataset.type === it.mode); c.setAttribute('aria-checked', String(c.dataset.type === it.mode)); });
    return slskSearch(null, it.target);
  }
  dlState(null);
  slskBatchShow(true);
  $('sb-text').value = text;
  slskBatchPreview(r);
}

let sbItems = [];
function slskBatchShow(on) {
  $('slsk-batch').classList.toggle('hidden', !on);
  $('slsk-batch-btn').classList.toggle('active', on);
  $('slsk-batch-btn').setAttribute('aria-pressed', String(on));
  $('sb-mode').textContent = slskMode();
  if (on) setTimeout(() => $('sb-text').focus(), 0);
}
$('slsk-batch-btn').onclick = () => slskBatchShow($('slsk-batch').classList.contains('hidden'));
$('sb-close').onclick = () => slskBatchShow(false);
document.querySelectorAll('#mu-types .chip[data-type]').forEach((c) => c.addEventListener('click', () => { $('sb-mode').textContent = slskMode(); }));
const sbReset = () => { sbItems = []; $('sb-go-row').classList.add('hidden'); };
const sbAppend = (lines) => {
  const cur = $('sb-text').value.replace(/\s+$/, '');
  $('sb-text').value = (cur ? `${cur}\n` : '') + lines.join('\n');
  sbReset();
};
$('sb-file').onclick = async () => {
  const files = await window.api.pickFiles([{ name: 'Lists (CSV, TXT)', extensions: ['csv', 'txt', 'list'] }]);
  if (files && files.length) sbAppend(files);
};
$('sb-text').addEventListener('dragover', (e) => e.preventDefault());
$('sb-text').addEventListener('drop', (e) => {
  const paths = [...(e.dataTransfer.files || [])].map((f) => window.api.pathForFile(f)).filter(Boolean);
  if (!paths.length) return; // dropped text: the box takes it
  e.preventDefault();
  sbAppend(paths);
});
$('sb-text').addEventListener('input', sbReset);
let sbReading = false;
window.api.onSlskResolveProgress(({ i, n, line }) => {
  if (sbReading) $('sb-note').textContent = `Reading ${i + 1} of ${n}: ${line.slice(0, 80)}`;
});
$('sb-preview').onclick = async () => {
  const text = $('sb-text').value.trim();
  if (!text) return $('sb-text').focus();
  $('sb-preview').disabled = true;
  const note = $('sb-note').innerHTML;
  sbReading = true;
  try {
    slskBatchPreview(await window.api.slskResolve(text, slskMode()));
  } catch (e) {
    slskBatchPreview({ items: [], errors: [{ input: text.split('\n')[0], message: cleanMsg(e) }] });
  } finally {
    sbReading = false;
    $('sb-preview').disabled = false;
    $('sb-note').innerHTML = note;
    $('sb-mode').textContent = slskMode();
  }
};
function slskBatchPreview(r) {
  sbItems = r.items || [];
  const box = $('sb-list');
  box.innerHTML = '';
  const kind = { albums: 'Album', songs: 'Song', link: 'Link' };
  const list = document.createElement('ol');
  for (const it of sbItems.slice(0, 500)) {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { className: 'sb-kind', textContent: kind[it.mode] }));
    li.append(Object.assign(document.createElement('span'), { className: 'sb-label', textContent: it.label, title: it.label }));
    const t = it.target || {};
    const extra = [t.length ? clock(t.length) : null, t.tracks ? `${t.tracks} tracks` : null, it.prefs && Object.keys(it.prefs).length ? 'conditions' : null].filter(Boolean).join(' · ');
    if (extra) li.append(Object.assign(document.createElement('span'), { className: 'sb-extra', textContent: extra }));
    list.append(li);
  }
  box.append(list);
  if (sbItems.length > 500) box.append(Object.assign(document.createElement('p'), { className: 'hint small', textContent: `…and ${sbItems.length - 500} more.` }));
  for (const e of r.errors || []) box.append(Object.assign(document.createElement('p'), { className: 'sb-err', textContent: `✕ ${e.input.slice(0, 120)}: ${e.message}` }));
  box.classList.toggle('hidden', !sbItems.length && !(r.errors || []).length);
  $('sb-count').textContent = sbItems.length ? `${sbItems.length} to find · roughly ${Math.max(1, Math.round((sbItems.length * 10) / 60))} min of searching (Soulseek limits searches)` : 'Nothing to find.';
  $('sb-go').textContent = `Find & download all (${sbItems.length})`;
  $('sb-go').disabled = !sbItems.length;
  $('sb-go-row').classList.remove('hidden');
}
$('sb-go').onclick = () => {
  if (!sbItems.length) return;
  start('slsk-batch', { items: sbItems }, `Soulseek batch · ${sbItems.length} item${sbItems.length === 1 ? '' : 's'}`);
  $('sb-go').disabled = true;
  $('sb-count').textContent = 'Started: follow it in Jobs.';
};

// ---------- Soulseek: YouTube Music covers + metadata, and the simple layout ----------
// Soulseek folders have no cover and messy names; the matching YouTube Music album supplies both (shown
// in the results and written into the downloaded files' tags).
let slskYtmSeed = null;           // the album "Find on Soulseek" came from
let slskYtm = [];                 // YouTube Music albums for the current search
const slskYtmFull = new Map();    // album url → { entries } (track titles)
let slskLayout = (() => { try { return localStorage.getItem('nabbit-slsk-layout') || 'simple'; } catch { return 'simple'; } })();
const nrm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// A folder's album name without "Artist - ", year and format tags: "10 Years - The Autumn Effect (2005) [FLAC]" → "the autumn effect"
const folderAlbum = (name, artist) => {
  let n = String(name).replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\b(?:flac|mp3|320|v0|web|cd|vinyl|lossless|24-?bit|16-?bit|\d{2,3}(?:\.\d)?\s?khz)\b/gi, ' ');
  n = nrm(n.replace(/^\s*\d{4}\s*[-.]\s*/, ''));
  const a = nrm(artist);
  if (a && n.startsWith(`${a} `)) n = n.slice(a.length + 1);
  return n.replace(/^\d{4} /, '').trim();
};
async function slskYtmLookup(target, seq) {
  slskYtm = slskYtmSeed ? [slskYtmSeed] : [];
  if (slskYtmSeed && slskYtmSeed.url) slskYtmFull.set(slskYtmSeed.url, { entries: slskYtmSeed.entries });
  slskYtmSeed = null;
  if (slskMode() !== 'albums' || slskYtm.length) return;
  const q = [target.artist, target.album || target.title].filter(Boolean).join(' ');
  if (!q) return;
  try {
    const res = await window.api.musicSearch(q, 'albums', 'ytmusic');
    if (seq !== dlSearchSeq) return;
    slskYtm = (res || []).filter((r) => r.url && r.title).slice(0, 10);
    renderSlsk();
  } catch {}
}
function slskYtmFor(g) {
  if (!slskYtm.length) return null;
  const a = folderAlbum(g.name, slskYtm[0].artist);
  if (!a) return null;
  return slskYtm.find((y) => nrm(y.title) === a) || slskYtm.find((y) => { const t = nrm(y.title); return t.length > 3 && (a.includes(t) || t.includes(a)); }) || null;
}
async function slskYtmAlbum(y) {
  if (slskYtmFull.has(y.url)) return slskYtmFull.get(y.url);
  const r = await window.api.musicInfo(y.url);
  const full = { entries: (r && r.album && r.album.entries) || [] };
  slskYtmFull.set(y.url, full);
  return full;
}
function slskLayoutSwitch() {
  const wrap = Object.assign(document.createElement('span'), { className: 'mu-provider slsk-layout', role: 'radiogroup' });
  wrap.setAttribute('aria-label', 'Layout');
  for (const [v, label, tip] of [['simple', 'Simple', 'Covers and track names; Nabbit picks the copy'], ['advanced', 'Advanced', 'Every copy, user and file']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'seg' + (slskLayout === v ? ' active' : ''), textContent: label, title: tip });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(slskLayout === v));
    b.onclick = () => { slskLayout = v; try { localStorage.setItem('nabbit-slsk-layout', v); } catch {} renderSlsk(); };
    wrap.append(b);
  }
  return wrap;
}
// Simple: one row per album / song with its cover and plain details; open an album for its track list.
function slskSimple(g) {
  const isAlbum = slskMode() === 'albums';
  const best = g.sources[0];
  const y = isAlbum ? slskYtmFor(g) : null;
  const wrap = Object.assign(document.createElement('div'), { className: 'slsk-item simple' });
  const row = Object.assign(document.createElement('div'), { className: 'result slsk-row' + (g.matches ? '' : ' weak'), tabIndex: isAlbum ? 0 : -1 });
  const open = isAlbum && slskOpen.has(g.key);
  if (isAlbum) { row.setAttribute('role', 'button'); row.setAttribute('aria-expanded', String(open)); }
  if (y && y.thumbnail) {
    const img = Object.assign(document.createElement('img'), { className: 'slsk-cover', alt: '', loading: 'lazy', src: y.thumbnail });
    img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'slsk-badge', textContent: (best.formats || [best.ext])[0].toUpperCase() }));
    row.append(img);
  } else {
    const lossless = isAlbum ? best.lossless : LOSSLESS_EXT.includes(best.ext);
    row.append(Object.assign(document.createElement('span'), { className: 'slsk-badge' + (lossless ? ' lossless' : ''), textContent: ((isAlbum ? best.formats[0] : best.ext) || '?').toUpperCase() }));
  }
  const text = Object.assign(document.createElement('span'), { className: 'r-text' });
  const artist = (y && y.artist) || (slskMeta.target && slskMeta.target.artist) || '';
  text.append(Object.assign(document.createElement('div'), { className: 'r-title', textContent: y ? y.title : isAlbum ? g.name : slskTrackTitle(g.name), title: isAlbum ? best.folder : best.file }));
  const sub = Object.assign(document.createElement('div'), { className: 'r-sub' });
  sub.textContent = [artist, y && y.year, isAlbum ? `${g.tracks} track${g.tracks === 1 ? '' : 's'}` : g.duration ? clock(g.duration) : null].filter(Boolean).join(' · ');
  const q = Object.assign(document.createElement('div'), { className: 'r-sub slsk-q' + ((isAlbum ? best.lossless : LOSSLESS_EXT.includes(best.ext)) ? ' lossless' : '') });
  q.textContent = [slskQuality(best), mbText(best.size), g.users > 1 ? `${g.users} copies` : null].filter(Boolean).join(' · ');
  text.append(sub, q);
  row.append(text);
  row.append(Object.assign(document.createElement('span'), { className: 'slsk-avail' + (best.slotFree ? ' free' : ''), textContent: best.slotFree ? 'Ready' : `Queue ${best.queue}` }));
  // Listen first: the same album / song streamed from YouTube Music, when it's there.
  if (!isAlbum || y) {
    const play = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn slsk-play', textContent: '▶', title: 'Play from YouTube Music' });
    play.setAttribute('aria-label', `Play ${y ? y.title : slskTrackTitle(g.name)} from YouTube Music`);
    play.onclick = (e) => { e.stopPropagation(); if (isAlbum) slskPlayAlbum(y, 0); else slskPlaySong(g, play); };
    row.append(play);
  }
  const dl = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost slsk-dl', textContent: 'Download' });
  dl.onclick = (e) => { e.stopPropagation(); slskDownload(g); };
  row.append(dl);
  wrap.append(row);
  if (isAlbum) {
    const toggle = () => { if (slskOpen.has(g.key)) slskOpen.delete(g.key); else slskOpen.add(g.key); wrap.replaceWith(slskSimple(g)); };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(); } });
  }
  if (open) {
    const list = Object.assign(document.createElement('ol'), { className: 'slsk-files simple' });
    wrap.append(list);
    const fill = (titles) => {
      const files = best.files || [];
      files.forEach((f, i) => {
        const li = document.createElement('li');
        // With YouTube Music's titles (same track count) each track plays from there.
        if (titles) {
          const p = Object.assign(document.createElement('button'), { type: 'button', className: 'f-play', title: 'Play from YouTube Music' });
          p.append(Object.assign(document.createElement('span'), { className: 'n', textContent: String(i + 1).padStart(2, '0') }), Object.assign(document.createElement('span'), { className: 'p', textContent: '▶' }));
          p.setAttribute('aria-label', `Play ${titles[i]} from YouTube Music`);
          p.onclick = () => slskPlayAlbum(y, i);
          li.append(p);
        } else li.append(Object.assign(document.createElement('span'), { className: 'f-no', textContent: String(i + 1).padStart(2, '0') }));
        li.append(Object.assign(document.createElement('span'), { className: 'f-name', textContent: (titles && titles[i]) || slskTrackTitle(f.name) }));
        if (f.duration) li.append(Object.assign(document.createElement('span'), { className: 'f-dur', textContent: clock(f.duration) }));
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn f-dl', textContent: '↓', title: 'Download this track' });
        b.setAttribute('aria-label', `Download track ${i + 1}`);
        b.onclick = () => slskDownload(g, best, [f]);
        li.append(b);
        list.append(li);
      });
    };
    // YouTube Music's titles when the track counts agree, else cleaned-up file names.
    if (y) slskYtmAlbum(y).then((full) => fill(full.entries.length === (best.files || []).length ? full.entries.map((e) => e.title) : null)).catch(() => fill(null));
    else fill(null);
  }
  return wrap;
}
// "03 - Artist - Waking Up.flac" → "Waking Up"
function slskTrackTitle(name) {
  let t = String(name).replace(/\.[^.]+$/, '').replace(/^\s*(?:disc\s*\d+\s*)?\d{1,3}(?:[-.]\d{1,3})?\s*[-._)\]]*\s*/i, '');
  const a = slskMeta.target && slskMeta.target.artist;
  if (a && nrm(t).startsWith(`${nrm(a)} `)) t = t.replace(/^[^-–]+?\s[-–]\s/, '');
  return t.trim();
}

// Playing Soulseek results through YouTube Music (the player streams from there).
async function slskPlayAlbum(y, from = 0) {
  const full = await slskYtmAlbum(y).catch(() => null);
  const q = ((full && full.entries) || []).filter((t) => t.url).map((t) => playItem({
    url: t.url, title: t.title, artist: t.artist || y.artist, artistLinks: [], album: y.title, albumUrl: y.url, thumbnail: y.thumbnail, duration: t.duration }));
  if (!q.length) return dlState('note', 'YouTube Music has no playable tracks for this album.');
  const i = Math.min(from, q.length - 1);
  window.Player.play(q[i], q, i);
}
// A song: the first YouTube Music song with the same title (and length within 5 s, when known).
async function slskPlaySong(g, btn) {
  const artist = (slskMeta.target && slskMeta.target.artist) || '';
  const title = slskTrackTitle(g.name);
  btn.disabled = true;
  try {
    const res = (await window.api.musicSearch([artist, title].filter(Boolean).join(' '), 'songs', 'ytmusic')) || [];
    const want = nrm(title);
    const hit = res.find((r) => r.url && nrm(r.title).includes(want) && (!g.duration || !r.duration || Math.abs(r.duration - g.duration) <= 5))
      || res.find((r) => r.url && nrm(r.title).includes(want));
    if (!hit) return dlState('note', `“${title}” isn't on YouTube Music.`);
    const item = playItem({ url: hit.url, title: hit.title, artist: hit.artist || artist, artistLinks: [], album: hit.album || '', thumbnail: hit.thumbnail, duration: hit.duration });
    window.Player.play(item, [item], 0);
  } catch (e) { dlState('note', cleanMsg(e)); } finally { btn.disabled = false; }
}

// A note above the song / album when it came from a DRM service's link.
function drmNote(v) {
  const what = v.kind === 'track' ? 'song' : v.kind === 'album' ? 'album' : 'playlist';
  const part = v.total ? ` Found ${v.found} of ${v.total} songs.` : '';
  dlState('note', `${v.from} uses DRM, which Nabbit doesn't get around. This is the same ${what} from YouTube Music.${part}`);
}

// Scrolling on any slider moves it a step (Shift: 5 steps), like dragging it. Sliders that handle the
// wheel themselves (the play bar, Speed, the EQ) keep their own way (they prevent the default).
{
  const changed = new Map(); // slider → timer for its 'change' (saved settings) after the scrolling stops
  document.addEventListener('wheel', (e) => {
    const r = e.target;
    if (e.defaultPrevented || !(r instanceof HTMLInputElement) || r.type !== 'range' || r.disabled) return;
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!d) return;
    const step = Number(r.step) > 0 ? Number(r.step) : 1;
    const min = Number(r.min || 0), max = Number(r.max || 100);
    const v = Math.max(min, Math.min(max, Number(r.value) + (d < 0 ? 1 : -1) * step * (e.shiftKey ? 5 : 1)));
    if (v === Number(r.value)) return;
    r.value = String(Math.round(v / step) * step);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    clearTimeout(changed.get(r));
    changed.set(r, setTimeout(() => { changed.delete(r); r.dispatchEvent(new Event('change', { bubbles: true })); }, 250));
  }, { passive: false });
}
