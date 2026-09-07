# R3 — Частичные переносы и экземпляры: Implementation Plan

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

**Goal:** 10 предметов делятся на3+7; экипированная единица имеет собственный Item ID; сбой не дублирует вещи.
**Architecture:** InventoryService и HeroDollService сохраняют policy ownership, общий внутренний application worker выполняет recoverable Document операции через существующий journal.
**Spec:** [папки R3](../../specs/2026-09-07-module-development/inventory-storage-ui.md), [кукла R3](../../specs/2026-09-07-module-development/hero-doll.md). Сначала R0.

## Задача R3.1 — Чистый план выделения единицы

**Create:** scripts/data/item-instance-rules.js, tests/item-instance-rules.test.mjs.
**Produces:** planItemInstanceMutation({source,quantity,sameActor,sameFolder,forHeroSlot}) →
{kind:"noop"|"membership"|"split"|"move",quantity,sourceRemaining,preserveSourceId}.
source={quantity,step,hasContents,hasInstalledUpgrades,hasIndependentState,isEquipped,isHeld}; все поля DTO предоставляет owner из fresh Documents, не клиент.

- [ ] Написать pure tests:
```js
import test from "node:test";
import assert from "node:assert/strict";
import {planItemInstanceMutation as plan} from "../scripts/data/item-instance-rules.js";
const source={quantity:10,step:1,hasContents:false,hasInstalledUpgrades:false,
  hasIndependentState:false,isEquipped:false,isHeld:false};
test("partial transfer conserves quantity",()=>{
  const p=plan({source,quantity:3,sameActor:true,sameFolder:false,forHeroSlot:false});
  assert.equal(p.kind,"split"); assert.equal(p.sourceRemaining,7);
  assert.equal(p.quantity+p.sourceRemaining,source.quantity);
});
test("whole membership preserves Item identity",()=>{
  const p=plan({source,quantity:10,sameActor:true,sameFolder:false,forHeroSlot:false});
  assert.equal(p.kind,"membership"); assert.equal(p.preserveSourceId,true);
});
test("complex stack cannot be cloned",()=>{
  assert.throws(()=>plan({source:{...source,hasInstalledUpgrades:true},quantity:1,
    sameActor:true,sameFolder:false,forHeroSlot:true}));
});
```
- [ ] Запустить node --test tests/item-instance-rules.test.mjs, подтвердить red.
- [ ] Реализовать finite q>0<=Q и кратность source.step через scaled integer units. Обычные вещи step1; дробные материалы получают existing precision от InventoryService. Не Math.floor любых данных.
- [ ] sameActor && sameFolder && !forHeroSlot → noop. q=Q sameActor → membership/placement с прежним ID; q<Q simple→split; crossActor q=Q→move. forHeroSlot требует q1, допустимый slot проверяется owner до worker. Совпавший null folderId у разных Actor не означает no-op; отдельный regression обязателен.
- [ ] Для q<Q запретить hasContents/hasInstalledUpgrades/hasIndependentState/isEquipped/isHeld. Whole complex transfers делегировать существующему graph/storage owner, а не clone worker.
- [ ] Дополнить boundary tests:0,NaN,Infinity,Q+1, fractional1.25 с step0.01, illegal1.25 со step1, same folder, source0.

## Задача R3.2 — Journal и Document driver

**Create:** scripts/application/item-instance-workflow.js, tests/item-instance-workflow.test.mjs, tests/helpers/item-instance-fixture.mjs.
**Modify:** только необходимые адаптеры scripts/data/inventory-service.js и scripts/data/hero-doll-service.js.
**Interface:** ItemInstanceWorkflow({journal,coordinator,documents}).run(intent,context), DTO/return из [общего контракта](README.md).
context={sender,assertAuthority,authorize,preparePlacement}; authorize принимает fresh source/target и intent; preparePlacement возвращает только разрешённые owned flag patches.

