# Репутация персонажа — R5

Размещение: **инвентарь → Группа**, окончательное уточнение пользователя 2026-09-08. Код Космологии и её шаблон не изменены. Runtime 1.4.251; Actor flag `flags.rebreya-main.reputation`. Механические defaults: два независимых неотрицательных safe integer, GM-only writes, без бонусов/порогов.

## Pure состояние

Владелец `scripts/data/reputation-rules.js`.

- `reputationExactKeys(value,keys)` проверяет plain object и точный набор own keys. `validateReputationRequest(request)` принимает exact `{expectedRevision,change,reason,operationId}`; change — только `{set:{fame,infamy}}` либо `{delta:{fame,infamy}}`. Никакой string coercion, reason trimmed 1–240, operationId trimmed 1–128. Возвращает канонический detached request. Private `integer/text` проверяют границы.
- `ReputationError(code)` — invalid-request/invalid-value/invalid-state/stale-revision/operation-conflict/unauthorized/invalid-actor/ambiguous-outcome с русским объяснением.
- `normalizeReputation(raw)` → `{version:1,fame,infamy,revision,recentChanges}`. Отсутствующие legacy fields получают 0/[] без записи. Некорректные существующие числа/version/history отклоняются вместо перезаписи нулём. Возвращается detached state, history bounded50.
- `reputationFingerprint(request,gmId)` включает authenticated sender, expectedRevision, canonical change и reason. `applyReputationChange(state,request,{gmId,timestamp})` сначала проверяет receipt operationId, затем optimistic revision. Altered fingerprint → conflict; exact replay возвращает сохранённые after counters/revision и ещё доступную историю до этой revision. Новая правка записывает before/after, reason, timestamp, gmId, fingerprint, operationId, revision. No-op set также получает receipt/revision, но не меняет значения; повтор не начисляет delta. ID вне последних50 с прежней revision не применяется.
- Focused: `tests/reputation-rules.test.mjs` — independent counters, negative delta/result, strict inputs, overflow, stale, replay/conflict, 61 операций.

## Единственный mutation owner

Владелец `scripts/application/reputation-service.js`; exact transport — `scripts/infrastructure/foundry/reputation-command-contract.js`.

- `isValidReputationPayload(payload)` проверяет exact `{actorUuid,expectedRevision,change,reason,operationId}` и canonical world `Actor.<16-char-id>`; token Actor UUID не принимается. `authorizeReputationUpdate(payload,{sender,game})` допускает только реальный GM User из текущей users collection, не заявленный senderId/поддельный object.
- `reputationTransportId(payload,gmId)` — SHA-256 actorUuid/operationId/canonical fingerprint. Он стабилен для exact retry; изменённый payload получает иной transport ID и доходит до durable conflict check, даже при наличии gateway replay cache. Это не второй transport.
- `ReputationService({resolveActor,coordinator,mutationGateway,refresh,gameProvider,timestamp})`: composition передаёт existing gateway/coordinator, resolver из game.actors, scoped refresh. `read(actorUuid)` → detached actorUuid/name/canEdit плюс state; character only, GM либо OBSERVER доступ, hidden Actor не раскрывается.
- `requestUpdate(request)` клонирует проверенный payload, получает transport ID, вызывает existing `mutationGateway.mutate("reputation.update",payload,{operationId})`, затем scoped requester refresh.
- `update(request,context)` — только executor registered command, повторно проверяет authenticated GM; `mutationGateway.commit("reputation:"+actorUuid,...)` сериализует fresh Actor read. Pure validation до writes; один `actor.update` одновременно сохраняет оба значения, revision и receipt/history. Direct elected GM и inactive GM используют один executor, nested mutate отсутствует.
- Ошибка update после persistence: повторный resolve/read проверяет тот же receipt/fingerprint; подтверждённый результат возвращается без второй delta. Нет подтверждения → ambiguous-outcome. Authority guards выполняются до read/write и после write/readback. Private `#refresh(actorUuid)` не превращает ошибку UI в отказ уже сохранённой операции.
- Write result — компактный `{version,fame,infamy,revision}`; история хранится на Actor и читается через read. Пятьдесят длинных Unicode причин не переполняют typed result envelope.
- Focused: `tests/reputation-service.test.mjs`, `tests/reputation-socket.test.mjs` — actual gateway/bus mock network direct+inactive GM, player/forged/unknown denial, noncharacter, no GM, authority loss, concurrent revisions, throw-before/after-write, exact replay/conflict, bounded transport response.

## Composition и public API

Владелец `scripts/main.js`.

- `getReputation(actorOrUuid)` разрешает UUID через read service; переданный Actor object используется только для получения UUID, а не для обхода resolver/permissions.
- `updateReputation(request)` делегирует `requestUpdate`; `#registerTypedSocketCommands()` один раз регистрирует exact reputation.update через privileged gateway.
- `registerReputationRefreshHooks()` вызывается из initialize, idempotent registration: updateActor/deleteActor отслеживают нужный Actor; `refreshReputationViews(actorUuid)` обновляет только выбранную карточку открытого inventory, пропускает её во время captured pending submit. Нет setting, ready migration или второго state owner.
- `openInventoryApp()` загружает изменённый InventoryApp с cache query 1.4.251-reputation; прежняя сигнатура и другие страницы сохранены.

## Панель группы

Владелец `scripts/ui/reputation-panel.js`, обычный controller без Application; шаблон `templates/reputation-panel.hbs`.

- `buildReputationUpdateRequest(draft)` парсит только целочисленный decimal текст, передаёт точные captured actorUuid/revision/operationId и set/delta/reason в pure validator.
- `ReputationPanel(moduleApi,{render})` хранит только local selectedActorUuid/draft/retry/pending/error. `prepareContext(memberActors)` фильтрует character/OBSERVER, строит options и read projection. По умолчанию выбора нет; смена группы удаляет недопустимый выбор/draft. Последние пять history записей показываются в UI, полные50 остаются в data.
- `renderContent(memberActors)` рендерит отдельный Handlebars template с автоматически экранированными names/reasons. Только этот trusted rendered HTML вставляется в `inventory-app.hbs`; пользовательские строки напрямую в HTML не вставляются.
- `selectReputationActor(uuid)`, `beginReputationEdit()`, `cancelReputationEdit()`, `submitReputationEdit()` обеспечивают explicit actor selection, GM form, no-op cancel, local validation до API, freeze payload до await, независимость от последующего выбора. Stale закрывает старую форму и показывает свежие значения; следующий edit — явный. Ambiguous retry сохраняет exact payload/ID и блокирует изменение его полей.
- `bind(element)` заменяет listeners через AbortController; `close()` убирает listeners/draft. Только события собственной панели; ни одного cosmology toggle.
- `InventoryApp.constructor` создаёт controller с scoped render callback. `_prepareContext()` берёт member IDs из existing party snapshot и готовит `reputationHtml` только на party tab. `_onRender()` привязывает панель; `_onClose()` очищает controller.
- `InventoryApp.refreshReputationPanel()` перечитывает только доступных Actor по сохранённым member IDs, заменяет только `[data-reputation-panel]`, защищает async render generation/removed DOM и перепривязывает listeners. Не вызывает getInventorySnapshot/getPartySnapshot, full inventory render или economy refresh.
- CSS ограничен `.rebreya-inventory-app .rm-reputation*`. Счётчики/форма поддерживают перенос длинных строк; остальные строки группы не переработаны.
- Focused: `tests/reputation-ui.test.mjs`, `tests/inventory-app-context.test.mjs`; regressions group-command-dispatch/main-composition-root/bg3-hotbar/cosmology-mechanus-rolls/module-manifest.
