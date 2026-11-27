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
    // striped bar), on the play bar in the Toolbox.
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
      if (view.artist && !artistsOf(t).includes(view.artist)) return false;
      return !q || [t.title, t.artist, t.album, t.albumArtist, t.genre].some((x) => String(x || '').toLowerCase().includes(q));
    });
  }

  // ---------- Sidebar ----------
  function renderSide() {
    const views = [['all', 'All music', tracks.length], ['recent', 'Recently added', tracks.filter((t) => t.mtime > Date.now() - 30 * 86400000).length],
      ['loved', 'Loved', tracks.filter((t) => t.loved).length], ['rated', '4 stars and up', tracks.filter((t) => t.rating >= 4).length]];
    const vb = $('lib-views');
    vb.textContent = '';
    for (const [k, label, n] of views) {
      const b = el('button', 'lib-item' + (view.kind === k && !view.artist ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.append(el('span', '', label), el('em', '', n.toLocaleString()));
      b.addEventListener('click', () => { view = { kind: k, artist: null }; render(); });
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
      b.addEventListener('click', () => { view = { kind: 'playlist', id: pl.id, artist: null }; render(); $('lp-list').scrollTop = 0; });
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
    for (const t of tracks) for (const a of artistsOf(t)) counts.set(a, (counts.get(a) || 0) + 1);
    const ab = $('lib-artists');
    ab.textContent = '';
    for (const [name, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))) {
      const b = el('button', 'lib-item artist' + (view.artist === name ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.title = name;
      b.append(el('span', '', name), el('em', '', String(n)));
      b.addEventListener('click', () => { view = view.artist === name ? { kind: 'all', artist: null } : { kind: 'all', artist: name }; render(); $('lp-list').scrollTop = 0; });
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
    $('lp-sort').textContent = `Sort: ${sortBy === 'folder' ? 'Folder' : 'Album'}`;
    shown = albums.flatMap((a) => a.tracks);
    $('lp-title').textContent = view.artist || { all: 'All music', recent: 'Recently added', loved: 'Loved', rated: '4 stars and up' }[view.kind];
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
  let yt = null; // { forPath, file, synced, title, channel } for the current song
  let ytAudio = 'youtube';
  try { ytAudio = localStorage.getItem('nabbit.lpYtAudio') === 'local' ? 'local' : 'youtube'; } catch { /* default */ }
  // Local / YouTube audio, switched live (same point in the song).
  function setYtAudio(mode) {
    ytAudio = mode;
    try { localStorage.setItem('nabbit.lpYtAudio', mode); } catch { /* none */ }
    if (!(yt && current && yt.forPath === current.path)) return;
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
  const sourceFor = (t) => (videoOn && videoFor(t) ? videoFor(t).path : videoOn && yt && yt.forPath === t.path && !yt.synced ? yt.file : t.path);
  function paintVideo() {
    const local = videoFor(current);
    $('lp-vtoggle').classList.toggle('hidden', !current || !!current.stream);
    const ytShow = !!(videoOn && !local && yt && current && yt.forPath === current.path);
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
        if (nx && nx.playable && nx.title) await loopAsk(nx, k > 2).catch(() => {});
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
    if (!current || curSrc === want) return;
    const at = audio.currentTime, playing = !audio.paused;
    curSrc = want;
    if (!(await setLocalSrc(want))) return;
    applySpeed();
    audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, (audio.duration || at) - 0.5); } catch { /* ignore */ } }, { once: true });
    if (playing) audio.play().catch(() => {});
  }
  function syncYt(force = false) {
    // The muted music video only runs while you can see it (not in the Toolbox).
    if (!(mode === 'player' && videoOn && yt && yt.synced && current && yt.forPath === current.path)) { if (!ytv.paused) ytv.pause(); return; }
    const want = Math.max(0, audio.currentTime - fxDelay()); // in step with what's heard, not the player's clock
    if (force || Math.abs(ytv.currentTime - want) > 0.25) { try { ytv.currentTime = want; } catch { /* not ready */ } }
    ytv.playbackRate = audio.playbackRate;
    if (audio.paused && !ytv.paused) ytv.pause();
    if (!audio.paused && ytv.paused) ytv.play().catch(() => {});
  }
  for (const ev of ['play', 'pause', 'seeked', 'ratechange']) onMedia(ev, () => syncYt(ev === 'seeked'));
  onMedia('timeupdate', () => syncYt(false));
  async function loadYt(t, next = false) {
    if (!t || t.stream || videoFor(t)) return;
    ytBusy = 'Finding…';
    paintVideo();
    try {
      const r = await window.api.libYtVideo(t.path, { next });
      if (current !== t) return;
      // Audio: your file (the video muted and kept in step) or the video's own sound; your choice, remembered.
      yt = { forPath: t.path, file: r.file, synced: ytAudio === 'local', title: r.title, channel: r.channel };
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
      $('lp-vtoggle').textContent = 'No video';
      $('lp-vtoggle').title = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setTimeout(() => { if (current === t) paintVideo(); }, 2500);
      return;
    }
    paintVideo();
  }
  window.api.onLibYtProgress(({ path, percent }) => {
    if (!current || current.path !== path || !ytBusy) return;
    ytBusy = `Video ${Math.floor(percent)}%`;
    $('lp-vtoggle').textContent = ytBusy;
  });
  $('lp-yt-next').addEventListener('click', () => { if (current) { const t = current; yt = null; swapSource(t.path); ytv.removeAttribute('src'); ytv.load(); paintVideo(); loadYt(t, true); } });
  $('lp-vtoggle').addEventListener('click', async () => {
    if (ytBusy) return;
    videoOn = !videoOn;
    try { localStorage.setItem('nabbit.lpVideo', videoOn ? '1' : '0'); } catch { /* none */ }
    if (current) {
      if (videoOn && !videoFor(current) && !(yt && yt.forPath === current.path)) { paintVideo(); loadYt(current); return; }
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
    const url = current.stream ? current.thumbnail : await window.api.libCover(current.path, 'full').catch(() => null);
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
    while (i < queue.length && !queue[i].playable) i++;
    if (i >= queue.length) { stop(); return; }
    // The next song already loaded on the other player: switch to it (quicker, and no gap).
    if (pre && pre.i === i && pre.t === queue[i] && !queue[i].stream) { handover(); return; }
    dropPre();
    qi = i;
    current = queue[i];
    const t = current, seq = ++loadSeq;
    songStarted(t);
    if (t.stream) {
      audio.pause();
      paintVideo();
      loadLoop(t);
      await openStream(t, seq);
      return;
    }
    curSrc = sourceFor(t);
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
    lfStart(t);
    stream = null;
    if (!yt || yt.forPath !== t.path) { yt = null; ytBusy = null; ytv.removeAttribute('src'); ytv.load(); }
    if (!loop || loop.forPath !== loopKey(t)) { loop = null; loopBusy = false; }
    wave = null;
    drawWave(true);
    if (!t.stream) loadWave(t);
    showBar();
    paintNow();
    loadLyrics(t);
    mediaMeta(t);
  }

  // ---------- Last.fm ----------
  // "Now playing" when a song starts playing; a scrobble once you've heard half of it or 4 minutes
  // (counting only time actually played, not skipped over). main.js / lastfm.js do the sending.
  let lf = { t: null, started: 0, played: 0, last: null, done: false, told: false };
  const lfInfo = (t) => ({ title: t.title, artist: t.artist, albumArtist: t.albumArtist, album: t.album, duration: audio.duration || t.duration });
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
      if (window.api.lastfmScrobble) window.api.lastfmScrobble(lfInfo(current), lf.started).catch(() => {});
    }
  });
  onMedia('seeked', () => { lf.last = audio.currentTime; });

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
    const i = qi + 1, t = queue[i];
    if (pre && pre.i === i && pre.t === t) return;
    dropPre();
    if (repeat === 'one' || !PC.canGapless(current, t, { videoShown: videoOn }) || videoFor(t)) return;
    const el = idleEl(), seq = loadSeq;
    let url = null;
    if (window.PlayerFx && window.PlayerFx.routed()) url = await window.api.mediaUrl(t.path).catch(() => null);
    if (seq !== loadSeq || queue[i] !== t) return;
    if (url) el.crossOrigin = 'anonymous'; else { el.removeAttribute('crossorigin'); url = fileUrl(t.path); }
    el.src = url;
    el.load();
    pre = { el, t, i };
  }
  // A preloaded song that won't play is forgotten (it'll load the usual way).
  for (const m of mediaEls) m.addEventListener('error', () => { if (pre && pre.el === m && m !== audio) dropPre(); });
  function checkHandover() {
    if (!pre || audio.paused || seeking || !current || current.stream) return;
    if (pre.el.readyState < 3) return;
    if (PC.handoverDue(audio.currentTime, audio.duration, 0.035 * (audio.playbackRate || 1))) handover();
  }
  function handover() {
    const old = audio, { el, t, i } = pre;
    pre = null;
    clearTimeout(preTimer);
    loadSeq++;
    el.muted = old.muted;
    el.volume = old.volume;
    audio = el;
    old.classList.remove('active');
    el.classList.add('active');
    if (window.PlayerFx && window.PlayerFx.setActive) window.PlayerFx.setActive(el);
    applySpeed();
    el.play().catch(() => {});
    // The old one stops a moment later (its last few milliseconds overlap rather than leave a gap).
    setTimeout(() => { if (old !== audio) { old.pause(); old.removeAttribute('src'); old.load(); } }, 80);
    qi = i;
    current = t;
    curSrc = t.path;
    songStarted(t);
    paintVideo();
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
  // at: start from there; fresh: look the song up again (its address expired); play: start playing.
  async function openStream(t, seq, { at = 0, fresh = false, play = true } = {}) {
    setStreamState(playDownload ? 'Downloading' : 'Loading', 'loading');
    let s;
    try {
      s = await window.api.streamOpen(t.url, null, { fresh, meta: { title: t.title, artist: t.artist, duration: t.duration } });
    } catch (e) {
      if (seq === loadSeq) streamFail(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return;
    }
    if (seq !== loadSeq) return;
    // Fill gaps (a pasted link or an album track) with what the lookup found.
    if (s.meta) {
      let more = false;
      for (const k of ['title', 'artist', 'album', 'thumbnail', 'duration']) if (!t[k] && s.meta[k]) { t[k] = s.meta[k]; more = true; }
      if (more) { paintNow(); mediaMeta(t); }
    }
    stream = { key: s.key, cachedNow: !!(s.cached || s.local), retried: fresh, replaced: !!s.replaced };
    if (stream.cachedNow && !wave) loadWave(t);
    setStreamState(s.local ? 'Local file' : s.cached ? 'Cached' : 'Streaming', s.local ? 'local' : s.cached ? 'cached' : 'stream');
    curSrc = s.src;
    audio.crossOrigin = 'anonymous'; // the stream server allows it, so the effects can read it
    audio.src = s.src;
    applySpeed();
    if (at) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(at, (audio.duration || at) - 0.5); } catch { /* not ready */ } }, { once: true });
    if (play) { try { await audio.play(); } catch { /* the error handler deals with it */ } }
    paintBar();
    prefetchNext();
  }
  let streamKind = '';
  function setStreamState(text, kind) {
    streamKind = kind;
    let label = text, tip = { stream: 'Playing from the site; saving to the cache as it plays', cached: 'Saved on this PC: plays offline',
      local: 'Downloaded to a temporary file before playing; deleted when the song changes' }[kind] || '';
    if (stream && stream.replaced && ['stream', 'cached', 'local'].includes(kind)) {
      label = 'Via YT Music';
      tip = "SoundCloud's copy is DRM-protected, so this plays the same song from YouTube Music.";
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
  function prefetchNext() {
    clearTimeout(prefetchTimer);
    const nx = queue[qi + 1];
    if (nx && nx.stream) prefetchTimer = setTimeout(() => window.api.streamPrefetch(nx.url, null).catch(() => {}), 1500);
  }
  window.api.onStreamProgress(({ url, percent }) => {
    if (!current || !current.stream || current.url !== url || streamKind !== 'loading') return;
    setStreamState(percent == null ? 'Downloading' : `Downloading ${percent}%`, 'loading');
  });
  window.api.onStreamCached((key) => {
    if (!stream || key !== stream.key) return;
    stream.cachedNow = true;
    if (streamKind === 'stream') setStreamState('Cached', 'cached');
    if (!wave && current) loadWave(current);
  });
  onMedia('waiting', () => { if (current && current.stream && streamKind === 'stream') $('lp-bar-state').textContent = 'Buffering'; });
  onMedia('playing', () => { if (current && current.stream && streamKind === 'stream') $('lp-bar-state').textContent = 'Streaming'; });
  // Seeking: a song still arriving can't jump ahead yet; once it's cached, it reloads there.
  function seekTo(time) {
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
    const hadStream = queue.some((x) => x.stream);
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
    paintNow();
    paintVideo();
    showBar();
  }
  $('lp-close').addEventListener('click', closePlayer);
  // The play bar: always in Player mode; in the Toolbox while something is loaded.
  function showBar() {
    const on = mode === 'player' || !!current;
    $('lp-bar').classList.toggle('hidden', !on);
    document.body.classList.toggle('lp-on', on);
  }
  onMedia('play', paintBar);
  onMedia('pause', paintBar);
  onMedia('timeupdate', () => { paintTime(); syncLyrics(); checkHandover(); });
  onMedia('loadedmetadata', paintTime);
  $('lp-play').addEventListener('click', toggle);
  function toggle() {
    if (!current) { if (shown.length) playFrom(0); return; }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  $('lp-next').addEventListener('click', next);
  $('lp-prev').addEventListener('click', prev);
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
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', toggle);
    navigator.mediaSession.setActionHandler('pause', toggle);
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    try { navigator.mediaSession.setActionHandler('seekto', (d) => seekTo(d.seekTime)); } catch { /* older */ }
  }
  // ---------- Keyboard (Player mode; not while typing in a box) ----------
  const KEYS = [
    ['Space', 'Play / pause'], ['← →', '5 seconds back / on'], ['Shift + ← →', 'Previous / next song'],
    ['↑ ↓', 'Volume up / down'], ['M', 'Mute'], ['S', 'Shuffle'], ['R', 'Repeat: off, all, this song'],
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
    if (e.code === 'Space') { if (a && a.tagName === 'BUTTON') return; toggle(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!current) return;
      const fwd = k === 'ArrowRight';
      if (e.shiftKey) { if (fwd) next(); else prev(); } else seekTo(audio.currentTime + (fwd ? 5 : -5));
    } else if (k === 'ArrowUp' || k === 'ArrowDown') volBy(k === 'ArrowUp' ? 5 : -5);
    else if (k === 'm' || k === 'M') $('lp-mute').click();
    else if (k === 's' || k === 'S') $('lp-shuffle').click();
    else if (k === 'r' || k === 'R') $('lp-repeat').click();
    else if (k === 'q' || k === 'Q') toggleQueue();
    else if (k === 'v' || k === 'V') { if (!$('lp-vtoggle').classList.contains('hidden')) $('lp-vtoggle').click(); }
    else if (k === '?') showKeys();
    else done = false;
    if (done) e.preventDefault();
  });

  // Seek, volume, speed
  let seeking = false;
  $('lp-seek').addEventListener('input', () => { seeking = true; $('lp-t0').textContent = fmtTime((Number($('lp-seek').value) / 1000) * (audio.duration || 0)); drawWave(); });
  $('lp-seek').addEventListener('change', () => { const d = audio.duration || (current && current.duration) || 0; seeking = false; if (d) seekTo((Number($('lp-seek').value) / 1000) * d); });
  function paintTime() {
    const d = audio.duration || (current && current.duration) || 0;
    if (!seeking) {
      $('lp-t0').textContent = fmtTime(audio.currentTime);
      $('lp-seek').value = String(d ? Math.round((audio.currentTime / d) * 1000) : 0);
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
  function drawWave(force = false) {
    const c = $('lp-wave');
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const d = audio.duration || (current && current.duration) || 0;
    const frac = seeking ? Number($('lp-seek').value) / 1000 : d ? Math.min(1, audio.currentTime / d) : 0;
    const dpr = window.devicePixelRatio || 1;
    const key = `${w}|${h}|${dpr}|${Math.round(frac * w * dpr)}|${!!wave}|${document.documentElement.className}`;
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
    const bars = PC.waveBars(wave, n);
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
    if (current) { g.fillStyle = text; g.fillRect(Math.min(w - 1, Math.max(0, Math.round(px))), 0, 1, h); }
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
  $('lp-vol').addEventListener('input', () => { applyVol(); audio.muted = false; paintMute(); try { localStorage.setItem('nabbit.lpVol', $('lp-vol').value); } catch { /* none */ } });
  $('lp-mute').addEventListener('click', () => { audio.muted = !audio.muted; paintMute(); });
  // Scrolling on the play bar: volume (2 % a notch); on the position bar: 5 seconds back or forward.
  $('lp-bar').addEventListener('wheel', (e) => {
    e.preventDefault();
    const up = e.deltaY < 0;
    if (e.target === $('lp-seek') || e.target.closest('.lp-time')) {
      if (!current) return;
      seekTo(audio.currentTime + (up ? 5 : -5));
      return;
    }
    const v = Math.max(0, Math.min(100, Number($('lp-vol').value) + (up ? 2 : -2)));
    $('lp-vol').value = String(v);
    $('lp-vol').dispatchEvent(new Event('input'));
  }, { passive: false });
  // Effects: a placeholder for now.
  function paintMute() { $('lp-mute').classList.toggle('muted', audio.muted || Number($('lp-vol').value) === 0); }
  function applySpeed() {
    const on = $('lp-speed-on').checked;
    const pct = Number($('lp-speed').value);
    audio.preservesPitch = false; // like changing the sample rate: faster is higher
    audio.playbackRate = on ? Math.max(0.5, Math.min(4, 1 + pct / 100)) : 1;
    const semis = on ? 12 * Math.log2(audio.playbackRate) : 0;
    const st = Math.abs(semis - Math.round(semis)) < 0.02 && Math.round(semis) ? ` · ${semis > 0 ? '+' : ''}${Math.round(semis)} st` : '';
    $('lp-speed-v').textContent = `${on ? Math.round((100 + pct) * 10) / 10 : 100}%${st}`;
    $('lp-speed').disabled = !on;
  }
  $('lp-speed-on').addEventListener('change', applySpeed);
  $('lp-speed').addEventListener('input', () => applySpeed());
  $('lp-speed').addEventListener('dblclick', () => { $('lp-speed').value = '0'; applySpeed(); });
  // Scroll on the speed slider: one semitone (100 cents) up or down; switches speed on.
  const SEMI = 2 ** (1 / 12);
  function onSpeedWheel(e) {
    e.preventDefault();
    const rate = 1 + Number($('lp-speed').value) / 100;
    const semis = Math.round(12 * Math.log2(rate)) + (e.deltaY < 0 ? 1 : -1);
    const next = Math.max(0.5, Math.min(4, SEMI ** semis));
    $('lp-speed').value = String(Math.round((next - 1) * 1000) / 10);
    $('lp-speed-on').checked = true;
    applySpeed();
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
    $('lp-bar').classList.toggle('playing', !audio.paused);
    // Something's playing: the bars on the Player switch move.
    document.body.classList.toggle('lp-playing', !audio.paused && !!current);
    $('mode-eq').title = current && !audio.paused ? `Playing: ${current.title}` : '';
    $('lp-play').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    $('lp-play').title = audio.paused ? 'Play (Space)' : 'Pause (Space)';
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
      b.addEventListener('click', (e) => { e.stopPropagation(); setMode('toolbox'); goMusic(); if (a.url && typeof openArtist === 'function') openArtist(a.url, { title: a.name }); else openArtistPage(a.name); });
      f.append(b);
    });
    return f;
  }
  function goMusic() {
    const tab = document.querySelector('.tab[data-mode="music"]');
    if (tab && !tab.classList.contains('active')) tab.click();
  }
  function openArtistPage(name) {
    if (!window.nabbitOpenArtist) return;
    setMode('toolbox');
    window.nabbitOpenArtist(String(name).trim());
  }
  function paintNow() {
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
  }
  // Clicking the play bar's song: a streamed one opens in the Music Downloader; yours, in the Player.
  $('lp-bar-title').addEventListener('click', () => {
    const t = current;
    if (!t) return;
    if (!t.stream) { setMode('player'); return; }
    setMode('toolbox');
    goMusic();
    if (typeof musicOpen === 'function') { try { muReturn = null; } catch { /* not there */ } musicOpen(t.url, t, false); }
  });
  $('lp-bar-art').addEventListener('click', () => { if (current) setMode('player'); });
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
  const picOf = (t) => (t.stream ? Promise.resolve(t.thumbnail || null) : coverOf(t.path));
  async function paintPic(box, t) {
    const url = await picOf(t);
    if (url) { box.style.backgroundImage = `url("${url}")`; box.classList.add('pic'); }
  }
  // Up next: the bar shows the next song and how many are left; the pop-up lists the queue from the
  // playing song on (built only while it's open; covers load as rows scroll into view).
  const UN_MAX = 300;
  const unIO = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { unIO.unobserve(en.target); const t = queue[Number(en.target.dataset.qi)]; if (t) paintPic(en.target, t); }
  }, { root: $('lp-upnext'), rootMargin: '200px' });
  function paintUpNext() {
    $('lp-next-name').textContent = current ? current.album || '' : '';
    $('lp-next-name').title = current && current.album ? current.album : '';
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
      li.title = 'Double-click to play';
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
  async function loadLyrics(t) {
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
    /** The streamed song playing (null for your own files). */
    get nowPlaying() { return current && current.stream ? current : null; },
    /** Pauses the music (another tool is about to play something). */
    pause() { if (!audio.paused) audio.pause(); },
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
      const t = x.s ? { ...x, stream: true, playable: true } : byPath.get(x.p);
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
