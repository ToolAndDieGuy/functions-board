#!/usr/bin/env node
// Set the version everywhere it is written: node scripts/bump.js 0.4.0
// Board file (VERSION and header comment), manifest.json, README, and a new CHANGELOG.md heading.
const fs = require('fs');
const path = require('path');

const ver = process.argv[2];
if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.]+)?$/.test(ver || '')) { console.error('usage: node scripts/bump.js <version>'); process.exit(2); }
const root = path.join(__dirname, '..');
const edit = (rel, fn) => {
  const p = path.join(root, rel), before = fs.readFileSync(p, 'utf8'), after = fn(before);
  if (after !== before) { fs.writeFileSync(p, after); console.log('updated ' + rel); }
};
edit('custom_components/functions_board/frontend/lib/i18n.js', (s) => s
  .replace(/export const VERSION = '[^']+'/, `export const VERSION = '${ver}'`));
edit('custom_components/functions_board/frontend/functions-board.js', (s) => s
  .replace(/Functions board v[0-9][^ ]*(?: \(prototype\))?/, `Functions board v${ver}`));
edit('custom_components/functions_board/manifest.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${ver}"`));
edit('README.md', (s) => s
  .replace(/functions-board\.js\?v=[0-9][^`)\s]*/g, `functions-board.js?v=${ver}`)
  .replace(/This is an early release \(v[^)]+\)/, `This is an early release (v${ver})`));
const cl = path.join(root, 'CHANGELOG.md');
const head = `## ${ver} (${new Date().toISOString().slice(0, 10)})\n\n`;
let log = fs.existsSync(cl) ? fs.readFileSync(cl, 'utf8') : '# Changelog\n\n';
if (!log.includes(`## ${ver} `)) {
  // what earlier PRs of a stack wrote under "## Unreleased" becomes this version's entry
  if (/^## Unreleased\n/m.test(log)) log = log.replace(/^## Unreleased\n\n?/m, head);
  else log = log.replace(/^# Changelog\n\n/, '# Changelog\n\n' + head);
  fs.writeFileSync(cl, log);
  console.log('added CHANGELOG.md heading ' + ver);
}
