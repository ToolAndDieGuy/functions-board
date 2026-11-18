// Planted for the self-test (tests/selftest/run.js): a suite that crashes before it writes its report.
const { suite } = require('../e2e/lib');
const { check } = suite(process.env.FB_SELF_NAME || 'crash');
check('selftest: one check before the crash', true);
throw new Error('planted crash');
