# Native Storage Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Item Piles completely and make Rebreya chests, ground piles, and ordinary durable items share native damage, manual zero-HP outcomes, live storage updates, and compact click interaction.

**Architecture:** A small object classifier identifies Rebreya storage documents without optional-module APIs. Pure durability rules stop at zero, while a native target service adapts Item documents, chest token flags, and single-row ground-pile state to one damage/result interface; a separate spill method converts a destroyed chest snapshot into one idempotent ground pile. `StorageApp` listens to its token hooks and owns a styled click popover, so socket and drag mutations update every open client.

**Tech Stack:** Foundry VTT v13 ApplicationV2 and DnD5e hooks, vanilla ES modules, Handlebars, CSS, Foundry socket command bus, Node test runner.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Run `git fetch origin` before implementation and stop for a real conflict with current `main` or `master`.
- Do not use force push.
- Do not use subagents.
- Item Piles must not be imported, queried, required, or emulated.
- Chests use independent medium wooden-object durability: AC 15, HP 18, damage threshold 0.
- Reaching 0 HP never breaks or destroys a target automatically.
- Only the active GM may commit durability, spill, and deletion mutations.
- A destroyed unopened chest generates once, produces at most one native ground pile, then deletes only after the pile write succeeds.
- Preserve drag-and-drop quantity prompts, same-item stacking, empty-pile cleanup, five-foot storage access, positional sound, and token anchoring.
- Preserve unrelated changes in the shared worktree.

---

## File Map

- Create `scripts/data/storage-object-kind.js`: neutral recognition of Rebreya chests and ground piles.
- Create `scripts/data/native-object-durability-service.js`: adapters for chest flags and single-row ground-pile item data, zero-HP outcome resolution, and chest destruction.
- Create `scripts/ui/durability-outcome-dialog.js`: the active-GM `Сломать предмет` / `Разрушить предмет` / close prompt.
- Modify `scripts/data/durability-rules.js`: stop damage at zero and expose explicit broken/destroyed transitions.
- Modify `scripts/data/durability-service.js`: keep Item document mutation durable while removing automatic zero-HP destruction.
- Modify `scripts/data/storage-service.js`: explicit row-durability mutation and storage-updated hook emission.
- Modify `scripts/data/storage-ground-pile-service.js`: create or merge a complete storage snapshot, including coins, under one mutation id.
- Modify `scripts/data/builtin-storage-presets.js` and `scripts/data/builtin-storage-actor-service.js`: seed and repair chest object durability.
- Modify `scripts/integrations/durability-hooks.js`: retain broken-item protections and replace Item Piles branches with the native target service.
- Delete `scripts/integrations/item-piles-dnd5e.js`.
- Modify `scripts/hooks.js`: make BG3 common-action suppression use the Rebreya classifier.
- Modify `scripts/main.js`: compose the native service, register the neutral socket command, remove Item Piles lifecycle calls, and expose neutral APIs.
- Modify `scripts/constants.js` and `scripts/combat/implant-automation-service.js`: remove the Item Piles id and use the Rebreya no-sale flag.
- Modify `scripts/ui/storage-app.js`, `templates/storage-app.hbs`, and `styles/main.css`: dynamic title, live refresh, reliable LKM, and custom popover.
- Create `tests/storage-object-kind.test.mjs`, `tests/native-object-durability-service.test.mjs`, and `tests/durability-outcome-dialog.test.mjs`.
- Modify `tests/durability-rules.test.mjs`, `tests/durability-service.test.mjs`, `tests/durability-hooks.test.mjs`, `tests/storage-service.test.mjs`, `tests/storage-ground-pile-service.test.mjs`, `tests/storage-app.test.mjs`, `tests/bg3-hotbar-compat.test.mjs`, `tests/module-manifest.test.mjs`, and `tests/security.test.mjs`.
- Delete `tests/item-piles-dnd5e.test.mjs`.

---

### Task 1: Rebreya Storage Object Classification and Item Piles Removal

**Files:**
- Create: `scripts/data/storage-object-kind.js`
- Modify: `scripts/hooks.js:5-225,737`
- Modify: `scripts/constants.js:130`
- Modify: `scripts/combat/implant-automation-service.js:145-151`
- Modify: `scripts/main.js:151-161,5500-5535`
- Modify: `tests/bg3-hotbar-compat.test.mjs:214-264`
- Modify: `tests/module-manifest.test.mjs:210-300`
- Modify: `tests/security.test.mjs:9-30`
- Create: `tests/storage-object-kind.test.mjs`
- Delete: `scripts/integrations/item-piles-dnd5e.js`
- Delete: `tests/item-piles-dnd5e.test.mjs`

**Interfaces:**
- Produces: `storageObjectKind(target) -> "chest"|"groundPile"|null`.
- Produces: `isNativeStorageObject(target) -> boolean`.
- Produces: `shouldSkipBg3HotbarCommonActionsForActor(actor) -> boolean`, now based only on Rebreya flags.

