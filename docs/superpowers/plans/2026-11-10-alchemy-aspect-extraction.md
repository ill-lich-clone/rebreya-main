# План реализации аспектов и расщепления

> **Для исполнителя.** Используй `superpowers:executing-plans` или `superpowers:subagent-driven-development`. Шаги отмечаются по мере выполнения. Для каждого изменения поведения сначала запусти регрессию и проверь причину падения.

**Цель.** Игрок видит реальный запас аспектов в «Алхимии», извлекает их из одной или нескольких порций растений и сразу использует полученные предметы в рецептах.

**Архитектура.** Канонический вид аспекта общий для компендиума, запасов и извлечения. Действие на существующем листе растения вызывает отдельную typed-команду active GM. Она переиспользует разрешение группы и количественные операции крафта.

**Среда.** ESM, Foundry 14.369 и dnd5e 6.0.6 в «Ребрея мейн», Node test runner, существующие листы dnd5e и Handlebars. [Подтверждённая спецификация](../specs/2026-11-10-alchemy-aspect-extraction-design.md).

## Общие ограничения

- Растения сохраняют тип `loot`, авторский выход, цену, вес и флаги. Ветка работает с уже имеющимися экземплярами. Шесть предметов представляют шесть сосудов по виду.
- Проверка Интеллекта с инструментами алхимика одна на партию. Для 10–14 и 25+ используется одна общая 1к6. Время работы 10 игровых минут отмечается штатными часами группы вручную.
- Права проверяются на active GM для точного Actor и его группы. Preview и закрытие формы являются чтением. Повтор операции использует те же входные данные, результат броска и квитанции.
- Сохранить правила и публичные контракты прежнего крафта. Работа в `lich_branch` после проверки status, fetch и remote. Если текущая версия всё ещё `1.5.71`, обновить до `1.5.72`. Интерактивный QA только при отдельном разрешении.

## Что проверить особенно внимательно

1. Канонический предмет переименован игроком, рядом старый «Аспект ПЭ», а предмет другого типа назван так же. Задача 1.
2. В группе лежит трава с дробным остатком и подставлен источник из другой группы. Задача 2.
3. Провал на 9 уничтожает одну порцию, а две порции одного стэка считаются партией. Задачи 1–2.
4. Ответ от Foundry потерялся после расхода и после увеличения существующей стопки. Задача 2.
5. В рецепте ноль Огня и нет основы. Лист растения перерисовался перед одним нажатием. Задача 3.

## Task 1 — Канонические аспекты, компендиум и правила

**Файлы.** Создать `scripts/data/alchemy-aspects.js`, `tests/alchemy-aspects.test.mjs`. Изменить `scripts/data/materials-compendium.js`, `scripts/data/alchemy-crafting-rules.js`, `scripts/data/alchemy-crafting-service.js`, `scripts/data/inventory-service.js` и профильные тесты.

**Интерфейсы.** `ALCHEMY_ASPECTS` содержит шесть ключей `fire, water, earth, air, positive, negative`, коды, имена и штатные Foundry-иконки. `getAlchemyAspectKind(item) → kind|null` читает `flags.rebreya-main.alchemyAspect` или точный старый формат имени у `loot`. `createAlchemyAspectItemData(kind, quantity = 1) → ItemData` возвращает `loot/resource` со стабильной меткой вида и ID шаблона. `readPlantAspectYield(material) → Record<kind,quantity>|null` читает только канонический выход растения. `calculateAspectExtraction({baseYield,portionCount,total,d6}) → Record<kind,quantity>` реализует пороги документа. Экспорт `readAlchemyAspect(name)` из текущих правил сохраняется как алиас совместимого парсера имени.

- [ ] **Красный.** `aspect_templates_are_stable` проверяет шесть шаблонов с quantity 1, переименование стабильного предмета, старое «Аспект ПЭ» и неподходящий тип Item. `extraction_applies_one_common_die` проверяет авторские 42 Земли и 22 Позитивной энергии, при 10/14 и 1к6=4 получаются 38/18, при 15/24 — 42/22, при 25 — 46/26. При 9 из одной порции выход нулевой, из двух получается половина по видам с округлением вниз. Минерал и животный материал с текстом аспектов отклоняются.
- [ ] **Проверить падение.** `node --test tests/alchemy-aspects.test.mjs`.
- [ ] **Реализовать.** Отделить шесть шаблонов от импортируемых строк и синхронизировать через `MaterialsCompendiumService.sync` с собственной identity. Не включать их в каталог продажи материалов. В крафте использовать `getAlchemyAspectKind` для стэков. Сравнивать вид при переносе и слиянии предметов, сохраняя старый формат и исключая обычный одноимённый лут. Для операций со смешанным составом применять поправку к сумме каждого вида после суммирования порций.
- [ ] **Зелёный.** `node --test tests/alchemy-aspects.test.mjs tests/materials-compendium.test.mjs tests/alchemy-crafting-rules.test.mjs tests/inventory-transfer-imports.test.mjs`.

## Task 2 — Операция извлечения и восстановление

