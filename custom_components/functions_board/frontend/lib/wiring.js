import { ACTION_KEYS, CLIST_KEYS, COLG, COND_KEYS, COND_TYPES, ENTITY_RE, EXACT_RE, HELPER_DOMAINS, REGID_RE, ROWG, SKIP_KEYS, TPL_RE, getPath, shorten, toList } from './constants.js';
import { PROTO, SEP, STUB, arrowGeo, orderLanes, orthoAll, orthoSides } from './geometry.js';
import { P, T } from './i18n.js';

/* ---------- config analysis: what does an automation/script read, wait on, change, call ---------- */
// Home Assistant 2026.x purpose-specific triggers (light.turned_on, door.opened, counter.incremented...):
// what state or service can fire them, for the loop check
export const PS_TO = { turned_on: ['on'], turned_off: ['off'], opened: ['open', 'opening', 'on'], closed: ['closed', 'closing', 'off'],
  locked: ['locked'], unlocked: ['unlocked'], jammed: ['jammed'] };
// counter triggers fire on the value moving (counter/trigger.py), so set_value and reset can fire them too;
// counter.reset fires whenever the value lands on its initial value, which any change can do
// A light's brightness triggers skip states without a brightness (light/trigger.py: the tracked value is None
// when it's off), so turning it off can't fire them: an automation that turns a light off when it's dimmed
// below a threshold is not a loop
export const PS_SVC = { 'counter.incremented': ['increment', 'set_value', 'reset'], 'counter.decremented': ['decrement', 'set_value', 'reset'],
  'counter.maximum_reached': ['increment', 'set_value', 'reset'], 'counter.minimum_reached': ['decrement', 'set_value', 'reset'],
  'light.brightness_changed': ['turn_on', 'toggle'], 'light.brightness_crossed_threshold': ['turn_on', 'toggle'] };
export const TARGET_KEYS = { area_id: 'area', floor_id: 'floor', label_id: 'label' };
// the event a phone fires when a notification's button is pressed, and the key holding the button's id
export const NOTIFY_EVENTS = { mobile_app_notification_action: 'action', 'ios.notification_action_fired': 'actionName' };
export const TGT_RE = /^(area|floor|label):/;
export function triggerFilter(node, p) {
  const low = (v) => toList(v).map((x) => String(x).toLowerCase());
  if (p === 'state') {
    if (node.attribute != null) return null;  // attribute values aren't entity states
    if (node.to == null && node.not_to == null) return null;
    const f = {};
    if (node.to != null) f.to = low(node.to);
    if (node.not_to != null) f.notTo = low(node.not_to);
    return f;
  }
  if (p === 'event') return { ev: toList(node.event_type).filter((x) => typeof x === 'string') };
  if (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(p)) {
    if (TIMER_EVENTS[p]) return { ev: [p] };
    if (PS_SVC[p]) return { svc: PS_SVC[p] };
    const verb = p.split('.')[1];
    if (PS_TO[verb]) return { to: PS_TO[verb] };
  }
  return null;
}
export function analyze(cfg, isScript, known) {
  const refs = [], badges = new Set();
  let tf = null;     // filter of the trigger being read: { to, notTo } states, { ev } event types or { svc } services
  let kind = null;   // the trigger or condition type being read (light.turned_on, light.is_on, state...)
  let sdom = null;   // the domain of the action being read (light for light.turn_on)
  // for the developer tools (Phase 9): the condition a reference sits in (tested as a whole) and its place among
  // the top-level conditions, the template it was found in, the trigger it belongs to and its place, the action
  let cond = null, cidx = -1, tpl = null, trig = null, tidx = -1, act = null;
  const add = (ref, role, svc, ex) => refs.push({ ref, role, svc: svc || '', tf: role === 'trigger' ? tf : null, kind: role === 'trigger' || role === 'condition' ? kind : null, sdom: role === 'action' || role === 'call' ? sdom : null,
    ex: ex || null, cond: role === 'condition' ? cond : null, cidx: role === 'condition' && cond != null ? cidx : -1, tpl, trig: role === 'trigger' ? trig : null, tidx: role === 'trigger' ? tidx : -1, act: role === 'action' || role === 'call' ? act : null });
  const targets = (obj, role, svc, ex) => Object.entries(TARGET_KEYS).forEach(([k, pre]) => toList(obj && obj[k]).forEach((x) => {
    if (typeof x === 'string' && x && !TPL_RE.test(x)) add(pre + ':' + x, role, svc, ex);
  }));
  const readRole = (mode) => (mode === 'trigger' ? 'trigger' : 'condition');
  const scan = (s, role) => { const t0 = tpl; tpl = s; for (const m of s.matchAll(ENTITY_RE)) { const e = known(m[0]); if (e) add(e, role); } tpl = t0; };
  const ids = (v, role, svc) => toList(v).forEach((x) => {
    if (typeof x !== 'string') return;
    if (TPL_RE.test(x)) { scan(x, role === 'action' || role === 'call' ? 'condition' : role); return; }
    x.split(',').map((s) => s.trim()).forEach((s) => {
      if (EXACT_RE.test(s)) add(s, role, svc);
      else if (REGID_RE.test(s)) { const e = known(s); if (e) add(e, role, svc); }
    });
  });
  // inList: the node is one entry of a list of conditions, where a bare template is a condition of its own
  const walk = (node, mode, inList) => {
    if (node == null) return;
    if (typeof node === 'string') {
      const c0 = cond;
      if (inList && mode === 'condition' && cond == null && TPL_RE.test(node)) cond = node;
      if (TPL_RE.test(node)) scan(node, readRole(mode));
      else if (EXACT_RE.test(node)) { const e = known(node); if (e) add(e, readRole(mode)); }
      cond = c0;
      return;
    }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, mode, inList)); return; }
    if (typeof node !== 'object') return;
    const outerTf = tf, outerKind = kind, outerCond = cond, outerTrig = trig;
    if (mode === 'condition' && typeof node.condition === 'string') kind = node.condition;
    // a condition object, or a condition step among actions: what a test of it right now checks. Only a real
    // condition type: service data can carry a "condition" key of its own (a weather condition, say)
    if ((mode === 'condition' || mode === 'action') && typeof node.condition === 'string' && cond == null && (COND_TYPES.has(node.condition) || EXACT_RE.test(node.condition))) cond = node;
    if (mode === 'trigger' || mode === 'wait') {
      const p = node.trigger || node.platform, rr = mode === 'trigger' ? 'trigger' : 'condition';
      if (typeof p === 'string') { if (mode === 'trigger') { tf = triggerFilter(node, p); if (trig == null) trig = node; } kind = p; }
      const btn = p === 'event' && typeof node.event_type === 'string' && NOTIFY_EVENTS[node.event_type] && node.event_data ? node.event_data[NOTIFY_EVENTS[node.event_type]] : null;
      if (p === 'mqtt' && typeof node.topic === 'string' && !TPL_RE.test(node.topic)) add('mqtt:' + node.topic, rr);
      else if (typeof btn === 'string' && !TPL_RE.test(btn)) add('nact:' + btn, rr);  // answers one notification button (9.5)
      else if (p === 'event' && node.event_type) toList(node.event_type).forEach((t) => typeof t === 'string' && !TPL_RE.test(t) && add('event:' + t, rr));
      if (mode === 'trigger') {
        if (p === 'time' || p === 'time_pattern') badges.add('time');
        else if (p === 'sun') badges.add('sun');
        else if (p === 'homeassistant') badges.add('start');
        else if (p === 'webhook') badges.add('webhook');
        else if (p === 'tag') badges.add('tag');
        else if (p === 'conversation') badges.add('voice');
        else if (p === 'calendar') badges.add('calendar');
      }
    }
    if (mode === 'action') {
      const svc = typeof node.action === 'string' ? node.action : typeof node.service === 'string' ? node.service : null;
      if (svc && TPL_RE.test(svc)) {
        const t = node.target || {}, data = node.data || {}, ex = t && typeof t.exclude === 'object' ? t.exclude : null;
        const outerDom = sdom, outerAct = act;
        sdom = null; act = node;
        scan(svc, 'condition');
        [t.entity_id, node.entity_id, data.entity_id, data.media_player_entity_id].forEach((v) => {
          if (v != null && v !== 'all' && v !== 'none') ids(v, 'action');
        });
        [t.device_id, node.device_id, data.device_id].forEach((v) => toList(v).forEach((x) => {
          if (typeof x === 'string' && !TPL_RE.test(x)) add('device:' + x, 'action');
        }));
        [t, node, data].forEach((o) => targets(o, 'action', '', o === t ? ex : null));
        Object.entries(data).forEach(([k, v]) => {
          if (!['entity_id', 'device_id', 'media_player_entity_id', 'area_id', 'floor_id', 'label_id'].includes(k)) walk(v, 'condition');
        });
        sdom = outerDom; act = outerAct;
        tf = outerTf; kind = outerKind; cond = outerCond; trig = outerTrig;
        return;
      }
      if (svc && svc.includes('.') && !TPL_RE.test(svc)) {
        const i = svc.indexOf('.'), d = svc.slice(0, i), s = svc.slice(i + 1);
        const t = node.target || {}, data = node.data || {}, role = d === 'script' ? 'call' : 'action', ex = t && typeof t.exclude === 'object' ? t.exclude : null;
        const outerDom = sdom, outerAct = act;
        sdom = d; act = node;
        let hit = false;
        [t.entity_id, node.entity_id, data.entity_id, data.media_player_entity_id].forEach((v) => {
          if (v != null && v !== 'all' && v !== 'none') { const n0 = refs.length; ids(v, role, s); if (refs.slice(n0).some((r) => r.role === role)) hit = true; }
        });
        [t.device_id, node.device_id, data.device_id].forEach((v) => toList(v).forEach((x) => {
          if (typeof x === 'string' && !TPL_RE.test(x)) { add('device:' + x, 'action', s); hit = true; }
        }));
        [t, node, data].forEach((o) => { const n0 = refs.length; targets(o, role, s, o === t ? ex : null); if (refs.length > n0) hit = true; });
        if (d === 'script' && !['turn_on', 'turn_off', 'toggle', 'reload'].includes(s)) { add('script.' + s, 'call', 'run'); hit = true; }
        // a message published to a topic goes to that topic's box, as a fired event goes to the event's (0.11.3)
        if (svc === 'mqtt.publish' && typeof data.topic === 'string' && data.topic && !TPL_RE.test(data.topic)) { add('mqtt:' + data.topic, 'action', s); hit = true; }
        if (!hit) add('svc:' + svc, 'action', s);
        // a notification with buttons: each button is an output of the notification (9.5)
        const acts = d === 'notify' && data.data && Array.isArray(data.data.actions) ? data.data.actions : [];
        acts.forEach((a) => {
          if (!a || typeof a.action !== 'string' || TPL_RE.test(a.action) || a.action === 'URI') return;
          refs.push({ ref: 'nact:' + a.action, role: 'action', svc: 'button', tf: null, kind: null, sdom: null, from: hit ? null : 'svc:' + svc, title: typeof a.title === 'string' ? a.title : null });
        });
        Object.entries(data).forEach(([k, v]) => {
          if (!['entity_id', 'device_id', 'media_player_entity_id', 'area_id', 'floor_id', 'label_id'].includes(k)) walk(v, 'condition');
        });
        sdom = outerDom; act = outerAct;
        tf = outerTf; kind = outerKind; cond = outerCond; trig = outerTrig;
        return;
      }
      if (typeof node.event === 'string' && node.trigger == null && node.platform == null) add('event:' + node.event, 'action', 'fire');
      if (typeof node.scene === 'string') add(node.scene, 'action', 'activate');
      if (typeof node.device_id === 'string' && node.domain && node.type && node.condition == null) {
        add('device:' + node.device_id, 'action', String(node.type));
        return;
      }
    }
    const exHere = node && typeof node.exclude === 'object' ? node.exclude : null;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'exclude') continue;
      if (k === 'entity_id') { ids(v, mode === 'action' ? 'condition' : readRole(mode)); continue; }
      if (TARGET_KEYS[k] && mode !== 'action') { targets({ [k]: v }, mode === 'trigger' ? 'trigger' : 'condition', '', exHere); continue; }
      if (k === 'device_id') {
        toList(v).forEach((x) => typeof x === 'string' && add('device:' + x, mode === 'action' ? 'condition' : readRole(mode)));
        continue;
      }
      if (SKIP_KEYS.has(k) && typeof v === 'string') continue;
      let m = mode;
      if (k === 'wait_for_trigger') m = 'wait';
      else if (mode !== 'trigger' && mode !== 'wait' && COND_KEYS.has(k)) m = 'condition';
      if (mode !== 'trigger' && mode !== 'wait' && (ACTION_KEYS.has(k) || (k === 'action' && typeof v !== 'string'))) m = 'action';
      walk(v, m, m === 'condition' && CLIST_KEYS.has(k));
    }
    tf = outerTf; kind = outerKind; cond = outerCond; trig = outerTrig;
  };
  if (isScript) { walk(cfg.sequence, 'action'); walk(cfg.variables, 'condition'); }
  else {
    toList(cfg.triggers != null ? cfg.triggers : cfg.trigger).forEach((t, i) => { tidx = i; walk(t, 'trigger'); });
    tidx = -1;
    toList(cfg.conditions != null ? cfg.conditions : cfg.condition).forEach((c, i) => { cidx = i; walk(c, 'condition', true); });
    cidx = -1;
    walk(cfg.actions != null ? cfg.actions : cfg.action, 'action');
    walk(cfg.variables, 'condition');
  }
  return { refs, badges };
}

