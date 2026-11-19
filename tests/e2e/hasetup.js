// Gets the test Home Assistant ready for the browser suites, before any of them runs: onboards it if it's new (the
// owner, an administrator), adds the non-admin user, logs both in and writes their tokens to tests/e2e/.state/.
// It used to be part of apitest.py, so every suite depended on a test; now it's setup, run by tests/run.sh.
//   node tests/e2e/hasetup.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.FB_HA_URL || 'http://127.0.0.1:8123';
const STATE = process.env.FB_E2E_STATE || path.join(__dirname, '.state');
const CID = BASE + '/';
const instance = (() => { try { return fs.readFileSync(path.join(STATE, 'instance'), 'utf8').trim() || 'test'; } catch (e) { return 'test'; } })();
const CREDS = path.join(STATE, instance === 'test' ? 'creds.json' : `creds-${instance}.json`);
const pw = () => crypto.randomBytes(18).toString('base64url');

async function json(r) { const t = await r.text(); if (!r.ok) throw new Error(`${r.url}: ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const post = (p, body, token) => fetch(BASE + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) }).then(json);
const fromCode = (code) => fetch(BASE + '/auth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: CID }) }).then(json);
async function login(username, password) {
  const flow = await post('/auth/login_flow', { client_id: CID, handler: ['homeassistant', null], redirect_uri: CID });
  const res = await post('/auth/login_flow/' + flow.flow_id, { username, password, client_id: CID });
  if (!res.result) throw new Error('hasetup: login refused for ' + username + ' (tests/e2e/.state/creds.json belongs to another Home Assistant? FB_FRESH=1 sh tests/setup.sh)');
  return fromCode(res.result);
}
async function wsCall(token, msg) {
  const sock = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/websocket');
  const got = [];
  let wake = null;
  sock.addEventListener('message', (ev) => { got.push(JSON.parse(ev.data)); if (wake) { wake(); wake = null; } });
  const next = async () => { while (!got.length) await new Promise((r) => { wake = r; }); return got.shift(); };
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', rej, { once: true }); });
  try {
    await next();
    sock.send(JSON.stringify({ type: 'auth', access_token: token }));
    if ((await next()).type !== 'auth_ok') throw new Error('hasetup: websocket login refused');
    sock.send(JSON.stringify(Object.assign({ id: 1 }, msg)));
    let r; do { r = await next(); } while (r.id !== 1);
    if (!r.success) throw new Error(msg.type + ': ' + JSON.stringify(r.error));
    return r.result;
  } finally { sock.close(); }
}
const save = (who, t) => fs.writeFileSync(path.join(STATE, who + '_token.json'), JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in }));

(async () => {
  fs.mkdirSync(STATE, { recursive: true });
  const steps = await fetch(BASE + '/api/onboarding').then((r) => (r.status === 200 ? r.json() : [{ done: true }]));
  let creds = fs.existsSync(CREDS) ? JSON.parse(fs.readFileSync(CREDS, 'utf8')) : {};
  if (!steps[0].done) {
    const p = pw();
    const { auth_code: code } = await post('/api/onboarding/users', { client_id: CID, name: 'Test Owner', username: 'owner', password: p, language: 'en' });
    const t = await fromCode(code);
    for (const [step, body] of [['core_config', {}], ['analytics', {}], ['integration', { client_id: CID, redirect_uri: CID }]]) await post('/api/onboarding/' + step, body, t.access_token);
    creds = { owner: { username: 'owner', password: p } };
    fs.writeFileSync(CREDS, JSON.stringify(creds));
    console.log('onboarded a new Home Assistant');
  }
  const owner = await login('owner', creds.owner.password);
  save('owner', owner);
  if (!creds.user) {
    const u = await wsCall(owner.access_token, { type: 'config/auth/create', name: 'Test User', group_ids: ['system-users'], local_only: false });
    const p = pw();
    await wsCall(owner.access_token, { type: 'config/auth_provider/homeassistant/create', user_id: u.user.id, username: 'plainuser', password: p });
    creds.user = { username: 'plainuser', password: p };
    fs.writeFileSync(CREDS, JSON.stringify(creds));
  }
  save('user', await login('plainuser', creds.user.password));
  // the integration set up, as a person adds it (one entry)
  const entries = await fetch(BASE + '/api/config/config_entries/entry?domain=functions_board', { headers: { Authorization: 'Bearer ' + owner.access_token } }).then(json);
  if (!entries.length) {
    const f = await post('/api/config/config_entries/flow', { handler: 'functions_board', show_advanced_options: false }, owner.access_token);
    await post('/api/config/config_entries/flow/' + f.flow_id, {}, owner.access_token);
    console.log('added the Functions Board integration');
  }
  // Home Assistant answers its API before every integration is set up; the frontend (and get_services) only
  // settle once it says it is running, so wait for that (a slow CI runner showed only the loading screen)
  let state = null, svc = null;
  for (let i = 0; i < 120; i++) {
    state = (await fetch(BASE + '/api/config', { headers: { Authorization: 'Bearer ' + owner.access_token } }).then(json).catch(() => ({}))).state;
    svc = state === 'RUNNING' ? await wsCall(owner.access_token, { type: 'get_services' }).then(() => 'ok', (e) => String(e).slice(0, 200)) : null;
    if (svc === 'ok') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (svc !== 'ok') throw new Error(`Home Assistant did not finish starting (state ${state}; get_services: ${svc})`);
  console.log('ready: owner and user logged in (' + instance + ')');
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