- [ ] **Step 1: Write failing classifier and BG3 tests**

```js
test("storage object kind recognizes token-owned Rebreya flags", () => {
  assert.equal(storageObjectKind({ flags: { [MODULE_ID]: { storage: { state: "opened" } } } }), "chest");
  assert.equal(storageObjectKind({ flags: { [MODULE_ID]: { storage: {}, groundPile: { enabled: true } } } }), "groundPile");
  assert.equal(storageObjectKind({ flags: { itempiles: { data: { enabled: true } } } }), null);
});

test("BG3 common actions skip Rebreya storage but ignore Item Piles flags", () => {
  assert.equal(shouldSkipBg3HotbarCommonActionsForActor(rebreyaGroundPileActor), true);
  assert.equal(shouldSkipBg3HotbarCommonActionsForActor(legacyItemPilesActor), false);
});
```

- [ ] **Step 2: Run focused tests and verify the missing classifier fails**

Run: `node --test tests/storage-object-kind.test.mjs tests/bg3-hotbar-compat.test.mjs`

Expected: FAIL because `storage-object-kind.js` does not exist and BG3 still reads Item Piles.

- [ ] **Step 3: Implement the flag-only classifier**

```js
import { MODULE_ID } from "../constants.js";

function candidates(target) {
  return [target, target?.document, target?.token, target?.token?.document, target?.actor, target?.prototypeToken]
    .filter(Boolean);
}

export function storageObjectKind(target) {
  for (const candidate of candidates(target)) {
    const flags = candidate?.flags?.[MODULE_ID] ?? candidate?._source?.flags?.[MODULE_ID];
    if (flags?.groundPile?.enabled === true || flags?.groundPilePrototype?.enabled === true) return "groundPile";
    if (flags?.storage?.enabled === true || flags?.storage?.version >= 1) return "chest";
  }
  return null;
}

export const isNativeStorageObject = (target) => storageObjectKind(target) !== null;
```

- [ ] **Step 4: Rename the BG3 patch and remove optional-module probes**

Replace the Item Piles lookup helpers with `isNativeStorageObject(actor)`, rename the patch symbols/functions to `patchBg3HotbarStorageCommonActions` and `registerBg3HotbarStorageCommonActionsCompat`, and keep the original BG3 method call for regular actors.

```js
autoPopulateCreateToken._getCombatActionsList = async function getRebreyaStorageSafeCombatActions(actor, ...args) {
  if (isNativeStorageObject(actor)) return [];
  return originalGetCombatActionsList.call(this, actor, ...args);
};
```

- [ ] **Step 5: Delete integration startup and legacy no-sale data access**

Delete `ITEM_PILES_MODULE_ID`, both Item Piles lifecycle imports/calls, and the integration/test files. Replace the implant predicate with the owned flag:

```js
item?.flags?.[MODULE_ID]?.item?.notForSale === true
```

Update manifest/security tests to assert that executable sources contain none of `game.itempiles`, `ItemPiles.API`, `isValidItemPile`, `deleteItemPile`, `flags.itempiles`, or `integrations/item-piles-dnd5e.js`.

- [ ] **Step 6: Run removal tests**

Run: `node --test tests/storage-object-kind.test.mjs tests/bg3-hotbar-compat.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs`

Expected: PASS and no import failure from the deleted integration.

- [ ] **Step 7: Commit native classification and dependency removal**

```powershell
git add scripts/data/storage-object-kind.js scripts/hooks.js scripts/constants.js scripts/combat/implant-automation-service.js scripts/main.js tests/storage-object-kind.test.mjs tests/bg3-hotbar-compat.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs
git rm scripts/integrations/item-piles-dnd5e.js tests/item-piles-dnd5e.test.mjs
git commit -m "refactor: remove Item Piles integration"
```

---

### Task 2: Manual Zero-HP Durability Outcomes

**Files:**
- Create: `scripts/ui/durability-outcome-dialog.js`
- Create: `tests/durability-outcome-dialog.test.mjs`
- Modify: `scripts/data/durability-rules.js:365-408`
- Modify: `scripts/data/durability-service.js:237-305,401-423`
- Modify: `tests/durability-rules.test.mjs:364-440`
- Modify: `tests/durability-service.test.mjs:350-565`

**Interfaces:**
- Produces: `applyDurabilityDamage(flag, options) -> { outcome:"ignored"|"damaged"|"depleted", nextFlag, appliedDamage }`.
- Produces: `markDurabilityBroken(flag) -> { outcome:"broken", nextFlag, appliedDamage:0 }`.
- Produces: `markDurabilityDestroyed(flag) -> { outcome:"destroyed", nextFlag, appliedDamage:0 }`.
- Produces: `promptDurabilityOutcome({ name, dialog }) -> Promise<"broken"|"destroyed"|null>`.

- [ ] **Step 1: Replace the two-stage rule tests with manual-outcome tests**

