# Fractional Material Dismantle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Возвращать 50% массы при разборе, включая дробные остатки, без потери массы/стоимости при крафте и переносах; исправить Дредноут и ingress skip.

**Architecture:** Один pure adapter переводит каталожное количество material Items в целое native quantity и дробный вес/цену физической части. Существующие authoritative owners используют этот адаптер для записи, identity и recovery. Формулы рецептов и уже сохранённые legacy receipts не переинтерпретируются.

**Tech Stack:** JavaScript ESM, Node test runner, Foundry VTT 13, dnd5e 5.2.5, PowerShell. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-13-fractional-material-dismantle-design.md` — пользователь подтвердил 2026-10-13.

## Global Constraints

- Foundry VTT 13; установленная dnd5e 5.2.5 требует целого `system.quantity`, но разрешает дробный `system.weight.value` и цену. Схему dnd5e и глобальные DataModel не меняем.
- Каталожная единица адамантина по-прежнему весит 10 фунтов и стоит 500 зм; authored веса, цены, свойства, количества в пачках и ID каталога сохраняются.
- Обычные предметы и боеприпасы остаются штучными; запрос разбора принимает целое количество исходных предметов.
- Сохраняем возврат 50%, папки, ingress-правила, права пользователя, typed sockets, active-GM authority, mutation IDs, provenance и компенсацию при ошибке.
- Формулы рецептов, резервирование двух компонентов, бюджет и расход прогресса крафта сохраняются. `predominantMaterialLb` остаётся массой в фунтах, `baseRawQuantity` — количеством каталожных единиц.
- Логический запас: 12 десятичных знаков; authored запросы крафта: пять знаков. Допуск массы/цены: `1e-8 × max(1, ожидаемое значение)`. Положительные material quantities не повышаются принудительно до 0,01.
- Не переписываем завершённые операции и исторически начисленную лишнюю массу без доказуемого исходного состояния.
- Работа и commits только в `lich_branch`; текущая чистая рабочая копия используется для inline execution. Перед runtime commit — полные проверки и повышение версии с синхронным versioned entrypoint.
- Каждый новый/изменённый метод документируется в соответствующем разделе `docs/function-passport.md` в том же commit. Public contract changes документируются в README.
- Checkpoint задачи означает сохранённые изменения и отметки этого плана. Один итоговый runtime commit выполняется после полной проверки в задаче 6; промежуточные шаги не требуют повторять полную проверку всего модуля.
- Прежние тесты целого выхода обновляются только в соответствии с одобренным дробным выходом: проверяются logical quantity, целое native quantity и настоящие масса/стоимость. Assertions рецептов, двух компонентов, бюджетов, авторизации, идемпотентности и legacy repair сохраняются.

## Review Focus

1. Повторные merge/split вокруг целого количества: ceil и разные коэффициенты частей не создают массу или стоимость. Проверки — задачи 1–3.
2. Native drag-and-drop, Storage/ground и material fuel обходят простые UI-вызовы: projection и units сохраняются, server receipt не принимает native count за logical count. Проверки — задача 3.
3. Predominant и baseRaw могут иметь один material ID, но разные единицы; оба компонента, бюджет и расход должны остаться точными. Проверки — задача 4.
4. Новая дробная prepared mutation и старая corrupted mutation внешне похожи: legacy repair не разрушает корректный credit, retry и rollback восстанавливают quantity/weight/price/flags/history вместе. Проверки — задача 2.
5. Tiny positive fractions, invalid flags, authored unit overrides и обновление каталога во время проекта: нет нулевого отображения положительного запаса, несанкционированного merge или переписывания старого резервирования. Проверки — задачи 1, 4, 5.

## File Structure and Contracts

Новый owner: `scripts/data/inventory-material-quantity.js`; прочие изменения расширяют существующие owners. Все importers используют canonical ESM URL без нового query/cache alias.

Flag: `flags.rebreya-main.materialQuantity = { version: 1, unitsPerItem, unitWeightLb, unitPriceValue, unitPriceDenomination }`. Stable material identity — `sourceType:"material"`/`sourceId` либо существующий managed material marker; `gear` с преобладающим материалом не становится material Item.

Pure adapter interfaces:

- `isInventoryMaterialItemData(itemData) -> boolean`;
- `readInventoryItemQuantity(itemData) -> number` — logical quantity; unflagged fallback сохраняет прежнее количество;
- `readInventoryItemUnitWeight(itemData) -> number` — canonical pounds для material projection;
- `readInventoryItemUnitPrice(itemData) -> { value, denomination }`;
- `withInventoryItemQuantity(itemData, quantity) -> detached ItemData`;
- `buildInventoryItemQuantityPatch(itemData, quantity) -> flat Document update`;
- `normalizeInventoryMaterialProjection(itemData) -> detached ItemData` — canonical projection для identity, без density-dependent fields;
- `inventoryMaterialQuantitiesMatch(left, right) -> boolean` — сравнивает значения после нормализации до 12 знаков; соседние material quantum `1e-12` не считаются равными;
- `captureInventoryItemQuantityState(itemData) -> { quantity, weight, price, materialQuantityFlag }` — точный native before/after state;
- `buildInventoryItemQuantityRestorePatch(state) -> flat Document update` — восстанавливает эти поля, включая отсутствие прежнего flag.

Ordinary ItemData проходят без material scaling. На material записи Q нормализуется до 12 знаков, затем N=ceil(Q), S=Q/N; quantity/weight/price/flag записываются атомарно. Нулевое Q даёт N=0, S=1, канонические weight/price. Canonical unit данные берутся из валидного flag либо исходного ItemData; material builder начинает с authored catalog unit данных. Непредставимый positive Q и invalid projection не приводят к debit.

`resolveInventoryDismantleOutputs()` сохраняет структуру `{ sourceType, sourceId, name, quantity }`; `quantity` теперь дробное число каталожных единиц. `materialWeight` authoritative результата и folder totals означают настоящие фунты. Новые stock/dismantle records используют `materialAccountingVersion:2` и before/after quantity-state; новые project reservations сохраняют `materialAccountingVersion:2`, `predominantUnitWeightLb`, `baseRawUnitWeightLb`. Старый record исполняется по сохранённой схеме.

### Task 1: Pure material quantity adapter

**Files:** Create `scripts/data/inventory-material-quantity.js`, `tests/inventory-material-quantity.test.mjs`; update its owner entry in `docs/function-passport.md`.

**Interfaces:** Consumes plain ItemData and MODULE_ID; produces all pure adapter exports above. No Foundry globals or state writes.

- [ ] **Write failing tests** for fractional projection, immutability, zero, invalid scale/version, ordinary gear, legacy unit data, native count edits and canonical identity. Include 100 alternating fractional writes, 450/630-pound units, exact unflagged-state restore, different authored W/P, and distinguishing quantity 0 from 1e-12. Fixture `adamantUnitData` has stable material identity, quantity=1, weight=10 lb, price=500 gp. Pin:

```js
const half = withInventoryItemQuantity(adamantUnitData, 0.05);
assert.equal(half.system.quantity, 1);
assert.equal(half.system.weight.value, 0.5);
assert.equal(half.system.price.value, 25);
assert.equal(readInventoryItemQuantity(half), 0.05);
const merged = withInventoryItemQuantity(half, 1.05);
assert.equal(merged.system.quantity, 2);
assert.equal(merged.system.quantity * merged.system.weight.value, 10.5);
assert.equal(merged.system.quantity * merged.system.price.value, 525);
```

- [ ] **Run RED:** `node --test tests/inventory-material-quantity.test.mjs`; expected missing-module/export or wrong projection failure.
- [ ] **Implement** the interfaces, strict metadata validation, weight-unit conversion for materials and exact before/after restore. Normalize quantity before ceil; do not round projected per-piece price/weight to eight or two signs.
- [ ] **Run GREEN:** same command; all adapter cases pass.
- [ ] **Update passport and checkpoint** only this task's files after `git diff --check` and substantive diff review.

### Task 2: Inventory quantity flow, fractional dismantle and recovery

**Files:** Modify `scripts/data/inventory-service.js`, `scripts/data/inventory-ingress-descriptor.js`, `scripts/application/inventory-ingress-planner.js` for logical preview quantities; test `inventory-ingress-descriptor`, `inventory-ingress-planner`, `inventory-mutation-recovery`, `inventory-folder-socket`, `group-inventory-migration`; update README/passport.

**Interfaces:** Consumes task 1 exports. Produces unchanged InventoryService public method signatures, fractional catalog output quantity, real-pound result, marked v2 durable records and exact quantity-state recovery.

- [ ] **Write failing owner regressions** for 20/40 real adamant ammo, material weights `[0.5,1,10,450,630]`, min=1, ordinary 4-pound sword→2 iron units, folder/manual/auto-ingress parity, zero-source rejection, skipped filter and marked prepared record. Extend existing create/update fixtures to reject noninteger native quantity. Pin merge/create write-then-throw, source failure, rollback-failure, moved/stale folder, new-prepared retry and a tiny valid material credit that the old 1e-9 quantity comparison would falsely treat as already applied. Native total-weight parity is tested in `group-inventory-migration`.
- [ ] **Run RED:** `node --test tests/inventory-ingress-descriptor.test.mjs tests/inventory-ingress-planner.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-folder-socket.test.mjs`; expect current floor/unit bug failures.
- [ ] **Route inventory stock operations through the adapter:** `getRawQuantity`, material weight/price reads, `#buildMaterialItemData`, `buildModelItemData`, `#upsertInventoryItem`, snapshot, quantity edits, sale, ingress/transfer target creation/merge, depletion and existing stock receipt writes. Inventory snapshots retain positive small material quantities; ordinary precision/rules stay unchanged. Classify every direct `system.quantity` write; supply/gear-specific paths remain ordinary unless their stable source actually is material.
- [ ] **Change resolver and authoritative dismantle:** compute mass ×0.5 then divide by catalog W; validate positive source count and W before journal creation. Preserve output shape and existing blocks; compute representable minimum. Update real-pound folder totals and all success/result fields consistently.
- [ ] **Make recovery atomic:** target receipts carry logical quantities plus exact native before/after quantity-state and history. `#applyDismantleTargetReceipt` and compensation validate complete observed state, using material-specific quantity comparison instead of ordinary 1e-9 tolerance. Legacy repair accepts only unmarked historical records. Existing terminal retries and existing legacy record requests are not rewritten.
- [ ] **Run GREEN** with the RED command plus `node --test tests/group-inventory-migration.test.mjs`; all new cases and unchanged legacy fractional repair cases pass.
- [ ] **Update passport/README and checkpoint** the completed owner behavior; do not broaden into recipe formula changes.