**Файлы.** Создать `scripts/data/alchemy-extraction-service.js`, `scripts/application/alchemy-extraction-commands.js`, `tests/alchemy-extraction-service.test.mjs`. Связать зависимости в `scripts/main.js`. Переиспользовать `AlchemyCraftingService.scope/authorize/prepareReceipts/applyReceipt` и тот же world-setting repository.

**Интерфейсы.** `AlchemyExtractionService.preview({groupId,actorId}) → {plants,tool,available}` возвращает доступные порции из выбранного Actor и группы. `extract({groupId,actorId,operationId,ingredients},execution) → {operationId,total,d6,aspects,portionCount}`. Каждый ингредиент имеет точные `actorId,itemId,quantity`. `registerAlchemyExtractionCommands(gateway,service)` регистрирует `alchemy-extraction.extract` с exact-key validation и exclusive mutation. Журнал использует отдельный префикс ID в `alchemyCraftJournal`.

- [ ] **Красный.** `extraction_is_authorized_and_consumes_whole_portions` проверяет источник у персонажа и в своей группе, чужой ID, дубль одной строки, дробную заявку, нехватку и расход единственной порции даже при выходе ноль. Две порции из стэка считаются партией. `extraction_replays_without_double_credit` вводит сбои после расхода, обновления старой стопки и создания новой. Доказать один бросок Интеллекта, одну 1к6 при подходящем исходе, одно списание каждой порции и точное начисление. Повтор с тем же ID и изменённым составом отклоняется.
- [ ] **Проверить падение.** `node --test tests/alchemy-extraction-service.test.mjs`.
- [ ] **Реализовать.** Проверять растение по ID в актуальной модели и количеству целых порций, а инструмент по `resolveAlchemyToolRank`. Сохранять выбранные источники до броска, итог и квитанции до списания. При неоднозначном исходе записи броска сохранять стадию сверки, вместо автоматического повторного броска. Для выдачи закрепить существующий стэк или стабильный ID нового, применять точное количество с устойчивой меткой операции, использовать журнал при повторе. Отслеживать перенесённую выдачу по метке. При полностью израсходованной порции завершить удаление пустого экземпляра после фиксации расхода. Чат публикует один итог по ID операции.
- [ ] **Зелёный.** `node --test tests/alchemy-extraction-service.test.mjs tests/alchemy-crafting-service.test.mjs tests/inventory-material-quantity.test.mjs tests/group-command-dispatch.test.mjs`.

## Task 3 — Кнопка на растении, запасы и выпуск

**Файлы.** Создать `scripts/ui/alchemy-extraction-dialog.js`, `tests/alchemy-extraction-ui.test.mjs`. Изменить `scripts/integrations/dnd5e-sheet-extensions.js` через существующий `bindItemSheetEnhancements`, `scripts/ui/alchemy-crafting-app.js`, `templates/alchemy-crafting.hbs`, scoped CSS, `scripts/main.js`, `README.md`, `docs/function-passport.md`, `module.json` и manifest/cache tests. Добавить тонкий `scripts/main-1.5.72.js`.

**Интерфейсы.** `bindAlchemyExtractionAction(root,item,moduleApi)` добавляет одно действие к доступному подходящему растению и переиспользует обработчик при повторном рендере. `openAlchemyExtractionDialog(item,moduleApi)` открывает выбор порций и персонажа, подставляя одну порцию открытого Item. `game.rebreyaMain.mutateAlchemyExtraction(intent)` направляет только подтверждённую форму в typed-команду. `view(intent)` алхимии добавляет `aspectStock` всех шести видов и `aspectNeeds` выбранного рецепта. `buildAlchemyCraftingView` проецирует один компактный ряд и точные требования, включая катализатор и произвольные аспекты.

- [ ] **Красный.** `plant_card_binds_one_action` проверяет два рендера одной карточки, одну реакцию на клик, недоступное растение и закрытие формы без мутации. `aspect_stock_shows_zero_against_recipe` проверяет шесть остатков при пустом запасе, «Огонь 0/15», отдельное требование крови и скрытую сводку потерь. Для произвольного рецепта и аспекта из группы сверить отображаемые значения и результат крафта.
- [ ] **Проверить падение.** `node --test tests/alchemy-extraction-ui.test.mjs tests/alchemy-crafting-app.test.mjs`.
- [ ] **Реализовать.** Использовать один доступный DialogV2 без новой вкладки. Показать 10 минут и краткий состав, выбрать порции по точным ID. Для крафта показывать остатки и дефицит по виду без повторного общего сообщения, если рецепт требует только конкретные виды. Обновить паспорт методов и README, manifest и cache keys каждого затронутого владельца.
- [ ] **Зелёный.** `node --test tests/alchemy-extraction-ui.test.mjs tests/alchemy-crafting-app.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs`.
- [ ] **Выпуск.** Выполнить `node --test tests/*.test.mjs`, `node --check` для JS/MJS, JSON parse, компиляцию шаблона и `git diff --check`. Провести итоговое независимое ревью, проверить staged diff, сделать commit и `git push -u origin lich_branch`. В отчёте привести пути спецификации и плана, результаты проверок и фактический охват Foundry QA.
