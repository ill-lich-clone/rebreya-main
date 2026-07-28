# Mechanical Implant Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict installation requirements, idempotent reconciliation, and explicit automation for the 36 supported mechanical implants while retaining one aggregate `Импланты` Active Effect.

**Architecture:** A pure registry resolves automation by `flags.rebreya-main.gearId`, validates requirements, and compiles installed implants into aggregate effect changes and capabilities. `ImplantService` owns installation and reconciliation; a focused runtime service consumes compiled capabilities through existing Foundry/D&D5e hooks without creating per-implant effects.

**Tech Stack:** Foundry VTT 13, D&D5e 5.2.5, native ES modules, `node:test`, existing Rebreya attack/hand/rest/status/crafting services.

## Global Constraints

- Work only on `lich_branch`; never commit or push to `main`/`master`.
- Run `git fetch origin` and stop on foreign uncommitted changes or divergence from current `origin/main`.
- Do not use force push.
- Do not automate `Волшебные`, `Древняя`, `Титаническая`, civilian prostheses, shells, incomplete super-heavy rows, or transport-node effects.
- Transport-node compatibility for Ironborn must remain unchanged.
- All persistent implant changes belong to the single aggregate Active Effect `Импланты`.
- Closing the long-rest dialog skips the step and lets the pipeline continue.
- No migration is required while the feature remains under test.
- Tests are written and observed failing before production changes.

---

### Task 1: Explicit registry and strict requirements

**Files:**
- Create: `scripts/data/implant-automation-registry.js`
- Create: `tests/implant-automation-registry.test.mjs`
- Modify: `tests/implants-catalog.test.mjs`

**Interfaces:**
- Consumes: actor documents, Item flags `gearId` and `implant`.
- Produces:
  - `SUPPORTED_MECHANICAL_IMPLANT_IDS: ReadonlySet<string>`
  - `getMechanicalImplantDefinition(item): object | null`
  - `evaluateMechanicalImplantRequirements(actor, item): { satisfied: boolean, failures: string[] }`
  - `compileMechanicalImplants(actor, planned): { changes, actorFlags, capabilities, warnings }`

- [ ] **Step 1: Write the failing catalog coverage test**

Assert that the registry contains exactly the 36 IDs belonging to installable `Военная`, `Общая`, and `Сверхтяжёлая` rows, and contains none of the magic or transport IDs:

```js
assert.equal(SUPPORTED_MECHANICAL_IMPLANT_IDS.size, 36);
assert.equal(SUPPORTED_MECHANICAL_IMPLANT_IDS.has("navesnaya-bronya"), true);
assert.equal(SUPPORTED_MECHANICAL_IMPLANT_IDS.has("kozha-krakena"), false);
assert.equal(SUPPORTED_MECHANICAL_IMPLANT_IDS.has("kolyaska-dlya-mototsikla"), false);
```

- [ ] **Step 2: Run the registry test and verify the missing module failure**

Run: `node --test tests/implant-automation-registry.test.mjs`

Expected: FAIL because `implant-automation-registry.js` does not exist.

- [ ] **Step 3: Add the 36 explicit registry entries**

Each entry contains `id`, `requirements`, and one or more declarative capability keys. Do not parse `implant.effect` or `implant.requirements` at runtime.

