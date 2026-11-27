// Player mode: a music player for your own files. The Toolbox / Player switch under the logo swaps
// the tools for the library: artists and folders in the sidebar, albums grouped with their artwork in
// the middle (double-click a song to play), now playing on the right (speed, cover, rating, format,
// lyrics from the file's tags, up next) and a play bar at the bottom. The same player plays songs from
// the Music Downloader (window.Player.play: streamed, or downloaded first), so its play bar also shows
// in the Toolbox while something is loaded.
(() => {
  const $ = (id) => document.getElementById(id);
  const Core = window.LibraryCore;
  if (!Core || !$('lp')) return;

  // ---------- Toolbox / Player ----------
  let mode = 'toolbox';
  try { mode = localStorage.getItem('nabbit.mode') === 'player' ? 'player' : 'toolbox'; } catch { /* default */ }
  const brandSub = document.querySelector('.brand-sub');
  function setMode(m) {
    // Back / forward (nav-history.js): Player mode is a place; the Toolbox's places are its tools.
    if (window.Nav && m === 'player') { const src = window.Sources ? window.Sources.get() : 'local'; window.Nav.record(`src:${src}`, () => { setMode('player'); if (window.Sources) window.Sources.set(src); }); }
    else if (window.Nav && m === 'toolbox') { const t = document.querySelector('.tab.active'); if (t) window.Nav.record(`tool:${t.dataset.tool}:${t.dataset.mode || ''}`, () => { setMode('toolbox'); t.click(); }); }
    mode = m;
    document.body.classList.toggle('mode-player', m === 'player');
    for (const b of document.querySelectorAll('[data-mode-sw]')) {
      const on = b.dataset.modeSw === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (brandSub) brandSub.textContent = m === 'player' ? 'Media player' : 'Media toolbox';
    try { localStorage.setItem('nabbit.mode', m); } catch { /* none */ }
    if (m === 'player' && !loaded) load();
    // The oscilloscope: in the sidebar under the Toolbox / Player switch in Player mode (in place of the
    // striped bar); hidden on the Toolbox's play bar (styles.css).
    const osc = $('lp-osc');
    if (osc) {
      if (m === 'player') { const bars = document.querySelector('.brand-bars'); if (bars && osc.previousElementSibling !== bars) bars.after(osc); osc.classList.add('side'); }
      else if (!osc.classList.contains('side') || osc.parentElement !== $('lp-bar')) { $('lp-bar').insertBefore(osc, document.querySelector('.lp-bar-mid')); osc.classList.remove('side'); }
    }
    showBar();
    if (typeof syncYt === 'function') { syncYt(true); if (m === 'player') requestAnimationFrame(() => { if ($('lp-now').classList.contains('looping')) fitLoop(); }); runLoop(); lyrAt = -1; syncLyrics(); }
  }
  for (const b of document.querySelectorAll('[data-mode-sw]')) b.addEventListener('click', () => setMode(b.dataset.modeSw));

  // ---------- Library data ----------
  let loaded = false, tracks = [], folders = [], view = { kind: 'all', artist: null };
  let sortBy = 'album';
  try { sortBy = localStorage.getItem('nabbit.lpSort') === 'folder' ? 'folder' : 'album'; } catch { /* default */ }
  let albums = [], shown = []; // albums in the current view; shown = their tracks, in order
  let playlists = []; // [{ id, name, items: [paths] }] (main.js keeps them; player-core.js edits them)
  window.api.plGet().then((l) => { playlists = l || []; if (loaded) renderSide(); }).catch(() => {});
  async function savePlaylists(list) {
    playlists = list;
    renderSide();
    try { playlists = await window.api.plSet(list); } catch { /* kept in memory */ }
  }
  async function load() {
    loaded = true;
    try {
      const r = await window.api.libGet();
      tracks = r.tracks || []; folders = r.folders || [];
    } catch { tracks = []; folders = []; }
    // A queue from before (restored, or the library reloaded): the same songs, as the list's objects.
    const byPath = new Map(tracks.map((t) => [t.path, t]));
    const same = (x) => (x && !x.stream && byPath.get(x.path)) || x;
    queue = queue.map(same); base = base.map(same);
    if (current) current = same(current);
    if (pre) pre.t = same(pre.t);
    render();
  }
  let reloadTimer = 0;
  window.api.onLibChanged(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { if (loaded) load(); }, 400); });
  window.api.onLibProgress(({ done, total }) => {
    const el = $('lp-scan');
    el.classList.toggle('hidden', !total || done >= total);
    el.textContent = `Reading tags · ${done} / ${total}`;
  });

  const PC = window.PlayerCore;
  const fxDelay = () => (window.PlayerFx && window.PlayerFx.delay ? window.PlayerFx.delay() : 0);
  const fmtTime = PC.fmtTime, fmtLong = PC.fmtLong;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const artistOf = (t) => t.albumArtist || t.artist || 'Unknown artist';
  // Everyone credited on a song (album artist and track artists, "A; B" split), for the Artists list.
  const artistsOf = (t) => { const s = Core.splitArtists(`${t.albumArtist || ''};${t.artist || ''}`); return s.length ? s : ['Unknown artist']; };
  // The sidebar's artists are your artist folders: the first folder inside a library folder
  // (Music\Artist\Album\song), whatever the tags say. Songs right in a library folder have none.
  const artistDirCache = new WeakMap();
  function artistDirOf(t) {
    if (artistDirCache.has(t)) return artistDirCache.get(t);
    const p = String(t.path), low = p.toLowerCase();
    let root = '';
    for (const r of folders) { const rr = String(r).replace(/[\\/]+$/, ''); if (low.startsWith(rr.toLowerCase() + '\\') || low.startsWith(rr.toLowerCase() + '/')) { if (rr.length > root.length) root = rr; } }
    const parts = (root ? p.slice(root.length + 1) : p).split(/[\\/]/).filter(Boolean);
    const dir = root && parts.length >= 2 ? parts[0] : null;
    artistDirCache.set(t, dir);
    return dir;
  }

  function filtered() {
    const q = $('lib-q').value.trim().toLowerCase();
    const DAY = 86400000;
    // A music video kept beside its song (same name) isn't listed twice: it's the song's Video.
    const audioStems = new Set(tracks.filter((t) => !t.hasVideo).map((t) => `${dirOf(t.path)}|${stem(t.path)}`));
    return tracks.filter((t) => {
      if (t.hasVideo && audioStems.has(`${dirOf(t.path)}|${stem(t.path)}`)) return false;
      if (view.kind === 'recent' && !(t.mtime > Date.now() - 30 * DAY)) return false;
      if (view.kind === 'loved' && !t.loved) return false;
      if (view.kind === 'rated' && !(t.rating >= 4)) return false;
      if (view.artist && artistDirOf(t) !== view.artist) return false;
      return !q || [t.title, t.artist, t.album, t.albumArtist, t.genre].some((x) => String(x || '').toLowerCase().includes(q));
    });
  }

  // ---------- Sidebar ----------
  // Back / forward: this view of Local Files.
  function navView() {
    const v = { ...view };
    if (window.Nav) window.Nav.record(`view:${v.kind}:${v.id || ''}:${v.artist || ''}`, () => { if (mode !== 'player') setMode('player'); view = { ...v }; if (window.Sources && window.Sources.get() !== 'local') window.Sources.set('local'); render(); });
  }
  function renderSide() {
    const views = [['all', 'Local Files', tracks.length], ['recent', 'Recently added', tracks.filter((t) => t.mtime > Date.now() - 30 * 86400000).length],
      ['loved', 'Loved', tracks.filter((t) => t.loved).length], ['rated', '4 stars and up', tracks.filter((t) => t.rating >= 4).length]];
    const vb = $('lib-views');
    vb.textContent = '';
    for (const [k, label, n] of views) {
      const b = el('button', 'lib-item' + (view.kind === k && !view.artist ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.append(el('span', '', label), el('em', '', n.toLocaleString()));
      b.addEventListener('click', () => { view = { kind: k, artist: null }; render(); navView(); });
      vb.append(b);
    }
    const pb = $('lib-pls');
    pb.textContent = '';
    for (const pl of playlists) {
      const b = el('button', 'lib-item' + (view.kind === 'playlist' && view.id === pl.id ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.title = pl.name;
      b.append(el('span', '', pl.name), el('em', '', pl.items.length.toLocaleString()));
      b.addEventListener('click', () => { view = { kind: 'playlist', id: pl.id, artist: null }; render(); $('lp-list').scrollTop = 0; navView(); });
      // Songs dragged from the list onto a playlist are added to it.
      b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-nabbit-paths')) { e.preventDefault(); b.classList.add('drop'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', (e) => {
        b.classList.remove('drop');
        let paths = [];
        try { paths = JSON.parse(e.dataTransfer.getData('application/x-nabbit-paths')); } catch { return; }
        e.preventDefault();
        addToPlaylist(pl.id, paths);
      });
      pb.append(b);
    }
    if (!playlists.length) pb.append(el('div', 'lib-none', 'Right-click a song to add it to one.'));
    const counts = new Map();
    for (const t of tracks) { const a = artistDirOf(t); if (a) counts.set(a, (counts.get(a) || 0) + 1); }
    const ab = $('lib-artists');
    ab.textContent = '';
    for (const [name, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))) {
      const b = el('button', 'lib-item artist' + (view.artist === name ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.title = name;
      b.append(el('span', '', name), el('em', '', String(n)));
      b.addEventListener('click', () => { view = view.artist === name ? { kind: 'all', artist: null } : { kind: 'all', artist: name }; render(); $('lp-list').scrollTop = 0; navView(); });
      ab.append(b);
    }
    const fb = $('lib-folders');
    fb.textContent = '';
    for (const d of folders) {
      const row = el('div', 'lib-folder');
      row.title = d;
      const n = tracks.filter((t) => t.path.startsWith(d)).length;
      row.append(el('span', '', d.split(/[\\/]/).filter(Boolean).pop() || d), el('em', '', n.toLocaleString()));
      const x = el('button', 'lib-x', '✕');
      x.type = 'button';
      x.title = 'Stop showing this folder (the files stay)';
      x.setAttribute('aria-label', `Remove ${d} from the library`);
      x.addEventListener('click', async () => { folders = await window.api.libRemoveFolder(d); });
      row.append(x);
      fb.append(row);
    }
  }
  $('lib-q').addEventListener('input', () => renderList());
  // ---------- Playlists ----------
  const outside = new Map(), outsideAsked = new Set(); // path → track, for songs outside the library
  function newPlaylist(items = [], open = true) {
    const pl = PC.newPlaylist(`Playlist ${playlists.length + 1}`, items);
    savePlaylists([...playlists, pl]);
    if (open) { view = { kind: 'playlist', id: pl.id, artist: null }; render(); requestAnimationFrame(() => renameUi(pl.id)); }
    return pl;
  }
  function addToPlaylist(id, paths) {
    const pl = playlists.find((p) => p.id === id);
    if (!pl) return;
    savePlaylists(playlists.map((p) => (p.id === id ? PC.addTo(p, paths) : p)));
    if (view.kind === 'playlist' && view.id === id) renderList();
    toast(`Added ${paths.length === 1 ? '1 song' : `${paths.length} songs`} to ${pl.name}`);
  }
  function editPlaylist(id, fn) {
    savePlaylists(playlists.map((p) => (p.id === id ? fn(p) : p)));
    if (view.kind === 'playlist' && view.id === id) renderList();
  }
  $('lib-newpl').addEventListener('click', () => newPlaylist());
  // Renaming: the title turns into a text box (Enter keeps it, Esc doesn't).
  function renameUi(id) {
    const pl = playlists.find((p) => p.id === id);
    const title = $('lp-title');
    if (!pl || !title) return;
    const box = el('input', 'lp-rename');
    box.type = 'text';
    box.value = pl.name;
    box.setAttribute('aria-label', 'Playlist name');
    title.textContent = '';
    title.append(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (keep) => { if (done) return; done = true; if (keep && box.value.trim()) editPlaylist(id, (p) => PC.rename(p, box.value)); else renderList(); };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    box.addEventListener('blur', () => finish(true));
  }
  // A playlist's songs, in its order, as one list: drag a row to move it, ✕ to take it out.
  function renderPlaylist(list) {
    const pl = playlists.find((p) => p.id === view.id);
    if (!pl) { view = { kind: 'all', artist: null }; renderList(); return; }
    const byPath = new Map(tracks.map((t) => [t.path, t]));
    for (const [p, t] of outside) if (!byPath.has(p)) byPath.set(p, t);
    // Songs from outside your music folders (added from Explorer or Recent downloads): read once.
    const unknown = pl.items.filter((p) => !byPath.has(p) && !outsideAsked.has(p));
    if (unknown.length) {
      for (const p of unknown) outsideAsked.add(p);
      window.api.playFilesInfo(unknown).then((got) => { for (const t of got || []) outside.set(t.path, t); if ((got || []).length && view.kind === 'playlist') renderList(); }).catch(() => {});
    }
    const q = $('lib-q').value.trim().toLowerCase();
    const match = (t) => !q || [t.title, t.artist, t.album, t.albumArtist].some((x) => String(x || '').toLowerCase().includes(q));
    const rows = pl.items.map((p, i) => ({ p, i, t: byPath.get(p) })).filter((x) => !x.t || match(x.t));
    albums = [];
    shown = rows.filter((x) => x.t && x.t.playable).map((x) => x.t);
    $('lp-title').textContent = pl.name;
    $('lp-title').title = 'Double-click to rename';
    const total = shown.reduce((s, t) => s + (t.duration || 0), 0);
    $('lp-stats').textContent = `Playlist · ${pl.items.length.toLocaleString()} song${pl.items.length === 1 ? '' : 's'}${total ? ` · ${fmtLong(total)}` : ''}`;
    $('lp-sort').classList.add('hidden');
    const bar = el('div', 'lp-pl-bar');
    const btn = (label, fn, cls = '') => { const b = el('button', `lp-txt ${cls}`, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    bar.append(btn('Rename', () => renameUi(pl.id)), btn('Delete playlist', () => {
      if (bar.dataset.sure !== '1') { bar.dataset.sure = '1'; bar.lastChild.textContent = 'Click again to delete'; setTimeout(() => { if (bar.isConnected) { bar.dataset.sure = ''; bar.lastChild.textContent = 'Delete playlist'; } }, 3000); return; }
      view = { kind: 'all', artist: null };
      savePlaylists(playlists.filter((p) => p.id !== pl.id));
      render();
    }, 'dim'));
    list.append(bar);
    if (!pl.items.length) { list.append(el('p', 'lp-empty', 'Empty. Right-click songs (or drag them onto the playlist in the sidebar) to add them.')); return; }
    const box = el('div', 'lp-tracks lp-pl');
    for (const { p, i, t } of rows) {
      let r;
      if (t) { r = trackRow(t); r.querySelector('.n').textContent = String(i + 1); }
      else {
        r = el('div', 'lp-tr off missing');
        r.title = `${p}\nNot in your library any more.`;
        r.append(el('span', 'n', String(i + 1)), el('span', 't', p.split(/[\\/]/).pop()), el('span', 'a', 'Missing'), el('span', ''), el('span', 'd', ''));
      }
      r.classList.add('pl');
      r.dataset.idx = String(i);
      r.draggable = true;
      const x = el('button', 'lp-pl-x', '✕');
      x.type = 'button';
      x.title = 'Take it out of this playlist';
      x.addEventListener('click', (e) => { e.stopPropagation(); editPlaylist(pl.id, (pp) => PC.removeAt(pp, i)); });
      r.append(x);
      box.append(r);
    }
    // Reordering by dragging rows.
    let from = -1;
    box.addEventListener('dragstart', (e) => {
      const r = e.target.closest('.lp-tr.pl');
      if (!r) return;
      from = Number(r.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
      const t = owner.get(r);
      if (t) e.dataTransfer.setData('application/x-nabbit-paths', JSON.stringify([t.path]));
      r.classList.add('dragging');
    });
    box.addEventListener('dragover', (e) => {
      if (from < 0) return;
      e.preventDefault();
      const r = e.target.closest('.lp-tr.pl');
      for (const x of box.querySelectorAll('.drop-before, .drop-after')) x.classList.remove('drop-before', 'drop-after');
      if (!r) return;
      const after = e.offsetY > r.clientHeight / 2;
      r.classList.add(after ? 'drop-after' : 'drop-before');
    });
    box.addEventListener('drop', (e) => {
      if (from < 0) return;
      e.preventDefault();
      const r = e.target.closest('.lp-tr.pl');
      const to = r ? Number(r.dataset.idx) + (r.classList.contains('drop-after') ? 1 : 0) : pl.items.length;
      const f = from;
      from = -1;
      if (to !== f && to !== f + 1) editPlaylist(pl.id, (pp) => PC.moveItem(pp, f, to));
      else renderList();
    });
    box.addEventListener('dragend', () => { from = -1; for (const x of box.querySelectorAll('.dragging, .drop-before, .drop-after')) x.classList.remove('dragging', 'drop-before', 'drop-after'); });
    list.append(box);
    markPlaying();
  }
  $('lp-title').addEventListener('dblclick', () => { if (view.kind === 'playlist') renameUi(view.id); });

  // ---------- Right-click menu on songs ----------
  function songMenu(t, x, y) {
    closeMenu();
    const m = el('div', 'lp-ctx');
    m.setAttribute('role', 'menu');
    const item = (label, fn, cls = '') => { const b = el('button', `lp-ctx-i ${cls}`, label); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.addEventListener('click', () => { closeMenu(); fn(); }); m.append(b); return b; };
    const sep = () => m.append(el('div', 'lp-ctx-sep'));
    item('Play', () => playFrom(shown.indexOf(t)));
    item('Play next', () => queueSongs([t], true));
    item('Add to queue', () => queueSongs([t], false));
    sep();
    m.append(el('div', 'lp-ctx-h', 'Add to playlist'));
    for (const pl of playlists) item(pl.name, () => addToPlaylist(pl.id, [t.path]), 'sub');
    item('+ New playlist', () => newPlaylist([t.path], false), 'sub');
    if (view.kind === 'playlist') {
      const idx = (playlists.find((p) => p.id === view.id) || { items: [] }).items.indexOf(t.path);
      if (idx >= 0) item('Take out of this playlist', () => editPlaylist(view.id, (p) => PC.removeAt(p, idx)));
    }
    // Your own files: split them, shrink them, or look for them on Soulseek (src/file-actions.js).
    if (!t.stream && t.path && window.FileActions) {
      sep();
      item('Separate stems', () => window.FileActions.stems([t.path]));
      item('Compress', () => window.FileActions.compress([t.path]));
      item('Search on Soulseek', () => window.FileActions.soulseek(t));
    }
    sep();
    item('Show in folder', () => window.api.showItem(t.path));
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    m.querySelector('button').focus();
  }
  function closeMenu() { for (const m of document.querySelectorAll('.lp-ctx')) m.remove(); }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.lp-ctx')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);
  // Play next / add to queue: after the playing song, or at the end; starts playing if nothing is.
  function queueSongs(list, next) {
    list = list.filter((t) => t && t.playable);
    if (!list.length) return;
    if (!current) { base = list.slice(); queue = list.slice(); start(0); return; }
    if (next) queue.splice(qi + 1, 0, ...list); else queue.push(...list);
    base.push(...list.filter((t) => !base.includes(t)));
    paintUpNext();
    toast(next ? `Playing next: ${list[0].title}` : `Added to the queue: ${list[0].title}`);
  }
  // A short note at the bottom of the window.
  let toastTimer = 0;
  function toast(text) {
    let t = document.querySelector('.lp-toast');
    if (!t) { t = el('div', 'lp-toast'); t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }
  $('lp-sort').addEventListener('click', () => {
    sortBy = sortBy === 'album' ? 'folder' : 'album';
    try { localStorage.setItem('nabbit.lpSort', sortBy); } catch { /* none */ }
    renderList();
    $('lp-list').scrollTop = 0;
  });
  $('lib-add').addEventListener('click', async () => { const f = await window.api.libAddFolder(); if (f) { folders = f; renderSide(); } });
  $('lib-rescan').addEventListener('click', () => window.api.libScan());

  // ---------- Album list ----------
  const covers = new Map(); // path → data URL | null
  const coverIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      coverIO.unobserve(en.target);
      paintCover(en.target, en.target.dataset.path);
    }
  }, { root: $('lp-list'), rootMargin: '400px' });
  async function coverOf(p) {
    if (!covers.has(p)) covers.set(p, window.api.libCover(p, 360).catch(() => null));
    return covers.get(p);
  }
  async function paintCover(box, p) {
    const url = await coverOf(p);
    if (url) { box.style.backgroundImage = `url("${url}")`; box.classList.add('pic'); }
  }
  // A cover-less album gets a tile with its name.
  function coverBox(cls, album, path) {
    const b = el('div', cls);
    b.dataset.path = path;
    const h = [...album].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    b.style.setProperty('--hue', String(h % 360));
    b.append(el('span', 'lp-cover-name', album));
    return b;
  }
  function render() {
    renderSide();
    renderList();
  }
  function renderList() {
    const list = $('lp-list');
    $('lp-sort').classList.remove('hidden');
    $('lp-title').title = '';
    if (view.kind === 'playlist') {
      list.textContent = '';
      for (const r of pendingRows.keys()) rowsIO.unobserve(r);
      pendingRows.clear();
      renderPlaylist(list);
      return;
    }
    const tr = filtered();
    albums = sortBy === 'folder' ? Core.groupFolders(tr, folders) : Core.groupAlbums(tr, folders);
    // Sort: an album (a disc) or a folder, whichever it's sorted by.
    const sb = $('lp-sort'), byFolder = sortBy === 'folder';
    if (sb.dataset.by !== sortBy) {
      sb.dataset.by = sortBy;
      sb.innerHTML = byFolder
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/></svg>';
      sb.setAttribute('aria-label', `Sort: ${byFolder ? 'Folder' : 'Album'}`);
      sb.title = byFolder ? 'Following your folders: click to group by album' : 'Grouped by album: click to follow your folders';
    }
    shown = albums.flatMap((a) => a.tracks);
    $('lp-title').textContent = view.artist || { all: 'Local Files', recent: 'Recently added', loved: 'Loved', rated: '4 stars and up' }[view.kind];
    const total = shown.reduce((s, t) => s + (t.duration || 0), 0);
    $('lp-stats').textContent = shown.length ? `${albums.length} album${albums.length === 1 ? '' : 's'} · ${shown.length} songs · ${fmtLong(total)}` : '';
    list.textContent = '';
    for (const r of pendingRows.keys()) rowsIO.unobserve(r);
    pendingRows.clear();
    if (!tracks.length) {
      list.append(el('p', 'lp-empty', folders.length ? 'No music found yet in your folders. Add a folder in the sidebar, or wait for the scan.' : 'Add a music folder in the sidebar to start.'));
      return;
    }
    if (!shown.length) { list.append(el('p', 'lp-empty', 'Nothing matches.')); return; }
    const frag = document.createDocumentFragment();
    for (const a of albums) {
      const sec = el('section', 'lp-album');
      const head = el('div', 'lp-ahead');
      head.title = a.folderView ? a.path || a.folder : '';
      head.append(el('b', '', a.album), el('span', 'dim', a.year ? `(${a.year})` : ''), el('span', 'lp-sp'), el('span', 'lp-atime', fmtTime(a.duration)));
      const grid = el('div', 'lp-agrid');
      const cov = coverBox('lp-acover', a.album, a.tracks[0].path);
      cov.title = 'Double-click to play the album';
      cov.addEventListener('dblclick', () => playFrom(shown.indexOf(a.tracks[0])));
      coverIO.observe(cov);
      const info = el('div', 'lp-ainfo');
      const t0 = a.tracks[0];
      const aname = el('span', 'hi');
      if (a.artist && a.artist !== 'Various artists') aname.append(artistLinks(a.artist)); else aname.textContent = a.artist;
      info.append(aname, el('span', '', a.year ? String(a.year) : ''), el('span', '', a.codec),
        el('span', '', [t0.rate ? `${t0.rate / 1000} kHz` : '', t0.bits ? `${t0.bits}-bit` : ''].filter(Boolean).join(' · ')));
      const rows = el('div', 'lp-tracks');
      // The songs are added when the album comes near the screen (a big library would otherwise build
      // hundreds of thousands of elements up front); until then the album keeps its height.
      const discs = new Set(a.tracks.map((t) => t.disc || 1)).size;
      rows.style.minHeight = `${(a.tracks.length + Math.max(1, discs)) * 24}px`;
      pendingRows.set(rows, a.tracks);
      rowsIO.observe(rows);
      grid.append(cov, info, rows);
      sec.append(head, grid);
      frag.append(sec);
    }
    list.append(frag);
  }
  const pendingRows = new Map(); // a song list not built yet → its songs
  const rowsIO = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) buildRows(en.target);
  }, { root: $('lp-list'), rootMargin: '1200px 0px' });
  function buildRows(rows) {
    const tr = pendingRows.get(rows);
    if (!tr) return;
    pendingRows.delete(rows);
    rowsIO.unobserve(rows);
    const f = document.createDocumentFragment();
    let disc = null;
    for (const t of tr) {
      if ((t.disc || 1) !== disc) { disc = t.disc || 1; f.append(el('div', 'lp-disc', `Disc ${disc}`)); }
      const r = trackRow(t);
      if (current && current.path === t.path) r.classList.add('now');
      f.append(r);
    }
    rows.append(f);
    rows.style.minHeight = '';
  }
  // Rows, stars and artist names carry no listeners of their own (a big library has tens of thousands
  // of them): a few listeners on the list and the page look up what was clicked.
  const owner = new WeakMap(); // a row or a set of stars → its song
  function stars(t, cls = 'lp-stars') {
    const s = el('span', cls);
    owner.set(s, t);
    for (let i = 1; i <= 5; i++) {
      const b = el('button', 'lp-star' + ((t.rating || 0) >= i ? ' on' : ''), (t.rating || 0) >= i ? '★' : '☆');
      b.type = 'button';
      b.dataset.n = String(i);
      b.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
      s.append(b);
    }
    return s;
  }
  document.addEventListener('click', (e) => {
    const star = e.target.closest('.lp-star[data-n]');
    if (star) {
      const t = owner.get(star.parentElement), i = Number(star.dataset.n);
      if (t) { e.stopPropagation(); rate(t, { rating: t.rating === i ? 0 : i }); }
      return;
    }
    const a = e.target.closest('.lp-artist-link[data-artist]');
    if (a) { e.stopPropagation(); openArtistPage(a.dataset.artist); }
  });
  function trackRow(t) {
    const r = el('div', 'lp-tr' + (t.playable ? '' : ' off'));
    r.tabIndex = 0;
    r.draggable = true;
    r.dataset.path = t.path;
    r.title = t.playable ? t.path : `${t.path}\nThis format can't play here.`;
    owner.set(r, t);
    const an = el('span', 'a');
    if (t.artist) an.append(artistLinks(t.artist));
    r.append(el('span', 'n', t.track ? String(t.track) : ''), el('span', 't', t.title), an, stars(t), el('span', 'd', fmtTime(t.duration)));
    return r;
  }
  {
    const list = $('lp-list');
    const rowOf = (e) => { const r = e.target.closest('.lp-tr'); return r && owner.get(r) ? r : null; };
    list.addEventListener('dblclick', (e) => { const r = rowOf(e); if (r && !e.target.closest('.lp-star, .lp-artist-link')) playFrom(shown.indexOf(owner.get(r))); });
    list.addEventListener('keydown', (e) => { const r = rowOf(e); if (r && e.key === 'Enter' && e.target === r) playFrom(shown.indexOf(owner.get(r))); });
    list.addEventListener('click', (e) => {
      const r = rowOf(e);
      if (!r) return;
      const old = list.querySelector('.lp-tr.sel');
      if (old && old !== r) old.classList.remove('sel');
      r.classList.add('sel');
    });
    list.addEventListener('contextmenu', (e) => { const r = rowOf(e); if (r) { e.preventDefault(); songMenu(owner.get(r), e.clientX, e.clientY); } });
    // Songs can be dragged onto a playlist in the sidebar.
    list.addEventListener('dragstart', (e) => {
      const r = rowOf(e);
      if (!r || r.classList.contains('pl')) return;
      e.dataTransfer.setData('application/x-nabbit-paths', JSON.stringify([owner.get(r).path]));
      e.dataTransfer.effectAllowed = 'copy';
    });
  }
  async function rate(t, o) {
    const u = await window.api.libRate(t.path, o).catch(() => null);
    if (!u) return;
    if ('loved' in o && !!u.loved !== !!t.loved && window.api.lastfmLove) window.api.lastfmLove({ title: t.title, artist: t.artist, albumArtist: t.albumArtist, album: t.album }, !!u.loved).catch(() => {});
    Object.assign(t, u);
    const row = document.querySelector(`.lp-tr[data-path="${CSS.escape(t.path)}"] .lp-stars`);
    if (row) row.replaceWith(stars(t));
    if (current && current.path === t.path) paintNow();
    if (view.kind !== 'all') renderSide();
  }

  // ---------- Playback ----------
  // One <video> element plays everything (audio files too), so a music video can show in the cover box.
  // Two players take turns, so the next song can be loaded ahead and start right as this one ends
  // (gapless). `audio` is the one playing now; listeners added with onMedia run only for it.
  const mediaEls = [$('lp-video'), $('lp-video-b')];
  let audio = mediaEls[0];
  audio.classList.add('active');
  for (const m of mediaEls) m.preload = 'auto';
  const onMedia = (ev, fn) => { for (const m of mediaEls) m.addEventListener(ev, (e) => { if (e.currentTarget === audio) fn(e); }); };
  // ---------- Cover / Video ----------
  // A song with a video: the file itself, or a video beside it with the same name (or the same title
  // in the same folder). The toggle on the cover switches the picture, keeping the position.
  let videoOn = false, curSrc = '';
  try { videoOn = localStorage.getItem('nabbit.lpVideo') === '1'; } catch { /* default */ }
  const stem = (p) => String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();
  const dirOf = (p) => String(p).replace(/[\\/][^\\/]*$/, '').toLowerCase();
  function videoFor(t) {
    if (!t || t.stream) return null;
    if (t.hasVideo) return t;
    const d = dirOf(t.path), s = stem(t.path), title = String(t.title || '').toLowerCase();
    return tracks.find((x) => x !== t && x.hasVideo && x.playable && dirOf(x.path) === d && (stem(x.path) === s || (title && String(x.title || '').toLowerCase() === title))) || null;
  }
  // No local video: YouTube's music video (looked up when Video is on), played with its own audio.
  // Streamed songs (YouTube Music, SoundCloud) get one too, always muted and kept in step with the song.
  let yt = null; // { forPath, file, synced, title, channel } for the current song (forPath: vKey)
  const vKey = (t) => (t ? (t.stream ? `u:${t.url}` : t.path) : null);
  let ytAudio = 'youtube';
  try { ytAudio = localStorage.getItem('nabbit.lpYtAudio') === 'local' ? 'local' : 'youtube'; } catch { /* default */ }
  // Local / YouTube audio, switched live (same point in the song).
  function setYtAudio(mode) {
    ytAudio = mode;
    try { localStorage.setItem('nabbit.lpYtAudio', mode); } catch { /* none */ }
    if (!(yt && current && yt.forPath === vKey(current)) || current.stream) return;
    yt.synced = mode === 'local';
    if (yt.synced) {
      swapSource(current.path);
      if (!ytv.getAttribute('src')) { ytv.src = fileUrl(yt.file); ytv.addEventListener('loadedmetadata', () => syncYt(true), { once: true }); }
      setTimeout(() => syncYt(true), 300);
    } else {
      ytv.pause();
      swapSource(yt.file);
    }
    paintVideo();
  }
  for (const b of document.querySelectorAll('[data-ytaud]')) b.addEventListener('click', () => setYtAudio(b.dataset.ytaud));
  let ytBusy = null;
  const ytv = $('lp-ytv');
  ytv.muted = true;
  const sourceFor = (t) => (videoOn && videoFor(t) ? videoFor(t).path : videoOn && yt && yt.forPath === vKey(t) && !yt.synced ? yt.file : t.path);
  function paintVideo() {
    const local = videoFor(current);
    $('lp-vtoggle').classList.toggle('hidden', !current);
    const ytShow = !!(videoOn && !local && yt && current && yt.forPath === vKey(current));
    const show = !!(videoOn && (local || ytShow));
    $('lp-cover').classList.toggle('video', show && !(ytShow && yt.synced));
    $('lp-cover').classList.toggle('ytsync', show && ytShow && yt.synced);
    $('lp-vtoggle').textContent = ytBusy && videoOn ? ytBusy : show ? (loopOn && loop && loop.file && current && loop.forPath === loopKey(current) ? 'Switch to loop' : 'Switch to cover') : 'Switch to video';
    $('lp-vtoggle').setAttribute('aria-pressed', String(videoOn));
    $('lp-vtoggle').title = show ? 'Show the album cover' : local ? 'Show the music video instead of the cover' : 'Find the music video on YouTube';
    paintLoop();
    const info = $('lp-ytinfo');
    info.classList.toggle('hidden', !ytShow);
    if (ytShow) {
      $('lp-yt-t').textContent = `YouTube · ${yt.title}`;
      $('lp-yt-t').title = `${yt.title}\n${yt.channel || ''}`;
      document.querySelector('.lp-yt-aud').classList.toggle('hidden', !!current.stream); // a streamed song's own sound always plays
      for (const b of document.querySelectorAll('[data-ytaud]')) { const on = (b.dataset.ytaud === 'local') === yt.synced; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    }
  }
  // ---------- Loop ----------
  // A few seconds of the song's music video, silent and looping on the cover (like a "canvas"): cut from
  // a video beside the song, else from YouTube's (just that part is fetched). Always on when there's a
  // music video (else the cover); the next song's loop is made while this one plays, so it's there
  // straight away.
  const loopOn = true;
  let loop = null; // { forPath, file | null } for the current song (forPath: loopKey)
  const loopKey = (t) => (t.stream ? `u:${t.url}` : t.path);
  // The artist to search by: a Music Downloader song's first credited artist.
  // find: only look the video up (remembered), so jumping to that song later needs just the clip.
  const loopAsk = (t, find = false) => (t.stream
    ? window.api.streamLoop({ title: t.title, artist: (t.artistLinks && t.artistLinks[0] && t.artistLinks[0].name) || t.artist || '', duration: t.duration, find })
    : window.api.libYtLoop(t.path, { ...loopArgs(t), find }));
  const loopV = $('lp-loop');
  loopV.muted = true;
  let loopBusy = false;
  const loopArgs = (t) => { const v = videoFor(t); return { local: v ? v.path : null }; };
  async function loadLoop(t) {
    if (!loopOn || !t || (loop && loop.forPath === loopKey(t))) return;
    if (t.stream && !t.detailsIn) return; // once it's downloaded (openStream)
    loopBusy = true;
    paintLoop();
    const r = await loopAsk(t).catch(() => null);
    if (current !== t) return;
    loopBusy = false;
    loop = { forPath: loopKey(t), file: r ? r.file : null };
    paintVideo();
    // The next two songs' loops are made now (one after the other), so they're ready when those start;
    // the videos of the ten after them are looked up, so jumping ahead needs only the clip.
    (async () => {
      for (let k = 1; k <= 12; k++) {
        if (current !== t) return;
        const nx = queue[qi + k];
        // A streamed song waits for its details (its own artist), found when it's fetched ahead.
        if (nx && nx.playable && nx.title && (!nx.stream || nx.detailsIn)) await loopAsk(nx, k > 2).catch(() => {});
      }
    })();
  }
  function paintLoop() {
    const cov = $('lp-cover');
    const has = !!(loopOn && loop && current && loop.forPath === loopKey(current) && loop.file && !cov.classList.contains('video') && !cov.classList.contains('ytsync'));
    cov.classList.toggle('loop', has);
    $('lp-now').classList.toggle('looping', has);
    if (has) fitLoop();
    if (has) {
      const u = fileUrl(loop.file);
      if (loopV.dataset.f !== u) {
        loopV.dataset.f = u;
        loopV.classList.remove('ready');
        loopV.src = u;
        loopV.addEventListener('canplay', () => loopV.classList.add('ready'), { once: true });
      }
    } else if (loopV.dataset.f) {
      loopV.pause();
      loopV.removeAttribute('src');
      loopV.load();
      delete loopV.dataset.f;
      loopV.classList.remove('ready');
    }
    runLoop();
  }
  // The loop fills the panel from its top down to the bottom of the cover's spot, zoomed to fit, so
  // nothing in the panel moves.
  function fitLoop() {
    const now = $('lp-now').getBoundingClientRect(), cov = $('lp-cover').getBoundingClientRect();
    if (now.height) $('lp-now').style.setProperty('--loop-h', `${Math.max(0, Math.round(cov.bottom - now.top))}px`);
  }
  new ResizeObserver(() => { if ($('lp-now').classList.contains('looping')) fitLoop(); }).observe($('lp-now'));
  // It moves while the song plays and you can see it.
  function runLoop() {
    const go = mode === 'player' && !audio.paused && $('lp-cover').classList.contains('loop');
    if (go && loopV.paused) loopV.play().catch(() => {});
    else if (!go && !loopV.paused) loopV.pause();
  }
  onMedia('play', runLoop);
  onMedia('pause', runLoop);
  // A file on this PC into the player: file:// normally; while the effects are running, through the
  // local stream server (Web Audio gets only silence from file:// audio). True once it's set.
  async function setLocalSrc(p, seq = loadSeq) {
    if (window.PlayerFx && window.PlayerFx.routed()) {
      const url = await window.api.mediaUrl(p).catch(() => null);
      if (seq !== loadSeq) return false;
      if (url) { audio.crossOrigin = 'anonymous'; audio.src = url; return true; }
    }
    audio.removeAttribute('crossorigin');
    audio.src = fileUrl(p);
    return true;
  }
  // The effects just started: the song carries on from the same point, through the stream server.
  window.PlayerMedia = {
    async reroute() {
      if (!current || current.stream || !curSrc) return;
      const at = audio.currentTime, playing = !audio.paused;
      if (!(await setLocalSrc(curSrc))) return;
      applySpeed();
      audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, (audio.duration || at) - 0.5); } catch { /* ignore */ } }, { once: true });
      if (playing) audio.play().catch(() => {});
    },
  };
  // Swap what the player plays (same song, other file), carrying on from the same point.
  async function swapSource(want) {
    if (!current || current.stream || !want || curSrc === want) return;
    const at = audio.currentTime, playing = !audio.paused;
    curSrc = want;
    if (!(await setLocalSrc(want))) return;
    applySpeed();
    audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, (audio.duration || at) - 0.5); } catch { /* ignore */ } }, { once: true });
    if (playing) audio.play().catch(() => {});
  }
  function syncYt(force = false) {
    // The muted music video only runs while you can see it (not in the Toolbox).
    if (!(mode === 'player' && videoOn && yt && yt.synced && current && yt.forPath === vKey(current))) { if (!ytv.paused) ytv.pause(); return; }
    const want = Math.max(0, audio.currentTime - fxDelay()); // in step with what's heard, not the player's clock
    if (force || Math.abs(ytv.currentTime - want) > 0.25) { try { ytv.currentTime = want; } catch { /* not ready */ } }
    ytv.playbackRate = audio.playbackRate;
    if (audio.paused && !ytv.paused) ytv.pause();
    if (!audio.paused && ytv.paused) ytv.play().catch(() => {});
  }
  for (const ev of ['play', 'pause', 'seeked', 'ratechange']) onMedia(ev, () => syncYt(ev === 'seeked'));
  onMedia('timeupdate', () => syncYt(false));
  async function loadYt(t, next = false) {
    if (!t || videoFor(t)) return;
    ytBusy = 'Finding…';
    paintVideo();
    try {
      const r = t.stream
        ? await window.api.streamYtVideo({ key: vKey(t), title: t.title, artist: (t.artistLinks && t.artistLinks[0] && t.artistLinks[0].name) || t.artist || '', duration: t.duration, next })
        : await window.api.libYtVideo(t.path, { next });
      if (current !== t) return;
      // Audio: your file (the video muted and kept in step) or the video's own sound; your choice, remembered.
      // A streamed song: always its own sound, the video following it.
      yt = { forPath: vKey(t), file: r.file, synced: t.stream || ytAudio === 'local', title: r.title, channel: r.channel };
      ytBusy = null;
      if (yt.synced) {
        swapSource(t.path);
        ytv.src = fileUrl(r.file);
        ytv.addEventListener('loadedmetadata', () => syncYt(true), { once: true });
      } else {
        ytv.removeAttribute('src'); ytv.load();
        if (videoOn) swapSource(r.file);
      }
    } catch (e) {
      if (current !== t) return;
      ytBusy = null;
      yt = null;
      const why = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      $('lp-vtoggle').textContent = 'No video';
      $('lp-vtoggle').title = why;
      // The reason, where it can be read (the details are in video-log.txt: Ctrl+click the Video button).
      if (why !== 'Stopped') toast(`No music video: ${why.slice(0, 160)}`);
      setTimeout(() => { if (current === t) paintVideo(); }, 2500);
      return;
    }
    paintVideo();
  }
  window.api.onLibYtProgress(({ path, percent }) => {
    if (!current || vKey(current) !== path || !ytBusy) return;
    ytBusy = `Video ${Math.floor(percent)}%`;
    $('lp-vtoggle').textContent = ytBusy;
  });
  $('lp-yt-next').addEventListener('click', () => { if (current) { const t = current; yt = null; swapSource(t.path); ytv.removeAttribute('src'); ytv.load(); paintVideo(); loadYt(t, true); } });
  // Ctrl+click: why music videos haven't come (the log of failures).
  $('lp-vtoggle').addEventListener('click', (e) => { if (e.ctrlKey && window.api.videoLog) { e.stopImmediatePropagation(); window.api.videoLog(); } }, true);
  $('lp-vtoggle').addEventListener('click', async () => {
    if (ytBusy) return;
    videoOn = !videoOn;
    try { localStorage.setItem('nabbit.lpVideo', videoOn ? '1' : '0'); } catch { /* none */ }
    if (current) {
      if (videoOn && !videoFor(current) && !(yt && yt.forPath === vKey(current))) { paintVideo(); loadYt(current); return; }
      swapSource(sourceFor(current));
      syncYt(true);
    }
    paintVideo();
  });
  ytv.addEventListener('dblclick', () => { if (document.fullscreenElement) document.exitFullscreen(); else ytv.requestFullscreen().catch(() => {}); });
  // Double-click the cover (or the small one beside the title): the picture at full size, over the
  // window (click or Esc closes it).
  $('lp-cover').addEventListener('dblclick', (e) => {
    if (e.target.closest('video, button, .lp-ytinfo') || $('lp-cover').classList.contains('video') || $('lp-cover').classList.contains('ytsync')) return;
    showFullCover();
  });
  $('lp-np-thumb').addEventListener('dblclick', () => showFullCover());
  $('lp-np-thumb').title = 'Double-click for the cover at full size';
  async function showFullCover() {
    if (!current || document.querySelector('.lp-lightbox')) return;
    const url = current.stream ? current.art || current.thumbnail : await window.api.libCover(current.path, 'full').catch(() => null);
    if (!url) return;
    const box = el('div', 'lp-lightbox');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Cover at full size');
    const img = el('img');
    img.src = url;
    img.alt = current.album || current.title;
    const cap = el('div', 'lp-lb-cap', [current.album, current.albumArtist || current.artist].filter(Boolean).join(' · '));
    img.addEventListener('load', () => { cap.textContent += ` · ${img.naturalWidth} × ${img.naturalHeight}`; });
    box.append(img, cap);
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (k) => { if (k.key === 'Escape') { k.stopPropagation(); close(); } };
    box.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.append(box);
  }
  // Double-click the video: full screen.
  for (const m of mediaEls) m.addEventListener('dblclick', () => { if (document.fullscreenElement) document.exitFullscreen(); else m.requestFullscreen().catch(() => {}); });
  let queue = [], base = [], qi = -1, current = null, shuffle = false, lrc = null;
  let guest = null, guestRaf = 0; // another tool playing through the play bar (see attachGuest)
  const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
  // The queue: the list you played from (base), in order or shuffled with the chosen song first.
  function order(list, i) {
    if (!shuffle) return [list.slice(), i];
    const first = list[i];
    const rest = list.filter((_, k) => k !== i);
    for (let k = rest.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
    return [[first, ...rest], 0];
  }
  function playFrom(i) {
    if (i < 0) return;
    base = shown.slice();
    [queue, i] = order(base, i);
    start(i);
  }
  let loadSeq = 0;
  async function start(i) {
    cancelMix();
    stretch = 1;
    clearInterval(stretchGlide);
    while (i < queue.length && !queue[i].playable) i++;
    if (i >= queue.length) { stop(); return; }
    // The next song already loaded on the other player: switch to it (quicker, and no gap).
    if (pre && pre.i === i && pre.t === queue[i]) { handover(); return; }
    dropPre();
    qi = i;
    current = queue[i];
    const t = current, seq = ++loadSeq;
    songStarted(t);
    if (t.stream) {
      audio.pause();
      paintVideo();
      await openStream(t, seq); // the lyrics and the loop are looked up once it's here (openStream)
      return;
    }
    curSrc = sourceFor(t);
    if (window.PlayerFx && window.PlayerFx.level) { window.PlayerFx.level(audio, 1); window.PlayerFx.pitch(audio, null); }
    if (!(await setLocalSrc(curSrc, seq))) return;
    applySpeed();
    paintVideo();
    if (videoOn && !videoFor(t) && !yt) loadYt(t);
    loadLoop(t);
    try { await audio.play(); } catch { /* blocked or unplayable: the error handler skips */ }
    paintBar();
    preloadSoon();
  }
  // What every new song needs on screen (whichever way it started).
  function songStarted(t) {
    setTimeout(saveSession, 0);
    if (!t.stream) setTimeout(() => { if (current === t) prefetchNext(); }, 0);
    lfStart(t);
    stream = null;
    if (!yt || yt.forPath !== vKey(t)) { yt = null; ytBusy = null; ytv.removeAttribute('src'); ytv.load(); }
    if (!loop || loop.forPath !== loopKey(t)) { loop = null; loopBusy = false; }
    wave = null;
    drawWave(true);
    if (!t.stream) loadWave(t);
    showBar();
    paintNow();
    // A song from the Music Downloader: looked up once it's downloaded (its own artist and details
    // then known), unless that's done already (fetched ahead).
    if (!t.stream || t.detailsIn) loadLyrics(t);
    else { const box = $('lp-lyrics'); box.textContent = ''; lrc = null; box.append(el('p', 'lp-nolyr', 'Lyrics once the song is here…')); }
    mediaMeta(t);
    dcPush();
    if (t.stream && videoOn && !(yt && yt.forPath === vKey(t))) loadYt(t); // its music video, with Video on
  }

  // ---------- Discord (main.js shows it, if Settings → Discord is on) ----------
  // The song, where it is and whether it plays; sent when any of that changes (main.js works out the bar).
  let dcTimer = null;
  function dcPush() {
    clearTimeout(dcTimer);
    dcTimer = setTimeout(() => {
      if (!window.api.discordSong) return;
      const t = current;
      if (!t || guest) { window.api.discordSong(null); return; }
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(t.duration) || 0;
      window.api.discordSong({ title: t.title || '', artist: t.artist || '', album: t.album || '', year: Number(t.year) || 0, duration: d, position: audio.currentTime || 0, playing: !audio.paused,
        rate: audio.playbackRate || 1, stream: !!t.stream, url: t.url || '', art: [t.art, t.thumbnail].find((u) => /^https:/i.test(u || '')) || '' });
    }, 400);
  }
  for (const ev of ['playing', 'pause', 'seeked', 'ratechange', 'durationchange']) onMedia(ev, dcPush);

  // ---------- Last.fm ----------
  // "Now playing" when a song starts playing; a scrobble once you've heard half of it or 4 minutes
  // (counting only time actually played, not skipped over). main.js / lastfm.js do the sending.
  let lf = { t: null, started: 0, played: 0, last: null, done: false, told: false };
  const lfInfo = (t) => ({ title: t.title, artist: t.artist, albumArtist: t.albumArtist, album: t.album, duration: audio.duration || t.duration });
  // ---------- Your plays (for Nabbit Home) ----------
  // A song counts once it has played as long as a scrobble needs (half of it, or 4 minutes). Kept on this
  // PC: { key: { n, last, hits: [day…] (the last 60), item } }; key = p:<path> or u:<url>. item is what's
  // needed to play a streamed song again (your own files are looked up in the library).
  const PLAYS = 'nabbit.plays';
  let plays = {};
  try { plays = JSON.parse(localStorage.getItem(PLAYS) || '{}') || {}; } catch { plays = {}; }
  let playsTimer = null;
  function logPlay(t) {
    if (!t || (!t.path && !t.url)) return;
    const key = t.stream ? `u:${t.url}` : `p:${t.path}`;
    const o = plays[key] || { n: 0, hits: [] };
    const day = Math.floor(Date.now() / 86400000);
    o.n++; o.last = Date.now();
    o.hits = [...(o.hits || []), day].slice(-60);
    if (t.stream) o.item = { url: t.url, title: t.title, artist: t.artist || '', album: t.album || '', thumbnail: t.thumbnail || t.art || null, duration: t.duration || 0 };
    plays[key] = o;
    const keys = Object.keys(plays);
    if (keys.length > 800) keys.sort((x, y) => plays[x].last - plays[y].last).slice(0, keys.length - 800).forEach((k) => delete plays[k]);
    clearTimeout(playsTimer);
    playsTimer = setTimeout(() => { try { localStorage.setItem(PLAYS, JSON.stringify(plays)); } catch { /* not kept */ } }, 500);
    document.dispatchEvent(new CustomEvent('nabbit-played'));
  }
  function lfStart(t) { lf = { t, started: 0, played: 0, last: null, done: false, told: false }; }
  onMedia('playing', () => {
    if (!current || lf.t !== current) return;
    if (!lf.started) lf.started = Math.floor(Date.now() / 1000);
    if (!lf.told && window.api.lastfmNow) { lf.told = true; window.api.lastfmNow(lfInfo(current)).catch(() => {}); }
  });
  onMedia('timeupdate', () => {
    if (!current || lf.t !== current) return;
    const now = audio.currentTime;
    if (lf.last != null && !audio.paused) { const d = now - lf.last; if (d > 0 && d < 2) lf.played += d; }
    lf.last = now;
    if (!lf.done && lf.started && PC.scrobbleDue(lf.played, audio.duration || current.duration)) {
      lf.done = true;
      logPlay(current);
      if (window.api.lastfmScrobble) window.api.lastfmScrobble(lfInfo(current), lf.started).catch(() => {});
    }
  });
  onMedia('seeked', () => { lf.last = audio.currentTime; });

  // ---------- DJ mode ----------
  // Songs blend into each other over a long crossfade: the next one starts on its first beat while the
  // playing one is on a bar line near its end, sped up or slowed down (pitch kept) to the same tempo and
  // held on the beat, then eased back to its own tempo once the old one has gone. When shuffling it can
  // pick the next song that goes best (tempo, and key on the Camelot wheel). Tempo, first beat, key and
  // where the sound starts and stops come from main.js (the Audio Tools' analyzer), once per song.
  const DJ_KEY = 'nabbit.lpDj';
  const dj = { on: false, fade: 12, match: true, pick: true, cut: true, cutBy: 'vocals', shift: false, lock: false, engine: 'auto', fx: 'auto' };
  // DJ mode's (and Speed's) key-shift engine, its own (Audio Tools' choice doesn't carry over): Auto is
  // WSOLA (punchy drums, natural voices: what works best in a mix).
  const DJ_ENGINES = [['auto', 'Auto (WSOLA)', 'WSOLA'], ['pro', 'Pro', 'Formants kept: voices stay natural (93 ms)'], ['wsola', 'WSOLA', 'Punchy drums, natural voices; dense mixes can double a little (93 ms)'], ['pv', 'Phase vocoder', 'Smooth, best on held notes (46 ms)']];
  const djEngine = () => (dj.engine === 'auto' || !DJ_ENGINES.some((x) => x[0] === dj.engine) ? 'wsola' : dj.engine);
  // A key shift is a sample-rate change, so it goes on the Speed slider (which then shows it).
  const semisOf = (f) => 12 * Math.log2(f);
  // The pitch shifter (pitch.js, in the effects worklet): key shifts with the tempo stretched separately.
  const shifterOK = () => !!(window.PlayerFx && window.PlayerFx.canPitch && window.PlayerFx.canPitch());
  const pitchLag = (el) => (window.PlayerFx && window.PlayerFx.pitchLatency ? window.PlayerFx.pitchLatency(el) : 0);
  try { Object.assign(dj, JSON.parse(localStorage.getItem(DJ_KEY) || '{}')); } catch { /* defaults */ }
  if (dj.fx === 'half' || dj.fx === 'triplet') dj.fx = 'auto'; // no longer offered
  const djSave = () => { try { localStorage.setItem(DJ_KEY, JSON.stringify(dj)); } catch { /* none */ } };
  const djInfo = new Map(); // path → analysis, a Promise while it's worked out, or false
  // Songs from the Music Downloader are analysed once they're whole on this PC (downloaded first, or
  // cached), by their stream key: the playing one's, or the next one's from fetching it ahead.
  const streamKeys = new Map(); // url → { key, src } from fetching ahead
  const djId = (t) => (t.stream ? `s:${t.url}` : t.path);
  const streamKeyOf = (t) => (t === current && stream ? stream.key : (streamKeys.get(t.url) || {}).key);
  function djGet(t) {
    if (!t || (!t.stream && !t.path) || !window.api.djAnalyze) return null;
    const id = djId(t);
    const v = djInfo.get(id);
    if (v === undefined) {
      const key = t.stream ? streamKeyOf(t) : null;
      if (t.stream && (!key || !window.api.djAnalyzeStream)) return null; // not fetched yet
      djInfo.set(id, (t.stream ? window.api.djAnalyzeStream(key) : window.api.djAnalyze(t.path))
        .then((r) => { djInfo.set(id, r || false); if (t === current || t === queue[qi + 1]) djPaint(); if (t === current) drawWave(true); return r; })
        // A streamed song still arriving: asked again once it's cached.
        .catch((e) => { if (t.stream && /not-ready/.test(String(e && e.message))) djInfo.delete(id); else djInfo.set(id, false); if (t === current) djPaint(); }));
      return null;
    }
    return v && !(v instanceof Promise) ? v : null;
  }
  // The analysis if it's done, without starting one.
  const djPeek = (t) => { if (!t || (!t.stream && !t.path)) return null; const v = djInfo.get(djId(t)); return v && !(v instanceof Promise) ? v : null; };
  const djPending = (t) => !!(t && (djInfo.get(djId(t)) instanceof Promise || (t.stream && streamFetching.has(t.url))));
  // Fetching a streamed song ahead (the Music Downloader's cache / temporary folder): → { key, src } or null.
  const streamFetching = new Map();
  function streamAhead(t) {
    if (streamKeys.has(t.url)) return Promise.resolve(streamKeys.get(t.url));
    if (!streamFetching.has(t.url)) {
      streamFetching.set(t.url, window.api.streamPrefetch(t.url, null)
        .then((r) => { if (r && r.key) { streamKeys.set(t.url, r); if (streamDetails(t, r.meta, r.art) && t === current) paintNow(); if (r.meta) t.detailsIn = true; djPaint(); } return r && r.key ? r : null; })
        .catch(() => null).finally(() => streamFetching.delete(t.url)));
    }
    return streamFetching.get(t.url);
  }
  const speedOn = () => $('lp-speed-on').checked;
  // When shuffling: move the best of the next few songs up to play next. 'wait' while they're still
  // being analysed (and there's time).
  const PICK_N = 20;
  function djPickNext() {
    if (!dj.pick || !shuffle || !current || qi + 2 >= queue.length) return null;
    const a = djGet(current);
    // Time left before the mix (its main part's end when cutting), less the crossfade and a margin.
    const act = a && dj.cut ? (a.action !== undefined ? a.action : (a.action = PC.actionSpan(a))) : null;
    const endAt = (act && act.end) || (a && a.end) || audio.duration || current.duration || 0;
    const time = endAt - audio.currentTime > dj.fade + 15;
    if (!a) return djPending(current) && time ? 'wait' : null;
    const cands = queue.slice(qi + 1, qi + 1 + PICK_N);
    const infos = cands.map((t) => djGet(t)); // streamed songs count once they've been fetched and analysed
    if (time && infos.some((x, k) => !x && djPending(cands[k]))) return 'wait';
    // Same key first (after its shift, with Shift into key on), then what fits best.
    const fitOf = (x, c) => PC.keyFit(x, semisOf(speedRate()), c, { shifter: !dj.lock || shifterOK(), stretch: stretchMax(), tempo: speedRate() * stretch });
    const best = dj.shift
      ? PC.pickNext(a, infos, (x, c) => { const f = fitOf(x, c); return f ? f.score : 99; }, (x, c) => { const f = fitOf(x, c); return f ? f.kd : null; })
      : PC.pickNext(a, infos);
    if (best > 0) { const [t] = queue.splice(qi + 1 + best, 1); queue.splice(qi + 1, 0, t); paintUpNext(); }
    return null;
  }
  // Reroll: the songs still to come, shuffled again (the ones played stay where they were). The song
  // loaded ahead is let go, so the pick is made again from the new next 20.
  function djReroll() {
    if (!current || qi + 1 >= queue.length) return;
    if (!shuffle) { shuffle = true; paintShuffle(); }
    const rest = queue.slice(qi + 1);
    for (let k = rest.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
    queue = [...queue.slice(0, qi + 1), ...rest];
    if (!mix) dropPre();
    paintUpNext();
    djPaint(); // starts analysing the new candidates
    preloadSoon();
  }
  // The mix playing now: { old (the player fading out), el, a, b, plan, t0, hist, noSync, timer }.
  let mix = null, glide = 0;
  // Cut to the action, from the lyrics: the first vocals or the first chorus (synced lyrics, from the
  // same places the lyrics panel looks), else where it gets loud. Lyrics for the next song are fetched
  // while it's loaded.
  const djLyrics = new Map(); // id → [{ t, text }] | false | Promise
  function djLyricsOf(t) {
    if (!t) return null;
    if (t === current && lrc) return lrc;
    const id = djId(t), v = djLyrics.get(id);
    if (v === undefined) {
      const ask = t.stream
        ? window.api.streamLyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration }).then((f) => (f && f.synced) || '')
        : window.api.libLyrics(t.path, { online: lyricsOnline() }).then((r) => (r && r.text) || '');
      djLyrics.set(id, ask.then((text) => { const L = text ? Core.parseLrc(text) : null; djLyrics.set(id, L || false); if (djPop) paintDjPop(); return L; })
        .catch(() => { djLyrics.set(id, false); }));
      return null;
    }
    return Array.isArray(v) ? v : null;
  }
  // x with its action worked out (x.action: { start, end, by: 'lyrics' | 'loud' } or null).
  function withAction(t, x) {
    if (!x || !dj.cut) return x;
    const loud = PC.actionSpan(x);
    let ly = null;
    if (dj.cutBy !== 'loud') { const L = djLyricsOf(t); if (L) ly = PC.lyricsSpan(L, x, dj.cutBy); }
    const start = ly && ly.start != null ? ly.start : loud ? loud.start : null;
    const end = ly && ly.end != null ? ly.end : loud ? loud.end : null;
    return { ...x, action: start == null && end == null ? null : { start, end, by: ly ? 'lyrics' : 'loud' } };
  }
  function planFor() {
    const a = withAction(current, djGet(current)) || { duration: audio.duration }, b = withAction(pre.t, djGet(pre.t)) || {};
    if (!a.duration) a.duration = audio.duration;
    const fit = dj.shift && a.camelot && b.camelot ? PC.keyFit(a, semisOf(speedRate()), b, { shifter: !dj.lock || shifterOK(), stretch: stretchMax(), tempo: speedRate() * stretch }) : null;
    // The next song in its own key, its tempo matched with the pitch kept (whatever Speed is at): keyFit's
    // ratio (the songs' tempos) on top of the speed the outgoing one plays at.
    if (fit && fit.stretch) return { ...PC.mixPlan(a, b, { fade: dj.fade, match: true, cut: dj.cut, fit }), stretch: true };
    // Shifted for the key, its tempo matched on Stretch (within ±3 %, or ±8 % with Key lock).
    const plan = PC.mixPlan(a, b, { fade: dj.fade, match: dj.match, cut: dj.cut, fit, max: stretchMax() });
    return fit && fit.shifter ? { ...plan, shifter: true } : plan;
  }
  // Called while a song plays with the next one loaded: true when DJ mode takes care of the change.
  function checkMix() {
    if (mix || repeat === 'one' || !window.PlayerFx || !window.PlayerFx.fade || !window.PlayerFx.routed() || !Number.isFinite(audio.duration)) return false;
    const plan = planFor();
    if (plan.len < 1.5) return false; // too short to mix: the usual gapless change
    // Where the next song starts: set on its player ahead of time (so it's loaded from there).
    if (pre.el.readyState >= 1 && pre.at !== plan.inAt) { pre.at = plan.inAt; try { pre.el.currentTime = plan.inAt; } catch { pre.at = null; } }
    if (audio.currentTime < plan.outAt) return true;
    if (pre.el.readyState < 3 || pre.at !== plan.inAt) return audio.duration - audio.currentTime > 0.2; // not ready yet; at the very end, just change
    startMix(plan);
    return true;
  }
  // ---------- Speed × Stretch ----------
  // Speed (the play bar) is a sample-rate change: tempo and pitch together. Stretch (the DJ pop-up) is
  // tempo only, pitch kept. A song plays at Speed × Stretch, at Speed's pitch: with only one of them
  // away from 100 % the player does it alone; with both, it stretches (pitch kept) and the pitch shifter
  // (pitch.js) moves the pitch by Speed. Without the shifter, both together play like a record.
  // DJ mode puts a key shift on Speed and its tempo matching on Stretch, then eases Stretch back to 100 %.
  let stretch = 1; // the playing song's
  const away = (x) => Math.abs(x - 1) > 1e-4;
  // Stretch is like a turntable's pitch fader (a plain rate change: pitch follows, the same clean sound as
  // normal playback) unless Key lock is on (tempo only, pitch kept: the browser's time-stretch, and the
  // pitch shifter when Speed is away from 100 % too).
  const stretchMax = () => (dj.lock ? 0.08 : 0.03);
  const elRate = new Map(); // player → [speed, stretch] last set
  function setRate(el, speed, str) {
    elRate.set(el, [speed, str]);
    if (window.PlayerFx && window.PlayerFx.useAlgo) window.PlayerFx.useAlgo(el, djEngine());
    if (!dj.lock) {
      if (window.PlayerFx && window.PlayerFx.pitchOn && window.PlayerFx.pitchOn(el)) window.PlayerFx.pitch(el, null, { dip: !el.paused && !mix });
      el.preservesPitch = false;
      el.playbackRate = speed * str;
      return;
    }
    const useShifter = away(speed) && away(str) && shifterOK();
    const on = !!(window.PlayerFx && window.PlayerFx.pitchOn && window.PlayerFx.pitchOn(el));
    // The shifter's delay comes or goes with it: a short dip if it can be heard (not during a mix's fades).
    if (useShifter !== on) window.PlayerFx.pitch(el, useShifter ? speed : null, { dip: !el.paused && !mix });
    else if (useShifter) window.PlayerFx.pitch(el, speed);
    el.preservesPitch = away(str) && (!away(speed) || useShifter);
    el.playbackRate = speed * str;
  }
  function paintStretch() {
    if (!djPop) return;
    const sl = djPop.querySelector('.lp-dj-str');
    if (sl && document.activeElement !== sl) sl.value = String(Math.round((stretch - 1) * 1000) / 10);
    const v = djPop.querySelector('.lp-dj-strv');
    if (v) v.textContent = `${Math.round(stretch * 1000) / 10} %`;
  }
  // Stretch by hand (the DJ pop-up), or back to 100 % after a mix.
  let stretchGlide = 0;
  function setStretch(v) {
    stretch = Math.max(0.5, Math.min(2, v));
    if (mix && mix.el === audio) { mix.toStretch = stretch; setRate(audio, mix.toSpeed, stretch); } else setRate(audio, speedRate(), stretch);
    paintStretch();
    djPaint();
  }
  // DJ mode's transition effects (the time shaper on the outgoing song, pitch.js SHAPES):
  const DJ_FX = [['auto', 'Auto', 'A brake when the beats can\'t be held, else a plain crossfade'], ['off', 'None', 'A plain crossfade'], ['brake', 'Brake', 'A tape stop over the last bar, then gone'],
    ['stutter', 'Stutter', 'A beat roll on the outgoing song from the bar past halfway']];
  const FX_SHAPE = { brake: 'tapestop', stutter: 'stutter' };
  // The effect for this mix: { kind, rt: { shape, bpm, offset, from, once }, len (s of the song) }, or null.
  // From the song's own grid (Audio Tools → Beat grid) when you set one, else the analysis.
  function djFxPlan(plan, t, a, t0) {
    let kind = dj.fx;
    if (kind === 'auto') kind = plan.matched ? 'off' : 'brake';
    const P = window.NabbitPitch;
    if (!FX_SHAPE[kind] || !P || !P.SHAPES || !t) return null;
    const own = !t.stream && t.path ? gridOf(t.path) : null;
    const g = own ? { bpm: own.bpm, offset: own.offset || 0 } : a && a.bpm > 0 ? { bpm: a.bpm, offset: a.offset || 0 } : null;
    if (!g) return null;
    const beat = 60 / g.bpm, bar = 4 * beat, end = t0 + plan.len;
    const onGrid = (x, step, up) => g.offset + (up ? Math.ceil((x - g.offset) / step - 1e-6) : Math.floor((x - g.offset) / step + 1e-6)) * step;
    const shape = JSON.parse(JSON.stringify(P.SHAPES[FX_SHAPE[kind]]));
    if (kind === 'brake') {
      // The last bar (or as many beats as the mix has), stopping as the mix ends.
      const beats = Math.max(1, Math.min(4, Math.floor(plan.len / beat)));
      shape.cycle = beats;
      let from = onGrid(end - beats * beat, beat, false);
      if (from < t0) from = onGrid(t0, beat, true);
      return { kind, len: beats * beat, rt: { shape, bpm: g.bpm, offset: g.offset, from, once: true } };
    }
    // From the first bar line past halfway (or the first one at all when the mix is short).
    let from = onGrid(t0 + plan.len / 2, bar, true);
    if (from + bar > end) from = onGrid(t0, beat, true);
    if (from >= end) return null;
    return { kind, len: end - from, rt: { shape, bpm: g.bpm, offset: g.offset, from, once: false } };
  }
  function startMix(plan) {
    const old = audio, el = pre.el, a = djGet(current), b = djGet(pre.t);
    clearInterval(glide);
    clearInterval(stretchGlide);
    const aRate = speedRate() * stretch; // the outgoing song's tempo factor (it stays there)
    window.PlayerFx.level(el, 0);
    const real = plan.len / aRate; // the plan is in the songs' own time
    window.PlayerFx.fade(el, 'in', real);
    // A transition effect on the outgoing song (on its beat grid): a brake plays out at full level, then
    // goes; the others come in halfway through the crossfade.
    const fxp = djFxPlan(plan, current, a, old.currentTime);
    if (fxp && window.PlayerFx.timeShape && window.PlayerFx.timeShape(old, fxp.rt)) {
      if (fxp.kind === 'brake') window.PlayerFx.fade(old, 'out', Math.max(0.05, fxp.len / aRate), Math.max(0, (fxp.rt.from - old.currentTime) / aRate));
      else window.PlayerFx.fade(old, 'out', real);
    } else window.PlayerFx.fade(old, 'out', real);
    // The new song: Speed at its key shift (or where Speed is), Stretch for the rest of the tempo.
    const toSpeed = plan.fitted ? 2 ** (plan.shift / 12) : speedRate();
    const tempo = plan.matched ? aRate * plan.rate : toSpeed; // held on the beat, or at its own speed
    mix = { old, el, a, b, plan, t0: old.currentTime, hist: [], noSync: false, timer: 0, aRate, toSpeed, toStretch: tempo / toSpeed };
    handover(plan);
    mix.timer = setInterval(mixTick, 100);
    djPaint();
  }
  function mixTick() {
    if (!mix) return;
    const { old, el, plan, a, b } = mix;
    if (el !== audio) { cancelMix(); return; }
    if (old.ended || old.currentTime - mix.t0 >= plan.len - 0.05) { endMix(); return; }
    if (old.paused || el.paused || !plan.matched || !a || !b || mix.noSync) return;
    // Hold the beats together with small speed changes (from the last three readings): firm while the
    // new song is still quiet (it starts a little late), gentle after.
    // Where each is heard (a shifter's delay taken off).
    const err = PC.beatPhaseError(a, old.currentTime - pitchLag(old) * old.playbackRate, b, el.currentTime - pitchLag(el) * el.playbackRate, plan.mult); // in beats; + = ahead
    const hist = mix.hist || (mix.hist = []);
    hist.push(err);
    if (hist.length > 3) hist.shift();
    const e = hist.reduce((x, y) => x + y, 0) / hist.length;
    const beatB = 60 / (b.bpm * plan.mult); // seconds of the new song per beat
    const early = old.currentTime - mix.t0 < 3, lim = early ? 0.08 : 0.02, gain = early ? 1.2 : 0.6;
    const adj = Math.abs(e) < 0.02 ? 0 : Math.max(-lim, Math.min(lim, -e * beatB * gain));
    const r = mix.toSpeed * mix.toStretch * (1 + adj);
    if (Math.abs(el.playbackRate - r) > 0.0005) el.playbackRate = r;
  }
  const letGo = (m) => { if (m && m.heldKey && window.api.streamHold) window.api.streamHold(m.heldKey, false).catch(() => {}); };
  function endMix() {
    if (!mix) return;
    const { old, el } = mix;
    letGo(mix);
    clearInterval(mix.timer);
    mix = null;
    if (window.PlayerFx && window.PlayerFx.timeShape) window.PlayerFx.timeShape(old, null);
    old.pause();
    old.removeAttribute('src');
    old.load();
    window.PlayerFx.level(old, 1);
    if (el === audio) {
      window.PlayerFx.level(el, 1);
      // Stretch back to 100 % (the song at its own tempo, at the Speed setting), gently: a quarter of a
      // percent every tenth of a second.
      easeStretch(el);
    }
    djPaint();
    preloadSoon();
  }
  function easeStretch(el) {
    clearInterval(stretchGlide);
    if (!away(stretch)) { applySpeed(); return; }
    stretchGlide = setInterval(() => {
      if (el !== audio || mix) { clearInterval(stretchGlide); return; }
      if (el.paused) return;
      const step = 0.0025;
      if (Math.abs(stretch - 1) <= step) { clearInterval(stretchGlide); setStretch(1); return; }
      setStretch(stretch + (stretch < 1 ? step : -step));
    }, 100);
  }
  // Stopped part-way (another song chosen, the player closed, DJ mode off): the old one stops now.
  function cancelMix() {
    clearInterval(glide);
    if (!mix) return;
    const { old, el } = mix;
    letGo(mix);
    clearInterval(mix.timer);
    mix = null;
    if (old !== audio && window.PlayerFx && window.PlayerFx.timeShape) window.PlayerFx.timeShape(old, null);
    if (old !== audio) { old.pause(); old.removeAttribute('src'); old.load(); }
    if (window.PlayerFx && window.PlayerFx.level) { window.PlayerFx.level(old, 1); window.PlayerFx.level(el, 1); }
    if (el === audio) applySpeed();
  }
  // Next (button, Shift + →, media key) in DJ mode: the playing song jumps to where its crossfade
  // starts, so the mix plays out; pressed again during a mix, the mix finishes at once. Without the
  // next song ready to mix (streamed, too short, …) it's the usual change.
  let skipping = 0;
  function skipNext() {
    if (!dj.on || !current || repeat === 'one' || !queue[qi + 1] || !window.PlayerFx || !window.PlayerFx.fade) { next(); return; }
    if (mix) { endMix(); return; }
    const seq = loadSeq;
    const go = () => {
      if (seq !== loadSeq || mix) return;
      if (!pre || pre.i !== qi + 1 || (!current.stream && !pre.t.stream && !PC.canGapless(current, pre.t, { videoShown: videoOn }))) { next(); return; }
      const plan = planFor();
      if (plan.len < 1.5) { next(); return; }
      if (audio.currentTime < plan.outAt - 0.05) seekTo(plan.outAt - 0.05);
      if (audio.paused) audio.play().catch(() => {});
      // If the next song isn't loaded in a few seconds, change the usual way.
      clearTimeout(skipping);
      skipping = setTimeout(() => { if (seq === loadSeq && !mix && current && audio.currentTime >= plan.outAt - 0.1) next(); }, 4000);
    };
    if (pre && pre.i === qi + 1) { go(); return; }
    clearTimeout(preTimer);
    Promise.resolve(preloadNext()).then(go, () => next());
  }
  // Pausing pauses both; seeking in the new song stops holding the beat.
  onMedia('pause', () => { if (mix && !mix.old.paused) mix.old.pause(); });
  onMedia('play', () => { if (mix && mix.old.paused) mix.old.play().catch(() => {}); });
  onMedia('seeking', () => { if (mix) mix.noSync = true; });
  function setDj(on) {
    dj.on = !!on;
    djSave();
    if (!dj.on) cancelMix();
    else if (current) { djGet(current); if (queue[qi + 1]) djGet(queue[qi + 1]); if (pre) { dropPre(); preloadSoon(); } }
    djPaint();
    toast(dj.on ? `DJ mode on · ${dj.fade} s crossfades` : 'DJ mode off');
  }
  // "128 BPM · 8A · A minor"; at another speed (rate), the tempo you hear with the song's own in
  // brackets, and on a whole semitone the key you hear and the semitones.
  const djTag = (x, rate = speedRate() * stretch, pitchRate = dj.lock ? speedRate() : speedRate() * stretch) => {
    if (!x) return '';
    const bpm = x.bpm ? Math.round(x.bpm * rate * 10) / 10 : 0, sm = semisOf(pitchRate);
    const st = Math.abs(sm - Math.round(sm)) < 0.03 ? Math.round(sm) : 0;
    const cam = st ? PC.shiftCamelot(x.camelot, st) : x.camelot;
    const key = cam ? `${cam} · ${st ? PC.CAMELOT_KEYS[cam] || '' : x.key}` : '';
    return [bpm ? `${bpm} BPM${Math.abs(rate - 1) > 0.0005 ? ` (${Math.round(x.bpm * 10) / 10})` : ''}` : '', key, st ? `${st > 0 ? '+' : ''}${st} st` : ''].filter(Boolean).join(' · ');
  };
  // The Speed slider glides to a key shift's speed (switched on for it; off again when a later shift
  // brings it back to 100 % and DJ mode had switched it on).
  let speedAnim = 0, djSpeedOn = false;
  function glideSpeed(rate, ms = 900) {
    cancelAnimationFrame(speedAnim);
    const box = $('lp-speed-on'), sl = $('lp-speed');
    const from = speedRate(), to = Math.max(0.5, Math.min(4, rate));
    if (Math.abs(from - to) < 0.0005) return;
    if (!box.checked) { box.checked = true; djSpeedOn = true; sl.value = '0'; }
    const t0 = performance.now(), p0 = (from - 1) * 100, p1 = (to - 1) * 100;
    const step = (t) => {
      const x = Math.min(1, (t - t0) / ms), e = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
      sl.value = String(p0 + (p1 - p0) * e);
      paintSpeed();
      if (x < 1) { speedAnim = requestAnimationFrame(step); return; }
      sl.value = String(p1);
      if (Math.abs(p1) < 0.05 && djSpeedOn) { box.checked = false; djSpeedOn = false; }
      paintSpeed();
      saveSpeed();
      if (!mix) applySpeed();
      djPaint();
    };
    speedAnim = requestAnimationFrame(step);
  }
  function djPaint() {
    const b = $('lp-dj');
    b.classList.toggle('on', dj.on);
    b.setAttribute('aria-pressed', String(dj.on));
    // The playing song's tempo and key, DJ mode on or off (as it's heard: Speed and pitch included).
    const line = $('lp-np-dj');
    if (current) {
      const a = djGet(current);
      // Mixing in: the tempo it's held at (stretched to the outgoing song's), and the key it's shifted to.
      line.textContent = mix ? `Mixing in${a ? ` · ${djTag(a, mix.toSpeed * mix.toStretch, mix.toSpeed)}` : ''}`
        : a ? djTag(a) : djPending(current) ? 'Finding the tempo and key…' : '';
      // DJ mode: the songs it may pick from are analysed ahead (main.js does one at a time).
      if (dj.on) for (const t of queue.slice(qi + 1, qi + 1 + (dj.pick && shuffle ? PICK_N : 1))) djGet(t);
    } else line.textContent = '';
    line.classList.toggle('hidden', !line.textContent);
    if (djPop) paintDjPop();
  }
  // The DJ button: a pop-up with on / off, the crossfade's length, matching and picking. D toggles.
  let djPop = null;
  function paintDjPop() {
    const p = djPop;
    p.querySelector('.lp-dj-on').checked = dj.on;
    p.querySelector('.lp-dj-len').value = String(dj.fade);
    paintStretch();
    p.querySelector('.lp-dj-lenv').textContent = `${dj.fade} s`;
    p.querySelector('.lp-dj-match').checked = dj.match;
    p.querySelector('.lp-dj-pick').checked = dj.pick;
    p.querySelector('.lp-dj-cut').checked = dj.cut;
    p.querySelector('.lp-dj-lock').checked = dj.lock;
    p.querySelector('.lp-dj-cutby').value = dj.cutBy;
    p.querySelector('.lp-dj-cutby').disabled = !dj.cut;
    p.querySelector('.lp-dj-shift').checked = dj.shift;
    p.querySelector('.lp-dj-fx').value = dj.fx;
    p.querySelector('.lp-dj-eng').value = dj.engine;
    const st = p.querySelector('.lp-dj-st');
    st.textContent = '';
    // Label | value rows; a row without a label continues the one above.
    const row = (k, v, cls = '') => { st.append(el('span', 'k', k), el('span', `v${cls ? ` ${cls}` : ''}`, v)); };
    const keyOf = (cam, name) => (cam ? `${cam} ${name || PC.CAMELOT_KEYS[cam] || ''}`.trim() : '');
    const bpmOf = (x) => `${Math.round(x * 10) / 10} BPM`;
    const sgn = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
    // The tempo and key you hear (a shift on Speed included), else why there's none.
    const heard = (t, x, rate, pitchRate = rate) => {
      if (!x) return djPending(t) ? (t.stream ? 'Fetching and analysing…' : 'Analysing…') : t.stream ? 'Analysed once fetched' : '—';
      const sm = semisOf(pitchRate), st1 = Math.abs(sm - Math.round(sm)) < 0.03 ? Math.round(sm) : 0;
      const cam = st1 ? PC.shiftCamelot(x.camelot, st1) : x.camelot;
      return [x.bpm ? bpmOf(x.bpm * rate) : '', keyOf(cam, st1 ? '' : x.key), st1 ? `${sgn(st1)} st` : ''].filter(Boolean).join(' · ');
    };
    if (!dj.on) { row('', 'Off: songs change without a gap.', 'dim'); return; }
    if (!current) { row('', 'Play something to start mixing.', 'dim'); return; }
    const a = djGet(current), nx = queue[qi + 1], b = nx ? djGet(nx) : null;
    row('Now', heard(current, a, speedRate() * stretch, dj.lock ? speedRate() : speedRate() * stretch));
    if (!nx) return;
    row('Next', heard(nx, b, 1)); // as recorded
    if (!a || !b) return;
    const fit = dj.shift && a.camelot && b.camelot ? PC.keyFit(a, semisOf(speedRate()), b, { shifter: !dj.lock || shifterOK(), stretch: stretchMax(), tempo: speedRate() * stretch }) : null;
    const aa = withAction(current, a), bb = withAction(nx, b);
    const pl = PC.mixPlan(aa, bb, { fade: dj.fade, match: dj.match, cut: dj.cut, fit });
    const keyWord = (kd) => (kd == null ? '' : kd === 0 ? 'same key' : kd === 1 ? 'keys fit' : 'keys clash');
    if (fit) {
      const r = 2 ** (fit.k / 12);
      const tempo = fit.matched ? bpmOf(a.bpm * speedRate() * stretch) : bpmOf(b.bpm * r);
      row('', fit.k ? `→ ${sgn(fit.k)} st: ${tempo} · ${keyOf(fit.camelot)}` : `→ its own key: ${keyOf(fit.camelot)}`, 'hi');
      // The Stretch it'll take: its tempo (the playing song's) over its key shift's speed.
      const str = fit.matched ? (fit.rel * speedRate() * stretch) / r : 1;
      row('', [keyWord(fit.kd), fit.matched ? `beats held · Stretch ${Math.round(str * 1000) / 10} %` : 'tempos apart, so no beat match'].filter(Boolean).join(' · '), 'dim');
    } else {
      const tm = dj.match ? PC.tempoMatch(a, b, stretchMax()) : null;
      const tempo = tm ? `tempo matched${Math.abs(tm.rate - 1) > 0.001 ? ` (${Math.round(tm.rate * 1000) / 10} %)` : ''}` : !dj.match ? 'crossfade only' : 'tempos too far apart to match';
      row('', [tempo, keyWord(PC.camelotDist(a.camelot, b.camelot))].filter(Boolean).join(' · '), 'dim');
    }
    const fxk = dj.fx === 'auto' ? (pl.matched ? 'off' : 'brake') : dj.fx;
    const fxName = { brake: 'brake', stutter: 'stutter' }[fxk];
    row('Mix', `at ${fmtTime(pl.outAt)}${pl.cutOut ? ` · skips ${fmtTime(pl.cutOut)} of outro` : ''}${fxName ? ` · goes out ${fxName}` : ''}`);
    const by = bb && bb.action && bb.action.by === 'lyrics' ? (dj.cutBy === 'chorus' ? 'the chorus' : 'the vocals') : 'the action';
    row('', `next from ${fmtTime(pl.inAt)}${pl.cutIn ? ` · straight to ${by}` : dj.cut && !pl.matched ? ' · its intro (beats not matched)' : ''}`, 'dim');
    if (dj.cut && dj.cutBy !== 'loud' && nx && !djLyricsOf(nx)) djLyricsOf(nx);
  }
  function toggleDjPop() {
    if (djPop) { closeDjPop(); return; }
    const p = el('div', 'lp-dj-pop');
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'DJ mode');
    p.innerHTML = `<label class="lp-dj-row head"><input type="checkbox" class="lp-dj-on"> <b>DJ mode</b><span class="k">D</span></label>
      <label class="lp-dj-row col"><span>Crossfade <em class="lp-dj-lenv"></em></span><input type="range" class="lp-dj-len" min="2" max="32" step="1" aria-label="Crossfade length"></label>
      <label class="lp-dj-row col"><span>Stretch <em class="lp-dj-strv"></em></span><input type="range" class="lp-dj-str" min="-30" max="30" step="0.1" aria-label="Stretch: the playing song's tempo" title="The playing song's tempo, on top of Speed (Speed is left alone). DJ mode sets it to match a song's tempo. Double-click: 100 %"></label>
      <label class="lp-dj-row"><input type="checkbox" class="lp-dj-lock"> Key lock: Stretch keeps the pitch (else it's like a turntable: cleanest sound, pitch follows; matches within ±3 %)</label>
      <label class="lp-dj-row"><input type="checkbox" class="lp-dj-match"> Match the tempo and beats (on Stretch)</label>
      <label class="lp-dj-row"><input type="checkbox" class="lp-dj-shift"> Shift the next song into key (−5 to +8 semitones, on Speed)</label>
      <label class="lp-dj-row"><input type="checkbox" class="lp-dj-cut"> Cut to the action (skip long intros and outros)</label>
      <label class="lp-dj-row sub">Go straight to <select class="lp-dj-cutby" aria-label="Cut to"><option value="vocals">the first vocals</option><option value="chorus">the first chorus</option><option value="loud">where it gets loud</option></select></label>
      <label class="lp-dj-row sel">Transition <select class="lp-dj-fx" aria-label="Transition effect">${DJ_FX.map(([v, t, tip]) => `<option value="${v}" title="${tip}">${t}</option>`).join('')}</select></label>
      <label class="lp-dj-row sel">Key shift <select class="lp-dj-eng" aria-label="Key-shift engine">${DJ_ENGINES.map(([v, t, tip]) => `<option value="${v}" title="${tip}">${t}</option>`).join('')}</select></label>
      <label class="lp-dj-row"><input type="checkbox" class="lp-dj-pick"> When shuffling, play next what goes best (tempo and key)</label>
      <button type="button" class="lp-dj-reroll" title="Shuffle the songs still to come (turns Shuffle on); with the option above on, the best of the new next 20 plays next.">⟳ Reroll the queue</button>
      <div class="lp-dj-st"></div>`;
    p.querySelector('.lp-dj-on').addEventListener('change', (e) => setDj(e.target.checked));
    p.querySelector('.lp-dj-len').addEventListener('input', (e) => { dj.fade = Number(e.target.value); djSave(); paintDjPop(); });
    const strSl = p.querySelector('.lp-dj-str');
    strSl.addEventListener('input', () => { clearInterval(stretchGlide); setStretch(1 + Number(strSl.value) / 100); });
    strSl.addEventListener('dblclick', () => { clearInterval(stretchGlide); strSl.value = '0'; setStretch(1); });
    p.querySelector('.lp-dj-match').addEventListener('change', (e) => { dj.match = e.target.checked; djSave(); paintDjPop(); });
    p.querySelector('.lp-dj-pick').addEventListener('change', (e) => { dj.pick = e.target.checked; djSave(); paintDjPop(); });
    p.querySelector('.lp-dj-cut').addEventListener('change', (e) => { dj.cut = e.target.checked; djSave(); paintDjPop(); });
    p.querySelector('.lp-dj-lock').addEventListener('change', (e) => {
      dj.lock = e.target.checked;
      djSave();
      if (mix && mix.el === audio) setRate(audio, mix.toSpeed, mix.toStretch); else setRate(audio, speedRate(), stretch);
      paintDjPop();
      djPaint();
    });
    p.querySelector('.lp-dj-reroll').addEventListener('click', djReroll);
    p.querySelector('.lp-dj-cutby').addEventListener('change', (e) => { dj.cutBy = ['vocals', 'chorus', 'loud'].includes(e.target.value) ? e.target.value : 'vocals'; djSave(); paintDjPop(); });
    p.querySelector('.lp-dj-shift').addEventListener('change', (e) => { dj.shift = e.target.checked; djSave(); paintDjPop(); });
    const reRate = () => { for (const [m, args] of elRate) if (m === audio || (mix && m === mix.el)) setRate(m, ...args); };
    p.querySelector('.lp-dj-fx').addEventListener('change', (e) => { dj.fx = DJ_FX.some((x) => x[0] === e.target.value) ? e.target.value : 'auto'; djSave(); paintDjPop(); });
    p.querySelector('.lp-dj-eng').addEventListener('change', (e) => { dj.engine = DJ_ENGINES.some((x) => x[0] === e.target.value) ? e.target.value : 'auto'; djSave(); reRate(); paintDjPop(); });
    document.body.append(p);
    djPop = p;
    paintDjPop();
    const r = $('lp-dj').getBoundingClientRect();
    p.style.left = `${Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.left + r.width / 2 - p.offsetWidth / 2))}px`;
    p.style.bottom = `${window.innerHeight - r.top + 8}px`;
    $('lp-dj').setAttribute('aria-expanded', 'true');
    p.querySelector('.lp-dj-on').focus();
  }
  function closeDjPop() { if (!djPop) return; djPop.remove(); djPop = null; $('lp-dj').setAttribute('aria-expanded', 'false'); }
  $('lp-dj').addEventListener('click', toggleDjPop);
  document.addEventListener('mousedown', (e) => { if (djPop && !e.target.closest('.lp-dj-pop, #lp-dj')) closeDjPop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && djPop) { e.stopPropagation(); closeDjPop(); $('lp-dj').focus(); } }, true);
  djPaint();

  // ---------- Gapless ----------
  // A few seconds into a song, the next one (your own file, no video showing) is loaded on the other
  // player; within a screen frame of the end it starts there and this one stops.
  let pre = null, preTimer = 0; // { el, t, i }
  const idleEl = () => mediaEls.find((m) => m !== audio);
  function dropPre() {
    clearTimeout(preTimer);
    if (!pre) return;
    const el = pre.el;
    pre = null;
    if (el !== audio) { el.removeAttribute('src'); el.load(); }
  }
  function preloadSoon() { clearTimeout(preTimer); preTimer = setTimeout(preloadNext, 3000); }
  async function preloadNext() {
    if (mix) { preloadSoon(); return; } // the other player is still fading out
    if (dj.on && djPickNext() === 'wait') { preloadSoon(); return; }
    const i = qi + 1, t = queue[i];
    if (pre && pre.i === i && pre.t === t) return;
    dropPre();
    if (repeat === 'one' || !t) return;
    // Songs from the Music Downloader (playing or next) are mixed in DJ mode, from their fetched copy.
    const streamy = !!(current && current.stream) || !!t.stream;
    if (streamy) { if (!dj.on || videoOn || t.playable === false || !window.PlayerFx || !window.PlayerFx.routed()) return; }
    else if (!PC.canGapless(current, t, { videoShown: videoOn }) || videoFor(t)) return;
    const el = idleEl(), seq = loadSeq;
    let url = null, skey = null;
    if (t.stream) {
      const r = await streamAhead(t);
      if (!r || !r.src) return;
      url = r.src;
      skey = r.key;
    } else if (window.PlayerFx && window.PlayerFx.routed()) url = await window.api.mediaUrl(t.path).catch(() => null);
    if (seq !== loadSeq || queue[i] !== t || mix) return;
    if (url) el.crossOrigin = 'anonymous'; else { el.removeAttribute('crossorigin'); url = fileUrl(t.path); }
    el.src = url;
    el.load();
    if (window.PlayerFx && window.PlayerFx.level) { window.PlayerFx.level(el, 1); window.PlayerFx.pitch(el, null); }
    pre = { el, t, i, skey };
    if (dj.on) { djGet(t); if (dj.cut && dj.cutBy !== 'loud') djLyricsOf(t); }
  }
  // A preloaded song that won't play is forgotten (it'll load the usual way).
  for (const m of mediaEls) m.addEventListener('error', () => { if (pre && pre.el === m && m !== audio) dropPre(); });
  function checkHandover() {
    if (!pre || audio.paused || seeking || !current || (current.stream && !dj.on)) return;
    if (dj.on && checkMix()) return;
    if (pre.el.readyState < 3) return;
    if (PC.handoverDue(audio.currentTime, audio.duration, 0.035 * (audio.playbackRate || 1))) handover();
  }
  function handover(mixing = null) {
    const old = audio, { el, t, i, skey } = pre;
    if (!mixing) { stretch = 1; clearInterval(stretchGlide); }
    const oldKey = current && current.stream && stream ? stream.key : null;
    pre = null;
    clearTimeout(preTimer);
    loadSeq++;
    el.muted = old.muted;
    el.volume = old.volume;
    audio = el;
    old.classList.remove('active');
    el.classList.add('active');
    if (window.PlayerFx && window.PlayerFx.setActive) window.PlayerFx.setActive(el);
    // A plain change: at the Speed setting. In a DJ mix: Speed at its key shift, Stretch for its tempo.
    if (!mixing || !mix) applySpeed();
    else {
      // Still silent: its rate (and the shifter, if it needs it) set; the sliders glide to show it.
      stretch = mix.toStretch;
      setRate(el, mix.toSpeed, mix.toStretch);
      if (mix.plan.fitted) glideSpeed(mix.toSpeed);
      paintStretch();
    }
    el.play().catch(() => {});
    // The old one stops a moment later (its last few milliseconds overlap rather than leave a gap);
    // in a DJ mix it plays on, fading out.
    if (!mixing) setTimeout(() => { if (old !== audio) { old.pause(); old.removeAttribute('src'); old.load(); } }, 80);
    qi = i;
    current = t;
    curSrc = t.stream ? el.src : t.path;
    songStarted(t);
    // A song from the Music Downloader: playing from its fetched copy (whole on this PC). The one before
    // keeps its file while the mix still plays it.
    if (window.api.streamAdopt && (t.stream || oldKey)) {
      if (oldKey && mixing) { window.api.streamHold(oldKey, true).catch(() => {}); if (mix) mix.heldKey = oldKey; }
      window.api.streamAdopt(t.stream ? skey : null).catch(() => {});
    }
    if (t.stream) {
      stream = { key: skey, cachedNow: true, retried: false, replaced: false };
      setStreamState('Cached', 'cached');
      loadWave(t);
      prefetchNext();
    }
    paintVideo();
    // A streamed song fetched ahead without its details: looked up with what it has.
    if (t.stream && !t.detailsIn) { t.detailsIn = true; loadLyrics(t); }
    loadLoop(t);
    paintBar();
    preloadSoon();
  }
  function mediaMeta(t) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || '', artist: t.artist || '', album: t.album || '' });
    picOf(t).then((u) => { if (u && current === t && navigator.mediaSession.metadata && !/^blob:/.test(u)) navigator.mediaSession.metadata.artwork = [{ src: u, sizes: '512x512' }]; });
  }

  // ---------- Songs from the Music Downloader (streamed, or downloaded whole first) ----------
  let stream = null; // { key, cachedNow, retried } for the song playing
  let playDownload = true;
  window.api.settingsGet().then((st) => { playDownload = st.playDownload !== false; }).catch(() => {});
  if (window.api.onSettings) window.api.onSettings((st) => { if ('playDownload' in st) playDownload = st.playDownload !== false; });
  let failRun = 0; // songs in a row that couldn't play
  onMedia('playing', () => { failRun = 0; });
  // at: start from there; fresh: look the song up again (its address expired); play: start playing.
  async function openStream(t, seq, { at = 0, fresh = false, play = true } = {}) {
    setStreamState(playDownload ? 'Downloading' : 'Loading', 'loading');
    let s;
    try {
      s = await window.api.streamOpen(t.url, null, { fresh, meta: { title: t.title, artist: t.artist, duration: t.duration } });
    } catch (e) {
      if (seq !== loadSeq) return;
      const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      t.unplayable = msg;
      // Playing on: the next song in a few seconds (up to 5 in a row, so a dead queue doesn't spin).
      const more = play && (qi + 1 < queue.length || repeat === 'all') && failRun < 5;
      streamFail(more ? `${msg} Skipping…` : msg);
      if (more) { failRun++; setTimeout(() => { if (seq === loadSeq && current === t) next(); }, 2500); }
      return;
    }
    if (seq !== loadSeq) return;
    failRun = 0;
    // A music video swapped for the album's track: its name, album and picture.
    if (s.replaced && s.replaced.why === 'video') {
      const r = s.replaced;
      if (r.title) t.title = r.title;
      if (r.albumUrl) t.albumUrl = r.albumUrl;
      if (r.thumbnail) { t.thumbnail = r.thumbnail; t.art = null; }
      if (r.year && !t.year) t.year = r.year;
      paintNow(); mediaMeta(t);
    }
    // Fill gaps (a pasted link or an album track) with what the lookup found.
    if (s.meta || s.art) {
      let more = streamDetails(t, s.meta, s.art);
      if (more) { paintNow(); mediaMeta(t); }
    }
    // Now its artist and details are known: the lyrics and the loop (music video) are looked up.
    const fresh0 = !t.detailsIn;
    t.detailsIn = true;
    if (fresh0 || lyricsFor !== t) loadLyrics(t);
    loadLoop(t);
    stream = { key: s.key, cachedNow: !!(s.cached || s.local), retried: fresh, replaced: s.replaced || false };
    if (dj.on) djGet(t);
    if (stream.cachedNow && !wave) loadWave(t);
    setStreamState(s.local ? 'Local file' : s.cached ? 'Cached' : 'Streaming', s.local ? 'local' : s.cached ? 'cached' : 'stream');
    curSrc = s.src;
    audio.crossOrigin = 'anonymous'; // the stream server allows it, so the effects can read it
    if (window.PlayerFx && window.PlayerFx.pitch) window.PlayerFx.pitch(audio, null);
    audio.src = s.src;
    applySpeed();
    if (at) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, (audio.duration || at) - 0.5); } catch { /* not ready */ } }, { once: true });
    if (play) { try { await audio.play(); } catch { /* the error handler deals with it */ } }
    paintBar();
    prefetchNext();
  }
  // Gaps in a streamed song's details filled from the lookup (or what was kept when it was cached), and
  // its picture as kept on this PC. → whether anything changed.
  function streamDetails(t, meta, art) {
    let more = false;
    if (meta) for (const k of ['title', 'artist', 'album', 'thumbnail', 'duration', 'year', 'genre']) if (!t[k] && meta[k]) { t[k] = meta[k]; more = true; }
    if (art && t.art !== art) { t.art = art; more = true; }
    if (more && t === current) dcPush(); // Discord: the year (and the rest) once known
    return more;
  }
  // Saved as it cached (main.js): the details and the picture, for the song playing or the next one.
  if (window.api.onStreamMeta) window.api.onStreamMeta(({ key, meta, art }) => {
    for (const t of [current, ...queue.slice(qi + 1, qi + 1 + AHEAD)]) {
      if (!t || !t.stream || streamKeyOf(t) !== key) continue;
      if (!streamDetails(t, meta, art)) continue;
      if (t === current) { paintNow(); mediaMeta(t); }
      if (!$('lp-un-pop').classList.contains('hidden')) paintQueue();
    }
  });
  let streamKind = '';
  function setStreamState(text, kind) {
    streamKind = kind;
    let label = text, tip = { stream: 'Playing from the site; saving to the cache as it plays', cached: 'Saved on this PC: plays offline',
      local: 'Downloaded to a temporary file before playing; deleted when the song changes' }[kind] || '';
    if (stream && stream.replaced && ['stream', 'cached', 'local'].includes(kind)) {
      label = stream.replaced.why === 'video' ? 'Album version' : 'Via YT Music';
      tip = stream.replaced.why === 'video' ? `This was a music video${stream.replaced.from ? ` ("${stream.replaced.from}")` : ''}, so the album's own track plays instead (Settings → Streaming).`
        : stream.replaced.why === 'blocked' ? "SoundCloud won't play this track here (blocked in your country, private or removed), so this plays the same song from YouTube Music."
          : "SoundCloud's copy is DRM-protected, so this plays the same song from YouTube Music.";
    }
    $('lp-bar-state').textContent = label;
    $('lp-bar-state').title = tip;
    $('lp-bar-state').classList.toggle('err', kind === 'error');
    if (current && current.stream) $('lp-np-fmt').textContent = [label, current.duration ? fmtTime(current.duration) : ''].filter(Boolean).join(' · ');
  }
  function streamFail(msg) {
    setStreamState("Couldn't play", 'error');
    $('lp-bar-state').title = msg;
    $('lp-np-fmt').textContent = `✕ ${msg}`;
    paintBar();
  }
  let prefetchTimer = 0;
  // The next 10 songs from the Music Downloader are fetched ahead, one after another (downloaded whole,
  // or saved to the cache), each with its details and picture; the next one first. Songs that leave
  // those 10 (the queue changed) lose their temporary files.
  const AHEAD = 10;
  let aheadGen = 0;
  function prefetchNext() {
    clearTimeout(prefetchTimer);
    const gen = ++aheadGen;
    const list = queue.slice(qi + 1, qi + 1 + AHEAD).filter((t) => t && t.stream && t.url);
    if (window.api.streamKeepAhead) window.api.streamKeepAhead(list.map((t) => t.url)).catch(() => {});
    if (!list.length) return;
    prefetchTimer = setTimeout(async () => {
      for (let i = 0; i < list.length; i++) {
        if (gen !== aheadGen) return;
        const t = list[i];
        // Already fetched this session: asked again (quick, no lookup) in case its file was dropped.
        const known = streamKeys.has(t.url);
        if (known) streamKeys.delete(t.url);
        const r = await streamAhead(t);
        if (gen !== aheadGen) return;
        if (i === 0 && r && dj.on) { djGet(t); if (!pre) preloadSoon(); }
        if (r && !$('lp-un-pop').classList.contains('hidden')) paintQueue();
        // A site refused (SoundCloud limits lookups in a row): the rest wait for the next song.
        if (!r) return;
        // New lookups spaced out (SoundCloud answers a burst of them with 403 for a while).
        if (!known && i + 1 < list.length) await new Promise((ok) => setTimeout(ok, 5000));
      }
    }, 1500);
  }
  window.api.onStreamProgress(({ url, percent }) => {
    if (!current || !current.stream || current.url !== url || streamKind !== 'loading') return;
    setStreamState(percent == null ? 'Downloading' : `Downloading ${percent}%`, 'loading');
  });
  window.api.onStreamCached((key) => {
    if (dj.on) for (const t of [current, queue[qi + 1]]) if (t && t.stream && streamKeyOf(t) === key) djGet(t);
    if (!stream || key !== stream.key) return;
    stream.cachedNow = true;
    if (streamKind === 'stream') setStreamState('Cached', 'cached');
    if (!wave && current) loadWave(current);
  });
  onMedia('waiting', () => { if (current && current.stream && streamKind === 'stream') $('lp-bar-state').textContent = 'Buffering'; });
  onMedia('playing', () => { if (current && current.stream && streamKind === 'stream') $('lp-bar-state').textContent = 'Streaming'; });
  // Seeking: a song still arriving can't jump ahead yet; once it's cached, it reloads there.
  function seekTo(time) {
    if (guest) { const d = guest.duration(); guest.seek(Math.max(0, d ? Math.min(d, time) : time)); paintTime(); return; }
    if (!current) return;
    const d = audio.duration || current.duration || 0;
    time = Math.max(0, d ? Math.min(d - 0.2, time) : time);
    if (current.stream) {
      const r = audio.seekable;
      if (!(r.length && time <= r.end(r.length - 1) + 0.25)) {
        if (stream && stream.cachedNow) { openStream(current, loadSeq, { at: time, play: !audio.paused }); return; }
        const st = $('lp-bar-state'), was = st.textContent;
        st.textContent = 'Seek once cached';
        setTimeout(() => { if (st.textContent === 'Seek once cached') st.textContent = was; }, 1800);
        paintTime();
        return;
      }
    }
    audio.currentTime = time;
    paintTime();
  }

  // ---------- Stop / next / repeat ----------
  function stop() { audio.pause(); try { audio.currentTime = 0; } catch { /* nothing loaded */ } paintBar(); }
  // Repeat: off → the whole list → this song.
  let repeat = 'off';
  try { const r = localStorage.getItem('nabbit.lpRepeat'); if (r === 'all' || r === 'one') repeat = r; } catch { /* default */ }
  function paintRepeat() {
    const b = $('lp-repeat');
    const label = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this song' }[repeat];
    b.classList.toggle('on', repeat !== 'off');
    b.classList.toggle('one', repeat === 'one');
    b.setAttribute('aria-pressed', String(repeat !== 'off'));
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  $('lp-repeat').addEventListener('click', () => {
    repeat = { off: 'all', all: 'one', one: 'off' }[repeat];
    try { localStorage.setItem('nabbit.lpRepeat', repeat); } catch { /* none */ }
    paintRepeat();
  });
  paintRepeat();
  const next = () => { if (qi + 1 < queue.length) start(qi + 1); else if (repeat === 'all' && queue.length) start(0); else stop(); };
  const prev = () => { if (audio.currentTime > 3 || qi <= 0) seekTo(0); else start(qi - 1); };
  onMedia('ended', () => {
    if (repeat === 'one' && current) { lfStart(current); audio.currentTime = 0; audio.play().catch(() => {}); return; }
    next();
  });
  // A file that won't play is skipped; after 3 in a row, stop (rather than racing through the list).
  // A streamed song is looked up again once (its address may have expired).
  let fails = 0;
  onMedia('playing', () => { fails = 0; });
  onMedia('error', () => {
    if (!current || !audio.getAttribute('src')) return;
    if (current.stream) {
      if (stream && !stream.retried) { openStream(current, loadSeq, { at: audio.currentTime || 0, fresh: true }); return; }
      streamFail(audio.error && audio.error.message ? audio.error.message : "The player couldn't read this stream.");
      return;
    }
    if (restoredIdle) return; // the song brought back from last time didn't load: leave it, don't skip on
    if (++fails >= 3) { fails = 0; stop(); $('lp-np-artist').textContent = "Couldn't play these files."; return; }
    setTimeout(next, 300);
  });
  // Stop and close: the play bar goes (in the Toolbox) and any temporary song files are deleted.
  function closePlayer() {
    if (guest) { const g = guest; detachGuest(g); g.pause(); if (!current) return; }
    const hadStream = queue.some((x) => x.stream);
    cancelMix();
    dropPre();
    loadSeq++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    yt = null; ytBusy = null; ytv.removeAttribute('src'); ytv.load();
    queue = []; base = []; qi = -1; current = null; stream = null; lrc = null; loop = null; loopBusy = false;
    saveSession();
    if (hadStream) window.api.streamRelease().catch(() => {});
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    mediaSync();
    paintNow();
    paintVideo();
    showBar();
  }
  $('lp-close').addEventListener('click', closePlayer);
  // The play bar: always in Player mode; in the Toolbox while something is loaded.
  function showBar() {
    const on = mode === 'player' || !!current || !!guest;
    $('lp-bar').classList.toggle('hidden', !on);
    document.body.classList.toggle('lp-on', on);
  }
  onMedia('play', () => { if (guest) { const g = guest; detachGuest(g); g.pause(); } paintBar(); });
  onMedia('pause', paintBar);
  onMedia('timeupdate', () => { paintTime(); syncLyrics(); checkHandover(); });
  onMedia('loadedmetadata', paintTime);
  $('lp-play').addEventListener('click', toggle);
  function toggle() {
    if (guest) { guest.toggle(); return; }
    if (!current) { if (shown.length) playFrom(0); return; }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  $('lp-next').addEventListener('click', () => { if (!guest) skipNext(); });
  $('lp-prev').addEventListener('click', () => { if (guest) seekTo(0); else prev(); });
  $('lp-playall').addEventListener('click', () => { shuffle = false; paintShuffle(); playFrom(0); });
  $('lp-shuffleall').addEventListener('click', () => { shuffle = true; paintShuffle(); playFrom(Math.floor(Math.random() * shown.length)); });
  $('lp-shuffle').addEventListener('click', () => {
    shuffle = !shuffle;
    paintShuffle();
    // Reshuffle what's left (or put it back in order).
    if (current) {
      const rest = base.filter((t) => t !== current);
      if (shuffle) for (let k = rest.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
      queue = shuffle ? [current, ...rest] : base.slice();
      qi = queue.indexOf(current);
      paintUpNext();
    }
  });
  function paintShuffle() { $('lp-shuffle').classList.toggle('on', shuffle); $('lp-shuffle').setAttribute('aria-pressed', String(shuffle)); }
  // Windows' media controls: the keyboard's media keys (held by Nabbit while a song is loaded; main.js)
  // and the taskbar thumbnail's buttons come in here; the media overlay and headphone buttons through
  // the media session below. A key seen both ways counts once.
  let keyAt = 0;
  const once = (fn) => (...a) => { if (performance.now() - keyAt < 400) return; fn(...a); };
  function mediaSync() { // (a function declaration, its state on itself: paintBar may run before this line)
    const has = !!current || !!guest, playing = guest ? guest.playing() : has && !audio.paused;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = !has ? 'none' : playing ? 'playing' : 'paused';
    const k = `${has}|${playing}`;
    if (k === mediaSync.sent || !window.api.mediaState) return;
    mediaSync.sent = k;
    window.api.mediaState({ has, playing }).catch(() => {});
  }
  if (window.api.onMediaKey) {
    window.api.onMediaKey((k) => {
      keyAt = performance.now();
      if (k === 'playpause') toggle();
      else if (k === 'next') { if (current) skipNext(); }
      else if (k === 'prev') { if (current) prev(); }
      else if (k === 'stop') { if (current && !audio.paused) audio.pause(); }
    });
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', once(toggle));
    navigator.mediaSession.setActionHandler('pause', once(toggle));
    navigator.mediaSession.setActionHandler('nexttrack', once(skipNext));
    navigator.mediaSession.setActionHandler('previoustrack', once(prev));
    try { navigator.mediaSession.setActionHandler('seekto', (d) => seekTo(d.seekTime)); } catch { /* older */ }
  }
  // Settings live in the Toolbox: the gear switches to it first (then opens them as usual).
  for (const g of document.querySelectorAll('.settings-tab')) g.addEventListener('click', () => { if (mode === 'player') setMode('toolbox'); }, true);

  // ---------- Keyboard (Player mode; not while typing in a box) ----------
  const KEYS = [
    ['Space', 'Play / pause'], ['← →', '5 seconds back / on'], ['Shift + ← →', 'Previous / next song'],
    ['↑ ↓', 'Volume up / down'], ['M', 'Mute'], ['S', 'Shuffle'], ['R', 'Repeat: off, all, this song'], ['D', 'DJ mode'],
    ['Q', 'Up next (the queue)'], ['V', 'Video / loop on the cover'], ['Ctrl + F', 'Filter the library'], ['?', 'These keys'],
  ];
  function showKeys() {
    const old = document.querySelector('.lp-keys');
    if (old) { old.remove(); return; }
    const box = el('div', 'lp-keys');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Keyboard shortcuts');
    box.append(el('b', '', 'Keys'));
    const dl = el('dl');
    for (const [k, what] of KEYS) dl.append(el('dt', '', k), el('dd', '', what));
    box.append(dl, el('small', '', 'Esc or ? closes this'));
    box.addEventListener('click', () => box.remove());
    document.body.append(box);
  }
  // A clicked button would act on Space as the key comes up (after it played / paused): not that one.
  // (Decided as the key goes down: by the time it's up, the browser counts the button as keyboard-focused.)
  let spaceTaken = false;
  // How the focus got there: a click (pointer) or the keyboard (Tab, arrows).
  let byPointer = false;
  document.addEventListener('pointerdown', () => { byPointer = true; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) byPointer = false; }, true);
  document.addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceTaken) { spaceTaken = false; e.preventDefault(); } }, true);
  const volBy = (d) => { const v = Math.max(0, Math.min(100, Number($('lp-vol').value) + d)); $('lp-vol').value = String(v); $('lp-vol').dispatchEvent(new Event('input')); };
  document.addEventListener('keydown', (e) => {
    if (mode !== 'player' || e.defaultPrevented) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector('.lp-lightbox, .lp-ctx')) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'f' || k === 'F')) { e.preventDefault(); $('lib-q').focus(); $('lib-q').select(); return; }
    if (ctrl || e.altKey) return;
    if (k === 'Escape') { const kb = document.querySelector('.lp-keys'); if (kb) { kb.remove(); e.preventDefault(); } return; }
    let done = true;
    // Space plays / pauses, even after clicking a button (which keeps the focus); a button reached with
    // the keyboard (Tab) still takes it.
    if (e.code === 'Space') {
      if (a && a.tagName === 'BUTTON' && !byPointer) return; // reached with the keyboard: the button's
      e.preventDefault();
      spaceTaken = !!(a && a.tagName === 'BUTTON');
      if (!e.repeat) toggle();
    }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!current) return;
      const fwd = k === 'ArrowRight';
      if (e.shiftKey) { if (fwd) skipNext(); else prev(); } else seekTo(audio.currentTime + (fwd ? 5 : -5));
    } else if (k === 'ArrowUp' || k === 'ArrowDown') volBy(k === 'ArrowUp' ? 5 : -5);
    else if (k === 'm' || k === 'M') $('lp-mute').click();
    else if (k === 's' || k === 'S') $('lp-shuffle').click();
    else if (k === 'r' || k === 'R') $('lp-repeat').click();
    else if (k === 'd' || k === 'D') setDj(!dj.on);
    else if (k === 'q' || k === 'Q') toggleQueue();
    else if (k === 'v' || k === 'V') { if (!$('lp-vtoggle').classList.contains('hidden')) $('lp-vtoggle').click(); }
    else if (k === '?') showKeys();
    else done = false;
    if (done) e.preventDefault();
  });

  // Seek, volume, speed
  let seeking = false;
  // What the bar shows: the player's song, or a guest's (another tool playing through the bar).
  const barDur = () => (guest ? guest.duration() : audio.duration || (current && current.duration) || 0);
  const barTime = () => (guest ? guest.time() : audio.currentTime);
  $('lp-seek').addEventListener('input', () => { seeking = true; $('lp-t0').textContent = fmtTime((Number($('lp-seek').value) / 1000) * barDur()); drawWave(); });
  $('lp-seek').addEventListener('change', () => { const d = barDur(); seeking = false; if (d) seekTo((Number($('lp-seek').value) / 1000) * d); });
  function paintTime() {
    const d = barDur();
    if (!seeking) {
      $('lp-t0').textContent = fmtTime(barTime());
      $('lp-seek').value = String(d ? Math.round((barTime() / d) * 1000) : 0);
    }
    $('lp-t1').textContent = fmtTime(d);
    drawWave();
  }

  // ---------- The position bar as the song's waveform ----------
  // Peaks from main.js (ffmpeg, 1200 slices); the part already played in red. A streamed song gets its
  // waveform once it's whole (cached or downloaded first); until then, a flat line.
  let wave = null, waveKey = '';
  async function loadWave(t) {
    let peaks = null;
    if (t.stream) {
      if (!stream || !stream.key) return;
      peaks = await window.api.wavePeaksStream(stream.key).catch(() => null);
    } else if (t.path) peaks = await window.api.wavePeaks(t.path).catch(() => null);
    if (current !== t || !Array.isArray(peaks) || !peaks.length) return;
    // Scaled to the song's own loudest part and curved, so loud and quiet passages differ clearly.
    wave = PC.waveShape(peaks);
    waveKey = '';
    drawWave(true);
  }
  // Beat grids set by hand (Audio Tools → Change pitch and tempo → Beat grid), by path, kept.
  let grids = null;
  function gridOf(p) {
    if (!grids) { try { grids = JSON.parse(localStorage.getItem('nabbit.grids') || '{}'); } catch { grids = {}; } }
    const g = grids[String(p).toLowerCase()];
    return g && g.bpm > 0 ? g : null;
  }
  function drawWave(force = false) {
    const c = $('lp-wave');
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const d = barDur();
    const frac = seeking ? Number($('lp-seek').value) / 1000 : d ? Math.min(1, barTime() / d) : 0;
    const dpr = window.devicePixelRatio || 1;
    const shape = guest ? guest.wave : wave;
    // The beat grid (4/4: a line every beat, stronger every bar), from the song's tempo and first beat.
    const own = !guest && current && !current.stream ? gridOf(current.path) : null;
    // The analysis (tempo, key) only runs in DJ mode; otherwise a grid from one already done.
    const an = !guest && current && !own ? (dj.on ? djGet(current) : djPeek(current)) : null;
    const grid = own && d > 0 ? { bpm: own.bpm, first: own.offset } : an && an.bpm > 0 && d > 0 ? { bpm: Math.round(an.bpm), first: an.offset || 0 } : null;
    const key = `${w}|${h}|${dpr}|${Math.round(frac * w * dpr)}|${!!shape}|${!!guest}|${grid ? grid.bpm : 0}|${document.documentElement.className}`;
    if (!force && key === waveKey) return;
    waveKey = key;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const red = cs.getPropertyValue('--red').trim() || '#ff2a1f', muted = cs.getPropertyValue('--muted').trim() || '#888', text = cs.getPropertyValue('--text').trim() || '#eee';
    const BW = 2, GAP = 1, n = Math.max(1, Math.floor((w + GAP) / (BW + GAP)));
    const px = frac * w;
    const bars = PC.waveBars(shape, n);
    for (let i = 0; i < n; i++) {
      const v = bars[i];
      const bh = Math.max(2, Math.round(v * (h - 2)));
      const x = i * (BW + GAP);
      const played = x + BW <= px;
      g.fillStyle = played ? red : muted;
      g.globalAlpha = played ? 1 : 0.45;
      g.fillRect(x, Math.round((h - bh) / 2), BW, bh);
    }
    g.globalAlpha = 1;
    if (grid) {
      const beat = 60 / grid.bpm, pxBeat = (beat / d) * w;
      g.fillStyle = text;
      for (let k = Math.ceil(-grid.first / beat), t = grid.first + k * beat; t < d; k++, t += beat) {
        if (t < 0) continue;
        const bar = ((k % 4) + 4) % 4 === 0;
        if (!bar && pxBeat < 4) continue;
        if (bar && pxBeat * 4 < 3) continue;
        g.globalAlpha = bar ? 0.5 : 0.22;
        g.fillRect(Math.round((t / d) * w), bar ? 0 : Math.round(h * 0.25), 1, bar ? h : Math.round(h * 0.5));
      }
      g.globalAlpha = 1;
    }
    if (current || guest) { g.fillStyle = text; g.fillRect(Math.min(w - 1, Math.max(0, Math.round(px))), 0, 1, h); }
  }
  // Smooth while playing: redrawn when the playhead moves a pixel.
  let waveRaf = 0;
  const waveLoop = () => { waveRaf = 0; if (audio.paused) return; checkHandover(); if (!$('lp-bar').classList.contains('hidden')) drawWave(); waveRaf = requestAnimationFrame(waveLoop); };
  onMedia('play', () => { if (!waveRaf) waveRaf = requestAnimationFrame(waveLoop); });
  new ResizeObserver(() => drawWave(true)).observe($('lp-wave'));
  try { $('lp-vol').value = localStorage.getItem('nabbit.lpVol') || '80'; } catch { /* default */ }
  // The volume comes last: after the effects when they're running (player-fx.js), else on the player itself.
  const applyVol = () => { const v = Number($('lp-vol').value) / 100; if (window.PlayerFx && window.PlayerFx.output(v * v)) audio.volume = 1; else audio.volume = v * v; };
  applyVol();
  $('lp-vol').addEventListener('input', () => { applyVol(); audio.muted = false; paintMute(); guestVol(); try { localStorage.setItem('nabbit.lpVol', $('lp-vol').value); } catch { /* none */ } });
  $('lp-mute').addEventListener('click', () => { audio.muted = !audio.muted; paintMute(); guestVol(); });
  const guestVol = () => { if (guest && guest.volume) { const v = Number($('lp-vol').value) / 100; guest.volume(audio.muted ? 0 : v * v); } };
  // Scrolling on the play bar: volume (2 % a notch); on the position bar: 5 seconds back or forward.
  $('lp-bar').addEventListener('wheel', (e) => {
    e.preventDefault();
    const up = e.deltaY < 0;
    if (e.target === $('lp-seek') || e.target.closest('.lp-time')) {
      if (!current && !guest) return;
      seekTo(barTime() + (up ? 5 : -5));
      return;
    }
    const v = Math.max(0, Math.min(100, Number($('lp-vol').value) + (up ? 2 : -2)));
    $('lp-vol').value = String(v);
    $('lp-vol').dispatchEvent(new Event('input'));
  }, { passive: false });
  // Effects: a placeholder for now.
  function paintMute() { $('lp-mute').classList.toggle('muted', audio.muted || Number($('lp-vol').value) === 0); }
  // Speed: like changing the sample rate (faster is higher). 1 when off.
  function speedRate() { return $('lp-speed-on').checked ? Math.max(0.5, Math.min(4, 1 + Number($('lp-speed').value) / 100)) : 1; }
  // Audio Tools → Change pitch and tempo: its song plays at its own pitch (semitones) and tempo, each on
  // its own: the tempo by the player (pitch kept), the pitch by the pitch shifter (DJ mode's). Without
  // the shifter, like a record (both together). Other songs play as usual.
  let pt = null; // { path, semis, tempo, record }
  const ptFor = (t) => (pt && t && !t.stream && t.path && t.path.toLowerCase() === pt.path.toLowerCase() ? pt : null);
  function applyPt(el, p) {
    const r = 2 ** (p.semis / 12);
    if (window.PlayerFx && window.PlayerFx.useAlgo) window.PlayerFx.useAlgo(el, null); // Audio Tools' engine
    if (window.PlayerFx && window.PlayerFx.timeShape) window.PlayerFx.timeShape(el, p.rt || null);
    if (window.PlayerFx && window.PlayerFx.slices) window.PlayerFx.slices(el, p.sl || null);
    const on = !!(window.PlayerFx && window.PlayerFx.pitchOn && window.PlayerFx.pitchOn(el));
    // Once on, it stays on while you drag through 0 (at 1 it changes nothing): no switching back and forth.
    const shift = !p.record && shifterOK() && (away(r) || on || !!p.force);
    if (shift !== on && window.PlayerFx && window.PlayerFx.pitch) window.PlayerFx.pitch(el, shift ? r : null, { dip: !el.paused });
    else if (shift) window.PlayerFx.pitch(el, r);
    if (p.record || (away(r) && !shift)) { el.preservesPitch = false; el.playbackRate = r; return; }
    el.preservesPitch = true;
    el.playbackRate = p.tempo;
  }
  function applySpeed() {
    const p = ptFor(current);
    if (p && !mix) { applyPt(audio, p); paintSpeed(); return; }
    if (window.PlayerFx && window.PlayerFx.timeShape) window.PlayerFx.timeShape(audio, null);
    if (window.PlayerFx && window.PlayerFx.slices) window.PlayerFx.slices(audio, null);
    // In a DJ mix the mix sets the speeds (the song fading out follows Speed unless it's a key shift).
    // During a mix, the new song follows (the old one stays where it was).
    if (mix && mix.el === audio) { mix.toSpeed = speedRate(); setRate(audio, mix.toSpeed, mix.toStretch); } else setRate(audio, speedRate(), stretch);
    paintSpeed();
  }
  function paintSpeed() {
    const on = $('lp-speed-on').checked;
    const pct = Number($('lp-speed').value);
    const semis = on ? 12 * Math.log2(speedRate()) : 0;
    const st = Math.abs(semis - Math.round(semis)) < 0.02 && Math.round(semis) ? ` · ${semis > 0 ? '+' : ''}${Math.round(semis)} st` : '';
    $('lp-speed-v').textContent = `${on ? Math.round((100 + pct) * 10) / 10 : 100}%${st}`;
    $('lp-speed').disabled = !on;
  }
  // Speed is kept between runs (on / off and the slider; a DJ key shift too, as it's on the slider).
  const SPEED_KEY = 'nabbit.lpSpeed';
  const saveSpeed = () => { try { localStorage.setItem(SPEED_KEY, JSON.stringify({ on: $('lp-speed-on').checked, v: Number($('lp-speed').value), dj: djSpeedOn })); } catch { /* none */ } };
  try {
    const sv = JSON.parse(localStorage.getItem(SPEED_KEY) || 'null');
    if (sv) { $('lp-speed-on').checked = !!sv.on; $('lp-speed').value = String(Number(sv.v) || 0); djSpeedOn = !!sv.dj; }
  } catch { /* defaults */ }
  $('lp-speed-on').addEventListener('change', () => { djSpeedOn = false; cancelAnimationFrame(speedAnim); applySpeed(); });
  for (const ev of ['change', 'input']) for (const id of ['lp-speed-on', 'lp-speed']) $(id).addEventListener(ev, () => djPaint());
  $('lp-speed').addEventListener('input', () => { djSpeedOn = false; cancelAnimationFrame(speedAnim); applySpeed(); });
  $('lp-speed').addEventListener('dblclick', () => { $('lp-speed').value = '0'; applySpeed(); saveSpeed(); });
  // Saved after the handlers above (which settle whether DJ mode still owns the setting).
  for (const ev of ['change', 'input']) for (const id of ['lp-speed-on', 'lp-speed']) $(id).addEventListener(ev, saveSpeed);
  // Scroll on the speed slider: one semitone (100 cents) up or down; switches speed on.
  const SEMI = 2 ** (1 / 12);
  function onSpeedWheel(e) {
    e.preventDefault();
    // From the speed you hear (100 % when Speed is off) to the next whole semitone up or down: from
    // 110 % (+1.65) that's +2 up or +1 down; from a whole semitone, one more or one less.
    const now = 12 * Math.log2(speedRate());
    const semis = e.deltaY < 0 ? Math.floor(now + 0.03) + 1 : Math.ceil(now - 0.03) - 1;
    const next = Math.max(0.5, Math.min(4, SEMI ** semis));
    $('lp-speed').value = String(Math.round((next - 1) * 1000) / 10);
    $('lp-speed-on').checked = true;
    djSpeedOn = false;
    cancelAnimationFrame(speedAnim);
    applySpeed();
    saveSpeed();
    djPaint();
  }
  $('lp-speed').addEventListener('wheel', onSpeedWheel, { passive: false });
  document.querySelector('.lp-speed').addEventListener('wheel', (e) => { if (e.target !== $('lp-speed')) onSpeedWheel(e); }, { passive: false });
  applySpeed();

  // ---------- Now playing ----------
  function markPlaying() {
    const list = $('lp-list');
    for (const r of list.querySelectorAll('.lp-tr.now')) r.classList.remove('now');
    if (current && current.path) { const r = list.querySelector(`.lp-tr[data-path="${CSS.escape(current.path)}"]`); if (r) r.classList.add('now'); }
  }
  function paintBar() {
    mediaSync();
    const on = guest ? guest.playing() : !audio.paused;
    $('lp-bar').classList.toggle('playing', on);
    $('lp-bar').classList.toggle('guest', !!guest);
    // Something's playing: the bars on the Player switch move.
    document.body.classList.toggle('lp-playing', on && (!!current || !!guest));
    $('mode-eq').title = on ? `Playing: ${guest ? guest.title : current ? current.title : ''}` : '';
    $('lp-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    $('lp-play').title = on ? 'Pause (Space)' : 'Play (Space)';
    // Lists elsewhere mark the file that's playing (the Toolbox's ▶ buttons).
    const key = `${current && !current.stream ? current.path : ''}|${on && !guest}`;
    if (key !== paintBar.told) { paintBar.told = key; document.dispatchEvent(new CustomEvent('nabbit-now', { detail: { path: current && !current.stream ? current.path : null, playing: on && !guest } })); }
  }
  function heart(btn, t) {
    btn.classList.toggle('on', !!t.loved);
    btn.setAttribute('aria-pressed', String(!!t.loved));
    btn.onclick = () => rate(t, { loved: !t.loved });
  }
  // An artist's name opens their YouTube Music page (in the Music Downloader).
  // Several artists ("A; B; C"): one link each.
  function artistLinks(names) {
    const f = document.createDocumentFragment();
    Core.splitArtists(names).forEach((n, i) => { if (i) f.append(document.createTextNode('; ')); f.append(artistLink(n)); });
    return f;
  }
  function artistLink(name) {
    const b = el('button', 'lp-artist-link', name);
    b.type = 'button';
    b.dataset.artist = name;
    b.title = `Open ${name} on YouTube Music`;
    return b;
  }
  // A song from the Music Downloader: its artists' own pages (else a search by name).
  function streamArtists(t) {
    const links = t.artistLinks && t.artistLinks.length ? t.artistLinks : null;
    if (!links) return artistLinks(t.artist || '');
    const f = document.createDocumentFragment();
    links.forEach((a, i) => {
      if (i) f.append(document.createTextNode(', '));
      const b = el('button', 'lp-artist-link', a.name);
      b.type = 'button';
      b.title = `Open ${a.name}'s artist page`;
      // Their page in the YouTube Music (or SoundCloud) tab.
      b.addEventListener('click', (e) => { e.stopPropagation(); if (a.url && window.Sources && window.Sources.openArtist) window.Sources.openArtist(a.url, { title: a.name }); else openArtistPage(a.name); });
      f.append(b);
    });
    return f;
  }
  function goMusic() {
    const tab = document.querySelector('.tab[data-mode="music"]');
    if (tab && !tab.classList.contains('active')) tab.click();
  }
  // By name: YouTube Music's best match, opened in the YouTube Music tab.
  function openArtistPage(name) {
    if (window.Sources && window.Sources.openArtistNamed) { window.Sources.openArtistNamed(String(name).trim()); return; }
    if (!window.nabbitOpenArtist) return;
    setMode('toolbox');
    window.nabbitOpenArtist(String(name).trim());
  }
  // ---------- A guest on the play bar (window.Player.attach) ----------
  function attachGuest(g) {
    if (guest && guest !== g) detachGuest(guest);
    guest = g;
    if (!audio.paused) audio.pause();
    for (const r of document.querySelectorAll('#lp-bar .lp-np-rate')) r.classList.add('hidden');
    $('lp-bar-title').textContent = g.title || 'Untitled';
    $('lp-bar-title').title = g.reveal ? 'Show it' : '';
    $('lp-bar-artist').textContent = g.sub || '';
    $('lp-bar-state').classList.remove('hidden', 'err');
    $('lp-bar-state').textContent = g.label || '';
    $('lp-bar-art').style.backgroundImage = '';
    $('lp-bar-art').classList.remove('pic');
    guestVol();
    showBar();
    paintBar(); paintTime(); drawWave(true);
    cancelAnimationFrame(guestRaf);
    const loop = () => { if (guest !== g) return; if (g.playing()) { paintTime(); } guestRaf = requestAnimationFrame(loop); };
    guestRaf = requestAnimationFrame(loop);
  }
  function detachGuest(g) {
    if (!guest || (g && guest !== g)) return;
    const was = guest;
    guest = null;
    cancelAnimationFrame(guestRaf);
    if (was.onDetach) was.onDetach();
    $('lp-bar').classList.remove('guest');
    $('lp-bar-state').textContent = '';
    paintNow();
    showBar();
    drawWave(true);
  }
  function paintNow() {
    if (guest) { paintBar(); return; } // the guest has the bar
    const t = current;
    markPlaying();
    paintBar();
    if (typeof window.markPlaying === 'function') window.markPlaying(); // the ▶ rows in the Music Downloader
    for (const r of document.querySelectorAll('.lp-np-rate')) r.classList.toggle('hidden', !!(t && t.stream));
    $('lp-bar-state').classList.toggle('hidden', !(t && t.stream));
    if (!t) {
      $('lp-np-title').textContent = 'Nothing playing';
      $('lp-np-artist').textContent = 'Double-click a song to play it.';
      $('lp-bar-title').textContent = '—';
      $('lp-bar-artist').textContent = '';
      $('lp-np-fmt').textContent = '';
      $('lp-bar-state').textContent = '';
      $('lp-next-name').textContent = '';
      $('lp-lyrics').textContent = '';
      $('lp-lyr-src').textContent = '';
      $('lp-upnext').textContent = '';
      for (const id of ['lp-cover', 'lp-bar-art', 'lp-np-thumb']) { $(id).style.backgroundImage = ''; $(id).classList.remove('pic'); }
      $('lp-cover-t').textContent = '';
      paintTime();
      return;
    }
    const who = () => (t.stream ? streamArtists(t) : artistLinks(t.artist));
    $('lp-np-title').textContent = t.title || 'Unknown title';
    $('lp-np-artist').textContent = '';
    if (t.artist || t.stream) $('lp-np-artist').append(who());
    $('lp-bar-title').textContent = t.title || 'Unknown title';
    $('lp-bar-title').title = t.stream ? 'Open this song in the Music Downloader' : mode === 'player' ? '' : 'Show it in the Player';
    $('lp-bar-artist').textContent = '';
    if (t.artist || t.stream) $('lp-bar-artist').append(who());
    if (!t.stream) {
      for (const [h, s] of [['lp-np-heart', 'lp-np-stars'], ['lp-bar-heart', 'lp-bar-stars']]) { heart($(h), t); $(s).replaceWith(Object.assign(stars(t), { id: s })); }
      $('lp-np-fmt').textContent = [`${t.codec}${t.rate ? ` ${t.rate / 1000} kHz` : ''}`, t.bits ? `${t.bits}-bit` : '', t.kbps ? `${t.kbps.toLocaleString()}k` : '',
        t.channels === 1 ? 'Mono' : t.channels === 2 ? 'Stereo' : t.channels ? `${t.channels} ch` : '', fmtTime(t.duration)].filter(Boolean).join(', ');
    } else if (!$('lp-np-fmt').textContent) $('lp-np-fmt').textContent = fmtTime(t.duration);
    for (const [id, cls] of [['lp-cover', 'lp-cover'], ['lp-bar-art', 'lp-bar-art'], ['lp-np-thumb', 'lp-np-thumb']]) {
      const box = $(id);
      box.style.backgroundImage = '';
      box.classList.remove('pic');
      const h = [...(t.album || t.title || ' ')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      box.style.setProperty('--hue', String(h % 360));
      if (cls === 'lp-cover') $('lp-cover-t').textContent = t.album || t.title || '';
      paintPic(box, t);
    }
    paintUpNext();
    paintTime();
    try { djPaint(); } catch { /* DJ mode isn't set up yet */ }
  }
  // The album's name above the cover takes you to the album: yours in the library (scrolled to it,
  // showing all music if the current view hides it), a streamed one in the Music Downloader.
  function goToAlbum(t) {
    if (!t || !t.album) return;
    if (t.stream) {
      if (!t.albumUrl || typeof musicOpen !== 'function') return;
      setMode('toolbox');
      goMusic();
      musicOpen(t.albumUrl, { kind: 'Album', title: t.album, artist: t.artist, artistLinks: t.artistLinks, thumbnail: t.thumbnail });
      return;
    }
    setMode('player');
    if (!shown.includes(t)) { $('lib-q').value = ''; view = { kind: 'all', artist: null }; render(); }
    const i = albums.findIndex((a) => a.tracks.includes(t));
    const sec = i >= 0 ? $('lp-list').querySelectorAll('section.lp-album')[i] : null;
    if (!sec) return;
    sec.scrollIntoView({ block: 'start' });
    sec.classList.remove('flash');
    void sec.offsetWidth;
    sec.classList.add('flash');
  }
  $('lp-next-name').setAttribute('role', 'link');
  $('lp-next-name').addEventListener('click', () => { if ($('lp-next-name').classList.contains('go')) goToAlbum(current); });
  $('lp-next-name').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && $('lp-next-name').classList.contains('go')) { e.preventDefault(); goToAlbum(current); } });
  // Clicking the play bar's song: a streamed one opens in the Music Downloader; yours, in the Player.
  $('lp-bar-title').addEventListener('click', () => {
    if (guest) { if (guest.reveal) guest.reveal(); return; }
    const t = current;
    if (!t) return;
    if (!t.stream) { setMode('player'); return; }
    setMode('toolbox');
    goMusic();
    if (typeof musicOpen === 'function') { try { muReturn = null; } catch { /* not there */ } musicOpen(t.url, t, false); }
  });
  $('lp-bar-art').addEventListener('click', () => { if (guest) { if (guest.reveal) guest.reveal(); } else if (current) setMode('player'); });
  // Drag the playing song (its cover or title) out of the play bar: the file, into a folder or another app.
  for (const id of ['lp-bar-art', 'lp-bar-title']) {
    const d = $(id);
    d.draggable = true;
    d.addEventListener('dragstart', async (e) => {
      e.preventDefault();
      if (!current || current.stream || !current.path) return;
      const t = current;
      const cover = await coverOf(t.path).catch(() => null);
      if (current === t) window.api.libDrag(t.path, cover);
    });
  }
  $('lp-bar-art').title = 'Show it in the Player (lyrics, up next)';
  // A song's picture: your file's cover, or the site's thumbnail.
  // A streamed song: its picture kept on this PC once it's whole (offline too), else the site's.
  const picOf = (t) => (t.stream ? Promise.resolve(t.art || t.thumbnail || null) : coverOf(t.path));
  async function paintPic(box, t) {
    const url = await picOf(t);
    if (url) { box.style.backgroundImage = `url("${url}")`; box.classList.add('pic'); }
  }
  // Up next: the bar shows the next song and how many are left; the pop-up lists the queue from the
  // playing song on (built only while it's open; covers load as rows scroll into view).
  const UN_MAX = 11; // the playing song and the next 10
  const unIO = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { unIO.unobserve(en.target); const t = queue[Number(en.target.dataset.qi)]; if (t) paintPic(en.target, t); }
  }, { root: $('lp-upnext'), rootMargin: '200px' });
  function paintUpNext() {
    $('lp-next-name').textContent = current ? current.album || '' : '';
    const canGo = !!(current && current.album && (!current.stream || current.albumUrl));
    $('lp-next-name').classList.toggle('go', canGo);
    $('lp-next-name').tabIndex = canGo ? 0 : -1;
    $('lp-next-name').title = canGo ? `Go to the album "${current.album}"` : current && current.album ? current.album : '';
    const nx = queue[qi + 1];
    const left = current ? Math.max(0, queue.length - qi - 1) : 0;
    $('lp-un-next').textContent = nx ? `${nx.title || 'Unknown title'}${nx.artist ? ` · ${nx.artist}` : ''}` : current ? (repeat === 'all' && queue.length ? 'Back to the start' : 'Nothing after this') : '—';
    $('lp-un-n').textContent = left ? `${left.toLocaleString()} song${left === 1 ? '' : 's'}` : '';
    if (pre && (pre.i !== qi + 1 || pre.t !== queue[qi + 1])) { dropPre(); if (current && !audio.paused) preloadSoon(); }
    $('lp-un-count').textContent = left ? `${left.toLocaleString()} after this` : '';
    if (!$('lp-un-pop').classList.contains('hidden')) paintQueue();
  }
  function paintQueue() {
    const ol = $('lp-upnext');
    unIO.disconnect();
    ol.textContent = '';
    if (!current) { ol.append(el('li', 'lp-un-empty', 'Nothing playing.')); return; }
    const from = Math.max(0, qi), list = queue.slice(from, from + UN_MAX);
    list.forEach((t, k) => {
      const li = el('li', k === 0 ? 'now' : '');
      const art = coverBox('lp-mini', t.album || t.title || ' ', t.path || '');
      art.dataset.qi = String(from + k);
      unIO.observe(art);
      const tx = el('span', 'lp-un-tx');
      tx.append(el('b', '', t.title || 'Unknown title'), el('small', '', t.artist || ''));
      li.append(el('span', 'lp-un-i', k === 0 ? '▶' : String(k)), art, tx, el('span', 'd', fmtTime(t.duration)));
      li.title = t.unplayable ? `Couldn't play: ${t.unplayable}` : 'Double-click to play';
      if (t.unplayable) li.classList.add('bad');
      li.addEventListener('dblclick', () => start(from + k));
      ol.append(li);
    });
    if (queue.length - from > UN_MAX) ol.append(el('li', 'lp-un-empty', `… and ${(queue.length - from - UN_MAX).toLocaleString()} more`));
  }
  function toggleQueue(open = $('lp-un-pop').classList.contains('hidden')) {
    $('lp-un-pop').classList.toggle('hidden', !open);
    $('lp-un').classList.toggle('open', open);
    $('lp-un-btn').setAttribute('aria-expanded', String(open));
    if (open) { paintQueue(); $('lp-upnext').scrollTop = 0; }
    else { unIO.disconnect(); $('lp-upnext').textContent = ''; }
  }
  $('lp-un-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleQueue(); });
  $('lp-un-save').addEventListener('click', () => {
    const paths = queue.filter((t) => !t.stream && t.path).map((t) => t.path);
    if (!paths.length) { toast('Only your own songs can go in a playlist.'); return; }
    toggleQueue(false);
    setMode('player');
    newPlaylist(paths);
  });
  document.addEventListener('mousedown', (e) => { if (!$('lp-un-pop').classList.contains('hidden') && !$('lp-un').contains(e.target)) toggleQueue(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('lp-un-pop').classList.contains('hidden')) toggleQueue(false); });
  // Lyrics: the file's tags, else a .lrc beside it, else LRCLIB (online); synced ones follow the song.
  const lyricsOnline = () => { try { return localStorage.getItem('nabbit.lpLrclib') !== '0'; } catch { return true; } };
  let lyricsFor = null;
  async function loadLyrics(t) {
    lyricsFor = t;
    const box = $('lp-lyrics');
    box.textContent = '';
    lrc = null;
    box.append(el('p', 'lp-nolyr', 'Looking for lyrics…'));
    let r;
    if (t.stream) {
      const f = await window.api.streamLyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration }).catch(() => null);
      r = f ? { text: f.synced || f.plain || '', source: 'lrclib', instrumental: !!f.instrumental } : null;
    } else r = await window.api.libLyrics(t.path, { online: lyricsOnline() }).catch(() => null);
    if (current !== t) return;
    box.textContent = '';
    $('lp-lyr-src').textContent = r ? { tags: 'from tags', lrc: 'from .lrc', lrclib: 'from LRCLIB' }[r.source] || '' : '';
    if (r && r.instrumental) { box.append(el('p', 'lp-nolyr', 'Instrumental')); return; }
    const text = r && r.text;
    if (!text) { box.append(el('p', 'lp-nolyr', t.stream ? 'No lyrics found on LRCLIB.' : lyricsOnline() ? 'No lyrics found (tags, .lrc file or LRCLIB).' : 'No lyrics in the file or a .lrc beside it.')); return; }
    const synced = Core.parseLrc(text);
    if (synced) {
      lrc = synced.map((l) => {
        const p = box.appendChild(el('p', 'lp-ly seek', l.text || '♪'));
        p.title = `Jump to ${fmtTime(l.t)}`;
        p.addEventListener('click', () => { if (current === t) { seekTo(l.t); if (audio.paused) audio.play().catch(() => {}); } });
        return { ...l, el: p };
      });
      lyrAt = -1;
    } else for (const line of text.split(/\r?\n/)) box.append(el('p', 'lp-ly plain', line || ' '));
  }
  let lyrAt = -1;
  function syncLyrics() {
    if (!lrc || mode !== 'player') return; // hidden in the Toolbox: catches up when you come back
    // What's heard is a little behind the player's clock while effects run (player-fx.js).
    const t = audio.currentTime - fxDelay() + 0.15;
    let i = -1;
    for (let k = 0; k < lrc.length && lrc[k].t <= t; k++) i = k;
    if (i === lyrAt) return;
    if (lyrAt >= 0 && lrc[lyrAt]) lrc[lyrAt].el.classList.remove('on');
    lyrAt = i;
    if (i >= 0) {
      lrc[i].el.classList.add('on');
      const box = $('lp-lyrics');
      box.scrollTo({ top: lrc[i].el.offsetTop - box.offsetTop - box.clientHeight / 2 + 12, behavior: 'smooth' });
    }
  }

  // ---------- For the Music Downloader (renderer.js) and other tools ----------
  // items: { url, title, artist, artistLinks, album, albumUrl, thumbnail, duration }.
  window.Player = {
    /** Plays item, with list (the songs around it) as the queue. */
    play(item, list = null, index = null) {
      const items = (list && list.length ? list : [item]).filter((x) => x && x.url).map((x) => ({ ...x, stream: true, playable: true }));
      if (!items.length) return;
      let i = index != null ? index : Math.max(0, items.findIndex((x) => x.url === item.url));
      base = items;
      [queue, i] = order(base, Math.min(i, items.length - 1));
      start(i);
    },
    /** To the Music Downloader (Toolbox), then fn (e.g. opening an artist's page there). */
    toMusic(fn) { setMode('toolbox'); if (typeof goMusic === 'function') goMusic(); if (fn) fn(); },
    /** To Player mode. */
    toPlayer() { if (mode !== 'player') setMode('player'); },
    /** To the Toolbox. */
    toToolbox() { if (mode !== 'toolbox') setMode('toolbox'); },
    /** The streamed song playing (null for your own files). */
    get nowPlaying() { return current && current.stream ? current : null; },
    /** Pauses the music (another tool is about to play something). */
    pause() { if (!audio.paused) audio.pause(); },
    /** Another tool playing through the play bar (Mastering): g = { title, sub, wave (PC.waveShape),
     *  duration(), time(), playing(), toggle(), pause(), seek(sec), volume(gain), reveal() }. The music
     *  pauses; the bar's play, position, volume and title then work the guest, until the player plays
     *  a song again (or the bar's ✕). → update(), to call when the guest's state changes. */
    attach(g) { attachGuest(g); return () => { if (guest === g) { paintBar(); paintTime(); } }; },
    detach(g) { detachGuest(g); },
    /** The bar's volume (0..1, squared like the player's). */
    get volume() { const v = Number($('lp-vol').value) / 100; return audio.muted ? 0 : v * v; },
    /** Audio Tools' pitch and tempo for one file (null: none): { path, semis, tempo, record }. Applies at once if it's playing. */
    pitchTempo(p) {
      // force: the shifter on even at the same pitch (formants moved, a chord, the robot).
      // rt: the time shaper, live: { shape: { points, curves, cycle, steps }, bpm, offset }.
      // sl: slice stretch / slice map, live: { key, pcm, cuts, mode } (PlayerFx.slices).
      pt = p && p.path ? { path: p.path, semis: Number(p.semis) || 0, tempo: Math.max(0.25, Math.min(4, Number(p.tempo) || 1)), record: !!p.record, force: !!p.force, rt: p.rt || null, sl: p.sl && p.sl.pcm ? p.sl : null } : null;
      if (current && !current.stream) applySpeed();
    },
    /** Play next (next) or add to the queue: files from anywhere. → false if none can play. */
    async queueFiles(paths, next) {
      let list = [];
      try { list = (await window.api.playFilesInfo(paths)).filter((t) => t && t.playable); } catch { /* none */ }
      if (!list.length) return false;
      const lib = new Map(tracks.map((t) => [t.path, t]));
      list = list.map((t) => lib.get(t.path) || t);
      queueSongs(list, next);
      return true;
    },
    /** Streamed songs (like play()'s) after the current one (next) or at the end of the queue. */
    queueItems(items, next) { queueSongs((items || []).filter((x) => x && x.url).map((x) => ({ ...x, stream: true, playable: true })), next); },
    /** Your playlists: [{ id, name }]. */
    get playlistList() { return playlists.map((p) => ({ id: p.id, name: p.name })); },
    /** Files from anywhere into a playlist (id), or a new one (no id). */
    async addToPlaylist(id, paths) {
      paths = (paths || []).filter((p) => typeof p === 'string' && p);
      if (!paths.length) return;
      try { for (const t of await window.api.playFilesInfo(paths)) if (t && !tracks.some((x) => x.path === t.path)) outside.set(t.path, t); } catch { /* read when shown */ }
      if (id) addToPlaylist(id, paths);
      else { const pl = newPlaylist(paths, false); toast(`Added ${paths.length === 1 ? '1 song' : `${paths.length} songs`} to ${pl.name}`); }
    },
    toast: (text) => toast(text),
    /** Your library for Nabbit Home: { tracks, playlists } (loaded first if Player mode hasn't yet). */
    async library() { if (!loaded) await load(); return { tracks, playlists }; },
    /** Your plays: { key: { n, last, hits, item } } (see logPlay). */
    get plays() { return plays; },
    /** A file's cover (a data URL, or null). */
    cover: (p) => coverOf(p),
    /** Plays your own songs (library objects): list as the queue, from list[i]. */
    playTracks(list, i = 0) {
      list = (list || []).filter((t) => t && t.playable);
      if (!list.length) return;
      base = list.slice();
      [queue, i] = order(base, Math.max(0, Math.min(i, list.length - 1)));
      start(i);
    },
    /** Opens a view of the library (Local Files): { kind: 'all'|'recent'|'loved'|'rated'|'playlist', id?, artist? }. */
    openView(v) { view = { kind: v.kind || 'all', id: v.id, artist: v.artist || null }; if (window.Sources) window.Sources.set('local'); render(); $('lp-list').scrollTop = 0; navView(); },
    /** Plays files from anywhere (the Toolbox's lists): paths in order, from paths[i]. → false if none can play. */
    async playFiles(paths, i = 0) {
      const want = paths[i];
      let list = [];
      try { list = (await window.api.playFilesInfo(paths)).filter((t) => t && t.playable); } catch { /* none */ }
      if (!list.length) return false;
      base = list;
      let k = Math.max(0, list.findIndex((t) => t.path.toLowerCase() === String(want).toLowerCase()));
      [queue, k] = order(base, k);
      start(k);
      return true;
    },
    /** Where the player is: { path, time (s), rate } (for Audio Tools' time shaper's playhead). */
    get position() { return current && !current.stream ? { path: current.path, time: audio.currentTime, rate: audio.playbackRate || 1, playing: !audio.paused } : null; },
    /** A song's beat grid, set by hand ({ bpm, offset } in s, or null to go back to the analysis). Kept. */
    setGrid(p, g) {
      gridOf(p);
      const k = String(p).toLowerCase();
      if (g && g.bpm > 0) grids[k] = { bpm: g.bpm, offset: g.offset || 0 }; else delete grids[k];
      try { localStorage.setItem('nabbit.grids', JSON.stringify(grids)); } catch { /* not kept */ }
      drawWave(true);
    },
    getGrid: (p) => gridOf(p),
    /** The beat of what's playing (Nabbit dances to it): your grid, else DJ mode's analysis, started
     *  for the playing song if it hasn't been, DJ mode on or off (the tempo and first beat; the key
     *  isn't shown unless DJ mode is on). { bpm, offset, time (s into the song, as heard), rate (the
     *  playing speed: Speed, DJ stretches, pitch and tempo) }, or null until it's known. */
    get beat() {
      if (!current || audio.paused || guest) return null;
      const own = !current.stream ? gridOf(current.path) : null;
      const an = own ? null : djGet(current);
      const g = own || (an && an.bpm > 0 ? an : null);
      if (!g) return null;
      const rate = audio.playbackRate || 1;
      return { bpm: g.bpm, offset: g.offset || 0, time: audio.currentTime - pitchLag(audio) * rate, rate };
    },
    /** That file from time t: sought if it's the one playing, else played from there. */
    async seekFile(p, t) {
      if (current && !current.stream && current.path.toLowerCase() === String(p).toLowerCase()) { seekTo(t); if (audio.paused) audio.play().catch(() => {}); return; }
      if (await this.playFiles([p], 0)) { const go = () => { audio.removeEventListener('loadedmetadata', go); seekTo(t); }; if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go); }
    },
    /** The file playing (or paused) in the player, if it's one of yours. */
    get nowPath() { return current && !current.stream ? current.path : null; },
    /** Which song is loaded (a file's path or a stream's address), '' for none: to tell when it changes. */
    get songId() { return current ? String((current.stream ? current.url : current.path) || '') : ''; },
    get isPlaying() { return !!current && !audio.paused; },
    /** Looks a song up ahead of time (hovering its ▶), so it starts quicker. */
    warm(url) { if (url) window.api.streamWarm(url, null).catch(() => {}); },
  };

  // ---------- The last song and queue, kept between runs ----------
  // Saved when a song starts, every few seconds while playing, on pause and when Nabbit closes; on the
  // next start the song comes back paused at the same point, with its queue (up to 2,000 songs).
  const SESSION = 'nabbit.lpSession';
  let restoredIdle = false; // a song brought back paused, not played yet
  onMedia('play', () => { restoredIdle = false; });
  const pack = (t) => (t.stream
    ? { s: 1, url: t.url, title: t.title, artist: t.artist, artistLinks: t.artistLinks, album: t.album, albumUrl: t.albumUrl, thumbnail: t.thumbnail, duration: t.duration }
    : { p: t.path });
  function saveSession() {
    try {
      if (!current) { localStorage.removeItem(SESSION); return; }
      const from = Math.max(0, qi - 500), list = queue.slice(from, from + 2000);
      localStorage.setItem(SESSION, JSON.stringify({ q: list.map(pack), qi: qi - from, at: Math.round((audio.currentTime || 0) * 10) / 10, v: 1 }));
    } catch { /* not kept */ }
  }
  setInterval(() => { if (current && !audio.paused) saveSession(); }, 5000);
  onMedia('pause', saveSession);
  window.addEventListener('beforeunload', saveSession);
  // Saved before playlists stopped naming their songs' album: a likes / playlist / mix "album" goes.
  function notAlbum(t) {
    if (t.album && (/\(Likes\)$/i.test(t.album) || /soundcloud\.com\/[^/]+\/(likes|reposts)\b|[?&]list=(PL|RD|LM|LL|WL)/i.test(t.albumUrl || ''))) { t.album = null; t.albumUrl = null; }
    return t;
  }
  async function restoreSession() {
    // After every script has run (the effects, player-fx.js, decide how your files are loaded).
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    let s;
    try { s = JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return; }
    if (!s || !Array.isArray(s.q) || !s.q.length || current) return;
    let byPath = new Map();
    if (s.q.some((x) => x.p)) {
      try { const r = await window.api.libGet(); byPath = new Map((r.tracks || []).map((t) => [t.path, t])); } catch { /* library unavailable */ }
    }
    if (window.PlayerFx && window.PlayerFx.ready) await window.PlayerFx.ready();
    if (current) return; // something started meanwhile
    const items = [];
    let at = -1;
    s.q.forEach((x, k) => {
      const t = x.s ? notAlbum({ ...x, stream: true, playable: true }) : byPath.get(x.p);
      if (!t) return; // gone from the library
      if (k === s.qi) at = items.length;
      items.push(t);
    });
    if (!items.length || at < 0) return;
    // The library list uses the same objects, so the playing row is marked once Player mode shows it.
    if (!loaded && byPath.size) { tracks = [...byPath.values()]; }
    queue = items; base = items.slice(); qi = at; current = items[at];
    restoredIdle = true;
    const t = current, seq = ++loadSeq, pos = Math.max(0, Number(s.at) || 0);
    songStarted(t);
    if (t.stream) { paintVideo(); await openStream(t, seq, { at: pos, play: false }); return; }
    curSrc = sourceFor(t);
    if (window.PlayerFx && window.PlayerFx.level) { window.PlayerFx.level(audio, 1); window.PlayerFx.pitch(audio, null); }
    if (!(await setLocalSrc(curSrc, seq))) return;
    applySpeed();
    const toPos = () => { try { audio.currentTime = Math.min(pos, (audio.duration || pos) - 0.5); } catch { /* not ready */ } paintTime(); };
    if (pos) { if (audio.readyState >= 1) toPos(); else audio.addEventListener('loadedmetadata', toPos, { once: true }); }
    paintVideo();
    loadLoop(t);
    paintBar();
  }

  setMode(mode);
  restoreSession();
})();
