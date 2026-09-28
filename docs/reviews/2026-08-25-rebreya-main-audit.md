# Rebreya Main: полный статический аудит

**Дата аудита:** 2026-08-25

**Проверенный commit:** `3e0bdc0f374501e165dbcf9fdcc359c1dded607f`

**Ветка:** `lich_branch`
**Режим:** только статический анализ; Foundry не запускался; production-код, данные, тесты и паспорт функций не изменялись.

## 1. Резюме

Аудит выполнил два прохода по утверждённой спецификации: сначала Git/baseline и полный манифест покрытия, затем три независимых обзора владельцев поведения и контроллерская проверка межслойных маршрутов. Все P1 независимо перепроверены главным агентом по исходникам и релевантным существующим тестам.

Проверенная конфигурация:

- Rebreya Main `1.4.162`; `module.json` требует Foundry 13 и `statuscounter >= 3.0.4`;
- локальный Foundry VTT `13.351`;
- локальная dnd5e `5.2.5`;
- локальный `statuscounter 3.0.4`;
- статическая копия мира `testovyj3-review-20260825`: core `13.351`, dnd5e `5.2.5`, 17 Rebreya-паков.

Итог подтверждённых находок на момент отчёта: **P0 — 0; P1 — 8; P2 — 7; P3 — 1**. Наиболее опасный общий мотив — обход единственного active-GM writer либо многошаговые перемещения предметов без durable transaction. Это создаёт обычные, не мошеннические пути дублирования, потери ресурса и записи не в ту группу. Синтаксис и текущая Node-suite зелёные, но тесты преимущественно проверяют happy path и последовательные вызовы; они не моделируют потерянные socket results, два клиента, stale snapshots и отказы между document writes.

Этот отчёт отделяет доказанные дефекты от гипотез. Отсутствие собственного automation handler не считалось достаточным доказательством: для каждой механической сущности сопоставлены её обещание, dnd5e-native activities/effects, module registries/hooks/macros и профильные тесты. Полный классификационный манифест находится в разделе 3.

## 2. Подтверждённые находки

### ST-001 — Lootgen self-claim выдаёт предмет до подтверждённого списания источника

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** выдача Item персонажу и terminal claim/delete строки lootgen образуют одну идемпотентную транзакцию.
- **Фактически:** `claimLootgenRowToSelf` сначала создаёт embedded Item, затем вызывает player API; player route fire-and-forget отправляет legacy socket без ACK/mutation ID и сразу возвращает `true`. Active GM независимо помечает строку claimed и только затем удаляет source.
- **Обычный триггер:** active GM отключается после target create; request/result теряется; игрок повторяет клик до broadcast; либо GM-side source delete падает после обновления ChatMessage.
- **Маршрут:** `scripts/ui/lootgen-chat.js:174-197,512-530` → `scripts/main.js:2880-2918` → legacy dispatch `scripts/main.js:2468-2470` → ChatMessage update → source delete.
- **Доказательство:** `scripts/main.js:2541-2547` не создаёт correlation/ACK; `2887-2891` возвращает успех после emit; `2897-2913` разделяет row update и source delete. Текущие `tests/lootgen-chat.test.mjs:292-368` и `tests/loot-claim-service.test.mjs` не покрывают потерю сообщения/отказ между сторонами.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`; от optional integrations не зависит.
- **Регрессия:** потерять первый request/ACK после успешного target create, повторить тот же claim и проверить ровно один target Item и один terminal source receipt; отдельно инъецировать ошибку source delete.
- **Направление исправления:** typed active-GM transaction со стабильным mutation ID, durable source/target receipts и recovery/compensation.

### ST-002 — Hero Doll переносит предмет до валидации слота и без транзакции

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** полная проверка слота предшествует exactly-once межакторному transfer; doll state и equipped state коммитятся согласованно.
- **Фактически:** `#resolveDropItem` переносит предмет из общего склада до проверок `allowedSlots`; stack path создаёт target и затем уменьшает source, quantity-1 path создаёт target и затем удаляет source. Doll flag сохраняется двумя writes `unsetFlag` → `setFlag`.
- **Обычный триггер:** drop предмета без metadata допустимых слотов или в несовместимый слот уже выдаёт предмет персонажу, после чего UI показывает ошибку; два co-owner клиента одновременно перетаскивают один stack; любой write падает после target create.
- **Маршрут:** sheet drop `scripts/integrations/dnd5e-sheet-extensions.js:3416-3429,3595-3609` → `assignItemToSlot` `scripts/data/hero-doll-service.js:398-435` → `#resolveDropItem` `303-328` → `#moveItemToActor` `273-300` → поздняя validation `408-415` → doll flags `107-116`.
- **Доказательство:** порядок вызовов детерминирован исходником; единственный `tests/hero-doll-service.test.mjs` проверяет snapshot, а не mutation/failure path.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** invalid-slot shared-item drop не меняет ни один Actor; barrier test двух co-owners; failure injection после create/source debit и между `unsetFlag`/`setFlag`.
- **Направление исправления:** validate immutable source snapshot до transfer; actor/group-scoped typed mutation со stable ID, receipts, compensation и одной заменой doll state.

### ST-003 — Calendar command авторизует одну группу, но выполняет transition для другой

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** typed command, авторизованный по `payload.groupActorId`, использует ту же captured group во всех стадиях transition.
- **Фактически:** registration авторизует `payload.groupActorId`, но execute вызывает `moveTo(payload.options)` и отбрасывает ID. На active GM coordinator делает `resolveForCurrentUser()`, а GM-контекст выбирает глобальную `activeGroupActorId`.
- **Обычный триггер:** active GM выбрал группу A; честный игрок группы B запускает calendar transition для B.
- **Маршрут:** player payload `scripts/main.js:5739-5761` → registration `scripts/main.js:1606-1616` → `scripts/data/calendar-transition-coordinator.js:281-295` → GM resolution `scripts/data/group-context-service.js:479-489` → journal/calendar/downtime/day-cycle группы A.
- **Доказательство:** `#assertExecutionContext` `calendar-transition-coordinator.js:998-1018` подтверждает текущую GM-группу A и поэтому не обнаруживает mismatch. `tests/calendar-transition-coordinator.test.mjs:1552-1651` использует одну группу.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** две группы, GM active A, sender владеет участником B; every journal/domain callback должен оставаться B.
- **Направление исправления:** API вида `moveToGroup(groupActorId, options)`; captured group обязателен для preview, queue key, guards и journal rows.

