# Grapple Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить управляемый захват, ручное размещение схваченного и атомарное следование целей за захватчиком через world-макросы Rebreya.

**Architecture:** `GrappleAutomationService` владеет связями и привилегированными use cases, `held-items` — резервами рук, чистые helpers — естественной досягаемостью и геометрией. Клиентские hooks/CPR preview только собирают намерение; active GM повторно валидирует exact token UUID и выполняет mutation через typed commands.

**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, Node `node:test`, `chrisPremades.Crosshairs`, существующие `SocketCommandBus` и `WorldMutationCoordinator`.

**Spec:** `docs/superpowers/specs/2026-08-28-grapple-automation-design.md`

## Global Constraints

- Проверка Захвата, допустимый размер цели и стоимость движения не автоматизируются.
- Естественная досягаемость не включает оружие, `system.range.reach` и `lchReach`.
- Не вызывать CPR `Teleport.target`; использовать только `chrisPremades.Crosshairs`.
- Player не пишет target Actor/Token или world Macro/Folder локально.
- Одна цель имеет не более одной управляемой Rebreya-связи; один источник может иметь несколько связей по числу рук.
- Групповой перенос сохраняет relative `x/y` и атомарно отклоняется при стене или границе сцены.
- Новые/изменённые методы документируются в разделе 16 `docs/function-passport.md`; macro API — в `README.md`.
- Исходники, JSON и русские строки сохраняются в UTF-8.

---

### Task 1: Общая естественная досягаемость и резервы рук

**Files:**
- Create: `scripts/combat/natural-reach.js`
- Modify: `scripts/combat/attack-service.js`
- Modify: `scripts/integrations/held-items.js`
- Modify: `tests/combat-attack-service.test.mjs`
- Modify: `tests/held-items.test.mjs`
- Test: `tests/natural-reach.test.mjs`

**Interfaces:**
- Produces: `getNaturalReachFeet(actor): number`.
- Produces: `HAND_RESERVATIONS_FLAG`, `normalizeHandReservations(value)`, `getActorHandReservations(actor)`, `buildActorHandReservationsUpdate(reservations)`.
- Preserves: `CombatAttackService` final melee reach = natural reach + weapon-only bonus.

- [ ] **Step 1: Write failing natural-reach tests**

Create table-driven assertions with hand-derived literals:

```js
test("natural reach combines size, racial, and active Rune Knight bonuses without weapon data", async () => {
  const { getNaturalReachFeet } = await import("../scripts/combat/natural-reach.js");
  assert.equal(getNaturalReachFeet(makeActor({ size: "tiny" })), 0);
  assert.equal(getNaturalReachFeet(makeActor({ size: "lg" })), 10);
  assert.equal(getNaturalReachFeet(makeActor({ size: "huge", racialReachBonusFeet: 5, runeReach: 5 })), 25);
  assert.equal(getNaturalReachFeet(makeActor({ size: "huge", racialReachBonusFeet: 5, runeReach: 5, disabled: true })), 20);
});
```

- [ ] **Step 2: Write failing hand-reservation tests**

Extend `tests/held-items.test.mjs` so explicit race/Actor `hands: 0` returns zero slots, missing flags still return two, and a grapple reservation removes only its exact slot from `getFreeHandSlots()`.

```js
assert.equal(getActorHandCapacity(actorWithExplicitZeroHands), 0);
assert.deepEqual(getFreeHandSlots(actorWithReservation("left")), ["right"]);
assert.deepEqual(buildActorHandReservationsUpdate([{
  linkId: "link-1",
  kind: "grapple",
  handSlot: "left",
  sourceTokenUuid: "Scene.scene.Token.source",
  targetTokenUuid: "Scene.scene.Token.target"
}]), {
  "flags.rebreya-main.handReservations": [{
    linkId: "link-1",
    kind: "grapple",
    handSlot: "left",
    sourceTokenUuid: "Scene.scene.Token.source",
    targetTokenUuid: "Scene.scene.Token.target"
  }]
});
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
node --test tests/natural-reach.test.mjs tests/held-items.test.mjs tests/combat-attack-service.test.mjs
```

