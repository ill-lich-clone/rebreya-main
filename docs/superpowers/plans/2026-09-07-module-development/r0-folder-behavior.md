# R0 — Отмена диалога и назначение папки: Implementation Plan

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

**Goal:** Cancel/Escape/close не создают папку; drop на Item наследует его реальную папку.
**Architecture:** prompt остаётся в InventoryApp, pure выбор destination использует существующий folder reducer; mutation owner не меняется.
**Spec:** [inventory-storage-ui.md, R0](../../specs/2026-09-07-module-development/inventory-storage-ui.md). Зависимостей нет.

## Задача R0.1 — Явный результат диалога

**Files:** изменить scripts/ui/inventory-app.js и tests/inventory-app-context.test.mjs.
**Точки:** promptInventoryFolderName(), #createInventoryFolder(), #renameInventoryFolder(); existing installFoundryApplicationStub() в тесте.
**Produces:** новый named export normalizeInventoryFolderDialogResult(result) → string|null. Это UI helper, не public module API.

- [x] Добавить тест в существующий файл после установки Foundry stub:
```js
test("folder result distinguishes cancellation and literal cancel name", async () => {
  const restore = installFoundryApplicationStub();
  try {
    const { normalizeInventoryFolderDialogResult: normalize } =
      await import("../scripts/ui/inventory-app.js?folder-result-contract");
    assert.equal(normalize({ confirmed: false }), null);
    assert.equal(normalize(null), null);
    assert.equal(normalize("cancel"), null);
    assert.equal(normalize({ confirmed: true, name: " cancel " }), "cancel");
    assert.throws(() => normalize({ confirmed: true, name: "   " }));
    assert.throws(() => normalize({ confirmed: true, name: "x".repeat(81) }));
  } finally { restore(); }
});
```
- [x] Запустить node --test --test-name-pattern="folder result" tests/inventory-app-context.test.mjs. Ожидается красный тест на отсутствующем export.
- [x] Добавить helper и использовать его после DialogV2.wait:
- [x] Импортировать существующий MAX_INVENTORY_FOLDER_NAME_LENGTH из scripts/data/inventory-folder-tree.js; не вводить второй лимит имени.
```js
export function normalizeInventoryFolderDialogResult(result) {
  if (result?.confirmed !== true) return null;
  const name = typeof result.name === "string" ? result.name.trim() : "";
  if (!name || name.length > MAX_INVENTORY_FOLDER_NAME_LENGTH) {
    throw new Error("Название папки должно содержать от 1 до 80 символов.");
  }
  return name;
}
```
Confirm callback возвращает {confirmed:true,name:button.form.elements.folderName.value}; Cancel — {confirmed:false}. Не использовать null/undefined для callback: Foundry заменяет их action.
- [x] Изменить existing dialog mocks, которые сейчас возвращают строки: они должны исполнять callback выбранной кнопки и применять result ?? button.action. Close/Escape возвращают null при rejectClose:false.
- [x] В UI integration assertions доказать ноль create/rename/API calls для всех трёх способов отмены; Confirm создаёт один вызов, даже для имени cancel. UUID создаётся только после успешного normalize.
- [x] Прогнать весь tests/inventory-app-context.test.mjs; проверить create, rename и empty/long input, а не только новый helper.

## Задача R0.2 — Один resolver для hover и drop

**Files:** scripts/data/inventory-folder-tree.js; scripts/ui/inventory-app.js; tests/inventory-folder-tree.test.mjs; tests/inventory-app-context.test.mjs.
**Consumes:** normalized state {folders,itemFolderIds}, существующий inventory snapshot и rootFolderId окна.
**Produces:** новый pure resolveInventoryDropFolderId({target,state,itemIds,rootFolderId=null}) → folderId|null.
target: {kind:"item"|"folder"|"background"|"root",id?}; unknown kind/ID бросает InventoryFolderStateError("invalid-drop-target").