```js
test("damage stops an intact item at zero without changing its state", () => {
  const transition = applyDurabilityDamage(buildInitialDurability(profile), { amount: 99, damageType: "force" });
  assert.equal(transition.outcome, "depleted");
  assert.equal(transition.nextFlag.state, "intact");
  assert.deepEqual(transition.nextFlag.hp, { value: 0, max: 15 });
});

test("explicit break keeps zero HP and explicit destroy marks destruction", () => {
  const depleted = applyDurabilityDamage(buildInitialDurability(profile), { amount: 99, damageType: "force" }).nextFlag;
  assert.equal(markDurabilityBroken(depleted).nextFlag.state, "broken");
  assert.equal(markDurabilityBroken(depleted).nextFlag.hp.value, 0);
  assert.equal(markDurabilityDestroyed(depleted).nextFlag.state, "destroyed");
});
```

- [ ] **Step 2: Run rules tests and verify old automatic transitions fail**

Run: `node --test tests/durability-rules.test.mjs tests/durability-service.test.mjs`

Expected: FAIL because zero currently becomes `broken` and refills HP.

- [ ] **Step 3: Implement pure depleted, broken, and destroyed transitions**

```js
if (remainingHp === 0) {
  nextFlag.hp = { value: 0, max: maxHp };
  return { outcome: "depleted", nextFlag, appliedDamage };
}

export function markDurabilityBroken(flag) {
  const nextFlag = cloneDurabilityFlag(flag);
  nextFlag.state = "broken";
  nextFlag.breakStage = 1;
  nextFlag.hp.value = 0;
  return { outcome: "broken", nextFlag, appliedDamage: 0 };
}
```

`markDurabilityDestroyed` sets `state: "destroyed"`, `breakStage: 2`, and `hp.value: 0` without applying another damage pool.

- [ ] **Step 4: Make `DurabilityService` persist depletion but require explicit break/destroy**

`damageItem` commits `depleted` like `damaged`; `breakItem` uses `markDurabilityBroken`; `destroyItem` uses `markDurabilityDestroyed` and the existing journaled deletion path.

```js
const transition = applyDurabilityDamage(flag, { amount, damageType });
if (["ignored"].includes(transition.outcome)) return toPlain(transition);
return this.#commitUpdate(item, transitionWithTimestamp(transition, this.#timestamp()), {
  clearEquipment: false
});
```

- [ ] **Step 5: Implement the Foundry dialog adapter**

```js
export async function promptDurabilityOutcome({ name = "Предмет", dialog = globalThis.foundry?.applications?.api?.DialogV2 } = {}) {
  if (!dialog?.wait) return null;
  return dialog.wait({
    window: { title: `${name}: 0 HP` },
    content: `<p>Что сделать с объектом «${escapeHtml(name)}»?</p>`,
    buttons: [
      { action: "broken", label: "Сломать предмет", icon: "fa-solid fa-hammer" },
      { action: "destroyed", label: "Разрушить предмет", icon: "fa-solid fa-burst" }
    ],
    close: () => null
  });
}
```

Define the local HTML helper before the export so the name never enters dialog markup unescaped:

```js
function escapeHtml(value) {
  const div = globalThis.document?.createElement?.("div");
  if (!div) return String(value ?? "").replace(/[&<>"']/gu, "");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
```

Tests inject a fake dialog and assert exact labels plus `null` on close.

- [ ] **Step 6: Run rules, service, and dialog tests**

Run: `node --test tests/durability-rules.test.mjs tests/durability-service.test.mjs tests/durability-outcome-dialog.test.mjs`

Expected: PASS with no automatic broken or destroyed result from damage.

- [ ] **Step 7: Commit manual durability outcomes**

```powershell
git add scripts/data/durability-rules.js scripts/data/durability-service.js scripts/ui/durability-outcome-dialog.js tests/durability-rules.test.mjs tests/durability-service.test.mjs tests/durability-outcome-dialog.test.mjs
git commit -m "feat: make durability outcomes explicit"
```

---

### Task 3: Native Chest and Ground-Pile Durability Adapter

**Files:**
- Create: `scripts/data/native-object-durability-service.js`
- Create: `tests/native-object-durability-service.test.mjs`
- Modify: `scripts/data/storage-service.js:98-141,157-173,315-353`
- Modify: `scripts/data/builtin-storage-presets.js:1-55`
- Modify: `scripts/data/builtin-storage-actor-service.js:30-115`
- Modify: `tests/storage-service.test.mjs:35-300`
- Modify: `tests/builtin-storage-presets.test.mjs`
- Modify: `tests/builtin-storage-actor-service.test.mjs`