### Task 3: Transfers, Storage/ground, native reconciliation and material fuel

**Files:** Modify `scripts/data/inventory-service.js`, `scripts/integrations/inventory-sync.js`, `scripts/main.js` at existing folder-move quantity validation, `scripts/data/storage-service.js`, `scripts/data/storage-command-service.js`, `scripts/data/storage-ground-pile-service.js`, `scripts/ui/storage-app.js`, `scripts/data/transport-fuel-item.js`, `scripts/data/transport-fuel-service.js`. Tests: `inventory-simple-transfer`, `inventory-transfer-imports`, `inventory-sync-hooks`, `inventory-folder-socket`, `group-command-dispatch`, `storage-transfer-chat`, `storage-transfer-drop`, `storage-transfer-ui`, `storage-ground-pile-service`, `storage-app`, `transport-fuel-item`, `transport-fuel-service`, `transport-fuel-consumption`; passport.

**Interfaces:** Consumes task 1 logical/native adapter and task 2 stock receipts. Storage row quantity remains logical; embedded ItemData quantity stays native integer. Existing UUID/identity/permission/same-scene/distance checks stay unchanged.

- [ ] **Write failing regressions:** split 0.05 adamant unit into 0.02+0.03 and merge back; Party→character→Storage→ground→Party preserves 0.5 lb/25 gp; idempotent retry; whole+fraction merge; density differences normalize but altered canonical W/P do not merge. Transfer a 0.5-pound fragment of a 630-pound catalog unit through typed folder move with exact logical `quantity` and `expectedSourceQuantity`; five-sign wire validation must not reject it. Strict native integer writes, debit failure compensation, cancel and native accepted-transfer reconciliation are pinned on each new route.
- [ ] **Run RED:** `node --test tests/inventory-simple-transfer.test.mjs tests/inventory-transfer-imports.test.mjs tests/inventory-sync-hooks.test.mjs tests/storage-transfer-chat.test.mjs tests/storage-transfer-drop.test.mjs tests/storage-transfer-ui.test.mjs tests/storage-ground-pile-service.test.mjs`.
- [ ] **Integrate** pure quantity writes in Storage `setStorageRowQuantity`, claim/deposit/update and ground-row preparation/merge. Use canonical material identity in comparisons; do not drop scale flags when cloning. Capture/debit/restore logical amounts in inventory import/simple/native transfer receipts. Inventory-sync update events verify the observed full material projection instead of equating changed native count to logical amount; its compensation restores complete quantity-state. Storage UI drag source amounts preserve logical fractions instead of the current 0.01/two-sign clamp; ordinary source rules are unchanged.
- [ ] **Extend existing typed material quantity precision** to 12 signs, including folder-move `expectedSourceQuantity` and Storage claim/deposit/ground quantities, without extra sender-supplied identity fields. Keep finite/positive/bounded numeric validation and exact key schema; after live source/permission resolution, ordinary Items retain their current precision/count rules and unsupported ordinary amounts are rejected before mutation. Coin, Journal, container and source dismantle quantities remain integer. Pin both validator admission and authoritative source-type rejection in `inventory-folder-socket`, `storage-socket`, `storage-deposit-source` and `storage-transfer-drop` tests.
- [ ] **Pin material fuel compatibility:** a selector matching a partial material stock reads logical quantity and consumes the same authored amount. Use the adapter for its batched patches and fallback; ordinary fuel behavior, rate and travel formula stay unchanged.
- [ ] **Run GREEN** with the RED command and `node --test tests/inventory-folder-socket.test.mjs tests/group-command-dispatch.test.mjs tests/storage-socket.test.mjs tests/storage-deposit-source.test.mjs tests/storage-app.test.mjs tests/transport-fuel-item.test.mjs tests/transport-fuel-service.test.mjs tests/transport-fuel-consumption.test.mjs`; new route, authority and ordinary-fuel regression cases pass.
- [ ] **Update passport and checkpoint** the complete transfer/storage integration.

