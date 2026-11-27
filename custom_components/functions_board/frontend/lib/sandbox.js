import { ENTITY_RE, EXACT_RE, SAFE_ID, SBX_PRESS, TPL_RE, canon, shorten, toList } from './constants.js';
import { P, T } from './i18n.js';
import { canonJSON } from './builders.js';

/* ---------- Sandbox (Phase 10): a function run on a copy of Home Assistant's states ----------
   Nothing is sent to Home Assistant but templates to render, which only read. The sandbox keeps its own states
   (the real ones until it changes them), its own clock, and runs the function's automations and scripts the way
   Home Assistant does: triggers, conditions, actions and their effects, delays and waits, run modes. What it
   can't know (a device's action, a sun or zone condition, a template Home Assistant couldn't render) it asks.
   Times are milliseconds on the sandbox clock; times of day are read in Home Assistant's time zone. */
export const SBX_LIMIT = 2000;  // steps one change may cause before the sandbox calls it a loop and stops
export const SBX_CANCEL = { cancel: true }, SBX_STOP = { stop: true };
export const SBX_COND_FAIL = { condFail: true };
export const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function tzParts(ms, tz) {
  const f = tzParts.f || (tzParts.f = new Map());
  let fmt = f.get(tz || '');
  if (!fmt) {
    const o = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' };
    try { fmt = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz || undefined }, o)); } catch (e) { fmt = new Intl.DateTimeFormat('en-US', o); }
    f.set(tz || '', fmt);
  }
  const p = {};
  fmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD.indexOf(String(p.weekday).toLowerCase().slice(0, 3)) };
}
// the moment a time of day ([h, m, s]) falls on, on the same local date as ms
export function localAt(ms, hms, tz) {
  const p = tzParts(ms, tz), wall = Date.UTC(p.y, p.mo - 1, p.d, hms[0], hms[1], hms[2] || 0);
  let t = wall;
  for (let i = 0; i < 3; i++) { const q = tzParts(t, tz); t = wall - (Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - t); }
  return t;
}
export const tzOffset = (ms, tz) => { const q = tzParts(ms, tz); return Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - Math.floor(ms / 1000) * 1000; };
export function parseHMS(v) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v == null ? '' : v).trim());
  return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
}
// a duration as Home Assistant reads it: seconds, "HH:MM:SS(.ms)", "HH:MM", or { days, hours, minutes, seconds, milliseconds }
export function durMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) return v * 1000;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s) * 1000;
    const m = /^(-)?(\d+):(\d{1,2})(?::(\d{1,2})(\.\d+)?)?$/.exec(s);
    if (!m) return null;
    const ms = ((+m[2] * 60 + +m[3]) * 60 + +(m[4] || 0) + parseFloat(m[5] || 0)) * 1000;
    return m[1] ? -ms : ms;
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const n = (k) => { const x = v[k]; return x == null ? 0 : parseFloat(x) || 0; };
    return (((n('days') * 24 + n('hours')) * 60 + n('minutes')) * 60 + n('seconds')) * 1000 + n('milliseconds');
  }
  return null;
}
export const fmtDur = (ms) => {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
export const fmtDurLong = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000)), d = Math.floor(s / 86400);
  if (!d) return fmtDur(s * 1000);
  const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${d}d ${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};
// a template's result as a condition reads it (Home Assistant's result_as_boolean)
export function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on', 'enable'].includes(v.trim().toLowerCase());
  return false;
}
// part of an event's data matching what a trigger asks for
export function subsetOf(want, got) {
  if (want == null) return true;
  if (typeof want !== 'object' || Array.isArray(want)) return canon(want) === canon(got) || String(want) === String(got);
  if (!got || typeof got !== 'object') return false;
  return Object.entries(want).every(([k, v]) => subsetOf(v, got[k]));
}
// helpers that follow what they read (0.11.2): Home Assistant's own rules, copied from its integrations, for a
// min/max sensor (min_max), a threshold sensor (threshold) and a binary sensor, light or switch group (group). A
// template helper is rendered by the engine. The rule comes from functions_board/sources; mem is the helper's own
// memory (a threshold's last side, the numbers a min/max holds). [state, attributes], or null to leave it as it is.
export const SBX_FOLLOW = new Set(['template', 'min_max', 'threshold', 'group']);
export const PYNUM_RE = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
// Python's round(x, d): the float's exact value rounded, an exact tie to even (multiplying by 10^d first would make
// ties of numbers that aren't: 4.45 is 4.4500000000000002, which rounds to 4.5); and a float as Home Assistant writes
// it in a state (20.0, 21.5)
export function pyRound(x, d) {
  const s = Math.abs(x).toFixed(Math.min(100, d + 25)), i = s.indexOf('.');
  if (/^50*$/.test(s.slice(i + 1 + d))) {
    const cut = Number(s.slice(0, i + 1 + d)), last = Number(d === 0 ? s[i - 1] : s[i + d]);
    return Math.sign(x) * (last % 2 ? Number((cut + Math.pow(10, -d)).toFixed(d)) : cut);
  }
  return Number(x.toFixed(d));
}
export const pyFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
export function sbxFollow(rule, get, mem, changed) {
  if (!rule) return null;
  if (rule.kind === 'min_max') {
    const ents = toList(rule.entities).map(String), dig = rule.round != null ? +rule.round : 2;
    // as its state listener: unknown or unavailable is unknown, a number is kept (and is the last), anything else
    // leaves what it held
    const take = (id) => {
      const st = get(id);
      if (!st || st.state == null || st.state === 'unknown' || st.state === 'unavailable') { mem.vals.set(id, 'unknown'); return; }
      if (!PYNUM_RE.test(String(st.state))) return;
      const n = Number(st.state);
      mem.vals.set(id, n); mem.last = n; mem.lastId = id;
    };
    if (!mem.vals) { mem.vals = new Map(); ents.forEach((id) => { if (get(id)) take(id); }); }
    else if (changed) take(changed);
    const vals = ents.filter((id) => mem.vals.has(id)).map((id) => [id, mem.vals.get(id)]), ok = vals.filter(([, v]) => v !== 'unknown');
    let v = null, side = null;
    const pick = (better) => { ok.forEach(([id, x]) => { if (v == null || better(x, v)) { v = x; side = id; } }); };
    const nums = ok.map(([, x]) => x).sort((a, b) => a - b);
    switch (rule.type) {
      case 'min': pick((x, y) => x < y); break;
      case 'max': pick((x, y) => x > y); break;
      case 'last': v = mem.last != null ? mem.last : null; side = mem.lastId || null; break;
      case 'mean': v = nums.length ? pyRound(nums.reduce((a, b) => a + b, 0) / nums.length, dig) : null; break;
      case 'median': v = nums.length ? pyRound(nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2, dig) : null; break;
      case 'range': v = nums.length ? pyRound(nums[nums.length - 1] - nums[0], dig) : null; break;
      case 'sum': v = vals.some(([, x]) => x === 'unknown') ? null : pyRound(vals.reduce((a, [, x]) => a + x, 0), dig); break;
      default: return null;
    }
    const A = { entity_id: ents };
    if (rule.type === 'min') A.min_entity_id = side;
    if (rule.type === 'max') A.max_entity_id = side;
    if (rule.type === 'last') A.last_entity_id = side;
    return [v == null ? 'unknown' : pyFloat(v), A];
  }
  if (rule.kind === 'threshold') {
    const st = get(rule.entity);
    if (!st) return null;
    const v = st.state !== 'unknown' && st.state !== 'unavailable' && PYNUM_RE.test(String(st.state)) ? Number(st.state) : null;
    const h = +rule.hysteresis || 0, lo = rule.lower == null ? null : +rule.lower, up = rule.upper == null ? null : +rule.upper;
    const below = (x, t) => x < t - h, above = (x, t) => x > t + h;
    const type = lo != null && up != null ? 'range' : lo != null ? 'lower' : 'upper';
    if (v == null) { mem.pos = 'unknown'; mem.on = null; }
    else if (type === 'lower') {
      if (mem.on == null) { mem.on = false; mem.pos = 'above'; }
      if (below(v, lo)) { mem.pos = 'below'; mem.on = true; } else if (above(v, lo)) { mem.pos = 'above'; mem.on = false; }
    } else if (type === 'upper') {
      if (mem.on == null) { mem.on = false; mem.pos = 'below'; }
      if (above(v, up)) { mem.pos = 'above'; mem.on = true; } else if (below(v, up)) { mem.pos = 'below'; mem.on = false; }
    } else {
      if (mem.on == null) { mem.on = true; mem.pos = 'in_range'; }
      if (below(v, lo)) { mem.pos = 'below'; mem.on = false; }
      if (above(v, up)) { mem.pos = 'above'; mem.on = false; } else if (above(v, lo) && below(v, up)) { mem.pos = 'in_range'; mem.on = true; }
    }
    return [mem.on == null ? 'unknown' : mem.on ? 'on' : 'off', { entity_id: rule.entity, hysteresis: h, lower: lo, upper: up, position: mem.pos, sensor_value: v, type }];
  }
  if (rule.kind === 'group') {
    const sts = toList(rule.entities).map((id) => get(String(id))).filter(Boolean).map((x) => x.state);
    const mode = rule.all ? (f) => sts.every(f) : (f) => sts.some(f);
    const avail = sts.some((x) => x !== 'unavailable'), valid = mode((x) => x !== 'unknown' && x !== 'unavailable');
    const on = valid ? mode((x) => x === 'on') : null;
    return [!avail ? 'unavailable' : on == null ? 'unknown' : on ? 'on' : 'off', { entity_id: toList(rule.entities) }];
  }
  return null;
}
// MQTT entities that follow their topics (0.11.3): what a message does to one, as Home Assistant's MQTT platforms do
// it (the rule comes from functions_board/sources). sub: the rule's state subscription; p: the payload after its
// template; cur: the entity's state as the entity holds it. [state, attributes] or null (the message changes
// nothing: Home Assistant ignores it or logs it as invalid)
export const SBX_MQ_BLOCKED = new Set(['available', 'device_info', 'entity_category', 'entity_id', 'entity_registry_enabled_default', 'extra_state_attributes', 'force_update', 'should_poll', 'state', 'unique_id', 'group_entities', 'assumed_state', 'device_class', 'entity_picture', 'friendly_name', 'icon', 'supported_features', 'unit_of_measurement']);
export const SBX_MQ_BAD = '\u0000not a number';
// Python's str.isnumeric (digits only), int() and float() of a payload, and how Home Assistant writes the number
export const pyNumber = (p) => {
  const t = String(p).replace(/_/g, '').trim();
  if (/^[+-]?(inf(inity)?|nan)$/i.test(t)) return null;
  return PYNUM_RE.test(t) ? Number(t) : null;
};
export function sbxMqttState(sub, p, cur, msg) {
  const blank = !String(p).trim(), st = cur ? cur.state : null;
  switch (sub.how) {
    case 'sensor': {
      if (p === 'None') return ['unknown', {}];
      // a number expected and something else sent: the sensor keeps it, and every write fails until a number comes
      // (found by the differential test)
      if (sub.numeric) return p === '' ? null : pyNumber(p) == null ? [SBX_MQ_BAD, {}] : [p, {}];
      if (sub.options && sub.options.length && !sub.options.includes(p)) return null;
      return [p.length > 255 ? 'unknown' : p, {}];
    }
    case 'map': {
      if (sub.blank === 'skip' && blank) return null;
      return Object.prototype.hasOwnProperty.call(sub.map, p) ? [sub.map[p], {}] : null;
    }
    case 'cover': {
      if (!p) return null;
      if (p === sub.stopped) {
        if (sub.position) return [cur && (cur.attributes || {}).current_position === 0 ? 'closed' : 'open', {}];
        return [st === 'closed' || st === 'closing' ? 'closed' : 'open', {}];
      }
      return Object.prototype.hasOwnProperty.call(sub.map, p) ? [sub.map[p], {}] : null;
    }
    case 'select': {
      if (blank) return null;
      if (p.toLowerCase() === 'none') return ['unknown', {}];
      return toList(sub.options).includes(p) ? [p, {}] : null;
    }
    case 'number': {
      if (blank) return null;
      if (p === sub.reset) return ['unknown', {}];
      const isInt = /^\d+$/.test(p), n = isInt ? Number(p) : pyNumber(p);
      if (n == null || !isFinite(n)) return null;
      if (n < sub.min || n > sub.max) return null;
      return [isInt ? String(BigInt(p)) : pyFloat(n), {}];
    }
    case 'text': return p.length < sub.min || p.length > sub.max ? null : [p, {}];
    case 'tracker': {
      if (blank) return null;
      return Object.prototype.hasOwnProperty.call(sub.map, p) ? [sub.map[p], {}] : [String(msg.payload), {}];
    }
    case 'json_light': {
      let v = null;
      try { v = JSON.parse(String(msg.payload)); } catch (e) { return null; }
      if (!v || typeof v !== 'object' || Array.isArray(v) || !('state' in v)) return null;
      return v.state === 'ON' ? ['on', {}] : v.state === 'OFF' ? ['off', {}] : v.state == null ? ['unknown', {}] : null;
    }
    default: return null;
  }
}
// an MQTT event entity's message: [event type, its other data] or null
export function sbxMqttEvent(sub, p, msg) {
  if (msg.retain || !p || p === 'None' || p === '{}') return null;
  let v = null;
  try { v = JSON.parse(p); } catch (e) { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.event_type == null) return null;
  const type = String(v.event_type), rest = Object.assign({}, v);
  delete rest.event_type;
  return toList(sub.types).includes(type) ? [type, rest] : null;
}
// what a followed helper reads
export const sbxFeeds = (d) => (d.rule.kind === 'template' ? toList(d.reads) : d.rule.kind === 'threshold' ? [d.rule.entity] : toList(d.rule.entities)).map(String);
// what Home Assistant refuses (0.11.2, found by the differential test): the call is made, fails, and the run stops
// there; cfg marks an error continue_on_error doesn't carry on from (Home Assistant only carries on from its own
// errors, not from a value its schema refuses or a plain Python error)
export function sbxRefuse(dom, svc, cur, d, name) {
  if (!cur) return null;
  const A = cur.attributes || {}, num = (x) => { const n = parseFloat(x); return isFinite(n) ? n : null; }, v = num(d && d.value);
  if (dom === 'input_number' && svc === 'set_value' && v != null) {
    const lo = num(A.min), hi = num(A.max);
    if ((lo != null && v < lo) || (hi != null && v > hi)) return { text: T('sbx_refused_range', { name, v, lo, hi }), cfg: true };
  }
  if ((dom === 'input_select' || dom === 'select') && svc === 'select_option' && d && d.option != null) {
    const opts = toList(A.options).map(String);
    if (opts.length && !opts.includes(String(d.option))) return { text: T('sbx_refused_option', { name, v: d.option, list: opts.join(', ') }) };
  }
  if (dom === 'counter' && svc === 'set_value' && v != null) {
    const lo = num(A.minimum), hi = num(A.maximum), step = num(A.step);
    if ((lo != null && v < lo) || (hi != null && v > hi) || (step && v % step !== 0)) return { text: T('sbx_refused_counter', { name, v }), cfg: true };
  }
  return null;
}
// what a service does to an entity's state: [state, attributes] or null when the sandbox doesn't know
export const SBX_ONOFF = new Set(['light', 'switch', 'fan', 'input_boolean', 'siren', 'humidifier', 'automation', 'remote', 'media_player', 'climate', 'water_heater', 'group']);
export const SBX_ARM = { alarm_arm_home: 'armed_home', alarm_arm_away: 'armed_away', alarm_arm_night: 'armed_night', alarm_arm_vacation: 'armed_vacation',
  alarm_arm_custom_bypass: 'armed_custom_bypass', alarm_disarm: 'disarmed', alarm_trigger: 'triggered' };
export function sbxEffect(dom, svc, cur, d, nowIso) {
  const st = cur ? cur.state : null, A = (cur && cur.attributes) || {};
  const num = (x) => { const n = parseFloat(x); return isFinite(n) ? n : null; };
  const clamp = (v) => { const lo = num(A.min), hi = num(A.max); return Math.min(hi == null ? Infinity : hi, Math.max(lo == null ? -Infinity : lo, v)); };
  const fmtN = (v) => String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6);
  const opts = toList(A.options).map(String);
  const isOn = st != null && !['off', 'closed', 'locked', 'idle', 'unavailable', 'unknown', 'standby'].includes(st);
  if (svc === 'toggle' && (SBX_ONOFF.has(dom) || dom === 'cover' || dom === 'valve')) {
    if (dom === 'cover' || dom === 'valve') return sbxEffect(dom, st === 'open' || st === 'opening' ? 'close_' + dom : 'open_' + dom, cur, d, nowIso);
    return sbxEffect(dom, isOn ? 'turn_off' : 'turn_on', cur, d, nowIso);
  }
  switch (dom + '.' + svc) {
    case 'cover.open_cover': return ['open', { current_position: 100, is_closed: false }];
    case 'cover.close_cover': return ['closed', { current_position: 0, is_closed: true }];
    case 'valve.open_valve': return ['open', { current_position: 100 }];
    case 'valve.close_valve': return ['closed', { current_position: 0 }];
    case 'cover.stop_cover': case 'valve.stop_valve': return [st === 'opening' ? 'open' : st === 'closing' ? 'closed' : st, {}];
    case 'cover.set_cover_position': case 'valve.set_valve_position': { const p = num(d.position); return p == null ? null : [p > 0 ? 'open' : 'closed', Object.assign({ current_position: p }, dom === 'cover' ? { is_closed: p === 0 } : {})]; }
    case 'lock.lock': return ['locked', {}];
    case 'lock.unlock': return ['unlocked', {}];
    case 'lock.open': return ['open', {}];
    case 'input_number.set_value': { const v = num(d.value); return v == null ? null : [pyFloat(clamp(v)), {}]; }
    case 'number.set_value': { const v = num(d.value); return v == null ? null : [fmtN(clamp(v)), {}]; }
    case 'input_number.increment': case 'input_number.decrement': {
      const v = num(st), s = num(A.step) || 1;
      return v == null ? null : [pyFloat(clamp(v + (svc === 'increment' ? s : -s))), {}];
    }
    case 'counter.increment': case 'counter.decrement': {
      const v = num(st) || 0, s = num(A.step) || 1, n = v + (svc === 'increment' ? s : -s);
      const lo = num(A.minimum), hi = num(A.maximum);
      return [String(Math.min(hi == null ? Infinity : hi, Math.max(lo == null ? -Infinity : lo, n))), {}];
    }
    case 'counter.reset': return [String(num(A.initial) || 0), {}];
    case 'counter.set_value': { const v = num(d.value); return v == null ? null : [String(v), {}]; }
    case 'input_select.select_option': case 'select.select_option': return d.option == null ? null : [String(d.option), {}];
    case 'input_select.select_first': case 'select.select_first': return opts.length ? [opts[0], {}] : null;
    case 'input_select.select_last': case 'select.select_last': return opts.length ? [opts[opts.length - 1], {}] : null;
    case 'input_select.select_next': case 'select.select_next': case 'input_select.select_previous': case 'select.select_previous': {
      if (!opts.length) return null;
      const i = opts.indexOf(st), step = svc.endsWith('next') ? 1 : -1, cyc = d.cycle !== false;
      let j = i < 0 ? 0 : i + step;
      if (j >= opts.length) j = cyc ? 0 : opts.length - 1;
      if (j < 0) j = cyc ? opts.length - 1 : 0;
      return [opts[j], {}];
    }
    case 'input_text.set_value': case 'text.set_value': return d.value == null ? null : [String(d.value), {}];
    case 'input_datetime.set_datetime': {
      if (d.datetime != null) return [String(d.datetime).replace('T', ' ').slice(0, 19), {}];
      if (d.date != null && d.time != null) return [`${d.date} ${parseHMS(d.time) ? String(d.time).padEnd(8, ':00').slice(0, 8) : d.time}`, {}];
      if (d.date != null) return [String(d.date), {}];
      if (d.time != null) { const t = parseHMS(d.time); return t ? [t.map((x) => String(x).padStart(2, '0')).join(':'), {}] : null; }
      return null;
    }
    case 'input_button.press': case 'button.press': return [nowIso, {}];
    case 'light.turn_on': {
      const at = {};
      if (d.brightness != null) at.brightness = num(d.brightness);
      if (d.brightness_pct != null) at.brightness = Math.round((num(d.brightness_pct) || 0) * 2.55);
      ['color_temp_kelvin', 'rgb_color', 'hs_color', 'xy_color', 'effect'].forEach((k) => { if (d[k] != null) at[k] = d[k]; });
      if (at.brightness === 0) return ['off', {}];
      return ['on', at];
    }
    case 'fan.turn_on': return ['on', d.percentage != null ? { percentage: num(d.percentage) } : {}];
    case 'fan.set_percentage': { const p = num(d.percentage); return p == null ? null : [p > 0 ? 'on' : 'off', { percentage: p }]; }
    case 'climate.turn_on': return [toList(A.hvac_modes).find((x) => x !== 'off') || 'heat', {}];
    case 'climate.set_hvac_mode': return d.hvac_mode == null ? null : [String(d.hvac_mode), {}];
    case 'climate.set_temperature': {
      const at = {};
      ['temperature', 'target_temp_high', 'target_temp_low'].forEach((k) => { if (d[k] != null) at[k] = num(d[k]); });
      return [d.hvac_mode != null ? String(d.hvac_mode) : st, at];
    }
    case 'climate.set_preset_mode': return [st, { preset_mode: d.preset_mode }];
    case 'climate.set_fan_mode': return [st, { fan_mode: d.fan_mode }];
    case 'water_heater.set_temperature': return [d.operation_mode != null ? String(d.operation_mode) : st, { temperature: num(d.temperature) }];
    case 'water_heater.set_operation_mode': return d.operation_mode == null ? null : [String(d.operation_mode), {}];
    case 'media_player.media_play': case 'media_player.play_media': return ['playing', {}];
    case 'media_player.media_pause': return ['paused', {}];
    case 'media_player.media_stop': return ['idle', {}];
    case 'media_player.volume_set': return [st, { volume_level: num(d.volume_level) }];
    case 'media_player.volume_mute': return [st, { is_volume_muted: !!d.is_volume_muted }];
    case 'vacuum.start': return ['cleaning', {}];
    case 'vacuum.pause': return ['paused', {}];
    case 'vacuum.stop': return ['idle', {}];
    case 'vacuum.return_to_base': return ['returning', {}];
    default:
      if (dom === 'alarm_control_panel' && SBX_ARM[svc]) return [SBX_ARM[svc], {}];
      if (SBX_ONOFF.has(dom) && svc === 'turn_on') return ['on', {}];
      if (SBX_ONOFF.has(dom) && svc === 'turn_off') return ['off', {}];
      return null;
  }
}
// homeassistant.turn_on and friends, per entity: the entity's own domain's service
export const HA_GENERIC = { cover: { turn_on: 'open_cover', turn_off: 'close_cover', toggle: 'toggle' }, valve: { turn_on: 'open_valve', turn_off: 'close_valve', toggle: 'toggle' },
  lock: { turn_on: 'lock', turn_off: 'unlock' } };

