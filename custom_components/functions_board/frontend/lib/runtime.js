/* ---------- the clock (0.10.0): every wait the board sets, by name, stopped together ----------
   A board taken off the page (another sidebar entry, a dashboard view left) stops its clock: nothing it set
   runs after that, and nothing new starts until it is back on the page (start). A name stands for one wait:
   after() replaces the wait of that name (the last call wins: typing, saving), once() keeps it (the first call
   wins: at most one redraw a second), every() repeats, frame() waits for the next frame. A name of null makes
   a wait of its own; its name is returned, for cancel(). deadline() is how long a call may take: when the
   clock stops, it runs at once (the call is given up), so nothing waits on it for ever. sleep() is a pause
   inside a task in the background: it answers true when the time is up, and false at once when the clock
   stops, so the task gives up. pause() is a pause inside a write to Home Assistant, which finishes even when
   the board has left the page (it is not stopped). env: the timer functions, for tests. */
export class Clock {
  constructor(env) {
    const g = env || globalThis;
    this._env = {
      setTimeout: g.setTimeout.bind(g), clearTimeout: g.clearTimeout.bind(g), setInterval: g.setInterval.bind(g), clearInterval: g.clearInterval.bind(g),
      raf: g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (f) => g.setTimeout(f, 16), caf: g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : g.clearTimeout.bind(g),
    };
    this._w = new Map();        // name → { kind, id }
    this._sleeps = new Set();   // the resolve of every sleep() not yet over
    this._n = 0;
    this.running = true;
  }
  _name(name) { return name == null ? '#' + ++this._n : name; }
  _set(name, kind, id) { this._w.set(name, { kind, id }); return name; }
  after(name, ms, fn) {
    name = this._name(name);
    this.cancel(name);
    if (!this.running) return name;
    return this._set(name, 't', this._env.setTimeout(() => { this._w.delete(name); fn(); }, ms));
  }
  once(name, ms, fn) {
    name = this._name(name);
    if (this._w.has(name) || !this.running) return name;
    return this._set(name, 't', this._env.setTimeout(() => { this._w.delete(name); fn(); }, ms));
  }
  every(name, ms, fn) {
    name = this._name(name);
    this.cancel(name);
    if (!this.running) return name;
    return this._set(name, 'i', this._env.setInterval(fn, ms));
  }
  frame(name, fn) {
    name = this._name(name);
    if (this._w.has(name) || !this.running) return name;
    return this._set(name, 'f', this._env.raf((t) => { this._w.delete(name); fn(t); }));
  }
  deadline(ms, fn) {
    const name = this._name(null);
    if (!this.running) { fn(); return name; }
    this._w.set(name, { kind: 'd', fn, id: this._env.setTimeout(() => { this._w.delete(name); fn(); }, ms) });
    return name;
  }
  pause(ms) { return new Promise((r) => this._env.setTimeout(r, ms)); }
  // a time limit on a call that goes on even when the board leaves the page (its answer still comes, and a write
  // half done finishes); the returned function cancels it. Not stopped, and not counted in size.
  limit(ms, fn) { const id = this._env.setTimeout(fn, ms); return () => this._env.clearTimeout(id); }
  has(name) { return this._w.has(name); }
  cancel(name) {
    const w = this._w.get(name);
    if (!w) return;
    this._w.delete(name);
    if (w.kind === 'i') this._env.clearInterval(w.id); else if (w.kind === 'f') this._env.caf(w.id); else this._env.clearTimeout(w.id);
  }
  sleep(ms) {
    if (!this.running) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (v) => { if (this._sleeps.delete(done)) { this._env.clearTimeout(id); resolve(v); } };
      const id = this._env.setTimeout(() => done(true), ms);
      this._sleeps.add(done);
    });
  }
  // every wait cancelled, every sleep over (false); nothing new until start()
  stop() {
    this.running = false;
    const due = [...this._w.values()].filter((w) => w.kind === 'd').map((w) => w.fn);
    for (const name of [...this._w.keys()]) this.cancel(name);
    for (const done of [...this._sleeps]) done(false);
    due.forEach((fn) => fn());
  }
  start() { this.running = true; }
  get size() { return this._w.size + this._sleeps.size; }
}

