# Durability, Broken Loot, and Item Piles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give nonmagical equipment instance durability, make broken equipment mechanically inert, let Lootgen produce broken items, and expose item HP/AC on single-item Item Piles tokens.

**Architecture:** Pure durability rules resolve material/construction/size profiles and damage transitions. `DurabilityService` owns item flags and durable destruction mutations; focused hooks block broken-item mechanics. Lootgen annotates the normal functional item data, while the Item Piles integration projects one item's durability onto the pile actor/token without creating aggregate statistics for mixed piles.

**Tech Stack:** Foundry VTT v13, dnd5e, Midi-QOL hooks, Item Piles API, ApplicationV2/Handlebars, vanilla ES modules, `node:test`.

## Global Constraints

- Requires the complete material catalog from the Crafting Projects v2 plan.
- Durability applies only to nonmagical gear; magic items are never initialized, damaged, or generated broken.
- First zero HP breaks the item and resets its durability HP to maximum.
- Second zero HP destroys the item through a durable GM-owned mutation.
- Objects ignore poison and psychic damage.
- Damage at or below the threshold causes zero durability loss.
- Broken items retain identity, quantity, weight, value, image, and description but provide no mechanics.
- Broken items may be carried or held.
- Repair is not implemented.
- Intact, broken, and destroyed instances never merge into one stack.
- Only a single-item Item Pile receives item-derived HP/AC/threshold; mixed piles remain ordinary piles.

---

## File Map

- Create `scripts/data/durability-rules.js`: material aliases, profiles, size scaling, eligibility, and damage transitions.
- Create `scripts/data/durability-service.js`: item initialization, flag updates, state transitions, and durable destruction.
- Create `scripts/integrations/durability-hooks.js`: use/effect/equipment suppression and item lifecycle hooks.
- Create `scripts/integrations/item-piles-durability.js`: pile creation projection and synchronization.
- Create `tests/durability-rules.test.mjs`, `tests/durability-service.test.mjs`, `tests/durability-hooks.test.mjs`, and `tests/item-piles-durability.test.mjs`.
- Modify `scripts/constants.js`: durability flag keys and hook names.
- Modify `scripts/main.js`: instantiate/expose durability APIs and register integrations.
- Modify `scripts/hooks.js`: register safe Foundry/Item Piles lifecycle hooks.
- Modify `scripts/data/inventory-service.js`: durability-aware item similarity, split/merge preservation, and source initialization.
- Modify `scripts/integrations/item-piles-dnd5e.js`: include durability signature in Item Piles similarities.
- Modify `scripts/ui/lootgen-app.js`: broken chance setting and per-row flagging.
- Modify `templates/lootgen-app.hbs`: percentage stepper and broken status marker.
- Modify `scripts/ui/lootgen-chat.js`: preserve/display broken state in shared loot.
- Modify `styles/main.css`: broken row/item status with readable non-color cue.
- Modify `scripts/data/materials-compendium.js` only if profile aliases need normalized metadata exposed to the runtime model.
- Modify `tests/inventory-sync-hooks.test.mjs`, `tests/group-inventory-migration.test.mjs`, `tests/lootgen-chat.test.mjs`, and `tests/inventory-app-context.test.mjs`.

### Task 1: Pure Durability Rules

**Interfaces:**

- Produces `isDurabilityEligible(itemData): boolean`.
- Produces `resolveDurabilityProfile({ itemData, gear, material }): DurabilityProfile`.
- Produces `buildInitialDurability(profile): DurabilityFlag`.
- Produces `applyDurabilityDamage(flag, { amount, damageType }): DurabilityTransition`.
- Produces `buildDurabilitySignature(flag): string`.

- [ ] **Step 1: Write failing rule tests**

Cover every profile row, all six size multipliers, explicit metadata precedence, material aliases from the complete encyclopedia, sturdy/small defaults, unknown-to-Wood diagnostic, magic exclusion, poison/psychic immunity, threshold boundary, first break, second destruction, and stable signatures.

