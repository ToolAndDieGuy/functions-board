// Playwright Test for the board on the fake Home Assistant (layer 3): no Home Assistant, every test its own fake,
// as many at once as the machine has cores. tests/run.sh runs each suite (FB_SUITE=<name>) as board-<name>.
const os = require('os');
const path = require('path');
const { defineConfig } = require('@playwright/test');

const results = process.env.FB_RESULTS || path.join(__dirname, '.results');
const suite = process.env.FB_SUITE || 'all';
module.exports = defineConfig({
  globalSetup: require.resolve('./lib/pw-setup'),
  globalTeardown: require.resolve('./lib/pw-teardown'),
  testDir: path.join(__dirname, 'board'),
  testMatch: process.env.FB_SUITE ? new RegExp(`(^|/)${process.env.FB_SUITE}\\.test\\.js$`) : /\.test\.js$/,
  workers: process.env.CI ? '100%' : Math.max(1, os.cpus().length),
  fullyParallel: true,
  // a test that fails is run once more in CI, and one that passes then is reported as flaky (tests/lib/checks.js)
  retries: +(process.env.FB_RETRIES || (process.env.CI ? 1 : 0)),
  timeout: 5 * 60 * 1000,
  expect: { timeout: 10000 },
  outputDir: path.join(results, 'pwb-' + suite),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(results, 'htmlb-' + suite) }]],
  use: { headless: true },
});
