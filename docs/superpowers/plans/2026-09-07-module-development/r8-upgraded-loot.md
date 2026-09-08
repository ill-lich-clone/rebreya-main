# R8 — улучшенные предметы в лутгене

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

**Результат:** лутген выбирает готовый host с совместимыми усовершенствованиями, учитывает их полную цену и выдаёт тот же экземпляр из результата/Chat ровно один раз.

**Зависимости:** R3/R4; existing-curse и уже готовые simple-implemented из R7. Читать [спецификацию лутгена](../../specs/2026-09-07-module-development/lootgen.md), паспорт 7/13/14, затем declarations в lootgen-generator.js, loot-claim-service.js, inventory-service.js. Контейнерное содержимое добавляет R9.

## Задача R8.1 — versioned descriptor и совместимые templates

**Файлы:** создать scripts/data/lootgen-item-descriptor.js, tests/lootgen-item-descriptor.test.mjs; изменить scripts/data/lootgen-generator.js, scripts/data/lootgen-template-catalog.js, tests/lootgen-template-catalog.test.mjs.

- [ ] Реализовать normalizeLootgenItemDescriptor(raw,{legacy=false}={}), validateLootgenItemDescriptor(raw) и getLootgenAggregationKey(descriptor) по общему DTO README. Strict v2 запрещает лишние поля, неизвестный sourceType, невалидные IDs/choices, duplicate instanceKey/slotIndex, unsafe quantity/value.
- [ ] Legacy v1 adapters принимают старую plain row без новых полей и дают plain descriptor на boundary. Сохранённую выдачу не пересчитывать случайно. Existing шаблоны без upgrade options получают enableUpgrades=false, upgradeChance=0, maxUpgradesPerItem=1 и пустой разрешающий фильтр; последний не включает unavailable profiles.
- [ ] Добавить к форме enableUpgrades:boolean, upgradeChance:integer 0..100, maxUpgradesPerItem:integer>=1, upgradeTypes и upgradeRanks с whitelists. Верхний фактический предел слотов берётся у host, не из пользовательского числа.
- [ ] SourceId усовершенствования — stable catalog gear ID, связанный manifest с productId. Документный Item ID не становится catalog ID; sourceType для upgrade lookup явно gear.
- [ ] Plain key сохраняет старые sourceType/sourceId/isBroken semantics. Любой host с upgrades получает отдельный instanceKey, quantity=1 и собственную строку даже при совпадении состава.
- [ ] Конкретное ядро проверки identity:

```js
const base = {
  version: 2, sourceType: "gear", sourceId: "sword", quantity: 1,
  isBroken: false, container: null,
  upgrades: [{ instanceKey: "u-a", sourceId: "sharp", slotIndex: 1, choices: {} }]
};
const a = { ...base, instanceKey: "host-a" };
const b = { ...base, instanceKey: "host-b",
  upgrades: [{ ...base.upgrades[0], instanceKey: "u-b" }] };
assert.notEqual(getLootgenAggregationKey(a), getLootgenAggregationKey(b));
assert.throws(() => normalizeLootgenItemDescriptor({ ...a, quantity: 2 }));
assert.throws(() => normalizeLootgenItemDescriptor({ ...a, effects: ["arbitrary"] }));
```

- [ ] Обновить aggregateRows(): сохранить composition и instance identity, не терять вторую nonstackable строку в прежнем map. Plain legacy branch с выключенными новыми опциями не потребляет дополнительные random calls.
- [ ] IDs вариантов брать из injected createInstanceKey, random — из injected random. Тестовая reproducibility использует оба детерминированных источника; Date.now/randomUUID не должны скрыто менять ожидаемые результаты.

**Проверка:** node --test tests/lootgen-item-descriptor.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-template-catalog.test.mjs tests/lootgen-multiple-appearance.test.mjs tests/lootgen-durability.test.mjs.

## Задача R8.2 — выбор совместимого варианта внутри бюджета

**Файлы:** scripts/data/lootgen-generator.js, scripts/data/item-upgrade-rules.js, scripts/data/item-value.js; новый tests/lootgen-composite-items.test.mjs.

