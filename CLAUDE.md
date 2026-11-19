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
  - the **library section** (pure functions, testable in Node without a browser): the clock (`class Clock`), the link
    to Home Assistant (`class Link`), the store (`class Store`), config analysis (`analyze`,
    `condText`), layout (`layeredOnce`, `layered`), arrow routing (`arrowGeo`, `orthoAll`, `laneSpread`,
    `untangle`, `busDots`, `hopsOf`), the **sandbox engine** (`class Sandbox`, `sbxEffect`, `sbxRewrite`,
    `SBX_PRELUDE`, `SBX_ETRIG`), the English text table (`T()`, `P()` for plurals);
  - then `class FunctionsBoard extends HTMLElement`: rendering, the drawer modes (pages, debug, sandbox), the
    toolbar actions (one `switch` on `data-act` in `_onClick`), storage and sync.
- `tests/`: everything below. `scripts/`: `bump.js` (version), `gen_sandbox_triggers.py` (see Sandbox),
  `demo_requirements.py` (what `setup.sh` installs before Home Assistant first starts).
- `docs/images/`: the README's screenshots, taken by `tests/e2e/screens.js` on a fresh test Home Assistant
  in CI (weekly, or by hand: Actions → Weekly → pictures). When they change, the job pushes the new ones to the
  branch `readme-pictures` to take by pull request; don't commit pictures taken locally (fonts differ by machine).

## Testing (do this for every change)

Set up once: `sh tests/setup.sh all` (Home Assistant 2026.11.1 in `venv314`, configs in `ha/config` and
`ha-demo/config`, Playwright, the backend venv). Then:

```sh
sh tests/run.sh                  # rules, library, Python units, the board on the fake Home Assistant (~2 min)
sh tests/run.sh --ha             # plus the API test and every real-HA suite, on a fresh test Home Assistant
sh tests/run.sh --ha --keep --only e2e-ui   # the one running as it is; only the suites matching a pattern
FB_ONLY=0.9.1 sh tests/run.sh --only board-regress   # only the regress cases whose names match
```

`--ha` rebuilds `ha/config` from `tests/e2e/config` and starts Home Assistant new (`tests/start-ha.sh`, its log
`ha/hass.log`), as CI does; `tests/e2e/hasetup.js` then onboards it and logs in the test users (setup, not a test).

The tests are layers (`tests/README.md` explains the whole design): rules on the source; the library and the
Python units; **the board on a fake Home Assistant** (`tests/board/`, Playwright Test in parallel,
`tests/board.config.js`); the real Home Assistant (`tests/e2e/`); the weekly runs (beta, mutants, strict). Put a check in the lowest
layer that can make it fail.

The fake (`tests/board/fake-ha.js`) answers the board's calls from `tests/board/garage.json`, recorded from a
fresh test Home Assistant by `node tests/board/capture.js` (re-record after changing `tests/e2e/config` or moving
Home Assistant); a call it doesn't know fails the test (`fake.unknown`), so teach it anything new the board asks.
`FB_JITTER=<seed>` makes it answer late and out of turn (events before or after their answers; the weekly jitter
job runs every board suite so).
`tests/e2e/contract.test.js` compares the fake's answers with the real Home Assistant's, so the fake can't drift.
`tests/board/helpers.js` has the same API as `tests/e2e/lib.js`.

The real-HA suites run on Playwright Test (`tests/playwright.config.js`, one suite at a time, one worker), with
`tests/e2e/fixtures.js`: each test starts from a snapshot of what tests may change in Home Assistant and is put back
to it afterwards, even when it fails (`snapshot()` and `restore()` in `tests/e2e/ha-api.js`; proven by
`isolation.test.js`), so no test may count on what an earlier one left. A failed test keeps the traces of its
browser contexts: `npx playwright show-report tests/.results/html-<suite>` (`htmlb-<suite>` for the board layer).

Every runner writes JUnit into `tests/.results/` (and its screen output to `<suite>.log` there), and the run's
result comes from those reports (`tests/lib/report.js`): a failure, a missing or empty report, or a non-zero exit
fails it. `tests/selftest/` plants a failure in each runner and checks the report catches it. Node tests use
`node:test` through `check()` in `tests/lib/check.js`; the library comes from `tests/lib/board-lib.js`, which
returns everything the library section defines.

