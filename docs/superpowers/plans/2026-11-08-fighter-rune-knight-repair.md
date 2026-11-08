# Восстановление воина и рунного рыцаря. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Восстановить существующую автоматизацию и прогрессию двух классовых контуров по утверждённой спецификации.

**Architecture:** Компендий формирует прогрессию и стабильные ссылки. FighterAutomationService и RuneKnightAutomationService остаются владельцами классовых ресурсов, эффектов и проверок, подключаясь к существующим боевым хукам, очереди реакций и координатору размера. План разделён на два независимо проверяемых контура и общий выпуск.

**Tech Stack:** JavaScript ESM, Node test runner, Foundry 13/14, dnd5e 5/6, MIDI-QOL, DAE.

**Spec:** `docs/superpowers/specs/2026-11-08-fighter-rune-knight-repair-design.md`.

## Общие ограничения

- Базовая конфигурация для проверки по исходникам — Foundry 14.369, dnd5e 6.0.6, Midi-QOL 14.6.8, DAE 14.6.6. Старые форматы карточек и хуков Foundry 13 / dnd5e 5 поддерживаются. Для проверки интерфейса живого мира требуется явное разрешение.
- Сохранять источники правил, настройки, идентификаторы, сохранённые выборы и расход. Руны активны при владении, восстанавливаются после короткого или длительного отдыха, «Мощь великана» использует БМ и затем предлагает кость доминирования.
- Подтверждать каждую регрессию failing-тестом перед исправлением. Использовать только `lich_branch`. При удалённом опережении или чужих правках остановиться. Обновить паспорт, README при изменении пользовательского контракта и версию entrypoint до выпуска.
- Маршрут для чужого Actor подтверждает исходного владельца, использование, источник и точный Token/Actor. Данные эффекта и урона вычисляет доверенный владелец. Повторная доставка не повторяет запись. Сценарии со связанным поведением второго этапа здесь ограничиваются уже существующими эффектами.

## Review Focus

- Обновление и последующее удаление одного истёкшего эффекта «Мощи великана» возвращают размер ровно один раз. Проверяется в задаче Р1.
- Два токена одного персонажа и второе попадание в активной группе получают только предусмотренную добавку. Проверяется в задаче Р3.
- Сбой загрузки нового варианта мультиатаки и повышение уровня существующего мультикласса не удаляют выбор и не меняют размер пула. Проверяется в задачах В1 и В2.
- Одновременное «Второе дыхание» по кнопке и через «Железную волю» расходует пул и лечит ровно один раз. Проверяется в задаче В2.
- Многоцелевой MIDI workflow с укрытием, сменой цели и повторным событием не переносит урон или реакцию на непричастного участника. Проверяется в задачах В3, Р2 и Р3.

## Воин

### В1. Прогрессия и общий ресурс

**Файлы:** `scripts/data/classes-compendium.js`, `scripts/data/fighter-automation.js`, `scripts/combat/fighter-automation-service.js`; проверки `tests/classes-compendium.test.mjs`, `tests/fighter-automation-service.test.mjs`, `tests/combat-attack-service.test.mjs`.

- [ ] Добавить тесты `fighter maneuver consumption resolves the generated resource identifier`, `fighter chooses multiattack at long rest without a level two variant grant`, `fighter grants one general feat choice at levels six and fourteen`, `superior technique increases the existing dominance pool by one`, `failed multiattack replacement preserves the previously selected variant`. Проверить равенство цели списания `resource.system.identifier`, отсутствие UUID трёх вариантов в level-2 grants, точные уровни и размер выбора 1, изменение пула на 1 и отсутствие удаления до успешного создания замены.
- [ ] Выполнить `node --test tests/classes-compendium.test.mjs tests/fighter-automation-service.test.mjs tests/combat-attack-service.test.mjs`. Новые тесты должны упасть по соответствующим расхождениям, а прежние пройти.
- [ ] В `createFeatureSystem(feature,classIdentifier,featureAutomation,context)` и генераторе приёма сохранить идентификатор ресурса и выдать совпадающую consumption target. Старый `CombatAttackService` retarget должен принять оба формата. В `buildClassAdvancement(classData,context)` исключить выдачу трёх вариантов и добавить два выбора из каталога общих и явно эквивалентных черт. Сверка advancement сохраняет значения по стабильному ID. Стиль «Превосходная техника» модифицирует существующий пул на 1, сохраняя формулу шкалы, правила отдыха и выбор трёх приёмов. В `#handleMultiattackRestChoice(actor,progress)` сначала материализовать выбранный Item, затем очистить прежние.
- [ ] Повторить три файла тестов. Старые ожидания, закреплявшие расхождение идентификаторов или выдачу всех вариантов, заменить проверками утверждённого контракта.