**Interfaces:**
- Produces: `CHEST_OBJECT_DURABILITY = { version:1, eligible:true, state:"intact", hp:{value:18,max:18}, ac:15, damageThreshold:0, materialProfile:"wood", size:"medium" }`.
- Produces: `readStorageObjectDurability(token) -> object|null`.
- Produces: `ensureStorageObjectDurability(token) -> Promise<object>`.
- Produces: `StorageService.updateRowDurability(token, rowId, durability) -> Promise<StorageState>`.
- Produces: `NativeObjectDurabilityService.resolve(target) -> { kind:"item"|"chest"|"groundItem", uuid, item?, token?, row? }|null`.
- Produces: `NativeObjectDurabilityService.damage(target, options) -> Promise<transition>`.
- Produces: `NativeObjectDurabilityService.resolveDepletion(target, choice, options) -> Promise<transition>`.

- [ ] **Step 1: Write failing adapter tests**

```js
test("a chest owns AC 15 and HP 18 independently from its rows", async () => {
  const target = await service.resolve(chestToken);
  assert.equal(target.kind, "chest");
  assert.deepEqual(readStorageObjectDurability(chestToken).hp, { value: 18, max: 18 });
  assert.equal(readStorageObjectDurability(chestToken).ac, 15);
});

test("one ground-pile row receives damage through its stored item durability", async () => {
  const result = await service.damage(groundPileToken, { amount: 4, damageType: "slashing" });
  assert.equal(result.outcome, "damaged");
  assert.equal(readStorageState(groundPileToken).manualRows[0].itemData.flags[MODULE_ID].durability.hp.value, 6);
});

test("a multi-row pile has no aggregate durability target", async () => {
  assert.equal(await service.resolve(multiRowPileToken), null);
});

test("an ordinary Item document delegates to the journaled durability service", async () => {
  const result = await service.damage(itemDocument, { amount: 3, damageType: "force" });
  assert.deepEqual(itemDamageCalls, [[itemDocument, { amount: 3, damageType: "force" }]]);
  assert.equal(result.outcome, "damaged");
});
```

- [ ] **Step 2: Run focused tests and verify the adapter is missing**

Run: `node --test tests/native-object-durability-service.test.mjs tests/storage-service.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs`

Expected: FAIL because the native service and object flag do not exist.

- [ ] **Step 3: Add row durability mutation and storage update notification**

```js
async updateRowDurability(token, rowId, durability) {
  return this.#mutateEditableRow(token, rowId, (row) => {
    row.itemData ??= {};
    row.itemData.flags ??= {};
    row.itemData.flags[MODULE_ID] ??= {};
    row.itemData.flags[MODULE_ID].durability = clone(durability);
    return row;
  });
}
```

After `document.update(patch)`, call `Hooks.callAll(`${MODULE_ID}.storageUpdated`, document, clone(normalized))`; token update remains the cross-client source, while the module hook gives deterministic local tests.

- [ ] **Step 4: Seed chest object durability in built-in and custom storage tokens**

Add `objectDurability: clone(CHEST_OBJECT_DURABILITY)` beside the token `storage` flag, seed `delta.system.attributes.hp`, `delta.system.attributes.ac`, and `bar1.attribute: "attributes.hp"`, and repair missing fields without overwriting existing damage.

```js
const current = readStorageObjectDurability(token);
const next = current ? normalizeObjectDurability(current) : clone(CHEST_OBJECT_DURABILITY);
await token.update({
  [`flags.${MODULE_ID}.objectDurability`]: next,
  "delta.system.attributes.hp": { value: next.hp.value, max: next.hp.max, dt: next.damageThreshold },
  "delta.system.attributes.ac": { calc: "flat", flat: next.ac },
  "bar1.attribute": "attributes.hp"
});
```

- [ ] **Step 5: Implement chest and single-row ground-item adapters**

For an ordinary Item document, delegate damage, break, and destroy to the injected journaled `DurabilityService`. For a chest, apply pure durability damage to `objectDurability`, update the token flag and synthetic actor projection, then return the transition. For a ground pile, select exactly one visible row whose `itemData.flags[MODULE_ID].durability` is eligible, call `applyDurabilityDamage`, persist through `updateRowDurability`, and refresh pile presentation.

```js
async damage(target, options) {
  const resolved = await this.resolve(target);
  if (!resolved) return { outcome: "ignored", nextFlag: null, appliedDamage: 0 };
  return this.mutations.run(resolved.uuid, () => {
    if (resolved.kind === "item") return this.durabilityService.damageItem(resolved.item, options);
    if (resolved.kind === "chest") return this.#damageChest(resolved, options);
    return this.#damageGroundItem(resolved, options);
  });
}
```

`resolveDepletion(target, "broken", options)` delegates Item documents to `DurabilityService.breakItem` and otherwise persists `markDurabilityBroken`. `resolveDepletion(target, "destroyed", options)` delegates Item documents to the journaled `DurabilityService.destroyItem`, ground-item deletion to `StorageService.deleteRow`, and chest destruction to Task 4.

- [ ] **Step 6: Run native adapter and storage tests**

Run: `node --test tests/native-object-durability-service.test.mjs tests/storage-service.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs`

Expected: PASS for chest defaults, preserved existing damage, row persistence, and multi-row exclusion.

- [ ] **Step 7: Commit native object durability storage**

