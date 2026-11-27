// Player mode's music sources: Nabbit Home (nabbit-home.js), Local Files (your library, as it was), YouTube Music and SoundCloud
// (your own home on each, once you sign in) and Discovery. The switcher sits in the list's header; the
// homes replace the list while they're showing. Songs play through the player as from the Music
// Downloader (window.Player.play); albums, playlists and mixes play as a queue.
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };
  const clock = (s) => { s = Math.round(Number(s) || 0); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''; };
  // A long total: 2:39:20, not 159:20.
  const longClock = (s) => { s = Math.round(Number(s) || 0); if (s < 3600) return clock(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const errText = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const api = window.api;
  const lp = $('lp'), home = $('lp-home');

  // ---------- The sources ----------
  const PROVIDERS = {
    youtube: {
      name: 'YouTube Music',
      key: 'youtube', account: () => api.ytmAccount(), signIn: (how) => api.ytmSignIn(how), signOut: () => api.ytmSignOut(), home: () => api.ytmHome(),
      tracks: (row) => api.ytmSetTracks(row.url),
      pitch: 'Your YouTube Music home: Quick picks, Listen again, your mixes, recently played, liked songs and your playlists.',
      how: "Sign in with your browser: YouTube Music opens there and the Nabbit browser extension hands your sign-in to Nabbit (only because you asked, and only to this PC). Nabbit only reads your own lists; songs play as they do from the Music Downloader.",
    },
    soundcloud: {
      name: 'SoundCloud',
      key: 'soundcloud', account: () => api.scAccount(), signIn: (how) => api.scSignIn(how), signOut: () => api.scSignOut(), home: () => api.scHome(),
      tracks: (row) => api.scSetTracks({ id: row.id || null, urn: row.urn || null, url: row.url || null }),
      pitch: "Your SoundCloud home: SoundCloud's picks for you (your mixes and stations), your feed, recently played, your likes and your playlists.",
      how: "Sign in with your browser: SoundCloud opens there and the Nabbit browser extension hands your sign-in to Nabbit (only because you asked, and only to this PC), where it's kept encrypted for your Windows account. Nabbit only reads your own lists; songs play as they do from the Music Downloader.",
    },
  };
  const TABS = [['home', 'Nabbit Home'], ['local', 'Local Files'], ['youtube', 'YouTube Music'], ['soundcloud', 'SoundCloud'], ['discover', 'Nabbit Holes']];
  let source = 'home';
  try { const v = localStorage.getItem('nabbit.source'); if (TABS.some((t) => t[0] === v)) source = v; } catch { /* default */ }
  const cache = {}; // provider → { account, sections } (until refreshed)
  let nav = 0; // bumped when the tab or what it shows changes
  let pages = []; // the artist and album pages opened in this tab, in order (Back goes to the one before)

  const seg = $('lp-prov');
  for (const [v, label] of TABS) {
    const b = h('button', { type: 'button', className: 'chip', textContent: label });
    b.dataset.v = v;
    b.setAttribute('role', 'tab');
    b.onclick = () => setSource(v);
    seg.append(b);
  }
  // Choosing anything in the library's sidebar goes back to Local Files.
  for (const id of ['lib-views', 'lib-pls', 'lib-artists']) { const n = $(id); if (n) n.addEventListener('click', () => { if (source !== 'local') setSource('local'); }, true); }

  function selectTab(v) {
    source = v;
    nav++; // anything still loading for the tab shown before stays away
    try { localStorage.setItem('nabbit.source', v); } catch { /* not kept */ }
    for (const b of seg.children) { b.classList.toggle('active', b.dataset.v === v); b.setAttribute('aria-selected', String(b.dataset.v === v)); }
    lp.classList.toggle('prov', v !== 'local');
  }
  function setSource(v) {
    // Back / forward (nav-history.js): this tab of Player mode.
    if (window.Nav && document.body.classList.contains('mode-player')) window.Nav.record(`src:${v}`, () => { if (window.Player && window.Player.toPlayer) window.Player.toPlayer(); setSource(v); });
    selectTab(v);
    pages = [];
    if (v !== 'home' && window.NabbitHome) window.NabbitHome.stop();
    if (v === 'local') { home.textContent = ''; if (window.Discovery) window.Discovery.stop(); return; }
    $('lp-ptitle').textContent = v === 'home' ? 'Nabbit Home' : v === 'discover' ? 'Nabbit Holes' : PROVIDERS[v].name;
    $('lp-pstats').textContent = '';
    if (v === 'home') { if (window.Discovery) window.Discovery.stop(); if (window.NabbitHome) window.NabbitHome.show(home); else home.textContent = ''; return; }
    if (v === 'discover') { if (window.Discovery) window.Discovery.show(home); else home.textContent = ''; return; }
    if (window.Discovery) window.Discovery.stop();
    showProvider(v);
  }

  // ---------- A provider's home ----------
  async function showProvider(v, { refresh = false } = {}) {
    const P = PROVIDERS[v], my = nav;
    if (!refresh && cache[v]) { paintHome(v, cache[v]); return; }
    home.textContent = '';
    home.append(h('p', { className: 'hm-note', textContent: `Loading your ${P.name}…` }));
    let acc;
    try { acc = await P.account(); } catch { acc = { signedIn: false }; }
    if (source !== v || my !== nav) return;
    if (!acc.signedIn) { paintSignIn(v, acc); return; }
    try {
      const data = await P.home();
      cache[v] = data;
      if (source === v && my === nav) paintHome(v, data);
    } catch (e) {
      if (source !== v || my !== nav) return;
      if (/signed-out/.test(errText(e))) { delete cache[v]; paintSignIn(v, { signedIn: false, expired: true }); return; }
      home.textContent = '';
      const again = h('button', { type: 'button', className: 'ghost', textContent: 'Try again' });
      again.onclick = () => showProvider(v, { refresh: true });
      home.append(h('div', { className: 'hm-card' }, h('p', { textContent: `Couldn't load your ${P.name}: ${errText(e)}` }), again));
    }
  }
  function paintSignIn(v, acc) {
    const P = PROVIDERS[v];
    home.textContent = '';
    const go = h('button', { type: 'button', className: 'primary hm-go', textContent: 'Sign in with your browser' });
    const here = h('button', { type: 'button', className: 'link-btn hm-here', textContent: 'or sign in here, in a Nabbit window' });
    const cancel = h('button', { type: 'button', className: 'link-btn hidden', textContent: 'Cancel' });
    const note = h('p', { className: 'hm-note' });
    const run = async (how) => {
      go.disabled = here.disabled = true;
      cancel.classList.toggle('hidden', how !== 'browser');
      note.textContent = how === 'browser'
        ? `${P.name} opened in your browser. Sign in there (if you already are, it's picked up straight away); the Nabbit extension hands your sign-in over. If nothing happens, click the Nabbit button in your browser's toolbar and choose "Sign Nabbit in".`
        : 'Finish signing in in the window that opened…';
      let r;
      try { r = await P.signIn(how); } catch (e) { r = null; note.textContent = errText(e); }
      go.disabled = here.disabled = false;
      cancel.classList.add('hidden');
      if (r && r.signedIn) { delete cache[v]; showProvider(v, { refresh: true }); return; }
      if (r && r.needExtension) note.textContent = 'Signing in with your browser needs the Nabbit browser extension, connected (Settings → Browser extension). Or sign in here, in a Nabbit window.';
      else if (r) note.textContent = how === 'browser' ? 'Not signed in (cancelled, or nothing came from your browser in 15 minutes).' : 'Not signed in (the window was closed before signing in finished).';
    };
    go.onclick = () => run('browser');
    here.onclick = () => run('window');
    cancel.onclick = () => { if (api.signinCancel) api.signinCancel(P.key); };
    home.append(h('div', { className: 'hm-card' },
      h('div', { className: 'album-kind', textContent: v === 'youtube' ? 'YouTube Music' : 'SoundCloud' }),
      h('h2', { className: 'ap-name', textContent: acc.expired ? 'Sign in again' : 'Your home' }),
      h('p', { textContent: acc.expired ? `Your ${P.name} sign-in has run out.` : P.pitch }),
      h('div', { className: 'hm-acts' }, go, here, cancel), note,
      h('p', { className: 'hm-note small', textContent: P.how })));
  }
  function paintHome(v, data) {
    const P = PROVIDERS[v];
    home.textContent = '';
    const acc = data.account || {};
    $('lp-pstats').textContent = acc.name ? `Signed in as ${acc.name}` : 'Signed in';
    const refresh = h('button', { type: 'button', className: 'lp-txt dim', textContent: 'Refresh' });
    refresh.onclick = () => showProvider(v, { refresh: true });
    const out = h('button', { type: 'button', className: 'lp-txt dim', textContent: 'Sign out' });
    out.onclick = async () => { await P.signOut().catch(() => {}); delete cache[v]; showProvider(v, { refresh: true }); };
    home.append(h('div', { className: 'hm-top' },
      acc.avatar ? h('img', { className: 'hm-avatar', src: acc.avatar, alt: '' }) : null,
      h('span', { className: 'hm-who', textContent: acc.name || P.name }), h('span', { className: 'lp-sp' }), refresh, out));
    const secs = data.sections || [];
    if (!secs.length) home.append(h('p', { className: 'hm-note', textContent: `Nothing on your ${P.name} home yet: like some songs or follow some artists there.` }));
    for (const sec of secs) home.append(section(v, sec));
    home.scrollTop = 0;
  }
  // A picture that tries the next one it has when one won't load, and goes (leaving the plain tile)
  // when none will.
  function pic(t) {
    const tries = [...new Set([t.thumbnail, ...(t.arts || [])].filter(Boolean))];
    if (!tries.length) return null;
    const img = h('img', { alt: '', loading: 'lazy' });
    let i = 0;
    img.onerror = () => { i++; if (i < tries.length) img.src = tries[i]; else img.remove(); };
    img.src = tries[0];
    return img;
  }
  const asItem = (t) => (typeof playItem === 'function' ? playItem(t) : t);
  function section(v, sec) {
    const box = h('section', { className: 'ap-sec hm-sec' });
    box.append(h('h3', { className: 'ap-title' }, h('span', { textContent: sec.title }), h('span', { className: 'ap-count', textContent: String(sec.items.length).padStart(2, '0') })));
    if (sec.sub) box.append(h('p', { className: 'hm-note small', textContent: sec.sub }));
    const MAX = sec.kind === 'songs' ? 8 : 12;
    if (sec.kind === 'songs') {
      const list = h('ol', { className: 'ap-songs' });
      const queue = () => sec.items.map(asItem);
      sec.items.forEach((t, i) => {
        const play = () => window.Player.play(asItem(t), queue(), i);
        const row = h('li', { className: 'ap-song' + (i >= MAX ? ' extra' : ''), tabIndex: 0, title: `Play ${t.title}` },
          typeof playButton === 'function' ? playButton(play, `Play ${t.title}`, i + 1, t.url) : h('span', { className: 'n', textContent: String(i + 1) }),
          pic(t) || h('span', { className: 'ph' }),
          h('span', { className: 'ap-st' }, h('span', { className: 'ap-t', textContent: t.title }),
            h('span', { className: 'ap-s', textContent: [t.artist, t.album].filter(Boolean).join(' · ') })),
          h('span', { className: 'd', textContent: clock(t.duration) }));
        row.dataset.playUrl = t.url;
        if (window.StreamMenu) window.StreamMenu.attach(row, t, sec.items);
        row.ondblclick = play;
        row.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); play(); } };
        list.append(row);
      });
      box.append(list);
      more(box, list, sec.items.length, MAX);
      return box;
    }
    const grid = h('div', { className: 'ap-grid' });
    sec.items.forEach((t, i) => {
      const sub = t.type === 'artists' ? (t.subs || 'Artist') : [t.kind, t.artist || t.note, t.tracks ? `${t.tracks} songs` : null].filter(Boolean).join(' · ');
      const tile = h('button', { type: 'button', className: 'ap-tile' + (t.type === 'artists' ? ' is-artist' : '') + (i >= MAX ? ' extra' : '') },
        h('span', { className: 'ap-art' }, pic(t)),
        h('span', { className: 'ap-t', textContent: t.title }),
        h('span', { className: 'ap-s', textContent: sub }));
      tile.title = t.type === 'artists' ? `Open ${t.title}'s artist page` : `Play ${t.title}`;
      tile.onclick = () => openTile(v, t);
      if (t.type === 'songs' && window.StreamMenu) window.StreamMenu.attach(tile, t, sec.items.filter((x) => x.type === 'songs'));
      grid.append(tile);
    });
    box.append(grid);
    more(box, grid, sec.items.length, MAX);
    return box;
  }
  function more(box, list, n, max) {
    if (n <= max) return;
    const b = h('button', { type: 'button', className: 'link-btn ap-more', textContent: `+ ${n - max} more` });
    b.onclick = () => { list.classList.add('all'); b.remove(); };
    box.append(b);
  }
  // A tile: an artist opens their page in the Music Downloader; a song plays; an album, playlist or mix
  // plays from its first song (its songs as the queue).
  // A tile: an artist opens their page, a song plays, an album / playlist / mix opens its page (all in this tab).
  function openTile(v, t) {
    if (t.type === 'artists') { openArtistHere(t.url, t); return; }
    if (t.type === 'songs') { window.Player.play(asItem(t), [asItem(t)]); return; }
    openAlbumHere(v, t);
  }
  // An album's (playlist's, mix's) songs and details: from the service's own list, else as the Music
  // Downloader reads it (a radio mix, a set that moved). → { list, meta }
  async function albumTracks(v, t) {
    let list = [], meta = {};
    try { list = await PROVIDERS[v].tracks(t); } catch { list = []; }
    if ((!list || !list.length || !t.thumbnail || !t.artist) && t.url) {
      try {
        const r = await api.musicInfo(t.url);
        if (r && r.kind === 'album') {
          const al = r.album.isAlbum !== false;
          meta = { title: r.album.title, artist: al ? r.album.artist : (r.album.uploader || null), artistLinks: r.album.artistLinks || [], thumbnail: r.album.thumbnail, year: r.album.year, kind: r.album.kind, url: r.album.webpageUrl || t.url, isAlbum: al };
          if (!list || !list.length) {
            list = r.album.entries.filter((e) => e.url).map((e) => ({ url: e.url, title: e.title, artist: e.artist || (al ? r.album.artist : null), album: al ? r.album.title : null,
              thumbnail: (al ? r.album.thumbnail : null) || e.thumbnail || null, duration: e.duration }));
          }
        } else if (r && r.kind === 'track' && (!list || !list.length)) list = [{ url: t.url, title: r.info.title, artist: r.info.artist || r.info.uploader, thumbnail: r.info.thumbnail, duration: r.info.duration }];
      } catch { /* what we have */ }
    }
    return { list: list || [], meta };
  }

  // ---------- An album's page, in this tab ----------
  // Cover, title, artist (opens their page here), songs, length and year; Play / Shuffle, a song plays
  // from there on; Download… opens it in the Music Downloader.
  async function openAlbumHere(v, t, { push = true } = {}) {
    if (!t || !t.url) return;
    if (window.Nav) window.Nav.record(`album:${t.url}`, () => openAlbumHere(v, t));
    if (window.Player && window.Player.toPlayer) window.Player.toPlayer();
    if (source !== v || !lp.classList.contains('prov')) selectTab(v); else nav++;
    if (window.Discovery) window.Discovery.stop();
    if (window.NabbitHome) window.NabbitHome.stop();
    const my = nav;
    if (push) pages.push({ type: 'album', v, t });
    $('lp-ptitle').textContent = PROVIDERS[v].name;
    $('lp-pstats').textContent = '';
    home.textContent = '';
    home.append(backBar(v), h('p', { className: 'hm-note', textContent: `Opening ${t.title || 'the album'}…` }));
    const { list, meta } = await albumTracks(v, t);
    if (my !== nav) return;
    const a = { ...meta, ...Object.fromEntries(Object.entries({ title: t.title, artist: t.artist || t.note, thumbnail: t.thumbnail, year: t.year, kind: t.kind }).filter(([, x]) => x)) };
    a.title = a.title || meta.title || 'Album';
    a.url = t.url;
    const al = meta.isAlbum !== false && !/playlist|mix|station/i.test(a.kind || '');
    const items = list.map((x) => asItem({ ...x, album: x.album || (al ? a.title : null), thumbnail: x.thumbnail || (al ? a.thumbnail : null) }));
    const total = list.reduce((n, x) => n + (Number(x.duration) || 0), 0);
    const where = v === 'soundcloud' ? 'SoundCloud' : 'YouTube Music';
    const play = (i = 0) => { if (items.length) window.Player.play(items[i], items, i); };
    const btn = (text, fn, cls = 'ghost') => { const b = h('button', { type: 'button', className: cls, textContent: text }); b.onclick = fn; return b; };
    const shuffle = () => { const q = items.slice(); for (let k = q.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [q[k], q[j]] = [q[j], q[k]]; } if (q.length) window.Player.play(q[0], q, 0); };
    const dl = btn('Download…', () => window.Player.toMusic(() => { if (typeof musicOpen === 'function') musicOpen(a.url, { ...t, title: a.title }, false); }));
    dl.title = 'Open it in the Music Downloader, to download its songs';
    const out = btn(`Open on ${where} ↗`, () => api.openExternal(a.url));
    // The artist: their page here (their link, else a search by name).
    const links = (meta.artistLinks && meta.artistLinks.length ? meta.artistLinks : t.artistLinks) || [];
    const who = h('div', { className: 'meta-line hm-al-artist' });
    if (links.length) links.forEach((x, i) => { if (i) who.append(', '); const b = h('button', { type: 'button', className: 'link-btn artist-link', textContent: x.name }); b.onclick = () => (x.url ? openArtistHere(x.url, { title: x.name }) : openArtistNamed(x.name)); who.append(b); });
    else if (a.artist) { const b = h('button', { type: 'button', className: 'link-btn artist-link', textContent: a.artist }); b.onclick = () => openArtistNamed(String(a.artist).split(/\s*(?:,|&| x | feat\.?)\s*/i)[0]); who.append(b); }
    const stats = [list.length ? `${list.length} ${list.length === 1 ? 'song' : 'songs'}` : null, total ? longClock(total) : null, a.year].filter(Boolean).join(' · ');
    const box = h('div', { className: 'hm-album artist-page' });
    box.append(backBar(v), h('header', { className: 'ap-head' },
      albumPic(a, t, list),
      h('div', { className: 'ap-meta' },
        h('div', { className: 'album-kind', textContent: `${a.kind || (al ? 'Album' : 'Playlist')} · ${where}` }),
        h('h2', { className: 'ap-name', textContent: a.title }),
        who.childNodes.length ? who : null,
        stats ? h('div', { className: 'meta-line dim', textContent: stats }) : null,
        h('div', { className: 'ap-btns' }, btn('Play', () => play(0), 'primary hm-al-play'), btn('⤮ Shuffle', shuffle), dl, out))));
    if (!list.length) box.append(h('div', { className: 'hm-card' }, h('p', { textContent: `Couldn't read ${a.title}'s songs.` })));
    else {
      const ol = h('ol', { className: 'ap-songs hm-al-songs' });
      list.forEach((x, i) => {
        const row = h('li', { className: 'ap-song', tabIndex: 0, title: `Play ${x.title}` },
          typeof playButton === 'function' ? playButton(() => play(i), `Play ${x.title}`, i + 1, x.url) : h('span', { className: 'n', textContent: String(i + 1) }),
          al ? null : (x.thumbnail ? h('img', { src: x.thumbnail, alt: '', loading: 'lazy' }) : h('span', { className: 'ph' })),
          h('span', { className: 'ap-st' }, h('span', { className: 'ap-t', textContent: x.title }),
            h('span', { className: 'ap-s', textContent: al && x.artist === a.artist ? '' : (x.artist || '') })),
          h('span', { className: 'd', textContent: clock(x.duration) }));
        if (al) row.classList.add('no-pic');
        row.dataset.playUrl = x.url;
        if (window.StreamMenu) window.StreamMenu.attach(row, { ...x, album: x.album || (al ? a.title : null), albumUrl: x.albumUrl || (al ? a.url : null), artistLinks: x.artistLinks && x.artistLinks.length ? x.artistLinks : (al ? links : []), thumbnail: x.thumbnail || (al ? a.thumbnail : null) }, list);
        row.onclick = (e) => { if (!e.target.closest('button')) play(i); };
        row.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); play(i); } };
        ol.append(row);
      });
      box.append(ol);
    }
    home.textContent = '';
    home.append(box);
    home.scrollTop = 0;
    if (typeof markPlaying === 'function') markPlaying();
    moreAlbums(v, box, a, links, my);
  }
  // The cover: the album's own picture (or the tile's others), else, for a mix or playlist without one
  // (or one that won't load), its first four songs' covers as a square of four; else the first song's.
  function albumPic(a, t, list) {
    const box = h('div', { className: 'ap-pic hm-al-pic' });
    const own = [...new Set([a.thumbnail, ...(t.arts || [])].filter(Boolean))];
    const songs = [...new Set(list.map((x) => x.thumbnail).filter(Boolean))];
    const mosaic = () => {
      box.textContent = '';
      if (songs.length >= 4) box.append(h('span', { className: 'hm-al-mos' }, ...songs.slice(0, 4).map((u) => h('img', { src: u, alt: '', onerror() { this.style.visibility = 'hidden'; } }))));
      else if (songs.length) box.append(h('img', { src: songs[0], alt: '', onerror() { this.remove(); } }));
      else box.classList.add('empty');
    };
    if (!own.length) { mosaic(); return box; }
    const img = h('img', { alt: '' });
    let i = 0;
    img.onerror = () => { i++; if (i < own.length) img.src = own[i]; else mosaic(); };
    img.src = own[0];
    box.append(img);
    return box;
  }
  // At the bottom of an album's page: the artist's other albums, singles and EPs (from their page).
  async function moreAlbums(v, box, a, links, my) {
    let url = (links.find((x) => x.url) || {}).url || null;
    const name = (links[0] && links[0].name) || String(a.artist || '').split(/\s*(?:,|&| x | feat\.?)\s*/i)[0];
    if (!url && name && v === 'youtube') {
      try { const r = await api.musicSearch(name, 'artists', 'ytmusic'); const hit = (r || []).find((x) => x.type === 'artists' && x.url); url = hit ? hit.url : null; } catch { url = null; }
    }
    if (!url || my !== nav) return;
    let page = null;
    try { page = await api.musicArtist(url); } catch { page = null; }
    if (!page || my !== nav) return;
    const seen = new Set([a.url]);
    const items = [];
    for (const sec of page.sections || []) {
      if (sec.kind === 'songs') continue;
      for (const t of sec.items || []) {
        if (!t || !t.url || t.type === 'artists' || t.type === 'songs' || seen.has(t.url) || (t.title && t.title === a.title)) continue;
        seen.add(t.url);
        items.push({ ...t, artist: t.artist || page.name, artistLinks: t.artistLinks && t.artistLinks.length ? t.artistLinks : [{ name: page.name, url }] });
      }
    }
    if (!items.length) return;
    const sec = section(v, { title: `More albums from ${page.name || name}`, kind: 'tiles', items });
    sec.classList.add('hm-more');
    box.append(sec);
  }

  // ---------- An artist's page, in the YouTube Music (or SoundCloud) tab ----------
  // Songs play (the section as the queue), albums / playlists open their page, related
  // artists open here too; Back goes to the artist before, then to your home. "Download…" opens the
  // same page in the Music Downloader.
  const tabFor = (url) => (/soundcloud\.com/i.test(String(url || '')) ? 'soundcloud' : 'youtube');
  async function openArtistHere(url, hint = {}, { push = true } = {}) {
    if (!url) return;
    if (window.Nav) window.Nav.record(`artist:${url}`, () => openArtistHere(url, hint));
    const v = tabFor(url);
    if (window.Player && window.Player.toPlayer) window.Player.toPlayer();
    if (source !== v || !lp.classList.contains('prov')) selectTab(v); else nav++;
    if (window.Discovery) window.Discovery.stop();
    if (window.NabbitHome) window.NabbitHome.stop();
    const my = nav;
    if (push) pages.push({ type: 'artist', url, hint });
    $('lp-ptitle').textContent = PROVIDERS[v].name;
    $('lp-pstats').textContent = '';
    home.textContent = '';
    home.append(backBar(v), h('p', { className: 'hm-note', textContent: `Opening ${hint.title || hint.name || 'the artist'}…` }));
    let page;
    try { page = await api.musicArtist(url); } catch (e) {
      if (my !== nav) return;
      home.textContent = '';
      home.append(backBar(v), h('div', { className: 'hm-card' }, h('p', { textContent: `Couldn't open the artist page: ${errText(e)}` })));
      return;
    }
    if (my !== nav) return;
    if (!page.thumbnail && hint.thumbnail) page.thumbnail = hint.thumbnail;
    if (!page.url) page.url = url;
    const box = h('div', { className: 'hm-artist artist-page' });
    const dl = h('button', { type: 'button', className: 'ghost ap-out', textContent: 'Download…', title: 'Open this page in the Music Downloader, to download songs and albums' });
    dl.onclick = () => window.Player.toMusic(() => { if (typeof openArtist === 'function') openArtist(page.url, { title: page.name, thumbnail: page.thumbnail }); });
    const withArtist = (x) => ({ ...x, artist: x.artist || page.name, artistLinks: x.artistLinks && x.artistLinks.length ? x.artistLinks : [{ name: page.name, url: page.url }] });
    window.nabbitArtistPage(page, box, {
      top: backBar(v),
      extra: [dl],
      openArtist: (u, t) => openArtistHere(u, t),
      itemTitle: (t) => (t.type === 'songs' || !t.type ? `Play ${t.title}` : `Open ${t.title}`),
      openItem: (t, list, node) => {
        if (t.type === 'songs' || !t.type || (t.duration && !t.tracks)) {
          const songs = list.filter((x) => x.type === 'songs' || !x.type).map((x) => asItem(withArtist(x)));
          const i = Math.max(0, songs.findIndex((x) => x.url === t.url));
          window.Player.play(songs[i] || asItem(withArtist(t)), songs.length ? songs : [asItem(withArtist(t))], i);
        } else openAlbumHere(v, t);
      },
    });
    home.textContent = '';
    home.append(box);
    home.scrollTop = 0;
  }
  function backBar(v) {
    const back = h('button', { type: 'button', className: 'lp-txt hm-back' });
    const prev = pages.length > 1 ? pages[pages.length - 2] : null;
    const name = (p) => (p.type === 'album' ? p.t.title : p.hint.title || p.hint.name) || (p.type === 'album' ? 'the album' : 'the artist');
    back.textContent = prev ? `← Back to ${name(prev)}` : `← Your ${PROVIDERS[v].name} home`;
    back.onclick = () => {
      pages.pop();
      const last = pages[pages.length - 1];
      if (last && last.type === 'album') openAlbumHere(last.v, last.t, { push: false });
      else if (last) openArtistHere(last.url, last.hint, { push: false });
      else { selectTab(v); showProvider(v); }
    };
    return h('div', { className: 'hm-top' }, back);
  }
  // By name (a song's artist with no link): YouTube Music's best match.
  async function openArtistNamed(name) {
    name = String(name || '').trim();
    if (!name) return;
    let list = [];
    try { list = await api.musicSearch(name, 'artists', 'ytmusic'); } catch { list = []; }
    const a = (list || []).find((x) => x.type === 'artists' && x.url);
    if (a) openArtistHere(a.url, a);
    else if (window.Player && window.Player.toast) window.Player.toast(`${name} wasn't found on YouTube Music.`);
  }

  // The artists you like on each signed-in service (from its home: likes, recently played, feed), for
  // Discovery: { name, weight, from }. The homes are loaded for it when they aren't yet.
  async function likedArtists() {
    const out = [];
    for (const v of Object.keys(PROVIDERS)) {
      if (!cache[v]) { try { const a = await PROVIDERS[v].account(); if (a.signedIn) cache[v] = await PROVIDERS[v].home(); } catch { /* not signed in */ } }
      for (const sec of (cache[v] && cache[v].sections) || []) {
        if (sec.kind !== 'songs') continue;
        const w = /like/i.test(sec.title) ? 3 : /played/i.test(sec.title) ? 2 : 1;
        for (const t of sec.items) {
          const name = String((t.artistLinks && t.artistLinks[0] && t.artistLinks[0].name) || t.artist || '').split(/\s*(?:,|&|\+| x | feat\.?| ft\.?)\s*/i)[0].trim();
          if (name) out.push({ name, weight: w, from: PROVIDERS[v].name, url: v === 'youtube' && t.artistLinks && t.artistLinks[0] ? t.artistLinks[0].url : null });
        }
      }
    }
    return out;
  }
  window.Sources = { set: setSource, get: () => source, likedArtists, peek: (v) => cache[v] || null, openArtist: (url, hint) => openArtistHere(url, hint || {}), openArtistNamed, openAlbum: (v, t) => openAlbumHere(v, t), refresh: () => { if (PROVIDERS[source]) showProvider(source, { refresh: true }); } };
  setSource(source);
})();
