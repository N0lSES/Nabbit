// Nabbit, roaming: a flat pixel bunny (floating head, ball hands) hops along the bottom of the window (on top of
// the play bar when it's showing): crouch, spring, land, again, then a rest where he blinks.
// Pick him up and drag him anywhere: he dangles and swings as you move him. Let go and he's thrown
// with the speed you let go at: he tumbles through the air, bounces off the edges of the window and
// the floor, skids to a stop kicking up dust, and if it was a real fall he lies there a moment, then
// gets back up and carries on. While music plays he dances on the beat. Still (standing,
// blinking) when Windows is set to reduce motion. The sprite matches scripts/nabbit-sprite.py.
// His scarf is the accent colour (Settings → Appearance), and so is the logo's: both follow it.
(() => {
  // The accent colour, and a darker shade of it for the scarf's fold.
  function accent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff2a1f';
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = v;
    const hex = c.fillStyle; // normalised to #rrggbb
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [v, v];
    const n = parseInt(m[1], 16), dark = [16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * 0.74).toString(16).padStart(2, '0')).join('');
    return [hex, `#${dark}`];
  }
  // The roaming Nabbit: a floating head (two tall ears, one tipped out, big hollow ring eyes) over a
  // small body with stubby legs, no arms, and a ball for each hand floating at his sides. Flat: a paper
  // white fill and a line in his colour (the accent, or his own). A 40 × 40 box, ×2 on screen.
  const SIZE = 40, SCALE = 2;
  let COL = null; // { fill, line, mono } as [r, g, b]
  // His colours from one: the line is the colour itself, darkened when it's too pale to show against
  // the white fill; mono is the colour as it is (the logo).
  function colours(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mono = [r, g, b].map((v) => Math.round(v * 255));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const line = lum > 0.62 ? mono.map((v) => Math.round(v * (0.62 / lum) * 0.8)) : mono;
    return { fill: PAPER, line, mono };
  }
  // One drawing of him, smooth: the shapes in units of a 40 × 40 box (feet on its bottom edge), drawn
  // at px pixels a unit. hd: the head this many units lower (a bob) or higher; hy: the hands (hyL the
  // left one more); by: the body; legs: apart or together; headOnly: just the head (the logo, icons).
  // Layers: the outline (each shape grown by its width, so overlaps join up), the flat fill cut to the
  // shape, the ring eyes; then the whole picture is pixelated (below). mono: line art in one colour,
  // his outline and eyes (the logo). → a small canvas, one pixel per PIX units.
  // His eyes (uneven: the right one a pixel higher), placed so each ring is centred on a pixel corner
  // once he's shrunk towards his feet and pixelated: round rings, no stray pixels.
  const eyesAt = (hc) => [[16.67, hc + 1.89], [25.56, hc + 0.78]];
  const PAPER = [244, 241, 234]; // his fill: flat, no gradient
  const OW = 1.15, PIX = 1; // the outline's width and the size of his pixels, in units
  function art({ hd = 0, hy = 0, hyL = 0, by = 0, legs = 'apart', blink = false, headOnly = false, mono = false, hollow = false, pix = PIX } = {}, px = 4, col = COL, wear = null) {
    const N = 40, S = Math.round(N * px);
    const hc = 15.6 + hd, bc = 31.3 + by, lx = legs === 'apart' ? 2.5 : 1.5;
    // Shrunk a little towards his feet, so the ears have room above him when he jumps.
    const k = 0.9, oy = 39 - 38.6 * k; // y → oy + y * k; x about the middle
    const parts = [
      ['ell', 20, hc, 10.6, 6.9],
      ['cap', 15.6, hc - 4.2, 10.8, hc - 11.6, 2.5], // the left ear, tipped out
      ['cap', 23.6, hc - 4.2, 24.5, hc - 12.2, 2.5], // the right, upright
    ];
    if (!headOnly) parts.push(
      ['ell', 20, bc - 0.9, 4.3, 4.2],
      ['cap', 20 - lx, bc + 1.2, 20 - lx, bc + 5.6, 1.75], ['cap', 20 + lx, bc + 1.2, 20 + lx, bc + 5.6, 1.75],
      ['cir', 11.4, bc - 0.4 + hy + hyL, 2.1], ['cir', 28.6, bc - 0.4 + hy, 2.1], // the hands, floating: no arms
    );
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.setTransform(px * k, 0, 0, px * k, (20 - 20 * k) * px, oy * px); return [c, g]; };
    const shape = (g, grow) => {
      for (const p of parts) {
        g.beginPath();
        if (p[0] === 'ell') { g.ellipse(p[1], p[2], p[3] + grow, p[4] + grow, 0, 0, Math.PI * 2); g.fill(); }
        else if (p[0] === 'cir') { g.arc(p[1], p[2], p[3] + grow, 0, Math.PI * 2); g.fill(); }
        else { g.lineCap = 'round'; g.lineWidth = 2 * (p[5] + grow); g.moveTo(p[1], p[2]); g.lineTo(p[3], p[4]); g.stroke(); }
      }
    };
    const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const [out, g] = mk();
    // The post-process: the finished drawing averaged down into square pixels (PIX units each), each
    // pixel either solid or empty, so he comes out as real pixel art (shown with pixelated scaling).
    const pixelate = (cut = 100) => {
      const n = Math.round(N / pix), o = document.createElement('canvas');
      o.width = o.height = n;
      const og = o.getContext('2d');
      og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
      og.drawImage(out, 0, 0, n, n);
      const d = og.getImageData(0, 0, n, n), a = d.data;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] < cut) { a[i + 3] = 0; continue; }
        a[i + 3] = 255; // solid (the colour read back is already its own)
      }
      og.putImageData(d, 0, 0);
      return o;
    };
    if (mono) {
      // Line art in one colour, drawn pixel by pixel: his shape as pixels, a one-pixel line round it
      // (every empty pixel touching it), and a round one-pixel ring for each eye.
      g.fillStyle = g.strokeStyle = '#000';
      shape(g, 0);
      const n = Math.round(N / PIX), sm = document.createElement('canvas');
      sm.width = sm.height = n;
      const sg = sm.getContext('2d');
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(out, 0, 0, n, n);
      const src = sg.getImageData(0, 0, n, n).data, inside = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) inside[i] = src[i * 4 + 3] >= 128 ? 1 : 0;
      const img = sg.createImageData(n, n), d = img.data, [cr, cg, cb] = col.mono;
      const put = (x, y) => { const i = (y * n + x) * 4; d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255; };
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (inside[y * n + x]) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < n && Y < n && inside[Y * n + X]) { edge = true; break; } }
        if (edge) put(x, y);
      }
      // The eyes, where they land on the pixel grid (the drawing is shrunk by k towards his feet).
      const u = (v) => v / PIX;
      // Where his eyes are on him (uneven: the right one a little higher), the right one at least a pixel up.
      const at = eyesAt(hc).map(([ex, ey]) => [Math.floor(u(20 - 20 * k + ex * k)) + 0.5, Math.floor(u(oy + ey * k)) + 0.5]);
      if (at[1][1] >= at[0][1]) at[1][1] = at[0][1] - 1;
      for (const [X, Y] of at) {
        const R = 2.25; // centred on a pixel: round
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dd = Math.hypot(x + 0.5 - X, y + 0.5 - Y); if (Math.abs(dd - R) < 0.6 && inside[y * n + x]) put(x, y); }
      }
      sg.putImageData(img, 0, 0);
      return sm;
    }
    const W = wear && !headOnly ? clothes(wear, hc, bc, hy, hyL) : { back: [], front: [] };
    // What he wears behind him (a cape), outlined in his line like he is.
    for (const it of W.back) outlineOf(g, it, rgb(col.line));
    // The outline.
    g.fillStyle = g.strokeStyle = rgb(col.line);
    shape(g, OW);
    if (hollow) {
      // No fill (the logo): his outline and eyes, drawn and pixelated just as on him.
      g.globalCompositeOperation = 'destination-out'; shape(g, 0); g.globalCompositeOperation = 'source-over';
      g.strokeStyle = rgb(col.line); g.lineWidth = 1.05;
      for (const [ex, ey] of eyesAt(hc)) { g.beginPath(); g.arc(ex, ey, 2.65, 0, Math.PI * 2); g.stroke(); }
      return pixelate();
    }
    for (const it of W.back) fillOf(g, it);
    // The fill: flat paper white (col.fill), cut to his shape.
    const [fc, f] = mk();
    f.fillStyle = rgb(col.fill || PAPER); f.fillRect(-10, -10, 60, 60);
    const [mc, m] = mk(); // his shape, as one mask
    m.fillStyle = m.strokeStyle = '#000';
    shape(m, 0);
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(mc, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(fc, 0, 0);
    g.setTransform(px * k, 0, 0, px * k, (20 - 20 * k) * px, oy * px);
    // The eyes: rings (a line when blinking).
    g.strokeStyle = rgb(col.line); g.lineWidth = 1.05; g.lineCap = 'round';
    for (const [ex, ey] of eyesAt(hc)) {
      g.beginPath();
      if (blink) { g.moveTo(ex - 2.4, ey); g.lineTo(ex + 2.4, ey); } else g.arc(ex, ey, 2.65, 0, Math.PI * 2);
      g.stroke();
    }
    // What he wears in front: an outfit (kept to his body), then the neck, the glasses and the hat.
    for (const it of W.front) {
      if (it.clip) { g.save(); g.beginPath(); g.ellipse(20, bc - 0.9, 4.3, 4.2, 0, 0, Math.PI * 2); g.rect(20 - 6, bc + 0.4, 12, 8); g.clip(); fillOf(g, it); g.restore(); continue; }
      if (it.outline) outlineOf(g, it, rgb(col.line));
      fillOf(g, it);
    }
    return pixelate();
  }
  // ---------- Clothes ----------
  // Each piece: { path (Path2D, in the drawing's units), fill, edge?, outline? (his line round it, for
  // what sticks out past him), clip? (kept to his body) }. c: the clothes colour [r, g, b].
  const DARK = '#1b1820', GOLD = '#ffcc33', GOLD_D = '#c98d12';
  const ITEMS = {
    hat: [['', 'None'], ['beanie', 'Beanie'], ['cap', 'Cap'], ['tophat', 'Top hat'], ['crown', 'Crown'], ['party', 'Party hat'], ['bow', 'Bow'], ['flower', 'Flower'], ['phones', 'Headphones']],
    eyes: [['', 'None'], ['shades', 'Shades'], ['hearts', 'Heart glasses'], ['visor', 'Visor'], ['monocle', 'Monocle']],
    neck: [['', 'None'], ['scarf', 'Scarf'], ['bowtie', 'Bow tie'], ['chain', 'Chain'], ['bell', 'Bell collar']],
    body: [['', 'None'], ['shirt', 'T-shirt'], ['overalls', 'Overalls'], ['cape', 'Cape'], ['hoodie', 'Hoodie']],
  };
  const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const shade = (c, t) => hex(c.map((v) => (t < 0 ? v * (1 + t) : v + (255 - v) * t)));
  function outlineOf(g, it, line) {
    g.save(); g.strokeStyle = line; g.fillStyle = line; g.lineJoin = 'round'; g.lineCap = 'round';
    g.lineWidth = 2 * OW + (it.stroke || 0); g.stroke(it.path); g.fill(it.path); g.restore();
  }
  function fillOf(g, it) {
    g.save();
    if (it.stroke) { g.strokeStyle = it.fill; g.lineWidth = it.stroke; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(it.path); }
    else { g.fillStyle = it.fill; g.fill(it.path); }
    if (it.edge) { g.strokeStyle = it.edge; g.lineWidth = 0.55; g.lineJoin = 'round'; g.stroke(it.path); }
    g.restore();
  }
  function clothes(w, hc, bc, hy, hyL) {
    const c = w.clothRgb, C = hex(c), Cd = shade(c, -0.35), Cl = shade(c, 0.3);
    const back = [], front = [];
    const P = (fn) => { const p = new Path2D(); fn(p); return p; };
    const top = hc - 6.6; // the top of his head
    const nb = bc - 5.1; // the top of his body (his neck)
    // ---- outfit ----
    if (w.body === 'cape') back.push({ path: P((p) => { p.moveTo(16.2, nb + 0.6); p.lineTo(23.8, nb + 0.6); p.quadraticCurveTo(27.5, bc + 2, 26.8, bc + 4.6); p.quadraticCurveTo(20, bc + 6, 13.2, bc + 4.6); p.quadraticCurveTo(12.5, bc + 2, 16.2, nb + 0.6); }), fill: C, edge: Cd, outline: true });
    if (w.body === 'shirt' || w.body === 'hoodie') front.push({ path: P((p) => p.rect(14, nb - 1, 12, bc + 0.5 - nb + 1)), fill: C, clip: true });
    if (w.body === 'hoodie') {
      front.push({ path: P((p) => { p.moveTo(17.4, nb + 0.4); p.quadraticCurveTo(20, nb + 2.6, 22.6, nb + 0.4); }), fill: Cd, stroke: 0.7 });
      front.push({ path: P((p) => p.rect(17.6, bc - 1.6, 4.8, 1.9)), fill: Cd, clip: true }); // the pocket
    }
    if (w.body === 'overalls') {
      front.push({ path: P((p) => p.rect(14, bc - 2.2, 12, 9)), fill: C, clip: true });
      front.push({ path: P((p) => { p.moveTo(17.4, bc - 2); p.lineTo(17.2, nb + 0.2); p.moveTo(22.6, bc - 2); p.lineTo(22.8, nb + 0.2); }), fill: C, stroke: 1 });
      front.push({ path: P((p) => { p.arc(17.4, bc - 1.6, 0.55, 0, 7); p.moveTo(23.15, bc - 1.6); p.arc(22.6, bc - 1.6, 0.55, 0, 7); }), fill: GOLD });
    }
    // ---- neck ----
    if (w.neck === 'scarf') {
      front.push({ path: P((p) => { p.roundRect(14.8, nb - 0.7, 10.4, 2.4, 1.1); }), fill: C, edge: Cd, outline: true });
      front.push({ path: P((p) => { p.roundRect(15.6, nb + 0.6, 2.2, 4.4, 0.8); }), fill: Cl, edge: Cd, outline: true });
    }
    if (w.neck === 'bowtie') front.push({ path: P((p) => { const y = nb + 0.9; p.moveTo(20, y); p.lineTo(16.8, y - 1.7); p.lineTo(16.8, y + 1.7); p.closePath(); p.moveTo(20, y); p.lineTo(23.2, y - 1.7); p.lineTo(23.2, y + 1.7); p.closePath(); p.moveTo(20.9, y); p.arc(20, y, 0.9, 0, 7); }), fill: C, edge: Cd });
    if (w.neck === 'chain') {
      front.push({ path: P((p) => { p.moveTo(16.4, nb + 0.4); p.quadraticCurveTo(20, nb + 4.2, 23.6, nb + 0.4); }), fill: GOLD, stroke: 0.75 });
      front.push({ path: P((p) => p.arc(20, nb + 2.9, 1.15, 0, 7)), fill: GOLD, edge: GOLD_D });
    }
    if (w.neck === 'bell') {
      front.push({ path: P((p) => p.roundRect(15.4, nb - 0.2, 9.2, 1.5, 0.7)), fill: C, edge: Cd });
      front.push({ path: P((p) => { p.moveTo(18.6, nb + 3.1); p.quadraticCurveTo(18.6, nb + 0.8, 20, nb + 0.8); p.quadraticCurveTo(21.4, nb + 0.8, 21.4, nb + 3.1); p.closePath(); }), fill: GOLD, edge: GOLD_D });
    }
    // ---- glasses ----
    const E = eyesAt(hc);
    if (w.eyes === 'shades') {
      front.push({ path: P((p) => { for (const [x, y] of E) p.roundRect(x - 3.3, y - 2.2, 6.6, 4.2, 1.6); }), fill: DARK, outline: true });
      front.push({ path: P((p) => { p.moveTo(20.4, hc + 0.9); p.lineTo(22.6, hc + 0.5); }), fill: DARK, stroke: 0.9 });
      front.push({ path: P((p) => { for (const [x, y] of E) { p.moveTo(x - 2.2, y - 0.8); p.lineTo(x - 0.8, y - 1.6); } }), fill: 'rgba(255,255,255,.55)', stroke: 0.6 });
    }
    if (w.eyes === 'hearts') {
      const heart = (p, x, y, r) => { p.moveTo(x, y + r * 1.05); p.bezierCurveTo(x - r * 1.9, y - r * 0.1, x - r * 1.1, y - r * 1.6, x, y - r * 0.55); p.bezierCurveTo(x + r * 1.1, y - r * 1.6, x + r * 1.9, y - r * 0.1, x, y + r * 1.05); p.closePath(); };
      front.push({ path: P((p) => { for (const [x, y] of E) heart(p, x, y + 0.2, 2.3); }), fill: C, edge: Cd, outline: true });
      front.push({ path: P((p) => { p.moveTo(20.2, hc + 1); p.lineTo(22.8, hc + 0.6); }), fill: Cd, stroke: 0.8 });
    }
    if (w.eyes === 'visor') {
      front.push({ path: P((p) => p.roundRect(12.4, hc - 0.6, 17.4, 3.6, 1.6)), fill: C, edge: Cd, outline: true });
      front.push({ path: P((p) => { p.moveTo(14.2, hc + 0.3); p.lineTo(27.8, hc + 0.3); }), fill: 'rgba(255,255,255,.5)', stroke: 0.6 });
    }
    if (w.eyes === 'monocle') {
      front.push({ path: P((p) => p.arc(E[1][0], E[1][1], 3.1, 0, 7)), fill: GOLD, stroke: 0.8 });
      front.push({ path: P((p) => { p.moveTo(E[1][0] + 1.6, E[1][1] + 2.7); p.quadraticCurveTo(E[1][0] + 2.6, hc + 6.5, E[1][0] + 0.6, hc + 7.6); }), fill: GOLD, stroke: 0.45 });
    }
    // ---- hats ----
    if (w.hat === 'beanie') {
      front.push({ path: P((p) => { p.ellipse(20, top + 3, 8.2, 5.2, 0, Math.PI, 0); p.closePath(); }), fill: C, outline: true });
      front.push({ path: P((p) => p.roundRect(11.6, top + 1.6, 16.8, 2.6, 1.1)), fill: Cd, outline: true });
      front.push({ path: P((p) => p.arc(20, top - 2.6, 1.6, 0, 7)), fill: Cl, outline: true });
    }
    if (w.hat === 'cap') {
      front.push({ path: P((p) => { p.ellipse(20, top + 3.2, 7.6, 5, 0, Math.PI, 0); p.closePath(); }), fill: C, outline: true });
      front.push({ path: P((p) => p.ellipse(28.4, top + 3, 5.2, 1.2, -0.08, 0, Math.PI * 2)), fill: Cd, outline: true });
      front.push({ path: P((p) => p.arc(20, top - 1.8, 0.8, 0, 7)), fill: Cd });
    }
    if (w.hat === 'tophat') {
      front.push({ path: P((p) => p.rect(16.6, top - 6.4, 6.6, 7.8)), fill: DARK, outline: true });
      front.push({ path: P((p) => p.ellipse(19.9, top + 1.4, 5.8, 1.3, 0, 0, Math.PI * 2)), fill: DARK, outline: true });
      front.push({ path: P((p) => p.rect(16.6, top - 0.4, 6.6, 1.3)), fill: C });
    }
    if (w.hat === 'crown') front.push({ path: P((p) => { const y = top + 1.6; p.moveTo(15.6, y); p.lineTo(15.4, y - 4.4); p.lineTo(17.6, y - 2.4); p.lineTo(19.9, y - 5.4); p.lineTo(22.2, y - 2.4); p.lineTo(24.4, y - 4.4); p.lineTo(24.2, y); p.closePath(); }), fill: GOLD, edge: GOLD_D, outline: true });
    if (w.hat === 'crown') front.push({ path: P((p) => p.arc(19.9, top + 0.2, 0.75, 0, 7)), fill: C });
    if (w.hat === 'party') {
      front.push({ path: P((p) => { p.moveTo(16.8, top + 1.8); p.lineTo(23, top + 1.8); p.lineTo(20.4, top - 6.8); p.closePath(); }), fill: C, edge: Cd, outline: true });
      front.push({ path: P((p) => { p.moveTo(18, top - 0.8); p.lineTo(22.3, top - 1.6); p.moveTo(19, top - 3.8); p.lineTo(21.6, top - 4.3); }), fill: Cl, stroke: 0.8 });
      front.push({ path: P((p) => p.arc(20.4, top - 7, 1.2, 0, 7)), fill: GOLD, outline: true });
    }
    if (w.hat === 'bow') {
      const x = 13.4, y = hc - 8.6;
      front.push({ path: P((p) => { p.moveTo(x, y); p.lineTo(x - 3.6, y - 2.2); p.lineTo(x - 3.4, y + 2); p.closePath(); p.moveTo(x, y); p.lineTo(x + 3.4, y - 2.6); p.lineTo(x + 3.6, y + 1.6); p.closePath(); }), fill: C, edge: Cd, outline: true });
      front.push({ path: P((p) => p.arc(x, y, 1.05, 0, 7)), fill: Cd });
    }
    if (w.hat === 'flower') {
      const x = 26.4, y = hc - 6.2;
      front.push({ path: P((p) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; p.moveTo(x + Math.cos(a) * 1.7 + 1.25, y + Math.sin(a) * 1.7); p.arc(x + Math.cos(a) * 1.7, y + Math.sin(a) * 1.7, 1.25, 0, 7); } }), fill: C, edge: Cd, outline: true });
      front.push({ path: P((p) => p.arc(x, y, 1.05, 0, 7)), fill: GOLD });
    }
    if (w.hat === 'phones') {
      front.push({ path: P((p) => { p.moveTo(9.9, hc - 0.5); p.bezierCurveTo(9.6, top - 5.4, 30.4, top - 5.4, 30.1, hc - 0.5); }), fill: DARK, stroke: 1.3 });
      front.push({ path: P((p) => { p.roundRect(7.4, hc - 2.6, 3.6, 5.6, 1.5); p.roundRect(29, hc - 2.6, 3.6, 5.6, 1.5); }), fill: C, edge: Cd, outline: true });
    }
    return { back, front };
  }
  // The outline of a drawing as points (display pixels from its middle): the corners of its solid edge
  // pixels' hull, so the floor, the walls and the top meet him and not his box.
  function hullOf(c, scale) {
    const S = c.width, a = c.getContext('2d').getImageData(0, 0, S, S).data, pts = [];
    for (let y = 0; y < S; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < S; x++) if (a[(y * S + x) * 4 + 3] > 110) { if (l < 0) l = x; r = x; }
      if (l >= 0) pts.push([l, y], [r + 1, y], [l, y + 1], [r + 1, y + 1]);
    }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const lo = [], hi = [];
    for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    return [...lo.slice(0, -1), ...hi.slice(0, -1)].map(([x, y]) => [(x - S / 2) * scale, (y - S / 2) * scale]);
  }
  // ---------- His look (Settings → Nabbit), kept ----------
  // colour: '' follows the accent, else #rrggbb; cloth: the clothes colour; hat, eyes, neck, body: what he wears.
  const LOOK0 = { colour: '', cloth: '#2b2a3a', hat: '', eyes: '', neck: '', body: '' };
  let look = { ...LOOK0 };
  try { look = { ...LOOK0, ...JSON.parse(localStorage.getItem('nabbit.look') || '{}') }; } catch { /* the default */ }
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  const rgbOf = (v) => { const n = parseInt(v.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const wearing = () => ({ ...look, clothRgb: rgbOf(isHex(look.cloth) ? look.cloth : LOOK0.cloth) });
  function frame(o) {
    const c = art(o, 4, COL, wearing());
    return { url: c.toDataURL(), hull: hullOf(c, (SIZE * SCALE) / c.width) };
  }
  // The art for anything else (the icon files: scripts/nabbit-icons.html draws them with this).
  window.NabbitArt = { draw: (o, px, hex) => { const c = colours(hex || '#ff2a1f'); return art(o, px, o && o.oneColour ? { ...c, line: c.mono } : c); }, logo: (size, hex) => logo(size, colours(hex || '#ff2a1f')), colours };
  let F = {};
  // The logo (titlebar, sidebar): his head as he is, without the fill (his outline and eyes), in the accent colour.
  const logos = [...document.querySelectorAll('img[src$="assets/icon.png"]')];
  // Drawn for the size it's shown at (device pixels), so each of its pixels is one on the screen: as
  // fine as the screen allows, nothing stretched. → a canvas size × size.
  function logo(size, ac = colours(accent()[0])) {
    const col = { ...ac, line: ac.mono }; // one colour: the accent
    const draw = (pix) => {
      const c = art({ headOnly: true, hollow: true, pix }, 4, col);
      const h = hullOf(c, 1), xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
      return { c, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    // About 23 units across his head and ears: the pixel size that fills the square (less a pixel each side).
    let pix = 23.5 / Math.max(4, size - 2), r = draw(pix);
    const over = Math.max(r.x1 - r.x0, r.y1 - r.y0) / Math.max(4, size - 2);
    if (over > 1) { pix *= over; r = draw(pix); }
    const o = document.createElement('canvas');
    o.width = o.height = size;
    const w = r.x1 - r.x0, hgt = r.y1 - r.y0;
    o.getContext('2d').drawImage(r.c, Math.round(r.c.width / 2 + r.x0), Math.round(r.c.height / 2 + r.y0), Math.ceil(w), Math.ceil(hgt), Math.round((size - w) / 2), Math.round((size - hgt) / 2), Math.ceil(w), Math.ceil(hgt));
    return o;
  }
  function paintLogos() {
    const dpr = window.devicePixelRatio || 1;
    for (const img of logos) {
      const css = img.clientWidth || parseFloat(getComputedStyle(img).width) || 16;
      img.src = logo(Math.max(8, Math.round(css * dpr))).toDataURL();
    }
  }
  // Moved to another screen or zoomed: drawn again for the new pixel size.
  let dprWas = window.devicePixelRatio;
  addEventListener('resize', () => { if (window.devicePixelRatio !== dprWas) { dprWas = window.devicePixelRatio; paintLogos(); } });
  let painted = '';
  function paint() {
    const [a] = accent();
    const key = `${a}|${JSON.stringify(look)}`;
    if (key === painted) return;
    painted = key;
    COL = colours(isHex(look.colour) ? look.colour : a);
    F = {
      stand: frame(), blink: frame({ blink: true }),
      crouch: frame({ hd: 2, hy: 1.2, by: 0.5, legs: 'together' }), // squashed, ready to spring
      air: frame({ hd: -1, hy: -2, legs: 'together' }), // head and hands trailing up
      nod: frame({ hd: 2.4, hy: 0.8 }), nodBlink: frame({ hd: 2.4, hy: 0.8, blink: true }), // the head bob
      step: frame({ hd: 2.4, hy: 0.8, hyL: -1.8, legs: 'together' }),
    };
    el.style.filter = ''; // flat: no glow
    lastFrame = '';
    paintLogos();
    preview();
    clearTimeout(discordTimer);
    discordTimer = setTimeout(() => toDiscord(isHex(look.colour) ? look.colour : a), 800);
  }
  // Him as he looks, for Discord (Settings → Discord): 512 px, on a dark square. main.js keeps it.
  let discordTimer = null;
  function toDiscord(colour) {
    if (!window.api || !window.api.discordLook) return;
    const c = art({}, 4, COL, wearing());
    const out = document.createElement('canvas');
    out.width = out.height = 512;
    const g = out.getContext('2d');
    g.fillStyle = '#141218';
    g.fillRect(0, 0, 512, 512);
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 26, 26, 460, 460);
    window.api.discordLook({ png: out.toDataURL('image/png'), colour });
  }
  // ---------- Settings → Nabbit ----------
  const PALETTE = [['#ff2a1f', 'Red'], ['#ff7a1a', 'Orange'], ['#ffc21a', 'Amber'], ['#2ee66b', 'Green'], ['#1ad9c4', 'Teal'], ['#3d8bff', 'Blue'], ['#9b5cff', 'Violet'], ['#ff3fa4', 'Pink']];
  const CLOTH = [['#2b2a3a', 'Charcoal'], ['#f4f1ea', 'White'], ...PALETTE];
  const $id = (i) => document.getElementById(i);
  function setLook(o) {
    look = { ...look, ...o };
    try { localStorage.setItem('nabbit.look', JSON.stringify(look)); } catch { /* not kept */ }
    paint();
    syncUi();
  }
  function preview() {
    const cv = $id('nb-preview');
    if (!cv || !COL) return;
    const c = art({ blink: false }, 4, COL, wearing());
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false; // his pixels, sharp
    g.drawImage(c, 0, 0, cv.width, cv.height);
  }
  function swatches(box, list, cur, pick, auto) {
    box.textContent = '';
    const add = (val, name, cls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `st-sw${cls ? ` ${cls}` : ''}`; b.title = name;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-label', name);
      if (val) b.style.setProperty('--sw', val);
      b.dataset.v = val;
      b.addEventListener('click', () => pick(val));
      box.append(b);
    };
    if (auto) add('', 'The accent colour', 'nb-sw-auto');
    for (const [v, n] of list) add(v, n);
  }
  function syncUi() {
    if (!$id('st-nabbit')) return;
    const mark = (box, v) => { for (const b of $id(box).children) { const on = b.dataset.v === (v || ''); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } };
    mark('nb-colours', isHex(look.colour) ? look.colour.toLowerCase() : '');
    mark('nb-cloth-colours', (look.cloth || '').toLowerCase());
    if (document.activeElement !== $id('nb-colour')) $id('nb-colour').value = isHex(look.colour) ? look.colour : accent()[0];
    if (document.activeElement !== $id('nb-cloth')) $id('nb-cloth').value = isHex(look.cloth) ? look.cloth : LOOK0.cloth;
    for (const k of ['hat', 'eyes', 'neck', 'body']) $id(`nb-${k}`).value = look[k] || '';
  }
  if ($id('st-nabbit')) {
    swatches($id('nb-colours'), PALETTE, look.colour, (v) => setLook({ colour: v }), true);
    swatches($id('nb-cloth-colours'), CLOTH, look.cloth, (v) => setLook({ cloth: v }));
    $id('nb-colour').addEventListener('input', (e) => setLook({ colour: e.target.value }));
    $id('nb-cloth').addEventListener('input', (e) => setLook({ cloth: e.target.value }));
    for (const k of ['hat', 'eyes', 'neck', 'body']) {
      const sel = $id(`nb-${k}`);
      for (const [v, n] of ITEMS[k]) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.append(o); }
      sel.addEventListener('change', () => setLook({ [k]: sel.value }));
    }
    const any = (list) => list[Math.floor(Math.random() * list.length)][0];
    $id('nb-random').addEventListener('click', () => setLook({
      colour: Math.random() < 0.25 ? '' : any(PALETTE), cloth: any(CLOTH),
      hat: any(ITEMS.hat), eyes: Math.random() < 0.5 ? '' : any(ITEMS.eyes), neck: Math.random() < 0.4 ? '' : any(ITEMS.neck), body: Math.random() < 0.4 ? '' : any(ITEMS.body),
    }));
    $id('nb-reset').addEventListener('click', () => setLook({ ...LOOK0 }));
  }
  window.NabbitPet = { get look() { return { ...look }; }, setLook };
  // Settings → Appearance sets the accent on the page's root (and the theme can change it).
  new MutationObserver(() => paint()).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
  new MutationObserver(() => paint()).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });

  const el = document.createElement('div');
  el.id = 'nabbit-pet';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: '0', top: '0', width: `${SIZE * SCALE}px`, height: `${SIZE * SCALE}px`, zIndex: '60', // over the play bar (50), under dialogs
    cursor: 'grab', touchAction: 'none', transformOrigin: '50% 50%', // he turns about his middle
    backgroundSize: '100% 100%', imageRendering: 'pixelated', willChange: 'transform',
  });
  document.body.append(el);

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let x = Math.random() * (innerWidth - 100) + 20, face = 1, target = x, state = 'idle', until = 0, lastFrame = '';
  paint();
  syncUi();
  const show = (k) => { if (k !== lastFrame) { el.style.backgroundImage = `url(${F[k].url})`; lastFrame = k; } };
  // Where he stands: the top of the play bar when it's showing, else the bottom of the window.
  function ground() {
    const bar = document.getElementById('lp-bar');
    if (bar && !bar.classList.contains('hidden')) { const b = bar.getBoundingClientRect(); if (b.height > 0) return b.top; }
    return innerHeight;
  }
  // Off somewhere (mostly a short way, sometimes across the window), or a rest.
  function next(now) {
    if (state === 'go' || calm.matches) {
      state = 'idle';
      until = now + 1200 + Math.random() * 4000;
      return;
    }
    state = 'go';
    const w = innerWidth - SIZE * SCALE - 16;
    const span = Math.random() < 0.25 ? w : 90 + Math.random() * 240;
    target = Math.max(8, Math.min(w, x + (Math.random() < 0.5 ? -1 : 1) * span));
    face = target < x ? -1 : 1;
    hopStart(now);
  }
  // One hop: crouch, a jump forward in an arc, land (a crouch again), then the next.
  const CROUCH = 110, AIR = 380, LAND = 120;
  let hop = null;
  function hopStart(now) {
    const left = target - x;
    const len = Math.sign(left) * Math.min(Math.abs(left), 34 + Math.random() * 24);
    hop = { t0: now, from: x, len, high: 14 + Math.random() * 10 };
  }
  // ---------- The beat ----------
  // While music plays he dances: a head bob on every beat, a sway across two, a step on the
  // off-bars and a little hop to turn round every other bar. The beat comes from the song's grid
  // (yours, or the DJ analysis if it's done) when there is one, else it's followed live from the
  // kick drum: hits every 10 ms over the last 8 s, the tempo (60–200 BPM) where they repeat best,
  // and where the beats fall in it.
  const BIN = 10, NB = 800;
  const env = new Float32Array(NB);
  let envAt = 0, fluxAvg = 0, live = null, nextFit = 0, hearing = 0;
  // The tempo is settled once per song: the first readings (one a second) vote, and once five of six
  // agree it's locked for the whole song. After that each reading only nudges where the beats fall (a
  // quarter of the way each time), and one at half or double the tempo counts as agreeing. Quiet parts
  // keep the locked grid going. Only a new tempo that holds for 15 readings in a row (a real change in
  // the song) unlocks it; a new song, or 4 s of silence, starts over.
  const lock = { song: '', period: 0, votes: [], strikes: 0, alt: [] };
  function resetLock(song) { lock.song = song; lock.period = 0; lock.votes = []; lock.strikes = 0; lock.alt = []; live = null; }
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  function listen(now) {
    const fx = window.PlayerFx;
    const f = fx && fx.pulse ? fx.pulse() : null;
    const song = (window.Player && window.Player.songId) || '';
    if (song !== lock.song) resetLock(song);
    if (f == null) { if (lock.period && hearing && now - hearing > 4000) resetLock(song); return; }
    hearing = now;
    const bin = Math.floor(now / BIN);
    if (!envAt || bin - envAt > NB) { env.fill(0); envAt = bin; }
    while (envAt < bin) { envAt++; env[envAt % NB] = 0; }
    fluxAvg += (f - fluxAvg) * 0.02;
    env[bin % NB] = Math.max(env[bin % NB], Math.max(0, f - fluxAvg * 1.2));
    if (now > nextFit) { nextFit = now + 1000; fit(bin); }
  }
  function fit(bin) {
    const n = NB, e = new Float32Array(n);
    for (let i = 0; i < n; i++) e[i] = env[(bin - n + 1 + i + NB * 2) % NB];
    let e0 = 0; for (let i = 0; i < n; i++) e0 += e[i] * e[i];
    if (e0 < 1e-6) { if (!lock.period) live = null; return; }
    // The tempo: where the hits line up with themselves a beat later, leaning towards ~120 BPM.
    let best = 0, bestL = 0;
    const score = new Float32Array(101);
    for (let L = 30; L <= 100; L++) {
      let a = 0; for (let i = L; i < n; i++) a += e[i] * e[i - L];
      a /= (n - L);
      const w = Math.exp(-0.5 * (Math.log2((6000 / L) / 120) / 0.9) ** 2);
      score[L] = a;
      if (a * w > best) { best = a * w; bestL = L; }
    }
    if (!bestL || score[bestL] / (e0 / n) < 0.12) { if (!lock.period) live = null; return; }
    let L = bestL;
    if (bestL > 30 && bestL < 100) { const y0 = score[bestL - 1], y1 = score[bestL], y2 = score[bestL + 1], d = y0 - 2 * y1 + y2; if (d < 0) L = bestL + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)); }
    let period = L * BIN;
    if (lock.period) {
      const m = [0.5, 1, 2].reduce((a, k) => (Math.abs(Math.log((period * k) / lock.period)) < Math.abs(Math.log((period * a) / lock.period)) ? k : a), 1);
      if (Math.abs(period * m - lock.period) / lock.period <= 0.04) { lock.strikes = 0; lock.alt = []; period = lock.period; }
      else {
        lock.strikes++; lock.alt.push(period);
        if (lock.strikes < 15) period = lock.period; // a passing disagreement: the grid holds
        else { const alt = median(lock.alt); resetLock(lock.song); lock.period = alt; period = alt; }
      }
    } else {
      lock.votes.push(period);
      if (lock.votes.length > 10) lock.votes.shift();
      if (lock.votes.length >= 6) {
        const m = median(lock.votes);
        if (lock.votes.filter((v) => Math.abs(v - m) / m <= 0.03).length >= 5) { lock.period = m; period = m; }
      }
    }
    // Where the beats fall at this tempo: the phase that lands on the most (and the latest) hits.
    const Lp = period / BIN;
    let bp = 0, bph = 0;
    for (let ph = 0; ph < Math.ceil(Lp); ph++) {
      let a = 0;
      for (let k = 0; ; k++) { const i = Math.round(n - 1 - ph - k * Lp); if (i < 0) break; a += e[i] * (1 + (k < 8 ? 1 : 0)); }
      if (a > bp) { bp = a; bph = ph; }
    }
    const lastBeat = (bin - bph) * BIN;
    if (live && Math.abs(live.period - period) / period < 0.001) {
      // Same tempo: the beats nudged a little towards where they're heard (counted from the first beat,
      // so the bars carry on).
      const k = Math.round((lastBeat - live.at) / period);
      let d = lastBeat - (live.at + k * period);
      d -= Math.round(d / period) * period;
      live = { period, at: live.at + d * (lock.period ? 0.25 : 0.5) };
    } else if (live && Math.abs(live.period - period) / period < 0.06) {
      // Settling (or just locked) near the tempo it had: the count carries on.
      const k = Math.round((lastBeat - live.at) / live.period);
      live = { period, at: lastBeat - k * period };
    } else live = { period, at: lastBeat };
  }
  // Where in the beat he is now: { n (beats so far), ph (0..1 through this one), period (ms) }, or null.
  function beatNow(now) {
    const P = window.Player;
    const g = P && P.beat;
    if (g && g.bpm > 0) {
      const b = (g.time - g.offset) / (60 / g.bpm);
      return { n: Math.floor(b), ph: b - Math.floor(b), period: (60000 / g.bpm) / g.rate };
    }
    if (!live || now - hearing > 300) return null;
    const b = (now - live.at) / live.period;
    return { n: Math.floor(b), ph: b - Math.floor(b), period: live.period };
  }
  let danceX = 0;
  function dance(now, bt) {
    const bar = Math.floor(bt.n / 4), inBar = ((bt.n % 4) + 4) % 4, ph = bt.ph;
    // The bob: down on the beat, back up by a third of the way through it.
    let key = ph < 0.3 ? 'nod' : 'stand';
    // The sway: one way and back over two beats.
    let rot = 6 * Math.sin(Math.PI * ((((bt.n % 2) + 2) % 2) + ph));
    let up = 0;
    // Every other bar, the last beat's a hop that turns him round.
    if (bar % 2 === 1 && inBar === 3) {
      up = Math.sin(Math.PI * ph) * 12; key = ph < 0.12 || ph > 0.88 ? 'nod' : 'air'; rot *= 0.3;
      if (ph > 0.5 && danceX !== bt.n) { danceX = bt.n; face = -face; }
    } else if (bar % 2 === 1 && (inBar === 0 || inBar === 2)) {
      // A step on the beat (feet together, a little along), on the off-bars.
      if (ph < 0.3) { key = 'step'; x += face * 14 * (0.3 - ph) * 0.06; }
    }
    if (key === 'stand' && now % 3900 < 120) key = 'blink';
    if (key === 'nod' && now % 3900 < 120) key = 'nodBlink';
    return { key, rot, up };
  }
  // ---------- Dust ----------
  // Little square puffs (pixel-sized) where he lands, bounces, hits a wall or skids.
  const dust = document.createElement('canvas');
  dust.setAttribute('aria-hidden', 'true');
  Object.assign(dust.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '59', imageRendering: 'pixelated' });
  document.body.append(dust);
  const dg = dust.getContext('2d');
  let motes = [];
  const fitDust = () => { dust.width = innerWidth; dust.height = innerHeight; };
  fitDust();
  addEventListener('resize', fitDust);
  // n motes at (px, py); side: which way they mostly go (−1 left, 1 right, 0 both).
  function puff(px, py, n, side) {
    if (calm.matches) return;
    const shade = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#9c9c98';
    for (let i = 0; i < Math.round(n); i++) {
      const dir = side || (Math.random() < 0.5 ? -1 : 1);
      motes.push({ x: px + (Math.random() - 0.5) * 18, y: py - Math.random() * 4, vx: dir * (40 + Math.random() * 160), vy: -(30 + Math.random() * 120),
        life: 0, max: 0.45 + Math.random() * 0.45, size: 3 * (1 + Math.floor(Math.random() * 2)), color: shade });
    }
    if (motes.length > 300) motes = motes.slice(-300);
  }
  function drawDust(dt) {
    if (!motes.length) return;
    dg.clearRect(0, 0, dust.width, dust.height);
    motes = motes.filter((m) => (m.life += dt) < m.max);
    for (const m of motes) {
      m.vy += 260 * dt; m.vx *= 1 - 2.5 * dt; m.vy *= 1 - 1.5 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
      dg.globalAlpha = 0.75 * (1 - m.life / m.max);
      dg.fillStyle = m.color;
      dg.fillRect(Math.round(m.x / 3) * 3, Math.round(m.y / 3) * 3, m.size, m.size);
    }
    if (!motes.length) dg.clearRect(0, 0, dust.width, dust.height);
  }

  // ---------- Picking him up ----------
  // held: follows the pointer (swinging with how fast you move him); fall: drops to the ground;
  // down: lies there if it was a real fall; getup: back on his feet, then on his way.
  // Lie on the side he's already tipping to (facing that way), so he never flips over first.
  function sideFromTurn(turn) {
    const r = ((((turn + 180) % 360) + 360) % 360) - 180;
    if (Math.abs(r) > 15) face = r > 0 ? 1 : -1;
  }
  // How far he reaches from the middle of his box, turned rot° and facing face: { down, up, left, right } (px).
  function reach(key, turn) {
    const h = (F[key] || F.stand).hull, a = (turn * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    let down = -1e9, up = -1e9, left = -1e9, right = -1e9;
    for (const [px, py] of h) {
      const lx = px * face, dx = lx * c - py * sn, dy = lx * sn + py * c;
      if (dy > down) down = dy; if (-dy > up) up = -dy; if (dx > right) right = dx; if (-dx > left) left = -dx;
    }
    return { down, up, left, right };
  }
  let curRot = 0; // his turn last frame (for how far he reaches)
  let y = 0, vx = 0, vy = 0, tilt = 0, spin = 0, grab = null, downAt = 0, fallFrom = 0, hard = false, trail = [];
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    const b = el.getBoundingClientRect();
    grab = { dx: ev.clientX - b.left, dy: ev.clientY - b.top, lastX: ev.clientX };
    trail = [];
    state = 'held'; hop = null; tilt = 0;
    el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointermove', (ev) => {
    if (state !== 'held' || !grab) return;
    x = ev.clientX - grab.dx;
    y = ev.clientY - grab.dy;
    tilt = Math.max(-35, Math.min(35, tilt + (ev.clientX - grab.lastX) * 1.2));
    grab.lastX = ev.clientX;
    // The last tenth of a second of movement: the throw's speed when you let go.
    const t = performance.now();
    trail.push([t, x, y]);
    while (trail.length > 2 && t - trail[0][0] > 100) trail.shift();
  });
  const drop = () => {
    if (state !== 'held') return;
    // Thrown at the speed he was moving (a still let-go just drops him).
    const t = performance.now();
    const a = trail[0], z = trail[trail.length - 1];
    vx = vy = 0;
    if (a && z && z[0] - a[0] > 10 && t - z[0] < 80) { const s2 = (z[0] - a[0]) / 1000; vx = (z[1] - a[1]) / s2; vy = (z[2] - a[2]) / s2; }
    const cap = 2600, sp = Math.hypot(vx, vy);
    if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
    state = 'fly'; grab = null; fallFrom = y; hard = sp > 900; spin = tilt;
    if (Math.abs(vx) > 20) face = vx < 0 ? -1 : 1;
    el.style.cursor = 'grab';
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
  el.addEventListener('lostpointercapture', drop);

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let key = 'stand', up = 0, rot = 0;
    listen(now);
    const bt = !calm.matches && (state === 'idle' || state === 'go' || state === 'dance') ? beatNow(now) : null;
    if (bt && state !== 'dance' && (state === 'idle' || !hop || now - hop.t0 >= CROUCH + AIR + LAND)) { state = 'dance'; hop = null; }
    if (!bt && state === 'dance') { state = 'idle'; until = now + 600; }
    // How far his (turned) square reaches from its middle: the floor and the window's sides are kept
    // to that, so a tumbling or lying Nabbit rests on the floor instead of sinking into it.
    const half = (SIZE * SCALE) / 2, r0 = reach(lastFrame || 'stand', curRot);
    const floor = ground() - half - r0.down;
    const minX = 8 + r0.left - half, maxX = innerWidth - 8 - half - r0.right;
    if (state === 'held') {
      key = 'air';
      tilt *= 0.9; // the swing settles
      rot = tilt;
    } else if (state === 'fly') {
      // Through the air: gravity, a little air drag, tumbling with his sideways speed.
      vy += 2200 * dt;
      vx *= 1 - 0.35 * dt;
      x += vx * dt; y += vy * dt;
      spin += vx * dt * 0.9;
      rot = spin;
      key = 'air';
      // Off the sides and the top: bounced back, with a puff of dust.
      if (x < minX && vx < 0) { x = minX; vx = -vx * 0.55; puff(x + half - r0.left, y + SIZE * SCALE / 2, Math.abs(vx) / 90, 1); hard = true; }
      if (x > maxX && vx > 0) { x = maxX; vx = -vx * 0.55; puff(x + half + r0.right, y + SIZE * SCALE / 2, Math.abs(vx) / 90, -1); hard = true; }
      if (y < r0.up - half && vy < 0) { y = r0.up - half; vy = -vy * 0.4; }
      if (y >= floor && vy > 0) {
        y = floor;
        puff(x + SIZE * SCALE / 2, ground(), Math.min(26, 4 + vy / 70 + Math.abs(vx) / 120), 0);
        if (vy > 420) { vy = -vy * 0.36; vx *= 0.75; hard = true; } // a bounce
        else {
          vy = 0;
          state = Math.abs(vx) > 40 ? 'skid' : 'landed';
          sideFromTurn(spin);
          if (floor - fallFrom > 60) hard = true;
        }
      }
    } else if (state === 'skid') {
      // Sliding along the floor to a stop, dust behind him.
      vx *= 1 - 5 * dt;
      x += vx * dt;
      key = 'crouch';
      rot = hard ? face * 90 * 0.9 : 0; // the side he'll lie on
      if (Math.random() < 0.6) puff(x + SIZE * SCALE / 2 - Math.sign(vx) * 16, ground(), 1, -Math.sign(vx));
      if (x < minX || x > maxX) { x = Math.max(minX, Math.min(maxX, x)); vx = -vx * 0.4; }
      if (Math.abs(vx) < 30) state = 'landed';
    } else if (state === 'landed') {
      spin = 0;
      if (hard && !calm.matches) { state = 'down'; downAt = now; key = 'blink'; rot = face * 90; } else { state = 'idle'; until = now + 600; }
    } else if (state === 'down') {
      key = 'blink'; rot = face * 90;
      if (now - downAt > 900) { state = 'getup'; downAt = now; }
    } else if (state === 'getup') {
      const u = Math.min(1, (now - downAt) / 320);
      key = u < 1 ? 'crouch' : 'stand';
      rot = face * 90 * (1 - u) * (1 - u);
      if (u >= 1) { state = 'idle'; until = now + 500 + Math.random() * 1200; }
    } else if (state === 'dance') {
      ({ key, rot, up } = dance(now, bt));
    } else if (state === 'go' && hop && !calm.matches) {
      const t = now - hop.t0;
      if (t < CROUCH) key = 'crouch';
      else if (t < CROUCH + AIR) {
        const u = (t - CROUCH) / AIR;
        key = 'air';
        x = hop.from + hop.len * u;
        up = Math.sin(u * Math.PI) * hop.high;
      } else if (t < CROUCH + AIR + LAND) { key = 'crouch'; x = hop.from + hop.len; }
      else {
        x = hop.from + hop.len;
        if (Math.abs(target - x) < 1) next(now); else hopStart(now);
      }
    } else {
      if (state === 'go') state = 'idle';
      if (now > until) next(now);
      if (now % 4200 < 140) key = 'blink';
    }
    show(key);
    // keep the box as turned this frame inside the window
    const r1 = reach(key, rot);
    const floor1 = ground() - half - r1.down;
    x = Math.max(8 + r1.left - half, Math.min(innerWidth - 8 - half - r1.right, x));
    if (state !== 'held' && state !== 'fly') y = floor1 - up;
    drawDust(dt);
    if (state !== 'held') y = Math.min(y, floor1);
    y = Math.max(r1.up - half, y);
    curRot = rot;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) rotate(${rot.toFixed(1)}deg) scaleX(${face})`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
