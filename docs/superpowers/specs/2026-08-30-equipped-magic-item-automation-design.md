# Equipped Magic Item Automation Design

## Статус и наблюдаемый результат

После реализации managed-компендиум `world.rebreya-magic-items` публикует нативные dnd5e 5.2.5 effects и activities для поддержанных магических предметов. GM может вручную выполнить:

```js
await game.rebreyaMain.syncEquippedMagicItems()
```

Команда сначала синхронизирует компендиум, затем проходит по всем world Actor типа `character` и переносит актуальную managed-автоматизацию только в предметы с `system.equipped === true` или `system.attuned === true`. Повторный запуск не создаёт дубликаты и не сбрасывает runtime-состояние предметов.

Предварительный просмотр выполняется без world mutations:

```js
await game.rebreyaMain.syncEquippedMagicItems({ dryRun: true })
```

## Подтверждённая область задачи

В область входят:

- расширение существующих builders в `scripts/data/magic-items-compendium.js`;
- расширение существующего attack workflow только для бонуса Перчаток двуручного боя, зависящего от живого состояния рук Rebreya;
- обновление managed-компендиума через существующий `MagicItemsCompendiumService.sync()`;
- перенос managed effects и activities в уже существующие надетые/настроенные embedded Items;
- точная совместимость со старыми world-копиями и карточками из `dnd5e`, `laaru-dnd5-hw` и `fifthpendium-artificer-525`;
- обработка всех world Actor типа `character`, а не только текущей сцены или одной группы;
- компактный console report и полный возвращаемый result object.

Из области исключены:

- NPC, group/vehicle Actor и ненадетые предметы;
- `Особый Кинжал телепортации`, `Зелье заживления ран` и `Зелье лечения 1-го уровня`: в текущей итерации команда сообщает для них `deferred` и не изменяет их embedded Items или compendium-проекции;
- автоматическое включение или выключение attunement;
- fuzzy matching по похожим названиям;
- полная замена embedded Item копией из компендиума;
- глобальные hooks для постоянного ремонта предметов;
- автоматическое принятие решений за игрока;
- реализация сложной ситуационной логики, которую нельзя корректно выразить Active Effect или native activity.

## Проверенный текущий срез

Аудит сохранённого мира `testovyj3` обнаружил 47 активных экземпляров с 41 уникальным названием у восьми персонажей:

- активная сцена `Мицелия фон путешествия`: Григ Пимпле, v1-КТОР, М-010-7;
- Actor-группа `Рассвет порядка 1`: Гугрдуд Бамблбоб, Кэссиди Редсмит, Мёрдичи Вильгельмо, Ульфрик, Элиан Вейрмонт.

Этот перечень задаёт первичный acceptance corpus, но runtime-команда не содержит UUID этих актёров и работает для всех персонажей мира.

## Канонический владелец и расширение существующего потока

Нового владельца правил магических предметов не создаётся. Канонический поток остаётся прежним:

```text
magicItem.js / MAGIC_ITEMS
  -> normalizeMagicItems()
  -> createMagicItemData()
     -> resolveMagicItemAutomationDefinition()
     -> buildMagicItemAutomationEffects()
     -> buildNativeInstrumentSpellActivities()
  -> MagicItemsCompendiumService.sync()
  -> world.rebreya-magic-items
```

Существующие функции расширяются:

- `resolveMagicItemAutomationDefinition(item)` описывает coverage, choices, aliases, charges и миграционные признаки;
- `buildMagicItemAutomationEffects(item)` создаёт детерминированные transferable Active Effects;
- существующий native activity builder обобщается так, чтобы кроме инструментов поддерживать заклинания и обычные actions магических предметов;
- `buildMagicSignature(item)` включает versioned automation projection, поэтому managed sync обновляет только карточки с изменившимся shape;
- `createMagicItemData()` остаётся единственной сборкой полного compendium Item.

Pure helpers разрешения identity и merge embedded-данных могут быть вынесены в `scripts/data/magic-item-embedded-sync.js`, чтобы не раздувать compendium-файл. Они являются деталями `MagicItemsCompendiumService`, не публикуют второй lifecycle и не строят автоматизацию самостоятельно.

## Контракт автоматизации

Каждая механика получает один статус:

- `effect` — постоянный детерминированный бонус;
- `activity` — действие, которое игрок запускает вручную;
- `native` — механика уже корректно представлена dnd5e-полями или сторонним документом;
- `manual` — корректная реализация требует ситуационного решения или нового профильного runtime-сервиса.

Общие правила:

1. КД, спасброски, проверки, навыки, характеристики, чувства, spell attack и spell DC выражаются managed transferable Active Effects.
2. Заклинания выражаются native `cast` activities с официальными UUID, без расхода actor spell slots.
3. Заряды хранятся в activity uses или в явном общем item-resource, когда несколько activities используют общий пул.
4. Обычные действия выражаются native `utility`, `attack`, `save` или иным подходящим activity type.
5. Нативный `system.magicalBonus` оружия/брони не дублируется эффектом.
6. Условный бонус не превращается в безусловный. Если условие уже имеет канонического runtime-владельца, автоматизация расширяет его; в частности, состояние рук читается только через `scripts/integrations/held-items.js`. В остальных случаях создаётся activity для ручного применения либо механика остаётся `manual`.
7. Нарративное действие может иметь utility activity, публикующую правило в chat, но не притворяется полностью автоматизированным.
8. Managed effects и activities получают стабильные IDs и `flags.rebreya-main.magicItemAutomation: true`.
9. Attunement-state принадлежит embedded Item и миграцией не меняется.

## Матрица первичного acceptance corpus

### Пассивные эффекты и choices

| Канонический предмет / варианты | Требуемый результат | Coverage |
| --- | --- | --- |
| `амулет-благочестия-1` | `+1` spell attack и spell DC; отдельная `1/dawn` activity бесплатного Божественного канала | partial: class-scoped ограничение остаётся в описании, native bonus применяется штатным dnd5e-полем |
| `барабан-задающего-ритм-1` | `+1` spell attack/DC; существующий restore Bardic Inspiration получает запускаемую `1/dawn` activity | full |
| `лунный-серп-1` | native weapon `+1`; `+1` spell attack/DC; бонус `1d4` к spell healing, если поддерживаемый dnd5e healing bonus не расширяет область за пределы заклинаний | partial: class/holding condition явно документируется |
| `обруч-заклинателя-2` | `+2` к `Arcana`, без выдуманного бонуса spell attack/DC | full |
| `очки-орлиного-зрения` | преимущество `Perception`; дальнее зрение остаётся текстовым | partial: effect не должен утверждать автоматизацию иных условий кроме поддержанного roll flag |
| `ночные-очки` и exact alias `Goggles of Night` | добавить 60 футов darkvision, поэтому персонаж без darkvision получает 60, а имеющий 60 получает 120 | full; исправляет прежнее поведение `upgrade-to-60` |
| `пояс-атлета-1` | `+1` Athletics | full |
| `пояс-силы-холмового-великана` | `+3` Strength с максимумом 21 | full при подтверждённой поддержке max dnd5e effect; иначе report `manual` вместо безлимитного bonus |
| `камень-удачи` | `+1` ко всем ability checks и saving throws | full; эквивалентный официальный effect не дублируется |
| `плащ-защиты-1` | только `+1` saving throws согласно Rebreya-каталогу | full; не добавлять КД от другого одноимённого SRD-предмета |
| внешний `Плащ защиты` | сохранить существующий официальный `+1 AC/+1 saves` effect | native external; не сопоставлять с `плащ-защиты-1` |
| `уроборос` и варианты колец характеристики | definition хранит bonus/max; compendium не выбирает характеристику | manual-choice; embedded suffix `(Сила)`/`(Ловкость)` разрешает точный managed effect, иначе `unresolvedChoices` |
| `живые-перчатки` | выбор skill/tool proficiency и expertise не угадывается | manual-choice; существующий выбор/effect сохраняется |
| `эльфийская-кольчуга` | native armor bonus сохраняется; proficiency без штрафа остаётся native/manual, если нет точного dnd5e effect path | native/partial |
| `перчатки-двуручного-боя` | добавить `+2` ровно один раз к damage roll текущего melee weapon, только когда Actor держит минимум два разных melee weapon в разных руках Rebreya | full через существующие `heldHands` и `CombatAttackService`; постоянный Active Effect запрещён |
| `амулет-защиты-от-обнаружения-и-поиска` | не создавать фиктивный immunity flag | manual: divination targeting требует профильной интеграции |
| `медальон-затягивающихся-ран` | не подменять стабилизацию и удвоение Hit Dice пустым effect | manual: требуется отдельный death/rest workflow, отсутствующий в этой задаче |

### Заклинания и активируемые действия

