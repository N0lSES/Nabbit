// Settings → Share links: Tailscale Funnel on / off, how long new links last, the links you've made
// (copy, take back), and "Share link" for the Recent list (window.nabbitShare).
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('sh-group') || !window.api.shareStatus) return;
  let st = null;
  const clean = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const left = (t) => {
    const s = (t - Date.now()) / 1000;
    if (s <= 0) return 'ending';
    if (s < 3600) return `ends in ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 172800) return `ends in ${Math.round(s / 3600)} h`;
    return `ends in ${Math.round(s / 86400)} days`;
  };
  const STATUS = {
    off: 'Off',
    starting: 'Starting Tailscale Funnel…',
    'needs-enable': 'Funnel needs turning on for your tailnet (once): use the button, approve it in your browser, and sharing starts.',
    missing: "Tailscale isn't installed. Get it, sign in, then turn this on.",
    'signed-out': "Tailscale isn't signed in. Open Tailscale and sign in, then try again.",
  };
  function paint(s) {
    if (s) st = s;
    if (!st) return;
    const on = st.state === 'on';
    $('sh-status').textContent = on ? `On · https://${st.host}` : st.state === 'error' ? `Stopped: ${st.error || 'something went wrong'}` : STATUS[st.state] || st.state;
    $('sh-status').classList.toggle('on', on);
    $('sh-status').classList.toggle('err', st.state === 'error');
    $('sh-enable').classList.toggle('hidden', st.state !== 'needs-enable' || !st.enableUrl);
    $('sh-retry').classList.toggle('hidden', !(st.on && ['error', 'signed-out', 'missing'].includes(st.state)));
    $('sh-get').classList.toggle('hidden', false);
    $('sh-on').checked = st.on;
    if (document.activeElement !== $('sh-hours')) $('sh-hours').value = String(st.hours);
    $('sh-embed').checked = st.embedOn;
    if (document.activeElement !== $('sh-style')) $('sh-style').value = st.style || 'clean';
    $('sh-embed-info').textContent = `Videos over ${Math.round(st.embedTarget / 1e6)} MB get one${st.upBps ? ` (your upload reached Discord at ${(st.upBps / 1e6).toFixed(1)} MB/s)` : ' (sized to your upload once Discord has fetched a big video)'}.`;
    const ul = $('sh-list');
    ul.textContent = '';
    for (const x of st.list) {
      const li = document.createElement('li');
      li.className = 'sh-item' + (x.exists ? '' : ' gone');
      const tx = document.createElement('div');
      tx.className = 'sh-tx';
      const b = document.createElement('b');
      b.textContent = x.title;
      b.title = x.source || x.path;
      const small = document.createElement('small');
      small.textContent = [x.views ? `${x.views} view${x.views === 1 ? '' : 's'}` : 'not opened yet', x.expires ? left(x.expires) : 'no end',
        !x.exists ? 'file moved or deleted' : x.fixed ? 'an MP4 copy so it plays in Discord' : !x.embeds ? "won't play inside Discord; opens in a browser" : '',
        x.light ? 'Discord gets a lighter copy' : ''].filter(Boolean).join(' · ');
      tx.append(b, small);
      const copy = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Copy link' });
      copy.disabled = !on || !x.exists;
      copy.title = on ? x.url : 'Sharing is off';
      copy.addEventListener('click', async () => { if (await window.api.shareCopy(x.token)) { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy link'; }, 1500); } });
      const other = st.style === 'page' ? 'clean' : 'page';
      const alt = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: other === 'page' ? 'Page link' : 'Clean link' });
      alt.disabled = copy.disabled;
      alt.title = other === 'page' ? 'Copy the link to its page (title, picture, original in a browser)' : 'Copy the clean link (just the video in Discord)';
      alt.addEventListener('click', async () => { if (await window.api.shareCopy(x.token, other)) { alt.textContent = 'Copied'; setTimeout(() => { alt.textContent = other === 'page' ? 'Page link' : 'Clean link'; }, 1500); } });
      const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Take back' });
      rm.title = 'The link stops working';
      rm.addEventListener('click', async () => paint(await window.api.shareRevoke(x.token)));
      li.append(tx, copy, alt, rm);
      ul.append(li);
    }
    if (!st.list.length) ul.append(Object.assign(document.createElement('li'), { className: 'sh-empty', textContent: 'No links yet.' }));
  }
  window.api.shareStatus().then(paint).catch(() => {});
  window.api.onShareStatus(paint);
  $('sh-get').addEventListener('click', async () => {
    const how = await window.api.shareGetTailscale().catch(() => 'page');
    say(how === 'installer' ? 'Downloading the Tailscale installer: run it and sign in. Sharing starts by itself after that.' : 'Opened the Tailscale download page.');
  });
  $('sh-enable').addEventListener('click', () => window.api.shareEnable());
  if ($('sh-log')) $('sh-log').addEventListener('click', () => window.api.shareLog());
  $('sh-retry').addEventListener('click', async () => paint(await window.api.shareSet({ retry: true })));
  $('sh-on').addEventListener('change', async () => paint(await window.api.shareSet({ on: $('sh-on').checked })));
  $('sh-style').addEventListener('change', async () => paint(await window.api.shareSet({ style: $('sh-style').value })));
  $('sh-embed').addEventListener('change', async () => paint(await window.api.shareSet({ embed: $('sh-embed').checked })));
  $('sh-hours').addEventListener('change', async () => paint(await window.api.shareSet({ hours: Number($('sh-hours').value) })));
  $('sh-pick').addEventListener('click', async () => {
    try { const r = await window.api.sharePick(); if (r) note(r); } catch (e) { $('sh-status').textContent = clean(e); $('sh-status').classList.add('err'); }
  });
  // A short note at the bottom of the window.
  let noteTimer = 0;
  function say(text, hold = false) {
    let t = document.querySelector('.sh-toast');
    if (!t) { t = document.createElement('div'); t.className = 'sh-toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(noteTimer);
    if (!hold) noteTimer = setTimeout(() => t.classList.remove('on'), 4000);
  }
  function note(r) {
    window.api.shareStatus().then(paint).catch(() => {});
    const failed = r.fixed && r.fixed.startsWith('failed');
    const mb = `${Math.round((r.target || 0) / 1e6)} MB`;
    const tail = r.embed ? ` (Discord gets a ${mb} copy; the link's page keeps the original)`
      : r.embedNote === 'too-long' ? ` (too long to squeeze into ${mb} for Discord's player at your upload speed: it shows as a link that opens in a browser)`
        : r.embedNote ? " (couldn't make a copy small enough for Discord's player: it may show as a plain link)"
          : r.fixed && !failed ? ' (made an MP4 copy so it plays there)' : failed || !r.embeds ? " (it won't play inside Discord; it opens in a browser)" : '';
    say(r.copied ? `Link copied: paste it in Discord${tail}`
      : r.state === 'needs-enable' ? 'Link made: turn on Funnel for your tailnet (Settings → Share links), then Copy link.'
        : 'Link made: Copy link works once sharing has started (Settings → Share links).');
  }
  // Making an MP4 copy for Discord: a running note.
  const KIND = { remux: 'Repackaging as MP4', audio: 'Converting the sound for Discord', encode: 'Converting to MP4 for Discord', embed: "Making a lighter copy for Discord's player" };
  if (window.api.onShareProgress) window.api.onShareProgress((p) => { if (p.pct < 100) say(`${KIND[p.kind] || 'Getting it ready'}… ${p.pct}% · ${p.name}`, true); });
  // Drop a video on the Share links section.
  const grp = $('sh-group');
  const hasFiles = (e) => [...(e.dataTransfer && e.dataTransfer.types) || []].includes('Files');
  grp.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; grp.classList.add('sh-over'); });
  grp.addEventListener('dragleave', (e) => { if (!grp.contains(e.relatedTarget)) grp.classList.remove('sh-over'); });
  grp.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    grp.classList.remove('sh-over');
    for (const f of [...e.dataTransfer.files]) { const p = window.api.pathForFile ? window.api.pathForFile(f) : f.path; if (p) window.nabbitShare(p); }
  });
  // For the Recent list's menu.
  window.nabbitShare = async (file) => {
    try { note(await window.api.shareCreate(file)); } catch (e) { say(clean(e)); }
  };
})();
