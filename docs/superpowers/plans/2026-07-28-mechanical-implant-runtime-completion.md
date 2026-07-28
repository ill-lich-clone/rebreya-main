# Mechanical Implant Runtime Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the requested runtime behavior for six already-registered mechanical implants without changing the existing aggregate-effect architecture.

**Architecture:** Extend the current capability compiler, derived-data patch, combat-turn handler, firearm reload flow, and craft-progress resolver. One focused sheet integration adds the loading action to the real `loot` implant Item because D&D5e `LootData` has no activities field; persistent runtime state is limited to the actor's reload-reservoir flag.

**Tech Stack:** Foundry VTT 13, D&D5e 5.2.5, native ES modules, `node:test`, existing Rebreya implant/firearm/crafting services.

## Global Constraints

- Work only on `lich_branch`; never commit or push to `main`/`master`.
- Run `git fetch origin` and stop on foreign uncommitted changes or conflict with current `origin/main`.
- Do not use force push.
- Extend the existing registry, aggregate Active Effect `Импланты`, services, and hooks; do not replace them.
- Do not create per-implant Active Effects, macros, hidden resource Items, or a migration.
- Do not automate life sense, great energy storage, insight storage, familiar containment, rocket-flight duration, telepathy messaging, or construct crafting.
- Preserve current reload behavior for actors without the implant.
- Tests are written and observed failing before production changes.

---

### Task 1: Capability parameters and derived actor data

**Files:**
- Modify: `scripts/data/implant-automation-registry.js`
- Modify: `scripts/integrations/implant-hooks.js`
- Modify: `tests/implant-automation-registry.test.mjs`
- Modify: `tests/implant-hooks.test.mjs`

**Interfaces:**
- Consumes: aggregate effect flag `flags.rebreya-main.automation.capabilities`.
- Produces:
  - condenser capability `{ type: "spellCondenser", spentPoints: number }`;
  - derived custom language `Телепатия (60 фт.)`;
  - derived flight `max(existingFly, walk)`;
  - derived `system.spells.spellN.max + 1`.

- [ ] **Step 1: Write failing compiler tests**

Add a variable-cost installation and assert the compiler retains the selected
points:

```js
assert.deepEqual(
  compiled.capabilities.find(({ type }) => type === "spellCondenser"),
  {
    implantId: "kondensator-magii",
    count: 1,
    type: "spellCondenser",
    spentPoints: 3
  }
);
```

- [ ] **Step 2: Run the registry test and observe failure**

Run:

```text
node --test tests/implant-automation-registry.test.mjs
```

Expected: FAIL because `spentPoints` is absent.

- [ ] **Step 3: Pass installation points through the compiler**

When compiling `spellCondenser`, copy the normalized
`entry.state.spentPoints` into the emitted capability. Do not add it to
unrelated capabilities.

- [ ] **Step 4: Write failing derived-data tests**

Cover all of these cases:

```js
assert.equal(model.spells.spell3.max, 4); // native max 3 plus condenser
assert.match(model.traits.languages.custom, /Телепатия \(60 фт\.\)/u);
assert.equal(model.attributes.movement.fly, model.attributes.movement.walk);
```

Also assert:

- condenser level 5 clamps to the actor's highest available native slot;
- an actor without native leveled slots gets no slot;
- stronger existing flight is not reduced;
- existing custom languages remain present;
- repeated `prepareDerivedData()` does not accumulate either bonus.

- [ ] **Step 5: Run derived-data tests and observe failure**

Run:

```text
node --test tests/implant-hooks.test.mjs
```

Expected: FAIL on the first new derived value.

- [ ] **Step 6: Extend the existing data-model patch**

Replace the actor-flags-only lookup with one aggregate automation-plan lookup
that returns both `actorFlags` and `capabilities`. Apply condenser, telepathy,
and rocket-thrust values after the original D&D5e derived-data preparation,
while retaining the current pre-original ability-cap handling and
post-original carrying-strength handling.

- [ ] **Step 7: Run focused tests**

Run:

```text
node --test tests/implant-automation-registry.test.mjs tests/implant-hooks.test.mjs
```

Expected: PASS.

### Task 2: Condenser slot resource reconciliation

**Files:**
- Modify: `scripts/data/implant-service.js`
- Modify: `tests/implant-service.test.mjs`

**Interfaces:**
- Consumes: old and newly compiled `spellCondenser` capabilities.
- Produces: `ImplantService` slot transition that grants the newly installed
  extra slot once and clamps current slots after removal or level change.