/* ---------- problems (0.9.0): what a function's automations and scripts point at that isn't there or can't work.
   Home Assistant doesn't say when an entity is renamed or removed under an automation, a device is gone, or a
   service no longer exists; the automation just stops doing its job. This reads what analyze() found.
     items: [{ key, refs }] the function's automations and scripts, with analyze()'s refs
     members: the keys of everything in the function
     ctx: { state(id), ent(id), dev(id), area(id), floor(id), label(id), service(domain, service), paused }
   Returns [{ sev: 'error'|'warn', kind, ref, by: [item keys] }], errors first, one per thing. ---------- */
// dismissed problems (0.9.0). A problem is known by what's wrong and with what (not by which automations use it).
// A dismissal lasts while its problem is there, and is forgotten once the problem has been gone for a day, so a
// problem that comes back later shows again. covers(key): which problems this list is complete for (the rest
// are left as they are). One ignored for good (ever, 0.11.1) is never forgotten and shows nowhere, not even
// among the dismissed.
export const PROB_FORGET_MS = 24 * 3600 * 1000;
export const probKey = (p) => p.kind + '|' + p.ref;
export function splitDismissed(problems, dismissed, now, covers) {
  const list = Array.isArray(dismissed) ? dismissed : [], have = new Set(problems.map(probKey)), out = [];
  let changed = false;
  list.forEach((d) => {
    if (d.ever) { out.push(d); return; }
    if (!covers || covers(d.k)) {
      if (have.has(d.k)) { if (d.gone) { d = { k: d.k, at: d.at }; changed = true; } }
      else if (!d.gone) { d = { k: d.k, at: d.at, gone: now }; changed = true; }
      else if (now - d.gone > PROB_FORGET_MS) { changed = true; return; }
    }
    out.push(d);
  });
  const off = new Set(out.filter((d) => !d.ever).map((d) => d.k)), ever = new Set(out.filter((d) => d.ever).map((d) => d.k));
  return { shown: problems.filter((p) => !off.has(probKey(p)) && !ever.has(probKey(p))), hidden: problems.filter((p) => off.has(probKey(p)) && !ever.has(probKey(p))), ignored: problems.filter((p) => ever.has(probKey(p))), dismissed: out, changed };
}
// the boxes and arrows a function's problems are about: a box takes its worst one; an arrow is marked when an end
// of it is gone
export function markProblems(nodes, edges, problems) {
  const worst = new Map(), mark = (k, sev) => { if (worst.get(k) !== 'error') worst.set(k, sev); };
  problems.forEach((pr) => {
    mark(pr.ref, pr.sev);
    if (pr.kind === 's_missing' && nodes.has('svc:' + pr.ref)) mark('svc:' + pr.ref, pr.sev);
    pr.by.forEach((b) => mark(b, pr.sev));
  });
  nodes.forEach((n, k) => { n.prob = worst.get(k) || null; });
  const gone = new Set();
  problems.forEach((pr) => {
    if (pr.sev !== 'error') return;
    if (!/^(m_|s_)/.test(pr.kind)) gone.add(pr.ref);
    else if (pr.kind === 's_missing' && nodes.has('svc:' + pr.ref)) gone.add('svc:' + pr.ref);
  });
  edges.forEach((e) => { e.prob = gone.has(e.from) || gone.has(e.to); });
}
// an automation's state triggers that start both ways (0.11.1): From lists two or more states and there's no To (nor
// Not to, nor an attribute), so a change from any of them to another starts it: from [off, on] fires on off → on and
// on → off alike. It may be meant; it's said as a fact, and can be dismissed. [{ ents, from }]
export function bothWays(cfg) {
  const out = [];
  const trigs = cfg && !Array.isArray(cfg) ? toList(cfg.triggers || cfg.trigger) : [];
  trigs.forEach((t) => {
    if (!t || typeof t !== 'object' || t.enabled === false || (t.trigger || t.platform) !== 'state' || t.from == null) return;
    if (t.to != null || t.not_to != null || t.attribute != null) return;
    const from = [...new Set(toList(t.from).filter((x) => x != null && typeof x !== 'object').map(String))];
    const ents = toList(t.entity_id).filter((x) => typeof x === 'string');
    if (from.length >= 2 && !from.some((x) => TPL_RE.test(x)) && ents.length) out.push({ ents, from });
  });
  return out;
}
export function findProblems(items, members, ctx) {
  const out = new Map();
  const add = (sev, kind, ref, by) => {
    const k = kind + '|' + ref, p = out.get(k) || { sev, kind, ref, by: [] };
    if (by && !p.by.includes(by)) p.by.push(by);
    out.set(k, p);
    return p;
  };
  const entity = (id, by) => {
    const st = ctx.state(id), reg = ctx.ent(id);
    if (reg && reg.disabled_by) add('warn', 'e_disabled', id, by);
    else if (!st && !reg) add('error', 'e_missing', id, by);
    else if (!st) add('error', 'e_notloaded', id, by);
    else if (st.state === 'unavailable') add('warn', 'e_unavail', id, by);
  };
  for (const it of items) {
    for (const r of it.refs || []) {
      const ref = r.ref;
      if (ref === it.key) continue;
      if (ref.startsWith('device:')) {
        const d = ctx.dev(ref.slice(7));
        if (!d) add('error', 'd_missing', ref, it.key);
        else if (d.disabled_by) add('warn', 'd_disabled', ref, it.key);
      } else if (TGT_RE.test(ref)) {
        const i = ref.indexOf(':'), kind = ref.slice(0, i), id = ref.slice(i + 1);
        if (!ctx[kind](id)) add('error', 't_missing', ref, it.key);
      } else if (ref.startsWith('svc:')) {
        const svc = ref.slice(4), i = svc.indexOf('.');
        if (i > 0 && !ctx.service(svc.slice(0, i), svc.slice(i + 1))) add('error', 's_missing', svc, it.key);
      } else if (EXACT_RE.test(ref)) {
        entity(ref, it.key);
      }
      // the service an action calls (targets checked above): it must exist for the step to run
      const a = r.act, svc = a && typeof (a.action || a.service) === 'string' ? a.action || a.service : null;
      if (svc && !TPL_RE.test(svc) && svc.includes('.') && (r.role === 'action' || r.role === 'call')) {
        const i = svc.indexOf('.');
        if (!ctx.service(svc.slice(0, i), svc.slice(i + 1))) add('error', 's_missing', svc, it.key);
      }
    }
  }
  // automations that start both ways (see bothWays)
  for (const it of items) (it.both || []).forEach((b) => { const p = add('warn', 't_both', it.key, null); if (!p.ents) Object.assign(p, { ents: b.ents, from: b.from }); });
  // the function's own pieces
  for (const k of members) {
    if (k.startsWith('device:')) { const d = ctx.dev(k.slice(7)); if (d && d.disabled_by) add('warn', 'd_disabled', k, null); continue; }
    const st = ctx.state(k), reg = ctx.ent(k);
    if (reg && reg.disabled_by) { add('warn', 'e_disabled', k, null); continue; }
    if (!st) continue;
    if ((k.startsWith('automation.') || k.startsWith('script.')) && st.state === 'unavailable') add('error', 'm_broken', k, null);
    else if (k.startsWith('automation.') && st.state === 'off' && !ctx.paused) add('warn', 'm_off', k, null);
    else if (st.state === 'unavailable') add('warn', 'e_unavail', k, null);
  }
  return [...out.values()].sort((x, y) => (x.sev === y.sev ? 0 : x.sev === 'error' ? -1 : 1));
}

