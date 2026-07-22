# Craftsman V0.1 Constructor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать Конструктора 3-го уровня через одну нативную Summon Activity, одного масштабируемого Конструкта, два независимых выбора и существующую механику объектов карты.

**Architecture:** Один управляемый Actor-шаблон публикуется в Actor compendium и вызывается штатным `SummonActivity` dnd5e как unlinked Token с synthetic Actor. `CraftsmanConstructorService` ограничивает сборку продолжительным отдыхом, применяет Сборку тела и Боевой режим после размещения, переносит экземпляр между сценами и управляет его жизненным циклом. Отключение расширяет `MapObjectTokenService` узкими операциями над существующим Token, сохраняя инвентарь и изображение.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, ES modules, `node:test`, native Summon Activity/hooks, DialogV2, Active Effects, existing reaction/status/object services, built-in image generation.

## Global Constraints

- Рабочая ветка: только `lich_branch`; перед каждым циклом правок проверять `git status`, текущую ветку и `git fetch origin`.
- Никаких составных Actor-шаблонов «Сборка тела × Боевой режим» и никаких миграций старых персонажей.
- Summon Activity содержит ровно один профиль и один канонический Actor UUID.
- «Сборка тела» и «Боевой режим» выбираются независимо после штатного размещения токена.
- Видимый текст feature Items и действий переносится дословно из `data/craftsman-v01.json`.
- В текущую работу входят только способности Конструктора 3-го уровня; уровни 6, 10 и 15 остаются текстовыми Items.
- Сборка доступна после продолжительного отдыха; перенос существующего Конструкта между сценами не является новой сборкой.
- Токен генерируется без текста и водяных знаков и хранится внутри модуля как WebP с прозрачностью.
- Не добавлять новые внешние runtime-зависимости.

---

## File Structure

- `scripts/data/map-object-token-service.js` — общие builders ActorDelta и безопасное преобразование существующего Token в объект без потери инвентаря.
- `scripts/data/craftsman-construct-compendium.js` — stable Actor pack/UUID, точный NPC builder и GM-синхронизация технического world Actor.
- `scripts/data/craftsman-construct-definitions.js` — стабильные IDs Сборок тела/Боевых режимов и builder одной Summon Activity.
- `scripts/data/classes-compendium.js` — подключение Summon Activity к `construct-assembly` без изменения текста.
- `scripts/combat/craftsman-constructor-service.js` — разрешение отдыха, native summon hooks, два выбора, механика 3-го уровня, перенос, масштабирование и lifecycle.
- `scripts/integrations/craftsman-constructor-hooks.js` — изолированная idempotent-регистрация hooks.
- `scripts/integrations/craftsman-rest-orchestrator.js` — единственная последовательная цепочка продолжительного отдыха после выбора гаджетов.
- `scripts/constants.js` — pack name, document ID, UUID и путь токена.
- `scripts/main.js` — композиция, порядок синхронизации и регистрация.
- `templates/icons/Classes/Craftsman/construct-token.webp` — собственное изображение Конструкта.
- `tests/map-object-token-service.test.mjs` — новый общий объектный контракт.
- `tests/craftsman-construct-compendium.test.mjs` — Actor data, pack sync и asset.
- `tests/craftsman-constructor-activity.test.mjs` — точная структура Summon Activity.
- `tests/craftsman-constructor-service.test.mjs` — выборы, эффекты, lifecycle, перенос и resync.
- `tests/craftsman-constructor-hooks.test.mjs` — регистрация hooks.
- `tests/classes-compendium.test.mjs`, `tests/main-composition-root.test.mjs`, `tests/module-manifest.test.mjs` — интеграционные контракты.

### Task 1: Reusable Existing-Token Object Contract

**Files:**
- Modify: `scripts/data/map-object-token-service.js`
- Test: `tests/map-object-token-service.test.mjs`

**Interfaces:**
- Produces: `buildMapObjectActorDelta({ name, hp, ac, damageThreshold })`.
- Produces: `buildExistingMapObjectTokenPatch({ token, hp, ac, damageThreshold, flags })`.
- Produces methods: `MapObjectTokenService.convertTokenToObject(token, input, options)`, `restoreObjectActor(token, snapshot, options)`, `markObjectDestroyed(token, options)`.
- Consumed later by: `CraftsmanConstructorService`.

- [ ] **Step 1: Write failing preservation tests**

```js
test("existing-token object patch preserves actorId, texture, size, items and effects", () => {
  const token = constructToken({ items: [weapon], effects: [bodyEffect], texture: "construct.webp" });
  const patch = buildExistingMapObjectTokenPatch({
    token, hp: 26, ac: 17, damageThreshold: 0,
    flags: { craftsmanConstruct: { state: "disabled" } }
  });
  assert.equal(Object.hasOwn(patch, "actorId"), false);
  assert.equal(Object.hasOwn(patch, "texture"), false);
  assert.equal(Object.hasOwn(patch, "width"), false);
  assert.deepEqual(token.actor.items, [weapon]);
  assert.deepEqual(patch.delta.system.attributes.hp, { value: 26, max: 26, temp: 0, tempmax: 0, dt: 0 });
});
```

