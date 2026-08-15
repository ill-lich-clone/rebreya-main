# Rebreya Main

Модуль экономики, партийного состояния и автоматизаций Rebreya для Foundry VTT.

Этот README — техническая спецификация актуального runtime. Его задача — показать, где уже реализована нужная логика, чтобы следующая правка не создавала второй сервис, второй socket-протокол или ещё один вариант синхронизации компендиума.

## Совместимость и точка входа

- Module ID: `rebreya-main`.
- Версия: `1.4.112`.
- Foundry VTT: minimum/verified `13`.
- Основная система: `dnd5e`.
- Обязательная зависимость: `statuscounter >= 3.0.4`.
- Manifest загружает только `scripts/main.js`.
- `scripts/main.js` — единственный composition root. Недавние опубликованные `scripts/main-1.4.98.js`, `scripts/main-1.4.99.js` и `scripts/main-1.4.100.js` оставлены только как совместимые forwarder-файлы для уже открытых вкладок игроков и запущенных экземпляров Foundry.
- Runtime API публикуется как `game.rebreyaMain` и `game.modules.get("rebreya-main")?.api`.

Новые versioned entrypoint-файлы больше не создаются. Совместимые `scripts/main-1.4.*.js`, если они нужны для недавно опубликованных версий, должны быть тонкими файлами вида `import "./main.js";` без query-параметров, чтобы не создавать второй composition root.

## Что принадлежит модулю

- Импорт и нормализация экономических JSON.
- Расчёт городского производства, спроса, маршрутов, цен, налогов и глобальных событий.
- Лавки, покупки, продажи, аудит и откат торговых транзакций.
- Реестр dnd5e-групп, партийный инвентарь, валюты, запасы, энергия, путешествия, календарь, крафт и простой.
- Лутген и идемпотентная выдача лута из ChatMessage.
- Управляемые world-компендиумы Rebreya.
- Расширения листов dnd5e: кукла героя, простой, статусы, удержание предметов, пояс, модификации предметов и дополнительные типы Item.
- Боевые, классовые, расовые, spell- и feat-автоматизации, перечисленные ниже.

## Жизненный цикл

### `init`

`scripts/main.js` регистрирует настройки, Handlebars helpers, scene controls, дополнительные dnd5e Item types, статусы, радиальное отображение эффектов и совместимость AC щита/SM Airship.

### `setup`

На канале `module.rebreya-main` регистрируется единый socket-dispatcher. Сообщения, пришедшие до создания API, временно ставятся в очередь.

### `ready`

1. Патчатся EffectMacro и transform-cleanup.
2. Создаётся один экземпляр `RebreyaMainModule`.
3. API публикуется в `game.rebreyaMain` и module API.
4. Регистрируются Forien Quest Log, combat hooks, Mechanus, SmallTime, feat choices, dnd5e sheets, loot chat, ration conversion, inventory sync и magic item templates.
5. `initialize()` загружает модель, синхронизирует компендиумы и инициализирует runtime-сервисы.

Повторную регистрацию hook-ов внутри UI или отдельных сервисов добавлять нельзя. Регистрация принадлежит `main.js`, `scripts/hooks.js`, `scripts/combat/hooks.js` или явно названной integration-функции.

## Карта архитектуры

| Слой | Ответственность | Основные файлы |
|---|---|---|
| Composition | создание сервисов, публичный API, lifecycle, socket dispatch | `scripts/main.js` |
| Application | сериализация, идемпотентность, журналы и use-case orchestration | `scripts/application/`, `scripts/features/trading/` |
| Domain/data | экономика, группы, крафт, простой, путешествия, компендиумы | `scripts/data/`, `scripts/engine/` |
| Infrastructure | Foundry settings/repositories, active-GM election, sockets, UI refresh | `scripts/infrastructure/` |
| Automation | боевые/классовые/расовые реакции на Foundry hooks | `scripts/combat/`, `scripts/automation/`, `scripts/cosmology/` |
| Integration | адаптеры dnd5e и сторонних модулей | `scripts/integrations/` |
| UI | ApplicationV2, шаблоны и DOM binding | `scripts/ui/`, `templates/`, `scripts/ui.js` |
| Shared | только доказанно одинаковые примитивы без доменной семантики | `scripts/shared/foundry-values.js` |

Ключевые владельцы логики:

