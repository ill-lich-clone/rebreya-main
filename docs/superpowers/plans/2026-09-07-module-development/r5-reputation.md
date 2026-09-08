# R5 — Слава и дурная слава в инвентаре → Группа: Implementation Plan

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

**Goal:** Два независимых счётчика сохраняются для явно выбранного персонажа и редактируются GM.
**Architecture:** pure rules → Actor service/gateway → ReputationPanel в существующем InventoryApp, страница «Группа».
**Spec:** [reputation.md](../../specs/2026-09-07-module-development/reputation.md).

## Решение размещения

Уточнение пользователя 2026-09-08: «внутрь инвентаря на страницу группа». Оно заменяет прежние варианты Космологии/панельной кнопки. Данные персонажа, integer>=0, GM-only writes, без автоматических бонусов.

## Задача R5.1 — Состояние и optimistic update

**Create:** scripts/data/reputation-rules.js, tests/reputation-rules.test.mjs.
**Interfaces:** normalizeReputation(raw) → {version:1,fame,infamy,revision,recentChanges}; applyReputationChange(state,request,{gmId,timestamp}) → nextState.
request={expectedRevision,change,reason,operationId}; change={set:{fame,infamy}} либо {delta:{fame,infamy}}.
MAX_REPUTATION_HISTORY=50; reason trimmed1..240; ID nonempty<=128; strict number/no string coercion.

- [x] Pure tests:
```js
import test from "node:test";
import assert from "node:assert/strict";
import {normalizeReputation,applyReputationChange} from "../scripts/data/reputation-rules.js";
test("fame does not erase infamy",()=>{
 const next=applyReputationChange(normalizeReputation({fame:4,infamy:3,revision:0}),
  {expectedRevision:0,change:{delta:{fame:2,infamy:0}},reason:"Помощь городу",operationId:"o1"},
  {gmId:"gm",timestamp:100});
 assert.equal(next.fame,6); assert.equal(next.infamy,3); assert.equal(next.revision,1);
});
test("negative and stale changes fail",()=>{
 const s=normalizeReputation(null);
 assert.throws(()=>applyReputationChange(s,{expectedRevision:1,change:{set:{fame:1,infamy:0}},
  reason:"Правка",operationId:"o2"},{gmId:"gm",timestamp:100}));
});
```
- [x] Red: node --test tests/reputation-rules.test.mjs.
- [x] Реализовать exact change union, finite safe integer, result>=0; unchanged values не создают второй delta effect. Reads legacy возвращают detached defaults без write.
- [x] Replay operationId ищется в recentChanges до revision check; same fingerprint возвращает saved next outcome, altered payload → operation-conflict. Старый ID вне bounded history со stale expectedRevision не принимается.
- [x] history record хранит ID/fingerprint/gm/timestamp/before/after и revision, slice(-50). Не показывать причине raw HTML.
- [x] Дополнить tests: maxsafe overflow, delta negative allowed если result>=0, invalid string, both set+delta,61 operations, duplicate/conflicting ID.

## Задача R5.2 — Один GM mutation path

**Create:** scripts/application/reputation-service.js, scripts/infrastructure/foundry/reputation-command-contract.js; tests/reputation-service.test.mjs, tests/reputation-socket.test.mjs.
**Modify:** scripts/main.js.
**Public:** getReputation(actorOrUuid); updateReputation({actorUuid,expectedRevision,change,reason,operationId}).
**Service:** ReputationService({resolveActor,coordinator,mutationGateway,refresh}).read(actorUuid); update(request,context).
**Command:** reputation.update; exact keys, authenticated GM only.

- [x] Socket test truth table: valid GM true, OWNER-player false, unknown User false; extra ItemData/senderId rejected; actor.type !==character rejected. Ни одна отказанная команда не вызывает actor.update.
- [x] Gateway direct active GM и inactive GM typed route должны исполнить один и тот же executor. Не вызывать mutate из executor повторно.
- [x] В actor queue fresh-read flag, применить pure change, один actor.update({["flags.rebreya-main.reputation"]:next}) с authority guards. Mutation включает history/receipt и values атомарно.
- [x] Exception после actor.update → readback operation receipt; verified success возвращается, unknown → ambiguous-outcome без повторной delta. Тест fake Actor throw-after-write обязателен.
- [x] Refresh только projection выбранного actorUuid. Два concurrent GMs с revision0: один success, второй stale, значения первого сохраняются.
- [x] Get возвращает доступную actor projection; public read не открывает hidden чужие Actor только потому, что UUID известен.

## Задача R5.3 — Панель на странице «Группа»

**Modify:** scripts/ui/inventory-app.js, templates/inventory-app.hbs, styles/main.css.
**Create:** scripts/ui/reputation-panel.js, templates/reputation-panel.hbs, tests/reputation-ui.test.mjs.

