// The import's grouping (findFunctions, 0.11.0): which pieces are one part, and the ties a person may merge parts
// by. Each block is a small invented home showing one rule. Run: node --test tests/import.test.js
const { findFunctions, nrGroups } = require('./lib/board-lib');
const { check } = require('./lib/check');

// a home: id → { name, cat, tab (Node-RED), T: trigger refs, C: checked, A: changed, X: run }; dev: entity → device
function home(spec, dev = {}) {
  const roles = new Map();
  for (const [id, it] of Object.entries(spec)) {
    if (!/^(automation|script|nr)[.:]/.test(id)) continue;
    const m = new Map(), put = (r, role) => (m.get(r) || m.set(r, new Set()).get(r)).add(role);
    (it.T || []).forEach((r) => put(r, 'trigger')); (it.C || []).forEach((r) => put(r, 'condition'));
    (it.A || []).forEach((r) => put(r, 'action')); (it.X || []).forEach((r) => put(r, 'call'));
    roles.set(id, m);
  }
  const info = {
    kind: (id) => (id.startsWith('nr:') ? 'nodered' : id.startsWith('automation.') ? 'automation' : id.startsWith('script.') ? 'script'
      : id.startsWith('scene.') ? 'scene' : /^(input_[a-z]+|counter|timer|schedule)\./.test(id) ? 'helper' : null),
    name: (id) => (spec[id] && (spec[id].name || spec[id].tab)) || id.split('.').pop().replace(/_/g, ' '),
    cat: (id) => (spec[id] && spec[id].cat) || '',
    tab: (id) => (spec[id] && spec[id].tab) || '',
    // as the board's _sourceOf: a device's buttons, an actuator's own state, the device; nothing for people, phones…
    source: (ref) => {
      const d = dev[ref];
      if (!d || /^(person|zone|sun|media_player|notify)\./.test(ref)) return null;
      if (ref.startsWith('event.')) return 'buttons:' + d;
      return /^(light|switch|fan)\./.test(ref) ? ref : 'dev:' + d;
    },
  };
  const r = findFunctions(roles, info);
  r.of = (id) => r.parts.findIndex((p) => p.includes(id));
  r.together = (...ids) => ids.every((id) => r.of(id) >= 0 && r.of(id) === r.of(ids[0]));
  r.tie = (x, y) => r.ties.find((t) => t.a === Math.min(r.of(x), r.of(y)) && t.b === Math.max(r.of(x), r.of(y)));
  return r;
}
const show = (r) => ({ parts: r.parts, ties: r.ties });

// ---- helpers and scripts link what uses them; a busy one is a hub; a helper only checked joins its one part ----
{
  const spec = {
    'automation.pump_start': { name: 'Pump timer start', T: ['binary_sensor.pump_running'], C: ['input_number.pump_minutes'], A: ['timer.pump_run'] },
    'automation.pump_done': { name: 'Pump timer done', T: ['timer.pump_run'], X: ['script.tell_everyone'] },
    'script.tell_everyone': { name: 'Tell everyone', A: ['notify.phone'] },
  };
  ['Frost', 'Leak', 'Smoke', 'Rain', 'Wind', 'Heat', 'Hail'].forEach((w) => { spec['automation.' + w.toLowerCase()] = { name: w + ' warning', T: ['sensor.' + w.toLowerCase()], C: ['input_boolean.guests'], X: ['script.tell_everyone'] }; });
  const r = home(spec);
  check('F1 a timer one automation starts and another ends joins them (and the helper only it checks)', r.together('automation.pump_start', 'automation.pump_done', 'timer.pump_run', 'input_number.pump_minutes'), show(r));
  check('F1 a script eight automations run is a hub: it joins nothing, and they stay apart', r.of('script.tell_everyone') < 0 && r.of('automation.frost') < 0 && r.of('automation.leak') < 0, show(r));
  check('F1 a mode flag many check pulls nothing together', r.of('input_boolean.guests') < 0, show(r));
}