- `EconomyRepository` загружает/кэширует модель; `economy-engine.js` и `selectors.js` считают представления.
- `GroupContextService` определяет зарегистрированную группу и её участников.
- `GroupStateRepository` и `TraderStateRepository` — единственные владельцы соответствующих world-state записей.
- `WorldMutationCoordinator` сериализует мутации по ключу и дедуплицирует request ID; хранит до 256 завершённых результатов.
- `DurableMutationJournal` хранит фазу многошаговой операции и до 64 terminal-записей.
- `UiRefreshCoordinator` объединяет повторные render-запросы и не крадёт фокус окна.
- `SocketCommandBus` — основной протокол новых привилегированных команд.

## Глобальные реакции и Rune Knight

- `ReactionQueueService` — единственный владелец реакционных окон. Каждому кандидату даётся ровно 10 секунд; после тайм-аута окно считается пропущенным без расхода ресурса или реакции.
- В бою кандидаты обрабатываются по текущему порядку инициативы, вне боя список один раз перемешивается. Цепочка продолжается, пока существует исходный триггер: например, провоцированная атака допускает всех кандидатов, а отменённое заклинание завершает цепочку контрзаклинаний.
- Активный GM координирует очередь через `module.rebreya-main`, а само окно маршрутизируется активному владельцу Actor. Повторная доставка одного trigger ID объединяется и не создаёт второе окно, списание или эффект.
- `ReactionCapabilityIndex` индексирует только Actor/Token текущей сцены и обновляется документными hooks. В горячих путях нет polling, `requestAnimationFrame`, сканирования `game.actors` или геометрии до положительной проверки capability.
- `RuneKnightAutomationService` управляет шестью всегда активными рунами, их SR/LR-перезарядкой, Stone/Cloud/Storm реакциями, Fire/Hill/Frost эффектами, Runic Shield и формой Giant's Might. MIDI-QOL используется для ожидающих pre-roll/hit/damage hooks, DAE — для постоянных и временных эффектов; native dnd5e получает безопасные fallback-маркеры там, где системный hook синхронный.
- Ресурсы Rune Knight синхронизируются локально на конкретном Actor: руны получают 1 применение (2 с Master of Runes), Giant's Might и Runic Shield — бонус мастерства за продолжительный отдых. Все runtime-кэши и журналы дедупликации ограничены по размеру.

## Сохранность состояния и «база»

Отдельной SQL/NoSQL базы здесь нет: постоянное состояние хранится в Foundry world settings, Actor/Item/ActiveEffect/ChatMessage и world-компендиумах. Главный риск — частичная многошаговая запись, а не падение процесса БД.

### Правила мутаций

- Все конкурирующие изменения одного world-state проходят через `WorldMutationCoordinator` или repository, который его использует.
- Повтор запроса с тем же operation/request ID должен вернуть прежний результат, а не повторить списание.
- Нельзя делать новый `get setting -> mutate -> set setting` напрямую из UI.
- Порядок нескольких документных записей должен иметь журнал фаз и компенсацию либо специализированный transaction workflow.

### Журналы

- `craftMutationJournal`: постановка, отмена и завершение крафта. Основные фазы: `prepared -> materials-debited -> task-persisted -> output-created/committed`; при ошибке — `compensated` или `reconciliation-required`.
- `inventoryMutationJournal`: перенос, продажа, импорт и выдача лута. Основные фазы: `prepared -> target-created/currency-credited -> source-debited -> committed`; при ошибке — компенсация или явная сверка.
- Торговля использует `TradeTransactionService`, `trade-sale-transaction-workflow.js` и `trade-rollback-workflow.js`; состояние транзакции и audit принадлежат `TraderStateRepository`.
- Chat-loot использует `LootClaimService`, координатор и флаг `flags.rebreya-main.lootgenChat`, поэтому одна строка/монеты не выдаются дважды.

Незавершённую запись `reconciliation-required` нельзя молча удалять: она означает, что автоматическая компенсация не доказала совпадение состояния и нужна ручная сверка.

## Socket-модель и права

### Typed commands

`scripts/infrastructure/foundry/socket-command-bus.js` задаёт envelope `rebreya.command`/`rebreya.command.result`, лимит 65 536 сериализованных байт и timeout 10 секунд.

Зарегистрированные команды:

| Command | Владелец | Авторизация |
|---|---|---|
| `group.calendar.patch` | `CalendarService` | GM или владелец участника зарегистрированной группы |
| `group.travel.replaceState` | `TravelService` | та же проверка группы |
| `cosmology.setMechanus` | composition root | только GM |
| `combat.status.set` | `CombatStatusService` | GM; для environment-status допускается владелец source Actor |
| `performer.activePerformance.apply` | `PerformerAutomationService` | отправитель владеет Actor-исполнителем |
| `inventory.take` | `InventoryService` | отправитель владеет target Actor в этой группе |
| `inventory.sale` | `InventoryService` | управление зарегистрированной группой |
| `inventory.import` | `InventoryService` | отправитель владеет source Actor и состоит в группе |
| `trader.purchase` | `TradeTransactionService` | отправитель владеет Actor-покупателем |
| `trader.sell` | `TradeTransactionService` | отправитель владеет Actor-продавцом |

