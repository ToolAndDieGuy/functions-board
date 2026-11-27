# Audit & Fix Handoff (`fix/v0.13.2-audit`)

This folder documents the full audit triage, bug fixes, test apparatus hardening, and remaining roadmap completed on branch `fix/v0.13.2-audit` (branched from `main` at `1797f688` / `v0.13.1`).

> **Release status:** `manifest.json`, `VERSION`, and `README.md` intentionally remain at `0.13.1`. Changes are summarized under `## Unreleased` in `CHANGELOG.md` so local Home Assistant testing and CI verification complete before any version bump or GitHub release.

---

## Contents

1. [`issue-72-triage.md`](./issue-72-triage.md) — Root-cause analysis and fixes for all three failing weekly CI jobs in Issue #72 (`mutants`, `jitter`, `diff`) plus the `actions/upload-artifact@v4` dot-directory fix.
2. [`phase-1-audit-fixes.md`](./phase-1-audit-fixes.md) — Complete itemized breakdown of all Phase 1 (Batches 1A, 1B, 1C) bug fixes, affected files, regression tests, static invariants, and mutants.
3. [`phase-2-hardening.md`](./phase-2-hardening.md) — Phase 2 backend hardening & Frenck's version restore domain allowlist (allowlist, diagnostics executor offload & case-insensitive/structural redaction, split version metadata/blobs, decoupled saved checks store, lazy dashboard card loader).
4. [`roadmap-next-phases.md`](./roadmap-next-phases.md) — Remaining roadmap for Phase 3 (native zero-build ES module split), Phase 4 (Recipes & features), and Issue #73 (`readme-pictures`).

---

## Files Modified on This Branch

- **Frontend:** `custom_components/functions_board/frontend/functions-board.js`, `custom_components/functions_board/frontend/card-loader.js` (new)
- **Backend:** `custom_components/functions_board/__init__.py`, `const.py`, `checks.py` (new), `diagnostics.py`, `sources.py`, `versions.py`, `websocket.py`, `zwave.py`
- **CI & Docs:** `.github/workflows/validate.yml`, `.github/workflows/weekly.yml`, `CHANGELOG.md`, `CLAUDE.md`, `docs/handoff/*`
- **Test Suites & Mutants:**
  - `tests/static.test.js` (`CHECK_OPS` <-> `_chkStepText` rule, `WS_OK` for checks commands, `card-loader.js` security/size checks)
  - `tests/sandbox.test.js`, `tests/wiring.test.js`, `tests/problems.test.js`, `tests/builder.test.js`
  - `tests/board/fake-ha.js`, `tests/board/regress.test.js` (new `0.13.2` + `0.13.3` Phase 2 tests & jitter stabilization)
  - `tests/e2e/contract.test.js`, `tests/e2e/ha-api.js`, `tests/e2e/regress.test.js`
  - `tests/diff/corpus.js`, `tests/diff/random.js`
  - `tests/backend/test_zwave_values.py`, `tests/backend/test_websocket.py`, `tests/backend/test_mqtt_sources.py`, `tests/backend/test_privacy.py`, `tests/backend/test_setup.py`
  - `tests/mutants.json` (fixed 1 stale expectation, updated 1 check-edit anchor, added 16 new mutants -> 318 total)

---

## Verification Matrix

| Suite / Check | Status | Notes |
|---|---|---|
| `node --check functions-board.js` | **PASS** | Syntax clean |
| All 9 Node suites (`static`, `wiring`, `import`, `problems`, `sandbox`, `builder`, `clock`, `link`, `store`) | **PASS (618/618)** | Includes all 313 mutant single-match checks and new `CHECK_OPS` static rule |
| All 7 Playwright fake-HA board suites (`smoke`, `a11y`, `layout`, `regress`, `snapshots`, `leak`, `draw`) | **PASS (67/67 tests)** | `board-regress` 377/377, `board-a11y` 26/26, `board-leak` 9/9, `board-snapshots` 47/47 (0 unintended diffs) |
| Jitter (`FB_JITTER=45672517445 FB_RETRIES=0`) on `board-regress` | **PASS (54/54 tests)** | Both Issue #72 failing `0.13.0` tests + `0.11.3` Undo toast race fixed |
| Differential JS sandbox (`tests/diff/sandbox.js --random 50 --seed 45672517445`) | **PASS (161 scenarios)** | Zero errors; `random.js` disjoint helper writes eliminate concurrent write races |
| Mutants (2 previously missed Issue #72 + 9 JS/board `0.13.2` mutants) | **PASS (11/11 caught)** | Every fixed and newly added JS/board mutant proven caught |
| Python `backend` (`pytest tests/backend`) | **Pending CI** | Run via GitHub Actions on PR (`zwave.py`, `versions.py`, `sources.py`, `websocket.py` + 2 backend mutants) |
| Real-HA `diff` & `e2e-*` | **Pending CI** | Run via GitHub Actions on PR (`sh tests/run.sh --ha`) |

---

## Quick Verification Commands (for Opus / CI)

```sh
# Fast local verification (Node + fake-HA Playwright)
sh tests/run.sh

# Jitter verification (Issue #72 seed)
FB_JITTER=45672517445 FB_RETRIES=0 sh tests/run.sh --only '^board-regress$'

# Full suite including Python backend, real-HA diff, and E2E
sh tests/run.sh --ha

# Mutants (including the 2 backend mutants added in 0.13.2)
node tests/mutants.js "no Save on the active|choice is ignored|_chkStepText|sbxRewrite|_watchDrawer|MQTT cover|missing targetless|target\.exclude|script\.toggle|_sbxOn|multi-endpoint|deleting last version"
```
