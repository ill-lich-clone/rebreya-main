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

- [x] Реализовать normalizeLootgenItemDescriptor(raw,{legacy=false}={}), validateLootgenItemDescriptor(raw) и getLootgenAggregationKey(descriptor) по общему DTO README. Strict v2 запрещает лишние поля, неизвестный sourceType, невалидные IDs/choices, duplicate instanceKey/slotIndex, unsafe quantity/value.
- [x] Legacy v1 adapters принимают старую plain row без новых полей и дают plain descriptor на boundary. Сохранённую выдачу не пересчитывать случайно. Existing шаблоны без upgrade options получают enableUpgrades=false, upgradeChance=0, maxUpgradesPerItem=1 и пустой разрешающий фильтр; последний не включает unavailable profiles.
- [x] Добавить к форме enableUpgrades:boolean, upgradeChance:integer 0..100, maxUpgradesPerItem:integer>=1, upgradeTypes и upgradeRanks с whitelists. Верхний фактический предел слотов берётся у host, не из пользовательского числа.
- [x] SourceId усовершенствования — stable catalog gear ID, связанный manifest с productId. Документный Item ID не становится catalog ID; sourceType для upgrade lookup явно gear.
- [x] Plain key сохраняет старые sourceType/sourceId/isBroken semantics. Любой host с upgrades получает отдельный instanceKey, quantity=1 и собственную строку даже при совпадении состава.
- [x] Конкретное ядро проверки identity:

```js
const base = {
  version: 2, sourceType: "gear", sourceId: "sword", quantity: 1,
  isBroken: false, container: null,
  upgrades: [{ instanceKey: "u-a", sourceId: "zacharovanie-ostroty", slotIndex: 1, choices: {} }]
};
const a = { ...base, instanceKey: "host-a" };
const b = { ...base, instanceKey: "host-b",
  upgrades: [{ ...base.upgrades[0], instanceKey: "u-b" }] };
assert.notEqual(getLootgenAggregationKey(a), getLootgenAggregationKey(b));
assert.throws(() => normalizeLootgenItemDescriptor({ ...a, quantity: 2 }));
assert.throws(() => normalizeLootgenItemDescriptor({ ...a, effects: ["arbitrary"] }));
```

- [x] Обновить aggregateRows(): сохранить composition и instance identity, не терять вторую nonstackable строку в прежнем map. Plain legacy branch с выключенными новыми опциями не потребляет дополнительные random calls.
- [x] IDs вариантов брать из injected createInstanceKey, random — из injected random. Тестовая reproducibility использует оба детерминированных источника; Date.now/randomUUID не должны скрыто менять ожидаемые результаты.

**Проверка:** node --test tests/lootgen-item-descriptor.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-template-catalog.test.mjs tests/lootgen-multiple-appearance.test.mjs tests/lootgen-durability.test.mjs.

## Задача R8.2 — выбор совместимого варианта внутри бюджета

**Файлы:** scripts/data/lootgen-generator.js, scripts/data/item-upgrade-rules.js, scripts/data/item-value.js; новый tests/lootgen-composite-items.test.mjs.

- [x] Вынести локальный pure helper chooseLootgenUpgradeVariant({host,remainingValue,form,catalogReader,manifest,random,createInstanceKey}) → {descriptor,value,diagnostics}. generateLootgenResult остаётся единственным публичным random/budget owner.
- [x] Сначала сформировать конечный список available совместимых profiles по R4. Проверить host capacity/slot, type/rank, всю availability и обязательные choices. standalone upgrades по-прежнему исключены isLootgenUpgrade().
- [x] Если профиль допускает finite choices, выбирать только из его whitelist и сохранить результат в descriptor. Отсутствие допустимого/согласованного choice исключает variant с причиной, а не создаёт невалидную установку.
- [x] При выпадении upgrade chance собрать variant, оценить полную стоимость через evaluateItemValue, затем принять его только при totalValue<=remainingValue. При нехватке бюджета попробовать доступный ограниченный набор; после исчерпания оставить обычный host, если он сам помещается.
- [x] Ограничить число попыток отдельно от успешного itemCount: max 2000 попыток на generation, плюс общий document cap 200 с учётом upgrade children. Нулевые цены не создают бесконечный цикл; unknown price не участвует.
- [x] Safe integer проверять до умножения/вычитания. Старый spentValue сохраняет смысл суммы стоимости предметных строк; upgrades входят в стоимость host, не отдельным вторым слагаемым.
- [x] Fixed fixtures: base1000+upgrade200+upgrade300=1500; budget1499 не принимает этот вариант; budget1500 принимает; host capacity1 отвергает второй child; same source с двумя различными variant даёт две строки. Проверить zero, unknown, отрицательное/overflow, broken policy, chance0/100 и coin reserve0/100.
- [x] Выполнить legacy parity: те же inputs и последовательность random при выключенной опции дают прежние rows/coins/spentValue. Сравнение не ограничивать числом строк.