Expected: missing module/exports and explicit-zero/reservation assertions fail for the named production gaps.

- [ ] **Step 4: Implement minimal shared reach helper**

`natural-reach.js` must iterate collection-like effects, ignore disabled/suppressed effects, require `runeKnight.automation === "giant-might-form"` and `form.appliedActorSize === "huge"`, then return:

```js
Math.max(0, getCharacterSizeRule(actor?.system?.traits?.size).baseReachFeet + racialBonus + runeBonus)
```

Replace the duplicated private Actor/Rune logic in `attack-service.js` with `getNaturalReachFeet(actor)`. Keep `#resolveWeaponReachBonusFeet()` separate and ensure the attack path adds it exactly once.

- [ ] **Step 5: Implement hand reservations and explicit zero**

Distinguish an absent hand-capacity flag from an explicit numeric zero. Normalize reservations to detached unique records with exact `{ linkId, kind, handSlot, sourceTokenUuid, targetTokenUuid }`, discard malformed entries, and include valid reserved slots in `getOccupiedHandSlots()`. Reservation placeholders must expose a useful name such as `Захват`, so the existing equip menu never presents them as an unnamed Item replacement.

- [ ] **Step 6: Verify GREEN**

Run the Step 3 command. Expected: all selected tests pass, including existing weapon-reach assertions.

- [ ] **Step 7: Commit**

```powershell
git add -- scripts/combat/natural-reach.js scripts/combat/attack-service.js scripts/integrations/held-items.js tests/natural-reach.test.mjs tests/held-items.test.mjs tests/combat-attack-service.test.mjs
git commit -m "feat(combat): share natural reach and reserve hands"
```

### Task 2: Управляемая папка и два world-макроса

**Files:**
- Create: `scripts/combat/grapple-macro-service.js`
- Test: `tests/grapple-macro-service.test.mjs`

**Interfaces:**
- Produces: `GrappleMacroService.syncManagedDocuments(): Promise<{ skipped, folder, macros }>`.
- Produces: `buildGrappleMacroData(folderId)` and `buildMoveGrappledMacroData(folderId)` with commands fixed by the spec.
- Consumes later: composition root calls `syncManagedDocuments()` only on active GM.

- [ ] **Step 1: Write failing managed-document tests**

Test real service behavior with in-memory Folder/Macro document fakes:

```js
assert.deepEqual(buildGrappleMacroData("folder-1"), {
  name: "Захват",
  type: "script",
  scope: "global",
  command: "await game.rebreyaMain?.toggleGrapple?.();",
  folder: "folder-1",
  ownership: { default: 1 },
  flags: { "rebreya-main": { managed: true, sourceId: "grapple-macro" } }
});
```

Cover: inactive client skip; managed folder reuse; deterministic reuse of the oldest exact user Macro-folder `Ребрея`; creation when absent; create/update/no-write for both macros; unmanaged same-name macro preservation.

- [ ] **Step 2: Verify RED**

Run `node --test tests/grapple-macro-service.test.mjs`.

Expected: import fails because the service does not exist.

- [ ] **Step 3: Implement managed synchronization**

Follow the stable-flag/idempotent update pattern in `map-object-token-service.js`, but inject `Folder` and `Macro`. Use `CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ?? 1` for player-visible macros. Reuse only a folder whose `type === "Macro"` and `name === "Ребрея"`; never update or mark a reused user folder as managed.

- [ ] **Step 4: Verify GREEN**

