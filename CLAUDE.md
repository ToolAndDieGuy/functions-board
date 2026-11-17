# Functions Board: notes for working on it

A Home Assistant custom integration that shows each "function" of a home (a label grouping automations, scripts,
helpers and devices) as a board of boxes and arrows, with tools to edit the wiring, debug runs, test, and try a
function out in a sandbox. Published through HACS. Read this before changing anything.

## Where things are

- `custom_components/functions_board/`: the integration. Python is small: `__init__.py` (panel, static path,
  optional dashboard card), `websocket.py` (admin-only commands; the board's shared store), `store.py`,
  `nodered.py` (the Node-RED flow summary kept for every board), `sources.py`, `diagnostics.py`, `config_flow.py`.
- `custom_components/functions_board/frontend/functions-board.js`: the whole board, one plain-JS web component
  (~10,000 lines, no build step, no dependencies). Top to bottom:
  - the **library section** (pure functions, testable in Node without a browser): config analysis (`analyze`,
    `condText`), layout (`layeredOnce`, `layered`), arrow routing (`arrowGeo`, `orthoAll`, `laneSpread`,
    `untangle`, `busDots`, `hopsOf`), the **sandbox engine** (`class Sandbox`, `sbxEffect`, `sbxRewrite`,
    `SBX_PRELUDE`, `SBX_ETRIG`), the English text table (`T()`, `P()` for plurals);
  - then `class FunctionsBoard extends HTMLElement`: rendering, the drawer modes (pages, debug, sandbox), the
    toolbar actions (one `switch` on `data-act` in `_onClick`), storage and sync.
- `tests/`: everything below. `scripts/`: `bump.js` (version), `gen_sandbox_triggers.py` (see Sandbox).
- `docs/images/`: the README's screenshots, taken by `tests/e2e/screens.js` from the demo setup.

## Testing (do this for every change)

Set up once: `sh tests/setup.sh all` (Home Assistant 2026.11.1 in `venv314`, configs in `ha/config` and
`ha-demo/config`, Playwright, the backend venv). Then:

```sh
sh tests/run-all.sh              # static checks, wiring, sandbox engine, backend: seconds, no Home Assistant
sh tests/start-ha.sh             # the throwaway Home Assistant on :8123 (its log: ha/hass.log)
sh tests/run-all.sh --e2e        # plus every browser suite against it
sh tests/run-all.sh --e2e layout # only the suites matching a pattern
```

| Suite | What it covers |
|---|---|
| `tests/static.test.js` | rules on the board's source: every `T('key')` has English text and every text is used (keys must be literal, not built at runtime); runtime CSS classes only in scoped rules; no ingress sessions or cookies |
| `tests/wiring.test.js` | `analyze()` on many automation and script shapes: which arrows, roles, loops |
| `tests/sandbox.test.js` | the sandbox engine with a stand-in template renderer: triggers, conditions, actions, modes, waits, MQTT, per-entity triggers, `sbxRewrite` |
| `tests/backend/` (pytest) | the Python side: setup, store, websocket commands, diagnostics |
| `tests/e2e/apitest.py` | backend over the real API; onboards the test users and writes the tokens the browser suites use |
| `tests/e2e/ui.test.js` | first run, import, migration, live sync, dashboard modes, non-admin |
| `tests/e2e/regress.test.js [filter]` | one case per fixed bug or new behaviour, named by version (`0.7.0 …`) |
| `tests/e2e/tools.test.js` | debugger, live checks, tests, arrow editor, Node-RED |
| `tests/e2e/sync.test.js` | two boards editing at once |
| `tests/e2e/sandbox.test.js` | the sandbox on the garage function, templates rendered by the real Home Assistant, nothing sent that changes anything |
| `tests/e2e/layout.test.js` | large synthetic functions in both directions: no overlap, arrows 16 px apart, none through a box, every crossing hops, rows wrap |
| `tests/e2e/size.test.js` | 1,000 automations: import and open times (slow; `--size`) |

- **Checkers** used by the suites: `tests/e2e/routecheck.js` (arrow spacing, arrows through boxes) and
  `tests/e2e/hopcheck.js` (every crossing hops). They read `board._ortho`, the router's last output.
- **Look at the result**, not only the tests: `tests/e2e/layshot.js` screenshots a function's layout;
  `FB_SHOTS=1 node tests/e2e/layout.test.js` saves the large ones; screenshots go to `tests/e2e/.state/shots/`.
- Add a regress case for each bug fixed and each behaviour added, named with the version it ships in. Make sure
  a new check can fail (break the code on purpose once).
- `tools.test.js` 9.2 is timing-sensitive and fails now and then; rerun before chasing it.
- One browser suite at a time: they share the Home Assistant and reset its board data. Tokens last 30 minutes,
  so `run-all.sh` runs `apitest.py` before each suite.

## Conventions

- **Words.** All UI text is in the `T()` table, in plain English. Keys are written out literally in calls (the
  static test checks). Plurals go through `P(key, n)` with `{ one, other }`.
- **Nothing personal in the repo**: no real names, entity names, addresses, IPs or screenshots of a real home.
  Fixtures, screenshots and the demo use the test and demo configs only (`tests/e2e/config`, `tests/e2e/demo`).
- **What the board may do to Home Assistant** is listed in the README ("What it changes") and in the About
  dialog. Writes happen only in Full manager mode, through Home Assistant's own APIs, after the person confirms.
  Never create Supervisor ingress sessions or write their cookies (the HACS review rejected that; a static test
  guards it). The sandbox only reads.
- **Versions**: `node scripts/bump.js X.Y.Z` updates the manifest, the board's `VERSION` and the CHANGELOG
  heading (it writes today's UTC date; fix it to the local date if they differ). Each release gets a CHANGELOG
  entry written for users.
- **Releases** are tagged `vX.Y.Z` on `main` and published as GitHub releases; HACS installs from them.
  Work on branches with PRs; stacked PRs merge in order.
- CI (`.github/workflows/validate.yml`) runs the HACS action, hassfest, the quick tests, the backend tests and
  the browser suites on every push.

## Design notes worth knowing

- **Layout and arrows.** `layered()` lays out each connected group (layers by longest path, barycentre ordering,
  gaps widened until the router reports no shortfall) and packs groups by area and aspect. `orthoAll()` routes
  right-angle arrows: three ports per side, shared lines beyond three (with coloured branch dots), lanes spread
  16 px apart, hops at crossings. Rules the tests hold it to: 16 px between parallel arrows, no arrow through a
  box, every crossing hops.
- **Top to bottom** (`layout.dir = 'down'`) reuses all of it on a board turned a quarter turn: boxes are laid out
  and routed with width and height swapped, then the arrows are drawn inside `<g transform="matrix(0 1 1 0 0 0)">`
  (a reflection across the diagonal). Text and marks are placed outside the group so they aren't mirrored. Wide
  rows wrap (end points move down a row, starting points up).
- **Sandbox.** `class Sandbox` runs a function's automations and scripts on a copy of the states with its own
  clock. Templates go to Home Assistant's `render_template` with `sbxRewrite()` renaming the state functions to
  `as_function` stand-ins (`SBX_PRELUDE`) that read the sandbox's states (`fb_s`) and clock (`fb_t`).
  `SBX_ETRIG` is generated from Home Assistant's own per-entity trigger classes: rerun
  `venv314/bin/python scripts/gen_sandbox_triggers.py` after moving to a newer Home Assistant.
- Debug hooks for tests: `board._ortho` (routes, owners, hops, `vert`), `board._sbx.eng` (the sandbox engine and
  its log), `window.__fbStyle` (overrides `PROTO()` layout switches).
