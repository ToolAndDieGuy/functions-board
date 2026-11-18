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
  + 'config/label_registry/update config_entries/get extract_from_target fire_event frontend/get_translations frontend/get_user_data '
  + 'frontend/set_user_data functions_board/diagnostics functions_board/get functions_board/nodered functions_board/nodered_keep '
  + 'functions_board/set functions_board/set_functions functions_board/set_layout functions_board/sources functions_board/subscribe '
  + 'functions_board/version_delete functions_board/version_edit functions_board/version_get functions_board/version_save '
  + 'functions_board/versions logbook/event_stream logbook/get_action_calls manifest/list mqtt/subscribe render_template '
  + 'subscribe_trigger supervisor/api test_condition trace/get trace/list validate_config').split(' '));
// Home Assistant's websocket commands without a slash, so a new one is noticed even though it looks like a word
const WS_PLAIN = /^(render_template|subscribe_trigger|fire_event|call_service|test_condition|validate_config|extract_from_target|execute_script|subscribe_events|get_states|get_config|get_services|get_panels|subscribe_entities|ping)$/;
const types = [...code.matchAll(/(?<![\w])type:\s*'([^']+)'/g)].map((m) => m[1]).filter((t) => t.includes('/') && !/^(application|text|image)\//.test(t) || WS_PLAIN.test(t));
const unlisted = [...new Set(types)].filter((t) => !WS_OK.has(t));
check('A4 every message the board sends Home Assistant is on the list', unlisted.length === 0, unlisted);
const svcCalls = code.match(/callService\(\s*[^,]+/g) || [];
check('A4 services: pausing automations, a logbook note, and the person\'s own test steps only', svcCalls.length > 0 && svcCalls.every((c) => /callService\(\s*('automation'|'logbook'|svc\.slice\(0)/.test(c)), svcCalls);
const testCall = code.match(/const call = \(svc, data, target\) => \{[^\n]*callService\(svc\.slice\(0, i\)/g) || [];
check('A4 ... a test step\'s service is called in one place: running the person\'s test', testCall.length === 1 && code.indexOf(testCall[0]) > code.indexOf('async _execTest(t) {') && code.indexOf(testCall[0]) - code.indexOf('async _execTest(t) {') < 200, null);
const fires = code.match(/type: 'fire_event'[^\n]{0,0}/g) || [];
check('A4 events are fired only by the person\'s test steps', fires.length === 1 && /case 'event': return this\._ws\(\{ type: 'fire_event'/.test(code), fires.length);
const sup = [...code.matchAll(/type: 'supervisor\/api'[^\n]{0,120}/g)].map((m) => m[0]);
check('A4 the Supervisor is only asked (method get), never told', sup.length > 0 && sup.every((x) => /method: 'get'/.test(x)), sup);
const pubs = code.match(/[^\n]{0,40}'mqtt\.publish'[^\n]{0,20}/g) || [];
check('A4 MQTT: the board listens; a message is published only by the person\'s own MQTT test step (the sandbox only simulates one)', !/mqtt\/publish|callService\(\s*'mqtt'/.test(code) && pubs.length === 2 && pubs.some((p) => /if \(svc === 'mqtt\.publish'\) \{ await this\.mqtt\(/.test(p)) && pubs.some((p) => /case 'mqtt': return call\('mqtt\.publish'/.test(p)), pubs);