```js
test("steel sturdy small equipment has fifteen HP, AC 17, and threshold 6", () => {
  const profile = resolveDurabilityProfile({
    itemData: { type: "weapon", system: { properties: new Set() } },
    gear: { predominantMaterialName: "Сталь" },
    material: { name: "Сталь" }
  });
  assert.deepEqual(profile, {
    materialProfile: "steel",
    construction: "sturdy",
    size: "small",
    hpMax: 15,
    ac: 17,
    damageThreshold: 6
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/durability-rules.test.mjs`

Expected: FAIL because `scripts/data/durability-rules.js` does not exist.

- [ ] **Step 3: Implement profile resolution**

Define the table exactly as the design spec. Normalize Russian/English aliases without fuzzy substring collisions; explicit item flags win, then material-record mapping, then categorized aliases, then Wood fallback with a diagnostic token.

```js
export const DURABILITY_PROFILES = Object.freeze({
  fabric: { fragile: 1, sturdy: 3, ac: 9, threshold: 0 },
  wood: { fragile: 3, sturdy: 6, ac: 12, threshold: 2 },
  glass: { fragile: 2, sturdy: 5, ac: 11, threshold: 0 },
  leather: { fragile: 2, sturdy: 6, ac: 11, threshold: 2 },
  iron: { fragile: 5, sturdy: 11, ac: 14, threshold: 5 },
  steel: { fragile: 7, sturdy: 15, ac: 17, threshold: 6 },
  adamantine: { fragile: 10, sturdy: 22, ac: 19, threshold: 10 },
  stone: { fragile: 4, sturdy: 8, ac: 13, threshold: 3 },
  mithral: { fragile: 6, sturdy: 12, ac: 15, threshold: 5 },
  crystal: { fragile: 4, sturdy: 11, ac: 12, threshold: 4 }
});
```

- [ ] **Step 4: Implement immutable damage transitions**

Return `{ outcome: "ignored" | "damaged" | "broken" | "destroyed", nextFlag, appliedDamage }`. On first zero set `breakStage: 1`, `state: "broken"`, and `hp.value = hp.max`; on second zero set stage 2 and zero HP.

- [ ] **Step 5: Run rules tests and commit**

Run: `node --test tests/durability-rules.test.mjs`

Expected: PASS.

```bash
git add scripts/data/durability-rules.js tests/durability-rules.test.mjs
git commit -m "feat: add equipment durability rules"
```

### Task 2: DurabilityService and Durable State Changes

**Interfaces:**

- Produces `initializeItem(item, { force = false, sourceType, sourceId }): Promise<DurabilityFlag | null>`.
- Produces `damageItem(item, { amount, damageType, mutationId }): Promise<DurabilityTransition>`.
- Produces `breakItem(item, { mutationId }): Promise<DurabilityTransition>`.
- Produces `destroyItem(item, { mutationId }): Promise<DurabilityTransition>`.
- Produces `getDurability(item): DurabilityFlag | null` and `isBroken(item): boolean`.

- [ ] **Step 1: Write failing service tests**

