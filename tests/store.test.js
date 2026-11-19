// The board's store (0.10.0, class Store in the library section): what it knows of Home Assistant, each fact with
// the time it was asked. Run: node --test tests/store.test.js
// On a pretend clock, with answers the test hands out by hand.
const { Store } = require('./lib/board-lib');
const { check } = require('./lib/check');

function pretend() {
  let t = 1000;
  const asks = [];
  const store = new Store((key) => new Promise((resolve, reject) => asks.push({ key, resolve, reject, at: t })), { now: () => t });
  return { store, asks, tick: (ms) => { t += ms; }, now: () => t };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  // S1 an older answer never replaces a newer one
  {
    const { store, asks, tick } = pretend();
    const a = store.load('reg'); tick(10);
    const b = store.load('reg');
    check('S1 a question asked later isn\'t merged into one asked earlier', asks.length === 2);
    asks[1].resolve('new'); await settle();
    asks[0].resolve('old'); await settle();
    check('S1 the older answer, coming last, doesn\'t replace the newer one', store.get('reg') === 'new' && (await a) === 'new' && (await b) === 'new', { held: store.get('reg') });
    check('S1 put() refuses a fact asked before the one held', store.put('reg', 'older', 500) === false && store.get('reg') === 'new');
  }
  // S2 questions in flight are shared when asked late enough
  {
    const { store, asks, tick } = pretend();
    const a = store.load('reg'); tick(5);
    const b = store.load('reg', 900);
    check('S2 a load that can take an answer asked at or after a time shares the question in flight', asks.length === 1);
    store.load('reg');
    check('S2 a load "from now" asks again when the question in flight was asked earlier', asks.length === 2);
    asks[0].resolve('x'); asks[1].resolve('y'); await settle();
    check('S2 ... and every caller gets the newest fact', (await a) === 'y' && (await b) === 'y');
  }
  // S3 as of now: a change makes a fact stale; asOfNow waits for an answer asked after the change
  {
    const { store, asks, tick } = pretend();
    store.load('reg'); asks[0].resolve('v1'); await settle();
    tick(100);
    check('S3 a fact with no change since is fresh: asOfNow answers it without asking', (await store.asOfNow('reg')) === 'v1' && asks.length === 1);
    store.changed('reg'); tick(1);
    const p = store.asOfNow('reg');
    check('S3 after Home Assistant says it changed, asOfNow asks again', asks.length === 2 && store.stale('reg'));
    asks[1].resolve('v2');
    check('S3 ... and answers the fact asked after the change', (await p) === 'v2' && !store.stale('reg'));
    // a reload already in flight, asked after the change, is waited for, not asked again
    store.changed('reg'); tick(1);
    store.load('reg'); tick(1);
    const q = store.asOfNow('reg');
    check('S3 a reload in flight asked after the change is waited for (no second question)', asks.length === 3);
    asks[2].resolve('v3');
    check('S3 ... and its answer is the one given', (await q) === 'v3');
  }
  // S4 a load asked before a change, answering after it, is held but still stale
  {
    const { store, asks, tick } = pretend();
    store.load('cfg:automation.a'); tick(10);
    store.changed('cfg:'); tick(10);
    asks[0].resolve({ alias: 'before the save' }); await settle();
    check('S4 an answer to a question asked before a change is held, but stale', store.get('cfg:automation.a').alias === 'before the save' && store.stale('cfg:automation.a'));
    const p = store.asOfNow('cfg:automation.a');
    asks[1].resolve({ alias: 'after the save' });
    check('S4 asOfNow then asks again and answers the newer config', (await p).alias === 'after the save');
    check('S4 a change to one config leaves the others fresh', (store.changed('cfg:automation.b'), !store.stale('cfg:automation.a')));
  }
  // S5 how old a fact may be
  {
    const { store, asks, tick } = pretend();
    store.load('cfg:script.s'); asks[0].resolve(1); await settle();
    tick(59000);
    check('S5 within its maximum age, a fact is answered as held', (await store.asOfNow('cfg:script.s', 60000)) === 1 && asks.length === 1);
    tick(2000);
    const p = store.asOfNow('cfg:script.s', 60000);
    check('S5 past it, asked again', asks.length === 2);
    asks[1].resolve(2);
    check('S5 ... with the new answer', (await p) === 2);
  }
  // S6 newer(): the rule for deleting
  {
    const { store, tick } = pretend();
    store.put('reg', 'warm, from another board', 500);
    store.put('data', null);
    check('S6 registries asked before the board data are not newer than it (nothing is deleted on them)', !store.newer('reg', 'data'));
    tick(10); store.put('reg', 'fresh');
    check('S6 registries asked after it are', store.newer('reg', 'data'));
    store.forget('cfg:');
    check('S6 forget() lets go of what\'s held under a prefix', !store.has('cfg:x') && store.has('reg'));
  }
  // S7 a failed load: nothing held changes, and the next asks again
  {
    const { store, asks } = pretend();
    store.put('reg', 'old', 1);
    const p = store.load('reg');
    asks[0].reject(new Error('down'));
    let err = null; try { await p; } catch (e) { err = e.message; }
    check('S7 a failed load throws to its callers and leaves what was held', err === 'down' && store.get('reg') === 'old');
    store.load('reg');
    check('S7 ... and isn\'t shared by the next load', asks.length === 2);
  }
})();
