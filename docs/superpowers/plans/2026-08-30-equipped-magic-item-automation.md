# Equipped Magic Item Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish supported magic-item effects and activities to `world.rebreya-magic-items`, provide an idempotent GM console command that patches already equipped/attuned character Items, and apply the Dual-Wielding Gloves bonus from live Rebreya hand state.

**Architecture:** Extend `scripts/data/magic-items-compendium.js` as the sole automation-definition and compendium-projection owner. Put detached identity and managed-merge helpers in `scripts/data/magic-item-embedded-sync.js`, but keep orchestration in `MagicItemsCompendiumService`; extend the existing held-items predicate and `CombatAttackService` damage hook instead of adding another hook. `RebreyaMainModule` exposes one delegate to the service.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, native dnd5e activities and Active Effects, Node.js test runner, ES modules.

**Spec:** `docs/superpowers/specs/2026-08-30-equipped-magic-item-automation-design.md`

## Global Constraints

- Work only on `lich_branch`; before implementation run the full Git preflight from `AGENTS.md`, stop for foreign changes, remote `lich_branch` ahead, or conflicting `origin/main` changes, and never force-push.
- Read only the magic-items and held-hands sections of `docs/function-passport.md`; update those sections in the same implementation commit when methods or data flow change.
- `scripts/main.js` remains the only composition root; do not add a second app, lifecycle, global repair hook, socket route, or world-setting mutation.
- Scan all and only world Actor documents with `type === "character"`; patch only Items with `system.equipped === true` or `system.attuned === true`.
- Preserve embedded runtime and user state. Replace only automation documents marked by `flags.rebreya-main.magicItemAutomation === true` and managed automation/identity flags proven by exact identity resolution.
- Never mutate `Особый Кинжал телепортации`, `Зелье заживления ран`, or `Зелье лечения 1-го уровня` in this iteration. Report them as `deferred`.
- Leave dnd5e responsible for cached spell creation/deletion. The migration only writes native cast activities.
- Do not edit generated `magicItem.js` manually.
- Any client-delivered implementation change requires version `1.4.181`, `scripts/main-1.4.181.js`, and `module.json.esmodules = ["scripts/main-1.4.181.js"]`.
- Add only task-owned paths with `git add -- <paths>`; never use `git add -A`.

---

### Task 1: Canonical passive automation projection

**Files:**
- Modify: `tests/magic-items-compendium.test.mjs:209-287`
- Modify: `scripts/data/magic-items-compendium.js:24-327`
- Modify: `scripts/data/magic-items-compendium.js:516-555`

**Interfaces:**
- Consumes: normalized catalog rows returned by `normalizeMagicItems()`.
- Produces: a versioned automation definition in `flags.rebreya-main.magicItemAutomation`, stable managed effects, and a signature that changes whenever the automation projection changes.

- [ ] **Step 1: Write failing table-driven passive-effect tests**

Add cases that call `createMagicItemData()` and compare normalized `changes` exactly:

```js
const passiveCases = [
  ["амулет-благочестия-1", [
    ["system.bonuses.msak.attack", 2, "+1"],
    ["system.bonuses.rsak.attack", 2, "+1"],
    ["system.bonuses.spell.dc", 2, "+1"]
  ]],
  ["барабан-задающего-ритм-1", [
    ["system.bonuses.msak.attack", 2, "+1"],
    ["system.bonuses.rsak.attack", 2, "+1"],
    ["system.bonuses.spell.dc", 2, "+1"]
  ]],
  ["лунный-серп-1", [
    ["system.bonuses.msak.attack", 2, "+1"],
    ["system.bonuses.rsak.attack", 2, "+1"],
    ["system.bonuses.spell.dc", 2, "+1"]
  ]],
  ["универсальный-инструмент-1", [
    ["system.bonuses.msak.attack", 2, "+1"],
    ["system.bonuses.rsak.attack", 2, "+1"],
    ["system.bonuses.spell.dc", 2, "+1"]
  ]],
  ["обруч-заклинателя-2", [["system.skills.arc.bonuses.check", 2, "+2"]]],
  ["пояс-атлета-1", [["system.skills.ath.bonuses.check", 2, "+1"]]],
  ["камень-удачи", [
    ["system.bonuses.abilities.check", 2, "+1"],
    ["system.bonuses.abilities.save", 2, "+1"]
  ]],
  ["пояс-силы-холмового-великана", [
    ["system.abilities.str.value", 2, "+3"],
    ["system.abilities.str.max", 4, "21"]
  ]]
];
```