Mock item documents and cover initialization once, explicit reinitialization, magic no-op, flag update, equipped/attuned clearing on break, held-state preservation, deletion on destruction, deletion retry, and visible destroyed fallback when deletion fails.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/durability-service.test.mjs tests/durable-mutation-journal.test.mjs`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement service mutations**

Use plain update payloads and the module mutation coordinator; never mutate dnd5e DataModel instances. Break updates `system.equipped: false`, clears attunement when supported, and writes the complete durability flag in one document update.

```js
const update = {
  [`flags.${MODULE_ID}.durability`]: transition.nextFlag,
  "system.equipped": false
};
await item.update(update);
```

Destruction journals the intended item UUID and treats an already-missing item as committed.

- [ ] **Step 4: Expose APIs from the module**

Instantiate in `scripts/main.js` after inventory/model services and expose thin module methods for hooks, Lootgen, and Item Piles. Emit `${MODULE_ID}.durabilityUpdated` after committed updates.

- [ ] **Step 5: Run service tests and commit**

Run: `node --test tests/durability-service.test.mjs tests/durable-mutation-journal.test.mjs tests/world-mutation-infrastructure.test.mjs`

Expected: PASS.

```bash
git add scripts/data/durability-service.js scripts/constants.js scripts/main.js tests/durability-service.test.mjs
git commit -m "feat: persist equipment durability transitions"
```

### Task 3: Broken-Item Mechanical Suppression

**Interfaces:**

- Registers dnd5e pre-use hooks and document lifecycle hooks through `registerDurabilityHooks(moduleApi)`.
- Produces `canUseDurabilityItem(item): { allowed, reason }` for shared hook decisions.
- Produces `filterBrokenItemEffects(effects, item): Effect[]` for derived-data integration.

- [ ] **Step 1: Write failing hook tests**

Cover dnd5e activity use, Midi workflow start, embedded Active Effects, shield/armor contribution, item attacks, natural/non-item actions, held broken object, and magic item bypass.

```js
const allowed = preUseActivity({ item: brokenSword });
assert.equal(allowed, false);
assert.match(notifications.at(-1), /сломано/u);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/durability-hooks.test.mjs tests/held-shield-ac.test.mjs tests/held-items.test.mjs`

Expected: FAIL on missing broken-state checks.

- [ ] **Step 3: Implement use/effect suppression**

Block at `dnd5e.preUseActivity` before Midi creates a workflow. Register the compatible Midi pre-item hook only as a fallback guard, keyed by workflow/item UUID to avoid duplicate notifications. Suppress only effects whose parent item is broken.

- [ ] **Step 4: Integrate armor and shield calculations**

Feed `isBroken(item)` into existing equipment/held-shield eligibility helpers so broken armor and shields contribute zero while remaining in inventory or a hand. Do not patch dnd5e formula DataModels.

- [ ] **Step 5: Run hook tests and commit**

Run: `node --test tests/durability-hooks.test.mjs tests/held-shield-ac.test.mjs tests/held-items.test.mjs tests/combat-attack-service.test.mjs`

Expected: PASS.

```bash
git add scripts/integrations/durability-hooks.js scripts/hooks.js scripts/integrations/held-items.js scripts/main.js tests/durability-hooks.test.mjs tests/held-shield-ac.test.mjs tests/held-items.test.mjs
git commit -m "feat: disable mechanics for broken equipment"
```

### Task 4: Inventory Identity and Item Initialization

**Interfaces:**

- Inventory merge identity includes `flags.rebreya-main.durability.state`, profile, construction, size, HP value/max, AC, and threshold.
- Model/compendium item creation initializes eligible nonmagical gear as intact.
- Stack split copies the complete durability flag.

- [ ] **Step 1: Write failing inventory tests**

Assert intact and broken items do not merge, unequal HP does not merge, identical homogeneous stacks do merge, split preserves flags, imported eligible items initialize once, and magic items remain unflagged.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs`

Expected: FAIL because similarity currently uses source type/source ID only.

- [ ] **Step 3: Implement durability-aware identity**

Add the pure signature to `#findInventoryMergeCandidate`, Item Piles `ITEM_SIMILARITIES`, import normalization, and mutation receipts. Existing unflagged eligible items initialize lazily before comparison; migration must not flag magic items.

- [ ] **Step 4: Run inventory tests and commit**

Run: `node --test tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs tests/universal-belt.test.mjs`

Expected: PASS.

```bash
git add scripts/data/inventory-service.js scripts/integrations/item-piles-dnd5e.js tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs
git commit -m "feat: preserve durability in inventory stacks"
```

### Task 5: Broken Equipment in Lootgen

**Interfaces:**

- Lootgen state gains `brokenEquipmentChance` integer `0-100`, default `0`.
- Each generated eligible mundane row receives one independent roll.
- Broken rows use normal functional item data plus a broken durability flag.

- [ ] **Step 1: Write failing Lootgen tests**

