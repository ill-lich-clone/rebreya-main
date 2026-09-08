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

- [x] Ввести normalizeSceneActivityState(raw), startSceneActivity(state,intent,context), chooseSceneActivity(state,intent,context), finishSceneActivity(state,intent,context), projectSceneActivityForUser(state,context). Все чистые: не читают game/Date.now/DOM и не пишут settings.
- [x] Envelope hidden world setting: {version:1,activeByGroup,groupRevisions,history,recentOperations}. activeByGroup хранит максимум одну open session на группу; history последних64 завершённых sessions, recentOperations последних256 receipts. groupRevisions сохраняется при удалении истории и не даёт старому start оживить закрытую сцену.
- [x] Session: {sessionId,revision,status,groupActorId,initiatingActorUuid,participantActorUuids,durationMinutes,openedAt,selectionByActor}. Status open/completed/cancelled. durationMinutes=10 в R10; openedAt — injected server timestamp для истории, не начало countdown.
- [x] start intent: {operationId,groupActorId,expectedGroupRevision,initiatingActorUuid,participantActorUuids,durationMinutes}. GM-only. Session ID выдаёт authority один раз; group revision увеличивается при start/terminal transition. expectedGroupRevision — дополнительная защита от старого start после вытеснения receipt.
- [x] choose intent: {operationId,sessionId,actorUuid,actionId,text,expectedRevision}. actionId inspect/help/prepare/rest/custom; text bounded0..500, custom требует непустой trimmed текст. Plain text, без HTML. Остальные действия допускают пояснение.
- [x] finish intent: {operationId,sessionId,expectedRevision,status}, status только completed/cancelled. GM-only. Каждая новая selection увеличивает session revision; retry своего operationId возвращает старый outcome до проверки новой revision.
- [x] context: {senderId,isGM,ownedActorUuids,groupMemberActorUuids,now,createSessionId}. UUID arrays построены authority из живых документов; не приходят от клиента.
- [x] Сначала тесты transitions. Конкретный self-contained start/choose case:

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

- [x] Проверить duplicate participants, инициатора вне группы, включение инициатора вторым участником, чужой Actor, закрытую session, unknown action, stale revision, invalid/oversize text, две группы и duplicate operation с другим fingerprint.
- [x] groupRevisions не удалять с history. После eviction receipt старый start с прежней revision отклоняется, не создаёт новую session. Не держать бесконечную историю.
- [x] Выбор «Отдохнуть» — только selection. Unit tests не импортируют rest adapters; reducers возвращают изменения только sceneActivity state.

## Задача R10.2 — repository, команды и восстановление подключения

**Файлы:** новые scripts/application/scene-activity-service.js, scripts/infrastructure/foundry/scene-activity-command-contract.js, tests/scene-activity-service.test.mjs, tests/scene-activity-socket.test.mjs; изменить scripts/main.js и каноническое место регистрации settings через rg.

