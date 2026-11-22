// Home Assistant from Node, without a browser: REST and websocket calls with the owner's login (renewed when its
// 30 minutes run out), and the snapshot/restore that keeps each browser test from leaking into the next.
const fs = require('fs');
const path = require('path');

const BASE = process.env.FB_HA_URL || 'http://127.0.0.1:8123';
const STATE = process.env.FB_E2E_STATE || path.join(__dirname, '.state');
const CID = BASE + '/';

let tok = null;
async function token() {
  if (tok && tok.until > Date.now() + 60000) return tok.access;
  const file = path.join(STATE, 'owner_token.json'), t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await fetch(BASE + '/auth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: CID }) });
  if (!r.ok) throw new Error('ha-api: could not renew the owner login (' + r.status + '); run hasetup.js');
  const j = await r.json();
  tok = { access: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return tok.access;
}

async function rest(method, p, body) {
  const r = await fetch(BASE + '/api/' + p, { method, headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`${method} ${p}: ${r.status} ${text.slice(0, 200)}`); e.status = r.status; throw e; }
  try { return JSON.parse(text); } catch (e) { return text; }
}

// one websocket connection per call batch: open, authenticate, send each message in turn, close
async function ws(...msgs) {
  const sock = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/websocket');
  const queue = [], waiters = [];
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); (Array.isArray(m) ? m : [m]).forEach((x) => { const w = waiters.shift(); if (w) w(x); else queue.push(x); }); });
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((res) => waiters.push(res)));
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('ha-api: websocket failed')), { once: true }); });
  try {
    await next();  // auth_required
    sock.send(JSON.stringify({ type: 'auth', access_token: await token() }));
    const a = await next();
    if (a.type !== 'auth_ok') throw new Error('ha-api: websocket login refused');
    const out = [];
    let id = 0;
    for (const m of msgs) {
      sock.send(JSON.stringify(Object.assign({ id: ++id }, m)));
      let r;
      do { r = await next(); } while (r.id !== id);
      if (!r.success) throw new Error(`${m.type}: ${JSON.stringify(r.error)}`);
      out.push(r.result);
    }
    return msgs.length === 1 ? out[0] : out;
  } finally { sock.close(); }
}

