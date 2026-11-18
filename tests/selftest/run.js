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
  planted.push('e2e-crash'); run('crash', process.execPath, ['tests/selftest/crash.e2e.js']);
  fs.renameSync(path.join(self, 'crash.exit'), path.join(self, 'e2e-crash.exit'));
}
// a runner that lies: a failure in its report, exit code 0 (apitest.py did this); and one that exits 1 with
// everything passing in its report (it crashed after writing it)
planted.push('self-lies'); write(path.join(self, 'self-lies.xml'), 'self-lies', [{ name: 'ok', ok: true }, { name: 'planted', ok: false }]); fs.writeFileSync(path.join(self, 'self-lies.exit'), '0');
planted.push('self-exits'); write(path.join(self, 'self-exits.xml'), 'self-exits', [{ name: 'ok', ok: true }]); fs.writeFileSync(path.join(self, 'self-exits.exit'), '1');
// the report on them must fail, and name every one as a failure
const rep = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'report.js'), self, ...planted], { encoding: 'utf8' });
const lines = rep.stdout.split('\n');
const cases = planted.map((n) => {
  const l = lines.find((x) => x.startsWith(n.padEnd(14))) || '';
  const what = { 'self-node': 'a node:test file', 'self-pytest': 'a pytest file', 'e2e-self': 'a browser suite', 'e2e-crash': 'a browser suite that crashes before its report', 'self-lies': 'a report while its runner exits 0', 'self-exits': 'a runner that exits 1 with an all-pass report' }[n];
  return { name: `a failure planted in ${what} fails the run`, ok: rep.status === 1 && /FAILED/.test(l), detail: l || rep.stdout };
});
write(path.join(out, 'selftest.xml'), 'selftest', cases);
cases.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '  -- ' + c.detail)));
process.exit(cases.every((c) => c.ok) ? 0 : 1);