- [x] SceneActivityService({repository,resolveContext,refresh}) с start(intent,sender), choose(intent,sender), finish(intent,sender), cancel(intent,sender), getSnapshot({groupActorId,viewer}). Repository — WorldSettingMutationRepository для sceneActivityState, не второй settings store.
- [x] Public API: openSceneActivityApp({groupActorId,sessionId?}), startSceneActivity(payload), chooseSceneActivity(payload), finishSceneActivity(payload), cancelSceneActivity(payload), getSceneActivitySnapshot({groupActorId}). Названия reducers/service/API различаются своим владельцем, UI получает только публичный API.
- [x] Typed scene-activity.start/choose/finish/cancel: exact payload из R10.1. Для finish/cancel status определяется command route, не отдельным доверенным player полем. Metadata sender берётся из gateway, не payload.
- [x] Новый state/config default регистрируется в существующем registerSettings пути. UI не вызывает game.settings.set. Не вкладывать внешнюю world queue внутрь executor ещё раз; одна короткая repository mutation заново читает state/права и применяет reducer.
- [x] Auth: start/finish/cancel GM; choose GM либо OWNER именно своего invited Actor. UUID канонизировать существующим group member resolver; знание session ID не разрешает выбор за другого. Ушедший из группы участник больше не мутирует session.
- [x] В одной записи сохранять transition + receipt. При write error делать readback по operationId; подтверждённая запись возвращает результат, неизвестная — исходную ошибку без автоматического повторного start.
- [x] No GM — объяснимая ошибка до write; смена active GM проверяется guard перед каждой mutation. Two-GM race в одной группе не создаёт две open sessions.
- [x] Broadcast содержит invalidation session/group/revision, без произвольного вызываемого кода. Клиент перечитывает snapshot; повтор/перестановка notifications не применяет старую revision поверх новой.
- [x] Ready/reconnect получает только доступные open sessions. Completed/cancelled не открываются повторно. Смена Foundry Scene не отменяет session, не вызывает activate/view другой карты.
- [x] Snapshot — публичные намерения, имена допустимых участников и read-only choices. Hidden setting не считать хранилищем секретов: не сохранять в нём скрытые Item/умения/GM notes. View projection для GM включает всех, для игрока — доступный контекст и собственные controls.
- [x] Service tests используют repository stub с сохранением state между новым экземпляром service. Verify one write per transition, duplicate/noop zero writes, readback-after-error, unauthorized zero writes, два быстрых выбора разных Actor с stale/retry.
- [x] Отдельный integration spy запрещает actor.update, updateEmbeddedDocuments, shortRest, rollHitDie и любые world-time/calendar adapters: все счётчики вызовов равны нулю при start/choose/finish/cancel/reconnect.

**Проверка:** node --test tests/scene-activity-rules.test.mjs tests/scene-activity-service.test.mjs tests/scene-activity-socket.test.mjs tests/world-setting-mutation-repository.test.mjs tests/group-command-dispatch.test.mjs tests/ui-refresh-coordinator.test.mjs.

## Задача R10.3 — полноэкранное окно и выбор действий

**Файлы:** новые scripts/ui/scene-activity-app.js, templates/scene-activity-app.hbs, tests/scene-activity-app.test.mjs; изменить styles/main.css и scripts/main.js для единственного app registry.

- [x] Один ApplicationV2/session; registry Map<sessionId,app> принадлежит composition. Reopen возвращает существующую instance; closed stale instance не удаляет replacement registry entry.
- [x] GM setup выбирает группу, занятого персонажа и остальных участников; «Открыть сцену» сохраняет именно этот контекст до await. Повтор клик использует один operationId и disable на время запроса.
- [x] Заголовок «У вас есть 10 минут». Подзаголовок «Пока [персонаж] занят, выберите, чем займётся ваш герой». Карточки: «Осмотреться», «Помочь», «Подготовиться», «Отдохнуть», «Своё действие».
- [x] Полноэкранность — CSS внутри viewport Foundry, 100dvw/100dvh с учётом реальных UI bounds, scroll для длинного содержимого. Не использовать browser requestFullscreen и не менять active Foundry Scene.
- [x] «Вернуться к карте» сворачивает только локальное окно, сохраняет выбор и session. Компактный индикатор возвращает ту же app. GM finish/cancel — отдельные actions, закрытие X не завершает сцену.
- [x] Если инициатор также владеет другим приглашённым Actor, UI выбирает явный Actor context. Сам занятый Actor видит своё основное действие и не получает автоматическое второе.
- [x] Игрок может менять свою заявку до завершения. На stale state сохранить ввод локально, перечитать snapshot и показать конфликт; не перезаписывать выбор без свежего подтверждённого действия.
- [x] GM видит участников/их выбранные занятия и «ещё не выбрано». Никаких кнопок «восстановить», «бросить HD», пустых cooldown badges и счетчика реальных секунд.
- [x] Экранирование HBS/textContent для имён и free text; keyboard focus, aria-label, responsive layout и cleanup AbortController/observers. При update другой участник не отбирает focus у пишущего.
- [x] Tests: один overlay на повтор notifications, collapsed/reopen, out-of-order revision, finish while typing, replacement close, escape text, long list и отсутствие resource controls.

