# Ground Furniture Orientation Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the initiating client choose `0°`, `90°`, `180°`, or `270°` when spawning canonical rectangular furniture, then create a visually and mechanically aligned ground token through the existing authorized workflow.

**Architecture:** The existing `dropCanvasData` owner inspects the source and opens a small Foundry v13 dialog before dispatch. Existing API/socket payloads carry only an optional cardinal rotation; the active GM re-derives canonical presentation, while `StorageGroundPileService` remains the sole TokenDocument writer and applies a shared pure layout calculation.

**Tech Stack:** Foundry VTT 13 `DialogV2`, JavaScript ES modules, Foundry Hooks and TokenDocument APIs, Node.js `node:test`, existing typed socket command bus.

**Spec:** `docs/superpowers/specs/2026-09-01-top-down-item-textures-design.md`, sections 17–18.

## Global Constraints

- Work only on `lich_branch`; never commit or push to `main`/`master`, never force-push.
- Preserve stable `gearId`, `materialId`, UUIDs, document IDs and every existing `Item.img`.
- Do not add a second `dropCanvasData` owner, canvas placement mode, socket route, or direct UI world mutation.
- `StorageGroundPileService` remains the only owner of ground TokenDocument creation and updates.
- Player operations retain active-GM execution, controlled-character distance checks, sender authorization, rollback and mutation idempotency.
- The client sends only optional rotation; canonical dimensions and texture scale are always re-derived by the active GM.
- Only canonical furniture with `rotationMode === "cardinal"` and `width !== height` opens the dialog.
- Chosen orientation applies only when a new ground token is created. Merge never reorients an existing token.
- Square items, weapons, armor, materials, coins, Journal, portable storage, external Item fallback and built-in storage presets retain their current behavior.
- Missing rotation remains backward-compatible and uses deterministic rotation.
- Closing or cancelling the dialog consumes nothing and sends no mutation command.
- Subsequent manual Foundry rotation is cosmetic; no automatic width/height synchronization Hook is added.
- No new persisted flag or migration is introduced.
- Live Foundry QA is deferred by user instruction; do not claim it was performed.

---

### Task 1: Pure cardinal layout contract

**Files:**
- Create: `scripts/data/storage-ground-pile-layout.js`
- Create: `tests/storage-ground-pile-layout.test.mjs`

**Interfaces:**
- Produces: `GROUND_PILE_CARDINAL_ROTATIONS: readonly number[]`.
- Produces: `isGroundPileCardinalRotation(value) -> boolean` without coercing strings.
- Produces: `buildGroundPileTokenLayout({ width, height, textureScale, rotationMode }, rotation) -> { width, height, textureScale, rotation }`.
- The layout function throws for invalid/non-positive dimensions, scale, or a non-cardinal rotation when `rotationMode === "cardinal"`.

- [ ] **Step 1: Write failing tests for validation, side swapping and scale compensation**

```js
import {
  buildGroundPileTokenLayout,
  isGroundPileCardinalRotation
} from "../scripts/data/storage-ground-pile-layout.js";

assert.equal(isGroundPileCardinalRotation(90), true);
assert.equal(isGroundPileCardinalRotation("90"), false);
assert.deepEqual(buildGroundPileTokenLayout({
  width: 1, height: 2, textureScale: 1, rotationMode: "cardinal"
}, 0), { width: 1, height: 2, textureScale: 1, rotation: 0 });
assert.deepEqual(buildGroundPileTokenLayout({
  width: 1, height: 2, textureScale: 1, rotationMode: "cardinal"
}, 90), { width: 2, height: 1, textureScale: 2, rotation: 90 });
assert.deepEqual(buildGroundPileTokenLayout({
  width: 3, height: 2, textureScale: 1, rotationMode: "cardinal"
}, 270), { width: 2, height: 3, textureScale: 1.5, rotation: 270 });
assert.throws(() => buildGroundPileTokenLayout({
  width: 1, height: 2, textureScale: 1, rotationMode: "cardinal"
}, 45));
```

- [ ] **Step 2: Run the new focused test and verify RED**

Run: `node --test tests/storage-ground-pile-layout.test.mjs`