### ST-004 — Public world writers допускают inactive GM как независимого writer

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** privileged world writes исполняет ровно один elected active GM; остальные клиенты, включая другого GM, используют typed route.
- **Фактически:** ряд public methods проверяет только `game.user.isGM` либо вообще не имеет execution gate. `WorldMutationCoordinator` создаётся отдельно в каждом браузере (`scripts/main.js:1199-1222`) и не сериализует два GM-клиента; full-object read/modify/write даёт last-write-wins.
- **Обычный триггер:** два обычных GM-клиента открыты; inactive GM редактирует событие, downtime, группу, trader/economy setting одновременно с active GM.
- **Маршрут / подтверждённые writers:** global events `scripts/main.js:3417-3459` → `scripts/data/global-events-service.js:495-506,562-603`; city/economy `main.js:3497-3579` → `scripts/data/repository.js:300-305,329-438`; legacy trader `main.js:3655-3669,3690-3693` → `scripts/data/trader-service.js:1726-1747`; downtime `main.js:4392-4450,4844-4865,4984-5003,5143-5174` → `scripts/data/downtime-service.js:3420-3442`; groups `main.js:5181-5198` → `scripts/data/group-context-service.js:426-458`; registry write `scripts/infrastructure/foundry/group-state-repository.js:38-48`.
- **Доказательство:** все repositories читают и заменяют общий объект без cross-client CAS. Cosmology `scripts/main.js:6465-6487` корректно routes inactive GM и служит контрольным примером.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`; dnd5e не участвует.
- **Регрессия:** два simulated module instances, один elected active GM; concurrent independent edits одного setting обязаны сохранить обе мутации, а inactive instance — отправить command, не писать локально.
- **Направление исправления:** единый privileged mutation gateway: active GM direct, все остальные — exact typed command; repository write возможен только внутри gateway.

### ST-005 — Party-inventory drag коммитит target раньше source-depletion protocol

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** target и общий source settle атомарно либо target имеет durable, bounded rollback/recovery.
- **Фактически:** dnd5e уже создаёт или увеличивает target Item, затем Foundry вызывает module `createItem`/`updateItem` hook; только после этого модуль просит active GM списать source. При исчезнувшем GM hook лишь логирует ошибку. После отправленного request pending state хранится только в памяти и не имеет timeout/failover recovery.
- **Обычный триггер:** GM отключается между drag start и post-create hook; result packet теряется; player reload происходит в ожидании результата.
- **Маршрут:** dnd5e Actor-sheet drop `D:/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:55199-55208` → target create `55235-55257`/stack update `55349-55357` → hooks `scripts/integrations/inventory-sync.js:461-505` → `scripts/data/inventory-service.js:6767-6887` → legacy source-depletion request/result.
- **Доказательство:** memory map/settlement `inventory-sync.js:88-224`; no-active-GM throw `inventory-service.js:6857-6860`; rollback выполняется только при явном `ok:false`. `tests/inventory-sync-hooks.test.mjs:320-515` покрывает delayed success/explicit failure, но не отсутствие результата и reload.
- **Версии:** точный локальный контракт dnd5e `5.2.5`, Foundry `13.351`, Rebreya `1.4.162`.
- **Регрессия:** no-active-GM после target create, lost result и reload/retry должны сходиться к одному target grant и одному source debit.
- **Направление исправления:** перехват до target mutation либо persisted two-sided transfer journal/receipt с timeout, failover query и точной compensation.

### ST-007 — Item upgrades выполняют create/debit/host-link без serializable transaction

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** slot capacity, stack debit, installed Item и двусторонняя host link фиксируются exactly once.
- **Фактически:** stack path создаёт installed copy, уменьшает source, затем пишет host flag; remove сначала удаляет host link, затем очищает child item. Public API не использует actor-scoped coordinator.
- **Обычный триггер:** два co-owner клиента одновременно ставят upgrades в последний slot; write failure после create/debit или между двумя сторонами remove.
- **Маршрут:** sheet drops `scripts/integrations/item-upgrade-sheet.js:570-590,631-657` → `scripts/main.js:5713-5722` → `scripts/data/item-upgrade-service.js:267-307,312-342`.
- **Доказательство:** document boundaries видны на `item-upgrade-service.js:284,289,305-307,330-339`; последовательные happy-path тесты `tests/item-upgrade-service.test.mjs` не инъецируют failure/concurrency.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** barrier concurrent installs из одного stack в один slot и failure at every document boundary; quantity и bidirectional link должны сохраняться.
- **Направление исправления:** actor-scoped mutation owner/typed command, stable mutation ID и explicit rollback/reconciliation receipts.

### ST-008 — Travel принимает stale full-state replacement и не возвращает уже списанное топливо

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** concurrent player actions применяют patches либо сравнивают revision; fuel соответствует только окончательно committed miles.
- **Фактически:** setRoute/speed/advance строят полный `nextState` из client snapshot; active GM сериализует writes, но без revision полностью заменяет `groupState.travelState`. Fuel списывается в `afterCommit` первого advance; поздний stale payload может вернуть старые miles без compensation.
- **Обычный триггер:** два участника одной группы из revision N: A продвигает путешествие, B меняет speed. При порядке A→B прогресс теряется, fuel остаётся списанным; при B→A теряется speed.
- **Маршрут:** `scripts/data/travel-service.js:1194-1260` → typed route `scripts/main.js:1617-1623` → `replaceGroupTravelState` `travel-service.js:1123-1167` → group repository → post-commit fuel.
- **Доказательство:** паспорт `docs/function-passport.md:204-211` прямо запрещает повторное stale replacement; текущий `tests/travel-service.test.mjs:377-417` проверяет только повтор идентичного payload, не две разные операции.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** barrier two clients from revision N, advance + speed; итог сохраняет оба изменения и consumes fuel ровно по committed miles.
- **Направление исправления:** patch commands либо expected revision/CAS с recompute на active GM; fuel включить в ту же durable transition/compensation.

### AU-001 — Universal Belt неатомарно перемещает stack и покупает slot

- **Категория / приоритет / уверенность:** State / P1 / high.
- **Ожидание:** перенос единицы в пояс и покупка slot являются сериализованными, восстанавливаемыми actor transactions.
- **Фактически:** stack path создаёт копию quantity 1 и затем уменьшает source; purchase сначала списывает валюту, потом пишет flag. Нет coordinator, mutation ID или compensation.
- **Обычный триггер:** два быстрых честных drop одного stack quantity 5 читают 5, создают по предмету и оба пишут 4; create succeeds/source update fails; `setFlag` падает после currency update; два одновременных purchase используют один snapshot.
- **Маршрут:** actor sheet listeners `scripts/integrations/universal-belt.js:332-365` → `assignItemToUniversalBeltSlot` `151-184` либо `purchaseUniversalBeltSlot` `187-209` → Actor embedded/create/update/flag writes.
- **Доказательство:** точный порядок `universal-belt.js:170-178,195-208`; `tests/universal-belt.test.mjs:219-350` покрывает только последовательный success/error validation.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** `Promise.all` двух drops/purchases, injected source update и `setFlag` failure; conservation и один unlocked slot.
- **Направление исправления:** actor-serialized, idempotent transaction с durable receipt/rollback.

### ST-006 — Group registration/activation является partial two-document commit

- **Категория / приоритет / уверенность:** State / P2 / high.
- **Ожидание:** managed Actor flag и group registry меняются согласованно либо компенсируются.
- **Фактически:** `Actor.setFlag(MANAGED)` коммитится до registry setting. Отказ второго write оставляет managed-but-unregistered Actor; set-active может пометить Actor, не изменив active group.
- **Обычный триггер:** setting write rejection/потеря соединения после успешного Actor flag write.
- **Маршрут и доказательство:** `scripts/main.js:5181-5198` → `scripts/data/group-context-service.js:426-458`; тесты проверяют success/одноклиентную очередь, но не second-write failure.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`.
- **Регрессия:** reject registry set после successful `setFlag`; состояние остаётся исходным либо retry-resumable.
- **Направление исправления:** durable two-step operation с compensation либо registry-first + reconciliation.

### ST-009 — Runtime содержит literal mojibake и неработающие Global Events tags

- **Категория / приоритет / уверенность:** Logic / P2 / high.
- **Ожидание:** читаемые UTF-8 labels/errors и scope tags, совпадающие с shipped goods.
- **Фактически:** validation/errors, notifications, default template names/descriptions/tags сохранены как `РќР°...`. Import персистит повреждение. Exact tag matcher сравнивает corrupt `РµРґР°` с canonical `Еда`/`eda`, поэтому drought/harvest не охватывают shipped food goods; аналогично mine/monopoly tags. Отдельная firearm warning также повреждена.
- **Обычный триггер:** GM импортирует defaults, активирует шаблон, получает validation/date notification либо attack service не может определить владельца firearm.
- **Маршрут:** defaults `scripts/data/global-events-service.js:1214-1289` → import `1292-1311` → normalize → `eventAppliesToGood` `763-774`/`getGoodTags` `329-336`; UI errors `523-551,579-615,707-712`; firearm warning `scripts/combat/attack-service.js:3447-3450`.
- **Доказательство:** `data/goods.json` использует `groupId:"eda"`, `groupName:"Еда"`, `category:"organic"`; ни один не равен corrupt tag. Отдельного focused GlobalEventsService test нет.
- **Версии:** Rebreya `1.4.162`; runtime-independent.
- **Регрессия:** exact Unicode assertions для всех user-facing literals и imported drought against `pshenitsa`; все default scopes должны выбирать ожидаемые goods. Mojibake aliases в normalization regex (`attack-service.js:263`, `paladin-automation-service.js:302`) проверять отдельно как legacy compatibility, а не автоматически удалять.
- **Направление исправления:** исправить UTF-8 literals/canonical tags, добавить focused tests и осторожную миграцию уже импортированных template IDs.

### AU-002 — В описаниях 11 barbarian rework сущностей поставлены `???`

- **Категория / приоритет / уверенность:** Incomplete / P2 / high.
- **Ожидание:** опубликованная class-feature механика содержит читаемый окончательный текст.
- **Фактически:** `data/barbarian-rework-v012.json:162,190,277,325,373,414,455,496,544,592,633` содержит по три `?` в 11 descriptions (22 runs). `scripts/data/classes-compendium.js` загружает этот dataset и публикует descriptions без восстановления текста.
- **Обычный триггер:** открыть/импортировать соответствующее умение варвара.
- **Маршрут:** JSON dataset → ClassesCompendium source path `scripts/data/classes-compendium.js:52` → Item description.
- **Доказательство:** literal placeholders находятся в shipped source, а не в renderer; профильные tests не запрещают placeholders.
- **Версии:** Rebreya `1.4.162`, dnd5e `5.2.5` Item sheets.
- **Регрессия:** content test отвергает `?{3,}` во всех published mechanical descriptions.
- **Направление исправления:** восстановить первичный UTF-8 текст из узкого source range и пересобрать managed compendium в отдельной задаче.

### AU-003 — 75 race options ложно помечены full automation

