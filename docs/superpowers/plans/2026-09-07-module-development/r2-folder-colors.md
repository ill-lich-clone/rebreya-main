# R2 — Цветные папки: Implementation Plan

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

**Goal:** Цвет папки сохраняется между клиентами и reload, не повреждая membership.
**Architecture:** optional color в существующем inventoryFolders v1; reducer → InventoryService → typed route → прежнее меню.
**Spec:** [inventory-storage-ui.md, R2](../../specs/2026-09-07-module-development/inventory-storage-ui.md). После R0.

## Задача R2.1 — Совместимый pure state

**Modify:** scripts/data/inventory-folder-tree.js, tests/inventory-folder-tree.test.mjs.
**Produces:** normalizeInventoryFolderColor(value,{strict=false}={}) → null|#RRGGBB; setInventoryFolderColor(rawState,{folderId,color}) → detached normalized state.
Нормализатор чтения invalid→null; strict mutation invalid→InventoryFolderStateError("invalid-color").

- [ ] Добавить standalone assertions к существующим reducer fixtures:
```js
test("folder colors preserve memberships and legacy folders", () => {
  const initial = createInventoryFolder(createEmptyInventoryFolderState(),
    {folderId:"bag",name:"Сумка",parentId:null});
  initial.itemFolderIds = {rope:"bag"};
  const colored = setInventoryFolderColor(initial,{folderId:"bag",color:"#aa7733"});
  assert.equal(colored.folders[0].color,"#AA7733");
  assert.equal(colored.itemFolderIds.rope,"bag");
  assert.notEqual(colored,initial);
  assert.equal(initial.folders[0].color ?? null,null);
  assert.throws(() => setInventoryFolderColor(initial,{folderId:"bag",color:"url(x)"}));
});
```
- [ ] Запустить node --test tests/inventory-folder-tree.test.mjs; новый export должен отсутствовать.
- [ ] Нормализатор:
```js
export function normalizeInventoryFolderColor(value, {strict=false}={}) {
  if (value == null) return null;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (strict) throw new InventoryFolderStateError("invalid-color","Некорректный цвет папки.");
  return null;
}
```
- [ ] Добавить color в normalizeInventoryFolderState/cloneNormalizedState/create и projection rows. Reducer set-color проверяет folderId и меняет только color одной папки, не sort/name/parentId/itemFolderIds.
- [ ] Tests: absent→null, reset null, lowercase uppercase, nonexistent folder, rename/move/delete не теряют цвет соседей; legacy v1 без write migration; цвета не наследуются детьми.

## Задача R2.2 — Авторизованное изменение

**Modify:** scripts/data/inventory-service.js (здесь объявлены/export существующих folder command constants), scripts/main.js.
**Tests:** tests/inventory-folder-socket.test.mjs, tests/group-command-dispatch.test.mjs.
**Public:** setInventoryFolderColor({groupActorId,folderId,color}).
**Command:** inventory.folder.set-color, exact payload с этими тремя ключами; transport operation ID создаёт gateway, sender из transport.

- [ ] В существующем socket harness добавить player/GM matrix и hostile extra key:
```js
const valid = {groupActorId:"group-a",folderId:"bag",color:"#AA7733"};
assert.equal(isValidInventoryFolderColorPayload(valid),true);
assert.equal(isValidInventoryFolderColorPayload({...valid,color:"red"}),false);
assert.equal(isValidInventoryFolderColorPayload({...valid,senderId:"gm"}),false);
```
Новый validator определить рядом с existing isValidInventoryFolderRenamePayload; экспорт для test допускается по принятому в файле pattern.
- [ ] Сервис вызывает existing #mutateInventoryFolderState(groupActorId, callback) с pure reducer. Fresh state берётся внутри очереди, не из UI snapshot.
- [ ] Composition добавить один wrapper через #runInventoryOrganizationMutation и регистрацию рядом с folder rename/move. Использовать существующую #canSenderManageGroup матрицу; не заменить её blanket GM-only.
- [ ] Повтор того же color — no-op либо byte-equivalent state; не сбрасывает latest name. Тест двух queued mutations rename+color сохраняет обе. Player без членства/ownership и inactive GM не пишут локально.
- [ ] После успешной mutation — прежний scoped refresh всех inventory/popout views данной группы; другие группы не обновляются.

## Задача R2.3 — Меню, палитра и читаемость

**Modify:** scripts/ui/inventory-app.js, существующий tree partial в templates (найти через data-folder-id), styles/main.css, tests/inventory-app-context.test.mjs.
**Produces:** действие «Цвет папки», typed result {confirmed,color} с тем же cancel принципом R0.

- [ ] Добавить test: cancel/reset/выбранный цвет отправляют соответственно0/1/1 calls; меню не создаёт новый folderId.
- [ ] Добавить небольшую палитру, hex input и «Сбросить». Невалидный hex не отправляет запрос. Закрытие = no-op; reset посылает null.
- [ ] Projection выводит canonical color только в CSS custom property собственного icon/accent. Название и selected/focus контраст берутся из темы, текст не красится произвольным цветом.
- [ ] Проверить data-color сохранение при search, collapse, drag, folder popout. Цвет не становится частью folder ID/drag identity.
- [ ] Live: два клиента видят одинаковый цвет после rename/move/reload, нейтральный цвет reset, светлая/тёмная темы, keyboard focus.

## Проверки этапа

```powershell
node --test tests/inventory-folder-tree.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-app-context.test.mjs tests/group-command-dispatch.test.mjs
```
**Docs:** паспорт7 (schema/reducer/service),2 (typed command),19 (menu); README folder API. Commit: feat: add persistent inventory folder colors.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.