```powershell
git add scripts/data/native-object-durability-service.js scripts/data/storage-service.js scripts/data/builtin-storage-presets.js scripts/data/builtin-storage-actor-service.js tests/native-object-durability-service.test.mjs tests/storage-service.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs
git commit -m "feat: add native storage object durability"
```

---

### Task 4: Idempotent Chest Spill and Destruction

**Files:**
- Modify: `scripts/data/storage-ground-pile-service.js:92-230`
- Modify: `scripts/data/native-object-durability-service.js`
- Modify: `tests/storage-ground-pile-service.test.mjs:77-155`
- Modify: `tests/native-object-durability-service.test.mjs`

**Interfaces:**
- Produces: `StorageGroundPileService.transferSnapshotToScene({ rows, coins, sceneId, x, y, mutationId }) -> Promise<{ created, merged, duplicate, token, state }>`.
- Produces: `NativeObjectDurabilityService.destroyChest(token, { mutationId }) -> Promise<{ outcome:"destroyed", pileUuid:string }>`.

- [ ] **Step 1: Write failing spill tests**

```js
test("destroying an unopened chest generates once and spills one pile", async () => {
  const result = await service.destroyChest(chest, { mutationId: "destroy-chest-1" });
  assert.equal(generateCalls, 1);
  assert.equal(scene.createdTokens.length, 1);
  assert.equal(scene.createdTokens[0].flags[MODULE_ID].storage.manualRows.length, 3);
  assert.deepEqual(scene.createdTokens[0].flags[MODULE_ID].storage.manualCoins, { gp: 4, sp: 2, cp: 0, pp: 0 });
  assert.equal(chest.deleted, true);
  assert.equal(result.outcome, "destroyed");
});

test("retry after pile creation reuses the mutation and deletes without duplicating", async () => {
  await assert.rejects(service.destroyChest(chest, { mutationId: "destroy-chest-2" }), /delete failed/u);
  await service.destroyChest(chest, { mutationId: "destroy-chest-2" });
  assert.equal(scene.createdTokens.length, 1);
});
```

- [ ] **Step 2: Run spill tests and verify the snapshot API is absent**

Run: `node --test tests/storage-ground-pile-service.test.mjs tests/native-object-durability-service.test.mjs`

Expected: FAIL because ground piles accept only one row and no coins.

- [ ] **Step 3: Generalize ground-pile writes to a complete snapshot**

Normalize every incoming row with a fresh row id, preserve its item flags, normalize coins, and use the existing mutation-id list for deduplication.

```js
const incomingState = buildStorageTokenState({
  baseName: "Куча предметов",
  state: "opened",
  manualRows: rows.map((row) => this.#prepareRow(row, rowQuantity(row))),
  manualCoins: coins,
  displayMode: "opened"
});
```

When an existing pile contains the point, merge same-identity rows, append other rows, add each coin denomination, and append the stable mutation id once. When no pile exists, create one token containing the complete state.

- [ ] **Step 4: Implement generate-spill-delete ordering**

```js
async destroyChest(token, { mutationId }) {
  const opened = await this.storageService.open(token, { reason: "destroyed" });
  const state = opened.state;
  const rows = visibleUnclaimedRows(state);
  const coins = visibleUnclaimedCoins(state);
  let pile = null;
  if (rows.length || hasCoins(coins)) {
    pile = await this.groundPileService.transferSnapshotToScene({
      rows, coins, sceneId: token.parent.id, ...tokenCenter(token), mutationId
    });
  }
  await token.delete();
  return { outcome: "destroyed", pileUuid: pile?.token?.uuid ?? "" };
}
```

Do not catch generation or pile-write failures before deletion. A stable mutation id makes a retry observe the already-created pile as `duplicate` and proceed to token deletion.

- [ ] **Step 5: Run spill and existing pile behavior tests**

Run: `node --test tests/storage-ground-pile-service.test.mjs tests/native-object-durability-service.test.mjs tests/storage-service.test.mjs`

Expected: PASS, including single-item stacking and empty-pile deletion.

- [ ] **Step 6: Commit chest destruction**

```powershell
git add scripts/data/storage-ground-pile-service.js scripts/data/native-object-durability-service.js tests/storage-ground-pile-service.test.mjs tests/native-object-durability-service.test.mjs
git commit -m "feat: spill destroyed chests into native piles"
```

---

### Task 5: Native Durability Hooks and Neutral Socket Routing

**Files:**
- Modify: `scripts/integrations/durability-hooks.js:1-770`
- Modify: `scripts/main.js:151-160,247,699-735,1055-1095,1365-1390,2516-2548,5596-5605`
- Modify: `tests/durability-hooks.test.mjs:287-910`

**Interfaces:**
- Produces: `DURABILITY_TARGET_DAMAGE_COMMAND = "durability.target.damage"`.
- Produces: `RebreyaMainModule.damageDurabilityTarget(target, options) -> Promise<transition>`.
- Produces: `reconcileNativeObjectDurability(options) -> Promise<string[]>`.
- Consumes: `NativeObjectDurabilityService.damage`, `resolveDepletion`, `ensureStorageObjectDurability`, and `promptDurabilityOutcome`.

