// Playwright Test for the board on the fake Home Assistant (layer 3, tests/board.config.js): every test gets its
// own fake (tests/board/fake-ha.js), opened as often as it likes through session() in helpers.js. A test fails if
// the board asked the fake anything it doesn't know (a command the fake would have to learn, or a mistake).
const fs = require('fs');
const base = require('@playwright/test');
const lib = require('../e2e/lib');
const helpers = require('./helpers');
const { FakeHA } = require('./fake-ha');

lib.hooks.soft = (ok, msg) => base.expect.soft(ok, msg).toBe(true);
lib.hooks.trace = true;

const test = base.test.extend({
  fake: [async ({}, use, testInfo) => {
    // FB_JITTER=<seed>: this test's fakes answer late and out of turn (fake-ha.js), the same way for the same seed
    FakeHA.defaults.jitter = process.env.FB_JITTER ? `${process.env.FB_JITTER}:${testInfo.titlePath.slice(1).join(' › ')}` : null;
    const fake = new FakeHA();
    helpers.current.fake = fake;
    helpers.current.all = [fake];
    lib.hooks.traces = [];
    lib.hooks.attempt = { test: testInfo.titlePath.slice(1).join(' › '), retry: testInfo.retry };
    const own = lib.suiteOf(testInfo.file);
    lib.hooks.mark = own ? own.results.length : 0;
    await use(fake);
    for (const c of lib.hooks.open.splice(0)) await lib.stopTrace(c).catch(() => {});
    const fakes = helpers.current.all;
    for (const f of fakes) for (const p of [...f.pages]) await p.context().close().catch(() => {});
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [i, t] of lib.hooks.traces.entries()) {
      if (failed && fs.existsSync(t)) await testInfo.attach(`trace-${i + 1}`, { path: t, contentType: 'application/zip' });
      fs.rmSync(t, { force: true });
    }
    helpers.current.fake = null; helpers.current.all = [];
    const unknown = [...new Set(fakes.flatMap((f) => f.unknown))];
    if (unknown.length && own) own.check(testInfo.title + ': the board asked the fake Home Assistant only what it knows', false, unknown);
  }, { auto: true }],
});
test.afterEach(async ({}, testInfo) => {
  // (the test's own suite: a worker runs tests from several files, and the last one loaded may be another's)
  const own = lib.suiteOf(testInfo.file);
  if (testInfo.status !== testInfo.expectedStatus && testInfo.error && own && !own.results.slice(lib.hooks.mark || 0).some((r) => !r.ok)) {
    own.check(testInfo.title + ' (ran to the end)', false, String(testInfo.error.message || testInfo.error).split('\n')[0]);
  }
});
module.exports = { test, expect: base.expect };
