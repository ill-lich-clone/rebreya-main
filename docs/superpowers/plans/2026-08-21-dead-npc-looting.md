# Спецификация: лут существ с 0 HP

**Статус:** готово к отдельному этапу реализации

**Базовый commit исследования:** `98b8fb3` (`lich_branch`)

**Среда:** Foundry VTT 13, dnd5e, Rebreya Main, обязательный `statuscounter >= 3.0.4`

## 1. Наблюдаемый результат и границы

ЛКМ игрока или мастера по Scene Token обычного NPC с конечным числовым
`actor.system.attributes.hp.value <= 0` открывает существующий `StorageApp` Rebreya для этого токена.
Обычный NPC с HP выше нуля не становится storage target. Actor, уже помеченный
`flags.rebreya-main.storage.enabled === true`, продолжает использовать обычный storage lifecycle независимо
от HP и имеет приоритет над corpse-поведением.

Corpse-storage автоматически и ровно один раз получает только подтверждённые позиции из managed gear pack
`world.rebreya-gear`. Исходный NPC Actor и его embedded Items не изменяются. Новые app, repository, world Item,
storage command и отдельный lifecycle не создаются.

В эту задачу не входят:

- генерация случайного лута, валюты или предметов, отсутствующих у NPC;
- перенос черт, действий, заклинаний и natural attacks как исходных embedded Item;
- автоматическое удаление трупа, изменение Actor HP или очистка Actor inventory;
- изменение обычной механики storage, ground piles, containers и Lootgen вне необходимой точки расширения;
- live-проверка Foundry — её выполняет пользователь после реализации.

## 2. Подтверждённые владельцы

- `scripts/integrations/storage-token-hooks.js` — token `pointertap`, клиентский preflight и запуск Storage UI.
- `scripts/main.js` — composition root, `storage.open`, public storage API и создание `StorageApp`.
- `scripts/data/storage-command-service.js` — authoritative token resolution, sender authorization, visibility,
  same-scene и distance checks.
- `scripts/data/storage-service.js` — первый open, single-flight и запись authoritative storage-state.
- `flags.rebreya-main.storage` на Scene Token — authoritative token-scoped state. Это не Actor flag и не world
  setting.
- `scripts/data/gear-compendium.js`, `scripts/data/gear-document-ids.js`,
  `scripts/data/item-classification.js` и `scripts/data/ammunition-types.js` — managed gear identity и стабильные
  native base/subtype identifiers.
- `InventoryService.buildLootgenItemData()` — существующий путь получения очищенного embedded Item data из
  exact managed `world.rebreya-gear` document с нужным количеством и `equipped:false`.
- `DurabilityService.getOrBuildDurability()` и `markDurabilityBroken()` из `durability-rules.js` —
  non-mutating derive-path и native broken transition.
- `SocketCommandBus` и active-GM routing — transport sender validation, exact payload validation,
  request-id idempotency и выполнение privileged mutation только active GM.

Профильные разделы паспорта: 2 «Active GM, typed sockets и надёжные мутации», 8 «Хранилища,
контейнеры и piles на сцене», 14 «Прочность, разрушение и upgrades», 15 «Managed-компендиумы и каталоги».

## 3. Выбранная архитектура

Добавить один профильный materializer для corpse rows и подключить его как вариант **первого открытия**
существующего `StorageService`. `storage.open` остаётся единственной typed command. `StorageApp`, snapshot,
claim/deposit flow, token flag и access policy остаются теми же.

Отвергнутые варианты:

1. Отдельный corpse app/command/repository — создаёт второго владельца storage lifecycle и расходится с
   существующей авторизацией и claim semantics.
2. Предварительная запись rows в `StorageCommandService`, а затем обычный `open()` — делит одну логическую
   операцию на две записи и усложняет recovery и concurrency.
3. Клонирование embedded NPC Item по имени — переносит monster actions вместо gear и не доказывает наличие
   канонического аналога.

Рекомендуемая единица ответственности:

- новый `scripts/data/corpse-storage-materializer.js` классифицирует dead NPC, разрешает canonical gear
  identity и строит detached storage rows;
- `StorageService.#openOnce()` выбирает обычный Lootgen generator или corpse materializer и одной записью
  сохраняет rows, marker и итоговый state;
