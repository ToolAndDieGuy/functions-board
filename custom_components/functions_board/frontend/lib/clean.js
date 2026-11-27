import { EXACT_RE, SAFE_ID, cleanTest } from './constants.js';
import { T } from './i18n.js';
import { cleanCheck } from './sandbox.js';
import { cleanNotify } from './builders.js';

// drawn to numbers, short strings and safe ids, and leave keys this version doesn't know alone
export function cleanLayout(L) {
  const src = L && typeof L === 'object' && !Array.isArray(L) ? L : {};
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.round(+v) : d);
  const out = Object.assign({}, src, { nodes: {}, frames: [], notes: [] });
  Object.entries(src.nodes && typeof src.nodes === 'object' ? src.nodes : {}).forEach(([k, p]) => {
    if (p && typeof p === 'object' && k.length < 300) out.nodes[k] = { x: num(p.x, 0), y: num(p.y, 0) };
  });
  (Array.isArray(src.frames) ? src.frames : []).forEach((f) => {
    if (!f || !SAFE_ID.test(String(f.id))) return;
    out.frames.push({ id: String(f.id), title: String(f.title == null ? T('frame') : f.title).slice(0, 200), x: num(f.x, 0), y: num(f.y, 0), w: Math.max(200, num(f.w, 540)), h: Math.max(120, num(f.h, 340)) });
  });
  (Array.isArray(src.notes) ? src.notes : []).forEach((n) => {
    if (!n || !SAFE_ID.test(String(n.id))) return;
    out.notes.push({ id: String(n.id), text: String(n.text == null ? '' : n.text).slice(0, 10000), x: num(n.x, 0), y: num(n.y, 0), w: Math.max(120, num(n.w, 240)) });
  });
  // which way the function flows: left to right (the default) or top to bottom
  if (src.dir != null) out.dir = src.dir === 'down' ? 'down' : 'right';
  // boxes Auto-arrange leaves where they are
  if (src.keep != null) out.keep = Array.isArray(src.keep) ? src.keep.filter((k) => typeof k === 'string' && k.length < 300).slice(0, 2000) : [];
  if (out.paused != null) out.paused = Array.isArray(out.paused) ? out.paused.filter((x) => typeof x === 'string') : null;
  if (out.categories != null && typeof out.categories !== 'object') out.categories = null;
  // dismissed problems (0.9.0): what, when, and since when it's been gone
  if (src.dismissed != null) {
    out.dismissed = (Array.isArray(src.dismissed) ? src.dismissed : []).filter((d) => d && typeof d.k === 'string' && d.k.length < 400).slice(0, 500)
      .map((d) => Object.assign({ k: d.k, at: num(d.at, 0) }, d.gone ? { gone: num(d.gone, 0) } : {}, d.ever ? { ever: true } : {}));
  }
  // saved sandbox checks (0.9.0)
  if (src.checks != null) out.checks = (Array.isArray(src.checks) ? src.checks : []).slice(0, 50).map(cleanCheck).filter(Boolean);
  // test buttons and monitor boxes (Phase 9): only what they can be
  if (src.tools != null) {
    out.tools = [];
    (Array.isArray(src.tools) ? src.tools : []).slice(0, 100).forEach((t) => {
      if (!t || !SAFE_ID.test(String(t.id)) || (t.type !== 'inject' && t.type !== 'monitor')) return;
      const o = { id: String(t.id), type: t.type, title: String(t.title == null ? '' : t.title).slice(0, 160) };
      if (t.type === 'inject') { o.test = cleanTest(t.test); if (!o.test) return; }
      else {
        o.what = t.what === 'mqtt' ? 'mqtt' : 'event';
        o.topic = String(t.topic == null ? '' : t.topic).slice(0, 255);
        o.target = typeof t.target === 'string' && t.target.length < 300 ? t.target : null;
        if (!o.topic) return;
      }
      out.tools.push(o);
    });
  }
  // builders (0.11.3): the spec each script made by a builder was made from, by its entity id
  if (src.builders != null) {
    out.builders = {};
    Object.entries(src.builders && typeof src.builders === 'object' && !Array.isArray(src.builders) ? src.builders : {}).slice(0, 200).forEach(([k, b]) => {
      if (k.startsWith('script.') && EXACT_RE.test(k) && b && b.kind === 'notify') out.builders[k] = { kind: 'notify', spec: cleanNotify(b.spec) };
    });
  }
  return out;
}
