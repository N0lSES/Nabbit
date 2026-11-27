// What the right-click menus do with your files: Explorer's (main.js passes Play / Play next / Add to
// queue / Add to playlist… / Separate stems / Search on Soulseek here), the Player's song menu and
// Recent downloads'. Play and queue go to the player; Separate stems to Audio Tools → Split vocals
// and instruments (split straight away); Compress to the Compressor; Search on Soulseek to the Music
// Downloader, searching for the song's artist and title (from its tags, else its file name).
(function () {
  const VIDEO = ['3gp', '3gpp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'ts', 'webm', 'wmv', 'mts', 'm2ts'];
  const AUDIO = ['aac', 'aif', 'aiff', 'alac', 'ape', 'flac', 'm4a', 'm4b', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wma', 'wv'];
  const IMAGE = ['avif', 'bmp', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp', 'gif'];
  const ext = (p) => (String(p).match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';
  /** 'video' | 'audio' | 'image' | 'file' */
  const kindOf = (p) => { const e = ext(p); return VIDEO.includes(e) ? 'video' : AUDIO.includes(e) ? 'audio' : IMAGE.includes(e) ? 'image' : 'file'; };
  const playable = (p) => ['video', 'audio'].includes(kindOf(p));
  const P = () => window.Player;

  async function play(paths, how) {
    paths = paths.filter(playable);
    if (!paths.length || !P()) return;
    if (how === 'now') { await P().playFiles(paths, 0); return; }
    if (how === 'next' || how === 'queue') { if (!(await P().queueFiles(paths, how === 'next'))) P().toast('Nabbit can\'t play that file.'); return; }
    if (how === 'playlist') playlistMenu(paths);
  }
  // Add to playlist: your playlists and "New playlist", as a small menu (where you clicked, or the
  // middle of the window from Explorer).
  function playlistMenu(paths, x, y) {
    for (const m of document.querySelectorAll('.lp-ctx')) m.remove();
    const m = document.createElement('div');
    m.className = 'lp-ctx';
    m.setAttribute('role', 'menu');
    const head = document.createElement('div');
    head.className = 'lp-ctx-h';
    head.textContent = paths.length === 1 ? `Add "${paths[0].split(/[\\/]/).pop()}" to` : `Add ${paths.length} files to`;
    m.append(head);
    const item = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `lp-ctx-i ${cls}`; b.textContent = label; b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { m.remove(); fn(); });
      m.append(b);
    };
    for (const pl of P().playlistList) item(pl.name, () => P().addToPlaylist(pl.id, paths), 'sub');
    item('+ New playlist', () => P().addToPlaylist(null, paths), 'sub');
    document.body.append(m);
    const r = m.getBoundingClientRect();
    const left = x == null ? (innerWidth - r.width) / 2 : Math.min(x, innerWidth - r.width - 8);
    const top = y == null ? (innerHeight - r.height) / 3 : Math.min(y, innerHeight - r.height - 8);
    m.style.left = `${Math.max(8, left)}px`;
    m.style.top = `${Math.max(8, top)}px`;
    m.querySelector('button').focus();
  }
  function stems(paths) {
    paths = paths.filter(playable);
    if (paths.length && window.StemsUI) window.StemsUI.split(paths);
  }
  function compress(paths) {
    paths = paths.filter((p) => kindOf(p) !== 'file');
    if (!paths.length || !window.CompressorUI) return;
    const tab = document.querySelector('.tab[data-tool="compress"]:not([data-mode])');
    if (tab && !tab.classList.contains('active')) tab.click();
    window.CompressorUI.add(paths);
  }
  // The words to search for: "Artist - Title" from the tags (the title without its feat. / prod. /
  // bracketed bits), else the file's name tidied up.
  function searchWords(t) {
    const title = String(t.title || '').replace(/\s*[([][^)\]]*(feat|ft\.|prod|remaster|official|video|lyrics|audio)[^)\]]*[)\]]/gi, '').replace(/\s+(feat\.?|ft\.?)\s.*$/i, '').trim();
    const artist = String(t.artist || '').split(/;|,|\s&\s|\sx\s/i)[0].trim();
    if (title && artist && !/^unknown/i.test(artist)) return `${artist} - ${title}`;
    if (title) return title;
    return String(t.path || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*\(\d+\)$/, '').trim();
  }
  async function soulseek(fileOrTrack) {
    let t = typeof fileOrTrack === 'string' ? { path: fileOrTrack } : fileOrTrack;
    if (!t.title && t.path) { try { t = (await window.api.playFilesInfo([t.path]))[0] || t; } catch { /* the file name, then */ } }
    const q = searchWords(t);
    if (q && window.nabbitSlskSearch) window.nabbitSlskSearch(q);
  }

  // From Explorer (main.js): { action: 'play' | 'stems' | 'slsk', how, paths }.
  if (window.api.onFileAction) {
    window.api.onFileAction(({ action, how, paths }) => {
      if (!Array.isArray(paths) || !paths.length) return;
      if (action === 'play') play(paths, how);
      else if (action === 'stems') stems(paths);
      else if (action === 'slsk') soulseek(paths[0]);
    });
  }
  window.FileActions = { kindOf, playable, play, playlistMenu, stems, compress, soulseek, searchWords };
})();
