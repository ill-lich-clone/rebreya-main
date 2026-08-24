# Storage Access, Journal Read Markers, and Bulk Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storage access deterministic, persist shared Journal read markers, close deleted ground piles cleanly, and add one idempotent bulk claim command for items, containers, and coins.

**Architecture:** Keep `StorageService` as the storage-state owner and `StorageCommandService` as the sole privileged orchestrator. Reuse the current storage queue plus existing durable inventory/container receipts, give every bulk child a stable mutation ID, and expose one exact `storage.claim-all` route through the existing composition root and Storage UI.

**Tech Stack:** Foundry VTT 13, dnd5e, native ECMAScript modules, ApplicationV2/Handlebars, Node.js test runner, PowerShell verification.

**Spec:** `docs/superpowers/specs/2026-08-24-storage-access-journal-bulk-claim-design.md`

## Global Constraints

- Work only on `lich_branch`; never force-push.
- Do not create a second app, hook, socket bus, repository, or storage-state owner.
- Non-GM clients never write world-state locally.
- Preserve GM bypass, owned-character, same-scene, `TokenDocument.hidden !== true`, and distance `<= 5 ft` access rules.
- Journal rows remain reference-only and must never enter Item, durability, container-materialization, or currency paths.
- Preserve corpse materialization markers and token-scoped state independence.
- Do not change Lootgen chat claim-all.
- Keep sources, tests, JSON, Handlebars, README, passport, and Russian strings in UTF-8.
- Update `docs/function-passport.md` in the same commit as every changed method.
- Use explicit `git add -- <task files>`; never use `git add -A`.

---

### Task 1: Deterministic storage visibility policy

**Files:**
- Modify: `tests/storage-access.test.mjs`
- Modify: `scripts/data/storage-access.js`
- Modify: `docs/function-passport.md` section 8

**Interfaces:**
- Consumes: `storageTokenDocument(token)`.
- Produces: `isStorageTokenVisible(storageToken, options?) -> boolean`, based only on `TokenDocument.hidden`.

- [ ] **Step 1: Write failing visibility tests**

Add direct imports and assertions which catch both realistic mutations:

```js
import {
  isStorageTokenVisible,
  measureStoragePointDistance,
  measureStorageTokenDistance,
  preflightStorageAccess
} from "../scripts/data/storage-access.js";

test("authoritative storage visibility ignores active-GM canvas object visibility", () => {
  const scene = { id: "storage-scene" };
  const storage = createToken({ id: "chest", uuid: "Scene.storage.Token.chest", scene, actor: { type: "npc" }, visible: false });
  storage.document.hidden = false;
  assert.equal(isStorageTokenVisible(storage.document, {
    canvas: { scene: { id: "gm-scene" }, tokens: { get: () => ({ visible: false }) } }
  }), true);
});

test("hidden storage stays unavailable regardless of canvas object visibility", () => {
  const storage = createToken({ id: "chest", uuid: "Scene.scene.Token.chest", scene: { id: "scene" }, actor: { type: "npc" }, visible: true });
  storage.document.hidden = true;
  assert.equal(isStorageTokenVisible(storage, { canvas: { tokens: { get: () => ({ visible: true }) } } }), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/storage-access.test.mjs
```

Expected: the `object.visible === false` case fails because current production code returns `false`.

- [ ] **Step 3: Implement the minimal document policy**

Replace the presentation lookup in `isStorageTokenVisible()`:

```js
export function isStorageTokenVisible(storageToken) {
  return storageTokenDocument(storageToken)?.hidden !== true;
}
```

Keep the optional call shape compatible with existing callers. Do not alter distance or ownership selection.

- [ ] **Step 4: Update passport and verify GREEN**

Document in section 8 that storage visibility uses `TokenDocument.hidden`, never active-GM canvas state. Run:

```powershell
node --test tests/storage-access.test.mjs
git diff --check
```

Expected: all storage-access tests pass; diff check exits 0.

- [ ] **Step 5: Commit Task 1 explicitly**

```powershell
git add -- tests/storage-access.test.mjs scripts/data/storage-access.js docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git commit -m "fix: make storage visibility authoritative"
```

