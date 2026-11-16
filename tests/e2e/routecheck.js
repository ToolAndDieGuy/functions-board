// Checks the square-cornered arrows the board last drew: no two arrows may run along each other closer than
// `min` px (arrows that share a trunk on purpose are one line and don't count), and no arrow may cross a box
// other than its own two ends. Runs in the page: board(page).evaluate(routeCheck, { min: 14 }).
function routeCheck(el, opt) {
  const R = el._ortho, m = el._model, min = (opt && opt.min) || 14;
  if (!R) return { error: 'no square-cornered routes drawn' };
  const segs = [];
  R.routes.forEach((pts, ri) => {
    const o = R.owners[ri] || [null, null], last = pts.length - 1;
    let firstV = -1, lastV = -1;
    for (let i = 1; i <= last; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5 && Math.abs(pts[i - 1][1] - pts[i][1]) > 0.5) { if (firstV < 0) firstV = i; lastV = i; }
    for (let i = 1; i <= last; i++) {
      const u = pts[i - 1], v = pts[i], vert = Math.abs(u[0] - v[0]) < 0.5;
      if (Math.hypot(u[0] - v[0], u[1] - v[1]) < 0.5) continue;
      // the part of an arrow that belongs to a trunk: from its box up to and along the trunk line
      // (with no upright run at all, the whole level arrow is part of its trunk)
      const own = o[0] && (firstV < 0 || i <= firstV) ? o[0] : o[1] && (lastV < 0 || i >= lastV) ? o[1] : null;
      segs.push({ ri, i, vert, c: vert ? u[0] : u[1], lo: Math.min(vert ? u[1] : u[0], vert ? v[1] : v[0]), hi: Math.max(vert ? u[1] : u[0], vert ? v[1] : v[0]), own, end: i === 1 ? 'a' : i === last ? 'b' : null });
    }
  });
  const close = [], through = [];
  for (let p = 0; p < segs.length; p++) for (let q = p + 1; q < segs.length; q++) {
    const s = segs[p], t = segs[q];
    if (s.ri === t.ri || s.vert !== t.vert) continue;
    // an arrow running into or out of its own trunk's line is that trunk
    if ((s.own && (R.owners[t.ri] || []).includes(s.own)) || (t.own && (R.owners[s.ri] || []).includes(t.own))) continue;
    // two arrows leaving (or entering) the same side of one box start apart along it, so their stubs are judged
    // by how far apart they start
    const d = Math.abs(s.c - t.c), ov = Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo);
    if (d < min - 0.5 && ov > 1) close.push({ a: R.ids[s.ri], b: R.ids[t.ri], gap: Math.round(d * 10) / 10, along: Math.round(ov), vert: s.vert, at: [Math.round(s.c), Math.round(Math.max(s.lo, t.lo))], segs: [s.i, t.i], pa: opt && opt.pts ? R.routes[s.ri].map((p) => p.map(Math.round)) : undefined, pb: opt && opt.pts ? R.routes[t.ri].map((p) => p.map(Math.round)) : undefined });
  }
  segs.forEach((s) => {
    const [fk, tk] = R.boxes[s.ri];
    m.nodes.forEach((b, k) => {
      if (k === fk || k === tk || !el._visibleKeys().has(k)) return;
      const x0 = s.vert ? s.c : s.lo, x1 = s.vert ? s.c : s.hi, y0 = s.vert ? s.lo : s.c, y1 = s.vert ? s.hi : s.c;
      if (Math.max(x0, x1) > b.x + 1 && Math.min(x0, x1) < b.x + b.w - 1 && Math.max(y0, y1) > b.y + 1 && Math.min(y0, y1) < b.y + b.h - 1) through.push({ edge: R.ids[s.ri], box: k });
    });
  });
  const minGap = close.length ? Math.min(...close.map((c) => c.gap)) : null;
  return { arrows: R.routes.length, close: close.length, minGap, through: through.length, sample: close.slice(0, +(opt && opt.n) || 6), thru: through.slice(0, 6) };
}
module.exports = { routeCheck };