// ---- name fences: a helper shared by systems named apart joins its own side; the others are tied ----
{
  const r = home({
    'automation.mail_open': { name: 'Mailbox opened', T: ['binary_sensor.mail_door'], A: ['input_boolean.sink_light_mail'] },
    'automation.mail_flap': { name: 'Mailbox emptied', T: ['binary_sensor.mail_flap'], A: ['input_boolean.sink_light_mail'] },
    'automation.sink_render': { name: 'Sink light: show the registers', T: ['input_boolean.sink_light_mail', 'input_boolean.sink_light_plants'], X: ['script.sink_light_apply'] },
    'script.sink_light_apply': { name: 'Sink light: apply', C: ['input_boolean.sink_light_mail', 'input_boolean.sink_light_plants'], A: ['svc:mqtt.publish'] },
    'automation.plants_dry': { name: 'Plants: soil dry', T: ['sensor.soil'], A: ['input_boolean.sink_light_plants', 'counter.plant_days'] },
    'automation.plants_count': { name: 'Plants: count the days', A: ['counter.plant_days'] },
  });
  check('F2 the display keeps its registers', r.together('automation.sink_render', 'script.sink_light_apply', 'input_boolean.sink_light_mail', 'input_boolean.sink_light_plants'), show(r));
  check('F2 the systems that set them are parts of their own', r.together('automation.mail_open', 'automation.mail_flap') && r.together('automation.plants_dry', 'automation.plants_count')
    && r.of('automation.mail_open') !== r.of('automation.sink_render') && r.of('automation.plants_dry') !== r.of('automation.sink_render'), show(r));
  const t1 = r.tie('automation.mail_open', 'automation.sink_render'), t2 = r.tie('automation.plants_dry', 'automation.sink_render');
  check('F2 each is tied to the display: it uses one of its helpers', t1 && t1.why === 'uses' && t1.via === 'input_boolean.sink_light_mail' && t2 && t2.why === 'uses', show(r));
}

// ---- category fences: the side filed with the helper; scenes link like helpers ----
{
  const r = home({
    'automation.heat_on': { name: 'Heat on', cat: 'climate', T: ['sensor.temp'], A: ['input_boolean.heating'] },
    'automation.heat_off': { name: 'Heat off', cat: 'climate', T: ['sensor.temp2'], A: ['input_boolean.heating'] },
    'input_boolean.heating': { cat: 'climate' },
    'automation.lamp_glow': { name: 'Lamp glow when heating', cat: 'lighting', T: ['input_boolean.heating'], A: ['light.lamp'] },
    'automation.lamp_dim': { name: 'Lamp dim at night', cat: 'lighting', T: ['sun.sun'], A: ['light.lamp'] },
    'automation.projector': { name: 'Projector on', T: ['media_player.tv'], A: ['scene.movie'] },
    'automation.popcorn': { name: 'Popcorn time', T: ['input_button.snack'], A: ['scene.movie'] },
  });
  check('F3 a helper links only the side filed under its category', r.together('automation.heat_on', 'automation.heat_off', 'input_boolean.heating') && r.of('automation.lamp_glow') !== r.of('automation.heat_on'), show(r));
  const t = r.tie('automation.lamp_glow', 'automation.heat_on');
  check('F3 ... and the other side is tied to it', t && t.why === 'uses', show(r));
  check('F3 two automations that turn on one scene are one part', r.together('automation.projector', 'automation.popcorn', 'scene.movie'), show(r));
}

// ---- an automation that switches others: joins them when that's what it's for; else a tie; a mode, nothing ----
{
  const spec = {
    'automation.alert_gate': { name: 'Gate open alert', T: ['binary_sensor.gate'], A: ['notify.phone'] },
    'automation.alert_shed': { name: 'Shed door alert', T: ['binary_sensor.shed'], A: ['notify.phone'] },
    'automation.night_off': { name: 'Night alerts off', T: ['sensor.clock'], A: ['automation.alert_gate', 'automation.alert_shed'] },
    'automation.bed_button': { name: 'Bed button', T: ['event.bed_button'], A: ['scene.sleep', 'lock.front', 'light.hall', 'automation.alert_gate', 'automation.alert_shed'], X: ['script.bed_story'] },
    'script.bed_story': { name: 'Bed story', A: ['media_player.kid'] },
    'automation.away': { name: 'Away mode', T: ['input_boolean.away'], A: [] },
  };
  ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'].forEach((w, i) => {
    spec['automation.' + w.toLowerCase()] = { name: w + ' lights', T: ['sensor.s' + i], A: ['light.l' + i] };
    spec['automation.away'].A.push('automation.' + w.toLowerCase());
  });
  const r = home(spec);
  check('F4 one that does nothing but switch two alerts joins them', r.together('automation.night_off', 'automation.alert_gate', 'automation.alert_shed'), show(r));
  const t = r.tie('automation.bed_button', 'automation.alert_gate');
  check('F4 one that also does much else stays in its own part, tied to them', r.together('automation.bed_button', 'script.bed_story') && r.of('automation.bed_button') !== r.of('automation.alert_gate')
    && t && t.why === 'switches' && t.by === 'automation.bed_button', show(r));
  check('F4 one that switches eight is a mode: it joins none of them, and ties nothing', r.of('automation.alpha') < 0 && r.of('automation.away') !== r.of('automation.alpha')
    && !r.ties.some((t) => t.by === 'automation.away'), show(r));
}

