// The board's link to Home Assistant (0.10.0, class Link in the library section): every call goes through it.
// Run: node --test tests/link.test.js
// A pretend Home Assistant whose answers the test hands out by hand, in any order, on a pretend clock.
const { Link, Clock, linkOrder, stableJson } = require('./lib/board-lib');
const { check } = require('./lib/check');

// timers moved on by hand (as in clock.test.js)
function pretendTimers() {
  let now = 0, next = 1;
  const t = new Map();
  const env = {
    setTimeout: (fn, ms) => { const id = next++; t.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout: (id) => t.delete(id), setInterval: () => 0, clearInterval: () => {},
  };
  env.tick = (ms) => { const end = now + ms; for (;;) { const d = [...t.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!d) break; now = d[1].at; t.delete(d[0]); d[1].fn(); } now = end; };
  env.pending = () => t.size;
  return env;
}
// Home Assistant held in the test's hand: every call waits until the test answers it
function pretendHA() {
  const calls = [];
  const hold = (kind, args) => new Promise((resolve, reject) => calls.push({ kind, args, resolve, reject }));
  return {
    calls,
    to: { ws: (m) => hold('ws', m), api: (...a) => hold('api', a), service: (...a) => hold('service', a), sub: (m, cb) => hold('sub', { m, cb }) },
  };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const make = (o = {}) => { const env = pretendTimers(), ha = pretendHA(), told = []; const link = new Link(ha.to, Object.assign({ clock: new Clock(env), report: (e) => told.push(e) }, o)); return { env, ha, link, told }; };

(async () => {
  // L1 the latest question for the same thing wins
  {
    const { ha, link } = make();
    const got = [];
    link.ask({ type: 'config/label_registry/list' }).then((v) => got.push(['first', v]));
    link.ask({ type: 'config/label_registry/list' }).then((v) => got.push(['second', v]));
    // the second answer comes first, then the first (older) one
    ha.calls[1].resolve([{ label_id: 'new' }]); await settle();
    ha.calls[0].resolve([{ label_id: 'old' }]); await settle();
    const first = got.find((g) => g[0] === 'first'), second = got.find((g) => g[0] === 'second');
    check('L1 an older answer arriving last doesn\'t win: the earlier caller gets the newer answer', first && first[1][0].label_id === 'new' && second[1][0].label_id === 'new', got);
  }
  {
    const { ha, link } = make();
    const got = [];
    link.ask({ type: 'automation/config', entity_id: 'automation.a' }).then((v) => got.push(['first', v]));
    link.ask({ entity_id: 'automation.a', type: 'automation/config' }).then((v) => got.push(['second', v]));
    ha.calls[0].resolve({ config: 'old' }); await settle();
    check('L1 the earlier caller waits for the newer question when its own answer comes first', got.length === 0, got);
    ha.calls[1].resolve({ config: 'new' }); await settle();
    check('L1 ... and then both have the newer answer (the same question, whatever order its keys were in)', got.length === 2 && got.every((g) => g[1].config === 'new'), got);
  }
  {
    const { ha, link } = make();
    const got = [];
    link.ask({ type: 'automation/config', entity_id: 'automation.a' }).then((v) => got.push(v));
    link.ask({ type: 'automation/config', entity_id: 'automation.a' }).catch((e) => got.push('second failed ' + e.code));
    ha.calls[1].reject({ code: 'unknown_error', message: 'x' }); await settle();
    ha.calls[0].resolve({ config: 'old' }); await settle();
    check('L1 when the newer question fails, the older caller keeps its own answer', got.includes('second failed unknown_error') && got.some((g) => g && g.config === 'old'), got);
  }
  {
    const { ha, link } = make();
    link.ask({ type: 'config/entity_registry/update', entity_id: 'a', labels: [] });
    link.ask({ type: 'config/entity_registry/update', entity_id: 'a', labels: [] });
    const got = [];
    ha.calls[1].resolve('second'); ha.calls[0].resolve('first'); await settle();
    const a = link.ask({ type: 'config/entity_registry/update', entity_id: 'b' }); ha.calls[2].resolve('mine'); got.push(await a);
    check('L1 changes are never merged: each change has its own answer', got[0] === 'mine' && ha.calls.length === 3, got);
  }
  // L2 every call has a time limit
  {
    const { env, ha, link, told } = make({ timeout: 1000 });
    let err = null;
    link.ask({ type: 'config/entity_registry/list' }).catch((e) => { err = e; });
    env.tick(999); await settle();
    check('L2 no answer yet within the limit: still waiting', err === null);
    env.tick(1); await settle();
    check('L2 past the limit, the call fails with code timeout, and the failure is reported', err && err.code === 'timeout' && told.length === 1 && told[0].code === 'timeout', { err: err && err.code, told });
    ha.calls[0].resolve([]); await settle();
    check('L2 an answer after the limit changes nothing', told.length === 1);
    check('L2 an answered call leaves no timer set', (link.ask({ type: 'x/y' }), ha.calls[1].resolve(1), await settle(), env.pending() === 0), env.pending());
    let late = null;
    link.service('light', 'turn_on', {}, {}, { timeout: 50 }).catch((e) => { late = e.code; });
    env.tick(50); await settle();
    check('L2 a call\'s own limit (o.timeout) is used', late === 'timeout', late);
  }
  // L3 a failure is reported unless the call says why it's expected
  {
    const { ha, link, told } = make();
    let thrown = null;
    link.ask({ type: 'config/entity_registry/get', entity_id: 'x' }).catch((e) => { thrown = e; });
    ha.calls[0].reject({ code: 'not_found', message: 'Entity not found' }); await settle();
    check('L3 a failure is thrown to the caller and reported', thrown && thrown.code === 'not_found' && told.length === 1 && told[0].what === 'config/entity_registry/get' && told[0].kind === 'ws', { thrown, told });
    const v = link.ask({ type: 'trace/get', domain: 'automation', item_id: '1', run_id: '2' }, { optional: 'a trace can be gone', fallback: null });
    ha.calls[1].reject({ code: 'not_found', message: 'gone' });
    check('L3 an optional call answers its fallback and isn\'t reported', (await v) === null && told.length === 1, told);
    const w = link.api('GET', 'events', undefined, { fallback: [] });
    ha.calls[2].reject({ code: 'unknown_error', message: 'boom' });
    check('L3 a fallback alone still reports the failure', Array.isArray(await w) && told.length === 2 && told[1].kind === 'api', told);
    const s = await link.soft(Promise.reject(new Error('task broke')), 'diff', 'fb');
    check('L3 soft(): a task\'s failure is reported and answered with the fallback', s === 'fb' && told.length === 3 && told[2].kind === 'task', told);
    const q = await link.quiet(Promise.reject(new Error('expected')), 'why', 'fb');
    check('L3 quiet(): an expected failure answers the fallback and isn\'t reported', q === 'fb' && told.length === 3);
    for (let i = 0; i < 60; i++) link.report('ws', 't', { code: 'c' });
    check('L3 only the last 50 failures are kept', link.errors.length === 50);
  }
  // L4 lists in a fixed order
  {
    const { ha, link } = make();
    const p = link.ask({ type: 'config/label_registry/list' });
    ha.calls[0].resolve([{ label_id: 'b' }, { label_id: 'a' }, { label_id: 'c' }]);
    const helpers = link.ask({ type: 'input_boolean/list' });
    ha.calls[1].resolve([{ id: 'z' }, { id: 'y' }]);
    const traces = link.ask({ type: 'trace/list', domain: 'automation', item_id: '1' });
    ha.calls[2].resolve([{ id: 'z', run_id: '2' }, { id: 'y', run_id: '1' }]);
    check('L4 a registry list comes in a fixed order, by its id', (await p).map((x) => x.label_id).join() === 'a,b,c');
    check('L4 a list of helpers comes by id', (await helpers).map((x) => x.id).join() === 'y,z');
    check('L4 a list in an order that means something (traces, by time) keeps it', (await traces).map((x) => x.id).join() === 'z,y');
    const raw = [{ label_id: 'b' }, { label_id: 'a' }];
    check('L4 ordering doesn\'t change the list it was given', linkOrder('config/label_registry/list', raw)[0].label_id === 'a' && raw[0].label_id === 'b');
    const ents = [{ entity_id: 'b' }, { entity_id: 'a' }];
    check('L4 the entity, device and area registries keep Home Assistant\'s order (the order things were added, which the layout follows)', ['config/entity_registry/list', 'config/device_registry/list', 'config/area_registry/list'].every((t) => linkOrder(t, ents)[0].entity_id === 'b'));
  }
  // L5 the rest: services, subscriptions, unsubscribing, what Diagnostics carries
  {
    const { ha, link, told } = make();
    const s = link.sub({ type: 'subscribe_events', event_type: 'x' }, () => {});
    ha.calls[0].resolve(() => 'unsubscribed');
    check('L5 a subscription answers its unsubscribe function', typeof (await s) === 'function');
    link.drop(Promise.resolve(() => { throw new Error('connection gone'); })); await settle();
    link.drop(Promise.reject(new Error('never subscribed'))); await settle();
    check('L5 drop(): ending a subscription that is already gone isn\'t a failure', told.length === 0, told);
    link.service('notify', 'mobile_app_someones_phone', {}, {}).catch(() => {});
    ha.calls[1].reject({ code: 'service_not_found', message: 'Service notify.mobile_app_someones_phone not found' }); await settle();
    link.api('GET', 'config/script/config/someones_script').catch(() => {});
    ha.calls[2].reject({ code: 'not_found', message: 'someones_script' }); await settle();
    link.ask({ type: 'config/entity_registry/get', entity_id: 'light.someones_lamp' }).catch(() => {});
    ha.calls[3].reject({ code: 'not_found', message: 'light.someones_lamp' }); await settle();
    const anon = JSON.stringify(link.exportErrors(true)), real = JSON.stringify(link.exportErrors(false));
    check('L5 anonymised, the Diagnostics file carries no message, path or service name from a failure', !/someone/.test(anon) && /config\/entity_registry\/get/.test(anon) && /not_found/.test(anon), anon);
    check('L5 with real names, it carries the whole failure', /someones_lamp/.test(real) && /mobile_app_someones_phone/.test(real));
    let c = null;
    link.call('nodered flows', () => Promise.reject(new Error('502'))).catch((e) => { c = e.message; }); await settle();
    check('L5 call(): another call out has its failure reported and thrown', c === '502' && told.some((t) => t.kind === 'call' && t.what === 'nodered flows'), told);
    check('L5 nothing is kept for questions all answered', link._last.size === 0, [...link._last.keys()]);
    check('L5 stableJson writes a message the same whatever the order of its keys', stableJson({ b: 1, a: [1, { d: 2, c: 3 }] }) === stableJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
  }

  // L6 the connection coming back (0.10.0: the board catches up on what it missed): told through ready(), until
  // stopped; a link to something with no such news answers a function that stops nothing
  {
    const fns = new Set();
    const link = new Link({ ready: (cb) => { fns.add(cb); return () => fns.delete(cb); } });
    let n = 0;
    const off = link.ready(() => n++);
    [...fns].forEach((f) => f());
    off();
    [...fns].forEach((f) => f());
    check('L6 ready(): told when the connection comes back, and not after it is stopped', n === 1 && fns.size === 0, { n, left: fns.size });
    const none = new Link({}).ready(() => {});
    check('L6 ready() on a link with no connection news: a function that stops nothing', typeof none === 'function');
  }
})();