```js
export const SUPPORTED_MECHANICAL_IMPLANT_IDS = new Set([
  "nastroennye-servoprivody",
  "sokrushitelnye-konechnosti",
  "pomoshch-v-postroenii-traektorii",
  "dopolnitelnaya-konechnost",
  "kondensator-magii",
  "impulsnye-nogi",
  "modul-chuvstva-zhizni",
  "ultrazvukovye-datchiki",
  "modul-pareniya",
  "telepaticheskiy-modul",
  "silnye-nogi",
  "mekhanizm-perezaryadki-oruzhiya",
  "velikoe-khranilishche-energii",
  "sintezator-yada",
  "monolitnoe-telo",
  "otkalibrovannye-servoprivody",
  "navesnaya-bronya",
  "vstroennyy-stanok",
  "modul-nochnogo-zreniya",
  "impulsnye-dvigateli",
  "modul-s-preparatami",
  "sistema-termokontrolya",
  "ukreplyonnye-sustavy",
  "modul-ukrepleniya-tela",
  "mnogofunktsionalnyy-zakhvat",
  "razrisovannyy-korpus",
  "usilennye-ladoni",
  "krepkiy-sharnir",
  "magnitnaya-ladon",
  "mozg-chudovishcha",
  "raketnaya-tyaga",
  "modul-vosstanovleniya",
  "konteyner-dlya-familyara",
  "simbioticheskiy-mozg",
  "ruka-boga",
  "khranilishche-neveroyatnoy-pronitsatelnosti"
]);
```

- [ ] **Step 4: Add failing requirement tests**

Cover every non-empty requirement:

```js
assert.deepEqual(failuresFor("sokrushitelnye-konechnosti", { str: 12 }), ["Требуется Сила 13"]);
assert.deepEqual(failuresFor("pomoshch-v-postroenii-traektorii", { int: 12 }), ["Требуется Интеллект 13"]);
assert.deepEqual(failuresFor("kondensator-magii", { spellcasting: false }), ["Требуется использование заклинаний"]);
assert.deepEqual(failuresFor("modul-pareniya", { fly: 0 }), ["Требуется скорость полёта"]);
assert.deepEqual(failuresFor("konteyner-dlya-familyara", { familiar: false }), ["Требуется доступ к фамильяру"]);
assert.deepEqual(failuresFor("ruka-boga", { int: 13, con: 13 }), [
  "Требуется Интеллект 14",
  "Требуется Телосложение 14"
]);
```

Spellcasting is satisfied by a cast-capable class or spellcasting activity. Familiar access is satisfied by a `find-familiar` spell/activity, a module-managed familiar feature, or an owned familiar actor linked to the character.

- [ ] **Step 5: Implement requirement evaluation and run the test**

Run: `node --test tests/implant-automation-registry.test.mjs tests/implants-catalog.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the registry**

```text
feat: define mechanical implant automation registry
```

### Task 2: Installation counts, validation, and reconciliation

**Files:**
- Modify: `scripts/data/implant-service.js`
- Create: `scripts/integrations/implant-hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/implant-service.test.mjs`
- Create: `tests/implant-hooks.test.mjs`

**Interfaces:**
- Consumes: Task 1 registry functions.
- Produces:
  - `ImplantService.validateLoadout(actor, selections)`
  - `ImplantService.reconcileActor(actor, { reason } = {})`
  - installation state `{ installed, installedCount, united, spentPoints }`
  - `registerImplantHooks(moduleApi)`

- [ ] **Step 1: Write failing installation tests**

Tests must prove:

```js
await assert.rejects(
  service.applyLoadout(actorWithInt(12), install("pomoshch-v-postroenii-traektorii")),
  /Требуется Интеллект 13/u
);
assert.equal(actor.itemUpdates.length, 0);
assert.equal(actor.effectCreates.length, 0);
```

Also cover spellcasting, flight, familiar access, multiple simultaneous failures, and a valid installation.

- [ ] **Step 2: Run the focused test and verify it fails for missing validation**

Run: `node --test tests/implant-service.test.mjs`

Expected: FAIL because the current service ignores requirements.

- [ ] **Step 3: Validate the complete loadout before writes**

Build all planned states, validate compatibility, cost, count, and requirements, then perform Item/effect writes. A failed requirement must leave the actor unchanged.

- [ ] **Step 4: Add failing stack-count tests**

For `Дополнительная конечность`, assert `installedCount` can range from zero to `system.quantity` and consumes two points per count. Other implants reject `installedCount > 1`.

- [ ] **Step 5: Implement count-aware installation**

Read legacy `installed: true` as count one. Write both `installed` and `installedCount`; no world migration is created.

- [ ] **Step 6: Add failing reconciliation tests**

Cover:

- deleting an installed implant removes its aggregate change;
- lowering an attribute below a requirement disables the implant and records a warning;
- race/class/BM changes recompute capacity and compatibility;
- repeated reconciliation produces identical changes and no duplicate effects.

- [ ] **Step 7: Implement `reconcileActor` and hook registration**

Register bounded, debounced handlers for `createItem`, `updateItem`, `deleteItem`, `updateActor`, `ready`, and actor restoration. Ignore unrelated updates and prevent re-entry from the service’s own writes.

- [ ] **Step 8: Run focused tests**

Run: `node --test tests/implant-service.test.mjs tests/implant-hooks.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit validation and reconciliation**

