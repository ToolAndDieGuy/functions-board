# Handoff Index (`v0.14.0` → `v0.16.0`)

This folder documents the audit, hardening, ES module refactor (`v0.14.0`), and the subsequent **Template Studio & 20 Guided Recipes** (`v0.15.0`, PR #75) and **Board Intelligence & Safety Net** (`v0.16.0`, PR #76) releases.

> **Current status:**
> - **`v0.14.0`** — Merged to `main` (PR #74).
> - **`v0.15.0`** — Merged to `main` (PR #75, **7/7 CI checks green**).
> - **`v0.16.0`** — Merged to `main` (PR #76, **7/7 CI checks green**).

---

## Contents

1. [`v0.15-v0.16-handoff.md`](./v0.15-v0.16-handoff.md) — **Latest handoff:** Template Studio, 20 Guided Recipes Gallery, Sandbox `time`-at-entity fix (`v0.15.0`), plus Quiet Automations, Impact Inspector, Plain-English Version Diffs, Share-a-Function Anonymized YAML Package Export, and Self-Running Checks + HA Repairs (`v0.16.0`).
2. [`issue-72-triage.md`](./issue-72-triage.md) — Root-cause analysis and fixes for all three failing weekly CI jobs in Issue #72 (`mutants`, `jitter`, `diff`) plus the `actions/upload-artifact@v4` dot-directory fix.
3. [`phase-1-audit-fixes.md`](./phase-1-audit-fixes.md) — Complete itemized breakdown of all Phase 1 (Batches 1A, 1B, 1C) bug fixes, current ES module locations, regression tests, static invariants, and mutants.
4. [`phase-2-hardening.md`](./phase-2-hardening.md) — Phase 2 backend hardening & HACS review version restore domain allowlist.
5. [`phase-3-es-modules.md`](./phase-3-es-modules.md) — Phase 3 native zero-build ES module refactor (zero-build ES modules, atomic `/functions_board_static_v/<digest>/` cache busting, `mixParts()`).
6. [`roadmap-next-phases.md`](./roadmap-next-phases.md) — Visual UI/UX review findings, completed Phase 4 items, and remaining open polish items (including Issue #73 `readme-pictures`).

---

## Files Modified on This Branch

- **Frontend (24 Native ES Modules):** `custom_components/functions_board/frontend/functions-board.js` (thin entrypoint), `card-loader.js`, `board-core.js`, `lib/*.js` (10 modules), `ui/*.js` (13 modules)
- **Backend:** `custom_components/functions_board/__init__.py`, `const.py`, `checks.py`, `diagnostics.py`, `sources.py`, `versions.py`, `websocket.py`, `zwave.py`
- **CI, Scripts & Docs:** `.github/workflows/validate.yml`, `.github/workflows/weekly.yml`, `scripts/bump.js`, `scripts/gen_sandbox_triggers.py`, `CHANGELOG.md`, `CLAUDE.md`, `docs/guide.md`, `docs/what-it-changes.md`, `docs/handoff/*`
- **Test Suites, Snapshots & Mutants:**
  - `tests/lib/board-lib.js` (loads `frontend/lib/index.js` directly in Node)
  - `tests/static.test.js` (walks all 24 ES modules, `PARTS` by filename, `mixParts` collision check, `CHECK_OPS` <-> `_chkStepText` rule, `WS_OK` for checks commands, `card-loader.js` size/network/admin/constructor checks, and 320/320 mutant anchor checks)
  - `tests/sandbox.test.js`, `tests/wiring.test.js`, `tests/problems.test.js`, `tests/builder.test.js`
  - `tests/board/fake-ha.js`, `tests/board/smoke.test.js` (`card-loader.js` lazy admin, preloaded admin, and non-admin isolation tests), `tests/board/regress.test.js` (`0.13.2` + `0.13.3` + `0.14.0` per-item version restore regression tests & jitter stabilization), `tests/board/snapshots.test.js`, `tests/board/snapshots/*.txt` (updated for `· prototype` removal and per-item restore styles)
  - `tests/e2e/apitest.py`, `tests/e2e/contract.test.js`, `tests/e2e/ha-api.js`, `tests/e2e/lib.js`, `tests/e2e/privacy.test.js`, `tests/e2e/regress.test.js`, `tests/e2e/versions.test.js`
  - `tests/diff/corpus.js`, `tests/diff/mqtt.js`, `tests/diff/random.js`
  - `tests/backend/test_zwave_values.py`, `tests/backend/test_websocket.py`, `tests/backend/test_mqtt_sources.py`, `tests/backend/test_privacy.py`, `tests/backend/test_setup.py`
  - `tests/mutants.json` (remapped all 271 frontend mutants to ES modules, fixed 1 stale expectation, updated 1 check-edit anchor, added 18 new mutants -> **320 total**)

---

## Verification Matrix

| Suite / Check | Status | Notes |
|---|---|---|
| `node --check` across all 24 `frontend/**/*.js` modules | **PASS (24/24)** | Syntax clean across entire module graph |
| All 9 Node suites (`static`, `wiring`, `import`, `problems`, `sandbox`, `builder`, `clock`, `link`, `store`) | **PASS (621/621)** | Includes `static.test.js` 61/61 and all 320 single-match mutant anchors |
| All 7 Playwright fake-HA board suites (`smoke`, `a11y`, `layout`, `regress`, `snapshots`, `leak`, `draw`) | **PASS (68/68 tests)** | `board-smoke` 11/11, `board-regress` 383/383, `board-a11y` 26/26, `board-leak` 9/9, `board-snapshots` 47/47 |
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
