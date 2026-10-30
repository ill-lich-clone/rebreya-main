# Ammunition Family Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. This implements the user's concrete correction to the already approved feature.

**Goal:** Accurate cartridge placement, weapon-appropriate loading art, and clear saved-ammunition state.
**Architecture:** Pure UI family/geometry helper feeds existing app; canonical combat owner handles count default. No new persistence owner.
**Tech Stack:** JS ESM, Handlebars/SVG/CSS, generated PNG assets, Foundry13/dnd5e5.2.5, Node tests.
**Spec:** docs/superpowers/specs/2026-10-30-ammunition-presentation-design.md

## Global Constraints

Only lich_branch, retain all actual saved/explicit quantities, authored formulas, 1/3/6 costs, damage once, implant, OWNER API and presets. Draft controls never write Documents. Only deliberate count change: missing state is empty instead of phantom-full; never reset saved scalar/typed count. No sockets/journals/queues.

## Review Focus

- Saved scalar1 versus missing state: preserve real round, no automatic inventory refund/type guess.
- Primitive shotgun-like weapons: primitive presentation wins over shotgun ammo family.
- Small magazines1/2 and capacities6/18/24: correct number of slots, no overlap or curved AK on primitive.
- Same contour/sprite center and bounds for each round and group, independent of ammo tone.
- Actual unknown reservoir remains loadable, while explanation refers to the right saved count.

### Task1: Saved count/default and copy

Files: attack-service.js; combat owner tests; app/hbs wording tests.
Interfaces: existing #resolveFirearmAmmoState and planWeaponAmmoReconfiguration treat no stored/explicit current as0; DTO retains count and legacy semantics.

- [x] RED: no-state editor is empty and write-free; stored scalar1 remains legacy1; explicit override retained; no phantom modernization refund.
- [x] GREEN: change only absent-count fallback, retain all saved/explicit states. Explain unknown saved count plainly in app.
- [x] Run combat/magazine/weapon-mod owner suites; preserve meaningful existing quantity expectations.

### Task2: Visual families and exact packing

Files: new scripts/ui/ammunition-magazine-visuals.js; app/hbs/scoped CSS; assets/ammunition lead-ball/shotgun art; focused visual tests.
Interfaces: pure resolveMagazinePresentation(weapon,capacity) chooses kind/assets/labels; buildCartridgeLayout returns per-slot coordinates and group bands using the actual frame boundaries. Existing buildMagazineView integrates without new writes.

- [x] Generate/inspect two distinct assets; measure visible bounds read-only for correct sprite centering.
- [x] RED: family field cases (including primitive shotgun precedence), exact edge-derived alignment and packing, small capacities, slot counts.
- [x] GREEN: implement helper, physical frame/appropriate primitive charges and shotgun chambers/tube; retain drag/click/keyboard/fill/reorder/presets.
- [x] Run focused tests and live disposable fixtures, inspect all families plus narrow window, cancellation and exact consumption/refund.

### Task3: Release

- [x] Update passport/README/spec/plan with actual verification and limitations.
- [x] Bump release/cache and forwarder; full tests and JS/JSON/diff checks, affected reruns after fixes.
- [ ] Fresh whole-change review; fix Important findings with RED/GREEN.
- [ ] Explicitly stage own files, commit/push lich_branch, verify state and report paths/commit/results.

## Verification evidence

- Focused: `node --test tests/ammunition-magazine-app.test.mjs tests/combat-attack-service.test.mjs tests/weapon-mod-mutations.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` — 206 passed, 0 failed.
- Full: `node --test tests/*.test.mjs` — 5373 passed, 0 failed, 1 skipped (5374 total).
- `node --check`: 1132 JS/MJS, no errors. JSON parse: 65, no errors. `git diff --check`: clean.
- Live Foundry 13.351/dnd5e 5.2.5, testovyj3, GM CODEX, fixture TCO2a0yN6rIDRpq0: rifle24, primitive1/6, shotgun2/6 render correct counts/art. True native drag + Enter selection + preset blur/click confirmed. Whole fixture unchanged during draft/cancel. Load fire6+cold18: stock20/20→14/2; unload→20/20; last pattern→14/2; second unload→20/20.
- Saved legacy1: explicit GM type confirmation does not spend stock19; unload returns exactly1→20. Real saved scalar count remains intact until confirmation.
- Window540×740: no horizontal overflow, footer inside window; screenshots inspected. Browser reported zero console errors; Foundry deprecation warnings preexist.
- Source Actor9l5K3URGU5nvhy13 remained byte-equivalent to its initial toObject snapshot throughout; original stock musket19/rifle10/cold20/fire20 unchanged. Own fixture and its message removed.
- Ignored screenshots/logs: `.superpowers/sdd/2026-10-30-ammunition-presentation/` (rifle-final, arkebuza-final, mnogostvol-nyy-kremnevyy-pistolet-final, dvukhstvol-nyy-drobovik-final, drobovik-final, legacy-final, narrow-final).