- [ ] **Step 2: Run the focused object tests and verify RED**

Run: `node --test --test-name-pattern="existing-token object" tests/map-object-token-service.test.mjs`

Expected: FAIL because the new builders are absent.

- [ ] **Step 3: Extract the shared ActorDelta builder**

```js
export function buildMapObjectActorDelta({ name, hp, ac, damageThreshold = 0 }) {
  const input = normalizeMapObjectInput({ name, hp, ac, damageThreshold, size: 1 });
  return {
    name: input.name,
    system: {
      attributes: {
        hp: { value: input.hp, max: input.hp, temp: 0, tempmax: 0, dt: input.damageThreshold },
        ac: { calc: "flat", flat: input.ac }
      }
    }
  };
}
```

Refactor `buildMapObjectTokenData()` to call this builder so ordinary objects and disabled Constructs share exact HP/AC semantics.

- [ ] **Step 4: Implement partial conversion/restoration methods**

`convertTokenToObject` must update `token.actor` attributes and merge Token flags without replacing `actorId`, `texture`, dimensions, `delta.items` or `delta.effects`. It stores a caller-provided snapshot flag, sets `mapObjectToken: true`, disables sight and keeps the HP bar. `restoreObjectActor` applies only the saved construct attributes/flags. `markObjectDestroyed` changes the managed state without deleting the Token.

- [ ] **Step 5: Run the complete object suite**

Run: `node --test tests/map-object-token-service.test.mjs tests/map-object-token-macro.test.mjs tests/main-composition-root.test.mjs`

Expected: existing 37 object tests plus new preservation tests PASS.

- [ ] **Step 6: Commit the reusable object contract**

```powershell
git add scripts/data/map-object-token-service.js tests/map-object-token-service.test.mjs
git commit -m "feat(objects): support existing token conversion"
```

### Task 2: Construct Token Artwork and Managed Actor Compendium

**Files:**
- Create: `scripts/data/craftsman-construct-compendium.js`
- Create: `templates/icons/Classes/Craftsman/construct-token.webp`
- Modify: `scripts/constants.js`
- Test: `tests/craftsman-construct-compendium.test.mjs`

**Interfaces:**
- Produces constants: `CRAFTSMAN_CONSTRUCTS_COMPENDIUM_NAME`, `CRAFTSMAN_CONSTRUCT_DOCUMENT_ID`, `CRAFTSMAN_CONSTRUCT_UUID`, `CRAFTSMAN_CONSTRUCT_TOKEN_PATH`.
- Produces: `buildCraftsmanConstructActorData()` and `CraftsmanConstructCompendiumService.sync()`.
- Consumed later by: Summon Activity and constructor service.

- [ ] **Step 1: Write failing Actor, pack and asset tests**

```js
test("construct actor has the exact base stat block and unlinked token", () => {
  const actor = buildCraftsmanConstructActorData();
  assert.equal(actor.type, "npc");
  assert.equal(actor.prototypeToken.actorLink, false);
  assert.equal(actor.prototypeToken.texture.src, CRAFTSMAN_CONSTRUCT_TOKEN_PATH);
  assert.deepEqual(actor.system.abilities, abilities(16, 12, 15, 8, 10, 7));
  assert.deepEqual(actor.system.attributes.hp, { value: 5, max: 5, formula: "0d10" });
  assert.equal(actor.system.attributes.ac.flat, 14);
});

test("construct token asset exists", () => {
  assert.equal(existsSync(new URL("../templates/icons/Classes/Craftsman/construct-token.webp", import.meta.url)), true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/craftsman-construct-compendium.test.mjs`

Expected: FAIL with missing module and token asset.

- [ ] **Step 3: Generate and validate token artwork with the image-generation skill**

Use this exact generation brief:

```text
Square Foundry VTT token asset, full-body medium modular fantasy-industrial construct,
brass iron and dark steel plates, visible blue arcane core, sturdy readable silhouette,
neutral three-quarter stance, isolated on bright chroma green background, no frame,
no text, no watermark, high contrast, designed to remain legible at 128 pixels.
```

Inspect the result visually, remove the chroma background with the image skill helper, crop square without cutting limbs, convert losslessly to transparent WebP and save at the required path. Verify transparency and readability with `view_image`.

- [ ] **Step 4: Implement the exact base NPC builder**

The Actor contains Medium construct type, speed 30, `16/12/15/8/10/7`, Dex/Wis save proficiency, poison damage immunity, poisoned/charmed/exhaustion condition immunities, darkvision 60, passive Perception 11, all-weapon/all-armor proficiency, no speech, and the full source description. Base AC is 14, base HP is 5 and HP formula is `0d10`; scaling is left to native Summon bonuses.