// ---- Node-RED: a flow links the pieces it uses; a tab's groups are one flow, tabs named alike one system ----
{
  const r = home({
    'nr:g1': { tab: 'Pond pump', T: ['binary_sensor.pond_level'], X: ['script.pond_fill_on', 'script.pond_fill_off'] },
    'nr:g2': { tab: 'Pond pump', T: ['sensor.time'], C: ['input_datetime.pond_hours'] },
    'nr:g3': { tab: 'Pond lights', T: ['input_datetime.pond_dusk'], A: ['light.pond'] },
    'script.pond_fill_on': { name: 'Pond fill on', A: ['switch.pond_valve'] },
    'script.pond_fill_off': { name: 'Pond fill off', A: ['switch.pond_valve'] },
    'nr:g9': { tab: 'Solo', X: ['script.solo'] },
    'script.solo': { name: 'Solo', A: ['light.solo'] },
    'nr:g4': { tab: 'Gate flows', T: ['binary_sensor.gate2'], C: ['timer.gate_quiet'], X: ['script.gate_chime', 'script.gate_tune'] },
    'script.gate_chime': { name: 'Gate chime', A: ['media_player.hall'] },
    'script.gate_tune': { name: 'Gate tune', A: ['media_player.hall'] },
    'automation.quiet_start': { name: 'Quiet start', T: ['binary_sensor.nursery'], A: ['timer.gate_quiet'] },
    'automation.quiet_end': { name: 'Quiet end', T: ['timer.gate_quiet'], A: ['light.nursery'] },
  });
  check('F5 the scripts a flow runs are one part with it, and its tab\'s other group, and a tab named like it',
    r.together('nr:g1', 'nr:g2', 'nr:g3', 'script.pond_fill_on', 'script.pond_fill_off', 'input_datetime.pond_dusk', 'input_datetime.pond_hours'), show(r));
  check('F5 a flow with one piece it uses is no part', r.of('script.solo') < 0 && r.of('nr:g9') < 0, show(r));
  const t = r.tie('nr:g4', 'automation.quiet_start');
  check('F5 a flow that checks another part\'s timer is tied to it', t && t.why === 'reads' && t.by === 'nr:g4' && t.via === 'timer.gate_quiet', show(r));
}

// ---- the same source: a device, an actuator, a switch's buttons; changers join; two parts meeting stay apart ----
{
  const dev = { 'binary_sensor.door_contact': 'door', 'binary_sensor.door_obstruction': 'door', 'cover.big_door': 'door', 'event.hall_up': 'hall', 'event.hall_down': 'hall',
    'binary_sensor.drive_beam': 'beam', 'switch.pond_valve': 'valve' };
  const r = home({
    // the switch's taps come first: the device rule must still go before the taps pair up
    'automation.lamp_tap': { name: 'Lamp from the switch', T: ['event.hall_up'], A: ['light.lamp'] },
    'automation.fan_tap': { name: 'Fan from the switch', T: ['event.hall_down'], A: ['fan.ceiling'] },
    'automation.tap_open': { name: 'Up twice opens', T: ['event.hall_up'], A: ['cover.big_door'] },
    'automation.opened': { name: 'Opened notice', T: ['binary_sensor.door_contact'], A: ['notify.phone'] },
    'automation.blocked': { name: 'Blocked notice', T: ['binary_sensor.door_obstruction'], A: ['notify.phone'] },
    'automation.pulse': { name: 'Moving light pulse', T: ['cover.big_door'], A: ['light.porch'] },
    'automation.chime_beam': { name: 'Chime when beam', T: ['binary_sensor.drive_beam'], A: ['timer.chime_quiet'] },
    'automation.chime_over': { name: 'Chime quiet over', T: ['timer.chime_quiet'], A: ['light.x'] },
    'automation.yard_flood': { name: 'Yard flood on beam', T: ['binary_sensor.drive_beam'], A: ['scene.yard_bright'] },
    'automation.yard_off': { name: 'Yard flood off', T: ['sensor.dawn'], A: ['scene.yard_bright'] },
    'automation.yard_log': { name: 'Yard log the beam', T: ['binary_sensor.drive_beam'], A: ['logbook.log'] },
    'script.fill': { name: 'Fill the pond', A: ['switch.pond_valve', 'counter.fills'] },
    'automation.fill_daily': { name: 'Fill daily', T: ['sensor.clock'], X: ['script.fill'] },
    'automation.valve_watch': { name: 'Valve watch', T: ['switch.pond_valve'], A: ['counter.valve_runs'] },
    'automation.valve_count': { name: 'Runs counted', T: ['counter.valve_runs'], A: ['notify.phone'] },
  }, dev);
  check('F6 automations that start from one device are one part, with the tap that operates it', r.together('automation.opened', 'automation.blocked', 'automation.pulse', 'automation.tap_open'), show(r));
  check('F6 a switch\'s other taps pair up; the tap already grouped stays', r.together('automation.lamp_tap', 'automation.fan_tap') && r.of('automation.lamp_tap') !== r.of('automation.tap_open'), show(r));
  const t = r.tie('automation.chime_beam', 'automation.yard_flood');
  check('F6 two parts that start from one device stay apart, tied', r.of('automation.chime_beam') !== r.of('automation.yard_flood') && t && t.why === 'device' && t.via === 'binary_sensor.drive_beam', show(r));
  check('F6 ... and a piece on its own goes to the part named like it', r.together('automation.yard_log', 'automation.yard_flood'), show(r));
  const s = r.tie('script.fill', 'automation.valve_watch');
  check('F6 a script that changes what another part starts from: a tie', s && s.why === 'starts' && s.by === 'script.fill' && s.via === 'switch.pond_valve', show(r));
}

