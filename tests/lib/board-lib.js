// The board's pure ES module library (custom_components/functions_board/frontend/lib/), loaded directly in Node.
// Every exported function, class and constant is returned, so tests continue using:
//   const { analyze, findProblems } = require('./lib/board-lib');
const fs = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', 'custom_components', 'functions_board', 'frontend');
const lib = require(path.join(FRONT, 'lib', 'index.js'));

function readFrontendTree(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...readFrontendTree(p));
    else if (ent.name.endsWith('.js')) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out.join('\n');
}

const exported = Object.assign({}, lib);
Object.defineProperty(exported, '__names', { value: Object.keys(lib), enumerable: false });
Object.defineProperty(exported, '__source', { get: () => readFrontendTree(FRONT), enumerable: false });
module.exports = exported;
