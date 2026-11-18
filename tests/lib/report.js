// Pass or fail for a whole run, from the JUnit files the runners wrote, not from their screen output.
//   node tests/lib/report.js <results dir> <expected suite> ...
// A suite with no report, an empty one, or any failure fails the run. Prints one line per suite.
const fs = require('fs');
const path = require('path');
const { read } = require('./junit');

const [dir, ...want] = process.argv.slice(2);
let bad = 0;
const line = (n, s) => console.log(n.padEnd(14) + ' ' + s);
for (const name of want) {
  const file = path.join(dir, name + '.xml');
  if (!fs.existsSync(file)) { bad++; line(name, 'FAILED: no report (it crashed or didn\'t run)'); continue; }
  const r = read(file), ex = path.join(dir, name + '.exit'), code = fs.existsSync(ex) ? +fs.readFileSync(ex, 'utf8').trim() : 0;
  if (!r.tests) { bad++; line(name, 'FAILED: its report has no tests'); continue; }
  if (r.failures) { bad++; line(name, `FAILED: ${r.failures} of ${r.tests}`); r.failed.slice(0, 15).forEach((f) => console.log('    ' + f.slice(0, 300))); continue; }
  // a runner that exits with an error but reports no failure has crashed part way, or lies: either way, failed
  if (code) { bad++; line(name, `FAILED: exited ${code}, with ${r.tests} tests passed in its report`); continue; }
  line(name, `${r.tests}/${r.tests} passed` + (r.skipped ? ` (${r.skipped} skipped)` : ''));
}
process.exit(bad ? 1 : 0);
