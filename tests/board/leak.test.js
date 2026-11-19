// Opening and closing the board, on the fake Home Assistant (layer 3). Home Assistant takes the board off the page
// when another sidebar entry opens and makes a new one when it comes back; a dashboard card comes and goes with
// its view. Here the board is taken off and put back 50 times with the garage open, and then taken off for good.
// Instruments in the page count timers and the listeners on window and document.
//
//   L1  taken off for good, the board has no subscription left with Home Assistant
//   L2  taken off for good, nothing of the board's runs any more: no interval left, no timer firing
//   L3  taken off for good, it leaves no listener on window or document
//   L4  the 50 boards taken off are all let go (garbage collected): nothing holds on to them
//   L5  the 50th board asks Home Assistant no more than the 2nd did (nothing piles up from one to the next)
//   L6  the 50th board draws what the first did, with no errors
const { until, suite, freshBoard, importAll, openFn, current } = require('./helpers');
const { test } = require('./fixtures');

const { check, done } = suite('board-leak');
const ROUNDS = +(process.env.FB_LEAK_ROUNDS || 50);

// Runs in the page before anything else: every timer and interval, and every listener on window and document.
const INSTRUMENTS = `(() => {
  const T = window.__fbT = { live: new Map(), fired: [], on: false, listeners: new Map() };
  const st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval, ci = window.clearInterval;
  const where = () => (new Error().stack || '').split('\\n').slice(3, 5).map((s) => s.trim().replace(/^at /, '').replace(/https?:\\/\\/[^/]+/, '')).join(' < ');
  window.setTimeout = function (fn, ms, ...a) {
    const w = where();
    const id = st.call(window, function () { T.live.delete(id); if (T.on) T.fired.push('timeout ' + (ms || 0) + ' ms ' + w); if (typeof fn === 'function') return fn.apply(this, arguments); }, ms, ...a);
    T.live.set(id, { kind: 'timeout', ms: ms || 0, w });
    return id;
  };
  window.clearTimeout = function (id) { T.live.delete(id); return ct.call(window, id); };
  window.setInterval = function (fn, ms, ...a) {
    const w = where();
    const id = si.call(window, function () { if (T.on) T.fired.push('interval ' + ms + ' ms ' + w); if (typeof fn === 'function') return fn.apply(this, arguments); }, ms, ...a);
    T.live.set(id, { kind: 'interval', ms, w });
    return id;
  };
  window.clearInterval = function (id) { T.live.delete(id); return ci.call(window, id); };
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const name = (t) => (t === window ? 'window' : 'document');
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if ((this === window || this === document) && fn && !(o && o.once)) T.listeners.set(fn, name(this) + ' ' + type + ' ' + where());
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    if (this === window || this === document) T.listeners.delete(fn);
    return rem.call(this, type, fn, o);
  };
})();`;

const drawn = (page) => page.evaluate(() => { const b = document.querySelector('functions-board'); return b && b.shadowRoot && b.shadowRoot.querySelectorAll('.nodes .node').length; });

test('the board opened and closed 50 times', async ({ browser }) => {
  const { page, ctx } = await freshBoard(browser, { viewport: { width: 1400, height: 880 }, init: INSTRUMENTS });
  page.allowFail = [/^trace\/get$/, /^supervisor\/api$/];
  await importAll(page);
  await openFn(page, /garage/i);
  const first = await drawn(page);
  const fake = current.fake;
  const asked = [];
  for (let i = 0; i < ROUNDS; i++) {
    await page.evaluate(() => { const b = document.querySelector('functions-board'); (window.__fbRefs = window.__fbRefs || []).push(new WeakRef(b)); b.remove(); });
    await page.waitForTimeout(50);
    const n0 = fake.calls.length;
    await page.evaluate(() => window.__fbAttach());
    await until(async () => (await drawn(page)) === first || null, 15000);
    await fake.idle(300);
    asked.push(fake.calls.length - n0);
  }
  const last = await drawn(page);
  // taken off for good
  await page.evaluate(() => { const b = document.querySelector('functions-board'); window.__fbRefs.push(new WeakRef(b)); b.remove(); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__fbT.on = true; window.__fbT.fired = []; });
  await page.waitForTimeout(5000);
  // only what the board's own code set (the fake's page side and Playwright set some of their own)
  const after = await page.evaluate(() => {
    const T = window.__fbT, mine = (w) => /functions-board\.js/.test(w);
    return {
      intervals: [...T.live.values()].filter((t) => t.kind === 'interval' && mine(t.w)).map((t) => t.ms + ' ms ' + t.w),
      fired: [...new Set(T.fired.filter(mine))],
      listeners: [...T.listeners.values()].filter(mine),
    };
  });
  const subs = [...fake.subs.values()].map((v) => v.msg.type + (v.msg.event_type ? ' ' + v.msg.event_type : ''));
  check('L1 taken off for good, the board has no subscription left with Home Assistant', subs.length === 0, { left: subs.length, kinds: [...new Set(subs)] });
  check('L2 taken off for good, no interval of the board\'s is left', after.intervals.length === 0, { left: after.intervals.length, kinds: [...new Set(after.intervals)] });
  check('L2 taken off for good, no timer of the board\'s fires (5 s watched)', after.fired.length === 0, after.fired);
  check('L3 taken off for good, the board leaves no listener on window or document', after.listeners.length === 0, { left: after.listeners.length, kinds: [...new Set(after.listeners)] });
  // the garbage collector, twice (a WeakRef is let go only at a collection after the turn it was read in)
  const cdp = await ctx.newCDPSession(page);
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(200); }
  const alive = await page.evaluate(() => window.__fbRefs.map((r, i) => (r.deref() ? i : -1)).filter((i) => i >= 0));
  check(`L4 the ${ROUNDS + 1} boards taken off are all let go`, alive.length === 0, { alive, of: ROUNDS + 1 });
  check(`L5 the ${ROUNDS}th board asks no more than the 2nd`, asked.length > 1 && asked[asked.length - 1] <= asked[1] * 1.2 + 5, { second: asked[1], last: asked[asked.length - 1], all: asked.join(' ') });
  check(`L6 the ${ROUNDS}th board draws what the first did`, first > 0 && last === first, { first, last });
  check('L6 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test.afterAll(() => done());