// Home Assistant's per-entity triggers (light.turned_on, door.opened, ...), from its own trigger classes:
// scripts/gen_sandbox_triggers.py writes this table
export const SBX_ETRIG = /* SBX_ETRIG:start */{"air_quality.co2_changed":{"d":{"sensor":{"dc":["carbon_dioxide"]}},"k":"num_changed"},"air_quality.co2_crossed_threshold":{"d":{"sensor":{"dc":["carbon_dioxide"]}},"k":"num_crossed"},"air_quality.co_changed":{"d":{"sensor":{"dc":["carbon_monoxide"]}},"k":"num_changed"},"air_quality.co_cleared":{"d":{"binary_sensor":{"dc":["carbon_monoxide"]}},"k":"target","to":["off"]},"air_quality.co_crossed_threshold":{"d":{"sensor":{"dc":["carbon_monoxide"]}},"k":"num_crossed"},"air_quality.co_detected":{"d":{"binary_sensor":{"dc":["carbon_monoxide"]}},"k":"target","to":["on"]},"air_quality.gas_cleared":{"d":{"binary_sensor":{"dc":["gas"]}},"k":"target","to":["off"]},"air_quality.gas_detected":{"d":{"binary_sensor":{"dc":["gas"]}},"k":"target","to":["on"]},"air_quality.n2o_changed":{"d":{"sensor":{"dc":["nitrous_oxide"]}},"k":"num_changed"},"air_quality.n2o_crossed_threshold":{"d":{"sensor":{"dc":["nitrous_oxide"]}},"k":"num_crossed"},"air_quality.no2_changed":{"d":{"sensor":{"dc":["nitrogen_dioxide"]}},"k":"num_changed"},"air_quality.no2_crossed_threshold":{"d":{"sensor":{"dc":["nitrogen_dioxide"]}},"k":"num_crossed"},"air_quality.no_changed":{"d":{"sensor":{"dc":["nitrogen_monoxide"]}},"k":"num_changed"},"air_quality.no_crossed_threshold":{"d":{"sensor":{"dc":["nitrogen_monoxide"]}},"k":"num_crossed"},"air_quality.ozone_changed":{"d":{"sensor":{"dc":["ozone"]}},"k":"num_changed"},"air_quality.ozone_crossed_threshold":{"d":{"sensor":{"dc":["ozone"]}},"k":"num_crossed"},"air_quality.pm10_changed":{"d":{"sensor":{"dc":["pm10"]}},"k":"num_changed"},"air_quality.pm10_crossed_threshold":{"d":{"sensor":{"dc":["pm10"]}},"k":"num_crossed"},"air_quality.pm1_changed":{"d":{"sensor":{"dc":["pm1"]}},"k":"num_changed"},"air_quality.pm1_crossed_threshold":{"d":{"sensor":{"dc":["pm1"]}},"k":"num_crossed"},"air_quality.pm25_changed":{"d":{"sensor":{"dc":["pm25"]}},"k":"num_changed"},"air_quality.pm25_crossed_threshold":{"d":{"sensor":{"dc":["pm25"]}},"k":"num_crossed"},"air_quality.pm4_changed":{"d":{"sensor":{"dc":["pm4"]}},"k":"num_changed"},"air_quality.pm4_crossed_threshold":{"d":{"sensor":{"dc":["pm4"]}},"k":"num_crossed"},"air_quality.radon_changed":{"d":{"sensor":{"dc":["radon"]}},"k":"num_changed"},"air_quality.radon_crossed_threshold":{"d":{"sensor":{"dc":["radon"]}},"k":"num_crossed"},"air_quality.smoke_cleared":{"d":{"binary_sensor":{"dc":["smoke"]}},"k":"target","to":["off"]},"air_quality.smoke_detected":{"d":{"binary_sensor":{"dc":["smoke"]}},"k":"target","to":["on"]},"air_quality.so2_changed":{"d":{"sensor":{"dc":["sulphur_dioxide"]}},"k":"num_changed"},"air_quality.so2_crossed_threshold":{"d":{"sensor":{"dc":["sulphur_dioxide"]}},"k":"num_crossed"},"air_quality.voc_changed":{"d":{"sensor":{"dc":["volatile_organic_compounds"]}},"k":"num_changed"},"air_quality.voc_crossed_threshold":{"d":{"sensor":{"dc":["volatile_organic_compounds"]}},"k":"num_crossed"},"air_quality.voc_ratio_changed":{"d":{"sensor":{"dc":["volatile_organic_compounds_parts"]}},"k":"num_changed"},"air_quality.voc_ratio_crossed_threshold":{"d":{"sensor":{"dc":["volatile_organic_compounds_parts"]}},"k":"num_crossed"},"alarm_control_panel.armed":{"d":{"alarm_control_panel":{}},"from":["arming","disarmed","disarming","pending","triggered"],"k":"transition","to":["armed_away","armed_custom_bypass","armed_home","armed_night","armed_vacation"]},"alarm_control_panel.armed_away":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_away"]},"alarm_control_panel.armed_home":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_home"]},"alarm_control_panel.armed_night":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_night"]},"alarm_control_panel.armed_vacation":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_vacation"]},"alarm_control_panel.disarmed":{"d":{"alarm_control_panel":{}},"k":"target","to":["disarmed"]},"alarm_control_panel.triggered":{"d":{"alarm_control_panel":{}},"k":"target","to":["triggered"]},"assist_satellite.idle":{"d":{"assist_satellite":{}},"k":"target","to":["idle"]},"assist_satellite.listening":{"d":{"assist_satellite":{}},"k":"target","to":["listening"]},"assist_satellite.processing":{"d":{"assist_satellite":{}},"k":"target","to":["processing"]},"assist_satellite.responding":{"d":{"assist_satellite":{}},"k":"target","to":["responding"]},"battery.became_low":{"d":{"binary_sensor":{"dc":["battery"]}},"k":"target","to":["on"]},"battery.level_changed":{"d":{"sensor":{"dc":["battery"]}},"k":"num_changed"},"battery.level_crossed_threshold":{"d":{"sensor":{"dc":["battery"]}},"k":"num_crossed"},"battery.no_longer_low":{"d":{"binary_sensor":{"dc":["battery"]}},"k":"target","to":["off"]},"battery.started_charging":{"d":{"binary_sensor":{"dc":["battery_charging"]}},"k":"target","to":["on"]},"battery.stopped_charging":{"d":{"binary_sensor":{"dc":["battery_charging"]}},"k":"target","to":["off"]},"button.pressed":{"d":{"button":{},"input_button":{}},"k":"stateless"},"climate.hvac_mode_changed":{"d":{"climate":{}},"k":"target"},"climate.started_cooling":{"d":{"climate":{"attr":"hvac_action"}},"k":"target","to":["cooling"]},"climate.started_drying":{"d":{"climate":{"attr":"hvac_action"}},"k":"target","to":["drying"]},"climate.started_heating":{"d":{"climate":{"attr":"hvac_action"}},"k":"target","to":["heating"]},"climate.target_humidity_changed":{"d":{"climate":{"attr":"humidity"}},"k":"num_changed"},"climate.target_humidity_crossed_threshold":{"d":{"climate":{"attr":"humidity"}},"k":"num_crossed"},"climate.target_temperature_changed":{"d":{"climate":{"attr":"temperature"}},"k":"num_changed"},"climate.target_temperature_crossed_threshold":{"d":{"climate":{"attr":"temperature"}},"k":"num_crossed"},"climate.turned_off":{"d":{"climate":{}},"k":"target","to":["off"]},"climate.turned_on":{"d":{"climate":{}},"from":["off"],"k":"transition","to":["auto","cool","dry","fan_only","heat","heat_cool"]},"cover.awning_closed":{"d":{"cover":{"attr":"is_closed","dc":["awning"],"tv":true}},"k":"cover"},"cover.awning_opened":{"d":{"cover":{"attr":"is_closed","dc":["awning"],"tv":false}},"k":"cover"},"cover.blind_closed":{"d":{"cover":{"attr":"is_closed","dc":["blind"],"tv":true}},"k":"cover"},"cover.blind_opened":{"d":{"cover":{"attr":"is_closed","dc":["blind"],"tv":false}},"k":"cover"},"cover.curtain_closed":{"d":{"cover":{"attr":"is_closed","dc":["curtain"],"tv":true}},"k":"cover"},"cover.curtain_opened":{"d":{"cover":{"attr":"is_closed","dc":["curtain"],"tv":false}},"k":"cover"},"cover.shade_closed":{"d":{"cover":{"attr":"is_closed","dc":["shade"],"tv":true}},"k":"cover"},"cover.shade_opened":{"d":{"cover":{"attr":"is_closed","dc":["shade"],"tv":false}},"k":"cover"},"cover.shutter_closed":{"d":{"cover":{"attr":"is_closed","dc":["shutter"],"tv":true}},"k":"cover"},"cover.shutter_opened":{"d":{"cover":{"attr":"is_closed","dc":["shutter"],"tv":false}},"k":"cover"},"door.closed":{"d":{"binary_sensor":{"dc":["door"],"tv":"off"},"cover":{"attr":"is_closed","dc":["door"],"tv":true}},"k":"cover"},"door.opened":{"d":{"binary_sensor":{"dc":["door"],"tv":"on"},"cover":{"attr":"is_closed","dc":["door"],"tv":false}},"k":"cover"},"doorbell.rang":{"d":{"event":{"dc":["doorbell"]}},"k":"stateless"},"event.received":{"d":{"event":{}},"k":"stateless"},"fan.turned_off":{"d":{"fan":{}},"k":"target","to":["off"]},"fan.turned_on":{"d":{"fan":{}},"k":"target","to":["on"]},"garage_door.closed":{"d":{"binary_sensor":{"dc":["garage_door"],"tv":"off"},"cover":{"attr":"is_closed","dc":["garage"],"tv":true}},"k":"cover"},"garage_door.opened":{"d":{"binary_sensor":{"dc":["garage_door"],"tv":"on"},"cover":{"attr":"is_closed","dc":["garage"],"tv":false}},"k":"cover"},"gate.closed":{"d":{"cover":{"attr":"is_closed","dc":["gate"],"tv":true}},"k":"cover"},"gate.opened":{"d":{"cover":{"attr":"is_closed","dc":["gate"],"tv":false}},"k":"cover"},"humidifier.mode_changed":{"d":{"humidifier":{"attr":"mode"}},"k":"target"},"humidifier.started_drying":{"d":{"humidifier":{"attr":"action"}},"k":"target","to":["drying"]},"humidifier.started_humidifying":{"d":{"humidifier":{"attr":"action"}},"k":"target","to":["humidifying"]},"humidifier.turned_off":{"d":{"humidifier":{}},"k":"target","to":["off"]},"humidifier.turned_on":{"d":{"humidifier":{}},"k":"target","to":["on"]},"humidity.changed":{"d":{"climate":{"attr":"current_humidity"},"humidifier":{"attr":"current_humidity"},"sensor":{"dc":["humidity"]},"weather":{"attr":"humidity"}},"k":"num_changed"},"humidity.crossed_threshold":{"d":{"climate":{"attr":"current_humidity"},"humidifier":{"attr":"current_humidity"},"sensor":{"dc":["humidity"]},"weather":{"attr":"humidity"}},"k":"num_crossed"},"illuminance.changed":{"d":{"sensor":{"dc":["illuminance"]}},"k":"num_changed"},"illuminance.cleared":{"d":{"binary_sensor":{"dc":["light"]}},"k":"target","to":["off"]},"illuminance.crossed_threshold":{"d":{"sensor":{"dc":["illuminance"]}},"k":"num_crossed"},"illuminance.detected":{"d":{"binary_sensor":{"dc":["light"]}},"k":"target","to":["on"]},"lawn_mower.became_idle":{"d":{"lawn_mower":{}},"k":"target","to":["idle"]},"lawn_mower.errored":{"d":{"lawn_mower":{}},"k":"target","to":["error"]},"lawn_mower.paused_mowing":{"d":{"lawn_mower":{}},"k":"target","to":["paused"]},"lawn_mower.returned_to_dock":{"d":{"lawn_mower":{}},"k":"target","to":["docked"]},"lawn_mower.started_mowing":{"d":{"lawn_mower":{}},"k":"target","to":["mowing"]},"lawn_mower.started_returning":{"d":{"lawn_mower":{}},"k":"target","to":["returning"]},"light.brightness_changed":{"d":{"light":{"attr":"brightness"}},"k":"num_changed"},"light.brightness_crossed_threshold":{"d":{"light":{"attr":"brightness"}},"k":"num_crossed"},"light.turned_off":{"d":{"light":{}},"k":"target","to":["off"]},"light.turned_on":{"d":{"light":{}},"k":"target","to":["on"]},"lock.jammed":{"d":{"lock":{}},"k":"target","to":["jammed"]},"lock.locked":{"d":{"lock":{}},"k":"target","to":["locked"]},"lock.opened":{"d":{"lock":{}},"k":"target","to":["open"]},"lock.unlocked":{"d":{"lock":{}},"k":"target","to":["unlocked"]},"media_player.paused_playing":{"d":{"media_player":{}},"from":["buffering","playing"],"k":"transition","to":["paused"]},"media_player.started_playing":{"d":{"media_player":{}},"from":["idle","off","on","paused"],"k":"transition","to":["buffering","playing"]},"media_player.stopped_playing":{"d":{"media_player":{}},"from":["buffering","paused","playing"],"k":"transition","to":["idle","off","on"]},"media_player.turned_off":{"d":{"media_player":{}},"from":["buffering","idle","on","paused","playing"],"k":"transition","to":["off"]},"media_player.turned_on":{"d":{"media_player":{}},"from":["off"],"k":"transition","to":["buffering","idle","on","paused","playing"]},"media_player.volume_changed":{"d":{"media_player":{"attr":"volume_level"}},"k":"num_changed"},"media_player.volume_crossed_threshold":{"d":{"media_player":{"attr":"volume_level"}},"k":"num_crossed"},"moisture.changed":{"d":{"sensor":{"dc":["moisture"]}},"k":"num_changed"},"moisture.cleared":{"d":{"binary_sensor":{"dc":["moisture"]}},"k":"target","to":["off"]},"moisture.crossed_threshold":{"d":{"sensor":{"dc":["moisture"]}},"k":"num_crossed"},"moisture.detected":{"d":{"binary_sensor":{"dc":["moisture"]}},"k":"target","to":["on"]},"motion.cleared":{"d":{"binary_sensor":{"dc":["motion"]}},"k":"target","to":["off"]},"motion.detected":{"d":{"binary_sensor":{"dc":["motion"]}},"k":"target","to":["on"]},"occupancy.cleared":{"d":{"binary_sensor":{"dc":["occupancy"]}},"k":"target","to":["off"]},"occupancy.detected":{"d":{"binary_sensor":{"dc":["occupancy"]}},"k":"target","to":["on"]},"power.changed":{"d":{"sensor":{"dc":["power"]}},"k":"num_changed"},"power.crossed_threshold":{"d":{"sensor":{"dc":["power"]}},"k":"num_crossed"},"remote.turned_off":{"d":{"remote":{}},"k":"target","to":["off"]},"remote.turned_on":{"d":{"remote":{}},"k":"target","to":["on"]},"scene.activated":{"d":{"scene":{}},"k":"stateless"},"schedule.block_ended":{"d":{"schedule":{}},"k":"target","to":["off"]},"schedule.block_started":{"d":{"schedule":{}},"from":["off","on"],"k":"transition","to":["on"]},"siren.turned_off":{"d":{"siren":{}},"k":"target","to":["off"]},"siren.turned_on":{"d":{"siren":{}},"k":"target","to":["on"]},"sun.elevation_changed":{"d":{"sun":{"attr":"elevation"}},"k":"num_changed"},"sun.elevation_crossed_threshold":{"d":{"sun":{"attr":"elevation"}},"k":"num_crossed"},"switch.turned_off":{"d":{"input_boolean":{},"switch":{}},"k":"target","to":["off"]},"switch.turned_on":{"d":{"input_boolean":{},"switch":{}},"k":"target","to":["on"]},"temperature.changed":{"d":{"climate":{"attr":"current_temperature"},"sensor":{"dc":["temperature"]},"water_heater":{"attr":"current_temperature"},"weather":{"attr":"temperature"}},"k":"num_changed"},"temperature.crossed_threshold":{"d":{"climate":{"attr":"current_temperature"},"sensor":{"dc":["temperature"]},"water_heater":{"attr":"current_temperature"},"weather":{"attr":"temperature"}},"k":"num_crossed"},"timer.cancelled":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["cancelled"]},"timer.finished":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["finished"]},"timer.paused":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["paused"]},"timer.restarted":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["restarted"]},"timer.started":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["started"]},"update.became_available":{"d":{"update":{}},"k":"target","to":["on"]},"vacuum.errored":{"d":{"vacuum":{}},"k":"target","to":["error"]},"vacuum.paused_cleaning":{"d":{"vacuum":{}},"k":"target","to":["paused"]},"vacuum.returned_to_dock":{"d":{"vacuum":{}},"k":"target","to":["docked"]},"vacuum.started_cleaning":{"d":{"vacuum":{}},"k":"target","to":["cleaning"]},"vacuum.started_returning":{"d":{"vacuum":{}},"k":"target","to":["returning"]},"valve.closed":{"d":{"valve":{"attr":"is_closed"}},"from":[false],"k":"transition","to":[true]},"valve.opened":{"d":{"valve":{"attr":"is_closed"}},"from":[true],"k":"transition","to":[false]},"vibration.cleared":{"d":{"binary_sensor":{"dc":["vibration"]}},"k":"target","to":["off"]},"vibration.detected":{"d":{"binary_sensor":{"dc":["vibration"]}},"k":"target","to":["on"]},"water_heater.operation_mode_changed":{"d":{"water_heater":{}},"k":"target"},"water_heater.target_temperature_changed":{"d":{"water_heater":{"attr":"temperature"}},"k":"num_changed"},"water_heater.target_temperature_crossed_threshold":{"d":{"water_heater":{"attr":"temperature"}},"k":"num_crossed"},"water_heater.turned_off":{"d":{"water_heater":{}},"k":"target","to":["off"]},"water_heater.turned_on":{"d":{"water_heater":{}},"from":["off"],"k":"origin"},"window.closed":{"d":{"binary_sensor":{"dc":["window"],"tv":"off"},"cover":{"attr":"is_closed","dc":["window"],"tv":true}},"k":"cover"},"window.opened":{"d":{"binary_sensor":{"dc":["window"],"tv":"on"},"cover":{"attr":"is_closed","dc":["window"],"tv":false}},"k":"cover"}}/* SBX_ETRIG:end */;
// the ones with rules of their own (their trigger classes override the checks)
export const SBX_ETRIG_OWN = {
  'event.received': { k: 'stateless', d: { event: {} }, evt: 'options' },
  'doorbell.rang': { k: 'stateless', d: { event: { dc: ['doorbell'] } }, evt: ['ring'] },
  'counter.incremented': { k: 'counter', d: { counter: {} }, op: 'up' },
  'counter.decremented': { k: 'counter', d: { counter: {} }, op: 'down' },
  'counter.maximum_reached': { k: 'counter', d: { counter: {} }, op: 'max' },
  'counter.minimum_reached': { k: 'counter', d: { counter: {} }, op: 'min' },
  'counter.reset': { k: 'counter', d: { counter: {} }, op: 'reset' },
  'select.selection_changed': { k: 'changed', d: { select: {}, input_select: {} } },
  'media_player.muted': { k: 'target', d: { media_player: { attr: 'is_volume_muted' } }, to: [true] },
  'media_player.unmuted': { k: 'target', d: { media_player: { attr: 'is_volume_muted' } }, to: [false] },
};
// the triggers the sandbox follows; the rest it says it can't, and Run with that trigger stands in. Since 0.11.1 also
// zone, sun, Home Assistant starting and stopping, webhooks, tags, calendars, Assist sentences and device triggers
// (one on an entity followed as the state trigger it stands for; an integration's own, a ZHA or Z-Wave button say,
// done by you from the drawer)
export const SBX_PLATS = new Set(['state', 'numeric_state', 'event', 'time', 'time_pattern', 'template', 'mqtt', 'zone', 'sun', 'homeassistant', 'webhook', 'tag', 'calendar', 'conversation', 'device']);
// ---- device triggers, conditions and actions on an entity, as the state ones they stand for (0.11.1). entOf: the
// entity id for an entity registry id (the editor stores those)
export const SBX_DEV_STATE = { opened: 'open', closed: 'closed', opening: 'opening', closing: 'closing', locked: 'locked', unlocked: 'unlocked', jammed: 'jammed', locking: 'locking', unlocking: 'unlocking', open: 'open', idle: 'idle', paused: 'paused', playing: 'playing', buffering: 'buffering', cleaning: 'cleaning', docked: 'docked', returning: 'returning', armed_away: 'armed_away', armed_home: 'armed_home', armed_night: 'armed_night', armed_vacation: 'armed_vacation', armed_custom_bypass: 'armed_custom_bypass', disarmed: 'disarmed', triggered: 'triggered', arming: 'arming', pending: 'pending', mowing: 'mowing', error: 'error' };
// a binary sensor's device trigger or condition type, on or off: motion → on, no_motion → off; a lock's is the other
// way round (on means unlocked)
export function sbxBinOn(type) {
  const ty = String(type).replace(/^is_/, '');
  if (ty === 'locked') return 'off';
  if (ty === 'not_locked') return 'on';
  if (ty === 'turned_off' || ty === 'off') return 'off';
  return /^(no|not)_/.test(ty) ? 'off' : 'on';
}
export function sbxDevEnt(x, entOf) {
  if (!x || x.entity_id == null) return null;
  const e = String(toList(x.entity_id)[0]);
  const id = EXACT_RE.test(e) ? e : entOf ? entOf(e) : null;
  return id && EXACT_RE.test(id) ? id : null;
}
export function sbxDevTrig(t, entOf) {
  if (!t || typeof t !== 'object' || (t.trigger || t.platform) !== 'device' || !t.type) return null;
  const ent = sbxDevEnt(t, entOf);
  if (!ent) return null;
  const dom = ent.split('.')[0], ty = String(t.type), keep = { _dev: t };
  ['id', 'enabled', 'for', 'variables'].forEach((k) => { if (t[k] !== undefined) keep[k] = t[k]; });
  const st = (to, from) => Object.assign({ trigger: 'state', entity_id: ent }, to !== undefined ? { to } : {}, from !== undefined ? { from } : {}, keep);
  const num = (attribute) => (t.above == null && t.below == null ? null : Object.assign({ trigger: 'numeric_state', entity_id: ent }, attribute ? { attribute } : {}, t.above != null ? { above: t.above } : {}, t.below != null ? { below: t.below } : {}, keep));
  if (ty === 'changed_states') return st(null);
  if (dom === 'binary_sensor') return st(sbxBinOn(ty));
  if (ty === 'turned_on') return st('on');
  if (ty === 'turned_off') return st('off');
  if (dom === 'sensor') return num(null);
  if (dom === 'cover' && (ty === 'position' || ty === 'tilt_position')) return num(ty === 'position' ? 'current_position' : 'current_tilt_position');
  if (dom === 'climate') return ty === 'hvac_mode_changed' ? st(t.to != null ? t.to : null) : ty === 'current_temperature_changed' ? num('current_temperature') : ty === 'current_humidity_changed' ? num('current_humidity') : null;
  if ((dom === 'device_tracker' || dom === 'person') && (ty === 'enters' || ty === 'leaves')) return Object.assign({ trigger: 'zone', entity_id: ent, zone: t.zone, event: ty === 'enters' ? 'enter' : 'leave' }, keep);
  if ((dom === 'select' || dom === 'input_select') && ty === 'current_option_changed') return st(t.to != null ? t.to : null, t.from != null ? t.from : undefined);
  if ((dom === 'button' || dom === 'input_button' || dom === 'event') && (ty === 'pressed' || ty === 'event')) return st(null);
  if (SBX_DEV_STATE[ty]) return st(SBX_DEV_STATE[ty]);
  return null;
}
export function sbxDevCond(c, entOf) {
  if (!c || !c.type) return null;
  const ent = sbxDevEnt(c, entOf);
  if (!ent) return null;
  const dom = ent.split('.')[0], ty = String(c.type), keep = c.for !== undefined ? { for: c.for } : {};
  const st = (state, attribute) => Object.assign({ condition: 'state', entity_id: ent, state }, attribute ? { attribute } : {}, keep);
  const num = (attribute) => (c.above == null && c.below == null ? null : Object.assign({ condition: 'numeric_state', entity_id: ent }, attribute ? { attribute } : {}, c.above != null ? { above: c.above } : {}, c.below != null ? { below: c.below } : {}));
  if (dom === 'binary_sensor') return st(sbxBinOn(ty));
  if (ty === 'is_on') return st('on');
  if (ty === 'is_off') return st('off');
  if (dom === 'sensor') return num(null);
  if (dom === 'cover' && (ty === 'is_position' || ty === 'is_tilt_position')) return num(ty === 'is_position' ? 'current_position' : 'current_tilt_position');
  if (dom === 'climate' && ty === 'is_hvac_mode' && c.hvac_mode != null) return st(c.hvac_mode);
  if (dom === 'climate' && ty === 'is_preset_mode' && c.preset_mode != null) return st(c.preset_mode, 'preset_mode');
  if ((dom === 'select' || dom === 'input_select') && ty === 'selected_option' && c.option != null) return st(c.option);
  const m = /^is_(.+)$/.exec(ty);
  if (m && SBX_DEV_STATE[m[1]]) return st(SBX_DEV_STATE[m[1]]);
  if (m && Object.values(SBX_DEV_STATE).includes(m[1])) return st(m[1]);
  return null;
}
// a device action on an entity, as the action it stands for: [service, data] or null
export function sbxDevAct(a, entOf) {
  if (!a || !a.type) return null;
  const ent = sbxDevEnt(a, entOf);
  if (!ent) return null;
  const dom = ent.split('.')[0], ty = String(a.type);
  if (['turn_on', 'turn_off', 'toggle'].includes(ty)) return [dom + '.' + ty, {}, ent];
  if (dom === 'light' && ['brightness_increase', 'brightness_decrease', 'flash'].includes(ty)) return ['light.turn_on', {}, ent];
  if (dom === 'lock' && ['lock', 'unlock', 'open'].includes(ty)) return ['lock.' + ty, {}, ent];
  if (dom === 'cover' && ['open', 'close', 'stop'].includes(ty)) return ['cover.' + ty + '_cover', {}, ent];
  if (dom === 'cover' && ty === 'set_position') return ['cover.set_cover_position', { position: a.position }, ent];
  if (dom === 'alarm_control_panel' && /^(arm_|disarm|trigger)/.test(ty)) return ['alarm_control_panel.alarm_' + ty, {}, ent];
  if (dom === 'climate' && ty === 'set_hvac_mode') return ['climate.set_hvac_mode', { hvac_mode: a.hvac_mode }, ent];
  if (dom === 'climate' && ty === 'set_preset_mode') return ['climate.set_preset_mode', { preset_mode: a.preset_mode }, ent];
  if ((dom === 'button' || dom === 'input_button') && ty === 'press') return [dom + '.press', {}, ent];
  if ((dom === 'select' || dom === 'input_select') && ty === 'select_option') return [dom + '.select_option', { option: a.option }, ent];
  if (dom === 'vacuum' && ['clean', 'dock'].includes(ty)) return ['vacuum.' + (ty === 'clean' ? 'start' : 'return_to_base'), {}, ent];
  return null;
}
// an integration's own device trigger (no entity): what makes it one; two triggers with the same key are the same
// button. The keys besides these name the press: type, subtype, and the integration's own (zha's, deCONZ's …)
// what names a device trigger, rather than what it's set to
export const SBX_DEV_IDENT = new Set(['domain', 'device_id', 'type', 'subtype', 'entity_id', 'property', 'property_key', 'endpoint', 'command_class', 'discovery_id']);
export const SBX_DEV_SKIP = new Set(['trigger', 'platform', 'id', 'enabled', 'for', 'variables', 'metadata', 'alias']);
export function sbxPressKey(t) {
  const o = {};
  // (keys with an underscore are the sandbox's own: a trigger it rewrote keeps the original under _dev)
  Object.keys(t).filter((k) => !SBX_DEV_SKIP.has(k) && k[0] !== '_').sort().forEach((k) => { o[k] = t[k]; });
  return JSON.stringify(o);
}
// ---- a device's own triggers (0.13.0) ----------------------------------------------------------------------------
// what's pressed (pick: a press key read back) starts a device trigger when every setting the trigger has is the
// pressed one's, as in Home Assistant: one set to a scene button's KeyPressed starts on that only, one with no value
// set on any. Any other trigger fired from the Press row is the one pressed, setting for setting
export function sbxPressHits(t, pick) {
  if (!t || !pick) return false;
  if ((t.trigger || t.platform) !== 'device') return sbxPressKey(t) === sbxPressKey(pick);
  const same = (a, b) => ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object') ? canonJSON(a) === canonJSON(b) : String(a) === String(b));
  return Object.keys(t).filter((k) => !SBX_DEV_SKIP.has(k)).every((k) => k in pick && same(t[k], pick[k]));
}
// an MQTT device trigger, as Home Assistant listens for it: an MQTT trigger on the topic and payload of its discovery
// config (defs: [{ device_id, type, subtype, discovery_id, topic, payload, value_template }], from the device's
// MQTT debug info). So a message on the topic starts it, and pressing it sends the message, which everything else on
// the topic hears too. Found as Home Assistant finds it: by its discovery id when the trigger names one, else by
// device, type and subtype
export const sbxMqKey = (d) => `${d.device_id}|${d.type}|${d.subtype}`;
export function sbxMqDef(t, defs) {
  const list = (defs || []).filter((x) => x && x.topic);
  return (t.discovery_id != null && list.find((x) => x.discovery_id === t.discovery_id)) || list.find((x) => x.device_id === t.device_id && x.type === t.type && x.subtype === t.subtype) || null;
}
export function sbxDevMqtt(t, defs) {
  if (!t || typeof t !== 'object' || (t.trigger || t.platform) !== 'device' || t.domain !== 'mqtt') return null;
  const d = sbxMqDef(t, defs);
  if (!d) return null;
  const out = { trigger: 'mqtt', topic: d.topic, _dev: t, _mq: sbxMqKey(d) };
  if (d.payload) out.payload = d.payload;
  if (d.value_template) out.value_template = d.value_template;
  ['id', 'enabled', 'variables'].forEach((k) => { if (t[k] !== undefined) out[k] = t[k]; });
  return out;
}
// the message an MQTT device trigger's press sends: its payload, where its value template reads it ({{ value }},
// {{ value_json.action }}, {{ value_json['Button1'].Action }}). exact: false when the template does more than read
// a value: the payload goes as it is, and the trigger is started anyway
export function sbxMqttSend(payload, tpl) {
  const p = payload == null ? '' : String(payload);
  if (!tpl || /^\s*\{\{\s*value\s*\}\}\s*$/.test(String(tpl))) return { payload: p, exact: true };
  const m = /^\s*\{\{\s*value_json((?:\s*\.\s*[A-Za-z_]\w*|\s*\[\s*(?:'[^']*'|"[^"]*")\s*\])+)\s*\}\}\s*$/.exec(String(tpl));
  if (!m) return { payload: p, exact: false };
  const keys = [...m[1].matchAll(/\.\s*([A-Za-z_]\w*)|\[\s*(?:'([^']*)'|"([^"]*)")\s*\]/g)].map((x) => (x[1] != null ? x[1] : x[2] != null ? x[2] : x[3]));
  const out = keys.reduceRight((v, k) => ({ [k]: v }), p);
  return { payload: JSON.stringify(out), exact: true };
}
// a device trigger's settings chosen from its capabilities (Home Assistant's extra_fields): the select ones, each
// with its options as [value, label]
export function sbxDevFields(caps) {
  return toList(caps && caps.extra_fields).filter((f) => f && f.type === 'select' && Array.isArray(f.options) && f.options.length && typeof f.name === 'string' && !SBX_DEV_SKIP.has(f.name))
    .map((f) => ({ name: f.name, required: !!f.required, options: f.options.map((o) => (Array.isArray(o) ? [o[0], String(o[1] != null ? o[1] : o[0])] : [o, String(o)])) }));
}
// what the Press row offers of a device's own triggers: those with no entity (the others are its entities' states,
// set on the Set row), and not those that ask for a setting it can't offer a choice for (a Z-Wave value's command
// class and property)
export function sbxDevPressable(t, caps) {
  if (!t || typeof t !== 'object' || t.entity_id != null || !t.device_id) return false;
  // a Z-Wave value updated: the Z-Wave row's, from the node's values (0.13.0); a Notification event with no choice
  // to offer (Home Assistant's are typed in): only those the automations use, as they're set
  if (t.domain === 'zwave_js' && /^(zwave_js\.value_updated\.|event\.notification\.)/.test(String(t.type))) return false;
  const sel = new Set(sbxDevFields(caps).map((f) => f.name));
  return !toList(caps && caps.extra_fields).some((f) => f && f.required && !sel.has(f.name));
}
// ---- Z-Wave values (0.13.0) -----------------------------------------------------------------------------------------
// A Z-Wave device's values come from functions_board/zwave_values: { node_id, home_id, values: [{ id, cc, cc_name,
// endpoint, property, property_name, property_key, property_key_name, label, type, states: [[raw, label]], value,
// stateful, notification_type, entities: [[entity id, state key]] }] }. A value that holds (a lock's mode, a door's
// state) is updated: Home Assistant's zwave_js.value_updated triggers hear it, and the entities that show it follow.
// A stateless one (a scene button) is a value notification: the zwave_js_value_notification event, and its event
// entity. A Notification value is a state (door open), only updated: Z-Wave JS fires no notification event for it.
// An event-type Notification (a keypad unlock) has no value: it's the zwave_js_notification event, from the Press row.
// Home Assistant's value id: node, command class, endpoint, property and key
export const sbxZwId = (node, cc, ep, prop, key) => `${node}-${cc}-${ep || 0}-${prop}` + (key != null && key !== '' ? `-${key}` : '');
// a trigger's setting as Home Assistant's schema reads it: Coerce(int), else the text ("001" is 1, as in Home
// Assistant: a trigger with property_key "001" never matches the value keyed "001")
export const sbxZwInt = (v) => (typeof v === 'number' ? Math.trunc(v) : typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v) ? parseInt(v, 10) : v);
// from and to of a value-updated trigger, as Home Assistant reads them (zwave_js VALUE_SCHEMA): a boolean word, an
// integer, a float, hex digits (a bitmask), else the text
export function sbxZwCoerce(v) {
  if (typeof v !== 'string') return v;
  const w = v.toLowerCase().trim();
  if (['true', 'yes', 'on', 'enable'].includes(w)) return true;
  if (['false', 'no', 'off', 'disable'].includes(w)) return false;
  if (/^[-+]?\d+$/.test(w)) return parseInt(w, 10);
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(w)) return parseFloat(w);
  if (/^(0x)?[0-9a-f]+$/.test(w)) return parseInt(w.replace(/^0x/, ''), 16);
  return v;
}
// Python's ==, for what a Z-Wave value can be: True is 1, 1 is 1.0, a number is never the same as text
export const sbxPyEq = (a, b) => { const n = (x) => (typeof x === 'boolean' ? +x : x); const x = n(a), y = n(b); return typeof x === typeof y && x === y; };
export function sbxZwMatch(m, label, raw) {
  if (m === undefined || m === null || m === '*') return true;
  if (Array.isArray(m)) return m.map(sbxZwCoerce).some((x) => sbxPyEq(x, label) || sbxPyEq(x, raw));
  const x = sbxZwCoerce(m);
  return x === '*' || sbxPyEq(x, label) || sbxPyEq(x, raw);
}
// a value's state label (its states map), else the raw value
export const sbxZwLabel = (v, raw) => { const s = (v.states || []).find((x) => sbxPyEq(x[0], raw) || String(x[0]) === String(raw)); return s ? s[1] : raw; };
// the state of an entity that shows a value, as Home Assistant's Z-Wave platform works it out (binary sensor, sensor,
// select, switch, lock); null for one the sandbox leaves as it is
export function sbxZwState(entityId, v, raw, stateKey) {
  const dom = entityId.split('.')[0];
  if (!['binary_sensor', 'sensor', 'switch', 'lock', 'select'].includes(dom)) return null;
  if (raw == null) return 'unknown';
  if (dom === 'binary_sensor') return (stateKey != null ? parseInt(raw, 10) === +stateKey : !!raw) ? 'on' : 'off';
  if (dom === 'switch') return raw ? 'on' : 'off';
  if (dom === 'lock') { if (v.cc === 98 && raw === 254) return 'unknown'; return sbxPyEq(raw, v.cc === 98 ? 255 : 1) ? 'locked' : 'unlocked'; }
  const l = sbxZwLabel(v, raw);
  return typeof l === 'boolean' ? (l ? 'True' : 'False') : String(l);
}
// a Z-Wave device trigger, as Home Assistant attaches it (its device_trigger.py): a scene button or a Notification as
// the event the integration fires, a value updated as the zwave_js.value_updated trigger
export function sbxDevZwave(t) {
  if (!t || typeof t !== 'object' || (t.trigger || t.platform) !== 'device' || t.domain !== 'zwave_js') return null;
  const ty = String(t.type || ''), keep = { _dev: t, _zw: true }, put = (o, k, to, f) => { const v = t[k]; if (v !== undefined && v !== null && v !== '') o[to || k] = f ? f(v) : v; };
  ['id', 'enabled', 'variables'].forEach((k) => { if (t[k] !== undefined) keep[k] = t[k]; });
  if (/^event\.value_notification\./.test(ty)) {
    const ed = { device_id: t.device_id };
    put(ed, 'command_class', null, sbxZwInt); put(ed, 'property'); put(ed, 'property_key'); put(ed, 'endpoint', null, sbxZwInt); put(ed, 'value', 'value_raw', sbxZwInt);
    return Object.assign({ trigger: 'event', event_type: 'zwave_js_value_notification', event_data: ed }, keep);
  }
  if (ty === 'event.notification.entry_control' || ty === 'event.notification.notification') {
    const ed = { device_id: t.device_id };
    put(ed, 'command_class', null, sbxZwInt);
    if (ty === 'event.notification.entry_control') { put(ed, 'event_type', null, sbxZwInt); put(ed, 'data_type', null, sbxZwInt); }
    else { put(ed, 'label'); put(ed, 'event_label'); put(ed, 'event', null, sbxZwInt); put(ed, 'type.', 'type', sbxZwInt); }
    return Object.assign({ trigger: 'event', event_type: 'zwave_js_notification', event_data: ed }, keep);
  }
  if (/^zwave_js\.value_updated\./.test(ty)) {
    const out = { trigger: 'zwave_js.value_updated', device_id: [t.device_id] };
    ['command_class', 'property', 'property_key', 'endpoint', 'from', 'to'].forEach((k) => put(out, k));
    return Object.assign(out, keep);
  }
  return null;
}
// a choice picked on the Press row: a number-like value as a number, as the automation editor stores it
export const sbxNum = (v) => (typeof v === 'string' && /^-?\d+$/.test(v) ? +v : v);
// an Assist sentence template as a pattern: [optional words], (one|or|another), {slot}; slots come back by name
export function sbxSentence(tpl) {
  const names = [];
  let src = '', i = 0;
  const s = String(tpl).toLowerCase().trim();
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { const j = s.indexOf('}', i); const n = s.slice(i + 1, j < 0 ? s.length : j).split(':')[0].trim(); names.push(n); src += '(.+?)'; i = j < 0 ? s.length : j; }
    else if (ch === '[') src += '(?:';
    else if (ch === ']') src += ')?';
    else if (ch === '(') src += '(?:';
    else if (ch === ')') src += ')';
    else if (ch === '|') src += '|';
    else if (ch === ' ') src += '\\s*';
    else src += ch.replace(/[.*+?^$\\/]/g, '\\$&');
  }
  let re = null;
  try { re = new RegExp('^\\s*' + src + '\\s*[.!?]?\\s*$', 'i'); } catch (e) { re = null; }
  return { names, match: (said) => { if (!re) return null; const m = re.exec(String(said).toLowerCase().trim()); if (!m) return null; const slots = {}; names.forEach((n, k) => { slots[n] = m[k + 1]; }); return slots; } };
}
export function sbxSay(tpl) {
  let s = String(tpl), prev;
  do { prev = s; s = s.replace(/\[[^[\]]*\]/g, ''); } while (s !== prev);
  do { prev = s; s = s.replace(/\(([^()|]*)(\|[^()]*)?\)/g, '$1'); } while (s !== prev);
  return s.replace(/\{([^}:]+)(:[^}]*)?\}/g, '{$1}').replace(/\s+/g, ' ').trim();
}
// a device on its way: a cover opening or closing, a lock locking or unlocking, a valve the same (0.11.2)
export function sbxMoving(dom, from, to) {
  if (from === to) return null;
  if (dom === 'cover' || dom === 'valve') return to === 'open' ? 'opening' : to === 'closed' ? 'closing' : null;
  if (dom === 'lock') return to === 'locked' ? 'locking' : to === 'unlocked' ? 'unlocking' : to === 'open' ? 'opening' : null;
  return null;
}
// the number just past a threshold, for a value that crosses it: 1100 → 1101, 21.5 → 21.6
export function sbxStep(x, up) {
  const n = Number(x);
  if (!isFinite(n)) return null;
  const dec = (String(x).split('.')[1] || '').length, d = dec ? Math.pow(10, -dec) : 1;
  const v = n + (up ? d : -d);
  return dec ? v.toFixed(dec) : String(v);
}
// calls that only send or log a message: nothing for the sandbox to change
export const SBX_MSG = new Set(['notify', 'persistent_notification', 'tts', 'system_log', 'logbook', 'assist_satellite', 'telegram_bot', 'mobile_app']);
// the message an MQTT trigger fires on (0.11.2): its payload, or, when it compares a value_template's field with
// it (Zigbee2MQTT's {{ value_json.action }}), the JSON with that field: {"action": "single"}
export function sbxPayloadFor(t) {
  const p = String(t.payload), vt = typeof t.value_template === 'string' ? t.value_template : '';
  const m = vt.match(/^\s*\{\{\s*value_json(?:\.([A-Za-z_][\w]*)|\[\s*['"]([^'"]+)['"]\s*\])\s*\}\}\s*$/);
  return m ? JSON.stringify({ [m[1] || m[2]]: p }) : p;
}
// what well-known integrations publish on a topic (0.11.2): Frigate's events (a person or a car seen, and gone), the
// count of a label on a camera, and its motion. [{ v: payload, what: words }]
export function sbxKnownPayloads(topic) {
  const p = String(topic || '').split('/');
  if (p[0] !== 'frigate') return [];
  if (p[1] === 'events') {
    const ev = (type, label) => JSON.stringify({ type, before: { label, camera: 'camera', current_zones: [] }, after: { label, camera: 'camera', current_zones: [], score: 0.82, has_snapshot: true } });
    return [{ v: ev('new', 'person'), what: T('sbx_fr_person') }, { v: ev('new', 'car'), what: T('sbx_fr_car') }, { v: ev('end', 'person'), what: T('sbx_fr_end') }];
  }
  if (p.length === 3 && p[2] === 'motion') return [{ v: 'ON', what: T('sbx_fr_motion_on') }, { v: 'OFF', what: T('sbx_fr_motion_off') }];
  if (p.length === 3 && /^[a-z_]+$/.test(p[2])) return [{ v: '1', what: T('sbx_fr_count', { label: p[2] }) }, { v: '0', what: T('sbx_fr_none', { label: p[2] }) }];
  return [];
}
export const sbxTopic = (pat, topic) => {
  const p = String(pat).split('/'), t = String(topic).split('/');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '#') return true;
    if (i >= t.length || (p[i] !== '+' && p[i] !== t[i])) return false;
  }
  return p.length === t.length;
};

