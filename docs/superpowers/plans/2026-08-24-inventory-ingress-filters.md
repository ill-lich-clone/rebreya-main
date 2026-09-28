# Inventory Ingress Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Провести только новые Item, фактически поступающие в инвентарь зарегистрированной dnd5e-группы из Lootgen, хранилища или внешнего drag-and-drop/import, через непересекающиеся group-scoped правила с действиями `folder`, `skip` и `dismantle`.

**Architecture:** Чистые descriptor/rule helpers в `scripts/data/` нормализуют типизированный DSL, доказывают отсутствие пересечений и компилируют индексированный matcher без Foundry globals. `InventoryIngressPlanner` строит detached preview и минимальный choice payload, а active GM внутри общей group-organization serialization boundary заново читает source/rules/folders, пересчитывает plan и исполняет один journaled batch через `InventoryService`; Lootgen, Storage и import остаются source-владельцами списания. Единственный `InventoryApp` получает встроенный редактор и drag preview, а composition root регистрирует exact typed commands и один scoped refresh на batch.

**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, ApplicationV2/Handlebars, `DialogV2`, `SocketCommandBus`, `WorldMutationCoordinator`, `DurableMutationJournal`, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-24-inventory-ingress-filters-design.md` at commit `9b41e13` — прочитать полностью перед реализацией.

## Global Constraints

- Работать только в `lich_branch`; не коммитить и не пушить в `main`/`master`, не использовать force push.
- Перед первой правкой выполнить обязательный Git preflight из `AGENTS.md`; при чужих незакоммиченных пересекающихся изменениях, отставании `origin/lich_branch` или конфликтующей актуальной основе остановиться.
- Foundry VTT `13`, dnd5e и обязательный `statuscounter >= 3.0.4` остаются неизменными.
- Единственный источник правил — `flags["rebreya-main"].inventoryIngressRules` Group Actor; не вкладывать правила в `inventoryFolders` и не писать world-state из UI.
- Не создавать второй Inventory ApplicationV2, parallel repository, legacy socket route для новой операции или глобальные Item create/update hooks.
- Фильтровать только фактический ingress новых Item из Lootgen, Storage и external import; существующие Item, folder move, quantity update, sale, craft outputs, recovery replay, coins и material outputs не входят в matcher повторно.
- Rule state не имеет порядка, priority или enabled-state; create/update блокируется при любом доказанном либо потенциальном пересечении.
- Active GM повторно валидирует transport sender, participation capability, source identity/quantity/state, `rulesRevision`, requested folder, match, override и dismantle outputs.
- Для matched flow merge ограничен вычисленной целевой папкой; no-match сохраняет текущую legacy merge/target семантику.
- Stable batch mutation ID и `inventoryMutationJournal` не допускают повторной выдачи, material output или source debit при retry.
- Один batch читает rules и компилирует их один раз, строит один descriptor на row, вызывает один `evaluateMany()`, выполняет не более одного typed command dispatch и одного coalesced scoped refresh.
- Runtime `DialogV2` используется только для одиночного `skip` и общего `dismantle` confirmation; cancel закрывает preview без world writes и без dispatch.
- Живые Foundry/browser-тесты запрещены; критерии готовности — Node tests и статические проверки из `AGENTS.md`.
- Каждый новый, изменённый или удалённый метод отражается в разделах 1, 2, 7, 8, 13 и 19 `docs/function-passport.md` по фактически затронутым владельцам; публичный API и typed command table синхронизируются в `README.md`.

## Planned File Structure

| Path | Responsibility |
|---|---|
| `scripts/data/inventory-ingress-rules.js` | Exact rule/state schema, DSL normalization, conflict proof, immutable indexed compiler/cache and `evaluateMany()`; no Foundry globals. |
| `scripts/data/inventory-ingress-descriptor.js` | Canonical detached descriptor and shared dismantle output resolver from canonical Item data/model; no source-origin field and no Foundry globals. |
| `scripts/application/inventory-ingress-planner.js` | One-read/one-compile/one-evaluate detached preview, confirmation model, exact serialized plan and authoritative parity comparison; no world writes. |
| `scripts/data/inventory-service.js` | Actor flag owner, shared organization queue, folder dependency checks, authoritative plan revalidation, target-scoped merge, journal phases and recovery. |
| `scripts/application/loot-claim-service.js` | Batch Lootgen source receipt/claim state; accepted rows and coins exactly once, skipped rows remain unclaimed. |
| `scripts/data/storage-command-service.js` | Storage source resolution/debit, one outer claim command, container handling and the existing escaped receipt with filter suffix. |
| `scripts/ui/inventory-app.js` | Same-app embedded rule editor, local draft validation, stable IDs, confirmation adapter and external drop preview. |
| `templates/inventory-app.hbs`, `styles/main.css` | Compact toolbar action group and embedded rule cards/condition/action controls. |
| `scripts/main.js` | Dependency composition, exact validators, participation authorization, local/typed routes and one batch refresh. |
| `tests/inventory-ingress-rules.test.mjs` | Rule state, DSL, conflicts, matcher immutability/indexing and stress call counts. |
| `tests/inventory-ingress-descriptor.test.mjs` | Descriptor fields, Lootgen/Storage/drop parity and canonical dismantle eligibility/outputs. |
| `tests/inventory-ingress-planner.test.mjs` | Preview, choices, cancel, legacy target preservation and one-per-batch call counts. |
| Existing owner tests named below | Persistence, permissions, commands, UI, source receipts, recovery, refresh and composition without duplicate large harnesses. |

## Stable Cross-Task Contracts

Implement these names and shapes consistently; later tasks consume them exactly.

```js
// scripts/data/inventory-ingress-rules.js
export const INVENTORY_INGRESS_RULES_VERSION = 1;
export const INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS = Object.freeze({
  sourceKind: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  sourceType: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  sourceId: { kind: "identity", operators: ["is", "isNot", "in", "notIn"] },
  documentType: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  systemTypeValue: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  systemTypeSubtype: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  sourceCategory: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  rarity: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  rank: { kind: "number", operators: ["lt", "lte", "eq", "gte", "gt", "between"] },
  durabilityState: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  unitValue: { kind: "number", operators: ["lt", "lte", "eq", "gte", "gt", "between"] },
  unitWeight: { kind: "number", operators: ["lt", "lte", "eq", "gte", "gt", "between"] },
  predominantMaterialId: { kind: "identity", operators: ["is", "isNot", "in", "notIn"] },
  dismantlable: { kind: "boolean", operators: ["is"] }
});