/* ---------- layered layout (left to right): inputs -> logic -> outputs ---------- */
// wrap (top to bottom only): the most a row may span, in px. Boxes stand side by side there, so a script that
// drives thirty things would make one row thirty boxes wide; its end points (nothing comes after them) move down
// a row instead, as many as it takes
export function layeredOnce(keys, edges, size, gapMin, wrap) {
  const n = keys.length, idx = new Map(keys.map((k, i) => [k, i]));
  const out = Array.from({ length: n }, () => []), inc = Array.from({ length: n }, () => []);
  edges.forEach((e) => {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null || a === b) return;
    out[a].push(b); inc[b].push(a);
  });
  const st = new Array(n).fill(0), back = new Set();
  const dfs = (u) => {
    st[u] = 1;
    for (const v of out[u]) { if (st[v] === 1) back.add(u * n + v); else if (!st[v]) dfs(v); }
    st[u] = 2;
  };
  const trig = new Set(edges.filter((e) => e.role === 'trigger').map((e) => e.from));
  const world = (k) => trig.has(k) && !/^(automation|script)\./.test(k) && !HELPER_DOMAINS.has(k.split('.')[0]);
  for (let i = 0; i < n; i++) if (world(keys[i]) && !st[i]) dfs(i);
  for (let i = 0; i < n; i++) if (!inc[i].length && !st[i]) dfs(i);
  for (let i = 0; i < n; i++) if (!st[i]) dfs(i);
  const fwd = (u, v) => !back.has(u * n + v);
  const L = new Array(n).fill(0);
  for (let it = 0; it < n; it++) {
    let ch = false;
    for (let u = 0; u < n; u++) for (const v of out[u]) if (fwd(u, v) && L[v] < L[u] + 1) { L[v] = L[u] + 1; ch = true; }
    if (!ch) break;
  }
  for (let u = 0; u < n; u++) {
    const ins = inc[u].filter((w) => fwd(w, u)), outs = out[u].filter((v) => fwd(u, v));
    if (!ins.length && outs.length) L[u] = Math.max(0, Math.min(...outs.map((v) => L[v])) - 1);
  }
  if (wrap) {
    const ends = (u) => !out[u].some((v) => fwd(u, v)), wired = (u) => out[u].length || inc[u].length;
    for (let l = 0; l <= Math.max(0, ...L); l++) {
      const ly = [];
      for (let u = 0; u < n; u++) if (L[u] === l && wired(u)) ly.push(u);
      let ext = ly.reduce((s, u) => s + size(keys[u]).h + 30, 0);
      const movable = ly.filter(ends);
      for (let j = movable.length - 1; j >= 0 && ext > wrap; j--) { L[movable[j]] = l + 1; ext -= size(keys[movable[j]]).h + 30; }
    }
    // and its starting points (nothing comes before them: thirty inputs read by one automation) move up a row
    const starts = (u) => !inc[u].some((w) => fwd(w, u));
    for (let l = Math.max(0, ...L); l >= Math.min(0, ...L) - n; l--) {
      const ly = [];
      for (let u = 0; u < n; u++) if (L[u] === l && wired(u)) ly.push(u);
      if (!ly.length && l < Math.min(...L)) break;
      let ext = ly.reduce((s, u) => s + size(keys[u]).h + 30, 0);
      const movable = ly.filter((u) => starts(u) && !ends(u));
      for (let j = movable.length - 1; j >= 0 && ext > wrap; j--) { L[movable[j]] = l - 1; ext -= size(keys[movable[j]]).h + 30; }
    }
    const lo = Math.min(0, ...L);
    if (lo < 0) for (let u = 0; u < n; u++) L[u] -= lo;
  }
  // boxes with no arrows at all go in a grid under the wired part instead of one tall first column
  const lone = [];
  for (let i = 0; i < n; i++) if (!out[i].length && !inc[i].length) lone.push(i);
  const isLone = new Set(lone);
  const maxL = n ? Math.max(...L) : 0;
  // placeholders: an arrow that skips columns gets a 24 px slot in each column it passes, so the ordering
  // keeps its way clear and it is drawn through those slots, not behind the boxes in between (4.3)
  const DH = 24, Lx = L.slice(), ii = inc.map((x) => x.slice()), oo = out.map((x) => x.slice()), chains = new Map();
  for (let u = 0; u < n; u++) for (const v of out[u]) {
    if (!fwd(u, v) || L[v] - L[u] < 2) continue;
    const chain = [];
    let prev = u;
    for (let l = L[u] + 1; l < L[v]; l++) { const d = Lx.length; Lx.push(l); ii.push([prev]); oo.push([]); oo[prev].push(d); chain.push(d); prev = d; }
    oo[prev].push(v); ii[v].push(prev);
    oo[u].splice(oo[u].indexOf(v), 1); ii[v].splice(ii[v].indexOf(u), 1);
    chains.set(keys[u] + '>' + keys[v], chain);
  }
  const all = Lx.length, hOf = (u) => (u < n ? size(keys[u]).h : DH), wOf = (u) => (u < n ? size(keys[u]).w : 0);
  const layers = Array.from({ length: maxL + 1 }, () => []);
  for (let i = 0; i < all; i++) if (i >= n || !isLone.has(i)) layers[Lx[i]].push(i);
  const pos = new Array(all).fill(0);
  const setPos = (ly) => ly.forEach((u, j) => { pos[u] = j; });
  layers.forEach(setPos);
  const bary = (ly, nb) => {
    const val = new Map(ly.map((u) => {
      const ns = nb[u];
      return [u, ns.length ? ns.reduce((s, w) => s + pos[w], 0) / ns.length : pos[u]];
    }));
    ly.sort((a, b) => val.get(a) - val.get(b));
    setPos(ly);
  };
  for (let s = 0; s < 6; s++) {
    for (let l = 1; l <= maxL; l++) bary(layers[l], ii);
    for (let l = maxL - 1; l >= 0; l--) bary(layers[l], oo);
  }
  const res = new Map(), at = new Array(all), PR = PROTO();
  const hts = layers.map((ly) => ly.reduce((h, u) => h + hOf(u) + ROWG, -ROWG));
  let H = Math.max(0, ...hts);
  // columns left to right, and each box's top
  const lx = [], cws = [], yv = new Array(all).fill(0);
  if (PR.align) alignY(layers, ii, oo, hOf, yv);
  else layers.forEach((ly, l) => { let y = (H - hts[l]) / 2; ly.forEach((u) => { yv[u] = y; y += hOf(u) + ROWG; }); });
  // each gap between columns is wide enough for the arrows that turn in it to run SEP apart
  const gapW = layers.map(() => COLG);
  if (PR.ortho) {
    // the same lanes the arrows will be drawn in, from each box's middle
    const need = layers.map(() => []), back = layers.map(() => 0), cy = (u) => yv[u] + hOf(u) / 2;
    for (let u = 0; u < all; u++) for (const v of oo[u]) {
      if (Lx[v] !== Lx[u] + 1) continue;
      const own = u < n && oo[u].length >= 5 ? 'o' + u : v < n && ii[v].length >= 5 ? 'i' + v : null;
      if (!own && Math.abs(cy(u) - cy(v)) < 1) continue;
      need[Lx[u]].push({ own, c: 0, lo: Math.min(cy(u), cy(v)), hi: Math.max(cy(u), cy(v)), ats: [[cy(u), -1], [cy(v), 1]] });
    }
    // arrows that go back turn once just after their start and once just before their end
    for (let u = 0; u < n; u++) for (const v of out[u]) if (!fwd(u, v) || L[v] <= L[u]) { back[L[u]]++; if (L[v] > 0) back[L[v] - 1]++; }
    need.forEach((list, l) => {
      const items = [], byOwn = new Map();
      list.forEach((r) => {
        const it = r.own && byOwn.get(r.own);
        if (it) { it.lo = Math.min(it.lo, r.lo); it.hi = Math.max(it.hi, r.hi); it.ats.push(...r.ats); } else { items.push(r); if (r.own) byOwn.set(r.own, r); }
      });
      const k = orderLanes(items) + back[l];
      gapW[l] = Math.max(COLG, 2 * STUB + 24 + (k - 1) * SEP);
    });
  }
  // (wider where the drawn arrows turned out to need it)
  if (gapMin) gapMin.forEach((w, l) => { if (w > gapW[l]) gapW[l] = w; });
  let x = 0;
  // (a column of nothing but slots for passing arrows still gets some width, so the turns either side of it stay apart)
  layers.forEach((ly, l) => { lx[l] = x; cws[l] = ly.length ? Math.max(PR.ortho ? 40 : 0, ...ly.map((u) => wOf(u))) : 0; if (ly.length) x += cws[l] + gapW[l]; });
  // a long run of columns folds into rows that fit a screen, cut where the fewest arrows cross
  const ldx = layers.map(() => 0), ldy = layers.map(() => 0);
  if (PR.bands && maxL >= 3) {
    const GUT = 110, totalW = x - COLG, ys = [...layers.flat()], top = Math.min(...ys.map((u) => yv[u])), bot = Math.max(...ys.map((u) => yv[u] + hOf(u)));
    const R = PR.ratio || 1.7, totalH = bot - top;
    let nb = 1, sc = Infinity;
    // only a function too wide for a screen at full size folds; a short one reads best in one row
    for (let b = 1; b <= (totalW > (PR.wrapAt || 2200) ? 5 : 1); b++) { const v = Math.abs(Math.log((totalW / b) / (b * totalH + (b - 1) * GUT) / R)); if (v < sc) { sc = v; nb = b; } }
    const across = (l) => { let c = 0; for (let u = 0; u < all; u++) for (const v of oo[u]) if (Lx[u] < l && Lx[v] >= l) c++; return c; };
    const cuts = [];
    for (let j = 1; j < nb; j++) {
      const want = (totalW * j) / nb;
      let best = null, bs = Infinity;
      for (let l = 1; l <= maxL; l++) {
        if (cuts.includes(l) || !layers[l].length) continue;
        const v = Math.abs(lx[l] - want) / (totalW / nb) + 0.12 * across(l);
        if (v < bs) { bs = v; best = l; }
      }
      if (best != null) cuts.push(best);
    }
    cuts.sort((p, q) => p - q);
    const starts = [0, ...cuts];
    let prevBot = null;
    starts.forEach((s0, j) => {
      const s1 = j + 1 < starts.length ? starts[j + 1] : maxL + 1, us = [];
      for (let l = s0; l < s1; l++) us.push(...layers[l]);
      if (!us.length) return;
      const t = Math.min(...us.map((u) => yv[u])), b = Math.max(...us.map((u) => yv[u] + hOf(u)));
      const dy = prevBot == null ? -t : prevBot + GUT - t;
      for (let l = s0; l < s1; l++) { ldx[l] = -lx[s0]; ldy[l] = dy; }
      prevBot = b + dy;
    });
  }
  let bottom = 0;
  layers.forEach((ly, l) => {
    if (!ly.length) return;
    const cw = cws[l], X = lx[l] + ldx[l];
    ly.forEach((u) => {
      const y = yv[u] + ldy[l];
      if (u < n) res.set(keys[u], { x: X + (cw - wOf(u)) / 2, y });
      else at[u] = [X + cw / 2, y + DH / 2, cw / 2];
      bottom = Math.max(bottom, y + hOf(u));
    });
  });
  if (PR.align || PR.bands) H = bottom;
  x = Math.max(0, ...layers.map((ly, l) => (ly.length ? lx[l] + ldx[l] + cws[l] + COLG : 0)));
  res.routes = new Map([...chains].map(([k, ch]) => [k, ch.map((d) => at[d])]));
  // the gaps between neighbouring columns of one row, for widening where arrows need it
  res.gapW = gapW;
  res.gaps = [];
  for (let l = 0; l < maxL; l++) {
    if (!layers[l].length || !layers[l + 1].length || ldy[l] !== ldy[l + 1]) continue;
    const x0 = lx[l] + ldx[l] + cws[l], us = layers.filter((_, j) => ldy[j] === ldy[l]).flat();
    res.gaps.push({ l, x0, x1: x0 + gapW[l], y0: Math.min(...us.map((u) => yv[u] + ldy[l])), y1: Math.max(...us.map((u) => yv[u] + ldy[l] + hOf(u))) });
  }
  return res;
}

