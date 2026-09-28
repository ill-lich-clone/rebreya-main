# Упрощение обычных переносов инвентаря

Дата: 2026-09-05. Статус: спецификация для рассмотрения и последующей реализации; runtime-код не изменён.

Исследованная база: `1994e3e939898eef7ae4bf5849776dc05190c450`, ветка `lich_branch`, module version `1.4.224`. Перед реализацией сверить текущий HEAD и затронутые методы: репозиторий общий. Foundry VTT 13, dnd5e, обязательный statuscounter >= 3.0.4. Проверки времени в живом мире при подготовке документа не проводились.

## 1. Результат и выбранный компромисс

Обычный перенос работает по схеме: прочитать актуальный источник → добавить получателю → списать источник → один раз сохранить итог → запросить scoped refresh. Для части стопки списание означает уменьшение количества, для целого предмета — удаление. UUID служит для разрешения исходного документа; получателю создаётся новый embedded Item из данных источника с новым UUID.

На успешном пути нет persistent фаз prepared/target-created/source-debited/committed для каждой строки. Промежуточные данные для отката существуют только в памяти активного GM. Итог сохраняется одной записью на операцию, в том числе на пакет.

Сохраняются проверки актуального количества, источника, полномочий отправителя, назначения группы, правила папок/merge и защита от повторного запроса. Ослабляется именно восстановление после завершения процесса GM или смены GM между записями. После такого обрыва возможна ручная сверка предметов. Не обещать атомарность нескольких Foundry Documents, ровно однократное выполнение после любого рестарта либо мгновенное сохранение world setting.

Рассмотренные варианты:

1. Только объединить несколько persistent checkpoints: сохраняет больше recovery, но оставляет значительную цену на строку пакета.
2. **Выбран: промежуточное состояние в памяти + один terminal outcome**, с локальным откатом при обычной ошибке. Соответствует запрошенному упрощению.
3. Полностью убрать журнал, очереди и idempotency: отвергнут; повтор запроса и одновременные клики могут дублировать предметы даже без перезапуска.

## 2. Границы

### Включено

- Обычный Item из группы персонажу через `takeInventoryItemToCharacter` и `inventory.take`.
- Уже принятый нативным dnd5e drag предмет из группы: существующий source-depletion route и hook receipt; не создавать получателя второй раз.
- Обычный import из персонажа, world Item и компендиума в группу.
- Обычные Item grants из модели/генератора, выдача строк loot-chat, получение строк Storage в партийный инвентарь через `commitInventoryIngressBatch`.
- Пакеты с действиями ingress `legacy`, `folder`, `skip`, включая root override. Magic Item является обычной строкой, если ему не требуется специальная операция контейнера/конверсии.
- Ограниченное исправление завершения операции и refresh: успешная мутация не должна ждать полного render для подтверждения пользователю или socket-ответа.

### Исключено

- Любые торговцы, корзины, торговые sockets, purchase/sale протоколы; также `inventory.sale` не оптимизировать в этой задаче.
- Крафт, резервирование/возврат материалов, ручной dismantle и ingress с фактическим действием dismantle.
- Portable containers, их вложенное содержимое, storage deposits, перемещения между хранилищами и ground-pile lifecycle.
- Валюта и физические монеты, их конверсия, выдача denominations; сохранить текущие исправления базы.
- Revisioned CRUD ingress-правил, миграции групп, энергоресурсы и припасы.
- Глобальная переработка `SocketCommandBus`, world queue, `DurableMutationJournal` и всех его потребителей ради ускорения инвентаря.
- Полная ленивая загрузка вкладок InventoryApp. Это отдельная оптимизация UI; здесь не переписывать подготовку крафта/travel/downtime.

Выбор простого пути выполняется внутри канонического владельца после authoritative preview. Если пакет содержит portable container или действующий dismantle, весь Item-пакет остаётся на прежнем durable пути. Не делить один такой пакет между двумя исполнителями. Skipped строки не считаются сложными. Для смешанного Item+coins вызова Item-часть может быть простой, но валюта и внешнее завершение остаются на текущем протоколе. Нельзя объявлять общий успех до завершения соответствующего владельца валюты.

Новый пользовательский переключатель «безопасный/быстрый режим» не нужен. Это замена внутреннего алгоритма для перечисленных обычных операций.