export function createEmptyInventoryIngressRuleState();
export function normalizeInventoryIngressRule(rule);
export function normalizeInventoryIngressRuleState(rawState);
export function describeInventoryIngressRule(rule);
export function findInventoryIngressRuleConflicts(rules);
export function compileInventoryIngressRules(state);
export class InventoryIngressRuleCompilerCache {
  get(groupActorId, state) {}
  clear(groupActorId = "") {}
}
```

`normalizeInventoryIngressRuleState(null)` возвращает `{version:1, revision:0, rules:[]}`. Любое non-null state и каждый rule/condition/action принимаются только с exact keys; неизвестные поля, повтор одного `field`, пустые sets, NaN, reversed `between`, неподходящий value и invalid folder action бросают `InventoryIngressRuleError`. Missing descriptor value никогда не удовлетворяет отрицательному условию. `dismantle` при normalization/compile неявно добавляет constraint `dismantlable is true`.

```js
// scripts/data/inventory-ingress-descriptor.js
export function resolveInventoryDismantleOutputs(itemData, quantity, { model } = {});
export function canResolveInventoryDismantle(itemData, { model } = {});
export function buildInventoryIngressDescriptor(itemData, {
  model,
  dismantlable = canResolveInventoryDismantle(itemData, { model })
} = {});
export function captureInventoryIngressIdentity(descriptor, quantity);
```

`unitValue` — copper integer per unit, `unitWeight` — pounds per unit. `sourceKind` is one of `ordinary|magic|material`; source origin (`lootgen|storage|drop`) never enters descriptor. Managed identity is only the exact pair `sourceType + sourceId`; name is presentation only. `canResolveInventoryDismantle()` performs the cheap canonical material/positive-weight eligibility check needed while the descriptor is built; it does not calculate preview quantities. The full resolver runs only after a dismantle rule matches and returns frozen `[{sourceType:"material", sourceId, name, quantity}]` using the current canonical 50%-weight/floor-to-0.01 rule or an empty array when no positive known output exists.

```js
// scripts/application/inventory-ingress-planner.js
export const INVENTORY_INGRESS_PLAN_VERSION = 1;
export class InventoryIngressPlanner {
  constructor({ readRules, buildDescriptor, resolveDismantleOutputs, compilerCache, confirm });
  preview({ groupActorId, requestedFolderId = null, rows, batch = false });
  collectChoices(preview);
  serialize(preview, { rootOverrideSourceKeys = [] } = {});
  assertParity(serializedPlan, authoritativePreview);
}
```

Каждая detached row имеет exact `{sourceKey, quantity, itemData, legacyFolderId, container}`. Preview row имеет `{sourceKey, identity, quantity, matchedRuleId, action, dismantlePreview}`; `action.type` — `legacy|folder|skip|dismantle`. Serialized plan не содержит `itemData`, material IDs/quantities или arbitrary target; он содержит только version/group/revision/requested target, expected per-row identity/match/action и `rootOverrideSourceKeys`.

```js
// InventoryService public/application surface
getInventoryIngressRuleState({ groupActorId });
createInventoryIngressRule({ groupActorId, operationId, expectedRevision, rule });
updateInventoryIngressRule({ groupActorId, operationId, expectedRevision, rule });
deleteInventoryIngressRule({ groupActorId, operationId, expectedRevision, ruleId });
commitInventoryIngressBatch(request, { resolveRows, debitRow, grantContainer } = {});
```

`commitInventoryIngressBatch()` получает exact `{groupActorId, batchMutationId, sourceOrigin, serializedPlan}`, где `sourceOrigin` — внутренний journal discriminator `lootgen|storage|import|public-model` и никогда не передаётся matcher-у. Active GM вызывает `resolveRows()` внутри `inventory-organization:<groupActorId>`, повторно строит preview и сравнивает его через `assertParity()`. `debitRow()` вызывается только после idempotent target phase; `grantContainer()` используется только для portable container root and subtree и получает authoritative derived folder.

Rule commands:

```text
inventory.ingress-rule.create
inventory.ingress-rule.update
inventory.ingress-rule.delete
```

Party ingress source commands remain one per user operation:

```text
inventory.import                    # extended exact plan payload
inventory.ingress.lootgen           # one row or all rows plus optional coins
storage.claim-row / storage.claim-all # extended with ingressPlan for party only
```

---

### Task 0: Mandatory Git Preflight

**Files:** none.

**Interfaces:** Establishes the only permitted branch/worktree state for all later tasks.

- [ ] **Step 1: Inspect local branch and working copy before opening implementation files**

```powershell
git status --short --branch
git branch --show-current
git fetch origin
```

Expected: branch is exactly `lich_branch`; working copy contains no foreign overlapping changes.

- [ ] **Step 2: Compare both base and collaboration branch after fetch**

```powershell
git rev-list --left-right --count HEAD...origin/main
git log --oneline HEAD..origin/main
git rev-list --left-right --count HEAD...origin/lich_branch
git log --oneline HEAD..origin/lich_branch
```

Expected: `HEAD` is not behind either required remote. Stop and report instead of rebasing, merging or editing when remote `lich_branch` advanced or incoming `main` conflicts with the planned owner files.

- [ ] **Step 3: Confirm the approved design commit and focused baseline**

```powershell
git show -s --format='%h %s' 9b41e13
node --test tests/inventory-folder-tree.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-app-context.test.mjs tests/loot-claim-service.test.mjs tests/lootgen-chat.test.mjs tests/storage-socket.test.mjs tests/storage-transfer-chat.test.mjs tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs
```

Expected: commit is `9b41e13 docs: specify inventory ingress filters`; baseline has `0` failed. Record the actual pass/fail counts in the implementation handoff.

### Task 1: Pure Rule State, DSL, Conflicts and Indexed Matcher

**Files:**
- Create: `scripts/data/inventory-ingress-rules.js`
- Create: `tests/inventory-ingress-rules.test.mjs`

**Interfaces:**
- Consumes: descriptor field names from the Stable Cross-Task Contracts.
- Produces: `InventoryIngressRuleError`, exact normalize/describe/conflict functions, `compileInventoryIngressRules()` and `InventoryIngressRuleCompilerCache` used by every later task.

- [ ] **Step 1: Write failing exact-schema and DSL tests before the helper**

Cover version `1`, empty state, canonical sorting/deduplication of enum values, automatic name, every field/operator, `И` across conditions, `ИЛИ` across values of one enum condition, inclusive/exclusive numeric edges, `between`, boolean, missing descriptor values, input/output immutability, extra keys, duplicate field, empty set, NaN and reversed range. Assert `compileInventoryIngressRules()` rejects a state with unresolved conflicts instead of creating a priority-based runtime matcher.

```js
assert.deepEqual(normalizeInventoryIngressRuleState(null), {
  version: 1,
  revision: 0,
  rules: []
});
assert.throws(
  () => normalizeInventoryIngressRule({
    id: "broken",
    name: "",
    conditions: [{ field: "rank", operator: "between", value: [4, 2] }],
    action: { type: "skip" }
  }),
  (error) => error.code === "invalid-condition-value"
);
```

- [ ] **Step 2: Write failing conservative conflict tests**

Add named cases for equal rules, subset, partial numeric overlap, touching inclusive/exclusive ranges, explicit `sourceId isNot`, potential overlap across unrelated fields and implicit `dismantlable=true`. Assert the error details name both rules and the constraints that remained intersectable.

```js
assert.deepEqual(findInventoryIngressRuleConflicts([specificSword, broadWeapon]), [{
  leftRuleId: "specific-sword",
  rightRuleId: "broad-weapon",
  intersectingFields: ["documentType", "sourceId"]
}]);
assert.deepEqual(findInventoryIngressRuleConflicts([specificSword, weaponExceptSword]), []);
```

- [ ] **Step 3: Write failing matcher/cache/performance call-count tests**

Build 300 conflict-free exact managed-identity rules and 5,000 detached descriptors. Assert one or zero result per descriptor, frozen compiled state/results, same cache object for same `groupActorId+revision`, new object after revision, and candidate count bounded to exact-identity plus applicable broad buckets rather than `rules × rows`. Do not use wall-clock thresholds.

```js
const compiled = compileInventoryIngressRules(state);
const candidateChecks = descriptors.reduce(
  (sum, descriptor) => sum + compiled.candidateRuleIds(descriptor).length,
  0
);
const decisions = compiled.evaluateMany(descriptors);
assert.equal(decisions.length, descriptors.length);
assert.ok(candidateChecks < descriptors.length * 6);
assert.equal(decisions.filter(Boolean).length, descriptors.length);
```

- [ ] **Step 4: Run the new test and verify the missing-module failure**

Run: `node --test tests/inventory-ingress-rules.test.mjs`

Expected: FAIL because `scripts/data/inventory-ingress-rules.js` does not exist.

- [ ] **Step 5: Implement the minimal pure engine and indexes**

Normalize enum/identity conditions to frozen include/exclude sets, numbers to `{min,max,minInclusive,maxInclusive}`, booleans to exact values and `dismantle` to the additional boolean constraint. Conflict proof returns non-conflict only when at least one shared field has a provably empty intersection. Compiler returns a frozen `{candidateRuleIds(descriptor), evaluateMany(descriptors)}` surface and builds indexes for managed `sourceType+sourceId`, `sourceKind`, `documentType`, type/subtype, category and durability; numeric predicates run only on the resulting candidate union. The explicit candidate projection provides deterministic call-count evidence without mutable diagnostics on the immutable compiled object.

- [ ] **Step 6: Run focused tests and commit only the new owner files**

```powershell
node --test tests/inventory-ingress-rules.test.mjs
git diff --check
git add scripts/data/inventory-ingress-rules.js tests/inventory-ingress-rules.test.mjs
git commit -m "feat: add inventory ingress rule engine"
```

Expected: focused test has `0` failed; `git diff --check` is clean.

### Task 2: Canonical Descriptor and Dismantle Resolver

**Files:**
- Create: `scripts/data/inventory-ingress-descriptor.js`
- Create: `tests/inventory-ingress-descriptor.test.mjs`
- Modify: `scripts/data/inventory-service.js:3804-3990,5259-5315`
- Modify: `tests/inventory-mutation-recovery.test.mjs:31-410`

**Interfaces:**
- Consumes: current managed flags and model maps from `InventoryService.buildLootgenItemData()`.
- Produces: `buildInventoryIngressDescriptor()`, `captureInventoryIngressIdentity()`, `canResolveInventoryDismantle()` and `resolveInventoryDismantleOutputs()` for planner/commit; existing manual `breakItemToMaterial()` delegates to the same resolver without entering filter ingress.

- [ ] **Step 1: Write failing descriptor field and parity tests**

Construct one canonical managed gear ItemData, then wrap it as a Lootgen row, persisted Storage row and external drop Item clone. Project each through the same canonical ItemData adapter and assert equality of all match fields; separately assert that wrapper/source-origin keys and name changes do not enter managed identity.

```js
assert.deepEqual(lootgenDescriptor, storageDescriptor);
assert.deepEqual(storageDescriptor, dropDescriptor);
assert.deepEqual(captureInventoryIngressIdentity(dropDescriptor, 2), {
  sourceType: "gear",
  sourceId: "gear-sword-1",
  documentType: "weapon",
  durabilityState: "broken",
  quantity: 2
});
assert.equal("origin" in dropDescriptor, false);
```

In `inventory-mutation-recovery.test.mjs`, exercise the production adapters rather than only three prebuilt clones: canonical Lootgen row through `buildLootgenItemData(row)`, persisted Storage row through `buildLootgenItemData(row,{allowPersistedItemData:true})`, and external Item `toObject()` must feed identical descriptor match fields when their managed identity/data are equal. Cover `ordinary|magic|material`, rarity object/string, rank, canonical category, missing subtype, copper denomination conversion, pound weight, predominant material and every durability state including `ineligible`.

- [ ] **Step 2: Write failing canonical dismantle tests**

Assert current formula, no output for zero weight/unknown material/container, a nonempty frozen result for eligible gear and `descriptor.dismantlable` parity. Assert outputs are detached plain data and contain no Item Document.

```js
assert.deepEqual(resolveInventoryDismantleOutputs(swordData, 2, { model }), [{
  sourceType: "material",
  sourceId: "iron",
  name: "Железо",
  quantity: 3
}]);
assert.equal(canResolveInventoryDismantle(swordData, { model }), true);
assert.equal(buildInventoryIngressDescriptor(unknownMaterialData, {
  model
}).dismantlable, false);
```

For the final assertion, use a second ItemData fixture with unknown material or zero unit weight; separately assert the eligible `swordData` descriptor reports `dismantlable:true` before full outputs are calculated.

- [ ] **Step 3: Verify tests fail before implementation**

Run: `node --test tests/inventory-ingress-descriptor.test.mjs tests/inventory-mutation-recovery.test.mjs`

Expected: new descriptor import fails while the existing recovery suite remains green.

- [ ] **Step 4: Implement projection and replace duplicate manual-break resolution**

Use direct reads of fixed known paths rather than `foundry.utils.getProperty`. Resolve model entries only by stable managed flags; name may supply presentation text but must not create `sourceType+sourceId`. Share one internal material-profile resolver between `canResolveInventoryDismantle()` and `resolveInventoryDismantleOutputs()` so descriptor eligibility and later preview cannot diverge. Change `breakItemToMaterial()` to call the full resolver, materialize its canonical outputs through existing `#buildMaterialItemData/#upsertInventoryItem`, and keep this explicit old-item action outside `commitInventoryIngressBatch()`.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node --test tests/inventory-ingress-descriptor.test.mjs tests/inventory-mutation-recovery.test.mjs
git diff --check
git add scripts/data/inventory-ingress-descriptor.js scripts/data/inventory-service.js tests/inventory-ingress-descriptor.test.mjs tests/inventory-mutation-recovery.test.mjs
git commit -m "feat: add canonical inventory ingress descriptors"
```

### Task 3: Group Rule Persistence, Organization Serialization and Permissions

**Files:**
- Modify: `scripts/data/inventory-service.js:3382-3482,4288-4390`
- Modify: `scripts/main.js:703-780,1422-1535,1694-1735,4680-4930`
- Modify: `tests/group-inventory-migration.test.mjs:359-760`
- Modify: `tests/inventory-folder-socket.test.mjs:231-580`

**Interfaces:**
- Consumes: rule normalization/conflict helpers and existing `inventoryFolders` state.
- Produces: four InventoryService rule methods, three exact typed commands, common `inventory-organization:<groupActorId>` queue and folder dependency deletion error.

- [ ] **Step 1: Add failing Actor flag state/revision/idempotency tests**

Extend the existing group Actor fixture to expose `inventoryIngressRules`. Test null read, exact normalized snapshot, create/update/delete, `revision + 1` per semantic change, no Actor write for no-op, one Actor `setFlag(MODULE_ID,"==inventoryIngressRules",state)` for change, stale revision and same operation replay after a simulated write-then-throw.

```js
assert.equal(result.state.revision, 1);
assert.equal(groupActor.setFlagCalls.length, 1);
const replay = await service.createInventoryIngressRule(payload);
assert.deepEqual(replay, result);
assert.equal(groupActor.setFlagCalls.length, 1);
```

The rule journal record ID is `inventory-rule:<groupActorId>:<operationId>` and stores canonical request fingerprint, before revision and exact after-state before the Actor write. A prepared retry compares live Actor state with before/after state: apply once from before, finish from after, otherwise throw `reconciliation-required`.

- [ ] **Step 2: Add failing conflict/folder dependency/concurrency tests**

Assert save rejects overlapping rules and foreign/missing folder IDs before `setFlag`. Change the folder/rule queue key to `inventory-organization:<groupActorId>`, then test simultaneous folder delete versus folder-rule create in both queue orders: either create wins and delete reports dependent rule names, or delete wins and create reports missing folder; neither state may contain a dangling reference.

```js
await assert.rejects(
  service.deleteInventoryFolder({ groupActorId: group.id, folderId: "weapons" }),
  /Сломанное оружие/u
);
assert.equal(group.setFlagCalls.filter((call) => call.key === "==inventoryFolders").length, 0);
```

- [ ] **Step 3: Add failing exact command and authorization matrix tests**

Extend `inventory-folder-socket.test.mjs` with create/update/delete rule command cases. Validate exact keys, nonnegative safe `expectedRevision`, stable `operationId`, exact normalized rule schema and no extra keys. Reuse the existing GM/same-group character-owner/foreign-group/unknown/transport-mismatch matrix through `#canSenderManageGroup()`.

