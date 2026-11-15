# Inventory Folder Display and Info Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current checkout. Steps use checkbox syntax.

**Goal:** Дать группе плоский список вещей и сводку по весу и двум оценкам папки.

**Architecture:** `InventoryApp` меняет локальный режим и строит представление из имеющегося дерева. Сводка использует ту же ветку и цены позиций, с приведением веса к фунтам при просмотре.

**Tech Stack:** Foundry ApplicationV2, DialogV2, Handlebars, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-15-inventory-folder-display-and-info-design.md`

## Ограничения

Использовать существующие дерево, снимок, поиск, формат цен и процесс переноса. Сохранять настройки, flags, правила продажи и границы прав. Версия модуля `1.5.94`, ветка `lich_branch`.

## Особые случаи для ревью

- Свёрнутая вложенность и сортировка через границы веток проверяются в задаче 1.
- Закрытие окна папки при удалённом корне и сохранение реального адресата drop проверяются в задаче 1.
- Сводка включает скрытые фильтром позиции, магические вещи и дробные материалы. Это проверяется в задаче 2.
- Смешанные единицы веса, пустая папка и нечётная цена в меди проверяются в задаче 2.
- Сценарии продажи и переноса проходят полный набор прежних тестов в задаче 3.

### Task 1: Плоское представление

- [ ] В `tests/inventory-folder-tree.test.mjs` проверить `projectInventoryFolderRows({ hideFolders: true, compareItems, … })`. Свёрнутое дерево возвращает все предметы на глубине 0, включая корневые, с глобальным порядком компаратора и реальными `folderId`. Поиск и тип ограничивают предметы. Переданный `rootFolderId` ограничивает ветку. Удалённый корень сохраняет признак `rootFolderMissing`.
- [ ] В `tests/inventory-app-context.test.mjs` нажать переключатель через `_onRender`, проверить контекст дерева, списка и восстановленного дерева, включая закрепления, раскрытие, отсутствие второго `getInventorySnapshot` и операций записи. Проверить, что шаблон подключает действие независимо от прав организации и оставляет создание папки в дереве.
- [ ] Запустить тесты по именам и убедиться, что они падают на новом поведении.
- [ ] В `scripts/data/inventory-folder-tree.js` добавить `hideFolders = false` и `compareItems` к `projectInventoryFolderRows`. Использовать текущий поиск по предметам; при скрытых папках обойти только заданную ветку, применить фильтры и отсортировать плоские строки.
- [ ] В `scripts/ui/inventory-app.js` завести `hideInventoryFolders = false` на экземпляр. В `#projectCachedInventoryContext()` передать режим и компаратор, скрыть закрепления, переиспользовать `inventorySearchRenderPending` для перерисовки через `_onRender`. В `templates/inventory-app.hbs` добавить `toggle-inventory-folders`, переключить подпись и условие кнопки создания. В `styles/main.css` подогнать ширину текстовой кнопки под текущую панель.
- [ ] Прогнать `node --test tests/inventory-folder-tree.test.mjs tests/inventory-app-context.test.mjs`; ожидается 0 failed.

### Task 2: Сводка папки

- [ ] В `tests/inventory-app-context.test.mjs` нажать `show-inventory-folder-info` обычным участником, сохранив активный фильтр и свёрнутую папку. Проверить, что в сводке учтены прямой предмет весом 6 фунтов и вложенный дробный материал весом 0,75 фунта, с суммарной ценой 313 медных и половиной 156 медных. Дать вложенной вещи цену при `canSell: false`. Убедиться, что соседняя ветка, корень и монеты группы не включены, а пустая папка даёт нули. Проверить преобразование kg в lb и экранирование названия папки.
- [ ] Запустить новый тест по имени и убедиться, что он падает на отсутствующем диалоге.
- [ ] В `scripts/data/inventory-weight.js` сделать доступным существующий `pounds(value, units)` под именем `inventoryWeightToPounds(value, units)`. В `InventoryService.#buildInventoryEntry` добавить `weightUnits` к `totalWeight`: `lb` для логического веса материалов, `system.weight.units` для остальных с умолчанием `lb`.
- [ ] В `scripts/ui/inventory-app.js` реализовать `#showInventoryFolderInfo(folderId)` по кешированной ветке, вычисляя сумму `getInventoryEntryItemValueCopper(entry)` и суммы веса в фунтах за один обход. Форматировать оба результата `formatCopperValue()`, половину округлять вниз. Открывать read-only `DialogV2.wait` с экранированным именем и кнопкой «Закрыть». В `_onRender` и шаблоне подключить кнопку ⓘ вне `canOrganizeInventory`.
- [ ] Прогнать `node --test tests/inventory-app-context.test.mjs tests/inventory-weight.test.mjs tests/inventory-folder-socket.test.mjs`; ожидается 0 failed.

### Task 3: Выпуск

- [ ] Актуализировать `README.md` и раздел 7 `docs/function-passport.md` по проекции, кнопкам, единицам веса и тестам.
- [ ] Обновить `module.json`, forwarder и cache keys изменившихся runtime-модулей у каждого импортера. Синхронизировать проверки версии в `tests/main-composition-root.test.mjs` и `tests/module-manifest.test.mjs`.
- [ ] Проверить сценарии из спецификации и выполнить полный `node --test tests/*.test.mjs`, `node --check` для Git JS/MJS, JSON-парсинг и `git diff --check`. Проверить содержательный diff, чистоту удалённой ветки и состав staged файлов.
- [ ] Закоммитить файлы задачи и выполнить `git push -u origin lich_branch`. Сверить commit с `origin/lich_branch`.
