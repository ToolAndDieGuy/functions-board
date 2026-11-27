# Phase 1 Codebase Audit Fixes (Shipped in `v0.14.0`)

All fixes below were audited against baseline `v0.13.1` (`1797f688`), verified against the codebase, implemented and split cleanly across `frontend/lib/*`, `frontend/ui/*`, and `frontend/board-core.js` in Phase 3, and paired with regression tests and mutation anchors.

---

## Batch 1A — High-Impact User-Facing Bugs

| # | Bug | Files Changed | Fix Summary | Tests & Mutants |
|---|---|---|---|---|
| 1 | `clockShort()` misused on ms durations (breaks outside UTC with wall-clock AM/PM) | `frontend/functions-board.js` | Added `fmtDurLong(ms)` (`M:SS`, `H:MM:SS`, `Nd H:MM:SS`) and replaced `clockShort()` duration calls in `_chkStepText()`, `_sbxJumps()`, and `_renderSbx()`. | `tests/board/regress.test.js` (`0.13.2 durations render as M:SS...`); `tests/mutants.json` (`sandbox: _chkStepText uses clockShort on advance durations again`). |
| 2 | `sbxRewrite()` corrupted plain text & string literals outside Jinja expressions | `frontend/functions-board.js` | Tokenized template strings into plain text, `{# ... #}` comments, and `{{ ... }}` / `{% ... %}` tags; masked single/double-quoted string literals (with escape handling) before running `SBX_FNS` / `states` / `leftovers` rewrites, then restored literals. Preserved existing mutant anchor `(m, f) => \`fb_${f}(\`);`. | `tests/sandbox.test.js` (`0.13.2 sbxRewrite leaves plain text and Jinja comments untouched...`); `tests/mutants.json` (`sandbox: sbxRewrite rewrites plain text outside Jinja blocks`). |
| 3 | `this._drawerBack` collision broke Trace **Back** button & drawer focus restoration | `frontend/functions-board.js` | Renamed focus-restoration element property in `_watchDrawer()` to `this._drawerFocusBack`, kept `this._drawerBack` strictly for `'debug' | 'runs'`, and cleared `this._drawerBack = null` in `_closeDrawer()`. | `tests/board/regress.test.js` (Trace opened from Debug, Back returns to Debug, Close restores focus); `tests/mutants.json` (`board: _watchDrawer reuses _drawerBack for focus restoration`). |
| 4 | `_chkStepText()` missing `zwave` and `behave` step ops | `frontend/functions-board.js` | Added explicit `s.op === 'zwave'` and `s.op === 'behave'` branches with new `STR.en` keys (`chk_s_zwave`, `chk_s_behave`) so steps no longer fall through to "Clock to what's due". | `tests/static.test.js` (new static rule: every op in `CHECK_OPS` except `'next'` must be handled in `_chkStepText`); `tests/board/regress.test.js`. |
| 5 | MQTT cover position dropped JSON `0` and miscomputed non-zero / inverted ranges | `frontend/functions-board.js` | Changed falsy check to `if (pos === '' || pos == null || n == null) continue;`, guarded `open === closed`, and computed `Math.round(((n - closed) * 100) / (open - closed))` clamped to `[0, 100]` for both normal and inverted covers. | `tests/sandbox.test.js` (JSON `0`, non-zero offset `10..90`, inverted `100..0`); `tests/diff/corpus.js`; `tests/mutants.json` (`sandbox: MQTT cover position drops JSON zero again`). |
| 6 | Missing targetless services (`s_missing`) not marked on board / no Show button | `frontend/functions-board.js` | In `markProblems()`, marked `'svc:' + pr.ref` node and added it to `gone` so the incoming arrow gets `e.prob = true`. In `_openProblems()`, targeted `'svc:' + p.ref` for `s_missing` Show buttons. | `tests/problems.test.js`; `tests/board/regress.test.js`; `tests/mutants.json` (`problems: missing targetless service box is not marked`). |
| 7 | Renamed scripts and customized UI helper entity IDs broke in Version Snapshot / Restore | `frontend/functions-board.js` | Used `(reg && reg.unique_id) || k.slice(7)` for script IDs in `_verSnapshot()` and `_verRestoreGo()`. Restored customized `new_entity_id: k` via `config/entity_registry/update` (with fallback) when recreating deleted helpers/items in `_verRestoreGo()`. | `tests/board/regress.test.js` (`0.13.2 _verSnapshot resolves renamed script via registry unique_id`). |

---

## Batch 1B — HA 2026.11 Compatibility, Analyzer, Z-Wave, Sandbox & Debugger