// a right-angled arrow between two boxes that aren't joined on the board (the flow view's temporary boxes), out of
// and into the sides the board's own arrows use (left and right; top and bottom when it runs top to bottom).
// segs are its straight parts, mid is where its step number goes
export const flowPath = (A, B, V) => {
  // worked out left to right; top to bottom swaps x and y on the way in and out
  const sw = (R) => (V ? { x: R.y, y: R.x, w: R.h, h: R.w } : R), pt = (x, y) => (V ? [y, x] : [x, y]);
  const a = sw(A), b = sw(B), ay = a.y + a.h / 2, by = b.y + b.h / 2, G = 26;
  let P;
  if (b.x >= a.x + a.w + 12) { const xm = (a.x + a.w + b.x) / 2; P = [[a.x + a.w, ay], [xm, ay], [xm, by], [b.x, by]]; }
  else if (b.x + b.w <= a.x - 12) { const xm = (a.x + b.x + b.w) / 2; P = [[a.x, ay], [xm, ay], [xm, by], [b.x + b.w, by]]; }
  else { const xo = Math.max(a.x + a.w, b.x + b.w) + G; P = [[a.x + a.w, ay], [xo, ay], [xo, by], [b.x + b.w, by]]; }
  P = P.map(([x, y]) => pt(x, y));
  const r = (v) => Math.round(v * 10) / 10;
  const segs = P.slice(1).map((q, i) => [P[i][0], P[i][1], q[0], q[1]]);
  return { d: 'M' + P.map(([x, y]) => `${r(x)},${r(y)}`).join(' L'), mid: [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2], segs };
};
// how many of the boxes a path runs through
export const flowCrossings = (segs, rects) => rects.filter((o) => segs.some(([x0, y0, x1, y1]) => Math.max(x0, x1) > o.x + 2 && Math.min(x0, x1) < o.x + o.w - 2
  && Math.max(y0, y1) > o.y + 2 && Math.min(y0, y1) < o.y + o.h - 2)).length;