### Task 4: Craft stock units and legacy project compatibility

**Files:** Modify `scripts/data/crafting-service.js`, `scripts/data/inventory-service.js`, `scripts/data/craft-project-processor.js` to preserve accounting metadata through its existing reservation normalization. Tests: `crafting-service`, `crafting-rules`, `craft-project-processor`, `inventory-mutation-recovery`; passport/README. `crafting-rules.js` authored formulas stay unchanged.

**Interfaces:** `normalizeReservation` retains v2 marker and canonical unit weights. New project quote/reservation stores those weights and includes them in its immutable fingerprint. Inventory resource planning converts predominant pounds to catalog units only for v2 new accounting; baseRaw remains catalog units. `reserveCraftResourcesOnce`, `spendCraftReservationOnce`, `releaseCraftReservationOnce`, availability and cancel/recovery carry the pinned accounting basis.

- [ ] **Write failing regressions:** v2 predominant 0.5 lb of adamant reserves 0.05 unit; baseRaw reservation and gold budget match the original quote. Combine same material ID only after unit conversion. Partial spend and cancel return the exact unspent stock; changing current catalog W does not alter a pinned reservation.
- [ ] **Add legacy and recovery regressions:** an active unmarked project whose old receipt debited 0.5 catalog unit still refunds/spends using that old basis. Existing receipt retries remain exact; completed legacy records are unchanged. New direct stock operation without old receipt uses corrected units. Pin active-GM change, reserve/release write-then-throw, interrupted resume and same-ID components without weakening budget assertions.
- [ ] **Run RED:** `node --test tests/crafting-service.test.mjs tests/crafting-rules.test.mjs tests/craft-project-processor.test.mjs tests/inventory-mutation-recovery.test.mjs`.
- [ ] **Implement** version-aware resource conversion in existing `collectCraftMaterialResources`/availability and debit/release planners. Preserve source `predominantMaterialLb`, `baseRawQuantity`, reserved/spent/progress fields and both component totals. Persist actual converted logical quantity plus unit basis in receipts; stock precision is 12 signs while requests retain five. Update fingerprint/normalization only for new versioned reservations; old request-record identity remains compatible.
- [ ] **Run GREEN** with the RED command; accounting, budget, legacy and interrupted-operation cases pass.
- [ ] **Update passport/README and checkpoint** version-aware craft stock accounting.

