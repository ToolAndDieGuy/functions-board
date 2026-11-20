// Tests for the config reader and loop finder in the board script. Run: node --test tests/wiring.test.js
const fs = require('fs');
const path = require('path');

const lib = require('./lib/board-lib');
const { analyze, loopEdges, layered, ROLE_RANK, cssColor, cleanLayout, esc, setDomains, focusSet, sides, edgeGeom, whyStopped, runPath, srcKey, parseLoose, toLoose, cleanTest, condText, trigVar, toYaml, refsTo, dropRefs, refPlace, nrGroups, T: tx, P: px, setLang, onLang, STR } = lib;

const { check } = require('./lib/check');

// mirrors FunctionsBoard._wire: refs become merged edges carrying services and trigger filters
function edgesOf(cfgs) {
  const edges = new Map(), keys = new Set(Object.keys(cfgs));
  for (const [id0, cfg] of Object.entries(cfgs)) {
    for (const r of analyze(cfg, id0.startsWith('script.'), (x) => x).refs) {
      if (r.ref === id0) continue;
      keys.add(r.ref);
      const inbound = r.role === 'trigger' || r.role === 'condition';
      const from = inbound ? r.ref : id0, to = inbound ? id0 : r.ref, id = from + '>' + to;
      let e = edges.get(id);
      if (!e) { e = { id, from, to, role: r.role, svcs: new Set(r.svc ? [r.svc] : []), tfs: [], anyTrig: false }; edges.set(id, e); }
      else { if (ROLE_RANK[r.role] > ROLE_RANK[e.role]) e.role = r.role; if (r.svc) e.svcs.add(r.svc); }
      if (r.role === 'trigger') { if (r.tf) e.tfs.push(r.tf); else e.anyTrig = true; }
    }
  }
  return { keys: [...keys], edges: [...edges.values()] };
}
const loops = (cfgs) => { const m = edgesOf(cfgs); return [...loopEdges(m.keys, m.edges)]; };
const T = (entity, extra) => Object.assign({ trigger: 'state', entity_id: entity }, extra || {});
const A = (action, entity, data) => ({ action, target: { entity_id: entity }, ...(data ? { data } : {}) });
const A0 = A;
const finished = (timer) => ({ trigger: 'event', event_type: 'timer.finished', event_data: { entity_id: timer } });

// ---- reading configs ----
{
  const { edges } = edgesOf({
    'automation.a': {
      triggers: [T('binary_sensor.door', { to: 'on' })],
      conditions: [{ condition: 'state', entity_id: 'input_boolean.away', state: 'off' }],
      actions: [A('light.turn_on', 'light.hall'), { action: 'script.announce' }, { action: 'notify.mobile_app_phone', data: { message: 'hi' } }],
    },
  });
  const has = (from, role, to) => edges.some((e) => e.from === from && e.to === to && e.role === role);
  check('trigger arrow', has('binary_sensor.door', 'trigger', 'automation.a'));
  check('condition arrow', has('input_boolean.away', 'condition', 'automation.a'));
  check('action arrow with service', has('automation.a', 'action', 'light.hall') && edges.find((e) => e.to === 'light.hall').svcs.has('turn_on'));
  check('script call arrow', has('automation.a', 'call', 'script.announce'));
  check('target-less action becomes an action box', has('automation.a', 'action', 'svc:notify.mobile_app_phone'));
}
{
  const { edges } = edgesOf({ 'automation.t': { triggers: [{ trigger: 'state', entity_id: 'sensor.x' }], conditions: [{ condition: 'template', value_template: "{{ is_state('sun.sun', 'below_horizon') }}" }], actions: [] } });
  check('entities read in templates are checked-by arrows', edges.some((e) => e.from === 'sun.sun' && e.role === 'condition'));
}
{
  const { edges } = edgesOf({ 'automation.old': { trigger: [{ platform: 'state', entity_id: 'switch.p' }], action: [{ service: 'switch.turn_off', entity_id: 'switch.p' }] } });
  check('old-style keys (trigger/platform/action/service)', edges.some((e) => e.role === 'trigger') && edges.some((e) => e.role === 'action'));
}
{
  const { edges } = edgesOf({ 'automation.m': { triggers: [{ trigger: 'mqtt', topic: 'home/door' }, { trigger: 'event', event_type: 'my_event' }], actions: [{ event: 'done_event' }] } });
  check('mqtt and event triggers, fired events', ['mqtt:home/door', 'event:my_event'].every((k) => edges.some((e) => e.from === k)) && edges.some((e) => e.to === 'event:done_event'));
}

