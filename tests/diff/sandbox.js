// The differential test's sandbox side (0.11.2): runs every scenario of tests/diff/corpus.js (and, with --random N,
// N random ones from tests/diff/random.js) in the board's sandbox engine and writes what happened after each step:
// the calls made (service and entities, sorted) and the state of every entity in the scenario. tests/diff/test_diff.py
// runs the same scenarios in Home Assistant's core and compares. Run: node tests/diff/sandbox.js <out.json> [--random N] [--seed S]

const fs = require('fs');
const { Sandbox, localAt } = require('../lib/board-lib');

const TZ = 'America/New_York';
// Tue 17 Nov 2026, 20:00:01 in New York (01:00:01 UTC on the 18th; a second past the hour, so a time pattern
// isn't due the moment both start): test_diff.py starts Home Assistant's clock there too
const START = localAt(Date.parse('2026-11-17T12:00:00Z'), [20, 0], TZ) + 1000;

async function runOne(sc) {
  const states = {};
  for (const [id, [state, attributes]] of Object.entries(sc.states)) {
    states[id] = { state, attributes: attributes || {}, last_changed: new Date(START - 3600e3).toISOString(), last_updated: new Date(START - 3600e3).toISOString() };
  }
  for (const id of Object.keys(sc.automations)) states['automation.' + id] = { state: 'on', attributes: {}, last_changed: new Date(START).toISOString() };
  const sb = new Sandbox({
    states, items: Object.entries(sc.automations).map(([id, cfg]) => ({ id: 'automation.' + id, cfg })), now: START, tz: TZ,
    // the corpus has no templates: one here is a mistake in the corpus
    tpl: async (t) => ({ ok: false, err: 'no templates in the differential corpus: ' + t }),
    ask: async () => true, name: (id) => id, condText: (c) => (typeof c === 'string' ? c : c.condition || 'condition'),
    // helpers that follow what they read: the rule as functions_board/sources gives it
    derived: Object.fromEntries(Object.entries(sc.derived || {}).map(([id, rule]) => [id, { rule, reads: [] }])),
  });
  // Home Assistant works them out when they're set up, before the automations
  await sb.followAll();
  await sb.start();
  const ids = Object.keys(sc.states).sort();
  const trace = [];
  let seen = 0;
  for (const step of sc.steps) {
    if (step.set) await sb.userSet(step.set, step.to, step.attrs);
    else if (step.wait != null) await sb.advance(step.wait * 1000);
    else if (step.event) await sb.userEvent(step.event, step.data);
    const fresh = sb.log.slice(seen);
    seen = sb.log.length;
    // service calls only (firing an event is a call in the timeline, not a service call in Home Assistant)
    const calls = fresh.filter((e) => e.kind === 'call' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(e.svc || '')).map((e) => e.svc + ' ' + [...(e.ents || [])].sort().join(',')).sort();
    const st = {};
    ids.forEach((id) => { const s = sb.get(id); st[id] = s ? s.state : null; });
    const warn = fresh.filter((e) => e.kind === 'note' && e.warn).map((e) => e.text);
    trace.push({ calls, states: st, warn });
  }
  return trace;
}

async function main() {
  const args = process.argv.slice(2);
  const out = args[0];
  if (!out) { console.error('usage: node tests/diff/sandbox.js <out.json> [--random N] [--seed S]'); process.exit(2); }
  const n = args.includes('--random') ? +args[args.indexOf('--random') + 1] : 0;
  const seed = args.includes('--seed') ? +args[args.indexOf('--seed') + 1] : Date.now() % 100000;
  const list = require('./corpus').slice();
  if (n) list.push(...require('./random').make(n, seed));
  const res = [];
  for (const sc of list) {
    try { res.push(Object.assign({}, sc, { sandbox: await runOne(sc) })); }
    catch (e) { res.push(Object.assign({}, sc, { sandbox: null, error: String(e && e.stack || e) })); }
  }
  fs.writeFileSync(out, JSON.stringify({ start: new Date(START).toISOString(), tz: TZ, seed: n ? seed : null, scenarios: res }, null, 1));
  console.log(`${res.length} scenarios run in the sandbox${n ? ` (${n} random, seed ${seed})` : ''} → ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
