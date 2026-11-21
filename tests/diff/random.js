// Random scenarios for the differential test (0.11.2, run weekly): small homes of 1 to 3 automations built from the
// pieces the corpus covers one at a time, put together at random, and a random list of steps. The same seed makes the
// same scenarios, so a difference the weekly run finds can be run again: FB_DIFF_RANDOM=<n> FB_DIFF_SEED=<seed>.
//
// Nothing loops for ever: an automation that starts on a helper only changes helpers after it in the order x, y, z
// (and the counter, which starts nothing), so every chain ends.

function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (list) => list[Math.floor(r() * list.length)];
  r.maybe = (p) => r() < p;
  return r;
}

const HELP = ['input_boolean.x', 'input_boolean.y', 'input_boolean.z'];
const BIN = ['binary_sensor.a', 'binary_sensor.b'];

function trigger(r, after) {
  // after: the helpers this automation may change; it may start on a helper before all of them
  const k = r.int(0, 9);
  const t = {};
  if (k <= 3) {
    Object.assign(t, { trigger: 'state', entity_id: r.pick(BIN) });
    const w = r.int(0, 4);
    if (w === 0) t.to = 'on'; else if (w === 1) t.to = 'off'; else if (w === 2) { t.from = 'off'; t.to = 'on'; } else if (w === 3) t.to = null;
    if (t.to && r.maybe(0.3)) t.for = { seconds: r.pick([5, 15, 30, 45]) };
  } else if (k <= 6) {
    Object.assign(t, { trigger: 'numeric_state', entity_id: 'sensor.t' });
    if (r.maybe(0.6)) t.above = r.pick([10, 20, 30]);
    if (!t.above || r.maybe(0.4)) t.below = (t.above || 0) + r.pick([10, 20]);
    if (r.maybe(0.25)) t.for = { seconds: r.pick([10, 20, 40]) };
  } else if (k === 7) {
    Object.assign(t, { trigger: 'event', event_type: 'fb_go' });
    if (r.maybe(0.5)) t.event_data = { kind: r.pick(['press', 'hold']) };
  } else {
    const first = HELP.findIndex((h) => after.includes(h));
    const before = HELP.slice(0, first < 0 ? HELP.length : first);
    if (!before.length) return { trigger: 'state', entity_id: r.pick(BIN), to: r.pick(['on', 'off']) };
    Object.assign(t, { trigger: 'state', entity_id: r.pick(before), to: r.pick(['on', 'off']) });
  }
  return t;
}

function condition(r) {
  const k = r.int(0, 4);
  if (k <= 1) return { condition: 'state', entity_id: r.pick(BIN.concat(HELP)), state: r.pick(['on', 'off']) };
  if (k === 2) return { condition: 'numeric_state', entity_id: 'sensor.t', above: r.pick([5, 15, 25]) };
  if (k === 3) return { condition: 'not', conditions: [{ condition: 'state', entity_id: r.pick(BIN), state: 'on' }] };
  return { condition: 'or', conditions: [{ condition: 'state', entity_id: r.pick(BIN), state: 'on' }, { condition: 'numeric_state', entity_id: 'sensor.t', below: r.pick([10, 20]) }] };
}

function action(r, mine, depth) {
  const k = r.int(0, depth > 1 ? 5 : 9);
  if (k <= 3) return { action: 'input_boolean.' + r.pick(['turn_on', 'turn_off', 'toggle']), target: { entity_id: r.pick(mine) } };
  if (k === 4) return { action: 'counter.increment', target: { entity_id: 'counter.c' } };
  if (k === 5) return { delay: { seconds: r.pick([3, 7, 12, 20]) } };
  if (k === 6) return { if: [condition(r)], then: [action(r, mine, depth + 1)], else: r.maybe(0.5) ? [action(r, mine, depth + 1)] : undefined };
  if (k === 7) return { choose: [{ conditions: [condition(r)], sequence: [action(r, mine, depth + 1)] }], default: [action(r, mine, depth + 1)] };
  if (k === 8) return { repeat: { count: r.int(1, 3), sequence: [action(r, mine, depth + 1)] } };
  return { wait_for_trigger: [{ trigger: 'state', entity_id: r.pick(BIN), to: 'on' }], timeout: { seconds: r.pick([10, 30]) }, continue_on_timeout: r.maybe(0.5) };
}

