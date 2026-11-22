// The differential test's corpus (0.11.2): small scenarios, one rule each, run in the sandbox (tests/diff/sandbox.js)
// and in Home Assistant's own core (tests/diff/test_diff.py), and compared after every step: the calls made and the
// states of every entity in the scenario. Nothing here comes from a real home.
//
// A scenario: { name, states: { id: [state, attributes?] }, automations: { name: config }, steps: [step] }
//   step: { set: id, to: state, attrs? } | { wait: seconds } | { event: type, data? } | { mqtt: topic, payload }
// MQTT entities (0.11.3, a scenario's mqtt: { id: { config, rule } }, made by mq() below): set up in the core run by
// MQTT discovery from config, on a mocked broker that hands back what's published; the sandbox gets rule, which
// test_diff.py checks is what functions_board/sources says for the entity Home Assistant made.
// Entities: binary_sensor.* and sensor.* are inputs (set by the steps); input_boolean, input_number, input_select,
// counter and timer are Home Assistant's real helpers in the core run, so what the automations do to them shows.
// No templates: the sandbox renders those through Home Assistant, which this test doesn't have. The exception is an
// MQTT entity's own: {{ value }} and {{ value_json.a.b }} only, which tests/diff/sandbox.js renders as Home Assistant
// writes Python's values.

const on = (id) => ({ action: 'input_boolean.turn_on', target: { entity_id: id } });
const off = (id) => ({ action: 'input_boolean.turn_off', target: { entity_id: id } });
const tog = (id) => ({ action: 'input_boolean.toggle', target: { entity_id: id } });
const inc = (id) => ({ action: 'counter.increment', target: { entity_id: id } });
const B = { 'input_boolean.x': ['off'], 'input_boolean.y': ['off'], 'input_boolean.z': ['off'] };
const st = (x) => Object.assign({}, B, { 'counter.c': ['0'] }, x || {});
const S = (entity_id, more) => Object.assign({ trigger: 'state', entity_id }, more);
const N = (entity_id, more) => Object.assign({ trigger: 'numeric_state', entity_id }, more);

const { mq } = require('./mqtt');
// the states an MQTT scenario starts from: its entities as Home Assistant has them before any message
const mqSt = (ents, more) => Object.assign(st(more), Object.fromEntries(Object.entries(ents).map(([id, x]) => [id, [x.state]])));
const pub = (topic, payload) => ({ mqtt: topic, payload });
const mqT = (topic, more) => Object.assign({ trigger: 'mqtt', topic }, more);
const publish = (topic, payload) => ({ action: 'mqtt.publish', data: { topic, payload } });

// ---- MQTT entities that follow their topics (0.11.3)
const M1 = mq('sensor.temp', { state_topic: 'h/climate', value_template: '{{ value_json.t }}', unit_of_measurement: '°C', device_class: 'temperature' });
const M2 = mq('binary_sensor.door', { state_topic: 'h/door', payload_on: 'open', payload_off: 'closed' });
const M3 = mq('sensor.lvl', { state_topic: 'h/lvl', unit_of_measurement: '%' });
const M4 = Object.assign(mq('sensor.p', { state_topic: 'h/p', availability_topic: 'h/avail' }), mq('sensor.q', { state_topic: 'h/q', availability: [{ topic: 'h/av1' }, { topic: 'h/av2', payload_available: 'up', payload_not_available: 'down' }], availability_mode: 'all' }));
const M5 = mq('binary_sensor.motion', { state_topic: 'h/motion', off_delay: 30 });
const M6 = mq('sensor.e', { state_topic: 'h/e', expire_after: 60 });
const M7 = Object.assign(mq('lock.l', { state_topic: 'h/lock' }), mq('cover.c', { state_topic: 'h/cover' }), mq('select.s', { state_topic: 'h/sel', options: ['Off', 'Lawn', 'Garden'] }), mq('switch.w', { state_topic: 'h/sw', payload_on: '1', payload_off: '0' }));
const M14 = mq('binary_sensor.mb', { state_topic: 'h/mb' });
const M8 = mq('number.n', { state_topic: 'h/num', min: 1, max: 5 });
const M9 = mq('sensor.a', { state_topic: 'h/a', json_attributes_topic: 'h/a/attr' });
const M10 = mq('event.btn', { state_topic: 'h/btn', event_types: ['press', 'hold'] });
const M11 = Object.assign(mq('device_tracker.ph', { state_topic: 'h/ph' }), mq('light.l', { schema: 'json', state_topic: 'h/light', command_topic: 'h/light/set' }));
const M12 = mq('binary_sensor.occ', { state_topic: 'h/climate', value_template: '{{ value_json.occ }}' });