- [ ] **Step 4: Run the owner tests and verify failure**

Run: `node --test tests/group-inventory-migration.test.mjs tests/inventory-folder-socket.test.mjs`

Expected: FAIL on missing rule methods/commands and the old folder-only queue behavior.

- [ ] **Step 5: Implement service mutations and typed wrappers**

Add `#readInventoryIngressRuleState`, `#writeInventoryIngressRuleState`, `#runInventoryOrganizationMutation` and a rule mutation journal workflow. Route all five folder methods and three rule methods through the common queue. Folder delete reads rule state inside the queue and throws `InventoryIngressRuleError("folder-in-use", ...)` with dependent rule names. Publish normalized rule state in `getInventorySnapshot()` so the already-open InventoryApp does not need an additional Actor read.

Register the three commands with exact validators, `authorizeGroup`, service execution inside `runInventoryMutation()` and requester-side `refreshInventoryViews({actorIds:[groupActorId]})` only after success.

- [ ] **Step 6: Run focused tests and commit**

```powershell
node --test tests/group-inventory-migration.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-ingress-rules.test.mjs
git diff --check
git add scripts/data/inventory-service.js scripts/main.js tests/group-inventory-migration.test.mjs tests/inventory-folder-socket.test.mjs
git commit -m "feat: persist group inventory ingress rules"
```

