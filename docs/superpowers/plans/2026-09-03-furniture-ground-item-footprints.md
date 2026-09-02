# Furniture Ground Item Footprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the twelve approved furniture gear items curated token footprints and deterministic quarter-turn rotations without changing Item icons or pile/storage behavior.

**Architecture:** Extend the existing top-down manifest and generated runtime catalog with sparse presentation overrides. Flow them through the pure resolver and pile presentation into the existing `StorageGroundPileService`, which remains the sole TokenDocument writer. Repack only rectangular furniture assets onto matching transparent canvases so Foundry `texture.fit: "contain"` preserves artwork proportions.

**Tech Stack:** Node.js ESM tests, Foundry VTT 13 TokenDocument data, JSON manifest, ImageMagick WebP processing.

**Spec:** `docs/superpowers/specs/2026-09-01-top-down-item-textures-design.md`, section 17.

## Global Constraints

- Work only on `lich_branch`; commit and push without force.
- Preserve stable gearId/UUID, Item.img, active-GM/socket authorization, mutation idempotency and the existing canvas-drop owner.
- Multi-item piles, coins, journals, built-in storage presets and external-item fallback retain their current presentation.
- Do not run live Foundry QA in this task; report it as deferred by user instruction.

---

### Task 1: Manifest and generated presentation overrides

**Files:**
- Modify: `tools/top-down-items/manifest.mjs`
- Modify: `tools/top-down-item-assets.mjs`
- Modify: `data/top-down-item-assets.json`
- Regenerate: `scripts/data/top-down-item-texture-catalog.js`
- Test: `tests/top-down-item-manifest.test.mjs`
- Test: `tests/top-down-item-texture-resolver.test.mjs`

**Interfaces:**
- Produces: sparse `TOP_DOWN_ITEM_FOOTPRINTS: Map<string,{width:number,height:number,rotationMode:"cardinal"}>`.
- Produces: `resolveTopDownItemPresentation(row).tokenWidth`, `.tokenHeight`, `.rotationMode`.

- [ ] **Step 1: Write RED tests** asserting the twelve literal footprint mappings, schema v3 preservation/validation, generated-catalog parity and resolver defaults for an ordinary item.
- [ ] **Step 2: Verify RED** with `node --test tests/top-down-item-manifest.test.mjs tests/top-down-item-texture-resolver.test.mjs`; expected failure is missing footprint fields/export.
- [ ] **Step 3: Implement minimal manifest/catalog/resolver support**. Optional manifest fields are accepted only together, require positive half-cell increments, and allow only `rotationMode: "cardinal"`; absent fields preserve legacy sizing/full rotation.
- [ ] **Step 4: Regenerate the catalog and verify GREEN** with the same focused tests.

### Task 2: Rectangular token layout through the existing owner

**Files:**
- Modify: `scripts/data/storage-pile-presentation.js`
- Modify: `scripts/data/storage-ground-pile-service.js`
- Test: `tests/storage-pile-presentation.test.mjs`
- Test: `tests/storage-ground-pile-service.test.mjs`

**Interfaces:**
- Consumes: resolver footprint fields from Task 1.
- Preserves: `deriveGroundPilePresentation(rows, options)` and all non-single branches.

- [ ] **Step 1: Write RED presentation tests** for `3×2`, `1×2`, and unchanged ordinary/armor defaults.
- [ ] **Step 2: Write RED service tests** asserting exact create size/center, rotation membership in `[0,90,180,270]`, stable retry, merge reset to `1×1/0`, and survivor footprint restoration.
- [ ] **Step 3: Verify RED** with `node --test tests/storage-pile-presentation.test.mjs tests/storage-ground-pile-service.test.mjs`.
- [ ] **Step 4: Implement minimal owner changes**: select cardinal rotation from the existing stable seed, use independent target width/height, and preserve the token center during updates.
- [ ] **Step 5: Verify GREEN** with the same focused tests plus `tests/builtin-storage-presets.test.mjs`.

### Task 3: Aspect-safe assets, documentation and release

**Files:**
- Modify: rectangular WebP files under `assets/top-down/items/gear/`
- Modify: `tools/top-down-items/image-processing.mjs`
- Modify: `tests/top-down-item-processing.test.mjs`
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.211.js`

**Interfaces:**
- Validation derives expected dimensions from optional manifest footprint while retaining `512×512` for ordinary assets.
- Versioned forwarder contains only `import "./main.js";`.

- [ ] **Step 1: Write and verify RED asset-validation tests** for approved rectangular dimensions, alpha/bbox safe edges and unchanged square validation.
- [ ] **Step 2: Implement generalized dimension-aware QA**, mechanically repack rectangular furniture assets without scaling opaque pixels, update manifest hashes, then run `node tools/top-down-item-assets.mjs validate`.
- [ ] **Step 3: Update the storage/top-down passport section**, bump module version and cache-busting import suffixes, and create the versioned forwarder.
- [ ] **Step 4: Run focused tests, then the complete AGENTS.md checks once**, review `git diff --check`, `git diff --stat` and substantive diff.
- [ ] **Step 5: Stage only task files, commit, and push `lich_branch`**; explicitly report live QA as deferred.
