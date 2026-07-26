# Curse Eater Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматически поддерживать один эффект «Пожирателя проклятий» по проклятым предметам на кукле героя и реализовать ступени 1–7.

**Architecture:** Новый `CurseEaterAutomationService` содержит чистый расчёт проклятых предметов и управляет одним Active Effect персонажа. Сервис читает существующие флаги куклы и установленных усовершенствований, а `combat/hooks.js` направляет ему изменения документов и `dnd5e.preUseActivity` для бонуса ко всем исходящим Сл.

**Tech Stack:** Foundry VTT v13, dnd5e 5.2.5, JavaScript ES modules, Node.js `node:test`.

## Global Constraints

- Работать только в ветке `lich_branch`; не применять force push.
- Не изменять и не добавлять `Trace-20260724T044510.json`.
- Источник активности предмета: только `flags.rebreya-main.heroDoll.slots`.
- Один родительский предмет считается один раз независимо от количества проклятий.
- Эффективная редкость: максимум базовой редкости и редкости всех проклятий-усовершенствований.
- Ступень 6 предлагает одноразовый выбор двух разных характеристик без интерфейса смены.
- Ступень 8 определяется, но не создаёт механических бонусов.
- Сервис изменяет только собственный управляемый эффект и известные старые эффекты исходной черты.

---

### Task 1: Чистая модель проклятых предметов и порогов

**Files:**
- Create: `scripts/combat/curse-eater-automation-service.js`
- Create: `tests/curse-eater-automation-service.test.mjs`

**Interfaces:**
- Consumes: `flags.rebreya-main.heroDoll.slots`, `getInstalledUpgradeItems(hostItem)`.
- Produces:
  - `curseRankToRarity(rank: unknown): number`
  - `getEffectiveCursedItemRarity(item: ItemLike): number`
  - `collectActiveCursedItems(actor: ActorLike): Array<CursedItemSummary>`
  - `calculateCurseEaterProgress(items: Array<CursedItemSummary>): CurseEaterProgress`

- [ ] **Step 1: Write failing tests for curse detection and rarity**

```js
test("detects description and installed curse upgrades on doll items", () => {
  const actor = actorFixture({
    heroDoll: { slots: { head: { itemId: "crown" }, chest: { itemId: "coat" } } },
    items: [
      itemFixture("crown", { rarity: "rare", description: "ПРОКЛЯТЬЕ: шёпот" }),
      itemFixture("coat", {
        rarity: "legendary",
        installed: [upgradeFixture("minor-curse", { type: "Проклятье", rank: 3 })]
      }),
      itemFixture("bag", { rarity: "artifact", description: "Проклятье: забыто" })
    ]
  });

  assert.deepEqual(
    collectActiveCursedItems(actor).map(({ itemId, rarity }) => [itemId, rarity]),
    [["crown", 2], ["coat", 4]]
  );
});

test("maps curse ranks and keeps the higher parent rarity", () => {
  assert.deepEqual([1, 3, 5, 7, 9].map(curseRankToRarity), [0, 1, 2, 3, 4]);
  assert.equal(getEffectiveCursedItemRarity(
    itemFixture("blade", {
      rarity: "legendary",
      installed: [upgradeFixture("curse", { type: "Проклятье", rank: 3 })]
    })
  ), 4);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/curse-eater-automation-service.test.mjs`

Expected: FAIL because `curse-eater-automation-service.js` does not exist.

- [ ] **Step 3: Implement normalization and collection**

```js
export const CURSE_EATER_RARITY = Object.freeze({
  common: 0, uncommon: 1, rare: 2, veryRare: 3, legendary: 4, artifact: 5
});

export function curseRankToRarity(rank) {
  const safeRank = Math.max(1, Math.min(10, Math.trunc(Number(rank) || 1)));
  return Math.floor((safeRank - 1) / 2);
}

export function getEffectiveCursedItemRarity(item) {
  const base = normalizeItemRarity(item);
  const curseRanks = getInstalledUpgradeItems(item)
    .map((upgrade) => readUpgradeProfile(upgrade))
    .filter((profile) => isCurseText(profile?.type))
    .map((profile) => curseRankToRarity(profile?.rank));
  return Math.max(base, ...curseRanks, CURSE_EATER_RARITY.common);
}
```

`collectActiveCursedItems` reads unique `itemId` values from the hero-doll
slots, rejects missing items, recognizes `Проклятье` and `Проклятие`
case-insensitively, and returns summaries sorted by rarity then stable item ID.

- [ ] **Step 4: Add failing tests for optimal tier matching**