Driver documents (планируемый внутренний объект, без собственного state):
- readSource(intent) → detached fresh source+Actor refs и tracked quantity/flags;
- createTarget(plan,record,context) → receipt с предвыделенным Item ID;
- readTargetReceipt(record) → exact ID/fingerprint либо null/conflict;
- debitSource(plan,record,context) → receipt исходного quantity;
- writePlacement(record,patches,context) → receipt membership/hero slots;
- inspect(record) → фактические значения только затронутых полей/IDs;
- compensate(record,inspection,context) → подтверждённое восстановление либо manual-review.
Каждый write через Foundry Documents, assertAuthority непосредственно до/после; source/target actorIds не берутся из payload как trusted refs.

- [ ] Fixture реализует эти методы в Map, хранит calls, считает create/debit/placement и умеет failAt с throw-before-write/throw-after-write. Это тестовый repository fake, не UI и не production helper.
- [ ] Написать тест на повтор уже завершённой операции:
```js
const fx=makeItemInstanceFixture({quantity:10}); // новый helper этого шага
const intent={operationId:"split-1",sourceActorUuid:"Actor.g",sourceItemId:"rope",
  destinationActorUuid:"Actor.g",quantity:3,targetFolderId:"bag",heroSlotId:null,
  expectedSourceQuantity:10};
const first=await fx.workflow.run(intent,fx.context);
const second=await fx.workflow.run(intent,fx.context);
assert.equal(first.itemId,second.itemId);
assert.equal(fx.quantity("rope"),7);
assert.equal(fx.quantity(first.itemId),3);
assert.equal(fx.calls.filter(x=>x==="createTarget").length,1);
```
makeItemInstanceFixture возвращает {workflow,context,calls,quantity,failAt,restart}; restart создаёт новый worker поверх сохранённого journal/Map. Actor IDs и fixture root соответствуют intent выше.
- [ ] Запустить node --test tests/item-instance-workflow.test.mjs и получить red на новой функции/worker.
- [ ] Реализовать последовательность из таблицы. journal.find(operationKey) вызывается до fresh source requirement; существующий terminal retry возвращает receipt даже если source уже удалён.
- [ ] Stable operationKey включает authenticated sender ID, action и operationId; fingerprint включает все intent поля. Изменённый intent с тем же key → operation-conflict.
- [ ] journal.start хранит IDs target, source before quantity, нужные flag snapshots и immutable intent до первого side effect. ID не генерируется заново при recovery.

| Phase | Запись | Доказательство при recovery |
|---|---|---|
| prepared | только journal и предвыделенные IDs | source ещё не списан |
| target-created | target с operation fingerprint | read exact target marker/ID |
| source-debited | уменьшить source либо удалить только simple whole source | quantity и marker в одной Item update для split; whole delete требует подтверждённого receipt существующего transfer owner, не одного факта отсутствия Item |
| placement-written | folder/hero slot и equipped patches | exact actor/item touched fields + marker |
| committed | journal.finish с result | retry без повторного writes |
| compensated/manual-review | восстановить только доказанно принадлежащие операции writes | не затереть unrelated edits |

- [ ] No-op/membership path не создаёт embedded Item. Для plain split target clone сохраняет source metadata, но очищает старые transfer receipt IDs и выдаёт новые. Нельзя удалять пользовательские flags или copy managed runtime identity старого instance.
- [ ] sourceRemaining означает фактически оставшееся количество source: Q для membership/no-op, Q−q для split, 0 для завершённого whole transfer между Actor. Если после whole delete нет достаточного receipt, recovery → manual-review; исчезновение Item само по себе не доказывает, кто его удалил.
- [ ] Перед compensation сравнить фактические touched fields с ожидаемыми; если другой процесс уже изменил их, manual-review. Не восстанавливать весь Actor snapshot поверх чужих изменений.
- [ ] Fault matrix: failure before/after create, debit, placement, journal finish; restart на каждой фазе; удалённый target после source commit; changed fingerprint; два конкурентных запроса. Итог —0 потерь/0 лишних единиц либо явный nonterminal manual-review без повторной выдачи.

## Задача R3.3 — Папки и UI количества

