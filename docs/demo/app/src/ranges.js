// Sliders: every <input type="range"> gets --a / --b (where its filled part starts and ends, in %),
// kept up to date however the value changes (dragging, keys, or code setting .value). A slider whose
// range crosses zero (Pan, EQ gain …) fills from zero instead of from the left end.
(() => {
  function paint(el) {
    if (el.type !== 'range') return;
    const min = Number(el.min || 0), max = Number(el.max === '' ? 100 : el.max), v = Number(el.value);
    if (!(max > min)) return;
    const at = (x) => `${(((x - min) / (max - min)) * 100).toFixed(3)}%`;
    const zero = min < 0 && max > 0 ? 0 : min;
    el.style.setProperty('--a', at(Math.min(zero, v)));
    el.style.setProperty('--b', at(Math.max(zero, v)));
  }
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); if (this.type === 'range') paint(this); },
  });
  document.addEventListener('input', (e) => paint(e.target), true);
  document.addEventListener('change', (e) => paint(e.target), true);
  const all = () => document.querySelectorAll('input[type=range]').forEach(paint);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
  // Sliders added later (tool panels build theirs on the fly).
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches('input[type=range]')) paint(n);
      n.querySelectorAll && n.querySelectorAll('input[type=range]').forEach(paint);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.paintRange = paint;
})();