| Suite | What it covers |
|---|---|
| `tests/static.test.js` | rules on the board's source: every `T('key')` has English text and every text is used (keys must be literal, not built at runtime); runtime CSS classes only in scoped rules; no ingress sessions or cookies |
| `tests/wiring.test.js` | `analyze()` on many automation and script shapes: which arrows, roles, loops |
| `tests/problems.test.js` | `findProblems()`: missing, not-loaded, disabled and unavailable entities, devices, areas, actions that don't exist, the function's own pieces |
| `tests/sandbox.test.js` | the sandbox engine with a stand-in template renderer: triggers, conditions, actions, modes, waits, MQTT, per-entity triggers, `sbxRewrite` |
| `tests/clock.test.js` | `class Clock` on a pretend clock: `after` (the last call wins), `once` (the first wins), `every`, `frame`, `deadline`, `sleep`, `pause`, and `stop()` leaving nothing set |
| `tests/link.test.js` | `class Link` against a pretend Home Assistant: the newest answer wins, time limits, failures reported unless optional, lists in a fixed order, what the Diagnostics file carries |
| `tests/store.test.js` | `class Store` on a pretend clock: an older answer never replaces a newer one, questions in flight shared, a change makes a fact stale, as of now, how old a fact may be, the rule for deleting |
| `tests/backend/` (pytest) | the Python side: setup, store, websocket commands, diagnostics; `test_privacy.py`: canary data through the anonymiser and the log, no network modules, the manifest (sockets are blocked in all of it) |
| `tests/board/smoke.test.js` | the board starts, imports and draws the garage, on the fake |
| `tests/board/a11y.test.js` | axe-core (WCAG 2.2 AA) on every view in dark and light mode, with a problem on the board; the keyboard (roving box focus, arrows, Space, Enter, Escape, dialog and drawer focus in and back); spoken names; less motion |
| `tests/board/layout.test.js` | large synthetic functions in both directions: no overlap, arrows 16 px apart, none through a box, every crossing hops, rows wrap |
| `tests/board/regress.test.js [FB_ONLY]` | the regress cases the fake can show, named by version |
| `tests/board/snapshots.test.js` | every view's shadow DOM as text against `tests/board/snapshots/` (from 0.9.1): what the rebuild must keep; `FB_SNAP_UPDATE=1` records a change on purpose |
| `tests/board/leak.test.js` | the board taken off and put back 50 times: nothing left subscribed, running or listening, every board let go |
| `tests/e2e/apitest.py` | backend over the real API (setup, websocket commands, store, non-admin, config flow) |
| `tests/e2e/isolation.test.js` | a test that changes Home Assistant and fails half way leaves nothing behind for the next |
| `tests/e2e/contract.test.js` | the fake answers as the real Home Assistant does (read commands, changes, the snapshot) |
| `tests/e2e/ui.test.js` | first run, import, migration, live sync, dashboard modes, non-admin |
| `tests/e2e/regress.test.js [FB_ONLY]` | the regress cases that need the real Home Assistant, named by version (`0.7.0 …`) |
| `tests/e2e/tools.test.js` | debugger, live checks, tests, arrow editor, Node-RED |
| `tests/e2e/sync.test.js` | two boards editing at once |
| `tests/e2e/sandbox.test.js` | the sandbox on the garage function, templates rendered by the real Home Assistant, nothing sent that changes anything |
| `tests/e2e/versions.test.js` | versions on the garage: save, compare in a tab, sandbox a version, restore (off/delete what was added since), replaced devices |
| `tests/e2e/privacy.test.js` | a tour of everything: every request the board starts goes to this Home Assistant; no connection from the integration (`ha/netguard.log`); its data only in its own `.storage` files; nothing without an admin login; the Diagnostics dialog's forced choice and its files |
| `tests/e2e/size.test.js` | 1,000 automations: import and open times (slow; `--size`) |

- **Checkers** used by the suites: `tests/e2e/routecheck.js` (arrow spacing, arrows through boxes) and
  `tests/e2e/hopcheck.js` (every crossing hops). They read `board._ortho`, the router's last output.
- **Look at the result**, not only the tests: `tests/e2e/layshot.js` screenshots a function's layout;
  `FB_SHOTS=1 sh tests/run.sh --only board-layout` saves the large ones; screenshots go to `tests/e2e/.state/shots/`.
- Add a regress case for each bug fixed and each behaviour added, named with the version it ships in, in
  `tests/board/regress.test.js` if the fake can show it. Make sure a new check can fail (break the code on purpose
  once).
- `tools.test.js` 9.2 is timing-sensitive and fails now and then; CI's retry shows it as flaky. If it starts
  failing for real, quarantine it rather than letting the run go red for a reason everyone ignores.
