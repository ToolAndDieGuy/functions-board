# Functions Board: notes for working on it

A Home Assistant custom integration that shows each "function" of a home (a label grouping automations, scripts,
helpers and devices) as a board of boxes and arrows, with tools to edit the wiring, debug runs, test, and try a
function out in a sandbox. Published through HACS. Read this before changing anything.

## Where things are

- `custom_components/functions_board/`: the integration. Python is small: `__init__.py` (panel, static path,
  optional dashboard card), `websocket.py` (admin-only commands; the board's shared store), `store.py`,
  `nodered.py` (the Node-RED flow summary kept for every board), `versions.py` (saved versions of functions: kept
  only; the board makes and restores them), `sources.py`, `diagnostics.py` (the diagnostics file and its
  anonymiser; also the `functions_board/diagnostics` command's), `config_flow.py`.
- `custom_components/functions_board/frontend/functions-board.js`: the whole board, one plain-JS web component
  (~10,000 lines, no build step, no dependencies). Top to bottom:
  - the **library section** (pure functions, testable in Node without a browser): config analysis (`analyze`,
    `condText`), layout (`layeredOnce`, `layered`), arrow routing (`arrowGeo`, `orthoAll`, `laneSpread`,
    `untangle`, `busDots`, `hopsOf`), the **sandbox engine** (`class Sandbox`, `sbxEffect`, `sbxRewrite`,
    `SBX_PRELUDE`, `SBX_ETRIG`), the English text table (`T()`, `P()` for plurals);
  - then `class FunctionsBoard extends HTMLElement`: rendering, the drawer modes (pages, debug, sandbox), the
    toolbar actions (one `switch` on `data-act` in `_onClick`), storage and sync.
- `tests/`: everything below. `scripts/`: `bump.js` (version), `gen_sandbox_triggers.py` (see Sandbox),
  `demo_requirements.py` (what `setup.sh` installs before Home Assistant first starts).
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
| `tests/problems.test.js` | `findProblems()`: missing, not-loaded, disabled and unavailable entities, devices, areas, actions that don't exist, the function's own pieces |
| `tests/sandbox.test.js` | the sandbox engine with a stand-in template renderer: triggers, conditions, actions, modes, waits, MQTT, per-entity triggers, `sbxRewrite` |
| `tests/backend/` (pytest) | the Python side: setup, store, websocket commands, diagnostics; `test_privacy.py`: canary data through the anonymiser and the log, no network modules, the manifest (sockets are blocked in all of it) |
| `tests/e2e/apitest.py` | backend over the real API; onboards the test users and writes the tokens the browser suites use |
| `tests/e2e/ui.test.js` | first run, import, migration, live sync, dashboard modes, non-admin |
| `tests/e2e/regress.test.js [filter]` | one case per fixed bug or new behaviour, named by version (`0.7.0 …`) |
| `tests/e2e/tools.test.js` | debugger, live checks, tests, arrow editor, Node-RED |
| `tests/e2e/sync.test.js` | two boards editing at once |
| `tests/e2e/sandbox.test.js` | the sandbox on the garage function, templates rendered by the real Home Assistant, nothing sent that changes anything |
| `tests/e2e/versions.test.js` | versions on the garage: save, compare in a tab, sandbox a version, restore (off/delete what was added since), replaced devices |
| `tests/e2e/privacy.test.js` | a tour of everything: every request the board starts goes to this Home Assistant; no connection from the integration (`ha/netguard.log`); its data only in its own `.storage` files; nothing without an admin login; the Diagnostics dialog's forced choice and its files |
| `tests/e2e/a11y.test.js` | axe-core (WCAG 2.2 AA) on every view in dark and light mode, with a problem on the board; the keyboard (roving box focus, arrows, Space, Enter, Escape, dialog and drawer focus in and back); spoken names; less motion |
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
- **Accessibility** (`a11y.test.js`, axe-core is a pinned devDependency): text in a status colour uses its `-ink`
  variable (`--fb-red-ink`, `--fb-amber-ink`, `--fb-blue-ink`, `--fb-primary-ink`: darker in light mode); white
  text sits on a fill darkened with `color-mix(… 70%, #000)`; don't fade text with `opacity` (fade borders, icons
  and backgrounds instead). Words only for screen readers go in a `.srt` span. Motion goes through `lessMotion()`
  or the `prefers-reduced-motion` rule.
- **Privacy rules** the tests hold (README "Privacy"): the board reaches nothing but this Home Assistant (one
  `fetch`, Node-RED's, guarded by `SAME_ORIGIN`; no other network APIs or outside assets; the project page only as
  a plain link); every websocket message type is on the list in `tests/static.test.js` (add a new one there on
  purpose); the Python imports no network module. Diagnostics are anonymised or not as the person chooses, every
  time; Home Assistant's own download is always anonymised. A new field that holds someone's words should be under
  a key in `FREE_TEXT_KEYS` or `NAME_KEYS` in `diagnostics.py`, and get a marker in `test_privacy.py`.
- **netguard** (`tests/netguard/sitecustomize.py`, test-only): `start-ha.sh` starts Home Assistant with it on
  `PYTHONPATH`; it logs every outgoing connection and lookup, with the stack and whoever submitted the worker job,
  to `ha/netguard.log`. It changes nothing and never ships.
- **Versions**: `node scripts/bump.js X.Y.Z` updates the manifest, the board's `VERSION` and the CHANGELOG
  heading (it writes today's UTC date; fix it to the local date if they differ). Each release gets a CHANGELOG
  entry written for users. Changes not yet given a version go under `## Unreleased` at the top of the CHANGELOG;
  `bump.js` turns that into the version's entry.
- **Releases are automatic** (`.github/workflows/release.yml`): when a push to `main` passes Validate and the
  manifest's version has no tag yet, it tags `vX.Y.Z` and publishes the GitHub release HACS installs from, with
  that version's CHANGELOG section as the notes. So bump the version only when you mean to release, and in a
  stack of PRs bump only in the last one (the others write under `## Unreleased`). It releases only the tip of
  `main`, so quick merges in a row release once.
  Work on branches with PRs; stacked PRs merge in order.
- CI (`.github/workflows/validate.yml`) runs the HACS action, hassfest, the quick tests, the backend tests and
  the browser suites on every push. `.github/workflows/beta.yml` runs weekly against Home Assistant's newest
  release, betas included (`FB_HA=beta sh tests/setup.sh` does the same locally), checks the sandbox has every
  per-entity trigger it has (`gen_sandbox_triggers.py --check`; integrations it can't import keep their entries), and opens an issue labelled `ha-beta` when anything fails.
- **Issues** use the forms in `.github/ISSUE_TEMPLATE` (they ask for versions and an anonymised diagnostics file).

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
- **Problems** (`findProblems()` in the library section, 0.9.0): from `analyze()`'s refs and the registries;
  `_buildModel` marks boxes (`n.prob`) and arrows (`e.prob`) and keeps `model.problems`; `_scanProblems()` counts
  every function for the list in the background (configs come from the cache), the open one from its model.
  Dismissed ones (`layout.dismissed`, `splitDismissed()`, keyed `kind|ref` by `probKey()`) are left out of
  `model.problems` (kept in `model.dismissed`) before `markProblems()` marks the board; a dismissal notes `gone`
  when its problem isn't there and is dropped a day later. A version tab shows every problem.
- **Saved checks** (0.9.0): `cleanCheck()` and `runCheck()` in the library section; a check is kept in the
  layout (`layout.checks`) with its starting states, clock, the automations and scripts that took part (`items`,
  related ones included), steps, answers and expectations. The open sandbox records into `_sbx.rec`; `_runChecks()`
  replays them on the current configs (results per config generation, `_cfgGen`), and failing ones join the
  problems (`c_failed`, `c_unsure`). The engine passes itself to `tpl(template, vars, engine)`, so templates read
  the states of the engine that asked.
- Debug hooks for tests: `board._ortho` (routes, owners, hops, `vert`), `board._sbx.eng` (the sandbox engine and
  its log), `window.__fbStyle` (overrides `PROTO()` layout switches).
