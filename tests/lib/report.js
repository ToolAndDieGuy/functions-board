// Pass or fail for a whole run, from the JUnit files the runners wrote, not from their screen output.
//   node tests/lib/report.js <results dir> <expected suite> ...
// A suite with no report, an empty one, or any failure fails the run. Prints one line per suite.
//  - Flaky tests (failed, then passed when Playwright ran them again: <suite>.flaky.json) pass, and are listed.
//  - Quarantined checks (tests/quarantine.json, or $FB_QUARANTINE) still run and are shown, but their failures
//    don't fail the run. Each entry says which suite and check, why, and since when.
//  - FB_STRICT=1 (the weekly run): a flaky test fails the run, and so does a quarantine entry older than 30 days
//    or one whose check isn't there any more, so the list can't grow quietly.
// Writes <results dir>/summary.md (and appends it to $GITHUB_STEP_SUMMARY in CI).
const fs = require('fs');
const path = require('path');
const { read } = require('./junit');

const [dir, ...want] = process.argv.slice(2);
const strict = !!process.env.FB_STRICT;
const qfile = process.env.FB_QUARANTINE || path.join(__dirname, '..', 'quarantine.json');
let bad = 0;
const md = ['| Suite | Result |', '|---|---|'], notes = [];
const out = (n, s) => { console.log(n.padEnd(14) + ' ' + s); md.push(`| ${n} | ${s.replace(/\|/g, '\\|')} |`); };
const note = (s) => { console.log('    ' + s); notes.push('- ' + s); };

let quarantine = [];
if (fs.existsSync(qfile)) {
  try { quarantine = JSON.parse(fs.readFileSync(qfile, 'utf8')); } catch (e) { bad++; console.log(`quarantine     FAILED: ${qfile} doesn't parse: ${e.message}`); }
  for (const q of quarantine) {
    if (!q || !q.suite || !q.check || !q.why || !/^\d{4}-\d\d-\d\d$/.test(q.since || '')) { bad++; console.log('quarantine     FAILED: an entry needs suite, check, why and since (YYYY-MM-DD): ' + JSON.stringify(q)); }
  }
}
const quarantined = (suite, name) => quarantine.find((q) => q.suite === suite && name.includes(q.check));
const seen = new Set();

for (const name of want) {
  const file = path.join(dir, name + '.xml');
  if (!fs.existsSync(file)) { bad++; out(name, 'FAILED: no report (it crashed or didn\'t run)'); continue; }
  const r = read(file), ex = path.join(dir, name + '.exit'), code = fs.existsSync(ex) ? +fs.readFileSync(ex, 'utf8').trim() : 0;
  if (!r.tests) { bad++; out(name, 'FAILED: its report has no tests'); continue; }
  r.all.forEach((n) => quarantine.forEach((q) => { if (q.suite === name && n.includes(q.check)) seen.add(q); }));
  const held = r.failed.filter((f) => quarantined(name, f)), failed = r.failed.filter((f) => !quarantined(name, f));
  const ff = path.join(dir, name + '.flaky.json'), flaky = fs.existsSync(ff) ? JSON.parse(fs.readFileSync(ff, 'utf8')) : [];
  if (failed.length) {
    bad++; out(name, `FAILED: ${failed.length} of ${r.tests}`); failed.slice(0, 15).forEach((f) => note(f.slice(0, 300)));
  } else if (code && !held.length) {
    // a runner that exits with an error but reports no failure has crashed part way, or lies: either way, failed
    // (a runner whose only failures are quarantined ones exits 1 too, and that's expected)
    bad++; out(name, `FAILED: exited ${code}, with ${r.tests} tests passed in its report`);
  } else {
    out(name, `${r.tests - held.length}/${r.tests} passed` + (r.skipped ? ` (${r.skipped} skipped)` : '') + (held.length ? `, ${held.length} quarantined failing` : '') + (flaky.length ? `, ${flaky.length} flaky` : ''));
  }
  held.forEach((f) => { const q = quarantined(name, f); note(`quarantined, failed: ${f.slice(0, 200)} (${q.why}; since ${q.since})`); });
  flaky.forEach((f) => note(`flaky: ${f.test}: failed first, passed again (${f.failed.slice(0, 3).join('; ').slice(0, 300)})`));
  if (strict && flaky.length) { bad++; note('FAILED: the weekly run allows no flaky tests'); }
}
if (strict) {
  const old = Date.now() - 30 * 86400000;
  for (const q of quarantine) {
    if (Date.parse(q.since) < old) { bad++; note(`FAILED: quarantined for more than 30 days: ${q.suite}: ${q.check}`); }
    if (want.includes(q.suite) && !seen.has(q)) { bad++; note(`FAILED: quarantined, but no such check any more: ${q.suite}: ${q.check}`); }
  }
}
const summary = md.join('\n') + (notes.length ? '\n\n' + notes.join('\n') : '') + '\n';
try { fs.writeFileSync(path.join(dir, 'summary.md'), summary); } catch (e) { /* the summary is extra */ }
if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary); } catch (e) { /* extra */ } }
process.exit(bad ? 1 : 0);
