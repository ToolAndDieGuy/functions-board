import { NW } from './constants.js';
import { P } from './i18n.js';

/* ---------- arrows: which sides they leave and enter, and how they get around boxes (7.3) ---------- */
// facing sides: left/right when the boxes are further apart across than up and down, else top/bottom
export function sides(a, b) {
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  if (gapX >= gapY) return bcx >= acx ? ['r', 'l'] : ['l', 'r'];
  return bcy >= acy ? ['b', 't'] : ['t', 'b'];
}
export const NORMAL = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1] };
// a point on a box's side; f runs 0..1 along it (several arrows on one side spread out)
export function anchor(n, side, f) {
  const t = f == null ? 0.5 : f, pad = 2;
  if (side === 'r') return [n.x + n.w, n.y + n.h * t];
  if (side === 'l') return [n.x - pad, n.y + n.h * t];
  if (side === 't') return [n.x + n.w * t, n.y - pad];
  return [n.x + n.w * t, n.y + n.h + pad];
}
export const inside = (p, r, m) => p[0] > r.x - m && p[0] < r.x + r.w + m && p[1] > r.y - m && p[1] < r.y + r.h + m;
export const cub = (p0, c1, c2, p1, t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]; };
// a smooth path from p0 (leaving along n0) through waypoints to p1 (arriving against n1)
export function smoothPath(p0, n0, way, p1, n1) {
  const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), c = Math.min(160, Math.max(40, dist / 2));
  const fmt = (p) => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`;
  if (!way.length) {
    const c1 = [p0[0] + n0[0] * c, p0[1] + n0[1] * c], c2 = [p1[0] + n1[0] * c, p1[1] + n1[1] * c];
    return { d: `M${fmt(p0)} C${fmt(c1)} ${fmt(c2)} ${fmt(p1)}`, mid: cub(p0, c1, c2, p1, 0.5), segs: [[p0, c1, c2, p1]] };
  }
  // Catmull-Rom through the points, with the box sides fixing the tangents at both ends
  const k = Math.min(60, c);
  const pts = [[p0[0] - n0[0] * k, p0[1] - n0[1] * k], p0, ...way, p1, [p1[0] - n1[0] * k, p1[1] - n1[1] * k]];
  let d = `M${fmt(p0)}`;
  const segs = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const a = pts[i - 1], b = pts[i], cc = pts[i + 1], e = pts[i + 2];
    const c1 = [b[0] + (cc[0] - a[0]) / 6, b[1] + (cc[1] - a[1]) / 6], c2 = [cc[0] - (e[0] - b[0]) / 6, cc[1] - (e[1] - b[1]) / 6];
    d += ` C${fmt(c1)} ${fmt(c2)} ${fmt(cc)}`;
    segs.push([b, c1, c2, cc]);
  }
  return { d, mid: way[Math.floor((way.length - 1) / 2)], segs };
}
// boxes a path runs through (sampled), in the order the path meets them
export function blockers(segs, boxes, skip) {
  const hit = [];
  segs.forEach((s) => { for (let t = 0.05; t < 1; t += 0.05) { const p = cub(s[0], s[1], s[2], s[3], t); boxes.forEach((b) => { if (!skip.has(b) && !hit.includes(b) && inside(p, b, 6)) hit.push(b); }); } });
  return hit;
}
// geometry of one arrow: facing sides, spread position on each side (fa, fb), the automatic layout's
// waypoints when there are any, and a detour around any box in the way
export function edgeGeom(a, b, o = {}) {
  const [sa, sb] = o.sides || sides(a, b);
  const p0 = anchor(a, sa, o.fa), p1 = anchor(b, sb, o.fb);
  let way = (o.way || []).slice();
  let g = smoothPath(p0, NORMAL[sa], way, p1, NORMAL[sb]);
  if (o.boxes && o.boxes.length) {
    const skip = new Set([a, b]);
    for (let pass = 0; pass < 3; pass++) {
      const hit = blockers(g.segs, o.boxes, skip);
      if (!hit.length) break;
      const horiz = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]);
      hit.slice(0, 3).forEach((bx) => {
        skip.add(bx);
        const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
        const w = horiz ? [cx, (p0[1] + p1[1]) / 2 <= cy ? bx.y - 18 : bx.y + bx.h + 18] : [(p0[0] + p1[0]) / 2 <= cx ? bx.x - 18 : bx.x + bx.w + 18, cy];
        way.push(w);
      });
      way.sort((u, v) => (horiz ? (u[0] - v[0]) * Math.sign(p1[0] - p0[0] || 1) : (u[1] - v[1]) * Math.sign(p1[1] - p0[1] || 1)));
      g = smoothPath(p0, NORMAL[sa], way, p1, NORMAL[sb]);
    }
  }
  return { d: g.d, mx: g.mid[0], my: g.mid[1], sides: [sa, sb], way };
}

/* ---------- square-cornered arrows ---------- */
// the arrow and layout style: arrows coloured by what they do, square-cornered (or curved, the Arrows menu's
// choice: CURVED, set by the board before it lays out and draws), boxes lined up with what they connect to,
// separate chains packed together, a function too wide for a screen folded into rows.
// window.__fbStyle overrides any of it (for comparing styles in tests).
export let CURVED = false;
export function setCurved(v) { CURVED = !!v; }
export const PROTO = () => Object.assign({ color: 1, ortho: !CURVED, align: 1, bands: 1, pack: 1 }, (typeof window !== 'undefined' && window.__fbStyle) || {});
// SEP: the least room between two arrows that run side by side
export const STUB = 18, SEP = 16, RAD = 14, HOP = 5;
// right side to left side whenever the boxes stand apart sideways (a target to the left is reached round the
// outside), so every arrow reads left to right at both ends; top and bottom only for boxes stacked in a column
export function orthoSides(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (ox > -2 * STUB) return b.y + b.h / 2 >= a.y + a.h / 2 ? ['b', 't'] : ['t', 'b'];
  return ['r', 'l'];
}
export const hitsBox = (x0, y0, x1, y1, b, m) => Math.max(x0, x1) > b.x - m && Math.min(x0, x1) < b.x + b.w + m && Math.max(y0, y1) > b.y - m && Math.min(y0, y1) < b.y + b.h + m;
// the row nearest y where a level run from x0 to x1 meets no box
// (with room either side for other arrows taking the same way, where there is such a row)
export function clearY(y, x0, x1, boxes, skip) {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  for (const m of [30, 6]) {
    const cand = [y];
    boxes.forEach((b) => { if (!skip.has(b) && b.x < hi && b.x + b.w > lo) cand.push(b.y - m - 10, b.y + b.h + m + 10); });
    const ok = cand.filter((c) => !boxes.some((b) => !skip.has(b) && hitsBox(lo, c, hi, c, b, m)));
    if (ok.length) return ok.sort((u, v) => Math.abs(u - y) - Math.abs(v - y))[0];
  }
  return y;
}
// the column nearest x, between lo and hi, where an upright run from y0 to y1 meets no box
export function clearX(x, y0, y1, lo, hi, boxes, skip) {
  const cand = [x];
  boxes.forEach((b) => { if (!skip.has(b) && b.y < Math.max(y0, y1) && b.y + b.h > Math.min(y0, y1)) cand.push(b.x - 14, b.x + b.w + 14); });
  const ok = cand.filter((c) => c >= lo && c <= hi && !boxes.some((b) => !skip.has(b) && hitsBox(c, y0, c, y1, b, 4)));
  return ok.length ? ok.sort((u, v) => Math.abs(u - x) - Math.abs(v - x))[0] : null;
}
export const segClear = (pts, boxes, skip) => pts.every((p, i) => !i || !boxes.some((b) => !skip.has(b) && hitsBox(pts[i - 1][0], pts[i - 1][1], p[0], p[1], b, 3)));
// the corner points of one arrow: way are the automatic layout's slots for an arrow that skips columns
export function orthoRoute(a, b, sd, fa, fb, way, boxes) {
  const p0 = anchor(a, sd[0], fa), p1 = anchor(b, sd[1], fb), skip = new Set([a, b]);
  if (sd[0] === 'b' || sd[0] === 't') {
    const my = clearY((p0[1] + p1[1]) / 2, p0[0], p1[0], boxes, skip), v = [p0, [p0[0], my], [p1[0], my], p1];
    if (segClear(v, boxes, skip)) return v;
    // something stands between them: out of the right side and round, into the left
    p0[0] = a.x + a.w; p0[1] = a.y + a.h / 2; p1[0] = b.x - 2; p1[1] = b.y + b.h / 2;
    const rx = Math.max(p0[0], p1[0] + 2 * STUB) + STUB, lx = p1[0] - STUB;
    const g1 = clearY(p1[1] > p0[1] ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2, lx, rx, boxes, new Set());
    return [p0, [rx, p0[1]], [rx, g1], [lx, g1], [lx, p1[1]], p1];
  }
  p0[0] = a.x + a.w; p1[0] = b.x - 2;
  const around = (x, y, tx, ty) => {
    // the run back across clears the two ends' own boxes as well
    const rx = x + STUB, lx = tx - STUB, gy = clearY((y + ty) / 2, Math.min(rx, lx), Math.max(rx, lx), boxes, new Set());
    return [[rx, y], [rx, gy], [lx, gy], [lx, ty]];
  };
  const pts = [p0];
  let x = p0[0], y = p0[1];
  // a slot spans its column (w[2] is half the column's width)
  const stops = (way || []).map((w) => ({ x: w[0] - (w[2] || NW / 2), y: w[1], out: w[0] + (w[2] || NW / 2) })).concat([{ x: p1[0], y: p1[1], out: p1[0], end: true }]);
  for (const s of stops) {
    if (s.x - x >= (way && way.length ? 8 : 2 * STUB)) {
      if (Math.abs(s.y - y) > 0.5) {
        let cx = (x + s.x) / 2;
        if (!way || !way.length) { const c = clearX(cx, y, s.y, x + STUB, s.x - STUB, boxes, skip); if (c != null) cx = c; }
        pts.push([cx, y], [cx, s.y]);
      }
    } else pts.push(...around(x, y, s.x, s.y));
    x = s.out; y = s.y;
  }
  pts.push(p1);
  if (!(way && way.length) && !segClear(pts, boxes, skip)) return [p0, ...around(p0[0], p0[1], p1[0], p1[1]), p1];
  return pts;
}
// spread upright runs that share a gap into lanes, and level runs that share a row likewise
// owners: per route, a trunk name for its first upright run (arrows from one box) and its last (arrows into one
// box); runs with the same trunk share a lane, so a fan-out reads as one line that branches
// runs that would overlap side by side, less than SEP apart
export const clash = (p, q) => p.lo < q.hi + SEP && q.lo < p.hi + SEP;
// puts runs sharing a channel in lanes (it.lane), in an order across the channel that has arrows cross each other
// as little as possible; runs that don't overlap can share a lane. Returns the number of lanes.
export function orderLanes(items) {
  // p before q costs the joins of p heading past q, and of q heading back past p
  // (and, much worse, a join of p heading past q at about the height of one of q's heading back: those two would
  // run along each other)
  const cost = (p, q) => p.ats.filter(([t, s]) => s > 0 && t > q.lo + 0.5 && t < q.hi - 0.5).length + q.ats.filter(([t, s]) => s < 0 && t > p.lo + 0.5 && t < p.hi - 0.5).length
    + 1000 * p.ats.filter(([t, s]) => s > 0 && q.ats.some(([t2, s2]) => s2 < 0 && Math.abs(t - t2) < SEP)).length;
  items.sort((p, q) => p.c - q.c || p.lo - q.lo);
  // (only runs that overlap need an order; a few passes settle it)
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let j = 0; j < items.length; j++) for (let k = j + 1; k < items.length; k++) {
      if (clash(items[j], items[k]) && cost(items[j], items[k]) > cost(items[k], items[j])) { items.splice(j, 0, items.splice(k, 1)[0]); moved = true; }
    }
    if (!moved) break;
  }
  // lanes keep that order between runs that overlap
  items.forEach((it, j) => { it.lane = 0; for (let k = 0; k < j; k++) if (clash(items[k], it)) it.lane = Math.max(it.lane, items[k].lane + 1); });
  return items.length ? Math.max(...items.map((it) => it.lane)) + 1 : 0;
}
export function laneSpread(routes, owners, boxes, short) {
  // the runs in the middle of each arrow (not the short stubs at its two boxes), upright (a = 0) and level (a = 1);
  // c is where the run is across its direction, lo..hi its extent along it, ats where other parts of the arrow
  // join it (at, and -1 or 1 for the side they go off to)
  const runs = [[], []];
  routes.forEach((pts, ri) => {
    let firstV = -1, lastV = -1;
    for (let i = 2; i < pts.length - 1; i++) {
      const u = pts[i - 1], v = pts[i];
      if (Math.abs(u[0] - v[0]) < 0.5 && Math.abs(u[1] - v[1]) > 0.5) { if (firstV < 0) firstV = i; lastV = i; }
    }
    for (let i = 2; i < pts.length - 1; i++) {
      const u = pts[i - 1], v = pts[i];
      const vert = Math.abs(u[0] - v[0]) < 0.5 && Math.abs(u[1] - v[1]) > 0.5, hor = Math.abs(u[1] - v[1]) < 0.5 && Math.abs(u[0] - v[0]) > 0.5;
      if (!vert && !hor) continue;
      const a = vert ? 0 : 1, b = 1 - a, o = owners && owners[ri];
      const own = vert && o ? (i === firstV && o[0] ? o[0] : i === lastV && o[1] ? o[1] : null) : null;
      const ats = [[u[b], Math.sign(pts[i - 2][a] - u[a])], [v[b], Math.sign(pts[i + 1][a] - v[a])]];
      // it can't move past the far ends of the runs either side of it, or they would turn back on themselves
      const lim = [-Infinity, Infinity];
      [pts[i - 2][a], pts[i + 1][a]].forEach((z) => { if (z < u[a]) lim[0] = Math.max(lim[0], z + 8); else if (z > u[a]) lim[1] = Math.min(lim[1], z - 8); });
      runs[a].push({ ri, i, own, c: u[a], lo: Math.min(u[b], v[b]), hi: Math.max(u[b], v[b]), ats, lim });
    }
  });
  [0, 1].forEach((a) => {
    // a trunk's runs become one item; others are an item each. Each item gets the free room either side of it,
    // between the boxes beside it (L..R)
    const items = [], byOwn = new Map();
    runs[a].forEach((r) => {
      let L = -Infinity, R = Infinity;
      boxes.forEach((bx) => {
        const s0 = a ? bx.y : bx.x, s1 = s0 + (a ? bx.h : bx.w), t0 = a ? bx.x : bx.y, t1 = t0 + (a ? bx.w : bx.h);
        if (t1 <= r.lo || t0 >= r.hi) return;
        if (s1 <= r.c + 1) L = Math.max(L, s1); else if (s0 >= r.c - 1) R = Math.min(R, s0);
      });
      const marg = a ? 8 : STUB;
      L = Math.max(L, r.lim[0] - marg); R = Math.min(R, r.lim[1] + marg);
      const it = r.own && byOwn.get(r.own);
      if (it) { it.rs.push(r); it.lo = Math.min(it.lo, r.lo); it.hi = Math.max(it.hi, r.hi); it.ats.push(...r.ats); it.L = Math.max(it.L, L); it.R = Math.min(it.R, R); return; }
      const nw = { rs: [r], lo: r.lo, hi: r.hi, ats: r.ats.slice(), c: r.c, L, R };
      items.push(nw); if (r.own) byOwn.set(r.own, nw);
    });
    // items that run alongside each other in the same free room form a channel: close together, or with rooms
    // that overlap (a run round the outside of a box shares the gap the arrows between the columns turn in)
    const marg = a ? 8 : STUB, near = a ? SEP + 4 : 40;
    const up = items.map((_, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
    const room = items.map((it) => [it.L, it.R]);
    items.forEach((p, i) => items.forEach((q, j) => {
      if (j <= i || !clash(p, q)) return;
      const fi = find(i), fj = find(j);
      if (fi === fj) return;
      const L = Math.max(room[fi][0], room[fj][0]), R = Math.min(room[fi][1], room[fj][1]);
      // (level runs only when close: the automatic layout already keeps their rows apart)
      if (a ? Math.abs(p.c - q.c) >= near : R - L < 2 * marg || (Math.abs(p.c - q.c) >= near && !(isFinite(L) && isFinite(R)))) return;
      up[fi] = fj; room[fj] = [L, R];
    }));
    const chans = new Map();
    items.forEach((it, i) => { const k = find(i); if (!chans.has(k)) chans.set(k, []); chans.get(k).push(it); });
    chans.forEach((ch) => {
      if (ch.length < 2) return;
      const n = orderLanes(ch), c0 = Math.min(...ch.map((it) => it.c)), c1 = Math.max(...ch.map((it) => it.c));
      let [L, R] = room[find(items.indexOf(ch[0]))];
      // no box on a side: the lanes stay about where the runs were
      if (!isFinite(L) && !isFinite(R)) { L = (c0 + c1) / 2 - marg - ((n - 1) * SEP) / 2; R = L + 2 * marg + (n - 1) * SEP; }
      else if (!isFinite(L)) L = Math.min(c0 - marg, R - 2 * marg - (n - 1) * SEP);
      else if (!isFinite(R)) R = Math.max(c1 + marg, L + 2 * marg + (n - 1) * SEP);
      // upright lanes sit in the middle of their gap; level ones stay about where they were, inside the room
      const space = R - L - 2 * marg, sep = n > 1 ? Math.max(4, Math.min(SEP, space / (n - 1))) : 0, half = ((n - 1) * sep) / 2;
      if (short && !a && n > 1 && space < (n - 1) * SEP - 0.5) short.push({ x: (L + R) / 2, lo: Math.min(...ch.map((it) => it.lo)), hi: Math.max(...ch.map((it) => it.hi)), need: (n - 1) * SEP - space });
      const mean = ch.reduce((t, it) => t + it.c, 0) / ch.length;
      const mid = !a ? (L + R) / 2 : space < 2 * half ? (L + R) / 2 : Math.min(Math.max(mean, L + marg + half), R - marg - half);
      ch.forEach((it) => {
        const at = mid + (it.lane - (n - 1) / 2) * sep;
        it.rs.forEach((r) => { const pts = routes[r.ri]; pts[r.i - 1][a] = at; pts[r.i][a] = at; });
      });
    });
  });
}
// a last pass for runs still closer than SEP to another arrow's (lanes in two channels that meet, a row that
// happens to line up with a slot): each is moved aside, to the nearest spot that is clear of boxes and other arrows
export function untangle(routes, owners, ends, boxes) {
  const segs = () => {
    const out = [];
    routes.forEach((pts, ri) => {
      const o = owners[ri] || [null, null], last = pts.length - 1;
      let firstV = -1, lastV = -1;
      for (let i = 1; i <= last; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5 && Math.abs(pts[i - 1][1] - pts[i][1]) > 0.5) { if (firstV < 0) firstV = i; lastV = i; }
      for (let i = 1; i <= last; i++) {
        const u = pts[i - 1], v = pts[i];
        if (Math.hypot(u[0] - v[0], u[1] - v[1]) < 0.5) continue;
        const a = Math.abs(u[0] - v[0]) < 0.5 ? 0 : 1, b = 1 - a;
        const own = o[0] && (firstV < 0 || i <= firstV) ? o[0] : o[1] && (lastV < 0 || i >= lastV) ? o[1] : null;
        // a level stub at either end can slide along its box's side
        const stub = !own && a === 1 && last > 1 && (i === 1 || i === last) ? (i === 1 ? ends[ri][0] : ends[ri][1]) : null;
        // (end: the side of a box it starts or ends at; arrows there are as far apart as that side allows)
        const endBox = i === 1 ? ends[ri][0] : i === last ? ends[ri][1] : null;
        out.push({ ri, i, a, own, c: u[a], lo: Math.min(u[b], v[b]), hi: Math.max(u[b], v[b]), stub, end: endBox ? (i === 1 ? 'a' : 'b') : null, endBox, fixed: !stub && (i === 1 || i === last || !!own) });
      }
    });
    return out;
  };
  // (an arrow running into or out of its own trunk's line is that trunk, not alongside it)
  const mine = (s, t) => s.own && (owners[t.ri] || []).includes(s.own);
  const sameSide = (s, t) => s.end && s.end === t.end && s.endBox === t.endBox && Math.abs(s.c - t.c) >= 10;
  const near = (s, t) => s.ri !== t.ri && s.a === t.a && !mine(s, t) && !mine(t, s) && !sameSide(s, t) && Math.abs(s.c - t.c) < SEP - 0.5 && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 1;
  const blocked = (ri, p, q) => boxes.some((bx) => bx !== ends[ri][0] && bx !== ends[ri][1] && hitsBox(p[0], p[1], q[0], q[1], bx, 4));
  for (let pass = 0; pass < 4; pass++) {
      const S = segs();
      let moved = false;
      // move run t (keeping the runs either side of it going the same way) to the first of tries that works
      const tryMove = (t, tries) => {
        const pts = routes[t.ri], u = pts[t.i - 1], v = pts[t.i], prev = pts[t.i - 2], next = pts[t.i + 1], a = t.a;
        tries.sort((p, q) => Math.abs(p - t.c) - Math.abs(q - t.c));
        for (const c of tries) {
          // the runs either side keep their direction and some length
          if ((prev && (prev[a] - u[a]) * (prev[a] - c) <= 16) || (next && (next[a] - v[a]) * (next[a] - c) <= 16)) continue;
          if (t.stub && (c < t.stub.y + 8 || c > t.stub.y + t.stub.h - 8)) continue;
          const nu = u.slice(), nv = v.slice(); nu[a] = c; nv[a] = c;
          if (blocked(t.ri, nu, nv) || (prev && blocked(t.ri, prev, nu)) || (next && blocked(t.ri, nv, next))) continue;
          // it ends up along no other arrow, and it and the two runs it stretches along fewer than before
          const side = (p, q) => ({ ri: t.ri, a: 1 - a, own: t.own, c: p[1 - a], lo: Math.min(p[a], q[a]), hi: Math.max(p[a], q[a]) });
          const score = (x, y, z) => S.filter((s) => s.ri !== t.ri && (near(s, x) || (y && near(s, y)) || (z && near(s, z)))).length;
          const me = { ri: t.ri, a, own: t.own, c, lo: t.lo, hi: t.hi };
          if (S.some((s) => s.ri !== t.ri && near(s, me))) continue;
          if (score(me, prev && side(prev, nu), next && side(nv, next)) >= score(t, prev && side(prev, u), next && side(v, next))) continue;
          u[a] = c; v[a] = c; t.c = c;
          return true;
        }
        return false;
      };
      S.forEach((t) => {
        const hit = S.filter((s) => near(s, t));
        if (!hit.length) return;
        if (!t.fixed) {
          // spots either side, nearest first (a stub anywhere along its box's side)
          const tries = [];
          for (let k = 1; k <= (t.stub ? 3 : 6); k++) hit.forEach((s) => { tries.push(s.c + Math.sign(t.c - s.c || 1) * SEP * k, s.c - Math.sign(t.c - s.c || 1) * SEP * k); });
          if (t.stub) for (let c = t.stub.y + 8; c <= t.stub.y + t.stub.h - 8; c += 2) tries.push(c);
          if (tryMove(t, tries)) { moved = true; return; }
        }
        // or shorten it, by moving a turn at one of its ends past where the other arrow's run ends
        for (const j of [t.i - 1, t.i + 1]) {
          const nb = S.find((s) => s.ri === t.ri && s.i === j);
          if (!nb || nb.fixed || nb.stub) continue;
          if (tryMove(nb, hit.flatMap((s) => [s.lo - 10, s.lo - SEP - 2, s.lo - 2 * SEP - 2, s.hi + 10, s.hi + SEP + 2, s.hi + 2 * SEP + 2]))) { moved = true; return; }
        }
      });
      if (!moved) break;
    }
  // a short step up or down in the middle of a level run (two lanes that happen to sit at different heights)
  // reads as a turn the wrong way: the run goes straight instead, where that is clear of boxes and other arrows
  const S = segs(), seg = (ri, a, p, q) => ({ ri, a, own: null, c: p[a], lo: Math.min(p[1 - a], q[1 - a]), hi: Math.max(p[1 - a], q[1 - a]) });
  const fine = (ri, list) => list.every(([p, q]) => !blocked(ri, p, q) && !S.some((s) => s.ri !== ri && near(s, seg(ri, Math.abs(p[0] - q[0]) < 0.5 ? 0 : 1, p, q))));
  routes.forEach((pts, ri) => {
    if ((owners[ri] || []).some(Boolean)) return;
    for (let i = 2; i < pts.length - 1; i++) {
      const a0 = pts[i - 2], u = pts[i - 1], v = pts[i], b1 = pts[i + 1], dy = v[1] - u[1];
      if (Math.abs(u[0] - v[0]) > 0.5 || Math.abs(dy) < 0.5 || Math.abs(dy) > 48) continue;
      if (Math.abs(a0[1] - u[1]) > 0.5 || Math.abs(b1[1] - v[1]) > 0.5 || Math.sign(u[0] - a0[0]) !== Math.sign(b1[0] - v[0])) continue;
      const last = pts.length - 1;
      // the later run up (or down) to the earlier one's height, or the earlier one to the later one's
      if (i + 1 < last) {
        const nb = [b1[0], u[1]], c2 = pts[i + 2];
        if (fine(ri, [[u, nb], [nb, c2]])) { v[1] = u[1]; b1[1] = u[1]; continue; }
      }
      if (i - 2 >= 1) {
        const na = [a0[0], v[1]], c0 = pts[i - 3];
        if (fine(ri, [[na, v], [c0, na]])) { a0[1] = v[1]; u[1] = v[1]; }
      }
    }
  });
}
// each arrow leaves and enters the sides that face each other; arrows sharing a side spread along it, in the
// order of where their other ends are, so they don't stack (7.3)
// the three points on each side of a box where square-cornered arrows leave and enter (they show as dots)
export const portYs = (h) => { const st = Math.min(18, (h - 16) / 2); return [h / 2 - st, h / 2, h / 2 + st]; };
export function arrowGeo(E, boxOf, sideFn) {
  return spreadEnds(E.map((e) => { const a = boxOf(e.from), b = boxOf(e.to); return { e, a, b, s: sideFn(a, b), fa: 0.5, fb: 0.5 }; }));
}
// (bus: per side key, the arrows that run as one line there; they share one point on that side)
export function spreadEnds(geo, bus, ports) {
  const slots = new Map();
  geo.forEach((g) => {
    [[g.e.from, g.s[0], g.b, 0], [g.e.to, g.s[1], g.a, 1]].forEach(([k, side, other, end]) => {
      const key = k + '|' + side;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push({ g, end, at: side === 'l' || side === 'r' ? other.y + other.h / 2 : other.x + other.w / 2 });
    });
  });
  slots.forEach((list, key) => {
    const bs = (bus && bus.get(key)) || [], b = bs.length;
    // a bus counts as one, where the middle of its arrows' other ends is
    let items = list.map((it) => ({ at: it.at, its: [it] }));
    bs.forEach((set) => {
      const mine = items.filter((x) => x.its.length === 1 && set.has(x.its[0].g)), ats = mine.map((x) => x.at).sort((p, q) => p - q);
      if (mine.length) items = items.filter((x) => !mine.includes(x)).concat([{ at: ats[Math.floor(ats.length / 2)], its: mine.map((x) => x.its[0]) }]);
    });
    if (items.length < 2 && !b) return;
    items.sort((x, y) => x.at - y.at);
    const g0 = list[0].g, box = list[0].end === 0 ? g0.a : g0.b, side = key.slice(key.lastIndexOf('|') + 1), H = side === 'l' || side === 'r' ? box.h : box.w;
    // at the side's three points (one arrow in the middle, two at the outer ones) when they fit there,
    // otherwise evenly along the side, up to 18 px apart, clear of its corners
    const P = portYs(H), at = ports && (side === 'l' || side === 'r') && items.length <= 3 ? (items.length === 1 ? [P[1]] : items.length === 2 ? [P[0], P[2]] : P) : null;
    const step = items.length > 1 ? Math.min(18, (H - 16) / (items.length - 1)) : 0, top = H / 2 - (step * (items.length - 1)) / 2;
    items.forEach((x, i) => { const f = (at ? at[i] : top + step * i) / H; x.its.forEach((it) => { if (it.end === 0) it.g.fa = f; else it.g.fb = f; }); });
  });
  return geo;
}
// the square-cornered arrows for all of geo: corner points per arrow, and which trunk each end is part of.
// short: where lanes had to be squeezed closer than SEP (for the automatic layout to widen those gaps)
export function orthoAll(geo, wayOf, boxes, short) {
  // boxes stacked in a column with something between them are joined right side to left side instead
  let swapped = false;
  geo.forEach((g) => {
    if (g.s[0] !== 'b' && g.s[0] !== 't') return;
    const r = orthoRoute(g.a, g.b, g.s, 0.5, 0.5, null, boxes);
    if (r.length > 4) { g.s = ['r', 'l']; swapped = true; }
  });
  if (swapped) { geo.forEach((g) => { g.fa = 0.5; g.fb = 0.5; }); spreadEnds(geo); }
  // up to three arrows leave (or enter) one side of a box at points of their own; more than that share three
  // points, the arrows at each running as one line that branches, a bus, with a dot at each branch. A bus holds
  // one kind of arrow, and an arrow is in one bus at most (the bigger), so two buses never share a line.
  const sideOf = new Map();
  geo.forEach((g) => {
    [['out:' + g.e.from, g.s[0] === 'r', g.b], ['in:' + g.e.to, g.s[1] === 'l', g.a]].forEach(([k, ok, other]) => {
      if (!ok) return;
      if (!sideOf.has(k)) sideOf.set(k, []);
      sideOf.get(k).push({ g, at: other.y + other.h / 2 });
    });
  });
  let buses = new Map();
  sideOf.forEach((list, k) => {
    if (list.length <= 3) return;
    list.sort((p, q) => p.at - q.at);
    // three points shared out between the kinds there by how many each has (each kind gets one at least), each
    // kind's arrows split between its points in the order of their other ends
    const byRole = new Map();
    list.forEach((x) => { if (!byRole.has(x.g.e.role)) byRole.set(x.g.e.role, []); byRole.get(x.g.e.role).push(x.g); });
    const roles = [...byRole.entries()].sort((p, q) => q[1].length - p[1].length), pts = roles.map(() => 1);
    for (let left = 3 - roles.length, j = 0; left > 0; left--, j = (j + 1) % roles.length) if (roles[j][1].length > pts[j]) pts[j]++;
    roles.forEach(([role, gs], j) => {
      for (let q = 0; q < pts[j]; q++) {
        const set = new Set(gs.slice(Math.round((q * gs.length) / pts[j]), Math.round(((q + 1) * gs.length) / pts[j])));
        if (set.size >= 2) buses.set(k + '#' + role + q, set);
      }
    });
  });
  for (let pass = 0; pass < 2; pass++) {
    const of = (g) => [...buses].filter(([, set]) => set.has(g));
    geo.forEach((g) => { const in2 = of(g); if (in2.length > 1) in2.sort((p, q) => q[1].size - p[1].size).slice(1).forEach(([, set]) => set.delete(g)); });
    buses = new Map([...buses].filter(([, set]) => set.size >= 2));
  }
  const owners = geo.map((g) => {
    const o = [null, null];
    buses.forEach((set, k) => { if (set.has(g)) o[k.startsWith('out:') ? 0 : 1] = k; });
    return o;
  });
  // per side of a box, the buses there
  const sideBus = new Map();
  buses.forEach((set, k) => {
    const key = (k.startsWith('out:') ? k.slice(4, k.lastIndexOf('#')) + '|r' : k.slice(3, k.lastIndexOf('#')) + '|l');
    if (!sideBus.has(key)) sideBus.set(key, []);
    sideBus.get(key).push(set);
  });
  geo.forEach((g) => { g.fa = 0.5; g.fb = 0.5; });
  spreadEnds(geo, sideBus, true);
  const ways = geo.map((g) => wayOf(g.e, g.s)), routes = geo.map((g, i) => orthoRoute(g.a, g.b, g.s, g.fa, g.fb, ways[i], boxes));
  // the automatic layout's slots for arrows passing a column bound the gaps either side of them like boxes do
  const slotBoxes = ways.flat().filter(Boolean).map((w) => ({ x: w[0] - (w[2] || NW / 2), y: w[1] - 12, w: 2 * (w[2] || NW / 2), h: 24 }));
  laneSpread(routes, owners, boxes.concat(slotBoxes), short);
  untangle(routes, owners, geo.map((g) => [g.a, g.b]), boxes);
  const R = routes.map((pts) => {
    const q = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
    // (and no corner where a run just carries on)
    return q.filter((p, i) => i === 0 || i === q.length - 1 || !((Math.abs(q[i - 1][0] - p[0]) < 0.5 && Math.abs(q[i + 1][0] - p[0]) < 0.5) || (Math.abs(q[i - 1][1] - p[1]) < 0.5 && Math.abs(q[i + 1][1] - p[1]) < 0.5)));
  });
  const bd = busDots(R, owners, geo);
  return { routes: R, owners, dots: bd.dots, tags: bd.tags, hops: hopsOf(R, owners) };
}
// a dot where a bus branches (or is joined), as on a wiring diagram: where lines cross without one, they don't meet
// arrows that share a line each get a letter of their own in the function (tag: 0 for A, 1 for B, …), shown at the two
// places they stand apart: where they branch off the shared line, and beside the point on the box at their own end
export function busDots(routes, owners, geo) {
  const by = new Map();
  routes.forEach((pts, ri) => {
    (owners[ri] || []).forEach((own, end) => {
      if (!own) return;
      let v = -1;
      for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5 && Math.abs(pts[i - 1][1] - pts[i][1]) > 0.5) { v = i; if (end === 0) break; }
      if (!by.has(own)) by.set(own, { own, role: geo[ri].e.role, x: null, ys: [], ms: [] });
      const b = by.get(own);
      // where it leaves (or joins) the shared line; a member with no turn does so where it runs straight through
      const turn = v < 0 ? pts[0][1] : end === 0 ? pts[v][1] : pts[v - 1][1];
      // its own end: the far end of an arrow out of a shared point, the start of one into it
      const far = end === 0 ? pts[pts.length - 1] : pts[0];
      b.ms.push({ ri, turn, far });
      if (v < 0) { b.ys.push(pts[0][1]); return; }
      b.x = pts[v][0];
      b.ys.push(pts[v - 1][1], pts[v][1]);
    });
  });
  const dots = [], tags = new Map();
  // A, B, C… across the whole function, so no two arrows near each other share one: line by line from the top,
  // and down each line in the order their own ends sit, so the letters read in order at both ends
  let next = 0;
  const top = (b) => Math.min(...b.ms.map((m) => m.far[1]));
  [...by.values()].sort((p, q) => top(p) - top(q) || (p.x == null ? 0 : p.x) - (q.x == null ? 0 : q.x)).forEach((b) => {
    b.ms.sort((p, q) => p.far[1] - q.far[1] || p.turn - q.turn).forEach((m) => { m.tag = next++; tags.set(m.ri, { tag: m.tag, own: b.own, far: m.far, role: b.role }); });
    if (b.x == null) return;
    const lo = Math.min(...b.ys), hi = Math.max(...b.ys), seen = [];
    b.ms.forEach((m) => {
      if (m.turn <= lo + 1 || m.turn >= hi - 1 || seen.some((z) => Math.abs(z - m.turn) < 1)) return;
      seen.push(m.turn);
      dots.push({ x: b.x, y: m.turn, role: b.role, own: b.own, tag: m.tag, ri: m.ri });
    });
    // where the shared line itself splits, up and down, a plain dot in the colour of its kind
    b.ys.forEach((y) => {
      if (y <= lo + 1 || y >= hi - 1 || seen.some((z) => Math.abs(z - y) < 1)) return;
      seen.push(y);
      dots.push({ x: b.x, y, role: b.role, own: b.own, tag: null, ri: b.ms[0].ri });
    });
  });
  return { dots, tags };
}
// where a level run crosses another arrow's upright run, it hops over it: per arrow, the runs and their hops, each
// [from, to] along the run (crossings closer together than a hop share one wider arch). A hop can come up to
// just short of a turn: the turn is drawn tighter there to make room.
export function hopsOf(routes, owners) {
  const ups = [];
  routes.forEach((pts, ri) => { for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5) ups.push({ ri, x: pts[i][0], lo: Math.min(pts[i - 1][1], pts[i][1]), hi: Math.max(pts[i - 1][1], pts[i][1]) }); });
  return routes.map((pts, ri) => {
    const out = new Map(), mine = owners[ri] || [];
    for (let i = 1; i < pts.length; i++) {
      const u = pts[i - 1], v = pts[i];
      if (Math.abs(u[1] - v[1]) > 0.5) continue;
      const lo = Math.min(u[0], v[0]) + HOP + 3, hi = Math.max(u[0], v[0]) - HOP - 3, xs = [];
      ups.forEach((w) => {
        if (w.ri === ri || w.x <= lo || w.x >= hi || u[1] <= w.lo + 2 || u[1] >= w.hi - 2) return;
        if ((owners[w.ri] || []).some((o) => o && mine.includes(o))) return;
        xs.push(w.x);
      });
      if (!xs.length) continue;
      const dir = v[0] > u[0] ? 1 : -1, spans = [];
      xs.sort((p, q) => (p - q) * dir).forEach((x) => {
        const last = spans[spans.length - 1];
        if (last && Math.abs(x - last[1]) <= 2 * HOP + 4) last[1] = x; else spans.push([x, x]);
      });
      out.set(i, spans);
    }
    return out;
  });
}
// a path through the corner points with small rounded turns; mid is halfway along it
// (hops: per run, where it hops over other arrows)
export function roundPath(pts, hops) {
  const P = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  const fmt = (p) => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`;
  let d = `M${fmt(P[0])}`, total = 0;
  const lens = P.map((p, i) => (i ? Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0));
  // each turn's radius, tighter where a hop sits close to it
  const r = P.map((p, i) => (i > 0 && i < P.length - 1 ? Math.min(RAD, lens[i] / 2, lens[i + 1] / 2) : 0));
  if (hops) hops.forEach((spans, i) => {
    if (!spans.length) return;
    const a = P[i - 1], c = P[i];
    if (i - 1 > 0) r[i - 1] = Math.max(2, Math.min(r[i - 1], Math.abs(spans[0][0] - a[0]) - HOP - 1));
    if (i < P.length - 1) r[i] = Math.max(2, Math.min(r[i], Math.abs(c[0] - spans[spans.length - 1][1]) - HOP - 1));
  });
  // an arch, bulging up, over each crossing (or close group of them) on run i
  const hop = (i) => {
    const spans = hops && hops.get(i), a = P[i - 1], c = P[i];
    if (!spans) return;
    const dir = c[0] > a[0] ? 1 : -1;
    spans.forEach(([x0, x1]) => { d += ` L${fmt([x0 - dir * HOP, a[1]])} A${Math.abs(x1 - x0) / 2 + HOP},${HOP} 0 0 ${dir > 0 ? 1 : 0} ${fmt([x1 + dir * HOP, a[1]])}`; });
  };
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], c = P[i], e = P[i + 1];
    const u = [(c[0] - a[0]) / lens[i], (c[1] - a[1]) / lens[i]], w = [(e[0] - c[0]) / lens[i + 1], (e[1] - c[1]) / lens[i + 1]];
    hop(i);
    d += ` L${fmt([c[0] - u[0] * r[i], c[1] - u[1] * r[i]])} Q${fmt(c)} ${fmt([c[0] + w[0] * r[i], c[1] + w[1] * r[i]])}`;
  }
  hop(P.length - 1);
  d += ` L${fmt(P[P.length - 1])}`;
  lens.forEach((l) => { total += l; });
  let half = total / 2, mid = P[0];
  for (let i = 1; i < P.length; i++) { if (half <= lens[i]) { const t = half / lens[i]; mid = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; break; } half -= lens[i]; }
  return { d, mid };
}

