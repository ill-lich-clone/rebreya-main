# Craftsman V0.1 Gadgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать четыре базовых гаджета Ремесленника и два гаджета Механика как нативные dnd5e Items с автоматической подготовкой после продолжительного отдыха.

**Architecture:** Стабильный каталог создаёт шаблоны гаджетов в существующем compendium умений классов. `CraftsmanGadgetService` клонирует выбранные шаблоны в Actor, управляет поколениями отдыха, активацией и боевыми хуками; зона дыма и транспорт вынесены в отдельные сервисы. Все изменяющие мир операции сериализуются через существующий `WorldMutationCoordinator` и выполняются владельцем либо активным GM.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, ES modules, `node:test`, `DialogV2`, native Item Activities, Active Effects, Measured Templates.

## Global Constraints

- Рабочая ветка: только `lich_branch`; перед каждым циклом правок проверять `git status`, текущую ветку и `git fetch origin`.
- Не добавлять миграцию несуществующих старых гаджетов и не изменять обычные классы dnd5e.
- Видимый текст каждого Item переносить дословно из `data/craftsman-v01.json`; разрешена только невидимая Markdown/HTML-разметка.
- Текущий объём: «Силовая перчатка», «Магнитный движок», «Заряженный ботинок», «Дымовой аппарат», «Форсажный инжектор», «Аварийный регулятор».
- Повторы гаджетов разрешены; состояния дубликатов разделяются по `instanceId`.
- Один активированный гаджет одновременно; активация действует минуту и окончательно расходует экземпляр.
- «Граница поломки» публикует бросок и событие, но не получает придуманного последствия.
- Не добавлять новые внешние runtime-зависимости.

---

## File Structure

- `data/craftsman-v01.json` — структурированный канонический каталог шести гаджетов с дословным текстом источника.
- `scripts/data/craftsman-gadget-definitions.js` — нормализация каталога, stable IDs и native Item data без второй копии видимого текста в JavaScript.
- `scripts/combat/craftsman-gadget-service.js` — подготовка, поколения отдыха, активация, расходы и боевые эффекты базовых гаджетов.
- `scripts/combat/craftsman-gadget-zone-service.js` — дымовой шаблон, смена обычного облака на отравленное, тики и очистка.
- `scripts/combat/craftsman-vehicle-service.js` — привязка Объекта исследования, скорость, Разгон и контракт Границы поломки.
- `scripts/integrations/craftsman-gadget-hooks.js` — единственная регистрация Foundry/dnd5e hooks для трёх сервисов.
- `scripts/integrations/craftsman-rest-orchestrator.js` — единственный последовательный обработчик продолжительного отдыха: гаджеты, затем Конструктор.
- `scripts/data/classes-compendium.js` — публикация шаблонов гаджетов вместе с class feature Items.
- `scripts/main.js` — композиция сервисов и инициализация интеграции.
- `tests/craftsman-gadget-definitions.test.mjs` — точность текста, структура Activities и pack definitions.
- `tests/craftsman-gadget-service.test.mjs` — выбор, поколения, дубликаты, активация и базовые эффекты.
- `tests/craftsman-gadget-zone-service.test.mjs` — геометрия, отравление, GM-only тик и удаление зоны.
- `tests/craftsman-vehicle-service.test.mjs` — транспорт, скорость, Разгон, граница и переброс.
- `tests/craftsman-gadget-hooks.test.mjs` — регистрация hooks и делегирование.
- `tests/classes-compendium.test.mjs`, `tests/main-composition-root.test.mjs`, `tests/module-manifest.test.mjs` — интеграционные контракты.

### Task 1: Canonical Gadget Items and Compendium Templates

**Files:**
- Modify: `data/craftsman-v01.json`
- Create: `scripts/data/craftsman-gadget-definitions.js`
- Modify: `scripts/data/classes-compendium.js`
- Test: `tests/craftsman-gadget-definitions.test.mjs`
- Test: `tests/classes-compendium.test.mjs`

