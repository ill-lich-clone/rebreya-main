# Inventory folder batch actions, provenance, and pinned folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Follow the tasks in order and do not skip red/green verification.

**Goal:** Add safe sequential folder-wide sale/dismantle actions, folder-aware dismantle routing, ten-entry item provenance, personal sticky pinned folders, and the shorter `1 шт.` price caption.

**Architecture:** `InventoryService` remains the sole mutation owner. One exact typed folder-batch command reaches the active GM, which snapshots the selected scope and awaits existing durable single-item mutations one by one. Provenance is normalized by a new pure data helper and stored as part of the same prepared target receipts that create or merge inventory Items. Folder traversal and pinned-ID normalization stay pure in `inventory-folder-tree.js`; `InventoryApp` only projects state, prompts, and calls public APIs.

**Tech Stack:** Foundry VTT 13, dnd5e, JavaScript ES modules, ApplicationV2/DialogV2, Handlebars, CSS, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-inventory-folder-batch-provenance-design.md`

## Global Constraints

- Work only on `lich_branch`; before edits run the repository Git preflight from `AGENTS.md`. Stop on foreign working-tree changes, a remote `lich_branch` advance, or conflicting `origin/main` changes.
- Use TDD in every task: add the focused failing assertion, run it and observe the intended failure, then implement the minimum behavior.
- Do not add a second inventory app, folder-state owner, ingress-rule evaluator, sale implementation, or dismantle implementation.
- The client sends exactly one batch socket request. The active GM uses a normal `for...of`/indexed loop with `await`; do not use `Promise.all`, fire-and-forget calls, or one socket call per Item.
- Existing single-item mutation journals remain the durable boundary. Do not add a persisted parent batch queue.
- UI code never writes Actor Items, Actor flags, world settings, or another user's flags.
- Dismantle must fail authoritatively for root Items, even if a stale client exposes an action.
- Magical Items are never sold; treasures use 100% price; other eligible non-magical Items use 50% price.
- Every provenance display value is escaped by Handlebars or assigned with `textContent`; never interpolate stored text into raw HTML.
- Keep Russian source, templates, and JSON in UTF-8.
- Any client-visible change requires release `1.4.318`, matching `scripts/main-1.4.318.js`, `module.json`, and changed inbound cache keys.
- Update `docs/function-passport.md` for every added or changed method/data flow in the same implementation commit.

## Review Focus

- A root Item must be rejected before a dismantle target receipt is prepared; covered in Task 5.
- A treasure, an ordinary Item, a magical Item, and a zero-price Item must resolve to four distinct sale outcomes; covered in Task 4.
- An incoming material matching a folder rule, a skip rule, no rule, or a forbidden recursive-dismantle result must take the specified path; covered in Task 5.
- Eleven provenance events merged into one stack must keep the newest ten, and compensation must restore both quantity and prior history; covered in Tasks 2 and 6.
- A stale pinned folder drop must fail closed and must never move the Item to root; covered in Task 8.
- Re-running a batch with the same `operationId` must reuse deterministic per-Item child IDs without double-selling or double-dismantling; covered in Task 7.

---

### Task 1: Pure folder scope and pinned-ID primitives

**Files:**
- Modify: `scripts/data/inventory-folder-tree.js`
- Test: `tests/inventory-folder-tree.test.mjs`

**Interfaces:**
- Add `normalizePinnedFolderIds(rawIds, { folderIds }) -> string[]`.
- Add `selectInventoryFolderItemIds({ state, items, folderId, includeDescendants, compareItems }) -> string[]`.
- Preserve input objects and arrays; return detached data.

- [ ] **Step 1: Write failing pure tests**

Add tests equivalent to:

```js
test("folder batch selection is deterministic and direct by default", () => {
  const state = normalizeInventoryFolderState({
    version: 1,
    folders: [
      { id: "root-a", name: "A", parentId: null },
      { id: "child-b", name: "B", parentId: "root-a" }
    ],
    itemFolderIds: { direct: "root-a", nested: "child-b", outside: "other" }
  }, { itemIds: ["direct", "nested", "outside"] });
  const items = [{ itemId: "nested", name: "B" }, { itemId: "direct", name: "A" }];
  assert.deepEqual(selectInventoryFolderItemIds({ state, items, folderId: "root-a" }), ["direct"]);
  assert.deepEqual(selectInventoryFolderItemIds({
    state, items, folderId: "root-a", includeDescendants: true
  }), ["direct", "nested"]);
});