Expected: FAIL because `storage-ground-pile-layout.js` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

```js
export const GROUND_PILE_CARDINAL_ROTATIONS = Object.freeze([0, 90, 180, 270]);

export function isGroundPileCardinalRotation(value) {
  return Number.isInteger(value) && GROUND_PILE_CARDINAL_ROTATIONS.includes(value);
}

export function buildGroundPileTokenLayout({
  width,
  height,
  textureScale = 1,
  rotationMode = ""
} = {}, rotation = 0) {
  if (![width, height, textureScale].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Ground-pile layout requires positive finite dimensions and scale.");
  }
  if (rotationMode === "cardinal" && !isGroundPileCardinalRotation(rotation)) {
    throw new Error("Ground-pile furniture rotation must be 0, 90, 180, or 270 degrees.");
  }
  const quarterTurn = rotationMode === "cardinal" && (rotation === 90 || rotation === 270);
  const compensation = quarterTurn && width !== height
    ? Math.max(width / height, height / width)
    : 1;
  return {
    width: quarterTurn ? height : width,
    height: quarterTurn ? width : height,
    textureScale: textureScale * compensation,
    rotation
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/storage-ground-pile-layout.test.mjs`

Expected: all layout tests pass.

- [ ] **Step 5: Commit the pure contract**

```powershell
git add -- scripts/data/storage-ground-pile-layout.js tests/storage-ground-pile-layout.test.mjs
git commit -m "feat: add ground furniture orientation layout"
```

---

### Task 2: Safe placement inspection through the existing module API

**Files:**
- Modify: `scripts/data/storage-pile-presentation.js`
- Modify: `scripts/main.js`
- Modify: `tests/storage-pile-presentation.test.mjs`
- Modify: `tests/storage-module-api.test.mjs`

**Interfaces:**
- Consumes: existing `deriveGroundPilePresentation([row])` and strict top-down identity resolver.
- Produces: `deriveGroundPilePlacement(row) -> { width:number, height:number, rotationMode:"cardinal" } | null`.
- Extends: `inspectStorageDepositSource(dragData)` response with `placement`, which is plain serialized data or `null`.

- [ ] **Step 1: Add failing presentation tests for canonical and fallback rows**

```js
assert.deepEqual(deriveGroundPilePlacement(canonicalBedRow), {
  width: 1,
  height: 2,
  rotationMode: "cardinal"
});
assert.deepEqual(deriveGroundPilePlacement(canonicalChairRow), {
  width: 1,
  height: 1,
  rotationMode: "cardinal"
});
assert.equal(deriveGroundPilePlacement(externalBedRow), null);
```

- [ ] **Step 2: Run the presentation test and verify RED**

Run: `node --test tests/storage-pile-presentation.test.mjs`

Expected: FAIL because `deriveGroundPilePlacement` is not exported.

- [ ] **Step 3: Implement a derived, non-authoritative placement descriptor**

```js
export function deriveGroundPilePlacement(row) {
  const presentation = deriveGroundPilePresentation(row ? [row] : []);
  const width = Number(presentation?.tokenWidth);
  const height = Number(presentation?.tokenHeight);
  if (presentation?.topDownItem !== true
    || presentation.rotationMode !== "cardinal"
    || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0) return null;
  return { width, height, rotationMode: "cardinal" };
}
```

- [ ] **Step 4: Add a failing module-API test for safe inspection**

Exercise `inspectStorageDepositSource()` with a resolved canonical bed row and assert that its existing fields remain unchanged while `placement` equals `{width:1,height:2,rotationMode:"cardinal"}`. Exercise an external row and assert `placement === null`.

- [ ] **Step 5: Run the module-API test and verify RED**

Run: `node --test tests/storage-module-api.test.mjs`

Expected: FAIL because inspection does not return `placement`.

- [ ] **Step 6: Extend only the existing inspection response**

Import `deriveGroundPilePlacement` into `scripts/main.js` with the new release cache key and return:

```js
return {
  source,
  kind: resolved.kind,
  denomination: resolved.denomination,
  available: resolved.available,
  mode: resolved.mode,
  name: cleanSocketId(resolved.row?.name ?? resolved.item?.name),
  img: cleanSocketId(resolved.row?.img ?? resolved.item?.img),
  placement: deriveGroundPilePlacement(resolved.row)
};
```