Команду исполняет только избранный active GM. `senderId` внутри payload/envelope не является доказательством личности: bus сверяет его с transport sender, после чего передаёт найденного Foundry User в `authorize`. Request ID коррелируется с command и user ID.

В `main.js` ещё есть compatibility-dispatch старых событий простоя, лута, части классовых/расовых операций и settings relay. Новую мутацию туда добавлять нельзя: её следует регистрировать как typed command с `validate`, `authorize` и `execute`. При изменении legacy-команды обязательно связывать payload sender с transport sender.

## Управляемые компендиумы

Синхронизация запускается при `ready` и `reloadData()`. Запись выполняет только active GM.

| Pack | Сервис/источник |
|---|---|
| `world.rebreya-materials` | `materials-compendium.js`, `data/materials.json` |
| `world.rebreya-gear` | `gear-compendium.js`, `data/gear.json` |
| `world.rebreya-magic-items` | `magic-items-compendium.js`, `magicItem.js` |
| `world.rebreya-feats` | `feats-compendium.js`, `feat.js` и overrides |
| `world.rebreya-states` | `states-compendium.js`, `data/states-teyvankal-v02.json` |
| `world.rebreya-backgrounds` | `backgrounds-compendium.js`, `data/backgrounds-v012.json` |
| `world.rebreya-race-features` | `races-compendium.js`, `data/races-teyvankal-v01.json` |
| `world.rebreya-races` | `races-compendium.js`, тот же источник |
| `world.rebreya-spells` | `spells-compendium.js`, `data/rebreya-spells-v01.json` |
| `world.rebreya-class-features` | `classes-compendium.js`, class JSON |
| `world.rebreya-subclasses` | `classes-compendium.js`, class JSON |
| `world.rebreya-classes` | `classes-compendium.js`, class JSON |
| `world.rebreya-actions` | `actions-compendium.js`, class/race actions |
| `world.rebreya-downtime` | `downtime-compendium.js`, `data/downtime-activities-teyvankal-v01.json` |

Общий lifecycle находится в `scripts/data/managed-compendium-sync.js`:

- source ID обязателен и уникален;
- signature определяет, нужен ли update;
- стабильный document ID сохраняет UUID;
- создаются отсутствующие, обновляются изменённые, удаляются только stale managed-документы;
- пользовательские документы без managed-флага не удаляются;
- legacy-дубликаты с тем же source ID сворачиваются;
- папки готовятся до create/update.

Зависимости синхронизируются в порядке: race features перед races; class features перед subclasses/classes; primary gear перед container contents. UUID-ссылки строятся из стабильных ID. Возвращать схему `delete all -> create all` запрещено: она ломает UUID, advancements и внешние ссылки.

## Основные UI

| UI | Файл | Назначение |
|---|---|---|
| Экономика | `scripts/ui/economy-app.js` | player: города, базовые цены и мировой дефицит; GM: полная аналитика |
| Город | `scripts/ui/city-app.js` | player/public: панорама, описание, фактические цены и торговцы; GM: analytics и presentation |
| Маршруты | `trade-routes-app.js`, `trade-route-app.js` | аналитика и ручные overrides |
| Государства | `states-app.js` | налоги, пошлины, описания |
| Глобальные события | `global-events-app.js` | scope, modifiers, даты и видимость |
| Группы | `groups-app.js` | регистрация native dnd5e group, active group, legacy merge |
| Инвентарь | `inventory-app.js` | inventory/party/craft/calendar/downtime/travel |
| Лавка | `trader-app-v2.js` | покупка, продажа, метаданные и audit |
| Лутген | `lootgen-app.js`, `lootgen-chat.js` | генерация, шаринг и claims |
| Космология | `cosmology-app.js` | world-флаг Mechanus |
| Справка | `reference-info-app.js` | материалы, снаряжение и reference cards |

Экономика открывается игрокам существующей кнопкой в группе Scene Controls, если включён `showEconomyButton`. Карточки экономики и обе точки сводки маршрута вызывают единственный `openCityApp(cityId)`. Просмотр города и открытие его торговцев не зависят от текущего travel state или местоположения группы.