- **Категория / приоритет / уверенность:** Automation / P2 / high.
- **Ожидание:** `automation.status/full` означает исполнение конкретного механического обещания сущности.
- **Фактически:** 75 feature/option entities сходятся к generic `runtime.action:"promptCustomEffect"`; handler лишь спрашивает произвольные key/value/duration и не кодирует механику. Например, `люди-ability-3-opt-4` обещает bonus-action уменьшение истощения, но handler этого не делает.
- **Обычный триггер:** персонаж использует любую из перечисленных в automation appendix сущностей и ожидает заявленный outcome.
- **Маршрут:** `data/races-teyvankal-v01.json` automation metadata → `scripts/data/races-compendium.js` → `scripts/combat/race-automation-service.js:1889-1920`, особенно `1901-1903`.
- **Доказательство:** все релевантные race registry/actions/hooks и `tests/race-automation-service.test.mjs` проверены; нет feature-specific mutation. Пример promise находится в `data/races-teyvankal-v01.json:276-344`.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** по одному behavioral test на distinct promised outcome, включая exhaustion decrement; metadata full запрещён для generic prompt.
- **Направление исправления:** реализовать typed feature actions либо честно переклассифицировать metadata/UI как partial/manual.

### AU-004 — «Щит часового» автоматизирован только через необязательный MIDI-QOL