// the automatic layout: each separate group of connected boxes laid out on its own (and, with square-cornered
// arrows, re-laid with wider gaps where its arrows turned out to need them), the groups packed together, and boxes
// with no arrows in a grid under them
// vert: top to bottom. The groups are laid out and routed left to right on a board turned a quarter turn (each box's
// width and height swapped), then turned back: positions come out real, routes stay in the turned frame, the one
// the arrows are routed and drawn in (see _drawEdges)
export function layered(keys, edges, size0, kindOf, vert) {
  const size = vert ? (k) => { const s0 = size0(k); return { w: s0.h, h: s0.w }; } : size0;
  const PR = PROTO(), nb = new Map(keys.map((k) => [k, []]));
  edges.forEach((e) => { if (e.from !== e.to && nb.has(e.from) && nb.has(e.to)) { nb.get(e.from).push(e.to); nb.get(e.to).push(e.from); } });
  const lone = keys.filter((k) => !nb.get(k).length), seen = new Set(), parts = [];
  keys.forEach((k) => {
    if (seen.has(k) || !nb.get(k).length) return;
    const part = [], todo = [k];
    seen.add(k);
    while (todo.length) { const u = todo.pop(); part.push(u); nb.get(u).forEach((v) => { if (!seen.has(v)) { seen.add(v); todo.push(v); } }); }
    parts.push(part);
  });
  const groups = PR.pack ? parts.map((p) => new Set(p)) : [new Set(parts.flat())];
  const laid = groups.filter((g) => g.size).map((g) => {
    const ks = keys.filter((k) => g.has(k)), es = edges.filter((e) => g.has(e.from) && g.has(e.to));
    const wrap = vert ? 2000 : 0;
    let res = layeredOnce(ks, es, size, undefined, wrap), gap = null;
    for (let it = 0; PR.ortho && it < 3; it++) {
      const pos = new Map(ks.map((k) => { const s = size(k), p = res.get(k); return [k, { x: p.x, y: p.y, w: s.w, h: s.h }]; }));
      const short = [], geo = arrowGeo(es, (k) => pos.get(k), orthoSides);
      orthoAll(geo, (e, sd) => (sd[0] === 'r' && sd[1] === 'l' && res.routes.get(e.id)) || null, [...pos.values()], short);
      gap = gap || res.gapW.slice();
      let grew = false;
      short.forEach((sh) => {
        const g = res.gaps.find((q) => sh.x >= q.x0 - 1 && sh.x <= q.x1 + 1 && sh.hi > q.y0 && sh.lo < q.y1);
        if (g && g.x1 - g.x0 + sh.need > gap[g.l]) { gap[g.l] = Math.ceil(g.x1 - g.x0 + sh.need + 2); grew = true; }
      });
      if (!grew) break;
      res = layeredOnce(ks, es, size, gap, wrap);
    }
    // its extent
    const ps = ks.map((k) => { const p = res.get(k), s = size(k); return [p.x, p.y, p.x + s.w, p.y + s.h]; });
    const x0 = Math.min(...ps.map((p) => p[0])), y0 = Math.min(...ps.map((p) => p[1]));
    return { res, ks, x0, y0, w: Math.max(...ps.map((p) => p[2])) - x0, h: Math.max(...ps.map((p) => p[3])) - y0 };
  });
  // pack the groups, biggest first, each beside or under those already placed, wherever the whole stays
  // smallest and nearest a screen's shape: smaller groups fill in round the big one instead of leaving gaps
  // turned, a screen's shape is tall: packed that way, the groups come out wide again
  const GUT = 90, R = vert ? 1 / (PR.ratio || 1.7) : PR.ratio || 1.7, out = new Map(), put = [];
  out.routes = new Map(); out.heads = [];
  laid.sort((p, q) => q.w * q.h - p.w * p.h);
  laid.forEach((p) => {
    let best = null;
    const xs = new Set([0]), ys = new Set([0]);
    put.forEach((q) => { xs.add(q.x); xs.add(q.x + q.w + GUT); ys.add(q.y); ys.add(q.y + q.h + GUT); });
    xs.forEach((x) => ys.forEach((y) => {
      if (put.some((q) => x < q.x + q.w + GUT && x + p.w + GUT > q.x && y < q.y + q.h + GUT && y + p.h + GUT > q.y)) return;
      const W = Math.max(x + p.w, ...put.map((q) => q.x + q.w)), H = Math.max(y + p.h, ...put.map((q) => q.y + q.h));
      const cost = W * H * (1 + 0.5 * Math.abs(Math.log(W / H / R)));
      if (!best || cost < best.cost - 1 || (Math.abs(cost - best.cost) <= 1 && y + x < best.y + best.x)) best = { x, y, cost };
    }));
    put.push({ x: best.x, y: best.y, w: p.w, h: p.h });
    const dx = best.x - p.x0, dy = best.y - p.y0;
    p.ks.forEach((k) => { const q = p.res.get(k); out.set(k, vert ? { x: q.y + dy, y: q.x + dx } : { x: q.x + dx, y: q.y + dy }); });
    p.res.routes.forEach((pts, id) => out.routes.set(id, pts.map((q) => [q[0] + dx, q[1] + dy, q[2]])));
  });
  // the boxes wired to nothing: a grid under the rest, in real (unturned) sizes
  const wide = put.length ? Math.max(...put.map((q) => (vert ? q.y + q.h : q.x + q.w))) : 0, H = put.length ? Math.max(...put.map((q) => (vert ? q.x + q.w : q.y + q.h))) : 0;
  if (lone.length) {
    const cw = Math.max(...lone.map((k) => size0(k).w)) + 40, rh = Math.max(...lone.map((k) => size0(k).h)) + ROWG;
    const cols = Math.max(1, wide ? Math.min(lone.length, Math.max(3, Math.floor((wide + 40) / cw))) : Math.ceil(Math.sqrt(lone.length * 2)));
    // grouped by kind (automations, scripts, helpers, devices...), with a small heading each when a kind is given
    const kinds = [];
    lone.forEach((k) => {
      const kd = kindOf ? kindOf(k) : '';
      if (!kinds.length || kinds[kinds.length - 1].k !== kd) kinds.push({ k: kd, us: [] });
      kinds[kinds.length - 1].us.push(k);
    });
    let y = out.size ? H + 100 : 0;
    kinds.forEach((g) => {
      if (kindOf) { out.heads.push({ x: 0, y, text: g.k, keys: g.us.slice() }); y += 30; }
      g.us.forEach((k, j) => out.set(k, { x: (j % cols) * cw, y: y + Math.floor(j / cols) * rh }));
      y += Math.ceil(g.us.length / cols) * rh + 20;
    });
  }
  return out;
}

// each box's top in its column: the order stays, each box as near the middle of what it connects to as the boxes
// above and below it allow, so a chain runs straight across instead of zigzagging between centred columns
export function alignY(layers, ins, outs, hOf, y) {
  layers.forEach((ly) => { let t = 0; ly.forEach((u) => { y[u] = t; t += hOf(u) + ROWG; }); });
  const c = (u) => y[u] + hOf(u) / 2;
  const med = (vs) => { const s = vs.slice().sort((p, q) => p - q), m = s.length; return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2; };
  // keep the order and the gaps; least squares from the wanted tops (pool adjacent violators)
  const place = (ly, want) => {
    const blocks = [];
    let off = 0;
    ly.forEach((u, i) => {
      blocks.push({ s: want[i] - hOf(u) / 2 - off, n: 1 });
      off += hOf(u) + ROWG;
      while (blocks.length > 1) {
        const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
        if (a.s / a.n <= b.s / b.n) break;
        a.s += b.s; a.n += b.n; blocks.pop();
      }
    });
    off = 0;
    let i = 0;
    blocks.forEach((b) => { const z = b.s / b.n; for (let j = 0; j < b.n; j++, i++) { y[ly[i]] = z + off; off += hOf(ly[i]) + ROWG; } });
  };
  for (let it = 0; it < 14; it++) {
    const both = it >= 10, down = it % 2 === 0, order = down ? layers : layers.slice().reverse();
    order.forEach((ly) => {
      if (!ly.length) return;
      place(ly, ly.map((u) => { const ns = both ? ins[u].concat(outs[u]) : down ? ins[u] : outs[u]; return ns.length ? med(ns.map(c)) : c(u); }));
    });
  }
  const top = Math.min(0, ...layers.flat().map((u) => y[u]));
  layers.flat().forEach((u) => { y[u] -= top; });
}