```js
test("uses the weakest qualifying item for each tier", () => {
  const progress = calculateCurseEaterProgress([
    { itemId: "rare", rarity: 2 },
    { itemId: "artifact", rarity: 5 }
  ]);
  assert.equal(progress.tier, 2);
  assert.deepEqual(progress.usedItemIds, ["rare", "artifact"]);
});

test("common plus legendary only reaches tier one", () => {
  assert.equal(calculateCurseEaterProgress([
    { itemId: "common", rarity: 0 },
    { itemId: "legendary", rarity: 4 }
  ]).tier, 1);
});
```

- [ ] **Step 5: Implement deterministic greedy matching**

```js
const TIER_REQUIREMENTS = Object.freeze([1, 2, 2, 2, 3, 3, 4, 5]);

export function calculateCurseEaterProgress(items) {
  const available = [...items].sort(compareCursedItems);
  const used = [];
  for (const requiredRarity of TIER_REQUIREMENTS) {
    const index = available.findIndex((item) => item.rarity >= requiredRarity);
    if (index < 0) break;
    used.push(available.splice(index, 1)[0]);
  }
  return {
    tier: used.length,
    usedItemIds: used.map((item) => item.itemId),
    usedItems: used
  };
}
```

- [ ] **Step 6: Run targeted tests and commit**

Run: `node --test tests/curse-eater-automation-service.test.mjs`

Expected: PASS.

```powershell
git add -- scripts/combat/curse-eater-automation-service.js tests/curse-eater-automation-service.test.mjs
git commit -m "feat: calculate curse eater tiers"
```

### Task 2: Один управляемый эффект и одноразовый выбор характеристик

**Files:**
- Modify: `scripts/combat/curse-eater-automation-service.js`
- Modify: `tests/curse-eater-automation-service.test.mjs`

**Interfaces:**
- Consumes: `calculateCurseEaterProgress`, actor embedded-document API.
- Produces:
  - `buildCurseEaterEffectData(progress, choice, proficiency): ActiveEffectData`
  - `CurseEaterAutomationService.syncActor(actor, options?): Promise<CurseEaterProgress>`
  - `CurseEaterAutomationService.initialize(): Promise<void>`

- [ ] **Step 1: Write failing effect-shape tests**

```js
test("builds all reached tiers into one effect and leaves tier eight manual", () => {
  const effect = buildCurseEaterEffectData(
    { tier: 8, usedItems: [] },
    ["str", "wis"],
    6
  );
  assert.equal(effect.flags["rebreya-main"].curseEater.tier, 8);
  assert.equal(effect.flags["rebreya-main"].curseEater.manualTierEight, true);
  assert.equal(effect.changes.filter((change) =>
    change.key.startsWith("system.abilities.")).length, 2);
  assert.equal(effect.changes.some((change) => change.value === "1"
    && change.key === "system.attributes.ac.bonus"), true);
  assert.equal(effect.changes.some((change) =>
    change.key.includes("curseSuppression")), false);
});
```

Verify RED:

`node --test tests/curse-eater-automation-service.test.mjs`

- [ ] **Step 2: Implement a single effect builder**

Build one transferable actor effect named `Пожиратель проклятий` with module
flag `flags.rebreya-main.curseEater.managed = true`. Add changes cumulatively:

```js
if (tier >= 1) changes.push(
  add("system.bonuses.mwak.attack", "+1"),
  add("system.bonuses.mwak.damage", "+1"),
  add("system.bonuses.rwak.attack", "+1"),
  add("system.bonuses.rwak.damage", "+1")
);
if (tier >= 2) changes.push(add("system.attributes.hp.bonuses.overall", "@prof"));
if (tier >= 3) changes.push(add("system.bonuses.abilities.save", "+1"));
if (tier >= 5) changes.push(add("system.attributes.ac.bonus", "1"));
if (tier >= 6 && choice?.length === 2) {
  for (const ability of choice) changes.push(add(`system.abilities.${ability}.value`, "1"));
}
if (tier >= 7) changes.push(
  add("system.traits.dr.value", "necrotic"),
  add("system.traits.dr.value", "psychic")
);
```

The ability-score key is `system.abilities.<ability>.value`, matching the
existing race penalty automation. Keep the exact selected keys covered by the
effect-shape test.

- [ ] **Step 3: Write failing lifecycle tests**

```js
test("syncActor creates, updates, and removes only one managed effect", async () => {
  const actor = actorWithFeatAndCurses(3);
  const service = new CurseEaterAutomationService({ chooseAbilities: async () => null });
  await service.syncActor(actor);
  assert.equal(managedEffects(actor).length, 1);
  await service.syncActor(actor);
  assert.equal(managedEffects(actor).length, 1);
  clearHeroDoll(actor);
  await service.syncActor(actor);
  assert.equal(managedEffects(actor).length, 0);
});
```

