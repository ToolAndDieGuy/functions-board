// Planted failures in a Playwright Test suite, run by tests/selftest/run.js through tests/selftest/pw.config.js
// (with the board layer's fixtures): one test whose check fails, and one that stops with an error and no failed
// check. The report must fail, and must name the second one as "(ran to the end)".
const { test } = require('../board/fixtures');
const { suite } = require('../board/helpers');
const { check, done } = suite('board-self-pw');
test('a planted failing check', async () => { check('fine', true); check('planted', false); });
test('a planted test that stops part way', async () => { check('before it stops', true); throw new Error('planted stop'); });
test.afterAll(() => done());
