import { EXACT_RE, toList } from './constants.js';
import { T } from './i18n.js';

/* ---------- builders (0.11.3): a builder writes an ordinary Home Assistant script ----------
   What the person chose (the spec) is kept in the function's layout (layout.builders, by the script's entity id)
   and the script is made from it here, the same every time. The script opens in its builder again only while it
   is still what the builder makes of its spec, its name, icon and description aside (nbSame); edited by hand past
   that, it opens in Home Assistant's editor. Its description says how it was made. Nothing of the board runs it:
   it's Home Assistant's own script, run like any other. The first builder sends a notification (notifyScript). */
export const NB_LEVELS = ['normal', 'time', 'critical'];
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const NB_SVC_RE = /^mobile_app_[a-z0-9_]{1,200}$/;
// Home Assistant's slugify, near enough for a phone's name: how the mobile app names its notify action
export const slugify = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// a spec as it may be kept: only what it can be (a layout is shared JSON)
export function cleanNotify(s) {
  const src = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const ent = (v, d) => (typeof v === 'string' && v.startsWith(d + '.') && EXACT_RE.test(v) ? v : null);
  const list = (v) => (Array.isArray(v) ? v : []);
  const phone = (p) => (p && NB_SVC_RE.test(String(p.svc)) ? { svc: String(p.svc), os: p.os === 'ios' ? 'ios' : 'android', name: str(p.name, 200) } : null);
  const acts = (a) => list(a).filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 100);
  const q = src.quiet;
  return {
    kind: 'notify',
    title: str(src.title, 200), message: str(src.message, 4000),
    phones: list(src.phones).map(phone).filter(Boolean).slice(0, 20),
    people: list(src.people).map((p) => (p && ent(p.id, 'person') ? { id: p.id, away: !!p.away, phones: list(p.phones).map(phone).filter(Boolean).slice(0, 10) } : null)).filter(Boolean).slice(0, 20),
    speakers: [...new Set(list(src.speakers).map((x) => ent(x, 'media_player')).filter(Boolean))].slice(0, 20),
    tts: ent(src.tts, 'tts'), say: str(src.say, 4000), speakAlways: !!src.speakAlways,
    level: NB_LEVELS.includes(src.level) ? src.level : 'normal',
    tag: str(src.tag, 64).replace(/[^A-Za-z0-9_-]/g, ''),
    buttons: list(src.buttons).filter((b) => b && str(b.title, 64).trim()).slice(0, 3).map((b) => ({ title: str(b.title, 64).trim(), then: acts(b.then) })),
    wait: Math.min(1440, Math.max(1, Math.round(+src.wait) || 30)),
    timeout: acts(src.timeout), clear: src.clear !== false,
    quiet: q && HHMM_RE.test(q.from) && HHMM_RE.test(q.to) && q.from !== q.to ? { from: q.from, to: q.to } : null,
  };
}
// every phone the spec sends to, once: the ones picked themselves first, then each person's
export function notifyPhones(spec) {
  const seen = new Set(), out = [];
  spec.phones.forEach((p) => { if (!seen.has(p.svc)) { seen.add(p.svc); out.push({ p, who: null }); } });
  spec.people.forEach((x) => x.phones.forEach((p) => { if (!seen.has(p.svc)) { seen.add(p.svc); out.push({ p, who: x }); } }));
  return out;
}
// the script a notification spec makes (meta: its alias, icon and description). The phones' differences are the
// companion apps': iOS takes an interruption level (passive in quiet hours, critical with a critical sound),
// Android a priority and a channel (alarm_stream for critical; quiet hours on a channel of low importance).
// Buttons: each run gets action ids of its own (from its context), waits for one to be pressed, clears the
// notification and does what that button does, or what's done when nobody answers.
export function notifyScript(spec, meta) {
  const s = cleanNotify(spec), M = meta || {}, B = s.buttons.length > 0, crit = s.level === 'critical';
  const quietly = !!s.quiet && !crit, phones = notifyPhones(s), asks = B && phones.length > 0;
  const tag = s.tag || (asks && s.clear ? '{{ fb_id }}' : '');
  // the button ids come from the run's context, which Home Assistant gives its actions (not the script's own
  // variables, rendered before it): so they're set by the first step
  const vars = {};
  if (quietly) {
    const { from, to } = s.quiet;
    vars.fb_quiet = from > to ? `{{ now() >= today_at('${from}') or now() < today_at('${to}') }}` : `{{ today_at('${from}') <= now() < today_at('${to}') }}`;
  }
  const pdata = (os) => {
    const d = {};
    if (tag) d.tag = tag;
    if (asks) d.actions = s.buttons.map((b, i) => ({ action: `{{ fb_id }}_${i + 1}`, title: b.title }));
    if (os === 'ios') {
      const lvl = crit ? 'critical' : s.level === 'time' ? 'time-sensitive' : 'active';
      if (lvl !== 'active' || quietly) d.push = { 'interruption-level': quietly ? `{{ 'passive' if fb_quiet else '${lvl}' }}` : lvl };
      if (crit) d.push.sound = { name: 'default', critical: 1, volume: 1 };
    } else {
      if (s.level !== 'normal') { d.priority = 'high'; d.ttl = 0; }
      if (crit) d.channel = 'alarm_stream';
      if (quietly) { d.channel = "{{ 'Quiet' if fb_quiet else 'General' }}"; d.importance = "{{ 'low' if fb_quiet else 'default' }}"; }
    }
    return d;
  };
  const send = (p) => {
    const d = pdata(p.os);
    return { action: 'notify.' + p.svc, data: Object.assign(s.title ? { title: s.title } : {}, { message: s.message }, Object.keys(d).length ? { data: d } : {}) };
  };
  const seq = asks ? [{ variables: { fb_id: "{{ 'fb_' ~ context.id }}" } }] : [];
  phones.filter((x) => !x.who || !x.who.away).forEach((x) => seq.push(send(x.p)));
  s.people.filter((x) => x.away).forEach((x) => {
    const mine = phones.filter((y) => y.who === x).map((y) => send(y.p));
    if (mine.length) seq.push({ if: [{ condition: 'not', conditions: [{ condition: 'state', entity_id: x.id, state: 'home' }] }], then: mine });
  });
  if (s.tts && s.speakers.length) {
    const say = { action: 'tts.speak', target: { entity_id: s.tts }, data: { media_player_entity_id: s.speakers.length === 1 ? s.speakers[0] : s.speakers, message: s.say || s.message } };
    const conds = [];
    if (!s.speakAlways) conds.push({ condition: 'numeric_state', entity_id: 'zone.home', above: 0 });
    if (quietly) conds.push({ condition: 'template', value_template: '{{ not fb_quiet }}' });
    seq.push(conds.length ? { if: conds, then: [say] } : say);
  }
  if (asks) {
    seq.push({
      wait_for_trigger: s.buttons.map((b, i) => ({ trigger: 'event', event_type: 'mobile_app_notification_action', event_data: { action: `{{ fb_id }}_${i + 1}` }, id: 'b' + (i + 1) })),
      timeout: { minutes: s.wait }, continue_on_timeout: true,
    });
    if (s.clear) phones.forEach((x) => seq.push({ action: 'notify.' + x.p.svc, data: { message: 'clear_notification', data: { tag } } }));
    const ch = { choose: s.buttons.map((b, i) => ({ conditions: [{ condition: 'template', value_template: `{{ wait.trigger is not none and wait.trigger.id == 'b${i + 1}' }}` }], sequence: b.then })) };
    if (s.timeout.length) ch.default = s.timeout;
    seq.push(ch);
  }
  const desc = String(M.description || '').trim();
  return Object.assign({ alias: String(M.alias || ''), description: desc ? desc + '\n\n' + T('nb_mark') : T('nb_mark'), icon: M.icon || 'mdi:bell-ring-outline', mode: 'parallel', max: 10 },
    Object.keys(vars).length ? { variables: vars } : {}, { sequence: seq });
}
// a config the same as another, the script's own name, icon and description aside (Home Assistant keeps what it's
// given, but not always in the same order)
export const canonJSON = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().filter((y) => x[y] !== undefined && x[y] !== null).map((y) => [y, x[y]])) : x));
export function nbSame(cfg, spec) {
  const strip = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => !['alias', 'icon', 'description', 'id'].includes(k)));
  return !!cfg && canonJSON(strip(cfg)) === canonJSON(strip(notifyScript(spec, {})));
}
// the description the person wrote, without the line saying how it was made
export const nbDesc = (d) => String(d || '').replace(T('nb_mark'), '').trim();
// who and what a notification can go to (info: the states, the entity and device registries, the notify actions):
// the mobile app's phones (iOS when Apple made it), people with the phones they carry, speakers and the TTS engines
export function notifyTargets(info) {
  const st = info.states || {}, svcs = new Set(Object.keys(info.services || {}).filter((k) => NB_SVC_RE.test(k)));
  const ents = info.entities || [], devs = info.devices || [];
  const phones = [], bySvc = new Map(), byDev = new Map();
  const mobDevs = devs.filter((d) => (d.identifiers || []).some((i) => i && i[0] === 'mobile_app'));
  const addPhone = (d, svc) => {
    const p = { svc, os: /apple/i.test(d.manufacturer || '') ? 'ios' : 'android', name: d.name_by_user || d.name || svc };
    phones.push(p); bySvc.set(svc, p); byDev.set(d.id, p);
  };
  mobDevs.forEach((d) => {
    const cands = [d.name, d.name_by_user].filter(Boolean).map((n) => 'mobile_app_' + slugify(n));
    const svc = svcs.size ? cands.find((c) => svcs.has(c)) : cands[0];
    if (!svc || bySvc.has(svc)) return;
    addPhone(d, svc);
  });
  // match remaining mobile_app_* services against unmatched mobile_app devices via their entity slugs (renamed phones)
  const unmatched = mobDevs.filter((d) => !byDev.has(d.id));
  if (unmatched.length) {
    const entByDev = new Map();
    ents.forEach((e) => { if (e.device_id) (entByDev.get(e.device_id) || entByDev.set(e.device_id, []).get(e.device_id)).push(e.entity_id); });
    svcs.forEach((svc) => {
      if (bySvc.has(svc)) return;
      const slug = svc.slice(11);
      const d = unmatched.find((x) => !byDev.has(x.id) && (entByDev.get(x.id) || []).some((id) => {
        const obj = id.split('.')[1] || '';
        return obj === slug || obj.startsWith(slug + '_');
      }));
      if (d) addPhone(d, svc);
    });
  }
  // a notify action of the mobile app without a device of its own (renamed in the app): still a phone
  svcs.forEach((svc) => { if (!bySvc.has(svc)) { const p = { svc, os: 'android', name: svc.slice(11).replace(/_/g, ' ') }; phones.push(p); bySvc.set(svc, p); } });
  const devOf = new Map(ents.map((e) => [e.entity_id, e.device_id]));
  const named = (id) => ((st[id] && st[id].attributes && st[id].attributes.friendly_name) || id);
  const people = Object.keys(st).filter((k) => k.startsWith('person.')).map((id) => ({
    id, name: named(id), phones: toList(st[id].attributes && st[id].attributes.device_trackers).map((t) => byDev.get(devOf.get(t))).filter(Boolean),
  }));
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  return {
    phones: phones.sort(byName), people: people.sort(byName),
    speakers: Object.keys(st).filter((k) => k.startsWith('media_player.')).map((id) => ({ id, name: named(id) })).sort(byName),
    tts: Object.keys(st).filter((k) => k.startsWith('tts.')).map((id) => ({ id, name: named(id) })).sort(byName),
  };
}

