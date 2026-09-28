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

- [x] Написать pure tests:
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
- [x] Запустить node --test tests/item-instance-rules.test.mjs, подтвердить red.
- [x] Реализовать finite q>0<=Q и кратность source.step через scaled integer units. Обычные вещи step1; дробные материалы получают existing precision от InventoryService. Не Math.floor любых данных.
- [x] sameActor && sameFolder && !forHeroSlot → noop. q=Q sameActor → membership/placement с прежним ID; q<Q simple→split; crossActor q=Q→move. forHeroSlot требует q1, допустимый slot проверяется owner до worker. Совпавший null folderId у разных Actor не означает no-op; отдельный regression обязателен.
- [x] Для q<Q запретить hasContents/hasInstalledUpgrades/hasIndependentState/isEquipped/isHeld. Whole complex transfers делегировать существующему graph/storage owner, а не clone worker.
- [x] Дополнить boundary tests:0,NaN,Infinity,Q+1, fractional1.25 с step0.01, illegal1.25 со step1, same folder, source0.

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

- [x] Fixture реализует эти методы в Map, хранит calls, считает create/debit/placement и умеет failAt с throw-before-write/throw-after-write. Это тестовый repository fake, не UI и не production helper.
- [x] Написать тест на повтор уже завершённой операции:
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
- [x] Запустить node --test tests/item-instance-workflow.test.mjs и получить red на новой функции/worker.
- [x] Реализовать последовательность из таблицы. journal.find(operationKey) вызывается до fresh source requirement; существующий terminal retry возвращает receipt даже если source уже удалён.
- [x] Stable operationKey включает authenticated sender ID, action и operationId; fingerprint включает все intent поля. Изменённый intent с тем же key → operation-conflict.
- [x] journal.start хранит IDs target, source before quantity, нужные flag snapshots и immutable intent до первого side effect. ID не генерируется заново при recovery.

| Phase | Запись | Доказательство при recovery |
|---|---|---|
| prepared | только journal и предвыделенные IDs | source ещё не списан |
| target-created | target с operation fingerprint | read exact target marker/ID |
| source-debited | уменьшить source либо удалить только simple whole source | quantity и marker в одной Item update для split; whole delete требует подтверждённого receipt существующего transfer owner, не одного факта отсутствия Item |
| placement-written | folder/hero slot и equipped patches | exact actor/item touched fields + marker |
| committed | journal.finish с result | retry без повторного writes |
| compensated/manual-review | восстановить только доказанно принадлежащие операции writes | не затереть unrelated edits |

- [x] No-op/membership path не создаёт embedded Item. Для plain split target clone сохраняет source metadata, но очищает старые transfer receipt IDs и выдаёт новые. Нельзя удалять пользовательские flags или copy managed runtime identity старого instance.
- [x] sourceRemaining означает фактически оставшееся количество source: Q для membership/no-op, Q−q для split, 0 для завершённого whole transfer между Actor. Если после whole delete нет достаточного receipt, recovery → manual-review; исчезновение Item само по себе не доказывает, кто его удалил.
- [x] Перед compensation сравнить фактические touched fields с ожидаемыми; если другой процесс уже изменил их, manual-review. Не восстанавливать весь Actor snapshot поверх чужих изменений.
- [ ] Fault matrix: failure before/after create, debit, placement, journal finish; restart на каждой фазе; удалённый target после source commit; changed fingerprint; два конкурентных запроса. Итог —0 потерь/0 лишних единиц либо явный nonterminal manual-review без повторной выдачи.

## Задача R3.3 — Папки и UI количества

**Modify:** InventoryService.moveInventoryItemToFolder(), existing folder command validator/wrapper в scripts/main.js, scripts/ui/inventory-app.js, existing command constants; tests/inventory-folder-quantity-transfer.test.mjs (новый), inventory-folder-socket/app-context.
**Public:** moveInventoryItemToFolder({groupActorId,itemId,folderId=null,quantity?,operationId?}). Старый whole-stack call поддерживается.

- [x] Расширить exact schema whitelist optional quantity/operationId; partial route требует stable ID. Полномочия прежние group management; свежий source находится в exact group.
- [x] Передать policy-validated intent worker; folder reducer по-прежнему только membership, не embedded create/delete.
- [x] UI обычный drag = весь стек; Shift+drop и «Перенести часть…» используют один quantity dialog. Existing external quantity flow не спрашивает повторно.
- [x] До await сохранить exact source/target IDs, не mutable selection; Confirm создаёт operationId один раз. Cancel — no socket. Stale max после диалога даёт ошибку и refresh.
- [x] Whole q=Q сохраняет прежний Item ID, case same folder no-op. Partial3of10 даёт новую ID в destination и старую7 в source без merge по имени.
- [x] Исполнить tests/inventory-simple-transfer.test.mjs и inventory-mutation-recovery.test.mjs для сохранения старого fast path.

