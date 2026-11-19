// The problems check (0.9.0): findProblems() on analyze()'s refs. Run: node tests/problems.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'custom_components', 'functions_board', 'frontend', 'functions-board.js'), 'utf8');
const start = src.indexOf("'use strict';"), end = src.indexOf('  class FunctionsBoard extends HTMLElement');
const { analyze, findProblems, splitDismissed, probKey, markProblems, cleanLayout } = new Function('customElements', 'window', src.slice(start, end) + '\nreturn { analyze, findProblems, splitDismissed, probKey, markProblems, cleanLayout };')({ get: () => undefined }, {});

let failed = 0, total = 0;
const check = (name, ok, detail) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -- ' + JSON.stringify(detail)));
};

// a small home: what exists, as Home Assistant would say
const states = {
  'cover.garage_door': { state: 'closed' }, 'timer.garage_open': { state: 'idle' }, 'input_boolean.auto_close': { state: 'on' },
  'sensor.flaky': { state: 'unavailable' }, 'automation.left_open': { state: 'on' }, 'automation.night': { state: 'off' },
  'script.close_garage': { state: 'off' }, 'automation.broken': { state: 'unavailable' }, 'light.porch': { state: 'off' },
};
const ents = { 'sensor.orphan': {}, 'switch.old_plug': { disabled_by: 'user' }, 'cover.garage_door': {}, 'light.porch': {} };
const devs = { d1: {}, d2: { disabled_by: 'user' } };
const services = { cover: ['close_cover', 'open_cover'], light: ['turn_on', 'turn_off'], script: ['turn_on', 'close_garage'], timer: ['start', 'cancel'], notify: ['notify'], automation: ['turn_on', 'turn_off'] };
const ctx = (over = {}) => Object.assign({
  state: (id) => states[id], ent: (id) => ents[id], dev: (id) => devs[id],
  area: (id) => (id === 'garage' ? {} : undefined), floor: () => undefined, label: (id) => (id === 'outside' ? {} : undefined),
  service: (d, s) => !!(services[d] && services[d].includes(s)), paused: false,
}, over);
const item = (key, cfg) => ({ key, refs: analyze(cfg, key.startsWith('script.'), (x) => (states[x] || ents[x] ? x : null)).refs });
const kinds = (ps) => ps.map((p) => `${p.sev} ${p.kind} ${p.ref}`).sort();

