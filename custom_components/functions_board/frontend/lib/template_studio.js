import { ENTITY_RE, EXACT_RE, TPL_RE, toList } from './constants.js';
import { T } from './i18n.js';
import { HHMM_RE } from './builders.js';

/* ---------- Template Studio (0.15.0): Jinja parser, plain-English explainer, linter & 9 Template Helper recipes ----------
   Pure JavaScript, zero external dependencies. Parses Home Assistant Jinja templates into readable clauses, flags
   common pitfalls (especially the unavailable/unknown trap) with auto-fixes, builds single-call live evaluation probes
   for Home Assistant's render_template, extracts templates from automations/scripts, and generates 9 standard Home
   Assistant Template Helper recipes (sensor / binary_sensor) with synchronized learning notes. */

export const TPL_RECIPE_KINDS = new Set([
  'tpl_count', 'tpl_any_all', 'tpl_list_names', 'tpl_duration', 'tpl_fallback',
  'tpl_low_battery', 'tpl_band', 'tpl_math', 'tpl_time_window', 'tpl_compare', 'tpl_message',
  'tpl_sun_offset', 'tpl_countdown', 'tpl_attribute', 'tpl_scale', 'tpl_logic', 'tpl_map_state',
]);

// Big-picture -> small-picture goal funnel covering every major Home Assistant template use case.
export const TPL_GOAL_TREE = [
  { id: 'bool', icon: 'mdi:toggle-switch-outline', kinds: ['tpl_any_all', 'tpl_logic', 'tpl_compare', 'tpl_time_window', 'tpl_sun_offset'] },
  { id: 'number', icon: 'mdi:numeric', kinds: ['tpl_count', 'tpl_scale', 'tpl_math', 'tpl_duration', 'tpl_low_battery'] },
  { id: 'time', icon: 'mdi:clock-outline', kinds: ['tpl_sun_offset', 'tpl_countdown', 'tpl_duration', 'tpl_time_window'] },
  { id: 'text', icon: 'mdi:card-text-outline', kinds: ['tpl_attribute', 'tpl_map_state', 'tpl_band', 'tpl_list_names', 'tpl_fallback', 'tpl_message'] },
];

// Suggest likely Home Assistant state strings based on the domains of the chosen entities.
export function suggestStatesForEntities(entities) {
  const doms = new Set(toList(entities).map((e) => String(e).split('.')[0]).filter(Boolean));
  const out = [];
  const add = (...xs) => xs.forEach((x) => { if (!out.includes(x)) out.push(x); });
  if (doms.has('cover') || doms.has('valve')) add('open', 'closed', 'opening', 'closing');
  if (doms.has('lock')) add('unlocked', 'locked', 'jammed');
  if (doms.has('person') || doms.has('device_tracker')) add('home', 'not_home');
  if (doms.has('climate')) add('heat', 'cool', 'auto', 'off');
  if (doms.has('media_player')) add('playing', 'paused', 'idle', 'off');
  if (doms.has('vacuum')) add('cleaning', 'docked', 'returning', 'error');
  if (doms.has('alarm_control_panel')) add('armed_away', 'armed_home', 'disarmed', 'triggered');
  if (!out.length || [...doms].some((d) => /^(binary_sensor|light|switch|fan|input_boolean|automation|script)$/.test(d))) add('on', 'off');
  return out.slice(0, 6);
}

// Rich interactive Jinja concept glossary: plain-English name, what it does, why you need it (common trap),
// category, example, and smart snippet builder using a real entity from the user's home.
export const JINJA_GLOSSARY = {
  states: {
    cat: 'read', needsEntity: true,
    plainName: 'Read a sensor or entity value',
    syntax: "states('domain.entity')",
    title: 'Read an entity state safely',
    what: 'Gets the current state of an entity as text (for example "on", "open", or "72.4").',
    why: 'Safer than writing states.sensor.x.state, which crashes with an error if the entity does not exist yet at startup.',
    example: "states('sensor.living_room_temp')",
    snippet: (e) => `states('${e || 'sensor.example'}')`,
  },
  is_state: {
    cat: 'read', needsEntity: true,
    plainName: 'Check if an entity is in a state',
    syntax: "is_state('domain.entity', 'on')",
    title: 'Check if an entity has a state',
    what: 'Returns true if the entity matches that state (or any state in a list like [\'open\', \'opening\']), and false otherwise.',
    why: 'Never crashes when the entity is unavailable or missing — much cleaner than writing states(...) == \'on\'.',
    example: "is_state('cover.garage_door', 'open')",
    snippet: (e) => `is_state('${e || 'binary_sensor.example'}', '${e && e.startsWith('cover.') ? 'open' : e && e.startsWith('person.') ? 'home' : 'on'}')`,
  },
  has_value: {
    cat: 'read', needsEntity: true,
    plainName: 'Check if a sensor is online / valid',
    syntax: "has_value('domain.entity')",
    title: 'Guard against unavailable / unknown',
    what: 'Returns true only when the entity exists and its state is NOT "unavailable" or "unknown".',
    why: 'Prevents the #1 template bug ("the unavailable trap"): put this in your Availability template or an if-check before doing math.',
    example: "has_value('sensor.outdoor_temp')",
    snippet: (e) => `has_value('${e || 'sensor.example'}')`,
  },
  state_attr: {
    cat: 'read', needsEntity: true,
    plainName: 'Read an extra detail (attribute)',
    syntax: "state_attr('domain.entity', 'attr')",
    title: 'Read an entity attribute',
    what: 'Reads extra information stored on an entity — like a light\'s brightness, a thermostat\'s target temperature, or a cover\'s position.',
    why: 'Safely returns none instead of crashing if the attribute is missing (for instance, brightness is absent when a light is off).',
    example: "state_attr('climate.home', 'current_temperature')",
    snippet: (e) => `state_attr('${e || 'climate.example'}', 'friendly_name')`,
  },
  is_state_attr: {
    cat: 'read', needsEntity: true,
    plainName: 'Check an extra detail (attribute)',
    syntax: "is_state_attr('domain.entity', 'attr', value)",
    title: 'Check an entity attribute value',
    what: 'Returns true when an entity\'s attribute equals the value you want, and false if it differs or is missing.',
    why: 'Avoids errors when the attribute is not present yet.',
    example: "is_state_attr('cover.garage', 'current_position', 0)",
    snippet: (e) => `is_state_attr('${e || 'cover.example'}', 'current_position', 0)`,
  },
  float: {
    cat: 'numbers',
    plainName: 'Convert text to a decimal number',
    syntax: '| float(0)',
    title: 'Convert text to a decimal number',
    what: 'Turns text like "21.5" into a real decimal number so you can compare (> 20) or do math (+, -, *, /).',
    why: 'Home Assistant ALWAYS stores entity states as text! Without | float(0), "9" > "10" compares alphabetically as text. Adding (0) gives a safe fallback instead of crashing if the sensor is unavailable.',
    example: "states('sensor.temp') | float(0) > 22",
    snippet: () => '| float(0)',
  },
  int: {
    cat: 'numbers',
    plainName: 'Convert text to a whole number',
    syntax: '| int(0)',
    title: 'Convert text to a whole number',
    what: 'Turns text like "15" or "15.8" into a whole integer (15).',
    why: 'Always include a default like int(0) so an offline/unavailable sensor does not throw an error.',
    example: "states('counter.visits') | int(0)",
    snippet: () => '| int(0)',
  },
  round: {
    cat: 'numbers',
    plainName: 'Round a number cleanly',
    syntax: '| round(1)',
    title: 'Round a number',
    what: 'Rounds a decimal number to the chosen number of decimal places (0 for whole numbers, 1 for tenths like 21.5).',
    why: 'Keeps calculated averages and temperature differences tidy instead of showing 21.3333333337.',
    example: '(a + b) / 2 | round(1)',
    snippet: () => '| round(1)',
  },
  expand: {
    cat: 'lists', needsEntity: true,
    plainName: 'Load full state info for a list of entities',
    syntax: "expand(['entity_a', 'entity_b'])",
    title: 'Turn entity IDs or groups into full state objects',
    what: 'Takes a list of entity IDs (or a group/area) and fetches each entity\'s full state object — including its .state, friendly .name, and .attributes.',
    why: 'A plain list like [\'light.kitchen\', \'light.hall\'] is just text names. You need expand(...) before you can filter by state (selectattr) or pull friendly names (map).',
    example: "expand(['light.kitchen', 'light.hall']) | selectattr('state', 'eq', 'on') | list",
    snippet: (e) => `expand(['${e || 'light.a'}']) | selectattr('state', 'eq', 'on') | list | count`,
  },
  selectattr: {
    cat: 'lists',
    plainName: 'Keep only matching entities in a list',
    syntax: "| selectattr('state', 'eq', 'on')",
    title: 'Keep only matching items',
    what: 'Filters a list of expanded entities, keeping only the ones whose field matches a test (eq = equals, in = one of, ne = not equal, lt/gt = less/greater).',
    why: 'Lets you count or list only the doors that are open or lights that are on — without writing a loop.',
    example: "selectattr('state', 'in', ['on', 'open'])",
    snippet: () => "| selectattr('state', 'eq', 'on')",
  },
  rejectattr: {
    cat: 'lists',
    plainName: 'Skip / ignore matching entities in a list',
    syntax: "| rejectattr('state', 'in', ['unavailable', 'unknown'])",
    title: 'Drop matching items',
    what: 'The opposite of selectattr: removes items that match a test from a list.',
    why: 'The standard way to skip offline/unavailable sensors before counting or averaging a group of entities.',
    example: "rejectattr('state', 'in', ['unavailable', 'unknown'])",
    snippet: () => "| rejectattr('state', 'in', ['unavailable', 'unknown'])",
  },
  map: {
    cat: 'lists',
    plainName: 'Pull one field (or convert) for every item',
    syntax: "| map(attribute='name')",
    title: 'Extract one field or apply a filter to each item',
    what: 'Transforms every item in a list — e.g. extracting each entity\'s friendly name (attribute=\'name\') or converting every state to a number (map(\'float\', none)).',
    why: 'Turns a list of complex entity objects into simple names or numbers you can join or average.',
    example: "map(attribute='name') | list",
    snippet: () => "| map(attribute='name') | list",
  },
  list: {
    cat: 'lists',
    plainName: 'Turn filtered results into a real list',
    syntax: '| list',
    title: 'Realize a lazy filter into a list',
    what: 'Finalizes filters like selectattr or map into a real list.',
    why: 'Jinja filters produce a lazy stream that cannot be counted directly — piping through | list lets you follow up with | count, | sort, or | join.',
    example: "... | selectattr('state', 'eq', 'on') | list | count",
    snippet: () => '| list',
  },
  count: {
    cat: 'lists',
    plainName: 'Count how many items matched',
    syntax: '| count',
    title: 'Count items in a list',
    what: 'Returns how many items are in a list (same as | length).',
    why: 'Place after | list to turn a filtered set of entities into a number like 3.',
    example: '... | list | count',
    snippet: () => '| list | count',
  },
  join: {
    cat: 'lists',
    plainName: 'Combine a list of names into one sentence',
    syntax: "| join(', ')",
    title: 'Combine a list into one string',
    what: 'Glues every text item in a list together with a separator like ", ".',
    why: 'Turns [\'Back door\', \'Garage window\'] into clean readable text: "Back door, Garage window".',
    example: "names | join(', ')",
    snippet: () => "| join(', ')",
  },
  area_entities: {
    cat: 'lists',
    plainName: 'Get all entities in a room / area',
    syntax: "area_entities('kitchen')",
    title: 'All entities in an area',
    what: 'Returns every entity ID assigned to a Home Assistant area (room).',
    why: 'Automatically picks up new lights or sensors you add to that room later — wrap in expand(...) to inspect their states.',
    example: "expand(area_entities('kitchen')) | selectattr('domain', 'eq', 'light') | list",
    snippet: () => "expand(area_entities('kitchen')) | selectattr('state', 'eq', 'on') | list | count",
  },
  label_entities: {
    cat: 'lists',
    plainName: 'Get all entities carrying a label',
    syntax: "label_entities('garage')",
    title: 'All entities with a label',
    what: 'Returns every entity ID carrying a Home Assistant label (including any Function on this board!).',
    why: 'Great for dynamically watching every sensor or light tagged with a Function without listing them one by one.',
    example: "expand(label_entities('garage'))",
    snippet: () => "expand(label_entities('garage'))",
  },
  default: {
    cat: 'logic',
    plainName: 'Substitute a fallback if empty',
    syntax: "| default('None', true)",
    title: 'Fallback when empty or undefined',
    what: 'Replaces an empty or missing result with your chosen fallback text or number.',
    why: 'Passing true as the second argument catches empty strings "" too, not just undefined variables.',
    example: "names | join(', ') | default('All closed', true)",
    snippet: () => "| default('None', true)",
  },
  iif: {
    cat: 'logic', needsEntity: true,
    plainName: 'Choose between two answers (inline if/else)',
    syntax: "iif(condition, 'Yes', 'No')",
    title: 'Inline if / else shorthand',
    what: 'One-line shortcut for if/else: returns the first answer when true, or the second when false.',
    why: 'Much shorter than a 5-line {% if %}...{% else %}...{% endif %} block for simple two-way labels.',
    example: "iif(is_state('cover.garage', 'open'), 'Open', 'Closed')",
    snippet: (e) => `iif(is_state('${e || 'binary_sensor.example'}', 'on'), 'Active', 'Idle')`,
  },
  namespace: {
    cat: 'logic',
    plainName: 'Keep a running list or total inside a loop',
    syntax: 'namespace(items=[])',
    title: 'Mutable container inside a loop',
    what: 'Creates a small container whose fields you can update inside a {% for %} loop and still read after {% endfor %}.',
    why: 'In Jinja, ordinary {% set total = ... %} inside a loop gets thrown away when the loop ends — namespace() solves that.',
    example: '{% set ns = namespace(low=[]) %}',
    snippet: () => '{% set ns = namespace(items=[]) %}',
  },
  now: {
    cat: 'time',
    plainName: 'Current local date and time',
    syntax: 'now()',
    title: 'Current local date and time',
    what: 'Returns your Home Assistant local time (you can check now().hour, now().weekday(), etc.).',
    why: 'Home Assistant automatically refreshes any template using now() at the top of every minute.',
    example: 'now().hour >= 22',
    snippet: () => 'now()',
  },
  today_at: {
    cat: 'time',
    plainName: 'A clock time today (for schedules)',
    syntax: "today_at('22:00')",
    title: 'A wall-clock time today',
    what: 'Builds a timezone-aware timestamp for a clock time today (like 10:00 PM) so you can compare it directly against now().',
    why: 'Much cleaner and safer across Daylight Saving Time than comparing hour and minute numbers by hand.',
    example: "today_at('07:00') <= now() < today_at('22:00')",
    snippet: () => "today_at('07:00') <= now() < today_at('22:00')",
  },
  as_timestamp: {
    cat: 'time',
    plainName: 'Convert a date/time to seconds (for elapsed time)',
    syntax: 'as_timestamp(dt, 0)',
    title: 'Convert a date/time to seconds',
    what: 'Converts a datetime into plain seconds so you can subtract two times and divide by 60 to get minutes elapsed.',
    why: 'Always pass a fallback like as_timestamp(x, 0) so missing timestamps do not raise an error.',
    example: '(as_timestamp(now()) - as_timestamp(states.cover.garage.last_changed, 0)) / 60',
    snippet: () => 'as_timestamp(now())',
  },
  as_datetime: {
    cat: 'time',
    plainName: 'Turn date/time text into a real date object',
    syntax: "as_datetime(state_attr('sun.sun', 'next_setting'))",
    title: 'Parse a date or ISO timestamp string',
    what: 'Turns text like "2026-11-27T22:15:00+00:00" (from sun.sun, calendars, or input_datetime) into a real datetime you can add or subtract hours from.',
    why: 'Home Assistant attributes store timestamps as text — you must convert them with as_datetime() before using timedelta() or strftime().',
    example: "as_datetime(state_attr('sun.sun', 'next_setting'))",
    snippet: () => "as_datetime(state_attr('sun.sun', 'next_setting'))",
  },
  as_local: {
    cat: 'time',
    plainName: 'Convert a UTC timestamp to your local timezone',
    syntax: 'as_local(dt)',
    title: 'Convert datetime to local timezone',
    what: 'Shifts a UTC datetime (such as sun.sun next_setting or next_rising) into your Home Assistant local timezone.',
    why: 'Sun attributes are stored in UTC — without as_local(), formatting with strftime() prints UTC hours instead of your local clock.',
    example: "as_local(as_datetime(state_attr('sun.sun', 'next_setting')))",
    snippet: () => "as_local(as_datetime(state_attr('sun.sun', 'next_setting')))",
  },
  timedelta: {
    cat: 'time',
    plainName: 'Add or subtract hours, minutes, or days from a time',
    syntax: 'timedelta(hours=16)',
    title: 'Time offset (days, hours, minutes, seconds)',
    what: 'Represents an amount of time you can add (+) or subtract (-) from now(), today_at(), or as_datetime().',
    why: 'Handles midnight wrap-around and month boundaries automatically — ideal for "16 hours before sunset" or "30 minutes after sunrise".',
    example: "as_local(as_datetime(state_attr('sun.sun', 'next_setting'))) - timedelta(hours=16)",
    snippet: () => 'timedelta(hours=1, minutes=0)',
  },
  strftime: {
    cat: 'time',
    plainName: 'Format a date/time into readable clock text',
    syntax: ".strftime('%I:%M %p')",
    title: 'Format datetime as custom text',
    what: 'Turns a datetime into readable text: %I:%M %p gives "01:05 AM", %H:%M gives "01:05" (24h), and %a %b %d gives "Fri Nov 27".',
    why: 'Without formatting, a raw datetime prints an ugly ISO string like 2026-11-28 01:05:12-05:00.',
    example: "now().strftime('%I:%M %p')",
    snippet: () => ".strftime('%I:%M %p')",
  },
  relative_time: {
    cat: 'time',
    plainName: 'Show a time as "12 minutes" or "2 hours"',
    syntax: 'relative_time(dt)',
    title: 'Human-readable elapsed time',
    what: 'Turns a past datetime (like last_changed) into friendly text such as "12 minutes" or "3 hours".',
    why: 'Instant readable durations for dashboards and notifications without manual division.',
    example: 'relative_time(states.cover.garage_door.last_changed)',
    snippet: () => 'relative_time(now() - timedelta(minutes=15))',
  },
  abs: {
    cat: 'numbers',
    plainName: 'Remove a minus sign (absolute value)',
    syntax: '| abs',
    title: 'Absolute value of a number',
    what: 'Turns negative numbers positive (e.g. -4.5 becomes 4.5), leaving positive numbers unchanged.',
    why: 'Useful when measuring the gap between two sensors regardless of which one is higher.',
    example: "(states('sensor.in') | float(0) - states('sensor.out') | float(0)) | abs | round(1)",
    snippet: () => '| abs',
  },
  average: {
    cat: 'numbers',
    plainName: 'Average a list of numbers',
    syntax: '| average(0)',
    title: 'Arithmetic mean of a list',
    what: 'Computes the average of a list of numbers (with a safe default if the list is empty).',
    why: 'Cleaner than writing (vals | sum) / (vals | count) and avoids divide-by-zero when all sensors are offline.',
    example: "[18.5, 21.0, 22.5] | average(0) | round(1)",
    snippet: () => '| average(0) | round(1)',
  },
  bool: {
    cat: 'logic',
    plainName: 'Convert a value into true / false',
    syntax: '| bool(false)',
    title: 'Convert text or number to boolean',
    what: 'Turns "on", "yes", "true", or 1 into true, and "off", "no", "false", or 0 into false.',
    why: 'Passing a default like bool(false) prevents errors if a sensor is unavailable.',
    example: "states('input_boolean.guest_mode') | bool(false)",
    snippet: () => '| bool(false)',
  },
  replace: {
    cat: 'logic',
    plainName: 'Replace text inside a state or name',
    syntax: "| replace('_', ' ')",
    title: 'Find and replace characters in text',
    what: 'Swaps one piece of text for another — commonly used to turn underscores into spaces or strip prefixes.',
    why: 'Turns ugly raw states like "armed_away" into clean dashboard text like "Armed away" when paired with | title.',
    example: "states('alarm_control_panel.home') | replace('_', ' ') | title",
    snippet: () => "| replace('_', ' ') | title",
  },
};

