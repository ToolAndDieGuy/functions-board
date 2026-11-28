# UI/UX Review & Remaining Roadmap (Phase 4+)

Phases 1, 2, and 3 (plus Issue #72 triage, HACS review version restore domain allowlist hardening, removing the `prototype` UI tag, and the post-session review fixes) are packaged in **v0.14.0** (`release-0.14.0`). This document records the visual UI/UX audit findings and remaining feature roadmap so Opus and future sessions can pick up cleanly.

> **Note on UI changes & snapshots:** `tests/board/snapshots.test.js` locks DOM structure and `<style>` hashes across 47 view snapshots (`FB_SNAP_UPDATE=1` refreshes them intentionally), and `tests/shots.sh` compares README screenshots. Any intentional visual/DOM polish below should be shipped in its own dedicated UI PR with deliberate snapshot updates.

---

## 1. Visual UI/UX Review Findings (Inspected Across Dark, Light, Desktop & Mobile)

One UI bug found during the visual audit was fixed immediately with zero snapshot diffs:
- **Fixed (`ui/tools.js` `_watchModal`):** Opening tall read-heavy dialogs without form inputs (such as **About** and **Sandbox intro**) previously called `f.focus()` without `{ preventScroll: true }` on the bottom action button (`Diagnostics…`), scrolling the dialog past its `<h3>` title and top paragraphs on open. Fixed via `f.focus({ preventScroll: true })` and covered in `tests/board/regress.test.js`.

### High-Value UI Improvements for Upcoming Polish PRs

1. **Expanded Key (`.legend`) occluding the whiteboard & colliding with `.nodebar`:**
   - *Observed:* By default (`ui.legend: true`), the expanded Key (~305×430 px in bottom-left) covers left-column boxes right after `_fit()` runs because `_fit()` computes bounds over the full `.vp` without subtracting open `.legend` or `.drawer` insets. When a right-hand drawer (`Debug` or `Sandbox`) is also open on a 1440 px screen, `.legend` + `.drawer` cover over half the canvas, and selecting a box places `.nodebar` directly overlapping `.legend`.
   - *Recommendation:* Account for open `.drawer` width (and optionally `.legend` bounds) inside `_fit()`, raise `.nodebar` above `.legend` in stacking order (`z-index`), and auto-collapse `.legend` when a right-hand drawer opens on medium widths (`< 1500 px`) or default `.legend` to collapsed once first-run onboarding completes.

2. **Desktop top toolbar (`.bar` / `.tools`) wrapping into two uneven rows at 1440 px:**
   - *Observed:* At 1440 px width (even without HA's 256 px sidebar), 15 labeled buttons alongside `.title` wrap `Sandbox`, `Versions`, and `Pause` onto an orphaned second row.
   - *Recommendation:* Consolidate item creation actions (`Automation`, `Script`, `Recipes`, `Helper`, `Existing`, `Frame`, `Note`) behind a primary **`+ Add ▾`** menu (keeping `Recipes` prominent inside or alongside it), leaving canvas tools (`Undo/Redo`, `Auto-arrange`, `Arrows`) and workspace modes (`Runs`, `Debug`, `Sandbox`, `Versions`, `Pause`) on a crisp single 52 px row across 1280–1920 px screens.

3. **Mobile / narrow toolbar (16 unlabeled icon-only buttons across two rows):**
   - *Observed:* Below `880 px` container width, `.tools button span { display: none }` strips all text labels, leaving ~16 icon-only buttons across two rows with no hover tooltips on touch devices.
   - *Recommendation:* On compact viewports, keep the 3–4 primary mode actions (`Sandbox`, `Debug`, `Runs`, `More ⋯` / `+ Add`) visible with short labels or grouped menus instead of rendering two rows of unlabeled icons.

4. **Sandbox drawer vertical space balance (controls vs Timeline):**
   - *Observed:* Although `0.13.1` added collapsible sections (`CHANGE SOMETHING`, `SEND AN EVENT`, `RUN AND REPLAY`, `TIME`, `SETTINGS`), all 5 start expanded by default — consuming ~62% of a 900 px viewport and squeezing the **Timeline / States / Explore / Coverage** output pane at the bottom. Also, in `SETTINGS → Debug`, `"Step through: pause before every condition and action Or Pause here on an automation's box"` lacks a period/separator before `"Or"`.
   - *Recommendation:* Default `RUN AND REPLAY` and `SETTINGS` to folded on first visit (user's persisted fold state still wins thereafter), immediately doubling visible Timeline height. Add clean punctuation or muted secondary styling to the `Or Pause here…` hint.

5. **Sticky modal headers & footers on tall dialogs (`.dlg.about`, `.dlg.nbdlg`, `.sbxdlg`):**
   - *Observed:* While `.dlg.mgr` (Import Manager) uses a fixed header + scrolling `.mbody` + fixed `.mfoot`, `.dlg.about` and `.sbxdlg` scroll as a single container (scrolling the title away), and `.nbdlg` has no visual divider above its bottom button row when `.nbbody` overflows.
   - *Recommendation:* Give tall dialogs sticky headers and a subtle `border-top` footer bar matching `.dlg.mgr`.

6. **Sidebar search truncation & Import Manager intro density:**
   - *Observed:* In the 250 px `.list` sidebar, `"Find an automation, helper, device…"` clips mid-word (`devic`). In the Import Manager, the 5-line explanatory paragraph pushes candidate groups down on smaller screens.
   - *Recommendation:* Slightly widen `.list` (`264 px`) or tighten `.lfind input` font/placeholder (`"Find anything…"`), and turn the Import Manager's summary count into a compact header pill with a collapsible `"How grouping works"` disclosure.

---

## 2. Phase 4 — Features & Recipes (`v0.15.0` & `v0.16.0` Shipped!)

Completed in **v0.15.0** (PR #75) and **v0.16.0** (PR #76) — see [`v0.15-v0.16-handoff.md`](./v0.15-v0.16-handoff.md):
- **Done (`v0.15.0`):** Full Template Studio (5-goal wizard, 32-concept interactive Jinja Guide, plain-English clause walkthrough with live `render_template` values, unavailable-trap linter & 1-click fixes, inline attribute/time simulator, native Template helper creation) + 20 Guided Recipes Gallery (17 template helpers, Notification Builder, Left-open alert, Motion-activated light).
- **Done (`v0.16.0`):** Never-Fired / Quiet Automations in Problems, Impact / "Where is this used?" cross-function drawer, Plain-English Version Diffs (Compare + Make active), Share-a-Function Anonymized YAML Package Export, and Self-Running Checks + Home Assistant Repairs (`check_runner.py`).

Still open for future iterations:
- Expanded HA 2026.x purpose-specific trigger/condition coverage in the sandbox.
- Deeper multi-endpoint Z-Wave and Matter/Thread sandbox helpers.
- User-facing documentation updates in `docs/guide.md` and `docs/what-it-changes.md` covering v0.15.0 & v0.16.0 features.

---

## 3. Other Open Repo Items & Release Checklist

- **Issue #73 (`readme-pictures`):** Regenerate README screenshots via the weekly `pictures` workflow (`tests/shots.sh`) once UI changes settle (since `· prototype` was removed from the footer).
- **Release checklist (only when user explicitly requests a release):**
  1. Confirm local Home Assistant testing and Draft PR GitHub Actions (`Validate`) are 100% green.
  2. Bump version via `node scripts/bump.js 0.13.2` (turns `## Unreleased` in `CHANGELOG.md` into `## 0.13.2 (YYYY-MM-DD)`) only on the final release PR.
  3. Merging to `main` with a new untagged version in `manifest.json` automatically triggers `.github/workflows/release.yml` to tag and publish the HACS GitHub Release.
