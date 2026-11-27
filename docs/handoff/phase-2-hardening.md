# Phase 2: Backend Hardening & Version Restore Domain Allowlist

Completed on branch `fix/v0.13.2-audit` alongside Phase 1 & Issue #72 fixes. All items preserve zero runtime Python dependencies, zero outside network calls, and full backward compatibility with existing `.storage/` files.

---

## 1. Version Snapshot / Restore Domain Allowlist (Frenck's Security Hardening)

- **Concern:** Restoring a saved version sent WebSocket commands (`<dom>/list`, `<dom>/update`, `<dom>/create`) whose domain came directly from the stored snapshot without validating against an allowlist.
- **Allowlist (`VERSION_DOMAINS` / `VER_DOMAINS` / `VER_HELPERS`):**
  - Config domains: `automation`, `script`
  - Helper domains: `input_boolean`, `input_number`, `input_text`, `input_select`, `input_datetime`, `input_button`, `counter`, `timer`, `schedule`
- **Backend enforcement (`const.py`, `versions.py`, `websocket.py`):**
  - Added `VERSION_DOMAINS` in `const.py` and `snapshot_problem()` in `versions.py`.
  - Both `Versions.add()` (`functions_board/version_save`) and `Versions.overwrite()` (`functions_board/version_overwrite`) reject any snapshot item whose `dom` is outside `VERSION_DOMAINS` or mismatches its entity key prefix with `invalid_format`.
- **Frontend enforcement (`frontend/functions-board.js`):**
  - Added `VER_DOMAINS` alongside `VER_HELPERS`.
  - `_verDiff()` only sends `it.dom + '/list'` when `VER_HELPERS.has(it.dom)`.
  - `_verPlan()` skips any item not in `VER_DOMAINS`.
  - `_verRestoreGo()` explicitly checks `VER_HELPERS.has(it.dom)` before sending `it.dom + '/update'` or `it.dom + '/create'`, throwing otherwise.
  - `_restoreItems()` (Undo of delete) also checks `VER_HELPERS.has(p.dom)`.
- **Tests & Mutants:**
  - `tests/board/regress.test.js` (`0.13.3 version restore domain allowlist blocks non-allowlisted WS commands in diff, plan, and restore`).
  - `tests/backend/test_websocket.py` (`test_versions_domain_allowlist`).
  - `tests/board/fake-ha.js` mirrors `VERSION_DOMAINS` validation.
  - `tests/mutants.json`: both frontend and backend allowlist mutants.

---

## 2. Diagnostics Event-Loop Offload & Redaction Gaps (`diagnostics.py`)

- **Event-loop offload:** Registry discovery and raw `out` assembly run on the event loop; regex compilation and recursive tree anonymisation (`anonymiser.anonymise(out)`) run in an executor thread via `await hass.async_add_executor_job(anonymiser.anonymise, out)`.
- **Case-insensitive redaction:** `_known_ci` stores lowercase keys mapped to `(canonical_text, kind)` and `_known_re` compiles with `re.IGNORECASE`, so lowercase references to mixed-case device/area/entity names (e.g. `"bramblewood heater"` for `"Bramblewood Heater"`) map to the same consistent stand-in without leaking.
- **Structural-word / short label protection:** Label IDs under 3 characters or in `STRUCTURE` (e.g. `"mode"`, `"on"`) are excluded from free-text `_known_re` matching so structural JSON keys/values (`"mode": "single"`, `"to": "on"`) are never corrupted, while still being explicitly anonymised in all structural label positions (`layouts`, `revs`, `versions`, `checks`, `functions`, `labels`, `function`, `label`, `label_id`, and `label:...` refs).
- **Tests & Mutants:** `tests/backend/test_privacy.py` (`test_anonymiser_case_insensitive_and_structural_label_safe`), plus `tests/mutants.json` (`diagnostics: known-name regex is case-sensitive again`).

---

## 3. Split Version Metadata from Snapshot Blobs (`versions.py`, `websocket.py`)

