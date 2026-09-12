# Снижение задержки typed sockets и сложных инвентарных мутаций

Дата: 2026-09-12. Статус: спецификация на ревью; runtime-код не изменён.

Исследованная база: `96a779ce`, ветка `lich_branch`, module version `1.4.288`. Модуль рассчитан на Foundry VTT 13 и dnd5e; обязательная зависимость — `statuscounter >= 3.0.4`. Живой GM/player-профиль при подготовке документа не запускался.

## 1. Наблюдаемый результат

Player-команда не должна получать ложное `Socket command timed out after 10000 ms` из-за ожидания несвязанной world-мутации или из-за перерисовки интерфейса активного GM.

После изменения:

- активный GM подтверждает получение typed request отдельно от итогового результата;
- read-команды выполняются без очереди мутаций;
- независимые мутации разных агрегатов могут выполняться одновременно, а пересекающиеся остаются сериализованными;
- socket result отправляется после authoritative domain write, но до любого ожидаемого render;
- успешный простой перенос сохраняет существующий быстрый путь с одной terminal-записью;
- sale, dismantle и сложный ingress используют постоянное число journal writes на всю операцию, а не число, пропорциональное строкам;
- повтор с тем же operation ID не применяет экономический результат второй раз;
- редкий аварийный обрыв между Foundry Document writes может потребовать ручной сверки, но не должен молча создавать второй предмет, материал или валюту.

Цель не состоит в том, чтобы убрать все задержки сети или обещать атомарность нескольких Foundry Documents. Цель — убрать задержки, создаваемые собственной глобальной очередью, journal checkpoint-ами и UI из критического пути socket response.

## 2. Подтверждённая исходная проблема

### 2.1 Одна очередь для всех команд

`SocketCommandBus` использует `DEFAULT_MUTATION_KEY = "world"`; каждый входящий typed request проходит через `WorldMutationCoordinator.runIdempotent("world", operation)`. На текущей базе в `scripts/main.js` зарегистрировано 45 прямых socket-команд и 33 команды `PrivilegedMutationGateway`. Медленная команда блокирует несвязанные домены и read-команды.

Таймер клиента запускается до ожидания этой очереди. Поэтому запрос может исчерпать 10 секунд, даже не начав `validate`, `authorize` и `execute`.

### 2.2 Read-команды ошибочно считаются мутациями

Как минимум следующие active-GM reads сейчас входят в `world` queue:

- `storage.open`;
- `storage.journal.read`;
- `storage.journal.read-record`;
- `storage.triggers.read`;
- `door.triggers.read`.

Им разрешено оставаться active-GM routes, если данные нельзя безопасно читать локально, но им не требуется mutation lock.

### 2.3 Socket result ожидает UI

`runInventoryMutation(operation, { actorIdsFromResult, awaitRefresh = true })` по умолчанию ожидает `refreshInventoryViews()`. Refresh содержит settle-интервал 80 мс и может вызвать полный `InventoryApp.refreshInventorySnapshot()`. Контекст InventoryApp дополнительно собирает group, craft, calendar, travel, transport и downtime projections.

Если socket executor вызывает этот путь с `awaitRefresh=true`, authoritative мутация уже завершена, но GM не отправляет result игроку до окончания render. Ошибка render способна превратить успешную world-мутацию в видимый socket failure.

### 2.4 Чрезмерно подробный durable journal

`DurableMutationJournal` на каждом `start`, `checkpoint` и `finish` читает, нормализует, клонирует и целиком записывает setting журнала. На успешном пути sale и dismantle выполняют примерно пять journal writes плюс Document writes.

Legacy/complex ingress выполняет около `4N + 3` journal writes для `N` строк. Это главный масштабируемый источник задержки. Уже реализованный простой transfer/ingress использует одну terminal-запись; его нельзя возвращать на многофазный путь.

### 2.5 Что не является причиной секундной задержки

Следующие проверки остаются обязательными:

- exact payload validation;
- сопоставление envelope sender с authenticated transport sender;
- поиск текущего Foundry User и проверка ownership;
- выбор `game.users.activeGM` и active-GM guards;
- envelope limit 65 536 байт;
- bounded in-memory idempotency cache.

Локальный microbenchmark на базе аудита дал около 0,105 мс для `JSON.stringify + TextEncoder` на почти предельном payload и около 0,006 мс для `structuredClone`. Реальные inventory payload существенно меньше. Удаление этих проверок не устраняет таймауты.

Foundry предоставляет модулю broadcast namespace `module.<id>` и пересылает произвольные пакеты другим клиентам; сам socket не предоставляет права на world mutation. Поэтому authoritative client продолжает проверять отправителя и полномочия. `game.users.activeGM` остаётся каноническим выбором единственного исполняющего GM.

## 3. Принятый компромисс

Выбран staged-вариант «быстрый транспорт + scoped concurrency + coarse durable recovery».

Рассмотренные варианты:

1. Только увеличить timeout и отвязать refresh. Быстро, но сохраняет head-of-line blocking и `4N + 3` journal writes; отвергнуто.
2. **Выбран:** разделить acknowledgement/result, ввести query/keyed/exclusive scheduling, убрать render из response path и сократить сложный журнал до prepared + terminal на операцию.
3. Удалить authorization, journal и idempotency как ненужный античит. Даёт мало дополнительной скорости и допускает дубли от двойного клика, старого кэша, retry или смены GM; отвергнуто.

Пользователь принимает ослабление crash recovery: после остановки процесса GM или смены GM точно между несколькими Document writes допустима ручная сверка. Нормальная ошибка в живом процессе всё ещё получает компенсацию, а retry не должен молча умножать ценность.

## 4. Границы

### Включено

- Typed protocol `rebreya.command` / `rebreya.command.result` и additive acknowledgement.
- Планирование всех typed commands как `query`, `keyed-mutation` или `exclusive-mutation`.
- Одинаковая scheduling policy для direct active-GM и routed socket execution.
- Отвязка inventory socket result от GM-side и requester-side render.
- Coarse journal для `inventory.sale`, `inventory.dismantle` и сложного ingress, включая container/runtime item graph.
- Структурная телеметрия queue wait, validation, authorization, execution, response и refresh.
- Совместимость со старым request/result envelope в пределах смешанной клиентской сессии.

### Исключено

- Подключение `socketlib` или перенос CPR generic document handlers.
- Удаление sender/ownership/payload/active-GM проверок.
- Возврат произвольного `setSetting` socket route.
- Полная переработка InventoryApp `_prepareContext()` и ленивая загрузка вкладок.
- Переписывание торговых, crafting и прочих domain journals без подтверждённого профиля.
- Гарантия автоматического восстановления любой multi-Document операции после рестарта.
- Изменение пользовательского API инвентаря или добавление переключателя «быстрый/безопасный режим».

## 5. Владельцы и интерфейсы

### 5.1 `WorldMutationCoordinator`

Файл: `scripts/application/world-mutation-coordinator.js`.

Существующие `run(key, operation)` и `runIdempotent(key, requestId, operation)` сохраняются для внутренних repository queues и обратной совместимости.

Добавляется scoped scheduler:

```js
runScoped({ keys, exclusive = false }, operation)
runIdempotentScoped({ keys, exclusive = false, requestId }, operation)
```

Контракт:

- keyed mutation требует непустой массив строковых ключей;
- ключи trim-ятся, дедуплицируются и сортируются лексикографически;
- операции с непересекающимися ключами могут выполняться одновременно;
- операция ждёт все более ранние операции, имеющие хотя бы один общий ключ;
- `exclusive: true` запрещает `keys`, ждёт все ранее принятые keyed/exclusive mutations и блокирует более поздние до завершения;
- rejected operation освобождает все ключи и не отравляет очередь;
- один `requestId` возвращает тот же in-flight или bounded completed result независимо от повторного socket envelope;
- scheduler сохраняет порядок приёма для конфликтующих и exclusive операций и не допускает starvation.