## Задача R3.4 — Кукла выделяет реальную единицу

**Modify:** HeroDollService.assignItemToSlot/#resolveDropItem/#moveItemToActor/#saveState, scripts/main.js, tests/hero-doll-service.test.mjs.
**New typed command:** hero-doll.assign с {actorUuid,sourceItemUuid,slotId,operationId}; авторизованный OWNER target и source либо allowed group transfer, не произвольный Actor.

- [x] Тест owned stack2→equipped1+available1, distinct IDs с одинаковым именем, move equipped slot без новой ID. Полный test fake Actor поддерживает create/update/delete/flags и replay receipts, а не только snapshot.
- [x] Проверить allowed slot/руки/ownership ДО выделения source. Ранее private #resolveDropItem мутирует до validation; заменить на resolve-only, а transfer выполняет worker после policy.
- [x] Подключить same-Actor и group-source к единому worker. Current public assignItemToSlot(actor,slotId,dropData) сохраняет возвращаемый Item, internally unwrap result.itemId.
- [x] #saveState меняет heroDoll одним поддержанным replacement update вместо unsetFlag→setFlag. Проверить удаление старой slot записи и отсутствие merge leftovers по образцу inventoryFolders replacement.
- [x] Замена занятого slot освобождает прежний экземпляр через existing equip/held owner, а перемещение одного Item между slots очищает прежнюю запись. Fault test после выделения нового Item, но до замены занятого slot, сохраняет оба физических экземпляра и согласованные руки.
- [x] Снятие не сливает экземпляры по имени; two-hand item остаётся одним документом. Legacy occupied quantity>1 исправляется отдельным явным действием с сохранением original ID у экипированной единицы.
- [x] Повтор sync CurseEater/CurseUpgrade не удваивает host. Complex stack вызывает объяснимую ошибку, а не дублирует upgrades/charges.

## Проверки и приёмка

```powershell
node --test tests/item-instance-rules.test.mjs tests/item-instance-workflow.test.mjs tests/inventory-folder-quantity-transfer.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-app-context.test.mjs tests/hero-doll-service.test.mjs tests/held-items.test.mjs tests/item-upgrade-service.test.mjs tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/curse-eater-automation-service.test.mjs tests/curse-upgrade-lifecycle.test.mjs
```
Live GM/player: split/whole/cancel, same-group permissions, two clients, delete source while dialog open, equip/unequip/reload, two amulets. Проверить quantity суммой Documents, не количеством иконок.

**Docs:** паспорт2/7/14/16/18 и README optional API args/typed command. Отдельные commits для worker+folder и hero integration допустимы после соответствующих verified tasks.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.


## Реализация 1.4.249 и фактическая проверка

R3.1–R3.4 реализованы; executable contracts и методы: [профильный паспорт](../../../item-instance-passport.md). Вместо отдельных inspect/readTargetReceipt методов driver проверяет exact receipts в createTarget/debitSource/verifyCommitted/compensate. Hero #saveState/#resolveDropItem/#moveItemToActor удалены: нет второго raw clone/write owner. Clear и explicit normalize добавлены как отдельные typed commands того же gateway, с mode только на серверной регистрации.

Профиль из этого плана плюс `hero-doll-instances`: **310 passed, 0 failed** (2026-09-08). Тесты покрывают 3+7, whole/no-op ID, невалидный шаг/maximum, cancel, typed sender/schema, owned 2→1+1, замену и перенос слота, две руки, legacy normalize, group partial/whole и deleted-source replay, ошибки до/после create/debit/equip/placement, restart после потери GM authority, journal-finish failure и missing target/manual-review. Полная fault matrix на каждом journal checkpoint остаётся отдельным расширением, не объявлена выполненной.

Live: `https://vtt.rebreya.com/game`, world `testovyj3`, Foundry **13.351**, dnd5e **5.2.5**, GM **CODEX**, viewport **1292×920**. Production worker/driver проверены на реальных Documents временного Actor `hVDGGxpDRhxCtF3h`, с memory journal и QA context, ограниченным этим Actor и GM тестового мира. Это не обход production socket authorization: authoritative HeroDollService/InventoryService в live не заменялись.