test("folder batch selection rejects a missing folder and pinned normalization is immutable", () => {
  const raw = ["valid", "stale", "valid"];
  assert.deepEqual(normalizePinnedFolderIds(raw, { folderIds: ["valid"] }), ["valid"]);
  assert.deepEqual(raw, ["valid", "stale", "valid"]);
  assert.throws(() => selectInventoryFolderItemIds({
    state: { version: 1, folders: [], itemFolderIds: {} },
    items: [], folderId: "missing"
  }), error => error?.code === "folder-not-found");
});
```

- [ ] **Step 2: Run the focused test and verify missing exports**

Run: `node --test tests/inventory-folder-tree.test.mjs`

Expected: FAIL because `normalizePinnedFolderIds` and `selectInventoryFolderItemIds` are not exported.

- [ ] **Step 3: Implement the two pure primitives**

Use the existing `cleanId`, `normalizeInventoryFolderState`, and `buildInventoryFolderTree`. `normalizePinnedFolderIds` should share the same validation/deduplication semantics as `normalizeExpandedFolderIds` without aliasing the returned array. `selectInventoryFolderItemIds` should:

```js
export function selectInventoryFolderItemIds({
  state, items = [], folderId, includeDescendants = false, compareItems
} = {}) {
  const tree = buildInventoryFolderTree({ state, items, compareItems });
  const start = tree.foldersById.get(cleanId(folderId));
  if (!start) throw new InventoryFolderStateError("folder-not-found", "Folder was not found.");
  const selected = [];
  const visit = node => {
    selected.push(...node.items.map(itemIdOf));
    if (includeDescendants) for (const child of node.folders) visit(child);
  };
  visit(start);
  return selected;
}
```

Confirm the tree's existing sort establishes folder-name and caller-provided Item order. Do not change folder-state version 1.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/inventory-folder-tree.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the pure primitives**

```powershell
git add scripts/data/inventory-folder-tree.js tests/inventory-folder-tree.test.mjs
git commit -m "feat: add inventory folder scope helpers"
```

---

### Task 2: Versioned item acquisition-history model

**Files:**
- Create: `scripts/data/inventory-acquisition-history.js`
- Create: `tests/inventory-acquisition-history.test.mjs`

**Interfaces:**
- Export `INVENTORY_ACQUISITION_HISTORY_FLAG = "inventoryAcquisitionHistory"`.
- Export `INVENTORY_ACQUISITION_HISTORY_VERSION = 1` and `MAX_INVENTORY_ACQUISITION_ENTRIES = 10`.
- Export `normalizeInventoryAcquisitionEntry(raw) -> object|null`.
- Export `normalizeInventoryAcquisitionHistory(raw) -> { version: 1, entries: object[] }`.
- Export `readInventoryAcquisitionHistory(itemData) -> normalized history`.
- Export `appendInventoryAcquisitionEntry(rawHistory, entry) -> normalized history`.
- Export `writeInventoryAcquisitionHistory(itemData, history) -> cloned ItemData`.

- [ ] **Step 1: Write failing model tests**

Cover trimming, finite-number validation, enum fallback to `other`, newest-first sorting, stable ordering for equal timestamps, no input mutation, and the ten-entry cap:

```js
test("acquisition history keeps the newest ten detached valid entries", () => {
  const raw = { version: 1, entries: Array.from({ length: 11 }, (_, index) => ({
    recordedAt: index + 1,
    worldTime: null,
    quantity: 1,
    method: "storage",
    sceneId: "",
    sceneName: " Сцена ",
    sourceType: "token",
    sourceId: String(index),
    sourceName: `Источник ${index}`,
    detail: ""
  })) };
  const result = normalizeInventoryAcquisitionHistory(raw);
  assert.equal(result.entries.length, 10);
  assert.deepEqual(result.entries.map(entry => entry.recordedAt), [11,10,9,8,7,6,5,4,3,2]);
  assert.equal(result.entries[0].sceneName, "Сцена");
  assert.equal(raw.entries[0].sceneName, " Сцена ");
});