- [ ] **Step 7: Run both focused files and verify GREEN**

Run: `node --test tests/storage-pile-presentation.test.mjs tests/storage-module-api.test.mjs`

Expected: both files pass and existing inspection fields remain compatible.

- [ ] **Step 8: Commit the inspection contract**

```powershell
git add -- scripts/data/storage-pile-presentation.js scripts/main.js tests/storage-pile-presentation.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: expose safe ground item placement metadata"
```

---

### Task 3: Client orientation dialog in the existing drop owner

**Files:**
- Modify: `scripts/ui/storage-transfer-ui.js`
- Modify: `scripts/integrations/storage-transfer-drop.js`
- Modify: `styles/main.css`
- Modify: `tests/storage-transfer-ui.test.mjs`
- Modify: `tests/storage-transfer-drop.test.mjs`

**Interfaces:**
- Produces: `promptStorageGroundPileRotation({ name, img, width, height, rotationMode }, { prompt } = {}) -> Promise<number|null>`.
- Consumes: `inspectStorageDepositSource()` response from Task 2.
- Extends injection options of `transferFoundryItemDropToCanvas()` and `transferStorageDropToCanvas()` with `promptRotation`, without changing existing `prompt` quantity injection.

- [ ] **Step 1: Write failing prompt tests**

```js
assert.equal(await promptStorageGroundPileRotation({
  name: "Кровать", img: "bed.webp", width: 1, height: 2, rotationMode: "cardinal"
}, { prompt: async () => 90 }), 90);
assert.equal(await promptStorageGroundPileRotation({
  name: "Кровать", img: "bed.webp", width: 1, height: 2, rotationMode: "cardinal"
}, { prompt: async () => null }), null);
assert.equal(await promptStorageGroundPileRotation({
  name: "Стул", img: "chair.webp", width: 1, height: 1, rotationMode: "cardinal"
}, { prompt: async () => { throw new Error("must not prompt"); } }), null);
await assert.rejects(() => promptStorageGroundPileRotation({
  name: "Кровать", img: "bed.webp", width: 1, height: 2, rotationMode: "cardinal"
}, { prompt: async () => 45 }), /0, 90, 180 или 270/u);
```

- [ ] **Step 2: Run the UI test and verify RED**

Run: `node --test tests/storage-transfer-ui.test.mjs`

Expected: FAIL because the orientation prompt is not exported.

- [ ] **Step 3: Implement the Foundry v13 dialog and validation wrapper**

Use `escapeFoundryHtml` from `scripts/shared/foundry-values.js`. The default prompt calls `foundry.applications.api.DialogV2.wait()` with `rejectClose:false` and four buttons whose callbacks return `0`, `90`, `180`, or `270`. Mark the `0°` button as default. Render the escaped name, escaped image URL and base footprint; label buttons as `0° — W×H`, `90° — H×W`, `180° — W×H`, `270° — H×W`.

The exported wrapper must return `null` without opening UI unless `rotationMode === "cardinal"`, both dimensions are positive finite numbers, and `width !== height`. It must accept only the four numeric cardinal results.

- [ ] **Step 4: Add minimal scoped styles**

Add `.rm-storage-orientation-dialog`, `.rm-storage-orientation-dialog__preview`, and `.rm-storage-orientation-dialog__size` rules. Keep the preview within `128px`, preserve aspect ratio with `object-fit:contain`, and do not style global `.dialog` or `button` selectors.

- [ ] **Step 5: Run the UI test and verify GREEN**

Run: `node --test tests/storage-transfer-ui.test.mjs`

Expected: prompt bypass, selection, cancellation and invalid-result tests pass.

- [ ] **Step 6: Write failing direct Item drop tests**

Cover these cases in `tests/storage-transfer-drop.test.mjs`:

```js
// Rectangular canonical Item: quantity first, rotation second, then one API call.
assert.deepEqual(calls[0][1], { sceneId: "scene", x: 120, y: 180, quantity: 1, rotation: 90 });

// Rotation cancellation: handled/cancelled, no dropStorageItemToScene call.
assert.equal(cancelled.cancelled, true);

// Square/external placement: promptRotation is never called and request has no rotation key.
```

- [ ] **Step 7: Write failing storage-row-to-scene tests**

Require `transferStorageDropToCanvas()` to inspect the existing storage-row source before prompting orientation. Assert a rectangular row adds `rotation` under `claimStorageRow(..., request.target)`, cancellation sends no claim, and character-target drops retain their current route without an orientation prompt.

- [ ] **Step 8: Run the drop tests and verify RED**

Run: `node --test tests/storage-transfer-drop.test.mjs`

Expected: FAIL because neither route requests or forwards orientation.

- [ ] **Step 9: Integrate the dialog without adding a Hook owner**

Import `promptStorageGroundPileRotation`. After quantity is resolved, build the prompt input from `inspected.name`, `inspected.img`, and `inspected.placement`. If the prompt returns `null` for a rectangular placement, return `{handled:true,cancelled:true}`. Otherwise add `rotation` only when a numeric selection exists.

For the storage-row route, call `moduleApi.inspectStorageDepositSource(payload)` only after confirming the drop targets the scene rather than a character. Continue using the existing `registerStorageTransferDropHooks()` and its single `dropCanvasData` registration.

- [ ] **Step 10: Run both focused files and verify GREEN**

Run: `node --test tests/storage-transfer-ui.test.mjs tests/storage-transfer-drop.test.mjs`

Expected: all dialog and drop-routing tests pass; existing coins, Journal, portable container and character-drop tests remain green.

- [ ] **Step 11: Commit the client flow**

```powershell
git add -- scripts/ui/storage-transfer-ui.js scripts/integrations/storage-transfer-drop.js styles/main.css tests/storage-transfer-ui.test.mjs tests/storage-transfer-drop.test.mjs
git commit -m "feat: prompt for ground furniture orientation"
```

---

### Task 4: Optional rotation through existing API and socket contracts

**Files:**
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-module-api.test.mjs`

**Interfaces:**
- Consumes: `isGroundPileCardinalRotation(value)` from Task 1.
- Extends: scene target shape to `{sceneId,x,y,rotation?}`.
- Extends: direct Item scene payload to `{itemUuid,characterTokenUuid,sceneId,x,y,quantity,mutationId,rotation?}`.
- Passes: optional `rotation` to `StorageGroundPileService.transferToScene()`; no dimensions or scale cross the socket.

- [ ] **Step 1: Write failing exact-validator tests**

For both `isValidStorageClaimRowPayload()` and `isValidStorageDropItemPayload()`, assert:

```js
for (const rotation of [0, 90, 180, 270]) assert.equal(validate(payload(rotation)), true);
for (const rotation of [45, -90, 360, "90", null]) assert.equal(validate(payload(rotation)), false);
assert.equal(validate(legacyPayloadWithoutRotation), true);
assert.equal(validate({...legacyPayloadWithoutRotation, unexpected:true}), false);
```

- [ ] **Step 2: Run validator tests and verify RED**

Run: `node --test tests/storage-socket.test.mjs`

Expected: optional-rotation payloads fail exact-key validation.

- [ ] **Step 3: Extend exact validation without weakening other destinations**

Import `isGroundPileCardinalRotation`. For destination `scene`, accept exactly either `sceneId/x/y` or `sceneId/x/y/rotation`; `self`, `party`, and `character` shapes stay byte-for-byte equivalent. For direct Item drop, accept exactly the legacy key set or that set plus `rotation`. Validate rotation only when present.

- [ ] **Step 4: Add failing API serialization tests**

Assert `claimStorageRow(..., "scene", ..., {target:{sceneId,x,y,rotation:270}})` retains rotation inside `target`, and `dropStorageItemToScene(...,{rotation:90})` retains it at payload root. Assert omitted rotation does not produce `rotation:NaN` or an extra key.

- [ ] **Step 5: Add failing authoritative forwarding tests**

In the command-service harness, assert both the direct Item route and the storage-row scene route forward `rotation` to `groundPileService.transferToScene()`. Keep existing sender, distance, consume/claim, rollback and mutation ID assertions.

- [ ] **Step 6: Run socket and module-API tests and verify RED**

Run: `node --test tests/storage-socket.test.mjs tests/storage-module-api.test.mjs`

Expected: validators pass after Step 3, but serialization/forwarding tests fail until implementation.

- [ ] **Step 7: Serialize and forward optional rotation**

In `scripts/main.js`, add a rotation key only when `request.rotation !== undefined`; never coerce absence to zero. In `StorageCommandService.claimRow()` and `.dropItemToScene()`, pass the optional numeric rotation into the existing ground service call. Do not forward it to portable-container restoration or any non-scene destination.

- [ ] **Step 8: Run focused command/API tests and verify GREEN**

Run: `node --test tests/storage-socket.test.mjs tests/storage-module-api.test.mjs`

Expected: validators, active-GM direct calls, player socket calls, legacy payloads and exact-key rejection all pass.

- [ ] **Step 9: Commit the transport contract**

```powershell
git add -- scripts/data/storage-command-service.js scripts/main.js tests/storage-socket.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: carry furniture orientation through storage commands"
```

---

### Task 5: Authoritative oriented TokenDocument creation and merge preservation

**Files:**
- Modify: `scripts/data/storage-ground-pile-service.js`
- Modify: `tests/storage-ground-pile-service.test.mjs`

**Interfaces:**
- Consumes: `buildGroundPileTokenLayout()` and `isGroundPileCardinalRotation()` from Task 1.
- Extends: `transferToScene({row,quantity,sceneId,x,y,mutationId,ownerUserId,rotation?})`.
- Internal rule: explicit rotation is honored only for new rectangular cardinal presentation; existing merges ignore it.

- [ ] **Step 1: Write failing explicit-orientation creation tests**

Create a bed at the same drop point with each cardinal angle and assert:

```js
// 0/180
assert.deepEqual(pick(token, "width", "height", "x", "y"), {
  width: 1, height: 2, x: 250, y: 300
});
assert.equal(token.texture.scaleX, 1);