// ---- Low-level Jinja string / paren aware helpers ----

function skipQuoted(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === q) return j;
  }
  return s.length - 1;
}

// Split an expression on top-level single `|` pipes (ignoring quotes, parens/brackets, and `||`).
export function splitPipes(expr) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'" || c === '"') { i = skipQuoted(expr, i); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === '|' && depth === 0 && expr[i + 1] !== '|' && expr[i - 1] !== '|') {
      out.push(expr.slice(from, i).trim());
      from = i + 1;
    }
  }
  const tail = expr.slice(from).trim();
  if (tail) out.push(tail);
  return out;
}

// Split top-level arguments inside a function call's parentheses.
function splitArgs(s) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = skipQuoted(s, i); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  const tail = s.slice(from).trim();
  if (tail) out.push(tail);
  return out;
}

const unquote = (s) => {
  const t = String(s || '').trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
};

// Extract all entity IDs mentioned in a template snippet (quoted strings + states.<domain>.<obj>).
export function extractTemplateEntities(src) {
  const found = new Set();
  const s = String(src || '');
  for (const m of s.matchAll(ENTITY_RE)) found.add(m[0]);
  for (const m of s.matchAll(/\bstates\.([a-z_]+)\.([a-z0-9_]+)\b/g)) found.add(m[1] + '.' + m[2]);
  return [...found];
}