- [ ] **Step 5: Implement idempotent Actor compendium and technical world Actor sync**

Create an Actor pack with stable 16-character document ID and call `syncFlaggedManagedDocuments()` through `pack.documentClass`. After pack sync, active GM creates or updates one `flags.dnd5e.isAutoImported` world Actor with `_stats.compendiumSource = CRAFTSMAN_CONSTRUCT_UUID` and default OWNER permission, allowing ordinary players to pass `Actor5e.fetchExisting()` without `ACTOR_CREATE`.

- [ ] **Step 6: Run Actor compendium tests**

Run: `node --test tests/craftsman-construct-compendium.test.mjs`

Expected: PASS for exact data, stable UUID, create/update/no-op sync, unmanaged Actor preservation and valid WebP asset.

- [ ] **Step 7: Commit Actor data and artwork**

```powershell
git add scripts/constants.js scripts/data/craftsman-construct-compendium.js templates/icons/Classes/Craftsman/construct-token.webp tests/craftsman-construct-compendium.test.mjs
git commit -m "feat(craftsman): add managed construct actor"
```

### Task 3: One Native Summon Activity

**Files:**
- Create: `scripts/data/craftsman-construct-definitions.js`
- Modify: `scripts/data/classes-compendium.js`
- Test: `tests/craftsman-constructor-activity.test.mjs`
- Test: `tests/classes-compendium.test.mjs`

**Interfaces:**
- Produces: `CRAFTSMAN_BODY_ASSEMBLIES`, `CRAFTSMAN_COMBAT_MODES`, `buildCraftsmanConstructSummonAutomation(feature)`.
- Adds Activity flag: `{ kind: "constructSummon", version: 1 }`.
- Consumed later by: `CraftsmanConstructorService`.

- [ ] **Step 1: Write the failing modern-Summon contract test**

```js
test("construct assembly contains one dnd5e 5.2.5 Summon Activity and one profile", () => {
  const automation = buildCraftsmanConstructSummonAutomation(feature);
  const activity = Object.values(automation.activities)[0];
  assert.equal(activity.type, "summon");
  assert.equal(activity.profiles.length, 1);
  assert.equal(activity.profiles[0].uuid, CRAFTSMAN_CONSTRUCT_UUID);
  assert.deepEqual(activity.visibility, { identifier: "craftsman-v01", level: { min: 3, max: null } });
  assert.deepEqual(activity.bonuses, {
    ac: "@prof", hd: "@classes.craftsman-v01.levels",
    hp: "5 * @classes.craftsman-v01.levels", attackDamage: "", saveDamage: "", healing: ""
  });
});
```

- [ ] **Step 2: Run activity tests and verify RED**

Run: `node --test --test-name-pattern="construct|Constructor" tests/craftsman-constructor-activity.test.mjs tests/classes-compendium.test.mjs`

Expected: FAIL because `construct-assembly` still has no Activity.

- [ ] **Step 3: Implement stable registries without paraphrasing visible text**

```js
export const CRAFTSMAN_BODY_ASSEMBLIES = Object.freeze({
  STURDY: "sturdy-body",
  POWERFUL_ARMS: "powerful-arms",
  AIMING_TUNING: "aiming-tuning",
  MAGIC_CONDUIT: "magic-conduit"
});

export const CRAFTSMAN_COMBAT_MODES = Object.freeze({
  DUELIST: "duelist", DEFENSE: "defense", LIGHT_ARMOR: "light-armor",
  MASSIVE_ARMOR: "massive-armor", GREAT_WEAPON: "great-weapon",
  TWO_WEAPONS: "two-weapons", ARCHERY: "archery", BLIND_FIGHTING: "blind-fighting",
  INTERCEPTION: "interception", BORDERING_POTENTIAL: "bordering-potential"
});
```

Labels shown in dialogs are exact source names: «Крепкий корпус», «Мощные руки», «Доводка прицела», «Проводник магии» and all ten exact combat-mode names.

- [ ] **Step 4: Build the one-profile native Activity and attach it by exact feature ID**

Match the complete ID `craftsman-v01::specialty::craftsman-specialty-constructor::construct-assembly`, not the Russian name. Add a test against the final generated feature Item, not only the standalone builder. Use `summon: { mode: "", prompt: true }`, `creatureSizes: ["med"]`, `creatureTypes: ["construct"]`, and `match: { ability: "", attacks: false, disposition: true, proficiency: true, saves: false }`. Do not place body assemblies in `profiles`.

- [ ] **Step 5: Run activity and text-regression tests**

Run: `node --test tests/craftsman-constructor-activity.test.mjs tests/classes-compendium.test.mjs`

Expected: PASS; the canonical Markdown remains character-for-character equal before rendering, and the rendered Item has equal visible text after stripping markup.

- [ ] **Step 6: Commit the native Activity**

```powershell
git add scripts/data/craftsman-construct-definitions.js scripts/data/classes-compendium.js tests/craftsman-constructor-activity.test.mjs tests/classes-compendium.test.mjs
git commit -m "feat(craftsman): add native construct summon activity"
```

