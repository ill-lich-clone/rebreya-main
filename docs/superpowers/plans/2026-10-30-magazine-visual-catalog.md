# Physical Magazine and Ammunition Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution. User requested implementation and supplied the physical magazine reference; preserve the previously approved mechanics.

**Goal:** Restore actual special-ammo profiles and provide a playable curved magazine editor.
**Architecture:** Preserve native ApplicationV2 and canonical combat/data owners; exact catalog projection repairs missing metadata in memory; no new mutation infrastructure.
**Tech Stack:** JavaScript ESM, Handlebars/CSS, generated transparent art, Foundry13/dnd5e5.2.5, Node tests.
**Spec:** docs/superpowers/specs/2026-10-30-magazine-visual-catalog-design.md

## Global Constraints

Only lich_branch; preserve all existing quantity/formula/capability contracts. Draft edits never write Documents. Groups1/3/6 homogeneous; bonus once. No new socket/journal/queue or separate magazine Item. Photo dictates curved shape; previous tray concept rejected. Source items use exact stable IDs; never infer legacy type or overwrite authored non-null profile.

## Review Focus

- Existing v2 source keys after missing-profile projection: preserve ordered references and exact refunds.
- Legacy full magazine: show unknown rounds and explicit GM resolution without fake zero-stock choice.
- Native activity passes a clone: keep canonical owned Item routing.
- Small capacities, partial tail and shortage: correct clickable slots/group counts without writes.
- Existing source flags/formulas/custom profile: preserve authored overrides and snapshot semantics.

### Task1: Restore catalog profiles and exact read projection

Files: normalizer.js/importer.js, ammunition-compatibility.js, ammunition-magazine.js, attack-service.js; affected owner tests.
Interfaces: normalizeGear preserves detached profiles; resolveAmmunitionProfile(item,{gearById}?) resolves stored-before-catalog; isCompatibleAmmunition/captureAmmunition accept optional catalog context. Service wrappers supply its canonical repository model; old known source references are projected consistently.

- [x] RED: test actual raw maz rows through normalizeEconomyDataset and native factory; require all compatibility and 1d6 fire/cold for normalized IDs. Test all three detached profiles.
- [x] RED: existing owned null-profile ammo shows in editor without writes, authored override wins, exact refund after known old-source projection; legacy remains unknown.
- [x] GREEN: preserve fields, extend pure projection and service integration minimally; retain mechanical budgets and native ownership.
- [x] Run focused normalizer/factory/compatibility/magazine/combat/weapon-mod tests.

### Task2: Physical interactive magazine

Files: existing ammunition-magazine-app.js/hbs and scoped CSS; new assets/ammunition/ art; tests/ammunition-magazine-app.test.mjs.
Interfaces: existing MagazineDraft owns local group selection/fill/move/presets; App adds selectedGroup and local card→group drop, not a persistence owner.

- [x] Use the supplied physical-magazine photo as clipped shell artwork and generate a separate cartridge; inspect before integrating. The technical cutaway generation was refused; a generated exterior alpha asset was unusable and was moved to ignored scratch, never shipped.
- [x] RED: group click/drop selection uses current 1/3/6 contract, invalid/shortage leaves data untouched, preset/cancel remains local; hidden legacy stock does not lose loaded source references.
- [x] GREEN: render separate cartridges clipped inside curved shell, group highlight and next-attack label; stock uses source icons/full names/counts; click and keyboard alternative to drag; preserve all existing controls and busy/error behavior.
- [x] Run focused draft/consumer tests. Live actual native reload, select/drop/fill/preset/cancel/confirm/unload on disposable fixture; no production stock writes. Compare photo and live screenshot; inspect text/geometry/asset framing/palette/footer and narrow layout.

### Task3: Release and delivery

- [x] Update passport, README and this plan with exact results and limitations.
- [x] Bump release/cache URLs and forwarder; retain old forwarders.
- [x] Full tests once; JS/JSON/diff checks, affected reruns after fixes; independent whole-change review and fix Important findings with RED/GREEN.
- [x] Review own diff, explicitly stage task files, commit/push lich_branch, verify synchronized branch and retained unrelated work.

## Execution record (in progress)

Root cause verified in actual world testovyj3: Actor9l5K3URGU5nvhy13 weapon qC5zGhXCJUb3C4Xh required rebreyaRifle; fire/ice Items and world.rebreya-gear records had firearmBullet with ammunition:null. Raw file had compatibility:[all], but normalized model omitted all three profile fields. Fixed at the owner, not via item-name matching. Exact catalog projection exposes old owned Items without data writes; authored profile wins. A known old magazine source is rebased with its refs so unload/refund still matches the correct stack. No new GM/socket/receipt/queue.

