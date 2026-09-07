# R10 — общая десятиминутная сцена: окно и список действий

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

**Результат:** мастер открывает участникам окно «У вас есть 10 минут». Каждый выбирает занятие, мастер видит заявки, а состояние переживает reload/смену GM.

**Зависимости:** только существующие authority/repository/UI conventions; helper R1 использовать при наличии компактного anchored индикатора. Читать [спецификацию сцены](../../specs/2026-09-07-module-development/ten-minute-scene.md), паспорт 2/6/19, существующий Scene Controls owner scripts/hooks.js.

**Обязательная граница пользователя:** только окно и список действий. В R10 нет вызовов shortRest/rollHitDie, восстановления uses/HP/HD, календаря, countdown и неработающих кнопок таких действий.

## Задача R10.1 — состояние сессии и чистые переходы

**Файлы:** новые scripts/data/scene-activity-rules.js, tests/scene-activity-rules.test.mjs.

- [ ] Ввести normalizeSceneActivityState(raw), startSceneActivity(state,intent,context), chooseSceneActivity(state,intent,context), finishSceneActivity(state,intent,context), projectSceneActivityForUser(state,context). Все чистые: не читают game/Date.now/DOM и не пишут settings.
- [ ] Envelope hidden world setting: {version:1,activeByGroup,groupRevisions,history,recentOperations}. activeByGroup хранит максимум одну open session на группу; history последних64 завершённых sessions, recentOperations последних256 receipts. groupRevisions сохраняется при удалении истории и не даёт старому start оживить закрытую сцену.
- [ ] Session: {sessionId,revision,status,groupActorId,initiatingActorUuid,participantActorUuids,durationMinutes,openedAt,selectionByActor}. Status open/completed/cancelled. durationMinutes=10 в R10; openedAt — injected server timestamp для истории, не начало countdown.
- [ ] start intent: {operationId,groupActorId,expectedGroupRevision,initiatingActorUuid,participantActorUuids,durationMinutes}. GM-only. Session ID выдаёт authority один раз; group revision увеличивается при start/terminal transition. expectedGroupRevision — дополнительная защита от старого start после вытеснения receipt.
- [ ] choose intent: {operationId,sessionId,actorUuid,actionId,text,expectedRevision}. actionId inspect/help/prepare/rest/custom; text bounded0..500, custom требует непустой trimmed текст. Plain text, без HTML. Остальные действия допускают пояснение.
- [ ] finish intent: {operationId,sessionId,expectedRevision,status}, status только completed/cancelled. GM-only. Каждая новая selection увеличивает session revision; retry своего operationId возвращает старый outcome до проверки новой revision.
- [ ] context: {senderId,isGM,ownedActorUuids,groupMemberActorUuids,now,createSessionId}. UUID arrays построены authority из живых документов; не приходят от клиента.
- [ ] Сначала тесты transitions. Конкретный self-contained start/choose case:

```js
let state = normalizeSceneActivityState(null);
const context = {
  senderId: "gm", isGM: true, ownedActorUuids: [],
  groupMemberActorUuids: ["Actor.busy", "Actor.player"],
  now: 1000, createSessionId: () => "scene-1"
};
const opened = startSceneActivity(state, {
  operationId: "start-1", groupActorId: "party", expectedGroupRevision: 0,
  initiatingActorUuid: "Actor.busy",
  participantActorUuids: ["Actor.player"], durationMinutes: 10
}, context);
state = opened.state;
const choice = chooseSceneActivity(state, {
  operationId: "choose-1", sessionId: "scene-1", actorUuid: "Actor.player",
  actionId: "rest", text: "", expectedRevision: 1
}, { ...context, senderId: "player", isGM: false,
  ownedActorUuids: ["Actor.player"] });
assert.equal(choice.state.activeByGroup.party.selectionByActor["Actor.player"].actionId, "rest");
assert.equal(choice.state.activeByGroup.party.revision, 2);
assert.equal(choice.result.changed, true);
```

Каждый reducer возвращает {state,result}; result содержит sessionId/revision/changed/replayed. Replay возвращает changed=false/replayed=true и не переписывает state.

- [ ] Проверить duplicate participants, инициатора вне группы, включение инициатора вторым участником, чужой Actor, закрытую session, unknown action, stale revision, invalid/oversize text, две группы и duplicate operation с другим fingerprint.
- [ ] groupRevisions не удалять с history. После eviction receipt старый start с прежней revision отклоняется, не создаёт новую session. Не держать бесконечную историю.
- [ ] Выбор «Отдохнуть» — только selection. Unit tests не импортируют rest adapters; reducers возвращают изменения только sceneActivity state.

## Задача R10.2 — repository, команды и восстановление подключения

**Файлы:** новые scripts/application/scene-activity-service.js, scripts/infrastructure/foundry/scene-activity-command-contract.js, tests/scene-activity-service.test.mjs, tests/scene-activity-socket.test.mjs; изменить scripts/main.js и каноническое место регистрации settings через rg.

