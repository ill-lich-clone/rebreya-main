# Фильтры входящего лута для группового инвентаря

## Статус и наблюдаемый результат

Эта спецификация описывает фильтрацию только тех предметов, которые фактически поступают в инвентарь конкретной dnd5e-группы через Lootgen, получение из хранилища или внешний drag-and-drop/import.

После реализации участник группы сможет создать непересекающиеся фильтры, которые для нового предмета выбирают ровно один результат:

- направить предмет в конкретную папку;
- пропустить автоматическое получение;
- разобрать предмет на материалы после подтверждения.

Существующие предметы никогда не сканируются и не перерабатываются автоматически. Перемещение уже лежащего Item между папками не является входящей операцией. Материалы, созданные разбором, повторно через фильтры не проходят.

Живые проверки в запущенном Foundry или браузере не входят в критерии готовности. Проверка выполняется автоматическими Node-тестами и статическими командами репозитория.

## Владельцы и границы

Функциональность расширяет существующих владельцев и не создаёт второй Inventory app, параллельный repository или глобальный Item hook.

- `scripts/data/inventory-service.js` остаётся владельцем authoritative inventory ingress, folder assignment, merge и recovery.
- Новый чистый helper в `scripts/data/` владеет схемой правил, нормализацией, компиляцией, conflict detection и evaluation без Foundry globals.
- Узкий application-level planner в `scripts/application/` собирает detached ingress plan и пользовательские подтверждения, но не пишет world-state.
- `scripts/ui/inventory-app.js` и `templates/inventory-app.hbs` владеют встроенным редактором фильтров и drag-and-drop preview.
- `scripts/data/storage-command-service.js` остаётся владельцем claim orchestration и единственного сообщения о получении из хранилища.
- `scripts/main.js` только собирает зависимости, публикует API и регистрирует валидируемые typed commands.
- `UiRefreshCoordinator` остаётся единственным маршрутом итогового scoped refresh.

Новые и изменённые методы должны быть внесены в разделы 1, 2, 7, 8, 13 и 19 `docs/function-passport.md` по фактически затронутым владельцам. При изменении публичного API обновляется профильный раздел `README.md`.

## Group-scoped состояние

Единственный источник истины правил — отдельный flag Group Actor:

```js
flags["rebreya-main"].inventoryIngressRules = {
  version: 1,
  revision: 0,
  rules: [
    {
      id: "stable-rule-id",
      name: "Сломанное оружие",
      conditions: [
        { field: "documentType", operator: "in", value: ["weapon"] },
        { field: "durabilityState", operator: "is", value: "broken" }
      ],
      action: { type: "dismantle" }
    }
  ]
};
```

Состояние правил не вкладывается в `inventoryFolders`: организация дерева и маршрутизация входящего лута остаются разными контрактами. Правила не имеют порядка, приоритета или enabled-state. У правила есть стабильный ID, отображаемое либо автоматически сформированное имя, список условий и ровно одно действие.

Все условия правила объединяются через `И`. Множественные значения одного перечислимого поля выражают `ИЛИ` внутри этого условия. Нормализованное правило содержит не более одного ограничения на поле.

`revision` увеличивается при каждой реальной мутации правил. No-op replay не увеличивает revision и не пишет Actor повторно.

## Descriptor входящего предмета

До matching любой источник проецируется в одинаковый detached descriptor. Он не содержит живых Document и не разрешает произвольные Foundry property paths.

Первая версия поддерживает:

- `sourceKind`: обычное снаряжение, магический предмет или материал;
- стабильную пару `sourceType + sourceId` для конкретного каталожного предмета;
- `documentType`, `systemTypeValue`, `systemTypeSubtype` и каноническую source category;
- редкость и ранг;
- `durabilityState`: intact, damaged, broken, destroyed или ineligible;
- числовые unit value и unit weight;
- стабильный ID преобладающего материала при его наличии;
- derived-признак `dismantlable` для предмета, которому canonical resolver может построить непустой результат разбора.

Lootgen row, сохранённая storage row и внешний Foundry Item с одинаковой managed identity должны давать семантически одинаковый descriptor. Проекция использует существующие managed flags и каноническую классификацию. Name fallback не становится стабильной identity.

Источник поступления не является полем фильтра: один предмет обрабатывается одинаково из Lootgen, хранилища и drag-and-drop.

## Язык условий

Поддерживаются только типизированные операторы:

- enum/identity: `is`, `isNot`, `in`, `notIn`;
- number: `lt`, `lte`, `eq`, `gte`, `gt`, `between`;
- boolean: `is` со значением `true` или `false`.

Произвольные JS-выражения, regex, поиск по части имени и raw Foundry paths запрещены. Они не позволяют гарантировать отсутствие пересечений и нестабильны при изменении документов.

