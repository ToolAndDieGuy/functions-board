// check(name, ok, detail): one named node:test test per check. The test runner counts, reports (spec on the
// screen, JUnit for run.sh and CI) and sets the exit code; a check made after an await still counts.
const { test } = require('node:test');
const assert = require('node:assert');

function check(name, ok, detail) {
  test(name, () => {
    if (!ok) assert.fail(name + (detail === undefined ? '' : '  -- ' + JSON.stringify(detail)));
  });
}
module.exports = { check, test };