- [ ] **Step 1: Write failing loadout-transition tests**

Test install, identical repeated reconciliation, removal, and changing points:

```js
await service.applyLoadout(actor, [{
  itemId: condenser.id,
  installed: true,
  installedCount: 1,
  united: true,
  spentPoints: 3
}]);
assert.equal(actor.system.spells.spell3.value, 4);
```

Repeated reconciliation must keep the value at 4, not 5. Removal must clamp
the value to the native maximum of 3.

- [ ] **Step 2: Run the service test and observe failure**

Run:

```text
node --test tests/implant-service.test.mjs
```

Expected: FAIL because the resource value is unchanged.

- [ ] **Step 3: Add an idempotent condenser transition**

Inside aggregate reconciliation, compare the previous aggregate capability
with the newly compiled capability. After syncing the effect:

- grant one current slot only when a new effective bonus appears at a level;
- clamp the old level when the bonus disappears or moves;
- use actor updates with `rebreyaImplantReconcile: true`;
- never update an actor without ordinary leveled spell slots.

- [ ] **Step 4: Run focused tests**

Run:

```text
node --test tests/implant-service.test.mjs tests/implant-hooks.test.mjs
```

Expected: PASS.

### Task 3: Implant Item loading action and internal ammunition

**Files:**
- Create: `scripts/integrations/implant-item-sheet.js`
- Modify: `scripts/integrations/implant-automation-hooks.js`
- Modify: `scripts/combat/attack-service.js`
- Create: `tests/implant-item-sheet.test.mjs`
- Modify: `tests/combat-attack-service.test.mjs`

**Interfaces:**
- Produces:
  - `renderImplantItemSheetActions(app, html, moduleApi): boolean`;
  - actor flag `flags.rebreya-main.implantReloadReservoir`:

```js
{
  ammunitionItemId: "ammo-item-id",
  ammunitionIdentifier: "мушкетный патрон",
  ammunitionName: "Мушкетный патрон",
  quantity: 12,
  capacity: 20
}
```

- [ ] **Step 1: Write failing Item-sheet action tests**

Assert that only the real `loot` Item with gear ID
`mekhanizm-perezaryadki-oruzhiya` receives one button named
`Загрузить механизм`, and that clicking it calls
`combatAttackService.loadImplantReloadReservoir(actor)`. An unrelated Item
must receive no button.

- [ ] **Step 2: Run catalog tests and observe failure**

Run:

```text
node --test tests/implant-item-sheet.test.mjs
```

Expected: FAIL because the sheet integration module is absent.

- [ ] **Step 3: Build and register the Item-sheet action**

Create the focused sheet integration and register it from the existing implant
automation hook set for `renderItemSheet` and `renderItemSheet5e`. Inject only
one idempotent button into the Item sheet, preserve the Item type and all native
content, and disable execution when the compiled installed capability is
absent.

- [ ] **Step 4: Write failing reservoir loading tests**

Cover:

- missing installed capability is blocked;
- selecting 12 from a stack of 30 leaves 18 in inventory and stores 12;
- loading above remaining capacity clamps to 20;
- attempting to mix a different ammunition type is blocked;
- repeated cancelled dialogs change no state.

Call the public service method with deterministic test options:

```js
await service.loadImplantReloadReservoir(actor, {
  ammunitionItemId: ammo.id,
  amount: 12,
  createMessage: false
});
```

- [ ] **Step 5: Run reload tests and observe failure**

Run:

```text
node --test tests/combat-attack-service.test.mjs
```

Expected: FAIL because the method and reservoir do not exist.

- [ ] **Step 6: Implement loading and activity dispatch**

In the Item-sheet integration and `CombatAttackService`:

- validate the compiled `reloadWithoutFreeHand` capability;
- resolve ammo only from actor-owned D&D5e ammunition Items;
- prompt through `DialogV2.wait` in the sheet integration and pass the selected
  Item/amount into the combat service;
- update ammo quantity and actor reservoir together in a bounded operation;
- execute loading from the injected Item-sheet button;
- report success/failure with existing notification/chat conventions.

- [ ] **Step 7: Write failing weapon-reload tests**

With 6 compatible rounds in the reservoir and 20 missing in the weapon, assert
that reload consumes all 6 internally, then 14 from inventory. With an
incompatible reservoir, assert it remains unchanged and the existing inventory
path still reloads the weapon.