// 1. a healthy function has no problems
const ok = [item('automation.left_open', { triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open', for: '00:15:00' }], conditions: [{ condition: 'state', entity_id: 'input_boolean.auto_close', state: 'on' }], actions: [{ action: 'script.close_garage' }, { action: 'timer.start', target: { entity_id: 'timer.garage_open' } }] })];
check('a function whose references all exist has no problems', findProblems(ok, ['automation.left_open', 'cover.garage_door'], ctx()).length === 0, kinds(findProblems(ok, ['automation.left_open'], ctx())));

// 2. references that aren't there
const bad = [item('automation.left_open', {
  triggers: [{ trigger: 'state', entity_id: 'cover.garage_door_old', to: 'open' }, { trigger: 'state', entity_id: 'sensor.orphan' }],
  conditions: [{ condition: 'state', entity_id: 'sensor.flaky', state: 'on' }],
  actions: [
    { action: 'light.turn_on', target: { entity_id: 'switch.old_plug', area_id: 'attic', label_id: 'outside' } },
    { action: 'notify.mobile_app_old_phone', data: { message: 'x' } },
    { device_id: 'gone', domain: 'cover', type: 'close' },
    { action: 'cover.close_cover', target: { device_id: 'd2' } },
    { action: 'script.missing_script' },
    { action: '{{ "light.turn_" ~ x }}', target: { entity_id: 'light.porch' } },
  ],
})];
const ps = findProblems(bad, ['automation.left_open'], ctx());
const got = kinds(ps);
check('a renamed or removed entity is an error', got.includes('error e_missing cover.garage_door_old'), got);
check('an entity its integration no longer provides is an error', got.includes('error e_notloaded sensor.orphan'), got);
check('an unavailable entity is a warning', got.includes('warn e_unavail sensor.flaky'), got);
check('a disabled entity is a warning', got.includes('warn e_disabled switch.old_plug'), got);
check('an area that\'s gone is an error; a label that exists isn\'t', got.includes('error t_missing area:attic') && !got.some((g) => /label:outside/.test(g)), got);
check('a service that doesn\'t exist is an error', got.includes('error s_missing notify.mobile_app_old_phone'), got);
check('a device that\'s gone is an error, a disabled one a warning', got.includes('error d_missing device:gone') && got.includes('warn d_disabled device:d2'), got);
check('a script that doesn\'t exist is an error (as an entity and as a service)', got.includes('error e_missing script.missing_script') && got.includes('error s_missing script.missing_script'), got);
check('a templated service isn\'t judged', !got.some((g) => /turn_/.test(g) && /s_missing/.test(g)), got);
check('errors come first', ps.findIndex((p) => p.sev === 'warn') > ps.findIndex((p) => p.sev === 'error') && ps.slice(0, ps.findIndex((p) => p.sev === 'warn')).every((p) => p.sev === 'error'), ps.map((p) => p.sev));
check('each problem says what it\'s in', ps.every((p) => p.by.length === 1 && p.by[0] === 'automation.left_open'), ps.map((p) => p.by));

// 3. one thing, used twice: one problem, both users named
const two = [item('automation.a', { triggers: [{ trigger: 'state', entity_id: 'cover.gone' }], actions: [] }), item('automation.b', { triggers: [], actions: [{ action: 'cover.open_cover', target: { entity_id: 'cover.gone' } }] })];
const p2 = findProblems(two, [], ctx());
check('the same missing thing in two automations is one problem naming both', p2.length === 1 && p2[0].by.length === 2, p2);

// 4. the function's own pieces
const mem = ['automation.left_open', 'automation.night', 'automation.broken', 'script.close_garage', 'sensor.flaky', 'switch.old_plug', 'device:d2'];
const own = kinds(findProblems([], mem, ctx()));
check('an automation that couldn\'t be set up (config error) is an error', own.includes('error m_broken automation.broken'), own);
check('an automation that\'s off is a warning', own.includes('warn m_off automation.night'), own);
check('... unless the function is paused (the board turned it off)', !kinds(findProblems([], mem, ctx({ paused: true }))).some((g) => /m_off/.test(g)));
check('an unavailable or disabled piece, and a disabled device, are warnings', own.includes('warn e_unavail sensor.flaky') && own.includes('warn e_disabled switch.old_plug') && own.includes('warn d_disabled device:d2'), own);
check('a script that\'s simply not running isn\'t a problem', !own.some((g) => /script\.close_garage/.test(g)), own);

// 5. not judged: events, MQTT topics, notification buttons, templates naming unknown things
const quiet = [item('automation.q', { triggers: [{ trigger: 'event', event_type: 'my_event' }, { trigger: 'mqtt', topic: 'home/x' }], conditions: [{ condition: 'template', value_template: "{{ states('sensor.not_a_thing') }}" }], actions: [{ event: 'done' }] })];
check('events, MQTT topics and unknown names inside templates aren\'t judged', findProblems(quiet, [], ctx()).length === 0, kinds(findProblems(quiet, [], ctx())));

// 6. dismissing (0.9.0): a problem is known by what's wrong and with what; it's forgotten a day after it's gone
{
  const A = { sev: 'error', kind: 'e_missing', ref: 'cover.gone', by: ['automation.a'] }, B = { sev: 'warn', kind: 'e_unavail', ref: 'sensor.flaky', by: ['automation.a'] };
  const C = { sev: 'error', kind: 'c_failed', ref: 'check:x1', by: [] };
  const day = 24 * 3600 * 1000, t0 = 1e12;
  let r = splitDismissed([A, B], [{ k: probKey(A), at: t0 }], t0);
  check('a dismissed problem is hidden and the rest shown', r.shown.length === 1 && r.shown[0] === B && r.hidden.length === 1 && r.hidden[0] === A && !r.changed, r);
  check('the same problem used by another automation too stays dismissed', splitDismissed([Object.assign({}, A, { by: ['automation.a', 'automation.b'] })], [{ k: probKey(A), at: t0 }], t0).shown.length === 0);
  check('a different problem with the same thing isn\'t (missing, then unavailable)', splitDismissed([Object.assign({}, A, { kind: 'e_unavail', sev: 'warn' })], [{ k: probKey(A), at: t0 }], t0).shown.length === 1);
  r = splitDismissed([B], [{ k: probKey(A), at: t0 }], t0 + 5);
  check('once its problem is gone, the dismissal notes since when', r.changed && r.dismissed.length === 1 && r.dismissed[0].gone === t0 + 5, r.dismissed);
  const goneD = r.dismissed;
  r = splitDismissed([A, B], goneD, t0 + 3600e3);
  check('back within a day: still dismissed, and no longer marked gone', r.hidden.length === 1 && r.changed && !r.dismissed[0].gone, r.dismissed);
  r = splitDismissed([B], goneD, t0 + 5 + day - 1);
  check('gone for less than a day: kept', r.dismissed.length === 1 && !r.changed, r.dismissed);
  r = splitDismissed([B], goneD, t0 + 5 + day + 1);
  check('gone for more than a day: forgotten', r.dismissed.length === 0 && r.changed, r.dismissed);
  check('... so if it comes back after that, it shows again', splitDismissed([A, B], r.dismissed, t0 + 2 * day).shown.length === 2);
  r = splitDismissed([A], [{ k: probKey(C), at: t0 }], t0, (k) => !k.startsWith('c_'));
  check('a list that doesn\'t cover checks leaves a check\'s dismissal alone', !r.changed && r.dismissed.length === 1 && !r.dismissed[0].gone, r.dismissed);
  const nodes = new Map([['automation.a', {}], ['cover.gone', {}], ['sensor.flaky', {}]]), edges = [{ from: 'cover.gone', to: 'automation.a' }, { from: 'sensor.flaky', to: 'automation.a' }];
  markProblems(nodes, edges, [B]);
  check('marks come only from what\'s shown: a dismissed missing thing marks no box or arrow', nodes.get('cover.gone').prob === null && nodes.get('sensor.flaky').prob === 'warn' && nodes.get('automation.a').prob === 'warn' && !edges[0].prob, [...nodes].map(([k, n]) => k + ':' + n.prob));
  const L = cleanLayout({ dismissed: [{ k: probKey(A), at: t0, gone: t0 + 1, extra: '<x>' }, { k: 5 }, null, { k: 'x'.repeat(500) }] });
  check('the layout keeps dismissals as what, when and since when gone, nothing else', JSON.stringify(L.dismissed) === JSON.stringify([{ k: probKey(A), at: t0, gone: t0 + 1 }]), L.dismissed);
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
