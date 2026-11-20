// Playwright Test for the browser suites on the real Home Assistant (tests/playwright.config.js).
//  - isolate (automatic): every test starts from a snapshot of what tests may change in Home Assistant, and goes
//    back to it afterwards, whatever happened: automations and scripts a test added are deleted, the ones it
//    changed or deleted come back, the same automations are on and off, and the board's data is cleared.
//  - traces: every browser context a test opens records a trace; a failed test keeps them (in its report under
//    tests/.results/), a passing one throws them away.
//  - check() from suite() is also a soft expectation, so Playwright marks the test failed too.
const fs = require('fs');
const base = require('@playwright/test');
const lib = require('./lib');
const ha = require('./ha-api');

lib.hooks.soft = (ok, msg) => base.expect.soft(ok, msg).toBe(true);
lib.hooks.trace = true;

const test = base.test.extend({
  isolate: [async ({}, use, testInfo) => {
    const snap = await ha.snapshot();
    const own = lib.suiteOf(testInfo.file);
    lib.hooks.mark = own ? own.results.length : 0;
    lib.hooks.traces = [];
    lib.hooks.attempt = { test: testInfo.titlePath.slice(1).join(' › '), retry: testInfo.retry };
    await use();
    // the traces of the contexts still open, then keep them only if the test failed
    for (const c of lib.hooks.open.splice(0)) await lib.stopTrace(c).catch(() => {});
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [i, t] of lib.hooks.traces.entries()) {
      if (failed && fs.existsSync(t)) await testInfo.attach(`trace-${i + 1}`, { path: t, contentType: 'application/zip' });
      fs.rmSync(t, { force: true });
    }
    const undone = await ha.restore(snap);
    if (undone.length) testInfo.annotations.push({ type: 'restored after it', description: undone.join('; ') });
  }, { auto: true }],
});

// a test that ended early (an error, a timeout) counts as a failed check in the suite's own report too
test.afterEach(async ({}, testInfo) => {
  // (a failed check fails the test too; that's already in the report, so only a test that stopped counts here)
  // (the test's own suite: a worker runs tests from several files, and the last one loaded may be another's)
  const own = lib.suiteOf(testInfo.file);
  if (testInfo.status !== testInfo.expectedStatus && testInfo.error && own && !own.results.slice(lib.hooks.mark || 0).some((r) => !r.ok)) {
    own.check(testInfo.title + ' (ran to the end)', false, String(testInfo.error.message || testInfo.error).split('\n')[0]);
  }
});

module.exports = { test, expect: base.expect };