// ---- loops ----
const loopCases = [
  ['turn off what turned on: no loop', { 'automation.a': { triggers: [T('light.x', { to: 'on' })], actions: [A('light.turn_off', 'light.x')] } }, false],
  ['toggle on any change: loop', { 'automation.a': { triggers: [T('light.x')], actions: [A('light.toggle', 'light.x')] } }, true],
  ['counter numeric trigger plus increment: loop', { 'automation.a': { triggers: [{ trigger: 'numeric_state', entity_id: 'counter.c', above: 3 }], actions: [A('counter.increment', 'counter.c')] } }, true],
  ['repeating timer: loop', { 'automation.a': { triggers: [finished('timer.t')], actions: [A('timer.start', 'timer.t')] } }, true],
  ['timer cancel never finishes it: no loop', { 'automation.a': { triggers: [finished('timer.t')], actions: [A('timer.cancel', 'timer.t')] } }, false],
  ['two automations ping-pong: loop', {
    'automation.a': { triggers: [T('input_boolean.a', { to: 'on' })], actions: [A('input_boolean.turn_on', 'input_boolean.b')] },
    'automation.b': { triggers: [T('input_boolean.b', { to: 'on' })], actions: [A('input_boolean.turn_on', 'input_boolean.a')] } }, true],
  ['ping-pong broken by a state filter: no loop', {
    'automation.a': { triggers: [T('input_boolean.a', { to: 'on' })], actions: [A('input_boolean.turn_on', 'input_boolean.b')] },
    'automation.b': { triggers: [T('input_boolean.b', { to: 'on' })], actions: [A('input_boolean.turn_off', 'input_boolean.a')] } }, false],
  ['through a script: loop', {
    'script.s': { sequence: [A('light.turn_on', 'light.y')] },
    'automation.a': { triggers: [T('light.y', { to: ['on', 'off'] })], actions: [{ action: 'script.s' }] } }, true],
  ['garage with open timer and auto-close: no loop', {
    'automation.start': { triggers: [T('cover.g', { to: 'open' })], actions: [A('timer.start', 'timer.t')] },
    'automation.left': { triggers: [finished('timer.t')], conditions: [{ condition: 'state', entity_id: 'cover.g', state: 'open' }], actions: [{ action: 'script.close' }] },
    'automation.stop': { triggers: [T('cover.g', { to: 'closed' })], actions: [A('timer.cancel', 'timer.t')] },
    'script.close': { sequence: [A('cover.close_cover', 'cover.g')] } }, false],
  ['garage that re-opens itself: loop', {
    'automation.start': { triggers: [T('cover.g', { to: 'open' })], actions: [A('timer.start', 'timer.t')] },
    'automation.left': { triggers: [finished('timer.t')], actions: [A('cover.open_cover', 'cover.g')] } }, true],
];
for (const [name, cfgs, want] of loopCases) {
  const got = loops(cfgs);
  check(name, (got.length > 0) === want, got);
}

// ---- layout: a cycle starts where the outside world comes in ----
{
  const m = edgesOf({
    'automation.start': { triggers: [T('cover.g', { to: 'open' })], actions: [A('timer.start', 'timer.t')] },
    'automation.left': { triggers: [finished('timer.t')], conditions: [{ condition: 'state', entity_id: 'input_boolean.auto', state: 'on' }], actions: [{ action: 'script.close' }] },
    'script.close': { sequence: [A('cover.close_cover', 'cover.g')] },
  });
  const pos = layered(m.keys.sort(), m.edges, () => ({ w: 240, h: 62 }));
  const x = (k) => pos.get(k).x;
  check('cycle laid out from the door', x('cover.g') < x('automation.start') && x('automation.start') < x('timer.t') && x('timer.t') < x('automation.left') && x('automation.left') < x('script.close'),
    Object.fromEntries([...pos].map(([k, v]) => [k, v.x])));
}

// ---- layout: boxes with no arrows sit in a grid under the wired part ----
{
  const m = edgesOf({ 'automation.a': { triggers: [T('sensor.s')], actions: [A('light.turn_on', 'light.l')] } });
  const loose = Array.from({ length: 9 }, (_, i) => 'input_number.setting_' + i);
  const pos = layered(m.keys.concat(loose).sort(), m.edges, () => ({ w: 240, h: 62 }));
  const wiredBottom = Math.max(...m.keys.map((k) => pos.get(k).y + 62));
  const xs = new Set(loose.map((k) => pos.get(k).x));
  check('unconnected boxes go below the wiring', loose.every((k) => pos.get(k).y > wiredBottom), Object.fromEntries([...pos].map(([k, v]) => [k, [v.x, v.y]])));
  check('unconnected boxes spread over several columns', xs.size >= 3, [...xs]);
  check('wiring still starts at the left edge', Math.min(...m.keys.map((k) => pos.get(k).x)) === 0);
}

