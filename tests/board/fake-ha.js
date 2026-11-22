// A fake Home Assistant for the board tests (layer 3, tests/board/): the board runs in a real browser page, and its
// hass object talks to this, in the test's own Node process, through a Playwright binding. It starts from what the
// real test Home Assistant answered (tests/board/garage.json, recorded by capture.js) and keeps the state a test
// changes: states, registries, automation and script configs, the board's store, versions, user data. Every call
// the board makes is recorded (fake.calls), and one the fake doesn't know is an error the tests look for
// (fake.unknown). The contract test on the real Home Assistant (tests/e2e/contract.test.js) keeps it honest.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD = path.join(__dirname, '..', '..', 'custom_components', 'functions_board', 'frontend', 'functions-board.js');
const SNAP = path.join(__dirname, 'garage.json');
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
class HAError extends Error { constructor(code, message) { super(message); this.code = code; } }

let SNAPSHOT = null;
const snapshot = () => (SNAPSHOT || (SNAPSHOT = JSON.parse(fs.readFileSync(SNAP, 'utf8'))));

class FakeHA {
  // opts: { mode: 'full'|'organise', admin: true, store: {data, revs} }
  constructor(opts = {}) {
    const s = snapshot();
    this.states = new Map(clone(s.states).map((x) => [x.entity_id, x]));
    this.entities = new Map(clone(s.entities).map((x) => [x.entity_id, x]));
    this.devices = clone(s.devices);
    this.areas = clone(s.areas);
    this.floors = clone(s.floors);
    this.labels = clone(s.labels);
    this.categories = clone(s.categories);
    this.services = clone(s.services);
    this.config = clone(s.config);
    this.panel = clone(s.panel);
    this.theme = s.theme || { dark: {}, light: {} };
    this.manifests = clone(s.manifests);
    this.users = clone(s.users);
    this.autos = clone(s.autos);
    this.scripts = clone(s.scripts);
    this.autoByEntity = clone(s.autoByEntity);
    this.entries = clone(s.entries);
    this.store = { data: clone((opts.store && opts.store.data) || {}), revs: clone((opts.store && opts.store.revs) || {}), mode: opts.mode || s.mode || 'organise' };
    this.versions = {};
    this.nodered = null;
    this.sources = {};  // what a derived helper reads (functions_board/sources), as a test sets it: id → { entities }
    // the recorder's history (history/history_during_period), as a test sets it: id → compressed rows, or a function
    // (from ms, to ms, ids) → that; an entity without any is its state now, at the start (nothing changed)
    this.history = {};
    this.helperEntries = [];  // helpers set up as config entries (config_entries/get by domain), as a test sets them
    this.userData = {};
    this.admin = opts.admin !== false;
    this.calls = [];
    this.unknown = [];
    this.pages = new Set();
    this.subs = new Map();  // key `${pageId}:${sid}` → { page, sid, msg }
    this.pageIds = new WeakMap();
    this.nextPage = 0;
    this.shift = 0;  // ms: the fake's clock is the pages' clock, set by open(..., { clock })
    // jitter (FB_JITTER=<seed>, through fixtures.js): every answer comes 0–JITTER_MS later, and every message to a
    // page (an event, a store change, a new hass) waits its turn in that page's queue for 0–JITTER_MS, so an event
    // can reach the board before or after the answer it goes with, as on a busy Home Assistant. Messages to one
    // page keep their order, as one websocket keeps them; answers to different calls don't. Seeded, so a failure
    // can be run again exactly (the seed is FB_JITTER and the test's name).
    const seed = opts.jitter != null ? opts.jitter : FakeHA.defaults.jitter;
    this.jitter = seed == null || seed === '' ? null : rng(String(seed));
    this.queues = new WeakMap();  // page → { last: when its last message is due, tail: that message's delivery }
    this.pending = 0;             // messages queued and not yet delivered
  }
  _lag() { return this.jitter ? new Promise((r) => setTimeout(r, Math.floor(this.jitter() * JITTER_MS))) : null; }
  // to one page, in order: at once without jitter; with it, each message is due 0–JITTER_MS from now, but never
  // before the one sent ahead of it (so messages don't pile up behind each other, and keep their order)
  _toPage(page, fn) {
    if (!this.jitter) return fn().catch(() => {});
    this.pending++;
    const q = this.queues.get(page) || { last: 0, tail: Promise.resolve() };
    const at = Math.max(q.last, Date.now() + Math.floor(this.jitter() * JITTER_MS));
    q.last = at;
    q.tail = q.tail.then(() => new Promise((r) => setTimeout(r, Math.max(0, at - Date.now())))).then(fn).catch(() => {}).finally(() => { this.pending--; });
    this.queues.set(page, q);
    return Promise.resolve();
  }
  _now() { return Date.now() + this.shift; }
  _iso() { return new Date(this._now()).toISOString(); }