**Modify:** InventoryService.moveInventoryItemToFolder(), existing folder command validator/wrapper в scripts/main.js, scripts/ui/inventory-app.js, existing command constants; tests/inventory-folder-quantity-transfer.test.mjs (новый), inventory-folder-socket/app-context.
**Public:** moveInventoryItemToFolder({groupActorId,itemId,folderId=null,quantity?,operationId?}). Старый whole-stack call поддерживается.

- [ ] Расширить exact schema whitelist optional quantity/operationId; partial route требует stable ID. Полномочия прежние group management; свежий source находится в exact group.
- [ ] Передать policy-validated intent worker; folder reducer по-прежнему только membership, не embedded create/delete.
- [ ] UI обычный drag = весь стек; Shift+drop и «Перенести часть…» используют один quantity dialog. Existing external quantity flow не спрашивает повторно.
- [ ] До await сохранить exact source/target IDs, не mutable selection; Confirm создаёт operationId один раз. Cancel — no socket. Stale max после диалога даёт ошибку и refresh.
- [ ] Whole q=Q сохраняет прежний Item ID, case same folder no-op. Partial3of10 даёт новую ID в destination и старую7 в source без merge по имени.
- [ ] Исполнить tests/inventory-simple-transfer.test.mjs и inventory-mutation-recovery.test.mjs для сохранения старого fast path.

## Задача R3.4 — Кукла выделяет реальную единицу

**Modify:** HeroDollService.assignItemToSlot/#resolveDropItem/#moveItemToActor/#saveState, scripts/main.js, tests/hero-doll-service.test.mjs.
**New typed command:** hero-doll.assign с {actorUuid,sourceItemUuid,slotId,operationId}; авторизованный OWNER target и source либо allowed group transfer, не произвольный Actor.

- [ ] Тест owned stack2→equipped1+available1, distinct IDs с одинаковым именем, move equipped slot без новой ID. Полный test fake Actor поддерживает create/update/delete/flags и replay receipts, а не только snapshot.
- [ ] Проверить allowed slot/руки/ownership ДО выделения source. Ранее private #resolveDropItem мутирует до validation; заменить на resolve-only, а transfer выполняет worker после policy.
- [ ] Подключить same-Actor и group-source к единому worker. Current public assignItemToSlot(actor,slotId,dropData) сохраняет возвращаемый Item, internally unwrap result.itemId.
- [ ] #saveState меняет heroDoll одним поддержанным replacement update вместо unsetFlag→setFlag. Проверить удаление старой slot записи и отсутствие merge leftovers по образцу inventoryFolders replacement.
- [ ] Замена занятого slot освобождает прежний экземпляр через existing equip/held owner, а перемещение одного Item между slots очищает прежнюю запись. Fault test после выделения нового Item, но до замены занятого slot, сохраняет оба физических экземпляра и согласованные руки.
- [ ] Снятие не сливает экземпляры по имени; two-hand item остаётся одним документом. Legacy occupied quantity>1 исправляется отдельным явным действием с сохранением original ID у экипированной единицы.
- [ ] Повтор sync CurseEater/CurseUpgrade не удваивает host. Complex stack вызывает объяснимую ошибку, а не дублирует upgrades/charges.

## Проверки и приёмка

```powershell
node --test tests/item-instance-rules.test.mjs tests/item-instance-workflow.test.mjs tests/inventory-folder-quantity-transfer.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-app-context.test.mjs tests/hero-doll-service.test.mjs tests/held-items.test.mjs tests/item-upgrade-service.test.mjs tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/curse-eater-automation-service.test.mjs tests/curse-upgrade-lifecycle.test.mjs
```
Live GM/player: split/whole/cancel, same-group permissions, two clients, delete source while dialog open, equip/unequip/reload, two amulets. Проверить quantity суммой Documents, не количеством иконок.

**Docs:** паспорт2/7/14/16/18 и README optional API args/typed command. Отдельные commits для worker+folder и hero integration допустимы после соответствующих verified tasks.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.
