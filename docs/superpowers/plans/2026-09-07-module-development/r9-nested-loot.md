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

- [x] Canonical nesting остаётся row.container в StorageContainerSnapshot v1. Для generated rows добавить optional composition metadata без поля container: {version:2,instanceKey,sourceType,sourceId,isBroken,upgrades}. Quantity остаётся row.quantity. Snapshot не содержит вторую полную копию того же дерева.
- [x] Сведения о catalog shell корня хранить как state.lootgenComposition с тем же metadata shape. Outer descriptor.container ссылается на snapshot; при materialization/capture сохранять stable shell sourceId и установленный состав. Неподготовленные legacy snapshots по-прежнему читаются.
- [x] Реализовать readContainerValueNodes(snapshot) → {containerId,entries,currencyValue}. entries — readonly projection неclaimed Item/container rows в общий descriptor v2, собираемый из row.composition и единственного row.container; root shell в entries не входит. currencyValue — оставшиеся manualCoins+generatedCoins с учётом существующего claimed state.
- [x] Этот reader подключается в catalogReader R4. evaluateItemValue сам ведёт единственный traversal context seen instance/container IDs + depth + count. Не сбрасывать visited set на каждом child.
- [x] Upgrade children входят в upgrades соответствующего host и не появляются второй ordinary contents row. Snapshot normalize/capture/remap должен сохранять такую границу, иначе value удвоится.
- [x] Unknown price/неподтверждённая legacy композиция исключает новый budget candidate с diagnostic, но не блокирует старый переносимый контейнер как предмет в существующем storage UI.
- [x] Ключевой value test использует buildStorageContainerSnapshot из существующего владельца и новый helper fixture makeValuedContainer({shellValue,upgradeValue,childValue,internalCoins}) в tests/helpers/lootgen-container-fixture.mjs. Helper создаёт настоящий v1 snapshot, model lookup и три стабильных descriptor identities, без mock, возвращающего готовую сумму:

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

- [x] Добавить nested shell, две валютные секции, claimed child, duplicate/shared identity, cycle и depth8/9; quantity контейнера>1 reject. Internal currency ни разу не попадает одновременно в child descriptor и top-level coins.

## Задача R9.2 — bounded generation и вместимость

**Файлы:** scripts/data/lootgen-generator.js, scripts/data/lootgen-template-catalog.js; новые scripts/data/lootgen-container-rules.js, tests/lootgen-container-budget.test.mjs, tests/lootgen-container-rules.test.mjs.

- [x] Форма: enableFilledContainers=false у старых templates, filledContainerChance integer0..100, generationDepth default1/max3. itemCount продолжает ограничивать top-level rows, не скрытые children.
- [x] Pure resolveLootgenContainerProfile(catalogRow) → {eligible,reason,capacity,weightlessContents}. capacity имеет проверенные тип/единицу/предел из existing dnd5e/storage adapter. Неизвестная жёсткая вместимость → ineligible, не Infinity.
- [x] Pure canFitLootgenContents({profile,currentContents,candidate}) → {fits,reason}. Учитывать unit conversion, upgrades weight, уже занятый объём/вес и nested container policy. WeightlessContents меняет carried weight по существующему правилу, но не отменяет жёсткую вместимость оболочки.
- [x] Один shared generation ledger: {itemBudgetRemaining,coinBudgetRemaining,documentsRemaining,attemptsRemaining}. Coin reserve считается ровно один раз до generation, как раньше. Child получает ограниченный sub-budget, но использует общий document/attempt cap.
- [x] Алгоритм одной container candidate:
  1. проверить известную цену/профиль и цену shell+upgrades через R4;
  2. зарезервировать их из item budget;
  3. выбрать child allowance <= оставшемуся item budget и доступную долю уже существующего coin reserve;
  4. рекурсивно заполнить contents в пределах depth/capacity/count;
  5. вернуть неиспользованные item/coin allowance родителю;
  6. построить canonical snapshot и проверить итог evaluateItemValue;
  7. принять candidate целиком либо вернуть все её reservations.
- [x] Не давать child исходный B и не вычислять новый процент coin reserve. При включённых монетах остаток в конце распределяется existing denomination logic; часть внутри уже вычтена из общей currency pool.
- [x] Конкретный checked budget helper:

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

