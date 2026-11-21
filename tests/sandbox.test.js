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
  // ---- 0.11.1 a state trigger with From and no To: said when it fires on a change into a state it lists under From
  {
    const items = {
      'automation.both': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.stove', from: ['off', 'on'] }], actions: [] },
      'automation.meant': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.stove', from: ['off', 'on'], to: 'on' }], actions: [] },
      'automation.from_off': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.stove', from: 'off' }], actions: [] },
      'automation.any': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.stove' }], actions: [] },
    };
    const sb = make({ 'binary_sensor.stove': S('off') }, items);
    await sb.start();
    await sb.userSet('binary_sensor.stove', 'on');
    const notes = () => sb.log.filter((e) => e.kind === 'note' && e.warn && /under From/.test(e.text)).map((e) => e.key);
    check('0.11.1 from [off, on], off → on: said (on is listed under From)', JSON.stringify(notes()) === '["automation.both"]', sb.log.filter((e) => e.kind === 'note'));
    await sb.userSet('binary_sensor.stove', 'off');
    check('0.11.1 ... and on → off: said again; it fires both ways', JSON.stringify(notes()) === '["automation.both","automation.both"]', notes());
    check('0.11.1 ... it names the change and what to do', sb.log.some((e) => e.kind === 'note' && /automation\.both started on binary_sensor\.stove changing to off\. Its trigger lists off under From and has no To, so any change away from off, on starts it, this one too\. If it should start on only one change, give the trigger a To\./.test(e.text)));
    check('0.11.1 nothing said for From with a To, From alone that it fires on as written, or any change', !notes().some((k) => k !== 'automation.both'), notes());
    check('0.11.1 the triggers all fired as Home Assistant would', kinds(sb, 'trigger').filter((e) => e.key === 'automation.both').length === 2 && kinds(sb, 'trigger').filter((e) => e.key === 'automation.from_off').length === 1);
  }

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
    check('garage: at 10 minutes the automation fires and its condition passes', kinds(sb, 'trigger').length === 1 && (kinds(sb, 'cond')[0] || {}).ok === true);
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
    check('0.11.1 a zone trigger is followed now: not named as one the sandbox doesn\'t follow', !sb.log.some((e) => e.kind === 'note' && /zone/.test(e.text)));
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

  // ---- 0.11.1 device triggers, conditions and actions on an entity: followed as the state ones they stand for
  {
    const reg = { 'aa11': 'binary_sensor.hall_motion', 'bb22': 'light.hall', 'cc33': 'sensor.hall_temp' };
    const sb = make({ 'binary_sensor.hall_motion': S('off'), 'light.hall': S('off'), 'sensor.hall_temp': S('20'), 'light.porch': S('off') }, {
      'automation.dev': { triggers: [{ trigger: 'device', device_id: 'd1', domain: 'binary_sensor', entity_id: 'aa11', type: 'motion', id: 'move' }, { trigger: 'device', device_id: 'd1', domain: 'sensor', entity_id: 'cc33', type: 'temperature', above: 25, id: 'hot' }],
        conditions: [{ condition: 'device', device_id: 'd1', domain: 'light', entity_id: 'bb22', type: 'is_off' }],
        actions: [{ device_id: 'd1', domain: 'light', entity_id: 'bb22', type: 'turn_on' }] },
      'automation.after': { triggers: [{ trigger: 'device', device_id: 'd1', domain: 'binary_sensor', entity_id: 'aa11', type: 'no_motion', for: { minutes: 2 } }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.porch' } }] },
    }, { o: { entityOf: (x) => reg[x] || null } });
    await sb.start();
    check('0.11.1 entity device triggers are followed: not named as ones the sandbox doesn\'t follow', !sb.log.some((e) => e.kind === 'note' && /device/.test(e.text)), sb.log.filter((e) => e.kind === 'note'));
    await sb.userSet('binary_sensor.hall_motion', 'on');
    check('0.11.1 a binary sensor\'s device trigger "motion" fires on it turning on (registry id → entity)', kinds(sb, 'trigger').some((e) => e.key === 'automation.dev'));
    check('0.11.1 ... its device condition (light is off) passes without asking you, and its device action turns the light on', st(sb, 'light.hall') === 'on' && sb.asks.length === 0, sb.asks);
    await sb.userSet('binary_sensor.hall_motion', 'off');
    check('0.11.1 "no motion" for 2 minutes waits', st(sb, 'light.porch') === 'off');
    await sb.advance(2 * MIN);
    check('0.11.1 ... and fires after them', st(sb, 'light.porch') === 'on');
    await sb.userSet('light.hall', 'off');
    await sb.userSet('sensor.hall_temp', '26');
    check('0.11.1 a sensor\'s device trigger with above: a numeric state trigger', kinds(sb, 'trigger').filter((e) => e.key === 'automation.dev').length === 2);
    const lib2 = require('./lib/board-lib');
    check('0.11.1 binary sensor types: no_/not_ are off, locked is off, not_locked on', lib2.sbxBinOn('no_motion') === 'off' && lib2.sbxBinOn('not_opened') === 'off' && lib2.sbxBinOn('opened') === 'on' && lib2.sbxBinOn('locked') === 'off' && lib2.sbxBinOn('not_locked') === 'on' && lib2.sbxBinOn('is_bat_low') === 'on');
    check('0.11.1 a device trigger with no entity (an integration\'s own button) is left as it is', lib2.sbxDevTrig({ trigger: 'device', device_id: 'z', domain: 'zha', type: 'remote_button_short_press', subtype: 'turn_on' }, () => null) === null);
  }

  // ---- 0.11.1 an integration's own device trigger (ZHA, Z-Wave, Hue …): pressed by you, every trigger that is it fires
  {
    const btn = { trigger: 'device', device_id: 'zz', domain: 'zha', type: 'remote_button_short_press', subtype: 'turn_on' };
    const sb = make({ 'light.desk': S('off'), 'light.lamp': S('off') }, {
      'automation.on': { triggers: [btn], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.desk' } }] },
      'automation.off': { triggers: [Object.assign({}, btn, { subtype: 'turn_off' })], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.lamp' } }] },
    });
    await sb.start();
    const ins = sb.inputs();
    check('0.11.1 inputs: both buttons are there to press, named by device, type and subtype', ins.presses.length === 2 && ins.presses.some((x) => /remote button short press · turn on/.test(x.label)), ins.presses);
    await sb.userPress(ins.presses.find((x) => /turn on$/.test(x.label)).key);
    check('0.11.1 pressing one fires the automation on it, not the other', st(sb, 'light.desk') === 'on' && st(sb, 'light.lamp') === 'off');
  }

  // ---- 0.11.1 any trigger the sandbox can't see coming (Z-Wave value updated, geo location): fired from the Press row
  {
    const zw = { trigger: 'zwave_js.value_updated', entity_id: 'lock.front', command_class: 98, property: 'latchStatus', to: 'open' };
    const sb = make({ 'light.hall': S('off') }, { 'automation.zw': { triggers: [zw], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.hall' } }] } });
    await sb.start();
    const ins = sb.inputs(), x = ins.presses.find((y) => /^zwave_js\.value_updated/.test(y.label));
    check('0.11.1 a trigger the sandbox can\'t see coming is offered to fire, named by its settings', !!x && /property latchStatus/.test(x.label), ins.presses);
    check('0.11.1 ... and the note at the start says where', sb.log.some((e) => e.kind === 'note' && /Press row/.test(e.text) && /zwave_js\.value_updated/.test(e.text)));
    await sb.userPress(x.key);
    check('0.11.1 firing it runs the automation, with the trigger\'s settings as its trigger variables', st(sb, 'light.hall') === 'on' && kinds(sb, 'trigger')[0].text.includes('zwave_js'), kinds(sb, 'trigger'));
  }

  // ---- 0.11.1 saved checks keep the new steps (a press, an attribute set, Home Assistant starting) and replay them
  {
    const btn = { trigger: 'device', device_id: 'zz', domain: 'zha', type: 'remote_button_short_press', subtype: 'turn_on' };
    const items = [{ id: 'automation.on', cfg: { triggers: [btn], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.desk' } }] } },
      { id: 'automation.boot', cfg: { triggers: [{ trigger: 'homeassistant', event: 'start' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.porch' } }] } }];
    const c = lib.cleanCheck({ id: 'c1', at: at('20:00'), steps: [{ op: 'press', key: lib.sbxPressKey(btn) }, { op: 'set', id: 'light.lamp', state: null, attrs: { brightness: 10 } }, { op: 'ha', event: 'start' }, { op: 'shell' }],
      expect: [{ k: 'state', id: 'light.desk', state: 'on' }, { k: 'state', id: 'light.porch', state: 'on' }] });
    check('0.11.1 checks keep a press, an attribute set and Home Assistant starting (and drop what they don\'t know)', !!c && c.steps.map((x) => x.op).join() === 'press,set,ha' && c.steps[1].attrs.brightness === 10 && c.steps[1].state === null, c);
    const r = await runCheck(c, { states: { 'light.desk': S('off'), 'light.porch': S('off'), 'light.lamp': S('on', { brightness: 200 }) }, items, tz: TZ, tpl: async () => ({ ok: false, err: 'none' }), name: (x) => x, condText: () => '' });
    check('0.11.1 ... and replay them: the button, the restart, the attribute', r.ok && r.log.some((e) => e.kind === 'state' && e.key === 'light.lamp'), r.res);
  }

  // ---- 0.11.1 zones: triggers and conditions on a person's state
  {
    const sb = make({ 'person.sam': S('not_home'), 'zone.home': S('1', { friendly_name: 'Home' }), 'zone.work': S('0', { friendly_name: 'Work' }), 'light.l': S('off'), 'light.w': S('off') }, {
      'automation.home': { triggers: [{ trigger: 'zone', entity_id: 'person.sam', zone: 'zone.home', event: 'enter' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] },
      'automation.left_work': { triggers: [{ trigger: 'zone', entity_id: 'person.sam', zone: 'zone.work', event: 'leave' }], conditions: [{ condition: 'zone', entity_id: 'person.sam', zone: 'zone.home' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.w' } }] },
    });
    await sb.start();
    const z = sb.inputs().ents.find((x) => x.id === 'person.sam');
    check('0.11.1 inputs: a person in a zone trigger is offered its zones by name, and away', !!z && ['home', 'Work', 'not_home'].every((v) => z.vals.some((y) => y.v === v)), z);
    await sb.userSet('person.sam', 'Work');
    check('0.11.1 entering another zone isn\'t entering home', st(sb, 'light.l') === 'off');
    await sb.userSet('person.sam', 'home');
    check('0.11.1 entering home (state "home") fires the zone trigger', st(sb, 'light.l') === 'on');
    check('0.11.1 leaving work fires, and its zone condition (at home) passes', st(sb, 'light.w') === 'on' && sb.asks.length === 0, sb.asks);
  }

  // ---- 0.11.1 the sun follows the sandbox clock: sun.sun, sun triggers with offsets, sun conditions
  {
    const sun = S('above_horizon', { next_setting: new Date(at('16:50')).toISOString(), next_rising: new Date(at('07:00') + 86400000).toISOString() });
    const sb = make({ 'sun.sun': sun, 'light.p': S('off'), 'light.q': S('off') }, {
      'automation.dusk': { triggers: [{ trigger: 'sun', event: 'sunset', offset: '-00:30:00' }], conditions: [{ condition: 'sun', before: 'sunset' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.p' } }] },
      'automation.night': { triggers: [{ trigger: 'state', entity_id: 'sun.sun', to: 'below_horizon' }], conditions: [{ condition: 'sun', after: 'sunset', before: 'sunrise' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.q' } }] },
    }, { now: at('12:00') });
    await sb.start();
    check('0.11.1 the sun trigger is due at sunset less 30 minutes', sb.pending().some((x) => x.at === at('16:20') && /Sunset/.test(x.label)), sb.pending().map((x) => [new Date(x.at).toISOString(), x.label]));
    await sb.advance(4 * 60 * MIN + 20 * MIN);
    check('0.11.1 ... and fires then; "before sunset" holds at 16:20', st(sb, 'light.p') === 'on' && sb.asks.length === 0, sb.asks);
    await sb.advance(30 * MIN);
    check('0.11.1 at sunset sun.sun goes below the horizon on the sandbox clock', st(sb, 'sun.sun') === 'below_horizon');
    check('0.11.1 ... "after sunset, before sunrise" is one or the other, so it holds in the evening', st(sb, 'light.q') === 'on');
  }

  // ---- 0.11.1 Home Assistant starting, webhooks, tags, calendars and Assist sentences, done by you
  {
    const sb = make({ 'light.a': S('off'), 'light.b': S('off'), 'light.c': S('off'), 'light.d': S('off'), 'light.e': S('off'), 'calendar.bins': S('off') }, {
      'automation.start': { triggers: [{ trigger: 'homeassistant', event: 'start' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.a' } }] },
      'automation.hook': { triggers: [{ trigger: 'webhook', webhook_id: 'garage-x', allowed_methods: ['POST'] }], actions: [{ condition: 'template', value_template: '{{ 1 }}' }, { action: 'light.turn_on', target: { entity_id: 'light.b' } }] },
      'automation.tag': { triggers: [{ trigger: 'tag', tag_id: 'front-door' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.c' } }] },
      'automation.cal': { triggers: [{ trigger: 'calendar', entity_id: 'calendar.bins', event: 'start', offset: '-1:00:00' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.d' } }] },
      'automation.say': { triggers: [{ trigger: 'conversation', command: ['[please] (turn|switch) on the {thing} [light]'] }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.e' } }] },
    });
    await sb.start();
    const ins = sb.inputs();
    check('0.11.1 inputs: Home Assistant start, the webhook, the tag, the calendar and an example sentence',
      JSON.stringify(ins.ha) === '["start"]' && ins.hooks[0].id === 'garage-x' && ins.tags[0] === 'front-door' && ins.cals[0].id === 'calendar.bins' && ins.says[0].v === 'turn on the {thing}', ins);
    await sb.userHA('start');
    await sb.userWebhook('garage-x', { a: 1 }, 'GET');
    check('0.11.1 Home Assistant starting fires its trigger; a webhook called with a method it doesn\'t allow doesn\'t', st(sb, 'light.a') === 'on' && st(sb, 'light.b') === 'off');
    await sb.userWebhook('garage-x', { a: 1 }, 'POST');
    await sb.userTag('front-door');
    await sb.userCalendar('calendar.bins', 'start', 'Bins out');
    check('0.11.1 the webhook, the tag and the calendar event fire theirs', st(sb, 'light.b') === 'on' && st(sb, 'light.c') === 'on' && st(sb, 'light.d') === 'on');
    check('0.11.1 a tag scanned is also Home Assistant\'s tag_scanned event', kinds(sb, 'event').some((e) => e.text === 'tag_scanned'));
    await sb.userSay('turn off the kitchen');
    check('0.11.1 a sentence that doesn\'t match the template doesn\'t fire', st(sb, 'light.e') === 'off');
    await sb.userSay('Please turn on the kitchen light');
    const said = kinds(sb, 'trigger').find((e) => e.key === 'automation.say');
    check('0.11.1 one that matches fires it ([optional], (a|b), {slot})', st(sb, 'light.e') === 'on' && !!said, said);
    await sb.userSay('switch on the hall');
    check('0.11.1 ... the optional words can be left out', kinds(sb, 'trigger').filter((e) => e.key === 'automation.say').length === 2);
  }

  // ---- 0.11.1 inputs: what to set, with the values that matter (thresholds both sides, per-entity triggers, presses)
  {
    const sb = make({ 'sensor.co2': S('760', { device_class: 'carbon_dioxide' }), 'light.l': S('on', { brightness: 120 }), 'event.button': S('2026-11-17T10:00:00Z', { event_types: ['single', 'double'] }), 'timer.t': S('idle'), 'input_number.n': S('3') }, {
      'automation.high': { triggers: [{ trigger: 'air_quality.co2_crossed_threshold', target: { entity_id: 'sensor.co2' }, options: { behavior: 'each', threshold: { type: 'above', value: { active_choice: 'number', number: 1100 } } } }], actions: [] },
      'automation.dim': { triggers: [{ trigger: 'light.brightness_crossed_threshold', target: { entity_id: 'light.l' }, options: { threshold: { type: 'below', value: { number: 50 } } } }], actions: [] },
      'automation.dbl': { triggers: [{ trigger: 'event.received', target: { entity_id: 'event.button' }, options: { event_type: ['double'] } }], actions: [] },
      'automation.n': { triggers: [{ trigger: 'numeric_state', entity_id: 'input_number.n', above: 2.5 }], conditions: [{ condition: 'state', entity_id: 'timer.t', state: 'active' }], actions: [] },
    });
    await sb.start();
    const ins = sb.inputs(), one = (id, attr) => ins.ents.find((x) => x.id === id && x.attr === (attr || null));
    const co2 = one('sensor.co2'), br = one('light.l', 'brightness'), ev = one('event.button'), n = one('input_number.n'), tm = one('timer.t');
    check('0.11.1 CO2 above 1100: 1101 (crosses it) and 1100 (doesn\'t)', !!co2 && co2.vals.map((x) => x.v).join() === '1101,1100', co2);
    check('0.11.1 brightness below 50: the attribute, with 49 and 50', !!br && br.vals.map((x) => x.v).join() === '49,50', br);
    check('0.11.1 an event entity: a press of the type the trigger waits for', !!ev && ev.vals.length === 1 && ev.vals[0].v === lib.SBX_PRESS + 'double', ev);
    check('0.11.1 a decimal threshold steps by its own decimals: above 2.5 → 2.6', !!n && n.vals[0].v === '2.6', n);
    check('0.11.1 a condition\'s entity and state are there too', !!tm && tm.vals.some((x) => x.v === 'active'), tm);
    await sb.userSet('event.button', '2026-11-17T20:00:00.000Z', { event_type: 'double' });
    check('0.11.1 an event entity set with its event type fires event.received', kinds(sb, 'trigger').some((e) => e.key === 'automation.dbl'));
  }

  // ---- 0.11.1 scenes set what they hold; timers say their last transition (Home Assistant's timer triggers read it)
  {
    const sb = make({ 'scene.evening': S('2026-11-16T20:00:00Z', { id: 's1', entity_id: ['light.a', 'light.b'] }), 'light.a': S('off'), 'light.b': S('on'), 'timer.t': S('idle', { duration: '0:05:00' }), 'light.c': S('off') }, {
      'script.go': { sequence: [{ action: 'scene.turn_on', target: { entity_id: 'scene.evening' } }, { action: 'timer.start', target: { entity_id: 'timer.t' } }] },
      'automation.done': { triggers: [{ trigger: 'timer.finished', target: { entity_id: 'timer.t' } }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.c' } }] },
    }, { o: { scene: async (id) => (id === 'scene.evening' ? { entities: { 'light.a': { state: 'on', brightness: 200 }, 'light.b': 'off' } } : null) } });
    await sb.start();
    await sb.userRun('script.go', true, null);
    check('0.11.1 a scene sets what its config holds, with attributes', st(sb, 'light.a') === 'on' && sb.get('light.a').attributes.brightness === 200 && st(sb, 'light.b') === 'off');
    check('0.11.1 ... and its own state becomes the time it was activated', st(sb, 'scene.evening') !== '2026-11-16T20:00:00Z');
    check('0.11.1 a timer started says so in last_transition', sb.get('timer.t').attributes.last_transition === 'started');
    await sb.advance(5 * MIN);
    check('0.11.1 ... finished too, so the timer.finished per-entity trigger fires', sb.get('timer.t').attributes.last_transition === 'finished' && st(sb, 'light.c') === 'on');
  }

  // ---- 0.11.2 variables at each step, step-through and breakpoints
  {
    const sb = make({ 'binary_sensor.door': S('off'), 'light.l': S('off'), 'light.m': S('off') }, {
      'automation.door': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'on', id: 'opened' }], conditions: [{ condition: 'state', entity_id: 'light.l', state: 'off' }],
        actions: [{ variables: { who: 'door' } }, { action: 'light.turn_on', target: { entity_id: 'light.l' } }, { action: 'light.turn_on', target: { entity_id: 'light.m' } }] },
    });
    await sb.start();
    await sb.userSet('binary_sensor.door', 'on');
    const call = sb.log.find((e) => e.kind === 'call' && e.ents.includes('light.l'));
    check('0.11.2 a call keeps the variables of its run: the trigger and what the run set', !!call && !!call.vars && !!call.vars.trigger && call.vars.trigger.id === 'opened' && call.vars.trigger.to_state.state === 'on' && call.vars.who === 'door', call && call.vars);
    check('0.11.2 ... the trigger entry its trigger, the condition its variables', !!kinds(sb, 'trigger')[0].vars.trigger && !!kinds(sb, 'cond')[0].vars, kinds(sb, 'cond'));
    // stepping: the run waits before each condition and action
    const sb2 = make({ 'binary_sensor.door': S('off'), 'light.l': S('off'), 'light.m': S('off') }, {
      'automation.door': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }], conditions: [{ condition: 'state', entity_id: 'light.l', state: 'off' }],
        actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }, { action: 'light.turn_on', target: { entity_id: 'light.m' } }] },
    });
    await sb2.start();
    sb2.stepping = true;
    await sb2.userSet('binary_sensor.door', 'on');
    const pauses = () => sb2.log.filter((e) => e.kind === 'pause');
    check('0.11.2 stepping: the run waits before its condition, nothing done yet', pauses().length === 1 && /condition/.test(pauses()[0].text) && st(sb2, 'light.l') === 'off' && sb2.paused.size === 1, pauses());
    sb2.resume([...sb2.paused.keys()][0]); await sb2.settle();
    check('0.11.2 Step: the condition, then a wait before the first action', pauses().length === 2 && kinds(sb2, 'cond').length === 1 && st(sb2, 'light.l') === 'off');
    sb2.resume([...sb2.paused.keys()][0]); await sb2.settle();
    check('0.11.2 Step: the first light on, waiting before the second', st(sb2, 'light.l') === 'on' && st(sb2, 'light.m') === 'off' && sb2.paused.size === 1);
    sb2.stepping = false; sb2.resumeAll(); await sb2.settle();
    check('0.11.2 Continue: the rest runs', st(sb2, 'light.m') === 'on' && sb2.paused.size === 0 && kinds(sb2, 'run')[0].outcome === 'finished');
    // a breakpoint on one automation stops only it
    const sb3 = make({ 'binary_sensor.door': S('off'), 'light.l': S('off'), 'light.m': S('off') }, {
      'automation.a': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] },
      'automation.b': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.m' } }] },
    });
    await sb3.start();
    sb3.breaks.add('automation.b');
    await sb3.userSet('binary_sensor.door', 'on');
    check('0.11.2 a breakpoint stops its automation only', st(sb3, 'light.l') === 'on' && st(sb3, 'light.m') === 'off' && sb3.paused.size === 1);
    sb3.stopAll(); await sb3.settle();
    check('0.11.2 a paused run stopped lets go of its pause', sb3.paused.size === 0 && kinds(sb3, 'run').some((e) => e.key === 'automation.b' && e.outcome === 'cancelled'), kinds(sb3, 'run'));
  }

  // ---- 0.11.2 how devices answer: slowly (moving first), not at all, unavailable
  {
    const sb = make({ 'binary_sensor.btn': S('off'), 'cover.g': S('closed'), 'lock.f': S('unlocked'), 'light.x': S('off') }, {
      'automation.go': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.btn', to: 'on' }], actions: [{ action: 'cover.open_cover', target: { entity_id: 'cover.g' } }, { action: 'lock.lock', target: { entity_id: 'lock.f' } }, { action: 'light.turn_on', target: { entity_id: 'light.x' } }] },
    });
    await sb.start();
    sb.setBehave('cover.g', 'slow', 15000); sb.setBehave('lock.f', 'fails'); sb.setBehave('light.x', 'unavailable');
    await sb.userSet('binary_sensor.btn', 'on');
    check('0.11.2 a slow cover is opening first', st(sb, 'cover.g') === 'opening' && sb.pending().some((x) => /answers/.test(x.label)));
    check('0.11.2 a lock that fails jams, and the timeline says so', st(sb, 'lock.f') === 'jammed' && sb.log.some((e) => e.kind === 'note' && e.warn && /didn't answer/.test(e.text)));
    check('0.11.2 a light set to go unavailable does', st(sb, 'light.x') === 'unavailable');
    await sb.advance(15000);
    check('0.11.2 ... and the cover is open 15 s later', st(sb, 'cover.g') === 'open');
    check('0.11.2 checks keep how a device answers', JSON.stringify(lib.cleanCheck({ id: 'x', at: 1, steps: [{ op: 'behave', id: 'cover.g', how: 'slow', ms: 15000 }, { op: 'behave', id: 'cover.g', how: 'weird' }], expect: [{ k: 'state', id: 'cover.g', state: 'open' }] }).steps) === '[{"op":"behave","id":"cover.g","how":"slow","ms":15000}]');
  }

  // ---- 0.11.2 coverage and the explorer
  {
    const items = {
      'automation.door': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }, { trigger: 'time', at: '23:00:00' }],
        actions: [{ choose: [{ conditions: [{ condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }], sequence: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] }], default: [{ action: 'light.turn_off', target: { entity_id: 'light.l' } }] }] },
      'automation.fight': { triggers: [{ trigger: 'state', entity_id: 'light.l', to: 'on' }], actions: [{ action: 'light.turn_off', target: { entity_id: 'light.l' } }] },
      'automation.never': { triggers: [{ trigger: 'state', entity_id: 'input_boolean.x', to: 'on' }], conditions: [{ condition: 'state', entity_id: 'input_boolean.y', state: 'on' }], actions: [] },
      'automation.unknown': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.btn', to: 'on' }], actions: [{ action: 'vacuum.weird_thing', target: { entity_id: 'vacuum.v' } }] },
    };
    const states = { 'binary_sensor.door': S('off'), 'binary_sensor.btn': S('off'), 'light.l': S('off'), 'sun.sun': S('below_horizon'), 'input_boolean.x': S('off'), 'input_boolean.y': S('off'), 'vacuum.v': S('docked') };
    const sb = make(states, items);
    await sb.start();
    await sb.userSet('binary_sensor.door', 'on');
    const cov = lib.sbxCoverage([sb], Object.entries(items).map(([id, cfg]) => ({ id, cfg: sb.items.get(id).cfg })), (k) => k);
    const at = (id, path) => cov.find((x) => x.id === id && x.path === path) || {};
    check('0.11.2 coverage: the door trigger fired, the 23:00 one didn\'t', at('automation.door', 't/0').hit === true && at('automation.door', 't/1').hit === false, cov.filter((x) => x.id === 'automation.door'));
    check('0.11.2 ... the choose option taken, its condition seen true only, the default not taken', at('automation.door', 'a/0/choose/0').hit === true && at('automation.door', 'a/0/choose/0/if/0').t === true && at('automation.door', 'a/0/choose/0/if/0').f === false && at('automation.door', 'a/0/default').hit === false);
    // the explorer: each thing on its own, from the same start
    const mk = () => make(states, items);
    const ex = await lib.sbxExplore(mk, {});
    const fl = (k) => ex.flags.filter((x) => x.kind === k);
    check('0.11.2 explorer: a day passing is tried, and each value Set offers', ex.runs[0].what === 'A day passes, nothing else done' && ex.runs.some((r) => r.step.op === 'set' && r.step.id === 'binary_sensor.door' && r.step.state === 'on'), ex.runs.map((r) => r.what));
    check('0.11.2 ... the 23:00 trigger is reached by the day passing', ex.runs[0].started.includes('automation.door'), ex.runs[0]);
    check('0.11.2 ... an automation that turns off what another turns on is a fight over the light', fl('fight').some((x) => x.id === 'light.l'), ex.flags);
    check('0.11.2 ... one whose condition is never true is found, and so is a call it can\'t model', fl('cond_false').some((x) => x.id === 'automation.never') && fl('unknown').some((x) => x.svc === 'vacuum.weird_thing'), ex.flags);
    check('0.11.2 ... nothing claims "never started" for one that a value starts', !fl('never').some((x) => x.id === 'automation.never'), fl('never'));
  }

  // ---- 0.11.2 Home Assistant's order and what it refuses (each found by the differential test, tests/diff)
  {
    const sw = (id, to) => ({ trigger: 'state', entity_id: id, to });
    const on = (id) => ({ action: 'input_boolean.turn_on', target: { entity_id: id } });
    const inc = { action: 'counter.increment', target: { entity_id: 'counter.c' } };
    const base = () => ({ 'binary_sensor.a': S('off'), 'binary_sensor.b': S('off'), 'input_boolean.x': S('off'), 'input_boolean.y': S('off'), 'counter.c': S('0'), 'timer.t': S('idle'), 'input_number.n': S('10', { min: 0, max: 100 }), 'input_select.s': S('low', { options: ['low', 'high'] }) });
    // queued, max 2: one running and one waiting; the rest dropped
    let sb = make(base(), { 'automation.q': { mode: 'queued', max: 2, triggers: [{ trigger: 'state', entity_id: 'binary_sensor.a' }], actions: [inc, { delay: { seconds: 30 } }] } });
    await sb.start();
    for (const v of ['on', 'off', 'on', 'off']) await sb.userSet('binary_sensor.a', v);
    await sb.advance(120e3);
    check('0.11.2 queued with max 2 runs twice for four triggers (the queued one counts)', st(sb, 'counter.c') === '2', st(sb, 'counter.c'));
    // a paused timer started again goes on from where it was
    sb = make(base(), { 'automation.t': { triggers: [sw('binary_sensor.a', 'on')], actions: [{ action: 'timer.start', target: { entity_id: 'timer.t' }, data: { duration: '00:01:00' } }] },
      'automation.p': { triggers: [sw('binary_sensor.b', 'on')], actions: [{ action: 'timer.pause', target: { entity_id: 'timer.t' } }] },
      'automation.go': { triggers: [sw('binary_sensor.b', 'off')], actions: [{ action: 'timer.start', target: { entity_id: 'timer.t' } }] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on'); await sb.advance(20e3); await sb.userSet('binary_sensor.b', 'on');
    const left = (sb.get('timer.t').attributes || {}).remaining;
    await sb.advance(300e3); await sb.userSet('binary_sensor.b', 'off'); await sb.advance(39e3);
    const still = st(sb, 'timer.t');
    await sb.advance(2e3);
    check('0.11.2 a paused timer keeps what was left as Home Assistant writes it, and goes on from there', left === '0:00:40' && still === 'active' && st(sb, 'timer.t') === 'idle', [left, still, st(sb, 'timer.t')]);
    // what Home Assistant refuses stops the run
    sb = make(base(), { 'automation.n': { triggers: [sw('binary_sensor.a', 'on')], actions: [{ action: 'input_number.set_value', target: { entity_id: 'input_number.n' }, data: { value: 150 }, continue_on_error: true }, on('input_boolean.x')] },
      'automation.s': { triggers: [sw('binary_sensor.b', 'on')], actions: [{ action: 'input_select.select_option', target: { entity_id: 'input_select.s' }, data: { option: 'medium' }, continue_on_error: true }, on('input_boolean.y')] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on');
    const run = sb.log.find((e) => e.kind === 'run' && e.key === 'automation.n');
    check('0.11.2 a number set past its range is refused: the run stops there, even with continue_on_error', st(sb, 'input_number.n') === '10' && st(sb, 'input_boolean.x') === 'off' && run && run.outcome === 'error' && /goes from 0 to 100/.test(run.why), run);
    await sb.userSet('binary_sensor.b', 'on');
    check('0.11.2 ... an option a select doesn\'t have is refused too, and continue_on_error carries on from that one', st(sb, 'input_select.s') === 'low' && st(sb, 'input_boolean.y') === 'on');
    // conditions before the mode
    sb = make(base(), { 'automation.r': { mode: 'restart', triggers: [{ trigger: 'state', entity_id: 'binary_sensor.a' }], conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], actions: [{ delay: { seconds: 30 } }, on('input_boolean.x')] } });
    await sb.start();
    await sb.userSet('binary_sensor.b', 'on'); await sb.userSet('binary_sensor.a', 'on'); await sb.advance(10e3);
    await sb.userSet('binary_sensor.b', 'off'); await sb.userSet('binary_sensor.a', 'off'); await sb.advance(25e3);
    check('0.11.2 restart: a trigger whose conditions fail restarts nothing (conditions come before the mode)', st(sb, 'input_boolean.x') === 'on');
    sb = make(base(), { 'automation.q': { mode: 'queued', triggers: [{ trigger: 'state', entity_id: 'binary_sensor.a' }], conditions: [{ condition: 'state', entity_id: 'binary_sensor.b', state: 'on' }], actions: [{ delay: { seconds: 20 } }, inc] } });
    await sb.start();
    await sb.userSet('binary_sensor.b', 'on'); await sb.userSet('binary_sensor.a', 'on'); await sb.userSet('binary_sensor.a', 'off'); await sb.userSet('binary_sensor.b', 'off');
    await sb.advance(60e3);
    check('0.11.2 queued: a waiting run keeps what its conditions said when it was triggered', st(sb, 'counter.c') === '2', st(sb, 'counter.c'));
    // triggers take turns
    sb = make(base(), { 'automation.two': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.a', to: null }, { trigger: 'state', entity_id: 'binary_sensor.a', from: 'off', to: 'on' }], actions: [{ action: 'input_boolean.toggle', target: { entity_id: 'input_boolean.x' } }] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on');
    check('0.11.2 two triggers on one change both run (single mode: the first has ended by the second\'s turn)', st(sb, 'input_boolean.x') === 'off' && kinds(sb, 'run').length === 2, kinds(sb, 'run'));
    sb = make(base(), { 'automation.self': { triggers: [sw('binary_sensor.a', 'on'), sw('input_boolean.x', 'on')], actions: [on('input_boolean.x'), inc] },
      'automation.slow': { triggers: [sw('binary_sensor.b', 'on'), sw('input_boolean.y', 'on')], actions: [on('input_boolean.y'), { delay: { seconds: 5 } }, inc] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on');
    check('0.11.2 an automation that starts itself runs again: the change waits until the run that made it has ended', st(sb, 'counter.c') === '2', st(sb, 'counter.c'));
    await sb.userSet('binary_sensor.b', 'on'); await sb.advance(10e3);
    check('0.11.2 ... but single mode drops it while its run waits', st(sb, 'counter.c') === '3' && sb.log.some((e) => e.kind === 'note' && e.key === 'automation.slow'), st(sb, 'counter.c'));
    sb = make(base(), { 'automation.later': { triggers: [sw('binary_sensor.a', 'on'), sw('input_boolean.x', 'on')], actions: [{ delay: { seconds: 5 } }, on('input_boolean.x'), inc] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on'); await sb.advance(7e3);
    const once = st(sb, 'counter.c');
    await sb.advance(7e3);
    check('0.11.2 ... but after a delay its change is handed out at once, with the run still going: single mode drops it', once === '1' && st(sb, 'counter.c') === '1' && sb.log.some((e) => e.kind === 'note' && e.key === 'automation.later'), [once, st(sb, 'counter.c')]);
    sb = make(base(), { 'automation.w': { triggers: [sw('binary_sensor.a', 'on')], actions: [{ wait_for_trigger: [sw('input_boolean.x', 'on')] }, on('input_boolean.y')] },
      'automation.b': { triggers: [sw('binary_sensor.b', 'on')], actions: [on('input_boolean.x'), { action: 'counter.increment', target: { entity_id: 'counter.d' } }] },
      'automation.d': { triggers: [{ trigger: 'state', entity_id: 'counter.d' }], conditions: [{ condition: 'state', entity_id: 'input_boolean.y', state: 'off' }], actions: [inc] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on'); await sb.userSet('binary_sensor.b', 'on');
    check('0.11.2 a wait a change satisfies goes on once that change and the ones queued behind it are handed out', st(sb, 'counter.c') === '1' && st(sb, 'input_boolean.y') === 'on', [st(sb, 'counter.c'), st(sb, 'input_boolean.y')]);
    // ... and while a long run started by that change goes on, the waiting run is still waiting: a queued change that
    // triggers its automation again finds it running
    sb = make(Object.assign(base(), { 'input_boolean.q': S('off'), 'input_boolean.z': S('off'), 'counter.k': S('0') }), {
      'automation.w': { triggers: [sw('binary_sensor.a', 'on'), sw('input_boolean.z', 'on')], actions: [{ action: 'counter.increment', target: { entity_id: 'counter.k' } }, { wait_for_trigger: [sw('input_boolean.x', 'on')] }, inc] },
      'automation.b': { triggers: [sw('binary_sensor.b', 'on')], actions: [on('input_boolean.x')] },
      'automation.r': { triggers: [sw('input_boolean.x', 'on')], actions: [{ repeat: { count: 20, sequence: [{ action: 'input_boolean.toggle', target: { entity_id: 'input_boolean.q' } }] } }, on('input_boolean.z')] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on'); await sb.userSet('binary_sensor.b', 'on');
    check('0.11.2 ... a waiting run is still running until the handing out is done (single mode drops the next)', st(sb, 'counter.k') === '1' && st(sb, 'counter.c') === '1', [st(sb, 'counter.k'), st(sb, 'counter.c')]);
    sb = make(base(), { 'automation.hear': { triggers: [{ trigger: 'state', entity_id: 'binary_sensor.b' }], actions: [{ wait_for_trigger: [sw('binary_sensor.b', 'on')], timeout: { seconds: 10 }, continue_on_timeout: false }, on('input_boolean.x')] } });
    await sb.start();
    await sb.userSet('binary_sensor.b', 'on'); await sb.advance(15e3);
    check('0.11.2 a run doesn\'t hear the change that started it in its own wait (only the waits already listening do)', st(sb, 'input_boolean.x') === 'off');
    // automation.trigger runs it inside the call
    sb = make(base(), { 'automation.a': { triggers: [sw('binary_sensor.a', 'on')], actions: [{ action: 'automation.trigger', target: { entity_id: 'automation.b' } }, on('input_boolean.y')] },
      'automation.b': { triggers: [], actions: [{ delay: { seconds: 10 } }, on('input_boolean.x')] } });
    await sb.start();
    await sb.userSet('binary_sensor.a', 'on'); await sb.advance(5e3);
    const mid = st(sb, 'input_boolean.y');
    await sb.advance(10e3);
    check('0.11.2 automation.trigger waits for the run it starts', mid === 'off' && st(sb, 'input_boolean.x') === 'on' && st(sb, 'input_boolean.y') === 'on', mid);
  }

  // ---- 0.11.2 helpers that follow what they read (Home Assistant's rules for min/max, threshold, group; a template)
  {
    const { sbxFollow, pyRound } = lib;
    const S2 = (x) => ({ state: x, attributes: {} });
    const home = { 'sensor.a': S2('2'), 'sensor.b': S2('3'), 'sensor.c': S2('unknown') }, get = (id) => home[id];
    const mm = (type, round) => ({ kind: 'min_max', type, round, entities: ['sensor.a', 'sensor.b', 'sensor.c'] });
    const got = (r) => sbxFollow(r, get, {}, null)[0];
    check('0.11.2 min/max: min, max, mean, median (2.5 to even is 2), sum (unknown makes it unknown), range, last', got(mm('min', 2)) === '2.0' && got(mm('max', 2)) === '3.0' && got(mm('mean', 2)) === '2.5' && got(mm('median', 0)) === '2.0' && got(mm('sum', 1)) === 'unknown' && got(mm('range', 2)) === '1.0' && got(mm('last', 2)) === '3.0',
      ['min', 'max', 'mean', 'median', 'sum', 'range', 'last'].map((t) => got(mm(t, t === 'median' ? 0 : 2))));
    const mem = {};
    sbxFollow(mm('mean', 2), get, mem, null);
    home['sensor.a'] = S2('abc');
    check('0.11.2 ... a state that isn\'t a number leaves what it held (as Home Assistant\'s min/max does)', sbxFollow(mm('mean', 2), get, mem, 'sensor.a')[0] === '2.5');
    home['sensor.a'] = S2('unavailable');
    check('0.11.2 ... unavailable leaves it out', sbxFollow(mm('mean', 2), get, mem, 'sensor.a')[0] === '3.0');
    check('0.11.2 Python\'s round: the float\'s exact value, ties to even', pyRound(4.45, 1) === 4.5 && pyRound(2.675, 2) === 2.67 && pyRound(2.5, 0) === 2 && pyRound(0.125, 2) === 0.12 && pyRound(-2.5, 0) === -2);
    const thr = { kind: 'threshold', entity: 'sensor.t', lower: null, upper: 25, hysteresis: 1 }, tm = {}, side = (v) => sbxFollow(thr, () => S2(v), tm, 'sensor.t')[0];
    check('0.11.2 threshold: over the limit plus the hysteresis to turn on, under it minus the hysteresis to turn off', [side('20'), side('25.5'), side('26.5'), side('25'), side('23.9'), side('x')].join() === 'off,off,on,on,off,unknown');
    const grp = (all, a, b) => sbxFollow({ kind: 'group', entities: ['d.1', 'd.2'], all }, (id) => S2(id === 'd.1' ? a : b), {}, null)[0];
    check('0.11.2 group: any or all on; unknown if none (or not all) is known; unavailable only when all are', grp(false, 'on', 'off') === 'on' && grp(true, 'on', 'off') === 'off' && grp(false, 'unknown', 'unavailable') === 'unknown' && grp(true, 'on', 'unknown') === 'unknown' && grp(false, 'unavailable', 'unavailable') === 'unavailable');
    // the engine: a helper follows its input before the automations hear the change
    const sb = make({ 'sensor.t1': S('20'), 'sensor.t2': S('24'), 'sensor.avg': S('22'), 'input_boolean.x': S('off'), 'binary_sensor.door': S('off'), 'sensor.status': S('closed') }, {
      'automation.a': { triggers: [{ trigger: 'state', entity_id: 'sensor.t1' }], conditions: [{ condition: 'numeric_state', entity_id: 'sensor.avg', above: 24.5 }], actions: [{ action: 'input_boolean.turn_on', target: { entity_id: 'input_boolean.x' } }] },
    }, { o: {
      derived: { 'sensor.avg': { rule: { kind: 'min_max', type: 'mean', round: 2, entities: ['sensor.t1', 'sensor.t2'] }, reads: [] }, 'sensor.status': { rule: { kind: 'template', state: "{{ 'open' if is_state('binary_sensor.door', 'on') else 'closed' }}" }, reads: ['binary_sensor.door'] } },
      tpl: async (t) => (/is_state\('binary_sensor.door', 'on'\)/.test(t) ? { ok: true, value: sb.get('binary_sensor.door').state === 'on' ? 'open' : 'closed' } : { ok: false, err: 'stub' }),
    } });
    await sb.start();
    check('0.11.2 the sandbox says which helpers follow what they read', sb.log.some((e) => e.kind === 'note' && /follow what they read/.test(e.text) && /sensor.avg/.test(e.text)));
    await sb.userSet('sensor.t1', '26');
    const row = sb.log.find((e) => e.kind === 'state' && e.key === 'sensor.avg');
    check('0.11.2 a min/max follows its input, and an automation\'s condition on it sees it changed', st(sb, 'sensor.avg') === '25.0' && st(sb, 'input_boolean.x') === 'on' && row && row.follows === 'sensor.t1', [st(sb, 'sensor.avg'), st(sb, 'input_boolean.x')]);
    await sb.userSet('binary_sensor.door', 'on');
    check('0.11.2 a template helper is rendered again when what it reads changes', st(sb, 'sensor.status') === 'open');
  }

})().catch((e) => check('the sandbox tests ran to the end', false, String(e && e.stack || e)));