### В2. Второе дыхание и Железная воля

**Файлы:** `scripts/combat/fighter-automation-service.js`, `scripts/data/fighter-automation.js`, `scripts/combat/hooks.js`, `scripts/combat/grouped-turn-automation.js` по необходимости; проверка `tests/fighter-automation-service.test.mjs`.

- [ ] Добавить тесты `second wind uses fighter levels before sheet repair`, `second wind admits one use across manual and iron will calls`, `failed second wind payment preserves HP and available dice`, `iron will prompts once for the active owner across both turn entry points`, `iron will sets disadvantage only on the chosen completed save`. Зафиксировать мультикласс 3 воина / 4 всего, границу ровно половины HP, нулевые HP, исходную стоимость, отказ, отмену, неуспешную запись и истечение в конце следующего собственного хода.
- [ ] Выполнить `node --test tests/fighter-automation-service.test.mjs`. Новые тесты должны показать ошибочный ресурс, повторное применение или неверный контракт помехи.
- [ ] Сохранить `applyDnd5ePostUseActivity(activity,usageConfig,results)` и `handleCombatTurnChange(combat,updateData)`. Дать обоим путям одного владельца и одну идентичность Actor/Combat/turn. В `#useSecondWind(actor,item,automation)` повторно валидировать остаток и ход после ожидания выбора, сериализовать запись, сохранить согласованность расхода и лечения при отказе. Для Железной воли использовать выбор владельца и параметры одного `#rollManeuverSave(target,ability,sourceActor,sourceDocument)`, а не постоянный флаг помехи на чужом Actor. Зачесть только завершённый бросок, на который игрок согласился.
- [ ] Повторить профильный файл и тесты обычных и групповых ходов `tests/grouped-combat-provider-contracts.test.mjs`.

### В3. Связь приёма с атакой, целью и списанием

**Файлы:** `scripts/combat/fighter-automation-service.js`, `scripts/combat/attack-roll-boost-service.js`, `scripts/combat/attack-service.js`, `scripts/combat/hooks.js`, `scripts/data/classes-compendium.js`, `scripts/data/fighter-automation.js`; проверки одноимённых сервисов и генератора.

- [ ] Добавить тесты `fighter uses the stored target and actual weapon hit`, `fighter rejects unrelated workflow and canceled saves without applying a status`, `fighter does not spend twice after dnd5e item delta`, `fighter preserves one maneuver per triggering attack`, `fighter binds subsequent and allied damage to the declared action`, `fighter maneuver activation follows source timing`. Проверить актёра, цель и тип урона через один связанный бросок, карточки v5/v6, критический промах и повтор. Покрыть правильные сохранённые цели «Удара командующего» и «Широкой атаки», нераспознанный бросок и отсутствие прав на чужую цель. Проверить активации «Атаки с манёвром», «Удара командующего», «Опрокидывающей атаки» и «Быстрого броска».
- [ ] Выполнить `node --test tests/fighter-automation-service.test.mjs tests/attack-roll-boost-service.test.mjs tests/combat-attack-service.test.mjs tests/classes-compendium.test.mjs`. Тесты должны поймать фактический неправильный выбор цели, неявную активацию и расход.
- [ ] Привязать `applyMidiRollComplete(workflow)` и `applyDnd5ePostUseActivity(activity,usageConfig,results)` к идентичности использованной атаки и цели из usage-карточки. Использовать текущие идентификаторы Token и подтверждённые стадии боевого workflow для надбавок. Для последующих атак сохранять адресную ожидающую связь на срок описанного триггера. Повторный хук использует результат того же применения. Сохранить существующее чтение положительной дельты конкретного Item и старых карточек. Сервис точной атаки учитывает тот же лимит применения. Для подтверждённого эффекта на чужом Actor использовать маршрут с проверкой текущей карточки, токена, владения и шаблона эффекта. Явные параметры активации задавать для неоднозначных приёмов. Подтверждённый урон и расход переживают отмену последующего спасброска, статус не создаётся.
- [ ] Повторить четыре файла тестов. Проверить, что исходные 24 карточки сохраняют расход и возможность использования, а проверки не подменяют цель текущим выбором.

