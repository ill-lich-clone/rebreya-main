# R5 — Слава и дурная слава под Механусом: Implementation Plan

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
**Architecture:** pure rules → Actor service/gateway → существующий CosmologyApp либо anchor панели; не character XP UI.
**Spec:** [reputation.md](../../specs/2026-09-07-module-development/reputation.md).

## Решение размещения

Точно согласовано «под местом Механуса». Технический вариант по умолчанию в спецификации — внутри CosmologyApp сразу после секции Механуса. План R5.3A конкретно описывает его. Если пользователь уточнит «под кнопкой панели», выполнить R5.3B вместо A; оба одновременно не делать. Data/API tasks R5.1–2 одинаковы.

Предлагаемые defaults из спецификации: character Actor, integer>=0, GM-only writes, no automatic bonuses. Это новые правила данных для MVP, не заявленные пользователем социальные thresholds.

## Задача R5.1 — Состояние и optimistic update

**Create:** scripts/data/reputation-rules.js, tests/reputation-rules.test.mjs.
**Interfaces:** normalizeReputation(raw) → {version:1,fame,infamy,revision,recentChanges}; applyReputationChange(state,request,{gmId,timestamp}) → nextState.
request={expectedRevision,change,reason,operationId}; change={set:{fame,infamy}} либо {delta:{fame,infamy}}.
MAX_REPUTATION_HISTORY=50; reason trimmed1..240; ID nonempty<=128; strict number/no string coercion.

- [ ] Pure tests:
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
- [ ] Red: node --test tests/reputation-rules.test.mjs.
- [ ] Реализовать exact change union, finite safe integer, result>=0; unchanged values не создают второй delta effect. Reads legacy возвращают detached defaults без write.
- [ ] Replay operationId ищется в recentChanges до revision check; same fingerprint возвращает saved next outcome, altered payload → operation-conflict. Старый ID вне bounded history со stale expectedRevision не принимается.
- [ ] history record хранит ID/fingerprint/gm/timestamp/before/after и revision, slice(-50). Не показывать причине raw HTML.
- [ ] Дополнить tests: maxsafe overflow, delta negative allowed если result>=0, invalid string, both set+delta,61 operations, duplicate/conflicting ID.

## Задача R5.2 — Один GM mutation path

**Create:** scripts/application/reputation-service.js, scripts/infrastructure/foundry/reputation-command-contract.js; tests/reputation-service.test.mjs, tests/reputation-socket.test.mjs.
**Modify:** scripts/main.js.
**Public:** getReputation(actorOrUuid); updateReputation({actorUuid,expectedRevision,change,reason,operationId}).
**Service:** ReputationService({resolveActor,coordinator,mutationGateway,refresh}).read(actorUuid); update(request,context).
**Command:** reputation.update; exact keys, authenticated GM only.

- [ ] Socket test truth table: valid GM true, OWNER-player false, unknown User false; extra ItemData/senderId rejected; actor.type !==character rejected. Ни одна отказанная команда не вызывает actor.update.
- [ ] Gateway direct active GM и inactive GM typed route должны исполнить один и тот же executor. Не вызывать mutate из executor повторно.
- [ ] В actor queue fresh-read flag, применить pure change, один actor.update({["flags.rebreya-main.reputation"]:next}) с authority guards. Mutation включает history/receipt и values атомарно.
- [ ] Exception после actor.update → readback operation receipt; verified success возвращается, unknown → ambiguous-outcome без повторной delta. Тест fake Actor throw-after-write обязателен.
- [ ] Refresh только projection выбранного actorUuid. Два concurrent GMs с revision0: один success, второй stale, значения первого сохраняются.
- [ ] Get возвращает доступную actor projection; public read не открывает hidden чужие Actor только потому, что UUID известен.

## Задача R5.3A — Карточка в Космологии

**Modify:** scripts/ui/cosmology-app.js, templates/cosmology-app.hbs, styles/main.css.
**Create test:** tests/reputation-ui.test.mjs.
**Consumes:** public API выше; selectedActorUuid — local app state.

- [ ] Context test: отсутствие выбранного Actor не выбирает последний controlled token; counters read-only placeholder «Выберите персонажа». Actor selection не меняет сохранённые значения.
- [ ] В _prepareContext добавить actor options и {actorUuid,name,fame,infamy,revision,canEdit}. После последнего DOM section Механуса вставить отдельную section data-reputation-panel.
- [ ] Два числа и edit form set/delta/reason; submit замораживает captured actorUuid/revision до await, чтобы переключение dropdown не применило изменения другому Actor.
- [ ] Cancel не вызывает API; invalid local input не отправляется; stale показывает свежие values и требует нового явного submit.
- [ ] Все строки escaped; events принадлежат lifecycle приложения. Изменение счётчика не вызывает setMechanusEnabled.
- [ ] Тесты assert порядок template Mechanus→reputation, mutation payload exact, rerender без двойного handler.

## Задача R5.3B — Альтернатива под кнопкой панели

Выполнять только при выборе пользователем panel placement; не создаёт второй app.
**Modify:** scripts/hooks.js buildToolsRecord()/панельный DOM render, styles/main.css; tests/bg3-hotbar-compat.test.mjs и reputation-ui.

- [ ] Добавить presentation row после stable control rebreya-main-cosmology, не искать локализованный title. Поддержать record/array controls legacy variants, которые уже покрывает bg3-hotbar-compat.
- [ ] Рендерить два counters с явным выбранным actor label; если формат scene control допускает только кнопки, сделать одну кнопку открытия inline popover с двумя полями сразу под anchor через R1 AnchoredOverlay. Не присваивать HTML строку title.
- [ ] Selector Actor и edit route используют ровно тот же public API; readonly player не получает GM toggles. Не заменять скрытый cosmology control пустым GM видимым placeholder для всех.
- [ ] Проверить tools order после35 и до40 без collision, teardown/rebuild панели, theme/zoom. Тест обоих controls forms гарантирует сохранение existing tools.
- [ ] Из спецификации убрать невыбранную альтернативу после ответа, не оставлять двойное размещение.

## Проверки этапа

```powershell
node --test tests/reputation-rules.test.mjs tests/reputation-service.test.mjs tests/reputation-socket.test.mjs tests/reputation-ui.test.mjs tests/group-command-dispatch.test.mjs tests/main-composition-root.test.mjs tests/bg3-hotbar-compat.test.mjs tests/cosmology-mechanus-rolls.test.mjs
```
Live: selectedActor1/2, concurrent edit, close/cancel, reload, narrow window, GM/player, unchanged Mechanus behavior. Snapshot values доказывают независимые fame/infamy.

**Docs:** паспорт2/16/19, README public API. Commit: feat: add actor fame and infamy counters below Mechanus.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.
