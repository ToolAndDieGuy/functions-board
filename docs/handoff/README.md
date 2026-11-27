# Audit & Fix Handoff (`fix/v0.13.2-audit`)

This folder documents the full audit triage, bug fixes, backend/security hardening, ES module architecture refactor, test apparatus updates, post-session code review fixes, and UI/UX roadmap completed on branch `fix/v0.13.2-audit` (branched from `main` at `1797f688` / `v0.13.1`).

> **Release status:** `manifest.json`, `VERSION`, and `README.md` intentionally remain at `0.13.1`. Changes are summarized under `## Unreleased` in `CHANGELOG.md` so local Home Assistant testing and CI verification complete before any version bump or GitHub release.

---

## Contents

1. [`issue-72-triage.md`](./issue-72-triage.md) — Root-cause analysis and fixes for all three failing weekly CI jobs in Issue #72 (`mutants`, `jitter`, `diff`) plus the `actions/upload-artifact@v4` dot-directory fix.
2. [`phase-1-audit-fixes.md`](./phase-1-audit-fixes.md) — Complete itemized breakdown of all Phase 1 (Batches 1A, 1B, 1C) bug fixes, current ES module locations, regression tests, static invariants, and mutants.
3. [`phase-2-hardening.md`](./phase-2-hardening.md) — Phase 2 backend hardening & Frenck's version restore domain allowlist (allowlist, diagnostics executor offload & case-insensitive/structural redaction, split version metadata/blobs, decoupled saved checks store + delete/undo/sync lifecycle, spec-compliant lazy dashboard `card-loader.js`).
4. [`phase-3-es-modules.md`](./phase-3-es-modules.md) — Phase 3 native zero-build ES module refactor (24 ES modules under `frontend/lib/` + `frontend/ui/` + `board-core.js`, disjoint atomic `/functions_board_static_v/<digest>/` cache busting, `mixParts()`, and updated static/test/mutant harness).
5. [`roadmap-next-phases.md`](./roadmap-next-phases.md) — Visual UI/UX review findings & improvement recommendations, Phase 4 roadmap (Recipes & features), and Issue #73 (`readme-pictures`).

---

## Files Modified on This Branch

- **Frontend (24 Native ES Modules):** `custom_components/functions_board/frontend/functions-board.js` (thin entrypoint), `card-loader.js`, `board-core.js`, `lib/*.js` (10 modules), `ui/*.js` (13 modules)
- **Backend:** `custom_components/functions_board/__init__.py`, `const.py`, `checks.py`, `diagnostics.py`, `sources.py`, `versions.py`, `websocket.py`, `zwave.py`
- **CI, Scripts & Docs:** `.github/workflows/validate.yml`, `.github/workflows/weekly.yml`, `scripts/bump.js`, `scripts/gen_sandbox_triggers.py`, `CHANGELOG.md`, `CLAUDE.md`, `docs/guide.md`, `docs/what-it-changes.md`, `docs/handoff/*`
- **Test Suites, Snapshots & Mutants:**
  - `tests/lib/board-lib.js` (loads `frontend/lib/index.js` directly in Node)
  - `tests/static.test.js` (walks all 24 ES modules, `PARTS` by filename, `mixParts` collision check, `CHECK_OPS` <-> `_chkStepText` rule, `WS_OK` for checks commands, `card-loader.js` size/network/admin/constructor checks, and 319/319 mutant anchor checks)
  - `tests/sandbox.test.js`, `tests/wiring.test.js`, `tests/problems.test.js`, `tests/builder.test.js`
  - `tests/board/fake-ha.js`, `tests/board/smoke.test.js` (`card-loader.js` lazy admin, preloaded admin, and non-admin isolation tests), `tests/board/regress.test.js` (`0.13.2` + `0.13.3` regression tests & jitter stabilization), `tests/board/snapshots.test.js`, `tests/board/snapshots/*.txt` (updated for `· prototype` removal; 0 diffs across Phase 3 split)
  - `tests/e2e/apitest.py`, `tests/e2e/contract.test.js`, `tests/e2e/ha-api.js`, `tests/e2e/lib.js`, `tests/e2e/privacy.test.js`, `tests/e2e/regress.test.js`
  - `tests/diff/corpus.js`, `tests/diff/random.js`
  - `tests/backend/test_zwave_values.py`, `tests/backend/test_websocket.py`, `tests/backend/test_mqtt_sources.py`, `tests/backend/test_privacy.py`, `tests/backend/test_setup.py`
  - `tests/mutants.json` (remapped all 271 frontend mutants to ES modules, fixed 1 stale expectation, updated 1 check-edit anchor, added 17 new mutants -> **319 total**)

---

## Verification Matrix

| Suite / Check | Status | Notes |
|---|---|---|
| `node --check` across all 24 `frontend/**/*.js` modules | **PASS (24/24)** | Syntax clean across entire module graph |
| All 9 Node suites (`static`, `wiring`, `import`, `problems`, `sandbox`, `builder`, `clock`, `link`, `store`) | **PASS (621/621)** | Includes `static.test.js` 61/61 and all 319 single-match mutant anchors |
| All 7 Playwright fake-HA board suites (`smoke`, `a11y`, `layout`, `regress`, `snapshots`, `leak`, `draw`) | **PASS (68/68 tests)** | `board-smoke` 11/11, `board-regress` 381/381, `board-a11y` 26/26, `board-leak` 9/9, `board-snapshots` 47/47 (0 diffs) |
| Jitter (`FB_JITTER=45672517445 FB_RETRIES=0`) on `board-regress` | **PASS** | Issue #72 `0.13.0` sandbox races + `0.11.3` Undo toast race fixed |
| Differential JS sandbox (`tests/diff/sandbox.js --random 50 --seed 45672517445`) | **PASS (161 scenarios)** | Zero errors; `random.js` disjoint helper writes eliminate concurrent write races |
| Mutants (Issue #72 + Phase 1 + Phase 2 + Phase 3 + `card-loader` JS/board/static mutants) | **PASS (all caught)** | Every newly added and remapped JS/board/static mutant verified caught |
| Python `backend` (`pytest tests/backend`) | **Pending CI** | Run via GitHub Actions on PR (`__init__.py`, `zwave.py`, `versions.py`, `checks.py`, `diagnostics.py`, `sources.py`, `websocket.py` + backend mutants) |
| Real-HA `diff` & `e2e-*` (`apitest`, `privacy`, `contract`, `ui`, etc.) | **Pending CI** | Updated for `/functions_board_static_v/<digest>/`, `card-loader.js`, `.storage/functions_board.versions.<hash>`, and `.storage/functions_board.checks` |

---

## Quick Verification Commands (for Opus / CI)

```sh
# Fast local verification (Node + Python unit/diff + fake-HA Playwright)
sh tests/run.sh

# Jitter verification (Issue #72 seed)
FB_JITTER=45672517445 FB_RETRIES=0 sh tests/run.sh --only '^board-regress$'

# Full suite including Python backend, real-HA diff, and E2E
sh tests/run.sh --ha

# Mutants (all new & fixed mutants across Phases 1–3)
node tests/mutants.js --ha "no Save on the active|choice is ignored|_chkStepText|sbxRewrite|_watchDrawer|MQTT cover|missing targetless|target\.exclude|script\.toggle|_sbxOn|multi-endpoint|deleting last version|allowlist|case-sensitive|set_checks|card-loader"
```