// the entities a condition reads, for drawing it on the board
export const sbxReads = (c) => {
  const out = new Set();
  const walk = (v, k) => {
    if (typeof v === 'string') { if (k === 'entity_id' && EXACT_RE.test(v)) out.add(v); else (v.match(ENTITY_RE) || []).forEach((x) => out.add(x)); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, x]) => { if (kk !== 'alias') walk(x, kk); });
  };
  walk(c, '');
  return [...out].slice(0, 8);
};
export class Sandbox {
  // o: { states (Home Assistant's, read, never written), items: [{ id, cfg }], now, tz, tpl(template, vars) → { ok, value,
  //      partly } | { ok: false, err }, ask({ text, key }) → Promise<boolean>, resolve(ref) → entity ids, fetch(id) → cfg, onLog(entry),
  //      entityOf(registry id) → entity id, scene(id) → its config ({ entities }) or null }
  constructor(o) {
    this.o = o; this.real = o.states || {}; this.tz = o.tz; this.now = o.now == null ? Date.now() : o.now;
    this.changed = new Map(); this.items = new Map(); this.log = []; this.timers = []; this.runs = new Map(); this.ctxN = 0;
    this.pend = new Map(); this.waiters = new Set(); this.tplLast = new Map(); this.queue = new Map();
    this.busy = 0; this.seq = 0; this.steps = 0; this.halted = false; this.n = 0; this.devT = new WeakMap();
    // 0.11.2: step-through (paused runs, breakpoints), how devices answer, and what was reached (coverage)
    this.stepping = false; this.breaks = new Set(); this.paused = new Map(); this.behave = new Map();
    this.hit = new WeakSet(); this.cres = new WeakMap(); this.fired = new Set(); this.dispatching = false; this.evq = []; this.after = []; this.round = null;
    // helpers that follow what they read (sbxFollow): id → { rule, reads, mem }, and what each input feeds
    this.follow = new Map(); this.feeds = new Map();
    // MQTT entities that follow their topics (0.11.3): id → { rule, mem }, in the order Home Assistant set them up
    this.mq = new Map();
    Object.entries(o.derived || {}).forEach(([id, d]) => {
      if (d && d.rule && d.rule.kind === 'mqtt') { this.mq.set(id, { rule: d.rule, mem: null }); return; }
      if (!d || !d.rule || !SBX_FOLLOW.has(d.rule.kind)) return;
      const cur = this.real[id], mem = {};
      // a threshold remembers which side it was on: the helper's state as it is now
      if (d.rule.kind === 'threshold' && cur) { mem.on = cur.state === 'on' ? true : cur.state === 'off' ? false : null; mem.pos = (cur.attributes || {}).position; }
      this.follow.set(id, { rule: d.rule, reads: toList(d.reads), mem });
      sbxFeeds(d).forEach((src) => { if (!this.feeds.has(src)) this.feeds.set(src, []); this.feeds.get(src).push(id); });
    });
    // Z-Wave devices' values (0.13.0): device → { node, home, byId }, and each value's raw value as it is here
    this.zw = new Map(); this.zwv = new Map();
    Object.entries(o.zwave || {}).forEach(([dev, z]) => { if (z && Array.isArray(z.values)) this.zw.set(dev, { node: z.node_id, home: z.home_id, byId: new Map(z.values.map((v) => [v.id, v])) }); });
    (o.items || []).forEach((x) => this.add(x.id, x.cfg));
  }
  add(id, cfg) { if (cfg) this.items.set(id, { id, cfg, kind: id.startsWith('script.') ? 'script' : 'automation' }); }
  get(id) {
    if (this.changed.has(id)) return this.changed.get(id);
    const s = this.real[id];
    return s ? { state: s.state, attributes: s.attributes || {}, last_changed: s.last_changed, last_updated: s.last_updated || s.last_changed } : null;
  }
  obj(id) { const s = this.get(id); return s ? { entity_id: id, state: s.state, attributes: s.attributes, last_changed: s.last_changed, last_updated: s.last_updated } : null; }
  iso(ms) { return new Date(ms == null ? this.now : ms).toISOString(); }
  _log(e) {
    e.id = ++this.seq; e.t = this.now;
    this.log.push(e);
    if (this.o.onLog) this.o.onLog(e);
    return e.id;
  }
  // a run's variables as they are now, for the timeline (trigger, repeat, wait, response variables …): a copy, long
  // strings cut, the whole kept under 20,000 characters
  // a run's context (0.11.3): Home Assistant gives every run one, and its actions' templates read its id (a
  // notification's own button ids, for one); here each run gets the next of the sandbox's own
  _ctx() { this.ctxN = (this.ctxN || 0) + 1; return { id: 'SBX' + String(this.ctxN).padStart(23, '0'), parent_id: null, user_id: null }; }
  _snap(vars) {
    try {
      const str = JSON.stringify(vars, (k, v) => (k === 'this' || k === 'context' ? undefined : typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v));
      if (!str) return null;
      return str.length <= 20000 ? JSON.parse(str) : { '…': T('sbx_vars_big') };
    } catch (e) { return null; }
  }
  // ---- step-through (0.11.2): with stepping on, or a breakpoint on the run's automation or script, a run waits
  // before each condition and action until you say Step (on to the next one) or Continue (stepping off, every
  // paused run goes on; breakpoints still stop)
  async _gate(run, text) {
    if (!this.stepping && !this.breaks.has(run.item.id)) return;
    if (run.cancelled) throw SBX_CANCEL;
    const lid = this._log({ kind: 'pause', key: run.item.id, cause: run.cause, text, vars: this._snap(run.vars) });
    // while it waits it isn't work in hand (settle() returns); going on counts again at once
    this._parked(run);
    this.busy--;
    await new Promise((res) => { this.paused.set(lid, { run, res }); if (this.o.onPause) this.o.onPause(lid); });
    this._moving(run);
    if (run.cancelled) throw SBX_CANCEL;
  }
  resume(lid) { const p = this.paused.get(lid); if (!p) return false; this.paused.delete(lid); this.busy++; p.res(); return true; }
  resumeAll() { [...this.paused.keys()].forEach((k) => this.resume(k)); }
  // how a device answers a call (0.11.2): at once (the default), slowly (a cover's opening or a lock's locking
  // first, when it has one, then the end after ms), not at all (a lock jams), or by going unavailable
  setBehave(id, how, ms) {
    if (!how || how === 'ok') this.behave.delete(id); else this.behave.set(id, { how, ms: Math.max(0, +ms || 0) });
  }
  async _answer(id, st, A, cid) {
    const b = this.behave.get(id);
    if (!b) return this.setState(id, st, A, cid);
    if (b.how === 'unavailable') return this.setState(id, 'unavailable', {}, cid);
    if (b.how === 'fails') {
      this._log({ kind: 'note', key: id, cause: cid, warn: true, text: T('sbx_dev_failed', { name: this._name(id) }) });
      if (id.startsWith('lock.')) await this.setState(id, 'jammed', {}, cid);
      return;
    }
    const cur = this.get(id), mid = sbxMoving(id.split('.')[0], cur && cur.state, st);
    if (mid) await this.setState(id, mid, {}, cid);
    const key = 'answer:' + id;
    this.timers.filter((x) => x.slot === key).forEach((x) => this._drop(x));
    this._at(this.now + b.ms, () => this._task(() => this.setState(id, st, A, cid)), null, T('sbx_dev_answers', { name: this._name(id) }), id).slot = key;
  }
  // ---- the clock and the work in hand
  _task(fn) { this.busy++; return Promise.resolve().then(fn).catch((e) => { if (e !== SBX_CANCEL) this._log({ kind: 'note', warn: true, text: T('sbx_error', { e: (e && e.message) || String(e) }) }); }).finally(() => { this.busy--; }); }
  async settle() {
    for (let i = 0; i < 6000 && this.busy > 0; i++) await new Promise((r) => setTimeout(r, i < 50 ? 0 : 10));
  }
  _at(at, fn, run, label, key) {
    const t = { at, fn, run, label, key, n: ++this.n };
    this.timers.push(t);
    if (run) run.timers.add(t);
    return t;
  }
  _drop(t) { const i = this.timers.indexOf(t); if (i >= 0) this.timers.splice(i, 1); if (t && t.run) t.run.timers.delete(t); }
  // A run that awaits something goes on only once the work in hand is done (0.11.3, found by the differential test):
  // the handing out of a change in progress (_dispatch), or every timer due at this moment (advance: Home
  // Assistant's loop runs the callbacks that are ready before the tasks they wake). What awaits: a run woken from a
  // delay or a wait, one that published an MQTT message (it waits for the broker's answer), and a run restarted
  // while the old one stops. So a single-mode run woken at the moment its own `for:` trigger comes due is still
  // running when that trigger is looked at, and is dropped.
  _later(go) {
    if (this.dispatching) this.after.push(go);
    else if (this.round) this.round.push(go);
    else go();
  }
  // a run that awaits here: it stops being work in hand until _later lets it go on
  _yield(run) {
    if (!this.dispatching && !this.round) return null;
    return new Promise((res) => { this._parked(run); this.busy--; this._later(() => { this.busy++; this._moving(run); res(); }); });
  }
  _sleep(ms, run, label) {
    return new Promise((res, rej) => {
      const t = this._at(this.now + Math.max(0, ms), () => this._later(() => { this.busy++; this._moving(run); res(); }), run, label);
      t.rej = (e) => { this.busy++; rej(e); };
      this._parked(run);
      this.busy--;
    });
  }
  nextAt() { return this.timers.reduce((m, t) => Math.min(m, t.at), Infinity); }
  pending() { return this.timers.filter((t) => t.label).sort((a, b) => a.at - b.at).map((t) => ({ at: t.at, label: t.label, key: t.key || (t.run && t.run.item.id) })); }
  async advance(ms) {
    await this.settle();
    const end = this.now + Math.max(0, ms);
    this._fresh();
    for (let guard = 0; guard < 10000 && !this.halted; guard++) {
      this.timers.sort((a, b) => a.at - b.at || a.n - b.n);
      const t0 = this.timers[0];
      if (!t0 || t0.at > end) break;
      this.now = Math.max(this.now, t0.at);
      // the timers due now, in the order they were set, as one round; what they wake goes on in the rounds after
      // (_later). A timer set meanwhile for this moment waits for the next turn of the loop.
      let ready = this.timers.filter((t) => t.at === t0.at).map((t) => () => { if (!this.timers.includes(t)) return; this._drop(t); t.fn(); });
      try {
        for (let turn = 0; ready.length && turn < 1000 && !this.halted; turn++) {
          this.round = [];
          for (const go of ready) { go(); await this.settle(); }
          ready = this.round;
        }
      } finally { this.round = null; }
    }
    this.now = Math.max(this.now, end);
    await this._timeTemplates();
    await this.settle();
  }
  async toNext() { const at = this.nextAt(); if (isFinite(at)) await this.advance(at - this.now); }
  // a new change from the person: its consequences get a fresh step budget
  _fresh() { this.steps = 0; this.halted = false; }
  _step() {
    if (++this.steps <= SBX_LIMIT || this.halted) return;
    this.halted = true;
    this._log({ kind: 'note', warn: true, text: T('sbx_loop', { n: SBX_LIMIT }) });
    this.stopAll();
    throw SBX_CANCEL;
  }
  stopAll() {
    this.runs.forEach((list) => list.slice().forEach((r) => this._cancel(r)));
    this.queue.clear();
  }
  // ---- start: arm the time and template triggers
  async start() {
    this._fresh();
    const not = [];
    this.items.forEach((it) => { if (it.kind === 'automation') this._trigs(it).forEach((t) => { const p = this._plat(t); if (t.enabled !== false && !SBX_PLATS.has(p) && !this._espec(p)) not.push(`${this._name(it.id)}: ${p}`); }); });
    if (not.length) this._log({ kind: 'note', text: T('sbx_not_followed', { list: [...new Set(not)].join(', ') }) });
    toList(this.o.notes).forEach((text) => this._log({ kind: 'note', text: String(text) }));
    if (this.mq.size) this._log({ kind: 'note', text: T('sbx_mqtt_list', { list: [...this.mq.keys()].map((id) => this._name(id)).join(', ') }) });
    if (this.follow.size) this._log({ kind: 'note', text: T('sbx_follows_list', { list: [...this.follow].map(([id, f]) => this._name(id) + (f.rule.partly ? ' ' + T('sbx_follows_partly') : '')).join(', ') }) });
    this.items.forEach((it) => { if (it.kind === 'automation') this._trigs(it).forEach((t, i) => { this._armTime(it, t, i); this._armSun(it, t, i); }); });
    this._armSunState();
    for (const it of this.items.values()) {
      if (it.kind !== 'automation') continue;
      const ts = this._trigs(it);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i];
        if (this._plat(t) === 'template' && t.enabled !== false) {
          const r = await this.o.tpl(String(t.value_template), this._vars(null), this);
          this.tplLast.set(it.id + '#' + i, r.ok ? asBool(r.value) : null);
        }
      }
    }
  }
  _trigs(it) { return this._asTrigs(it.cfg.triggers != null ? it.cfg.triggers : it.cfg.trigger); }
  // a list of triggers, a device one on an entity as the trigger it stands for, an MQTT device one as the MQTT
  // trigger it is (0.13.0); the same object each time
  _asTrigs(list) {
    return toList(list).filter((t) => t && typeof t === 'object').map((t) => {
      if ((t.trigger || t.platform) !== 'device') return t;
      if (!this.devT.has(t)) this.devT.set(t, sbxDevTrig(t, this.o.entityOf) || sbxDevMqtt(t, this.o.devMqtt) || sbxDevZwave(t) || t);
      return this.devT.get(t);
    });
  }
  _plat(t) { return t.trigger || t.platform; }
  _on(it) { const s = this.get(it.id); return !s || s.state !== 'off'; }
  // ---- what the person does
  async userSet(id, state, attrs) {
    this._fresh();
    const s = this.get(id);
    await new Promise((r) => { this._task(async () => { await this.setState(id, state == null ? (s ? s.state : '') : String(state), attrs || {}, null, true); r(); }); });
    await this.settle();
  }
  async userEvent(type, data) {
    this._fresh();
    this._task(() => this.fireEvent(type, data || {}, null, true));
    await this.settle();
  }
  // run it as if one of its triggers fired (ti), or with none
  async userRun(id, checkConds, ti, vars) {
    this._fresh();
    const it = this.items.get(id);
    if (!it) return;
    if (it.kind === 'script') {
      const cause = this._log({ kind: 'trigger', key: id, text: T('sbx_run_by_you'), by: 'you', src: null });
      this._start(it, Object.assign({}, vars || {}), cause, { conds: checkConds });
      await this.settle();
      return;
    }
    const t = ti != null && it.kind === 'automation' ? this._trigs(it)[ti] : null;
    let trigger = { platform: null, id: 'manual', idx: 'manual' };
    if (t) {
      const p = this._plat(t), spec = this._espec(p);
      trigger = { platform: p, id: t.id != null ? String(t.id) : String(ti), idx: String(ti) };
      const ents = p === 'state' || p === 'numeric_state' || p === 'zone' ? toList(t.entity_id) : spec ? this._etargets(t, spec) : [];
      const e = ents.find((x) => typeof x === 'string');
      if (e) { const o = this.obj(e); Object.assign(trigger, { entity_id: e, from_state: o, to_state: o }); }
      if (p === 'event') trigger.event = { event_type: toList(t.event_type)[0], data: t.event_data || {} };
      if (p === 'mqtt') Object.assign(trigger, { topic: t.topic, payload: t.payload != null ? String(t.payload) : '' });
      if (p === 'time' || p === 'time_pattern') trigger.now = this.iso();
      if (p === 'homeassistant' || p === 'sun' || p === 'zone' || p === 'calendar') trigger.event = t.event || (p === 'sun' ? 'sunrise' : p === 'calendar' ? 'start' : p === 'zone' ? 'enter' : 'start');
      if (p === 'webhook') Object.assign(trigger, { webhook_id: t.webhook_id, json: {}, data: {}, query: {} });
      if (p === 'tag') trigger.tag_id = toList(t.tag_id)[0];
      if (p === 'conversation') Object.assign(trigger, { sentence: String(toList(t.command)[0] || ''), slots: {}, details: {} });
    }
    const src = trigger.entity_id || (trigger.event && trigger.event.event_type ? 'event:' + trigger.event.event_type : trigger.topic ? 'mqtt:' + trigger.topic : null)
      || (t && toList(t.entity_id).find((x) => typeof x === 'string' && EXACT_RE.test(x))) || null;
    const cause = this._log({ kind: 'trigger', key: id, text: t ? T('sbx_run_as', { n: ti + 1, p: this._plat(t) }) : T('sbx_run_by_you'), by: 'you', src });
    this._start(it, { trigger }, cause, { conds: checkConds });
    await this.settle();
  }
  // ---- the other things that start automations (0.11.1), each done by you from the drawer
  // fire every enabled trigger of the function's automations that `hit(t)` says this is, with what `tv(t)` gives
  async _userTrig(log, hit, tv) {
    this._fresh();
    await new Promise((r) => {
      this._task(async () => {
        const lid = this._log(Object.assign({ by: 'you' }, log));
        await this._dispatch(async () => {
          const ws = this._listening();
          for (const it of this.items.values()) {
            if (it.kind !== 'automation' || !this._on(it)) continue;
            const ts = this._trigs(it);
            for (let i = 0; i < ts.length; i++) {
              const t = ts[i];
              if (t.enabled === false) continue;
              const v = hit(t, it);
              if (v) await this._fire(it, i, Object.assign({ platform: this._plat(t) }, typeof v === 'object' ? v : {}, tv ? tv(t) : {}), lid);
            }
          }
          ws().forEach((w) => w.onOther && w.onOther(hit, tv, lid));
        });
        r();
      });
    });
    await this.settle();
  }
  // Home Assistant starting or shutting down
  userHA(event) {
    return this._userTrig({ kind: 'did', key: 'ha:' + event, text: (event === 'shutdown' ? T('sbx_ha_stops') : T('sbx_ha_starts')) },
      (t) => this._plat(t) === 'homeassistant' && (t.event || 'start') === event, () => ({ event }));
  }
  // a webhook called: its JSON body (or form data) and query
  userWebhook(id, body, method) {
    const json = body && typeof body === 'object' ? body : {};
    return this._userTrig({ kind: 'did', key: 'webhook:' + id, text: T('sbx_webhook_called', { id }), data: json },
      (t) => this._plat(t) === 'webhook' && String(t.webhook_id) === String(id) && (!t.allowed_methods || toList(t.allowed_methods).map((x) => String(x).toUpperCase()).includes(String(method || 'POST').toUpperCase())),
      () => ({ webhook_id: id, json, data: json, query: {} }));
  }
  // an NFC tag scanned (and Home Assistant's tag_scanned event, which other triggers may wait for)
  async userTag(tag, device) {
    await this._userTrig({ kind: 'did', key: 'tag:' + tag, text: T('sbx_tag_scanned', { tag }) },
      (t) => this._plat(t) === 'tag' && toList(t.tag_id).map(String).includes(String(tag)) && (t.device_id == null || toList(t.device_id).includes(device)),
      () => ({ tag_id: tag, device_id: device || null }));
    this._fresh();
    this._task(() => this.fireEvent('tag_scanned', Object.assign({ tag_id: tag }, device ? { device_id: device } : {}), null, false));
    await this.settle();
  }
  // a calendar event starting or ending (the trigger's offset is the sandbox clock's to move)
  userCalendar(ent, event, summary) {
    const ev = { summary: summary || T('sbx_cal_summary'), start: this.iso(), end: this.iso(this.now + 3600000), all_day: false, description: '', location: '' };
    return this._userTrig({ kind: 'did', key: ent, text: (event === 'end' ? T('sbx_cal_ends', { name: this._name(ent), summary: ev.summary }) : T('sbx_cal_starts', { name: this._name(ent), summary: ev.summary })) },
      (t) => this._plat(t) === 'calendar' && String(t.entity_id) === ent && (t.event || 'start') === event, () => ({ event, calendar_event: ev, offset: '0:00:00' }));
  }
  // a sentence said to Assist: the conversation triggers it matches, with their slots
  userSay(said) {
    return this._userTrig({ kind: 'did', key: 'say:', text: T('sbx_said', { s: said }) },
      (t) => { if (this._plat(t) !== 'conversation') return null; for (const c of toList(t.command)) { const slots = sbxSentence(c).match(said); if (slots) return { sentence: said, slots, details: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, text: v, value: v }])), device_id: null, user_input: { text: said } }; } return null; });
  }
  // an integration's own device trigger (a ZHA or Z-Wave button, a Hue remote), or any trigger the sandbox has no
  // way to see coming (Z-Wave value updated, a KNX telegram, geo location): fired by you, every trigger that is it,
  // as it's configured
  // A device's own trigger (0.13.0) need not be one an automation here uses: any the device has, with the settings
  // you chose (a scene button's key held), starts every trigger it satisfies. An MQTT device's is the message it
  // stands for, sent on its topic (sbxMqttSend)
  userPress(key) {
    let pick = null;
    try { pick = JSON.parse(key); } catch (e) { pick = null; }
    if (!pick || typeof pick !== 'object') pick = {};
    const dev = typeof pick.device_id === 'string' ? pick.device_id : null;
    const def = dev && pick.domain === 'mqtt' ? sbxMqDef(pick, this.o.devMqtt) : null;
    if (def) return this._pressMqtt(pick, def);
    // a Z-Wave scene button or Notification: the event the integration fires for it
    if (dev && pick.domain === 'zwave_js' && /^event\./.test(String(pick.type))) return this._pressZwave(pick);
    let label = '';
    this.items.forEach((it) => { if (it.kind === 'automation') this._trigs(it).forEach((t) => { if (sbxPressKey(t) === key) label = label || this._pressText(t); }); });
    if (!label && dev) label = this._pressText(Object.assign({ trigger: 'device' }, pick));
    const own = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => !SBX_DEV_SKIP.has(k)));
    return this._userTrig({ kind: 'did', key: dev ? 'device:' + dev : 'press:', text: T('sbx_pressed', { what: label || key }) },
      (t) => this._plat(t) !== 'state' && !t._mq && sbxPressHits(t, pick), (t) => Object.assign(own(t), (this._plat(t) === 'device' ? own(pick) : {})));
  }
  async _pressZwave(pick) {
    const t = sbxDevZwave(Object.assign({ trigger: 'device' }, pick)), ed = Object.assign({}, t.event_data), z = this.zw.get(pick.device_id);
    const what = this._pressText(Object.assign({ trigger: 'device' }, pick));
    // a scene button of a node whose values are known: as that value's notification, the event entity with it
    const v = z && t.event_type === 'zwave_js_value_notification' && [...z.byId.values()].find((x) => x.cc === ed.command_class && (x.endpoint || 0) === (ed.endpoint || 0) && String(x.property) === String(ed.property) && String(x.property_key) === String(ed.property_key));
    this._fresh();
    await new Promise((r) => {
      this._task(async () => {
        const lid = this._log({ kind: 'did', by: 'you', key: 'device:' + pick.device_id, text: T('sbx_pressed', { what }) });
        if (v) await this._zwNotify(pick.device_id, v, ed.value_raw, lid);
        else {
          if (ed.value_raw !== undefined) ed.value = ed.value_raw;
          // the node's own fields when they're known (its labels aren't: they come with the report)
          const node = z ? { node_id: z.node, home_id: z.home, endpoint: 0 } : {};
          if (t.event_type === 'zwave_js_notification' && ed.command_class === 113) node.command_class_name = 'Notification';
          await this.fireEvent(t.event_type, Object.assign({ domain: 'zwave_js' }, node, ed), lid);
        }
        r();
      });
    });
    await this.settle();
  }
  // ---- Z-Wave values (0.13.0): a value reported by a node, as Home Assistant hears it
  userZwave(dev, id, raw) {
    this._fresh();
    return new Promise((r) => { this._task(async () => { try { await this._zwave(dev, id, raw, null, true); } finally { r(); } }); }).then(() => this.settle());
  }
  _zwName(dev, v) { return `${this._name('device:' + dev)}: ${v.label || v.property_key_name || v.property_name || v.property}${v.endpoint ? ' (' + T('sbx_zw_ep', { n: v.endpoint }) + ')' : ''}`; }
  _zwBase(dev, v) {
    const z = this.zw.get(dev);
    return { domain: 'zwave_js', node_id: z.node, home_id: z.home, home_id_hex: typeof z.home === 'number' ? '0x' + z.home.toString(16).padStart(8, '0') : null, endpoint: v.endpoint || 0, device_id: dev, command_class: v.cc, command_class_name: v.cc_name };
  }
  async _zwave(dev, id, raw, cause, byYou) {
    const z = this.zw.get(dev), v = z && z.byId.get(id);
    if (!v) return null;
    // a stateless value (a scene button) is a notification, not a new value
    if (v.stateful === false || v.cc === 91 || v.cc === 43) {
      const lid = this._log({ kind: 'did', by: byYou ? 'you' : null, cause, key: 'device:' + dev, text: T('sbx_zw_sent', { what: this._zwName(dev, v), value: String(sbxZwLabel(v, raw)) }) });
      await this._zwNotify(dev, v, raw, lid);
      return lid;
    }
    const k = dev + '|' + id, prev = this.zwv.has(k) ? this.zwv.get(k) : v.value;
    const lid = this._log({ kind: 'did', by: byYou ? 'you' : null, cause, key: 'device:' + dev, text: T('sbx_zw_did', { what: this._zwName(dev, v), value: String(sbxZwLabel(v, raw)) }) });
    // (a Notification value is a state, door open or closed: Z-Wave JS updates the value and fires no notification
    // event for it, so neither does the sandbox. An event-type Notification, a keypad unlock, has no value: it's
    // pressed on the Press row, as the trigger that waits for it)
    this.zwv.set(k, raw);
    // the entities that show it follow, as Home Assistant's Z-Wave platforms work them out
    for (const [eid, sk] of v.entities || []) {
      if (!this.get(eid)) continue;
      const st = sbxZwState(eid, v, raw, sk);
      if (st == null) this._log({ kind: 'note', key: eid, text: T('sbx_zw_left', { name: this._name(eid) }) });
      else await this.setState(eid, st, null, lid);
    }
    const label = sbxZwLabel(v, raw), plabel = sbxZwLabel(v, prev);
    const hit = (t) => {
      if (this._plat(t) !== 'zwave_js.value_updated') return null;
      const devs = toList(t.device_id).map(String), ents = toList(t.entity_id).map(String);
      if (!devs.includes(dev) && !ents.some((e) => this.o.devOf && this.o.devOf(e) === dev)) return null;
      if (sbxZwId(z.node, sbxZwInt(t.command_class), sbxZwInt(t.endpoint), sbxZwInt(t.property), sbxZwInt(t.property_key)) !== v.id) return null;
      if (!sbxZwMatch(t.from, plabel, prev) || !sbxZwMatch(t.to, label, raw)) return null;
      return Object.assign({ platform: 'zwave_js.value_updated', device_id: dev, node_id: z.node, command_class: v.cc, command_class_name: v.cc_name, property: v.property, property_name: v.property_name,
        endpoint: t.endpoint == null ? null : sbxZwInt(t.endpoint), property_key: v.property_key, property_key_name: v.property_key_name,
        previous_value: plabel, previous_value_raw: prev, current_value: label, current_value_raw: raw, description: `Z-Wave value ${v.id} updated on ${this._name('device:' + dev)}` });
    };
    await this._dispatch(async () => {
      const ws = this._listening();
      for (const it of this.items.values()) {
        if (it.kind !== 'automation' || !this._on(it)) continue;
        const ts = this._trigs(it);
        for (let i = 0; i < ts.length; i++) {
          if (ts[i].enabled === false) continue;
          const tv = hit(ts[i]);
          if (tv) await this._fire(it, i, tv, lid);
        }
      }
      ws().forEach((w) => w.onOther && w.onOther(hit, null, lid));
    });
    return lid;
  }
  // a value notification: the zwave_js_value_notification event, then the event entity that shows the value
  async _zwNotify(dev, v, raw, cause) {
    const label = sbxZwLabel(v, raw);
    await this.fireEvent('zwave_js_value_notification', Object.assign(this._zwBase(dev, v), { label: v.label, property: v.property, property_name: v.property_name, property_key: v.property_key, property_key_name: v.property_key_name, value: label, value_raw: raw }), cause);
    for (const [eid] of v.entities || []) {
      const cur = this.get(eid);
      if (eid.startsWith('event.') && cur && raw != null) await this.setState(eid, this.iso(), Object.assign({}, cur.attributes || {}, { event_type: String(label), value: raw }), cause);
    }
  }
  async _pressMqtt(pick, def) {
    const send = sbxMqttSend(def.payload, def.value_template);
    this._fresh();
    await new Promise((r) => {
      this._task(async () => {
        const lid = this._log({ kind: 'did', by: 'you', key: 'device:' + def.device_id, text: T('sbx_pressed', { what: this._pressText(Object.assign({ trigger: 'device' }, pick)) }) });
        if (!send.exact) this._log({ kind: 'note', key: 'mqtt:' + def.topic, text: T('sbx_mqtt_press_as_is', { topic: def.topic, payload: send.payload }) });
        await this.mqtt(def.topic, send.payload, lid, false, send.exact ? null : sbxMqKey(def));
        r();
      });
    });
    await this.settle();
  }
  _pressText(t) {
    if (this._plat(t) === 'device') {
      // the choices it's set to: named by the device's list when the board has it, else as they're set (a Z-Wave
      // Notification's type and event)
      const more = (this.o.pressMore ? this.o.pressMore(t) : '') || Object.entries(t).filter(([k, v]) => !SBX_DEV_SKIP.has(k) && k[0] !== '_' && !SBX_DEV_IDENT.has(k) && v != null && typeof v !== 'object').map(([k, v]) => `${k.replace(/\.$/, '')} ${v}`).join(', ');
      const what = [t.type, t.subtype].filter((x) => x != null && x !== '').map((x, i) => (i === 0 ? String(x).split('.').pop() : String(x)).replace(/_/g, ' ')).concat(more ? [more] : []).join(' · ');
      return `${t.device_id ? this._name('device:' + t.device_id) : t.domain}: ${what || t.domain}`;
    }
    const rest = Object.entries(t).filter(([k, v]) => !SBX_DEV_SKIP.has(k) && v != null && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(', ');
    return shorten(`${this._plat(t)}${rest ? ': ' + rest : ''}`, 90);
  }
  // a service call made by you (a kept test button, say): done on the sandbox like one in a script
  async userCall(svc, data, ids) {
    this._fresh();
    const run = { item: { id: null, cfg: {}, kind: 'script' }, vars: {}, cause: null, timers: new Set(), done: false };
    await new Promise((r) => { this._task(async () => { try { await this._call(svc, { action: svc, data: data || {}, target: { entity_id: ids } }, run); } finally { r(); } }); });
    await this.settle();
  }
  // ---- states and events
  // how.whole: attrs are all the attributes (not added to the old); how.now: handed out at once, inside the handing
  // out in progress (an MQTT entity's write, which Home Assistant makes as it hands out the message)
  async setState(id, state, attrs, cause, byYou, follows, how) {
    const old = this.get(id), was = old ? old.state : null, h = how || {};
    const A = h.whole ? Object.assign({}, attrs || {}) : Object.assign({}, old ? old.attributes : {}, attrs || {});
    // a cover's opened and closed triggers read is_closed
    if (id.startsWith('cover.') && !(attrs && 'is_closed' in attrs) && ['open', 'closed', 'opening', 'closing'].includes(state)) A.is_closed = state === 'closed';
    const sameAttrs = canon(A) === canon(old ? old.attributes : {});
    if (old && was === state && sameAttrs) {
      if (byYou) this._log({ kind: 'note', key: id, text: T('sbx_already', { name: this._name(id), state }) });
      return null;
    }
    const nu = { state, attributes: A, last_changed: was === state && old ? old.last_changed : this.iso(), last_updated: this.iso() };
    this.changed.set(id, nu);
    const lid = this._log({ kind: 'state', key: id, from: was, to: state, cause, by: byYou ? 'you' : null, follows: follows || null });
    if (h.now && this.dispatching) await this._onState(id, old, nu, lid);
    else await this._dispatch(() => this._onState(id, old, nu, lid));
    return lid;
  }
  async fireEvent(type, data, cause, byYou) {
    const lid = this._log({ kind: 'event', key: 'event:' + type, text: type, data, cause, by: byYou ? 'you' : null });
    const ev = { event_type: type, data: data || {} };
    await this._dispatch(async () => {
      const ws = this._listening();
      for (const it of this.items.values()) {
        if (it.kind !== 'automation' || !this._on(it)) continue;
        const ts = this._trigs(it);
        for (let i = 0; i < ts.length; i++) {
          const t = ts[i];
          if (t.enabled === false || this._plat(t) !== 'event') continue;
          if (!toList(t.event_type).includes(type) || !subsetOf(t.event_data, data)) continue;
          await this._fire(it, i, { platform: 'event', event: ev }, lid);
        }
      }
      ws().forEach((w) => w.onEvent && w.onEvent(ev, lid));
    });
    return lid;
  }
  // an MQTT message: the triggers on its topic (+ and # wildcards), and a publish in a script reaches them too
  async _mqttMatch(t, msg) {
    if (!t.topic || !sbxTopic(t.topic, msg.topic)) return false;
    if (t.payload == null || (msg.forced && t._mq === msg.forced)) return true;
    let v = msg.payload;
    if (t.value_template) { const r = await this.o.tpl(String(t.value_template), { value: msg.payload, value_json: msg.payload_json }, this); v = r.ok ? r.value : undefined; }
    return String(v) === String(t.payload);
  }
  // forced (0.13.0): an MQTT device trigger pressed whose value template couldn't be read backwards starts anyway
  async mqtt(topic, payload, cause, byYou, forced) {
    const text = typeof payload === 'string' ? payload : payload == null ? '' : JSON.stringify(payload);
    let pj = null;
    try { pj = JSON.parse(text); } catch (e) { /* not JSON */ }
    const msg = { topic: String(topic), payload: text, payload_json: pj, qos: 0 };
    if (forced) Object.defineProperty(msg, 'forced', { value: forced });
    const lid = this._log({ kind: 'mqtt', key: 'mqtt:' + msg.topic, text: msg.topic, payload: text, cause, by: byYou ? 'you' : null });
    await this._dispatch(async () => {
      const ws = this._listening();
      for (const it of this.items.values()) {
        if (it.kind !== 'automation' || !this._on(it)) continue;
        const ts = this._trigs(it);
        for (let i = 0; i < ts.length; i++) {
          if (ts[i].enabled !== false && this._plat(ts[i]) === 'mqtt' && await this._mqttMatch(ts[i], msg)) await this._fire(it, i, Object.assign({ platform: 'mqtt' }, msg), lid);
        }
      }
      // then the MQTT entities on the topic: Home Assistant writes their states once every subscriber has had the
      // message, one after another, each handed out as it's written (found by the differential test): the
      // triggers' runs saw them as they were, and what starts on the first sees the second as it was
      await this._mqttEnts(msg, lid);
      ws().forEach((w) => w.onMqtt && w.onMqtt(msg, lid));
    });
    return lid;
  }
  async userMqtt(topic, payload) {
    this._fresh();
    this._task(() => this.mqtt(topic, payload, null, true));
    await this.settle();
  }
  // ---- MQTT entities following their topics (0.11.3): availability, then attributes, then the state, as each
  // entity subscribed to them; each that changes the entity writes its state
  _mqMem(id, f) {
    if (f.mem) return f.mem;
    const cur = this.get(id), r = f.rule, off = cur && cur.state === 'unavailable';
    const avail = {};
    ((r.avail && r.avail.list) || []).forEach((a) => { avail[a.topic] = !off; });
    f.mem = { st: off ? 'unknown' : cur ? cur.state : 'unknown', attrs: {}, avail, latest: !off, expired: false, extra: [] };
    return f.mem;
  }
  _mqOn(f) {
    const m = f.mem, r = f.rule;
    if (m.expired) return false;
    if (!r.avail) return true;
    const vals = r.avail.list.map((a) => m.avail[a.topic]);
    return r.avail.mode === 'all' ? vals.every(Boolean) : r.avail.mode === 'any' ? vals.some(Boolean) : m.latest;
  }
  async _mqRender(tpl, msg, id) {
    if (!tpl) return { ok: true, value: msg.payload };
    const vars = { value: msg.payload, entity_id: id, name: this._name(id) };
    if (msg.payload_json != null) vars.value_json = msg.payload_json;
    const r = await this.o.tpl(String(tpl), vars, this, { raw: true });
    if (!r || !r.ok) return { ok: false, err: r && r.err };
    return { ok: true, value: r.value == null ? '' : typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value) };
  }
  // the entity as it shows now: its own state, or unavailable
  async _mqWrite(id, f, lid) {
    const m = f.mem, on = this._mqOn(f);
    if (on && m.st === SBX_MQ_BAD) return;
    const A = Object.assign({}, (this.get(id) || {}).attributes || {});
    m.extra.forEach((k) => { delete A[k]; });
    Object.assign(A, m.attrs);
    await this.setState(id, on ? m.st : 'unavailable', A, lid, false, lid ? 'mqtt:' + f.topic : null, { whole: true, now: !!lid });
  }
  async _mqttEnts(msg, lid) {
    // each entity that wants its state written, in the order they asked; Home Assistant writes them last first
    // (its write requests are a dict it pops), each handed out as it's written (found by the differential test).
    // Of two entities on one topic, which asks first changes from one start of Home Assistant to the next (its
    // subscriptions come in no fixed order): here, the one set up first
    const writes = [];
    const want = (id, f) => { if (!writes.some((w) => w[0] === id)) writes.push([id, f]); };
    for (const [id, f] of this.mq) {
      const r = f.rule, hit = (t) => t && sbxTopic(String(t), msg.topic);
      if (!(r.avail && r.avail.list.some((a) => hit(a.topic))) && !(r.attrs && hit(r.attrs.topic)) && !(r.state && hit(r.state.topic)) && !(r.position && hit(r.position.topic))) continue;
      const m = this._mqMem(id, f);
      f.topic = msg.topic;
      const said = (e) => { if (!f.said) { f.said = true; this._log({ kind: 'note', key: id, warn: true, text: T('sbx_mqtt_tpl_failed', { name: this._name(id), e: e || '' }) }); } };
      if (r.avail) {
        let changed = false;
        for (const a of r.avail.list) {
          if (!hit(a.topic)) continue;
          const v = await this._mqRender(a.tpl, msg, id);
          if (!v.ok) { said(v.err); continue; }
          if (v.value === a.on) { m.avail[a.topic] = true; m.latest = true; changed = true; } else if (v.value === a.off) { m.avail[a.topic] = false; m.latest = false; changed = true; }
        }
        if (changed) want(id, f);
      }
      if (r.attrs && hit(r.attrs.topic)) {
        const v = await this._mqRender(r.attrs.tpl, msg, id);
        let o = null;
        if (v.ok) { try { o = JSON.parse(v.value); } catch (e) { o = null; } } else said(v.err);
        if (o && typeof o === 'object' && !Array.isArray(o)) {
          const keep = Object.fromEntries(Object.entries(o).filter(([k]) => !SBX_MQ_BLOCKED.has(k)));
          m.extra = Object.keys(m.attrs); m.attrs = keep;
          want(id, f);
        }
      }
      if (r.state && hit(r.state.topic)) {
        const sub = r.state;
        if (r.expire_after) {
          m.expired = false;
          this.timers.filter((x) => x.slot === 'expire:' + id).forEach((x) => this._drop(x));
          this._at(this.now + r.expire_after * 1000, () => this._task(async () => { m.expired = true; await this._mqWrite(id, f, null); }), null, T('sbx_mqtt_expire', { name: this._name(id) }), id).slot = 'expire:' + id;
        }
        const v = await this._mqRender(sub.tpl, msg, id);
        if (!v.ok) { said(v.err); continue; }
        let out = null;
        if (sub.how === 'event') {
          const ev = sbxMqttEvent(sub, v.value, msg);
          if (ev) { m.extra = Object.keys(m.attrs); m.attrs = Object.assign({ event_type: ev[0] }, ev[1]); out = [this.iso(), {}]; }
        } else out = sbxMqttState(sub, v.value, { state: m.st, attributes: (this.get(id) || {}).attributes || {} }, msg);
        if (out) {
          m.st = out[0];
          if (r.off_delay != null) {
            this.timers.filter((x) => x.slot === 'offdelay:' + id).forEach((x) => this._drop(x));
            if (m.st === 'on') this._at(this.now + r.off_delay * 1000, () => this._task(async () => { m.st = 'off'; await this._mqWrite(id, f, null); }), null, T('sbx_mqtt_off_delay', { name: this._name(id) }), id).slot = 'offdelay:' + id;
          }
        }
        if (out || r.expire_after) want(id, f);
      }
      if (r.position && hit(r.position.topic)) {
        const v = await this._mqRender(r.position.tpl, msg, id);
        if (!v.ok) { said(v.err); continue; }
        let pos = v.value;
        try { const o = JSON.parse(pos); if (o && typeof o === 'object' && !Array.isArray(o)) { if (!('position' in o)) continue; pos = o.position; } } catch (e) { /* a number */ }
        const n = pyNumber(pos);
        if (pos === '' || pos == null || n == null) continue;
        const closed = r.position.closed, open = r.position.open;
        if (open === closed) continue;
        const pct = Math.min(100, Math.max(0, Math.round(((n - closed) * 100) / (open - closed))));
        m.attrs = Object.assign({}, m.attrs, { current_position: pct });
        if (!r.position.state) m.st = pct === 0 ? 'closed' : 'open';
        want(id, f);
      }
    }
    for (const [id, f] of writes.reverse()) await this._mqWrite(id, f, lid);
  }
  _sval(t, s) { return s == null ? null : t.attribute != null ? s.attributes[t.attribute] : s.state; }
  _stateMatch(t, id, old, nu) {
    if (!toList(t.entity_id).includes(id)) return false;
    const ov = this._sval(t, old), nv = this._sval(t, nu), any = t.from === undefined && t.to === undefined && t.not_from === undefined && t.not_to === undefined && t.attribute == null;
    if (!any && old && canon(ov) === canon(nv)) return false;
    const inList = (v, l) => toList(l).map(String).includes(String(v));
    if (t.from != null && !inList(ov, t.from)) return false;
    if (t.not_from != null && inList(ov, t.not_from)) return false;
    if (t.to != null && !inList(nv, t.to)) return false;
    if (t.not_to != null && inList(nv, t.not_to)) return false;
    return true;
  }
  // a numeric_state trigger's value, or null when it isn't a number
  async _numVal(t, id, s, run) {
    if (!s) return null;
    if (t.value_template) {
      const r = await this.o.tpl(String(t.value_template), Object.assign(this._vars(run), { state: this.obj(id) }), this);
      const v = r.ok ? parseFloat(r.value) : NaN;
      return isFinite(v) ? v : null;
    }
    const v = parseFloat(this._sval(t, s));
    return isFinite(v) ? v : null;
  }
  _limit(x) {
    if (x == null) return null;
    if (typeof x === 'number') return x;
    if (EXACT_RE.test(String(x))) { const s = this.get(String(x)); const v = s ? parseFloat(s.state) : NaN; return isFinite(v) ? v : null; }
    const v = parseFloat(x);
    return isFinite(v) ? v : null;
  }
  _inRange(t, v) {
    if (v == null) return false;
    const a = this._limit(t.above), b = this._limit(t.below);
    return (t.above == null || (a != null && v > a)) && (t.below == null || (b != null && v < b));
  }
  async _onState(id, old, nu, lid) {
    // the waits listening when the change happened: a run this change starts doesn't hear it in its own wait
    const ws = this._listening();
    // helpers that follow this one first, as Home Assistant's are set up before its automations: what the automations
    // read sees them changed (their own changes are handed out after this one)
    await this._follow(id, lid);
    // a `for:` waiting on this entity: still matching, or let go
    for (const [k, p] of [...this.pend]) {
      if (p.id == null || p.id !== id) continue;
      if (!(await p.still(nu))) { this._drop(p.timer); this.pend.delete(k); }
    }
    for (const it of this.items.values()) {
      if (it.kind !== 'automation' || !this._on(it)) continue;
      const ts = this._trigs(it);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i], p = this._plat(t);
        if (t.enabled === false) continue;
        if (p === 'state' && this._stateMatch(t, id, old, nu)) {
          const vars = { platform: 'state', entity_id: id, from_state: old ? this.obj0(id, old) : null, to_state: this.obj0(id, nu) };
          const nv = this._sval(t, nu);
          await this._fireFor(it, i, t, vars, lid, id, async (s) => canon(this._sval(t, s)) === canon(nv));
        } else if (p === 'numeric_state' && toList(t.entity_id).includes(id)) {
          const was = this._inRange(t, await this._numVal(t, id, old));
          const now = this._inRange(t, await this._numVal(t, id, nu));
          if (!was && now) {
            const vars = { platform: 'numeric_state', entity_id: id, from_state: old ? this.obj0(id, old) : null, to_state: this.obj0(id, nu), above: t.above, below: t.below };
            await this._fireFor(it, i, t, vars, lid, id, async (s) => this._inRange(t, await this._numVal(t, id, s)));
          }
        } else if (p === 'template' && this._reads(t.value_template, id)) {
          await this._tplTrig(it, i, t, lid);
        } else if (this._espec(p) && this._eFires(this._espec(p), t, id, old, nu)) {
          const spec = this._espec(p), vars = { platform: p, entity_id: id, from_state: old ? this.obj0(id, old) : null, to_state: this.obj0(id, nu) };
          await this._fireFor(it, i, Object.assign({}, t, { for: (t.options || {}).for }), vars, lid, id, async (st) => this._eValid(spec, t, id, st));
        } else if (p === 'time' && toList(t.at).includes(id)) {
          this._armTime(it, t, i);
        } else if (p === 'zone' && this._zoneHit(t, id, old, nu)) {
          await this._fire(it, i, { platform: 'zone', entity_id: id, from_state: old ? this.obj0(id, old) : null, to_state: this.obj0(id, nu), zone: this.obj(String(t.zone)), event: t.event || 'enter' }, lid);
        }
      }
    }
    ws().forEach((w) => w.onState && w.onState(id, old, nu, lid));
  }
  // a followed helper's state now, or null (as it is; a template that can't be rendered says so once)
  async _followed(id, f, changed) {
    if (f.rule.kind !== 'template') return sbxFollow(f.rule, (x) => this.get(x), f.mem, changed);
    const r = await this.o.tpl(String(f.rule.state), this._vars(null), this);
    if (!r || !r.ok) {
      if (!f.said) { f.said = true; this._log({ kind: 'note', key: id, warn: true, text: T('sbx_follow_failed', { name: this._name(id), e: (r && r.err) || '' }) }); }
      return null;
    }
    const v = r.value;
    if (id.startsWith('binary_sensor.')) return [asBool(v) ? 'on' : 'off', {}];
    return [v == null ? 'unknown' : typeof v === 'object' ? JSON.stringify(v) : String(v), {}];
  }
  async _follow(id, lid) {
    for (const d of this.feeds.get(id) || []) {
      const f = this.follow.get(d), out = await this._followed(d, f, id);
      if (out) await this.setState(d, out[0], out[1], lid, false, id);
    }
  }
  // every followed helper worked out from scratch and set as it is, with nothing told (a home set up from nothing:
  // the differential test)
  async followAll() {
    for (const [, f] of this.follow) f.mem = {};
    const limit = this.follow.size + 1;
    for (let pass = 0; pass < limit; pass++) {
      let moved = false;
      for (const [id, f] of this.follow) {
        const out = await this._followed(id, f, null);
        if (!out) continue;
        const old = this.get(id), A = Object.assign({}, old ? old.attributes : {}, out[1]);
        if (old && old.state === out[0] && canon(A) === canon(old.attributes || {})) continue;
        this.changed.set(id, { state: out[0], attributes: A, last_changed: this.iso(), last_updated: this.iso() });
        moved = true;
      }
      if (!moved) break;
    }
  }
  // the waits listening now; later, those of them still waiting
  _listening() { const ws = [...this.waiters]; return () => ws.filter((w) => this.waiters.has(w)); }
  // ---- zones: a person or tracker is in one when its state is the zone's name ("home" for zone.home)
  _zoneName(z) {
    if (z == null) return null;
    const id = String(z);
    if (id === 'zone.home') return 'home';
    const s = this.get(id);
    return s && s.attributes && s.attributes.friendly_name ? String(s.attributes.friendly_name) : id.split('.')[1];
  }
  _zoneHit(t, id, old, nu) {
    if (!toList(t.entity_id).includes(id)) return false;
    const name = this._zoneName(t.zone), was = !!old && old.state === name, is = !!nu && nu.state === name;
    return (t.event || 'enter') === 'leave' ? was && !is : !was && is;
  }
  // ---- the sun: sun.sun follows the sandbox clock (its next rising and setting, a day apart after that), and sun
  // triggers fire at sunrise or sunset plus their offset
  _sunAt(ev, from) {
    const s = this.get('sun.sun'), A = (s && s.attributes) || {}, base = Date.parse(ev === 'sunset' ? A.next_setting : A.next_rising);
    if (!isFinite(base)) return null;
    let at = base;
    while (at > from + 86400000) at -= 86400000;
    while (at <= from) at += 86400000;
    return at;
  }
  _armSun(it, t, i) {
    if (t.enabled === false || this._plat(t) !== 'sun') return;
    const key = 'sun:' + it.id + '#' + i, ev = t.event === 'sunset' ? 'sunset' : 'sunrise', off = durMs(t.offset) || 0;
    this.timers.filter((x) => x.slot === key).forEach((x) => this._drop(x));
    const base = this._sunAt(ev, this.now - off);
    if (base == null) return;
    this._at(base + off, () => {
      if (this._on(it)) this._task(() => this._fire(it, i, { platform: 'sun', event: ev, offset: t.offset != null ? t.offset : 0 }, null));
      this._armSun(it, t, i);
    }, null, T('sbx_sun_label', { name: this._name(it.id), ev: (ev === 'sunset' ? T('sbx_sunset') : T('sbx_sunrise')) }), it.id).slot = key;
  }
  // sun.sun is moved at sunrise and sunset only when something here reads it (an automation, a script or a helper
  // that follows it): otherwise every day would add two changes nothing hears (0.11.3)
  _readsSun() {
    const has = (x) => { try { return JSON.stringify(x).includes('sun.sun'); } catch (e) { return false; } };
    return [...this.items.values()].some((it) => has(it.cfg)) || [...this.follow.values()].some((f) => toList(f.reads).includes('sun.sun') || has(f.rule));
  }
  _armSunState() {
    if (!this.get('sun.sun') || !this._readsSun()) return;
    this.timers.filter((x) => x.slot === 'sun:state').forEach((x) => this._drop(x));
    const r = this._sunAt('sunrise', this.now), st = this._sunAt('sunset', this.now);
    if (r == null || st == null) return;
    const up = r < st, at = Math.min(r, st);
    this._at(at, () => this._task(async () => {
      const nr = this._sunAt('sunrise', at), ns = this._sunAt('sunset', at);
      await this.setState('sun.sun', up ? 'above_horizon' : 'below_horizon', Object.assign({ rising: up }, nr ? { next_rising: this.iso(nr) } : {}, ns ? { next_setting: this.iso(ns) } : {}), null);
      this._armSunState();
    }), null, (up ? T('sbx_sunrise') : T('sbx_sunset')), 'sun.sun').slot = 'sun:state';
  }
  // today's sunrise or sunset on the sandbox clock (the one on its local date)
  _sunToday(ev) {
    const at = this._sunAt(ev, this.now - 86400000);
    if (at == null) return null;
    const day = (ms) => { const p = tzParts(ms, this.tz); return p.y * 10000 + p.mo * 100 + p.d; };
    let x = at;
    while (day(x) > day(this.now)) x -= 86400000;
    while (day(x) < day(this.now)) x += 86400000;
    return x;
  }
  // ---- Home Assistant's per-entity triggers, by the rules of its trigger classes
  _espec(p) { return typeof p === 'string' ? SBX_ETRIG_OWN[p] || SBX_ETRIG[p] || null : null; }
  _excludeSet(ex) {
    const drop = new Set();
    if (!ex || typeof ex !== 'object') return drop;
    toList(ex.entity_id).forEach((x) => { if (typeof x === 'string') x.split(',').map((s) => s.trim()).filter((s) => EXACT_RE.test(s)).forEach((s) => drop.add(s)); });
    ['area_id', 'floor_id', 'label_id', 'device_id'].forEach((k) => toList(ex[k]).forEach((x) => {
      if (typeof x === 'string' && this.o.resolve) this.o.resolve((k === 'device_id' ? 'device' : k.slice(0, -3)) + ':' + x).forEach((e) => drop.add(e));
    }));
    return drop;
  }
  _etargets(t, spec) {
    const tg = t.target || {}, out = new Set(), direct = new Set();
    toList(tg.entity_id).forEach((x) => { if (typeof x === 'string' && EXACT_RE.test(x)) { out.add(x); direct.add(x); } });
    ['area_id', 'floor_id', 'label_id', 'device_id'].forEach((k) => toList(tg[k]).forEach((x) => {
      if (typeof x === 'string' && this.o.resolve) this.o.resolve((k === 'device_id' ? 'device' : k.slice(0, -3)) + ':' + x).forEach((e) => out.add(e));
    }));
    this._excludeSet(tg.exclude).forEach((e) => out.delete(e));
    return [...out].filter((id) => {
      const ds = spec.d[id.split('.')[0]];
      if (!ds) return false;
      if (direct.has(id) || !ds.dc) return true;
      const st = this.get(id);
      return !!st && ds.dc.includes(st.attributes.device_class);
    });
  }
  _eval(spec, id, st) {
    if (!st) return undefined;
    const ds = spec.d[id.split('.')[0]] || {};
    if (!ds.attr) return st.state;
    const v = st.attributes[ds.attr];
    if (v == null && ds.attr === 'is_closed') return st.state === 'closed' ? true : ['open', 'opening', 'closing'].includes(st.state) ? false : null;
    return v;
  }
  _eThr(t, v) {
    if (v == null || !isFinite(v)) return false;
    const th = (t.options || {}).threshold || {}, type = th.type || 'any';
    const lim = (c) => (c == null ? null : typeof c === 'number' ? c : c.number != null ? parseFloat(c.number) : c.entity ? this._limit(c.entity) : null);
    if (type === 'any') return true;
    if (type === 'above') { const l = lim(th.value); return l != null && v > l; }
    if (type === 'below') { const l = lim(th.value); return l != null && v < l; }
    const a = lim(th.value_min), b = lim(th.value_max);
    if (a == null || b == null) return false;
    const btw = a <= v && v <= b;
    return type === 'between' ? btw : !btw;
  }
  _eValid(spec, t, id, st) {
    if (!st) return false;
    const v = this._eval(spec, id, st), has = (l, x) => toList(l).some((y) => y === x || String(y) === String(x));
    switch (spec.k) {
      case 'target': case 'transition': return has(spec.to, v);
      case 'origin': return String(v) !== String(toList(spec.from)[0]);
      case 'stateless':
        if (spec.evt === 'options') return has((t.options || {}).event_type, st.attributes.event_type);
        return Array.isArray(spec.evt) ? spec.evt.includes(st.attributes.event_type) : true;
      case 'num_changed': case 'num_crossed': { const n = parseFloat(v); return this._eThr(t, isFinite(n) ? n : null); }
      case 'cover': { const ds = spec.d[id.split('.')[0]] || {}; return v === ds.tv || String(v) === String(ds.tv); }
      case 'counter': {
        const n = parseFloat(st.state), A = st.attributes || {};
        if (spec.op === 'max') return n === parseFloat(A.maximum);
        if (spec.op === 'min') return n === parseFloat(A.minimum);
        if (spec.op === 'reset') return n === parseFloat(A.initial == null ? 0 : A.initial);
        return true;
      }
      default: return true;
    }
  }
  _eTrans(spec, t, id, old, nu) {
    if (!old || !nu || ['unavailable', 'unknown'].includes(nu.state)) return false;
    if ((spec.k === 'stateless' ? ['unavailable'] : ['unavailable', 'unknown']).includes(old.state)) return false;
    const a = this._eval(spec, id, old), b = this._eval(spec, id, nu), same = canon(a) === canon(b), has = (l, x) => toList(l).some((y) => String(y) === String(x));
    switch (spec.k) {
      case 'target': return !same && !has(spec.to, a);
      case 'transition': return !same && has(spec.from, a);
      case 'origin': { const f = String(toList(spec.from)[0]); return String(a) === f && String(b) !== f; }
      case 'stateless': case 'changed': return old.state !== nu.state;
      case 'num_changed': return !same;
      case 'num_crossed': return !this._eValid(spec, t, id, old);
      case 'cover': return a != null && !same;
      case 'counter': {
        const x = parseFloat(old.state), y = parseFloat(nu.state);
        if (!isFinite(x) || !isFinite(y)) return false;
        return spec.op === 'up' ? y > x : spec.op === 'down' ? y < x : x !== y;
      }
      default: return false;
    }
  }
  // does this change fire this per-entity trigger, by its behavior (each, first, all)
  _eFires(spec, t, id, old, nu) {
    const ents = this._etargets(t, spec);
    if (!ents.includes(id) || !this._eTrans(spec, t, id, old, nu) || !this._eValid(spec, t, id, nu)) return false;
    const beh = (t.options || {}).behavior || 'each';
    const others = ents.filter((e) => e !== id).map((e) => [e, this.get(e)]).filter(([, st]) => st && !['unavailable', 'unknown'].includes(st.state));
    if (beh === 'first' || beh === 'any_first') return !others.some(([e, st]) => this._eValid(spec, t, e, st));
    if (beh === 'all' || beh === 'last') return others.every(([e, st]) => this._eValid(spec, t, e, st));
    return true;
  }
  obj0(id, s) { return { entity_id: id, state: s.state, attributes: s.attributes, last_changed: s.last_changed, last_updated: s.last_updated }; }
  // does a template read this entity (or read states broadly, so it might)
  _reads(tpl, id) { const s = String(tpl || ''); return s.includes(id) || /\bexpand\b|states\s*[|[]|states\.[a-z_]+\s*[|)]|\bstates\.[a-z_]+\s*$/.test(s); }
  async _fireFor(it, i, t, vars, lid, id, still) {
    const key = it.id + '#' + i + '#' + id;
    const old = this.pend.get(key);
    if (old) { this._drop(old.timer); this.pend.delete(key); }
    if (t.for == null) { await this._fire(it, i, vars, lid); return; }
    let ms = durMs(t.for);
    if (ms == null && TPL_RE.test(String(t.for))) { const r = await this.o.tpl(String(t.for), this._vars(null), this); ms = r.ok ? durMs(r.value) : null; }
    if (ms == null && typeof t.for === 'object') { const r = await this._render(t.for, null); ms = durMs(r); }
    if (ms == null) ms = 0;
    vars.for = fmtDur(ms);
    const timer = this._at(this.now + ms, () => { this.pend.delete(key); this._task(() => this._fire(it, i, vars, lid)); }, null, T('sbx_for_label', { name: this._name(it.id), d: fmtDur(ms) }), it.id);
    this.pend.set(key, { id, timer, still });
  }
  async _tplTrig(it, i, t, lid) {
    const k = it.id + '#' + i, r = await this.o.tpl(String(t.value_template), this._vars(null), this);
    const v = r.ok ? asBool(r.value) : null, was = this.tplLast.get(k), pk = 'tpl:' + k;
    this.tplLast.set(k, v);
    // with for:, it must stay true that long; false again lets the wait go
    if (v !== true) { const p = this.pend.get(pk); if (p) { this._drop(p.timer); this.pend.delete(pk); } return; }
    if (was !== false) return;
    const vars = { platform: 'template', entity_id: null };
    let ms = t.for != null ? durMs(typeof t.for === 'object' ? t.for : TPL_RE.test(String(t.for)) ? (await this.o.tpl(String(t.for), {}, this)).value : t.for) : null;
    if (ms == null || ms <= 0) { await this._fire(it, i, vars, lid, r.partly); return; }
    vars.for = fmtDur(ms);
    const timer = this._at(this.now + ms, () => { this.pend.delete(pk); this._task(() => this._fire(it, i, vars, lid, r.partly)); }, null, T('sbx_for_label', { name: this._name(it.id), d: fmtDur(ms) }), it.id);
    this.pend.set(pk, { id: null, timer, still: async () => true });
  }
  async _timeTemplates() {
    for (const it of this.items.values()) {
      if (it.kind !== 'automation' || !this._on(it)) continue;
      const ts = this._trigs(it);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i];
        if (t.enabled !== false && this._plat(t) === 'template' && /\b(now|utcnow|today_at)\s*\(/.test(String(t.value_template))) await this._tplTrig(it, i, t, null);
      }
    }
  }
  // time triggers: the next time each `at` comes round, on the sandbox clock
  _timeAt(at, from) {
    if (EXACT_RE.test(String(at))) {
      const s = this.get(String(at));
      if (!s) return null;
      if (String(at).startsWith('input_datetime.')) {
        const A = s.attributes || {};
        if (A.has_time === false) return null;
        if (A.has_date) { const ms = Date.parse(String(s.state).replace(' ', 'T')); return isFinite(ms) && ms > from ? ms : null; }
        const hms = parseHMS(s.state);
        if (!hms) return null;
        let t = localAt(from, hms, this.tz);
        if (t <= from) t = localAt(from + 86400000, hms, this.tz);
        return t;
      }
      const ms = Date.parse(s.state);
      return isFinite(ms) && ms > from ? ms : null;
    }
    const hms = parseHMS(at);
    if (!hms) return null;
    let t = localAt(from, hms, this.tz);
    if (t <= from) t = localAt(from + 86400000, hms, this.tz);
    return t;
  }
  _armTime(it, t, i) {
    const p = this._plat(t);
    if (t.enabled === false || (p !== 'time' && p !== 'time_pattern')) return;
    const key = 'time:' + it.id + '#' + i;
    this.timers.filter((x) => x.slot === key).forEach((x) => this._drop(x));
    let at = null, label = '';
    if (p === 'time') {
      toList(t.at).forEach((a) => { const x = this._timeAt(a, this.now); if (x != null && (at == null || x < at)) at = x; });
      label = T('sbx_time_label', { name: this._name(it.id) });
    } else { at = this._patternNext(t, this.now); label = T('sbx_pattern_label', { name: this._name(it.id) }); }
    if (at == null) return;
    this._at(at, () => {
      const wd = t.weekday ? toList(t.weekday) : null, ok = !wd || wd.includes(WD[tzParts(this.now, this.tz).wd]);
      if (ok && this._on(it)) this._task(() => this._fire(it, i, { platform: p, now: this.iso() }, null));
      this._armTime(it, t, i);
    }, null, label, it.id).slot = key;
  }
  _patternNext(t, from) {
    const f = (v, dflt) => {
      if (v == null) v = dflt;
      const s = String(v).trim();
      if (s === '*') return () => true;
      const m = /^\/(\d+)$/.exec(s);
      if (m) return (n) => n % (+m[1]) === 0;
      return (n) => n === +s;
    };
    let { hours: h, minutes: mi, seconds: s } = t;
    if (mi == null && h != null) mi = 0;
    if (s == null && mi != null) s = 0;
    const H = f(h, '*'), M = f(mi, '*'), S = f(s, '*'), off0 = tzOffset(from, this.tz);
    let w = Math.floor((from + off0) / 1000) * 1000 + 1000;
    for (let i = 0; i < 200000; i++, w += 1000) {
      const d = new Date(w);
      if (!H(d.getUTCHours())) { w += (3599 - d.getUTCMinutes() * 60 - d.getUTCSeconds()) * 1000; continue; }
      if (!M(d.getUTCMinutes())) { w += (59 - d.getUTCSeconds()) * 1000; continue; }
      if (!S(d.getUTCSeconds())) continue;
      // convert local wall-clock w back to UTC, recalculating tzOffset across DST boundaries
      let cand = w - tzOffset(w - off0, this.tz);
      cand = w - tzOffset(cand, this.tz);
      if (cand <= from) continue;
      const p = tzParts(cand, this.tz);
      if (p.h === d.getUTCHours() && p.mi === d.getUTCMinutes() && p.s === d.getUTCSeconds()) return cand;
    }
    return null;
  }
  // ---- runs
  _name(id) { return this.o.name ? this.o.name(id) : id; }
  _vars(run) { return run ? Object.assign({}, run.vars) : {}; }
  _active(id) { return (this.runs.get(id) || []).filter((r) => !r.done); }
  running(id) { return this._active(id).length > 0; }
  async _fire(it, i, tv, cause, partly) {
    const t = this._trigs(it)[i] || {};
    const trigger = Object.assign({ id: t.id != null ? String(t.id) : String(i), idx: String(i) }, tv);
    const lid = this._log({ kind: 'trigger', key: it.id, text: this._trigText(t, trigger), ent: trigger.entity_id || null, to: trigger.to_state ? trigger.to_state.state : null, cause, partly, vars: this._snap({ trigger }) });
    this.fired.add(it.id + '#' + i);
    // a state trigger with From and no To fires on a change into a state it lists under From: from [off, on] starts
    // on off → on and on → off alike. Said once it happens, as a fact; it may be meant (0.11.1)
    const from = t.from == null ? [] : toList(t.from).map(String), to = trigger.to_state ? String(trigger.to_state.state) : null;
    if (this._plat(t) === 'state' && from.length && t.to == null && t.not_to == null && t.attribute == null && trigger.from_state && to != null && from.includes(to)) {
      this._log({ kind: 'note', key: it.id, cause: lid, warn: true, pk: 't_both|' + it.id, text: T('sbx_from_into', { name: this._name(it.id), ent: this._name(trigger.entity_id), to, from: from.join(', ') }) });
    }
    // handing out the change waits until this trigger stops: its conditions failed, or its run got as far as it goes
    // at once, or either waits for the person
    const stop = {};
    stop.p = new Promise((res) => { stop.res = res; });
    this._start(it, { trigger }, lid, { conds: true, stop });
    await stop.p;
  }
  _trigText(t, tv) {
    const p = this._plat(t);
    if (p === 'state' || p === 'numeric_state') return T('sbx_trig_state', { name: this._name(tv.entity_id), state: tv.to_state ? tv.to_state.state : '' });
    if (p === 'event' && t._zw) return T('sbx_pressed', { what: this._pressText(t._dev) });
    if (p === 'event') return T('sbx_trig_event', { type: tv.event.event_type });
    if (p === 'time' || p === 'time_pattern') return T('sbx_trig_time');
    if (p === 'template') return T('sbx_trig_template');
    if (p === 'zone') { const name = this._name(tv.entity_id), zone = this._name(String(t.zone)); return tv.event === 'leave' ? T('sbx_trig_zone_leave', { name, zone }) : T('sbx_trig_zone_enter', { name, zone }); }
    if (p === 'sun') return tv.event === 'sunset' ? T('sbx_sunset') : T('sbx_sunrise');
    if (p === 'homeassistant') return tv.event === 'shutdown' ? T('sbx_ha_stops') : T('sbx_ha_starts');
    if (p === 'webhook') return T('sbx_webhook_called', { id: tv.webhook_id });
    if (p === 'tag') return T('sbx_tag_scanned', { tag: tv.tag_id });
    if (p === 'calendar') { const name = this._name(String(t.entity_id)), summary = (tv.calendar_event || {}).summary || ''; return tv.event === 'end' ? T('sbx_cal_ends', { name, summary }) : T('sbx_cal_starts', { name, summary }); }
    if (p === 'conversation') return T('sbx_said', { s: tv.sentence });
    if (p === 'zwave_js.value_updated' && tv.current_value !== undefined) return T('sbx_zw_trig', { what: this._zwName(tv.device_id, this.zw.get(tv.device_id).byId.get(sbxZwId(tv.node_id, tv.command_class, tv.endpoint, tv.property, tv.property_key)) || { property: tv.property }), value: String(tv.current_value) });
    if (p === 'device' || !SBX_PLATS.has(p)) return T('sbx_pressed', { what: this._pressText(t) });
    // an MQTT device trigger (0.13.0): the device's button, whichever way its message came
    if (p === 'mqtt' && t._mq) return T('sbx_pressed', { what: this._pressText(t._dev) });
    return String(p || '');
  }
  _start(it, vars, cause, opt) {
    opt = opt || {};
    // an automation: its variables and conditions first (_triggered); the promise of the run, or null
    if (it.kind === 'automation' && !opt.checked) return this._task(() => this._triggered(it, vars, cause, opt));
    const cfg = it.cfg, mode = cfg.mode || 'single', max = cfg.max || 10, act = this._active(it.id);
    const restarting = mode === 'restart' && act.length > 0;
    if (act.length) {
      if (mode === 'single') { this._log({ kind: 'note', key: it.id, cause, text: T('sbx_single', { name: this._name(it.id) }) }); return null; }
      if (mode === 'restart') act.forEach((r) => { this._cancel(r); this._log({ kind: 'note', key: it.id, cause, text: T('sbx_restart') }); });
      // max counts every run, the queued ones too (Home Assistant's queued mode: one running and max − 1 waiting)
      else if (act.length + (mode === 'queued' ? (this.queue.get(it.id) || []).length : 0) >= max) { this._log({ kind: 'note', key: it.id, cause, warn: true, text: T('sbx_max', { mode, max }) }); return null; }
      else if (mode === 'queued') {
        const q = this.queue.get(it.id) || [];
        q.push([vars, cause, opt]); this.queue.set(it.id, q);
        this._log({ kind: 'note', key: it.id, cause, text: T('sbx_queued') });
        return null;
      }
    }
    // t0: when it started (an automation's last_triggered, to compare with a replay from history)
    const run = { item: it, vars: Object.assign({ this: this.obj(it.id) }, vars), cause, timers: new Set(), done: false, cancelled: false, t0: this.now };
    this._moving(run);
    const list = this.runs.get(it.id) || [];
    list.push(run); this.runs.set(it.id, list);
    const go = () => { run.promise = this._task(() => this._run(run, opt || {})); };
    // restarted: it waits for the old run to stop, so it starts after the work in hand (_later), and a restart
    // meanwhile (another trigger of the same change) cancels it before it does anything
    if (restarting && (this.dispatching || this.round)) { this._parked(run); this._later(() => { this._moving(run); go(); }); } else go();
    return run;
  }
  // an automation triggered (0.11.2, Home Assistant's order, found by the differential test): its variables and
  // conditions are looked at first, and only then does its mode look at the runs already going, so a trigger whose
  // conditions fail restarts nothing and a queued run keeps what its conditions said when it was triggered. When a
  // trigger is looked at is the event bus's business (_dispatch).
  async _triggered(it, vars, cause, opt) {
    const stopped = () => { if (opt.stop) opt.stop.res(); };
    if (this.halted) { stopped(); return null; }
    // parkRes: a condition waiting for the person (stepping) counts as stopped
    const cfg = it.cfg, run = { item: it, vars: Object.assign({ this: this.obj(it.id) }, vars), cause, timers: new Set(), done: false, cancelled: false, parkRes: opt.stop ? opt.stop.res : null };
    try {
      if (cfg.variables) Object.assign(run.vars, await this._render(cfg.variables, run));
      if (opt.conds !== false) {
        for (const c of toList(cfg.conditions != null ? cfg.conditions : cfg.condition)) {
          const r = await this._condStep(c, run);
          if (!r.ok) { this._log({ kind: 'run', key: it.id, outcome: 'stopped', why: T('sbx_cond_stopped'), cause, vars: this._snap(run.vars) }); stopped(); return null; }
        }
      }
    } catch (e) {
      stopped();
      if (e === SBX_CANCEL) return null;
      this._log({ kind: 'run', key: it.id, outcome: 'error', why: (e && e.message) || String(e), cause, vars: this._snap(run.vars) });
      return null;
    }
    if (this.halted) { stopped(); return null; }
    const r = this._start(it, run.vars, cause, Object.assign({}, opt, { checked: true, stop: null }));
    if (r) r.parkP.then(stopped); else stopped();
    return r;
  }
  // Home Assistant's event bus (0.11.2, found by the differential test): a state change or an event made while
  // another is being handed out waits in a queue until that one is done, and is then handed out in turn. Handing one
  // out means every trigger it fires, in order, each automation's run going as far as it goes at once (to its first
  // wait, an MQTT publish, or its end; a restarted run not at all: _later) before the next trigger is looked at. So a run started by a change that changes something
  // its own automation triggers on has ended by the time that trigger is looked at (and runs again), while a run
  // going on after a delay changes it outside any handing out, so the trigger is looked at at once, with the run
  // still going (and single mode drops it). A wait that a change satisfies goes on once the handing out is done.
  async _dispatch(fn) {
    if (this.dispatching) { this.evq.push(fn); return; }
    this.dispatching = true;
    try {
      await fn();
      while (this.evq.length) await this.evq.shift()();
    } finally {
      this.dispatching = false;
      const later = this.after.splice(0);
      later.forEach((go) => go());
    }
  }
  // a run on the move (started, or going on after a wait), and stopped at a wait or its end: handing out a change
  // waits for the runs it starts to stop (_fire)
  _moving(run) { if (run && (run.parked || !run.parkP)) { run.parked = false; run.parkP = new Promise((res) => { run.parkRes = res; }); } }
  _parked(run) { if (run && run.parkRes && !run.parked) { run.parked = true; run.parkRes(); } }
  _cancel(run) {
    if (run.done) return;
    run.cancelled = true;
    [...run.timers].forEach((t) => { this._drop(t); if (t.rej) t.rej(SBX_CANCEL); });
    [...this.waiters].forEach((w) => { if (w.run === run) { this.waiters.delete(w); w.rej(SBX_CANCEL); } });
    [...this.paused].forEach(([lid, p]) => { if (p.run === run) this.resume(lid); });
  }
  async _run(run, opt) {
    const it = run.item, cfg = it.cfg;
    let outcome = 'finished', why = '';
    try {
      // the run's context (0.11.3) is there for its actions, as in Home Assistant: not yet for an automation's
      // variables and conditions, nor a script's own variables (Home Assistant renders those first)
      if (it.kind === 'automation') {
        // its variables and conditions were looked at when it was triggered (_triggered)
        run.vars.context = this._ctx();
        await this._seq(toList(cfg.actions != null ? cfg.actions : cfg.action), run);
      } else {
        if (cfg.variables) Object.assign(run.vars, await this._render(cfg.variables, run));
        run.vars.context = this._ctx();
        await this._seq(toList(cfg.sequence), run);
      }
    } catch (e) {
      if (e === SBX_CANCEL) { outcome = 'cancelled'; }
      else if (e === SBX_COND_FAIL) { outcome = 'stopped'; why = T('sbx_cond_stopped'); }
      else if (e && e.stop) { outcome = e.error ? 'error' : 'stopped'; why = e.text || ''; }
      else { outcome = 'error'; why = (e && e.message) || String(e); }
    } finally {
      run.done = true;
      this._parked(run);
      const list = (this.runs.get(it.id) || []).filter((r) => r !== run);
      this.runs.set(it.id, list);
      if (outcome !== 'cancelled' || !this.halted) this._log({ kind: 'run', key: it.id, outcome, why, cause: run.cause, vars: this._snap(run.vars), started: run.t0 });
      const q = this.queue.get(it.id);
      if (q && q.length && !this.halted) { const [v, c, o] = q.shift(); this._start(it, v, c, o); }
      if (run.onDone) run.onDone(outcome);
    }
  }
  // ---- templates and conditions
  async _tpl(s, run) {
    const r = await this.o.tpl(String(s), this._vars(run), this);
    return r;
  }
  async _render(v, run) {
    if (typeof v === 'string') {
      if (!TPL_RE.test(v)) return v;
      const r = await this._tpl(v, run);
      if (r.ok) return r.value;
      const a = await this._ask({ text: T('sbx_ask_value', { t: shorten(v, 80) }), value: true, run });
      return a;
    }
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await this._render(x, run)); return out; }
    if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await this._render(x, run); return out; }
    return v;
  }
  async _ask(q) {
    const lid = this._log({ kind: 'ask', key: q.run ? q.run.item.id : null, text: q.text, cause: q.run ? q.run.cause : null });
    this.busy--;
    let a;
    try { a = await this.o.ask(Object.assign({ lid }, q)); } finally { this.busy++; }
    const e = this.log.find((x) => x.id === lid);
    if (e) { e.answer = a; if (this.o.onLog) this.o.onLog(e, true); }
    return a;
  }
  // one condition as a step of its own (logged), true or false
  async _condStep(c, run) {
    const text = this.o.condText ? this.o.condText(c) : '';
    await this._gate(run, T('sbx_pause_cond', { what: text }));
    const r = await this._cond(c, run);
    if (c && typeof c === 'object') { const x = this.cres.get(c) || { t: false, f: false }; if (r.ok) x.t = true; else x.f = true; this.cres.set(c, x); }
    this._log({ kind: 'cond', key: run.item.id, ok: r.ok, text, why: r.why || '', partly: r.partly, cause: run.cause, ents: sbxReads(c), vars: this._snap(run.vars) });
    return r;
  }
  async _conds(list, run) {
    for (const c of toList(list)) { const r = await this._condStep(c, run); if (!r.ok) return r; }
    return { ok: true };
  }
  async _cond(c, run) {
    this._step();
    if (c == null) return { ok: true };
    if (typeof c === 'string') return this._tplCond(c, run);
    if (Array.isArray(c)) {
      let partly = null;
      for (const x of c) { const r = await this._cond(x, run); if (r.partly) partly = (partly || []).concat(r.partly); if (!r.ok) return Object.assign({}, r, { partly }); }
      return { ok: true, partly };
    }
    if (typeof c !== 'object' || c.enabled === false) return { ok: true };
    if (typeof c.condition === 'string' && TPL_RE.test(c.condition)) return this._tplCond(c.condition, run);  // condition: "{{ … }}"
    const type = c.condition || (c.and ? 'and' : c.or ? 'or' : c.not ? 'not' : null);
    const subs = () => toList(c.conditions != null ? c.conditions : c[type]);
    const all = async (want) => {
      let partly = null;
      for (const x of subs()) {
        const r = await this._cond(x, run);
        if (r.partly) partly = (partly || []).concat(r.partly);
        if (r.ok === want) return { hit: true, r, partly };
      }
      return { hit: false, partly };
    };
    switch (type) {
      case 'and': { const x = await all(false); return x.hit ? Object.assign({}, x.r, { partly: x.partly }) : { ok: true, partly: x.partly }; }
      case 'or': { const x = await all(true); return x.hit ? { ok: true, partly: x.partly } : { ok: false, why: T('sbx_none_true'), partly: x.partly }; }
      case 'not': { const x = await all(true); return x.hit ? { ok: false, why: T('sbx_not_true'), partly: x.partly } : { ok: true, partly: x.partly }; }
      case 'state': {
        const ents = toList(c.entity_id), any = c.match === 'any', want = toList(c.state);
        const one = (id) => {
          const s = this.get(id);
          if (!s) return false;
          const v = c.attribute != null ? s.attributes[c.attribute] : s.state;
          const ok = want.some((w) => { const ws = String(w); const ref = EXACT_RE.test(ws) && this.get(ws); return String(v) === (ref ? ref.state : ws) || canon(v) === canon(w); });
          if (!ok) return false;
          const f = c.for != null ? durMs(c.for) : null;
          return f == null || this.now - Date.parse(s.last_changed) >= f;
        };
        const res = ents.map(one), ok = ents.length ? (any ? res.some(Boolean) : res.every(Boolean)) : false;
        return { ok, why: ok ? '' : ents.map((id) => `${this._name(id)}: ${(this.get(id) || {}).state}`).join(', ') };
      }
      case 'numeric_state': {
        const ents = toList(c.entity_id), vals = [];
        for (const id of ents) vals.push(await this._numVal(c, id, this.get(id), run));
        const ok = ents.length > 0 && vals.every((v) => this._inRange(c, v));
        return { ok, why: ok ? '' : ents.map((id, i) => `${this._name(id)}: ${vals[i] == null ? (this.get(id) || {}).state : vals[i]}`).join(', ') };
      }
      case 'template': return this._tplCond(String(c.value_template), run);
      case 'time': {
        const p = tzParts(this.now, this.tz), sec = p.h * 3600 + p.mi * 60 + p.s;
        const tod = (v) => {
          if (v == null) return null;
          if (EXACT_RE.test(String(v))) {
            const s = this.get(String(v));
            if (!s) return null;
            const hm = parseHMS(String(s.state).split(' ').pop()) || (isFinite(Date.parse(s.state)) ? (() => { const q = tzParts(Date.parse(s.state), this.tz); return [q.h, q.mi, q.s]; })() : null);
            return hm ? hm[0] * 3600 + hm[1] * 60 + hm[2] : null;
          }
          const hm = parseHMS(v);
          return hm ? hm[0] * 3600 + hm[1] * 60 + hm[2] : null;
        };
        const a = tod(c.after), b = tod(c.before);
        let ok = true;
        if (a != null && b != null) ok = a <= b ? sec >= a && sec < b : sec >= a || sec < b;
        else if (a != null) ok = sec >= a;
        else if (b != null) ok = sec < b;
        if (c.weekday) ok = ok && toList(c.weekday).includes(WD[p.wd]);
        return { ok, why: ok ? '' : T('sbx_it_is', { t: `${WD[p.wd]} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}` }) };
      }
      case 'zone': {
        const ents = toList(c.entity_id), zones = toList(c.zone).map((z) => this._zoneName(z));
        const ok = ents.length > 0 && ents.every((id) => { const st = this.get(id); return !!st && zones.includes(st.state); });
        return { ok, why: ok ? '' : ents.map((id) => `${this._name(id)}: ${(this.get(id) || {}).state}`).join(', ') };
      }
      case 'sun': {
        const at = (ev, off) => { const x = this._sunToday(ev); return x == null ? null : x + (durMs(off) || 0); };
        const b = c.before ? at(c.before, c.before_offset) : null, a = c.after ? at(c.after, c.after_offset) : null;
        if ((c.before && b == null) || (c.after && a == null)) break;
        // before sunrise or after sunset is one or the other, as Home Assistant has it
        // (after is from the moment itself: in Home Assistant the check runs a moment after what set it off)
        const ok = c.before === 'sunrise' && c.after === 'sunset' ? this.now < b || this.now >= a : (b == null || this.now < b) && (a == null || this.now >= a);
        const hm = (x) => { const q = tzParts(x, this.tz); return `${String(q.h).padStart(2, '0')}:${String(q.mi).padStart(2, '0')}`; };
        return { ok, why: T('sbx_sun_why', { now: hm(this.now), what: [a != null ? T('sbx_sun_after', { t: hm(a) }) : '', b != null ? T('sbx_sun_before', { t: hm(b) }) : ''].filter(Boolean).join(', ') }) };
      }
      case 'device': {
        const x = sbxDevCond(c, this.o.entityOf);
        if (x) return this._cond(x, run);
        break;
      }
      case 'trigger': {
        const id = run.vars.trigger ? String(run.vars.trigger.id) : null;
        const ok = toList(c.id).map(String).includes(id);
        return { ok, why: ok ? '' : T('sbx_trig_was', { id: id == null ? '—' : id }) };
      }
      default: break;
    }
    const a = await this._ask({ text: T('sbx_ask_cond', { c: this.o.condText ? this.o.condText(c) : String(type) }), run });
    return { ok: !!a, why: T('sbx_you_said', { a: a ? T('sbx_true') : T('sbx_false') }) };
  }
  async _tplCond(s, run) {
    const r = await this._tpl(s, run);
    if (r.ok) return { ok: asBool(r.value), why: T('sbx_tpl_gave', { v: shorten(typeof r.value === 'string' ? r.value : JSON.stringify(r.value), 40) }), partly: r.partly && r.partly.length ? r.partly : null };
    const a = await this._ask({ text: T('sbx_ask_tpl', { t: shorten(s, 80), e: r.err || '' }), run });
    return { ok: !!a, why: T('sbx_you_said', { a: a ? T('sbx_true') : T('sbx_false') }) };
  }
  // ---- actions
  async _seq(list, run) {
    for (const a of toList(list)) {
      if (run.cancelled) throw SBX_CANCEL;
      await this._act(a, run);
    }
  }
  async _act(a, run) {
    if (a == null || (typeof a === 'object' && a.enabled === false)) return;
    if (Array.isArray(a)) return this._seq(a, run);
    if (typeof a !== 'object') return;
    this._step();
    if (!(typeof a.condition === 'string' || a.and || a.or || a.not)) await this._gate(run, T('sbx_pause_act', { what: this.o.actText ? this.o.actText(a) : Object.keys(a)[0] }));
    this.hit.add(a);
    try { await this._act1(a, run); } catch (e) {
      if (e === SBX_CANCEL || e === SBX_COND_FAIL || (e && e.stop)) throw e;
      if (a.continue_on_error && !(e && e.cfg)) { this._log({ kind: 'note', key: run.item.id, cause: run.cause, text: T('sbx_err_continue', { e: (e && e.message) || String(e) }) }); return; }
      throw e;
    }
  }
  async _act1(a, run) {
    const svc = typeof a.action === 'string' ? a.action : typeof a.service === 'string' ? a.service : null;
    if (svc) return this._call(svc, a, run);
    if (a.delay !== undefined) {
      let ms = durMs(typeof a.delay === 'object' ? a.delay : await this._render(a.delay, run));
      if (ms == null && typeof a.delay === 'object') ms = durMs(await this._render(a.delay, run));
      if (ms == null) ms = 0;
      this._log({ kind: 'wait', key: run.item.id, cause: run.cause, text: T('sbx_delay', { d: fmtDur(ms) }) });
      await this._sleep(ms, run, T('sbx_delay_label', { name: this._name(run.item.id), d: fmtDur(ms) }));
      return;
    }
    if (a.wait_template !== undefined) return this._waitTpl(a, run);
    if (a.wait_for_trigger !== undefined) return this._waitTrig(a, run);
    if (typeof a.condition === 'string' || a.and || a.or || a.not) {
      const r = await this._condStep(a, run);
      if (!r.ok) throw SBX_COND_FAIL;
      return;
    }
    if (a.choose !== undefined) {
      for (const opt of toList(a.choose)) {
        const r = await this._conds(opt.conditions, run);
        if (r.ok) { if (opt && typeof opt === 'object') this.hit.add(opt); return this._seq(opt.sequence, run); }
      }
      if (a.default) { this._mark(a, 'default'); return this._seq(a.default, run); }
      return;
    }
    if (a.if !== undefined) {
      const r = await this._conds(a.if, run);
      if (r.ok) { this._mark(a, 'then'); return this._seq(a.then, run); }
      if (a.else) { this._mark(a, 'else'); return this._seq(a.else, run); }
      return;
    }
    if (a.repeat) return this._repeat(a.repeat, run);
    if (a.sequence !== undefined) { try { await this._seq(a.sequence, run); } catch (e) { if (e !== SBX_COND_FAIL) throw e; } return; }
    if (a.parallel !== undefined) {
      const branches = toList(a.parallel);
      const out = await Promise.allSettled(branches.map((b) => this._seq(b && b.sequence !== undefined ? b.sequence : b, run).catch((e) => { if (e !== SBX_COND_FAIL) throw e; })));
      const bad = out.find((x) => x.status === 'rejected');
      if (bad) throw bad.reason;
      return;
    }
    if (a.variables) { Object.assign(run.vars, await this._render(a.variables, run)); return; }
    if (a.stop !== undefined) {
      const text = String(await this._render(a.stop, run) || '');
      this._log({ kind: 'note', key: run.item.id, cause: run.cause, text: T('sbx_stop', { t: text }) });
      throw Object.assign({}, SBX_STOP, { text, error: !!a.error });
    }
    if (a.event !== undefined) {
      const type = String(await this._render(a.event, run)), data = await this._render(a.event_data || {}, run);
      const cid = this._log({ kind: 'call', key: run.item.id, cause: run.cause, svc: T('sbx_fires', { type }), ents: ['event:' + type] });
      await this.fireEvent(type, data, cid);
      return;
    }
    if (a.scene !== undefined) return this._call('scene.turn_on', { target: { entity_id: a.scene } }, run);
    if (a.device_id && a.domain && a.type) {
      const x = sbxDevAct(a, this.o.entityOf);
      if (x) return this._call(x[0], { data: x[1], target: { entity_id: x[2] } }, run);
      this._log({ kind: 'call', key: run.item.id, cause: run.cause, svc: T('sbx_device_act', { type: a.type }), ents: ['device:' + a.device_id], unknown: true });
      return;
    }
    if (a.set_conversation_response !== undefined) return;
    this._log({ kind: 'note', key: run.item.id, cause: run.cause, text: T('sbx_unknown_step', { k: Object.keys(a).join(', ') }) });
  }
  // a branch taken (an if's then or else, a choose's default), for coverage
  _mark(a, branch) { const x = this.cres.get(a) || {}; x[branch] = true; this.cres.set(a, x); }
  async _repeat(r, run) {
    const outer = run.vars.repeat;
    const body = async (i, item) => {
      run.vars.repeat = Object.assign({ index: i + 1, first: i === 0 }, item !== undefined ? { item } : {});
      await this._seq(r.sequence, run);
    };
    try {
      if (r.count != null) {
        const n = parseInt(await this._render(r.count, run), 10) || 0;
        for (let i = 0; i < n; i++) { run.vars.repeat = { index: i + 1, first: i === 0, last: i === n - 1 }; await this._seq(r.sequence, run); }
      } else if (r.for_each != null) {
        const items = toList(await this._render(r.for_each, run));
        for (let i = 0; i < items.length; i++) { run.vars.repeat = { index: i + 1, first: i === 0, last: i === items.length - 1, item: items[i] }; await this._seq(r.sequence, run); }
      } else if (r.while != null) {
        for (let i = 0; ; i++) { run.vars.repeat = { index: i + 1, first: i === 0 }; if (!(await this._conds(r.while, run)).ok) break; await body(i); }
      } else if (r.until != null) {
        for (let i = 0; ; i++) { await body(i); if ((await this._conds(r.until, run)).ok) break; }
      }
    } finally { run.vars.repeat = outer; }
  }
  // a service call: what it would change, done on the sandbox's states
  _targets(a, data) {
    const out = new Set(), t = a.target || {};
    [t.entity_id, a.entity_id, data.entity_id].forEach((v) => toList(v).forEach((x) => { if (typeof x === 'string') x.split(',').map((s) => s.trim()).filter((s) => EXACT_RE.test(s)).forEach((s) => out.add(s)); }));
    [[t, ''], [a, ''], [data, '']].forEach(([o]) => ['area_id', 'floor_id', 'label_id', 'device_id'].forEach((k) => toList(o && o[k]).forEach((x) => {
      if (typeof x !== 'string' || !this.o.resolve) return;
      this.o.resolve((k === 'device_id' ? 'device' : k.slice(0, -3)) + ':' + x).forEach((e) => out.add(e));
    })));
    this._excludeSet(t.exclude).forEach((e) => out.delete(e));
    return [...out];
  }
  async _call(svc, a, run) {
    svc = String(await this._render(svc, run));
    const [dom, s] = svc.split('.');
    const data = (await this._render(a.data || a.data_template || {}, run)) || {};
    const tgt = await this._render(a.target || {}, run);
    let ents = this._targets(Object.assign({}, a, { target: tgt }), data);
    const generic = dom === 'homeassistant';
    if (!generic && dom !== 'script' && dom !== 'automation') ents = ents.filter((e) => e.split('.')[0] === dom || (dom === 'counter' && e.startsWith('counter.')));
    const cid = this._log({ kind: 'call', key: run.item.id, cause: run.cause, svc, data: data && typeof data === 'object' && !Array.isArray(data) ? data : null, ents: dom === 'script' && !['turn_on', 'turn_off', 'toggle'].includes(s) ? ['script.' + s] : ents, vars: this._snap(run.vars) });
    const entry = this.log[this.log.length - 1];
    // scripts: called directly, the caller waits; started with script.turn_on, it doesn't
    if (dom === 'script') {
      if (s === 'turn_off') { ents.forEach((e) => this._active(e).forEach((r) => this._cancel(r))); return; }
      const ids = ['turn_on', 'toggle'].includes(s) ? ents : ['script.' + s];
      for (const id of ids) {
        if (s === 'toggle' && this._active(id).length > 0) { this._active(id).forEach((r) => this._cancel(r)); continue; }
        let it = this.items.get(id);
        if (!it && this.o.fetch) { this.add(id, await this.o.fetch(id)); it = this.items.get(id); }
        if (!it) { entry.unknown = true; continue; }
        const vars = Object.assign({}, s === 'turn_on' ? (data.variables || {}) : data);
        const r = this._start(it, vars, cid, {});
        if (r && !['turn_on', 'toggle'].includes(s)) await new Promise((res, rej) => { r.parkP.then(() => { if (!r.done) this._parked(run); }); this.busy--; r.onDone = (o) => { this.busy++; this._moving(run); if (o === 'error') rej(new Error(T('sbx_script_failed', { name: this._name(id) }))); else res(); }; });
      }
      return;
    }
    // automation.trigger runs it inside the call, at once, and the call waits for that run to end
    if (svc === 'automation.trigger') {
      for (const id of ents) {
        const it = this.items.get(id);
        if (!it) { entry.unknown = true; continue; }
        const r = await this._triggered(it, { trigger: { platform: null, id: 'trigger', idx: 'trigger' } }, cid, { conds: data.skip_condition === false, now: true });
        if (r) await new Promise((res) => { r.parkP.then(() => { if (!r.done) this._parked(run); }); this.busy--; r.onDone = () => { this.busy++; this._moving(run); res(); }; });
      }
      return;
    }
    if (dom === 'timer') { for (const id of ents) await this._timer(id, s, data, cid); return; }
    // a scene sets what it holds (its config, when it's one made in the editor), and its own state is the time
    if (svc === 'scene.turn_on' || svc === 'scene.apply') {
      let known = true;
      const sets = svc === 'scene.apply' ? [data.entities] : [];
      for (const id of ents) { const cfg = this.o.scene ? await this.o.scene(id) : null; if (cfg && cfg.entities) sets.push(cfg.entities); else known = false; if (this.get(id)) await this.setState(id, this.iso(), {}, cid); }
      for (const set of sets) {
        for (const [id, v] of Object.entries(set || {})) {
          if (!EXACT_RE.test(id)) continue;
          const st = v && typeof v === 'object' ? v.state : v, A = v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'state')) : {};
          if (st != null) await this._answer(id, String(st), A, cid);
        }
      }
      if (!known) { entry.unknown = true; if (this.o.onLog) this.o.onLog(entry, true); }
      return;
    }
    // the message is handed out at once; the run then waits for the broker's answer (_yield)
    if (svc === 'mqtt.publish') { await this.mqtt(data.topic, data.payload != null ? data.payload : data.payload_template, cid); await this._yield(run); return; }
    if (SBX_MSG.has(dom)) { entry.msg = true; if (this.o.onLog) this.o.onLog(entry, true); return; }
    let known = ents.length > 0;
    for (const id of ents) {
      const ed = id.split('.')[0], sv = generic ? ((HA_GENERIC[ed] || {})[s] || s) : s;
      const no = sbxRefuse(ed, sv, this.get(id), data, this._name(id));
      if (no) throw Object.assign(new Error(no.text), { cfg: !!no.cfg });
      const eff = sbxEffect(ed, sv, this.get(id), data, this.iso());
      if (!eff) { known = false; continue; }
      await this._answer(id, eff[0] == null ? (this.get(id) || {}).state : eff[0], eff[1], cid);
    }
    if (!known) entry.unknown = true;
    if (this.o.onLog && entry.unknown) this.o.onLog(entry, true);
  }
  async _timer(id, s, d, cid) {
    const cur = this.get(id) || { state: 'idle', attributes: {} }, A = cur.attributes || {};
    // remaining as Home Assistant writes it (H:MM:SS), so a paused timer started again goes on from where it was
    const hms = (ms) => { const t = Math.round(Math.max(0, ms) / 1000); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
    const key = 'timer:' + id;
    const clear = () => this.timers.filter((x) => x.slot === key).forEach((x) => this._drop(x));
    const finish = async (ev) => { clear(); await this.setState(id, 'idle', { finishes_at: null, remaining: '0:00:00', last_transition: ev === 'timer.cancelled' ? 'cancelled' : 'finished' }, cid); await this.fireEvent(ev, { entity_id: id }, cid); };
    if (s === 'start' || s === 'change') {
      let ms = durMs(d.duration != null ? d.duration : s === 'start' && cur.state === 'paused' ? A.remaining : A.duration);
      if (s === 'change') { const left = A.finishes_at ? Date.parse(A.finishes_at) - this.now : 0; ms = left + (ms || 0); }
      if (ms == null) ms = 0;
      clear();
      const at = this.now + ms;
      await this.setState(id, 'active', { finishes_at: this.iso(at), remaining: hms(ms), last_transition: cur.state === 'active' ? 'restarted' : 'started' }, cid);
      this._at(at, () => this._task(async () => { await this.setState(id, 'idle', { finishes_at: null, remaining: '0:00:00', last_transition: 'finished' }, cid); await this.fireEvent('timer.finished', { entity_id: id }, cid); }), null, T('sbx_timer_label', { name: this._name(id) }), id).slot = key;
      return;
    }
    if (s === 'cancel') return finish('timer.cancelled');
    if (s === 'finish') return finish('timer.finished');
    if (s === 'pause') { const left = A.finishes_at ? Date.parse(A.finishes_at) - this.now : 0; clear(); await this.setState(id, 'paused', { remaining: hms(left), finishes_at: null, last_transition: 'paused' }, cid); }
  }
  async _waitTpl(a, run) {
    const tpl = String(a.wait_template), ms = a.timeout != null ? durMs(await this._render(a.timeout, run)) : null;
    const first = await this._tplCond(tpl, run);
    if (first.ok) { run.vars.wait = { completed: true, remaining: ms == null ? null : ms / 1000 }; return; }
    this._log({ kind: 'wait', key: run.item.id, cause: run.cause, text: T('sbx_wait_tpl', { t: shorten(tpl, 50), d: ms == null ? '' : ' ' + T('sbx_up_to', { d: fmtDur(ms) }) }) });
    const done = await this._waitFor(run, ms, (w) => ({ onState: async (id) => { if (!this._reads(tpl, id)) return; this.busy++; try { const r = await this._tplCond(tpl, run); if (r.ok) w.res(true); } finally { this.busy--; } } }), T('sbx_wait_label', { name: this._name(run.item.id) }));
    run.vars.wait = { completed: done, remaining: 0 };
    if (!done && a.continue_on_timeout === false) throw Object.assign({}, SBX_STOP, { text: T('sbx_timed_out') });
  }
  async _waitTrig(a, run) {
    const ms = a.timeout != null ? durMs(await this._render(a.timeout, run)) : null;
    // an event trigger's type and data may be templates, rendered with the run's variables when the wait starts
    // (0.11.3: a notification's buttons, each run's own ids)
    const ts = [];
    for (const t of this._asTrigs(a.wait_for_trigger).filter((x) => x.enabled !== false)) {
      ts.push(this._plat(t) === 'event' && /\{[{%]/.test(JSON.stringify([t.event_type, t.event_data || null])) ? Object.assign({}, t, { event_type: await this._render(t.event_type, run), event_data: await this._render(t.event_data || {}, run) }) : t);
    }
    this._log({ kind: 'wait', key: run.item.id, cause: run.cause, text: T('sbx_wait_trig', { d: ms == null ? '' : ' ' + T('sbx_up_to', { d: fmtDur(ms) }) }) });
    const tid = (t, i) => (t.id != null ? String(t.id) : String(i));
    // template triggers fire on becoming true: what they are when the wait starts
    const tplWas = new Map();
    for (let i = 0; i < ts.length; i++) {
      if (this._plat(ts[i]) === 'template') { const r = await this._tpl(ts[i].value_template, run); tplWas.set(i, r.ok ? asBool(r.value) : null); }
    }
    const done = await this._waitFor(run, ms, (w) => ({
      onState: async (id, old, nu) => {
        this.busy++;
        try {
          for (let i = 0; i < ts.length && !w.fin; i++) {
            const t = ts[i], p = this._plat(t), spec = this._espec(p), base = { platform: p, idx: String(i), id: tid(t, i), entity_id: id, from_state: old ? this.obj0(id, old) : null, to_state: this.obj0(id, nu) };
            if (p === 'state' && this._stateMatch(t, id, old, nu)) w.res(base);
            else if (p === 'numeric_state' && toList(t.entity_id).includes(id) && !this._inRange(t, await this._numVal(t, id, old, run)) && this._inRange(t, await this._numVal(t, id, nu, run))) w.res(base);
            else if (spec && this._eFires(spec, t, id, old, nu)) w.res(base);
            else if (p === 'zone' && this._zoneHit(t, id, old, nu)) w.res(Object.assign(base, { zone: this.obj(String(t.zone)), event: t.event || 'enter' }));
            else if (p === 'template' && this._reads(t.value_template, id)) {
              const r = await this._tpl(t.value_template, run), v = r.ok ? asBool(r.value) : null;
              if (v === true && tplWas.get(i) === false) w.res({ platform: 'template', idx: String(i), id: tid(t, i), entity_id: null });
              tplWas.set(i, v);
            }
          }
        } finally { this.busy--; }
      },
      onOther: (hit, tv) => { ts.forEach((t, i) => { if (w.fin) return; const v = hit(t); if (v) w.res(Object.assign({ platform: this._plat(t), idx: String(i), id: tid(t, i) }, typeof v === 'object' ? v : {}, tv ? tv(t) : {})); }); },
      onEvent: (ev) => { ts.forEach((t, i) => { if (this._plat(t) === 'event' && toList(t.event_type).includes(ev.event_type) && subsetOf(t.event_data, ev.data)) w.res({ platform: 'event', idx: String(i), id: tid(t, i), event: ev }); }); },
      onMqtt: async (msg) => {
        this.busy++;
        try { for (let i = 0; i < ts.length && !w.fin; i++) if (this._plat(ts[i]) === 'mqtt' && await this._mqttMatch(ts[i], msg)) w.res(Object.assign({ platform: 'mqtt', idx: String(i), id: tid(ts[i], i) }, msg)); } finally { this.busy--; }
      },
    }), T('sbx_wait_label', { name: this._name(run.item.id) }));
    run.vars.wait = { trigger: done || null, remaining: 0, completed: !!done };
    if (!done && a.continue_on_timeout === false) throw Object.assign({}, SBX_STOP, { text: T('sbx_timed_out') });
  }
  _waitFor(run, ms, mk, label) {
    return new Promise((res, rej) => {
      const w = { run, rej: (e) => { this.busy++; rej(e); } };
      let t = null;
      w.res = (v) => {
        if (w.fin) return;
        w.fin = true; this.waiters.delete(w); if (t) this._drop(t);
        this._later(() => { this.busy++; this._moving(run); res(v); });
      };
      Object.assign(w, mk(w));
      this.waiters.add(w);
      if (ms != null) t = this._at(this.now + ms, () => { if (!w.fin) { w.fin = true; this.waiters.delete(w); this._later(() => { this.busy++; this._moving(run); res(false); }); } }, run, label);
      this._parked(run);
      this.busy--;
    });
  }
  // ---- what the person can do to start the function's automations or change what they check (0.11.1): every
  // entity (or attribute of one) a trigger, a wait or a condition reads, with the values that matter to it (the
  // states it starts on, a number either side of each threshold, a zone, a press); the integrations' own device
  // triggers to press; webhooks, tags, calendars, Assist sentences, and Home Assistant starting or stopping
  _walk(it, onTrig, onCond) {
    const conds = (x) => toList(x).forEach((c) => {
      if (!c || typeof c !== 'object') return;
      if (Array.isArray(c)) { conds(c); return; }
      onCond(c.condition === 'device' ? sbxDevCond(c, this.o.entityOf) || c : c);
      ['conditions', 'and', 'or', 'not'].forEach((k) => { if (c[k] && typeof c[k] === 'object') conds(c[k]); });
    });
    const acts = (x) => toList(x).forEach((a) => {
      if (!a || typeof a !== 'object') return;
      if (Array.isArray(a)) { acts(a); return; }
      if (typeof a.condition === 'string' || a.and || a.or || a.not) conds(a);
      if (a.wait_for_trigger) this._asTrigs(a.wait_for_trigger).forEach((t) => onTrig(t, true));
      if (a.choose) toList(a.choose).forEach((o) => { if (o) { conds(o.conditions); acts(o.sequence); } });
      if (a.default) acts(a.default);
      if (a.if) { conds(a.if); acts(a.then); acts(a.else); }
      if (a.repeat) { conds(a.repeat.while); conds(a.repeat.until); acts(a.repeat.sequence); }
      if (a.sequence) acts(a.sequence);
      if (a.parallel) toList(a.parallel).forEach((b) => acts(b && b.sequence !== undefined ? b.sequence : b));
    });
    if (it.kind === 'automation') {
      this._trigs(it).forEach((t) => onTrig(t, false));
      conds(it.cfg.conditions != null ? it.cfg.conditions : it.cfg.condition);
      acts(it.cfg.actions != null ? it.cfg.actions : it.cfg.action);
    } else acts(it.cfg.sequence);
  }
  inputs() {
    const ents = new Map(), presses = new Map(), hooks = new Map(), tags = new Set(), cals = new Map(), says = new Map(), ha = new Set(), zw = new Map();
    const slot = (id, attr) => {
      if (typeof id !== 'string' || !EXACT_RE.test(id)) return null;
      const k = id + '|' + (attr || '');
      if (!ents.has(k)) ents.set(k, { id, attr: attr || null, vals: [] });
      return ents.get(k);
    };
    const add = (id, attr, v, why) => {
      const x = slot(id, attr);
      if (!x || v == null || (typeof v === 'object')) return;
      const sv = String(v);
      if (TPL_RE.test(sv) || x.vals.some((y) => y.v === sv)) return;
      x.vals.push({ v: sv, why });
    };
    const lit = (x) => (x == null ? null : typeof x === 'number' ? String(x) : /^-?\d+(\.\d+)?$/.test(String(x).trim()) ? String(x).trim() : (() => { const n = this._limit(x); return n == null ? null : String(n); })());
    const thr = (id, attr, above, below, name) => {
      const a = lit(above), b = lit(below);
      if (a != null) { add(id, attr, sbxStep(a, true), T('sbx_v_above', { a, name })); add(id, attr, a, T('sbx_v_at', { a, name })); }
      if (b != null) { add(id, attr, sbxStep(b, false), T('sbx_v_below', { a: b, name })); add(id, attr, b, T('sbx_v_at', { a: b, name })); }
      if (a == null && b == null) slot(id, attr);
    };
    const reads = (tpl) => { for (const m of String(tpl || '').matchAll(ENTITY_RE)) slot(m[0], null); };
    const zones = (id, z, name) => { toList(z).forEach((x) => { const zn = this._zoneName(x); if (zn) add(id, null, zn, T('sbx_v_zone', { zone: this._name(String(x)), name })); }); add(id, null, 'not_home', T('sbx_v_away', { name })); };
    this.items.forEach((it) => {
      const name = this._name(it.id), trig = T('sbx_v_trig', { name }), cond = T('sbx_v_cond', { name });
      this._walk(it, (t, inWait) => {
        if (t.enabled === false) return;
        const p = this._plat(t), spec = this._espec(p);
        if (p === 'state') toList(t.entity_id).forEach((id) => { toList(t.to).forEach((v) => add(id, t.attribute, v, trig)); toList(t.from).forEach((v) => add(id, t.attribute, v, T('sbx_v_from', { name }))); slot(id, t.attribute); });
        else if (p === 'numeric_state') toList(t.entity_id).forEach((id) => thr(id, t.attribute, t.above, t.below, name));
        else if (p === 'zone') toList(t.entity_id).forEach((id) => zones(id, t.zone, name));
        else if (p === 'template') reads(t.value_template);
        else if (p === 'time') toList(t.at).forEach((a) => { if (EXACT_RE.test(String(a))) slot(String(a), null); });
        else if (p === 'mqtt' && t._mq) presses.set(sbxPressKey(t._dev), this._pressText(t._dev));
        else if (p === 'zwave_js.value_updated' && this._zwOf(t).length) this._zwOf(t).forEach((x) => zw.set(x, name));
        else if (p === 'event' && (t._zw || this._zwOf(t).length)) { if (t._zw) presses.set(sbxPressKey(t._dev), this._pressText(t._dev)); this._zwOf(t).forEach((x) => zw.set(x, name)); }
        else if ((p === 'device' && !t._dev) || (!SBX_PLATS.has(p) && !spec && p)) presses.set(sbxPressKey(t), this._pressText(t));
        else if (p === 'webhook' && t.webhook_id != null) hooks.set(String(t.webhook_id), toList(t.allowed_methods || ['POST', 'PUT']).map(String));
        else if (p === 'tag') toList(t.tag_id).forEach((x) => tags.add(String(x)));
        else if (p === 'calendar' && t.entity_id) { const k = String(t.entity_id); cals.set(k, new Set([...(cals.get(k) || []), t.event || 'start'])); }
        else if (p === 'conversation') toList(t.command).forEach((c) => says.set(sbxSay(c), name));
        else if (p === 'homeassistant') ha.add(t.event || 'start');
        else if (spec) {
          this._etargets(t, spec).forEach((id) => {
            const ds = spec.d[id.split('.')[0]] || {}, st = this.get(id), A = (st && st.attributes) || {};
            const attr = ds.attr && !(ds.attr === 'is_closed' && id.startsWith('cover.')) ? ds.attr : null;
            const th = (t.options || {}).threshold || {}, lim = (c) => (c == null ? null : typeof c === 'object' ? (c.number != null ? c.number : c.entity || null) : c);
            switch (spec.k) {
              case 'target': case 'transition': toList(spec.to).forEach((v) => add(id, attr, v, trig)); toList(spec.from).forEach((v) => add(id, attr, v, T('sbx_v_from', { name }))); slot(id, attr); break;
              case 'cover': add(id, null, id.startsWith('cover.') ? (ds.tv ? 'closed' : 'open') : ds.tv, trig); break;
              case 'num_changed': case 'num_crossed':
                if (th.type === 'above') thr(id, attr, lim(th.value), null, name);
                else if (th.type === 'below') thr(id, attr, null, lim(th.value), name);
                else if (th.type === 'between' || th.type === 'outside') thr(id, attr, lim(th.value_min), lim(th.value_max), name);
                else slot(id, attr);
                break;
              case 'stateless': {
                const types = toList((t.options || {}).event_type).concat(Array.isArray(spec.evt) ? spec.evt : []);
                const all = types.length ? types : id.startsWith('event.') ? toList(A.event_types) : [];
                if (id.startsWith('event.') && all.length) all.forEach((ty) => add(id, null, SBX_PRESS + ty, T('sbx_v_press_t', { type: ty, name })));
                else add(id, null, SBX_PRESS, T('sbx_v_press', { name }));
                break;
              }
              case 'counter': {
                const n = parseFloat(st ? st.state : '');
                if (spec.op === 'max') add(id, null, A.maximum, trig); else if (spec.op === 'min') add(id, null, A.minimum, trig);
                else if (spec.op === 'reset') add(id, null, A.initial == null ? 0 : A.initial, trig);
                else if (isFinite(n)) add(id, null, String(spec.op === 'down' ? n - 1 : n + 1), trig);
                else slot(id, null);
                break;
              }
              case 'changed': toList(A.options).forEach((v) => add(id, null, v, trig)); slot(id, null); break;
              default: slot(id, attr);
            }
          });
        }
      }, (c) => {
        const type = c.condition;
        if (type === 'state') toList(c.entity_id).forEach((id) => toList(c.state).forEach((v) => add(id, c.attribute, v, cond)));
        else if (type === 'numeric_state') toList(c.entity_id).forEach((id) => thr(id, c.attribute, c.above, c.below, name));
        else if (type === 'zone') toList(c.entity_id).forEach((id) => zones(id, c.zone, name));
        else if (type === 'template') reads(c.value_template);
        else if (typeof c === 'string') reads(c);
        else if (type === 'time') [c.after, c.before].forEach((x) => { if (EXACT_RE.test(String(x || ''))) slot(String(x), null); });
      });
    });
    const nm = (id) => this._name(id);
    return {
      ents: [...ents.values()].sort((a, b) => nm(a.id).localeCompare(nm(b.id)) || String(a.attr || '').localeCompare(String(b.attr || ''))),
      presses: [...presses].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      hooks: [...hooks].map(([id, methods]) => ({ id, methods })),
      tags: [...tags],
      cals: [...cals].map(([id, evs]) => ({ id, events: [...evs] })),
      says: [...says].map(([v, name]) => ({ v, name })),
      ha: ['start', 'shutdown'].filter((x) => ha.has(x)),
      // Z-Wave values a trigger listens for (0.13.0): { dev, id, name } (name: the automation's)
      zwave: [...zw].map(([k, name]) => { const i = k.indexOf('|'); return { dev: k.slice(0, i), id: k.slice(i + 1), name }; }),
    };
  }
  // the Z-Wave values a trigger listens for, as 'device|value id': a value updated's, or the scene buttons a value
  // notification's event data names
  _zwOf(t) {
    const out = [], p = this._plat(t);
    if (p === 'zwave_js.value_updated') {
      const devs = new Set(toList(t.device_id).map(String));
      toList(t.entity_id).forEach((e) => { const d = this.o.devOf && this.o.devOf(String(e)); if (d) devs.add(d); });
      devs.forEach((dev) => {
        const z = this.zw.get(dev);
        if (!z) return;
        const id = sbxZwId(z.node, sbxZwInt(t.command_class), sbxZwInt(t.endpoint), sbxZwInt(t.property), sbxZwInt(t.property_key));
        if (z.byId.has(id)) out.push(dev + '|' + id);
      });
    } else if (p === 'event' && t.event_type === 'zwave_js_value_notification') {
      const ed = t.event_data || {}, z = this.zw.get(String(ed.device_id));
      if (!z) return out;
      z.byId.forEach((v, id) => {
        const same = (k, x) => ed[k] === undefined || String(ed[k]) === String(x);
        if ((v.stateful === false || v.cc === 91 || v.cc === 43) && same('command_class', v.cc) && same('property', v.property) && same('property_key', v.property_key) && same('endpoint', v.endpoint || 0)) out.push(ed.device_id + '|' + id);
      });
    }
    return out;
  }
  // what changed since the start: [{ id, from, to }]
  diff() { return [...this.changed].map(([id, s]) => ({ id, from: this.real[id] ? this.real[id].state : null, to: s.state })).filter((x) => x.from !== x.to); }
}

/* ---------- Sandbox templates: rendered by Home Assistant, reading the sandbox's states ----------
   The template's state functions are renamed to stand-ins that read fb_s (the sandbox's states) first and the
   real ones for everything else; the clock functions read fb_t (the sandbox clock). What still reads Home
   Assistant directly is reported, so a result built partly on the real house is never passed off as the sandbox's. */
// the ends of a template rendered as text (_sbxTpl's opt.raw)
export const SBX_RAW = '\u27eafb\u27eb';
export const SBX_PRELUDE = [
  "{%- macro _fb_obj(e, returns) -%}{%- if e in fb_s -%}{%- set s = fb_s[e] -%}{%- do returns({'entity_id': e, 'domain': e.split('.')[0], 'object_id': e.split('.')[1], 'name': s.attributes.get('friendly_name', e), 'state': s.state, 'attributes': s.attributes, 'last_changed': as_datetime(s.last_changed), 'last_updated': as_datetime(s.last_updated), 'last_reported': as_datetime(s.last_updated)}) -%}{%- elif e is string and '.' in e -%}{%- do returns(states[e.split('.')[0]][e.split('.')[1]]) -%}{%- endif -%}{%- endmacro -%}",
  '{%- set fb_obj = _fb_obj | as_function -%}',
  "{%- macro _fb_states(e, rounded=False, with_unit=False, returns=None) -%}{%- if e in fb_s -%}{%- do returns(fb_s[e].state) -%}{%- else -%}{%- do returns(states(e, rounded=rounded, with_unit=with_unit)) -%}{%- endif -%}{%- endmacro -%}",
  '{%- set fb_states = _fb_states | as_function -%}',
  "{%- macro _fb_is_state(e, v, returns) -%}{%- set x = fb_s[e].state if e in fb_s else states(e) -%}{%- do returns(x in v if (v is iterable and v is not string) else x == v) -%}{%- endmacro -%}",
  '{%- set fb_is_state = _fb_is_state | as_function -%}',
  "{%- macro _fb_state_attr(e, a, returns) -%}{%- do returns(fb_s[e].attributes.get(a) if e in fb_s else state_attr(e, a)) -%}{%- endmacro -%}",
  '{%- set fb_state_attr = _fb_state_attr | as_function -%}',
  "{%- macro _fb_is_state_attr(e, a, v, returns) -%}{%- do returns(fb_state_attr(e, a) == v) -%}{%- endmacro -%}",
  '{%- set fb_is_state_attr = _fb_is_state_attr | as_function -%}',
  "{%- macro _fb_has_value(e, returns) -%}{%- if e in fb_s -%}{%- do returns(fb_s[e].state not in ['unknown', 'unavailable']) -%}{%- else -%}{%- do returns(has_value(e)) -%}{%- endif -%}{%- endmacro -%}",
  '{%- set fb_has_value = _fb_has_value | as_function -%}',
  "{%- macro _fb_expand(a1=None, a2=None, a3=None, a4=None, a5=None, a6=None, a7=None, a8=None, returns=None) -%}{%- set ns = namespace(ids=[]) -%}{%- for a in ([a1, a2, a3, a4, a5, a6, a7, a8] | reject('none') | list) + (varargs | list) -%}{%- for x in (a if (a is iterable and a is not string and a is not mapping) else [a]) -%}{%- set ns.ids = ns.ids + [x if x is string else x.entity_id] -%}{%- endfor -%}{%- endfor -%}{%- do returns(expand(ns.ids) | map(attribute='entity_id') | map('apply', fb_obj) | list) -%}{%- endmacro -%}",
  '{%- set fb_expand = _fb_expand | as_function -%}',
  "{%- macro _fb_domain(d, returns) -%}{%- do returns(states[d] | map(attribute='entity_id') | map('apply', fb_obj) | list) -%}{%- endmacro -%}",
  '{%- set fb_domain = _fb_domain | as_function -%}',
  "{%- macro _fb_index(x, returns) -%}{%- if x is string and '.' in x -%}{%- do returns(fb_obj(x)) -%}{%- else -%}{%- do returns(fb_domain(x)) -%}{%- endif -%}{%- endmacro -%}",
  '{%- set fb_index = _fb_index | as_function -%}',
  "{%- macro _fb_all(returns) -%}{%- do returns(states | map(attribute='entity_id') | map('apply', fb_obj) | list) -%}{%- endmacro -%}",
  '{%- set fb_all = _fb_all | as_function -%}',
  "{%- macro _fb_now(returns) -%}{%- do returns((as_datetime(fb_t) | as_local) if fb_t else now()) -%}{%- endmacro -%}",
  '{%- set fb_now = _fb_now | as_function -%}',
  "{%- macro _fb_utcnow(returns) -%}{%- do returns(as_datetime(fb_t) if fb_t else utcnow()) -%}{%- endmacro -%}",
  '{%- set fb_utcnow = _fb_utcnow | as_function -%}',
  "{%- macro _fb_today_at(t='00:00', returns=None) -%}{%- set p = (t ~ ':0:0').split(':') -%}{%- do returns(fb_now().replace(hour=p[0] | int, minute=p[1] | int, second=p[2] | int, microsecond=0)) -%}{%- endmacro -%}",
  '{%- set fb_today_at = _fb_today_at | as_function -%}',
].join('');
export const SBX_FNS = ['states', 'is_state', 'state_attr', 'is_state_attr', 'has_value', 'expand', 'now', 'utcnow', 'today_at'];
// the template with its state functions renamed; leftovers: what in it still reads Home Assistant directly.
// Only Jinja expression/statement tags ({{ ... }}, {% ... %}) are rewritten; plain text, comments ({# ... #}),
// and quoted string literals inside Jinja are left untouched.
export function sbxRewrite(t) {
  const raw = String(t), left = new Set();
  const E = '([a-z_]+\\.[a-z0-9_]+)';
  const rewriteCode = (code) => {
    const lits = [];
    let s = '', i = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === c) { j++; break; }
          j++;
        }
        const idx = lits.length;
        lits.push({ q: c, raw: code.slice(i, j), val: code.slice(i + 1, j - 1) });
        s += `\x01Q${idx}\x02`;
        i = j;
      } else { s += c; i++; }
    }
    // tests: x is is_state('on') → x is apply(fb_is_state, 'on')
    s = s.replace(/\bis\s+(not\s+)?(is_state|is_state_attr|has_value)\s*\(\s*\)/g, (m, n, f) => `is ${n || ''}apply(fb_${f})`);
    s = s.replace(/\bis\s+(not\s+)?(is_state|is_state_attr|has_value)\s*\(/g, (m, n, f) => `is ${n || ''}apply(fb_${f}, `);
    s = s.replace(/\bis\s+(not\s+)?has_value\b(?!\s*\()/g, (m, n) => `is ${n || ''}apply(fb_has_value)`);
    // filters: 'x' | states → 'x' | apply(fb_states)
    s = s.replace(/\|\s*(states|expand|has_value|state_attr)\s*\(\s*\)/g, (m, f) => `| apply(fb_${f})`);
    s = s.replace(/\|\s*(states|expand|has_value|state_attr)\s*\(/g, (m, f) => `| apply(fb_${f}, `);
    s = s.replace(/\|\s*(states|expand|has_value)\b(?!\s*\()/g, (m, f) => `| apply(fb_${f})`);
    // states.light.kitchen, states['light.kitchen'] → fb_obj('light.kitchen'); states.light, states['light'] → fb_domain('light')
    s = s.replace(new RegExp('(?<![\\w.])states\\.' + E.replace('\\.', '\\.'), 'g'), (m, id) => `fb_obj('${id}')`);
    s = s.replace(/(?<![\w.])states\s*\[\s*\x01Q(\d+)\x02\s*\]/g, (m, idx) => {
      const v = lits[+idx].val;
      if (/^[a-z_]+\.[a-z0-9_]+$/.test(v)) return `fb_obj('${v}')`;
      if (/^[a-z_]+$/.test(v)) return `fb_domain('${v}')`;
      return m;
    });
    s = s.replace(/(?<![\w.])states\.([a-z_]+)(?![\w.(])/g, (m, d) => `fb_domain('${d}')`);
    // calls: is_state( → fb_is_state(
    s = s.replace(new RegExp('(?<![\\w.])(' + SBX_FNS.join('|') + ')\\s*\\(', 'g'), (m, f) => `fb_${f}(`);
    // states[anything] → fb_index(anything): an entity or a domain, looked up when it renders
    const sub = /(?<![\w.'"])states\s*\[/g;
    let out = '', from = 0, m0;
    while ((m0 = sub.exec(s))) {
      let depth = 1, j = sub.lastIndex;
      for (; j < s.length && depth; j++) {
        const ch = s[j];
        if (ch === '[') depth++; else if (ch === ']') depth--;
      }
      if (depth) break;
      out += s.slice(from, m0.index) + 'fb_index(' + s.slice(sub.lastIndex, j - 1) + ')';
      from = j; sub.lastIndex = j;
    }
    s = out + s.slice(from);
    // every state at once: states | ..., for x in states
    s = s.replace(/(?<![\w.'"])states(?![\w(.[])/g, 'fb_all()');
    if (/(?<![\w.'"])states(?![\w(])/.test(s)) left.add('states');
    ['closest', 'distance', 'state_translated', 'device_attr', 'is_device_attr'].forEach((f) => { if (new RegExp('(?<![\\w.])' + f + '\\b').test(s)) left.add(f); });
    if (/\|\s*(closest|state_translated)\b/.test(s)) left.add('filter');
    return s.replace(/\x01Q(\d+)\x02/g, (m, idx) => lits[+idx].raw);
  };
  // tokenize Jinja blocks: {# comment #}, {{ expr }}, {% stmt %}; plain text stays untouched
  let res = '', pos = 0;
  while (pos < raw.length) {
    const next = raw.indexOf('{', pos);
    if (next < 0 || next + 1 >= raw.length) { res += raw.slice(pos); break; }
    const ch = raw[next + 1];
    if (ch !== '{' && ch !== '%' && ch !== '#') { res += raw.slice(pos, next + 1); pos = next + 1; continue; }
    res += raw.slice(pos, next);
    if (ch === '#') {
      const end = raw.indexOf('#}', next + 2);
      if (end < 0) { res += raw.slice(next); break; }
      res += raw.slice(next, end + 2);
      pos = end + 2;
      continue;
    }
    const close = ch === '{' ? '}}' : '%}';
    let j = next + 2, q = null, end = -1;
    while (j < raw.length) {
      const c = raw[j];
      if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; j++; continue; }
      if (c === "'" || c === '"') { q = c; j++; continue; }
      if (c === close[0] && raw[j + 1] === close[1]) { end = j; break; }
      j++;
    }
    if (end < 0) { res += raw.slice(next); break; }
    let openEnd = next + 2, closeStart = end;
    if (raw[openEnd] === '-' || raw[openEnd] === '+') openEnd++;
    if (closeStart > openEnd && (raw[closeStart - 1] === '-' || raw[closeStart - 1] === '+')) closeStart--;
    res += raw.slice(next, openEnd) + rewriteCode(raw.slice(openEnd, closeStart)) + raw.slice(closeStart, end + 2);
    pos = end + 2;
  }
  return { text: res, leftovers: [...left] };
}

/* ---------- saved checks (0.9.0): a run in the sandbox kept with what should come of it, replayed on the
   function's current configs, so "did I just break it?" has an answer. A check is
     { id, name, at: the sandbox clock it started at, start: { entity: { state, attributes } } as they were,
       items: the automations and scripts that took part (the function's own and the related ones on its board),
       steps: [{ op: set|event|mqtt|run|advance|next, … }], answers: [{ key, text, value }] given to its questions,
       expect: [{ k: state, id, state } | { k: ran|stopped|notran, id }] } ---------- */
export const CHECK_OPS = new Set(['set', 'event', 'mqtt', 'run', 'advance', 'next', 'press', 'ha', 'webhook', 'tag', 'calendar', 'say', 'behave', 'zwave']);
// one step of a check (or of what you do in the sandbox), done on an engine
export function sbxDoStep(eng, s) {
  switch (s.op) {
    case 'set': return eng.userSet(s.id, s.state, s.attrs);
    case 'event': return eng.userEvent(s.type, s.data);
    case 'mqtt': return eng.userMqtt(s.topic, s.payload);
    case 'run': return eng.userRun(s.id, s.conds, s.ti, s.vars);
    case 'advance': return eng.advance(s.ms);
    case 'press': return eng.userPress(s.key);
    case 'zwave': return eng.userZwave(s.dev, s.id, s.value);
    case 'ha': return eng.userHA(s.event);
    case 'webhook': return eng.userWebhook(s.id, s.data, s.method);
    case 'tag': return eng.userTag(s.tag);
    case 'calendar': return eng.userCalendar(s.id, s.event, s.summary);
    case 'say': return eng.userSay(s.text);
    case 'behave': return eng.setBehave(s.id, s.how, s.ms);
    default: return eng.toNext();
  }
}
export const CHECK_EXP = new Set(['state', 'ran', 'stopped', 'notran']);
// what a check may hold, and no more (it's kept in the layout, shared and synced)
export function cleanCheck(c) {
  if (!c || typeof c !== 'object' || !SAFE_ID.test(String(c.id))) return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n), id = (v) => (typeof v === 'string' && v.length < 300 ? v : null);
  const plain = (v) => { try { const j = JSON.stringify(v == null ? {} : v); return j.length <= 4000 ? JSON.parse(j) : {}; } catch (e) { return {}; } };
  const start = {};
  Object.entries(c.start && typeof c.start === 'object' ? c.start : {}).slice(0, 300).forEach(([k, v]) => {
    if (EXACT_RE.test(k) && v && typeof v === 'object') start[k] = { state: str(v.state, 255), attributes: plain(v.attributes) };
  });
  const steps = (Array.isArray(c.steps) ? c.steps : []).slice(0, 100).map((x) => {
    if (!x || !CHECK_OPS.has(x.op)) return null;
    if (x.op === 'set') return id(x.id) && Object.assign({ op: 'set', id: x.id, state: x.state == null ? null : str(x.state, 255) }, x.attrs && typeof x.attrs === 'object' && Object.keys(x.attrs).length ? { attrs: plain(x.attrs) } : {});
    if (x.op === 'press') return { op: 'press', key: str(x.key, 1000) };
    if (x.op === 'zwave') return { op: 'zwave', dev: str(x.dev, 64), id: str(x.id, 255), value: x.value == null || typeof x.value === 'boolean' || typeof x.value === 'number' ? (x.value == null ? null : x.value) : str(x.value, 255) };
    if (x.op === 'ha') return { op: 'ha', event: x.event === 'shutdown' ? 'shutdown' : 'start' };
    if (x.op === 'webhook') return { op: 'webhook', id: str(x.id, 255), method: str(x.method || 'POST', 10).toUpperCase(), data: plain(x.data) };
    if (x.op === 'tag') return { op: 'tag', tag: str(x.tag, 255) };
    if (x.op === 'calendar') return id(x.id) && { op: 'calendar', id: x.id, event: x.event === 'end' ? 'end' : 'start', summary: str(x.summary, 255) };
    if (x.op === 'say') return { op: 'say', text: str(x.text, 500) };
    if (x.op === 'behave') return id(x.id) && ['ok', 'slow', 'fails', 'unavailable'].includes(x.how) && { op: 'behave', id: x.id, how: x.how, ms: Math.max(0, Math.min(864e5, +x.ms || 0)) };
    if (x.op === 'event') return { op: 'event', type: str(x.type, 255), data: plain(x.data) };
    if (x.op === 'mqtt') return { op: 'mqtt', topic: str(x.topic, 255), payload: str(x.payload, 4000) };
    if (x.op === 'run') return id(x.id) && Object.assign({ op: 'run', id: x.id, conds: !!x.conds, ti: Number.isInteger(x.ti) ? x.ti : null }, x.vars && typeof x.vars === 'object' && Object.keys(x.vars).length ? { vars: plain(x.vars) } : {});
    if (x.op === 'advance') return { op: 'advance', ms: Math.max(0, Math.min(366 * 864e5, Math.round(+x.ms || 0))) };
    return { op: 'next' };
  }).filter(Boolean);
  const answers = (Array.isArray(c.answers) ? c.answers : []).slice(0, 50).filter((a) => a && typeof a === 'object').map((a) => ({ key: str(a.key, 300), text: str(a.text, 500), value: typeof a.value === 'boolean' || typeof a.value === 'number' ? a.value : str(a.value, 500) }));
  const expect = (Array.isArray(c.expect) ? c.expect : []).slice(0, 100).filter((x) => x && CHECK_EXP.has(x.k) && id(x.id)).map((x) => (x.k === 'state' ? { k: 'state', id: x.id, state: str(x.state, 255) } : { k: x.k, id: x.id }));
  const items = (Array.isArray(c.items) ? c.items : []).filter((k) => typeof k === 'string' && /^(automation|script)\.[a-z0-9_]+$/.test(k)).slice(0, 300);
  if (!steps.length || !expect.length) return null;
  return { id: String(c.id), name: str(c.name, 160) || 'Check', at: Number.isFinite(+c.at) ? Math.round(+c.at) : Date.now(), start, items, steps, answers, expect };
}
// replay one: o is what the board's sandbox gets (states, items, tz, tpl, resolve, fetch, name, condText). Returns
// { ok, unsure (a question it had no answer for), res: [{ ok, got }] per expectation, log }
export async function runCheck(c, o) {
  const states = Object.assign({}, o.states);
  Object.entries(c.start).forEach(([k, v]) => { states[k] = Object.assign({}, o.states[k] || {}, { state: v.state, attributes: Object.keys(v.attributes || {}).length ? v.attributes : (o.states[k] || {}).attributes || {} }); });
  const answers = c.answers.slice();
  let unsure = null;
  const eng = new Sandbox(Object.assign({}, o, {
    states, now: c.at, onLog: null,
    ask: (q) => {
      const key = q.run ? q.run.item.id || '' : '', i = answers.findIndex((a) => a.key === key && a.text === q.text);
      if (i >= 0) return Promise.resolve(answers.splice(i, 1)[0].value);
      unsure = unsure || q.text;
      return Promise.resolve(false);
    },
  }));
  await eng.start();
  for (const s of c.steps) await sbxDoStep(eng, s);
  await eng.settle();
  const runs = (k) => eng.log.filter((e) => e.kind === 'run' && e.key === k).map((e) => e.outcome);
  const res = c.expect.map((x) => {
    if (x.k === 'state') { const st = eng.get(x.id), got = st ? String(st.state) : null; return { ok: got === x.state, got }; }
    const r = runs(x.id), got = r.length ? r.join(', ') : 'none';
    if (x.k === 'ran') return { ok: r.includes('finished'), got };
    if (x.k === 'stopped') return { ok: r.includes('stopped') && !r.includes('finished'), got };
    return { ok: !r.includes('finished'), got };
  });
  return { ok: !unsure && res.every((r) => r.ok), unsure, res, log: eng.log, eng };
}

// ---- replay from history (0.11.2): Home Assistant's history (history/history_during_period, compressed rows: s
// the state, a its attributes, lu and lc the times in seconds) made into what the sandbox needs. o: { inputs (read
// by the function: their real changes are replayed), outputs (only changed by it: compared), autos (its automations:
// their runs, from last_triggered, compared), from, to (ms), max (changes at most) }. Returns the states at the start,
// the steps (time passing, then each input's change, in order), what the outputs and automations really did, how
// many changes there were and whether they were cut at max.
export const histT = (r) => Math.round(((r.lu != null ? r.lu : r.lc) || 0) * 1000);
export function sbxHistory(hist, o) {
  const start = {}, changes = [], real = {}, runs = {}, max = o.max || 2000;
  const rows = (id) => (Array.isArray(hist && hist[id]) ? hist[id] : []);
  // each row's state with the attributes as they stand (a row without "a" keeps the last)
  const walk = (id, each) => { let A = {}; rows(id).forEach((r, i) => { if (r.a && typeof r.a === 'object') A = r.a; each({ t: histT(r), state: String(r.s), attributes: Object.assign({}, A) }, i); }); };
  const ins = new Set(o.inputs || []);
  [...ins, ...(o.outputs || []), ...(o.autos || [])].forEach((id) => walk(id, (x, i) => { if (i === 0 || !start[id]) start[id] = { state: x.state, attributes: x.attributes }; }));
  ins.forEach((id) => walk(id, (x, i) => { if (i > 0 && x.t > o.from && x.t <= o.to) changes.push(Object.assign({ id }, x)); }));
  (o.outputs || []).forEach((id) => {
    const out = [];
    walk(id, (x, i) => { if (i > 0 && x.t > o.from && x.t <= o.to && (!out.length || out[out.length - 1].s !== x.state)) out.push({ t: x.t, s: x.state }); });
    real[id] = out;
  });
  (o.autos || []).forEach((id) => {
    const out = [];
    let last = null;
    walk(id, (x, i) => { const lt = x.attributes.last_triggered; if (i === 0) { last = lt; return; } if (lt && lt !== last) { const t = Date.parse(lt); if (t > o.from && t <= o.to) out.push({ t }); } last = lt; });
    runs[id] = out;
  });
  changes.sort((a, b) => a.t - b.t);
  const cut = changes.length > max, steps = [];
  let at = o.from;
  changes.slice(0, max).forEach((x) => {
    if (x.t > at) steps.push({ op: 'advance', ms: x.t - at });
    at = Math.max(at, x.t);
    steps.push(Object.assign({ op: 'set', id: x.id, state: x.state }, Object.keys(x.attributes).length ? { attrs: x.attributes } : {}));
  });
  if (!cut && o.to > at) steps.push({ op: 'advance', ms: o.to - at });
  return { start, steps, real, runs, n: changes.length, cut };
}
// what the sandbox did against what the home did: per output, its states in order (each within slack ms of the
// real one); per automation, its runs. [{ id, kind: 'state' | 'runs', real, here, same, first: the first that
// differs }]
export function sbxCompare(h, log, slack) {
  const sl = slack == null ? 60e3 : slack, out = [];
  const near = (a, b) => Math.abs(a - b) <= sl;
  Object.entries(h.real).forEach(([id, real]) => {
    const here = [];
    log.filter((e) => e.kind === 'state' && e.key === id && e.by !== 'you').forEach((e) => { if (!here.length || here[here.length - 1].s !== String(e.to)) here.push({ t: e.t, s: String(e.to) }); });
    let first = null;
    for (let i = 0; i < Math.max(real.length, here.length) && !first; i++) if (!real[i] || !here[i] || real[i].s !== here[i].s || !near(real[i].t, here[i].t)) first = { i, real: real[i] || null, here: here[i] || null };
    out.push({ id, kind: 'state', real, here, same: !first, first });
  });
  Object.entries(h.runs).forEach(([id, real]) => {
    const here = log.filter((e) => e.kind === 'run' && e.key === id && e.outcome !== 'stopped' && e.started != null).map((e) => ({ t: e.started })).sort((a, b) => a.t - b.t);
    let first = null;
    for (let i = 0; i < Math.max(real.length, here.length) && !first; i++) if (!real[i] || !here[i] || !near(real[i].t, here[i].t)) first = { i, real: real[i] || null, here: here[i] || null };
    out.push({ id, kind: 'runs', real, here, same: !first, first });
  });
  return out;
}

// ---- coverage (0.11.2): what runs reached of each automation and script, every trigger, condition, action and
// branch by its place in the config (its path), with whether it was reached (a condition: seen true, false, both).
// engs: the engines of the runs (each saved check's); items: [{ id, cfg }] (the same config objects the runs had);
// say(kind, x) → words for it
export function sbxCoverage(engs, items, say) {
  const out = [];
  const reached = (x) => engs.some((e) => e.hit.has(x));
  const res = (x) => engs.reduce((acc, e) => { const r = e.cres.get(x) || {}; Object.keys(r).forEach((k) => { if (r[k]) acc[k] = true; }); return acc; }, {});
  items.forEach(({ id, cfg }) => {
    if (!cfg || typeof cfg !== 'object') return;
    const push = (path, kind, x, extra) => out.push(Object.assign({ id, path, kind, text: say ? say(kind, x) : '' }, extra));
    const cond = (c, path) => { const r = res(c); push(path, 'cond', c, { t: !!r.t, f: !!r.f, hit: !!(r.t || r.f) }); };
    const conds = (list, path) => toList(list).forEach((c, i) => { if (c && typeof c === 'object') cond(c, `${path}/${i}`); });
    const acts = (list, path) => toList(list).forEach((a, i) => {
      if (!a || typeof a !== 'object' || Array.isArray(a) || a.enabled === false) return;
      const at = `${path}/${i}`;
      if (typeof a.condition === 'string' || a.and || a.or || a.not) { cond(a, at); return; }
      push(at, 'action', a, { hit: reached(a) });
      if (a.choose) {
        toList(a.choose).forEach((o, j) => { if (!o) return; conds(o.conditions, `${at}/choose/${j}/if`); push(`${at}/choose/${j}`, 'option', o, { hit: reached(o) }); acts(o.sequence, `${at}/choose/${j}`); });
        if (a.default) { push(`${at}/default`, 'branch', a, { hit: !!res(a).default, branch: 'default' }); acts(a.default, `${at}/default`); }
      }
      if (a.if) {
        conds(a.if, `${at}/if`);
        push(`${at}/then`, 'branch', a, { hit: !!res(a).then, branch: 'then' }); acts(a.then, `${at}/then`);
        if (a.else) { push(`${at}/else`, 'branch', a, { hit: !!res(a).else, branch: 'else' }); acts(a.else, `${at}/else`); }
      }
      if (a.repeat) { conds(a.repeat.while, `${at}/while`); conds(a.repeat.until, `${at}/until`); acts(a.repeat.sequence, `${at}/repeat`); }
      if (a.sequence) acts(a.sequence, `${at}/seq`);
      if (a.parallel) toList(a.parallel).forEach((b, j) => acts(b && b.sequence !== undefined ? b.sequence : b, `${at}/par/${j}`));
    });
    if (/^automation\./.test(id)) {
      toList(cfg.triggers != null ? cfg.triggers : cfg.trigger).forEach((t, i) => { if (t && typeof t === 'object' && t.enabled !== false) push(`t/${i}`, 'trigger', t, { hit: engs.some((e) => e.fired.has(id + '#' + i)) }); });
      conds(cfg.conditions != null ? cfg.conditions : cfg.condition, 'c');
      acts(cfg.actions != null ? cfg.actions : cfg.action, 'a');
    } else acts(cfg.sequence, 'a');
  });
  return out;
}

// ---- the explorer (0.11.2): from the same start, each thing you could do on its own (every value Set offers, every
// press, webhook, tag, sentence, Home Assistant starting, and a day with nothing done), then the clock run on to
// what that set going, up to a day. For each: what started, what was called, what changed. Then what looks wrong:
// automations nothing started, conditions never true, two automations fighting over one entity, loops, calls
// whose effect it doesn't know. mk() → a new engine, not started; o: { max, onProgress(i, n), stopped() }
export function sbxTries(ins, iso) {
  const asVal = (x) => (/^-?\d+(\.\d+)?$/.test(x) ? parseFloat(x) : x === 'true' ? true : x === 'false' ? false : x);
  const out = [{ step: { op: 'advance', ms: 864e5 }, what: T('sbx_x_day') }];
  ins.ents.forEach((x) => x.vals.forEach((v) => {
    const press = v.v.startsWith(SBX_PRESS), type = press ? v.v.slice(SBX_PRESS.length) : '';
    const step = press ? { op: 'set', id: x.id, state: null, press: true, attrs: type ? { event_type: type } : undefined }
      : x.attr ? { op: 'set', id: x.id, state: null, attrs: { [x.attr]: asVal(v.v) } } : { op: 'set', id: x.id, state: v.v };
    out.push({ step, what: T('sbx_x_set', { id: x.id, v: press ? (type || T('sbx_press_now')) : (x.attr ? x.attr + ' ' : '') + v.v }) });
  }));
  ins.presses.forEach((x) => out.push({ step: { op: 'press', key: x.key }, what: x.label }));
  ins.ha.forEach((x) => out.push({ step: { op: 'ha', event: x }, what: x === 'shutdown' ? T('sbx_ha_stops') : T('sbx_ha_starts') }));
  ins.hooks.forEach((x) => out.push({ step: { op: 'webhook', id: x.id, method: x.methods[0] || 'POST', data: {} }, what: T('sbx_webhook_called', { id: x.id }) }));
  ins.tags.forEach((x) => out.push({ step: { op: 'tag', tag: x }, what: T('sbx_tag_scanned', { tag: x }) }));
  ins.cals.forEach((x) => x.events.forEach((ev) => out.push({ step: { op: 'calendar', id: x.id, event: ev, summary: T('sbx_cal_summary') }, what: `${x.id}: ${ev}` })));
  ins.says.filter((x) => !/\{/.test(x.v)).forEach((x) => out.push({ step: { op: 'say', text: x.v }, what: T('sbx_said', { s: x.v }) }));
  return out;
}
export async function sbxExplore(mk, o = {}) {
  const first = mk();
  await first.start();
  const tries = sbxTries(first.inputs()).slice(0, o.max || 200), runs = [], engs = [];
  for (let i = 0; i < tries.length; i++) {
    if (o.stopped && o.stopped()) break;
    const e = mk(), tr = tries[i];
    await e.start();
    const from = e.seq;
    const step = tr.step.press ? { op: 'set', id: tr.step.id, state: e.iso(), attrs: tr.step.attrs } : tr.step;
    // up to a day from the start, not a day past whatever is due next (something always is: a time trigger, the sun)
    const end = e.now + 864e5;
    await sbxDoStep(e, step);
    for (let k = 0; k < 60 && !e.halted && isFinite(e.nextAt()) && e.nextAt() <= end; k++) await e.toNext();
    await e.settle();
    runs.push(sbxExploreRun(e, tr, step, from));
    engs.push(e);
    if (o.onProgress) o.onProgress(i + 1, tries.length);
  }
  return { runs, engs, flags: sbxFlags(runs, engs, first) };
}
// one try: what it started, called and changed, and two automations setting one entity different ways within a minute
export function sbxExploreRun(e, tr, step, from) {
  const log = e.log.filter((x) => x.id > from), byId = new Map(e.log.map((x) => [x.id, x]));
  const setter = (x) => { let c = byId.get(x.cause); for (let k = 0; c && k < 50; k++) { if (c.kind === 'call') return c.key; c = byId.get(c.cause); } return null; };
  const changes = log.filter((x) => x.kind === 'state' && x.by !== 'you').map((x) => ({ id: x.key, to: x.to, t: x.t, by: setter(x) }));
  const fights = [];
  changes.forEach((a, i) => changes.slice(i + 1).forEach((b) => {
    if (a.id === b.id && a.by && b.by && a.by !== b.by && a.to !== b.to && Math.abs(b.t - a.t) <= 60000 && !fights.some((f) => f.id === a.id)) fights.push({ id: a.id, a: [a.by, a.to], b: [b.by, b.to] });
  }));
  return {
    what: tr.what, step,
    started: [...new Set(log.filter((x) => x.kind === 'trigger').map((x) => x.key))],
    calls: log.filter((x) => x.kind === 'call').map((x) => ({ by: x.key, svc: x.svc, ents: x.ents, unknown: !!x.unknown })),
    changes, fights, loop: !!e.halted,
  };
}
export function sbxFlags(runs, engs, first) {
  const flags = [], items = [...first.items.values()];
  const started = new Set(runs.flatMap((r) => r.started)), called = new Set(runs.flatMap((r) => r.calls.flatMap((c) => c.ents)));
  items.forEach((it) => { if (it.kind === 'automation' && first._on(it) && !started.has(it.id)) flags.push({ kind: 'never', id: it.id }); });
  items.forEach((it) => { if (it.kind === 'script' && !started.has(it.id) && !called.has(it.id) && !runs.some((r) => r.calls.some((c) => c.svc === it.id))) flags.push({ kind: 'never', id: it.id }); });
  const cov = sbxCoverage(engs, items.map((it) => ({ id: it.id, cfg: it.cfg })));
  cov.filter((x) => x.kind === 'cond' && x.f && !x.t).forEach((x) => flags.push({ kind: 'cond_false', id: x.id, path: x.path, cond: x }));
  runs.forEach((r, i) => r.fights.forEach((f) => flags.push(Object.assign({ kind: 'fight', run: i }, f))));
  runs.forEach((r, i) => { if (r.loop) flags.push({ kind: 'loop', run: i }); });
  const unk = new Map();
  runs.forEach((r, i) => r.calls.forEach((c) => { if (c.unknown && !unk.has(c.svc)) unk.set(c.svc, { kind: 'unknown', svc: c.svc, by: c.by, run: i }); }));
  unk.forEach((x) => flags.push(x));
  return flags;
}