## Задача R10.4 — кнопка мастера, приёмка и документация

**Файлы:** scripts/hooks.js, tests/bg3-hotbar-compat.test.mjs, tests/main-composition-root.test.mjs и README/паспорт 2/6/19.

- [x] В существующем buildToolsRecord()/registerSceneControlsHook добавить GM-only «Открыть сцену», использующую openSceneActivityApp. Сохранить array/record compatibility scene tools, не второй hook на те же controls.
- [x] Player индикатор открытой scene показывать через существующую UI integration точку и app registry; права из snapshot, не скрытая CSS-кнопка GM.
- [ ] Live GM+два игрока: разные группы, два выбора одновременно, своё действие с длинным текстом, reopen, offline/reconnect, смена GM и карты, повтор start/finish/cancel.
- [ ] Viewports1280×720/1920×1080, масштаб браузера и keyboard. Ноль новых console errors, HP/HD/uses/calendar до/после идентичны.
- [x] Документировать public APIs, state ownership, revision/receipt, минимизацию и то, что десять минут — игровая заявка без продвижения времени.

## Выпуск этапа

- [x] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [ ] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

**Предлагаемые commits:** feat: persist shared scene activity selections; feat: show the ten-minute activity window.


## R10.1–R10.2 — правила и backend (1.4.271)

Добавлены pure state/reducers/projection, bounded history64/receipts256, group revisions, actor ownership и exact retries. SceneActivityService использует единственный WorldSettingMutationRepository с одной записью transition+receipt и точным readback при lost acknowledgement. Existing gateway зарегистрировал start/choose/finish/cancel; public API и hidden setting подключены. Default duration10, actions inspect/help/prepare/rest/custom, text<=500, до64 приглашённых Actor; user resource/time boundary сохранён.

Focused159/0: scene-activity rules/service/socket, world-setting-mutation-repository, actual group-command-dispatch, ui-refresh-coordinator, module-manifest/main-composition-root. Native testovyj3/CODEX13.351/dnd5e5.2.5: модуль загружен, hidden setting config=false и v1 default, API без writes прочёл4 managed группы (5/4/5/3 персонажа). Новые сессии в мире не создавались, действующий GM route ещё не проверен. Полноэкранное окно, launcher, ready/invalidation/reconnect controller и live multiuser matrix остаются R10.3–R10.4; соответствующие чекбоксы не закрыты.

Полный прогон1.4.271: `node --test tests/*.test.mjs` — **3978 passed / 0 failed**; `node --check`792 JS/MJS, JSON parse46 —0ошибок. `git diff --check` чисто. Backend готов к подключению UI; live multiuser/полноэкранность не объявлены завершёнными.

## R10.3–R10.4 — окно и локальный lifecycle (1.4.272)

Добавлены один ApplicationV2/session, GM setup/launcher, выбор пяти занятий, текст до500 символов, roster, локальное сворачивание/возврат, ready/settings/reconnect invalidation. Контроллер отбрасывает старые snapshots и последовательно применяет асинхронные render/close: terminal во время закрытия setup не оживляет старую сцену. Черновик и original request сохраняются при transport error; stale требует нового явного submit. Изменение чужой заявки не заменяет DOM ввода. Действия не расходуют ресурсы и не продвигают время.

Native UI в testovyj3, Foundry13.351/dnd5e5.2.5, CODEX GM: настоящая setup-форма прочла группу «Покатушки» и4 персонажей. Для активного окна использована локальная тестовая проекция с настоящими ApplicationV2/controller и pure reducers, без записи world setting и без подмены active GM. Подтверждены500 символов, literal HTML-подобный текст/имя без HTML-узлов, peer revision2 с сохранением фокуса/курсора120, сохранение через кнопку до revision3, collapse/reopen той же instance и terminal cleanup (registry/overlay/indicator0). World setting до/после идентичен.