### Task 4: Rest Permission, Native Summon Transaction, and Two Dialogs

**Files:**
- Create: `scripts/combat/craftsman-constructor-service.js`
- Test: `tests/craftsman-constructor-service.test.mjs`

**Interfaces:**
- Produces methods: `handleRestCompleted`, `applyDnd5ePreSummon`, `applyDnd5ePreSummonToken`, `applyDnd5eSummonToken`, `applyDnd5ePostSummon`.
- Persists owner flag: `flags.rebreya-main.craftsmanConstructor = { restGeneration, assemblyAvailable, activeTokenUuid }`.
- Persists Token/delta flag: `craftsmanConstruct = { version, instanceId, ownerActorUuid, featureItemUuid, activityUuid, restGeneration, state, bodyAssemblyId, skillIds, combatModeId, disabledUntilWorldTime, disabledCreatureHp, objectSnapshot }`.

- [ ] **Step 1: Write failing permission and rollback tests**

```js
test("long rest grants one assembly and automatically uses the native summon Activity", async () => {
  await service.handleRestCompleted(constructor, { longRest: true }, {});
  assert.equal(activityUseCalls.length, 1);
  assert.equal(ownerState(constructor).assemblyAvailable, false);
});

test("cancelled placement and missing scene preserve assembly for manual use", async () => {
  await service.handleRestCompleted(constructor, { longRest: true }, { sceneReady: false });
  assert.equal(ownerState(constructor).assemblyAvailable, true);
  assert.match(lastNotification(), /сцен/u);
});

test("cancelling either configuration dialog deletes only the new token", async () => {
  const oldToken = activeConstructToken();
  promptResults.push(null);
  await service.applyDnd5ePostSummon(activity, profile, [newToken], {});
  assert.deepEqual(deletedTokenUuids, [newToken.uuid]);
  assert.equal(ownerState(constructor).activeTokenUuid, oldToken.uuid);
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `node --test --test-name-pattern="long rest|configuration dialog" tests/craftsman-constructor-service.test.mjs`

Expected: FAIL because the constructor service is absent.

- [ ] **Step 3: Implement exact identity and permission checks**

Accept only an Activity whose Item has the complete managed feature ID, whose actor owns the canonical Constructor specialty, and whose single profile UUID equals `CRAFTSMAN_CONSTRUCT_UUID`. Select one explicit mode before authorization: `rebuild` when `assemblyAvailable` is true; `transfer` when no assembly is available and the active Token is on another scene; reject a same-scene duplicate. An explicit transfer option may override rebuild only when the player chose it in the native use dialog. Only `rebuild` requires the rest permission. Ordinary Summon Activities return `true` untouched. Never consume `assemblyAvailable` in `preSummon`. If `dnd5e.allowSummoning` is false, the scene is missing/not ready, or the user lacks Token create permission, show a notification and retain the permission for later manual use.

- [ ] **Step 4: Implement the post-placement transaction**

After dnd5e creates a Token, enqueue a serialized coordinator task because the system invokes `dnd5e.postSummon` through non-awaited `Hooks.callAll`. The task prompts first for one body assembly and exactly two distinct skills, then for one combat mode. Apply both only after both dialogs return valid data. On cancellation/error delete only the new Token and retain the previous active link. On success set flags and consume `assemblyAvailable`, then replace the previous active instance. If the old instance contains user-added equipment, convert that same Token through `MapObjectTokenService` to terminal `inert`; otherwise delete it. A failed background task logs once, rolls back the new Token and never leaves an unhandled rejection.

- [ ] **Step 5: Run permission and transaction tests**

Run: `node --test tests/craftsman-constructor-service.test.mjs`

Expected: PASS for cancellation, invalid profile, foreign summon, permissions/scene failures, serialized hook execution, duplicate same-scene summon, both old-inventory replacement paths and successful one-use assembly.

- [ ] **Step 6: Commit the summon transaction**

```powershell
git add scripts/combat/craftsman-constructor-service.js tests/craftsman-constructor-service.test.mjs
git commit -m "feat(craftsman): configure constructs after summoning"
```

### Task 5: Body Assemblies and Construct Actions

**Files:**
- Modify: `scripts/combat/craftsman-constructor-service.js`
- Modify: `scripts/data/craftsman-construct-compendium.js`
- Test: `tests/craftsman-constructor-service.test.mjs`
- Test: `tests/craftsman-construct-compendium.test.mjs`

**Interfaces:**
- Produces: `applyBodyAssembly(tokenActor, selection, owner)`, `applyPostRollAttack`, `useConstructAction`.
- Consumes: `CombatStatusService` for «Спровоцирован 2».

- [ ] **Step 1: Write one failing test per body assembly**

```js
test("Крепкий корпус adds two HP per Craftsman level and grants provocation", async () => {
  await service.applyBodyAssembly(token.actor, { bodyAssemblyId: "sturdy-body", skillIds: ["prc", "ath"] }, owner);
  assert.equal(token.actor.system.attributes.hp.max, 5 + 7 * ownerCraftsmanLevel);
  await service.useConstructAction(token.actor, "effective-provocation");
  assert.deepEqual(statusCalls, enemiesWithin10.map((actor) => [actor, "provoked", 2]));
});