Условия нормализуются до канонических constraint-объектов. Пустые множества, перевёрнутые диапазоны, NaN, неизвестные поля, неподходящие оператору значения и лишние ключи отклоняются до записи.

## Ровно одно правило и conflict detection

Для любого возможного descriptor должно совпадать не более одного правила. Это проверяется при create и update, а не разрешается приоритетом на runtime.

Два правила конфликтуют, если существует хотя бы один descriptor, удовлетворяющий обоим наборам ограничений. Conflict checker пересекает нормализованные constraints по каждому полю:

- доказанное пустое пересечение хотя бы одного поля означает отсутствие конфликта;
- непустое пересечение всех ограничений означает конфликт;
- если движок не может доказать несовместимость, пересечение считается возможным и сохранение блокируется.

Проверка намеренно консервативна. Например, specific-item rule конфликтует с широким category rule, если второе правило явно не исключает этот stable ID. Это сохраняет строгую гарантию даже после изменения каталогов.

`dismantle` семантически добавляет ограничение `dismantlable = true`. Неразбираемый предмет под такое правило не подходит и продолжает штатный ingress flow.

Runtime evaluator компилирует только уже валидное conflict-free состояние и возвращает `null` либо одно detached решение с rule ID и action. Он ничего не записывает.

## Действия

### Folder

`{ type: "folder", folderId }` отправляет входящий Item в существующую папку этой же группы. Folder ID проверяется authoritative-сервисом при сохранении правила и повторно перед commit.

Target-scoped merge разрешён только с совместимым стэком, уже находящимся в целевой папке. Если такой же старый стэк лежит в другой папке, он не перемещается: новый стэк создаётся в целевой папке. Это может оставить одинаковые стэки в разных папках, но не перерабатывает старые предметы и честно выполняет действие правила.

### Skip

`{ type: "skip" }` означает пропуск автоматического получения, а не уничтожение source Item.

- При одиночном явном получении в группу UI предлагает `Не забирать` и `Всё равно добавить в корень`.
- При массовом получении совпавшая строка остаётся в Lootgen/хранилище незабранной и не требует отдельного окна.
- Явный override добавляет Item в корень и не запускает фильтры повторно.

### Dismantle

`{ type: "dismantle" }` строит canonical preview `исходный предмет -> материалы` и требует подтверждения.

- Для одного предмета показываются исходная строка, количество и полный список результатов.
- Для batch все подходящие строки собираются в один диалог.
- Каждый исходный предмет имеет изначально включённый checkbox.
- Снятый checkbox означает добавить исходный Item в корень без повторной фильтрации.
- Закрытие или cancel диалога отменяет всю ещё не начатую операцию без записей.
- Подтверждённый предмет преобразуется напрямую в материалы; промежуточный Item в корне не создаётся.
- Созданные материалы не являются новым ingress и не фильтруются рекурсивно.

Canonical material outputs рассчитываются серверной стороной повторно. Клиент не задаёт material IDs или quantities.

## Общий ingress flow

Канонический поток имеет две фазы.

### Detached preview

1. Существующий источник передаёт строки, requested group и прежний optional folder target planner-у.
2. Planner один раз строит descriptor каждой строки.
3. Group rules читаются и компилируются один раз на batch.
4. `evaluateMany()` возвращает folder, skip, dismantle или no-match для каждой строки.
5. No-match сохраняет прежнюю семантику источника: drag/drop использует точный drop target, а обычное получение — переданный target либо корень.
6. UI при необходимости собирает один confirmation dialog и возвращает только пользовательский выбор.

Preview ничего не пишет и не публикует ChatMessage.

### Authoritative commit

1. Typed command связывает payload sender с transport sender и разрешает конкретную registered group.
2. Active GM повторно читает source, folder state и rules revision внутри сериализованной mutation boundary.
3. Descriptor, matching, dismantle outputs и пользовательский выбор пересчитываются по live данным.
4. Несовпадение revision, identity, quantity, source state или folder target завершает операцию без записи и требует нового preview.
5. Подтверждённый план выполняется через существующий inventory mutation/recovery route.
6. После commit выполняются один coalesced scoped refresh и, только для storage claim, существующая публикация receipt.

Клиентский plan является UX-preview, а не источником полномочий или material outputs.

## Источники

Фильтрация подключается только к фактическому поступлению Item в групповой инвентарь:

- одиночные и массовые claims Lootgen в party inventory;
- storage claim с destination `party`, включая кнопку `В группу`;
- внешний Foundry drag-and-drop/import в InventoryApp;
- существующие публичные ingress-методы, если они создают новый Item в group inventory.