- [x] В result добавить totalValue, currencyValue и unusedValue. spentValue = стоимость всех shells/upgrades/предметов без валюты; currencyValue = внутренняя + внешняя валюта; totalValue = spentValue + currencyValue. Row.totalValue контейнера включает его содержимое и внутренние монеты, поэтому spentValue нельзя получить простым суммированием таких rows: ledger отдельно вычитает вложенную валюту. В примере B10000 spentValue6000, currencyValue4000, totalValue10000. Проверить также B = сумма top-level tree values + top-level currencyValue + unusedValue; unused>=0.
- [x] Table tests: B0; ровно shell; shell дороже B; example10000=1000+2000+3000+1000+3000; reserve0/100; монеты выключены; unknown/zero price; глубина1/3; 200 documents с upgrades; exhausted attempts; не помещается вес; weightless contents; две одинаковые оболочки с разными instanceKey.
- [x] Fixed random+ID factory воспроизводит полное дерево. Выключенный filled mode поверх выключенных upgrades сохраняет старые random calls/result. Любая невозможная ветка завершается diagnostic/обычной допустимой строкой, без бесконечного поиска.

## Задача R9.3 — материализация и перенос дерева с upgrade links

**Файлы:** scripts/data/storage-container-item-service.js, scripts/data/storage-container-snapshot.js, scripts/data/composite-item-graph.js, scripts/data/inventory-service.js; tests/storage-container-item-service.test.mjs, tests/storage-container-hierarchy.test.mjs, tests/composite-item-graph.test.mjs, tests/inventory-mutation-recovery.test.mjs.

- [x] Расширить существующий StorageContainerItemService planner/#materializeChildren: для shell и ordinary row с composition вызывать graph builder R8, remap все IDs и links до Foundry create. Не создавать второй container materializer.
- [x] Оболочка получает catalog ItemData/цену/профиль вместимости и portable storage flags. Не заменять её generic container без sourceId/стоимости. Parent link корня равен destination parent; upgrade child.system.container ссылается на host, обычный child — на containing container.
- [x] Для всего root tree создать один подготовленный flattened document graph и persistent receipt с expected IDs/edges. Existing materializeToActorOnce signature сохранить; internal planner может получить adapters через constructor. Не считать найденный root достаточным доказательством полного grant.
- [x] Один createEmbeddedDocuments batch с keepId; если запись частична, reconcile полный expected graph. Отдельные roots одного batch могут завершиться частично, но source row контейнера claimed только после всего его дерева.
- [x] Перенести проверенный recovery pattern R8 в storage owner: prepared graph → created/verified → committed. Existing catch rollback не удаляет произвольно изменённые children; ambiguous identity/deletion/ACL drift → manual-review с сохранёнными receipts.
- [x] captureFromItem()/rekeyStorageContainerSnapshot()/restoreItemTree() сохраняют upgrade-child связи, shell metadata и только оставшееся содержимое. Не включать installed upgrade дважды как ordinary child; не восстанавливать уже извлечённую вещь из старого portable snapshot.
- [ ] Для legacy контейнера с пользовательскими nested items перенос остаётся переносом текущего live состояния, а не реконструкцией из генератора. R9 metadata необязательна для существующих world Items.
- [ ] Fault matrix: shell only created; missing child; missing upgrade; mixed partial tree; links write/recovery; source commit lost ack; удаление committed target; новый GM; параллельный извлечению child перенос parent. Parent/child операции используют одну существующую root queue.
- [ ] Количество roots/обычных вещей/upgrades, currency и parent edges совпадают до/после generate→grant→capture→drop→pickup. Проверить cycle rejection ещё до первых writes.

## Задача R9.4 — preview, claim и приёмка

**Файлы:** scripts/ui/lootgen-app.js, scripts/ui/lootgen-chat.js, templates/lootgen-app.hbs, профильный chat template/styles; scripts/application/loot-claim-service.js, scripts/main.js; tests/lootgen-chat.test.mjs, tests/loot-claim-service.test.mjs, tests/lootgen-app-context.test.mjs.

- [x] Показывать container одной top-level забираемой строкой. Preview раскрывает дерево и breakdown shell/upgrades/contents/internal coins; отображение не создаёт новые rows и не запускает random.
- [x] Chat claim принимает только top-level row ID. Нельзя отправить child ID из preview либо parent+child одновременно; rejected request не делает частичную выдачу обходным путём.
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

## Реализация основы стоимости — 1.4.264

Добавлены exact composition metadata в canonical v1 snapshot и one-level value reader. Shared evaluator считает remaining children/manual+generated coins, проверяет общие IDs/depth8/documents200. Snapshot normalize/rekey/portable сохраняет source identity. Legacy snapshots читаются, но без подтверждённой composition не принимаются как новый priced candidate. Descriptor boundary для генерации пока по-прежнему не принимает container; bounded fill, capacity и tree grant/capture остаются открыты.

