// Playwright's global setup, for both configs: each run starts its suites' check logs (<suite>.jsonl, which keep a
// suite's checks across Playwright's workers) empty, so a run run by hand doesn't add to the last one's.
const fs = require('fs');
const path = require('path');

module.exports = async () => {
  const dir = process.env.FB_RESULTS || path.join(__dirname, '..', '.results');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) fs.rmSync(path.join(dir, f), { force: true });
};