- [ ] **Step 1: Replace Item Piles hook tests with native target tests**

Cover:

```js
test("DnD5e damage on a Rebreya chest routes through native object durability", async () => {
  assert.equal(preApplyDamage(chestActor, 6, {}, { damageType: "slashing" }), false);
  await flushPromises();
  assert.deepEqual(damageCalls, [[chestToken, { amount: 6, damageType: "slashing" }]]);
});

test("depleted native targets prompt once and apply the explicit GM choice", async () => {
  damageResult = { outcome: "depleted", nextFlag: { hp: { value: 0, max: 18 } } };
  promptResult = "broken";
  preApplyDamage(chestActor, 18, {}, {});
  await flushPromises();
  assert.deepEqual(resolveCalls, [[chestToken, "broken"]]);
});
```

Also retain queue serialization, inactive-GM routing, direct HP-loss neutralization, reconciliation, ground-row deletion, and regular-actor pass-through.

- [ ] **Step 2: Run hook tests and verify Item Piles assumptions fail**

Run: `node --test tests/durability-hooks.test.mjs`

Expected: FAIL until the hook layer accepts native storage targets.

- [ ] **Step 3: Replace pile helpers with native target helpers**

Delete every Item Piles constant/API branch. Resolve a hook actor through its synthetic token and `NativeObjectDurabilityService.resolve`. Use one `WeakMap` queue per resolved token/actor. After a `depleted` result, only the active GM calls the dialog; serialize prompts by target UUID.

```js
const transition = await moduleApi.damageDurabilityTarget(context.target, {
  amount: context.damage,
  damageType: resolveDamageType(options)
});
if (transition?.outcome === "depleted" && isActiveGm()) {
  const choice = await promptOutcome({ name: context.name });
  if (choice) await moduleApi.resolveDurabilityOutcome(context.target, choice);
}
```

- [ ] **Step 4: Register a neutral validated socket command**

Payload keys are exactly `amount`, `damageType`, `mutationId`, and `targetUuid`. Authorization requires a GM sender and a target resolved by `NativeObjectDurabilityService` or an Item document with a Rebreya durability flag.

```js
this.socketCommandBus.register(DURABILITY_TARGET_DAMAGE_COMMAND, {
  validate: isValidDurabilityTargetDamagePayload,
  authorize: (_payload, { sender }) => sender?.isGM === true,
  execute: (payload) => this.nativeObjectDurabilityService.damage(payload.targetUuid, payload)
});
```

`damageDurabilityTarget` calls the native service on the active GM; an inactive GM sends the command with a stable `durability-target-*` mutation id. After an active-GM `depleted` result, it opens the serialized dialog and calls `resolveDurabilityOutcome` only for a selected action. Make the existing public `damageItem(item, options)` delegate to `damageDurabilityTarget(item, options)` so ordinary inventory items receive the same manual dialog. Keep `breakItem` and `destroyItem` as explicit APIs, and remove `ITEM_PILE_DAMAGE_COMMAND`, `resolveItemPileDurabilityItem`, `damageItemPile`, and `reconcileItemPileDurability`.

- [ ] **Step 5: Compose and reconcile the native service**

Construct it after `storageService` and `storageGroundPileService`, inject the mutation coordinator and dialog adapter, register hooks once on ready, and reconcile loaded built-in/custom chest tokens plus ground piles. Do not register Item Piles init/ready hooks.

- [ ] **Step 6: Run durability integration tests**

Run: `node --test tests/durability-hooks.test.mjs tests/native-object-durability-service.test.mjs tests/durability-service.test.mjs tests/storage-service.test.mjs`

Expected: PASS with no Item Piles fixture or API stub.

- [ ] **Step 7: Commit native routing**

```powershell
git add scripts/integrations/durability-hooks.js scripts/main.js tests/durability-hooks.test.mjs
git commit -m "feat: route durability through native objects"
```

---

### Task 6: Reactive Compact Storage Grid and Styled LKM Popover

**Files:**
- Modify: `scripts/ui/storage-app.js:44-370`
- Modify: `templates/storage-app.hbs:1-120`
- Modify: `styles/main.css:12534-12840`
- Modify: `tests/storage-app.test.mjs:1-145`

**Interfaces:**
- Produces: one token-scoped `updateToken`, `deleteToken`, and `${MODULE_ID}.storageUpdated` subscription per open `StorageApp`.
- Produces: dynamic `this.options.window.title = snapshot.name || "Сундук"`.
- Produces: `scheduleSnapshotRefresh() -> Promise<void>` with generation ordering.
- Keeps: existing `storage-toggle-row`, `storage-open-item`, `storage-claim-self`, `storage-claim-party`, drag payload, and quantity prompt actions.