Also assert that `очки-орлиного-зрения` contains only the supported Perception advantage change, `ночные-очки` uses mode `2` with value `+60`, existing Rebreya `плащ-защиты-1` remains saves-only, and all produced effects have stable 16-character IDs plus `flags.rebreya-main.magicItemAutomation === true`.

- [ ] **Step 2: Write failing exclusions and regression tests**

Assert that `перчатки-двуручного-боя` has no damage Active Effect; `лунный-серп-1` has no generic `system.bonuses.healing` effect; manual-choice Items have no guessed choice effect; the three deferred Items have no new projection; and a second `createMagicItemData()` call produces byte-equivalent effect IDs and signature data.

- [ ] **Step 3: Run the focused test and verify failure**

Run: `node --test tests/magic-items-compendium.test.mjs`

Expected: FAIL on the newly asserted effect matrix and additive darkvision behavior.

- [ ] **Step 4: Implement the minimal passive projection**

In `magic-items-compendium.js`, add a projection version and exact-ID definitions rather than fuzzy name checks:

```js
const MAGIC_ITEM_AUTOMATION_VERSION = 1;
```

Extend `resolveMagicItemAutomationDefinition(item)` to return `{ version, coverage, effects, activities, sharedUses, note }` for exact `item.id` values. Keep existing bag, pearl, watcher-shield, and characteristic-ring behavior compatible. Build effects with `buildPassiveMagicItemEffect()`, use `buildMagicItemEffectId(item, suffix)`, and include the complete definition/effect projection under a versioned key in `buildMagicSignature()`.

For `очки-орлиного-зрения`, use only `flags.midi-qol.advantage.skill.prc`. For Lunar Sickle, document the holding/class/healing limitation in the automation definition and do not use `system.bonuses.healing`, because dnd5e applies that field to healing Items generally rather than only spell healing.

- [ ] **Step 5: Run the focused test and commit**

Run: `node --test tests/magic-items-compendium.test.mjs`

Expected: all tests pass.

Commit:

```powershell
git add -- scripts/data/magic-items-compendium.js tests/magic-items-compendium.test.mjs
git commit -m "feat: project passive magic item automation"
```

---

### Task 2: Native spell and utility activities

**Files:**
- Modify: `tests/magic-items-compendium.test.mjs:289-410`
- Modify: `scripts/data/magic-items-compendium.js:78-153`
- Modify: `scripts/data/magic-items-compendium.js:520-725`

**Interfaces:**
- Consumes: the exact-ID automation definitions from Task 1.
- Produces: `buildMagicItemActivities(item)` returning either `null` or an object keyed by stable activity ID; shared charge-bearing Items expose native `system.uses` consumed through `itemUses`.

- [ ] **Step 1: Write failing spell-activity tests**

Generalize the existing instrument test so the following exact UUID and cost matrix is asserted:

```js
const spellCases = [
  ["печатка-гильдии-ракдоса", "Hellish Rebuke", "Compendium.dnd5e.spells24.Item.phbsplHellishReb", "1"],
  ["ушной-червь", "Detect Thoughts", "Compendium.dnd5e.spells24.Item.phbsplDetectThou", "2"],
  ["ушной-червь", "Dissonant Whispers", "Compendium.dnd5e.spells24.Item.phbsplDissonantW", "1"]
];
```

