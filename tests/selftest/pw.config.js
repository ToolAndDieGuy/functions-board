// Playwright Test for the self-test's planted suite only (tests/selftest/planted.pw.js), on the board's fixtures.
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /planted\.pw\.js$/,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: require('path').join(process.env.FB_RESULTS || '/tmp', 'pw-self'),
  globalSetup: require.resolve('../lib/pw-setup'),
  globalTeardown: require.resolve('../lib/pw-teardown'),
});
