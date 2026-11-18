/*!
 * Functions board v0.8.2 (prototype) for Home Assistant
 *
 * One page per "function": every automation, script, helper and device that makes one job work,
 * grouped by a Home Assistant label and wired together from their own configs.
 *
 * - A function IS a label. Everything carrying it is part of the function and still lives in its
 *   usual place (Automations, Scripts, Helpers...). Removing this board loses only the layout.
 * - Arrows come from reading each automation/script config: what triggers it, what it checks,
 *   what it changes, which scripts it runs.
 * - Runs as the sidebar page of the Functions Board integration (layouts shared between admins),
 *   or as a card on any dashboard (best in a panel view; layouts stored per user).
 */
(() => {
  'use strict';
  const VERSION = '0.8.2';
  const loaded = customElements.get('functions-board');
  if (loaded) {
    if (loaded.VERSION !== VERSION) {
      console.warn(`Functions board: v${loaded.VERSION || '0.2 or older'} is already loaded on this page, so v${VERSION} was skipped. `
        + 'Remove the old dashboard resource (Settings > Dashboards > Resources) and reload the page.');
    }
    return;
  }
  const REPO_URL = 'https://github.com/ToolAndDieGuy/functions-board';
  const STORE = 'functions_board';
  const HOLD_MS = 1000;  // on a touch screen, how long a box is held before it moves
  const CAPTURE_KEY = 'functions_board_capture';
  // Home Assistant builds a new board each time its page is opened again (back from an editor, say). What the
  // last board loaded is kept here so the next one can draw at once: the registries for a few minutes, and
  // refreshed behind the scenes; the trigger and condition descriptions until the page reloads.
  const WARM_MS = 10 * 60000;
  let REG = null, DESC = null;
  // a cheap fingerprint of the registries: how many of each, and the newest change
  const regSig = (d) => d.map((list) => (list || []).length + ':' + (list || []).reduce((m, x) => Math.max(m, x.modified_at || x.created_at || 0), 0)).join('|');  // a create that left the board (phone app), in sessionStorage
  const NW = 240, NH = 62, XW = 204, XH = 40, COLG = 100, ROWG = 24;

  /* ---------- the board's words (4.9) ---------- */
  // Every text the board shows is in STR (at the end of this section): one table per language, keyed like
  // hass.language ('de', 'pt-BR'). T('id', { name }) gives the text in the user's language, else in its base
  // language, else in English, with the {name} placeholders filled in. P('id', n) does the same for a count and
  // picks the plural form the language needs. Tables of words the code keeps at hand are built by onLang(), and
  // built again when the language changes.
  let LANG = 'en', RULES = null;
  const WORDS = [];
  function onLang(build) { WORDS.push(build); }
  function setLang(lang) {
    const base = String(lang || 'en').split('-')[0];
    const l = STR[lang] ? lang : STR[base] ? base : 'en';
    if (l === LANG && RULES) return;
    LANG = l;
    try { RULES = new Intl.PluralRules(l); } catch (e) { RULES = new Intl.PluralRules('en'); }
    WORDS.forEach((build) => build());
  }
  const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);
  function T(id, v) {
    const s = (STR[LANG] && STR[LANG][id]) || STR.en[id];
    return fill(typeof s === 'string' ? s : id, v);
  }
  function P(id, n, v) {
    const f = (STR[LANG] && STR[LANG][id]) || STR.en[id] || {};
    return fill(f[RULES.select(n)] || f.other || id, Object.assign({ n }, v));
  }

  const HELPER_DOMAINS = new Set(['input_boolean', 'input_number', 'input_text', 'input_select', 'input_datetime',
    'input_button', 'counter', 'timer', 'schedule']);
  const HELPER_PLATFORMS = new Set(['template', 'group', 'utility_meter', 'derivative', 'integration', 'min_max',
    'threshold', 'statistics', 'trend', 'filter', 'random', 'switch_as_x', 'tod', 'history_stats',
    'generic_thermostat', 'generic_hygrostat', 'mold_indicator', 'combine']);
  // the helper types Home Assistant's helpers page can create directly (/config/helpers/add?domain=...)
  let HELPER_TYPES, TYPE, BADGES, VERB;
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
  const ICONS = {
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
  const COLORS = ['red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'light-blue', 'cyan', 'teal', 'green',
    'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey'];
  const DOMAINS = ['sensor', 'binary_sensor', 'switch', 'light', 'fan', 'cover', 'lock', 'climate', 'input_boolean',
    'input_number', 'input_text', 'input_select', 'input_datetime', 'input_button', 'counter', 'timer', 'schedule',
    'automation', 'script', 'scene', 'select', 'number', 'button', 'event', 'vacuum', 'water_heater', 'media_player',
    'person', 'device_tracker', 'zone', 'sun', 'weather', 'update', 'alarm_control_panel', 'humidifier', 'valve',
    'todo', 'calendar', 'image', 'camera', 'siren', 'lawn_mower', 'text', 'date', 'time', 'datetime', 'remote',
    'tts', 'notify', 'group'].join('|');
  // entity IDs inside templates; rebuilt from the domains Home Assistant actually has (2.5), so
  // assist_satellite.kitchen or a custom integration's domain are found too
  let ENTITY_RE = new RegExp('\\b(?:' + DOMAINS + ')\\.[a-z0-9_]+\\b', 'g');
  function setDomains(extra) {
    const all = new Set(DOMAINS.split('|').concat([...extra].filter((d) => /^[a-z0-9_]+$/.test(d))));
    ENTITY_RE = new RegExp('\\b(?:' + [...all].sort((x, y) => y.length - x.length).join('|') + ')\\.[a-z0-9_]+\\b', 'g');
  }
  const EXACT_RE = /^[a-z_]+\.[a-z0-9_]+$/;
  const REGID_RE = /^[0-9a-f]{32}$/;
  const TPL_RE = /\{\{|\{%/;
  const ACTION_KEYS = new Set(['then', 'else', 'sequence', 'default', 'parallel', 'actions']);
  const COND_KEYS = new Set(['conditions', 'if', 'while', 'until', 'wait_template', 'value_template', 'wait_for_trigger']);
  // keys whose value is a list of conditions, where a bare template string is a condition (Phase 9 tests them)
  const CLIST_KEYS = new Set(['conditions', 'if', 'while', 'until']);
  const COND_TYPES = new Set(['and', 'or', 'not', 'state', 'numeric_state', 'template', 'time', 'sun', 'zone', 'device', 'trigger']);
  const SKIP_KEYS = new Set(['alias', 'description', 'id', 'icon', 'mode', 'topic', 'event_type', 'payload', 'max',
    'max_exceeded', 'trigger', 'platform', 'condition']);
  const ROLE_RANK = { source: 0, condition: 1, action: 2, trigger: 3, call: 4 };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const uid = () => Math.random().toString(36).slice(2, 10);
  // a label colour goes into a style attribute: only a hex colour or a theme colour name gets through
  const cssColor = (c) => {
    const s = String(c == null ? '' : c).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^[a-z][a-z-]*$/.test(s)) return `var(--${s}-color, ${s})`;
    return 'var(--secondary-text-color)';
  };
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  // layouts are shared between administrators and come back from storage as plain JSON: keep what is
  // drawn to numbers, short strings and safe ids, and leave keys this version doesn't know alone
  function cleanLayout(L) {
    const src = L && typeof L === 'object' && !Array.isArray(L) ? L : {};
    const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.round(+v) : d);
    const out = Object.assign({}, src, { nodes: {}, frames: [], notes: [] });
    Object.entries(src.nodes && typeof src.nodes === 'object' ? src.nodes : {}).forEach(([k, p]) => {
      if (p && typeof p === 'object' && k.length < 300) out.nodes[k] = { x: num(p.x, 0), y: num(p.y, 0) };
    });
    (Array.isArray(src.frames) ? src.frames : []).forEach((f) => {
      if (!f || !SAFE_ID.test(String(f.id))) return;
      out.frames.push({ id: String(f.id), title: String(f.title == null ? T('frame') : f.title).slice(0, 200), x: num(f.x, 0), y: num(f.y, 0), w: Math.max(200, num(f.w, 540)), h: Math.max(120, num(f.h, 340)) });
    });
    (Array.isArray(src.notes) ? src.notes : []).forEach((n) => {
      if (!n || !SAFE_ID.test(String(n.id))) return;
      out.notes.push({ id: String(n.id), text: String(n.text == null ? '' : n.text).slice(0, 10000), x: num(n.x, 0), y: num(n.y, 0), w: Math.max(120, num(n.w, 240)) });
    });
    // which way the function flows: left to right (the default) or top to bottom
    if (src.dir != null) out.dir = src.dir === 'down' ? 'down' : 'right';
    // boxes Auto-arrange leaves where they are
    if (src.keep != null) out.keep = Array.isArray(src.keep) ? src.keep.filter((k) => typeof k === 'string' && k.length < 300).slice(0, 2000) : [];
    if (out.paused != null) out.paused = Array.isArray(out.paused) ? out.paused.filter((x) => typeof x === 'string') : null;
    if (out.categories != null && typeof out.categories !== 'object') out.categories = null;
    // test buttons and monitor boxes (Phase 9): only what they can be
    if (src.tools != null) {
      out.tools = [];
      (Array.isArray(src.tools) ? src.tools : []).slice(0, 100).forEach((t) => {
        if (!t || !SAFE_ID.test(String(t.id)) || (t.type !== 'inject' && t.type !== 'monitor')) return;
        const o = { id: String(t.id), type: t.type, title: String(t.title == null ? '' : t.title).slice(0, 160) };
        if (t.type === 'inject') { o.test = cleanTest(t.test); if (!o.test) return; }
        else {
          o.what = t.what === 'mqtt' ? 'mqtt' : 'event';
          o.topic = String(t.topic == null ? '' : t.topic).slice(0, 255);
          o.target = typeof t.target === 'string' && t.target.length < 300 ? t.target : null;
          if (!o.topic) return;
        }
        out.tools.push(o);
      });
    }
    return out;
  }

  function ago(iso) {
    const t = Date.parse(iso || '');
    if (isNaN(t)) return T('never');
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return T('just_now');
    if (s < 3600) return T('min_ago', { round: Math.round(s / 60) });
    if (s < 86400) return T('h_ago', { round: Math.round(s / 3600) });
    return T('d_ago', { round: Math.round(s / 86400) });
  }
  function clock(iso) {
    const d = new Date(iso || '');
    if (isNaN(d)) return '';
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    return new Date().toDateString() === d.toDateString() ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
  }
  /* ---------- arrows: which sides they leave and enter, and how they get around boxes (7.3) ---------- */
  // facing sides: left/right when the boxes are further apart across than up and down, else top/bottom
  function sides(a, b) {
    const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    if (gapX >= gapY) return bcx >= acx ? ['r', 'l'] : ['l', 'r'];
    return bcy >= acy ? ['b', 't'] : ['t', 'b'];
  }
  const NORMAL = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1] };
  // a point on a box's side; f runs 0..1 along it (several arrows on one side spread out)
  function anchor(n, side, f) {
    const t = f == null ? 0.5 : f, pad = 2;
    if (side === 'r') return [n.x + n.w, n.y + n.h * t];
    if (side === 'l') return [n.x - pad, n.y + n.h * t];
    if (side === 't') return [n.x + n.w * t, n.y - pad];
    return [n.x + n.w * t, n.y + n.h + pad];
  }
  const inside = (p, r, m) => p[0] > r.x - m && p[0] < r.x + r.w + m && p[1] > r.y - m && p[1] < r.y + r.h + m;
  const cub = (p0, c1, c2, p1, t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]; };
  // a smooth path from p0 (leaving along n0) through waypoints to p1 (arriving against n1)
  function smoothPath(p0, n0, way, p1, n1) {
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), c = Math.min(160, Math.max(40, dist / 2));
    const fmt = (p) => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`;
    if (!way.length) {
      const c1 = [p0[0] + n0[0] * c, p0[1] + n0[1] * c], c2 = [p1[0] + n1[0] * c, p1[1] + n1[1] * c];
      return { d: `M${fmt(p0)} C${fmt(c1)} ${fmt(c2)} ${fmt(p1)}`, mid: cub(p0, c1, c2, p1, 0.5), segs: [[p0, c1, c2, p1]] };
    }
    // Catmull-Rom through the points, with the box sides fixing the tangents at both ends
    const k = Math.min(60, c);
    const pts = [[p0[0] - n0[0] * k, p0[1] - n0[1] * k], p0, ...way, p1, [p1[0] - n1[0] * k, p1[1] - n1[1] * k]];
    let d = `M${fmt(p0)}`;
    const segs = [];
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i - 1], b = pts[i], cc = pts[i + 1], e = pts[i + 2];
      const c1 = [b[0] + (cc[0] - a[0]) / 6, b[1] + (cc[1] - a[1]) / 6], c2 = [cc[0] - (e[0] - b[0]) / 6, cc[1] - (e[1] - b[1]) / 6];
      d += ` C${fmt(c1)} ${fmt(c2)} ${fmt(cc)}`;
      segs.push([b, c1, c2, cc]);
    }
    return { d, mid: way[Math.floor((way.length - 1) / 2)], segs };
  }
  // boxes a path runs through (sampled), in the order the path meets them
  function blockers(segs, boxes, skip) {
    const hit = [];
    segs.forEach((s) => { for (let t = 0.05; t < 1; t += 0.05) { const p = cub(s[0], s[1], s[2], s[3], t); boxes.forEach((b) => { if (!skip.has(b) && !hit.includes(b) && inside(p, b, 6)) hit.push(b); }); } });
    return hit;
  }
  // geometry of one arrow: facing sides, spread position on each side (fa, fb), the automatic layout's
  // waypoints when there are any, and a detour around any box in the way
  function edgeGeom(a, b, o = {}) {
    const [sa, sb] = o.sides || sides(a, b);
    const p0 = anchor(a, sa, o.fa), p1 = anchor(b, sb, o.fb);
    let way = (o.way || []).slice();
    let g = smoothPath(p0, NORMAL[sa], way, p1, NORMAL[sb]);
    if (o.boxes && o.boxes.length) {
      const skip = new Set([a, b]);
      for (let pass = 0; pass < 3; pass++) {
        const hit = blockers(g.segs, o.boxes, skip);
        if (!hit.length) break;
        const horiz = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]);
        hit.slice(0, 3).forEach((bx) => {
          skip.add(bx);
          const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
          const w = horiz ? [cx, (p0[1] + p1[1]) / 2 <= cy ? bx.y - 18 : bx.y + bx.h + 18] : [(p0[0] + p1[0]) / 2 <= cx ? bx.x - 18 : bx.x + bx.w + 18, cy];
          way.push(w);
        });
        way.sort((u, v) => (horiz ? (u[0] - v[0]) * Math.sign(p1[0] - p0[0] || 1) : (u[1] - v[1]) * Math.sign(p1[1] - p0[1] || 1)));
        g = smoothPath(p0, NORMAL[sa], way, p1, NORMAL[sb]);
      }
    }
    return { d: g.d, mx: g.mid[0], my: g.mid[1], sides: [sa, sb], way };
  }

  /* ---------- square-cornered arrows ---------- */
  // the arrow and layout style: arrows coloured by what they do, square-cornered (or curved, the Arrows menu's
  // choice: CURVED, set by the board before it lays out and draws), boxes lined up with what they connect to,
  // separate chains packed together, a function too wide for a screen folded into rows.
  // window.__fbStyle overrides any of it (for comparing styles in tests).
  let CURVED = false;
  const PROTO = () => Object.assign({ color: 1, ortho: !CURVED, align: 1, bands: 1, pack: 1 }, (typeof window !== 'undefined' && window.__fbStyle) || {});
  // SEP: the least room between two arrows that run side by side
  const STUB = 18, SEP = 16, RAD = 14, HOP = 5;
  // right side to left side whenever the boxes stand apart sideways (a target to the left is reached round the
  // outside), so every arrow reads left to right at both ends; top and bottom only for boxes stacked in a column
  function orthoSides(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (ox > -2 * STUB) return b.y + b.h / 2 >= a.y + a.h / 2 ? ['b', 't'] : ['t', 'b'];
    return ['r', 'l'];
  }
  const hitsBox = (x0, y0, x1, y1, b, m) => Math.max(x0, x1) > b.x - m && Math.min(x0, x1) < b.x + b.w + m && Math.max(y0, y1) > b.y - m && Math.min(y0, y1) < b.y + b.h + m;
  // the row nearest y where a level run from x0 to x1 meets no box
  // (with room either side for other arrows taking the same way, where there is such a row)
  function clearY(y, x0, x1, boxes, skip) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    for (const m of [30, 6]) {
      const cand = [y];
      boxes.forEach((b) => { if (!skip.has(b) && b.x < hi && b.x + b.w > lo) cand.push(b.y - m - 10, b.y + b.h + m + 10); });
      const ok = cand.filter((c) => !boxes.some((b) => !skip.has(b) && hitsBox(lo, c, hi, c, b, m)));
      if (ok.length) return ok.sort((u, v) => Math.abs(u - y) - Math.abs(v - y))[0];
    }
    return y;
  }
  // the column nearest x, between lo and hi, where an upright run from y0 to y1 meets no box
  function clearX(x, y0, y1, lo, hi, boxes, skip) {
    const cand = [x];
    boxes.forEach((b) => { if (!skip.has(b) && b.y < Math.max(y0, y1) && b.y + b.h > Math.min(y0, y1)) cand.push(b.x - 14, b.x + b.w + 14); });
    const ok = cand.filter((c) => c >= lo && c <= hi && !boxes.some((b) => !skip.has(b) && hitsBox(c, y0, c, y1, b, 4)));
    return ok.length ? ok.sort((u, v) => Math.abs(u - x) - Math.abs(v - x))[0] : null;
  }
  const segClear = (pts, boxes, skip) => pts.every((p, i) => !i || !boxes.some((b) => !skip.has(b) && hitsBox(pts[i - 1][0], pts[i - 1][1], p[0], p[1], b, 3)));
  // the corner points of one arrow: way are the automatic layout's slots for an arrow that skips columns
  function orthoRoute(a, b, sd, fa, fb, way, boxes) {
    const p0 = anchor(a, sd[0], fa), p1 = anchor(b, sd[1], fb), skip = new Set([a, b]);
    if (sd[0] === 'b' || sd[0] === 't') {
      const my = clearY((p0[1] + p1[1]) / 2, p0[0], p1[0], boxes, skip), v = [p0, [p0[0], my], [p1[0], my], p1];
      if (segClear(v, boxes, skip)) return v;
      // something stands between them: out of the right side and round, into the left
      p0[0] = a.x + a.w; p0[1] = a.y + a.h / 2; p1[0] = b.x - 2; p1[1] = b.y + b.h / 2;
      const rx = Math.max(p0[0], p1[0] + 2 * STUB) + STUB, lx = p1[0] - STUB;
      const g1 = clearY(p1[1] > p0[1] ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2, lx, rx, boxes, new Set());
      return [p0, [rx, p0[1]], [rx, g1], [lx, g1], [lx, p1[1]], p1];
    }
    p0[0] = a.x + a.w; p1[0] = b.x - 2;
    const around = (x, y, tx, ty) => {
      // the run back across clears the two ends' own boxes as well
      const rx = x + STUB, lx = tx - STUB, gy = clearY((y + ty) / 2, Math.min(rx, lx), Math.max(rx, lx), boxes, new Set());
      return [[rx, y], [rx, gy], [lx, gy], [lx, ty]];
    };
    const pts = [p0];
    let x = p0[0], y = p0[1];
    // a slot spans its column (w[2] is half the column's width)
    const stops = (way || []).map((w) => ({ x: w[0] - (w[2] || NW / 2), y: w[1], out: w[0] + (w[2] || NW / 2) })).concat([{ x: p1[0], y: p1[1], out: p1[0], end: true }]);
    for (const s of stops) {
      if (s.x - x >= (way && way.length ? 8 : 2 * STUB)) {
        if (Math.abs(s.y - y) > 0.5) {
          let cx = (x + s.x) / 2;
          if (!way || !way.length) { const c = clearX(cx, y, s.y, x + STUB, s.x - STUB, boxes, skip); if (c != null) cx = c; }
          pts.push([cx, y], [cx, s.y]);
        }
      } else pts.push(...around(x, y, s.x, s.y));
      x = s.out; y = s.y;
    }
    pts.push(p1);
    if (!(way && way.length) && !segClear(pts, boxes, skip)) return [p0, ...around(p0[0], p0[1], p1[0], p1[1]), p1];
    return pts;
  }
  // spread upright runs that share a gap into lanes, and level runs that share a row likewise
  // owners: per route, a trunk name for its first upright run (arrows from one box) and its last (arrows into one
  // box); runs with the same trunk share a lane, so a fan-out reads as one line that branches
  // runs that would overlap side by side, less than SEP apart
  const clash = (p, q) => p.lo < q.hi + SEP && q.lo < p.hi + SEP;
  // puts runs sharing a channel in lanes (it.lane), in an order across the channel that has arrows cross each other
  // as little as possible; runs that don't overlap can share a lane. Returns the number of lanes.
  function orderLanes(items) {
    // p before q costs the joins of p heading past q, and of q heading back past p
    // (and, much worse, a join of p heading past q at about the height of one of q's heading back: those two would
    // run along each other)
    const cost = (p, q) => p.ats.filter(([t, s]) => s > 0 && t > q.lo + 0.5 && t < q.hi - 0.5).length + q.ats.filter(([t, s]) => s < 0 && t > p.lo + 0.5 && t < p.hi - 0.5).length
      + 1000 * p.ats.filter(([t, s]) => s > 0 && q.ats.some(([t2, s2]) => s2 < 0 && Math.abs(t - t2) < SEP)).length;
    items.sort((p, q) => p.c - q.c || p.lo - q.lo);
    // (only runs that overlap need an order; a few passes settle it)
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let j = 0; j < items.length; j++) for (let k = j + 1; k < items.length; k++) {
        if (clash(items[j], items[k]) && cost(items[j], items[k]) > cost(items[k], items[j])) { items.splice(j, 0, items.splice(k, 1)[0]); moved = true; }
      }
      if (!moved) break;
    }
    // lanes keep that order between runs that overlap
    items.forEach((it, j) => { it.lane = 0; for (let k = 0; k < j; k++) if (clash(items[k], it)) it.lane = Math.max(it.lane, items[k].lane + 1); });
    return items.length ? Math.max(...items.map((it) => it.lane)) + 1 : 0;
  }
  function laneSpread(routes, owners, boxes, short) {
    // the runs in the middle of each arrow (not the short stubs at its two boxes), upright (a = 0) and level (a = 1);
    // c is where the run is across its direction, lo..hi its extent along it, ats where other parts of the arrow
    // join it (at, and -1 or 1 for the side they go off to)
    const runs = [[], []];
    routes.forEach((pts, ri) => {
      let firstV = -1, lastV = -1;
      for (let i = 2; i < pts.length - 1; i++) {
        const u = pts[i - 1], v = pts[i];
        if (Math.abs(u[0] - v[0]) < 0.5 && Math.abs(u[1] - v[1]) > 0.5) { if (firstV < 0) firstV = i; lastV = i; }
      }
      for (let i = 2; i < pts.length - 1; i++) {
        const u = pts[i - 1], v = pts[i];
        const vert = Math.abs(u[0] - v[0]) < 0.5 && Math.abs(u[1] - v[1]) > 0.5, hor = Math.abs(u[1] - v[1]) < 0.5 && Math.abs(u[0] - v[0]) > 0.5;
        if (!vert && !hor) continue;
        const a = vert ? 0 : 1, b = 1 - a, o = owners && owners[ri];
        const own = vert && o ? (i === firstV && o[0] ? o[0] : i === lastV && o[1] ? o[1] : null) : null;
        const ats = [[u[b], Math.sign(pts[i - 2][a] - u[a])], [v[b], Math.sign(pts[i + 1][a] - v[a])]];
        // it can't move past the far ends of the runs either side of it, or they would turn back on themselves
        const lim = [-Infinity, Infinity];
        [pts[i - 2][a], pts[i + 1][a]].forEach((z) => { if (z < u[a]) lim[0] = Math.max(lim[0], z + 8); else if (z > u[a]) lim[1] = Math.min(lim[1], z - 8); });
        runs[a].push({ ri, i, own, c: u[a], lo: Math.min(u[b], v[b]), hi: Math.max(u[b], v[b]), ats, lim });
      }
    });
    [0, 1].forEach((a) => {
      // a trunk's runs become one item; others are an item each. Each item gets the free room either side of it,
      // between the boxes beside it (L..R)
      const items = [], byOwn = new Map();
      runs[a].forEach((r) => {
        let L = -Infinity, R = Infinity;
        boxes.forEach((bx) => {
          const s0 = a ? bx.y : bx.x, s1 = s0 + (a ? bx.h : bx.w), t0 = a ? bx.x : bx.y, t1 = t0 + (a ? bx.w : bx.h);
          if (t1 <= r.lo || t0 >= r.hi) return;
          if (s1 <= r.c + 1) L = Math.max(L, s1); else if (s0 >= r.c - 1) R = Math.min(R, s0);
        });
        const marg = a ? 8 : STUB;
        L = Math.max(L, r.lim[0] - marg); R = Math.min(R, r.lim[1] + marg);
        const it = r.own && byOwn.get(r.own);
        if (it) { it.rs.push(r); it.lo = Math.min(it.lo, r.lo); it.hi = Math.max(it.hi, r.hi); it.ats.push(...r.ats); it.L = Math.max(it.L, L); it.R = Math.min(it.R, R); return; }
        const nw = { rs: [r], lo: r.lo, hi: r.hi, ats: r.ats.slice(), c: r.c, L, R };
        items.push(nw); if (r.own) byOwn.set(r.own, nw);
      });
      // items that run alongside each other in the same free room form a channel: close together, or with rooms
      // that overlap (a run round the outside of a box shares the gap the arrows between the columns turn in)
      const marg = a ? 8 : STUB, near = a ? SEP + 4 : 40;
      const up = items.map((_, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
      const room = items.map((it) => [it.L, it.R]);
      items.forEach((p, i) => items.forEach((q, j) => {
        if (j <= i || !clash(p, q)) return;
        const fi = find(i), fj = find(j);
        if (fi === fj) return;
        const L = Math.max(room[fi][0], room[fj][0]), R = Math.min(room[fi][1], room[fj][1]);
        // (level runs only when close: the automatic layout already keeps their rows apart)
        if (a ? Math.abs(p.c - q.c) >= near : R - L < 2 * marg || (Math.abs(p.c - q.c) >= near && !(isFinite(L) && isFinite(R)))) return;
        up[fi] = fj; room[fj] = [L, R];
      }));
      const chans = new Map();
      items.forEach((it, i) => { const k = find(i); if (!chans.has(k)) chans.set(k, []); chans.get(k).push(it); });
      chans.forEach((ch) => {
        if (ch.length < 2) return;
        const n = orderLanes(ch), c0 = Math.min(...ch.map((it) => it.c)), c1 = Math.max(...ch.map((it) => it.c));
        let [L, R] = room[find(items.indexOf(ch[0]))];
        // no box on a side: the lanes stay about where the runs were
        if (!isFinite(L) && !isFinite(R)) { L = (c0 + c1) / 2 - marg - ((n - 1) * SEP) / 2; R = L + 2 * marg + (n - 1) * SEP; }
        else if (!isFinite(L)) L = Math.min(c0 - marg, R - 2 * marg - (n - 1) * SEP);
        else if (!isFinite(R)) R = Math.max(c1 + marg, L + 2 * marg + (n - 1) * SEP);
        // upright lanes sit in the middle of their gap; level ones stay about where they were, inside the room
        const space = R - L - 2 * marg, sep = n > 1 ? Math.max(4, Math.min(SEP, space / (n - 1))) : 0, half = ((n - 1) * sep) / 2;
        if (short && !a && n > 1 && space < (n - 1) * SEP - 0.5) short.push({ x: (L + R) / 2, lo: Math.min(...ch.map((it) => it.lo)), hi: Math.max(...ch.map((it) => it.hi)), need: (n - 1) * SEP - space });
        const mean = ch.reduce((t, it) => t + it.c, 0) / ch.length;
        const mid = !a ? (L + R) / 2 : space < 2 * half ? (L + R) / 2 : Math.min(Math.max(mean, L + marg + half), R - marg - half);
        ch.forEach((it) => {
          const at = mid + (it.lane - (n - 1) / 2) * sep;
          it.rs.forEach((r) => { const pts = routes[r.ri]; pts[r.i - 1][a] = at; pts[r.i][a] = at; });
        });
      });
    });
  }
  // a last pass for runs still closer than SEP to another arrow's (lanes in two channels that meet, a row that
  // happens to line up with a slot): each is moved aside, to the nearest spot that is clear of boxes and other arrows
  function untangle(routes, owners, ends, boxes) {
    const segs = () => {
      const out = [];
      routes.forEach((pts, ri) => {
        const o = owners[ri] || [null, null], last = pts.length - 1;
        let firstV = -1, lastV = -1;
        for (let i = 1; i <= last; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5 && Math.abs(pts[i - 1][1] - pts[i][1]) > 0.5) { if (firstV < 0) firstV = i; lastV = i; }
        for (let i = 1; i <= last; i++) {
          const u = pts[i - 1], v = pts[i];
          if (Math.hypot(u[0] - v[0], u[1] - v[1]) < 0.5) continue;
          const a = Math.abs(u[0] - v[0]) < 0.5 ? 0 : 1, b = 1 - a;
          const own = o[0] && (firstV < 0 || i <= firstV) ? o[0] : o[1] && (lastV < 0 || i >= lastV) ? o[1] : null;
          // a level stub at either end can slide along its box's side
          const stub = !own && a === 1 && last > 1 && (i === 1 || i === last) ? (i === 1 ? ends[ri][0] : ends[ri][1]) : null;
          // (end: the side of a box it starts or ends at; arrows there are as far apart as that side allows)
          const endBox = i === 1 ? ends[ri][0] : i === last ? ends[ri][1] : null;
          out.push({ ri, i, a, own, c: u[a], lo: Math.min(u[b], v[b]), hi: Math.max(u[b], v[b]), stub, end: endBox ? (i === 1 ? 'a' : 'b') : null, endBox, fixed: !stub && (i === 1 || i === last || !!own) });
        }
      });
      return out;
    };
    // (an arrow running into or out of its own trunk's line is that trunk, not alongside it)
    const mine = (s, t) => s.own && (owners[t.ri] || []).includes(s.own);
    const sameSide = (s, t) => s.end && s.end === t.end && s.endBox === t.endBox && Math.abs(s.c - t.c) >= 10;
    const near = (s, t) => s.ri !== t.ri && s.a === t.a && !mine(s, t) && !mine(t, s) && !sameSide(s, t) && Math.abs(s.c - t.c) < SEP - 0.5 && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 1;
    const blocked = (ri, p, q) => boxes.some((bx) => bx !== ends[ri][0] && bx !== ends[ri][1] && hitsBox(p[0], p[1], q[0], q[1], bx, 4));
    for (let pass = 0; pass < 4; pass++) {
        const S = segs();
        let moved = false;
        // move run t (keeping the runs either side of it going the same way) to the first of tries that works
        const tryMove = (t, tries) => {
          const pts = routes[t.ri], u = pts[t.i - 1], v = pts[t.i], prev = pts[t.i - 2], next = pts[t.i + 1], a = t.a;
          tries.sort((p, q) => Math.abs(p - t.c) - Math.abs(q - t.c));
          for (const c of tries) {
            // the runs either side keep their direction and some length
            if ((prev && (prev[a] - u[a]) * (prev[a] - c) <= 16) || (next && (next[a] - v[a]) * (next[a] - c) <= 16)) continue;
            if (t.stub && (c < t.stub.y + 8 || c > t.stub.y + t.stub.h - 8)) continue;
            const nu = u.slice(), nv = v.slice(); nu[a] = c; nv[a] = c;
            if (blocked(t.ri, nu, nv) || (prev && blocked(t.ri, prev, nu)) || (next && blocked(t.ri, nv, next))) continue;
            // it ends up along no other arrow, and it and the two runs it stretches along fewer than before
            const side = (p, q) => ({ ri: t.ri, a: 1 - a, own: t.own, c: p[1 - a], lo: Math.min(p[a], q[a]), hi: Math.max(p[a], q[a]) });
            const score = (x, y, z) => S.filter((s) => s.ri !== t.ri && (near(s, x) || (y && near(s, y)) || (z && near(s, z)))).length;
            const me = { ri: t.ri, a, own: t.own, c, lo: t.lo, hi: t.hi };
            if (S.some((s) => s.ri !== t.ri && near(s, me))) continue;
            if (score(me, prev && side(prev, nu), next && side(nv, next)) >= score(t, prev && side(prev, u), next && side(v, next))) continue;
            u[a] = c; v[a] = c; t.c = c;
            return true;
          }
          return false;
        };
        S.forEach((t) => {
          const hit = S.filter((s) => near(s, t));
          if (!hit.length) return;
          if (!t.fixed) {
            // spots either side, nearest first (a stub anywhere along its box's side)
            const tries = [];
            for (let k = 1; k <= (t.stub ? 3 : 6); k++) hit.forEach((s) => { tries.push(s.c + Math.sign(t.c - s.c || 1) * SEP * k, s.c - Math.sign(t.c - s.c || 1) * SEP * k); });
            if (t.stub) for (let c = t.stub.y + 8; c <= t.stub.y + t.stub.h - 8; c += 2) tries.push(c);
            if (tryMove(t, tries)) { moved = true; return; }
          }
          // or shorten it, by moving a turn at one of its ends past where the other arrow's run ends
          for (const j of [t.i - 1, t.i + 1]) {
            const nb = S.find((s) => s.ri === t.ri && s.i === j);
            if (!nb || nb.fixed || nb.stub) continue;
            if (tryMove(nb, hit.flatMap((s) => [s.lo - 10, s.lo - SEP - 2, s.lo - 2 * SEP - 2, s.hi + 10, s.hi + SEP + 2, s.hi + 2 * SEP + 2]))) { moved = true; return; }
          }
        });
        if (!moved) break;
      }
    // a short step up or down in the middle of a level run (two lanes that happen to sit at different heights)
    // reads as a turn the wrong way: the run goes straight instead, where that is clear of boxes and other arrows
    const S = segs(), seg = (ri, a, p, q) => ({ ri, a, own: null, c: p[a], lo: Math.min(p[1 - a], q[1 - a]), hi: Math.max(p[1 - a], q[1 - a]) });
    const fine = (ri, list) => list.every(([p, q]) => !blocked(ri, p, q) && !S.some((s) => s.ri !== ri && near(s, seg(ri, Math.abs(p[0] - q[0]) < 0.5 ? 0 : 1, p, q))));
    routes.forEach((pts, ri) => {
      if ((owners[ri] || []).some(Boolean)) return;
      for (let i = 2; i < pts.length - 1; i++) {
        const a0 = pts[i - 2], u = pts[i - 1], v = pts[i], b1 = pts[i + 1], dy = v[1] - u[1];
        if (Math.abs(u[0] - v[0]) > 0.5 || Math.abs(dy) < 0.5 || Math.abs(dy) > 48) continue;
        if (Math.abs(a0[1] - u[1]) > 0.5 || Math.abs(b1[1] - v[1]) > 0.5 || Math.sign(u[0] - a0[0]) !== Math.sign(b1[0] - v[0])) continue;
        const last = pts.length - 1;
        // the later run up (or down) to the earlier one's height, or the earlier one to the later one's
        if (i + 1 < last) {
          const nb = [b1[0], u[1]], c2 = pts[i + 2];
          if (fine(ri, [[u, nb], [nb, c2]])) { v[1] = u[1]; b1[1] = u[1]; continue; }
        }
        if (i - 2 >= 1) {
          const na = [a0[0], v[1]], c0 = pts[i - 3];
          if (fine(ri, [[na, v], [c0, na]])) { a0[1] = v[1]; u[1] = v[1]; }
        }
      }
    });
  }
  // each arrow leaves and enters the sides that face each other; arrows sharing a side spread along it, in the
  // order of where their other ends are, so they don't stack (7.3)
  // the three points on each side of a box where square-cornered arrows leave and enter (they show as dots)
  const portYs = (h) => { const st = Math.min(18, (h - 16) / 2); return [h / 2 - st, h / 2, h / 2 + st]; };
  function arrowGeo(E, boxOf, sideFn) {
    return spreadEnds(E.map((e) => { const a = boxOf(e.from), b = boxOf(e.to); return { e, a, b, s: sideFn(a, b), fa: 0.5, fb: 0.5 }; }));
  }
  // (bus: per side key, the arrows that run as one line there; they share one point on that side)
  function spreadEnds(geo, bus, ports) {
    const slots = new Map();
    geo.forEach((g) => {
      [[g.e.from, g.s[0], g.b, 0], [g.e.to, g.s[1], g.a, 1]].forEach(([k, side, other, end]) => {
        const key = k + '|' + side;
        if (!slots.has(key)) slots.set(key, []);
        slots.get(key).push({ g, end, at: side === 'l' || side === 'r' ? other.y + other.h / 2 : other.x + other.w / 2 });
      });
    });
    slots.forEach((list, key) => {
      const bs = (bus && bus.get(key)) || [], b = bs.length;
      // a bus counts as one, where the middle of its arrows' other ends is
      let items = list.map((it) => ({ at: it.at, its: [it] }));
      bs.forEach((set) => {
        const mine = items.filter((x) => x.its.length === 1 && set.has(x.its[0].g)), ats = mine.map((x) => x.at).sort((p, q) => p - q);
        if (mine.length) items = items.filter((x) => !mine.includes(x)).concat([{ at: ats[Math.floor(ats.length / 2)], its: mine.map((x) => x.its[0]) }]);
      });
      if (items.length < 2 && !b) return;
      items.sort((x, y) => x.at - y.at);
      const g0 = list[0].g, box = list[0].end === 0 ? g0.a : g0.b, side = key.slice(key.lastIndexOf('|') + 1), H = side === 'l' || side === 'r' ? box.h : box.w;
      // at the side's three points (one arrow in the middle, two at the outer ones) when they fit there,
      // otherwise evenly along the side, up to 18 px apart, clear of its corners
      const P = portYs(H), at = ports && (side === 'l' || side === 'r') && items.length <= 3 ? (items.length === 1 ? [P[1]] : items.length === 2 ? [P[0], P[2]] : P) : null;
      const step = items.length > 1 ? Math.min(18, (H - 16) / (items.length - 1)) : 0, top = H / 2 - (step * (items.length - 1)) / 2;
      items.forEach((x, i) => { const f = (at ? at[i] : top + step * i) / H; x.its.forEach((it) => { if (it.end === 0) it.g.fa = f; else it.g.fb = f; }); });
    });
    return geo;
  }
  // the square-cornered arrows for all of geo: corner points per arrow, and which trunk each end is part of.
  // short: where lanes had to be squeezed closer than SEP (for the automatic layout to widen those gaps)
  function orthoAll(geo, wayOf, boxes, short) {
    // boxes stacked in a column with something between them are joined right side to left side instead
    let swapped = false;
    geo.forEach((g) => {
      if (g.s[0] !== 'b' && g.s[0] !== 't') return;
      const r = orthoRoute(g.a, g.b, g.s, 0.5, 0.5, null, boxes);
      if (r.length > 4) { g.s = ['r', 'l']; swapped = true; }
    });
    if (swapped) { geo.forEach((g) => { g.fa = 0.5; g.fb = 0.5; }); spreadEnds(geo); }
    // up to three arrows leave (or enter) one side of a box at points of their own; more than that share three
    // points, the arrows at each running as one line that branches, a bus, with a dot at each branch. A bus holds
    // one kind of arrow, and an arrow is in one bus at most (the bigger), so two buses never share a line.
    const sideOf = new Map();
    geo.forEach((g) => {
      [['out:' + g.e.from, g.s[0] === 'r', g.b], ['in:' + g.e.to, g.s[1] === 'l', g.a]].forEach(([k, ok, other]) => {
        if (!ok) return;
        if (!sideOf.has(k)) sideOf.set(k, []);
        sideOf.get(k).push({ g, at: other.y + other.h / 2 });
      });
    });
    let buses = new Map();
    sideOf.forEach((list, k) => {
      if (list.length <= 3) return;
      list.sort((p, q) => p.at - q.at);
      // three points shared out between the kinds there by how many each has (each kind gets one at least), each
      // kind's arrows split between its points in the order of their other ends
      const byRole = new Map();
      list.forEach((x) => { if (!byRole.has(x.g.e.role)) byRole.set(x.g.e.role, []); byRole.get(x.g.e.role).push(x.g); });
      const roles = [...byRole.entries()].sort((p, q) => q[1].length - p[1].length), pts = roles.map(() => 1);
      for (let left = 3 - roles.length, j = 0; left > 0; left--, j = (j + 1) % roles.length) if (roles[j][1].length > pts[j]) pts[j]++;
      roles.forEach(([role, gs], j) => {
        for (let q = 0; q < pts[j]; q++) {
          const set = new Set(gs.slice(Math.round((q * gs.length) / pts[j]), Math.round(((q + 1) * gs.length) / pts[j])));
          if (set.size >= 2) buses.set(k + '#' + role + q, set);
        }
      });
    });
    for (let pass = 0; pass < 2; pass++) {
      const of = (g) => [...buses].filter(([, set]) => set.has(g));
      geo.forEach((g) => { const in2 = of(g); if (in2.length > 1) in2.sort((p, q) => q[1].size - p[1].size).slice(1).forEach(([, set]) => set.delete(g)); });
      buses = new Map([...buses].filter(([, set]) => set.size >= 2));
    }
    const owners = geo.map((g) => {
      const o = [null, null];
      buses.forEach((set, k) => { if (set.has(g)) o[k.startsWith('out:') ? 0 : 1] = k; });
      return o;
    });
    // per side of a box, the buses there
    const sideBus = new Map();
    buses.forEach((set, k) => {
      const key = (k.startsWith('out:') ? k.slice(4, k.lastIndexOf('#')) + '|r' : k.slice(3, k.lastIndexOf('#')) + '|l');
      if (!sideBus.has(key)) sideBus.set(key, []);
      sideBus.get(key).push(set);
    });
    geo.forEach((g) => { g.fa = 0.5; g.fb = 0.5; });
    spreadEnds(geo, sideBus, true);
    const ways = geo.map((g) => wayOf(g.e, g.s)), routes = geo.map((g, i) => orthoRoute(g.a, g.b, g.s, g.fa, g.fb, ways[i], boxes));
    // the automatic layout's slots for arrows passing a column bound the gaps either side of them like boxes do
    const slotBoxes = ways.flat().filter(Boolean).map((w) => ({ x: w[0] - (w[2] || NW / 2), y: w[1] - 12, w: 2 * (w[2] || NW / 2), h: 24 }));
    laneSpread(routes, owners, boxes.concat(slotBoxes), short);
    untangle(routes, owners, geo.map((g) => [g.a, g.b]), boxes);
    const R = routes.map((pts) => {
      const q = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
      // (and no corner where a run just carries on)
      return q.filter((p, i) => i === 0 || i === q.length - 1 || !((Math.abs(q[i - 1][0] - p[0]) < 0.5 && Math.abs(q[i + 1][0] - p[0]) < 0.5) || (Math.abs(q[i - 1][1] - p[1]) < 0.5 && Math.abs(q[i + 1][1] - p[1]) < 0.5)));
    });
    const bd = busDots(R, owners, geo);
    return { routes: R, owners, dots: bd.dots, tags: bd.tags, hops: hopsOf(R, owners) };
  }
  // a dot where a bus branches (or is joined), as on a wiring diagram: where lines cross without one, they don't meet
  // arrows that share a line each get a letter of their own in the function (tag: 0 for A, 1 for B, …), shown at the two
  // places they stand apart: where they branch off the shared line, and beside the point on the box at their own end
  function busDots(routes, owners, geo) {
    const by = new Map();
    routes.forEach((pts, ri) => {
      (owners[ri] || []).forEach((own, end) => {
        if (!own) return;
        let v = -1;
        for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5 && Math.abs(pts[i - 1][1] - pts[i][1]) > 0.5) { v = i; if (end === 0) break; }
        if (!by.has(own)) by.set(own, { own, role: geo[ri].e.role, x: null, ys: [], ms: [] });
        const b = by.get(own);
        // where it leaves (or joins) the shared line; a member with no turn does so where it runs straight through
        const turn = v < 0 ? pts[0][1] : end === 0 ? pts[v][1] : pts[v - 1][1];
        // its own end: the far end of an arrow out of a shared point, the start of one into it
        const far = end === 0 ? pts[pts.length - 1] : pts[0];
        b.ms.push({ ri, turn, far });
        if (v < 0) { b.ys.push(pts[0][1]); return; }
        b.x = pts[v][0];
        b.ys.push(pts[v - 1][1], pts[v][1]);
      });
    });
    const dots = [], tags = new Map();
    // A, B, C… across the whole function, so no two arrows near each other share one: line by line from the top,
    // and down each line in the order their own ends sit, so the letters read in order at both ends
    let next = 0;
    const top = (b) => Math.min(...b.ms.map((m) => m.far[1]));
    [...by.values()].sort((p, q) => top(p) - top(q) || (p.x == null ? 0 : p.x) - (q.x == null ? 0 : q.x)).forEach((b) => {
      b.ms.sort((p, q) => p.far[1] - q.far[1] || p.turn - q.turn).forEach((m) => { m.tag = next++; tags.set(m.ri, { tag: m.tag, own: b.own, far: m.far, role: b.role }); });
      if (b.x == null) return;
      const lo = Math.min(...b.ys), hi = Math.max(...b.ys), seen = [];
      b.ms.forEach((m) => {
        if (m.turn <= lo + 1 || m.turn >= hi - 1 || seen.some((z) => Math.abs(z - m.turn) < 1)) return;
        seen.push(m.turn);
        dots.push({ x: b.x, y: m.turn, role: b.role, own: b.own, tag: m.tag, ri: m.ri });
      });
      // where the shared line itself splits, up and down, a plain dot in the colour of its kind
      b.ys.forEach((y) => {
        if (y <= lo + 1 || y >= hi - 1 || seen.some((z) => Math.abs(z - y) < 1)) return;
        seen.push(y);
        dots.push({ x: b.x, y, role: b.role, own: b.own, tag: null, ri: b.ms[0].ri });
      });
    });
    return { dots, tags };
  }
  // where a level run crosses another arrow's upright run, it hops over it: per arrow, the runs and their hops, each
  // [from, to] along the run (crossings closer together than a hop share one wider arch). A hop can come up to
  // just short of a turn: the turn is drawn tighter there to make room.
  function hopsOf(routes, owners) {
    const ups = [];
    routes.forEach((pts, ri) => { for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i - 1][0] - pts[i][0]) < 0.5) ups.push({ ri, x: pts[i][0], lo: Math.min(pts[i - 1][1], pts[i][1]), hi: Math.max(pts[i - 1][1], pts[i][1]) }); });
    return routes.map((pts, ri) => {
      const out = new Map(), mine = owners[ri] || [];
      for (let i = 1; i < pts.length; i++) {
        const u = pts[i - 1], v = pts[i];
        if (Math.abs(u[1] - v[1]) > 0.5) continue;
        const lo = Math.min(u[0], v[0]) + HOP + 3, hi = Math.max(u[0], v[0]) - HOP - 3, xs = [];
        ups.forEach((w) => {
          if (w.ri === ri || w.x <= lo || w.x >= hi || u[1] <= w.lo + 2 || u[1] >= w.hi - 2) return;
          if ((owners[w.ri] || []).some((o) => o && mine.includes(o))) return;
          xs.push(w.x);
        });
        if (!xs.length) continue;
        const dir = v[0] > u[0] ? 1 : -1, spans = [];
        xs.sort((p, q) => (p - q) * dir).forEach((x) => {
          const last = spans[spans.length - 1];
          if (last && Math.abs(x - last[1]) <= 2 * HOP + 4) last[1] = x; else spans.push([x, x]);
        });
        out.set(i, spans);
      }
      return out;
    });
  }
  // a path through the corner points with small rounded turns; mid is halfway along it
  // (hops: per run, where it hops over other arrows)
  function roundPath(pts, hops) {
    const P = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
    const fmt = (p) => `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`;
    let d = `M${fmt(P[0])}`, total = 0;
    const lens = P.map((p, i) => (i ? Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0));
    // each turn's radius, tighter where a hop sits close to it
    const r = P.map((p, i) => (i > 0 && i < P.length - 1 ? Math.min(RAD, lens[i] / 2, lens[i + 1] / 2) : 0));
    if (hops) hops.forEach((spans, i) => {
      if (!spans.length) return;
      const a = P[i - 1], c = P[i];
      if (i - 1 > 0) r[i - 1] = Math.max(2, Math.min(r[i - 1], Math.abs(spans[0][0] - a[0]) - HOP - 1));
      if (i < P.length - 1) r[i] = Math.max(2, Math.min(r[i], Math.abs(c[0] - spans[spans.length - 1][1]) - HOP - 1));
    });
    // an arch, bulging up, over each crossing (or close group of them) on run i
    const hop = (i) => {
      const spans = hops && hops.get(i), a = P[i - 1], c = P[i];
      if (!spans) return;
      const dir = c[0] > a[0] ? 1 : -1;
      spans.forEach(([x0, x1]) => { d += ` L${fmt([x0 - dir * HOP, a[1]])} A${Math.abs(x1 - x0) / 2 + HOP},${HOP} 0 0 ${dir > 0 ? 1 : 0} ${fmt([x1 + dir * HOP, a[1]])}`; });
    };
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], c = P[i], e = P[i + 1];
      const u = [(c[0] - a[0]) / lens[i], (c[1] - a[1]) / lens[i]], w = [(e[0] - c[0]) / lens[i + 1], (e[1] - c[1]) / lens[i + 1]];
      hop(i);
      d += ` L${fmt([c[0] - u[0] * r[i], c[1] - u[1] * r[i]])} Q${fmt(c)} ${fmt([c[0] + w[0] * r[i], c[1] + w[1] * r[i]])}`;
    }
    hop(P.length - 1);
    d += ` L${fmt(P[P.length - 1])}`;
    lens.forEach((l) => { total += l; });
    let half = total / 2, mid = P[0];
    for (let i = 1; i < P.length; i++) { if (half <= lens[i]) { const t = half / lens[i]; mid = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; break; } half -= lens[i]; }
    return { d, mid };
  }

  /* ---------- highlighting around a selected box (7.1) ---------- */
  // mode: chain (causes both ways, plus whatever sets what the box checks), up, down, both, off;
  // depth: arrows away from the box, 1 to 6, or 0 for all. Returns distance per lit box and the lit arrows.
  function focusSet(edges, k, mode, depth) {
    const dist = new Map([[k, 0]]), lit = new Set();
    if (mode === 'off') return { dist, edges: lit };
    const max = depth > 0 && mode !== 'chain' ? depth : Infinity;
    const walk = (fwd, follow) => {
      const d = new Map([[k, 0]]), q = [k];
      while (q.length) {
        const u = q.shift(), du = d.get(u);
        if (du >= max) continue;
        for (const e of edges) {
          if ((fwd ? e.from : e.to) !== u || !follow(e, u)) continue;
          const v = fwd ? e.to : e.from;
          lit.add(e.id);
          if (!d.has(v)) { d.set(v, du + 1); q.push(v); }
        }
      }
      d.forEach((x, n) => { if (!dist.has(n) || dist.get(n) > x) dist.set(n, x); });
    };
    if (mode === 'chain') {
      walk(true, (e, u) => e.role !== 'condition' || u === k);  // what it sets off; what it is checked by, one step
      walk(false, () => true);                                   // what sets it off, and what sets what it checks
    } else {
      if (mode === 'down' || mode === 'both') walk(true, () => true);
      if (mode === 'up' || mode === 'both') walk(false, () => true);
    }
    return { dist, edges: lit };
  }

  /* ---------- config analysis: what does an automation/script read, wait on, change, call ---------- */
  // Home Assistant 2026.x purpose-specific triggers (light.turned_on, door.opened, counter.incremented...):
  // what state or service can fire them, for the loop check
  const PS_TO = { turned_on: ['on'], turned_off: ['off'], opened: ['open', 'opening', 'on'], closed: ['closed', 'closing', 'off'],
    locked: ['locked'], unlocked: ['unlocked'], jammed: ['jammed'] };
  // counter triggers fire on the value moving (counter/trigger.py), so set_value and reset can fire them too;
  // counter.reset fires whenever the value lands on its initial value, which any change can do
  // A light's brightness triggers skip states without a brightness (light/trigger.py: the tracked value is None
  // when it's off), so turning it off can't fire them: an automation that turns a light off when it's dimmed
  // below a threshold is not a loop
  const PS_SVC = { 'counter.incremented': ['increment', 'set_value', 'reset'], 'counter.decremented': ['decrement', 'set_value', 'reset'],
    'counter.maximum_reached': ['increment', 'set_value', 'reset'], 'counter.minimum_reached': ['decrement', 'set_value', 'reset'],
    'light.brightness_changed': ['turn_on', 'toggle'], 'light.brightness_crossed_threshold': ['turn_on', 'toggle'] };
  const TARGET_KEYS = { area_id: 'area', floor_id: 'floor', label_id: 'label' };
  // the event a phone fires when a notification's button is pressed, and the key holding the button's id
  const NOTIFY_EVENTS = { mobile_app_notification_action: 'action', 'ios.notification_action_fired': 'actionName' };
  const TGT_RE = /^(area|floor|label):/;
  function triggerFilter(node, p) {
    const low = (v) => toList(v).map((x) => String(x).toLowerCase());
    if (p === 'state') {
      if (node.attribute != null) return null;  // attribute values aren't entity states
      if (node.to == null && node.not_to == null) return null;
      const f = {};
      if (node.to != null) f.to = low(node.to);
      if (node.not_to != null) f.notTo = low(node.not_to);
      return f;
    }
    if (p === 'event') return { ev: toList(node.event_type).filter((x) => typeof x === 'string') };
    if (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(p)) {
      if (TIMER_EVENTS[p]) return { ev: [p] };
      if (PS_SVC[p]) return { svc: PS_SVC[p] };
      const verb = p.split('.')[1];
      if (PS_TO[verb]) return { to: PS_TO[verb] };
    }
    return null;
  }
  function analyze(cfg, isScript, known) {
    const refs = [], badges = new Set();
    let tf = null;     // filter of the trigger being read: { to, notTo } states, { ev } event types or { svc } services
    let kind = null;   // the trigger or condition type being read (light.turned_on, light.is_on, state...)
    let sdom = null;   // the domain of the action being read (light for light.turn_on)
    // for the developer tools (Phase 9): the condition a reference sits in (tested as a whole) and its place among
    // the top-level conditions, the template it was found in, the trigger it belongs to and its place, the action
    let cond = null, cidx = -1, tpl = null, trig = null, tidx = -1, act = null;
    const add = (ref, role, svc) => refs.push({ ref, role, svc: svc || '', tf: role === 'trigger' ? tf : null, kind: role === 'trigger' || role === 'condition' ? kind : null, sdom: role === 'action' || role === 'call' ? sdom : null,
      cond: role === 'condition' ? cond : null, cidx: role === 'condition' && cond != null ? cidx : -1, tpl, trig: role === 'trigger' ? trig : null, tidx: role === 'trigger' ? tidx : -1, act: role === 'action' || role === 'call' ? act : null });
    const targets = (obj, role, svc) => Object.entries(TARGET_KEYS).forEach(([k, pre]) => toList(obj && obj[k]).forEach((x) => {
      if (typeof x === 'string' && x && !TPL_RE.test(x)) add(pre + ':' + x, role, svc);
    }));
    const readRole = (mode) => (mode === 'trigger' ? 'trigger' : 'condition');
    const scan = (s, role) => { const t0 = tpl; tpl = s; for (const m of s.matchAll(ENTITY_RE)) { const e = known(m[0]); if (e) add(e, role); } tpl = t0; };
    const ids = (v, role, svc) => toList(v).forEach((x) => {
      if (typeof x !== 'string') return;
      if (TPL_RE.test(x)) { scan(x, role === 'action' || role === 'call' ? 'condition' : role); return; }
      x.split(',').map((s) => s.trim()).forEach((s) => {
        if (EXACT_RE.test(s)) add(s, role, svc);
        else if (REGID_RE.test(s)) { const e = known(s); if (e) add(e, role, svc); }
      });
    });
    // inList: the node is one entry of a list of conditions, where a bare template is a condition of its own
    const walk = (node, mode, inList) => {
      if (node == null) return;
      if (typeof node === 'string') {
        const c0 = cond;
        if (inList && mode === 'condition' && cond == null && TPL_RE.test(node)) cond = node;
        if (TPL_RE.test(node)) scan(node, readRole(mode));
        else if (EXACT_RE.test(node)) { const e = known(node); if (e) add(e, readRole(mode)); }
        cond = c0;
        return;
      }
      if (Array.isArray(node)) { node.forEach((n) => walk(n, mode, inList)); return; }
      if (typeof node !== 'object') return;
      const outerTf = tf, outerKind = kind, outerCond = cond, outerTrig = trig;
      if (mode === 'condition' && typeof node.condition === 'string') kind = node.condition;
      // a condition object, or a condition step among actions: what a test of it right now checks. Only a real
      // condition type: service data can carry a "condition" key of its own (a weather condition, say)
      if ((mode === 'condition' || mode === 'action') && typeof node.condition === 'string' && cond == null && (COND_TYPES.has(node.condition) || EXACT_RE.test(node.condition))) cond = node;
      if (mode === 'trigger') {
        const p = node.trigger || node.platform;
        if (typeof p === 'string') { tf = triggerFilter(node, p); kind = p; if (trig == null) trig = node; }
        const btn = p === 'event' && typeof node.event_type === 'string' && NOTIFY_EVENTS[node.event_type] && node.event_data ? node.event_data[NOTIFY_EVENTS[node.event_type]] : null;
        if (p === 'mqtt' && typeof node.topic === 'string') add('mqtt:' + node.topic, 'trigger');
        else if (typeof btn === 'string' && !TPL_RE.test(btn)) add('nact:' + btn, 'trigger');  // answers one notification button (9.5)
        else if (p === 'event' && node.event_type) toList(node.event_type).forEach((t) => typeof t === 'string' && add('event:' + t, 'trigger'));
        if (p === 'time' || p === 'time_pattern') badges.add('time');
        else if (p === 'sun') badges.add('sun');
        else if (p === 'homeassistant') badges.add('start');
        else if (p === 'webhook') badges.add('webhook');
        else if (p === 'tag') badges.add('tag');
        else if (p === 'conversation') badges.add('voice');
        else if (p === 'calendar') badges.add('calendar');
      }
      if (mode === 'action') {
        const svc = typeof node.action === 'string' ? node.action : typeof node.service === 'string' ? node.service : null;
        if (svc && svc.includes('.') && !TPL_RE.test(svc)) {
          const i = svc.indexOf('.'), d = svc.slice(0, i), s = svc.slice(i + 1);
          const t = node.target || {}, data = node.data || {}, role = d === 'script' ? 'call' : 'action';
          const outerDom = sdom, outerAct = act;
          sdom = d; act = node;
          let hit = false;
          [t.entity_id, node.entity_id, data.entity_id, data.media_player_entity_id].forEach((v) => {
            if (v != null && v !== 'all' && v !== 'none') { ids(v, role, s); hit = true; }
          });
          [t.device_id, node.device_id, data.device_id].forEach((v) => toList(v).forEach((x) => {
            if (typeof x === 'string') { add('device:' + x, 'action', s); hit = true; }
          }));
          [t, node, data].forEach((o) => { const n0 = refs.length; targets(o, role, s); if (refs.length > n0) hit = true; });
          if (d === 'script' && !['turn_on', 'turn_off', 'toggle', 'reload'].includes(s)) { add('script.' + s, 'call', 'run'); hit = true; }
          if (!hit) add('svc:' + svc, 'action', s);
          // a notification with buttons: each button is an output of the notification (9.5)
          const acts = d === 'notify' && data.data && Array.isArray(data.data.actions) ? data.data.actions : [];
          acts.forEach((a) => {
            if (!a || typeof a.action !== 'string' || TPL_RE.test(a.action) || a.action === 'URI') return;
            refs.push({ ref: 'nact:' + a.action, role: 'action', svc: 'button', tf: null, kind: null, sdom: null, from: hit ? null : 'svc:' + svc, title: typeof a.title === 'string' ? a.title : null });
          });
          Object.entries(data).forEach(([k, v]) => {
            if (!['entity_id', 'device_id', 'media_player_entity_id', 'area_id', 'floor_id', 'label_id'].includes(k)) walk(v, 'condition');
          });
          sdom = outerDom; act = outerAct;
          tf = outerTf; kind = outerKind; cond = outerCond; trig = outerTrig;
          return;
        }
        if (typeof node.event === 'string' && node.trigger == null && node.platform == null) add('event:' + node.event, 'action', 'fire');
        if (typeof node.scene === 'string') add(node.scene, 'action', 'activate');
        if (typeof node.device_id === 'string' && node.domain && node.type && node.condition == null) {
          add('device:' + node.device_id, 'action', String(node.type));
          return;
        }
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'entity_id') { ids(v, mode === 'action' ? 'condition' : mode); continue; }
        if (TARGET_KEYS[k] && mode !== 'action') { targets({ [k]: v }, mode === 'trigger' ? 'trigger' : 'condition'); continue; }
        if (k === 'device_id') {
          toList(v).forEach((x) => typeof x === 'string' && add('device:' + x, mode === 'action' ? 'condition' : mode));
          continue;
        }
        if (SKIP_KEYS.has(k) && typeof v === 'string') continue;
        let m = mode;
        if (mode !== 'trigger' && COND_KEYS.has(k)) m = 'condition';
        if (mode !== 'trigger' && (ACTION_KEYS.has(k) || (k === 'action' && typeof v !== 'string'))) m = 'action';
        walk(v, m, m === 'condition' && CLIST_KEYS.has(k));
      }
      tf = outerTf; kind = outerKind; cond = outerCond; trig = outerTrig;
    };
    if (isScript) { walk(cfg.sequence, 'action'); walk(cfg.variables, 'condition'); }
    else {
      toList(cfg.triggers != null ? cfg.triggers : cfg.trigger).forEach((t, i) => { tidx = i; walk(t, 'trigger'); });
      tidx = -1;
      toList(cfg.conditions != null ? cfg.conditions : cfg.condition).forEach((c, i) => { cidx = i; walk(c, 'condition', true); });
      cidx = -1;
      walk(cfg.actions != null ? cfg.actions : cfg.action, 'action');
      walk(cfg.variables, 'condition');
    }
    return { refs, badges };
  }

  /* ---------- layered layout (left to right): inputs -> logic -> outputs ---------- */
  // wrap (top to bottom only): the most a row may span, in px. Boxes stand side by side there, so a script that
  // drives thirty things would make one row thirty boxes wide; its end points (nothing comes after them) move down
  // a row instead, as many as it takes
  function layeredOnce(keys, edges, size, gapMin, wrap) {
    const n = keys.length, idx = new Map(keys.map((k, i) => [k, i]));
    const out = Array.from({ length: n }, () => []), inc = Array.from({ length: n }, () => []);
    edges.forEach((e) => {
      const a = idx.get(e.from), b = idx.get(e.to);
      if (a == null || b == null || a === b) return;
      out[a].push(b); inc[b].push(a);
    });
    const st = new Array(n).fill(0), back = new Set();
    const dfs = (u) => {
      st[u] = 1;
      for (const v of out[u]) { if (st[v] === 1) back.add(u * n + v); else if (!st[v]) dfs(v); }
      st[u] = 2;
    };
    const trig = new Set(edges.filter((e) => e.role === 'trigger').map((e) => e.from));
    const world = (k) => trig.has(k) && !/^(automation|script)\./.test(k) && !HELPER_DOMAINS.has(k.split('.')[0]);
    for (let i = 0; i < n; i++) if (world(keys[i]) && !st[i]) dfs(i);
    for (let i = 0; i < n; i++) if (!inc[i].length && !st[i]) dfs(i);
    for (let i = 0; i < n; i++) if (!st[i]) dfs(i);
    const fwd = (u, v) => !back.has(u * n + v);
    const L = new Array(n).fill(0);
    for (let it = 0; it < n; it++) {
      let ch = false;
      for (let u = 0; u < n; u++) for (const v of out[u]) if (fwd(u, v) && L[v] < L[u] + 1) { L[v] = L[u] + 1; ch = true; }
      if (!ch) break;
    }
    for (let u = 0; u < n; u++) {
      const ins = inc[u].filter((w) => fwd(w, u)), outs = out[u].filter((v) => fwd(u, v));
      if (!ins.length && outs.length) L[u] = Math.max(0, Math.min(...outs.map((v) => L[v])) - 1);
    }
    if (wrap) {
      const ends = (u) => !out[u].some((v) => fwd(u, v)), wired = (u) => out[u].length || inc[u].length;
      for (let l = 0; l <= Math.max(0, ...L); l++) {
        const ly = [];
        for (let u = 0; u < n; u++) if (L[u] === l && wired(u)) ly.push(u);
        let ext = ly.reduce((s, u) => s + size(keys[u]).h + 30, 0);
        const movable = ly.filter(ends);
        for (let j = movable.length - 1; j >= 0 && ext > wrap; j--) { L[movable[j]] = l + 1; ext -= size(keys[movable[j]]).h + 30; }
      }
      // and its starting points (nothing comes before them: thirty inputs read by one automation) move up a row
      const starts = (u) => !inc[u].some((w) => fwd(w, u));
      for (let l = Math.max(0, ...L); l >= Math.min(0, ...L) - n; l--) {
        const ly = [];
        for (let u = 0; u < n; u++) if (L[u] === l && wired(u)) ly.push(u);
        if (!ly.length && l < Math.min(...L)) break;
        let ext = ly.reduce((s, u) => s + size(keys[u]).h + 30, 0);
        const movable = ly.filter((u) => starts(u) && !ends(u));
        for (let j = movable.length - 1; j >= 0 && ext > wrap; j--) { L[movable[j]] = l - 1; ext -= size(keys[movable[j]]).h + 30; }
      }
      const lo = Math.min(0, ...L);
      if (lo < 0) for (let u = 0; u < n; u++) L[u] -= lo;
    }
    // boxes with no arrows at all go in a grid under the wired part instead of one tall first column
    const lone = [];
    for (let i = 0; i < n; i++) if (!out[i].length && !inc[i].length) lone.push(i);
    const isLone = new Set(lone);
    const maxL = n ? Math.max(...L) : 0;
    // placeholders: an arrow that skips columns gets a 24 px slot in each column it passes, so the ordering
    // keeps its way clear and it is drawn through those slots, not behind the boxes in between (4.3)
    const DH = 24, Lx = L.slice(), ii = inc.map((x) => x.slice()), oo = out.map((x) => x.slice()), chains = new Map();
    for (let u = 0; u < n; u++) for (const v of out[u]) {
      if (!fwd(u, v) || L[v] - L[u] < 2) continue;
      const chain = [];
      let prev = u;
      for (let l = L[u] + 1; l < L[v]; l++) { const d = Lx.length; Lx.push(l); ii.push([prev]); oo.push([]); oo[prev].push(d); chain.push(d); prev = d; }
      oo[prev].push(v); ii[v].push(prev);
      oo[u].splice(oo[u].indexOf(v), 1); ii[v].splice(ii[v].indexOf(u), 1);
      chains.set(keys[u] + '>' + keys[v], chain);
    }
    const all = Lx.length, hOf = (u) => (u < n ? size(keys[u]).h : DH), wOf = (u) => (u < n ? size(keys[u]).w : 0);
    const layers = Array.from({ length: maxL + 1 }, () => []);
    for (let i = 0; i < all; i++) if (i >= n || !isLone.has(i)) layers[Lx[i]].push(i);
    const pos = new Array(all).fill(0);
    const setPos = (ly) => ly.forEach((u, j) => { pos[u] = j; });
    layers.forEach(setPos);
    const bary = (ly, nb) => {
      const val = new Map(ly.map((u) => {
        const ns = nb[u];
        return [u, ns.length ? ns.reduce((s, w) => s + pos[w], 0) / ns.length : pos[u]];
      }));
      ly.sort((a, b) => val.get(a) - val.get(b));
      setPos(ly);
    };
    for (let s = 0; s < 6; s++) {
      for (let l = 1; l <= maxL; l++) bary(layers[l], ii);
      for (let l = maxL - 1; l >= 0; l--) bary(layers[l], oo);
    }
    const res = new Map(), at = new Array(all), PR = PROTO();
    const hts = layers.map((ly) => ly.reduce((h, u) => h + hOf(u) + ROWG, -ROWG));
    let H = Math.max(0, ...hts);
    // columns left to right, and each box's top
    const lx = [], cws = [], yv = new Array(all).fill(0);
    if (PR.align) alignY(layers, ii, oo, hOf, yv);
    else layers.forEach((ly, l) => { let y = (H - hts[l]) / 2; ly.forEach((u) => { yv[u] = y; y += hOf(u) + ROWG; }); });
    // each gap between columns is wide enough for the arrows that turn in it to run SEP apart
    const gapW = layers.map(() => COLG);
    if (PR.ortho) {
      // the same lanes the arrows will be drawn in, from each box's middle
      const need = layers.map(() => []), back = layers.map(() => 0), cy = (u) => yv[u] + hOf(u) / 2;
      for (let u = 0; u < all; u++) for (const v of oo[u]) {
        if (Lx[v] !== Lx[u] + 1) continue;
        const own = u < n && oo[u].length >= 5 ? 'o' + u : v < n && ii[v].length >= 5 ? 'i' + v : null;
        if (!own && Math.abs(cy(u) - cy(v)) < 1) continue;
        need[Lx[u]].push({ own, c: 0, lo: Math.min(cy(u), cy(v)), hi: Math.max(cy(u), cy(v)), ats: [[cy(u), -1], [cy(v), 1]] });
      }
      // arrows that go back turn once just after their start and once just before their end
      for (let u = 0; u < n; u++) for (const v of out[u]) if (!fwd(u, v) || L[v] <= L[u]) { back[L[u]]++; if (L[v] > 0) back[L[v] - 1]++; }
      need.forEach((list, l) => {
        const items = [], byOwn = new Map();
        list.forEach((r) => {
          const it = r.own && byOwn.get(r.own);
          if (it) { it.lo = Math.min(it.lo, r.lo); it.hi = Math.max(it.hi, r.hi); it.ats.push(...r.ats); } else { items.push(r); if (r.own) byOwn.set(r.own, r); }
        });
        const k = orderLanes(items) + back[l];
        gapW[l] = Math.max(COLG, 2 * STUB + 24 + (k - 1) * SEP);
      });
    }
    // (wider where the drawn arrows turned out to need it)
    if (gapMin) gapMin.forEach((w, l) => { if (w > gapW[l]) gapW[l] = w; });
    let x = 0;
    // (a column of nothing but slots for passing arrows still gets some width, so the turns either side of it stay apart)
    layers.forEach((ly, l) => { lx[l] = x; cws[l] = ly.length ? Math.max(PR.ortho ? 40 : 0, ...ly.map((u) => wOf(u))) : 0; if (ly.length) x += cws[l] + gapW[l]; });
    // a long run of columns folds into rows that fit a screen, cut where the fewest arrows cross
    const ldx = layers.map(() => 0), ldy = layers.map(() => 0);
    if (PR.bands && maxL >= 3) {
      const GUT = 110, totalW = x - COLG, ys = [...layers.flat()], top = Math.min(...ys.map((u) => yv[u])), bot = Math.max(...ys.map((u) => yv[u] + hOf(u)));
      const R = PR.ratio || 1.7, totalH = bot - top;
      let nb = 1, sc = Infinity;
      // only a function too wide for a screen at full size folds; a short one reads best in one row
      for (let b = 1; b <= (totalW > (PR.wrapAt || 2200) ? 5 : 1); b++) { const v = Math.abs(Math.log((totalW / b) / (b * totalH + (b - 1) * GUT) / R)); if (v < sc) { sc = v; nb = b; } }
      const across = (l) => { let c = 0; for (let u = 0; u < all; u++) for (const v of oo[u]) if (Lx[u] < l && Lx[v] >= l) c++; return c; };
      const cuts = [];
      for (let j = 1; j < nb; j++) {
        const want = (totalW * j) / nb;
        let best = null, bs = Infinity;
        for (let l = 1; l <= maxL; l++) {
          if (cuts.includes(l) || !layers[l].length) continue;
          const v = Math.abs(lx[l] - want) / (totalW / nb) + 0.12 * across(l);
          if (v < bs) { bs = v; best = l; }
        }
        if (best != null) cuts.push(best);
      }
      cuts.sort((p, q) => p - q);
      const starts = [0, ...cuts];
      let prevBot = null;
      starts.forEach((s0, j) => {
        const s1 = j + 1 < starts.length ? starts[j + 1] : maxL + 1, us = [];
        for (let l = s0; l < s1; l++) us.push(...layers[l]);
        if (!us.length) return;
        const t = Math.min(...us.map((u) => yv[u])), b = Math.max(...us.map((u) => yv[u] + hOf(u)));
        const dy = prevBot == null ? -t : prevBot + GUT - t;
        for (let l = s0; l < s1; l++) { ldx[l] = -lx[s0]; ldy[l] = dy; }
        prevBot = b + dy;
      });
    }
    let bottom = 0;
    layers.forEach((ly, l) => {
      if (!ly.length) return;
      const cw = cws[l], X = lx[l] + ldx[l];
      ly.forEach((u) => {
        const y = yv[u] + ldy[l];
        if (u < n) res.set(keys[u], { x: X + (cw - wOf(u)) / 2, y });
        else at[u] = [X + cw / 2, y + DH / 2, cw / 2];
        bottom = Math.max(bottom, y + hOf(u));
      });
    });
    if (PR.align || PR.bands) H = bottom;
    x = Math.max(0, ...layers.map((ly, l) => (ly.length ? lx[l] + ldx[l] + cws[l] + COLG : 0)));
    res.routes = new Map([...chains].map(([k, ch]) => [k, ch.map((d) => at[d])]));
    // the gaps between neighbouring columns of one row, for widening where arrows need it
    res.gapW = gapW;
    res.gaps = [];
    for (let l = 0; l < maxL; l++) {
      if (!layers[l].length || !layers[l + 1].length || ldy[l] !== ldy[l + 1]) continue;
      const x0 = lx[l] + ldx[l] + cws[l], us = layers.filter((_, j) => ldy[j] === ldy[l]).flat();
      res.gaps.push({ l, x0, x1: x0 + gapW[l], y0: Math.min(...us.map((u) => yv[u] + ldy[l])), y1: Math.max(...us.map((u) => yv[u] + ldy[l] + hOf(u))) });
    }
    return res;
  }

  // the automatic layout: each separate group of connected boxes laid out on its own (and, with square-cornered
  // arrows, re-laid with wider gaps where its arrows turned out to need them), the groups packed together, and boxes
  // with no arrows in a grid under them
  // vert: top to bottom. The groups are laid out and routed left to right on a board turned a quarter turn (each box's
  // width and height swapped), then turned back: positions come out real, routes stay in the turned frame, the one
  // the arrows are routed and drawn in (see _drawEdges)
  function layered(keys, edges, size0, kindOf, vert) {
    const size = vert ? (k) => { const s0 = size0(k); return { w: s0.h, h: s0.w }; } : size0;
    const PR = PROTO(), nb = new Map(keys.map((k) => [k, []]));
    edges.forEach((e) => { if (e.from !== e.to && nb.has(e.from) && nb.has(e.to)) { nb.get(e.from).push(e.to); nb.get(e.to).push(e.from); } });
    const lone = keys.filter((k) => !nb.get(k).length), seen = new Set(), parts = [];
    keys.forEach((k) => {
      if (seen.has(k) || !nb.get(k).length) return;
      const part = [], todo = [k];
      seen.add(k);
      while (todo.length) { const u = todo.pop(); part.push(u); nb.get(u).forEach((v) => { if (!seen.has(v)) { seen.add(v); todo.push(v); } }); }
      parts.push(part);
    });
    const groups = PR.pack ? parts.map((p) => new Set(p)) : [new Set(parts.flat())];
    const laid = groups.filter((g) => g.size).map((g) => {
      const ks = keys.filter((k) => g.has(k)), es = edges.filter((e) => g.has(e.from) && g.has(e.to));
      const wrap = vert ? 2000 : 0;
      let res = layeredOnce(ks, es, size, undefined, wrap), gap = null;
      for (let it = 0; PR.ortho && it < 3; it++) {
        const pos = new Map(ks.map((k) => { const s = size(k), p = res.get(k); return [k, { x: p.x, y: p.y, w: s.w, h: s.h }]; }));
        const short = [], geo = arrowGeo(es, (k) => pos.get(k), orthoSides);
        orthoAll(geo, (e, sd) => (sd[0] === 'r' && sd[1] === 'l' && res.routes.get(e.id)) || null, [...pos.values()], short);
        gap = gap || res.gapW.slice();
        let grew = false;
        short.forEach((sh) => {
          const g = res.gaps.find((q) => sh.x >= q.x0 - 1 && sh.x <= q.x1 + 1 && sh.hi > q.y0 && sh.lo < q.y1);
          if (g && g.x1 - g.x0 + sh.need > gap[g.l]) { gap[g.l] = Math.ceil(g.x1 - g.x0 + sh.need + 2); grew = true; }
        });
        if (!grew) break;
        res = layeredOnce(ks, es, size, gap, wrap);
      }
      // its extent
      const ps = ks.map((k) => { const p = res.get(k), s = size(k); return [p.x, p.y, p.x + s.w, p.y + s.h]; });
      const x0 = Math.min(...ps.map((p) => p[0])), y0 = Math.min(...ps.map((p) => p[1]));
      return { res, ks, x0, y0, w: Math.max(...ps.map((p) => p[2])) - x0, h: Math.max(...ps.map((p) => p[3])) - y0 };
    });
    // pack the groups, biggest first, each beside or under those already placed, wherever the whole stays
    // smallest and nearest a screen's shape: smaller groups fill in round the big one instead of leaving gaps
    // turned, a screen's shape is tall: packed that way, the groups come out wide again
    const GUT = 90, R = vert ? 1 / (PR.ratio || 1.7) : PR.ratio || 1.7, out = new Map(), put = [];
    out.routes = new Map(); out.heads = [];
    laid.sort((p, q) => q.w * q.h - p.w * p.h);
    laid.forEach((p) => {
      let best = null;
      const xs = new Set([0]), ys = new Set([0]);
      put.forEach((q) => { xs.add(q.x); xs.add(q.x + q.w + GUT); ys.add(q.y); ys.add(q.y + q.h + GUT); });
      xs.forEach((x) => ys.forEach((y) => {
        if (put.some((q) => x < q.x + q.w + GUT && x + p.w + GUT > q.x && y < q.y + q.h + GUT && y + p.h + GUT > q.y)) return;
        const W = Math.max(x + p.w, ...put.map((q) => q.x + q.w)), H = Math.max(y + p.h, ...put.map((q) => q.y + q.h));
        const cost = W * H * (1 + 0.5 * Math.abs(Math.log(W / H / R)));
        if (!best || cost < best.cost - 1 || (Math.abs(cost - best.cost) <= 1 && y + x < best.y + best.x)) best = { x, y, cost };
      }));
      put.push({ x: best.x, y: best.y, w: p.w, h: p.h });
      const dx = best.x - p.x0, dy = best.y - p.y0;
      p.ks.forEach((k) => { const q = p.res.get(k); out.set(k, vert ? { x: q.y + dy, y: q.x + dx } : { x: q.x + dx, y: q.y + dy }); });
      p.res.routes.forEach((pts, id) => out.routes.set(id, pts.map((q) => [q[0] + dx, q[1] + dy, q[2]])));
    });
    // the boxes wired to nothing: a grid under the rest, in real (unturned) sizes
    const wide = put.length ? Math.max(...put.map((q) => (vert ? q.y + q.h : q.x + q.w))) : 0, H = put.length ? Math.max(...put.map((q) => (vert ? q.x + q.w : q.y + q.h))) : 0;
    if (lone.length) {
      const cw = Math.max(...lone.map((k) => size0(k).w)) + 40, rh = Math.max(...lone.map((k) => size0(k).h)) + ROWG;
      const cols = Math.max(1, wide ? Math.min(lone.length, Math.max(3, Math.floor((wide + 40) / cw))) : Math.ceil(Math.sqrt(lone.length * 2)));
      // grouped by kind (automations, scripts, helpers, devices...), with a small heading each when a kind is given
      const kinds = [];
      lone.forEach((k) => {
        const kd = kindOf ? kindOf(k) : '';
        if (!kinds.length || kinds[kinds.length - 1].k !== kd) kinds.push({ k: kd, us: [] });
        kinds[kinds.length - 1].us.push(k);
      });
      let y = out.size ? H + 100 : 0;
      kinds.forEach((g) => {
        if (kindOf) { out.heads.push({ x: 0, y, text: g.k, keys: g.us.slice() }); y += 30; }
        g.us.forEach((k, j) => out.set(k, { x: (j % cols) * cw, y: y + Math.floor(j / cols) * rh }));
        y += Math.ceil(g.us.length / cols) * rh + 20;
      });
    }
    return out;
  }

  // each box's top in its column: the order stays, each box as near the middle of what it connects to as the boxes
  // above and below it allow, so a chain runs straight across instead of zigzagging between centred columns
  function alignY(layers, ins, outs, hOf, y) {
    layers.forEach((ly) => { let t = 0; ly.forEach((u) => { y[u] = t; t += hOf(u) + ROWG; }); });
    const c = (u) => y[u] + hOf(u) / 2;
    const med = (vs) => { const s = vs.slice().sort((p, q) => p - q), m = s.length; return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2; };
    // keep the order and the gaps; least squares from the wanted tops (pool adjacent violators)
    const place = (ly, want) => {
      const blocks = [];
      let off = 0;
      ly.forEach((u, i) => {
        blocks.push({ s: want[i] - hOf(u) / 2 - off, n: 1 });
        off += hOf(u) + ROWG;
        while (blocks.length > 1) {
          const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
          if (a.s / a.n <= b.s / b.n) break;
          a.s += b.s; a.n += b.n; blocks.pop();
        }
      });
      off = 0;
      let i = 0;
      blocks.forEach((b) => { const z = b.s / b.n; for (let j = 0; j < b.n; j++, i++) { y[ly[i]] = z + off; off += hOf(ly[i]) + ROWG; } });
    };
    for (let it = 0; it < 14; it++) {
      const both = it >= 10, down = it % 2 === 0, order = down ? layers : layers.slice().reverse();
      order.forEach((ly) => {
        if (!ly.length) return;
        place(ly, ly.map((u) => { const ns = both ? ins[u].concat(outs[u]) : down ? ins[u] : outs[u]; return ns.length ? med(ns.map(c)) : c(u); }));
      });
    }
    const top = Math.min(0, ...layers.flat().map((u) => y[u]));
    layers.flat().forEach((u) => { y[u] -= top; });
  }

  /* ---------- loops: an automation or script whose own effects can set it off again ---------- */
  // what a service leaves its entity in, for the common ones; anything else counts as "could be anything"
  const RESULT = { turn_on: ['on'], turn_off: ['off'], open_cover: ['open', 'opening'], close_cover: ['closed', 'closing'],
    lock: ['locked', 'locking'], unlock: ['unlocked', 'unlocking'], open: ['open', 'opening'],
    start: ['active'], pause: ['paused'], cancel: ['idle'], finish: ['idle'] };
  const TIMER_EVENTS = { 'timer.finished': ['start', 'change', 'finish'], 'timer.cancelled': ['cancel'],
    'timer.started': ['start'], 'timer.restarted': ['start'], 'timer.paused': ['pause'] };
  function canSetOff(svcs, entity, trig) {
    // can an action (svcs) on this entity fire this trigger edge (state "to:" or timer event filters)?
    if (trig.anyTrig || !trig.tfs.length || !svcs.size) return true;
    const dom = entity.split('.')[0];
    return trig.tfs.some((f) => [...svcs].some((s) => {
      if (f.ev) return f.ev.some((ev) => !(dom === 'timer' && TIMER_EVENTS[ev]) || TIMER_EVENTS[ev].includes(s));
      if (f.svc) return f.svc.includes(s);
      if (!RESULT[s]) return true;
      return RESULT[s].some((x) => (!f.to || f.to.includes(x)) && (!f.notTo || !f.notTo.includes(x)));
    }));
  }
  // an automation that sets the very state that triggered it changes nothing (2.6): to: on, then turn_on
  function sameState(svcs, trig) {
    if (trig.anyTrig || !trig.tfs.length || !svcs.size) return false;
    return trig.tfs.every((f) => f.to && f.to.length === 1 && !f.notTo && [...svcs].every((s) => RESULT[s] && RESULT[s][0] === f.to[0]));
  }
  function loopEdges(keys, edges) {
    // collapse "A changes X, X triggers B" into hops A -> B (only when the change can satisfy B's trigger), then find cycles.
    // A change spreads: to helpers that read X (role source, 2.3) and from a scene or group to its members (2.4).
    const logic = (k) => k.startsWith('automation.') || k.startsWith('script.');
    const into = new Map(), from = new Map(), spread = new Map();
    const push = (m, k, e) => (m.get(k) || m.set(k, []).get(k)).push(e);
    edges.forEach((e) => {
      if (e.role === 'action' || e.role === 'call') push(into, e.to, e);
      if (e.role === 'trigger') push(from, e.from, e);
      if (e.role === 'source' || (e.role === 'action' && !logic(e.from) && !e.to.startsWith('nact:'))) push(spread, e.from, e);
    });
    const hops = [];
    edges.forEach((e) => {
      if (e.role === 'call' && logic(e.to)) hops.push({ a: e.from, b: e.to, ids: [e.id] });
      else if (e.role === 'action' && e.to.startsWith('automation.') && e.svcs.has('trigger')) hops.push({ a: e.from, b: e.to, ids: [e.id] });
    });
    into.forEach((ins, x) => {
      if (logic(x)) return;
      ins.forEach((a) => {
        if (a.role !== 'action' || !logic(a.from)) return;
        const seen = new Map([[x, [a.id]]]), q = [x];
        while (q.length) {
          const u = q.shift();
          (spread.get(u) || []).forEach((sp) => { if (!seen.has(sp.to) && !logic(sp.to)) { seen.set(sp.to, seen.get(u).concat([sp.id])); q.push(sp.to); } });
        }
        seen.forEach((path, y) => (from.get(y) || []).forEach((t) => {
          const direct = y === x;
          if (direct && !canSetOff(a.svcs, x, t)) return;
          if (direct && t.to === a.from && sameState(a.svcs, t)) return;
          hops.push({ a: a.from, b: t.to, ids: path.concat([t.id]) });
        }));
      });
    });
    const adj = new Map(keys.map((k) => [k, []]));
    hops.forEach((h) => { if (adj.has(h.a) && adj.has(h.b)) adj.get(h.a).push(h.b); });
    let i = 0, c = 0;
    const index = new Map(), low = new Map(), on = new Set(), stack = [], comp = new Map();
    const sc = (v) => {
      index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
      for (const w of adj.get(v)) {
        if (!index.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (low.get(v) === index.get(v)) {
        let w;
        do { w = stack.pop(); on.delete(w); comp.set(w, c); } while (w !== v);
        c++;
      }
    };
    keys.forEach((k) => { if (!index.has(k)) sc(k); });
    const size = new Map();
    comp.forEach((x) => size.set(x, (size.get(x) || 0) + 1));
    const out = new Set();
    hops.forEach((h) => {
      if (h.a === h.b || (comp.get(h.a) === comp.get(h.b) && size.get(comp.get(h.a)) > 1)) h.ids.forEach((id) => out.add(id));
    });
    return out;
  }

  const OUTCOME = (r) => {
    if (r.state === 'running') return { text: T('running_2'), cls: 'blue' };
    const x = r.script_execution;
    if (r.error || x === 'error') return { text: T('error_2', { extra: r.error ? ': ' + r.error : '' }), cls: 'red' };
    return ({
      finished: { text: T('finished'), cls: '' },
      failed_conditions: { text: T('conditions_not_met'), cls: 'muted' },
      failed_single: { text: T('skipped_already_running'), cls: 'muted' },
      failed_max_runs: { text: T('skipped_max_runs'), cls: 'muted' },
      cancelled: { text: T('cancelled'), cls: 'muted' },
      aborted: { text: T('aborted'), cls: 'amber' },
      timeout: { text: T('timed_out'), cls: 'amber' },
      failed_wait: { text: T('wait_timed_out'), cls: 'amber' },
    })[x] || { text: x || r.state || '', cls: '' };
  };

  /* ---------- developer tools (Phase 9): reading traces, and data typed into a test ---------- */
  const shorten = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function clockShort(t) {
    const d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }
  // a typed value: numbers, true/false and null as such, quoted strings unquoted
  function scalar(v) {
    v = String(v == null ? '' : v).trim();
    if (/^-?\d+(\.\d+)?$/.test(v)) return +v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (/^(['"]).*\1$/.test(v) && v.length > 1) return v.slice(1, -1);
    return v;
  }
  // data typed into a test without Home Assistant's YAML editor: JSON, or one "key: value" per line
  function parseLoose(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return {};
    if (/^[[{]/.test(s)) return JSON.parse(s);
    const out = {};
    s.split('\n').forEach((line) => {
      if (!line.trim() || line.trim().startsWith('#')) return;
      const m = line.match(/^\s*([^:#]+?)\s*:\s*(.*)$/);
      if (!m) throw new Error(T('can_t_read_use_key', { line: line.trim() }));
      out[m[1].trim()] = scalar(m[2]);
    });
    return out;
  }
  function toLoose(v) {
    if (v == null || (typeof v === 'object' && !Object.keys(v).length)) return '';
    if (typeof v !== 'object') return String(v);
    const flat = !Array.isArray(v) && Object.values(v).every((x) => x == null || typeof x !== 'object');
    if (!flat) return JSON.stringify(v, null, 2);
    return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'string' && (x === '' || /^[\s'"]|[\s]$|^(true|false|null|~|-?\d+(\.\d+)?)$/.test(x)) ? JSON.stringify(x) : x}`).join('\n');
  }
  // a condition in a few words, for "why didn't it run?"
  function condText(c, nm) {
    const name = (x) => (nm ? nm(x) : x);
    if (c == null) return T('a_condition');
    if (typeof c === 'string') return T('template_2', { c: shorten(c, 60) });
    const ent = toList(c.entity_id).map(name).join(', ');
    switch (c.condition) {
      case 'state': return T('is', { ent, state: toList(c.state).join(T('or')) });
      case 'numeric_state': return [ent, c.above != null ? T('above', { above: c.above }) : '', c.below != null ? T('below', { below: c.below }) : ''].filter(Boolean).join(' ');
      case 'template': return T('template', { value_template: shorten(c.value_template, 60) });
      case 'time': return T('time_2', { list: [c.after ? T('after', { after: c.after }) : '', c.before ? T('before', { before: c.before }) : '', c.weekday ? T('on_2', { weekday: toList(c.weekday).join(', ') }) : ''].filter(Boolean).join(' ') });
      case 'and': case 'or': case 'not': return `${c.condition} (${P('n_conditions', toList(c.conditions).length)})`;
      default: return String(c.condition || 'condition') + (ent ? ' ' + ent : '');
    }
  }
  // the trigger variables of a run: which trigger fired, and on what
  function trigVar(g) {
    const tr = (g && g.trace) || {}, k = Object.keys(tr).find((p) => /^trigger(\/\d+)?$/.test(p));
    const el = k && tr[k] && tr[k][0];
    return (el && el.changed_variables && el.changed_variables.trigger) || null;
  }
  // why a stopped run stopped: the condition that failed and what it saw, why a trigger didn't fire, or the error
  function whyStopped(g, nm) {
    const tr = (g && g.trace) || {}, cfg = (g && g.config) || {};
    if (g.not_triggered || g.script_execution === 'not_triggered') {
      const k = Object.keys(tr).find((p) => /^trigger(\/\d+)?$/.test(p)), el = k && tr[k][0], res = (el && el.result) || {};
      const i = k && k.includes('/') ? +k.split('/')[1] : 0;
      return T('trigger_saw_a_change_but', { n: i + 1, extra: res.reason ? ': ' + String(res.reason).replace(/_/g, ' ') : '' });
    }
    if (g.script_execution === 'failed_conditions') {
      const k = Object.keys(tr).find((p) => /^condition\/\d+$/.test(p) && tr[p].some((el) => el.result && el.result.result === false));
      if (!k) return T('a_condition_was_not_met');
      const i = +k.split('/')[1], conds = toList(cfg.conditions != null ? cfg.conditions : cfg.condition);
      const sub = Object.keys(tr).filter((p) => p.startsWith(k + '/')).map((p) => tr[p][0])
        .find((el) => el && el.result && el.result.result === false && el.result.state !== undefined);
      return T('condition_wasn_t_met', { n: i + 1, condText: condText(conds[i], nm), extra: sub ? T('it_was', { state: sub.result.state, extra: sub.result.wanted_state != null ? T('needs', { wanted_state: sub.result.wanted_state }) : '' }) : '' });
    }
    if (g.error) return T('error', { error: g.error });
    const bad = Object.keys(tr).map((p) => [p, (tr[p] || []).find((el) => el && el.error)]).find(([, el]) => el);
    return bad ? T('failed_4', { bad: bad[0], error: bad[1].error }) : '';
  }
  // the arrows a run actually used, from its trace (4.5): the trigger that fired it and every action it called
  function runPath(key, g, edges) {
    const keys = new Set([key]), lit = new Set();
    const link = (a, b) => { const e = edges.find((x) => x.from === a && x.to === b); if (e) { lit.add(e.id); keys.add(a); keys.add(b); } return !!e; };
    const tv = trigVar(g);
    if (tv) {
      toList(tv.entity_id).forEach((x) => typeof x === 'string' && link(x, key));
      const ev = tv.event;
      if (ev && ev.event_type) {
        link('event:' + ev.event_type, key);
        const bk = NOTIFY_EVENTS[ev.event_type], d = ev.data || {};
        if (bk && typeof d[bk] === 'string') link('nact:' + d[bk], key);
        toList(d.entity_id).forEach((x) => typeof x === 'string' && link(x, key));
      }
      if (typeof tv.topic === 'string') link('mqtt:' + tv.topic, key);
    }
    Object.values((g && g.trace) || {}).forEach((els) => (els || []).forEach((el) => {
      const p = el && el.result && el.result.params;
      if (!p || !p.domain) return;
      const t = p.target || {}, sd = p.service_data || {};
      let hit = false;
      toList(t.entity_id).concat(toList(sd.entity_id)).forEach((x) => { if (typeof x === 'string' && link(key, x)) hit = true; });
      toList(t.device_id).concat(toList(sd.device_id)).forEach((x) => { if (link(key, 'device:' + x)) hit = true; });
      Object.entries(TARGET_KEYS).forEach(([f, pre]) => toList(t[f]).concat(toList(sd[f])).forEach((x) => { if (link(key, pre + ':' + x)) hit = true; }));
      if (p.domain === 'script' && link(key, 'script.' + p.service)) hit = true;
      if (!hit) link(key, 'svc:' + p.domain + '.' + p.service);
      // a notification's buttons hang off it
      const acts = p.domain === 'notify' && sd.data && Array.isArray(sd.data.actions) ? sd.data.actions : [];
      acts.forEach((a) => { if (a && typeof a.action === 'string') link('svc:' + p.domain + '.' + p.service, 'nact:' + a.action); });
    }));
    return { keys: [...keys], edges: [...lit] };
  }
  // the box a run's trigger description points at: "state of light.x", "event 'timer.finished'", "mqtt topic a/b"
  function srcKey(src) {
    const s = String(src || '');
    const ev = s.match(/^event '([^']+)'/);
    if (ev) return 'event:' + ev[1];
    if (/^mqtt topic /.test(s)) return 'mqtt:' + s.slice(11).trim();
    const m = s.match(/\b([a-z_]+\.[a-z0-9_]+)\b/);
    return m ? m[1] : null;
  }
  /* ---------- the arrow editor (7.5): YAML previews, and finding and removing what an arrow stands for ---------- */
  function yScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const s = String(v);
    const plain = s !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]|[\s]$|: | #|\n/.test(s) && !/^(true|false|yes|no|on|off|null|~|-?\d+(\.\d+)?(e[-+]?\d+)?)$/i.test(s);
    return plain ? s : JSON.stringify(s);
  }
  // plain data as YAML, the way Home Assistant's editor writes it (for previews only; the board saves JSON)
  function toYaml(v, ind = 0) {
    const pad = ' '.repeat(ind);
    const empty = (x) => x && typeof x === 'object' && !(Array.isArray(x) ? x.length : Object.keys(x).length);
    if (Array.isArray(v)) {
      if (!v.length) return pad + '[]';
      return v.map((x) => (x && typeof x === 'object' && !empty(x) ? pad + '- ' + toYaml(x, ind + 2).slice(ind + 2) : pad + '- ' + (empty(x) ? (Array.isArray(x) ? '[]' : '{}') : yScalar(x)))).join('\n');
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) return pad + '{}';
      return keys.map((k) => {
        const x = v[k];
        if (x && typeof x === 'object' && !empty(x)) return pad + yScalar(k) + ':\n' + toYaml(x, Array.isArray(x) ? ind + 2 : ind + 2);
        return pad + yScalar(k) + ': ' + (empty(x) ? (Array.isArray(x) ? '[]' : '{}') : yScalar(x));
      }).join('\n');
    }
    return pad + yScalar(v);
  }
  const ACT_LISTS = ['then', 'else', 'sequence', 'default', 'parallel'];
  // the places in an automation or script config that name one box directly. Each has the path to its node, the
  // field that names the box, and whether removing it drops the whole node (it names nothing else) or only the box
  // from a list. A box named only inside a template, or through an area, isn't here: that takes the editor.
  function refsTo(cfg, isScript, key) {
    const out = [], plainEnt = EXACT_RE.test(key);
    const pre = TGT_RE.test(key) ? key.slice(0, key.indexOf(':')) : null, tgtField = pre && { area: 'area_id', floor: 'floor_id', label: 'label_id' }[pre];
    const id = key.startsWith('device:') ? key.slice(7) : pre ? key.slice(pre.length + 1) : key;
    const has = (v) => toList(v).includes(id);
    // everything else a node aims at, so removing this box can't leave a node without a target
    const others = (node, skip) => {
      let n = 0;
      [[node, 'entity_id'], [node, 'device_id'], [node.target, 'entity_id'], [node.target, 'device_id'], [node.target, 'area_id'], [node.target, 'floor_id'], [node.target, 'label_id'], [node.data, 'entity_id']]
        .forEach(([o, f]) => { if (o && o[f] != null && o[f] !== 'all' && o[f] !== 'none') n += toList(o[f]).filter((x) => !(o === skip[0] && f === skip[1] && x === id)).length; });
      return n;
    };
    const look = (node, path, kind) => {
      const found = [];
      const at = (o, f, rel) => { if (o && o[f] != null && typeof o[f] !== 'object' ? o[f] === id : o && Array.isArray(o[f]) && has(o[f])) found.push({ o, f, rel }); };
      if (plainEnt) {
        at(node, 'entity_id', ['entity_id']);
        at(node.target, 'entity_id', ['target', 'entity_id']);
        if (kind === 'action') at(node.data, 'entity_id', ['data', 'entity_id']);
        if (kind === 'action' && node.scene === key) return [{ path, mode: 'node', kind }];
        const svc = node.action || node.service;
        if (kind === 'action' && key.startsWith('script.') && svc === key) return [{ path, mode: 'node', kind }];
      } else if (key.startsWith('device:')) { at(node, 'device_id', ['device_id']); at(node.target, 'device_id', ['target', 'device_id']); }
      else if (tgtField) { at(node, tgtField, [tgtField]); at(node.target, tgtField, ['target', tgtField]); }
      else if (key.startsWith('event:') && kind === 'trigger' && (node.trigger || node.platform) === 'event') {
        const ts = toList(node.event_type);
        if (ts.includes(key.slice(6))) return [{ path, mode: ts.length > 1 ? 'drop' : 'node', field: ['event_type'], kind, item: key.slice(6) }];
      } else if (key.startsWith('svc:') && kind === 'action' && (node.action || node.service) === key.slice(4)) return [{ path, mode: 'node', kind }];
      else if (key.startsWith('mqtt:') && kind === 'trigger' && (node.trigger || node.platform) === 'mqtt' && node.topic === key.slice(5)) return [{ path, mode: 'node', kind }];
      else if (key.startsWith('nact:') && kind === 'trigger' && node.event_data && Object.values(node.event_data).includes(key.slice(5))) return [{ path, mode: 'node', kind }];
      return found.map(({ o, f, rel }) => ({ path, kind, field: rel, item: id, mode: toList(o[f]).length === 1 && !others(node, [o, f]) ? 'node' : 'drop' }));
    };
    const walkActs = (list, path) => toList(list).forEach((a, i) => {
      if (!a || typeof a !== 'object') return;
      const p = path.concat(Array.isArray(list) ? [i] : []);
      // a condition step among the actions
      out.push(...look(a, p, typeof a.condition === 'string' ? 'condition' : 'action'));
      if (Array.isArray(a.conditions) && typeof a.condition === 'string') walkConds(a.conditions, p.concat(['conditions']));
      ACT_LISTS.forEach((k) => { if (a[k] != null) walkActs(a[k], p.concat([k])); });
      if (a.if != null) walkConds(a.if, p.concat(['if']));
      toList(a.choose).forEach((o, j) => { if (o && typeof o === 'object') { const q = p.concat(Array.isArray(a.choose) ? ['choose', j] : ['choose']); if (o.conditions != null) walkConds(o.conditions, q.concat(['conditions'])); if (o.sequence != null) walkActs(o.sequence, q.concat(['sequence'])); } });
      if (a.repeat && typeof a.repeat === 'object') {
        if (a.repeat.sequence != null) walkActs(a.repeat.sequence, p.concat(['repeat', 'sequence']));
        ['while', 'until'].forEach((k) => { if (a.repeat[k] != null) walkConds(a.repeat[k], p.concat(['repeat', k])); });
      }
    });
    const walkConds = (list, path) => toList(list).forEach((c, i) => {
      if (!c || typeof c !== 'object') return;
      const p = path.concat(Array.isArray(list) ? [i] : []);
      out.push(...look(c, p, 'condition'));
      if (c.conditions != null) walkConds(c.conditions, p.concat(['conditions']));
    });
    if (isScript) walkActs(cfg.sequence, ['sequence']);
    else {
      const tk = cfg.triggers != null ? 'triggers' : 'trigger', ck = cfg.conditions != null ? 'conditions' : 'condition', ak = cfg.actions != null ? 'actions' : 'action';
      toList(cfg[tk]).forEach((t, i) => { if (t && typeof t === 'object') out.push(...look(t, Array.isArray(cfg[tk]) ? [tk, i] : [tk], 'trigger')); });
      walkConds(cfg[ck], [ck]);
      walkActs(cfg[ak], [ak]);
    }
    return out;
  }
  const getPath = (o, path) => path.reduce((x, k) => (x == null ? x : x[k]), o);
  // JSON with its keys sorted: two configs compare equal whatever order Home Assistant stored their keys in
  // the UI helpers whose settings a version keeps (their <domain>/list, update, create and delete commands)
  // a path on this Home Assistant ("/config/…"), not an address elsewhere ("//host", "https://…")
  const SAME_ORIGIN = /^\/(?![\/\\])/;
  // the "Other…" entry of the sandbox's dropdowns
  const SBX_OTHER = '\u0001other';
  const VER_HELPERS = new Set(['input_boolean', 'input_number', 'input_text', 'input_select', 'input_datetime', 'input_button', 'counter', 'timer', 'schedule']);
  // what may be clicked on a saved version's board: looking, the sandbox, and the versions themselves
  const VER_OK_ACTS = /^(zoomin|zoomout|fit|togglelist|legend|hl|hl-.+|sandbox|sbx-.+|flow-.+|lit-.+|edge|close|back|newtab|modal-.+|ver-.+|vtab.*|versions|about|diag|diag-.+|hint-x|find-x|nr-open)$/;
  // a short fingerprint of a snapshot's items and members: equal when the function is the same as that version
  const verPrint = (snap) => {
    const body = JSON.stringify([[...(snap.members || [])].sort(), Object.keys(snap.items || {}).sort().map((k) => [k, (snap.items[k] || {}).cfg || null])]);
    const str = canon(JSON.parse(body));
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + str.length.toString(16);
  };
  // every device id a config names, at any depth
  const devIdsIn = (v, out = new Set()) => {
    if (Array.isArray(v)) v.forEach((x) => devIdsIn(x, out));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k === 'device_id') [].concat(x).forEach((d) => { if (typeof d === 'string' && /^[0-9a-f]{32}$/.test(d)) out.add(d); }); else devIdsIn(x, out); });
    return out;
  };
  // a config with some device ids swapped for others (a replaced device)
  const swapDevs = (v, map) => (Array.isArray(v) ? v.map((x) => swapDevs(x, map)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapDevs(x, map)])) : typeof v === 'string' && map[v] ? map[v] : v);
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
  // an id such as garage_door.opened as words: "Garage door opened"
  const humanize = (s) => { const x = String(s).replace('.', ' ').replace(/_/g, ' '); return x.charAt(0).toUpperCase() + x.slice(1); };
  // a copy of a config without the given references (from refsTo on the same config)
  function dropRefs(cfg, refs) {
    const c = JSON.parse(JSON.stringify(cfg));
    // lists first, nodes after, the deepest and the last in each list first, so the paths stay valid
    refs.filter((r) => r.mode === 'drop').forEach((r) => {
      const node = getPath(c, r.path), parent = node && getPath(node, r.field.slice(0, -1)), f = r.field[r.field.length - 1];
      if (!parent || parent[f] == null) return;
      const left = toList(parent[f]).filter((x) => x !== r.item);
      if (Array.isArray(parent[f])) parent[f] = left.length === 1 ? left[0] : left; else delete parent[f];
    });
    refs.filter((r) => r.mode === 'node').slice().sort((a, b) => b.path.length - a.path.length || String(b.path[b.path.length - 1]).localeCompare(String(a.path[a.path.length - 1]), undefined, { numeric: true }))
      .forEach((r) => {
        const last = r.path[r.path.length - 1], parent = getPath(c, r.path.slice(0, -1));
        if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
        else if (parent && typeof parent === 'object') delete parent[last];
      });
    return c;
  }
  // a reference in a few words: "Trigger 2", "Action 1 › then 2", for the arrow editor
  function refPlace(r) {
    const p = r.path, name = { triggers: T('trigger'), trigger: T('trigger'), conditions: T('condition_2'), condition: T('condition_2'), actions: T('action'), action: T('action'), sequence: T('step') }[p[0]] || T('part');
    const parts = [];
    for (let i = 1; i < p.length; i++) {
      if (typeof p[i] === 'number') parts.push(String(p[i] + 1));
      else if (!['conditions', 'sequence'].includes(p[i]) || i === p.length - 2) parts.push(p[i] === 'conditions' ? 'condition' : p[i]);
    }
    const first = typeof p[1] === 'number' ? `${name} ${p[1] + 1}` : name;
    return [first].concat(parts.slice(typeof p[1] === 'number' ? 1 : 0)).join(' › ').replace(/ › (\d+)/g, ' $1');
  }

  /* ---------- Node-RED flows (2.7, decision D1): one box per wired group of nodes in a flow tab ---------- */
  const NR_TRIG = new Set(['server-state-changed', 'trigger-state', 'poll-state', 'server-events', 'ha-zone', 'ha-time', 'inject']);
  // groups of wired-together nodes and the Home Assistant entities they trigger on, read and change
  function nrGroups(flows, known) {
    const all = Array.isArray(flows) ? flows : [], tabs = new Map(all.filter((n) => n && n.type === 'tab').map((t) => [t.id, t]));
    const nodes = all.filter((n) => n && n.z && tabs.has(n.z) && !['tab', 'comment', 'group'].includes(n.type));
    const adj = new Map(nodes.map((n) => [n.id, new Set()])), byId = new Map(nodes.map((n) => [n.id, n]));
    nodes.forEach((n) => toList(n.wires).flat().forEach((t) => { if (adj.has(t)) { adj.get(n.id).add(t); adj.get(t).add(n.id); } }));
    const ids = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? toList(v.entity) : typeof v === 'string' ? v.split(',').map((x) => x.trim()) : toList(v)).filter((x) => typeof x === 'string' && x);
    const scan = (s) => { const out = []; if (typeof s === 'string') for (const m of s.matchAll(ENTITY_RE)) out.push(m[0]); return out; };
    const seen = new Set(), out = [];
    nodes.forEach((n0) => {
      if (seen.has(n0.id)) return;
      const q = [n0.id], g = [];
      seen.add(n0.id);
      while (q.length) { const u = q.shift(); g.push(byId.get(u)); adj.get(u).forEach((v) => { if (!seen.has(v)) { seen.add(v); q.push(v); } }); }
      const trig = new Set(), read = new Set(), change = new Set(), calls = new Set(), events = new Set();
      const add = (set, list) => list.forEach((x) => { const e = known(x); if (e) set.add(e); });
      g.forEach((n) => {
        if (n.type === 'server-state-changed' || n.type === 'trigger-state' || n.type === 'ha-wait-until') add(n.type === 'ha-wait-until' ? read : trig, ids(n.entities).concat(n.entityidfiltertype && n.entityidfiltertype !== 'exact' ? [] : ids(n.entityidfilter), ids(n.entityId || n.entityid)));
        if (n.type === 'poll-state') add(trig, ids(n.entityId || n.entity_id));
        if (n.type === 'server-events' && typeof (n.eventType || n.event_type) === 'string' && (n.eventType || n.event_type)) events.add(n.eventType || n.event_type);
        if (n.type === 'api-current-state' || n.type === 'api-get-history') add(read, ids(n.entity_id || n.entityId));
        if (n.type === 'api-render-template') add(read, scan(n.template));
        if (n.type === 'function') add(read, scan(n.func).concat(scan(n.initialize), scan(n.finalize)));
        if (n.type === 'api-call-service') {
          const svc = n.action || (n.domain && n.service ? n.domain + '.' + n.service : '');
          add(change, ids(n.entityId).concat(ids(n.entity_id), scan(typeof n.data === 'string' ? n.data : '')));
          if (/^script\.[a-z0-9_]+$/.test(svc) && !['script.turn_on', 'script.turn_off', 'script.toggle', 'script.reload'].includes(svc)) add(calls, [svc]);
          if (svc === 'script.turn_on') ids(n.entityId).forEach((x) => { const e = known(x); if (e) { calls.add(e); change.delete(e); } });
        }
      });
      if (!trig.size && !read.size && !change.size && !calls.size && !events.size) return;
      const first = g.find((n) => NR_TRIG.has(n.type) && n.name) || g.find((n) => n.name), tab = tabs.get(n0.z);
      const gid = n0.z + ':' + g.map((n) => n.id).sort()[0];
      out.push({ id: gid, tab: n0.z, tabLabel: (tab && tab.label) || T('flow'), name: (first && first.name) || (tab && tab.label) || T('node_red_flow'), size: g.length,
        trig: [...trig], read: [...read].filter((x) => !trig.has(x)), change: [...change], calls: [...calls], events: [...events] });
    });
    return out;
  }

  // what the developer tools say and use (Phase 9)
  let FULL_ONLY_TEST, TEST_WARN, DBG_FILTERS;
  onLang(() => {
    FULL_ONLY_TEST = T('tests_need_full_manager_switch');
    TEST_WARN = T('tests_change_your_home_assistant');
    DBG_FILTERS = { all: [T('all'), null], state: [T('changes'), ['state', 'log']], run: [T('runs'), ['run']], call: [T('calls'), ['call']], test: [T('tests'), ['test', 'watch']] };
  });
  const NO_MONITOR = new Set(['state_changed', 'call_service', 'state_reported', 'service_registered', 'component_loaded']);
  const DBG_BACK = 15 * 60000;  // the debugger starts with the last 15 minutes
  const DBG_QUIET = new Set(['logbook', 'system_log', 'recorder', 'frontend', 'browser_mod']);
  const DBG_ICON = { state: 'mdi:swap-horizontal', run: 'mdi:play-circle-outline', call: 'mdi:gesture-tap', test: 'mdi:flask-outline', watch: 'mdi:eye-outline', log: 'mdi:text-box-outline' };
  const fmtValue = (v) => shorten(v === undefined ? '' : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v), 300);
  const TEST_KINDS = new Set(['action', 'state', 'event', 'mqtt', 'notify', 'run']);
  const SVC_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
  // a test kept on the board (9.2) comes back from storage as plain JSON: keep only what a test can be
  function cleanTest(t) {
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

  const DEFS = '<defs>' + [['n', 'var(--fb-edge)'], ['hi', 'var(--primary-text-color)'], ['amber', '#fab219'], ['blue', '#5598e7'],
    ['trig', 'var(--fb-trig)'], ['act', 'var(--fb-act)'], ['call', 'var(--fb-call)']]
    .map(([id, c]) => `<marker id="fb-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:${c}"></path></marker>`)
    .join('') + '<marker id="fb-dot" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="4" style="fill:var(--fb-edge)"></circle></marker>'
    + '<marker id="fb-dottrig" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="4" style="fill:var(--fb-trig)"></circle></marker>'
    + '<marker id="fb-dothi" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="4" style="fill:var(--primary-text-color)"></circle></marker>'
    + '</defs>';

  const STYLE = `
:host{display:block;--fb-amber:#fab219;--fb-red:#d03b3b;--fb-blue:#5598e7;
  --fb-edge:color-mix(in srgb,var(--secondary-text-color) 75%,transparent);
  --fb-dot:color-mix(in srgb,var(--secondary-text-color) 22%,transparent)}
*{box-sizing:border-box}
[hidden]{display:none!important}
button{font:inherit;color:inherit}
.board{position:relative;display:flex;height:calc(100vh - var(--header-height,56px) - env(safe-area-inset-top,0px));min-height:420px;
  background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--ha-font-family-body,Roboto,sans-serif);overflow:hidden}
.list{width:250px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--divider-color);background:var(--card-background-color)}
.board.nolist .list{display:none}
.lhead{display:flex;align-items:center;justify-content:space-between;padding:10px 8px 6px 16px;font-weight:500;font-size:15px}
.fns{flex:1;overflow:auto;padding:0 8px}
.lfind{display:flex;align-items:center;gap:6px;margin:0 8px 6px;padding:0 4px 0 10px;border:1px solid var(--divider-color);border-radius:10px;background:var(--primary-background-color)}
.lfind ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color);flex:none}
.lfind input{flex:1;min-width:0;border:0;background:none;color:var(--primary-text-color);font:inherit;font-size:13px;padding:7px 0;outline:none}
.lfind .ib{padding:2px}
.fres{padding:6px 4px;border-bottom:1px solid var(--divider-color)}
.fgo{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;cursor:pointer;text-align:left;padding:2px 4px;border-radius:8px;color:var(--primary-text-color);font-size:13px}
.fgo:hover{background:var(--secondary-background-color)}
.fgo .tag{min-width:64px;text-align:center}
.fin{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:3px 4px 0 76px}
.fin .chip{padding:2px 8px;font-size:11.5px}
.fnrow{position:relative}
.fn{display:flex;align-items:center;gap:10px;width:100%;padding:8px 34px 8px 8px;border:0;border-radius:10px;background:none;text-align:left;cursor:pointer}
.fnmore{position:absolute;right:2px;top:50%;transform:translateY(-50%);opacity:0}
.fnrow:hover .fnmore,.fnmore:focus,.board.compact .fnmore{opacity:1}
@media (hover:none){.fnmore{opacity:1}}
.fn:hover{background:var(--secondary-background-color)}
.fn.cur{background:color-mix(in srgb,var(--primary-color) 14%,transparent)}
.fn ha-icon{--mdc-icon-size:20px;flex:none}
.fnt{display:flex;flex-direction:column;min-width:0;flex:1}
.fnn{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fnc{font-size:12px;color:var(--secondary-text-color)}
.dot{width:8px;height:8px;border-radius:50%;flex:none}.dot.warn{background:var(--fb-amber)}
.lfoot{padding:10px 12px;border-top:1px solid var(--divider-color);display:flex;flex-direction:column;gap:8px}
.lfoot select{width:100%;padding:7px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:inherit;font:inherit;font-size:13px}
.ver{font-size:11px;color:var(--secondary-text-color)}
.main{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;container-type:inline-size}
.stage{position:relative;flex:1;display:flex;min-height:0}
.bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--divider-color);background:var(--card-background-color);min-height:52px;flex-wrap:wrap}
.title{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 220px}
.title .ib{flex:none}
.title>ha-icon{--mdc-icon-size:24px;flex:none}
.tt{min-width:0;flex:0 1 auto}
.ttl{font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.desc{font-size:12px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44vw}
.tools{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
.tools button,.lhead button,.ib,.dhead button,.zoom button,.nodebar button{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid transparent;border-radius:8px;background:none;cursor:pointer;font-size:13px;color:var(--primary-text-color);white-space:nowrap}
.tools button:hover,.lhead button:hover,.ib:hover,.dhead button:hover,.zoom button:hover,.nodebar button:hover{background:var(--secondary-background-color)}
.tools ha-icon,.lhead ha-icon,.ib ha-icon,.dhead ha-icon,.nodebar ha-icon{--mdc-icon-size:18px}
.ib{padding:6px}
.sep{width:1px;height:22px;background:var(--divider-color);margin:0 4px}
[data-confirm]{border-color:var(--fb-amber)!important;color:var(--fb-amber)!important}
.vp{position:relative;flex:1;min-width:0;overflow:hidden;touch-action:none;-webkit-touch-callout:none;background-color:var(--primary-background-color);
  background-image:radial-gradient(var(--fb-dot) 1px,transparent 1px);background-size:22px 22px}
.world{position:absolute;left:0;top:0;transform-origin:0 0}
.edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.edges path.e{fill:none;stroke:var(--fb-edge);stroke-width:1.6;pointer-events:stroke;transition:opacity .15s}
.edges path.role-trigger{stroke-width:2.6}
.edges path.role-call{stroke-width:2.6;stroke-dasharray:10 3}
.edges path.role-condition{stroke-dasharray:4 4}
.edges path.role-source{stroke-dasharray:1.5 4;stroke-linecap:round;stroke-width:2}
.edges path.loop{stroke:var(--fb-amber)}
.edges path.hi{stroke:var(--primary-text-color)}
.edges path.dim{opacity:.12}
.edges path.live{stroke:var(--fb-blue);stroke-dasharray:7 5;animation:flow .5s linear infinite}
/* arrows coloured by what they mean (prototype): sets off, changes, runs a script; checks and reads stay grey */
.board{--fb-trig:#d95926;--fb-act:#3987e5;--fb-call:#199e70}
.board.light{--fb-trig:#eb6834;--fb-act:#2a78d6;--fb-call:#1baf7a}
.board.pc .edges path.role-trigger{stroke:var(--fb-trig);stroke-width:2.2}
.board.pc .edges path.role-action{stroke:var(--fb-act);stroke-width:1.8}
.board.pc .edges path.role-call{stroke:var(--fb-call);stroke-width:2.4;stroke-dasharray:none}
.board.pc .edges path.role-condition{stroke-dasharray:5 4;stroke-width:1.5}
.board.pc .edges path.role-source{stroke-width:1.8}
.board.pc .edges path.loop{filter:drop-shadow(0 0 2px var(--fb-amber)) drop-shadow(0 0 2px var(--fb-amber))}
.board.pc .edges path.hi.role-trigger{stroke:var(--fb-trig);stroke-width:3}
.board.pc .edges path.hi.role-action{stroke:var(--fb-act);stroke-width:2.6}
.board.pc .edges path.hi.role-call{stroke:var(--fb-call);stroke-width:3.2}
.board.pc .edges path.live{stroke:var(--primary-text-color);stroke-width:2.6}
.edges circle.jd{stroke:var(--fb-edge);stroke-width:2}
.edges circle.jd.split{fill:var(--fb-edge);stroke:none}
.board.pc .edges circle.jd.split.role-trigger{fill:var(--fb-trig)}
.board.pc .edges circle.jd.split.role-action{fill:var(--fb-act)}
.board.pc .edges circle.jd.split.role-call{fill:var(--fb-call)}
.board.pc .edges circle.jd.role-trigger{stroke:var(--fb-trig)}
.board.pc .edges circle.jd.role-action{stroke:var(--fb-act)}
.board.pc .edges circle.jd.role-call{stroke:var(--fb-call)}
.edges path.chev{fill:var(--fb-edge);stroke:none}
.edges path.e.trdim{opacity:.13}
.edges path.trc{fill:none;pointer-events:none;stroke-width:3.4!important;opacity:1}
.board:not(.pc) .edges path.trc{stroke:var(--primary-text-color)}
.board.pc .edges path.chev.role-trigger{fill:var(--fb-trig)}
.board.pc .edges path.chev.role-action{fill:var(--fb-act)}
.board.pc .edges path.chev.role-call{fill:var(--fb-call)}
.edges path.chev.dim{opacity:.12}
.edges circle.jd.dim{opacity:.18}
.board.pc .lg svg path.role-trigger{stroke:var(--fb-trig)}
.board.pc .lg svg path.ah.role-trigger,.board.pc .lg svg .ah.trig{fill:var(--fb-trig)}
.board.pc .lg svg path.role-action{stroke:var(--fb-act)}
.board.pc .lg svg path.ah.role-action{fill:var(--fb-act)}
.board.pc .lg svg path.role-call{stroke:var(--fb-call);stroke-dasharray:none}
.board.pc .lg svg path.ah.role-call{fill:var(--fb-call)}
.board.pc .lg svg path.loop{stroke:var(--fb-edge);filter:drop-shadow(0 0 2px var(--fb-amber)) drop-shadow(0 0 2px var(--fb-amber))}
.board.pc .lg svg path.ah.loop{fill:var(--fb-edge)}
@keyframes flow{to{stroke-dashoffset:-12}}
.edges text{font-size:11px;fill:var(--primary-text-color);paint-order:stroke;stroke:var(--primary-background-color);stroke-width:4px;stroke-linejoin:round}
.khead{position:absolute;font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--secondary-text-color);pointer-events:none;white-space:nowrap}
.frame{position:absolute;border:1.5px dashed var(--divider-color);border-radius:16px;background:color-mix(in srgb,var(--secondary-background-color) 45%,transparent)}
.fhead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 14px;cursor:grab;font-size:13px;font-weight:500;color:var(--secondary-text-color)}
.ftitle{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ftin{font:inherit;font-size:13px;font-weight:500;padding:2px 6px;border-radius:6px;border:1px solid var(--primary-color);background:var(--card-background-color);color:var(--primary-text-color);width:70%}
.fdel,.ndel{border:0;background:none;cursor:pointer;font-size:16px;line-height:1;color:var(--secondary-text-color);opacity:0;padding:2px 6px}
.frame:hover .fdel,.note:hover .ndel{opacity:1}
.fresize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;cursor:nwse-resize;border-right:2px solid var(--divider-color);border-bottom:2px solid var(--divider-color);border-radius:0 0 10px 0}
.node{position:absolute;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;border-radius:12px;background:var(--card-background-color);
  border:1px solid var(--divider-color);box-shadow:var(--ha-card-box-shadow,0 1px 2px rgba(0,0,0,.2));cursor:grab;user-select:none;-webkit-user-select:none;transition:opacity .15s,box-shadow .2s}
.node:active{cursor:grabbing}
.node .ic{--mdc-icon-size:22px;color:var(--state-icon-color,var(--secondary-text-color));flex:none}
.node .txt{min-width:0;flex:1}
.node .name{font-size:13px;font-weight:500;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node .sub{font-size:11.5px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.node .badges{display:flex;gap:2px;align-self:flex-start;flex:none;align-items:center}
.node .badges ha-icon{--mdc-icon-size:14px;color:var(--secondary-text-color)}
.node .wr{font-size:10.5px;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:8px;padding:0 4px;line-height:14px}
.node.outside{border-radius:20px;padding:4px 12px;background:var(--primary-background-color);border-style:dashed;box-shadow:none}
.node.outside .ic{--mdc-icon-size:16px}
.node.outside .name{font-weight:400;font-size:12px;color:var(--secondary-text-color)}
.node.suggest{border-style:dashed;box-shadow:none;background:var(--primary-background-color)}
.node.off .ic,.node.off .name{opacity:.55}
.node.warn{border-left:4px solid var(--fb-amber)}
.node.err{border-left:4px solid var(--fb-red)}
.node.running{box-shadow:0 0 0 2px var(--fb-blue)}
.node.sel{box-shadow:0 0 0 2px var(--primary-text-color)}
.node.hov{box-shadow:0 0 0 3px var(--fb-blue)}
.node.dim{opacity:.2}
.node.pulse{animation:pulse 1.8s ease-out}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fb-blue) 85%,transparent)}100%{box-shadow:0 0 0 16px transparent}}
.node.lifted,.frame.lifted,.note.lifted{outline:2px solid var(--primary-color);outline-offset:2px;box-shadow:0 8px 24px rgba(0,0,0,.45)}
.note{position:absolute;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:var(--ha-card-box-shadow,none)}
.nhead{display:flex;align-items:center;justify-content:space-between;padding:4px 2px 0 10px;cursor:grab;color:var(--secondary-text-color)}
.nhead ha-icon{--mdc-icon-size:16px}
.nbody{display:block;width:100%;border:0;resize:none;overflow:hidden;background:none;color:var(--primary-text-color);font:inherit;font-size:13px;line-height:1.4;padding:4px 12px 10px;outline:none}
.nodebar{position:absolute;display:flex;align-items:center;gap:2px;padding:4px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);
  box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:5;white-space:nowrap;transform:translateY(-100%);flex-wrap:wrap;max-width:calc(100% - 12px)}
.nodebar ha-icon{width:18px;height:18px;flex:none}
.nbname{font-size:12px;color:var(--secondary-text-color);padding:0 6px 0 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.nodebar button span{font-size:12px}
.zoom{position:absolute;right:12px;bottom:12px;display:flex;gap:2px;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:10px;padding:2px;z-index:4}
.zoom button{min-width:34px;justify-content:center;font-size:16px}
.legend{position:absolute;left:12px;bottom:12px;z-index:4;font-size:12px;color:var(--secondary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:10px;padding:6px 10px;max-width:310px}
.lgt{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:var(--secondary-text-color);cursor:pointer;padding:0;font-size:12px}
.lgt ha-icon{--mdc-icon-size:16px}
.lg{display:grid;grid-template-columns:40px 1fr;gap:3px 8px;align-items:center;margin-top:6px}
.lg svg path{fill:none;stroke:var(--fb-edge);stroke-width:1.6}
.lg svg .ah{fill:var(--fb-edge);stroke:none}
.lg svg path.role-trigger,.lg svg path.role-call{stroke-width:2.6}
.lg svg path.role-condition{stroke-dasharray:4 3}
.lg svg path.role-source{stroke-dasharray:1.5 3;stroke-linecap:round;stroke-width:2}
.lg svg path.role-call{stroke-dasharray:8 2}
.lg svg path.loop{stroke:var(--fb-amber)}
.lg svg path.ah.loop{fill:var(--fb-amber)}
.lgn{margin-top:6px;line-height:1.7}
.sw{display:inline-block;width:14px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid var(--secondary-text-color)}
.sw.dashed{border-style:dashed}.sw.pill{border-radius:6px;border-style:dashed}
.sw.st{border:0;width:4px;height:12px;border-radius:2px;margin-right:4px}
.sw.amber{background:var(--fb-amber)}.sw.red{background:var(--fb-red)}.sw.blue{background:var(--fb-blue)}
.tg{display:flex;align-items:center;gap:6px;margin-top:4px;cursor:pointer}
.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--secondary-text-color);padding:24px;pointer-events:none;line-height:1.6}
.empty b{color:var(--primary-text-color)}
.loading{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;padding:4px 12px;font-size:12px;color:var(--secondary-text-color);z-index:4}
.toast{position:absolute;bottom:64px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;background:var(--primary-text-color);color:var(--primary-background-color);border-radius:10px;padding:8px 14px;font-size:13px;z-index:20;max-width:80%}
.toast button{border:0;background:none;cursor:pointer;padding:2px 4px;font-size:12.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--primary-color)}
.drawer{position:absolute;top:0;right:0;bottom:0;width:min(780px,62%);display:flex;flex-direction:column;background:var(--card-background-color);border-left:1px solid var(--divider-color);box-shadow:-6px 0 18px rgba(0,0,0,.25);z-index:7}
.dhead{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--divider-color)}
.dtitle{flex:1;font-weight:500;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:6px}
.dcap{font-size:12px;color:var(--fb-blue);white-space:nowrap}
.drawer iframe{flex:1;border:0;width:100%;background:var(--primary-background-color)}
.runs{flex:1;overflow:auto}
.runs .run{display:grid;grid-template-columns:124px 1fr auto;gap:10px;align-items:center;width:100%;text-align:left;padding:8px 12px;border:0;border-bottom:1px solid var(--divider-color);background:none;cursor:pointer}
.runs .run:hover{background:var(--secondary-background-color)}
.rt{font-size:12px;color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.rn{display:flex;flex-direction:column;min-width:0}.rn b{font-weight:500;font-size:13px}
.rn span{font-size:12px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ro{font-size:12px;color:var(--secondary-text-color);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.runs .run.red .ro{color:var(--fb-red)}.runs .run.blue .ro{color:var(--fb-blue)}.runs .run.amber .ro{color:var(--fb-amber)}
.modal{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:30}
.dlg{width:min(460px,92%);max-height:88%;display:flex;flex-direction:column;gap:12px;background:var(--card-background-color);border-radius:16px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
.dlg.wide{width:min(640px,94%)}
.dlg h3{margin:0;font-size:18px;font-weight:500}
.dlg label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--secondary-text-color)}
.dlg input:not([type=checkbox]),.dlg select{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font:inherit;font-size:14px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dlg label.chk{flex-direction:row;align-items:center;gap:8px;font-size:13px;color:var(--primary-text-color)}
.dlg.diag .dwarn{color:var(--warning-color,#b26a00)}
.dlg.diag h4+p{margin-top:0}
.dlg.diag .dvers{display:flex;flex-direction:column;gap:4px;margin-top:6px;max-height:180px;overflow:auto}
.hint{font-size:12px;color:var(--secondary-text-color);line-height:1.5}
.btns{display:flex;justify-content:flex-end;gap:8px;align-items:center}
.btns .cnt{margin-right:auto}
.btns button{padding:8px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer}
.btns button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.picks{overflow:auto;min-height:200px;max-height:50vh;border:1px solid var(--divider-color);border-radius:10px}
.dlg label.pick{flex-direction:row;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--divider-color);cursor:pointer;color:var(--primary-text-color)}
.pick ha-icon{--mdc-icon-size:20px;color:var(--secondary-text-color)}
.pick span{display:flex;flex-direction:column;min-width:0}.pick b{font-weight:500;font-size:13px}.pick small{font-size:11px;color:var(--secondary-text-color)}
.muted{color:var(--secondary-text-color);font-size:13px}.pad{padding:12px}.small{font-size:12px}
/* v0.2: type tags, list buttons, pickers, import manager */
.tag{display:inline-block;font-size:9.5px;line-height:14px;letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border-radius:4px;border:1px solid var(--divider-color);color:var(--secondary-text-color);background:var(--primary-background-color);white-space:nowrap;flex:none}
.node>.tag{position:absolute;top:-8px;left:12px;pointer-events:none}
.node.outside>.tag{left:16px}
.lhead>span:last-child{display:flex;gap:2px}
.lbtn{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--divider-color);border-radius:10px;background:none;cursor:pointer;font-size:13px;color:var(--primary-text-color)}
.lbtn:hover{background:var(--secondary-background-color)}
.lbtn ha-icon{--mdc-icon-size:18px}
.selbox{min-width:0}.selbox ha-selector{display:block}
.dlg.mgr{width:min(1000px,96%);height:min(860px,92%);max-height:none;padding:0;gap:0}
.mhead{display:flex;align-items:center;gap:16px;padding:12px 12px 0 20px}
.mhead h3{flex:none}
.tabs{display:flex;gap:2px;flex:1;align-self:flex-end}
.tab{padding:10px 14px;border:0;border-bottom:2px solid transparent;background:none;cursor:pointer;color:var(--secondary-text-color);font-size:14px}
.tab.on{color:var(--primary-text-color);border-bottom-color:var(--primary-color)}
.mbody{flex:1;overflow:auto;padding:6px 20px 14px;border-top:1px solid var(--divider-color);border-bottom:1px solid var(--divider-color);display:flex;flex-direction:column;gap:8px}
.mintro{padding:8px 0 2px}
.mfoot{display:flex;align-items:center;gap:8px;padding:12px 20px;flex-wrap:wrap}
.mfoot .cnt{margin-left:auto;font-size:13px;color:var(--secondary-text-color)}
.mfoot button,.crow button.go{padding:8px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:13px;white-space:nowrap}
.mfoot button.primary,.crow button.go{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.mfoot button[disabled],.crow button[disabled]{opacity:.45;cursor:default}
.dlg label.mcats{flex-direction:row;align-items:center;gap:8px;font-size:12px;max-width:520px}
.cand{border:1px solid var(--divider-color);border-radius:12px;background:var(--card-background-color);flex:none}
.cand.done{opacity:.55}
.cand.left{border-style:dashed}
.cname.static{flex:1;font-size:14px;font-weight:500;padding:6px 8px}
.lrow2{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px}
.lrow2 .mn{flex:1}
.lrow2 .tag{min-width:80px;text-align:center}
.lrow2 .chip[disabled]{opacity:.45;cursor:default}
.crow{display:flex;align-items:center;gap:10px;padding:6px 10px}
.crow>ha-icon{--mdc-icon-size:20px;color:var(--secondary-text-color);flex:none}
.dlg input.cname{flex:1;min-width:140px;font-size:14px;font-weight:500;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:none}
.dlg input.cname:hover,.dlg input.cname:focus{border-color:var(--divider-color);background:var(--primary-background-color);outline:none}
.ccount{font-size:12px;color:var(--secondary-text-color);white-space:nowrap}
.csrc{font-size:11px;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:8px;padding:1px 6px;white-space:nowrap}
.onb{font-size:12px;color:var(--secondary-text-color);white-space:nowrap}
.cmem{display:flex;flex-direction:column;padding:2px 12px 10px 40px;border-top:1px solid var(--divider-color)}
.dlg label.mrow,.dlg label.lrow,.dlg label.pick{display:flex;flex-direction:row;align-items:center;gap:10px;padding:5px 0;cursor:pointer;color:var(--primary-text-color);font-size:13px}
.dlg label.lrow,.dlg label.pick{padding:6px 10px;border-bottom:1px solid var(--divider-color)}
.dlg label.lrow ha-icon{--mdc-icon-size:20px}
.mn{display:flex;flex-direction:column;min-width:0}.mn b{font-weight:500}
.mn small{font-size:11px;color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mrow .tag,.pick .tag{min-width:80px;text-align:center}
.ptop{display:flex;gap:12px;flex-wrap:wrap;padding-top:8px}
.ptop label{min-width:220px}
.dlg input.search{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font:inherit;font-size:14px}
/* v0.2.1: picker chips and paging */
.pchips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:16px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:12.5px;color:var(--primary-text-color)}
.chip span{color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.chip.on{background:color-mix(in srgb,var(--primary-color) 18%,transparent);border-color:var(--primary-color)}
.dlg label.tg2{flex-direction:row;align-items:center;gap:6px;font-size:12px;margin-left:auto;color:var(--secondary-text-color)}
.mbody .picks{max-height:none;min-height:0;overflow:visible}
.dlg label.pick.infn{opacity:.6}
.dlg label.mrow.nolab{opacity:.6;cursor:default}
.menu{position:absolute;z-index:25;min-width:200px;max-height:70%;overflow:auto;padding:4px;border-radius:12px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.mtitle{font-size:11.5px;color:var(--secondary-text-color);padding:6px 10px 4px;text-transform:uppercase;letter-spacing:.05em}
.mi{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;cursor:pointer;font-size:13.5px;text-align:left;color:var(--primary-text-color)}
.mi:hover:not([disabled]){background:var(--secondary-background-color)}
.mi[disabled]{color:var(--secondary-text-color);cursor:default}
.mi ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color)}
.msep{height:1px;background:var(--divider-color);margin:4px 6px}
.mdepth{display:flex;align-items:center;gap:4px;padding:4px 10px 6px 38px;flex-wrap:wrap;font-size:12px;color:var(--secondary-text-color)}
.mdepth span{margin-right:4px}
.mdepth.off{opacity:.45}
.mdepth .chip{padding:2px 8px;font-size:12px}
.node .wr.hid{border-style:dashed}
.node .kept{--mdc-icon-size:13px;color:var(--secondary-text-color)}
.node .port{position:absolute;width:8px;height:8px;border-radius:50%;box-sizing:border-box;border:1.5px solid var(--fb-edge);background:var(--card-background-color,#1c1c1c);pointer-events:none}
.node .port.pl{left:-4px}
.node .port.pr{right:-4px}
.board.vert .node .port.pl{top:-4px}
.board.vert .node .port.pr{top:auto;bottom:-4px;right:auto}
.board.full .node .port{pointer-events:auto;cursor:crosshair}
.board.full .node .port:hover{border-color:var(--primary-color);background:var(--primary-color);transform:scale(1.5)}
.dtext{margin:0;font-size:13.5px;line-height:1.5}
.dtext.dno{color:var(--fb-amber)}
.dwarn{display:flex;align-items:flex-start;gap:6px;font-size:12.5px;color:var(--fb-amber);margin-top:2px}
.dwarn ha-icon{--mdc-icon-size:16px;flex:none}
.dlist{overflow:auto;max-height:42vh;border:1px solid var(--divider-color);border-radius:10px}
.dlg label.drow{display:flex;flex-direction:row;align-items:flex-start;gap:10px;padding:7px 10px;border-bottom:1px solid var(--divider-color);font-size:13px;color:var(--primary-text-color);cursor:pointer}
.dlg label.drow.dcant{opacity:.6;cursor:default}
.drow .tag{min-width:80px;text-align:center;margin-top:2px}
.btns button.danger{background:var(--fb-red);border-color:var(--fb-red);color:#fff}
.btns button[disabled]{opacity:.6;cursor:default}
.clash{font-size:13px;line-height:1.5;padding:10px 12px;border-radius:10px;border:1px solid var(--fb-amber);background:color-mix(in srgb,var(--fb-amber) 10%,transparent)}
.cbtns{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.cbtns button{padding:6px 12px;border-radius:8px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:13px}
.cbtns button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.more{display:block;margin:10px auto;padding:8px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:13px;color:var(--primary-text-color)}
/* v0.5: developer tools (Phase 9) */
.edges path.hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke}
.edges path.e{pointer-events:none}
.edges path.role-tool{stroke-dasharray:2 5;stroke-width:1.5;stroke-linecap:round}
.edges g.cres{pointer-events:all;cursor:default}
.edges g.cres circle{fill:var(--card-background-color);stroke-width:1.6}
.edges g.cres path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.edges g.cres text{font-size:11px;font-weight:700;stroke:none;paint-order:normal}
.edges g.cres.ok circle{stroke:var(--success-color,#43a047)}.edges g.cres.ok path{stroke:var(--success-color,#43a047)}
.edges g.cres.bad circle{stroke:var(--fb-red)}.edges g.cres.bad path{stroke:var(--fb-red)}
.edges g.cres.unk circle{stroke:var(--secondary-text-color)}.edges g.cres.unk text{fill:var(--secondary-text-color)}
.edges g.cres.dim{opacity:.15}
.lg svg path.role-tool{stroke-dasharray:2 4;stroke-linecap:round}
.cres-k{display:inline-flex;width:15px;height:15px;border-radius:50%;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:1.5px solid;margin-right:3px}
.cres-k.ok{color:var(--success-color,#43a047)}.cres-k.bad{color:var(--fb-red)}
.sw.dashed2{border:2px dashed var(--fb-blue)}
.sw.sbk{border:2px dashed var(--fb-amber)}
.sw.sbg{border:2px dashed var(--fb-amber);border-radius:5px;background:color-mix(in srgb,var(--card-background-color) 80%,var(--fb-amber))}
.node.sim{outline:2px dashed var(--fb-blue);outline-offset:2px}
.board.sbx .vp{background-image:repeating-linear-gradient(45deg,color-mix(in srgb,var(--fb-amber) 6%,transparent) 0 14px,transparent 14px 28px)}
.sbxpill{position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:6px;white-space:nowrap;background:color-mix(in srgb,var(--fb-amber) 20%,var(--card-background-color));border:1px solid var(--fb-amber);color:var(--primary-text-color);border-radius:14px;padding:4px 12px;font-size:12px;z-index:5;pointer-events:none}
.sbxdlg{width:min(620px,94%);overflow:auto}
.sbxdlg h3{display:flex;align-items:center;gap:8px}.sbxdlg h3 ha-icon{color:var(--fb-amber)}
.sbxdlg p{margin:0;font-size:13.5px;line-height:1.45}
.sbxdlg h4{margin:4px 0 0;font-size:13.5px}
.sbxl{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.4;color:var(--secondary-text-color)}
.sbxl b{color:var(--primary-text-color);font-weight:500}
.okbox{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--fb-green,#43a047) 14%,transparent);font-size:13px;line-height:1.4}
.okbox ha-icon{--mdc-icon-size:20px;color:var(--fb-green,#43a047);flex:none}
.sbxpill ha-icon{--mdc-icon-size:16px;color:var(--fb-amber)}
.board.sbx .node.sbch{outline:2px dashed var(--fb-amber);outline-offset:2px}
.board.sbx .node[data-sbx]::after{content:attr(data-sbx);position:absolute;right:8px;bottom:-9px;font-size:10px;line-height:14px;padding:0 6px;border-radius:7px;background:var(--secondary-background-color);border:1px solid var(--divider-color);color:var(--primary-text-color)}
.board.sbx .node.sbch[data-sbx]::after{background:var(--fb-amber);border-color:var(--fb-amber);color:#000}
.board.sbx .node.sbch::before{content:'';position:absolute;left:-5px;top:-5px;width:9px;height:9px;border-radius:50%;background:var(--fb-amber)}
.board.sbx .node.dim{opacity:.42}
.sbctl .sbf{display:inline-flex;gap:4px;flex:1 1 140px;min-width:0}
.sbctl .sbf select,.sbctl .sbf input{flex:1 1 auto;min-width:0;max-width:100%}
.vtabs{position:absolute;left:12px;right:12px;top:10px;z-index:8;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.vtabs>*{pointer-events:auto}
.vtabs:not([hidden])~.sbxpill{top:58px}
.vtabs .vtrow{display:flex;flex-wrap:wrap;gap:4px;align-self:flex-start;padding:3px;border-radius:12px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 2px 8px rgba(0,0,0,.2)}
.vtabs .vtab{display:inline-flex;align-items:center;gap:4px;border-radius:9px;font-size:12.5px;color:var(--secondary-text-color)}
.vtabs button.vtab,.vtabs .vtab>button:first-child{border:0;background:none;padding:5px 9px;cursor:pointer;color:inherit;display:inline-flex;align-items:center;gap:5px;font-size:12.5px}
.vtabs .vtab .ib{border:0;background:none;padding:3px;cursor:pointer;color:var(--secondary-text-color);display:inline-flex}
.vtabs .vtab ha-icon{--mdc-icon-size:15px}
.vtabs .vtab.on{background:color-mix(in srgb,var(--primary-color) 16%,transparent);color:var(--primary-text-color);font-weight:500}
.vtabs .vdot{width:8px;height:8px;border-radius:50%;background:var(--success-color,#43a047)}
.vtabs .vact{font-size:10.5px;padding:0 6px;border-radius:7px;background:var(--success-color,#43a047);color:#fff;font-weight:600}
.vtabs .vban{align-self:flex-start;max-width:min(860px,100%);display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:7px 12px;border-radius:10px;background:color-mix(in srgb,var(--card-background-color) 85%,var(--primary-color));border:1px solid var(--primary-color);font-size:12.5px}
.vtabs .vban button{border:1px solid var(--divider-color);background:var(--card-background-color);border-radius:8px;padding:4px 9px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--primary-text-color)}
.vtabs .vban ha-icon{--mdc-icon-size:16px}
.board.vview .vp{background-image:repeating-linear-gradient(-45deg,color-mix(in srgb,var(--primary-color) 5%,transparent) 0 14px,transparent 14px 28px)}
.node .vdtag{position:absolute;left:10px;top:-9px;font-size:10px;line-height:14px;padding:0 6px;border-radius:7px;z-index:2;white-space:nowrap}
.node.vd-chg{outline:2px dashed var(--primary-color);outline-offset:2px}.node.vd-chg .vdtag{background:var(--primary-color);color:#fff}
.node.vd-only{outline:2px dashed var(--fb-red);outline-offset:2px}.node.vd-only .vdtag{background:var(--fb-red);color:#fff}
.vers{display:flex;flex-direction:column;min-height:0;flex:1;overflow:auto}
.vers .vnote{padding:10px 14px;font-size:12.5px;color:var(--secondary-text-color);border-bottom:1px solid var(--divider-color)}
.vers .vact{padding:10px 14px}
.vers .vact button{display:inline-flex;align-items:center;gap:6px}
.vers .vrow{padding:10px 14px;border-top:1px solid var(--divider-color);font-size:13px}
.vers .vrow.on{box-shadow:inset 3px 0 0 var(--success-color,#43a047)}
.vers .vrow.view{background:color-mix(in srgb,var(--primary-color) 8%,transparent)}
.vers .vh{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.vers .vbadge{font-size:10.5px;padding:0 6px;border-radius:7px;background:var(--success-color,#43a047);color:#fff;font-weight:600}
.vers .vauto{font-size:10.5px;padding:0 6px;border-radius:7px;border:1px solid var(--divider-color);color:var(--secondary-text-color)}
.vers .vdesc{margin-top:3px;white-space:pre-wrap}
.vers .vm{margin-top:2px;font-size:11.5px;color:var(--secondary-text-color)}
.vers .vb{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.vers .vb button{border:1px solid var(--divider-color);background:none;border-radius:8px;padding:4px 9px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--primary-text-color)}
.vers .vb button.ib{padding:4px 6px}
.vers .vb button:disabled{opacity:.45;cursor:default}
.vers .vb ha-icon{--mdc-icon-size:15px}
.vrdlg .vplan{margin:6px 0 10px;padding-left:18px;font-size:13px}.vrdlg .vplan li{margin:3px 0}
.vrdlg .vdevrow{margin:8px 0;display:flex;flex-direction:column;gap:4px;font-size:13px}
.vrdlg .vdevpick select{width:100%}
.board.sbx .edges path.dim,.board.sbx .edges path.chev.dim{opacity:.22}
.flowx{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.flowx path.fx{fill:none;stroke:var(--fb-amber);stroke-width:2;stroke-dasharray:6 4}
.flowx path.fx.cur{stroke-width:2.8}
.flowx path.fx.cond{stroke-dasharray:3 4}
.flowx g.cres circle,.edges g.cres.sbxc circle{fill:var(--card-background-color);stroke-width:2}
.flowx g.cres path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.flowx g.cres.ok circle,.flowx g.cres.ok path{stroke:var(--success-color,#43a047)}.flowx g.cres.bad circle,.flowx g.cres.bad path{stroke:var(--fb-red)}
.flowx g.cres{pointer-events:all}
circle.fdot{fill:var(--fb-blue);stroke:var(--card-background-color);stroke-width:2}
.flow{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.flow .ghost{position:absolute;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:12px;border:2px dashed var(--fb-amber);background:color-mix(in srgb,var(--card-background-color) 88%,var(--fb-amber));color:var(--primary-text-color);pointer-events:auto;cursor:pointer;transition:opacity .2s}
.flow .ghost.far{opacity:.35}
.flow .ghost.now{box-shadow:0 0 0 3px var(--fb-blue)}
.flow .ghost ha-icon{--mdc-icon-size:18px;color:var(--fb-amber);flex:none}
.flow .ghost .gt{display:flex;flex-direction:column;min-width:0;line-height:1.2}
.flow .ghost .gt b{font-weight:500;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flow .ghost .gt small{font-size:10.5px;color:var(--secondary-text-color)}
.flow .ghost.pulse{animation:pulse 1.8s ease-out}
.flow .fnum{position:absolute;transform:translate(-50%,-50%);min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:var(--secondary-background-color,#eee);border:1.5px solid var(--fb-blue);color:var(--primary-text-color);font-size:11px;font-weight:700;line-height:17px;text-align:center;white-space:nowrap;pointer-events:auto;cursor:pointer;z-index:2}
.flow .fnum.cur{background:var(--fb-blue);color:#fff}
.flow .fwait{position:absolute;transform:translate(-100%,-50%);display:flex;align-items:center;gap:3px;height:20px;padding:0 7px;border-radius:10px;background:var(--fb-amber);color:#000;font-size:11px;font-weight:600;white-space:nowrap;pointer-events:auto;z-index:2}
.flow .fwait ha-icon{--mdc-icon-size:13px}
.litbar.flowbar{flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:6px}
.litbar.flowbar .fhead{display:flex;align-items:center;gap:6px;min-width:0}
.litbar.flowbar .fhead .fcur{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.litbar.flowbar .fhead .fpos{color:var(--secondary-text-color);white-space:nowrap}
.litbar.flowbar .fhead button{padding:4px 8px;display:inline-flex;align-items:center}
.litbar.flowbar .fsteps{display:flex;flex-wrap:nowrap;align-items:center;gap:2px;overflow-x:auto;padding-bottom:3px}
.litbar.flowbar .fsteps .larr{flex:none}
.litbar button.fstep{flex:none;white-space:nowrap;border:0;padding:2px 6px;border-radius:7px;background:none;font-size:12px;color:var(--secondary-text-color);display:inline-flex;align-items:center;gap:5px}
.litbar button.fstep.on{color:var(--primary-text-color)}
.litbar button.fstep.cur{background:color-mix(in srgb,var(--fb-blue) 18%,transparent);font-weight:500}
.litbar .lbtns button ha-icon{--mdc-icon-size:16px}
.litbar .lbtns button:disabled{opacity:.4;cursor:default}
i.fsn{font-style:normal;display:inline-block;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--fb-blue);color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
.dbrow .rt i.fsn{margin-right:4px}
.dbrow.fin{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--fb-blue) 55%,transparent)}
.sbclock{font-variant-numeric:tabular-nums;font-size:12.5px;margin-right:4px;padding:2px 8px;border-radius:8px;background:var(--secondary-background-color);white-space:nowrap}
.sbnote{padding:8px 10px;font-size:12px;color:var(--secondary-text-color);border-bottom:1px solid var(--divider-color)}
.sbctl{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--divider-color)}
.sbrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sbl{width:44px;font-size:12px;color:var(--secondary-text-color)}
.sbrow select,.sbrow input:not([type=checkbox]){font:inherit;font-size:12.5px;padding:4px 8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);min-width:0}
.sbrow .sbent,.sbrow .sbrun{flex:1 1 170px}.sbrow .sbtrig{flex:1 1 150px}.sbrow .sbtop{flex:1 1 160px}.sbrow .sbpay{flex:1 1 140px}.sbrow .sbval{flex:0 1 130px}.sbrow .sbev{flex:1 1 140px}.sbrow .sbevd{flex:2 1 170px}
.sbrow .chip:disabled{opacity:.5;cursor:default}
.sbcb{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--secondary-text-color)}
.sbdue{display:flex;flex-wrap:wrap;gap:4px 10px;padding:6px 10px;font-size:11.5px;border-bottom:1px solid var(--divider-color)}.sbdue:empty{display:none}
.sbask:empty{display:none}
.sbq{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;background:color-mix(in srgb,var(--fb-amber) 14%,transparent);border-bottom:1px solid var(--divider-color);font-size:12.5px}
.sbq ha-icon{--mdc-icon-size:18px;color:var(--fb-amber)}.sbq span{flex:1 1 200px}
.sbq input{font:inherit;font-size:12.5px;padding:4px 8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
.dbrow .dm .sbpart{color:var(--fb-amber)}
.nbsbx{font-size:11.5px;color:var(--fb-amber);padding:0 6px;white-space:nowrap}
.node.watching{box-shadow:0 0 0 2px color-mix(in srgb,var(--fb-blue) 55%,transparent)}
.node.watching::after{content:attr(data-watch);position:absolute;right:8px;top:-9px;font-size:10px;line-height:14px;padding:0 6px;border-radius:7px;background:var(--fb-blue);color:#fff;letter-spacing:.02em}
.node.wpulse{animation:pulse 1.4s ease-out}
.node.now{box-shadow:0 0 0 3px var(--fb-blue)}
.node.tool{border-style:dashed}
.node.t-inj{gap:8px;padding:6px 10px 6px 6px}
.node.t-inj .tplay{flex:none;width:34px;height:34px;border-radius:50%;border:0;background:var(--primary-color);color:var(--text-primary-color,#fff);cursor:pointer;display:flex;align-items:center;justify-content:center}
.node.t-inj .tplay ha-icon{--mdc-icon-size:20px}
.node.t-mon{flex-direction:column;align-items:stretch;gap:4px;padding:8px 10px}
.node.t-mon .mhead{display:flex;align-items:center;gap:6px;min-width:0}
.node.t-mon .mhead ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color);flex:none}
.node.t-mon .mhead .name{flex:1;min-width:0;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node.t-mon .mcnt{font-size:11px;color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.node.t-mon .mlist{flex:1;overflow:hidden;display:flex;flex-direction:column;gap:1px;font-size:11px}
.mrow{display:flex;gap:6px;white-space:nowrap;overflow:hidden}
.mrow .mt{color:var(--secondary-text-color);flex:none;font-variant-numeric:tabular-nums}
.mrow .mv{overflow:hidden;text-overflow:ellipsis;font-family:var(--ha-font-family-code,monospace)}
.mrow.err .mv{color:var(--fb-red)}.mrow.muted{color:var(--secondary-text-color)}
.nodebar .nbsep{width:1px;align-self:stretch;margin:2px 2px;background:var(--divider-color)}
.nodebar button[disabled]{opacity:.45;cursor:default}
.ttip{position:absolute;z-index:22;max-width:min(420px,80%);padding:8px 10px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 6px 18px rgba(0,0,0,.3);font-size:12px;pointer-events:none}
.ttip .tth{color:var(--secondary-text-color);margin-bottom:4px}
.ttip .ttt{margin-top:4px}
.ttip code{display:block;font-family:var(--ha-font-family-code,monospace);font-size:11px;white-space:pre-wrap;word-break:break-word;color:var(--secondary-text-color)}
.ttip .ttv{font-weight:500;margin-top:2px;word-break:break-word}
.litbar{position:absolute;left:12px;right:12px;bottom:12px;z-index:9;display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;padding:8px 12px;border-radius:12px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:12.5px}
.litbar .lsteps{flex:1;min-width:200px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}
.litbar .lstep{color:var(--secondary-text-color)}.litbar .lstep.on{color:var(--primary-text-color);font-weight:500}
.litbar .larr{color:var(--secondary-text-color)}
.litbar .lbtns{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.litbar .lrun{margin-right:6px}
.litbar button{padding:5px 10px;border-radius:8px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:12.5px}
.dhead .rec{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--secondary-text-color);margin-right:auto}
.dhead .rec i{width:8px;height:8px;border-radius:50%;background:var(--secondary-text-color)}
.dhead .rec.on i{background:var(--fb-red);animation:blink 1.6s ease-in-out infinite}
@keyframes blink{50%{opacity:.35}}
.dbg{flex:1;display:flex;flex-direction:column;min-height:0}
.dflt{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--divider-color)}
.dflt .chip{padding:3px 9px;font-size:12px}
.dwhy{padding:8px 10px;border-bottom:1px solid var(--divider-color);background:var(--secondary-background-color);max-height:40%;overflow:auto}
.dwhy .wh{font-size:13px;margin-bottom:4px}
.dwhy .wwarn{color:var(--fb-amber);font-size:12.5px;margin-bottom:4px}
.dtl{flex:1;overflow:auto}
.dbrow,.wrow{display:grid;grid-template-columns:76px 18px 1fr;gap:8px;align-items:start;width:100%;text-align:left;padding:6px 10px;border:0;border-bottom:1px solid var(--divider-color);background:none;cursor:pointer;font-size:12.5px;color:var(--primary-text-color)}
.wrow{grid-template-columns:110px 1fr;border-bottom:0;padding:4px 0;background:none}
.dbrow:hover,.wrow:hover{background:color-mix(in srgb,var(--primary-text-color) 6%,transparent)}
.dbrow.on{background:color-mix(in srgb,var(--primary-color) 14%,transparent)}
.dbrow ha-icon{--mdc-icon-size:16px;color:var(--secondary-text-color);margin-top:1px}
.dbrow .rt,.wrow .rt{color:var(--secondary-text-color);font-variant-numeric:tabular-nums;font-size:11.5px;margin-top:1px}
.dbrow .dm,.wrow .dm{display:flex;flex-direction:column;min-width:0}
.dbrow .dm b,.wrow .dm b{font-weight:500;overflow:hidden;text-overflow:ellipsis}
.dbrow .dm span,.wrow .dm span{color:var(--secondary-text-color);font-size:11.5px}
.dbrow.note{grid-template-columns:76px 1fr;cursor:default;color:var(--secondary-text-color);font-style:italic}
.dbrow.red .dm b,.wrow.red .dm b{color:var(--fb-red)}.dbrow.muted .dm b,.wrow.muted .dm b{color:var(--secondary-text-color)}
.dbrow.amber .dm b,.wrow.amber .dm b{color:var(--fb-amber)}.dbrow.blue .dm b{color:var(--fb-blue)}
.dbrow.k-test ha-icon,.dbrow.k-watch ha-icon{color:var(--fb-blue)}
.runs .run.on{background:color-mix(in srgb,var(--primary-color) 14%,transparent)}
.runs .msg .rn span{white-space:normal}
.runs .msg .mb{font-size:11.5px}
.dlg .tchoice{display:flex;gap:6px;flex-wrap:wrap}
.dlg .tone{font-size:14px}
.dlg .tfields{display:flex;flex-direction:column;gap:10px}
.dlg .fh{font-size:11.5px;color:var(--secondary-text-color)}
.dlg textarea{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--ha-font-family-code,monospace);font-size:13px;resize:vertical}
.warnbox{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.5;padding:8px 10px;border-radius:10px;border:1px solid var(--fb-amber);background:color-mix(in srgb,var(--fb-amber) 10%,transparent)}
.warnbox ha-icon{--mdc-icon-size:18px;color:var(--fb-amber);flex:none}
@media (prefers-reduced-motion:reduce){.dhead .rec.on i,.node.pulse,.node.wpulse,.edges path.live{animation:none}}
/* v0.5: the arrow editor (7.5) */
.links{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.links path.ltmp{fill:none;stroke:var(--primary-color);stroke-width:2.2;stroke-dasharray:7 5}
.board.linking .vp,.board.linking .node{cursor:crosshair}
.lh{position:absolute;z-index:6;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:var(--primary-color);border:3px solid var(--card-background-color);box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:crosshair;touch-action:none}
.edgebar{position:absolute;z-index:8;display:flex;align-items:center;gap:2px;flex-wrap:wrap;max-width:min(520px,90%);padding:4px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 4px 14px rgba(0,0,0,.3)}
.edgebar .ebtxt{font-size:12.5px;padding:0 8px;max-width:280px}
.edgebar button{display:flex;align-items:center;gap:4px;padding:5px 8px;border:0;border-radius:8px;background:none;cursor:pointer;font-size:12px}
.edgebar button:hover{background:var(--secondary-background-color)}
.edgebar button[disabled]{opacity:.45;cursor:default}
.edgebar ha-icon{--mdc-icon-size:18px}
.edges path.esel{stroke:var(--primary-color);stroke-width:3.2}
.adlg .arefs{display:flex;flex-direction:column;gap:6px;max-height:42vh;overflow:auto}
.dlg label.aref{flex-direction:row;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid var(--divider-color);border-radius:10px;font-size:13px;color:var(--primary-text-color);cursor:pointer}
.aref pre,.adlg pre.yprev{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:var(--primary-background-color);font-family:var(--ha-font-family-code,monospace);font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--primary-text-color)}
.adlg pre.yprev{margin:0}
.adlg .aval b{color:var(--fb-red)}
/* v0.5: Node-RED flows (2.7) */
.node.nodered{border-style:dashed;border-color:color-mix(in srgb,#8f0000 60%,var(--divider-color))}
.node.nodered .ic{color:color-mix(in srgb,#c33 70%,var(--secondary-text-color))}
.lgerr{font-size:11.5px;color:var(--fb-amber);margin:2px 0 0 22px}
.lgbtn{font:inherit;font-size:11.5px;color:var(--primary-color);background:none;border:1px solid var(--primary-color);border-radius:6px;padding:1px 7px;margin-left:4px;cursor:pointer}
/* v0.5: keyboard (4.8) */
.node:focus{outline:none}
.node:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}
button:focus-visible,.chip:focus-visible,.mi:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
/* v0.3: modes, welcome, about, hint, no-admin */
.board.m-panel{height:100vh;height:100dvh}
.board.m-card{height:75vh;min-height:520px;border-radius:var(--ha-card-border-radius,12px);border:1px solid var(--divider-color)}
.hamenu{display:none!important}
.board.m-panel.narrow .hamenu{display:inline-flex!important}
.empty.wel{pointer-events:auto;overflow:auto}
.welcome{max-width:560px;text-align:left;color:var(--primary-text-color);line-height:1.5;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:16px;padding:24px 28px}
.welcome>ha-icon{--mdc-icon-size:36px;color:var(--secondary-text-color)}
.welcome h2{margin:8px 0;font-size:20px;font-weight:500}
.welcome p,.welcome ol{font-size:14px;margin:8px 0}
.welcome ol{padding-left:20px}.welcome li{margin:6px 0}
.wbtns{display:flex;gap:8px;margin:16px 0 8px}
.wbtns button{padding:9px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:14px}
.wbtns button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.welcome .safe{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--secondary-text-color)}
.welcome .safe ha-icon{--mdc-icon-size:18px;flex:none}
.ver{display:flex;align-items:center;justify-content:space-between;gap:6px}
.ver .ib{padding:2px}.ver ha-icon{--mdc-icon-size:16px;color:var(--secondary-text-color)}
.dlg.about{width:min(560px,94%);overflow:auto}
.dlg.about h3 .muted{font-size:13px;font-weight:400}
.dlg.about h4{margin:6px 0 0;font-size:13px;font-weight:500;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.05em}
.dlg.about ul{margin:0;padding-left:18px;font-size:13.5px;line-height:1.5}.dlg.about p{margin:0;font-size:13.5px;line-height:1.5}
.lnk{margin-right:auto;font-size:13px;color:var(--primary-color)}
.cardhint{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:90%;padding:6px 6px 6px 12px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);font-size:12.5px;color:var(--secondary-text-color);z-index:4}
.cardhint ha-icon{--mdc-icon-size:18px;flex:none}
.cardhint button{border:0;background:none;cursor:pointer;font-size:16px;color:var(--secondary-text-color);padding:2px 6px}
.noadmin{margin:auto;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;max-width:460px;padding:24px;color:var(--secondary-text-color);font-size:14px;line-height:1.5}
.noadmin b{color:var(--primary-text-color);font-size:16px;font-weight:500}
.noadmin ha-icon{--mdc-icon-size:40px}
/* toolbar follows the board's own width (HA's sidebar, dashboard columns), not the window */
@container (max-width:1120px){.tools button.sec span{display:none}.tools button.sec{padding:6px 7px}}
@container (max-width:880px){.tools button span{display:none}.tools button{padding:6px 7px}}
.scrim{display:none}
.board.compact .list{position:absolute;z-index:8;top:0;bottom:0;left:0;width:min(300px,86%);box-shadow:6px 0 18px rgba(0,0,0,.3)}
.board.compact:not(.nolist)>.scrim{display:block;position:absolute;inset:0;z-index:7;background:rgba(0,0,0,.35)}
.board.compact .drawer{width:100%}
.board.compact .legend{max-width:240px}
.board.firstrun .legend,.board.firstrun .zoom{display:none}`;

  /* ---------- the words, in English (4.9) ---------- */
  // A translation is one more table here, e.g. STR.de, with the same ids; ids it leaves out stay English.
  // Most texts go into the page's HTML: write &amp; for & and &lt; for <, keep " out of texts used as tooltips,
  // and keep the {placeholders}. A count's text has one entry per plural form the language has (one, few, other...).
  const STR = {
    en: {
      toggle: 'Toggle',
      number: 'Number',
      text: 'Text',
      dropdown: 'Dropdown',
      date_and_time: 'Date and time',
      button: 'Button',
      counter: 'Counter',
      timer: 'Timer',
      schedule: 'Schedule',
      automation: 'Automation',
      script: 'Script',
      date_time: 'Date/time',
      sensor: 'Sensor',
      binary_sensor: 'Binary sensor',
      switch: 'Switch',
      light: 'Light',
      fan: 'Fan',
      cover: 'Cover',
      lock: 'Lock',
      climate: 'Climate',
      media_player: 'Media player',
      select: 'Select',
      event: 'Event',
      vacuum: 'Vacuum',
      water_heater: 'Water heater',
      device: 'Device',
      action: 'Action',
      mqtt: 'MQTT',
      person: 'Person',
      scene: 'Scene',
      update: 'Update',
      area: 'Area',
      floor: 'Floor',
      label: 'Label',
      weather: 'Weather',
      sun: 'Sun',
      zone: 'Zone',
      notify: 'Notify',
      tracker: 'Tracker',
      time_trigger: 'Time trigger',
      sun_trigger: 'Sun trigger',
      runs_when_home_assistant_starts: 'Runs when Home Assistant starts',
      webhook_trigger: 'Webhook trigger',
      tag_trigger: 'Tag trigger',
      voice_trigger: 'Voice trigger',
      calendar_trigger: 'Calendar trigger',
      triggers_3: '{a} triggers {b}',
      is_checked_by_2: '{a} is checked by {b}',
      changes_3: '{a} changes {b}',
      runs_4: '{a} runs {b}',
      is_read_by_2: '{a} is read by {b}',
      frame: 'Frame',
      never: 'never',
      just_now: 'just now',
      min_ago: '{round} min ago',
      h_ago: '{round} h ago',
      d_ago: '{round} d ago',
      running_2: 'Running',
      error_2: 'Error{extra}',
      finished: 'Finished',
      conditions_not_met: 'Conditions not met',
      skipped_already_running: 'Skipped (already running)',
      skipped_max_runs: 'Skipped (max runs)',
      cancelled: 'Cancelled',
      aborted: 'Aborted',
      timed_out: 'Timed out',
      wait_timed_out: 'Wait timed out',
      can_t_read_use_key: 'can\'t read "{line}": use key: value, or JSON for nested data',
      a_condition: 'a condition',
      template_2: 'template {c}',
      or: ' or ',
      is: '{ent} is {state}',
      above: 'above {above}',
      below: 'below {below}',
      template: 'template {value_template}',
      after: 'after {after}',
      time_2: 'time {list}',
      before: 'before {before}',
      on_2: 'on {weekday}',
      n_conditions: { one: '{n} condition', other: '{n} conditions' },
      trigger_saw_a_change_but: 'trigger {n} saw a change but didn\'t fire{extra}',
      a_condition_was_not_met: 'a condition was not met',
      needs: ', needs {wanted_state}',
      it_was: ' (it was {state}{extra})',
      condition_wasn_t_met: 'condition {n} wasn\'t met: {condText}{extra}',
      error: 'error: {error}',
      failed_4: '{bad} failed: {error}',
      trigger: 'Trigger',
      condition_2: 'Condition',
      step: 'Step',
      part: 'Part',
      flow: 'Flow',
      node_red_flow: 'Node-RED flow',
      tests_need_full_manager_switch: 'Tests need Full manager: switch it on in the Functions Board integration\'s options',
      tests_change_your_home_assistant: 'Tests change your Home Assistant for real: whatever reacts to the change runs, and a test can\'t be undone. Each test is written to the logbook.',
      all: 'All',
      changes: 'Changes',
      runs: 'Runs',
      calls: 'Calls',
      tests: 'Tests',
      the_functions_board_needs_an: 'The Functions board needs an administrator account',
      it_reads_automation_and_script: 'It reads automation and script configs and changes labels and categories, which Home Assistant only lets administrators do.',
      could_not_save_the_layout: 'Could not save the layout: {message}',
      was_rearranged_on_another_board: '{fnName} was rearranged on another board at the same moment; showing that version.',
      the_functions_board_couldn_t: 'The Functions board couldn\'t start',
      undo: 'Undo',
      helper: 'Helper',
      debug_2: 'Debug',
      arrange: 'Auto-arrange',
      keep_in_place: 'Keep in place',
      unpin: 'Let Auto-arrange move it',
      kept_in_place_auto_arrange: 'Kept in place: Auto-arrange leaves it where it is',
      keep_name_in_place: 'Keep {name} in place',
      let_auto_arrange_move_name: 'Let Auto-arrange move {name}',
      fit_everything: 'Fit everything',
      home_assistant_menu: 'Home Assistant menu',
      show_or_hide_the_list: 'Show or hide the list of functions',
      function_tools: 'Function tools',
      new_automation_in_this_function: 'New automation in this function',
      new_script_in_this_function: 'New script in this function',
      new_helper_in_this_function: 'New helper in this function',
      bring_automations_scripts_helpers_or: 'Bring automations, scripts, helpers or entities you already have into this function',
      existing: 'Existing',
      redo: 'Redo',
      draw_a_frame_to_group: 'Draw a frame to group part of the system',
      add_a_note: 'Add a note',
      note: 'Note',
      auto_arrange_resets_positions_you: 'Lay this function out automatically, boxes you moved too. Boxes you keep in place (in their bar) stay where they are. Undo puts your own arrangement back.',
      arrows_what_lights_up_around: 'Arrows: what lights up around a selected box, and which arrows show',
      arrows: 'Arrows',
      every_run_of_every_automation: 'Every run of every automation and script in this function, newest first',
      debugger_what_happens_in_this: 'Debugger: what happens in this function, live, what caused each step, and why something did or didn\'t run',
      boxes_arrow_keys_follow_the: 'Boxes: arrow keys follow the arrows, Enter opens, Space shows the actions',
      this_card_works_best_in: 'This card works best in a panel view. For a full page in the sidebar, install the Functions Board integration.',
      dismiss: 'Dismiss',
      drag_onto_another_box_to: 'Drag onto another box to connect them, or click and then click the other box',
      zoom_out: 'Zoom out',
      zoom_in: 'Zoom in',
      reading_configs: 'Reading configs&hellip;',
      moved_your_functions_and_layouts: 'Moved your functions and layouts into the integration; they are now shared between admins',
      there_s_no_function_on_2: 'There\'s no function "{want}" on the board; showing the last one you opened',
      add_to_6: 'Add {id} to {fnName}',
      added_to_5: 'Added to {fnName}: {id}',
      created_but_could_not_label: 'Created, but could not label {id}',
      could_not_read_this_function: 'Could not read this function: {message}',
      there_s_no_function_on: 'There\'s no function "{want}" on the board',
      button_3: 'Button: {title}',
      unknown_device: 'Unknown device',
      button_2: 'Button {key}',
      tests_and_monitors: 'Tests and monitors',
      node_red_flows: 'Node-RED flows',
      related_2: 'Related',
      outside_items: 'Outside items',
      automations: 'Automations',
      scripts: 'Scripts',
      helpers: 'Helpers',
      devices: 'Devices',
      other: 'Other',
      with_no_arrows: '{kind} with no arrows',
      changed_by_automations_or_scripts: 'Changed by {writers} automations or scripts',
      no_automation_or_script_runs: 'No automation or script runs this',
      it_may_be_used_by: '{extra}. It may be used by a dashboard, a template or another tool.',
      no_automation_or_script_refers: 'No automation or script refers to this',
      n_hidden: { one: '{n} hidden', other: '{n} hidden' },
      its_arrows_are_hidden_by: 'Its arrows are hidden by the Arrows menu',
      double_click_to_rename: 'Double-click to rename',
      delete_frame_keeps_what_is: 'Delete frame (keeps what is in it)',
      delete_note: 'Delete note',
      write_a_note: 'Write a note...',
      test_button: 'Test button',
      test_button_full_manager_only: 'Test button · Full manager only',
      monitor: 'Monitor',
      n_nodes: { one: '{n} node', other: '{n} nodes' },
      node_red_3: 'Node-RED · {tabLabel} · {count}',
      device_2: 'Device{extra}',
      action_2: 'Action · {split}',
      notification_button_action: 'Notification button{extra} · action {key}',
      n_entities: { one: '{n} entity', other: '{n} entities' },
      target: '{type} target · {count}{n}',
      mqtt_topic: 'MQTT topic',
      not_found: '{tn} · not found',
      unavailable_2: '{tn} · unavailable',
      on: 'On',
      ran_3: '{n} · ran {last_triggered}',
      off: 'Off',
      running_3: ' · running',
      ran_2: '{extra} · ran {last_triggered}',
      idle: 'Idle',
      related: 'Related · {text}',
      simulated_2: ' · simulated',
      related_not_in_this_function_3: '\nRelated, not in this function. Select it to add it.',
      outside_this_function_2: '\nOutside this function',
      related_not_in_this_function_2: '. Related, not in this function',
      outside_this_function: '. Outside this function',
      tests_2: '{name} tests {name2}',
      lists: '{name} lists {name2}',
      through_the: ' · through the {domain} {name}',
      part_of_a_loop_this: ' — part of a loop: this can retrigger itself',
      chain: 'Chain',
      what_sets_it_off_and: 'What sets it off and what it sets off, plus whatever sets what it checks',
      upstream: 'Upstream',
      only_what_leads_to_it: 'Only what leads to it',
      downstream: 'Downstream',
      only_what_it_leads_to: 'Only what it leads to',
      both_ways: 'Both ways',
      upstream_and_downstream: 'Upstream and downstream',
      only_the_selected_box: 'Only the selected box',
      n_arrows_away: { one: '{n} arrow away', other: '{n} arrows away' },
      key_2: '{d} (key {d2})',
      all_the_way_key_0: 'All the way (key 0)',
      triggers_2: 'Triggers',
      show_in_this_function: 'Show in this function',
      highlight_around_a_selected_box: 'Highlight around a selected box',
      reach: 'Reach',
      live: 'Live',
      one_line_that_branches_dot: 'a shared line: a dot where an arrow branches off; point at a box, or select it, to trace its arrows',
      runs_back: 'an arrow running back, right to left',
      crosses_without_meeting: 'crosses another without meeting it',
      arrow_style: 'Style',
      curved_arrows: 'Curved arrows',
      curved_arrows_take_the_shortest: 'Curved arrows take the shortest way between boxes; otherwise arrows run in square-cornered lanes, left to right',
      a_tick_or_a_cross: 'A tick or a cross on each check arrow: whether that condition passes right now',
      whether_each_check_passes_now: 'Whether each check passes now',
      checked_by: 'Checked by',
      read_by_helper_inputs: 'Read by (helper inputs)',
      runs_script_calls: 'Runs (script calls)',
      related_suggestions: 'Related suggestions',
      run_2: 'Run',
      edit_2: 'Edit',
      remove: 'Remove',
      clear: 'Clear',
      open_in_node_red: 'Open in Node-RED',
      details: 'Details',
      set_up_in_yaml_without_a: 'Set up in YAML without a unique ID: change it in its YAML file',
      traces_2: 'Traces',
      turn_off: 'Turn off',
      turn_on: 'Turn on',
      add_to_function: 'Add to function',
      delete_3: 'Delete',
      test_2: 'Test',
      stop_watching: 'Stop watching',
      watch_triggers: 'Watch triggers',
      messages: 'Messages',
      connect: 'Connect',
      drawing_arrows_needs_full_manager: 'Drawing arrows needs Full manager: switch it on in the Functions Board integration\'s options',
      import_2: 'Import',
      new_function_2: 'New function',
      a_function_is_a_home_2: 'A function is a Home Assistant label. Full manager is on, so besides labels, categories and Pause the board can delete functions and items when you ask; it always shows what will change first, and Undo takes it back.',
      welcome_to_functions: 'Welcome to Functions',
      a_function_is_everything_that: 'A function is everything that makes one job work: its automations, scripts, helpers and devices, on one board and wired together from their own configs.',
      finds_the_functions_already_in: 'finds the functions already in your setup: automations, scripts and helpers that trigger, change or call each other, plus your categories and labels.',
      or_start_a: 'Or start a',
      new_function_3: 'new function',
      and_build_it_with_home: 'and build it with Home Assistant\'s own editors.',
      open_a_function_to_see: 'Open a function to see what drives what. Click a box to light up its chain; double-click it to edit.',
      import_from_my_setup: 'Import from my setup',
      a_function_is_a_home: 'A function is a Home Assistant label; the board adds and removes labels and categories, and Pause turns a function\'s automations off until you resume them. It doesn\'t edit or delete your automations, scripts or helpers.',
      nothing_in_this_function_yet: 'Nothing in this function yet',
      add_pieces_with_automation_script: 'Add pieces with Automation, Script, Helper or Existing above.',
      n_devices: { one: '{n} device', other: '{n} devices' },
      something_in_this_function_is: 'Something in this function is unavailable',
      edit_hide_or_delete: 'Edit, hide or delete {name}',
      functions: 'Functions',
      no_functions_yet_press_import: 'No functions yet. Press Import to find the ones already in your setup.',
      import_find_the_functions_already: 'Import: find the functions already in your setup, or add labels and items',
      new_empty_function: 'New empty function',
      find_an_automation_helper_device: 'Find an automation, helper, device…',
      find_anything: 'Find anything',
      import_manager: 'Import manager',
      functions_board_v_prototype: 'Functions board v{version} · prototype',
      about_and_what_the_board: 'About, and what the board changes',
      nothing_matches: 'Nothing matches.',
      open_it_on_its_board: 'Open it on its board',
      in_no_function_yet: 'In no function yet',
      add_to_3: 'Add to…',
      in_no_function: 'in no function',
      add_to_2: 'Add to',
      could_not_add_2: 'Could not add: {why}',
      added_to_4: 'Added to {fnName}',
      edit_name_icon_colour_and: 'Edit name, icon, colour and description',
      hide_or_delete_this_function: 'Hide or delete this function',
      resume_2: 'Resume',
      pause: 'Pause',
      n_automations: { one: '{n} automation', other: '{n} automations' },
      turn_back_on_the_that: 'Turn back on the {count} that were on when you paused',
      turn_the_in_this_function: 'Turn the {total} in this function back on',
      turn_off_the_that_are: 'Turn off the {on} that are on now and stop their runs; Resume turns only those back on',
      turn_on_2: 'Turn on {count}?',
      resume: 'Resume {name}',
      resumed_back_on: 'Resumed: {count} back on',
      failed_3: 'Failed: {message}',
      turn_off_and_stop_runs: 'Turn off {count} and stop runs?',
      pause_2: 'Pause {name}',
      paused_off_until_you_resume: 'Paused: {count} off until you resume',
      turn_on_all: 'Turn on all {total}?',
      turned_on: 'Turned on {total}',
      hide_key: 'Hide key',
      key: 'Key',
      triggers: 'triggers',
      changes_2: 'changes',
      running: 'running',
      is_checked_or_read_by: 'is checked or read by',
      runs_script_call: 'runs (script call)',
      is_read_by_a_helper: 'is read by (a helper\'s inputs)',
      loop_can_retrigger_itself: 'loop: can retrigger itself',
      a_test_button_or_a: 'a test button or a monitor',
      related_not_in_this_function: 'related, not in this function',
      outside_item_it_touches: 'outside item it touches',
      unavailable: 'unavailable &nbsp;',
      last_run_failed: 'last run failed &nbsp;',
      a_check_passes_or_fails: 'a check passes or fails right now',
      simulated_state: 'simulated state',
      show_outside_items: 'Show outside items',
      show_related_suggestions: 'Show related suggestions',
      reads_your_node_red_app: 'Reads your Node-RED app\'s flows in your browser, through the Node-RED page Home Assistant opens for you, to draw what they trigger on, read and change. The flows last read are kept by the integration, so every board shows them until the next read.',
      node_red_flows_as_of: 'Node-RED flows as of {when}. Open Node-RED to read them again.',
      open_node_red_once_so_the: 'Open Node-RED once, so the board can read its flows.',
      open_node_red: 'Open Node-RED',
      sbx_changed_key: 'changed in the sandbox',
      sbx_running: 'running in the sandbox',
      sbx_ran_n: { one: 'ran once in the sandbox', other: 'ran {n} times in the sandbox' },
      sbx_not_run: 'not run in the sandbox yet',
      sbx_not_followed: 'Triggers the sandbox doesn\'t follow (use Run, with that trigger): {list}.',
      sbx_run_as: 'Run by you, as if trigger {n} ({p}) fired',
      sbx_as_if: 'As if this trigger fired',
      sbx_as_trigger: 'as if {n}. {what}',
      sbx_no_trigger: 'with no trigger',
      sbx_topic: 'topic',
      sbx_payload: 'payload',
      sbx_send: 'Send',
      sbx_pick_topic: 'Type an MQTT topic.',
      sbx_msg: 'sends a message: nothing in your states changes',
      auto_arrange_now: 'Auto-arrange',
      flow_left_to_right: 'Flow left to right',
      flow_top_to_bottom: 'Flow top to bottom',
      flow_switch_t: 'Lays the whole function out again in that direction. Boxes kept in place are let go.',
      flow_switched: 'Laid out again in the new direction.',
      flow_switched_kept: { one: 'Laid out again in the new direction; the box kept in place was let go.', other: 'Laid out again in the new direction; the {n} boxes kept in place were let go.' },
      sbxi_title: 'Sandbox: a rehearsal, not your home',
      sbxi_why: 'The sandbox lets you try this function without touching anything real. Change a state, fire an event, send an MQTT message, run an automation, or move the clock forward, and watch what the function would do: what triggers, which conditions pass and why, what each action would change, and what that sets off next. Use it to check a change before you rely on it, to see why something didn\'t happen, or to walk through a chain that takes hours in real life.',
      sbxi_safe: 'Nothing here reaches your home. The sandbox reads your states once when it opens and asks Home Assistant to render templates, which only reads. It never calls a service, fires an event, publishes to MQTT or sets a state: no device moves and no notification is sent.',
      sbxi_limits_h: 'What it can\'t show you',
      sbxi_l_board: '<b>Only the automations and scripts on this board run.</b> Anything else that would react to the same change, such as automations in other functions, blueprints, Node-RED flows, alerts or an integration\'s own logic, doesn\'t run here, so a chain that leaves this function stops at its edge.',
      sbxi_l_devices: '<b>Devices don\'t answer.</b> A light turned on is simply on. There are no delays, failures, unavailable devices or values that change by themselves: a temperature stays where it is until you set it.',
      sbxi_l_calls: '<b>Some calls change nothing here.</b> Notifications, TTS and log messages are listed as messages. Scenes, device actions and services the sandbox doesn\'t know are listed as calls it would make, without their effect.',
      sbxi_l_triggers: '<b>Some triggers can\'t be followed:</b> zone, sun, Home Assistant starting, webhooks, device triggers, calendars and others. They\'re named when it opens. Use Run, as if that trigger fired, instead.',
      sbxi_l_ask: '<b>Some answers come from you.</b> Sun, zone and device conditions, and templates Home Assistant can\'t render, are asked in the drawer. The result is only as good as your answer.',
      sbxi_l_tpl: '<b>Templates are rendered by Home Assistant</b> from the sandbox\'s states and clock. Ones that read locations (closest, distance) read your real home, and are marked partly real.',
      sbxi_l_nodered: '<b>Node-RED flows don\'t run.</b> Their boxes show what they use, but what a flow would do isn\'t simulated.',
      sbxi_l_copy: '<b>It\'s a copy from the moment it opens.</b> Changes in your home after that aren\'t picked up. Start over to take a fresh copy.',
      sbxi_l_time: '<b>Time only moves when you move it.</b> Everything else happens at once, so races between automations that depend on real timing won\'t show.',
      sbxi_bottom: 'A sandbox run shows what your configuration says should happen. It doesn\'t prove your devices, integrations or the rest of your home will do it.',
      sbxi_go: 'I understand: open the sandbox',
      sbxi_skip: 'Don\'t show this again (the i in the sandbox\'s title bar shows it any time)',
      sbx_about_t: 'What the sandbox is for, and what it can\'t show you',
      sbx_bad_data: 'The event data isn\'t JSON or YAML.',
      sbx_bar_note: 'Sandbox: nothing here changes your home',
      sbx_button: 'Sandbox',
      sbx_button_t: 'Sandbox: try the function on a copy of its states. Nothing is sent to your devices.',
      sbx_by: 'by {name}',
      sbx_by_you: 'by you',
      sbx_check_conds: 'check its conditions',
      sbx_clock: 'Clock',
      sbx_close_t: 'Close the sandbox: the board shows your home again',
      sbx_due: 'Coming up:',
      sbx_empty: 'Set a state, fire an event or run an automation, and watch what the function does. Nothing changes in your home.',
      sbx_entity: 'Entity',
      sbx_event: 'Event',
      sbx_event_data_ph: 'data, e.g. {"entity_id": "timer.hall"}',
      sbx_event_type: 'event type',
      sbx_event_x: 'Event {type}',
      sbx_fire: 'Fire',
      sbx_fire_here: 'Fire in the sandbox',
      sbx_needs_newer: 'reading templates in the sandbox needs a newer Home Assistant (one with the as_function template function)',
      sbx_next: 'Next: {label} in {d}',
      sbx_no_pause: 'Pause changes your real automations. Close the sandbox first.',
      sbx_no_test: 'The sandbox can\'t run that kind of test.',
      sbx_note: 'A copy of this function\'s states, with its own clock. Only the automations and scripts on this board run. Templates are read by Home Assistant from the sandbox\'s states. Nothing is sent to your devices.',
      sbx_nothing_due: 'Nothing due',
      sbx_now_is: 'now {state}',
      sbx_out_cancelled: 'cancelled',
      sbx_out_error: 'error',
      sbx_out_finished: 'finished',
      sbx_out_stopped: 'stopped',
      sbx_partly: 'Partly real: it {what} from your home, not the sandbox.',
      sbx_pick_event: 'Type an event type to fire.',
      sbx_pick_state: 'Pick an entity and type a state.',
      sbx_pill: 'Sandbox: nothing here changes your home',
      sbx_reads_other: 'reads something',
      sbx_reads_places: 'reads locations',
      sbx_reads_states: 'reads all states',
      sbx_reads_translated: 'reads translated states',
      sbx_reset_t: 'Start over from your home\'s current states',
      sbx_run: 'Run',
      sbx_run_b: 'Run',
      sbx_run_here: 'Run in the sandbox',
      sbx_run_what: 'Automation or script to run',
      sbx_set: 'Set',
      sbx_set_b: 'Set',
      sbx_set_here: 'Set in the sandbox',
      sbx_state: 'state',
      sbx_test_here: 'Test in the sandbox',
      sbx_title: 'Sandbox · {fnName}',
      sbx_triggered: '{name} triggered',
      sbx_data_as: '{data} (what {name} looks for)',
      sbx_data_none: 'no data',
      sbx_other: 'Other…',
      sbx_payload_as: '{payload} (what {name} waits for)',
      sbx_payload_none: 'empty payload',
      sbx_state_now: '{state} (now)',
      ver_active: 'active',
      ver_added_delete: 'Delete them',
      ver_added_h: 'Added since this version was saved',
      ver_added_off: 'Turn them off (automations; scripts and helpers stay as they are)',
      ver_added_other: 'Taken out of the function (they lose its label, nothing else changes): {list}',
      ver_auto: 'saved before a restore',
      ver_banner: 'Saved version "{name}" ({when}): not active. Nothing on this tab changes your home, and moving boxes here isn\'t saved.',
      ver_before_name: 'Before restoring "{name}"',
      ver_button: 'Versions',
      ver_button_t: 'Versions: save this function as it is, compare, try a saved version in the sandbox, and restore one',
      ver_changed_t: 'Its config is different now',
      ver_changed_tag: 'changed since',
      ver_checking: 'Comparing it with what\'s there now…',
      ver_current_tab: 'Now',
      ver_del_h: 'Delete "{name}"?',
      ver_del_t: 'Delete this version',
      ver_del_text: 'Only the saved version is deleted. Nothing in Home Assistant changes.',
      ver_desc_ph: 'What\'s different about it (optional)',
      ver_dev_gone: '{name} {model} isn\'t in Home Assistant any more.',
      ver_dev_h: 'Devices that were replaced',
      ver_dev_hint: 'Steps in this version use these devices. Pick what replaced each one, and its steps are pointed at the new device. Left empty, those steps keep the old device and won\'t work until you fix them in the editor.',
      ver_dev_keep: 'Keep the old device',
      ver_dev_pick: 'The device that replaced it',
      ver_diff: 'Changed since: {changed}. Only in this version: {only}. Added since: {added}.',
      ver_edit_h: 'Rename version',
      ver_edit_t: 'Rename or describe',
      ver_gone: 'That version isn\'t there any more',
      ver_is_active: 'This is what\'s there now',
      ver_name_needed: 'Give it a name',
      ver_name_ph: 'e.g. Winter timings',
      ver_needs_integration: 'Versions need the Functions Board integration (they\'re kept by it)',
      ver_new_window: 'Open in a new window, to see it beside what\'s there now',
      ver_none: 'No saved versions yet. Save one to keep this function as it is now.',
      ver_not_saved: 'Not saved: {e}',
      ver_note: 'A version keeps this function as it is: the configs of its automations and scripts, its helpers\' settings, what\'s in it, the devices its steps use, and its layout. Saving one changes nothing in Home Assistant.',
      ver_now: 'What\'s there now',
      ver_now_is: 'the same as "{name}"',
      ver_now_unsaved: 'not saved as a version',
      ver_only_t: 'Not in the function now (taken out or deleted since)',
      ver_only_tag: 'only in this version',
      ver_open: 'Open',
      ver_p_layout: 'The board\'s layout comes back too.',
      ver_p_recreate: { one: '{n} deleted since comes back:', other: '{n} deleted since come back:' },
      ver_p_rejoin: { one: '{n} rejoins the function:', other: '{n} rejoin the function:' },
      ver_p_same: { one: '{n} is the same already:', other: '{n} are the same already:' },
      ver_p_write: { one: '{n} gets its saved config or settings back:', other: '{n} get their saved configs or settings back:' },
      ver_p_yaml: { one: '{n} is defined in YAML and can\'t be restored from here:', other: '{n} are defined in YAML and can\'t be restored from here:' },
      ver_reading: 'Reading the saved versions…',
      ver_promise: 'Versions: saving one reads the function through Home Assistant\'s own APIs and keeps a copy in .storage/functions_board.versions. Saving, opening and trying a version in the sandbox change nothing.',
      ver_promise_full: 'Restoring a version (Full manager) writes its automations\' and scripts\' configs and its helpers\' settings back through Home Assistant\'s own config APIs (automations.yaml and scripts.yaml are rewritten), relabels what it had, and turns off or deletes what was added since, as you choose. It lists every change first, and saves what\'s there before as a version of its own.',
      ver_readonly: 'This is a saved version: switch to the Now tab to change things',
      ver_restore: 'Restore',
      ver_restore_full: 'Restoring rewrites configs: it needs Full manager (in the integration\'s settings)',
      ver_restore_h: 'Restore "{name}"?',
      ver_restore_h0: 'Restore',
      ver_restore_lead: '{fnName} goes back to how it was saved ({when}), through Home Assistant\'s own config APIs, the way its editors save.',
      ver_now_saved_as: 'What\'s there now is already saved as "{name}", so you can go back to it either way.',
      ver_restore_unsaved: 'What\'s there now isn\'t saved as a version: without a backup, you can\'t come back to it.',
      diag_about_h: 'Diagnostics',
      diag_about_p: 'For an issue or a forum post: a file made here, anonymised or with real names, as you choose. Nothing is sent anywhere.',
      diag_always: 'Always: the board\'s settings, layouts, notes and tests, the list of saved versions, and the Node-RED flow summary.',
      diag_anon: 'Anonymised: names, IDs, addresses, keys and free text replaced with stand-ins (the same one wherever a thing appears)',
      diag_btn: 'Diagnostics…',
      diag_choose: 'Choose anonymised or real names first.',
      diag_copied: 'Diagnostics copied',
      diag_copy: 'Copy',
      diag_download: 'Download',
      diag_failed: 'Couldn\'t make the file: {e}',
      diag_h: 'Download diagnostics',
      diag_incl_h: 'What\'s in it',
      diag_lead: 'A file to attach to an issue or a forum post. Nothing is sent anywhere: it\'s made here and saved on this device, and you decide where it goes.',
      diag_making: 'Making the file…',
      diag_names_h: 'Names (choose one)',
      diag_real: 'With real names and IDs, as they are in Home Assistant',
      diag_real_warn: 'Configs can hold addresses, phone names or keys typed into them. Look through the file before you post it anywhere public.',
      diag_saved: 'Diagnostics saved to this device',
      diag_snap: 'A snapshot of {fnName} as it is now: its automations\' and scripts\' configs, helpers and devices',
      diag_ver_t: 'Download this version for debugging (anonymised or with real names)',
      diag_vers: 'Saved versions of {fnName}, with their snapshots:',
      ver_restore_backup: 'Save what\'s there now as a version first ("Before restoring …")',
      ver_restore_t: 'Put this function back as it was in this version',
      ver_restored: 'Restored "{name}"',
      ver_restored_errs: 'Restored "{name}", with {n} problem(s): {list}',
      ver_restoring: 'Restoring…',
      ver_save_b: 'Save this version',
      ver_save_h: 'Save this version',
      ver_save_hint: 'Kept by the integration, with the function as it is now. Nothing in Home Assistant changes.',
      ver_saved: 'Saved "{name}"',
      ver_title: 'Versions · {fnName}',
      ver_try: 'Try in sandbox',
      sbx_cond_mark: 'In the sandbox: {text} was {res}',
      sbx_f_calls: '{a}: {svc}{to}',
      sbx_f_checks: '{a} checks {c}',
      sbx_f_runs: '{a} runs {b}',
      sbx_f_waits: '{a} {w}',
      sbx_flow_n: 'Step {n} of {total}',
      sbx_g_device: 'A device action',
      sbx_g_event: 'Event, not on this board',
      sbx_g_mqtt: 'MQTT topic, not on this board',
      sbx_g_out: 'Not on this board',
      sbx_g_svc: 'Action, not on this board',
      sbx_g_title: 'Not on this board ({k}): shown for this sandbox run only',
      sbx_ghost_key: 'not on this board, shown for a sandbox run',
      sbx_step_next: 'Next step',
      sbx_step_prev: 'Previous step',
      sbx_unknown: 'would call: the sandbox doesn\'t know what this changes',
      sbx_use: 'Use',
      sbx_value: 'Value',
      sbx_waiting_you: 'waiting for your answer above',
      sbx_was: 'was {s}',
      sbx_already: '{name} is already {state}: nothing changes.',
      sbx_ask_cond: 'The sandbox can\'t check "{c}". Is it true?',
      sbx_ask_tpl: 'Home Assistant couldn\'t render {t} ({e}). Is it true?',
      sbx_ask_value: 'Home Assistant couldn\'t render {t}. What should it give?',
      sbx_cond_stopped: 'a condition was false',
      sbx_delay: 'Waits {d}',
      sbx_delay_label: '{name}: waits {d}',
      sbx_device_act: 'device action: {type}',
      sbx_err_continue: 'An error, carried on (continue_on_error): {e}',
      sbx_error: 'The sandbox hit a problem: {e}',
      sbx_false: 'false',
      sbx_fires: 'fires {type}',
      sbx_for_label: '{name}: once it has stayed so for {d}',
      sbx_it_is: 'it is {t}',
      sbx_loop: 'Stopped: one change led to more than {n} steps. That is probably a loop.',
      sbx_max: 'Not started: already {max} runs (mode {mode}).',
      sbx_none_true: 'none was true',
      sbx_not_true: 'one was true',
      sbx_pattern_label: '{name}: time pattern',
      sbx_queued: 'Queued until the run before it ends.',
      sbx_restart: 'Restarted: the run in progress is cancelled.',
      sbx_run_by_you: 'Run by you',
      sbx_script_failed: '{name} failed',
      sbx_single: '{name} is already running: not started again (mode single).',
      sbx_stop: 'Stops: {t}',
      sbx_time_label: '{name}: time trigger',
      sbx_timed_out: 'timed out',
      sbx_timer_label: '{name} finishes',
      sbx_tpl_gave: 'the template gave {v}',
      sbx_trig_event: 'Event {type}',
      sbx_trig_state: '{name} → {state}',
      sbx_trig_template: 'Its template became true',
      sbx_trig_time: 'The time came',
      sbx_trig_was: 'the trigger was {id}',
      sbx_true: 'true',
      sbx_unknown_step: 'A step the sandbox doesn\'t know ({k}): skipped.',
      sbx_up_to: 'up to {d}',
      sbx_wait_label: '{name}: waiting',
      sbx_wait_tpl: 'Waits until {t}{d}',
      sbx_wait_trig: 'Waits for a trigger{d}',
      sbx_you_said: 'you said {a}',
      show_node_red_flows: 'Show Node-RED flows',
      zoom_out_to_show_everything: 'Zoom out to show everything',
      back_to_a_readable_size: 'Back to a readable size',
      move: 'Move {name}',
      move_frame: 'Move frame',
      resize_frame: 'Resize frame',
      move_note: 'Move note',
      create_or_pick_a_function: 'Create or pick a function first',
      hide_from_board_2: 'Hide from board?',
      mqtt_topic_and_work: 'MQTT topic (+ and # work)',
      event_type: 'Event type',
      rename_frame: 'Rename frame',
      edit_note: 'Edit note',
      node_red_2: 'Node-RED · {tabLabel}',
      traces: 'Traces · {name}',
      remove_from_function: 'Remove from function?',
      remove_from_2: 'Remove {name} from {fnName}',
      removed_from_it_still_exists: 'Removed {name} from {fnName}. It still exists.',
      could_not_remove: 'Could not remove: {message}',
      add_to_5: 'Add {name} to {fnName}',
      added_to_3: 'Added {name} to {fnName}',
      could_not_add_3: 'Could not add {name}: {noLabelWhy}',
      new_automation: 'New automation',
      new_script: 'New script',
      new_scene: 'New scene',
      new: 'New {name}',
      more_helper_types_2: 'More helper types…',
      template_group_derivative_utility_meter: 'Template, group, derivative, utility meter and the other helpers integrations add',
      create_in_this_function: 'Create in this function',
      loading_2: 'Loading…',
      more_helper_types: 'More helper types',
      back: 'Back',
      no_other_helper_types_found: 'No other helper types found',
      back_to_runs: 'Back to runs',
      close: 'Close',
      anything_you_create_here_gets: 'Anything you create here gets the {fnName} label',
      saves_into: 'Saves into {fnName}',
      open_in_a_new_tab: 'Open in a new tab',
      runs_3: 'Runs · {fnName}',
      refresh: 'Refresh',
      loading: 'Loading...',
      no_stored_runs_yet_for: 'No stored runs yet for the automations and scripts in this function. Home Assistant keeps the last few runs of each.',
      every_automation_and_script_in: 'Every automation and script in this function, newest first. Click a run to open its trace.',
      fire_the_event: 'Fire the event',
      event_data: 'Event data',
      press_the_button: 'Press the button',
      publish_a_message: 'Publish a message',
      payload: 'Payload',
      send_a_test_notification: 'Send a test notification',
      what_to_send: 'What to send',
      run_it: 'Run it',
      check_its_conditions_first: 'Check its conditions first',
      activate: 'Activate',
      press_2: 'Press',
      set_the_value: 'Set the value',
      value: 'Value',
      set_the_text: 'Set the text',
      pick_an_option: 'Pick an option',
      option: 'Option',
      set_it: 'Set it',
      date: 'Date',
      time: 'Time',
      increment: 'Increment',
      decrement: 'Decrement',
      reset: 'Reset',
      start: 'Start',
      duration_such_as_00_00: 'Duration, such as 00:00:10 (empty: its own)',
      finish_now: 'Finish now',
      cancel: 'Cancel',
      simulate_a_state: 'Simulate a state',
      state: 'State',
      test_from_the_functions_board: 'Test from the Functions board',
      for_example: 'For example: {stringify}',
      what_this_test_changes_isn: 'What this test changes isn\'t on the board any more',
      there_s_no_test_for: 'There\'s no test for {name}',
      keep_this_test_on_the: 'Keep this test on the board as a button',
      save: 'Save',
      run_test: 'Run test',
      test_4: 'Test · {name}',
      nothing_to_run: 'Nothing to run',
      fix_first: 'Fix {bad} first',
      enter_the_state_to_simulate: 'Enter the state to simulate',
      fill_in: 'Fill in {label}',
      fill_in_the_date_or: 'Fill in the date or the time',
      a_notification_needs_a_message: 'A notification needs a message',
      set: 'Set',
      finish: 'Finish',
      simulated: '{who} → {state} (simulated)',
      press: 'Press {who}',
      fire: 'Fire {event_type}',
      publish_to: 'Publish to {topic}',
      send_a_test_notification_with: 'Send a test notification with {who}',
      without_its_conditions: ' without its conditions',
      run: 'Run {who}{extra}',
      a_real_change_whatever_reacts: 'A real change: whatever reacts to it runs.',
      only_home_assistant_s_copy: 'Only Home Assistant\'s copy changes: the device keeps its real state, and its next update puts that back.',
      every_automation_waiting_for_this: 'Every automation waiting for this event reacts, also ones outside this function.',
      publishes_it_to_the_broker: 'Publishes it to the broker for real.',
      sends_it_for_real_templates: 'Sends it for real. Templates in it are filled in first.',
      runs_its_actions_straight_away: 'Runs its actions straight away, without checking its conditions.',
      checks_its_conditions_then_runs: 'Checks its conditions, then runs its actions if they pass.',
      runs_it_with_these_fields: 'Runs it with these fields.',
      check_the_fields: 'Check the fields: {e}',
      unknown_test: 'unknown test',
      test_failed: 'Test failed: {text}: {err}',
      test_sent_tests_can_t: 'Test sent: {text}. Tests can\'t be undone.',
      failed_2: '(failed: {err})',
      test_3: 'Test: {text}{extra}',
      keep_a_test_on_the: 'Keep a test on the board',
      change_a_test_button: 'Change a test button',
      remove_a_box: 'Remove a box',
      what_this_test_changes_is: 'What this test changes is gone',
      run_this_test_2: 'Run this test?',
      the_board_asks_once_per: 'The board asks once per session.',
      run_this_test: 'Run this test',
      mqtt_isn_t_set_up: 'MQTT isn\'t set up in this Home Assistant',
      mqtt_3: 'MQTT: {key}',
      button_presses: 'Button presses ({event_type})',
      events_2: 'Events: {key}',
      mqtt_2: 'MQTT: ',
      events: 'Events: ',
      add_a_monitor: 'Add a monitor',
      or_the_last_10_messages: ', or the last 10 messages on an MQTT topic',
      add: 'Add',
      monitor_box: 'Monitor box',
      a_box_on_the_board: 'A box on the board that lists the last 10 events of one type{extra}, while this function is open. Nothing is stored.',
      an_event_type_has_no: 'An event type has no spaces or special characters',
      fires_too_often_for_a: '{topic} fires too often for a box; the Debug panel already lists what touches this function',
      can_t_listen: 'Can\'t listen: {err}',
      listening_nothing_yet: 'Listening. Nothing yet.',
      not_listening: 'Not listening',
      stopped_watching: 'Stopped watching {name}',
      has_no_triggers_to_watch: '{name} has no triggers to watch',
      could_not_watch_its_triggers: 'Could not watch its triggers: {e}',
      pause_the_function_too_for: ' Pause the function too for a dry run.',
      watching_its_trigger_arrows_pulse: 'Watching {name}: its trigger arrows pulse whenever one would fire. Nothing runs.{extra}',
      trigger_would_fire: '{name}: trigger {n} would fire{extra}',
      checks_2: '{name} checks {name2}\n',
      condition: 'Condition {n}',
      a_check_among_its_actions: 'A check among its actions',
      turned_off: '{where}: turned off',
      it_uses_the_data_of: 'it uses the data of what set it off',
      can_t_be_checked_now: '{where}: can\'t be checked now ({err})',
      right_now: '{where}: {extra} right now',
      uses_the_data_of_what: 'uses the data of what set it off',
      debug: 'Debug · {fnName}',
      the_debugger_records_while_this: 'The debugger records while this panel is open',
      recording: 'Recording',
      add_a_monitor_box_the: 'Add a monitor box: the latest events of one type, or MQTT messages',
      clear_the_timeline: 'Clear the timeline',
      reading_the_last_15_minutes: 'Reading the last 15 minutes…',
      recording_again: 'Recording again',
      the_logbook_isn_t_available: 'The logbook isn\'t available, so the timeline lists only the changes the board sees while it is open.',
      stopped_recording: 'Stopped recording',
      a_user: 'a user',
      you: 'you',
      an_automation_or_script: 'an automation or script',
      an_action: 'an action',
      its_device_or_integration: 'its device or integration',
      test: 'Test: {message}',
      another_board: 'another board',
      a_test_simulated: 'a test (simulated)',
      nothing_yet_whatever_happens_to: 'Nothing yet. Whatever happens to this function\'s automations, scripts, helpers and devices shows here while this panel is open.',
      by: 'by {text}',
      didn_t_fire_2: 'didn\'t fire',
      started_by: 'started by {text}',
      triggered_by_2: 'triggered by {src}',
      from_this_board: 'from this board',
      why_did_or_didn_t: ': why did or didn\'t it run?',
      reading_its_traces: 'Reading its traces…',
      it_is_turned_off_nothing: 'It is turned off: nothing sets it off until it is turned on again.',
      n_would_be_runs: { one: '{n} would-be run', other: '{n} would-be runs' },
      watching_its_triggers_so_far: 'Watching its triggers: {hits} so far.',
      didn_t_fire: 'Didn\'t fire',
      triggered_by: 'triggered by {trigger}',
      no_attempts_stored_home_assistant: 'No attempts stored. Home Assistant stores one each time a trigger fires (and, for some triggers, when a change didn\'t fire them). Watch triggers shows what would fire from now on.',
      could_not_read_its_trace: 'Could not read its trace: {err}',
      nothing_in_this_step_is: 'Nothing in this step is on the board',
      replay: 'Replay',
      open_trace: 'Open trace',
      ran: '{boxName} ran',
      trace: 'Trace · {boxName}{extra}',
      last_messages: 'Last messages · {name}',
      reading_traces: 'Reading traces…',
      no_title: '(no title)',
      what_this_sent_lately_newest: 'What this sent lately, newest first, from the traces of the automations and scripts that send it. Click one to see its run on the board.',
      buttons: 'Buttons: {btns}',
      nothing_found_home_assistant_keeps: 'Nothing found. Home Assistant keeps the last few runs of each automation and script; none of the stored ones sent this.',
      this_arrow_comes_from_the: 'This arrow comes from the helper\'s own settings',
      this_arrow_doesn_t_come: 'This arrow doesn\'t come from an automation or script config',
      remove_what_this_arrow_stands: 'Remove what this arrow stands for from the config',
      full_manager_only_switch_it: 'Full manager only: switch it on in the Functions Board integration\'s options',
      edit: 'Edit {name}',
      open_in_its_editor: 'Open {name} in its editor',
      remove_2: 'Remove…',
      it_isn_t_on_the: 'It isn\'t on the board any more.',
      has_no_id_so_it: '{name} has no ID, so it can\'t be saved from here. Give it an id: in its YAML first.',
      is_set_up_in_yaml: '{name} is set up in YAML outside {dom}s.yaml, so it can\'t be changed from here. Edit its file instead.',
      could_not_read_its_config: 'Could not read its config: {e}',
      comes_from_a_blueprint_its: '{name} comes from a blueprint: its arrows come from the blueprint\'s inputs. Change those in its editor.',
      remove_an_arrow: 'Remove an arrow',
      reading_the_config: 'Reading the config…',
      open_the_editor: 'Open the editor',
      removes_this: 'removes this {extra}',
      takes_out_of_its_list: 'takes {otherName} out of its list',
      what_s_config_says_about: 'What {name}\'s config says about {otherName}. Tick what to remove.',
      the_arrow_comes_through: '(the arrow comes through {boxName})',
      doesn_t_name_directly_so: '{name} doesn\'t name {otherName} directly{extra}, so there\'s nothing to remove here.',
      n_templates: { one: '{n} template', other: '{n} templates' },
      it_is_also_read_inside: 'It is also read inside {indirect}; those can only be changed in the editor.',
      saving_writes_s_yaml_the: 'Saving writes {dom}s.yaml the way Home Assistant\'s own editor does: comments in that file are lost. You can undo the change itself.',
      now_click_the_box_to: 'Now click the box to connect {name} to. Esc cancels.',
      now_click_the_box_that_leads_to: 'Now click the box that leads into {name}. Esc cancels.',
      an_arrow_can_t_go: 'An arrow can\'t go from {name} to {name2}: arrows go from an entity into an automation, or from an automation or script to what it changes or runs.',
      reading_what_home_assistant_offers: 'Reading what Home Assistant offers…',
      home_assistant_offers_nothing_that: 'Home Assistant offers nothing that links these two.',
      it_triggers_it: 'It triggers it',
      pressing_it_triggers_it: 'Pressing it triggers it',
      it_changes_state: 'It changes state',
      its_state_is: 'Its state is',
      it_runs_it: 'It runs it',
      triggers_when: '{name} triggers {name2}: when…',
      checks_only_if: '{name} checks {name2}: only if…',
      changes_it: '{name} changes {name2}: it…',
      runs_2: '{name} runs {name2}',
      it_is_checked_by_it: 'It is checked by it',
      to_empty_any_change: 'To (empty: any change)',
      connect_and_2: 'Connect {name} and {name2}',
      adds_to: 'Adds to {name}:',
      enter_the_state_it_checks: 'Enter the state it checks for',
      tick_at_least_one: 'Tick at least one',
      home_assistant_doesn_t_accept: 'Home Assistant doesn\'t accept this:',
      connect_and: 'Connect {boxName} and {name}',
      remove_from: 'Remove {boxName} from {name}',
      could_not_save_2: 'Could not save: {e}',
      saved_through_home_assistant_s: '{text}. Saved through Home Assistant\'s config, as its editor does.',
      this_home_assistant_has_no: 'This Home Assistant has no apps (add-ons), so there is no Node-RED app to read',
      no_node_red_app_is: 'No Node-RED app is installed',
      the_node_red_app_isn: 'The Node-RED app isn\'t running',
      the_node_red_app_has: 'The Node-RED app has no page in Home Assistant (ingress)',
      node_red_answered: 'Node-RED answered {status}',
      could_not_read_the_flows: 'Could not read the flows: {e}',
      set_off_by: 'Set off by',
      checks: 'Checks',
      reads: 'Reads',
      changed_by: 'Changed by',
      run_by: 'Run by',
      tested_or_listened_to_by: 'Tested or listened to by',
      sets_off: 'Sets off',
      is_checked_by: 'Is checked by',
      is_read_by: 'Is read by',
      and_more_2: '{names} and {n} more',
      cmd: 'Cmd',
      ctrl: 'Ctrl',
      undo_z: 'Undo: {text} ({key}+Z)',
      nothing_to_undo: 'Nothing to undo',
      redo_shift_z: 'Redo: {text} ({key}+Shift+Z)',
      nothing_to_redo: 'Nothing to redo',
      changed_since_somewhere_else: '{text}: changed since, somewhere else.',
      undo_anyway: 'Undo anyway',
      redo_anyway: 'Redo anyway',
      undone: 'Undone: ',
      redone: 'Redone: ',
      could_not: 'Could not {dir} {text}: {message}',
      new_frame: 'New frame',
      add_frame: 'Add frame',
      add_note: 'Add note',
      delete_frame: 'Delete frame',
      edit_function: 'Edit function',
      also_file_new_automations_scripts: 'Also file new automations, scripts and helpers under a category with this name (an existing category with the same name is reused)',
      this_edits_the_home_assistant: 'This edits the Home Assistant label behind the function.',
      this_creates_a_home_assistant: 'This creates a Home Assistant label. Everything with the label is part of the function and still appears in its usual place.',
      name: 'Name',
      e_g_bathroom_heater_filter: 'e.g. Bathroom heater filter',
      description: 'Description',
      what_this_function_does_optional: 'What this function does (optional)',
      create_2: 'Create',
      icon: 'Icon',
      colour: 'Colour',
      create: 'Create {name}',
      could_not_save: 'Could not save: {message}',
      is_already_a_function_on: 'is already a function on the board.',
      open_it: 'Open it',
      a_home_assistant_label_called: 'A Home Assistant label called',
      already_exists_so_this_name: 'already exists, so this name is taken. It may be a function you hid from the board, or a label you use for something else.',
      put_it_back_on_the: 'Put it back on the board',
      choose_another_name: 'Choose another name',
      put_back: 'Put back {fnName}',
      is_back_on_the_board: '{fnName} is back on the board, with its layout',
      hide_2: 'Hide {name}',
      hid_its_label_and_items: 'Hid {name}. Its label and items stay in Home Assistant; Import > Labels brings it back.',
      creating_a_function_creates_a: 'Creating a function creates a Home Assistant label, and matching categories if you tick that option.',
      adding_or_removing_a_piece: 'Adding or removing a piece adds or removes that label. Items keep their other labels and stay where they are; a category is only set on items that don\'t have one.',
      pause_and_resume_turn_the: 'Pause and Resume turn the function\'s automations off and on. Resume turns on only the ones Pause turned off.',
      new_automations_scripts_helpers_and: 'New automations, scripts, helpers and scenes are made in Home Assistant\'s own editors, in the drawer; the board labels what they create.',
      hide_from_board_leaves_the: 'Hide from board leaves the label, everything in it and the layout alone.',
      full_manager_is_on_the: 'Full manager is on: the board can also delete a function (its label and layout, and its categories if you choose), a function together with its automations, scripts and helpers, or a single item. Devices are never deleted.',
      tests_full_manager_a_helper: 'Tests (Full manager): a helper changed through its own actions, a simulated state (Home Assistant\'s copy only; the device keeps its real state), a fired event, an automation or script run, a test notification. Each is written to the logbook and can\'t be undone; the first one of a session asks first.',
      this_install_is_set_to: 'This install is set to Organise only: the board doesn\'t edit or delete automations, scripts, helpers or devices, and doesn\'t run tests. Full manager, which adds deleting and tests, is in the Functions Board integration\'s options.',
      the_debugger_watch_triggers_monitor: 'The debugger, Watch triggers, monitor boxes and the live checks on arrows only read: watching a trigger never runs the automation.',
      show_node_red_flows_in: 'Show Node-RED flows (in the Key, off until you switch it on) reads your Node-RED app\'s flows in your browser to draw what they use. The flows last read (names and entity IDs, no flow code) are kept by the integration for every board.',
      privacy_promise: 'Nothing leaves your Home Assistant: the board talks only to it, keeps its data in Home Assistant\'s own storage, and sends no telemetry. Diagnostics are a file you download, anonymised or not as you choose.',
      every_change_is_shown_before: 'Every change is shown before it happens, and Undo (Ctrl+Z) takes it back, except tests and deleting a helper that an integration set up.',
      shared_between_administrators_functions_board: 'shared between administrators (Functions Board integration)',
      stored_for_your_user_only: 'stored for your user only (install the Functions Board integration to share them)',
      full_manager: ' · Full manager',
      organise_only: ' · Organise only',
      functions_board: 'Functions board',
      project_page_and_issues: 'Project page and issues',
      v_prototype: 'v{version} · prototype',
      what_it_changes: 'What it changes{extra}',
      where_things_are_kept: 'Where things are kept',
      frames_notes_and_positions_are: 'Frames, notes and positions are {store}. Nothing leaves your Home Assistant.',
      how_the_arrows_are_drawn: 'How the arrows are drawn',
      from_each_automation_and_script: 'From each automation and script config (blueprint ones as Home Assistant fills them in): its triggers, conditions, actions and script calls, the entities behind area, floor and label targets, scenes and groups, notification buttons, and what template and other derived helpers read. Tools outside Home Assistant\'s own automations and scripts (AppDaemon, pyscript) aren\'t read.',
      edit_name_icon_colour: 'Edit name, icon, colour',
      hide_from_board: 'Hide from board',
      the_label_everything_in_it: 'The label, everything in it and the layout stay; you can bring it back',
      delete_function_2: 'Delete function…',
      deletes_the_label_and_the: 'Deletes the label and the layout; the items stay',
      delete_function_and_its_items: 'Delete function and its items…',
      also_deletes_its_automations_scripts: 'Also deletes its automations, scripts and helpers',
      devices_are_never_deleted_it: 'devices are never deleted; it only leaves the function',
      defined_in_yaml_without_an: 'defined in YAML without an id; delete it there',
      defined_in_yaml_outside_s: 'defined in YAML outside {dom}s.yaml; delete it there',
      helpers_made_in_the_ui: 'helpers made in the UI',
      defined_in_yaml_configuration_yaml: 'defined in YAML (configuration.yaml or a package); delete it there',
      deleting_a_helper_set_up: 'deleting a helper set up by an integration can\'t be undone',
      not_an_automation_script_or: 'not an automation, script or helper; it only leaves the function',
      n_automations_and_scripts: { one: '{n} automation or script', other: '{n} automations and scripts' },
      and_more: ' and {n} more',
      used_by: 'Used by {count}: {names}{extra}',
      checking_what_uses_it: 'Checking what uses it…',
      n_other_entities: { one: '{n} other entity', other: '{n} other entities' },
      that_also_deletes_the_same: ' That also deletes {n} the same helper made.',
      undo_brings_it_back_with: 'Undo brings it back, with its labels, area and category.',
      deletes_this_from_home_assistant: 'Deletes this {kind} from Home Assistant ({where}).{extra}',
      this_can_t_be_undone: 'This can\'t be undone: {why}.',
      the_board_can_t_delete: 'The board can\'t delete it: {why}.',
      delete_2: 'Delete {name}?',
      checking_what_it_contains_and: 'Checking what it contains and what uses it…',
      can_t_be_undone: ' · can\'t be undone',
      n_categories: { one: '{n} category', other: '{n} categories' },
      other_items_are_filed_there: '. Other items are filed there too; they become uncategorised',
      also_delete_the_named: 'Also delete the {count} named {name} ({cats}){extra}',
      only_this_function_s_items: '. Only this function\'s items are filed there; they become uncategorised',
      n_items: { one: '{n} item', other: '{n} items' },
      the_items_themselves_stay_where: '; the items themselves stay where they are',
      n_frames: { one: '{n} frame', other: '{n} frames' },
      n_notes: { one: '{n} note', other: '{n} notes' },
      deletes_these_from_home_assistant: 'Deletes these from Home Assistant. Devices are never deleted.',
      undo_brings_back_the_function: 'Undo brings back the function and everything except helpers set up by integrations.',
      undo_brings_it_all_back: 'Undo brings it all back.',
      delete_function_and_items: 'Delete function and items',
      deletes_the_label: 'Deletes the label',
      home_assistant_removes_it_from: '. Home Assistant removes it from the {n} that carry it{extra}.',
      deletes_the_board_s_layout: 'Deletes the board\'s layout for it (positions{extra}{extra2}).',
      delete_function: 'Delete function',
      deleting: 'Deleting…',
      could_not_delete_2: 'Could not delete: {message}',
      could_not_delete: 'Could not delete: {failed}',
      delete: 'Delete {name}',
      deleted_2: 'Deleted {name}',
      some_items_could_not_be: 'Some items could not be deleted: {failed}',
      and: ' and {count}',
      deleted: 'Deleted {name}{extra}',
      node_red: 'Node-RED',
      n_scripts: { one: '{n} script', other: '{n} scripts' },
      n_helpers: { one: '{n} helper', other: '{n} helpers' },
      detected_functions: 'Detected functions',
      labels: 'Labels',
      pick_items: 'Pick items',
      of_selected: '{n} of {avail} selected',
      select_none: 'Select none',
      select_all: 'Select all',
      importing_2: 'Importing...',
      file_imported_pieces_under_a: 'File imported pieces under a category named after their function (pieces that already have one keep it)',
      also_join_automations_that_meet: 'Also join automations that meet at a device (one turns a light on, another starts from that light)',
      rescan: 'Rescan',
      import_selected: 'Import selected',
      none_selected: 'None selected',
      add_as_functions_2: 'Add as functions',
      a_new_function: 'a new function',
      add_to_4: 'Add {n} to {to}',
      tracing_every_automation_and_script: 'Tracing every automation and script...',
      the_scan_failed: 'The scan failed: {error}',
      no_groups_found_groups_show: 'No groups found. Groups show up here when automations, scripts and helpers trigger, change or call each other, or share a category.',
      of_and_of_are_in: '{a} of {a2} and {s} of {s2} are in a group or a function.',
      traced_and_each_group_below: 'Traced {automations} and {scripts}. Each group below is a set of automations, scripts and helpers that trigger, change or call each other, merged with any category you already filed them under. Rename a group, open it to untick pieces that don\'t belong, then import it on its own, or tick several and import them together. Helpers that a lot of unrelated automations use (mode flags, shared notification scripts) are left out of the grouping so they don\'t glue everything into one.',
      hide: 'Hide',
      show: 'Show',
      no_unique_id_add_id_2: 'No unique ID: add id: to its YAML',
      new_function_from_this: 'New function from this',
      not_in_any_function: 'Not in any function',
      no_wiring_or_category_ties: 'no wiring or category ties them to a group',
      added_to_2: 'Added {nameOf} to {fnName}',
      go_there: 'Go there',
      created: 'Created {name}',
      could_not_create: 'Could not create: {message}',
      from_a_category: 'from a category',
      from_the_wiring: 'from the wiring',
      category_wiring: 'category + wiring',
      on_the_board_2: 'on the board',
      already_in_2: '{n} already in {fnName}',
      on_the_board: 'On the board',
      label_the_pieces_that_aren: 'Label the pieces that aren\'t in {name} yet',
      add_missing: 'Add {count} missing',
      already_a_function: 'Already a function',
      function_name_click_to_rename: 'Function name (click to rename)',
      not_in_it_yet: ' · {count} not in it yet',
      select_for_import_selected: 'Select for Import selected',
      the_pieces: '{extra} the pieces',
      can_t_be_added_no: ' · can\'t be added: no unique ID; add id: to its YAML',
      already_in: '· already in {other}',
      n_pieces: { one: '{n} piece', other: '{n} pieces' },
      adding_to: 'Adding {count} to {name}...',
      importing: 'Importing {name}...',
      could_not_import: 'Could not import {name}: {message}',
      imported_2: 'Imported {names}',
      n_functions: { one: '{n} function', other: '{n} functions' },
      imported: 'Imported {count}',
      skipped: '; {count} skipped ({why})',
      failed: '; {failed} failed',
      import: 'Import {name}',
      every_label_is_already_on: 'Every label is already on the board.',
      labels_you_already_use_adding: 'Labels you already use. Adding one makes it a function: everything carrying that label shows up on its board. Labels that describe a kind of thing (battery powered, needs review) rather than a job usually make poor functions.',
      n_labels: { one: '{n} label', other: '{n} labels' },
      add_as_functions: 'Add {count} as functions',
      added: 'Added {count}',
      new_function: 'New function...',
      new_function_name: 'New function name',
      e_g_garage_door: 'e.g. Garage door',
      search_by_name_entity_id: 'Search by name, entity ID, area, device or integration (several words narrow it down)',
      adding_gives_each_item_the: 'Adding gives each item the function\'s label (devices get it on the device). It stays where it is and keeps its other labels.',
      entities: 'Entities',
      hidden: ' ({diagHidden} hidden)',
      selected: 'Selected',
      tick_everything_currently_listed: 'Tick everything currently listed',
      select_all_shown: 'Select all shown',
      device_settings_and_diagnostics: 'Device settings and diagnostics{extra}',
      already_in_this_function: ' · already in this function',
      show_more_not_shown: 'Show {min} more ({more} not shown)',
      give_the_new_function_a: 'Give the new function a name first',
      could_not_add: 'Could not add: {message}',
      added_to: 'Added {count} to {fnName}{extra}',
      add_to: 'Add {count} to {fnName}',
      no_unique_id_add_id: 'no unique ID; add id: to its YAML',
      could_not_be_labelled: 'could not be labelled',
      whiteboard_of_the_automations_scripts: 'Whiteboard of the automations, scripts and helpers behind each function (label), wired together.',
    },
  };
  setLang('en');

  /* ---------- Sandbox (Phase 10): a function run on a copy of Home Assistant's states ----------
     Nothing is sent to Home Assistant but templates to render, which only read. The sandbox keeps its own states
     (the real ones until it changes them), its own clock, and runs the function's automations and scripts the way
     Home Assistant does: triggers, conditions, actions and their effects, delays and waits, run modes. What it
     can't know (a device's action, a sun or zone condition, a template Home Assistant couldn't render) it asks.
     Times are milliseconds on the sandbox clock; times of day are read in Home Assistant's time zone. */
  const SBX_LIMIT = 2000;  // steps one change may cause before the sandbox calls it a loop and stops
  const SBX_CANCEL = { cancel: true }, SBX_STOP = { stop: true };
  const SBX_COND_FAIL = { condFail: true };
  const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function tzParts(ms, tz) {
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
  function localAt(ms, hms, tz) {
    const p = tzParts(ms, tz), wall = Date.UTC(p.y, p.mo - 1, p.d, hms[0], hms[1], hms[2] || 0);
    let t = wall;
    for (let i = 0; i < 3; i++) { const q = tzParts(t, tz); t = wall - (Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - t); }
    return t;
  }
  const tzOffset = (ms, tz) => { const q = tzParts(ms, tz); return Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - Math.floor(ms / 1000) * 1000; };
  function parseHMS(v) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v == null ? '' : v).trim());
    return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
  }
  // a duration as Home Assistant reads it: seconds, "HH:MM:SS(.ms)", "HH:MM", or { days, hours, minutes, seconds, milliseconds }
  function durMs(v) {
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
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  // a template's result as a condition reads it (Home Assistant's result_as_boolean)
  function asBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return ['1', 'true', 'yes', 'on', 'enable'].includes(v.trim().toLowerCase());
    return false;
  }
  // part of an event's data matching what a trigger asks for
  function subsetOf(want, got) {
    if (want == null) return true;
    if (typeof want !== 'object' || Array.isArray(want)) return canon(want) === canon(got) || String(want) === String(got);
    if (!got || typeof got !== 'object') return false;
    return Object.entries(want).every(([k, v]) => subsetOf(v, got[k]));
  }
  // what a service does to an entity's state: [state, attributes] or null when the sandbox doesn't know
  const SBX_ONOFF = new Set(['light', 'switch', 'fan', 'input_boolean', 'siren', 'humidifier', 'automation', 'remote', 'media_player', 'climate', 'water_heater', 'group']);
  const SBX_ARM = { alarm_arm_home: 'armed_home', alarm_arm_away: 'armed_away', alarm_arm_night: 'armed_night', alarm_arm_vacation: 'armed_vacation',
    alarm_arm_custom_bypass: 'armed_custom_bypass', alarm_disarm: 'disarmed', alarm_trigger: 'triggered' };
  function sbxEffect(dom, svc, cur, d, nowIso) {
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
      case 'input_number.set_value': case 'number.set_value': { const v = num(d.value); return v == null ? null : [fmtN(clamp(v)), {}]; }
      case 'input_number.increment': case 'input_number.decrement': {
        const v = num(st), s = num(A.step) || 1;
        return v == null ? null : [fmtN(clamp(v + (svc === 'increment' ? s : -s))), {}];
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
  const HA_GENERIC = { cover: { turn_on: 'open_cover', turn_off: 'close_cover', toggle: 'toggle' }, valve: { turn_on: 'open_valve', turn_off: 'close_valve', toggle: 'toggle' },
    lock: { turn_on: 'lock', turn_off: 'unlock' } };

  // Home Assistant's per-entity triggers (light.turned_on, door.opened, ...), from its own trigger classes:
  // scripts/gen_sandbox_triggers.py writes this table
  const SBX_ETRIG = /* SBX_ETRIG:start */{"air_quality.co2_changed":{"d":{"sensor":{"dc":["carbon_dioxide"]}},"k":"num_changed"},"air_quality.co2_crossed_threshold":{"d":{"sensor":{"dc":["carbon_dioxide"]}},"k":"num_crossed"},"air_quality.co_changed":{"d":{"sensor":{"dc":["carbon_monoxide"]}},"k":"num_changed"},"air_quality.co_cleared":{"d":{"binary_sensor":{"dc":["carbon_monoxide"]}},"k":"target","to":["off"]},"air_quality.co_crossed_threshold":{"d":{"sensor":{"dc":["carbon_monoxide"]}},"k":"num_crossed"},"air_quality.co_detected":{"d":{"binary_sensor":{"dc":["carbon_monoxide"]}},"k":"target","to":["on"]},"air_quality.gas_cleared":{"d":{"binary_sensor":{"dc":["gas"]}},"k":"target","to":["off"]},"air_quality.gas_detected":{"d":{"binary_sensor":{"dc":["gas"]}},"k":"target","to":["on"]},"air_quality.n2o_changed":{"d":{"sensor":{"dc":["nitrous_oxide"]}},"k":"num_changed"},"air_quality.n2o_crossed_threshold":{"d":{"sensor":{"dc":["nitrous_oxide"]}},"k":"num_crossed"},"air_quality.no2_changed":{"d":{"sensor":{"dc":["nitrogen_dioxide"]}},"k":"num_changed"},"air_quality.no2_crossed_threshold":{"d":{"sensor":{"dc":["nitrogen_dioxide"]}},"k":"num_crossed"},"air_quality.no_changed":{"d":{"sensor":{"dc":["nitrogen_monoxide"]}},"k":"num_changed"},"air_quality.no_crossed_threshold":{"d":{"sensor":{"dc":["nitrogen_monoxide"]}},"k":"num_crossed"},"air_quality.ozone_changed":{"d":{"sensor":{"dc":["ozone"]}},"k":"num_changed"},"air_quality.ozone_crossed_threshold":{"d":{"sensor":{"dc":["ozone"]}},"k":"num_crossed"},"air_quality.pm10_changed":{"d":{"sensor":{"dc":["pm10"]}},"k":"num_changed"},"air_quality.pm10_crossed_threshold":{"d":{"sensor":{"dc":["pm10"]}},"k":"num_crossed"},"air_quality.pm1_changed":{"d":{"sensor":{"dc":["pm1"]}},"k":"num_changed"},"air_quality.pm1_crossed_threshold":{"d":{"sensor":{"dc":["pm1"]}},"k":"num_crossed"},"air_quality.pm25_changed":{"d":{"sensor":{"dc":["pm25"]}},"k":"num_changed"},"air_quality.pm25_crossed_threshold":{"d":{"sensor":{"dc":["pm25"]}},"k":"num_crossed"},"air_quality.pm4_changed":{"d":{"sensor":{"dc":["pm4"]}},"k":"num_changed"},"air_quality.pm4_crossed_threshold":{"d":{"sensor":{"dc":["pm4"]}},"k":"num_crossed"},"air_quality.radon_changed":{"d":{"sensor":{"dc":["radon"]}},"k":"num_changed"},"air_quality.radon_crossed_threshold":{"d":{"sensor":{"dc":["radon"]}},"k":"num_crossed"},"air_quality.smoke_cleared":{"d":{"binary_sensor":{"dc":["smoke"]}},"k":"target","to":["off"]},"air_quality.smoke_detected":{"d":{"binary_sensor":{"dc":["smoke"]}},"k":"target","to":["on"]},"air_quality.so2_changed":{"d":{"sensor":{"dc":["sulphur_dioxide"]}},"k":"num_changed"},"air_quality.so2_crossed_threshold":{"d":{"sensor":{"dc":["sulphur_dioxide"]}},"k":"num_crossed"},"air_quality.voc_changed":{"d":{"sensor":{"dc":["volatile_organic_compounds"]}},"k":"num_changed"},"air_quality.voc_crossed_threshold":{"d":{"sensor":{"dc":["volatile_organic_compounds"]}},"k":"num_crossed"},"air_quality.voc_ratio_changed":{"d":{"sensor":{"dc":["volatile_organic_compounds_parts"]}},"k":"num_changed"},"air_quality.voc_ratio_crossed_threshold":{"d":{"sensor":{"dc":["volatile_organic_compounds_parts"]}},"k":"num_crossed"},"alarm_control_panel.armed":{"d":{"alarm_control_panel":{}},"from":["arming","disarmed","disarming","pending","triggered"],"k":"transition","to":["armed_away","armed_custom_bypass","armed_home","armed_night","armed_vacation"]},"alarm_control_panel.armed_away":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_away"]},"alarm_control_panel.armed_home":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_home"]},"alarm_control_panel.armed_night":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_night"]},"alarm_control_panel.armed_vacation":{"d":{"alarm_control_panel":{}},"k":"target","to":["armed_vacation"]},"alarm_control_panel.disarmed":{"d":{"alarm_control_panel":{}},"k":"target","to":["disarmed"]},"alarm_control_panel.triggered":{"d":{"alarm_control_panel":{}},"k":"target","to":["triggered"]},"assist_satellite.idle":{"d":{"assist_satellite":{}},"k":"target","to":["idle"]},"assist_satellite.listening":{"d":{"assist_satellite":{}},"k":"target","to":["listening"]},"assist_satellite.processing":{"d":{"assist_satellite":{}},"k":"target","to":["processing"]},"assist_satellite.responding":{"d":{"assist_satellite":{}},"k":"target","to":["responding"]},"battery.became_low":{"d":{"binary_sensor":{"dc":["battery"]}},"k":"target","to":["on"]},"battery.level_changed":{"d":{"sensor":{"dc":["battery"]}},"k":"num_changed"},"battery.level_crossed_threshold":{"d":{"sensor":{"dc":["battery"]}},"k":"num_crossed"},"battery.no_longer_low":{"d":{"binary_sensor":{"dc":["battery"]}},"k":"target","to":["off"]},"battery.started_charging":{"d":{"binary_sensor":{"dc":["battery_charging"]}},"k":"target","to":["on"]},"battery.stopped_charging":{"d":{"binary_sensor":{"dc":["battery_charging"]}},"k":"target","to":["off"]},"button.pressed":{"d":{"button":{},"input_button":{}},"k":"stateless"},"climate.hvac_mode_changed":{"d":{"climate":{}},"k":"target"},"climate.started_cooling":{"d":{"climate":{"attr":"hvac_action"}},"k":"target","to":["cooling"]},"climate.started_drying":{"d":{"climate":{"attr":"hvac_action"}},"k":"target","to":["drying"]},"climate.started_heating":{"d":{"climate":{"attr":"hvac_action"}},"k":"target","to":["heating"]},"climate.target_humidity_changed":{"d":{"climate":{"attr":"humidity"}},"k":"num_changed"},"climate.target_humidity_crossed_threshold":{"d":{"climate":{"attr":"humidity"}},"k":"num_crossed"},"climate.target_temperature_changed":{"d":{"climate":{"attr":"temperature"}},"k":"num_changed"},"climate.target_temperature_crossed_threshold":{"d":{"climate":{"attr":"temperature"}},"k":"num_crossed"},"climate.turned_off":{"d":{"climate":{}},"k":"target","to":["off"]},"climate.turned_on":{"d":{"climate":{}},"from":["off"],"k":"transition","to":["auto","cool","dry","fan_only","heat","heat_cool"]},"cover.awning_closed":{"d":{"cover":{"attr":"is_closed","dc":["awning"],"tv":true}},"k":"cover"},"cover.awning_opened":{"d":{"cover":{"attr":"is_closed","dc":["awning"],"tv":false}},"k":"cover"},"cover.blind_closed":{"d":{"cover":{"attr":"is_closed","dc":["blind"],"tv":true}},"k":"cover"},"cover.blind_opened":{"d":{"cover":{"attr":"is_closed","dc":["blind"],"tv":false}},"k":"cover"},"cover.curtain_closed":{"d":{"cover":{"attr":"is_closed","dc":["curtain"],"tv":true}},"k":"cover"},"cover.curtain_opened":{"d":{"cover":{"attr":"is_closed","dc":["curtain"],"tv":false}},"k":"cover"},"cover.shade_closed":{"d":{"cover":{"attr":"is_closed","dc":["shade"],"tv":true}},"k":"cover"},"cover.shade_opened":{"d":{"cover":{"attr":"is_closed","dc":["shade"],"tv":false}},"k":"cover"},"cover.shutter_closed":{"d":{"cover":{"attr":"is_closed","dc":["shutter"],"tv":true}},"k":"cover"},"cover.shutter_opened":{"d":{"cover":{"attr":"is_closed","dc":["shutter"],"tv":false}},"k":"cover"},"door.closed":{"d":{"binary_sensor":{"dc":["door"],"tv":"off"},"cover":{"attr":"is_closed","dc":["door"],"tv":true}},"k":"cover"},"door.opened":{"d":{"binary_sensor":{"dc":["door"],"tv":"on"},"cover":{"attr":"is_closed","dc":["door"],"tv":false}},"k":"cover"},"doorbell.rang":{"d":{"event":{"dc":["doorbell"]}},"k":"stateless"},"event.received":{"d":{"event":{}},"k":"stateless"},"fan.turned_off":{"d":{"fan":{}},"k":"target","to":["off"]},"fan.turned_on":{"d":{"fan":{}},"k":"target","to":["on"]},"garage_door.closed":{"d":{"binary_sensor":{"dc":["garage_door"],"tv":"off"},"cover":{"attr":"is_closed","dc":["garage"],"tv":true}},"k":"cover"},"garage_door.opened":{"d":{"binary_sensor":{"dc":["garage_door"],"tv":"on"},"cover":{"attr":"is_closed","dc":["garage"],"tv":false}},"k":"cover"},"gate.closed":{"d":{"cover":{"attr":"is_closed","dc":["gate"],"tv":true}},"k":"cover"},"gate.opened":{"d":{"cover":{"attr":"is_closed","dc":["gate"],"tv":false}},"k":"cover"},"humidifier.mode_changed":{"d":{"humidifier":{"attr":"mode"}},"k":"target"},"humidifier.started_drying":{"d":{"humidifier":{"attr":"action"}},"k":"target","to":["drying"]},"humidifier.started_humidifying":{"d":{"humidifier":{"attr":"action"}},"k":"target","to":["humidifying"]},"humidifier.turned_off":{"d":{"humidifier":{}},"k":"target","to":["off"]},"humidifier.turned_on":{"d":{"humidifier":{}},"k":"target","to":["on"]},"humidity.changed":{"d":{"climate":{"attr":"current_humidity"},"humidifier":{"attr":"current_humidity"},"sensor":{"dc":["humidity"]},"weather":{"attr":"humidity"}},"k":"num_changed"},"humidity.crossed_threshold":{"d":{"climate":{"attr":"current_humidity"},"humidifier":{"attr":"current_humidity"},"sensor":{"dc":["humidity"]},"weather":{"attr":"humidity"}},"k":"num_crossed"},"illuminance.changed":{"d":{"sensor":{"dc":["illuminance"]}},"k":"num_changed"},"illuminance.cleared":{"d":{"binary_sensor":{"dc":["light"]}},"k":"target","to":["off"]},"illuminance.crossed_threshold":{"d":{"sensor":{"dc":["illuminance"]}},"k":"num_crossed"},"illuminance.detected":{"d":{"binary_sensor":{"dc":["light"]}},"k":"target","to":["on"]},"lawn_mower.became_idle":{"d":{"lawn_mower":{}},"k":"target","to":["idle"]},"lawn_mower.errored":{"d":{"lawn_mower":{}},"k":"target","to":["error"]},"lawn_mower.paused_mowing":{"d":{"lawn_mower":{}},"k":"target","to":["paused"]},"lawn_mower.returned_to_dock":{"d":{"lawn_mower":{}},"k":"target","to":["docked"]},"lawn_mower.started_mowing":{"d":{"lawn_mower":{}},"k":"target","to":["mowing"]},"lawn_mower.started_returning":{"d":{"lawn_mower":{}},"k":"target","to":["returning"]},"light.brightness_changed":{"d":{"light":{"attr":"brightness"}},"k":"num_changed"},"light.brightness_crossed_threshold":{"d":{"light":{"attr":"brightness"}},"k":"num_crossed"},"light.turned_off":{"d":{"light":{}},"k":"target","to":["off"]},"light.turned_on":{"d":{"light":{}},"k":"target","to":["on"]},"lock.jammed":{"d":{"lock":{}},"k":"target","to":["jammed"]},"lock.locked":{"d":{"lock":{}},"k":"target","to":["locked"]},"lock.opened":{"d":{"lock":{}},"k":"target","to":["open"]},"lock.unlocked":{"d":{"lock":{}},"k":"target","to":["unlocked"]},"media_player.paused_playing":{"d":{"media_player":{}},"from":["buffering","playing"],"k":"transition","to":["paused"]},"media_player.started_playing":{"d":{"media_player":{}},"from":["idle","off","on","paused"],"k":"transition","to":["buffering","playing"]},"media_player.stopped_playing":{"d":{"media_player":{}},"from":["buffering","paused","playing"],"k":"transition","to":["idle","off","on"]},"media_player.turned_off":{"d":{"media_player":{}},"from":["buffering","idle","on","paused","playing"],"k":"transition","to":["off"]},"media_player.turned_on":{"d":{"media_player":{}},"from":["off"],"k":"transition","to":["buffering","idle","on","paused","playing"]},"media_player.volume_changed":{"d":{"media_player":{"attr":"volume_level"}},"k":"num_changed"},"media_player.volume_crossed_threshold":{"d":{"media_player":{"attr":"volume_level"}},"k":"num_crossed"},"moisture.changed":{"d":{"sensor":{"dc":["moisture"]}},"k":"num_changed"},"moisture.cleared":{"d":{"binary_sensor":{"dc":["moisture"]}},"k":"target","to":["off"]},"moisture.crossed_threshold":{"d":{"sensor":{"dc":["moisture"]}},"k":"num_crossed"},"moisture.detected":{"d":{"binary_sensor":{"dc":["moisture"]}},"k":"target","to":["on"]},"motion.cleared":{"d":{"binary_sensor":{"dc":["motion"]}},"k":"target","to":["off"]},"motion.detected":{"d":{"binary_sensor":{"dc":["motion"]}},"k":"target","to":["on"]},"occupancy.cleared":{"d":{"binary_sensor":{"dc":["occupancy"]}},"k":"target","to":["off"]},"occupancy.detected":{"d":{"binary_sensor":{"dc":["occupancy"]}},"k":"target","to":["on"]},"power.changed":{"d":{"sensor":{"dc":["power"]}},"k":"num_changed"},"power.crossed_threshold":{"d":{"sensor":{"dc":["power"]}},"k":"num_crossed"},"remote.turned_off":{"d":{"remote":{}},"k":"target","to":["off"]},"remote.turned_on":{"d":{"remote":{}},"k":"target","to":["on"]},"scene.activated":{"d":{"scene":{}},"k":"stateless"},"schedule.block_ended":{"d":{"schedule":{}},"k":"target","to":["off"]},"schedule.block_started":{"d":{"schedule":{}},"from":["off","on"],"k":"transition","to":["on"]},"siren.turned_off":{"d":{"siren":{}},"k":"target","to":["off"]},"siren.turned_on":{"d":{"siren":{}},"k":"target","to":["on"]},"sun.elevation_changed":{"d":{"sun":{"attr":"elevation"}},"k":"num_changed"},"sun.elevation_crossed_threshold":{"d":{"sun":{"attr":"elevation"}},"k":"num_crossed"},"switch.turned_off":{"d":{"input_boolean":{},"switch":{}},"k":"target","to":["off"]},"switch.turned_on":{"d":{"input_boolean":{},"switch":{}},"k":"target","to":["on"]},"temperature.changed":{"d":{"climate":{"attr":"current_temperature"},"sensor":{"dc":["temperature"]},"water_heater":{"attr":"current_temperature"},"weather":{"attr":"temperature"}},"k":"num_changed"},"temperature.crossed_threshold":{"d":{"climate":{"attr":"current_temperature"},"sensor":{"dc":["temperature"]},"water_heater":{"attr":"current_temperature"},"weather":{"attr":"temperature"}},"k":"num_crossed"},"timer.cancelled":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["cancelled"]},"timer.finished":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["finished"]},"timer.paused":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["paused"]},"timer.restarted":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["restarted"]},"timer.started":{"d":{"timer":{"attr":"last_transition"}},"k":"target","to":["started"]},"update.became_available":{"d":{"update":{}},"k":"target","to":["on"]},"vacuum.errored":{"d":{"vacuum":{}},"k":"target","to":["error"]},"vacuum.paused_cleaning":{"d":{"vacuum":{}},"k":"target","to":["paused"]},"vacuum.returned_to_dock":{"d":{"vacuum":{}},"k":"target","to":["docked"]},"vacuum.started_cleaning":{"d":{"vacuum":{}},"k":"target","to":["cleaning"]},"vacuum.started_returning":{"d":{"vacuum":{}},"k":"target","to":["returning"]},"valve.closed":{"d":{"valve":{"attr":"is_closed"}},"from":[false],"k":"transition","to":[true]},"valve.opened":{"d":{"valve":{"attr":"is_closed"}},"from":[true],"k":"transition","to":[false]},"vibration.cleared":{"d":{"binary_sensor":{"dc":["vibration"]}},"k":"target","to":["off"]},"vibration.detected":{"d":{"binary_sensor":{"dc":["vibration"]}},"k":"target","to":["on"]},"water_heater.operation_mode_changed":{"d":{"water_heater":{}},"k":"target"},"water_heater.target_temperature_changed":{"d":{"water_heater":{"attr":"temperature"}},"k":"num_changed"},"water_heater.target_temperature_crossed_threshold":{"d":{"water_heater":{"attr":"temperature"}},"k":"num_crossed"},"water_heater.turned_off":{"d":{"water_heater":{}},"k":"target","to":["off"]},"water_heater.turned_on":{"d":{"water_heater":{}},"from":["off"],"k":"origin"},"window.closed":{"d":{"binary_sensor":{"dc":["window"],"tv":"off"},"cover":{"attr":"is_closed","dc":["window"],"tv":true}},"k":"cover"},"window.opened":{"d":{"binary_sensor":{"dc":["window"],"tv":"on"},"cover":{"attr":"is_closed","dc":["window"],"tv":false}},"k":"cover"}}/* SBX_ETRIG:end */;
  // the ones with rules of their own (their trigger classes override the checks)
  const SBX_ETRIG_OWN = {
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
  // the triggers the sandbox follows; the rest it says it can't, and Run with that trigger stands in
  const SBX_PLATS = new Set(['state', 'numeric_state', 'event', 'time', 'time_pattern', 'template', 'mqtt']);
  // calls that only send or log a message: nothing for the sandbox to change
  const SBX_MSG = new Set(['notify', 'persistent_notification', 'tts', 'system_log', 'logbook', 'assist_satellite', 'telegram_bot', 'mobile_app']);
  const sbxTopic = (pat, topic) => {
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
  const flowPath = (A, B, V) => {
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
  const flowCrossings = (segs, rects) => rects.filter((o) => segs.some(([x0, y0, x1, y1]) => Math.max(x0, x1) > o.x + 2 && Math.min(x0, x1) < o.x + o.w - 2
    && Math.max(y0, y1) > o.y + 2 && Math.min(y0, y1) < o.y + o.h - 2)).length;
  // the entities a condition reads, for drawing it on the board
  const sbxReads = (c) => {
    const out = new Set();
    const walk = (v, k) => {
      if (typeof v === 'string') { if (k === 'entity_id' && EXACT_RE.test(v)) out.add(v); else (v.match(ENTITY_RE) || []).forEach((x) => out.add(x)); }
      else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, x]) => { if (kk !== 'alias') walk(x, kk); });
    };
    walk(c, '');
    return [...out].slice(0, 8);
  };
  class Sandbox {
    // o: { states (Home Assistant's, read, never written), items: [{ id, cfg }], now, tz, tpl(template, vars) → { ok, value,
    //      partly } | { ok: false, err }, ask({ text, key }) → Promise<boolean>, resolve(ref) → entity ids, fetch(id) → cfg, onLog(entry) }
    constructor(o) {
      this.o = o; this.real = o.states || {}; this.tz = o.tz; this.now = o.now == null ? Date.now() : o.now;
      this.changed = new Map(); this.items = new Map(); this.log = []; this.timers = []; this.runs = new Map();
      this.pend = new Map(); this.waiters = new Set(); this.tplLast = new Map(); this.queue = new Map();
      this.busy = 0; this.seq = 0; this.steps = 0; this.halted = false; this.n = 0;
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
    _sleep(ms, run, label) {
      return new Promise((res, rej) => {
        const t = this._at(this.now + Math.max(0, ms), () => { this.busy++; res(); }, run, label);
        t.rej = (e) => { this.busy++; rej(e); };
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
        const t = this.timers[0];
        if (!t || t.at > end) break;
        this._drop(t);
        this.now = Math.max(this.now, t.at);
        t.fn();
        await this.settle();
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
      this.items.forEach((it) => { if (it.kind === 'automation') this._trigs(it).forEach((t, i) => this._armTime(it, t, i)); });
      for (const it of this.items.values()) {
        if (it.kind !== 'automation') continue;
        const ts = this._trigs(it);
        for (let i = 0; i < ts.length; i++) {
          const t = ts[i];
          if (this._plat(t) === 'template' && t.enabled !== false) {
            const r = await this.o.tpl(String(t.value_template), this._vars(null));
            this.tplLast.set(it.id + '#' + i, r.ok ? asBool(r.value) : null);
          }
        }
      }
    }
    _trigs(it) { return toList(it.cfg.triggers != null ? it.cfg.triggers : it.cfg.trigger).filter((t) => t && typeof t === 'object'); }
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
    async userRun(id, checkConds, ti) {
      this._fresh();
      const it = this.items.get(id);
      if (!it) return;
      const t = ti != null && it.kind === 'automation' ? this._trigs(it)[ti] : null;
      let trigger = { platform: null, id: 'manual', idx: 'manual' };
      if (t) {
        const p = this._plat(t), spec = this._espec(p);
        trigger = { platform: p, id: t.id != null ? String(t.id) : String(ti), idx: String(ti) };
        const ents = p === 'state' || p === 'numeric_state' ? toList(t.entity_id) : spec ? this._etargets(t, spec) : [];
        const e = ents.find((x) => typeof x === 'string');
        if (e) { const o = this.obj(e); Object.assign(trigger, { entity_id: e, from_state: o, to_state: o }); }
        if (p === 'event') trigger.event = { event_type: toList(t.event_type)[0], data: t.event_data || {} };
        if (p === 'mqtt') Object.assign(trigger, { topic: t.topic, payload: t.payload != null ? String(t.payload) : '' });
        if (p === 'time' || p === 'time_pattern') trigger.now = this.iso();
      }
      const src = trigger.entity_id || (trigger.event ? 'event:' + trigger.event.event_type : trigger.topic ? 'mqtt:' + trigger.topic : null)
        || (t && toList(t.entity_id).find((x) => typeof x === 'string' && EXACT_RE.test(x))) || null;
      const cause = this._log({ kind: 'trigger', key: id, text: t ? T('sbx_run_as', { n: ti + 1, p: this._plat(t) }) : T('sbx_run_by_you'), by: 'you', src });
      this._start(it, { trigger }, cause, { conds: checkConds });
      await this.settle();
    }
    // a service call made by you (a kept test button, say): done on the sandbox like one in a script
    async userCall(svc, data, ids) {
      this._fresh();
      const run = { item: { id: null, cfg: {}, kind: 'script' }, vars: {}, cause: null, timers: new Set(), done: false };
      await new Promise((r) => { this._task(async () => { try { await this._call(svc, { action: svc, data: data || {}, target: { entity_id: ids } }, run); } finally { r(); } }); });
      await this.settle();
    }
    // ---- states and events
    async setState(id, state, attrs, cause, byYou) {
      const old = this.get(id), was = old ? old.state : null;
      const A = Object.assign({}, old ? old.attributes : {}, attrs || {});
      // a cover's opened and closed triggers read is_closed
      if (id.startsWith('cover.') && !(attrs && 'is_closed' in attrs) && ['open', 'closed', 'opening', 'closing'].includes(state)) A.is_closed = state === 'closed';
      const sameAttrs = canon(A) === canon(old ? old.attributes : {});
      if (old && was === state && sameAttrs) {
        if (byYou) this._log({ kind: 'note', key: id, text: T('sbx_already', { name: this._name(id), state }) });
        return null;
      }
      const nu = { state, attributes: A, last_changed: was === state && old ? old.last_changed : this.iso(), last_updated: this.iso() };
      this.changed.set(id, nu);
      const lid = this._log({ kind: 'state', key: id, from: was, to: state, cause, by: byYou ? 'you' : null });
      await this._onState(id, old, nu, lid);
      return lid;
    }
    async fireEvent(type, data, cause, byYou) {
      const lid = this._log({ kind: 'event', key: 'event:' + type, text: type, data, cause, by: byYou ? 'you' : null });
      const ev = { event_type: type, data: data || {} };
      for (const it of this.items.values()) {
        if (it.kind !== 'automation' || !this._on(it)) continue;
        this._trigs(it).forEach((t, i) => {
          if (t.enabled === false || this._plat(t) !== 'event') return;
          if (!toList(t.event_type).includes(type) || !subsetOf(t.event_data, data)) return;
          this._fire(it, i, { platform: 'event', event: ev }, lid);
        });
      }
      [...this.waiters].forEach((w) => w.onEvent && w.onEvent(ev, lid));
      return lid;
    }
    // an MQTT message: the triggers on its topic (+ and # wildcards), and a publish in a script reaches them too
    async _mqttMatch(t, msg) {
      if (!t.topic || !sbxTopic(t.topic, msg.topic)) return false;
      if (t.payload == null) return true;
      let v = msg.payload;
      if (t.value_template) { const r = await this.o.tpl(String(t.value_template), { value: msg.payload, value_json: msg.payload_json }); v = r.ok ? r.value : undefined; }
      return String(v) === String(t.payload);
    }
    async mqtt(topic, payload, cause, byYou) {
      const text = typeof payload === 'string' ? payload : payload == null ? '' : JSON.stringify(payload);
      let pj = null;
      try { pj = JSON.parse(text); } catch (e) { /* not JSON */ }
      const msg = { topic: String(topic), payload: text, payload_json: pj, qos: 0 };
      const lid = this._log({ kind: 'mqtt', key: 'mqtt:' + msg.topic, text: msg.topic, payload: text, cause, by: byYou ? 'you' : null });
      for (const it of this.items.values()) {
        if (it.kind !== 'automation' || !this._on(it)) continue;
        const ts = this._trigs(it);
        for (let i = 0; i < ts.length; i++) {
          if (ts[i].enabled !== false && this._plat(ts[i]) === 'mqtt' && await this._mqttMatch(ts[i], msg)) this._fire(it, i, Object.assign({ platform: 'mqtt' }, msg), lid);
        }
      }
      [...this.waiters].forEach((w) => w.onMqtt && w.onMqtt(msg, lid));
      return lid;
    }
    async userMqtt(topic, payload) {
      this._fresh();
      this._task(() => this.mqtt(topic, payload, null, true));
      await this.settle();
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
        const r = await this.o.tpl(String(t.value_template), Object.assign(this._vars(run), { state: this.obj(id) }));
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
          }
        }
      }
      [...this.waiters].forEach((w) => w.onState && w.onState(id, old, nu, lid));
    }
    // ---- Home Assistant's per-entity triggers, by the rules of its trigger classes
    _espec(p) { return typeof p === 'string' ? SBX_ETRIG_OWN[p] || SBX_ETRIG[p] || null : null; }
    _etargets(t, spec) {
      const tg = t.target || {}, out = new Set(), direct = new Set();
      toList(tg.entity_id).forEach((x) => { if (typeof x === 'string' && EXACT_RE.test(x)) { out.add(x); direct.add(x); } });
      ['area_id', 'floor_id', 'label_id', 'device_id'].forEach((k) => toList(tg[k]).forEach((x) => {
        if (typeof x === 'string' && this.o.resolve) this.o.resolve((k === 'device_id' ? 'device' : k.slice(0, -3)) + ':' + x).forEach((e) => out.add(e));
      }));
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
      if (t.for == null) { this._fire(it, i, vars, lid); return; }
      let ms = durMs(t.for);
      if (ms == null && TPL_RE.test(String(t.for))) { const r = await this.o.tpl(String(t.for), this._vars(null)); ms = r.ok ? durMs(r.value) : null; }
      if (ms == null && typeof t.for === 'object') { const r = await this._render(t.for, null); ms = durMs(r); }
      if (ms == null) ms = 0;
      vars.for = fmtDur(ms);
      const timer = this._at(this.now + ms, () => { this.pend.delete(key); this._task(() => this._fire(it, i, vars, lid)); }, null, T('sbx_for_label', { name: this._name(it.id), d: fmtDur(ms) }), it.id);
      this.pend.set(key, { id, timer, still });
    }
    async _tplTrig(it, i, t, lid) {
      const k = it.id + '#' + i, r = await this.o.tpl(String(t.value_template), this._vars(null));
      const v = r.ok ? asBool(r.value) : null, was = this.tplLast.get(k), pk = 'tpl:' + k;
      this.tplLast.set(k, v);
      // with for:, it must stay true that long; false again lets the wait go
      if (v !== true) { const p = this.pend.get(pk); if (p) { this._drop(p.timer); this.pend.delete(pk); } return; }
      if (was !== false) return;
      const vars = { platform: 'template', entity_id: null };
      let ms = t.for != null ? durMs(typeof t.for === 'object' ? t.for : TPL_RE.test(String(t.for)) ? (await this.o.tpl(String(t.for), {})).value : t.for) : null;
      if (ms == null || ms <= 0) { this._fire(it, i, vars, lid, r.partly); return; }
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
      const H = f(h, '*'), M = f(mi, '*'), S = f(s, '*'), off = tzOffset(from, this.tz);
      let w = Math.floor((from + off) / 1000) * 1000 + 1000;
      for (let i = 0; i < 200000; i++, w += 1000) {
        const d = new Date(w);
        if (!H(d.getUTCHours())) { w += (3599 - d.getUTCMinutes() * 60 - d.getUTCSeconds()) * 1000; continue; }
        if (!M(d.getUTCMinutes())) { w += (59 - d.getUTCSeconds()) * 1000; continue; }
        if (S(d.getUTCSeconds())) return w - off;
      }
      return null;
    }
    // ---- runs
    _name(id) { return this.o.name ? this.o.name(id) : id; }
    _vars(run) { return run ? Object.assign({}, run.vars) : {}; }
    _active(id) { return (this.runs.get(id) || []).filter((r) => !r.done); }
    running(id) { return this._active(id).length > 0; }
    _fire(it, i, tv, cause, partly) {
      const t = this._trigs(it)[i] || {};
      const trigger = Object.assign({ id: t.id != null ? String(t.id) : String(i), idx: String(i) }, tv);
      const lid = this._log({ kind: 'trigger', key: it.id, text: this._trigText(t, trigger), ent: trigger.entity_id || null, to: trigger.to_state ? trigger.to_state.state : null, cause, partly });
      this._start(it, { trigger }, lid, { conds: true });
    }
    _trigText(t, tv) {
      const p = this._plat(t);
      if (p === 'state' || p === 'numeric_state') return T('sbx_trig_state', { name: this._name(tv.entity_id), state: tv.to_state ? tv.to_state.state : '' });
      if (p === 'event') return T('sbx_trig_event', { type: tv.event.event_type });
      if (p === 'time' || p === 'time_pattern') return T('sbx_trig_time');
      if (p === 'template') return T('sbx_trig_template');
      return String(p || '');
    }
    _start(it, vars, cause, opt) {
      const cfg = it.cfg, mode = cfg.mode || 'single', max = cfg.max || 10, act = this._active(it.id);
      if (act.length) {
        if (mode === 'single') { this._log({ kind: 'note', key: it.id, cause, text: T('sbx_single', { name: this._name(it.id) }) }); return null; }
        if (mode === 'restart') act.forEach((r) => { this._cancel(r); this._log({ kind: 'note', key: it.id, cause, text: T('sbx_restart') }); });
        else if (act.length >= max) { this._log({ kind: 'note', key: it.id, cause, warn: true, text: T('sbx_max', { mode, max }) }); return null; }
        else if (mode === 'queued') {
          const q = this.queue.get(it.id) || [];
          q.push([vars, cause, opt]); this.queue.set(it.id, q);
          this._log({ kind: 'note', key: it.id, cause, text: T('sbx_queued') });
          return null;
        }
      }
      const run = { item: it, vars: Object.assign({ this: this.obj(it.id) }, vars), cause, timers: new Set(), done: false, cancelled: false };
      const list = this.runs.get(it.id) || [];
      list.push(run); this.runs.set(it.id, list);
      const p = this._task(() => this._run(run, opt || {}));
      run.promise = p;
      return run;
    }
    _cancel(run) {
      if (run.done) return;
      run.cancelled = true;
      [...run.timers].forEach((t) => { this._drop(t); if (t.rej) t.rej(SBX_CANCEL); });
      [...this.waiters].forEach((w) => { if (w.run === run) { this.waiters.delete(w); w.rej(SBX_CANCEL); } });
    }
    async _run(run, opt) {
      const it = run.item, cfg = it.cfg;
      let outcome = 'finished', why = '';
      try {
        if (it.kind === 'automation') {
          if (cfg.variables) Object.assign(run.vars, await this._render(cfg.variables, run));
          if (opt.conds !== false) {
            const cs = toList(cfg.conditions != null ? cfg.conditions : cfg.condition);
            for (const c of cs) {
              const r = await this._condStep(c, run);
              if (!r.ok) { outcome = 'stopped'; why = T('sbx_cond_stopped'); return; }
            }
          }
          await this._seq(toList(cfg.actions != null ? cfg.actions : cfg.action), run);
        } else {
          if (cfg.variables) Object.assign(run.vars, await this._render(cfg.variables, run));
          await this._seq(toList(cfg.sequence), run);
        }
      } catch (e) {
        if (e === SBX_CANCEL) { outcome = 'cancelled'; }
        else if (e === SBX_COND_FAIL) { outcome = 'stopped'; why = T('sbx_cond_stopped'); }
        else if (e && e.stop) { outcome = e.error ? 'error' : 'stopped'; why = e.text || ''; }
        else { outcome = 'error'; why = (e && e.message) || String(e); }
      } finally {
        run.done = true;
        const list = (this.runs.get(it.id) || []).filter((r) => r !== run);
        this.runs.set(it.id, list);
        if (outcome !== 'cancelled' || !this.halted) this._log({ kind: 'run', key: it.id, outcome, why, cause: run.cause });
        const q = this.queue.get(it.id);
        if (q && q.length && !this.halted) { const [v, c, o] = q.shift(); this._start(it, v, c, o); }
        if (run.onDone) run.onDone(outcome);
      }
    }
    // ---- templates and conditions
    async _tpl(s, run) {
      const r = await this.o.tpl(String(s), this._vars(run));
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
      const r = await this._cond(c, run);
      this._log({ kind: 'cond', key: run.item.id, ok: r.ok, text: this.o.condText ? this.o.condText(c) : '', why: r.why || '', partly: r.partly, cause: run.cause, ents: sbxReads(c) });
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
          if (r.ok !== want) return { hit: true, r, partly };
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
        case 'trigger': {
          const id = run.vars.trigger ? String(run.vars.trigger.id) : null;
          const ok = toList(c.id).map(String).includes(id);
          return { ok, why: ok ? '' : T('sbx_trig_was', { id: id == null ? '—' : id }) };
        }
        default: {
          const a = await this._ask({ text: T('sbx_ask_cond', { c: this.o.condText ? this.o.condText(c) : String(type) }), run });
          return { ok: !!a, why: T('sbx_you_said', { a: a ? T('sbx_true') : T('sbx_false') }) };
        }
      }
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
      try { await this._act1(a, run); } catch (e) {
        if (e === SBX_CANCEL || e === SBX_COND_FAIL || (e && e.stop)) throw e;
        if (a.continue_on_error) { this._log({ kind: 'note', key: run.item.id, cause: run.cause, text: T('sbx_err_continue', { e: (e && e.message) || String(e) }) }); return; }
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
          if (r.ok) return this._seq(opt.sequence, run);
        }
        if (a.default) return this._seq(a.default, run);
        return;
      }
      if (a.if !== undefined) {
        const r = await this._conds(a.if, run);
        if (r.ok) return this._seq(a.then, run);
        if (a.else) return this._seq(a.else, run);
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
      if (a.scene !== undefined) { this._log({ kind: 'call', key: run.item.id, cause: run.cause, svc: 'scene.turn_on', ents: [String(a.scene)], unknown: true }); return; }
      if (a.device_id && a.domain && a.type) { this._log({ kind: 'call', key: run.item.id, cause: run.cause, svc: T('sbx_device_act', { type: a.type }), ents: ['device:' + a.device_id], unknown: true }); return; }
      if (a.set_conversation_response !== undefined) return;
      this._log({ kind: 'note', key: run.item.id, cause: run.cause, text: T('sbx_unknown_step', { k: Object.keys(a).join(', ') }) });
    }
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
      const cid = this._log({ kind: 'call', key: run.item.id, cause: run.cause, svc, ents: dom === 'script' && !['turn_on', 'turn_off', 'toggle'].includes(s) ? ['script.' + s] : ents });
      const entry = this.log[this.log.length - 1];
      // scripts: called directly, the caller waits; started with script.turn_on, it doesn't
      if (dom === 'script') {
        if (s === 'turn_off') { ents.forEach((e) => this._active(e).forEach((r) => this._cancel(r))); return; }
        const ids = ['turn_on', 'toggle'].includes(s) ? ents : ['script.' + s];
        for (const id of ids) {
          let it = this.items.get(id);
          if (!it && this.o.fetch) { this.add(id, await this.o.fetch(id)); it = this.items.get(id); }
          if (!it) { entry.unknown = true; continue; }
          const vars = Object.assign({}, s === 'turn_on' ? (data.variables || {}) : data);
          const r = this._start(it, vars, cid, {});
          if (r && !['turn_on', 'toggle'].includes(s)) await new Promise((res, rej) => { this.busy--; r.onDone = (o) => { this.busy++; if (o === 'error') rej(new Error(T('sbx_script_failed', { name: this._name(id) }))); else res(); }; });
        }
        return;
      }
      if (svc === 'automation.trigger') {
        ents.forEach((id) => { const it = this.items.get(id); if (it) this._start(it, { trigger: { platform: null, id: 'trigger', idx: 'trigger' } }, cid, { conds: data.skip_condition === false }); else entry.unknown = true; });
        return;
      }
      if (dom === 'timer') { for (const id of ents) await this._timer(id, s, data, cid); return; }
      if (svc === 'mqtt.publish') { await this.mqtt(data.topic, data.payload != null ? data.payload : data.payload_template, cid); return; }
      if (SBX_MSG.has(dom)) { entry.msg = true; if (this.o.onLog) this.o.onLog(entry, true); return; }
      let known = ents.length > 0;
      for (const id of ents) {
        const ed = id.split('.')[0], sv = generic ? ((HA_GENERIC[ed] || {})[s] || s) : s;
        const eff = sbxEffect(ed, sv, this.get(id), data, this.iso());
        if (!eff) { known = false; continue; }
        await this.setState(id, eff[0] == null ? (this.get(id) || {}).state : eff[0], eff[1], cid);
      }
      if (!known) entry.unknown = true;
      if (this.o.onLog && entry.unknown) this.o.onLog(entry, true);
    }
    async _timer(id, s, d, cid) {
      const cur = this.get(id) || { state: 'idle', attributes: {} }, A = cur.attributes || {};
      const key = 'timer:' + id;
      const clear = () => this.timers.filter((x) => x.slot === key).forEach((x) => this._drop(x));
      const finish = async (ev) => { clear(); await this.setState(id, 'idle', { finishes_at: null, remaining: '0:00:00' }, cid); await this.fireEvent(ev, { entity_id: id }, cid); };
      if (s === 'start' || s === 'change') {
        let ms = durMs(d.duration != null ? d.duration : s === 'start' && cur.state === 'paused' ? A.remaining : A.duration);
        if (s === 'change') { const left = A.finishes_at ? Date.parse(A.finishes_at) - this.now : 0; ms = left + (ms || 0); }
        if (ms == null) ms = 0;
        clear();
        const at = this.now + ms;
        await this.setState(id, 'active', { finishes_at: this.iso(at), remaining: fmtDur(ms) }, cid);
        this._at(at, () => this._task(async () => { await this.setState(id, 'idle', { finishes_at: null, remaining: '0:00:00' }, cid); await this.fireEvent('timer.finished', { entity_id: id }, cid); }), null, T('sbx_timer_label', { name: this._name(id) }), id).slot = key;
        return;
      }
      if (s === 'cancel') return finish('timer.cancelled');
      if (s === 'finish') return finish('timer.finished');
      if (s === 'pause') { const left = A.finishes_at ? Date.parse(A.finishes_at) - this.now : 0; clear(); await this.setState(id, 'paused', { remaining: fmtDur(Math.max(0, left)), finishes_at: null }, cid); }
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
      const ts = toList(a.wait_for_trigger).filter((t) => t && typeof t === 'object' && t.enabled !== false), ms = a.timeout != null ? durMs(await this._render(a.timeout, run)) : null;
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
              else if (p === 'template' && this._reads(t.value_template, id)) {
                const r = await this._tpl(t.value_template, run), v = r.ok ? asBool(r.value) : null;
                if (v === true && tplWas.get(i) === false) w.res({ platform: 'template', idx: String(i), id: tid(t, i), entity_id: null });
                tplWas.set(i, v);
              }
            }
          } finally { this.busy--; }
        },
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
        w.res = (v) => { if (w.fin) return; w.fin = true; this.waiters.delete(w); if (t) this._drop(t); this.busy++; res(v); };
        Object.assign(w, mk(w));
        this.waiters.add(w);
        if (ms != null) t = this._at(this.now + ms, () => { if (!w.fin) { w.fin = true; this.waiters.delete(w); this.busy++; res(false); } }, run, label);
        this.busy--;
      });
    }
    // what changed since the start: [{ id, from, to }]
    diff() { return [...this.changed].map(([id, s]) => ({ id, from: this.real[id] ? this.real[id].state : null, to: s.state })).filter((x) => x.from !== x.to); }
  }

  /* ---------- Sandbox templates: rendered by Home Assistant, reading the sandbox's states ----------
     The template's state functions are renamed to stand-ins that read fb_s (the sandbox's states) first and the
     real ones for everything else; the clock functions read fb_t (the sandbox clock). What still reads Home
     Assistant directly is reported, so a result built partly on the real house is never passed off as the sandbox's. */
  const SBX_PRELUDE = [
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
  const SBX_FNS = ['states', 'is_state', 'state_attr', 'is_state_attr', 'has_value', 'expand', 'now', 'utcnow', 'today_at'];
  // the template with its state functions renamed; leftovers: what in it still reads Home Assistant directly
  function sbxRewrite(t) {
    let s = String(t);
    const E = '([a-z_]+\\.[a-z0-9_]+)';
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
    s = s.replace(new RegExp("(?<![\\w.])states\\s*\\[\\s*(['\"])" + E + '\\1\\s*\\]', 'g'), (m, q, id) => `fb_obj('${id}')`);
    s = s.replace(/(?<![\w.])states\.([a-z_]+)(?![\w.(])/g, (m, d) => `fb_domain('${d}')`);
    s = s.replace(/(?<![\w.])states\s*\[\s*(['"])([a-z_]+)\1\s*\]/g, (m, q, d) => `fb_domain('${d}')`);
    // calls: is_state( → fb_is_state(
    s = s.replace(new RegExp('(?<![\\w.])(' + SBX_FNS.join('|') + ')\\s*\\(', 'g'), (m, f) => `fb_${f}(`);
    // states[anything] → fb_index(anything): an entity or a domain, looked up when it renders
    const sub = /(?<![\w.'"])states\s*\[/g;
    let out = '', from = 0, m0;
    while ((m0 = sub.exec(s))) {
      let depth = 1, j = sub.lastIndex, q = null;
      for (; j < s.length && depth; j++) {
        const c = s[j];
        if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '[') depth++; else if (c === ']') depth--;
      }
      if (depth) break;
      out += s.slice(from, m0.index) + 'fb_index(' + s.slice(sub.lastIndex, j - 1) + ')';
      from = j; sub.lastIndex = j;
    }
    s = out + s.slice(from);
    // every state at once: states | ..., for x in states
    s = s.replace(/(?<![\w.'"])states(?![\w(.[])/g, 'fb_all()');
    const left = new Set();
    if (/(?<![\w.'"])states(?![\w(])/.test(s)) left.add('states');
    ['closest', 'distance', 'state_translated', 'device_attr', 'is_device_attr'].forEach((f) => { if (new RegExp('(?<![\\w.])' + f + '\\b').test(s)) left.add(f); });
    if (/\|\s*(closest|state_translated)\b/.test(s)) left.add('filter');
    return { text: s, leftovers: [...left] };
  }

  class FunctionsBoard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._init();
      this._flushNow = () => { if (document.visibilityState !== 'visible') this._flushSave(); };
      this._winKeyFn = (e) => this._winKey(e);
    }
    // the state of a fresh page; _relang starts from it again
    _init() {
      this._data = null; this._model = null;
      this._labels = []; this._ents = []; this._devs = [];
      this._entMap = new Map(); this._devMap = new Map(); this._labelMap = new Map(); this._regIdMap = new Map();
      this._view = { x: 40, y: 40, k: 1 };
      this._sel = null; this._focus = null; this._focusEdges = new Set(); this._els = new Map();
      this._drag = null; this._pointers = new Map(); this._live = new Map(); this._prev = new Map();
      this._drawer = null; this._capture = null; this._runs = []; this._errKeys = new Set(); this._pick = new Set();
      this._unsubs = []; this._timers = {}; this._token = 0; this._booting = false;
      this._watch = new Map(); this._cfgCache = new Map(); this._toastActs = [];
      this._undoStack = []; this._redoStack = [];
      this._tgt = new Map(); this._src = new Map();
      // developer tools (Phase 9): simulated states, trigger watches, check results, monitors, the debugger
      this._sim = new Map(); this._tw = new Map(); this._cond = new Map(); this._liveE = new Map();
      this._monSubs = new Map(); this._monData = new Map(); this._monCount = new Map();
      this._testLog = []; this._testOk = false; this._dbg = null; this._dbgSeq = 0; this._lit = null;
    }
    // the user picked another language (4.9): stop what runs, save what is pending, and build the page again
    // as on a fresh visit. What Home Assistant set and Undo's steps stay; everything else starts over.
    _relang() {
      this._flushSave(); this._unsubscribe(); this._listen(false);
      if (this._ro) this._ro.disconnect();
      Object.values(this._timers).forEach((t) => clearTimeout(t));
      if (this._raf) cancelAnimationFrame(this._raf);
      const keep = new Set(['_hass', '_config', '_panelObj', '_route', '_narrow', '_isPanel', '_layoutMode',
        '_flushNow', '_winKeyFn', '_rootOn']);
      const undo = this._undoStack, redo = this._redoStack;
      Object.keys(this).forEach((k) => { if (k.startsWith('_') && !keep.has(k)) delete this[k]; });
      this._init();
      this._undoStack = undo; this._redoStack = redo;
    }

    setConfig(config) { this._config = config || {}; }
    getCardSize() { return 12; }
    static getStubConfig() { return {}; }

    set hass(hass) {
      this._hass = hass;
      setLang(hass.language);
      // the user picked another language in their profile: start the page again in it (4.9)
      if (this._$ && this._lang !== LANG && !this._booting) this._relang();
      if (!this._$) this._build();
      if (hass.user && !hass.user.is_admin) { this._renderNoAdmin(); return; }
      if (!this._data) { if (!this._booting) this._boot(); return; }
      this._throttle('states', 1000, () => this._refreshStates());
    }
    get hass() { return this._hass; }
    // set by Home Assistant when this runs as the integration's sidebar page
    set panel(p) { this._panelObj = p; this._applyMode(); }
    get panel() { return this._panelObj; }
    set narrow(v) { this._narrow = !!v; this._applyMode(); }
    get narrow() { return this._narrow; }
    // in the sidebar page each function has its own address, /functions/<label id>, so Back and links work (4.2)
    set route(r) { this._route = r; if (this._data && !this._booting && this._mode() === 'panel') this._followRoute(); }
    get route() { return this._route; }
    // set by Home Assistant when this runs as a dashboard card
    set isPanel(v) { this._isPanel = !!v; this._applyMode(); }
    get isPanel() { return this._isPanel; }
    set layout(v) { this._layoutMode = v; this._applyMode(); }
    get layout() { return this._layoutMode; }
    getGridOptions() { return { columns: 'full' }; }
    _mode() { return this._panelObj ? 'panel' : (this._isPanel || this._layoutMode === 'panel') ? 'view' : 'card'; }
    _applyMode() {
      if (!this._$) return;
      const b = this._$.board, mode = this._mode();
      ['m-panel', 'm-view', 'm-card'].forEach((c) => b.classList.toggle(c, c === 'm-' + mode));
      b.classList.toggle('narrow', !!this._narrow);
      const hint = this._$.cardhint;
      if (hint) hint.hidden = mode !== 'card' || !!(this._data && this._data.ui.hintOff);
    }
    _renderNoAdmin() {
      if (this._noAdmin) return;
      this._noAdmin = true;
      this._$.board.innerHTML = `<div class="noadmin"><ha-icon icon="mdi:shield-account-outline"></ha-icon><b>${T('the_functions_board_needs_an')}</b><span>${T('it_reads_automation_and_script')}</span></div>`;
    }

    connectedCallback() {
      if (this._data) {
        this._subscribe();
        // back on the page: the open function's monitors listen again, and an open debugger records again
        if (this._model) { this._startMonitors(); this._afterOpen(this._model.label); }
        if (this._drawer && this._drawer.mode === 'debug' && this._dbg && !this._dbg.rec) this._dbgStart();
        this._resumeCapture();
      }
      if (this._ro && this._$) this._ro.observe(this._$.board);
      window.addEventListener('pagehide', this._flushNow);
      document.addEventListener('visibilitychange', this._flushNow);
      window.addEventListener('keydown', this._winKeyFn);
    }
    disconnectedCallback() {
      window.removeEventListener('keydown', this._winKeyFn);
      // Home Assistant removes the page when another sidebar entry opens: stop everything that keeps running
      this._unsubscribe(); this._listen(false);
      if (this._ro) this._ro.disconnect();
      window.removeEventListener('pagehide', this._flushNow);
      document.removeEventListener('visibilitychange', this._flushNow);
      this._flushSave();
    }

    /* ---------- small utilities ---------- */
    _ws(msg) { return this._hass.callWS(msg); }
    _debounce(name, ms, fn) { clearTimeout(this._timers[name]); this._timers[name] = setTimeout(fn, ms); }
    _throttle(name, ms, fn) {
      const k = 't:' + name;
      if (this._timers[k]) return;
      this._timers[k] = setTimeout(() => { this._timers[k] = null; fn(); }, ms);
    }
    async _loadData() {
      // The integration stores functions and layouts for everyone; without it they live in this user's data.
      let r = null;
      try { r = await this._ws({ type: 'functions_board/get' }); } catch (e) { r = null; }
      const ud = await this._ws({ type: 'frontend/get_user_data', key: STORE }).catch(() => null);
      const legacy = (ud && ud.value) || {};
      if (!r) { this._storeMode = 'user'; this._fbMode = 'organise'; return legacy; }
      this._storeMode = 'shared';
      // v0.4 integrations keep a revision per layout and take one layout per write; older ones take the whole store
      this._perLayout = !!r.revs;
      this._revs = Object.assign({}, r.revs || {});
      this._fbMode = r.mode === 'full' ? 'full' : 'organise';
      let shared = (r && r.data) || {};
      const uiData = await this._ws({ type: 'frontend/get_user_data', key: STORE + '_ui' }).catch(() => null);
      if (!Array.isArray(shared.functions) && (Array.isArray(legacy.functions) || legacy.layouts)) {
        shared = { v: 1, functions: legacy.functions || [], layouts: legacy.layouts || {} };
        await this._ws({ type: 'functions_board/set', data: shared, client: this._client() }).catch(() => {});
        this._revs = {};
        Object.keys(shared.layouts || {}).forEach((k) => { this._revs[k] = 1; });
        this._migrated = true;
      }
      return { functions: shared.functions || [], layouts: shared.layouts || {}, ui: (uiData && uiData.value && uiData.value.ui) || legacy.ui || {} };
    }
    _client() { if (!this._cid) this._cid = uid() + uid(); return this._cid; }
    _full() { return this._fbMode === 'full'; }
    _sharedJson() { return JSON.stringify({ v: 1, functions: this._data.functions, layouts: this._data.layouts }); }
    _uiJson() { return JSON.stringify({ ui: this._data.ui }); }
    _markSaved(part) {
      // remember what is already stored, so opening a board or applying another board's change writes nothing
      if (!part || part === 'shared') {
        this._lastShared = this._sharedJson();
        this._lastFns = JSON.stringify(this._data.functions);
        this._lastLayouts = new Map(Object.entries(this._data.layouts).map(([k, L]) => [k, JSON.stringify(L)]));
      }
      if (!part || part === 'ui') this._lastUi = this._uiJson();
      if (!part) this._lastUser = JSON.stringify(this._data);
    }
    _save() {
      if (!this._data) return;
      this._savePending = true;
      this._debounce('save', 700, () => this._doSave());
    }
    // a change made just before the tab closes or the page is left still gets written
    _flushSave() {
      if (!this._savePending || !this._data) return;
      clearTimeout(this._timers.save);
      this._doSave();
    }
    _doSave() {
      this._savePending = false;
      // one write at a time, each looking at the data as it is when its turn comes
      this._saveChain = (this._saveChain || Promise.resolve()).then(() => this._writeNow()).catch((e) => {
        this._lastShared = this._lastUi = this._lastUser = this._lastFns = null;
        this._lastLayouts = new Map();  // retry everything on the next save
        this._toast(T('could_not_save_the_layout', { message: e.message || e.code }));
      });
      return this._saveChain;
    }
    async _writeNow() {
      const d = this._data, jobs = [];
      if (this._storeMode === 'shared') {
        const uj = this._uiJson();
        if (uj !== this._lastUi) { this._lastUi = uj; jobs.push(this._ws({ type: 'frontend/set_user_data', key: STORE + '_ui', value: JSON.parse(uj) })); }
        if (this._perLayout) {
          // only what changed: the functions list, and each layout on its own with its revision
          const fj = JSON.stringify(d.functions);
          if (fj !== this._lastFns) { this._lastFns = fj; jobs.push(this._ws({ type: 'functions_board/set_functions', functions: d.functions, client: this._client() })); }
          const labels = new Set([...Object.keys(d.layouts), ...this._lastLayouts.keys()]);
          labels.forEach((label) => {
            const L = d.layouts[label], j = L ? JSON.stringify(L) : null;
            const was = this._lastLayouts.has(label) ? this._lastLayouts.get(label) : null;
            if (j !== was) jobs.push(this._writeLayout(label, j, was));
          });
        } else {
          const sj = this._sharedJson();
          if (sj !== this._lastShared) { this._lastShared = sj; jobs.push(this._ws({ type: 'functions_board/set', data: JSON.parse(sj), client: this._client() })); }
        }
      } else {
        const all = JSON.stringify(d);
        if (all !== this._lastUser) { this._lastUser = all; jobs.push(this._ws({ type: 'frontend/set_user_data', key: STORE, value: d })); }
      }
      await Promise.all(jobs);
    }
    async _writeLayout(label, j, was) {
      if (j == null) this._lastLayouts.delete(label); else this._lastLayouts.set(label, j);
      let r;
      try {
        r = await this._ws({ type: 'functions_board/set_layout', label, layout: j == null ? null : JSON.parse(j), rev: this._revs[label] || 0, client: this._client() });
      } catch (e) {
        if (was == null) this._lastLayouts.delete(label); else this._lastLayouts.set(label, was);
        throw e;
      }
      if (r && r.conflict) {
        // another board saved this function's layout since this one loaded it: its version wins
        this._revs[label] = r.rev;
        this._takeRemoteLayout(label, r.layout);
        this._toast(T('was_rearranged_on_another_board', { fnName: this._fnName(label) }));
        if (this._model && this._model.label === label) { this._place(); this._render(); }
      } else if (r && r.rev != null) this._revs[label] = r.rev;
    }
    _takeRemoteLayout(label, layout) {
      if (layout) { this._data.layouts[label] = cleanLayout(layout); this._lastLayouts.set(label, JSON.stringify(this._data.layouts[label])); }
      else { delete this._data.layouts[label]; this._lastLayouts.delete(label); }
    }
    async _onShared(msg) {
      // another open board (another admin, or this admin on another device) saved: take its changes
      const d = msg || {};
      if (this._storeMode !== 'shared' || !this._data) return;
      if (d.what === 'mode') { this._fbMode = d.mode === 'full' ? 'full' : 'organise'; this._$.board.classList.toggle('full', this._fbMode === 'full'); this._renderHeader(); this._renderNodebar(); return; }
      if (d.client && d.client === this._client()) return;
      // another board read Node-RED: one showing older flows takes the new ones (only with Node-RED switched on)
      if (d.what === 'versions') { if (this._drawer && this._drawer.mode === 'versions' && d.label === this._data.ui.current) this._renderVersions(); return; }
      if (d.what === 'nodered') {
        if (this._data.ui.nodered === true && this._nrCache && this._nrCache.need && this._model) { this._nrCache = null; this._open(this._model.label, true).then(() => this._renderLegend()); }
        return;
      }
      const act = this.shadowRoot.activeElement;
      if (this._drag || (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName))) {
        // finish what's in hand first; pick the change up shortly after
        clearTimeout(this._timers.remote);
        this._timers.remote = setTimeout(() => this._onShared({ what: 'all' }), 1500);
        return;
      }
      try {
        const r = await this._ws({ type: 'functions_board/get' });
        const s2 = (r && r.data) || {}, revs = (r && r.revs) || {};
        if (r && r.mode) this._fbMode = r.mode === 'full' ? 'full' : 'organise';
        const fns = Array.isArray(s2.functions) ? s2.functions.filter((f) => typeof f === 'string') : [];
        if (JSON.stringify(this._data.functions) === this._lastFns || !this._perLayout) { this._data.functions = fns; this._lastFns = JSON.stringify(fns); }
        const remote = s2.layouts && typeof s2.layouts === 'object' ? s2.layouts : {};
        const labels = new Set([...Object.keys(remote), ...Object.keys(this._data.layouts)]);
        labels.forEach((label) => {
          // a layout with a change of this board's own still waiting to be saved keeps it
          const mine = this._data.layouts[label] ? JSON.stringify(this._data.layouts[label]) : null;
          const synced = this._lastLayouts.has(label) ? this._lastLayouts.get(label) : null;
          if (mine !== synced && this._perLayout) return;
          this._takeRemoteLayout(label, remote[label]);
          this._revs[label] = revs[label] || 0;
        });
        this._lastShared = this._sharedJson();
        this._renderList();
        if (this._data.ui.current && this._data.functions.includes(this._data.ui.current)) this._open(this._data.ui.current, true);
      } catch (e) { /* keep what we have */ }
    }
    _viewKey(label) { return label + '|' + this._mode() + (this._compact ? '|narrow' : ''); }
    _viewFor(label) {
      // pan and zoom are per person and per board size (sidebar page, dashboard card, phone);
      // layouts from v0.2 kept one wide-screen view in the shared layout
      const u = this._data.ui, old = this._data.layouts[label] && this._data.layouts[label].view;
      return (u.views && u.views[this._viewKey(label)]) || (!this._compact && this._mode() !== 'card' && old) || null;
    }
    _layout(label) {
      if (this._ver && this._ver.label === label) return this._ver.layout;
      const all = this._data.layouts;
      if (!all[label]) all[label] = { nodes: {}, frames: [], notes: [], view: null, categories: null };
      const L = all[label];
      L.nodes = L.nodes || {}; L.frames = L.frames || []; L.notes = L.notes || [];
      return L;
    }
    _fnName(label) { const l = this._labelMap.get(label); return l ? l.name : label; }
    _known(x) {
      if (this._hass.states[x] || this._entMap.has(x)) return x;
      return this._regIdMap.get(x) || null;
    }
    // acts: [{ text, fn }] buttons such as Undo or Go there; a toast with buttons stays up longer
    _toast(msg, acts) {
      const t = this._$.toast;
      this._toastActs = acts || [];
      t.innerHTML = `<span>${esc(msg)}</span>` + this._toastActs.map((a, i) => `<button data-act="toast-act" data-i="${i}">${esc(a.text)}</button>`).join('');
      t.hidden = false;
      this._debounce('toast', this._toastActs.length ? 9000 : 4500, () => { t.hidden = true; this._toastActs = []; });
    }
    _fatal(e) {
      console.error('functions-board', e);
      this._$.empty.hidden = false;
      this._$.empty.innerHTML = `<div><b>${T('the_functions_board_couldn_t')}</b><br>${esc((e && (e.message || e.code)) || e)}</div>`;
    }
    _twoStep(el, text, fn) {
      if (el.dataset.confirm) { delete el.dataset.confirm; el.innerHTML = el._orig; fn(); return; }
      el.dataset.confirm = '1'; el._orig = el.innerHTML; el.innerHTML = `<span>${esc(text)}</span>`;
      setTimeout(() => { if (el.dataset.confirm) { delete el.dataset.confirm; el.innerHTML = el._orig; } }, 4000);
    }

    /* ---------- skeleton ---------- */
    _build() {
      const r = this.shadowRoot;
      this._lang = LANG;
      r.innerHTML = `<style>${STYLE}</style>
<div class="board">
  <aside class="list"></aside>
  <div class="scrim" data-act="togglelist"></div>
  <section class="main">
    <header class="bar">
      <button class="ib hamenu" data-act="hamenu" title="${T('home_assistant_menu')}"><ha-icon icon="mdi:menu"></ha-icon></button>
      <button class="ib" data-act="togglelist" title="${T('show_or_hide_the_list')}"><ha-icon icon="mdi:format-list-bulleted"></ha-icon></button>
      <div class="title"></div>
      <div class="tools" role="toolbar" aria-label="${T('function_tools')}">
        <button data-act="new-automation" title="${T('new_automation_in_this_function')}"><ha-icon icon="mdi:robot-outline"></ha-icon><span>${T('automation')}</span></button>
        <button data-act="new-script" title="${T('new_script_in_this_function')}"><ha-icon icon="mdi:script-text-outline"></ha-icon><span>${T('script')}</span></button>
        <button data-act="new-helper" title="${T('new_helper_in_this_function')}"><ha-icon icon="mdi:tune-variant"></ha-icon><span>${T('helper')}</span></button>
        <button data-act="add-existing" title="${T('bring_automations_scripts_helpers_or')}"><ha-icon icon="mdi:link-variant-plus"></ha-icon><span>${T('existing')}</span></button>
        <span class="sep"></span>
        <button class="ib" data-act="undo" title="${T('undo')}" disabled><ha-icon icon="mdi:undo"></ha-icon></button>
        <button class="ib" data-act="redo" title="${T('redo')}" disabled><ha-icon icon="mdi:redo"></ha-icon></button>
        <button class="sec" data-act="frame" title="${T('draw_a_frame_to_group')}"><ha-icon icon="mdi:selection"></ha-icon><span>${T('frame')}</span></button>
        <button class="sec" data-act="note" title="${T('add_a_note')}"><ha-icon icon="mdi:note-plus-outline"></ha-icon><span>${T('note')}</span></button>
        <button class="sec" data-act="arrange" title="${T('auto_arrange_resets_positions_you')}"><ha-icon icon="mdi:auto-fix"></ha-icon><span>${T('arrange')}</span></button>
        <button class="sec" data-act="hl" title="${T('arrows_what_lights_up_around')}"><ha-icon icon="mdi:vector-polyline"></ha-icon><span>${T('arrows')}</span></button>
        <span class="sep"></span>
        <button class="sec" data-act="runs" title="${T('every_run_of_every_automation')}"><ha-icon icon="mdi:timeline-clock-outline"></ha-icon><span>${T('runs')}</span></button>
        <button class="sec" data-act="debug" title="${T('debugger_what_happens_in_this')}"><ha-icon icon="mdi:bug-outline"></ha-icon><span>${T('debug_2')}</span></button>
        <button class="sec" data-act="sandbox" title="${T('sbx_button_t')}"><ha-icon icon="mdi:flask-outline"></ha-icon><span>${T('sbx_button')}</span></button>
        <button class="sec vonly" data-act="versions" title="${T('ver_button_t')}"><ha-icon icon="mdi:history"></ha-icon><span>${T('ver_button')}</span></button>
        <button data-act="pause" class="pause sec" hidden></button>
      </div>
    </header>
    <div class="stage">
    <div class="vp">
      <div class="world"><div class="frames"></div><svg class="edges" aria-hidden="true"></svg><svg class="flowx" aria-hidden="true"></svg><div class="nodes" role="group" aria-label="${T('boxes_arrow_keys_follow_the')}"></div><div class="flow"></div><div class="notes"></div><svg class="links" aria-hidden="true"></svg></div>
      <div class="empty" hidden></div>
      <div class="cardhint" hidden><ha-icon icon="mdi:information-outline"></ha-icon><span>${T('this_card_works_best_in')}</span><button data-act="hint-x" title="${T('dismiss')}">&times;</button></div>
      <div class="nodebar" role="toolbar" hidden></div>
      <div class="lh" hidden title="${T('drag_onto_another_box_to')}"></div>
      <div class="edgebar" hidden></div>
      <div class="zoom"><button data-act="zoomout" title="${T('zoom_out')}">&minus;</button><button data-act="fit" title="${T('fit_everything')}"><ha-icon icon="mdi:fit-to-screen-outline"></ha-icon></button><button data-act="zoomin" title="${T('zoom_in')}">+</button></div>
      <div class="legend"></div>
      <div class="loading" hidden>${T('reading_configs')}</div>
      <div class="vtabs" hidden></div>
      <div class="sbxpill" hidden><ha-icon icon="mdi:flask-outline"></ha-icon>${T('sbx_pill')}</div>
      <div class="litbar" hidden></div>
      <div class="ttip" hidden></div>
      <div class="toast" role="status" aria-live="polite" hidden></div>
    </div>
    <div class="drawer" hidden></div>
    </div>
  </section>
  <div class="modal" hidden></div>
</div>`;
      const q = (s) => r.querySelector(s);
      this._$ = {
        board: q('.board'), list: q('.list'), title: q('.title'), tools: q('.tools'), pause: q('.pause'), vp: q('.vp'),
        world: q('.world'), frames: q('.frames'), edges: q('.edges'), nodes: q('.nodes'), notes: q('.notes'),
        empty: q('.empty'), nodebar: q('.nodebar'), legend: q('.legend'), loading: q('.loading'), toast: q('.toast'),
        drawer: q('.drawer'), modal: q('.modal'), cardhint: q('.cardhint'), litbar: q('.litbar'), ttip: q('.ttip'),
        edgebar: q('.edgebar'), links: q('.links'), lh: q('.lh'), sbxpill: q('.sbxpill'), flow: q('.flow'), flowx: q('.flowx'), vtabs: q('.vtabs'),
      };
      // the shadow root outlives a rebuild in another language (_relang): it keeps its listeners
      if (!this._rootOn) {
        this._rootOn = true;
        r.addEventListener('click', (e) => this._onClick(e));
        r.addEventListener('change', (e) => this._onChange(e));
        r.addEventListener('input', (e) => this._onInput(e));
        r.addEventListener('dblclick', (e) => this._onDbl(e));
        r.addEventListener('focusout', (e) => this._onBlur(e));
        r.addEventListener('focusin', (e) => this._onFocus(e));
        r.addEventListener('keydown', (e) => this._onKey(e));
      }
      const vp = this._$.vp;
      vp.addEventListener('pointerdown', (e) => this._onDown(e));
      vp.addEventListener('pointermove', (e) => { if (this._linking && !this._linking.drag) this._linkMove(e); });
      vp.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
      // holding a finger on a box to move it must not open the phone's own menu
      vp.addEventListener('contextmenu', (e) => { if (this._drag && this._drag.touch) e.preventDefault(); });
      this._$.drawer.addEventListener('mouseover', (e) => { const x = e.target.closest('.run, .dbrow, .wrow'); this._hover(x ? x.dataset.key || null : null); });
      // hovering an arrow that comes from a template shows the template's value right now (9.3)
      const ed = this._$.edges;
      ed.addEventListener('pointerover', (e) => { const p = e.target.closest('path.hit'); if (p) this._edgeHover(p.dataset.e, e); });
      // pointing at a box traces its arrows through the shared lines it's on
      const ns = this._$.nodes;
      ns.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch' || this._drag) return; const n = e.target.closest('.node'); this._setTrace(n ? this._busEdgesOf(n.dataset.key) : null); });
      ns.addEventListener('pointerleave', () => this._setTrace(null));
      ed.addEventListener('pointermove', (e) => { if (this._tt) this._ttMove(e); });
      ed.addEventListener('pointerout', (e) => { const p = e.target.closest('path.hit'); if (p && this._tt && this._tt.id === p.dataset.e) this._edgeHoverEnd(); });
      this._$.drawer.addEventListener('mouseleave', () => this._hover(null));
      this._renderLegend();
      this._applyMode();
      this._watchModal();
      if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this._checkCompact()); this._ro.observe(this._$.board); }
    }
    _checkCompact() {
      // narrow board (phone, small dashboard column): the list becomes a drawer over the board, closed by default.
      // A detached or hidden board reports width 0: that says nothing about its size, so keep the mode.
      const w = this._$.board.clientWidth;
      if (!w || !this.isConnected) return;
      const c = w < 760;
      if (c === !!this._compact) return;
      this._compact = c; this._listOpen = false; this._legendOpen = false;
      this._$.board.classList.toggle('compact', c);
      this._renderList(); this._renderLegend();
      if (this._model && this._data) {
        // the board changed size class (window resized, phone rotated): use that size's own view
        const v = this._viewFor(this._model.label);
        if (v) { this._view = Object.assign({ x: 40, y: 40, k: 1 }, v); this._applyView(); } else this._fit();
      }
    }

    /* ---------- data loading ---------- */
    async _boot() {
      this._booting = true;
      try {
        const d = await this._loadData();
        this._data = {
          v: 1,
          functions: Array.isArray(d.functions) ? d.functions.filter((f) => typeof f === 'string') : [],
          layouts: this._cleanLayouts(d.layouts),
          ui: Object.assign({ current: null, list: true, outside: true, suggest: true, legend: true }, d.ui || {}),
        };
        this._markSaved();
        await Promise.all([this._loadRegistries(true), this._loadDescriptions()]);
        this._subscribe();
        this._renderLegend();
        this._applyMode();
        this._renderList();
        if (this._migrated) this._toast(T('moved_your_functions_and_layouts'));
        const want = this._mode() === 'panel' ? this._routeLabel() : null;
        if (want && !this._data.functions.includes(want)) this._toast(T('there_s_no_function_on_2', { want }));
        const cur = want && this._data.functions.includes(want) ? want : this._data.functions.includes(this._data.ui.current) ? this._data.ui.current : this._data.functions[0];
        if (cur) await this._open(cur, false, { replace: true });
        else { this._renderHeader(); this._setEmpty(); }
        this._resumeCapture();
        if (this._regWarm) setTimeout(() => this._refreshWarm(), 600);
      } catch (e) { this._fatal(e); }
      this._booting = false;
    }

    async _fetchRegistries() {
      const d = await Promise.all([
        this._ws({ type: 'config/label_registry/list' }),
        this._ws({ type: 'config/entity_registry/list' }),
        this._ws({ type: 'config/device_registry/list' }),
        this._ws({ type: 'config/area_registry/list' }).catch(() => []),
        this._ws({ type: 'config/floor_registry/list' }).catch(() => []),
      ]);
      REG = { data: d, at: Date.now(), user: this._hass.user && this._hass.user.id };
      return d;
    }
    // warm: the last board's registries will do for now (see WARM_MS); given: ones just fetched
    async _loadRegistries(warm, given) {
      const keep = warm && REG && REG.user === (this._hass.user && this._hass.user.id) && Date.now() - REG.at < WARM_MS ? REG.data : null;
      this._regWarm = !!keep;
      const [labels, ents, devs, areas, floors] = given || keep || await this._fetchRegistries();
      this._areaMap = new Map((areas || []).map((a) => [a.area_id, a]));
      this._floorMap = new Map((floors || []).map((f) => [f.floor_id, f]));
      this._tgt = new Map(); this._src = new Map();  // what areas and helpers contain changes with the registries
      setDomains(new Set(Object.keys(this._hass.states).map((id) => id.split('.')[0]).concat(ents.map((e) => e.entity_id.split('.')[0]))));
      this._regAt = Date.now();
      this._labels = labels || []; this._ents = ents || []; this._devs = devs || [];
      this._labelMap = new Map(this._labels.map((l) => [l.label_id, l]));
      this._entMap = new Map(this._ents.map((e) => [e.entity_id, e]));
      this._regIdMap = new Map(this._ents.map((e) => [e.id, e.entity_id]));
      this._devMap = new Map(this._devs.map((d) => [d.id, d]));
      if (this._data) {
        this._data.functions = this._data.functions.filter((l) => this._labelMap.has(l));
        // a label deleted in Home Assistant takes its layout with it; hidden functions keep theirs
        const gone = Object.keys(this._data.layouts).filter((k) => !this._labelMap.has(k));
        if (gone.length) { gone.forEach((k) => delete this._data.layouts[k]); this._save(); }
      }
    }
    _cleanLayouts(all) {
      const out = {};
      if (all && typeof all === 'object' && !Array.isArray(all)) Object.entries(all).forEach(([k, L]) => { out[k] = cleanLayout(L); });
      return out;
    }

    _subscribe() {
      if (this._unsubs.length || !this._hass) return;
      const c = this._hass.connection;
      const reload = () => this._debounce('reg', 1200, () => this._reload());
      this._unsubs = [
        c.subscribeEvents((ev) => this._onRegistry(ev), 'entity_registry_updated'),
        // devices: only creation, removal, and labels, names or areas changing matter to the board (5.5)
        c.subscribeEvents((ev) => { const d = (ev && ev.data) || {}, ch = d.changes || {}; if (d.action !== 'update' || 'labels' in ch || 'name_by_user' in ch || 'area_id' in ch) reload(); }, 'device_registry_updated'),
        c.subscribeEvents(reload, 'label_registry_updated'),
        c.subscribeEvents((ev) => this._onRun(ev), 'automation_triggered'),
        c.subscribeEvents((ev) => this._onRun(ev), 'script_started'),
        this._storeMode === 'shared' ? this._subscribeShared(c) : null,
        // saving an automation reloads it; saving a script calls script.reload (filtered by Home Assistant)
        c.subscribeEvents(() => this._configChanged(), 'automation_reloaded'),
        c.subscribeMessage(() => this._configChanged(), { type: 'subscribe_trigger', trigger: { trigger: 'event', event_type: 'call_service', event_data: { domain: 'script', service: 'reload' } } }).catch(() => null),
      ];
    }
    // changes saved by other boards: v0.4 integrations send them to subscribers; older ones fire a bus event
    async _subscribeShared(c) {
      try { return await c.subscribeMessage((m) => this._onShared(m), { type: 'functions_board/subscribe' }); }
      catch (e) { return c.subscribeEvents((ev) => this._onShared(Object.assign({ what: 'all' }, (ev && ev.data) || {})), 'functions_board_updated'); }
    }
    // configs changed: forget the cached ones and redraw the open function, at most once a second
    _configChanged() {
      this._cfgCache.clear(); this._src = new Map(); this._grefs = null;
      this._throttle('cfg', 1000, () => {
        if (this._drag) { this._configChanged(); return; }
        const cur = this._data && this._data.ui.current;
        if (cur && this._data.functions.includes(cur)) this._open(cur, true);
      });
    }
    _unsubscribe() {
      const u = this._unsubs; this._unsubs = [];
      u.forEach((p) => Promise.resolve(p).then((f) => f && f()).catch(() => {}));
      // and the developer tools' own subscriptions (Phase 9)
      this._stopWatches(); this._stopMonitors(); this._edgeHoverEnd(); this._dbgStop(true);
      clearInterval(this._condTick); this._condTick = null;
    }

    async _reload(given) {
      try { await this._loadRegistries(false, given); } catch (e) { return; }
      this._renderList();
      const cur = this._data.ui.current;
      if (cur && this._data.functions.includes(cur)) await this._open(cur, true);
      else if (this._data.functions.length) await this._open(this._data.functions[0]);
      else { this._model = null; this._clearWorld(); this._renderHeader(); this._setEmpty(); }
    }

    async _onRegistry(ev) {
      const d = (ev && ev.data) || {}, id = d.entity_id;
      if (d.action === 'create' && this._capture && id) {
        const c = this._capture;
        if (await this._captureMatch(id, c)) await this._captured(id, c);
      } else if (d.action === 'update' && id && this._watch.has(id)) await this._rewatch(id);
      if (id && /^(automation|script)\./.test(id)) this._cfgCache.delete(id);
      const relevant = d.action !== 'update' || (this._model && this._model.nodes.has(id)) || (d.changes && 'labels' in d.changes);
      if (relevant) this._debounce('reg', 1200, () => this._reload());
    }
    // something was created in the editor drawer: give it the function's label and keep an eye on it
    async _captured(id, c) {
      const w = { label: c.label, until: Date.now() + 20000, cat: null };
      this._watch.set(id, w);
      setTimeout(() => { if (this._watch.get(id) === w) this._watch.delete(id); }, 20500);
      try {
        const u = await this._label(id, c.label, true, true);
        w.cat = u.cat;
        this._labelStep(T('add_to_6', { id, fnName: this._fnName(c.label) }), c.label, [u]);
        this._toast(T('added_to_5', { fnName: this._fnName(c.label), id }), [{ text: T('undo'), fn: () => this._undo() }]);
      } catch (e) { this._toast(T('created_but_could_not_label', { id })); }
    }
    // Home Assistant's automation and script editors write the labels, category and area from their save
    // dialog just after a new item is created. That wipes the label the board added, so put it back (and the
    // category, if the dialog left it empty) for 20 seconds after creation, keeping whatever the dialog set.
    async _rewatch(id) {
      const w = this._watch.get(id);
      if (!w || Date.now() > w.until) { this._watch.delete(id); return; }
      const reg = await this._ws({ type: 'config/entity_registry/get', entity_id: id }).catch(() => null);
      if (!reg) return;
      const labels = reg.labels || [], cats = reg.categories || {};
      const msg = { type: 'config/entity_registry/update', entity_id: id };
      if (!labels.includes(w.label)) msg.labels = labels.concat([w.label]);
      if (w.cat && !cats[w.cat[0]]) msg.categories = { [w.cat[0]]: w.cat[1] };
      if (msg.labels || msg.categories) await this._ws(msg).catch(() => {});
    }

    async _open(label, keep, opt = {}) {
      if (!label) return;
      if (this._ver && this._ver.label !== label) { this._ver = null; this._$.board.classList.remove('vview'); }
      if (this._sbx && this._sbx.label !== label) this._closeDrawer();
      if (this._capture && this._capture.label !== label) this._capture = null;
      this._data.ui.current = label;
      if (!keep && !opt.fromRoute) this._pushRoute(label, !!opt.replace);
      this._save();
      const L = this._layout(label);
      if (!keep) {
        this._sel = null;
        this._view = Object.assign({ x: 40, y: 40, k: 1 }, this._viewFor(label) || {});
        this._model = null;
        this._clearWorld();
        // what was watched, listened to or lit belongs to the function that was open (Phase 9)
        this._stopWatches(label); this._stopMonitors(); this._clearLit(true); this._edgeHoverEnd();
        this._cond = new Map(); this._condKeys = null;
      }
      this._renderList();
      this._renderHeader();
      this._$.loading.hidden = false;
      let model = null;
      try { model = await this._buildModel(label); } catch (e) { this._toast(T('could_not_read_this_function', { message: e.message || e })); }
      this._$.loading.hidden = true;
      if (!model || this._data.ui.current !== label) return;
      this._model = model;
      this._place();
      this._render();
      if (!keep && !this._viewFor(label)) this._fit();
      if (this._pendingSelect && model.nodes.has(this._pendingSelect)) { this._select(this._pendingSelect); this._centerOn(this._pendingSelect); }
      this._pendingSelect = null;
      this._loadRuns();
      this._afterOpen(label);
      this._renderVtabs();
      // a link to a saved version (…/functions/<function>?version=<id>, from "open in a new window")
      const q = !this._verUrlDone && new URLSearchParams(location.search).get('version');
      this._verUrlDone = true;
      if (q && /^[0-9a-f]{32}$/.test(q) && !this._ver && this._verOK()) this._verOpenTab(q);
    }
    // the developer tools follow the open function (Phase 9)
    _afterOpen(label) {
      this._startMonitors();
      this._testCondsSoon(150);
      clearInterval(this._condTick);
      // time and sun conditions change without any state changing
      this._condTick = setInterval(() => { if (document.visibilityState === 'visible' && this.isConnected) this._testConds(); }, 30000);
      if (this._drawer && this._drawer.mode === 'debug') {
        const g = this._dbg;
        if (!g || g.label !== label) { this._dbgStop(true); this._dbg = null; this._openDebug(); }
        else if (g.rec) {
          // new members: listen for them too
          const ents = this._dbgEntities();
          if (ents.length !== g.ents.size || ents.some((k) => !g.ents.has(k))) { this._dbgStop(true); this._dbgStart(); }
        }
      }
    }
    _routeLabel() {
      const m = String((this._route && this._route.path) || '').match(/^\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    _followRoute() {
      const want = this._routeLabel();
      if (!want) { if (this._data.ui.current) this._pushRoute(this._data.ui.current, true); return; }
      if (want === this._data.ui.current) return;
      if (this._data.functions.includes(want)) { this._closeDrawer(); this._open(want, false, { fromRoute: true }); }
      else { this._toast(T('there_s_no_function_on', { want })); this._pushRoute(this._data.ui.current, true); }
    }
    _pushRoute(label, replace) {
      if (this._mode() !== 'panel' || !label || !this.isConnected) return;
      const path = ((this._route && this._route.prefix) || '/functions') + '/' + encodeURIComponent(label);
      if (location.pathname === path) return;
      history[replace ? 'replaceState' : 'pushState'](null, '', path);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: !!replace } }));
    }
    _centerOn(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      // the middle of the part of the board the drawer leaves visible
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      v.x = this._openWidth() / 2 - (n.x + n.w / 2) * v.k; v.y = r.height / 2 - (n.y + n.h / 2) * v.k;
      this._applyView();
    }

    _clearWorld() {
      ['nodes', 'frames', 'notes'].forEach((k) => { this._$[k].innerHTML = ''; });
      this._$.edges.innerHTML = '';
      this._$.nodebar.hidden = true;
      this._els = new Map();
    }

    async _fetchConfig(entityId) {
      // a saved version's own configs, while its tab is open
      const V = this._ver, it = V && V.snap.items[entityId];
      if (it && it.cfg && /^(automation|script)\./.test(entityId)) return this._verCfg(entityId, it);
      // configs are cached for a minute; saving, reloading or closing the editor drawer clears the cache
      const hit = this._cfgCache.get(entityId);
      if (hit && Date.now() - hit.at < 60000) return hit.cfg;
      const cfg = await this._readConfig(entityId);
      this._cfgCache.set(entityId, { at: Date.now(), cfg });
      return cfg;
    }
    async _readConfig(entityId) {
      const d = entityId.split('.')[0];
      let cfg = null;
      try { const r = await this._ws({ type: d + '/config', entity_id: entityId }); cfg = r && r.config ? r.config : null; }
      catch (e) { return null; }
      const bp = cfg && cfg.use_blueprint;
      if (bp && bp.path) {
        // a blueprint automation/script stores only its inputs: ask Home Assistant for the filled-in config to read the wiring
        try {
          const r = await this._ws({ type: 'blueprint/substitute', domain: d, path: bp.path, input: bp.input || {} });
          if (r && r.substituted_config) cfg = Object.assign({}, r.substituted_config, { alias: cfg.alias, id: cfg.id, use_blueprint: bp });
        } catch (e) { /* keep the inputs-only config: the box shows, without arrows */ }
      }
      return cfg;
    }

    async _buildModel(label) {
      const token = ++this._token;
      const nodes = new Map(), edges = new Map(), tgts = [];
      const V = this._ver && this._ver.label === label ? this._ver : null;
      const members = V ? V.snap.members.filter((k) => !k.startsWith('device:')) : this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id);
      const devs = V ? V.snap.members.filter((k) => k.startsWith('device:')) : this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id);
      members.concat(devs).forEach((k) => {
        const n = this._mkNode(k, 'member');
        // its name as it was when the version was saved (renamed or deleted since)
        const it = V && V.snap.items[k];
        if (it && (it.cfg && it.cfg.alias || it.name)) n.name = (it.cfg && it.cfg.alias) || it.name;
        nodes.set(k, n);
      });
      const known = (x) => this._known(x);
      const logic = members.filter((e) => e.startsWith('automation.') || e.startsWith('script.'));
      const cfgs = await Promise.all(logic.map((e) => this._fetchConfig(e)));
      const an = logic.map((e, i) => (cfgs[i] ? analyze(cfgs[i], e.startsWith('script.'), known) : null));
      let sug = [];
      if (this._flt(label).suggest) {
        // Related = any automation or script outside the function whose config references a member
        // (triggers on it, checks it, changes it, or calls it). Reads every config: ~30 ms for 120 items.
        const memberSet = new Set(members.concat(devs));
        // on a saved version's board, what's in the function now isn't "related" (it was added since)
        const now = V ? new Set(this._verMembers(label)) : null;
        const all = this._logicIds().filter((e) => !memberSet.has(e) && !(now && now.has(e)));
        const cf = await Promise.all(all.map((e) => this._fetchConfig(e)));
        all.forEach((e, i) => {
          if (!cf[i]) return;
          const a = analyze(cf[i], e.startsWith('script.'), known);
          const hits = new Set(a.refs.map((r) => r.ref).filter((r) => memberSet.has(r)));
          if (hits.size) sug.push({ e, a, n: hits.size });
        });
        sug.sort((x, y) => y.n - x.n);
        sug = sug.slice(0, 20);
      }
      // area, floor and label targets, resolved by Home Assistant itself (2.2)
      await this._resolveTargets(an.concat(sug.map((x) => x.a)).flatMap((a) => (a ? a.refs.map((r) => r.ref).filter((r) => TGT_RE.test(r)) : [])));
      logic.forEach((e, i) => { if (an[i]) this._wire(e, an[i], nodes, edges, false, tgts); });
      sug.forEach(({ e, a }) => {
        const existing = nodes.get(e);
        if (existing && existing.kind === 'member') return;
        nodes.set(e, this._mkNode(e, 'suggest'));
        this._wire(e, a, nodes, edges, true, tgts);
      });
      // scenes and groups change their members (2.4); derived helpers read their inputs (2.3)
      this._wireGroups(nodes, edges);
      await this._wireSources(nodes, edges);
      // members no automation or script anywhere refers to (4.6)
      const refs = await this._globalRefs();
      nodes.forEach((n, k) => {
        if (n.kind !== 'member' || k.startsWith('automation.')) return;
        n.unref = refs ? !refs.has(k) : false;
      });
      // a target's entities that are on the board get their own arrow too
      tgts.forEach(({ src, r, ref, suggest }) => this._targetEntities(ref, r).forEach((id) => {
        const t = nodes.get(id);
        if (id !== src && t && (!suggest || t.kind === 'member')) this._link(edges, src, id, r, ref);
      }));
      if (token !== this._token) return null;
      const list = [...edges.values()];
      const writers = new Map();
      list.forEach((e) => {
        if (e.role === 'action' || e.role === 'call') {
          const w = writers.get(e.to) || new Set(); w.add(e.from); writers.set(e.to, w);
        }
      });
      nodes.forEach((n, k) => { n.writers = writers.has(k) ? [...writers.get(k)].filter((x) => /^(automation|script)\./.test(x)).length : 0; });
      // loops are found on the entities behind area, floor and label targets, not on the target boxes:
      // motion in the nursery turning on the nursery's lights is no loop (2.2)
      const plain = list.filter((e) => !TGT_RE.test(e.from) && !TGT_RE.test(e.to)), extra = [];
      tgts.forEach(({ src, r, ref, suggest }) => {
        if (suggest) return;
        const inbound = r.role === 'trigger' || r.role === 'condition';
        this._targetEntities(ref, r).forEach((id) => {
          if (id === src) return;
          const from = inbound ? id : src, to = inbound ? src : id;
          if (edges.has(from + '>' + to)) return;
          extra.push({ id: from + '>' + to + '|' + ref, from, to, role: r.role, svcs: new Set(r.svc ? [r.svc] : []), tfs: r.role === 'trigger' && r.tf ? [r.tf] : [], anyTrig: r.role === 'trigger' && !r.tf, box: inbound ? ref + '>' + src : src + '>' + ref });
        });
      });
      const keys = new Set([...nodes.keys()].filter((k) => !TGT_RE.test(k)));
      extra.forEach((e) => { keys.add(e.from); keys.add(e.to); });
      const loops = loopEdges([...keys], plain.concat(extra));
      list.forEach((e) => { e.loop = loops.has(e.id); });
      extra.forEach((e) => { if (loops.has(e.id) && edges.has(e.box)) edges.get(e.box).loop = true; });
      // Node-RED flows that use the function's pieces (2.7), only while that switch is on
      await this._nrNodes(nodes, list);
      // test buttons and monitor boxes kept in the layout (Phase 9), after the loop check: they are no part of it
      this._toolNodes(label, nodes, list);
      return { label, nodes, edges: list };
    }

    // every entity, device and script that any automation or script refers to (cached with the configs)
    async _globalRefs() {
      if (this._grefs && Date.now() - this._grefsAt < 60000) return this._grefs;
      const all = this._logicIds();
      const cfgs = await Promise.all(all.map((e) => this._fetchConfig(e)));
      const set = new Set(), known = (x) => this._known(x), tg = [];
      all.forEach((e, i) => {
        if (!cfgs[i]) return;
        analyze(cfgs[i], e.startsWith('script.'), known).refs.forEach((r) => { if (r.ref !== e) { set.add(r.ref); if (TGT_RE.test(r.ref)) tg.push(r); } });
      });
      await this._resolveTargets(tg.map((r) => r.ref));
      tg.forEach((r) => this._targetEntities(r.ref, r).forEach((id) => set.add(id)));
      // a device counts as used when an automation names it or one of its entities
      this._ents.forEach((e) => { if (e.device_id && set.has(e.entity_id)) set.add('device:' + e.device_id); });
      this._grefs = set; this._grefsAt = Date.now();
      return set;
    }
    // every automation and script that exists; a registry entry left over from a deleted one shows as a
    // restored, unavailable state and has no config to read
    _logicIds() {
      return Object.entries(this._hass.states).filter(([k, st]) => /^(automation|script)\./.test(k) && !(st.attributes && st.attributes.restored)).map(([k]) => k);
    }
    // one merged edge per pair: the strongest role wins, services and trigger filters accumulate
    _link(edges, a, b, r, via) {
      const inbound = r.role === 'trigger' || r.role === 'condition' || r.role === 'source';
      const from = inbound ? b : a, to = inbound ? a : b, id = from + '>' + to;
      let e = edges.get(id);
      if (!e) { e = { id, from, to, role: r.role, svcs: new Set(r.svc ? [r.svc] : []), tfs: [], anyTrig: false, via: via || null }; edges.set(id, e); }
      else { if (ROLE_RANK[r.role] > ROLE_RANK[e.role]) e.role = r.role; if (r.svc) e.svcs.add(r.svc); }
      if (r.role === 'trigger') { if (r.tf) e.tfs.push(r.tf); else e.anyTrig = true; }
      // for the developer tools: the conditions to test, templates to show live, triggers and actions to replay
      if (r.cond != null && !(e.conds || []).some((x) => x.c === r.cond)) (e.conds || (e.conds = [])).push({ c: r.cond, i: r.cidx });
      if (r.tpl) (e.tpls || (e.tpls = new Set())).add(r.tpl);
      if (r.trig && !(e.trigs || []).some((x) => x.t === r.trig)) (e.trigs || (e.trigs = [])).push({ t: r.trig, i: r.tidx });
      if (r.act && !(e.acts || []).includes(r.act)) (e.acts || (e.acts = [])).push(r.act);
      return e;
    }
    _wire(src, a, nodes, edges, suggest, tgts) {
      const { refs, badges } = a;
      const n = nodes.get(src);
      if (n) n.badges = badges;
      for (const r of refs) {
        const ref = r.ref;
        if (ref === src) continue;
        if (TGT_RE.test(ref)) {
          if (!suggest && !nodes.has(ref)) nodes.set(ref, this._mkNode(ref, 'outside'));
          if (!suggest) this._link(edges, src, ref, r);
          tgts.push({ src, r, ref, suggest });
          continue;
        }
        if (suggest) { const t = nodes.get(ref); if (!t || t.kind !== 'member') continue; }
        if (!nodes.has(ref)) nodes.set(ref, this._mkNode(ref, 'outside'));
        if (ref.startsWith('nact:') && r.title) { const bn = nodes.get(ref); bn.title = r.title; bn.name = T('button_3', { title: r.title }); }
        if (r.from && nodes.has(r.from)) this._link(edges, r.from, ref, r);  // a button hangs off its notification
        else this._link(edges, src, ref, r);  // _link points triggers and checks into src
      }
    }
    // what each purpose-specific trigger and condition can target (Home Assistant's triggers.yaml), read once
    async _loadDescriptions() {
      if (this._trigDesc) return;
      if (DESC) { [this._trigDesc, this._condDesc] = DESC; return; }
      const get = (type) => new Promise((resolve) => {
        let done = false, unsub = null;
        const fin = (v) => { if (done) return; done = true; resolve(v || {}); Promise.resolve(unsub).then((f) => f && f()).catch(() => {}); };
        unsub = this._hass.connection.subscribeMessage((m) => fin(m), { type }).catch(() => fin({}));
        setTimeout(() => fin({}), 4000);
      });
      [this._trigDesc, this._condDesc] = await Promise.all([get('trigger_platforms/subscribe'), get('condition_platforms/subscribe')]);
      if (Object.keys(this._trigDesc).length && Object.keys(this._condDesc).length) DESC = [this._trigDesc, this._condDesc];
    }
    // after a warm start: fetch the registries again, and redraw only if something changed while the board was away
    async _refreshWarm() {
      if (!this._regWarm || !this.isConnected) return;
      const old = REG && REG.data;
      const d = await this._fetchRegistries().catch(() => null);
      this._regWarm = false;
      if (!d || !this.isConnected || (old && regSig(d) === regSig(old))) return;
      await this._reload(d);
    }
    async _resolveTargets(keys) {
      const todo = [...new Set(keys)].filter((k) => !this._tgt.has(k));
      await Promise.all(todo.map(async (k) => {
        const i = k.indexOf(':'), kind = k.slice(0, i), id = k.slice(i + 1);
        const field = { area: 'area_id', floor: 'floor_id', label: 'label_id' }[kind];
        try {
          const r = await this._ws({ type: 'extract_from_target', target: { [field]: [id] } });
          this._tgt.set(k, { entities: (r && r.referenced_entities) || [] });
        } catch (e) { this._tgt.set(k, { entities: [] }); }
      }));
    }
    // a target's entities, narrowed to what the action or trigger can touch: light.turn_on on an area means
    // its lights; door.opened on an area means its door sensors (Home Assistant's own trigger description)
    _targetEntities(ref, r) {
      const t = this._tgt.get(ref);
      if (!t) return [];
      let ids = t.entities;
      if (r.sdom && r.sdom !== 'homeassistant') ids = ids.filter((id) => id.startsWith(r.sdom + '.'));
      else if (r.kind && r.kind.includes('.')) {
        const desc = (r.role === 'trigger' ? this._trigDesc : this._condDesc) || {};
        const d = desc[r.kind], filt = d && d.target && d.target.entity ? toList(d.target.entity) : null;
        if (filt) {
          ids = ids.filter((id) => filt.some((f) => {
            if (f.domain && !toList(f.domain).includes(id.split('.')[0])) return false;
            if (f.device_class) {
              const st = this._hass.states[id], reg = this._entMap.get(id);
              const dc = (st && st.attributes.device_class) || (reg && (reg.device_class || reg.original_device_class));
              if (!toList(f.device_class).includes(dc)) return false;
            }
            return true;
          }));
        } else {
          const dom = r.kind.split('.')[0];
          if (ids.some((id) => id.startsWith(dom + '.'))) ids = ids.filter((id) => id.startsWith(dom + '.'));
        }
      }
      return ids;
    }
    _wireGroups(nodes, edges) {
      const READ_ONLY = new Set(['binary_sensor', 'sensor', 'event', 'notify']);
      [...nodes.keys()].forEach((k) => {
        const st = this._hass.states[k];
        if (!st || k.includes(':')) return;
        const dom = k.split('.')[0], reg = this._entMap.get(k);
        const isGroup = dom === 'scene' || dom === 'group' || (reg && reg.platform === 'group');
        const list = isGroup ? toList(st.attributes.entity_id).filter((x) => typeof x === 'string' && x !== k) : [];
        list.forEach((m) => {
          if (!nodes.has(m)) return;
          if (READ_ONLY.has(dom)) this._link(edges, k, m, { role: 'source', svc: '' });
          else this._link(edges, k, m, { role: 'action', svc: dom === 'scene' ? 'activate' : '' });
        });
      });
    }
    async _wireSources(nodes, edges) {
      if (this._storeMode !== 'shared') return;
      const ask = [...nodes.entries()].filter(([k, n]) => !k.includes(':') && !/^(automation|script|scene|group)\./.test(k) && (n.kind === 'member' || this._scopeOf(k) === 'helpers' || (this._entMap.get(k) || {}).platform === 'template'))
        .map(([k]) => k).filter((k) => !this._src.has(k)).slice(0, 500);
      if (ask.length) {
        try {
          const r = await this._ws({ type: 'functions_board/sources', entity_ids: ask });
          ask.forEach((k) => this._src.set(k, (r && r.sources && r.sources[k]) || null));
        } catch (e) { ask.forEach((k) => this._src.set(k, null)); }
      }
      [...nodes.entries()].forEach(([k, n]) => {
        const s = this._src.get(k);
        if (!s) return;
        n.reads = s;
        s.entities.forEach((src) => {
          if (!nodes.has(src)) {
            if (n.kind !== 'member' || !(this._hass.states[src] || this._entMap.has(src))) return;
            nodes.set(src, this._mkNode(src, 'outside'));
          }
          this._link(edges, k, src, { role: 'source', svc: '' });
        });
      });
    }

    _mkNode(key, kind) {
      const n = { key, kind, badges: new Set(), writers: 0, x: 0, y: 0 };
      if (key.startsWith('device:')) {
        const d = this._devMap.get(key.slice(7));
        n.domain = 'device'; n.name = d ? d.name_by_user || d.name || T('device') : T('unknown_device'); n.icon = 'mdi:devices';
      } else if (key.startsWith('svc:')) {
        n.domain = 'service'; n.name = key.slice(4);
        n.icon = key.startsWith('svc:notify.') ? 'mdi:message-arrow-right-outline' : 'mdi:cog-play-outline';
      } else if (key.startsWith('event:')) {
        n.domain = 'event'; n.name = key.slice(6); n.icon = 'mdi:broadcast';
      } else if (key.startsWith('mqtt:')) {
        n.domain = 'mqtt'; n.name = key.slice(5); n.icon = 'mdi:access-point-network';
      } else if (key.startsWith('nact:')) {
        n.domain = 'button_press'; n.name = T('button_2', { key: key.slice(5) }); n.icon = 'mdi:gesture-tap-button';
      } else if (TGT_RE.test(key)) {
        const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
        const reg = kind === 'area' ? this._areaMap && this._areaMap.get(id) : kind === 'floor' ? this._floorMap && this._floorMap.get(id) : this._labelMap.get(id);
        const t = this._tgt.get(key), cnt = t ? t.entities.length : 0;
        n.domain = kind; n.name = ((reg && reg.name) || id) + ` (${cnt})`;
        n.icon = (reg && reg.icon) || { area: 'mdi:texture-box', floor: 'mdi:home-floor-1', label: 'mdi:label-outline' }[kind];
        n.targets = t ? t.entities : [];
      } else {
        n.domain = key.split('.')[0];
        const st = this._hass.states[key], reg = this._entMap.get(key);
        n.name = (st && st.attributes.friendly_name) || (reg && (reg.name || reg.original_name)) || key;
        n.icon = (reg && reg.icon) || (st && st.attributes.icon) || ICONS[n.domain] || 'mdi:shape-outline';
      }
      const small = kind === 'outside';
      n.w = small ? XW : NW; n.h = small ? XH : NH;
      return n;
    }

    // which arrow types and kinds of box show, per function (7.2); outside and related default to the global choice
    _flt(label) {
      const u = this._data.ui, f = (u.filters && u.filters[label]) || {};
      const on = (k) => f[k] !== false;
      return { trigger: on('trigger'), condition: on('condition'), source: on('source'), action: on('action'), call: on('call'),
        outside: f.outside != null ? !!f.outside : u.outside !== false, suggest: f.suggest != null ? !!f.suggest : u.suggest !== false };
    }
    _setFlt(label, key, val) {
      const u = this._data.ui;
      u.filters = Object.assign({}, u.filters || {}, { [label]: Object.assign({}, (u.filters || {})[label] || {}, { [key]: val }) });
      this._save();
    }
    _visibleKeys() {
      const m = this._model, s = new Set();
      if (!m) return s;
      const f = this._flt(m.label);
      // an outside or related box is only there for its arrows: it goes when all of them are filtered out
      const shown = new Set();
      m.edges.forEach((e) => { if (f[e.role] !== false) { shown.add(e.from); shown.add(e.to); } });
      m.nodes.forEach((n, k) => {
        if (n.kind === 'outside' && (!f.outside || !shown.has(k))) return;
        if (n.kind === 'suggest' && (!f.suggest || !shown.has(k))) return;
        s.add(k);
      });
      return s;
    }
    _visEdges() {
      const m = this._model;
      if (!m) return [];
      const vis = this._visibleKeys(), f = this._flt(m.label);
      return m.edges.filter((e) => vis.has(e.from) && vis.has(e.to) && f[e.role] !== false);
    }
    _kindHead(k) {
      const n = this._model.nodes.get(k);
      const kind = n.kind === 'tool' ? T('tests_and_monitors') : n.kind === 'nodered' ? T('node_red_flows') : n.kind === 'suggest' ? T('related_2') : n.kind === 'outside' ? T('outside_items') : n.domain === 'automation' ? T('automations') : n.domain === 'script' ? T('scripts')
        : this._scopeOf(k) === 'helpers' ? T('helpers') : n.domain === 'device' ? T('devices') : T('other');
      return T('with_no_arrows', { kind });
    }
    _sortKey(k) {
      const n = this._model.nodes.get(k);
      const r = n.kind === 'member' ? (n.domain === 'automation' ? 0 : n.domain === 'script' ? 1 : HELPER_DOMAINS.has(n.domain) ? 2 : 3)
        : n.kind === 'suggest' || n.kind === 'nodered' ? 4 : n.kind === 'tool' ? 6 : 5;
      return r + ':' + String(n.name).toLowerCase();
    }

    _place() {
      CURVED = this._data.ui.curved === true;
      const m = this._model, L = this._layout(m.label), vis = this._visibleKeys();
      // test buttons and monitor boxes (Phase 9) take no part in the layout: adding one moves nothing else
      const tools = [...vis].filter((k) => k.startsWith('tool:')), E = this._visEdges().filter((e) => e.role !== 'tool');
      const keys = [...vis].filter((k) => !k.startsWith('tool:')).sort((a, b) => this._sortKey(a).localeCompare(this._sortKey(b)));
      const saved = keys.filter((k) => L.nodes[k]), fresh = keys.filter((k) => !L.nodes[k]), keep = new Set(L.keep || []);
      // after Auto-arrange with boxes kept in place, everything else is laid out together, clear of the kept boxes
      const around = saved.length && fresh.length && saved.every((k) => keep.has(k));
      const V = L.dir === 'down';
      const lay = around ? fresh : keys, auto = layered(lay, E.filter((e) => !around || (fresh.includes(e.from) && fresh.includes(e.to))), (k) => m.nodes.get(k), (k) => this._kindHead(k), V);
      let dx = 0, dy = 0;
      if (around) {
        const sz = (k) => m.nodes.get(k), kb = saved.map((k) => [L.nodes[k].x, L.nodes[k].y, L.nodes[k].x + sz(k).w, L.nodes[k].y + sz(k).h]);
        const ab = fresh.map((k) => { const a = auto.get(k); return [a.x, a.y, a.x + sz(k).w, a.y + sz(k).h]; });
        const ext = (bs) => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
        const K = ext(kb), A = ext(ab), clear = (ox, oy) => !ab.some((a) => kb.some((b) => a[0] + ox < b[2] + 40 && a[2] + ox + 40 > b[0] && a[1] + oy < b[3] + 40 && a[3] + oy + 40 > b[1]));
        const shape = (ox, oy) => { const w = Math.max(K[2], A[2] + ox) - Math.min(K[0], A[0] + ox), h = Math.max(K[3], A[3] + oy) - Math.min(K[1], A[1] + oy); return Math.abs(Math.log(w / h / 1.7)); };
        const tries = [[K[0] - A[0], K[1] - A[1]], [K[2] + 120 - A[0], K[1] - A[1]], [K[0] - A[0], K[3] + 120 - A[1]]];
        const ok = tries.filter(([ox, oy]) => clear(ox, oy));
        [dx, dy] = clear(...tries[0]) ? tries[0] : (ok.length ? ok : tries.slice(1)).sort((p, q) => shape(...p) - shape(...q))[0];
      } else if (saved.length && fresh.length) {
        dy = Math.max(...saved.map((k) => L.nodes[k].y + m.nodes.get(k).h)) + 100 - Math.min(...fresh.map((k) => auto.get(k).y));
        dx = Math.min(...saved.map((k) => L.nodes[k].x)) - Math.min(...fresh.map((k) => auto.get(k).x));
      }
      this._autoPos = new Map();
      keys.forEach((k) => {
        const n = m.nodes.get(k), p = L.nodes[k];
        if (p) { n.x = p.x; n.y = p.y; return; }
        const a = auto.get(k);
        n.x = Math.round(a.x + dx); n.y = Math.round(a.y + dy);
        this._autoPos.set(k, [n.x, n.y]);
      });
      // a box new to an arranged function goes next to its most connected neighbour (7.4)
      if (!around && saved.length && fresh.length) {
        const placed = saved.map((k) => m.nodes.get(k));
        const overlaps = (n) => placed.some((o) => o !== n && n.x < o.x + o.w + 20 && n.x + n.w + 20 > o.x && n.y < o.y + o.h + 14 && n.y + n.h + 14 > o.y);
        fresh.forEach((k) => {
          const n = m.nodes.get(k), score = new Map();
          E.forEach((e) => {
            const other = e.from === k ? e.to : e.to === k ? e.from : null;
            // what it sets off counts double: an input reads best just left of what it triggers
            if (other && placed.includes(m.nodes.get(other))) score.set(other, (score.get(other) || 0) + (e.from === k && e.role === 'trigger' ? 2 : 1));
          });
          const best = [...score.entries()].sort((x, y) => y[1] - x[1])[0];
          if (best) {
            const b = m.nodes.get(best[0]), after = E.some((e) => e.from === best[0] && e.to === k);
            if (V) {
              // top to bottom: under what sets it off, over what it sets off
              n.y = Math.round(after ? b.y + b.h + 70 : b.y - n.h - 70); n.x = b.x;
              for (let i = 0; i < 40 && overlaps(n); i++) n.x += n.w + 20;
            } else {
              n.x = Math.round(after ? b.x + b.w + 80 : b.x - n.w - 80); n.y = b.y;
              for (let i = 0; i < 40 && overlaps(n); i++) n.y += n.h + 14;
            }
            this._autoPos.delete(k);
          }
          placed.push(n);
        });
      }
      // a tool box sits where it was put; one without a place (from another board, say) goes next to what it is for
      const all = keys.map((k) => m.nodes.get(k));
      tools.forEach((k) => {
        const n = m.nodes.get(k), p = L.nodes[k];
        if (p) { n.x = p.x; n.y = p.y; all.push(n); return; }
        const t = n.tool, tgt = m.nodes.get(t.type === 'inject' ? t.test && t.test.target : t.target);
        const hit = () => all.some((o) => n.x < o.x + o.w + 16 && n.x + n.w + 16 > o.x && n.y < o.y + o.h + 12 && n.y + n.h + 12 > o.y);
        if (tgt) { n.x = t.type === 'inject' ? tgt.x - n.w - 70 : tgt.x; n.y = t.type === 'inject' ? tgt.y : tgt.y + tgt.h + 30; }
        else { n.x = Math.min(0, ...all.map((o) => o.x)) - n.w - 80; n.y = Math.min(0, ...all.map((o) => o.y)); }
        for (let i = 0; i < 40 && hit(); i++) n.y += n.h + 12;
        all.push(n);
      });
      // the automatic layout's waypoints for arrows that skip columns, where both ends are still where it put them
      // (in the turned frame for top to bottom, where a real shift right is a shift down)
      this._routes = new Map([...(auto.routes || new Map())].map(([id, pts]) => [id, pts.map((p) => (V ? [p[0] + dy, p[1] + dx, p[2]] : [p[0] + dx, p[1] + dy, p[2]]))]));
      // a heading over unwired boxes stays only while none of them has been moved by hand
      this._heads = (auto.heads || []).filter((h) => h.keys.every((k) => !L.nodes[k])).map((h) => ({ x: Math.round(h.x + dx), y: Math.round(h.y + dy), text: h.text }));
    }
    // top to bottom (the function's layout says so)
    _vert() { return !!(this._model && this._layout(this._model.label).dir === 'down'); }
    _routeFor(e, sd) {
      const r = this._routes && this._routes.get(e.id);
      if (!r || sd[0] !== 'r' || sd[1] !== 'l') return null;
      const at = (k) => { const p = this._autoPos && this._autoPos.get(k), n = this._model.nodes.get(k); return p && n && p[0] === n.x && p[1] === n.y; };
      return at(e.from) && at(e.to) ? r : null;
    }

    /* ---------- rendering ---------- */
    _render() {
      if (!this._model) return;
      const m = this._model, vis = this._visibleKeys(), shown = this._visEdges(), f = this._flt(m.label);
      // a box with arrows, all of them filtered out, says so (7.2)
      const cnt = new Map(), vis2 = new Set();
      m.edges.forEach((e) => { if (vis.has(e.from) && vis.has(e.to) && f[e.role] === false) { cnt.set(e.from, (cnt.get(e.from) || 0) + 1); cnt.set(e.to, (cnt.get(e.to) || 0) + 1); } });
      shown.forEach((e) => { vis2.add(e.from); vis2.add(e.to); });
      m.nodes.forEach((n, k) => { n.hidden = cnt.has(k) && !vis2.has(k) ? cnt.get(k) : 0; });
      this._renderFrames();
      this._$.nodes.innerHTML = [...vis].map((k) => this._nodeHTML(m.nodes.get(k))).join('');
      this._els = new Map();
      this._$.nodes.querySelectorAll('.node').forEach((el) => this._els.set(el.dataset.key, el));
      this._renderNotes();
      this._renderMons();
      this._conn = this._connText();
      this._rove(this._sel || (this._roveKey && vis.has(this._roveKey) ? this._roveKey : [...vis][0]));
      this._applyView();
      this._refreshStates();
      this._applyFocus();
      this._setEmpty();
    }

    _nodeHTML(n) {
      if (n.kind === 'tool') return this._toolHTML(n);
      const b = [...n.badges].filter((x) => BADGES[x]).map((x) => `<ha-icon icon="${BADGES[x][0]}" title="${BADGES[x][1]}"></ha-icon>`).join('')
        + (n.writers > 1 ? `<span class="wr" title="${T('changed_by_automations_or_scripts', { writers: n.writers })}">&#9998;${n.writers}</span>` : '')
        + (n.unref ? `<ha-icon class="unref" icon="mdi:link-variant-off" title="${T('it_may_be_used_by', { extra: n.domain === 'script' ? T('no_automation_or_script_runs') : T('no_automation_or_script_refers') })}"></ha-icon>` : '')
        + (n.hidden ? `<span class="wr hid" title="${T('its_arrows_are_hidden_by')}">${P('n_hidden', n.hidden)}</span>` : '')
        + ((this._layout(this._model.label).keep || []).includes(n.key) ? `<ha-icon class="kept" icon="mdi:pin" title="${T('kept_in_place_auto_arrange')}"></ha-icon>` : '');
      const vd = this._ver && this._ver.diff ? (this._ver.diff.changed.has(n.key) ? 'chg' : this._ver.diff.only.has(n.key) ? 'only' : '') : '';
      return `<div class="node ${n.kind} d-${esc(n.domain)}${vd ? ' vd-' + vd : ''}" data-key="${esc(n.key)}" role="button" tabindex="-1" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px">`
        + (vd ? `<span class="vdtag" title="${vd === 'chg' ? T('ver_changed_t') : T('ver_only_t')}">${vd === 'chg' ? T('ver_changed_tag') : T('ver_only_tag')}</span>` : '')
        + `<span class="tag">${esc(this._tagOf(n.key))}</span><ha-icon class="ic" icon="${esc(n.icon)}"></ha-icon><div class="txt"><div class="name">${esc(n.name)}</div>`
        + (n.kind === 'outside' ? '' : '<div class="sub"></div>') + '</div>'
        + (b ? `<div class="badges">${b}</div>` : '')
        // the points arrows leave from (right) and enter by (left); in Full manager, drag from one to draw an arrow
        // (top to bottom: in by the top edge, out by the bottom one)
        + (PROTO().ortho ? (() => { const V = this._vert(), at = V ? 'left' : 'top'; return portYs(V ? n.w : n.h).map((y) => `<span class="port pl" data-y="${y - 4}" style="${at}:${y - 4}px"></span><span class="port pr" data-y="${y - 4}" style="${at}:${y - 4}px"></span>`).join(''); })() : '') + '</div>';
    }

    _renderFrames() {
      if (!this._model) return;
      const L = this._layout(this._model.label);
      const heads = (this._heads || []).map((h) => `<div class="khead" style="left:${+h.x}px;top:${+h.y}px">${esc(h.text)}</div>`).join('');
      this._$.frames.innerHTML = L.frames.map((f) => { const id = esc(f.id); return `<div class="frame" data-fid="${id}" style="left:${+f.x}px;top:${+f.y}px;width:${+f.w}px;height:${+f.h}px"><div class="fhead" data-fid="${id}"><span class="ftitle" data-fid="${id}" title="${T('double_click_to_rename')}">${esc(f.title)}</span><button class="fdel" data-act="fdel" data-fid="${id}" title="${T('delete_frame_keeps_what_is')}">&times;</button></div><div class="fresize" data-fid="${id}"></div></div>`; }).join('') + heads;
    }

    _renderNotes() {
      if (!this._model) return;
      const L = this._layout(this._model.label);
      this._$.notes.innerHTML = L.notes.map((n) => { const id = esc(n.id); return `<div class="note" data-nid="${id}" style="left:${+n.x}px;top:${+n.y}px;width:${+n.w || 240}px"><div class="nhead" data-nid="${id}"><ha-icon icon="mdi:note-text-outline"></ha-icon><button class="ndel" data-act="ndel" data-nid="${id}" title="${T('delete_note')}">&times;</button></div><textarea class="nbody" data-nid="${id}" rows="2" placeholder="${T('write_a_note')}">${esc(n.text)}</textarea></div>`; }).join('');
      this._$.notes.querySelectorAll('textarea').forEach((t) => this._autosize(t));
    }
    _autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

    _status(n) {
      if (n.kind === 'tool') return { text: n.tool.type === 'inject' ? (this._full() ? T('test_button') : T('test_button_full_manager_only')) : T('monitor') };
      if (n.kind === 'nodered') return { text: T('node_red_3', { tabLabel: n.nr.tabLabel, count: P('n_nodes', n.nr.size) }) };
      const tn = TYPE[n.domain] || n.domain.replace(/_/g, ' ');
      let r;
      if (n.domain === 'device') {
        const d = this._devMap.get(n.key.slice(7));
        r = { text: T('device_2', { extra: d && d.model ? ' · ' + d.model : '' }) };
      } else if (n.domain === 'service') r = { text: T('action_2', { split: n.name.split('.')[0] }) };
      else if (n.domain === 'event') r = { text: T('event') };
      else if (n.domain === 'button_press') r = { text: T('notification_button_action', { extra: n.title ? ' "' + n.title + '"' : '', key: n.key.slice(5) }) };
      else if (TGT_RE.test(n.key)) {
        const names = (n.targets || []).map((id) => { const st = this._hass.states[id]; return (st && st.attributes.friendly_name) || id; });
        r = { text: T('target', { type: TYPE[n.domain], count: P('n_entities', names.length), n: names.length ? ': ' + names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '') : '' }) };
      }
      else if (n.domain === 'mqtt') r = { text: T('mqtt_topic') };
      else {
        const st = this._stOf(n.key);
        if (!st) r = { text: T('not_found', { tn }), warn: true };
        else if (st.state === 'unavailable') r = { text: T('unavailable_2', { tn }), warn: true };
        else if (n.domain === 'automation') {
          const run = (st.attributes.current || 0) > 0;
          r = { text: T('ran_3', { n: (st.state === 'on' ? T('on') : T('off')) + (run ? T('running_3') : ''), last_triggered: ago(st.attributes.last_triggered) }), off: st.state !== 'on', run };
        } else if (n.domain === 'script') {
          const run = st.state === 'on';
          r = { text: T('ran_2', { extra: run ? T('running_2') : T('idle'), last_triggered: ago(st.attributes.last_triggered) }), run };
        } else {
          let v;
          try { v = this._hass.formatEntityState ? this._hass.formatEntityState(st) : st.state; } catch (e) { v = st.state; }
          r = { text: tn + ' · ' + v };
        }
      }
      if (n.kind === 'suggest') r.text = T('related', { text: r.text });
      if (this._sbxOn()) {
        // the sandbox: what runs there, and what it changed from the real state
        const eng = this._sbx.eng;
        if (/^(automation|script)\./.test(n.key)) {
          // its runs in the sandbox, not its last real run
          r.run = eng.running(n.key);
          const runs = eng.log.filter((e) => e.kind === 'run' && e.key === n.key).length, st = this._stOf(n.key);
          const on = n.domain === 'automation' ? (st && st.state === 'off' ? T('off') : T('on')) + ' · ' : '';
          r.text = on + (r.run ? T('sbx_running') : runs ? P('sbx_ran_n', runs) : T('sbx_not_run'));
          r.off = n.domain === 'automation' && !!st && st.state === 'off';
        }
        const was = this._hass.states[n.key], now = eng.changed.get(n.key);
        r.sbch = !!(now && (!was || String(was.state) !== String(now.state)));
        return r;
      }
      // a simulated state stays marked until the device or its integration reports again (9.2)
      if (this._sim.has(n.key)) {
        const st = this._hass.states[n.key];
        if (st && st.context && st.context.id === this._sim.get(n.key)) { r.text += T('simulated_2'); r.sim = true; } else this._sim.delete(n.key);
      }
      return r;
    }

    _refreshStates() {
      if (!this._model || !this._els) return;
      const m = this._model;
      this._els.forEach((el, k) => {
        const n = m.nodes.get(k);
        if (!n) return;
        const s = this._status(n);
        const sub = el.querySelector('.sub');
        if (sub && sub.textContent !== s.text) sub.textContent = s.text;
        const tip = n.name + (s.text ? ' — ' + s.text : '') + (n.kind === 'suggest' ? T('related_not_in_this_function_3') : n.kind === 'outside' ? T('outside_this_function_2') : '');
        if (el.title !== tip) el.title = tip;
        // what a screen reader says: the box, its state, and what it is wired to (4.8)
        const al = `${n.name}, ${this._tagOf(k)}. ${s.text || ''}${n.kind === 'suggest' ? T('related_not_in_this_function_2') : n.kind === 'outside' ? T('outside_this_function') : ''}${this._conn && this._conn.get(k) ? '. ' + this._conn.get(k) : ''}`;
        if (el.getAttribute('aria-label') !== al) el.setAttribute('aria-label', al);
        const pressed = String(k === this._sel);
        if (el.getAttribute('aria-pressed') !== pressed) el.setAttribute('aria-pressed', pressed);
        el.classList.toggle('off', !!s.off);
        el.classList.toggle('warn', !!s.warn);
        el.classList.toggle('running', !!s.run);
        el.classList.toggle('err', this._errKeys.has(k));
        el.classList.toggle('sim', !!s.sim);
        el.classList.toggle('sbch', !!s.sbch);
        // outside boxes have no state line: in the sandbox, a tag with the state
        if (this._sbxOn() && n.kind === 'outside') { const so = this._stOf(k), v = so ? this._fmtState(k, so.state) : ''; if (el.dataset.sbx !== v) el.dataset.sbx = v; }
        else if (el.dataset.sbx) delete el.dataset.sbx;
        const w = this._tw.get(k);
        el.classList.toggle('watching', !!w);
        if (w) { const t = 'watching' + (w.hits ? ' · ' + w.hits : ''); if (el.dataset.watch !== t) el.dataset.watch = t; } else if (el.dataset.watch) delete el.dataset.watch;
        const st = this._stOf(k);
        if (st && n.domain !== 'automation' && n.domain !== 'script' && n.kind !== 'outside') {
          const prev = this._prev.get(k);
          if (prev && prev !== st.last_changed) this._pulse(k);
          this._prev.set(k, st.last_changed);
        }
      });
      if (this._sel) {
        const t = this._$.nodebar.querySelector('button[data-act="toggle"]'), st = this._hass.states[this._sel];
        if (t && st && t.dataset.state !== st.state) this._renderNodebar();
      }
      this._renderPause();
      // the checks' results follow the states they read (9.3); the debugger lists what the logbook leaves out (9.4)
      if (this._condKeys && this._condKeys.size) {
        const sig = [...this._condKeys].map((k) => { const s = this._hass.states[k]; return s ? s.state + s.last_changed : ''; }).join('|');
        if (sig !== this._condSig) { this._condSig = sig; this._testCondsSoon(); }
      }
      this._dbgStates();
    }

    _edgeTitle(e) {
      const a = this._model.nodes.get(e.from), b = this._model.nodes.get(e.to);
      if (e.role === 'tool') return a.kind === 'tool' ? T('tests_2', { name: a.name, name2: b.name }) : T('lists', { name: b.name, name2: a.name });
      const via = e.via && this._model.nodes.get(e.via);
      return fill(VERB[e.role] || '{a} → {b}', { a: a.name, b: b.name }) + (e.svcs.size ? ` (${[...e.svcs].join(', ')})` : '')
        + (via ? T('through_the', { domain: via.domain, name: via.name.replace(/ \(\d+\)$/, '') }) : '')
        + (e.loop ? T('part_of_a_loop_this') : '');
    }

    _drawEdges() {
      const m = this._model;
      if (!m) { this._$.edges.innerHTML = ''; return; }
      CURVED = this._data.ui.curved === true;
      const E = this._visEdges(), F = this._focus, out = [DEFS], labels = [], hits = [], now = Date.now(), PR = PROTO();
      this._$.board.classList.toggle('pc', !!PR.color);
      this._$.board.classList.toggle('full', !!this._full());
      this._$.board.classList.toggle('light', !(this._hass && this._hass.themes && this._hass.themes.darkMode));
      // top to bottom: the arrows are routed left to right between the boxes turned a quarter turn (proxies with x and
      // y, width and height swapped), then drawn in a group reflected across the diagonal, which turns them back.
      // Text and check marks are put outside it, at the turned-back point, so they aren't mirrored
      const V = this._vert();
      this._$.board.classList.toggle('vert', V);
      const prox = new Map(), boxOf = (k) => {
        const n = m.nodes.get(k);
        if (!V || !n) return n;
        if (!prox.has(k)) prox.set(k, { key: n.key, kind: n.kind, x: n.y, y: n.x, w: n.h, h: n.w });
        return prox.get(k);
      };
      const tp = (x, y) => (V ? [y, x] : [x, y]);
      const boxes = [...this._visibleKeys()].map(boxOf);
      const marks = [], condOn = this._data.ui.condres !== false, mids = new Map(), fl = this._flow && this._sbxOn() ? this._flow : null;
      const dot = fl && fl.anim && fl.steps[fl.at] ? fl.steps[fl.at].links.find((l) => l.edge) : null;
      const geo = arrowGeo(E, boxOf, PR.ortho ? orthoSides : sides);
      let dots = [], tagged = null;
      const chev = [];
      if (PR.ortho) {
        const r = orthoAll(geo, (e, sd) => this._routeFor(e, sd), boxes);
        this._ortho = { ids: geo.map((g) => g.e.id), routes: r.routes, owners: r.owners, hops: r.hops.map((m) => [...m]), boxes: geo.map((g) => [g.e.from, g.e.to]), vert: V };
        geo.forEach((g, i) => { const rp = roundPath(r.routes[i], r.hops[i]); g.gm = { d: rp.d, mx: rp.mid[0], my: rp.mid[1] }; });
        // a bus's dots light with it
        // a branch lights with its arrow
        dots = r.dots.map((dt) => Object.assign({ lit: !F || (dt.tag == null ? geo.some((g, i) => (r.owners[i] || []).includes(dt.own) && this._focusEdges.has(g.e.id)) : this._focusEdges.has(geo[dt.ri].e.id)) }, dt));
        tagged = r.tags;
        // each arrow's direction, on runs that go back (right to left)
        geo.forEach((g, i) => {
          const pts = r.routes[i], hi = !!F && this._focusEdges.has(g.e.id), hp = r.hops[i] || new Map();
          for (let j = 1; j < pts.length; j++) {
            const u = pts[j - 1], v = pts[j], len = u[0] - v[0];
            if (Math.abs(u[1] - v[1]) > 0.5 || len < 70) continue;
            const n = Math.max(1, Math.floor(len / 320));
            for (let q = 1; q <= n; q++) {
              let x = u[0] - (len * q) / (n + 1);
              // (not on a hop)
              (hp.get(j) || []).forEach(([h0, h1]) => { if (x > Math.min(h0, h1) - HOP - 6 && x < Math.max(h0, h1) + HOP + 6) x = Math.min(h0, h1) - HOP - 8; });
              chev.push(`<path class="chev role-${esc(g.e.role)}${F && !hi ? ' dim' : ''}" d="M${x - 4},${u[1]} L${x + 4},${u[1] - 4.5} L${x + 4},${u[1] + 4.5} z"></path>`);
            }
          }
        });
      }
      for (const g of geo) {
        const e = g.e, way = g.gm ? null : this._routeFor(e, g.s);
        const gm = g.gm || edgeGeom(g.a, g.b, { sides: g.s, fa: g.fa, fb: g.fb, way, boxes: way ? null : boxes });
        const hi = !!F && this._focusEdges.has(e.id), live = (this._live.get(e.from) || 0) > now || (this._liveE.get(e.id) || 0) > now;
        const cls = ['e', 'role-' + e.role];
        if (e.loop) cls.push('loop');
        if (F) cls.push(hi ? 'hi' : 'dim');
        if (live) cls.push('live');
        if (this._selEdge === e.id) cls.push('esel');
        const RC = { trigger: 'trig', action: 'act', call: 'call' };
        const mk = PR.color ? (live ? 'hi' : RC[e.role] || (hi ? 'hi' : 'n')) : live ? 'blue' : e.loop ? 'amber' : hi ? 'hi' : 'n';
        const ms = e.role === 'trigger' ? ` marker-start="url(#fb-${PR.color && !live ? 'dottrig' : hi ? 'dothi' : 'dot'})"` : '';
        const title = e.tpls && e.tpls.size ? '' : `<title>${esc(this._edgeTitle(e))}</title>`;
        out.push(`<path class="${cls.join(' ')}" data-edge="${esc(e.id)}" d="${gm.d}" marker-end="url(#fb-${mk})"${ms}></path>`);
        // a wider, invisible copy that is easier to hover; arrows from templates show their live value instead of a title
        hits.push(`<path class="hit${e.tpls && e.tpls.size ? ' tpl' : ''}" data-act="edge" data-e="${esc(e.id)}" d="${gm.d}">${title}</path>`);
        const [lx, ly] = tp(gm.mx, gm.my);
        mids.set(e.id, [lx, ly]);
        // the sandbox's flow: a dot runs along the step's arrow (in the same frame as the arrow)
        if (dot && dot.edge === e.id) out.push(`<circle class="fdot" r="5.5"><animateMotion begin="indefinite" dur="0.65s" fill="freeze" path="${gm.d}"${dot.rev ? ' keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}></animateMotion></circle>`);
        if (hi && e.svcs.size) labels.push(`<text x="${lx}" y="${ly - 6}" text-anchor="middle">${esc([...e.svcs].join(', '))}</text>`);
        // whether its check passes right now (9.3), or, in the sandbox's flow, whether it passed there
        const fc = fl && fl.cond.get(e.id), c = !fc && condOn && this._cond.get(e.id);
        if (fc || c) {
          const ok = fc ? fc.ok : c.ok, kind = ok === true ? 'ok' : ok === false ? 'bad' : 'unk';
          const glyph = kind === 'ok' ? '<path d="M-3.6,0.2 L-1.1,2.8 L3.8,-2.6"></path>' : kind === 'bad' ? '<path d="M-3,-3 L3,3 M3,-3 L-3,3"></path>' : '<text y="3.6" text-anchor="middle">?</text>';
          marks.push(`<g class="cres ${kind}${fc ? ' sbxc' : ''}${F && !hi ? ' dim' : ''}" data-edge="${esc(e.id)}" transform="translate(${lx},${ly})"><circle r="8"></circle>${glyph}<title>${esc(fc ? fc.title : this._condTitle(e, c))}</title></g>`);
        }
      }
      // where a shared line splits, and where an arrow leaves it: a plain dot (joined here, not crossing)
      const jd = dots.map((dt) => `<circle class="jd split role-${esc(dt.role)}${dt.lit ? '' : ' dim'}" cx="${dt.x}" cy="${dt.y}" r="${dt.tag == null ? 3.6 : 3.2}"></circle>`);
      const drawn = out.slice(1).join('') + chev.join('') + jd.join('') + hits.join('');
      this._$.edges.innerHTML = DEFS + (V ? `<g transform="matrix(0 1 1 0 0 0)">${drawn}</g>` : drawn) + labels.join('') + marks.join('');
      this._applyTrace();
      this._edgeMid = mids;
      if (dot) this._$.edges.querySelectorAll('animateMotion').forEach((x) => { try { x.beginElement(); } catch (er) { /* no SMIL */ } });
      this._paintFlow();
      if (fl) fl.anim = false;
    }

    // tracing arrows through a shared line: pointing at a box, or selecting it, draws that box's arrows on shared
    // lines end to end on top, and fades the others on the same lines
    _busEdgesOf(key) {
      const o = this._ortho;
      if (!o || !key) return null;
      const ids = o.ids.filter((id, i) => (o.owners[i] || []).some(Boolean) && (o.boxes[i][0] === key || o.boxes[i][1] === key));
      return ids.length ? new Set(ids) : null;
    }
    _setTrace(ids, sticky) {
      if (sticky !== undefined) this._traceKeep = sticky ? ids : null;
      const next = ids || this._traceKeep || null;
      const same = (a, b) => (!a && !b) || (a && b && a.size === b.size && [...a].every((x) => b.has(x)));
      if (same(next, this._trace)) return;
      this._trace = next;
      this._applyTrace();
    }
    _applyTrace() {
      const svg = this._$.edges, o = this._ortho, tr = this._trace;
      if (!svg) return;
      svg.querySelectorAll('.trc').forEach((x) => x.remove());
      svg.querySelectorAll('.trdim, .trhi').forEach((x) => x.classList.remove('trdim', 'trhi'));
      const on = !!(tr && tr.size && o);
      this._$.board.classList.toggle('tracing', on);
      if (!on) return;
      const owns = new Set();
      o.ids.forEach((id, i) => { if (tr.has(id)) (o.owners[i] || []).forEach((w) => { if (w) owns.add(w); }); });
      const mates = new Set(o.ids.filter((id, i) => (o.owners[i] || []).some((w) => w && owns.has(w))));
      svg.querySelectorAll('path.e').forEach((p) => { if (mates.has(p.dataset.edge) && !tr.has(p.dataset.edge)) p.classList.add('trdim'); });
      tr.forEach((id) => {
        const p = svg.querySelector(`path.e[data-edge="${CSS.escape(id)}"]`);
        if (!p) return;
        const c = p.cloneNode(false);
        c.removeAttribute('data-edge');
        c.setAttribute('class', 'trc ' + [...p.classList].filter((x) => x.startsWith('role-')).join(' '));
        // on top of everything in its frame, letters included
        p.parentNode.appendChild(c);
      });
    }

    /* ---------- the Arrows menu: highlight modes (7.1) and filters (7.2) ---------- */
    _setHl(change) {
      const u = this._data.ui;
      u.hl = Object.assign({ mode: 'chain', depth: 0 }, u.hl || {}, change);
      this._save();
      this._applyFocus();
      this._refreshHl();
    }
    _refreshHl() { if (this._menuEl && this._menuEl.classList.contains('hlm') && this._menuAnchor) this._hlMenu(this._menuAnchor, true); }
    _hlMenu(btn, again) {
      const hl = Object.assign({ mode: 'chain', depth: 0 }, this._data.ui.hl || {}), f = this._model ? this._flt(this._model.label) : null;
      const modes = [['chain', T('chain'), T('what_sets_it_off_and')], ['up', T('upstream'), T('only_what_leads_to_it')],
        ['down', T('downstream'), T('only_what_it_leads_to')], ['both', T('both_ways'), T('upstream_and_downstream')], ['off', T('off'), T('only_the_selected_box')]];
      const tick = (on) => `<ha-icon icon="mdi:check"${on ? '' : ' style="visibility:hidden"'}></ha-icon>`;
      const html = `<div class="mtitle">${T('highlight_around_a_selected_box')}</div>${modes.map(([k, t, d]) => `<button class="mi" data-act="hl-mode" data-mode="${k}" title="${esc(d)}">${tick(hl.mode === k)}<span>${t}</span></button>`).join('')}<div class="mdepth ${['up', 'down', 'both'].includes(hl.mode) ? '' : 'off'}"><span>${T('reach')}</span>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="chip ${hl.depth === d ? 'on' : ''}" data-act="hl-depth" data-depth="${d}" title="${d ? T('key_2', { d: P('n_arrows_away', d), d2: d }) : T('all_the_way_key_0')}">${d || T('all')}</button>`).join('')}</div>${f ? `<div class="msep"></div><div class="mtitle">${T('show_in_this_function')}</div>${[['trigger', T('triggers_2')], ['condition', T('checked_by')], ['source', T('read_by_helper_inputs')], ['action', T('changes')], ['call', T('runs_script_calls')], ['outside', T('outside_items')], ['suggest', T('related_suggestions')]]
            .map(([k, t]) => `<button class="mi" data-act="hl-flt" data-key="${k}">${tick(f[k])}<span>${t}</span></button>`).join('')}` : ''}<div class="msep"></div><div class="mtitle">${T('arrow_style')}</div><button class="mi" data-act="hl-curved" title="${T('curved_arrows_take_the_shortest')}">${tick(this._data.ui.curved === true)}<span>${T('curved_arrows')}</span></button><div class="msep"></div><div class="mtitle">${T('live')}</div><button class="mi" data-act="hl-cond" title="${T('a_tick_or_a_cross')}">${tick(this._data.ui.condres !== false)}<span>${T('whether_each_check_passes_now')}</span></button>`;
      if (again && this._menuEl) { this._menuEl.innerHTML = html; return; }
      this._menu(btn, [], null);
      this._menuEl.classList.add('hlm');
      this._menuEl.innerHTML = html;
      const br = this._$.board.getBoundingClientRect(), ar = btn.getBoundingClientRect();
      this._menuEl.style.left = Math.round(Math.max(6, Math.min(ar.left - br.left, br.width - this._menuEl.offsetWidth - 6))) + 'px';
    }

    /* ---------- focus: causal chain through the selected item ---------- */
    _computeFocus() {
      const m = this._model, k = this._sel;
      this._focus = null; this._focusEdges = new Set(); this._focusDist = null;
      // a run or a chain from the debugger, lit step by step (9.4)
      if (m && this._lit && !k) { this._focus = new Set(this._lit.keys); this._focusEdges = new Set(this._lit.edges); return; }
      if (!m || !k || !m.nodes.has(k)) return;
      const hl = this._data.ui.hl || {};
      const r = focusSet(this._visEdges(), k, hl.mode || 'chain', hl.depth || 0);
      this._focus = new Set(r.dist.keys()); this._focusEdges = r.edges; this._focusDist = r.dist;
    }
    _select(key) {
      this._sel = key && this._model && this._model.nodes.has(key) ? key : null;
      // a selected box's arrows stay traced through the shared lines they're on (how a touch screen traces them)
      this._setTrace(this._sel ? this._busEdgesOf(this._sel) : null, !!this._sel);
      if (this._lit) this._clearLit(true);
      if (this._selEdge || !this._$.edgebar.hidden) { this._selEdge = null; this._$.edgebar.hidden = true; }
      this._applyFocus();
      if (this._drawer && this._drawer.mode === 'debug') this._renderWhy();
      if (this._sbxOn() && this._sel && !this._sel.includes(':') && this._sbx.eng.get(this._sel)) this._sbxPick(this._sel);
    }
    _applyFocus() {
      this._computeFocus();
      const F = this._focus;
      this._els.forEach((el, k) => {
        el.classList.toggle('sel', k === this._sel);
        el.classList.toggle('now', !!this._lit && this._lit.now === k);
        el.classList.toggle('dim', !!F && !F.has(k));
        // lit boxes fade a little with distance, so the layers read at a glance
        const d = F && F.has(k) && this._focusDist ? this._focusDist.get(k) : 0;
        el.style.opacity = d > 1 ? String(Math.max(0.55, 1 - (d - 1) * 0.12)) : '';
      });
      this._drawEdges();
      this._renderNodebar();
    }
    _hover(key) {
      if (this._hov === key) return;
      const old = this._hov && this._els.get(this._hov);
      if (old) old.classList.remove('hov');
      this._hov = key;
      const el = key && this._els.get(key);
      if (el) el.classList.add('hov');
    }
    _pulse(k) {
      const el = this._els.get(k);
      if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
      this._live.set(k, Date.now() + 2500);
      this._drawEdges();
      this._debounce('live', 2600, () => this._drawEdges());
    }

    _renderNodebar() {
      const bar = this._$.nodebar, m = this._model, n = m && this._sel ? m.nodes.get(this._sel) : null;
      this._$.lh.hidden = true;
      if (!n) { bar.hidden = true; return; }
      const mk = (list) => list.map(([a, i, t, off, data]) => `<button data-act="${a}" ${data || ''} ${off ? `disabled title="${esc(off)}"` : `title="${esc(t)}"`}><ha-icon icon="${i}"></ha-icon><span>${esc(t)}</span></button>`).join('');
      if (n.kind === 'tool') {
        const tid = `data-tid="${esc(n.tool.id)}"`, inj = n.tool.type === 'inject', full = this._full() ? null : FULL_ONLY_TEST;
        bar.innerHTML = `<span class="nbname">${esc(n.name)}</span>` + mk(inj
          ? [['tool-run', 'mdi:play', T('run_2'), full, tid], ['tool-edit', 'mdi:pencil-outline', T('edit_2'), full, tid], ['tool-del', 'mdi:delete-outline', T('remove'), null, tid]]
          : [['mon-clear', 'mdi:broom', T('clear'), null, tid], ['tool-del', 'mdi:delete-outline', T('remove'), null, tid]]);
        bar.hidden = false;
        this._positionNodebar();
        return;
      }
      if (this._sbxOn()) {
        const b = [], eng = this._sbx.eng;
        if (!n.key.includes(':') && eng.get(n.key)) b.push(['sbx-setbox', 'mdi:pencil-box-outline', T('sbx_set_here')]);
        if (eng.items.has(n.key)) b.push(['sbx-runbox', 'mdi:play', T('sbx_run_here')]);
        if (n.key.startsWith('event:')) b.push(['sbx-firebox', 'mdi:lightning-bolt-outline', T('sbx_fire_here')]);
        if (this._canTest(n)) b.push(['test', 'mdi:flask-outline', T('sbx_test_here')]);
        bar.innerHTML = `<span class="nbname">${esc(n.name)}</span>` + mk(b) + `<span class="nbsbx">${T('sbx_bar_note')}</span>`;
        bar.hidden = false;
        this._positionNodebar();
        return;
      }
      const st = this._hass.states[n.key];
      const logic = n.domain === 'automation' || n.domain === 'script';
      const ent = !n.key.includes(':') || n.domain === 'device';
      const btn = [];
      if (n.kind === 'nodered') btn.push(['open', 'mdi:sitemap', T('open_in_node_red')]);
      else if (logic) btn.push(['open', 'mdi:pencil-outline', T('edit_2')]);
      else if (n.domain === 'device') btn.push(['open', 'mdi:devices', T('device')]);
      else {
        const ed = this._editOf(n);
        if (ed) btn.push(['edit', 'mdi:pencil-outline', T('edit_2'), ed.off || null]);
        if (ent) btn.push(['open', 'mdi:information-outline', T('details')]);
      }
      if (logic && this._itemId(n)) btn.push(['trace', 'mdi:timeline-clock-outline', T('traces_2')]);
      if (n.domain === 'automation' && st) btn.push(['toggle', st.state === 'on' ? 'mdi:pause-circle-outline' : 'mdi:play-circle-outline', st.state === 'on' ? T('turn_off') : T('turn_on')]);
      if (n.kind === 'member') btn.push(['remove', 'mdi:link-variant-off', T('remove')]);
      else if (ent) btn.push(['add', 'mdi:link-variant-plus', T('add_to_function')]);
      if (this._full() && !n.key.includes(':') && (logic || n.domain === 'scene' || this._scopeOf(n.key) === 'helpers')) btn.push(['delete', 'mdi:delete-outline', T('delete_3')]);
      const kept = (this._layout(m.label).keep || []).includes(n.key);
      btn.push(['keep', kept ? 'mdi:pin-off-outline' : 'mdi:pin-outline', kept ? T('unpin') : T('keep_in_place')]);
      // developer tools (Phase 9)
      const tools = [];
      if (this._canTest(n)) tools.push(['test', 'mdi:flask-outline', T('test_2'), this._full() ? null : FULL_ONLY_TEST]);
      if (n.domain === 'automation' && st) tools.push(this._tw.has(n.key) ? ['watch', 'mdi:eye-off-outline', T('stop_watching')] : ['watch', 'mdi:eye-outline', T('watch_triggers')]);
      if (/^(event|nact):/.test(n.key) || (n.key.startsWith('mqtt:') && (this._hass.config.components || []).includes('mqtt'))) tools.push(['monitor', 'mdi:monitor-eye', T('monitor')]);
      if (n.key.startsWith('svc:notify.') || (n.domain === 'notify' && st)) tools.push(['messages', 'mdi:message-text-clock-outline', T('messages')]);
      if (this._canLink(n)) tools.push(['connect', 'mdi:vector-polyline-plus', T('connect'), this._full() ? null : T('drawing_arrows_needs_full_manager')]);
      bar.innerHTML = `<span class="nbname">${esc(n.name)}</span>` + mk(btn.map(([a, i, t, off]) => [a, i, t, off || null, a === 'toggle' && st ? `data-state="${esc(st.state)}"` : '']))
        + (tools.length ? '<span class="nbsep"></span>' + mk(tools) : '');
      bar.hidden = false;
      this._positionNodebar();
    }
    _positionNodebar() {
      const bar = this._$.nodebar;
      if (bar.hidden || !this._model) return;
      const n = this._model.nodes.get(this._sel);
      if (!n) return;
      // the bar sits above the box (translateY(-100%)); keep all of it inside the board, beside an open drawer:
      // it wraps onto a second line when it doesn't fit. Measure it at the left edge: placed near the right edge,
      // it would shrink to the room left there and be measured too narrow.
      const W = this._openWidth();
      bar.style.maxWidth = Math.max(160, W - 12) + 'px';
      bar.style.left = '0px';
      const v = this._view, H = this._$.vp.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
      bar.style.left = Math.max(6, Math.min(n.x * v.k + v.x, W - bw - 6)) + 'px';
      bar.style.top = Math.max(bh + 6, Math.min(n.y * v.k + v.y - 8, H - 6)) + 'px';
      // the handle to draw an arrow from (7.5), on the box's right edge
      const lh = this._$.lh, show = this._full() && this._canLink(n);
      lh.hidden = !show;
      // out by the right edge, or the bottom one top to bottom
      if (show) { const V = this._vert(); lh.style.left = ((V ? n.x + n.w / 2 : n.x + n.w) * v.k + v.x) + 'px'; lh.style.top = ((V ? n.y + n.h : n.y + n.h / 2) * v.k + v.y) + 'px'; }
    }

    _setEmpty() {
      const e = this._$.empty;
      e.classList.remove('wel');
      this._$.board.classList.toggle('firstrun', !this._data.functions.length);
      if (!this._data.functions.length) {
        e.hidden = false;
        e.classList.add('wel');
        e.innerHTML = `<div class="welcome"><ha-icon icon="mdi:sitemap-outline"></ha-icon><h2>${T('welcome_to_functions')}</h2><p>${T('a_function_is_everything_that')}</p><ol><li><b>${T('import_2')}</b> ${T('finds_the_functions_already_in')}</li><li>${T('or_start_a')} <b>${T('new_function_3')}</b> ${T('and_build_it_with_home')}</li><li>${T('open_a_function_to_see')}</li></ol><div class="wbtns"><button class="primary" data-act="import">${T('import_from_my_setup')}</button><button data-act="newfn">${T('new_function_2')}</button></div><p class="safe"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span>${this._full()
            ? T('a_function_is_a_home_2')
            : T('a_function_is_a_home')}</span></p></div>`;
        return;
      }
      if (this._model && !this._visibleKeys().size) {
        e.hidden = false;
        e.innerHTML = `<div><b>${T('nothing_in_this_function_yet')}</b><br>${T('add_pieces_with_automation_script')}</div>`;
        return;
      }
      e.hidden = true;
    }

    _renderList() {
      if (!this._data) return;
      this._$.board.classList.toggle('nolist', this._compact ? !this._listOpen : !this._data.ui.list);
      const items = this._data.functions.map((lid) => {
        const l = this._labelMap.get(lid);
        if (!l) return '';
        const mem = this._ents.filter((e) => (e.labels || []).includes(lid));
        const devs = this._devs.filter((d) => (d.labels || []).includes(lid)).length;
        const unav = mem.some((e) => this._hass.states[e.entity_id] && this._hass.states[e.entity_id].state === 'unavailable');
        const txt = [this._countText(mem.map((e) => e.entity_id)), devs ? P('n_devices', devs) : ''].filter(Boolean).join(' · ');
        return `<div class="fnrow"><button class="fn ${lid === this._data.ui.current ? 'cur' : ''}" data-fn="${esc(lid)}"><ha-icon icon="${esc(l.icon || 'mdi:puzzle-outline')}" style="color:${cssColor(l.color)}"></ha-icon><span class="fnt"><span class="fnn">${esc(l.name)}</span><span class="fnc">${esc(txt) || 'empty'}</span></span>${unav ? `<span class="dot warn" title="${T('something_in_this_function_is')}"></span>` : ''}</button><button class="ib fnmore" data-act="fn-menu" data-label="${esc(lid)}" title="${T('edit_hide_or_delete', { name: esc(l.name) })}"><ha-icon icon="mdi:dots-vertical"></ha-icon></button></div>`;
      }).join('');
      const act = this.shadowRoot.activeElement, typing = act && act.classList && act.classList.contains('find'), caret = typing ? act.selectionStart : 0;
      this._$.list.innerHTML = `<div class="lhead"><span>${T('functions')}</span><span><button data-act="import" title="${T('import_find_the_functions_already')}"><ha-icon icon="mdi:import"></ha-icon></button><button data-act="newfn" title="${T('new_empty_function')}"><ha-icon icon="mdi:plus"></ha-icon></button></span></div><div class="lfind"><ha-icon icon="mdi:magnify"></ha-icon><input class="find" placeholder="${T('find_an_automation_helper_device')}" value="${esc(this._findQ || '')}" aria-label="${T('find_anything')}">${this._findQ ? `<button class="ib" data-act="find-x" title="${T('clear')}"><ha-icon icon="mdi:close"></ha-icon></button>` : ''}</div><div class="fns">${this._findQ ? this._findHTML() : items || `<div class="muted pad">${T('no_functions_yet_press_import')}</div>`}</div><div class="lfoot"><button class="lbtn" data-act="import"><ha-icon icon="mdi:import"></ha-icon>${T('import_manager')}</button><div class="ver"><span>${T('functions_board_v_prototype', { version: VERSION })}</span><button class="ib" data-act="about" title="${T('about_and_what_the_board')}"><ha-icon icon="mdi:help-circle-outline"></ha-icon></button></div></div>`;
      if (typing) { const f = this._$.list.querySelector('.find'); if (f) { f.focus(); f.setSelectionRange(caret, caret); } }
    }
    // find anything across the whole system, and where it lives (4.4)
    _findHTML() {
      const terms = String(this._findQ || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return '';
      const rank = { automation: 0, script: 1, helpers: 2, devices: 3, entities: 4 };
      const rows = this._pickIndex().filter((r) => !r.diag && terms.every((t) => r.hay.includes(t)))
        .map((r) => ({ r, s: r.name.toLowerCase().startsWith(terms[0]) ? 0 : 1 }))
        .sort((x, y) => x.s - y.s || rank[x.r.type] - rank[y.r.type] || x.r.name.localeCompare(y.r.name)).slice(0, 40).map((x) => x.r);
      if (!rows.length) return `<div class="muted pad">${T('nothing_matches')}</div>`;
      const fset = new Set(this._data.functions);
      return rows.map((r) => {
        const fns = r.labels.filter((l) => fset.has(l));
        return `<div class="fres"><button class="fgo" data-act="find-go" data-key="${esc(r.key)}" title="${fns.length ? T('open_it_on_its_board') : T('in_no_function_yet')}">`
          + `<span class="tag">${esc(r.tag)}</span><span class="mn"><b>${esc(r.name)}</b><small>${esc(r.key.startsWith('device:') ? r.sub : r.key)}</small></span></button>`
          + `<div class="fin">${fns.length ? fns.map((l) => `<button class="chip" data-act="find-in" data-key="${esc(r.key)}" data-label="${esc(l)}">${esc(this._fnName(l))}</button>`).join('')
            : `<span class="muted small">${T('in_no_function')}</span><button class="chip" data-act="find-add" data-key="${esc(r.key)}">${T('add_to_3')}</button>`}</div></div>`;
      }).join('');
    }
    _findGo(key, label) {
      const r = this._pickIndex().find((x) => x.key === key);
      const fns = r ? r.labels.filter((l) => this._data.functions.includes(l)) : [];
      const to = label || (fns.includes(this._data.ui.current) ? this._data.ui.current : fns[0]);
      if (!to) return false;
      if (this._compact) this._listOpen = false;
      this._closeDrawer();
      if (to === this._data.ui.current && this._model && this._model.nodes.has(key)) { this._select(key); this._centerOn(key); this._renderList(); return true; }
      this._pendingSelect = key;
      this._open(to);
      return true;
    }
    _findAdd(btn, key) {
      this._menu(btn, this._data.functions.map((l) => ({ act: 'find-to', data: { key, label: l }, icon: (this._labelMap.get(l) || {}).icon || 'mdi:puzzle-outline', text: this._fnName(l) })), T('add_to_2'));
    }
    async _findTo(key, label) {
      this._closeMenu();
      const r = await this._labelMany([key], label, true);
      if (!r.done.length) { this._toast(T('could_not_add_2', { why: (r.skipped[0] || {}).why || '' })); return; }
      await this._loadRegistries();
      this._pidx = null;
      this._toast(T('added_to_4', { fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
      this._findGo(key, label);
    }

    _renderHeader() {
      const vb = this._$.tools && this._$.tools.querySelector('[data-act="versions"]');
      if (vb) vb.hidden = !this._verOK();
      const l = this._labelMap.get(this._data && this._data.ui.current);
      const t = this._$.title;
      if (!l) { t.innerHTML = `<span class="muted">${T('functions')}</span>`; this._$.tools.hidden = true; return; }
      this._$.tools.hidden = false;
      t.innerHTML = `<ha-icon icon="${esc(l.icon || 'mdi:puzzle-outline')}" style="color:${cssColor(l.color)}"></ha-icon><div class="tt"><div class="ttl">${esc(l.name)}</div>${l.description ? `<div class="desc">${esc(l.description)}</div>` : ''}</div><button class="ib" data-act="fn-edit" title="${T('edit_name_icon_colour_and')}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button><button class="ib" data-act="fn-menu" data-label="${esc(l.label_id)}" title="${T('hide_or_delete_this_function')}"><ha-icon icon="mdi:dots-vertical"></ha-icon></button>`;
      this._renderPause();
    }

    _isOn(id) { const st = this._hass.states[id]; return !!st && st.state === 'on'; }
    _pauseState() {
      const m = this._model;
      if (!m) return null;
      const ids = [...m.nodes.values()].filter((n) => n.kind === 'member' && n.domain === 'automation').map((n) => n.key);
      const L = this._layout(m.label), paused = Array.isArray(L.paused) ? L.paused : null;
      if (!ids.length && !paused) return null;
      return { ids, total: ids.length, on: ids.filter((id) => this._isOn(id)).length, paused };
    }
    _renderPause() {
      const b = this._$.pause, p = this._pauseState();
      if (!p) { b.hidden = true; return; }
      b.hidden = false;
      if (b.dataset.confirm) return;
      // Resume shows while the function is paused, even if someone switched one back on by hand
      const resume = p.paused ? true : p.on === 0, sig = p.on + '/' + p.total + '/' + (p.paused ? p.paused.length : '-');
      if (b.dataset.sig === sig) return;
      b.dataset.sig = sig;
      b.innerHTML = `<ha-icon icon="${resume ? 'mdi:play-circle-outline' : 'mdi:pause-circle-outline'}"></ha-icon><span>${resume ? T('resume_2') : T('pause')}</span>`;
      b.title = p.paused ? T('turn_back_on_the_that', { count: P('n_automations', p.paused.length) })
        : resume ? T('turn_the_in_this_function', { total: P('n_automations', p.total) })
          : T('turn_off_the_that_are', { on: P('n_automations', p.on) });
    }
    _pause(b) {
      const p = this._pauseState(), label = this._data.ui.current;
      if (!p) return;
      if (this._sbxOn()) { this._toast(T('sbx_no_pause')); return; }
      const L = this._layout(label), name = this._fnName(label);
      const call = (service, ids) => this._hass.callService('automation', service, {}, { entity_id: ids });
      const done = () => { delete b.dataset.sig; this._renderPause(); };
      if (p.paused) {
        const ids = p.paused.filter((id) => this._hass.states[id]);
        this._twoStep(b, T('turn_on_2', { count: P('n_automations', ids.length) }), async () => {
          try {
            if (ids.length) await call('turn_on', ids);
            delete L.paused; this._save();
            this._history({ label, text: T('resume', { name }), undo: async () => { L.paused = ids; this._save(); if (ids.length) await call('turn_off', ids); }, redo: async () => { delete L.paused; this._save(); if (ids.length) await call('turn_on', ids); } });
            this._toast(T('resumed_back_on', { count: P('n_automations', ids.length) }));
          } catch (e) { this._toast(T('failed_3', { message: e.message || e.code })); }
          done();
        });
      } else if (p.on > 0) {
        const ids = p.ids.filter((id) => this._isOn(id));
        this._twoStep(b, T('turn_off_and_stop_runs', { count: P('n_automations', ids.length) }), async () => {
          L.paused = ids; this._save();
          try {
            await call('turn_off', ids);
            this._history({ label, text: T('pause_2', { name }), undo: async () => { delete L.paused; this._save(); await call('turn_on', ids); }, redo: async () => { L.paused = ids; this._save(); await call('turn_off', ids); } });
            this._toast(T('paused_off_until_you_resume', { count: P('n_automations', ids.length) }));
          } catch (e) { delete L.paused; this._save(); this._toast(T('failed_3', { message: e.message || e.code })); }
          done();
        });
      } else {
        // paused before v0.3.1 (no saved list) or switched off by hand: the only choice is all of them
        this._twoStep(b, T('turn_on_all', { total: P('n_automations', p.total) }), async () => {
          try { await call('turn_on', p.ids); this._toast(T('turned_on', { total: P('n_automations', p.total) })); } catch (e) { this._toast(T('failed_3', { message: e.message || e.code })); }
          done();
        });
      }
    }

    _renderLegend() {
      const u0 = (this._data && this._data.ui) || { legend: true, outside: true, suggest: true };
      const u = this._model ? Object.assign({}, u0, this._flt(this._model.label)) : u0;
      const open = this._compact ? !!this._legendOpen : u.legend;
      const line = (cls) => `<svg width="38" height="10"><path class="${cls}" d="M4,5 L30,5"></path><path class="ah ${cls}" d="M30,1 L37,5 L30,9 z"></path>${cls === 'role-trigger' ? '<circle class="ah trig" cx="4" cy="5" r="3.5"></circle>' : ''}</svg>`;
      this._$.legend.innerHTML = `<button class="lgt" data-act="legend"><ha-icon icon="mdi:map-legend"></ha-icon>${open ? T('hide_key') : T('key')}</button>`
        + (open ? `<div class="lg">${line('role-trigger')}<span>${T('triggers')}</span>${line('role-condition')}<span>${T('is_checked_or_read_by')}</span>${line('role-action')}<span>${T('changes_2')}</span>${line('role-call')}<span>${T('runs_script_call')}</span>${line('role-source')}<span>${T('is_read_by_a_helper')}</span>${line('loop')}<span>${T('loop_can_retrigger_itself')}</span>${line('role-tool')}<span>${T('a_test_button_or_a')}</span>`
          + `<svg width="38" height="14"><path d="M4,3 L16,3 L16,11 L30,11"></path><path d="M16,3 L30,3"></path><circle cx="16" cy="3" r="2.6" style="fill:var(--fb-edge)"></circle></svg><span>${T('one_line_that_branches_dot')}</span>`
          + `<svg width="38" height="14"><path d="M19,1 L19,13"></path><path d="M4,8 L15,8 A4,4 0 0 1 23,8 L34,8"></path></svg><span>${T('crosses_without_meeting')}</span>`
          + `<svg width="38" height="14"><path d="M4,7 L34,7"></path><path class="ah" d="M15,7 L23,2.5 L23,11.5 z"></path></svg><span>${T('runs_back')}</span></div><div class="lgn"><span class="sw dashed"></span>${T('related_not_in_this_function')}<br><span class="sw pill"></span>${T('outside_item_it_touches')}<br><span class="sw st amber"></span>${T('unavailable')}<span class="sw st red"></span>${T('last_run_failed')}<span class="sw st blue"></span>${T('running')}<br><span class="cres-k ok">✓</span><span class="cres-k bad">✕</span> ${T('a_check_passes_or_fails')}<br><span class="sw dashed2"></span>${T('simulated_state')}${this._sbxOn() ? `<br><span class="sw sbk"></span>${T('sbx_changed_key')}<br><span class="sw sbg"></span>${T('sbx_ghost_key')}` : ''}</div><label class="tg"><input type="checkbox" data-tog="outside" ${u.outside ? 'checked' : ''}>${T('show_outside_items')}</label><label class="tg"><input type="checkbox" data-tog="suggest" ${u.suggest ? 'checked' : ''}>${T('show_related_suggestions')}</label><label class="tg" title="${T('reads_your_node_red_app')}"><input type="checkbox" data-nr ${u0.nodered === true ? 'checked' : ''}>${T('show_node_red_flows')}</label>${u0.nodered === true && this._nrCache && this._nrCache.err ? `<div class="lgerr">${esc(this._nrCache.err)}${this._nrCache.need ? ` <button class="lgbtn" data-act="nr-open">${T('open_node_red')}</button>` : ''}</div>` : ''}` : '');
    }

    /* ---------- view ---------- */
    _applyView() {
      const v = this._view;
      this._$.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
      this._$.vp.style.backgroundSize = `${22 * v.k}px ${22 * v.k}px`;
      this._$.vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
      this._positionNodebar();
    }
    _saveView() {
      this._debounce('view', 800, () => {
        if (!this._model) return;
        const u = this._data.ui;
        (u.views = u.views || {})[this._viewKey(this._model.label)] = { x: Math.round(this._view.x), y: Math.round(this._view.y), k: +this._view.k.toFixed(3) };
        this._save();
      });
    }
    _zoomAt(cx, cy, f) {
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      const k = Math.min(2.5, Math.max(0.15, v.k * f)), px = cx - r.left, py = cy - r.top, s = k / v.k;
      v.x = px - (px - v.x) * s; v.y = py - (py - v.y) * s; v.k = k;
      this._fitNext = null;
      this._applyView();
      this._saveView();
    }
    _zoomCenter(f) { const r = this._$.vp.getBoundingClientRect(); this._zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
    _center() {
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      return { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k };
    }
    // Fit cycles when a system is too wide to read whole: the readable fit (60% or more), then everything (down to 25%)
    _fitPress() { this._fit({ all: this._fitNext === 'all' }); }
    _fit(opt = {}, tries = 0) {
      const m = this._model;
      if (!m || !this.isConnected) return;
      const r = this._$.vp.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) { if (tries < 20) setTimeout(() => this._fit(opt, tries + 1), 250); return; }
      const L = this._layout(m.label), vis = this._visibleKeys();
      const boxes = [...vis].map((k) => m.nodes.get(k)).map((n) => [n.x, n.y, n.x + n.w, n.y + n.h])
        .concat(L.frames.map((f) => [f.x, f.y, f.x + f.w, f.y + f.h]))
        .concat(L.notes.map((n) => [n.x, n.y, n.x + (n.w || 240), n.y + 120]));
      if (!boxes.length) { this._view = { x: 40, y: 40, k: 1 }; this._applyView(); return; }
      const pad = 60, MIN = opt.all ? 0.25 : 0.6;
      const bbox = (bs) => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
      let [x0, y0, x1, y1] = bbox(boxes);
      const tooBig = (b) => (b[2] - b[0]) * 0.6 > r.width - pad * 2 || (b[3] - b[1]) * 0.6 > r.height - pad * 2;
      const whole = [x0, y0, x1, y1];
      if (!opt.all && vis.size && tooBig(whole)) {
        // too big to show whole at a readable zoom: frame the boxes themselves rather than far-off frames and notes
        [x0, y0, x1, y1] = bbox(boxes.slice(0, vis.size));
      }
      const kf = Math.min((r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0));
      const k = Math.min(1.2, Math.max(MIN, kf));
      // what the next press does: show everything when this fit cut something off, else the readable fit again
      this._fitNext = !opt.all && tooBig(whole) ? 'all' : null;
      const fb = this._$.vp.querySelector('[data-act="fit"]');
      if (fb) fb.title = this._fitNext === 'all' ? T('zoom_out_to_show_everything') : opt.all ? T('back_to_a_readable_size') : T('fit_everything');
      if (opt.all) this._fitNext = 'readable';
      const x = (x1 - x0) * k <= r.width - pad * 2 ? (r.width - (x1 - x0) * k) / 2 - x0 * k : pad - x0 * k;
      const y = (y1 - y0) * k <= r.height - pad * 2 ? (r.height - (y1 - y0) * k) / 2 - y0 * k : pad - y0 * k;
      this._view = { k, x, y };
      this._applyView();
      this._saveView();
    }
    // Auto-arrange: every box goes where the automatic layout puts it, boxes you moved by hand included, except
    // those you chose to keep in place
    _arrangeData(label) {
      const L = this._layout(label), keep = new Set(L.keep || []), nodes = {};
      Object.entries(L.nodes || {}).forEach(([k, p]) => { if (keep.has(k)) nodes[k] = p; });
      L.nodes = nodes;
    }
    _arrange() {
      const label = this._model.label, before = this._snap(label);
      this._arrangeData(label);
      this._place(); this._render(); this._fit(); this._save();
      this._layoutStep(label, before, T('arrange'));
    }
    // Auto-arrange, and which way the function flows
    _arrangeMenu(btn) {
      const V = this._vert(), chk = (on) => (on ? 'mdi:check' : 'mdi:blank');
      this._menu(btn, [
        { act: 'arr-go', icon: 'mdi:auto-fix', text: T('auto_arrange_now') },
        { sep: true },
        { act: 'arr-dir', data: { dir: 'right' }, icon: chk(!V), text: T('flow_left_to_right'), title: T('flow_switch_t') },
        { act: 'arr-dir', data: { dir: 'down' }, icon: chk(V), text: T('flow_top_to_bottom'), title: T('flow_switch_t') },
      ], T('arrange'));
    }
    // a new direction lays the whole function out again: boxes kept in place are let go too, since where they were
    // kept makes no sense turned a quarter turn. Undo puts the direction, the places and what was kept back
    _setDir(dir) {
      const label = this._model.label, L = this._layout(label), want = dir === 'down' ? 'down' : 'right';
      if ((L.dir || 'right') === want) return;
      const before = this._snap(label), kept = (L.keep || []).length;
      L.dir = want;
      L.keep = [];
      L.nodes = {};
      this._place(); this._render(); this._fit(); this._save();
      this._layoutStep(label, before, want === 'down' ? T('flow_top_to_bottom') : T('flow_left_to_right'));
      this._toast(kept ? P('flow_switched_kept', kept) : T('flow_switched'), [{ text: T('undo'), fn: () => this._undo() }]);
    }

    // moving a box by hand keeps every other box where it is now too: the function is arranged by hand from then
    // on, until Auto-arrange
    _freeze(L) {
      const m = this._model;
      this._visibleKeys().forEach((k) => { const n = m.nodes.get(k); if (n && !L.nodes[k] && !k.startsWith('tool:')) L.nodes[k] = { x: n.x, y: n.y }; });
    }
    // keep a box in place: Auto-arrange (and an import's) leaves it where it is
    _toggleKeep(key) {
      const m = this._model, n = m && m.nodes.get(key);
      if (!n) return;
      const label = m.label, L = this._layout(label), before = this._snap(label), keep = new Set(L.keep || []);
      if (keep.has(key)) keep.delete(key);
      else { keep.add(key); L.nodes[key] = { x: n.x, y: n.y }; }
      if (keep.size) L.keep = [...keep]; else delete L.keep;
      this._save();
      this._layoutStep(label, before, keep.has(key) ? T('keep_name_in_place', { name: n.name }) : T('let_auto_arrange_move_name', { name: n.name }));
      this._render();
    }

    /* ---------- pointer: pan, zoom, drag nodes / frames / notes ---------- */
    _listen(on) {
      if (!this._mv) { this._mv = (e) => this._onMove(e); this._up = (e) => this._onUp(e); }
      if (on && !this._listening) {
        window.addEventListener('pointermove', this._mv); window.addEventListener('pointerup', this._up); window.addEventListener('pointercancel', this._up);
        this._listening = true;
      } else if (!on && this._listening) {
        window.removeEventListener('pointermove', this._mv); window.removeEventListener('pointerup', this._up); window.removeEventListener('pointercancel', this._up);
        this._listening = false;
      }
    }
    _onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // drawing an arrow (7.5): from the handle by dragging, or by clicking the other box
      if (e.target.closest('.lh') && this._sel) {
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this._listen(true);
        this._startLink(this._sel, true);
        if (this._linking) { this._linking.sx = e.clientX; this._linking.sy = e.clientY; }
        return;
      }
      // or from one of a box's points: from a right-hand one out of the box, from a left-hand one into it
      const port = this._full() && e.target.closest('.port');
      if (port) {
        const key = port.closest('.node').dataset.key;
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this._listen(true);
        this._startLink(key, true, port.classList.contains('pl'));
        if (this._linking) { this._linking.sx = e.clientX; this._linking.sy = e.clientY; }
        return;
      }
      if (this._linking) {
        const node = e.target.closest('.node'), L = this._linking;
        this._endLink();
        if (node && node.dataset.key !== L.from) this._linkDialog(L.rev ? node.dataset.key : L.from, L.rev ? L.from : node.dataset.key);
        return;
      }
      if (e.target.closest('button, select, input, textarea, .nodebar, .edgebar, .zoom, .legend, .toast, .litbar, .flow .ghost, .flow .fnum')) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._listen(true);
      if (this._pointers.size === 2) {
        this._dropHold(this._drag);
        const [p, q] = [...this._pointers.values()];
        this._drag = { type: 'pinch', d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, v0: Object.assign({}, this._view), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
        return;
      }
      if (this._pointers.size > 2) return;
      const base = { sx: e.clientX, sy: e.clientY, moved: false }, m = this._model, L = m && this._layout(m.label);
      const nodeEl = e.target.closest('.node'), fres = e.target.closest('.fresize'), fhead = e.target.closest('.fhead'), nhead = e.target.closest('.nhead');
      if (nodeEl && m) {
        const n = m.nodes.get(nodeEl.dataset.key);
        if (n) { this._grab(e, Object.assign(base, { type: 'node', n, el: nodeEl, ox: n.x, oy: n.y, before: this._snap(m.label) })); return; }
      }
      if (fres && L) {
        const f = L.frames.find((x) => x.id === fres.dataset.fid);
        if (f) { this._drag = Object.assign(base, { type: 'resize', f, el: fres.parentElement, ow: f.w, oh: f.h, before: this._snap(m.label) }); return; }
      }
      if (fhead && L) {
        const f = L.frames.find((x) => x.id === fhead.dataset.fid);
        if (f) { this._grab(e, Object.assign(base, { type: 'frame', f, el: fhead.parentElement, ox: f.x, oy: f.y, items: this._inFrame(f), before: this._snap(m.label) })); return; }
      }
      if (nhead && L) {
        const nt = L.notes.find((x) => x.id === nhead.dataset.nid);
        if (nt) { this._grab(e, Object.assign(base, { type: 'note', nt, el: nhead.parentElement, ox: nt.x, oy: nt.y, before: this._snap(m.label) })); return; }
      }
      this._drag = Object.assign(base, { type: 'pan', ox: this._view.x, oy: this._view.y });
    }
    // On a touch screen a box, frame or note moves only after it has been held still for a second. A finger
    // that moves sooner pans the board, so swiping across boxes to look around doesn't drag them along.
    _grab(e, d) {
      this._drag = d;
      if (e.pointerType !== 'touch') return;
      d.touch = true; d.wait = true;
      d.timer = setTimeout(() => {
        if (this._drag !== d || !d.wait) return;
        d.wait = false;
        if (d.el) d.el.classList.add('lifted');
        try { if (navigator.vibrate) navigator.vibrate(20); } catch (err) { /* no buzz on this phone */ }
      }, HOLD_MS);
    }
    _dropHold(d) {
      if (!d) return;
      clearTimeout(d.timer); d.wait = false;
      if (d.el) d.el.classList.remove('lifted');
    }
    _inFrame(f) {
      const items = [], inside = (x, y) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h;
      this._els.forEach((el, k) => {
        const n = this._model.nodes.get(k);
        if (n && inside(n.x + n.w / 2, n.y + n.h / 2)) items.push({ n, el, ox: n.x, oy: n.y });
      });
      this._layout(this._model.label).notes.forEach((nt) => {
        if (inside(nt.x + 20, nt.y + 10)) items.push({ nt, el: this._$.notes.querySelector(`.note[data-nid="${nt.id}"]`), ox: nt.x, oy: nt.y });
      });
      return items;
    }
    _onMove(e) {
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._linking && this._linking.drag) { this._linkMove(e); return; }
      let d = this._drag;
      if (!d) return;
      if (d.type === 'pinch') {
        if (this._pointers.size < 2) return;
        const [p, q] = [...this._pointers.values()];
        this._view = Object.assign({}, d.v0);
        this._zoomAt(d.mx, d.my, Math.hypot(p.x - q.x, p.y - q.y) / d.d0);
        return;
      }
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.wait) {
        // a finger can wobble a little while it holds; past that, before the second is up, it's a pan
        if (Math.hypot(dx, dy) < 10) return;
        this._dropHold(d);
        d = this._drag = { type: 'pan', touch: true, sx: d.sx, sy: d.sy, moved: false, ox: this._view.x, oy: this._view.y };
      }
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      const k = this._view.k, mv = (o, x, y) => { o.x = Math.round(x); o.y = Math.round(y); };
      if (d.type === 'pan') { this._view.x = d.ox + dx; this._view.y = d.oy + dy; this._applyView(); return; }
      if (d.type === 'resize') {
        d.f.w = Math.max(200, Math.round(d.ow + dx / k)); d.f.h = Math.max(120, Math.round(d.oh + dy / k));
        d.el.style.width = d.f.w + 'px'; d.el.style.height = d.f.h + 'px';
        return;
      }
      if (d.type === 'note') { mv(d.nt, d.ox + dx / k, d.oy + dy / k); d.el.style.left = d.nt.x + 'px'; d.el.style.top = d.nt.y + 'px'; return; }
      if (d.type === 'node') { mv(d.n, d.ox + dx / k, d.oy + dy / k); d.el.style.left = d.n.x + 'px'; d.el.style.top = d.n.y + 'px'; }
      if (d.type === 'frame') {
        mv(d.f, d.ox + dx / k, d.oy + dy / k);
        d.el.style.left = d.f.x + 'px'; d.el.style.top = d.f.y + 'px';
        d.items.forEach((it) => {
          const o = it.n || it.nt;
          mv(o, it.ox + dx / k, it.oy + dy / k);
          if (it.el) { it.el.style.left = o.x + 'px'; it.el.style.top = o.y + 'px'; }
        });
      }
      if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this._drawEdges(); this._positionNodebar(); });
    }
    _onUp(e) {
      this._pointers.delete(e.pointerId);
      if (!this._pointers.size) this._listen(false);
      if (this._linking && this._linking.drag) {
        const L = this._linking, hit = this.shadowRoot.elementFromPoint(e.clientX, e.clientY), node = hit && hit.closest && hit.closest('.node');
        const moved = Math.hypot(e.clientX - (L.sx || e.clientX), e.clientY - (L.sy || e.clientY)) > 6;
        if (node && node.dataset.key !== L.from) { this._endLink(); this._linkDialog(L.rev ? node.dataset.key : L.from, L.rev ? L.from : node.dataset.key); }
        else if (moved) this._endLink();
        else L.drag = false;  // a click on the handle: now click the other box
        return;
      }
      const d = this._drag;
      if (!d) return;
      if (d.type === 'pinch') { if (this._pointers.size < 2) { this._drag = null; this._saveView(); } return; }
      this._drag = null;
      this._dropHold(d);
      const label = this._model && this._model.label, L = label && this._layout(label);
      if (d.type === 'node') {
        if (!d.moved) this._select(d.n.key);
        else { this._freeze(L); L.nodes[d.n.key] = { x: d.n.x, y: d.n.y }; this._save(); this._drawEdges(); this._layoutStep(label, d.before, T('move', { name: d.n.name })); }
      } else if (d.type === 'pan') {
        if (!d.moved) this._select(null); else { this._fitNext = null; this._saveView(); }
      } else if (d.type === 'frame' && d.moved) {
        this._freeze(L);
        d.items.forEach((it) => { if (it.n) L.nodes[it.n.key] = { x: it.n.x, y: it.n.y }; });
        this._save(); this._drawEdges(); this._layoutStep(label, d.before, T('move_frame'));
      } else if ((d.type === 'resize' || d.type === 'note') && d.moved) { this._save(); this._layoutStep(label, d.before, d.type === 'resize' ? T('resize_frame') : T('move_note')); }
    }
    _onWheel(e) {
      e.preventDefault();
      this._zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }

    /* ---------- clicks, inputs, keys ---------- */
    _onClick(ev) {
      const el = ev.target.closest('[data-act],[data-fn],[data-run]');
      if (this._menuEl && !(el && this._menuEl.contains(el)) && !(this._menuAnchor && this._menuAnchor.contains(ev.target))) this._closeMenu();
      if (!el || el.tagName === 'SELECT') return;
      if (el.dataset.fn) {
        this._closeDrawer();
        if (this._compact) this._listOpen = false;
        this._open(el.dataset.fn);
        return;
      }
      if (el.dataset.run != null) { this._openRun(+el.dataset.run); return; }
      const a = el.dataset.act, label = this._data && this._data.ui.current;
      const need = () => { if (!label) { this._toast(T('create_or_pick_a_function')); return false; } return true; };
      if (a && this._ver && !VER_OK_ACTS.test(a)) { this._toast(T('ver_readonly')); return; }
      if (a && a.startsWith('sbx-') && a !== 'sbx-start' && a !== 'sbx-about' && this._sbxOn()) { this._sbxBox(a, el); return; }
      switch (a) {
        case 'sandbox': if (need()) { if (this._sbxOn()) this._closeDrawer(); else if (this._data.ui.sbxIntro === false) this._openSandbox(); else this._sbxIntro(); } break;
        case 'sbx-start': {
          // "don't show this again" is yours alone (saved with your display settings); the i in the drawer shows it again
          const skip = this._$.modal.querySelector('input[name="sbxskip"]');
          if (skip) { if (skip.checked) this._data.ui.sbxIntro = false; else delete this._data.ui.sbxIntro; this._save(); }
          this._closeModal();
          if (!this._sbxOn()) this._openSandbox();
          break;
        }
        case 'sbx-about': this._sbxIntro(); break;
        case 'togglelist':
          if (this._compact) this._listOpen = !this._listOpen;
          else if (this._data) { this._data.ui.list = !this._data.ui.list; this._save(); }
          this._renderList(); break;
        case 'newfn': this._fnModal(null); break;
        case 'fn-edit': if (need()) this._fnModal(label); break;
        case 'fn-hide': if (need()) this._twoStep(el, T('hide_from_board_2'), () => this._hideFunction(label)); break;
        case 'fn-goto': this._closeModal(); this._open(el.dataset.label); break;
        case 'fn-restore': this._restoreFn(el.dataset.label); break;
        case 'fn-rename': { const i = this._$.modal.querySelector('input[name=name]'), c = this._$.modal.querySelector('.clash'); if (c) c.remove(); if (i) { i.focus(); i.select(); } break; }
        case 'modal-cancel': this._closeModal(); break;
        case 'modal-save': this._saveFn(); break;
        case 'new-automation': if (need()) this._create('automation'); break;
        case 'new-script': if (need()) this._create('script'); break;
        case 'new-helper': if (need()) { if (this._menuEl && this._menuAnchor === el) this._closeMenu(); else this._helperMenu(el); } break;
        case 'mk-helper': if (need()) this._create('helper', el.dataset.domain, el.dataset.name); break;
        case 'mk-scene': if (need()) this._create('scene'); break;
        case 'mk-more': this._helperMoreMenu(); break;
        case 'mk-back': this._helperMenu(this._menuAnchor); break;
        case 'add-existing': this._openManager('pick', label || '__new'); break;
        case 'import': this._openManager('detect'); break;
        case 'about': this._aboutModal(); break;
        case 'diag': this._diagModal(el.dataset.ver || null); break;
        case 'diag-go': this._diagGo(false); break;
        case 'diag-copy': this._diagGo(true); break;
        case 'hamenu': this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true })); break;
        case 'hint-x': this._data.ui.hintOff = true; this._save(); this._applyMode(); break;
        case 'mgr-tab': {
          const g = this._mgr;
          g.tab = el.dataset.tab;
          if (g.tab === 'detect' && !g.cands && !g.scanning) this._scanFunctions(); else this._renderManager();
          break;
        }
        case 'mgr-left': this._mgr.leftOpen = !this._mgr.leftOpen; this._renderManager(); break;
        case 'find-x': this._findQ = ''; this._renderList(); break;
        case 'find-go': if (!this._findGo(el.dataset.key)) this._findAdd(el, el.dataset.key); break;
        case 'find-in': this._findGo(el.dataset.key, el.dataset.label); break;
        case 'find-add': this._findAdd(el, el.dataset.key); break;
        case 'find-to': this._findTo(el.dataset.key, el.dataset.label); break;
        case 'left-add': this._leftAddMenu(el, el.dataset.id); break;
        case 'left-to': this._leftTo(el.dataset.id, el.dataset.label); break;
        case 'left-new': this._leftNew(el.dataset.id); break;
        case 'mgr-expand': { const x = this._mgr.expanded, i = +el.dataset.ci; if (x.has(i)) x.delete(i); else x.add(i); this._renderManager(); break; }
        case 'mgr-import-one': this._mgrImport([+el.dataset.ci]); break;
        case 'mgr-import-sel': this._mgrImport([...this._mgr.sel]); break;
        case 'mgr-selall': {
          const g = this._mgr, avail = (g.cands || []).map((c, i) => (c.fn && !c.missing.length ? -1 : i)).filter((i) => i >= 0);
          g.sel = g.sel.size === avail.length ? new Set() : new Set(avail);
          this._renderManager();
          break;
        }
        case 'mgr-rescan': this._mgr.cands = null; this._scanFunctions(); break;
        case 'mgr-labels-add': this._mgrLabelsAdd(); break;
        case 'mgr-pick-add': this._mgrPickAdd(); break;
        case 'mgr-ptype': this._mgr.ptype = el.dataset.ptype; this._mgr.pshow = 200; this._renderPicks(); break;
        case 'mgr-more': this._mgr.pshow = (this._mgr.pshow || 200) + 200; this._renderPicks(); break;
        case 'mgr-pickall': (this._mgr.pshownKeys || []).forEach((k) => this._pick.add(k)); this._renderPicks(); this._mgrFootRefresh(); break;
        case 'frame': if (need() && this._model) this._addFrame(); break;
        case 'note': if (need() && this._model) this._addNote(); break;
        // undoable, so no second click to confirm it
        case 'arrange': if (this._model) this._arrangeMenu(el); break;
        case 'arr-go': this._closeMenu(); if (this._model) this._arrange(); break;
        case 'arr-dir': this._closeMenu(); if (this._model) this._setDir(el.dataset.dir); break;
        case 'runs': if (need()) this._openRuns(); break;
        case 'pause': this._pause(el); break;
        case 'zoomin': this._zoomCenter(1.2); break;
        case 'zoomout': this._zoomCenter(1 / 1.2); break;
        case 'fit': this._fitPress(); break;
        case 'legend':
          if (this._compact) this._legendOpen = !this._legendOpen;
          else { this._data.ui.legend = !this._data.ui.legend; this._save(); }
          this._renderLegend(); break;
        case 'close': this._closeDrawer(); break;
        case 'newtab': if (this._drawer && this._drawer.url) window.open(this._drawer.url, '_blank'); break;
        case 'refresh': this._openRuns(); break;
        case 'back': if (this._drawerBack === 'debug') this._openDebug(); else this._openRuns(); break;
        case 'open': case 'edit': case 'trace': case 'toggle': case 'remove': case 'add': case 'delete': this._nodeAction(a, el); break;
        case 'fn-menu': this._fnMenu(el, el.dataset.label); break;
        case 'fnm-edit': this._closeMenu(); this._fnModal(el.dataset.label); break;
        case 'fnm-hide': this._closeMenu(); this._hideFunction(el.dataset.label); break;
        case 'fnm-del': this._closeMenu(); this._deleteFnDialog(el.dataset.label, false); break;
        case 'fnm-delall': this._closeMenu(); this._deleteFnDialog(el.dataset.label, true); break;
        case 'del-go': this._deleteGo(); break;
        case 'hl': if (this._menuEl && this._menuAnchor === el) this._closeMenu(); else this._hlMenu(el); break;
        case 'hl-mode': this._setHl({ mode: el.dataset.mode }); break;
        case 'hl-depth': this._setHl({ depth: +el.dataset.depth, mode: ['chain', 'off'].includes((this._data.ui.hl || {}).mode || 'chain') ? 'both' : this._data.ui.hl.mode }); break;
        case 'hl-flt': if (this._model) { const f = this._flt(this._model.label), k = el.dataset.key; this._setFlt(this._model.label, k, !f[k]); if (k === 'suggest') this._open(this._model.label, true); else { this._place(); this._render(); } this._renderLegend(); this._refreshHl(); } break;
        case 'undo': this._undo(); break;
        case 'redo': this._redo(); break;
        case 'toast-act': {
          const t = this._toastActs[+el.dataset.i];
          this._$.toast.hidden = true; this._toastActs = [];
          if (t) t.fn();
          break;
        }
        case 'fdel': this._delFrame(el.dataset.fid); break;
        case 'ndel': this._delNote(el.dataset.nid); break;
        // developer tools (Phase 9)
        case 'test': if (this._sel) this._testDialog(this._sel); break;
        case 'test-pick': if (this._tst) { this._tst.pick = el.dataset.id; this._tst.bad = null; this._renderTestDlg(); } break;
        case 'test-run': this._testRunDlg(false); break;
        case 'test-save': this._testRunDlg(true); break;
        case 'test-confirm': { const t = this._pendingTest; this._pendingTest = null; this._closeModal(); if (t) this._doTest(t); break; }
        case 'tool-run': this._toolRun(el.dataset.tid); break;
        case 'tool-edit': { const t = this._toolById(el.dataset.tid); if (t && t.type === 'inject') this._testDialog(t.test.target, t.id); break; }
        case 'tool-del': this._delTool(el.dataset.tid); break;
        case 'mon-clear': this._monData.delete(el.dataset.tid); this._monCount.delete(el.dataset.tid); this._renderMon(el.dataset.tid); break;
        case 'watch': if (this._sel) this._toggleWatch(this._sel); break;
        case 'keep': if (this._sel) this._toggleKeep(this._sel); break;
        case 'monitor': if (this._sel) this._monitorFor(this._sel); break;
        case 'messages': if (this._sel) this._openMessages(this._sel); break;
        case 'msg-run': { const x = (this._msgs || [])[+el.dataset.i]; if (x) this._showRun({ kind: 'run', key: x.from, t: x.t, run: x.run }, null); break; }
        case 'mon-kind': {
          this._monKind = el.dataset.k === 'mqtt' ? 'mqtt' : 'event';
          this._$.modal.querySelectorAll('[data-act="mon-kind"]').forEach((b) => b.classList.toggle('on', b === el));
          const l = this._$.modal.querySelector('.mlab'), i = this._$.modal.querySelector('input[name=topic]');
          if (l) l.textContent = this._monKind === 'mqtt' ? T('mqtt_topic_and_work') : T('event_type');
          if (i) { i.placeholder = this._monKind === 'mqtt' ? 'zigbee2mqtt/hall_button/action' : 'mobile_app_notification_action'; i.setAttribute('list', this._monKind === 'mqtt' ? '' : 'fbevtypes'); i.focus(); }
          break;
        }
        case 'mon-make': this._monitorMake(); break;
        case 'debug': if (need()) { if (this._drawer && this._drawer.mode === 'debug') this._closeDrawer(); else this._openDebug(); } break;
        case 'dbg-mon': this._monitorDlg(); break;
        case 'dbg-clear': if (this._dbg) { this._dbg.entries = []; this._dbg.byId = new Map(); this._dbg.cleared = Date.now(); this._dbgSel = null; this._renderDbg(); } break;
        case 'dbg-flt': this._dbgFlt = el.dataset.f; this._dbgScrolled = false; this._renderDbg(); break;
        case 'dbg-pick': this._dbgPick(el.dataset.id); break;
        case 'why-run': this._showRun({ kind: 'run', key: el.dataset.key, t: Date.now(), run: { domain: 'automation', item_id: el.dataset.item, run_id: el.dataset.rid } }, null); break;
        case 'lit-clear': this._clearLit(); this._dbgSel = null; this._renderDbg(); break;
        case 'lit-replay': if (this._litSteps) this._lightSteps(this._litSteps, this._litRun); break;
        case 'versions': if (need()) { if (this._drawer && this._drawer.mode === 'versions') this._closeDrawer(); else this._openVersions(); } break;
        case 'ver-new': this._verNewDlg(); break;
        case 'ver-save': this._verSave(); break;
        case 'ver-open': this._verOpenTab(el.dataset.id); break;
        case 'ver-sbx': this._verOpenTab(el.dataset.id, true); break;
        case 'ver-sbx-cur': this._verTrySandbox(); break;
        case 'ver-restore': this._verRestore(el.dataset.id); break;
        case 'ver-restore-go': this._verRestoreGo(); break;
        case 'ver-edit': this._verEditDlg(el.dataset.id); break;
        case 'ver-edit-save': this._verEditSave(); break;
        case 'ver-del': this._verDelDlg(el.dataset.id); break;
        case 'ver-del-go': this._verDel(); break;
        case 'vtab': this._verView(el.dataset.id || null); break;
        case 'vtab-x': this._verCloseTab(el.dataset.id); break;
        case 'vtab-win': window.open(location.pathname + '?version=' + encodeURIComponent(el.dataset.id), '_blank', 'noopener'); break;
        case 'flow-go': this._flowGo(+el.dataset.i, true); break;
        case 'flow-prev': if (this._flow) this._flowGo(this._flow.at - 1, true); break;
        case 'flow-next': if (this._flow) this._flowGo(this._flow.at + 1, true); break;
        case 'flow-play': this._flowPlay(); break;
        case 'flow-ghost': { const f = this._flow, i = f ? f.steps.findIndex((x) => x.box === el.dataset.g || x.links.some((l) => l.a === el.dataset.g || l.b === el.dataset.g)) : -1; if (i >= 0) this._flowGo(i, true); break; }
        case 'lit-trace': this._openLitTrace(); break;
        // the routes change with the style, and so does the automatic layout's spacing for them
        case 'hl-curved': this._data.ui.curved = this._data.ui.curved !== true; this._save(); this._place(); this._render(); this._refreshHl(); break;
        case 'hl-cond': this._data.ui.condres = this._data.ui.condres === false; this._save(); this._testConds(); this._refreshHl(); break;
        // the arrow editor (7.5)
        case 'edge': this._edgeClick(el.dataset.e, ev); break;
        case 'connect': if (this._sel) this._startLink(this._sel, false); break;
        case 'arw-remove': this._arrowRemoveDialog(this._selEdge); break;
        case 'arw-open': {
          const e = this._model && this._model.edges.find((x) => x.id === this._selEdge), ends = e && this._arrowEnds(e), n = ends && this._model.nodes.get(ends.owner);
          this._clearEdgeSel();
          if (n) this._openItem(n);
          break;
        }
        case 'arw-edit': { const n = this._model && this._model.nodes.get(el.dataset.key); this._closeModal(); if (n) this._openItem(n); break; }
        case 'arw-save': this._arwSave(); break;
        case 'lnk-pick': if (this._arw) { this._arw.pick = +el.dataset.i; this._renderLinkDlg(); } break;
        case 'nr-open': this._openNodeRed(); break;
        case 'lnk-kind': if (this._arw) { this._arw.pick = Math.max(0, this._arw.choices.findIndex((c) => c.kind === el.dataset.k)); this._renderLinkDlg(); } break;
        default: break;
      }
    }
    _onChange(e) {
      const t = e.target, g = this._mgr;
      // diagnostics: anonymised or real names, one of the two, never both and never neither
      if (t.name === 'danon' || t.name === 'dreal') {
        const m = this._$.modal, other = m.querySelector(`input[name="${t.name === 'danon' ? 'dreal' : 'danon'}"]`);
        if (t.checked && other) other.checked = false;
        const pick = m.querySelector('input[name="danon"]:checked, input[name="dreal"]:checked');
        m.querySelectorAll('[data-act="diag-go"], [data-act="diag-copy"]').forEach((b) => { b.disabled = !pick; });
        const w = m.querySelector('.dwarn');
        if (w) w.hidden = !(pick && pick.name === 'dreal');
        return;
      }
      if (t.classList && t.classList.contains('sbent')) { this._sbxPick(t.value); return; }
      if (t.classList && t.classList.contains('sbrun')) { this._sbxTrigs(); return; }
      if (t.classList && t.classList.contains('sbsel')) {
        this._sbxOther(t, true);
        if (t.dataset.f === 'sbev') this._sbxEvData();
        if (t.dataset.f === 'sbtop') this._sbxPayloads();
        return;
      }
      if (t.hasAttribute && t.hasAttribute('data-nr')) {
        // the Node-RED switch is yours, for every function: off means no request to Node-RED at all
        this._data.ui.nodered = t.checked; this._save(); this._nrCache = null;
        if (this._model) this._open(this._model.label, true).then(() => this._renderLegend()); else this._renderLegend();
        return;
      }
      if (this._tst && t.closest && t.closest('.tdlg')) { this._testWhat(); return; }
      if (this._arw && t.dataset && t.dataset.aref != null) { const i = +t.dataset.aref; if (t.checked) this._arw.sel.add(i); else this._arw.sel.delete(i); return; }
      if (this._arw && t.closest && t.closest('.adlg')) { this._linkPreview(); return; }
      if (t.dataset.tog) {
        if (this._model) this._setFlt(this._model.label, t.dataset.tog, t.checked);
        else { this._data.ui[t.dataset.tog] = t.checked; this._save(); }
        if (t.dataset.tog === 'suggest') this._open(this._data.ui.current, true);
        else if (this._model) { this._place(); this._render(); }
        this._refreshHl();
        return;
      }
      if (t.name === 'color' && t.tagName === 'SELECT') { this._fnColor = t.value; return; }
      if (!g) return;
      if (t.dataset.csel != null) { const i = +t.dataset.csel; if (t.checked) g.sel.add(i); else g.sel.delete(i); this._mgrFootRefresh(); return; }
      if (t.dataset.cmem != null) {
        const c = g.cands && g.cands[+t.dataset.cmem];
        if (!c) return;
        if (t.checked) c.keep.add(t.dataset.id); else c.keep.delete(t.dataset.id);
        const card = t.closest('.cand'), cc = card && card.querySelector('.ccount');
        if (cc) cc.textContent = this._countText(c.members.filter((id) => c.keep.has(id)));
        return;
      }
      if (t.dataset.lsel != null) { if (t.checked) g.lsel.add(t.dataset.lsel); else g.lsel.delete(t.dataset.lsel); this._mgrFootRefresh(); return; }
      if (t.hasAttribute('data-mcats')) { g.cats = t.checked; return; }
      if (t.hasAttribute('data-mdev')) { g.devices = t.checked; if (g.roles) { g.sel = new Set(); g.expanded = new Set(); this._mgrRecluster(); this._renderManager(); } return; }
      if (t.hasAttribute('data-pdiag')) { g.pdiag = t.checked; g.pshow = 200; this._renderPicks(); return; }
      if (t.hasAttribute('data-ptarget')) { g.target = t.value; this._renderManager(); return; }
      if (t.dataset.pick) {
        if (t.checked) this._pick.add(t.dataset.pick); else this._pick.delete(t.dataset.pick);
        const c = this._$.modal.querySelector('.chip[data-ptype="selected"] span');
        if (c) c.textContent = this._pick.size;
        this._mgrFootRefresh();
      }
    }
    _onInput(e) {
      const t = e.target, g = this._mgr;
      if (this._tst && t.closest && t.closest('.tdlg')) { this._testWhat(); return; }
      if (this._arw && t.closest && t.closest('.adlg')) { this._linkPreview(); return; }
      if (t.classList.contains('search')) { if (g) g.pshow = 200; this._renderPicks(t.value); return; }
      if (t.classList.contains('find')) { this._findQ = t.value; this._debounce('find', 120, () => this._renderList()); return; }
      if (t.name === 'icon' && t.tagName === 'INPUT') { this._fnIcon = t.value.trim(); return; }
      if (g && t.dataset.cname != null) { const c = g.cands && g.cands[+t.dataset.cname]; if (c) c.name = t.value; return; }
      if (g && t.hasAttribute('data-pnew')) { g.newName = t.value; this._mgrFootRefresh(); return; }
      if (t.classList.contains('nbody') && this._model) {
        const nt = this._layout(this._model.label).notes.find((x) => x.id === t.dataset.nid);
        if (nt) { nt.text = t.value; this._autosize(t); this._save(); }
      }
    }
    _onDbl(e) {
      const nodeEl = e.target.closest('.node');
      if (nodeEl && this._model) {
        const n = this._model.nodes.get(nodeEl.dataset.key);
        if (n && n.kind === 'tool') { if (n.tool.type === 'inject') this._testDialog(n.tool.test.target, n.tool.id); return; }
        if (n) this._editOrOpen(n);
        return;
      }
      const ft = e.target.closest('.ftitle');
      if (ft && this._model) {
        const f = this._layout(this._model.label).frames.find((x) => x.id === ft.dataset.fid);
        if (!f) return;
        const inp = document.createElement('input');
        inp.className = 'ftin'; inp.value = f.title; inp.dataset.fid = f.id; inp._before = this._snap(this._model.label);
        ft.replaceWith(inp); inp.focus(); inp.select();
      }
    }
    _onBlur(e) {
      const t = e.target;
      if (t.classList && t.classList.contains('ftin') && this._model) {
        const f = this._layout(this._model.label).frames.find((x) => x.id === t.dataset.fid);
        if (f) { f.title = t.value.trim() || T('frame'); this._save(); if (t._before) this._layoutStep(this._model.label, t._before, T('rename_frame')); }
        setTimeout(() => this._renderFrames(), 0);
      }
      if (t.classList && t.classList.contains('nbody') && this._model && t._before) {
        this._layoutStep(this._model.label, t._before, T('edit_note'));
        t._before = null;
      }
    }
    _onFocus(e) {
      const t = e.target;
      if (t.classList && t.classList.contains('node') && t.dataset.key) this._rove(t.dataset.key);
      if (t.classList && t.classList.contains('nbody') && this._model) t._before = this._snap(this._model.label);
    }
    _onKey(e) {
      const t = e.composedPath()[0];
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
      if (typing) {
        e.stopPropagation();  // keep Home Assistant's single-key shortcuts out of the board's own fields
        if ((e.key === 'Enter' || e.key === 'Escape') && t.classList && t.classList.contains('ftin')) t.blur();
        if (e.key === 'Enter' && t.classList && t.classList.contains('search')) e.preventDefault();
        if (t.classList && t.classList.contains('find')) {
          if (e.key === 'Enter') { const b = this._$.list.querySelector('.fgo'); if (b) b.click(); }
          if (e.key === 'Escape') { this._findQ = ''; this._renderList(); }
        }
        return;
      }
      e._fbDone = true;
      if (this._model && this._boxKey(e, t)) return;
      this._hotkey(e);
    }
    // keys pressed while focus is outside the board (after a click on the canvas, focus is on the page)
    _winKey(e) {
      if (e._fbDone || e.defaultPrevented || !this.isConnected || !this._data || !this._$.board.clientWidth) return;
      const t = e.composedPath()[0];
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      if (e.composedPath().some((x) => x.tagName && /^(HA-DIALOG|HA-MORE-INFO-DIALOG|DIALOG)$/.test(x.tagName))) return;
      this._hotkey(e);
    }
    _hotkey(e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zZy]$/.test(e.key)) {
        if (!this._$.modal.hidden) return;
        e.preventDefault();
        if (e.key === 'y' || e.shiftKey) this._redo(); else this._undo();
        return;
      }
      if (/^[0-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && this._sel && this._$.modal.hidden) {
        // number keys set how many arrows away the highlight reaches; 0 is all (7.1)
        const hl = this._data.ui.hl || {};
        this._setHl({ depth: +e.key, mode: ['chain', 'off'].includes(hl.mode || 'chain') ? 'both' : hl.mode });
        return;
      }
      if (e.key === 'Escape') {
        if (this._menuEl) this._closeMenu();
        else if (!this._$.modal.hidden) this._closeModal();
        else if (this._linking) { this._endLink(); this._$.toast.hidden = true; }
        else if (this._selEdge) this._clearEdgeSel();
        else if (this._lit) this._clearLit();
        else if (this._drawer) this._closeDrawer();
        else this._select(null);
      }
    }

    /* ---------- node actions ---------- */
    _itemId(n) {
      const r = this._entMap.get(n.key);
      if (r && r.unique_id) return r.unique_id;
      return n.domain === 'script' ? n.key.slice(7) : null;
    }
    _openItem(n) {
      if (n.kind === 'nodered') { this._openNodeRed(n.nr.sub, T('node_red_2', { tabLabel: n.nr.tabLabel })); return; }
      if (n.domain === 'automation' || n.domain === 'script') {
        const id = this._itemId(n);
        if (id) { this._openDrawer(`/config/${n.domain}/edit/${encodeURIComponent(id)}`, n.name); return; }
        this._moreInfo(n.key); return;
      }
      if (n.domain === 'device') { this._openDrawer(`/config/devices/device/${n.key.slice(7)}`, n.name); return; }
      if (!n.key.includes(':')) this._moreInfo(n.key);
    }
    _openTraces(n) {
      const id = this._itemId(n);
      if (id) this._openDrawer(`/config/${n.domain}/trace/${encodeURIComponent(id)}`, T('traces', { name: n.name }));
    }
    _moreInfo(entityId, view) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: view ? { entityId, view } : { entityId }, bubbles: true, composed: true }));
    }
    // what Edit opens on a box that isn't an automation or script: a helper's settings (where its options are,
    // also a template helper's template), a scene in Home Assistant's scene editor. Set up in YAML without an ID,
    // neither can be changed from the UI.
    _editOf(n) {
      if (n.key.includes(':')) return null;
      const st = this._hass.states[n.key];
      if (n.domain === 'scene') {
        const id = st && st.attributes.id;
        return id ? { url: `/config/scene/edit/${encodeURIComponent(id)}` } : { off: T('set_up_in_yaml_without_a') };
      }
      if (this._scopeOf(n.key) !== 'helpers') return null;
      return this._entMap.has(n.key) ? { view: 'settings' } : { off: T('set_up_in_yaml_without_a') };
    }
    _editItem(n) {
      const ed = this._editOf(n);
      if (!ed || ed.off) return;
      if (ed.url) this._openDrawer(ed.url, n.name);
      else this._moreInfo(n.key, ed.view);
    }
    // double-click and Enter: edit what can be edited, otherwise open it
    _editOrOpen(n) {
      const ed = n.domain === 'automation' || n.domain === 'script' ? null : this._editOf(n);
      if (ed && !ed.off) this._editItem(n); else this._openItem(n);
    }
    async _nodeAction(a, el) {
      const m = this._model, n = m && m.nodes.get(this._sel);
      if (!n) return;
      const label = this._data.ui.current;
      if (a === 'open') { this._openItem(n); return; }
      if (a === 'edit') { this._editItem(n); return; }
      if (a === 'trace') { this._openTraces(n); return; }
      if (a === 'delete') { this._deleteItemDialog(n.key); return; }
      if (a === 'toggle') {
        const st = this._hass.states[n.key];
        if (st) this._hass.callService('automation', st.state === 'on' ? 'turn_off' : 'turn_on', {}, { entity_id: n.key });
        return;
      }
      if (a === 'remove') {
        this._twoStep(el, T('remove_from_function'), async () => {
          try {
            const u = await this._label(n.key, label, false);
            this._labelStep(T('remove_from_2', { name: n.name, fnName: this._fnName(label) }), label, [u]);
            this._toast(T('removed_from_it_still_exists', { name: n.name, fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
            this._select(null);
          } catch (e) { this._toast(T('could_not_remove', { message: e.message || e.code })); }
        });
        return;
      }
      if (a === 'add') {
        try {
          const u = await this._label(n.key, label, true, true);
          this._labelStep(T('add_to_5', { name: n.name, fnName: this._fnName(label) }), label, [u]);
          this._toast(T('added_to_3', { name: n.name, fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
        } catch (e) { this._toast(T('could_not_add_3', { name: n.name, noLabelWhy: this._noLabelWhy(n.key, e) })); }
      }
    }
    // Add or remove a function's label on one item. Returns what changed, so it can be undone:
    // { id, label, add, had, cat: [scope, category_id] when it also filed the item under the function's category }
    async _label(id, label, add, withCat) {
      if (id.startsWith('device:')) {
        const did = id.slice(7), dev = this._devMap.get(did);
        const labels = new Set((dev && dev.labels) || []), had = labels.has(label);
        if (add) labels.add(label); else labels.delete(label);
        const r = await this._ws({ type: 'config/device_registry/update', device_id: did, labels: [...labels] });
        if (r && r.id) this._devMap.set(r.id, r);  // a second quick change starts from this one, not the cached list
        return { id, label, add, had };
      }
      const reg = await this._ws({ type: 'config/entity_registry/get', entity_id: id });
      const labels = new Set(reg.labels || []), had = labels.has(label);
      if (add) labels.add(label); else labels.delete(label);
      const msg = { type: 'config/entity_registry/update', entity_id: id, labels: [...labels] };
      const cats = this._layout(label).categories;
      let cat = null;
      if (add && withCat && cats) {
        const scope = this._scopeOf(id) || (HELPER_PLATFORMS.has(reg.platform) ? 'helpers' : null);
        const cur = reg.categories || {};
        if (scope && cats[scope] && !cur[scope]) { msg.categories = { [scope]: cats[scope] }; cat = [scope, cats[scope]]; }
      }
      const r = await this._ws(msg);
      const e = r && (r.entity_entry || r);
      if (e && e.entity_id) this._entMap.set(e.entity_id, Object.assign({}, this._entMap.get(e.entity_id) || {}, e));
      return { id, label, add, had, cat };
    }
    // reverse one _label() change: the label comes off again (or goes back on), and the category it set goes too
    async _unlabel(u) {
      if (!u || u.had === u.add) return;
      if (u.id.startsWith('device:')) { await this._label(u.id, u.label, !u.add, false); return; }
      const reg = await this._ws({ type: 'config/entity_registry/get', entity_id: u.id });
      const labels = new Set(reg.labels || []);
      if (u.add) labels.delete(u.label); else labels.add(u.label);
      const msg = { type: 'config/entity_registry/update', entity_id: u.id, labels: [...labels] };
      if (u.cat && (reg.categories || {})[u.cat[0]] === u.cat[1]) msg.categories = { [u.cat[0]]: null };
      await this._ws(msg);
    }
    // undo step for one or more _label() changes, with a check that the items still carry what the step left
    _labelStep(text, label, recs) {
      const live = recs.filter((u) => u && u.had !== u.add);
      if (!live.length) return;
      const state = async (u, wantOn) => {
        if (u.id.startsWith('device:')) { const d = this._devMap.get(u.id.slice(7)); return !!d && (d.labels || []).includes(u.label) === wantOn; }
        const r = await this._ws({ type: 'config/entity_registry/get', entity_id: u.id }).catch(() => null);
        return !!r && (r.labels || []).includes(u.label) === wantOn;
      };
      this._history({
        label, text,
        check: async (dir) => { for (const u of live) if (!(await state(u, dir === 'undo' ? u.add : !u.add))) return false; return true; },
        undo: async () => { for (const u of live) await this._unlabel(u); },
        redo: async () => { for (const u of live) await this._label(u.id, u.label, u.add, !!u.cat); },
      });
    }

    /* ---------- drawer: native editors, traces, runs ---------- */
    // open Home Assistant's own editor or create dialog in the drawer; whatever it creates joins the function
    _create(kind, domain, name) {
      const label = this._data.ui.current;
      this._closeMenu();
      this._capture = { label, kind, domain: domain || null };
      const map = {
        automation: ['/config/automation/edit/new', T('new_automation')],
        script: ['/config/script/edit/new', T('new_script')],
        scene: ['/config/scene/edit/new', T('new_scene')],
        helper: domain ? [`/config/helpers/add?domain=${encodeURIComponent(domain)}`, T('new', { name: (name || domain).toLowerCase() })] : ['/config/helpers', T('helpers')],
      };
      this._openDrawer(map[kind][0], map[kind][1], { capture: true });
    }
    _helperMenu(btn) {
      const items = HELPER_TYPES.map(([d, t, i]) => ({ act: 'mk-helper', data: { domain: d, name: t }, icon: i, text: t }));
      items.push({ act: 'mk-more', icon: 'mdi:dots-horizontal', text: T('more_helper_types_2'), title: T('template_group_derivative_utility_meter') });
      items.push({ sep: true });
      items.push({ act: 'mk-scene', icon: 'mdi:palette-outline', text: T('scene') });
      this._menu(btn, items, T('create_in_this_function'));
    }
    async _helperMoreMenu() {
      const anchor = this._menuAnchor;
      this._menu(anchor, [{ text: T('loading_2'), disabled: true }], T('more_helper_types'));
      let domains = [];
      try { domains = await this._hass.callApi('GET', 'config/config_entries/flow_handlers?type=helper'); } catch (e) { domains = []; }
      const man = domains.length ? await this._ws({ type: 'manifest/list', integrations: domains }).catch(() => []) : [];
      const names = new Map((man || []).map((x) => [x.domain, x.name]));
      const list = domains.map((d) => [d, names.get(d) || d.replace(/_/g, ' ')]).sort((a, b) => a[1].localeCompare(b[1]));
      if (this._menuAnchor !== anchor) return;
      this._menu(anchor, [{ act: 'mk-back', icon: 'mdi:arrow-left', text: T('back') }, { sep: true }]
        .concat(list.length ? list.map(([d, n]) => ({ act: 'mk-helper', data: { domain: d, name: n }, icon: 'mdi:tune-variant', text: n })) : [{ text: T('no_other_helper_types_found'), disabled: true }]), T('more_helper_types'));
    }
    // a small menu under a toolbar button
    _menu(anchor, items, title) {
      this._closeMenu(true);
      this._menuAnchor = anchor;
      const m = document.createElement('div');
      m.className = 'menu';
      m.innerHTML = (title ? `<div class="mtitle">${esc(title)}</div>` : '') + items.map((it) => it.sep ? '<div class="msep"></div>'
        : `<button class="mi" ${it.act ? `data-act="${it.act}"` : ''} ${Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} ${it.disabled ? 'disabled' : ''} ${it.title ? `title="${esc(it.title)}"` : ''}>`
          + (it.icon ? `<ha-icon icon="${esc(it.icon)}"></ha-icon>` : '') + `<span>${esc(it.text)}</span></button>`).join('');
      this._$.board.appendChild(m);
      const br = this._$.board.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      m.style.top = Math.round(ar.bottom - br.top + 4) + 'px';
      m.style.left = Math.round(Math.max(6, Math.min(ar.left - br.left, br.width - m.offsetWidth - 6))) + 'px';
      this._menuEl = m;
    }
    _closeMenu(keepAnchor) {
      if (this._menuEl) {
        // focus that was in the menu goes back to the button that opened it (4.8)
        const had = this._menuEl.contains(this.shadowRoot.activeElement);
        this._menuEl.remove(); this._menuEl = null;
        if (had && this._menuAnchor && this._menuAnchor.isConnected) this._menuAnchor.focus();
      }
      if (!keepAnchor) this._menuAnchor = null;
    }
    // The phone app signs its page in through the app itself, and Home Assistant inside the drawer's frame can't
    // reach that sign-in, so its editors never load there. In the app, Home Assistant's own pages open full
    // screen instead; the app's Back returns to the board.
    _inApp() { return !!(this._hass && this._hass.auth && this._hass.auth.external); }
    _openDrawer(url, title, opt = {}) {
      // only Home Assistant's own pages open in the drawer (or in a new tab from it), never another address
      if (!SAME_ORIGIN.test(String(url))) return;
      if (this._inApp() && /^\/config\//.test(url)) { this._goTo(url, opt.capture); return; }
      this._leaveDrawerMode();
      if (!opt.capture) this._capture = null;
      const was = this._drawer;
      if (was && was.mode === 'frame') this._configChanged();
      this._drawer = { mode: 'frame', url, title };
      const d = this._$.drawer;
      d.hidden = false;
      d.innerHTML = `<div class="dhead">${opt.back ? `<button data-act="back" title="${T('back_to_runs')}"><ha-icon icon="mdi:arrow-left"></ha-icon></button>` : ''}<span class="dtitle">${esc(title)}</span>${opt.capture && this._capture ? `<span class="dcap" title="${T('anything_you_create_here_gets', { fnName: esc(this._fnName(this._capture.label)) })}">${T('saves_into', { fnName: esc(this._fnName(this._capture.label)) })}</span>` : ''}<button data-act="newtab" title="${T('open_in_a_new_tab')}"><ha-icon icon="mdi:open-in-new"></ha-icon></button><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><iframe title="${esc(title)}" src="${esc(url)}"></iframe>`;
      this._fitLitbar();
    }
    _closeDrawer() {
      this._leaveDrawerMode();
      const d = this._$.drawer, was = this._drawer;
      d.hidden = true; d.innerHTML = '';
      this._drawer = null;
      this._endCapture();
      this._hover(null);
      if (was && was.mode === 'frame') this._configChanged();  // whatever was saved in the editor shows at once
      if (this._nrWait) { this._nrWait = false; this._nrCache = null; if (this._model) this._open(this._model.label, true).then(() => this._renderLegend()); }
      this._fitLitbar();
    }
    // Leaving the board for one of Home Assistant's pages (the phone app). The board stops while it's away, so
    // a create remembers what it's for, and when the board comes back, what was made meanwhile joins the
    // function. "Meanwhile" is measured by the registry's own clock, not the phone's.
    _goTo(url, capture) {
      const c = capture && this._capture;
      if (c) {
        const since = (this._ents || []).reduce((m, e) => Math.max(m, e.created_at || 0), 0);
        try { sessionStorage.setItem(CAPTURE_KEY, JSON.stringify({ label: c.label, kind: c.kind, domain: c.domain, since, at: Date.now() })); } catch (e) { /* the item just won't be labelled */ }
      }
      this._capture = null;
      if (this._drawer) this._closeDrawer();
      // "from" is how Home Assistant's own navigation marks a page that was opened from another one; with it, the
      // editor's back arrow goes back here instead of to its own list
      history.pushState({ from: location.pathname }, '', url);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    }
    async _resumeCapture() {
      if (this._mode() !== 'panel') return;
      let c = null;
      try { c = JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || 'null'); sessionStorage.removeItem(CAPTURE_KEY); } catch (e) { c = null; }
      if (!c || !c.label || typeof c.since !== 'number' || Date.now() - c.at > 30 * 60000) return;
      const ents = await this._ws({ type: 'config/entity_registry/list' }).catch(() => []);
      const made = (ents || []).filter((e) => (e.created_at || 0) > c.since).slice(0, 5);
      for (const e of made) if (await this._captureMatch(e.entity_id, c, e)) await this._captured(e.entity_id, c);
    }
    // does this new entity belong to what was being created?
    async _captureMatch(id, c, reg) {
      const dom = id.split('.')[0];
      if (c.kind === 'automation' || c.kind === 'script' || c.kind === 'scene') return dom === c.kind;
      if (c.kind !== 'helper') return false;
      if (HELPER_DOMAINS.has(dom)) return true;
      if (!reg) reg = await this._ws({ type: 'config/entity_registry/get', entity_id: id }).catch(() => null);
      return !!(reg && (HELPER_PLATFORMS.has(reg.platform) || (c.domain && reg.platform === c.domain)));
    }
    _endCapture() {
      // a few seconds' grace: the item saved just before the drawer closed still gets the label
      const c = this._capture;
      if (!c) return;
      setTimeout(() => { if (this._capture === c) this._capture = null; }, 3000);
    }
    async _openRuns() {
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'runs' };
      const d = this._$.drawer;
      d.hidden = false;
      d.innerHTML = `<div class="dhead"><span class="dtitle">${T('runs_3', { fnName: esc(this._fnName(this._data.ui.current)) })}</span><button data-act="refresh" title="${T('refresh')}"><ha-icon icon="mdi:refresh"></ha-icon></button><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="runs"><div class="muted pad">${T('loading')}</div></div>`;
      this._fitLitbar();
      await this._loadRuns();
      this._renderRuns();
    }
    async _loadRuns() {
      const m = this._model;
      if (!m) return;
      const map = new Map();
      m.nodes.forEach((n, k) => {
        if (n.kind === 'outside' || (n.domain !== 'automation' && n.domain !== 'script')) return;
        const id = this._itemId(n);
        if (id) map.set(n.domain + ':' + id, k);
      });
      let runs = [];
      if (map.size) {
        const lists = await Promise.all(['automation', 'script'].map((dom) => this._ws({ type: 'trace/list', domain: dom })
          .then((l) => (l || []).map((r) => Object.assign({}, r, { domain: dom }))).catch(() => [])));
        runs = lists.flat().filter((r) => map.has(r.domain + ':' + r.item_id)).map((r) => Object.assign(r, { key: map.get(r.domain + ':' + r.item_id) }));
        const t = (r) => Date.parse((r.timestamp && r.timestamp.start) || '') || 0;
        runs.sort((a, b) => t(b) - t(a));
      }
      if (m !== this._model) return;
      this._runs = runs;
      const latest = new Map();
      runs.forEach((r) => { if (!latest.has(r.key)) latest.set(r.key, r); });
      this._errKeys = new Set([...latest.values()].filter((r) => r.error || r.script_execution === 'error').map((r) => r.key));
      this._refreshStates();
    }
    _renderRuns() {
      const box = this._$.drawer.querySelector('.runs');
      if (!box) return;
      const runs = this._runs.slice(0, 100);
      if (!runs.length) { box.innerHTML = `<div class="muted pad">${T('no_stored_runs_yet_for')}</div>`; return; }
      box.innerHTML = `<div class="muted pad small">${T('every_automation_and_script_in')}</div>${runs.map((r, i) => {
          const n = this._model && this._model.nodes.get(r.key), o = OUTCOME(r);
          return `<button class="run ${o.cls}" data-run="${i}" data-key="${esc(r.key)}"><span class="rt">${esc(clock(r.timestamp && r.timestamp.start))}</span>`
            + `<span class="rn"><b>${esc(n ? n.name : r.item_id)}</b><span>${esc(r.trigger || (r.domain === 'script' ? 'started' : ''))}</span></span>`
            + `<span class="ro" title="${esc(o.text)}">${esc(o.text)}</span></button>`;
        }).join('')}`;
    }
    // a run lights its path on the board (4.5); its trace is a click away in the bar
    _openRun(i) {
      const r = this._runs[i];
      if (!r) return;
      this._$.drawer.querySelectorAll('.run.on').forEach((x) => x.classList.remove('on'));
      const row = this._$.drawer.querySelector(`.run[data-run="${i}"]`);
      if (row) row.classList.add('on');
      this._showRun({ kind: 'run', key: r.key, t: Date.parse((r.timestamp && r.timestamp.start) || '') || Date.now(), run: { domain: r.domain, item_id: r.item_id, run_id: r.run_id } }, null);
    }
    _onRun(ev) {
      const k = ev && ev.data && ev.data.entity_id, m = this._model;
      if (!m || !k || !m.nodes.has(k)) return;
      this._pulse(k);
      this._debounce('runs', 2500, async () => {
        await this._loadRuns();
        if (this._drawer && this._drawer.mode === 'runs') this._renderRuns();
      });
    }

    /* ---------- developer tools on the board (Phase 9): tests, monitors, the function debugger ---------- */

    // ---- tests (9.2): a helper changes through its own actions; anything else gets a simulated state (Home
    // Assistant's copy only); an event is fired; an automation or script runs; a notification is sent.
    // Full manager only. The first test of a session asks first, and every test is written to the logbook.
    _canTest(n) {
      if (!n || n.kind === 'tool') return false;
      const k = n.key;
      if (/^(event|nact):/.test(k) || k.startsWith('svc:notify.')) return true;
      if (k.startsWith('mqtt:')) return !!this._hass.services.mqtt;
      return !k.includes(':') && !!this._hass.states[k];
    }
    async _testSpecs(n) {
      if (!this._canTest(n)) return [];
      const k = n.key, d = n.domain, st = this._hass.states[k], A = (st && st.attributes) || {};
      const act = (id, text, service, fields) => ({ id, text, kind: 'action', service, fields: fields || [] });
      if (k.startsWith('event:')) return [{ id: 'fire', text: T('fire_the_event'), kind: 'event', fields: [{ name: 'event_data', type: 'object', label: T('event_data'), value: this._prefill(n, 'event') }] }];
      if (k.startsWith('nact:')) return [{ id: 'press', text: T('press_the_button'), kind: 'event', fields: [] }];
      if (k.startsWith('mqtt:')) return [{ id: 'pub', text: T('publish_a_message'), kind: 'mqtt', fields: [{ name: 'payload', type: 'text', label: T('payload'), value: this._prefill(n, 'mqtt') }] }];
      if (k.startsWith('svc:notify.') || d === 'notify') return [{ id: 'notify', text: T('send_a_test_notification'), kind: 'notify', fields: [{ name: 'data', type: 'object', label: T('what_to_send'), value: this._prefill(n, 'notify') }] }];
      if (d === 'automation') return [{ id: 'run', text: T('run_it'), kind: 'run', fields: [{ name: 'check', type: 'bool', label: T('check_its_conditions_first'), value: true }] }];
      if (d === 'script') return [{ id: 'run', text: T('run_it'), kind: 'run', fields: await this._scriptFields(k) }];
      if (d === 'scene') return [act('on', T('activate'), 'scene.turn_on')];
      if (d === 'input_boolean') return [act('on', T('turn_on'), 'input_boolean.turn_on'), act('off', T('turn_off'), 'input_boolean.turn_off'), act('toggle', T('toggle'), 'input_boolean.toggle')];
      if (d === 'input_button') return [act('press', T('press_2'), 'input_button.press')];
      if (d === 'input_number') return [act('set', T('set_the_value'), 'input_number.set_value', [{ name: 'value', type: 'number', label: T('value'), value: st.state, min: A.min, max: A.max, step: A.step }])];
      if (d === 'input_text') return [act('set', T('set_the_text'), 'input_text.set_value', [{ name: 'value', type: 'text', label: T('text'), value: st.state }])];
      if (d === 'input_select') return [act('set', T('pick_an_option'), 'input_select.select_option', [{ name: 'option', type: 'select', label: T('option'), options: A.options || [], value: st.state }])];
      if (d === 'input_datetime') {
        const s = String(st.state), [dt, tm] = A.has_date && A.has_time ? s.split(' ') : A.has_date ? [s, ''] : ['', s];
        return [act('set', T('set_it'), 'input_datetime.set_datetime', (A.has_date ? [{ name: 'date', type: 'date', label: T('date'), value: dt }] : [])
          .concat(A.has_time ? [{ name: 'time', type: 'time', label: T('time'), value: tm }] : []))];
      }
      if (d === 'counter') {
        return [act('inc', T('increment'), 'counter.increment'), act('dec', T('decrement'), 'counter.decrement'), act('reset', T('reset'), 'counter.reset'),
          act('set', T('set_the_value'), 'counter.set_value', [{ name: 'value', type: 'number', label: T('value'), value: st.state, min: A.minimum, max: A.maximum, step: A.step || 1 }])];
      }
      if (d === 'timer') {
        return [act('start', T('start'), 'timer.start', [{ name: 'duration', type: 'text', label: T('duration_such_as_00_00'), value: '' }]),
          act('finish', T('finish_now'), 'timer.finish'), act('cancel', T('cancel'), 'timer.cancel'), act('pause', T('pause'), 'timer.pause')];
      }
      return [{ id: 'state', text: T('simulate_a_state'), kind: 'state', fields: [{ name: 'state', type: 'text', label: T('state'), value: st.state, options: this._stateHints(n) }] }];
    }
    // states worth offering for a simulated change: what the function's triggers wait for first
    _stateHints(n) {
      const st = this._hass.states[n.key], A = (st && st.attributes) || {}, out = new Set();
      (this._model ? this._model.edges : []).forEach((e) => { if (e.from === n.key) e.tfs.forEach((f) => (f.to || []).forEach((s) => out.add(s))); });
      const by = { binary_sensor: ['on', 'off'], cover: ['open', 'closed', 'opening', 'closing'], lock: ['locked', 'unlocked', 'jammed'], valve: ['open', 'closed'],
        light: ['on', 'off'], switch: ['on', 'off'], fan: ['on', 'off'], siren: ['on', 'off'], schedule: ['on', 'off'], person: ['home', 'not_home'],
        device_tracker: ['home', 'not_home'], media_player: ['playing', 'paused', 'idle', 'off'], vacuum: ['cleaning', 'docked', 'returning', 'idle'],
        alarm_control_panel: ['disarmed', 'armed_home', 'armed_away', 'armed_night', 'triggered'] };
      (by[n.domain] || []).forEach((s) => out.add(s));
      if (n.domain === 'climate') toList(A.hvac_modes).forEach((s) => out.add(s));
      if (n.domain === 'select' || n.domain === 'input_select') toList(A.options).forEach((s) => out.add(s));
      if (n.domain === 'input_boolean') ['on', 'off'].forEach((s) => out.add(s));
      if (n.domain === 'timer') ['idle', 'active', 'paused'].forEach((s) => out.add(s));
      if (n.domain === 'sun') ['above_horizon', 'below_horizon'].forEach((s) => out.add(s));
      if (n.domain === 'input_number' || n.domain === 'number') [A.min, A.max].forEach((s) => { if (s != null) out.add(String(s)); });
      if (st) out.add(st.state);
      return [...out].filter((s) => s != null && s !== '').map(String).slice(0, 30);
    }
    // what a test starts from: the data the function's own triggers and actions use
    _prefill(n, what) {
      const m = this._model, k = n.key;
      if (what === 'event' || what === 'mqtt') {
        for (const e of (m ? m.edges : [])) {
          if (e.from !== k || !e.trigs) continue;
          for (const t of e.trigs) {
            const node = t.t || {};
            if (what === 'event' && node.event_data && typeof node.event_data === 'object') return JSON.parse(JSON.stringify(node.event_data));
            if (what === 'mqtt' && node.payload != null) return String(node.payload);
          }
        }
        return what === 'mqtt' ? '' : {};
      }
      for (const e of (m ? m.edges : [])) {
        if (e.to !== k || !e.acts) continue;
        const a = e.acts.find((x) => x && x.data && typeof x.data === 'object');
        if (a) { const d = JSON.parse(JSON.stringify(a.data)); delete d.entity_id; return d; }
      }
      return { message: T('test_from_the_functions_board') };
    }
    // a notification button: the event a phone fires when it is pressed, as the function's own trigger waits for it
    _buttonEvent(n) {
      const id = n.key.slice(5);
      for (const e of (this._model ? this._model.edges : [])) {
        if (e.from !== n.key || !e.trigs) continue;
        for (const t of e.trigs) { const et = t.t && t.t.event_type; if (typeof et === 'string' && NOTIFY_EVENTS[et]) return { event_type: et, event_data: { [NOTIFY_EVENTS[et]]: id } }; }
      }
      return { event_type: 'mobile_app_notification_action', event_data: { action: id } };
    }
    async _scriptFields(k) {
      const cfg = await this._fetchConfig(k);
      const f = cfg && cfg.fields && typeof cfg.fields === 'object' ? cfg.fields : {};
      return Object.entries(f).map(([name, x]) => ({ name, type: 'selector', label: (x && x.name) || name, selector: (x && x.selector) || { text: {} },
        value: x && x.default !== undefined ? x.default : undefined, required: !!(x && x.required),
        hint: (x && (x.description || (x.example != null ? T('for_example', { stringify: typeof x.example === 'object' ? JSON.stringify(x.example) : x.example }) : ''))) || '' }));
    }
    async _testDialog(key, toolId) {
      if (!this._full()) { this._toast(FULL_ONLY_TEST); return; }
      const n = this._model && this._model.nodes.get(key);
      if (!n) { this._toast(T('what_this_test_changes_isn')); return; }
      const specs = await this._testSpecs(n);
      if (!specs.length) { this._toast(T('there_s_no_test_for', { name: n.name })); return; }
      const tool = toolId ? this._toolById(toolId) : null, prev = tool && tool.type === 'inject' ? tool.test : null;
      const pick = (prev && specs.find((s) => s.kind === prev.kind && (s.kind !== 'action' || s.service === prev.service))) || specs[0];
      this._tst = { key, specs, pick: pick.id, vals: prev ? this._valsOf(pick, prev) : {}, toolId: toolId || null };
      this._renderTestDlg();
    }
    // a kept test back into the fields it was made with
    _valsOf(spec, t) {
      if (t.kind === 'action') return Object.assign({}, t.data || {});
      if (t.kind === 'state') return { state: t.state };
      if (t.kind === 'event') return { event_data: t.event_data || {} };
      if (t.kind === 'mqtt') return { payload: t.payload };
      if (t.kind === 'notify') return { data: t.data || {} };
      if (t.kind === 'run') return t.target.startsWith('automation.') ? { check: !t.skip_condition } : Object.assign({}, t.variables || {});
      return {};
    }
    _renderTestDlg() {
      const t = this._tst, n = t && this._model && this._model.nodes.get(t.key);
      if (!n) { this._closeModal(); return; }
      const spec = t.specs.find((s) => s.id === t.pick) || t.specs[0];
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg tdlg"><h3>${T('test_4', { name: esc(n.name) })}</h3>${t.specs.length > 1 ? `<div class="tchoice">${t.specs.map((s) => `<button class="chip ${s.id === spec.id ? 'on' : ''}" data-act="test-pick" data-id="${esc(s.id)}">${esc(s.text)}</button>`).join('')}</div>` : `<div class="tone">${esc(spec.text)}</div>`}${spec.fields.length ? `<div class="tfields">${spec.fields.map((f, i) => this._fieldHTML(f, i, t.vals)).join('')}</div>` : ''}<div class="hint twhat"></div>${this._testOk ? '' : `<div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${esc(TEST_WARN)}</span></div>`}${t.toolId ? '' : `<label class="chk"><input type="checkbox" name="keep">${T('keep_this_test_on_the')}</label>`}<div class="btns"><button data-act="modal-cancel">${T('cancel')}</button>${t.toolId ? `<button data-act="test-save">${T('save')}</button>` : ''}<button class="primary" data-act="test-run">${T('run_test')}</button></div></div>`;
      this._mountFields(spec);
      this._testWhat();
    }
    _fieldHTML(f, i, vals) {
      const v = vals && f.name in vals ? vals[f.name] : f.value, id = 'tf' + i;
      const lab = (inner) => `<label>${esc(f.label)}${inner}${f.hint ? `<span class="fh">${esc(f.hint)}</span>` : ''}</label>`;
      if (f.type === 'bool') return `<label class="chk"><input type="checkbox" name="${id}" ${v ? 'checked' : ''}>${esc(f.label)}</label>`;
      if (f.type === 'select') return lab(`<select name="${id}">${toList(f.options).map((o) => `<option ${String(o) === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
      if (f.type === 'number') {
        const at = (k, x) => (x != null && x !== '' ? ` ${k}="${esc(x)}"` : '');
        return lab(`<input type="number" name="${id}" value="${esc(v == null ? '' : v)}"${at('min', f.min)}${at('max', f.max)}${f.step != null ? at('step', f.step) : ' step="any"'}>`);
      }
      if (f.type === 'date' || f.type === 'time') return lab(`<input type="${f.type}" name="${id}" value="${esc(v || '')}"${f.type === 'time' ? ' step="1"' : ''}>`);
      if (f.type === 'object') return `<div class="selbox" data-f="${i}">${lab(`<textarea name="${id}" rows="4" spellcheck="false">${esc(toLoose(v))}</textarea>`)}</div>`;
      if (f.type === 'selector') return `<div class="selbox" data-f="${i}">${lab(`<input name="${id}" value="${esc(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)}">`)}</div>`;
      const opts = f.options && f.options.length ? `<datalist id="dl${i}">${f.options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
      return lab(`<input name="${id}" value="${esc(v == null ? '' : v)}"${opts ? ` list="dl${i}"` : ''}>${opts}`);
    }
    // Home Assistant's own editors for event data, notification data and script fields, once they are loaded
    _mountFields(spec) {
      const m = this._$.modal, t = this._tst;
      const want = spec.fields.map((f, i) => [f, i]).filter(([f]) => f.type === 'object' || f.type === 'selector');
      if (!want.length) return;
      this._ensureSelector().then((ok) => {
        if (!ok || this._tst !== t || t.pick !== spec.id) return;
        want.forEach(([f, i]) => {
          const box = m.querySelector(`.selbox[data-f="${i}"]`);
          if (!box) return;
          const el = document.createElement('ha-selector');
          el.hass = this._hass; el.selector = f.type === 'object' ? { object: {} } : f.selector; el.label = f.label; el.required = !!f.required;
          const v = f.name in t.vals ? t.vals[f.name] : f.value;
          if (v !== undefined) el.value = v;
          if (f.hint) el.helper = f.hint;
          el.addEventListener('value-changed', (e) => {
            e.stopPropagation();
            if (e.detail && e.detail.isValid === false) { t.bad = f.label; return; }
            t.bad = null; t.vals[f.name] = e.detail.value; el.value = e.detail.value; this._testWhat(); this._linkPreview();
          });
          box.innerHTML = ''; box.appendChild(el); box.dataset.mounted = '1';
        });
      });
    }
    _readFields(spec) {
      const m = this._$.modal, t = this._tst, out = {};
      spec.fields.forEach((f, i) => {
        const box = m.querySelector(`.selbox[data-f="${i}"]`);
        if (box && box.dataset.mounted) { if (f.name in t.vals) out[f.name] = t.vals[f.name]; else if (f.value !== undefined) out[f.name] = f.value; return; }
        const el = m.querySelector(`[name="tf${i}"]`);
        if (!el) return;
        if (f.type === 'bool') out[f.name] = el.checked;
        else if (f.type === 'number') out[f.name] = el.value === '' ? '' : +el.value;
        else if (f.type === 'object') out[f.name] = parseLoose(el.value);
        else if (f.type === 'selector') out[f.name] = el.value === '' ? '' : scalar(el.value);
        else out[f.name] = el.value;
      });
      return out;
    }
    _buildTest(spec, vals) {
      const k = this._tst.key, n = this._model.nodes.get(k);
      const keep = (x) => x !== '' && x != null && !(typeof x === 'number' && isNaN(x));
      switch (spec.kind) {
        case 'action': {
          const data = {};
          spec.fields.forEach((f) => { if (keep(vals[f.name])) data[f.name] = vals[f.name]; });
          return { kind: 'action', target: k, service: spec.service, data };
        }
        case 'state': return { kind: 'state', target: k, state: String(vals.state == null ? '' : vals.state).trim() };
        case 'event': return k.startsWith('nact:') ? Object.assign({ kind: 'event', target: k }, this._buttonEvent(n))
          : { kind: 'event', target: k, event_type: k.slice(6), event_data: vals.event_data && typeof vals.event_data === 'object' ? vals.event_data : {} };
        case 'mqtt': return { kind: 'mqtt', target: k, topic: k.slice(5), payload: String(vals.payload == null ? '' : vals.payload) };
        case 'notify': return { kind: 'notify', target: k, service: k.startsWith('svc:') ? k.slice(4) : 'notify.send_message', data: vals.data && typeof vals.data === 'object' ? vals.data : {} };
        case 'run': {
          if (n.domain === 'automation') return { kind: 'run', target: k, skip_condition: !vals.check };
          const variables = {};
          spec.fields.forEach((f) => { if (keep(vals[f.name])) variables[f.name] = vals[f.name]; });
          return { kind: 'run', target: k, variables };
        }
        default: return null;
      }
    }
    _testProblem(test, spec) {
      if (!test) return T('nothing_to_run');
      if (this._tst && this._tst.bad) return T('fix_first', { bad: this._tst.bad });
      if (test.kind === 'state' && !test.state) return T('enter_the_state_to_simulate');
      if (test.kind === 'action') {
        const f = spec.fields.find((x) => (x.name === 'value' || x.name === 'option') && !(x.name in test.data));
        if (f) return T('fill_in', { label: f.label });
        if (test.service === 'input_datetime.set_datetime' && !test.data.date && !test.data.time) return T('fill_in_the_date_or');
      }
      if (test.kind === 'run' && test.variables) { const f = spec.fields.find((x) => x.required && !(x.name in test.variables)); if (f) return T('fill_in', { label: f.label }); }
      if (test.kind === 'notify' && !(test.data && test.data.message)) return T('a_notification_needs_a_message');
      return null;
    }
    // a test in a few words, for its button, its toast and the logbook
    _describeTest(t) {
      const who = this._boxName(t.target);
      switch (t.kind) {
        case 'action': {
          const s = t.service.split('.')[1], v = t.data || {};
          const verb = { turn_on: T('turn_on'), turn_off: T('turn_off'), toggle: T('toggle'), press: T('press_2'), increment: T('increment'), decrement: T('decrement'), reset: T('reset'),
            set_value: T('set'), select_option: T('set'), set_datetime: T('set'), start: T('start'), finish: T('finish'), cancel: T('cancel'), pause: T('pause') }[s] || t.service;
          const val = v.value != null ? ' to ' + v.value : v.option != null ? ' to ' + v.option : v.duration ? ' for ' + v.duration : (v.date || v.time) ? ' to ' + [v.date, v.time].filter(Boolean).join(' ') : '';
          return verb + ' ' + who + val;
        }
        case 'state': return T('simulated', { who, state: t.state });
        case 'event': return t.target.startsWith('nact:') ? T('press', { who }) : T('fire', { event_type: t.event_type });
        case 'mqtt': return T('publish_to', { topic: t.topic });
        case 'notify': return T('send_a_test_notification_with', { who });
        case 'run': return T('run', { who, extra: t.skip_condition ? T('without_its_conditions') : '' });
        default: return T('test_2');
      }
    }
    _boxName(k) {
      const n = this._model && this._model.nodes.get(k);
      return n ? n.name : String(k).includes(':') ? String(k).slice(String(k).indexOf(':') + 1) : this._nameOf(k);
    }
    _testWhat() {
      const t = this._tst, el = this._$.modal.querySelector('.twhat');
      if (!t || !el) return;
      const spec = t.specs.find((s) => s.id === t.pick) || t.specs[0];
      let test = null;
      try { test = this._buildTest(spec, this._readFields(spec)); } catch (e) { el.textContent = String((e && e.message) || e); return; }
      const auto = test && test.kind === 'run' && test.target.startsWith('automation.');
      const extra = {
        action: T('a_real_change_whatever_reacts'),
        state: T('only_home_assistant_s_copy'),
        event: T('every_automation_waiting_for_this'),
        mqtt: T('publishes_it_to_the_broker'),
        notify: T('sends_it_for_real_templates'),
        run: auto ? (test.skip_condition ? T('runs_its_actions_straight_away') : T('checks_its_conditions_then_runs')) : T('runs_it_with_these_fields'),
      };
      el.textContent = (test ? this._describeTest(test) + '. ' : '') + (extra[spec.kind] || '');
    }
    async _testRunDlg(saveOnly) {
      const t = this._tst;
      if (!t) return;
      const spec = t.specs.find((s) => s.id === t.pick) || t.specs[0];
      let test, vals;
      try { vals = this._readFields(spec); test = this._buildTest(spec, vals); } catch (e) { this._toast(T('check_the_fields', { e: (e && e.message) || e })); return; }
      const bad = this._testProblem(test, spec);
      if (bad) { this._toast(bad); return; }
      const keep = !!(this._$.modal.querySelector('input[name="keep"]') || {}).checked;
      if (t.toolId) this._saveTool(t.toolId, test);
      else if (keep) this._keepTest(test);
      this._tst = null;
      this._closeModal();
      if (!saveOnly) await this._doTest(test);
    }
    async _execTest(t) {
      const id = t.target;
      const call = (svc, data, target) => { const i = svc.indexOf('.'); return this._hass.callService(svc.slice(0, i), svc.slice(i + 1), data || {}, target); };
      switch (t.kind) {
        case 'action': return call(t.service, t.data, { entity_id: id });
        case 'state': {
          // Home Assistant's copy only: the next update from the device or its integration puts the real state back
          const st = this._hass.states[id];
          const r = await this._hass.callApi('POST', 'states/' + id, { state: t.state, attributes: st ? st.attributes : {} });
          if (r && r.context && r.context.id) this._sim.set(id, r.context.id);
          this._refreshStates();
          return r;
        }
        case 'event': return this._ws({ type: 'fire_event', event_type: t.event_type, event_data: t.event_data || {} });
        case 'mqtt': return call('mqtt.publish', { topic: t.topic, payload: t.payload });
        case 'notify': return call(t.service, await this._fillTemplates(t.data || {}), id.includes(':') ? undefined : { entity_id: id });
        case 'run': return id.startsWith('automation.') ? call('automation.trigger', { skip_condition: !!t.skip_condition }, { entity_id: id })
          : call('script.turn_on', { variables: t.variables || {} }, { entity_id: id });
        default: throw new Error(T('unknown_test'));
      }
    }
    // a notification's templates, filled in by Home Assistant, as sending it from an automation would
    async _fillTemplates(v) {
      if (typeof v === 'string') { if (!TPL_RE.test(v)) return v; const r = await this._renderOnce(v); return r == null ? v : typeof r === 'string' ? r : JSON.stringify(r); }
      if (Array.isArray(v)) return Promise.all(v.map((x) => this._fillTemplates(x)));
      if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await this._fillTemplates(x); return out; }
      return v;
    }
    _renderOnce(template) {
      return new Promise((resolve) => {
        let done = false, unsub = null;
        const fin = (v) => { if (done) return; done = true; resolve(v); Promise.resolve(unsub).then((f) => f && f()).catch(() => {}); };
        unsub = this._hass.connection.subscribeMessage((msg) => fin(msg && !msg.error ? msg.result : null), { type: 'render_template', template, strict: false, report_errors: true, timeout: 3 }).catch(() => fin(null));
        setTimeout(() => fin(null), 4000);
      });
    }
    async _doTest(test) {
      if (this._sbxOn()) return this._sbxTest(test);
      if (!this._full()) { this._toast(FULL_ONLY_TEST); return false; }
      this._testOk = true;
      let err = null;
      try { await this._execTest(test); } catch (e) { err = (e && (e.message || e.code)) || String(e); }
      this._logTest(test, err);
      const text = this._describeTest(test);
      if (err) this._toast(T('test_failed', { text, err }));
      else this._toast(T('test_sent_tests_can_t', { text }), this._drawer && this._drawer.mode === 'debug' ? [] : [{ text: T('debug_2'), fn: () => this._openDebug() }]);
      return !err;
    }
    _logTest(test, err) {
      const text = this._describeTest(test);
      const entry = { kind: 'test', t: Date.now(), key: test.target, text: T('test_3', { text, extra: err ? ` ${T('failed_2', { err })}` : '' }) };
      this._testLog.push(entry);
      if (this._testLog.length > 100) this._testLog.shift();
      if (this._dbg && this._dbg.rec && this._dbg.label === (this._model && this._model.label)) this._dbgAdd(Object.assign({}, entry));
      if (err || !this._hass.services.logbook || !this._hass.services.logbook.log) return;
      const ent = !String(test.target).includes(':') && this._hass.states[test.target] ? test.target : null;
      this._hass.callService('logbook', 'log', Object.assign({ name: 'Functions Board', message: 'test: ' + text, domain: 'functions_board' }, ent ? { entity_id: ent } : {})).catch(() => {});
    }

    // ---- boxes that live in the layout, not in Home Assistant: kept tests (9.2) and monitors (9.3)
    _toolById(id) { const m = this._model, L = m && this._layout(m.label); return (L && (L.tools || []).find((t) => t.id === id)) || null; }
    _toolNodes(label, nodes, edges) {
      (this._layout(label).tools || []).forEach((t) => {
        const key = 'tool:' + t.id, inj = t.type === 'inject';
        nodes.set(key, { key, kind: 'tool', domain: inj ? 'inject' : 'monitor', tool: t, name: t.title || (inj ? T('test_2') : t.topic),
          icon: inj ? 'mdi:play-circle-outline' : 'mdi:monitor-eye', badges: new Set(), writers: 0, x: 0, y: 0, w: inj ? XW : 280, h: inj ? 48 : 176 });
        const tgt = inj ? t.test && t.test.target : t.target, mk = (from, to) => ({ id: from + '>' + to, from, to, role: 'tool', svcs: new Set(), tfs: [], anyTrig: false, via: null, loop: false });
        if (tgt && nodes.has(tgt)) edges.push(inj ? mk(key, tgt) : mk(tgt, key));
      });
    }
    // the open function's tool boxes, again from its layout (after adding, removing or undoing one)
    _syncTools() {
      const m = this._model;
      if (!m) return;
      [...m.nodes.keys()].filter((k) => k.startsWith('tool:')).forEach((k) => m.nodes.delete(k));
      m.edges = m.edges.filter((e) => e.role !== 'tool');
      this._toolNodes(m.label, m.nodes, m.edges);
    }
    _freeSpot(x, y, w, h) {
      const boxes = this._model ? [...this._model.nodes.values()] : [];
      const hit = (px, py) => boxes.some((o) => px < o.x + o.w + 16 && px + w + 16 > o.x && py < o.y + o.h + 12 && py + h + 12 > o.y);
      let px = Math.round(x), py = Math.round(y);
      for (let i = 0; i < 40 && hit(px, py); i++) py += h + 12;
      return { x: px, y: py };
    }
    _addTool(tool, near, w, h, text) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label), c = this._center();
      L.tools = (L.tools || []).concat([tool]);
      const n = near && this._model.nodes.get(near);
      L.nodes['tool:' + tool.id] = tool.type === 'inject'
        ? this._freeSpot(n ? n.x - w - 70 : c.x - w / 2, n ? n.y : c.y, w, h)
        : this._freeSpot(n ? n.x : c.x - w / 2, n ? n.y + n.h + 30 : c.y - h / 2, w, h);
      this._save(); this._syncTools(); this._place(); this._render(); this._startMonitors();
      this._layoutStep(label, before, text);
      this._showBox('tool:' + tool.id);
    }
    // a box placed out of sight, or under the key, is brought into view
    _showBox(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      const v = this._view, W = this._openWidth(), H = this._$.vp.clientHeight;
      const x = n.x * v.k + v.x, y = n.y * v.k + v.y, w = n.w * v.k, h = n.h * v.k;
      const vr = this._$.vp.getBoundingClientRect(), lr = this._$.legend.getBoundingClientRect();
      const lx = lr.left - vr.left, ly = lr.top - vr.top, under = lr.width && x < lx + lr.width && x + w > lx && y < ly + lr.height && y + h > ly;
      if (x < 8 || y < 8 || x + w > W - 8 || y + h > H - 8 || under) { this._centerOn(key); this._saveView(); }
    }
    _keepTest(test) { this._addTool({ id: uid(), type: 'inject', title: this._describeTest(test), test }, test.target, XW, 48, T('keep_a_test_on_the')); }
    _saveTool(id, test) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.tools = (L.tools || []).map((t) => (t.id === id ? Object.assign({}, t, { test, title: this._describeTest(test) }) : t));
      this._save(); this._syncTools(); this._place(); this._render();
      this._layoutStep(label, before, T('change_a_test_button'));
    }
    _delTool(id) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.tools = (L.tools || []).filter((t) => t.id !== id);
      delete L.nodes['tool:' + id];
      this._stopMonitor(id); this._monData.delete(id);
      if (this._sel === 'tool:' + id) this._sel = null;
      this._save(); this._syncTools(); this._place(); this._render();
      this._layoutStep(label, before, T('remove_a_box'));
    }
    async _toolRun(id) {
      const t = this._toolById(id);
      if (!t || t.type !== 'inject') return;
      if (!this._full()) { this._toast(FULL_ONLY_TEST); return; }
      const k = t.test.target;
      if (!this._model.nodes.has(k) && !this._hass.states[k] && !/^(event|mqtt|nact|svc):/.test(k)) { this._toast(T('what_this_test_changes_is')); return; }
      const el = this._els.get('tool:' + id);
      if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
      if (!this._testOk) { this._confirmTest(t.test); return; }
      await this._doTest(t.test);
    }
    // the first test of a session, from a kept test button: say what tests do, once
    _confirmTest(test) {
      this._pendingTest = test;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('run_this_test_2')}</h3><div class="tone">${esc(this._describeTest(test))}</div><div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${esc(TEST_WARN)}</span></div><div class="hint">${T('the_board_asks_once_per')}</div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="test-confirm">${T('run_test')}</button></div></div>`;
    }
    _toolHTML(n) {
      const t = n.tool, pos = `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`;
      if (t.type === 'inject') {
        return `<div class="node tool t-inj" data-key="${esc(n.key)}" role="button" tabindex="-1" style="${pos}"><button class="tplay" data-act="tool-run" data-tid="${esc(t.id)}" title="${esc(this._full() ? T('run_this_test') : FULL_ONLY_TEST)}"><ha-icon icon="mdi:play"></ha-icon></button>`
          + `<div class="txt"><div class="name">${esc(n.name)}</div><div class="sub"></div></div></div>`;
      }
      return `<div class="node tool t-mon" data-key="${esc(n.key)}" role="button" tabindex="-1" style="${pos}"><div class="mhead"><ha-icon icon="mdi:monitor-eye"></ha-icon><span class="name">${esc(n.name)}</span><span class="mcnt"></span></div>`
        + `<div class="mlist" data-tid="${esc(t.id)}"></div></div>`;
    }

    // ---- monitors (9.3): a box that lists the last 10 events of one type, or MQTT messages, while its function is open
    _monitorFor(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      let spec;
      if (key.startsWith('mqtt:')) {
        if (!(this._hass.config.components || []).includes('mqtt')) { this._toast(T('mqtt_isn_t_set_up')); return; }
        spec = { what: 'mqtt', topic: key.slice(5), title: T('mqtt_3', { key: key.slice(5) }) };
      } else if (key.startsWith('nact:')) {
        const b = this._buttonEvent(n);
        spec = { what: 'event', topic: b.event_type, title: T('button_presses', { event_type: b.event_type }) };
      } else spec = { what: 'event', topic: key.slice(6), title: T('events_2', { key: key.slice(6) }) };
      this._addMonitor(Object.assign(spec, { target: key }));
    }
    _addMonitor(spec) {
      this._addTool({ id: uid(), type: 'monitor', what: spec.what, topic: spec.topic, target: spec.target || null,
        title: spec.title || (spec.what === 'mqtt' ? T('mqtt_2') : T('events')) + spec.topic }, spec.target, 280, 176, T('add_a_monitor'));
    }
    async _monitorDlg() {
      if (!this._model) return;
      const m = this._$.modal, mq = (this._hass.config.components || []).includes('mqtt');
      this._monKind = 'event';
      m.hidden = false;
      m.innerHTML = `<div class="dlg mdlg"><h3>${T('monitor_box')}</h3><div class="hint">${T('a_box_on_the_board', { extra: mq ? T('or_the_last_10_messages') : '' })}</div>${mq ? `<div class="tchoice"><button class="chip on" data-act="mon-kind" data-k="event">${T('event_type')}</button><button class="chip" data-act="mon-kind" data-k="mqtt">${T('mqtt_topic')}</button></div>` : ''}<label><span class="mlab">${T('event_type')}</span><input name="topic" list="fbevtypes" placeholder="mobile_app_notification_action"><datalist id="fbevtypes"></datalist></label><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="mon-make">${T('add')}</button></div></div>`;
      setTimeout(() => { const i = m.querySelector('input[name=topic]'); if (i) i.focus(); }, 50);
      const types = await this._hass.callApi('GET', 'events').catch(() => []);
      const dl = m.querySelector('#fbevtypes');
      if (dl) dl.innerHTML = (types || []).map((x) => x && x.event).filter((x) => x && !NO_MONITOR.has(x)).sort().map((x) => `<option value="${esc(x)}">`).join('');
    }
    _monitorMake() {
      const m = this._$.modal, i = m.querySelector('input[name=topic]'), topic = ((i && i.value) || '').trim();
      if (!topic) { if (i) i.focus(); return; }
      if (this._monKind === 'event' && !/^[A-Za-z0-9_.:-]+$/.test(topic)) { this._toast(T('an_event_type_has_no')); return; }
      if (this._monKind === 'event' && NO_MONITOR.has(topic)) { this._toast(T('fires_too_often_for_a', { topic })); return; }
      this._closeModal();
      this._addMonitor({ what: this._monKind, topic });
    }
    // listen for the open function's monitor boxes; stop the ones that are gone
    _startMonitors() {
      const m = this._model, want = new Map();
      if (m) m.nodes.forEach((n) => { if (n.kind === 'tool' && n.tool.type === 'monitor') want.set(n.tool.id, n.tool); });
      [...this._monSubs.keys()].forEach((id) => { const t = want.get(id); if (!t || this._monSubs.get(id).sig !== t.what + '|' + t.topic) this._stopMonitor(id); });
      want.forEach((t, id) => {
        if (this._monSubs.has(id)) return;
        const c = this._hass.connection, s = { sig: t.what + '|' + t.topic, p: null };
        this._monSubs.set(id, s);
        s.p = t.what === 'mqtt'
          ? c.subscribeMessage((msg) => this._monAdd(id, { t: Date.now(), text: String(msg && msg.payload), full: msg }), { type: 'mqtt/subscribe', topic: t.topic })
          : c.subscribeEvents((ev) => this._monAdd(id, { t: Date.parse(ev.time_fired) || Date.now(), text: JSON.stringify(ev.data || {}), full: ev.data }), t.topic);
        s.p.catch((e) => { if (this._monSubs.get(id) === s) this._monAdd(id, { t: Date.now(), err: (e && (e.message || e.code)) || 'error' }); });
      });
      this._renderMons();
    }
    _stopMonitor(id) { const s = this._monSubs.get(id); this._monSubs.delete(id); if (s && s.p) Promise.resolve(s.p).then((f) => f && f()).catch(() => {}); }
    _stopMonitors() { [...this._monSubs.keys()].forEach((id) => this._stopMonitor(id)); }
    _monAdd(id, item) {
      const list = this._monData.get(id) || [];
      list.unshift(item);
      this._monData.set(id, list.slice(0, 10));
      if (!item.err) this._monCount.set(id, (this._monCount.get(id) || 0) + 1);
      this._throttle('mon:' + id, 250, () => this._renderMon(id));
      const el = this._els.get('tool:' + id);
      if (el && !item.err) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    }
    _renderMons() { if (this._model) this._model.nodes.forEach((n) => { if (n.kind === 'tool' && n.tool.type === 'monitor') this._renderMon(n.tool.id); }); }
    _renderMon(id) {
      const box = this._$.nodes.querySelector(`.mlist[data-tid="${CSS.escape(id)}"]`);
      if (!box) return;
      const list = this._monData.get(id) || [], n = this._monCount.get(id) || 0;
      box.innerHTML = list.length ? list.map((x) => `<div class="mrow${x.err ? ' err' : ''}" title="${esc(shorten(x.err || JSON.stringify(x.full, null, 1) || '', 1200))}"><span class="mt">${esc(clockShort(x.t))}</span><span class="mv">${esc(x.err ? T('can_t_listen', { err: x.err }) : x.text)}</span></div>`).join('')
        : `<div class="mrow muted">${this._monSubs.has(id) ? T('listening_nothing_yet') : T('not_listening')}</div>`;
      const c = box.parentElement && box.parentElement.querySelector('.mcnt');
      if (c) c.textContent = n ? String(n) : '';
    }

    // ---- watch triggers (9.3): arm an automation's triggers without running it; its trigger arrows pulse when one
    // would fire, even while it is off. Pause plus Watch is a dry run.
    async _toggleWatch(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      if (this._tw.has(key)) { this._stopWatch(key); this._toast(T('stopped_watching', { name: n.name })); this._refreshStates(); this._renderNodebar(); return; }
      const cfg = await this._fetchConfig(key), trig = cfg && (cfg.triggers != null ? cfg.triggers : cfg.trigger);
      if (!trig || !toList(trig).length) { this._toast(T('has_no_triggers_to_watch', { name: n.name })); return; }
      const w = { label: this._model.label, hits: 0, unsub: null };
      this._tw.set(key, w);
      try {
        w.unsub = await this._hass.connection.subscribeMessage((msg) => this._onWatch(key, msg), { type: 'subscribe_trigger', trigger: trig, variables: {} });
      } catch (e) {
        if (this._tw.get(key) === w) this._tw.delete(key);
        this._toast(T('could_not_watch_its_triggers', { e: (e && (e.message || e.code)) || e }));
        this._refreshStates(); this._renderNodebar();
        return;
      }
      if (this._tw.get(key) !== w) { try { w.unsub(); } catch (e) { /* gone */ } return; }
      const st = this._hass.states[key];
      this._toast(T('watching_its_trigger_arrows_pulse', { name: n.name, extra: st && st.state === 'on' ? T('pause_the_function_too_for') : '' }));
      this._refreshStates(); this._renderNodebar();
    }
    _onWatch(key, msg) {
      const w = this._tw.get(key), m = this._model;
      if (!w) return;
      w.hits++;
      const tr = (msg && msg.variables && msg.variables.trigger) || {}, idx = tr.idx != null ? +tr.idx : -1;
      if (m && m.label === w.label) {
        m.edges.filter((e) => e.to === key && e.role !== 'tool' && (e.trigs || []).some((t) => t.i === idx)).forEach((e) => this._liveE.set(e.id, Date.now() + 2500));
        const el = this._els.get(key);
        if (el) { el.classList.remove('wpulse'); void el.offsetWidth; el.classList.add('wpulse'); }
        this._drawEdges();
        this._debounce('live', 2600, () => this._drawEdges());
        this._refreshStates();
      }
      const n = m && m.nodes.get(key);
      if (this._dbg && this._dbg.rec) this._dbgAdd({ kind: 'watch', t: Date.now(), key, text: T('trigger_would_fire', { name: n ? n.name : key, n: idx + 1, extra: tr.description ? ' (' + tr.description + ')' : '' }), by: { kind: 'watch', text: T('watch_triggers') } });
    }
    _stopWatch(key) { const w = this._tw.get(key); this._tw.delete(key); if (w && w.unsub) { try { w.unsub(); } catch (e) { /* gone */ } } }
    _stopWatches(keepLabel) { [...this._tw.entries()].forEach(([k, w]) => { if (!keepLabel || w.label !== keepLabel) this._stopWatch(k); }); }

    // ---- live checks (9.3): each check arrow shows whether its condition passes right now
    _testCondsSoon(ms) { this._debounce('conds', ms == null ? 400 : ms, () => this._testConds()); }
    async _testConds() {
      const m = this._model;
      if (!m || this._data.ui.condres === false || this._sbxOn()) { if (this._cond.size) { this._cond = new Map(); this._drawEdges(); } this._condKeys = null; return; }
      const E = m.edges.filter((e) => e.conds && e.conds.length);
      this._condKeys = new Set(E.map((e) => e.from).filter((k) => !k.includes(':')));
      if (!E.length) { if (this._cond.size) { this._cond = new Map(); this._drawEdges(); } return; }
      const memo = new Map(), bad = this._condBad || (this._condBad = new Map());
      const test = (c) => {
        if (c && typeof c === 'object' && c.enabled === false) return Promise.resolve({ off: true });
        const j = JSON.stringify(c);
        // one Home Assistant couldn't read is not asked again this session (it logs each refused message)
        if (bad.has(j)) return Promise.resolve({ err: bad.get(j) });
        if (!memo.has(j)) {
          memo.set(j, this._ws({ type: 'test_condition', condition: c }).then((r) => ({ ok: !!(r && r.result) }), (e) => {
            const err = (e && (e.message || e.code)) || 'error';
            if (e && (e.code === 'invalid_format' || e.code === 'unknown_error')) bad.set(j, err);
            return { err };
          }));
        }
        return memo.get(j);
      };
      const out = new Map();
      await Promise.all(E.map(async (e) => {
        const res = await Promise.all(e.conds.map((x) => test(x.c)));
        const items = e.conds.map((x, i) => Object.assign({ i: x.i }, res[i])), live = items.filter((x) => !x.off);
        const ok = live.some((x) => x.ok === false) ? false : live.length && live.every((x) => x.ok === true) ? true : null;
        out.set(e.id, { ok, items });
      }));
      if (m !== this._model) return;
      const sig = (mp) => JSON.stringify([...mp].map(([k, v]) => [k, v.ok, v.items.map((x) => (x.off ? 'off' : x.err ? 'err' : x.ok))]));
      const changed = sig(out) !== sig(this._cond);
      this._cond = out;
      if (changed) this._drawEdges();
    }
    _condTitle(e, c) {
      const a = this._model.nodes.get(e.from), b = this._model.nodes.get(e.to);
      return T('checks_2', { name: b.name, name2: a.name }) + c.items.map((x) => {
        const where = x.i >= 0 ? T('condition', { n: x.i + 1 }) : T('a_check_among_its_actions');
        if (x.off) return T('turned_off', { where });
        if (x.err) return T('can_t_be_checked_now', { where, err: /trigger|this\b/.test(x.err) ? T('it_uses_the_data_of') : x.err });
        return T('right_now', { where, extra: x.ok ? 'passes' : 'fails' });
      }).join('\n');
    }

    // ---- live template values (9.3): hovering an arrow that comes from a template shows what it gives now
    _edgeHover(id, ev) {
      const m = this._model, e = m && m.edges.find((x) => x.id === id);
      if (!e || !e.tpls || !e.tpls.size) { this._edgeHoverEnd(); return; }
      if (this._tt && this._tt.id === id) { this._ttMove(ev); return; }
      this._edgeHoverEnd();
      const tpls = [...e.tpls].slice(0, 3), tt = { id, vals: tpls.map(() => '…'), unsubs: [] };
      this._tt = tt;
      tpls.forEach((t, i) => {
        const p = this._hass.connection.subscribeMessage((msg) => {
          if (this._tt !== tt) return;
          tt.vals[i] = msg && msg.error ? '⚠ ' + (/trigger|this\b/.test(msg.error) ? T('uses_the_data_of_what') : msg.error) : fmtValue(msg && msg.result);
          this._ttRender(e, tpls);
        }, { type: 'render_template', template: t, strict: false, report_errors: true, timeout: 3 });
        p.catch((err) => { if (this._tt === tt) { tt.vals[i] = '⚠ ' + ((err && (err.message || err.code)) || 'error'); this._ttRender(e, tpls); } });
        tt.unsubs.push(p);
      });
      this._ttRender(e, tpls);
      this._ttMove(ev);
    }
    _ttRender(e, tpls) {
      const tip = this._$.ttip, tt = this._tt;
      if (!tt) return;
      tip.innerHTML = `<div class="tth">${esc(this._edgeTitle(e))}</div>` + tpls.map((t, i) => `<div class="ttt"><code>${esc(shorten(t, 180))}</code><div class="ttv">${esc(tt.vals[i])}</div></div>`).join('');
      tip.hidden = false;
    }
    _ttMove(ev) {
      const tip = this._$.ttip, r = this._$.vp.getBoundingClientRect();
      if (!ev || tip.hidden) return;
      const x = Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8), y = Math.min(ev.clientY - r.top + 14, r.height - tip.offsetHeight - 8);
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
    }
    _edgeHoverEnd() {
      const tt = this._tt;
      if (!tt) return;
      this._tt = null;
      tt.unsubs.forEach((p) => Promise.resolve(p).then((f) => f && f()).catch(() => {}));
      this._$.ttip.hidden = true;
    }

    // ---- the function debugger (9.4): a timeline of what happens to the function while the panel is open, with
    // what caused each step. Picking a step lights the chain that led to it on the board, one step at a time.
    _dbgNew(label) { return { label, rec: false, entries: [], byId: new Map(), subs: [], poll: null, since: Date.now(), users: new Map(), seen: null, ents: new Set(), logbook: null }; }
    async _openDebug() {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'debug' };
      const d = this._$.drawer;
      d.hidden = false;
      d.innerHTML = `<div class="dhead"><span class="dtitle">${T('debug', { fnName: esc(this._fnName(label)) })}</span><span class="rec" title="${T('the_debugger_records_while_this')}"><i></i>${T('recording')}</span><button data-act="dbg-mon" title="${T('add_a_monitor_box_the')}"><ha-icon icon="mdi:monitor-eye"></ha-icon></button><button data-act="dbg-clear" title="${T('clear_the_timeline')}"><ha-icon icon="mdi:broom"></ha-icon></button><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dbg"><div class="dflt"></div><div class="dwhy" hidden></div><div class="dtl"><div class="muted pad">${T('reading_the_last_15_minutes')}</div></div></div>`;
      this._fitLitbar();
      if (!this._dbg || this._dbg.label !== label) this._dbg = this._dbgNew(label);
      await this._dbgStart();
      this._renderDbg();
      this._renderWhy();
    }
    // the function's entities, and the entities behind its devices and its area, floor and label targets
    _dbgEntities() {
      const m = this._model, out = new Set();
      if (!m) return [];
      m.nodes.forEach((n, k) => {
        if (n.kind === 'tool') return;
        if (!k.includes(':') && this._hass.states[k]) out.add(k);
        (n.targets || []).forEach((x) => out.add(x));
        if (k.startsWith('device:')) this._ents.forEach((e) => { if (e.device_id === k.slice(7) && this._hass.states[e.entity_id]) out.add(e.entity_id); });
      });
      return [...out];
    }
    async _dbgStart() {
      const g = this._dbg;
      if (!g || g.rec) return;
      g.rec = true;
      const c = this._hass.connection, back = new Date(Date.now() - DBG_BACK).toISOString(), ents = this._dbgEntities();
      g.ents = new Set(ents);
      if (g.entries.length) this._dbgAdd({ kind: 'note', t: Date.now(), text: T('recording_again') });
      // this session's own tests (events have no entity, so the logbook below doesn't list them)
      this._testLog.filter((x) => x.t > Date.now() - DBG_BACK).forEach((x) => this._dbgAdd(Object.assign({ id: 'test:' + x.t + ':' + x.key }, x)));
      // what happened to its entities, and what caused it: the logbook, the last 15 minutes first, then live
      if (ents.length) {
        const p = c.subscribeMessage((msg) => this._dbgLogbook(msg), { type: 'logbook/event_stream', start_time: back, entity_ids: ents.slice(0, 500) });
        g.subs.push(p);
        try { await p; g.logbook = true; } catch (e) {
          g.logbook = false;
          this._dbgAdd({ kind: 'note', t: Date.now(), text: T('the_logbook_isn_t_available') });
        }
      }
      if (!g.rec) return;
      // action calls: Home Assistant's action history for the last 15 minutes, then live
      this._ws({ type: 'logbook/get_action_calls', start_time: back }).then((rows) => { (rows || []).forEach((r) => this._dbgCall(r)); this._renderDbgSoon(); }, () => {});
      g.subs.push(c.subscribeEvents((ev) => this._dbgCallEvent(ev), 'call_service'));
      // states the logbook leaves out (counters, measurements), or all of them without a logbook
      g.seen = new Map(ents.map((k) => { const s = this._hass.states[k]; return [k, s ? s.last_changed : null]; }));
      // every run, also the ones a condition stopped, from the traces
      await this._dbgTraces();
      clearInterval(g.poll);
      if (g.rec) g.poll = setInterval(() => this._dbgTraces(), 4000);
      if (!g.users.size) this._ws({ type: 'config/auth/list' }).then((us) => { (us || []).forEach((u) => g.users.set(u.id, u.name)); this._renderDbgSoon(); }, () => {});
    }
    _dbgStop(quiet) {
      const g = this._dbg;
      if (!g || !g.rec) return;
      g.rec = false;
      clearInterval(g.poll); g.poll = null;
      g.subs.forEach((p) => Promise.resolve(p).then((f) => f && f()).catch(() => {}));
      g.subs = [];
      if (!quiet) this._dbgAdd({ kind: 'note', t: Date.now(), text: T('stopped_recording') });
    }
    // leaving the debug panel for another drawer stops recording
    _leaveDrawerMode() {
      if (this._drawer && this._drawer.mode === 'debug') this._dbgStop();
      if (this._drawer && this._drawer.mode === 'sandbox') { this._sbxEnd(); this._testCondsSoon(0); }
    }
    _dbgAdd(e) {
      const g = this._dbg;
      if (!g) return null;
      // Clear starts the list again: what happened before it stays out, also when the traces are read again
      if (g.cleared && e.t && e.t < g.cleared) return null;
      if (!e.id) e.id = e.kind + ':' + (++this._dbgSeq);
      if (g.byId.has(e.id)) return g.byId.get(e.id);
      g.byId.set(e.id, e);
      // in time order: most arrive last, the 15 minutes read at the start can come in between
      let i = g.entries.length;
      while (i > 0 && g.entries[i - 1].t > e.t) i--;
      g.entries.splice(i, 0, e);
      if (g.entries.length > 500) g.byId.delete(g.entries.shift().id);
      // a run can arrive after the calls and changes it made: they now know their cause
      if (e.kind === 'run' && e.ctx) this._dbgOwn(e);
      this._renderDbgSoon();
      return e;
    }
    _dbgOwn(run) {
      const g = this._dbg, by = { kind: run.run.domain === 'script' ? 'script' : 'auto', key: run.key, text: this._nameOf(run.key) };
      g.entries.forEach((x) => { if (x !== run && x.ctx === run.ctx && x.kind !== 'run' && (!x.by || (x.by.kind !== 'auto' && x.by.kind !== 'script'))) x.by = by; });
    }
    _userName(id) {
      if (!id) return T('a_user');
      if (this._hass.user && id === this._hass.user.id) return T('you');
      return (this._dbg && this._dbg.users.get(id)) || T('a_user');
    }
    // what caused a logbook entry or an action call, from the context Home Assistant attached to it
    _dbgCause(ev) {
      const et = ev.context_event_type;
      if ((et === 'automation_triggered' || et === 'script_started') && ev.context_entity_id) {
        return { kind: et === 'script_started' ? 'script' : 'auto', key: ev.context_entity_id, text: ev.context_name || this._nameOf(ev.context_entity_id) };
      }
      if (et === 'automation_triggered' || et === 'script_started') return { kind: 'pending', text: ev.context_name || T('an_automation_or_script') };
      if (et === 'call_service') return { kind: 'user', text: (ev.context_user_id ? this._userName(ev.context_user_id) : T('an_action')) + (ev.context_domain ? ` (${ev.context_domain}.${ev.context_service})` : '') };
      if (ev.context_user_id) return { kind: 'user', text: this._userName(ev.context_user_id) };
      if (et) return { kind: 'event', text: et };
      return { kind: 'self', text: T('its_device_or_integration') };
    }
    _dbgLogbook(msg) {
      const g = this._dbg;
      if (!g || !msg || !Array.isArray(msg.events)) return;
      msg.events.forEach((ev) => {
        const t = Math.round((+ev.when || 0) * 1000), k = ev.entity_id;
        if (ev.domain === 'functions_board' || ev.name === 'Functions Board') {
          // a test: this session's are listed already; ones from another board come from the logbook
          if (!this._testLog.some((x) => Math.abs(x.t - t) < 5000)) this._dbgAdd({ id: 'lbt:' + t, kind: 'test', t, key: k || null, text: T('test', { message: String(ev.message || '').replace(/^test: /, '') }), by: { kind: 'user', text: T('another_board') } });
          return;
        }
        if (ev.run_id && (ev.domain === 'automation' || ev.domain === 'script')) {
          const id = 'run:' + ev.run_id, was = g.byId.get(id), by = this._dbgCause(ev);
          if (was) { was.ctx = was.ctx || ev.context_id; if (!was.src) was.src = ev.source || ''; if (by.kind === 'auto' || by.kind === 'script') was.by = by; return; }
          this._dbgAdd({ id, kind: 'run', t, key: k, run: { domain: ev.domain, item_id: ev.item_id, run_id: ev.run_id }, src: ev.source || '', ctx: ev.context_id, by, state: 'running' });
          return;
        }
        if (k && ev.state != null) {
          if (k.startsWith('script.')) return;  // on and off are its runs, listed already
          this._dbgAdd({ id: 'st:' + k + ':' + t, kind: 'state', t, key: k, state: ev.state, by: this._dbgCause(ev) });
          return;
        }
        if (ev.message) this._dbgAdd({ kind: 'log', t, key: k || null, text: `${ev.name || (k ? this._nameOf(k) : '')} ${ev.message}`.trim(), by: this._dbgCause(ev) });
      });
      this._renderDbgSoon();
    }
    // an action call that touches the function: one of its entities, devices or areas, one of its scripts or
    // action boxes, or a call made by one of its automations or scripts
    _dbgCall(r) {
      const g = this._dbg, m = this._model;
      if (!g || !m || !r || !r.domain || DBG_QUIET.has(r.domain)) return;
      const sd = r.service_data || {}, ents = toList(sd.entity_id).filter((x) => typeof x === 'string');
      const by = r.context_entity_id && m.nodes.get(r.context_entity_id);
      const svcKey = 'svc:' + r.domain + '.' + r.service, scKey = r.domain === 'script' ? 'script.' + r.service : null;
      const mine = (by && by.kind === 'member') || ents.some((x) => g.ents.has(x)) || toList(sd.device_id).some((x) => m.nodes.has('device:' + x))
        || toList(sd.area_id).some((x) => m.nodes.has('area:' + x)) || (scKey && m.nodes.has(scKey)) || m.nodes.has(svcKey);
      if (!mine) return;
      const t = Math.round((+r.when || 0) * 1000);
      this._dbgAdd({ id: 'call:' + (r.context_id || '') + ':' + r.domain + '.' + r.service + ':' + ents.join(',') + ':' + Math.round(t / 1000), kind: 'call', t,
        key: ents.find((x) => m.nodes.has(x)) || (scKey && m.nodes.has(scKey) ? scKey : m.nodes.has(svcKey) ? svcKey : null),
        svc: r.domain + '.' + r.service, ents, ctx: r.context_id, by: this._dbgCause(r) });
    }
    _dbgCallEvent(ev) {
      const d = (ev && ev.data) || {}, cx = (ev && ev.context) || {}, run = this._dbgRunByCtx(cx.id);
      // the same shape as a row of the action history
      const r = { domain: d.domain, service: d.service, service_data: Object.assign({}, d.service_data || {}), context_id: cx.id, when: (Date.parse(ev.time_fired) || Date.now()) / 1000, context_user_id: cx.user_id };
      if (run) Object.assign(r, { context_event_type: run.run.domain === 'script' ? 'script_started' : 'automation_triggered', context_entity_id: run.key, context_name: this._nameOf(run.key) });
      // made from within a run the logbook hasn't listed yet: its run fills in the name when it arrives (_dbgOwn)
      else if (cx.parent_id && !cx.user_id) Object.assign(r, { context_event_type: 'automation_triggered', context_name: T('an_automation_or_script') });
      this._dbgCall(r);
    }
    _dbgRunByCtx(id) {
      const g = this._dbg;
      if (!id || !g) return null;
      for (let i = g.entries.length - 1; i >= 0; i--) { const e = g.entries[i]; if (e.kind === 'run' && e.ctx === id) return e; }
      return null;
    }
    // runs from the traces: those a condition stopped, and why; the logbook only lists the ones that went ahead
    async _dbgTraces() {
      const g = this._dbg, m = this._model;
      if (!g || !g.rec || !m || g.tracing || m.label !== g.label) return;
      const ids = new Map();
      m.nodes.forEach((n, k) => { if (n.kind === 'member' && (n.domain === 'automation' || n.domain === 'script')) { const id = this._itemId(n); if (id) ids.set(n.domain + ':' + id, k); } });
      if (!ids.size) return;
      g.tracing = true;
      try {
        const doms = ['automation', 'script'].filter((d) => [...ids.keys()].some((x) => x.startsWith(d + ':')));
        const lists = await Promise.all(doms.map((dom) => this._ws({ type: 'trace/list', domain: dom }).then((l) => (l || []).map((r) => Object.assign({}, r, { domain: dom })), () => [])));
        const from = g.since - DBG_BACK;
        lists.flat().forEach((r) => {
          const key = ids.get(r.domain + ':' + r.item_id), t = Date.parse((r.timestamp && r.timestamp.start) || '') || 0;
          if (!key || t < from) return;
          const id = 'run:' + r.run_id, e = g.byId.get(id), upd = { state: r.state, exec: r.script_execution, err: r.error || null, nt: !!r.not_triggered };
          if (e) {
            if (e.state !== upd.state || e.exec !== upd.exec) { Object.assign(e, upd); if (!e.src && r.trigger) e.src = r.trigger; this._dbgExplain(e); this._renderDbgSoon(); }
            return;
          }
          this._dbgExplain(this._dbgAdd(Object.assign({ id, kind: 'run', t, key, run: { domain: r.domain, item_id: r.item_id, run_id: r.run_id }, src: r.trigger || '' }, upd)));
        });
      } finally { g.tracing = false; }
    }
    async _dbgExplain(e) {
      if (!e || e.why || e.explaining || e.state !== 'stopped' || !(e.nt || e.exec === 'failed_conditions' || e.exec === 'error' || e.err)) return;
      e.explaining = true;
      const tr = await this._ws({ type: 'trace/get', domain: e.run.domain, item_id: e.run.item_id, run_id: e.run.run_id }).catch(() => null);
      e.explaining = false;
      if (!tr) return;
      e.why = whyStopped(tr, (x) => this._nameOf(x));
      if (!e.ctx && tr.context) e.ctx = tr.context.id;
      this._renderDbgSoon();
    }
    // the board sees every state; the logbook leaves counters and measurements out
    _dbgStates() {
      const g = this._dbg;
      if (!g || !g.rec || !g.seen) return;
      g.seen.forEach((was, k) => {
        const s = this._hass.states[k];
        if (!s || s.last_changed === was) return;
        g.seen.set(k, s.last_changed);
        const d = k.split('.')[0];
        if (g.logbook && !(d === 'counter' || d === 'proximity' || (d === 'sensor' && (s.attributes.unit_of_measurement || s.attributes.state_class)))) return;
        if (d === 'script') return;
        const cx = s.context || {}, run = this._dbgRunByCtx(cx.id), t = Date.parse(s.last_changed) || Date.now();
        const by = run ? { kind: run.run.domain === 'script' ? 'script' : 'auto', key: run.key, text: this._nameOf(run.key) }
          : this._sim.get(k) === cx.id ? { kind: 'user', text: T('a_test_simulated') } : cx.user_id ? { kind: 'user', text: this._userName(cx.user_id) } : { kind: 'self', text: T('its_device_or_integration') };
        this._dbgAdd({ id: 'st:' + k + ':' + t, kind: 'state', t, key: k, state: s.state, by });
      });
    }
    _renderDbgSoon() { this._throttle('dbg', 200, () => this._renderDbg()); }
    _renderDbg() {
      const g = this._dbg, d = this._$.drawer;
      if (!g || !this._drawer || this._drawer.mode !== 'debug') return;
      const box = d.querySelector('.dtl'), fl = d.querySelector('.dflt'), rec = d.querySelector('.rec');
      if (!box) return;
      if (rec) rec.classList.toggle('on', !!g.rec);
      const F = DBG_FILTERS, cur = F[this._dbgFlt] ? this._dbgFlt : 'all';
      const count = (kinds) => g.entries.filter((e) => e.kind !== 'note' && (!kinds || kinds.includes(e.kind))).length;
      if (fl) fl.innerHTML = Object.entries(F).map(([k, [t, kinds]]) => `<button class="chip ${k === cur ? 'on' : ''}" data-act="dbg-flt" data-f="${k}">${t}<span>${count(kinds)}</span></button>`).join('');
      const kinds = F[cur][1], list = g.entries.filter((e) => !kinds || kinds.includes(e.kind) || e.kind === 'note');
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
      box.innerHTML = list.length ? list.map((e) => this._dbgRow(e)).join('')
        : `<div class="muted pad">${T('nothing_yet_whatever_happens_to')}</div>`;
      if (atEnd || !this._dbgScrolled) { box.scrollTop = box.scrollHeight; this._dbgScrolled = true; }
    }
    _dbgRow(e) {
      const nm = (k) => (k ? this._boxName(k) : '');
      if (e.kind === 'note') return `<div class="dbrow note"><span class="rt">${esc(clockShort(e.t))}</span><span class="dm">${esc(e.text)}</span></div>`;
      let main = '', sub = '', cls = '';
      if (e.kind === 'state') { main = `${nm(e.key)} → ${this._fmtState(e.key, e.state)}`; sub = e.by ? T('by', { text: e.by.text }) : ''; }
      else if (e.kind === 'run') {
        const o = e.nt ? { text: T('didn_t_fire_2'), cls: 'muted' } : !e.exec && e.state === 'running' ? { text: T('running'), cls: 'blue' } : OUTCOME({ state: e.state, script_execution: e.exec, error: e.err });
        main = `${nm(e.key)} · ${o.text.charAt(0).toLowerCase() + o.text.slice(1)}`; cls = o.cls;
        sub = (e.by && (e.by.kind === 'auto' || e.by.kind === 'script') && e.by.key !== e.key ? T('started_by', { text: e.by.text }) : e.src ? T('triggered_by_2', { src: e.src }) : '') + (e.why ? ' · ' + e.why : '');
      } else if (e.kind === 'call') { main = e.svc + (e.ents && e.ents.length ? ' → ' + e.ents.map(nm).join(', ') : ''); sub = e.by ? T('by', { text: e.by.text }) : ''; }
      else { main = e.text || ''; sub = e.by ? T('by', { text: e.by.text }) : e.kind === 'test' ? T('from_this_board') : ''; }
      return `<button class="dbrow k-${e.kind} ${cls} ${this._dbgSel === e.id ? 'on' : ''}" data-act="dbg-pick" data-id="${esc(e.id)}" data-key="${esc(e.key || '')}">`
        + `<span class="rt">${esc(clockShort(e.t))}</span><ha-icon icon="${DBG_ICON[e.kind] || 'mdi:circle-small'}"></ha-icon><span class="dm"><b>${esc(main)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span></button>`;
    }
    _fmtState(k, state) {
      const st = this._hass.states[k];
      try { return st && this._hass.formatEntityState ? this._hass.formatEntityState(Object.assign({}, st, { state: String(state) })) : String(state); } catch (e) { return String(state); }
    }
    /* ---------- Sandbox (Phase 10): the drawer, the controls, the timeline ---------- */
    /* ---------- versions (0.8.0): named snapshots of a function, kept by the integration (functions_board/version_*).
       A snapshot is what Home Assistant's own APIs return: the configs of the function's automations and scripts,
       its UI helpers' settings, which items are in it, its layout, and the devices its steps use. Saving one changes
       nothing. A version opens in a tab of its own (read-only, marked against what's there now), can be tried in
       the sandbox, and in Full manager can be restored through the same config APIs Home Assistant's editors use,
       after a dialog that lists every change; what's there before is saved first if the person ticks that box. ---------- */
    _verOK() { return this._storeMode === 'shared'; }
    async _verList(label) { const r = await this._ws({ type: 'functions_board/versions', label }); return (r && r.versions) || []; }
    _verGet(label, id) { return this._ws({ type: 'functions_board/version_get', label, version_id: id }); }
    // a saved config as the board reads it: a blueprint automation or script is filled in by Home Assistant
    async _verCfg(k, it) {
      const V = this._ver;
      if (V.cfgs.has(k)) return V.cfgs.get(k);
      let cfg = it.cfg;
      const bp = cfg && cfg.use_blueprint;
      if (bp && bp.path) {
        try { const r = await this._ws({ type: 'blueprint/substitute', domain: it.dom, path: bp.path, input: bp.input || {} }); if (r && r.substituted_config) cfg = Object.assign({}, r.substituted_config, { alias: cfg.alias, id: cfg.id, use_blueprint: bp }); } catch (e) { /* inputs only */ }
      }
      V.cfgs.set(k, cfg);
      return cfg;
    }
    _verMembers(label) {
      return this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id).concat(this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id));
    }
    // the function as it is now, read through Home Assistant's own APIs (nothing is changed)
    async _verSnapshot(label) {
      const members = this._verMembers(label), items = {}, lists = new Map(), devices = {};
      const list = async (dom) => { if (!lists.has(dom)) lists.set(dom, await this._ws({ type: dom + '/list' }).catch(() => null)); return lists.get(dom) || []; };
      for (const k of members) {
        if (k.startsWith('device:')) continue;
        const dom = k.split('.')[0], name = this._nameOf(k);
        if (dom === 'automation' || dom === 'script') {
          const r = await this._ws({ type: dom + '/config', entity_id: k }).catch(() => null), cfg = r && r.config;
          if (!cfg) continue;
          const id = dom === 'automation' ? cfg.id || null : k.slice(7);
          // only what's in automations.yaml or scripts.yaml can be written back: Home Assistant's editors say the same
          const own = id ? !!(await this._hass.callApi('GET', `config/${dom}/config/${encodeURIComponent(id)}`).catch(() => null)) : false;
          items[k] = { dom, id, name, cfg, yaml: !own };
        } else if (VER_HELPERS.has(dom)) {
          const reg = this._entMap.get(k), it = (await list(dom)).find((x) => reg && x.id === reg.unique_id);
          if (it) { const cfg = Object.assign({}, it); delete cfg.id; items[k] = { dom, id: it.id, name, cfg }; } else items[k] = { dom, id: null, name, yaml: true };
        }
      }
      const ids = new Set(members.filter((k) => k.startsWith('device:')).map((k) => k.slice(7)));
      Object.values(items).forEach((it) => { if (it.cfg) devIdsIn(it.cfg, ids); });
      ids.forEach((id) => { const d = this._devMap.get(id); if (d) devices[id] = { name: d.name_by_user || d.name || '', model: d.model || '', manufacturer: d.manufacturer || '' }; });
      const L = this._data.layouts[label] ? JSON.parse(JSON.stringify(this._data.layouts[label])) : null;
      if (L) delete L.view;
      return { fmt: 1, members, items, devices, layout: L };
    }
    _verWhen(at) { try { return new Date(at).toLocaleString(this._hass.language || undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(at).toLocaleString(); } }

    async _openVersions() {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      if (!this._verOK()) { this._toast(T('ver_needs_integration')); return; }
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'versions' };
      const d = this._$.drawer;
      d.hidden = false;
      d.innerHTML = `<div class="dhead"><span class="dtitle">${T('ver_title', { fnName: esc(this._fnName(label)) })}</span><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="vers"><div class="vnote">${T('ver_note')}</div><div class="vact"><button class="primary" data-act="ver-new"><ha-icon icon="mdi:camera-outline"></ha-icon>${T('ver_save_b')}</button></div><div class="vlist"><div class="muted pad">${T('ver_reading')}</div></div></div>`;
      this._fitLitbar();
      await this._renderVersions();
    }
    async _renderVersions() {
      const label = this._data.ui.current, box = this._$.drawer.querySelector('.vlist');
      if (!box || !this._drawer || this._drawer.mode !== 'versions') return;
      let vs;
      try { vs = await this._verList(label); } catch (e) { box.innerHTML = `<div class="lgerr">${esc((e && (e.message || e.code)) || e)}</div>`; return; }
      // which version (if any) is what's there now
      let print = null;
      try { print = verPrint(await this._verSnapshot(label)); } catch (e) { /* no match shown */ }
      if (!this._drawer || this._drawer.mode !== 'versions' || label !== this._data.ui.current) return;
      const active = vs.slice().reverse().find((v) => v.print && v.print === print), full = this._full(), viewing = this._ver && this._ver.label === label ? this._ver.id : null;
      this._verCache = { label, vs, active: active ? active.id : null };
      const row = (v) => `<div class="vrow${active && active.id === v.id ? ' on' : ''}${viewing === v.id ? ' view' : ''}" data-id="${esc(v.id)}"><div class="vh"><b>${esc(v.name)}</b>${active && active.id === v.id ? `<span class="vbadge">${T('ver_active')}</span>` : ''}${v.auto ? `<span class="vauto">${T('ver_auto')}</span>` : ''}</div>${v.desc ? `<div class="vdesc">${esc(v.desc)}</div>` : ''}<div class="vm">${esc(this._verWhen(v.at))}${v.by ? ' · ' + esc(v.by) : ''}</div>`
        + `<div class="vb"><button data-act="ver-open" data-id="${esc(v.id)}"><ha-icon icon="mdi:tab"></ha-icon>${T('ver_open')}</button><button data-act="ver-sbx" data-id="${esc(v.id)}"><ha-icon icon="mdi:flask-outline"></ha-icon>${T('ver_try')}</button>`
        + `<button data-act="ver-restore" data-id="${esc(v.id)}"${full && !(active && active.id === v.id) ? '' : ' disabled'} title="${full ? (active && active.id === v.id ? T('ver_is_active') : T('ver_restore_t')) : T('ver_restore_full')}"><ha-icon icon="mdi:backup-restore"></ha-icon>${T('ver_restore')}</button>`
        + `<button class="ib" data-act="diag" data-ver="${esc(v.id)}" title="${T('diag_ver_t')}"><ha-icon icon="mdi:file-download-outline"></ha-icon></button><button class="ib" data-act="ver-edit" data-id="${esc(v.id)}" title="${T('ver_edit_t')}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button><button class="ib" data-act="ver-del" data-id="${esc(v.id)}" title="${T('ver_del_t')}"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div></div>`;
      const now = `<div class="vrow cur${active ? '' : ' on'}"><div class="vh"><b>${T('ver_now')}</b>${active ? `<span class="muted">${T('ver_now_is', { name: esc(active.name) })}</span>` : `<span class="vbadge">${T('ver_active')}</span><span class="muted">${T('ver_now_unsaved')}</span>`}</div></div>`;
      box.innerHTML = now + (vs.length ? vs.slice().reverse().map(row).join('') : `<div class="muted pad">${T('ver_none')}</div>`);
    }
    _verNewDlg() {
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_save_h')}</h3><label>${T('name')}<input name="vname" maxlength="100" placeholder="${T('ver_name_ph')}"></label><label>${T('description')}<textarea name="vdesc" rows="3" maxlength="2000" placeholder="${T('ver_desc_ph')}"></textarea></label><div class="hint">${T('ver_save_hint')}</div><div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ver-save">${T('save')}</button></div></div>`;
      m.querySelector('input[name="vname"]').focus();
    }
    async _verSave() {
      const m = this._$.modal, label = this._data.ui.current, name = (m.querySelector('input[name="vname"]').value || '').trim(), desc = (m.querySelector('textarea[name="vdesc"]').value || '').trim();
      const val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ver-save"]');
      if (!name) { val.textContent = T('ver_name_needed'); return; }
      btn.disabled = true;
      try {
        const snap = await this._verSnapshot(label);
        await this._ws({ type: 'functions_board/version_save', label, name, desc, snapshot: snap, print: verPrint(snap), client: this._client() });
      } catch (e) { val.textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      this._closeModal();
      this._toast(T('ver_saved', { name }));
      if (!this._drawer || this._drawer.mode !== 'versions') this._openVersions(); else this._renderVersions();
    }
    _verFind(id) { return this._verCache && this._verCache.vs.find((v) => v.id === id); }
    _verEditDlg(id) {
      const v = this._verFind(id), m = this._$.modal;
      if (!v) return;
      this._verEditing = id;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_edit_h')}</h3><label>${T('name')}<input name="vname" maxlength="100" value="${esc(v.name)}"></label><label>${T('description')}<textarea name="vdesc" rows="3" maxlength="2000">${esc(v.desc || '')}</textarea></label><div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ver-edit-save">${T('save')}</button></div></div>`;
    }
    async _verEditSave() {
      const m = this._$.modal, name = (m.querySelector('input[name="vname"]').value || '').trim(), desc = (m.querySelector('textarea[name="vdesc"]').value || '').trim();
      if (!name) { m.querySelector('.aval').textContent = T('ver_name_needed'); return; }
      try { await this._ws({ type: 'functions_board/version_edit', label: this._data.ui.current, version_id: this._verEditing, name, desc, client: this._client() }); }
      catch (e) { m.querySelector('.aval').textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); return; }
      const tabs = this._vtabs && this._vtabs.get(this._data.ui.current), t = tabs && tabs.find((x) => x.id === this._verEditing);
      if (t) t.name = name;
      if (this._ver && this._ver.id === this._verEditing) this._ver.name = name;
      this._closeModal();
      this._renderVersions();
      this._renderVtabs();
    }
    _verDelDlg(id) {
      const v = this._verFind(id), m = this._$.modal;
      if (!v) return;
      this._verEditing = id;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_del_h', { name: esc(v.name) })}</h3><p class="dtext">${T('ver_del_text')}</p><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary danger" data-act="ver-del-go">${T('delete_3')}</button></div></div>`;
    }
    async _verDel() {
      const id = this._verEditing, label = this._data.ui.current;
      try { await this._ws({ type: 'functions_board/version_delete', label, version_id: id, client: this._client() }); } catch (e) { this._toast(T('ver_not_saved', { e: (e && (e.message || e.code)) || e })); return; }
      this._closeModal();
      if (this._vtabs && this._vtabs.has(label)) this._verCloseTab(id);
      this._renderVersions();
    }

    // ---- tabs: what's there now (active) and saved versions, one shown at a time
    async _verOpenTab(id, sandbox) {
      const label = this._data.ui.current;
      if (!label) return;
      let v;
      try { v = await this._verGet(label, id); } catch (e) { this._toast(T('ver_gone')); return; }
      this._vtabs = this._vtabs || new Map();
      const tabs = this._vtabs.get(label) || [];
      if (!tabs.some((t) => t.id === id)) tabs.push({ id, name: v.name });
      this._vtabs.set(label, tabs);
      await this._verView(id, v);
      if (sandbox) this._verTrySandbox();
    }
    _verTrySandbox() {
      if (this._sbxOn()) return;
      if (this._data.ui.sbxIntro === false) this._openSandbox(); else this._sbxIntro();
    }
    _verCloseTab(id) {
      const label = this._data.ui.current, tabs = (this._vtabs && this._vtabs.get(label)) || [];
      this._vtabs.set(label, tabs.filter((t) => t.id !== id));
      if (this._ver && this._ver.id === id) this._verView(null); else this._renderVtabs();
    }
    // show a saved version (id), or what's there now (null)
    async _verView(id, v) {
      const label = this._data.ui.current;
      if (!label) return;
      if (id && !v) { try { v = await this._verGet(label, id); } catch (e) { this._toast(T('ver_gone')); return; } }
      if (this._sbx || (this._drawer && this._drawer.mode === 'sandbox')) this._closeDrawer();
      this._clearLit(true);
      if (v) {
        const raw = v.snapshot.layout ? JSON.parse(JSON.stringify(v.snapshot.layout)) : {};
        const layout = Object.assign({ nodes: {}, frames: [], notes: [], view: null, categories: null }, cleanLayout(raw) || {});
        this._ver = { label, id: v.id, name: v.name, at: v.at, snap: v.snapshot, layout, cfgs: new Map(), diff: null };
        this._ver.diff = await this._verDiff(label, v.snapshot).catch(() => null);
      } else this._ver = null;
      this._$.board.classList.toggle('vview', !!v);
      try { history.replaceState(history.state, '', location.pathname + (v ? '?version=' + v.id : '')); } catch (e) { /* the link just won't carry it */ }
      await this._open(label, false, { fromRoute: true });
      if (this._drawer && this._drawer.mode === 'versions') this._renderVersions();
    }
    // what differs between a version and what's there now: boxes changed since, only in the version, added since
    async _verDiff(label, snap) {
      const cur = new Set(this._verMembers(label)), ver = new Set(snap.members), changed = new Set(), only = new Set(), lists = new Map();
      for (const k of ver) {
        if (!cur.has(k)) { only.add(k); continue; }
        const it = snap.items[k];
        if (!it || !it.cfg) continue;
        let now = null;
        if (it.dom === 'automation' || it.dom === 'script') { const r = await this._ws({ type: it.dom + '/config', entity_id: k }).catch(() => null); now = r && r.config; }
        else {
          if (!lists.has(it.dom)) lists.set(it.dom, await this._ws({ type: it.dom + '/list' }).catch(() => null));
          const x = (lists.get(it.dom) || []).find((y) => y.id === it.id);
          if (x) { now = Object.assign({}, x); delete now.id; }
        }
        if (now && canon(now) !== canon(it.cfg)) changed.add(k);
      }
      return { changed, only, added: [...cur].filter((k) => !ver.has(k)) };
    }
    _renderVtabs() {
      const el = this._$.vtabs, label = this._data && this._data.ui.current, tabs = (label && this._vtabs && this._vtabs.get(label)) || [];
      if (!el) return;
      const V = this._ver && this._ver.label === label ? this._ver : null;
      if (!tabs.length && !V) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      this._fitLitbar();
      const d = V && V.diff;
      el.innerHTML = `<div class="vtrow"><button class="vtab${V ? '' : ' on'}" data-act="vtab" data-id=""><span class="vdot"></span>${T('ver_current_tab')}<span class="vact">${T('ver_active')}</span></button>`
        + tabs.map((t) => `<span class="vtab${V && V.id === t.id ? ' on' : ''}"><button data-act="vtab" data-id="${esc(t.id)}"><ha-icon icon="mdi:history"></ha-icon>${esc(t.name)}</button><button class="ib" data-act="vtab-win" data-id="${esc(t.id)}" title="${T('ver_new_window')}"><ha-icon icon="mdi:open-in-new"></ha-icon></button><button class="ib" data-act="vtab-x" data-id="${esc(t.id)}" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></span>`).join('') + '</div>'
        + (V ? `<div class="vban"><ha-icon icon="mdi:history"></ha-icon><span>${T('ver_banner', { name: esc(V.name), when: esc(this._verWhen(V.at)) })}${d ? ' ' + T('ver_diff', { changed: d.changed.size, only: d.only.size, added: d.added.length }) : ''}</span><button data-act="ver-sbx-cur"><ha-icon icon="mdi:flask-outline"></ha-icon>${T('ver_try')}</button>${this._full() ? `<button data-act="ver-restore" data-id="${esc(V.id)}"><ha-icon icon="mdi:backup-restore"></ha-icon>${T('ver_restore')}</button>` : ''}</div>` : '');
    }

    // ---- restoring (Full manager): plan, dialog, then the writes, each through Home Assistant's own config APIs
    async _verRestore(id) {
      if (!this._full()) { this._toast(T('ver_restore_full')); return; }
      const label = this._data.ui.current, m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_restore_h0')}</h3><div class="muted">${T('ver_checking')}</div></div>`;
      let v, plan;
      let savedAs = null;
      try {
        v = await this._verGet(label, id); plan = await this._verPlan(label, v.snapshot);
        // is what's there now already one of the saved versions? (then a backup would only be another copy)
        const [vs, now] = await Promise.all([this._verList(label), this._verSnapshot(label)]), pr = verPrint(now);
        savedAs = vs.slice().reverse().find((x) => x.print && x.print === pr && x.id !== id) || null;
      } catch (e) { m.innerHTML = `<div class="dlg"><h3>${T('ver_restore_h0')}</h3><p class="dtext">${esc((e && (e.message || e.code)) || e)}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button></div></div>`; return; }
      this._verPending = { label, v, plan, devmap: {}, savedAs };
      this._verRestoreDlg();
    }
    async _verPlan(label, snap) {
      const diff = await this._verDiff(label, snap), cur = new Set(this._verMembers(label));
      const plan = { write: [], recreate: [], same: [], yaml: [], rejoin: [], added: [], missing: [] };
      Object.entries(snap.items).forEach(([k, it]) => {
        if (it.yaml || !it.cfg || !it.id && (it.dom === 'automation' || it.dom === 'script')) { plan.yaml.push(k); return; }
        const there = !!(this._hass.states[k] || this._entMap.has(k));
        if (!there) plan.recreate.push(k); else if (diff.changed.has(k)) plan.write.push(k); else plan.same.push(k);
      });
      snap.members.forEach((k) => { if (!cur.has(k) && !plan.recreate.includes(k) && (k.startsWith('device:') ? this._devMap.has(k.slice(7)) : this._entMap.has(k))) plan.rejoin.push(k); });
      plan.added = diff.added;
      plan.missing = Object.keys(snap.devices || {}).filter((d) => !this._devMap.has(d));
      return plan;
    }
    _verRestoreDlg() {
      const p = this._verPending, { v, plan } = p, snap = v.snapshot, m = this._$.modal, nm = (k) => esc((snap.items[k] && snap.items[k].name) || this._boxName(k));
      const line = (ks, text) => (ks.length ? `<li>${text} <span class="muted">${ks.slice(0, 8).map(nm).join(', ')}${ks.length > 8 ? ' …' : ''}</span></li>` : '');
      const logic = (k) => /^(automation|script)\./.test(k) || VER_HELPERS.has(k.split('.')[0]);
      const addLogic = plan.added.filter(logic), addOther = plan.added.filter((k) => !logic(k));
      const doms = new Set(plan.write.concat(plan.recreate).map((k) => k.split('.')[0]));
      const devs = plan.missing.map((d) => { const o = snap.devices[d] || {}; return `<div class="vdevrow"><div>${T('ver_dev_gone', { name: esc(o.name || d), model: esc([o.manufacturer, o.model].filter(Boolean).join(' ')) })}</div><div class="vdevpick" data-old="${esc(d)}"></div></div>`; }).join('');
      m.hidden = false;
      m.innerHTML = `<div class="dlg wide vrdlg"><h3>${T('ver_restore_h', { name: esc(v.name) })}</h3><p class="dtext">${T('ver_restore_lead', { fnName: esc(this._fnName(p.label)), when: esc(this._verWhen(v.at)) })}</p>`
        + `<ul class="vplan">${line(plan.write, P('ver_p_write', plan.write.length))}${line(plan.recreate, P('ver_p_recreate', plan.recreate.length))}${line(plan.rejoin, P('ver_p_rejoin', plan.rejoin.length))}${line(plan.same, P('ver_p_same', plan.same.length))}${line(plan.yaml, P('ver_p_yaml', plan.yaml.length))}${snap.layout ? `<li>${T('ver_p_layout')}</li>` : ''}</ul>`
        + (plan.missing.length ? `<h4>${T('ver_dev_h')}</h4><div class="hint">${T('ver_dev_hint')}</div>${devs}` : '')
        + (addLogic.length || addOther.length ? `<h4>${T('ver_added_h')}</h4>${addLogic.length ? `<div class="hint">${addLogic.map(nm).join(', ')}</div><label class="chk"><input type="radio" name="vextra" value="off" checked>${T('ver_added_off')}</label><label class="chk"><input type="radio" name="vextra" value="delete">${T('ver_added_delete')}</label>` : ''}${addOther.length ? `<div class="hint">${T('ver_added_other', { list: addOther.map(nm).join(', ') })}</div>` : ''}` : '')
        // a backup of what's there now only when asked for: switching between saved versions shouldn't pile up copies
        + `<label class="chk vbackup"><input type="checkbox" name="vbackup">${T('ver_restore_backup')}</label><div class="hint">${p.savedAs ? T('ver_now_saved_as', { name: esc(p.savedAs.name) }) : T('ver_restore_unsaved')}</div>`
        + [...doms].filter((d) => d === 'automation' || d === 'script').map((d) => this._yamlWarn(d)).join('')
        + `<div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ver-restore-go">${T('ver_restore')}</button></div></div>`;
      // a replaced device: Home Assistant's own device picker, or a plain list if it isn't loaded
      m.querySelectorAll('.vdevpick').forEach((box) => {
        const old = box.dataset.old;
        if (customElements.get('ha-selector')) {
          const sel = document.createElement('ha-selector');
          sel.hass = this._hass; sel.selector = { device: {} }; sel.label = T('ver_dev_pick'); sel.value = '';
          sel.addEventListener('value-changed', (e) => { p.devmap[old] = (e.detail && e.detail.value) || ''; });
          box.appendChild(sel);
        } else {
          const devs2 = this._devs.slice().sort((a, b) => (a.name_by_user || a.name || '').localeCompare(b.name_by_user || b.name || ''));
          box.innerHTML = `<select aria-label="${T('ver_dev_pick')}"><option value="">${T('ver_dev_keep')}</option>${devs2.map((d) => `<option value="${esc(d.id)}">${esc((d.name_by_user || d.name || d.id) + (d.model ? ' (' + d.model + ')' : ''))}</option>`).join('')}</select>`;
          box.querySelector('select').addEventListener('change', (e) => { p.devmap[old] = e.target.value; });
        }
      });
    }
    async _verRestoreGo() {
      const p = this._verPending, m = this._$.modal, val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ver-restore-go"]');
      if (!p) return;
      const extra = (m.querySelector('input[name="vextra"]:checked') || { value: 'off' }).value, backup = !!(m.querySelector('input[name="vbackup"]') || {}).checked;
      const { label, v, plan } = p, snap = v.snapshot, map = Object.fromEntries(Object.entries(p.devmap).filter(([, x]) => x)), errs = [], name = (k) => (snap.items[k] && snap.items[k].name) || this._boxName(k);
      btn.disabled = true;
      val.textContent = T('ver_restoring');
      // what's there now is saved first if asked for; otherwise undo goes back to the version it already matches, if any
      let back = p.savedAs;
      if (backup) {
        try {
          const now = await this._verSnapshot(label);
          back = await this._ws({ type: 'functions_board/version_save', label, name: T('ver_before_name', { name: v.name }), desc: '', snapshot: now, print: verPrint(now), auto: true, client: this._client() });
        } catch (e) { val.textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      }
      const exists = (k) => !!(this._hass.states[k] || this._entMap.has(k));
      for (const k of plan.write.concat(plan.recreate)) {
        const it = snap.items[k], cfg = swapDevs(it.cfg, map);
        try {
          if (it.dom === 'automation' || it.dom === 'script') await this._saveCfg(it.dom, it.id, cfg);
          else if (exists(k)) await this._ws(Object.assign({}, cfg, { type: it.dom + '/update', [it.dom + '_id']: it.id }));
          else { const made = await this._ws(Object.assign({}, cfg, { type: it.dom + '/create' })); it.newId = made && made.id; }
        } catch (e) { errs.push(name(k) + ': ' + ((e && (e.message || e.body || e.code)) || e)); }
      }
      // what came back, and what had left the function, wear its label again
      await new Promise((r) => setTimeout(r, plan.recreate.length ? 1500 : 200));
      const reg = await this._ws({ type: 'config/entity_registry/list' }).catch(() => []);
      const findNew = (k) => { const it = snap.items[k], uid = it.newId || it.id; const e = reg.find((x) => x.platform === it.dom && x.unique_id === uid); return e ? e.entity_id : null; };
      for (const k of plan.rejoin.concat(plan.recreate)) {
        const id = plan.recreate.includes(k) ? findNew(k) : k;
        if (id) { try { await this._label(id, label, true, false); } catch (e) { errs.push(name(k) + ': ' + ((e && e.message) || e)); } }
      }
      // what was added since: turned off or deleted, as chosen; anything else is taken out of the function
      for (const k of plan.added) {
        const dom = k.split('.')[0];
        try {
          if (dom === 'automation') {
            const r = await this._ws({ type: 'automation/config', entity_id: k }).catch(() => null), aid = r && r.config && r.config.id;
            if (extra === 'delete' && aid) await this._hass.callApi('DELETE', `config/automation/config/${encodeURIComponent(aid)}`);
            else await this._hass.callService('automation', 'turn_off', { entity_id: k });
          } else if (dom === 'script') {
            if (extra === 'delete') await this._hass.callApi('DELETE', `config/script/config/${encodeURIComponent(k.slice(7))}`);
          } else if (VER_HELPERS.has(dom)) {
            const e = this._entMap.get(k);
            if (extra === 'delete' && e && e.unique_id) await this._ws({ type: dom + '/delete', [dom + '_id']: e.unique_id });
          } else await this._label(k, label, false, false);
        } catch (e) { errs.push(this._boxName(k) + ': ' + ((e && (e.message || e.body || e.code)) || e)); }
      }
      // the board as it was laid out
      if (snap.layout) { this._data.layouts[label] = Object.assign(cleanLayout(JSON.parse(JSON.stringify(snap.layout))) || {}, { view: (this._data.layouts[label] || {}).view || null }); this._save(); }
      this._verPending = null;
      this._closeModal();
      this._cfgCache.clear();
      this._ver = null;
      this._$.board.classList.remove('vview');
      try { history.replaceState(history.state, '', location.pathname); } catch (e) { /* fine */ }
      await this._loadRegistries().catch(() => {});
      await this._open(label, true);
      const undo = back && back.id ? [{ text: T('undo'), fn: () => this._verRestore(back.id) }] : [];
      this._toast(errs.length ? T('ver_restored_errs', { name: v.name, n: errs.length, list: errs.slice(0, 3).join('; ') }) : T('ver_restored', { name: v.name }), undo);
      if (this._drawer && this._drawer.mode === 'versions') this._renderVersions();
    }

    _sbxOn() { return !!(this._sbx && this._drawer && this._drawer.mode === 'sandbox'); }
    // a box's state as the board shows it: the sandbox's while it's open, Home Assistant's otherwise
    _stOf(k) {
      if (!this._sbxOn()) return this._hass.states[k];
      const s = this._sbx.eng.get(k);
      return s ? { entity_id: k, state: String(s.state), attributes: s.attributes || {}, last_changed: s.last_changed, last_updated: s.last_updated, context: {} } : undefined;
    }
    // every time it opens: what the sandbox is for, and everything it can't do, to click through
    _sbxIntro() {
      const m = this._$.modal, li = (xs) => xs.map((x) => `<li>${x}</li>`).join(''), open = this._sbxOn();
      m.hidden = false;
      m.innerHTML = `<div class="dlg sbxdlg"><h3><ha-icon icon="mdi:flask-outline"></ha-icon> ${T('sbxi_title')}</h3>`
        + `<p>${T('sbxi_why')}</p>`
        + `<div class="okbox"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span>${T('sbxi_safe')}</span></div>`
        + `<h4>${T('sbxi_limits_h')}</h4><ol class="sbxl">${li([T('sbxi_l_board'), T('sbxi_l_devices'), T('sbxi_l_calls'), T('sbxi_l_triggers'), T('sbxi_l_ask'), T('sbxi_l_tpl'), T('sbxi_l_nodered'), T('sbxi_l_copy'), T('sbxi_l_time')])}</ol>`
        + `<div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${T('sbxi_bottom')}</span></div>`
        + `<label class="chk"><input type="checkbox" name="sbxskip"${this._data.ui.sbxIntro === false ? ' checked' : ''}>${T('sbxi_skip')}</label>`
        + `<div class="btns">${open ? '' : `<button data-act="modal-cancel">${T('cancel')}</button>`}<button class="primary" data-act="sbx-start">${open ? T('close') : T('sbxi_go')}</button></div></div>`;
      const b = m.querySelector('[data-act="sbx-start"]');
      if (b) b.focus();
    }
    async _openSandbox() {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._clearLit(true);
      this._drawer = { mode: 'sandbox' };
      const d = this._$.drawer;
      d.hidden = false;
      d.innerHTML = `<div class="dhead"><span class="dtitle">${T('sbx_title', { fnName: esc(this._fnName(label) + (this._ver ? ' · ' + this._ver.name : '')) })}</span><span class="sbclock"></span><button data-act="sbx-about" title="${T('sbx_about_t')}"><ha-icon icon="mdi:information-outline"></ha-icon></button><button data-act="sbx-reset" title="${T('sbx_reset_t')}"><ha-icon icon="mdi:restore"></ha-icon></button><button data-act="close" title="${T('sbx_close_t')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dbg sbx"><div class="sbnote">${T('sbx_note')}</div><div class="sbask"></div><div class="sbctl"></div><div class="sbdue"></div><div class="dtl sbtl"><div class="muted pad">${T('reading_configs')}</div></div></div>`;
      this._$.board.classList.add('sbx');
      this._$.sbxpill.hidden = false;
      this._fitLitbar();
      await this._sbxNew(label);
      if (!this._sbxOn()) return;
      this._renderSbxCtl();
      this._renderSbx();
      this._refreshStates();
      this._renderNodebar();
      this._renderLegend();
    }
    async _sbxNew(label) {
      const m = this._model;
      const ids = [...m.nodes.keys()].filter((k) => /^(automation|script)\./.test(k));
      const cfgs = await Promise.all(ids.map((k) => this._fetchConfig(k)));
      const g = { label, asks: [], fn: null, tplN: 0 };
      this._sbx = g;
      const resolve = (ref) => {
        if (ref.startsWith('device:')) return this._ents.filter((e) => e.device_id === ref.slice(7)).map((e) => e.entity_id);
        const t = this._tgt.get(ref);
        return t ? t.entities : [];
      };
      g.eng = new Sandbox({
        states: this._hass.states, items: ids.map((id, i) => ({ id, cfg: cfgs[i] })), now: Date.now(), tz: this._hass.config && this._hass.config.time_zone,
        tpl: (t, v) => this._sbxTpl(t, v), ask: (q) => this._sbxAsk(q), resolve, fetch: (id) => this._fetchConfig(id),
        name: (id) => this._boxName(id), condText: (c) => condText(c, (x) => this._boxName(x)), onLog: () => this._sbxLogged(),
      });
      await g.eng.start();
    }
    _sbxEnd() {
      const g = this._sbx;
      if (!g) return;
      g.ended = true;
      g.asks.forEach((a) => a.res(false));
      g.asks = [];
      g.eng.stopAll();
      this._sbx = null;
      this._$.board.classList.remove('sbx');
      this._$.sbxpill.hidden = true;
      this._clearLit(true);
      this._refreshStates();
      this._renderNodebar();
      this._renderLegend();
    }
    async _sbxReset() {
      if (!this._sbx) return;
      const label = this._sbx.label;
      this._sbx.asks.forEach((a) => a.res(false));
      this._sbx.eng.stopAll();
      this._clearLit(true);
      await this._sbxNew(label);
      this._renderSbxCtl();
      this._renderSbx();
      this._refreshStates();
    }
    // Home Assistant renders the template, pointed at the sandbox's states and clock (sbxRewrite)
    async _sbxTpl(t, vars) {
      const g = this._sbx;
      if (!g) return { ok: false, err: 'closed' };
      if (g.fn == null) g.fn = await this._renderRaw('{%- macro m(returns) -%}{%- do returns(1) -%}{%- endmacro -%}{{ (m | as_function)() }}', {}).then((v) => String(v) === '1', () => false);
      if (!g.fn) return { ok: false, err: T('sbx_needs_newer') };
      const rw = sbxRewrite(t), eng = g.eng, fb_s = {};
      const add = (id) => { const s = eng.get(id); if (s) fb_s[id] = { state: String(s.state), attributes: s.attributes || {}, last_changed: s.last_changed, last_updated: s.last_updated }; };
      eng.changed.forEach((v, id) => add(id));
      for (const x of String(t).matchAll(ENTITY_RE)) add(x[0]);
      let variables = {};
      try { variables = JSON.parse(JSON.stringify(vars || {})); } catch (e) { /* only what can be sent */ }
      Object.assign(variables, { fb_s, fb_t: new Date(eng.now).toISOString() });
      g.tplN++;
      try { return { ok: true, value: await this._renderRaw(SBX_PRELUDE + rw.text, variables), partly: rw.leftovers }; }
      catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
    }
    _renderRaw(template, variables) {
      return new Promise((res, rej) => {
        let done = false, un = null;
        const fin = (f, v) => { if (done) return; done = true; clearTimeout(to); f(v); if (un) un.then((u) => u && u()).catch(() => {}); };
        const to = setTimeout(() => fin(rej, new Error('timeout')), 8000);
        un = this._hass.connection.subscribeMessage((m) => {
          if (m && m.error) { if (m.level !== 'WARNING') fin(rej, new Error(String(m.error))); return; }
          fin(res, m ? m.result : null);
        }, { type: 'render_template', template, variables, strict: false, report_errors: true }).catch((e) => { fin(rej, new Error((e && (e.message || e.code)) || 'error')); return null; });
      });
    }
    // what the sandbox can't know, answered by you
    _sbxAsk(q) {
      const g = this._sbx;
      if (!g) return Promise.resolve(false);
      return new Promise((res) => {
        g.asks.push({ q, res: (v) => { g.asks = g.asks.filter((a) => a.q !== q); res(v); this._renderSbx(); } });
        this._renderSbx();
        if (q.key) this._centerOn(q.key);
      });
    }
    _sbxLogged() {
      this._throttle('sbx', 120, () => { this._renderSbx(); this._refreshStates(); });
    }
    // the entities you can set, the events you can fire, the automations and scripts you can run
    _renderSbxCtl() {
      const g = this._sbx, box = this._$.drawer.querySelector('.sbctl');
      if (!g || !box) return;
      const m = this._model, nm = (k) => this._boxName(k);
      const ents = [...m.nodes.keys()].filter((k) => !k.includes(':') && g.eng.get(k)).sort((a, b) => nm(a).localeCompare(nm(b)));
      const evs = [...m.nodes.keys()].filter((k) => k.startsWith('event:')).map((k) => k.slice(6));
      ['timer.finished', 'timer.cancelled'].forEach((x) => { if (!evs.includes(x) && ents.some((e) => e.startsWith('timer.'))) evs.push(x); });
      const runs = [...g.eng.items.keys()].sort((a, b) => nm(a).localeCompare(nm(b)));
      const topics = new Set([...m.nodes.keys()].filter((k) => k.startsWith('mqtt:')).map((k) => k.slice(5)));
      g.eng.items.forEach((it) => { if (it.kind === 'automation') g.eng._trigs(it).forEach((t) => { if (g.eng._plat(t) === 'mqtt' && t.topic && !/[+#]/.test(t.topic)) topics.add(String(t.topic)); }); });
      const opt = (k) => `<option value="${esc(k)}">${esc(nm(k))}</option>`;
      box.innerHTML = `<div class="sbrow"><span class="sbl">${T('sbx_set')}</span><select class="sbent" aria-label="${T('sbx_entity')}">${ents.map(opt).join('')}</select>${this._sbxField('sbval', [], T('sbx_state'))}<button class="chip" data-act="sbx-set">${T('sbx_set_b')}</button></div>`
        + `<div class="sbrow"><span class="sbl">${T('sbx_event')}</span>${this._sbxField('sbev', evs.map((x) => ({ v: x, l: x })), T('sbx_event_type'))}${this._sbxField('sbevd', [], T('sbx_event_data_ph'))}<button class="chip" data-act="sbx-fire">${T('sbx_fire')}</button></div>`
        + (topics.size ? `<div class="sbrow"><span class="sbl">MQTT</span>${this._sbxField('sbtop', [...topics].map((x) => ({ v: x, l: x })), T('sbx_topic'))}${this._sbxField('sbpay', [], T('sbx_payload'))}<button class="chip" data-act="sbx-mqtt">${T('sbx_send')}</button></div>` : '')
        + `<div class="sbrow"><span class="sbl">${T('sbx_run')}</span><select class="sbrun" aria-label="${T('sbx_run_what')}">${runs.map(opt).join('')}</select><select class="sbtrig" aria-label="${T('sbx_as_if')}"></select><label class="sbcb"><input type="checkbox" class="sbconds" checked>${T('sbx_check_conds')}</label><button class="chip" data-act="sbx-run">${T('sbx_run_b')}</button></div>`
        + `<div class="sbrow"><span class="sbl">${T('sbx_clock')}</span><button class="chip" data-act="sbx-adv" data-ms="60000">+1 min</button><button class="chip" data-act="sbx-adv" data-ms="600000">+10 min</button><button class="chip" data-act="sbx-adv" data-ms="3600000">+1 h</button><button class="chip sbnext" data-act="sbx-next"></button></div>`;
      const pick = this._sel && ents.includes(this._sel) ? this._sel : ents[0];
      if (pick) this._sbxPick(pick);
      this._sbxTrigs();
      this._sbxEvData();
      this._sbxPayloads();
    }
    // a dropdown of what fits, ending with Other… which opens a box to type anything else
    _sbxField(cls, opts, ph) {
      return `<span class="sbf"><select class="sbsel ${cls}-sel" data-f="${cls}" aria-label="${esc(ph)}">${opts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}<option value="${SBX_OTHER}">${T('sbx_other')}</option></select><input class="${cls}" placeholder="${esc(ph)}" aria-label="${esc(ph)}"${opts.length ? ' hidden' : ''}></span>`;
    }
    _sbxOpts(cls, opts, keep) {
      const sel = this._$.drawer.querySelector(`.${cls}-sel`);
      if (!sel) return;
      const was = sel.value;
      sel.innerHTML = opts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('') + `<option value="${SBX_OTHER}">${T('sbx_other')}</option>`;
      // keep: what was picked stays (a refresh); otherwise the suggested one, else the first
      if (keep === true && [...sel.options].some((o) => o.value === was)) sel.value = was;
      else if (opts.length) sel.value = (opts.find((o) => o.pick) || opts[0]).v;
      this._sbxOther(sel);
    }
    // Other… shows the typing box (and focuses it); anything picked from the list hides it
    _sbxOther(sel, focus) {
      const inp = sel.parentNode.querySelector('input');
      if (!inp) return;
      const other = sel.value === SBX_OTHER;
      inp.hidden = !other;
      if (other && focus) inp.focus();
    }
    _sbxVal(cls) {
      const d = this._$.drawer, sel = d.querySelector(`.${cls}-sel`), inp = d.querySelector(`input.${cls}`);
      return sel && sel.value !== SBX_OTHER ? sel.value : inp ? inp.value.trim() : '';
    }
    // the data an event can carry: what the function's own event triggers for that type look for
    _sbxEvData() {
      const g = this._sbx;
      if (!g) return;
      const type = this._sbxVal('sbev'), out = [], seen = new Set();
      g.eng.items.forEach((it) => {
        if (it.kind !== 'automation') return;
        g.eng._trigs(it).forEach((t) => {
          if (g.eng._plat(t) !== 'event' || !toList(t.event_type).includes(type) || !t.event_data || typeof t.event_data !== 'object') return;
          const v = JSON.stringify(t.event_data);
          if (seen.has(v)) return;
          seen.add(v);
          out.push({ v, l: T('sbx_data_as', { name: this._boxName(it.id), data: shorten(Object.entries(t.event_data).map(([a, b]) => `${a}: ${typeof b === 'object' ? JSON.stringify(b) : b}`).join(', '), 60) }), pick: true });
        });
      });
      out.push({ v: '', l: T('sbx_data_none') });
      this._sbxOpts('sbevd', out, 'pick');
    }
    // the payloads the function's MQTT triggers on that topic wait for
    _sbxPayloads() {
      const g = this._sbx;
      if (!g || !this._$.drawer.querySelector('.sbpay-sel')) return;
      const topic = this._sbxVal('sbtop'), out = [], seen = new Set();
      g.eng.items.forEach((it) => {
        if (it.kind !== 'automation') return;
        g.eng._trigs(it).forEach((t) => {
          if (g.eng._plat(t) !== 'mqtt' || t.payload == null || !(t.topic === topic || sbxTopic(String(t.topic || ''), topic))) return;
          const v = String(t.payload);
          if (seen.has(v)) return;
          seen.add(v);
          out.push({ v, l: T('sbx_payload_as', { name: this._boxName(it.id), payload: shorten(v, 50) }), pick: true });
        });
      });
      out.push({ v: '', l: T('sbx_payload_none') });
      this._sbxOpts('sbpay', out, 'pick');
    }
    // the triggers of the automation picked under Run: run it as if one of them fired
    _sbxTrigs() {
      const d = this._$.drawer, run = d.querySelector('.sbrun'), sel = d.querySelector('.sbtrig'), g = this._sbx;
      if (!run || !sel || !g) return;
      const it = g.eng.items.get(run.value), ts = it && it.kind === 'automation' ? g.eng._trigs(it) : [];
      const what = (t) => {
        const p = g.eng._plat(t), spec = g.eng._espec(p);
        const ents = p === 'state' || p === 'numeric_state' ? toList(t.entity_id) : spec ? g.eng._etargets(t, spec) : [];
        const x = ents.length ? ents.map((e) => this._boxName(e)).join(', ') : p === 'event' ? toList(t.event_type).join(', ') : p === 'mqtt' ? t.topic : p === 'time' ? toList(t.at).join(', ') : '';
        return `${p}${x ? ': ' + x : ''}${t.id != null ? ` (id ${t.id})` : ''}`;
      };
      sel.innerHTML = ts.map((t, i) => `<option value="${i}">${esc(T('sbx_as_trigger', { n: i + 1, what: shorten(what(t), 50) }))}</option>`).join('') + `<option value="">${esc(T('sbx_no_trigger'))}</option>`;
      sel.hidden = !ts.length;
    }
    // soft: only bring the suggestions and the "now …" hint up to date, if that entity is still the one picked, and
    // leave what's typed (after a Set settles, the person may already be on the next one)
    _sbxPick(k, soft) {
      const d = this._$.drawer, sel = d.querySelector('.sbent'), val = d.querySelector('input.sbval');
      if (!sel || !this._sbx) return;
      if (soft && sel.value !== k) return;
      sel.value = k;
      const n = this._model.nodes.get(k), s = this._sbx.eng.get(k), now = s ? String(s.state) : null;
      const hints = new Set(n ? this._stateHints(n) : []);
      if (now != null) hints.add(now);
      // a sandbox is where you'd try what a missing or failing device does
      ['unavailable', 'unknown'].forEach((x) => hints.add(x));
      const opts = [...hints].map((x) => ({ v: x, l: x === now ? T('sbx_state_now', { state: x }) : x }));
      // the first state it isn't in already, so Set does something
      const first = opts.find((o) => o.v !== now && o.v !== 'unavailable' && o.v !== 'unknown');
      if (first) first.pick = true;
      this._sbxOpts('sbval', opts, soft ? true : 'pick');
      if (val) { if (!soft) val.value = ''; val.placeholder = now != null ? T('sbx_now_is', { state: now }) : T('sbx_state'); }
    }
    async _sbxDo(fn) {
      const g = this._sbx;
      if (!g || g.busy) return;
      g.busy = true;
      this._renderSbx();
      const from = g.eng.seq;
      try { await fn(g.eng); } finally { g.busy = false; }
      if (this._sbx !== g) return;
      // everything one thing you did set off is one flow, played on the board step by step
      const act = { a: from + 1, b: g.eng.seq };
      if (act.b >= act.a) (g.acts = g.acts || []).push(act);
      this._renderSbx();
      this._refreshStates();
      if (act.b >= act.a) this._sbxLight(act.a, true);
    }
    // the box bar's sandbox buttons fill in the drawer's controls; the rest are the drawer's own
    _sbxBox(act, el) {
      const d = this._$.drawer, k = this._sel;
      if (act === 'sbx-setbox' && k) { this._sbxPick(k); const v = d.querySelector('.sbval-sel'); if (v) v.focus(); return; }
      if (act === 'sbx-runbox' && k) { const r = d.querySelector('.sbrun'); if (r) r.value = k; this._sbxAction('sbx-run', el); return; }
      if (act === 'sbx-firebox' && k) {
        const sel = d.querySelector('.sbev-sel'), inp = d.querySelector('input.sbev'), type = k.slice(6);
        if (sel) { if ([...sel.options].some((o) => o.value === type)) sel.value = type; else { sel.value = SBX_OTHER; if (inp) inp.value = type; } this._sbxOther(sel); this._sbxEvData(); const n = d.querySelector('.sbevd-sel'); if (n) n.focus(); }
        return;
      }
      this._sbxAction(act, el);
    }
    _sbxAction(act, el) {
      const d = this._$.drawer, q = (s) => d.querySelector(s);
      switch (act) {
        case 'sbx-set': {
          const id = q('.sbent').value, v = this._sbxVal('sbval');
          if (!id || !v) { this._toast(T('sbx_pick_state')); return; }
          if (q('input.sbval')) q('input.sbval').value = '';
          this._sbxDo((e) => e.userSet(id, v)).then(() => this._sbxPick(id, true));
          break;
        }
        case 'sbx-fire': {
          const type = this._sbxVal('sbev'), raw = this._sbxVal('sbevd');
          if (!type) { this._toast(T('sbx_pick_event')); return; }
          let data = {};
          if (raw) { try { data = JSON.parse(raw); } catch (e) { const p = parseLoose(raw); if (p && typeof p === 'object') data = p; else { this._toast(T('sbx_bad_data')); return; } } }
          this._sbxDo((e) => e.userEvent(type, data));
          break;
        }
        case 'sbx-run': {
          const id = q('.sbrun').value, tv = q('.sbtrig') && !q('.sbtrig').hidden ? q('.sbtrig').value : '';
          if (id) this._sbxDo((e) => e.userRun(id, q('.sbconds').checked, tv === '' ? null : +tv));
          break;
        }
        case 'sbx-mqtt': {
          const topic = this._sbxVal('sbtop');
          if (!topic) { this._toast(T('sbx_pick_topic')); return; }
          this._sbxDo((e) => e.userMqtt(topic, this._sbxVal('sbpay')));
          break;
        }
        case 'sbx-adv': this._sbxDo((e) => e.advance(+el.dataset.ms)); break;
        case 'sbx-next': this._sbxDo((e) => e.toNext()); break;
        case 'sbx-reset': this._sbxReset(); break;
        case 'sbx-ans': { const a = this._sbx && this._sbx.asks[+el.dataset.i]; if (!a) return; if (a.q.value) { const inp = d.querySelector(`.sbav[data-i="${el.dataset.i}"]`); a.res(parseLoose(inp ? inp.value : '')); } else a.res(el.dataset.v === '1'); break; }
        case 'sbx-pick': this._sbxLight(+el.dataset.id); break;
        default: break;
      }
    }
    // ---- the flow view: what one thing you did set off, step by step on the board. Each step lights its arrow (or
    // its box), gets a number, and a dot runs along it; what isn't on the board gets a temporary dashed box
    _sbxLight(id, auto) {
      const g = this._sbx;
      if (!g) return;
      g.sel = id;
      const act = (g.acts || []).find((x) => id >= x.a && id <= x.b);
      const f = act && (this._flow && this._flow.act === act ? this._flow : this._flowBuild(act));
      if (!f || !f.steps.length) { if (!auto) this._renderSbx(); return; }
      const fresh = f !== this._flow;
      clearTimeout(this._timers.lit);
      this._flow = f;
      this._sel = null;
      // the whole run in view if it reads at that size; otherwise the view follows the steps as they play
      if (fresh) { const all = this._flowRects(f, f.steps.map((x, i) => i)); if (all && this._fitK(all) >= 0.6) this._frameKeys(f.keys, [...f.ghosts.values()]); }
      this._renderSbx();
      if (auto) { this._flowPlay(); return; }
      let i = f.steps.findIndex((x) => x.e.id === id);
      if (i < 0) i = Math.max(0, f.steps.filter((x) => x.e.id < id).length - 1);
      this._flowGo(i, true);
    }
    _flowBuild(act) {
      const g = this._sbx, m = this._model, eng = g.eng, vis = this._visibleKeys(), E = this._visEdges();
      const by = new Map(eng.log.map((e) => [e.id, e])), es = eng.log.filter((e) => e.id >= act.a && e.id <= act.b && e.kind !== 'note');
      // a board box for a key: itself, the MQTT box a topic is under (zigbee2mqtt/lamp for zigbee2mqtt/lamp/set), or a
      // temporary one
      const res = (k) => {
        if (!k) return null;
        if (vis.has(k)) return k;
        if (k.startsWith('mqtt:')) {
          const t = k.slice(5);
          for (const n of vis) if (n.startsWith('mqtt:')) { const b = n.slice(5); if (b === t || t.startsWith(b + '/') || sbxTopic(b, t)) return n; }
        }
        return '~' + k;
      };
      const edgeFor = (a, b, role) => {
        const c = E.filter((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
        return c.find((x) => x.role === role && x.from === a) || c.find((x) => x.from === a) || c[0] || null;
      };
      // a call's MQTT messages and events are drawn as its arrows
      const kids = new Map();
      es.forEach((e) => { const c = by.get(e.cause); if ((e.kind === 'mqtt' || e.kind === 'event') && c && c.kind === 'call') { if (!kids.has(c.id)) kids.set(c.id, []); kids.get(c.id).push(e.key); } });
      const ghosts = new Map(), keys = new Set(), steps = [];
      const ghost = (gk, anchor, before) => {
        if (gk[0] !== '~' || ghosts.has(gk)) return;
        const k = gk.slice(1), p = k.indexOf(':'), pre = p > 0 && !k.slice(0, p).includes('.') ? k.slice(0, p) : '';
        const name = pre === 'mqtt' || pre === 'event' || pre === 'svc' ? k.slice(p + 1) : pre === 'device' ? T('sbx_g_device') : this._boxName(k);
        const kind = pre === 'mqtt' ? T('sbx_g_mqtt') : pre === 'event' ? T('sbx_g_event') : pre === 'svc' ? T('sbx_g_svc') : T('sbx_g_out');
        const icon = pre === 'mqtt' ? 'mdi:access-point' : pre === 'event' ? 'mdi:lightning-bolt-outline' : pre === 'svc' ? (k.startsWith('svc:notify.') ? 'mdi:bell-outline' : 'mdi:cog-outline') : pre === 'device' ? 'mdi:devices' : 'mdi:shape-outline';
        ghosts.set(gk, { key: gk, k, name, kind, icon, title: T('sbx_g_title', { k }), anchor: anchor && anchor[0] !== '~' ? anchor : null, before, w: Math.round(Math.max(140, Math.min(260, 58 + Math.max(name.length * 7.4, kind.length * 6)))), h: 46 });
      };
      es.forEach((e) => {
        const c = by.get(e.cause), links = [];
        let box = null, from = [], to = [];
        if (e.kind === 'trigger') { const src = e.src || (c && ['state', 'event', 'mqtt'].includes(c.kind) ? c.key : e.ent); if (src) from = [src]; else box = e.key; to = [e.key]; }
        else if (e.kind === 'cond') { from = e.ents || []; to = [e.key]; if (!from.length) box = e.key; }
        else if (e.kind === 'call') {
          to = [...new Set((e.ents || []).concat(kids.get(e.id) || []))];
          if (!to.length && SVC_RE.test(e.svc || '')) to = ['svc:' + e.svc];
          if (e.key) from = [e.key]; else { box = to[0] || null; to = []; }
          if (!to.length) box = e.key;
        } else box = e.key;
        const role = { trigger: 'trigger', cond: 'condition', call: 'call' }[e.kind];
        from.forEach((x) => to.forEach((y) => {
          const a = res(x), b = res(y);
          if (!a || !b || a === b) return;
          const ed = a[0] !== '~' && b[0] !== '~' ? edgeFor(a, b, role) : null;
          links.push({ a, b, edge: ed ? ed.id : null, rev: !!ed && ed.from !== a });
          ghost(a, b, true); ghost(b, a, false);
          [a, b].forEach((k) => { if (k[0] !== '~') keys.add(k); });
        }));
        if (box) { box = res(box); ghost(box, links.length ? links[0].a : null, false); if (box[0] !== '~') keys.add(box); }
        if (!links.length && !box) return;
        steps.push({ e, links, box: links.length ? null : box });
      });
      const f = { act, steps, ghosts, keys: [...keys], at: -1, cond: new Map(), reached: new Set() };
      this._flowPlace(f);
      return f;
    }
    // temporary boxes go next to what they touch: sources before it, the rest after, clear of the board's boxes, at the
    // nearest spot whose arrow runs through the fewest of them
    _flowPlace(f) {
      const m = this._model, V = this._vert(), M = 14;
      const rects = [...this._visibleKeys()].map((k) => m.nodes.get(k)).filter(Boolean).map((n) => ({ k: n.key, x: n.x, y: n.y, w: n.w, h: n.h }));
      const hit = (r) => rects.some((o) => r.x < o.x + o.w + M && o.x < r.x + r.w + M && r.y < o.y + o.h + M && o.y < r.y + r.h + M);
      const first = f.keys.length ? m.nodes.get(f.keys[0]) : null;
      f.ghosts.forEach((g) => {
        const n = (g.anchor && m.nodes.get(g.anchor)) || first || { key: null, x: 0, y: 0, w: 0, h: 0 };
        const others = rects.filter((o) => o.k !== n.key);
        let best = null;
        // across the flow (beside it, then a step further out) and along it, above and below
        for (const gap of [64, 200]) for (const before of [true, false]) for (let i = 0; i < 13; i++) {
          const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (V ? g.w + 16 : g.h + 14);
          const r = V ? { x: n.x + (n.w - g.w) / 2 + off, y: before ? n.y - gap - g.h : n.y + n.h + gap, w: g.w, h: g.h }
            : { x: before ? n.x - gap - g.w : n.x + n.w + gap, y: n.y + (n.h - g.h) / 2 + off, w: g.w, h: g.h };
          if (hit(r)) continue;
          const p = g.before ? flowPath(r, n, V) : flowPath(n, r, V);
          const score = Math.hypot(r.x + r.w / 2 - n.x - n.w / 2, r.y + r.h / 2 - n.y - n.h / 2) + 600 * flowCrossings(p.segs, others) + (before !== g.before ? 160 : 0);
          if (!best || score < best.score) best = { r, score };
        }
        const r = best ? best.r : V ? { x: n.x, y: n.y + n.h + 64, w: g.w, h: g.h } : { x: n.x + n.w + 64, y: n.y, w: g.w, h: g.h };
        Object.assign(g, { x: Math.round(r.x), y: Math.round(r.y) });
        rects.push({ k: g.key, x: g.x, y: g.y, w: g.w, h: g.h });
      });
    }
    _flowPlay() {
      const f = this._flow;
      if (!f) return;
      clearTimeout(this._timers.lit);
      let i = 0;
      const tick = () => {
        if (this._flow !== f) return;
        this._flowGo(i, true);
        // a long flow plays a little faster: ten seconds or so in all
        if (++i < f.steps.length) this._timers.lit = setTimeout(tick, Math.max(450, Math.min(850, 10000 / f.steps.length)));
      };
      tick();
    }
    _flowGo(i, anim) {
      const f = this._flow;
      if (!f || !f.steps.length) return;
      f.at = Math.max(0, Math.min(f.steps.length - 1, i));
      f.anim = !!anim;
      const keys = new Set(), edges = new Set();
      f.cond = new Map(); f.reached = new Set();
      f.steps.slice(0, f.at + 1).forEach((s) => {
        const touch = (k) => { if (!k) return; if (k[0] === '~') f.reached.add(k); else keys.add(k); };
        touch(s.box);
        s.links.forEach((l) => {
          touch(l.a); touch(l.b);
          if (l.edge) edges.add(l.edge);
          if (s.e.kind === 'cond') f.cond.set(l.edge || l.a + '>' + l.b, { ok: s.e.ok, title: T('sbx_cond_mark', { text: s.e.text, res: s.e.ok ? T('sbx_true') : T('sbx_false') }) + (s.e.why ? '\n' + s.e.why : '') });
        });
      });
      const cur = f.steps[f.at];
      f.now = cur.box || cur.links[cur.links.length - 1].b;
      this._lit = { keys, edges, now: f.now[0] === '~' ? null : f.now };
      if (this._sbx) this._sbx.sel = cur.e.id;
      this._applyFocus();
      this._flowBar();
      this._flowFollow(f, f.at);
      this._flowRows();
      if (anim) {
        const el = f.now[0] === '~' ? this._$.flow.querySelector(`.ghost[data-g="${CSS.escape(f.now)}"]`) : this._els.get(f.now);
        if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
      }
    }
    // a step in words, by name: who called what, who waits
    _flowText(e) {
      const nm = (k) => this._boxName(k), t = this._sbxText(e).main;
      if (e.kind === 'call' && e.key) {
        const to = (e.ents || []).map(nm).join(', ');
        if (/^script\./.test(e.svc || '') || ((e.svc || '').startsWith('script.turn_on') && to)) return T('sbx_f_runs', { a: nm(e.key), b: to || nm(e.svc) });
        return T('sbx_f_calls', { a: nm(e.key), svc: e.svc, to: to ? ' → ' + to : '' });
      }
      if (e.kind === 'wait' && e.key) return T('sbx_f_waits', { a: nm(e.key), w: String(e.text || '').replace(/^./, (c) => c.toLowerCase()) });
      if (e.kind === 'cond' && e.key) return T('sbx_f_checks', { a: nm(e.key), c: t });
      return t;
    }
    // the boxes of some steps, as one rectangle on the board
    _flowRects(f, idx) {
      const m = this._model, rs = [];
      idx.forEach((i) => { const s = f.steps[i]; [s.box, ...s.links.flatMap((l) => [l.a, l.b])].forEach((k) => { const r = k && (k[0] === '~' ? f.ghosts.get(k) : m.nodes.get(k)); if (r) rs.push(r); }); });
      if (!rs.length) return null;
      const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
      return { x0, y0, x1: Math.max(...rs.map((r) => r.x + r.w)), y1: Math.max(...rs.map((r) => r.y + r.h)) };
    }
    // the part of the board left free by the drawer and the bar along its foot, and the zoom a rectangle fits at
    _flowArea() { return { W: this._openWidth(), H: this._$.vp.clientHeight - (this._$.litbar.hidden ? 20 : this._$.litbar.offsetHeight + 30), pad: 50 }; }
    _fitK(R) { const a = this._flowArea(); return Math.min((a.W - 2 * a.pad) / Math.max(1, R.x1 - R.x0), (a.H - 2 * a.pad) / Math.max(1, R.y1 - R.y0)); }
    // a step out of view: glide to it, at the same zoom unless it doesn't fit
    _flowFollow(f, i) {
      let R = this._flowRects(f, [i]);
      if (!R) return;
      // a step too long to fit even zoomed out: the box it reaches
      if (this._fitK(R) < 0.35 && f.now) { const n = f.now[0] === '~' ? f.ghosts.get(f.now) : this._model.nodes.get(f.now); if (n) R = { x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h }; }
      const a = this._flowArea(), v = this._view;
      if (R.x0 * v.k + v.x >= a.pad / 2 && R.y0 * v.k + v.y >= a.pad / 2 && R.x1 * v.k + v.x <= a.W - a.pad / 2 && R.y1 * v.k + v.y <= a.H - a.pad / 2) return;
      const k = Math.max(0.35, Math.min(v.k, this._fitK(R)));
      const to = { k, x: a.W / 2 - ((R.x0 + R.x1) / 2) * k, y: a.H / 2 - ((R.y0 + R.y1) / 2) * k }, from = { ...v }, t0 = performance.now(), ms = 380;
      cancelAnimationFrame(this._followRaf);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this._view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        this._applyView();
        if (t < 1) this._followRaf = requestAnimationFrame(step); else this._saveView();
      };
      this._followRaf = requestAnimationFrame(step);
    }
    _flowBar() {
      const f = this._flow, b = this._$.litbar;
      if (!f) return;
      const cur = f.steps[f.at], ct = { main: this._flowText(cur.e), sub: this._sbxText(cur.e).sub };
      const chips = f.steps.map((s, i) => { const t = this._flowText(s.e); return `<button class="lstep fstep ${i <= f.at ? 'on' : ''} ${i === f.at ? 'cur' : ''}" data-act="flow-go" data-i="${i}" title="${esc(t)}"><i class="fsn">${i + 1}</i>${esc(shorten(t, 34))}</button>`; }).join('<span class="larr">→</span>');
      b.classList.add('flowbar');
      b.innerHTML = `<div class="fhead"><button data-act="flow-prev" title="${T('sbx_step_prev')}" ${f.at <= 0 ? 'disabled' : ''}><ha-icon icon="mdi:chevron-left"></ha-icon></button><button data-act="flow-next" title="${T('sbx_step_next')}" ${f.at >= f.steps.length - 1 ? 'disabled' : ''}><ha-icon icon="mdi:chevron-right"></ha-icon></button><span class="fpos">${esc(T('sbx_flow_n', { n: f.at + 1, total: f.steps.length }))}</span><span class="fcur" title="${esc(ct.main + (ct.sub ? '\n' + ct.sub : ''))}">${esc(ct.main)}</span><button data-act="flow-play">${T('replay')}</button><button data-act="lit-clear">${T('clear')}</button></div><div class="fsteps">${chips}</div>`;
      b.hidden = false;
      this._litSteps = null; this._litRun = null;
      this._fitLitbar();
      const c = b.querySelector('.fstep.cur'), row = b.querySelector('.fsteps');
      if (c && row) { const l = c.offsetLeft - row.offsetLeft; if (l < row.scrollLeft || l + c.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = Math.max(0, l - row.clientWidth / 3); }
    }
    // the timeline in the drawer follows: the current step's row, and the flow's rows numbered
    _flowRows() {
      const f = this._flow, box = this._$.drawer.querySelector('.sbtl');
      if (!f || !box) return;
      const cur = f.steps[f.at] && f.steps[f.at].e.id;
      box.querySelectorAll('.dbrow').forEach((r) => {
        const on = +r.dataset.id === cur;
        r.classList.toggle('on', on);
        if (on) { const top = r.offsetTop - box.offsetTop; if (top < box.scrollTop || top + r.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3); }
      });
    }
    // the parts of the flow drawn over the board: temporary boxes and their arrows, step numbers, and what's waiting
    _paintFlow() {
      const box = this._$.flow, svg = this._$.flowx, g = this._sbx, f = this._flow, m = this._model;
      if (!box || !svg) return;
      if (!g || !m || !this._sbxOn()) { box.innerHTML = ''; svg.innerHTML = ''; return; }
      const rect = (k) => (k && k[0] === '~' ? f && f.ghosts.get(k) : m.nodes.get(k));
      const html = [], arr = [], spots = new Map();
      const spot = (x, y, i, cur) => {
        const id = Math.round(x / 4) + ',' + Math.round(y / 4), s = spots.get(id) || { x, y, ns: [], cur: false };
        s.ns.push(i); s.cur = s.cur || cur; spots.set(id, s);
      };
      const mark = (ok, x, y, title) => `<g class="cres ${ok === true ? 'ok' : ok === false ? 'bad' : 'unk'}" transform="translate(${x},${y})"><circle r="8"></circle>${ok === true ? '<path d="M-3.6,0.2 L-1.1,2.8 L3.8,-2.6"></path>' : ok === false ? '<path d="M-3,-3 L3,3 M3,-3 L-3,3"></path>' : '<text y="3.6" text-anchor="middle">?</text>'}<title>${esc(title)}</title></g>`;
      if (f && f.at >= 0) {
        f.ghosts.forEach((gh) => html.push(`<div class="ghost${f.reached.has(gh.key) ? '' : ' far'}${f.now === gh.key ? ' now' : ''}" data-act="flow-ghost" data-g="${esc(gh.key)}" style="left:${gh.x}px;top:${gh.y}px;width:${gh.w}px;height:${gh.h}px" title="${esc(gh.title)}"><ha-icon icon="${gh.icon}"></ha-icon><span class="gt"><b>${esc(gh.name)}</b><small>${esc(gh.kind)}</small></span></div>`));
        f.steps.slice(0, f.at + 1).forEach((s, i) => {
          const cur = i === f.at;
          s.links.forEach((l, j) => {
            let mid = l.edge && this._edgeMid ? this._edgeMid.get(l.edge) : null;
            if (!l.edge) {
              const A = rect(l.a), B = rect(l.b);
              if (!A || !B) return;
              const p = flowPath(A, B, this._vert());
              arr.push(`<path class="fx${cur ? ' cur' : ''}${s.e.kind === 'cond' ? ' cond' : ''}" d="${p.d}" marker-end="url(#fb-amber)"></path>`);
              if (cur && f.anim && j === 0) arr.push(`<circle class="fdot" r="5.5"><animateMotion begin="indefinite" dur="0.65s" fill="freeze" path="${p.d}"></animateMotion></circle>`);
              const c = s.e.kind === 'cond' && f.cond.get(l.a + '>' + l.b);
              if (c) arr.push(mark(c.ok, p.mid[0], p.mid[1], c.title));
              mid = p.mid;
            }
            if (mid && j === 0) spot(mid[0] + 15, mid[1] + 15, i + 1, cur);
          });
          if (!s.links.length && s.box) { const R = rect(s.box); if (R) spot(R.x, R.y, i + 1, cur); }
        });
      }
      // what's waiting in the sandbox, and for how long on its clock
      const due = new Map();
      g.eng.pending().forEach((p) => { if (p.key && !due.has(p.key) && m.nodes.has(p.key)) due.set(p.key, p); });
      due.forEach((p, k) => { const R = m.nodes.get(k); html.push(`<div class="fwait" style="left:${R.x + R.w - 6}px;top:${R.y}px" title="${esc(p.label)}"><ha-icon icon="mdi:timer-sand"></ha-icon>${esc(fmtDur(Math.max(0, p.at - g.eng.now)))}</div>`); });
      spots.forEach((s) => html.push(`<div class="fnum${s.cur ? ' cur' : ''}" data-act="flow-go" data-i="${s.ns[0] - 1}" style="left:${s.x}px;top:${s.y}px">${s.ns.length > 3 ? `${s.ns[0]} ${s.ns[1]} … ${s.ns[s.ns.length - 1]}` : s.ns.join(' ')}</div>`));
      box.innerHTML = html.join('');
      svg.innerHTML = arr.join('');
      if (f && f.anim) svg.querySelectorAll('animateMotion').forEach((x) => { try { x.beginElement(); } catch (er) { /* no SMIL */ } });
    }
    _sbxText(e) {
      const nm = (k) => (k ? this._boxName(k) : ''), g = this._sbx, by = (x) => g && g.eng.log.find((y) => y.id === x);
      switch (e.kind) {
        case 'state': return { main: `${nm(e.key)} → ${this._fmtState(e.key, e.to)}`, sub: [e.from != null ? T('sbx_was', { s: this._fmtState(e.key, e.from) }) : '', e.by === 'you' ? T('sbx_by_you') : (by(e.cause) && by(e.cause).kind === 'call' ? T('sbx_by', { name: nm(by(e.cause).key) }) : '')].filter(Boolean).join(' · ') };
        case 'event': return { main: T('sbx_event_x', { type: e.text }), sub: e.by === 'you' ? T('sbx_by_you') : (by(e.cause) && by(e.cause).key ? T('sbx_by', { name: nm(by(e.cause).key) }) : '') };
        case 'trigger': return { main: T('sbx_triggered', { name: nm(e.key) }), sub: e.ent ? `${nm(e.ent)} → ${this._fmtState(e.ent, e.to)}` : e.text, cls: 'blue' };
        case 'cond': return { main: `${e.text}: ${e.ok ? T('sbx_true') : T('sbx_false')}`, sub: e.why || '', cls: e.ok ? '' : 'red' };
        case 'call': return { main: `${e.svc}${e.ents && e.ents.length ? ' → ' + e.ents.map(nm).join(', ') : ''}`, sub: e.msg ? T('sbx_msg') : e.unknown ? T('sbx_unknown') : nm(e.key), cls: e.unknown && !e.msg ? 'amber' : '' };
        case 'mqtt': return { main: `MQTT ${e.text}${e.payload ? ': ' + shorten(e.payload, 60) : ''}`, sub: e.by === 'you' ? T('sbx_by_you') : (by(e.cause) && by(e.cause).key ? T('sbx_by', { name: nm(by(e.cause).key) }) : '') };
        case 'run': return { main: `${nm(e.key)} · ${({ stopped: T('sbx_out_stopped'), cancelled: T('sbx_out_cancelled'), error: T('sbx_out_error') })[e.outcome] || T('sbx_out_finished')}`, sub: e.why || '', cls: e.outcome === 'error' ? 'red' : e.outcome === 'finished' ? '' : 'muted' };
        case 'ask': return { main: e.text, sub: e.answer === undefined ? T('sbx_waiting_you') : T('sbx_you_said', { a: typeof e.answer === 'boolean' ? (e.answer ? T('sbx_true') : T('sbx_false')) : JSON.stringify(e.answer) }), cls: 'amber' };
        default: return { main: e.text || '', sub: '', cls: e.warn ? 'amber' : '' };
      }
    }
    _renderSbxSoon() { this._throttle('sbxr', 120, () => this._renderSbx()); }
    _renderSbx() {
      const g = this._sbx, d = this._$.drawer;
      if (!g || !this._sbxOn()) return;
      const eng = g.eng, box = d.querySelector('.sbtl');
      const ck = d.querySelector('.sbclock');
      if (ck) {
        const p = tzParts(eng.now, eng.tz);
        let w = WD[p.wd];
        try { w = new Intl.DateTimeFormat(this._hass.language || undefined, { weekday: 'short', timeZone: eng.tz || undefined }).format(new Date(eng.now)); } catch (e) { /* the short English name */ }
        ck.textContent = `${w} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`;
      }
      const nx = d.querySelector('.sbnext'), due = eng.pending();
      if (nx) {
        nx.disabled = !due.length || g.busy;
        nx.textContent = due.length ? T('sbx_next', { label: due[0].label, d: fmtDur(due[0].at - eng.now) }) : T('sbx_nothing_due');
      }
      d.querySelectorAll('.sbctl button').forEach((b) => { if (b !== nx) b.disabled = !!g.busy; });
      const dueBox = d.querySelector('.sbdue');
      if (dueBox) dueBox.innerHTML = due.length > 1 ? `<span class="muted">${T('sbx_due')}</span> ` + due.slice(0, 6).map((x) => `<span class="sbd">${esc(x.label)} · ${esc(fmtDur(x.at - eng.now))}</span>`).join('') : '';
      const ask = d.querySelector('.sbask');
      if (ask) ask.innerHTML = g.asks.map((a, i) => `<div class="sbq"><ha-icon icon="mdi:account-question-outline"></ha-icon><span>${esc(a.q.text)}</span>${a.q.value
        ? `<input class="sbav" data-i="${i}" aria-label="${T('sbx_value')}"><button class="chip" data-act="sbx-ans" data-i="${i}">${T('sbx_use')}</button>`
        : `<button class="chip" data-act="sbx-ans" data-i="${i}" data-v="1">${T('sbx_true')}</button><button class="chip" data-act="sbx-ans" data-i="${i}" data-v="0">${T('sbx_false')}</button>`}</div>`).join('');
      if (!box) return;
      const icon = { mqtt: 'mdi:access-point', state: 'mdi:swap-horizontal', event: 'mdi:lightning-bolt-outline', trigger: 'mdi:play-circle-outline', cond: 'mdi:help-rhombus-outline', call: 'mdi:arrow-right-bold-outline', run: 'mdi:flag-checkered', wait: 'mdi:timer-sand', note: 'mdi:information-outline', ask: 'mdi:account-question-outline' };
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
      const fl = this._flow, fnum = new Map(fl ? fl.steps.map((s, i) => [s.e.id, i + 1]) : []);
      box.innerHTML = eng.log.length ? eng.log.map((e) => {
        const t = this._sbxText(e), p = tzParts(e.t, eng.tz), tm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`;
        const ic = e.kind === 'cond' ? (e.ok ? 'mdi:check-circle-outline' : 'mdi:close-circle-outline') : e.msg ? 'mdi:message-text-outline' : icon[e.kind] || 'mdi:circle-small';
        const partly = e.partly && e.partly.length ? `<span class="sbpart">${T('sbx_partly', { what: e.partly.map((x) => ({ states: T('sbx_reads_states'), closest: T('sbx_reads_places'), distance: T('sbx_reads_places'), state_translated: T('sbx_reads_translated') })[x] || T('sbx_reads_other')).join(', ') })}</span>` : '';
        const fn = fnum.get(e.id), inf = fl && e.id >= fl.act.a && e.id <= fl.act.b;
        return `<button class="dbrow k-${e.kind} ${t.cls || ''} ${g.sel === e.id ? 'on' : ''}${inf ? ' fin' : ''}" data-act="sbx-pick" data-id="${e.id}"><span class="rt">${fn ? `<i class="fsn">${fn}</i>` : ''}${tm}</span><ha-icon icon="${ic}"></ha-icon><span class="dm"><b>${esc(t.main)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}${partly}</span></button>`;
      }).join('') : `<div class="muted pad">${T('sbx_empty')}</div>`;
      if (atEnd || !g.scrolled) { box.scrollTop = box.scrollHeight; g.scrolled = true; }
      this._paintFlow();
    }
    // a test in the sandbox: done on its states instead of your home's
    async _sbxTest(t) {
      const id = t.target, run = (fn) => this._sbxDo(fn);
      switch (t.kind) {
        case 'state': await run((e) => e.userSet(id, t.state)); return true;
        case 'event': await run((e) => e.userEvent(t.event_type, t.event_data || {})); return true;
        case 'run': await run((e) => e.userRun(id, !t.skip_condition)); return true;
        case 'action': await run((e) => e.userCall(t.service, t.data || {}, [id])); return true;
        case 'notify': await run((e) => e.userCall(t.service, t.data || {}, id.includes(':') ? [] : [id])); return true;
        case 'mqtt': await run((e) => e.userMqtt(t.topic, t.payload)); return true;
        default: this._toast(T('sbx_no_test')); return false;
      }
    }
    // "why did or didn't it run?": the selected automation's recent attempts, from its traces
    async _renderWhy() {
      const d = this._$.drawer, box = d && d.querySelector('.dwhy');
      if (!box || !this._drawer || this._drawer.mode !== 'debug') return;
      const k = this._sel, n = k && this._model && this._model.nodes.get(k);
      const id = n && n.domain === 'automation' && n.kind !== 'tool' ? this._itemId(n) : null;
      if (!id) { box.hidden = true; return; }
      box.hidden = false;
      const tok = this._whyTok = (this._whyTok || 0) + 1;
      box.innerHTML = `<div class="wh"><b>${esc(n.name)}</b>${T('why_did_or_didn_t')}</div><div class="muted small">${T('reading_its_traces')}</div>`;
      const list = await this._ws({ type: 'trace/list', domain: 'automation', item_id: id }).catch(() => []);
      if (tok !== this._whyTok) return;
      const recent = (list || []).slice().sort((a, b) => Date.parse(b.timestamp.start) - Date.parse(a.timestamp.start)).slice(0, 5);
      const rows = await Promise.all(recent.map(async (r) => {
        if (!(r.not_triggered || r.script_execution === 'failed_conditions' || r.error || r.script_execution === 'error')) return { r, why: '' };
        const tr = await this._ws({ type: 'trace/get', domain: 'automation', item_id: id, run_id: r.run_id }).catch(() => null);
        return { r, why: tr ? whyStopped(tr, (x) => this._nameOf(x)) : '' };
      }));
      if (tok !== this._whyTok) return;
      const st = this._hass.states[k];
      box.innerHTML = `<div class="wh"><b>${esc(n.name)}</b>${T('why_did_or_didn_t')}</div>${st && st.state === 'off' ? `<div class="wwarn">${T('it_is_turned_off_nothing')}</div>` : ''}${this._tw.has(k) ? `<div class="muted small">${T('watching_its_triggers_so_far', { hits: P('n_would_be_runs', this._tw.get(k).hits) })}</div>` : ''}${rows.length ? rows.map(({ r, why }) => {
          const o = r.not_triggered ? { text: T('didn_t_fire'), cls: 'muted' } : OUTCOME(r);
          return `<button class="wrow ${o.cls}" data-act="why-run" data-rid="${esc(r.run_id)}" data-item="${esc(id)}" data-key="${esc(k)}"><span class="rt">${esc(clock(r.timestamp && r.timestamp.start))}</span>`
            + `<span class="dm"><b>${esc(o.text)}</b><span>${esc((r.trigger ? T('triggered_by', { trigger: r.trigger }) : '') + (why ? ' · ' + why : ''))}</span></span></button>`;
        }).join('') : `<div class="muted small">${T('no_attempts_stored_home_assistant')}</div>`}`;
    }
    async _dbgPick(id) {
      const g = this._dbg, e = g && g.byId.get(id);
      if (!e) return;
      this._dbgSel = id;
      this._renderDbg();
      const steps = this._dbgChain(e);
      if (e.kind === 'run') await this._showRun(e, steps);
      else this._lightSteps(steps);
    }
    // what led to a step, as far back as the timeline goes: a change was made by a run, a run was set off by a change
    _dbgChain(e0) {
      const g = this._dbg, steps = [e0], seen = new Set([e0.id]);
      if (!g) return steps;
      const last = (pred, before, within) => {
        for (let i = g.entries.length - 1; i >= 0; i--) {
          const x = g.entries[i];
          if (x === before || seen.has(x.id) || x.kind === 'note' || x.t > before.t + 150) continue;
          if (before.t - x.t > (within || 600000)) break;
          if (pred(x)) return x;
        }
        return null;
      };
      let cur = e0;
      for (let n = 0; n < 12 && cur; n++) {
        let prev = null;
        if (cur.by && (cur.by.kind === 'auto' || cur.by.kind === 'script') && cur.by.key && cur.by.key !== cur.key) prev = last((x) => x.kind === 'run' && x.key === cur.by.key, cur);
        if (!prev && cur.kind === 'run') { const src = srcKey(cur.src); if (src) prev = last((x) => (x.kind === 'state' || x.kind === 'test' || x.kind === 'call') && x.key === src, cur, 60000); }
        if (!prev && cur.kind === 'state' && cur.by && cur.by.kind === 'user') prev = last((x) => (x.kind === 'test' || x.kind === 'call') && (x.key === cur.key || (x.ents || []).includes(cur.key)), cur, 5000);
        if (!prev) break;
        steps.unshift(prev); seen.add(prev.id); cur = prev;
      }
      return steps;
    }
    // a run on the board (4.5): its trigger arrow and the arrows to what it actually called, with its trace a click away
    async _showRun(e, steps) {
      const r = e.run;
      let tr = null;
      try { tr = await this._ws({ type: 'trace/get', domain: r.domain, item_id: r.item_id, run_id: r.run_id }); }
      catch (err) { this._toast(T('could_not_read_its_trace', { err: (err && (err.message || err.code)) || err })); }
      if (!this._model) return;
      const path = tr ? runPath(e.key, tr, this._model.edges) : { keys: [e.key], edges: [] };
      let chain = steps || [e];
      // an event trigger carries what fired it (a timer, say): follow the chain from that change
      const tv = tr && trigVar(tr), from = tv && ((tv.event && tv.event.data && tv.event.data.entity_id) || tv.entity_id);
      if (this._dbg && chain.length === 1 && typeof from === 'string') {
        const before = this._dbg.entries.slice().reverse().find((x) => x.kind === 'state' && x.key === from && x.t <= e.t + 150 && e.t - x.t < 60000);
        if (before) chain = this._dbgChain(before).concat([e]);
      }
      this._lightSteps(chain, { keys: path.keys, edges: path.edges, e, tr });
    }
    _lightSteps(steps, run) {
      const m = this._model;
      if (!m) return;
      const keys = [], edges = [];
      steps.forEach((s) => { if (s.key && m.nodes.has(s.key) && keys[keys.length - 1] !== s.key) keys.push(s.key); });
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i], e = m.edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
        edges.push(e ? e.id : null);
      }
      clearTimeout(this._timers.lit);
      if (!keys.length && !(run && run.keys.length)) { this._toast(T('nothing_in_this_step_is')); return; }
      this._sel = null;
      this._frameKeys(keys.concat(run ? run.keys : []));
      let i = 0;
      const tick = () => {
        i = Math.min(i + 1, Math.max(keys.length, 1));
        const ks = new Set(keys.slice(0, i)), es = new Set(edges.slice(0, i - 1).filter(Boolean));
        if (i >= keys.length && run) { run.keys.forEach((k) => ks.add(k)); run.edges.forEach((x) => es.add(x)); }
        this._lit = { keys: ks, edges: es, now: keys[i - 1] || null };
        this._applyFocus();
        this._litBar(steps, i, run);
        if (i < keys.length) this._timers.lit = setTimeout(tick, 650);
      };
      tick();
    }
    _litBar(steps, at, run) {
      const b = this._$.litbar;
      const runPart = run && run.tr ? `<span class="lrun"><b>${esc(this._boxName(run.e.key))}</b> · ${esc(clock(run.tr.timestamp && run.tr.timestamp.start))} · ${esc((run.tr.not_triggered ? { text: T('didn_t_fire') } : OUTCOME(run.tr)).text)}</span>` : '';
      b.classList.remove('flowbar');
      b.innerHTML = `<div class="lsteps">${steps.map((s, i) => `<span class="lstep ${i < at ? 'on' : ''}">${esc(this._stepText(s))}</span>`).join('<span class="larr">→</span>')}</div><div class="lbtns">${runPart}${steps.length > 1 ? `<button data-act="lit-replay">${T('replay')}</button>` : ''}${run && run.e && run.e.run ? `<button data-act="lit-trace">${T('open_trace')}</button>` : ''}<button data-act="lit-clear">${T('clear')}</button></div>`;
      b.hidden = false;
      this._litSteps = steps; this._litRun = run || null;
      this._fitLitbar();
    }
    // the part of the board the drawer leaves visible
    _openWidth() {
      const W = this._$.vp.clientWidth, d = this._$.drawer;
      return d && !d.hidden && this._drawer ? Math.max(200, W - d.offsetWidth) : W;
    }
    _fitLitbar() {
      const r = (12 + this._$.vp.clientWidth - this._openWidth()) + 'px', b = this._$.litbar, vt = this._$.vtabs;
      if (b && !b.hidden) b.style.right = r;
      // the version tabs and their banner keep to the part of the board the drawer leaves free too
      if (vt) vt.style.right = r;
    }
    // bring boxes into the visible part of the board, zooming out only when they don't fit
    _frameKeys(keys, extra) {
      const m = this._model, ns = [...new Set(keys)].map((k) => m && m.nodes.get(k)).filter(Boolean).concat(extra || []);
      if (!ns.length) return;
      const W = this._openWidth(), H = this._$.vp.clientHeight, v = this._view, pad = 50;
      const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y1 = Math.max(...ns.map((n) => n.y + n.h));
      const inView = x0 * v.k + v.x >= 0 && y0 * v.k + v.y >= 0 && x1 * v.k + v.x <= W && y1 * v.k + v.y <= H - 60;
      if (inView) return;
      const k = Math.max(0.35, Math.min(v.k, (W - pad * 2) / Math.max(1, x1 - x0), (H - 60 - pad * 2) / Math.max(1, y1 - y0)));
      this._view = { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: (H - 60 - (y1 - y0) * k) / 2 - y0 * k };
      this._applyView();
      this._saveView();
    }
    _stepText(s) {
      if (s.kind === 'state') return `${this._boxName(s.key)} → ${this._fmtState(s.key, s.state)}`;
      if (s.kind === 'run') return T('ran', { boxName: this._boxName(s.key) });
      if (s.kind === 'call') return s.svc;
      return s.text || '';
    }
    _clearLit(quiet) {
      clearTimeout(this._timers.lit);
      const was = !!this._lit, fl = !!this._flow;
      this._lit = null; this._litSteps = null; this._litRun = null; this._flow = null;
      this._$.litbar.hidden = true;
      this._$.litbar.classList.remove('flowbar');
      if (was && !quiet) this._applyFocus();
      else if (fl) { this._paintFlow(); this._drawEdges(); }
    }
    _openLitTrace() {
      const run = this._litRun, r = run && run.e && run.e.run;
      if (!r) return;
      this._drawerBack = this._drawer && this._drawer.mode === 'debug' ? 'debug' : 'runs';
      this._openDrawer(`/config/${r.domain}/trace/${encodeURIComponent(r.item_id)}?run_id=${encodeURIComponent(r.run_id)}`,
        T('trace', { boxName: this._boxName(run.e.key), extra: run.tr ? ' · ' + clock(run.tr.timestamp && run.tr.timestamp.start) : '' }), { back: true });
    }

    // ---- notifications (9.5): what a notify box sent lately, from the traces of what sends it
    async _openMessages(key) {
      const m = this._model, n = m && m.nodes.get(key);
      if (!n) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'msgs', key };
      const d = this._$.drawer;
      d.hidden = false;
      d.innerHTML = `<div class="dhead"><span class="dtitle">${T('last_messages', { name: esc(n.name) })}</span><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="runs msgs"><div class="muted pad">${T('reading_traces')}</div></div>`;
      this._fitLitbar();
      const callers = [...new Set(m.edges.filter((e) => e.to === key && e.role === 'action' && /^(automation|script)\./.test(e.from)).map((e) => e.from))];
      const mine = (p) => (key.startsWith('svc:') ? p.domain + '.' + p.service === key.slice(4)
        : p.domain === 'notify' && toList((p.target || {}).entity_id).concat(toList((p.service_data || {}).entity_id)).includes(key));
      const out = [];
      await Promise.all(callers.map(async (c) => {
        const cn = m.nodes.get(c), id = cn && this._itemId(cn);
        if (!id) return;
        const list = await this._ws({ type: 'trace/list', domain: cn.domain, item_id: id }).catch(() => []);
        const recent = (list || []).filter((r) => r.state === 'stopped').sort((a, b) => Date.parse(b.timestamp.start) - Date.parse(a.timestamp.start)).slice(0, 8);
        await Promise.all(recent.map(async (r) => {
          const tr = await this._ws({ type: 'trace/get', domain: cn.domain, item_id: id, run_id: r.run_id }).catch(() => null);
          Object.values((tr && tr.trace) || {}).forEach((els) => (els || []).forEach((el) => {
            const p = el && el.result && el.result.params;
            if (p && mine(p)) out.push({ t: Date.parse(el.timestamp) || Date.parse(r.timestamp.start) || 0, from: c, data: p.service_data || {}, run: { domain: cn.domain, item_id: id, run_id: r.run_id } });
          }));
        }));
      }));
      if (!this._drawer || this._drawer.mode !== 'msgs' || this._drawer.key !== key) return;
      out.sort((a, b) => b.t - a.t);
      this._msgs = out;
      const box = d.querySelector('.msgs');
      if (!box) return;
      box.innerHTML = out.length ? `<div class="muted pad small">${T('what_this_sent_lately_newest')}</div>${out.slice(0, 40).map((x, i) => {
          const dd = x.data || {}, btns = dd.data && Array.isArray(dd.data.actions) ? dd.data.actions.map((a) => a && a.title).filter(Boolean) : [];
          return `<button class="run msg" data-act="msg-run" data-i="${i}" data-key="${esc(x.from)}"><span class="rt">${esc(clock(new Date(x.t).toISOString()))}</span>`
            + `<span class="rn"><b>${esc(dd.title || T('no_title'))}</b><span>${esc(shorten(dd.message == null ? '' : typeof dd.message === 'object' ? JSON.stringify(dd.message) : dd.message, 300))}</span>${btns.length ? `<span class="mb">${T('buttons', { btns: esc(btns.join(', ')) })}</span>` : ''}</span>`
            + `<span class="ro">${esc(this._boxName(x.from))}</span></button>`;
        }).join('')}`
        : `<div class="muted pad">${T('nothing_found_home_assistant_keeps')}</div>`;
    }

    /* ---------- the arrow editor (7.5, decision D8): an arrow is a reference in an automation or script config,
       so drawing or removing one edits that config, through the same API Home Assistant's own editor uses ---------- */
    // the automation or script whose config an arrow comes from, and the box it names there
    _arrowEnds(e) {
      const logic = (k) => /^(automation|script)\./.test(k);
      if ((e.role === 'trigger' || e.role === 'condition') && logic(e.to)) return { owner: e.to, other: e.from };
      if ((e.role === 'action' || e.role === 'call') && logic(e.from)) return { owner: e.from, other: e.to };
      return null;
    }
    // clicking an arrow selects it: what it means, and what can be done with it
    _edgeClick(id, ev) {
      const m = this._model, e = m && m.edges.find((x) => x.id === id);
      if (!e || e.role === 'tool') return;
      this._selEdge = id;
      this._sel = null;
      this._applyFocus();
      const bar = this._$.edgebar, ends = this._arrowEnds(e), owner = ends && m.nodes.get(ends.owner);
      const full = this._full(), why = !ends ? (e.role === 'source' ? T('this_arrow_comes_from_the') : T('this_arrow_doesn_t_come')) : '';
      bar.innerHTML = `<span class="ebtxt">${esc(this._edgeTitle(e))}</span><button data-act="arw-remove" ${!ends || !full ? 'disabled' : ''} title="${esc(!ends ? why : full ? T('remove_what_this_arrow_stands') : T('full_manager_only_switch_it'))}"><ha-icon icon="mdi:link-variant-remove"></ha-icon><span>${T('remove_2')}</span></button>${owner ? `<button data-act="arw-open" title="${T('open_in_its_editor', { name: esc(owner.name) })}"><ha-icon icon="mdi:pencil-outline"></ha-icon><span>${T('edit', { name: esc(owner.name) })}</span></button>` : ''}`;
      bar.hidden = false;
      const r = this._$.vp.getBoundingClientRect();
      bar.style.left = Math.max(6, Math.min(ev.clientX - r.left - 20, this._openWidth() - bar.offsetWidth - 6)) + 'px';
      bar.style.top = Math.max(6, Math.min(ev.clientY - r.top + 14, r.height - bar.offsetHeight - 6)) + 'px';
    }
    _clearEdgeSel() {
      if (!this._selEdge && this._$.edgebar.hidden) return;
      this._selEdge = null;
      this._$.edgebar.hidden = true;
      this._drawEdges();
    }
    // the config of the automation or script that holds an arrow, or why it can't be changed from here
    async _ownerCfg(owner) {
      const n = this._model && this._model.nodes.get(owner), dom = owner.split('.')[0], id = n && this._itemId(n);
      if (!n) return { err: T('it_isn_t_on_the') };
      if (!id) return { err: T('has_no_id_so_it', { name: n.name }) };
      let cfg;
      try { cfg = await this._hass.callApi('GET', `config/${dom}/config/${encodeURIComponent(id)}`); }
      catch (e) {
        const nf = e && (e.status_code === 404 || /404|not.found/i.test(String(e.message || e.body || e.error || '')));
        return { err: nf ? T('is_set_up_in_yaml', { name: n.name, dom }) : T('could_not_read_its_config', { e: (e && (e.message || e.body)) || e }), n };
      }
      if (cfg && cfg.use_blueprint) return { err: T('comes_from_a_blueprint_its', { name: n.name }), n };
      return { cfg, id, dom, n, isScript: dom === 'script' };
    }
    // removing an arrow: each reference behind it, ticked, with the YAML that goes
    async _arrowRemoveDialog(id) {
      const m = this._model, e = m && m.edges.find((x) => x.id === id), ends = e && this._arrowEnds(e);
      this._clearEdgeSel();
      if (!ends || !this._full()) return;
      const md = this._$.modal;
      md.hidden = false;
      md.innerHTML = `<div class="dlg wide"><h3>${T('remove_an_arrow')}</h3><div class="muted">${T('reading_the_config')}</div></div>`;
      const o = await this._ownerCfg(ends.owner), other = m.nodes.get(ends.other);
      if (o.err) {
        md.innerHTML = `<div class="dlg"><h3>${T('remove_an_arrow')}</h3><p class="dtext">${esc(o.err)}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button><button class="primary" data-act="arw-edit" data-key="${esc(ends.owner)}">${T('open_the_editor')}</button></div></div>`;
        return;
      }
      const refs = refsTo(o.cfg, o.isScript, ends.other);
      const indirect = analyze(o.cfg, o.isScript, (x) => this._known(x)).refs.filter((r) => r.ref === ends.other && r.tpl).length;
      this._arw = { mode: 'remove', o, refs, sel: new Set(refs.map((r, i) => i)), owner: ends.owner, other: ends.other, otherName: other ? other.name : ends.other };
      const row = (r, i) => {
        const node = getPath(o.cfg, r.path);
        const what = r.mode === 'node' ? T('removes_this', { extra: r.kind === 'trigger' ? 'trigger' : r.kind === 'condition' ? 'condition' : 'step' }) : T('takes_out_of_its_list', { otherName: this._arw.otherName });
        return `<label class="aref"><input type="checkbox" data-aref="${i}" checked><span><b>${esc(refPlace(r))}</b> <span class="muted small">${esc(what)}</span><pre>${esc(shorten(toYaml(node), 600))}</pre></span></label>`;
      };
      md.innerHTML = `<div class="dlg wide adlg"><h3>${esc(this._arw.otherName)} and ${esc(o.n.name)}</h3>${refs.length ? `<div class="hint">${T('what_s_config_says_about', { name: esc(o.n.name), otherName: esc(this._arw.otherName) })}</div><div class="arefs">${refs.map(row).join('')}</div>`
          : `<p class="dtext">${T('doesn_t_name_directly_so', { name: esc(o.n.name), otherName: esc(this._arw.otherName), extra: e.via ? ` ${T('the_arrow_comes_through', { boxName: esc(this._boxName(e.via)) })}` : '' })}</p>`}${indirect ? `<div class="hint">${T('it_is_also_read_inside', { indirect: P('n_templates', indirect) })}</div>` : ''}${this._yamlWarn(o.dom)}<div class="aval hint"></div><div class="btns"><button data-act="arw-edit" data-key="${esc(ends.owner)}">${T('open_the_editor')}</button><span class="cnt"></span><button data-act="modal-cancel">${T('cancel')}</button>${refs.length ? `<button class="primary danger" data-act="arw-save">${T('remove')}</button>` : ''}</div></div>`;
    }
    _yamlWarn(dom) {
      return this._data.ui.yamlOk ? '' : `<div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${T('saving_writes_s_yaml_the', { dom })}</span></div>`;
    }
    // drawing an arrow: pick the box to connect to
    _canLink(n) {
      if (!n || n.kind === 'tool') return false;
      const k = n.key;
      return /^(automation|script)\./.test(k) || /^(event|nact):/.test(k) || TGT_RE.test(k) || (!k.includes(':') && !!this._hass.states[k]);
    }
    // rev: the arrow is to go into this box, from the box picked next
    _startLink(key, drag, rev) {
      if (!this._full()) { this._toast(T('drawing_arrows_needs_full_manager')); return; }
      const n = this._model && this._model.nodes.get(key);
      if (!this._canLink(n)) return;
      this._linking = { from: key, drag: !!drag, moved: false, rev: !!rev };
      this._$.board.classList.add('linking');
      this._toast(rev ? T('now_click_the_box_that_leads_to', { name: n.name }) : T('now_click_the_box_to', { name: n.name }));
    }
    _linkMove(ev) {
      const L = this._linking, m = this._model, n = L && m && m.nodes.get(L.from);
      if (!n) return;
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      const x = (ev.clientX - r.left - v.x) / v.k, y = (ev.clientY - r.top - v.y) / v.k;
      const sx = L.rev ? n.x : x >= n.x + n.w / 2 ? n.x + n.w : n.x, sy = n.y + n.h / 2;
      this._$.links.innerHTML = `<path class="ltmp" d="M${sx},${sy} C${(sx + x) / 2},${sy} ${(sx + x) / 2},${y} ${x},${y}"></path>`;
      L.moved = true;
    }
    _endLink() {
      this._linking = null;
      this._$.board.classList.remove('linking');
      this._$.links.innerHTML = '';
    }
    // which way an arrow between two boxes can go, and what it can mean
    _linkKinds(from, to) {
      const logic = (k) => /^(automation|script)\./.test(k);
      const ent = (k) => !k.includes(':') && !!this._hass.states[k];
      if (to.startsWith('automation.') && (ent(from) || /^(event|nact):/.test(from)) && !logic(from)) return { owner: to, other: from, kinds: /^(event|nact):/.test(from) ? ['trigger'] : ['trigger', 'condition'] };
      if (logic(from) && to.startsWith('script.')) return { owner: from, other: to, kinds: ['call'] };
      if (logic(from) && (ent(to) || TGT_RE.test(to))) return { owner: from, other: to, kinds: ['action'] };
      return null;
    }
    async _linkDialog(from, to) {
      const m = this._model, a = m.nodes.get(from), b = m.nodes.get(to), how = this._linkKinds(from, to);
      if (!how) { this._toast(T('an_arrow_can_t_go', { name: a.name, name2: b.name })); return; }
      const md = this._$.modal;
      md.hidden = false;
      md.innerHTML = `<div class="dlg wide"><h3>${T('connect')}</h3><div class="muted">${T('reading_what_home_assistant_offers')}</div></div>`;
      const o = await this._ownerCfg(how.owner);
      if (o.err) {
        md.innerHTML = `<div class="dlg"><h3>${T('connect')}</h3><p class="dtext">${esc(o.err)}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button></div></div>`;
        return;
      }
      const choices = await this._linkChoices(how);
      if (!choices.length) { md.innerHTML = `<div class="dlg"><h3>${T('connect')}</h3><p class="dtext">${T('home_assistant_offers_nothing_that')}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button></div></div>`; return; }
      this._arw = { mode: 'add', o, how, choices, pick: 0, vals: {}, owner: how.owner, other: how.other };
      this._renderLinkDlg();
    }
    // what an arrow can mean, from Home Assistant's own lists for the box (get_triggers_for_target and the others)
    async _linkChoices(how) {
      const k = how.other, out = [], target = TGT_RE.test(k) ? { [{ area: 'area_id', floor: 'floor_id', label: 'label_id' }[k.slice(0, k.indexOf(':'))]]: k.slice(k.indexOf(':') + 1) } : { entity_id: k };
      const get = (type) => (k.includes(':') && !TGT_RE.test(k) ? Promise.resolve([]) : this._ws({ type, target }).catch(() => []));
      const names = await this._ptNamesFor(how.kinds);
      const ok = (desc) => !desc || Object.values(desc.fields || {}).every((f) => !f.required || f.default !== undefined);
      for (const kind of how.kinds) {
        if (kind === 'trigger') {
          if (k.startsWith('event:')) out.push({ kind, text: T('it_triggers_it'), item: { trigger: 'event', event_type: k.slice(6) } });
          else if (k.startsWith('nact:')) { const b = this._buttonEvent(this._model.nodes.get(k)); out.push({ kind, text: T('pressing_it_triggers_it'), item: { trigger: 'event', event_type: b.event_type, event_data: b.event_data } }); }
          else {
            out.push({ kind, text: T('it_changes_state'), state: 'to', item: { trigger: 'state', entity_id: k } });
            ((await get('get_triggers_for_target')) || []).filter((t) => ok((this._trigDesc || {})[t])).forEach((t) => out.push({ kind, text: names[t] || humanize(t), item: { trigger: t, target: { entity_id: k } } }));
          }
        } else if (kind === 'condition') {
          out.push({ kind, text: T('its_state_is'), state: 'state', item: { condition: 'state', entity_id: k, state: '' } });
          ((await get('get_conditions_for_target')) || []).filter((t) => ok((this._condDesc || {})[t])).forEach((t) => out.push({ kind, text: names[t] || humanize(t), item: { condition: t, target: { entity_id: k } } }));
        } else if (kind === 'call') {
          out.push({ kind, text: T('it_runs_it'), item: { action: k }, fields: await this._scriptFields(k).then((fs) => fs.filter((f) => f.required)) });
        } else if (kind === 'action') {
          ((await get('get_services_for_target')) || []).filter((s) => !s.startsWith('homeassistant.')).sort().forEach((s) => {
            const [d, sv] = s.split('.'), desc = ((this._hass.services || {})[d] || {})[sv] || {};
            const fields = Object.entries(desc.fields || {}).filter(([, f]) => f && f.required).map(([name, f]) => ({ name, type: 'selector', label: f.name || name, selector: f.selector || { text: {} }, required: true }));
            out.push({ kind, text: desc.name || humanize(s), item: Object.assign({ action: s, target }), fields });
          });
        }
      }
      return out;
    }
    // names of the purpose-specific triggers and conditions, in the user's language when Home Assistant has them
    async _ptNamesFor(kinds) {
      const cat = [].concat(kinds.includes('trigger') ? ['triggers'] : [], kinds.includes('condition') ? ['conditions'] : []);
      const out = {};
      for (const c of cat) {
        try {
          const r = await this._ws({ type: 'frontend/get_translations', language: this._hass.language || 'en', category: c });
          Object.entries((r && r.resources) || {}).forEach(([key, v]) => { const mm = key.match(/^component\.([^.]+)\.(?:triggers|conditions)\.([^.]+)\.name$/); if (mm) out[mm[1] + '.' + mm[2]] = v; });
        } catch (e) { /* the ids then */ }
      }
      return out;
    }
    _renderLinkDlg() {
      const w = this._arw, md = this._$.modal, c = w.choices[w.pick], m = this._model;
      const a = m.nodes.get(w.how.other), owner = w.o.n;
      const lead = { trigger: T('triggers_when', { name: a.name, name2: owner.name }), condition: T('checks_only_if', { name: owner.name, name2: a.name }), action: T('changes_it', { name: owner.name, name2: a.name }), call: T('runs_2', { name: owner.name, name2: a.name }) };
      const kinds = [...new Set(w.choices.map((x) => x.kind))];
      md.innerHTML = `<div class="dlg wide adlg"><h3>${T('connect_and_2', { name: esc(a.name), name2: esc(owner.name) })}</h3>${kinds.length > 1 ? `<div class="tchoice">${kinds.map((k) => `<button class="chip ${c.kind === k ? 'on' : ''}" data-act="lnk-kind" data-k="${k}">${k === 'trigger' ? T('it_triggers_it') : T('it_is_checked_by_it')}</button>`).join('')}</div>` : ''}<div class="tone">${esc(lead[c.kind])}</div><div class="tchoice">${w.choices.map((x, i) => (x.kind === c.kind ? `<button class="chip ${i === w.pick ? 'on' : ''}" data-act="lnk-pick" data-i="${i}">${esc(x.text)}</button>` : '')).join('')}</div>${c.state ? `<label>${c.state === 'to' ? T('to_empty_any_change') : T('state')}<input name="lstate" value="${esc(w.vals.state || '')}" list="fblstates"><datalist id="fblstates">${this._stateHints(a).map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>` : ''}${c.fields && c.fields.length ? `<div class="tfields">${c.fields.map((f, i) => this._fieldHTML(f, i, w.vals)).join('')}</div>` : ''}<div class="hint">${T('adds_to', { name: esc(owner.name) })}</div><pre class="yprev"></pre>${this._yamlWarn(w.o.dom)}<div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="arw-save">${T('add')}</button></div></div>`;
      if (c.fields && c.fields.length) { this._tst = { key: w.how.other, specs: [{ id: 'l', fields: c.fields }], pick: 'l', vals: w.vals }; this._mountFields(this._tst.specs[0]); }
      this._linkPreview();
    }
    // the item a link adds, from the choice and what was typed
    _linkItem() {
      const w = this._arw, c = w.choices[w.pick], item = JSON.parse(JSON.stringify(c.item)), md = this._$.modal;
      const st = md.querySelector('input[name="lstate"]');
      if (c.state) { const v = st ? st.value.trim() : ''; if (v) item[c.state] = v; else delete item[c.state]; }
      (c.fields || []).forEach((f, i) => {
        const el = md.querySelector(`[name="tf${i}"]`), box = md.querySelector(`.selbox[data-f="${i}"]`);
        const v = box && box.dataset.mounted ? w.vals[f.name] : el ? scalar(el.value) : undefined;
        if (v !== undefined && v !== '' && v !== null) (item.data || (item.data = {}))[f.name] = v;
      });
      return item;
    }
    _linkKey(kind, isScript, cfg) {
      if (isScript) return 'sequence';
      const plural = { trigger: 'triggers', condition: 'conditions', action: 'actions', call: 'actions' }[kind], single = plural.slice(0, -1);
      return cfg[plural] == null && cfg[single] != null ? single : plural;
    }
    _linkPreview() {
      const w = this._arw, pre = this._$.modal.querySelector('.yprev');
      if (!w || w.mode !== 'add' || !pre) return;
      const c = w.choices[w.pick], key = this._linkKey(c.kind, w.o.isScript, w.o.cfg);
      pre.textContent = toYaml({ [key]: [this._linkItem()] });
    }
    // the new config: a link appended to its list, or the ticked references removed
    _arwResult() {
      const w = this._arw, cfg = JSON.parse(JSON.stringify(w.o.cfg));
      if (w.mode === 'remove') return dropRefs(cfg, w.refs.filter((r, i) => w.sel.has(i)));
      const c = w.choices[w.pick], key = this._linkKey(c.kind, w.o.isScript, cfg), item = this._linkItem();
      if (c.state === 'state' && !item.state) throw new Error(T('enter_the_state_it_checks'));
      const miss = (c.fields || []).find((f) => f.required && !(item.data && f.name in item.data));
      if (miss) throw new Error(T('fill_in', { label: miss.label }));
      cfg[key] = toList(cfg[key]).concat([item]);
      return cfg;
    }
    async _arwSave() {
      const w = this._arw, md = this._$.modal, val = md.querySelector('.aval'), btn = md.querySelector('[data-act="arw-save"]');
      if (!w) return;
      let after;
      try { after = this._arwResult(); } catch (e) { if (val) val.textContent = e.message || String(e); return; }
      if (w.mode === 'remove' && !w.sel.size) { if (val) val.textContent = T('tick_at_least_one'); return; }
      // Home Assistant checks the new config first; nothing is saved when it doesn't accept it
      const lists = w.o.isScript ? { actions: after.sequence || [] } : { triggers: after.triggers != null ? after.triggers : after.trigger || [], conditions: after.conditions != null ? after.conditions : after.condition || [], actions: after.actions != null ? after.actions : after.action || [] };
      if (btn) btn.disabled = true;
      let res = null;
      try { res = await this._ws(Object.assign({ type: 'validate_config' }, lists)); } catch (e) { res = null; }
      const bad = res && Object.entries(res).filter(([, v]) => v && v.valid === false);
      if (bad && bad.length) {
        if (val) val.innerHTML = `<b>${T('home_assistant_doesn_t_accept')}</b> ${bad.map(([k, v]) => esc(k + ': ' + v.error)).join('; ')}`;
        if (btn) btn.disabled = false;
        return;
      }
      const { dom, id, n } = w.o, before = w.o.cfg, label = this._model && this._model.label;
      const text = w.mode === 'add' ? T('connect_and', { boxName: this._boxName(w.other), name: n.name }) : T('remove_from', { boxName: this._boxName(w.other), name: n.name });
      try { await this._saveCfg(dom, id, after); } catch (e) {
        if (val) val.textContent = T('could_not_save_2', { e: (e && (e.message || e.body)) || e });
        if (btn) btn.disabled = false;
        return;
      }
      if (!this._data.ui.yamlOk) { this._data.ui.yamlOk = true; this._save(); }
      this._arw = null; this._tst = null;
      this._closeModal();
      // put back exactly the config it had, unless someone has changed it since
      const same = async (want) => { const now = await this._hass.callApi('GET', `config/${dom}/config/${encodeURIComponent(id)}`).catch(() => null); return canon(now) === canon(want); };
      this._history({ label, text, check: (dir) => same(dir === 'undo' ? after : before), undo: () => this._saveCfg(dom, id, before), redo: () => this._saveCfg(dom, id, after) });
      this._toast(T('saved_through_home_assistant_s', { text }), [{ text: T('undo'), fn: () => this._undo() }]);
      this._configChanged();
    }
    _saveCfg(dom, id, cfg) {
      return this._hass.callApi('POST', `config/${dom}/config/${encodeURIComponent(id)}`, cfg).then((r) => { this._cfgCache.clear(); return r; });
    }

    /* ---------- Node-RED flows (2.7, decision D1): read in the browser through the Node-RED app's own page, only
       while the switch in the Key is on. That page answers only once Home Assistant has let this browser in, which
       it does when Node-RED is opened from its sidebar (the board never asks for that itself). Until then, the
       flows last read by any board, kept by the integration (functions_board/nodered), stand in, marked with when
       they were read. What's kept is the summary nrGroups makes: names and entity ids, no flow code. ---------- */
    async _nodered() {
      if (this._data.ui.nodered !== true) return null;
      const c = this._nrCache;
      if (c && Date.now() - c.at < (c.need ? 5000 : 60000)) return c;
      if (this._nrLoading) return this._nrLoading;
      const done = (x) => { this._nrCache = Object.assign({ at: Date.now(), groups: [] }, x); return this._nrCache; };
      this._nrLoading = (async () => {
        try {
          const r = await this._ws({ type: 'supervisor/api', endpoint: '/addons', method: 'get' }).catch(() => null);
          if (!r) return done({ err: T('this_home_assistant_has_no') });
          const app = toList(r.addons).find((a) => a && /nodered/i.test(String(a.slug)));
          if (!app) return done({ err: T('no_node_red_app_is') });
          if (app.state !== 'started') return done({ err: T('the_node_red_app_isn') });
          const info = await this._ws({ type: 'supervisor/api', endpoint: `/addons/${app.slug}/info`, method: 'get' });
          const base = info && info.ingress_url;
          // a path on this Home Assistant (/api/hassio_ingress/…/), never another address: the only fetch the board makes
          if (!base || !SAME_ORIGIN.test(base)) return done({ err: T('the_node_red_app_has') });
          // through the app's page in Home Assistant, as opening Node-RED from the sidebar does
          const res = await fetch(base + 'flows', { credentials: 'same-origin', headers: { 'Node-RED-API-Version': 'v2' } }).catch(() => null);
          if (!res || res.status === 401 || res.status === 403) {
            // not let in (yet, or any more): the flows last read here, if any, until Node-RED is opened
            const kept = await this._ws({ type: 'functions_board/nodered' }).then((x) => x && x.kept).catch(() => null);
            const ok = kept && kept.slug === app.slug && Array.isArray(kept.groups) ? kept : null;
            const when = ok ? new Date(ok.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
            return done({ base, slug: app.slug, need: true, groups: ok ? ok.groups : [], asOf: ok ? ok.at : null,
              err: ok ? T('node_red_flows_as_of', { when }) : T('open_node_red_once_so_the') });
          }
          if (!res.ok) return done({ slug: app.slug, err: T('node_red_answered', { status: res.status }) });
          const body = await res.json(), flows = Array.isArray(body) ? body : (body && body.flows) || [];
          const groups = nrGroups(flows, (x) => this._known(x));
          this._ws({ type: 'functions_board/nodered_keep', slug: app.slug, groups, client: this._client() }).catch(() => { /* shown here, just not kept */ });
          return done({ base, slug: app.slug, groups });
        } catch (e) { return done({ err: T('could_not_read_the_flows', { e: (e && (e.message || e.code)) || e }) }); }
        finally { this._nrLoading = null; }
      })();
      return this._nrLoading;
    }
    // Node-RED through Home Assistant's own page for it (which lets this browser in); on closing it, the flows
    // are read again
    _openNodeRed(sub, title) {
      const c = this._nrCache;
      if (!c || !c.slug) return;
      this._nrWait = true;
      this._openDrawer(c.need || !c.base ? `/hassio/ingress/${c.slug}` : c.base + (sub || ''), title || T('node_red'));
    }
    // the flows that trigger on, read, change or run a piece of the function: boxes wired to those pieces
    async _nrNodes(nodes, edges) {
      if (this._data.ui.nodered !== true) return;
      const nr = await this._nodered();
      if (!nr || !nr.groups.length) return;
      const member = (k) => { const n = nodes.get(k); return n && n.kind === 'member'; };
      const used = new Set();
      nr.groups.forEach((g) => {
        const links = [];
        g.trig.forEach((x) => { if (member(x)) links.push([x, 'trigger']); });
        g.read.forEach((x) => { if (member(x)) links.push([x, 'condition']); });
        g.change.forEach((x) => { if (member(x)) links.push([x, 'action']); });
        g.calls.forEach((x) => { if (member(x)) links.push([x, 'call']); });
        if (!links.length) return;
        const key = 'nr:' + g.id;
        g.events.forEach((t) => { if (nodes.has('event:' + t)) links.push(['event:' + t, 'trigger']); });
        nodes.set(key, { key, kind: 'nodered', domain: 'nodered', name: g.name, icon: 'mdi:sitemap', badges: new Set(), writers: 0, x: 0, y: 0, w: NW, h: NH,
          nr: { tabLabel: g.tabLabel, size: g.size, sub: '#flow/' + encodeURIComponent(g.tab) } });
        links.forEach(([k, role]) => {
          used.add(k);
          const inbound = role === 'trigger' || role === 'condition', from = inbound ? k : key, to = inbound ? key : k, id = from + '>' + to;
          const e = edges.find((x) => x.id === id);
          if (e) { if (ROLE_RANK[role] > ROLE_RANK[e.role]) e.role = role; return; }
          edges.push({ id, from, to, role, svcs: new Set(), tfs: [], anyTrig: role === 'trigger', via: null, loop: false });
        });
      });
      // a piece a flow uses is no unused piece (4.6)
      used.forEach((k) => { const n = nodes.get(k); if (n) n.unref = false; });
    }

    /* ---------- keyboard and screen readers (4.8) ---------- */
    // what each box is wired to, in words, for its accessible description
    _connText() {
      const m = this._model, out = new Map();
      if (!m) return out;
      const IN = { trigger: T('set_off_by'), condition: T('checks'), source: T('reads'), action: T('changed_by'), call: T('run_by'), tool: T('tested_or_listened_to_by') };
      const OUT = { trigger: T('sets_off'), condition: T('is_checked_by'), source: T('is_read_by'), action: T('changes'), call: T('runs'), tool: T('tests') };
      const list = (names) => (names.length > 4 ? T('and_more_2', { names: names.slice(0, 4).join(', '), n: names.length - 4 }) : names.join(', '));
      const vis = this._visibleKeys(), E = this._visEdges();
      vis.forEach((k) => {
        const parts = [];
        const group = (edges, other, words) => {
          const by = new Map();
          edges.forEach((e) => { const n = m.nodes.get(other(e)); if (n) (by.get(e.role) || by.set(e.role, []).get(e.role)).push(n.name); });
          by.forEach((names, role) => parts.push(`${words[role] || role} ${list([...new Set(names)])}`));
        };
        // a check points into the automation: from the automation's side it checks the box
        group(E.filter((e) => e.to === k), (e) => e.from, Object.assign({}, IN, { condition: T('checks') }));
        group(E.filter((e) => e.from === k), (e) => e.to, OUT);
        if (parts.length) out.set(k, parts.join('. '));
      });
      return out;
    }
    // one box is in the tab order at a time; the arrow keys move between them
    _rove(key) {
      const el = key && this._els.get(key);
      if (!el) return;
      if (this._roveKey && this._roveKey !== key) { const o = this._els.get(this._roveKey); if (o) o.tabIndex = -1; }
      el.tabIndex = 0;
      this._roveKey = key;
    }
    // the box an arrow key leads to: along the arrows for left and right, else the nearest in that direction
    _navFrom(k, dir) {
      const m = this._model, n = m && m.nodes.get(k);
      if (!n) return null;
      const vis = this._visibleKeys(), E = this._visEdges(), cx = (o) => o.x + o.w / 2, cy = (o) => o.y + o.h / 2;
      let cand = dir === 'right' ? E.filter((e) => e.from === k).map((e) => e.to) : dir === 'left' ? E.filter((e) => e.to === k).map((e) => e.from) : [];
      cand = cand.filter((x) => x !== k && vis.has(x));
      if (!cand.length) {
        cand = [...vis].filter((x) => {
          const o = m.nodes.get(x);
          return x !== k && (dir === 'right' ? cx(o) > cx(n) + 10 : dir === 'left' ? cx(o) < cx(n) - 10 : dir === 'up' ? cy(o) < cy(n) - 10 : cy(o) > cy(n) + 10);
        });
      }
      const horiz = dir === 'left' || dir === 'right';
      const d = (x) => { const o = m.nodes.get(x), dx = Math.abs(cx(o) - cx(n)), dy = Math.abs(cy(o) - cy(n)); return horiz ? dx + dy * 2 : dy + dx * 2; };
      return cand.sort((a, b) => d(a) - d(b))[0] || null;
    }
    _boxKey(e, t) {
      const k = t && t.classList && t.classList.contains('node') ? t.dataset.key : null;
      if (!k) return false;
      const dirs = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[e.key]) {
        e.preventDefault();
        const to = this._navFrom(k, dirs[e.key]);
        if (to) { this._select(to); this._rove(to); this._showBox(to); const el = this._els.get(to); if (el) el.focus(); }
        return true;
      }
      if (e.key === 'Enter') { e.preventDefault(); const n = this._model.nodes.get(k); if (n) this._editOrOpen(n); return true; }
      if (e.key === ' ') {
        e.preventDefault();
        this._select(this._sel === k ? null : k);
        // then Tab reaches the box's actions
        return true;
      }
      return false;
    }
    // dialogs: named, focus moves in and stays in, and goes back where it was when they close
    _watchModal() {
      const md = this._$.modal;
      new MutationObserver(() => {
        const open = !md.hidden && !!md.firstElementChild;
        const dlg = md.querySelector('.dlg');
        if (dlg && !dlg.hasAttribute('role')) {
          dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
          const h = dlg.querySelector('h3');
          if (h) { h.id = 'fbdlgtitle'; dlg.setAttribute('aria-labelledby', 'fbdlgtitle'); }
        }
        if (open && !this._modalOpen) {
          this._modalOpen = true;
          this._modalBack = this.shadowRoot.activeElement || null;
          setTimeout(() => { if (md.hidden) return; const f = md.querySelector('input:not([type=hidden]):not([disabled]), textarea, select, button.primary:not([disabled])') || md.querySelector('button'); if (f && !md.contains(this.shadowRoot.activeElement)) f.focus(); }, 60);
        } else if (!open && this._modalOpen) {
          this._modalOpen = false;
          const back = this._modalBack, box = this._roveKey && this._els.get(this._roveKey);
          this._modalBack = null;
          if (back && back.isConnected) back.focus(); else if (box) box.focus();
        }
      }).observe(md, { attributes: true, attributeFilter: ['hidden'], childList: true });
      md.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || md.hidden) return;
        const list = [...md.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"], ha-selector')].filter((x) => x.offsetParent !== null);
        if (!list.length) return;
        const cur = this.shadowRoot.activeElement, i = list.indexOf(cur);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && (i === list.length - 1 || i < 0)) { e.preventDefault(); list[0].focus(); }
      });
    }

    /* ---------- undo and redo: one stack per board session ---------- */
    // step: { label, text, undo(), redo(), check?(dir) } - check returns false when the item has changed
    // since the step (someone edited it elsewhere); the board then asks before overwriting
    _history(step) {
      if (this._ver) return;
      this._undoStack.push(step);
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack = [];
      this._renderUndo();
    }
    _renderUndo() {
      if (!this._$) return;
      const u = this._undoStack[this._undoStack.length - 1], r = this._redoStack[this._redoStack.length - 1];
      const ub = this._$.tools.querySelector('[data-act="undo"]'), rb = this._$.tools.querySelector('[data-act="redo"]');
      const key = /Mac|iPhone|iPad/.test(navigator.platform || '') ? T('cmd') : T('ctrl');
      if (ub) { ub.disabled = !u || this._undoBusy; ub.title = u ? T('undo_z', { text: u.text, key }) : T('nothing_to_undo'); }
      if (rb) { rb.disabled = !r || this._undoBusy; rb.title = r ? T('redo_shift_z', { text: r.text, key }) : T('nothing_to_redo'); }
    }
    async _undo() { await this._step(this._undoStack, this._redoStack, 'undo'); }
    async _redo() { await this._step(this._redoStack, this._undoStack, 'redo'); }
    async _step(from, to, dir) {
      if (this._undoBusy) return;
      const st = from[from.length - 1];
      if (!st) return;
      if (st.check && !this._confirmStep) {
        let ok = true;
        try { ok = await st.check(dir); } catch (e) { ok = true; }
        if (!ok) {
          this._toast(T('changed_since_somewhere_else', { text: st.text }), [{ text: dir === 'undo' ? T('undo_anyway') : T('redo_anyway'), fn: () => { this._confirmStep = true; this._step(from, to, dir).finally(() => { this._confirmStep = false; }); } }]);
          return;
        }
      }
      from.pop();
      const startedOn = this._data.ui.current;
      this._undoBusy = true; this._renderUndo();
      try {
        await st[dir]();
        to.push(st);
        this._toast((dir === 'undo' ? T('undone') : T('redone')) + st.text);
      } catch (e) {
        this._toast(T('could_not', { dir, text: st.text, message: e.message || e.code || e }));
      }
      this._undoBusy = false; this._renderUndo();
      // show the function the step changed, unless the user has moved on to another one meanwhile
      const moved = this._data.ui.current !== startedOn;
      if (!moved && st.label && st.label !== this._data.ui.current && this._data.functions.includes(st.label)) this._open(st.label);
      else if (this._model) { this._place(); this._render(); }
    }
    // layout steps: moving boxes, Arrange, frames and notes restore the function's previous layout
    _snap(label) { const L = this._layout(label); return JSON.stringify({ nodes: L.nodes, frames: L.frames, notes: L.notes, tools: L.tools || [], keep: L.keep || [], dir: L.dir || 'right' }); }
    _layoutStep(label, before, text) {
      const after = this._snap(label);
      if (after === before) return;
      const apply = (j) => {
        const v = JSON.parse(j), L = this._layout(label), tools = JSON.stringify(L.tools || []) !== JSON.stringify(v.tools || []);
        L.nodes = v.nodes; L.frames = v.frames; L.notes = v.notes;
        if (v.tools && v.tools.length) L.tools = v.tools; else delete L.tools;
        if (v.keep && v.keep.length) L.keep = v.keep; else delete L.keep;
        if (v.dir === 'down') L.dir = 'down'; else delete L.dir;
        this._save();
        // test buttons and monitors are boxes on the board: put them back or take them away too
        if (tools && this._model && this._model.label === label) { this._syncTools(); this._startMonitors(); }
      };
      // another board may have changed this layout since: ask before overwriting that
      const check = async (dir) => this._snap(label) === (dir === 'undo' ? after : before);
      this._history({ label, text, check, undo: async () => apply(before), redo: async () => apply(after) });
    }

    /* ---------- frames and notes ---------- */
    _addFrame() {
      const label = this._model.label, L = this._layout(label), c = this._center(), before = this._snap(label);
      L.frames.push({ id: uid(), title: T('new_frame'), x: Math.round(c.x - 270), y: Math.round(c.y - 170), w: 540, h: 340 });
      this._save(); this._renderFrames();
      this._layoutStep(label, before, T('add_frame'));
    }
    _addNote() {
      const label = this._model.label, L = this._layout(label), c = this._center(), before = this._snap(label);
      const n = { id: uid(), text: '', x: Math.round(c.x - 120), y: Math.round(c.y - 50), w: 240 };
      L.notes.push(n);
      this._save(); this._renderNotes();
      this._layoutStep(label, before, T('add_note'));
      const ta = this._$.notes.querySelector(`textarea[data-nid="${n.id}"]`);
      if (ta) ta.focus();
    }
    _delFrame(id) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.frames = L.frames.filter((f) => f.id !== id);
      this._save(); this._renderFrames();
      this._layoutStep(label, before, T('delete_frame'));
    }
    _delNote(id) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.notes = L.notes.filter((n) => n.id !== id);
      this._save(); this._renderNotes();
      this._layoutStep(label, before, T('delete_note'));
    }

    /* ---------- functions: create / edit / remove ---------- */
    _fnModal(label) {
      const l = label ? this._labelMap.get(label) : null;
      this._editing = label || null;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${l ? T('edit_function') : T('new_function_2')}</h3><label>${T('name')}<input name="name" value="${esc(l ? l.name : '')}" placeholder="${T('e_g_bathroom_heater_filter')}"></label><label>${T('description')}<input name="desc" value="${esc(l && l.description ? l.description : '')}" placeholder="${T('what_this_function_does_optional')}"></label><div class="row"><div class="selbox" data-sel="icon"></div><div class="selbox" data-sel="color"></div></div>${l ? '' : `<label class="chk"><input type="checkbox" name="cats" checked>${T('also_file_new_automations_scripts')}</label>`}<div class="hint">${l ? T('this_edits_the_home_assistant') : T('this_creates_a_home_assistant')}</div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="modal-save">${l ? T('save') : T('create_2')}</button></div></div>`;
      this._mountPickers(l && l.icon ? l.icon : 'mdi:puzzle-outline', l && l.color ? l.color : 'indigo');
      setTimeout(() => { const i = m.querySelector('input[name=name]'); if (i) i.focus(); }, 50);
    }
    _mountPickers(icon, color) {
      this._fnIcon = icon; this._fnColor = color;
      const m = this._$.modal, iconBox = m.querySelector('[data-sel="icon"]'), colorBox = m.querySelector('[data-sel="color"]');
      if (!iconBox || !colorBox) return;
      // plain inputs first; swapped for Home Assistant's own pickers as soon as they are loaded
      iconBox.innerHTML = `<label>${T('icon')}<input name="icon" value="${esc(icon)}"></label>`;
      colorBox.innerHTML = `<label>${T('colour')}<select name="color">${COLORS.map((c) => `<option value="${c}" ${c === color ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`;
      this._ensureSelector().then((ok) => {
        if (!ok || !iconBox.isConnected) return;
        const mk = (box, selector, label, value, set) => {
          const el = document.createElement('ha-selector');
          el.hass = this._hass; el.selector = selector; el.label = label; el.value = value;
          el.addEventListener('value-changed', (e) => { e.stopPropagation(); set(e.detail.value); el.value = e.detail.value; });
          box.innerHTML = ''; box.appendChild(el);
        };
        mk(iconBox, { icon: {} }, T('icon'), this._fnIcon, (v) => { this._fnIcon = v; });
        mk(colorBox, { ui_color: {} }, T('colour'), this._fnColor, (v) => { this._fnColor = v; });
      });
    }
    async _ensureSelector() {
      if (customElements.get('ha-selector')) return true;
      try {
        // Home Assistant loads its form widgets lazily; opening a built-in card editor loads them.
        if (window.loadCardHelpers) {
          const helpers = await window.loadCardHelpers();
          const card = await helpers.createCardElement({ type: 'button', entity: 'sun.sun' });
          if (card && card.constructor && card.constructor.getConfigElement) await card.constructor.getConfigElement();
        }
      } catch (e) { /* fall back to the plain inputs */ }
      await Promise.race([customElements.whenDefined('ha-selector'), new Promise((r) => setTimeout(r, 4000))]);
      return !!customElements.get('ha-selector');
    }
    async _saveFn() {
      const m = this._$.modal, v = (n) => m.querySelector(`[name=${n}]`);
      const name = v('name').value.trim();
      if (!name) { v('name').focus(); return; }
      const icon = this._fnIcon || 'mdi:puzzle-outline', color = this._fnColor || null, desc = v('desc').value.trim();
      // Home Assistant label names are unique: say what the name is already used by, and offer the way out
      const clash = this._labels.find((l) => String(l.name).toLowerCase() === name.toLowerCase() && l.label_id !== this._editing);
      if (clash) { this._nameClash(clash); return; }
      try {
        if (this._editing) {
          const old = this._labelMap.get(this._editing), lid = this._editing;
          const before = { name: old.name, icon: old.icon, color: old.color, description: old.description || '' };
          const after = { name, icon, color, description: desc };
          await this._ws(Object.assign({ type: 'config/label_registry/update', label_id: lid }, after));
          this._history({ label: lid, text: T('edit', { name: before.name }), undo: () => this._ws(Object.assign({ type: 'config/label_registry/update', label_id: lid }, before)), redo: () => this._ws(Object.assign({ type: 'config/label_registry/update', label_id: lid }, after)) });
          this._closeModal();
          await this._loadRegistries(); this._renderList(); this._renderHeader();
          return;
        }
        const st = await this._createFn({ name, icon, color, desc, cats: !!(v('cats') && v('cats').checked) });
        this._history({
          label: st.lid, text: T('create', { name }),
          check: async (dir) => dir !== 'undo' || (await this._labelCount(st.lid)) === 0,
          undo: async () => { st.layout = this._data.layouts[st.lid] || null; this._takeOff(st.lid); delete this._data.layouts[st.lid]; await this._dropCategories(st.made); await this._ws({ type: 'config/label_registry/delete', label_id: st.lid }); this._save(); },
          redo: async () => { await this._loadRegistries(); Object.assign(st, await this._createFn({ name, icon, color, desc, cats: st.cats, layout: st.layout })); },
        });
        this._closeModal();
        await this._loadRegistries();
        this._open(st.lid);
      } catch (e) { this._toast(T('could_not_save', { message: e.message || e.code || e })); }
    }
    async _createFn(o) {
      const msg = { type: 'config/label_registry/create', name: o.name, icon: o.icon };
      if (o.color) msg.color = o.color;
      if (o.desc) msg.description = o.desc;
      const lbl = await this._ws(msg);
      if (o.layout) this._data.layouts[lbl.label_id] = o.layout;
      const L = this._layout(lbl.label_id);
      let made = [];
      if (o.cats) { const r = await this._categories(o.name, o.icon); L.categories = r.ids; made = r.made; }
      if (!this._data.functions.includes(lbl.label_id)) this._data.functions.push(lbl.label_id);
      this._save();
      return { lid: lbl.label_id, made, cats: o.cats };
    }
    _nameClash(l) {
      const m = this._$.modal, box = m.querySelector('.clash') || document.createElement('div');
      box.className = 'clash';
      const onBoard = this._data.functions.includes(l.label_id);
      box.innerHTML = onBoard
        ? `<b>${esc(l.name)}</b> ${T('is_already_a_function_on')}<div class="cbtns"><button data-act="fn-goto" data-label="${esc(l.label_id)}">${T('open_it')}</button></div>`
        : `${T('a_home_assistant_label_called')} <b>${esc(l.name)}</b> ${T('already_exists_so_this_name')}<div class="cbtns"><button class="primary" data-act="fn-restore" data-label="${esc(l.label_id)}">${T('put_it_back_on_the')}</button><button data-act="fn-rename">${T('choose_another_name')}</button></div>`;
      const btns = m.querySelector('.btns');
      if (!box.isConnected && btns) btns.before(box);
    }
    _restoreFn(lid) {
      if (!this._data.functions.includes(lid)) this._data.functions.push(lid);
      this._save();
      this._closeModal();
      this._history({ label: lid, text: T('put_back', { fnName: this._fnName(lid) }), undo: async () => this._takeOff(lid), redo: async () => { if (!this._data.functions.includes(lid)) this._data.functions.push(lid); this._save(); } });
      this._renderList();
      this._open(lid);
      this._toast(T('is_back_on_the_board', { fnName: this._fnName(lid) }));
    }
    // categories named after a function, one per scope; an existing one with the same name is reused.
    // Returns { ids: { scope: category_id }, made: [[scope, category_id]] } (made = created here, for undo)
    async _categories(name, icon, scopes) {
      const ids = {}, made = [];
      for (const scope of scopes || ['automation', 'script', 'helpers']) {
        try {
          const list = await this._ws({ type: 'config/category_registry/list', scope });
          const f = (list || []).find((c) => String(c.name).toLowerCase() === name.toLowerCase());
          if (f) ids[scope] = f.category_id;
          else { ids[scope] = (await this._ws({ type: 'config/category_registry/create', scope, name, icon })).category_id; made.push([scope, ids[scope]]); }
        } catch (e) { /* leave this scope without a category */ }
      }
      return { ids, made };
    }
    // delete categories a step created, unless something else has been filed under them since
    async _dropCategories(made) {
      if (!made || !made.length) return;
      const ents = await this._ws({ type: 'config/entity_registry/list' }).catch(() => null);
      for (const [scope, cid] of made) {
        if (!ents || ents.some((e) => (e.categories || {})[scope] === cid)) continue;
        await this._ws({ type: 'config/category_registry/delete', scope, category_id: cid }).catch(() => {});
      }
    }
    // how many items carry a label right now (fresh from Home Assistant)
    async _labelCount(label) {
      const [ents, devs] = await Promise.all([this._ws({ type: 'config/entity_registry/list' }), this._ws({ type: 'config/device_registry/list' })]);
      return ents.filter((e) => (e.labels || []).includes(label)).length + devs.filter((d) => (d.labels || []).includes(label)).length;
    }
    // Hide from board: the label, its items and the layout all stay; Import > Labels or the name check brings it back
    _hideFunction(label) {
      const name = this._fnName(label), at = this._data.functions.indexOf(label);
      this._takeOff(label);
      this._history({
        label: null, text: T('hide_2', { name }),
        undo: async () => { if (!this._data.functions.includes(label)) this._data.functions.splice(Math.max(0, at), 0, label); this._data.ui.current = label; this._save(); },
        redo: async () => this._takeOff(label),
      });
      this._renderList();
      if (this._data.ui.current) this._open(this._data.ui.current);
      else { this._renderHeader(); this._setEmpty(); }
      this._toast(T('hid_its_label_and_items', { name }), [{ text: T('undo'), fn: () => this._undo() }]);
    }
    _closeModal() { this._$.modal.hidden = true; this._$.modal.innerHTML = ''; this._editing = null; this._arw = null; this._tst = null; }
    // what the board changes in Home Assistant, in this install's mode (also in strings.json and the README)
    _promise() {
      const full = this._full();
      const li = [
        T('creating_a_function_creates_a'),
        T('adding_or_removing_a_piece'),
        T('pause_and_resume_turn_the'),
        T('new_automations_scripts_helpers_and'),
        T('hide_from_board_leaves_the'),
      ];
      if (full) {
        li.push(T('full_manager_is_on_the'));
        li.push(T('ver_promise_full'));
        li.push(T('tests_full_manager_a_helper'));
      } else {
        li.push(T('this_install_is_set_to'));
      }
      li.push(T('the_debugger_watch_triggers_monitor'));
      li.push(T('show_node_red_flows_in'));
      li.push(T('ver_promise'));
      li.push(T('every_change_is_shown_before'));
      li.push(T('privacy_promise'));
      return li;
    }
    /* ---------- diagnostics: a file for an issue or a forum post, made here and handed to the person ----------
       Nothing is sent anywhere. The person chooses anonymised or real names every time (neither is ticked to
       start with, and nothing can be made until one is), and may add a snapshot of the open function as it is
       now and any of its saved versions. */
    async _diagModal(verId) {
      const m = this._$.modal, label = this._data && this._data.ui && this._data.ui.current;
      m.hidden = false;
      let vs = [];
      if (label) { try { vs = await this._verList(label); } catch (e) { vs = []; } }
      const fnName = label ? esc(this._fnName(label)) : '';
      const vrow = (v) => `<label class="chk"><input type="checkbox" name="dver" value="${esc(v.id)}"${v.id === verId ? ' checked' : ''}>${esc(v.name)} <span class="muted">· ${esc(this._verWhen(v.at))}</span></label>`;
      m.innerHTML = `<div class="dlg diag"><h3>${T('diag_h')}</h3><p class="dtext">${T('diag_lead')}</p>`
        + `<h4>${T('diag_names_h')}</h4><label class="chk"><input type="checkbox" name="danon">${T('diag_anon')}</label><label class="chk"><input type="checkbox" name="dreal">${T('diag_real')}</label>`
        + `<div class="hint dwarn" hidden>${T('diag_real_warn')}</div>`
        + `<h4>${T('diag_incl_h')}</h4><p class="muted">${T('diag_always')}</p>`
        + (label ? `<label class="chk"><input type="checkbox" name="dsnap">${T('diag_snap', { fnName })}</label>` : '')
        + (vs.length ? `<div class="dvers"><div class="muted">${T('diag_vers', { fnName })}</div>${vs.slice().reverse().map(vrow).join('')}</div>` : '')
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button data-act="diag-copy" disabled>${T('diag_copy')}</button><button class="primary" data-act="diag-go" disabled>${T('diag_download')}</button></div></div>`;
    }
    async _diagGo(copy) {
      const m = this._$.modal, val = m.querySelector('.dval'), label = this._data && this._data.ui && this._data.ui.current;
      const pick = m.querySelector('input[name="danon"]:checked, input[name="dreal"]:checked');
      if (!pick) { val.textContent = T('diag_choose'); return; }
      const anonymise = pick.name === 'danon', snap = !!(m.querySelector('input[name="dsnap"]') || {}).checked;
      const vids = [...m.querySelectorAll('input[name="dver"]:checked')].map((x) => x.value);
      const btns = m.querySelectorAll('[data-act="diag-go"], [data-act="diag-copy"]');
      btns.forEach((b) => { b.disabled = true; });
      val.textContent = T('diag_making');
      try {
        const msg = { type: 'functions_board/diagnostics', anonymise };
        if (label && (snap || vids.length)) msg.label = label;
        if (label && snap) msg.snapshot = await this._verSnapshot(label);
        if (vids.length) msg.version_ids = vids;
        const text = JSON.stringify(await this._ws(msg), null, 2);
        if (copy) {
          await navigator.clipboard.writeText(text);
          this._toast(T('diag_copied'));
        } else {
          // saved on this device by the browser: a link to the file made here, clicked, then let go
          const day = new Date().toISOString().slice(0, 10), a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          a.download = `functions_board_diagnostics_${day}${anonymise ? '_anonymised' : ''}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          this._toast(T('diag_saved'));
        }
        this._closeModal();
      } catch (e) {
        val.textContent = T('diag_failed', { e: (e && (e.message || e.code)) || e });
        btns.forEach((b) => { b.disabled = false; });
      }
    }
    _aboutModal() {
      const m = this._$.modal;
      m.hidden = false;
      const store = this._storeMode === 'shared' ? T('shared_between_administrators_functions_board') : T('stored_for_your_user_only');
      m.innerHTML = `<div class="dlg about"><h3>${T('functions_board')} <span class="muted">${T('v_prototype', { version: VERSION })}</span></h3><h4>${T('what_it_changes', { extra: this._storeMode === 'shared' ? (this._full() ? T('full_manager') : T('organise_only')) : '' })}</h4><ul>${this._promise().map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h4>${T('where_things_are_kept')}</h4><p>${T('frames_notes_and_positions_are', { store })}</p><h4>${T('how_the_arrows_are_drawn')}</h4><p>${T('from_each_automation_and_script')}</p><h4>${T('diag_about_h')}</h4><p>${T('diag_about_p')}</p><div class="btns">${REPO_URL ? `<a class="lnk" href="${REPO_URL}" target="_blank" rel="noopener">${T('project_page_and_issues')}</a>` : ''}<button data-act="diag"><ha-icon icon="mdi:file-download-outline"></ha-icon>${T('diag_btn')}</button><button data-act="modal-cancel">${T('close')}</button></div></div>`;
    }

    /* ---------- hide and delete (8.2): kept visibly apart, each with its own words ---------- */
    _fnMenu(btn, label) {
      if (this._menuEl && this._menuAnchor === btn) { this._closeMenu(); return; }
      const full = this._full(), off = T('full_manager_only_switch_it');
      this._menu(btn, [
        { act: 'fnm-edit', data: { label }, icon: 'mdi:pencil-outline', text: T('edit_name_icon_colour') },
        { act: 'fnm-hide', data: { label }, icon: 'mdi:eye-off-outline', text: T('hide_from_board'), title: T('the_label_everything_in_it') },
        { sep: true },
        { act: 'fnm-del', data: { label }, icon: 'mdi:label-off-outline', text: T('delete_function_2'), disabled: !full, title: full ? T('deletes_the_label_and_the') : off },
        { act: 'fnm-delall', data: { label }, icon: 'mdi:delete-outline', text: T('delete_function_and_its_items'), disabled: !full, title: full ? T('also_deletes_its_automations_scripts') : off },
      ], this._fnName(label));
    }
    // how one item would be deleted, whether Undo can bring it back, and why not when it can't
    async _howDelete(id) {
      if (id.startsWith('device:')) return { id, name: this._mkNode(id, 'member').name, can: false, undo: false, why: T('devices_are_never_deleted_it') };
      const st = this._hass.states[id];
      const reg = this._entMap.has(id) ? await this._ws({ type: 'config/entity_registry/get', entity_id: id }).catch(() => null) : null;
      const name = (st && st.attributes.friendly_name) || (reg && (reg.name || reg.original_name)) || id;
      const base = { id, name, reg, can: false, undo: false };
      const dom = id.split('.')[0];
      if (['automation', 'script', 'scene'].includes(dom)) {
        const cid = reg && reg.unique_id;
        if (!cid) return Object.assign(base, { why: T('defined_in_yaml_without_an') });
        try {
          const cfg = await this._hass.callApi('GET', `config/${dom}/config/${encodeURIComponent(cid)}`);
          return Object.assign(base, { can: true, undo: true, how: 'config', dom, cid, cfg, where: `${dom}s.yaml` });
        } catch (e) { return Object.assign(base, { why: T('defined_in_yaml_outside_s', { dom }) }); }
      }
      if (HELPER_DOMAINS.has(dom)) {
        const items = await this._ws({ type: dom + '/list' }).catch(() => []);
        const item = reg && (items || []).find((x) => x.id === reg.unique_id);
        if (item) return Object.assign(base, { can: true, undo: true, how: 'collection', dom, item, where: T('helpers_made_in_the_ui') });
        return Object.assign(base, { why: T('defined_in_yaml_configuration_yaml') });
      }
      if (reg && reg.config_entry_id && HELPER_PLATFORMS.has(reg.platform)) {
        const entries = await this._ws({ type: 'config_entries/get', domain: reg.platform }).catch(() => []);
        const entry = (entries || []).find((x) => x.entry_id === reg.config_entry_id);
        const siblings = this._ents.filter((e) => e.config_entry_id === reg.config_entry_id).map((e) => e.entity_id);
        return Object.assign(base, { can: true, undo: false, how: 'entry', entryId: reg.config_entry_id, where: `${reg.platform} helper${entry ? ' "' + entry.title + '"' : ''}`, siblings, why: T('deleting_a_helper_set_up') });
      }
      return Object.assign(base, { why: T('not_an_automation_script_or') });
    }
    // automations and scripts (outside `skip`) whose configs refer to any of these items
    async _usedBy(ids, skip) {
      const want = new Set(ids), out = new Map();
      const all = this._logicIds().filter((e) => !skip.has(e));
      const cfgs = await Promise.all(all.map((e) => this._fetchConfig(e)));
      all.forEach((e, i) => {
        if (!cfgs[i]) return;
        analyze(cfgs[i], e.startsWith('script.'), (x) => this._known(x)).refs.forEach((r) => {
          if (!want.has(r.ref)) return;
          if (!out.has(r.ref)) out.set(r.ref, new Set());
          out.get(r.ref).add(e);
        });
      });
      return out;
    }
    _nameOf(id) { const st = this._hass.states[id], e = this._entMap.get(id); return (st && st.attributes.friendly_name) || (e && (e.name || e.original_name)) || id; }
    _usedHtml(id, used) {
      const u = used.get(id);
      if (!u || !u.size) return '';
      const names = [...u].map((x) => this._nameOf(x));
      return `<div class="dwarn"><ha-icon icon="mdi:alert-outline"></ha-icon>${T('used_by', { count: esc(P('n_automations_and_scripts', u.size)), names: esc(names.slice(0, 4).join(', ')), extra: names.length > 4 ? T('and_more', { n: names.length - 4 }) : '' })}</div>`;
    }
    async _deleteItemDialog(id) {
      if (!this._full()) return;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('delete_3')}</h3><div class="muted">${T('checking_what_uses_it')}</div></div>`;
      const plan = await this._howDelete(id), used = await this._usedBy([id], new Set([id]));
      this._pendingDelete = { kind: 'item', plan: [plan], label: this._data.ui.current };
      const kind = this._tagOf(id).toLowerCase();
      m.innerHTML = `<div class="dlg"><h3>${T('delete_2', { name: esc(plan.name) })}</h3>${plan.can
          ? `<p class="dtext">${T('deletes_this_from_home_assistant', { kind: esc(kind), where: esc(plan.where), extra: plan.how === 'entry' && plan.siblings && plan.siblings.length > 1 ? T('that_also_deletes_the_same', { n: esc(P('n_other_entities', plan.siblings.length - 1)) }) : '' })}</p>${this._usedHtml(id, used)}<p class="dtext ${plan.undo ? '' : 'dno'}">${plan.undo ? T('undo_brings_it_back_with') : esc(T('this_can_t_be_undone', { why: plan.why }))}</p>`
          : `<p class="dtext">${T('the_board_can_t_delete', { why: esc(plan.why) })}</p>`}<div class="btns"><button data-act="modal-cancel">${T('cancel')}</button>${plan.can ? `<button class="danger" data-act="del-go">${T('delete_3')}</button>` : ''}</div></div>`;
    }
    async _deleteFnDialog(label, withItems) {
      if (!this._full()) return;
      const m = this._$.modal, name = this._fnName(label);
      m.hidden = false;
      m.innerHTML = `<div class="dlg wide"><h3>${T('delete_2', { name: esc(name) })}</h3><div class="muted">${T('checking_what_it_contains_and')}</div></div>`;
      await this._loadRegistries();
      const ents = this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id);
      const devs = this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id);
      const L = this._data.layouts[label] || {};
      const cats = await this._fnCategories(label, withItems ? ents : []);
      let plan = [], used = new Map();
      if (withItems) {
        for (const id of ents.concat(devs)) plan.push(await this._howDelete(id));
        used = await this._usedBy(ents, new Set(ents));
      }
      this._pendingDelete = { kind: 'function', label, withItems, plan, cats, ents, devs };
      const box = (L.frames || []).length, notes = (L.notes || []).length;
      const items = withItems ? `<div class="dlist">${plan.map((p, i) => `<label class="drow ${p.can ? '' : 'dcant'}"><input type="checkbox" data-delpick="${i}" ${p.can ? 'checked' : 'disabled'}>`
        + `<span class="tag">${esc(this._tagOf(p.id))}</span><span class="mn"><b>${esc(p.name)}</b><small>${esc(p.id.startsWith('device:') ? 'device' : p.id)}${p.can ? (p.undo ? '' : T('can_t_be_undone')) : ' · ' + esc(p.why)}</small>${this._usedHtml(p.id, used)}</span></label>`).join('')}</div>` : '';
      const catLine = cats.length ? `<label class="chk"><input type="checkbox" data-delcats ${cats.every((c) => c.free) ? 'checked' : ''}>${T('also_delete_the_named', { count: esc(P('n_categories', cats.length)), name: esc(name), cats: esc(cats.map((c) => c.scope === 'helpers' ? 'helpers' : c.scope + 's').join(', ')), extra: cats.some((c) => !c.free) ? T('other_items_are_filed_there') : withItems ? '' : T('only_this_function_s_items') })}</label>` : '';
      m.innerHTML = `<div class="dlg wide"><h3>${T('delete_2', { name: esc(name) })}</h3><p class="dtext">${T('deletes_the_label')} <b>${esc(name)}</b>${T('home_assistant_removes_it_from', { n: esc(P('n_items', ents.length + devs.length)), extra: withItems ? '' : T('the_items_themselves_stay_where') })}</p><p class="dtext">${T('deletes_the_board_s_layout', { extra: box ? ', ' + P('n_frames', box) : '', extra2: notes ? ', ' + P('n_notes', notes) : '' })}</p>${withItems ? `<p class="dtext">${T('deletes_these_from_home_assistant')}</p>${items}` : ''}${catLine}<p class="dtext">${withItems && plan.some((p) => p.can && !p.undo) ? T('undo_brings_back_the_function') : T('undo_brings_it_all_back')}</p><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="danger" data-act="del-go">${withItems ? T('delete_function_and_items') : T('delete_function')}</button></div></div>`;
    }
    // the function's own categories, and whether anything outside `ids` is filed under them
    async _fnCategories(label, ids) {
      const L = this._data.layouts[label] || {}, cats = L.categories || {}, out = [];
      const name = this._fnName(label).toLowerCase();
      for (const scope of ['automation', 'script', 'helpers']) {
        let cid = cats[scope];
        const list = await this._ws({ type: 'config/category_registry/list', scope }).catch(() => []);
        const c = (list || []).find((x) => x.category_id === cid) || (list || []).find((x) => String(x.name).toLowerCase() === name);
        if (!c) continue;
        cid = c.category_id;
        const inIt = this._ents.filter((e) => (e.categories || {})[scope] === cid);
        const mine = inIt.filter((e) => (e.labels || []).includes(label) || ids.includes(e.entity_id));
        out.push({ scope, id: cid, name: c.name, icon: c.icon || null, members: inIt.map((e) => e.entity_id), free: inIt.length === mine.length });
      }
      return out;
    }
    async _deleteGo() {
      const d = this._pendingDelete, m = this._$.modal;
      if (!d) return;
      const go = m.querySelector('[data-act="del-go"]');
      if (go) { go.disabled = true; go.textContent = T('deleting'); }
      if (d.kind === 'function') {
        const picks = new Set([...m.querySelectorAll('[data-delpick]:checked')].map((x) => +x.dataset.delpick));
        d.plan = d.plan.filter((p, i) => p.can && picks.has(i));
        d.dropCats = !!(m.querySelector('[data-delcats]') && m.querySelector('[data-delcats]').checked);
      }
      this._pendingDelete = null;
      try {
        if (d.kind === 'item') await this._runItemDelete(d);
        else await this._runFnDelete(d);
      } catch (e) { this._toast(T('could_not_delete_2', { message: e.message || e.code || e })); }
      this._closeModal();
    }
    async _deleteItems(plan) {
      const done = [], failed = [];
      for (const p of plan) {
        if (!p.can) continue;
        try {
          if (p.how === 'config') await this._hass.callApi('DELETE', `config/${p.dom}/config/${encodeURIComponent(p.cid)}`);
          else if (p.how === 'collection') await this._ws({ type: p.dom + '/delete', [p.dom + '_id']: p.item.id });
          else if (p.how === 'entry') await this._hass.callApi('DELETE', `config/config_entries/entry/${p.entryId}`);
          done.push(p);
        } catch (e) { failed.push(p.name + ': ' + (e.message || e.code || e)); }
      }
      return { done, failed };
    }
    // wait until an entity's registry entry exists (Home Assistant creates it shortly after the config)
    async _waitEntity(test, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const ents = await this._ws({ type: 'config/entity_registry/list' }).catch(() => []);
        const e = ents.find(test);
        if (e) return e;
        await new Promise((r) => setTimeout(r, 300));
      }
      return null;
    }
    // put deleted items back, with their registry settings (name, icon, labels, area, categories, entity id)
    async _restoreItems(done) {
      const back = [];
      for (const p of done) {
        if (!p.undo) continue;
        let e = null;
        if (p.how === 'config') {
          await this._hass.callApi('POST', `config/${p.dom}/config/${encodeURIComponent(p.cid)}`, p.cfg);
          e = await this._waitEntity((x) => x.platform === p.dom && x.unique_id === p.cid);
        } else if (p.how === 'collection') {
          const settings = Object.assign({}, p.item);
          delete settings.id;
          const made = await this._ws(Object.assign({ type: p.dom + '/create' }, settings));
          e = await this._waitEntity((x) => x.platform === p.dom && x.unique_id === made.id);
          p.item = made;
        }
        if (!e) continue;
        const r = p.reg || {}, msg = { type: 'config/entity_registry/update', entity_id: e.entity_id, name: r.name || null, icon: r.icon || null, area_id: r.area_id || null, labels: r.labels || [], categories: r.categories || {} };
        if (e.entity_id !== p.id) msg.new_entity_id = p.id;
        await this._ws(msg).catch(() => this._ws(Object.assign(msg, { new_entity_id: undefined })));
        back.push(p);
      }
      return back;
    }
    async _runItemDelete(d) {
      const p = d.plan[0], label = d.label;
      const { done, failed } = await this._deleteItems(d.plan);
      if (!done.length) { this._toast(T('could_not_delete', { failed: failed.join('; ') })); return; }
      if (this._model && this._model.nodes.has(p.id)) this._select(null);
      this._history({
        label, text: T('delete', { name: p.name }),
        check: async (dir) => dir !== 'undo' || !this._hass.states[p.id],
        undo: async () => { await this._restoreItems(done); },
        redo: async () => {
          const again = await this._howDelete(p.id);
          if (again.can) { const r = await this._deleteItems([again]); done.splice(0, done.length, ...r.done); }
        },
      });
      this._cfgCache.clear();
      this._toast(T('deleted_2', { name: p.name }), p.undo ? [{ text: T('undo'), fn: () => this._undo() }] : []);
    }
    async _runFnDelete(d) {
      const label = d.label, lab = this._labelMap.get(label), name = lab ? lab.name : label;
      const keep = { name, icon: lab && lab.icon, color: lab && lab.color, description: lab && lab.description };
      const layout = this._data.layouts[label] ? JSON.parse(JSON.stringify(this._data.layouts[label])) : null;
      const pos = this._data.functions.indexOf(label);
      const areas = (await this._ws({ type: 'config/area_registry/list' }).catch(() => [])).filter((a) => (a.labels || []).includes(label)).map((a) => a.area_id);
      const st = { label, ents: d.ents, devs: d.devs, areas, cats: d.dropCats ? d.cats : [], items: [] };
      // 1. the items, when asked
      if (d.withItems && d.plan.length) {
        const r = await this._deleteItems(d.plan);
        st.items = r.done;
        if (r.failed.length) this._toast(T('some_items_could_not_be', { failed: r.failed.join('; ') }));
      }
      // 2. the categories (Home Assistant un-files whatever is still in them)
      for (const c of st.cats) await this._ws({ type: 'config/category_registry/delete', scope: c.scope, category_id: c.id }).catch(() => {});
      // 3. the label (Home Assistant takes it off every entity, device and area) and the layout
      await this._ws({ type: 'config/label_registry/delete', label_id: label });
      this._takeOff(label);
      delete this._data.layouts[label];
      this._save();
      this._history({
        label: null, text: T('delete', { name }),
        check: async (dir) => dir !== 'undo' || !(await this._ws({ type: 'config/label_registry/list' })).some((l) => String(l.name).toLowerCase() === name.toLowerCase()),
        undo: async () => {
          const msg = { type: 'config/label_registry/create', name: keep.name, icon: keep.icon || 'mdi:puzzle-outline' };
          if (keep.color) msg.color = keep.color;
          if (keep.description) msg.description = keep.description;
          const nl = await this._ws(msg);
          const newId = nl.label_id;
          const back = await this._restoreItems(st.items);
          // categories come back with the same names; whatever was filed there is filed again
          const catIds = {};
          for (const c of st.cats) {
            const made = await this._ws({ type: 'config/category_registry/create', scope: c.scope, name: c.name, icon: c.icon || undefined }).catch(() => null);
            if (!made) continue;
            catIds[c.scope] = made.category_id;
            for (const id of c.members) await this._ws({ type: 'config/entity_registry/update', entity_id: id, categories: { [c.scope]: made.category_id } }).catch(() => {});
          }
          const deleted = new Set(st.items.map((p) => p.id).filter((id) => !back.some((p) => p.id === id)));
          for (const id of st.ents) {
            if (deleted.has(id)) continue;
            const r = await this._ws({ type: 'config/entity_registry/get', entity_id: id }).catch(() => null);
            if (r) await this._ws({ type: 'config/entity_registry/update', entity_id: id, labels: [...new Set((r.labels || []).concat([newId]))] }).catch(() => {});
          }
          await this._loadRegistries();
          for (const did of st.devs) {
            const dev = this._devMap.get(did.slice(7));
            if (dev) await this._ws({ type: 'config/device_registry/update', device_id: dev.id, labels: [...new Set((dev.labels || []).concat([newId]))] }).catch(() => {});
          }
          for (const aid of st.areas) {
            const a = (await this._ws({ type: 'config/area_registry/list' })).find((x) => x.area_id === aid);
            if (a) await this._ws({ type: 'config/area_registry/update', area_id: aid, labels: [...new Set((a.labels || []).concat([newId]))] }).catch(() => {});
          }
          if (layout) { const L = cleanLayout(layout); if (Object.keys(catIds).length) L.categories = Object.assign({}, L.categories || {}, catIds); this._data.layouts[newId] = L; }
          if (!this._data.functions.includes(newId)) this._data.functions.splice(Math.max(0, pos), 0, newId);
          this._data.ui.current = newId;
          st.label = newId;
          this._save();
        },
        redo: async () => {
          await this._loadRegistries();
          const items = st.items.length ? await Promise.all(st.items.map((p) => this._howDelete(p.id))) : [];
          const cats = st.cats.length ? await this._fnCategories(st.label, []) : [];
          await this._runFnDeleteQuiet(st.label, items.filter((p) => p.can), cats);
        },
      });
      await this._loadRegistries();
      this._renderList();
      if (this._data.ui.current) this._open(this._data.ui.current); else { this._model = null; this._clearWorld(); this._renderHeader(); this._setEmpty(); }
      this._toast(T('deleted', { name, extra: st.items.length ? T('and', { count: P('n_items', st.items.length) }) : '' }), [{ text: T('undo'), fn: () => this._undo() }]);
    }
    async _runFnDeleteQuiet(label, items, cats) {
      if (items.length) await this._deleteItems(items);
      for (const c of cats) await this._ws({ type: 'config/category_registry/delete', scope: c.scope, category_id: c.id }).catch(() => {});
      await this._ws({ type: 'config/label_registry/delete', label_id: label }).catch(() => {});
      this._takeOff(label);
      delete this._data.layouts[label];
      this._save();
    }

    /* ---------- types ---------- */
    _scopeOf(id) {
      const d = id.split('.')[0];
      if (d === 'automation') return 'automation';
      if (d === 'script') return 'script';
      const reg = this._entMap.get(id);
      if (HELPER_DOMAINS.has(d) || (reg && HELPER_PLATFORMS.has(reg.platform))) return 'helpers';
      return null;
    }
    _tagOf(key) {
      if (key.startsWith('device:')) return T('device');
      if (key.startsWith('svc:')) return T('action');
      if (key.startsWith('event:')) return T('event');
      if (key.startsWith('mqtt:')) return T('mqtt');
      if (key.startsWith('nact:')) return T('button');
      if (key.startsWith('nr:')) return T('node_red');
      if (TGT_RE.test(key)) return TYPE[key.slice(0, key.indexOf(':'))];
      const s = this._scopeOf(key);
      if (s === 'automation') return T('automation');
      if (s === 'script') return T('script');
      if (s === 'helpers') return T('helper');
      const d = key.split('.')[0];
      return TYPE[d] || d.replace(/_/g, ' ');
    }
    _countText(ids) {
      const c = { a: 0, s: 0, h: 0, o: 0 };
      ids.forEach((id) => { const t = this._scopeOf(id); if (t === 'automation') c.a++; else if (t === 'script') c.s++; else if (t === 'helpers') c.h++; else c.o++; });
      const p = [];
      if (c.a) p.push(P('n_automations', c.a));
      if (c.s) p.push(P('n_scripts', c.s));
      if (c.h) p.push(P('n_helpers', c.h));
      if (c.o) p.push(c.o + ' other');
      return p.join(' · ');
    }

    /* ---------- import manager: detected functions, labels, pick items ---------- */
    _openManager(tab, target) {
      if (!this._mgr) {
        this._mgr = { tab: 'detect', cands: null, scanning: false, expanded: new Set(), sel: new Set(), lsel: new Set(), cats: true, busy: false, target: null, newName: '', q: '', ptype: 'all', pshow: 200, pdiag: false };
      }
      const g = this._mgr;
      g.tab = tab || g.tab;
      // Pick items adds to the function on screen: every opening starts from it, never from an earlier visit
      g.target = target || this._data.ui.current || '__new';
      if (g.target !== '__new' && !this._data.functions.includes(g.target)) g.target = '__new';
      this._pick = new Set();
      this._renderManager();
      if (g.tab === 'detect' && !g.cands && !g.scanning) this._scanFunctions();
    }
    _renderManager() {
      const g = this._mgr, m = this._$.modal;
      if (!g) return;
      const old = m.querySelector('.mbody'), top = old ? old.scrollTop : 0;
      m.hidden = false;
      const tabs = [['detect', T('detected_functions')], ['labels', T('labels')], ['pick', T('pick_items')]];
      const body = g.tab === 'detect' ? this._mgrDetect() : g.tab === 'labels' ? this._mgrLabels() : this._mgrPick();
      m.innerHTML = `<div class="dlg mgr"><div class="mhead"><h3>${T('import_2')}</h3><div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${g.tab === k ? 'on' : ''}" data-act="mgr-tab" data-tab="${k}">${t}</button>`).join('')}</div><button class="ib" data-act="modal-cancel" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="mbody">${body}</div><div class="mfoot">${this._mgrFoot()}</div></div>`;
      const nb = m.querySelector('.mbody');
      if (nb && g.tab === g.lastTab) nb.scrollTop = top;
      g.lastTab = g.tab;
      if (g.tab === 'pick') {
        const s = m.querySelector('.search');
        if (s) { s.value = g.q || ''; setTimeout(() => s.focus(), 30); }
        this._renderPicks(g.q || '');
      }
    }
    _mgrFoot() {
      const g = this._mgr;
      if (g.tab === 'detect') {
        const avail = (g.cands || []).filter((c) => !(c.fn && !c.missing.length)).length, n = g.sel.size;
        return `<label class="chk mcats"><input type="checkbox" data-mcats ${g.cats ? 'checked' : ''}>${T('file_imported_pieces_under_a')}</label><label class="chk mcats"><input type="checkbox" data-mdev ${g.devices ? 'checked' : ''}>${T('also_join_automations_that_meet')}</label><span class="cnt">${g.cands ? T('of_selected', { n, avail }) : ''}</span><button data-act="mgr-rescan" ${g.scanning || g.busy ? 'disabled' : ''}>${T('rescan')}</button><button data-act="mgr-selall" ${avail && !g.busy ? '' : 'disabled'}>${n && n === avail ? T('select_none') : T('select_all')}</button><button class="primary" data-act="mgr-import-sel" ${n && !g.busy ? '' : 'disabled'}>${g.busy ? T('importing_2') : T('import_selected')}</button>`;
      }
      if (g.tab === 'labels') {
        const n = g.lsel.size;
        return `<span class="cnt">${n ? n + ' selected' : T('none_selected')}</span><button class="primary" data-act="mgr-labels-add" ${n ? '' : 'disabled'}>${T('add_as_functions_2')}</button>`;
      }
      const n = this._pick.size, to = g.target === '__new' ? (String(g.newName || '').trim() || T('a_new_function')) : this._fnName(g.target);
      return `<span class="cnt">${n ? n + ' selected' : T('none_selected')}</span><button class="primary" data-act="mgr-pick-add" ${n ? '' : 'disabled'}>${n ? T('add_to_4', { n: esc(P('n_items', n)), to: esc(to) }) : T('add')}</button>`;
    }
    _mgrFootRefresh() { const f = this._$.modal.querySelector('.mfoot'); if (f && this._mgr) f.innerHTML = this._mgrFoot(); }

    _mgrDetect() {
      const g = this._mgr;
      if (g.scanning) return `<div class="muted pad">${T('tracing_every_automation_and_script')}</div>`;
      if (g.error) return `<div class="muted pad">${T('the_scan_failed', { error: esc(g.error) })}</div>`;
      if (!g.cands) return '';
      if (!g.cands.length) return `<div class="muted pad">${T('no_groups_found_groups_show')}</div>`;
      const s = g.stats, cv = s.cover;
      return `<div class="hint mintro"><b>${T('of_and_of_are_in', { a: cv.a[0], a2: P('n_automations', cv.a[1]), s: cv.s[0], s2: P('n_scripts', cv.s[1]) })}</b> ${T('traced_and_each_group_below', { automations: P('n_automations', s.automations), scripts: P('n_scripts', s.scripts) })}</div>${g.cands.map((c, i) => this._candHTML(c, i)).join('')}${this._leftHTML()}`;
    }
    // automations and scripts in no group and no function, each two clicks from a function (3.2)
    _leftHTML() {
      const g = this._mgr, left = g.left || [];
      if (!left.length) return '';
      const open = !!g.leftOpen;
      return `<div class="cand left"><div class="crow"><ha-icon icon="mdi:help-circle-outline"></ha-icon><span class="cname static">${T('not_in_any_function')}</span><span class="ccount">${esc(this._countText(left))}</span><span class="csrc">${T('no_wiring_or_category_ties')}</span><button class="ib" data-act="mgr-left" title="${open ? T('hide') : T('show')} them"><ha-icon icon="${open ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon></button></div>${open ? `<div class="cmem">${left.map((id) => `<div class="lrow2"><span class="tag">${esc(this._tagOf(id))}</span><span class="mn"><b>${esc(this._nameOf(id))}</b><small>${esc(id)}</small></span><button class="chip" data-act="left-add" data-id="${esc(id)}" ${this._canLabel(id) ? '' : `disabled title="${T('no_unique_id_add_id_2')}"`}>${T('add_to_3')}</button><button class="chip" data-act="left-new" data-id="${esc(id)}" ${this._canLabel(id) ? '' : 'disabled'}>${T('new_function_from_this')}</button></div>`).join('')}</div>` : ''}</div>`;
    }
    _leftAddMenu(btn, id) {
      if (!this._data.functions.length) { this._leftNew(id); return; }
      this._menu(btn, this._data.functions.map((l) => ({ act: 'left-to', data: { id, label: l }, icon: (this._labelMap.get(l) || {}).icon || 'mdi:puzzle-outline', text: this._fnName(l) })), T('add_to_2'));
      // the manager is a modal: show the menu above it
      if (this._menuEl) this._menuEl.style.zIndex = 40;
    }
    async _leftTo(id, label) {
      this._closeMenu();
      const r = await this._labelMany([id], label, this._mgr ? this._mgr.cats : true);
      if (!r.done.length) { this._toast(T('could_not_add_2', { why: (r.skipped[0] || {}).why })); return; }
      this._mgr.left = this._mgr.left.filter((x) => x !== id);
      this._renderManager();
      this._toast(T('added_to_2', { nameOf: this._nameOf(id), fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }, { text: T('go_there'), fn: () => { this._closeModal(); this._open(label); } }]);
    }
    async _leftNew(id) {
      const g = this._mgr, base = this._suggestName([id]);
      let name = base;
      for (let k = 2; this._labels.some((l) => String(l.name).toLowerCase() === name.toLowerCase()); k++) name = base + ' ' + k;
      try {
        const r = await this._importGroup(name, this._pickIcon([id]), 'indigo', [id], g ? g.cats : true);
        if (g) g.left = g.left.filter((x) => x !== id);
        await this._loadRegistries();
        this._renderList();
        this._renderManager();
        this._toast(T('created', { name }), [{ text: T('undo'), fn: () => this._undo() }, { text: T('go_there'), fn: () => { this._closeModal(); this._open(r.label); } }]);
      } catch (e) { this._toast(T('could_not_create', { message: e.message || e.code })); }
    }
    _candHTML(c, i) {
      const g = this._mgr, open = g.expanded.has(i), done = c.fn && !c.missing.length, lock = !!c.fn || g.busy;
      const src = { category: T('from_a_category'), wiring: T('from_the_wiring'), both: T('category_wiring'), function: T('on_the_board_2') }[c.source] || '';
      const over = c.overlap && c.overlap.length ? c.overlap.slice(0, 2).map((o) => T('already_in_2', { n: o.n, fnName: esc(this._fnName(o.l)) })).join(' · ') : '';
      let act;
      if (done) act = `<span class="onb">${T('on_the_board')}</span>`;
      else if (c.fn) act = `<button class="go" data-act="mgr-import-one" data-ci="${i}" ${g.busy ? 'disabled' : ''} title="${T('label_the_pieces_that_aren', { name: esc(c.name) })}">${T('add_missing', { count: c.missing.length })}</button>`;
      else act = `<button class="go" data-act="mgr-import-one" data-ci="${i}" ${g.busy ? 'disabled' : ''}>${T('import_2')}</button>`;
      return `<div class="cand ${done ? 'done' : ''}"><div class="crow"><input type="checkbox" data-csel="${i}" ${g.sel.has(i) ? 'checked' : ''} ${done || g.busy ? 'disabled' : ''} title="${T('select_for_import_selected')}"><ha-icon icon="${esc(c.icon)}"></ha-icon><input class="cname" data-cname="${i}" value="${esc(c.name)}" ${lock ? 'disabled' : ''} title="${c.fn ? T('already_a_function') : T('function_name_click_to_rename')}"><span class="ccount">${esc(this._countText(c.members.filter((id) => c.keep.has(id))))}${c.fn && c.missing.length ? T('not_in_it_yet', { count: c.missing.length }) : ''}</span>${over ? `<span class="csrc">${over}</span>` : ''}<span class="csrc">${src}</span><button class="ib" data-act="mgr-expand" data-ci="${i}" title="${T('the_pieces', { extra: open ? T('hide') : T('show') })}"><ha-icon icon="${open ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon></button>${act}</div>${open ? `<div class="cmem">${c.members.map((id) => this._memRow(i, c, id)).join('')}</div>` : ''}</div>`;
    }
    _memRow(i, c, id) {
      const st = this._hass.states[id], e = this._entMap.get(id), can = this._canLabel(id);
      const name = (st && st.attributes.friendly_name) || (e && (e.name || e.original_name)) || id;
      const other = ((e && e.labels) || []).filter((l) => this._data.functions.includes(l)).map((l) => this._fnName(l));
      const inFn = c.fn && can && !c.missing.includes(id);
      return `<label class="mrow ${can ? '' : 'nolab'}"><input type="checkbox" data-cmem="${i}" data-id="${esc(id)}" ${can && c.keep.has(id) ? 'checked' : ''} ${inFn || !can ? 'disabled' : ''}>`
        + `<span class="tag">${esc(this._tagOf(id))}</span><span class="mn"><b>${esc(name)}</b>`
        + `<small>${esc(id)}${can ? '' : T('can_t_be_added_no')}${other.length ? ` ${T('already_in', { other: esc(other.join(', ')) })}` : ''}</small></span></label>`;
    }
    // only items in the entity or device registry can carry a label (a YAML automation without id: can't)
    _canLabel(id) { return id.startsWith('device:') || this._entMap.has(id); }

    async _scanFunctions() {
      const g = this._mgr;
      g.scanning = true; g.error = null; g.sel = new Set(); g.expanded = new Set();
      this._renderManager();
      try {
        await this._loadRegistries();
        const ids = this._logicIds();
        const cfgs = await Promise.all(ids.map((e) => this._fetchConfig(e)));
        const an = ids.map((id, i) => (cfgs[i] ? analyze(cfgs[i], id.startsWith('script.'), (x) => this._known(x)) : null));
        await this._resolveTargets(an.flatMap((a) => (a ? a.refs.map((r) => r.ref).filter((r) => TGT_RE.test(r)) : [])));
        const roles = new Map();
        ids.forEach((id, i) => {
          if (!an[i]) return;
          const m = new Map(), put = (ref, role) => { if (ref === id) return; if (!m.has(ref)) m.set(ref, new Set()); m.get(ref).add(role); };
          // an area, floor or label target groups by the entities it covers, not the target itself (2.2)
          an[i].refs.forEach((r) => { if (TGT_RE.test(r.ref)) this._targetEntities(r.ref, r).forEach((e) => put(e, r.role)); else put(r.ref, r.role); });
          roles.set(id, m);
        });
        const cats = await this._catGroups();
        g.roles = roles; g.catList = cats; g.ids = ids;
        this._mgrRecluster();
      } catch (e) { g.error = (e && (e.message || e.code)) || String(e); g.cands = null; }
      g.scanning = false;
      if (this._mgr === g && !this._$.modal.hidden && this._$.modal.querySelector('.mgr')) this._renderManager();
    }
    _mgrRecluster() {
      const g = this._mgr, ids = g.ids;
      g.cands = this._cluster(g.roles, g.catList, { devices: !!g.devices });
      // what ended up in no group and no function (3.2)
      const fset = new Set(this._data.functions), grouped = new Set(g.cands.flatMap((c) => c.members));
      const inFn = (id) => ((this._entMap.get(id) || {}).labels || []).some((l) => fset.has(l));
      g.left = ids.filter((id) => !grouped.has(id) && !inFn(id)).sort((x, y) => this._nameOf(x).localeCompare(this._nameOf(y)));
      const count = (pre) => { const all = ids.filter((x) => x.startsWith(pre)); return [all.length - all.filter((x) => g.left.includes(x)).length, all.length]; };
      g.stats = { automations: ids.filter((x) => x.startsWith('automation.')).length, scripts: ids.filter((x) => x.startsWith('script.')).length, cover: { a: count('automation.'), s: count('script.') } };
    }
    async _catGroups() {
      const scopes = ['automation', 'script', 'helpers'];
      const lists = await Promise.all(scopes.map((s) => this._ws({ type: 'config/category_registry/list', scope: s }).catch(() => [])));
      const byId = new Map();
      scopes.forEach((s, i) => (lists[i] || []).forEach((c) => byId.set(s + ':' + c.category_id, c)));
      const byName = new Map();
      this._ents.forEach((e) => Object.entries(e.categories || {}).forEach(([scope, cid]) => {
        const c = byId.get(scope + ':' + cid);
        if (!c) return;
        const k = String(c.name).toLowerCase();
        if (!byName.has(k)) byName.set(k, { name: c.name, icon: c.icon || null, members: new Set() });
        byName.get(k).members.add(e.entity_id);
      }));
      return [...byName.values()];
    }
    _cluster(roles, cats, opt = {}) {
      // Glue = helpers and scripts. Two pieces belong together when one triggers on, changes or calls the
      // other; helpers only read as conditions don't join groups (mode flags), and helpers/scripts that a
      // lot of automations drive are treated as shared hubs.
      const isGlue = (id) => !id.includes(':') && (id.startsWith('script.') || this._scopeOf(id) === 'helpers');
      const causal = new Map(), reads = new Map();
      roles.forEach((m, L) => m.forEach((rs, ref) => {
        if (!isGlue(ref)) return;
        const map = [...rs].some((r) => r !== 'condition') ? causal : reads;
        if (!map.has(ref)) map.set(ref, new Set());
        map.get(ref).add(L);
      }));
      const hub = (gl) => { const n = causal.has(gl) ? causal.get(gl).size : 0; return gl.startsWith('script.') ? n > 6 : n > 12; };
      const parent = new Map();
      const find = (x) => {
        if (!parent.has(x)) parent.set(x, x);
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r);
        while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; }
        return r;
      };
      const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
      roles.forEach((_, L) => find(L));
      // Category fences: when a shared helper/script links automations you filed under different categories,
      // it only joins the side whose category it belongs to (plus uncategorised pieces). Your own organisation
      // decides where one system ends and the next begins; wiring fills in everything you haven't filed.
      const catOf = new Map();
      cats.forEach((c) => c.members.forEach((id) => catOf.set(id, String(c.name).toLowerCase())));
      causal.forEach((Ls, gl) => {
        if (hub(gl)) return;
        const byCat = new Map();
        Ls.forEach((L) => { const c = catOf.get(L) || ''; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(L); });
        const named = [...byCat.keys()].filter(Boolean);
        if (named.length < 2) { Ls.forEach((L) => union(L, gl)); return; }
        const own = catOf.get(gl) || named.sort((x, y) => byCat.get(y).length - byCat.get(x).length)[0];
        (byCat.get(own) || []).concat(byCat.get('') || []).forEach((L) => union(L, gl));
      });
      if (opt.devices) {
        // a device entity that one or two pieces change and one or two trigger on joins them, like the kitchen
        // light the morning routine turns on and the kitchen speaker automation starts from (3.3)
        const changers = new Map(), triggers = new Map();
        const put = (m, k, L) => (m.get(k) || m.set(k, new Set()).get(k)).add(L);
        roles.forEach((m, L) => m.forEach((rs, ref) => {
          if (isGlue(ref) || ref.includes(':') || /^(automation|script)\./.test(ref)) return;
          if (rs.has('action')) put(changers, ref, L);
          if (rs.has('trigger')) put(triggers, ref, L);
        }));
        changers.forEach((cs, ref) => {
          const ts = triggers.get(ref);
          if (!ts || cs.size > 2 || ts.size > 2) return;
          const all = [...new Set([...cs, ...ts])];
          if (all.length < 2) return;
          const byCat = new Map();
          all.forEach((L) => { const c = catOf.get(L) || ''; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(L); });
          const named = [...byCat.keys()].filter(Boolean);
          const join = named.length < 2 ? all : (byCat.get(named.sort((x, y) => byCat.get(y).length - byCat.get(x).length)[0]) || []).concat(byCat.get('') || []);
          for (let i = 1; i < join.length; i++) union(join[0], join[i]);
        });
      }
      const comps = new Map();
      [...parent.keys()].forEach((x) => { const r = find(x); if (!comps.has(r)) comps.set(r, new Set()); comps.get(r).add(x); });
      const wiring = [...comps.values()].filter((s) => s.size >= 2 && [...s].some((id) => id.startsWith('automation.')));
      reads.forEach((Ls, gl) => {
        if (causal.has(gl)) return;
        const owners = new Set([...Ls].map((L) => find(L)));
        if (owners.size !== 1) return;
        const w = wiring.find((s) => s.has([...Ls][0]));
        if (w) w.add(gl);
      });
      // a lone automation that only checks helpers belonging to one group (and few others check them) joins it,
      // e.g. "notify when the filter counter reaches 0"; mode flags checked by many automations don't pull anything in
      const groupOf = (id) => wiring.find((s) => s.has(id));
      roles.forEach((m, L) => {
        if (!L.startsWith('automation.') || groupOf(L)) return;
        const rd = [...m.entries()].filter(([ref, rs]) => isGlue(ref) && [...rs].every((r) => r === 'condition')).map(([ref]) => ref);
        if (!rd.length) return;
        const gs = new Set(rd.map((ref) => groupOf(ref)));
        if (gs.size !== 1 || gs.has(undefined)) return;
        if (rd.some((ref) => (reads.get(ref) || new Set()).size > 3)) return;
        [...gs][0].add(L);
      });
      const fset = new Set(this._data.functions);
      const fnOf = (id) => { const e = this._entMap.get(id); return ((e && e.labels) || []).filter((l) => fset.has(l)); };
      // 1. wiring groups that are mostly an existing function become that function (with any missing pieces)
      const out = [], fnOut = new Map(), rest = [];
      wiring.forEach((w) => {
        const tally = new Map();
        w.forEach((id) => fnOf(id).forEach((l) => tally.set(l, (tally.get(l) || 0) + 1)));
        let best = null, bn = 0;
        tally.forEach((n, l) => { if (n > bn) { bn = n; best = l; } });
        if (best && bn >= w.size / 2) {
          if (!fnOut.has(best)) { const o = { fn: best, members: new Set(), source: 'function' }; fnOut.set(best, o); out.push(o); }
          w.forEach((id) => fnOut.get(best).members.add(id));
        } else rest.push(w);
      });
      fnOut.forEach((o, l) => this._ents.forEach((e) => { if ((e.labels || []).includes(l)) o.members.add(e.entity_id); }));
      // 2. remaining wiring groups merge with the category they mostly sit in
      const catC = cats.filter((c) => c.members.size >= 2 && [...c.members].some((id) => id.startsWith('automation.') || id.startsWith('script.')));
      const catOut = new Map();
      rest.forEach((w) => {
        let bi = -1, bestOv = 0;
        catC.forEach((c, ci) => { let ov = 0; w.forEach((id) => { if (c.members.has(id)) ov++; }); if (ov > bestOv) { bestOv = ov; bi = ci; } });
        if (bi >= 0 && (bestOv >= w.size / 2 || bestOv >= catC[bi].members.size / 2)) {
          if (catOut.has(bi)) { const o = catOut.get(bi); w.forEach((id) => o.members.add(id)); }
          else { const c = catC[bi], o = { name: c.name, cat: c.name, icon: c.icon, members: new Set([...c.members, ...w]), source: 'both' }; catOut.set(bi, o); out.push(o); }
        } else out.push({ name: null, icon: null, members: w, source: 'wiring' });
      });
      catC.forEach((c, ci) => { if (!catOut.has(ci)) out.push({ name: c.name, cat: c.name, icon: c.icon, members: new Set(c.members), source: 'category' }); });
      // 3. finalize: names, icons, which existing function a group already is, what overlaps
      const names = new Set(this._data.functions.map((l) => this._fnName(l).toLowerCase()));
      const rank = (id) => { const t = this._scopeOf(id); return t === 'automation' ? 0 : t === 'script' ? 1 : t === 'helpers' ? 2 : 3; };
      const can = (id) => this._canLabel(id);
      const res = out.map((o) => {
        const members = [...o.members].filter((id) => this._hass.states[id] || this._entMap.has(id)).sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
        const tally = new Map();
        members.forEach((id) => fnOf(id).forEach((l) => tally.set(l, (tally.get(l) || 0) + 1)));
        let fn = o.fn || null;
        if (!fn) tally.forEach((n, l) => { if (!fn && n >= members.length * 0.8) fn = l; });
        if (!fn && o.name) this._data.functions.forEach((l) => { if (!fn && this._fnName(l).toLowerCase() === o.name.toLowerCase()) fn = l; });
        const missing = fn ? members.filter((id) => can(id) && !fnOf(id).includes(fn)) : [];
        let name;
        if (fn) name = this._fnName(fn);
        else {
          name = o.name || this._suggestName(members);
          const base = name;
          for (let k = 2; names.has(name.toLowerCase()); k++) name = base + ' ' + k;
          names.add(name.toLowerCase());
        }
        const lab = fn ? this._labelMap.get(fn) : null;
        return {
          name, cat: o.cat || null, fn, missing, members, keep: new Set(members.filter(can)), source: fn && o.source === 'function' ? 'function' : o.source,
          icon: (lab && lab.icon) || o.icon || this._pickIcon(members),
          overlap: fn ? [] : [...tally.entries()].map(([l, n]) => ({ l, n })).sort((x, y) => y.n - x.n),
        };
      });
      // groups that turn out to be the same existing function (wiring + category) merge into one row
      const byFn = new Map();
      let list = [];
      res.forEach((c) => {
        if (!c.fn) { list.push(c); return; }
        const t = byFn.get(c.fn);
        if (!t) { byFn.set(c.fn, c); list.push(c); return; }
        c.members.forEach((id) => { if (!t.members.includes(id)) { t.members.push(id); if (can(id)) t.keep.add(id); } });
        t.members.sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
        t.missing = t.members.filter((id) => can(id) && !fnOf(id).includes(t.fn));
      });
      list = list.filter((c) => c.members.length >= 2);
      const order = (c) => (!c.fn ? 0 : c.missing.length ? 1 : 2);
      list.sort((x, y) => order(x) - order(y) || y.members.length - x.members.length);
      // identity colours only: red, orange, amber and yellow are kept for alarm and warning states
      const SAFE = ['indigo', 'teal', 'purple', 'blue', 'green', 'cyan', 'deep-purple', 'light-blue', 'light-green', 'pink', 'brown', 'blue-grey', 'lime'];
      list.forEach((c, i) => { c.color = SAFE[i % SAFE.length]; });
      return list;
    }
    _suggestName(members) {
      const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'off', 'to', 'and', 'for', 'in', 'at', 'by', 'with', 'is', 'when', 'if', 'then',
        'set', 'turn', 'new', 'auto', 'automation', 'script', 'input', 'boolean', 'number', 'text', 'select', 'button', 'counter', 'timer',
        'sensor', 'binary', 'switch', 'notify', 'notification', 'run', 'do', 'my']);
      const ACR = new Set(['led', 'ups', 'hvac', 'tv', 'ac', 'pc', 'ha', 'mqtt', 'ir', 'rf', 'ev', 'pv', 'dns', 'vpn', 'wan', 'lan', 'usb', 'nas', 'erv', 'co2', 'voc', 'ai']);
      // 1. the user's own system name: "Garage: left open", "Garage - close", "[Garage] lights"
      const fname = (id) => { const e = this._entMap.get(id), st = this._hass.states[id]; return ((e && e.name) || (st && st.attributes.friendly_name) || '').trim(); };
      const logic = members.filter((id) => /^(automation|script)\./.test(id)).map(fname).filter(Boolean);
      const pre = new Map();
      logic.forEach((n) => {
        const m = n.match(/^\[([^\]]{2,40})\]/) || n.match(/^(.{2,40}?)\s*(?::|\s[-\u2013\u2014|]\s)/);
        if (!m || !/[a-z]{2}/i.test(m[1])) return;
        const k = m[1].trim().toLowerCase(), p = pre.get(k) || { name: m[1].trim(), n: 0 };
        p.n++; pre.set(k, p);
      });
      const best = [...pre.values()].sort((a, b) => b.n - a.n)[0];
      if (best && best.n >= 2 && best.n >= logic.length / 2) return best.name;
      // 2. leading words every automation and script name shares: "Morning lights...", "Morning briefing"
      if (logic.length >= 2) {
        const words = logic.map((n) => n.replace(/[:|\[\]\u2013\u2014]|\s-\s/g, ' ').split(/\s+/).filter(Boolean));
        let k = 0;
        while (k < 4 && words.every((w) => w[k] && w[k].toLowerCase() === words[0][k].toLowerCase())) k++;
        const lead = words[0].slice(0, k).join(' ').replace(/[,.;]+$/, '');
        if (k && /[a-z]{3}/i.test(lead) && !STOP.has(lead.toLowerCase())) return lead;
      }
      // 3. words the entity ids share
      const counts = new Map(), first = new Map();
      members.forEach((id, idx) => {
        const obj = id.split('.')[1] || id;
        new Set(obj.split('_').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))).forEach((t) => {
          counts.set(t, (counts.get(t) || 0) + 1);
          if (!first.has(t)) first.set(t, idx * 1000 + obj.indexOf(t));
        });
      });
      const need = Math.max(2, Math.ceil(members.length * 0.34));
      const top = [...counts.entries()].filter(([, c]) => c >= need).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
      if (top.length) {
        const ref = members.find((id) => top.every((t) => id.includes(t)));
        top.sort((a, b) => (ref ? ref.indexOf(a) - ref.indexOf(b) : first.get(a) - first.get(b)));
        return top.map((t) => (ACR.has(t) ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1))).join(' ');
      }
      const lead = members.find((id) => this._scopeOf(id) === 'helpers') || members[0];
      const st = this._hass.states[lead];
      return (st && st.attributes.friendly_name) || lead;
    }
    _pickIcon(members) {
      for (const id of members) {
        if (this._scopeOf(id) !== 'helpers') continue;
        const e = this._entMap.get(id), st = this._hass.states[id], ic = (e && e.icon) || (st && st.attributes.icon);
        if (ic) return ic;
      }
      return 'mdi:puzzle-outline';
    }
    async _mgrImport(list) {
      const g = this._mgr;
      if (!g || g.busy) return;
      g.busy = true;
      this._renderManager();
      const done = [], skipped = [], failed = [];
      for (const i of list) {
        const c = g.cands && g.cands[i];
        if (!c || (c.fn && !c.missing.length)) continue;
        try {
          if (c.fn) {
            const ids = c.missing.filter((id) => c.keep.has(id));
            this._toast(T('adding_to', { count: P('n_pieces', ids.length), name: c.name }));
            const r = await this._labelMany(ids, c.fn, g.cats);
            c.missing = c.missing.filter((id) => !r.done.includes(id));
            skipped.push(...r.skipped);
            done.push(c.fn);
          } else {
            const ids = c.members.filter((id) => c.keep.has(id)), name = String(c.name || '').trim();
            if (!ids.length || !name) continue;
            this._toast(T('importing', { name }));
            const r = await this._importGroup(name, c.icon, c.color, ids, g.cats, c.cat);
            c.fn = r.label; c.members = ids; c.keep = new Set(ids); c.missing = r.skipped.map((x) => x.id);
            c.source = 'function';
            skipped.push(...r.skipped);
            done.push(c.fn);
          }
        } catch (e) { failed.push(c.name); this._toast(T('could_not_import', { name: c.name, message: e.message || e.code })); }
      }
      g.busy = false; g.sel = new Set();
      // an import lays each function out again (Auto-arrange), leaving only boxes kept in place where they are
      if (done.length) { done.forEach((l) => this._arrangeData(l)); this._save(); }
      await this._loadRegistries();
      this._renderList();
      if (this._$.modal.querySelector('.mgr')) this._renderManager();
      if (done.length) {
        const names = done.map((l) => this._fnName(l));
        const msg = (done.length === 1 ? T('imported_2', { names: names[0] }) : T('imported', { count: P('n_functions', done.length) }))
          + (skipped.length ? T('skipped', { count: P('n_pieces', skipped.length), why: skipped[0].why }) : '')
          + (failed.length ? T('failed', { failed: failed.join(', ') }) : '');
        this._toast(msg, [{ text: T('undo'), fn: () => this._undo() }]);
        if (!this._model) this._open(done[0]);
        else if (done.includes(this._data.ui.current)) this._open(this._data.ui.current, true);
      }
    }
    // Create (or reuse) the label, file under categories, label every piece that can take a label, and put the
    // function on the board even when some pieces are skipped. Returns { label, done, skipped }.
    async _importGroup(name, icon, color, ids, withCats, catName, opt = {}) {
      let label = this._labels.find((l) => String(l.name).toLowerCase() === name.toLowerCase()), made = false;
      if (!label) {
        const msg = { type: 'config/label_registry/create', name, icon: icon || 'mdi:puzzle-outline' };
        if (color) msg.color = color;
        label = await this._ws(msg);
        this._labels.push(label); this._labelMap.set(label.label_id, label);
        made = true;
      }
      const lid = label.label_id;
      if (opt.layout && !this._data.layouts[lid]) this._data.layouts[lid] = opt.layout;
      const L = this._layout(lid);
      let madeCats = [];
      if (withCats && !L.categories) {
        const scopes = [...new Set(ids.map((id) => this._scopeOf(id)).filter(Boolean))];
        const r = await this._categories(catName || name, icon || 'mdi:puzzle-outline', scopes);
        L.categories = r.ids; madeCats = r.made;
      }
      const recs = [], skipped = [];
      for (const id of ids) {
        try { recs.push(await this._label(id, lid, true, withCats)); }
        catch (e) { skipped.push({ id, why: this._noLabelWhy(id, e) }); }
      }
      const wasOn = this._data.functions.includes(lid);
      if (!wasOn) this._data.functions.push(lid);
      this._save();
      const st = { lid, made, madeCats, recs, wasOn, layout: null };
      if (!opt.quiet) {
        this._history({
          label: lid, text: T('import', { name }),
          check: async (dir) => dir !== 'undo' || !st.made || (await this._labelCount(st.lid)) <= st.recs.filter((u) => !u.had).length,
          undo: async () => {
            for (const u of st.recs) await this._unlabel(u).catch(() => {});
            if (!st.wasOn) this._takeOff(st.lid);
            await this._dropCategories(st.madeCats);
            if (st.made) {
              st.layout = this._data.layouts[st.lid] || null;
              delete this._data.layouts[st.lid];
              await this._ws({ type: 'config/label_registry/delete', label_id: st.lid });
            }
            this._save();
          },
          redo: async () => {
            await this._loadRegistries();
            const r = await this._importGroup(name, icon, color, ids, withCats, catName, { quiet: true, layout: st.layout });
            Object.assign(st, r.state);
          },
        });
      }
      return { label: lid, done: recs.map((u) => u.id), skipped, state: st };
    }
    // take a function off the list (the label stays); opens another one if it was on screen
    _takeOff(label) {
      this._data.functions = this._data.functions.filter((f) => f !== label);
      if (this._data.ui.current === label) {
        this._data.ui.current = this._data.functions[0] || null;
        this._model = null; this._clearWorld();
      }
      this._save();
    }

    _mgrLabels() {
      const avail = this._labels.filter((l) => !this._data.functions.includes(l.label_id)).sort((a, b) => a.name.localeCompare(b.name));
      if (!avail.length) return `<div class="muted pad">${T('every_label_is_already_on')}</div>`;
      const count = (lid) => this._ents.filter((e) => (e.labels || []).includes(lid)).length + this._devs.filter((d) => (d.labels || []).includes(lid)).length;
      return `<div class="hint mintro">${T('labels_you_already_use_adding')}</div>${avail.map((l) => `<label class="lrow"><input type="checkbox" data-lsel="${esc(l.label_id)}" ${this._mgr.lsel.has(l.label_id) ? 'checked' : ''}>`
          + `<ha-icon icon="${esc(l.icon || 'mdi:label-outline')}" style="color:${cssColor(l.color)}"></ha-icon><span class="mn"><b>${esc(l.name)}</b>`
          + `<small>${P('n_items', count(l.label_id))}${l.description ? ' · ' + esc(l.description) : ''}</small></span></label>`).join('')}`;
    }
    _mgrLabelsAdd() {
      const g = this._mgr, ids = [...g.lsel].filter((l) => !this._data.functions.includes(l));
      ids.forEach((l) => this._data.functions.push(l));
      g.lsel = new Set();
      this._save(); this._renderList(); this._renderManager();
      if (!ids.length) return;
      this._history({ label: null, text: T('add_as_functions', { count: P('n_labels', ids.length) }), undo: async () => ids.forEach((l) => this._takeOff(l)), redo: async () => { ids.forEach((l) => { if (!this._data.functions.includes(l)) this._data.functions.push(l); }); this._save(); } });
      this._toast(T('added', { count: P('n_functions', ids.length) }), [{ text: T('undo'), fn: () => this._undo() }]);
      if (!this._model) this._open(ids[0]);
    }

    _mgrPick() {
      const g = this._mgr;
      const opts = `${this._data.functions.map((f) => `<option value="${esc(f)}" ${g.target === f ? 'selected' : ''}>${esc(this._fnName(f))}</option>`).join('')}<option value="__new" ${g.target === '__new' ? 'selected' : ''}>${T('new_function')}</option>`;
      return `<div class="ptop"><label>${T('add_to_2')}<select data-ptarget>${opts}</select></label>${g.target === '__new' ? `<label>${T('new_function_name')}<input data-pnew value="${esc(g.newName || '')}" placeholder="${T('e_g_garage_door')}"></label>` : ''}</div><input class="search" placeholder="${T('search_by_name_entity_id')}"><div class="pchips"></div><div class="picks"></div><div class="hint">${T('adding_gives_each_item_the')}</div>`;
    }
    _pickIndex() {
      if (this._pidx && this._pidxAt === this._regAt) return this._pidx;
      const area = (id) => (id && this._areaMap && this._areaMap.get(id) ? this._areaMap.get(id).name : '');
      const devCount = new Map();
      this._ents.forEach((e) => { if (e.device_id && !e.disabled_by) devCount.set(e.device_id, (devCount.get(e.device_id) || 0) + 1); });
      const rows = [];
      for (const e of this._ents) {
        if (e.disabled_by) continue;
        const st = this._hass.states[e.entity_id], dev = e.device_id ? this._devMap.get(e.device_id) : null;
        const devName = dev ? String(dev.name_by_user || dev.name || '') : '';
        const name = String((st && st.attributes.friendly_name) || e.name || e.original_name || e.entity_id);
        const ar = area(e.area_id || (dev && dev.area_id));
        const sc = this._scopeOf(e.entity_id);
        const type = sc === 'automation' ? 'automation' : sc === 'script' ? 'script' : sc === 'helpers' ? 'helpers' : 'entities';
        const lbl = (e.labels || []).map((l) => (this._labelMap.get(l) || {}).name || l);
        rows.push({
          key: e.entity_id, type, tag: this._tagOf(e.entity_id), name, labels: e.labels || [], diag: !!e.entity_category,
          sub: [e.entity_id, ar, devName && devName !== name ? devName : ''].filter(Boolean).join(' · '),
          hay: [name, e.entity_id, ar, devName, e.platform, e.original_name || '', ...lbl].join(' ').toLowerCase(),
        });
      }
      for (const d of this._devs) {
        if (d.disabled_by) continue;
        const name = String(d.name_by_user || d.name || T('device')), ar = area(d.area_id), n = devCount.get(d.id) || 0;
        const model = [d.manufacturer, d.model].filter(Boolean).join(' ');
        const lbl = (d.labels || []).map((l) => (this._labelMap.get(l) || {}).name || l);
        rows.push({
          key: 'device:' + d.id, type: 'devices', tag: T('device'), name, labels: d.labels || [], diag: false,
          sub: [ar, model, P('n_entities', n)].filter(Boolean).join(' · '),
          hay: [name, d.name || '', ar, model, ...lbl].join(' ').toLowerCase(),
        });
      }
      this._pidx = rows; this._pidxAt = this._regAt;
      return rows;
    }
    _renderPicks(q) {
      const g = this._mgr, m = this._$.modal, box = m.querySelector('.picks'), chips = m.querySelector('.pchips');
      if (!box || !g) return;
      if (q != null) g.q = q;
      const target = g.target !== '__new' ? g.target : null;
      const terms = String(g.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const all = this._pickIndex();
      const match = terms.length ? all.filter((r) => terms.every((t) => r.hay.includes(t))) : all;
      const diagHidden = g.pdiag ? 0 : match.filter((r) => r.diag).length;
      const base = g.pdiag ? match : match.filter((r) => !r.diag);
      const counts = { all: base.length, automation: 0, script: 0, helpers: 0, devices: 0, entities: 0 };
      base.forEach((r) => { counts[r.type]++; });
      const types = [['all', T('all')], ['automation', T('automations')], ['script', T('scripts')], ['helpers', T('helpers')], ['devices', T('devices')], ['entities', T('entities')]];
      if (chips) {
        chips.innerHTML = `${types.map(([k, t]) => `<button class="chip ${g.ptype === k ? 'on' : ''}" data-act="mgr-ptype" data-ptype="${k}">${t}<span>${counts[k].toLocaleString()}</span></button>`).join('')}<button class="chip ${g.ptype === 'selected' ? 'on' : ''}" data-act="mgr-ptype" data-ptype="selected">${T('selected')}<span>${this._pick.size}</span></button><button class="chip" data-act="mgr-pickall" title="${T('tick_everything_currently_listed')}">${T('select_all_shown')}</button><label class="tg2"><input type="checkbox" data-pdiag ${g.pdiag ? 'checked' : ''}>${T('device_settings_and_diagnostics', { extra: diagHidden ? T('hidden', { diagHidden: diagHidden.toLocaleString() }) : '' })}</label>`;
      }
      const RANK = { automation: 0, script: 1, helpers: 2, devices: 3, entities: 4 };
      let rows = g.ptype === 'selected' ? all.filter((r) => this._pick.has(r.key)) : g.ptype === 'all' ? base : base.filter((r) => r.type === g.ptype);
      const score = (r) => {
        if (!terms.length) return 0;
        const n = r.name.toLowerCase();
        return terms.every((t) => n.includes(t)) ? (n.startsWith(terms[0]) ? 0 : 1) : 2;
      };
      rows = rows.map((r) => ({ r, s: score(r) })).sort((x, y) => x.s - y.s || RANK[x.r.type] - RANK[y.r.type] || x.r.name.localeCompare(y.r.name)).map((x) => x.r);
      const shown = rows.slice(0, g.pshow || 200);
      g.pshownKeys = shown.filter((r) => !(target && r.labels.includes(target))).map((r) => r.key);
      const html = shown.map((r) => {
        const inFn = !!target && r.labels.includes(target);
        return `<label class="pick ${inFn ? 'infn' : ''}"><input type="checkbox" data-pick="${esc(r.key)}" ${inFn || this._pick.has(r.key) ? 'checked' : ''} ${inFn ? 'disabled' : ''}>`
          + `<span class="tag">${esc(r.tag)}</span><span class="mn"><b>${esc(r.name)}</b><small>${esc(r.sub)}${inFn ? T('already_in_this_function') : ''}</small></span></label>`;
      }).join('');
      const more = rows.length - shown.length;
      box.innerHTML = (html || `<div class="muted pad">${T('nothing_matches')}</div>`)
        + (more > 0 ? `<button class="more" data-act="mgr-more">${T('show_more_not_shown', { min: Math.min(200, more).toLocaleString(), more: more.toLocaleString() })}</button>` : '');
    }
    async _mgrPickAdd() {
      const g = this._mgr, ids = [...this._pick];
      if (!ids.length || g.busy) return;
      let label = g.target, res;
      g.busy = true;
      try {
        if (label === '__new') {
          const name = String(g.newName || '').trim();
          if (!name) { this._toast(T('give_the_new_function_a')); g.busy = false; return; }
          res = await this._importGroup(name, 'mdi:puzzle-outline', 'indigo', ids, g.cats);
          label = res.label;
        } else {
          res = await this._labelMany(ids, label, true);
        }
      } catch (e) { g.busy = false; this._toast(T('could_not_add', { message: e.message || e.code })); return; }
      g.busy = false;
      this._pick = new Set();
      this._closeModal();
      await this._loadRegistries();
      this._renderList();
      const here = label === this._data.ui.current;
      const msg = T('added_to', { count: P('n_items', res.done.length), fnName: this._fnName(label), extra: res.skipped.length ? T('skipped', { count: P('n_items', res.skipped.length), why: res.skipped[0].why }) : '' });
      const acts = [];
      if (res.done.length) acts.push({ text: T('undo'), fn: () => this._undo() });
      if (!here || !this._model) acts.push({ text: T('go_there'), fn: () => this._open(label) });
      if (!this._model) this._open(label);
      else if (here) this._open(label, true);
      this._toast(msg, acts);
    }
    // label several items, carrying on past ones that can't take a label; one undo step for all of them
    async _labelMany(ids, label, withCat) {
      const done = [], skipped = [], undo = [];
      for (const id of ids) {
        try { undo.push(await this._label(id, label, true, withCat)); done.push(id); }
        catch (e) { skipped.push({ id, why: this._noLabelWhy(id, e) }); }
      }
      if (done.length) this._labelStep(T('add_to', { count: P('n_items', done.length), fnName: this._fnName(label) }), label, undo);
      return { done, skipped };
    }
    _noLabelWhy(id, e) {
      if (!this._canLabel(id)) return T('no_unique_id_add_id');
      return (e && (e.message || e.code)) || T('could_not_be_labelled');
    }
  }

  FunctionsBoard.VERSION = VERSION;
  // the words, so a translation can be tried from the browser console: add a table, e.g.
  // customElements.get('functions-board').STR.de = { ... }, and the page switches at its next update
  FunctionsBoard.STR = STR;
  customElements.define('functions-board', FunctionsBoard);
  // the card picker can list the card before any board has seen hass: take the language from the page
  try { setLang(document.querySelector('home-assistant').hass.language); } catch (e) { /* stays English */ }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'functions-board',
    get name() { return T('functions_board'); },
    get description() { return T('whiteboard_of_the_automations_scripts'); },
  });
  console.info(`%c FUNCTIONS-BOARD %c v${VERSION} `, 'color:#fff;background:#3d4048;padding:2px 4px;border-radius:3px 0 0 3px',
    'color:#3d4048;background:#dfe1e5;padding:2px 4px;border-radius:0 3px 3px 0');
})();