Outer command keys используют prefix `aggregate:`. Внутренние repository keys `setting:` и `durable-mutation-journal` остаются отдельными, поэтому executor не пытается повторно захватить собственный outer key.

### 5.2 Scheduling policy команды

`SocketCommandBus.register()` и `PrivilegedMutationGateway.registerCommand()` получают обязательную для новых регистраций policy:

```js
scheduling: {
  mode: "query"
}

scheduling: {
  mode: "keyed-mutation",
  keys: (payload, context) => [`aggregate:group:${payload.groupId}`]
}

scheduling: {
  mode: "exclusive-mutation"
}
```

`keys` является синхронным pure resolver, принадлежит определению команды и вызывается только после успешной shape-validation. Caller не может передать готовый queue key в payload. Пустой или ошибочный результат resolver отклоняет запрос как `invalid-scheduling-key` до domain write.

Во время миграции существующая мутация без policy получает `exclusive-mutation`, а не выполняется без блокировки. После миграции всех 78 регистраций отсутствие policy становится ошибкой старта модуля. Query никогда не входит в coordinator и не получает idempotency result cache.

`PrivilegedMutationGateway` хранит policy вместе с `validate/authorize/execute` и передаёт ту же immutable policy при регистрации typed adapter в bus. Для routed request outer scheduling выполняет bus; gateway executor получает `alreadyScheduled: true` и не захватывает второй outer lock. Для direct active-GM вызова gateway сам вызывает тот же `runIdempotentScoped()` с тем же resolver и idempotency key `${sender.id}\0${command}\0${operationId}`. Таким образом два маршрута не могут выбрать разные ключи или вложить command во второй outer lock.

### 5.3 Минимальная матрица ключей

| Семейство | Режим | Ключи |
|---|---|---|
| `storage.open`, journal/trigger reads, `door.triggers.read` | query | нет |
| `inventory.*` | keyed | exact source/target `aggregate:actor:<uuid>` и `aggregate:inventory:<groupActorId>` |
| Storage claim/deposit/drop | keyed | `aggregate:storage:<uuid>` плюс exact actor/group targets |
| Trader purchase/sell/audit | keyed | `aggregate:trader:<cityId>:<traderKey>` плюс затронутый actor/group |
| Group calendar/travel/transport/downtime | keyed | `aggregate:group:<groupId>`; exact actor добавляется при отдельной Actor mutation |
| Combat status, grapple, durability, door writes | keyed | exact `aggregate:scene:<sceneId>` и/или `aggregate:document:<uuid>` |
| Одна конкретная world setting mutation | keyed | `aggregate:world-setting:<settingKey>` |
| Reset, migration или операция с заранее неизвестным world-wide footprint | exclusive | нет |

UUID/ID нормализуются существующими command validators. Если текущий payload не содержит данных для безопасного exact key, первая реализация использует консервативный domain key, например `aggregate:inventory`, либо exclusive mode. Нельзя угадывать ресурс через текущее выбранное UI-состояние GM.

### 5.4 `SocketCommandBus`

Файл: `scripts/infrastructure/foundry/socket-command-bus.js`.

Добавляется envelope:

```js
{
  type: "rebreya.command.accepted",
  command,
  requestId,
  forUserId,
  senderId
}
```

`accepted` означает только: elected active GM получил валидный request envelope, связал declared sender с transport sender и нашёл command. Для mutation к этому моменту request уже присоединён к idempotent execution; для query зарегистрирована только pending correlation. Это не означает authorization, commit или успех.

Порядок active-GM обработки:

1. Проверить active GM, envelope size/shape и transport sender.
2. Найти command и текущего Foundry User.
3. Выполнить shape-validation.
4. Для мутации вычислить scheduling policy и keys.
5. Для mutation создать либо найти in-flight execution в scheduler, затем отправить `accepted`; синхронный участок регистрации не содержит `await`, поэтому duplicate envelope не может вклиниться между этими действиями.
6. Query после `accepted` выполнить сразу; mutation продолжить в уже зарегистрированном scheduler execution.
7. Непосредственно перед domain execute заново проверить active-GM guard и выполнить authorization по свежему world-state.
8. Нормализовать outcome и отправить `result`.

Повтор той же mutation во время выполнения повторно получает `accepted`, присоединяется к тому же in-flight Promise и не вызывает `execute` второй раз. Settled mutation retry получает cached outcome. Query не сохраняет completed result и может безопасно выполниться повторно после потерянного ответа, поскольку не изменяет world-state.

Клиентский pending entry хранит ожидаемого active GM. `handleMessage(message, { transportSenderId })` передаёт transport sender и в accepted/result handlers. Accepted/result учитываются только при совпадении `senderId`, transport sender, ожидаемого GM, `requestId`, `command` и `forUserId`. Это закрывает существующую асимметрию: request sender сейчас проверяется, result sender — нет.

### 5.5 Timeout и retry

Остаются два ограниченных этапа:

- acceptance timeout: 10 000 мс от emit до первого `accepted` или `result`;
- completion timeout: 60 000 мс от `accepted` до итогового `result`.

Полученный `result` считается implicit acceptance, чтобы новый клиент работал со старым GM. Старый клиент игнорирует неизвестный additive `accepted` и продолжает принимать прежний `result`.

Если acceptance не получен, gateway может один раз повторить тот же envelope с тем же operation/request ID только при неизменном elected GM. Если accepted уже получен, completion timeout допускает одно такое же reattach-сообщение; новый operation ID не создаётся. Смена elected GM либо отсутствие результата после reattach возвращает `ambiguous-outcome` и требует перечитать authoritative state. Сообщение пользователю различает «GM не подтвердил получение» и «GM принял операцию, итог пока не подтверждён».

Увеличение completion timeout не является критерием исправления: структурные проверки ниже должны доказать, что unrelated queue и render исключены из ожидания.

## 6. Inventory mutation и UI completion

`runInventoryMutation()` остаётся единственным composition boundary для удержания/coalescing inventory refresh, но mutation promise больше не ожидает render по умолчанию.

Контракт:

1. Await authoritative domain operation.
2. Освободить refresh hold и поставить точный scoped refresh через `UiRefreshCoordinator`.
3. Вернуть domain result немедленно.
4. Обработать rejected background refresh отдельным warning; не изменять уже успешный mutation result.

Callers, которым действительно нужен завершённый render, должны передать явный `awaitRefresh: true` и не могут использовать этот режим внутри socket executor. Текущая функция-valued логика для `inventoryTransferMode === "simple"` удаляется после перевода всех inventory socket registrations на единый background contract.

На requester client успешный result также только планирует scoped refresh. Foundry Document hooks и явные refresh requests продолжают coalesce; ни одна сторона не запускает `refreshOpenApps()`.

Socket result должен быть emitted до первого await GM-side refresh. В unit-тесте это проверяется порядком событий, а не измерением wall-clock.

## 7. Coarse durable recovery сложного инвентаря

### 7.1 Общий протокол

Обычный simple transfer/ingress сохраняет существующую одну `recordTerminal()` запись и текущие in-memory compensations.

Для sale, dismantle и complex ingress применяется ровно две успешные записи `inventoryMutationJournal` на всю операцию:

1. `start(preparedRecord)` до первого economic Document write;
2. `finish(operationId, terminalResult)` после завершения всех writes либо одна terminal failure/reconciliation запись после обработанной ошибки.

Между ними нет persistent per-phase и per-row checkpoint. In-memory receipts фиксируют фактически применённые шаги для обратной компенсации при обычном exception в том же процессе.

Prepared record содержит:

- operation ID, kind и stable fingerprint;
- sender attribution и exact source/target UUID;
- свежие source revisions/quantities/value before-state;
- полный нормализованный план economic delta;
- заранее назначенные collision-free target Item IDs для создаваемых roots/children;
- before-state merge targets, currency и folder membership, которые могут потребоваться для проверки или компенсации.

Payload не является источником этих данных: active GM строит prepared plan из свежих Documents после authorization и внутри aggregate locks.

### 7.2 Stable target identity и batch writes

Для создаваемых embedded Items план заранее назначает `_id`. Foundry VTT 13 `createEmbeddedDocuments`/`createDocuments` принимает batch data, а публичный `DatabaseCreateOperation` поддерживает `keepId` и `keepEmbeddedIds`. Перед записью сервис проверяет отсутствие коллизий и remap-ит IDs полного runtime graph.

Создания, updates и deletes группируются по parent Document и выполняются batch API там, где порядок dnd5e/container semantics это допускает. Folder membership сохраняется не чаще одного раза на весь ingress batch. Batch API не используется для нарушения обязательного порядка «создать/зачислить target → списать source».

### 7.3 Retry и аварийный обрыв

Повтор или новый active GM сначала читает prepared record и сверяет exact target IDs, source quantities/revisions и merge before-state:

- если planned target уже существует в ожидаемом состоянии, он не создаётся второй раз;
- если source уже списан в ожидаемом объёме, debit не повторяется;
- если состояние однозначно соответствует следующему недостающему шагу, операция завершается;
- если пользователь или другая операция изменили один из документов так, что вывод неоднозначен, journal получает terminal `reconciliation-required`, а автоматическая выдача/списание прекращается;
- reconciliation result перечисляет затронутые Actor/Item UUID и ожидаемые/наблюдаемые количества без сериализации полного Document.

Автоматическая background-миграция всех старых nonterminal records не входит в задачу. Существующие legacy records продолжают обслуживаться прежним recovery path до исчерпания или отдельной миграции; новые records получают schema/version marker coarse protocol.

### 7.4 Sale

Prepared plan фиксирует source item fingerprint/quantity, currency before-state и точную delta. Успешный путь:

1. одна prepared journal write;
2. credit currency;
3. debit/delete source Item;
4. одна terminal journal write;
5. background refresh.

При обычном source failure сервис возвращает currency к before-state. При write-then-throw проверяется authoritative currency/source state перед компенсацией. Повтор не начисляет currency второй раз.

### 7.5 Dismantle

Prepared plan фиксирует source, целые material outputs, exact create/merge targets и их before-state. Успешный путь:

1. одна prepared journal write;
2. batch credit материалов;
3. debit/delete source Item;
4. одна terminal journal write;
5. background refresh.

Сохраняются правила целых output quantities, durability identity и запрет dismantle установленного host/upgrades. Нормальная ошибка source debit компенсирует только credits этой операции в обратном порядке.

### 7.6 Complex ingress и containers

Весь batch сначала получает один authoritative plan, включая полное дерево контейнеров, remapped IDs, folder destination, merge targets и source debits. Если хотя бы одна принятая строка требует complex/container/dismantle semantics, Item-часть batch остаётся одним complex execution owner.

Успешный batch делает две journal writes независимо от `N`: prepared + terminal. Между ними допускаются batch Document operations и один folder-state write. Запрещены journal writes после каждой строки, target create, folder assignment, source debit или committed marker.

Полное дерево target должно существовать до source debit. Retry проверяет root и children по planned IDs и никогда не преобразует потерянный container graph в root-only grant.

## 8. Ошибки и пользовательское поведение

- `invalid-envelope`, `sender-mismatch`, `unknown-command`, `unknown-sender`, `invalid-payload`, `unauthorized` и `envelope-too-large` остаются отказами до economic write.
- `invalid-scheduling-key` означает ошибку определения команды и логируется как developer error.
- `request-timeout` используется только когда elected GM не подтвердил получение.
- `operation-timeout` преобразуется gateway в `ambiguous-outcome`; UI предлагает обновить данные, а не нажимать операцию с новым ID.
- Ошибка background render показывает warning в консоли/UI, но не сообщает, что уже сохранённая мутация провалилась.
- `reconciliation-required` явно сообщает о возможном частичном результате и exact затронутых документах.
- Неуспешная команда освобождает scheduling keys и не блокирует последующие запросы.