Проверки основы: focused `node --test tests/lootgen*.test.mjs tests/item-value.test.mjs tests/storage-container*.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/inventory-mutation-recovery.test.mjs` — **388 passed / 0 failed**. `node --test tests/*.test.mjs` — **3888 passed / 0 failed**; `node --check` **776 JS/MJS**, JSON parse **46**, ошибок **0**; `git diff --check` чисто. Native browser testovyj3/CODEX, Foundry13.351/dnd5e5.2.5: actual modules264 + detached canonical fixture дают total7000 (1000 shell+2000 upgrade+3000 child+1000 coins), после claimed child/coins —3000. World writes0. Сквозная generation→materialization→capture/drop/pickup ещё открыта.

## Основа вместимости — 1.4.265

Pure profile/fit/debit и physical catalog reader реализованы. В index добавлены weight/volume/capacity. Native dnd5e5.2.5 ContainerData хранит count/volume/weight, quantity1; computeCapacity штатно выбирает count либо weight и не оценивает физический объём вещей. У каталога обычных предметов volume пустой; пользователю направлен вопрос о первой версии проверки weight/count и только известного volume. До уточнения helper требует все объявленные measurements, отсутствующий volume даёт unknown-volume; filling пока не включён.

Native testovyj3/CODEX: 13 gear containers,7 имеют объявленные пределы,6 дают unknown-capacity. Сундук:300 lb/12 ft3; ровно300/12 помещается,301 lb отклоняется, неизвестный volume отклоняется. Источники прочитаны без world writes.

Проверки вместимости: focused `node --test tests/lootgen*.test.mjs tests/item-value.test.mjs tests/storage-container*.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/inventory-mutation-recovery.test.mjs` — **396 passed / 0 failed**. `node --test tests/*.test.mjs` — **3896 passed / 0 failed**; синтаксис **778 JS/MJS и 46 JSON**, ошибок **0**; `git diff --check` чисто. Полная генерация/выдача контейнеров по-прежнему не включена; после решения вопроса объёма нужны общий ledger, representation boundary, canonical materializer/capture и native lifecycle.

## Генерация в общем ledger — 1.4.266

Pure filling подключён к generateLootgenResult. Формы/templates сохраняют три новых поля с disabled defaults. Shared ledger/attempts/documents, nested upgraded children и coins, capacity rollback, depth1..3, unique roots, complete value invariant проверены. Политика объёма: вопрос был направлен пользователю; после отсутствия ответа явно принято предложенное допущение — weight/count обязательны, известный объём проверяется, неизвестный даёт diagnostic; volume-only при неизвестном содержимом исключён. Это рабочее допущение, а не полученное подтверждение.

Native testovyj3/CODEX, модули266, Foundry13.351/dnd5e5.2.5: реальный каталог сундука/молота/усовершенствований →18 child rows с18 upgrades; root tree5003 + external coins4997 =10000, spent4003/currency5997/unused0. Вес монеты0.02 lb прочитан из системы. Diagnostic volume-unverified ожидаем: физический объём предметов не задан. World writes0. Actual Item graph/claim ещё не делались.

R8 default form fingerprint совместим с уже сохранёнными ready/pending операциями, без reroll. До подключения R9.3 raw container descriptor не может уйти в root-only Inventory builder; storage template generation тоже отвергает filled mode. Не включено в UI и выдачу. Следующий этап — расширить canonical StorageContainerItemService planner/receipt и descriptor/materialization boundary, затем Chat/UI и native lifecycle.

Проверки генератора: focused `node --test tests/lootgen*.test.mjs tests/item-value.test.mjs tests/storage-container*.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/inventory-mutation-recovery.test.mjs tests/group-command-dispatch.test.mjs` — **470 passed / 0 failed**. `node --test tests/*.test.mjs` — **3914 passed / 0 failed**; `node --check` **780 JS/MJS**, JSON parse **46**, ошибок **0**; `git diff --check` чисто. Старые cache assertions обновлены вслед за inventory entrypoint до полного прогона. R9.3/R9.4 остаются открыты.


## R9.3 — дерево, capture и recovery (1.4.267)