### Task 4: Detached Planner and Confirmation Decisions

**Files:**
- Create: `scripts/application/inventory-ingress-planner.js`
- Create: `tests/inventory-ingress-planner.test.mjs`
- Modify: `scripts/ui/inventory-app.js:2800-2895`
- Modify: `tests/inventory-app-context.test.mjs:842-1010`

**Interfaces:**
- Consumes: Actor rule snapshot, compiler cache, canonical ItemData rows and descriptor/dismantle helpers.
- Produces: preview/serialize/parity API and exported `promptInventoryIngressConfirmation(preview)` returning `null` on cancel or `{rootOverrideSourceKeys}`.

- [ ] **Step 1: Write failing planner behavior and call-count tests**

Cover single/batch `folder`, `skip`, `dismantle`, no-match legacy target, root override and container dismantle-ineligible. Inject counters and assert one rules read, one compiler lookup, one `evaluateMany`, one descriptor per row and dismantle resolution only for matched dismantle candidates. Assert input rows/itemData and output are frozen or cloned, not mutated.

```js
assert.deepEqual(calls, {
  readRules: 1,
  compile: 1,
  evaluateMany: 1,
  descriptor: rows.length,
  dismantleEligibility: rows.length,
  dismantlePreview: 1
});
assert.equal(preview.rows[0].action.type, "folder");
assert.equal(preview.rows[0].action.folderId, "weapons");
```