1280×720: кнопка сохранения bottom695, текст доступен со scroll; Foundry сам предупреждает о минимуме1024×768. 1920×1080: один DOM overlay ровно во viewport, horizontal overflow отсутствует, кнопка bottom1055. Снимок большого emulated viewport дал артефакт capture и повторный CDP screenshot timeout; полноценная визуальная приёмка этого размера, browser scale и keyboard остаётся открытой. Raw CDP keyboard не поддерживается этим браузерным инструментом; этот шаг не засчитан. Эмуляция размера сброшена, временная проекция закрыта.

Это не проверка native GM/player persistence, двух клиентов, reconnect/GM-switch или всей live матрицы: соответствующие пункты остаются открыты. Пользователю отправлен запрос обновить действующую GM-сессию для новых commands.
После обновления Gamemaster пройден настоящий typed socket маршрут CODEX→active Gamemaster: registerPartyGroup, start/exact retry, два choose с одной revision (один конфликт и явный fresh submit), finish/exact retry, новая scene и cancel/exact retry. В persisted state ровно2 terminal sessions (completed revision4, cancelled revision2),6 receipts и0 active sessions; повторные requests не добавили переходов. Открытая session revision3 с2 choices восстановлена после browser reload автоматически одной app после завершения initialize. Native bootstrap выявил необходимость поддержать вызов внутри ready hook до game.ready; добавлен duringReady:true и focused regression. Начальная загрузка существующего initialize занимает десятки секунд; до её завершения окно ещё не открывается.

До/после start/choose/finish/cancel сравнивались полные toObject трёх QA Actor, worldTime и прежние group states: изменений нет. Это два GM-клиента, не player-auth/multi-player доказательство. QA группа tmEFi3kHho74M01o «[QA R10] Проверка сцены» и Actor egcIVdTZYNPfJG66/rVsa8f6b6DW6HAo7/iW51E48x6SHpra4S оставлены с default ownership0 для следующих изолированных проверок; текущая активная игровая группа не менялась. В дальнейшем удалить только эти QA документы/registry entry после оставшейся multiuser матрицы; не откатывать целиком world settings.

Проверки финального кода272: `node --test tests/*.test.mjs` — **3990 passed / 0 failed**. `node --check`796 JS/MJS —0 ошибок; JSON parse46 —0 ошибок; `git diff --check` чисто. Focused профиль до последнего ready regression192/0, после него изменённые owners group-command-dispatch/main-composition-root65/0 и полный прогон3990/0. Предыдущий полный3990 не повторять без новых code changes. Live player/reconnect/GM-switch, keyboard/scale/long-list и общая приёмка остаются открытыми.

## R10 — клавиатура и длинная группа (1.4.275)

В native Foundry13.351/dnd5e5.2.5 под CODEX воспроизведён конфликт: глобальный Foundry keybinding отменял Tab на кнопках сцены. _onRender теперь останавливает всплытие Tab и замыкает границы окна; внутри сохраняется нативный порядок. Roster получил tabindex и focus-visible. Новый regression сначала упал, после исправления app/controller **11 passed / 0 failed**.

Проверена локальная проекция настоящего ApplicationV2 с64 участниками и длинными именами/заявками: Tab/Shift+Tab на кнопках и границе, Enter для сохранения через локальный stub, сворачивания и возврата, End до конца roster (scrollTop=max10173). Draft сохранён, после возврата один видимый overlay. Это UI-проверка, не доказательство native player authority или сохранения заявки через GM socket.

Нативные снимки через browser viewport capability1280×720 и1920×1080 без прежнего CDP capture artifact: footer bottom695/1055, горизонтального overflow нет. В console один core error о минимальной высоте Foundry768 при тесте720; новых ошибок модуля нет. Browser zoom клавишей Control+= не изменился (DPR1/scale1), поэтому проверка реального масштаба остаётся открытой. Временная app и CSS удалены, overlay/indicator0, world sceneActivityState до/после идентичен, viewport override сброшен. После предыдущего terminal reload также подтверждены controller ready, registry/overlay/active session0. Остальная multiuser/GM-switch матрица остаётся открытой.
`node --test tests/*.test.mjs`: **4005 passed / 0 failed**; синтаксис796 JS/MJS и JSON46 —0 ошибок; `git diff --check` чисто.