## Рунный рыцарь

### Р1. Владение, пассивы и жизненный цикл эффектов

**Файлы:** `scripts/combat/rune-knight-automation-service.js`, `scripts/data/rune-knight-automation.js`, `scripts/data/classes-compendium.js`, `scripts/combat/natural-reach.js`, `scripts/combat/hooks.js`; проверки `tests/rune-knight-automation-service.test.mjs`, `tests/classes-compendium.test.mjs`, `tests/natural-reach.test.mjs`.

- [ ] Добавить тесты `v14 expiry restores the giant form once and permits reuse`, `expired rune effects do not block activation or process turn effects`, `incapacitation ends the storm state`, `fire tool expertise upgrades only a proficient tool`, `juggernaut reach requires both the feature and current Huge size`, `owned rune deletion removes only effects from that item`. Проверить событие обновления без удаления документа, disabled/suppressed, повтор доставки, последующее удаление, 0/1/2 кратность владения, сопротивления и точное происхождение эффектов.
- [ ] Выполнить `node --test tests/rune-knight-automation-service.test.mjs tests/classes-compendium.test.mjs tests/natural-reach.test.mjs`. Убедиться, что тесты реагируют на оставшийся после expiry документ и лишний бонус экспертизы.
- [ ] В `handleEmbeddedEffectChange(effect)` и `handleEmbeddedEffectDeletion(effect)` распознать завершение формы и выполнить восстановление одним владельцем с дедупликацией. Общая проверка активного эффекта учитывает штатное свойство и старые документы. Пророчество завершается при недееспособности. Пассив Огненной руны отдаёт нативное правило экспертизы, сохраняя поддержку ранее выданных предметов без удвоения двух путей. `getNaturalReachFeet(actor)` добавляет бонус формы только при реально Огромном размере и наличии умения. Поддержать точные локализованные имена Великого роста и Джаггернаута у старых карточек. Удалять эффекты цели по точному источнику и проверенным полномочиям. Для Ледяной руны сначала проверить текущий shim, менять только при воспроизводимом сбое.
- [ ] Повторить три файла. Сверить PB/LR, SR/LR, 2/3/4/5 известных рун, двойную ёмкость Мастера рун и один бросок 3d4.

### Р2. Каменная, Облачная, Холмовая, Штормовая руны и Рунический щит

**Файлы:** `scripts/combat/rune-knight-automation-service.js`, `scripts/combat/hooks.js`; проверки `tests/rune-knight-automation-service.test.mjs`, `tests/grouped-combat-provider-contracts.test.mjs`.

- [ ] Добавить тесты `stone uses reactor visibility and resolves each valid end-turn save once`, `stone ignores canceled saves and charm immunity`, `cloud redirects the selected eligible hit without rolling again`, `runic shield replaces one d20 and preserves cover and bonus terms`, `hill grants advantage only on poison saves`, `storm updates the target choice without altering shared midi options`. Проверить первый неподходящий и второй подходящий hit, EC hit, отказ, неуспешную оплату, ID точного токена, два варианта спасброска в MIDI и отсутствие повторного окна реакции при пересчёте.
- [ ] Выполнить `node --test tests/rune-knight-automation-service.test.mjs tests/grouped-combat-provider-contracts.test.mjs`. Проверить ошибки на отменённом броске, видимости, полном перебросе и утечке workflowOptions.
- [ ] В `applyMidiHitsChecked(workflow)` и текущих providers revalidate по точному кандидату и сохранённому hit. Пересчёт использует уже вычисленные MIDI-модификаторы и обновляет цели и получателей без повторного окна. Для щита построить бросок из одного нового d20 и прежних вычисленных остальных слагаемых, сохранить critical/fumble и согласованный снимок при rollback. Stone использует видимость реагирующего и единственного владельца повторного спасброска. Hill получает структурированное подтверждение типа источника. `applyMidiStormPreRoll(context,type,options)` разделяет изменения атаки и конкретного спасброска и обновляет tracker выбранного режима до броска.
- [ ] Повторить два файла. Подтвердить, что успешное применение расходует одну реакцию и один положенный ресурс.

