# Alchemy Healing and Bombs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the nine basic healing potions and all 63 bomb items with target-correct healing, visual bomb placement, MIDI/DAE family effects, and safe scene lifecycle.

**Architecture:** `alchemy-automation.js` owns pure catalog-to-dnd5e activity definitions. `alchemy-bomb-runtime-service.js` owns local workflow state, sheet minimization, placement, and family result dispatch; a typed socket adapter owns privileged scene mutations. Existing alchemy sync, combat hooks, status service, durability service, and composition root remain the canonical integration points.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5 activities and public token placement, Midi-QOL 13.0.61, DAE 13.0.27, Status Counter 3.0.4+, Node test runner.

**Spec:** `docs/superpowers/plans/2026-09-29-alchemy-healing-bombs-design.md`

## Global Constraints

- Work only on `lich_branch`; preserve unrelated work and push without force.
- Do not migrate unmanaged or copied alchemy Items.
- Healing always uses exactly the selected target and never silently falls back to self.
- Cancelled/failed bomb placement consumes nothing and restores a sheet minimized by this workflow.
- Scene writes run through an authorized typed command; UI/hooks do not mutate privileged state directly.
- Bump `module.json` and the versioned forwarder for every client-delivered change.

## Review Focus

- A user cancels the crosshair after the character sheet was minimized: no consumption/documents and the sheet reopens.
- A character sheet started minimized or closed: runtime must not maximize or open it.
- Two players throw bombs concurrently: workflow state and cleanup remain isolated by workflow/operation ID.
- The active GM changes during placement: typed command fails safely without consuming the bomb.
- A family effect fails after damage: transient documents are cleaned and the failure is visible rather than silently corrupting state.

---

### Task 1: Pure alchemy activity projection

**Files:**
- Create: `scripts/data/alchemy-automation.js`
- Modify: `scripts/data/alchemy-compendium.js`
- Test: `tests/alchemy-compendium.test.mjs`

**Interfaces:**
- Produces: `getAlchemyAutomationDefinition(product)`, `buildAlchemyActivities(product)`, and `buildAlchemyConsumableUses(product)`.
- Consumes: normalized rows from `data/alchemy-products.json` and existing stable document ID helpers.

- [x] Add failing tests for all nine healing formulas, one selected creature target, one-use auto-destroy consumption, all 63 bomb save/damage/radius definitions, stable activity IDs, and zero automation for all other rows.
- [x] Run `node --test tests/alchemy-compendium.test.mjs` and confirm failures are caused by missing automation.
- [x] Implement the pure projection and include automation fields in the managed signature.
- [x] Update managed sync so desired activities are written while stale foreign automation is removed only from managed catalog documents.
- [x] Run the focused test to green.

### Task 2: Bomb placement and sheet lifecycle

**Files:**
- Create: `scripts/combat/alchemy-bomb-runtime-service.js`
- Create: `tests/alchemy-bomb-runtime-service.test.mjs`

**Interfaces:**
- Produces: `withMinimizedActorSheet(actor, operation)`, `AlchemyBombRuntimeService.prepareWorkflow(workflow)`, `completeWorkflow(workflow)`, `abortWorkflow(workflow)`, and `handleSocketMutation(payload, context)`.
- Consumes: dnd5e `TokenPlacement.place()`, canvas geometry, actor/item/activity flags, and injected scene mutation/request functions.

- [x] Add failing tests for minimize/restore on success, cancellation, and error; preserve initially minimized/closed sheets; placement uses top-down art; cancellation creates nothing; exact token/template linkage and instant/sticky cleanup.
- [x] Run the focused test and confirm the expected missing exports.
- [x] Implement placement sessions keyed by workflow ID with `try/finally` sheet restoration and idempotent cleanup.
- [x] Run the focused test to green.

### Task 3: Authorized commands and MIDI/DAE family results

**Files:**
- Create: `scripts/integrations/alchemy-bomb-socket.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/combat/alchemy-bomb-runtime-service.js`
- Test: `tests/alchemy-bomb-socket.test.mjs`
- Test: `tests/alchemy-bomb-runtime-service.test.mjs`
- Test: affected status/durability focused tests as required.

**Interfaces:**
- Produces: `registerAlchemyBombSocketCommand(moduleApi, options)`, `isValidAlchemyBombMutationPayload(payload)`, and hook registration through `registerCombatHooks(moduleApi)`.
- Consumes: `SocketCommandBus`, `CombatStatusService.setStatus/applyDecayingDamage`, durability owner, MIDI workflow save sets, and Foundry Region/MeasuredTemplate public document APIs.

- [x] Add failing command tests for exact payload validation, actor ownership authorization, scene/source-token matching, keyed serialization, and idempotent cleanup.
- [x] Add failing runtime tests for each family on failed/successful saves, fixed DC, half damage data, source-relative expiry, and sticky-zone entry/turn-start behavior.
- [x] Implement the typed command and hook bridge using public installed-version APIs only.
- [x] Implement family dispatch through canonical status/durability services; do not duplicate their rules in UI code.
- [x] Run all focused tests to green.

### Task 4: Composition, documentation, version, and verification

**Files:**
- Modify: `scripts/main.js`
- Modify: `README.md`
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-<new-version>.js`
- Remove: prior versioned forwarder after references are updated.
- Test: `tests/main-composition-root.test.mjs`
- Test: `tests/module-manifest.test.mjs`

**Interfaces:**
- Consumes: services and registration functions from Tasks 1-3.
- Produces: runtime construction, socket registration, combat hook registration, documented current contract, and a cache-busting module entrypoint.

- [x] Add failing composition/manifest assertions for the runtime service, socket registration, and versioned forwarder.
- [x] Wire dependencies in `scripts/main.js`, update README/passport, bump the manifest version, and create the matching forwarder.
- [x] Run focused tests, then `node --test tests/*.test.mjs`, `git diff --check`, syntax-check every tracked JS/MJS file, and parse every tracked JSON file.
- [ ] Perform live Foundry GM/player QA for healing target selection, bomb cancel/success, sheet restore, instant cleanup, sticky persistence, and console warnings; if the bridge is unavailable, report live verification as unavailable rather than inferred.
- [ ] Inspect `git diff --stat` and the substantive diff, stage only task files, commit, and push `lich_branch`.
