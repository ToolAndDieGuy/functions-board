// Static checks on the board file. Run: node --test tests/static.test.js
// 1. A class the code switches on at runtime must not also be the start of a top-level style rule:
//    v0.3.0 put "run" on running boxes, which also styled rows of the Runs list (grid, full width, no background).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'custom_components', 'functions_board', 'frontend', 'functions-board.js'), 'utf8');
const { check } = require('./lib/check');

const s0 = src.indexOf('const STYLE = `');
const css = src.slice(s0 + 'const STYLE = `'.length, src.indexOf('`;', s0)).replace(/\/\*[\s\S]*?\*\//g, '');

const toggled = new Set();
for (const m of src.matchAll(/classList\.(?:toggle|add|remove)\(\s*'([\w-]+)'/g)) toggled.add(m[1]);
for (const m of src.matchAll(/\[((?:\s*'[\w-]+'\s*,?)+)\]\.forEach\(\((\w+)\)\s*=>\s*[\w.$]+\.classList\.toggle\(\2/g)) {
  for (const n of m[1].matchAll(/'([\w-]+)'/g)) toggled.add(n[1]);
}
check('found the runtime classes', toggled.size >= 15, [...toggled]);

// every selector of every rule, at-rule headers skipped
const selectors = [];
for (const m of css.matchAll(/([^{}]+)\{/g)) {
  const head = m[1].trim();
  if (!head || head.startsWith('@') || /^\d+%$|^(from|to)$/.test(head)) continue;
  head.split(',').forEach((x) => selectors.push(x.trim()));
}
check('found the style rules', selectors.length > 200, selectors.length);

const clashes = [];
for (const c of toggled) {
  const re = new RegExp('^\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])');
  selectors.filter((sel) => re.test(sel)).forEach((sel) => clashes.push(c + ' -> ' + sel));
}
check('no runtime class is also an unscoped top-level rule', clashes.length === 0, clashes);

// 2. one version number everywhere (6.2)
const ver = (src.match(/const VERSION = '([^']+)'/) || [])[1];
const head = (src.match(/Functions board v([0-9][^ ]*) /) || [])[1];
const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'custom_components', 'functions_board', 'manifest.json'), 'utf8')).version;
check('board VERSION, header and manifest agree', ver && ver === head && ver === man, { ver, head, man });
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const rv = [...readme.matchAll(/(?:\?v=|\(v)([0-9][0-9A-Za-z.-]*)/g)].map((m) => m[1]);
check('README names the same version', rv.length > 0 && rv.every((x) => x === ver), rv);

// 3. the board's words (4.9): every T('id') and P('id') has an English text, every text is used, and the
//    placeholders a call fills are the ones its text has
const t0 = src.indexOf('  const STR = {'), t1 = src.indexOf("\n  };\n  setLang('en');", t0);
const STR = new Function('return ' + src.slice(t0 + '  const STR = '.length, t1 + 4))();
const EN = STR.en || {};
check('found the English table', Object.keys(EN).length > 500, Object.keys(EN).length);
// a key written twice keeps only its last text, silently: each key once
const keyLines = src.slice(t0, t1).match(/^      [A-Za-z0-9_]+(?=: )/gm) || [], seenKeys = new Set(), twice = [];
keyLines.forEach((k) => { k = k.trim(); if (seenKeys.has(k)) twice.push(k); seenKeys.add(k); });
check('each text key is written once', keyLines.length > 500 && twice.length === 0, twice.length ? twice : keyLines.length);
// the source of the balanced {...} or (...) at i, with strings, templates and comments skipped
function skipQuote(s, j, q) { for (j++; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === q) return j; } return j; }
function skipTemplate(s, j) {
  for (j++; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '`') return j;
    if (s[j] === '$' && s[j + 1] === '{') j += balanced(s, j + 1).length;
  }
  return j;
}
function balanced(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"') { j = skipQuote(s, j, c); continue; }
    if (c === '`') { j = skipTemplate(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); continue; }
    if (c === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 1; continue; }
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c) && --depth === 0) return s.slice(i, j + 1);
  }
  throw new Error('unbalanced at ' + i);
}
// the keys of an object literal's source: { a, b: x, c: f(y, z) }
function keysOf(obj) {
  const body = obj.slice(1, -1), keys = [];
  let depth = 0, from = 0;
  for (let j = 0; j <= body.length; j++) {
    const c = body[j];
    if (j === body.length || (c === ',' && depth === 0)) { const m = body.slice(from, j).match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/); if (m) keys.push(m[1]); else if (body.slice(from, j).trim()) keys.push('?'); from = j + 1; continue; }
    if (c === "'" || c === '"') { j = skipQuote(body, j, c); continue; }
    if (c === '`') { j = skipTemplate(body, j); continue; }
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
  }
  return keys;
}
const holes = (text) => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const calls = [...src.matchAll(/\b([TP])\('([a-z0-9_]+)'/g)]
  .filter((m) => (m.index < t0 || m.index > t1) && !src.slice(src.lastIndexOf('\n', m.index), m.index).includes('//'));
check('found the text calls', calls.length > 600, calls.length);
const missing = [], wrongKind = [], badHoles = [], used = new Set();
for (const m of calls) {
  const [, fn, id] = m, text = EN[id];
  used.add(id);
  if (text === undefined) { missing.push(id); continue; }
  if ((fn === 'T') !== (typeof text === 'string')) { wrongKind.push(fn + ' ' + id); continue; }
  const after = src.slice(m.index + m[0].length);
  const forms = typeof text === 'string' ? [text] : Object.values(text);
  let given = [];
  const rest = fn === 'T' ? after : after.slice(after.search(/,/) + 1);
  // P('id', n) or P('id', n, { vars }): skip the count to reach the vars
  let vars = null;
  if (fn === 'T') { const v = rest.match(/^,\s*\{/); if (v) vars = balanced(rest, rest.indexOf('{')); }
  else {
    let j = 0, depth = 0;
    for (; j < rest.length; j++) { const c = rest[j]; if (c === "'" || c === '"') { j = skipQuote(rest, j, c); continue; } if (c === '`') { j = skipTemplate(rest, j); continue; } if ('{(['.includes(c)) depth++; else if ('})]'.includes(c)) { if (depth === 0) break; depth--; } else if (c === ',' && depth === 0) break; }
    const tail = rest.slice(j); const v = tail.match(/^,\s*\{/); if (v) vars = balanced(tail, tail.indexOf('{'));
  }
  given = vars ? keysOf(vars) : [];
  const want = forms.map(holes).reduce((a, b) => [...new Set(a.concat(b))], []).filter((h) => !(fn === 'P' && h === 'n')).sort();
  // texts without vars may only be patterns the code fills itself ({a} and {b}, as in the arrow sentences)
  const ok = vars ? JSON.stringify(given.slice().sort()) === JSON.stringify(want) : want.every((h) => h === 'a' || h === 'b');
  if (!ok) badHoles.push({ id, want, given });
}
check('every text call has an English text', missing.length === 0, missing);
check('T is for texts and P for counts', wrongKind.length === 0, wrongKind);
check('each call fills exactly the placeholders its text has', badHoles.length === 0, badHoles.slice(0, 10));
const orphans = Object.keys(EN).filter((id) => !used.has(id));
check('every English text is used', orphans.length === 0, orphans);
const noN = Object.entries(EN).filter(([, v]) => typeof v !== 'string' && !(v.one !== undefined && v.other !== undefined && /\{n\}/.test(v.other)));
check('counts have one and other, and other shows {n}', noN.length === 0, noN.map(([k]) => k));

// the catalog's rule: the board never makes a Supervisor ingress session or writes its cookie
const ingress = (src.match(/ingress\/session|ingress_session/g) || []);
check('no ingress session is made, and no ingress cookie written', ingress.length === 0, ingress);

// 0.9.1: a method defined twice in the board's class: the later one silently replaces the first (0.9.0 gave the
// saved checks a _stepText, and the steps of a run on the board all read "Clock to what's due"). A getter and its
// setter share a name, and that's fine.
{
  const cls = src.slice(src.indexOf('class FunctionsBoard extends HTMLElement'));
  const seen = new Map();
  for (const m of cls.matchAll(/^ {4}(get |set |static |async )?([_a-zA-Z$][\w$]*)\s*\([^)]*\)\s*\{/gm)) {
    const k = (m[1] === 'get ' || m[1] === 'set ' ? m[1] : '') + m[2];
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  check('found the board\'s methods', seen.size > 300, seen.size);
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  check('no method of the board is defined twice (the later one would replace the first)', twice.length === 0, twice);
  // 0.10.0: nor is a method hidden by a property of the same name (this._link = … made every _link() call fail)
  const methods = new Set([...seen.keys()].filter((k) => !/^(get|set) /.test(k)));
  const hidden = [...new Set([...cls.matchAll(/this\.([_a-zA-Z$][\w$]*)\s*=(?![=>])/g)].map((m) => m[1]).filter((k) => methods.has(k)))];
  check('no property of the board has a method\'s name (it would hide the method)', hidden.length === 0, hidden);
}

// ---------- privacy: the board talks to this Home Assistant and nothing else ----------
// (comments are left out, so a note about a rule doesn't trip it)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// A1: no way to reach another computer but Home Assistant's own connection; one fetch, guarded to a path here
const netApis = code.match(/\bnew\s+(WebSocket|EventSource|Worker|SharedWorker|XMLHttpRequest|Image|Audio)\b|sendBeacon|importScripts|\bimport\s*\(|\bsrc="(?!\$\{esc\(url\)\}")|setAttribute\(\s*'src'|navigator\.share|RTCPeerConnection|WebTransport/g) || [];
check('A1 no network APIs (WebSocket, EventSource, workers, XHR, beacons, dynamic import, image or iframe loads)', netApis.length === 0, netApis);
const fetches = code.match(/(?<![\w.])fetch\s*\([^)]*\)/g) || [];
check('A1 exactly one fetch: Node-RED\'s flows, through its page in Home Assistant', fetches.length === 1 && /^fetch\(base \+ 'flows'/.test(fetches[0]), fetches);
check('A1 ... and its address must be a path on this Home Assistant before it\'s used', /if \(!base \|\| !SAME_ORIGIN\.test\(base\)\) return/.test(code) && code.indexOf('SAME_ORIGIN.test(base)') < code.indexOf("fetch(base + 'flows'") && /const SAME_ORIGIN = \/\^\\\/\(\?!\[\\\/\\\\\]\)\/;/.test(code), null);

// A2: one outside address, the project page, only ever a plain link; windows open only pages here
const urls = (code.match(/\b(?:https?|wss?|ftp):\/\/[^\s'"`<>)]+/g) || []);
check('A2 the only outside address is the project page', urls.length === 1 && urls[0] === 'https://github.com/ToolAndDieGuy/functions-board', urls);
const repoUses = code.match(/REPO_URL[^\n]{0,24}/g) || [];
check('A2 ... used only as a plain link, with nothing added to it', repoUses.length >= 2 && repoUses.slice(1).every((u) => /^REPO_URL(\s*\?|\}" target="_blank")/.test(u)), repoUses);
const opens = code.match(/window\.open\(([^,)]+)/g) || [];
check('A2 window.open only opens the board\'s or Home Assistant\'s own pages', opens.length > 0 && opens.every((o) => /window\.open\((this\._drawer\.url|location\.pathname \+)/.test(o)), opens);
check('A2 ... and the drawer only takes paths here', /_openDrawer\(url, title, opt = \{\}\) \{\s*if \(!SAME_ORIGIN\.test\(String\(url\)\)\) return;/.test(code), null);
const hrefs = (code.match(/\bhref\s*=\s*["'`]?\$?\{?[^\s>]{0,40}|\.href\s*=\s*[^;]{0,50}/g) || []).filter((h) => !/REPO_URL|URL\.createObjectURL|href="#"/.test(h));
check('A2 no other links or downloads but the file the person saves (diagnostics)', hrefs.length === 0, hrefs);

// A3: nothing loaded from elsewhere
const assets = code.match(/url\(\s*['"]?(?:https?:)?\/\/|@import|<link\b|<script\b|<img\b[^>]*src=|font-face/g) || [];
check('A3 no outside fonts, images, styles or scripts', assets.length === 0, assets);

// A4: the messages it sends Home Assistant are on a list; the ones that act are pinned to their places
const WS_OK = new Set(('automation/config blueprint/substitute config/area_registry/list config/area_registry/update config/auth/list '
  + 'config/category_registry/create config/category_registry/delete config/category_registry/list config/device_registry/list '
  + 'config/device_registry/update config/entity_registry/get config/entity_registry/list config/entity_registry/update '
  + 'config/floor_registry/list config/label_registry/create config/label_registry/delete config/label_registry/list '
  + 'config/label_registry/update config_entries/get device_automation/trigger/capabilities device_automation/trigger/list extract_from_target fire_event frontend/get_translations frontend/get_user_data '
  + 'frontend/set_user_data functions_board/diagnostics functions_board/get functions_board/nodered functions_board/nodered_keep '
  + 'functions_board/set functions_board/set_functions functions_board/set_layout functions_board/sources functions_board/subscribe '
  + 'functions_board/version_active functions_board/version_delete functions_board/version_edit functions_board/version_get functions_board/version_overwrite functions_board/version_save '
  + 'functions_board/versions history/history_during_period logbook/event_stream logbook/get_action_calls manifest/list mqtt/device/debug_info mqtt/subscribe render_template '
  + 'subscribe_events subscribe_trigger supervisor/api test_condition trace/get trace/list validate_config').split(' '));
// Home Assistant's websocket commands without a slash, so a new one is noticed even though it looks like a word
const WS_PLAIN = /^(render_template|subscribe_trigger|fire_event|call_service|test_condition|validate_config|extract_from_target|execute_script|subscribe_events|get_states|get_config|get_services|get_panels|subscribe_entities|ping)$/;
const types = [...code.matchAll(/(?<![\w])type:\s*'([^']+)'/g)].map((m) => m[1]).filter((t) => t.includes('/') && !/^(application|text|image)\//.test(t) || WS_PLAIN.test(t));
const unlisted = [...new Set(types)].filter((t) => !WS_OK.has(t));
check('A4 every message the board sends Home Assistant is on the list', unlisted.length === 0, unlisted);
// (0.10.0: the board calls services through its link, this._svc(); Home Assistant's callService is reached in one
// place, the link's wiring, which passes on what it's given)
const svcCalls = code.match(/this\._svc\(\s*[^,]+/g) || [];
const hassSvc = code.match(/callService\([^)]*\)/g) || [];
check('A4 services: pausing automations, a logbook note, and the person\'s own test steps only', svcCalls.length > 0 && svcCalls.every((c) => /_svc\(\s*('automation'|'logbook'|svc\.slice\(0)/.test(c)) && hassSvc.length === 1 && /service: \(domain, service, data, target\) => this\._hass\.callService\(domain, service, data, target\)/.test(code), { svcCalls, hassSvc });
const testCall = code.match(/const call = \(svc, data, target\) => \{[^\n]*_svc\(svc\.slice\(0, i\)/g) || [];
check('A4 ... a test step\'s service is called in one place: running the person\'s test', testCall.length === 1 && code.indexOf(testCall[0]) > code.indexOf('async _execTest(t) {') && code.indexOf(testCall[0]) - code.indexOf('async _execTest(t) {') < 200, null);
const fires = code.match(/type: 'fire_event'[^\n]{0,0}/g) || [];
check('A4 events are fired only by the person\'s test steps', fires.length === 1 && /case 'event': return this\._ws\(\{ type: 'fire_event'/.test(code), fires.length);
const sup = [...code.matchAll(/type: 'supervisor\/api'[^\n]{0,120}/g)].map((m) => m[0]);
check('A4 the Supervisor is only asked (method get), never told', sup.length > 0 && sup.every((x) => /method: 'get'/.test(x)), sup);
const pubs = code.match(/[^\n]{0,40}'mqtt\.publish'[^\n]{0,20}/g) || [];
// 0.11.3: a third mention, the wiring reading a publish's topic from a config (analyze()) to draw the arrow to it
check('A4 MQTT: the board listens; a message is published only by the person\'s own MQTT test step (the sandbox only simulates one, and the wiring only reads one)', !/mqtt\/publish|(callService|_svc)\(\s*'mqtt'/.test(code) && pubs.length === 3 && pubs.some((p) => /if \(svc === 'mqtt\.publish'\) \{ await this\.mqtt\(/.test(p)) && pubs.some((p) => /case 'mqtt': return call\('mqtt\.publish'/.test(p))
  && pubs.some((p) => /^ *if \(svc === 'mqtt\.publish' && typeof data\.topi$/.test(p)), pubs);


// 0.10.0: every wait the board sets goes through its clock (class Clock), so a board taken off the page stops them
// all: no timer, interval or animation frame of its own in the board's class
{
  const cls = src.slice(src.indexOf('  class FunctionsBoard extends HTMLElement'));
  const raw = [...cls.matchAll(/\b(setTimeout|setInterval|requestAnimationFrame|clearTimeout|clearInterval|cancelAnimationFrame)\s*\(/g)].map((m) => m[1] + ' at line ' + (src.slice(0, src.length - cls.length + m.index).split('\n').length));
  check('the board sets no timer of its own: every wait goes through this._clock', raw.length === 0, raw);
}

// 0.10.0: every call to Home Assistant goes through the link (class Link), and no failure is dropped without a reason:
// in the board's class, no .catch whose handler ignores the error; a call whose failure is expected says why
// (o.optional: '<reason>'), and a task of the board's own does through this._ha.quiet(promise, '<reason>')
{
  const start = src.indexOf('  class FunctionsBoard extends HTMLElement'), cls = src.slice(start);
  const at = (i) => src.slice(0, start + i).split('\n').length;
  const dropped = [...cls.matchAll(/\.catch\(\(\)\s*=>/g)].map((m) => 'line ' + at(m.index));
  check('the board drops no error without a reason: no .catch(() => …) in its class', dropped.length === 0, dropped);
  const opt = [...cls.matchAll(/optional:\s*('(?:[^'\\]|\\.)*'|[^,}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^'(?:[^'\\]|\\.){12,}'$/.test(v));
  check('every optional call gives its reason, in words (a string of 12 characters or more)', opt.length === 0, opt);
  const quiet = [...cls.matchAll(/this\._ha\.quiet\(/g)].map((m) => cls.slice(m.index, m.index + 400)).filter((t) => !/^this\._ha\.quiet\([\s\S]*?,\s*'[^']{12,}'/.test(t.split('\n')[0]));
  check('every quiet task gives its reason, in words', quiet.length === 0, quiet.map((t) => t.split('\n')[0].slice(0, 120)));
  const direct = [...cls.matchAll(/this\._hass\.(callWS|callApi|callService|connection)\b/g)].map((m) => m[1] + ' at line ' + at(m.index));
  // (all of them in the link's wiring: from "this._ha = new Link({" to its options)
  const wire = cls.indexOf('this._ha = new Link({'), wireEnd = cls.indexOf('}, { clock: this._clock', wire);
  const outside = [...cls.matchAll(/this\._hass\.(callWS|callApi|callService|connection)\b/g)].filter((m) => wire < 0 || m.index < wire || m.index > wireEnd).map((m) => m[1] + ' at line ' + at(m.index));
  check('the board reaches Home Assistant\'s calls only through the link (its wiring in _init)', direct.length >= 4 && outside.length === 0 && /this\._ha = new Link\(\{\s*ws: \(m\) => this\._hass\.callWS\(m\),/.test(cls), { outside, direct });
  const empty = [...cls.matchAll(/catch \((e|err|x)\) \{\s*\}/g)].map((m) => 'line ' + at(m.index));
  check('no empty catch block in the board: one that ignores an error says why in a comment', empty.length === 0, empty);
}

// 0.10.0: what every button does is in one table per view (_actionTables): every action a button, a menu item or the
// box's bar names has a handler there, and every handler there is used. And an undo step is made in one place.
{
  const start = src.indexOf('  class FunctionsBoard extends HTMLElement'), cls = src.slice(start);
  const t0 = cls.indexOf('    _actionTables() {'), t1 = cls.indexOf('\n    }\n', t0), tables = cls.slice(t0, t1);
  const handled = [...tables.matchAll(/^ {10}'([a-z0-9-]+)': /gm)].map((m) => m[1]);
  const views = [...tables.matchAll(/^ {8}([a-z]+): \{$/gm)].map((m) => m[1]);
  check('found the action tables, one per view', t0 > 0 && views.length >= 8 && handled.length > 140, { views, handled: handled.length });
  const named = new Set([
    ...[...cls.matchAll(/data-act="([a-z0-9-]+)"/g)].map((m) => m[1]),
    ...[...cls.matchAll(/\bact: '([a-z0-9-]+)'/g)].map((m) => m[1]),
    ...[...cls.matchAll(/\['([a-z][a-z0-9-]*)', [^\]\n]*?'mdi:/g)].map((m) => m[1]),
  ]);
  const twice = handled.filter((h, i) => handled.indexOf(h) !== i);
  check('no action is in two tables', twice.length === 0, twice);
  const unhandled = [...named].filter((n) => !handled.includes(n));
  check('every action a button names has a handler in the tables', unhandled.length === 0, unhandled);
  const unused = handled.filter((h) => !named.has(h));
  check('every handler in the tables is named by a button, a menu item or the box\'s bar', unused.length === 0, unused);
  check('no action is dispatched outside the tables (no switch on data-act)', !/switch \(a\) \{/.test(cls) && (cls.match(/this\._acts\(\)\.get\(/g) || []).length === 1, null);
  // and when the board joins the tables, a name in two of them is refused (the later one would silently win)
  const { actionMap } = require('./lib/board-lib');
  let refused = null;
  try { actionMap({ list: { 'x-go': () => 1 }, canvas: { 'x-go': () => 2 } }); } catch (e) { refused = e.message; }
  const joined = actionMap({ list: { 'a-go': () => 1 }, canvas: { 'b-go': () => 2 } });
  check('actionMap joins the tables, and refuses a name in two of them', /x-go is in two tables \(list and canvas\)/.test(refused || '') && joined.get('b-go')() === 2 && joined.get('a-go').view === 'list', refused);
  const pushes = (cls.match(/_undoStack\.push\(/g) || []).length;
  check('an undo step is made in one place (_history)', pushes === 1 && /_history\(step\) \{[^}]*this\._undoStack\.push\(step\)/.test(cls), pushes);
}

// 0.10.0: the views a person works in are drawn in place (this._put, morph()): the list, the header, the boxes, the box's
// bar, the Key and the drawer keep their elements, and with them focus and scroll
{
  const cls = src.slice(src.indexOf('  class FunctionsBoard extends HTMLElement'));
  const whole = [...cls.matchAll(/(?<![\w.$])(d|bar|this\._\$\.(?:list|nodes|legend|drawer|title|nodebar))\.innerHTML\s*=/g)].map((m) => m[1]);
  check('the list, header, boxes, bar, Key and drawer are drawn in place (_put), not replaced (innerHTML)', whole.length === 0 && (cls.match(/this\._put\(/g) || []).length >= 25, whole);
}

// 0.10.0: the board's parts (PARTS in the library section): each part's own state is used only by its own methods
// (and by its view's action table); every method is in a part's block; _init declares the state and _relang clears it
{
  const { PARTS } = require('./lib/board-lib');
  const start = src.indexOf('  class FunctionsBoard extends HTMLElement'), cls = src.slice(start);
  const lines = cls.split('\n'), at = (i) => src.slice(0, start).split('\n').length + i;
  const owner = new Map();
  Object.entries(PARTS).forEach(([p, d]) => d.owns.forEach((f) => owner.set(f, p)));
  const tablePart = new Map(Object.entries(PARTS).filter(([, d]) => d.table).map(([p, d]) => [d.table, p]));
  let part = null, method = null, table = null;
  const bad = [], outside = [], seenParts = new Set();
  lines.forEach((l, i) => {
    const h = /^ {7}part: ([a-z]+):/.exec(l);
    if (h) { part = h[1]; seenParts.add(part); return; }
    const m = /^ {4}(?:async |get |set |static )?([_a-zA-Z$][\w$]*)\s*\([^)]*\)\s*\{/.exec(l);
    if (m) { method = m[1]; table = null; if (!part) outside.push(method); }
    if (method === '_actionTables') { const t = /^ {8}([a-z]+): \{$/.exec(l); if (t) table = t[1]; }
    if (!method || method === '_init' || method === '_relang' || method === 'constructor') return;
    const who = method === '_actionTables' && table ? tablePart.get(table) || 'core' : part;
    for (const x of l.matchAll(/this\.(_[a-zA-Z$][\w$]*)\b(?!\s*\()/g)) {
      const o = owner.get(x[1]);
      if (o && o !== who) bad.push(`${x[1]} (${o}'s) in ${method} (${who}), line ${at(i)}`);
    }
  });
  check('the board\'s class is in parts, every method in one, each part in PARTS (or core)', outside.length === 0 && seenParts.has('core') && Object.keys(PARTS).every((p) => seenParts.has(p)) && [...seenParts].every((p) => p === 'core' || PARTS[p]), { outside, seenParts: [...seenParts] });
  check('a part\'s own state is used only by its own methods and its view\'s actions', bad.length === 0, bad.slice(0, 10));
  const twice = [...owner.keys()].filter((f) => Object.values(PARTS).filter((d) => d.owns.includes(f)).length > 1);
  check('no state is owned by two parts', twice.length === 0, twice);
}

// 0.10.0: every mutant's text is in its file exactly once, checked on every push (the mutants themselves run weekly,
// and a change to the code they break would otherwise only show then)
{
  const root = path.join(__dirname, '..');
  const ms = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'mutants.json'), 'utf8'));
  const stale = ms.filter((x) => { try { return fs.readFileSync(path.join(root, x.file), 'utf8').split(x.find).length !== 2; } catch (e) { return true; } }).map((x) => x.name);
  check('every mutant in tests/mutants.json still finds its text, once', ms.length > 30 && stale.length === 0, stale);
}

// 0.9.1: the real-HA suites are split between two CI jobs by --only patterns: a suite added to run.sh must be in
// exactly one, or it never runs in CI (or runs twice)
{
  const root = path.join(__dirname, '..');
  const runsh = fs.readFileSync(path.join(root, 'tests', 'run.sh'), 'utf8');
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'validate.yml'), 'utf8');
  const suites = ((runsh.match(/^\s*SUITES="([^"]+)"/m) || [])[1] || '').split(/\s+/).filter(Boolean).map((x) => 'e2e-' + x).concat(['apitest']);
  const pats = [...wf.matchAll(/sh tests\/run\.sh --ha --keep --only '([^']+)'/g)].map((m) => new RegExp(m[1]));
  check('found the real-HA suites and the CI jobs that run them', suites.length >= 9 && pats.length >= 2, { suites, pats: pats.map(String) });
  const wrong = suites.filter((x) => pats.filter((p) => p.test(x)).length !== 1);
  check('every real-HA suite runs in exactly one CI job', wrong.length === 0, wrong);
  const board = ((runsh.match(/^BOARD="([^"]+)"/m) || [])[1] || '').split(/\s+/).filter(Boolean).map((x) => 'board-' + x);
  const bpats = [...wf.matchAll(/sh tests\/run\.sh --only '([^']+)'/g)].map((m) => new RegExp(m[1]));
  check('every board suite runs in CI', board.length >= 4 && board.every((x) => bpats.some((p) => p.test(x))), { board, bpats: bpats.map(String) });
  // 0.10.0: and every board test file is one of run.sh's board suites (a file left out would never run)
  const files = fs.readdirSync(path.join(root, 'tests', 'board')).filter((f) => f.endsWith('.test.js')).map((f) => 'board-' + f.replace(/\.test\.js$/, ''));
  check('every test file in tests/board is a board suite in run.sh', files.every((f) => board.includes(f)) && board.every((b) => files.includes(b)), { files, board });
  // and the quick node suites: each one run.sh lists is in the quick CI job's pattern
  const quick = ((runsh.match(/^for s in ([\w ]+); do want "\$s" && nodetest/m) || [])[1] || '').split(/\s+/).filter(Boolean);
  const qpat = (wf.match(/run: sh tests\/run\.sh --only '(selftest\|static[^']*)'/) || [])[1];
  check('every quick node suite runs in CI', quick.length >= 5 && !!qpat && quick.every((q) => new RegExp('^(' + qpat + ')$').test(q)), { quick, qpat });
  // 0.11.2: and the Python suites (the units and the sandbox against Home Assistant's core) in the backend job's
  const py = ['backend', 'diff'].filter((x) => new RegExp('^if want ' + x + '; then', 'm').test(runsh));
  const ppat = (wf.match(/run: sh tests\/run\.sh --only '(selftest\|backend[^']*)'/) || [])[1];
  check('the Python suites (backend, diff) run in CI', py.length === 2 && !!ppat && py.every((q) => new RegExp('^(' + ppat + ')$').test(q)), { py, ppat });
  // and a browser test file's suite is named after it (board-<x> in tests/board, <x> in tests/e2e): a fixture finds a
  // test's own suite by its file (suiteOf in tests/e2e/lib.js), since one worker runs tests from several files
  const named = [['board', 'board-'], ['e2e', '']].flatMap(([dir, pre]) => fs.readdirSync(path.join(root, 'tests', dir)).filter((f) => f.endsWith('.test.js')).map((f) => {
    const src = fs.readFileSync(path.join(root, 'tests', dir, f), 'utf8'), m = src.match(/\bsuite\('([^']+)'\)/);
    return { file: dir + '/' + f, want: pre + f.replace(/\.test\.js$/, ''), got: m ? m[1] : null };
  }));
  const misnamed = named.filter((x) => x.got !== x.want);
  check('every browser suite is named after its test file', named.length >= 15 && misnamed.length === 0, misnamed);
}