/* ---------- the link (0.10.0): every call to Home Assistant goes through one Link ----------
   - The latest question asked for the same thing wins: a read (a list, a config, a registry entry) asked again
     before an older answer is used hands every caller the newest answer, so an older one never lands last.
   - Every call has a time limit (LINK_TIMEOUT, or o.timeout); past it, the call fails with code 'timeout'.
   - A failure is reported (link.errors, the console as a warning, the Diagnostics file), never swallowed, unless
     the call says why its failure is expected: o.optional = '<the reason>'. o.fallback answers instead of
     throwing.
   - Lists Home Assistant gives in no promised order are put in one on arrival (LINK_ORDER).
   to: { ws(msg), api(method, path, body), service(domain, service, data, target), sub(msg, cb) }, each returning a
   promise, and ready(cb): cb each time the connection comes back after it was lost, returning the function that
   stops it; clock: a Clock (its limit()); report(entry): told of each failure reported. */
export const LINK_TIMEOUT = 60000;
export const LINK_KEEP = 50;
// lists in no promised order: by this field (other lists of helpers, `<domain>/list`, by id). Not the entity,
// device and area registries: Home Assistant keeps them in the order things were added, and the board's layout
// and words follow that order (sorting them moved boxes: the rebuild changes nothing anyone sees)
export const LINK_ORDER = {
  'config/floor_registry/list': 'floor_id', 'config/label_registry/list': 'label_id', 'config/category_registry/list': 'category_id',
  'config/auth/list': 'id', 'manifest/list': 'domain',
};
export const LINK_AS_GIVEN = new Set(['config/entity_registry/list', 'config/device_registry/list', 'config/area_registry/list']);
// a question, not a change: asked again, the newest answer is everyone's
export const linkRead = (type) => /(^|\/)(list|get|config|list_for_display|versions|version_get|sources|nodered|get_user_data|get_translations)$/.test(type) && type !== 'functions_board/nodered_keep';
export function linkOrder(type, r) {
  if (!Array.isArray(r)) return r;
  const k = LINK_ORDER[type] || (/^[a-z_]+\/list$/.test(type) && !LINK_AS_GIVEN.has(type) && !type.startsWith('trace/') && r.every((x) => x && typeof x.id === 'string') ? 'id' : null);
  if (!k) return r;
  return r.slice().sort((a, b) => { const x = String((a && a[k]) ?? ''), y = String((b && b[k]) ?? ''); return x < y ? -1 : x > y ? 1 : 0; });
}
// the same message written the same way whatever order its keys were set in
export function stableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export function linkErr(code, message) { const e = new Error(message); e.code = code; return e; }
export class Link {
  constructor(to, opt = {}) {
    this.to = to;
    this.clock = opt.clock || new Clock();
    this.timeout = opt.timeout || LINK_TIMEOUT;
    this.onReport = opt.report || null;
    this.errors = [];
    this._last = new Map();  // key → { n, p } the latest question for it
    this._n = 0;
  }
  // a failure, kept (the last LINK_KEEP) and told
  report(kind, what, e) {
    const entry = { at: Date.now(), kind, what, code: String((e && (e.code || e.error)) || 'error'), message: String((e && (e.message || e.body)) || e || '') };
    this.errors.push(entry);
    if (this.errors.length > LINK_KEEP) this.errors.splice(0, this.errors.length - LINK_KEEP);
    if (this.onReport) try { this.onReport(entry); } catch (x) { /* whoever listens can't stop the report */ }
    return entry;
  }
  // the raw call with its time limit (a value, or an error)
  _raw(what, run, ms) {
    return new Promise((resolve, reject) => {
      let done = false;
      const stop = this.clock.limit(ms || this.timeout, () => fin(false, linkErr('timeout', what + ': no answer in ' + Math.round((ms || this.timeout) / 1000) + ' s')));
      const fin = (ok, v) => { if (done) return; done = true; stop(); if (ok) resolve(v); else reject(v); };
      let p;
      try { p = Promise.resolve(run()); } catch (e) { p = Promise.reject(e); }
      p.then((v) => fin(true, v), (e) => fin(false, e));
    });
  }
  // the newest answer to the same question: an older call settles with a newer one's answer when there is one
  _latest(key, start) {
    const n = ++this._n, p = start();
    const e = this._last.get(key) || { n: 0, p: null, open: 0 };
    e.n = n; e.p = p; e.open++;
    this._last.set(key, e);
    const newer = () => (e.n !== n ? e.p : null);
    const out = p.then(
      async (v) => { const l = newer(); if (l) { try { return await l; } catch (x) { return v; } } return v; },
      async (x) => { const l = newer(); if (l) return l; throw x; });
    // the entry is kept while any call for the question is open (an older one may still need the newest answer)
    out.then(() => {}, () => {}).then(() => { if (--e.open === 0 && this._last.get(key) === e) this._last.delete(key); });
    return out;
  }
  // the caller's terms: reported unless optional, the fallback instead of throwing
  _settle(kind, what, p, o) {
    return p.catch((e) => {
      if (!o.optional) this.report(kind, what, e);
      if ('fallback' in o) return o.fallback;
      throw e;
    });
  }
  ask(msg, o = {}) {
    const what = msg.type, run = () => this.to.ws(msg).then((r) => linkOrder(msg.type, r));
    const p = linkRead(msg.type) ? this._latest('ws ' + stableJson(msg), () => this._raw(what, run, o.timeout)) : this._raw(what, run, o.timeout);
    return this._settle('ws', what, p, o);
  }
  api(method, path, body, o = {}) {
    const what = method + ' ' + path, run = () => this.to.api(method, path, body);
    const p = method === 'GET' ? this._latest('api ' + path, () => this._raw(what, run, o.timeout)) : this._raw(what, run, o.timeout);
    return this._settle('api', what, p, o);
  }
  service(domain, service, data, target, o = {}) {
    const what = domain + '.' + service;
    return this._settle('service', what, this._raw(what, () => this.to.service(domain, service, data || {}, target), o.timeout), o);
  }
  // a subscription: the promise of its unsubscribe function
  sub(msg, cb, o = {}) {
    return this._settle('sub', msg.type, this._raw(msg.type, () => this.to.sub(msg, cb), o.timeout), o);
  }
  // any other call out (Node-RED's flows, through its page here): its time limit and its report
  call(what, run, o = {}) { return this._settle('call', what, this._raw(what, run, o.timeout), o); }
  // cb each time the connection to Home Assistant comes back after it was lost (what Home Assistant said meanwhile
  // never came: subscriptions start again, but not from where they were); returns the function that stops it
  ready(cb) { return this.to.ready ? this.to.ready(cb) : () => {}; }
  // ends a subscription (given its promise or its function): one that fails to end was already gone with the
  // connection, so that failure isn't one
  drop(p) { Promise.resolve(p).then((f) => (typeof f === 'function' ? f() : null)).then(() => {}, () => {}); }
  // a task of the board's own (not a call), whose failure is reported and answered with the fallback
  soft(p, what, fallback) { return Promise.resolve(p).catch((e) => { this.report('task', what, e); return fallback; }); }
  // a task of the board's own whose failure is expected: why says why (the static rule asks for it)
  quiet(p, why, fallback) { return Promise.resolve(p).catch(() => fallback); }
  // what the Diagnostics file carries: anonymised, only the kind of call, the message type and the error code
  // (a message or a path can name things in a home)
  exportErrors(anonymise) {
    return this.errors.map((x) => (anonymise ? { at: new Date(x.at).toISOString(), kind: x.kind, type: x.kind === 'ws' || x.kind === 'sub' ? x.what : undefined, code: x.code } : Object.assign({}, x, { at: new Date(x.at).toISOString() })));
  }
}