// ---- Phase 2: what the reader now understands ----
const PS = (kind, entity, extra) => Object.assign({ trigger: kind, target: { entity_id: entity } }, extra || {});
const phase2 = [
  ['2.1 light.turned_on then turn_off: no loop', { 'automation.a': { triggers: [PS('light.turned_on', 'light.x')], actions: [A('light.turn_off', 'light.x')] } }, false],
  ['2.1 light.turned_on then toggle: loop', { 'automation.a': { triggers: [PS('light.turned_on', 'light.x')], actions: [A('light.toggle', 'light.x')] } }, true],
  ['2.1 door.opened then close_cover: no loop', { 'automation.a': { triggers: [PS('door.opened', 'cover.d')], actions: [A('cover.close_cover', 'cover.d')] } }, false],
  ['2.1 counter.incremented then decrement: no loop', { 'automation.a': { triggers: [PS('counter.incremented', 'counter.c')], actions: [A('counter.decrement', 'counter.c')] } }, false],
  ['2.1 counter.incremented then increment: loop', { 'automation.a': { triggers: [PS('counter.incremented', 'counter.c')], actions: [A('counter.increment', 'counter.c')] } }, true],
  ['2.1 light.brightness_crossed_threshold then turn_off: no loop (an off light has no brightness)', { 'automation.a': { triggers: [PS('light.brightness_crossed_threshold', 'light.x', { options: { threshold: { type: 'below', value: { number: 10 } } } })], actions: [A('light.turn_off', 'light.x')] } }, false],
  ['2.1 light.brightness_crossed_threshold then turn_on: loop', { 'automation.a': { triggers: [PS('light.brightness_crossed_threshold', 'light.x', { options: { threshold: { type: 'below', value: { number: 10 } } } })], actions: [A('light.turn_on', 'light.x', { brightness_pct: 5 })] } }, true],
  ['2.1 light.brightness_changed then turn_off: no loop', { 'automation.a': { triggers: [PS('light.brightness_changed', 'light.x')], actions: [A('light.turn_off', 'light.x')] } }, false],
  ['2.1 timer.finished (new style) then start: loop', { 'automation.a': { triggers: [PS('timer.finished', 'timer.t')], actions: [A('timer.start', 'timer.t')] } }, true],
  ['2.1 timer.finished (new style) then cancel: no loop', { 'automation.a': { triggers: [PS('timer.finished', 'timer.t')], actions: [A('timer.cancel', 'timer.t')] } }, false],
  ['2.6 to: on then turn_on the same light: no loop', { 'automation.a': { triggers: [T('light.x', { to: 'on' })], actions: [A('light.turn_on', 'light.x', { brightness: 50 })] } }, false],
  ['2.6 to: on or off then turn_on: loop', { 'automation.a': { triggers: [T('light.x', { to: ['on', 'off'] })], actions: [A('light.turn_on', 'light.x')] } }, true],
  ['2.6 not_to: off then turn_off: no loop', { 'automation.a': { triggers: [T('switch.s', { not_to: 'off' })], actions: [A('switch.turn_off', 'switch.s')] } }, false],
  ['2.6 attribute trigger then turn_on: loop (attribute values aren\'t states)', { 'automation.a': { triggers: [T('light.x', { attribute: 'brightness', to: 'on' })], actions: [A('light.turn_on', 'light.x')] } }, true],
];
for (const [name, cfgs, want] of phase2) { const got = loops(cfgs); check(name, (got.length > 0) === want, got); }
{
  const { edges } = edgesOf({ 'automation.p': { triggers: [PS('light.turned_on', 'light.porch')], actions: [] } });
  check('2.1 purpose-specific trigger draws its arrow', edges.some((e) => e.from === 'light.porch' && e.role === 'trigger'));
  const r = analyze({ triggers: [{ trigger: 'door.opened', target: { area_id: 'nursery' } }], conditions: [{ condition: 'light.is_on', target: { label_id: ['night'] } }],
    actions: [{ action: 'light.turn_on', target: { area_id: 'nursery', floor_id: 'upstairs' } }, { action: 'light.turn_off', area_id: 'hall' }] }, false, (x) => x).refs;
  const has = (ref, role) => r.find((x) => x.ref === ref && x.role === role);
  check('2.2 area target in a trigger', has('area:nursery', 'trigger') && has('area:nursery', 'trigger').kind === 'door.opened', r);
  check('2.2 label target in a condition', has('label:night', 'condition') && has('label:night', 'condition').kind === 'light.is_on', r);
  check('2.2 area and floor targets in an action, with the action\'s domain', has('area:nursery', 'action').sdom === 'light' && has('floor:upstairs', 'action') && has('area:hall', 'action'), r);
  check('2.2 no bare action box when the target is an area', !r.some((x) => x.ref.startsWith('svc:')), r);
}
{
  // a scene changes its members, a derived helper reads its inputs: changes spread through both (2.3, 2.4)
  const E = (from, to, role, svcs, tfs) => ({ id: from + '>' + to, from, to, role, svcs: new Set(svcs || []), tfs: tfs || [], anyTrig: !(tfs && tfs.length) });
  const scene = [E('automation.a', 'scene.evening', 'action', ['turn_on']), E('scene.evening', 'light.lamp', 'action', ['turn_on']), E('light.lamp', 'automation.a', 'trigger')];
  check('2.4 a scene that turns on what triggers its caller: loop', loopEdges(['automation.a', 'scene.evening', 'light.lamp'], scene).size > 0);
  const tpl = [E('automation.a', 'input_number.x', 'action', ['set_value']), E('input_number.x', 'sensor.t', 'source'), E('sensor.t', 'automation.a', 'trigger')];
  check('2.3 a helper reading what an automation sets, triggering it again: loop', loopEdges(['automation.a', 'input_number.x', 'sensor.t'], tpl).size > 0);
  const noTrig = [E('automation.a', 'input_number.x', 'action', ['set_value']), E('input_number.x', 'sensor.t', 'source'), E('sensor.t', 'automation.b', 'condition')];
  check('2.3 a helper only checked: no loop', loopEdges(['automation.a', 'automation.b', 'input_number.x', 'sensor.t'], noTrig).size === 0);
}
{
  const t = { triggers: [{ trigger: 'template', value_template: "{{ is_state('assist_satellite.kitchen', 'idle') }}" }], actions: [] };
  const before = analyze(t, false, (x) => x).refs.some((r) => r.ref === 'assist_satellite.kitchen');
  setDomains(['assist_satellite', 'conversation']);
  const after = analyze(t, false, (x) => x).refs.some((r) => r.ref === 'assist_satellite.kitchen');
  check('2.5 entity IDs in domains learned from Home Assistant are found in templates', !before && after, { before, after });
}