- `StorageCommandService` и token hook только расширяют понятие допустимого open target, не реализуют
  materialization.

## 4. Data flow от ЛКМ до snapshot

1. `registerStorageTokenHooks()` привязывает тот же стабильный `pointertap` handler к marked storage token или
   обычному dead NPC token. Проверка повторяется при каждом клике, поэтому обработчик, привязанный до лечения,
   не открывает ожившего NPC.
2. Для corpse target ЛКМ сразу вызывает существующий `moduleApi.openStorageApp()`; отдельное configure action
   не показывается. Marked storage сохраняет нынешнее action overlay и GM configure action без изменений.
3. GM передаёт пустой `characterTokenUuid`. Player preflight повторно использует
   `preflightStorageAccess()` и передаёт UUID выбранного owned character token.
4. `openStorageApp()` сначала ждёт `openStorage()`. Active GM выполняет `StorageCommandService.open()` прямо;
   player отправляет неизменённый exact payload `{ tokenUuid, characterTokenUuid }` через `storage.open`.
5. `SocketCommandBus` проверяет authenticated transport sender, envelope, payload и реального Foundry User.
   Выполнение происходит только на active GM.
6. `StorageCommandService.#resolveAccess()` заново разрешает Scene Token по UUID и принимает либо marked
   Rebreya storage, либо обычного NPC с текущим HP `<= 0`. Для player без изменений проверяются owned
   character, одна сцена, видимость и расстояние не больше 5 футов. GM использует штатный bypass.
7. `StorageService.open()` использует существующий single-flight key по token UUID. Для первого corpse open
   materializer читает embedded Items, разрешает каждый в exact canonical gear document, строит canonical
   item data и применяет broken transition к body armor.
8. После повторной проверки HP `StorageService` выполняет один `TokenDocument.update()` с generated rows,
   `corpseMaterialization` marker и состоянием `opened` либо `empty`. Actor и embedded Items не обновляются.
9. `storage.open` возвращает нынешний компактный acknowledgement; rows не отправляются socket response.
10. Только после успешного open `openStorageApp()` создаёт/переиспользует существующий `StorageApp`.
    `_prepareContext()` вызывает `getStorageSnapshot()`, который читает token flag, скрывает claimed rows и
    отображает обычную storage grid.

Все claim/deposit/read operations открытого corpse-storage продолжают идти через существующие storage APIs и
повторный `#resolveAccess()`. Если NPC ожил, новые open и claim mutations отвергаются, но token-scoped state не
удаляется.

## 5. Eligibility corpse target

Corpse target должен одновременно удовлетворять условиям:

- это Scene Token с доступным Actor;
- Actor имеет `type === "npc"`;
- Actor не является marked Rebreya storage;
- `Number(actor.system.attributes.hp.value)` конечен и `<= 0`.

Отсутствующий, `null`, `NaN` или бесконечный HP не считается мёртвым. Player не может заявить `corpse:true` в
payload: тип target всегда вычисляет active GM по live document. Проверка делается в hook только как UX
preflight и обязательно повторяется authoritative service перед mutation и непосредственно перед token write.

Living NPC с HP `> 0` не получает corpse click handler. Если handler остался после изменения HP, он повторно
проверяет eligibility и ничего не открывает.

## 6. Canonical matching

### 6.1 Общий принцип

Материализуется не копия monster action, а новый detached clone **канонического managed gear document**.
Canonical document допустим только если он принадлежит `world.rebreya-gear` и имеет одновременно:

- `flags.rebreya-main.managed === true`;
- `flags.rebreya-main.sourceType === "gear"`;
- непустой `flags.rebreya-main.gearId`;
- UUID/pack identity, соответствующий `Compendium.world.rebreya-gear.Item.*`;
- не является `sourceType:"gearContainerContent"`.

Если pack недоступен, exact document не найден, identity конфликтует или match неоднозначен, item не
материализуется. Generic поиск по одному отображаемому имени запрещён.

### 6.2 Порядок разрешения identity

Resolver применяет стратегии строго по порядку и после каждой стратегии валидирует найденный managed document:

1. **Rebreya stable flags.** Embedded Item с `sourceType:"gear"` разрешается по `gearId`/`sourceId`. Если оба
   заданы, они обязаны совпадать; конфликт означает no match.