/* ---------- the store (0.10.0): what the board knows of Home Assistant, each fact with the time it was asked ----------
   A fact is kept under a key ('reg' for the registries, 'cfg:<entity id>' for a config, 'data' for the shared board
   data's time). Its time is when the question was asked, not when the answer came.
   - An older answer never replaces a newer one (put() with an earlier time is refused).
   - changed(prefix) records that Home Assistant said something under that prefix changed ('cfg:' for every config):
     a fact asked before that is stale, though still held.
   - load(key) asks again, sharing a question already in flight that was asked late enough; asOfNow(key) answers
     what's held if it's fresh, and otherwise waits for an answer asked after the last change.
   - newer(a, b): whether a's fact was asked after b's. The board deletes nothing on the strength of a fact older
     than what it would delete (a function and its layout go only on registries asked after the board data).
   load(key) → a promise of the fact; now(): the time (for tests). */
export class Store {
  constructor(load, opt = {}) {
    this._load = load;
    this._now = opt.now || (() => Date.now());
    this._held = new Map();     // key → { value, asked }
    this._changes = new Map();  // prefix → when Home Assistant last said it changed
    this._flight = new Map();   // key → { asked, p } the question in flight
    this._last = 0;
  }
  // the time, never the same twice: of a change and a question in the same millisecond, the later call is later
  _tick() { let t = this._now(); if (t <= this._last) t = this._last + 0.001; this._last = t; return t; }
  // the time to give a question about to be asked elsewhere (put() it with the answer)
  stamp() { return this._tick(); }
  has(key) { return this._held.has(key); }
  get(key) { const h = this._held.get(key); return h ? h.value : undefined; }
  at(key) { const h = this._held.get(key); return h ? h.asked : 0; }
  put(key, value, asked) {
    const t = asked == null ? this._tick() : asked, h = this._held.get(key);
    if (h && h.asked > t) return false;
    this._held.set(key, { value, asked: t });
    return true;
  }
  changed(prefix, t) { const at = t == null ? this._tick() : t; this._changes.set(prefix, Math.max(this._changes.get(prefix) || 0, at)); }
  changedAt(key) { let t = 0; for (const [p, at] of this._changes) if (key.startsWith(p) && at > t) t = at; return t; }
  stale(key, maxAge) {
    const h = this._held.get(key);
    return !h || h.asked < this.changedAt(key) || (maxAge != null && this._now() - h.asked > maxAge);
  }
  newer(a, b) { return this.at(a) >= this.at(b); }
  // asks now (or shares a question in flight asked at or after `since`); answers the newest fact held after it
  load(key, since) {
    const f = this._flight.get(key);
    if (f && f.asked >= (since == null ? this._tick() : since)) return f.p;
    const asked = this._tick();
    let q;
    try { q = Promise.resolve(this._load(key)); } catch (e) { q = Promise.reject(e); }
    // (a question asked after this one, still in flight, has the newer answer: wait for it)
    const p = q.then(async (v) => {
      this.put(key, v, asked);
      const f = this._flight.get(key);
      if (f && f.asked > asked) { try { await f.p; } catch (e) { /* this answer is the newest there is, then */ } }
      return this.get(key);
    });
    const mine = { asked, p };
    this._flight.set(key, mine);
    const done = () => { if (this._flight.get(key) === mine) this._flight.delete(key); };
    p.then(done, done);
    return p;
  }
  asOfNow(key, maxAge) {
    if (!this.stale(key, maxAge)) return Promise.resolve(this.get(key));
    return this.load(key, Math.max(this.changedAt(key), maxAge != null ? this._now() - maxAge : 0));
  }
  forget(prefix) { for (const k of [...this._held.keys()]) if (k.startsWith(prefix)) this._held.delete(k); }
}