// ---- 9.5 notification buttons ----
{
  const send = { triggers: [T('cover.g', { to: 'open' })], actions: [{ action: 'notify.mobile_app_phone', data: { message: 'Garage open', data: { actions: [{ action: 'CLOSE_GARAGE', title: 'Close it' }, { action: 'URI', title: 'Camera', uri: '/lovelace/cams' }] } } }] };
  const r = analyze(send, false, (x) => x).refs;
  const b = r.find((x) => x.ref === 'nact:CLOSE_GARAGE');
  check('9.5 a notification button is an output of the notification', b && b.role === 'action' && b.from === 'svc:notify.mobile_app_phone' && b.title === 'Close it', r);
  check('9.5 a link button (URI) fires nothing', !r.some((x) => x.ref === 'nact:URI'));
  const answer = { triggers: [{ trigger: 'event', event_type: 'mobile_app_notification_action', event_data: { action: 'CLOSE_GARAGE' } }], actions: [A('cover.close_cover', 'cover.g')] };
  const r2 = analyze(answer, false, (x) => x).refs;
  check('9.5 the automation answering the button triggers on it', r2.some((x) => x.ref === 'nact:CLOSE_GARAGE' && x.role === 'trigger') && !r2.some((x) => x.ref.startsWith('event:')), r2);
  const ios = analyze({ triggers: [{ trigger: 'event', event_type: 'ios.notification_action_fired', event_data: { actionName: 'CLOSE_GARAGE' } }], actions: [] }, false, (x) => x).refs;
  check('9.5 the iOS event too', ios.some((x) => x.ref === 'nact:CLOSE_GARAGE'), ios);
  const E = (from, to, role, svcs) => ({ id: from + '>' + to, from, to, role, svcs: new Set(svcs || []), tfs: [], anyTrig: role === 'trigger' });
  const ping = [E('automation.a', 'svc:notify.p', 'action', ['mobile_app_p']), E('svc:notify.p', 'nact:X', 'action', ['button']), E('nact:X', 'automation.a', 'trigger')];
  check('9.5 a button that resends its own notification is no loop (a person presses it)', loopEdges(['automation.a', 'svc:notify.p', 'nact:X'], ping).size === 0);
}

// ---- 7.1 highlight modes on a five-box chain with a condition link ----
{
  // A triggers B; B changes C; C triggers D; E is checked by B; F changes E
  const E = (from, to, role) => ({ id: from + '>' + to, from, to, role });
  const edges = [E('A', 'B', 'trigger'), E('B', 'C', 'action'), E('C', 'D', 'trigger'), E('E', 'B', 'condition'), E('F', 'E', 'action')];
  const lit = (mode, depth) => [...focusSet(edges, 'B', mode, depth).dist.keys()].sort().join('');
  check('7.1 chain lights causes both ways and whatever sets what it checks', lit('chain', 0) === 'ABCDEF', lit('chain', 0));
  check('7.1 upstream 1', lit('up', 1) === 'ABE', lit('up', 1));
  check('7.1 upstream 2 reaches what sets the checked helper', lit('up', 2) === 'ABEF', lit('up', 2));
  check('7.1 downstream 1', lit('down', 1) === 'BC', lit('down', 1));
  check('7.1 downstream 2', lit('down', 2) === 'BCD', lit('down', 2));
  check('7.1 downstream all', lit('down', 0) === 'BCD', lit('down', 0));
  check('7.1 both 1', lit('both', 1) === 'ABCE', lit('both', 1));
  check('7.1 both all', lit('both', 0) === 'ABCDEF', lit('both', 0));
  check('7.1 off lights only the box', lit('off', 0) === 'B');
  const d = focusSet(edges, 'B', 'both', 0).dist;
  check('7.1 distances count arrows', d.get('B') === 0 && d.get('A') === 1 && d.get('F') === 2 && d.get('D') === 2, [...d]);
  check('7.1 the chain from C reaches what gates B upstream (its precursor chain)', [...focusSet(edges, 'C', 'chain', 0).dist.keys()].sort().join('') === 'ABCDEF');
  check('7.1 the chain from A lights only what it sets off, and not what B checks', [...focusSet(edges, 'A', 'chain', 0).dist.keys()].sort().join('') === 'ABCD');
}

// ---- 7.3 nearest sides and routing ----
{
  const box = (x, y) => ({ x, y, w: 240, h: 62 });
  const a = box(0, 0);
  check('7.3 target to the right: right side to left side', sides(a, box(400, 20)).join() === 'r,l');
  check('7.3 target moved to the left: sides flip', sides(a, box(-500, 30)).join() === 'l,r');
  check('7.3 target straight below: bottom to top', sides(a, box(30, 200)).join() === 'b,t');
  check('7.3 target above: top to bottom', sides(a, box(-20, -220)).join() === 't,b');
  const g = edgeGeom(a, box(-500, 30));
  const start = g.d.match(/^M([-\d.]+),/);
  check('7.3 an arrow to a box on the left leaves the left side', start && +start[1] <= 0, g.d);
  const A = box(0, 0), B = box(340, 0), C = box(680, 0);
  const r = edgeGeom(A, C, { boxes: [A, B, C] });
  const clear = r.way.length > 0 && r.way.every((p) => p[1] < B.y || p[1] > B.y + B.h);
  check('7.3 a long arrow detours around the box in the way', clear, r.way);
  const pts = []; r.d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x, y) => pts.push([+x, +y]));
  check('7.3 the detour path stays out of the middle box', pts.every((p) => !(p[0] > B.x + 4 && p[0] < B.x + B.w - 4 && p[1] > B.y + 4 && p[1] < B.y + B.h - 4)), r.d);
  // automatic layout: an arrow that skips a column gets a waypoint in that column, clear of the box there
  const m = edgesOf({
    'automation.start': { triggers: [T('cover.g', { to: 'open' })], actions: [A0('timer.start', 'timer.t')] },
    'automation.left': { triggers: [finished('timer.t')], conditions: [{ condition: 'state', entity_id: 'cover.g', state: 'open' }], actions: [] },
  });
  const pos = layered(m.keys.sort(), m.edges, () => ({ w: 240, h: 62 }));
  const way = pos.routes.get('cover.g>automation.left');
  check('4.3 a skip arrow gets a waypoint in each column it passes', way && way.length === 2, [...pos.routes]);
  const boxes = [...pos.entries()].map(([k, v]) => ({ k, x: v.x, y: v.y, w: 240, h: 62 }));
  const hitBox = way && way.map((p) => boxes.find((b) => p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h)).filter(Boolean);
  check('4.3 the waypoints are clear of the boxes in those columns', way && hitBox.length === 0, { way, hitBox });
}

