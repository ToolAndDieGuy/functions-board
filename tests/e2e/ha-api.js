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
// automations are on, and the labels, categories, board data and test dashboards.
async function snapshot() {
  const states = await rest('GET', 'states');
  const autos = {}, scripts = {}, on = {};
  for (const s of states) {
    if (s.entity_id.startsWith('automation.') && s.attributes.id) {
      try { autos[s.attributes.id] = await rest('GET', 'config/automation/config/' + encodeURIComponent(s.attributes.id)); on[s.attributes.id] = { entity: s.entity_id, state: s.state }; } catch (e) { /* YAML without an id: can't be changed from the UI either */ }
    } else if (s.entity_id.startsWith('script.')) {
      const oid = s.entity_id.slice(7);
      try { scripts[oid] = await rest('GET', 'config/script/config/' + encodeURIComponent(oid)); } catch (e) { /* not UI-editable */ }
    }
  }
  return { autos, scripts, on };
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

// The board's own data and what it creates in Home Assistant: labels, categories, store, user data, dashboards.
async function reset() {
  for (const l of await ws({ type: 'config/label_registry/list' })) await ws({ type: 'config/label_registry/delete', label_id: l.label_id });
  for (const scope of ['automation', 'script', 'helpers']) {
    for (const c of await ws({ type: 'config/category_registry/list', scope })) await ws({ type: 'config/category_registry/delete', scope, category_id: c.category_id });
  }
  await ws({ type: 'functions_board/set', data: {} });
  for (const d of (await ws({ type: 'lovelace/dashboards/list' })).filter((x) => /^fb-/.test(x.url_path))) await ws({ type: 'lovelace/dashboards/delete', dashboard_id: d.id });
  for (const r of await ws({ type: 'lovelace/resources' })) if (/functions/.test(r.url)) await ws({ type: 'lovelace/resources/delete', resource_id: r.id });
}

module.exports = { BASE, STATE, token, rest, ws, snapshot, restore, reset };