| Канонический предмет | Требуемые activities | Ресурс / ограничение |
| --- | --- | --- |
| `печатка-гильдии-ракдоса` | cast `Hellish Rebuke` | общий пул 3 charges, recovery `1d3/dawn`, cost 1 |
| `ушной-червь` | cast `Detect Thoughts`; cast `Dissonant Whispers` | общий пул 4 charges, recovery `1d4/dawn`, costs 2/1, fixed save DC 15 где применимо |
| `кинжал-яда` | utility «Покрыть клинок ядом» и save/damage application после попадания | `1/dawn`; Con DC 15, `2d10` poison и poisoned 1 minute при провале |
| `механистический-амулет` | utility «Принять 10 на броске атаки» | `1/dawn`; activity расходует ресурс и публикует правило, но не подменяет roll hook |
| `таранный-щит` | utility применения дополнительного shove после успешного обычного толчка | общий пул 3 charges, recovery `1d3/dawn`; выбор push/prone остаётся игроку |
| `развевающийся-плащ` | bonus-action utility | без ресурса; chat-only narrative action |
| `трубка-дымных-чудовищ` | action utility | без ресурса; chat-only narrative action |
| `фонарь-обнаружения` | actions «Открыть» и «Опустить козырёк» | chat/manual light-state; не мутировать Token глобальным hook |
| `универсальный-инструмент-1` | utility трансформации; utility выбора cantrip | cantrip choice `1/dawn`, действие не создаёт произвольный spell без выбора; `+1` spell attack/DC — effect |
| `амулет-благочестия-1` | utility бесплатного Божественного канала | `1/dawn`; actor resource не расходуется самой activity |
| `барабан-задающего-ритм-1` | utility восстановления одной Bardic Inspiration die | `1/dawn`, использует существующий `restoreBardicInspiration` owner |

### Уже нативные или намеренно не изменяемые

| Предметы | Решение |
| --- | --- |
| `Боевой топор +1`, `Длинный меч +1`, `Кавалерийская пика +1`, `Палаш +1` | сохранить native `system.magicalBonus: 1` и attack activities; разрешать generic `оружие-1` по точному type/name pattern, не добавлять effects |
| `Кираса +1`, `Латы +1`, `Проклёпанный кожаный доспех +1` | сохранить `system.armor.magicalBonus: 1`; разрешать generic `доспех-1`, не добавлять effects |
| `Сумка хранения` | сохранить существующую container automation/capacity; не сбрасывать contents |
| `Колчан Элонны` | описание трёх отделений не сводить к одному неточному capacity; оставить manual/metadata |
| `Зелье заживления ран` | `deferred`: текущая итерация не изменяет оба существующих экземпляра и их custom automation |
| `Зелье лечения 1-го уровня` | `deferred`: текущая итерация не изменяет gear row и не создаёт для него magic-item identity |
| `Меч мести` | native weapon `+1` сохраняется; curse остаётся manual, поскольку требует выбора цели и принуждения атаковать |
| `Особый Кинжал телепортации` | `deferred`: текущая итерация не изменяет предмет; карточка остаётся переименованным mundane dagger без автоматизации телепортации |

## Условный бонус Перчаток двуручного боя

Перчатки не получают damage Active Effect: такой effect неизбежно применил бы `+2` к атакам, для которых условие двух оружий не выполнено. Канонический владелец проверки — существующий attack workflow `CombatAttackService`, а источник состояния рук — только `scripts/integrations/held-items.js`.

Во время построения damage roll бонус применяется, только если одновременно истинны все условия:

1. Actor имеет equipped Item с точным `magicItemId: перчатки-двуручного-боя`.
2. Текущий атакующий Item является melee weapon и сам удерживается хотя бы в одной руке по `getItemHeldHands(item)`.
3. Actor держит минимум два разных equipped melee weapon Items.
4. Эти два документа занимают минимум два разных hand slots из `getActorHandSlots(actor)`; одно двуручное оружие, занимающее обе руки, не считается двумя оружиями.
5. Текущий атакующий Item входит в найденную пару/набор.

Проверка выполняется заново для каждого damage roll и поэтому сразу учитывает смену оружия, освобождение руки, резерв руки захватом и дополнительные руки от имплантов. Бонус добавляется один раз к итоговому damage roll текущего оружия, а не к каждой damage part. Рукопашная атака не удерживаемым оружием, ranged weapon, natural weapon без отдельного удерживаемого Item и одно оружие в двух руках бонус не получают.

Pure predicate определения подходящей пары может находиться в `held-items.js`; решение добавить бонус к конкретному roll остаётся в `CombatAttackService`. Новый глобальный hook или второй источник состояния рук не создаётся.

## Identity resolution и конфликтующие evidence

Команда не доверяет одному имени или одному flag. Для каждого кандидата строится evidence set:

- `flags.rebreya-main.magicItemId`;
- `flags.rebreya-main.sourceType`;
- `flags.rebreya-main.sourceId`;
- `_stats.compendiumSource`;
- exact normalized display name;
- exact зарегистрированный alias;
- generic exact pattern для `Оружие +N`/`Доспех +N` с обязательной проверкой document type и native bonus.

Порядок решения:

1. Совпадающие stable ID и compendium source дают authoritative identity.
2. Один stable ID принимается, если exact name является каноническим именем или зарегистрированным вариантом шаблона, например `Лунный серп +1 (Серп)`.
3. External source принимается только через явный alias к каноническому предмету либо как `native external`, который не требует Rebreya-патча.
4. Конфликтующие evidence не разрешаются эвристикой. Требуется явное compatibility rule либо результат `unresolved`.

Подтверждённая аномалия acceptance corpus: `Кольцо характеристики +1 (Сила)` Кэссиди хранит `magicItemId: механистический-амулет` и source этого амулета, хотя display name заявляет кольцо. Для него вводится точное migration rule, которое классифицирует карточку как выбранное кольцо Силы и исправляет только managed identity/automation flags. Правило не применяется к любому произвольно переименованному механистическому амулету.

## Embedded merge contract

`MagicItemsCompendiumService.syncEquippedMagicItems({ dryRun = false } = {})` выполняет:

1. Проверяет dnd5e world и что текущий пользователь — active GM.
2. Вызывает существующий `sync()` и прерывает actor phase при ошибке compendium sync.
3. Загружает актуальные managed documents из `world.rebreya-magic-items` и строит detached automation projections.
4. Последовательно проходит все world Actor `type === "character"`.
5. Для каждого `equipped`/`attuned` Item разрешает identity и строит patch.
6. В `dryRun` только возвращает план.
7. В apply-mode вызывает один `actor.updateEmbeddedDocuments("Item", updates)` на Actor.

Patch сохраняет:

- `_id`, name и img embedded Item, если отдельное точное migration rule не меняет managed identity;
- `system.quantity`, `system.equipped`, `system.attuned`;
- item-level uses и activity `uses.spent` для совпадающих stable activity IDs;
- inventory folders, containers, durability, upgrades, held-hands и остальные runtime flags;
- сторонние и пользовательские effects/activities;
- cached-spell lifecycle, принадлежащий dnd5e.

Patch заменяет только:

- прежние managed magic-item effects;
- прежние managed magic-item activities;
- managed automation definition/signature/identity flags, когда identity доказана;
- отсутствующие canonical properties, необходимые конкретной автоматизации.

Эквивалентный сторонний effect не дублируется. Эквивалентность определяется нормализованной mechanical signature: effect change keys/modes/values либо activity type + linked spell UUID + resource contract. Совпадение только по display name недостаточно.

Удаление стороннего effect/activity запрещено. Если сторонний элемент конфликтует с canonical projection, Item получает `unresolved` с причиной `automation-conflict` и не изменяется.

## Совместимость с native cast activities

Новые cast activities следуют уже принятому контракту `docs/superpowers/specs/2026-08-16-native-instrument-spell-activities-design.md`: official UUID, cached spells dnd5e, отсутствие actor spell-slot consumption и детерминированные IDs.

Эта спецификация намеренно расширяет прежнюю границу: уже существующие embedded Items теперь могут получить managed activities ручной GM-командой. dnd5e продолжает владеть созданием и удалением cached spells. Миграция не создаёт cached spell Items напрямую.

## Ошибки и возвращаемый результат

Метод возвращает plain object:

```js
{
  dryRun,
  actorsScanned,
  itemsScanned,
  updated,
  unchanged,
  unresolved,
  unresolvedChoices,
  skipped,
  errors
}
```

`updated`, `unchanged`, `unresolved`, `unresolvedChoices`, `skipped` и `errors` содержат компактные detached rows с actor/item IDs, именами и reason code. Метод также вызывает `console.table()` для итоговых rows и возвращает полный object для дальнейшего анализа.

Ошибка одного Actor фиксируется и не останавливает остальные Actor. Глобальный rollback не создаётся: actor update выполняется одним batch, а вся операция идемпотентна и допускает безопасный retry. Ошибка compendium sync останавливает весь actor phase до первой world mutation.

## Публичный API

`RebreyaMainModule` получает тонкий delegate:

```js
async syncEquippedMagicItems(options = {}) {
  return this.magicItemsCompendium.syncEquippedMagicItems(options);
}
```

Поскольку `game.rebreyaMain` и `game.modules.get("rebreya-main")?.api` указывают на один instance, отдельный publisher или socket route не создаётся. Команда GM-only и предназначена для ручного запуска в консоли; player socket command не нужен.

