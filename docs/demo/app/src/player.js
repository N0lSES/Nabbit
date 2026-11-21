// Music player: plays songs without downloading them (streamer.js in the main process serves them,
// saving each one to the cache as it plays). A queue (the list you played from), synced lyrics from
// LRCLIB, volume, a quality preset, Windows' media keys, and clickable title / artist / album.
// renderer.js calls window.Player.play(item, list, index); items are { url, title, artist, artistLinks,
// album, albumUrl, thumbnail, duration }.
(() => {
  const $ = (id) => document.getElementById(id);
  const audio = new Audio();
  audio.preload = 'auto';
  const state = { queue: [], idx: -1, seq: 0, key: null, lines: [], synced: false, active: -1, quality: 'normal', retried: false, dragging: false, cachedNow: false };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };
  const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  // ---------- Small helpers ----------
  const clock = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };
  const current = () => state.queue[state.idx] || null;
  function setState(kind, text) {
    const el = $('pl-state');
    el.className = `pl-state ${kind || ''}`;
    el.textContent = text || ({ loading: 'Loading', buffering: 'Buffering', stream: 'Streaming', cached: 'Cached', error: 'Error' }[kind] || '');
    el.title = kind === 'cached' ? 'Saved on this PC: plays offline' : kind === 'stream' ? 'Playing from the site; saving to the cache as it plays' : (text || '');
    if (state.via && (kind === 'stream' || kind === 'cached')) {
      el.textContent = 'Via YT Music';
      el.title = "SoundCloud's copy is DRM-protected, so this plays the same song from YouTube Music.";
    }
  }

  // ---------- Now playing: title, artist and album (all clickable) ----------
  function goMusic() {
    const tab = document.querySelector('.tab[data-mode="music"]');
    if (tab && !tab.classList.contains('active')) tab.click();
  }
  function showItem(it) {
    $('player').classList.remove('hidden');
    $('pl-art').src = it.thumbnail || '';
    $('pl-art').parentElement.classList.toggle('empty', !it.thumbnail);
    $('pl-title').textContent = it.title || 'Unknown title';
    const sub = $('pl-sub');
    sub.innerHTML = '';
    const links = it.artistLinks && it.artistLinks.length ? it.artistLinks : null;
    if (links) {
      links.forEach((a, i) => {
        if (i) sub.append(', ');
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: a.name, title: `Open ${a.name}'s artist page` });
        b.onclick = () => { goMusic(); openArtist(a.url, { title: a.name }); };
        sub.append(b);
      });
    } else if (it.artist) {
      sub.append(it.artist);
    }
    if (it.album) {
      if (sub.childNodes.length) sub.append(' · ');
      if (it.albumUrl) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: it.album, title: `Open the album ${it.album}` });
        b.onclick = () => { goMusic(); muReturn = null; musicOpen(it.albumUrl, { title: it.album, artist: it.artist, artistLinks: it.artistLinks, thumbnail: it.thumbnail, kind: 'Album' }); };
        sub.append(b);
      } else {
        sub.append(it.album);
      }
    }
    $('pl-line').textContent = '';
    $('pl-line').classList.remove('err');
    $('pl-dur').textContent = clock(it.duration);
    $('pl-next').disabled = state.idx >= state.queue.length - 1;
    document.querySelectorAll('[data-play-url]').forEach((el) => el.classList.toggle('is-playing', el.dataset.playUrl === it.url));
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: it.title || '', artist: it.artist || '', album: it.album || '',
        artwork: it.thumbnail && /^https:/.test(it.thumbnail) ? [{ src: it.thumbnail, sizes: '512x512' }] : [] });
    }
  }
  $('pl-title').onclick = () => {
    const it = current();
    if (!it) return;
    goMusic();
    muReturn = null;
    musicOpen(it.url, it, false);
  };

  // ---------- Loading a track ----------
  async function loadTrack(i, { at = 0, autoplay = true, fresh = false } = {}) {
    if (i < 0 || i >= state.queue.length) return;
    state.idx = i;
    state.via = false;
    const it = state.queue[i];
    const seq = ++state.seq;
    showItem(it);
    setState('loading', 'Loading');
    audio.pause();
    paintProgress(0, it.duration || 0);
    lyricsFor(it);
    try {
      const s = await window.api.streamOpen(it.url, state.quality, { fresh, meta: { title: it.title, artist: it.artist, duration: it.duration } });
      if (seq !== state.seq) return;
      // Fill gaps (a pasted link or an album track) with what the lookup found.
      if (s.meta) {
        for (const k of ['title', 'artist', 'album', 'thumbnail', 'duration']) if (!it[k] && s.meta[k]) it[k] = s.meta[k];
        showItem(it);
      }
      state.key = s.key;
      state.retried = fresh;
      state.cachedNow = !!s.cached;
      // SoundCloud's copy was DRM-protected: this is the same song from YouTube Music.
      state.via = !!s.replaced;
      setState(s.cached ? 'cached' : 'stream', s.cached ? 'Cached' : 'Streaming');
      audio.src = s.src;
      if (at) audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.min(at, (audio.duration || at) - 0.5); }, { once: true });
      if (autoplay) audio.play().catch(() => {});
      prefetchNext();
    } catch (e) {
      if (seq !== state.seq) return;
      showError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }
  // What went wrong, under the title (the lyric line's spot) and in the status tooltip.
  function showError(msg) {
    setState('error', 'Couldn\'t play');
    $('pl-state').title = msg;
    const line = $('pl-line');
    line.textContent = `✕ ${msg}`;
    line.classList.add('err');
  }
  // The next track is looked up and cached in the background, so skipping is quick.
  let prefetchTimer = null;
  function prefetchNext() {
    clearTimeout(prefetchTimer);
    const next = state.queue[state.idx + 1];
    if (next && next.url) prefetchTimer = setTimeout(() => window.api.streamPrefetch(next.url, state.quality), 1500);
  }

  // ---------- Controls ----------
  function toggle() {
    if (!current()) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function next() { if (state.idx < state.queue.length - 1) loadTrack(state.idx + 1); }
  function prev() {
    if (audio.currentTime > 3 || state.idx <= 0) { audio.currentTime = 0; return; }
    loadTrack(state.idx - 1);
  }
  $('pl-play').onclick = toggle;
  $('pl-next').onclick = next;
  $('pl-prev').onclick = prev;
  $('pl-close').onclick = () => {
    state.seq++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.queue = [];
    state.idx = -1;
    $('player').classList.add('hidden');
    $('pl-lyrics').classList.add('hidden');
    document.querySelectorAll('.is-playing').forEach((el) => el.classList.remove('is-playing'));
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  };

  audio.addEventListener('play', () => { $('player').classList.add('playing'); $('pl-play').setAttribute('aria-label', 'Pause'); });
  audio.addEventListener('pause', () => { $('player').classList.remove('playing'); $('pl-play').setAttribute('aria-label', 'Play'); });
  audio.addEventListener('waiting', () => { if ($('pl-state').classList.contains('stream')) $('pl-state').textContent = 'Buffering'; });
  audio.addEventListener('playing', () => {
    const el = $('pl-state');
    if (el.classList.contains('buffering')) setState('cached', 'Cached');
    else if (el.classList.contains('stream')) el.textContent = 'Streaming';
  });
  audio.addEventListener('ended', () => { if (state.idx < state.queue.length - 1) next(); });
  audio.addEventListener('error', () => {
    const it = current();
    if (!it || !audio.getAttribute('src')) return;
    // An old address (they expire after a few hours): look the track up again, once.
    if (!state.retried) { loadTrack(state.idx, { at: audio.currentTime || 0, fresh: true }); return; }
    showError(audio.error && audio.error.message ? audio.error.message : 'The player couldn\'t read this stream.');
  });
  window.api.onStreamCached((key) => {
    if (key !== state.key) return;
    state.cachedNow = true;
    if ($('pl-state').classList.contains('stream')) setState('cached', 'Cached');
  });
  // Seeking: a SoundCloud song still arriving can't jump ahead yet; once it's cached, it reloads there.
  function seekTo(time) {
    const d = duration();
    time = Math.max(0, Math.min(d || time, time));
    const r = audio.seekable;
    if (r.length && time <= r.end(r.length - 1) + 0.25) { audio.currentTime = time; return; }
    if (state.cachedNow) { loadTrack(state.idx, { at: time, autoplay: !audio.paused }); return; }
    const el = $('pl-state');
    const was = el.textContent;
    el.textContent = 'Seek once cached';
    setTimeout(() => { if (el.textContent === 'Seek once cached') el.textContent = was; }, 1800);
    paintProgress(audio.currentTime, d);
  }

  // ---------- Progress bar (click or drag to seek; arrow keys ±5 s) ----------
  function paintProgress(t, d) {
    const pct = d ? Math.max(0, Math.min(100, (t / d) * 100)) : 0;
    $('pl-fill').style.width = `${pct}%`;
    $('pl-knob').style.left = `${pct}%`;
    $('pl-cur').textContent = clock(t);
    if (d) $('pl-dur').textContent = clock(d);
    $('pl-bar').setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  const duration = () => (Number.isFinite(audio.duration) && audio.duration) || (current() && current().duration) || 0;
  audio.addEventListener('timeupdate', () => {
    if (!state.dragging) paintProgress(audio.currentTime, duration());
    paintLyric(audio.currentTime);
  });
  audio.addEventListener('progress', () => {
    const d = duration();
    if (!d || !audio.buffered.length) return;
    $('pl-buf').style.width = `${Math.min(100, (audio.buffered.end(audio.buffered.length - 1) / d) * 100)}%`;
  });
  audio.addEventListener('durationchange', () => paintProgress(audio.currentTime, duration()));
  const bar = $('pl-bar');
  const ratioAt = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  bar.addEventListener('pointerdown', (e) => {
    if (!current()) return;
    state.dragging = true;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('drag');
    paintProgress(ratioAt(e) * duration(), duration());
  });
  bar.addEventListener('pointermove', (e) => { if (state.dragging) paintProgress(ratioAt(e) * duration(), duration()); });
  bar.addEventListener('pointerup', (e) => {
    if (!state.dragging) return;
    state.dragging = false;
    bar.classList.remove('drag');
    const d = duration();
    if (d) seekTo(ratioAt(e) * d);
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { seekTo(audio.currentTime + 5); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { seekTo(audio.currentTime - 5); e.preventDefault(); }
  });

  // ---------- Volume ----------
  const vol = $('pl-volume');
  audio.volume = Math.max(0, Math.min(1, Number(load('nabbit-volume') ?? 0.8)));
  audio.muted = load('nabbit-muted') === '1';
  function paintVolume() {
    vol.value = String(audio.muted ? 0 : audio.volume);
    vol.style.setProperty('--v', `${(audio.muted ? 0 : audio.volume) * 100}%`);
    $('player').classList.toggle('muted', audio.muted || audio.volume === 0);
    $('pl-mute').setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
  }
  vol.addEventListener('input', () => {
    audio.volume = Number(vol.value);
    audio.muted = audio.volume === 0;
    store('nabbit-volume', String(audio.volume));
    store('nabbit-muted', audio.muted ? '1' : '0');
    paintVolume();
  });
  $('pl-mute').onclick = () => {
    audio.muted = !audio.muted;
    if (!audio.muted && audio.volume === 0) audio.volume = 0.5;
    store('nabbit-muted', audio.muted ? '1' : '0');
    paintVolume();
  };
  paintVolume();

  // ---------- Quality (changing it reloads the song at the same point, at the new quality) ----------
  const qSel = $('pl-q');
  window.api.settingsGet().then((st) => { state.quality = st.streamQuality || 'normal'; qSel.value = state.quality; });
  window.api.onSettings((st) => { if (st.streamQuality && st.streamQuality !== state.quality) { state.quality = st.streamQuality; qSel.value = state.quality; } });
  qSel.addEventListener('change', () => {
    state.quality = qSel.value;
    window.api.settingsSet({ streamQuality: state.quality });
    if (current()) loadTrack(state.idx, { at: audio.currentTime, autoplay: !audio.paused });
  });

  // ---------- Synced lyrics (LRCLIB) ----------
  // LRC lines "[01:02.34] words", including the "enhanced" kind with a time on each word:
  // "[00:31.32] <00:31.32>You <00:31.66>wouldn't …" → { t, text, words: [{ t, w }] }.
  const secs = (m, s) => Number(m) * 60 + Number(String(s).replace(':', '.'));
  function parseLrc(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, '');
      const words = [];
      const re = /<(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)>([^<]*)/g;
      const lead = body.split('<')[0];
      let m;
      while ((m = re.exec(body))) if (m[3].trim()) words.push({ t: secs(m[1], m[2]), w: m[3].trim() });
      const plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      for (const st of stamps) {
        const t = secs(st[1], st[2]);
        out.push({ t, text: plain, words: words.length ? (lead.trim() ? [{ t, w: lead.trim() }, ...words] : words) : null });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // A line as word spans (karaoke) when it has word times.
  function fillLine(el, line, prefix = '') {
    el.textContent = '';
    if (prefix) el.append(prefix);
    if (!line || !line.words) { el.append(line ? line.text : ''); return; }
    line.words.forEach((x, i) => {
      if (i) el.append(' ');
      el.append(Object.assign(document.createElement('span'), { className: 'w', textContent: x.w }));
    });
  }
  function paintWords(el, line, t) {
    if (!line || !line.words) return;
    const spans = el.querySelectorAll('.w');
    line.words.forEach((x, i) => { if (spans[i]) spans[i].classList.toggle('sung', x.t <= t + 0.05); });
  }
  let lyricSeq = 0;
  async function lyricsFor(it) {
    const seq = ++lyricSeq;
    state.lines = []; state.synced = false; state.active = -1;
    const list = $('pl-lines');
    list.innerHTML = '';
    $('pl-lyr-note').textContent = 'Looking up…';
    $('pl-lyr').classList.remove('has');
    const found = await window.api.streamLyrics({ title: it.title, artist: it.artist, album: it.album, duration: it.duration });
    if (seq !== lyricSeq) return;
    if (found && found.synced) {
      state.lines = parseLrc(found.synced);
      state.synced = state.lines.length > 0;
    }
    if (!state.synced && found && found.plain) state.lines = found.plain.split(/\r?\n/).map((text) => ({ t: null, text }));
    $('pl-lyr-note').textContent = found && found.instrumental ? 'Instrumental' : state.synced ? 'Synced · from LRCLIB · click a line to jump' : state.lines.length ? 'Not synced · from LRCLIB' : 'No lyrics found';
    $('pl-lyr').classList.toggle('has', state.lines.length > 0);
    state.lines.forEach((l, i) => {
      const li = document.createElement('li');
      if (l.words) fillLine(li, l); else li.textContent = l.text || '♪';
      if (l.t != null) { li.tabIndex = 0; li.onclick = () => { audio.currentTime = l.t; if (audio.paused) audio.play().catch(() => {}); }; }
      li.dataset.i = String(i);
      list.append(li);
    });
    paintLyric(audio.currentTime);
  }
  function paintLyric(t) {
    if ($('pl-line').classList.contains('err')) return;
    if (!state.synced) { $('pl-line').textContent = ''; return; }
    let i = -1;
    for (let k = 0; k < state.lines.length && state.lines[k].t <= t + 0.15; k++) i = k;
    const el = $('pl-line');
    if (i === state.active) {
      // Same line: light up the words sung so far.
      if (i >= 0) { paintWords(el, state.lines[i], t); paintWords($('pl-lines').children[i], state.lines[i], t); }
      return;
    }
    state.active = i;
    const cur = i >= 0 ? state.lines[i] : null;
    if (cur && cur.text) fillLine(el, cur, '♪ '); else el.textContent = '';
    if (cur) { paintWords(el, cur, t); paintWords($('pl-lines').children[i], cur, t); }
    el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip');
    const items = $('pl-lines').children;
    for (const li of items) li.classList.toggle('on', Number(li.dataset.i) === i);
    if (i >= 0 && items[i] && !$('pl-lyrics').classList.contains('hidden')) {
      const box = $('pl-lines');
      box.scrollTo({ top: items[i].offsetTop - box.clientHeight / 2 + items[i].offsetHeight / 2, behavior: 'smooth' });
    }
  }
  $('pl-lyr').onclick = () => {
    const open = $('pl-lyrics').classList.toggle('hidden') === false;
    $('pl-lyr').setAttribute('aria-pressed', String(open));
    $('pl-lyr').classList.toggle('on', open);
    if (open) { state.active = -2; paintLyric(audio.currentTime); }
  };

  // ---------- Windows media keys / the volume overlay's controls ----------
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play().catch(() => {}));
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('previoustrack', prev);
    try { ms.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch { /* older */ }
  }

  window.Player = {
    /** Plays item, with list (the songs around it) as the queue. */
    play(item, list = null, index = null) {
      const queue = (list && list.length ? list : [item]).filter((x) => x && x.url);
      if (!queue.length) return;
      state.queue = queue.map((x) => ({ ...x }));
      const i = index != null ? index : Math.max(0, queue.findIndex((x) => x.url === item.url));
      loadTrack(Math.min(i, state.queue.length - 1));
    },
    get nowPlaying() { return current(); },
    /** Looks a song up ahead of time (hovering its ▶), so it starts quicker. */
    warm(url) { if (url) window.api.streamWarm(url, state.quality); },
  };
})();