/* ---------- Automation Recipes (0.15.0): standard Home Assistant automations (#11 Left-open alert, #12 Motion light) ---------- */
export const AUTO_RECIPE_KINDS = new Set(['auto_left_open', 'auto_motion_light']);

export function cleanLeftOpen(s) {
  const src = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const ent = (v) => (typeof v === 'string' && EXACT_RE.test(v) ? v : '');
  const acts = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 50);
  return {
    entity: ent(src.entity),
    state: str(src.state || 'open', 64).trim() || 'open',
    minutes: Math.min(1440, Math.max(1, Math.round(+src.minutes) || 10)),
    repeat: Math.min(1440, Math.max(0, Math.round(+src.repeat) || 0)),
    conditionEntity: ent(src.conditionEntity),
    conditionState: str(src.conditionState || 'on', 64).trim() || 'on',
    then: acts(src.then),
    cleared: acts(src.cleared),
  };
}

export function leftOpenAutomation(spec, meta) {
  const s = cleanLeftOpen(spec), M = meta || {};
  const triggers = [{ trigger: 'state', entity_id: s.entity, to: s.state, for: { minutes: s.minutes } }];
  const conditions = s.conditionEntity ? [{ condition: 'state', entity_id: s.conditionEntity, state: s.conditionState }] : [];
  const actions = [];
  if (s.repeat > 0) {
    actions.push({
      repeat: {
        while: [{ condition: 'state', entity_id: s.entity, state: s.state }],
        sequence: s.then.concat([{ delay: { minutes: s.repeat } }]),
      },
    });
  } else {
    actions.push(...s.then);
  }
  if (s.cleared.length) {
    actions.push({ wait_for_trigger: [{ trigger: 'state', entity_id: s.entity, from: s.state }] });
    actions.push(...s.cleared);
  }
  const desc = String(M.description || '').trim();
  return {
    alias: String(M.alias || ''),
    description: desc ? desc + '\n\n' + T('rcp_auto_mark') : T('rcp_auto_mark'),
    mode: 'restart',
    triggers,
    conditions,
    actions,
  };
}