2. **Exact Rebreya source UUID.** `_stats.compendiumSource`, `flags.core.sourceId` или
   `flags.dnd5e.sourceId`, указывающий ровно на `Compendium.world.rebreya-gear.Item.<documentId>`, разрешается
   и валидируется по managed flags. Произвольный world/third-party UUID сам по себе не является match.
3. **Native stable equipment key.** Для `weapon`/`equipment` используется непустой
   `system.type.baseItem`; для `consumable` ammunition — точная пара
   `system.type.value === "ammo"` + `system.type.subtype`. Ключ должен соответствовать ровно одному canonical
   gear document; zero/multiple matches fail closed. Разрешённый source document из UUID можно использовать
   как источник этих структурных полей.
4. **Документированный legacy fallback для NPC weapon actions.** Некоторые dnd5e monster weapon actions
   имеют `system.type.value === "natural"` даже когда изображают переносимое обычное оружие. Для них допустим
   только exact alias из существующего реестра ordinary weapons в `item-classification.js`, причём Item должен
   иметь стабильное monster-source evidence (`flags.srd5e.hash` либо embedded-Item compendium source). Resolver
   возвращает закреплённый реестром `gearId`, после чего снова требует exact managed gear document. Это
   единственный name-based fallback; произвольная нормализация имени по всему pack запрещена.

Fallback №4 нужен для weapon actions Чемпиона и не допускает «Укус»/«Коготь»: этих имён нет в ordinary weapon
registry, а наличие похожего treasure/monster-material row в `gear.json` не делает natural attack оружием.

### 6.3 Допустимые Item types и количество

До matching безусловно исключаются `feat`, `spell`, class/subclass features и прочие action/trait documents.
Кандидатами являются только item types, которые exact managed gear document может канонически представить
(`weapon`, `equipment`, `consumable`, `tool`, `loot` и поддерживаемый gear container). Natural weapon action
проходит только через узкий fallback №4.

Количество берётся из исходного embedded Item `system.quantity` и должно быть положительным safe integer;
отсутствующее количество означает `1`. Canonical pack quantity не заменяет исходное. Поэтому NPC stack
«Стрелы» с quantity `20` создаёт одну storage row с quantity `20` и `itemData.system.quantity === 20`.

`InventoryService.buildLootgenItemData({ sourceType:"gear", sourceId:gearId,
sourceDocumentId:canonicalDocument.id, quantity })` используется для canonical clone. Он повторно валидирует
managed pack source, очищает document-only поля, ставит `equipped:false`, сохраняет стабильные
`sourceType/sourceId/gearId` и не изменяет source document.

Row ID должен быть детерминирован из corpse marker version, embedded Item ID и gear ID. Это дополнительная
защита от дублей и не заменяет one-time marker. Разные embedded stacks остаются разными rows; partial quantity
учитывается существующим storage claim contract.

## 7. Broken armor contract

Body armor определяется по существующей native семантике durability hooks: canonical item имеет
`type === "equipment"` и непустой `system.type.value`, отличный от `shield`. Для каждого такого item:

1. `DurabilityService.getOrBuildDurability(itemData, { sourceType:"gear", sourceId:gearId })` строит detached
   initial flag без `item.update()`.
2. Новый узкий pure helper durability owner применяет `markDurabilityBroken(initialFlag)` и добавляет timestamp
   тем же service clock contract, что `breakItem()`.
3. В row записывается только returned `nextFlag`; обязательны `state:"broken"`, `breakStage:1` и
   `hp.value:0` при сохранённом `hp.max`.

Нельзя вручную поставить только `flags.rebreya-main.durability.state`, вызывать `breakItem()` на исходном NPC
Item или менять `system.equipped` исходного Item. Если canonical armor matched, но native broken flag построить
не удалось, всё первое открытие завершается ошибкой до token write: intact armor не материализуется и partial
corpse-state не сохраняется.

## 8. Token-scoped state и one-time marker

`buildStorageTokenState()` расширяется полем:

```js
corpseMaterialization: {
  version: 1,
  status: "complete",
  sourceActorUuid: "...",
  sourceActorId: "..."
}
```

Marker и `generatedRows` записываются одной patch-операцией в `flags.rebreya-main.storage` Scene Token. В
persisted state нет `pending`: до успешной атомарной записи marker отсутствует, после неё он `complete`.
Marker не включается в player snapshot и не даёт новых прав.

