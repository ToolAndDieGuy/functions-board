// Playwright Test for the browser suites on the real Home Assistant (layer 4). tests/run.sh runs one suite at a
// time (FB_SUITE=<name>): they share the one Home Assistant, so one worker, in order. Each test is isolated by
// the fixture in tests/e2e/fixtures.js; a failed test keeps its traces in tests/.results/html-<suite>/
// (open with: npx playwright show-report tests/.results/html-<suite>).
const path = require('path');
const { defineConfig } = require('@playwright/test');

const results = process.env.FB_RESULTS || path.join(__dirname, '.results');
const suite = process.env.FB_SUITE || 'all';
module.exports = defineConfig({
  globalSetup: require.resolve('./lib/pw-setup'),
  globalTeardown: require.resolve('./lib/pw-teardown'),
  testDir: path.join(__dirname, 'e2e'),
  testMatch: process.env.FB_SUITE ? new RegExp(`(^|/)${process.env.FB_SUITE}\\.test\\.js$`) : /(^|\/)(isolation|contract|ui|regress|tools|sync|sandbox|versions|privacy)\.test\.js$/,
  workers: 1,
  fullyParallel: false,
  // a test that fails is run once more in CI, and one that passes then is reported as flaky (tests/lib/checks.js)
  retries: +(process.env.FB_RETRIES || (process.env.CI ? 1 : 0)),
  // the older suites are one long test each; the fixture's snapshot and restore are part of every test
  timeout: 30 * 60 * 1000,
  expect: { timeout: 10000 },
  outputDir: path.join(results, 'pw-' + suite),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(results, 'html-' + suite) }]],
  use: { headless: true },
});
