import { T, onLang } from './i18n.js';

export const STORE = 'functions_board';
// on a touch screen, how long a box is held before it moves: a phone's own long-press (0.13.0; it was a second, so the
// phone's buzz at half a second came before the box could move, and a finger moving then panned the board)
export const HOLD_MS = 500;
export const CAPTURE_KEY = 'functions_board_capture';
// Home Assistant builds a new board each time its page is opened again (back from an editor, say). What the
// last board loaded is kept here so the next one can draw at once: the registries for a few minutes, and
// refreshed behind the scenes; the trigger and condition descriptions until the page reloads.
export const WARM_MS = 10 * 60000;
// a cheap fingerprint of the registries: how many of each, and the newest change
export const regSig = (d) => d.map((list) => (list || []).length + ':' + (list || []).reduce((m, x) => Math.max(m, x.modified_at || x.created_at || 0), 0)).join('|');  // a create that left the board (phone app), in sessionStorage
export const NW = 240, NH = 62, XW = 204, XH = 40, COLG = 100, ROWG = 24;

export const HELPER_DOMAINS = new Set(['input_boolean', 'input_number', 'input_text', 'input_select', 'input_datetime',
  'input_button', 'counter', 'timer', 'schedule']);
export const HELPER_PLATFORMS = new Set(['template', 'group', 'utility_meter', 'derivative', 'integration', 'min_max',
  'threshold', 'statistics', 'trend', 'filter', 'random', 'switch_as_x', 'tod', 'history_stats',
  'generic_thermostat', 'generic_hygrostat', 'mold_indicator', 'combine']);
// the helper types Home Assistant's helpers page can create directly (/config/helpers/add?domain=...)
export let HELPER_TYPES, TYPE, BADGES, VERB;
onLang(() => {
  HELPER_TYPES = [['input_boolean', T('toggle'), 'mdi:toggle-switch-outline'], ['input_number', T('number'), 'mdi:ray-vertex'],
    ['input_text', T('text'), 'mdi:form-textbox'], ['input_select', T('dropdown'), 'mdi:format-list-bulleted'],
    ['input_datetime', T('date_and_time'), 'mdi:calendar-clock'], ['input_button', T('button'), 'mdi:gesture-tap-button'],
    ['counter', T('counter'), 'mdi:counter'], ['timer', T('timer'), 'mdi:timer-outline'], ['schedule', T('schedule'), 'mdi:calendar-month-outline']];
  TYPE = {
    automation: T('automation'), script: T('script'), input_boolean: T('toggle'), input_number: T('number'), input_text: T('text'),
    input_select: T('dropdown'), input_datetime: T('date_time'), input_button: T('button'), counter: T('counter'), timer: T('timer'),
    schedule: T('schedule'), sensor: T('sensor'), binary_sensor: T('binary_sensor'), switch: T('switch'), light: T('light'),
    fan: T('fan'), cover: T('cover'), lock: T('lock'), climate: T('climate'), media_player: T('media_player'), select: T('select'),
    number: T('number'), button: T('button'), event: T('event'), vacuum: T('vacuum'), water_heater: T('water_heater'),
    device: T('device'), service: T('action'), mqtt: T('mqtt'), person: T('person'), scene: T('scene'), update: T('update'), area: T('area'),
    floor: T('floor'), label: T('label'), weather: T('weather'), sun: T('sun'), zone: T('zone'), notify: T('notify'), device_tracker: T('tracker'),
  };
  BADGES = {
    time: ['mdi:clock-outline', T('time_trigger')], sun: ['mdi:weather-sunset', T('sun_trigger')],
    start: ['mdi:power', T('runs_when_home_assistant_starts')], webhook: ['mdi:webhook', T('webhook_trigger')],
    tag: ['mdi:nfc-variant', T('tag_trigger')], voice: ['mdi:microphone-outline', T('voice_trigger')],
    calendar: ['mdi:calendar-outline', T('calendar_trigger')],
  };
  // how an arrow reads in words, from its start {a} to its end {b}
  VERB = { trigger: T('triggers_3'), condition: T('is_checked_by_2'), action: T('changes_3'), call: T('runs_4'), source: T('is_read_by_2') };
});
export const ICONS = {
  automation: 'mdi:robot-outline', script: 'mdi:script-text-outline', input_boolean: 'mdi:toggle-switch-outline',
  input_number: 'mdi:numeric', input_text: 'mdi:form-textbox', input_select: 'mdi:format-list-bulleted',
  input_datetime: 'mdi:calendar-clock', input_button: 'mdi:gesture-tap-button', counter: 'mdi:counter',
  timer: 'mdi:timer-outline', schedule: 'mdi:calendar-clock', sensor: 'mdi:eye-outline',
  binary_sensor: 'mdi:radiobox-marked', switch: 'mdi:toggle-switch-outline', light: 'mdi:lightbulb-outline',
  fan: 'mdi:fan', cover: 'mdi:window-shutter', lock: 'mdi:lock-outline', climate: 'mdi:thermostat',
  media_player: 'mdi:speaker', person: 'mdi:account-outline', sun: 'mdi:white-balance-sunny',
  notify: 'mdi:message-arrow-right-outline', scene: 'mdi:palette-outline', select: 'mdi:form-dropdown',
  number: 'mdi:numeric', button: 'mdi:gesture-tap-button', event: 'mdi:broadcast', vacuum: 'mdi:robot-vacuum',
  water_heater: 'mdi:water-boiler', update: 'mdi:update', weather: 'mdi:weather-partly-cloudy',
  zone: 'mdi:map-marker-radius-outline', device_tracker: 'mdi:crosshairs-gps', camera: 'mdi:cctv',
};
export const COLORS = ['red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'light-blue', 'cyan', 'teal', 'green',
  'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey'];