/* ---------- highlighting around a selected box (7.1) ---------- */
// mode: chain (causes both ways, plus whatever sets what the box checks), up, down, both, off;
// depth: arrows away from the box, 1 to 6, or 0 for all. Returns distance per lit box and the lit arrows.
export function focusSet(edges, k, mode, depth) {
  const dist = new Map([[k, 0]]), lit = new Set();
  if (mode === 'off') return { dist, edges: lit };
  const max = depth > 0 && mode !== 'chain' ? depth : Infinity;
  const walk = (fwd, follow) => {
    const d = new Map([[k, 0]]), q = [k];
    while (q.length) {
      const u = q.shift(), du = d.get(u);
      if (du >= max) continue;
      for (const e of edges) {
        if ((fwd ? e.from : e.to) !== u || !follow(e, u)) continue;
        const v = fwd ? e.to : e.from;
        lit.add(e.id);
        if (!d.has(v)) { d.set(v, du + 1); q.push(v); }
      }
    }
    d.forEach((x, n) => { if (!dist.has(n) || dist.get(n) > x) dist.set(n, x); });
  };
  if (mode === 'chain') {
    walk(true, (e, u) => e.role !== 'condition' || u === k);  // what it sets off; what it is checked by, one step
    walk(false, () => true);                                   // what sets it off, and what sets what it checks
  } else {
    if (mode === 'down' || mode === 'both') walk(true, () => true);
    if (mode === 'up' || mode === 'both') walk(false, () => true);
  }
  return { dist, edges: lit };
}