  /* ---------- what the board sees ---------- */
  owner() { const u = this.users.find((x) => x.is_owner) || this.users[0] || { id: 'u1', name: 'Test Owner' }; return { id: u.id, name: u.name, is_admin: this.admin, is_owner: this.admin, credentials: [], mfa_modules: [] }; }
  view(dark) {
    return { states: Object.fromEntries(this.states), user: this.owner(), dark: !!dark, config: this.config, services: this.services, panel: this.panel, theme: dark ? this.theme.dark : this.theme.light };
  }

  // Open the board in a new browser context. opts: { light, viewport, clock (a Date or ISO time to install the
  // page clock at), route ('/functions' path), reducedMotion, init (a script run in the page before anything
  // else, as a test's own instruments) }. Returns { ctx, page }.
  async open(browser, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1400, height: 860 }, colorScheme: opts.light ? 'light' : 'dark', reducedMotion: opts.reducedMotion || 'no-preference' });
    const page = await ctx.newPage();
    const id = ++this.nextPage;
    this.pageIds.set(page, id);
    this.pages.add(page);
    page.fake = this;
    page.logs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.logs.push('console: ' + m.text()); });
    page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
    // a call the board reports as failed (its link warns of each) is an error too, unless the test expects that call
    // to fail (page.allowFail, as in tests/e2e/lib.js, where a failed answer on the websocket is one)
    page.on('console', (m) => {
      const x = m.type() === 'warning' && /^Functions Board: (\w+) (.+?) failed \((.*?)\)/.exec(m.text());
      if (x && !(page.allowFail || []).some((re) => re.test(x[1] === 'api' ? x[2].replace(/^[A-Z]+ /, '') : x[2]))) page.logs.push('reported: ' + m.text().slice(0, 300));
    });
    page.on('close', () => { this.pages.delete(page); for (const [k, v] of this.subs) if (v.page === page) this.subs.delete(k); });
    // nothing reaches a network: the page is served from here, and any other request (an editor's iframe, an
    // icon) gets an empty answer
    await ctx.route('**/*', (r) => {
      const url = r.request().url();
      if (url.startsWith('http://fake.ha/functions')) return r.fulfill({ contentType: 'text/html', body: this._html(opts) });
      if (url.startsWith('http://fake.ha/fb/functions-board.js')) return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(BOARD, 'utf8') });
      return r.fulfill({ status: 204, body: '' });
    });
    this.dark = this.dark || new WeakMap();
    this.dark.set(page, !opts.light);
    await page.exposeBinding('__fbHA', async (src, req) => {
      let r;
      try { r = { ok: true, result: await this._handle(page, req) }; } catch (e) { r = { ok: false, error: { code: e.code || 'unknown_error', message: e.message } }; }
      if (this.jitter && req.kind !== 'view') await this._lag();
      return r;
    });
    // the page's clock starts at that time and runs on; the fake's own times (state changes, events) keep to it
    if (opts.clock) { await page.clock.install({ time: opts.clock }); this.shift = new Date(opts.clock).getTime() - Date.now(); }
    if (opts.init) await page.addInitScript(opts.init);
    await page.addInitScript(PAGE_SIDE);
    await page.goto('http://fake.ha/functions' + (opts.route || ''));
    await page.waitForFunction(() => window.__fbReady === true, null, { timeout: 15000 });
    return { ctx, page };
  }
  _html() { return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><home-assistant></home-assistant></body></html>'; }

  // a new hass on every open page, as Home Assistant hands its frontend a new object on every change
  async push() { const v = this.view(), x = { states: v.states, config: v.config, services: v.services }; await Promise.all([...this.pages].map((p) => this._toPage(p, () => p.evaluate((y) => window.__fbPush && window.__fbPush(y), x)))); }
  async _deliver(filter, payload) {
    const jobs = [];
    for (const v of this.subs.values()) if (filter(v.msg)) jobs.push(this._toPage(v.page, () => v.page.evaluate(([sid, m]) => window.__fbDeliver(sid, m), [v.sid, payload])));
    await Promise.all(jobs);
  }
  async emit(eventType, data) {
    const ev = { event_type: eventType, data: data || {}, origin: 'LOCAL', time_fired: this._iso(), context: { id: crypto.randomBytes(13).toString('hex'), parent_id: null, user_id: null } };
    await this._deliver((m) => m.type === 'subscribe_events' && (!m.event_type || m.event_type === eventType), ev);
    // a trigger watched with subscribe_trigger (the board's script reload watch, Watch triggers)
    await this._deliver((m) => m.type === 'subscribe_trigger' && m.trigger && m.trigger.trigger === 'event' && m.trigger.event_type === eventType
      && Object.entries(m.trigger.event_data || {}).every(([k, v]) => (data || {})[k] === v), { variables: { trigger: { platform: 'event', event: ev } } });
  }
  // as the integration does (__init__.py notify): to functions_board/subscribe only, no event on the bus
  async notifyStore(change) { await this._deliver((m) => m.type === 'functions_board/subscribe', change); }

  // Wait until the board has asked nothing for `quiet` ms (it has finished what the last change set off): the
  // fake's answer to "is the board done?" without guessing a wait. Gives up after `max` ms.
  async idle(quiet = 400, max = 10000) {
    const end = Date.now() + max;
    let n = this.calls.length, since = Date.now();
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
      if (this.calls.length !== n || this.pending) { n = this.calls.length; since = Date.now(); } else if (Date.now() - since >= quiet) return true;
    }
    return false;
  }

  /* ---------- changes a test makes, as Home Assistant would show them ---------- */
  // lag (ms): the page hears of it that much later (as when Home Assistant's state event comes after its answer)
  async setState(id, state, attributes, lag) {
    const old = this.states.get(id), t = this._iso();
    const s = { entity_id: id, state: String(state), attributes: Object.assign({}, old ? old.attributes : {}, attributes || {}), last_changed: old && old.state === String(state) ? old.last_changed : t, last_reported: t, last_updated: t, context: { id: crypto.randomBytes(13).toString('hex'), parent_id: null, user_id: null } };
    this.states.set(id, s);
    const tell = async () => { await this.push(); await this.emit('state_changed', { entity_id: id, old_state: old || null, new_state: s }); };
    if (lag) setTimeout(() => tell().catch(() => {}), lag); else await tell();
  }
  async removeState(id) { this.states.delete(id); await this.push(); }

  /* ---------- the board's calls ---------- */
  // what a new subscription gets straight away (after its result), as Home Assistant sends it
  _firstMessage(msg) {
    const s = snapshot();
    if (msg.type === 'trigger_platforms/subscribe') return s.triggerPlatforms || {};
    if (msg.type === 'condition_platforms/subscribe') return s.conditionPlatforms || {};
    if (msg.type === 'render_template') return { error: 'templates are rendered by the real Home Assistant (tests/e2e)', level: 'ERROR' };
    return undefined;
  }
  async _handle(page, req) {
    const { kind, m } = req;
    if (kind === 'sub') {
      const key = `${this.pageIds.get(page)}:${m.sid}`;
      this.subs.set(key, { page, sid: m.sid, msg: m.msg });
      this.calls.push({ kind: 'sub', type: m.msg.type, msg: m.msg });
      const r = await this._subscribed(m.msg), firstMsg = this._firstMessage(m.msg);
      if (firstMsg !== undefined) setTimeout(() => this._toPage(page, () => page.evaluate(([sid, x]) => window.__fbDeliver(sid, x), [m.sid, firstMsg])), 0);
      return r;
    }
    if (kind === 'view') return this.view(this.dark.get(page) !== false);
    if (kind === 'unsub') { this.subs.delete(`${this.pageIds.get(page)}:${m.sid}`); return null; }
    if (kind === 'ws') { this.calls.push({ kind: 'ws', type: m.type, msg: m }); return this.ws(m); }
    if (kind === 'api') { this.calls.push({ kind: 'api', method: m.method, path: m.path, body: m.body }); return this.api(m.method, m.path, m.body); }
    if (kind === 'svc') { this.calls.push({ kind: 'svc', domain: m.domain, service: m.service, data: m.data, target: m.target }); return this.service(m.domain, m.service, m.data, m.target); }
    throw new HAError('unknown_command', 'fake: ' + kind);
  }
  _unknown(what) { this.unknown.push(what); throw new HAError('unknown_command', 'fake Home Assistant: unknown command ' + what); }
  _admin() { if (!this.admin) throw new HAError('unauthorized', 'Unauthorized'); }

  // a subscription's answer; render_template answers at once that templates are the real Home Assistant's
  async _subscribed(msg) {
    switch (msg.type) {
      case 'subscribe_events': case 'subscribe_trigger': case 'logbook/event_stream': case 'mqtt/subscribe': return null;
      case 'functions_board/subscribe': this._admin(); return null;
      case 'render_template': return null;
      // purpose-specific triggers and conditions: Home Assistant's own descriptions, recorded, sent at once
      case 'trigger_platforms/subscribe': case 'condition_platforms/subscribe': return null;
      default: return this._unknown(msg.type);
    }
  }

  async ws(m) {
    const ent = (id) => this.entities.get(id);
    // a test's own answer for one message type (a value, or a function of the message): fake.answers[type]
    // (a function may wait, or throw: a failure as Home Assistant would send it, { code, message })
    if (this.answers && Object.prototype.hasOwnProperty.call(this.answers, m.type)) { const a = this.answers[m.type]; return clone(typeof a === 'function' ? await a(m) : a); }
    switch (m.type) {
      // registries
      case 'config/entity_registry/list': return [...this.entities.values()];
      case 'config/entity_registry/list_for_display': return { entities: [...this.entities.values()].map((e) => ({ ei: e.entity_id, lb: e.labels || [] })), entity_categories: {} };
      case 'config/entity_registry/get': { const e = ent(m.entity_id); if (!e) throw new HAError('not_found', 'Entity not found'); return Object.assign({ aliases: [], options: {}, capabilities: null, device_class: null, original_device_class: null, original_icon: null }, e); }
      case 'config/entity_registry/update': {
        const e = ent(m.entity_id); if (!e) throw new HAError('not_found', 'Entity not found');
        const changes = {};
        for (const k of ['labels', 'categories', 'name', 'icon', 'area_id', 'disabled_by', 'hidden_by', 'aliases']) if (k in m) { e[k] = clone(m[k]); changes[k] = true; }
        if (m.categories) e.categories = Object.assign({}, e.categories || {}, m.categories);
        e.modified_at = this._now() / 1000;
        await this.emit('entity_registry_updated', { action: 'update', entity_id: e.entity_id, changes });
        return { entity_entry: e };
      }
      case 'config/entity_registry/remove': this.entities.delete(m.entity_id); await this.emit('entity_registry_updated', { action: 'remove', entity_id: m.entity_id }); return null;
      case 'config/device_registry/list': return this.devices;
      case 'config/device_registry/update': { const d = this.devices.find((x) => x.id === m.device_id); if (!d) throw new HAError('not_found', 'Device not found'); for (const k of ['labels', 'area_id', 'name_by_user', 'disabled_by']) if (k in m) d[k] = clone(m[k]); await this.emit('device_registry_updated', { action: 'update', device_id: d.id, changes: {} }); return d; }
      case 'config/area_registry/list': return this.areas;
      case 'config/area_registry/update': { const a = this.areas.find((x) => x.area_id === m.area_id); if (a) for (const k of ['labels', 'name']) if (k in m) a[k] = clone(m[k]); return a; }
      case 'config/floor_registry/list': return this.floors;
      case 'config/label_registry/list': return this.labels;
      case 'config/label_registry/create': {
        let id = slug(m.name), n = 2; while (this.labels.some((l) => l.label_id === id)) id = slug(m.name) + '_' + n++;
        const l = { label_id: id, name: m.name, icon: m.icon || null, color: m.color || null, description: m.description || null, created_at: this._now() / 1000, modified_at: this._now() / 1000 };
        this.labels.push(l); await this.emit('label_registry_updated', { action: 'create', label_id: id }); return l;
      }
      case 'config/label_registry/update': { const l = this.labels.find((x) => x.label_id === m.label_id); if (!l) throw new HAError('not_found', 'Label not found'); for (const k of ['name', 'icon', 'color', 'description']) if (k in m) l[k] = m[k]; l.modified_at = this._now() / 1000; await this.emit('label_registry_updated', { action: 'update', label_id: l.label_id }); return l; }
      case 'config/label_registry/delete': {
        this.labels = this.labels.filter((x) => x.label_id !== m.label_id);
        for (const e of this.entities.values()) if ((e.labels || []).includes(m.label_id)) e.labels = e.labels.filter((x) => x !== m.label_id);
        for (const d of this.devices) if ((d.labels || []).includes(m.label_id)) d.labels = d.labels.filter((x) => x !== m.label_id);
        await this.emit('label_registry_updated', { action: 'remove', label_id: m.label_id }); return null;
      }
      case 'config/category_registry/list': return this.categories[m.scope] || [];
      case 'config/category_registry/create': { const c = { category_id: crypto.randomBytes(13).toString('hex').toUpperCase(), name: m.name, icon: m.icon || null, created_at: this._now() / 1000, modified_at: this._now() / 1000 }; (this.categories[m.scope] = this.categories[m.scope] || []).push(c); return c; }
      case 'config/category_registry/delete': this.categories[m.scope] = (this.categories[m.scope] || []).filter((c) => c.category_id !== m.category_id); return null;
      case 'config/auth/list': return this.users;
      case 'config_entries/get': return m.domain === 'functions_board' ? this.entries : (this.helperEntries || []).filter((e) => e.domain === m.domain);
      case 'manifest/list': return this.manifests;
      case 'frontend/get_translations': return { resources: {} };
      case 'frontend/get_user_data': return { value: this.userData[m.key] === undefined ? null : clone(this.userData[m.key]) };
      case 'frontend/set_user_data': this.userData[m.key] = clone(m.value); return null;
      // automations and scripts
      case 'automation/config': {
        if (this.autoByEntity[m.entity_id]) return { config: clone(this.autoByEntity[m.entity_id]) };
        const s = this.states.get(m.entity_id), id = s && s.attributes.id;
        if (id && this.autos[id]) return { config: clone(this.autos[id]) };
        throw new HAError('not_found', 'Entity not found');
      }
      case 'script/config': {
        const oid = String(m.entity_id || '').replace(/^script\./, '');
        if (this.scripts[oid]) return { config: clone(this.scripts[oid]) };
        throw new HAError('not_found', 'Entity not found');
      }
      case 'trace/list': return [];
      case 'trace/get': throw new HAError('not_found', 'The trace could not be found');
      case 'logbook/get_action_calls': return [];
      case 'extract_from_target': return { referenced_entities: [], referenced_devices: [], referenced_areas: [], missing_devices: [], missing_areas: [], missing_floors: [], missing_labels: [] };
      case 'validate_config': return Object.fromEntries(['triggers', 'conditions', 'actions', 'trigger', 'condition', 'action'].filter((k) => k in m).map((k) => [k, { valid: true, error: null }]));
      case 'test_condition': return { result: true };
      case 'fire_event': await this.emit(m.event_type, m.event_data || {}); return { context: { id: 'x' } };
      case 'call_service': return this.service(m.domain, m.service, m.service_data, m.target);
      case 'mobile_app_notification_action': return null;
      case 'supervisor/api': throw new HAError('unknown_command', 'Unknown command.');
      case 'blueprint/substitute': throw new HAError('not_found', 'Blueprint not found');
      // the integration's own commands (websocket.py)
      case 'functions_board/get': this._admin(); return { data: clone(this.store.data), revs: clone(this.store.revs), mode: this.store.mode };
      case 'functions_board/set': {
        this._admin();
        const data = clone(m.data); delete data.revs;
        this.store.data = data;
        const layouts = data.layouts && typeof data.layouts === 'object' ? data.layouts : {};
        this.store.revs = Object.fromEntries(Object.keys(layouts).map((l) => [l, (this.store.revs[l] || 0) + 1]));
        await this.notifyStore({ what: 'all', client: m.client || '' });
        return null;
      }
      case 'functions_board/set_functions': this._admin(); this.store.data = Object.assign({}, this.store.data, { functions: [...new Set(m.functions)] }); await this.notifyStore({ what: 'functions', client: m.client || '' }); return null;
      case 'functions_board/set_layout': {
        this._admin();
        const layouts = this.store.data.layouts && typeof this.store.data.layouts === 'object' ? Object.assign({}, this.store.data.layouts) : {};
        const cur = this.store.revs[m.label] || 0;
        if (m.rev != null && m.rev !== cur) return { conflict: true, rev: cur, layout: layouts[m.label] === undefined ? null : clone(layouts[m.label]) };
        if (m.layout == null) delete layouts[m.label]; else layouts[m.label] = clone(m.layout);
        this.store.data = Object.assign({}, this.store.data, { layouts });
        this.store.revs = Object.assign({}, this.store.revs, { [m.label]: cur + 1 });
        await this.notifyStore({ what: 'layout', label: m.label, rev: cur + 1, client: m.client || '' });
        return { rev: cur + 1 };
      }
      case 'history/history_during_period': {
        const from = Date.parse(m.start_time), to = m.end_time ? Date.parse(m.end_time) : Date.now(), ids = m.entity_ids || [];
        const h = typeof this.history === 'function' ? this.history(from, to, ids) : this.history;
        return Object.fromEntries(ids.filter((k) => (h && h[k]) || this.states.has(k)).map((k) => [k, h && h[k] ? clone(h[k])
          : [Object.assign({ s: this.states.get(k).state, lu: from / 1000 }, m.no_attributes ? {} : { a: clone(this.states.get(k).attributes || {}) })]]));
      }
      case 'functions_board/sources': this._admin(); return { sources: Object.fromEntries((m.entity_ids || []).filter((k) => this.sources[k]).map((k) => [k, clone(this.sources[k])])) };
      case 'functions_board/nodered': this._admin(); return { kept: clone(this.nodered) };
      case 'functions_board/nodered_keep': this._admin(); this.nodered = { at: this._now(), slug: m.slug, groups: clone(m.groups) }; await this.notifyStore({ what: 'nodered', client: m.client || '' }); return null;
      case 'functions_board/versions': this._admin(); return { versions: (this.versions[m.label] || []).map(meta), active: (this.vactive || {})[m.label] || null };
      case 'functions_board/version_get': { this._admin(); const v = (this.versions[m.label] || []).find((x) => x.id === m.version_id); if (!v) throw new HAError('not_found', 'No such version'); return clone(v); }
      case 'functions_board/version_save': {
        this._admin();
        const vs = (this.versions[m.label] = this.versions[m.label] || []);
        const size = Buffer.byteLength(JSON.stringify(m.snapshot));
        if (size > 1000000) throw new HAError('too_large', 'A snapshot can be at most 1 MB');
        while (m.auto && vs.length >= 50 && vs.some((v) => v.auto)) vs.splice(vs.findIndex((v) => v.auto), 1);
        if (vs.length >= 50) throw new HAError('too_many', 'A function can keep at most 50 versions');
        const v = { id: crypto.randomBytes(16).toString('hex'), name: m.name, desc: m.desc || '', at: this._now(), by: this.owner().name, size, auto: !!m.auto, print: m.print || '', snapshot: clone(m.snapshot) };
        vs.push(v);
        if (!m.auto) (this.vactive = this.vactive || {})[m.label] = { id: v.id, print: m.print || '' };
        await this.notifyStore({ what: 'versions', label: m.label, client: m.client || '' });
        return meta(v);
      }
      // 0.11.3: Save over a version on purpose; which version the function was last made from
      case 'functions_board/version_overwrite': {
        this._admin();
        const v = (this.versions[m.label] || []).find((x) => x.id === m.version_id);
        if (!v) throw new HAError('not_found', 'No such version');
        Object.assign(v, { snapshot: clone(m.snapshot), print: m.print, size: Buffer.byteLength(JSON.stringify(m.snapshot)), at: this._now(), by: this.owner().name, auto: false });
        (this.vactive = this.vactive || {})[m.label] = { id: v.id, print: m.print };
        await this.notifyStore({ what: 'versions', label: m.label, client: m.client || '' });
        return meta(v);
      }
      case 'functions_board/version_active': {
        this._admin();
        this.vactive = this.vactive || {};
        if (m.version_id == null) delete this.vactive[m.label];
        else if (!(this.versions[m.label] || []).some((x) => x.id === m.version_id)) throw new HAError('not_found', 'No such version');
        else this.vactive[m.label] = { id: m.version_id, print: m.print || '' };
        await this.notifyStore({ what: 'versions', label: m.label, client: m.client || '' });
        return null;
      }
      case 'functions_board/version_edit': { this._admin(); const v = (this.versions[m.label] || []).find((x) => x.id === m.version_id); if (!v) throw new HAError('not_found', 'No such version'); if (m.name != null) v.name = m.name; if (m.desc != null) v.desc = m.desc; await this.notifyStore({ what: 'versions', label: m.label, client: m.client || '' }); return meta(v); }
      case 'functions_board/version_delete': {
        this._admin();
        const vs = this.versions[m.label] || [];
        if (m.version_id) { const i = vs.findIndex((x) => x.id === m.version_id); if (i < 0) throw new HAError('not_found', 'No such version'); vs.splice(i, 1); } else delete this.versions[m.label];
        if (this.vactive && this.vactive[m.label] && (!m.version_id || this.vactive[m.label].id === m.version_id)) delete this.vactive[m.label];
        await this.notifyStore({ what: 'versions', label: m.label, client: m.client || '' });
        return null;
      }
      case 'functions_board/diagnostics': this._admin(); return { about: { integration: this.config.version, anonymised: !!m.anonymise, made_by: m.how || 'board' }, board: Object.assign({ functions: [], layouts: {} }, clone(this.store.data)), versions: {}, nodered: null };
      default: {
        const hc = /^(input_boolean|input_number|input_select|input_text|input_datetime|input_button|timer|counter|schedule)\/(create|update|delete)$/.exec(m.type);
        if (hc) return this._helper(hc[1], hc[2], m);
        // a helper domain's list of the helpers made in the UI
        const d = /^([a-z_]+)\/list$/.exec(m.type);
        const lists = this.helperLists || snapshot().helperLists || {};
        if (d && d[1] in lists) return clone(lists[d[1]]);
        return this._unknown(m.type);
      }
    }
  }

  async api(method, p, body) {
    let m;
    if (method === 'GET' && p === 'events') return [...new Set(['state_changed', 'call_service', 'automation_triggered', 'script_started', 'timer.finished'])].map((e) => ({ event: e, listener_count: 1 }));
    if (method === 'GET' && /^config\/config_entries\/flow_handlers/.test(p)) return [];
    if ((m = p.match(/^states\/(.+)$/)) && method === 'POST') { await this.setState(decodeURIComponent(m[1]), body.state, body.attributes, this.stateLag); return clone(this.states.get(decodeURIComponent(m[1]))); }
    if ((m = p.match(/^config\/automation\/config\/(.+)$/))) {
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') { if (!this.autos[id]) throw new HAError('not_found', 'Resource not found'); return clone(this.autos[id]); }
      if (method === 'POST') { this.autos[id] = Object.assign({ id }, clone(body)); await this._automationSaved(id); return { result: 'ok' }; }
      if (method === 'DELETE') { if (!this.autos[id]) throw new HAError('not_found', 'Resource not found'); delete this.autos[id]; await this._automationGone(id); return { result: 'ok' }; }
    }
    // a scene made in the editor: what it sets (the sandbox applies it)
    if ((m = p.match(/^config\/scene\/config\/(.+)$/)) && method === 'GET') { const c = (this.sceneCfgs || {})[decodeURIComponent(m[1])]; if (!c) throw new HAError('not_found', 'Resource not found'); return clone(c); }
    if ((m = p.match(/^config\/script\/config\/(.+)$/))) {
      const oid = decodeURIComponent(m[1]);
      if (method === 'GET') { if (!this.scripts[oid]) throw new HAError('not_found', 'Resource not found'); return clone(this.scripts[oid]); }
      if (method === 'POST') { this.scripts[oid] = clone(body); await this._scriptSaved(oid); return { result: 'ok' }; }
      if (method === 'DELETE') { if (!this.scripts[oid]) throw new HAError('not_found', 'Resource not found'); delete this.scripts[oid]; this.states.delete('script.' + oid); this.entities.delete('script.' + oid); await this.push(); await this.emit('call_service', { domain: 'script', service: 'reload', service_data: {} }); return { result: 'ok' }; }
    }
    if ((m = p.match(/^config\/config_entries\/entry\/(.+)$/)) && method === 'DELETE') { this.entries = this.entries.filter((e) => e.entry_id !== m[1]); this.helperEntries = (this.helperEntries || []).filter((e) => e.entry_id !== m[1]); return { require_restart: false }; }
    if (p === 'config/config_entries/options/flow' && method === 'POST') return { flow_id: 'fakeflow', type: 'form', step_id: 'init' };
    // new options apply in place and open boards are told the mode (__init__.py, the options update listener)
    if (p === 'config/config_entries/options/flow/fakeflow' && method === 'POST') { if (body && body.mode) { this.store.mode = body.mode; await this.notifyStore({ what: 'mode', mode: this.store.mode, client: '' }); } return { type: 'create_entry' }; }
    return this._unknown(`${method} ${p}`);
  }

  async _helper(domain, op, m) {
    const lists = this.helperLists = this.helperLists || clone(snapshot().helperLists || {});
    const list = (lists[domain] = lists[domain] || []);
    if (op === 'create') {
      const f = Object.assign({}, m); delete f.type; delete f.id;
      let oid = slug(f.name), n = 2; while (this.states.has(domain + '.' + oid)) oid = slug(f.name) + '_' + n++;
      const item = Object.assign({ id: oid }, f);
      list.push(item);
      const eid = domain + '.' + oid;
      const initial = { input_boolean: f.initial ? 'on' : 'off', counter: String(f.initial || 0), timer: 'idle', input_number: String(f.initial != null ? f.initial : f.min || 0), input_text: f.initial || '', input_select: (f.options || [])[0] || 'unknown', input_button: 'unknown', input_datetime: 'unknown', schedule: 'off' }[domain];
      this.entities.set(eid, { entity_id: eid, unique_id: oid, platform: domain, name: null, original_name: f.name, labels: [], categories: {}, area_id: null, device_id: null, disabled_by: null, hidden_by: null, entity_category: null, icon: f.icon || null, id: crypto.randomBytes(16).toString('hex'), has_entity_name: false, options: {}, config_entry_id: null, translation_key: null, created_at: this._now() / 1000, modified_at: this._now() / 1000 });
      await this.emit('entity_registry_updated', { action: 'create', entity_id: eid });
      await this.setState(eid, initial, { friendly_name: f.name, editable: true });
      return item;
    }
    const id = m[domain + '_id'], it = list.find((x) => x.id === id);
    if (!it) throw new HAError('not_found', 'Unable to find ' + domain + '_id ' + id);
    if (op === 'update') { Object.assign(it, m); delete it.type; delete it[domain + '_id']; return it; }
    list.splice(list.indexOf(it), 1);
    this.entities.delete(domain + '.' + id); await this.removeState(domain + '.' + id);
    return null;
  }
  async _automationSaved(id) {
    const cfg = this.autos[id];
    let eid = [...this.states.values()].find((s) => s.entity_id.startsWith('automation.') && s.attributes.id === id);
    eid = eid ? eid.entity_id : 'automation.' + slug(cfg.alias || id);
    const old = this.states.get(eid);
    this.states.set(eid, { entity_id: eid, state: old ? old.state : 'on', attributes: { id, last_triggered: old ? old.attributes.last_triggered : null, mode: cfg.mode || 'single', current: 0, friendly_name: cfg.alias || id }, last_changed: this._iso(), last_reported: this._iso(), last_updated: this._iso(), context: { id: 'x', parent_id: null, user_id: null } });
    if (!this.entities.has(eid)) this.entities.set(eid, { entity_id: eid, unique_id: id, platform: 'automation', name: null, original_name: cfg.alias || id, labels: [], categories: {}, area_id: null, device_id: null, disabled_by: null, hidden_by: null, entity_category: null, icon: null, id: crypto.randomBytes(16).toString('hex'), has_entity_name: false, options: {}, config_entry_id: null, translation_key: null, created_at: this._now() / 1000, modified_at: this._now() / 1000 });
    delete this.autoByEntity[eid];
    await this.push();
    await this.emit('automation_reloaded', {});
  }
  async _automationGone(id) {
    const s = [...this.states.values()].find((x) => x.entity_id.startsWith('automation.') && x.attributes.id === id);
    if (s) { this.states.delete(s.entity_id); this.entities.delete(s.entity_id); }
    await this.push();
    await this.emit('automation_reloaded', {});
  }
  async _scriptSaved(oid) {
    const cfg = this.scripts[oid], eid = 'script.' + oid, old = this.states.get(eid);
    this.states.set(eid, { entity_id: eid, state: old ? old.state : 'off', attributes: { last_triggered: old ? old.attributes.last_triggered : null, mode: cfg.mode || 'single', current: 0, friendly_name: cfg.alias || oid }, last_changed: this._iso(), last_reported: this._iso(), last_updated: this._iso(), context: { id: 'x', parent_id: null, user_id: null } });
    if (!this.entities.has(eid)) this.entities.set(eid, { entity_id: eid, unique_id: oid, platform: 'script', name: null, original_name: cfg.alias || oid, labels: [], categories: {}, area_id: null, device_id: null, disabled_by: null, hidden_by: null, entity_category: null, icon: null, id: crypto.randomBytes(16).toString('hex'), has_entity_name: false, options: {}, config_entry_id: null, translation_key: null, created_at: this._now() / 1000, modified_at: this._now() / 1000 });
    await this.push();
    await this.emit('call_service', { domain: 'script', service: 'reload', service_data: {} });
  }

  async service(domain, service, data, target) {
    const ids = [].concat((target && target.entity_id) || (data && data.entity_id) || []);
    const set = async (state) => { for (const id of ids) if (this.states.has(id)) await this.setState(id, state); };
    if (domain === 'automation' || domain === 'input_boolean' || domain === 'switch' || domain === 'light') {
      if (service === 'turn_on') await set('on');
      else if (service === 'turn_off') await set('off');
      else if (service === 'toggle') for (const id of ids) if (this.states.has(id)) await this.setState(id, this.states.get(id).state === 'on' ? 'off' : 'on');
    } else if (domain === 'cover') {
      if (service === 'open_cover') await set('open'); else if (service === 'close_cover') await set('closed');
    }
    await this.emit('call_service', { domain, service, service_data: Object.assign({}, data || {}, target || {}) });
    return { context: { id: 'x' }, response: null };
  }
}
const meta = (v) => { const o = clone(v); delete o.snapshot; return o; };
FakeHA.defaults = { jitter: null };
const JITTER_MS = +(process.env.FB_JITTER_MS || 120);
// a small seeded random number generator (mulberry32 on a hash of the seed): the same seed, the same delays
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Runs in the page: the hass object the board is given, its connection, and the way the fake reaches it.
const PAGE_SIDE = `(() => {
  const subs = new Map(); let sid = 0, view = null;
  const call = (kind, m) => window.__fbHA({ kind, m }).then((r) => (r.ok ? r.result : Promise.reject(r.error)));
  const conn = {
    subscribeMessage: async (cb, msg) => { const id = ++sid; subs.set(id, cb); await call('sub', { sid: id, msg }); return async () => { subs.delete(id); await call('unsub', { sid: id }).catch(() => {}); }; },
    subscribeEvents: (cb, type) => conn.subscribeMessage(cb, type ? { type: 'subscribe_events', event_type: type } : { type: 'subscribe_events' }),
    sendMessagePromise: (m) => call('ws', m),
    // as Home Assistant's connection: 'ready' each time it comes back after it was lost (window.__fbReconnect)
    addEventListener: (t, cb) => { if (!on.has(t)) on.set(t, new Set()); on.get(t).add(cb); },
    removeEventListener: (t, cb) => { if (on.has(t)) on.get(t).delete(cb); },
  };
  const on = new Map();
  // the connection lost and back: its subscriptions carry on, but what was sent meanwhile never came
  window.__fbReconnect = () => { [...(on.get('ready') || [])].forEach((cb) => cb(conn)); };
  window.__fbConnListeners = () => [...on.values()].reduce((n, x) => n + x.size, 0);
  const make = () => ({
    states: view.states, user: view.user, themes: { darkMode: view.dark, themes: {}, default_theme: 'default' }, selectedTheme: null,
    language: 'en', locale: { language: 'en', number_format: 'language', time_format: 'language' }, config: view.config, services: view.services,
    panels: { functions: view.panel }, connected: true, auth: { external: null, data: { hassUrl: location.origin } },
    callWS: (m) => call('ws', m), callApi: (method, path, body) => call('api', { method, path, body }),
    callService: (domain, service, data, target) => call('svc', { domain, service, data, target }),
    formatEntityState: (st, state) => (state !== undefined ? String(state) : st.state),
    connection: conn,
  });
  if (!customElements.get('ha-icon')) {
    customElements.define('ha-icon', class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<style>:host{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;fill:currentColor;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}svg{width:100%;height:100%}</style><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
      }
    });
  }
  window.__fbBoot = (v) => {
    view = v;
    const root = document.documentElement;
    Object.entries(v.theme || {}).forEach(([k, x]) => root.style.setProperty(k, x));
    root.style.background = (v.theme || {})['--primary-background-color'] || (v.dark ? '#111111' : '#fafafa');
    const ha = document.querySelector('home-assistant'); if (ha) ha.hass = make();
  };
  window.__fbAttach = () => {
    const el = document.createElement('functions-board');
    el.panel = view.panel; el.narrow = false; el.route = { prefix: '/functions', path: '' };
    el.hass = make();
    document.body.appendChild(el);
  };
  // the page starts itself, on the first load and after a reload: Home Assistant's state, then the board
  const start = async () => {
    const v = await window.__fbHA({ kind: 'view' });
    window.__fbBoot(v.result);
    await import('/fb/functions-board.js');
    await customElements.whenDefined('functions-board');
    window.__fbAttach();
    window.__fbReady = true;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  // (a change can come while a page is still loading: there's no element to hand it to yet)
  // (to the board on the page: one taken off isn't held here, so a test can see it let go)
  window.__fbPush = (x) => { if (!view) return; view = Object.assign({}, view, x); const h = make(); const ha = document.querySelector('home-assistant'); if (ha) ha.hass = h; const el = document.querySelector('functions-board'); if (el) el.hass = h; };
  window.__fbDeliver = (id, m) => { const cb = subs.get(id); if (cb) cb(m); };
})();`;

module.exports = { FakeHA, snapshot, BOARD };
