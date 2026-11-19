// The board's clock (0.10.0, class Clock in the library section): every wait the board sets, by name, stopped
// together when the board leaves the page. Run: node --test tests/clock.test.js
// On a pretend clock: timers fire only when the test moves the time on (tick).
const { Clock } = require('./lib/board-lib');
const { check } = require('./lib/check');

// a pretend set of timer functions: what's set, and the time moved on by hand
function pretend() {
  let now = 0, next = 1;
  const t = new Map();
  const env = {
    setTimeout: (fn, ms) => { const id = next++; t.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout: (id) => t.delete(id),
    setInterval: (fn, ms) => { const id = next++; t.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => t.delete(id),
    requestAnimationFrame: (fn) => { const id = next++; t.set(id, { at: now + 16, fn: () => fn(now) }); return id; },
    cancelAnimationFrame: (id) => t.delete(id),
  };
  // move the time on by ms, firing what falls due in order
  env.tick = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...t.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, x] = due;
      now = x.at;
      if (x.every) x.at += x.every; else t.delete(id);
      x.fn();
    }
    now = end;
  };
  env.pending = () => t.size;
  return env;
}
const settle = () => new Promise((r) => setImmediate(r));

(async () => {
  // C1 after(): the last call for a name wins (a debounce)
  {
    const env = pretend(), c = new Clock(env), got = [];
    c.after('save', 700, () => got.push('a'));
    env.tick(500);
    c.after('save', 700, () => got.push('b'));
    env.tick(600);
    check('C1 after(): a second call for the same name replaces the first, and the time starts again', got.length === 0, got);
    env.tick(200);
    check('C1 after(): only the last call runs, once', got.join() === 'b' && !c.has('save'), got);
  }
  // C2 once(): the first call wins (a throttle)
  {
    const env = pretend(), c = new Clock(env), got = [];
    c.once('states', 1000, () => got.push('a'));
    c.once('states', 1000, () => got.push('b'));
    env.tick(1000);
    c.once('states', 1000, () => got.push('c'));
    env.tick(1000);
    check('C2 once(): calls while one is waiting are dropped; after it runs, the next one waits again', got.join() === 'a,c', got);
  }
  // C3 every() and frame()
  {
    const env = pretend(), c = new Clock(env), got = [];
    c.every('poll', 4000, () => got.push('p'));
    c.frame('edges', () => got.push('f'));
    c.frame('edges', () => got.push('g'));
    env.tick(12000);
    check('C3 every() repeats; frame() runs once for any number of calls before the frame', got.join() === 'f,p,p,p', got);
    c.cancel('poll'); env.tick(8000);
    check('C3 cancel() stops a repeat', got.length === 4 && !c.has('poll'), got);
    let stamp = null;
    c.frame('glide', (t) => { stamp = t; });
    env.tick(16);
    check('C3 frame() hands on the frame\'s time (an animation needs it)', typeof stamp === 'number' && stamp > 0, stamp);
  }
  // C4 a null name: a wait of its own
  {
    const env = pretend(), c = new Clock(env), got = [];
    const a = c.after(null, 100, () => got.push('a')), b = c.after(null, 100, () => got.push('b'));
    c.cancel(a);
    env.tick(100);
    check('C4 waits without a name don\'t replace each other, and each can be cancelled by the name returned', a !== b && got.join() === 'b', { a, b, got });
  }
  // C5 stop(): nothing runs after it, nothing new starts, start() lets them again
  {
    const env = pretend(), c = new Clock(env), got = [];
    c.after('save', 700, () => got.push('save'));
    c.once('scan', 60000, () => got.push('scan'));
    c.every('conds', 30000, () => got.push('conds'));
    c.frame('edges', () => got.push('edges'));
    c.stop();
    check('C5 stop() leaves no timer of its own set', env.pending() === 0 && c.size === 0, { pending: env.pending(), size: c.size });
    c.after('toast', 10, () => got.push('toast')); c.once('x', 10, () => got.push('x')); c.every('y', 10, () => got.push('y')); c.frame('z', () => got.push('z'));
    env.tick(10 * 60000);
    check('C5 after stop(), nothing runs: neither what was waiting nor what was asked for since', got.length === 0 && env.pending() === 0, got);
    c.start();
    c.after('toast', 10, () => got.push('toast'));
    env.tick(10);
    check('C5 start() lets waits run again', got.join() === 'toast', got);
  }
  // C6 sleep(): true when the time is up, false at once when the clock stops
  {
    const env = pretend(), c = new Clock(env);
    let a = null, b = null;
    c.sleep(300).then((v) => { a = v; });
    env.tick(300); await settle();
    c.sleep(300).then((v) => { b = v; });
    env.tick(100); await settle();
    c.stop(); await settle();
    check('C6 sleep() answers true when its time is up', a === true, a);
    check('C6 a sleep still waiting answers false as soon as the clock stops, and leaves no timer', b === false && env.pending() === 0, { b, pending: env.pending() });
    let d = null;
    c.sleep(300).then((v) => { d = v; }); await settle();
    check('C6 sleep() on a stopped clock answers false at once', d === false, d);
  }
  // C7 deadline(): runs when the time is up, or at once when the clock stops; pause() isn't stopped
  {
    const env = pretend(), c = new Clock(env), got = [];
    c.deadline(4000, () => got.push('late'));
    env.tick(4000);
    const d = c.deadline(8000, () => got.push('given up'));
    c.deadline(8000, () => got.push('given up too'));
    c.cancel(d);
    let paused = null;
    c.pause(300).then(() => { paused = 'done'; });
    c.stop();
    check('C7 a deadline runs when its time is up', got[0] === 'late', got);
    check('C7 stop() runs every deadline still waiting at once (one cancelled doesn\'t run)', got.join() === 'late,given up too', got);
    env.tick(300); await settle();
    check('C7 pause() runs out even on a stopped clock (a write in progress finishes)', paused === 'done', paused);
    const late = [];
    c.deadline(100, () => late.push('x'));
    check('C7 a deadline asked of a stopped clock runs at once', late.join() === 'x', late);
  }
})();
