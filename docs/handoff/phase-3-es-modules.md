# Phase 3: Native Zero-Build ES Module Architecture

Completed as a **pure no-behavior-change refactor** on branch `fix/v0.13.2-audit`, verified by zero diffs in `tests/board/snapshots.test.js`, full Node unit/static/wiring/sandbox/builder/runtime suites, and all 7 Playwright board suites.

---

## 1. Atomic Cache Busting (`__init__.py`, `card-loader.js`)

- `_frontend_hash()` computes an 8-hex-digit SHA-256 over every `.js` file under `custom_components/functions_board/frontend/` (sorted by POSIX relative path, hashing both path and bytes).
- Home Assistant registers two static paths:
  1. `/functions_board_static/<digest>` (`cache_headers=True`) — serves the sidebar panel (`/functions_board_static/<digest>/functions-board.js`) and lazy card loader (`/functions_board_static/<digest>/card-loader.js`). Every relative ES import (`./lib/...`, `./ui/...`, `./board-core.js`) resolves under the same `<digest>` prefix, giving full browser caching with **100% atomic invalidation** across updates.
  2. `/functions_board_static` (`cache_headers=False`) — backwards-compatible unversioned path for manual dashboard resources pointing at `/functions_board_static/functions-board.js`.
- `card-loader.js` now simply imports `const BOARD_URL = './functions-board.js';`, automatically inheriting the exact same `<digest>` prefix.

---

## 2. Module Layout (Zero Build Tools, Strict Acyclic DAG)

```text
custom_components/functions_board/frontend/
├── functions-board.js   # Thin ES module entrypoint (~75 lines): mixes parts, defines <functions-board> (with card-loader handoff), customCards
├── card-loader.js       # ~1.7 KB lazy dashboard card loader (admin-gated)
├── board-core.js        # class FunctionsBoard extends HTMLElement (part: core only)
├── lib/
│   ├── index.js         # Barrel re-export + initial setLang('en') after all onLang() hooks register
│   ├── i18n.js          # VERSION, REPO_URL, STR, T, P, setLang, onLang
│   ├── styles.js        # STYLE, DEFS
│   ├── runtime.js       # Clock, Link, Store, morph, PARTS, actionMap
│   ├── constants.js     # Domain/helper/debugger/version constants & shared pure utilities
│   ├── builders.js      # Notification Builder pure spec/script functions
│   ├── geometry.js      # Arrow routing, orthogonal lanes, bus dots, hops, focusSet, setCurved()
│   ├── wiring.js        # Config analyzer, problems, layered layout, loops, traces, YAML/refs, Node-RED, import grouping
│   ├── sandbox.js       # Sandbox engine, templates/sbxRewrite, saved checks, history replay, coverage, explorer
│   └── clean.js         # cleanLayout() (cleanly sits atop cleanTest, cleanNotify, cleanCheck with zero cycles)
└── ui/
    ├── mix.js           # mixParts(BoardClass, parts) — attaches property descriptors onto prototype, throws on duplicate method names
    ├── list.js          # part: list
    ├── functions.js     # part: functions
    ├── manager.js       # part: manager
    ├── problems.js      # part: problems
    ├── tools.js         # part: tools
    ├── debug.js         # part: debug
    ├── arrows.js        # part: arrows
    ├── sandbox.js       # part: sandbox
    ├── builders.js      # part: builders
    ├── versions.js      # part: versions
    ├── nodered.js       # part: nodered
    └── diagnostics.js   # part: diagnostics
```

---

## 3. Tooling & Test Harness Updates

- **`tests/lib/board-lib.js`:** Loads `frontend/lib/index.js` directly in Node via native ESM `require()` (no more regex-slicing `functions-board.js`).
- **`tests/board/fake-ha.js`:** Serves all `.js` files under `/fb/` from `frontend/` (path-traversal-guarded) so Playwright loads the real ES module graph identically to Home Assistant.
- **`tests/static.test.js`:** Walks all frontend `.js` modules, enforces `PARTS` private-state ownership by filename (`ui/<part>.js` / `board-core.js`), verifies `mixParts()` refuses duplicate method names, enforces privacy rules A1–A4 across all modules (allowing only local relative `.js` ES imports and `card-loader.js`'s single `import(BOARD_URL)`), and checks all 318 mutant anchors.
- **`tests/mutants.json`:** Automatically remapped all 271 frontend mutants to their exact new module paths (`0` unresolved, `318/318` single-match verified).
- **`scripts/bump.js`, `scripts/gen_sandbox_triggers.py`, `tests/board/snapshots.test.js`, `.github/workflows/validate.yml`:** Updated for the modular frontend layout (CI now runs `node --check` on every `.js` file under `frontend/`).
- **Note on `scripts/compare-builds.js`:** That one-off 0.10.0 browser console helper assumed a single-file blob; if side-by-side real-HA comparison is needed again in the future, it should import the new module URL directly instead of wrapping a single file in a `Blob`.