/* ---------- drawing (0.10.0): a view's HTML put on the page by updating what's there ----------
   morph(target, html) makes target's children what html says, as innerHTML would, but keeps the elements that are
   still there: matched by what they are (tag and data-key, data-id, data-label, data-fn, data-act, data-tid, data-e,
   data-i), else by tag in order. So the element with focus keeps it, a scrolled list keeps its place, and a
   listener someone put on an element stays. Attributes are made the same; a form field gets the value its HTML
   gives it (as innerHTML would), unless it has focus (what's being typed stays). Elements of the SVG namespace
   aren't drawn with it: an <svg>'s content is put whole. */
export const MORPH_IDS = ['data-key', 'data-id', 'data-label', 'data-fn', 'data-act', 'data-tid', 'data-e', 'data-i'];
export function morphId(n) {
  if (n.nodeType !== 1) return '#' + n.nodeType;
  const ids = MORPH_IDS.map((a) => n.getAttribute(a)).filter((v) => v != null);
  return n.tagName + (ids.length ? '|' + MORPH_IDS.map((a) => n.getAttribute(a) || '').join('|') : '');
}
export function morphAttrs(old, nu) {
  for (const a of [...old.attributes]) if (!nu.hasAttribute(a.name)) old.removeAttribute(a.name);
  for (const a of [...nu.attributes]) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
}
export function morphField(old, focused) {
  if (old === focused) return;
  const t = old.tagName;
  if (t === 'INPUT') {
    if (old.type === 'checkbox' || old.type === 'radio') old.checked = old.hasAttribute('checked');
    else if (old.type !== 'file') old.value = old.getAttribute('value') || '';
  } else if (t === 'TEXTAREA') old.value = old.textContent;
  else if (t === 'SELECT') {
    const opts = [...old.options], pick = opts.find((o) => o.hasAttribute('selected'));
    old.selectedIndex = pick ? opts.indexOf(pick) : opts.length && !old.multiple ? 0 : -1;
  }
}
export function morphChildren(old, nu, focused) {
  const olds = [...old.childNodes], used = new Set(), byId = new Map();
  olds.forEach((o) => { const k = morphId(o); if (!byId.has(k)) byId.set(k, []); byId.get(k).push(o); });
  let at = 0;
  const take = (o) => { used.add(o); const l = byId.get(morphId(o)); l.splice(l.indexOf(o), 1); return o; };
  [...nu.childNodes].forEach((n, i) => {
    const k = morphId(n);
    let o = null;
    if (n.nodeType === 1 && k.includes('|')) o = (byId.get(k) || [])[0] || null;
    else { while (at < olds.length && used.has(olds[at])) at++; for (let j = at; j < olds.length; j++) if (!used.has(olds[j]) && morphId(olds[j]) === k) { o = olds[j]; break; } }
    let el;
    if (o) {
      take(o);
      el = o;
      if (n.nodeType === 1) {
        morphAttrs(o, n);
        // an <svg>'s content, and an element of another namespace, put whole
        if (o.namespaceURI !== n.namespaceURI || /\/svg$/.test(o.namespaceURI || '')) { if (o.innerHTML !== n.innerHTML) o.innerHTML = n.innerHTML; }
        else morphChildren(o, n, focused);
        morphField(o, focused);
      } else if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
    } else el = old.ownerDocument.importNode(n, true);
    const here = old.childNodes[i];
    if (here !== el) old.insertBefore(el, here || null);
  });
  while (old.childNodes.length > nu.childNodes.length) old.removeChild(old.lastChild);
}
export function morph(target, html) {
  const doc = target.ownerDocument, tpl = doc.createElement('template');
  tpl.innerHTML = html;
  const root = target.getRootNode(), focused = (root && root.activeElement) || doc.activeElement;
  morphChildren(target, tpl.content, focused);
  // an element moved to its new place loses focus on the way: give it back
  if (focused && focused !== doc.body && target.contains(focused) && root.activeElement !== focused) focused.focus({ preventScroll: true });
}

