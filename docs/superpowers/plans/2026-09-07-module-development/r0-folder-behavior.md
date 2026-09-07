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

- [ ] Добавить тест в существующий файл после установки Foundry stub:
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
- [ ] Запустить node --test --test-name-pattern="folder result" tests/inventory-app-context.test.mjs. Ожидается красный тест на отсутствующем export.
- [ ] Добавить helper и использовать его после DialogV2.wait:
- [ ] Импортировать существующий MAX_INVENTORY_FOLDER_NAME_LENGTH из scripts/data/inventory-folder-tree.js; не вводить второй лимит имени.
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
- [ ] Изменить existing dialog mocks, которые сейчас возвращают строки: они должны исполнять callback выбранной кнопки и применять result ?? button.action. Close/Escape возвращают null при rejectClose:false.
- [ ] В UI integration assertions доказать ноль create/rename/API calls для всех трёх способов отмены; Confirm создаёт один вызов, даже для имени cancel. UUID создаётся только после успешного normalize.
- [ ] Прогнать весь tests/inventory-app-context.test.mjs; проверить create, rename и empty/long input, а не только новый helper.

## Задача R0.2 — Один resolver для hover и drop

**Files:** scripts/data/inventory-folder-tree.js; scripts/ui/inventory-app.js; tests/inventory-folder-tree.test.mjs; tests/inventory-app-context.test.mjs.
**Consumes:** normalized state {folders,itemFolderIds}, существующий inventory snapshot и rootFolderId окна.
**Produces:** новый pure resolveInventoryDropFolderId({target,state,itemIds,rootFolderId=null}) → folderId|null.
target: {kind:"item"|"folder"|"background"|"root",id?}; unknown kind/ID бросает InventoryFolderStateError("invalid-drop-target").

- [ ] Добавить тест точного membership; импортировать новый export рядом с reducer:
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
- [ ] Запустить node --test tests/inventory-folder-tree.test.mjs; новый контракт должен быть красным.
- [ ] Реализовать switch в pure helper. Для item сначала проверить присутствие в itemIds, затем читать state.itemFolderIds[id] ?? null; найденный folder ID дополнительно проверяется в state.folders. Для folder проверить ID; для background вернуть проверенный rootFolderId; для root вернуть null. Не использовать имя, DOM ancestor folder или длительность hover.
- [ ] В #resolveInventoryDropTarget() разделить DOM hit-test и membership: точная Item row имеет приоритет; явная root-surface различается с пустым фоном popout. Передать projection resolver и вернуть прежние targetElement/highlightElement.
- [ ] Hover использует актуальную cache текущего render. В drop один раз получить fresh inventory snapshot через существующий getInventorySnapshot с явным groupActorId, пересчитать destination и затем вызвать прежний #resolveInventoryDropAction/mutation route. Если target исчез — warning, refresh и no-op; не подменять на null.
- [ ] Обновить тест "InventoryApp routes internal and external drops..." и обе main/popout ветки: nested Item→membership; root Item→null; background popout→rootFolderId. Journal/external Item маршруты сохраняются.
- [ ] Добавить case: другой клиент изменил папку target между hover и drop. Подсветка очищается, результат использует свежий membership. Self/descendant/cross-group папок остаются запрещены прежним owner.
- [ ] После dragend/error/rerender очистить highlight и transient session ровно прежним lifecycle.

## Проверки этапа

```powershell
node --test tests/inventory-app-context.test.mjs tests/inventory-folder-tree.test.mjs tests/inventory-folder-socket.test.mjs
```
Live: create→cancel, rename→Escape, крестик; literal cancel Confirm; root/folder/deep folder, search filter, folder popout, удержание 2 секунды, удалённый target. Проверить membership после reload и отсутствие Item quantity writes.

**Docs:** паспорт7/19: заменить старое «любая Item row означает корень» новым правилом; описать оба новых helpers. Commit: fix: preserve folder destinations and cancel folder dialogs.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.