`status:"complete"` является окончательным запретом автоматической повторной materialization, даже если
socket acknowledgement потерян или новый active GM создаёт новый service instance. `state !== "unopened"`
сохраняет прежнюю storage идемпотентность; marker — дополнительный corpse-specific invariant.

Итоговый state первой записи:

- хотя бы одна eligible row: `state:"opened"`, `displayMode:"opened"`;
- ни одной eligible row: `state:"empty"`, `displayMode:"empty"`, marker всё равно `complete`.

`generatedCoins` всегда пуст. Corpse rows принадлежат `generatedRows`; `manualRows` и существующие deposits не
перезаписываются. Все последующие mutations обязаны сохранять marker через нынешний `{ ...current }` contract.

## 9. Concurrency и idempotency

- Все player opens приходят к одному active GM через `storage.open`.
- Повтор того же socket request ID уже дедуплицирует `SocketCommandBus`.
- Разные request IDs и одновременные игроки сходятся в существующий `StorageService.openTasks` по exact token
  UUID; materializer выполняется один раз.
- Сначала строится detached result, затем rows + marker + state записываются одним token update. Ошибка lookup,
  durability или update оставляет corpse нематериализованным и допускает безопасный retry.
- Потерянный acknowledgement после успешной записи безопасен: retry читает `complete` marker и возвращает
  текущее состояние без повторного чтения Actor Items.
- После active-GM failover новый instance читает token flag и не зависит от прежнего in-memory cache.

Отдельный mutation journal не нужен: операция меняет один TokenDocument одной patch-записью и не расходует
Actor Item. In-memory single-flight не считается authoritative marker.

## 10. Linked и unlinked tokens

Для linked tokens несколько Scene Tokens могут ссылаться на один Actor и один набор embedded Items. Каждый
token получает собственный `flags.rebreya-main.storage`, собственный marker, rows, claimed IDs и остатки.
Лут одного token не влияет на другой token и не обновляет общий Actor.

Для unlinked tokens materializer читает synthetic `token.actor` конкретного TokenDocument. State всё равно
пишется на TokenDocument, а не на synthetic Actor delta и не на prototype Actor.

`sourceActorUuid/sourceActorId` в marker диагностические; они не являются storage key. Единственный key — Scene
Token UUID.

## 11. Уже разграбленное и частично разграбленное состояние

После materialization действуют нынешние storage rules:

- partial claim уменьшает `row.quantity` и `itemData.system.quantity` в token state;
- full claim добавляет row ID в `claimedRowIds`;
- последний claim переводит storage в `empty`;
- snapshot фильтрует claimed rows;
- повтор claim/duplicate mutation не выдаёт Item второй раз;
- deposits, если они сделаны через существующий storage UI, не снимают marker и не запускают materializer.

Повторное открытие никогда не перечитывает текущие Actor Items и не восстанавливает исходное количество.
Лечение и повторное падение того же Scene Token также не создаёт лут заново: marker остаётся на token. Обычные
corpse tokens не получают GM configure/reset action, а существующие GM configuration APIs продолжают требовать
marked storage Actor; поэтому штатный reset не превращается в способ автоматического respawn corpse loot.

Если Actor Items были изменены после первой materialization, ранее сохранённый corpse-state остаётся
authoritative. Это необходимо, чтобы забранный лут не появлялся повторно.

## 12. Обязательные примеры

### Тролль

Embedded natural actions «Укус» и «Коготь» не имеют допустимого ordinary weapon canonical identity. Traits и
Multiattack исключаются по type. Первая materialization сохраняет `generatedRows:[]`, пустые coins,
`corpseMaterialization.status:"complete"` и `state:"empty"`.

### Чемпион

Canonical resolver обязан получить ровно четыре gear IDs:

- `dvuruchnyy-mech` — existing ordinary-weapon legacy resolver для monster weapon action;
- `korotkiy-luk` — тот же ограниченный resolver;
- `laty` — exact native armor `baseItem:"plate"`;
- `strely-20` — exact ammunition subtype `arrow`.

Storage содержит ровно четыре rows. Количество стрел равно embedded quantity `20`. Clone `laty` имеет native
broken durability (`state:"broken"`, `breakStage:1`, `hp.value:0`) и `equipped:false`.

