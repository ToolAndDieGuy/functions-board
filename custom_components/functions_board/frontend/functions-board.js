/*!
 * Functions board v0.16.0 for Home Assistant
 *
 * One page per "function": every automation, script, helper and device that makes one job work,
 * grouped by a Home Assistant label and wired together from their own configs.
 *
 * - A function IS a label. Everything carrying it is part of the function and still lives in its
 *   usual place (Automations, Scripts, Helpers...). Removing this board loses only the layout.
 * - Arrows come from reading each automation/script config: what triggers it, what it checks,
 *   what it changes, which scripts it runs.
 * - Runs as the sidebar page of the Functions Board integration (layouts shared between admins),
 *   or as a card on any dashboard (best in a panel view; layouts stored per user).
 */
import { VERSION, STR, T, setLang, morph } from './lib/index.js';
import { FunctionsBoard } from './board-core.js';
import { mixParts } from './ui/mix.js';
import { listPart } from './ui/list.js';
import { functionsPart } from './ui/functions.js';
import { managerPart } from './ui/manager.js';
import { problemsPart } from './ui/problems.js';
import { toolsPart } from './ui/tools.js';
import { debugPart } from './ui/debug.js';
import { arrowsPart } from './ui/arrows.js';
import { sandboxPart } from './ui/sandbox.js';
import { buildersPart } from './ui/builders.js';
import { studioPart } from './ui/studio.js';
import { versionsPart } from './ui/versions.js';
import { noderedPart } from './ui/nodered.js';
import { diagnosticsPart } from './ui/diagnostics.js';

const loaded = customElements.get('functions-board');
if (loaded && !loaded.__fbLoader) {
  if (loaded.VERSION !== VERSION) {
    console.warn(`Functions board: v${loaded.VERSION || '0.2 or older'} is already loaded on this page, so v${VERSION} was skipped. `
      + 'Remove the old dashboard resource (Settings > Dashboards > Resources) and reload the page.');
  }
} else {
  mixParts(FunctionsBoard, [
    ['list', listPart],
    ['functions', functionsPart],
    ['manager', managerPart],
    ['problems', problemsPart],
    ['tools', toolsPart],
    ['debug', debugPart],
    ['arrows', arrowsPart],
    ['sandbox', sandboxPart],
    ['builders', buildersPart],
    ['studio', studioPart],
    ['versions', versionsPart],
    ['nodered', noderedPart],
    ['diagnostics', diagnosticsPart],
  ]);
  FunctionsBoard.VERSION = VERSION;
  // (for the drawing test, tests/board/draw.test.js)
  FunctionsBoard.morph = morph;
  // the words, so a translation can be tried from the browser console: add a table, e.g.
  // customElements.get('functions-board').STR.de = { ... }, and the page switches at its next update
  FunctionsBoard.STR = STR;
  if (!customElements.get('functions-board')) {
    customElements.define('functions-board', FunctionsBoard);
  } else if (customElements.get('functions-board').__fbLoader) {
    if (!customElements.get('functions-board-app')) customElements.define('functions-board-app', FunctionsBoard);
    customElements.get('functions-board').__fbReady(FunctionsBoard);
  }
  // the card picker can list the card before any board has seen hass: take the language from the page
  try { setLang(document.querySelector('home-assistant').hass.language); } catch (e) { /* stays English */ }
  window.customCards = window.customCards || [];
  const existingCardIdx = window.customCards.findIndex((c) => c && c.type === 'functions-board');
  if (existingCardIdx >= 0) window.customCards.splice(existingCardIdx, 1);
  window.customCards.push({
    type: 'functions-board',
    get name() { return T('functions_board'); },
    get description() { return T('whiteboard_of_the_automations_scripts'); },
  });
  console.info(`%c FUNCTIONS-BOARD %c v${VERSION} `, 'color:#fff;background:#3d4048;padding:2px 4px;border-radius:3px 0 0 3px',
    'color:#3d4048;background:#dfe1e5;padding:2px 4px;border-radius:0 3px 3px 0');
}
