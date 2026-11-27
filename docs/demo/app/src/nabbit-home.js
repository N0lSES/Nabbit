// Player → Nabbit Home: a home page made from your own music, like the YouTube Music and SoundCloud
// homes but from what's on this PC and what you play in Nabbit. Listen again, On repeat (your most
// played, last 30 days), mixes made from your artists and genres, new in your library, favourites you
// haven't played in a while, your playlists, and the top of your YouTube Music / SoundCloud homes when
// you're signed in there. Customize hides the parts you don't want (kept on this PC).
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };
  const clock = (s) => { s = Math.round(Number(s) || 0); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''; };
  const DAY = 86400000;
  const today = () => Math.floor(Date.now() / DAY);

  const PARTS = [
    ['again', 'Listen again'], ['repeat', 'On repeat'], ['mixes', 'Your mixes'], ['fresh', 'New in your library'],
    ['forgotten', 'Forgotten favourites'], ['playlists', 'Your playlists'], ['elsewhere', 'From your other homes'],
  ];
  const KEY = 'nabbit.home';
  let hidden = new Set();
  try { hidden = new Set(JSON.parse(localStorage.getItem(KEY) || '{}').hidden || []); } catch { /* all shown */ }
  const saveHidden = () => { try { localStorage.setItem(KEY, JSON.stringify({ hidden: [...hidden] })); } catch { /* not kept */ } };

  let root = null, seq = 0;

  // ---------- Covers, as they come into view ----------
  let io = null;
  function coverImg(path) {
    const img = h('img', { alt: '' });
    img.dataset.cover = path;
    if (io) io.observe(img);
    return img;
  }
  function watch(box) {
    if (io) io.disconnect();
    io = new IntersectionObserver((ens) => {
      for (const en of ens) {
        if (!en.isIntersecting) continue;
        const img = en.target;
        io.unobserve(img);
        window.Player.cover(img.dataset.cover).then((u) => { if (u) img.src = u; else img.remove(); }).catch(() => img.remove());
      }
    }, { root: box, rootMargin: '300px' });
  }
  const picOf = (t) => (t.stream ? (t.thumbnail ? h('img', { alt: '', src: t.thumbnail, loading: 'lazy', onerror() { this.remove(); } }) : null) : (t.hasCover ? coverImg(t.path) : null));

  // ---------- The pieces ----------
  const shuffled = (a) => { a = a.slice(); for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  const firstArtist = (s) => String(s || '').split(/\s*(?:,|;|\/|&|\+| x | feat\.?| ft\.?| with )\s*/i)[0].trim();
  const keyOf = (t) => (t.stream ? `u:${t.url}` : `p:${t.path}`);

  // Plays a list that may mix your files and streamed songs: from list[i], with the ones of the same kind as the queue.
  function playIn(list, i) {
    const t = list[i];
    const same = list.filter((x) => !!x.stream === !!t.stream);
    const k = same.indexOf(t);
    if (t.stream) window.Player.play(t, same, k);
    else window.Player.playTracks(same, k);
  }

  function part(id, title, count, ...kids) {
    const box = h('section', { className: 'ap-sec hm-sec nh-sec' });
    box.dataset.part = id;
    box.append(h('h3', { className: 'ap-title' }, h('span', { textContent: title }), count != null ? h('span', { className: 'ap-count', textContent: String(count).padStart(2, '0') }) : null), ...kids);
    return box;
  }
  function more(box, list, n, max) {
    if (n <= max) return;
    const b = h('button', { type: 'button', className: 'link-btn ap-more', textContent: `+ ${n - max} more` });
    b.onclick = () => { list.classList.add('all'); b.remove(); };
    box.append(b);
  }
  function songs(id, title, list, { max = 8, sub = null } = {}) {
    const ol = h('ol', { className: 'ap-songs' });
    list.forEach((t, i) => {
      const play = () => playIn(list, i);
      const row = h('li', { className: 'ap-song' + (i >= max ? ' extra' : ''), tabIndex: 0, title: `Play ${t.title}` },
        typeof playButton === 'function' ? playButton(play, `Play ${t.title}`, i + 1) : h('span', { className: 'n', textContent: String(i + 1) }),
        h('span', { className: 'nh-pic' }, picOf(t)),
        h('span', { className: 'ap-st' }, h('span', { className: 'ap-t', textContent: t.title }),
          h('span', { className: 'ap-s', textContent: sub ? sub(t) : [t.artist, t.album].filter(Boolean).join(' · ') })),
        h('span', { className: 'd', textContent: clock(t.duration) }));
      row.ondblclick = play;
      row.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); play(); } };
      ol.append(row);
    });
    const box = part(id, title, list.length, ol);
    more(box, ol, list.length, max);
    return box;
  }
  // A tile: pics (1, or up to 4 as a mosaic), a title, a line under it; click plays.
  function tile(pics, title, sub, onClick, cls = '') {
    pics = pics.filter(Boolean);
    const art = h('span', { className: 'ap-art' });
    if (pics.length >= 4) art.append(h('span', { className: 'nh-mos' }, ...pics.slice(0, 4)));
    else if (pics[0]) art.append(pics[0]);
    else art.append(h('span', { className: 'nh-blank', textContent: title.slice(0, 1).toUpperCase() }));
    const b = h('button', { type: 'button', className: 'ap-tile ' + cls, title: `Play ${title}` }, art, h('span', { className: 'ap-t', textContent: title }), h('span', { className: 'ap-s', textContent: sub }));
    b.onclick = onClick;
    return b;
  }
  function grid(id, title, tiles, max = 12) {
    const g = h('div', { className: 'ap-grid' });
    tiles.forEach((t, i) => { if (i >= max) t.classList.add('extra'); g.append(t); });
    const box = part(id, title, tiles.length, g);
    more(box, g, tiles.length, max);
    return box;
  }
  const mosaic = (list) => { const seen = new Set(), out = []; for (const t of list) { const k = t.stream ? t.thumbnail : `${t.albumArtist}|${t.album}`; if (seen.has(k) || !(t.stream ? t.thumbnail : t.hasCover)) continue; seen.add(k); out.push(picOf(t)); if (out.length === 4) break; } return out; };

  // ---------- The page ----------
  async function show(box) {
    root = box;
    const my = ++seq;
    box.textContent = '';
    box.append(h('p', { className: 'hm-note', textContent: 'Loading your home…' }));
    let lib;
    try { lib = await window.Player.library(); } catch { lib = { tracks: [], playlists: [] }; }
    if (my !== seq || root !== box) return;
    paint(box, lib);
  }

  function paint(box, { tracks, playlists }) {
    box.textContent = '';
    watch(box);
    const P = window.Player;
    const plays = P.plays || {};
    const own = tracks.filter((t) => t.playable && !t.hasVideo);
    const byPath = new Map(own.map((t) => [t.path, t]));
    const playOf = (t) => plays[keyOf(t)] || null;
    const recentN = (o, days) => (o && o.hits ? o.hits.filter((d) => d > today() - days).length : 0);

    // Header: a greeting, your numbers, Shuffle everything, Customize.
    const hr = new Date().getHours();
    const hello = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const hours = Math.round(own.reduce((s, t) => s + (t.duration || 0), 0) / 3600);
    const artists = new Set(own.map((t) => firstArtist(t.albumArtist || t.artist).toLowerCase()).filter(Boolean)).size;
    const week = Object.values(plays).reduce((s, o) => s + recentN(o, 7), 0);
    $('lp-pstats').textContent = '';
    const numbers = own.length ? `${own.length.toLocaleString()} songs · ${hours.toLocaleString()} h · ${artists.toLocaleString()} artists` : '';
    const shuffleAll = h('button', { type: 'button', className: 'lp-txt', textContent: '⤮ Shuffle everything' });
    shuffleAll.onclick = () => P.playTracks(shuffled(own), 0);
    const custom = h('button', { type: 'button', className: 'lp-txt dim', textContent: 'Customize' });
    box.append(h('div', { className: 'nh-top' },
      h('div', { className: 'nh-hello' }, h('span', { className: 'nh-hi', textContent: hello }),
        h('span', { className: 'nh-sub', textContent: [numbers, week ? `${week} played this week` : ''].filter(Boolean).join(' · ') || 'Your music, in one place' })),
      h('span', { className: 'lp-sp' }), own.length ? shuffleAll : null, custom));

    // Customize: which parts show.
    const panel = h('div', { className: 'nh-custom hidden' });
    for (const [id, label] of PARTS) {
      const cb = h('input', { type: 'checkbox', checked: !hidden.has(id) });
      cb.onchange = () => { if (cb.checked) hidden.delete(id); else hidden.add(id); saveHidden(); for (const s of box.querySelectorAll(`[data-part="${id}"]`)) s.classList.toggle('hidden', !cb.checked); };
      panel.append(h('label', { className: 'nh-opt' }, cb, h('span', { textContent: label })));
    }
    custom.onclick = () => panel.classList.toggle('hidden');
    box.append(panel);

    if (!own.length) {
      box.append(h('div', { className: 'hm-card' },
        h('div', { className: 'album-kind', textContent: 'Nabbit Home' }),
        h('h2', { className: 'ap-name', textContent: 'Nothing here yet' }),
        h('p', { textContent: 'Your home is made from the music in your library folders and what you play. Add a music folder in Settings → Music library, or download some songs in the Music Downloader.' })));
    }

    // Quick links into the library.
    const chip = (label, n, fn) => { const b = h('button', { type: 'button', className: 'chip nh-chip' }, h('span', { textContent: label }), n != null ? h('em', { textContent: n.toLocaleString() }) : null); b.onclick = fn; return b; };
    const loved = own.filter((t) => t.loved), rated = own.filter((t) => t.rating >= 4), added = own.filter((t) => t.mtime > Date.now() - 30 * DAY);
    if (own.length) box.append(h('div', { className: 'nh-chips' },
      chip('Loved', loved.length, () => P.openView({ kind: 'loved' })),
      chip('4 stars and up', rated.length, () => P.openView({ kind: 'rated' })),
      chip('Recently added', added.length, () => P.openView({ kind: 'recent' })),
      chip('All songs', own.length, () => P.openView({ kind: 'all' }))));

    const parts = [];

    // Listen again: what you played last, newest first (your files and streamed songs).
    const again = Object.entries(plays).sort((a, b) => b[1].last - a[1].last).map(([k, o]) => {
      if (k.startsWith('p:')) return byPath.get(k.slice(2)) || null;
      return o.item && o.item.url ? { ...o.item, stream: true, playable: true } : null;
    }).filter(Boolean).slice(0, 24);
    if (again.length) parts.push(grid('again', 'Listen again', again.map((t, i) => tile([picOf(t)], t.title, t.artist || '', () => playIn(again, i)))));

    // On repeat: most played in the last 30 days.
    const repN = new Map();
    const rep = Object.entries(plays).map(([k, o]) => [k, o, recentN(o, 30)]).filter((x) => x[2] >= 2).sort((a, b) => b[2] - a[2] || b[1].last - a[1].last)
      .map(([k, o, n]) => { const t = k.startsWith('p:') ? byPath.get(k.slice(2)) : (o.item && o.item.url ? { ...o.item, stream: true, playable: true } : null); if (t) repN.set(t, n); return t; })
      .filter(Boolean).slice(0, 20);
    if (rep.length) parts.push(songs('repeat', 'On repeat', rep, { sub: (t) => `${t.artist || ''} · ${repN.get(t)} plays this month` }));

    // Your mixes: your top artists (by plays, else by how many of their songs you have) with songs like
    // theirs (same genre), your top genres, and songs you've never played in Nabbit.
    const mixes = [];
    const artistScore = new Map(), artistName = new Map();
    for (const t of own) {
      const a = firstArtist(t.albumArtist || t.artist); if (!a) continue;
      const k = a.toLowerCase();
      artistName.set(k, a);
      const o = playOf(t);
      artistScore.set(k, (artistScore.get(k) || 0) + 1 + (o ? 4 * o.n + 10 * recentN(o, 30) : 0) + (t.loved ? 6 : 0) + (t.rating || 0));
    }
    const genreOf = (t) => String(t.genre || '').split(/[;/,]/)[0].trim();
    const topArtists = [...artistScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    for (const k of topArtists) {
      const mine = own.filter((t) => firstArtist(t.albumArtist || t.artist).toLowerCase() === k);
      if (mine.length < 3) continue;
      const genres = new Set(mine.map(genreOf).filter(Boolean).map((g) => g.toLowerCase()));
      const like = shuffled(own.filter((t) => !mine.includes(t) && genres.has(genreOf(t).toLowerCase()))).slice(0, 20);
      const list = shuffled([...shuffled(mine).slice(0, 15), ...like]).slice(0, 30);
      mixes.push({ title: `${artistName.get(k)} mix`, sub: like.length ? `With ${[...new Set(like.map((t) => firstArtist(t.artist)))].slice(0, 2).join(', ')} and more` : `${mine.length} songs`, list });
    }
    const gCount = new Map();
    for (const t of own) {
      const g = genreOf(t); if (!g) continue;
      const c = gCount.get(g.toLowerCase()) || [g, 0];
      c[1]++;
      gCount.set(g.toLowerCase(), c);
    }
    for (const [k, [g, n]] of [...gCount.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 4)) {
      if (n < 8) continue;
      mixes.push({ title: `${g} mix`, sub: `${n} songs`, list: shuffled(own.filter((t) => genreOf(t).toLowerCase() === k)).slice(0, 40) });
    }
    const never = own.filter((t) => !playOf(t));
    if (never.length >= 8 && Object.keys(plays).length) mixes.push({ title: 'Never played', sub: `${never.length.toLocaleString()} songs you haven't played in Nabbit`, list: shuffled(never).slice(0, 40) });
    if (loved.length >= 5) mixes.push({ title: 'Loved mix', sub: `${loved.length} songs`, list: shuffled(loved).slice(0, 50) });
    if (mixes.length) parts.push(grid('mixes', 'Your mixes', mixes.map((m) => tile(mosaic(m.list), m.title, m.sub, () => P.playTracks(shuffled(m.list), 0), 'nh-mix')), 8));

    // New in your library: albums with songs added in the last 30 days, newest first.
    const albums = new Map();
    for (const t of added) {
      const k = `${(t.albumArtist || t.artist || '').toLowerCase()}|${(t.album || t.title).toLowerCase()}`;
      const a = albums.get(k) || { list: [], at: 0, title: t.album || t.title, artist: t.albumArtist || t.artist || '' };
      a.list.push(t); a.at = Math.max(a.at, t.mtime);
      albums.set(k, a);
    }
    const fresh = [...albums.values()].sort((a, b) => b.at - a.at).slice(0, 24);
    for (const a of fresh) a.list.sort((x, y) => (x.disc - y.disc) || (x.track - y.track) || String(x.path).localeCompare(String(y.path)));
    if (fresh.length) parts.push(grid('fresh', 'New in your library', fresh.map((a) => tile([picOf(a.list.find((t) => t.hasCover) || a.list[0])], a.title,
      [a.artist, a.list.length > 1 ? `${a.list.length} songs` : 'Single'].filter(Boolean).join(' · '), () => P.playTracks(a.list, 0)))));

    // Forgotten favourites: loved or 4 stars and up, not played in 60 days (or not in Nabbit).
    const forgot = shuffled(own.filter((t) => (t.loved || t.rating >= 4) && !(playOf(t) && playOf(t).last > Date.now() - 60 * DAY))).slice(0, 16);
    if (forgot.length) parts.push(songs('forgotten', 'Forgotten favourites', forgot, { sub: (t) => { const o = playOf(t); return `${t.artist || ''} · ${o ? `last played ${Math.round((Date.now() - o.last) / DAY)} days ago` : 'not played in Nabbit yet'}`; } }));

    // Your playlists.
    const pls = (playlists || []).filter((p) => p.items && p.items.length);
    if (pls.length) parts.push(grid('playlists', 'Your playlists', pls.map((pl) => {
      const list = pl.items.map((p) => byPath.get(p)).filter(Boolean);
      const t = tile(mosaic(list), pl.name, `${pl.items.length} songs`, () => P.playTracks(list, 0));
      t.title = `Play ${pl.name}`;
      t.oncontextmenu = (e) => { e.preventDefault(); P.openView({ kind: 'playlist', id: pl.id }); };
      return t;
    })));

    // From your other homes: the first songs of your YouTube Music / SoundCloud homes (once loaded there).
    const S = window.Sources;
    for (const [v, name] of [['youtube', 'YouTube Music'], ['soundcloud', 'SoundCloud']]) {
      const data = S && S.peek ? S.peek(v) : null;
      const sec = data && (data.sections || []).find((x) => x.kind === 'songs' && x.items.length);
      if (!sec) continue;
      const list = sec.items.slice(0, 12).map((t) => ({ ...t, stream: true, playable: true }));
      const box2 = songs('elsewhere', `${sec.title} · ${name}`, list, { max: 6 });
      const go = h('button', { type: 'button', className: 'link-btn ap-more', textContent: `Open your ${name} home ▸` });
      go.onclick = () => S.set(v);
      box2.append(go);
      parts.push(box2);
    }

    for (const p of parts) { if (hidden.has(p.dataset.part)) p.classList.add('hidden'); box.append(p); }
    if (own.length && !Object.keys(plays).length) box.append(h('p', { className: 'hm-note small nh-hint', textContent: 'Listen again and On repeat fill in as you play songs (a song counts once half of it has played).' }));
    box.scrollTop = 0;
  }

  function stop() { seq++; root = null; if (io) { io.disconnect(); io = null; } }
  window.NabbitHome = { show, stop };
})();
