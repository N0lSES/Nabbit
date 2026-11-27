// Right-click a streamed song (YouTube Music, SoundCloud: in Player mode's tabs, artist and album pages,
// Nabbit Home, Nabbit Holes): Play, Play next, Add to queue; Download (straight away, in the format and folder
// used last); Download… (the song in the Music Downloader, with its download options); Find on Soulseek;
// Open the song's page (or copy its link);
// View artist and View album (in the YouTube Music / SoundCloud tab).
(() => {
  const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };
  const asItem = (t) => (typeof playItem === 'function' ? playItem(t) : t);
  const isSc = (u) => /soundcloud\.com/i.test(String(u || ''));
  const where = (u) => (isSc(u) ? 'SoundCloud' : 'YouTube Music');
  function close() { for (const m of document.querySelectorAll('.sm-ctx')) m.remove(); }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.sm-ctx')) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('blur', close);

  // The song's album page: its link, else YouTube Music's album of that name by that artist.
  async function viewAlbum(t) {
    const v = isSc(t.url) ? 'soundcloud' : 'youtube';
    if (t.albumUrl) { window.Sources.openAlbum(isSc(t.albumUrl) ? 'soundcloud' : 'youtube', { type: 'albums', kind: 'Album', title: t.album || 'Album', artist: t.artist, artistLinks: t.artistLinks || [], url: t.albumUrl, thumbnail: t.thumbnail }); return; }
    let rows = [];
    try { rows = await window.api.musicSearch(`${String(t.artist || '').split(/,|&/)[0]} ${t.album}`.trim(), 'albums', 'ytmusic'); } catch { rows = []; }
    const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const hit = (rows || []).find((r) => r.url && norm(r.title) === norm(t.album)) || (rows || []).find((r) => r.url);
    if (hit) window.Sources.openAlbum('youtube', hit);
    else if (window.Player && window.Player.toast) window.Player.toast(`${t.album} wasn't found on ${where(t.url)}.`);
    return v;
  }
  function viewArtist(t, a) {
    if (a && a.url) window.Sources.openArtist(a.url, { title: a.name });
    else window.Sources.openArtistNamed(a ? a.name : String(t.artist || '').split(/\s*(?:,|&| x | feat\.?)\s*/i)[0]);
  }

  /** t: the song ({ url, title, artist, artistLinks, album, albumUrl, thumbnail, duration }); list: the songs around it (for Play). */
  function open(t, x, y, list = null) {
    close();
    if (!t || !t.url) return;
    const m = h('div', { className: 'lp-ctx sm-ctx', role: 'menu' });
    const item = (label, fn, { disabled = false, cls = '' } = {}) => {
      const b = h('button', { type: 'button', className: `lp-ctx-i ${cls}`, textContent: label, disabled });
      b.setAttribute('role', 'menuitem');
      b.onclick = () => { close(); fn(); };
      m.append(b);
      return b;
    };
    const sep = () => m.append(h('div', { className: 'lp-ctx-sep' }));
    m.append(h('div', { className: 'lp-ctx-h', textContent: t.title || 'Song' }));
    const one = asItem(t);
    item('Play', () => {
      const q = (list && list.length ? list : [t]).map(asItem);
      const i = Math.max(0, q.findIndex((s) => s.url === t.url));
      window.Player.play(q[i] || one, q, i);
    });
    item('Play next', () => window.Player.queueItems([one], true));
    item('Add to queue', () => window.Player.queueItems([one], false));
    sep();
    if (typeof window.quickDownloadSong === 'function') item('Download', () => window.quickDownloadSong(t)).title = 'Download the song now, in the format and folder you used last';
    item('Download…', () => window.Player.toMusic(() => { if (typeof musicOpen === 'function') musicOpen(t.url, { ...t, type: 'songs' }, false); })).title = 'Open the song in the Music Downloader, to download it';
    item('Find on Soulseek', () => { if (window.FileActions) window.FileActions.soulseek(t); });
    sep();
    // Its artists (each one, when there are several) and its album.
    const links = (t.artistLinks || []).filter((a) => a && a.name);
    if (links.length > 1) { m.append(h('div', { className: 'lp-ctx-h', textContent: 'View artist' })); for (const a of links.slice(0, 6)) item(a.name, () => viewArtist(t, a), { cls: 'sub' }); }
    else item(`View artist${links[0] ? `: ${links[0].name}` : t.artist ? `: ${String(t.artist).split(/\s*(?:,|&)\s*/)[0]}` : ''}`, () => viewArtist(t, links[0]), { disabled: !links.length && !t.artist });
    item(`View album${t.album ? `: ${t.album}` : ''}`, () => viewAlbum(t), { disabled: !t.albumUrl && !t.album });
    sep();
    item(`Open on ${where(t.url)} ↗`, () => window.api.openExternal(t.url));
    item('Copy link', () => { try { navigator.clipboard.writeText(t.url); if (window.Player && window.Player.toast) window.Player.toast('Link copied'); } catch { /* not allowed */ } });
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 8))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 8))}px`;
    const first = m.querySelector('button:not(:disabled)'); if (first) first.focus();
  }
  // On a row or tile: right-click (or the menu key) opens it.
  function attach(node, t, list = null) {
    if (!node || !t || !t.url) return;
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); open(t, e.clientX, e.clientY, typeof list === 'function' ? list() : list); });
  }
  window.StreamMenu = { open, attach, close };
})();
