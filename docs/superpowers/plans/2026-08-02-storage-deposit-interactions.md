# Storage Deposit and Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storage item popovers reliable and let users return items to a storage token by holding a drag over it for one second and dropping a chosen quantity.

**Architecture:** Keep storage state mutations authoritative in `StorageService` and `StorageCommandService`, expose one strict active-GM socket command for deposits, and isolate drag-hover presentation in a new token-drop integration. Reuse Foundry item drag payloads, the existing Rebreya storage-row payload, quantity dialog, storage update hook, and token overlay positioning.

**Tech Stack:** Foundry VTT v13 ApplicationV2 and Hooks, dnd5e embedded Item documents, ES modules, Handlebars, CSS, Node `node:test`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Do not use force push.
- Do not add any runtime dependency on Item Piles.
- Non-GM storage access remains limited to visible targets within 5 feet of the controlled owned character token.
- Character, party-inventory, and ground-pile sources move quantities; world and compendium sources copy quantities.
- No subagents are used; execution stays inline in this task.
- Do not delete a scene token unless its UUID and Rebreya flags positively identify it as the prior test token.

---

## File map

- Create `scripts/data/storage-deposit-source.js`: parse Foundry/Rebreya drag data, resolve source kind, build a storage row, consume or restore movable sources.
- Create `scripts/integrations/storage-token-drop.js`: token hit testing, one-second hover timer, overlay feedback, highlight cleanup, quantity prompt, and deposit dispatch.
- Create `tests/storage-deposit-source.test.mjs`: source classification, stack quantities, move/copy behavior, and restoration.
- Create `tests/storage-token-drop.test.mjs`: delayed feedback, cleanup, invalid payloads, and successful drop dispatch.
- Modify `scripts/data/storage-service.js`: merge deposited rows and reopen empty storage without creating a token.
- Modify `scripts/data/storage-command-service.js`: validate and execute idempotent authorized deposit commands with rollback.
- Modify `scripts/main.js`: register socket/API/drop integration and update the dynamic storage-app cache key.
- Modify `scripts/ui/storage-app.js`: make LKM and PKM share a robust popover action and accept deposits in the GM configuration dropzone through the new API.
- Modify `scripts/ui/storage-token-overlay.js`: support persistent drag feedback and deterministic cleanup.
- Modify `styles/main.css`: interactive popover stacking and storage-token drop-ready presentation.
- Modify `module.json`: advance the module version so Foundry reloads fixed scripts and styles together.
- Modify storage tests covering the affected service, command, app, overlay, and main registrations.

---

### Task 1: Reliable storage item popovers

**Files:**
- Modify: `scripts/ui/storage-app.js:160-450`
- Modify: `styles/main.css:12480-12870`
- Test: `tests/storage-app.test.mjs`

**Interfaces:**
- Consumes: `StorageApp.activeRowId`, `StorageApp.#renderCurrent()`.
- Produces: delegated `click` and `contextmenu` handlers that call one popover-toggle path.

- [ ] **Step 1: Write failing interaction tests**

Add a context-menu test beside `LKM opens an item popover`:

```js
test("PKM opens the same item popover and suppresses the native menu", async () => {
  const { app } = createApp();
  const listeners = new Map();
  app.render = async () => {};
  app.element = new class extends FakeElement {
    addEventListener(name, callback) { listeners.set(name, callback); }
  }();
  await app._prepareContext();
  app._onRender({}, {});
  let prevented = 0;
  let stopped = 0;
  const icon = {
    dataset: { action: "storage-toggle-row", rowId: "row-1" },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  };
  await listeners.get("contextmenu")({
    target: icon,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; }
  });
  assert.equal(app.activeRowId, "row-1");
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});
```