```text
feat: validate and reconcile installed implants
```

### Task 3: Aggregate passive bonuses

**Files:**
- Modify: `scripts/data/implant-automation-registry.js`
- Modify: `scripts/data/implant-service.js`
- Modify: `tests/implant-automation-registry.test.mjs`
- Modify: `tests/implant-service.test.mjs`

**Interfaces:**
- Consumes: installed effective definitions.
- Produces: deterministic aggregate `changes` and `actorFlags`.

- [ ] **Step 1: Write failing compiler tests**

Cover these direct bonuses:

- Dexterity `+2`, cap 22;
- Strength floor 19;
- weapon attacks `+1`;
- Strength-save advantage;
- Dexterity-save advantage;
- AC `+1`;
- darkvision minimum 60;
- blindsight minimum 10;
- walking speed `+10`;
- Constitution checks/saves `+1`;
- carrying-strength bonus `+2`;
- Intelligence `+1`, cap 20, after other modifiers;
- Intelligence checks and initiative `+2`;
- hover and telepathy capability flags;
- extreme-temperature adaptation.

Assert deterministic ordering and no duplicate change keys.

- [ ] **Step 2: Run the compiler test and verify missing changes**

Run: `node --test tests/implant-automation-registry.test.mjs`

Expected: FAIL on the first unsupported bonus.

- [ ] **Step 3: Implement compilation**

Use Active Effect changes only for native stable fields/formulas. Cap/floor calculations and rules without native fields are emitted as managed capability flags and consumed by focused prepare/roll hooks. Never mutate already prepared values as a new baseline.

- [ ] **Step 4: Prove one aggregate effect**

Install all passive implants and assert exactly one managed effect contains all native changes. Remove half and assert the same effect is updated, not recreated.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/implant-automation-registry.test.mjs tests/implant-service.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit passive automation**

```text
feat: compile passive mechanical implant bonuses
```

### Task 4: Hand, weapon, and movement capabilities

**Files:**
- Create: `scripts/combat/implant-automation-service.js`
- Create: `scripts/integrations/implant-automation-hooks.js`
- Modify: `scripts/main.js`
- Modify: `scripts/data/hero-doll-service.js`
- Modify: `scripts/combat/attack-service.js`
- Create: `tests/implant-automation-service.test.mjs`
- Modify: `tests/hero-doll-service.test.mjs`
- Modify: `tests/combat-attack-service.test.mjs`

**Interfaces:**
- Consumes: compiled actor capability flags.
- Produces handlers for hands, attack modifiers, movement state, grapple/shove, reload, jumping, falling, and climbing.

- [ ] **Step 1: Write failing tests for secondary hands**

One installed extra limb adds one secondary hand. It can carry/use a light weapon and manipulate tiny objects, but cannot satisfy a non-light weapon requirement.

- [ ] **Step 2: Implement hand-service integration and verify**

Run: `node --test tests/hero-doll-service.test.mjs tests/implant-automation-service.test.mjs`

- [ ] **Step 3: Write failing attack tests**