| # | Bug / Gap | Files Changed | Fix Summary | Tests & Mutants |
|---|---|---|---|---|
| 8 | HA 2026.11 `target.exclude` treated as positive target | `frontend/functions-board.js` | Updated `analyze()` to skip walking `exclude` as a target and attach normalized `ex` exclusion metadata onto target refs; updated `_buildModel()`, `_globalRefs()`, and `_targetEntities()` to subtract excluded entities/devices/areas/floors/labels; added `Sandbox._excludeSet()` used by `_targets()` and `_etargets()`. | `tests/wiring.test.js`; `tests/sandbox.test.js`; `tests/mutants.json` (`wiring: analyze walks into target.exclude again`, `sandbox: target.exclude ignored in action targets`). |
| 9 | Multi-endpoint Z-Wave JS child devices ignored | `zwave.py` | Added `ENDPOINT_IDENT = re.compile(r"^(\d+)-(\d+)-(\d+)$")` fallback when `NODE_IDENT` does not match, filtering returned values to `(v.endpoint or 0) == endpoint`. | `tests/backend/test_zwave_values.py` (`test_zwave_values_multi_endpoint_child`); `tests/mutants.json` (`zwave: multi-endpoint child devices ignored again`). |
| 10 | Wiring analyzer & `sbxEffect` edge cases | `frontend/functions-board.js` | (a) `wait_for_trigger` now extracts `event_type`, `NOTIFY_EVENTS`, and `mqtt` `topic` in `'wait'`/`'condition'` mode; (b) templated `node.action` preserves `'action'` role and templated `target.entity_id` no longer suppresses `svc:` box; (c) `canSetOff()` excludes `climate`/`water_heater`/`media_player` for `turn_on`; (d) `nrGroups()` scans `n.target`; (e) `sbxEffect()` formats `input_number.*` states with `pyFloat()` (matching HA Core's float string representation, e.g. `'10.0'`). | `tests/wiring.test.js`; `tests/sandbox.test.js` (updated existing `input_number` expectation from `'10'` to `'10.0'` and added `increment` check). |
| 11 | Sandbox engine & live debugger edge cases | `frontend/functions-board.js` | (a) `Sandbox.followAll()` converges across multi-hop derived helper chains (bounded loop); (b) `_sbxRewind()` and manual `_sbxDo(fn, keepHist)` clear stale `g.hist` replay banner; (c) `script.toggle` cancels active runs in `Sandbox._call()`; (d) `_patternNext()` handles DST transitions safely; (e) `_dbgCall()` / `_dbgCallEvent()` accept `floor_id`/`label_id` targets and preserve rapid same-second live repeat calls via `_live` flag. | `tests/sandbox.test.js`; `tests/board/regress.test.js`; `tests/mutants.json` (`sandbox: script.toggle starts instead of cancelling an active script`). |

---

## Batch 1C — Notification Builder, Backend & Docs Polish

| # | Bug / Gap | Files Changed | Fix Summary | Tests & Mutants |
|---|---|---|---|---|
| 12 | Notification Builder device matching, disabled script IDs, blank button titles | `frontend/functions-board.js` | (a) `notifyTargets()` matches `name_by_user` and falls back to entity slug matching for renamed `mobile_app` devices so iOS detection (`os: 'ios'`) is preserved; (b) `_bldNewId()` checks `this._entMap.has('script.' + id)` to avoid colliding with disabled scripts; (c) `_bldWhy(spec, name, raw)` rejects blank button titles using new `STR.en` key `nb_need_btn_title`. | `tests/builder.test.js`; `tests/board/regress.test.js`. |
| 13 | Backend cleanup & validation + stale doc ref | `versions.py`, `sources.py`, `websocket.py`, `CLAUDE.md` | (a) `Versions.remove()` deletes empty `by_label[label]` buckets; (b) `_mqtt_map()` uses explicit `is not None` for switch `state_on`/`state_off` so falsy payloads (`""`, `0`) don't fall back to `payload_on`/`payload_off`; (c) `ws_set()` validates every entry in `data["layouts"]` with `_layout_problem()`; (d) removed stale `store.py` reference in `CLAUDE.md`. | `tests/backend/test_websocket.py`; `tests/backend/test_mqtt_sources.py`; `tests/mutants.json` (`versions: deleting last version leaves empty label key`). |

---

## Important Implementation Notes for Review

1. **`input_number` float strings (`pyFloat`):** `sbxEffect()` now sets `input_number.*` states using `pyFloat(n)` (e.g., `'10.0'` instead of `'10'`), matching Home Assistant Core. One existing test in `tests/sandbox.test.js` (`line 362`) was updated accordingly. Run `tests/diff` in CI to verify alignment with HA Core.
2. **Existing mutant anchor preservation:** In `sbxRewrite()`, the inner replacement still uses `(m, f) => \`fb_${f}(\`);` so existing `mutants.json` anchors remain single-match and valid (verified by `tests/static.test.js`).
3. **All `CLAUDE.md` invariants preserved:**
   - Zero outside network calls, zero new runtime Python dependencies.
   - All new UI strings live in `STR.en` (`chk_s_zwave`, `chk_s_behave`, `nb_need_btn_title`) and are called via literal `T(...)`.
   - Every method remains inside its `part:` module and respects `PARTS` state ownership.
   - Every entry in `tests/mutants.json` (319 total) matches its target file **exactly once**.
