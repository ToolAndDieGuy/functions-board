// The board's library section (everything above `class FunctionsBoard`), loaded in Node without a browser.
// Every top-level function, class and constant it defines is returned, so a test names what it uses and nothing
// has to be listed here: const { analyze, findProblems } = require('./lib/board-lib');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'custom_components', 'functions_board', 'frontend', 'functions-board.js');
const src = fs.readFileSync(FILE, 'utf8');
const start = src.indexOf("'use strict';"), end = src.indexOf('  class FunctionsBoard extends HTMLElement');
if (start < 0 || end < 0) throw new Error('board-lib: could not find the library section in ' + FILE);
const body = src.slice(start, end);
const names = [...new Set([...body.matchAll(/^ {2}(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))];
// a stand-in window and custom element registry: the library itself never draws
module.exports = new Function('customElements', 'window', body + '\nreturn { ' + names.join(', ') + ' };')({ get: () => undefined }, {});
module.exports.__names = names;
module.exports.__source = src;
