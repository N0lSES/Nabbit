// The Nabbit add-on for Firefox (extension/firefox, on addons.mozilla.org): what it does and where to
// get it. Shown in Settings → Browser extension, and as a card under the Downloader until a browser
// is connected (or you close it: ✕, kept).
(() => {
  const URL = 'https://addons.mozilla.org/en-US/firefox/addon/nabbit/';
  const FEATURES = [
    ['Download button on YouTube', 'Right under every video, next to Like: pick the format and download, or ♪ for just the audio.'],
    ['Download button on SoundCloud', 'On tracks, albums and playlists, in their own row of buttons, with the same download options.'],
    ['Right-click anything', 'Any page or link: Nabbit → Video Downloader or Music Downloader.'],
    ['One-click sign-in', "Signs Nabbit's Player in to YouTube Music and SoundCloud with the account you already use."],
    ['Private', 'Talks only to Nabbit on this PC. Collects no data.'],
  ];
  const HIDE = 'nabbit.addonPromo';
  const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };
  const open = () => { if (window.api && window.api.openExternal) window.api.openExternal(URL); };

  // The card: { compact } leaves out the descriptions (just the feature names).
  function card({ compact = false, onClose = null } = {}) {
    const get = h('button', { type: 'button', className: 'primary ao-get', textContent: 'Get it for Firefox' });
    get.onclick = open;
    get.title = URL;
    const list = h('ul', { className: 'ao-feats' + (compact ? ' compact' : '') },
      ...FEATURES.map(([t, d]) => h('li', {}, h('b', { textContent: t }), compact ? null : h('span', { textContent: d }))));
    const close = onClose ? h('button', { type: 'button', className: 'icon-btn ao-x', title: 'Hide this', ariaLabel: 'Hide this', textContent: '✕' }) : null;
    if (close) close.onclick = onClose;
    return h('div', { className: 'addon-promo' + (compact ? ' compact' : '') },
      h('div', { className: 'ao-head' },
        h('span', { className: 'ao-kicker', textContent: '■ Nabbit for Firefox' }),
        h('span', { className: 'ao-free', textContent: 'Free' }), close),
      h('div', { className: 'ao-body' },
        h('img', { className: 'ao-logo', src: 'assets/icon.png', alt: '' }),
        h('div', { className: 'ao-main' },
          h('h3', { className: 'ao-title', textContent: 'Download without leaving the page' }),
          h('p', { className: 'ao-lead', textContent: 'The Nabbit add-on puts a Download button right on YouTube and SoundCloud and sends it straight to this app: no copying links.' }),
          list,
          h('div', { className: 'ao-cta' }, get, h('span', { className: 'ao-fine', textContent: 'Firefox · then click Connect in its popup' })))));
  }

  // Under the Downloader, while no browser is connected (and you haven't hidden it).
  let connected = false;
  function paintDownloader() {
    const host = document.getElementById('download');
    if (!host) return;
    let box = document.getElementById('addon-promo-dl');
    let hidden = false;
    try { hidden = localStorage.getItem(HIDE) === 'hidden'; } catch { /* shown */ }
    if (connected || hidden) { if (box) box.remove(); return; }
    if (box) return;
    box = card({ compact: true, onClose: () => { try { localStorage.setItem(HIDE, 'hidden'); } catch { /* not kept */ } paintDownloader(); } });
    box.id = 'addon-promo-dl';
    host.append(box);
  }
  // Settings → Browser extension: the whole pitch until a browser is connected; then a link back to it.
  function paintSettings(n) {
    const slot = document.getElementById('st-ext-promo');
    if (!slot) return;
    slot.textContent = '';
    if (n) {
      const a = h('button', { type: 'button', className: 'linkish', textContent: 'Nabbit on Firefox Add-ons' });
      a.onclick = open;
      slot.append(h('p', { className: 'hint small' }, 'Rate it or share it: ', a, '.'));
    } else slot.append(card());
  }
  // renderer.js calls this with Settings' list of connected browsers.
  window.AddonPromo = {
    url: URL,
    update(clients) {
      const n = (clients || []).length;
      connected = n > 0;
      paintDownloader();
      paintSettings(n);
    },
    show() { try { localStorage.removeItem(HIDE); } catch { /* fine */ } paintDownloader(); },
  };
})();
