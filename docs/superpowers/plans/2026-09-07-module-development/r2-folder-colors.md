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

- [x] Добавить standalone assertions к существующим reducer fixtures:
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
- [x] Запустить node --test tests/inventory-folder-tree.test.mjs; новый export должен отсутствовать.
- [x] Нормализатор:
```js
export function normalizeInventoryFolderColor(value, {strict=false}={}) {
  if (value == null) return null;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (strict) throw new InventoryFolderStateError("invalid-color","Некорректный цвет папки.");
  return null;
}
```
- [x] Добавить color в normalizeInventoryFolderState/cloneNormalizedState/create и projection rows. Reducer set-color проверяет folderId и меняет только color одной папки, не sort/name/parentId/itemFolderIds.
- [x] Tests: absent→null, reset null, lowercase uppercase, nonexistent folder, rename/move/delete не теряют цвет соседей; legacy v1 без write migration; цвета не наследуются детьми.

## Задача R2.2 — Авторизованное изменение

**Modify:** scripts/data/inventory-service.js (здесь объявлены/export существующих folder command constants), scripts/main.js.
**Tests:** tests/inventory-folder-socket.test.mjs, tests/group-command-dispatch.test.mjs.
**Public:** setInventoryFolderColor({groupActorId,folderId,color}).
**Command:** inventory.folder.set-color, exact payload с этими тремя ключами; transport operation ID создаёт gateway, sender из transport.

- [x] В существующем socket harness добавить player/GM matrix и hostile extra key:
```js
const valid = {groupActorId:"group-a",folderId:"bag",color:"#AA7733"};
assert.equal(isValidInventoryFolderColorPayload(valid),true);
assert.equal(isValidInventoryFolderColorPayload({...valid,color:"red"}),false);
assert.equal(isValidInventoryFolderColorPayload({...valid,senderId:"gm"}),false);
```
Новый validator определить рядом с existing isValidInventoryFolderRenamePayload; экспорт для test допускается по принятому в файле pattern.
- [x] Сервис вызывает existing #mutateInventoryFolderState(groupActorId, callback) с pure reducer. Fresh state берётся внутри очереди, не из UI snapshot.
- [x] Composition добавить один wrapper через #runInventoryOrganizationMutation и регистрацию рядом с folder rename/move. Использовать существующую #canSenderManageGroup матрицу; не заменить её blanket GM-only.
- [x] Повтор того же color — no-op либо byte-equivalent state; не сбрасывает latest name. Тест двух queued mutations rename+color сохраняет обе. Player без членства/ownership и inactive GM не пишут локально.
- [x] После успешной mutation — прежний scoped refresh всех inventory/popout views данной группы; другие группы не обновляются.

## Задача R2.3 — Меню, палитра и читаемость

**Modify:** scripts/ui/inventory-app.js, существующий tree partial в templates (найти через data-folder-id), styles/main.css, tests/inventory-app-context.test.mjs.
**Produces:** действие «Цвет папки», typed result {confirmed,color} с тем же cancel принципом R0.

- [x] Добавить test: cancel/reset/выбранный цвет отправляют соответственно0/1/1 calls; меню не создаёт новый folderId.
- [x] Добавить небольшую палитру, hex input и «Сбросить». Невалидный hex не отправляет запрос. Закрытие = no-op; reset посылает null.
- [x] Projection выводит canonical color только в CSS custom property собственного icon/accent. Название и selected/focus контраст берутся из темы, текст не красится произвольным цветом.
- [x] Проверить data-color сохранение при search, collapse, drag, folder popout. Цвет не становится частью folder ID/drag identity.
- [x] Live: два клиента видят одинаковый цвет после rename/move/reload, нейтральный цвет reset, светлая/тёмная темы, keyboard focus.

## Проверки этапа

```powershell
node --test tests/inventory-folder-tree.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-app-context.test.mjs tests/group-command-dispatch.test.mjs
```
**Docs:** паспорт7 (schema/reducer/service),2 (typed command),19 (menu); README folder API. Commit: feat: add persistent inventory folder colors.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [x] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

## Результаты реализации — 2026-09-08

Версия 1.4.248. Canonical reducer/service, exact typed route и прежнее меню расширены; public API и паспорт обновлены. Схема остаётся v1, legacy read не пишет Actor. Отдельная группа/чужой отправитель не меняются; concurrent rename+color и membership сохраняются. Палитра окрашивает только иконку, включая collapsed состояние; текст и focus сохраняют тему.

Focused вместе с module-manifest: 220 passed, 0 failed. Дополнительные regression suites group-inventory-migration/main-composition-root: 96 passed, 0 failed. Первый полный прогон: 3633 passed, 3 failed — два ожидаемых объекта не учитывали новый default color:null и один test проверял прежний cache query. Ожидания обновлены без ослабления проверки отсутствия read-time write.

Live: Foundry 13.351 / dnd5e 5.2.5, testovyj3, два клиента GM CODEX, viewport 1292×920. Временный Actor QA R2: jMg0wds5JlG4vrtx, только три тестовые папки без предметов. Проверены меню, восемь swatches/HEX, cancel после invalid HEX (0 новых запросов), save/reset (по одному), сохранение Actor flag, передача Actor updates второму клиенту, rename/move, search, popout, collapsed icon, light/dark classes и keyboard focus. Синий #6AA9DC дал rgb(106,169,220), фиолетовый #AA87D7 — rgb(170,135,215); текст оставался rgb(238,241,246). Дочерняя папка color:null, reset вернул цвет темы. Новая загрузка второго клиента прочитала сохранённый flag.

Ограничение live authority: существующая active-GM сессия загружена со старым кодом и отвечает Unknown socket command: inventory.folder.set-color. Работающую чужую GM-сессию не перезагружали. Native action был проверен до authoritative dispatch; затем для остальных UI/Document проверок использован временный GM-only QA adapter, ограниченный exact QA Actor ID и вызывающий новый canonical InventoryService. Он не входит в release source. Полный typed маршрут, membership/GM/foreign/unknown/forged sender и requester refresh проверены Node harness; player-сессия в live не проверялась. Штатный выпуск требует обновить active-GM сессию и клиентов; server metadata пока 1.4.238, для нового manifest нужен перезапуск Foundry/мира. QA styles использовали versioned URL.

Полный повторный прогон: node --test tests/*.test.mjs — 3636 passed, 0 failed; node --check — 696 JS/MJS, 0 errors; ConvertFrom-Json — 45 JSON, 0 errors; git diff --check — чисто. После Page.reload во втором клиенте сохранены #AA87D7, новое имя и parentId. Console содержит ожидаемые Unknown socket command от старого active GM; успешные QA-сценарии новых ошибок не дали. Оба QA-окна закрыты, временный Actor удалён, namespace и style overrides очищены; 0 orphan menus. Fetch: HEAD...origin/main = 340/0, HEAD...origin/lich_branch = 0/0.