Cover chance 0/100, deterministic injected RNG, mundane eligibility, magic exclusion, shared chat payload, inventory claim, and visible broken status.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/lootgen-chat.test.mjs tests/inventory-app-context.test.mjs`

Expected: FAIL because generated rows have no durability state.

- [ ] **Step 3: Add setting and row initialization**

Render a numeric stepper in settings. At generation time resolve the complete source item, initialize durability, and call the service's pure break builder when the roll succeeds. Do not replace the source item with generic loot.

```js
const broken = eligible && rng() * 100 < brokenEquipmentChance;
row.itemData = moduleApi.initializeLootDurability(row.itemData, { broken });
row.isBroken = broken;
```

- [ ] **Step 4: Preserve state through chat and claims**

Clone the complete item flags into shared payloads and drag data. Display `Сломано` with icon plus color so the state remains readable without color perception.

- [ ] **Step 5: Run Lootgen tests and commit**

Run: `node --test tests/lootgen-chat.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs tests/magic-items-compendium.test.mjs`

Expected: PASS.

```bash
git add scripts/ui/lootgen-app.js scripts/ui/lootgen-chat.js templates/lootgen-app.hbs styles/main.css tests/lootgen-chat.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
git commit -m "feat: generate broken mundane equipment"
```

### Task 6: Item Piles Durability Projection

**Interfaces:**

- Produces `buildItemPileDurabilityProjection(items): ItemPileProjection | null`.
- Produces `applyItemPileDurability(actor, tokenDocument, projection): Promise<void>`.
- Registers `item-piles-preCreateItemPile` and item update/delete hooks through `registerItemPilesDurability(moduleApi)`.

- [ ] **Step 1: Write failing projection tests**

Cover one eligible item, broken item, magic item, multiple quantities of the same homogeneous stack, mixed items, HP/AC/threshold paths, token bar path, actor damage synchronization, first break, and second-zero pile/item deletion.

```js
assert.deepEqual(buildItemPileDurabilityProjection([steelSword]), {
  itemUuid: steelSword.uuid,
  hp: { value: 15, max: 15 },
  ac: 17,
  damageThreshold: 6
});
assert.equal(buildItemPileDurabilityProjection([steelSword, leatherArmor]), null);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/item-piles-durability.test.mjs`

Expected: FAIL because the projection integration does not exist.

- [ ] **Step 3: Implement single-item pile creation**

Before pile creation, project to dnd5e actor paths:

```js
actorUpdates["system.attributes.hp"] = projection.hp;
actorUpdates["system.attributes.ac.calc"] = "flat";
actorUpdates["system.attributes.ac.flat"] = projection.ac;
tokenUpdates.bar1 = { attribute: "attributes.hp" };
tokenUpdates.flags[MODULE_ID] = { durabilityItemUuid: projection.itemUuid };
```

Store threshold in the Rebreya pile flag and enforce it through the actor-update hook before forwarding actual damage to the item service.

- [ ] **Step 4: Synchronize item and pile lifecycle**

Item durability is authoritative. Refresh actor HP/AC after item updates, prevent recursive actor/item loops with a scoped operation token, and remove the pile when the authoritative item is destroyed. Mixed piles clear the projection flag and derived bars.

- [ ] **Step 5: Run Item Piles tests and commit**

Run: `node --test tests/item-piles-durability.test.mjs tests/bg3-hotbar-compat.test.mjs tests/inventory-sync-hooks.test.mjs`

Expected: PASS.

```bash
git add scripts/integrations/item-piles-durability.js scripts/integrations/item-piles-dnd5e.js scripts/hooks.js scripts/main.js tests/item-piles-durability.test.mjs tests/bg3-hotbar-compat.test.mjs
git commit -m "feat: project item durability onto Item Piles"
```

### Task 7: End-to-End Verification

- [ ] **Step 1: Run the focused suite**

Run: `node --test tests/durability-rules.test.mjs tests/durability-service.test.mjs tests/durability-hooks.test.mjs tests/item-piles-durability.test.mjs tests/lootgen-chat.test.mjs tests/inventory-sync-hooks.test.mjs tests/held-shield-ac.test.mjs tests/held-items.test.mjs`

Expected: all tests PASS.

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 3: Verify in Foundry**

Generate intact and broken mundane gear; verify magic items remain untouched; claim both without merging; attempt attacks/effects/armor/shield use from broken items; hold a broken item; place intact and broken single-item piles; damage below/above threshold; break and destroy; create a mixed pile and confirm no aggregate HP/AC; reload the world and repeat authoritative-state checks.

- [ ] **Step 4: Commit verification fixes only if needed**

```bash
git add scripts templates styles tests
git commit -m "test: verify durability and physical item piles"
```