- [x] Варианты Космологии/панельной кнопки исключены. В Космологии нет счётчиков; existing file восстановлен без изменений.
- [x] Явный выбор character-участника текущей группы, только доступные Actor; default «Выберите персонажа», без controlled-token fallback.
- [x] Два независимых значения, GM edit form set/delta/reason и read-only player context. Captured actorUuid/revision сохраняются на время await, изменение выбора не меняет target.
- [x] Cancel no-op, invalid local input не отправляется. Stale закрывает старую форму, показывает свежие данные и требует явной новой правки. Ambiguous retry хранит exact payload/operationId.
- [x] Reasons/names экранирует отдельный Handlebars template. Trusted rendered HTML вставляется в inventory template; raw Actor строки не интерполируются как HTML.
- [x] Scoped refresh заменяет только data-reputation-panel, не пересчитывает inventory/economy. Generation guard отбрасывает старый render; AbortController исключает duplicate listeners и очищается при close.
- [x] Tests: placement только внутри party, no selected actor, no writes on cancel, strict local parse, переключение Actor во время submit, stale/retry, rerender и teardown.

## Проверки этапа

```powershell
node --test tests/reputation-rules.test.mjs tests/reputation-service.test.mjs tests/reputation-socket.test.mjs tests/reputation-ui.test.mjs tests/group-command-dispatch.test.mjs tests/main-composition-root.test.mjs tests/bg3-hotbar-compat.test.mjs tests/cosmology-mechanus-rolls.test.mjs tests/inventory-app-context.test.mjs
```
Live: selectedActor1/2, concurrent edit, close/cancel, reload, narrow window, GM/player, unchanged Mechanus behavior. Snapshot values доказывают независимые fame/infamy.

**Docs:** паспорт2/16/19, README public API. Commit: feat: add actor fame and infamy on inventory group page.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

## Фактический результат — 2026-09-08

Реализовано в 1.4.251: два независимых счётчика character Actor, GM-only set/delta с причиной, история 50 правок, явный выбор участника на странице «Группа» партийного инвентаря. Космология и её шаблон не изменены. Typed command использует существующий gateway; atomic receipt защищает повтор, revision — конкурирующие правки. Обновляется только карточка выбранного персонажа.

### Автоматические проверки

- TDD: новые rules/service/contract сначала падали из-за отсутствующих импортов; UI — из-за отсутствующих методов/размещения. Добавлено 19 профильных тестов.
- Focused-команда из раздела выше плюс `tests/module-manifest.test.mjs`: **254 passed / 0 failed**.
- `node --test tests/*.test.mjs`: **3717 passed / 0 failed / 0 skipped**. После полного прогона усилены только два существующих теста (разные authenticated GM и очистка выбора при смене группы); focused-профиль повторно прошёл 254/0. Runtime после полного прогона не менялся.
- `node --check` для 722 tracked/new JS/MJS: 0 ошибок. `ConvertFrom-Json` для 46 JSON: 0 ошибок. `git diff --check`: чисто.
- Проверены direct/inactive GM маршруты через реальный gateway/bus в mock network, запрет player/forged sender, отсутствие active GM, потеря authority, concurrent revision, throw-before/after-write, exact retry/conflict. 51 операция с длинными Unicode причинами оставляет историю на Actor, компактный write response не переполняет envelope.

### Проверка в Foundry

Мир `testovyj3`, Foundry 13.351, dnd5e 5.2.5; CODEX — GM requester, Gamemaster — active GM. Viewport 1292×920. После обновления active GM штатная команда `reputation.update` выполняется; прежняя ошибка unknown-command устранена обновлением сессии.

- Временные character Actor добавлены в существующую тестовую группу штатным `Actor.update(system.members)`. Попытка legacy addPartyMember была отклонена до записи штатным ограничением управления составом через dnd5e группу.
- Счётчики первого Actor: 4/3 → UI +2/0 → 6/3; конкурирующая правка +1 дала 7/3, submit старой формы отклонён как stale. Второй Actor через UI получил 1/8 независимо от первого.
- Exact native retry вернул сохранённый результат без второй записи; изменённая причина с тем же operationId дала operation-conflict, значения сохранились.
- Причина `QA: <b>награда</b>` отображается буквальным текстом; HTML-элемент не создаётся. Default selection пустой; смена Actor явно меняет карточку. Cancel проверен без записи; финальный контроллер также покрыт Node-тестом отмены.
- После reload значения 7/3 и 1/8 сохранились. Репутация есть в инвентаре → «Группа», в открытой Космологии её нет; значение Механуса осталось true.
- В окне 720×780 сама карточка репутации помещается без горизонтального переполнения, длинное имя переносится. В прежних строках участников ниже карточки есть наложение текста при такой ширине; это отдельный дефект существующей страницы.
- После проверки удалены оба временных Actor и только их записи из свежего списка группы. Остальные шесть участников сохранены. Последняя проверка browser error logs после reload/cleanup: пусто.

Ограничения: отдельная живая player-сессия не проверена; player permissions/read-only покрыты Node. Active GM загрузил реализацию до последнего сокращения write response: native проверки прошли с небольшими ответами с history, окончательный компактный response и большая Unicode history проверены Node. Серверная module metadata ещё показывает 1.4.238, при этом CODEX после reload выполняет обновлённый код; manifest/forwarder в репозитории — 1.4.251. MCP capture был выключен, визуальная проверка выполнена обычными browser screenshots.

### Git

До stage: lich_branch, HEAD b6fb0d53; после fetch HEAD...origin/main = 344/0, HEAD...origin/lich_branch = 0/0. Все изменения относятся к R5. Реализация: commit `12dfc30f` (`feat: add actor reputation on inventory group page`), push в origin/lich_branch выполнен. После push рабочая копия чистая, HEAD...origin/lich_branch = 0/0. Эта запись — отдельное документирование результата, runtime не менялся.