- [ ] **Step 2: Write failing dialog decision tests in the existing InventoryApp harness**

Assert folder/no-match returns without opening DialogV2; single skip offers exactly `Не забирать` and `Всё равно добавить в корень`; batch skip opens no window; all dismantle rows appear in one dialog with checked checkboxes; unchecked rows become root overrides; close/cancel returns `null` and calls no mutation callback.

- [ ] **Step 3: Verify missing planner/dialog behavior**

Run: `node --test tests/inventory-ingress-planner.test.mjs tests/inventory-app-context.test.mjs`

Expected: FAIL on the new module/export while existing InventoryApp tests keep their prior assertions.

- [ ] **Step 4: Implement planner and exact serialized plan**

Planner calls `readRules(groupActorId)` once, obtains the immutable cache entry once, builds descriptors once (including the cheap dismantle eligibility projection), calls `evaluateMany()` once, then requests full material previews only for decisions whose matched action is `dismantle`. No-match action records the supplied `legacyFolderId`/requested folder without converting it to a matched route. `serialize()` strips `itemData` and `dismantlePreview`; `assertParity()` compares group, revision, requested target, source keys, captured identity/quantity, matched rule ID and action/target.

Implement the DialogV2 adapter as an exported function near existing inventory dialog helpers. Escape every display name, include all canonical preview outputs, and never return material IDs/quantities as authority.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node --test tests/inventory-ingress-planner.test.mjs tests/inventory-app-context.test.mjs
git diff --check
git add scripts/application/inventory-ingress-planner.js scripts/ui/inventory-app.js tests/inventory-ingress-planner.test.mjs tests/inventory-app-context.test.mjs
git commit -m "feat: plan inventory ingress batches"
```

### Task 5: Authoritative Batch Commit, Target-Scoped Merge and Recovery

**Files:**
- Modify: `scripts/data/inventory-service.js:3082-3115,4623-4815,5873-6555`
- Modify: `tests/inventory-mutation-recovery.test.mjs:1429-1795`
- Modify: `tests/group-inventory-migration.test.mjs:2222-2745`
- Modify: `tests/ui-refresh-coordinator.test.mjs:406-510`

**Interfaces:**
- Consumes: serialized planner contract, common organization queue, existing mutation journal and source callbacks.
- Produces: `commitInventoryIngressBatch()` with journaled per-row phases and scoped merge selection; import uses it instead of the parallel one-item mutation flow.

- [ ] **Step 1: Write failing target-scope and compatibility tests**

Create equal stacks in root, requested folder and another folder. Assert matched `folder` merges only inside its target; if absent it creates a new target stack without moving old stacks. Assert a matched root override merges only root. Assert no-match retains the legacy cross-folder candidate and exact drop target behavior.

```js
assert.equal(otherFolderStack.updateCalls.length, 0);
assert.equal(targetFolderStack.updateCalls.length, 1);
assert.equal(folderState.itemFolderIds[newItemId], "weapons");
```

- [ ] **Step 2: Write failing skip/dismantle/non-recursion tests**

Assert skip without override performs zero target create/update, zero source debit, zero material resolution during commit beyond the authoritative matched preview and reports `changed:false`. Assert root override creates original Item without re-running matcher. Assert dismantle derives target root (`derivedFolderId:null`), merges only with compatible material stacks already in root, creates/merges only canonical material outputs, never creates an intermediate source Item, and material creation/folder move/recovery replay does not call planner/matcher recursively.

- [ ] **Step 3: Write failing revision/identity/folder/recovery tests**

Cover stale rules revision, changed source identity/quantity, removed folder, changed material resolver result, same batch ID with different fingerprint, target-created retry, target merge update write-then-throw, material output write-then-throw, source debit failure and terminal retry. Verify duplicate mutation ID never duplicates quantity/value and partial errors remain nonterminal/recoverable.

The batch journal record uses:

```js
{
  id: `inventory-ingress:${batchMutationId}`,
  kind: "ingress-batch",
  phase: "prepared",
  groupActorId,
  sourceOrigin,
  fingerprint,
  rulesRevision,
  requestedFolderId,
  rows: [{
    sourceKey,
    sourceIdentity,
    matchedRuleId,
    overrideToRoot,
    action,
    derivedFolderId,
    phase: "prepared",
    targetReceipts: []
  }]
}
```

Each non-skip row advances `prepared -> target-created/merged -> folder-assigned -> source-debited -> committed`; skip advances directly to `committed` without target/debit. Dismantle has one idempotent target receipt per material output. Finish the outer record only after every row is committed.

- [ ] **Step 4: Write failing batch refresh/performance assertions**

Wrap one 100-row commit in `runInventoryMutation()`. Assert one authoritative rules read/compile/evaluateMany, 100 descriptor builds, no per-row socket request, and one `UiRefreshCoordinator.request` after success. Document mutations may be grouped, but assertions must count calls rather than elapsed time.

- [ ] **Step 5: Run the owner tests and verify failure**

Run: `node --test tests/inventory-mutation-recovery.test.mjs tests/group-inventory-migration.test.mjs tests/ui-refresh-coordinator.test.mjs`

Expected: FAIL until the canonical batch route and scoped merge option exist.

- [ ] **Step 6: Implement one authoritative batch path**

Extend `#findInventoryMergeCandidate(actor,itemData,{folderState,folderId,scoped})`: `scoped:false` preserves legacy behavior; `scoped:true` accepts candidates only when `folderState.itemFolderIds[itemId] ?? null` equals the derived folder. Mark created originals/material outputs with `{id:operationId,kind:"ingress",sourceKey,outputIndex}` so lost create acknowledgement is discoverable.