Canonical StorageContainerItemService получил единый detached planner с catalog shell/host upgrades и persistent receipt в существующем inventory journal. Pending partial writes восстанавливаются по сохранённым IDs; изменённые/удалённые наблюдавшиеся Items требуют сверки. Capture хранит только фактический остаток, upgrades внутри host graph, shell ItemData в presentation; native ep переводится в sp с сохранением value. Native grant→capture→restore прошёл для 3 настоящих Item с монетами, QA Actors удалены. Focused расширенного storage/lootgen/runtime набора до последней защитной проверки — 485 passed / 0 failed; окончательный focused storage-container-item-service + runtime-item-graph — 31/0. Полный node --test tests/*.test.mjs на итоговом коде — 3927 passed / 0 failed. node --check: 780 JS/MJS; JSON parse: 46; ошибок 0. git diff --check чисто. Native partial batch 3→1 затем retry создаёт только 2 missing, terminal deletion не регенерируется; QA Actors удалены.

Открыто: descriptor/prepared result boundary и nested catalog fingerprint, Chat/UI R9.4, полная сквозная generation→claim→scene drop/pickup с active GM/player и source-debit recovery. Объём неизвестных предметов остаётся рабочим допущением R9.2. Legacy custom effects проверяются сохранением live transport; нестандартные привязки custom effects требуют отдельной проверки.


## R9.3/R9.4 — prepared boundary и socket (1.4.268)

Полный container descriptor проходит bounded tree validation и canonical planner при подготовке сохранённого результата. Prepared marker проверяет каждый host/upgrade/parent/currency; container compositionKey SHA-256 занимает71 символ вместо полного дерева. Typed prepare/publish возвращают компактные ссылки, public API ждёт репликацию Chat без reroll. Fingerprint учитывает nested source prices/capacities/coin weight. Character/party ingress восстанавливают partial tree и списывают source только после всех Item. Запрос preview child либо parent+child отвергается до любых writes.

Native testovyj3/CODEX13.351/dnd5e5.2.5: настоящее дерево38 Item, state263874 bytes, value5003 до/после native grant/capture, полный ledger10000; QA Actor удалён. Chat publish/active-GM socket этим тестом не выполнялись. Открыто: controls enableFilledContainers/chance/depth, preview tree и breakdown, storage template path, полный пользовательский lifecycle/две сессии.

Проверки 1.4.268: focused lootgen/storage/inventory/contracts — 580 passed / 0 failed; после strict top-level claim focused loot-claim-service/group-command-dispatch/inventory-mutation-recovery —154/0. Итоговый node --test tests/*.test.mjs —3940 passed / 0 failed. node --check —784 JS/MJS; JSON parse —46; ошибок0. git diff --check чисто. Live evidence указан выше; UI и multiplayer checks остаются открыты.


## R9.4 — настройки и просмотр дерева (1.4.269)

В окне доступны enableFilledContainers/chance/depth; эти поля сохраняются в шаблоне, filled-only использует ту же устойчивую подготовку GM. Saved compositionValues содержит плоскую разбивку цены каждого узла. Контейнер остаётся одной забираемой строкой; DialogV2 раскрывает tree, улучшения, основу/contents/internal coins/итого без дочерних действий. Старые сохранённые строки без breakdown показывают состав без переоценки. Монеты снаружи и внутри различаются и не дублируются после claim внешних монет.

Native testovyj3, CODEX, Foundry13.351/dnd5e5.2.5, viewport1292×920: detached actual catalog result, 26 hosts (25 внутри), 23 upgrades, root5995 + external4005 =10000; предметы4011 + внутренние1984 + внешние4005=10000. UI использовал read-only projection API с контрактом persisted v2; настоящие Chat/socket/claim в этом тесте не выполнялись. Preview открывался кнопкой строки: начало дерева сверху, scroll только content, footer виден; chance135→100/depth9→3. QA окна закрыты, временный stylesheet удалён; world Documents не создавались. Полный multiuser lifecycle и storage-template path остаются открытыми.

Проверки1.4.269: focused50/0; module-manifest33/0; `node --test tests/*.test.mjs` — **3946 passed / 0 failed**. Первый полный прогон3942/4 выявил только устаревшие version/cache assertions, после обновления ожиданий повторный полный прогон чист. `node --check`786 JS/MJS и JSON parse46 —0ошибок; изменённый после прогона manifest test отдельно проверен `node --check`. `git diff --check` чисто.


## R9 — шаблон при первом открытии хранилища (1.4.270)

Подключён generateStorageLoot для upgrades/filled: общий prepared generator, одна сохранённая storage row на контейнер, explicit graph для обычного улучшенного предмета. Новый capturePreparedContainer использует тот же private capture traversal, что live captureFromItem; хранит per-host native data/effects и links без повторного чтения каталога при выдаче. Исправлены browser cache imports normalizer у storage/template owners, чтобы сохранение шаблона не теряло enableFilledContainers/chance/depth.

Focused239/0 (storage-container-item-service, group-command-dispatch, storage-service, storage-container-hierarchy, storage-socket), cache/template47/0. Native testovyj3/CODEX13.351/dnd5e5.2.5: actual catalog → detached preparation → capturePreparedContainer → prepareItemGraph с запрещённым catalog read → native temporary Actor materialization → live capture. 38/38 Item, 18 ordinary rows до/после,19 upgrades,1000cp до/после. QA Actor удалён. Это не проверка active-GM generateStorageLoot/socket: CODEX не active GM, полномочия не подменялись; route/default first-open поведение проверено focused-тестом, включая запись-then-throw и новый экземпляр сервиса без reroll. Multiuser lifecycle и оставшаяся fault matrix остаются открытыми.

Полная проверка1.4.270: `node --test tests/*.test.mjs` — **3947 passed / 0 failed**; `node --check`786 JS/MJS, JSON parse46 —0ошибок. `git diff --check` чисто. Следующий независимый этап R10; незакрытые строки R9/native multiplayer сохраняются в плане.

## R9.3 — parent/child reservation после сбоя source debit (1.4.274)

Fault tests выявили два пути дублирования: одиночная и bulk выдача сундука успевали создать target, но после ошибки source debit исходные child оставались доступными новой операции. Добавлена persistent root reservation на существующих bulkClaimMutations; она блокирует остальные изменения исходного storage до завершения оригинального переноса. Retry хранит stable grant/batch identity и закрывает debit/marker без нового target. Подтверждённый source debit позволяет закончить retry даже после удаления target, не воссоздавая его. Изменённый получатель не отравляет local fingerprint cache.

Семь новых сценариев tests/storage-socket: child-first/parent-first queue; failure→restart→child/coins/all/deposit/whole-token blocked→fresh single retry; lost debit ack; marker failure после debit; party batch identity; bulk parent reservation. До исправления новые одиночный/bulk failure cases падали Missing expected rejection. Профиль storage-socket/storage-container-item-service/runtime-item-graph/group-command-dispatch —204 passed/0 failed. Полная native generator→claim→extract→drop/pickup/reload и остальные fault cases остаются открытыми; этот результат не заменяет их.

Полная проверка1.4.274: node --test tests/*.test.mjs —4004 passed/0 failed; node --check796 JS/MJS и JSON parse46 —0 ошибок. git diff --check чисто; version/forwarder274 и storage-command-service cache274 синхронизированы. Рабочие изменения ограничены owner, focused tests, manifest/README/паспортом/планом.

## R9 — сохранность оболочки через сцену (1.4.277)

Native последовательность legacy container → извлечь child → dropPortableStorageItemToScene через CODEX→Gamemaster прошла: у Actor остались только извлечённые3 единицы. moveStorageTokenToCharacter создал3 Item, затем отказал graph-manual-review и восстановил источник. Сравнение сохранённого expected graph с dnd5e toObject показало единственное несовпадение system.type.value=backpack; у container такого native поля нет. Также Token boundary терял presentation.itemData оболочки: custom flags, исходные свойства и root upgrades могли замениться generic builder.

Исправлены оба владельца: portable generic builder не пишет неподдерживаемое поле; restoreSnapshotToScene/buildStorageContainerSnapshotFromToken сохраняют только shell presentation через storageContainerItemPresentation, сохраняя единственный актуальный storage state для содержимого. Native owner277 с локальным journal на реальных Actor/Token подтвердил custom shell flag, вложенность двух контейнеров, количество2/описание/custom flag остатка, валюту3gp+4sp и отсутствие извлечённых3 единиц в дереве; generic grant тоже проходит, pending0. Новый focused случай дополнительно проверяет root installed upgrade и remap hostActorId после scene round trip. Focused snapshot/item-service/deposit-source/registration/manifest —99/0.

Временные Actor n28UP6jiedNv6C0d и Actor проверки исправления, исходный/fixed QA Token удалены (остаток0). Receipt только воспроизведённого QA сбоя явно завершён cancelled/qaCleanup после удаления fixtures. Новая реализация проверена через native owner, но повтор настоящего typed GM pickup277 ещё требует загрузки новых handlers в Gamemaster; полный Chat/multiuser release gate остаётся открытым. Статические чекбоксы ниже не заменяют эту границу доказательства.
`node --test tests/*.test.mjs`: **4015 passed / 0 failed**; синтаксис796 JS/MJS и JSON46 —0 ошибок. `git diff --check` чисто.