// 90/270
assert.deepEqual(pick(token, "width", "height", "x", "y"), {
  width: 2, height: 1, x: 200, y: 350
});
assert.equal(token.texture.scaleX, 2);
assert.equal(token.texture.scaleY, 2);
```

Repeat the scale assertion for a `3×2` table at `90°`: footprint `2×3`, scale `1.5`, same center.

- [ ] **Step 2: Write failing trust-boundary and legacy tests**

Assert invalid explicit rotation rejects before source state changes; explicit cardinal rotation on a square/non-furniture row is ignored; omitted rotation remains deterministic but now always returns a mechanically matching oriented footprint.

- [ ] **Step 3: Write failing merge/retry tests**

Create a bed at `90°`, merge another matching row at the same point, and assert the existing token remains `90°`, `2×1`, centered and correctly scaled. Merge a distinct ordinary row and assert generic `1×1`, scale `1`, rotation `0`. Retry the original mutation and assert no layout change. When a rectangular survivor reappears from a multi-item pile, assert it uses deterministic cardinal fallback with matching sides/scale.

- [ ] **Step 4: Run the ground service test and verify RED**

Run: `node --test tests/storage-ground-pile-service.test.mjs`

Expected: explicit rotation is ignored and current random `90/270` layouts retain unswapped dimensions.

- [ ] **Step 5: Centralize final rotation and layout selection inside the service**

Import the Task 1 helpers with a release cache key. Before Token creation, derive canonical width/height as today, choose explicit rotation only when the new presentation is rectangular cardinal, otherwise choose `deterministicRotation()`, then call `buildGroundPileTokenLayout()`.

Use the returned width/height for `x/y`, document dimensions and the returned scale for both `texture.scaleX` and `texture.scaleY`. Continue using `texture.fit:"contain"` for cardinal presentation.

Before `#writePile()` updates an existing token, derive its previous presentation from `readStorageState(token)`. If previous and next presentations are both rectangular cardinal single items and the existing token rotation is cardinal, preserve that rotation. Otherwise use deterministic fallback for a new/surviving single item or `0` for the existing generic branches. Never use the incoming dialog rotation in the merge branch.