### Task 5: Exact Dreadnought bindings and truthful UI

**Files:** Modify `tools/equipment-import/adapters/base-gear.mjs`, `data/gear.json`, `scripts/ui/inventory-app.js`, `templates/inventory-app.hbs` only where precision rendering requires it; tests `equipment-import-base-gear`, `equipment-import-gear-profiles`, `equipment-import-generated-data`, `inventory-app-context`; passport/README.

**Interfaces:** `adaptBaseGear` applies two reviewed exact source bindings when literal category is `Астральный дредноут`; no global material/category alias or expansion of sheet-owned enrichment whitelist. Existing generated IDs remain identical. UI consumes logical snapshot values, real-pound `materialWeight` and unchanged `skipped` result flag.

- [ ] **Write failing import tests:** claws ammo→`material-123`, plating ammo→`material-121`; literal source name, source identity, gear ID, pack 20, price and effect unchanged. Other category rows remain unresolved unless their exact binding exists; missing reviewed material fails clearly.
- [ ] **Write failing UI tests:** `skipped:true` produces a skip notice and no success toast; decimal quantities below 0.01 remain visible, quantities below native-one are accepted on material partial-transfer/quantity controls; source dismantle min/max remain integer. Cancel sends no mutation.
- [ ] **Run RED:** `node --test tests/equipment-import-base-gear.test.mjs tests/equipment-import-gear-profiles.test.mjs tests/equipment-import-generated-data.test.mjs tests/inventory-app-context.test.mjs`.
- [ ] **Implement exact bindings** in import owner and update only the two reviewed generated material IDs. Runtime resolution uses current catalog ID for old ammo instances with empty link; no fuzzy name fallback. Any source compilation update must be deterministic and leave unrelated generated rows untouched.
- [ ] **Implement precision-aware UI** through existing formatting/adapters. Dismantle result reports pounds; ingress preview material quantity is labelled as catalog units. Exact skip text: `Разбор пропущен входящим фильтром. Предмет остался в инвентаре.` Do not print a successful dismantle for zero debit. Display positive tiny fractions with sufficient decimal precision rather than `0`.
- [ ] **Run GREEN** with the RED command; verify regression snapshots assert meaningful behavior rather than mirroring implementation.
- [ ] **Update passport/README and checkpoint** the import/UI fixes.

