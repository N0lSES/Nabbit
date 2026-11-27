// Player mode's music sources: Nabbit Home (nabbit-home.js), Local Files (your library, as it was), YouTube Music and SoundCloud
// (your own home on each, once you sign in) and Discovery. The switcher sits in the list's header; the
// homes replace the list while they're showing. Songs play through the player as from the Music
// Downloader (window.Player.play); albums, playlists and mixes play as a queue.
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };
  const clock = (s) => { s = Math.round(Number(s) || 0); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''; };
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

  function setSource(v) {
    source = v;
    try { localStorage.setItem('nabbit.source', v); } catch { /* not kept */ }
    for (const b of seg.children) { b.classList.toggle('active', b.dataset.v === v); b.setAttribute('aria-selected', String(b.dataset.v === v)); }
    lp.classList.toggle('prov', v !== 'local');
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
    const P = PROVIDERS[v];
    if (!refresh && cache[v]) { paintHome(v, cache[v]); return; }
    home.textContent = '';
    home.append(h('p', { className: 'hm-note', textContent: `Loading your ${P.name}…` }));
    let acc;
    try { acc = await P.account(); } catch { acc = { signedIn: false }; }
    if (source !== v) return;
    if (!acc.signedIn) { paintSignIn(v, acc); return; }
    try {
      const data = await P.home();
      cache[v] = data;
      if (source === v) paintHome(v, data);
    } catch (e) {
      if (source !== v) return;
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
      tile.title = t.type === 'artists' ? `Open ${t.title}'s page in the Music Downloader` : `Play ${t.title}`;
      tile.onclick = () => openTile(v, t, tile);
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
  async function openTile(v, t, tile) {
    if (t.type === 'artists') { window.Player.toMusic(() => { if (typeof openArtist === 'function') openArtist(t.url, t); }); return; }
    if (t.type === 'songs') { window.Player.play(asItem(t), [asItem(t)]); return; }
    if (tile.classList.contains('busy')) return;
    tile.classList.add('busy');
    let list = [];
    try { list = await PROVIDERS[v].tracks(t); } catch { list = []; }
    // Not readable that way (a radio mix, a set that moved): as the Music Downloader opens it.
    if ((!list || !list.length) && t.url) {
      try {
        const r = await api.musicInfo(t.url);
        if (r && r.kind === 'album') {
          const al = r.album.isAlbum !== false;
          list = r.album.entries.filter((e) => e.url).map((e) => ({ url: e.url, title: e.title, artist: e.artist || (al ? r.album.artist : null), album: al ? r.album.title : null,
            thumbnail: (al ? r.album.thumbnail : null) || e.thumbnail || null, duration: e.duration }));
        } else if (r && r.kind === 'track') list = [{ url: t.url, title: r.info.title, artist: r.info.artist || r.info.uploader, thumbnail: r.info.thumbnail, duration: r.info.duration }];
      } catch { list = []; }
    }
    tile.classList.remove('busy');
    if (!list || !list.length) { tile.classList.add('err'); tile.title = `Couldn't read ${t.title}'s songs.`; return; }
    const q = list.map(asItem);
    window.Player.play(q[0], q, 0);
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
  window.Sources = { set: setSource, get: () => source, likedArtists, peek: (v) => cache[v] || null, refresh: () => { if (PROVIDERS[source]) showProvider(source, { refresh: true }); } };
  setSource(source);
})();
