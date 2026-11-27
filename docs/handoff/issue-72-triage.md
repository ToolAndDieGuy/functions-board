# Issue #72 Triage & Fixes (Weekly CI Run `45672517445`)

Weekly workflow run `45672517445` (baseline `v0.13.1`, commit `1797f688`) failed three jobs: **mutants**, **jitter**, and **diff**. While inspecting the job logs, a fourth CI-harness issue with artifact uploads was also identified and fixed.

---

## 1. Mutants (`job/139411293810` — 300/302 caught, 2 missed)

### 1a. `versions: no Save on the active version's row`
- **Symptom:** The mutant broke the `Save` button on the active version row, and the `board-regress` test *did* fail — on check `0.11.3 ... with Save and Save as copy on it` — but `tests/mutants.json` matched `expect: "only the layout changed"`, which was the wrong check title.
- **Fix (`tests/mutants.json`):** Updated `expect` to `"with Save and Save as copy on it"`.

### 1b. `sandbox: a device trigger's choice is ignored when pressed`
- **Symptom:** In `v0.13.0`, `sbxDevZwave(t)` was added to route Z-Wave scene device triggers through `zwave_js_value_notification` instead of `sbxPressHits()`. The existing choice test in `tests/sandbox.test.js` used a `zwave_js` device trigger, so mutating `sbxPressHits()` no longer affected it.
- **Fix (`tests/sandbox.test.js`):** Added a regression test using a generic non-Z-Wave/non-MQTT device trigger (`domain: 'hue'`, `type: 'remote_button_short_press'`, with `subtype` choices) so `sbxPressHits()` choice matching is directly exercised and catches the mutant.

---

## 2. Jitter (`job/139411293403` — `board-regress`, `FB_JITTER=45672517445`)

- **Symptom:** Both `0.13.0 the Press row` and `0.13.0 the Z-Wave row` threw uncaught browser errors:
  `pageerror: Cannot read properties of undefined (reading 'pending')`.
- **Root cause:** In `FunctionsBoard._sbxNew()`, `this._sbx = g` was assigned *before* awaiting asynchronous setup calls (`_followRules`, `_devTrigs`, `_zwFor`) and *before* `g.eng = new Sandbox(g.opts)`. Under delayed/reordered WebSocket jitter, incoming HA state/event updates called `_sbxOn()` (which only checked `this._sbx && this._drawer?.mode === 'sandbox'`) and triggered `_renderSbx()` / `_paintFlow()`, dereferencing `g.eng.pending()` while `g.eng` was still `undefined`.
- **Fix (`custom_components/functions_board/frontend/functions-board.js`):**
  1. `_sbxOn()` now requires `this._sbx && this._sbx.eng && this._drawer && this._drawer.mode === 'sandbox'`.
  2. `_sbxNew()` constructs `g.eng` before assigning `this._sbx = g`, and bails out cleanly if the sandbox drawer was closed or replaced while awaiting async setup.
  3. `_sbxEnd()` guards `if (g.eng)` before tearing down engine timers/listeners.
- **Regression tests & mutants:**
  - `tests/board/regress.test.js` (`0.13.2 _sbxOn is false until sandbox engine is initialized`).
  - `tests/mutants.json` (`sandbox: _sbxOn ignores whether eng is initialized`).
  - Re-tested full `board-regress` under `FB_JITTER=45672517445 FB_RETRIES=0`.

---

## 3. Differential Suite (`job/139411292912` — `test_scenario[random_45672517445-389]`)

- **Symptom:** Generated scenario `make(1000, 45672517445)[388]` diverged between Home Assistant Core and the JS sandbox on `input_boolean.z` at steps 1 and 5.
- **Root cause:** `tests/diff/random.js` assigned each automation `i` a shared suffix `HELP.slice(from)` where `HELP = ['x', 'y', 'z']`, so multiple automations could simultaneously target `input_boolean.z` on the same event with opposing actions (`automation.a` calling `turn_on z` while `automation.c` called `turn_off z`). In HA Core's async event loop, concurrent task completion order for conflicting writes to the same entity is non-deterministic, whereas the JS sandbox runs deterministically in array order.
- **Fix (`tests/diff/random.js`):** Assigned each automation `i` its own disjoint helper `[HELP[i]]` (`a -> x`, `b -> y`, `c -> z`) for its writes. Automations still chain across helpers (`a -> b -> c`), read each other's helpers in triggers/conditions, and share `counter.c` (commutative increments), eliminating write-write interleaving races without reducing state-machine coverage.

---

## 4. Bonus CI Harness Fix: Dot-Directory Artifact Uploads

- **Symptom:** Across both `validate.yml` and `weekly.yml`, `actions/upload-artifact@v4` warned `No files were found with the provided path: tests/.results/...` and `tests/e2e/.state/shots/`.
- **Root cause:** `actions/upload-artifact@v4` ignores hidden (dot-prefixed) directories by default unless `include-hidden-files: true` is specified.
- **Fix (`.github/workflows/validate.yml`, `.github/workflows/weekly.yml`):** Added `include-hidden-files: true` to all artifact upload steps referencing `.results` or `.state`.
