# Half-Giant and Creature Size Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dynamically apply Teyvankal size rules to player characters, repair all racial ability advancements, and configure the Half-Giant giant tribe on one owned feature Item.

**Architecture:** A focused `SizeAutomationService` owns reversible actor effects and exports the authoritative size table; `CombatAttackService` consumes the same table to compose transient melee reach. Race generation produces deterministic ability metadata, while `RaceAutomationService` owns actor-specific penalty and tribe choices on the embedded race/feature Items.

**Tech Stack:** Foundry VTT, dnd5e 5.2.5, ES modules, Foundry Active Effects, dnd5e activities, Node `node:test`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Before each implementation batch, require a clean worktree, run `git fetch origin --prune`, and check `origin/main` for conflicts.
- Do not use force push.
- Apply size modifiers only to actors whose `type` is `character`.
- Keep current Strength unchanged; `Нечеловеческая сила` only upgrades `system.abilities.str.max` to 22.
- Keep one owned `Великанье племя` Item and configure it in place.
- Use TDD: every production change follows a focused failing test that is observed RED first.
- Preserve unrelated user changes and stop if an unexpected dirty file or main-branch conflict appears.

---

## File Structure

- Create `scripts/combat/size-automation-service.js`: authoritative size rules, managed effect construction, actor synchronization, and reach lookup.
- Create `tests/size-automation-service.test.mjs`: pure table and managed-effect lifecycle tests.
- Modify `scripts/combat/attack-service.js`: compose size, weapon, racial, and class reach without mutating the Item.
- Modify `tests/combat-attack-service.test.mjs`: reach composition and regression tests.
- Modify `scripts/data/races-compendium.js`: Unicode ability parsing, explicit irregular race definitions, and penalty-choice flags.
- Modify `tests/races-compendium.test.mjs`: all-race advancement matrix and Half-Giant assertions.
- Modify `scripts/combat/race-automation-service.js`: owned race penalty configuration and giant-tribe configuration.
- Modify `tests/race-automation-service.test.mjs`: prompt ownership, managed effects, tribe choices, and reconfiguration.
- Modify `data/races-teyvankal-v01.json`: replace dormant giant-tribe effects with one selection runtime and accurate coverage metadata.
- Modify `docs/races-teyvankal-v01-automation-report.md`: record partial/manual Stone and Storm behavior accurately.
- Modify `scripts/combat/hooks.js`: register size, race-item creation, and sheet-repair hooks.
- Modify `scripts/main.js`: construct and initialize `SizeAutomationService`, including cache-bust imports.
- Modify `tests/module-manifest.test.mjs`: assert the new runtime modules remain reachable from the entrypoint.

---

### Task 1: Authoritative Size Rules and Effect Data

**Files:**
- Create: `scripts/combat/size-automation-service.js`
- Create: `tests/size-automation-service.test.mjs`

**Interfaces:**
- Produces: `getCharacterSizeRule(size: string): { size: string, ac: number, strengthChecks: number, dexterityChecks: number, baseReachFeet: number }`.
- Produces: `buildCharacterSizeEffectData(size: string): object | null`.
- Consumed later by: `SizeAutomationService` and `CombatAttackService`.

- [ ] **Step 1: Write the failing six-row table test**

Create `tests/size-automation-service.test.mjs` with the Foundry mode constant and exact expected values:

```js
import test from "node:test";
import assert from "node:assert/strict";

globalThis.CONST ??= { ACTIVE_EFFECT_MODES: { ADD: 2 } };

const { getCharacterSizeRule, buildCharacterSizeEffectData } = await import(
  "../scripts/combat/size-automation-service.js"
);

test("Teyvankal character size table exposes AC, checks, and base reach", () => {
  const expected = {
    tiny: [2, -2, 2, 0],
    sm: [1, -1, 1, 5],
    med: [0, 0, 0, 5],
    lg: [-1, 1, -1, 10],
    huge: [-2, 2, -2, 15],
    grg: [-3, 3, -3, 20]
  };
  for (const [size, values] of Object.entries(expected)) {
    const rule = getCharacterSizeRule(size);
    assert.deepEqual(
      [rule.ac, rule.strengthChecks, rule.dexterityChecks, rule.baseReachFeet],
      values
    );
  }
});

test("Medium has no managed modifier effect and Large has three visible changes", () => {
  assert.equal(buildCharacterSizeEffectData("med"), null);
  const large = buildCharacterSizeEffectData("lg");
  assert.deepEqual(large.changes.map(({ key, value }) => [key, value]), [
    ["system.attributes.ac.bonus", "-1"],
    ["system.abilities.str.bonuses.check", "1"],
    ["system.abilities.dex.bonuses.check", "-1"]
  ]);
  assert.equal(large.flags["rebreya-main"].sizeAutomation.managed, true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/size-automation-service.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `size-automation-service.js`.

- [ ] **Step 3: Implement the pure table and effect builder**

Create the module with immutable rows and a null Medium effect:

```js
import { MODULE_ID } from "../constants.js";