- Два QA амулета: source `OMzfouY41okgjcsn` 1 неэкипированный, target `rab8705b9f5c06a9` 1 экипированный; одинаковое имя/custom flag сохранены, сумма=2. Replay возвратил тот же ID без добавлений.
- Реальный Actor update `flags.rebreya-main.==heroDoll` удалил прежний слот при replacement. После reload сохранились ID, quantity и neck slot.
- DialogV2: «Количество» и папка доступны; ввод 0 → «Отмена» вернул null и сохранил сумму=2. Ячейки куклы 80×80 CSS px; скриншот показал отдельный амулет в neck без имени внутри клетки.
- Active GM **Gamemaster** остался на старой сессии; серверная metadata модуля всё ещё **1.4.238**. Новая native `hero-doll.clear` получила `unknown-command` без изменений предметов. Сессия другого GM не перезагружалась. End-to-end player/двухклиентный новый socket route, native normalize button и complete live fault matrix остаются открыты до обновления active GM.
- QA Actor удалён после проверок, QA globals исчезли при reload; ошибки console после reload не обнаружены. World journal QA не записывался.

Ограничение: split сложных stack запрещён, whole complex group→hero пока также отклонён до writes, поскольку существующий take owner не предоставляет подтверждённого переноса всего графа upgrades/contents. Same-Actor complex singleton сохраняет ID. Это защитное ограничение первой поставки, а не реализация graph transfer. Synthetic token Actor UUIDs не принимаются новой typed schema; использовать world character sheet. Manual-review требует сверки; автоматического repair UI нет.


Финальная проверка перед commit: `node --test tests/*.test.mjs` — **3683 passed, 0 failed, 0 skipped**. `node --check` — **706** JS/MJS файлов, **0** ошибок; `ConvertFrom-Json` — **45** JSON, **0** ошибок. `git diff --check` и `git diff --cached --check` чистые. Первый полный прогон выявил 8 устаревших version/import/compatibility-forwarder assertions; старый forwarder 1.4.248 сохранён, ожидания актуализированы и повторный полный прогон прошёл. Рабочая ветка lich_branch; fetch перед commit: HEAD...origin/main=341/0, HEAD...origin/lich_branch=0/0, входящих main commits нет.


### Повторная native проверка после входа CODEX — 2026-09-08

На commit `0c71cf7f` реальные typed requests CODEX → active GM Gamemaster прошли: частичный перенос 10 → 7+3, exact retry без дубликатов, whole перенос 7 с сохранением ID; assign амулета 2 → 1+1, clear без слияния, normalize кольца 3 → 1+2, смена ring1 → ring2 с прежним ID; group → hero выдаёт один экземпляр и удаляет источник. Блокировка unknown-command снята обновлением GM-сессии. Серверная metadata по-прежнему 1.4.238, исполняемый код 1.4.249; Foundry 13.351, dnd5e 5.2.5, testovyj3, CODEX/GM → Gamemaster/GM, viewport 1292×920. Все временные Actor/Item/folder удалены; terminal journal audit оставлен. Два отклонённых QA setup запроса: group member требовал Actor ID вместо UUID; незарегистрированная временная group не прошла folder authorization. Повторены с корректными fixtures. Отдельная player-сессия и полная live fault matrix ещё не пройдены; ограничения complex transfer остаются. R3 commit/push завершены, origin/lich_branch синхронна.

## Полное дерево group→hero — 1.4.280

Снято прежнее ограничение для whole сложного singleton: штатный InventoryService.take переносит все native descendants/upgrades через существующий graph materializer, сохраняет runtime flags/количество/валюту и remaps links. HeroDoll делегирует ему перенос и затем экипирует root; prepared placement учитывает нормализацию hand flags транспортом. Частичный complex stack по-прежнему запрещён, equipped/held source сначала освобождается.

Один новый regression покрывает вложенную сумку, содержимое quantity3, upgrade links/hostActorId, валюту3gp, прерывание после удаления child, запрет конкурирующего child take и terminal replay после удаления target. Существующий whole hero test проверяет теперь upgraded item. Focused:36/0. Native Foundry13.351/dnd5e5.2.5: временные group/character, четыре Items, source0/target4,3gp,qty3, все links/flags сохранены, terminal replay не создаёт удалённый root. Использован application helper с memory journal и ограниченным QA GM context; это не подтверждение нового active-GM typed route. Все временные Actors удалены. Первое QA создание ещё дописывалось native hooks: guard корректно остановил перенос по source drift; после ожидания стабильного source весь цикл прошёл.

Обычный повтор кнопки получения также проверен: public take без mutationId находит pending graph и продолжает прежнюю выдачу тому же персонажу. Изменение адресата/количества не разрешено.

Проверки 1.4.280: focused36/0; финальный node --test tests/*.test.mjs —4022 passed /0 failed; node --check —797 JS/MJS, JSON parse —46 файлов, ошибок0. После доработки public retry изменённые JS/MJS дополнительно проверены node --check. Первое падение полной проверки касалось устаревшего cache assertion 1.4.268; ожидание обновлено до1.4.280. git diff --check чисто. Native QA Actors с префиксом [QA R3/R9] осталось0.
