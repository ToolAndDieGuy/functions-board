// The self-test: every runner here is given a failure planted on purpose, and the run's report must call each
// one a failure. It proves a failing test can't pass as "passed" (apitest.py once exited 0 on failure, unseen).
// Writes <results>/selftest.xml: one case per runner, passing when that runner's planted failure was caught.
//   node tests/selftest/run.js <results dir>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { write } = require('../lib/junit');

const root = path.join(__dirname, '..', '..'), out = path.resolve(process.argv[2] || path.join(root, 'tests', '.results'));
const self = path.join(out, 'self');
fs.rmSync(self, { recursive: true, force: true });
fs.mkdirSync(self, { recursive: true });
const run = (name, cmd, args, env) => {
  const r = spawnSync(cmd, args, { cwd: root, env: Object.assign({}, process.env, { FB_RESULTS: self, FB_SELF_NAME: name }, env || {}), encoding: 'utf8' });
  fs.writeFileSync(path.join(self, name + '.exit'), String(r.status == null ? 1 : r.status));
  return r;
};
const planted = [];
planted.push('self-node'); run('self-node', process.execPath, ['--test', '--test-reporter=junit', '--test-reporter-destination=' + path.join(self, 'self-node.xml'), 'tests/selftest/planted.test.js']);
const py = path.join(root, 'venvtest', 'bin', 'python');
if (fs.existsSync(py)) { planted.push('self-pytest'); run('self-pytest', py, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'tests/selftest/test_planted.py', '--junitxml=' + path.join(self, 'self-pytest.xml')]); }
let pw = true;
try { require.resolve('playwright', { paths: [root] }); } catch (e) { pw = false; }
if (pw) {
  planted.push('e2e-self'); run('self', process.execPath, ['tests/selftest/planted.e2e.js']);
  fs.renameSync(path.join(self, 'self.exit'), path.join(self, 'e2e-self.exit'));
  planted.push('board-self-pw'); run('board-self-pw', process.execPath, [require.resolve('@playwright/test/cli', { paths: [root] }), 'test', '-c', 'tests/selftest/pw.config.js']);
  planted.push('e2e-crash'); run('crash', process.execPath, ['tests/selftest/crash.e2e.js']);
  fs.renameSync(path.join(self, 'crash.exit'), path.join(self, 'e2e-crash.exit'));
}
// a runner that lies: a failure in its report, exit code 0 (apitest.py did this); and one that exits 1 with
// everything passing in its report (it crashed after writing it)
planted.push('self-lies'); write(path.join(self, 'self-lies.xml'), 'self-lies', [{ name: 'ok', ok: true }, { name: 'planted', ok: false }]); fs.writeFileSync(path.join(self, 'self-lies.exit'), '0');
planted.push('self-exits'); write(path.join(self, 'self-exits.xml'), 'self-exits', [{ name: 'ok', ok: true }]); fs.writeFileSync(path.join(self, 'self-exits.exit'), '1');
// a report with nothing in it (the runner found no tests)
planted.push('self-empty'); write(path.join(self, 'self-empty.xml'), 'self-empty', []); fs.writeFileSync(path.join(self, 'self-empty.exit'), '0');
// a browser test that failed, and failed again when Playwright ran it once more: only the last try counts, and it failed
const jsonl = (n, rows) => fs.writeFileSync(path.join(self, n + '.jsonl'), rows.map((r) => JSON.stringify(Object.assign({ suite: n, test: 'planted test' }, r))).join('\n') + '\n');
const { writeSuite } = require('../lib/checks');
planted.push('self-twice'); jsonl('self-twice', [{ name: 'a', ok: true, retry: 0 }, { name: 'b', ok: false, retry: 0 }, { name: 'a', ok: true, retry: 1 }, { name: 'b', ok: false, retry: 1 }]); writeSuite(self, 'self-twice');
// the report on each one alone must fail, and call it a failure (alone, so that each of the report's guards is
// proven by itself: with all of them at once, another guard could fail the run for it)
const quiet = { FB_QUARANTINE: path.join(self, 'none.json'), FB_STRICT: '', GITHUB_STEP_SUMMARY: '' };
const what = { 'self-node': 'a node:test file', 'self-pytest': 'a pytest file', 'e2e-self': 'a browser suite', 'e2e-crash': 'a browser suite that crashes before its report', 'self-lies': 'a report while its runner exits 0', 'self-exits': 'a runner that exits 1 with an all-pass report', 'self-empty': 'a report with no tests in it', 'self-twice': 'a browser test that fails on both tries', 'board-self-pw': 'a Playwright Test suite' };
const cases = planted.map((n) => {
  const rep = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'report.js'), self, n], { encoding: 'utf8', env: Object.assign({}, process.env, quiet) });
  const l = rep.stdout.split('\n').find((x) => x.startsWith(n.padEnd(14))) || '';
  return { name: `a failure planted in ${what[n]} fails the run`, ok: rep.status === 1 && /FAILED/.test(l), detail: l || rep.stdout };
});