// ---- stored values are cleaned before they reach HTML or CSS (1.5) ----
{
  check('colour: theme name passes', cssColor('indigo') === 'var(--indigo-color, indigo)');
  check('colour: hex passes', cssColor('#a1b2c3') === '#a1b2c3' && cssColor('#abc') === '#abc');
  const bad = cssColor('red"><img src=x onerror=1>');
  check('colour: markup is refused', !/[<>"]/.test(bad) && bad === 'var(--secondary-text-color)', bad);
  check('colour: css injection is refused', cssColor('red;background:url(x)') === 'var(--secondary-text-color)');
  const L = cleanLayout({ nodes: { 'light.x': { x: '12', y: 'oops' } }, frames: [{ id: 'a"b', title: 't', x: 1, y: 2, w: 300, h: 200 }, { id: 'ok_1', title: '<b>', x: '5', y: 6, w: 'wide', h: 10 }],
    notes: [{ id: "n'1", text: 'x' }, { id: 'n2', text: 7, x: 1, y: 1 }], paused: ['automation.a', 3], extra: { kept: true } });
  check('layout: frame id with a quote dropped', L.frames.length === 1 && L.frames[0].id === 'ok_1', L.frames);
  check('layout: numbers forced', L.frames[0].x === 5 && L.frames[0].w === 540 && L.frames[0].h === 120 && L.nodes['light.x'].x === 12 && L.nodes['light.x'].y === 0, L);
  check('layout: note ids checked, text kept as text', L.notes.length === 1 && L.notes[0].text === '7', L.notes);
  check('layout: paused list keeps entity ids only', JSON.stringify(L.paused) === '["automation.a"]', L.paused);
  check('layout: unknown keys kept for newer versions', L.extra && L.extra.kept === true);
  check('layout: garbage in gives an empty layout', JSON.stringify(cleanLayout('x').nodes) === '{}' && cleanLayout(null).frames.length === 0);
  // 0.11.1: what each scene or group shows of what it sets; only the three choices are kept
  const S = cleanLayout({ sets: { 'scene.sleep': 'all', 'group.lights': 'board', 'scene.bad': 'everything', 'scene.num': 3 } });
  check('layout: a scene\'s or group\'s choice of what it shows is kept, anything else dropped', JSON.stringify(S.sets) === JSON.stringify({ 'scene.sleep': 'all', 'group.lights': 'board' }), S.sets);
  check('layout: sets that aren\'t a map give none', JSON.stringify(cleanLayout({ sets: ['all'] }).sets) === '{}' && cleanLayout({}).sets === undefined);
  check('esc covers quotes', esc('a"b\'c<d>&') === 'a&quot;b&#39;c&lt;d&gt;&amp;');
}

// ---- developer tools (Phase 9) ----
{
  // what a test of a check, a live template and a watched trigger need from the config
  const cfg = {
    triggers: [T('cover.g', { to: 'open' }), { trigger: 'event', event_type: 'timer.finished', event_data: { entity_id: 'timer.t' } }],
    conditions: [{ condition: 'state', entity_id: 'input_boolean.away', state: 'off' }, "{{ is_state('sun.sun', 'below_horizon') }}",
      { condition: 'not', conditions: [{ condition: 'state', entity_id: 'climate.h', state: 'off' }] }],
    actions: [{ if: [{ condition: 'state', entity_id: 'input_boolean.auto', state: 'on' }], then: [{ action: 'script.close' }] },
      { condition: 'state', entity_id: 'lock.door', state: 'locked' },
      { action: 'notify.mobile_app_x', data: { message: "{{ states('sensor.temp') }} degrees", title: 'Hi' } }],
  };
  const refs = analyze(cfg, false, (x) => x).refs, by = (ref, role) => refs.find((r) => r.ref === ref && r.role === role);
  check('9.3 a top-level condition carries its config and place', by('input_boolean.away', 'condition').cond === cfg.conditions[0] && by('input_boolean.away', 'condition').cidx === 0);
  check('9.3 a bare template condition is a condition of its own', by('sun.sun', 'condition').cond === cfg.conditions[1] && by('sun.sun', 'condition').cidx === 1);
  check('9.3 a nested condition is tested as the whole outer condition', by('climate.h', 'condition').cond === cfg.conditions[2] && by('climate.h', 'condition').cidx === 2);
  check('9.3 a check among the actions is tested too, outside the top-level list', by('input_boolean.auto', 'condition').cond === cfg.actions[0].if[0] && by('input_boolean.auto', 'condition').cidx === -1);
  check('9.3 a condition step in the actions carries its config', by('lock.door', 'condition').cond === cfg.actions[1]);
  check('9.3 a template read in a message is no condition, but its template is kept', by('sensor.temp', 'condition').cond === null && /sensor\.temp/.test(by('sensor.temp', 'condition').tpl));
  check('9.3 a template condition keeps its template', by('sun.sun', 'condition').tpl === cfg.conditions[1]);
  check('9.3 triggers carry their config and index', by('cover.g', 'trigger').trig === cfg.triggers[0] && by('cover.g', 'trigger').tidx === 0
    && by('event:timer.finished', 'trigger').tidx === 1 && by('timer.t', 'trigger').trig === cfg.triggers[1]);
  check('9.2 an action reference carries its action, for a test notification', by('svc:notify.mobile_app_x', 'action').act === cfg.actions[2] && by('script.close', 'call').act === cfg.actions[0].then[0]);
  check('9.3 references outside a condition carry none', by('cover.g', 'trigger').cond === null && by('script.close', 'call').cond === null);
  const w = analyze({ triggers: [], actions: [{ action: 'weather.set', data: { condition: 'sunny', entity_id: 'weather.x', note: "{{ states('sensor.y') }}" } }] }, false, (x) => x).refs;
  check('9.3 a "condition" key in service data is not a condition to test', w.every((r) => r.cond == null), w.map((r) => [r.ref, r.cond]));
}
{
  // why a run stopped, from the trace shapes of Home Assistant 2026.11 (measured on the test Home Assistant)
  const failed = { script_execution: 'failed_conditions', config: { conditions: [{ condition: 'state', entity_id: 'cover.g', state: 'open' }] },
    trace: { 'trigger/0': [{ changed_variables: { trigger: { idx: '0', platform: 'event', event: { event_type: 'timer.finished', data: { entity_id: 'timer.t' } } } } }],
      'condition/0': [{ result: { result: false } }], 'condition/0/entity_id/0': [{ result: { result: false, state: 'closed', wanted_state: 'open' } }] } };
  check('9.4 a failed condition names itself and what it saw', whyStopped(failed) === "condition 1 wasn't met: cover.g is open (it was closed, needs open)", whyStopped(failed));
  const nt = { not_triggered: true, script_execution: 'not_triggered', trace: { 'trigger/1': [{ result: { reason: 'state_not_matched' } }] } };
  check('9.4 a trigger that saw a change but did not fire says why', whyStopped(nt) === "trigger 2 saw a change but didn't fire: state not matched", whyStopped(nt));
  check('9.4 an error in a step is named', /action\/1 failed: boom/.test(whyStopped({ script_execution: 'error', trace: { 'action/1': [{ error: 'boom' }] } })));
  check('9.4 condition text for numbers and templates', condText({ condition: 'numeric_state', entity_id: 's.t', above: 3 }) === 's.t above 3' && /^template /.test(condText('{{ 1 }}')));
  // the path a run took (4.5)
  const edges = [{ id: 'e1', from: 'timer.t', to: 'automation.l' }, { id: 'e2', from: 'event:timer.finished', to: 'automation.l' }, { id: 'e3', from: 'automation.l', to: 'script.close' },
    { id: 'e4', from: 'automation.l', to: 'svc:persistent_notification.create' }, { id: 'e5', from: 'automation.l', to: 'light.hall' }, { id: 'e6', from: 'cover.g', to: 'automation.l' }];
  const tr = { trace: { 'trigger/0': failed.trace['trigger/0'],
    'action/0': [{ result: { params: { domain: 'persistent_notification', service: 'create', service_data: { message: 'x' }, target: {} } } }],
    'action/1/then/0': [{ child_id: { domain: 'script', item_id: 'close' }, result: { params: { domain: 'script', service: 'close', service_data: {}, target: {} } } }] } };
  const p = runPath('automation.l', tr, edges);
  check('4.5 a run lights the arrows it used: its trigger, the event data entity, a script call, a target-less action', ['e1', 'e2', 'e3', 'e4'].every((x) => p.edges.includes(x)), p);
  check('4.5 arrows the run did not use stay dark', !p.edges.includes('e5') && !p.edges.includes('e6'), p);
  check('4.5 the trigger variables come from the trigger step', trigVar(tr).event.event_type === 'timer.finished');
  check('9.4 trigger descriptions point at boxes', srcKey('state of cover.garage_door') === 'cover.garage_door' && srcKey("event 'timer.finished'") === 'event:timer.finished'
    && srcKey('numeric state of sensor.t') === 'sensor.t' && srcKey('mqtt topic a/b') === 'mqtt:a/b' && srcKey('time') === null);
}
{
  // typed test data and kept tests
  check('9.2 key: value lines read as an object', JSON.stringify(parseLoose('entity_id: timer.t\ncount: 3\non: true\nname: "007"')) === '{"entity_id":"timer.t","count":3,"on":true,"name":"007"}');
  check('9.2 JSON is read as JSON', parseLoose('{"a": {"b": 1}}').a.b === 1 && JSON.stringify(parseLoose('')) === '{}');
  let threw = false; try { parseLoose('just words'); } catch (e) { threw = true; }
  check('9.2 unreadable data is refused, not guessed', threw);
  check('9.2 flat data is shown as key: value, nested as JSON', toLoose({ entity_id: 'timer.t', n: 2 }) === 'entity_id: timer.t\nn: 2' && /^\{/.test(toLoose({ a: { b: 1 } })) && toLoose({ s: '12' }) === 's: "12"');
  check('9.2 a kept test keeps only what a test can be', JSON.stringify(cleanTest({ kind: 'action', target: 'input_boolean.x', service: 'input_boolean.turn_on', data: { a: 1 }, evil: '<b>' }))
    === '{"kind":"action","target":"input_boolean.x","service":"input_boolean.turn_on","data":{"a":1}}');
  check('9.2 a kept test with a bad service or kind is dropped', cleanTest({ kind: 'action', target: 'x.y', service: 'rm -rf' }) === null && cleanTest({ kind: 'shell', target: 'x' }) === null);
  const L = cleanLayout({ tools: [{ id: 't1', type: 'inject', title: 'Go', test: { kind: 'event', target: 'event:x', event_type: 'x', event_data: { a: 1 } } },
    { id: 'bad id', type: 'inject', test: { kind: 'event', target: 'e', event_type: 'x' } }, { id: 'm1', type: 'monitor', what: 'mqtt', topic: 'a/#', target: 'mqtt:a/#' },
    { id: 'm2', type: 'monitor', topic: '' }, { id: 't2', type: 'other' }] });
  check('9.2 layout keeps clean test buttons and monitors only', L.tools.length === 2 && L.tools[0].test.event_data.a === 1 && L.tools[1].what === 'mqtt' && L.tools[1].topic === 'a/#', L.tools);
  check('9.2 a layout without tools gets none', cleanLayout({}).tools === undefined);
}

// ---- the arrow editor (7.5) ----
{
  check('7.5 YAML preview: lists of maps the way Home Assistant writes them', toYaml({ triggers: [{ trigger: 'state', entity_id: 'cover.g', to: 'open' }] })
    === 'triggers:\n  - trigger: state\n    entity_id: cover.g\n    to: open', toYaml({ triggers: [{ trigger: 'state', entity_id: 'cover.g', to: 'open' }] }));
  check('7.5 YAML preview: strings that would read as something else are quoted', toYaml({ to: 'on', n: '12', t: "{{ x }}", e: '', ok: 'fine' }) === 'to: "on"\nn: "12"\nt: "{{ x }}"\ne: ""\nok: fine', toYaml({ to: 'on', n: '12', t: '{{ x }}', e: '', ok: 'fine' }));
  check('7.5 YAML preview: nested lists and empty values', toYaml({ a: [[1, 2]], b: {}, c: [] }) === 'a:\n  - - 1\n    - 2\nb: {}\nc: []', toYaml({ a: [[1, 2]], b: {}, c: [] }));
  const cfg = {
    triggers: [{ trigger: 'state', entity_id: 'cover.g', to: 'open' }, { trigger: 'state', entity_id: ['cover.g', 'binary_sensor.d'] }, { trigger: 'event', event_type: 'timer.finished', event_data: { entity_id: 'timer.t' } }],
    conditions: [{ condition: 'state', entity_id: 'cover.g', state: 'open' }, { condition: 'or', conditions: [{ condition: 'state', entity_id: 'input_boolean.a', state: 'on' }, { condition: 'template', value_template: "{{ is_state('cover.g', 'open') }}" }] }],
    actions: [{ action: 'light.turn_on', target: { entity_id: ['light.a', 'light.b'] } }, { if: [{ condition: 'state', entity_id: 'input_boolean.a', state: 'on' }], then: [{ action: 'script.close' }, { action: 'cover.close_cover', target: { entity_id: 'cover.g' } }] },
      { action: 'notify.mobile_app_x', data: { message: 'hi' } }, { action: 'light.turn_off', target: { entity_id: 'light.a', area_id: 'kitchen' } }],
  };
  const r = refsTo(cfg, false, 'cover.g');
  const sig = (x) => refPlace(x) + ':' + x.mode;
  check('7.5 every direct reference to a box is found, with its place', JSON.stringify(r.map(sig)) === JSON.stringify(['Trigger 1:node', 'Trigger 2:drop', 'Condition 1:node', 'Action 2 › then 2:node']), r.map(sig));
  check('7.5 a reference only inside a template is not offered (the editor handles that)', !r.some((x) => x.path.includes('conditions') && x.path.length > 2));
  const out = dropRefs(cfg, r);
  check('7.5 removing them: whole triggers, conditions and steps go; a list keeps its other entity', out.triggers.length === 2 && out.triggers[0].entity_id === 'binary_sensor.d' && out.conditions.length === 1
    && out.actions[1].then.length === 1 && out.actions[1].then[0].action === 'script.close', out);
  check('7.5 the original config is left alone', cfg.triggers.length === 3 && cfg.actions[1].then.length === 2);
  check('7.5 a light in a list of two: only it goes', JSON.stringify(dropRefs(cfg, refsTo(cfg, false, 'light.b')).actions[0].target.entity_id) === '"light.a"');
  const la = refsTo(cfg, false, 'light.a');
  check('7.5 a step that also targets an area keeps the area', la.find((x) => x.path[1] === 3).mode === 'drop' && dropRefs(cfg, la).actions[3].target.area_id === 'kitchen' && !dropRefs(cfg, la).actions[3].target.entity_id, dropRefs(cfg, la).actions[3]);
  check('7.5 a script call, an event and an action box are found', refsTo(cfg, false, 'script.close').length === 1 && refsTo(cfg, false, 'event:timer.finished')[0].mode === 'node'
    && refsTo(cfg, false, 'svc:notify.mobile_app_x').length === 1 && refsTo(cfg, false, 'area:kitchen')[0].mode === 'drop');
  check('7.5 a nested condition is removed from its group', refPlace(refsTo(cfg, false, 'input_boolean.a')[0]) === 'Condition 2 › condition 1' && dropRefs(cfg, [refsTo(cfg, false, 'input_boolean.a')[0]]).conditions[1].conditions.length === 1, refsTo(cfg, false, 'input_boolean.a').map(sig));
  const sc = { sequence: [{ action: 'light.turn_on', target: { entity_id: 'light.a' } }, { condition: 'state', entity_id: 'input_boolean.a', state: 'on' }] };
  check('7.5 scripts: steps and condition steps', JSON.stringify(refsTo(sc, true, 'light.a').map(sig)) === '["Step 1:node"]' && refsTo(sc, true, 'input_boolean.a')[0].kind === 'condition');
}

// ---- Node-RED flows (2.7): the shapes of node-red-contrib-home-assistant-websocket, neutral names ----
{
  const flows = [
    { id: 't1', type: 'tab', label: 'Recirculation' }, { id: 't2', type: 'tab', label: 'Lights' },
    { id: 'a1', type: 'server-state-changed', z: 't1', name: 'Motion', entities: { entity: ['binary_sensor.motion_hall', 'binary_sensor.motion_kitchen'], substring: [], regex: [] }, wires: [['a2']] },
    { id: 'a2', type: 'api-current-state', z: 't1', name: 'Pump state', entity_id: 'switch.pump', wires: [['a3'], []] },
    { id: 'a3', type: 'function', z: 't1', name: 'Decide', func: "const t = global.get('homeassistant').states['input_number.recirc_minutes'];\nreturn msg;", wires: [['a4']] },
    { id: 'a4', type: 'api-call-service', z: 't1', name: 'Pump on', action: 'switch.turn_on', entityId: ['switch.pump'], data: '', wires: [['a5']] },
    { id: 'a5', type: 'api-call-service', z: 't1', name: 'Tell', action: 'script.announce', entityId: [], data: '{"entity_id": "media_player.kitchen"}', wires: [] },
    { id: 'b1', type: 'inject', z: 't1', name: 'Every hour', wires: [['b2']] }, { id: 'b2', type: 'debug', z: 't1', wires: [] },
    { id: 'c1', type: 'server-state-changed', z: 't2', name: '', entityidfilter: 'light.porch', entityidfiltertype: 'exact', wires: [['c2']] },
    { id: 'c2', type: 'server-events', z: 't2', eventType: 'my_event', wires: [] },
    { id: 'x9', type: 'comment', z: 't1', name: 'note' },
  ];
  const known = (x) => (/^(binary_sensor\.motion_(hall|kitchen)|switch\.pump|input_number\.recirc_minutes|script\.announce|media_player\.kitchen|light\.porch)$/.test(x) ? x : null);
  const g = nrGroups({ flows }.flows, known);
  const r = g.find((x) => x.tab === 't1');
  check('2.7 one box per wired group that touches Home Assistant; groups without entities are left out', g.length === 2, g.map((x) => x.name));
  check('2.7 named after its first trigger node', r.name === 'Motion' && r.tabLabel === 'Recirculation' && r.size === 5, r);
  check('2.7 state-changed entities trigger it', JSON.stringify(r.trig.sort()) === '["binary_sensor.motion_hall","binary_sensor.motion_kitchen"]', r.trig);
  check('2.7 current-state entities and entity IDs in function code are read by it', r.read.includes('switch.pump') && r.read.includes('input_number.recirc_minutes'), r.read);
  check('2.7 call-service targets and entity IDs in its data are changed by it', r.change.includes('switch.pump') && r.change.includes('media_player.kitchen'), r.change);
  check('2.7 a script action is a script run', JSON.stringify(r.calls) === '["script.announce"]', r.calls);
  const l = g.find((x) => x.tab === 't2');
  check('2.7 older filters and event listeners too; an unnamed group takes its tab\'s name', l.trig[0] === 'light.porch' && l.events[0] === 'my_event' && l.name === 'Lights', l);
  check('2.7 garbage in, nothing out', nrGroups(null, known).length === 0 && nrGroups([{ type: 'tab' }, 5], known).length === 0);
}

// 4.9 the board's words: one table per language, English when a text or a language is missing
{
  check('4.9 English by default', tx('automation') === 'Automation' && px('n_automations', 1) === '1 automation' && px('n_automations', 3) === '3 automations',
    [tx('automation'), px('n_automations', 1), px('n_automations', 3)]);
  STR.en.__t = 'A {a} and {b} {c}';
  check('4.9 placeholders are filled; an unknown one stays', tx('__t', { a: 1, b: 'x' }) === 'A 1 and x {c}', tx('__t', { a: 1, b: 'x' }));
  check('4.9 an id with no text shows the id', tx('no_such_text') === 'no_such_text');
  let built = 0;
  onLang(() => { built++; });
  STR.pt = { automation: 'Automação', n_automations: { one: '{n} automação', other: '{n} automações' } };
  setLang('pt-BR');
  check('4.9 pt-BR falls back to pt, then English for what pt leaves out', tx('automation') === 'Automação' && tx('script') === 'Script', [tx('automation'), tx('script')]);
  check('4.9 word tables are built again when the language changes', built === 1, built);
  setLang('pt-BR');
  check('4.9 ... and only then', built === 1, built);
  check('4.9 counts use the language\'s forms', px('n_automations', 1) === '1 automação' && px('n_automations', 2) === '2 automações', [px('n_automations', 1), px('n_automations', 2)]);
  STR.pl = { n_automations: { one: '{n} automatyzacja', few: '{n} automatyzacje', many: '{n} automatyzacji', other: '{n} automatyzacji' } };
  setLang('pl');
  check('4.9 languages with more plural forms get them', px('n_automations', 1) === '1 automatyzacja' && px('n_automations', 3) === '3 automatyzacje' && px('n_automations', 5) === '5 automatyzacji',
    [1, 3, 5].map((n) => px('n_automations', n)));
  check('4.9 a form a language leaves out falls back to other', (STR.pl.n_x = { other: '{n} x' }) && px('n_x', 3) === '3 x');
  setLang('xx-YY');
  check('4.9 an unknown language is English', tx('automation') === 'Automation' && px('n_automations', 1) === '1 automation');
  check('4.9 condText reads in the language too', condText({ condition: 'template', value_template: '{{ x }}' }) === 'template {{ x }}', condText({ condition: 'template', value_template: '{{ x }}' }));
  delete STR.en.__t; delete STR.pt; delete STR.pl;
  setLang('en');
}