**Interfaces:**
- Produces: `CRAFTSMAN_GADGET_IDS`, `normalizeCraftsmanGadgets(rawClassData)`, `buildCraftsmanGadgetFeatureDefinitions(gadgets)`, `isCraftsmanGadgetItem(item)`.
- Produces Item flags: `flags.rebreya-main.craftsmanGadgetTemplate = { gadgetId, availability }`.
- Consumed later by: `CraftsmanGadgetService`.
- Increments: `CLASS_FEATURE_TEMPLATE_VERSION` so existing managed compendia receive the six templates.

- [ ] **Step 1: Write failing catalog and verbatim-copy tests**

```js
test("catalog contains exactly the four base and two Mechanic gadgets", () => {
  const gadgets = normalizeCraftsmanGadgets(loadJson("data/craftsman-v01.json"));
  assert.deepEqual(gadgets.map((entry) => entry.id), [
    "force-glove", "magnetic-engine", "charged-boot", "smoke-device",
    "afterburner-injector", "emergency-regulator"
  ]);
});

test("gadget visible copy is extracted verbatim from the Craftsman source", () => {
  const source = loadJson("data/craftsman-v01.json");
  const visibleSource = extractGadgetVisibleText(source);
  for (const definition of normalizeCraftsmanGadgets(source)) {
    assert.equal(stripMarkdown(definition.descriptionMarkdown), visibleSource.get(definition.name));
  }
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/craftsman-gadget-definitions.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/data/craftsman-gadget-definitions.js`.

- [ ] **Step 3: Add stable definitions and native activity builders**

```js
export const CRAFTSMAN_GADGET_IDS = Object.freeze({
  FORCE_GLOVE: "force-glove",
  MAGNETIC_ENGINE: "magnetic-engine",
  CHARGED_BOOT: "charged-boot",
  SMOKE_DEVICE: "smoke-device",
  AFTERBURNER_INJECTOR: "afterburner-injector",
  EMERGENCY_REGULATOR: "emergency-regulator"
});

export function normalizeCraftsmanGadgets(rawClassData) {
  const gadgets = rawClassData?.automation?.gadgets;
  if (!Array.isArray(gadgets) || gadgets.length !== 6) {
    throw new Error("Craftsman V0.1 must define exactly six gadgets in the current automation scope");
  }
  return gadgets.map(validateAndCloneGadget);
}

export function buildCraftsmanGadgetFeatureDefinitions(gadgets) {
  return gadgets.map((definition) => ({
    featureId: `craftsman-v01::gadget::${definition.id}`,
    identifier: `craftsman-gadget-${definition.id}`,
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    sourceType: "craftsmanGadget",
    name: definition.name,
    descriptionMarkdown: definition.descriptionMarkdown,
    requiredLevel: definition.requiredLevel,
    folderPath: ["Ремесленник V0.1", "Гаджеты"],
    craftsmanGadget: definition
}));
}
```

`data/craftsman-v01.json` получает `automation.gadgets`; каждый элемент содержит `id`, `name`, `descriptionMarkdown`, `availability`, `requiredLevel` и машинные параметры Activities. Поля `descriptionMarkdown` копируются дословно из уже существующих абзацев «Задорного гаджета» и «Механика». JavaScript не содержит второй текстовой копии.

Каждый Item должен получить три Activities со стабильными IDs: `activate-bonus`, `activate-attack`, `gadget-action`. Первые две имеют `activation.type = "bonus"` и `"special"`; третья имеет `activation.type = "special"`. Все три несут только машинный флаг вида `{ gadgetId, operation: "activate" | "action" }`; видимое описание Item остаётся исходным текстом целиком.

- [ ] **Step 4: Publish gadget definitions through the existing feature pack**

В `ClassesCompendiumService.sync()` объединить определения до построения UUID-карты:

```js
const featureDefinitions = [
  ...normalizedData.flatMap((classData) => buildFeatureDefinitions(classData)),
  ...normalizedData.flatMap((classData) => classData.classData.identifier === CRAFTSMAN_CLASS_IDENTIFIER
    ? buildCraftsmanGadgetFeatureDefinitions(classData.craftsmanGadgets)
    : [])
];
```

В `createFeatureAutomation()` обработать `sourceType === "craftsmanGadget"` до общего раннего возврата и передать native Activities/Effects из определения.

- [ ] **Step 5: Run catalog and compendium tests**