// Detect which glossary concepts appear in a Jinja snippet.
export function detectConcepts(src) {
  const s = String(src || ''), found = [];
  const has = (re, k) => { if (re.test(s) && !found.includes(k)) found.push(k); };
  has(/\bstates\s*\(/, 'states');
  has(/\bis_state\s*\(/, 'is_state');
  has(/\bstate_attr\s*\(/, 'state_attr');
  has(/\bis_state_attr\s*\(/, 'is_state_attr');
  has(/\bhas_value\s*\(/, 'has_value');
  has(/\bexpand\s*\(/, 'expand');
  has(/\|\s*selectattr\b/, 'selectattr');
  has(/\|\s*rejectattr\b/, 'rejectattr');
  has(/\|\s*map\b/, 'map');
  has(/\|\s*float\b|\bfloat\s*\(/, 'float');
  has(/\|\s*int\b|\bint\s*\(/, 'int');
  has(/\|\s*round\b/, 'round');
  has(/\|\s*list\b/, 'list');
  has(/\|\s*(?:count|length)\b/, 'count');
  has(/\|\s*join\b/, 'join');
  has(/\|\s*default\b/, 'default');
  has(/\biif\s*\(/, 'iif');
  has(/\bnow\s*\(/, 'now');
  has(/\btoday_at\s*\(/, 'today_at');
  has(/\bas_timestamp\s*\(/, 'as_timestamp');
  has(/\bas_datetime\s*\(/, 'as_datetime');
  has(/\bas_local\s*\(/, 'as_local');
  has(/\btimedelta\s*\(/, 'timedelta');
  has(/\.strftime\s*\(/, 'strftime');
  has(/\brelative_time\s*\(/, 'relative_time');
  has(/\|\s*abs\b/, 'abs');
  has(/\|\s*average\b/, 'average');
  has(/\|\s*bool\b/, 'bool');
  has(/\|\s*replace\b/, 'replace');
  has(/\barea_entities\s*\(/, 'area_entities');
  has(/\blabel_entities\s*\(/, 'label_entities');
  has(/\bnamespace\s*\(/, 'namespace');
  return found;
}

// ---- Tokenizer & structural parser ----

export function parseTemplate(src) {
  const text = String(src == null ? '' : src);
  const tokens = [];
  let i = 0;
  const openRe = /\{\{|\{%|\{#/g;
  while (i < text.length) {
    openRe.lastIndex = i;
    const m = openRe.exec(text);
    if (!m) {
      const tail = text.slice(i);
      if (tail.trim()) tokens.push({ kind: 'text', raw: tail, body: tail, start: i, end: text.length });
      break;
    }
    if (m.index > i) {
      const lit = text.slice(i, m.index);
      if (lit.trim()) tokens.push({ kind: 'text', raw: lit, body: lit, start: i, end: m.index });
    }
    const open = m[0], close = open === '{{' ? '}}' : open === '{%' ? '%}' : '#}';
    let j = m.index + 2, found = -1;
    while (j < text.length) {
      const c = text[j];
      if (open !== '{#' && (c === "'" || c === '"')) { j = skipQuoted(text, j) + 1; continue; }
      if (text.slice(j, j + 2) === close) { found = j; break; }
      j++;
    }
    if (found < 0) {
      tokens.push({ kind: 'error', raw: text.slice(m.index), body: text.slice(m.index + 2).trim(), unclosed: open, start: m.index, end: text.length });
      break;
    }
    const raw = text.slice(m.index, found + 2);
    let inner = text.slice(m.index + 2, found);
    if (inner.startsWith('-')) inner = inner.slice(1);
    if (inner.endsWith('-')) inner = inner.slice(0, -1);
    inner = inner.trim();
    const kind = open === '{{' ? 'expr' : open === '{%' ? 'stmt' : 'comment';
    const tok = { kind, raw, body: inner, start: m.index, end: found + 2 };
    if (kind === 'stmt') {
      const sm = /^([a-z_]+)\b([\s\S]*)$/i.exec(inner);
      tok.tag = sm ? sm[1].toLowerCase() : '';
      tok.rest = sm ? sm[2].trim() : '';
      if (tok.tag === 'set') {
        const eq = /^([a-zA-Z_][\w.]*)\s*=\s*([\s\S]+)$/.exec(tok.rest);
        if (eq) { tok.varName = eq[1]; tok.expr = eq[2].trim(); }
        else { tok.varName = tok.rest; tok.blockSet = true; }
      }
    }
    tokens.push(tok);
    i = found + 2;
  }
  return tokens;
}

// ---- Plain-English expression translator ----

const SUN_ATTR_NAMES = {
  next_setting: 'next sunset',
  next_rising: 'next sunrise',
  next_noon: 'next solar noon',
  next_midnight: 'next solar midnight',
  next_dawn: 'next dawn',
  next_dusk: 'next dusk',
  elevation: 'sun elevation',
  azimuth: 'sun azimuth',
};
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CMP_WORDS = { '==': 'equals', '!=': 'does not equal', '>': 'is greater than', '>=': 'is at least', '<': 'is less than', '<=': 'is at most' };

function stripOuterParens(s) {
  let t = String(s || '').trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    let d = 0, wraps = true;
    for (let i = 0; i < t.length - 1; i++) {
      const c = t[i];
      if (c === "'" || c === '"') { i = skipQuoted(t, i); continue; }
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) d--;
      if (d === 0) { wraps = false; break; }
    }
    if (!wraps) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function splitTopOp(expr, ops) {
  const s = String(expr || '');
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = skipQuoted(s, i); continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    for (const op of ops) {
      if (s.slice(i, i + op.length) !== op) continue;
      if (/^[a-z]/i.test(op)) {
        const before = i > 0 ? s[i - 1] : ' ';
        const after = i + op.length < s.length ? s[i + op.length] : ' ';
        if (/\w/.test(before) || /\w/.test(after)) continue;
      }
      if ((op === '<' || op === '>') && (s[i + 1] === '=' || s[i - 1] === '<' || s[i - 1] === '>')) continue;
      if (op === '=' && (s[i + 1] === '=' || s[i - 1] === '=' || s[i - 1] === '!' || s[i - 1] === '<' || s[i - 1] === '>')) continue;
      return { left: s.slice(0, i).trim(), op, right: s.slice(i + op.length).trim() };
    }
  }
  return null;
}

function splitAllTopOp(expr, op) {
  const out = [];
  let rest = String(expr || '');
  while (true) {
    const sp = splitTopOp(rest, [op]);
    if (!sp) { out.push(rest.trim()); break; }
    out.push(sp.left);
    rest = sp.right;
  }
  return out.filter(Boolean);
}

function splitTopTernary(expr) {
  const s = String(expr || '');
  let depth = 0, ifPos = -1, elsePos = -1, nest = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = skipQuoted(s, i); continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    const prev = i > 0 ? s[i - 1] : ' ';
    if (!/\w/.test(prev) && s.slice(i, i + 2) === 'if' && !/\w/.test(s[i + 2] || ' ')) {
      if (ifPos < 0) ifPos = i; else nest++;
      i += 1;
    } else if (!/\w/.test(prev) && s.slice(i, i + 4) === 'else' && !/\w/.test(s[i + 4] || ' ')) {
      if (ifPos >= 0) {
        if (nest === 0) { elsePos = i; break; }
        nest--;
      }
      i += 3;
    }
  }
  if (ifPos > 0 && elsePos > ifPos) {
    return {
      thenExpr: s.slice(0, ifPos).trim(),
      condExpr: s.slice(ifPos + 2, elsePos).trim(),
      elseExpr: s.slice(elsePos + 4).trim(),
    };
  }
  return null;
}

function friendlyTimedelta(argsStr) {
  const parts = [];
  for (const seg of splitArgs(argsStr)) {
    const m = /^(days|hours|minutes|seconds|weeks)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(seg.trim());
    if (!m) { parts.push(seg.trim()); continue; }
    const n = Number(m[2]), unit = n === 1 ? m[1].slice(0, -1) : m[1];
    parts.push(`${n} ${unit}`);
  }
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] || argsStr);
}

function friendlyStrftime(fmt) {
  if (fmt === '%I:%M %p') return '12-hour clock time (e.g. 01:05 PM)';
  if (fmt === '%H:%M') return '24-hour clock time (e.g. 13:05)';
  if (fmt === '%H:%M:%S') return '24-hour clock time with seconds';
  if (fmt === '%Y-%m-%d') return 'date (YYYY-MM-DD)';
  return `formatted date/time ("${fmt}")`;
}

function friendlyList(raw, conj = 'or') {
  const inner = String(raw || '').trim().replace(/^\[|\]$/g, '');
  const items = splitArgs(inner).map((x) => unquote(x));
  if (items.length === 2 && items.includes('unavailable') && items.includes('unknown')) return 'offline or unavailable';
  const q = items.map((x) => `"${x}"`);
  if (q.length <= 1) return q[0] || raw;
  return `${q.slice(0, -1).join(', ')} ${conj} ${q[q.length - 1]}`;
}

function friendlyDays(raw) {
  const nums = splitArgs(String(raw || '').replace(/^\[|\]$/g, '')).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const sig = nums.join(',');
  if (sig === '0,1,2,3,4') return 'a weekday (Mon–Fri)';
  if (sig === '5,6') return 'the weekend (Sat–Sun)';
  if (sig === '0,1,2,3,4,5,6') return 'any day of the week';
  return nums.map((d) => DAY_NAMES[d]).join(', ');
}

function friendlyEntityList(ents, nm) {
  const names = ents.slice(0, 3).map(nm);
  if (ents.length === 1) return names[0];
  if (ents.length === 2) return `${names[0]} and ${names[1]}`;
  if (ents.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names.join(', ')} (+${ents.length - 3} more)`;
}

function capFirst(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function describeFilter(part) {
  const fm = /^([a-zA-Z_]\w*)(?:\s*\(([\s\S]*)\))?$/.exec(part.trim());
  if (!fm) return `apply ${part.trim()}`;
  const fn = fm[1], args = fm[2] ? splitArgs(fm[2]) : [];
  switch (fn) {
    case 'float': return args.length ? `as a decimal number (default ${args[0]})` : 'as a decimal number';
    case 'int': return args.length ? `as a whole number (default ${args[0]})` : 'as a whole number';
    case 'round': {
      const d = args[0];
      if (!d || d === '0') return 'rounded to the nearest whole number';
      return `rounded to ${d} decimal place${d === '1' ? '' : 's'}`;
    }
    case 'abs': return 'as a positive number';
    case 'count': case 'length': return 'count how many matched';
    case 'list': return '';
    case 'first': return 'first item';
    case 'last': return 'last item';
    case 'sort': return 'sorted in order';
    case 'unique': return 'without duplicates';
    case 'join': return `joined with "${unquote(args[0] || '')}"`;
    case 'lower': return 'in lowercase';
    case 'upper': return 'in uppercase';
    case 'title': return 'with Each Word Capitalized';
    case 'string': return '';
    case 'trim': return 'with extra spaces removed';
    case 'default': return `or ${args[0] ? `"${unquote(args[0])}"` : '""'} if empty`;
    case 'bool': return args.length ? `as true/false (default ${args[0]})` : 'as true/false';
    case 'min': return 'smallest value';
    case 'max': return 'largest value';
    case 'sum': return 'summed together';
    case 'average': return 'averaged';
    case 'selectattr': {
      const attr = unquote(args[0] || 'state'), op = unquote(args[1] || 'defined'), val = args[2];
      if (attr === 'attributes.device_class' && op === 'defined') return '';
      if (attr === 'attributes.device_class' && op === 'eq' && val) return `that are ${unquote(val)} sensors`;
      if (attr === 'domain' && op === 'eq' && val) return `in the ${unquote(val)} domain`;
      if (attr === 'state' && (op === 'eq' || op === 'equalto') && val) return `whose state is "${unquote(val)}"`;
      if (attr === 'state' && op === 'in' && val) return `whose state is ${friendlyList(val)}`;
      const opWord = { eq: 'is', equalto: 'is', ne: 'is not', in: 'is one of', lt: 'is under', le: 'is at most', gt: 'is over', ge: 'is at least', defined: 'is present' }[op] || op;
      return val != null ? `where ${attr} ${opWord} ${val}` : `where ${attr} ${opWord}`;
    }
    case 'rejectattr': {
      const attr = unquote(args[0] || 'state'), op = unquote(args[1] || 'defined'), val = args[2];
      if (attr === 'state' && op === 'in' && val && /unavailable/.test(val)) return 'skipping offline or unavailable ones';
      const opWord = { eq: 'is', equalto: 'is', in: 'is one of', ne: 'is not' }[op] || op;
      return val != null ? `skipping any where ${attr} ${opWord} ${val}` : `skipping any where ${attr} ${opWord}`;
    }
    case 'reject': return args.length && unquote(args[0]) === 'none' ? 'skipping non-numeric or offline ones' : (args.length ? `skipping ${unquote(args[0])} values` : 'skipping empty values');
    case 'select': return args.length ? `keeping ${unquote(args[0])} values` : 'keeping non-empty values';
    case 'map': {
      const raw = fm[2] || '';
      const attrM = /attribute\s*=\s*['"]([^'"]+)['"]/.exec(raw);
      if (attrM) {
        if (attrM[1] === 'name') return 'taking each friendly name';
        if (attrM[1] === 'state') return 'reading each state';
        return `taking each item's ${attrM[1]}`;
      }
      if (args.length && unquote(args[0]) === 'float') return 'converting each to a number';
      if (args.length) return `applying ${unquote(args[0])} to each`;
      return 'transforming each item';
    }
    case 'as_timestamp': return 'in seconds';
    case 'as_datetime': return 'as a date/time';
    case 'as_local': return 'in your local timezone';
    case 'replace': {
      const a = unquote(args[0] || ''), b = unquote(args[1] || '');
      if (a === '_' && b === ' ') return 'replacing underscores with spaces';
      return `replacing "${a}" with "${b}"`;
    }
    default: return args.length ? `${fn}(${args.join(', ')})` : fn;
  }
}

function callInner(s, fnName) {
  const re = new RegExp(`^${fnName}\\s*\\(`);
  const m = re.exec(s);
  if (!m || !s.endsWith(')')) return null;
  let d = 0;
  for (let i = m[0].length - 1; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = skipQuoted(s, i); continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    if (d === 0) return i === s.length - 1 ? s.slice(m[0].length, -1).trim() : null;
  }
  return null;
}

function describeDateExpr(s, nm) {
  let m;
  const loc = callInner(s, 'as_local');
  if (loc != null) {
    const dt = callInner(loc, 'as_datetime');
    if (dt != null) {
      if ((m = /^state_attr\s*\(\s*['"]sun\.sun['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/.exec(dt))) {
        return `the ${SUN_ATTR_NAMES[m[1]] || m[1]} in your local timezone`;
      }
      if ((m = /^state_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]start_time['"]\s*\)$/.exec(dt))) {
        return `the next start time of ${nm(m[1])} in your local timezone`;
      }
      if ((m = /^state_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/.exec(dt))) {
        return `${nm(m[1])}'s ${m[2]} in your local timezone`;
      }
      if ((m = /^states\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(dt))) {
        return `the date/time of ${nm(m[1])} in your local timezone`;
      }
      if ((m = /^['"]([^'"]+)['"]$/.exec(dt))) {
        return `${m[1]} in your local timezone`;
      }
      return `${describeExpr(dt, nm)} in your local timezone`;
    }
    return `${describeExpr(loc, nm)} in your local timezone`;
  }
  const dtOnly = callInner(s, 'as_datetime');
  if (dtOnly != null) return `the date/time of ${describeExpr(dtOnly, nm)}`;
  return null;
}

function describeBase(expr, nm) {
  const s = stripOuterParens(expr);
  let m;

  // Date/time + or - timedelta(...) (handles chained `- timedelta(days=1) + timedelta(hours=2)`)
  if (/\btimedelta\s*\(/.test(s)) {
    if ((m = /^([\s\S]+?)\s*-\s*timedelta\s*\(\s*days\s*=\s*1\s*\)\s*\+\s*timedelta\s*\(([^)]+)\)$/.exec(s))) {
      return `1 day before ${describeBase(m[1], nm)}, plus ${friendlyTimedelta(m[2])}`;
    }
    if ((m = /^([\s\S]+?)\s*([+-])\s*timedelta\s*\(([^)]+)\)$/.exec(s))) {
      const base = describeBase(m[1], nm), td = friendlyTimedelta(m[3]);
      return m[2] === '-' ? `${td} before ${base}` : `${td} after ${base}`;
    }
  }

  // Nested date/time conversions
  const dt = describeDateExpr(s, nm);
  if (dt) return dt;

  // Elapsed minutes since last_changed
  if ((m = /^\(?as_timestamp\s*\(\s*now\s*\(\s*\)\s*\)\s*-\s*as_timestamp\s*\(\s*states\.([a-z_]+\.[a-z0-9_]+)\.last_changed[\s\S]*\)\s*\/\s*60$/.exec(s))) {
    return `minutes since ${nm(m[1])} last changed`;
  }
  if ((m = /^as_timestamp\s*\(\s*now\s*\(\s*\)\s*\)\s*-\s*as_timestamp\s*\(\s*([a-zA-Z_]\w*)\b[\s\S]*\)$/.exec(s))) {
    return `seconds elapsed since ${m[1]}`;
  }
  if ((m = /^as_timestamp\s*\(\s*([a-zA-Z_]\w*)\b[\s\S]*\)\s*-\s*as_timestamp\s*\(\s*now\s*\(\s*\)\s*\)$/.exec(s))) {
    return `seconds remaining until ${m[1]}`;
  }

  // Common time unit divisions & remainders
  if ((m = /^([a-zA-Z_]\w*)\s*\/\/\s*86400$/.exec(s))) return `whole days from ${m[1]}`;
  if ((m = /^\(?\s*([a-zA-Z_]\w*)\s*%\s*86400\s*\)?\s*\/\/\s*3600$/.exec(s))) return `remaining whole hours from ${m[1]}`;
  if ((m = /^\(?\s*([a-zA-Z_]\w*)\s*%\s*3600\s*\)?\s*\/\/\s*60$/.exec(s))) return `remaining whole minutes from ${m[1]}`;
  if ((m = /^([a-zA-Z_]\w*)\s*\/\/\s*60$/.exec(s))) return `whole hours from ${m[1]}`;
  if ((m = /^([a-zA-Z_]\w*)\s*%\s*60$/.exec(s))) return `remaining minutes after whole hours`;
  if ((m = /^([a-zA-Z_]\w*)\s*\/\s*86400$/.exec(s))) return `${m[1]} converted to days`;
  if ((m = /^([a-zA-Z_]\w*)\s*\/\s*3600$/.exec(s))) return `${m[1]} converted to hours`;
  if ((m = /^([a-zA-Z_]\w*)\s*\/\s*60$/.exec(s))) return `${m[1]} converted to minutes`;

  // Common scaling & unit conversions
  if ((m = /^([a-zA-Z_]\w*)\s*\|\s*float\s*\(\s*0\s*\)\s*\/\s*255\s*\*\s*100$/.exec(s))) return `${m[1]} converted from 0–255 brightness to 0–100%`;
  if ((m = /^\(\s*([a-zA-Z_]\w*)\s*\*\s*9\s*\/\s*5\s*\)\s*\+\s*32$/.exec(s))) return `${m[1]} converted from °C to °F`;
  if ((m = /^\(\s*([a-zA-Z_]\w*)\s*-\s*32\s*\)\s*\*\s*5\s*\/\s*9$/.exec(s))) return `${m[1]} converted from °F to °C`;
  if ((m = /^([a-zA-Z_]\w*)\s*\|\s*sum\s*\/\s*\(\s*\1\s*\|\s*count\s*\)$/.exec(s))) return `the average of ${m[1]}`;
  if ((m = /^([a-zA-Z_]\w*)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s))) return `${m[1]} divided by ${m[2]}`;
  if ((m = /^([a-zA-Z_]\w*)\s*\*\s*(\d+(?:\.\d+)?)$/.exec(s))) return `${m[1]} multiplied by ${m[2]}`;
  if ((m = /^([a-zA-Z_]\w*)\s*\*\s*(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)$/.exec(s))) {
    return `${m[1]} multiplied by ${m[2]} ${m[3] === '+' ? 'plus' : 'minus'} ${m[4]}`;
  }

  // Formatting & ISO timestamp
  if ((m = /^([a-zA-Z_]\w*)\.isoformat\s*\(\s*\)$/.exec(s))) return `${m[1]} as a full timestamp (ready for automation triggers and dashboards)`;
  if ((m = /^([a-zA-Z_]\w*)\.strftime\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) return `${m[1]} as a ${friendlyStrftime(m[2])}`;

  // Dictionary literal & .get() lookup
  if (/^\{[\s\S]*\}$/.test(s) && s.includes(':')) {
    const pairs = splitArgs(s.slice(1, -1)).slice(0, 4).map((p) => {
      const kv = p.split(':');
      return kv.length === 2 ? `"${unquote(kv[0])}" → "${unquote(kv[1])}"` : p;
    });
    return `a translation table (${pairs.join(', ')}${splitArgs(s.slice(1, -1)).length > 4 ? ', …' : ''})`;
  }
  if ((m = /^([a-zA-Z_]\w*)\.get\s*\(([\s\S]+)\)$/.exec(s))) {
    const a = splitArgs(m[2]);
    if (a.length >= 2) return `the matching label for ${describeExpr(a[0], nm)} from ${m[1]} (or "${unquote(a[1])}" if not listed)`;
  }

  // Loop list append (`ns.low + [e.name ~ ...]`)
  if ((m = /^([a-zA-Z_]\w*\.[a-zA-Z_]\w*)\s*\+\s*\[([\s\S]+)\]$/.exec(s))) {
    const inner = m[2].trim();
    if (/e\.name/.test(inner) && /e\.state/.test(inner)) return `add this device's name and reading to ${m[1]}`;
    return `add ${describeExpr(inner, nm)} to ${m[1]}`;
  }

  // Namespace loop container
  if ((m = /^namespace\s*\(\s*([a-zA-Z_]\w*)\s*=\s*\[\s*\]\s*\)$/.exec(s))) {
    return `an empty list (${m[1]}) to collect matching items in the loop`;
  }
  if (/^namespace\s*\(/.test(s)) return `a loop variable container (${s})`;

  // String concatenation (`a ~ b ~ c`) — with friendly formatting for common duration & count phrases
  const tilde = splitAllTopOp(s, '~');
  if (tilde.length > 1) {
    if (s === "d ~ 'd ' ~ h ~ 'h'") return 'days and hours (e.g. "3d 4h")';
    if (s === "h ~ 'h ' ~ m ~ 'm'") return 'hours and minutes (e.g. "1h 15m")';
    if (s === "m ~ ' min'") return 'minutes (e.g. "12 min")';
    if (/ns\.low\s*\|\s*count\s*~\s*': '\s*~\s*\(?\s*ns\.low\s*\|\s*join/.test(s)) return 'the count and list of matching devices';
    const bits = tilde.map((part) => {
      const p = stripOuterParens(part);
      if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) return `"${unquote(p)}"`;
      if (/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\|\s*join\s*\(\s*['"]([^'"]*)['"]\s*\)$/.test(p)) {
        const jm = /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\|\s*join\s*\(\s*['"]([^'"]*)['"]\s*\)$/.exec(p);
        return `${jm[1]} separated by "${jm[2]}"`;
      }
      if (/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\|\s*count$/.test(p)) {
        const cm = /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\|\s*count$/.exec(p);
        return `the count of ${cm[1]}`;
      }
      return describeExpr(p, nm);
    });
    return bits.join(' followed by ');
  }

  // Core Home Assistant functions
  if ((m = /^not\s+is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(s))) {
    return `${nm(m[1])} is not ${friendlyList(m[2])}`;
  }
  if ((m = /^is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(s))) {
    return `${nm(m[1])} is ${friendlyList(m[2])}`;
  }
  if ((m = /^is_state_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(s))) {
    return `${nm(m[1])}'s ${m[2]} is ${friendlyList(m[3])}`;
  }
  if ((m = /^has_value\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `${nm(m[1])} is online and has a valid reading`;
  }
  if ((m = /^states\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `the current state of ${nm(m[1])}`;
  }
  if ((m = /^state_attr\s*\(\s*['"]sun\.sun['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `the ${SUN_ATTR_NAMES[m[1]] || m[1]}`;
  }
  if ((m = /^state_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `the ${m[2]} of ${nm(m[1])}`;
  }
  if ((m = /^expand\s*\(\s*([\s\S]+)\)$/.exec(s))) {
    const ents = extractTemplateEntities(m[1]);
    if (ents.length) return friendlyEntityList(ents, nm);
    if (/area_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(m[1])) {
      const am = /area_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(m[1]);
      return `all entities in the "${am[1]}" area`;
    }
    if (/label_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(m[1])) {
      const lm = /label_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(m[1]);
      return `all entities with the "${lm[1]}" label`;
    }
    return `all entities in ${m[1].trim()}`;
  }
  if ((m = /^states\.([a-z_]+)$/.exec(s))) return `all ${m[1].replace(/_/g, ' ')} entities`;
  if ((m = /^states\.([a-z_]+\.[a-z0-9_]+)\.last_changed$/.exec(s))) return `when ${nm(m[1])} last changed`;
  if ((m = /^states\.([a-z_]+\.[a-z0-9_]+)\.state$/.exec(s))) return `the state of ${nm(m[1])}`;
  if (s === 'e.state') return 'this item\'s reading';
  if (s === 'e.name') return 'this item\'s friendly name';
  if ((m = /^iif\s*\(([\s\S]+)\)$/.exec(s))) {
    const a = splitArgs(m[1]);
    if (a.length >= 3) return `if ${describeExpr(a[0], nm)}, use ${describeExpr(a[1], nm)}; otherwise ${describeExpr(a[2], nm)}`;
  }
  if (/^now\s*\(\s*\)$/.test(s)) return 'the current time';
  if ((m = /^today_at\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) return `today at ${m[1]}`;
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return `"${unquote(s)}"`;

  // Fallback inline cleanup for custom user expressions
  return s
    .replace(/\bis_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g, (_, id, v) => `${nm(id)} is ${friendlyList(v)}`)
    .replace(/\bhas_value\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, id) => `${nm(id)} is online`)
    .replace(/\bstates\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, id) => `${nm(id)}`)
    .replace(/\bstate_attr\s*\(\s*['"]sun\.sun['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g, (_, a) => SUN_ATTR_NAMES[a] || a)
    .replace(/\bstate_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g, (_, id, a) => `${nm(id)}'s ${a}`)
    .replace(/\btoday_at\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, t) => t)
    .replace(/\bnow\(\)/g, 'the current time');
}

function describePipeChain(s, nm) {
  const parts = splitPipes(s);
  if (parts.length === 1) return describeBase(parts[0], nm);

  const head = stripOuterParens(parts[0]);
  const filters = parts.slice(1).map((p) => p.trim());

  // Special smooth English rewrites for the most common Home Assistant filter pipelines
  const hasCount = filters.some((f) => /^(?:count|length)\b/.test(f));
  const hasNameMap = filters.some((f) => /^map\s*\(\s*attribute\s*=\s*['"]name['"]\s*\)/.test(f));
  const hasFloatMap = filters.some((f) => /^map\s*\(\s*['"]float['"]/.test(f));
  const hasSkipUnav = filters.some((f) => /^rejectattr\s*\(\s*['"]state['"]\s*,\s*['"]in['"]/.test(f) && /unavailable/.test(f));
  const selState = filters.find((f) => /^selectattr\s*\(\s*['"]state['"]/.test(f));

  if (hasCount && selState) {
    const sm = /^selectattr\s*\(\s*['"]state['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(selState);
    if (sm) {
      return `how many of ${describeBase(head, nm)} are ${friendlyList(sm[2])}`;
    }
  }
  if (hasNameMap && selState) {
    const sm = /^selectattr\s*\(\s*['"]state['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(selState);
    if (sm) {
      return `the friendly names of ${describeBase(head, nm)} that are ${friendlyList(sm[2])}`;
    }
  }
  if (selState && !hasCount && !hasNameMap && filters.every((f) => f === selState || f === 'list')) {
    const sm = /^selectattr\s*\(\s*['"]state['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(selState);
    if (sm) {
      return `only those in ${describeBase(head, nm)} that are ${friendlyList(sm[2])}`;
    }
  }
  if (hasFloatMap && filters.some((f) => /^reject\s*\(\s*['"]none['"]\s*\)/.test(f))) {
    return `the numeric readings of ${describeBase(head, nm)} (ignoring any that are offline)`;
  }
  if (head === 'states.sensor' && filters.some((f) => /'battery'/.test(f))) {
    return hasSkipUnav ? 'every online battery sensor in Home Assistant' : 'every battery sensor in Home Assistant';
  }
  if (filters.length === 1 && /^(?:count|length)$/.test(filters[0])) {
    return `how many items are in ${describeBase(head, nm)}`;
  }

  const headDesc = describeBase(head, nm);
  const steps = filters.map((p) => describeFilter(p)).filter(Boolean);
  if (!steps.length) return headDesc;
  return `${headDesc}, ${steps.join(', ')}`;
}

export function describeExpr(expr, nameOf) {
  const nm = (id) => (typeof nameOf === 'function' ? nameOf(id) : id);
  const s = stripOuterParens(expr);
  if (!s) return '';

  // 1. Overnight & daytime schedule patterns
  let m;
  if ((m = /^now\(\)\s*>=\s*today_at\s*\(\s*['"]([^'"]+)['"]\s*\)\s+or\s+now\(\)\s*<\s*today_at\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `the current time is between ${m[1]} and ${m[2]} (overnight)`;
  }
  if ((m = /^today_at\s*\(\s*['"]([^'"]+)['"]\s*\)\s*<=\s*now\(\)\s*<\s*today_at\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `the current time is between ${m[1]} and ${m[2]}`;
  }
  if ((m = /^now\(\)\.weekday\(\)\s+in\s+(\[[^\]]+\])$/.exec(s))) {
    return `today is ${friendlyDays(m[1])}`;
  }

  // 2. Inline Python/Jinja ternary: `A if COND else B` (paren-aware, supports chained ternaries)
  const tern = splitTopTernary(s);
  if (tern) {
    const elseNested = splitTopTernary(stripOuterParens(tern.elseExpr));
    if (elseNested) {
      return `if ${describeExpr(tern.condExpr, nm)}, use ${describeExpr(tern.thenExpr, nm)}; else if ${describeExpr(elseNested.condExpr, nm)}, use ${describeExpr(elseNested.thenExpr, nm)}; otherwise use ${describeExpr(elseNested.elseExpr, nm)}`;
    }
    return `if ${describeExpr(tern.condExpr, nm)}, use ${describeExpr(tern.thenExpr, nm)}; otherwise use ${describeExpr(tern.elseExpr, nm)}`;
  }

  // 3. Chained range check: `A <= X <= B` or `A <= X < B`
  if ((m = /^([^<>]+?)\s*(<=|<)\s*([^<>]+?)\s*(<=|<)\s*([^<>]+)$/.exec(s)) && !/[()[\]{}]/.test(m[3].replace(/now\(\)/g, ''))) {
    return `${describeExpr(m[3], nm)} is between ${describeExpr(m[1], nm)} and ${describeExpr(m[5], nm)}`;
  }

  // 4. Logical `or` / `and` at top level
  const orSplit = splitAllTopOp(s, 'or');
  if (orSplit.length > 1) {
    return `either ${orSplit.map((p) => describeExpr(p, nm)).join(' or ')}`;
  }
  const andSplit = splitAllTopOp(s, 'and');
  if (andSplit.length > 1) {
    if (andSplit.length === 2 && /\bcount\s*>\s*0\b/.test(andSplit[0]) && /\bcount\s*==\s*/.test(andSplit[1])) {
      return 'at least 1 entity is online and every online one meets the condition';
    }
    const bareVars = andSplit.every((p) => /^[a-zA-Z_]\w*$/.test(p.trim()));
    const tail = bareVars ? ' are true' : '';
    return andSplit.length === 2
      ? `both ${describeExpr(andSplit[0], nm)} and ${describeExpr(andSplit[1], nm)}${tail}`
      : `all of (${andSplit.map((p) => describeExpr(p, nm)).join(', ')})${tail}`;
  }

  // 5. `is not none` / `is none`
  if ((m = /^([\s\S]+?)\s+is\s+not\s+none$/.exec(s))) {
    return `${describeExpr(m[1], nm)} is available`;
  }
  if ((m = /^([\s\S]+?)\s+is\s+none$/.exec(s))) {
    return `${describeExpr(m[1], nm)} is missing`;
  }

  // 6. Top-level comparison (`==`, `!=`, `>=`, `<=`, `>`, `<`) — keeps pipes intact on each side!
  const cmp = splitTopOp(s, ['==', '!=', '>=', '<=', '>', '<']);
  if (cmp) {
    if (cmp.op === '>' && cmp.right === '0' && /\|\s*(?:count|length)\s*$/.test(cmp.left)) {
      const target = cmp.left.replace(/\|\s*(?:count|length)\s*$/, '').trim();
      return `at least 1 item is in ${describeExpr(target, nm)}`;
    }
    if (cmp.op === '==' && /\|\s*(?:count|length)\s*$/.test(cmp.left) && /\|\s*(?:count|length)\s*$/.test(cmp.right)) {
      return 'every online entity meets the condition';
    }
    return `${describeExpr(cmp.left, nm)} ${CMP_WORDS[cmp.op] || cmp.op} ${describeExpr(cmp.right, nm)}`;
  }

  // 7. Top-level string concatenation (`~`) — evaluate before splitting pipes so `a | count ~ ': ' ~ (a | join)` stays intact!
  if (splitAllTopOp(s, '~').length > 1) return describeBase(s, nm);

  // 8. Pipe chain or base expression
  return describePipeChain(s, nm);
}

// ---- Smart Linter & Unavailable Trap Detector ----

export function lintTemplate(src) {
  const text = String(src == null ? '' : src);
  const warnings = [];
  if (!text.trim()) return warnings;

  const tokens = parseTemplate(text);
  // 1. Unbalanced tags / blocks
  const stack = [];
  tokens.forEach((t) => {
    if (t.kind === 'error') {
      warnings.push({ id: 'unclosed', sev: 'error', msg: T('ts_lint_unclosed', { tag: t.unclosed }) });
    }
    if (t.kind === 'stmt') {
      if (t.tag === 'if' || t.tag === 'for' || t.tag === 'macro') stack.push(t.tag);
      else if (t.tag === 'set' && t.blockSet) stack.push('set');
      else if (t.tag === 'endif' || t.tag === 'endfor' || t.tag === 'endmacro' || t.tag === 'endset') {
        const want = t.tag.slice(3);
        if (!stack.length || stack[stack.length - 1] !== want) {
          warnings.push({ id: 'unbalanced_' + t.tag, sev: 'error', msg: T('ts_lint_unexpected', { tag: t.tag }) });
        } else stack.pop();
      }
    }
  });
  stack.forEach((open) => warnings.push({ id: 'missing_end_' + open, sev: 'error', msg: T('ts_lint_missing_end', { tag: open }) }));

  // Strip comments before pattern linting
  const codeOnly = tokens.filter((t) => t.kind === 'expr' || t.kind === 'stmt').map((t) => t.body).join('\n');

  // 2. Bare `| float` or `| int` without a default (the #1 HA template crash!)
  if (/\|\s*(?:float|int)(?!\s*\()/.test(codeOnly)) {
    warnings.push({
      id: 'bare_num',
      sev: 'warn',
      msg: T('ts_lint_bare_num'),
      fixLabel: T('ts_fix_bare_num'),
      fix: (s) => s.replace(/(\|\s*)(float|int)(?!\s*\()/g, '$1$2(0)'),
    });
  }

  // 3. Direct `states.domain.entity.state` (crashes with UndefinedError if entity is missing at boot)
  const dotState = /\bstates\.([a-z_]+)\.([a-z0-9_]+)\.state\b/;
  if (dotState.test(codeOnly)) {
    warnings.push({
      id: 'states_dot',
      sev: 'warn',
      msg: T('ts_lint_states_dot'),
      fixLabel: T('ts_fix_states_dot'),
      fix: (s) => s.replace(/\bstates\.([a-z_]+)\.([a-z0-9_]+)\.state\b/g, "states('$1.$2')"),
    });
  }

  // 4. Unguarded `states(...)` used directly in numeric comparison without float/int
  if (/\bstates\s*\(\s*['"][^'"]+['"]\s*\)\s*(?:[<>]=?|[+\-*/])/.test(codeOnly)) {
    warnings.push({
      id: 'str_math',
      sev: 'warn',
      msg: T('ts_lint_str_math'),
      fixLabel: T('ts_fix_str_math'),
      fix: (s) => s.replace(/(\bstates\s*\(\s*['"][^'"]+['"]\s*\))(\s*(?:[<>]=?|[+\-*/]))/g, '$1 | float(0)$2'),
    });
  }

  // 5. Unavailable trap: reads `states(...)` without any guard (`has_value`, `unavailable`, `unknown`, `default`, `float(`, `int(`, `rejectattr`)
  const readsStates = /\bstates\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(codeOnly);
  const hasGuard = /\bhas_value\s*\(|unavailable|unknown|\|\s*(?:default|rejectattr|float\s*\(|int\s*\()/.test(codeOnly);
  if (readsStates && !hasGuard) {
    const ents = extractTemplateEntities(codeOnly);
    const availSuggest = ents.length ? `{{ ${ents.map((e) => `has_value('${e}')`).join(' and ')} }}` : '';
    warnings.push({
      id: 'unavail_trap',
      sev: 'warn',
      msg: T('ts_lint_unavail'),
      suggestAvail: availSuggest,
    });
  }

  // 6. Informational: `now()` updates once per minute
  if (/\bnow\s*\(\s*\)/.test(codeOnly)) {
    warnings.push({ id: 'now_note', sev: 'info', msg: T('ts_lint_now') });
  }

  return warnings;
}

// ---- Full Plain-English Explainer ----

const VAR_HINTS = {
  sun_dt: 'that sun time',
  prev_dt: 'the previous sun time',
  target: 'the target time',
  prev_target: "today's target time",
  dt: 'that date/time',
  secs: 'the seconds',
  mins: 'the elapsed minutes',
  a: 'that duration',
  d: 'days',
  h: 'hours',
  m: 'minutes',
  v: 'that value',
  n: 'that count',
  val: 'that attribute',
  vals: 'those numbers',
  items: 'those entities',
  valid: 'the online entities',
  matched: 'the matching entities',
  names: 'the matching names',
  labels: 'the translation table',
  in_time: 'within the time window',
  in_day: 'on a selected weekday',
};

function friendlyVarRef(v, defined) {
  if (!defined.has(v)) return v;
  if (VAR_HINTS[v]) return VAR_HINTS[v];
  const cm = /^c(\d+)$/.exec(v);
  if (cm) return `condition ${cm[1]}`;
  return v;
}

function humanizeVars(sentence, defined) {
  let out = String(sentence || '');
  defined.forEach((v) => {
    const label = friendlyVarRef(v, defined);
    if (label === v) return;
    // Replace standalone variable identifiers outside quoted text
    const parts = out.split(/("[^"]*")/g);
    const re = new RegExp(`\\b${v}\\b`, 'g');
    out = parts.map((p, i) => (i % 2 === 1 ? p : p.replace(re, label))).join('');
  });
  return out;
}

function phraseSetAction(varName, rawExpr, desc, defined) {
  const clean = humanizeVars(desc, defined);
  if (/^an empty list/.test(clean)) return `Start with ${clean}.`;
  if (/^add /.test(clean)) return `${capFirst(clean)}.`;
  if (/^if /i.test(clean)) return `${capFirst(clean)} (saved as ${varName}).`;
  if (varName.includes('.')) return `Update ${varName} to ${clean}.`;
  if (/^only those /.test(clean)) return `Keep ${clean} (saved as ${varName}).`;
  if (/^how many /.test(clean)) return `Count ${clean} (saved as ${varName}).`;
  if (/^a translation table/.test(clean)) return `Define ${clean} (saved as ${varName}).`;
  if (/^(whole |remaining |\d+ (?:day|hour|minute|second)|seconds |minutes |the average|.+ (?:divided|multiplied|converted) )/.test(clean)) {
    return `Calculate ${clean} (saved as ${varName}).`;
  }
  const hasCmp = /\b(?:is greater than|is less than|is at least|is at most|equals|does not equal|is between|meets the condition)\b/.test(clean);
  const isCheck = hasCmp || (/\b(?:is|are|between|both|either|online|available|missing)\b/.test(clean)
    && !/^the (?:current state|next |date\/time|friendly names|numeric readings|matching label|average|state)/.test(clean));
  if (isCheck) return `Check whether ${clean} (saved as ${varName}).`;
  return `Get ${clean} (saved as ${varName}).`;
}

function phraseExprAction(rawBody, desc, defined) {
  const clean = humanizeVars(desc, defined);
  if (/^if /i.test(clean)) return `${capFirst(clean).replace(/,\s*use /g, ', return ').replace(/;\s*otherwise use /g, '; otherwise return ')}.`;
  const isBool = /\b(?:is|are|equals|between|at least|at most|greater than|less than|both|either|meets the condition)\b/.test(clean)
    && !/^the (?:current state|next |date\/time|friendly names|numeric readings|matching label|average|state)/.test(clean)
    && !/as a full timestamp|clock time|followed by|separated by/.test(clean);
  if (isBool) return `Return true if ${clean} (otherwise false).`;
  return `Return ${clean}.`;
}

export function explainTemplate(src, nameOf) {
  const nm = (id) => (typeof nameOf === 'function' ? nameOf(id) : id);
  const text = String(src == null ? '' : src);
  const tokens = parseTemplate(text);
  const clauses = [];
  const allEntities = new Set(extractTemplateEntities(text));
  const conceptSet = new Set();
  const definedVars = new Set();
  let depth = 0;
  const setLines = [];

  for (const tok of tokens) {
    const ents = extractTemplateEntities(tok.body);
    ents.forEach((e) => allEntities.add(e));
    const concepts = tok.kind === 'expr' || tok.kind === 'stmt' ? detectConcepts(tok.body) : [];
    concepts.forEach((c) => conceptSet.add(c));

    if (tok.kind === 'comment') {
      clauses.push({ kind: 'comment', depth, raw: tok.raw, english: `Note: ${tok.body}`, evalExpr: null, entities: [], concepts: [] });
      continue;
    }
    if (tok.kind === 'text') {
      clauses.push({ kind: 'text', depth, raw: tok.raw.trim(), english: depth > 0 ? `Return "${tok.raw.trim()}".` : `Static text: "${tok.raw.trim()}"`, evalExpr: null, entities: [], concepts: [] });
      continue;
    }
    if (tok.kind === 'error') {
      clauses.push({ kind: 'error', depth, raw: tok.raw, english: T('ts_lint_unclosed', { tag: tok.unclosed }), evalExpr: null, entities: ents, concepts: [] });
      continue;
    }
    if (tok.kind === 'stmt') {
      const tag = tok.tag;
      if (tag === 'elif' || tag === 'else' || tag === 'endif' || tag === 'endfor' || tag === 'endmacro' || tag === 'endset') {
        depth = Math.max(0, depth - 1);
      }
      if (tag === 'set' && tok.varName && tok.expr) {
        const pre = setLines.join('');
        setLines.push(tok.raw);
        const desc = describeExpr(tok.expr, nm);
        clauses.push({
          kind: 'set', depth, raw: tok.raw, varName: tok.varName,
          english: phraseSetAction(tok.varName, tok.expr, desc, definedVars),
          evalExpr: `${pre}{{ (${tok.expr}) }}`,
          entities: ents, concepts,
        });
        if (!tok.varName.includes('.')) definedVars.add(tok.varName);
      } else if (tag === 'if') {
        clauses.push({
          kind: 'if', depth, raw: tok.raw,
          english: `If ${humanizeVars(describeExpr(tok.rest, nm), definedVars)}:`,
          evalExpr: `${setLines.join('')}{{ (${tok.rest}) | bool }}`,
          entities: ents, concepts,
        });
        depth++;
      } else if (tag === 'elif') {
        clauses.push({
          kind: 'elif', depth, raw: tok.raw,
          english: `Otherwise, if ${humanizeVars(describeExpr(tok.rest, nm), definedVars)}:`,
          evalExpr: `${setLines.join('')}{{ (${tok.rest}) | bool }}`,
          entities: ents, concepts,
        });
        depth++;
      } else if (tag === 'else') {
        clauses.push({ kind: 'else', depth, raw: tok.raw, english: 'Otherwise:', evalExpr: null, entities: [], concepts: [] });
        depth++;
      } else if (tag === 'for') {
        const fm = /^(.+?)\s+in\s+([\s\S]+)$/.exec(tok.rest);
        const loopVar = fm ? fm[1].trim() : '';
        const itemWord = loopVar === 'e' ? 'each sensor' : `each ${loopVar}`;
        clauses.push({
          kind: 'for', depth, raw: tok.raw,
          english: fm ? `Check ${itemWord} in ${humanizeVars(describeExpr(fm[2], nm), definedVars)}:` : `Repeat for ${tok.rest}:`,
          evalExpr: fm ? `${setLines.join('')}{{ (${fm[2]}) | list | count }}` : null,
          entities: ents, concepts,
        });
        depth++;
      } else if (tag === 'do') {
        clauses.push({ kind: 'do', depth, raw: tok.raw, english: `Run: ${humanizeVars(describeExpr(tok.rest, nm), definedVars)}`, evalExpr: null, entities: ents, concepts });
      } else if (tag === 'endif' || tag === 'endfor' || tag === 'endmacro' || tag === 'endset') {
        // Closing tags kept subtle (structural marker, no extra noise)
      } else {
        clauses.push({ kind: 'stmt', depth, raw: tok.raw, english: `${tag} ${tok.rest}`.trim(), evalExpr: null, entities: ents, concepts });
        if (tag === 'macro' || (tag === 'set' && tok.blockSet)) depth++;
      }
      continue;
    }
    if (tok.kind === 'expr') {
      const desc = describeExpr(tok.body, nm);
      clauses.push({
        kind: 'expr', depth, raw: tok.raw,
        english: phraseExprAction(tok.body, desc, definedVars),
        evalExpr: depth === 0 ? `${setLines.join('')}{{ (${tok.body}) }}` : null,
        entities: ents, concepts,
      });
    }
  }

  // Generate a crisp 1-sentence summary
  let summary = '';
  const exprs = clauses.filter((c) => c.kind === 'expr');
  const ifs = clauses.filter((c) => c.kind === 'if' || c.kind === 'elif');
  const entsLabel = allEntities.size === 1 ? '1 entity' : `${allEntities.size} entities`;
  if (!text.trim()) summary = T('ts_sum_empty');
  else if (!TPL_RE.test(text)) summary = T('ts_sum_plain');
  else if (ifs.length > 0) summary = T('ts_sum_branch', { n: ifs.length + 1, ents: entsLabel });
  else if (exprs.length === 1 && clauses.filter((c) => c.kind === 'set').length === 0) summary = exprs[0].english;
  else summary = T('ts_sum_steps', { steps: clauses.length, ents: entsLabel });

  return {
    summary,
    clauses,
    entities: [...allEntities],
    concepts: [...conceptSet].filter((k) => JINJA_GLOSSARY[k]).map((k) => Object.assign({ key: k }, JINJA_GLOSSARY[k])),
    warnings: lintTemplate(text),
  };
}

// Build a single render_template payload that evaluates every top-level evaluable clause in ONE round-trip.
export function buildExplainProbe(clauses) {
  const evals = [];
  clauses.forEach((c, idx) => { if (c.evalExpr) evals.push({ idx, expr: c.evalExpr }); });
  if (!evals.length) return null;
  const parts = evals.map((e, i) => `{%- set _fb_c_${i} -%}${e.expr}{%- endset -%}`).join('');
  const arr = evals.map((_, i) => `_fb_c_${i}`).join(', ');
  return {
    indices: evals.map((e) => e.idx),
    template: `${parts}{{ [${arr}] | tojson }}`,
  };
}

// ---- Extract templates from any automation or script config ----

export function extractTemplatesFromConfig(cfg) {
  const out = [];
  if (!cfg || typeof cfg !== 'object') return out;
  const walk = (v, path) => {
    if (typeof v === 'string') {
      if (TPL_RE.test(v)) out.push({ place: path.join(' › ') || 'template', template: v });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        const tag = x && typeof x === 'object' ? (x.alias || x.trigger || x.platform || x.condition || x.action || x.service || `#${i + 1}`) : `#${i + 1}`;
        walk(x, path.concat([`${tag}`]));
      });
      return;
    }
    if (v && typeof v === 'object') {
      Object.entries(v).forEach(([k, x]) => {
        if (k === 'description' || k === 'id') return;
        walk(x, path.concat([k]));
      });
    }
  };
  walk(cfg, []);
  return out;
}

// ---- 9 Guided Template Helper Recipes (#2–#10) ----

const cleanEntList = (v, max = 50) => [...new Set(toList(v).map(String).filter((x) => EXACT_RE.test(x)))].slice(0, max);
const cleanStr = (v, max = 160) => String(v == null ? '' : v).slice(0, max);
const qStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const qList = (xs) => `[${xs.map(qStr).join(', ')}]`;
const numVal = (v, d, min = -1e9, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export const TPL_RECIPES = {
  // #2 Count matching entities
  tpl_count: {
    kind: 'tpl_count',
    domain: 'sensor',
    icon: 'mdi:counter',
    defaultSpec: () => ({ scope: 'entities', entities: [], domain: 'light', area: '', label: '', states: ['on'], format: 'number', phrase: '{n} on', ignoreUnavailable: true }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const st = toList(src.states).map((x) => cleanStr(x, 64).trim()).filter(Boolean).slice(0, 10);
      return {
        scope: ['entities', 'domain', 'area', 'label'].includes(src.scope) ? src.scope : 'entities',
        entities: cleanEntList(src.entities),
        domain: /^[a-z_]{1,40}$/.test(String(src.domain || '')) ? String(src.domain) : 'light',
        area: cleanStr(src.area, 80).trim(),
        label: cleanStr(src.label, 80).trim(),
        states: st.length ? st : ['on'],
        format: src.format === 'phrase' ? 'phrase' : 'number',
        phrase: cleanStr(src.phrase || '{n} on', 120),
        ignoreUnavailable: src.ignoreUnavailable !== false,
      };
    },
    validate(s) {
      if (s.scope === 'entities' && !s.entities.length) return T('ts_need_entities');
      if (s.scope === 'area' && !s.area) return T('ts_need_area');
      if (s.scope === 'label' && !s.label) return T('ts_need_label');
      if (!s.states.length) return T('ts_need_states');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const srcExpr = s.scope === 'domain' ? `states.${s.domain}`
        : s.scope === 'area' ? `expand(area_entities(${qStr(s.area)})) | selectattr('domain', 'eq', ${qStr(s.domain)})`
          : s.scope === 'label' ? `expand(label_entities(${qStr(s.label)})) | selectattr('domain', 'eq', ${qStr(s.domain)})`
            : `expand(${qList(s.entities)})`;
      const filt = s.ignoreUnavailable ? " | rejectattr('state', 'in', ['unavailable', 'unknown'])" : '';
      const stCheck = s.states.length === 1 ? `selectattr('state', 'eq', ${qStr(s.states[0])})` : `selectattr('state', 'in', ${qList(s.states)})`;
      const lines = [
        `{% set items = ${srcExpr}${filt} | list %}`,
        `{% set n = items | ${stCheck} | list | count %}`,
      ];
      if (s.format === 'phrase') {
        const parts = s.phrase.split('{n}');
        const expr = parts.length === 2 ? `${parts[0] ? qStr(parts[0]) + ' ~ ' : ''}n${parts[1] ? ' ~ ' + qStr(parts[1]) : ''}` : qStr(s.phrase);
        lines.push(`{{ ${expr} }}`);
      } else {
        lines.push('{{ n }}');
      }
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: s.scope === 'entities' && s.entities.length && s.ignoreUnavailable ? `{{ ${s.entities.map((e) => `has_value(${qStr(e)})`).join(' or ')} }}` : '',
        unit: '',
        device_class: '',
        state_class: s.format === 'number' ? 'measurement' : '',
        icon: 'mdi:counter',
      };
    },
  },

  // #3 Any or all (binary_sensor)
  tpl_any_all: {
    kind: 'tpl_any_all',
    domain: 'binary_sensor',
    icon: 'mdi:checkbox-multiple-marked-outline',
    defaultSpec: () => ({ entities: [], mode: 'any', states: ['on'], device_class: '', requireAllAvailable: false }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const st = toList(src.states).map((x) => cleanStr(x, 64).trim()).filter(Boolean).slice(0, 10);
      return {
        entities: cleanEntList(src.entities),
        mode: src.mode === 'all' ? 'all' : 'any',
        states: st.length ? st : ['on'],
        device_class: /^[a-z_]{0,40}$/.test(String(src.device_class || '')) ? String(src.device_class || '') : '',
        requireAllAvailable: !!src.requireAllAvailable,
      };
    },
    validate(s) {
      if (!s.entities.length) return T('ts_need_entities');
      if (!s.states.length) return T('ts_need_states');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const stCheck = s.states.length === 1 ? `selectattr('state', 'eq', ${qStr(s.states[0])})` : `selectattr('state', 'in', ${qList(s.states)})`;
      const lines = [
        `{% set valid = expand(${qList(s.entities)}) | rejectattr('state', 'in', ['unavailable', 'unknown']) | list %}`,
        `{% set matched = valid | ${stCheck} | list %}`,
        s.mode === 'all' ? '{{ valid | count > 0 and matched | count == valid | count }}' : '{{ matched | count > 0 }}',
      ];
      const joinOp = s.requireAllAvailable ? ' and ' : ' or ';
      return {
        domain: 'binary_sensor',
        state: lines.join('\n'),
        availability: `{{ ${s.entities.map((e) => `has_value(${qStr(e)})`).join(joinOp)} }}`,
        unit: '',
        device_class: s.device_class,
        state_class: '',
        icon: 'mdi:checkbox-multiple-marked-outline',
      };
    },
  },

  // #4 List matching names
  tpl_list_names: {
    kind: 'tpl_list_names',
    domain: 'sensor',
    icon: 'mdi:format-list-text',
    defaultSpec: () => ({ entities: [], states: ['on', 'open'], prefix: 'Open: ', sep: ', ', emptyText: 'All closed' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const st = toList(src.states).map((x) => cleanStr(x, 64).trim()).filter(Boolean).slice(0, 10);
      return {
        entities: cleanEntList(src.entities),
        states: st.length ? st : ['on', 'open'],
        prefix: cleanStr(src.prefix, 60),
        sep: cleanStr(src.sep == null ? ', ' : src.sep, 16) || ', ',
        emptyText: cleanStr(src.emptyText == null ? 'None' : src.emptyText, 80),
      };
    },
    validate(s) {
      if (!s.entities.length) return T('ts_need_entities');
      if (!s.states.length) return T('ts_need_states');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const stCheck = s.states.length === 1 ? `selectattr('state', 'eq', ${qStr(s.states[0])})` : `selectattr('state', 'in', ${qList(s.states)})`;
      const lines = [
        `{% set names = expand(${qList(s.entities)}) | ${stCheck} | map(attribute='name') | list %}`,
        `{% if names | count > 0 %}`,
        `  {{ ${s.prefix ? qStr(s.prefix) + ' ~ ' : ''}(names | join(${qStr(s.sep)})) }}`,
        '{% else %}',
        `  {{ ${qStr(s.emptyText)} }}`,
        '{% endif %}',
      ];
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: `{{ ${s.entities.map((e) => `has_value(${qStr(e)})`).join(' or ')} }}`,
        unit: '',
        device_class: '',
        state_class: '',
        icon: 'mdi:format-list-text',
      };
    },
  },

  // #5 How long in state
  tpl_duration: {
    kind: 'tpl_duration',
    domain: 'sensor',
    icon: 'mdi:timer-sand',
    defaultSpec: () => ({ entity: '', targetState: 'open', format: 'readable', inactiveText: 'Closed' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        entity: EXACT_RE.test(String(src.entity || '')) ? String(src.entity) : '',
        targetState: cleanStr(src.targetState || 'on', 64).trim() || 'on',
        format: ['minutes', 'hours', 'readable'].includes(src.format) ? src.format : 'readable',
        inactiveText: cleanStr(src.inactiveText == null ? 'Not active' : src.inactiveText, 64),
      };
    },
    validate(s) {
      if (!s.entity) return T('ts_need_entity');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const [dom, obj] = s.entity.split('.');
      const lines = [
        `{% if is_state(${qStr(s.entity)}, ${qStr(s.targetState)}) %}`,
        `  {% set mins = ((as_timestamp(now()) - as_timestamp(states.${dom}.${obj}.last_changed, as_timestamp(now()))) / 60) | int(0) %}`,
      ];
      if (s.format === 'minutes') {
        lines.push('  {{ mins }}', '{% else %}', '  0', '{% endif %}');
      } else if (s.format === 'hours') {
        lines.push('  {{ (mins / 60) | round(1) }}', '{% else %}', '  0', '{% endif %}');
      } else {
        lines.push(
          '  {% set h = mins // 60 %}',
          '  {% set m = mins % 60 %}',
          "  {{ (h ~ 'h ' ~ m ~ 'm') if h > 0 else (m ~ ' min') }}",
          '{% else %}',
          `  {{ ${qStr(s.inactiveText)} }}`,
          '{% endif %}',
        );
      }
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: `{{ has_value(${qStr(s.entity)}) }}`,
        unit: s.format === 'minutes' ? 'min' : s.format === 'hours' ? 'h' : '',
        device_class: s.format === 'readable' ? '' : 'duration',
        state_class: s.format === 'readable' ? '' : 'measurement',
        icon: 'mdi:timer-sand',
      };
    },
  },

  // #6 Fallback value
  tpl_fallback: {
    kind: 'tpl_fallback',
    domain: 'sensor',
    icon: 'mdi:backup-restore',
    defaultSpec: () => ({ entities: [], fallback: '', numeric: false, unit: '', round: 1 }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        entities: cleanEntList(src.entities, 10),
        fallback: cleanStr(src.fallback, 80),
        numeric: !!src.numeric,
        unit: cleanStr(src.unit, 20).trim(),
        round: Math.min(4, Math.max(0, Math.round(numVal(src.round, 1, 0, 4)))),
      };
    },
    validate(s) {
      if (s.entities.length < 2) return T('ts_need_two_entities');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const valOf = (e) => (s.numeric ? `states(${qStr(e)}) | float(0) | round(${s.round})` : `states(${qStr(e)})`);
      const lines = [];
      s.entities.forEach((e, i) => {
        lines.push(`{% ${i === 0 ? 'if' : 'elif'} has_value(${qStr(e)}) %}`);
        lines.push(`  {{ ${valOf(e)} }}`);
      });
      lines.push('{% else %}');
      lines.push(`  {{ ${s.fallback !== '' ? qStr(s.fallback) : "'unknown'"} }}`);
      lines.push('{% endif %}');
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: s.fallback !== '' ? '' : `{{ ${s.entities.map((e) => `has_value(${qStr(e)})`).join(' or ')} }}`,
        unit: s.unit,
        device_class: '',
        state_class: s.numeric ? 'measurement' : '',
        icon: 'mdi:backup-restore',
      };
    },
  },

  // #7 Low batteries
  tpl_low_battery: {
    kind: 'tpl_low_battery',
    domain: 'sensor',
    icon: 'mdi:battery-alert-variant-outline',
    defaultSpec: () => ({ threshold: 20, scope: 'all', entities: [], output: 'both', emptyText: 'All batteries OK' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        threshold: Math.round(numVal(src.threshold, 20, 1, 99)),
        scope: src.scope === 'entities' ? 'entities' : 'all',
        entities: cleanEntList(src.entities),
        output: ['count', 'list', 'both'].includes(src.output) ? src.output : 'both',
        emptyText: cleanStr(src.emptyText == null ? 'All batteries OK' : src.emptyText, 80),
      };
    },
    validate(s) {
      if (s.scope === 'entities' && !s.entities.length) return T('ts_need_entities');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const pool = s.scope === 'entities'
        ? `expand(${qList(s.entities)})`
        : "states.sensor | selectattr('attributes.device_class', 'defined') | selectattr('attributes.device_class', 'eq', 'battery')";
      const lines = [
        `{% set ns = namespace(low=[]) %}`,
        `{% for e in ${pool} | rejectattr('state', 'in', ['unavailable', 'unknown']) %}`,
        `  {% if e.state | float(100) < ${s.threshold} %}`,
        `    {% set ns.low = ns.low + [e.name ~ ' (' ~ (e.state | int(0)) ~ '%)'] %}`,
        '  {% endif %}',
        '{% endfor %}',
      ];
      if (s.output === 'count') {
        lines.push('{{ ns.low | count }}');
      } else if (s.output === 'list') {
        lines.push(`{{ ns.low | join(', ') if ns.low | count > 0 else ${qStr(s.emptyText)} }}`);
      } else {
        lines.push(`{{ (ns.low | count ~ ': ' ~ (ns.low | join(', '))) if ns.low | count > 0 else ${qStr(s.emptyText)} }}`);
      }
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: '',
        unit: '',
        device_class: '',
        state_class: s.output === 'count' ? 'measurement' : '',
        icon: 'mdi:battery-alert-variant-outline',
      };
    },
  },

  // #8 Comfort / Numeric band
  tpl_band: {
    kind: 'tpl_band',
    domain: 'sensor',
    icon: 'mdi:gauge',
    defaultSpec: () => ({
      entity: '',
      bands: [{ max: 18, label: 'Cold' }, { max: 24, label: 'Comfortable' }],
      aboveLabel: 'Warm',
    }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const bands = (Array.isArray(src.bands) ? src.bands : []).slice(0, 6)
        .filter((b) => b && Number.isFinite(Number(b.max)) && cleanStr(b.label, 48).trim())
        .map((b) => ({ max: Number(b.max), label: cleanStr(b.label, 48).trim() }))
        .sort((a, b) => a.max - b.max);
      return {
        entity: EXACT_RE.test(String(src.entity || '')) ? String(src.entity) : '',
        bands: bands.length ? bands : [{ max: 18, label: 'Cold' }, { max: 24, label: 'Comfortable' }],
        aboveLabel: cleanStr(src.aboveLabel || 'High', 48).trim() || 'High',
      };
    },
    validate(s) {
      if (!s.entity) return T('ts_need_entity');
      if (!s.bands.length) return T('ts_need_bands');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const lines = [`{% set v = states(${qStr(s.entity)}) | float(0) %}`];
      s.bands.forEach((b, i) => {
        lines.push(`{% ${i === 0 ? 'if' : 'elif'} v <= ${b.max} %}`);
        lines.push(`  ${b.label}`);
      });
      lines.push('{% else %}', `  ${s.aboveLabel}`, '{% endif %}');
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: `{{ has_value(${qStr(s.entity)}) }}`,
        unit: '',
        device_class: '',
        state_class: '',
        icon: 'mdi:gauge',
      };
    },
  },

  // #9 Combine & Math (mean / min / max / sum / diff)
  tpl_math: {
    kind: 'tpl_math',
    domain: 'sensor',
    icon: 'mdi:calculator-variant-outline',
    defaultSpec: () => ({ entities: [], op: 'mean', round: 1, unit: '' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        entities: cleanEntList(src.entities, 30),
        op: ['mean', 'min', 'max', 'sum', 'diff'].includes(src.op) ? src.op : 'mean',
        round: Math.min(4, Math.max(0, Math.round(numVal(src.round, 1, 0, 4)))),
        unit: cleanStr(src.unit, 20).trim(),
      };
    },
    validate(s) {
      if (s.entities.length < 2) return T('ts_need_two_entities');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      if (s.op === 'diff') {
        const [a, b] = s.entities;
        return {
          domain: 'sensor',
          state: `{{ (states(${qStr(a)}) | float(0) - states(${qStr(b)}) | float(0)) | round(${s.round}) }}`,
          availability: `{{ has_value(${qStr(a)}) and has_value(${qStr(b)}) }}`,
          unit: s.unit,
          device_class: '',
          state_class: 'measurement',
          icon: 'mdi:calculator-variant-outline',
        };
      }
      const opExpr = {
        mean: `(vals | sum / (vals | count)) | round(${s.round})`,
        min: `(vals | min) | round(${s.round})`,
        max: `(vals | max) | round(${s.round})`,
        sum: `(vals | sum) | round(${s.round})`,
      }[s.op];
      const lines = [
        `{% set vals = expand(${qList(s.entities)}) | map(attribute='state') | map('float', none) | reject('none') | list %}`,
        `{{ ${opExpr} if vals | count > 0 else 'unknown' }}`,
      ];
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: `{{ ${s.entities.map((e) => `has_value(${qStr(e)})`).join(' or ')} }}`,
        unit: s.unit,
        device_class: '',
        state_class: 'measurement',
        icon: 'mdi:calculator-variant-outline',
      };
    },
  },

  // #10 Time window / Schedule (binary_sensor)
  tpl_time_window: {
    kind: 'tpl_time_window',
    domain: 'binary_sensor',
    icon: 'mdi:clock-check-outline',
    defaultSpec: () => ({ from: '22:00', to: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const from = HHMM_RE.test(src.from) ? src.from : '22:00';
      const to = HHMM_RE.test(src.to) ? src.to : '07:00';
      const days = [...new Set(toList(src.days).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
      return { from, to, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
    },
    validate(s) {
      if (s.from === s.to) return T('ts_need_diff_times');
      if (!s.days.length) return T('ts_need_days');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const timeCond = s.from > s.to
        ? `now() >= today_at(${qStr(s.from)}) or now() < today_at(${qStr(s.to)})`
        : `today_at(${qStr(s.from)}) <= now() < today_at(${qStr(s.to)})`;
      const allDays = s.days.length === 7;
      const lines = allDays
        ? [`{{ ${timeCond} }}`]
        : [
          `{% set in_time = ${timeCond} %}`,
          `{% set in_day = now().weekday() in [${s.days.join(', ')}] %}`,
          '{{ in_time and in_day }}',
        ];
      return {
        domain: 'binary_sensor',
        state: lines.join('\n'),
        availability: '',
        unit: '',
        device_class: '',
        state_class: '',
        icon: 'mdi:clock-check-outline',
      };
    },
  },

  // #11 Number check / Compare two sensors (binary_sensor)
  tpl_compare: {
    kind: 'tpl_compare',
    domain: 'binary_sensor',
    icon: 'mdi:scale-balance',
    defaultSpec: () => ({ mode: 'threshold', entityA: '', op: 'gt', value: 25, valueMax: 30, entityB: '', device_class: '' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        mode: src.mode === 'entities' ? 'entities' : 'threshold',
        entityA: EXACT_RE.test(String(src.entityA || '')) ? String(src.entityA) : '',
        op: ['gt', 'ge', 'lt', 'le', 'between'].includes(src.op) ? src.op : 'gt',
        value: numVal(src.value, 25),
        valueMax: numVal(src.valueMax, 30),
        entityB: EXACT_RE.test(String(src.entityB || '')) ? String(src.entityB) : '',
        device_class: /^[a-z_]{0,40}$/.test(String(src.device_class || '')) ? String(src.device_class || '') : '',
      };
    },
    validate(s) {
      if (!s.entityA) return T('ts_need_entity');
      if (s.mode === 'entities' && !s.entityB) return T('ts_need_two_entities');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const sym = { gt: '>', ge: '>=', lt: '<', le: '<=' }[s.op] || '>';
      if (s.mode === 'entities') {
        return {
          domain: 'binary_sensor',
          state: [
            `{% set a = states(${qStr(s.entityA)}) | float(0) %}`,
            `{% set b = states(${qStr(s.entityB)}) | float(0) %}`,
            `{{ a ${sym} b }}`,
          ].join('\n'),
          availability: `{{ has_value(${qStr(s.entityA)}) and has_value(${qStr(s.entityB)}) }}`,
          unit: '',
          device_class: s.device_class,
          state_class: '',
          icon: 'mdi:scale-balance',
        };
      }
      const lo = Math.min(s.value, s.valueMax), hi = Math.max(s.value, s.valueMax);
      const expr = s.op === 'between' ? `{{ ${lo} <= v <= ${hi} }}` : `{{ v ${sym} ${s.value} }}`;
      return {
        domain: 'binary_sensor',
        state: [`{% set v = states(${qStr(s.entityA)}) | float(0) %}`, expr].join('\n'),
        availability: `{{ has_value(${qStr(s.entityA)}) }}`,
        unit: '',
        device_class: s.device_class,
        state_class: '',
        icon: 'mdi:scale-balance',
      };
    },
  },

  // #12 Custom text summary mixing plain words and live sensor values (sensor)
  tpl_message: {
    kind: 'tpl_message',
    domain: 'sensor',
    icon: 'mdi:text-box-outline',
    defaultSpec: () => ({ parts: [{ text: 'Status: ', entity: '', fallback: 'offline' }] }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const parts = (Array.isArray(src.parts) ? src.parts : []).slice(0, 8).map((p) => ({
        text: cleanStr(p && p.text, 120),
        entity: p && EXACT_RE.test(String(p.entity || '')) ? String(p.entity) : '',
        fallback: cleanStr(p && p.fallback != null ? p.fallback : 'offline', 40),
      }));
      return { parts: parts.length ? parts : [{ text: 'Status: ', entity: '', fallback: 'offline' }] };
    },
    validate(s) {
      if (!s.parts.some((p) => p.entity || p.text.trim())) return T('ts_need_tpl');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const ents = [];
      const pieces = [];
      s.parts.forEach((p) => {
        if (p.text) pieces.push(p.text);
        if (p.entity) {
          ents.push(p.entity);
          pieces.push(`{{ states(${qStr(p.entity)}) if has_value(${qStr(p.entity)}) else ${qStr(p.fallback || 'unknown')} }}`);
        }
      });
      return {
        domain: 'sensor',
        state: pieces.join(''),
        availability: ents.length ? `{{ ${[...new Set(ents)].map((e) => `has_value(${qStr(e)})`).join(' or ')} }}` : '',
        unit: '',
        device_class: '',
        state_class: '',
        icon: 'mdi:text-box-outline',
      };
    },
  },

  // #13 Before / after sunrise or sunset (handles "16 hours before sunset", triggers, clock display, OR binary window!)
  tpl_sun_offset: {
    kind: 'tpl_sun_offset',
    domain: 'sensor',
    icon: 'mdi:weather-sunset',
    defaultSpec: () => ({ event: 'next_setting', dir: 'before', hours: 16, minutes: 0, output: 'timestamp' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        event: ['next_setting', 'next_rising', 'next_noon', 'next_midnight'].includes(src.event) ? src.event : 'next_setting',
        dir: src.dir === 'after' ? 'after' : 'before',
        hours: Math.min(23, Math.max(0, Math.round(numVal(src.hours, 16, 0, 23)))),
        minutes: Math.min(59, Math.max(0, Math.round(numVal(src.minutes, 0, 0, 59)))),
        output: ['timestamp', 'clock12', 'clock24', 'binary'].includes(src.output) ? src.output : 'timestamp',
      };
    },
    validate(s) {
      if (s.hours === 0 && s.minutes === 0) return T('ts_need_offset');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const tdParts = [];
      if (s.hours) tdParts.push(`hours=${s.hours}`);
      if (s.minutes) tdParts.push(`minutes=${s.minutes}`);
      const td = `timedelta(${tdParts.join(', ') || 'minutes=0'})`;
      const avail = `{{ state_attr('sun.sun', ${qStr(s.event)}) is not none }}`;
      const base = `{% set sun_dt = as_local(as_datetime(state_attr('sun.sun', ${qStr(s.event)}))) %}`;
      if (s.dir === 'after') {
        if (s.output === 'binary') {
          return {
            domain: 'binary_sensor',
            state: [
              `{% set prev_dt = as_local(as_datetime(state_attr('sun.sun', ${qStr(s.event)}))) - timedelta(days=1) %}`,
              `{% set target = prev_dt + ${td} %}`,
              '{{ prev_dt <= now() < target }}',
            ].join('\n'),
            availability: avail, unit: '', device_class: '', state_class: '', icon: 'mdi:weather-sunset',
          };
        }
        if (s.output === 'clock12' || s.output === 'clock24') {
          const fmt = s.output === 'clock12' ? '%I:%M %p' : '%H:%M';
          return {
            domain: 'sensor',
            state: [base, `{% set target = sun_dt + ${td} %}`, `{{ target.strftime(${qStr(fmt)}) }}`].join('\n'),
            availability: avail, unit: '', device_class: '', state_class: '', icon: 'mdi:weather-sunset',
          };
        }
        return {
          domain: 'sensor',
          state: [
            base,
            `{% set prev_target = sun_dt - timedelta(days=1) + ${td} %}`,
            `{% set target = prev_target if now() <= prev_target + timedelta(minutes=1) else sun_dt + ${td} %}`,
            '{{ target.isoformat() }}',
          ].join('\n'),
          availability: avail, unit: '', device_class: 'timestamp', state_class: '', icon: 'mdi:weather-sunset',
        };
      }
      const target = `{% set target = sun_dt - ${td} %}`;
      if (s.output === 'binary') {
        return { domain: 'binary_sensor', state: [base, target, '{{ now() >= target }}'].join('\n'), availability: avail, unit: '', device_class: '', state_class: '', icon: 'mdi:weather-sunset' };
      }
      if (s.output === 'clock12' || s.output === 'clock24') {
        const fmt = s.output === 'clock12' ? '%I:%M %p' : '%H:%M';
        return { domain: 'sensor', state: [base, target, `{{ target.strftime(${qStr(fmt)}) }}`].join('\n'), availability: avail, unit: '', device_class: '', state_class: '', icon: 'mdi:weather-sunset' };
      }
      return { domain: 'sensor', state: [base, target, '{{ target.isoformat() }}'].join('\n'), availability: avail, unit: '', device_class: 'timestamp', state_class: '', icon: 'mdi:weather-sunset' };
    },
  },

  // #14 Countdown / time until or since a date, calendar, or input_datetime
  tpl_countdown: {
    kind: 'tpl_countdown',
    domain: 'sensor',
    icon: 'mdi:calendar-clock',
    defaultSpec: () => ({ source: 'entity', entity: '', dateStr: '2027-01-01', dir: 'until', unit: 'days' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        source: src.source === 'fixed' ? 'fixed' : 'entity',
        entity: EXACT_RE.test(String(src.entity || '')) ? String(src.entity) : '',
        dateStr: /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(String(src.dateStr || '').trim()) ? String(src.dateStr).trim() : '2027-01-01',
        dir: src.dir === 'since' ? 'since' : 'until',
        unit: ['days', 'hours', 'minutes', 'readable'].includes(src.unit) ? src.unit : 'days',
      };
    },
    validate(s) {
      if (s.source === 'entity' && !s.entity) return T('ts_need_entity');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const isCal = s.source === 'entity' && s.entity.startsWith('calendar.');
      const dtExpr = s.source === 'fixed'
        ? `as_local(as_datetime(${qStr(s.dateStr)}))`
        : isCal ? `as_local(as_datetime(state_attr(${qStr(s.entity)}, 'start_time')))`
          : `as_local(as_datetime(states(${qStr(s.entity)})))`;
      const avail = s.source === 'fixed' ? ''
        : isCal ? `{{ state_attr(${qStr(s.entity)}, 'start_time') is not none }}`
          : `{{ has_value(${qStr(s.entity)}) }}`;
      const diffLine = s.dir === 'since'
        ? '{% set secs = (as_timestamp(now()) - as_timestamp(dt, as_timestamp(now()))) | int(0) %}'
        : '{% set secs = (as_timestamp(dt, as_timestamp(now())) - as_timestamp(now())) | int(0) %}';
      const lines = [`{% set dt = ${dtExpr} %}`, diffLine];
      if (s.unit === 'days') lines.push('{{ (secs / 86400) | round(1) }}');
      else if (s.unit === 'hours') lines.push('{{ (secs / 3600) | round(1) }}');
      else if (s.unit === 'minutes') lines.push('{{ (secs / 60) | int(0) }}');
      else {
        lines.push(
          '{% set a = secs | abs %}',
          '{% set d = a // 86400 %}',
          '{% set h = (a % 86400) // 3600 %}',
          '{% set m = (a % 3600) // 60 %}',
          "{{ (d ~ 'd ' ~ h ~ 'h') if d > 0 else ((h ~ 'h ' ~ m ~ 'm') if h > 0 else (m ~ ' min')) }}",
        );
      }
      const unitMap = { days: 'd', hours: 'h', minutes: 'min', readable: '' };
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: avail,
        unit: unitMap[s.unit],
        device_class: s.unit === 'readable' ? '' : 'duration',
        state_class: s.unit === 'readable' ? '' : 'measurement',
        icon: 'mdi:calendar-clock',
      };
    },
  },

  // #15 Extract an entity attribute (brightness -> %, HVAC action, position, media title, etc.)
  tpl_attribute: {
    kind: 'tpl_attribute',
    domain: 'sensor',
    icon: 'mdi:tag-text-outline',
    defaultSpec: () => ({ entity: '', attr: '', transform: 'raw', fallback: 'None', round: 1, unit: '' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      return {
        entity: EXACT_RE.test(String(src.entity || '')) ? String(src.entity) : '',
        attr: cleanStr(src.attr, 80).trim(),
        transform: ['raw', 'number', 'pct255', 'title'].includes(src.transform) ? src.transform : 'raw',
        fallback: cleanStr(src.fallback == null ? 'None' : src.fallback, 64),
        round: Math.min(4, Math.max(0, Math.round(numVal(src.round, 1, 0, 4)))),
        unit: cleanStr(src.unit, 20).trim(),
      };
    },
    validate(s) {
      if (!s.entity) return T('ts_need_entity');
      if (!s.attr) return T('ts_need_attr');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const lines = [`{% set val = state_attr(${qStr(s.entity)}, ${qStr(s.attr)}) %}`];
      let outExpr = 'val';
      if (s.transform === 'pct255') outExpr = '(val | float(0) / 255 * 100) | round(0)';
      else if (s.transform === 'number') outExpr = `val | float(0) | round(${s.round})`;
      else if (s.transform === 'title') outExpr = "val | string | replace('_', ' ') | title";
      const fb = s.transform === 'pct255' || s.transform === 'number' ? '0' : qStr(s.fallback);
      lines.push(`{{ ${outExpr} if val is not none else ${fb} }}`);
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: `{{ has_value(${qStr(s.entity)}) }}`,
        unit: s.transform === 'pct255' ? '%' : s.unit,
        device_class: '',
        state_class: s.transform === 'pct255' || s.transform === 'number' ? 'measurement' : '',
        icon: 'mdi:tag-text-outline',
      };
    },
  },

  // #16 Convert, scale, or calculate from a numeric sensor (W->kW, C->F, cost rate, calibration offset)
  tpl_scale: {
    kind: 'tpl_scale',
    domain: 'sensor',
    icon: 'mdi:tune-vertical',
    defaultSpec: () => ({ entity: '', preset: 'w_to_kw', mult: 1, offset: 0, round: 2, unit: '' }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const preset = ['w_to_kw', 'kw_to_w', 'c_to_f', 'f_to_c', 'rate', 'custom'].includes(src.preset) ? src.preset : 'w_to_kw';
      return {
        entity: EXACT_RE.test(String(src.entity || '')) ? String(src.entity) : '',
        preset,
        mult: numVal(src.mult, 1),
        offset: numVal(src.offset, 0),
        round: Math.min(4, Math.max(0, Math.round(numVal(src.round, 2, 0, 4)))),
        unit: cleanStr(src.unit, 20).trim(),
      };
    },
    validate(s) {
      if (!s.entity) return T('ts_need_entity');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      let expr, unit = s.unit, dc = '';
      if (s.preset === 'w_to_kw') { expr = `(v / 1000) | round(${s.round})`; unit = unit || 'kW'; dc = 'power'; }
      else if (s.preset === 'kw_to_w') { expr = `(v * 1000) | round(${s.round})`; unit = unit || 'W'; dc = 'power'; }
      else if (s.preset === 'c_to_f') { expr = `((v * 9 / 5) + 32) | round(${s.round})`; unit = unit || '°F'; dc = 'temperature'; }
      else if (s.preset === 'f_to_c') { expr = `((v - 32) * 5 / 9) | round(${s.round})`; unit = unit || '°C'; dc = 'temperature'; }
      else if (s.preset === 'rate') { expr = `(v * ${s.mult}) | round(${s.round})`; unit = unit || '$'; }
      else {
        const off = s.offset === 0 ? '' : (s.offset > 0 ? ` + ${s.offset}` : ` - ${Math.abs(s.offset)}`);
        expr = `(v * ${s.mult}${off}) | round(${s.round})`;
      }
      return {
        domain: 'sensor',
        state: [`{% set v = states(${qStr(s.entity)}) | float(0) %}`, `{{ ${expr} }}`].join('\n'),
        availability: `{{ has_value(${qStr(s.entity)}) }}`,
        unit,
        device_class: dc,
        state_class: 'measurement',
        icon: 'mdi:tune-vertical',
      };
    },
  },

  // #17 Combine multiple different conditions with AND / OR
  tpl_logic: {
    kind: 'tpl_logic',
    domain: 'binary_sensor',
    icon: 'mdi:source-branch',
    defaultSpec: () => ({
      join: 'and',
      rules: [{ entity: '', op: 'eq', value: 'on' }, { entity: '', op: 'eq', value: 'on' }],
      asText: false,
      trueText: 'Active',
      falseText: 'Normal',
    }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const ops = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'avail'];
      const rules = (Array.isArray(src.rules) ? src.rules : []).slice(0, 8).map((r) => ({
        entity: r && EXACT_RE.test(String(r.entity || '')) ? String(r.entity) : '',
        op: r && ops.includes(r.op) ? r.op : 'eq',
        value: cleanStr(r && r.value != null ? r.value : 'on', 64).trim(),
      }));
      while (rules.length < 2) rules.push({ entity: '', op: 'eq', value: 'on' });
      return {
        join: src.join === 'or' ? 'or' : 'and',
        rules,
        asText: !!src.asText,
        trueText: cleanStr(src.trueText || 'Active', 64),
        falseText: cleanStr(src.falseText || 'Normal', 64),
      };
    },
    validate(s) {
      const active = s.rules.filter((r) => r.entity);
      if (active.length < 1) return T('ts_need_entities');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const active = s.rules.filter((r) => r.entity);
      const exprOf = (r) => {
        if (r.op === 'eq') return `is_state(${qStr(r.entity)}, ${qStr(r.value)})`;
        if (r.op === 'ne') return `not is_state(${qStr(r.entity)}, ${qStr(r.value)})`;
        if (r.op === 'avail') return `has_value(${qStr(r.entity)})`;
        const sym = { gt: '>', ge: '>=', lt: '<', le: '<=' }[r.op] || '>';
        return `states(${qStr(r.entity)}) | float(0) ${sym} ${numVal(r.value, 0)}`;
      };
      const lines = active.map((r, i) => `{% set c${i + 1} = ${exprOf(r)} %}`);
      const joined = active.map((_, i) => `c${i + 1}`).join(` ${s.join} `);
      lines.push(s.asText ? `{{ ${qStr(s.trueText)} if (${joined}) else ${qStr(s.falseText)} }}` : `{{ ${joined} }}`);
      const ents = [...new Set(active.filter((r) => r.op !== 'avail').map((r) => r.entity))];
      return {
        domain: s.asText ? 'sensor' : 'binary_sensor',
        state: lines.join('\n'),
        availability: ents.length ? `{{ ${ents.map((e) => `has_value(${qStr(e)})`).join(' and ')} }}` : '',
        unit: '',
        device_class: '',
        state_class: '',
        icon: 'mdi:source-branch',
      };
    },
  },

  // #18 Translate raw entity states into friendly words
  tpl_map_state: {
    kind: 'tpl_map_state',
    domain: 'sensor',
    icon: 'mdi:translate',
    defaultSpec: () => ({
      entity: '',
      rows: [{ from: 'on', to: 'Active' }, { from: 'off', to: 'Idle' }],
      fallback: 'Unknown',
    }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const rows = (Array.isArray(src.rows) ? src.rows : []).slice(0, 12).map((r) => ({
        from: cleanStr(r && r.from, 64).trim(),
        to: cleanStr(r && r.to, 80).trim(),
      }));
      return {
        entity: EXACT_RE.test(String(src.entity || '')) ? String(src.entity) : '',
        rows: rows.length ? rows : [{ from: 'on', to: 'Active' }, { from: 'off', to: 'Idle' }],
        fallback: cleanStr(src.fallback == null ? 'Unknown' : src.fallback, 80),
      };
    },
    validate(s) {
      if (!s.entity) return T('ts_need_entity');
      if (!s.rows.some((r) => r.from && r.to)) return T('ts_need_states');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const valid = s.rows.filter((r) => r.from && r.to);
      const pairs = valid.map((r) => `${qStr(r.from)}: ${qStr(r.to)}`).join(', ');
      const lines = [
        `{% set labels = {${pairs}} %}`,
        `{{ labels.get(states(${qStr(s.entity)}), ${qStr(s.fallback)}) }}`,
      ];
      return {
        domain: 'sensor',
        state: lines.join('\n'),
        availability: `{{ has_value(${qStr(s.entity)}) }}`,
        unit: '',
        device_class: '',
        state_class: '',
        icon: 'mdi:translate',
      };
    },
  },
};

export function cleanTplRecipe(kind, spec) {
  const r = TPL_RECIPES[kind];
  return r ? r.clean(spec) : null;
}

export function generateTplRecipe(kind, spec) {
  const r = TPL_RECIPES[kind];
  return r ? r.generate(spec) : null;
}

// Reopen check: true while the live entity's state template still matches what the recipe generated (ignoring whitespace).
const normTpl = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function tplSame(liveStateTpl, kind, spec) {
  const gen = generateTplRecipe(kind, spec);
  return !!gen && !!liveStateTpl && normTpl(liveStateTpl) === normTpl(gen.state);
}