## 13. Ошибки и fail-closed правила

- Deadness/access error: command rejected before materialization.
- Missing gear pack or canonical document construction error: first open fails, token state не меняется.
- Unknown, ambiguous, conflicting or non-gear Item: только этот Item исключается.
- Armor durability derivation/transition error: весь first open fails before write.
- Token update error: marker отсутствует, retry разрешён.
- UI не получает source Actor Items, raw pack index или причины исключения; подробности можно писать только в
  GM-side debug/warn log без приватных payload.

## 14. План файлов будущей реализации

- Create `scripts/data/corpse-storage-materializer.js` — target predicate, canonical resolver, row builder.
- Modify `scripts/data/item-classification.js` — экспортировать узкий exact ordinary-weapon gear resolver для
  документированного legacy fallback, не общий поиск по имени.
- Modify `scripts/data/durability-service.js` — добавить pure broken-derivation method на базе
  `getOrBuildDurability()` + `markDurabilityBroken()`, без document mutation.
- Modify `scripts/data/storage-service.js` — сохранить marker в normalized state и вызвать corpse materializer
  внутри existing first-open single-flight.
- Modify `scripts/data/storage-command-service.js` — принимать dead NPC token в existing `#resolveAccess()`;
  access checks не дублировать.
- Modify `scripts/integrations/storage-token-hooks.js` — corpse pointer binding, runtime HP recheck и запуск
  existing `openStorageApp()`.
- Modify `scripts/main.js` — composition wiring и corpse-aware read-only snapshot resolution; administrative
  configure/reset methods должны по-прежнему требовать marked storage Actor.
- Create `tests/corpse-storage-materializer.test.mjs`; extend focused
  `storage-service.test.mjs`, `storage-socket.test.mjs`, `storage-token-hooks.test.mjs` и при необходимости
  `storage-main-registration.test.mjs`.
- Modify `docs/function-passport.md` sections 8, 14 and 15 for every new/changed method, signature, data flow,
  invariant and focused test. Section 2 changes only if typed command contract changes; по этой спецификации
  новый command/payload не нужен.

README меняется только если implementation делает новый public API; текущая спецификация публичный метод не
добавляет.

## 15. Focused tests и критерии готовности реализации

Обязательные focused tests:

1. Troll: `feat` и natural attacks отфильтрованы; rows пусты, marker complete, state empty.
2. Champion: ровно четыре canonical rows с gear IDs `dvuruchnyy-mech`, `korotkiy-luk`, `laty`, `strely-20`;
   arrows quantity и embedded quantity равны `20`.
3. Armor clone получает результат native broken transition: `state:"broken"`, `breakStage:1`, `hp.value:0`;
   исходный armor Item не обновляется.
4. Unknown, ambiguous, name-only non-legacy и non-gear Items исключены.
5. Sequential open, concurrent `Promise.all` open, duplicate socket request и разные request IDs не создают
   копии rows.
6. После full/partial claim повторный open не восстанавливает row или количество.
7. Empty corpse после повторного open остаётся empty и не запускает materializer.
8. Два linked token одного Actor получают независимые marker/rows/claim state; unlinked token использует свой
   synthetic Actor и token flag.
9. Player corpse open проходит существующие sender, ownership, scene, visibility и distance validations; invalid
   sender/character/far/hidden target rejected. GM открывает без character token.
10. Living NPC с HP `> 0` не получает corpse open; ранее привязанный pointer handler повторно проверяет HP.
11. Corpse app использует существующий `StorageApp`/snapshot; `storage.open` acknowledgement остаётся compact.
12. Профильные storage tests остаются зелёными.

На implementation-этапе сначала запускаются новые/focused tests, затем один полный набор проверок из
`AGENTS.md` перед commit. Live Foundry smoke test остаётся за пользователем.

Definition of done:

- все перечисленные focused tests проходят;
- Actor/embedded Items не имеют update/delete calls;
- authoritative mutation выполняется только active GM;
- на token существует одна атомарная complete materialization;
- claimed loot не появляется повторно;
- `docs/function-passport.md` отражает фактические методы и tests;
- `git diff --check`, JS syntax и JSON parsing проверки из `AGENTS.md` проходят перед implementation commit.