## Задача R8.3 — подготовленный граф Item, а не повторная установка при claim

**Файлы:** создать scripts/data/composite-item-graph.js, tests/composite-item-graph.test.mjs; изменить scripts/data/inventory-service.js и scripts/data/inventory-ingress-descriptor.js, профильный inventory ingress executor/planner по паспорту; tests/inventory-ingress-descriptor.test.mjs, tests/inventory-mutation-recovery.test.mjs.

- [x] Реализовать async buildCompositeItemGraph(descriptor,{buildBase,buildUpgrade,createDocumentId}) из общего README. В R8 descriptor.container должен быть null. Результат {rootItemId,documents,links}; функция не пишет Foundry documents.
- [x] Сначала validate installation/value/choices на trusted model. Построить detached base и children через существующие Item builders, назначить новые IDs, сохранить source flags/исходный профиль; не импортировать live actor ownership, transfer receipts или старые installed document IDs из compendium.
- [x] Host flags.itemUpgrades.installed ссылаются на новые child IDs, child flags.installedUpgrade.hostItemId и system.container — на rootItemId. Реальные названия flags брать из ITEM_UPGRADES_HOST_FLAG/INSTALLED_UPGRADE_FLAG владельца, не из догадки. slotIndex начинается с 1.
- [x] Проверка графа:

```js
let nextId = 0;
const graph = await buildCompositeItemGraph({
  version: 2, instanceKey: "h", sourceType: "gear", sourceId: "sword",
  quantity: 1, isBroken: false, container: null,
  upgrades: [{ instanceKey: "u", sourceId: "zacharovanie-ostroty", slotIndex: 1, choices: {} }]
}, {
  manifest: [{ productId: "zacharovanie-ostroty", decision: "simple-implemented", profile: { compatibility: ["weapon"] } }],
  buildBase: async () => ({ name: "Меч", type: "weapon", system: { quantity: 1 }, flags: { "rebreya-main": { itemUpgrades: { capacity: 1, installed: [] } } } }),
  buildUpgrade: async () => ({ name: "Острота", type: "loot", system: { quantity: 1 }, flags: {} }),
  createDocumentId: () => String(++nextId).padStart(16, "0")
});
assert.equal(graph.documents.length, 2);
assert.equal(new Set(graph.documents.map(d => d._id)).size, 2);
assert.equal(graph.links[0].hostItemId, graph.rootItemId);
const child = graph.documents.find(d => d._id === graph.links[0].upgradeItemId);
assert.equal(child.system.container, graph.rootItemId);
```

- [x] Интегрировать граф как одну ingress row/единицу результата. Сначала journal prepared с полным набором IDs и детерминированным fingerprint; затем один createEmbeddedDocuments batch с keepId. Partial batch возможен: receipt проверяет весь ожидаемый graph, не только существование root.
- [x] Retry восстанавливает только недостающие documents/links с теми же IDs, либо сообщает manual-review при несовместимой чужой правке. Удалённый после committed grant Item не создаётся заново. Compensation удаляет только собственные подтверждённые новые документы и не затрагивает unrelated edits.
- [x] Не вызывать публичный installItemUpgrade() для каждого child после выдачи: он имеет свой split/refresh и породит второй workflow. Graph builder формирует те же canonical links, обычный upgrade sync R7/curse owner включается после единого успешного ingress.
- [x] buildInventoryIngressDescriptor получает полную unitValue составного host и compositionKey. captureInventoryIngressIdentity включает compositionKey в v2 identity; plain legacy identity сохраняется. Новый serialized plan version с exact parser для v1/v2, без silently accepted extra fields.
- [x] Preview и authoritative parity сравнивают composition/choices, не только sourceId/quantity. Filter folder/skip применяется ко всему host; slot children не проходят второй независимый matcher. Если dismantle не поддерживает составной host целиком, пометить его недоступным для dismantle с видимой причиной; не уничтожать children при разборе одной оболочки.
- [x] CompositionKey вычисляется канонически из структуры/choices и instanceKey; порядок полей объекта choices не должен менять fingerprint. Client hash сам по себе не является доказательством доверия.