## 9. Диагностика производительности

Socket bus и coordinator получают injectable trace sink. По умолчанию payload, ItemData, actor names и пользовательские тексты не записываются.

Trace одной команды содержит:

- command, requestId, senderId и outcome code;
- execution mode и нормализованные aggregate keys;
- received/accepted/result timestamps;
- `validationMs`, `queueWaitMs`, `authorizationMs`, `executeMs`, `responseBuildMs`;
- inventory `journalWriteCount`, `documentWriteCount` и `refreshScheduledAt`.

Production logging выводит одну structured warning только для slow/failed commands; unit tests используют in-memory sink. Порог warning — 1 000 мс total до result или 250 мс queue wait. Trace не становится world setting и не создаёт ещё один socket packet.

## 10. Совместимость и миграция

- Socket channel `module.rebreya-main`, request/result type и существующие payload/result shapes сохраняются.
- `accepted` является additive type. Result без предшествующего accepted поддерживается.
- Старые journal records не переписываются при загрузке мира.
- Simple terminal records schema и replay сохраняются.
- Существующие public module API и Hook names не меняются.
- Реализация повышает `module.json.version`, создаёт соответствующий thin `scripts/main-<version>.js`, меняет `esmodules` и проверяет отсутствие runtime-ссылок на предыдущую версию.
- Новые/изменённые методы, signatures, data flow, ограничения и focused tests в том же commit отражаются в разделе 2, разделе 7 и разделе 19 `docs/function-passport.md`.
- README обновляется только если реализация меняет наблюдаемый публичный API; внутренний accepted envelope сам по себе README-контрактом не является.

## 11. Проверки и критерии готовности

### 11.1 Coordinator и transport

`tests/world-mutation-infrastructure.test.mjs` подтверждает:

- query завершается, пока unrelated keyed mutation удерживается незавершённым Promise;
- непересекающиеся key sets выполняются одновременно;
- один общий key сериализует операции;
- multi-key acquisition не создаёт deadlock при обратном порядке входных keys;
- exclusive operation ждёт ранние mutations и блокирует поздние;
- rejection освобождает keys;
- duplicate request присоединяется к одному in-flight execute;
- accepted переключает acceptance timer на completion timer;
- result без accepted остаётся совместимым;
- accepted/result с несовпадающим transport sender или не тем active GM игнорируется;
- envelope limit и structured errors не меняются.

### 11.2 Gateway и registrations

`tests/privileged-mutation-gateway.test.mjs`, `tests/group-command-dispatch.test.mjs` и профильные `*-socket.test.mjs` подтверждают:

- direct active-GM и routed player command используют одинаковую policy и keys;
- no-active-GM fail-fast не создаёт pending timer;
- retry всегда повторяет тот же operation ID;
- все command registrations имеют явную policy после завершения миграции;
- пять перечисленных read-команд не вызывают coordinator;
- unknown mutation не может случайно выполниться как query.

### 11.3 Inventory и journal

`tests/durable-mutation-journal.test.mjs`, `tests/inventory-simple-transfer.test.mjs`, `tests/inventory-transfer-imports.test.mjs` и `tests/inventory-mutation-recovery.test.mjs` подтверждают:

- simple transfer сохраняет ровно одну terminal journal write;
- sale и dismantle сохраняют ровно две journal writes на успешную операцию;
- complex ingress из 1 и 20 строк сохраняет ровно две journal writes в обоих случаях;
- target IDs планируются до первого economic write и создаются с сохранением IDs;
- lost create acknowledgement не создаёт дубль;
- crash/retry между target credit и source debit либо безопасно завершает план, либо возвращает `reconciliation-required`;
- обычная runtime-ошибка компенсирует только изменения текущей операции;
- container retry восстанавливает полное дерево и не выдаёт root-only результат;
- terminal retry не меняет валюту, количество и folder membership;
- старый nonterminal record продолжает идти по legacy recovery path.

