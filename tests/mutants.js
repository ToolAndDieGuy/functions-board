// Mutants: each entry in tests/mutants.json breaks the code in one exact place, on purpose, and names the check
// that must catch it. This runner makes each break in turn, runs that one suite (only the cases named), puts the
// code back, and passes the mutant only if the named check failed. So every check listed is proven able to fail,
// and a test that goes quietly blind (it stops looking, or looks at the wrong thing) shows up here.
//   node tests/mutants.js [--ha] [pattern]
//     --ha     also the mutants checked on the real Home Assistant (started fresh once, then kept)
//     pattern  only the mutants whose names match (a regular expression)
// Writes tests/.results/mutants.xml (one case per mutant) and mutants.log; exits 1 if a mutant went uncaught,
// or its text isn't in the file any more (the list must follow the code).
// Each entry: { name, file, find (exact text, once in the file), replace, suite, only (FB_ONLY, optional),
// expect (a regular expression matched against the names of the failed checks), fresh (optional: the break
// leaves Home Assistant changed, so start a fresh one after it) }.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { write, read } = require('./lib/junit');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2), ha = args.includes('--ha'), pat = args.find((a) => !a.startsWith('--'));
// an option it doesn't know is a mistake, not a reason to run every mutant (each run breaks the code for minutes)
const odd = args.filter((a) => a.startsWith('--') && a !== '--ha');
if (odd.length) { console.error(`mutants.js: no option ${odd.join(', ')} (usage: node tests/mutants.js [--ha] [pattern])`); process.exit(2); }
const R = process.env.FB_RESULTS || path.join(__dirname, '.results');
const work = path.join(R, 'mutants'), keep = path.join(work, 'originals');
fs.mkdirSync(keep, { recursive: true });
const log = fs.openSync(path.join(R, 'mutants.log'), 'w');
const say = (s) => { console.log(s); fs.writeSync(log, s + '\n'); };

// a run stopped half way leaves the code broken: put back anything an earlier run kept
for (const f of fs.readdirSync(keep)) {
  const orig = Buffer.from(f, 'base64url').toString();
  fs.copyFileSync(path.join(keep, f), path.join(root, orig)); fs.rmSync(path.join(keep, f));
  say('put back ' + orig + ' (a run before this one stopped half way)');
}
const put = { file: null, text: null };
const restore = () => { if (put.file) { fs.writeFileSync(put.file, put.text); fs.rmSync(path.join(keep, Buffer.from(path.relative(root, put.file)).toString('base64url')), { force: true }); put.file = null; } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130); });

const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'mutants.json'), 'utf8'));
const realHA = (m) => /^(apitest|e2e-)/.test(m.suite);
const list = all.filter((m) => (!pat || new RegExp(pat).test(m.name)) && (ha || !realHA(m)));
say(`${list.length} of ${all.length} mutants` + (ha ? '' : ' (not the real-Home Assistant ones: --ha)'));
// a fresh Home Assistant once; each mutant then uses it as it is, but one that breaks the tests' own clean-up
// ("fresh": true) leaves things behind, so a fresh one is started after it
const fresh = () => {
  const r = spawnSync('sh', ['tests/run.sh', '--ha', '--only', '^$'], { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { FB_OUT: path.join(work, 'start') }) });
  if (r.status) { say('Home Assistant did not start:\n' + r.stdout + r.stderr); process.exit(1); }
};
if (ha && list.some(realHA)) fresh();

const cases = [];
for (const m of list) {
  const t0 = Date.now(), file = path.join(root, m.file);
  const text = fs.readFileSync(file, 'utf8'), n = text.split(m.find).length - 1;
  const name = `${m.name}: ${m.suite} catches it`;
  if (n !== 1) { cases.push({ name, ok: false, detail: `the text to break is in ${m.file} ${n} times, not once: update tests/mutants.json` }); say('STALE ' + m.name); continue; }
  fs.writeFileSync(path.join(keep, Buffer.from(m.file).toString('base64url')), text);
  put.file = file; put.text = text;
  fs.writeFileSync(file, text.replace(m.find, () => m.replace));
  const out = path.join(work, m.suite + '-' + cases.length);
  let r;
  try {
    r = spawnSync('sh', ['tests/run.sh', ...(realHA(m) ? ['--ha', '--keep'] : []), '--only', `^${m.suite}$`], {
      cwd: root, encoding: 'utf8',
      env: Object.assign({}, process.env, { FB_OUT: out, FB_RETRIES: '0', FB_ONLY: m.only || '', FB_QUARANTINE: path.join(work, 'none.json') }),
    });
  } finally { restore(); }
  const rep = path.join(out, m.suite + '.xml');
  const failed = fs.existsSync(rep) ? read(rep).failed : null;
  const re = new RegExp(m.expect);
  const hit = failed && failed.filter((f) => re.test(f));
  const ok = !!(hit && hit.length);
  const detail = ok ? '' : failed == null ? `${m.suite} wrote no report (it crashed): ${(r.stdout || '').split('\n').slice(-6).join(' | ')}`
    : failed.length ? `other checks failed, not /${m.expect}/: ${failed.slice(0, 5).join('; ')}` : `nothing failed: the break went unseen`;
  cases.push({ name, ok, detail, ms: Date.now() - t0 });
  say(`${ok ? 'CAUGHT' : 'MISSED'} ${m.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)${detail ? '  -- ' + detail : '  by: ' + hit.slice(0, 2).join('; ').slice(0, 240)}`);
  if (ok) fs.rmSync(out, { recursive: true, force: true });
  if (m.fresh && realHA(m)) fresh();
}
write(path.join(R, 'mutants.xml'), 'mutants', cases);
const missed = cases.filter((c) => !c.ok).length;
say(`\nmutants: ${cases.length - missed}/${cases.length} caught`);
process.exit(missed ? 1 : 0);
