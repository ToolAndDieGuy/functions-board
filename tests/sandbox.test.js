// The sandbox engine (Phase 10), without a browser or Home Assistant. Run: node --test tests/sandbox.test.js
// Templates go to a stand-in for Home Assistant's renderer that knows a few forms and reads the sandbox's states;
// tests/e2e/sandbox.test.js renders them with the real Home Assistant.

const lib = require('./lib/board-lib');
const { cleanCheck, runCheck, Sandbox, sbxRewrite, durMs, localAt, sbxEffect, sbxReads, flowPath, flowCrossings, verPrint, devIdsIn, swapDevs } = lib;

const { check } = require('./lib/check');
const TZ = 'America/New_York';
const at = (hhmm) => localAt(Date.parse('2026-11-17T12:00:00Z'), hhmm.split(':').map(Number), TZ);  // Tue 17 Nov 2026
const S = (state, attributes) => ({ state, attributes: attributes || {}, last_changed: '2026-11-17T10:00:00Z', last_updated: '2026-11-17T10:00:00Z' });
const MIN = 60000;

// a few template forms, read from the sandbox (the real renderer is tested end to end)
function stubTpl(sb) {
  return async (t) => {
    let m = /^\{\{\s*is_state\('([^']+)',\s*'([^']+)'\)\s*\}\}$/.exec(t);
    if (m) return { ok: true, value: (sb.get(m[1]) || {}).state === m[2], partly: [] };
    m = /^\{\{\s*states\('([^']+)'\)\s*\|\s*float\s*>\s*([\d.]+)\s*\}\}$/.exec(t);
    if (m) return { ok: true, value: parseFloat((sb.get(m[1]) || {}).state) > +m[2], partly: [] };
    m = /^\{\{\s*states\('([^']+)'\)\s*\}\}$/.exec(t);
    if (m) return { ok: true, value: (sb.get(m[1]) || {}).state, partly: [] };
    m = /^\{\{\s*(\d+)\s*\}\}$/.exec(t);
    if (m) return { ok: true, value: +m[1], partly: [] };
    m = /^\{\{\s*trigger\.to_state\.state\s*\}\}$/.exec(t);
    return { ok: false, err: 'unknown to the stub' };
  };
}
function make(states, items, opt = {}) {
  let sb;
  const asks = [];
  sb = new Sandbox(Object.assign({
    states, items: Object.entries(items).map(([id, cfg]) => ({ id, cfg })), now: opt.now || at('20:00'), tz: TZ,
    tpl: (t, v) => stubTpl(sb)(t, v), ask: async (q) => { asks.push(q.text); return opt.answer !== undefined ? opt.answer : true; },
    name: (id) => id, condText: (c) => (typeof c === 'string' ? c : c.condition || 'condition'),
  }, opt.o || {}));
  sb.asks = asks;
  return sb;
}
const kinds = (sb, k) => sb.log.filter((e) => e.kind === k);
const st = (sb, id) => (sb.get(id) || {}).state;

(async () => {
  // ---- the garage: left open for 10 minutes, auto-close on → close it (a script), and notify
  {
    const sb = make({ 'cover.garage_door': S('closed'), 'input_boolean.auto_close': S('on'), 'automation.left_open': S('on'), 'script.close_garage': S('off') }, {
      'automation.left_open': { triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open', for: '00:10:00' }],
        conditions: [{ condition: 'state', entity_id: 'input_boolean.auto_close', state: 'on' }], actions: [{ action: 'script.close_garage' }] },
      'script.close_garage': { sequence: [{ action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }, { action: 'notify.mobile_app_phone', data: { message: 'closed' } }] },
    });
    await sb.start();
    await sb.userSet('cover.garage_door', 'open');
    check('garage: opening it starts the 10-minute wait, nothing runs yet', st(sb, 'cover.garage_door') === 'open' && kinds(sb, 'trigger').length === 0 && sb.pending().length === 1, sb.pending());
    await sb.advance(9 * MIN);
    check('garage: 9 minutes on, still waiting', kinds(sb, 'trigger').length === 0);
    await sb.advance(1 * MIN);
    check('garage: at 10 minutes the automation fires and its condition passes', kinds(sb, 'trigger').length === 1 && kinds(sb, 'cond')[0].ok === true);
    check('garage: the script it calls closes the door', st(sb, 'cover.garage_door') === 'closed' && sb.get('cover.garage_door').attributes.current_position === 0);
    const calls = kinds(sb, 'call');
    check('garage: the notification is a message: listed, nothing to change, not a gap', calls.some((c) => c.svc === 'notify.mobile_app_phone' && c.msg && !c.unknown), calls.map((c) => [c.svc, !!c.msg]));
    const close = sb.log.find((e) => e.kind === 'state' && e.to === 'closed');
    const chain = []; for (let e = close; e; e = sb.log.find((x) => x.id === e.cause)) chain.push(e.kind);
    check('garage: each change knows what caused it, back to you', chain.join('>') === 'state>call>call>trigger>state' && sb.log.find((e) => e.kind === 'state' && e.by === 'you'), chain);
    check('garage: both runs finished', kinds(sb, 'run').length === 2 && kinds(sb, 'run').every((r) => r.outcome === 'finished'), kinds(sb, 'run'));
    check('garage: nothing is changed in Home Assistant: its states are only read', sb.real['cover.garage_door'].state === 'closed');

    const sb2 = make({ 'cover.garage_door': S('closed'), 'input_boolean.auto_close': S('on') }, { 'automation.left_open': sb.items.get('automation.left_open').cfg });
    await sb2.start();
    await sb2.userSet('cover.garage_door', 'open');
    await sb2.advance(4 * MIN);
    await sb2.userSet('cover.garage_door', 'closed');
    await sb2.advance(20 * MIN);
    check('garage: closed again within 10 minutes, the wait is let go', kinds(sb2, 'trigger').length === 0 && sb2.pending().length === 0);
    const sb3 = make({ 'cover.garage_door': S('closed'), 'input_boolean.auto_close': S('off') }, { 'automation.left_open': sb.items.get('automation.left_open').cfg });
    await sb3.start();
    await sb3.userSet('cover.garage_door', 'open');
    await sb3.advance(10 * MIN);
    check('garage: auto-close off, the condition stops it, and says why', kinds(sb3, 'cond')[0].ok === false && /auto_close: off/.test(kinds(sb3, 'cond')[0].why) && kinds(sb3, 'run')[0].outcome === 'stopped', kinds(sb3, 'cond'));
  }

  // ---- a chain through a timer and its event
  {
    const sb = make({ 'input_boolean.away': S('off'), 'timer.lights': S('idle', { duration: '0:05:00' }), 'light.porch': S('on') }, {
      'automation.start': { triggers: [{ trigger: 'state', entity_id: 'input_boolean.away', to: 'on' }], actions: [{ action: 'timer.start', target: { entity_id: 'timer.lights' } }] },
      'automation.done': { triggers: [{ trigger: 'event', event_type: 'timer.finished', event_data: { entity_id: 'timer.lights' } }], actions: [{ action: 'light.turn_off', target: { entity_id: 'light.porch' } }] },
    });
    await sb.start();
    await sb.userSet('input_boolean.away', 'on');
    check('timer: started by the first automation', st(sb, 'timer.lights') === 'active' && st(sb, 'light.porch') === 'on');
    await sb.toNext();
    check('timer: run to the next thing due, it finishes and fires timer.finished, which turns the porch light off', st(sb, 'timer.lights') === 'idle' && st(sb, 'light.porch') === 'off' && kinds(sb, 'event').some((e) => e.text === 'timer.finished'));
    check('timer: the clock moved exactly 5 minutes', sb.now - at('20:00') === 5 * MIN, (sb.now - at('20:00')) / MIN);
  }

  // ---- run modes
  {
    const cfg = (mode) => ({ mode, triggers: [{ trigger: 'event', event_type: 'go' }], actions: [{ delay: '00:01:00' }, { action: 'counter.increment', target: { entity_id: 'counter.n' } }] });
    for (const [mode, want, note] of [['single', '1', /already running/], ['restart', '1', /Restarted/], ['queued', '2', /Queued/], ['parallel', '2', null]]) {
      const sb = make({ 'counter.n': S('0') }, { 'automation.a': cfg(mode) });
      await sb.start();
      await sb.userEvent('go');
      await sb.advance(20000);
      await sb.userEvent('go');
      await sb.advance(5 * MIN);
      check(`mode ${mode}: two triggers 20 s apart → counter ${want}`, st(sb, 'counter.n') === want && (!note || kinds(sb, 'note').some((e) => note.test(e.text))), [st(sb, 'counter.n'), kinds(sb, 'note').map((e) => e.text)]);
    }
  }

  // ---- choose, if, repeat, variables, templates, and asking what it can't know
  {
    const sb = make({ 'sensor.temp': S('27'), 'input_select.mode': S('day', { options: ['day', 'evening', 'night'] }), 'counter.n': S('0'), 'light.l': S('off'), 'input_boolean.flag': S('on') }, {
      'automation.c': { triggers: [{ trigger: 'event', event_type: 'go' }], actions: [
        { choose: [{ conditions: [{ condition: 'template', value_template: "{{ states('sensor.temp') | float > 30 }}" }], sequence: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] },
          { conditions: "{{ states('sensor.temp') | float > 25 }}", sequence: [{ action: 'input_select.select_next', target: { entity_id: 'input_select.mode' } }] }],
          default: [{ action: 'light.turn_off', target: { entity_id: 'light.l' } }] },
        { repeat: { count: '{{ 3 }}', sequence: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] } },
        { if: [{ condition: 'sun', after: 'sunset' }], then: [{ action: 'light.turn_on', target: { entity_id: 'light.l' }, data: { brightness_pct: 40 } }] },
        { repeat: { while: [{ condition: 'state', entity_id: 'input_boolean.flag', state: 'on' }], sequence: [{ action: 'input_boolean.turn_off', target: { entity_id: 'input_boolean.flag' } }] } },
        { condition: "{{ is_state('light.l', 'off') }}" },
        { action: 'counter.increment', target: { entity_id: 'counter.n' } },
      ] },
    });
    await sb.start();
    await sb.userEvent('go');
    check('choose: the first true option runs (27° → the 25° option)', st(sb, 'input_select.mode') === 'evening');
    check('repeat count from a template: 3 times', +st(sb, 'counter.n') >= 3);
    check('a sun condition: the sandbox asks, and goes by the answer', sb.asks.some((q) => /sun/.test(q)) && st(sb, 'light.l') === 'on' && sb.get('light.l').attributes.brightness === 102, sb.asks);
    check('repeat while: stops once its condition is false', st(sb, 'input_boolean.flag') === 'off');
    check('a condition step that is false ends the run there', st(sb, 'counter.n') === '3' && kinds(sb, 'run')[0].outcome === 'stopped', [st(sb, 'counter.n'), kinds(sb, 'run')[0]]);
  }

  // ---- a loop: an automation that changes what triggers it
  {
    const sb = make({ 'input_boolean.a': S('off') }, {
      'automation.loop': { mode: 'parallel', max: 1000, triggers: [{ trigger: 'state', entity_id: 'input_boolean.a' }], actions: [{ action: 'input_boolean.toggle', target: { entity_id: 'input_boolean.a' } }] },
    });
    await sb.start();
    await sb.userSet('input_boolean.a', 'on');
    check('a loop is stopped, and said to be a loop', sb.halted && kinds(sb, 'note').some((e) => /loop/.test(e.text)), kinds(sb, 'note').map((e) => e.text));
  }

  // ---- time: a time trigger, a weekday, a time pattern, a time condition
  {
    const sb = make({ 'light.l': S('off'), 'counter.n': S('0') }, {
      'automation.night': { triggers: [{ trigger: 'time', at: '22:00:00' }], conditions: [{ condition: 'time', after: '21:00', before: '06:00', weekday: ['tue'] }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] },
      'automation.tick': { triggers: [{ trigger: 'time_pattern', minutes: '/15' }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
    }, { now: at('21:50') });
    await sb.start();
    await sb.advance(9 * MIN);
    check('time: not yet at 21:59', st(sb, 'light.l') === 'off');
    await sb.advance(2 * MIN);
    check('time: at 22:00 (New York) on a Tuesday it fires and the time condition (21:00–06:00, Tue) passes', st(sb, 'light.l') === 'on', kinds(sb, 'cond'));
    check('time pattern /15: 22:00 is one, 21:50→22:01 makes one', st(sb, 'counter.n') === '1', st(sb, 'counter.n'));
    await sb.advance(60 * MIN);
    check('time pattern: four more by 23:01', st(sb, 'counter.n') === '5', st(sb, 'counter.n'));
    check('time: armed again for tomorrow', sb.pending().some((p) => p.key === 'automation.night' && p.at === localAt(at('12:00') + 86400000, [22, 0, 0], TZ)), sb.pending());
  }

  // ---- numeric state: fires on crossing, not while it stays above
  {
    const sb = make({ 'sensor.temp': S('20'), 'counter.n': S('0') }, {
      'automation.hot': { triggers: [{ trigger: 'numeric_state', entity_id: 'sensor.temp', above: 25 }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
    });
    await sb.start();
    await sb.userSet('sensor.temp', '26');
    await sb.userSet('sensor.temp', '28');
    await sb.userSet('sensor.temp', '22');
    await sb.userSet('sensor.temp', '30');
    check('numeric state: fires each time it crosses above 25, not while it stays above', st(sb, 'counter.n') === '2', st(sb, 'counter.n'));
  }

  // ---- waiting for a trigger, with a timeout
  {
    const cfg = { triggers: [{ trigger: 'event', event_type: 'go' }], actions: [
      { wait_for_trigger: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }], timeout: '00:02:00', continue_on_timeout: false },
      { action: 'light.turn_on', target: { entity_id: 'light.l' } }] };
    const sb = make({ 'binary_sensor.door': S('off'), 'light.l': S('off') }, { 'automation.w': cfg });
    await sb.start();
    await sb.userEvent('go');
    await sb.advance(MIN);
    await sb.userSet('binary_sensor.door', 'on');
    check('wait for trigger: the door opening in time lets it carry on', st(sb, 'light.l') === 'on');
    const sb2 = make({ 'binary_sensor.door': S('off'), 'light.l': S('off') }, { 'automation.w': cfg });
    await sb2.start();
    await sb2.userEvent('go');
    await sb2.advance(3 * MIN);
    check('wait for trigger: timed out with continue_on_timeout false, it stops', st(sb2, 'light.l') === 'off' && kinds(sb2, 'run')[0].outcome === 'stopped', kinds(sb2, 'run'));
  }

  // ---- and, or, not (0.9.1; a mutant in tests/mutants.json found these untested)
  {
    const on = { condition: 'state', entity_id: 'input_boolean.a', state: 'on' }, off = { condition: 'state', entity_id: 'input_boolean.b', state: 'on' };
    const go = async (cond) => {
      const sb = make({ 'input_boolean.a': S('on'), 'input_boolean.b': S('off'), 'light.l': S('off') }, { 'automation.t': { triggers: [{ trigger: 'event', event_type: 'go' }], conditions: [cond], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] } });
      await sb.start();
      await sb.userEvent('go');
      return st(sb, 'light.l') === 'on';
    };
    const r = {
      notTrue: await go({ condition: 'not', conditions: [on] }), notFalse: await go({ condition: 'not', conditions: [off] }),
      andMixed: await go({ condition: 'and', conditions: [on, off] }), andTrue: await go({ condition: 'and', conditions: [on, on] }),
      orMixed: await go({ condition: 'or', conditions: [off, on] }), orFalse: await go({ condition: 'or', conditions: [off, off] }),
    };
    check('not: stops the run when what it holds is true, and lets it go when false', !r.notTrue && r.notFalse, r);
    check('and: needs every condition; or: any one', !r.andMixed && r.andTrue && r.orMixed && !r.orFalse, r);
  }

  // ---- a template it can't render: asked
  {
    const sb = make({ 'light.l': S('off') }, { 'automation.t': { triggers: [{ trigger: 'event', event_type: 'go' }], conditions: ["{{ (expand('group.x') | list | count) > 2 }}"], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] } }, { answer: false });
    await sb.start();
    await sb.userEvent('go');
    check('a template the renderer refused: asked, and "false" stops the run', sb.asks.length === 1 && st(sb, 'light.l') === 'off');
  }

  // ---- Home Assistant's per-entity triggers: light.turned_on, door.opened, lock.unlocked, event.received, counter, thresholds
  {
    const sb = make({ 'light.desk': S('off'), 'binary_sensor.front': S('off', { device_class: 'door' }), 'cover.garage': S('closed', { device_class: 'garage', is_closed: true }),
      'lock.front': S('locked'), 'event.remote': S('2026-11-17T10:00:00Z', { event_type: 'short_press' }), 'counter.c': S('2', { maximum: 3, initial: 0 }),
      'light.lamp': S('on', { brightness: 100 }), 'light.a': S('off'), 'light.b': S('off'), 'counter.n': S('0') }, {
      'automation.e1': { triggers: [{ trigger: 'light.turned_on', target: { entity_id: 'light.desk' } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.e2': { triggers: [{ trigger: 'door.opened', target: { entity_id: ['binary_sensor.front', 'cover.garage'] } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.e3': { triggers: [{ trigger: 'lock.unlocked', target: { entity_id: 'lock.front' }, options: { for: '00:01:00' } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.e4': { triggers: [{ trigger: 'event.received', target: { entity_id: 'event.remote' }, options: { event_type: ['long_press'] } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.e5': { triggers: [{ trigger: 'counter.maximum_reached', target: { entity_id: 'counter.c' } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.e6': { triggers: [{ trigger: 'light.brightness_crossed_threshold', target: { entity_id: 'light.lamp' }, options: { threshold: { type: 'above', value: { number: 200 } } } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.e7': { triggers: [{ trigger: 'light.turned_on', target: { entity_id: ['light.a', 'light.b'] }, options: { behavior: 'all' } }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
    });
    await sb.start();
    const n = () => +st(sb, 'counter.n');
    await sb.userSet('light.desk', 'on');
    check('light.turned_on: fires when the light turns on', n() === 1, n());
    await sb.userSet('binary_sensor.front', 'on');
    await sb.userSet('cover.garage', 'open');
    check('door.opened: a door sensor going on and a garage door cover opening (is_closed) both fire it', n() === 3, n());
    await sb.userSet('lock.front', 'unlocked');
    check('lock.unlocked with for: 1 minute: not yet', n() === 3);
    await sb.advance(61000);
    check('... and after a minute unlocked, it fires', n() === 4, n());
    await sb.userSet('event.remote', '2026-11-17T10:05:00Z', { event_type: 'short_press' });
    check('event.received: a press of another type does not fire it', n() === 4);
    await sb.userSet('event.remote', '2026-11-17T10:06:00Z', { event_type: 'long_press' });
    check('event.received: the event type it waits for does', n() === 5, n());
    await sb.userSet('counter.c', '3');
    check('counter.maximum_reached: reaching its maximum fires it', n() === 6, n());
    await sb.userSet('light.lamp', 'on', { brightness: 150 });
    await sb.userSet('light.lamp', 'on', { brightness: 230 });
    await sb.userSet('light.lamp', 'on', { brightness: 240 });
    check('brightness crossed above 200: once, on crossing', n() === 7, n());
    await sb.userSet('light.a', 'on');
    check('behavior all: one of two lights on does not fire it', n() === 7);
    await sb.userSet('light.b', 'on');
    check('... both on does', n() === 8, n());
  }

  // ---- a template trigger with for:, and waits for template, numeric and per-entity triggers
  {
    const sb = make({ 'sensor.t': S('20'), 'input_boolean.x': S('off'), 'light.l': S('off'), 'counter.n': S('0') }, {
      'automation.tf': { triggers: [{ trigger: 'template', value_template: "{{ states('sensor.t') | float > 25 }}", for: '00:05:00' }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
      'automation.w': { triggers: [{ trigger: 'event', event_type: 'go' }], actions: [
        { wait_for_trigger: [{ trigger: 'template', value_template: "{{ is_state('input_boolean.x', 'on') }}" }], timeout: '00:10:00', continue_on_timeout: false },
        { wait_for_trigger: [{ trigger: 'light.turned_on', target: { entity_id: 'light.l' } }], timeout: '00:10:00', continue_on_timeout: false },
        { action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
    });
    await sb.start();
    await sb.userSet('sensor.t', '27');
    await sb.advance(3 * MIN);
    await sb.userSet('sensor.t', '22');
    await sb.advance(5 * MIN);
    check('template trigger with for: true for 3 minutes then false: no run', st(sb, 'counter.n') === '0');
    await sb.userSet('sensor.t', '28');
    await sb.advance(5 * MIN);
    check('... true for 5 minutes: it fires', st(sb, 'counter.n') === '1', st(sb, 'counter.n'));
    await sb.userEvent('go');
    await sb.userSet('input_boolean.x', 'on');
    check('wait for a template trigger: carries on when it becomes true', sb.log.filter((e) => e.kind === 'wait').length === 2, sb.log.filter((e) => e.kind === 'wait').map((e) => e.text));
    await sb.userSet('light.l', 'on');
    check('wait for light.turned_on: carries on when the light turns on', st(sb, 'counter.n') === '2', st(sb, 'counter.n'));
  }

  // ---- MQTT: a trigger on a topic with wildcards and payload, and a publish in a script reaching it
  {
    const sb = make({ 'light.l': S('off'), 'counter.n': S('0') }, {
      'automation.m': { triggers: [{ trigger: 'mqtt', topic: 'zigbee2mqtt/+/action', payload: 'single' }], actions: [{ action: 'light.toggle', target: { entity_id: 'light.l' } }] },
      'automation.p': { triggers: [{ trigger: 'event', event_type: 'go' }], actions: [{ action: 'mqtt.publish', data: { topic: 'zigbee2mqtt/button/action', payload: 'single' } }] },
      'automation.j': { triggers: [{ trigger: 'mqtt', topic: 'home/#', value_template: '{{ 3 }}', payload: '3' }], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.n' } }] },
    });
    await sb.start();
    await sb.userMqtt('zigbee2mqtt/hall/action', 'double');
    check('MQTT: another payload does not fire it', st(sb, 'light.l') === 'off');
    await sb.userMqtt('zigbee2mqtt/hall/action', 'single');
    check('MQTT: the topic (+ wildcard) and payload it waits for do', st(sb, 'light.l') === 'on');
    await sb.userEvent('go');
    check('mqtt.publish in an automation reaches the MQTT trigger', st(sb, 'light.l') === 'off' && sb.log.some((e) => e.kind === 'mqtt' && e.cause));
    await sb.userMqtt('home/attic/temp', '{"t": 3}');
    check('MQTT: # wildcard and value_template', st(sb, 'counter.n') === '1');
  }

  // ---- run as if one of its triggers fired: trigger conditions and trigger variables
  {
    const sb = make({ 'binary_sensor.motion': S('on'), 'light.l': S('off'), 'light.m': S('off') }, {
      'automation.r': { triggers: [{ trigger: 'zone', entity_id: 'person.me', zone: 'zone.home', event: 'enter', id: 'home' }, { trigger: 'state', entity_id: 'binary_sensor.motion', to: 'on', id: 'motion' }],
        actions: [{ choose: [{ conditions: [{ condition: 'trigger', id: 'home' }], sequence: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] },
          { conditions: [{ condition: 'trigger', id: 'motion' }, "{{ trigger.entity_id == 'binary_sensor.motion' }}"], sequence: [{ action: 'light.turn_on', target: { entity_id: 'light.m' } }] }] }] },
    }, { o: { tpl: async (t, v) => ({ ok: true, value: v.trigger && v.trigger.entity_id === 'binary_sensor.motion', partly: [] }) } });
    await sb.start();
    check('a zone trigger is named as one the sandbox doesn\'t follow', sb.log.some((e) => e.kind === 'note' && /zone/.test(e.text)));
    await sb.userRun('automation.r', true, 0);
    check('run as if trigger 1 (zone, id home) fired: its trigger condition passes', st(sb, 'light.l') === 'on' && st(sb, 'light.m') === 'off');
    await sb.userRun('automation.r', true, 1);
    check('run as if trigger 2 fired: trigger.id and trigger.entity_id are set', st(sb, 'light.m') === 'on');
    const tr = sb.log.filter((e) => e.kind === 'trigger' && e.by === 'you');
    check('0.7.1 a run as if a trigger fired says where it would have come from (for the flow view)', tr[0].src === 'person.me' && tr[1].src === 'binary_sensor.motion', tr.map((e) => e.src));
    check('0.7.1 a condition says which entities it read', sb.log.some((e) => e.kind === 'cond' && Array.isArray(e.ents)));
  }

  // ---- versions (0.8.0): the fingerprint that says which version is active, and replaced devices
  {
    const D1 = 'a'.repeat(32), D2 = 'b'.repeat(32);
    const s1 = { members: ['automation.a', 'light.b'], items: { 'automation.a': { cfg: { alias: 'A', actions: [{ device_id: D1, type: 'turn_on' }, { action: 'light.turn_on', target: { device_id: [D1, 'not-a-device'] } }] } } } };
    const s2 = { members: ['light.b', 'automation.a'], items: { 'automation.a': { cfg: { actions: s1.items['automation.a'].cfg.actions, alias: 'A' } } }, layout: { nodes: { x: 1 } } };
    check('0.8.0 a version\'s fingerprint ignores order and layout, and changes with any config', verPrint(s1) === verPrint(s2) && verPrint(s1) !== verPrint({ members: s1.members, items: { 'automation.a': { cfg: { alias: 'B' } } } }));
    check('0.8.0 the devices a config names, at any depth', JSON.stringify([...devIdsIn(s1.items['automation.a'].cfg)]) === JSON.stringify([D1]));
    const sw = swapDevs(s1.items['automation.a'].cfg, { [D1]: D2 });
    check('0.8.0 a replaced device is swapped everywhere it\'s named, nothing else touched', JSON.stringify(sw).split(D2).length === 3 && !JSON.stringify(sw).includes(D1) && sw.alias === 'A' && sw.actions[1].target.device_id[1] === 'not-a-device', sw);
  }

  // ---- the flow view's helpers (0.7.1)
  check('0.7.1 a condition\'s reads: entity_id, nested conditions and templates, not its alias', JSON.stringify(sbxReads({ condition: 'and', alias: 'see light.x', conditions: [{ condition: 'state', entity_id: ['sensor.a', 'binary_sensor.b'], state: 'on' }, "{{ is_state('switch.c', 'on') }}", { condition: 'template', value_template: "{{ states('sensor.d') | float > 3 }}" }] }).sort())
    === JSON.stringify(['binary_sensor.b', 'sensor.a', 'sensor.d', 'switch.c']), sbxReads({ condition: 'and', alias: 'see light.x', conditions: [{ condition: 'state', entity_id: ['sensor.a', 'binary_sensor.b'] }, "{{ is_state('switch.c', 'on') }}", { condition: 'template', value_template: "{{ states('sensor.d') | float > 3 }}" }] }));
  {
    const A = { x: 0, y: 0, w: 100, h: 40 }, B = { x: 300, y: 100, w: 100, h: 40 }, C = { x: 20, y: 200, w: 100, h: 40 };
    const p = flowPath(A, B, false), q = flowPath(A, C, false), v = flowPath(A, C, true);
    check('0.7.1 a temporary arrow leaves the right side and enters the left, side by side', p.d === 'M100,20 L200,20 L200,120 L300,120' && p.mid[0] === 200 && p.mid[1] === 70, p);
    check('0.7.1 ... stacked, it goes round the side (left to right)', /^M100,20 L146,20 L146,220 L120,220$/.test(q.d), q.d);
    check('0.7.1 ... top to bottom: out of the bottom, into the top', v.d === 'M50,40 L50,120 L70,120 L70,200', v.d);
    check('0.7.1 counting the boxes an arrow runs through', flowCrossings(p.segs, [{ x: 180, y: 50, w: 50, h: 30 }, { x: 500, y: 0, w: 10, h: 10 }]) === 1 && flowCrossings(p.segs, [{ x: 210, y: 0, w: 50, h: 30 }]) === 0);
  }

  // ---- effects and durations
  check('durations: seconds, HH:MM:SS, HH:MM, objects', durMs(90) === 90000 && durMs('00:10:00') === 600000 && durMs('1:30') === 5400000 && durMs({ minutes: 2, seconds: 5 }) === 125000);
  check('effects: number clamps to its range, select cycles, lock, cover position', sbxEffect('input_number', 'set_value', S('5', { min: 0, max: 10 }), { value: 40 })[0] === '10'
    && sbxEffect('input_select', 'select_next', S('c', { options: ['a', 'b', 'c'] }), {})[0] === 'a' && sbxEffect('lock', 'unlock', S('locked'), {})[0] === 'unlocked'
    && sbxEffect('cover', 'set_cover_position', S('open'), { position: 0 })[0] === 'closed');
  check('effects: what it doesn\'t know is null', sbxEffect('notify', 'send', null, {}) === null && sbxEffect('script', 'reload', null, {}) === null);

  // ---- templates: the renaming that points them at the sandbox
  const R = (t) => sbxRewrite(t);
  check('rewrite: calls', R("{{ is_state('a.b', 'on') and states('c.d') == 'x' and state_attr('e.f', 'g') and now().hour }}").text === "{{ fb_is_state('a.b', 'on') and fb_states('c.d') == 'x' and fb_state_attr('e.f', 'g') and fb_now().hour }}");
  check('rewrite: object forms', R("{{ states.cover.garage.state }} {{ states['cover.garage'].last_changed }} {{ states.light | count }}").text === "{{ fb_obj('cover.garage').state }} {{ fb_obj('cover.garage').last_changed }} {{ fb_domain('light') | count }}");
  check('rewrite: filters and tests', R("{{ 'a.b' | states }} {{ 'a.b' | state_attr('x') }} {{ 'a.b' is is_state('on') }} {{ 'a.b' is has_value }}").text === "{{ 'a.b' | apply(fb_states) }} {{ 'a.b' | apply(fb_state_attr, 'x') }} {{ 'a.b' is apply(fb_is_state, 'on') }} {{ 'a.b' is apply(fb_has_value) }}");
  check('rewrite: utcnow, today_at, expand', R('{{ utcnow() > today_at("22:00") and expand("group.g") }}').text === '{{ fb_utcnow() > fb_today_at("22:00") and fb_expand("group.g") }}');
  check('rewrite: nothing left over in the usual forms', R("{{ is_state('a.b','on') }} {{ states.a.b.state }}").leftovers.length === 0);
  check('rewrite: every state at once and looked-up states have stand-ins too', R('{{ states | selectattr("state", "eq", "on") | list }}').text === '{{ fb_all() | selectattr("state", "eq", "on") | list }}'
    && R("{{ states[repeat.item].state }} {{ states[trigger.entity_id ~ ''].attributes['x'] }} {% for s in states %}{% endfor %}").text === "{{ fb_index(repeat.item).state }} {{ fb_index(trigger.entity_id ~ '').attributes['x'] }} {% for s in fb_all() %}{% endfor %}"
    && R('{{ states | count }} {{ states[x] }}').leftovers.length === 0, [R("{{ states[repeat.item].state }} {{ states[trigger.entity_id ~ ''].attributes['x'] }} {% for s in states %}{% endfor %}").text]);
  check('rewrite: locations are still reported as read from your home', R("{{ closest('zone.home') }}").leftovers.includes('closest') && R("{{ distance('zone.home') }}").leftovers.includes('distance'));
  check('rewrite: names ending in states or now aren\'t touched', R('{{ my_states(1) }} {{ x.now() }} {{ snow(2) }}').text === '{{ my_states(1) }} {{ x.now() }} {{ snow(2) }}');

  // ---- saved checks (0.9.0): replayed on the current configs, from the states they were saved with
  {
    const GARAGE = {
      'automation.left_open': { triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open', for: '00:10:00' }],
        conditions: [{ condition: 'state', entity_id: 'input_boolean.auto_close', state: 'on' }], actions: [{ action: 'script.close_garage' }] },
      'script.close_garage': { sequence: [{ action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }] },
    };
    // today the door is open and auto-close is off: the check starts from what it was saved with, not this
    const live = { 'cover.garage_door': S('open'), 'input_boolean.auto_close': S('off'), 'automation.left_open': S('on'), 'script.close_garage': S('off') };
    const o = (cfgs) => ({ states: live, items: Object.entries(cfgs).map(([id, cfg]) => ({ id, cfg })), tz: TZ, tpl: (t, v, e) => stubTpl(e)(t, v), name: (id) => id, condText: () => 'condition' });
    const chk = cleanCheck({ id: 'c1', name: 'Closes after 10 minutes', at: at('20:00'),
      start: { 'cover.garage_door': { state: 'closed' }, 'input_boolean.auto_close': { state: 'on' } },
      steps: [{ op: 'set', id: 'cover.garage_door', state: 'open' }, { op: 'advance', ms: 11 * MIN }],
      expect: [{ k: 'state', id: 'cover.garage_door', state: 'closed' }, { k: 'ran', id: 'automation.left_open' }, { k: 'ran', id: 'script.close_garage' }] });
    check('checks: a saved check is cleaned to what it may hold', !!chk && chk.steps.length === 2 && chk.expect.length === 3 && chk.start['cover.garage_door'].state === 'closed');
    const r1 = await runCheck(chk, o(GARAGE));
    check('checks: it passes on the configs it was made with, from its own starting states (not today\'s)', r1.ok && r1.res.every((x) => x.ok), r1.res);
    // someone edits the automation: 30 minutes now, so 11 minutes in nothing has happened
    const edited = JSON.parse(JSON.stringify(GARAGE)); edited['automation.left_open'].triggers[0].for = '00:30:00';
    const r2 = await runCheck(chk, o(edited));
    check('checks: after an edit that changes what happens, it fails, and says what it got', !r2.ok && r2.res[0].got === 'open' && !r2.res[1].ok && r2.res[1].got === 'none', r2.res);
    // the script loses its step
    const broken = JSON.parse(JSON.stringify(GARAGE)); broken['script.close_garage'].sequence = [];
    const r3 = await runCheck(chk, o(broken));
    check('checks: a script that ran but no longer closes the door fails on the state, not on "ran"', !r3.ok && !r3.res[0].ok && r3.res[1].ok && r3.res[2].ok, r3.res);
    // stopped and didn't run
    const stop = cleanCheck({ id: 'c2', name: 'Auto-close off: reminder only', at: at('20:00'), start: { 'cover.garage_door': { state: 'closed' }, 'input_boolean.auto_close': { state: 'off' } },
      steps: [{ op: 'set', id: 'cover.garage_door', state: 'open' }, { op: 'next' }],
      expect: [{ k: 'stopped', id: 'automation.left_open' }, { k: 'notran', id: 'script.close_garage' }, { k: 'state', id: 'cover.garage_door', state: 'open' }] });
    const r4 = await runCheck(stop, o(GARAGE));
    check('checks: "stopped by its conditions" and "didn\'t run" hold, and Next runs the clock to what\'s due', r4.ok, r4.res);
    // a question it was answered once is answered the same; a new one makes it unsure, not a pass
    const ASK = { 'automation.sunset': { triggers: [{ trigger: 'state', entity_id: 'input_boolean.go', to: 'on' }], conditions: [{ condition: 'sun', after: 'sunset' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.porch' } }] } };
    const live2 = { 'input_boolean.go': S('off'), 'light.porch': S('off'), 'automation.sunset': S('on') };
    const o2 = { states: live2, items: [{ id: 'automation.sunset', cfg: ASK['automation.sunset'] }], tz: TZ, tpl: (t, v, e) => stubTpl(e)(t, v), name: (id) => id, condText: (c) => (typeof c === 'string' ? c : c.condition || 'condition') };
    const sb = make(live2, ASK);
    await sb.start(); await sb.userSet('input_boolean.go', 'on');
    const askText = sb.asks[0];
    const withAns = cleanCheck({ id: 'c3', name: 'Porch at sunset', at: at('20:00'), start: {}, steps: [{ op: 'set', id: 'input_boolean.go', state: 'on' }],
      answers: [{ key: 'automation.sunset', text: askText, value: true }], expect: [{ k: 'state', id: 'light.porch', state: 'on' }] });
    const r5 = await runCheck(withAns, o2);
    check('checks: the answers given when it was saved are given again', !!askText && r5.ok && !r5.unsure, { askText, r5: r5.res, unsure: r5.unsure });
    const r6 = await runCheck(Object.assign({}, withAns, { answers: [] }), o2);
    check('checks: a question it has no answer for makes it unsure, never a pass', !r6.ok && !!r6.unsure, r6);
    check('checks: nothing to replay or nothing expected isn\'t a check', cleanCheck({ id: 'x', steps: [], expect: [{ k: 'ran', id: 'a.b' }] }) === null && cleanCheck({ id: 'x', steps: [{ op: 'next' }], expect: [] }) === null);
    check('checks: it keeps which automations and scripts took part, and nothing else in that list', JSON.stringify(cleanCheck({ id: 'x', items: ['automation.a', 'script.b', 'light.c', 5, 'automation.BAD id'], steps: [{ op: 'next' }], expect: [{ k: 'ran', id: 'automation.a' }] }).items) === '["automation.a","script.b"]');
    check('checks: steps and expectations it doesn\'t know are dropped', cleanCheck({ id: 'x', steps: [{ op: 'next' }, { op: 'shell', cmd: 'rm' }], expect: [{ k: 'ran', id: 'a.b' }, { k: 'eval', id: 'x' }] }).steps.length === 1);
  }

})().catch((e) => check('the sandbox tests ran to the end', false, String(e && e.stack || e)));
