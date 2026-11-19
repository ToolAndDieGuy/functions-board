// Playwright's global teardown, for both configs: once every worker is done, each suite's report is written again
// from its whole check log (<suite>.jsonl), so a report written by one parallel worker's afterAll while others
// were still running is replaced by the complete one, with flaky tests listed beside it (tests/lib/checks.js).
const fs = require('fs');
const path = require('path');
const { writeSuite } = require('./checks');

module.exports = async () => {
  const dir = process.env.FB_RESULTS || path.join(__dirname, '..', '.results');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) writeSuite(dir, f.slice(0, -6));
};