- [ ] **Step 8: Integrate reservoir-first firearm reload**

Extend `reloadFirearm` to consume a compatible reservoir before calling the
existing inventory-spend helper. Return reservoir and inventory consumption in
the result without changing existing result fields used by callers.

- [ ] **Step 9: Run focused tests**

Run:

```text
node --test tests/implant-item-sheet.test.mjs tests/combat-attack-service.test.mjs
```

Expected: PASS.

### Task 4: Combat-only recovery module

**Files:**
- Modify: `scripts/combat/implant-automation-service.js`
- Modify: `tests/implant-automation-service.test.mjs`

**Interfaces:**
- Consumes: `turnRegeneration` capability and incoming combat turn.
- Produces: one HP update per unique `combat.id/round/turn/actor.id`.

- [ ] **Step 1: Write failing start-of-turn tests**

Cover HP `1/20`, `2/20`, `19/20`, and `20/20`; only the middle two eligible
states heal. Invoke the same combat turn twice and assert only one update.
Assert a non-responsible client performs no update.

- [ ] **Step 2: Run the focused test and observe failure**

Run:

```text
node --test tests/implant-automation-service.test.mjs
```

Expected: FAIL because start-of-turn regeneration is absent.

- [ ] **Step 3: Extend `handleCombatTurnChange`**

Run regeneration for the incoming actor independently of the impulse-legs
prompt. Store bounded processed-turn keys, update
`system.attributes.hp.value` to `min(max, value + 1)`, and clear the keys in
`handleCombatEnd`.

- [ ] **Step 4: Run focused tests**

Run:

```text
node --test tests/implant-automation-service.test.mjs
```

Expected: PASS.

### Task 5: Ordinary crafting investment bonus

**Files:**
- Modify: `scripts/combat/implant-automation-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/implant-automation-service.test.mjs`
- Modify: `tests/crafting-service.test.mjs`

**Interfaces:**
- Produces:
  - `ImplantAutomationService.resolveCraftProgressBase(actor, { baseGold = 5, construct = false } = {}): number`;
  - `RebreyaMainModule.resolveCraftProgressBase(actorOrContext, project?): number`.

- [ ] **Step 1: Write failing resolver tests**

Assert ordinary base 5 becomes 10 with `craftingInvestmentBonus`, remains 5
without it, and `construct: true` is not selected by the current ordinary
crafting profiles.

- [ ] **Step 2: Run the implant test and observe failure**

Run:

```text
node --test tests/implant-automation-service.test.mjs
```

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement the focused resolver and module facade**

Resolve an actor passed directly or via `{ actorId }`. Add only
`capability.ordinary` to the supplied base and return a number so both current
`CraftingService` call shapes receive the same value.

- [ ] **Step 4: Add preview/process integration tests**

Install the capability in the fixture and assert:

```js
assert.equal(preview.effectiveBaseGold, 10);
assert.equal(processResult.dailyProgressGold, 10);
```

Keep the existing profile/hour multipliers intact by asserting their previous
tests still pass.

- [ ] **Step 5: Run focused tests**

Run:

```text
node --test tests/implant-automation-service.test.mjs tests/crafting-service.test.mjs
```

Expected: PASS.

### Task 6: Verification and delivery

**Files:**
- Review every file changed by Tasks 1–5.

**Interfaces:**
- Produces: tested commit pushed to `origin/lich_branch`.

- [ ] **Step 1: Run all implant/firearm/crafting tests**

Run:

```text
node --test tests/implant-automation-registry.test.mjs tests/implant-hooks.test.mjs tests/implant-service.test.mjs tests/implant-automation-service.test.mjs tests/implant-item-sheet.test.mjs tests/implants-catalog.test.mjs tests/combat-attack-service.test.mjs tests/crafting-service.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run repository-wide verification**

Run:

```text
git diff --check
node --test tests/*.test.mjs
```

Expected: zero diff errors and zero failing tests.

- [ ] **Step 3: Review the final diff**

Confirm that:

- only requested capabilities gained handlers;
- the aggregate effect remains singular;
- no migration or per-implant effect exists;
- ordinary non-implant reload behavior is unchanged;
- no foreign changes are included.

- [ ] **Step 4: Commit**

```text
feat: complete mechanical implant runtime automation
```

- [ ] **Step 5: Push**

Push `lich_branch` to `origin` without force.
