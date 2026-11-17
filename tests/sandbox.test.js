// The sandbox engine (Phase 10), without a browser or Home Assistant. Run: node tests/sandbox.test.js
// Templates go to a stand-in for Home Assistant's renderer that knows a few forms and reads the sandbox's states;
// tests/e2e/sandbox.test.js renders them with the real Home Assistant.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'custom_components', 'functions_board', 'frontend', 'functions-board.js'), 'utf8');
const start = src.indexOf("'use strict';"), end = src.indexOf('  class FunctionsBoard extends HTMLElement');
const lib = new Function('customElements', 'window', src.slice(start, end) + '\nreturn { Sandbox, sbxRewrite, SBX_PRELUDE, durMs, asBool, localAt, tzParts, sbxEffect };')({ get: () => undefined }, {});
const { Sandbox, sbxRewrite, durMs, localAt, sbxEffect } = lib;

let failed = 0, total = 0;
const check = (name, ok, detail) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -- ' + JSON.stringify(detail)));
};
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
    check('garage: the notification is a call the sandbox can\'t follow, marked so', calls.some((c) => c.svc === 'notify.mobile_app_phone' && c.unknown), calls.map((c) => [c.svc, !!c.unknown]));
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

  // ---- a template it can't render: asked
  {
    const sb = make({ 'light.l': S('off') }, { 'automation.t': { triggers: [{ trigger: 'event', event_type: 'go' }], conditions: ["{{ (expand('group.x') | list | count) > 2 }}"], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.l' } }] } }, { answer: false });
    await sb.start();
    await sb.userEvent('go');
    check('a template the renderer refused: asked, and "false" stops the run', sb.asks.length === 1 && st(sb, 'light.l') === 'off');
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
  check('rewrite: what still reads Home Assistant is reported', R('{{ states | selectattr("state", "eq", "on") | list }}').leftovers.includes('states') && R("{{ closest('zone.home') }}").leftovers.includes('closest'));
  check('rewrite: names ending in states or now aren\'t touched', R('{{ my_states(1) }} {{ x.now() }} {{ snow(2) }}').text === '{{ my_states(1) }} {{ x.now() }} {{ snow(2) }}');

  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