/* ---------- loops: an automation or script whose own effects can set it off again ---------- */
// what a service leaves its entity in, for the common ones; anything else counts as "could be anything"
export const RESULT = { turn_on: ['on'], turn_off: ['off'], open_cover: ['open', 'opening'], close_cover: ['closed', 'closing'],
  lock: ['locked', 'locking'], unlock: ['unlocked', 'unlocking'], open: ['open', 'opening'],
  start: ['active'], pause: ['paused'], cancel: ['idle'], finish: ['idle'] };
export const TIMER_EVENTS = { 'timer.finished': ['start', 'change', 'finish'], 'timer.cancelled': ['cancel'],
  'timer.started': ['start'], 'timer.restarted': ['start'], 'timer.paused': ['pause'] };
export function canSetOff(svcs, entity, trig) {
  // can an action (svcs) on this entity fire this trigger edge (state "to:" or timer event filters)?
  if (trig.anyTrig || !trig.tfs.length || !svcs.size) return true;
  const dom = entity.split('.')[0];
  return trig.tfs.some((f) => [...svcs].some((s) => {
    if (f.ev) return f.ev.some((ev) => !(dom === 'timer' && TIMER_EVENTS[ev]) || TIMER_EVENTS[ev].includes(s));
    if (f.svc) return f.svc.includes(s);
    if (s === 'turn_on' && (dom === 'climate' || dom === 'water_heater' || dom === 'media_player')) return true;
    if (!RESULT[s]) return true;
    return RESULT[s].some((x) => (!f.to || f.to.includes(x)) && (!f.notTo || !f.notTo.includes(x)));
  }));
}
// an automation that sets the very state that triggered it changes nothing (2.6): to: on, then turn_on
export function sameState(svcs, trig) {
  if (trig.anyTrig || !trig.tfs.length || !svcs.size) return false;
  return trig.tfs.every((f) => f.to && f.to.length === 1 && !f.notTo && [...svcs].every((s) => RESULT[s] && RESULT[s][0] === f.to[0]));
}
export function loopEdges(keys, edges) {
  // collapse "A changes X, X triggers B" into hops A -> B (only when the change can satisfy B's trigger), then find cycles.
  // A change spreads: to helpers that read X (role source, 2.3) and from a scene or group to its members (2.4).
  const logic = (k) => k.startsWith('automation.') || k.startsWith('script.');
  const into = new Map(), from = new Map(), spread = new Map();
  const push = (m, k, e) => (m.get(k) || m.set(k, []).get(k)).push(e);
  edges.forEach((e) => {
    if (e.role === 'action' || e.role === 'call') push(into, e.to, e);
    if (e.role === 'trigger') push(from, e.from, e);
    if (e.role === 'source' || (e.role === 'action' && !logic(e.from) && !e.to.startsWith('nact:'))) push(spread, e.from, e);
  });
  const hops = [];
  edges.forEach((e) => {
    if (e.role === 'call' && logic(e.to)) hops.push({ a: e.from, b: e.to, ids: [e.id] });
    else if (e.role === 'action' && e.to.startsWith('automation.') && e.svcs.has('trigger')) hops.push({ a: e.from, b: e.to, ids: [e.id] });
  });
  into.forEach((ins, x) => {
    if (logic(x)) return;
    ins.forEach((a) => {
      if (a.role !== 'action' || !logic(a.from)) return;
      const seen = new Map([[x, [a.id]]]), q = [x];
      while (q.length) {
        const u = q.shift();
        (spread.get(u) || []).forEach((sp) => { if (!seen.has(sp.to) && !logic(sp.to)) { seen.set(sp.to, seen.get(u).concat([sp.id])); q.push(sp.to); } });
      }
      seen.forEach((path, y) => (from.get(y) || []).forEach((t) => {
        const direct = y === x;
        if (direct && !canSetOff(a.svcs, x, t)) return;
        if (direct && t.to === a.from && sameState(a.svcs, t)) return;
        hops.push({ a: a.from, b: t.to, ids: path.concat([t.id]) });
      }));
    });
  });
  const adj = new Map(keys.map((k) => [k, []]));
  hops.forEach((h) => { if (adj.has(h.a) && adj.has(h.b)) adj.get(h.a).push(h.b); });
  let i = 0, c = 0;
  const index = new Map(), low = new Map(), on = new Set(), stack = [], comp = new Map();
  const sc = (v) => {
    index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of adj.get(v)) {
      if (!index.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      let w;
      do { w = stack.pop(); on.delete(w); comp.set(w, c); } while (w !== v);
      c++;
    }
  };
  keys.forEach((k) => { if (!index.has(k)) sc(k); });
  const size = new Map();
  comp.forEach((x) => size.set(x, (size.get(x) || 0) + 1));
  const out = new Set();
  hops.forEach((h) => {
    if (h.a === h.b || (comp.get(h.a) === comp.get(h.b) && size.get(comp.get(h.a)) > 1)) h.ids.forEach((id) => out.add(id));
  });
  return out;
}

export const OUTCOME = (r) => {
  if (r.state === 'running') return { text: T('running_2'), cls: 'blue' };
  const x = r.script_execution;
  if (r.error || x === 'error') return { text: T('error_2', { extra: r.error ? ': ' + r.error : '' }), cls: 'red' };
  return ({
    finished: { text: T('finished'), cls: '' },
    failed_conditions: { text: T('conditions_not_met'), cls: 'muted' },
    failed_single: { text: T('skipped_already_running'), cls: 'muted' },
    failed_max_runs: { text: T('skipped_max_runs'), cls: 'muted' },
    cancelled: { text: T('cancelled'), cls: 'muted' },
    aborted: { text: T('aborted'), cls: 'amber' },
    timeout: { text: T('timed_out'), cls: 'amber' },
    failed_wait: { text: T('wait_timed_out'), cls: 'amber' },
  })[x] || { text: x || r.state || '', cls: '' };
};

/* ---------- developer tools (Phase 9): reading traces, and data typed into a test ---------- */