`commitInventoryIngressBatch()` enters `inventory-organization:<groupActorId>`, resolves live rows there, reads rules/folders once, rebuilds authoritative preview, calls `assertParity()`, freezes journal receipts, performs target operations, calls injected source debit once per committed row and schedules no render itself. Terminal retry returns stored compact outcome. A nonterminal retry requires the same live rule revision; otherwise throw `reconciliation-required` instead of silently applying a new plan.

Route external import through this method: compendium source has a no-op debit, embedded source deletes/updates only in `debitRow`, and an Item already inside the target group remains a folder move/no-op path rather than ingress.

Route the existing public `addLootgenRowToInventory(row)` and `addModelItemToInventory(sourceType,sourceId,quantity,options)` through the same preview/commit owner whenever they create a new group Item. Add optional exact `{groupActorId,folderId,batchMutationId}` options to the model method while preserving the current three positional arguments; generate one stable ID for an invocation when the caller omits it. Craft outputs, material outputs and recovery helpers continue to use their private target receipt paths and must not call these public ingress methods.

- [ ] **Step 7: Run focused tests and commit**

```powershell
node --test tests/inventory-mutation-recovery.test.mjs tests/group-inventory-migration.test.mjs tests/ui-refresh-coordinator.test.mjs tests/inventory-ingress-planner.test.mjs
git diff --check
git add scripts/data/inventory-service.js tests/inventory-mutation-recovery.test.mjs tests/group-inventory-migration.test.mjs tests/ui-refresh-coordinator.test.mjs
git commit -m "feat: commit filtered inventory ingress batches"
```

### Task 6: Lootgen Single/Batch Ingress Without Per-Row Dispatch

**Files:**
- Modify: `scripts/application/loot-claim-service.js:32-145`
- Modify: `scripts/main.js:2415-2515,5060-5085`
- Modify: `scripts/ui/lootgen-chat.js`
- Modify: `tests/loot-claim-service.test.mjs:63-140`
- Modify: `tests/lootgen-chat.test.mjs:204-438,697-760`
- Modify: `tests/inventory-folder-socket.test.mjs`

**Interfaces:**
- Consumes: planner preview/choices and `InventoryService.commitInventoryIngressBatch()`.
- Produces: `LootClaimService.claimBatch()`, exact `inventory.ingress.lootgen` command and existing public `claimLootgenChatRowToInventory/claimLootgenChatAllToInventory` wrappers backed by one batch dispatch.

- [ ] **Step 1: Write failing LootClaimService batch receipt tests**

Test one read of ChatMessage state, one `grantBatch` call, accepted folder/dismantle/root-override rows marked claimed, skip rows left unclaimed, coins handled through unchanged currency grant, lost ChatMessage acknowledgement recovery and same batch ID conflict. A failure after some source rows are marked must resume from stored receipts without repeating target value.

- [ ] **Step 2: Write failing Lootgen UI/command call-count tests**

For a 20-row `take all`, assert one preview confirmation at most, one `socketCommandBus.request("inventory.ingress.lootgen", payload)`, zero calls to the public single-row wrapper, one inventory refresh and no filtering of coins. For single skip, assert `Не забирать` leaves the row button available; root override claims it. For dialog cancel, assert zero command calls.

Add a stale revision/source/folder command-error case: the Lootgen card/window remains open, the row stays available, and a second click builds a fresh preview rather than reusing the rejected serialized plan.

Exact command payload:

```js
{
  batchMutationId,
  groupActorId,
  lootId,
  rowIds,
  includeCoins,
  ingressPlan
}
```

No client-provided ChatMessage ID, ItemData or material output is accepted. Active GM resolves trusted GM-authored `lootgenChat` state by `lootId`, binds transport sender and repeats same-group participation authorization.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `node --test tests/loot-claim-service.test.mjs tests/lootgen-chat.test.mjs tests/inventory-folder-socket.test.mjs`

Expected: FAIL because current `claimAll` calls `claimLootgenChatRowToInventory()` per row and party claims still use the legacy event path.

- [ ] **Step 4: Implement typed batch claim and keep public compatibility methods**

Add `claimBatch(request)` to `LootClaimService`; retain `claimRow/claimCoins` as compatibility delegates to the canonical batch state machine. In composition, build detached rows from current trusted chat state for client preview, collect decisions once, and either execute locally on active GM or send one typed command. Active GM resolves current rows/coins, delegates accepted Item rows to `commitInventoryIngressBatch()`, then advances only debited source rows and coins.

Stop emitting the two party-inventory Lootgen legacy socket events from these public methods; remove their duplicate handling only after updated tests prove the typed route. Self/character Lootgen claims remain outside filters.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node --test tests/loot-claim-service.test.mjs tests/lootgen-chat.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-mutation-recovery.test.mjs
git diff --check
git add scripts/application/loot-claim-service.js scripts/main.js scripts/ui/lootgen-chat.js tests/loot-claim-service.test.mjs tests/lootgen-chat.test.mjs tests/inventory-folder-socket.test.mjs
git commit -m "feat: batch filtered Lootgen ingress"
```

### Task 7: Storage Party Claims, Portable Containers and Filter Receipts

**Files:**
- Modify: `scripts/data/storage-command-service.js:1-170,393-500,631-1005`
- Modify: `scripts/main.js:1538-1565,3390-3510,5005-5035`
- Modify: `scripts/ui/storage-app.js`
- Modify: `tests/storage-socket.test.mjs:1482-1605,1846-1885,2206-2815`
- Modify: `tests/storage-transfer-chat.test.mjs:165-290`
- Modify: `tests/storage-app.test.mjs`

**Interfaces:**
- Consumes: existing `storage.claim-row/all`, durable bulk binding and canonical batch commit.
- Produces: party payloads with exact `ingressPlan`, one outer storage dispatch, container folder routing and escaped filter suffix in the existing receipt.

- [ ] **Step 1: Write failing exact payload/authorization tests**

Extend `isValidStorageClaimRowPayload/isValidStorageClaimAllPayload`: `ingressPlan` is required and exact for destination `party`, and must be `null` for all other destinations. Assert sender/group authorization is unchanged and the active GM re-resolves token access, source rows, group, rules and folder before any grant.

- [ ] **Step 2: Write failing single/bulk behavior and call-count tests**

Cover folder, skip, root override, dismantle, no-match, cancel and coins. Assert bulk invokes planner/commit once, performs one command dispatch and one refresh, skips Journal rows as before, leaves filtered skip rows unclaimed, and never calls `addLootgenRowToInventoryOnce` per ordinary row. Coins continue through the old currency path without descriptors.

Add stale revision/source/folder command-error coverage: `StorageApp` remains open, preserves the source row, shows the existing error boundary, and the next action requests a fresh snapshot/preview instead of replaying the rejected client plan.

- [ ] **Step 3: Write failing portable container and recovery tests**

Assert folder action materializes the whole container tree once and assigns only its root membership to the derived folder. Dismantle is impossible when resolver returns no output. Retry after root materialization/folder assignment/source claim failure reuses the same container root and never duplicates descendants/value. Keep current `bulkClaimMutations` target/sender/path fingerprint binding and include canonical serialized plan in that fingerprint.

- [ ] **Step 4: Write failing storage receipt tests**

Extend the one existing `#publishClaimMessage` path with server-derived `filterOutcome` and assert escaped second lines:

```text
Отфильтровано в папку «Оружие».
Отфильтровано: разобрано на Железо x2, Дерево x1.
Фильтрация пропущена; добавлено в корень.
```

No-match has no suffix. Skip without override publishes no receipt. Retry publishes neither first nor second line twice. Chat content contains no source IDs, flags, serialized plan or client material data.

- [ ] **Step 5: Run focused tests and verify failure**

Run: `node --test tests/storage-socket.test.mjs tests/storage-transfer-chat.test.mjs tests/storage-app.test.mjs`

Expected: FAIL on the new exact plan shape, batch delegation and receipt suffixes.

- [ ] **Step 6: Implement source adapter without replacing Storage ownership**

Before dispatch, public storage wrappers obtain current snapshot rows, build one preview and collect choices. Inside the existing root-token `#runClaim` queue, active GM resolves live rows and calls one `commitInventoryIngressBatch()` for party Item/container rows. Inject `grantContainer` to reuse `containerItemService.materializeToActorOnce()` and `debitRow` to call `storageService.claim()` only after target phase. Continue coins, durable binding completion and one source refresh in their current order.

Pass only authoritative folder/material presentation to `#publishClaimMessage`; do not introduce a second ChatMessage helper or notification channel.

- [ ] **Step 7: Run focused tests and commit**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-transfer-chat.test.mjs tests/storage-app.test.mjs tests/inventory-mutation-recovery.test.mjs
git diff --check
git add scripts/data/storage-command-service.js scripts/main.js scripts/ui/storage-app.js tests/storage-socket.test.mjs tests/storage-transfer-chat.test.mjs tests/storage-app.test.mjs
git commit -m "feat: filter storage party ingress"
```

### Task 8: Embedded InventoryApp Rule Editor and Drag Preview

**Files:**
- Modify: `scripts/ui/inventory-app.js:3240-3345,4158-4720,6810-6985,7714`
- Modify: `templates/inventory-app.hbs:175-260`
- Modify: `styles/main.css:5815-5935,10100-10135`
- Modify: `tests/inventory-app-context.test.mjs:480-1500,2066-2165,4400-4565`

**Interfaces:**
- Consumes: rule state embedded in inventory snapshot, rule field definitions, public create/update/delete wrappers and planner confirmation adapter.
- Produces: one InventoryApp with `inventoryMode:"items"|"filters"`, local rule draft, compact toolbar action group and external import preview.

- [ ] **Step 1: Write failing toolbar/layout/accessibility tests**

Assert order `search -> type -> sort -> action group`, where action group contains `fa-filter` then `fa-folder-plus`; both buttons have `title/aria-label`, equal approximately `34px` size and remain side-by-side at narrow media rules. Assert the old `44px` folder-only rule is absent and no visible `Правила лута` toolbar text/tab/new ApplicationV2 is introduced.

- [ ] **Step 2: Write failing editor context/template tests**

Toggle the filter button and assert the same app ID/class renders unordered cards with conditions/action, create/edit/delete controls, field/operator/typed value controls, folder selector, skip/dismantle actions and optional name. Gate all mutation controls with the same `canOrganizeInventory` participation capability as folders. Read state from the already-fetched inventory snapshot; cached search/sort rerenders must not refetch rules or reset the editor draft.

- [ ] **Step 3: Write failing local validation and service-error tests**

Assert incomplete rows are highlighted and cannot dispatch; valid drafts are normalized through `normalizeInventoryIngressRule`; IDs and operation IDs come from `crypto.randomUUID()`; update/delete send current `expectedRevision`. An authoritative conflict error names the existing rule and intersecting constraints, keeps the editor open, invalidates the snapshot and does not apply optimistic world state.

- [ ] **Step 4: Write failing external drag preview/dialog tests**

Internal same-group Item/folder moves still call only move APIs and never planner. External Foundry Item and storage-row drop use the exact drop target for no-match, silently route matched folder, show single skip/dismantle decisions, and on cancel perform zero import/claim calls. Root override calls commit once with serialized plan and does not re-preview.

- [ ] **Step 5: Run focused tests and verify failure**

Run: `node --test tests/inventory-app-context.test.mjs`

Expected: FAIL on missing filter mode/action/editor while current folder drag and cache assertions remain green.

- [ ] **Step 6: Implement the same-app editor and responsive toolbar**

Add local state fields `inventoryMode`, `inventoryRuleDraft`, `inventoryRuleDraftError`; reuse render abort/listener cleanup. Template receives already-shaped field/operator/value/action options and performs no domain matching. After successful mutation call `refreshInventorySnapshot({preserveScroll:true})`; folder routing success is silent. External drop handler requests preview only after classifying the drag as external and uses the chosen serialized plan once.

Set `.rm-compact-toolbar` to `minmax(0,1fr) 180px 220px auto`, add a flex `.rm-inventory-toolbar-actions`, set both icon buttons to `34px`, and keep the action group unwrapped in the narrow rule while other toolbar fields may wrap.

- [ ] **Step 7: Run focused tests and commit**

```powershell
node --test tests/inventory-app-context.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-folder-socket.test.mjs
git diff --check
git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: add embedded inventory ingress filters"
```

### Task 9: Composition, Public Contract, Documentation and Release Verification

**Files:**
- Modify: `scripts/main.js:1-120,1095-1580,2415-2515,4680-5090,5640-5730`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/ui-refresh-coordinator.test.mjs`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `README.md:83-128,239-300,312-323`
- Modify: `docs/function-passport.md` sections 1, 2, 7, 8, 13 and 19 only where methods/data flow changed
- Modify: `module.json`
- Create: `scripts/main-1.4.159.js`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one wired planner/cache, stable public API, command registrations, documented ownership and versioned runtime entrypoint.