Cover weapon-only `+1`, `+2` grapple/shove, magnetic-palm action validation, poison-synthesizer attack replacement, and reload without a free hand only for the loaded implant hand.

- [ ] **Step 4: Implement attack-service adapters and verify**

Run: `node --test tests/combat-attack-service.test.mjs tests/implant-automation-service.test.mjs`

- [ ] **Step 5: Write failing movement tests**

Cover:

- impulse legs remember zero movement in the previous turn and offer doubled speed for the current turn;
- jump distance/height doubles;
- fall damage absorption subtracts 30;
- reinforced palms satisfy the climbing hand;
- hover only operates with flight.

- [ ] **Step 6: Implement movement handlers and verify**

Run: `node --test tests/implant-automation-service.test.mjs`

- [ ] **Step 7: Commit physical capability automation**

```text
feat: automate implant hands attacks and movement
```

### Task 5: Senses, tools, environment, and status automation

**Files:**
- Modify: `scripts/combat/implant-automation-service.js`
- Modify: `scripts/integrations/implant-automation-hooks.js`
- Modify: `scripts/data/implant-service.js`
- Modify: `tests/implant-automation-service.test.mjs`
- Modify: `tests/implant-service.test.mjs`

**Interfaces:**
- Consumes: actor capabilities and existing `CombatStatusService`.
- Produces: life-sense visibility, tool choices, thermoregulation, potion binding, and painted-body status.

- [ ] **Step 1: Write failing sense tests**

Life sense returns living invisible tokens within 30 feet unless protected from divination and blocks their Hide attempt against the owner. Ultrasound and night vision preserve stronger existing senses.

- [ ] **Step 2: Implement senses and verify**

Run: `node --test tests/implant-automation-service.test.mjs`

- [ ] **Step 3: Write failing long-rest choice tests**

`Встроенный станок` adds a choice inside the existing implant rest step, persists one artisan-tool ID, and applies `+2` only to that tool. Closing the step changes neither loadout nor tool choice.

- [ ] **Step 4: Implement tool and potion choices**

Add the two-tool check path for `Многофункциональный захват`. Add one-minute potion binding and no-action use during the owner’s turn.

- [ ] **Step 5: Add and implement status/environment tests**

Cover extreme heat/cold adaptation and `Спровоцированный 1` at turn start for readable creatures within 10 feet. Reuse the shared status service.

- [ ] **Step 6: Commit utility automation**

```text
feat: automate implant senses tools and utilities
```

### Task 6: Timed and resource-based military implants

**Files:**
- Modify: `scripts/combat/implant-automation-service.js`
- Modify: `scripts/integrations/implant-automation-hooks.js`
- Modify: `scripts/data/implant-service.js`
- Modify: `tests/implant-automation-service.test.mjs`

**Interfaces:**
- Consumes: combat turns, damage events, world time, and long-rest pipeline.
- Produces: spell-slot capacity, electrical charge, poison dice pool, and resource recovery.

- [ ] **Step 1: Write failing spell condenser tests**

Selected points 1–5 create one extra slot at that level, never above the actor’s highest available spell level, and removal restores the original slot maximum without consuming ordinary slots.

- [ ] **Step 2: Implement condenser state and verify**

- [ ] **Step 3: Write failing electrical storage tests**

At least one lightning damage records an active-hour expiry. `+3` applies only to the Constitution save created for extra-work and not to ordinary Constitution saves.

- [ ] **Step 4: Implement damage/time integration and verify**

- [ ] **Step 5: Write failing poison synthesizer tests**

Assert a 12-die pool, 1–6 spend, class DC, Constitution save, poison damage, half on success, bonus-action and attack-replacement activities, one die per elapsed hour, and no recovery beyond 12.

- [ ] **Step 6: Implement poison activities and recovery**

Run: `node --test tests/implant-automation-service.test.mjs`

