// Planted for the self-test (tests/selftest/run.js): one check passes, one fails on purpose.
const { check } = require('../lib/check');
check('selftest: a check that passes', true);
check('selftest: a failure planted on purpose', false, 'planted');
