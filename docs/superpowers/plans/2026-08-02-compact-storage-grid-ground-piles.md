# Compact Storage Grid and Ground Piles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive six-slot storage grid with quantity-aware claims and Rebreya-owned ground piles that accept safe drag-and-drop transfers.

**Architecture:** Keep `StorageService` as the source-of-truth for token-local contents, add an active-GM transfer coordinator for partial moves, and represent ground loot as unlinked tokens from one restored storage prototype actor. UI and drop hooks emit untrusted claim requests; only the active GM validates access, updates destinations, decrements sources, merges piles, and deletes empty ground tokens.

**Tech Stack:** Foundry VTT 13 ApplicationV2 and document hooks, dnd5e actor/item documents, ES modules, Handlebars, CSS grid, Node.js built-in test runner, PNG assets.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Do not use force push.
- Do not depend on, call, inspect, or fall back to Item Piles for this feature.
- Player storage and ground-pile access remains limited to an owned controlled character within five feet; GMs bypass distance.
- All document mutations execute through the active GM and are idempotent by mutation ID.
- A failed or cancelled destination must not decrement the source.
- Ordinary empty chests remain and use `(пусто)`; empty ground piles delete their scene token.
- The storage window has no pager controls and grows with an approximately square grid.
- Current Foundry compatibility remains minimum and verified version 13.

---

### Task 1: Quantity-Aware Storage State

**Files:**
- Modify: `scripts/data/storage-service.js`
- Test: `tests/storage-service.test.mjs`

**Interfaces:**
- Consumes: existing `StorageService.claim(token, request)` and stable `rowId` values.
- Produces: `StorageService.claim(token, {kind: "row", rowId, quantity}) -> {changed, row, quantity, state}` with partial and full claim behavior.

- [ ] **Step 1: Write failing partial-claim tests**

Add tests proving that claiming two units from a five-unit generated row leaves quantity three in both row fields, while claiming the final three adds the row ID to `claimedRowIds` and makes an otherwise empty chest `empty`.

```js
const first = await service.claim(token, { kind: "row", rowId: "row", quantity: 2 });
assert.equal(first.quantity, 2);
assert.equal(readStorageState(token).generatedRows[0].quantity, 3);
assert.equal(readStorageState(token).generatedRows[0].itemData.system.quantity, 3);

await service.claim(token, { kind: "row", rowId: "row", quantity: 3 });
assert.deepEqual(readStorageState(token).claimedRowIds, ["row"]);
assert.equal(readStorageState(token).state, "empty");
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/storage-service.test.mjs`

Expected: FAIL because `claim` currently claims the full row and ignores `quantity`.

- [ ] **Step 3: Implement exact quantity validation and partial mutation**

Resolve the row in its owning collection, reject non-integer amounts outside `1..available`, clone the claimed row with the requested quantity, and either update both quantity fields or use the legacy claimed-row marker for a full claim.

```js
const requested = Number(request?.quantity ?? available);
if (!Number.isSafeInteger(requested) || requested < 1 || requested > available) {
  throw new Error("Количество должно быть целым числом от 1 до доступного остатка.");
}
```

- [ ] **Step 4: Run storage service tests**

Run: `node --test tests/storage-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-service.js tests/storage-service.test.mjs
git commit -m "feat: support partial storage claims"
```

---

### Task 2: Active-GM Quantity Transfer Command

