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
  'tpl_low_battery', 'tpl_band', 'tpl_math', 'tpl_time_window',
]);

// Interactive Jinja concept glossary: surfaced alongside explained clauses so users learn HA Jinja as they read/build.
export const JINJA_GLOSSARY = {
  states: {
    syntax: "states('domain.entity')",
    title: 'Read an entity state safely',
    what: 'Returns the entity state as text (always a string, or "unknown" if missing). Safer than states.domain.entity.state, which errors if the entity does not exist yet.',
    example: "states('sensor.living_room_temp')",
  },
  is_state: {
    syntax: "is_state('domain.entity', 'on')",
    title: 'Check if an entity has a state',
    what: 'Returns true if the entity matches the state (or any state in a list), and false otherwise — never crashes when the entity is unavailable.',
    example: "is_state('cover.garage_door', 'open')",
  },
  state_attr: {
    syntax: "state_attr('domain.entity', 'attr')",
    title: 'Read an entity attribute',
    what: 'Reads a single attribute (such as brightness, temperature, or friendly_name), returning none if missing.',
    example: "state_attr('climate.home', 'current_temperature')",
  },
  is_state_attr: {
    syntax: "is_state_attr('domain.entity', 'attr', value)",
    title: 'Check an entity attribute value',
    what: 'Returns true when the attribute equals the given value, safely returning false if the entity or attribute is missing.',
    example: "is_state_attr('cover.garage', 'current_position', 0)",
  },
  has_value: {
    syntax: "has_value('domain.entity')",
    title: 'Guard against unavailable / unknown',
    what: 'Returns true only when the entity exists and its state is neither "unavailable" nor "unknown". The cleanest way to avoid the unavailable trap.',
    example: "has_value('sensor.outdoor_temp')",
  },
  expand: {
    syntax: "expand(['entity_a', 'entity_b'])",
    title: 'Turn entity IDs or groups into full state objects',
    what: 'Expands a list of entity IDs (or groups) into full state objects so you can filter by .state, .name, or .attributes.',
    example: "expand(['light.kitchen', 'light.hall']) | selectattr('state', 'eq', 'on') | list",
  },
  selectattr: {
    syntax: "| selectattr('state', 'eq', 'on')",
    title: 'Keep only matching items',
    what: 'Filters a list of state objects, keeping only those where an attribute passes a test (eq, ne, in, lt, gt, defined).',
    example: "selectattr('state', 'in', ['on', 'open'])",
  },
  rejectattr: {
    syntax: "| rejectattr('state', 'in', ['unavailable', 'unknown'])",
    title: 'Drop matching items',
    what: 'The opposite of selectattr: removes items that match a test (commonly used to skip unavailable or unknown sensors).',
    example: "rejectattr('state', 'in', ['unavailable', 'unknown'])",
  },
  map: {
    syntax: "| map(attribute='name')",
    title: 'Extract one field or apply a filter to each item',
    what: 'Transforms every item in a list — e.g. pulling each entity friendly name or converting every state string to a number.',
    example: "map(attribute='name') | list",
  },
  float: {
    syntax: '| float(0)',
    title: 'Convert text to a decimal number',
    what: 'Turns text like "21.5" into a number so you can compare or do math. Always pass a default like float(0) so "unavailable" does not crash the template.',
    example: "states('sensor.temp') | float(0) > 22",
  },
  int: {
    syntax: '| int(0)',
    title: 'Convert text to a whole number',
    what: 'Turns text into an integer. Always pass a default like int(0) so "unavailable" does not raise an error.',
    example: "states('counter.visits') | int(0)",
  },
  round: {
    syntax: '| round(1)',
    title: 'Round a number',
    what: 'Rounds a numeric value to the chosen number of decimal places.',
    example: '(a + b) / 2 | round(1)',
  },
  list: {
    syntax: '| list',
    title: 'Realize a lazy filter into a list',
    what: 'Filters like selectattr and map produce a generator; piping into | list materializes it so you can count, sort, or join it.',
    example: "selectattr('state', 'eq', 'on') | list | count",
  },
  count: {
    syntax: '| count',
    title: 'Count items in a list',
    what: 'Returns how many items are in a list (same as | length).',
    example: '... | list | count',
  },
  join: {
    syntax: "| join(', ')",
    title: 'Combine a list into one string',
    what: 'Glues list items together with a separator string.',
    example: "names | join(', ')",
  },
  default: {
    syntax: "| default('None', true)",
    title: 'Fallback when empty or undefined',
    what: 'Substitutes a fallback value if the input is undefined (or empty/false when the second argument is true).',
    example: "names | join(', ') | default('All closed', true)",
  },
  iif: {
    syntax: "iif(condition, 'Yes', 'No')",
    title: 'Inline if / else shorthand',
    what: 'Returns the second value when the condition is true, or the third when false (optional fourth value for none/unknown).',
    example: "iif(is_state('cover.garage', 'open'), 'Open', 'Closed')",
  },
  now: {
    syntax: 'now()',
    title: 'Current local date and time',
    what: 'Returns Home Assistant local time as a datetime object. Templates using now() automatically refresh at the top of every minute.',
    example: 'now().hour >= 22',
  },
  today_at: {
    syntax: "today_at('22:00')",
    title: 'A wall-clock time today',
    what: 'Returns a timezone-aware datetime for the given HH:MM time today, making time-window comparisons with now() clean and DST-safe.',
    example: "today_at('07:00') <= now() < today_at('22:00')",
  },
  as_timestamp: {
    syntax: 'as_timestamp(dt, 0)',
    title: 'Convert a date/time to seconds',
    what: 'Converts a datetime or ISO timestamp into Unix seconds so you can subtract timestamps to measure elapsed time.',
    example: '(as_timestamp(now()) - as_timestamp(states.cover.garage.last_changed, 0)) / 60',
  },
  area_entities: {
    syntax: "area_entities('kitchen')",
    title: 'All entities in an area',
    what: 'Returns a list of entity IDs belonging to a Home Assistant area (by area ID or name).',
    example: "expand(area_entities('kitchen'))",
  },
  label_entities: {
    syntax: "label_entities('garage')",
    title: 'All entities with a label',
    what: 'Returns a list of entity IDs carrying a Home Assistant label.',
    example: "expand(label_entities('garage'))",
  },
  namespace: {
    syntax: 'namespace(items=[])',
    title: 'Mutable container inside a loop',
    what: 'Jinja variables set inside a {% for %} loop do not escape the loop unless stored on a namespace object.',
    example: '{% set ns = namespace(low=[]) %}',
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

function describeFilter(part, nm) {
  const fm = /^([a-zA-Z_]\w*)(?:\s*\(([\s\S]*)\))?$/.exec(part.trim());
  if (!fm) return `apply ${part.trim()}`;
  const fn = fm[1], args = fm[2] ? splitArgs(fm[2]) : [];
  switch (fn) {
    case 'float': return args.length ? `convert to a decimal number (default ${args[0]} if not numeric)` : 'convert to a decimal number';
    case 'int': return args.length ? `convert to a whole number (default ${args[0]} if not numeric)` : 'convert to a whole number';
    case 'round': return args.length ? `round to ${args[0]} decimal place${args[0] === '1' ? '' : 's'}` : 'round to the nearest whole number';
    case 'abs': return 'take the positive (absolute) value';
    case 'count': case 'length': return 'count how many items matched';
    case 'list': return 'collect into a list';
    case 'first': return 'take the first item';
    case 'last': return 'take the last item';
    case 'sort': return 'sort in order';
    case 'unique': return 'remove duplicates';
    case 'join': return `join with ${args[0] || "''"}`;
    case 'lower': return 'convert to lowercase';
    case 'upper': return 'convert to uppercase';
    case 'title': return 'capitalize each word';
    case 'trim': return 'trim surrounding spaces';
    case 'default': return `fall back to ${args[0] || "''"} if empty or missing`;
    case 'bool': return args.length ? `convert to true/false (default ${args[0]})` : 'convert to true/false';
    case 'min': return 'pick the smallest value';
    case 'max': return 'pick the largest value';
    case 'sum': return 'add all values together';
    case 'average': return 'compute the average';
    case 'selectattr': {
      const attr = unquote(args[0] || 'state'), op = unquote(args[1] || 'defined'), val = args[2];
      const opWord = { eq: 'equals', equalto: 'equals', ne: 'is not', in: 'is one of', lt: 'is under', le: 'is at most', gt: 'is over', ge: 'is at least', defined: 'is defined' }[op] || op;
      return val != null ? `keep items where ${attr} ${opWord} ${val}` : `keep items where ${attr} ${opWord}`;
    }
    case 'rejectattr': {
      const attr = unquote(args[0] || 'state'), op = unquote(args[1] || 'defined'), val = args[2];
      const opWord = { eq: 'equals', equalto: 'equals', in: 'is one of', ne: 'is not' }[op] || op;
      return val != null ? `skip items where ${attr} ${opWord} ${val}` : `skip items where ${attr} ${opWord}`;
    }
    case 'reject': return args.length ? `drop ${unquote(args[0])} values` : 'drop empty values';
    case 'select': return args.length ? `keep ${unquote(args[0])} values` : 'keep truthy values';
    case 'map': {
      const raw = fm[2] || '';
      const attrM = /attribute\s*=\s*['"]([^'"]+)['"]/.exec(raw);
      if (attrM) return `take each item's ${attrM[1] === 'name' ? 'friendly name' : attrM[1]}`;
      if (args.length) return `apply ${unquote(args[0])} to each item`;
      return 'transform each item';
    }
    case 'as_timestamp': return 'convert to seconds';
    default: return args.length ? `${fn}(${args.join(', ')})` : fn;
  }
}

function describeBase(expr, nm) {
  const s = expr.trim();
  let m;
  if ((m = /^is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(s))) {
    return `${nm(m[1])} is ${m[2].trim()}`;
  }
  if ((m = /^is_state_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+)\)$/.exec(s))) {
    return `${nm(m[1])}'s ${m[2]} is ${m[3].trim()}`;
  }
  if ((m = /^has_value\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `${nm(m[1])} has a valid value (not unavailable/unknown)`;
  }
  if ((m = /^states\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `state of ${nm(m[1])}`;
  }
  if ((m = /^state_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/.exec(s))) {
    return `${m[2]} attribute of ${nm(m[1])}`;
  }
  if ((m = /^expand\s*\(\s*([\s\S]+)\)$/.exec(s))) {
    const ents = extractTemplateEntities(m[1]);
    if (ents.length) return `expand ${ents.length} ${ents.length === 1 ? 'entity' : 'entities'} (${ents.slice(0, 3).map(nm).join(', ')}${ents.length > 3 ? `, +${ents.length - 3} more` : ''})`;
    if (/area_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(m[1])) {
      const am = /area_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(m[1]);
      return `all entities in area "${am[1]}"`;
    }
    if (/label_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(m[1])) {
      const lm = /label_entities\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(m[1]);
      return `all entities with label "${lm[1]}"`;
    }
    return `expand ${m[1].trim()}`;
  }
  if ((m = /^states\.([a-z_]+)$/.exec(s))) return `all ${m[1].replace(/_/g, ' ')} entities`;
  if ((m = /^states\.([a-z_]+\.[a-z0-9_]+)\.last_changed$/.exec(s))) return `when ${nm(m[1])} last changed`;
  if ((m = /^states\.([a-z_]+\.[a-z0-9_]+)\.state$/.exec(s))) return `state of ${nm(m[1])}`;
  if ((m = /^iif\s*\(([\s\S]+)\)$/.exec(s))) {
    const a = splitArgs(m[1]);
    if (a.length >= 3) return `if ${describeExpr(a[0], nm)}, return ${a[1]}; otherwise ${a[2]}`;
  }
  if (/^now\s*\(\s*\)/.test(s)) return s.replace(/now\(\)/g, 'current time');
  if (/^today_at\s*\(/.test(s)) return s.replace(/today_at\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'today at $1');
  if (/^namespace\s*\(/.test(s)) return `create loop container ${s}`;
  // Inline entity names inside comparisons / arithmetic
  return s
    .replace(/\bis_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g, (_, id, v) => `${nm(id)} is ${v.trim()}`)
    .replace(/\bhas_value\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, id) => `${nm(id)} is available`)
    .replace(/\bstates\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, id) => `${nm(id)}`)
    .replace(/\bstate_attr\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g, (_, id, a) => `${nm(id)}'s ${a}`)
    .replace(/\btoday_at\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, t) => t)
    .replace(/\bnow\(\)/g, 'current time');
}

export function describeExpr(expr, nameOf) {
  const nm = (id) => (typeof nameOf === 'function' ? nameOf(id) : id);
  const s = String(expr || '').trim();
  if (!s) return '';
  // Inline Python/Jinja ternary: `A if COND else B`
  const tern = /^([\s\S]+?)\s+\bif\b\s+([\s\S]+?)\s+\belse\b\s+([\s\S]+)$/.exec(s);
  if (tern && !/[()]/.test(tern[2].replace(/\([^()]*\)/g, ''))) {
    return `If ${describeExpr(tern[2], nm)}, output ${describeExpr(tern[1], nm)}; otherwise ${describeExpr(tern[3], nm)}`;
  }
  const parts = splitPipes(s);
  if (parts.length === 1) return describeBase(parts[0], nm);
  const head = describeBase(parts[0], nm);
  const steps = parts.slice(1).map((p) => describeFilter(p, nm));
  return `${head} → ${steps.join(' → ')}`;
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

export function explainTemplate(src, nameOf) {
  const nm = (id) => (typeof nameOf === 'function' ? nameOf(id) : id);
  const text = String(src == null ? '' : src);
  const tokens = parseTemplate(text);
  const clauses = [];
  const allEntities = new Set(extractTemplateEntities(text));
  const conceptSet = new Set();
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
      clauses.push({ kind: 'text', depth, raw: tok.raw.trim(), english: `Literal text: "${tok.raw.trim()}"`, evalExpr: null, entities: [], concepts: [] });
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
        clauses.push({
          kind: 'set', depth, raw: tok.raw, varName: tok.varName,
          english: `Set ${tok.varName} = ${describeExpr(tok.expr, nm)}`,
          evalExpr: `${pre}{{ (${tok.expr}) }}`,
          entities: ents, concepts,
        });
      } else if (tag === 'if') {
        clauses.push({
          kind: 'if', depth, raw: tok.raw,
          english: `If ${describeExpr(tok.rest, nm)}:`,
          evalExpr: `${setLines.join('')}{{ (${tok.rest}) | bool }}`,
          entities: ents, concepts,
        });
        depth++;
      } else if (tag === 'elif') {
        clauses.push({
          kind: 'elif', depth, raw: tok.raw,
          english: `Otherwise, if ${describeExpr(tok.rest, nm)}:`,
          evalExpr: `${setLines.join('')}{{ (${tok.rest}) | bool }}`,
          entities: ents, concepts,
        });
        depth++;
      } else if (tag === 'else') {
        clauses.push({ kind: 'else', depth, raw: tok.raw, english: 'Otherwise:', evalExpr: null, entities: [], concepts: [] });
        depth++;
      } else if (tag === 'for') {
        const fm = /^(.+?)\s+in\s+([\s\S]+)$/.exec(tok.rest);
        clauses.push({
          kind: 'for', depth, raw: tok.raw,
          english: fm ? `For each ${fm[1].trim()} in ${describeExpr(fm[2], nm)}:` : `Loop: ${tok.rest}`,
          evalExpr: fm ? `${setLines.join('')}{{ (${fm[2]}) | list | count }}` : null,
          entities: ents, concepts,
        });
        depth++;
      } else if (tag === 'do') {
        clauses.push({ kind: 'do', depth, raw: tok.raw, english: `Run: ${describeExpr(tok.rest, nm)}`, evalExpr: null, entities: ents, concepts });
      } else if (tag === 'endif' || tag === 'endfor' || tag === 'endmacro' || tag === 'endset') {
        // Closing tags kept subtle (structural marker, no extra noise)
      } else {
        clauses.push({ kind: 'stmt', depth, raw: tok.raw, english: `${tag} ${tok.rest}`.trim(), evalExpr: null, entities: ents, concepts });
        if (tag === 'macro' || (tag === 'set' && tok.blockSet)) depth++;
      }
      continue;
    }
    if (tok.kind === 'expr') {
      clauses.push({
        kind: 'expr', depth, raw: tok.raw,
        english: `Output ${describeExpr(tok.body, nm)}`,
        evalExpr: depth === 0 ? `${setLines.join('')}{{ (${tok.body}) }}` : null,
        entities: ents, concepts,
      });
    }
  }

  // Generate a crisp 1-sentence summary
  let summary = '';
  const exprs = clauses.filter((c) => c.kind === 'expr');
  const ifs = clauses.filter((c) => c.kind === 'if' || c.kind === 'elif');
  if (!text.trim()) summary = T('ts_sum_empty');
  else if (!TPL_RE.test(text)) summary = T('ts_sum_plain');
  else if (ifs.length > 0) summary = T('ts_sum_branch', { n: ifs.length + 1, ents: allEntities.size });
  else if (exprs.length === 1 && clauses.filter((c) => c.kind === 'set').length === 0) summary = exprs[0].english;
  else summary = T('ts_sum_steps', { steps: clauses.length, ents: allEntities.size });

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
    defaultSpec: () => ({ scope: 'entities', entities: [], domain: 'light', area: '', states: ['on'], format: 'number', phrase: '{n} on', ignoreUnavailable: true }),
    clean(s) {
      const src = s && typeof s === 'object' ? s : {};
      const st = toList(src.states).map((x) => cleanStr(x, 64).trim()).filter(Boolean).slice(0, 10);
      return {
        scope: ['entities', 'domain', 'area'].includes(src.scope) ? src.scope : 'entities',
        entities: cleanEntList(src.entities),
        domain: /^[a-z_]{1,40}$/.test(String(src.domain || '')) ? String(src.domain) : 'light',
        area: cleanStr(src.area, 80).trim(),
        states: st.length ? st : ['on'],
        format: src.format === 'phrase' ? 'phrase' : 'number',
        phrase: cleanStr(src.phrase || '{n} on', 120),
        ignoreUnavailable: src.ignoreUnavailable !== false,
      };
    },
    validate(s) {
      if (s.scope === 'entities' && !s.entities.length) return T('ts_need_entities');
      if (s.scope === 'area' && !s.area) return T('ts_need_area');
      if (!s.states.length) return T('ts_need_states');
      return null;
    },
    generate(raw) {
      const s = this.clean(raw);
      const srcExpr = s.scope === 'domain' ? `states.${s.domain}`
        : s.scope === 'area' ? `expand(area_entities(${qStr(s.area)})) | selectattr('domain', 'eq', ${qStr(s.domain)})`
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