- [ ] **Step 1: Write failing template and live-refresh tests**

```js
test("compact storage uses the token name only in the window title", async () => {
  const { app, context } = await createApp({ name: "Сундук" });
  await app._prepareContext();
  assert.equal(app.options.window.title, "Сундук");
  assert.doesNotMatch(template, /rm-storage-header|rm-eyebrow>Хранилище|<h2>{{name}}/u);
});

test("matching token updates rerender and unrelated token updates do not", async () => {
  app._onRender({}, {});
  await hooks.emit("updateToken", { uuid: app.tokenUuid });
  assert.equal(renderCalls, 1);
  await hooks.emit("updateToken", { uuid: "Scene.other.Token.chest" });
  assert.equal(renderCalls, 1);
});

test("item cells have a custom click popover and no native title", () => {
  assert.match(template, /data-action="storage-toggle-row"/u);
  assert.match(template, /data-storage-popover/u);
  assert.doesNotMatch(template, /class="rm-storage-item__icon"[^>]*title=/u);
});
```

- [ ] **Step 2: Run UI tests and verify current duplicate header and stale snapshot fail**

Run: `node --test tests/storage-app.test.mjs`

Expected: FAIL because the body header exists, token hooks are absent, and cells use native titles.

- [ ] **Step 3: Make snapshots ordered and token-reactive**

Register Foundry hooks once after first render and remove them in `_onClose`. Match `token.uuid`/`token.document.uuid` exactly. Close the app on deletion. Use a monotonically increasing request number:

```js
async #refreshSnapshot() {
  const request = ++this.snapshotRequest;
  const snapshot = await this.moduleApi.getStorageSnapshot(this.tokenUuid);
  if (request !== this.snapshotRequest) return;
  this.snapshot = snapshot;
  await this.render({ force: true });
}
```

`_prepareContext` reuses a supplied current snapshot when present, assigns `this.options.window.title`, and validates the active row against the latest rows.

- [ ] **Step 4: Remove duplicated body text and make LKM independent from dragging**

Delete `rm-storage-header`. Put `draggable="true"` and `data-storage-row-drag` on the article, while the icon remains a plain click button. Retain the item name button and both transfer actions inside the expanded popover. Add `aria-label="Открыть действия: {{name}}"` instead of `title`.

```hbs
<article class="rm-storage-item{{#if expanded}} is-expanded{{/if}}" draggable="true" data-storage-row-drag data-row-id="{{rowId}}">
  <button type="button" class="rm-storage-item__icon" data-action="storage-toggle-row" data-row-id="{{rowId}}" aria-expanded="{{expanded}}" aria-label="Открыть действия: {{name}}">
    <img src="{{img}}" alt="">
    {{#if showQuantity}}<strong class="rm-storage-item__quantity">{{quantity}}</strong>{{/if}}
  </button>
  {{#if expanded}}
    <div class="rm-storage-item__popover rm-storage-item__popover--{{popoverAlignment}}" data-storage-popover>
      {{#if canOpenSource}}
        <button type="button" class="rm-storage-item__name" data-action="storage-open-item" data-row-id="{{rowId}}">{{name}}</button>
      {{else}}
        <strong class="rm-storage-item__name rm-storage-item__name--plain">{{name}}</strong>
      {{/if}}
      <div class="rm-storage-item__actions">
        <button type="button" class="rm-button rm-button--primary" data-action="storage-claim-self" data-row-id="{{rowId}}">Себе</button>
        <button type="button" class="rm-button rm-button--secondary" data-action="storage-claim-party" data-row-id="{{rowId}}">В группу</button>
      </div>
      {{#if canEdit}}
        <div class="rm-storage-item__edit">
          <input data-storage-quantity type="number" min="1" step="1" value="{{quantity}}" aria-label="Количество">
          <button type="button" class="rm-icon-button" data-action="storage-update-row" data-row-id="{{rowId}}" aria-label="Сохранить количество"><i class="fa-solid fa-check"></i></button>
          <button type="button" class="rm-icon-button" data-action="storage-delete-row" data-row-id="{{rowId}}" aria-label="Удалить предмет"><i class="fa-solid fa-trash"></i></button>
        </div>
      {{/if}}
    </div>
  {{/if}}
</article>
```

Use the same complete name/source, self/group, quantity, and delete body for every item row; coin rows retain their two existing claim buttons and receive the same title removal and styled popover shell.

- [ ] **Step 5: Replace generic tooltip presentation with module popover CSS**

```css
.rebreya-storage-app .window-content { overflow: visible; }
.rm-storage-shell { overflow: visible; padding: 10px; background: linear-gradient(180deg, #15171c, #0d0f13); }
.rm-storage-item__popover {
  position: absolute;
  z-index: 100;
  top: calc(100% + 10px);
  width: 224px;
  padding: 10px;
  border: 1px solid rgb(218 174 76 / 0.72);
  border-radius: 8px;
  background: linear-gradient(180deg, rgb(28 30 37 / 0.99), rgb(12 14 18 / 0.99));
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.58), inset 0 0 0 1px rgb(255 255 255 / 0.04);
}
```

