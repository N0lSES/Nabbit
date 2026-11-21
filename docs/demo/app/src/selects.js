// Every dropdown in the HUD style. Each <select> stays in the page, hidden, and keeps the value (the
// rest of the app fills and reads it as before); a button and a list drawn in the app's style sit in
// its place and follow it: options added or removed, the value set from code, disabled, the "out of
// range" colouring and hidden slots. The list opens below the button, or above it near the bottom of
// the window, and is drawn on top of everything (the player and the bottom bar included).
// The Converter's preset box has its own picker with collapsible groups (renderer.js) and is skipped.
(() => {
  const SKIP = 'pk-native';
  const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indexProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let openFor = null; // the dropdown whose list is open

  const pop = document.createElement('div');
  pop.className = 'pk-pop dd-pop hidden';
  pop.setAttribute('role', 'listbox');
  document.body.append(pop);

  function labelOf(sel) {
    if (sel.getAttribute('aria-label')) return sel.getAttribute('aria-label');
    if (sel.title) return sel.title;
    const lab = sel.closest('label');
    return lab ? lab.textContent.replace(/\s+/g, ' ').trim() : 'Choose';
  }

  function enhance(sel) {
    if (sel.dataset.dd || sel.classList.contains(SKIP)) return;
    sel.dataset.dd = '1';
    const wrap = document.createElement('span');
    wrap.className = 'dd';
    wrap.dataset.for = sel.id || '';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(sel);
    sel.classList.add('dd-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pk-btn dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="pk-val"></span><span class="pk-caret" aria-hidden="true">▾</span>';
    wrap.append(btn);
    sel._dd = { wrap, btn };

    const refresh = () => paint(sel);
    // Values set from code ("sel.value = …") don't fire events: follow them.
    Object.defineProperty(sel, 'value', { configurable: true, get() { return valueProp.get.call(this); }, set(v) { valueProp.set.call(this, v); refresh(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indexProp.get.call(this); }, set(v) { indexProp.set.call(this, v); refresh(); } });
    sel.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'title', 'selected', 'label'] });
    // A click on the field's label lands on the hidden select: send it to the button.
    sel.addEventListener('focus', () => btn.focus());
    btn.addEventListener('click', (e) => { e.preventDefault(); if (openFor === sel) close(); else open(sel); });
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && openFor !== sel) { e.preventDefault(); open(sel); }
    });
    paint(sel);
  }

  function paint(sel) {
    const d = sel._dd;
    if (!d) return;
    const o = sel.selectedOptions[0];
    d.btn.querySelector('.pk-val').textContent = o ? o.textContent : '';
    d.btn.disabled = sel.disabled || !sel.options.length;
    d.btn.title = sel.title || '';
    d.btn.setAttribute('aria-label', `${labelOf(sel)}: ${o ? o.textContent : 'none'}`);
    // Classes that shape the field (hidden slots, out-of-range colouring, hidden) carry over.
    for (const c of ['slot-hidden', 'oor', 'hidden']) d.wrap.classList.toggle(c, sel.classList.contains(c));
    d.btn.classList.toggle('oor', !!(o && o.classList.contains('oor')) || sel.classList.contains('oor'));
    if (openFor === sel) list(sel);
  }

  function list(sel) {
    pop.innerHTML = '';
    const add = (o, parent) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pk-item' + (o.selected ? ' on' : '') + (o.classList.contains('oor') ? ' oor' : '');
      b.textContent = o.textContent;
      b.disabled = o.disabled;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(o.selected));
      b.onclick = () => pick(sel, o.value);
      parent.append(b);
    };
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') {
        const head = document.createElement('div');
        head.className = 'dd-group';
        head.textContent = node.label;
        pop.append(head);
        for (const o of node.children) add(o, pop);
      } else if (node.tagName === 'OPTION') {
        add(node, pop);
      }
    }
  }

  function place(sel) {
    const r = sel._dd.btn.getBoundingClientRect();
    pop.style.minWidth = `${Math.round(r.width)}px`;
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.style.maxHeight = '';
    const h = Math.min(pop.scrollHeight + 2, 320);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 40; // stay under the title bar
    const up = below < Math.min(h, 200) && above > below;
    const room = Math.max(120, up ? above : below);
    pop.style.maxHeight = `${Math.min(320, room)}px`;
    const height = Math.min(h, room);
    const w = pop.offsetWidth;
    pop.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left)))}px`;
    pop.style.top = `${Math.round(up ? r.top - height - 4 : r.bottom + 4)}px`;
    pop.classList.toggle('up', up);
  }

  function open(sel) {
    close();
    openFor = sel;
    list(sel);
    pop.classList.remove('hidden');
    sel._dd.btn.setAttribute('aria-expanded', 'true');
    sel._dd.wrap.classList.add('open');
    place(sel);
    const on = pop.querySelector('.pk-item.on') || pop.querySelector('.pk-item:not(:disabled)');
    if (on) { on.scrollIntoView({ block: 'nearest' }); on.focus(); }
  }
  function close(refocus = false) {
    if (!openFor) return;
    const sel = openFor;
    openFor = null;
    pop.classList.add('hidden');
    sel._dd.btn.setAttribute('aria-expanded', 'false');
    sel._dd.wrap.classList.remove('open');
    if (refocus) sel._dd.btn.focus();
  }
  function pick(sel, value) {
    const changed = valueProp.get.call(sel) !== value;
    valueProp.set.call(sel, value);
    paint(sel);
    close(true);
    if (changed) {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  pop.addEventListener('keydown', (e) => {
    const items = [...pop.querySelectorAll('.pk-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[i] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[i] || items[0]).focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0] && items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1] && items[items.length - 1].focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!openFor) return;
    if (pop.contains(e.target) || openFor._dd.wrap.contains(e.target)) return;
    close();
  }, true);
  // Scrolling the page or resizing moves the button: close the list rather than leave it floating.
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', (e) => { if (openFor && !pop.contains(e.target)) close(); }, true);
  window.addEventListener('blur', () => close());

  document.querySelectorAll('select').forEach(enhance);
  // Dropdowns added later (none today, but cheap to cover).
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'SELECT') enhance(n);
      else n.querySelectorAll && n.querySelectorAll('select').forEach(enhance);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