// What a browser test may change, as it is now: the configs of every UI-made automation and script, which
// automations are on, the helpers and scenes made in the UI, the areas, what the registries say of each entity and
// device (labels, area, name, icon), and the labels, categories, board data and test dashboards.
const HELPERS = ['input_boolean', 'input_number', 'input_select', 'input_text', 'input_datetime', 'input_button', 'counter', 'timer', 'schedule'];
const ENT_FIELDS = ['labels', 'area_id', 'name', 'icon'], DEV_FIELDS = ['labels', 'area_id', 'name_by_user'];
const fields = (x, keys) => Object.fromEntries(keys.map((k) => [k, Array.isArray(x[k]) ? [...x[k]].sort() : x[k] == null ? null : x[k]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// a helper domain this Home Assistant hasn't loaded has no list: none of it
const helperIds = async () => Object.fromEntries(await Promise.all(HELPERS.map(async (d) => [d, ((await ws({ type: d + '/list' }).catch(() => [])) || []).map((h) => h.id)])));
async function snapshot() {
  const states = await rest('GET', 'states');
  const [ents, devs, areas] = await ws({ type: 'config/entity_registry/list' }, { type: 'config/device_registry/list' }, { type: 'config/area_registry/list' });
  const reg = {
    ents: Object.fromEntries(ents.map((e) => [e.entity_id, fields(e, ENT_FIELDS)])),
    devs: Object.fromEntries(devs.map((d) => [d.id, fields(d, DEV_FIELDS)])),
    areas: areas.map((a) => a.area_id),
    helpers: await helperIds(),
    scenes: states.filter((x) => x.entity_id.startsWith('scene.') && x.attributes.id).map((x) => x.attributes.id),
  };
  const autos = {}, scripts = {}, on = {};
  for (const s of states) {
    if (s.entity_id.startsWith('automation.') && s.attributes.id) {
      try { autos[s.attributes.id] = await rest('GET', 'config/automation/config/' + encodeURIComponent(s.attributes.id)); on[s.attributes.id] = { entity: s.entity_id, state: s.state }; } catch (e) { /* YAML without an id: can't be changed from the UI either */ }
    } else if (s.entity_id.startsWith('script.')) {
      const oid = s.entity_id.slice(7);
      try { scripts[oid] = await rest('GET', 'config/script/config/' + encodeURIComponent(oid)); } catch (e) { /* not UI-editable */ }
    }
  }
  return { autos, scripts, on, reg };
}

// Back to a snapshot: what a test added goes, what it changed or deleted comes back, the same automations on and
// off, and the board's own data (labels, categories, store, user data, test dashboards) cleared, as reset() does.
async function restore(snap) {
  const done = [];
  const states = await rest('GET', 'states');
  const nowAutos = new Map(), nowScripts = new Set();
  states.forEach((s) => {
    if (s.entity_id.startsWith('automation.') && s.attributes.id) nowAutos.set(s.attributes.id, s);
    else if (s.entity_id.startsWith('script.')) nowScripts.add(s.entity_id.slice(7));
  });
  for (const [id] of nowAutos) {
    if (!(id in snap.autos)) { await rest('DELETE', 'config/automation/config/' + encodeURIComponent(id)).catch(() => {}); done.push('deleted automation ' + id); }
  }
  for (const [id, cfg] of Object.entries(snap.autos)) {
    let cur = null;
    try { cur = await rest('GET', 'config/automation/config/' + encodeURIComponent(id)); } catch (e) { /* deleted by the test */ }
    if (JSON.stringify(cur) !== JSON.stringify(cfg)) { await rest('POST', 'config/automation/config/' + encodeURIComponent(id), cfg); done.push('restored automation ' + id); }
  }
  for (const oid of nowScripts) {
    if (!(oid in snap.scripts)) {
      try { await rest('GET', 'config/script/config/' + encodeURIComponent(oid)); await rest('DELETE', 'config/script/config/' + encodeURIComponent(oid)); done.push('deleted script ' + oid); } catch (e) { /* YAML */ }
    }
  }
  for (const [oid, cfg] of Object.entries(snap.scripts)) {
    let cur = null;
    try { cur = await rest('GET', 'config/script/config/' + encodeURIComponent(oid)); } catch (e) { /* deleted */ }
    if (JSON.stringify(cur) !== JSON.stringify(cfg)) { await rest('POST', 'config/script/config/' + encodeURIComponent(oid), cfg); done.push('restored script ' + oid); }
  }
  // helpers and scenes it made go; what it changed in the registries comes back; then the areas it made go
  const R = snap.reg;
  if (R) {
    const nowHelpers = await helperIds();
    for (const d of HELPERS) for (const id of nowHelpers[d]) if (!R.helpers[d].includes(id)) { await ws({ type: d + '/delete', [d + '_id']: id }).catch(() => {}); done.push(`deleted ${d} ${id}`); }
    for (const x of states) if (x.entity_id.startsWith('scene.') && x.attributes.id && !R.scenes.includes(x.attributes.id)) { await rest('DELETE', 'config/scene/config/' + encodeURIComponent(x.attributes.id)).catch(() => {}); done.push('deleted scene ' + x.attributes.id); }
    const [ents, devs] = await ws({ type: 'config/entity_registry/list' }, { type: 'config/device_registry/list' });
    for (const e of ents) {
      const was = R.ents[e.entity_id];
      if (was && !same(fields(e, ENT_FIELDS), was)) { await ws(Object.assign({ type: 'config/entity_registry/update', entity_id: e.entity_id }, was)).catch(() => {}); done.push('put back the registry entry of ' + e.entity_id); }
    }
    for (const d of devs) {
      const was = R.devs[d.id];
      if (was && !same(fields(d, DEV_FIELDS), was)) { await ws(Object.assign({ type: 'config/device_registry/update', device_id: d.id }, was)).catch(() => {}); done.push('put back device ' + d.id); }
    }
    for (const a of await ws({ type: 'config/area_registry/list' })) if (!R.areas.includes(a.area_id)) { await ws({ type: 'config/area_registry/delete', area_id: a.area_id }).catch(() => {}); done.push('deleted area ' + a.area_id); }
  }
  // on and off as they were (an automation saved again comes back on)
  if (done.length) await new Promise((r) => setTimeout(r, 1500));
  const after = new Map((await rest('GET', 'states')).filter((s) => s.entity_id.startsWith('automation.')).map((s) => [s.attributes.id, s]));
  for (const [id, o] of Object.entries(snap.on)) {
    const s = after.get(id);
    if (s && s.state !== o.state && (o.state === 'on' || o.state === 'off')) { await rest('POST', 'services/automation/turn_' + o.state, { entity_id: s.entity_id }); done.push(`turned ${o.state} ${s.entity_id}`); }
  }
  await reset();
  return done;
}

// The board's own data and what it creates in Home Assistant: labels (and their versions), categories, store, user
// data, dashboards.
async function reset() {
  for (const l of await ws({ type: 'config/label_registry/list' })) {
    // its saved versions too: they're kept by the label's id, which an import makes again for the same name
    const vs = await ws({ type: 'functions_board/versions', label: l.label_id }).catch(() => ({ versions: [] }));
    for (const v of (vs && vs.versions) || []) await ws({ type: 'functions_board/version_delete', label: l.label_id, version_id: v.id });
    await ws({ type: 'config/label_registry/delete', label_id: l.label_id });
  }
  for (const scope of ['automation', 'script', 'helpers']) {
    for (const c of await ws({ type: 'config/category_registry/list', scope })) await ws({ type: 'config/category_registry/delete', scope, category_id: c.category_id });
  }
  await ws({ type: 'functions_board/set', data: {} });
  for (const d of (await ws({ type: 'lovelace/dashboards/list' })).filter((x) => /^fb-/.test(x.url_path))) await ws({ type: 'lovelace/dashboards/delete', dashboard_id: d.id });
  for (const r of await ws({ type: 'lovelace/resources' })) if (/functions/.test(r.url)) await ws({ type: 'lovelace/resources/delete', resource_id: r.id });
}

// The first message of a subscription (trigger_platforms/subscribe and the like), then unsubscribed.
async function first(msg, ms = 8000) {
  const sock = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/websocket');
  const got = [];
  let wake = null;
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); (Array.isArray(m) ? m : [m]).forEach((x) => got.push(x)); if (wake) { wake(); wake = null; } });
  const next = async () => { const end = Date.now() + ms; while (!got.length) { if (Date.now() > end) throw new Error('ha-api: no message for ' + msg.type); await new Promise((r) => { wake = r; setTimeout(r, 200); }); } return got.shift(); };
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', rej, { once: true }); });
  try {
    await next();
    sock.send(JSON.stringify({ type: 'auth', access_token: await token() }));
    await next();
    sock.send(JSON.stringify(Object.assign({ id: 1 }, msg)));
    let r; do { r = await next(); } while (!(r.id === 1 && r.type === 'event'));
    return r.event;
  } finally { sock.close(); }
}

module.exports = { BASE, STATE, token, rest, ws, first, snapshot, restore, reset };