- [ ] Вынести локальный pure helper chooseLootgenUpgradeVariant({host,remainingValue,form,catalogReader,manifest,random,createInstanceKey}) → {descriptor,value,diagnostics}. generateLootgenResult остаётся единственным публичным random/budget owner.
- [ ] Сначала сформировать конечный список available совместимых profiles по R4. Проверить host capacity/slot, type/rank, всю availability и обязательные choices. standalone upgrades по-прежнему исключены isLootgenUpgrade().
- [ ] Если профиль допускает finite choices, выбирать только из его whitelist и сохранить результат в descriptor. Отсутствие допустимого/согласованного choice исключает variant с причиной, а не создаёт невалидную установку.
- [ ] При выпадении upgrade chance собрать variant, оценить полную стоимость через evaluateItemValue, затем принять его только при totalValue<=remainingValue. При нехватке бюджета попробовать доступный ограниченный набор; после исчерпания оставить обычный host, если он сам помещается.
- [ ] Ограничить число попыток отдельно от успешного itemCount: max 2000 попыток на generation, плюс общий document cap 200 с учётом upgrade children. Нулевые цены не создают бесконечный цикл; unknown price не участвует.
- [ ] Safe integer проверять до умножения/вычитания. Старый spentValue сохраняет смысл суммы стоимости предметных строк; upgrades входят в стоимость host, не отдельным вторым слагаемым.
- [ ] Fixed fixtures: base1000+upgrade200+upgrade300=1500; budget1499 не принимает этот вариант; budget1500 принимает; host capacity1 отвергает второй child; same source с двумя различными variant даёт две строки. Проверить zero, unknown, отрицательное/overflow, broken policy, chance0/100 и coin reserve0/100.
- [ ] Выполнить legacy parity: те же inputs и последовательность random при выключенной опции дают прежние rows/coins/spentValue. Сравнение не ограничивать числом строк.

## Задача R8.3 — подготовленный граф Item, а не повторная установка при claim

**Файлы:** создать scripts/data/composite-item-graph.js, tests/composite-item-graph.test.mjs; изменить scripts/data/inventory-service.js и scripts/data/inventory-ingress-descriptor.js, профильный inventory ingress executor/planner по паспорту; tests/inventory-ingress-descriptor.test.mjs, tests/inventory-mutation-recovery.test.mjs.

- [ ] Реализовать async buildCompositeItemGraph(descriptor,{buildBase,buildUpgrade,createDocumentId}) из общего README. В R8 descriptor.container должен быть null. Результат {rootItemId,documents,links}; функция не пишет Foundry documents.
- [ ] Сначала validate installation/value/choices на trusted model. Построить detached base и children через существующие Item builders, назначить новые IDs, сохранить source flags/исходный профиль; не импортировать live actor ownership, transfer receipts или старые installed document IDs из compendium.
- [ ] Host flags.itemUpgrades.installed ссылаются на новые child IDs, child flags.installedUpgrade.hostItemId и system.container — на rootItemId. Реальные названия flags брать из ITEM_UPGRADES_HOST_FLAG/INSTALLED_UPGRADE_FLAG владельца, не из догадки. slotIndex начинается с 1.
- [ ] Проверка графа:

```js
let nextId = 0;
const graph = await buildCompositeItemGraph({
  version: 2, instanceKey: "h", sourceType: "gear", sourceId: "sword",
  quantity: 1, isBroken: false, container: null,
  upgrades: [{ instanceKey: "u", sourceId: "sharp", slotIndex: 1, choices: {} }]
}, {
  buildBase: async () => ({ name: "Меч", type: "weapon", system: { quantity: 1 }, flags: {} }),
  buildUpgrade: async () => ({ name: "Острота", type: "loot", system: { quantity: 1 }, flags: {} }),
  createDocumentId: () => String(++nextId).padStart(16, "0")
});
assert.equal(graph.documents.length, 2);
assert.equal(new Set(graph.documents.map(d => d._id)).size, 2);
assert.equal(graph.links[0].hostItemId, graph.rootItemId);
const child = graph.documents.find(d => d._id === graph.links[0].upgradeItemId);
assert.equal(child.system.container, graph.rootItemId);
```

- [ ] Интегрировать граф как одну ingress row/единицу результата. Сначала journal prepared с полным набором IDs и детерминированным fingerprint; затем один createEmbeddedDocuments batch с keepId. Partial batch возможен: receipt проверяет весь ожидаемый graph, не только существование root.
- [ ] Retry восстанавливает только недостающие documents/links с теми же IDs, либо сообщает manual-review при несовместимой чужой правке. Удалённый после committed grant Item не создаётся заново. Compensation удаляет только собственные подтверждённые новые документы и не затрагивает unrelated edits.
- [ ] Не вызывать публичный installItemUpgrade() для каждого child после выдачи: он имеет свой split/refresh и породит второй workflow. Graph builder формирует те же canonical links, обычный upgrade sync R7/curse owner включается после единого успешного ingress.
- [ ] buildInventoryIngressDescriptor получает полную unitValue составного host и compositionKey. captureInventoryIngressIdentity включает compositionKey в v2 identity; plain legacy identity сохраняется. Новый serialized plan version с exact parser для v1/v2, без silently accepted extra fields.
- [ ] Preview и authoritative parity сравнивают composition/choices, не только sourceId/quantity. Filter folder/skip применяется ко всему host; slot children не проходят второй независимый matcher. Если dismantle не поддерживает составной host целиком, пометить его недоступным для dismantle с видимой причиной; не уничтожать children при разборе одной оболочки.
- [ ] CompositionKey вычисляется канонически из структуры/choices и instanceKey; порядок полей объекта choices не должен менять fingerprint. Client hash сам по себе не является доказательством доверия.