- One real-HA suite at a time: they share the Home Assistant. The board suites run in parallel, a fake each. The backend unit tests use their own venv
  (`venvtest`): `pytest-homeassistant-custom-component` doesn't have a release for Home Assistant 2026.11 yet (its
  newest pins 2026.10.4); move them into `venv314` once it does.

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
- CI (`.github/workflows/validate.yml`) runs the layers as parallel jobs on every push (`tests/README.md`, "In
  CI"): the HACS action, hassfest, the quick tests, the backend tests, the board on the fake, and the real-HA suites
  split over two jobs (a new suite goes into one of their `--only` patterns; a static rule checks). Main requires
  them all. `.github/workflows/weekly.yml` runs weekly: against Home Assistant's newest
  release, betas included (`FB_HA=beta sh tests/setup.sh` does the same locally; it also checks the sandbox has
  every per-entity trigger it has, `gen_sandbox_triggers.py --check`, and integrations it can't import keep their
  entries; issues labelled `ha-beta`), every mutant (`node tests/mutants.js --ha`), the board suites under jitter,
  and everything with `FB_STRICT=1` (no flaky test, no check quarantined for more than 30 days; issues labelled `test-gap`).
- **Mutants** (`tests/mutants.json`, `node tests/mutants.js [--ha] [pattern]`): each entry breaks the code in one
  exact place and names the check that must catch it. When you fix a bug or add a check, add a mutant for it (the
  break you made by hand to see the check fail, written down). When code a mutant breaks changes, the mutant goes
  stale and fails: update its text.
- **Flaky and quarantined** (`tests/lib/checks.js`, `tests/quarantine.json`): CI runs a failed browser test once
  more; one that passes then is flaky, passes, and is listed in the run's summary. A check that can't be fixed at
  once can be quarantined (suite, check, why, since): it still runs and shows, but doesn't fail the run. Fix it
  within 30 days; the weekly strict run fails after that.
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
- **The clock** (0.10.0, `class Clock` in the library section, `this._clock`): every wait the board sets, by name.
  `after` replaces the wait of that name (debounce), `once` keeps it (throttle), `every` repeats, `frame` waits for
  the next frame, `deadline` is how long a call may take (run at once when the clock stops), `sleep` is a pause
  in a background task (false when the clock stops: give up), `pause` is a pause inside a write (never stopped).
  `disconnectedCallback` stops it, `connectedCallback` starts it again; no raw `setTimeout` in the board's class
  (a static rule).
- **The link** (0.10.0, `class Link` in the library section, `this._ha`): every call to Home Assistant. The board
  calls `this._ws(msg, o)`, `this._api(method, path, body, o)`, `this._svc(domain, service, data, target, o)` and
  subscribes through `this._haConn` (`subscribeMessage`/`subscribeEvents`, as Home Assistant's connection, plus `o`);
  only the link's wiring in `_init` touches `this._hass.callWS`/`callApi`/`callService`/`connection`. A read asked
  again hands every caller the newest answer; every call has a time limit (60 s); a failure is reported (`_ha.errors`,
  a console warning, `board_errors` in the Diagnostics file: anonymised, only the kind, type and code) unless
  `o.optional` says why it's expected; `o.fallback` answers instead of throwing. Label, floor, category, user and
  manifest lists come sorted; the entity, device and area registries keep Home Assistant's order (the layout follows
  it). Unsubscribing is `this._ha.drop(p)`; a task of the board's own is `_ha.soft(p, what, fallback)` (reported) or
  `_ha.quiet(p, '<why>', fallback)`. Static rules: no `.catch(() => …)` in the board's class, every `optional` and
  `quiet` gives its reason, no empty `catch` block, no property with a method's name.
- **The store** (0.10.0, `class Store` in the library section, `this._store`): what the board knows of Home Assistant,
  each fact with the time its question was asked: the registries (`'reg'`), configs (`'cfg:<entity id>'`, kept a
  minute) and the time of the shared board data (`'data'`). An older answer never replaces a newer one;
  `changed(prefix)` (a registry event, a config saved or reloaded) makes what's held stale; `asOfNow(key)` answers
  what's held only if it's fresh; `load(key)` asks now, sharing a question in flight asked late enough. The maps
  the board reads (`_labelMap`, `_entMap`, `_devMap` …) are made from the registries in one place, `_index()`, which
  also drops functions and layouts whose label is gone, but only on registries asked after the board data
  (`newer('reg', 'data')`): that rule replaced 0.9.2's check. A restore plan reads the registries asked when it's
  made (`_regNow()`). The board's own data (`this._data`) and its sync with the shared store are as they were.
- Debug hooks for tests: `board._ortho` (routes, owners, hops, `vert`), `board._sbx.eng` (the sandbox engine and
  its log), `window.__fbStyle` (overrides `PROTO()` layout switches).