Игрок всегда получает public-режим существующих Economy/City apps без механических процентов, стрелок и объяснений модификаторов. В общей экономике цена материала базовая, а в городе показана фактическая цена, рассчитанная Trader Engine. Описание города отображается только в нижней вкладке «Город», не поверх панорамы. GM сохраняет прежнюю аналитику и может переключить тот же City app в public-вид; описание и панорама редактируются как world overrides без изменения `data/cities.json`. Базовые панорамы принадлежат модулю: все 300 WebP лежат в `assets/cities/`, а source-данные используют runtime-пути `modules/rebreya-main/assets/cities/<имя города>.webp`. Как и рабочая шапка инвентаря, hero города рисует панораму через CSS `background-image`, а не скрываемый при ошибке `<img>`; URL получает версию модуля как cache-bust query.

Старого `trader-app.js` и `templates/trader-app.hbs` больше нет. `openTrader()` и `openTraderSheet()` являются compatibility-алиасами `openTraderV2()`; второй Trader UI создавать не нужно.

## Каталог автоматизаций

### Общий контракт

- Центральная регистрация: `scripts/combat/hooks.js`.
- Автоматизация должна сначала идентифицировать документ по стабильному `system.identifier`, `flags.rebreya-main.sourceType/sourceId/automation` или activity runtime; имя — только migration fallback.
- Мутация чужого Actor выполняется владельцем документа или через проверенный active-GM socket path.
- Hook обязан быть идемпотентным: Foundry, dnd5e и Midi-QOL могут сообщить об одном workflow несколькими событиями.
- Временные Active Effects должны иметь origin, duration/specialDuration и cleanup на turn/rest/consumption.
- Новая automation добавляет focused test и запись в этот каталог.

### Статусы и общий бой

| Сервис | Hooks/входы | Идентификаторы и эффект | Cleanup/маршрутизация | Тест |
|---|---|---|---|---|
| `CombatStatusService` | `updateActor`, Token HUD, ActiveEffect create/update/delete, `combatTurn` | статусы `rebreya-*` и native `frightened`; флаги `statusId/statusValue/statusMeta`; bloodied, discreet, frightened, surrounded, decaying damage | синхронизация дублей оставляет сильнейший числовой эффект; environment status может идти через `combat.status.set` | `combat-status.test.mjs` |
| `CombatAttackService` | sheet render, `dnd5e.preUseActivity`, attack/damage hooks, `midi-qol.hitsChecked`, `midi-qol.RollComplete`, `combatTurn` | удержание оружия; reaction state; provoked/parry/interception; firearm ammo, misfire, jam, reload, maintenance и area fire | не тратит ammo/uses дважды; reaction обновляется по ходу; jam/empty state хранится во флагах предмета | `combat-attack-service.test.mjs` |
| `AttackRollBoostService` | `dnd5e.rollAttack`, `midi-qol.hitsChecked` | `flags.rebreya-main.attackRollBoosts`, `d20Bonus`, fighter `fighter-dominance` | объединяет выбранные кости, тратит sources один раз и удаляет одноразовый effect | `attack-roll-boost-service.test.mjs` |
| `EnvironmentAutomationService` | target/control token, dnd5e/Midi pre-attack | `rebreya-surrounded` (-2 AC), `rebreya-open-position`; source `rebreya-environment` | обновляет только собственные markers; для чужой цели использует combat status API/socket | `environment-automation-service.test.mjs` |
| `SpellAutomationService` | deferred `dnd5e.preUseActivity`, `midi-qol.preItemRoll`, module socket | Counterspell и Sorcerer Spell Shatter; V/S visibility, 60 ft, reaction и slot/SP payment | prompt отправляется владельцу reactor; результат проверяет authenticated sender; отмена root cast только после успешной оплаты/проверки | `spell-automation-service.test.mjs` |

### Классы, черты и расы