export const DOMAINS = ['sensor', 'binary_sensor', 'switch', 'light', 'fan', 'cover', 'lock', 'climate', 'input_boolean',
  'input_number', 'input_text', 'input_select', 'input_datetime', 'input_button', 'counter', 'timer', 'schedule',
  'automation', 'script', 'scene', 'select', 'number', 'button', 'event', 'vacuum', 'water_heater', 'media_player',
  'person', 'device_tracker', 'zone', 'sun', 'weather', 'update', 'alarm_control_panel', 'humidifier', 'valve',
  'todo', 'calendar', 'image', 'camera', 'siren', 'lawn_mower', 'text', 'date', 'time', 'datetime', 'remote',
  'tts', 'notify', 'group'].join('|');
// entity IDs inside templates; rebuilt from the domains Home Assistant actually has (2.5), so
// assist_satellite.kitchen or a custom integration's domain are found too
export let ENTITY_RE = new RegExp('\\b(?:' + DOMAINS + ')\\.[a-z0-9_]+\\b', 'g');
export function setDomains(extra) {
  const all = new Set(DOMAINS.split('|').concat([...extra].filter((d) => /^[a-z0-9_]+$/.test(d))));
  ENTITY_RE = new RegExp('\\b(?:' + [...all].sort((x, y) => y.length - x.length).join('|') + ')\\.[a-z0-9_]+\\b', 'g');
}
export const EXACT_RE = /^[a-z_]+\.[a-z0-9_]+$/;
export const REGID_RE = /^[0-9a-f]{32}$/;
export const TPL_RE = /\{\{|\{%/;
export const ACTION_KEYS = new Set(['then', 'else', 'sequence', 'default', 'parallel', 'actions']);
export const COND_KEYS = new Set(['conditions', 'if', 'while', 'until', 'wait_template', 'value_template', 'wait_for_trigger']);
// keys whose value is a list of conditions, where a bare template string is a condition (Phase 9 tests them)
export const CLIST_KEYS = new Set(['conditions', 'if', 'while', 'until']);
export const COND_TYPES = new Set(['and', 'or', 'not', 'state', 'numeric_state', 'template', 'time', 'sun', 'zone', 'device', 'trigger']);
export const SKIP_KEYS = new Set(['alias', 'description', 'id', 'icon', 'mode', 'topic', 'event_type', 'payload', 'max',
  'max_exceeded', 'trigger', 'platform', 'condition']);
export const ROLE_RANK = { source: 0, condition: 1, action: 2, trigger: 3, call: 4 };

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const uid = () => Math.random().toString(36).slice(2, 10);
// a label colour goes into a style attribute: only a hex colour or a theme colour name gets through
export const cssColor = (c) => {
  const s = String(c == null ? '' : c).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^[a-z][a-z-]*$/.test(s)) return `var(--${s}-color, ${s})`;
  return 'var(--secondary-text-color)';
};
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// layouts are shared between administrators and come back from storage as plain JSON: keep what is

export function ago(iso) {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return T('never');
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return T('just_now');
  if (s < 3600) return T('min_ago', { round: Math.round(s / 60) });
  if (s < 86400) return T('h_ago', { round: Math.round(s / 3600) });
  return T('d_ago', { round: Math.round(s / 86400) });
}
export function clock(iso) {
  const d = new Date(iso || '');
  if (isNaN(d)) return '';
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return new Date().toDateString() === d.toDateString() ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
}

export const shorten = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export function clockShort(t) {
  const d = new Date(t);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
// a typed value: numbers, true/false and null as such, quoted strings unquoted

export const getPath = (o, path) => path.reduce((x, k) => (x == null ? x : x[k]), o);
// JSON with its keys sorted: two configs compare equal whatever order Home Assistant stored their keys in
// the UI helpers whose settings a version keeps (their <domain>/list, update, create and delete commands)
// a path on this Home Assistant ("/config/…"), not an address elsewhere ("//host", "https://…")
export const SAME_ORIGIN = /^\/(?![\/\\])/;
// the person asked their system for less motion: flows show their last step, views jump instead of gliding
export const lessMotion = () => !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
// the "Other…" entry of the sandbox's dropdowns
export const SBX_OTHER = '\u0001other';
// a value in the sandbox's Set that is a press (a button, a scene, an event entity: its state becomes the time), with
// the event type after it for an event entity (0.11.1)
export const SBX_PRESS = '\u0001press:';
export const VER_HELPERS = new Set(['input_boolean', 'input_number', 'input_text', 'input_select', 'input_datetime', 'input_button', 'counter', 'timer', 'schedule']);
export const VER_DOMAINS = new Set(['automation', 'script', ...VER_HELPERS]);
// what may be clicked on a saved version's board: looking, the sandbox, and the versions themselves
export const VER_OK_ACTS = /^(zoomin|zoomout|fit|togglelist|legend|hl|hl-.+|sandbox|sbx-.+|flow-.+|lit-.+|edge|close|back|newtab|modal-.+|ver-.+|vtab.*|versions|about|diag|diag-.+|problems|prob-.+|chk-run|chk-replay|hint-x|find-x|nr-open)$/;
// a short fingerprint of a snapshot's items and members: equal when the function is the same as that version
export const verPrint = (snap) => {
  const body = JSON.stringify([[...(snap.members || [])].sort(), Object.keys(snap.items || {}).sort().map((k) => [k, (snap.items[k] || {}).cfg || null])]);
  const str = canon(JSON.parse(body));
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + str.length.toString(16);
};
// a function's layout as versions compare it (0.11.3): what's laid out for the boxes on the board now (a position
// left over from a box that's gone doesn't count), its frames, notes, direction and tools, the builders' specs of
// what's there; not where it's scrolled to or which problems were dismissed
export const verLayoutKey = (L, keys) => {
  const c = Object.assign({}, L || {});
  delete c.view; delete c.dismissed; delete c.checks;
  c.nodes = Object.fromEntries(Object.entries(c.nodes || {}).filter(([k]) => keys.has(k) || k.startsWith('tool:')));
  c.builders = Object.fromEntries(Object.entries(c.builders || {}).filter(([k]) => keys.has(k)));
  if (!c.dir) c.dir = 'right';
  Object.keys(c).forEach((k) => { const x = c[k]; if (x == null || (Array.isArray(x) ? !x.length : typeof x === 'object' && !Object.keys(x).length)) delete c[k]; });
  return canon(c);
};
// every device id a config names, at any depth
export const devIdsIn = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => devIdsIn(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k === 'device_id') [].concat(x).forEach((d) => { if (typeof d === 'string' && /^[0-9a-f]{32}$/.test(d)) out.add(d); }); else devIdsIn(x, out); });
  return out;
};
// a config with some device ids swapped for others (a replaced device)
export const swapDevs = (v, map) => (Array.isArray(v) ? v.map((x) => swapDevs(x, map)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapDevs(x, map)])) : typeof v === 'string' && map[v] ? map[v] : v);
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
// an id such as garage_door.opened as words: "Garage door opened"
export const humanize = (s) => { const x = String(s).replace('.', ' ').replace(/_/g, ' '); return x.charAt(0).toUpperCase() + x.slice(1); };
// a copy of a config without the given references (from refsTo on the same config)

