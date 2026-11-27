// Back and forward through where you've been in Nabbit, like a browser: the mouse's back / forward
// buttons, Alt+← / Alt+→ and the keyboard's Back / Forward keys. Each place records how to get back to
// it (Nav.record(key, go)): Toolbox tools, Player mode and its tabs, Local Files' views, artist and album
// pages (Player and Music Downloader). Going back or forward runs that place's go() without recording.
(() => {
  const MAX = 100;
  let list = [], at = -1, restoring = false, lastInput = 0;
  function record(key, go) {
    if (restoring || !key || typeof go !== 'function') return;
    if (list[at] && list[at].key === key) { list[at].go = go; return; }
    list = list.slice(0, at + 1);
    list.push({ key, go });
    if (list.length > MAX) list = list.slice(list.length - MAX);
    at = list.length - 1;
  }
  function move(d) {
    const i = at + d;
    if (i < 0 || i >= list.length) return false;
    at = i;
    restoring = true;
    try { list[i].go(); } catch (e) { console.warn('Back / forward:', e); } finally { restoring = false; }
    return true;
  }
  const back = () => move(-1), forward = () => move(1);
  // One press can arrive twice (the mouse event, and Windows' app command from main.js): once only.
  function from(dir) {
    const now = Date.now();
    if (now - lastInput < 350) return;
    lastInput = now;
    if (dir === 'back') back(); else forward();
  }
  // Mouse buttons 4 and 5 (back, forward): on release, and their press doesn't do anything else.
  addEventListener('mousedown', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); }, true);
  addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    from(e.button === 3 ? 'back' : 'forward');
  }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'BrowserBack' || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key === 'ArrowLeft')) { e.preventDefault(); from('back'); }
    else if (e.key === 'BrowserForward' || (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key === 'ArrowRight')) { e.preventDefault(); from('forward'); }
  }, true);
  if (window.api && window.api.onNavHistory) window.api.onNavHistory((dir) => from(dir));
  window.Nav = { record, back, forward, get restoring() { return restoring; }, get canBack() { return at > 0; }, get canForward() { return at < list.length - 1; } };
})();