- [ ] **Step 6: Run ground-pile and presentation regression tests and verify GREEN**

Run: `node --test tests/storage-ground-pile-service.test.mjs tests/storage-pile-presentation.test.mjs`

Expected: orientation, merge, duplicate, coins, Journal, fallback and single↔pile transition tests pass.

- [ ] **Step 7: Run built-in preset regressions**

Run: `node --test tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs`

Expected: chest, barrel, crate and built-in storage texture tests pass unchanged.

- [ ] **Step 8: Commit authoritative layout behavior**

```powershell
git add -- scripts/data/storage-ground-pile-service.js tests/storage-ground-pile-service.test.mjs
git commit -m "fix: align furniture rotation with token footprint"
```

---

### Task 6: Passport, release version and verification

**Files:**
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.212.js`
- Modify: `scripts/main.js`
- Modify: `scripts/data/storage-ground-pile-service.js`
- Modify: `scripts/integrations/storage-transfer-drop.js`
- Modify: `tests/module-manifest.test.mjs`

**Interfaces:**
- Documents every new/changed method signature, owner, data flow, constraints and focused test file.
- Publishes version `1.4.212` through `scripts/main-1.4.212.js`, containing only `import "./main.js";`.

- [ ] **Step 1: Update the focused function passport section**

Use `rg -n "Top-down texture catalog|storage-transfer-drop|promptStorageTransferQuantity|StorageGroundPileService" docs/function-passport.md` and edit only the relevant storage/top-down paragraphs. Record:

- `deriveGroundPilePlacement(row)`;
- `promptStorageGroundPileRotation(placement, options)`;
- pure cardinal layout exports;
- optional rotation in both existing command shapes;
- authoritative derivation, create-only selection and merge preservation;
- no manual-rotation synchronization Hook and no new persisted flags.

- [ ] **Step 2: Bump runtime version and cache keys**

Set `module.json.version` to `1.4.212`, set `esmodules` to `scripts/main-1.4.212.js`, create the forwarder with exactly:

```js
import "./main.js";
```

Update cache-query suffixes for every touched runtime import in `scripts/main.js`, `scripts/data/storage-ground-pile-service.js`, and `scripts/integrations/storage-transfer-drop.js` to one consistent `1.4.212-furniture-orientation` release key. Do not add logic to any versioned forwarder.

- [ ] **Step 3: Update manifest assertions**

Change exact expectations in `tests/module-manifest.test.mjs` from `1.4.211` to `1.4.212` and include the new forwarder in compatibility assertions where the test enumerates recent versions.

- [ ] **Step 4: Run the complete focused contour**

Run:

```powershell
node --test tests/storage-ground-pile-layout.test.mjs tests/storage-pile-presentation.test.mjs tests/storage-transfer-ui.test.mjs tests/storage-transfer-drop.test.mjs tests/storage-module-api.test.mjs tests/storage-socket.test.mjs tests/storage-ground-pile-service.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs tests/module-manifest.test.mjs
```

Expected: all focused tests pass; report exact passed/failed counts.

- [ ] **Step 5: Run the AGENTS.md full verification once on unchanged HEAD**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: zero failed tests, zero syntax failures, zero invalid JSON files and no `git diff --check` errors. Do not run live Foundry QA.

- [ ] **Step 6: Review the final diff and repository state**

```powershell
git status --short --branch
git diff --check
git diff --stat
git diff
git rev-list --left-right --count HEAD...origin/lich_branch
```

Stop and report if unrelated user changes appear or remote `lich_branch` advanced.

- [ ] **Step 7: Commit only the release/documentation files and push**

```powershell
git add -- docs/function-passport.md module.json scripts/main-1.4.212.js scripts/main.js scripts/data/storage-ground-pile-service.js scripts/integrations/storage-transfer-drop.js tests/module-manifest.test.mjs
git commit -m "chore: release furniture orientation dialog"
git push -u origin lich_branch
```

Report all task commits, pushed branch, focused/full pass counts, deferred live QA, and the exact manual GM/player checks still outstanding.