Run: `node --test tests/craftsman-gadget-definitions.test.mjs tests/classes-compendium.test.mjs`

Expected: PASS; class feature pack содержит шесть управляемых gadget Items с неизменённым видимым текстом.

- [ ] **Step 6: Commit the catalog slice**

```powershell
git add data/craftsman-v01.json scripts/data/craftsman-gadget-definitions.js scripts/data/classes-compendium.js tests/craftsman-gadget-definitions.test.mjs tests/classes-compendium.test.mjs tests/fixtures/craftsman-v01-source-revision.json
git commit -m "feat(craftsman): publish native gadget items"
```

### Task 2: Long-Rest Loadout and Atomic Generations

**Files:**
- Create: `scripts/combat/craftsman-gadget-service.js`
- Test: `tests/craftsman-gadget-service.test.mjs`

**Interfaces:**
- Consumes: `getCraftsmanSubclasses(actor)`, class scale `@scale.craftsman-v01.gadgets`, gadget template Items.
- Produces: `CraftsmanGadgetService.handleRestCompleted(actor, result, config)`, `prepareLoadout(actor, gadgetIds, options)`, `getPreparedGadgets(actor)`.
- Persists: `flags.rebreya-main.craftsmanGadgets = { restGeneration, selectedIds, activeInstanceId }`.

- [ ] **Step 1: Write failing capacity, availability, duplicate, cancel and rollback tests**

```js
test("long rest recreates the previous selection as a new generation when the dialog is cancelled", async () => {
  const actor = craftsmanActor({ level: 5, selectedIds: ["force-glove", "force-glove", "charged-boot"] });
  const service = createService({ promptResult: null });
  await service.handleRestCompleted(actor, { longRest: true }, {});
  assert.deepEqual(actor.getFlag(MODULE_ID, "craftsmanGadgets").selectedIds,
    ["force-glove", "force-glove", "charged-boot"]);
  assert.equal(new Set(service.getPreparedGadgets(actor).map((item) => item.flags[MODULE_ID].craftsmanGadget.instanceId)).size, 3);
});

test("non-Mechanic actors cannot prepare Mechanic gadgets", async () => {
  await assert.rejects(service.prepareLoadout(craftsmanActor(), ["afterburner-injector"]), /not available/u);
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: FAIL because `CraftsmanGadgetService` is not exported.

- [ ] **Step 3: Implement pure capacity and availability resolution**

```js
export function getCraftsmanGadgetCapacity(actor) {
  const level = craftsmanClass(actor)?.system?.levels ?? 0;
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return level >= 1 ? 2 : 0;
}