test("Доводка прицела rerolls one missed ranged attack per turn with advantage", async () => {
  await service.applyPostRollAttack([missRoll()], { subject: rangedAttack(token.actor) });
  assert.equal(rerollCalls[0].advantage, true);
  await service.applyPostRollAttack([missRoll()], { subject: rangedAttack(token.actor) });
  assert.equal(rerollCalls.length, 1);
});
```

- [ ] **Step 2: Run body tests and verify RED**

Run: `node --test --test-name-pattern="Крепкий корпус|Мощные руки|Доводка прицела|Проводник магии" tests/craftsman-constructor-service.test.mjs`

Expected: FAIL on missing body handlers.

- [ ] **Step 3: Implement skill and body data updates**

Clear only the two managed skill proficiencies from a previous build, then set exactly two selected `system.skills.<id>.value = 1`. «Крепкий корпус» sets absolute max HP `5 + 7 * level`; «Мощные руки» overrides Strength from 16 to 20; other bodies retain base values. Preserve already received damage when changing only level-derived maximums.

- [ ] **Step 4: Implement exact body actions**

«Действенная провокация» finds hostile tokens within 10 feet and sets Provoked 2 through `CombatStatusService`. «Сильный выпад» asks for one equipped melee weapon Activity, uses that ordinary attack, and on a miss applies only damage equal to the construct's Strength modifier; it does not invent a separate hit-damage formula. «Доводка прицела» consumes a round/turn key only after an eligible reroll.

- [ ] **Step 5: Implement `Проводник магии` origin and reaction routing**

For an owner spell or magic-item spell used on the owner's turn, `dnd5e.preUseActivity` offers the active construct as origin, stores `originTokenUuid`, and `dnd5e.preCreateActivityTemplate` seeds template coordinates from that Token. `dnd5e.preCreateUsageMessage` uses the construct Token as speaker. When a reaction spell's trigger targets the construct, copy only that Activity's resulting managed effects to the construct synthetic Actor; spell slots and concentration remain on the owner.

- [ ] **Step 6: Run body and spell regressions**

Run: `node --test tests/craftsman-constructor-service.test.mjs tests/spell-automation-service.test.mjs tests/combat-status.test.mjs`

Expected: PASS; ordinary spell origins and reactions are unchanged.

- [ ] **Step 7: Commit body mechanics**

```powershell
git add scripts/combat/craftsman-constructor-service.js scripts/data/craftsman-construct-compendium.js tests/craftsman-constructor-service.test.mjs tests/craftsman-construct-compendium.test.mjs
git commit -m "feat(craftsman): automate construct body assemblies"
```

### Task 6: Static and Weapon-Based Combat Modes

**Files:**
- Modify: `scripts/combat/craftsman-constructor-service.js`
- Test: `tests/craftsman-constructor-service.test.mjs`

**Interfaces:**
- Produces handlers: `refreshCombatModeEffects`, `applyPreRollAttack`, `applyPreRollDamage`.

- [ ] **Step 1: Write failing mode tests**

```js
test("armor modes apply only while the matching armor is equipped", async () => {
  await service.selectCombatMode(actor, "light-armor");
  await service.refreshCombatModeEffects(actor);
  assert.equal(actor.system.attributes.movement.walk, 35);
  equipArmor(actor, "medium");
  await service.refreshCombatModeEffects(actor);
  assert.equal(actor.system.attributes.movement.walk, 30);
});