## 3. Подтверждённые расходы базы

| Путь | Сейчас | Цель простого пути |
|---|---|---|
| Take Item группе → персонажу | 5 journal writes + create + debit | 1 terminal write + create + debit |
| Native drag после создания target системой | prepared + source-depleted + finish | 1 terminal write + source debit; target уже существует |
| Новый ingress пакет из N принятых обычных строк | 4N + 3 journal writes | 1 terminal write на весь пакет |
| Изменить количество / удалить обычный Item | Уже короткий путь | Не добавлять журнал |

Формула ingress описывает успешный новый пакет без skipped строк и recovery. При N=20 это 83 → 1 записей **inventoryMutationJournal**, а не всех записей Foundry. Storage продолжает сохранять собственное списание строк; LootClaimService сохраняет свои этапы выдачи; монеты имеют отдельный протокол. Эти записи считать отдельно, не скрывать их в отчёте.

Обычная InventoryApp `_prepareContext()` собирает также группу, крафт, календарь, travel, transport и downtime. `runInventoryMutation()` сейчас ожидает refresh с settle-интервалом 80 мс. Отвязка подтверждения мутации от render должна уменьшить ожидание интерфейса; численное ускорение подтвердить измерением, не выводить его только из количества writes.

## 4. Владельцы и минимальные точки изменения

Вход в проект: раздел 7 `docs/function-passport.md`; для Storage — раздел 8; для composition/refresh — соответствующие записи паспорта. Искать имена через rg, не читать большие файлы целиком.

| Файл | Ответственность |
|---|---|
| `scripts/data/inventory-service.js` | Выбор simple/legacy пути, операции Item, fingerprint, transient receipts, откат, terminal result. Методы: `#executeTakeInventoryItem`, `#executePartyInventorySourceDepletion`, `#importItemDocument`, `commitInventoryIngressBatch` |
| `scripts/application/durable-mutation-journal.js` | Только additive метод `recordTerminal(record, result)` для одноразового сохранения сразу terminal record; существующие find/start/checkpoint/finish и retention не менять |
| `scripts/application/world-mutation-coordinator.js` | Существующие очереди/idempotency переиспользовать; изменение общих гарантий не требуется |
| `scripts/integrations/inventory-sync.js` | Существующий native-drag receipt и rollback, scoped refresh; без второго hook/drag owner |
| `scripts/data/storage-command-service.js` | Адаптер source debit `#commitPartyIngress`, доставка частичного результата через существующий claim route |
| `scripts/application/loot-claim-service.js` | Совместимость внешнего claim с частичным grant; claimed только для действительно принятых строк |
| `scripts/main.js` | Existing dispatch и grantBatch adapters, `runInventoryMutation`, refresh hold/release; публикация результата и ошибки |
| `scripts/ui/inventory-app.js`, `scripts/ui/storage-app.js` | Только обработка partial/manual-review/refresh warning и разблокировка действий; не менять layout |
| `README.md`, `docs/function-passport.md` | Новые гарантии и методы, ограничения retry/restart, профильные тесты |

Не создавать второй InventoryService, универсальный transaction framework, второй socket bus или собственный refresh scheduler. Если pure helper нужен для вычисления rollback/результата, он не получает собственное состояние, queues или Foundry hooks.

## 5. Одноразовый итог и idempotency

### 5.1 Формат

Новая запись в существующем `inventoryMutationJournal` имеет отдельный kind `inventory-simple-v1`, phase `committed`, terminal `true`. Минимальные поля: `id`, `kind`, `phase`, `terminal`, `fingerprint`, `operationType`, `sourceActorId`/`targetActorId` или `groupActorId`, `result`.

`result` использует текущую оболочку `{ ok, value }` либо `{ ok:false, code, error }`; детали partial/ручной сверки сохраняются в компактном `value`/details. Сохранить существующие успешные возвращаемые поля API; дополнительные поля ошибок перечислены ниже. Не сохранять ItemData, полные Actor snapshots, compiled rules, rollback before-images и прочие данные для автоматического продолжения. UUID/ID и количества в строках результата допустимы. Fingerprint включает тип операции, точные endpoints, IDs, количества и canonical ingress plan; это проверяемая строка запроса, не случайный hash.