const ADD = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
const SIZE_RULES = Object.freeze({
  tiny: Object.freeze({ size: "tiny", label: "Крошечный", ac: 2, strengthChecks: -2, dexterityChecks: 2, baseReachFeet: 0 }),
  sm: Object.freeze({ size: "sm", label: "Маленький", ac: 1, strengthChecks: -1, dexterityChecks: 1, baseReachFeet: 5 }),
  med: Object.freeze({ size: "med", label: "Средний", ac: 0, strengthChecks: 0, dexterityChecks: 0, baseReachFeet: 5 }),
  lg: Object.freeze({ size: "lg", label: "Большой", ac: -1, strengthChecks: 1, dexterityChecks: -1, baseReachFeet: 10 }),
  huge: Object.freeze({ size: "huge", label: "Огромный", ac: -2, strengthChecks: 2, dexterityChecks: -2, baseReachFeet: 15 }),
  grg: Object.freeze({ size: "grg", label: "Громадный", ac: -3, strengthChecks: 3, dexterityChecks: -3, baseReachFeet: 20 })
});

export function getCharacterSizeRule(size) {
  return SIZE_RULES[String(size ?? "").trim().toLowerCase()] ?? SIZE_RULES.med;
}

export function buildCharacterSizeEffectData(size) {
  const rule = getCharacterSizeRule(size);
  if (rule.size === "med") return null;
  return {
    name: `Размер существа: ${rule.label}`,
    img: "icons/svg/upgrade.svg",
    disabled: false,
    transfer: false,
    changes: [
      { key: "system.attributes.ac.bonus", mode: ADD, value: String(rule.ac), priority: 20 },
      { key: "system.abilities.str.bonuses.check", mode: ADD, value: String(rule.strengthChecks), priority: 20 },
      { key: "system.abilities.dex.bonuses.check", mode: ADD, value: String(rule.dexterityChecks), priority: 20 }
    ],
    flags: { [MODULE_ID]: { sizeAutomation: { managed: true, size: rule.size } } }
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/size-automation-service.test.mjs`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the pure rules**

```powershell
git add -- scripts/combat/size-automation-service.js tests/size-automation-service.test.mjs
git commit -m "feat(combat): define dynamic character size rules"
```

---

### Task 2: Managed Character Size Effect Lifecycle

**Files:**
- Modify: `scripts/combat/size-automation-service.js`
- Modify: `tests/size-automation-service.test.mjs`
- Modify: `scripts/main.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/module-manifest.test.mjs`

**Interfaces:**
- Consumes: `buildCharacterSizeEffectData(size)` from Task 1.
- Produces: `SizeAutomationService.initialize(): Promise<boolean>`.
- Produces: `SizeAutomationService.syncActor(actor): Promise<boolean>`.
- Produces: `handleActorUpdated(actor, changed, options)` and `handleActiveEffectChanged(effect, options)` hook adapters.

- [ ] **Step 1: Add failing lifecycle tests**

Extend `tests/size-automation-service.test.mjs` with a fake character supporting `createEmbeddedDocuments`, `updateEmbeddedDocuments`, and `deleteEmbeddedDocuments`. Assert:

```js
test("syncActor creates, updates, deduplicates, and removes the managed size effect", async () => {
  const actor = makeActor({ type: "character", size: "lg" });
  const service = new SizeAutomationService({}, { canManageActor: () => true });

  await service.syncActor(actor);
  assert.equal(actor.effects.contents.length, 1);
  assert.equal(actor.effects.contents[0].flags["rebreya-main"].sizeAutomation.size, "lg");

  actor.system.traits.size = "huge";
  await service.syncActor(actor);
  assert.equal(actor.effects.contents.length, 1);
  assert.equal(actor.effects.contents[0].changes[0].value, "-2");

  actor.system.traits.size = "med";
  await service.syncActor(actor);
  assert.equal(actor.effects.contents.length, 0);
});

test("syncActor ignores NPC actors and unauthorized clients", async () => {
  const npc = makeActor({ type: "npc", size: "lg" });
  const denied = makeActor({ type: "character", size: "lg" });
  await new SizeAutomationService({}, { canManageActor: () => true }).syncActor(npc);
  await new SizeAutomationService({}, { canManageActor: () => false }).syncActor(denied);
  assert.equal(npc.effects.contents.length, 0);
  assert.equal(denied.effects.contents.length, 0);
});
```

Also add source assertions in `tests/module-manifest.test.mjs` for the import, construction, initialization, and hook calls.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/size-automation-service.test.mjs tests/module-manifest.test.mjs`

Expected: FAIL because `SizeAutomationService` and its entrypoint integration do not exist.

- [ ] **Step 3: Implement serialized synchronization**

Add a class that keeps `this._actorQueues = new Map()`, finds effects where `flags.rebreya-main.sizeAutomation.managed === true`, and performs these exact transitions:

```js
export class SizeAutomationService {
  constructor(moduleApi, { canManageActor = defaultCanManageActor, actors = () => game.actors?.contents ?? [] } = {}) {
    this.moduleApi = moduleApi;
    this._canManageActor = canManageActor;
    this._actors = actors;
    this._actorQueues = new Map();
  }

  async initialize() {
    for (const actor of this._actors()) await this.syncActor(actor);
    return true;
  }

  syncActor(actor) {
    if (actor?.type !== "character" || !this._canManageActor(actor)) return Promise.resolve(false);
    const previous = this._actorQueues.get(actor.uuid) ?? Promise.resolve();
    const queued = previous.catch(() => false).then(() => this._syncActorNow(actor));
    this._actorQueues.set(actor.uuid, queued);
    return queued.finally(() => {
      if (this._actorQueues.get(actor.uuid) === queued) this._actorQueues.delete(actor.uuid);
    });
  }

  handleActorUpdated(actor, changed, options = {}) {
    if (options.rebreyaSizeAutomation === true) return Promise.resolve(false);
    return this.syncActor(actor);
  }

  handleActiveEffectChanged(effect, options = {}) {
    if (options.rebreyaSizeAutomation === true) return Promise.resolve(false);
    return this.syncActor(effect?.parent);
  }
}
```

`_syncActorNow` must compare normalized `name`, `changes`, and flags, update the first managed effect only when different, delete duplicates, create one when required, and delete all managed effects for Medium. Pass `{ rebreyaSizeAutomation: true }` to every embedded-document mutation.

- [ ] **Step 4: Wire the service into the module and hooks**

In `scripts/main.js`, import, construct, and initialize `SizeAutomationService`. In `scripts/combat/hooks.js`, add `hasSizeService` and register:

```js
Hooks.on("updateActor", (actor, changed, options) => {
  moduleApi.sizeAutomationService.handleActorUpdated(actor, changed, options).catch(logSizeError);
});
Hooks.on("createActiveEffect", (effect, options) => {
  moduleApi.sizeAutomationService.handleActiveEffectChanged(effect, options).catch(logSizeError);
});
Hooks.on("updateActiveEffect", (effect, _changed, options) => {
  moduleApi.sizeAutomationService.handleActiveEffectChanged(effect, options).catch(logSizeError);
});
Hooks.on("deleteActiveEffect", (effect, options) => {
  moduleApi.sizeAutomationService.handleActiveEffectChanged(effect, options).catch(logSizeError);
});
```

Reuse the character sheet render hook list to call `syncActor(app.actor ?? app.document)` for interrupted repairs.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/size-automation-service.test.mjs tests/module-manifest.test.mjs`

Expected: all focused tests pass with one managed effect at most.

- [ ] **Step 6: Commit lifecycle integration**

```powershell
git add -- scripts/combat/size-automation-service.js scripts/combat/hooks.js scripts/main.js tests/size-automation-service.test.mjs tests/module-manifest.test.mjs
git commit -m "feat(combat): synchronize character size modifiers"
```

---

### Task 3: Additive Size and Weapon Reach

**Files:**
- Modify: `scripts/combat/attack-service.js`
- Modify: `tests/combat-attack-service.test.mjs`

**Interfaces:**
- Consumes: `getCharacterSizeRule(actor.system.traits.size)`.
- Produces internally: final melee reach in feet and transient activity range.

- [ ] **Step 1: Write failing reach-composition tests**

Extend the existing activity harness to supply actor size and assert:

```js
test("Large size base reach adds a five-foot Lich weapon bonus", async () => {
  const { service, activity, weapon } = makeReachHarness({
    size: "lg",
    itemReach: 5,
    properties: ["lchReach"],
    reachBonus: 5
  });
  await service.applyDnd5ePreUseActivity(activity, {}, {});
  assert.equal(activity.range.reach, 15);
  assert.equal(weapon.system.range.reach, 5);
});

test("ordinary dnd5e reach is converted from the Medium baseline", async () => {
  const normal = makeReachHarness({ size: "huge", itemReach: 5 });
  const reach = makeReachHarness({ size: "huge", itemReach: 10 });
  await normal.service.applyDnd5ePreUseActivity(normal.activity, {}, {});
  await reach.service.applyDnd5ePreUseActivity(reach.activity, {}, {});
  assert.equal(normal.activity.range.reach, 15);
  assert.equal(reach.activity.range.reach, 20);
});
```

Add table coverage for Tiny through Gargantuan, no mutation for ranged activities, and a stacking case with item + Bugbear + Rune Knight bonuses.

- [ ] **Step 2: Run the reach tests and verify RED**

Run: `node --test --test-name-pattern="reach|Large size|ordinary dnd5e" tests/combat-attack-service.test.mjs`

Expected: FAIL because current code treats the Item's 5 feet as base reach and chooses the maximum bonus instead of composing additions.

- [ ] **Step 3: Implement explicit reach components**

Replace the maximum-only resolver with three helpers:

```js
#resolveWeaponReachBonusFeet(item, options = {}) {
  const explicit = toNumber(options.reachBonusFeet, NaN);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  if (this.#hasItemProperty(item, "lchReach")) {
    return Math.max(0, toNumber(this.#getLichWeaponPropertyValues(item, options).reachBonus, 0));
  }
  const units = cleanText(foundry.utils.getProperty(item, "system.range.units"), "ft");
  const storedFeet = convertUnitsToFeet(toNumber(foundry.utils.getProperty(item, "system.range.reach"), 5), units);
  return Math.max(0, storedFeet - 5);
}

#resolveFinalMeleeReachFeet(item, options = {}) {
  const sizeBase = getCharacterSizeRule(item.actor?.system?.traits?.size).baseReachFeet;
  const weapon = this.#resolveWeaponReachBonusFeet(item, options);
  const racial = Math.max(0, toNumber(item.actor?.getFlag?.(MODULE_ID, "racialReachBonusFeet"), 0));
  const runeKnight = this.#resolveRuneKnightReachBonusFeet(item.actor);
  return Math.max(0, sizeBase + weapon + racial + runeKnight);
}
```

Convert the final feet value into the activity's units and set only `activity.range.reach`. Do not update `item.system.range`.

- [ ] **Step 4: Run focused reach tests and verify GREEN**

Run: `node --test tests/combat-attack-service.test.mjs`

Expected: all attack-service tests pass, including existing Runic Juggernaut assertions updated to the new size baseline.

- [ ] **Step 5: Commit reach composition**

```powershell
git add -- scripts/combat/attack-service.js tests/combat-attack-service.test.mjs
git commit -m "feat(combat): compose melee reach from size and equipment"
```

---

### Task 4: Repair Every Racial Ability Advancement

**Files:**
- Modify: `scripts/data/races-compendium.js`
- Modify: `tests/races-compendium.test.mjs`

**Interfaces:**
- Produces: `buildRaceAdvancement(race)` with at least one `AbilityScoreImprovement` for every race defining changes.
- Produces: `flags.rebreya-main.abilityPenaltyChoice` only for races with a selectable negative ability.
- Consumed later by: `RaceAutomationService.handleCreatedItem`.

- [ ] **Step 1: Add a failing all-race audit**

Load `data/races-teyvankal-v01.json` and assert every current race against an explicit expectation map. Include these irregular rows verbatim:

```js
const irregular = {
  минотавры: { fixed: { con: 2, int: -1 }, choices: [["str", "wis", "cha", 2]] },
  кентавры: { fixed: { wis: 2 }, choices: [["str", "dex", 2]], penalty: { amount: 2, allowed: ["int", "cha"] } },
  леониды: { fixed: {}, choices: [["str", "dex", 2], ["cha", "int", 2]], penalty: { amount: 1, allowed: ["wis", "con"] } },
  полувеликаны: { fixed: { str: 2, dex: -2 }, choices: [["con", "wis", 2]] },
  нефилимы: { fixed: {}, choices: [["int", "cha", 2], ["dex", "str", 1]], penalty: { amount: 2, allowed: ["con", "wis"] } },
  пепельные: { fixed: { cha: 1 }, choices: [["wis", "dex", 2]], penalty: { amount: 2, allowed: ["con", "str"] } },
  големы: { fixed: { con: 2, int: -1 }, choices: [["str", "wis", "cha", 2]] }
};
```

For the remaining races assert the documented point budget and fixed values. Specifically catch Dwarf, High Elf, Halfling, Half-Orc, Wood Elf, Kirisan, Targul, Gnome, Goblin, Goliath, Dragonborn, Ironborn, and Genie, which currently produce no advancement.

Add a regression assertion for `Нечеловеческая сила`: its generated transfer effect must contain exactly one Strength change, with key `system.abilities.str.max`, upgrade mode, and value `22`; it must not contain any `system.abilities.str.value` change.

- [ ] **Step 2: Run the race tests and verify RED**

Run: `node --test --test-name-pattern="ability|Half-Giant|all Teyvankal races" tests/races-compendium.test.mjs`

Expected: FAIL for 17 missing races and incomplete `+2/+1` budgets.

- [ ] **Step 3: Fix Unicode morphology and common distributions**

Replace ASCII `\w` suffixes with Unicode letters and recognize imperative forms:

```js
const increaseRegex = /([а-яa-z,\s]+?)\s+(?:увеличива\p{L}*|увеличьте)\s+на\s+(\d+)/gu;
const decreaseRegex = /([а-яa-z,\s]+?)\s+(?:уменьша\p{L}*|уменьшите)\s+на\s+(\d+)/gu;
```

Normalize the common `+2/+1` wording to a three-point, cap-two advancement when the race allows either distribution, or two advancements when one side is fixed/restricted. Keep `RACE_ABILITY_OVERRIDES` for the seven irregular rows; do not add name-specific heuristics to the parser.

- [ ] **Step 4: Add structured selectable-penalty flags**

Define and normalize:

```js
const RACE_ABILITY_PENALTY_CHOICES = {
  кентавры: { amount: 2, allowed: ["int", "cha"] },
  леониды: { amount: 1, allowed: ["wis", "con"] },
  нефилимы: { amount: 2, allowed: ["con", "wis"] },
  пепельные: { amount: 2, allowed: ["con", "str"] }
};
```

Expose it from `buildRaceFlags` as `abilityPenaltyChoice`, with a cloned `allowed` array. Fixed penalties such as Half-Giant Dexterity -2 remain in the ASI configuration.

- [ ] **Step 5: Run race tests and verify GREEN**

Run: `node --test tests/races-compendium.test.mjs`

Expected: all race compendium tests pass; no race with ability changes has zero ASIs.

- [ ] **Step 6: Commit advancement repair**

```powershell
git add -- scripts/data/races-compendium.js tests/races-compendium.test.mjs
git commit -m "fix(races): generate complete ability advancements"
```

---

### Task 5: Configure Selectable Racial Penalties Reversibly

**Files:**
- Modify: `scripts/combat/race-automation-service.js`
- Modify: `tests/race-automation-service.test.mjs`
- Modify: `scripts/combat/hooks.js`

**Interfaces:**
- Consumes: `item.flags.rebreya-main.abilityPenaltyChoice` from Task 4.
- Produces: `flags.rebreya-main.abilityPenalty = { ability: string, amount: number }` on the owned race Item.
- Produces: one transfer effect flagged `raceAbilityPenalty.managed` on that Item.

- [ ] **Step 1: Write failing owned-race penalty tests**

Add fake race Items with embedded effects and injectable choice handling. Assert:

```js
test("a Centaur choice stores and transfers only the selected penalty", async () => {
  const race = makeOwnedRace({ allowed: ["int", "cha"], amount: 2 });
  const actor = makeOwnedActor([race]);
  const service = new RaceAutomationService({}, { promptChoice: async () => "cha" });

  await service.handleCreatedItem(race, {}, game.user.id);

  assert.deepEqual(race.flags["rebreya-main"].abilityPenalty, { ability: "cha", amount: 2 });
  assert.deepEqual(race.effects.contents[0].changes, [{
    key: "system.abilities.cha.value", mode: 2, value: "-2", priority: 20
  }]);
  assert.equal(race.effects.contents[0].transfer, true);
});
```

Add cancellation/repair, duplicate-effect cleanup, invalid stored ability, actor ownership, and removing the race Item removes the transfer source without a direct actor update.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="penalty|owned race" tests/race-automation-service.test.mjs`

Expected: FAIL because `handleCreatedItem` and configurable prompt injection are absent.

- [ ] **Step 3: Implement one managed penalty effect on the race Item**

Extend the constructor without breaking current callers:

```js
constructor(moduleApi, { promptChoice = null } = {}) {
  this.moduleApi = moduleApi;
  this._promptChoice = promptChoice;
  this._turnDamageKeys = new Set();
  this._pendingItemConfigurations = new Set();
}
```

`handleCreatedItem` must accept only actor-owned `item.type === "race"`, validate the current user/owner route, prompt using localized ability labels, and synchronize an embedded Item effect:

```js
{
  name: "Расовый штраф: Харизма -2",
  transfer: true,
  disabled: false,
  changes: [{ key: "system.abilities.cha.value", mode: EFFECT_MODE_ADD, value: "-2", priority: 20 }],
  flags: { [MODULE_ID]: { raceAbilityPenalty: { managed: true, ability: "cha", amount: 2 } } }
}
```

Closing the dialog leaves the race unresolved. `repairActor(actor)` scans owned race Items and retries unresolved or invalid configurations. Never mutate `actor.system.abilities.*.value` directly.

- [ ] **Step 4: Register create and sheet-repair hooks**

Inside the existing `hasRaceService` block:

```js
Hooks.on("createItem", (item, options, userId) => {
  moduleApi.raceAutomationService.handleCreatedItem(item, options, userId).catch(logRaceConfigError);
});
for (const hookName of CHARACTER_SHEET_RENDER_HOOKS) {
  Hooks.on(hookName, (app) => {
    moduleApi.raceAutomationService.repairActor(app.actor ?? app.document).catch(logRaceConfigError);
  });
}
```

Use one shared character-sheet hook constant in `combat/hooks.js` instead of duplicating the four hook names again.

- [ ] **Step 5: Run focused and hook-source tests**

Run: `node --test tests/race-automation-service.test.mjs tests/module-manifest.test.mjs`

Expected: all focused tests pass and create/sheet hooks are registered once.

- [ ] **Step 6: Commit reversible penalty choices**

```powershell
git add -- scripts/combat/race-automation-service.js scripts/combat/hooks.js tests/race-automation-service.test.mjs tests/module-manifest.test.mjs
git commit -m "feat(races): configure selectable ability penalties"
```

---

### Task 6: Configure One Giant Tribe Feature In Place

**Files:**
- Modify: `data/races-teyvankal-v01.json`
- Modify: `scripts/combat/race-automation-service.js`
- Modify: `tests/race-automation-service.test.mjs`
- Modify: `tests/races-compendium.test.mjs`
- Modify: `docs/races-teyvankal-v01-automation-report.md`

**Interfaces:**
- Consumes: owned feat with automation mechanic `giant-tribe-choice`.
- Produces: `flags.rebreya-main.raceAutomation.giantTribe` with one of `hill|stone|frost|fire|cloud|storm`.
- Produces: `buildGiantTribeConfiguration(tribe)` for deterministic name/effect/activity data.
- Consumes at runtime: activity action `chooseGiantTribe`.

- [ ] **Step 1: Add failing tribe data and service tests**

Assert the source feature has no dormant all-tribe effects and has one selection runtime. Add one test per configuration:

```js
const expectedChanges = {
  hill: [["system.skills.sur.roll.mode", "1"]],
  stone: [],
  frost: [["system.traits.dr.value", "cold"]],
  fire: [["system.tools.smith.value", "1"]],
  cloud: [
    ["system.skills.dec.bonuses.check", "2"],
    ["system.skills.per.bonuses.check", "2"]
  ],
  storm: []
};

for (const [tribe, changes] of Object.entries(expectedChanges)) {
  test(`${tribe} giant tribe builds only its owned configuration`, () => {
    const config = buildGiantTribeConfiguration(tribe);
    assert.deepEqual(config.effects.flatMap((effect) => effect.changes).map(({ key, value }) => [key, value]), changes);
  });
}
```

For Storm assert exactly one damage activity with `1d4`, `lightning`, and one creature target. For all tribes assert the `Выбрать племя` utility remains available.

- [ ] **Step 2: Run tribe tests and verify RED**

Run: `node --test --test-name-pattern="giant tribe|Великанье племя|storm" tests/race-automation-service.test.mjs tests/races-compendium.test.mjs`

Expected: FAIL because the source contains four dormant effects and generic `promptCustomEffect` instead of tribe configuration.

- [ ] **Step 3: Replace generic source automation**

Update the JSON feature to:

```json
{
  "effects": [],
  "activities": [{
    "type": "utility",
    "name": "Выбрать племя",
    "activation": "special",
    "appliedEffects": [],
    "runtime": {
      "action": "chooseGiantTribe",
      "mechanic": "interactive-runtime",
      "title": "Великанье племя",
      "prompt": "Выберите племя великана. Предыдущий выбор и его эффекты будут заменены."
    }
  }],
  "mechanics": ["giant-tribe-choice", "interactive-runtime"]
}
```

Mark overall coverage `partial` because Stone is descriptive and Storm remains player-triggered. Update the report to match.

- [ ] **Step 4: Implement tribe configuration and reconfiguration**

Export stable tribe definitions with localized suffixes. Build only these managed transfer effects:

```js
hill: [{ key: "system.skills.sur.roll.mode", mode: EFFECT_MODE_UPGRADE, value: "1", priority: 20 }]
frost: [{ key: "system.traits.dr.value", mode: EFFECT_MODE_ADD, value: "cold", priority: 20 }]
fire: [{ key: "system.tools.smith.value", mode: EFFECT_MODE_UPGRADE, value: "1", priority: 20 }]
cloud: [
  { key: "system.skills.dec.bonuses.check", mode: EFFECT_MODE_ADD, value: "2", priority: 20 },
  { key: "system.skills.per.bonuses.check", mode: EFFECT_MODE_ADD, value: "2", priority: 20 }
]
```

`configureGiantTribe(item)` must prompt once, revalidate the selected stable value, remove only effects flagged `giantTribe.managed`, replace only managed tribe activities, update the same Item name and flag, and leave its identifier unchanged. `handleCreatedItem` invokes it for newly granted tribe feats; `repairActor` retries unconfigured copies. `applyDnd5ePostUseActivity` handles `chooseGiantTribe` and deliberately opens reconfiguration.

Store Storm in `data/races-teyvankal-v01.json` using the existing `createAutomationActivity` input schema:

```json
{
  "type": "damage",
  "name": "Штормовой великан: касание",
  "activation": "special",
  "condition": "Прямой контакт с целью",
  "range": null,
  "rangeUnits": "touch",
  "targetType": "creature",
  "targetCount": "1",
  "damage": { "formula": "1d4", "types": ["lightning"] }
}
```

After `createAutomationActivity` converts that source record, the generated dnd5e activity must contain:

```js
{
  type: "damage",
  name: "Штормовой великан: касание",
  activation: { type: "special", value: null, condition: "Прямой контакт с целью" },
  damage: { parts: [{ number: 1, denomination: 4, types: ["lightning"], custom: { enabled: false, formula: "" } }] },
  target: { affects: { type: "creature", count: "1", choice: false, special: "" }, template: { units: "ft", type: "" } },
  range: { units: "touch", value: null, special: "" }
}
```

Use `createAutomationActivity` for this conversion; do not write the generated `system.activities` schema directly into the source JSON.

- [ ] **Step 5: Run tribe and race tests and verify GREEN**

Run: `node --test tests/race-automation-service.test.mjs tests/races-compendium.test.mjs`

Expected: all tests pass; only one tribe's passive effect exists and Storm targets one creature.

- [ ] **Step 6: Commit giant tribe automation**

```powershell
git add -- data/races-teyvankal-v01.json scripts/combat/race-automation-service.js tests/race-automation-service.test.mjs tests/races-compendium.test.mjs docs/races-teyvankal-v01-automation-report.md
git commit -m "feat(races): automate half-giant tribe selection"
```

---

### Task 7: Full Verification, Live Foundry Validation, and Delivery

**Files:**
- Verify all modified files from Tasks 1-6.
- Modify only tests or implementation directly required by a reproduced failure.

**Interfaces:**
- Consumes: complete implementation from Tasks 1-6.
- Produces: synchronized compendia, live evidence, clean diff, final commits, and pushed `origin/lich_branch`.

- [ ] **Step 1: Run syntax and focused suites**

```powershell
node --check scripts/combat/size-automation-service.js
node --check scripts/combat/attack-service.js
node --check scripts/combat/race-automation-service.js
node --check scripts/data/races-compendium.js
node --test tests/size-automation-service.test.mjs tests/combat-attack-service.test.mjs tests/races-compendium.test.mjs tests/race-automation-service.test.mjs tests/module-manifest.test.mjs
```

Expected: zero syntax errors and zero focused test failures.

- [ ] **Step 2: Run the complete suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests pass with zero failures. Record the exact pass count.

- [ ] **Step 3: Inspect generated data and diff**

```powershell
git diff --check
git status --short --branch
git diff origin/lich_branch...HEAD -- scripts/combat/size-automation-service.js scripts/combat/attack-service.js scripts/combat/race-automation-service.js scripts/data/races-compendium.js data/races-teyvankal-v01.json
```

Expected: no whitespace errors, no unrelated files, and no direct current-Strength mutation.

- [ ] **Step 4: Reload Foundry and synchronize race compendia**

Open `https://vtt.rebreya.com/` with the provided Codex profile, enter the world as an authorized GM, reload the module, and confirm `RacesCompendiumService.sync()` completes without console errors. Verify the generated `Полувеликаны` race and `Великанье племя` feature in `world.rebreya-races` and `world.rebreya-race-features`.

- [ ] **Step 5: Validate actor `Actor.1Z9T8jbHwoAOTyTy`**

On the designated test actor:

1. Record current race, size, abilities, effects, and reach weapons.
2. Remove/re-add the Half-Giant race if required to rerun advancements.
3. Confirm Strength +2, Constitution-or-Wisdom +2, and Dexterity -2 in the advancement flow.
4. Confirm Large size and visible managed changes: AC -1, Strength checks +1, Dexterity checks -1.
5. Choose Hill, Frost, Fire, Cloud, Stone, and Storm in turn; verify only the selected passive remains.
6. For Storm, select one target and press the damage activity; confirm `1d4` lightning reaches chat for that target.
7. Attack with a normal weapon and `Алебарда`; confirm transient reach 10 and 15 feet for Large while Item data remains unchanged.
8. Temporarily change size to Huge and back; confirm modifiers and base reach update and restore.

- [ ] **Step 6: Re-run tests after live fixes**

If live validation required a code change, first add a focused regression test, observe it fail, apply the minimal fix, then rerun:

```powershell
node --test tests/size-automation-service.test.mjs tests/combat-attack-service.test.mjs tests/races-compendium.test.mjs tests/race-automation-service.test.mjs
node --test tests/*.test.mjs
git diff --check
```

- [ ] **Step 7: Commit any final regression-only changes**

```powershell
git add -- scripts/combat/size-automation-service.js scripts/combat/attack-service.js scripts/combat/race-automation-service.js scripts/data/races-compendium.js data/races-teyvankal-v01.json scripts/combat/hooks.js scripts/main.js tests/size-automation-service.test.mjs tests/combat-attack-service.test.mjs tests/races-compendium.test.mjs tests/race-automation-service.test.mjs tests/module-manifest.test.mjs docs/races-teyvankal-v01-automation-report.md
git commit -m "fix(races): harden live half-giant automation"
```

Skip this commit when live validation required no changes.

- [ ] **Step 8: Push without force**

```powershell
git status --short --branch
git push origin lich_branch
```

Expected: push succeeds as a fast-forward update and the working tree is clean.
