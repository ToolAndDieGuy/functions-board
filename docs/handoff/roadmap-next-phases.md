# Remaining Audit Roadmap (Phases 2–4 & Open Items)

This document summarizes what was **not** included in Phase 1 (`fix/v0.13.2-audit`) so Opus can pick up cleanly after Phase 1 is verified locally and released.

---

## Phase 2 — Backend Hardening (Suggested `v0.13.3` or folded into `0.13.x`)

1. **Non-blocking storage & atomic writes (`__init__.py`, `versions.py`):**
   - Review synchronous `os.replace` / file writes and ensure large board or version saves cannot stall the Home Assistant event loop.
   - Audit `BoardData` / `Versions` load/save concurrency under rapid `set_layout` / `version_save` bursts.
2. **Frontend static card/panel registration & cache-busting (`__init__.py`):**
   - Verify cache query string (`?v=VERSION`) and static path registration follow current HA `async_register_static_paths` best practices with zero deprecation warnings.
3. **Diagnostics & error-boundary hardening (`diagnostics.py`, `sources.py`, `nodered.py`):**
   - Ensure malformed config entries, unloaded integrations, or unusual MQTT/Node-RED schemas return partial results gracefully rather than failing the whole request.

---

## Phase 3 — Native Zero-Build ES Module Split (Suggested `v0.14.0`)

A pure **no-behavior-change** split of `custom_components/functions_board/frontend/functions-board.js` into native browser ES modules served directly by Home Assistant (zero bundler, zero build step):

- **Pre-conditions:**
  - Keep `tests/board/snapshots.test.js` at **zero diff** before and after the split.
  - Keep `sh tests/run.sh --ha` and `node tests/mutants.js --ha` green.
- **Important caveats discovered during audit:**
  1. **`tests/static.test.js` & `tests/mutants.json`:** Both currently read a single `functions-board.js` path and scan `PARTS` / `STR.en` / `_actionTables` inside one file. Update the static test loader (concatenating or walking the module list) and remap `mutants.json` `"file"` fields in the same PR.
  2. **`scripts/compare-builds.js`:** Assumes a single `functions-board.js` file; update it if cross-version comparisons are still needed across the module split boundary.
  3. **`tests/lib/board-lib.js`:** Currently evaluates the library slice of `functions-board.js` in Node (`vm` / `new Function`); with ES modules, Node can load the pure library modules directly (or via a thin CJS/ESM shim).
  4. **Suggested module boundaries (aligned with existing `PARTS`):**
     - `i18n.js` (`STR`, `T`, `P`)
     - `styles.js` (`STYLE`)
     - `core/clock.js`, `core/link.js`, `core/store.js`, `core/morph.js`
     - `model/wiring.js`, `model/problems.js`, `model/import.js`, `model/layout.js`
     - `sandbox/engine.js`, `sandbox/templates.js`, `sandbox/mqtt.js`, `sandbox/builder.js`
     - `board/*.js` (UI parts matching `PARTS`: `list`, `canvas`, `drawer`, `sandbox`, `debug`, `versions`, `mgr`, `builder`)
     - `functions-board.js` (thin entrypoint registering `<functions-board>`)

---

## Phase 4 — Features & Recipes (Suggested `v0.15.0+`)

Build on top of the modularized codebase:
- Additional **Recipes** alongside the Notification Builder (e.g., motion-activated lighting with timeout/override, door-left-open alert, presence/quiet-hours helpers).
- Expanded HA 2026.x trigger/condition coverage in the sandbox as new purpose-specific triggers ship.
- Deeper multi-endpoint Z-Wave and Matter/Thread sandbox helpers.

---

## Other Open Repo Items

- **Issue #73 (`readme-pictures`):** Follow-up on updating/regenerating README screenshots (`tests/shots.sh`) once UI changes settle.
- **Release checklist (only when user explicitly requests a release):**
  1. Confirm local Home Assistant testing is complete.
  2. Merge feature PR into `main` (or bump version via `node scripts/bump.js 0.13.2` and move `CHANGELOG.md` `## Unreleased` under `## 0.13.2 (YYYY-MM-DD)`).
  3. Note: `.github/workflows/release.yml` automatically creates a GitHub Release when `main` passes `Validate` with a new untagged version in `manifest.json`.
