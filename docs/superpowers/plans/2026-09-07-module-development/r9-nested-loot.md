# R9 — заполненные контейнеры в общем бюджете лута

> **Для исполнения:** использовать superpowers:executing-plans последовательно в текущей задаче. Пользователь явно выбрал продолжение здесь; перенос в новый чат, смена модели и subagents не требуются. Чекбоксы отмечаются только после выполнения, а не при чтении плана.

**Tech Stack:** JavaScript ES modules, Node test runner, Foundry VTT 13.351 / dnd5e 5.2.5, ApplicationV2, Handlebars, существующие typed gateway/coordinator/journal.

## Общие ограничения

- Прочитать [общий контракт исполнения](README.md) и профильную спецификацию до правок.
- Foundry minimum/verified 13; обязательный statuscounter >= 3.0.4.
- Единственный composition root — scripts/main.js; без второго владельца данных или raw socket bypass.
- Только lich_branch; до правок status/branch/fetch и сравнения с origin/main и origin/lich_branch.
- UI не пишет world settings; привилегированное действие валидируется и авторизуется у active GM.
- Все клиентские изменения: новая module.json version и синхронный scripts/main-<version>.js/esmodules.
- Методы/контракты документировать в docs/function-passport.md; public API — в README.md.
- UTF-8. Сначала failing focused test, затем минимальная реализация, focused green, live QA, полная проверка и commit/push.
- Приведённый JS — конкретные контракты/ядро тестов для планируемой реализации, а не код, уже добавленный в runtime. Новые символы определяются в задачах ниже; существующие названы с владельцем.

**Результат:** сундук/сумка выдаётся одной строкой с заранее сгенерированным содержимым. Оболочка, усовершенствования, вложенные вещи и все монеты учитываются в одном бюджете.

**Зависимости:** R8. Читать [спецификацию лутгена](../../specs/2026-09-07-module-development/lootgen.md), паспорт 8/13, storage-container-snapshot.js и storage-container-item-service.js только по traversal/materialization declarations.

**Граница:** generation depth default1/max3, existing runtime depth8 не меняется; общий cap200 documents, включая upgrades. Никаких новых traps/triggers/Journal rewards или отдельного nestedLoot tree.

## Задача R9.1 — одна модель snapshot и один расчёт цены дерева

**Файлы:** scripts/data/storage-container-snapshot.js, scripts/data/item-value.js, scripts/data/lootgen-item-descriptor.js; новый scripts/data/lootgen-container-value-adapter.js, tests/lootgen-container-value.test.mjs; расширить tests/storage-container-snapshot.test.mjs.

- [ ] Canonical nesting остаётся row.container в StorageContainerSnapshot v1. Для generated rows добавить optional composition metadata без поля container: {version:2,instanceKey,sourceType,sourceId,isBroken,upgrades}. Quantity остаётся row.quantity. Snapshot не содержит вторую полную копию того же дерева.
- [ ] Сведения о catalog shell корня хранить как state.lootgenComposition с тем же metadata shape. Outer descriptor.container ссылается на snapshot; при materialization/capture сохранять stable shell sourceId и установленный состав. Неподготовленные legacy snapshots по-прежнему читаются.
- [ ] Реализовать readContainerValueNodes(snapshot) → {containerId,entries,currencyValue}. entries — readonly projection неclaimed Item/container rows в общий descriptor v2, собираемый из row.composition и единственного row.container; root shell в entries не входит. currencyValue — оставшиеся manualCoins+generatedCoins с учётом существующего claimed state.
- [ ] Этот reader подключается в catalogReader R4. evaluateItemValue сам ведёт единственный traversal context seen instance/container IDs + depth + count. Не сбрасывать visited set на каждом child.
- [ ] Upgrade children входят в upgrades соответствующего host и не появляются второй ordinary contents row. Snapshot normalize/capture/remap должен сохранять такую границу, иначе value удвоится.
- [ ] Unknown price/неподтверждённая legacy композиция исключает новый budget candidate с diagnostic, но не блокирует старый переносимый контейнер как предмет в существующем storage UI.
- [ ] Ключевой value test использует buildStorageContainerSnapshot из существующего владельца и новый helper fixture makeValuedContainer({shellValue,upgradeValue,childValue,internalCoins}) в tests/helpers/lootgen-container-fixture.mjs. Helper создаёт настоящий v1 snapshot, model lookup и три стабильных descriptor identities, без mock, возвращающего готовую сумму:

```js
const { descriptor, catalogReader } = makeValuedContainer({
  shellValue: 1000, upgradeValue: 2000, childValue: 3000, internalCoins: 1000
});
const value = evaluateItemValue(descriptor, catalogReader);
assert.equal(value.baseValue, 1000);
assert.equal(value.upgradeValue, 2000);
assert.equal(value.contentsValue, 4000);
assert.equal(value.totalValue, 7000);
assert.equal(value.totalValue + 3000, 10000);
```

- [ ] Добавить nested shell, две валютные секции, claimed child, duplicate/shared identity, cycle и depth8/9; quantity контейнера>1 reject. Internal currency ни разу не попадает одновременно в child descriptor и top-level coins.

## Задача R9.2 — bounded generation и вместимость

**Файлы:** scripts/data/lootgen-generator.js, scripts/data/lootgen-template-catalog.js; новые scripts/data/lootgen-container-rules.js, tests/lootgen-container-budget.test.mjs, tests/lootgen-container-rules.test.mjs.

- [ ] Форма: enableFilledContainers=false у старых templates, filledContainerChance integer0..100, generationDepth default1/max3. itemCount продолжает ограничивать top-level rows, не скрытые children.
- [ ] Pure resolveLootgenContainerProfile(catalogRow) → {eligible,reason,capacity,weightlessContents}. capacity имеет проверенные тип/единицу/предел из existing dnd5e/storage adapter. Неизвестная жёсткая вместимость → ineligible, не Infinity.
- [ ] Pure canFitLootgenContents({profile,currentContents,candidate}) → {fits,reason}. Учитывать unit conversion, upgrades weight, уже занятый объём/вес и nested container policy. WeightlessContents меняет carried weight по существующему правилу, но не отменяет жёсткую вместимость оболочки.
- [ ] Один shared generation ledger: {itemBudgetRemaining,coinBudgetRemaining,documentsRemaining,attemptsRemaining}. Coin reserve считается ровно один раз до generation, как раньше. Child получает ограниченный sub-budget, но использует общий document/attempt cap.
- [ ] Алгоритм одной container candidate:
  1. проверить известную цену/профиль и цену shell+upgrades через R4;
  2. зарезервировать их из item budget;
  3. выбрать child allowance <= оставшемуся item budget и доступную долю уже существующего coin reserve;
  4. рекурсивно заполнить contents в пределах depth/capacity/count;
  5. вернуть неиспользованные item/coin allowance родителю;
  6. построить canonical snapshot и проверить итог evaluateItemValue;
  7. принять candidate целиком либо вернуть все её reservations.
- [ ] Не давать child исходный B и не вычислять новый процент coin reserve. При включённых монетах остаток в конце распределяется existing denomination logic; часть внутри уже вычтена из общей currency pool.
- [ ] Конкретный checked budget helper:

```js
export function debitLootgenBudget(remaining, amount) {
  if (!Number.isSafeInteger(remaining) || !Number.isSafeInteger(amount)
      || remaining < 0 || amount < 0 || amount > remaining) {
    throw new RangeError("Недостаточный или некорректный бюджет лута");
  }
  return remaining - amount;
}
```

Разместить helper в lootgen-container-rules.js; проверять multiplication/sum до вызова через R4 safe arithmetic.

- [ ] В result добавить totalValue, currencyValue и unusedValue. spentValue = стоимость всех shells/upgrades/предметов без валюты; currencyValue = внутренняя + внешняя валюта; totalValue = spentValue + currencyValue. Row.totalValue контейнера включает его содержимое и внутренние монеты, поэтому spentValue нельзя получить простым суммированием таких rows: ledger отдельно вычитает вложенную валюту. В примере B10000 spentValue6000, currencyValue4000, totalValue10000. Проверить также B = сумма top-level tree values + top-level currencyValue + unusedValue; unused>=0.
- [ ] Table tests: B0; ровно shell; shell дороже B; example10000=1000+2000+3000+1000+3000; reserve0/100; монеты выключены; unknown/zero price; глубина1/3; 200 documents с upgrades; exhausted attempts; не помещается вес; weightless contents; две одинаковые оболочки с разными instanceKey.
- [ ] Fixed random+ID factory воспроизводит полное дерево. Выключенный filled mode поверх выключенных upgrades сохраняет старые random calls/result. Любая невозможная ветка завершается diagnostic/обычной допустимой строкой, без бесконечного поиска.

## Задача R9.3 — материализация и перенос дерева с upgrade links