Assert `type: "cast"`, `consumption.spellSlot: false`, `spell.spellbook: true`, stable `_id`, and `itemUses` consumption with exact cost. Assert the signet owns `{ spent: 0, max: "3", recovery: [{ period: "dawn", type: "formula", formula: "1d3" }] }`, while Earworm owns the corresponding `max: "4"` and `1d4` recovery. Assert fixed save DC 15 is represented by the native activity challenge override supported by dnd5e 5.2.5.

- [ ] **Step 2: Write failing utility/save activity tests**

Add exact rows for:

```js
const utilityCases = [
  ["кинжал-яда", "Покрыть клинок ядом", "action", "1"],
  ["механистический-амулет", "Принять 10 на броске атаки", "special", "1"],
  ["таранный-щит", "Усиленный толчок", "special", "1"],
  ["развевающийся-плащ", "Драматично развеять плащ", "bonus", null],
  ["трубка-дымных-чудовищ", "Выдохнуть дымное существо", "action", null],
  ["фонарь-обнаружения", "Открыть фонарь", "action", null],
  ["фонарь-обнаружения", "Опустить козырёк", "action", null],
  ["универсальный-инструмент-1", "Изменить форму инструмента", "action", null],
  ["универсальный-инструмент-1", "Выбрать заговор", "action", "1"],
  ["амулет-благочестия-1", "Божественный канал без расхода", "special", "1"],
  ["барабан-задающего-ритм-1", "Восстановить Бардовское вдохновение", "action", "1"]
];
```

Assert the Poison Dagger follow-up save activity has Con DC 15, `2d10` poison, and poisoned-for-one-minute rule text; narrative activities contain chat flavor and do not claim token/light/attack-roll mutation. Assert Task 1 deferred Items still receive no activities.

- [ ] **Step 3: Run the focused test and verify failure**

Run: `node --test tests/magic-items-compendium.test.mjs`

Expected: FAIL because only the three legacy instrument builders exist.

- [ ] **Step 4: Generalize the activity builder**

Rename the private instrument-only builder to `buildMagicItemActivities(item)`. Keep the existing instrument matrix unchanged, and add helpers with exact native shapes:

```js
function itemUseConsumptionTarget(value = "1") {
  return {
    type: "itemUses",
    target: "",
    value,
    scaling: { mode: "", formula: "" }
  };
}

function buildFormulaRecovery(max, formula) {
  return {
    spent: 0,
    max: String(max),
    recovery: [{ period: "dawn", type: "formula", formula }]
  };
}
```

Mark every generated activity with `flags.rebreya-main.magicItemAutomation: true`; use `stableHashId("magic-item:<id>:activity:<key>", "magic-item-activity")`. Attach activities and shared `system.uses` only in `createMagicItemData()`, and serialize both under `MAGIC_ITEM_AUTOMATION_VERSION` in `buildMagicSignature()`.

- [ ] **Step 5: Run the focused test and commit**

Run: `node --test tests/magic-items-compendium.test.mjs`

Expected: all tests pass, including unchanged native instrument assertions.

Commit:

```powershell
git add -- scripts/data/magic-items-compendium.js tests/magic-items-compendium.test.mjs
git commit -m "feat: add native magic item activities"
```

---

### Task 3: Pure identity resolution and managed embedded merge

**Files:**
- Create: `scripts/data/magic-item-embedded-sync.js`
- Create: `tests/magic-item-equipped-sync.test.mjs`

**Interfaces:**
- Produces: `buildMagicItemIdentityIndex(catalogRows, packRows)`, `resolveEmbeddedMagicItemIdentity(item, index)`, `buildMagicItemAutomationProjection(packItem)`, and `buildEmbeddedMagicItemPatch(item, projection, resolution)`.
- Return contracts:

```js
// resolveEmbeddedMagicItemIdentity
{ status: "resolved", magicItemId, reason, identityPatch }
{ status: "native", reason }
{ status: "deferred", reason }
{ status: "unresolved", reason, evidence }

// buildEmbeddedMagicItemPatch
{ status: "updated", update }
{ status: "unchanged" }
{ status: "unresolved", reason: "automation-conflict" }
```

- [ ] **Step 1: Write failing identity-resolution tests**

Cover stable `magicItemId`, exact compendium source UUID, exact canonical name, registered alias `Goggles of Night`, exact weapon/armor `+N` patterns with matching type and native magical bonus, and refusal on conflicting evidence. Assert embedded suffixes `(Сила)` and `(Ловкость)` resolve the corresponding Ouroboros choice while an unsuffixed choice is reported through `unresolvedChoices`; Living Gloves preserve an existing selected custom effect rather than guessing one. Treat an external official `Плащ защиты` as `native`, never as Rebreya `плащ-защиты-1`.

Add the Cassidy regression fixture where `Кольцо характеристики +1 (Сила)` carries `magicItemId: механистический-амулет`; assert only that exact name/evidence tuple resolves to `уроборос` with Strength choice, while an arbitrary renamed amulet remains unresolved.

Resolve the three skipped world cards before catalog evidence, because they are not three canonical rows in `magicItem.js`. Use exact normalized embedded names only:

```js
const DEFERRED_EMBEDDED_ITEM_NAMES = new Set([
  "особый кинжал телепортации",
  "зелье заживления ран",
  "зелье лечения 1-го уровня"
]);
```

Add explicit expectations for all three skipped Items:

```js
assert.deepEqual(resolveEmbeddedMagicItemIdentity(potion, index), {
  status: "deferred",
  reason: "deferred-current-iteration"
});
```

- [ ] **Step 2: Write failing merge tests**

Create detached fixtures with managed and custom effects/activities. Assert the patch preserves `_id`, name, img, quantity, equipped, attuned, item-level `uses.spent`, matching activity `uses.spent`, container, durability, upgrades, held-hands, unrelated flags, and all unmanaged effect/activity documents. Assert stable managed IDs are replaced once, mechanically equivalent third-party automation suppresses a duplicate, display-name-only equivalence does not, and a conflicting third-party mechanic returns `automation-conflict` without an update.

- [ ] **Step 3: Run the new focused test and verify failure**

Run: `node --test tests/magic-item-equipped-sync.test.mjs`

Expected: FAIL because `scripts/data/magic-item-embedded-sync.js` does not exist.

- [ ] **Step 4: Implement the pure helper module**

Use plain-object accessors and deterministic serialization; do not read `game`, mutate documents, or call Foundry APIs. Mechanical signatures must be exact:

```js
function buildEffectMechanicalSignature(effect) {
  const changes = Array.isArray(effect?.changes) ? effect.changes : [];
  return JSON.stringify(changes
    .map(({ key, mode, value, priority }) => ({ key, mode, value: String(value), priority }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function buildActivityMechanicalSignature(activity) {
  return JSON.stringify({
    type: activity?.type ?? "",
    spellUuid: activity?.spell?.uuid ?? "",
    consumption: activity?.consumption ?? null,
    uses: activity?.uses ?? null
  });
}
```

Treat only `flags.rebreya-main.magicItemAutomation === true` as replaceable managed children. Preserve `spent` after matching by stable `_id`. Return Foundry-compatible flattened update data rooted at `_id`, `effects`, `system.activities`, and exact managed flag paths; do not copy the complete compendium Item.

- [ ] **Step 5: Run the focused test and commit**

Run: `node --test tests/magic-item-equipped-sync.test.mjs`

Expected: all pure identity and merge tests pass.

Commit:

```powershell
git add -- scripts/data/magic-item-embedded-sync.js tests/magic-item-equipped-sync.test.mjs
git commit -m "feat: merge managed magic item automation"
```