- **Категория / приоритет / уверенность:** Compatibility / P2 / high.
- **Ожидание:** shipped item выполняет преимущество инициативы и Мудрости (Восприятие) в минимальной поддерживаемой конфигурации.
- **Фактически:** source promise `magicItem.js:12262-12270`; builder создаёт только `flags.midi-qol.*` changes `scripts/data/magic-items-compendium.js:295-320,683-692`. `module.json:52-61` требует лишь statuscounter; локальная dnd5e `5.2.5` не содержит consumers этих MIDI flags.
- **Обычный триггер:** выдать/экипировать щит без MIDI-QOL.
- **Маршрут:** magic catalog → managed Item ActiveEffect → dnd5e roll; без MIDI flag остаётся inert.
- **Доказательство:** поиск installed dnd5e даёт 0 ссылок на `flags.midi-qol.advantage`; `tests/magic-items-compendium.test.mjs:250-252` проверяет только наличие MIDI key.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`; MIDI-QOL `13.0.61` установлен локально, но не является required dependency.
- **Регрессия:** no-MIDI contract: native initiative/perception rolls получают advantage либо Item явно сообщает manual/optional requirement.
- **Направление исправления:** native dnd5e effect/activity или объявленный optional dependency/fallback и честная UI-маркировка.

### AU-005 — Все 13 explosives имеют structured profile, но не имеют usable activity

- **Категория / приоритет / уверенность:** Automation / P2 / high.
- **Ожидание:** shipped consumable с `explosive.damage/radius/range/saveDc/trigger` создаёт template/save/damage/status lifecycle либо явно помечен manual.
- **Фактически:** 13 записей `data/gear.json` с `equipmentType:"Взрывчатка"` получают только presentation flags/HTML. `scripts/data/gear-compendium.js:425-441,1000-1112` не создаёт activities/effects; в combat/integrations/data нет consumer explosive profile.
- **Обычный триггер:** импортировать, например, `oskolochnaya-granat` и нажать use: dnd5e нечего выполнять; сложные smoke/flash/repeat-save promises также остаются prose.
- **Маршрут:** gear JSON → GearCompendium consumable system → Item sheet/use; runtime handler отсутствует после проверки registries/hooks/activities.
- **Доказательство:** focused gear tests подтверждают flags, но не activity; полный список 13 ID приведён в automation appendix.
- **Версии:** Rebreya `1.4.162`, Foundry `13.351`, dnd5e `5.2.5`.
- **Регрессия:** каждый explosive exported Item имеет usable activity с совпадающими template/save/damage; отдельные tests для delay/placed/smoke/status.
- **Направление исправления:** native activities плюс lifecycle для delayed/placed effects либо явная manual classification.

### CO-001 — Tracked Python test импортирует удалённый renderer

- **Категория / приоритет / уверенность:** Testing / P2 / high.
- **Ожидание:** tracked focused test запускается при доступном Python и соответствует текущему tool contract.
- **Фактически:** `tests/test_travel_landscape_renderer.py:7-15` импортирует `render_travel_landscapes`, но `tools/render_travel_landscapes.py` отсутствует; `tests/travel-parallax-assets.test.mjs:40-48` одновременно утверждает, что renderer obsolete.
- **Обычный триггер:** developer/CI запускает требуемый focused Python test.
- **Маршрут:** Python test path injection → missing module import → collection failure до assertions.
- **Доказательство:** `python tests/test_travel_landscape_renderer.py` детерминированно даёт `ModuleNotFoundError: No module named 'render_travel_landscapes'`; `python -m pytest ...` дополнительно недоступен, потому что `pytest` не установлен.
- **Версии:** repository commit; Foundry-independent.
- **Регрессия:** удалить/заменить stale test либо восстановить поддерживаемый renderer и обеспечить standalone import.
- **Направление исправления:** согласовать Python/Node tool contract в отдельной задаче; не маскировать test как skipped.

### CO-002 — README указывает несуществующий `feat.js`

- **Категория / приоритет / уверенность:** Maintainability / P3 / high.
- **Ожидание:** contributor меняет канонический source feats по документированному пути.
- **Фактически:** `README.md:145,347` указывает root `feat.js`, которого нет. Runtime sources заданы `scripts/data/feats-compendium.js:22-24` и выбираются `391-412` (`feats-world-overrides.json` и `cherty-v08-foundry-2014-import-pack/*`). Старая ссылка также остаётся в узком passport section `docs/function-passport.md:247`.
- **Обычный триггер:** maintainer следует README и либо не находит файл, либо правит не тот source.
- **Маршрут:** documentation → content maintenance workflow; runtime непосредственно не падает.
- **Доказательство:** tracked path отсутствует; actual loader paths и precedence явны в source.
- **Версии:** repository commit; runtime-independent.
- **Регрессия:** documentation-source contract проверяет существование всех канонических paths.
- **Направление исправления:** обновить README/passport только вместе с отдельной documentation task.

## 3. Манифест автоматизации поставляемых сущностей

### 3.1. Метод и сверка с миром

Классы означают:

- **complete** — всё заявленное поведение исполняют проверенные dnd5e-native fields/activities/effects либо конкретный module handler;
- **partial** — документ создаёт часть native механики, activity/prompt/registry entry, но текст оставляет существенный outcome, trigger, choice или state transition вручную;
- **absent** — поставляется только prose/presentation/flags, которые не исполняет ни dnd5e, ни найденный module/integration handler;
- **N/A** — после просмотра сущность не содержит исполняемого обещания; это справочный документ, а не автоматизируемая механика.

Каждая строка ниже задаёт механически однозначное множество: полный pack, точный `equipmentType`, flag/status либо перечисленные исключения. Поэтому классификация распространяется на каждый ID множества, а не является выборкой. Исходные catalogs сверены с фактическими top-level documents 17 LevelDB-паков копии мира: базы были скопированы во временный каталог и открыты только там; оригинал мира не открывался для записи.

В 17 паках находится **3 113** top-level поставляемых сущностей (folder и embedded-effect records исключены): **276 complete, 1 580 partial, 1 225 absent, 32 N/A**. Сумма полностью сходится. `data/implants.json` и `data/upgrades.json` являются зеркалами профилей соответствующих gear IDs, а не дополнительными опубликованными документами, поэтому повторно в 3 113 не считаются.

### 3.2. Сводная таблица

| Pack/catalog, исчерпывающая группа | Всего | Complete | Partial | Absent | N/A | Обещание и проверенные implementation points |
|---|---:|---:|---:|---:|---:|---|
| Gear: `Оружие` | 57 | 57 | 0 | 0 | 0 | dnd5e weapon damage/properties/range/ammunition; `scripts/data/gear-compendium.js:1042-1112`, native attacks |
| Gear: `Огнестрельное оружие` | 34 | 34 | 0 | 0 | 0 | native attack плюс reload/clear-jam/maintenance/area-fire activities; `gear-compendium.js:560-861`, `scripts/combat/attack-service.js`, `combat/hooks.js` |
| Gear: `Доспех` | 31 | 31 | 0 | 0 | 0 | native AC/DEX/strength/properties; `gear-compendium.js:897-941` |
| Gear: `Инструменты` | 15 | 15 | 0 | 0 | 0 | native tool/baseItem/ability; `gear-compendium.js:997-1006` |
| Gear: 26 `Боеприпас` со structured `ammunition` | 26 | 0 | 26 | 0 | 0 | native ammo/compatibility есть, особые свойства остаются flags/prose; `gear-compendium.js:955-980,1042-1112`, `ammunition-compatibility.js` |
| Gear: 24 `Снаряжение` с container capacity | 24 | 0 | 24 | 0 | 0 | native container capacity/contents; специальные применения остаются prose; `gear-compendium.js:1008-1036,1117-1176` |
| Gear: implants, входящие в `SUPPORTED_MECHANICAL_IMPLANT_IDS` | 36 | 0 | 36 | 0 | 0 | registry/effects/hooks покрывают только перечисленные capabilities, не весь текст; `implant-automation-registry.js`, `implant-automation-service.js`, implant hooks |
| Gear: остальные implants | 55 | 0 | 0 | 55 | 0 | ID отсутствуют в supported registry; activity/effect/handler не найден |
| Gear: `Взрывчатка` | 13 | 0 | 0 | 13 | 0 | structured damage/radius/range/save/trigger сохраняется лишь во flags/prose; AU-005 |
| Gear: `Обвес` | 25 | 0 | 0 | 25 | 0 | attachment slots/properties лишь flags/HTML; применения modifier к оружию нет |
| Gear: `Усовершенствование` | 90 | 0 | 0 | 90 | 0 | install/link state не исполняет индивидуальные 90 effect promises; profile mirror `data/upgrades.json` содержит 79 из них |
| Gear: оставшиеся `Снаряжение` | 222 | 0 | 0 | 222 | 0 | generic loot/document projection без индивидуального handler |
| Gear: оставшиеся `Боеприпас` | 6 | 0 | 0 | 6 | 0 | нет structured profile и feature handler |
| Gear: `Сокровища` | 63 | 0 | 0 | 63 | 0 | economic/loot records без исполняемой механики |
| Gear: `Зелье` | 1 | 0 | 0 | 1 | 0 | consumable без generated use activity |
| **Gear subtotal** | **698** | **137** | **86** | **475** | **0** | Все `data/gear.json` ID учтены ровно один раз |
| Magic: `ночные-очки`, три `плащ-защиты-*` | 4 | 4 | 0 | 0 | 0 | native transferred effects; `magic-items-compendium.js:255-296` |
| Magic: `бандура-фоклучан`, `лира-кли`, `лютня-досс`, `сумка-хранения`, `щит-часового` | 5 | 0 | 5 | 0 | 0 | spell/container/optional-MIDI частично покрывают promise; `magic-items-compendium.js:31-118,200-221,295-320,663-692` |
| Magic: все остальные IDs (`655` минус девять перечисленных) | 646 | 0 | 0 | 646 | 0 | mechanic-specific activities/effects отсутствуют; в эту группу входят manual `жемчужина-силы`, пять rings, `уроборос` и остальной catalog |
| **Magic subtotal** | **655** | **4** | **5** | **646** | **0** | Все `magicItem.js` ID учтены |
| Feats: bundle flag `automation.status:"full"` | 8 | 8 | 0 | 0 | 0 | choice/runtime services и Elemental Adept handler проверены |
| Feats: bundle flag `automation.status:"automated"` | 36 | 36 | 0 | 0 | 0 | exact static effects/advancements; `FeatsCompendiumService` |
| Feats: bundle flag `automation.status:"partial"` | 304 | 0 | 304 | 0 | 0 | native activity/effect/uses есть, но `automation.notes` сохраняет ручной outcome |
| Feats: bundle flag `automation.status:"manual"` | 71 | 0 | 0 | 71 | 0 | полный ID ledger ниже; concrete handler отсутствует |
| **Feats subtotal** | **419** | **44** | **304** | **71** | **0** | Все top-level `rebreya-feats` Items и bundle entries учтены |
| Race/race-feature records без generic `promptCustomEffect` и не source-partial | 89 | 89 | 0 | 0 | 0 | race/native effects, activities, advancements; `races-compendium.js`, `race-automation-service.js`, combat hooks |
| 75 records с `activities[].runtime.action:"promptCustomEffect"` плюс `полувеликаны-ability-3` | 76 | 0 | 76 | 0 | 0 | generic effect prompt не исполняет specific promise; AU-003; полный ledger ниже |
| **Race subtotal** | **165** | **89** | **76** | **0** | **0** | 34 race + 131 race-feature top-level docs учтены |
| `data/materials.json` / `rebreya-materials` | 250 | 0 | 250 | 0 | 0 | managed loot/economic projection; crafting/trader enforcement общее, не feature-specific |
| `data/rebreya-transport-v01.json` / transport Actors | 62 | 0 | 62 | 0 | 0 | Actor/profile, movement/fuel/lifecycle есть; полного per-vehicle combat proof нет |
| Downtime: source status `partial` | 10 | 0 | 10 | 0 | 0 | request/progress/check scaffolding есть; source notes оставляют результаты/ресурсы GM |
| Downtime: source status `needs-work` или `blocked` | 16 | 0 | 0 | 16 | 0 | точные ID в marker table |
| Backgrounds | 160 | 0 | 160 | 0 | 0 | native grants/advancements; все records имеют `manualNotes`, часть equipment/mechanics остаётся unstructured |
| Actions (все 17 ID) | 17 | 0 | 0 | 17 | 0 | `actions-compendium.js:34-50,254-284` создаёт `activities:{}` и `effects:[]`; global services не связываются с imported entries |
| Class ecosystem: 571 class-feature Items + 49 subclasses + 6 classes | 626 | 0 | 626 | 0 | 0 | все raw и derived records conservatively partial: Barbarian/Fighter/Paladin/Rogue/Sorcerer/Craftsman builders и service families проверены, но полного feature-by-feature proof нет |
| Craftsman construct Actor | 1 | 0 | 1 | 0 | 0 | Actor template + constructor/lifecycle services, но не полная автоматизация всех текстовых возможностей |
| `counterspell-rebreya`, `melfs-minute-meteors-rebreya` | 2 | 2 | 0 | 0 | 0 | reaction/bridge и persisted instance/lease recipes полностью проверены |
| State reference Items | 32 | 0 | 0 | 0 | 32 | после просмотра это reference documents без собственной executable activity; economic state policy и Mechanus runtime — отдельные owners |
| Static Lootgen templates | 0 | 0 | 0 | 0 | 0 | templates создаются пользователем в world setting; статически поставляемых entities нет |
| **Итого** | **3 113** | **276** | **1 580** | **1 225** | **32** | Сходится с top-level world-pack inventory |

Дополнительные structured domain entities — 45 goods, 300 economy cities, 87 regions, 300 travel cities, 530 travel routes, 7 transport modes, 8 city-demand profiles и 8 good groups — не содержат самостоятельного action promise. Их числовые поля потребляют economy/travel engines и они учтены в coverage manifest, но не дублируются как Item automation entities.

### 3.3. Полные ID-ledgers для неоднозначных групп

**Complete feats (44).** `aristokratichnost`, `aristokratichnost-aristocratic-intrigue`, `aristokratichnost-historical-references`, `znatok-dospehov`, `znatok-dospehov-lgt`, `znatok-dospehov-med`, `znatok-dospehov-hvy`, `stihiynyy-adept`, `bystraya-noga`, `varschik`, `monasheskie-traditsii`, `prodolzhayuschiy-charodey`, `srazhenie-vslepuyu`, `trenirovka-s-kuroviyskim-oruzhiem`, `trenirovka-s-gudadskim-oruzhiem`, `trenirovka-s-oruzhiem-menega-dvarfiyskim`, `trenirovka-s-oruzhiem-maytena`, `trenirovka-s-esharskim-oruzhiem`, `trenirovka-s-zomarskim-oruzhiem`, `trenirovka-s-oruzhiem-teblina`, `trenirovka-s-azadranskim-oruzhiem`, `trenirovka-s-umeliluanskim-oruzhiem`, `trenirovka-s-nirianskim-oruzhiem`, `trenirovka-s-oruzhiem-teokratii`, `trenirovka-s-oruzhiem-yultan-glasta-elfiyskim`, `trenirovka-s-oruzhiem-ilduina`, `trenirovka-s-pontvantskim-oruzhiem`, `trenirovka-s-oruzhiem-golkranda-orochim`, `torgovaya-hvatka`, `gildeyskaya-set`, `obostrennye-chuvstva`, `ugrozhayuschie-manery`, `gorodskoy-iskatel`, `potomstvennyy-shahter`, `kollektsioner-spleten`, `vkus-k-roskoshi`, `kochevoy-govor`, `religioznost`, `zhizn-v-strahe`, `blizost-s-pleteniem`, `nam-ne-privykat`, `pervaya-pomosch`, `zakon-sily`, `lovkie-dvizheniya`.

**Absent/manual feats (71).** `adaptatsiya-k-pogode`, `aristokratichnost-polished-etiquette`, `aristokratichnost-aristocratic-charm`, `aristokratichnost-aristocratic-language`, `aristokratichnost-privilege`, `aristokratichnost-servants`, `aristokratichnost-secular-education`, `znatok-schitov`, `master-oruzhiya`, `matematik`, `naparniki`, `nachinayuschiy-zacharovatel`, `odarennyy`, `ekspert-v-navyke`, `vysekayuschiy-proklyatiy`, `opytnyy-alhimik`, `adept-zaklinaniy`, `master-magicheskih-predmetov`, `modifitsirovannyy-voennymi`, `zhongliruyuschiy-zhiznyu`, `mehanicheskaya-nenavist`, `prodolzhayuschiy-bard`, `kontrocharovanie-barda`, `master-bard`, `varvarskoe-bezrassudstvo`, `kriticheskie-udary-varvara`, `nachinayuschiy-voin`, `prodolzhayuschiy-voin`, `master-voin`, `dikaya-forma-druidov`, `nachinayuschiy-eger`, `prodolzhayuschiy-eger`, `master-eger`, `epicheskiy-eger`, `prodolzhayuschiy-zhrets`, `unichtozhitel-nechisti`, `bozhestvennyy-boets`, `sozdanie-magicheskogo-oruzhiya-i-dospehov`, `sozdanie-magicheskih-fokusirovok`, `sozdanie-osobogo-snaryazhenie`, `sozdanie-svitkov`, `sozdanie-chudesnyh-predmetov`, `nachinayuschiy-izobretatel`, `prodolzhayuschiy-izobretatel`, `master-izobretatel`, `epicheskiy-izobretatel`, `tainstvennyy-adept`, `posvyaschenie-v-bozhestvennuyu-kara`, `bozhestvennoe-zdorovya-paladina`, `posvyaschenie-v-dogmaty-paladina`, `posvyaschenie-v-klyatvu-paladina`, `prodolzhenie-klyatvy-paladina`, `uluchshennaya-bozhestvennaya-kara-paladina`, `rasshirenie-aury-paladina`, `epicheskiy-plut`, `posvyaschenie-v-ognestrel`, `prodolzhayuschiy-strelok`, `posvyaschenie-v-skulptora`, `master-reztsa-i-klinka`, `skulpturnaya-transformatsiya`, `razrushitelnaya-krasota`, `vayanie-zhizni`, `rytsar-smerti`, `put-licha`, `dvarfiyskaya-voshititelnost`, `vunderkind`, `lyudskaya-priroda`, `vyrosshiy-sredi-vseh`, `poliglot`, `drug-morskih-obitateley`, `magichaynosti-sluchayutsya`.

**Partial race records (76).** `люди-ability-1`, `люди-ability-3`, `люди-ability-3-opt-1`, `люди-ability-3-opt-3`, `люди-ability-3-opt-4`, `люди-ability-3-opt-5`, `дварфы-ability-1`, `дварфы-ability-1-opt-1`, `дварфы-ability-3`, `высшие-эльфы-ability-3`, `полурослики-ability-3`, `орки-ability-2`, `лесные-эльфы-ability-2`, `кирисан-ability-1`, `кирисан-ability-1-opt-1`, `кирисан-ability-1-opt-2`, `таргулы-ability-1`, `таргулы-ability-1-opt-2`, `гномы-ability-1`, `гномы-ability-2`, `гоблины-ability-3`, `голиафы-ability-2`, `драконорождённые-ability-1`, `драконорождённые-ability-2`, `драконорождённые-ability-3`, `железорождённые-ability-1`, `железорождённые-ability-3`, `железорождённые-ability-4`, `гении-ability-2`, `гении-ability-3`, `синтеты-ability-1`, `синтеты-ability-3`, `дроу-ability-1`, `дроу-ability-3`, `ааракокры-ability-1`, `ааракокры-ability-2`, `людоящеры-ability-1`, `людоящеры-ability-2`, `тортлы-ability-1`, `тортлы-ability-2`, `кобольды-ability-3`, `грунги-ability-2`, `грунги-ability-3`, `гноллы-ability-1`, `гноллы-ability-3`, `табакси-ability-1`, `табакси-ability-2`, `минотавры-ability-1`, `минотавры-ability-2`, `минотавры-ability-2-opt-1`, `минотавры-ability-2-opt-3`, `минотавры-ability-2-opt-4`, `минотавры-ability-2-opt-5`, `кентавры-ability-2`, `кентавры-ability-2-opt-1`, `кентавры-ability-2-opt-2`, `кентавры-ability-2-opt-3`, `кентавры-ability-2-opt-4`, `леониды-ability-1`, `нефилимы-ability-1`, `пепельные-ability-2`, `пепельные-ability-2-opt-1`, `пепельные-ability-2-opt-2`, `пепельные-ability-2-opt-3`, `големы-ability-2`, `големы-ability-2-opt-1`, `големы-ability-2-opt-3`, `големы-ability-2-opt-5`, `големы-ability-2-opt-6`, `големы-ability-2-opt-7`, `големы-ability-2-opt-8`, `големы-ability-2-opt-9`, `големы-ability-2-opt-10`, `големы-ability-2-opt-11`, `големы-ability-3`, `полувеликаны-ability-3`.

**Explosives (13, all absent).** `dymovaya-shashka`, `dymovaya-zavesa`, `granata-bumerang`, `malaya-oskolochnaya-granata`, `mina-adskiy-shepot`, `oskolochnaya-granat`, `ottalkivayushchaya-granata`, `protivopekhotnaya-mina`, `protivotankovoya-mina`, `svetoshumovaya-granata`, `takticheskaya-oskolochnaya-granata`, `tsepnaya-granata`, `velikaya-oskolochnaya-granata`.

**Actions (17, all absent).** `attack`, `attack-one-available`, `attack-no-prof`, `disarm`, `provoke`, `cleave`, `sleight-of-hand`, `steal`, `repair`, `write`, `draw`, `opportunity-attack`, `identify-spell`, `grab-ledge`, `catch-item`, `parry`, `interception`.

Для 304 partial feats полным ID-ledger является точное множество всех `cherty-v08-foundry-2014-bundle.json.items` с `flags["rebreya-main"].automation.status === "partial"`; для 646 absent magic items — точное дополнение девяти перечисленных magic IDs; для gear — непересекающиеся predicates таблицы. Эти определения проверены программно: duplicates и omissions равны нулю.

## 4. Явные пометки ручной обработки и незавершённости

| Marker / источник | Полный охват | Разбор |
|---|---|---|
| Feat `wip:true` | 20 ID: `vynoslivyy-priklyuchenets`, `gluhaya-oborona`, `gravirovschik-magicheskih-kamney`, `kriminalnyy-avtoritet`, `opytnyy-znamenosets`, `otravitel`, `temnaya-alhimiya`, `shef-povar`, `genialnyy-alhimik`, `genialnyy-polkovodets`, `kooperativnye-zaklinaniya`, `master-redkih-yadov`, `ekspert-v-ognemetah`, `zhongliruyuschiy-zhiznyu`, `mehanicheskaya-nenavist`, `posvyaschenie-v-skulptora`, `master-reztsa-i-klinka`, `skulpturnaya-transformatsiya`, `razrushitelnaya-krasota`, `vayanie-zhizni` | Явно поставленный incomplete-content marker; automation class берётся из bundle status, но ни одна такая сущность не считается complete только из-за наличия activity |
| Feat `empty:true` | `zhongliruyuschiy-zhiznyu`, `master-reztsa-i-klinka`, `skulpturnaya-transformatsiya`, `razrushitelnaya-krasota`, `vayanie-zhizni`, `rytsar-smerti`, `put-licha` | Семь пустых source entries; все находятся в absent/manual либо иной не-complete группе |
| Feat `deprecated:true` | `master-obrazov`, `atakuyuschiy-zaklinatel`, `schitovaya-trenirovka`, `boevoy-planirovschik`, `magichaynosti-sluchayutsya`, `svyaschennyy-sluzhitel` | Legacy content остаётся shipped; не удалять молча, но не представлять как актуальную полную автоматику |
| Feat `automation.status:"manual"` | Все 71 ID перечислены в §3.3 | Explicit absent automation, не вывод по keyword search |
| Feat `automation.status:"partial"` и notes | Все 304 entries по точному flag predicate; generator notes `tools/apply-feat-automation.mjs:606-1772,3288-3403` | Activities/effects структурируют часть механики; target/trigger/outcome/manual choices явно оставлены пользователю/GM |
| Race manual generator notes | `tools/apply-race-automation.mjs:418-1187`; 75 `promptCustomEffect` IDs из §3.3 | Conditional saves, tribe/ability choice, damage triggers, movement/map state, exhaustion, temp HP, light, rest и spell choices описаны как ручные; поэтому AU-003 и partial classification |
| Downtime `needs-work` | `magic-item-crafting`, `training`, `magic-item-purchase`, `change-subclass`, `laboratory-alchemy`, `construct-crafting` | Шесть явно требующих доработки, automation absent |
| Downtime `blocked` | `crime`, `spread-rumors`, `change-class`, `buy-magic-components`, `search-magic-components`, `gather-rumors`, `scientific-lectures`, `invention-exhibition`, `charity`, `racing` | Десять явно заблокированных/not implemented, automation absent |
| Downtime `partial` notes | `craft`, `firearm-crafting`, `firearm-development`, `profession-work`, `rest`, `research`, `gambling`, `fighting-tournament`, `carousing`, `long-project` | Все 10 ID и их `automationNotes/descriptionHtml` просмотрены; DC, rewards, resources или narrative consequences остаются GM |
| Background `manualNotes` и report warnings | Все 160 records; `backgrounds-v012-report.json` содержит 265 warnings: 111 «нет structured field», 105 «только название без mechanics», 49 «equipment оставлено free text» | Парсинг количества полон (33/45/45/37 по уровням); limitation явная, поэтому partial, а не silently complete |
| State root/per-entry notes | 4 root notes; 8 IDs `plane-water`, `plane-air`, `plane-earth`, `plane-fire`, `plane-elemental-chaos`, `plane-positive-energy`, `plane-negative-energy`, `undescribed-lands` | Provenance/PDF/fallback limitations; сами state Items классифицированы N/A, не automation gap |
| Magic explicit manual definitions | `жемчужина-силы` — `coverage:"manual"`; пять `кольцо-характеристики-*` — `coverage:"manual-choice"`; `magic-items-compendium.js:200-252` | Explicit absent choice/resource mechanism; включены в 646 absent |
| Barbarian placeholders | 11 descriptions, refs AU-002 | Не manual choice, а повреждённая незавершённость published content |
| Storage `manualRows/manualCoins`, durability `source:"manual"`, implant `reason:"manual"` | storage/durability/implant schema; `inventory-service.js:4718,4726,6490`, `implant-service.js:354` | Provenance/override/reconciliation enum, не deferred implementation |
| Global event `trigger.type:"manual"` | `global-events-service.js:153,212,641,684,1236,1264,1279` | Поддерживаемый ручной тип запуска события, не кодовый пробел |
| Trader «ручная сверка» | `trader-service.js:467,489,492` | Намеренное terminal reconciliation state для ambiguous outcome |
| README/templates manual labels | README world-reconciliation guidance и UI labels в inventory/storage/trader/global-event templates | Пользовательская операция/режим интерфейса; не скрытая TODO |
| `TODO`, `FIXME`, `stub`, `not implemented`, `не реализовано`, `нужна доработка` вне перечисленных structured catalogs | relevant shipped runtime scope | Новых actionable markers не найдено; совпадения в tools/schema/text были классифицированы строками выше, а не автоматически признаны дефектами |

Таким образом все explicit markers либо привязаны к конкретной incomplete/partial entity-группе, либо объяснены как поддерживаемая manual семантика. Необработанных marker hits не осталось.

## 5. Пробелы тестов и создающие ложную уверенность проверки

| Finding / поверхность | Что проверяется сейчас | Чего материально не хватает |
|---|---|---|
| ST-001 lootgen self-claim | happy-path UI/API order и standalone `LootClaimService` | lost request/result, повтор клика, target-success/source-failure, terminal receipt |
| ST-002 Hero Doll | один snapshot test | любые mutations; invalid slot before transfer; concurrency; failure между Actor writes |
| ST-003 calendar command | inactive-GM route с одной группой | authorized group B при GM active group A; group identity на каждой transition stage |
| ST-004 public writers | repositories/queues в одном module instance | два GM instances и обязательный inactive-GM typed routing; cross-client last-write-wins |
| ST-005 party drag | delayed success и explicit `ok:false` rollback | no active GM после target commit; response никогда не приходит; reload/failover recovery |
| ST-007 item upgrades | последовательные install/remove/capacity happy paths | два co-owner, последний slot, каждый intermediate write failure, orphan reconciliation |
| ST-008 travel | повтор одного идентичного stale replacement не списывает fuel дважды | два разных stale operations; потеря progress/speed; compensation уже списанного fuel |
| AU-001 Universal Belt | sequential validation/success | simultaneous drops/purchases и injected update/setFlag failures |
| ST-009 Global Events | coordinator mocks вызывают callback; отдельного service suite нет | UTF-8 literals, template import, tag-to-shipped-good matching, multiwriter behavior |
| AU-002 Barbarian content | builder/data-shape coverage | invariant, запрещающий `?{3,}` и иной encoding damage в published descriptions |
| AU-003 races | metadata/activity shape и отдельные handlers | behavioral assertion каждого distinct promise; generic prompt не должен считаться full |
| AU-004 Watcher Shield | test требует присутствие `flags.midi-qol.*` | минимальная supported install без MIDI и реальный native roll outcome |
| AU-005 explosives | gear tests сохраняют structured flags | usable activity/template/save/damage/status/delay behavior |
| CO-001 Python tooling | Node test утверждает, что старый renderer obsolete | сам tracked Python test всё ещё импортирует удалённый module |
| Composition/lifecycle | многие tests читают source regex или подавляют `initialize()` | полноценная, но всё ещё статическая contract fixture для public API → route → owner; live Foundry сознательно вне scope |

Зелёные **3 040/3 040** Node tests поэтому не опровергают findings: все P1 используют межклиентный, потерянный-message либо intermediate-failure сценарий, отсутствующий в соответствующем suite.

## 6. Требует дополнительной проверки

Ни один пункт этого раздела не считается подтверждённым дефектом.

1. `scripts/data/transport-instance-service.js:225-335`: обычные rejected writes компенсируются и тестируются, но process/browser crash после world Actor create и до `catch` теоретически оставляет orphan. Нужен доказанный Foundry reconnect/startup reconciliation contract или failure-injection trace.
2. `scripts/data/hero-doll-service.js:107-116`: `unsetFlag` → rejected `setFlag` способен стереть doll state. Это дополнительное evidence ST-002, но отдельную частоту/восстановление можно подтвердить только targeted write-failure fixture.
3. Public economy methods без explicit auth доступны через опубликованный API; обычного player UI route к ряду из них не найдено. Прямой console/payload abuse исключён условием аудита, поэтому отдельного authorization finding нет.
4. Один nonparty storage claim не передаёт mutation ID непосредственно в `StorageService.claim`, однако durable target/source markers выглядят достаточными. Нужен воспроизводимый divergence trace, прежде чем объявлять дефект.
5. `sm-airship 0.1.9` заявляет verified Foundry 12, тогда как мир — Foundry 13; `Sequencer 4.2.3`, Tidy `13.3.0`, libWrapper `1.13.5.1` заявляют verified 14. Локальные adapters и static tests не выявили несовместимости, но без запуска Foundry нельзя подтвердить UI/runtime compatibility.
6. `scripts/city-map-production/**` зависит от внешнего asset root/ImageMagick; среда и визуальный результат не проверялись. Это limitation, не finding.
7. `docs/rebreya-module-architecture.html` — generated snapshot и не использовался как доказательство без проверки `sourceCommit`; актуальный source/паспорт имели приоритет.

## 7. Манифест покрытия

### 7.1. Владельцы второго прохода

| Primary owner | Непересекающаяся область | Результат |
|---|---|---|
| State / transactions / sockets | `scripts/application/**`, `scripts/features/trading/**`, `scripts/infrastructure/foundry/**`, `scripts/engine/**`, `scripts/rest/**`; stateful regions `scripts/data/**`; inventory/storage/downtime/transaction integrations | все files/routes покрыты; ST-001…ST-009 (кроме automation IDs) |
| Automation / integrations / content | `scripts/combat/**`, `scripts/automation/**`, `scripts/cosmology/**`; оставшиеся `scripts/integrations/**` и compendium/content builders; все mechanical catalogs | все catalog partitions и local integration contracts покрыты; AU-001…AU-005 |
| Composition / hooks / API / UI / tests | root entrypoints, `scripts/main.js`, `scripts/hooks.js`, `scripts/ui/**`, `scripts/ui.js`, `templates/**`, `styles/**`, `lang/**`, assets/tooling и все tests | lifecycle/API/UI/test ledger покрыт; CO-001…CO-002 |
| Controller | Git/baseline, global manifest, world-pack inventory, межслойные seams, independent P1 validation и deduplication | все P1 повторно проверены по exact call path и focused tests |

### 7.2. Репозиторный инвентарь

На commit учтён **3 791 tracked file**: 266 JS, 249 MJS, 42 JSON, 25 HBS, 2 CSS, 6 Python, 11 PowerShell, 189 Markdown, 3 HTML, 8 PDF, 3 XLSX, 4 TXT, 2 924 WebP, 56 PNG, 1 SVG, 1 MP3 и `.gitignore`.

| Area | Покрытие |
|---|---|
| `module.json`, entrypoints | manifest и все 48 `scripts/main-*.js`; только `main-1.4.162.js` достижим из текущего manifest, 47 historical forwarders не входят в current load graph |
| `scripts/` root | 53 direct files, включая единственный composition root, constants/hooks/ui и forwarders |
| Application | все 5 файлов; coordinator, public read model, loot claim, ingress planner, durable journal |
| Automation | единственный `feat-choice-service.js` |
| City-map production | 7 scripts + 1 test runner; external dependencies зафиксированы limitation |
| Combat | все 35 files и центральный `hooks.js`; attack/status/reaction/race/class/craftsman/implant/spell/environment services |
| Cosmology | `mechanus-rolls.js`, setting/socket/call surface |
| Data/domain | все 93 files; крупные owners проверены method/call-site ranges, compendium builders — по entity partitions |
| Engine | все 3 files: economy/selectors/trader |
| Trading | все 5 `scripts/features/trading/**`; purchase/sale/rollback/reconciliation/UI lifecycle |
| Infrastructure | 4 Foundry + 1 UI files; active GM, typed bus, group/trader repositories, UI refresh |
| Integrations | все 39 files; stateful subset у state owner, остальные у automation owner; seams контроллером |
| Legacy/rest/shared | по 1 file в каждой области; reachability/contracts проверены |
| UI | 21 `scripts/ui/**` + `scripts/ui.js`; 14 application windows/helpers и overlay/dialog paths |
| Templates/styles/lang | все 25 HBS, 2 CSS, 1 locale JSON; action names сопоставлены с handlers |
| Assets | 300 city images; 5 travel layers; storage furniture 22/piles 17/coins 4/chests 5; UI 4 + SVG; `templates/icons/**` 2 557 files механически инвентаризированы |
| Root/data/content | все 25 `data/*`, `magicItem.js`, 5 feat-pack artifacts и compendium source mirrors; large binary sources использованы только точечно |
| Tools | все 36 tracked tool files распределены по architecture, equipment import, content generation и asset production; runtime production graph от них отделён |
| Tests | все 235 tracked test-area files, включая 221 `*.test.mjs`, 13 JSON fixtures и 1 Python test; подробный ledger ниже |
| World copy | `world.json` и 17 pack directories; top-level documents всех паков посчитаны на временной копии LevelDB, original world не менялся |

### 7.3. Public surfaces, hooks, sockets, settings и integrations

| Поверхность | Что именно учтено |
|---|---|
| Lifecycle | `init`, `setup`, `ready` в `scripts/main.js:6734-7014`; API публикуется как `game.rebreyaMain` и module API |
| Settings | 28 registrations: 11 configurable и 17 hidden/state, включая durability mutation journal |
| Typed sockets | 30 direct `socketCommandBus.register` sites (29 literal + inventory-organization helper), а также delegated craftsman gadget, spell instance, summon lifecycle и transport commands; validators/authorize/execute проверены |
| Legacy sockets | lootgen, downtime, trader metadata/audit, inventory source depletion и EffectMacro compatibility; active-GM gates/correlation рассмотрены по группам |
| Public API groups | model/windows; economy/events/reference; groups/inventory/travel/craft/downtime/calendar; trader/loot/storage; combat/cosmology; README методы сопоставлены с owner methods |
| Core/local hooks | 3 lifecycle; 8 `scripts/hooks.js`; 3 lootgen-chat registrations; feat-choice create/update/delete |
| Combat hooks | actor/item/effect/token/combat, dnd5e activity/roll/damage/rest и MIDI workflow groups в `scripts/combat/hooks.js` |
| Integration hooks | durability, dnd5e sheets, item upgrades, implants, spell/craftsman/summon, inventory/storage/transport drops, long rest, SmallTime, EffectMacro, magic weapon, ration, travel map |
| Required integration | statuscounter `3.0.4`; `flags.statuscounter.value` contract и current status service совместимы |
| dnd5e | local `5.2.5`; activity/roll/damage/summon/rest/drop contracts сопоставлены с compiled source |
| Optional adapters | MIDI-QOL `13.0.61`, DAE `13.0.27`, EffectMacro `13.0.3`, SmallTime `2.0.4`, SM Airship `0.1.9`, Forien Quest Log `0.9.0`, Tidy `13.3.0`, libWrapper `1.13.5.1`, Sequencer `4.2.3`, BG3 Hotbar/Rebreya Quest integration surfaces |
| Repositories/coordinators | WorldMutationCoordinator, durable journal, group/trader repositories, EconomyRepository, global-event state, storage repositories/services, calendar transition, trade transactions, UI refresh |

### 7.4. Test ledger: все 221 `tests/*.test.mjs`

Имя файла задаёт заявленное owner behavior. Распределение взаимно однозначно: **state/operations 106 + automation/compatibility 80 + composition/call surfaces 35 = 221**, duplicates 0, omissions 0.

**State / operations (106).** `builtin-storage-actor-service.test.mjs`; `builtin-storage-presets.test.mjs`; `calendar-service.test.mjs`; `calendar-transition-coordinator.test.mjs`; `character-downtime-service.test.mjs`; `city-normalizer.test.mjs`; `city-presentation-overrides.test.mjs`; `corpse-storage-materializer.test.mjs`; `craft-downtime-service.test.mjs`; `craft-project-processor.test.mjs`; `crafting-rules.test.mjs`; `crafting-service.test.mjs`; `downtime-compendium.test.mjs`; `downtime-scheduler.test.mjs`; `downtime-service.test.mjs`; `durability-hooks.test.mjs`; `durability-outcome-dialog.test.mjs`; `durability-rules.test.mjs`; `durability-service.test.mjs`; `durable-mutation-journal.test.mjs`; `economy-city-connections.test.mjs`; `equipment-import-base-gear.test.mjs`; `equipment-import-cli.test.mjs`; `equipment-import-diff.test.mjs`; `equipment-import-gear-profiles.test.mjs`; `equipment-import-generated-data.test.mjs`; `equipment-import-google-client.test.mjs`; `equipment-import-magic-items.test.mjs`; `equipment-import-overrides.test.mjs`; `equipment-import-parsers.test.mjs`; `equipment-import-pipeline.test.mjs`; `equipment-import-secondary-catalogs.test.mjs`; `equipment-import-serialization.test.mjs`; `equipment-import-snapshot.test.mjs`; `equipment-import-transaction.test.mjs`; `equipment-import-weapons.test.mjs`; `gear-catalog-sync.test.mjs`; `gear-import-script.test.mjs`; `group-command-dispatch.test.mjs`; `group-context-service.test.mjs`; `group-inventory-migration.test.mjs`; `group-state-repository.test.mjs`; `inventory-folder-socket.test.mjs`; `inventory-folder-tree.test.mjs`; `inventory-ingress-descriptor.test.mjs`; `inventory-ingress-planner.test.mjs`; `inventory-ingress-rules.test.mjs`; `inventory-mutation-recovery.test.mjs`; `inventory-sync-hooks.test.mjs`; `loot-claim-service.test.mjs`; `lootgen-durability.test.mjs`; `lootgen-generator.test.mjs`; `lootgen-multiple-appearance.test.mjs`; `lootgen-template-catalog.test.mjs`; `managed-compendium-sync.test.mjs`; `map-object-token-macro.test.mjs`; `map-object-token-service.test.mjs`; `material-catalog-sync.test.mjs`; `native-durability-hooks.test.mjs`; `native-durability-routing.test.mjs`; `native-object-durability-service.test.mjs`; `public-economy-read-model.test.mjs`; `quest-log-service.test.mjs`; `storage-access.test.mjs`; `storage-app.test.mjs`; `storage-asset.test.mjs`; `storage-container-hierarchy.test.mjs`; `storage-container-item-service.test.mjs`; `storage-container-snapshot.test.mjs`; `storage-deposit-source.test.mjs`; `storage-ground-pile-service.test.mjs`; `storage-journal-reader.test.mjs`; `storage-journal-viewer.test.mjs`; `storage-main-registration.test.mjs`; `storage-module-api.test.mjs`; `storage-object-kind.test.mjs`; `storage-open-sound-service.test.mjs`; `storage-pile-presentation.test.mjs`; `storage-service.test.mjs`; `storage-socket.test.mjs`; `storage-token-drop.test.mjs`; `storage-token-hooks.test.mjs`; `storage-token-overlay.test.mjs`; `storage-transfer-chat.test.mjs`; `storage-transfer-drop.test.mjs`; `storage-transfer-ui.test.mjs`; `trade-purchase-transaction.test.mjs`; `trade-rollback-transaction.test.mjs`; `trade-sale-transaction.test.mjs`; `trade-transaction-model.test.mjs`; `trader-command-dispatch.test.mjs`; `trader-foundry-trade-operations.test.mjs`; `trader-service.test.mjs`; `trader-state-repository.test.mjs`; `trader-ui-transaction-lifecycle.test.mjs`; `transport-actor-builder.test.mjs`; `transport-compendium.test.mjs`; `transport-fuel-consumption.test.mjs`; `transport-fuel-item.test.mjs`; `transport-fuel-service.test.mjs`; `transport-group-drop.test.mjs`; `transport-instance-service.test.mjs`; `transport-instance-socket.test.mjs`; `travel-map-service.test.mjs`; `travel-service.test.mjs`; `world-mutation-infrastructure.test.mjs`.

**Automation / compatibility (80).** `ammunition-compatibility.test.mjs`; `attack-roll-boost-service.test.mjs`; `bardic-inspiration-compat-service.test.mjs`; `combat-attack-service.test.mjs`; `combat-status.test.mjs`; `cosmology-mechanus-rolls.test.mjs`; `craftsman-archetype-sheet.test.mjs`; `craftsman-construct-compendium.test.mjs`; `craftsman-constructor-activity.test.mjs`; `craftsman-constructor-service.test.mjs`; `craftsman-gadget-definitions.test.mjs`; `craftsman-gadget-hooks.test.mjs`; `craftsman-gadget-item-data.test.mjs`; `craftsman-gadget-item-type.test.mjs`; `craftsman-gadget-service.test.mjs`; `craftsman-gadget-socket.test.mjs`; `craftsman-gadget-zone-service.test.mjs`; `craftsman-multi-subclass.test.mjs`; `craftsman-subclass-advancements.test.mjs`; `craftsman-subclass-tracks.test.mjs`; `craftsman-vehicle-service.test.mjs`; `curse-eater-automation-service.test.mjs`; `dnd5e-sheet-downtime-tab.test.mjs`; `effectmacro-compat.test.mjs`; `elemental-adept-automation-service.test.mjs`; `environment-automation-service.test.mjs`; `feat-choice-automation.test.mjs`; `fighter-automation-service.test.mjs`; `giant-tribe-advancement.test.mjs`; `held-items.test.mjs`; `held-shield-ac.test.mjs`; `hero-doll-service.test.mjs`; `implant-automation-registry.test.mjs`; `implant-automation-service.test.mjs`; `implant-hooks.test.mjs`; `implant-item-sheet.test.mjs`; `implant-service.test.mjs`; `implant-sheet-integration.test.mjs`; `implants-catalog.test.mjs`; `item-sheet-branding.test.mjs`; `item-upgrade-service.test.mjs`; `libwrapper-patching.test.mjs`; `long-rest-hooks.test.mjs`; `long-rest-pipeline-service.test.mjs`; `long-rest-provider-registration.test.mjs`; `magic-weapon-template.test.mjs`; `melfs-minute-meteors-item.test.mjs`; `melfs-minute-meteors-recipe.test.mjs`; `paladin-automation-service.test.mjs`; `paladin-dogma-automation-service.test.mjs`; `paladin-dogmas.test.mjs`; `performer-automation-service.test.mjs`; `race-automation-service.test.mjs`; `races-compendium.test.mjs`; `races-data.test.mjs`; `radial-status-effects.test.mjs`; `ration-food-conversion-hook.test.mjs`; `reaction-capability-index.test.mjs`; `reaction-dialog-ownership.test.mjs`; `reaction-queue-service.test.mjs`; `rebreya-quest-log-integration.test.mjs`; `rogue-automation-service.test.mjs`; `rune-knight-automation-service.test.mjs`; `security.test.mjs`; `size-automation-service.test.mjs`; `sm-airship-compat.test.mjs`; `smalltime-compat.test.mjs`; `sorcerer-automation-service.test.mjs`; `spell-automation-entrypoints.test.mjs`; `spell-automation-hook-bridge.test.mjs`; `spell-automation-hooks.test.mjs`; `spell-automation-registry.test.mjs`; `spell-automation-service.test.mjs`; `spell-instance-operation-lease.test.mjs`; `spell-instance-runtime.test.mjs`; `spell-instance-socket.test.mjs`; `summon-lifecycle-runtime.test.mjs`; `summon-lifecycle-socket.test.mjs`; `transform-cleanup-compat.test.mjs`; `universal-belt.test.mjs`.

**Composition / call surfaces (35).** `architecture-map-generator.test.mjs`; `background-refresh-focus.test.mjs`; `backgrounds-compendium.test.mjs`; `bg3-hotbar-compat.test.mjs`; `city-public-assets.test.mjs`; `city-public-ui.test.mjs`; `classes-compendium.test.mjs`; `compendium-utils.test.mjs`; `economy-public-ui.test.mjs`; `feats-compendium.test.mjs`; `foundry-values.test.mjs`; `gear-compendium.test.mjs`; `groups-app.test.mjs`; `inventory-app-context.test.mjs`; `inventory-header-motion.test.mjs`; `lootgen-app-context.test.mjs`; `lootgen-chat.test.mjs`; `lootgen-type-filters.test.mjs`; `magic-items-compendium.test.mjs`; `main-composition-root.test.mjs`; `main-notifications.test.mjs`; `markdown-description.test.mjs`; `materials-compendium.test.mjs`; `materials-data.test.mjs`; `module-manifest.test.mjs`; `party-inventory-crest.test.mjs`; `quest-log-ui.test.mjs`; `spells-compendium.test.mjs`; `states-compendium.test.mjs`; `style-theme.test.mjs`; `transport-vehicle-sheet.test.mjs`; `travel-map-hooks.test.mjs`; `travel-map-integration.test.mjs`; `travel-parallax-assets.test.mjs`; `ui-refresh-coordinator.test.mjs`.

### 7.5. Статические ограничения

- Foundry и браузер не запускались; DOM/layout, animation, permissions prompts и real socket timing не наблюдались.
- Мир использован только для `world.json`, pack inventory и чтения копий LevelDB; world settings, Actor/ChatMessage state и пользовательские изменения не интерпретировались как доказательство дефекта.
- Восемь PDF, три XLSX и четыре TXT не читались целиком. Узкие primary-source ranges использовались только когда конкретная shipped entity требовала сверки; главным объектом были реально опубликованные JSON/Items.
- 2 924 WebP, 56 PNG, SVG и MP3 проверены как manifest/path inventory, не семантически и не визуально.
- Official web documentation не понадобилась: installed Foundry/dnd5e/module source устанавливал используемые контракты.
- Static audit доказывает control-flow failure paths, но не оценивает их production frequency.

## 8. Выполненные проверки

Все проверки относятся к проверенному source commit `3e0bdc0f374501e165dbcf9fdcc359c1dded607f`; единственное репозиторное изменение после них — этот Markdown-отчёт.

| Проверка | Результат |
|---|---|
| `git status --short --branch`; `git branch --show-current`; `git fetch origin` | исходно чистая `lich_branch`; fetch успешен |
| `git rev-list --left-right --count HEAD...origin/main` | `170 0`: проверенный HEAD не отстаёт от `origin/main` |
| `git rev-list --left-right --count HEAD...origin/lich_branch` | `0 0`: локальная и remote `lich_branch` совпадали до отчёта |
| `node --test tests/*.test.mjs` | **3 040 passed, 0 failed, 0 skipped**, 33.084 s |
| focused selection ниже | **436 passed, 0 failed, 0 skipped**, 4.698 s |
| `node --check` для всех tracked `*.js`/`*.mjs` | **515 checked, 0 failed** |
| UTF-8 `ConvertFrom-Json` для всех tracked `*.json` | **42 parsed, 0 failed** |
| `python -m pytest tests/test_travel_landscape_renderer.py` | **failed до collection:** `No module named pytest` |
| `python tests/test_travel_landscape_renderer.py` | **failed:** `ModuleNotFoundError: No module named 'render_travel_landscapes'`; это evidence CO-001 |
| `git diff --check` для итогового отчёта | passed, ошибок whitespace нет |

Focused command, выбранный по владельцам конкретных findings:

```powershell
node --test tests/lootgen-chat.test.mjs tests/loot-claim-service.test.mjs tests/hero-doll-service.test.mjs tests/calendar-transition-coordinator.test.mjs tests/group-command-dispatch.test.mjs tests/group-context-service.test.mjs tests/group-state-repository.test.mjs tests/downtime-service.test.mjs tests/public-economy-read-model.test.mjs tests/trader-command-dispatch.test.mjs tests/trader-service.test.mjs tests/inventory-sync-hooks.test.mjs tests/inventory-mutation-recovery.test.mjs tests/item-upgrade-service.test.mjs tests/travel-service.test.mjs tests/transport-fuel-consumption.test.mjs tests/universal-belt.test.mjs tests/world-mutation-infrastructure.test.mjs tests/race-automation-service.test.mjs tests/races-data.test.mjs tests/magic-items-compendium.test.mjs tests/gear-compendium.test.mjs tests/travel-parallax-assets.test.mjs
```

Команды механических проверок:

```powershell
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json | Out-Null }
```

Зелёная suite не опровергает findings: каждый P1 основан на непокрытом failure/concurrency/multi-client path, а соответствующий пробел теста указан непосредственно в находке.

## 9. Приоритет исправлений

Исправления следует выполнять отдельными задачами и commits, не смешивая state protocol с массовым content repair.

1. **ST-003:** немедленно привязать calendar transition к авторизованному `groupActorId`; это самый узкий путь записи в чужую группу и хороший первый regression test.
2. **ST-004:** ввести единый active-GM mutation gateway для всех public world writers; затем мигрировать writers по одному owner с двумя simulated clients.
3. **ST-001 и ST-005:** унифицировать loot/shared-inventory transfers вокруг typed exactly-once protocol, durable receipts и recovery после lost result/reload.
4. **ST-002, AU-001 и ST-007:** создать общий actor-scoped transaction pattern для межакторных Item moves, currency/flag writes и bidirectional links; сначала validate, затем serializable commit/compensation.
5. **ST-008:** заменить full travel replacement на patch либо revision/CAS и включить fuel в тот же durable transition.
6. **ST-006:** добавить compensation/reconciliation для Actor managed flag и group registry.
7. **ST-009, AU-002, AU-003, AU-004 и AU-005:** отдельными content/automation задачами исправить UTF-8 и placeholders, привести automation metadata к фактической механике, реализовать native/no-MIDI fallback и usable explosive activities.
8. **CO-001 и CO-002:** синхронизировать Python test/tool contract и документационные source paths; затем закрывать оставшийся intentional manual/incomplete backlog из раздела 4.

Для каждой реализации обязательны focused failure-path tests из соответствующей находки, полная проверка раздела 8 и обновление релевантного раздела `docs/function-passport.md` для любого нового, изменённого или удалённого метода. Этот audit не менял методы, поэтому паспорт намеренно оставлен без изменений.
