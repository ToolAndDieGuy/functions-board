# Remaining Audit Roadmap (Phase 4 & Open Items)

Phases 1, 2, and 3 (plus Issue #72 triage, Frenck's version restore domain allowlist hardening, and removing the `prototype` UI tag) are implemented on `fix/v0.13.2-audit`. This document summarizes the remaining roadmap so Opus can pick up cleanly once Phases 1–3 are verified locally and released.

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
