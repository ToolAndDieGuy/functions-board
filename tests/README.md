# Tests

```sh
sh tests/setup.sh all        # once: Home Assistant 2026.11.1 (venv314), test and demo configs, Playwright, backend venv
sh tests/run.sh              # rules, library, Python units, and the board on the fake Home Assistant (about 2 min)
sh tests/run.sh --ha         # also everything on a fresh real test Home Assistant (results: tests/.results/)
sh tests/run.sh --ha --keep --only e2e-ui      # one suite, on the Home Assistant as it is
FB_ONLY=0.9.1 sh tests/run.sh --only board-regress   # only the regress cases whose names match
```

`npm test` and `npm run test:e2e` do the same. Requirements: `uv`, Node 22, and the system TurboJPEG library
(`libturbojpeg`) for the demo integration.

## How it is put together

The tests are layers. Each one tests what the layer below can't, and is as fast as what it tests allows.

| Layer | Where | Runs on | What it is for |
|---|---|---|---|
| 1. Rules | `static.test.js` | the source | things that must never be true of the code (missing words, outside requests, ingress cookies) |
| 2. Units | `wiring`, `problems`, `sandbox` `.test.js`; `backend/` | Node; pytest | the board's library (pure functions) and the Python side, case by case |
| 3. The board | `board/` | Chromium, a fake Home Assistant | everything the board draws and does, in parallel, in seconds per test |
| 4. Home Assistant | `e2e/` | Chromium, a real Home Assistant | what only the real thing can show: its API, its frontend, templates, isolation, privacy |
| 5. Weekly | `.github/workflows/beta.yml` | a real Home Assistant, newest beta | Home Assistant changing under us |

A check belongs in the lowest layer that can make it fail. A layout rule is a board test, not a Home Assistant
test; how `analyze()` reads one automation shape is a unit test, not a board test.

### Honest results

Every runner writes JUnit into `tests/.results/`, its screen output to `<suite>.log` and its exit code to
`<suite>.exit`. `tests/lib/report.js` decides the result from those: a failure, a missing or empty report, or a
non-zero exit fails the run, whatever the runner printed. `tests/selftest/` plants a failure of each kind (a
failing node test, a failing pytest, a failing browser check, a crash, a report that says pass with a failure in
it, an exit 1 with an all-pass report) and checks the report catches every one. If a guard in `report.js` is
broken, the self-test fails.

### Layer 3: the board on a fake Home Assistant

`tests/board/fake-ha.js` is a Home Assistant small enough to run inside the test: the page gets a `hass` object
whose calls go through one Playwright binding to the fake in Node, and the board's script is served straight from
`custom_components/`. There is no Home Assistant frontend, so a test opens in under a second and tests run in
parallel (`tests/board.config.js`, one worker per CPU).

- Its data is `tests/board/garage.json`, recorded from a fresh real test Home Assistant by
  `node tests/board/capture.js` (states, registries, services, automations and scripts, trigger and condition
  platforms, the theme's colours in dark and light). Re-record it after changing `tests/e2e/config` or moving to a
  newer Home Assistant; the capture refuses anything that looks personal.
- It answers what the board asks: the registries, configs, traces, the `functions_board/*` commands (mirroring
  `websocket.py`, revision conflicts included), helpers, services, the config entry's options flow.
  `fake.calls` lists every call; anything it doesn't know goes in `fake.unknown` and fails the test.
- `fake.push()`, `fake.emit()`, `fake.setState()` and `fake.notifyStore()` change things under the board as Home
  Assistant would; `fake.idle()` waits until the board has gone quiet.
- `tests/board/helpers.js` has the same API as `tests/e2e/lib.js` (`session`, `importAll`, `openFn`, `suite`,
  `done`), so a suite moves between layers by changing one `require`.
- **The contract** (`tests/e2e/contract.test.js`, in layer 4) keeps the fake honest: it asks the real Home
  Assistant and the fake the same read commands and compares the shape of the answers, makes the same changes on
  both (labels, entities, the store with a stale revision, versions, automations) and compares again, and checks
  the snapshot still matches the test config. When it fails, fix the fake or re-record the snapshot.

| Suite | What it covers |
|---|---|
| `board/smoke.test.js` | the board starts, imports and draws the garage |
| `board/a11y.test.js` | axe-core (WCAG 2.2 AA) on every view in dark and light, the keyboard, spoken names, less motion |
| `board/layout.test.js` | large synthetic functions in both directions: no overlap, arrow spacing, no arrow through a box, hops, wrapping |
| `board/regress.test.js` | the regress cases that need only the board (named by version, like `e2e/regress.test.js`) |

### Layer 4: a real Home Assistant

`--ha` rebuilds `ha/config` from `tests/e2e/config` and starts Home Assistant new (`tests/start-ha.sh`, its log
`ha/hass.log`), as CI does; `tests/e2e/hasetup.js` onboards it and logs in the test users. The suites run on
Playwright Test (`tests/playwright.config.js`), one at a time on one worker, because they share the Home
Assistant. `tests/e2e/fixtures.js` takes a snapshot of everything a test may change before each test and puts it
back afterwards, even when the test fails (`snapshot()` and `restore()` in `tests/e2e/ha-api.js`;
`isolation.test.js` plants a failing test half way through a change and proves nothing is left). So no test may
count on what an earlier one left. Setup details, screenshots and the size test are in `tests/e2e/README.md`.

### Failures

A failed browser test keeps the traces of its browser contexts: `npx playwright show-report tests/.results/html-<suite>`
(real Home Assistant) or `tests/.results/htmlb-<suite>` (the fake). Every check prints its detail in `<suite>.log`.

## Adding a test

- One regress case per bug fixed and per behaviour added, named with the version it ships in (`0.9.1 …`), in
  `board/regress.test.js` if the fake can show it, else in `e2e/regress.test.js`.
- Make sure a new check can fail: break the code on purpose once and watch it go red.
- If the board starts asking Home Assistant something new, teach the fake (the test fails with the call in
  `fake.unknown` until you do) and add it to the contract.
- A new websocket message type also goes on the list in `static.test.js`.
