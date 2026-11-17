// Static checks on the board file. Run: node tests/static.test.js
// 1. A class the code switches on at runtime must not also be the start of a top-level style rule:
//    v0.3.0 put "run" on running boxes, which also styled rows of the Runs list (grid, full width, no background).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'custom_components', 'functions_board', 'frontend', 'functions-board.js'), 'utf8');
let failed = 0, total = 0;
const check = (name, ok, detail) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -- ' + JSON.stringify(detail)));
};

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

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
