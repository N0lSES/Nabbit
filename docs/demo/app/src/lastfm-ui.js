// Settings → Last.fm: your API account's key and secret, signing in (in the browser), and what's sent.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('lf-group') || !window.api.lastfmStatus) return;
  let st = null, busy = false;
  function paint(s) {
    if (s) st = s;
    if (!st) return;
    const signedIn = !!st.user;
    $('lf-status').textContent = st.connecting ? 'Waiting for you to approve Nabbit on Last.fm (in your browser)…'
      : signedIn ? `Signed in as ${st.user}${st.pending ? ` · ${st.pending} play${st.pending === 1 ? '' : 's'} waiting to be sent` : ''}`
        : st.key && st.hasSecret ? 'Keys saved · not signed in' : 'Not set up';
    $('lf-status').classList.toggle('on', signedIn);
    if (document.activeElement !== $('lf-key')) $('lf-key').value = st.key || '';
    $('lf-secret').placeholder = st.hasSecret ? 'Shared secret (saved)' : 'Shared secret';
    $('lf-connect').classList.toggle('hidden', signedIn || st.connecting);
    $('lf-connect').disabled = !(st.key && st.hasSecret) || busy;
    $('lf-cancel').classList.toggle('hidden', !st.connecting);
    $('lf-out').classList.toggle('hidden', !signedIn);
    $('lf-on').checked = st.on;
    $('lf-love').checked = st.love;
    $('lf-love').disabled = !st.on;
  }
  const note = (text, err = false) => { $('lf-status').textContent = text; $('lf-status').classList.toggle('err', err); setTimeout(() => $('lf-status').classList.remove('err'), 4000); };
  window.api.lastfmStatus().then(paint).catch(() => {});
  window.api.onLastfmStatus(paint);
  $('lf-create').addEventListener('click', () => window.api.openExternal('https://www.last.fm/api/account/create'));
  $('lf-save').addEventListener('click', async () => {
    try {
      paint(await window.api.lastfmKeys($('lf-key').value, $('lf-secret').value));
      $('lf-secret').value = '';
    } catch (e) { note(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  });
  $('lf-connect').addEventListener('click', async () => {
    busy = true;
    paint();
    try { paint(await window.api.lastfmConnect()); }
    catch (e) { note(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); window.api.lastfmStatus().then(paint); }
    finally { busy = false; paint(); }
  });
  $('lf-cancel').addEventListener('click', async () => paint(await window.api.lastfmCancel()));
  $('lf-out').addEventListener('click', async () => paint(await window.api.lastfmDisconnect()));
  $('lf-on').addEventListener('change', async () => paint(await window.api.lastfmSet({ on: $('lf-on').checked })));
  $('lf-love').addEventListener('change', async () => paint(await window.api.lastfmSet({ love: $('lf-love').checked })));
})();