// ---- a device more than twelve automations start from is a hub: it joins and ties nothing ----
{
  const dev = {}, spec = {};
  ['Dryer', 'Freezer', 'Oven', 'Kettle', 'Heater', 'Pump', 'Fridge', 'Router', 'Printer', 'Sauna', 'Kiln', 'Washer', 'Boiler'].forEach((w, i) => {
    dev['sensor.meter_circuit_' + i] = 'meter';
    spec['automation.c' + i] = { name: w + ' power watch', T: ['sensor.meter_circuit_' + i], A: ['notify.phone'] };
  });
  spec['automation.meter_reset'] = { name: 'Monthly totals', T: ['sensor.clock'], A: ['sensor.meter_circuit_0'] };
  const r = home(spec, dev);
  check('F11 thirteen automations on one energy meter\'s circuits stay apart', r.parts.length === 0 && r.ties.length === 0, show(r));
}

// ---- names: two systems on one device; a family the name says; pairs of automations still alone ----
{
  const dev = { 'sensor.router_line': 'router', 'sensor.router_tunnel': 'router', 'sensor.router_service': 'router', 'update.router_fw': 'router' };
  const spec = {
    'automation.line': { name: 'Internet: line alerts', T: ['sensor.router_line'] },
    'automation.tunnel': { name: 'Internet: tunnel alerts', T: ['sensor.router_tunnel'] },
    'automation.service': { name: 'Router - service down', T: ['sensor.router_service'] },
    'automation.firmware': { name: 'Router - firmware', T: ['update.router_fw'] },
    'automation.gen_batt': { name: 'Generator: low battery', T: ['sensor.gen_batt'] },
    'automation.gen_ex': { name: 'Generator: exercise missed', T: ['sensor.gen_ex'] },
    'script.gen_reset': { name: 'Generator: reset the alarm', A: ['switch.gen_alarm'] },
    'automation.coop_late': { name: 'Coop door open late', T: ['sensor.coop1'] },
    'automation.coop_early': { name: 'Coop door closed early', T: ['sensor.coop2'] },
  };
  for (let i = 1; i <= 9; i++) spec['automation.zone' + i] = { name: 'Sprinkler zone ' + i, T: ['sensor.z' + i] };
  const r = home(spec, dev);
  const t = r.tie('automation.line', 'automation.service');
  check('F7 names that say two systems on one device stay two parts, tied by the device', r.together('automation.line', 'automation.tunnel') && r.together('automation.service', 'automation.firmware')
    && r.of('automation.line') !== r.of('automation.service') && t && t.why === 'device', show(r));
  check('F7 a family the name says is one part, a script nothing runs included', r.together('automation.gen_batt', 'automation.gen_ex', 'script.gen_reset'), show(r));
  check('F7 two automations still alone that start with the same word pair up', r.together('automation.coop_late', 'automation.coop_early'), show(r));
  check('F7 nine of them don\'t (a word that common says nothing)', r.of('automation.zone1') < 0, show(r));
}