**Files:**
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`
- Test: `tests/storage-socket.test.mjs`
- Test: `tests/storage-module-api.test.mjs`
- Test: `tests/security.test.mjs`

**Interfaces:**
- Consumes: `StorageService.claim(..., {rowId, quantity})`, `InventoryService.addLootgenRowToInventoryOnce`, and `InventoryService.addLootgenRowToCharacterOnce`.
- Produces: `claimStorageRow(tokenUuid, rowId, destination, quantity, mutationId, request)` and payload `{tokenUuid, characterTokenUuid, rowId, destination, quantity, mutationId}`.

- [ ] **Step 1: Write failing validator and transfer tests**

Test exact-key payload validation, partial row copies passed to destination grants, source decrement after successful grants, no decrement after rejected grants, duplicate mutation coalescing, and two serialized claims whose total exceeds the source.

```js
assert.equal(isValidStorageClaimRowPayload({
  tokenUuid: "Scene.s.Token.t",
  characterTokenUuid: "Scene.s.Token.c",
  rowId: "row",
  destination: "self",
  quantity: 2,
  mutationId: "move-1"
}), true);
```

- [ ] **Step 2: Run focused command and API tests**

Run: `node --test tests/storage-socket.test.mjs tests/storage-module-api.test.mjs tests/security.test.mjs`

Expected: FAIL on the new quantity field/signature.

- [ ] **Step 3: Extend the authoritative command**

Keep the existing per-mutation single-flight map, add a per-source queue, re-read the row inside that queue, clone it with the requested amount for the destination, await the once-safe grant, then call the quantity-aware source claim.

```js
const transferRow = {
  ...foundry.utils.deepClone(row),
  quantity,
  itemData: {
    ...foundry.utils.deepClone(row.itemData ?? {}),
    system: { ...foundry.utils.deepClone(row.itemData?.system ?? {}), quantity }
  }
};
```

Update `STORAGE_CLAIM_ROW_COMMAND`, its socket validator, `RebreyaMainModule.claimStorageRow`, and the security allow-list together.

- [ ] **Step 4: Run command, API, and security tests**

Run: `node --test tests/storage-socket.test.mjs tests/storage-module-api.test.mjs tests/security.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-command-service.js scripts/main.js tests/storage-socket.test.mjs tests/storage-module-api.test.mjs tests/security.test.mjs
git commit -m "feat: route partial storage transfers through active gm"
```

---

### Task 3: Responsive Grid, Popover, and Quantity Prompt

**Files:**
- Create: `scripts/ui/storage-transfer-ui.js`
- Modify: `scripts/ui/storage-app.js`
- Modify: `templates/storage-app.hbs`
- Modify: `styles/main.css`
- Test: `tests/storage-app.test.mjs`
- Create: `tests/storage-transfer-ui.test.mjs`

**Interfaces:**
- Consumes: `moduleApi.claimStorageRow(tokenUuid, rowId, destination, quantity, mutationId)`.
- Produces: `buildStorageDragData`, `parseStorageDragData`, `promptStorageTransferQuantity`, and grid items with `data-storage-row-id`.

- [ ] **Step 1: Write failing UI contract and helper tests**

Assert six-item three-column markup, no claim buttons in the closed icon cell, no pager action, quantity badge rendering, popover actions, `draggable="true"`, round-trip drag payload parsing, quantity-one prompt bypass, cancellation, and bounds validation.

```js
assert.deepEqual(parseStorageDragData(buildStorageDragData({
  tokenUuid: "Scene.s.Token.t", rowId: "row", quantity: 4
})), {
  type: "RebreyaStorageClaim",
  tokenUuid: "Scene.s.Token.t",
  rowId: "row",
  quantity: 4
});
```

- [ ] **Step 2: Run focused UI tests**

Run: `node --test tests/storage-app.test.mjs tests/storage-transfer-ui.test.mjs`

Expected: FAIL because the current template renders vertical cards and permanent buttons.

- [ ] **Step 3: Implement helpers and the icon grid**

Move pure drag/quantity helpers into `storage-transfer-ui.js`. In `StorageApp`, track `activeRowId`, open/close one popover, invoke quantity selection before click claims, write custom JSON to `text/plain` on drag start, and rerender after a successful claim.

Use CSS grid without page state:

```css
.rm-storage-grid {
  --rm-storage-columns: 3;
  display: grid;
  grid-template-columns: repeat(var(--rm-storage-columns), 72px);
  gap: 8px;
}
```

Derive the column count from row count for near-square growth and cap only against the viewport.

- [ ] **Step 4: Run focused UI tests**

Run: `node --test tests/storage-app.test.mjs tests/storage-transfer-ui.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/ui/storage-transfer-ui.js scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/storage-app.test.mjs tests/storage-transfer-ui.test.mjs
git commit -m "feat: render storage as responsive icon grid"
```

---

### Task 4: Ground-Pile Presentation Catalog and Prototype

**Files:**
- Create: `scripts/data/storage-pile-presentation.js`
- Modify: `scripts/data/builtin-storage-presets.js`
- Modify: `scripts/data/builtin-storage-actor-service.js`
- Test: `tests/builtin-storage-presets.test.mjs`
- Test: `tests/builtin-storage-actor-service.test.mjs`
- Create: `tests/storage-pile-presentation.test.mjs`

**Interfaces:**
- Produces: `GROUND_PILE_PRESET_ID`, `isGroundPileToken(token)`, and `deriveGroundPilePresentation(rows) -> {name, img, categoryKey}`.
- Consumes: normalized lootgen `typeLabel`, `sourceType`, `sourceId`, item quantity, and item image.

- [ ] **Step 1: Write failing presentation and restoration tests**

Cover single item, stacked single item, same-category multi-row, mixed categories, unknown category fallback, and restoration of one NPC prototype marked as both storage-enabled and a ground-pile prototype.

```js
assert.deepEqual(deriveGroundPilePresentation([
  { name: "Стрела", img: "arrow.webp", typeLabel: "Боеприпас", quantity: 20 }
]), { name: "Стрела (20)", img: "arrow.webp", categoryKey: "single" });
```

- [ ] **Step 2: Run focused catalog tests**

Run: `node --test tests/storage-pile-presentation.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs`

Expected: FAIL because no pile catalog or prototype exists.

- [ ] **Step 3: Implement normalized category mapping and prototype restoration**

Map current lootgen labels to localized pile names and `modules/rebreya-main/assets/storage/piles/*.png`. Add a generic `ground-pile` built-in actor preset whose unlinked prototype starts `opened`, has no generation template, and carries a dedicated prototype flag. Preserve existing chest preset behavior and conservative migration.

- [ ] **Step 4: Run focused catalog tests**

Run: `node --test tests/storage-pile-presentation.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-pile-presentation.js scripts/data/builtin-storage-presets.js scripts/data/builtin-storage-actor-service.js tests/storage-pile-presentation.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs
git commit -m "feat: add rebreya ground pile prototype"
```

---

### Task 5: Ground-Pile Creation, Stacking, and Cleanup

**Files:**
- Create: `scripts/data/storage-ground-pile-service.js`
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/main.js`
- Create: `tests/storage-ground-pile-service.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Consumes: restored ground-pile actor, `deriveGroundPilePresentation`, scene embedded Token API, and a quantity-limited loot row.
- Produces: `StorageGroundPileService.transferToScene({sourceToken, row, quantity, sceneId, x, y, mutationId, sender, characterToken})`.

- [ ] **Step 1: Write failing service tests**

Cover unlinked token creation, drop-point hit testing, same-identity stack merging, nonmatching append, presentation refresh, no proximity-only merge, player drop distance, GM distance bypass, and deletion after the final ground-pile claim.

```js
const result = await service.transferToScene({ row, quantity: 2, sceneId: "scene", x: 300, y: 400 });
assert.equal(result.created, true);
assert.equal(createdToken.actorLink, false);
assert.equal(createdToken.flags[MODULE_ID].groundPile.enabled, true);
```

- [ ] **Step 2: Run focused ground-pile tests**

Run: `node --test tests/storage-ground-pile-service.test.mjs tests/main-composition-root.test.mjs`

Expected: FAIL because the service is not composed.

- [ ] **Step 3: Implement active-GM pile mutations**

Create scene tokens from the prototype actor, put independent opened storage state on the token, merge rows by canonical identity plus broken state, recalculate name/image after every mutation, and register an `onStorageChanged` callback so an empty marked ground pile deletes itself while an ordinary chest remains.

- [ ] **Step 4: Run focused ground-pile tests**

Run: `node --test tests/storage-ground-pile-service.test.mjs tests/main-composition-root.test.mjs tests/storage-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-ground-pile-service.js scripts/data/storage-service.js scripts/main.js tests/storage-ground-pile-service.test.mjs tests/main-composition-root.test.mjs tests/storage-service.test.mjs
git commit -m "feat: create and merge ground loot piles"
```

---

### Task 6: Actor Sheet, Group Inventory, and Canvas Drop Hooks

**Files:**
- Create: `scripts/integrations/storage-transfer-drop.js`
- Modify: `scripts/ui/inventory-app.js`
- Modify: `scripts/main.js`
- Create: `tests/storage-transfer-drop.test.mjs`
- Modify: `tests/storage-app.test.mjs`

**Interfaces:**
- Consumes: `parseStorageDragData`, `promptStorageTransferQuantity`, `claimStorageRow`, and `StorageGroundPileService` routing.
- Produces: `registerStorageTransferDropHooks(moduleApi)`, actor target destination `character`, party target destination `party`, and canvas target destination `scene`.

- [ ] **Step 1: Write failing hook tests**

Test that unrelated drops return `true`, owned character drops are intercepted, unowned actors are rejected without source mutation, the group inventory dropzone intercepts the custom payload before generic import, canvas coordinates are forwarded, cancellation makes no API call, and handlers return `false` only for recognized payloads.

```js
assert.equal(handleStorageActorSheetDrop(actor, claimData, moduleApi), false);
assert.deepEqual(calls[0], {
  tokenUuid: "Scene.s.Token.source",
  rowId: "row",
  destination: "character",
  targetActorUuid: actor.uuid
});
```

- [ ] **Step 2: Run focused drop tests**

Run: `node --test tests/storage-transfer-drop.test.mjs tests/storage-app.test.mjs`

Expected: FAIL because the custom handlers do not exist.

- [ ] **Step 3: Implement custom drop interception and socket routing**

Register `dropActorSheetData` and `dropCanvasData` once, add the storage claim branch before `InventoryService.importDroppedItem`, and extend the authoritative transfer payload with an exact destination-specific target object. Return `false` for recognized Rebreya payloads so Foundry never performs a second native Item copy.

- [ ] **Step 4: Run focused integration tests**

Run: `node --test tests/storage-transfer-drop.test.mjs tests/storage-app.test.mjs tests/storage-socket.test.mjs tests/storage-module-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/integrations/storage-transfer-drop.js scripts/ui/inventory-app.js scripts/main.js tests/storage-transfer-drop.test.mjs tests/storage-app.test.mjs tests/storage-socket.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: move storage loot by drag and drop"
```

---

### Task 7: Generate and Validate Category PNG Tokens

**Files:**
- Create: `assets/storage/piles/ammunition.png`
- Create: `assets/storage/piles/explosives.png`
- Create: `assets/storage/piles/armor.png`
- Create: `assets/storage/piles/tools.png`
- Create: `assets/storage/piles/implants.png`
- Create: `assets/storage/piles/upgrades.png`
- Create: `assets/storage/piles/potions.png`
- Create: `assets/storage/piles/attachments.png`
- Create: `assets/storage/piles/firearms.png`
- Create: `assets/storage/piles/weapons.png`
- Create: `assets/storage/piles/equipment.png`
- Create: `assets/storage/piles/treasure.png`
- Create: `assets/storage/piles/materials.png`
- Create: `assets/storage/piles/mixed-items.png`
- Test: `tests/storage-pile-assets.test.mjs`

**Interfaces:**
- Consumes: exact paths exported by `storage-pile-presentation.js`.
- Produces: fourteen square transparent PNGs with readable token-scale silhouettes.

- [ ] **Step 1: Write failing asset coverage test**

Read every catalog path, validate the PNG signature, parse IHDR width/height/color type, require square dimensions, and require an alpha-capable color type.

```js
assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(width, height);
assert.ok([4, 6].includes(colorType));
```

- [ ] **Step 2: Run the asset test and verify missing files**

Run: `node --test tests/storage-pile-assets.test.mjs`

Expected: FAIL with missing PNG paths.

- [ ] **Step 3: Generate one asset per category with the built-in image tool**

Use this normalized prompt for every category, replacing only `<contents>`:

```text
Use case: stylized-concept
Asset type: Foundry VTT top-down pile token
Primary request: a compact pile of <contents>, clearly readable at 128px
Style/medium: polished dark-fantasy painted game token matching one shared set
Composition/framing: top-down, centered, square, generous padding
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background
Constraints: opaque contents, restrained circular token rim, no text, no watermark, no cast shadow, do not use #00ff00 in the subject
```

Generate each distinct category separately, copy the selected sources into a temporary project folder, remove chroma key with the installed `remove_chroma_key.py`, and save the final PNGs under `assets/storage/piles/`.

- [ ] **Step 4: Inspect and validate every final asset**

Open a contact sheet plus any ambiguous individual image. Confirm transparent corners, no green fringe, no lettering, category recognition, and consistent framing. Then run:

Run: `node --test tests/storage-pile-assets.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add assets/storage/piles tests/storage-pile-assets.test.mjs
git commit -m "feat: add ground pile category tokens"
```

---

### Task 8: Full Regression and Live Foundry Verification

**Files:**
- Modify: `module.json`
- Modify when failures expose defects: only files already named in Tasks 1-7
- Test: all `tests/*.test.mjs`

**Interfaces:**
- Consumes: complete grid, transfer, pile, hook, and asset implementation.
- Produces: module version `1.4.114` and verified live behavior.

- [ ] **Step 1: Bump the module version and update cache-busting imports that use the module version fallback**

Change `module.json` from `1.4.113` to `1.4.114`. Do not mechanically rewrite unrelated historical query suffixes.

- [ ] **Step 2: Run syntax and whitespace checks**

Run: `git diff --check`

Run: `Get-ChildItem scripts -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }`

Expected: all commands exit zero.

- [ ] **Step 3: Run the complete automated suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 4: Perform live Foundry checks at `https://vtt.rebreya.com/`**

Use the existing `CODEX` profile. Verify a six-cell chest grid, left-click popover and document link, partial self and party claims, actor-sheet drop, group-inventory drop, canvas pile creation, same-item merge, category presentation changes, five-foot denial, and empty-pile deletion. Inspect the browser console for new `rebreya-main` errors.

- [ ] **Step 5: Review the final diff and commit verification changes**

```powershell
git diff --check
git status --short
git diff --stat origin/lich_branch...HEAD
git add module.json
git commit -m "chore: release compact storage piles"
```

- [ ] **Step 6: Push without force**

```powershell
git push origin lich_branch
```
