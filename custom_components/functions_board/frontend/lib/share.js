import { toYaml } from './wiring.js';

/* ---------- Share a Function: Home Assistant YAML Package Export (0.16.0) ----------
   Builds one clean, copyable/downloadable Home Assistant YAML package containing a function's
   automations, scripts, UI helpers, and template helpers. When anonymize is enabled (default),
   replaces personal entity IDs, device/area/floor/label IDs, friendly names, URLs, emails, IPs,
   phone numbers, long tokens, and free-text notification copy with consistent placeholders —
   so sharing on the HA forums or GitHub never leaks private home details. */

const CORE_DOMAINS = new Set([
  'homeassistant', 'automation', 'script', 'scene', 'logbook', 'persistent_notification',
  'input_boolean', 'input_number', 'input_text', 'input_select', 'input_datetime', 'input_button',
  'counter', 'timer', 'schedule', 'system_log', 'logger', 'recorder', 'sun', 'zone',
]);

const GENERIC_SERVICES = new Set((
  'turn_on turn_off toggle reload set_value select_option select_first select_last select_next select_previous '
  + 'press open_cover close_cover stop_cover toggle_cover_tilt set_cover_position set_cover_tilt_position lock unlock '
  + 'open set_temperature set_hvac_mode set_preset_mode set_fan_mode set_humidity set_percentage set_direction '
  + 'oscillate media_play media_pause media_stop media_play_pause media_next_track media_previous_track volume_set '
  + 'volume_mute volume_up volume_down play_media select_source set_datetime increment decrement reset start pause '
  + 'cancel finish change trigger create dismiss dismiss_all log set_level set_options send_command return_to_base '
  + 'clean_spot locate set_operation_mode set_away_mode set_speed snapshot record speak apply send_message'
).split(' '));

const TOPIC_WORDS = new Set((
  'zigbee2mqtt zwave zwavejs2mqtt homeassistant tasmota tele stat cmnd shellies shelly esphome frigate valetudo '
  + 'ring theengs rtl_433 openmqttgateway owntracks set get state status availability attributes config command '
  + 'cmd result sensor bridge event events device devices info lwt online power'
).split(' '));

const FREE_TEXT_KEYS = new Set([
  'message', 'title', 'subtitle', 'caption', 'body', 'content', 'comment', 'note', 'notes', 'tts', 'speech', 'say',
]);

const ID_KEYS = { area_id: 'area', floor_id: 'floor', label_id: 'label', device_id: 'device' };