export function scalar(v) {
  v = String(v == null ? '' : v).trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return +v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^(['"]).*\1$/.test(v) && v.length > 1) return v.slice(1, -1);
  return v;
}
// data typed into a test without Home Assistant's YAML editor: JSON, or one "key: value" per line
export function parseLoose(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return {};
  if (/^[[{]/.test(s)) return JSON.parse(s);
  const out = {};
  s.split('\n').forEach((line) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const m = line.match(/^\s*([^:#]+?)\s*:\s*(.*)$/);
    if (!m) throw new Error(T('can_t_read_use_key', { line: line.trim() }));
    out[m[1].trim()] = scalar(m[2]);
  });
  return out;
}
export function toLoose(v) {
  if (v == null || (typeof v === 'object' && !Object.keys(v).length)) return '';
  if (typeof v !== 'object') return String(v);
  const flat = !Array.isArray(v) && Object.values(v).every((x) => x == null || typeof x !== 'object');
  if (!flat) return JSON.stringify(v, null, 2);
  return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'string' && (x === '' || /^[\s'"]|[\s]$|^(true|false|null|~|-?\d+(\.\d+)?)$/.test(x)) ? JSON.stringify(x) : x}`).join('\n');
}
// a condition in a few words, for "why didn't it run?"
export function condText(c, nm) {
  const name = (x) => (nm ? nm(x) : x);
  if (c == null) return T('a_condition');
  if (typeof c === 'string') return T('template_2', { c: shorten(c, 60) });
  const ent = toList(c.entity_id).map(name).join(', ');
  switch (c.condition) {
    case 'state': return T('is', { ent, state: toList(c.state).join(T('or')) });
    case 'numeric_state': return [ent, c.above != null ? T('above', { above: c.above }) : '', c.below != null ? T('below', { below: c.below }) : ''].filter(Boolean).join(' ');
    case 'template': return T('template', { value_template: shorten(c.value_template, 60) });
    case 'time': return T('time_2', { list: [c.after ? T('after', { after: c.after }) : '', c.before ? T('before', { before: c.before }) : '', c.weekday ? T('on_2', { weekday: toList(c.weekday).join(', ') }) : ''].filter(Boolean).join(' ') });
    case 'and': case 'or': case 'not': return `${c.condition} (${P('n_conditions', toList(c.conditions).length)})`;
    default: return String(c.condition || 'condition') + (ent ? ' ' + ent : '');
  }
}
// the trigger variables of a run: which trigger fired, and on what
export function trigVar(g) {
  const tr = (g && g.trace) || {}, k = Object.keys(tr).find((p) => /^trigger(\/\d+)?$/.test(p));
  const el = k && tr[k] && tr[k][0];
  return (el && el.changed_variables && el.changed_variables.trigger) || null;
}
// why a stopped run stopped: the condition that failed and what it saw, why a trigger didn't fire, or the error
export function whyStopped(g, nm) {
  const tr = (g && g.trace) || {}, cfg = (g && g.config) || {};
  if (g.not_triggered || g.script_execution === 'not_triggered') {
    const k = Object.keys(tr).find((p) => /^trigger(\/\d+)?$/.test(p)), el = k && tr[k][0], res = (el && el.result) || {};
    const i = k && k.includes('/') ? +k.split('/')[1] : 0;
    return T('trigger_saw_a_change_but', { n: i + 1, extra: res.reason ? ': ' + String(res.reason).replace(/_/g, ' ') : '' });
  }
  if (g.script_execution === 'failed_conditions') {
    const k = Object.keys(tr).find((p) => /^condition\/\d+$/.test(p) && tr[p].some((el) => el.result && el.result.result === false));
    if (!k) return T('a_condition_was_not_met');
    const i = +k.split('/')[1], conds = toList(cfg.conditions != null ? cfg.conditions : cfg.condition);
    const sub = Object.keys(tr).filter((p) => p.startsWith(k + '/')).map((p) => tr[p][0])
      .find((el) => el && el.result && el.result.result === false && el.result.state !== undefined);
    return T('condition_wasn_t_met', { n: i + 1, condText: condText(conds[i], nm), extra: sub ? T('it_was', { state: sub.result.state, extra: sub.result.wanted_state != null ? T('needs', { wanted_state: sub.result.wanted_state }) : '' }) : '' });
  }
  if (g.error) return T('error', { error: g.error });
  const bad = Object.keys(tr).map((p) => [p, (tr[p] || []).find((el) => el && el.error)]).find(([, el]) => el);
  return bad ? T('failed_4', { bad: bad[0], error: bad[1].error }) : '';
}
// the arrows a run actually used, from its trace (4.5): the trigger that fired it and every action it called
export function runPath(key, g, edges) {
  const keys = new Set([key]), lit = new Set();
  const link = (a, b) => { const e = edges.find((x) => x.from === a && x.to === b); if (e) { lit.add(e.id); keys.add(a); keys.add(b); } return !!e; };
  const tv = trigVar(g);
  if (tv) {
    toList(tv.entity_id).forEach((x) => typeof x === 'string' && link(x, key));
    const ev = tv.event;
    if (ev && ev.event_type) {
      link('event:' + ev.event_type, key);
      const bk = NOTIFY_EVENTS[ev.event_type], d = ev.data || {};
      if (bk && typeof d[bk] === 'string') link('nact:' + d[bk], key);
      toList(d.entity_id).forEach((x) => typeof x === 'string' && link(x, key));
    }
    if (typeof tv.topic === 'string') link('mqtt:' + tv.topic, key);
  }
  Object.values((g && g.trace) || {}).forEach((els) => (els || []).forEach((el) => {
    const p = el && el.result && el.result.params;
    if (!p || !p.domain) return;
    const t = p.target || {}, sd = p.service_data || {};
    let hit = false;
    toList(t.entity_id).concat(toList(sd.entity_id)).forEach((x) => { if (typeof x === 'string' && link(key, x)) hit = true; });
    toList(t.device_id).concat(toList(sd.device_id)).forEach((x) => { if (link(key, 'device:' + x)) hit = true; });
    Object.entries(TARGET_KEYS).forEach(([f, pre]) => toList(t[f]).concat(toList(sd[f])).forEach((x) => { if (link(key, pre + ':' + x)) hit = true; }));
    if (p.domain === 'script' && link(key, 'script.' + p.service)) hit = true;
    if (p.domain === 'mqtt' && p.service === 'publish' && typeof sd.topic === 'string' && link(key, 'mqtt:' + sd.topic)) hit = true;
    if (!hit) link(key, 'svc:' + p.domain + '.' + p.service);
    // a notification's buttons hang off it
    const acts = p.domain === 'notify' && sd.data && Array.isArray(sd.data.actions) ? sd.data.actions : [];
    acts.forEach((a) => { if (a && typeof a.action === 'string') link('svc:' + p.domain + '.' + p.service, 'nact:' + a.action); });
  }));
  return { keys: [...keys], edges: [...lit] };
}
// the box a run's trigger description points at: "state of light.x", "event 'timer.finished'", "mqtt topic a/b"
export function srcKey(src) {
  const s = String(src || '');
  const ev = s.match(/^event '([^']+)'/);
  if (ev) return 'event:' + ev[1];
  if (/^mqtt topic /.test(s)) return 'mqtt:' + s.slice(11).trim();
  const m = s.match(/\b([a-z_]+\.[a-z0-9_]+)\b/);
  return m ? m[1] : null;
}
/* ---------- the arrow editor (7.5): YAML previews, and finding and removing what an arrow stands for ---------- */
export function yScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  const plain = s !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]|[\s]$|: | #|\n/.test(s) && !/^(true|false|yes|no|on|off|null|~|-?\d+(\.\d+)?(e[-+]?\d+)?)$/i.test(s);
  return plain ? s : JSON.stringify(s);
}
// plain data as YAML, the way Home Assistant's editor writes it (for previews only; the board saves JSON)
export function toYaml(v, ind = 0) {
  const pad = ' '.repeat(ind);
  const empty = (x) => x && typeof x === 'object' && !(Array.isArray(x) ? x.length : Object.keys(x).length);
  if (Array.isArray(v)) {
    if (!v.length) return pad + '[]';
    return v.map((x) => (x && typeof x === 'object' && !empty(x) ? pad + '- ' + toYaml(x, ind + 2).slice(ind + 2) : pad + '- ' + (empty(x) ? (Array.isArray(x) ? '[]' : '{}') : yScalar(x)))).join('\n');
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return pad + '{}';
    return keys.map((k) => {
      const x = v[k];
      if (x && typeof x === 'object' && !empty(x)) return pad + yScalar(k) + ':\n' + toYaml(x, Array.isArray(x) ? ind + 2 : ind + 2);
      return pad + yScalar(k) + ': ' + (empty(x) ? (Array.isArray(x) ? '[]' : '{}') : yScalar(x));
    }).join('\n');
  }
  return pad + yScalar(v);
}
export const ACT_LISTS = ['then', 'else', 'sequence', 'default', 'parallel'];
// the places in an automation or script config that name one box directly. Each has the path to its node, the
// field that names the box, and whether removing it drops the whole node (it names nothing else) or only the box
// from a list. A box named only inside a template, or through an area, isn't here: that takes the editor.
export function refsTo(cfg, isScript, key) {
  const out = [], plainEnt = EXACT_RE.test(key);
  const pre = TGT_RE.test(key) ? key.slice(0, key.indexOf(':')) : null, tgtField = pre && { area: 'area_id', floor: 'floor_id', label: 'label_id' }[pre];
  const id = key.startsWith('device:') ? key.slice(7) : pre ? key.slice(pre.length + 1) : key;
  const has = (v) => toList(v).includes(id);
  // everything else a node aims at, so removing this box can't leave a node without a target
  const others = (node, skip) => {
    let n = 0;
    [[node, 'entity_id'], [node, 'device_id'], [node.target, 'entity_id'], [node.target, 'device_id'], [node.target, 'area_id'], [node.target, 'floor_id'], [node.target, 'label_id'], [node.data, 'entity_id']]
      .forEach(([o, f]) => { if (o && o[f] != null && o[f] !== 'all' && o[f] !== 'none') n += toList(o[f]).filter((x) => !(o === skip[0] && f === skip[1] && x === id)).length; });
    return n;
  };
  const look = (node, path, kind) => {
    const found = [];
    const at = (o, f, rel) => { if (o && o[f] != null && typeof o[f] !== 'object' ? o[f] === id : o && Array.isArray(o[f]) && has(o[f])) found.push({ o, f, rel }); };
    if (plainEnt) {
      at(node, 'entity_id', ['entity_id']);
      at(node.target, 'entity_id', ['target', 'entity_id']);
      if (kind === 'action') at(node.data, 'entity_id', ['data', 'entity_id']);
      if (kind === 'action' && node.scene === key) return [{ path, mode: 'node', kind }];
      const svc = node.action || node.service;
      if (kind === 'action' && key.startsWith('script.') && svc === key) return [{ path, mode: 'node', kind }];
    } else if (key.startsWith('device:')) { at(node, 'device_id', ['device_id']); at(node.target, 'device_id', ['target', 'device_id']); }
    else if (tgtField) { at(node, tgtField, [tgtField]); at(node.target, tgtField, ['target', tgtField]); }
    else if (key.startsWith('event:') && kind === 'trigger' && (node.trigger || node.platform) === 'event') {
      const ts = toList(node.event_type);
      if (ts.includes(key.slice(6))) return [{ path, mode: ts.length > 1 ? 'drop' : 'node', field: ['event_type'], kind, item: key.slice(6) }];
    } else if (key.startsWith('svc:') && kind === 'action' && (node.action || node.service) === key.slice(4)) return [{ path, mode: 'node', kind }];
    else if (key.startsWith('mqtt:') && kind === 'trigger' && (node.trigger || node.platform) === 'mqtt' && node.topic === key.slice(5)) return [{ path, mode: 'node', kind }];
    else if (key.startsWith('nact:') && kind === 'trigger' && node.event_data && Object.values(node.event_data).includes(key.slice(5))) return [{ path, mode: 'node', kind }];
    return found.map(({ o, f, rel }) => ({ path, kind, field: rel, item: id, mode: toList(o[f]).length === 1 && !others(node, [o, f]) ? 'node' : 'drop' }));
  };
  const walkActs = (list, path) => toList(list).forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    const p = path.concat(Array.isArray(list) ? [i] : []);
    // a condition step among the actions
    out.push(...look(a, p, typeof a.condition === 'string' ? 'condition' : 'action'));
    if (Array.isArray(a.conditions) && typeof a.condition === 'string') walkConds(a.conditions, p.concat(['conditions']));
    ACT_LISTS.forEach((k) => { if (a[k] != null) walkActs(a[k], p.concat([k])); });
    if (a.if != null) walkConds(a.if, p.concat(['if']));
    toList(a.choose).forEach((o, j) => { if (o && typeof o === 'object') { const q = p.concat(Array.isArray(a.choose) ? ['choose', j] : ['choose']); if (o.conditions != null) walkConds(o.conditions, q.concat(['conditions'])); if (o.sequence != null) walkActs(o.sequence, q.concat(['sequence'])); } });
    if (a.repeat && typeof a.repeat === 'object') {
      if (a.repeat.sequence != null) walkActs(a.repeat.sequence, p.concat(['repeat', 'sequence']));
      ['while', 'until'].forEach((k) => { if (a.repeat[k] != null) walkConds(a.repeat[k], p.concat(['repeat', k])); });
    }
  });
  const walkConds = (list, path) => toList(list).forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const p = path.concat(Array.isArray(list) ? [i] : []);
    out.push(...look(c, p, 'condition'));
    if (c.conditions != null) walkConds(c.conditions, p.concat(['conditions']));
  });
  if (isScript) walkActs(cfg.sequence, ['sequence']);
  else {
    const tk = cfg.triggers != null ? 'triggers' : 'trigger', ck = cfg.conditions != null ? 'conditions' : 'condition', ak = cfg.actions != null ? 'actions' : 'action';
    toList(cfg[tk]).forEach((t, i) => { if (t && typeof t === 'object') out.push(...look(t, Array.isArray(cfg[tk]) ? [tk, i] : [tk], 'trigger')); });
    walkConds(cfg[ck], [ck]);
    walkActs(cfg[ak], [ak]);
  }
  return out;
}

export function dropRefs(cfg, refs) {
  const c = JSON.parse(JSON.stringify(cfg));
  // lists first, nodes after, the deepest and the last in each list first, so the paths stay valid
  refs.filter((r) => r.mode === 'drop').forEach((r) => {
    const node = getPath(c, r.path), parent = node && getPath(node, r.field.slice(0, -1)), f = r.field[r.field.length - 1];
    if (!parent || parent[f] == null) return;
    const left = toList(parent[f]).filter((x) => x !== r.item);
    if (Array.isArray(parent[f])) parent[f] = left.length === 1 ? left[0] : left; else delete parent[f];
  });
  refs.filter((r) => r.mode === 'node').slice().sort((a, b) => b.path.length - a.path.length || String(b.path[b.path.length - 1]).localeCompare(String(a.path[a.path.length - 1]), undefined, { numeric: true }))
    .forEach((r) => {
      const last = r.path[r.path.length - 1], parent = getPath(c, r.path.slice(0, -1));
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else if (parent && typeof parent === 'object') delete parent[last];
    });
  return c;
}
// a reference in a few words: "Trigger 2", "Action 1 › then 2", for the arrow editor
export function refPlace(r) {
  const p = r.path, name = { triggers: T('trigger'), trigger: T('trigger'), conditions: T('condition_2'), condition: T('condition_2'), actions: T('action'), action: T('action'), sequence: T('step') }[p[0]] || T('part');
  const parts = [];
  for (let i = 1; i < p.length; i++) {
    if (typeof p[i] === 'number') parts.push(String(p[i] + 1));
    else if (!['conditions', 'sequence'].includes(p[i]) || i === p.length - 2) parts.push(p[i] === 'conditions' ? 'condition' : p[i]);
  }
  const first = typeof p[1] === 'number' ? `${name} ${p[1] + 1}` : name;
  return [first].concat(parts.slice(typeof p[1] === 'number' ? 1 : 0)).join(' › ').replace(/ › (\d+)/g, ' $1');
}

/* ---------- Node-RED flows (2.7, decision D1): one box per wired group of nodes in a flow tab ---------- */
export const NR_TRIG = new Set(['server-state-changed', 'trigger-state', 'poll-state', 'server-events', 'ha-zone', 'ha-time', 'inject']);
// groups of wired-together nodes and the Home Assistant entities they trigger on, read and change; a disabled
// node runs nothing (it's left out), and the groups of a disabled tab are marked off (0.11.0)
export function nrGroups(flows, known) {
  const all = Array.isArray(flows) ? flows : [], tabs = new Map(all.filter((n) => n && n.type === 'tab').map((t) => [t.id, t]));
  const nodes = all.filter((n) => n && n.z && tabs.has(n.z) && !n.d && !['tab', 'comment', 'group'].includes(n.type));
  const adj = new Map(nodes.map((n) => [n.id, new Set()])), byId = new Map(nodes.map((n) => [n.id, n]));
  nodes.forEach((n) => toList(n.wires).flat().forEach((t) => { if (adj.has(t)) { adj.get(n.id).add(t); adj.get(t).add(n.id); } }));
  const ids = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? toList(v.entity) : typeof v === 'string' ? v.split(',').map((x) => x.trim()) : toList(v)).filter((x) => typeof x === 'string' && x);
  const scan = (s) => { const out = []; if (typeof s === 'string') for (const m of s.matchAll(ENTITY_RE)) out.push(m[0]); return out; };
  const seen = new Set(), out = [];
  nodes.forEach((n0) => {
    if (seen.has(n0.id)) return;
    const q = [n0.id], g = [];
    seen.add(n0.id);
    while (q.length) { const u = q.shift(); g.push(byId.get(u)); adj.get(u).forEach((v) => { if (!seen.has(v)) { seen.add(v); q.push(v); } }); }
    const trig = new Set(), read = new Set(), change = new Set(), calls = new Set(), events = new Set();
    const add = (set, list) => list.forEach((x) => { const e = known(x); if (e) set.add(e); });
    g.forEach((n) => {
      if (n.type === 'server-state-changed' || n.type === 'trigger-state' || n.type === 'ha-wait-until') add(n.type === 'ha-wait-until' ? read : trig, ids(n.entities).concat(n.entityidfiltertype && n.entityidfiltertype !== 'exact' ? [] : ids(n.entityidfilter), ids(n.entityId || n.entityid)));
      if (n.type === 'poll-state') add(trig, ids(n.entityId || n.entity_id));
      if (n.type === 'server-events' && typeof (n.eventType || n.event_type) === 'string' && (n.eventType || n.event_type)) events.add(n.eventType || n.event_type);
      if (n.type === 'api-current-state' || n.type === 'api-get-history') add(read, ids(n.entity_id || n.entityId));
      if (n.type === 'api-render-template') add(read, scan(n.template));
      if (n.type === 'function') add(read, scan(n.func).concat(scan(n.initialize), scan(n.finalize)));
      if (n.type === 'api-call-service') {
        const svc = n.action || (n.domain && n.service ? n.domain + '.' + n.service : '');
        const nt = n.target && typeof n.target === 'object' ? n.target : {};
        const entIds = ids(n.entityId).concat(ids(n.entity_id), ids(nt.entityId), ids(nt.entity_id));
        add(change, entIds.concat(scan(typeof n.data === 'string' ? n.data : '')));
        if (/^script\.[a-z0-9_]+$/.test(svc) && !['script.turn_on', 'script.turn_off', 'script.toggle', 'script.reload'].includes(svc)) add(calls, [svc]);
        if (svc === 'script.turn_on') entIds.forEach((x) => { const e = known(x); if (e) { calls.add(e); change.delete(e); } });
      }
    });
    if (!trig.size && !read.size && !change.size && !calls.size && !events.size) return;
    const first = g.find((n) => NR_TRIG.has(n.type) && n.name) || g.find((n) => n.name), tab = tabs.get(n0.z);
    const gid = n0.z + ':' + g.map((n) => n.id).sort()[0];
    out.push({ id: gid, tab: n0.z, tabLabel: (tab && tab.label) || T('flow'), name: (first && first.name) || (tab && tab.label) || T('node_red_flow'), size: g.length,
      trig: [...trig], read: [...read].filter((x) => !trig.has(x)), change: [...change], calls: [...calls], events: [...events], off: !!(tab && tab.disabled) });
  });
  return out;
}