---

### Task 4: GM command orchestration in the existing compendium service

**Files:**
- Modify: `scripts/data/magic-items-compendium.js:812-880`
- Modify: `tests/magic-item-equipped-sync.test.mjs`

**Interfaces:**
- Consumes: Task 3 helpers and the existing `MagicItemsCompendiumService.sync()`.
- Produces: `MagicItemsCompendiumService.syncEquippedMagicItems({ dryRun = false } = {}) -> Promise<MagicItemSyncReport>`.

- [ ] **Step 1: Write failing service guard and ordering tests**

Instantiate the service with injectable providers while preserving zero-argument production construction:

```js
new MagicItemsCompendiumService({
  gameProvider: () => gameFixture,
  consoleProvider: () => consoleFixture,
  isActiveGm: () => true
});
```

Assert non-dnd5e and non-active-GM calls return a reason-coded report without writes. Assert `sync()` completes before the first Actor is inspected and a thrown compendium-sync error rejects before any `updateEmbeddedDocuments()` call.

- [ ] **Step 2: Write failing scan, dry-run, batching, and retry tests**

Use character, npc, group, equipped, attuned-only, and inactive Item fixtures. Assert all world characters are scanned, excluded Actor/Items are reported, `dryRun` performs zero writes, apply performs at most one `actor.updateEmbeddedDocuments("Item", updates)` per Actor, a failed Actor adds one error and later Actors continue, and the second apply produces `updated.length === 0`.

Assert the returned object has exactly:

```js
{
  dryRun,
  actorsScanned,
  itemsScanned,
  updated,
  unchanged,
  unresolved,
  unresolvedChoices,
  skipped,
  errors
}
```

Rows must be detached and contain `actorId`, `actorName`, `itemId`, `itemName`, and `reason`. Assert `console.table()` receives compact summary rows. The three deferred Items must be in `skipped` and absent from every Actor update payload.

- [ ] **Step 3: Run the service-focused test and verify failure**

Run: `node --test tests/magic-item-equipped-sync.test.mjs`

Expected: FAIL because `syncEquippedMagicItems()` is absent.

- [ ] **Step 4: Implement orchestration without another lifecycle**

Add constructor providers, preserving production defaults from `globalThis`. Implement the exact order: validate active GM/dnd5e, `await this.sync()`, read the current pack documents, build detached projections/index, iterate `game.actors.contents` sequentially, build one updates array per character, skip write in dry-run, catch Actor batch failures, call `console.table()`, and return the report.