### 11.4 Refresh

`tests/ui-refresh-coordinator.test.mjs` и `tests/background-refresh-focus.test.mjs` подтверждают:

- result emission предшествует GM-side refresh start/await;
- rejected render не отклоняет successful mutation Promise;
- actor scopes объединяются и refresh выполняется один раз;
- background refresh не открывает и не поднимает окно.

### 11.5 Живой Foundry smoke

На Foundry VTT 13 с одним GM и одним player проверить:

1. Удержать искусственно медленную mutation агрегата A более 10 секунд; read и mutation непересекающегося агрегата B должны получить accepted/result без ожидания A.
2. Две mutation одного Item/Actor должны выполниться последовательно и не дублировать value.
3. Sale, dismantle, обычный ingress и container ingress с 20 строками не показывают прежний 10-секундный timeout; trace подтверждает O(1) journal writes.
4. Закрытое и открытое InventoryApp: время result не зависит от длительности render, окна не крадут focus.
5. Потеря соединения player после accepted и повтор с тем же ID возвращают один outcome.
6. Смена active GM во время операции возвращает success только при подтверждённом terminal state, иначе `ambiguous-outcome`/`reconciliation-required` без повторной выдачи.
7. Проверить консоль обоих клиентов на unhandled rejection и oversized/uncorrelated packets.

Живой smoke является обязательным для заявления, что исходный runtime timeout исправлен. Unit-тесты доказывают структуру, но не измеряют Foundry server/database latency.

### 11.6 Полная проверка

Перед итоговым commit реализации:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Критерий готовности: все focused/full checks проходят; ни один socket executor не ожидает UI render; read-команды не входят в mutation scheduler; successful journal write count равен 1 для simple и 2 для перечисленных complex operations; live GM/player сценарий больше не воспроизводит исходный timeout.

## 12. Рекомендуемый порядок реализации

1. Добавить trace sink и characterization tests текущего timeout/queue/render порядка.
2. Расширить coordinator scoped/exclusive scheduling и покрыть concurrency tests.
3. Добавить accepted protocol, sender validation результата и двухэтапный timeout.
4. Сделать scheduling policy общей для bus/gateway и классифицировать все registrations; сначала reads и inventory pilot, затем остальные семейства.
5. Отвязать inventory result от render.
6. Перевести sale/dismantle на coarse prepared + terminal protocol.
7. Перевести complex ingress/container batch и сохранить legacy recovery старых records.
8. Обновить паспорт, версию/forwarder, выполнить focused/full checks и живой GM/player smoke.

Не объединять journal rewrite с несвязанными UI или domain refactors. После каждого этапа direct active-GM и routed player behavior должны оставаться эквивалентными.

## 13. Источники решений

- Foundry module socket namespace и broadcast semantics: <https://foundryvtt.com/article/module-development/#socket>.
- Foundry VTT 13 `game.users.activeGM`: <https://foundryvtt.com/api/v13/classes/foundry.documents.collections.Users.html#activeGM>.
- Foundry VTT 13 batch embedded Documents: <https://foundryvtt.com/api/v13/classes/foundry.documents.Item.html#createEmbeddedDocuments>.
- Foundry VTT 13 `DatabaseCreateOperation.keepId/keepEmbeddedIds`: <https://foundryvtt.com/api/v13/interfaces/foundry.abstract.types.DatabaseCreateOperation.html>.
- Предыдущий transport foundation: `docs/superpowers/specs/2026-07-10-safe-socket-strangler-design.md`.
- Существующий fast-path compromise: `docs/superpowers/specs/2026-09-05-inventory-transfer-simplification-design.md`.
- Scoped refresh contract: `docs/superpowers/specs/2026-07-13-scoped-ui-refresh-design.md`.
