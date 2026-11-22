// Options for the Z-Wave JS server the test Home Assistant connects to (tests/home/start.sh): its cache and log in
// $FB_HOME_DIR/zwave. The network keys are made once per test home and kept there (keys.json); the mock controller
// includes nothing securely, so they only have to exist.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = path.join(process.env.FB_HOME_DIR || path.join(__dirname, '../../ha/home'), 'zwave');
fs.mkdirSync(dir, { recursive: true });
const keysFile = path.join(dir, 'keys.json');
if (!fs.existsSync(keysFile)) {
  const k = () => crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(keysFile, JSON.stringify({ S0_Legacy: k(), S2_Unauthenticated: k(), S2_Authenticated: k(), S2_AccessControl: k() }));
}
module.exports = {
  securityKeys: JSON.parse(fs.readFileSync(keysFile, 'utf8')),
  storage: { cacheDir: path.join(dir, 'cache'), deviceConfigPriorityDir: path.join(dir, 'config') },
  logConfig: { enabled: true, level: process.env.FB_ZWAVE_LOG || 'info', logToFile: true, filename: path.join(dir, 'zwavejs_%DATE%.log'), forceConsole: false },
  // no usage statistics, no firmware update lookups: nothing leaves this machine
  enableStatistics: false,
};