test("great weapon mode treats damage die results 1 and 2 as 3", () => {
  const config = meleeTwoHandedDamageConfig("2d6");
  service.applyPreRollDamage(config);
  assert.equal(config.parts[0].formula, "2d6min3");
});
```

- [ ] **Step 2: Run static-mode tests and verify RED**

Run: `node --test --test-name-pattern="armor modes|great weapon|Duelist|Archery|blind" tests/craftsman-constructor-service.test.mjs`

Expected: FAIL on missing mode handlers.

- [ ] **Step 3: Implement equipment-aware effects**

On Item create/update/delete and mode selection, recompute only managed effects: Duelist adds `+2` damage with exactly one one-handed melee weapon and no second weapon; light armor adds `5` walk; medium/heavy armor adds `1` AC; blind fighting sets blindsight to at least 10 without lowering a larger existing value.

- [ ] **Step 4: Implement roll-aware effects**

Great weapon rewrites eligible weapon dice with the `min3` modifier. Two-weapon mode appends the attack ability modifier only to the off-hand/second attack damage. Archery adds `Math.floor(proficiency / 2)` to ranged or firearm attack rolls. Every handler verifies the synthetic Actor's exact construct flag and selected mode.

- [ ] **Step 5: Run mode tests**

Run: `node --test tests/craftsman-constructor-service.test.mjs`

Expected: PASS for all six modes and negative equipment/weapon cases.

- [ ] **Step 6: Commit static modes**

```powershell
git add scripts/combat/craftsman-constructor-service.js tests/craftsman-constructor-service.test.mjs
git commit -m "feat(craftsman): automate construct weapon modes"
```

### Task 7: Defense, Interception, and Bordering Potential

**Files:**
- Modify: `scripts/combat/craftsman-constructor-service.js`
- Modify: `scripts/combat/attack-service.js`
- Test: `tests/craftsman-constructor-service.test.mjs`
- Test: `tests/combat-attack-service.test.mjs`

**Interfaces:**
- Produces: `selectDefenseWard`, `getConditionalCover`, `supplementsReactionCapability`, `handleTokenUpdate`.
- Consumes: existing Interception reaction provider and token distance helpers.

- [ ] **Step 1: Write failing spatial-mode tests**

```js
test("Defense grants half cover to one chosen ally of allowed size within 5 feet", () => {
  service.selectDefenseWard(construct, ally.uuid);
  assert.equal(service.getConditionalCover(construct, ally, { distance: 5, shieldEquipped: true }), 2);
  assert.equal(service.getConditionalCover(construct, ally, { distance: 10, shieldEquipped: true }), 0);
});

test("Bordering Potential marks exactly one next melee attack after a five-foot move", async () => {
  await service.handleTokenUpdate(token, { x: token.x + gridSize }, turnOptions);
  const attack = meleeAttackConfig({ range: 5 });
  service.applyPreRollAttack(attack);
  assert.equal(attack.advantage, true);
  assert.equal(attack.range, 10);
  service.applyPreRollAttack(nextMeleeAttackConfig());
  assert.equal(nextMeleeAttackConfigResult.advantage, false);
});
```

- [ ] **Step 2: Run spatial-mode tests and verify RED**

Run: `node --test --test-name-pattern="Defense|Interception|Bordering" tests/craftsman-constructor-service.test.mjs tests/combat-attack-service.test.mjs`

Expected: FAIL on missing spatial integration.

- [ ] **Step 3: Implement Defense and Interception composition**

Defense stores one chosen ally Token UUID, validates size and 5-foot distance for each incoming attack, and contributes half-cover AC `+2` through the attack service's target-AC resolver only while the construct holds a shield. Interception exposes the existing `Перехват ⚡` reaction capability for the construct; do not create a second reaction engine.

- [ ] **Step 4: Implement five-foot movement state**

`updateToken` records Bordering Potential only when the construct moves exactly one scene grid distance during its current combat turn. The next melee attack before turn end gets advantage and range `+5`, then consumes the marker. Teleports, movement on another turn, zero-grid scenes and longer movement do not qualify.

- [ ] **Step 5: Run spatial and attack regressions**

Run: `node --test tests/craftsman-constructor-service.test.mjs tests/combat-attack-service.test.mjs tests/reaction-capability-index.test.mjs`

Expected: PASS; existing cover and reactions for non-construct actors remain unchanged.

- [ ] **Step 6: Commit spatial modes**

```powershell
git add scripts/combat/craftsman-constructor-service.js scripts/combat/attack-service.js tests/craftsman-constructor-service.test.mjs tests/combat-attack-service.test.mjs
git commit -m "feat(craftsman): automate construct spatial modes"
```

### Task 8: Disabled Object, Repair, Destruction, and Link Loss

**Files:**
- Modify: `scripts/combat/craftsman-constructor-service.js`
- Modify: `scripts/data/craftsman-construct-compendium.js`
- Test: `tests/craftsman-constructor-service.test.mjs`

**Interfaces:**
- Produces lifecycle states: `active`, `disabled`, `destroyed`, `link-lost`, `inert`.
- Consumes: `MapObjectTokenService.convertTokenToObject`, `restoreObjectActor`, `markObjectDestroyed`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("first zero HP converts the same construct token to a Medium map object", async () => {
  await service.applyDnd5eApplyDamage(construct.actor, 99, {});
  assert.equal(construct.flags[MODULE_ID].craftsmanConstruct.state, "disabled");
  assert.equal(construct.actor.system.attributes.hp.value, previousMaxHp);
  assert.deepEqual(construct.actor.items, originalItems);
  assert.equal(construct.texture.src, originalTexture);
});

test("zero HP while disabled destroys the construct and preserves player equipment", async () => {
  await service.applyDnd5eApplyDamage(disabled.actor, 99, {});
  assert.equal(constructState(disabled).state, "destroyed");
  assert.deepEqual(playerEquipment(disabled.actor), originalPlayerEquipment);
});
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `node --test --test-name-pattern="zero HP|repair|link loss" tests/craftsman-constructor-service.test.mjs`

Expected: FAIL because object lifecycle is absent.

- [ ] **Step 3: Implement active-to-object and object-to-destroyed transitions**

On active zero HP or instant-death status, store `disabledCreatureHp = 0`, disable construct Activities, and call the shared object service with HP equal to the construct's current maximum and unchanged AC/texture/size. On disabled-object zero HP, mark terminal `destroyed`, remove only managed construct features/effects, and leave user equipment in the inert Token.

- [ ] **Step 4: Implement voluntary shutdown and 10-minute repair**

The Actor template uses service UI labels «Отключить», «Пересборка» and «Восстановить Конструкта»; these names are not claimed as source headings. Their Item/chat descriptions are copied verbatim from the corresponding paragraphs in `data/craftsman-v01.json`, with text regressions covering every construct action, all four body assemblies and all ten combat modes. Repair is serialized: save current object HP, temporarily expose persisted `disabledCreatureHp`, run native `actor.shortRest({ dialog: true, duration: 600, advanceTime: false })`, and restore object HP on cancellation or zero healing. Positive creature HP sets `disabledUntilWorldTime = game.time.worldTime + 60`; initiative or elapsed world time restores active state. `objectSnapshot` is versioned and survives scene reload. «Пересборка» reduces `system.attributes.hd.spent` by `Math.max(1, Math.floor(hd.max / 2))` after its 10-minute Activity.

- [ ] **Step 5: Implement terminal owner death**

Owner death changes `active` or `disabled` to `link-lost`. Detect death/instant-death through `dnd5e.applyDamage`, `updateActor` HP and `createActiveEffect`/`updateActiveEffect`/`deleteActiveEffect` status changes. The Token remains a Medium object with equipment, but repair is rejected. Resurrection alone does not reactivate it; a later long rest and new assembly are required.

- [ ] **Step 6: Run lifecycle tests**

Run: `node --test tests/craftsman-constructor-service.test.mjs tests/map-object-token-service.test.mjs`

Expected: PASS for active/disabled/destroyed/link-lost transitions, cancellation and inventory preservation.

- [ ] **Step 7: Commit lifecycle mechanics**

```powershell
git add scripts/combat/craftsman-constructor-service.js scripts/data/craftsman-construct-compendium.js tests/craftsman-constructor-service.test.mjs
git commit -m "feat(craftsman): add construct object lifecycle"
```

### Task 9: Scene Transfer and Level Resynchronization

**Files:**
- Modify: `scripts/combat/craftsman-constructor-service.js`
- Test: `tests/craftsman-constructor-service.test.mjs`

**Interfaces:**
- Produces: `buildConstructTransferChanges(sourceToken)`, `synchronizeConstruct(ownerActor)`, `findOwnedConstructs(ownerActor)`.

- [ ] **Step 1: Write failing transfer and resync tests**

```js
test("scene transfer copies delta and deletes the source only after native placement succeeds", async () => {
  await service.applyDnd5ePreSummon(activity, profile, transferOptions);
  service.applyDnd5ePreSummonToken(activity, profile, tokenConfig, transferOptions);
  assert.deepEqual(tokenConfig.actorUpdates.items, source.delta.items);
  await service.applyDnd5ePostSummon(activity, profile, [destination], transferOptions);
  assert.deepEqual(events, ["create:destination", "delete:source"]);
  assert.equal(constructState(destination).instanceId, constructState(source).instanceId);
});