Verify RED:

`node --test tests/curse-eater-automation-service.test.mjs`

- [ ] **Step 4: Implement idempotent lifecycle**

`syncActor` must:

1. Reject non-character actors and non-owners.
2. Find the feat by `system.identifier` or module `featId`.
3. Remove only exact legacy effects embedded in that owned feat.
4. Collect doll items and calculate progress.
5. Compare a stable signature before creating/updating/deleting the managed
   actor effect.
6. Pass `{ rebreyaCurseEaterSync: true, render: false }` to self-created writes.
7. Show one owner notification only when the stored tier actually changes;
   repeated idempotent synchronization stays silent and never writes chat
   messages.

- [ ] **Step 5: Write failing one-time choice tests**

```js
test("tier six stores two distinct abilities once and reuses them", async () => {
  let calls = 0;
  const actor = actorWithFeatAndCurses(6);
  const service = new CurseEaterAutomationService({
    chooseAbilities: async () => (++calls, ["str", "wis"])
  });
  await service.syncActor(actor);
  await service.syncActor(actor);
  assert.deepEqual(actor.flags["rebreya-main"].curseEater.abilities, ["str", "wis"]);
  assert.equal(calls, 1);
});
```

- [ ] **Step 6: Implement validated choice storage**

Use an injected `chooseAbilities(actor)` for tests and a Foundry DialogV2
adapter in production. Validate against the six dnd5e ability IDs and require
two distinct values. Persist:

```js
await actor.setFlag(MODULE_ID, "curseEater", {
  ...currentState,
  abilities: ["str", "wis"]
});
```

Do not expose any change/reset action. A cancelled dialog leaves tier 6 without
ability bonuses and does not block tier 7. If the current client cannot update
the actor, skip the dialog and retry on a later owner synchronization.

- [ ] **Step 7: Run targeted tests and commit**

Run: `node --test tests/curse-eater-automation-service.test.mjs`

Expected: PASS.

```powershell
git add -- scripts/combat/curse-eater-automation-service.js tests/curse-eater-automation-service.test.mjs
git commit -m "feat: manage curse eater effect"
```

### Task 3: Исходящие Сл и событийная синхронизация

**Files:**
- Modify: `scripts/combat/curse-eater-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/curse-eater-automation-service.test.mjs`

**Interfaces:**
- Consumes: dnd5e `dnd5e.preUseActivity`, Foundry Item/Actor hooks.
- Produces:
  - `CurseEaterAutomationService.applyDnd5ePreUseActivity(activity, usageConfig): true`
  - `CurseEaterAutomationService.handleActorChanged(actor, changed, options): Promise<void>`
  - `CurseEaterAutomationService.handleItemChanged(item, options): Promise<void>`

- [ ] **Step 1: Write failing outgoing-DC tests**

```js
test("adds one to every owned save activity once per use", () => {
  const actor = actorWithManagedTier(4);
  const activity = saveActivityFixture(actor, { bonus: "" });
  const usageConfig = {};
  const service = new CurseEaterAutomationService();
  assert.equal(service.applyDnd5ePreUseActivity(activity, usageConfig), true);
  assert.equal(activity.save.dc.bonus, "1");
  service.applyDnd5ePreUseActivity(activity, usageConfig);
  assert.equal(activity.save.dc.bonus, "1");
});

test("does not change activities from another actor or below tier four", () => {
  const activity = saveActivityFixture(actorWithManagedTier(3), { bonus: "2" });
  new CurseEaterAutomationService().applyDnd5ePreUseActivity(activity, {});
  assert.equal(activity.save.dc.bonus, "2");
});
```

- [ ] **Step 2: Implement transient dnd5e save-DC bonus**

Guard on activity type `save`, an owned actor, and managed tier `>= 4`.
Append `1` to `activity.save.dc.bonus` and set
`usageConfig.rebreyaCurseEaterDcApplied = true`. Do not update the source Item.

- [ ] **Step 3: Write failing event/debounce tests**

```js
test("coalesces repeated actor and item changes", async () => {
  const actor = actorWithFeatAndCurses(1);
  const service = new CurseEaterAutomationService({ debounceMs: 0 });
  await Promise.all([
    service.handleItemChanged(actor.items.get("curse")),
    service.handleItemChanged(actor.items.get("curse")),
    service.handleActorChanged(actor, { flags: { "rebreya-main": { heroDoll: {} } } })
  ]);
  assert.equal(actor.syncCount, 1);
});
```

- [ ] **Step 4: Implement handlers and registration**