`recordTerminal(record, result)` сериализуется той же очередью журнала, проверяет конфликт существующего ID и fingerprint, сохраняет отсутствующий terminal record одним `#writeState`. Точный terminal retry возвращает существующую запись без write; чужой fingerprint отвергается без мутации. Старый nonterminal с этим ID не заменяется новым. При write-then-throw журнала разрешена существующая сверка прочитанного результата. `start()` + `finish()` вместо этого метода запрещены на простом пути: это снова две записи.

Существующий предел 64 завершённых записей и сохранение всех legacy nonterminal остаются. Перестройка retention для других владельцев не входит в задачу. Удаление старого terminal outcome из ограниченного журнала ограничивает и гарантию повторного запроса; не заявлять вечную дедупликацию.

### 5.2 Память и повтор

- Одинаковый concurrent request должен присоединяться к выполняющейся операции, а не вставать вторым переносом. Использовать существующий coordinator с operationId, namespaced по владельцу, и проверкой fingerprint до возврата cache.
- Дедупликация необходима и при локальном GM вызове, не только на socket boundary. Ключ in-memory idempotency не должен совпадать с ключом outer socket execution: нельзя ожидать собственный Promise.
- Повтор с тем же ID после успешного terminal write возвращает прежний outcome до разрешения уже удалённого источника и без повторного preview/debit.
- Если игровая операция прошла, но terminal write не прошёл, сохранить outcome в существующей ограниченной памяти процесса и вернуть игровой результат с `auditPersisted:false` и предупреждением GM. Не повторять перенос, не откатывать успешное списание из-за одной ошибки аудита. Повтор в этом процессе возвращает тот же результат; допустимо повторить только запись аудита.
- После рестарта/смены GM без terminal record автоматическое продолжение не гарантируется. Не добавлять retry с новым ID, watchdog или recovery-loop. Таймаут должен сообщать «результат неизвестен; проверьте источник и получателя», а не автоматически повторять действие. Сохранить обычное чтение terminal outcome, когда запись есть.

## 6. Очереди и проверки

Не убирать exact payload validation и sender binding на socket boundary. Не доверять присланному ItemData вместо текущего разрешённого источника. Preview на клиенте остаётся для confirmation; authoritative preview и parity на GM остаются единственными решающими для ingress. Повтор после await нужен лишь там, где данные могли измениться, либо для проверки неоднозначной записи.

Все простые Item-переносы используют существующую queue `inventory` один раз на верхнем уровне InventoryService. Ingress дополнительно удерживает существующую `inventory-organization:<groupActorId>` для folder/rule consistency. Порядок: уже имеющиеся outer socket/source queues → `inventory` → `inventory-organization:<id>` → journal. Не вводить обратного порядка и не входить повторно в удерживаемую очередь. Для вызовов из уже удерживающего inventory wrapper использовать внутреннюю функцию исполнения, а не повторный public dispatch. Проверить call graph старых take/source-depletion/ingress маршрутов.

Очередь предотвращает гонки модульных переносов; она не блокирует внешнее редактирование Item другими модулями/листами. Перед debit и rollback сверять точные затронутые количества/identity; при постороннем изменении не восстанавливать целый Actor snapshot и не перетирать чужие изменения.

Полномочия active GM проверять на входе и перед очередной privileged записью после await. При смене GM прекратить дальнейшие writes, включая rollback старым GM; сообщить неопределённый результат для ручной сверки. Не удалять эту проверку ради скорости.

## 7. Выполнение обычного переноса

1. Войти в idempotency/queue, проверить существующий simple или legacy outcome.
2. Разрешить live source и target; проверить права, членство, количество, допустимую identity. Зафиксировать в памяти только нужные данные и expected quantities.
3. Создать Item у получателя либо выполнить существующий merge с теми же durability/folder constraints. Простой take сохраняет текущую семантику создания отдельного Item. Marker операции включить в первоначальное создание без отдельного setFlag.
4. Дождаться результата. При обычном отказе create источник не менять. При write-then-throw один раз проверить фактический target по marker/receipt; если нельзя определить исход — остановиться с manual-review, не создавать повторно.
5. Списать source. Compendium/world template/public-model grant не имеет debit; не изображать фиктивные persistent фазы списания. Для частичной стопки применить точную delta.
6. При отказе debit один раз проверить, не было ли списание фактически применено. Если применено — это успешный перенос. Если source неизменён — выполнить локальный rollback target. Новый Item удалить только при совпадении marker/ожидаемого состояния; merged stack вернуть на beforeQuantity только при точном afterQuantity. Если source или target изменён непредсказуемо — manual-review, без слепого удаления.
7. Один раз записать итог (success, compensated failure либо manual-review) и запланировать refresh затронутых Actor IDs.