test("append rejects invalid quantity and read treats legacy data as empty", () => {
  assert.deepEqual(readInventoryAcquisitionHistory({}), { version: 1, entries: [] });
  assert.deepEqual(appendInventoryAcquisitionEntry(null, { recordedAt: 1, quantity: NaN }), {
    version: 1, entries: []
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing-module failure**

Run: `node --test tests/inventory-acquisition-history.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement normalization and flag writing**

Use plain JS only; do not depend on Foundry globals. Bounds: display strings 160 characters, `detail` 500 characters, IDs 160 characters. Accept only positive finite `quantity`, finite non-negative `recordedAt`, and `worldTime === null` or finite `worldTime`. Normalize this exact entry shape:

```js
{
  recordedAt,
  worldTime,
  quantity,
  method, // lootgen|storage|transfer|manual|dismantle|other
  sceneId,
  sceneName,
  sourceType,
  sourceId,
  sourceName,
  detail
}
```

`writeInventoryAcquisitionHistory` must create `flags["rebreya-main"]` on a detached clone and must not mutate the caller's ItemData.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/inventory-acquisition-history.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the pure model**

```powershell
git add scripts/data/inventory-acquisition-history.js tests/inventory-acquisition-history.test.mjs
git commit -m "feat: model inventory acquisition history"
```

---

### Task 3: Personal pinned-folder state v2

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/inventory-folder-socket.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Change `INVENTORY_FOLDER_UI_STATE_VERSION` from 1 to 2.
- `getInventoryFolderUiState(groupActorId, folderIds)` returns `{ version: 2, groupActorId, expandedFolderIds, pinnedFolderIds }`.
- Add `InventoryService.setInventoryFolderPinned(groupActorId, folderId, pinned)`.
- Add `RebreyaMainModule.setInventoryFolderPinned(groupActorId, folderId, pinned)` passthrough.
- Keep User-flag writes on queue `inventory-folder-ui:<userId>`; no socket or Actor write.

- [ ] **Step 1: Extend the existing User-flag tests first**

Change the version assertions to 2 and add:

```js
test("folder UI state migrates v1 expansion and keeps pins personal", async () => {
  // Seed v1 with expanded ["a", "stale"]. Read with folders ["a", "b"].
  // Expect { version:2, expandedFolderIds:["a"], pinnedFolderIds:[] }.
  // Pin b, then collapse a. Expect both writes to preserve the other array.
  // Assert group Actor flags, world settings, and socket emissions remain untouched.
});

test("folder UI state filters stale pins independently per group and user", async () => {
  // Seed v2 groups A and B, including stale ids. Switch fixture current user.
  // Assert each caller only reads/writes its own User document.
});
```

Add a composition-root source assertion that the public API exposes exactly one `setInventoryFolderPinned` method and no socket registration for pins.

- [ ] **Step 2: Run the focused tests and verify version/API failures**

Run: `node --test tests/inventory-folder-socket.test.mjs tests/main-composition-root.test.mjs`

Expected: FAIL because v1 is returned and `setInventoryFolderPinned` is missing.

- [ ] **Step 3: Implement a shared queued UI-state writer**

Import `normalizePinnedFolderIds` from the folder-tree owner. Refactor the duplicate read/write logic into private helpers within `InventoryService`, for example:

```js
#readInventoryFolderUiGroup(rawState, actorId, folderIds) {
  const fromV1 = rawState?.version === 1;
  const group = rawState?.groups?.[actorId] ?? {};
  return {
    expandedFolderIds: normalizeExpandedFolderIds(group.expandedFolderIds, { folderIds }),
    pinnedFolderIds: normalizePinnedFolderIds(fromV1 ? [] : group.pinnedFolderIds, { folderIds })
  };
}
```

The writer must preserve all other groups, preserve both arrays for the current group, validate folder existence only when adding, and normalize deleted IDs on every read/write. Do not mutate v1 state in place; the first explicit write persists v2.

- [ ] **Step 4: Expose the personal pin API from the composition root**

Add next to `setInventoryFolderExpanded`:

```js
setInventoryFolderPinned(groupActorId, folderId, pinned) {
  return this.inventoryService.setInventoryFolderPinned(groupActorId, folderId, pinned);
}
```

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/inventory-folder-socket.test.mjs tests/main-composition-root.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit personal pin state**

```powershell
git add scripts/data/inventory-service.js scripts/main.js tests/inventory-folder-socket.test.mjs tests/main-composition-root.test.mjs
git commit -m "feat: persist personal inventory folder pins"
```

---

### Task 4: Canonical sale quote for treasure, ordinary, magical, and valueless Items

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `tests/inventory-mutation-recovery.test.mjs`

**Interfaces:**
- Export `resolveInventorySaleQuote(itemData, quantity = 1) -> { eligible, code, message, quantity, unitCopper, multiplier, gainedCopper }`.
- Reuse it inside `#executeSellInventoryItem`; keep receipt order and compensation unchanged.

- [ ] **Step 1: Write the four sale-outcome tests**

Add focused assertions for:

```js
assert.deepEqual(resolveInventorySaleQuote(treasure, 2), {
  eligible: true, code: "sellable", message: "", quantity: 2,
  unitCopper: 100, multiplier: 1, gainedCopper: 200
});
assert.equal(resolveInventorySaleQuote(ordinary, 2).gainedCopper, 100);
assert.equal(resolveInventorySaleQuote(magical, 1).code, "magical-item");
assert.equal(resolveInventorySaleQuote(zeroPrice, 1).code, "no-price");
```

Also keep a journal/retry test proving the credited currency and source debit are unchanged on repeated execution.

- [ ] **Step 2: Run the focused recovery test and verify treasure failure**

Run: `node --test --test-name-pattern="sale|treasure|magical|price" tests/inventory-mutation-recovery.test.mjs`

Expected: FAIL because treasure currently receives the universal 50% multiplier and the helper is absent.

- [ ] **Step 3: Implement and use the quote**

Use `isMagicalInventoryItem(itemData)` first. Classify treasure only with:

```js
const multiplier = foundry.utils.getProperty(itemData, "system.type.value") === "treasure" ? 1 : 0.5;
```

Clamp quantity exactly as the current sale path does. A non-positive unit price or total produces `eligible:false, code:"no-price"`. Replace the current inline magical/price logic with the helper, then persist `quote.gainedCopper` in the existing journal record.

- [ ] **Step 4: Run focused tests**

Run: `node --test --test-name-pattern="sale|treasure|magical|price" tests/inventory-mutation-recovery.test.mjs`

Expected: matching tests PASS.

- [ ] **Step 5: Commit canonical sale pricing**

```powershell
git add scripts/data/inventory-service.js tests/inventory-mutation-recovery.test.mjs
git commit -m "feat: apply treasure-aware inventory sale pricing"
```

---

### Task 5: Require a folder for dismantle and route material through ingress rules

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `tests/inventory-mutation-recovery.test.mjs`

**Interfaces:**
- Add a private `#prepareDismantleRouting(inventoryActor, sourceItem, materialItemData, outputQuantity)` returning `{ sourceFolderId, rulesRevision, matchedRuleId, outcome, destinationFolderId }`.
- Extend durable `dismantle` records with `sourceFolderId`, `rulesRevision`, `matchedRuleId`, `routingOutcome`, and `destinationFolderId` before target credit.
- Extend dismantle target receipts with folder assignment and before/after provenance fields in preparation for Task 6.

- [ ] **Step 1: Write failing folder-gate and route tests**

Add tests for all review-focus paths:

```js
test("dismantle rejects an Item at inventory root before target credit", async () => {
  // Source item exists but inventoryFolders.itemFolderIds has no entry.
  // Expect folder-required code/message, zero create/update calls, unchanged source.
});

test("dismantle routes material by folder rule, skip rule, then source-folder fallback", async () => {
  // Run isolated operations against: matching folder rule -> target folder;
  // matching skip rule -> no material and source remains untouched;
  // no rule -> source folder. Assert prepared journal fields.
});

test("dismantle never recursively dismantles a material and merges only in destination folder", async () => {
  // Planner returns action:dismantle: expect fail closed before credit.
  // Place equal material stacks in two folders and assert only destination stack changes.
});
```

Add recovery assertions: after journal preparation, changing ingress rules does not change `destinationFolderId`; deleting that folder yields reconciliation-required behavior rather than a root fallback.

- [ ] **Step 2: Run focused tests and verify current global-merge/root behavior fails**

Run: `node --test --test-name-pattern="dismantle.*folder|dismantle.*route|dismantle.*merge" tests/inventory-mutation-recovery.test.mjs`

Expected: FAIL because root Items are accepted and merge is currently unscoped.

- [ ] **Step 3: Add the authoritative folder gate**

Inside the `!record` preparation branch, read current folder state and require:

```js
const sourceFolderId = cleanId(folderState.itemFolderIds[item.id]);
if (!sourceFolderId || !folderState.folders.some(folder => folder.id === sourceFolderId)) {
  const error = new InventoryFolderStateError(
    "folder-required",
    "Чтобы разобрать предмет, сначала поместите его в папку."
  );
  throw error;
}
```

Do this before material target selection or journal creation.

- [ ] **Step 4: Evaluate the server-derived material with the existing planner**

Build one trusted row with `legacyFolderId: sourceFolderId`, call only `inventoryIngressPlanner.preview`, and do not call `collectChoices` for this internal output. Accept:

- `action.type === "folder"`: use its validated folder;
- `action.type === "skip"`: return a committed no-change dismantle result without debiting the source;
- the no-match legacy action: use `sourceFolderId`;
- `root`, `dismantle`, a missing folder, or any other impossible result: throw an invariant/reconciliation error before credit.

Record the authoritative planner revision, matched rule, outcome, and destination in the initial durable record. On retry, use only recorded routing values.

- [ ] **Step 5: Scope target merge and folder assignment**

Call `#findInventoryMergeCandidate` with `{ folderState, folderId: destinationFolderId, scoped: true }`. For a newly created material, write the folder membership after target creation and before source debit, using the same recovery checks as ingress. A disappeared destination during retry must stop for reconciliation.

- [ ] **Step 6: Run focused tests**

Run: `node --test --test-name-pattern="dismantle" tests/inventory-mutation-recovery.test.mjs`

Expected: all dismantle tests PASS, including legacy fractional repair tests.

- [ ] **Step 7: Commit folder-aware dismantle**

```powershell
git add scripts/data/inventory-service.js tests/inventory-mutation-recovery.test.mjs
git commit -m "feat: route dismantled materials through inventory rules"
```

---

### Task 6: Capture provenance atomically across inventory ingress and dismantle

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/inventory-acquisition-history.test.mjs`
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`

**Interfaces:**
- In trusted ingress rows add detached `acquisition` using the Task 2 entry shape.
- Preserve it in `#inventoryIngressDerivedRow` and durable ingress records.
- Add private `#buildInventoryAcquisitionEntry({ sourceOrigin, sourceRow, quantity, context })` for canonical methods.
- `#buildInventoryEntry` exposes normalized `acquisitionHistory` to UI snapshots.
- Target receipts persist `beforeAcquisitionHistory` and `afterAcquisitionHistory` for create, merge, retry, and compensation.

- [ ] **Step 1: Write failing create/merge/compensation tests**

Cover these cases:

- a new lootgen Item receives known source/scene fields;
- a storage ingress receives storage token/Actor and explicit scene only;
- an imported Item receives source Actor/token context;
- manual/public-model ingress records `Ручное добавление` and acting user;
- a merge appends one event while preserving older entries and caps eleven to newest ten;
- same-group `moveInventoryItemToFolder` does not append;
- a failed source debit restores the merge target's quantity and exact prior history;
- retry does not append a duplicate event.

Use intentionally HTML-like names (`<Гоблин>`) in model tests to preserve raw text for later safe rendering.

- [ ] **Step 2: Run focused tests and verify missing history**

Run: `node --test --test-name-pattern="acquisition|provenance|history" tests/inventory-acquisition-history.test.mjs tests/inventory-mutation-recovery.test.mjs`

Expected: FAIL because ingress receipts do not store or apply acquisition history.

- [ ] **Step 3: Attach provenance before journal preparation**

Import the pure helper. Populate `row.acquisition` only from authoritative context already known by each canonical adapter. Use `Date.now()` for `recordedAt` and `game.time?.worldTime` when finite. Do not infer a scene from the currently selected canvas/token.

Map methods exactly:

```js
const METHOD_BY_ORIGIN = {
  lootgen: "lootgen",
  storage: "storage",
  import: "transfer",
  "public-model": "manual",
  "manual-entry": "manual"
};
```

For unavailable fields store `""`/`null`. Ensure socket validators accept only the existing request shapes: source context is derived server-side or from already validated trusted loot/storage data, never accepted as arbitrary client provenance.

- [ ] **Step 4: Make ingress target receipts atomic for quantity plus history**

During `#prepareInventoryIngressTargetReceipts` compute:

```js
const beforeAcquisitionHistory = readInventoryAcquisitionHistory(candidate?.toObject?.() ?? {});
const afterAcquisitionHistory = appendInventoryAcquisitionEntry(
  beforeAcquisitionHistory,
  { ...row.acquisition, quantity: target.quantity }
);
```

For create, embed `afterAcquisitionHistory` in `receipt.itemData`. For merge, update both `system.quantity` and `flags.rebreya-main.inventoryAcquisitionHistory` in one `item.update`. Recovery observes both fields; a state where only one matches is reconciliation-required. Compensation restores both prior fields together.

- [ ] **Step 5: Add dismantle provenance and inheritance**

Build the material event with `method:"dismantle"`, `sourceType:"item"`, source Item ID/name, and `sourceName: "Разбор — <имя предмета>"`. Derive `detail` from only the newest normalized source entry (scene/source label), not arbitrary Item description. Apply the same before/after receipt logic to created and merged material targets and compensation.

- [ ] **Step 6: Expose normalized history in snapshots**

Extend `#buildInventoryEntry` with:

```js
acquisitionHistory: readInventoryAcquisitionHistory(itemData)
```

Existing Items return `{ version:1, entries:[] }` without a write.

- [ ] **Step 7: Run focused tests**

Run: `node --test --test-name-pattern="acquisition|provenance|history|ingress|dismantle" tests/inventory-acquisition-history.test.mjs tests/inventory-mutation-recovery.test.mjs tests/group-command-dispatch.test.mjs`

Expected: matching tests PASS.

- [ ] **Step 8: Commit atomic provenance**

```powershell
git add scripts/data/inventory-acquisition-history.js scripts/data/inventory-service.js scripts/main.js tests/inventory-acquisition-history.test.mjs tests/inventory-mutation-recovery.test.mjs tests/group-command-dispatch.test.mjs
git commit -m "feat: record inventory item acquisition sources"
```

---

### Task 7: One typed sequential folder-batch command

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/inventory-folder-socket.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Export `INVENTORY_FOLDER_BATCH_COMMAND = "inventory.folder.batch"`.
- Add exact validator for `{ groupActorId, folderId, action, includeDescendants, operationId }`.
- Add `InventoryService.executeInventoryFolderBatch(payload) -> report`.
- Add `RebreyaMainModule.runInventoryFolderBatch(payload) -> report`, routing one request for non-active-GM clients and direct execution on the active GM.
- Add pure private/stable child ID builder whose output is at most 160 characters and depends on full `(operationId, action, itemId)`.

- [ ] **Step 1: Write command contract and authorization tests**

Add the command to the existing table-driven socket suite. Assert acceptance of the exact payload and rejection of extra keys, blank IDs, invalid action, non-boolean recursion, and overlong operation ID. Assert:

- active GM and participating inventory manager are authorized through the existing `#canSenderManageGroup` rule;
- foreign/unknown/forged senders are rejected;
- scheduling uses only `groupKey(groupActorId)`;
- a player call emits exactly one request and does not run local child mutations;
- active GM executes locally and does not emit.

- [ ] **Step 2: Write batch execution tests**

Use three Items and instrument the existing single-item primitives. Assert the event sequence is strictly:

```js
["start:a", "finish:a", "start:b", "finish:b", "start:c", "finish:c"]
```

Add tests for direct vs recursive captured scope, moved/disappeared Item skip, magical/no-price/non-dismantlable skip, ordinary isolated failure continuation, reconciliation failure stop, totals, and an empty batch with zero writes. Repeat the same payload and assert deterministic child IDs prevent duplicate effects.

- [ ] **Step 3: Run focused tests and verify missing command/API failures**

Run: `node --test --test-name-pattern="folder batch|inventory.folder.batch|sequential" tests/inventory-folder-socket.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-mutation-recovery.test.mjs tests/main-composition-root.test.mjs`

Expected: FAIL because the command and execution methods are absent.

- [ ] **Step 4: Register the exact typed command**

In `main.js`, import the constant, add `isValidInventoryFolderBatchPayload`, and register:

```js
this.socketCommandBus.register(INVENTORY_FOLDER_BATCH_COMMAND, {
  validate: isValidInventoryFolderBatchPayload,
  authorize: (payload, { sender }) => this.#canSenderManageGroup(sender, payload.groupActorId),
  scheduling: keyedMutationScheduling(payload => [groupKey(payload.groupActorId)]),
  execute: payload => this.inventoryService.executeInventoryFolderBatch(payload)
});
```

The public method clones/validates once, sends one request if not active GM, and schedules one UI refresh after the returned report.

- [ ] **Step 5: Implement authoritative snapshot and sequential execution**

At execution start re-resolve a managed group Actor, current folder state, permissions, and Items. Use Task 1 selection to capture the ordered Item IDs. Then:

```js
for (const itemId of selectedItemIds) {
  // Re-read the Item and current membership before its turn.
  // Push known ineligible/moved/missing cases to skipped.
  // await exactly one existing sale or dismantle primitive.
  // Push ordinary failures and continue.
  // On reconciliation/invariant error set stopped=true and break.
}
```

For sale, use the canonical quote before calling the child primitive and sell the full current stack. For dismantle, use the existing minimum/full-stack semantics. Derive each child mutation ID with a compact deterministic hash (for example two seeded 32-bit FNV-1a passes encoded in base36) so distinct full tuples cannot be truncated into the same prefix. Do not wrap the whole loop in the same `mutationCoordinator` key used by the child primitives.

Return detached plain data with exact keys:

```js
{
  action, folderId, includeDescendants,
  processed: [], skipped: [], failed: [], stopped: false,
  totals: { gainedCopper: 0, materials: [] }
}
```

Stable skip codes include `item-missing`, `item-moved`, `magical-item`, `no-price`, `not-dismantlable`, and `folder-required`. Never translate authorization failures into skips.

- [ ] **Step 6: Run focused tests**

Run: `node --test --test-name-pattern="folder batch|inventory.folder.batch|sequential" tests/inventory-folder-socket.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-mutation-recovery.test.mjs tests/main-composition-root.test.mjs`

Expected: matching tests PASS.

- [ ] **Step 7: Commit the batch command**

```powershell
git add scripts/data/inventory-service.js scripts/main.js tests/inventory-folder-socket.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-mutation-recovery.test.mjs tests/main-composition-root.test.mjs
git commit -m "feat: add sequential inventory folder actions"
```

---

### Task 8: Inventory UI for batch actions, source dialog, pins, and safe drops

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Add private UI helpers `#promptInventoryFolderBatch`, `#showInventoryFolderBatchReport`, `#showInventoryAcquisitionHistory`, and `#setInventoryFolderPinned`.
- Context rows expose current pin state; inventory context exposes `pinnedInventoryFolders` only in main Item mode.
- Use existing `moveInventoryItemToFolder` for pinned drop; add no new move command.

- [ ] **Step 1: Write failing context/template/action tests**

Extend the current lightweight DOM fixture and assert:

- folder menu retains existing actions and adds `Продать всё`, `Разобрать всё`, and `Закрепить`/`Открепить`;
- cancel/escape/close causes zero calls;
- confirm defaults `includeDescendants:false`, checkbox produces `true`, and each confirmation calls `runInventoryFolderBatch` exactly once;
- completion report shows processed/skipped/failed/totals and emphasizes `stopped:true`;
- main inventory context projects pinned folder color/name/recursive count; folder popout and ingress-rule mode do not;
- pin action calls only `setInventoryFolderPinned`;
- info button appears immediately before quantity and opens newest-first history, including `Источник не записан` for empty data;
- malicious `<Гоблин>` source text is escaped/not inserted as markup;
- template contains `<span>1 шт.</span>` and no `Цена за 1 шт.`.

- [ ] **Step 2: Write failing pinned-drop tests**

Simulate drag/drop after scroll. Assert the handler fetches a fresh snapshot, resolves the same group and current folder, then calls the existing move API. For a deleted/stale pin assert an error notification + refresh, zero move calls, and specifically no `{ folderId:null }` fallback.

- [ ] **Step 3: Run UI tests and verify missing controls**

Run: `node --test --test-name-pattern="folder menu|batch|pinned|source|price|drop" tests/inventory-app-context.test.mjs`

Expected: FAIL because the new controls/context are absent and the old caption remains.

- [ ] **Step 4: Project personal pins and row dismantle eligibility**

When refreshing the group snapshot, retain `expandedFolderIds` and `pinnedFolderIds`. Resolve pins through `inventoryFolderTreeCache.foldersById` and build only detached view rows. In the main inventory Item mode, expose:

```js
pinnedInventoryFolders: pinnedFolderIds.flatMap(id => {
  const folder = tree.foldersById.get(id);
  return folder ? [{
    folderId: id,
    name: folder.name,
    color: folder.color,
    recursiveItemCount: folder.recursiveItemCount
  }] : [];
})
```

Set `canDismantle` false when `item.folderId === null`, while retaining the authoritative service gate.

- [ ] **Step 5: Add dialogs and context actions**

The batch confirmation must name the folder, show cached direct eligible/skipped counts as advisory, and include an unchecked `Включая вложенные папки` checkbox. Generate `operationId` once after confirmation, call `moduleApi.runInventoryFolderBatch(...)` once, refresh once, then show the report. Do not refresh per processed Item.

The history dialog renders at most ten normalized entries. Prefer building DOM nodes and assigning `textContent`; if constructing DialogV2 content, pass every stored field through the existing `escapeHtml` helper.

- [ ] **Step 6: Add sticky markup and styles**

Place the pinned strip immediately below the inventory toolbar and before the scrollable tree body. Each button has `data-folder-drop-id`, an accessible name, keyboard focus, folder color marker, name, and recursive count. CSS must provide `position: sticky`, a top offset below the toolbar, opaque theme-compatible background, border, `z-index`, wrapping at narrow widths, `:focus-visible`, and existing drag-hover class feedback.

Change only the metric label text to `1 шт.`; preserve price calculation and `priceLabel`.

- [ ] **Step 7: Reuse fresh-snapshot drop validation**

Route pinned targets through the same drop parsing/resolution path as folder rows. Before mutation, call `getInventorySnapshot` for the exact group and verify the target folder still exists and the user can organize that group. On stale state warn, refresh, and return without a move.

- [ ] **Step 8: Run focused UI tests**

Run: `node --test tests/inventory-app-context.test.mjs`

Expected: all tests PASS.

- [ ] **Step 9: Commit the UI**

```powershell
git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: add inventory folder actions and pinned shortcuts"
```

---

### Task 9: Public contract, function passport, and release 1.4.318

**Files:**
- Modify: `README.md`
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.318.js`
- Modify: `scripts/main.js`
- Modify: changed inbound ES-module imports in `scripts/data/inventory-service.js`, `scripts/ui/inventory-app.js`, and their direct importers as required by the release graph
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Document `runInventoryFolderBatch`, `setInventoryFolderPinned`, acquisition-history flag v1, folder UI state v2, sale classification, and folder-required dismantle.
- Release forwarder remains exactly `import "./main.js";`.

- [ ] **Step 1: Add failing release assertions**

Update manifest tests to require:

```js
assert.equal(manifest.version, "1.4.318");
assert.deepEqual(manifest.esmodules, ["scripts/main-1.4.318.js"]);
assert.equal(read("scripts/main-1.4.318.js").trim(), 'import "./main.js";');
```

Extend composition-root/cache assertions for the changed inventory service, folder-tree, provenance helper, and UI imports. Assert old `main-1.4.317.js` is no longer referenced by runtime configuration; do not require deleting the historical forwarder.

- [ ] **Step 2: Run release tests and observe old-version failures**

Run: `node --test tests/module-manifest.test.mjs tests/main-composition-root.test.mjs`

Expected: FAIL because the manifest still declares `1.4.317`.

- [ ] **Step 3: Update documentation**

In `README.md`, update the existing inventory API/behavior section rather than adding a duplicate section. In `docs/function-passport.md`, update only the inventory/folder/ingress/UI and release-graph sections. Record signatures, owners, data flow, authorization, sequentiality, recovery boundaries, personal User flag v2 migration, history schema, and focused tests. Describe current state, not implementation history.

- [ ] **Step 4: Bump and synchronize the client release graph**

Set `module.json` to `1.4.318`, point `esmodules` to `scripts/main-1.4.318.js`, add the one-line forwarder, set `MODULE_STYLE_VERSION` to `1.4.318`, and change cache keys on every import whose exported surface or client code changed. Use `rg -n "1\.4\.317|main-1\.4\.317" module.json scripts tests docs/function-passport.md` to distinguish intentionally unchanged neighboring graphs from stale inventory references.

- [ ] **Step 5: Run release and focused inventory suites**

Run:

```powershell
node --test tests/module-manifest.test.mjs tests/main-composition-root.test.mjs
node --test tests/inventory-folder-tree.test.mjs tests/inventory-acquisition-history.test.mjs tests/inventory-folder-socket.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-app-context.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit documentation and release metadata**

```powershell
git add README.md docs/function-passport.md module.json scripts/main-1.4.318.js scripts/main.js scripts/data/inventory-service.js scripts/data/inventory-folder-tree.js scripts/data/inventory-acquisition-history.js scripts/ui/inventory-app.js tests/module-manifest.test.mjs tests/main-composition-root.test.mjs
git commit -m "chore: release inventory folder workflow 1.4.318"
```

---

### Task 10: Full verification, live Foundry check, and delivery

**Files:**
- Verify only; modify production files only if a failing check reveals a defect, then add a regression test and repeat the affected focused task.

- [ ] **Step 1: Confirm the final diff scope before verification**

Run:

```powershell
git status --short --branch
git diff --check
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only planned files/commits, no whitespace errors, no foreign changes.

- [ ] **Step 2: Run the full automated suite once on the final tree**

```powershell
node --test tests/*.test.mjs
```

Record exact passed/failed counts and real failures. Do not paste the full successful log.

- [ ] **Step 3: Validate every tracked JS/MJS and JSON file**

```powershell
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: every file exits successfully. Record counts.

- [ ] **Step 4: Perform live Foundry VTT 13 verification when capture is available**

Use the installed dnd5e world and check, as both GM and player where possible:

- direct and recursive folder confirmation;
- exactly one player batch request and visibly sequential results;
- treasure 100%, ordinary 50%, magical untouched;
- dismantle rule folder, skip, and same-folder fallback;
- ten-entry Russian source dialog and empty legacy state;
- different personal pins for two users;
- sticky pinned drop after scrolling to the bottom;
- narrow viewport/default and alternate theme;
- no new console exceptions, duplicate hooks, or deprecation warnings.

If screen capture remains disabled, report live visual verification as unavailable rather than claiming it passed; automated tests and source inspection remain mandatory.

- [ ] **Step 5: Apply verification-before-completion discipline**

Re-run `git diff --check` only if verification caused changes. Inspect `git status --short --branch` and verify `HEAD` is the tested commit. If a repair changed `HEAD`, rerun the affected focused tests and the full suite.

- [ ] **Step 6: Push without force and report**

```powershell
git push -u origin lich_branch
```

Report the final commit, push result, automated pass/fail counts, syntax/JSON counts, live-check result, and any intentionally unavailable check. Never force-push.