const MQTT = [
  { name: 'an MQTT sensor follows its topic through its template', mqtt: M1, states: mqSt(M1), automations: { a: { triggers: [N('sensor.temp', { above: 70 })], actions: [inc('counter.c')] } },
    steps: [pub('h/climate', '{"t": 64.0}'), pub('h/climate', '{"t": 71.5}'), pub('h/climate', '{"t": "warm"}'), pub('h/climate', '{}'), pub('h/climate', '{"t": 69}'), pub('h/climate', '{"t": 72.25}'), pub('h/climate', 'None')] },
  { name: 'a binary sensor\'s payloads, and one that is not for it', mqtt: M2, states: mqSt(M2), automations: { a: { triggers: [S('binary_sensor.door', { to: 'on' })], actions: [inc('counter.c')] } },
    steps: [pub('h/door', 'open'), pub('h/door', 'ajar'), pub('h/door', 'closed'), pub('h/door', ''), pub('h/door', 'open'), pub('h/door', 'None')] },
  { name: 'an MQTT trigger and the entity the same message moves', mqtt: M3, states: mqSt(M3), automations: { a: { triggers: [mqT('h/lvl')], conditions: [{ condition: 'numeric_state', entity_id: 'sensor.lvl', above: 50 }], actions: [inc('counter.c')] } },
    steps: [pub('h/lvl', '60'), pub('h/lvl', '40'), pub('h/lvl', '55')] },
  { name: 'a state trigger on the entity and an MQTT trigger on its topic, in order', mqtt: M3, states: mqSt(M3),
    automations: { m: { triggers: [mqT('h/lvl')], actions: [tog('input_boolean.x')] }, s: { triggers: [S('sensor.lvl')], conditions: [{ condition: 'state', entity_id: 'input_boolean.x', state: 'on' }], actions: [inc('counter.c')] } },
    steps: [pub('h/lvl', '10'), pub('h/lvl', '20'), pub('h/lvl', '20'), pub('h/lvl', '30')] },
  { name: 'a publish in an automation reaches an entity and a trigger', mqtt: M3, states: mqSt(M3, { 'binary_sensor.b': ['off'] }),
    automations: { p: { triggers: [S('binary_sensor.b', { to: 'on' })], actions: [publish('h/lvl', '75')] }, t: { triggers: [N('sensor.lvl', { above: 70 })], actions: [on('input_boolean.x')] }, q: { triggers: [mqT('h/lvl', { payload: '75' })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, pub('h/lvl', '5')] },
  { name: 'availability: unavailable until it says so, and back with its state', mqtt: M4, states: mqSt(M4), automations: { a: { triggers: [S('sensor.p', { to: 'unavailable' })], actions: [inc('counter.c')] } },
    steps: [pub('h/p', '5'), pub('h/avail', 'online'), pub('h/avail', 'offline'), pub('h/p', '7'), pub('h/avail', 'online'), pub('h/q', 'a'), pub('h/av1', 'online'), pub('h/av2', 'up'), pub('h/av1', 'offline'), pub('h/av1', 'online'), pub('h/av2', 'online')] },
  { name: 'off_delay turns a binary sensor off by itself', mqtt: M5, states: mqSt(M5), automations: { a: { triggers: [S('binary_sensor.motion', { to: 'off' })], actions: [inc('counter.c')] } },
    steps: [pub('h/motion', 'ON'), { wait: 20 }, pub('h/motion', 'ON'), { wait: 20 }, { wait: 15 }, pub('h/motion', 'ON'), pub('h/motion', 'OFF'), { wait: 40 }] },
  { name: 'expire_after makes a sensor unavailable without messages', mqtt: M6, states: mqSt(M6), automations: { a: { triggers: [S('sensor.e', { to: 'unavailable' })], actions: [inc('counter.c')] } },
    steps: [pub('h/e', '5'), { wait: 50 }, pub('h/e', '6'), { wait: 50 }, { wait: 20 }, pub('h/e', '6')] },
  { name: 'a lock, a cover, a select and a switch read their payloads', mqtt: M7, states: mqSt(M7), automations: { a: { triggers: [S('lock.l', { to: 'jammed' }), S('cover.c', { to: 'closed' }), S('select.s', { to: 'Garden' }), S('switch.w', { to: 'on' })], actions: [inc('counter.c')] } },
    steps: [pub('h/lock', 'LOCKED'), pub('h/lock', 'JAMMED'), pub('h/lock', 'None'), pub('h/cover', 'opening'), pub('h/cover', 'stopped'), pub('h/cover', 'closing'), pub('h/cover', 'stopped'), pub('h/cover', 'bad'),
      pub('h/sel', 'Lawn'), pub('h/sel', 'Patio'), pub('h/sel', 'Garden'), pub('h/sel', 'none'), pub('h/sw', '1'), pub('h/sw', 'ON'), pub('h/sw', '0')] },
  { name: 'a number in range, out of range, and as text', mqtt: M8, states: mqSt(M8), automations: { a: { triggers: [N('number.n', { above: 2 })], actions: [inc('counter.c')] } },
    steps: [pub('h/num', '3'), pub('h/num', '7'), pub('h/num', '2.5'), pub('h/num', 'x'), pub('h/num', '1'), pub('h/num', '4.0'), pub('h/num', 'None')] },
  { name: 'json attributes replace the ones before', mqtt: M9, states: mqSt(M9), automations: { a: { triggers: [S('sensor.a', { attribute: 'level', to: 'high' })], actions: [inc('counter.c')] }, b: { triggers: [S('sensor.a')], actions: [tog('input_boolean.x')] } },
    steps: [pub('h/a', 'ok'), pub('h/a/attr', '{"level": "high", "n": 1}'), pub('h/a/attr', '{"level": "low"}'), pub('h/a/attr', '[1, 2]'), pub('h/a/attr', '{"level": "high", "friendly_name": "x"}'), pub('h/a/attr', 'not json')] },
  { name: 'an event entity: its types, and one it does not have', mqtt: M10, states: mqSt(M10), automations: { a: { triggers: [S('event.btn')], actions: [inc('counter.c')] }, b: { triggers: [S('event.btn', { attribute: 'event_type', to: 'hold' })], actions: [on('input_boolean.x')] } },
    steps: [pub('h/btn', '{"event_type": "press"}'), { wait: 1 }, pub('h/btn', '{"event_type": "spin"}'), pub('h/btn', '{"event_type": "hold"}'), { wait: 1 }, pub('h/btn', 'press'), pub('h/btn', '{"event_type": "press", "x": 2}')] },
  { name: 'a device tracker and a JSON light', mqtt: M11, states: mqSt(M11), automations: { a: { triggers: [S('device_tracker.ph', { to: 'home' })], actions: [inc('counter.c')] }, b: { triggers: [S('light.l', { to: 'on' })], actions: [on('input_boolean.x')] } },
    steps: [pub('h/ph', 'home'), pub('h/ph', 'not_home'), pub('h/ph', 'Work'), pub('h/ph', 'home'), pub('h/light', '{"state": "ON", "brightness": 50}'), pub('h/light', '{"state": "OFF"}')] },
  // (which of two entities on one topic Home Assistant writes first changes from one start to the next: its
  // subscriptions to a topic come in no fixed order. So nothing here reads one from what starts on the other.)
  { name: 'two entities on one topic', mqtt: Object.assign({}, M1, M12), states: mqSt(Object.assign({}, M1, M12)),
    automations: { a: { triggers: [S('binary_sensor.occ', { to: 'on' })], actions: [inc('counter.c')] }, b: { triggers: [S('sensor.temp')], actions: [tog('input_boolean.x')] } },
    steps: [pub('h/climate', '{"t": 60, "occ": "ON"}'), pub('h/climate', '{"t": 61, "occ": "OFF"}'), pub('h/climate', '{"t": 62, "occ": true}'), pub('h/climate', '{"t": 63, "occ": "ON"}')] },
  // 0.11.3: a run that published waits for the broker's answer, so it's still running while the rest of the change is
  // handed out: single mode drops the start a group that follows the same change makes (random 101-159, 404-99)
  { name: 'a run that published is still running when a group following the same change starts it', mqtt: M14, states: mqSt(M14, { 'binary_sensor.a': ['off'], 'binary_sensor.any': ['unknown'] }),
    derived: { 'binary_sensor.any': { kind: 'group', entities: ['binary_sensor.a'], all: false } },
    automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' }), S('binary_sensor.any', { to: 'on' })], actions: [tog('input_boolean.x'), publish('h/other', 'ON')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }] },
];

module.exports = [
  // ---- state triggers
  { name: 'state to', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'state from and to', states: st({ 'sensor.m': ['idle'] }), automations: { a: { triggers: [S('sensor.m', { from: 'idle', to: 'busy' })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: 'busy' }, { set: 'sensor.m', to: 'done' }, { set: 'sensor.m', to: 'busy' }, { set: 'sensor.m', to: 'idle' }, { set: 'sensor.m', to: 'busy' }] },
  { name: 'state for', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on', for: { minutes: 5 } })], actions: [on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 240 }, { wait: 120 }] },
  { name: 'state for restarts on a flicker', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on', for: { minutes: 5 } })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 120 }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }, { wait: 240 }, { wait: 90 }] },
  { name: 'state with nothing set fires on attribute changes', states: st({ 'sensor.m': ['1', { level: 1 }] }), automations: { a: { triggers: [S('sensor.m')], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: '1', attrs: { level: 2 } }, { set: 'sensor.m', to: '2', attrs: { level: 2 } }] },
  { name: 'state with to: null ignores attribute changes', states: st({ 'sensor.m': ['1', { level: 1 }] }), automations: { a: { triggers: [S('sensor.m', { to: null })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: '1', attrs: { level: 2 } }, { set: 'sensor.m', to: '2', attrs: { level: 2 } }] },
  { name: 'state from two states fires both ways', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { from: ['off', 'on'] })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'unavailable' }] },
  { name: 'state not_from unavailable', states: st({ 'binary_sensor.a': ['unavailable'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on', not_from: ['unavailable', 'unknown'] })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'state attribute', states: st({ 'sensor.m': ['ok', { mode: 'a' }] }), automations: { a: { triggers: [S('sensor.m', { attribute: 'mode', to: 'b' })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: 'ok', attrs: { mode: 'b' } }, { set: 'sensor.m', to: 'changed', attrs: { mode: 'b' } }, { set: 'sensor.m', to: 'changed', attrs: { mode: 'a' } }, { set: 'sensor.m', to: 'changed', attrs: { mode: 'b' } }] },
  // ---- numeric state
  { name: 'numeric above fires on crossing only', states: st({ 'sensor.t': ['20'] }), automations: { a: { triggers: [N('sensor.t', { above: 25 })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.t', to: '26' }, { set: 'sensor.t', to: '27' }, { set: 'sensor.t', to: '20' }, { set: 'sensor.t', to: '30' }, { set: 'sensor.t', to: 'unavailable' }, { set: 'sensor.t', to: '31' }] },
  { name: 'numeric between', states: st({ 'sensor.t': ['10'] }), automations: { a: { triggers: [N('sensor.t', { above: 15, below: 25 })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.t', to: '20' }, { set: 'sensor.t', to: '30' }, { set: 'sensor.t', to: '24' }, { set: 'sensor.t', to: '5' }] },
  { name: 'numeric below for', states: st({ 'sensor.t': ['50'] }), automations: { a: { triggers: [N('sensor.t', { below: 40, for: { minutes: 3 } })], actions: [on('input_boolean.x')] } },
    steps: [{ set: 'sensor.t', to: '30' }, { wait: 120 }, { set: 'sensor.t', to: '35' }, { wait: 70 }] },
  { name: 'numeric on an attribute', states: st({ 'sensor.m': ['ok', { level: 10 }] }), automations: { a: { triggers: [N('sensor.m', { attribute: 'level', above: 50 })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: 'ok', attrs: { level: 60 } }, { set: 'sensor.m', to: 'ok', attrs: { level: 70 } }] },
  // ---- conditions
  { name: 'state condition', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'state condition for', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on', for: { minutes: 2 } }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { wait: 150 }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'numeric condition', states: st({ 'binary_sensor.a': ['off'], 'sensor.t': ['10'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'numeric_state', entity_id: 'sensor.t', above: 15, below: 30 }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'sensor.t', to: '20' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'sensor.t', to: '40' }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'or and not', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'], 'binary_sensor.c': ['on'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'or', conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }, { condition: 'not', conditions: [{ condition: 'state', entity_id: 'binary_sensor.c', state: 'on' }] }] }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.c', to: 'off' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.c', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'time condition', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'time', after: '20:30:00', before: '23:00:00' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 1860 }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'trigger ids and the trigger condition', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on', id: 'one' }), S('binary_sensor.b', { to: 'on', id: 'two' })], actions: [{ choose: [{ conditions: [{ condition: 'trigger', id: 'one' }], sequence: [on('input_boolean.x')] }], default: [on('input_boolean.y')] }] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'on' }] },
  // ---- time
  { name: 'time trigger', states: st(), automations: { a: { triggers: [{ trigger: 'time', at: '20:30:00' }], actions: [on('input_boolean.x')] } }, steps: [{ wait: 1700 }, { wait: 200 }] },
  { name: 'time pattern', states: st(), automations: { a: { triggers: [{ trigger: 'time_pattern', minutes: '/10' }], actions: [inc('counter.c')] } }, steps: [{ wait: 1500 }] },
  // ---- actions and modes
  { name: 'delay', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [on('input_boolean.x'), { delay: { minutes: 2 } }, on('input_boolean.y')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 100 }, { wait: 30 }] },
  { name: 'mode single', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { mode: 'single', triggers: [S('binary_sensor.a')], actions: [inc('counter.c'), { delay: { seconds: 60 } }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { wait: 70 }, { set: 'binary_sensor.a', to: 'on' }, { wait: 70 }] },
  { name: 'mode restart', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { mode: 'restart', triggers: [S('binary_sensor.a')], actions: [inc('counter.c'), { delay: { seconds: 60 } }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 30 }, { set: 'binary_sensor.a', to: 'off' }, { wait: 70 }] },
  { name: 'mode queued', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { mode: 'queued', triggers: [S('binary_sensor.a')], actions: [inc('counter.c'), { delay: { seconds: 60 } }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { wait: 70 }, { wait: 70 }] },
  { name: 'mode parallel max 2', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { mode: 'parallel', max: 2, triggers: [S('binary_sensor.a')], actions: [inc('counter.c'), { delay: { seconds: 60 } }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }, { wait: 70 }] },
  { name: 'wait for a trigger, in time', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ wait_for_trigger: [S('binary_sensor.b', { to: 'on' })], timeout: { minutes: 1 }, continue_on_timeout: false }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 20 }, { set: 'binary_sensor.b', to: 'on' }] },
  { name: 'wait for a trigger, timed out', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ wait_for_trigger: [S('binary_sensor.b', { to: 'on' })], timeout: { minutes: 1 }, continue_on_timeout: false }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 70 }, { set: 'binary_sensor.b', to: 'on' }] },
  { name: 'choose and default', states: st({ 'sensor.t': ['10'] }), automations: { a: { triggers: [S('sensor.t')], actions: [{ choose: [{ conditions: [{ condition: 'numeric_state', entity_id: 'sensor.t', above: 20 }], sequence: [on('input_boolean.x')] }, { conditions: [{ condition: 'numeric_state', entity_id: 'sensor.t', below: 5 }], sequence: [on('input_boolean.y')] }], default: [inc('counter.c')] }] } },
    steps: [{ set: 'sensor.t', to: '30' }, { set: 'sensor.t', to: '2' }, { set: 'sensor.t', to: '12' }] },
  { name: 'if then else', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [{ if: [{ condition: 'state', entity_id: 'binary_sensor.a', state: 'on' }], then: [on('input_boolean.x')], else: [off('input_boolean.x')] }] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'repeat count', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ repeat: { count: 3, sequence: [inc('counter.c')] } }] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'repeat while', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ repeat: { while: [{ condition: 'numeric_state', entity_id: 'counter.c', below: 4 }], sequence: [inc('counter.c')] } }] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'repeat until', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ repeat: { until: [{ condition: 'numeric_state', entity_id: 'counter.c', above: 2 }], sequence: [inc('counter.c')] } }] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'parallel', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ parallel: [[{ delay: { seconds: 30 } }, on('input_boolean.x')], [on('input_boolean.y')]] }] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 40 }] },
  { name: 'stop', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [on('input_boolean.x'), { stop: 'done' }, on('input_boolean.y')] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'condition as an action', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [on('input_boolean.x'), { condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }, on('input_boolean.y')] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'disabled pieces', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' }), S('binary_sensor.a', { to: 'off', enabled: false })], conditions: [{ condition: 'state', entity_id: 'input_boolean.z', state: 'on', enabled: false }], actions: [on('input_boolean.x'), Object.assign(on('input_boolean.y'), { enabled: false })] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  // ---- helpers, chains and events
  { name: 'a chain through helpers', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [on('input_boolean.x')] }, b: { triggers: [S('input_boolean.x', { to: 'on' })], actions: [on('input_boolean.y')] }, c: { triggers: [S('input_boolean.y', { to: 'on' })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'counter and a numeric trigger on it', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [inc('counter.c')] }, b: { triggers: [N('counter.c', { above: 2 })], actions: [on('input_boolean.x'), { action: 'counter.reset', target: { entity_id: 'counter.c' } }] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'input number and select', states: st({ 'binary_sensor.a': ['off'], 'input_number.n': ['10', { min: 0, max: 100, step: 1 }], 'input_select.s': ['low', { options: ['low', 'high'] }] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'input_number.set_value', target: { entity_id: 'input_number.n' }, data: { value: 42 } }, { action: 'input_select.select_option', target: { entity_id: 'input_select.s' }, data: { option: 'high' } }] }, b: { triggers: [S('input_select.s', { to: 'high' })], actions: [on('input_boolean.x')] }, c: { triggers: [N('input_number.n', { above: 40 })], actions: [on('input_boolean.y')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'timer finished', states: st({ 'binary_sensor.a': ['off'], 'timer.tm': ['idle'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'timer.start', target: { entity_id: 'timer.tm' }, data: { duration: '00:02:00' } }] }, b: { triggers: [{ trigger: 'event', event_type: 'timer.finished', event_data: { entity_id: 'timer.tm' } }], actions: [on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 100 }, { wait: 30 }] },
  { name: 'timer cancelled', states: st({ 'binary_sensor.a': ['off'], 'timer.tm': ['idle'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'timer.start', target: { entity_id: 'timer.tm' }, data: { duration: '00:02:00' } }] }, b: { triggers: [S('binary_sensor.a', { to: 'off' })], actions: [{ action: 'timer.cancel', target: { entity_id: 'timer.tm' } }] }, c: { triggers: [{ trigger: 'event', event_type: 'timer.cancelled' }], actions: [on('input_boolean.y')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 30 }, { set: 'binary_sensor.a', to: 'off' }, { wait: 120 }] },
  { name: 'events with data', states: st(), automations: { a: { triggers: [{ trigger: 'event', event_type: 'fb_test', event_data: { kind: 'press' } }], actions: [inc('counter.c')] } },
    steps: [{ event: 'fb_test', data: { kind: 'press' } }, { event: 'fb_test', data: { kind: 'hold' } }, { event: 'fb_test', data: { kind: 'press', extra: 1 } }] },
  { name: 'an event fired by an action', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ event: 'fb_said', event_data: { n: 1 } }] }, b: { triggers: [{ trigger: 'event', event_type: 'fb_said' }], actions: [on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  // ---- the edges (each one a place an engine can get it wrong)
  { name: 'numeric above, already above when armed', states: st({ 'sensor.t': ['30'] }), automations: { a: { triggers: [N('sensor.t', { above: 25 })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.t', to: '31' }, { set: 'sensor.t', to: '20' }, { set: 'sensor.t', to: '26' }] },
  { name: 'numeric from a state that is not a number', states: st({ 'sensor.t': ['unknown'] }), automations: { a: { triggers: [N('sensor.t', { above: 25 })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.t', to: '30' }, { set: 'sensor.t', to: 'unavailable' }, { set: 'sensor.t', to: '30' }] },
  { name: 'state for: an attribute change does not restart it', states: st({ 'sensor.m': ['on', { level: 1 }] }), automations: { a: { triggers: [S('sensor.m', { to: 'off', for: { seconds: 60 } })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: 'off' }, { wait: 40 }, { set: 'sensor.m', to: 'off', attrs: { level: 2 } }, { wait: 30 }] },
  { name: 'state to a list', states: st({ 'sensor.m': ['a'] }), automations: { a: { triggers: [S('sensor.m', { to: ['b', 'c'] })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.m', to: 'b' }, { set: 'sensor.m', to: 'c' }, { set: 'sensor.m', to: 'd' }, { set: 'sensor.m', to: 'c' }] },
  { name: 'several entities in one trigger', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S(['binary_sensor.a', 'binary_sensor.b'], { to: 'on', for: { seconds: 30 } })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 10 }, { set: 'binary_sensor.b', to: 'on' }, { wait: 25 }, { wait: 10 }] },
  { name: 'time with seconds', states: st(), automations: { a: { triggers: [{ trigger: 'time', at: '20:00:30' }], actions: [on('input_boolean.x')] } }, steps: [{ wait: 20 }, { wait: 20 }] },
  { name: 'time pattern every 30 seconds', states: st(), automations: { a: { triggers: [{ trigger: 'time_pattern', seconds: '/30' }], actions: [inc('counter.c')] } }, steps: [{ wait: 125 }] },
  { name: 'condition on an attribute and a list of states', states: st({ 'binary_sensor.a': ['off'], 'sensor.m': ['ok', { mode: 'away' }] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'state', entity_id: 'sensor.m', attribute: 'mode', state: ['away', 'vacation'] }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'sensor.m', to: 'ok', attrs: { mode: 'home' } }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'condition on several entities, match any', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'], 'binary_sensor.c': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'state', entity_id: ['binary_sensor.b', 'binary_sensor.c'], state: 'on', match: 'any' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.c', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'condition on several entities, all', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'], 'binary_sensor.c': ['on'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'state', entity_id: ['binary_sensor.b', 'binary_sensor.c'], state: 'on' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'time condition on weekdays', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'time', weekday: ['mon', 'wed'] }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 86400 }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'time condition across midnight', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], conditions: [{ condition: 'time', after: '22:00:00', before: '06:00:00' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 3 * 3600 }, { set: 'binary_sensor.a', to: 'off' }, { wait: 7 * 3600 }, { set: 'binary_sensor.a', to: 'on' }] },
  { name: 'wait for a trigger, timed out and going on', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ wait_for_trigger: [N('sensor.t', { above: 5 })], timeout: { seconds: 30 } }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 40 }] },
  { name: 'restart cancels a wait', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { mode: 'restart', triggers: [S('binary_sensor.a')], actions: [inc('counter.c'), { wait_for_trigger: [S('binary_sensor.b', { to: 'on' })] }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.b', to: 'on' }] },
  { name: 'queued, max 2: the third waits are dropped', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { mode: 'queued', max: 2, triggers: [S('binary_sensor.a')], actions: [inc('counter.c'), { delay: { seconds: 30 } }] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { wait: 35 }, { wait: 35 }, { wait: 35 }] },
  { name: 'choose takes the first that passes', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ choose: [{ conditions: [{ condition: 'state', entity_id: 'binary_sensor.a', state: 'on' }], sequence: [on('input_boolean.x')] }, { conditions: [{ condition: 'state', entity_id: 'input_boolean.y', state: 'off' }], sequence: [on('input_boolean.y')] }] }] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'if without else', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [{ if: [{ condition: 'state', entity_id: 'binary_sensor.a', state: 'on' }], then: [inc('counter.c')] }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'repeat for each', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ repeat: { for_each: ['input_boolean.x', 'input_boolean.y'], sequence: [inc('counter.c')] } }] } }, steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'repeat while with a delay, stopped from outside', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['on'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ repeat: { while: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], sequence: [inc('counter.c'), { delay: { seconds: 10 } }] } }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 25 }, { set: 'binary_sensor.b', to: 'off' }, { wait: 10 }] },
  { name: 'sequence and a nested and', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['on'] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [{ sequence: [on('input_boolean.x'), { condition: 'and', conditions: [{ condition: 'state', entity_id: 'binary_sensor.a', state: 'on' }, { condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }] }, on('input_boolean.y')] }] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'stop in one branch of a parallel', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ parallel: [[{ stop: 'here' }], [{ delay: { seconds: 5 } }, on('input_boolean.x')]] }, on('input_boolean.y')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 10 }] },
  { name: 'a disabled condition inside choose', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ choose: [{ conditions: [{ condition: 'state', entity_id: 'input_boolean.z', state: 'on', enabled: false }], sequence: [on('input_boolean.x')] }], default: [on('input_boolean.y')] }] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'an automation turning another off', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'automation.turn_off', target: { entity_id: 'automation.b' } }] }, b: { triggers: [S('binary_sensor.b', { to: 'on' })], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.b', to: 'off' }, { set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }] },
  { name: 'automation.trigger skips the conditions', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'automation.trigger', target: { entity_id: 'automation.b' } }] }, b: { triggers: [], conditions: [{ condition: 'state', entity_id: 'input_boolean.z', state: 'on' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'a counter at its maximum', states: st({ 'binary_sensor.a': ['off'], 'counter.m': ['1', { maximum: 2 }] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [inc('counter.m'), on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'an input number set past its maximum stops the run', states: st({ 'binary_sensor.a': ['off'], 'input_number.n': ['10', { min: 0, max: 100, step: 1 }] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'input_number.set_value', target: { entity_id: 'input_number.n' }, data: { value: 150 } }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'an option a select does not have stops the run', states: st({ 'binary_sensor.a': ['off'], 'input_select.s': ['low', { options: ['low', 'high'] }] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'input_select.select_option', target: { entity_id: 'input_select.s' }, data: { option: 'medium' } }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'continue on error', states: st({ 'binary_sensor.a': ['off'], 'input_number.n': ['10', { min: 0, max: 100, step: 1 }] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'input_number.set_value', target: { entity_id: 'input_number.n' }, data: { value: 150 }, continue_on_error: true }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'a timer started again while running', states: st({ 'binary_sensor.a': ['off'], 'timer.tm': ['idle'] }), automations: { a: { triggers: [S('binary_sensor.a')], actions: [{ action: 'timer.start', target: { entity_id: 'timer.tm' }, data: { duration: '00:01:00' } }] }, b: { triggers: [{ trigger: 'event', event_type: 'timer.finished' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 40 }, { set: 'binary_sensor.a', to: 'off' }, { wait: 40 }, { wait: 30 }] },
  { name: 'a timer paused and started', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'], 'timer.tm': ['idle'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'timer.start', target: { entity_id: 'timer.tm' }, data: { duration: '00:01:00' } }] }, p: { triggers: [S('binary_sensor.b')], actions: [{ choose: [{ conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], sequence: [{ action: 'timer.pause', target: { entity_id: 'timer.tm' } }] }], default: [{ action: 'timer.start', target: { entity_id: 'timer.tm' } }] }] }, b: { triggers: [{ trigger: 'event', event_type: 'timer.finished' }], actions: [on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 20 }, { set: 'binary_sensor.b', to: 'on' }, { wait: 60 }, { set: 'binary_sensor.b', to: 'off' }, { wait: 30 }, { wait: 15 }] },
  { name: 'events of two types', states: st(), automations: { a: { triggers: [{ trigger: 'event', event_type: ['fb_one', 'fb_two'] }], actions: [inc('counter.c')] } },
    steps: [{ event: 'fb_one' }, { event: 'fb_two' }, { event: 'fb_three' }] },
  { name: 'a queue of helpers, in order', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [on('input_boolean.x'), off('input_boolean.x'), on('input_boolean.x')] }, b: { mode: 'queued', triggers: [S('input_boolean.x')], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'a toggle loop stopped by single mode', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [tog('input_boolean.x')] }, b: { triggers: [S('input_boolean.x', { to: 'on' })], actions: [{ delay: { seconds: 1 } }, off('input_boolean.x'), inc('counter.c')] }, c: { triggers: [S('input_boolean.x', { to: 'off' })], actions: [{ delay: { seconds: 1 } }, on('input_boolean.y')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 5 }] },
  // ---- the order of things when an automation is triggered (each found by a random scenario)
  { name: 'two triggers on one change both run', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: null }), S('binary_sensor.a', { from: 'off', to: 'on' })], actions: [tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }] },
  { name: 'two triggers on one change, the first waiting', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { mode: 'restart', triggers: [S('binary_sensor.a', { to: null }), S('binary_sensor.a', { to: 'on' })], actions: [inc('counter.c'), { delay: { seconds: 10 } }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 15 }] },
  { name: 'restart: a trigger whose conditions fail restarts nothing', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { mode: 'restart', triggers: [S('binary_sensor.a')], conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], actions: [{ delay: { seconds: 30 } }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'on' }, { wait: 10 }, { set: 'binary_sensor.b', to: 'off' }, { set: 'binary_sensor.a', to: 'off' }, { wait: 25 }] },
  { name: 'queued: the conditions as they were when it was triggered', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { a: { mode: 'queued', triggers: [S('binary_sensor.a')], conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], actions: [{ delay: { seconds: 20 } }, inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, { set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.a', to: 'off' }, { set: 'binary_sensor.b', to: 'off' }, { wait: 25 }, { wait: 25 }] },
  { name: 'an automation that starts itself is already running', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' }), S('input_boolean.x', { to: 'on' })], actions: [on('input_boolean.x'), inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }] },
  { name: 'automation.trigger waits for the run it starts', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'automation.trigger', target: { entity_id: 'automation.b' } }, on('input_boolean.y')] }, b: { triggers: [], actions: [{ delay: { seconds: 10 } }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 5 }, { wait: 10 }] },
  { name: 'a script called directly is waited for', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ action: 'automation.trigger', target: { entity_id: 'automation.b' } }, tog('input_boolean.y')] }, b: { triggers: [], actions: [tog('input_boolean.x'), { wait_for_trigger: [S('binary_sensor.a', { to: 'off' })], timeout: { seconds: 20 } }, tog('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 5 }, { set: 'binary_sensor.a', to: 'off' }, { wait: 5 }] },
  { name: 'after a delay, an automation that starts itself', states: st({ 'binary_sensor.a': ['off'] }), automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' }), S('input_boolean.x', { to: 'on' })], actions: [{ delay: { seconds: 5 } }, on('input_boolean.x'), inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { wait: 7 }, { wait: 7 }] },
  { name: 'a wait a queued change satisfies goes on after the handing out', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'] }), automations: { w: { triggers: [S('binary_sensor.a', { to: 'on' })], actions: [{ wait_for_trigger: [S('input_boolean.x', { to: 'on' })] }, on('input_boolean.y')] }, b: { triggers: [S('binary_sensor.b', { to: 'on' })], actions: [on('input_boolean.x'), on('input_boolean.z')] }, d: { triggers: [S('input_boolean.z', { to: 'on' })], conditions: [{ condition: 'state', entity_id: 'input_boolean.y', state: 'off' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }] },
  { name: 'a run does not hear the change that started it in its own wait', states: st({ 'binary_sensor.b': ['off'] }), automations: { a: { triggers: [S('binary_sensor.b')], actions: [{ wait_for_trigger: [S('binary_sensor.b', { to: 'on' })], timeout: { seconds: 10 }, continue_on_timeout: false }, on('input_boolean.x')] } },
    steps: [{ set: 'binary_sensor.b', to: 'on' }, { wait: 15 }] },
  { name: 'a waiting run is still running until the handing out is done', states: st({ 'binary_sensor.a': ['off'], 'binary_sensor.b': ['off'], 'input_boolean.q': ['off'], 'counter.k': ['0'] }), automations: { w: { triggers: [S('binary_sensor.a', { to: 'on' }), S('input_boolean.z', { to: 'on' })], actions: [inc('counter.k'), { wait_for_trigger: [S('input_boolean.x', { to: 'on' })] }, inc('counter.c')] }, b: { triggers: [S('binary_sensor.b', { to: 'on' })], actions: [on('input_boolean.x')] }, r: { triggers: [S('input_boolean.x', { to: 'on' })], actions: [{ repeat: { count: 20, sequence: [tog('input_boolean.q')] } }, on('input_boolean.z')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'binary_sensor.b', to: 'on' }] },
  // 0.11.3: a run woken from its delay goes on only after every timer due at that moment, so a single-mode run is still
  // running when its own for: trigger comes due at the second its delay ends (random 101-41)
  { name: 'a run woken from a delay is still running when its for: trigger comes due at the same moment', states: st({ 'binary_sensor.a': ['off'], 'sensor.t': ['15'] }),
    automations: { a: { triggers: [S('binary_sensor.a', { to: 'on' }), N('sensor.t', { above: 30, for: { seconds: 20 } })], actions: [{ delay: { seconds: 20 } }, inc('counter.c')] },
      b: { triggers: [N('sensor.t', { above: 30, for: { seconds: 40 } })], actions: [{ delay: { seconds: 20 } }, inc('counter.c')] },
      c: { triggers: [S('binary_sensor.a', { to: 'off' })], actions: [{ delay: { seconds: 20 } }, on('input_boolean.y')] }, d: { triggers: [S('binary_sensor.a', { to: 'off', for: { seconds: 20 } })], conditions: [{ condition: 'state', entity_id: 'input_boolean.y', state: 'off' }], actions: [on('input_boolean.z')] } },
    steps: [{ set: 'binary_sensor.a', to: 'on' }, { set: 'sensor.t', to: '35' }, { wait: 30 }, { set: 'binary_sensor.a', to: 'off' }, { wait: 30 }, { wait: 30 }] },
  // 0.11.3: a restarted run waits for the old one to stop, so it starts after the change is handed out, and a second
  // trigger of the same event restarts it before it does anything (random 404-247)
  { name: 'restart: two triggers of one event while a run waits, the first restart cancelled by the second', states: st({ 'binary_sensor.b': ['off'] }),
    automations: { a: { mode: 'restart', triggers: [{ trigger: 'event', event_type: 'fb_go', event_data: { kind: 'press' } }, { trigger: 'event', event_type: 'fb_go' }], actions: [tog('input_boolean.x'), inc('counter.c'), { wait_for_trigger: [S('binary_sensor.b', { to: 'on' })], timeout: { seconds: 30 } }, tog('input_boolean.y')] } },
    steps: [{ event: 'fb_go', data: { kind: 'hold' } }, { event: 'fb_go', data: { kind: 'press' } }, { set: 'binary_sensor.b', to: 'on' }, { event: 'fb_go', data: { kind: 'press' } }, { wait: 40 }] },
  // ---- helpers that follow what they read (each scenario's derived: the rule functions_board/sources gives)
  { name: 'a min/max mean follows its sensors, and an automation reads it', states: st({ 'sensor.t1': ['20'], 'sensor.t2': ['24'], 'sensor.avg': ['unknown'] }),
    derived: { 'sensor.avg': { kind: 'min_max', type: 'mean', round: 2, entities: ['sensor.t1', 'sensor.t2'] } },
    automations: { a: { triggers: [N('sensor.avg', { above: 23 })], actions: [on('input_boolean.x')] }, b: { triggers: [S('sensor.t1')], conditions: [{ condition: 'numeric_state', entity_id: 'sensor.avg', above: 24.5 }], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.t1', to: '26' }, { set: 'sensor.t2', to: 'unavailable' }, { set: 'sensor.t1', to: 'abc' }, { set: 'sensor.t2', to: '30' }, { set: 'sensor.t1', to: '18' }, { set: 'sensor.t1', to: '19.333' }] },
  { name: 'min, max, median, sum, range and last', states: st({ 'sensor.t1': ['2'], 'sensor.t2': ['3'], 'sensor.t3': ['unknown'], 'sensor.mn': ['unknown'], 'sensor.mx': ['unknown'], 'sensor.md': ['unknown'], 'sensor.sm': ['unknown'], 'sensor.rg': ['unknown'], 'sensor.ls': ['unknown'] }),
    derived: { 'sensor.mn': { kind: 'min_max', type: 'min', round: 2, entities: ['sensor.t1', 'sensor.t2', 'sensor.t3'] }, 'sensor.mx': { kind: 'min_max', type: 'max', round: 2, entities: ['sensor.t1', 'sensor.t2', 'sensor.t3'] },
      'sensor.md': { kind: 'min_max', type: 'median', round: 0, entities: ['sensor.t1', 'sensor.t2', 'sensor.t3'] }, 'sensor.sm': { kind: 'min_max', type: 'sum', round: 1, entities: ['sensor.t1', 'sensor.t2', 'sensor.t3'] },
      'sensor.rg': { kind: 'min_max', type: 'range', round: 2, entities: ['sensor.t1', 'sensor.t2', 'sensor.t3'] }, 'sensor.ls': { kind: 'min_max', type: 'last', round: 2, entities: ['sensor.t1', 'sensor.t2', 'sensor.t3'] } },
    automations: {},
    steps: [{ set: 'sensor.t3', to: '7.25' }, { set: 'sensor.t1', to: 'unavailable' }, { set: 'sensor.t1', to: '4' }, { set: 'sensor.t2', to: '-1.05' }, { set: 'sensor.t3', to: '1.5' }] },
  { name: 'a threshold with hysteresis', states: st({ 'sensor.t': ['20'], 'binary_sensor.hot': ['unknown'] }),
    derived: { 'binary_sensor.hot': { kind: 'threshold', entity: 'sensor.t', lower: null, upper: 25, hysteresis: 1 } },
    automations: { a: { triggers: [S('binary_sensor.hot', { to: 'on' })], actions: [inc('counter.c')] } },
    steps: [{ set: 'sensor.t', to: '25.5' }, { set: 'sensor.t', to: '26.5' }, { set: 'sensor.t', to: '25' }, { set: 'sensor.t', to: '23.9' }, { set: 'sensor.t', to: 'unavailable' }, { set: 'sensor.t', to: '30' }] },
  { name: 'a threshold below, and one between two', states: st({ 'sensor.t': ['20'], 'binary_sensor.cold': ['unknown'], 'binary_sensor.mild': ['unknown'] }),
    derived: { 'binary_sensor.cold': { kind: 'threshold', entity: 'sensor.t', lower: 10, upper: null, hysteresis: 0.5 }, 'binary_sensor.mild': { kind: 'threshold', entity: 'sensor.t', lower: 15, upper: 22, hysteresis: 1 } },
    automations: {},
    steps: [{ set: 'sensor.t', to: '9.6' }, { set: 'sensor.t', to: '9.4' }, { set: 'sensor.t', to: '10.4' }, { set: 'sensor.t', to: '16.5' }, { set: 'sensor.t', to: '21.5' }, { set: 'sensor.t', to: '23.5' }, { set: 'sensor.t', to: 'x' }] },
  { name: 'groups, any and all, with unknown and unavailable members', states: st({ 'binary_sensor.d1': ['off'], 'binary_sensor.d2': ['off'], 'binary_sensor.doors': ['unknown'], 'binary_sensor.both': ['unknown'] }),
    derived: { 'binary_sensor.doors': { kind: 'group', entities: ['binary_sensor.d1', 'binary_sensor.d2'], all: false }, 'binary_sensor.both': { kind: 'group', entities: ['binary_sensor.d1', 'binary_sensor.d2'], all: true } },
    automations: { a: { triggers: [S('binary_sensor.doors', { to: 'on' })], conditions: [{ condition: 'state', entity_id: 'binary_sensor.both', state: 'off' }], actions: [inc('counter.c')] } },
    steps: [{ set: 'binary_sensor.d1', to: 'on' }, { set: 'binary_sensor.d2', to: 'on' }, { set: 'binary_sensor.d1', to: 'off' }, { set: 'binary_sensor.d2', to: 'unknown' }, { set: 'binary_sensor.d1', to: 'unavailable' }, { set: 'binary_sensor.d2', to: 'unavailable' }, { set: 'binary_sensor.d1', to: 'on' }] },
  ...MQTT,
];