/* ---------- the board's parts (0.10.0) ----------
   The board's class is in parts: each a block of its methods under a "part:" heading. A part's own state (owns)
   is used only by its own methods and by its view's action table (table, in _actionTables); any other part asks
   one of its methods. Everything not owned is the board's shared state (the part called core): what it knows
   (the store and its maps), the open function and its model, the board's modes (a version tab, the sandbox, a run
   lit on the board, an arrow being drawn) and the page. _init declares every piece of state and _relang clears
   it. A static rule holds all this (tests/static.test.js). */
export const PARTS = {
  list: { owns: ['_findQ'], table: 'list' },
  functions: { owns: ['_watch', '_fnIcon', '_fnColor'], table: 'create' },
  manager: { owns: ['_mgr', '_pick'], table: 'manager' },
  problems: { owns: ['_probs', '_checkRes', '_probScanning', '_chkEdit'], table: 'problems' },
  tools: { owns: ['_pendingTest', '_tw', '_monSubs', '_monData', '_monCount', '_monKind', '_testLog', '_testOk', '_msgs'], table: 'tools' },
  debug: { owns: ['_dbg', '_dbgSel', '_dbgFlt', '_dbgScrolled', '_dbgSeq'], table: 'debug' },
  arrows: { owns: ['_arw', '_tt'], table: 'arrows' },
  sandbox: { owns: [], table: 'sandbox' },
  builders: { owns: ['_bld'], table: 'builders' },
  versions: { owns: ['_verPending', '_verUrlDone', '_verSnaps', '_verDelPlan'], table: 'versions' },
  nodered: { owns: ['_nrCache', '_nrWait'] },
  diagnostics: { owns: [] },
};

// the board's action tables (one per view) as one map from a data-act name to its handler; a name in two tables
// is a mistake (the later would silently win), so it throws
export function actionMap(tables) {
  const m = new Map();
  for (const [view, t] of Object.entries(tables)) {
    for (const [name, fn] of Object.entries(t)) {
      if (m.has(name)) throw new Error(`the action ${name} is in two tables (${m.get(name).view} and ${view})`);
      if (typeof fn !== 'function') throw new Error(`the action ${name} (${view}) has no handler`);
      m.set(name, Object.assign(fn, { view }));
    }
  }
  return m;
}
