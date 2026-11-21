// Tooltips as HUD bubbles instead of Windows' plain ones. Works for every element with a title,
// including ones added or changed later: on hover the title moves to data-tip (so Windows doesn't
// show its own), and the bubble appears under the element (above it near the bottom of the window).
(() => {
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let current = null;
  let timer = null;

  function adopt(el) {
    const t = el.getAttribute('title');
    if (t) {
      el.dataset.tip = t;
      el.removeAttribute('title');
      // Icon-only controls keep an accessible name.
      if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
    }
    return el.dataset.tip || '';
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const gap = 9;
    const below = r.bottom + gap + th <= window.innerHeight - 4;
    const top = below ? r.bottom + gap : r.top - gap - th;
    const centre = r.left + r.width / 2;
    const left = Math.max(6, Math.min(window.innerWidth - tw - 6, centre - tw / 2));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.setProperty('--ax', `${Math.round(Math.max(10, Math.min(tw - 10, centre - left)))}px`);
    tip.classList.toggle('above', !below);
  }

  function show(el) {
    const text = adopt(el);
    if (!text) return;
    tip.textContent = text;
    tip.classList.remove('show');
    place(el);
    void tip.offsetWidth; // restart the fade
    tip.classList.add('show');
  }
  function hide() {
    clearTimeout(timer);
    timer = null;
    current = null;
    tip.classList.remove('show');
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[title], [data-tip]');
    if (el === current) return;
    hide();
    if (!el || el.tagName === 'OPTION' || (el.tagName === 'SELECT' && el.matches(':focus'))) return;
    adopt(el);
    current = el;
    timer = setTimeout(() => { if (current === el && el.isConnected) show(el); }, 380);
  });
  document.addEventListener('mouseout', (e) => {
    if (current && (!e.relatedTarget || !current.contains(e.relatedTarget))) hide();
  });
  for (const ev of ['mousedown', 'wheel', 'keydown', 'blur']) window.addEventListener(ev, hide, { passive: true, capture: true });
  // Keyboard users: show it while a control with a tip has focus (not after a click: clicking a dropdown
  // or a text box counts as "focus-visible" too, and the tip would cover its list).
  let keyboard = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) keyboard = true; }, true);
  window.addEventListener('pointerdown', () => { keyboard = false; }, true);
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[title], [data-tip]');
    if (!el || !keyboard || !e.target.matches(':focus-visible')) return;
    current = el;
    show(el);
  });
  document.addEventListener('focusout', hide);
})();