### Р3. Урон Огненной руны и Мощи великана

**Файлы:** `scripts/combat/rune-knight-automation-service.js`, `scripts/combat/hooks.js`; проверки `tests/rune-knight-automation-service.test.mjs`, `tests/whirlwind-native-damage.test.mjs`.

- [ ] Добавить тесты `fire rollback keeps ordinary weapon damage alive`, `fire damage and shackles use the selected hit only`, `giant might offers damage on a confirmed hit in an active group`, `giant might decline and cancelled native damage do not claim the MIDI use`. Покрыть динамический MIDI preDamageRollComplete, стандартный и круговой workflow, второго участника группы, отмену спасброска, повторы ходов, сохранение 2d6 и формул 1d6/1d8/1d10, падение записи эффекта и сохранение штатного оружейного урона.
- [ ] Выполнить `node --test tests/rune-knight-automation-service.test.mjs tests/whirlwind-native-damage.test.mjs`. Ошибки должны показать потерю оружейного workflow или ложное занятие лимита.
- [ ] Применять бонус по существующему ожидающему MIDI-хуку после подтверждённого попадания и до применения урона. Локальный сбой руны возвращает её ресурс и её данные урона, оставляя успешным штатный хук. Маршрутизировать выбранному получателю через существующую адресную механику урона. В `#giantMightDamageKey(workflow,actor)` учитывать точное членство в активном ходе через `isCombatActorActive(combat,actorOrToken)`. Предложение через общую очередь, один успешный расход права за ход. `applyDnd5eGiantMightDamage(rollConfig,dialogConfig,messageConfig)` сохраняет нативный fallback отдельно от того же MIDI workflow.
- [ ] Повторить оба файла и проверку связанных правил хода. Убедиться, что после отказа бонус можно выбрать на следующем попадании того же хода.

## Выпуск

- [ ] Обновить затронутый раздел `docs/function-passport.md` по каждому изменённому владельцу, `README.md` по изменённым пользовательским контрактам, `module.json` и его единственный forwarder на следующую версию. Поднять cache keys для изменённых импортов без двух URL одного владельца.
- [ ] Запустить `node --test tests/*.test.mjs`, `node --check` для отслеживаемых JS/MJS и нового forwarder, разбор каждого отслеживаемого JSON через `ConvertFrom-Json`. Проверить `git diff --check`, `git diff --stat`, содержательный diff, точный список staged файлов и состояние remote.
- [ ] Проверить исправления против утверждённой спецификации и зафиксировать расхождения или незакрытые сценарии живого мира. Сделать осмысленный commit из файлов этапа и `git push -u origin lich_branch`. Проверить итоговые commit и remote tracking. Отчёт включает обе ссылки на документы и числа проверок.

## Решения при реализации

- Для записи по чужой цели активный GM подтверждает применение по карточке. Карточка служит связью с попаданием, но её редактирует игрок. Подтверждение и квитанция принадлежат GM. Если карточка недоступна, выполнение автоматической записи останавливается.
- «Удар командующего» хранит связь на Actor воина. Клиент выбранного союзника проверяет текущий ход и точный токен, затем фиксирует применение у себя. Связь работает для вручную совершённой атаки в рамках этапа 1.
- Старая схема Ледяной руны остаётся рабочей через преобразование dnd5e. Очистка эффектов удалённой руны проверяет актёров по точному UUID источника только на событии удаления.
- Профильные проверки используют имитации двух клиентов и исходники установленных версий. Проверка на живых клиентах Foundry остаётся отдельной.