## Задача R8.4 — trusted result, Chat и выдача

**Файлы:** scripts/main.js, scripts/ui/lootgen-app.js, scripts/ui/lootgen-chat.js, scripts/application/loot-claim-service.js, templates/lootgen-app.hbs и фактический chat template через rg; tests/lootgen-chat.test.mjs, tests/loot-claim-service.test.mjs, tests/lootgen-app-context.test.mjs, tests/group-command-dispatch.test.mjs.

- [x] Для нового composed режима ввести GM-only public prepareLootgenGeneratedResult(form) и typed lootgen.prepare-result с exact normalized form/operationId. Active GM генерирует один immutable result v2; request не содержит ItemData, arbitrary effects, price или готовый player graph.
- [x] Хранить подготовленный result в существующем trusted GM-authored Lootgen ChatMessage state через его canonical publisher. Подготовка для прямой выдачи создаёт запись, видимую только GM; публикация игрокам раскрывает ту же запись, не генерирует вторую. Обычный legacy plain preview сохраняет старое поведение.
- [x] prepare receipt связывает operationId, lootId, form fingerprint и message. Повтор запроса возвращает тот же result. Если запись уже создана, а ответ потерялся, находить её по receipt до нового random.
- [x] UI «Забрать»/прямая выдача для composed rows использует существующий trusted claim route по lootId/rowIds. Клиент передаёт destination/ingress choices и operation ID; список upgrades active GM читает из записи. Не расширять generic direct ingress правом принять player composition.
- [x] Сохранить прежний смысл sourceOrigin для plain/manual/model callers. Там, где отображение требует новый resultVersion, читать v1 без перерасчёта; v2 snapshot сохраняет принятый value и catalog/rules fingerprint.
- [x] До первой выдачи при несовместимом изменении каталога/availability показать stale result и предложить новую генерацию. После prepared graph/grant receipt recovery использует сохранённые trusted данные; catalog drift не запускает новую выдачу и не переписывает уже полученные вещи.
- [x] LootClaimService.claimBatch и acceptedRowIds сохраняют частичный успешный outcome между top-level rows. Внутри одного составного host root+children — неделимая выдача; source claimed только после подтверждения всего graph.
- [x] UI показывает upgrades, totalValue и automation status; имена/choices экранированы. Tooltip/preview не меняет descriptor и не запускает random.
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

**Ещё не сделано:** trusted GM generation/Chat state, catalog reader на реальных источниках, UI опций и preview, claim/source receipts, полная native приёмка. R8 не завершён; генерация составных строк пока не включается из пользовательского UI.

Проверка первой части: `node --test tests/*.test.mjs` — **3810 passed / 0 failed**; синтаксис **762 JS/MJS и 46 JSON, 0 ошибок**; `git diff --check` чисто. Новое включённое поведение проверено pure/focused-тестами, без заявления native UI/claim готовности.


### Вторая часть R8 — 1.4.257

Подключены prepared ItemData/full value, exact v2 ingress parity, внутреннее разрешение только trusted Chat adapter, journal с полным набором target IDs до записи и восстановление отсутствующих children. Generic direct payload не расширен. Terminal retry не воскрешает удалённый Item; foreign system/effects edits блокируют recovery. Разбор установленного host/child отклоняется до записи с причиной. После выдачи временная composition price удаляется, native root хранит только базовую цену.

Native testovyj3, CODEX, Foundry13.351/dnd5e5.2.5: создание root+child, partial root→child, сохранение ID при повторе, hostActorId и rejection после изменения quantity подтверждены. Найденное schema-различие исправлено: loot не получает system.equipped. QA документы удалены. Это проверка native materializer, ещё не пользовательского generate→publish→claim.