function clean(x) { return JSON.parse(JSON.stringify(x)); }  // drops the undefined

function one(r, n) {
  const autos = {};
  const count = r.int(1, 3);
  for (let i = 0; i < count; i++) {
    // the helpers this one may change: from a random place in the order on
    const from = r.int(0, HELP.length - 1), mine = HELP.slice(from);
    const a = { triggers: [trigger(r, mine)] };
    if (r.maybe(0.3)) a.triggers.push(trigger(r, mine));
    // a trigger on a helper this one changes would make a loop: drop it
    a.triggers = a.triggers.filter((t) => !(t.entity_id && mine.includes(t.entity_id)));
    if (!a.triggers.length) a.triggers = [{ trigger: 'state', entity_id: r.pick(BIN), to: 'on' }];
    if (r.maybe(0.4)) a.conditions = [condition(r)];
    a.actions = Array.from({ length: r.int(1, 3) }, () => action(r, mine, 0));
    if (r.maybe(0.5)) a.mode = r.pick(['single', 'restart', 'queued', 'parallel']);
    autos[String.fromCharCode(97 + i)] = clean(a);
  }
  const steps = [];
  for (let i = r.int(3, 8); i > 0; i--) {
    const k = r.int(0, 9);
    if (k <= 3) steps.push({ set: r.pick(BIN), to: r.pick(['on', 'off']) });
    else if (k <= 5) steps.push({ set: 'sensor.t', to: String(r.pick([0, 8, 12, 18, 22, 28, 35])) });
    else if (k === 6) steps.push({ event: 'fb_go', data: { kind: r.pick(['press', 'hold']) } });
    else steps.push({ wait: r.pick([2, 5, 10, 20, 45, 60]) });
  }
  steps.push({ wait: 90 });
  const states = { 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'], 'sensor.t': ['15'], 'counter.c': ['0'] };
  HELP.forEach((h) => { states[h] = [r.pick(['on', 'off'])]; });
  // helpers that follow what they read (a threshold, a group, a min/max), read by the automations now and then; they
  // read only the sensors, so no loop
  const derived = {};
  if (r.maybe(0.4)) derived['binary_sensor.hot'] = { kind: 'threshold', entity: 'sensor.t', lower: r.maybe(0.4) ? 10 : null, upper: r.maybe(0.7) ? r.pick([20, 25]) : null, hysteresis: r.pick([0, 1, 2.5]) };
  if (derived['binary_sensor.hot'] && derived['binary_sensor.hot'].lower == null && derived['binary_sensor.hot'].upper == null) derived['binary_sensor.hot'].upper = 20;
  if (r.maybe(0.4)) derived['binary_sensor.any'] = { kind: 'group', entities: BIN.slice(), all: r.maybe(0.5) };
  if (r.maybe(0.3)) { derived['sensor.avg'] = { kind: 'min_max', type: r.pick(['mean', 'max', 'min', 'sum', 'median']), round: r.pick([0, 1, 2]), entities: ['sensor.t', 'sensor.u'] }; states['sensor.u'] = ['12']; }
  Object.keys(derived).forEach((id) => { states[id] = ['unknown']; });
  const ids = Object.keys(derived);
  Object.values(autos).forEach((a) => {
    if (!ids.length) return;
    const id = r.pick(ids);
    if (r.maybe(0.5)) a.triggers.push(id === 'sensor.avg' ? { trigger: 'numeric_state', entity_id: id, above: r.pick([12, 15, 20]) } : { trigger: 'state', entity_id: id, to: r.pick(['on', 'off']) });
    else if (r.maybe(0.5)) a.conditions = (a.conditions || []).concat([id === 'sensor.avg' ? { condition: 'numeric_state', entity_id: id, below: r.pick([14, 18, 25]) } : { condition: 'state', entity_id: id, state: r.pick(['on', 'off']) }]);
  });
  if (states['sensor.u']) for (let i = 0; i < 2; i++) steps.splice(r.int(0, steps.length - 1), 0, { set: 'sensor.u', to: String(r.pick([3, 11.5, 17, 24.25])) });
  return Object.assign({ name: `random ${n}`, states, automations: autos, steps }, ids.length ? { derived } : {});
}

function make(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => one(r, `${seed}-${i + 1}`));
}

module.exports = { make };