Run `node --test tests/grapple-macro-service.test.mjs`. Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/combat/grapple-macro-service.js tests/grapple-macro-service.test.mjs
git commit -m "feat(combat): sync grapple world macros"
```

### Task 3: Геометрия footprint и CPR preview

**Files:**
- Create: `scripts/combat/grapple-geometry.js`
- Create: `scripts/combat/grapple-placement-preview.js`
- Test: `tests/grapple-geometry.test.mjs`
- Test: `tests/grapple-placement-preview.test.mjs`

**Interfaces:**
- Produces: `tokenFootprint(token, position?)`, `grapplePlacementDistanceFeet(source, target, position, grid)`, `validateGrapplePlacement(options)`.
- Produces: `GrapplePlacementPreview.choose({ sourceToken, targetToken, reachFeet }): Promise<{ cancelled, x, y }>`.
- Validation result: `{ valid, reason, x, y }`, where `reason` is `"outside-reach"`, `"outside-scene"`, or `"wall-collision"`.

- [ ] **Step 1: Write failing geometry tests**

Use literal grid fixtures for 100 px / 5 ft and cover 1×1, 2×2, rectangular and fractional footprints. Include the approved large-target case: a 2×2 target center may lie 10 ft from a Medium source when its nearest marker edge is within the source's 5 ft natural reach. Assert scene bounds and an injected wall-collision predicate independently.

- [ ] **Step 2: Write failing preview tests**

Inject a fake public Crosshairs class and overlay adapter. Assert marker config uses target texture, `size = grid.distance * max(width, height) / 2`, and CPR-compatible resolution (`1` for odd, `-1` for even footprint). Assert cancellation returns without mutation and overlay cleanup occurs on success, cancellation, and thrown error.

- [ ] **Step 3: Verify RED**

Run:

```powershell
node --test tests/grapple-geometry.test.mjs tests/grapple-placement-preview.test.mjs
```

Expected: both imports fail.

- [ ] **Step 4: Implement pure geometry**

Normalize finite positive token width/height, grid size/distance and candidate top-left coordinates. Measure from the source reference point to the nearest point of the candidate target rectangle, convert pixels to scene feet, and compare with `reachFeet`. Keep token-overlap out of validation. Accept injected `sceneRect` and `checkCollision` so unit tests do not require canvas.

- [ ] **Step 5: Implement CPR preview adapter**

Use only `globalThis.chrisPremades?.Crosshairs.showCrosshairs`. Draw/destroy the yellow/red PIXI boundary through an injected overlay factory. Track the current snapped candidate, label current reach, and reject a confirmed invalid result. If CPR is absent, throw an error with code `crosshairs-unavailable` for the public API to translate into a Russian notification.

- [ ] **Step 6: Verify GREEN**

Run the Step 3 command. Expected: all geometry and preview tests pass.

- [ ] **Step 7: Commit**

```powershell
git add -- scripts/combat/grapple-geometry.js scripts/combat/grapple-placement-preview.js tests/grapple-geometry.test.mjs tests/grapple-placement-preview.test.mjs
git commit -m "feat(combat): add grapple placement preview"
```

### Task 4: Связи, статус, rollback и reconciliation

**Files:**
- Create: `scripts/combat/grapple-automation-service.js`
- Test: `tests/grapple-automation-service.test.mjs`

**Interfaces:**
- Constructor consumes `{ coordinator, commandBus, placementPreview, fromUuid, randomId, notify, isActiveGmClient }`.
- Produces: `toggle({ sourceTokenUuid, targetTokenUuid, operationId })`.
- Produces: `place({ sourceTokenUuid, targetTokenUuid, x, y, operationId })`.
- Produces: `drag({ sourceTokenUuid, x, y, operationId })`.
- Produces: `releaseAndMove({ targetTokenUuid, linkId, x, y, operationId })`.
- Produces: `requestDragFromTokenUpdate({ sourceTokenUuid, x, y, operationId })` and `requestReleaseAndMove({ targetTokenUuid, linkId, x, y, operationId })`, which choose direct active-GM execution or the matching typed command.
- Produces: `handleManagedEffectDeleted(effect)`, `handleTokenDeleted(token)` and `reconcileScene(scene)`.

- [ ] **Step 1: Write failing link lifecycle tests**

Build complete TokenDocument/Actor/ActiveEffect fakes with real update/create/delete side effects. Assert first-free-slot selection, `grappled` metadata, mirrored token flag, same-link toggle cleanup, multiple targets on separate hands, zero-hand rejection, and refusal to overwrite another source link.

- [ ] **Step 2: Write failing movement and recovery tests**

Assert `place()` revalidates live natural reach; `drag()` applies one `scene.updateEmbeddedDocuments("Token", updates, options)` containing source and all targets with the same delta; invalid participant causes zero writes. Inject failures after each create/update step and assert exact prior state restoration. Assert reconciliation removes only managed orphan pieces and is idempotent.

- [ ] **Step 3: Verify RED**

Run `node --test tests/grapple-automation-service.test.mjs`.

Expected: import fails.

- [ ] **Step 4: Implement normalized state helpers and serialized operations**

Use `WorldMutationCoordinator.runIdempotent()` with keys `grapple-link:<linkId>` and `grapple-source:<sourceTokenUuid>`. Maintain a bounded insertion-ordered `operationId -> serialized fingerprint` map with the same 256-entry limit as completed coordinator results: an existing operation ID with another fingerprint throws `operation-fingerprint-mismatch` before entering the queue. Resolve every UUID fresh inside the queued operation.

- [ ] **Step 5: Implement create/release transaction**

Snapshot Actor reservations, target token grapple flag, and matching managed effect before writes. Create a dedicated managed ActiveEffect with `statuses: ["grappled"]`, the dnd5e grappled icon/label and exact Rebreya link metadata; do not reuse or modify an unmanaged `grappled` effect. On error, restore snapshots in reverse order; collect rollback failures into `AggregateError`.

- [ ] **Step 6: Implement place, drag, release-and-move and reconciliation**

Pass internal update options under `options[MODULE_ID].grappleBypass = true`. `drag()` derives targets from authoritative reservations, not the payload. `releaseAndMove()` clears the exact live link before moving the target. Reconciliation deletes managed orphans but never creates a link from one surviving fragment.

- [ ] **Step 7: Verify GREEN**

Run `node --test tests/grapple-automation-service.test.mjs`. Expected: all lifecycle, movement and rollback tests pass.

- [ ] **Step 8: Commit**

```powershell
git add -- scripts/combat/grapple-automation-service.js tests/grapple-automation-service.test.mjs
git commit -m "feat(combat): manage grapple links and movement"
```

### Task 5: Token hooks and external-move dialog

**Files:**
- Create: `scripts/combat/grapple-hooks.js`
- Test: `tests/grapple-hooks.test.mjs`

**Interfaces:**
- Produces: `registerGrappleHooks(moduleApi, { Hooks, showMoveDialog })`.
- Consumes service methods: `requestDragFromTokenUpdate()`, `requestReleaseAndMove()`, `handleManagedEffectDeleted()`, `handleTokenDeleted()`, `reconcileScene()`.
- Internal update option: `options[MODULE_ID].grappleBypass === true`.

- [ ] **Step 1: Write failing hook tests**

Use a real hook registry fake. Assert one registration, bypass pass-through, source movement cancellation and drag request, target `x/y` removal while non-position fields remain, one pending dialog per link, both Russian buttons, managed effect cleanup, token deletion cleanup and canvas reconciliation.

```js
const changed = { x: 500, y: 600, alpha: 0.5 };
preUpdateTarget(target, changed, {}, "player-a");
assert.deepEqual(changed, { alpha: 0.5 });
```

- [ ] **Step 2: Verify RED**

Run `node --test tests/grapple-hooks.test.mjs`. Expected: import fails.

- [ ] **Step 3: Implement pre-update interception**

For source movement, copy only requested position, remove `x/y` from the original patch, and schedule the typed drag request without awaiting inside the hook. Return `false` only when no non-position fields remain. For target movement, do the same before opening `DialogV2.wait`/injected dialog. Preserve `userId` for later authorization.

- [ ] **Step 4: Implement dialog and lifecycle hooks**

Map `Отменить захват` to `release-and-move`; map `Отменить перемещение`, close and Escape to no mutation. Use a Map keyed by link ID to suppress duplicate prompts and clear it in `finally`. All async hook tasks report errors through one Russian-prefixed logger/notification boundary.

- [ ] **Step 5: Verify GREEN**

Run `node --test tests/grapple-hooks.test.mjs`. Expected: all hook behavior passes.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/combat/grapple-hooks.js tests/grapple-hooks.test.mjs
git commit -m "feat(combat): guard and batch grapple movement"
```