При успешном rollback вернуть ошибку переноса с `code: transfer-failed-compensated`; при неуспешном/небезопасном rollback — `code: transfer-manual-review`, endpoints, исходное/ожидаемое количество и какие шаги подтверждены. UI сообщает GM конкретный предмет/источник/получателя. Не добавлять обязательный диалог подтверждения перед каждым переносом.

Native drag сохраняет иной начальный момент: target уже создан системой. Проверить существующий receipt и выполнить только пункты source debit/outcome. Rollback выполняет прежний владелец `inventory-sync.js` по результату GM, не оба слоя одновременно. Сохранить единый URL stateful import и передачу `transferId`, `targetReceipt`, обоих Actor IDs.

## 8. Пакеты ingress и внешние источники

Перед первой записью один раз разрешить source rows, authoritative plan, overrides и целевые папки. Сначала проверить отсутствие legacy record; legacy recovery описан ниже. Eligible simple пакет выполняется в прежнем порядке строк, последовательно, без `Promise.all` над зависимыми перемещениями. Массовые Foundry create/update/delete одним вызовом не обязательны в этой задаче: уменьшение journal writes уже даёт основной проверяемый результат и не требует нового протокола частичного ответа API.

Для каждой принятой строки: target credit → source-owner debit, с receipts в памяти. Skip ничего не создаёт/списывает. Folder membership новых успешно перенесённых Items накапливается в памяти и записывается одним Actor flag в конце; merge candidate selection использует также накопленный membership, чтобы две строки не сливались через разные папки. На время всего пакета удерживается существующий inventory refresh hold. Если операция завершилась до финального folder write, Item может временно находиться в root — это часть принятого компромисса.

При первой ошибке остановить пакет. Уже завершённые строки оставить, target текущей неуспешной строки компенсировать по разделу 7, остальные не начинать. Сохранить folder membership успешных строк и один terminal outcome всего пакета. Ошибка folder write после выполненных переносов не означает, что предметы не перенесены: вернуть partial/manual-review с указанием проблемы папок; не выдавать их повторно.

Partial outcome содержит `completedSourceKeys`, `skippedSourceKeys`, `failedSourceKey`, `unprocessedSourceKeys`, `changed`, `actorId`, `batchMutationId`, `code`, а также существующие row results для успешных строк. Использовать ошибку с details на внешнем API, где сейчас ожидается rejection; не превращать частичный успех в обычный success toast. Повтор того же batch ID возвращает прежний итог, не продолжает оставшиеся строки. Следующее явное действие пользователя строит новый preview по свежему source state и новый ID для оставшегося.

### Storage

Сохранить `#runClaim` root-token queue, access checks, source mutation receipts и `StorageService.claim()` как единственного владельца списания. Простой inventory executor не пишет storage token напрямую. `#commitPartyIngress` обязан доставить partial details до UI; successful debit rows уже исчезли/уменьшились в storage. При write-then-throw source adapter подтверждает существующий stable per-row mutationId; при неразрешимой неоднозначности не откатывать заведомо списанную ценность вслепую.

### Loot chat

В базе `LootClaimService.claimBatch()` владеет prepared/granted/committed ChatMessage state, а inventory grant adapter использует no-op debit. Эти три записи не являются journal checkpoints инвентаря и сохраняются. Если ordinary grant частично выполнен, adapter передаёт список фактически accepted rows и structured failure; LootClaimService обязан завершить source claim для этих строк прежде, чем вернуть пользователю partial error. Не оставлять весь claim prepared и повторять успешные grants после частичной ошибки.

Terminal outcome inventory grant описывает результат target stage, а не обещает завершение внешнего claim. Пока внешний source-owner не завершён, не показывать полный успех. При отказе ChatMessage write применяются прежние source-owner semantics; результат сообщается как неопределённый, без автоматического повторного создания Items.

### Direct grants и импорт