- [ ] **Step 1: Write failing composition and public-surface tests**

Assert `RebreyaMainModule` constructs exactly one `InventoryIngressRuleCompilerCache` and one `InventoryIngressPlanner`, injects them into InventoryService/Storage/Lootgen routes, registers each new command once and exposes the intended public methods on both `game.rebreyaMain` and module API. Assert `scripts/main.js` remains the only composition root and no global Item hook/filter ApplicationV2 exists.

- [ ] **Step 2: Write final performance/refresh regression tests**

Across Lootgen all, Storage all and import, count one command dispatch per operation, one rules read/compile/evaluate per group batch, one descriptor per Item row, zero descriptors for coins, zero per-row public API calls and one coalesced inventory refresh. Add an explicit assertion that matcher/helpers never call socket, render, setFlag or settings.

- [ ] **Step 3: Finish exact local/remote routes in composition**

Use a shared helper that validates serialized plan locally, calls service directly only on active GM, otherwise sends the source command once, then calls `runInventoryMutation()`/`refreshInventoryViews()` once for returned `actorId`. Do not nest `runInventoryMutation()` around per-row operations. Keep `UiRefreshCoordinator` as the only final rendering route.

- [ ] **Step 4: Update README only for actual public/API changes**

Document the Group Actor flag, supported ingress sources/actions, rule CRUD/preview methods, `inventory.ingress.lootgen` and extended import/storage exact payloads. State that coins/material outputs/existing Items are excluded and runtime folder success is quiet except the existing storage receipt.

- [ ] **Step 5: Update the function passport as current-state documentation**

In section 1 record composition/public methods; section 2 exact commands, sender binding and batch idempotency; section 7 rule/descriptor/planner/InventoryService signatures, data flow, merge scope and recovery; section 8 storage plan/receipt/container flow; section 13 Lootgen batch claim; section 19 embedded editor/dialog/one-refresh flow and focused tests. Remove superseded per-row/legacy party-claim descriptions rather than retaining history.

- [ ] **Step 6: Bump the runtime entrypoint to `1.4.159`**

Set `module.json.version` and `esmodules` to `1.4.159`; create a thin forwarder only:

```js
// @rebreya-role versioned-entrypoint-cache-forwarder
import "./main.js?v=1.4.159-inventory-ingress-filters";
```

Update manifest tests; do not place composition logic in the forwarder.

- [ ] **Step 7: Run all focused owner suites once on the final HEAD**

```powershell
node --test tests/inventory-ingress-rules.test.mjs tests/inventory-ingress-descriptor.test.mjs tests/inventory-ingress-planner.test.mjs tests/inventory-folder-tree.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-app-context.test.mjs tests/loot-claim-service.test.mjs tests/lootgen-chat.test.mjs tests/storage-socket.test.mjs tests/storage-transfer-chat.test.mjs tests/storage-app.test.mjs tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs tests/module-manifest.test.mjs
```

Expected: `0` failed. Record actual passed/failed counts and real errors only.

- [ ] **Step 8: Perform the mandatory complete verification exactly once on unchanged HEAD**

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: full Node suite `0` failed; every tracked JS/MJS passes syntax; every tracked JSON parses; no whitespace errors. Do not rerun the same full check unless HEAD changes.

- [ ] **Step 9: Review exact diff and stage only task files**

```powershell
git diff --check
git diff --stat
git diff -- scripts/data/inventory-ingress-rules.js scripts/data/inventory-ingress-descriptor.js scripts/application/inventory-ingress-planner.js scripts/data/inventory-service.js scripts/application/loot-claim-service.js scripts/data/storage-command-service.js scripts/ui/inventory-app.js scripts/ui/lootgen-chat.js scripts/ui/storage-app.js scripts/main.js templates/inventory-app.hbs styles/main.css README.md docs/function-passport.md module.json scripts/main-1.4.159.js tests
git status --short
```

Inspect for damaged UTF-8 Cyrillic, accidental source-origin descriptor fields, direct UI state writes, per-row socket/render calls, global Item hooks and unrelated changes.

- [ ] **Step 10: Commit final integration/docs delta, re-fetch and push without force**

```powershell
git add scripts/main.js tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs tests/module-manifest.test.mjs README.md docs/function-passport.md module.json scripts/main-1.4.159.js
git commit -m "docs: document inventory ingress filters"
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git log --oneline HEAD..origin/main
git rev-list --left-right --count HEAD...origin/lich_branch
git log --oneline HEAD..origin/lich_branch
git push -u origin lich_branch
```

Expected: remote `lich_branch` did not advance unexpectedly; push succeeds without force. If it advanced, stop and report instead of merging/rebasing automatically.

## Final Acceptance Matrix

| Requirement | Owner test/task |
|---|---|
| Rule schema/version/no-op/revision | Task 1 pure state + Task 3 Actor persistence |
| All DSL operators and invalid payloads | Task 1 |
| Equal/subset/numeric/exclusion/potential/dismantle conflicts | Task 1 |
| Lootgen/Storage/drop descriptor parity | Task 2 |
| One or zero immutable match without Foundry globals | Task 1 |
| Folder/skip/dismantle/override/cancel planning and dialogs | Task 4 |
| Legacy no-match and target-scoped filtered merge | Task 5 |
| No matching on move/recovery/material outputs/coins | Tasks 5, 7, 8 |
| Exact commands, sender binding, same/cross-group permissions | Tasks 3, 6, 7 |
| Shared folder/rule serialization and dependency deletion | Task 3 |
| Duplicate ID, target/material retry and source debit failure | Task 5 |
| One escaped storage receipt with suffix/no skip receipt | Task 7 |
| Toolbar/editor/permissions/dialog decisions | Task 8 |
| One rules read/compile/dispatch/refresh and one descriptor/row | Tasks 4, 5, 6, 7, 9 |
| Hundreds of rules/thousands of rows without full scan per row | Task 1 |
| Public docs/passport/versioned entrypoint/full static checks | Task 9 |