export function getAvailableCraftsmanGadgetIds(actor) {
  const ids = ["force-glove", "magnetic-engine", "charged-boot", "smoke-device"];
  const research = getCraftsmanSubclasses(actor).research;
  return research?.flags?.[MODULE_ID]?.archetypeId === "craftsman-research-mechanic"
    ? [...ids, "afterburner-injector", "emergency-regulator"]
    : ids;
}
```

При реализации читать нативную scale класса в первую очередь; таблица выше служит проверяемым fallback для тестовых Actor без prepared scale.

- [ ] **Step 4: Implement DialogV2 and generation transaction**

`handleRestCompleted` должен проверить long rest, повысить `restGeneration`, открыть столько селекторов, сколько возвращает capacity, и вызвать `prepareLoadout`. На отмене использовать прежние `selectedIds`, но создать новые экземпляры. `prepareLoadout` сначала клонирует все шаблоны с новыми `instanceId`, проверяет созданное поколение, переключает actor flag, затем удаляет только управляемые Items старого поколения. Операцию обернуть в:

```js
return this.coordinator.run(`craftsman-gadgets:${actor.uuid}`, async () => {
  // validate -> create new generation -> switch flag -> delete expired generation
});
```

- [ ] **Step 5: Run loadout tests**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: PASS for capacities `2/3/4/5/6`, duplicates, Mechanic filtering, cancellation and partial-create rollback.

- [ ] **Step 6: Commit the loadout slice**

```powershell
git add scripts/combat/craftsman-gadget-service.js tests/craftsman-gadget-service.test.mjs
git commit -m "feat(craftsman): prepare gadgets after long rests"
```

### Task 3: Activation State Machine

**Files:**
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Test: `tests/craftsman-gadget-service.test.mjs`

**Interfaces:**
- Produces: `applyPreUseActivity(activity)`, `applyPostUseActivity(activity, usageConfig, results)`, `expireActiveGadget(actor, reason)`.
- Item state: `{ state: "prepared" | "active" | "spent", actionSpent, activatedAt, expiresAt }`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("activating a second gadget spends the first and starts one minute for the second", async () => {
  await service.activateGadget(actor, first);
  await service.activateGadget(actor, second);
  assert.equal(gadgetState(first).state, "spent");
  assert.equal(gadgetState(second).state, "active");
  assert.equal(gadgetState(second).expiresAt - gadgetState(second).activatedAt, 60_000);
});

test("gadget action is accepted once only while its instance is active", async () => {
  await service.activateGadget(actor, gadget);
  assert.equal(await service.useGadgetAction(actor, gadget), true);
  assert.equal(await service.useGadgetAction(actor, gadget), false);
});
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `node --test --test-name-pattern="activating|gadget action" tests/craftsman-gadget-service.test.mjs`

Expected: FAIL because lifecycle methods do not exist.

- [ ] **Step 3: Implement fail-closed activity validation and transitions**

`applyPreUseActivity` must return `false` for an expired generation, a spent instance, an action before activation, a second gadget action, or an activity whose flags do not match its parent Item. `activateGadget` spends the previous active instance, creates the gadget-specific effect, stores wall-clock expiry, and schedules cleanup outside combat. Combat turn cleanup uses the same `expireActiveGadget` method.

- [ ] **Step 4: Run lifecycle tests**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: PASS, including repeated-hook and stale-generation cases.

- [ ] **Step 5: Commit the runtime core**

```powershell
git add scripts/combat/craftsman-gadget-service.js tests/craftsman-gadget-service.test.mjs
git commit -m "feat(craftsman): enforce gadget activation lifecycle"
```

### Task 4: Force Glove, Magnetic Engine, and Charged Boot

**Files:**
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Test: `tests/craftsman-gadget-service.test.mjs`

**Interfaces:**
- Produces hook handlers: `applyPostRollAttack`, `applyPreRollDamage`, `applyPreRollAttack`, `handleCombatTurnChange`.
- Produces compatibility flag: `flags.rebreya-main.noProvokedMovement`.

- [ ] **Step 1: Write failing behavior tests**

```js
test("Force Glove opt-in is offered only after a hit and applies Intelligence once per turn", async () => {
  await service.applyPostRollAttack([hitRoll()], { subject: weaponAttack(owner) });
  assert.equal(await service.applyPreRollDamage(damageConfig(owner)), true);
  assert.equal(damageConfigResult.parts.at(-1).formula, "@abilities.int.mod");
  assert.equal(await service.applyPreRollDamage(damageConfig(owner)), true);
  assert.equal(damageConfigResult.parts.length, 1);
});