- [x] Добавить тест точного membership; импортировать новый export рядом с reducer:
```js
test("drop uses target item membership and popout background", () => {
  const state = {
    version: 1,
    folders: [{ id: "bag", name: "Сумка", parentId: null, sort: 0 }],
    itemFolderIds: { inside: "bag" }
  };
  const itemIds = ["inside", "root"];
  const resolve = (target, rootFolderId = null) =>
    resolveInventoryDropFolderId({ target, state, itemIds, rootFolderId });
  assert.equal(resolve({ kind: "item", id: "inside" }), "bag");
  assert.equal(resolve({ kind: "item", id: "root" }), null);
  assert.equal(resolve({ kind: "background" }, "bag"), "bag");
  assert.equal(resolve({ kind: "root" }, "bag"), null);
  assert.throws(() => resolve({ kind: "item", id: "deleted" }));
});
```
- [x] Запустить node --test tests/inventory-folder-tree.test.mjs; новый контракт должен быть красным.
- [x] Реализовать switch в pure helper. Для item сначала проверить присутствие в itemIds, затем читать state.itemFolderIds[id] ?? null; найденный folder ID дополнительно проверяется в state.folders. Для folder проверить ID; для background вернуть проверенный rootFolderId; для root вернуть null. Не использовать имя, DOM ancestor folder или длительность hover.
- [x] В #resolveInventoryDropTarget() разделить DOM hit-test и membership: точная Item row имеет приоритет; явная root-surface различается с пустым фоном popout. Передать projection resolver и вернуть прежние targetElement/highlightElement.
- [x] Hover использует актуальную cache текущего render. В drop один раз получить fresh inventory snapshot через существующий getInventorySnapshot с явным groupActorId, пересчитать destination и затем вызвать прежний #resolveInventoryDropAction/mutation route. Если target исчез — warning, refresh и no-op; не подменять на null.
- [x] Обновить тест "InventoryApp routes internal and external drops..." и обе main/popout ветки: nested Item→membership; root Item→null; background popout→rootFolderId. Journal/external Item маршруты сохраняются.
- [x] Добавить case: другой клиент изменил папку target между hover и drop. Подсветка очищается, результат использует свежий membership. Self/descendant/cross-group папок остаются запрещены прежним owner.
- [x] После dragend/error/rerender очистить highlight и transient session ровно прежним lifecycle.

## Проверки этапа

```powershell
node --test tests/inventory-app-context.test.mjs tests/inventory-folder-tree.test.mjs tests/inventory-folder-socket.test.mjs
```
Live: create→cancel, rename→Escape, крестик; literal cancel Confirm; root/folder/deep folder, search filter, folder popout, удержание 2 секунды, удалённый target. Проверить membership после reload и отсутствие Item quantity writes.

**Docs:** паспорт7/19: заменить старое «любая Item row означает корень» новым правилом; описать оба новых helpers. Commit: fix: preserve folder destinations and cancel folder dialogs.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [x] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

## Фактическая проверка R0 — 2026-09-08

Реализованы R0.1/R0.2; версия поставки 1.4.246. Public module API и схема folder state не менялись.

- Focused: `node --test tests/inventory-app-context.test.mjs tests/inventory-folder-tree.test.mjs tests/inventory-folder-socket.test.mjs` — 139 passed / 0 failed. С `tests/module-manifest.test.mjs` — 172 / 0.
- Live: `https://vtt.rebreya.com/game`, мир `testovyj3`, Foundry 13.351, dnd5e 5.2.5, GM CODEX, viewport 1292×920. Отдельная временная группа; основной active group не переключался. Команды создания и переноса прошли штатный typed route через другого active GM.
- Реальные DialogV2: create→Отмена, create→крестик, rename→Escape не создали/переименовали папку; подтверждённое имя `cancel` создало ровно одну папку. Остальные комбинации отмены create/rename проверены focused-тестами.
- DragEvents с настоящим браузерным DataTransfer на DOM InventoryApp: target Item в папке после удержания 20.8 с, root background, root Item, deep Item, фон folder popout и поиск по свёрнутой глубокой папке сохранили ожидаемый membership. Это проверка реальных DOM handlers, не ручной OS drag.
- После удаления target между hover/drop операция не изменила source membership, убрала подсветку, показала warning и обновила исчезнувшую строку. Изменение membership другим клиентом и потеря прав дополнительно покрыты focused-тестами.
- На переносах зафиксировано 0 `updateItem` hooks; количества 3/2/1 сохранились. Один target удалён отдельно как тестовая фикстура; оставшиеся 2/1 и membership сохранились после reload страницы.
- Временные Actor/Items, только их registry entry и User folder-expansion entry удалены после QA; удаление подтверждено.
- При первой загрузке обнаружен старый cached folder-tree без нового export; исправлено query `v=1.4.246-folder-drop`. Повторный import и дальнейшие сценарии прошли. В console остаются предупреждения Foundry о прежнем global TextEditor (совместимость до v15); ошибки выполнения исправленных сценариев не обнаружены. Первое создание папки у ещё не зарегистрированной QA-группы было штатно отклонено авторизацией, после регистрации прошло.
- Серверная metadata открытого мира остаётся 1.4.238 даже после reload. QA новых исходников выполнено через import InventoryApp с отдельным query. Для штатной загрузки manifest 1.4.246 нужен перезапуск мира/Foundry; активный мир с другим GM не перезапускался. Player-сессия отдельно live не проверялась.

Полная проверка перед commit: `node --test tests/*.test.mjs` — 3623 passed / 0 failed; `node --check` для всех tracked JS/MJS и нового forwarder — 690 файлов, 0 ошибок; `Get-Content -Raw -Encoding UTF8 | ConvertFrom-Json` — 45 JSON, 0 ошибок; `git diff --check` — чисто. После этого менялись только статусы и результаты в документации.