Do not call `game.settings`, create a hook, create a socket route, or write cached Spell Items.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/magic-item-equipped-sync.test.mjs tests/magic-items-compendium.test.mjs`

Expected: all tests pass.

Commit:

```powershell
git add -- scripts/data/magic-items-compendium.js scripts/data/magic-item-embedded-sync.js tests/magic-item-equipped-sync.test.mjs tests/magic-items-compendium.test.mjs
git commit -m "feat: sync equipped magic item automation"
```

---

### Task 5: Dual-Wielding Gloves from canonical Rebreya hands

**Files:**
- Modify: `scripts/integrations/held-items.js:420-755`
- Modify: `tests/held-items.test.mjs`
- Modify: `scripts/combat/attack-service.js:1-20`
- Modify: `scripts/combat/attack-service.js:659-670`
- Modify: `scripts/combat/attack-service.js:3878-3950`
- Modify: `scripts/main.js:235-246`
- Modify: `tests/combat-attack-service.test.mjs:1194-1250`

**Interfaces:**
- Produces: `hasDistinctHeldItemsInDifferentHands(actor, currentItem, { predicate }) -> boolean` in `held-items.js`.
- Consumes: `getActorHandSlots(actor)`, `getActorHandReservations(actor)`, `getItemHeldHands(item)`, and the attack service's existing `isMeleeWeaponItem()`/equipped checks.

- [ ] **Step 1: Write failing held-hand predicate tests**

Cover two different equipped items in `left`/`right`, a valid `hand3` extra-hand pairing, one two-handed Item occupying both hands, two malformed documents claiming one slot, a reservation occupying one candidate slot, current Item not in the pair, and unequipped/unheld candidates. Pass an explicit predicate so the integration helper does not acquire combat weapon-type knowledge:

```js
const qualifies = hasDistinctHeldItemsInDifferentHands(actor, sword, {
  predicate: (item) => item.type === "weapon" && item.system?.equipped === true
});
```

- [ ] **Step 2: Run the held-items test and verify failure**

Run: `node --test tests/held-items.test.mjs`

Expected: FAIL because the predicate is not exported.

- [ ] **Step 3: Implement the pure held-hand predicate**

Validate slots against `getActorHandSlots(actor)`, exclude every reserved slot returned by `getActorHandReservations(actor)`, require two different Item IDs, require two different slots, and require `currentItem` to be one of the qualifying documents. A single document in two slots must never satisfy the predicate.

- [ ] **Step 4: Write failing damage-roll tests**

Build an actor with equipped gloves carrying exact `flags.rebreya-main.magicItemId: "перчатки-двуручного-боя"` and two held melee weapons. Call `applyDnd5eDamageRollConfig()` and assert the base roll receives exactly one `+2` part. Repeat with multiple damage parts, extra hands, missing/unequipped gloves, ranged/current natural/unheld weapon, one two-handed weapon, and a released/reserved hand. Also assert no second `+2` is appended when an equivalent managed part is already present.

- [ ] **Step 5: Extend the existing damage hook and run tests**

Import the new predicate through `../integrations/held-items.js?v=1.4.181-dual-wield-gloves`, and change the composition-root import to `./combat/attack-service.js?v=1.4.181-dual-wield-gloves`. In `applyDnd5eDamageRollConfig()`, compute:

```js
const dualWieldGlovesBonus = this.#hasDualWieldGlovesDamageBonus(item) ? "+2" : null;
```

Do not keep the existing early return based only on `mu/mku/rku`; include `dualWieldGlovesBonus` in that guard. Append `+2` once to the base roll's `parts`, not once per damage part and not to attack rolls. Re-evaluate on every call so held-hand changes take effect immediately.

Run: `node --test tests/held-items.test.mjs tests/combat-attack-service.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit the conditional runtime behavior**

```powershell
git add -- scripts/integrations/held-items.js scripts/combat/attack-service.js scripts/main.js tests/held-items.test.mjs tests/combat-attack-service.test.mjs
git commit -m "feat: apply dual-wield gloves from held hands"
```

---

### Task 6: Public console API, documentation, passport, and release bump

**Files:**
- Modify: `scripts/main.js:1310-1325`
- Modify: `scripts/main.js:6615-6635`
- Modify: `tests/main-composition-root.test.mjs:258-345`
- Modify: `README.md:265-315`
- Modify: `docs/function-passport.md:282-306`
- Modify: `tests/module-manifest.test.mjs:61-72`
- Modify: `module.json`
- Create: `scripts/main-1.4.181.js`

**Interfaces:**
- Produces: `RebreyaMainModule.syncEquippedMagicItems(options = {})` exposed through both `game.rebreyaMain` and `game.modules.get("rebreya-main")?.api`.
- Delegates directly to: `this.magicItemsCompendium.syncEquippedMagicItems(options)`.

- [ ] **Step 1: Write failing composition and manifest tests**

Assert `scripts/main.js` contains exactly one public delegate:

```js
async syncEquippedMagicItems(options = {}) {
  return this.magicItemsCompendium.syncEquippedMagicItems(options);
}
```

