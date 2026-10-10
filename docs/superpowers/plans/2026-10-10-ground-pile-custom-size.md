# Ground Pile Custom Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep manually set dimensions and texture scales when updating existing Rebreya ground tokens.

**Architecture:** Extend the existing groundPile metadata with `autoLayout:{width,height,scaleX,scaleY}`, `customFootprint` and `customTextureScale`. The existing authoritative create/write owner detects deviations before writing and preserves the corresponding current Token fields; legacy tokens compare against the prior presentation layout. No new hook, socket command or UI.

**Tech Stack:** Foundry VTT 13, native JavaScript ESM, Node test runner, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-10-ground-pile-custom-size-design.md` (approved by user).

## Global Constraints

- Reuse current clean `lich_branch`; fetch and verify main/remote branch before edits. Commit/push only lich_branch, no force push.
- Preserve quantities, currency totals, formulas, budget spending, permissions, receipts/recovery, rotation and physical-container contracts.
- Preserve current width/height/x/y for custom footprint, current scaleX/scaleY for custom scale. They are independent and persist across refresh/restart.
- New tokens keep previous defaults; existing automatic category transitions retain center and cardinal furniture compensation.
- Runtime release becomes 1.4.371 if no intervening version change; create forwarding entrypoint and synchronize affected cache URLs.

## Review Focus

1. Legacy manually resized coin token without layout metadata retains its rectangle and position.
2. Asymmetric texture scale survives category/denomination changes independently of footprint.
3. Repeated refresh/restart and edits back to a canonical size do not revoke custom sizing.
4. Untouched rectangular furniture/cardinal rotations retain automatic compensation, and untouched item/category transitions still resize.
5. Invalid/missing metadata and startup repair do not corrupt geometry or money; compare positive finite dimensions with a small floating-point tolerance.

### Task 1: Preserve custom geometry in the existing owner

**Files:** Modify `scripts/data/storage-ground-pile-service.js`; test `tests/storage-ground-pile-service.test.mjs`.

**Interfaces:** Private `automaticPresentationLayout(presentation,rows,coins,rotation) -> {width,height,textureScale,rotation}` reuses `presentationLayout()` and existing tiny/container/category rules for legacy references. Private `groundPileSizing(token,groundFlag,previousLayout,nextLayout) -> {autoLayout,customFootprint,customTextureScale}` resolves independent sticky customization; validate dimensions/scales as finite positive numbers and compare with tolerance 1e-6. Existing `#writePile()` consumes this result, omits custom geometry fields from its update and persists metadata atomically alongside storage flags. Creation seeds metadata with the actual dimensions/scales applied, including prototype values where already used. No public signature changes.

- [ ] Add regressions through the existing createHarness/service APIs: create pp100 pile, manually set `{width:2,height:3,x:125,y:275}`, refresh pp50, merge gp1000 and refresh again; assert those four fields unchanged and pp/gp exact. Repeat without autoLayout metadata and after a new service instance. Manually edit back to 0.5×0.5 after first detection, then transition category: manual footprint still wins.
- [ ] Add independent-scale regression: set `{scaleX:2,scaleY:1.25}` on a normal coin token, transition to mixed ordinary pile; assert scales unchanged while untouched footprint follows automatic size. Conversely custom footprint alone allows automatic scale changes. Add startup repair fixture preserving custom rectangle/scales and money.
- [ ] Pin unchanged automatic single→weapon stack→single widths 0.5→1→0.5, center; preserve existing furniture orientation/compensation tests. Add invalid metadata fallback and near-equal 1e-7 precision fixture that remains automatic; custom positive dimensions below0.5 are retained. Assert actual document fields, not just metadata.
- [ ] Run `node --test tests/storage-ground-pile-service.test.mjs`, confirm new user-visible assertions fail before implementation.
- [ ] Implement the two private helpers and conditional writes. Seed creation metadata from effective token data; retain automatic sizing/rotation branches. Preserve custom axes as a pair within footprint or scale group, and current coordinates verbatim when footprint is custom.
- [ ] Run `node --test tests/storage-ground-pile-service.test.mjs tests/storage-ground-pile-layout.test.mjs tests/storage-pile-presentation.test.mjs tests/storage-socket.test.mjs`; require zero failures. Review all spec requirements against tests before release.

### Task 2: Document, verify and ship the same change

**Files:** Update `README.md`, `docs/function-passport.md`, `module.json`, affected runtime cache importers and manifest/composition expectations; create `scripts/main-1.4.371.js` importing only `./main.js`. Update this plan with verification results.

**Interfaces:** Preserve existing public API. Optional groundPile sizing metadata is backwards-compatible; document its fields/owner/data flow and profile tests in the passport. All runtime importers use one canonical fresh URL for every changed dependency.

- [ ] Document persistent custom footprint/scale and legacy fallback. Bump manifest/forwarder/style cache and affected import graph, updating focused release assertions without weakening them.
- [ ] Run full `node --test tests/*.test.mjs`; require fail0 and record pass/skipped counts. Run `git diff --check`, `node --check` for every tracked JS/MJS plus new forwarder, and parse tracked JSON with PowerShell `ConvertFrom-Json`; require zero errors.
- [ ] Attempt existing Foundry bridge only if its connection can be reached; otherwise report live QA unperformed. Live check: enlarge coin pile, partially claim/merge, reload, verify dimensions/scales/content; untouched category transition remains automatic. Do not invent a runtime version or world URL.
- [ ] Obtain one fresh independent final review after execution; resolve findings with failing/passing regressions. Review meaningful diff/stat/check, stage only task files, commit `fix: preserve manually resized ground pile tokens`, push `git push -u origin lich_branch`, report version/commit/spec/plan and verification.

## Self-review and handoff

Both tasks cover the approved spec; all five review-focus inputs have explicit regressions. Use native execution here: one behavior owner and one atomic release, so splitting implementation provides little value. Bounded Gemini analysis recommended snapshot comparison inside the existing owner; its claims were checked against the current create/write paths. No implementation changes have started. Await user review of this plan before executing.