## Задача R8.4 — trusted result, Chat и выдача

**Файлы:** scripts/main.js, scripts/ui/lootgen-app.js, scripts/ui/lootgen-chat.js, scripts/application/loot-claim-service.js, templates/lootgen-app.hbs и фактический chat template через rg; tests/lootgen-chat.test.mjs, tests/loot-claim-service.test.mjs, tests/lootgen-app-context.test.mjs, tests/group-command-dispatch.test.mjs.

- [ ] Для нового composed режима ввести GM-only public prepareLootgenGeneratedResult(form) и typed lootgen.prepare-result с exact normalized form/operationId. Active GM генерирует один immutable result v2; request не содержит ItemData, arbitrary effects, price или готовый player graph.
- [ ] Хранить подготовленный result в существующем trusted GM-authored Lootgen ChatMessage state через его canonical publisher. Подготовка для прямой выдачи создаёт запись, видимую только GM; публикация игрокам раскрывает ту же запись, не генерирует вторую. Обычный legacy plain preview сохраняет старое поведение.
- [ ] prepare receipt связывает operationId, lootId, form fingerprint и message. Повтор запроса возвращает тот же result. Если запись уже создана, а ответ потерялся, находить её по receipt до нового random.
- [ ] UI «Забрать»/прямая выдача для composed rows использует существующий trusted claim route по lootId/rowIds. Клиент передаёт destination/ingress choices и operation ID; список upgrades active GM читает из записи. Не расширять generic direct ingress правом принять player composition.
- [ ] Сохранить прежний смысл sourceOrigin для plain/manual/model callers. Там, где отображение требует новый resultVersion, читать v1 без перерасчёта; v2 snapshot сохраняет принятый value и catalog/rules fingerprint.
- [ ] До первой выдачи при несовместимом изменении каталога/availability показать stale result и предложить новую генерацию. После prepared graph/grant receipt recovery использует сохранённые trusted данные; catalog drift не запускает новую выдачу и не переписывает уже полученные вещи.
- [ ] LootClaimService.claimBatch и acceptedRowIds сохраняют частичный успешный outcome между top-level rows. Внутри одного составного host root+children — неделимая выдача; source claimed только после подтверждения всего graph.
- [ ] UI показывает upgrades, totalValue и automation status; имена/choices экранированы. Tooltip/preview не меняет descriptor и не запускает random.
- [ ] Fault tests после prepared result, Chat write, host/child create, link check, target receipt и source claimed write; повторный claim, другой destination с тем же ID, hostile source refs и частичный успех batch.
- [ ] Live: generate → повторно открыть → опубликовать → забрать в группу/персонажу → equip → передать. Два одинаковых base с разными upgrades остаются разными, их эффекты включает один канонический owner.

**Итоговые focused:** node --test tests/lootgen-item-descriptor.test.mjs tests/lootgen-composite-items.test.mjs tests/composite-item-graph.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-template-catalog.test.mjs tests/lootgen-app-context.test.mjs tests/lootgen-chat.test.mjs tests/loot-claim-service.test.mjs tests/item-upgrade-service.test.mjs tests/inventory-ingress-descriptor.test.mjs tests/inventory-ingress-planner.test.mjs tests/inventory-mutation-recovery.test.mjs tests/group-command-dispatch.test.mjs.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

**Предлагаемые commits:** feat: generate budgeted upgraded loot variants; feat: claim composed loot through trusted item graphs.

## Первая часть — 1.4.256

Реализованы strict/legacy descriptor, composition aggregation, finite upgrade variant с полной ценой и общим пределом2000 попыток, отдельные IDs одинаковых hosts, safe budget/price, новые defaults формы и detached graph builder. Дополнительные зависимости builder: trusted manifest для повторной проверки всего состава и actorId на стадии подготовки выдачи. Reader получает describeUpgradeHost(hostRow); выбор типа поглощения использует готовый R7 validator. Контракты — [паспорт составного лута](../../../lootgen-composite-function-passport.md).

Проверены exact1500/short1499, два одинаковых base с отдельными composition, capacity1, disabled/zero chance, type/rank/availability filters, unknown price, unsafe budget, duplicate identities и legacy result/random parity. Graph tests проверяют новые IDs и forward/reverse links без записей. Последний focused до документации: `node --test tests/lootgen*.test.mjs tests/composite-item-graph.test.mjs tests/module-manifest.test.mjs` — **111 passed / 0 failed**.

**Ещё не сделано:** trusted GM generation/Chat state, catalog reader на реальных источниках, UI опций и preview, graph ingress/journal recovery, claim/source receipts, native приёмка. R8 не завершён; генерация составных строк пока не включается из пользовательского UI.

Проверка первой части: `node --test tests/*.test.mjs` — **3810 passed / 0 failed**; синтаксис **762 JS/MJS и 46 JSON, 0 ошибок**; `git diff --check` чисто. Новое включённое поведение проверено pure/focused-тестами, без заявления native UI/claim готовности.