- [ ] SceneActivityService({repository,resolveContext,refresh}) с start(intent,sender), choose(intent,sender), finish(intent,sender), cancel(intent,sender), getSnapshot({groupActorId,viewer}). Repository — WorldSettingMutationRepository для sceneActivityState, не второй settings store.
- [ ] Public API: openSceneActivityApp({groupActorId,sessionId?}), startSceneActivity(payload), chooseSceneActivity(payload), finishSceneActivity(payload), cancelSceneActivity(payload), getSceneActivitySnapshot({groupActorId}). Названия reducers/service/API различаются своим владельцем, UI получает только публичный API.
- [ ] Typed scene-activity.start/choose/finish/cancel: exact payload из R10.1. Для finish/cancel status определяется command route, не отдельным доверенным player полем. Metadata sender берётся из gateway, не payload.
- [ ] Новый state/config default регистрируется в существующем registerSettings пути. UI не вызывает game.settings.set. Не вкладывать внешнюю world queue внутрь executor ещё раз; одна короткая repository mutation заново читает state/права и применяет reducer.
- [ ] Auth: start/finish/cancel GM; choose GM либо OWNER именно своего invited Actor. UUID канонизировать существующим group member resolver; знание session ID не разрешает выбор за другого. Ушедший из группы участник больше не мутирует session.
- [ ] В одной записи сохранять transition + receipt. При write error делать readback по operationId; подтверждённая запись возвращает результат, неизвестная — исходную ошибку без автоматического повторного start.
- [ ] No GM — объяснимая ошибка до write; смена active GM проверяется guard перед каждой mutation. Two-GM race в одной группе не создаёт две open sessions.
- [ ] Broadcast содержит invalidation session/group/revision, без произвольного вызываемого кода. Клиент перечитывает snapshot; повтор/перестановка notifications не применяет старую revision поверх новой.
- [ ] Ready/reconnect получает только доступные open sessions. Completed/cancelled не открываются повторно. Смена Foundry Scene не отменяет session, не вызывает activate/view другой карты.
- [ ] Snapshot — публичные намерения, имена допустимых участников и read-only choices. Hidden setting не считать хранилищем секретов: не сохранять в нём скрытые Item/умения/GM notes. View projection для GM включает всех, для игрока — доступный контекст и собственные controls.
- [ ] Service tests используют repository stub с сохранением state между новым экземпляром service. Verify one write per transition, duplicate/noop zero writes, readback-after-error, unauthorized zero writes, два быстрых выбора разных Actor с stale/retry.
- [ ] Отдельный integration spy запрещает actor.update, updateEmbeddedDocuments, shortRest, rollHitDie и любые world-time/calendar adapters: все счётчики вызовов равны нулю при start/choose/finish/cancel/reconnect.

**Проверка:** node --test tests/scene-activity-rules.test.mjs tests/scene-activity-service.test.mjs tests/scene-activity-socket.test.mjs tests/world-setting-mutation-repository.test.mjs tests/group-command-dispatch.test.mjs tests/ui-refresh-coordinator.test.mjs.

## Задача R10.3 — полноэкранное окно и выбор действий

**Файлы:** новые scripts/ui/scene-activity-app.js, templates/scene-activity-app.hbs, tests/scene-activity-app.test.mjs; изменить styles/main.css и scripts/main.js для единственного app registry.

- [ ] Один ApplicationV2/session; registry Map<sessionId,app> принадлежит composition. Reopen возвращает существующую instance; closed stale instance не удаляет replacement registry entry.
- [ ] GM setup выбирает группу, занятого персонажа и остальных участников; «Открыть сцену» сохраняет именно этот контекст до await. Повтор клик использует один operationId и disable на время запроса.
- [ ] Заголовок «У вас есть 10 минут». Подзаголовок «Пока [персонаж] занят, выберите, чем займётся ваш герой». Карточки: «Осмотреться», «Помочь», «Подготовиться», «Отдохнуть», «Своё действие».
- [ ] Полноэкранность — CSS внутри viewport Foundry, 100dvw/100dvh с учётом реальных UI bounds, scroll для длинного содержимого. Не использовать browser requestFullscreen и не менять active Foundry Scene.
- [ ] «Вернуться к карте» сворачивает только локальное окно, сохраняет выбор и session. Компактный индикатор возвращает ту же app. GM finish/cancel — отдельные actions, закрытие X не завершает сцену.
- [ ] Если инициатор также владеет другим приглашённым Actor, UI выбирает явный Actor context. Сам занятый Actor видит своё основное действие и не получает автоматическое второе.
- [ ] Игрок может менять свою заявку до завершения. На stale state сохранить ввод локально, перечитать snapshot и показать конфликт; не перезаписывать выбор без свежего подтверждённого действия.
- [ ] GM видит участников/их выбранные занятия и «ещё не выбрано». Никаких кнопок «восстановить», «бросить HD», пустых cooldown badges и счетчика реальных секунд.
- [ ] Экранирование HBS/textContent для имён и free text; keyboard focus, aria-label, responsive layout и cleanup AbortController/observers. При update другой участник не отбирает focus у пишущего.
- [ ] Tests: один overlay на повтор notifications, collapsed/reopen, out-of-order revision, finish while typing, replacement close, escape text, long list и отсутствие resource controls.

## Задача R10.4 — кнопка мастера, приёмка и документация

**Файлы:** scripts/hooks.js, tests/bg3-hotbar-compat.test.mjs, tests/main-composition-root.test.mjs и README/паспорт 2/6/19.

- [ ] В существующем buildToolsRecord()/registerSceneControlsHook добавить GM-only «Открыть сцену», использующую openSceneActivityApp. Сохранить array/record compatibility scene tools, не второй hook на те же controls.
- [ ] Player индикатор открытой scene показывать через существующую UI integration точку и app registry; права из snapshot, не скрытая CSS-кнопка GM.
- [ ] Live GM+два игрока: разные группы, два выбора одновременно, своё действие с длинным текстом, reopen, offline/reconnect, смена GM и карты, повтор start/finish/cancel.
- [ ] Viewports1280×720/1920×1080, масштаб браузера и keyboard. Ноль новых console errors, HP/HD/uses/calendar до/после идентичны.
- [ ] Документировать public APIs, state ownership, revision/receipt, минимизацию и то, что десять минут — игровая заявка без продвижения времени.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [ ] Обновить профильные методы паспорта и README при изменении public contract.
- [ ] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [ ] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

**Предлагаемые commits:** feat: persist shared scene activity selections; feat: show the ten-minute activity window.