Public-model/compendium grant не удаляет source template. Actor import списывает только конкретный исходный Item; перенос в ту же группу остаётся folder move/no-op. Внешний Item+coins wrapper при partial Item grant не начинает ещё не начатую выдачу монет и не скрывает уже выданную; сохранить текущие stable currency IDs и контракт повторов.

## 9. Legacy и исключённые владельцы

Перед выбором нового алгоритма читать record с прежним operation ID. Старый terminal возвращает старый результат. Старый nonterminal выполняется только прежним recovery кодом для данного kind либо возвращает его прежнюю reconciliation error. Не удалять/преобразовывать историю при обновлении, не запускать массовую миграцию и не маскировать старый prepared под простой terminal.

Новому простому executor не нужны persistent rollback snapshots. Старые executor branches сохраняются именно для legacy records и исключённых сложных пакетов. Не оставлять два публичных entrypoint или новое создание legacy prepared для нового eligible запроса.

`DurableMutationJournal.recordTerminal` — additive API. Старые методы, их catch/readback semantics, лимиты и callers (включая торговые/крафтовые) не менять. Существующие tests recovery сохранить для legacy fixtures; новые normal-path fixtures проверяют более слабые, явно заданные гарантии. Не удалять все recovery tests ради зелёного прогона.

## 10. Refresh и завершение UI

- Продолжать использовать единственный `refreshInventoryViews({ actorIds })`, hold count и `UiRefreshCoordinator`.
- Операция возвращает итог после необходимых document/source/audit действий, не после render. Разблокировка кнопки и socket acknowledgment не зависят от стоимости `_prepareContext()`.
- Добавить в `runInventoryMutation` внутреннюю optional настройку `awaitRefresh`, по умолчанию `true`, чтобы сохранить поведение остальных callers. Только wrappers перечисленных простых операций используют `false`: они запрашивают refresh с обработкой rejection, но не awaits его. Для ingress выбор согласовать с eligibility простого пути; сложные/legacy wrappers сохраняют прежнее ожидание. Публичный `refreshInventoryViews()` остаётся awaitable для callers, которым явно нужно дождаться DOM; его контракт не менять.
- Освободить hold в finally при любой ошибке. Нельзя удерживать world/source queue во время render или получить nested hold deadlock.
- Refresh error не меняет success уже выполненного переноса на transfer failure. Сообщить предупреждение обновления UI; повтор операции не требуется.
- Передавать exact source и target Actor IDs, включая группу при take, и token/storage scope через существующие адаптеры. Сохранить focus/scroll и фильтрацию закрытых/свёрнутых окон.
- Не удалять 80 мс debounce глобально. Он группирует hooks; полезно убрать его из ожидания операции, а не получить render на каждый Item.
- На инициаторе/GM пакет должен формировать один explicit scoped refresh после release. Requester dispatch также не должен снова ожидать render после socket response простого пути. Hooks и другие клиенты могут получать события; не обещать один render во всём мире без измерения. Не переключать `awaitRefresh` глобально и не изменять торговые wrappers.

## 11. Проверки и критерии готовности

Новые focused tests можно разместить в `tests/inventory-simple-transfer.test.mjs`; счётчики writes разместить в существующих fixtures, без production telemetry или нового performance framework.

Обязательные сценарии:

1. Take целого Item и части стопки: правильные endpoints/количества, 1 journal write; target created до source debit.
2. Отказ create: source неизменён. Applied create/debit then throw: подтверждённый фактический результат не применяется второй раз.
3. Debit failure: безопасный rollback нового и merged target; rollback failure/quantity drift → manual-review без посторонних потерь.
4. Одновременные одинаковые ID, два разных переноса одной стопки, ID с другим payload: соответственно один результат, сериализованное списание, отказ конфликта. Local GM и player/socket.
5. Terminal write failure: игровой успех не превращается в новый перенос при retry в том же процессе. Persisted terminal retry после нового service instance — без source resolve/create/debit.
6. Fresh process без terminal record не должен заявлять восстановление; UI timeout не повторяет запрос автоматически.
7. Native drag: target создаётся только системой, source списывается один раз, 1 terminal write, rollback единственным владельцем, scoped IDs сохранены.
8. Ingress N=1/20/100 обычных строк: 1 inventory journal write на пакет; skip/folder/root override/merge/durability сохранены. Не больше 1 final folder write при необходимости. Source-owner writes считать отдельно.
9. Ошибка на строке k: предыдущие остаются, текущая компенсирована либо явно manual-review, последующие нетронуты; повтор ID не повторяет success rows. Storage и LootClaimService корректно отражают accepted subset.
10. Folder write failure после debit: честный partial результат, повтор не создаёт предметы. Same-group import не превращается в transfer.
11. Legacy prepared take/source-depletion/ingress продолжается старым путём без повторной ценности. Сложный mixed пакет целиком legacy. Craft/dismantle/rule CRUD/currency/traders не меняются.
12. Отложенный refresh Promise не задерживает mutation result/socket response; rejected refresh не даёт transfer failure/unhandled rejection; nested holds завершаются; закрытые окна/focus/scroll остаются прежними.