Получение Item непосредственно персонажем, внутреннее folder move, quantity update, sale, craft outputs, mutation recovery replay и уже созданные material outputs не запускают фильтрацию повторно. Craft и другие источники можно подключать только отдельным будущим решением после проверки их транзакционных инвариантов.

Монеты не являются Item filter input и проходят прежним currency flow.

Portable container при folder route перемещается целиком с дочерним деревом. Dismantle для container недоступен, если canonical resolver не публикует валидный breakdown.

## Права и сериализация

Управление фильтрами наследует существующую participation capability папок:

- GM может управлять правилами;
- игрок, владеющий character-member целевой зарегистрированной группы, может управлять правилами этой группы;
- владение участником другой группы не даёт доступ;
- unknown sender и transport mismatch запрещены.

Active GM валидирует и исполняет typed commands, но не является единственным владельцем настройки.

Rule create/update/delete и folder create/move/delete, затрагивающие ссылки между состояниями, используют одну group organization serialization boundary. Нельзя допустить race, в котором folder удаляется одновременно с сохранением folder action.

Папку, используемую хотя бы одним правилом, нельзя удалить. Ошибка перечисляет зависимые правила; пользователь сначала удаляет или перенаправляет их.

## Надёжность и идемпотентность

Rule mutations принимают exact payload, expected revision и стабильный operation ID. Authoritative write выполняет не более одного Actor flag update на реальное изменение.

Ingress commit использует стабильный batch mutation ID и расширяет существующий `inventoryMutationJournal`. Для каждой строки сохраняются source identity, requested target, matched rule ID, rules revision, пользовательский override и derived target/action.

Folder grant сохраняет существующий порядок prepared -> target-created/merged -> folder-assigned -> source-debited -> committed. Dismantle создаёт или сливает material outputs идемпотентно до source debit; retry находит уже созданные outputs и не дублирует их.

Foundry не предоставляет общей ACID-транзакции между всеми Document. Поэтому частичная ошибка может оставить recoverable journal phase, но не считается успешным commit и не скрывается. Повтор с тем же mutation ID продолжает только незавершённые фазы.

Skip без пользовательского override не создаёт target и не списывает source.

## Сообщения хранилища

Новый канал сообщений не создаётся. `StorageCommandService` расширяет единственный существующий public claim receipt только после успешного source и target commit.

Примеры второй строки:

- `Отфильтровано в папку «Оружие».`
- `Отфильтровано: разобрано на Железо x2, Дерево x1.`
- `Фильтрация пропущена; добавлено в корень.` для явного override.

Незабранный skip Item не публикует receipt. Имена экранируются; source IDs, flags и внутренний plan в ChatMessage не попадают. Повтор mutation ID не публикует сообщение второй раз.

Другие ingress-источники не создают новых ChatMessage или notifications только ради успешной фильтрации.

## UI InventoryApp

В inventory toolbar не добавляется текст `Правила лута`, новая вкладка или отдельное ApplicationV2.

Toolbar сохраняет существующий порядок полей и получает компактную action group:

```text
[ поиск немного короче ][ тип ][ сортировка ][ фильтры ][ создать папку ]
```

- Search занимает остаточную ширину и становится немного короче.
- Слева в action group находится icon-only кнопка `fa-filter` с `title` и `aria-label` `Фильтры`.
- Справа остаётся `fa-folder-plus`.
- Обе кнопки имеют одинаковый размер около 34 x 34 px и вертикально центрированы относительно inputs.
- Специальное правило 44 x 44 px для текущей folder button удаляется.
- На узкой ширине две action buttons остаются рядом, а не превращаются в две полноширинные строки.

Кнопка фильтров переключает встроенный режим того же InventoryApp. Внутри него:

- правила показываются неупорядоченными карточками `условия -> действие`;
- доступны create, edit и delete;
- condition row содержит field, operator и typed value control;
- action editor предлагает folder, skip или dismantle;
- name можно ввести либо получить из краткого автоматического описания;
- client-side validation подсвечивает неполный ввод, но authoritative conflict validation остаётся обязательной;
- conflict error называет существующее правило и пересекающиеся constraints.

Успешная folder routing работает без dialog, toast или отдельного сообщения. Runtime `DialogV2` используется только для одиночного skip и согласованного dismantle confirmation.

## Производительность

Производительность является обязательным архитектурным контрактом.