### Task 6: Review, release verification and delivery

**Files:** Finalize `docs/function-passport.md`, `README.md`, `module.json`, versioned entrypoint and task documentation. Current manifest at planning is `1.4.375`; choose the next patch from the actual manifest at execution, never overwrite another person's version.

**Interfaces:** All previous tasks implement the approved spec; no additional behavior change or schema migration is introduced at this gate.

- [ ] **Perform whole-change review** against all nine specification regressions and the five Review Focus cases. Use an independent reviewer; Gemini 3.8 Flash High through the prescribed Antigravity CLI is the default. Verify its findings in original source; apply corrections only with owner regression tests. Check all direct material quantity reads/writes, native integer writes, recipe budgets and atomic quantity/history restoration.
- [ ] **Bump release version** and rename/create `scripts/main-<new-version>.js` containing only `import "./main.js";`; synchronize `esmodules`, verify no old entrypoint remains in runtime configuration. Stage only task-owned files.
- [ ] **Run full runtime checks once after final edits:**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

- [ ] **Live QA when an authorized test-world session is available:** strict native document creation, 20/40 ammo dismantle, merged scraps, inventory/sheet mass and price, partial native/module transfer, Storage/ground, craft reserve/cancel, reload, GM/player and console errors. Use disposable fixtures and existing public APIs. If no authorized test world is reachable, report that limitation; do not mutate a production world for QA or call Node fixtures live verification.
- [ ] **Finalize documentation/status**, inspect substantive diff and stat, confirm working-copy ownership and fetched remote state. Re-run only affected checks after review corrections.
- [ ] **Commit and push** task-owned files to `origin lich_branch`, no force push. Report spec/plan paths, release version, commit(s), test commands and passed/failed counts, Gemini contribution and live-QA coverage/limitation.

## Self-Review and Execution Handoff

Coverage: spec regressions 1–2→tasks 1–2; 3–4→tasks 1–3; 5→task 4; 6–7→task 2 plus route tests in task 3; 8–9→task 5; full release verification→task 6. Extra material consumers discovered during planning (native reconciliation, ground piles, material fuel) are included to preserve the approved mass/quantity contract.

Recommended execution: **Native / inline**. Tasks share one adapter and the same InventoryService mutation paths, so sequential implementation with focused tests and one independent whole-change review avoids conflicting drafts. Gemini can draft tests or review scoped excerpts under AGENTS.md; Codex reviews and applies mutations with meaningful side effects. Implementation waits for user plan approval and execution-method selection.