---

### Task 2: Shared Journal read marker through root and nested storage state

**Files:**
- Modify: `tests/storage-service.test.mjs`
- Modify: `tests/storage-container-snapshot.test.mjs`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-app.test.mjs`
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/data/storage-container-snapshot.js`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/ui/storage-app.js`
- Modify: `README.md`
- Modify: `docs/function-passport.md` section 8

**Interfaces:**
- Produces: `StorageState.readJournalRowIds: string[]`.
- Produces: `StorageService.markJournalRead(token, rowId, { path = [] } = {}) -> { changed, rowId, state }`.
- Changes: `StorageCommandService.readJournal()` marks only after successful reader output.
- Changes: public storage snapshot Journal rows include `journalRead: boolean`.

- [ ] **Step 1: Write failing state and container tests**

Add literal-state tests:

```js
test("storage state retains only read markers for existing Journal rows", () => {
  const state = buildStorageTokenState({
    manualRows: [{ rowKind: "journal", rowId: "note", sourceType: "journal", sourceId: "JournalEntry.note", name: "Записка", quantity: 1 }],
    readJournalRowIds: ["note", "missing", "note"]
  });
  assert.deepEqual(state.readJournalRowIds, ["note"]);
});
```

Add a nested snapshot fixture whose nested state contains `readJournalRowIds: ["nested-note"]`; build, capture/update, and rebuild the snapshot, then assert the exact array survives.

- [ ] **Step 2: Run state tests and verify RED**

```powershell
node --test tests/storage-service.test.mjs tests/storage-container-snapshot.test.mjs
```

Expected: `readJournalRowIds` is absent from normalized storage state and/or dropped from normalized Journal snapshots.

- [ ] **Step 3: Implement state normalization and `markJournalRead()`**

Normalize rows before deriving markers:

```js
const manualRows = normalizeRows(source.manualRows);
const generatedRows = normalizeRows(source.generatedRows);
const journalRowIds = new Set([...manualRows, ...generatedRows]
  .filter(isStorageJournalRow)
  .map((row) => cleanId(row.rowId))
  .filter(Boolean));
const readJournalRowIds = normalizeClaimedRowIds(source.readJournalRowIds)
  .filter((rowId) => journalRowIds.has(rowId));
```

Return these values from `buildStorageTokenState()`. Add:

```js
async markJournalRead(token, rowId, { path = [] } = {}) {
  token = this.#scopedToken(token, path);
  const current = readStorageState(token);
  const id = cleanId(rowId);
  const row = visibleRows(current).find((entry) => cleanId(entry.rowId) === id);
  if (!row || current.claimedRowIds.includes(id) || !isStorageJournalRow(row)) {
    throw new Error("Запись журнала недоступна.");
  }
  if (current.readJournalRowIds.includes(id)) return { changed: false, rowId: id, state: clone(current) };
  const state = await this.#write(token, { ...current, readJournalRowIds: [...current.readJournalRowIds, id] });
  return { changed: true, rowId: id, state };
}
```

Keep `normalizeJournalRow()` reference-only. The marker remains exclusively in `state.readJournalRowIds`; ensure snapshot state spread preserves that array.

- [ ] **Step 4: Write failing command tests for successful, failed, and nested reads**

Extend the harness and assert:

```js
const snapshot = await harness.service.readJournal(payload, { sender: harness.player });
assert.equal(snapshot.name, "Полевые заметки");
assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, ["journal-row"]);
await harness.service.readJournal(payload, { sender: harness.player });
assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, ["journal-row"]);
```

For a rejecting reader, assert `readJournalRowIds` remains empty. For `path: ["bag-row"]`, assert `readStorageStateAtPath(root, path).readJournalRowIds` contains only the nested Journal row.

- [ ] **Step 5: Run command tests and verify RED**

```powershell
node --test tests/storage-socket.test.mjs
```

Expected: successful read returns but marker assertions fail.

- [ ] **Step 6: Serialize read and mark after reader success**

Extract a no-result-cache source queue helper from current `claimQueues`, then make both `#runMutation()` and Journal read use it. The read operation must follow this exact order:

```js
return this.#enqueueStorage(`${tokenUuid}:${storagePathKey(path)}:storage`, async () => {
  const access = await this.#resolveAccess(payload, sender);
  const state = readStorageStateAtPath(access.storageToken, path);
  // authoritative opened/row checks
  const snapshot = await this.journalReader.read(row.sourceId);
  await this.storageService.markJournalRead(access.storageToken, rowId, { path });
  return snapshot;
});
```

Do not cache Journal content in `claimResults`.

- [ ] **Step 7: Write failing snapshot/UI tests**

Assert `getStorageSnapshot()` returns `journalRead: true` without changing `name`. In UI:

```js
assert.equal(context.rows[0].name, "Полевые заметки (прочитана)");
assert.equal(snapshotRow.name, "Полевые заметки");
```

After a successful read click, assert the viewer receives the reader snapshot and one fresh storage snapshot is requested.

- [ ] **Step 8: Implement snapshot projection and UI naming**

In `getStorageSnapshot()` set:

```js
if (isStorageJournalRow(next)) {
  next.journalRead = state.readJournalRowIds.includes(next.rowId);
  if (!canManage) delete next.sourceId;
}
```

In `_prepareContext()` calculate:

```js
const displayName = isJournal && row.journalRead === true
  ? `${itemName} (прочитана)`
  : itemName;
```

Use `displayName` only for the view model. After `openStorageJournalViewer(snapshot)`, await `scheduleSnapshotRefresh()`.

- [ ] **Step 9: Update docs and verify Task 2 GREEN**

Update README Journal contract and passport state/method/data-flow entries. Run:

```powershell
node --test tests/storage-service.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-socket.test.mjs tests/storage-app.test.mjs
git diff --check
```

- [ ] **Step 10: Commit Task 2 explicitly**

```powershell
git add -- tests/storage-service.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-socket.test.mjs tests/storage-app.test.mjs scripts/data/storage-service.js scripts/data/storage-container-snapshot.js scripts/data/storage-command-service.js scripts/main.js scripts/ui/storage-app.js README.md docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: persist shared storage journal reads"
```

---

### Task 3: Exact party currency target for durable grants

**Files:**
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `scripts/data/inventory-service.js`
- Modify: `docs/function-passport.md` section 7/8 storage grant paragraph

**Interfaces:**
- Changes: `addCurrencyToInventoryOnce(coins = {}, mutationId = "", { groupActorId = "" } = {})`.
- Changes: `#executeAddCurrencyOnce(coins, mutationId, { actor = null, groupActorId = "" } = {})` freezes and validates Actor identity.

- [ ] **Step 1: Write failing exact-target and conflict tests**

Create two managed group actors and assert:

```js
await fixture.service.addCurrencyToInventoryOnce({ gp: 3 }, "storage-bulk-coins", { groupActorId: "group-b" });
assert.equal(groupA.system.currency.gp, 0);
assert.equal(groupB.system.currency.gp, 3);
await assert.rejects(
  fixture.service.addCurrencyToInventoryOnce({ gp: 3 }, "storage-bulk-coins", { groupActorId: "group-a" }),
  /different.*target|target.*different/iu
);
```

- [ ] **Step 2: Run focused test and verify RED**

```powershell
node --test tests/inventory-mutation-recovery.test.mjs
```

Expected: current wrapper ignores the third argument and credits the default group.

- [ ] **Step 3: Implement exact target and journal validation**

Freeze `groupActorId`, resolve it through `getInventoryActor({ create: true, groupActorId })`, persist it in the currency-grant record, and reject any retry where `record.actorId !== actor.id` or stored group ID differs. Preserve character wrapper behavior by passing its explicit Actor and an empty group ID.

```js
addCurrencyToInventoryOnce(coins = {}, mutationId = "", { groupActorId = "" } = {}) {
  const frozenCoins = foundry.utils.deepClone(coins ?? {});
  const frozenGroupActorId = cleanId(groupActorId);
  return this.mutationCoordinator.run("inventory", () => (
    this.#executeAddCurrencyOnce(frozenCoins, mutationId, { groupActorId: frozenGroupActorId })
  ));
}
```