- [ ] **Step 7: Commit timed military automation**

```text
feat: automate implant charges and poison systems
```

### Task 7: Super-heavy implant systems

**Files:**
- Modify: `scripts/combat/implant-automation-service.js`
- Modify: `scripts/integrations/implant-automation-hooks.js`
- Modify: `scripts/data/implant-service.js`
- Modify: `scripts/data/crafting-service.js`
- Modify: `scripts/data/downtime-service.js`
- Modify: `tests/implant-automation-service.test.mjs`
- Modify: `tests/crafting-service.test.mjs`
- Modify: `tests/downtime-service.test.mjs`

**Interfaces:**
- Consumes: compiled super-heavy capabilities.
- Produces: flight resource, regeneration, familiar containment, symbiotic spells, crafting allowance, and insight storage.

- [ ] **Step 1: Write and implement rocket-thrust tests**

Cover 60 minutes, minimum one minute per activation, fly speed equal to walking speed, 30-foot descent on exhaustion, and 10 minutes restored per six unused hours.

- [ ] **Step 2: Write and implement regeneration tests**

At turn start, heal one only when current HP is greater than one and below maximum.

- [ ] **Step 3: Write and implement familiar-container tests**

Only a linked small/tiny familiar can enter. While contained it has full cover and is restored when the implant is removed.

- [ ] **Step 4: Write and implement symbiotic-brain tests**

Persist one wizard spell choice at levels 1 and 2. Each has one independent free cast per long rest, Intelligence casting, and can still consume normal slots.

- [ ] **Step 5: Write and implement crafting-hand tests**

Increase ordinary craft investment by 5 gp and construct craft investment by 10 gp without changing unrelated downtime limits.

- [ ] **Step 6: Write and implement insight-storage tests**

Cover 10000 gp deposit cap, nonmagical item/component withdrawal, diamond rejection, seven potion-level budget, and the one-week restock downtime unlocked only at zero balance.

- [ ] **Step 7: Run focused tests**

Run: `node --test tests/implant-automation-service.test.mjs tests/crafting-service.test.mjs tests/downtime-service.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit super-heavy automation**

```text
feat: automate super-heavy implant systems
```

### Task 8: UI feedback and complete verification

**Files:**
- Modify: `templates/modification-tab.hbs`
- Modify: `scripts/data/implant-service.js`
- Modify: `styles/main.css`
- Modify: `tests/implant-sheet-integration.test.mjs`
- Modify: `tests/implant-service.test.mjs`

**Interfaces:**
- Consumes: requirement results, compiled warnings, resource summaries.
- Produces: visible requirement failures and installed capability/resource summaries.

- [ ] **Step 1: Write failing UI tests**

Assert snapshots expose `requirementsSatisfied`, `requirementFailures`, `installedCount`, and resource summaries. Disabled rest-dialog controls display the exact failures.

- [ ] **Step 2: Implement UI context without replacing native inventory rows**

The modification tab continues to render real Foundry Items. Requirement/resource information is added around or within supported native row context; no short custom item cards are introduced.

- [ ] **Step 3: Run focused implant tests**

Run:

```text
node --test tests/implant-automation-registry.test.mjs tests/implant-service.test.mjs tests/implant-hooks.test.mjs tests/implant-automation-service.test.mjs tests/implant-sheet-integration.test.mjs tests/implants-catalog.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run diff and full-suite verification**

Run:

```text
git diff --check
node --test tests/*.test.mjs
```

Expected: zero diff errors and zero failing tests.

- [ ] **Step 5: Review final diff**

Confirm:

- no magic or transport automation definitions;
- no per-implant Active Effects;
- strict requirements run before writes;
- reconciliation is idempotent;
- all 36 IDs have tested behavior;
- unrelated user changes are absent.

- [ ] **Step 6: Commit and push**

```text
feat: automate mechanical implant bonuses
```

Push `lich_branch` to `origin` without force.