Keep left/center/right arrow alignment. Allow vertical room only while a card is expanded, clamp the app width to the viewport, and preserve the token anchor pointer.

- [ ] **Step 6: Run UI, drag, and storage mutation tests**

Run: `node --test tests/storage-app.test.mjs tests/storage-transfer-drop.test.mjs tests/storage-module-api.test.mjs tests/storage-socket.test.mjs`

Expected: PASS for LKM, both claim destinations, quantity prompts, drag, matching-token refresh, and cleanup on close.

- [ ] **Step 7: Commit reactive storage UI**

```powershell
git add scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/storage-app.test.mjs
git commit -m "fix: make storage grid live and clickable"
```

---

### Task 7: Full Cleanup, Regression Verification, and Live Foundry Smoke Test

**Files:**
- Modify: `tests/security.test.mjs`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `module.json` only if the cache-busting module version must change for Foundry to load the new sources.
- Review: every changed source, template, style, test, and design/plan document.

**Interfaces:**
- Consumes all prior task interfaces.
- Produces a branch with no Item Piles runtime reference, passing automated checks, and verified Foundry behavior.

- [ ] **Step 1: Scan executable files for forbidden dependency references**

Run: `rg -n -i "item.?piles|itempiles" scripts templates module.json`

Expected: no matches. Historical design/plan documents and Git history are outside the executable scan.

- [ ] **Step 2: Run whitespace and syntax-oriented checks**

Run: `git diff --check`

Expected: no output and exit code 0.

Run: `node --check scripts/data/storage-object-kind.js; node --check scripts/data/native-object-durability-service.js; node --check scripts/ui/durability-outcome-dialog.js; node --check scripts/integrations/durability-hooks.js; node --check scripts/ui/storage-app.js; node --check scripts/main.js`

Expected: every command exits 0.

- [ ] **Step 3: Run focused regression suites**

Run: `node --test tests/storage-object-kind.test.mjs tests/durability-rules.test.mjs tests/durability-service.test.mjs tests/durability-outcome-dialog.test.mjs tests/native-object-durability-service.test.mjs tests/durability-hooks.test.mjs tests/storage-service.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-app.test.mjs tests/storage-transfer-drop.test.mjs tests/storage-module-api.test.mjs tests/storage-socket.test.mjs tests/bg3-hotbar-compat.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs`

Expected: PASS.

- [ ] **Step 4: Run the complete Node test suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS with zero failures, cancellations, or unhandled rejections.

- [ ] **Step 5: Review the final diff and ownership boundary**

Run: `git status --short --branch`

Expected: only intended native-storage/durability files are modified.

Run: `git diff --stat; git diff -- scripts templates styles tests module.json`

Expected: no unrelated travel, economy, inventory, compendium, or user-owned edits.

- [ ] **Step 6: Perform the live Foundry smoke test**

Open `https://vtt.rebreya.com/` with the existing Codex profile and authenticate with the user-supplied password. Verify on the active scene:

1. A built-in chest window title is `Сундук` and the body begins with the item grid.
2. LKM opens the styled card; the name opens the source and both transfer buttons work.
3. Two open clients update immediately after LKM claim and drag claim.
4. Dropping one item on the scene creates a native pile; dropping an identical item on it stacks; emptying it deletes the token.
5. Chest damage stops at 0 HP and shows the manual outcome dialog.
6. Closing the dialog preserves the intact chest at 0 HP.
7. `Сломать предмет` leaves the chest broken at 0 HP.
8. `Разрушить предмет` on a fresh unopened chest creates exactly one native pile containing generated rows and coins, then removes the chest.
9. BG3 HUD does not cover or replace the storage interaction.

- [ ] **Step 7: Commit any live-test-only correction and push**

If the live test required a correction, rerun Steps 1-5 and commit only that correction:

```powershell
git add -- scripts/data/storage-object-kind.js scripts/data/native-object-durability-service.js scripts/data/durability-rules.js scripts/data/durability-service.js scripts/data/storage-service.js scripts/data/storage-ground-pile-service.js scripts/data/builtin-storage-presets.js scripts/data/builtin-storage-actor-service.js scripts/ui/durability-outcome-dialog.js scripts/ui/storage-app.js scripts/integrations/durability-hooks.js scripts/hooks.js scripts/main.js scripts/constants.js scripts/combat/implant-automation-service.js templates/storage-app.hbs styles/main.css module.json tests/storage-object-kind.test.mjs tests/native-object-durability-service.test.mjs tests/durability-outcome-dialog.test.mjs tests/durability-rules.test.mjs tests/durability-service.test.mjs tests/durability-hooks.test.mjs tests/storage-service.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-app.test.mjs tests/bg3-hotbar-compat.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs
git commit -m "fix: finalize native storage interactions"
```

Then push without force:

```powershell
git push origin lich_branch
```