Профильные suites: `inventory-simple-transfer`, `inventory-mutation-recovery`, `durable-mutation-journal`, `inventory-sync-hooks`, `inventory-transfer-imports`, `inventory-ingress-planner`, `inventory-ingress-rules`, `inventory-folder-socket`, `storage-socket`, `storage-service`, `loot-claim-service`, `group-command-dispatch`, `ui-refresh-coordinator`, `background-refresh-focus`, `inventory-app-context` (все `tests/*.test.mjs`). Добавить точный список в паспорт по фактически изменённым владельцам.

Перед commit реализации выполнить один полный прогон и статические проверки из AGENTS.md:

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Live QA в тестовом мире: GM и player, single take, native drag, Storage 20 rows, loot-chat partial failure, повторный клик, открытые main inventory + folder popout. Записать точные Foundry/dnd5e versions. Сравнить до/после на одинаковом наборе: число journal/document/source writes, время до результата операции, время до видимого обновления (по 10 повторов, median и max). Тестовые предметы/операции заранее изолировать; не повреждать игровое состояние для failure injection.

Готовность: функциональные scenarios проходят; простые успешные операции достигают write budgets; нет зависимости acknowledgment от render; excluded paths сохраняют контракты; runtime-версия повышена; изменения методов отражены в паспорте, гарантии — в README. Если live QA недоступна, явно перечислить непроверенное и не объявлять измеренное ускорение. Тесты со счётчиками подтверждают устранение записей, но не заменяют измерение пользовательской задержки.

## 12. Порядок реализации и Git

В следующем самостоятельном этапе: сначала fixtures/write budgets и additive terminal API; затем take/native drag; затем ordinary ingress + source-owner partial adapters; затем отвязка refresh; в конце legacy/exclusion regression и документация. Каждый шаг сначала получает focused-тест своего поведения. Не начинать с массового удаления проверок или journal calls.

Обязательный Git-процесс: `git status --short --branch`, `git branch --show-current`, `git fetch origin`; затем `git rev-list --left-right --count HEAD...origin/main`, `git log --oneline HEAD..origin/main` и проверка remote lich_branch. Все правки только `lich_branch`, не main/master. При чужих незакоммиченных изменениях, ушедшей вперёд remote lich_branch или конфликте актуальной основной ветки остановиться и сообщить. Не stash/reset чужую работу.

Добавлять только файлы задачи, без `git add -A`. Перед commit: обязательные проверки, `git diff --check`, `git diff --stat`, содержательный diff. После — осмысленный commit и `git push -u origin lich_branch`, без force. Версию runtime поднять от актуальной на момент реализации, синхронно заменить versioned forwarder/esmodules, проверить отсутствие старой runtime ссылки. Только документация этой спецификации повышения версии не требует. Все новые/изменённые/удалённые методы записать в `docs/function-passport.md` в том же commit.

## 13. Проверки при подготовке спецификации

На исследованной базе `1994e3e939898eef7ae4bf5849776dc05190c450`: `node --test tests/*.test.mjs` — 3472 passed, 0 failed; `node --check` по всем 654 tracked JS/MJS — 0 ошибок; `ConvertFrom-Json` по 44 tracked JSON — 0 ошибок. Runtime-код при подготовке не изменялся. Эти результаты фиксируют исходную базу и не подтверждают ещё не реализованную оптимизацию. Спецификация проверена на согласованность scope, partial outcomes, legacy compatibility, queue order и исключение торговых callers; diff whitespace checks пройдены.