Change the manifest assertion to version `1.4.181` and `scripts/main-1.4.181.js`; assert that forwarder contains exactly `import "./main.js";\n`. Update the released combat cache-bust assertion to require `attack-service.js?v=1.4.181-dual-wield-gloves` and the attack-service source assertion to require `held-items.js?v=1.4.181-dual-wield-gloves`.

- [ ] **Step 2: Run the focused composition tests and verify failure**

Run: `node --test tests/main-composition-root.test.mjs tests/module-manifest.test.mjs`

Expected: FAIL on the absent delegate and old release version.

- [ ] **Step 3: Add the delegate and operator documentation**

Add the thin method to `RebreyaMainModule`. In `README.md` under the public API section, document both exact console calls:

```js
await game.rebreyaMain.syncEquippedMagicItems({ dryRun: true });
await game.rebreyaMain.syncEquippedMagicItems();
```

State that the command is active-GM-only, scans every world character, mutates only equipped/attuned Items, should be previewed first, preserves custom automation/runtime uses, and deliberately skips both potions plus the special teleportation dagger in this release.

- [ ] **Step 4: Update the function passport**

In the magic-items section, record `buildMagicItemActivities()`, the versioned automation projection, `MagicItemsCompendiumService.syncEquippedMagicItems()`, the four pure embedded-sync exports, the report/data flow, active-GM/dnd5e guards, deferred Items, and focused tests. In the held-hands section, add `hasDistinctHeldItemsInDifferentHands()` and the flow to `CombatAttackService.applyDnd5eDamageRollConfig()`.

- [ ] **Step 5: Bump the client version**

Set `module.json.version` to `1.4.181`, set `esmodules` to `scripts/main-1.4.181.js`, and create the forwarder containing only:

```js
import "./main.js";
```

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/main-composition-root.test.mjs tests/module-manifest.test.mjs tests/magic-items-compendium.test.mjs tests/magic-item-equipped-sync.test.mjs tests/held-items.test.mjs tests/combat-attack-service.test.mjs`

Expected: all focused tests pass.

Commit:

```powershell
git add -- scripts/main.js scripts/main-1.4.181.js module.json README.md docs/function-passport.md tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
git commit -m "feat: expose equipped magic item sync"
```

---

### Task 7: Full verification, live dry-run, apply, and push

**Files:**
- Verify only; modify task-owned files only if a real failure requires correction.

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: verified `lich_branch` commits and a safe operator result from the real Foundry world.

- [ ] **Step 1: Run the complete repository verification once**

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: zero failed tests, zero syntax failures, zero invalid JSON files, and no whitespace errors.

- [ ] **Step 2: Review the release diff**

Run:

```powershell
git status --short --branch
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- scripts/data/magic-items-compendium.js scripts/data/magic-item-embedded-sync.js scripts/integrations/held-items.js scripts/combat/attack-service.js scripts/main.js module.json README.md docs/function-passport.md
```

Confirm there is no second owner/hook, no `magicItem.js` edit, no potion/special-dagger mutation path, and no unmanaged child deletion.

- [ ] **Step 3: Push implementation commits**

```powershell
git push -u origin lich_branch
```

Expected: normal fast-forward push without force.

- [ ] **Step 4: Run the real-world dry-run after Foundry reloads version 1.4.181**

In the GM browser console run:

```js
const preview = await game.rebreyaMain.syncEquippedMagicItems({ dryRun: true });
preview;
```

Confirm zero writes, no global error, all three deferred Items have `reason: "deferred-current-iteration"`, and conflicts/unresolved choices are visible rather than silently updated.

- [ ] **Step 5: Apply once and prove idempotence**

After reviewing `preview`, run:

```js
const applied = await game.rebreyaMain.syncEquippedMagicItems();
const repeated = await game.rebreyaMain.syncEquippedMagicItems();
({ applied, repeated });
```

Confirm the first run updates only resolved equipped/attuned character Items, the second run has `updated.length === 0`, custom automation and charge expenditure remain intact, and the deferred potion/dagger documents are unchanged.