| Сервис | Hooks/идентификаторы | Автоматизация | Cleanup/права | Тест |
|---|---|---|---|---|
| `FighterAutomationService` | `createItem`, sheet render, combat turn, post-use, damage, rest, Midi RollComplete; class `fighter-rework-v028` | starting equipment, dominance maneuvers, precise attack, second wind, iron will, multiattack choice и repair advancement/container links | prompt выполняет создающий/владеющий клиент; расход dominance/second-wind защищён от дубля; turn/rest эффекты завершаются по source turn/long rest | `fighter-automation-service.test.mjs` |
| `SorcererAutomationService` | item create/update, cast dialogs, pre-use, attack/save/damage hooks, post message, combat turn, rest | Sorcery Points, virtual slots/cooldowns, metamagic (Careful, Distant, Empowered, Extended, Heightened, Quickened, Seeking, Subtle, Twinned), draconic options, Mana Storm и Transcendence | платежи сериализованы по Actor и откатываются при отмене cast; cooldown идёт по ходу владельца; high-level virtual slots сбрасываются long rest | `sorcerer-automation-service.test.mjs` |
| `PaladinAutomationService` | item/actor updates, post-use, rest, `midi-qol.preDamageRoll` | prepared spells, Lay on Hands, Divine Smite; class `paladin-rework-v01` | чужая цель Lay on Hands идёт active GM; socket sender должен владеть source Actor; smite once/turn, prepared spells — long rest | `paladin-automation-service.test.mjs` |
| `RogueAutomationService` | `midi-qol.preDamageRoll`; class `rogue-rework-v00` | Sneak Attack и Cunning Strike: Hamstring, Disrupt Aim, Open Position, Trip, Break Tempo и данные sourceType `rogueCunningStrike` | один Sneak Attack на combat turn; добавляет damage config до roll, статусы/карточку — после выбора | `rogue-automation-service.test.mjs` |
| `PerformerAutomationService` | pre/post activity, d20 attack/skill/tool/ability/save, rest; feat identifier `ispolnitel`, action `activePerformance` | Активное выступление: проверка, союзный `d5` bonus или hostile penalty; два последовательных провала блокируют черту | игрок отправляет `performer.activePerformance.apply`; active GM проверяет владение исполнителем и создаёт эффект на target; effect удаляется после выбранного d20, streak — long rest | `performer-automation-service.test.mjs` |
| `BardicInspirationCompatService` | `dnd5e.postUseActivity`; magic item flag `restoreBardicInspiration`; Laaru source UUID | Барабан задающего ритм восстанавливает одну кость Бардовского вдохновения из `laaru-dnd5-hw` | уменьшает `system.uses.spent` у laaru-фичи и не переполняет ресурс | `bardic-inspiration-compat-service.test.mjs` |
| `RaceAutomationService` | attack config, post-use, pre/post damage, d20 rolls, pre/rest, movement blocking, Midi RollComplete, combat turn | runtime actions из race feature flags: linked/custom effects, elemental/demonic choices, pack tactics, damage reduction, relentless endurance, lucky reroll, rest rules, Fury of the Small, Keen Eye, Surprise/Celestial damage и временное игнорирование hostile spaces | remote damage/effect/heal исполняет active GM; once-turn damage имеет turn key; rest features чистятся/восстанавливаются по long rest | `race-automation-service.test.mjs` |
| `FeatChoiceAutomationService` | owned feat create/update/delete | `flags.rebreya-main.choiceConfig`; создаёт native dnd5e ItemChoice advancement, разрешает UUID options, зеркалит выбор и удаляет advancement children | работает только на текущем клиенте-владельце/GM; при отсутствующих options может синхронизировать feats pack | `feat-choice-automation.test.mjs` |
| Mechanus | libWrapper Roll evaluation hooks | при включённом `cosmologyState.mechanusEnabled` усредняет eligible dice; d20 advantage/disadvantage переводит в flat modifier; d20/d100 не усредняет как обычные dice | world toggle — typed GM command; выключенный режим не меняет Roll | `cosmology-mechanus-rolls.test.mjs` |

### EffectMacro

`scripts/integrations/effectmacro-compat.js` патчит только узнаваемый `updateCombat` hook EffectMacro. Actorless failure игрока пересылается active GM; невыбранные GM подавляют локальное исполнение. Запрос дедуплицируется по combat/sender/request ID, а envelope sender сверяется с transport sender. Таким образом один combat update не исполняется каждым активным GM. Тест: `effectmacro-compat.test.mjs`.

## Остальные integrations

| Integration | Файл | Контракт |
|---|---|---|
| dnd5e sheets | `dnd5e-sheet-extensions.js` | Hero Doll, downtime, combat statuses, item mods, held items, universal belt, activity availability, heroic d20 controls, state card |
| Held items/AC | `held-items.js`, `held-shield-ac.js` | занятые руки, versatile presentation, AC только от удерживаемого щита |
| Universal Belt | `universal-belt.js` | 3 слота, 1 открыт по умолчанию, цена открытия 500 gp |
| Item upgrades | `item-upgrade-sheet.js`, `item-upgrade-service.js` | установка/снятие mods и capacity через owned Items |
| Inventory sync | `inventory-sync.js` | после Item/Actor mutations обновляет только связанные inventory views |
| SmallTime | `smalltime-compat.js` | отображение календаря Rebreya и подтверждение расхода запасов при сдвиге world time |
| Forien Quest Log | `forien-quest-log.js`, `quest-log-service.js` | metadata, requirements, grouped quests, rumors/events и UI overlays |
| Rations | `ration-food-conversion.js` | созданные ration Items можно конвертировать в партийную еду |
| Magic templates | `magic-weapon-template.js` | шаблон базового оружия/доспеха/щита/боеприпасов/инструмента для magic item |
| BG3 Hotbar | `scripts/hooks.js` | подавляет auto-add служебных Items, чинит item-pile common actions/death saves |
| transform-cleanup / SM Airship | соответствующие `*-compat.js` | узкие defensive patches, без владения доменной логикой |