Also assert that `.rm-storage-item__popover` has `pointer-events: auto` and that the storage window content does not clip an expanded popover.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/storage-app.test.mjs`

Expected: FAIL because no `contextmenu` listener is registered.

- [ ] **Step 3: Implement one synchronous action extractor**

Register both events in `_onRender`; the PKM handler accepts only item/coin toggle controls and calls the same action method:

```js
root.addEventListener("click", (event) => this.#onActionEvent(event), listenerOptions);
root.addEventListener("contextmenu", (event) => {
  const control = event.target?.closest?.("[data-action='storage-toggle-row'], [data-action='storage-toggle-coins']");
  if (!control) return;
  event.preventDefault();
  event.stopPropagation();
  void this.#onActionEvent(event, control);
}, listenerOptions);
```

Call `preventDefault()` before the first `await` for recognized actions. Add scoped CSS so the popover receives pointer events and appears above neighboring grid cells.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/storage-app.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/ui/storage-app.js styles/main.css tests/storage-app.test.mjs
git commit -m "fix: restore storage item popovers"
```

---

### Task 2: Deposit rows in storage state

**Files:**
- Modify: `scripts/data/storage-service.js:1-330`
- Test: `tests/storage-service.test.mjs`

**Interfaces:**
- Consumes: normalized loot row with `rowId`, `stackKey`, `quantity`, and `itemData`.
- Produces: `StorageService.depositRow(token, row, { quantity }) -> { changed, merged, rowId, quantity, state }`.
- Produces private helpers `requirePositiveQuantity(value)`, `cleanStackKey(value)`, and `mergeOrAppendDeposit(state, row, stackKey, quantity)` in `storage-service.js`.

- [ ] **Step 1: Write failing state tests**

Cover append, merge, and reopen:

```js
const result = await service.depositRow(token, {
  rowId: "deposit-new",
  stackKey: "Compendium.dnd5e.items.sword",
  name: "Меч",
  quantity: 2,
  itemData: { name: "Меч", type: "weapon", system: { quantity: 2 } }
}, { quantity: 2 });
assert.equal(result.merged, false);
assert.equal(readStorageState(token).state, "opened");
assert.equal(readStorageState(token).displayMode, "opened");
```

Deposit the same `stackKey` again and assert one visible row with summed `quantity`. Start another case from `state: "empty"` and assert that token name/texture are updated in place and no scene/token creation API is called.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/storage-service.test.mjs`

Expected: FAIL with `service.depositRow is not a function`.

- [ ] **Step 3: Implement `depositRow`**

Normalize `quantity`, reject values below one, ignore claimed rows when looking for a merge target, and write deposited content to `manualRows`. When merging, update both `row.quantity` and `row.itemData.system.quantity`. Always set `state` and `displayMode` to `opened`; call only the existing `#write(token, state)` method.

```js
function requirePositiveQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Количество должно быть целым числом не меньше 1.");
  return quantity;
}

function cleanStackKey(value) {
  return String(value ?? "").trim();
}

function mergeOrAppendDeposit(state, row, stackKey, quantity) {
  const claimed = new Set(state.claimedRowIds ?? []);
  const rows = normalizeRows(state.manualRows);
  const index = rows.findIndex((entry) => (
    !claimed.has(String(entry.rowId ?? ""))
    && stackKey
    && cleanStackKey(entry.stackKey) === stackKey
  ));
  if (index >= 0) {
    const available = requirePositiveQuantity(rows[index].quantity ?? rows[index].itemData?.system?.quantity ?? 1);
    rows[index].quantity = available + quantity;
    rows[index].itemData ??= {};
    rows[index].itemData.system ??= {};
    rows[index].itemData.system.quantity = available + quantity;
    return { rows, rowId: rows[index].rowId, merged: true };
  }
  const deposited = clone(row);
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  deposited.rowId = String(deposited.rowId ?? "").trim() || `deposit-${random}`;
  deposited.stackKey = stackKey;
  deposited.quantity = quantity;
  deposited.itemData ??= {};
  deposited.itemData.system ??= {};
  deposited.itemData.system.quantity = quantity;
  rows.push(deposited);
  return { rows, rowId: deposited.rowId, merged: false };
}

async depositRow(token, row, { quantity } = {}) {
  const current = readStorageState(token);
  const amount = requirePositiveQuantity(quantity ?? row?.quantity);
  const stackKey = cleanStackKey(row?.stackKey);
  const deposit = mergeOrAppendDeposit(current, row, stackKey, amount);
  const state = await this.#write(token, {
    ...current,
    manualRows: deposit.rows,
    state: "opened",
    displayMode: "opened"
  });
  return { changed: true, merged: deposit.merged, rowId: deposit.rowId, quantity: amount, state };
}
```

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/storage-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-service.js tests/storage-service.test.mjs
git commit -m "feat: merge deposits into storage state"
```

---

### Task 3: Resolve and consume item sources

**Files:**
- Create: `scripts/data/storage-deposit-source.js`
- Create: `tests/storage-deposit-source.test.mjs`

**Interfaces:**
- Produces: `parseStorageDepositDragData(value) -> ItemSourceRef | StorageRowSourceRef | null`.
- Produces: `resolveStorageDepositSource(sourceRef, dependencies) -> DepositSource`.
- `DepositSource` contains `{ mode, available, row, sourceKey, canUserMove(user), consume(quantity), restore(receipt) }`.
- Produces `createDepositRowId()`, `canonicalItemStackKey(item)`, and `canonicalSourceUuid(item)` in the same module; the first uses `foundry.utils.randomID` with a crypto/random fallback, the second prefers `flags.core.sourceId` then a normalized item-data identity, and the third prefers the canonical source flag then `item.uuid`.

- [ ] **Step 1: Write failing parser and source tests**

```js
assert.deepEqual(parseStorageDepositDragData({ type: "Item", uuid: "Actor.hero.Item.sword" }), {
  kind: "item",
  itemUuid: "Actor.hero.Item.sword"
});
assert.deepEqual(parseStorageDepositDragData({
  type: "RebreyaStorageClaim",
  tokenUuid: "Scene.s.Token.pile",
  rowId: "row-1",
  quantity: 4
}), {
  kind: "storage-row",
  tokenUuid: "Scene.s.Token.pile",
  rowId: "row-1",
  quantity: 4
});
```

Use fake embedded actor items to prove `mode: "move"`, compendium/world items to prove `mode: "copy"`, partial stack consumption to prove quantity decrement, full consumption to prove deletion, and `restore(receipt)` to recreate an exact deleted embedded item. Use a fake storage source to prove it consumes only the selected row quantity.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/storage-deposit-source.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict source resolution**

Build a row snapshot without live document prototypes:

```js
function createDepositRowId() {
  const id = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `deposit-${id}`;
}

function canonicalSourceUuid(item) {
  return String(item?.flags?.core?.sourceId ?? item?.uuid ?? "").trim();
}

function canonicalItemStackKey(item) {
  const canonicalOrigin = String(item?.flags?.core?.sourceId ?? "").trim();
  if (canonicalOrigin) return canonicalOrigin;
  const data = item?.toObject?.() ?? {};
  return JSON.stringify({
    name: String(data.name ?? "").trim(),
    type: String(data.type ?? "").trim(),
    img: String(data.img ?? "").trim(),
    system: { ...data.system, quantity: 1 }
  });
}

const row = {
  rowId: createDepositRowId(),
  stackKey: canonicalItemStackKey(item),
  sourceId: canonicalSourceUuid(item),
  sourceType: item.type,
  name: item.name,
  img: item.img,
  quantity: available,
  itemData: item.toObject()
};
```

For embedded Actor items, `consume(quantity)` updates `system.quantity` or deletes the item and records an exact snapshot/parent UUID receipt. `restore(receipt)` updates the surviving item or calls `parent.createEmbeddedDocuments("Item", [snapshot], { keepId: true })`. For `RebreyaStorageClaim`, resolve the source token/row, call `storageService.claim` directly, and restore through the recorded pre-claim storage state. Copy sources return a no-op receipt.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/storage-deposit-source.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-deposit-source.js tests/storage-deposit-source.test.mjs
git commit -m "feat: resolve storage deposit sources"
```

---

### Task 4: Authoritative deposit command and rollback

**Files:**
- Modify: `scripts/data/storage-command-service.js:1-350`
- Modify: `tests/storage-socket.test.mjs`

**Interfaces:**
- Produces: `isValidStorageDepositPayload(payload)`.
- Produces: `StorageCommandService.deposit(payload, { sender })`.
- Consumes: `resolveStorageDepositSource`, `StorageService.depositRow`, existing target access checks, ground-pile refresh.

- [ ] **Step 1: Write failing payload, permission, idempotency, and rollback tests**

Use this exact payload shape:

```js
const payload = {
  tokenUuid: "Scene.scene.Token.chest",
  characterTokenUuid: "Scene.scene.Token.hero",
  source: { kind: "item", itemUuid: "Actor.hero.Item.sword" },
  quantity: 2,
  mutationId: "deposit-1"
};
```

Assert exact-key validation, 5-foot/visibility rejection, denial for an embedded item the sender does not own, copy behavior for compendium items, duplicate mutation returning one result, source decrement after target deposit, target restoration when source consumption rejects, and ground-pile source refresh/deletion after a successful move.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/storage-socket.test.mjs`

Expected: FAIL because the validator and `deposit` method are missing.

- [ ] **Step 3: Implement the command**

Resolve the target through existing storage access logic and resolve the source before mutating. Reject a storage row whose source token equals the target. Use an ordered composite queue key from target/source UUIDs and an idempotency key containing `mutationId`.

```js
const beforeTarget = readStorageState(access.storageToken);
let sourceReceipt = null;
try {
  const deposited = await this.storageService.depositRow(access.storageToken, source.row, { quantity });
  sourceReceipt = await source.consume(quantity);
  await this.#refreshSource(source.storageToken, sourceReceipt?.state);
  return { ...deposited, sourceMode: source.mode };
}
catch (error) {
  if (sourceReceipt) await source.restore(sourceReceipt);
  await this.storageService.configure(access.storageToken, beforeTarget);
  throw error;
}
```

If an error happens after source consumption, call `source.restore(receipt)` before restoring the target. Store a successful result in the existing result cache so a duplicate mutation never adds twice.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/storage-socket.test.mjs tests/storage-service.test.mjs tests/storage-deposit-source.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/storage-command-service.js tests/storage-socket.test.mjs
git commit -m "feat: add authoritative storage deposits"
```

---

### Task 5: Socket API and cache version

**Files:**
- Modify: `scripts/main.js:84-181,245-247,1036-1072,1336-1350,3031-3265,5571-5677`
- Modify: `module.json`
- Create: `tests/storage-main-registration.test.mjs`
- Test: `tests/storage-socket.test.mjs`

**Interfaces:**
- Produces: `STORAGE_DEPOSIT_COMMAND = "storage.deposit"`.
- Produces: `moduleApi.inspectStorageDepositSource(dragData)` and `moduleApi.depositStorageItem(tokenUuid, source, quantity, mutationId)`.
- Consumes: `isValidStorageDepositPayload`, `StorageCommandService.deposit`.

- [ ] **Step 1: Write failing registration/API assertions**

Assert that main exports the new command constant, registers it with the strict validator, and routes active-GM calls directly while other clients use `socketCommandBus.request`. Assert that the controlled character token UUID is included exactly as it is for existing storage commands.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/storage-main-registration.test.mjs tests/storage-socket.test.mjs`

Expected: FAIL because `storage.deposit` is absent.

- [ ] **Step 3: Wire the command and advance cache keys**

Register:

```js
this.socketCommandBus.register(STORAGE_DEPOSIT_COMMAND, {
  validate: isValidStorageDepositPayload,
  execute: (payload, { sender }) => this.storageCommandService.deposit(payload, { sender })
});
```

Advance `module.json` from `1.4.116` to `1.4.117`. Change the dynamic storage-app suffix from `storage-live-title-3` to `storage-deposit-interactions-1`, ensuring a normal Foundry reload imports the fixed class instead of the cached module.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/storage-main-registration.test.mjs tests/storage-socket.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/main.js module.json tests/storage-main-registration.test.mjs tests/storage-socket.test.mjs
git commit -m "feat: expose storage deposit command"
```

---

### Task 6: One-second token drop receiver

**Files:**
- Create: `scripts/integrations/storage-token-drop.js`
- Create: `tests/storage-token-drop.test.mjs`
- Modify: `scripts/ui/storage-token-overlay.js`
- Modify: `tests/storage-token-overlay.test.mjs`
- Modify: `scripts/main.js:165-181,5571-5677`
- Modify: `styles/main.css:12480-12560`

**Interfaces:**
- Produces: `StorageTokenDropController` with `bind()`, `unbind()`, `handleDragStart()`, `handleDragOver()`, `handleDrop()`, and `clear()`.
- Produces: `registerStorageTokenDropHooks(moduleApi, options)`.
- Consumes: `parseStorageDepositDragData`, `storageTokenViewportBounds`, `StorageTokenOverlayController.showFeedback`, `promptStorageTransferQuantity`.

- [ ] **Step 1: Write failing hover/drop tests with fake timers**

Verify these exact transitions:

```js
controller.handleDragStart(itemDragEvent);
controller.handleDragOver(eventOverChest);
assert.equal(overlay.calls.length, 0);
clock.advance(999);
assert.equal(overlay.calls.length, 0);
clock.advance(1);
assert.deepEqual(overlay.calls[0].text, "Отпустите, чтобы добавить");
await controller.handleDrop(eventOverChest);
assert.equal(api.depositCalls[0].quantity, 2);
assert.equal(controller.activeToken, null);
```

Add cases for leaving the token before one second, drag end, Escape, unsupported payloads, a second storage token replacing the first timer, and a rejected deposit clearing feedback/highlight.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/storage-token-drop.test.mjs tests/storage-token-overlay.test.mjs`

Expected: FAIL because the controller does not exist and persistent feedback closes immediately.

- [ ] **Step 3: Implement persistent overlay feedback**

Change `showFeedback` so `durationMs <= 0` does not schedule a close timer:

```js
if (Number(durationMs) > 0 && typeof this.setTimeout === "function") {
  this.feedbackTimer = this.setTimeout(() => this.close(), durationMs);
}
```

Add a drop-ready modifier class without changing the existing distance-warning presentation.

- [ ] **Step 4: Implement token hit testing and delayed activation**

Bind document-level `dragstart`, `dragover`, `dragleave`, `drop`, `dragend`, and `keydown` listeners on `canvasReady`, removing them on `canvasTearDown`. Resolve the topmost visible Rebreya storage token whose viewport bounds contain `event.clientX/clientY`. Start one 1000 ms timer per stable token/payload pair. After activation, show persistent feedback and set a reversible token hover/render state. On drop, inspect available quantity, prompt, call `depositStorageItem`, and always clear in `finally`.

- [ ] **Step 5: Register the integration and run focused tests**

Run: `node --test tests/storage-token-drop.test.mjs tests/storage-token-overlay.test.mjs tests/storage-token-hooks.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/integrations/storage-token-drop.js scripts/ui/storage-token-overlay.js scripts/main.js styles/main.css tests/storage-token-drop.test.mjs tests/storage-token-overlay.test.mjs
git commit -m "feat: accept item drops on storage tokens"
```

---

### Task 7: Configuration-window deposits and live refresh regression

**Files:**
- Modify: `scripts/ui/storage-app.js:160-450`
- Modify: `tests/storage-app.test.mjs`
- Modify: `tests/storage-ground-pile-service.test.mjs`

**Interfaces:**
- Consumes: `moduleApi.inspectStorageDepositSource`, `moduleApi.depositStorageItem`.
- Produces: the same quantity/copy/move behavior when a GM drops onto the configuration window.

- [ ] **Step 1: Write failing drop and duplicate-token regression tests**

Replace the old configuration drop expectation (`addManualStorageItem`) with `inspectStorageDepositSource`, quantity prompting, and `depositStorageItem`. Add a regression asserting that claiming the last item from a normal chest performs token updates only and never calls `createEmbeddedDocuments("Token", ...)`; preserve the existing ground-pile empty-delete behavior.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/storage-app.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-socket.test.mjs`

Expected: FAIL until the window uses the deposit command.

- [ ] **Step 3: Route the window drop through the deposit API**

Parse the same source reference as the token receiver, inspect available quantity, call `promptStorageTransferQuantity`, and dispatch `depositStorageItem(this.tokenUuid, source, quantity, mutationId("storage-window-deposit"))`. Keep the GM-only configuration-drop restriction; token drops use command authorization for players.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/storage-app.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-socket.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/ui/storage-app.js tests/storage-app.test.mjs tests/storage-ground-pile-service.test.mjs
git commit -m "feat: return items through storage window"
```

---

### Task 8: Full verification and live Foundry test

**Files:**
- Verify all modified files.
- Update the design/implementation documents only if the implementation required a documented interface change.

**Interfaces:**
- Consumes: all tasks above.
- Produces: tested `lich_branch` ready to push without force.

- [ ] **Step 1: Run syntax and whitespace checks**

Run changed JS files through `node --check`, then run `git diff --check`.

Expected: every command exits 0.

- [ ] **Step 2: Run the complete test suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Confirm Item Piles independence**

Run: `rg -n -i "item[ -]?piles|itempiles" scripts templates styles module.json`

Expected: no runtime matches.

- [ ] **Step 4: Reload and test live Foundry**

After a normal reload, verify loaded Rebreya script/style URLs use version `1.4.117`. Test LKM, PKM, self/party take, character/party/ground moves, compendium copy, partial quantity, one-second hover text, immediate window refresh, empty-to-open texture/name restoration, and failure cleanup.

- [ ] **Step 5: Inspect the alleged duplicate chest**

List active-scene storage token UUIDs, names, actor IDs, texture paths, and Rebreya flags. Compare them with the UUID of the prior test token. Delete only the positively matched test token; otherwise leave the scene unchanged and report the distinct tokens.

- [ ] **Step 6: Review the final diff and commit any verification fixes**

Run: `git diff origin/lich_branch...HEAD --stat` and `git diff origin/lich_branch...HEAD --check`.

If live verification required a correction, stage only its scoped files and commit with `fix: finish storage deposit interactions`.

- [ ] **Step 7: Push without force**

Run: `git push -u origin lich_branch`

Expected: `origin/lich_branch` advances normally.