const STRUCTURE = new Set((
  'mode state states trigger triggers condition conditions action actions sequence single restart queued parallel '
  + 'on off entity_id device_id area_id to from for data target service event time sun zone template delay wait '
  + 'choose default repeat if then else stop variables id alias description open closed home away true false none '
  + 'unknown unavailable idle active paused above below value sensor binary_sensor light switch cover lock fan '
  + 'climate media_player person notify script automation scene timer counter schedule'
).split(' '));

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_RE = /\b(?:https?|wss?|ftp|rtsp|mqtts?):\/\/[^\s'"<>]+/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi;
const MAC_RE = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const PHONE_RE = /(?<![\w.:+-])(?:\+\d[\d .-]{7,}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})(?![\w.:-])/g;
const SECRET_RE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;
const TOKEN_RE = /\b([a-z][a-z0-9_]*)\.([a-z0-9_]+)\b/g;
const TPL_REF_RE = /\b(area_entities|area_devices|area_id|area_name|floor_entities|floor_areas|label_entities|label_devices)\(\s*(['"])([^'"]+)\2\s*\)/g;
const KNOWN_EVENTS = new Set(['timer.started', 'timer.finished', 'timer.cancelled', 'timer.paused', 'timer.restarted', 'timer.changed']);

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export class PackageAnonymizer {
  constructor(meta = {}) {
    this._map = new Map();
    this._count = new Map();
    this._placeholders = [];
    this._domains = new Set([...CORE_DOMAINS, 'sensor', 'binary_sensor', 'light', 'switch', 'cover', 'lock', 'fan',
      'climate', 'media_player', 'person', 'device_tracker', 'notify', 'tts', 'button', 'number', 'select', 'text',
      'event', 'weather', 'vacuum', 'water_heater', 'alarm_control_panel', 'camera', 'calendar', 'todo', 'siren',
      'valve', 'humidifier', 'remote', 'update', 'group', 'mqtt', 'mobile_app', 'zwave_js']);
    this._known = new Map(); // lower -> { text, kind }
    this._re = null;

    (meta.entities || []).forEach((e) => {
      if (!e || typeof e.entity_id !== 'string') return;
      const [dom, obj] = e.entity_id.split('.');
      if (dom) this._domains.add(dom);
      if (obj && obj.length >= 6 && !STRUCTURE.has(obj.toLowerCase()) && (obj.includes('_') || /^\d+$/.test(obj))) {
        this._learn(obj, 'id');
      }
      if (e.name) this._learn(e.name, 'name');
    });
    (meta.areas || []).forEach((a) => {
      if (!a) return;
      if (a.area_id) this._learn(a.area_id, 'area');
      if (a.name) this._learn(a.name, 'area');
    });
    (meta.devices || []).forEach((d) => {
      if (!d) return;
      if (d.id) this._learn(d.id, 'device');
      if (d.name) this._learn(d.name, 'device');
    });
    if (meta.fnName) this._learn(meta.fnName, 'function');
  }

  _learn(text, kind) {
    if (!text || typeof text !== 'string') return;
    const t = text.trim();
    if (t.length < 3 || STRUCTURE.has(t.toLowerCase())) return;
    if (!this._known.has(t.toLowerCase())) this._known.set(t.toLowerCase(), { text: t, kind });
  }

  _ensureRe() {
    if (this._re !== null) return;
    const keys = [...this._known.keys()].filter((k) => k.length >= 3 && !STRUCTURE.has(k)).sort((a, b) => b.length - a.length);
    this._re = keys.length ? new RegExp(`(?<![\\w])(?:${keys.map(escRe).join('|')})(?![\\w])`, 'gi') : false;
  }

  _standIn(raw, kind) {
    const k = `${kind}:${raw}`;
    if (this._map.has(k)) return this._map.get(k);
    const n = (this._count.get(kind) || 0) + 1;
    this._count.set(kind, n);
    const val = `${kind}_${n}`;
    this._map.set(k, val);
    this._placeholders.push(val);
    return val;
  }

  entity(dom, obj) {
    if (dom === 'sun' && obj === 'sun') return 'sun.sun';
    const raw = `${dom}.${obj}`;
    const k = `ent:${raw}`;
    if (this._map.has(k)) return this._map.get(k);
    const n = (this._count.get('e:' + dom) || 0) + 1;
    this._count.set('e:' + dom, n);
    const val = `${dom}.${dom}_${n}`;
    this._map.set(k, val);
    this._placeholders.push(val);
    return val;
  }

  topic(t) {
    return String(t).split('/').map((p) => (p === '+' || p === '#' || p === '' || /^\d+$/.test(p) || TOPIC_WORDS.has(p.toLowerCase()) ? p : this._standIn(p, 'topic'))).join('/');
  }

  text(s) {
    this._ensureRe();
    let out = String(s);
    out = out.replace(URL_RE, '[url]');
    out = out.replace(EMAIL_RE, '[email]');
    out = out.replace(MAC_RE, '[mac]');
    out = out.replace(IPV6_RE, '[ip]');
    out = out.replace(IPV4_RE, '[ip]');
    out = out.replace(PHONE_RE, '[phone]');
    out = out.replace(TPL_REF_RE, (_, fn, q, arg) => {
      const kind = fn.startsWith('area_') ? 'area' : fn.startsWith('floor_') ? 'floor' : 'label';
      return `${fn}(${q}${this._standIn(arg, kind)}${q})`;
    });
    out = out.replace(TOKEN_RE, (full, dom, obj) => {
      if (!this._domains.has(dom) || KNOWN_EVENTS.has(full)) return full;
      if (GENERIC_SERVICES.has(obj) && (CORE_DOMAINS.has(dom) || dom !== 'notify')) return full;
      if (dom === 'notify' && obj !== 'send_message' && obj !== 'persistent_notification') return this.entity(dom, obj);
      if (CORE_DOMAINS.has(dom) && GENERIC_SERVICES.has(obj)) return full;
      if (dom === 'script' && GENERIC_SERVICES.has(obj)) return full;
      return this.entity(dom, obj);
    });
    if (this._re) {
      out = out.replace(this._re, (m) => {
        const hit = this._known.get(m.toLowerCase());
        return hit ? this._standIn(hit.text, hit.kind) : m;
      });
    }
    out = out.replace(SECRET_RE, (m) => this._standIn(m, 'token'));
    return out;
  }

  walk(v, key = null) {
    if (Array.isArray(v)) return v.map((x) => this.walk(x, key));
    if (v && typeof v === 'object') {
      const out = {};
      Object.entries(v).forEach(([k, val]) => {
        const nk = this._domains.has(k.split('.')[0]) && k.includes('.') ? this.text(k) : k;
        out[nk] = this.walk(val, k);
      });
      return out;
    }
    if (typeof v === 'string') {
      if (key === 'topic') return this.topic(v);
      if (key && ID_KEYS[key] && v) return this._standIn(v, ID_KEYS[key]);
      if (key === 'id' && v) return this._standIn(v, 'id');
      if (key === 'alias' || key === 'name') return this._standIn(v, key === 'alias' ? 'item' : 'name');
      if (key === 'description' && v) return '';
      if (key && FREE_TEXT_KEYS.has(key) && v) {
        // Keep Jinja structure if templated, scrub personal words/entities
        return v.includes('{{') || v.includes('{%') ? this.text(v) : `Example ${key}`;
      }
      return this.text(v);
    }
    return v;
  }

  get placeholders() { return [...new Set(this._placeholders)]; }
}

function slugify(s) {
  return String(s || 'shared_function').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'shared_function';
}

export function exportFunctionPackage(pkg, opts = {}) {
  const anonymize = opts.anonymize !== false;
  const anon = anonymize ? new PackageAnonymizer({
    fnName: pkg.name,
    entities: pkg.entities || [],
    areas: pkg.areas || [],
    devices: pkg.devices || [],
  }) : null;
  const clean = (v, key) => (anon ? anon.walk(v, key) : JSON.parse(JSON.stringify(v)));

  const doc = {};
  const stats = { automations: 0, scripts: 0, helpers: 0, templates: 0 };

  // 1. Automations
  const autos = (pkg.automations || []).filter((x) => x && x.cfg);
  if (autos.length) {
    doc.automation = autos.map((a, idx) => {
      const c = clean(a.cfg);
      if (anonymize) {
        c.id = `shared_automation_${idx + 1}`;
        c.alias = `Automation ${idx + 1}`;
        delete c.description;
      }
      return c;
    });
    stats.automations = doc.automation.length;
  }

  // 2. Scripts
  const scripts = (pkg.scripts || []).filter((x) => x && x.cfg);
  if (scripts.length) {
    doc.script = {};
    scripts.forEach((s, idx) => {
      const c = clean(s.cfg);
      const rawKey = (s.entity_id || '').replace(/^script\./, '') || `script_${idx + 1}`;
      const key = anonymize ? `script_${idx + 1}` : rawKey;
      if (anonymize) {
        c.alias = `Script ${idx + 1}`;
        delete c.description;
      }
      doc.script[key] = c;
    });
    stats.scripts = scripts.length;
  }

  // 3. UI Helpers (input_*, counter, timer, schedule)
  const helpers = (pkg.helpers || []).filter((x) => x && x.dom && x.cfg);
  helpers.forEach((h, idx) => {
    const dom = h.dom;
    const c = clean(h.cfg);
    delete c.id;
    const rawKey = (h.entity_id || '').replace(new RegExp(`^${dom}\\.`), '') || `${dom}_${idx + 1}`;
    const key = anonymize ? `${dom}_${idx + 1}` : rawKey;
    if (anonymize && c.name) c.name = `${dom.replace(/_/g, ' ')} ${idx + 1}`;
    doc[dom] = doc[dom] || {};
    doc[dom][key] = c;
    stats.helpers++;
  });

  // 4. Template helpers (sensor / binary_sensor)
  const tpls = (pkg.templates || []).filter((x) => x && x.state);
  if (tpls.length) {
    const byDom = { sensor: [], binary_sensor: [] };
    tpls.forEach((t, idx) => {
      const dom = t.dom === 'binary_sensor' ? 'binary_sensor' : 'sensor';
      const entry = {
        name: anonymize ? `Template ${dom === 'binary_sensor' ? 'Binary Sensor' : 'Sensor'} ${idx + 1}` : (t.name || t.entity_id),
        state: anon ? anon.text(t.state) : t.state,
      };
      if (t.availability) entry.availability = anon ? anon.text(t.availability) : t.availability;
      if (t.icon) entry.icon = anon ? anon.text(t.icon) : t.icon;
      if (t.attributes && typeof t.attributes === 'object' && Object.keys(t.attributes).length) {
        entry.attributes = {};
        Object.entries(t.attributes).forEach(([k, v]) => { entry.attributes[k] = anon ? anon.text(v) : v; });
      }
      byDom[dom].push(entry);
      stats.templates++;
    });
    const blk = {};
    if (byDom.sensor.length) blk.sensor = byDom.sensor;
    if (byDom.binary_sensor.length) blk.binary_sensor = byDom.binary_sensor;
    doc.template = [blk];
  }

  const title = anonymize ? 'Shared Function' : (pkg.name || 'Function');
  const slug = anonymize ? 'shared_function' : slugify(pkg.name);
  const header = [
    `# Home Assistant Package: ${title}`,
    `# Exported from Functions Board (${anonymize ? 'anonymized — safe to share' : 'real names — review before sharing'})`,
    `# Save as packages/${slug}.yaml and enable packages in configuration.yaml.`,
  ];
  const placeholders = anon ? anon.placeholders.filter((p) => p.includes('.') || /^(area|floor|label|device)_/.test(p)) : [];
  if (anonymize && placeholders.length) {
    header.push('#');
    header.push('# Placeholders to replace with your own entities/areas:');
    placeholders.slice(0, 40).forEach((p) => header.push(`#   - ${p}`));
    if (placeholders.length > 40) header.push(`#   - ... and ${placeholders.length - 40} more`);
  }
  header.push('');

  const body = Object.keys(doc).length ? toYaml(doc) : '# No exportable automations, scripts, helpers, or templates in this function.';
  return {
    yaml: header.join('\n') + body + '\n',
    filename: `${slug}.yaml`,
    stats,
    placeholders,
  };
}
