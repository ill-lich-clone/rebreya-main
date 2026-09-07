# Десятиминутная сцена: окно и список действий

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Пользователь уточнил: «Пока только окно и список действий». Текущий этап R10. R11 отложен.

## Сценарий

GM выбирает группу, персонажа с длительным действием и участников, нажимает «Открыть сцену». Остальные выбранные участники получают overlay на весь viewport Foundry:
«У вас есть 10 минут»
«Пока [персонаж] занят, выберите, чем займётся ваш герой.»

Список: «Осмотреться», «Помочь», «Подготовиться», «Отдохнуть», «Своё действие». Это заявка/описание; GM видит выборы, игрок меняет свой выбор, пока session открыт.

Текущая версия не выполняет проверки, восстановление, HD rolls, бонусы, расход умений или short rest. «Отдохнуть» — текстовая заявка. Умения КО и HD не показывать как неработающие активные кнопки.

Окно сворачивается «Вернуться к карте» и возвращается через компактный индикатор. Не применять browser requestFullscreen и не менять active Foundry Scene. Занятый персонаж видит своё основное действие, не получает второе автоматически.

## Время и завершение

По умолчанию 10 игровых минут, только текст. R10 не включает countdown и продвижение календаря. GM нажимает «Завершить»/«Отменить»; время остаётся в существующем ручном процессе.
Повтор finish/cancel не создаёт окно/ресурсы. Закрытая session не всплывает после reconnect; смена карты не теряет открытую session.

## Архитектура

Проектируемые файлы:

- scripts/application/scene-activity-service.js — start/selection/finish;

- scripts/data/scene-activity-rules.js — pure validation/projection;

- scripts/ui/scene-activity-app.js и templates/scene-activity-app.hbs — одна ApplicationV2/session;

- scripts/infrastructure/foundry/scene-activity-command-contract.js — exact commands.
Composition использует existing gateway/coordinator, без raw socket bypass.

Hidden world setting sceneActivityState v1 через WorldSettingMutationRepository хранит envelope {version:1,activeByGroup,groupRevisions,history,recentOperations}. Session: {sessionId,revision,status,groupActorId,initiatingActorUuid,participantActorUuids,durationMinutes,openedAt,selectionByActor}.
status: open/completed/cancelled. История последних 64 sessions и 256 operation receipts; groupRevisions сохраняется для защиты от старого start после вытеснения receipt. Здесь только общие намерения, не секреты и скрытые Item details. Точные переходы — в [плане R10](../../plans/2026-09-07-module-development/r10-scene-window.md).

Одна active session на группу. Actor IDs проверяются по группе; текст bounded/escaped. Неприглашённый не выполняет choose/finish даже зная session ID.

Команды:

- scene-activity.start: GM-only; groupActorId, expectedGroupRevision, initiatingActorUuid, participantActorUuids, durationMinutes, operationId;

- scene-activity.choose: sessionId, actorUuid, actionId/text, expectedRevision, operationId; OWNER своего participant Actor или GM;

- scene-activity.finish/cancel: GM-only; sessionId, expectedRevision, operationId.
Sender authenticated. Stable operation ID/fingerprint, fresh revision, короткая queued mutation.

Не держать world lock во время выбора людей. Broadcast лишь сообщает перечитать snapshot; UI применяет новую revision к одному окну. Reconnect получает current open state; смена active GM продолжает persisted session.

## Проверки

Новые tests/scene-activity-service.test.mjs, scene-activity-socket.test.mjs, scene-activity-app.test.mjs; existing world-setting-mutation-repository, group-command-dispatch, ui-refresh-coordinator по изменённым routes.
GM start; два игрока выбирают/меняют; чужой Actor отказ; две группы; two-GM race; двойной start/finish; no GM; reconnect; old revision; escaped text; свернуть/reopen/сменить карту. Во всех сценариях R10 ноль HP/uses/HD/calendar writes.

Live GM+два player: один overlay/participant; видимые GM статусы; mouse/keyboard; 1280×720/1920×1080; длинный текст; отсутствие новых console errors.
Готовность — окно, список и сохранение выборов. Автоматический отдых не входит.

## R11: отложенное расширение

Восстановление умений КО и кости хитов не реализовывать без нового запроса и отдельной спецификации. Тогда решить full shortRest против selected recovery, authority/receipt и idempotency.
Подробный [условный план R11](../../plans/2026-09-07-module-development/r11-rest-extension-deferred.md) описывает оба режима, native adapters, recovery и проверки, сохраняя это ограничение.
Проверенные будущие точки: actor.shortRest(config), actor.rollHitDie(config,dialog,message) dnd5e 5.2.5. Первый восстанавливает больше выбранного списка, второй уже меняет ресурс/HP. LongRestPipelineService не запускать для КО. Наличие этих API не разрешает подключать их в R10.