// ---- checks: a lone automation checking one part's helper joins; a script checking another's flags ties ----
{
  const r = home({
    'automation.count_down': { name: 'Filter count down', T: ['sensor.clock'], A: ['counter.filter_days'] },
    'script.filter_reset': { name: 'Filter reset', A: ['counter.filter_days'] },
    'automation.filter_due': { name: 'Due notice', T: ['sensor.clock'], C: ['counter.filter_days'], A: ['notify.phone'] },
    'automation.rota_ask': { name: 'Rota: ask about the weekend', A: ['input_boolean.work_sat'] },
    'automation.rota_reset': { name: 'Rota: reset', A: ['input_boolean.work_sat'] },
    'automation.bed_button': { name: 'Bed button', T: ['sensor.button'], A: ['light.hall'], X: ['script.alarm_check'] },
    'script.alarm_check': { name: 'Alarm check', C: ['input_boolean.work_sat'], A: ['notify.phone'] },
    'automation.guests_on': { name: 'Guests arriving', T: ['sensor.door'], A: ['input_boolean.guests'] },
    'automation.guests_off': { name: 'Guests leaving', T: ['sensor.door2'], A: ['input_boolean.guests'] },
    'automation.porch_dusk': { name: 'Porch lamp dusk', T: ['sun.sun'], C: ['input_boolean.guests'] },
    'automation.porch_dawn': { name: 'Porch lamp dawn', T: ['sun.sun'], C: ['input_boolean.guests'] },
    'automation.hall_a': { name: 'Hall light a', T: ['sensor.a'], C: ['input_boolean.guests'] },
    'automation.hall_b': { name: 'Stair light b', T: ['sensor.b'], C: ['input_boolean.guests'] },
  });
  check('F8 a lone automation that only checks one part\'s counter joins it', r.together('automation.count_down', 'script.filter_reset', 'automation.filter_due'), show(r));
  const t = r.tie('automation.bed_button', 'automation.rota_ask');
  check('F8 a script one part runs that checks another part\'s flags: a tie', r.together('automation.bed_button', 'script.alarm_check') && t && t.why === 'reads' && t.by === 'script.alarm_check', show(r));
  check('F8 a flag four check: they don\'t join, and no tie', r.of('automation.porch_dusk') !== r.of('automation.guests_on') && !r.tie('automation.porch_dusk', 'automation.guests_on'), show(r));
}

// ---- the result: parts largest first, every tie once, between two parts, a below b ----
{
  const r = home({
    'automation.a1': { name: 'Aa one', A: ['input_boolean.x'] }, 'automation.a2': { name: 'Ab two', T: ['input_boolean.x'] },
    'automation.a3': { name: 'Ac three', A: ['input_boolean.x', 'input_boolean.y'] },
    'automation.b1': { name: 'Ba one', cat: 'other', A: ['input_boolean.y'] }, 'automation.b2': { name: 'Bb two', cat: 'other', T: ['input_boolean.y'], A: ['input_boolean.z'] },
    'automation.b3': { name: 'Bc three', cat: 'other', T: ['input_boolean.z'] },
    'input_boolean.y': { cat: 'other' },
  });
  const sizes = r.parts.map((p) => p.length);
  check('F9 parts come largest first', sizes.every((n, i) => !i || sizes[i - 1] >= n), show(r));
  const keys = r.ties.map((t) => t.a + '|' + t.b);
  check('F9 every tie once, between two parts, a below b', keys.length === new Set(keys).size && r.ties.every((t) => t.a < t.b && t.b < r.parts.length), show(r));
}

// ---- Node-RED summary: a disabled tab is marked, a disabled node runs nothing ----
{
  const flows = [
    { id: 't1', type: 'tab', label: 'On' }, { id: 't2', type: 'tab', label: 'Off', disabled: true },
    { id: 'a', z: 't1', type: 'server-state-changed', name: 'Watch', entityidfilter: 'light.a', wires: [['b']] },
    { id: 'b', z: 't1', type: 'api-call-service', action: 'script.go', entityId: [], wires: [] },
    { id: 'c', z: 't1', type: 'api-call-service', action: 'script.never', d: true, wires: [] },
    { id: 'e', z: 't2', type: 'server-state-changed', name: 'Old watch', entityidfilter: 'light.b', wires: [] },
  ];
  const g = nrGroups(flows, (x) => x);
  const on = g.find((x) => x.tab === 't1'), off = g.find((x) => x.tab === 't2');
  check('F10 a group on an enabled tab is not off, and runs what it calls', on && on.off === false && on.calls.includes('script.go'), g);
  check('F10 a disabled node runs nothing: what it calls isn\'t there', !g.some((x) => x.calls.includes('script.never')), g);
  check('F10 a group on a disabled tab is marked off', off && off.off === true, g);
}
