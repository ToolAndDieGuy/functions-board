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
    const fake = new FakeHA();
    helpers.current.fake = fake;
    helpers.current.all = [fake];
    lib.hooks.traces = [];
    lib.hooks.mark = lib.hooks.suite ? lib.hooks.suite.results.length : 0;
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
    if (unknown.length && lib.hooks.suite) lib.hooks.suite.check(testInfo.title + ': the board asked the fake Home Assistant only what it knows', false, unknown);
  }, { auto: true }],
});
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && testInfo.error && lib.hooks.suite && !lib.hooks.suite.results.slice(lib.hooks.mark || 0).some((r) => !r.ok)) {
    lib.hooks.suite.check(testInfo.title + ' (ran to the end)', false, String(testInfo.error.message || testInfo.error).split('\n')[0]);
  }
});
module.exports = { test, expect: base.expect };