## Шаблоны Lootgen и хранилища на сцене

- Внизу окна Lootgen мастер сохраняет текущие настройки кнопкой `Сохранить шаблон`; шаблоны хранятся в скрытом world setting `lootgenTemplates` и повторно применяются в Lootgen и других инструментах модуля.
- NPC помечается как хранилище Rebreya через действие `Хранилище` в заголовке листа. Конкретные настройки и сгенерированный лут записываются во флаг конкретного Scene Token, поэтому два токена одного актёра независимы.
- ЛКМ по токену открывает меню. Игрок видит `Открыть`, мастер дополнительно видит `Настроить`; в настройке можно выбрать снимок шаблона Lootgen и добавить предметы вручную перетаскиванием.
- При первом явном открытии содержимое генерируется один раз. Игрок может передать каждую строку или монеты себе либо в групповой инвентарь. Для игрока active-GM повторно проверяет видимость, владение выбранным персонажем и дистанцию не более 5 футов.
- После выдачи всего содержимого состояние становится `empty`, а к имени токена добавляется `(пусто)`. Выдача идемпотентна и идёт через единый `SocketCommandBus`.
- Хранилища полностью принадлежат Rebreya: их actor/token flags, генерация, интерфейс и выдача не требуют внешнего модуля куч.
- `readStorageJournal(tokenUuid, rowId, request)` читает только Journal-ссылку из открытого, доступного хранилища. Active GM заново проверяет сцену, видимость, дистанцию и владение выбранным персонажем, берёт Journal UUID только из authoritative строки по `request.path`, читает актуальные страницы без изменения документа или ownership и возвращает UUID-free read-only snapshot без нераскрытых secret-блоков. Sidebar visibility и ownership Journal не дают и не отменяют доступ; удалённая, забранная или небезопасная запись отвечает общей ошибкой недоступности.

## Публичный API

Поддерживаемая точка вызова макросов:

```js
const api = game.rebreyaMain;
await api.openInventoryApp({ tab: "inventory" });
await api.openTrader("city-id", "shop-key", { actorId: "actor-id" });
await api.setCombatStatus("actor-id", "frightened", { value: 2 });
```

### Модель и окна

- `getModel`, `reloadData`, `resetWorldData`, `refreshOpenApps`.
- `openEconomyApp`, `openCityApp`, `openWorldTradeRoutesApp`, `openTradeRouteApp`, `openStatesApp`, `openGlobalEventsApp`, `openReferenceInfoApp`.
- `openInventoryApp`, `openGroupsApp`, `openPartyInventorySheet`, `openLootgenApp`, `openCosmologyApp`.
- `openTrader`, `openTraderV2`, `openTraderSheet` — все открывают единственный Trader V2.

### Экономика, события и reference

- `getCitySnapshot`, `getPublicCitySnapshot`, `getPublicEconomySnapshot`, `getTradeRouteSnapshot`, `getTradeRouteBaseSnapshot`, `getTradeRoutes`, `prepareTradeRouteAnalytics`, `hasTradeRouteAnalytics`.
- `getCityPresentation`, `updateCityPresentation`, `resetCityPresentation` — чтение merged presentation и GM-only изменение/сброс world overrides `description`/`image`.
- `setConnectionActive`, `updateTradeRouteMetadata`, `getStatePolicies`, `getEffectiveStatePolicy`, `updateStatePolicy`, `getReferenceEntrySnapshot`, `updateReferenceDescription`.
- `getAllGlobalEvents`, `getActiveGlobalEvents`, `getEventsAffectingCity`, `getEventsAffectingCityGood`, `getEventsAffectingRoute`, `getEventsAffectingState`.
- `createGlobalEvent`, `updateGlobalEvent`, `deleteGlobalEvent`, `duplicateGlobalEvent`, `importDefaultGlobalEventTemplates`.
- `getMaterialByGoodId`, `openMaterialByGoodId`, `openMaterialById`, `openGearById`, `openMagicItemById`, `openFeatById`, `openBackgroundById`, `openStateById`, `openTradeEntry`.