Открыты trusted source catalog reader, prepare-result/Chat receipt/catalog drift, UI и полный multiplayer lifecycle. R8 не завершён.

Проверки второй части: `node --test tests/*.test.mjs` — **3820 passed / 0 failed**; `node --check` — **764 JS/MJS**, JSON parse — **46 файлов**, ошибок **0**; `git diff --check` чисто. Первые 7 failures исправлены: staging rename для architecture snapshot, совместимость коллекции Item через get вместо has, обновление трёх cache-contract tests. После исправлений полный прогон повторён успешно.

### Третья часть R8 — 1.4.258

Общий source catalog вынесен из окна; server storage plain generation больше не создаёт Application. Подключён detached reader stable IDs, canonical compatibility/capacity и safe full prices; unknown/zero различаются, missing upgrade template не выбирается. Type filters получили data owner без смены поведения. Native состав: три пики по100 + зачарование3125 =9675 всего; отдельные instance IDs. Обычное окно генерации проверено визуально, QA окно закрыто.

Открыты durable prepare-result/Chat receipt/catalog drift, UI улучшений и сквозная выдача. Подготовленные snapshots ещё не публикуются новым маршрутом; R8 не завершён.

Проверки третьей части: `node --test tests/*.test.mjs` — **3830 passed / 0 failed**; `node --check` — **769 JS/MJS**, JSON parse — **46 файлов**, ошибок **0**. `git diff --check` чисто. Native source/price/обычный UI проверены; prepare-result и authoritative claims остаются открытыми.

### Четвёртая часть R8 — 1.4.259

Подключён GM-only prepare-result с exact normalized form, canonical private Chat publisher и persisted result before Chat create. Fault tests подтверждают отсутствие reroll при потерянных ответах/повторах и запрет замены чужой записи. GenerationReady появляется после receipt; unpublished draft не имеет claim/drag controls и не входит в прежний поиск выдачи. Сохранённые custom profiles исключаются из генерации и не перезаписываются builder.

Native без world writes: реальные шаблоны → два полных graph по2 nodes, total6400; fresh catalog fingerprint совпал, все745 gear entries имеют modifiedTime. Actual GM socket/private Chat write ещё не проверены. Следующее обязательное продолжение: публикация той же записи, catalog drift gate перед первым claim, безопасная выдача персонажу, UI composed mode/preview/прямая выдача и end-to-end QA. R8 не завершён.

Проверки четвёртой части: `node --test tests/*.test.mjs` — **3849 passed / 0 failed**; `node --check` — **773 JS/MJS**, JSON parse — **46 файлов**, ошибок **0**; `git diff --check` чисто. Native detached preparation с финальным profile guard: 2 composed rows, total6400, fresh fingerprint совпал. Публикация и выдача этим прогоном не подтверждаются.


### Пятая часть R8 — 1.4.260

Gate перед новым Item ingress сравнивает fresh catalog с сохранённым v2 result без reroll. Receipt recovery пропускает изменившийся каталог; terminal replay не перечитывает source. Новый claim не может забрать строки/монеты, зарезервированные незавершённым claim, но независимые строки доступны. Focused: node --test tests/lootgen-generated-state.test.mjs tests/loot-claim-service.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-mutation-recovery.test.mjs — 143 passed / 0 failed.

Открыты публикация той же записи, безопасная выдача персонажу, UI опций/preview/прямая выдача и полный multiplayer lifecycle. R8 не завершён.

Проверки пятой части: `node --test tests/*.test.mjs` — **3856 passed / 0 failed**; синтаксис **773 JS/MJS и 46 JSON, 0 ошибок**; `git diff --check` чисто. Два initial failures были устаревшими ожидаемыми версиями в module-manifest, исправлены перед повторным полным прогоном. Native testovyj3/CODEX/Foundry13.351/dnd5e5.2.5: fresh catalog допускает 2 composed rows total6400; read-only изменённый снимок цены даёт lootgen-result-stale. World writes отсутствовали; это не проверка реальной выдачи.


### Шестая часть R8 — 1.4.261