/* ---------- the import's grouping (0.11.0): parts, and the ties a person may merge them by ---------- */
// words that say nothing about which system a name belongs to
export const FF_STOP = new Set(('a an the and or of to on off in at for with from when after before is it my now up down set toggle turn turned '
  + 'notify notification notifications alert alerts reminder automation script switch led status check reset counter decrement '
  + 'decrementer decrementor count countdown change changed close closed open opened opening closing double tap single triple '
  + 'hold every daily new old one time minute minutes hour hours am pm via if then else start stop run running auto').split(' '));
export function ffWords(s) {
  return String(s || '').toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/)
    .map((t) => (/^[a-z]{3,}\d+$/.test(t) ? t.replace(/\d+$/, '') : t))
    .filter((t) => t && !FF_STOP.has(t) && !/^\d+$/.test(t)).map((t) => (t.length > 3 ? t.replace(/s$/, '') : t));
}
// the family a name says it's in: "Generator: low battery", "Router - firmware", "[Garage] lights"
export function ffPrefix(name) {
  const m = /^\s*\[([^\]]{2,40})\]/.exec(name || '') || /^\s*([^:—–[]{2,40}?)\s*(?::|\s[—–-]\s)\s*\S/.exec(name || '');
  const w = m ? ffWords(m[1]) : [];
  return w.length ? w.join(' ') : null;
}
// roles: logic id → Map(ref → Set of roles: trigger, condition, action, call), for automations, scripts and
// Node-RED groups ('nr:…'). info: kind(id) → 'automation' | 'script' | 'helper' | 'scene' | 'nodered' | null;
// name(id); cat(id) → its category in lower case, or ''; source(ref) → what a trigger on it starts from (a device's
// buttons 'buttons:<device>', an actuator's own state: the entity, a device 'dev:<device>') or null for things
// everything listens to (people, phones, zones, the sun, speakers); tab(id) → a Node-RED group's tab.
// Returns { parts, ties }: parts are what belongs together on any reading, each an array of ids (two or more, one
// an automation, or a Node-RED flow with two pieces it uses); a tie { a, b, why, by, via } is a reason parts a and
// b (indexes) may be one function, for the person to choose: why is switches (by turns via, an automation of the
// other, on or off), uses (by changes or runs via, a helper or script of the other), reads (by checks via, a helper
// of the other), starts (by changes via, which the other starts from) or device (both start from via's device).
export function findFunctions(roles, info) {
  const kind = (id) => info.kind(id), name = (id) => info.name(id) || id;
  const logic = (id) => kind(id) === 'automation' || kind(id) === 'nodered';
  const glue = (id) => { const k = kind(id); return k === 'script' || k === 'helper' || k === 'scene'; };
  const pre = (id) => ffPrefix(name(id));
  const fam = (id) => { const p = pre(id); return p ? p.split(' ')[0] : ffWords(name(id))[0] || null; };
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const put = (m, k, v) => (m.get(k) || m.set(k, new Set()).get(k)).add(v);
  roles.forEach((_, L) => find(L));
  const said = [];
  const tie = (x, y, why, by, via) => said.push({ x, y, why, by, via });
  // the parts so far: a piece's part, or null for a piece on its own (every id of a part, its helpers included)
  const real = (ids) => ids.length >= 2 && ids.some(logic);
  const snapshot = () => {
    const comps = new Map(), part = new Map();
    parent.forEach((_, x) => put(comps, find(x), x));
    comps.forEach((ids, r) => { if (real([...ids])) ids.forEach((id) => part.set(id, r)); });
    return part;
  };
  // 1. a helper, script or scene a piece triggers on, changes or runs links the pieces that do; one only checked (a
  //    condition, like a mode flag) doesn't. A busy one is a hub (a notify script) and links nothing.
  const causal = new Map(), reads = new Map();
  roles.forEach((m, L) => m.forEach((rs, ref) => { if (ref !== L && glue(ref)) put([...rs].some((r) => r !== 'condition') ? causal : reads, ref, L); }));
  const hub = (gl) => (causal.get(gl) || new Set()).size > (kind(gl) === 'helper' ? 12 : 6);
  // fences: when it links pieces filed under different categories, or named as different systems, it joins only
  // the side it belongs to (its own category or name, else the largest), and pieces with neither; the rest tie.
  // A name says a system when it says its family ("Plants: …") or two of the pieces start with its first word.
  const side = (Ls, gl, key, own0, like, said) => {
    const by = new Map();
    Ls.forEach((L) => put(by, key(L) || '', L));
    if (said) [...by.keys()].forEach((f) => { if (f && by.get(f).size < 2 && ![...by.get(f)].some((L) => pre(L))) { by.get(f).forEach((L) => put(by, '', L)); by.delete(f); } });
    const named = [...by.keys()].filter(Boolean);
    if (named.length < 2) return Ls;
    const own = by.has(own0) ? own0 : named.sort((x, y) => like(y) - like(x) || by.get(y).size - by.get(x).size)[0];
    return [...by.get(own), ...(by.get('') || [])];
  };
  causal.forEach((Ls0, gl) => {
    if (hub(gl)) return;
    const gw = new Set(ffWords(name(gl)));
    let Ls = side([...Ls0], gl, info.cat, info.cat(gl), () => 0);
    const like = (f) => [...Ls].filter((L) => fam(L) === f).reduce((n, L) => n + ffWords(name(L)).filter((w) => gw.has(w)).length, 0);
    Ls = side(Ls, gl, fam, fam(gl), like, true);
    Ls.forEach((L) => union(L, gl));
    Ls0.forEach((L) => { if (!Ls.includes(L)) tie(L, gl, 'uses', L, gl); });
  });
  // 2. Node-RED: a tab's groups are one flow, and tabs whose names start alike are one system
  const tabs = new Map();
  roles.forEach((_, L) => {
    if (kind(L) !== 'nodered') return;
    const t = ffWords(info.tab(L))[0] || String(info.tab(L));
    if (tabs.has(t)) union(tabs.get(t), L); else tabs.set(t, L);
  });
  // 3. an automation that turns others on or off (or runs them) joins them when that's what it's for: they're at
  //    least half of what it changes. Else it ties (a bedtime button that also arms the night alerts). One that
  //    switches more than six is a mode (away, guests) and ties nothing.
  roles.forEach((m, L) => {
    const ts = [...m.entries()].filter(([ref, rs]) => ref !== L && kind(ref) === 'automation' && (rs.has('action') || rs.has('call'))).map(([ref]) => ref);
    if (!ts.length || ts.length > 6) return;
    const does = [...m.entries()].filter(([ref, rs]) => (rs.has('action') || rs.has('call')) && !/^(svc:|nact:|tts\.|notify\.|media_player\.)/.test(ref)).length;
    ts.forEach((t) => (ts.length * 2 >= does ? union(L, t) : tie(L, t, 'switches', L, t)));
  });
  // 4. a helper only checked joins the one part that checks it; a piece on its own that only checks the helpers of
  //    one part (and few others check them) joins it: "notify when the filter counter reaches 0"
  const settle = () => {
    const part = snapshot();
    reads.forEach((Ls, gl) => {
      if (causal.has(gl)) return;
      const ps = new Set([...Ls].map((L) => part.get(L) || null));
      if (ps.size === 1 && !ps.has(null)) { union(gl, [...Ls][0]); part.set(gl, [...ps][0]); }
    });
    roles.forEach((m, L) => {
      if (!logic(L) || part.has(L)) return;
      const rd = [...m.entries()].filter(([ref, rs]) => glue(ref) && [...rs].every((r) => r === 'condition')).map(([ref]) => ref);
      if (!rd.length) return;
      const ps = new Set(rd.map((ref) => part.get(ref) || null));
      if (ps.size !== 1 || ps.has(null) || rd.some((ref) => (reads.get(ref) || new Set()).size > 3)) return;
      union(L, rd[0]);
    });
  };
  settle();
  // 5. pieces that start from the same thing: a device (a door's sensors, a generator), an actuator's own state,
  //    a switch's buttons. Taps nothing else has grouped pair up (each tap may do something else); two parts that
  //    meet at a device, or names that say two systems ("Internet: …", "Router - …"), stay apart and tie. The few
  //    pieces that change what they start from (the taps that open a door) join them. A device more than twelve
  //    start from is a hub (an energy meter's circuits) and links nothing.
  const srcs = new Map(), changers = new Map(), via = new Map();
  roles.forEach((m, L) => {
    if (!logic(L) && kind(L) !== 'script') return;
    m.forEach((rs, ref) => {
      const k = info.source(ref);
      if (!k) return;
      if (!via.has(k)) via.set(k, ref);
      if (rs.has('trigger') && logic(L)) put(srcs, k, L);
      if (rs.has('action') && !k.startsWith('buttons:')) put(changers, k, L);
    });
  });
  let part0 = snapshot();
  const keys = [...srcs.keys()].sort((x, y) => x.startsWith('buttons:') - y.startsWith('buttons:'));
  keys.forEach((k, ki) => {
    const Ls0 = srcs.get(k), Ls = [...Ls0];
    if (k.startsWith('buttons:') && (!ki || !keys[ki - 1].startsWith('buttons:'))) part0 = snapshot();
    if (Ls.length < 2 || Ls.length > 12) return;
    const free = Ls.filter((L) => !part0.has(L));
    if (k.startsWith('buttons:')) { free.forEach((L) => union(free[0], L)); return; }
    const byPre = new Map();
    Ls.forEach((L) => put(byPre, pre(L) || '', L));
    const named = [...byPre.keys()].filter(Boolean);
    let heads;
    if (named.length >= 2) {
      // each named family joins up; the unnamed go to the largest
      named.forEach((p) => { const g = [...byPre.get(p)]; g.forEach((L) => union(g[0], L)); });
      const big = named.sort((x, y) => byPre.get(y).size - byPre.get(x).size)[0];
      (byPre.get('') || new Set()).forEach((L) => union([...byPre.get(big)][0], L));
      heads = named.map((p) => [...byPre.get(p)][0]);
    } else {
      const roots = [...new Set(Ls.filter((L) => part0.has(L)).map((L) => part0.get(L)))];
      if (roots.length > 1) {
        // a piece on its own goes to the part named like it, else the largest
        const size = (r) => [...part0.values()].filter((x) => x === r).length;
        free.forEach((L) => {
          const f = fam(L), same = roots.filter((r) => [...part0.entries()].some(([id, x]) => x === r && roles.has(id) && fam(id) === f));
          union(L, (same.length ? same : roots).sort((x, y) => size(y) - size(x))[0]);
        });
        heads = roots;
      } else Ls.forEach((L) => union(Ls[0], L));
    }
    if (heads) heads.forEach((h, i) => { if (i) tie(heads[0], h, 'device', null, via.get(k)); });
    const cs = [...(changers.get(k) || [])].filter((L) => !Ls0.has(L));
    if (cs.length && cs.length <= 3) cs.filter((L) => !part0.has(L)).forEach((L) => union(Ls[0], L));
  });
  // 6. a family the name says ("Generator: …"), then automations still alone whose names start with the same word
  //    (two to eight of them: "Mailbox roadside opened", "Mailbox house side opened")
  const byPre = new Map();
  roles.forEach((_, id) => { const p = pre(id); if (p) put(byPre, p.split(' ')[0], id); });
  byPre.forEach((s) => { const g = [...s]; g.forEach((id) => union(g[0], id)); });
  const part1 = snapshot(), byFam = new Map();
  roles.forEach((_, id) => { if (kind(id) === 'automation' && !part1.has(id) && fam(id)) put(byFam, fam(id), id); });
  byFam.forEach((s) => { const g = [...s]; if (g.length >= 2 && g.length <= 8) g.forEach((id) => union(g[0], id)); });
  settle();
  // the parts: a Node-RED flow counts when it uses two pieces that can be labelled
  const comps = new Map();
  parent.forEach((_, x) => put(comps, find(x), x));
  const parts = [...comps.values()].map((s) => [...s].sort())
    .filter((ids) => ids.length >= 2 && (ids.some((id) => kind(id) === 'automation') || (ids.some((id) => kind(id) === 'nodered') && ids.filter((id) => kind(id) !== 'nodered').length >= 2)))
    .sort((x, y) => y.length - x.length || x[0].localeCompare(y[0]));
  const at = new Map();
  parts.forEach((ids, i) => ids.forEach((id) => at.set(id, i)));
  // ties found once the parts are known: a piece that checks a helper of another part (few check it), or that
  // changes what another part starts from (few change it)
  causal.forEach((_, gl) => {
    if (hub(gl) || !at.has(gl) || (reads.get(gl) || new Set()).size > 3) return;
    (reads.get(gl) || new Set()).forEach((L) => tie(L, gl, 'reads', L, gl));
  });
  srcs.forEach((Ls, k) => {
    const cs = [...(changers.get(k) || [])].filter((L) => !Ls.has(L));
    if (!cs.length || cs.length > 3 || Ls.size > 12) return;
    cs.forEach((C) => Ls.forEach((L) => tie(C, L, 'starts', C, via.get(k))));
  });
  const RANK = { switches: 0, uses: 1, reads: 2, starts: 3, device: 4 }, seen = new Set(), ties = [];
  said.sort((x, y) => RANK[x.why] - RANK[y.why]).forEach((t) => {
    const a = at.get(t.x), b = at.get(t.y);
    if (a == null || b == null || a === b) return;
    const k = Math.min(a, b) + '|' + Math.max(a, b);
    if (seen.has(k)) return;
    seen.add(k);
    ties.push({ a: Math.min(a, b), b: Math.max(a, b), why: t.why, by: t.by, via: t.via });
  });
  return { parts, ties };
}