### Группы, inventory, travel, craft и downtime

- `getGroupRegistry`, `getGroupContext`, `registerPartyGroup`, `setActivePartyGroup`, `mergeLegacyInventoryIntoGroup`.
- `getInventorySnapshot`, `getPartySnapshot`, `addPartyMember`, `removePartyMember`, `updatePartyDefaults`, `updatePartyMember`, `updatePartyMemberTool`.
- `updateInventoryItemQuantity`, `deleteInventoryItem`, `takeInventoryItemToCharacter`, `sellInventoryItem`, `importInventoryDrop`, `addModelItemToInventory`, `breakInventoryItemToMaterial`.
- `addPartySupply`, `consumePartySuppliesOneDay`, `updatePartyCurrency`, `convertPartyCurrency`, `setPartyMemberEnergy`, `restorePartyMemberEnergy`, `getRebreyaToolCatalog`.
- `getTravelSnapshot`, `syncTravelMapToken`, `setTravelRoute`, `advanceTravelHours`, `clearTravelRoute`.
- `getCraftSnapshot`, `queueCraftTask`, `cancelCraftTask`, `processCraftOneDay`.
- `getDowntimeSnapshot`, `getDowntimeActionCatalog`, `grantDowntimeWeeks`, `revokeDowntimeWeeks`, `clearDowntimeHistory`, `createDowntimeRequest`, `updateDowntimeRequest`, `setDowntimeRequestStatus`, `setDowntimeRequestChecks`, `recordDowntimeCheckResult`, `continueDowntimeProject`, `closeDowntimeProject`.
- `getCalendarSnapshot`, `setCalendarTimeOfDay`, `setCalendarDate`, `shiftCalendarDays`, `advanceCalendarDays`, `advanceCalendarWeeks`, `advanceCalendarMonths`.

### Trader, loot и item upgrades

- `isTraderIntegrationAvailable`, `getCityTraderSummaries`, `getTraderSnapshot`, `purchaseTraderItem`, `createTraderSalePreview`, `sellTraderItem`, `updateTraderMetadata`.
- `recordTraderAudit`, `getTradeAuditLog`, `rollbackTraderAuditEntry`.
- `shareLootgenResult`, `createLootgenChatMessage`, `claimLootgenChatRow`, `claimLootgenChatCoins`, `claimLootgenChatRowToInventory`, `claimLootgenChatAllToInventory`, `restoreLootgenClearFromChat`.
- `listLootgenTemplates`, `getLootgenTemplate`, `saveLootgenTemplate`, `removeLootgenTemplate`.
- `openStorageApp`, `getStorageSnapshot`, `markStorageActor`, `configureStorageToken`, `addManualStorageItem`, `removeManualStorageItem`, `resetStorageToken`, `openStorage`, `readStorageJournal(tokenUuid, rowId, request)`, `claimStorageRow`, `claimStorageCoins`.
- `installItemUpgrade`, `removeItemUpgrade`, `setItemUpgradeCapacity`.

### Бой и космология

- `getCombatStatusDefinitions`, `normalizeCombatStatusId`, `getCombatStatus`, `setCombatStatus`, `clearCombatStatus`, `setCombatStatusValue`, `applyDecayingDamage`, `syncBloodiedStatuses`.
- `getReactionState`, `canUseReaction`, `refreshReaction`, `consumeReaction`.
- `rollWeaponAttack`, `rollFirearmAttack`, `clearFirearmJam`, `maintainFirearm`, `resolveProvokedAttack`, `resolveParry`, `resolveInterception`.
- `getCosmologyState`, `isMechanusEnabled`, `setMechanusEnabled`.

`initialize`, `handleSocketMessage`, `handleLootgenChatItemCreated`, `handleGlobalEventsConfigChange`, `syncFeatsFromWorldCompendium`, `refreshInventoryViews`, `refreshDowntimeViews`, `refreshCosmologyViews`, `refreshCityViews`, `runInventoryMutation` и `unregisterLootgenApp` — lifecycle/internal coordination surface; не использовать их как доменный API макроса без отдельной причины. `refreshCityViews({ cityIds = [] } = {})` обновляет только запрошенные instances единственного `cityApps` cache (или все открытые города при пустом списке), не поднимая окна над остальными.

## Settings и данные

Configurable world settings:

- `showEconomyButton`, `debugMode`, `dataSourceMode`, `customDataPath`, `displayPrecision`, `radialStatusEffects`.
- `globalEventsEnabled`, `globalEventsNotifications`, `globalEventsAutoRecalc`, `globalEventsShowPublic`, `globalEventsDebug`.

Hidden world state:

- `traderState`, `partyState` (legacy compatibility), `groupState`, `craftState`, `calendarState`.
- `craftMutationJournal`, `inventoryMutationJournal`.
- `connectionStates`, `referenceNotes`, `tradeRouteOverrides`, `statePolicies`, `cosmologyState`, `globalEventsState`, `globalEventsDraft`, `lootgenTemplates`.
- `cityPresentationOverrides` — только непустые отличия `description`/`image` известных городов; сброс поля удаляет override и возвращает значение из `data/cities.json`.

Основные источники в `data/`:

- экономика: `goods.json`, `regions.json`, `cities.json`, `reference.json`, `materials.json`, `gear.json`; 300 панорам городов — tracked-файлы `assets/cities/`, а `cities.json` хранит только module-owned runtime-пути `modules/rebreya-main/assets/cities/<имя города>.webp`;
- контент: races/backgrounds/states/spells/downtime и class rework JSON;
- путешествия: `travel-network.json`;
- magic items: корневой `magicItem.js`; feats: корневой `feat.js` плюс `feats-world-overrides.json`.

Импортные инструменты: `tools/import-xlsx.ps1`, `import-materials.ps1`, `import-gear.ps1`, `sync-travel-network.mjs`, `apply-feat-automation.mjs`, `apply-race-automation.mjs`. `import-xlsx.ps1` генерирует module-owned city panorama paths; сами WebP перед релизом должны находиться в `assets/cities/`. Формат item-полей дополнительно описан в `docs/foundry-item-fields.md`.

## Проверки разработки

Проект использует Node test runner и не требует test framework:

```powershell
node --test tests/*.test.mjs
```

Минимум перед commit:

```powershell
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw $file | ConvertFrom-Json | Out-Null }
```

Focused tests названы по владельцу: `*-automation-service.test.mjs`, `*-compendium.test.mjs`, transaction/recovery tests и compatibility tests. Исправление бага сначала должно воспроизводиться focused test; затем обязательно запускается весь набор.

## Правила против дублей

Перед добавлением функции или сервиса:

1. Найти владельца термина: `rg -n "имя|флаг|command|hook" scripts tests README.md`.
2. Проверить `RebreyaMainModule`, существующий domain service и `scripts/shared/foundry-values.js`.
3. Расширить существующий сервис; новый сервис допустим только при новой ответственности, а не новом UI.
4. Не переносить helper в shared только из-за одинакового имени. Должны совпасть null/undefined semantics, trim, Foundry fallback, HTML escaping, collection precedence и формат ошибок.
5. Не копировать compendium lifecycle: использовать `syncManagedDocuments`, `syncFlaggedManagedDocuments` или `syncManagedDocumentsOnActiveGm`.
6. Не создавать второй City/Trader/Inventory/Sheet app. Compatibility-метод должен делегировать канонической реализации; просмотр города и Trader V2 не ограничиваются travel state.
7. Не регистрировать один Hook в нескольких местах. `combat/hooks.js` уже объединяет dnd5e и Midi paths и содержит guards для отсутствующих сервисов.
8. Не писать world setting напрямую из UI и не добавлять неавторизованный socket event.
9. Локальную функцию удалять только после поиска declaration/call sites и проверки callback/hook/string references.
10. Обновить focused tests и раздел автоматизаций этого README.

## Диагностика

- Нет `game.rebreyaMain`: проверить активацию модуля, manifest entrypoint и ошибки `ready` в консоли.
- Не обновился компендиум: нужен активный GM; проверить managed/source/signature flags и ошибки соответствующего `*-compendium.js`.
- Не сработала automation: проверить identifier/sourceType/runtime flags, нужный dnd5e/Midi hook и владение Actor; имя предмета часто является только fallback.
- Не создался эффект на чужом Actor: локальный клиент, вероятно, не владелец; для поддержанных операций должен существовать active-GM socket route.
- Повторное списание или зависшая операция: найти operation ID в mutation journal/transaction state; `reconciliation-required` требует ручной сверки.
- UI показывает старое состояние: использовать `refreshInventoryViews`/`refreshOpenApps` через composition root, а не прямой массовый render.
- Общий префикс логов: `rebreya-main |`.

README изменяется вместе с архитектурой, публичным API, socket command, pack или automation hook. Если код и этот файл расходятся, источником поведения остаётся код, а расхождение считается дефектом документации.
