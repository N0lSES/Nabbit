// Recent downloads: the box on the right. "Now" holds the running jobs (renderer.js puts them in
// #jobs); "Done" lists the files jobs made lately (main.js keeps the list). A file can be dragged out
// of the window onto the desktop, a folder or another app, like a browser's downloads; double-click
// plays it; right-click: open, show in folder, download again, remove, delete.
(() => {
  const $ = (id) => document.getElementById(id);
  const box = $('recent'), list = $('rc-list'), menu = $('rc-menu'), toggle = $('recent-toggle');
  if (!box) return;
  let items = [];
  const thumbs = new Map(); // path → data URL | null

  // ---------- Showing / hiding the box ----------
  // Wide windows: shown unless hidden with the sidebar button. Narrow ones: it slides over the page.
  const wide = window.matchMedia('(min-width: 1180px)');
  let hidden;
  try { hidden = localStorage.getItem('nabbit.recentHidden') === '1'; } catch { hidden = false; }
  let overlay = false;
  function layout() {
    const show = wide.matches ? !hidden : overlay;
    document.body.classList.toggle('recent-on', show);
    document.body.classList.toggle('recent-over', show && !wide.matches);
    toggle.setAttribute('aria-expanded', String(show));
  }
  toggle.addEventListener('click', () => {
    if (wide.matches) { hidden = !hidden; try { localStorage.setItem('nabbit.recentHidden', hidden ? '1' : '0'); } catch { /* none */ } }
    else overlay = !overlay;
    layout();
  });
  wide.addEventListener('change', () => { overlay = false; layout(); });
  document.addEventListener('mousedown', (e) => {
    if (overlay && !wide.matches && !box.contains(e.target) && !toggle.contains(e.target) && !menu.contains(e.target)) { overlay = false; layout(); }
  });
  layout();

  // ---------- The list ----------
  const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);
  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 172800) return 'yesterday';
    return new Date(t).toLocaleDateString();
  }
  const kindOf = (name) => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'ogv', 'flv', 'wmv', 'ts', 'gif'].includes(ext)) return 'video';
    if (['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'aiff', 'alac', 'wma'].includes(ext)) return 'audio';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
    return 'file';
  };
  async function load() {
    try { items = await window.api.recentList(); } catch { items = []; }
    render();
  }
  function render() {
    const q = $('rc-filter').value.trim().toLowerCase();
    const shown = items.filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.title || '').toLowerCase().includes(q));
    list.textContent = '';
    if (!shown.length) {
      list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: items.length ? 'Nothing matches.' : 'Files you download or make show up here.' }));
      return;
    }
    for (const r of shown.slice(0, 150)) {
      const li = document.createElement('li');
      li.className = 'rc-item' + (r.exists ? '' : ' gone');
      li.draggable = !!r.exists;
      li.tabIndex = 0;
      li.title = r.exists ? `${r.path}\nDrag it out of the window to copy it somewhere.` : `${r.path}\n(moved or deleted)`;
      // Songs and videos: ▶ in the grip's place (shown on hover), playing in the player, then the rest of the list.
      let grip;
      if (r.exists && typeof filePlayButton === 'function' && canPlayFile(r.path)) {
        grip = filePlayButton(() => shown.filter((x) => x.exists).map((x) => x.path), r.path, { num: '⋮⋮' });
        grip.classList.add('rc-grip');
        grip.draggable = false;
      } else {
        grip = Object.assign(document.createElement('span'), { className: 'rc-grip', textContent: '⋮⋮' });
        grip.setAttribute('aria-hidden', 'true');
      }
      const th = document.createElement('span');
      th.className = `rc-thumb ${kindOf(r.name)}`;
      th.setAttribute('aria-hidden', 'true');
      const ext = (r.name.split('.').pop() || '').toUpperCase();
      th.append(Object.assign(document.createElement('i'), { textContent: ext.slice(0, 4) }));
      const tx = document.createElement('span');
      tx.className = 'rc-tx';
      tx.append(Object.assign(document.createElement('b'), { textContent: r.name }),
        Object.assign(document.createElement('small'), { textContent: r.exists ? `${fmtSize(r.size)} · ${ago(r.at)}` : `Moved or deleted · ${ago(r.at)}` }));
      const fold = Object.assign(document.createElement('button'), { type: 'button', className: 'rc-btn', textContent: '▤', title: 'Show in folder' });
      fold.setAttribute('aria-label', `Show ${r.name} in its folder`);
      fold.disabled = !r.exists;
      fold.addEventListener('click', (e) => { e.stopPropagation(); window.api.showItem(r.path); });
      li.append(grip, th, tx, fold);
      // Drag out of the window: Electron hands the real file to Windows.
      li.addEventListener('dragstart', (e) => { e.preventDefault(); if (r.exists) window.api.recentDrag(r.path); });
      li.addEventListener('dblclick', () => { if (r.exists) window.api.recentOpen(r.path); });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && r.exists) window.api.recentOpen(r.path);
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const b = li.getBoundingClientRect(); openMenu(r, b.left + 20, b.bottom); }
      });
      li.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(r, e.clientX, e.clientY); });
      list.append(li);
      if (r.exists && kindOf(r.name) !== 'file') lazyThumb(th, r.path);
    }
  }
  // Pictures load as rows come into view.
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const el = en.target, p = el.dataset.path;
      (thumbs.has(p) ? Promise.resolve(thumbs.get(p)) : window.api.recentThumb(p).catch(() => null)).then((url) => {
        thumbs.set(p, url);
        if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('pic'); }
      });
    }
  }, { root: list });
  function lazyThumb(el, p) {
    el.dataset.path = p;
    if (thumbs.get(p)) { el.style.backgroundImage = `url("${thumbs.get(p)}")`; el.classList.add('pic'); return; }
    io.observe(el);
  }

  // ---------- Right-click menu ----------
  function closeMenu() { menu.classList.add('hidden'); menu.textContent = ''; }
  function openMenu(r, x, y) {
    menu.textContent = '';
    const add = (label, fn, { disabled = false, danger = false } = {}) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'rc-mi' + (danger ? ' danger' : ''), textContent: label, disabled });
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', async () => { closeMenu(); try { await fn(); } catch (e) { alert(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } });
      menu.append(b);
    };
    const sep = () => { const d = document.createElement('div'); d.className = 'rc-sep'; d.setAttribute('role', 'separator'); menu.append(d); };
    const FA = window.FileActions, k = FA ? FA.kindOf(r.path) : kindOf(r.name), av = k === 'video' || k === 'audio', gone = { disabled: !r.exists };
    add('Open', () => window.api.recentOpen(r.path), gone);
    // Songs and videos: into the player (src/file-actions.js).
    if (FA && av) {
      sep();
      add('Play', () => FA.play([r.path], 'now'), gone);
      add('Play next', () => FA.play([r.path], 'next'), gone);
      add('Add to queue', () => FA.play([r.path], 'queue'), gone);
      add('Add to playlist…', () => FA.playlistMenu([r.path], parseFloat(menu.style.left), parseFloat(menu.style.top)), gone);
      sep();
      add('Separate stems', () => FA.stems([r.path]), gone);
    }
    if (FA && (av || k === 'image')) add('Compress', () => FA.compress([r.path]), gone);
    if (FA && av) add('Search on Soulseek', () => FA.soulseek(r.path), gone);
    sep();
    add('Show in folder', () => window.api.showItem(r.path), { disabled: !r.exists });
    if (window.nabbitShare && ['video', 'audio'].includes(kindOf(r.name))) add('Share link (copy)', () => window.nabbitShare(r.path), { disabled: !r.exists });
    add('Download again', () => {
      document.querySelector('.tab[data-mode="video"]').click();
      const u = $('dl-url');
      u.value = r.url;
      u.focus();
    }, { disabled: !r.url });
    add('Remove from list', async () => { await window.api.recentRemove(r.path); load(); });
    add('Delete file…', async () => {
      if (!confirm(`Move "${r.name}" to the Recycle Bin?`)) return;
      await window.api.recentTrash(r.path);
      load();
    }, { disabled: !r.exists, danger: true });
    menu.classList.remove('hidden');
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.min(window.innerWidth - w - 6, x)}px`;
    menu.style.top = `${Math.min(window.innerHeight - h - 6, y)}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);

  // ---------- Header / footer buttons ----------
  $('rc-folder').addEventListener('click', () => window.api.recentFolder());
  $('rc-clear').addEventListener('click', async () => {
    if (!items.length || !confirm('Empty the Recent downloads list? The files stay where they are.')) return;
    await window.api.recentClear();
    load();
  });
  $('rc-filter').addEventListener('input', render);
  window.api.onRecentChanged(load);
  // "x min ago" stays current.
  setInterval(() => { if (document.body.classList.contains('recent-on')) render(); }, 60000);
  load();
})();