### Task 6: Typed commands, composition, API and documentation

**Files:**
- Create: `scripts/infrastructure/foundry/grapple-command-contract.js`
- Test: `tests/grapple-socket.test.mjs`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `README.md`
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.165.js`

**Interfaces:**
- Exports exact command constants and validators for `combat.grapple.toggle`, `.place`, `.drag`, `.release-and-move`.
- Public API: `toggleGrapple()` and `moveGrappled()`.
- Composition owns one `GrappleAutomationService`, `GrappleMacroService`, `GrapplePlacementPreview`, command registrations and hook registration.

- [ ] **Step 1: Write failing command-contract tests**

For every command, accept only exact enumerable keys, finite coordinates, trimmed UUID/operation IDs within the repository's existing socket limits, and reject extra keys, empty IDs, NaN/Infinity and wrong action payloads.

- [ ] **Step 2: Write failing authorization/composition tests**

Extend dispatch coverage for owner/other player/GM/unknown sender, active/inactive client, stale link and exact target permission on release-and-move. Extend composition coverage so ready publishes both API methods, registers grapple hooks once, and active GM syncs macro documents.

- [ ] **Step 3: Verify RED**

Run:

```powershell
node --test tests/grapple-socket.test.mjs tests/group-command-dispatch.test.mjs tests/main-composition-root.test.mjs
```

Expected: missing contract/API/registrations fail.

- [ ] **Step 4: Implement exact contracts and command registrations**

Register each command on the existing `SocketCommandBus`. Authorization must resolve exact source/target TokenDocuments and use sender ownership rather than payload claims. Direct active-GM public calls invoke the same service entrypoints; inactive clients call `socketCommandBus.request()` with `crypto.randomUUID()`-backed operation IDs.

- [ ] **Step 5: Compose services, hooks and managed documents**

Import the new modules in `scripts/main.js`, construct them beside existing combat services, initialize/reconcile in the existing `initialize()` sequence, and call `registerGrappleHooks` through the canonical combat hook boundary. At ready, sync managed documents only after `game.rebreyaMain` is published and only on active GM. Keep the versioned forwarder import-only.

- [ ] **Step 6: Implement public macro methods and notifications**

`toggleGrapple()` reads exactly one controlled source and one target, then routes toggle. `moveGrappled()` resolves the single linked target or exact selected linked target, opens preview locally, and routes place. Translate known error codes to the exact Russian user messages from the spec; cancellation stays quiet.

- [ ] **Step 7: Update README, passport and module version**

Document both API methods and selection rules in the existing macro API section of `README.md`. Update passport section 16 with every added/changed method, owners, flags, typed commands, source/target/group movement data flows, rollback/reconciliation constraints and focused tests. Set `module.json` version to `1.4.165`, point `esmodules` to `scripts/main-1.4.165.js`, and add that forwarder containing only `import "./main.js";`.

- [ ] **Step 8: Verify focused GREEN**

Run the Step 3 command plus:

```powershell
node --test tests/natural-reach.test.mjs tests/held-items.test.mjs tests/combat-attack-service.test.mjs tests/grapple-macro-service.test.mjs tests/grapple-geometry.test.mjs tests/grapple-placement-preview.test.mjs tests/grapple-automation-service.test.mjs tests/grapple-hooks.test.mjs
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 9: Run full verification once on unchanged HEAD/worktree**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Record test passed/failed counts and any real errors. Do not repeat successful full verification unless files change afterward.

- [ ] **Step 10: Review exact diff and commit**

```powershell
git diff --check
git diff --stat
git diff
git add -- scripts/infrastructure/foundry/grapple-command-contract.js scripts/combat/hooks.js scripts/main.js tests/grapple-socket.test.mjs tests/group-command-dispatch.test.mjs tests/main-composition-root.test.mjs README.md docs/function-passport.md module.json scripts/main-1.4.165.js
git commit -m "feat(combat): expose grapple automation"
```

- [ ] **Step 11: Fetch, verify remote branch and push**

```powershell
git fetch origin
git rev-list --left-right --count HEAD...origin/lich_branch
git log --oneline HEAD..origin/lich_branch
git push -u origin lich_branch
```

Stop before push if remote `lich_branch` moved ahead or the base now conflicts with this work. Force push is forbidden.