- [ ] **Step 4: Update passport, verify GREEN, and commit**

```powershell
node --test tests/inventory-mutation-recovery.test.mjs
git diff --check
git add -- tests/inventory-mutation-recovery.test.mjs scripts/data/inventory-service.js docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git commit -m "fix: bind storage currency grants to group"
```

---

### Task 4: One resumable `storage.claim-all` command

**Files:**
- Modify: `tests/storage-socket.test.mjs`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`
- Modify: `README.md`
- Modify: `docs/function-passport.md` section 8

**Interfaces:**
- Produces: `isValidStorageClaimAllPayload(payload) -> boolean`.
- Produces: `StorageCommandService.claimAll(payload, { sender }) -> BulkClaimResult`.
- Produces: `STORAGE_CLAIM_ALL_COMMAND = "storage.claim-all"`.
- Produces: `RebreyaMainModule.claimStorageAll(tokenUuid, destination, mutationId, request = {})`.

- [ ] **Step 1: Write failing exact payload tests**

Use this valid party literal and mutate one field per invalid assertion:

```js
const payload = {
  tokenUuid: "Scene.scene.Token.chest",
  characterTokenUuid: "Scene.scene.Token.hero",
  destination: "party",
  target: { groupActorId: "group-a", folderId: null },
  mutationId: "bulk-1"
};
assert.equal(isValidStorageClaimAllPayload(payload), true);
assert.equal(isValidStorageClaimAllPayload({ ...payload, extra: true }), false);
assert.equal(isValidStorageClaimAllPayload({ ...payload, target: null }), false);
assert.equal(isValidStorageClaimAllPayload({ ...payload, destination: "self", target: null }), true);
```

- [ ] **Step 2: Run socket test and verify RED**

```powershell
node --test tests/storage-socket.test.mjs
```

Expected: import/export `isValidStorageClaimAllPayload` is missing.

- [ ] **Step 3: Implement exact validator and target resolver**

Reuse `hasLegacyOrPathKeys()`, `isValidStorageTarget()`, and the self/party destination set. Extract the current party Actor/folder resolution from `claimRow()` into:

```js
async #resolvePartyTarget(target) {
  const partyTarget = Object.freeze({
    groupActorId: clean(target.groupActorId),
    folderId: target.folderId === null ? null : clean(target.folderId)
  });
  const actor = await this.inventoryService.getInventoryActor({ create: false, groupActorId: partyTarget.groupActorId });
  // exact actor and optional live folder checks
  return { actor, target: partyTarget };
}
```

Make `claimRow()` consume the same helper so bulk does not create a second validation owner.

- [ ] **Step 4: Write failing mixed bulk, dead-NPC, and retry tests**

Build one opened state containing:

- ordinary Item quantity 3;
- portable container with one nested Item;
- canonical Journal row;
- `{ gp: 4, sp: 2 }`.

Assert one `claimAll()` call grants exactly two rows and one currency block, skips the Journal, empties claimable state, and returns:

```js
{
  changed: true,
  claimedRowCount: 2,
  skippedJournalCount: 1,
  coinsClaimed: true,
  sourceDeleted: false,
  state: "opened"
}
```

The state remains `opened` because the Journal remains. Repeat the same request sequentially and concurrently and assert target grant counts remain unchanged. Add a harness failure after a target receipt but before source claim, retry the same mutation ID, and assert no duplicate target Item/container/currency. Replace the marked storage Actor with a dead unmarked NPC and assert the same bulk path succeeds.

- [ ] **Step 5: Implement reusable row grant and `claimAll()`**

Extract destination work from `claimRow()` into a private method which receives frozen access/target/row/quantity/grant ID but does not queue or refresh. `claimRow()` calls it once; `claimAll()` calls it for each current unclaimed non-Journal row.

Child IDs must be exact and stable:

```js
const childId = `${mutationKey}:row:${rowId}`;
const coinId = `${mutationKey}:coins`;
```

For each row: prepare detached durability, perform target grant/materialization, then `storageService.claim()`. For party coins call:

```js
await this.inventoryService.addCurrencyToInventoryOnce(coins, coinId, {
  groupActorId: partyTarget.groupActorId
});
```

Do not call `claimRow()` or `claimCoins()` recursively. Do not refresh until all current work succeeds.

- [ ] **Step 6: Write failing main route/API tests**

Extend real registration tests to import `STORAGE_CLAIM_ALL_COMMAND`, send valid/invalid envelopes, assert exact authorization, and verify the composed handler receives the authenticated sender. Add active-GM direct and player socket assertions for `claimStorageAll()`.

- [ ] **Step 7: Register and expose the command**

In `main.js`:

```js
export const STORAGE_CLAIM_ALL_COMMAND = "storage.claim-all";
```

Register with `isValidStorageClaimAllPayload`, the same exact party authorization used by row claims, and execute `storageCommandService.claimAll(payload, { sender })`. Build the public payload with `storageCharacterTokenUuidForClaim()` and the same exact group/folder resolution as `claimStorageRow()`.

- [ ] **Step 8: Update README/passport and verify Task 4 GREEN**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/storage-module-api.test.mjs tests/inventory-mutation-recovery.test.mjs
git diff --check
```