Three initial regressions failed before code. An additional detached-capture identity regression failed before correction; native empty-effects fixture remains explicit and quantity/rollback expectations unchanged. Final affected suite199/199; UI7/7 after the native template-extension regression (query in .hbs path rejected by Foundry) RED→GREEN. Runtime template uses the canonical socket-loaded .hbs path; script/style owner caches are1.5.31. User’s parallel equipment work advanced HEAD to054c494f/release1.5.30 and was retained.

Visual implementation uses the exact supplied magazine photo with native SVG silhouette/cutaway clips, code-native slot state/controls, and generated transparent cartridge. The earlier tray concept was explicitly rejected and is not an accepted comparison target. First live render confirmed all three real stock types (10/20/20), 24 legacy slots, and no new console errors. Native geometry exposed an intrinsic SVG grid-size overflow and footer clipping; SVG min-size/row sizing and compact legacy layout corrected. Final drag/cancel/confirm/damage/resize visual acceptance remains in progress. PC crash interrupted browser; source/tests survived. User asked to continue; server currently awaits host world launch at /auth, question sent while independent checks continue.

## Final verification and live acceptance

Independent review found two Important cases. Both were reproduced RED before their corrections: authored ointment profile damage/manual text was being replaced by the default, and positive legacy implant stock was hidden with the fake zero-stock row. GREEN affected suite156/156; final owner suite212/212. No Critical findings or deferred minors. Stored/native authored damage retains priority, default source ointments still add1d6 once, and real unknown implant stock remains loadable without guessing its type.

Full command `node --test tests/*.test.mjs`: 5366 passed,0 failed,1 skipped (5367 total), full-reviewed.log. Syntax `node --check` for1130 tracked JS/MJS passed; JSON65 passed. Affected UI syntax and8 UI tests repeated after final header/copy polish; focused-final.log212/212. `git diff --check` passed. The earlier four full-run failures were three stale release/style cache assertions and one exact normalized schema fixture needing the three deliberately preserved null fields; source behavior/quantity assertions were retained.

Live Foundry13.351/dnd5e5.2.5, GM in testovyj3. Actual original Actor and compiled compendium were inspected; source stock10/20/20, old loaded count24. A disposable clone was used for writes. Explicit GM mapping of old unknown charges remained local; clear→button place6fire→real mouse drag6cold→preset save→cancel preserved the entire serialized Actor unchanged. Repeating and confirming produced12 loaded, fire/cold20→14 each, and refunded the24 explicitly identified old standard rounds (10→34). Two actual native automatic attack rolls consumed6 then6, leaving0; inventory did not debit again. Late native damage from originating cards after empty magazine: 2d8+0 piercing plus exactly1d6 fire, then2d8+0 piercing plus exactly1d6 cold. Last-pattern button reloaded12 in one click (14→8 each); actual native unload activity returned exactly6 of each (back to14). Preset persisted only on confirmation. Fixture Actor and its2 attack messages removed; original source inventory/composition untouched. Live player login was not exercised; native OWNER/no-GM contracts remain in focused tests.

Visual fidelity against the user-provided curved-magazine photo was checked with view_image on the reference and latest actual Foundry screenshots, not the rejected tray concept. Playwright fallback used because no Foundry/Browser connector was exposed. Standard screenshot helper timed out once; native locator.screenshot with stable DOM/animations disabled produced live-final.png and live-narrow.png in ignored task evidence. Checked physical silhouette/diagonal floor plate, crop/asset treatment and visible cartridge positions, heading/body/control typography, dark/copper palette with fire/cold cues, full names/counts/manual labels, spacing and footer geometry. Native window960x760 in viewport1500x950 fits the controls; width540 stacks columns and docks controls without horizontal overflow (528/528), footer bottom809 inside window bottom810. Narrow keyboard placement also worked and cancellation preserved Actor unchanged. Copy changes are limited to the approved workflow labels/counts and explicit legacy/manual explanations. Intentional deviation from the opaque photo is the software cutaway showing cartridges; all interactive elements remain native code. No material mismatch or clipped primary controls remains in the tested states. Console0 errors; existing startup warnings were not attributed to this task.

Final cleanup/readback: QA Actor absent, QA message count0; original raw firearmAmmoState remains absent (legacy resolved count24), source inventory still10/20/20. Managed compendium fire ammunition now actually contains compatibility:[all]. Native app console0errors. Final UI screenshot uses a neutral pointer state; narrow footer reaches809 within810 window bound.
