// Player → Nabbit Holes ("Discovery" in the code): a map of your taste, drawn like a brain. You sit in the middle; the artists you
// listen to (your library, and your likes / recently played on YouTube Music and SoundCloud when you're
// signed in) are wired to you; each of them is wired to the artists their fans also like (YouTube
// Music's "Fans might also like"). Artists new to you glow: the more of your artists lead to one, the
// bigger and brighter it is. Click one to hear its top songs, open its page, or grow the map from it.
// Signals run along the wires like nerve impulses; faint neurons fill the background.
// With Last.fm set up (Settings → Last.fm), your top artists over the period you pick count most, its
// similar artists join YouTube Music's, and each artist shows its numbers and your plays.
(() => {
  const h = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== '')); return n; };
  const clock = (s) => { s = Math.round(Number(s) || 0); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''; };
  const norm = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
  const asItem = (t) => (typeof playItem === 'function' ? playItem(t) : t);
  const SEEDS = 12; // your artists mapped at first
  const RELATED = 8; // neighbours shown per artist

  let root = null, canvas = null, ctx = null, raf = 0, running = false, built = false;
  let nodes = [], edges = [], byKey = new Map(), neurons = [], pulses = [];
  let dirty = true; // the graph changed: the tree / node layouts are worked out again
  const STYLES = [['brain', 'Brain', 'Your taste as a brain: wires and impulses'], ['tree', 'Tree', 'As a tree, from you down']];
  let style = 'brain';
  try { const v = localStorage.getItem('nabbit.discStyle'); if (STYLES.some((x) => x[0] === v)) style = v; } catch { /* default */ }
  let view = { x: 0, y: 0, k: 1 }, hover = null, selected = null, drag = null, W = 0, H = 0, dpr = 1, building = 0;
  let mine = new Set(); // your artists (normalised names)
  let ui = {};
  let lfm = null; // your Last.fm: { on, user, scrobbles, since, artists, period, top }
  const PERIODS = [['7day', '7 days'], ['1month', 'Month'], ['3month', '3 months'], ['6month', '6 months'], ['12month', 'Year'], ['overall', 'All time']];
  let period = '6month';
  try { const v = localStorage.getItem('nabbit.discPeriod'); if (PERIODS.some((x) => x[0] === v)) period = v; } catch { /* default */ }
  const n0 = (x) => Number(x || 0).toLocaleString();

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n) || d).trim() || d;
    return { text: v('--text', '#e9e9e6'), muted: v('--muted', '#9c9c98'), red: v('--red', '#ff2a1f'), line: v('--line', '#3a3a38'), bg: v('--panel', '#151514') };
  };
  let C = colors();

  // ---------- The graph ----------
  function addNode(key, props) {
    let n = byKey.get(key);
    if (n) { Object.assign(n, Object.fromEntries(Object.entries(props).filter(([, v]) => v != null))); return n; }
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 240;
    n = { key, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, links: new Set(), from: new Set(), score: 0, depth: props.kind === 'you' ? 0 : 1, ...props };
    nodes.push(n);
    byKey.set(key, n);
    dirty = true;
    return n;
  }
  function link(a, b, kind) {
    if (!a || !b || a === b || a.links.has(b)) return;
    a.links.add(b); b.links.add(a);
    edges.push({ a, b, kind });
    dirty = true;
  }
  function rescore() {
    for (const n of nodes) {
      if (n.kind !== 'new') continue;
      n.score = [...n.from].reduce((s, f) => s + 1 + Math.min(3, (f.weight || 1) / 10), 0) + (n.match || 0);
    }
    const picks = nodes.filter((n) => n.kind === 'new').sort((a, b) => b.score - a.score);
    picks.forEach((n, i) => { n.rank = i; });
    paintPicks(picks.slice(0, 14));
  }
  // An artist's neighbours into the map (from: the node they hang off).
  async function grow(from) {
    if (from.grown) return;
    from.grown = true;
    building++;
    paintStatus();
    let a = null;
    try { a = await window.api.discArtist({ name: from.name, url: from.url || null }); } catch { a = null; }
    building--;
    if (!running && !root) return;
    if (a) {
      from.url = from.url || a.url; from.thumbnail = from.thumbnail || a.thumbnail; from.info = a;
      for (const r of (a.related || []).slice(0, RELATED)) {
        const k = norm(r.name);
        if (!k) continue;
        const known = mine.has(k);
        const fresh = !byKey.has(k);
        const n = addNode(k, { name: r.name, url: r.url || undefined, thumbnail: r.thumbnail || undefined, kind: fresh ? (known ? 'known' : 'new') : undefined });
        if (r.match) n.match = Math.max(n.match || 0, r.match);
        // Where it hangs: the first artist that led to it (its parent in the tree).
        if (fresh) {
          n.parent = from; n.depth = from.depth + 1;
          // Out of the artist it came from.
          const a = Math.random() * Math.PI * 2;
          n.x = from.x + Math.cos(a) * 12; n.y = from.y + Math.sin(a) * 12; n.vx = Math.cos(a) * 7; n.vy = Math.sin(a) * 7;
        }
        n.from.add(from);
        link(from, n, 'rel');
      }
      rescore();
      if (selected === from) paintPanel(from);
    }
    paintStatus();
  }

  async function build() {
    built = true;
    nodes = []; edges = []; byKey = new Map(); pulses = []; selected = null;
    const you = addNode('__you', { name: 'You', kind: 'you', x: 0, y: 0, fixed: true });
    paintStatus('Reading your taste…');
    let seeds = [];
    try { seeds = await window.api.discSeeds(); } catch { seeds = []; }
    let liked = [];
    try { liked = window.Sources && window.Sources.likedArtists ? await window.Sources.likedArtists() : []; } catch { liked = []; }
    // Last.fm: your top artists over the period (plays, on a log scale: 1,000 plays ≈ 60, 10 ≈ 20).
    try { lfm = window.api.discLastfm ? await window.api.discLastfm(period) : null; } catch { lfm = null; }
    paintLastfm();
    for (const a of (lfm && lfm.on && lfm.top) || []) liked.push({ name: a.name, weight: Math.round(6 * Math.log2(1 + a.plays)), from: 'Last.fm', plays: a.plays });
    // One list: library artists plus your likes elsewhere, by weight.
    const all = new Map();
    for (const s of seeds) all.set(norm(s.name), { name: s.name, weight: s.weight, from: ['Library'] });
    for (const l of liked) {
      const k = norm(l.name);
      if (!k) continue;
      const cur = all.get(k) || { name: l.name, weight: 0, from: [] };
      cur.weight += l.weight;
      if (!cur.from.includes(l.from)) cur.from.push(l.from);
      if (l.url && !cur.url) cur.url = l.url;
      if (l.plays) cur.plays = (cur.plays || 0) + l.plays;
      all.set(k, cur);
    }
    mine = new Set(all.keys());
    const top = [...all.values()].sort((a, b) => b.weight - a.weight).slice(0, SEEDS);
    if (!top.length) { paintStatus('Nothing to map yet: add music to your library, or sign in to YouTube Music or SoundCloud.'); return; }
    for (const s of top) {
      const n = addNode(norm(s.name), { name: s.name, url: s.url || null, kind: 'seed', weight: s.weight, sources: s.from, plays: s.plays || 0 });
      link(you, n, 'you');
    }
    // Three at a time, strongest first.
    const queue = nodes.filter((n) => n.kind === 'seed');
    await Promise.all([0, 1, 2].map(async () => { while (queue.length && running) await grow(queue.shift()); }));
    paintStatus();
    if (running && style === 'tree') setStyle(style); // fitted to the whole map

  }

  // ---------- Layout ----------
  // Brain: a small force simulation. Tree: worked-out places the artists glide to.
  function forces() {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 160000) continue;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        const f = 1400 / d2;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const e of edges) {
      const L = e.kind === 'you' ? 150 : 85;
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - L) * 0.012;
      e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f; e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      if (n.fixed || n === drag) { n.vx = n.vy = 0; continue; }
      n.vx -= n.x * 0.0009; n.vy -= n.y * 0.0009; // gently towards the middle
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += Math.max(-8, Math.min(8, n.vx)); n.y += Math.max(-8, Math.min(8, n.vy));
    }
  }
  // Each artist's children (the ones it led to first), in a steady order.
  const kids = (p) => nodes.filter((n) => (p.kind === 'you' ? n.kind === 'seed' : n.parent === p && n.kind !== 'seed'));
  const BOX = { tree: [138, 36] };
  function layoutTree() {
    // A tidy tree, top down: leaves side by side, each parent centred over its children.
    const [w, hh] = BOX.tree, gapX = 22, gapY = 74;
    let x = 0;
    const visit = (n, d, seen) => {
      seen.add(n);
      const cs = kids(n).filter((c) => !seen.has(c));
      n.ty = d * (hh + gapY);
      if (!cs.length) { n.tx = x; x += w + gapX; return; }
      for (const c of cs) visit(c, d + 1, seen);
      n.tx = (cs[0].tx + cs[cs.length - 1].tx) / 2;
    };
    const you = byKey.get('__you');
    if (!you) return;
    visit(you, 0, new Set());
    const mid = you.tx;
    for (const n of nodes) { if (n.tx == null) { n.tx = x; n.ty = hh + gapY; x += w + gapX; } n.tx -= mid; n.ty -= 120; }
  }
  function step() {
    if (style !== 'tree') { forces(); return; }
    if (dirty) { for (const n of nodes) { n.tx = null; n.ty = null; } layoutTree(); dirty = false; }
    for (const n of nodes) {
      if (n.tx == null) continue;
      n.x += (n.tx - n.x) * 0.12; n.y += (n.ty - n.y) * 0.12;
    }
  }

  // ---------- Drawing ----------
  const R = (n) => (n.kind === 'you' ? 9 : n.kind === 'seed' ? 6 : n.kind === 'known' ? 3.5 : 3 + Math.min(7, n.score * 1.6));
  const FONT = () => getComputedStyle(document.body).fontFamily;
  function makeNeurons() {
    neurons = Array.from({ length: Math.round((W * H) / 5200) }, () => ({ x: Math.random() * W, y: Math.random() * H, p: Math.random() * Math.PI * 2, r: 0.6 + Math.random() * 1.2 }));
    for (const n of neurons) n.near = neurons.filter((m) => m !== n && Math.hypot(m.x - n.x, m.y - n.y) < 70).slice(0, 2);
  }
  const toScreen = (n) => [W / 2 + (n.x + view.x) * view.k, H / 2 + (n.y + view.y) * view.k];
  function rrect(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function grid(g, step, color, bg) {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    const s = step * view.k;
    if (s < 6) return;
    g.strokeStyle = color; g.lineWidth = 1; g.globalAlpha = 1;
    const ox = (W / 2 + view.x * view.k) % s, oy = (H / 2 + view.y * view.k) % s;
    g.beginPath();
    for (let x = ox; x < W; x += s) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = oy; y < H; y += s) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
  }
  const lit = () => hover || selected;
  const nearOf = () => { const l = lit(); return l ? new Set([l, ...l.links]) : null; };

  // Brain: neurons, curved wires, impulses, glowing dots.
  function drawBrain(g, t) {
    g.lineWidth = 0.5;
    for (const n of neurons) {
      const a = 0.08 + 0.07 * Math.sin(t / 1400 + n.p);
      g.strokeStyle = C.muted; g.globalAlpha = a * 0.6;
      for (const m of n.near) { g.beginPath(); g.moveTo(n.x, n.y); g.lineTo(m.x, m.y); g.stroke(); }
      g.globalAlpha = a * 1.6; g.fillStyle = C.muted;
      g.beginPath(); g.arc(n.x, n.y, n.r, 0, Math.PI * 2); g.fill();
    }
    const l = lit(), near = nearOf();
    for (const e of edges) {
      const [x1, y1] = toScreen(e.a), [x2, y2] = toScreen(e.b);
      const on = near && near.has(e.a) && near.has(e.b) && (e.a === l || e.b === l);
      g.globalAlpha = on ? 0.9 : near ? 0.08 : e.kind === 'you' ? 0.35 : 0.2;
      g.strokeStyle = on ? C.red : C.text;
      g.lineWidth = on ? 1.4 : 0.7;
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
      g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
      e.mx = mx; e.my = my;
    }
    if (edges.length && Math.random() < 0.25) { const e = edges[(Math.random() * edges.length) | 0]; pulses.push({ e, t: 0, sp: 0.008 + Math.random() * 0.012 }); }
    pulses = pulses.filter((p) => p.t <= 1);
    for (const p of pulses) {
      p.t += p.sp;
      const [x1, y1] = toScreen(p.e.a), [x2, y2] = toScreen(p.e.b), u = p.t, mx = p.e.mx || (x1 + x2) / 2, my = p.e.my || (y1 + y2) / 2;
      const x = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2, y = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2;
      g.globalAlpha = Math.sin(u * Math.PI) * (near && !(near.has(p.e.a) && near.has(p.e.b)) ? 0.15 : 0.9);
      g.fillStyle = C.red;
      g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill();
    }
    for (const n of nodes) {
      const [x, y] = toScreen(n), r = R(n) * Math.max(0.7, Math.min(1.4, view.k));
      const dim = near && !near.has(n);
      g.globalAlpha = dim ? 0.18 : 1;
      if (n.kind === 'new') {
        const glow = g.createRadialGradient(x, y, 0, x, y, r * 3.2);
        glow.addColorStop(0, C.red); glow.addColorStop(1, 'transparent');
        g.globalAlpha = (dim ? 0.06 : 0.22 + Math.min(0.35, n.score * 0.08)) * (0.8 + 0.2 * Math.sin(t / 600 + n.x));
        g.fillStyle = glow; g.beginPath(); g.arc(x, y, r * 3.2, 0, Math.PI * 2); g.fill();
        g.globalAlpha = dim ? 0.25 : 1;
        g.fillStyle = C.red;
      } else g.fillStyle = n.kind === 'known' ? C.muted : C.text;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (n === selected) { g.strokeStyle = C.red; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.stroke(); }
      const label = n.kind === 'you' || n.kind === 'seed' || (n.kind === 'new' && n.rank < 10) || (near && near.has(n)) || view.k > 1.6;
      if (label && !(dim && n.kind !== 'seed')) {
        g.globalAlpha = dim ? 0.3 : n.kind === 'new' ? 1 : 0.85;
        g.fillStyle = n.kind === 'new' ? C.red : C.text;
        g.font = `${n.kind === 'you' || n.kind === 'seed' ? 700 : 400} ${n.kind === 'you' ? 12 : 11}px ${FONT()}`;
        g.textAlign = 'center';
        g.fillText(n.kind === 'you' ? 'YOU' : n.name, x, y - r - 6);
      }
    }
  }

  function clip(g, text, max) {
    text = String(text || '');
    if (g.measureText(text).width <= max) return text;
    while (text.length > 1 && g.measureText(`${text}…`).width > max) text = text.slice(0, -1);
    return `${text}…`;
  }

  // Tree: boxes from you down, elbow connectors, a badge on each branch (how strongly it fits).
  const TREE_FILL = { you: '#2a9d8f', seed: '#f4a28c', new: '#ffd88a', known: '#e5e5e5' };
  function drawTree(g) {
    grid(g, 1e9, 'transparent', getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#f6f6f6');
    const [w, hh] = BOX.tree, k = view.k, near = nearOf();
    g.strokeStyle = C.text; g.lineWidth = 1.2;
    for (const n of nodes) {
      const p = n.kind === 'seed' ? byKey.get('__you') : n.parent;
      if (!p || n.kind === 'you') continue;
      const [px, py] = toScreen(p), [cx, cy] = toScreen(n);
      const y1 = py + (hh / 2) * k, y2 = cy - (hh / 2) * k, my = (y1 + y2) / 2;
      g.globalAlpha = near && !(near.has(n) && near.has(p)) ? 0.15 : 0.7;
      g.beginPath(); g.moveTo(px, y1); g.lineTo(px, my); g.lineTo(cx, my); g.lineTo(cx, y2); g.stroke();
      // The badge: a new artist's fit, or "♥" for one of yours.
      if (k > 0.45) {
        const good = n.kind === 'new' ? n.score >= 2 : true;
        g.globalAlpha = near && !near.has(n) ? 0.2 : 1;
        g.fillStyle = n.kind === 'known' ? '#9e9e9e' : good ? '#5cb85c' : '#e0524f';
        g.beginPath(); g.arc(cx, my, 11 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = `700 ${8.5 * k}px ${FONT()}`; g.textAlign = 'center';
        g.fillText(n.kind === 'seed' ? '♥' : n.kind === 'known' ? 'LIB' : `${Math.round(Math.min(1, n.score / 4) * 100)}%`, cx, my + 3 * k);
      }
    }
    for (const n of nodes) {
      const [cx, cy] = toScreen(n), x = cx - (w / 2) * k, y = cy - (hh / 2) * k;
      g.globalAlpha = near && !near.has(n) ? 0.25 : 1;
      g.fillStyle = TREE_FILL[n.kind] || '#eee';
      rrect(g, x, y, w * k, hh * k, 4 * k); g.fill();
      g.strokeStyle = n === selected ? C.red : '#222'; g.lineWidth = n === selected ? 2.5 : 1; g.stroke();
      if (k > 0.3) {
        g.fillStyle = n.kind === 'you' ? '#fff' : '#1b1b1b'; g.font = `${n.kind === 'you' || n.kind === 'seed' ? 700 : 400} ${10.5 * k}px ${FONT()}`; g.textAlign = 'center';
        g.fillText(clip(g, n.kind === 'you' ? 'Your taste' : n.name, (w - 10) * k), cx, cy + 3.5 * k);
      }
    }
  }

  function draw(t) {
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    if (style === 'tree') drawTree(g); else drawBrain(g, t);
    g.globalAlpha = 1;
  }
  function loop(t) {
    if (!running) return;
    step(); step();
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  // ---------- Pointer ----------
  const at = (ev) => { const b = canvas.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  function pick(px, py) {
    if (style === 'tree') {
      const [w, hh] = BOX.tree, k = view.k;
      for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i], [x, y] = toScreen(n); if (Math.abs(px - x) <= (w / 2) * k && Math.abs(py - y) <= (hh / 2) * k) return n; }
      return null;
    }
    let best = null, bd = 16;
    for (const n of nodes) { const [x, y] = toScreen(n), d = Math.hypot(x - px, y - py) - R(n); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  // Double-click: grow the map from that artist.
  function pop(n) { if (n && n.kind !== 'you') grow(n); }
  function wire() {
    let pan = null, moved = false;
    canvas.addEventListener('pointerdown', (ev) => {
      const [px, py] = at(ev), n = pick(px, py);
      moved = false;
      canvas.setPointerCapture(ev.pointerId);
      // Brain: an artist can be moved. Tree: the boxes stay put (dragging moves the view).
      if (n && n.kind !== 'you' && style !== 'tree') drag = n; else pan = { px, py, x: view.x, y: view.y };
    });
    canvas.addEventListener('pointermove', (ev) => {
      const [px, py] = at(ev);
      if (drag) { moved = true; drag.x = (px - W / 2) / view.k - view.x; drag.y = (py - H / 2) / view.k - view.y; return; }
      if (pan) { moved = moved || Math.hypot(px - pan.px, py - pan.py) > 3; view.x = pan.x + (px - pan.px) / view.k; view.y = pan.y + (py - pan.py) / view.k; return; }
      const n = pick(px, py);
      if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; canvas.title = n && n.kind !== 'you' ? `${n.name}${n.kind === 'new' ? ` · from ${[...n.from].map((f) => f.name).slice(0, 3).join(', ')}` : ''}` : ''; }
    });
    canvas.addEventListener('pointerup', (ev) => {
      const [px, py] = at(ev), n = pick(px, py);
      if (!moved && n && n.kind !== 'you') select(n);
      else if (!moved && !n) select(null);
      drag = null; pan = null;
    });
    canvas.addEventListener('pointerleave', () => { hover = null; });
    canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); view.k = Math.max(0.25, Math.min(3, view.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))); }, { passive: false });
    canvas.addEventListener('dblclick', (ev) => { const [px, py] = at(ev); pop(pick(px, py)); });
  }
  // A new view: its own layout; the tree starts fitted (or at its top).
  function setStyle(v) {
    style = v;
    try { localStorage.setItem('nabbit.discStyle', v); } catch { /* not kept */ }
    dirty = true;
    view = { x: 0, y: 0, k: 1 };
    if (v === 'tree' && nodes.length) {
      step();
      // Fitted: the whole map when it fits at a readable size; else its top, to drag from.
      const [bw, bh] = BOX[v], xs = nodes.map((n) => n.tx || 0), ys = nodes.map((n) => n.ty || 0);
      const x0 = Math.min(...xs) - bw, x1 = Math.max(...xs) + bw, y0 = Math.min(...ys) - bh, y1 = Math.max(...ys) + bh;
      const top = 130, bottom = 90, side = 40;
      view.k = Math.max(v === 'tree' ? 0.85 : 0.5, Math.min(1, (W - side * 2) / (x1 - x0), (H - top - bottom) / (y1 - y0)));
      const fitsX = (x1 - x0) * view.k <= W - side * 2, fitsY = (y1 - y0) * view.k <= H - top - bottom;
      const you = byKey.get('__you');
      view.x = fitsX ? -(x0 + x1) / 2 : -(you ? you.tx : 0);
      view.y = fitsY ? -(y0 + y1) / 2 + (top - bottom) / 2 / view.k : -(y0 + (H / 2 - top) / view.k);
    }
    if (root) { root.dataset.style = v; for (const b of ui.styles.children) b.classList.toggle('active', b.dataset.v === v); }
  }

  // ---------- Panels ----------
  function paintStatus(text) {
    if (!ui.status) return;
    const fresh = nodes.filter((n) => n.kind === 'new').length;
    ui.status.textContent = text || (building ? `Mapping your taste… ${nodes.filter((n) => n.grown).length} artists read` : fresh ? `${fresh} artists you might like, from ${nodes.filter((n) => n.kind === 'seed').length} of yours · click one · double-click to grow the map from it` : '');
  }
  // You on Last.fm, and the period your top artists are counted over.
  function paintLastfm() {
    if (!ui.lf) return;
    ui.lf.textContent = '';
    if (!lfm || !lfm.on) { ui.lf.append(h('span', { className: 'dc-lfoff', textContent: 'Last.fm: set it up in Settings → Last.fm to map your scrobbles too' })); return; }
    const since = lfm.since ? ` since ${new Date(lfm.since * 1000).getFullYear()}` : '';
    ui.lf.append(h('span', { className: 'dc-lfme', textContent: `Last.fm · ${lfm.user}${lfm.scrobbles ? ` · ${n0(lfm.scrobbles)} scrobbles${since}` : ''}${lfm.artists ? ` · ${n0(lfm.artists)} artists` : ''}` }));
    const seg = h('span', { className: 'tm-seg dc-period', role: 'radiogroup', ariaLabel: 'Top artists over' });
    for (const [v, label] of PERIODS) {
      const b = h('button', { type: 'button', className: 'chip' + (v === period ? ' active' : ''), textContent: label, title: `Your top Last.fm artists over ${label === 'All time' ? 'all time' : `the last ${label.toLowerCase()}`}` });
      b.onclick = () => { if (v === period) return; period = v; try { localStorage.setItem('nabbit.discPeriod', v); } catch { /* not kept */ } built = false; build(); };
      seg.append(b);
    }
    ui.lf.append(seg);
  }
  function paintPicks(picks) {
    if (!ui.picks) return;
    ui.picks.textContent = '';
    if (!picks.length) return;
    ui.picks.append(h('span', { className: 'dc-k', textContent: 'Picks for you' }));
    for (const n of picks) {
      const b = h('button', { type: 'button', className: 'dc-pick', textContent: n.name, title: `From ${[...n.from].map((f) => f.name).join(', ')}` });
      b.onclick = () => { select(n); view.x = -n.x; view.y = -n.y; };
      ui.picks.append(b);
    }
  }
  async function select(n) {
    selected = n;
    if (!n) { ui.panel.classList.add('hidden'); return; }
    paintPanel(n);
    if (!n.info) {
      try { n.info = await window.api.discArtist({ name: n.name, url: n.url || null }); } catch { n.info = null; }
      if (selected === n) paintPanel(n);
    }
  }
  function paintPanel(n) {
    const p = ui.panel;
    p.classList.remove('hidden');
    p.textContent = '';
    const a = n.info || {};
    const why = n.kind === 'seed' ? `In your ${(n.sources || ['Library']).join(' and ')}` : n.kind === 'known' ? 'Already in your library' : `Because you listen to ${[...n.from].map((f) => f.name).slice(0, 4).join(', ')}`;
    const close = h('button', { type: 'button', className: 'lp-txt dim dc-x', textContent: '✕', title: 'Close' });
    close.onclick = () => select(null);
    p.append(h('div', { className: 'dc-head' },
      a.thumbnail || n.thumbnail ? h('img', { className: 'dc-pic', src: a.thumbnail || n.thumbnail, alt: '' }) : h('span', { className: 'dc-pic' }),
      h('div', { className: 'dc-meta' }, h('b', { textContent: a.name || n.name }), h('span', { className: 'ap-s', textContent: a.subs || '' }), h('span', { className: 'dc-why', textContent: why })), close));
    // The numbers: yours and Last.fm's.
    const st = a.stats;
    const bits = [];
    if (st && st.yourPlays) bits.push(`You: ${n0(st.yourPlays)} plays`);
    else if (n.plays) bits.push(`You: ${n0(n.plays)} plays`);
    if (st && st.listeners) bits.push(`${n0(st.listeners)} listeners`);
    if (st && st.plays) bits.push(`${n0(st.plays)} scrobbles`);
    if (n.match && n.kind === 'new') bits.push(`${Math.round(n.match * 100)}% like your artists`);
    if (bits.length) p.append(h('div', { className: 'dc-stats', textContent: bits.join(' · ') }));
    if (st && st.tags && st.tags.length) p.append(h('div', { className: 'dc-tags' }, ...st.tags.map((t) => h('span', { textContent: t }))));
    const songs = a.songs || [];
    const row = h('div', { className: 'dc-acts' });
    if (songs.length) { const b = h('button', { type: 'button', className: 'ghost', textContent: '▶ Top songs' }); b.onclick = () => { const q = songs.map(asItem); window.Player.play(q[0], q, 0); }; row.append(b); }
    if (!n.grown) { const b = h('button', { type: 'button', className: 'ghost', textContent: 'Grow from here' }); b.title = 'Add the artists their fans like to the map'; b.onclick = () => { grow(n); b.remove(); }; row.append(b); }
    if (a.url) { const b = h('button', { type: 'button', className: 'ghost', textContent: 'Artist page' }); b.onclick = () => window.Player.toMusic(() => { if (typeof openArtist === 'function') openArtist(a.url, { title: a.name }); }); row.append(b); }
    p.append(row);
    if (!n.info) { p.append(h('p', { className: 'hm-note', textContent: 'Looking them up…' })); return; }
    const list = h('ol', { className: 'ap-songs dc-songs' });
    songs.forEach((t, i) => {
      const play = () => { const q = songs.map(asItem); window.Player.play(q[i], q, i); };
      const li = h('li', { className: 'ap-song', tabIndex: 0, title: `Play ${t.title}` },
        typeof playButton === 'function' ? playButton(play, `Play ${t.title}`, i + 1, t.url) : h('span', { textContent: String(i + 1) }),
        t.thumbnail ? h('img', { src: t.thumbnail, alt: '', loading: 'lazy' }) : h('span', { className: 'ph' }),
        h('span', { className: 'ap-st' }, h('span', { className: 'ap-t', textContent: t.title }), h('span', { className: 'ap-s', textContent: [t.album, t.year].filter(Boolean).join(' · ') })),
        h('span', { className: 'd', textContent: clock(t.duration) }));
      li.ondblclick = play;
      list.append(li);
    });
    if (songs.length) p.append(list); else p.append(h('p', { className: 'hm-note', textContent: 'No songs listed for them.' }));
  }

  // ---------- Showing / hiding ----------
  function resize() {
    if (!canvas) return;
    const b = root.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, b.width); H = Math.max(1, b.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    makeNeurons();
  }
  const ro = new ResizeObserver(() => resize());
  window.Discovery = {
    show(container) {
      C = colors();
      container.textContent = '';
      root = h('div', { className: 'dc' });
      canvas = h('canvas', { className: 'dc-cv' });
      ctx = canvas.getContext('2d');
      const again = h('button', { type: 'button', className: 'lp-txt dim', textContent: 'Remap', title: 'Read your taste again and start a new map' });
      again.onclick = () => { built = false; build(); };
      const center = h('button', { type: 'button', className: 'lp-txt dim', textContent: 'Centre', title: 'Back to you' });
      center.onclick = () => setStyle(style);
      ui = {
        status: h('span', { className: 'dc-status' }),
        lf: h('div', { className: 'dc-lf' }),
        styles: h('span', { className: 'tm-seg dc-styles', role: 'radiogroup', ariaLabel: 'View' }),
        picks: h('div', { className: 'dc-picks' }),
        panel: h('aside', { className: 'dc-panel hidden' }),
      };
      for (const [v, label, tip] of STYLES) {
        const b = h('button', { type: 'button', className: 'chip' + (v === style ? ' active' : ''), textContent: label, title: tip });
        b.dataset.v = v;
        b.onclick = () => setStyle(v);
        ui.styles.append(b);
      }
      root.dataset.style = style;
      root.append(canvas, h('div', { className: 'dc-top' }, ui.status, h('span', { className: 'lp-sp' }), ui.styles, center, again), ui.lf, ui.picks, ui.panel);
      container.append(root);
      ro.disconnect(); ro.observe(root);
      resize();
      wire();
      setStyle(style);
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
      if (!built) build(); else { rescore(); paintStatus(); paintLastfm(); if (selected) paintPanel(selected); }
    },
    stop() { running = false; cancelAnimationFrame(raf); ro.disconnect(); root = null; },
  };
})();