Character route использует trusted Chat references, OWNER/GM и существующие LootClaimService/InventoryService. Полный graph/IDs persist before credit, partial recovery без reread каталога, source claimed только после receipt. Default storage contract сохранён. UI v2 self click не создаёт локальный root. Domain IDs подготовки/выдачи отделены от request IDs: повтор после ошибки транспорта продолжает receipt.

Focused: node --test tests/group-command-dispatch.test.mjs tests/lootgen-chat.test.mjs tests/inventory-mutation-recovery.test.mjs tests/disarm-storage.test.mjs — 156 passed / 0 failed. Новая native выдача через active GM пока не проверена. Открыты публикация, v2 drag, окно генерации/preview/прямая выдача и полный lifecycle; R8 не завершён.

Проверки шестой части: `node --test tests/*.test.mjs` — **3863 passed / 0 failed**; `node --check` — **773 JS/MJS**, JSON parse — **46 файлов**, ошибок **0**; `git diff --check` чисто. Initial full failure был устаревшим cache-key assertion в main-composition-root; исправлен, полный прогон повторён. Реальный multiplayer generate→publish→claim ещё открыт.


### Седьмая часть R8 — 1.4.262

GM-only publish раскрывает тот же ChatMessage, проверяет readback видимости после сбоя и сохраняет claimed state. V2 custom drag передаёт только references, подавляет native root-only drop, выдаёт весь graph через actor route. Имена upgrades/status экранированы. Legacy row acknowledgment больше не может пометить v2 source; v2 Item grant удаляет auto-claim marker. Focused: node --test tests/group-command-dispatch.test.mjs tests/lootgen-chat.test.mjs tests/loot-claim-service.test.mjs tests/inventory-mutation-recovery.test.mjs — 164 passed / 0 failed.

Открыты UI настроек/preview/direct grant и полный native multiplayer lifecycle. R8 не завершён.

Проверки седьмой части: `node --test tests/*.test.mjs` — **3868 passed / 0 failed**; синтаксис **773 JS/MJS и 46 JSON, 0 ошибок**; `git diff --check` чисто. Native testovyj3/CODEX/Foundry13.351/dnd5e5.2.5, viewport1292×920: реальный каталог → две строки total6400 → actual Chat HTML отрисован в временном DialogV2, проверены читабельность названий/status/value и кнопки; окно закрыто. ChatMessage/Items в мире не создавались. Actual publication/drag-through-authority остаются частью открытой multiplayer-приёмки.


### Восьмая часть R8 — 1.4.263

Окно выбирает upgrades/chance/max/types/ranks, готовит v2 через active GM и сохраняет operation ID после ошибки. Reopen/undo читает trusted source; две композиции одинаковой основы не объединяются. Direct row/all/coins использует тот же источник; draft доступен только GM. Pending/terminal replay берёт прежний plan до свежего preview и текущего выбора группы. Composition preview показывает сохранённые choices/status/value. Clear не раскрывает private payload и не удаляет source.

Focused: node --test tests/lootgen*.test.mjs tests/group-command-dispatch.test.mjs tests/loot-claim-service.test.mjs tests/inventory-mutation-recovery.test.mjs — 262 passed / 0 failed. Полная native приёмка и аудит оставшихся R8 критериев ещё открыты.

Проверки восьмой части: `node --test tests/*.test.mjs` — **3876 passed / 0 failed**; синтаксис **773 JS/MJS и 46 JSON, 0 ошибок**; `git diff --check` чисто. Native testovyj3/CODEX/Foundry13.351/dnd5e5.2.5, viewport1292×920: исправлен обнаруженный server template loader reject query-параметра у .hbs; окно успешно открыто, переключатель и13 фильтров работают, расширенные настройки доступны прокруткой. Detached реальный каталог/graph builder → два Молота всадника с Зачарованием лёгкости по102 value: состав/status/total204 отрисованы раздельно в настоящем LootgenApp. Для этой UI-проверки использован локальный read-only источник, mutation API отключены; Chat/Items/world state не создавались. Окно закрыто. Это не подтверждает сквозной active-GM lifecycle, который остаётся открытым.

## Аудит реализации R8.1–R8.3 и частичной выдачи (base 3cccc864, runtime1.4.277)