Document the public method, exact command, stable child IDs, partial-forward retry, Journal skip, dead-NPC shared path, and party currency target.

- [ ] **Step 9: Commit Task 4 explicitly**

```powershell
git add -- tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/storage-module-api.test.mjs scripts/data/storage-command-service.js scripts/main.js README.md docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add idempotent storage bulk claim"
```

---

### Task 5: Deleted-source completion and Storage UI bulk controls

**Files:**
- Modify: `tests/storage-ground-pile-service.test.mjs`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-app.test.mjs`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/ui/storage-app.js`
- Modify: `templates/storage-app.hbs`
- Modify: `README.md`
- Modify: `docs/function-passport.md` section 8

**Interfaces:**
- Changes: `StorageCommandService.#refreshSource()` returns `{ deleted, state }`.
- Changes: row, coin, and bulk results expose `sourceDeleted: boolean`.
- Produces UI actions: `storage-claim-all-self`, `storage-claim-all-party`.

- [ ] **Step 1: Strengthen the ordinary pile deletion test**

Capture and assert the production result:

```js
const result = await service.refreshAfterStorageMutation(token, {
  ...state,
  state: "empty",
  claimedRowIds: [state.manualRows[0].rowId]
});
assert.equal(result.deleted, true);
assert.equal(token.deleted, true);
assert.equal(tokens.length, 0);
```

Also assert a Journal-only pile returns `deleted:false`.

- [ ] **Step 2: Write failing command/UI completion tests**

Make the socket harness refresh return `{ deleted: true, state }`, claim the last ordinary row, and assert `result.sourceDeleted === true`.

In the app harness, make `claimStorageRow()` return `{ changed: true, sourceDeleted: true }`; record `close()` and snapshot calls. Click the individual self action and assert:

```js
assert.equal(closeCalls, 1);
assert.equal(snapshotCallsAfterClaim, 0);
assert.deepEqual(notificationErrors, []);
```

- [ ] **Step 3: Propagate deletion and finish UI claims without refresh**

Return refresh result from `#refreshSource()`. Merge only `sourceDeleted` into safe claim results. In StorageApp add one helper:

```js
async #finishClaim(result) {
  this.activeRowId = "";
  if (result?.sourceDeleted === true) {
    await this.close?.();
    return false;
  }
  await this.#refresh();
  return true;
}
```

Use it for individual row, coins, and bulk. Prevent the unconditional final `#refresh()` branch from running twice.

- [ ] **Step 4: Write failing bulk control tests**

Assert template actions exist, `canClaimAll` is false for Journal-only scope, and one click produces one exact API call:

```js
assert.equal(claimAllCalls.length, 1);
assert.equal(claimAllCalls[0][0], app.tokenUuid);
assert.equal(claimAllCalls[0][1], "party");
assert.match(claimAllCalls[0][2], /^storage-all-/u);
assert.deepEqual(claimAllCalls[0][3], {
  path: ["bag-row"],
  characterTokenUuid: "Scene.scene.Token.hero"
});
```

Use literal call assertions rather than source-only grep for behavior; template grep is limited to verifying the rendered action contract.