// what the developer tools say and use (Phase 9)
export let FULL_ONLY_TEST, TEST_WARN, DBG_FILTERS;
onLang(() => {
  FULL_ONLY_TEST = T('tests_need_full_manager_switch');
  TEST_WARN = T('tests_change_your_home_assistant');
  DBG_FILTERS = { all: [T('all'), null], state: [T('changes'), ['state', 'log']], run: [T('runs'), ['run']], call: [T('calls'), ['call']], test: [T('tests'), ['test', 'watch']] };
});
export const NO_MONITOR = new Set(['state_changed', 'call_service', 'state_reported', 'service_registered', 'component_loaded']);
export const DBG_BACK = 15 * 60000;  // the debugger starts with the last 15 minutes
export const DBG_QUIET = new Set(['logbook', 'system_log', 'recorder', 'frontend', 'browser_mod']);
export const DBG_ICON = { state: 'mdi:swap-horizontal', run: 'mdi:play-circle-outline', call: 'mdi:gesture-tap', test: 'mdi:flask-outline', watch: 'mdi:eye-outline', log: 'mdi:text-box-outline' };
export const fmtValue = (v) => shorten(v === undefined ? '' : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v), 300);
export const TEST_KINDS = new Set(['action', 'state', 'event', 'mqtt', 'notify', 'run']);
export const SVC_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
// a test kept on the board (9.2) comes back from storage as plain JSON: keep only what a test can be
export function cleanTest(t) {
  if (!t || typeof t !== 'object' || !TEST_KINDS.has(t.kind) || typeof t.target !== 'string' || t.target.length > 300) return null;
  const obj = (v) => { if (!v || typeof v !== 'object' || Array.isArray(v)) return {}; try { const j = JSON.stringify(v); return j.length <= 4000 ? JSON.parse(j) : {}; } catch (e) { return {}; } };
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const out = { kind: t.kind, target: t.target };
  if (t.kind === 'action' || t.kind === 'notify') { if (!SVC_RE.test(String(t.service))) return null; out.service = t.service; out.data = obj(t.data); }
  if (t.kind === 'state') out.state = str(t.state, 255);
  if (t.kind === 'event') { out.event_type = str(t.event_type, 255); if (!out.event_type) return null; out.event_data = obj(t.event_data); }
  if (t.kind === 'mqtt') { out.topic = str(t.topic, 255); out.payload = str(t.payload, 4000); if (!out.topic) return null; }
  if (t.kind === 'run') { if (t.skip_condition != null) out.skip_condition = !!t.skip_condition; if (t.variables) out.variables = obj(t.variables); }
  return out;
}
