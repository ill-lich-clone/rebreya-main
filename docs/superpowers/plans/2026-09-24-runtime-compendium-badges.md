# Runtime Compendium Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile editable compendium badges once per changed artwork revision at active-GM startup and keep managed documents pointed at the finished images.

**Architecture:** A deterministic target manifest maps 3,695 document IDs to source art and one of 17 badges. A startup service uses canvas and Foundry persistent package storage for resumable per-pack builds. Shared managed sync applies completed image paths while retaining current data and identity logic.

**Tech Stack:** Python 3/Pillow asset preparation; Foundry VTT v13 JavaScript, FilePicker persistent storage, Canvas API; Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-24-runtime-compendium-badges-design.md`

## Global Constraints

- Work only on `lich_branch`, follow AGENTS.md preflight, focused tests, full checks, exact staging, commit and push.
- Keep the 3,191 reviewed artworks and 504 ordinary gear sources separate from generated images.
- Use stable `packId + documentId`; never bind by normalized display name.
- The elected active GM alone uploads and updates managed documents; no other client performs work.
- Preserve UUIDs, mechanics, flags, user documents, and the one shared icon-cache lifecycle.
- Bump `module.json` and its versioned forwarder for player-visible code and assets; update section 15 of `docs/function-passport.md` for changed methods.

## Review Focus

- Missing source or badge: abort that pack without switching its document paths.
- Interrupted upload: resume from existing output files, then publish one complete checkpoint.
- Inactive GM or player: skip storage and document writes.
- Duplicate names or shared source icons: use exact document IDs and distinct generated paths.
- Second startup with unchanged inputs: zero uploads and zero image updates.

---

### Task 1: Prepare exact assets and target manifest

**Files:** modify `tools/icon-pipeline.py`; create `data/icon-badge-targets.json`, `templates/icon-bases/**`, `assets/icon-badges/**`; test `tests/icon-badge-manifest.test.mjs` or Python equivalent.

**Interfaces:** `prepare-badge-assets --review-manifest <csv> --pack-index <json> --markers <dir>` writes schema v1 rows with `packId`, `documentId`, `baselineImg`, `sourcePath`, `sourceHash`, and `badgeId`.

- [x] Add a focused failing test for exact identities and missing/duplicate input rejection; audit the complete 17-pack, 3,695-target set separately.
- [x] Extend the existing pipeline with the deterministic command and source WebP compression; write the exact reviewed asset set and manifest.
- [x] Run the focused test and inspect a sample WebP against its PNG source.

### Task 2: Add the resumable active-GM compiler

**Files:** create `scripts/data/icon-badge-build.js`; modify `scripts/main.js`; test `tests/icon-badge-build.test.mjs`.

**Interfaces:** `prepareCompendiumBadgeImages({game, FilePicker, fetch, manifest, ...})` returns a read-only map of complete `packId + documentId` output URLs. It initializes editable persistent markers, hashes each pack input, resumes missing uploads, and checkpoints only complete packs.

- [x] Add focused failing tests for unchanged start, one-marker change, inactive GM, upload resume, and failed-pack rollback.
- [x] Implement the compiler using public Foundry v13 storage APIs and a bounded upload queue.
- [x] Run focused tests and inspect output geometry and opacity.

### Task 3: Project completed images into managed sync

**Files:** modify `scripts/data/managed-compendium-sync.js`, relevant legacy icon refresh helpers, `scripts/main.js`; test `tests/managed-compendium-sync.test.mjs` plus affected owner tests.

**Interfaces:** `setManagedIconProjection(map)` installs the completed per-document output map before each sync batch. The managed synchronizer substitutes only `img` in create/update data and compares existing badged documents against the original source-image expectation.

- [x] Add failing tests for stable UUID/mechanics, unchanged second sync, changed badge URL, and a mechanics update with badge preserved.
- [x] Implement one canonical projection registry and adapt legacy icon refresh to respect exact target IDs.
- [x] Run focused tests for every changed compendium owner.

### Task 4: Verify live behavior and release

**Files:** modify `docs/function-passport.md` section 15 and versioned entry point, plus any affected README API contract.

- [x] Audit manifest coverage, image files, and checkpoint behavior in focused tests. Live active-GM sync was waived by the user and remains unverified.
- [x] Run focused tests and the full AGENTS.md checks. Runtime console and reload behavior remain unverified by user choice.
- [ ] Check `git diff --check`, `git diff --stat`, substantive diff, exact stage, commit, and push `lich_branch` without force.
