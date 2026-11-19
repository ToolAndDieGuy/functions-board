// Minimal JUnit XML, written and read the same way by every runner here (node:test and pytest write their own).
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
// cases: [{ name, ok, detail, ms }]
function write(file, suite, cases) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bad = cases.filter((c) => !c.ok).length;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${esc(suite)}" tests="${cases.length}" failures="${bad}">\n`
    + cases.map((c) => `<testcase classname="${esc(suite)}" name="${esc(c.name)}"${c.ms != null ? ` time="${(c.ms / 1000).toFixed(3)}"` : ''}>${c.ok ? '' : `<failure message="${esc(String(c.detail || '').slice(0, 2000))}"/>`}</testcase>`).join('\n')
    + '\n</testsuite></testsuites>\n';
  fs.writeFileSync(file, xml);
}
// { tests, failures, failed: names of failed cases, all: names of every case run, skipped }: <failure> and <error> both count; a skipped case doesn't count as run
function read(file) {
  const xml = fs.readFileSync(file, 'utf8'), out = { tests: 0, failures: 0, failed: [], skipped: 0, all: [] };
  const un = (n) => n.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // (an attribute's value may hold a '>', as a check named after an arrow function does: skip quoted values whole)
  for (const m of xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = m[1], inner = m[3] || '', name = (attrs.match(/\bname="([^"]*)"/) || [])[1] || '?';
    if (/<skipped\b/.test(inner)) { out.skipped++; continue; }
    out.tests++;
    out.all.push(un(name));
    if (/<(failure|error)\b/.test(inner)) { out.failures++; out.failed.push(un(name)); }
  }
  return out;
}
module.exports = { write, read };