test("Magnetic Engine changes target AC only for weapon attacks", () => {
  const weapon = attackConfig({ target: 15, targetActor: owner, itemType: "weapon" });
  service.applyPreRollAttack(weapon);
  assert.equal(weapon.target, 17);
  const spell = attackConfig({ target: 15, targetActor: owner, itemType: "spell" });
  service.applyPreRollAttack(spell);
  assert.equal(spell.target, 15);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="Force Glove|Magnetic Engine|Charged Boot" tests/craftsman-gadget-service.test.mjs`

Expected: FAIL on missing hook handlers.

- [ ] **Step 3: Implement Force Glove and its next-attack action**

Use `dnd5e.rollAttack` to compare the roll total with `roll.options.target`, ask the owner through injected `confirmProvider`, and store a pending damage flag keyed by attack identity and combat round/turn. Mirror confirmed hits through `midi-qol.hitsChecked` with the same idempotency key. `dnd5e.preRollDamage`/`midi-qol.preDamageRoll` append exactly one `@abilities.int.mod` part and consume it. The gadget action stores `nextAttackAdvantageUntil`; the native/MIDI pre-attack adapters set advantage for the first eligible attack and consume the marker only after a roll actually occurs.

- [ ] **Step 4: Implement Magnetic Engine**

`applyPreRollAttack` adds `2` to `rollConfig.target` only when the selected target owns the active Magnetic Engine and the subject is an attack Activity from a `weapon` Item. The gadget action uses an Intelligence attack Activity with `range.value = 30`; after a successful roll it posts the exact pull/disarm instruction and never moves or deletes a held Item without a represented scene document.

- [ ] **Step 5: Implement Charged Boot**

Activation creates a managed Active Effect adding `10` to `system.attributes.movement.walk`. The gadget action sets `flags.rebreya-main.noProvokedMovement` with the current combat turn key; the existing `provokedAttack` reaction provider must consult this flag and return no candidate. `handleCombatTurnChange` clears it at end of turn.

- [ ] **Step 6: Run the service and attack-service regression tests**

Run: `node --test tests/craftsman-gadget-service.test.mjs tests/combat-attack-service.test.mjs`

Expected: PASS; unrelated attacks, reactions and actors remain unchanged.

- [ ] **Step 7: Commit the three basic effects**

```powershell
git add scripts/combat/craftsman-gadget-service.js scripts/combat/attack-service.js tests/craftsman-gadget-service.test.mjs tests/combat-attack-service.test.mjs
git commit -m "feat(craftsman): automate core gadget effects"
```

### Task 5: Smoke Device Timed Zone

**Files:**
- Create: `scripts/combat/craftsman-gadget-zone-service.js`
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Modify: `scripts/combat/attack-service.js`
- Test: `tests/craftsman-gadget-zone-service.test.mjs`
- Test: `tests/combat-attack-service.test.mjs`

**Interfaces:**
- Produces: `CraftsmanGadgetZoneService.registerTemplate`, `poisonTemplate`, `handleCombatTurn`, `handleTokenUpdate`, `deleteByInstanceId`, `isSightObscured`.
- Persists template flag: `{ instanceId, ownerActorUuid, poisoned, expiresAtTurnKey }`.

- [ ] **Step 1: Write failing geometry, poison-upgrade and tick tests**

```js
test("gadget action poisons the existing smoke template instead of creating a second one", async () => {
  const zone = await service.registerTemplate({ instanceId: "g1", template: smokeTemplate() });
  await service.poisonTemplate("g1");
  assert.equal(scene.templates.size, 1);
  assert.equal(zone.flags[MODULE_ID].craftsmanSmoke.poisoned, true);
});

test("gadget action creates one poisoned cloud after activation placement was cancelled", async () => {
  await service.poisonTemplate("g1", poisonPlacementContext());
  assert.equal(scene.templates.size, 1);
  assert.equal(onlyTemplate().flags[MODULE_ID].craftsmanSmoke.poisoned, true);
});

test("active GM damages only tokens that start their turn inside poisoned smoke", async () => {
  await service.handleCombatTurn(combatFor(insideToken));
  assert.deepEqual(damageCalls, [{ actor: insideToken.actor, amount: craftsmanLevel, type: "poison" }]);
});
```

- [ ] **Step 2: Run zone tests and verify RED**

Run: `node --test tests/craftsman-gadget-zone-service.test.mjs`

Expected: FAIL with missing zone service.

- [ ] **Step 3: Implement one managed 15-foot rectangular zone**

The activation Activity uses a native `rect` template with `size = 15`, adjacent placement, and expiry at the owner's next turn. `registerTemplate` records the created template from `results.templates`. `poisonTemplate` updates that same document. If activation placement was cancelled, the action reuses its canonical Activity, owner Token, adjacent `15 × 15` geometry and owner-turn expiry to place exactly one already-poisoned cloud. It never creates a second cloud while the first exists.

- [ ] **Step 4: Implement membership, visibility contract, tick and cleanup**

Use template bounds plus token centre for deterministic membership. `isSightObscured(sourceToken, targetToken)` returns true when either endpoint or their centre line intersects the managed zone. Wire that predicate into the existing attack visibility/advantage resolver and reaction visibility checks for both native and MIDI attacks; add a regression proving attacks through the cloud receive the normal unseen-attacker/unseen-target treatment while unrelated attacks are unchanged. Only active GM applies poison damage at start of a contained token's turn. Delete the template on owner-turn expiry, Item deletion, scene deletion or instance spending.

- [ ] **Step 5: Run zone and service tests**

Run: `node --test tests/craftsman-gadget-zone-service.test.mjs tests/craftsman-gadget-service.test.mjs`

Expected: PASS with one area per gadget instance and no double GM tick.

- [ ] **Step 6: Commit the smoke zone**

```powershell
git add scripts/combat/craftsman-gadget-zone-service.js scripts/combat/craftsman-gadget-service.js tests/craftsman-gadget-zone-service.test.mjs tests/craftsman-gadget-service.test.mjs
git commit -m "feat(craftsman): automate smoke gadget zones"
```

### Task 6: Mechanic Vehicle Adapter and Breakdown Contract

**Files:**
- Create: `scripts/combat/craftsman-vehicle-service.js`
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Test: `tests/craftsman-vehicle-service.test.mjs`

**Interfaces:**
- Produces: `bindResearchObject(ownerActor, vehicleUuid)`, `resolveResearchObject(ownerActor)`, `readVehicleState(vehicle)`, `activateVehicleGadget`, `rollBreakdown`, `offerEmergencyReroll`.
- Persists owner flag: `flags.rebreya-main.craftsman.researchObjectUuid`.
- Persists vehicle flag: `flags.rebreya-main.vehicleState = { acceleration, breakdownThreshold }`.
- Emits: `Hooks.callAll("rebreya.vehicleBreakdownRoll", context)`.

- [ ] **Step 1: Write failing binding, speed and roll tests**

```js
test("Mechanic binding accepts only an owned vehicle Actor", async () => {
  await service.bindResearchObject(owner, vehicle.uuid);
  assert.equal(owner.flags[MODULE_ID].craftsman.researchObjectUuid, vehicle.uuid);
  await assert.rejects(service.bindResearchObject(owner, character.uuid), /vehicle/u);
});

test("breakdown defaults to 2, applies regulator minus one, and emits the chosen roll", async () => {
  const context = await service.rollBreakdown(vehicle, { regulator: true, roll: fixedRoll(7) });
  assert.equal(context.baseThreshold, 2);
  assert.equal(context.effectiveThreshold, 1);
  assert.equal(emitted.at(-1).name, "rebreya.vehicleBreakdownRoll");
});
```

- [ ] **Step 2: Run vehicle tests and verify RED**

Run: `node --test tests/craftsman-vehicle-service.test.mjs`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement canonical binding and state readers**

Resolve UUIDs through injected `fromUuid`. Require `actor.type === "vehicle"` and ownership before writing. Store optional `acceleration` and `breakdownThreshold`; read native combat speeds from `system.attributes.movement` and explicit travel speeds from `system.attributes.travel.speeds` without overwriting units or pace.

- [ ] **Step 4: Implement Afterburner Injector changes**

On activation, add `10` to `vehicleState.acceleration` when it is numeric; otherwise add `10` to each non-zero native speed source. Its gadget action adds `10 * owner.system.attributes.prof` to each speed until end of the current turn, then removes only its managed effect and calls `rollBreakdown(vehicle, { sourceInstanceId })`.

- [ ] **Step 5: Implement Emergency Regulator and public roll context**

The passive effect derives `effectiveThreshold = Math.max(0, baseThreshold - 1)`. The action rolls a second `1d20`, shows both totals through `DialogV2`, records the chosen total, creates a chat card, then emits:

```js
Hooks.callAll("rebreya.vehicleBreakdownRoll", {
  vehicleUuid: vehicle.uuid,
  baseThreshold,
  effectiveThreshold,
  rolls: [first.total, second.total],
  selectedTotal,
  sourceInstanceId
});
```

No success/failure or damage is inferred.

- [ ] **Step 6: Run vehicle and gadget tests**

Run: `node --test tests/craftsman-vehicle-service.test.mjs tests/craftsman-gadget-service.test.mjs`

Expected: PASS; unavailable/deleted vehicles fail closed and no unrelated vehicle fields change.

- [ ] **Step 7: Commit the Mechanic adapter**

```powershell
git add scripts/combat/craftsman-vehicle-service.js scripts/combat/craftsman-gadget-service.js tests/craftsman-vehicle-service.test.mjs tests/craftsman-gadget-service.test.mjs
git commit -m "feat(craftsman): automate Mechanic vehicle gadgets"
```

### Task 7: Hook Wiring, Composition, and Regression Verification

**Files:**
- Create: `scripts/integrations/craftsman-gadget-hooks.js`
- Create: `scripts/integrations/craftsman-rest-orchestrator.js`
- Modify: `scripts/main.js`
- Test: `tests/craftsman-gadget-hooks.test.mjs`
- Test: `tests/main-composition-root.test.mjs`
- Test: `tests/module-manifest.test.mjs`

**Interfaces:**
- Consumes all services from Tasks 2, 5 and 6.
- Produces idempotent `registerCraftsmanGadgetHooks(moduleApi)`.

- [ ] **Step 1: Write failing hook and composition tests**

```js
test("Craftsman gadget hooks register exactly once", () => {
  registerCraftsmanGadgetHooks(moduleApi);
  registerCraftsmanGadgetHooks(moduleApi);
  assert.equal(count("dnd5e.preUseActivity"), 1);
  assert.equal(count("dnd5e.rollAttack"), 1);
  assert.equal(count("dnd5e.preRollDamage"), 1);
});
```

- [ ] **Step 2: Run integration tests and verify RED**

Run: `node --test tests/craftsman-gadget-hooks.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs`

Expected: FAIL on missing registration and service composition.

- [ ] **Step 3: Register exact hooks with guarded error handling**

Register `dnd5e.preUseActivity`, `dnd5e.postUseActivity`, `dnd5e.preRollAttack`, `dnd5e.rollAttack`, `dnd5e.preRollDamage`, `dnd5e.preCreateActivityTemplate`, `dnd5e.applyDamage`, `midi-qol.preAttackRoll`, `midi-qol.hitsChecked`, `midi-qol.preDamageRoll`, `midi-qol.preDamageRollComplete`, `midi-qol.RollComplete`, `combatTurnChange`, `updateWorldTime`, `updateToken`, `deleteItem`, `deleteActor`, `deleteMeasuredTemplate`, `deleteScene` and `canvasReady`. Each listener delegates only to the owning service and returns `false` solely when that service explicitly rejects an activity. Native and MIDI paths share one instance/turn idempotency key so advantage, damage and conditional AC cannot be applied twice.

Register `dnd5e.restCompleted` only in `CraftsmanRestOrchestrator`. Its awaited queue first completes `craftsmanGadgetService.handleRestCompleted`, including its `DialogV2`, and only then calls `craftsmanConstructorService.handleRestCompleted`. Test that the gadget dialog closes before native construct placement begins and that two rest events for the same Actor do not open parallel windows.

- [ ] **Step 4: Compose services in `RebreyaMainModule`**

```js
this.craftsmanVehicleService = new CraftsmanVehicleService({
  coordinator: this.worldMutationCoordinator,
  fromUuid: (uuid) => globalThis.fromUuid(uuid)
});
this.craftsmanGadgetZoneService = new CraftsmanGadgetZoneService({ isActiveGmClient });
this.craftsmanGadgetService = new CraftsmanGadgetService(this, {
  coordinator: this.worldMutationCoordinator,
  vehicleService: this.craftsmanVehicleService,
  zoneService: this.craftsmanGadgetZoneService
});
```

Call `registerCraftsmanGadgetHooks(moduleApi)` beside existing combat integration registration, then register the single rest orchestrator shared with Constructor. Add cache-busting query strings consistent with `main.js` conventions.

- [ ] **Step 5: Run all focused and full tests**

Run: `node --test tests/craftsman-gadget-definitions.test.mjs tests/craftsman-gadget-service.test.mjs tests/craftsman-gadget-zone-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-vehicle-service.test.mjs tests/classes-compendium.test.mjs tests/combat-attack-service.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs`

Expected: all focused tests PASS.

Run: `node --test`

Expected: full module suite PASS with zero failures.

- [ ] **Step 6: Commit integration**

```powershell
git add scripts/integrations/craftsman-gadget-hooks.js scripts/main.js tests/craftsman-gadget-hooks.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
git commit -m "feat(craftsman): wire gadget automation"
```