test("level resync preserves absolute damage", async () => {
  construct.actor.system.attributes.hp = { value: 10, max: 20 };
  await service.synchronizeConstruct(ownerAtLevel(5));
  assert.equal(construct.actor.system.attributes.hp.max, 30);
  assert.equal(construct.actor.system.attributes.hp.value, 20);
});
```

- [ ] **Step 2: Run transfer tests and verify RED**

Run: `node --test --test-name-pattern="scene transfer|level resync" tests/craftsman-constructor-service.test.mjs`

Expected: FAIL on missing transfer/resync methods.

- [ ] **Step 3: Implement transfer through the same native Activity**

When the active Token is on another scene and no rebuild permission is being used, `preSummon` marks mode `transfer` without requiring `assemblyAvailable`. `preSummonToken` preserves source Items, Effects, HP, `instanceId`, body/mode and user settings, but applies them beneath the freshly generated native `flags.dnd5e.summon.origin/activity/profile`; it copies token name/texture/size/disposition without copying IDs, coordinates, `actorId` or the old `delta` wrapper. `postSummon` deletes the source only after destination creation succeeds; no dialogs open and body/mode remain unchanged. If source deletion fails, delete the destination and retain the source link; if destination rollback also fails, mark the destination terminal `inert` and keep the source as the sole active UUID.

- [ ] **Step 4: Implement absolute resynchronization**

On class Item update, owner proficiency update, canvas ready and module ready, calculate AC `14 + PB`, max HP `5 + 5 × level` or `5 + 7 × level`, and HD max `level`. Preserve `oldMax - oldValue` damage and `hd.spent`. Apply only to the active construct generation and never to terminal inert objects.

- [ ] **Step 5: Run transfer/resync tests**

Run: `node --test tests/craftsman-constructor-service.test.mjs`

Expected: PASS for cross-scene success, cancellation, deletion failure recovery, same-scene duplicate rejection and multiclass level calculations.

- [ ] **Step 6: Commit transfer and resync**

```powershell
git add scripts/combat/craftsman-constructor-service.js tests/craftsman-constructor-service.test.mjs
git commit -m "feat(craftsman): transfer and resync constructs"
```

### Task 10: Hooks, Composition, and Full Verification

**Files:**
- Create: `scripts/integrations/craftsman-constructor-hooks.js`
- Create: `scripts/integrations/craftsman-rest-orchestrator.js`
- Modify: `scripts/main.js`
- Test: `tests/craftsman-constructor-hooks.test.mjs`
- Test: `tests/main-composition-root.test.mjs`
- Test: `tests/module-manifest.test.mjs`

**Interfaces:**
- Produces: idempotent `registerCraftsmanConstructorHooks(moduleApi)`.
- Consumes: construct compendium, constructor service, map-object service, existing status/attack/reaction services.

- [ ] **Step 1: Write failing hook and initialization-order tests**

```js
test("Constructor hooks register native summon lifecycle exactly once", () => {
  registerCraftsmanConstructorHooks(moduleApi);
  registerCraftsmanConstructorHooks(moduleApi);
  for (const hook of ["dnd5e.preSummon", "dnd5e.preSummonToken", "dnd5e.summonToken", "dnd5e.postSummon"])
    assert.equal(count(hook), 1);
});