if (planted.includes('board-self-pw')) {
  const f = path.join(self, 'board-self-pw.xml'), r = fs.existsSync(f) ? require('../lib/junit').read(f) : { failed: [] };
  cases.push({ name: 'a Playwright test that stops part way, with no failed check, is named in the report', ok: r.failed.some((n) => /stops part way \(ran to the end\)/.test(n)) && r.failed.includes('planted'), detail: r.failed });
}

// what passes, but must be shown: a test that passed on its second try (flaky), and a quarantined check failing
jsonl('self-flaky', [{ name: 'a', ok: true, retry: 0 }, { name: 'b', ok: false, retry: 0 }, { name: 'a', ok: true, retry: 1 }, { name: 'b', ok: true, retry: 1 }]); writeSuite(self, 'self-flaky');
fs.writeFileSync(path.join(self, 'self-flaky.exit'), '0');
write(path.join(self, 'self-held.xml'), 'self-held', [{ name: 'ok', ok: true }, { name: 'planted, quarantined', ok: false }]); fs.writeFileSync(path.join(self, 'self-held.exit'), '1');
const today = new Date().toISOString().slice(0, 10), qf = path.join(self, 'quarantine.json');
fs.writeFileSync(qf, JSON.stringify([{ suite: 'self-held', check: 'planted, quarantined', why: 'planted by the self-test', since: today }]));
const rep2 = (env) => spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'report.js'), self, 'self-flaky', 'self-held'], { encoding: 'utf8', env: Object.assign({}, process.env, { FB_QUARANTINE: qf, GITHUB_STEP_SUMMARY: '' }, env) });
const easy = rep2({ FB_STRICT: '' });
cases.push({ name: 'a test that passes on its second try passes the run, listed as flaky', ok: easy.status === 0 && /self-flaky .*1 flaky/.test(easy.stdout) && /flaky: planted test/.test(easy.stdout), detail: easy.stdout });
cases.push({ name: 'a quarantined check that fails is shown, and doesn\'t fail the run', ok: easy.status === 0 && /self-held .*1 quarantined failing/.test(easy.stdout) && /quarantined, failed: planted, quarantined/.test(easy.stdout), detail: easy.stdout });
// the weekly run (FB_STRICT) allows neither a flaky test nor a quarantine entry older than 30 days
const strict = rep2({ FB_STRICT: '1' });
cases.push({ name: 'the weekly run fails on a flaky test', ok: strict.status === 1 && /no flaky tests/.test(strict.stdout), detail: strict.stdout });
fs.writeFileSync(qf, JSON.stringify([{ suite: 'self-held', check: 'planted, quarantined', why: 'planted by the self-test', since: '2020-01-01' }]));
const stale = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'report.js'), self, 'self-held'], { encoding: 'utf8', env: Object.assign({}, process.env, { FB_QUARANTINE: qf, FB_STRICT: '1', GITHUB_STEP_SUMMARY: '' }) });
cases.push({ name: 'the weekly run fails on a check quarantined for more than 30 days', ok: stale.status === 1 && /more than 30 days/.test(stale.stdout), detail: stale.stdout });
write(path.join(out, 'selftest.xml'), 'selftest', cases);
cases.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '  -- ' + c.detail)));
process.exit(cases.every((c) => c.ok) ? 0 : 1);