README описывает apply- и dry-run-вызовы и явно предупреждает, что метод меняет все надетые/настроенные предметы всех character Actor мира.

## Изменяемые файлы и владельцы

- `scripts/data/magic-items-compendium.js` — canonical definitions, effects, activities, signature и method-owner;
- optional `scripts/data/magic-item-embedded-sync.js` — pure identity/merge helpers без самостоятельного lifecycle;
- `scripts/integrations/held-items.js` — pure predicate двух разных melee weapons в разных canonical hand slots;
- `scripts/combat/attack-service.js` — единственное runtime-применение `+2` к подходящему damage roll Перчаток двуручного боя;
- `scripts/main.js` — один public delegate;
- `tests/magic-items-compendium.test.mjs` — compendium projections;
- `tests/held-items.test.mjs` и `tests/combat-attack-service.test.mjs` — hand predicate и одноразовый conditional damage bonus;
- новый `tests/magic-item-equipped-sync.test.mjs` — world migration contract;
- `tests/main-composition-root.test.mjs` — public API composition;
- `README.md` — console API;
- `docs/function-passport.md`, раздел 15 — новые/изменённые методы, data flow, ограничения и профильные тесты;
- `module.json` и новый versioned `scripts/main-<version>.js` forwarder — обязательный cache-busting release bump.

`magicItem.js` является generated source и вручную не редактируется. Он меняется только через unified equipment importer, если source-описание или stable identity действительно требует исправления.

## Focused-тесты

### Compendium projection

`tests/magic-items-compendium.test.mjs` доказывает:

- точные effect keys/modes/values для каждого `effect`-предмета;
- отсутствие двойного native weapon/armor bonus;
- точные activity type, activation, spell UUID, uses, shared-resource costs и recovery;
- stable effect/activity IDs и managed flags;
- включение versioned automation projection в signature;
- отсутствие effects/activities у control/manual предметов;
- отсутствие безусловного damage Active Effect у Перчаток двуручного боя;
- новое additive darkvision-поведение Ночных очков;
- прежние native instrument activities не регрессируют.

### Embedded sync

Новый focused-тест доказывает:

- active-GM и dnd5e guards;
- обязательный compendium sync до actor phase;
- сканирование всех и только `character` Actor;
- фильтр `equipped || attuned`;
- отсутствие writes в `dryRun`;
- exact identity, registered aliases, generic +N patterns и conflict refusal;
- regression аномального кольца Кэссиди через exact migration rule;
- сохранение quantity, equipped, attuned, uses/spent, durability, upgrades и сторонних flags;
- merge без удаления сторонних effects/activities;
- отсутствие дублей при эквивалентной сторонней автоматизации;
- стабильный no-op при втором запуске;
- один embedded batch на Actor;
- продолжение после ошибки одного Actor;
- полный reason-coded report.

`tests/held-items.test.mjs` и `tests/combat-attack-service.test.mjs` дополнительно доказывают:

- два разных melee weapons в `left`/`right` дают бонус;
- дополнительные canonical hand slots также поддерживаются;
- одно двуручное оружие в двух руках не считается двумя оружиями;
- два документа в одном malformed hand slot не дают бонус;
- ranged, natural/unheld и неэкипированные weapons не дают бонус;
- освобождение или reservation руки немедленно выключает бонус;
- damage roll получает ровно один `+2`, независимо от числа damage parts;
- отсутствие/снятие Перчаток двуручного боя выключает бонус.

### Composition и manifest

- `tests/main-composition-root.test.mjs` проверяет delegate;
- `tests/module-manifest.test.mjs` проверяет новую versioned entrypoint-ссылку;
- при изменении публичного API проверяется README contract.

## Критерии готовности реализации

Реализация готова, когда:

1. focused-тесты проходят;
2. compendium sync создаёт ожидаемые effects/activities и не переписывает unmanaged documents;
3. `dryRun` на реальном мире выдаёт отчёт без world writes;
4. apply-команда обновляет все однозначно разрешённые надетые/настроенные предметы character Actor;
5. второй apply возвращает нулевое число изменений;
6. unresolved/manual items перечислены с причиной, а не молча пропущены;
7. cached spells создаются/удаляются dnd5e, а не Rebreya;
8. Перчатки двуручного боя дают `+2` только при подтверждённых двух разных melee weapons в разных руках Rebreya;
9. `docs/function-passport.md`, README, module version и forwarder синхронизированы;
10. выполнены focused и полные проверки из `AGENTS.md`;
11. commit отправлен в `origin/lich_branch` без force push.