test("construct Actor sync completes before class feature sync", async () => {
  await moduleApi.initialize();
  assert.deepEqual(syncOrder.slice(0, 2), ["construct-actor", "classes"]);
});
```

- [ ] **Step 2: Run wiring tests and verify RED**

Run: `node --test tests/craftsman-constructor-hooks.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs`

Expected: FAIL because the service is not composed or registered.

- [ ] **Step 3: Register exact lifecycle and combat hooks**

Register the four native summon hooks plus `dnd5e.preUseActivity`, `dnd5e.postUseActivity`, `dnd5e.preCreateActivityTemplate`, `dnd5e.preCreateUsageMessage`, `dnd5e.preRollAttack`, `dnd5e.rollAttack`, `dnd5e.preRollDamage`, `dnd5e.applyDamage`, `createItem`, `updateItem`, `deleteItem`, `updateActor`, `createActiveEffect`, `updateActiveEffect`, `deleteActiveEffect`, `updateToken`, `deleteToken`, `createCombatant`, `updateCombatant`, `combatTurnChange`, `updateWorldTime` and `canvasReady`. Each callback is fail-closed only for an exactly identified managed Construct. The non-awaited `dnd5e.postSummon` listener starts the serialized service task and attaches its own rejection handler.

Do not register a second `dnd5e.restCompleted` listener. The shared `CraftsmanRestOrchestrator` awaits the gadget workflow first and then calls Constructor, with a test proving no parallel dialogs or placement prompts.

- [ ] **Step 4: Compose and initialize in dependency order**

```js
this.craftsmanConstructCompendium = new CraftsmanConstructCompendiumService({
  isActiveGmClient,
  actorProvider: () => globalThis.Actor
});
this.craftsmanConstructorService = new CraftsmanConstructorService(this, {
  coordinator: this.worldMutationCoordinator,
  objectService: this.mapObjectTokenService,
  statusService: this.combatStatusService,
  attackService: this.combatAttackService
});
```

Run construct compendium sync before `ClassesCompendiumService.sync()` so the feature's UUID is valid. Register `registerCraftsmanConstructorHooks(moduleApi)` after `registerCombatHooks(moduleApi)`. Add cache-busting import query strings consistent with current `main.js`.

- [ ] **Step 5: Run focused verification**

Run: `node --test tests/craftsman-construct-compendium.test.mjs tests/craftsman-constructor-activity.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-hooks.test.mjs tests/map-object-token-service.test.mjs tests/classes-compendium.test.mjs tests/combat-attack-service.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs`

Expected: all focused tests PASS.

- [ ] **Step 6: Run the complete module suite and static checks**

Run: `node --test`

Expected: all tests PASS with zero failures.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 7: Perform manual Foundry verification**

In Foundry VTT 13/dnd5e 5.2.5 verify: long-rest automatic summon, native placement, both dialogs, all four body assemblies, all ten modes, equipment persistence, disabled object damage/repair/destruction, owner death, scene transfer and level change. Confirm standard dnd5e and Tidy sheets render without missing partials.

- [ ] **Step 8: Commit integration**

```powershell
git add scripts/integrations/craftsman-constructor-hooks.js scripts/main.js tests/craftsman-constructor-hooks.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
git commit -m "feat(craftsman): wire Constructor automation"
```