- [ ] **Step 5: Implement bulk view model, template, and click actions**

In `_prepareContext()` derive:

```js
const canClaimAll = rows.some((row) => row.canClaim) || hasCoins;
```

Render one block only when `canClaimAll`:

```hbs
<div class="rm-storage-bulk-actions">
  <strong>Залутать всё</strong>
  <button type="button" class="rm-button rm-button--primary" data-action="storage-claim-all-self">Себе</button>
  <button type="button" class="rm-button rm-button--secondary" data-action="storage-claim-all-party">В группу</button>
</div>
```

Each action calls `moduleApi.claimStorageAll()` once with `mutationId("storage-all")` and `#pathRequest()`, then delegates to `#finishClaim()`.

- [ ] **Step 6: Update docs and verify Task 5 GREEN**

```powershell
node --test tests/storage-ground-pile-service.test.mjs tests/storage-socket.test.mjs tests/storage-app.test.mjs
git diff --check
```

Update README UI description and passport result/refresh/UI contracts.

- [ ] **Step 7: Commit Task 5 explicitly**

```powershell
git add -- tests/storage-ground-pile-service.test.mjs tests/storage-socket.test.mjs tests/storage-app.test.mjs scripts/data/storage-command-service.js scripts/ui/storage-app.js templates/storage-app.hbs README.md docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git commit -m "fix: finish deleted storage claims cleanly"
```

---

### Task 6: Cross-cutting review and full verification

**Files:**
- Inspect all files changed since `04fe92e`.
- Modify only files required by verified failures or review findings.

**Interfaces:**
- Consumes all prior task contracts.
- Produces one verified, pushed `lich_branch` containing the complete feature.

- [ ] **Step 1: Run the full focused storage cluster once**

```powershell
node --test tests/storage-*.test.mjs
```

If PowerShell does not expand the wildcard for Node, use:

```powershell
$storageTests = Get-ChildItem -LiteralPath tests -Filter 'storage-*.test.mjs' | ForEach-Object FullName
node --test $storageTests
```

Expected: 0 failed tests. Record the exact passed/failed counts.

- [ ] **Step 2: Inspect requirements and diff**

```powershell
git diff 04fe92e..HEAD --check
git diff 04fe92e..HEAD --stat
git diff 04fe92e..HEAD -- scripts/data scripts/ui templates/storage-app.hbs tests README.md docs/function-passport.md
```

Check every spec section: access, marker persistence, nested paths, one command, mixed rows, retry, dead NPC, exact party currency, deletion completion, docs.

- [ ] **Step 3: Request code review and resolve findings**

Provide the reviewer:

```text
DESCRIPTION: Deterministic storage visibility, shared Journal read marker, exact party currency grants, one resumable storage.claim-all command, and deleted-pile UI completion.
PLAN_OR_REQUIREMENTS: docs/superpowers/specs/2026-08-24-storage-access-journal-bulk-claim-design.md and this implementation plan.
BASE_SHA: 04fe92e
HEAD_SHA: current HEAD
```

Fix every Critical or Important finding with a new failing regression test, then rerun its focused owner test. Update the relevant passport entry in the same fix commit.

- [ ] **Step 4: Run the full project verification on the final HEAD**

```powershell
node --test tests/*.test.mjs
git diff 04fe92e..HEAD --check

$files = git ls-files '*.js' '*.mjs'
$jsFailures = @()
foreach ($file in $files) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { $jsFailures += $file }
}
if ($jsFailures.Count) { $jsFailures; exit 1 }

$json = git ls-files '*.json'
foreach ($file in $json) {
  Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json | Out-Null
}
```

Expected: all tests pass, all 504-or-more tracked JS/MJS files parse, all 42-or-more tracked JSON files parse, and diff check exits 0.

- [ ] **Step 5: Verify branch and push without force**

```powershell
git status --short --branch
git log --oneline 04fe92e..HEAD
git push -u origin lich_branch
git rev-list --left-right --count HEAD...origin/lich_branch
```

Expected: clean tree, meaningful task commits listed, push succeeds, final ahead/behind is `0 0`.