- **Index store (`.storage/functions_board.versions`):** Holds only lightweight metadata (`META` fields) and `active` pointers — never snapshot payloads. Renaming (`version_edit`) or updating the active pointer (`version_active`) rewrites only the small index file.
- **Per-function blob stores (`.storage/functions_board.versions.<sha256(label)[:16]>`):** Holds `{"snapshots": {vid: snapshot}}`, loaded lazily via `await versions.async_ensure_blobs(label)` / `await versions.async_get(label, vid)`. Deleting the last version of a function removes its empty blob store file.
- **Transparent migration:** `Versions.async_load()` automatically detects legacy single-file inline `snapshot` dicts, writes them into per-function blob stores, and rewrites the lean index store.
- **Async WS handlers:** `ws_version_get`, `ws_version_save`, `ws_version_overwrite`, and `ws_version_delete` use `@websocket_api.async_response` so blob loading never blocks the event loop.
- **Tests:** `tests/backend/test_websocket.py` (`test_versions_split_metadata_and_lazy_blobs`).

---

## 4. Decouple Saved Checks from the 200 KB Layout Store (`checks.py`, `websocket.py`, `__init__.py`, `functions-board.js`)

- **Dedicated store (`.storage/functions_board.checks`):** New `checks.py` module (`MAX_CHECKS_PER_FN = 50`, `MAX_CHECKS_FN_BYTES = 1 MB`, `MAX_CHECKS_BYTES = 10 MB`).
- **Admin-only WS commands:** `functions_board/checks` (optional `label`) and `functions_board/set_checks` (`label`, `checks`, optional `client`), publishing `{"what": "checks", "label": ..., "client": ...}` to subscribed boards.
- **Transparent auto-migration:** On startup (`__init__.py`), `Checks.migrate_from_layouts()` moves any legacy `layout.checks` into `.storage/functions_board.checks` and strips them from `layouts`.
- **Frontend (`functions-board.js`):** Loads checks via `functions_board/checks` (gracefully falling back to `L.checks` on older integrations / card-only mode), saves checks solely via `functions_board/set_checks`, and strips `checks` from `functions_board/set_layout` payloads so box drags never serialize saved checks.
- **Test apparatus updated:** `tests/static.test.js` (`WS_OK`), `tests/board/fake-ha.js`, `tests/e2e/contract.test.js`, `tests/e2e/ha-api.js` (`reset()`), `tests/e2e/regress.test.js`, `tests/board/regress.test.js`, `tests/backend/test_websocket.py`, `tests/backend/test_privacy.py`, and `tests/mutants.json`.

---

## 5. Lazy Dashboard Card Loader (`frontend/card-loader.js`, `__init__.py`)

- **Problem:** Enabling `CONF_CARD` previously loaded the full ~1.15 MB `functions-board.js` via `frontend.add_extra_js_url()` for every user (including non-admins) on every dashboard.
- **Fix:** Shipped a ~3.5 KB `frontend/card-loader.js` registered via `add_extra_js_url(hass, board.card_loader_url)` (`/functions_board_static/<digest>/card-loader.js`):
  - Spec-compliant Custom Element constructor (only `super(); this.attachShadow({ mode: 'open' });` — never sets `this.style` or host attributes inside `constructor()`, using `<style>:host{display:block}</style>` inside Shadow DOM so `document.createElement('functions-board')` never throws `NotSupportedError`).
  - Registers card picker metadata once in `window.customCards` and forwards `setConfig`, `getCardSize`, `getGridOptions`, `static getStubConfig`, `panel`, `narrow`, `route`, `isPanel`, `layout`, `hass`, and static `VERSION` / `STR` / `morph` once mounted.
  - If `hass.user.is_admin === false`, renders a short admin-only notice in Shadow DOM without ever downloading `functions-board.js`.
  - If `hass.user.is_admin === true`, dynamically imports `./functions-board.js` once and mounts `<functions-board-app>`, handling disconnect/reconnect cleanly.
  - Compatible with opening the sidebar panel first (`card-loader.js` no-ops if `<functions-board>` is already defined) or opening a dashboard/page first (`functions-board.js` detects `__fbLoader`, defines `<functions-board-app>`, and resolves waiting elements).
- **Tests & Mutants:** `tests/static.test.js` (size < 4 KB, zero outside URLs / network APIs, single relative `import(BOARD_URL)`, admin guard, constructor attribute check), `tests/board/smoke.test.js` (lazy admin mount, panel-preloaded mount, and non-admin isolation in real Chromium), `tests/backend/test_setup.py`, and `tests/mutants.json` (admin-guard mutant + constructor-attribute mutant).