Чекбоксы сверены с текущим кодом и тестами, а не только с прежними отчётами:

| Требование | Владелец и проверяемое доказательство |
| --- | --- |
| Strict/legacy descriptor, instance identity, duplicate/slot/choice rejection | lootgen-composition.js, lootgen-item-descriptor.js; lootgen-item-descriptor.test.mjs: detached legacy, arbitrary fields, quantity, duplicate child, finite choices |
| Defaults/filter UI, стабильные catalog IDs | normalizeLootgenForm, normalizeTemplate, lootgen-app.hbs и LootgenApp form round trip; chooseLootgenUpgradeVariant использует manifest.productId и gear builder |
| Отдельные варианты и воспроизводимость | aggregateRows + injected random/createInstanceKey; lootgen-composite-items.test.mjs сравнивает весь legacy result и число random calls, два отдельных upgraded host |
| Цена и ограничения | evaluateItemValue проверяет безопасные компоненты/суммы/произведения; generator проверяет budget/quantity. Количество R8 hosts<=40 и upgrades<=3 даёт<=160 Documents, что ниже cap200. Shared attemptBudget2000 ограничивает и выбор host, и перебор profiles |
| Подготовка графа | composite-item-graph.test.mjs: новые16-char IDs, чистые ownership/receipts, bidirectional links, capacity/availability, custom-profile rejection. Пример выше приведён к обязательному manifest и реальному profile ID |
| Recovery без повторной установки | inventory-mutation-recovery.test.mjs: prepared party/character graph IDs до writes, missing-only retry, catalog-independent replay, удалённый committed target не создаётся заново; runtime-item-graph.test.mjs: чужие quantity/effects не перезаписываются |
| Фильтрация полного host и частичный batch | inventory-ingress-planner.test.mjs проверяет v2 composition parity; descriptor tests запрещают shell-only dismantling. loot-claim-service.test.mjs сохраняет accepted rows перед partial error; source debit составного host происходит только после полного graph |

Добавлены пять проверок ранее слабо подтверждённых граничных условий:40 hosts×4 Documents=160;3000 несовместимых profiles не выходят за2000 random calls; zero/negative/unsafe prices; broken state передаётся в стоимость shell и всех upgrades; reserves0/100 учитывают общий бюджет один раз. Focused composite suite **10 passed / 0 failed**. Runtime код не менялся, новая версия модуля для этих tests/docs не нужна.

Полный fault matrix и native generate→Chat→claim→equip→transfer, игроки/смена GM остаются открытыми. После reload CODEX новый reassign-responder передан через реальный маршрут, но действующий GM ответил Unknown socket command: вкладка Gamemaster ещё не обновлена. Публикация тестовой Chat-карточки также всё ещё ожидает ранее запрошенного ответа. Эта проверка использовала отсутствующий operationId, игровых мутаций не было.
Оставшаяся разница с R8.2: chooseLootgenUpgradeVariant сначала фильтрует availability/type/rank, а совместимость проверяет уже внутри ограниченного перебора. Невалидная установка исключается, но несовместимые profiles расходуют attemptBudget и при большом каталоге могут вытеснить допустимый вариант. Пункт предварительного совместимого пула оставлен открытым; следующий focused regression должен поместить совместимый profile после большого несовместимого пула и требовать его выбора в пределах общего лимита.
`node --test tests/*.test.mjs`: **4020 passed / 0 failed**; синтаксис796 JS/MJS и JSON46 —0 ошибок; оба JS-примера плана исполнены (2/0), `git diff --check` чисто.

### R8.2: предварительный совместимый пул — 1.4.278

Закрыта указанная выше разница: availability, type/rank, host compatibility/capacity и choices проверяются до случайного выбора. Несовместимые profiles не расходуют лимит попыток; подходящий profile после 3000 несовместимых выбирается с учётом полной стоимости. Сохранена повторная проверка занятых слотов и общий лимит для вариантов с неизвестной ценой. Добавлен один regression, обновлены две существующие проверки.

Проверки 1.4.278: профильные 40/0; обязательный 
ode --test tests/*.test.mjs — 4021 passed / 0 failed; 
ode --check — 796 JS/MJS, JSON parse — 46 файлов, ошибок 0. git diff --check чисто.