**Файлы:** scripts/data/storage-container-item-service.js, scripts/data/storage-container-snapshot.js, scripts/data/composite-item-graph.js, scripts/data/inventory-service.js; tests/storage-container-item-service.test.mjs, tests/storage-container-hierarchy.test.mjs, tests/composite-item-graph.test.mjs, tests/inventory-mutation-recovery.test.mjs.

- [ ] Расширить существующий StorageContainerItemService planner/#materializeChildren: для shell и ordinary row с composition вызывать graph builder R8, remap все IDs и links до Foundry create. Не создавать второй container materializer.
- [ ] Оболочка получает catalog ItemData/цену/профиль вместимости и portable storage flags. Не заменять её generic container без sourceId/стоимости. Parent link корня равен destination parent; upgrade child.system.container ссылается на host, обычный child — на containing container.
- [ ] Для всего root tree создать один подготовленный flattened document graph и persistent receipt с expected IDs/edges. Existing materializeToActorOnce signature сохранить; internal planner может получить adapters через constructor. Не считать найденный root достаточным доказательством полного grant.
- [ ] Один createEmbeddedDocuments batch с keepId; если запись частична, reconcile полный expected graph. Отдельные roots одного batch могут завершиться частично, но source row контейнера claimed только после всего его дерева.
- [ ] Перенести проверенный recovery pattern R8 в storage owner: prepared graph → created/verified → committed. Existing catch rollback не удаляет произвольно изменённые children; ambiguous identity/deletion/ACL drift → manual-review с сохранёнными receipts.
- [ ] captureFromItem()/rekeyStorageContainerSnapshot()/restoreItemTree() сохраняют upgrade-child связи, shell metadata и только оставшееся содержимое. Не включать installed upgrade дважды как ordinary child; не восстанавливать уже извлечённую вещь из старого portable snapshot.
- [ ] Для legacy контейнера с пользовательскими nested items перенос остаётся переносом текущего live состояния, а не реконструкцией из генератора. R9 metadata необязательна для существующих world Items.
- [ ] Fault matrix: shell only created; missing child; missing upgrade; mixed partial tree; links write/recovery; source commit lost ack; удаление committed target; новый GM; параллельный извлечению child перенос parent. Parent/child операции используют одну существующую root queue.
- [ ] Количество roots/обычных вещей/upgrades, currency и parent edges совпадают до/после generate→grant→capture→drop→pickup. Проверить cycle rejection ещё до первых writes.

## Задача R9.4 — preview, claim и приёмка

**Файлы:** scripts/ui/lootgen-app.js, scripts/ui/lootgen-chat.js, templates/lootgen-app.hbs, профильный chat template/styles; scripts/application/loot-claim-service.js, scripts/main.js; tests/lootgen-chat.test.mjs, tests/loot-claim-service.test.mjs, tests/lootgen-app-context.test.mjs.

- [ ] Показывать container одной top-level забираемой строкой. Preview раскрывает дерево и breakdown shell/upgrades/contents/internal coins; отображение не создаёт новые rows и не запускает random.
- [ ] Chat claim принимает только top-level row ID. Нельзя отправить child ID из preview либо parent+child одновременно; rejected request не делает частичную выдачу обходным путём.
- [ ] После materialization частичный доступ идёт через существующий Storage UI. Там сохраняются прежние правила доступа/папок/переноса; не добавлять второй mini-inventory внутри Chat.
- [ ] Два разных сундука не aggregate даже с одинаковыми source/contents. Reload и смена GM перечитывают trusted persisted result. Удалённый/забранный target не регенерируется при повторном открытии.
- [ ] Старые Chat v1 и сохранённые templates claimable. Boundary upgrade только добавляет representation defaults, не новую стоимость и random.
- [ ] Live полная цепочка: generation → reopen → Chat → группа/персонаж → открыть сундук → достать child → бросить/подобрать остаток → reload. Сверить value ledger, количество документов, upgrades и валюту после каждого шага.

**Итоговые focused:** node --test tests/lootgen-container-value.test.mjs tests/lootgen-container-budget.test.mjs tests/lootgen-container-rules.test.mjs tests/lootgen-composite-items.test.mjs tests/lootgen-generator.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs tests/storage-container-hierarchy.test.mjs tests/lootgen-chat.test.mjs tests/loot-claim-service.test.mjs tests/inventory-mutation-recovery.test.mjs.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

**Предлагаемые commits:** feat: budget generated loot container trees; feat: materialize nested loot with preserved item links.