- Нормализованные правила компилируются в immutable cache по `groupActorId + revision`.
- Rules state читается один раз на group batch.
- Descriptor каждой входящей строки строится ровно один раз.
- Batch использует один `evaluateMany()`, а не цикл из публичных одиночных API-вызовов.
- Compiled matcher индексирует правила по дешёвым дискретным признакам: stable identity, source kind, document type/subtype, category и durability state.
- Числовые constraints применяются только к уже отобранным кандидатам.
- Conflict detection выполняется только на rule create/update, не на ingress runtime path.
- Material preview рассчитывается только для реально совпавших dismantle rows.
- Один batch использует не более одного typed command dispatch: локальный execute на active GM либо один socket round-trip. Document mutations группируются, а scoped refresh выполняется один раз после commit.
- Matcher, compiler и descriptor helpers не вызывают Foundry API, sockets, render, setFlag или settings.
- Глобальные create/update Item hooks для фильтров запрещены.
- Аномально большой detached batch может вычисляться короткими chunks с возвратом управления UI; authoritative commit остаётся одной логической mutation operation.

Runtime-путь не должен быть квадратичным по числу правил и входящих строк. Call-count assertions важнее нестабильного wall-clock threshold.

## Ошибки

Пользователь получает профильную ошибку без частичных новых действий в следующих случаях:

- правило пересекается с существующим;
- rules revision устарела;
- целевая папка отсутствует или уже удалена;
- source identity/quantity изменилась после preview;
- material resolver больше не может построить показанный breakdown;
- sender не имеет participation capability целевой группы;
- mutation ID конфликтует с другим plan;
- recovery требует явной сверки после необратимой внешней ошибки.

Runtime success остаётся тихим, кроме расширенного storage receipt. Ошибка подтверждения не закрывает исходное окно и позволяет получить свежий preview.

## Focused-тесты

Живые Foundry/browser-тесты не выполняются.

Автоматические тесты должны покрыть:

1. Rule state: versioning, normalization, exact schema, no-op и revision.
2. DSL: каждый field/operator, ranges, missing values и invalid payload.
3. Conflicts: equal, subset, partial numeric overlap, explicit exclusion, potential overlap и dismantlable constraint.
4. Descriptor parity: один managed Item из Lootgen, storage и drag source даёт одинаковые match-поля.
5. Matcher: no match или ровно одно match, immutable input/output и отсутствие Foundry globals.
6. Planning: одиночные и batch folder/skip/dismantle/override/cancel flows.
7. Compatibility: no-match сохраняет legacy target и merge; filtered merge ограничен целевой папкой.
8. Non-recursion: folder move, recovery replay и material outputs не запускают matching.
9. Commands: exact payload, transport sender binding, same-group participation и cross-group denial.
10. Concurrency: simultaneous rule/folder mutations, stale revision и folder dependency deletion.
11. Recovery: duplicate mutation ID, target-created retry, material output retry и source debit failure.
12. Storage chat: одна escaped receipt, folder/dismantle/override suffix и отсутствие сообщения для skip.
13. Inventory UI: toolbar order, две одинаковые icon buttons, embedded editor, permissions и dialog decisions.
14. Performance: не более одного rules read/compile/command dispatch/refresh на batch, один descriptor build на row и отсутствие Foundry calls внутри matcher.
15. Stress: сотни conflict-free правил и тысячи detached rows без runtime-перебора полного ruleset для каждой строки.

Профильные существующие owner tests расширяются прежде, чем создаются дублирующие крупные harness. Ожидаемые владельцы: `inventory-folder-tree`, `group-inventory-migration`, `inventory-mutation-recovery`, `inventory-folder-socket`, `inventory-app-context`, `lootgen-chat`, `storage-socket`, `storage-transfer-chat` и `main-composition-root`.

## Полная проверка

После focused-тестов и до commit реализации один раз выполняются команды из `AGENTS.md`:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Готовность требует 0 failed tests, успешной syntax/JSON-проверки, отсутствия diff whitespace errors и обновлённого `docs/function-passport.md` для каждого нового, изменённого или удалённого метода.

## Вне scope

- автоматическая переработка уже лежащих предметов;
- world-global filters или правила другой группы;
- rule priority, ordering или разрешённые пересечения;
- arbitrary scripts, regex и raw property paths;
- фильтрация монет;
- рекурсивная фильтрация material outputs;
- отдельный Inventory/Rules ApplicationV2;
- новые глобальные Item hooks;
- новые сообщения или уведомления для тихой folder routing;
- живые Foundry/browser-тесты;
- подключение craft outputs и иных ingress-источников без отдельного решения.

## Критерии приёмки

Функциональность готова, когда участник группы может создать непересекающиеся фильтры, а все поддерживаемые входящие Item проходят единый быстрый authoritative plan; folder action направляет только новый стэк, skip не уничтожает источник, dismantle требует согласованного подтверждения и не создаёт промежуточный Item; retry не дублирует ценность; старые предметы и другие группы не затрагиваются; toolbar соответствует согласованному компактному расположению; автоматические проверки проходят без живого запуска Foundry.