export function cleanMotionLight(s) {
  const src = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const ent = (v) => (typeof v === 'string' && EXACT_RE.test(v) ? v : '');
  const list = (v, re) => [...new Set(toList(v).map(String).filter((x) => EXACT_RE.test(x) && (!re || re.test(x))))].slice(0, 20);
  return {
    sensors: list(src.sensors),
    lights: list(src.lights, /^(light|switch)\./),
    timeout: Math.min(240, Math.max(1, Math.round(+src.timeout) || 5)),
    onlyDark: !!src.onlyDark,
    luxEntity: ent(src.luxEntity),
    luxBelow: Math.min(100000, Math.max(0, Math.round(+src.luxBelow) || 50)),
    brightness: Math.min(100, Math.max(0, Math.round(+src.brightness) || 0)),
    overrideEntity: ent(src.overrideEntity),
  };
}

export function motionLightAutomation(spec, meta) {
  const s = cleanMotionLight(spec), M = meta || {};
  const triggers = [
    { trigger: 'state', entity_id: s.sensors.length === 1 ? s.sensors[0] : s.sensors, to: 'on', id: 'motion' },
    { trigger: 'state', entity_id: s.sensors.length === 1 ? s.sensors[0] : s.sensors, to: 'off', for: { minutes: s.timeout }, id: 'clear' },
  ];
  const conditions = [];
  if (s.overrideEntity) conditions.push({ condition: 'state', entity_id: s.overrideEntity, state: 'off' });
  const onConds = [{ condition: 'trigger', id: 'motion' }];
  if (s.onlyDark) onConds.push({ condition: 'sun', after: 'sunset', before: 'sunrise' });
  if (s.luxEntity) onConds.push({ condition: 'numeric_state', entity_id: s.luxEntity, below: s.luxBelow });
  const target = { entity_id: s.lights.length === 1 ? s.lights[0] : s.lights };
  const allLights = s.lights.every((x) => x.startsWith('light.'));
  const onAct = allLights
    ? Object.assign({ action: 'light.turn_on', target }, s.brightness > 0 ? { data: { brightness_pct: s.brightness } } : {})
    : { action: 'homeassistant.turn_on', target };
  const offAct = allLights ? { action: 'light.turn_off', target } : { action: 'homeassistant.turn_off', target };
  const actions = [{
    choose: [
      { conditions: onConds, sequence: [onAct] },
      { conditions: [{ condition: 'trigger', id: 'clear' }], sequence: [offAct] },
    ],
  }];
  const desc = String(M.description || '').trim();
  return {
    alias: String(M.alias || ''),
    description: desc ? desc + '\n\n' + T('rcp_auto_mark') : T('rcp_auto_mark'),
    mode: 'restart',
    triggers,
    conditions,
    actions,
  };
}

export function cleanAutoRecipe(kind, spec) {
  if (kind === 'auto_left_open') return cleanLeftOpen(spec);
  if (kind === 'auto_motion_light') return cleanMotionLight(spec);
  return null;
}

export function generateAutoRecipe(kind, spec, meta) {
  if (kind === 'auto_left_open') return leftOpenAutomation(spec, meta);
  if (kind === 'auto_motion_light') return motionLightAutomation(spec, meta);
  return null;
}

export function autoSame(cfg, kind, spec) {
  const gen = generateAutoRecipe(kind, spec, {});
  if (!cfg || !gen) return false;
  const strip = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => !['alias', 'icon', 'description', 'id'].includes(k)));
  return canonJSON(strip(cfg)) === canonJSON(strip(gen));
}

export const autoDesc = (d) => String(d || '').replace(T('rcp_auto_mark'), '').trim();
