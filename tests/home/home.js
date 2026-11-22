// Helpers for tests that use what the test Home Assistant talks to (tests/home/README.md): where each one listens,
// Node-RED's admin API, the Z-Wave mock's control page, and the MQTT broker's message log.
//   const home = require('../home/home');
//   await home.nodered.addFlow({ label: 'A test', nodes: [...] }); …; await home.nodered.removeFlow(id);
//   await home.zwave.scene(3, 1, 'KeyPressed');
//   home.mqtt.sent((m) => m.topic === 'fbtest/pond_pump/set')
const fs = require('fs');
const path = require('path');

const PORTS = {
  mqtt: Number(process.env.FB_MQTT_PORT || 11883),
  zwave: Number(process.env.FB_ZWAVE_PORT || 13000),
  zwaveMock: Number(process.env.FB_ZWAVE_MOCK_PORT || 15555),
  zwaveCtl: Number(process.env.FB_ZWAVE_CTL || 15556),
  nodered: Number(process.env.FB_NODERED_PORT || 11880),
};
const instance = () => { try { return fs.readFileSync(path.join(__dirname, '../e2e/.state/instance'), 'utf8').trim(); } catch (e) { return 'test'; } };
const DIR = () => process.env.FB_HOME_DIR || path.join(__dirname, '../..', instance() === 'demo' ? 'ha-demo' : 'ha', 'home');
// the Home Assistant server node every flow of the test home uses (tests/e2e/hasetup.js deploys it)
const SERVER = 'fb_ha_server';

async function nr(method, p, body, headers) {
  const r = await fetch(`http://127.0.0.1:${PORTS.nodered}${p}`, { method, headers: Object.assign({ 'Content-Type': 'application/json', 'Node-RED-API-Version': 'v2' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Node-RED ${method} ${p}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const nodered = {
  url: `http://127.0.0.1:${PORTS.nodered}`,
  // the node versions the Home Assistant nodes want now (the editor stamps them; flows made here should too)
  async versions() { const s = await nr('GET', '/settings'); return Object.fromEntries(Object.entries(s).filter(([k, v]) => /Version$/.test(k) && typeof v === 'number')); },
  flows() { return nr('GET', '/flows'); },
  deploy(flows) { return nr('POST', '/flows', { flows }, { 'Node-RED-Deployment-Type': 'full' }); },
  // a flow tab of its own: { label, nodes }; its nodes get z: the tab's id. Returns the tab's id
  async addFlow(flow) { const r = await nr('POST', '/flow', flow); return r.id; },
  removeFlow(id) { return nr('DELETE', '/flow/' + encodeURIComponent(id)); },
  // every tab but the base one (tests leave nothing behind; this clears what a failed one left)
  async clear() {
    const f = await this.flows(), flows = f.flows || f;
    for (const t of flows.filter((n) => n.type === 'tab' && n.id !== 'fb_tab_base')) await this.removeFlow(t.id);
  },
  // Home Assistant's server node, connected (by the status the palette gives it), within ms
  async connected(ms = 30000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const log = fs.existsSync(path.join(DIR(), 'nodered.log')) ? fs.readFileSync(path.join(DIR(), 'nodered.log'), 'utf8') : '';
      if (/\[server:[^\]]*\] Connected to http:\/\/127\.0\.0\.1:8123/i.test(log)) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  },
};

async function ctl(what, body) {
  const r = await fetch(`http://127.0.0.1:${PORTS.zwaveCtl}/${what}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Z-Wave mock /${what}: ${r.status} ${await r.text()}`);
}
const zwave = {
  url: `ws://127.0.0.1:${PORTS.zwave}`,
  scene: (node, scene, key = 'KeyPressed') => ctl('scene', { node, scene, key }),
  notify: (node, type, event) => ctl('notify', { node, type, event }),
  sensor: (node, type, scale, value) => ctl('sensor', { node, type, scale, value }),
  switch: (node, on) => ctl('switch', { node, on }),
};

const mqtt = {
  port: PORTS.mqtt,
  // every message published since the broker started (or since mark()), as { t, topic, payload, retain, by }
  log() {
    const f = path.join(DIR(), 'mqtt-messages.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  },
  mark() { return Date.now(); },
  sent(pred, since = 0) { return this.log().filter((m) => m.t >= since && (!pred || pred(m))); },
};

module.exports = { PORTS, DIR, SERVER, nodered, zwave, mqtt };
