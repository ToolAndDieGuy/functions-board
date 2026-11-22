// Records the fresh test Home Assistant's own answers into tests/board/garage.json: the fake Home Assistant
// (tests/board/fake-ha.js) starts every board test from them. Rerun after changing tests/e2e/config or moving to a
// newer Home Assistant (the contract test, tests/e2e/contract.test.js, says when the fake has drifted):
//   sh tests/run.sh --ha --only apitest   (any run that leaves a fresh, set-up test Home Assistant), then
//   node tests/board/capture.js
// Only the test config is in it (tests/e2e/config): no real home.
const fs = require('fs');
const path = require('path');
const ha = require('../e2e/ha-api');

const OUT = path.join(__dirname, 'garage.json');
// a device trigger as a key: its settings, keys sorted (the fake answers capabilities by it)
const trigKey = (t) => JSON.stringify(t, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

async function theme() {
  const { chromium } = require('playwright');
  const { session, ready, BASE } = require('../e2e/lib');
  const src = fs.readFileSync(require('./fake-ha').BOARD, 'utf8');
  const names = [...new Set([...src.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => !n.startsWith('--fb-')))];
  const browser = await chromium.launch(), out = {};
  try {
    for (const light of [false, true]) {
      const { ctx, page } = await session(browser, 'owner', { light });
      await page.goto(BASE + '/functions');
      await ready(page);
      await page.locator('functions-board').waitFor({ state: 'attached', timeout: 20000 });
      out[light ? 'light' : 'dark'] = await page.locator('functions-board').evaluate((el, ns) => { const cs = getComputedStyle(el); return Object.fromEntries(ns.map((n) => [n, cs.getPropertyValue(n).trim()]).filter(([, v]) => v)); }, names);
      await ctx.close();
    }
  } finally { await browser.close(); }
  return out;
}

(async () => {
  await ha.reset();
  const states = await ha.rest('GET', 'states');
  const [entities, devices, areas, floors, labels, services, config, panels, manifests, users] = await ha.ws(
    { type: 'config/entity_registry/list' }, { type: 'config/device_registry/list' }, { type: 'config/area_registry/list' },
    { type: 'config/floor_registry/list' }, { type: 'config/label_registry/list' }, { type: 'get_services' }, { type: 'get_config' },
    { type: 'get_panels' }, { type: 'manifest/list' }, { type: 'config/auth/list' },
  );
  const categories = {};
  for (const scope of ['automation', 'script', 'helpers']) categories[scope] = await ha.ws({ type: 'config/category_registry/list', scope });
  const autos = {}, scripts = {};
  for (const s of states) {
    if (s.entity_id.startsWith('automation.') && s.attributes.id) { try { autos[s.attributes.id] = await ha.rest('GET', 'config/automation/config/' + encodeURIComponent(s.attributes.id)); } catch (e) { /* YAML without id */ } }
    if (s.entity_id.startsWith('script.')) { try { scripts[s.entity_id.slice(7)] = await ha.rest('GET', 'config/script/config/' + encodeURIComponent(s.entity_id.slice(7))); } catch (e) { /* not UI-made */ } }
  }
  // the automations' own YAML (without a UI id) as the board reads it: automation/config by entity
  const autoByEntity = {};
  for (const s of states.filter((x) => x.entity_id.startsWith('automation.'))) {
    try { autoByEntity[s.entity_id] = (await ha.ws({ type: 'automation/config', entity_id: s.entity_id })).config; } catch (e) { /* unknown */ }
  }
  const entries = await ha.ws({ type: 'config_entries/get', domain: 'functions_board' });
  // the helpers made in the UI, per domain, as the board lists them (those in YAML aren't in these lists)
  const helperLists = {};
  for (const d of ['input_boolean', 'input_number', 'input_select', 'input_text', 'input_datetime', 'input_button', 'timer', 'counter', 'schedule']) {
    try { helperLists[d] = await ha.ws({ type: d + '/list' }); } catch (e) { /* not set up */ }
  }
  // what each purpose-specific trigger and condition can target (the board reads these once)
  const triggerPlatforms = await ha.first({ type: 'trigger_platforms/subscribe' }), conditionPlatforms = await ha.first({ type: 'condition_platforms/subscribe' });
  const board = await ha.ws({ type: 'functions_board/get' });
  // each device's own triggers (0.13.0), as the sandbox's Press row asks for them: the list, the capabilities of those
  // with no entity (by the trigger, keys sorted), and an MQTT device's debug info (its triggers' discovery configs;
  // the messages it last had left out)
  const devTrig = {};
  for (const d of devices) {
    const list = await ha.ws({ type: 'device_automation/trigger/list', device_id: d.id }).catch(() => []);
    if (!list.length) continue;
    const caps = {};
    for (const t of list.filter((x) => x.entity_id == null)) caps[trigKey(t)] = await ha.ws({ type: 'device_automation/trigger/capabilities', trigger: t });
    const rec = { list, caps };
    if (list.some((t) => t.domain === 'mqtt')) {
      const info = await ha.ws({ type: 'mqtt/device/debug_info', device_id: d.id });
      info.entities.forEach((e) => { e.subscriptions.forEach((x) => { x.messages = []; }); e.transmitted = []; });
      rec.mqtt = info;
    }
    devTrig[d.id] = rec;
  }
  // each Z-Wave device's values (0.13.0), as functions_board/zwave_values gives them
  const zwave = {};
  for (const d of devices.filter((x) => (x.identifiers || []).some((i) => i[0] === 'zwave_js'))) {
    const z = await ha.ws({ type: 'functions_board/zwave_values', device_id: d.id });
    if (z) zwave[d.id] = z;
  }
  // times in states are from the moment of capture; the fake moves them to its own clock
  const snap = {
    captured: new Date().toISOString().slice(0, 10), ha: config.version,
    states, entities, devices, areas, floors, labels, categories, services, config,
    panel: panels.functions, manifests: manifests.map((m) => ({ domain: m.domain, name: m.name, integration_type: m.integration_type })),
    users: users.map((u) => ({ id: u.id, name: u.name, is_owner: u.is_owner, is_active: u.is_active, system_generated: u.system_generated, group_ids: u.group_ids })),
    autos, scripts, autoByEntity, entries, mode: board.mode, triggerPlatforms, conditionPlatforms, helperLists,
    devTrig, zwave,
  };
  // Home Assistant's theme as the board sees it, dark and light: the CSS variables it reads (its colours, so the
  // accessibility audit on the fake judges the same contrast)
  snap.theme = await theme();
  const text = JSON.stringify(snap, null, 1);
  // nothing of a real home can be in it, but say so if a name from outside the test config shows up
  const hit = text.match(/.{0,60}(192\.168\.|10\.0\.0\.|@gmail|\btoms?_).{0,40}/i);
  if (hit) throw new Error("capture: something that looks personal is in the snapshot: " + hit[0]);
  fs.writeFileSync(OUT, text + '\n');
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${states.length} states, ${entities.length} entities, ${Object.keys(autos).length} automations, ${Object.keys(scripts).length} scripts (Home Assistant ${config.version})`);
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
