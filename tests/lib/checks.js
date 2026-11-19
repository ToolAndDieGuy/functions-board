// A browser suite's checks, from its <suite>.jsonl (one line per check, appended as they happen, so they survive
// Playwright's worker restarts and parallel workers). Each line names its test and which try of it it was.
// Playwright runs a failed test once more in CI: only a test's last try counts, and a test whose last try passed
// after an earlier one failed is flaky. Flaky tests pass the run, and are listed (report.js prints them, and the
// weekly run fails on any).
//   collect(entries) -> { cases: the checks that count, flaky: [{ test, failed: [check names] }] }
//   writeSuite(dir, base): <base>.xml (JUnit) and <base>.flaky.json from <base>.jsonl
const fs = require('fs');
const path = require('path');

function collect(entries) {
  const last = new Map();
  for (const e of entries) if (e.test != null) last.set(e.test, Math.max(last.get(e.test) || 0, e.retry || 0));
  const cases = entries.filter((e) => e.test == null || (e.retry || 0) === last.get(e.test));
  const flaky = [];
  for (const [t, r] of last) {
    if (!r) continue;
    const before = entries.filter((e) => e.test === t && (e.retry || 0) < r && !e.ok).map((e) => e.name);
    const now = cases.filter((e) => e.test === t && !e.ok);
    if (before.length && !now.length) flaky.push({ test: t, failed: [...new Set(before)] });
  }
  return { cases, flaky };
}

const readLines = (file) => {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return null; }
};

function writeSuite(dir, base) {
  const entries = readLines(path.join(dir, base + '.jsonl'));
  if (!entries) return null;
  const { cases, flaky } = collect(entries);
  const name = (entries.find((e) => e.suite) || {}).suite || base;
  require('./junit').write(path.join(dir, base + '.xml'), name, cases);
  const ff = path.join(dir, base + '.flaky.json');
  if (flaky.length) fs.writeFileSync(ff, JSON.stringify(flaky, null, 1)); else fs.rmSync(ff, { force: true });
  return { name, cases, flaky };
}

module.exports = { collect, writeSuite, readLines };
