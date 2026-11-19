// Planted for the self-test (tests/selftest/run.js): the browser suites' harness, one pass and one failure.
const { suite } = require('../e2e/lib');
const { check, done } = suite(process.env.FB_SELF_NAME || 'self');
check('selftest: a check that passes', true);
check('selftest: a failure planted on purpose', false, 'planted');
done();
