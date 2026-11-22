// Node-RED for the test home (tests/home/start.sh): on 127.0.0.1:$FB_NODERED_PORT (default 11880), its files in
// $FB_HOME_DIR/nodered, with the Home Assistant nodes (node-red-contrib-home-assistant-websocket) from
// tests/home/node_modules. No login: it answers only this machine. Credentials (the Home Assistant token
// tests/e2e/hasetup.js gives it) are kept unencrypted in its folder, which is the test home's own.
const path = require('path');

module.exports = {
  uiHost: '127.0.0.1',
  uiPort: Number(process.env.FB_NODERED_PORT || 11880),
  userDir: path.join(process.env.FB_HOME_DIR || path.join(__dirname, '../../ha/home'), 'nodered'),
  flowFile: 'flows.json',
  credentialSecret: false,
  flowFilePretty: true,
  editorTheme: { tours: false, projects: { enabled: false } },
  telemetry: { enabled: false },
  diagnostics: { enabled: false },
  externalModules: { autoInstall: false, palette: { allowInstall: false }, modules: { allowInstall: false } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
  functionGlobalContext: {},
};