In `scripts/main.js`:

```js
import { CurseEaterAutomationService } from "./combat/curse-eater-automation-service.js";
// constructor
this.curseEaterAutomationService = new CurseEaterAutomationService(this);
// initialize()
await this.curseEaterAutomationService.initialize();
```

In `scripts/combat/hooks.js`, include the service in the early-exit condition
and register:

```js
Hooks.on("updateActor", (actor, changed, options) =>
  service.handleActorChanged(actor, changed, options).catch(handleError));
for (const hookName of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hookName, (item, _changed, options) =>
    service.handleItemChanged(item, options).catch(handleError));
}
Hooks.on("dnd5e.preUseActivity", (activity, usageConfig) =>
  service.applyDnd5ePreUseActivity(activity, usageConfig));
```

Normalize differing create/delete hook argument positions in a small local
adapter so `options` is always forwarded correctly. `initialize()` synchronizes
owned character actors independently and logs per-actor failures.

- [ ] **Step 5: Run service tests and syntax checks**

Run:

```powershell
node --test tests/curse-eater-automation-service.test.mjs
node --check scripts/combat/curse-eater-automation-service.js
node --check scripts/combat/hooks.js
node --check scripts/main.js
```

Expected: all PASS / no syntax output.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/combat/curse-eater-automation-service.js scripts/combat/hooks.js scripts/main.js tests/curse-eater-automation-service.test.mjs
git commit -m "feat: synchronize curse eater automation"
```

### Task 4: Исправление источника черты в компендиуме

**Files:**
- Modify: `scripts/data/feats-compendium.js`
- Modify: `tests/feats-compendium.test.mjs`

**Interfaces:**
- Consumes: normalized feat with `featId === "pozhiratel-proklyatiy"`.
- Produces: compendium feat without legacy unconditional effects and with
  `flags.rebreya-main.automation.status === "active"`.

- [ ] **Step 1: Write a failing compendium test**

```js
test("curse eater feat delegates all conditional bonuses to runtime automation", () => {
  const source = curseEaterSourceWithLegacyEffects();
  const [feat] = normalizeFeatItems([source]);
  assert.deepEqual(feat.effects, []);
  assert.deepEqual(feat.system.activities, {});
  assert.equal(feat.flags["rebreya-main"].automation.status, "active");
  assert.match(feat.flags["rebreya-main"].automation.notes, /1–7/u);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/feats-compendium.test.mjs`

Expected: FAIL because legacy effects remain.

- [ ] **Step 3: Extend `applyFeatAutomationOverrides`**

Refactor the performer-only early return into explicit branches. For Curse
Eater, return:

```js
{
  ...feat,
  effects: [],
  system: { ...feat.system, activities: {} },
  flags: {
    ...feat.flags,
    [MODULE_ID]: {
      ...moduleFlags,
      automation: {
        ...moduleFlags.automation,
        status: "active",
        notes: "Ступени 1–7 синхронизируются по проклятым предметам на кукле героя; ступень 8 применяется вручную."
      }
    }
  }
}
```

- [ ] **Step 4: Run compendium and service tests**

Run:

```powershell
node --test tests/feats-compendium.test.mjs
node --test tests/curse-eater-automation-service.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/data/feats-compendium.js tests/feats-compendium.test.mjs
git commit -m "fix: remove unconditional curse eater bonuses"
```

### Task 5: Полная проверка и доставка

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: verified branch pushed to `origin/lich_branch`.

- [ ] **Step 1: Run focused related suites**

```powershell
node --test tests/curse-eater-automation-service.test.mjs
node --test tests/feats-compendium.test.mjs
node --test tests/hero-doll-service.test.mjs
node --test tests/item-upgrade-service.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `node --test tests`

Expected: all new and related tests PASS. Record the already-known pre-existing
Counterspell failure separately if it remains unchanged.

- [ ] **Step 3: Inspect final changes**

```powershell
git diff --check
git status --short
git log --oneline origin/lich_branch..HEAD
```

Confirm that only intended source, test, documentation files are present and
`Trace-20260724T044510.json` remains untracked.

- [ ] **Step 4: Commit any verification-only corrections**

Only if Step 1 or 2 required a code correction:

```powershell
git add -- scripts/combat/curse-eater-automation-service.js scripts/combat/hooks.js scripts/main.js scripts/data/feats-compendium.js tests/curse-eater-automation-service.test.mjs tests/feats-compendium.test.mjs
git commit -m "fix: harden curse eater automation"
```

- [ ] **Step 5: Push without force**

Run: `git push origin lich_branch`

Expected: `lich_branch -> lich_branch`.
