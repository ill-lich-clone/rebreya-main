# R7 — бонусы и простые эффекты усовершенствований

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

**Результат:** доступные материалы и зачарования автоматически дают целиком свой простой эффект. У сложных и неподдержанных показано «Усовершенствования нет в реализации». 11 существующих проклятий сохраняют поведение.

**Зависимости:** R4: stable manifest, compatibility/activation, value. Читать [спецификацию](../../specs/2026-09-07-module-development/upgrades.md), [91-row матрицу](../../specs/2026-09-07-module-development/upgrade-scope.md), паспорт 14–16 и docs/curse-upgrades-function-passport.md только по затронутым provider names.

**Граница:** не вводить ресурсы/ауры/реакции/историю хода, новые activities, spells или перемещение ради профиля. Если полное правило требует этого, исключить весь профиль с причиной. Статус simple-candidate ещё не означает работающий эффект.

## Задача R7.1 — допуск каждого кандидата к существующему владельцу

**Файлы:** data/upgrade-automation-manifest.json, scripts/data/upgrade-automation-manifest.js, docs/superpowers/specs/2026-09-07-module-development/upgrade-scope.md; новые tests/item-upgrade-simple-coverage.test.mjs и tests/fixtures/simple-upgrade-scenarios.mjs.

- [ ] Для всех 42 candidate найти точный effect в data/upgrades.json по productId и его gearId в data/gear.json. Проверить целое правило, условия активности и единицы; не исполнять описание как код.
- [ ] Для каждого записать owner, supported capabilities, входные source поля, stacking policy и сценарии. Простая новая проекция внутри существующего modifier owner допустима; новый state/workflow для сложного правила — нет.
- [ ] Fixture каждого профиля содержит productId, host/actor/target исходные данные, expected contributions и lifecycle cases. Нельзя покрыть 42 профиля одним assert, что manifest содержит 42 строки.
- [ ] Таблица партий ниже задаёт минимальный проверяемый результат. Профиль с несколькими частями становится implemented только после проверок всех частей.

| Партия / stable productId | Проверяемый контракт |
|---|---|
| dushevnoe-zacharovanie | Persuasion и Performance +1, остальные skills прежние |
| oskolok-cherepa-chudovishcha | Intimidation +1 |
| koren-drakonego-dereva | HP max +5; sync сам не лечит current HP |
| poroshok-drokhuby, sherst-griffona | Walk +10/+5 ft с учётом единиц и базового наследования |
| maloe-zacharovanie-stoykosti | Saves +1 |
| maloe-zacharovanie-zashchity | AC +1 |
| zacharovanie-zashchity | AC +1 и saves +1 |
| velikoe-zacharovanie-zashchity | AC, saves и flat absorption +1; если absorption не поддержан, весь профиль недоступен |
| zacharovanie-lyogkosti | Вес host −10 lb, минимум 0, исходный вес восстанавливается |
| khitinovoe-pokrytie | Убирает собственный armor stealth disadvantage, не внешнюю помеху |
| mifrilovaya-peredelka-dospekha | Убирает armor stealth disadvantage и Strength requirement |
| lunnyy-metall | Решение по исходному stealth flag: убрать помеху либо дать преимущество; повтор sync не меняет ветку |
| zacharovanie-pryzhkov | Длина и высота прыжка +5 ft только через подтверждённый existing projection |
| serdtsevina-drevnya | Healing +2 через существующий healing modifier; не новый healing workflow |
| maloe-zacharovanie-ostroty, sukhozhilie-chudovishcha | Damage своего host +1 |
| zacharovanie-ostroty | Attack и damage своего host +1 |
| ledyanaya-maz, ognennaya-maz | +1d6 cold/fire своего оружия |
| zacharovanie-nekromantii | +1d3 necrotic своего оружия |
| svyashchennaya-stal | Radiant и удвоение только исходных базовых weapon dice |
| dyavolskoe-zhelezo, elfiyskaya-stal, iskazhayushchaya-stal | +2 damage против celestial/undead/elemental соответственно |
| kristally-zabytykh-titanov | +2 damage против giant или fiend; совпадение не даёт +4 |
| korichnevaya-stal | +2 attack против humanoid |
| kosti-mantikory | +1d4 poison против humanoid |
| nochnaya-stal | Advantage при известной passive Perception текущей цели <12 |
| oskolki-meteoritnykh-zvyozd | +2 damage при уже разрешённом advantage текущей атаки, без зацикливания вычислений |
| gigantskiy-kogot, zhalo-chudovishcha | Существующие свойства «Смертельное»/«Отравляющее»; отсутствие owner исключает профиль |
| serebrenie-oruzhiya | Silver property и magical только против undead/fiend; не делать всё оружие magical глобально |
| cheshuya-monstra, zacharovanie-pogloshcheniya | Absorption 2/1 выбранного при установке damage type |
| fragment-pantsirya-chudovishcha | Slashing absorption 1 |
| pantsir-chudovishcha | Slashing и piercing absorption 1 |
| shkura-chudovishcha, zakalyonnaya-cheshuya | Bludgeoning/piercing absorption 1 |
| khrebet-chudovishcha, oskolok-kosti-chudovishcha | Все absorption/weakness clauses и nonmagical predicate из полного catalog effect |
| essentsiya-sveta-2 | Absorption 3 radiant и 3 от undead по полному правилу; источник damage должен быть известен |

- [ ] Coverage test сравнивает множества productId матрицы/manifest/scenarios; every simple-implemented имеет actual executable case и owner. Для unsupported хранить reason, а не заглушку effect.
- [x] Существующие 11 curses отмечать existing-curse; их service/cooldowns/debts не копировать в новый provider.

## Задача R7.2 — чистая проекция и обратимый lifecycle

**Файлы:** новые scripts/automation/item-upgrade-projections.js, scripts/automation/item-upgrade-automation-service.js, tests/item-upgrade-projections.test.mjs, tests/item-upgrade-automation-service.test.mjs; существующие scripts/data/item-upgrade-service.js, scripts/main.js и канонические lifecycle hooks.

- [x] Чистый API buildSimpleUpgradeContributions({actor,hosts,manifest,capabilities}) → {contributions,unavailable}. Hosts содержат original data и валидные installed links. Contribution: {key,hostItemId,upgradeItemId,effectKey,scope,operation,value,condition}; scope actor/host/roll, operation — ограниченный enum adapter, не произвольный eval/path клиента.
- [x] Ключ buildUpgradeContributionKey({actorUuid,hostItemId,upgradeItemId,effectKey,projectionVersion}) собирать без коллизий:

```js
export function buildUpgradeContributionKey({
  actorUuid, hostItemId, upgradeItemId, effectKey, projectionVersion
}) {
  return JSON.stringify([
    actorUuid, hostItemId, upgradeItemId, effectKey, projectionVersion
  ]);
}
```

- [x] Реализован ItemUpgradeAutomationService(moduleApi,options={}) с requestSync(actorOrUuid,reason) и syncActor(actorOrUuid). readHosts/project читают свежие source и installed состояния; syncActor меняет только managed contributions данного владельца; существующий WorldMutationCoordinator объединяет одновременные requests одного Actor. Фактический контракт записан в docs/simple-item-upgrades-function-passport.md.
- [ ] До реализации написать тест: install → sync → sync не накапливает bonus; unequip/remove/transfer/сломанное состояние убирает только вклад соответствующего upgrade. Условия broken/attuned/held задаются R4 profile, а не одинаковым предположением для всех.
- [x] Источником служат _source/канонический baseline, не поле после предыдущего projection. Если требуется managed ActiveEffect, пометить его собственным source key и применять actor/host change через проверенный native path. Не добавлять один эффект одновременно в AE и prepareData.
- [x] AC интегрировать с существующим bonus path, walk — с наследуемым base движения, а вес/armor properties — с исходными данными host. Перед выбором path проверить локальную dnd5e schema и существующий adapter тестом; строка path из похожей версии не доказательство.
- [x] Изменение исходного веса/AC самим пользователем во время активности должно стать новой базой. Снятие upgrade не восстанавливает устаревшую копию Item поверх его редактирования.
- [x] На активном GM делать только необходимые persisted managed writes; derived read projections могут рассчитываться локально одинаково. Loop suppression основан на source key/сравнении результата, не на глобальном пропуске всех Item hooks.
- [x] Синхронизация после install/remove, переноса host/child, equipped/held/attuned, релевантного Actor update и ready. Один общий lifecycle subscription, cleanup и очередь; не по hook на строку каталога.
- [x] Две одинаковые вещи с разными Item IDs дают независимые contributions. Две копии same-name profiles учитываются по записанной stacking policy, а не name. Копии effect IDs не мигрируют между Actor.
- [x] Сохранить пользовательские ActiveEffects и все curse-owned contributions. Regression проверяет совместное ношение curse и simple upgrade на разных hosts.

## Задача R7.3 — атаки, damage, absorption и обязательный выбор

**Файлы:** существующие scripts/combat/attack-service.js и найденные через паспорт attack/damage/native adapters; scripts/automation/item-upgrade-projections.js; новые tests/item-upgrade-roll-modifiers.test.mjs и tests/item-upgrade-absorption.test.mjs; tests/item-upgrade-service.test.mjs.

- [x] Экспортировать evaluateSimpleUpgradeRoll({host,attack,target,contributions}) → {attackBonus,advantage,damageParts,properties,diagnostics}; она вызывается существующим владельцем атаки, не инициирует новый roll.
- [ ] attack содержит уже разрешённые mode/advantage, primary packet и damage classification. target содержит тип и passive Perception только если они известны authority. Не парсить локализованное имя монстра и не угадывать отсутствие скрытого поля.
- [x] Concrete source isolation test: host A с огненной мазью даёт ровно один дополнительный fire 1d6; атака host B, вторичный packet и повторный hook не получают его снова. Critical обрабатывается штатным owner один раз, без ручного второго удвоения.
- [x] Для святой стали умножать dice count исходной базовой формулы. Пример 1d8 + 1d6 fire → radiant 2d8 + прежний 1d6 fire, без превращения всей формулы в 2d8+2d6 и без повторного 4d8 на следующей атаке. Проверить catalog exceptions перед implemented.
- [x] Predicate по advantage оценивается после штатной отмены преимуществ/помех. Unknown target → объяснимое отсутствие условного эффекта; actor-wide advantage не используется как подмена результата конкретной атаки.
- [ ] Absorption/weakness добавлять через существующий damage reducer в его принятом порядке. Не писать post-update HP компенсацию. Проверить смешанные damage types, magical/nonmagical, unknown source, radiant+undead intersection и native/MIDI capability; нельзя дважды снизить один packet.
- [x] Если порядок stacking для конкретного полного catalog rule не определён существующими правилами, не объявлять профиль implemented до решения. Сохранить diagnostic reason.
- [x] Для choices использовать finite whitelist damage types из системы. ItemUpgradeService сохраняет choices на установленной единице; cancel до выбора — нет split/install/effects. Перенос/reload не запрашивает выбор заново. Старый профиль с отсутствующим choice получает статус «требуется выбор», не случайное значение.
- [x] Lootgen R8 использует тот же валидатор choices. Валидный generated choice становится сохранённым параметром upgrade, не новым UI prompt при claim.

## Задача R7.4 — статусы в UI и выпуск двух партий

**Файлы:** scripts/integrations/item-upgrade-sheet.js, профильный template/styles, data/upgrade-automation-manifest.json, tests/item-upgrade-simple-coverage.test.mjs; README и паспорт 14–17, curse passport только если изменились общие сигнатуры.

- [ ] Новая установка/выбор в лутгене показывает только existing-curse/simple-implemented с полной compatibility. Недоступные позиции можно просмотреть с точной надписью пользователя и причиной; не выдавать их за работающую кнопку.
- [x] Старые Item с complex profile не удалять, не очищать их installed links и пользовательские эффекты. Read показывает статус и оставляет данные.
- [ ] Партию пассивных проекций завершить focused/live до подключения attack predicates. В каждом commit manifest отмечает implemented только реально готовые профили; промежуточный релиз не заявляет готовность всех 42.
- [ ] Финальная таблица содержит 91 строку, 11 existing curses; все 42 candidates получили implemented либо unavailable с причиной, незавершённых candidate нет. Число implemented не фиксировать заранее.
- [ ] Live: install/equip/remove/reload, две одинаковые вещи, перенос другому Actor, изменение исходного веса, две руки, цель нужного/другого типа, native и подключённые optional integrations. Ноль новых console errors.

**Итоговые focused:** node --test tests/item-upgrade-simple-coverage.test.mjs tests/item-upgrade-projections.test.mjs tests/item-upgrade-automation-service.test.mjs tests/item-upgrade-roll-modifiers.test.mjs tests/item-upgrade-absorption.test.mjs tests/item-upgrade-service.test.mjs tests/combat-attack-service.test.mjs tests/curse-upgrade-automation-service.test.mjs. Добавить фактически затронутые curse damage/save tests по паспорту; не перечислять несуществующие файлы по предположению.

## Выпуск этапа

- [ ] Выполнить полный профиль focused-тестов этого плана; записать фактические passed/failed.
- [ ] Пройти перечисленные live-сценарии в выделенном тестовом Foundry-мире. Сохранить viewport, версии, GM/player и console result. Если live недоступен, оставить этот пункт открытым.
- [x] Обновить профильные методы паспорта и README при изменении public contract.
- [x] Поднять актуальную patch version в module.json; создать/переименовать versioned forwarder с единственным import "./main.js"; обновить esmodules. Проверить отсутствие старых runtime-entrypoint ссылок.
- [x] Выполнить один полный цикл команд из README этого комплекта, проверить содержательный diff, stat и diff --check.
- [x] Stage только перечисленных файлов текущего этапа и обязательных manifest/docs; осмысленный commit; git push -u origin lich_branch. Проверить чистую рабочую копию и HEAD...origin/lich_branch = 0/0. Не включать чужие изменения.

**Предлагаемые commits:** feat: project passive item upgrade bonuses; feat: apply supported item upgrade roll modifiers.

## Пассивная партия — 2026-09-08, 1.4.253

Реализованы 12 полных профилей: Душевное зачарование, Осколок черепа чудовища, Корень драконьего дерева, Малое зачарование стойкости, Малое зачарование защиты, Зачарование защиты, Порошок дрохубы, Шерсть гриффона, Хитиновое покрытие, Мифриловая переделка доспеха, Лунный металл и Зачарование лёгкости. Контракты/поля/ограничения — [паспорт простой автоматизации](../../../simple-item-upgrades-function-passport.md).

Исходные «42 кандидата» относятся к ранней плановой матрице. R4 уже исключил 5 по результатам проверки полного правила, поэтому перед R7 оставалось 37. После этой партии manifest содержит 12 simple-implemented, 25 simple-candidate, 11 existing-curse и 43 unavailable. Следующая партия этого же этапа — attack/damage/absorption и choices; весь R7 ещё не завершён.

Pure projection и native lifecycle тестируют все 12 профилей, обе ветви лунного металла, inactive/broken, отдельные Items с одинаковым именем, idempotent sync, foreign/curse effects, authority loss и повторный prepareData. Найденное в live накопление −10 lb исправлено через source-aware before/after restoration только собственного derived вклада. Native HP path различает character с рассчитанным максимумом и NPC/explicit max; на NPC bonuses.overall не работает.

Live: testovyj3, Foundry 13.351, dnd5e 5.2.5, CODEX (не active GM), viewport 1292×920. Через реальный ItemUpgradeService установлены мифрил/лёгкость/защита на временный доспех: weight25→15, повтор prepareData→15; source edit40→derived30; мифрил снимает stealthDisadvantage и strength15→0. После remove: weight40/source40, strength15, stealthDisadvantage восстановлен. Native AE schema отдельно проверена временным QA effect: AC16→17, walk30→35, +1 saves/per/prf/itm, NPC maxHP20→25, stealth roll.mode0→1; удаление effect вернуло значения. QA Actor, Items и временные effects удалены.

**Открытая приёмка:** активный Gamemaster ещё не обновлён. Поэтому автоматическая запись managed AE через его lifecycle, отдельный player, перенос между Actor и полный replay после GM reload остаются открытыми. Проверка native полей временным QA effect не подменяет проверку этого маршрута. Runtime не подделывает authority и не выполняет GM-only writes на CODEX.

Проверки партии: `node --test tests/*.test.mjs` — **3771 passed / 0 failed**; синтаксис **746 JS/MJS и 46 JSON, 0 ошибок**; `git diff --check` без ошибок. До окончательных HP/coverage additions профильный набор давал 88/0; новые focused projection/service/coverage проверки и полный запуск подтверждают окончательный состав. Версия module.json/forwarder/esmodules — 1.4.253.

## Оружейная партия — 2026-09-08, 1.4.254

Добавлены 15 полных профилей: Малое зачарование остроты, Сухожилие чудовища, Зачарование остроты, Огненная мазь, Ледяная мазь, Зачарование некромантии, Дьявольское железо, Эльфийская сталь, Искажающая сталь, Кристаллы забытых титанов, Коричневая сталь, Кости мантикоры, Ночная сталь, Осколки метеоритных звёзд, Священная сталь. Manifest: 27 implemented, 10 candidate, 11 existing-curse, 43 unavailable. Поглощение/choices и итоговая приёмка R7 остаются открытыми.

Native adapter вызывается существующим CombatAttackService; он не создаёт броски или отдельный damage engine. Дедупликация относится к конфигурации конкретного броска; вклад изолирован своим host и primary packet. Target predicates и преимущество конкретной атаки проверяются без догадок; неодинаковые цели требуют отдельных бросков. Священная сталь меняет базовые dice derived Item, дополнительные fire/cold/etc сохраняются. Контракты и все методы — в паспорте простой автоматизации.

Live, тот же testovyj3 / Foundry13.351 / dnd5e5.2.5 / CODEX: реальные install трёх upgrades на временный weapon. Native rollAttack: `1d20 + 1 + 3 + 2`; rollDamage: radiant `2d8 + 3 + 1` и fire `1d6`; critical: radiant `4d8 + 3 + 1` и fire `2d6`. Броски выполнены без публикации сообщений и без изменения HP. Source остаётся `1d8 slashing`; изменение source number на2 даёт derived4, снятие стали возвращает2/slashing. QA Actor и все embedded Items удалены. Найдено и исправлено повторное добавление native base packets при initialization: Actor.reset вместо прямого prepareData. После reset/reload ровно один base packet.

Focused: `node --test tests/item-upgrade*.test.mjs tests/upgrade-automation-manifest.test.mjs tests/module-manifest.test.mjs tests/combat-attack-service.test.mjs` — **153 passed / 0 failed**. Полный MIDI workflow с targeted conditions, отдельный player и managed AE lifecycle после обновления активного GM ещё требуют приёмки; direct native damage/attack не подменяют её.

Полная проверка: `node --test tests/*.test.mjs` — **3785 passed / 0 failed**; `node --check` для **751 JS/MJS**, parse **46 JSON**, **0 ошибок**; `git diff --check` чисто.

## Поглощение и choices — 2026-09-08, 1.4.255

Добавлены 8 полных профилей: Чешуя монстра, Фрагмент панциря чудовища, Хребет чудовища, Осколок кости чудовища, Панцирь чудовища, Шкура чудовища, Зачарование поглощения, Закалённая чешуя. Manifest: **35 implemented / 2 candidate / 11 existing-curse / 43 unavailable**. Два кандидата не объявлены готовыми: Эссенция света ожидает ответа о сложении radiant3+undead3, Великое зачарование защиты — о расходе общего поглощения на смешанное попадание. Вопрос отправлен пользователю; независимые этапы продолжаются.

Общий CurseUpgradeDamageAdapter расширен simple flat modifiers, без второго damage engine. Сохраняются save→absorption→resistance и минимум1. Отдельные свойства same-type компонентов и unknown magic учитываются. MIDI flat modifier расходуется один раз на combined default/bonus/other; ignored modifications, нулевой урон, повторный hook и чужие curse bonuses покрыты focused regression.

Finite choices в `item-upgrade-choices.js` используются install и projection, предназначены для R8 generation. Validated choice сохраняется на установленной единице до завершения split/install, исходный остаток стопки не меняет выбор. Existing drop UI показывает DialogV2 до первой мутации; cancel/close no-op. Исторический child без выбора даёт видимый статус и не получает случайный эффект.

Live: testovyj3, Foundry13.351/dnd5e5.2.5/MIDI13.0.61, CODEX, viewport1292×920. Диалог виден полностью; пять русских названий типов чешуи; Cancel оставил quantity2/items4/links0. Install отделил1 и сохранил `{damageType:fire}`. Native Actor.calculateDamage: fire10→8; normal+magical slashing6+6 с двумя разными absorption→10; nonmagical bludgeoning6→7. При multiplier0.5: fire→3, суммарный slashing→4, bludgeoning→4. Через настоящий native/MIDI calculateDamage в existing preTargetDamageApplication, DRSaveDr: raw fire8+4 после save0.5 и absorption2→4 HP preview, фактические HP20 неизменны. После Actor.reset все4 contributions на трёх children сохранены; после remove fire10→10. QA Actor и Items удалены.

Focused: `node --test tests/item-upgrade*.test.mjs tests/curse-upgrade*.test.mjs tests/module-manifest.test.mjs` — **160 passed / 0 failed**. Проверка native/MIDI расчёта без полного attack workflow не закрывает отдельного player, synthetic tokens и общий GM lifecycle; эти пункты приёмки остаются открытыми.

При финальном ревью добавлен regression для MIDI noCalc: такой slice не участвует в расходе плоского поглощения рассчитанного slice. До исправления получалось9.5+10 вместо9+10; после — корректно. Focused absorption/curse damage — **24 passed / 0 failed**; полный прогон повторён после этой правки.

Окончательная проверка партии: `node --test tests/*.test.mjs` — **3800 passed / 0 failed**. Синтаксис **755 JS/MJS и 46 JSON, 0 ошибок**; два файла, изменённые после первого полного syntax pass, повторно проверены `node --check`; `git diff --check` чисто. Module/forwarder/esmodules — 1.4.255.

## Сверка реализации R7 — 2026-09-08, код 69a4ac23

Исправлены устаревшие отметки реализации, без расширения набора тестов. Источники: ItemUpgradeAutomationService.readHosts/project/requestSync/syncActor и native projection; buildSimpleUpgradeContributions и JSON tuple key; существующие tests/item-upgrade-projections.test.mjs, item-upgrade-automation-service.test.mjs, item-upgrade-roll-modifiers.test.mjs, item-upgrade-absorption.test.mjs, item-upgrade-choices.test.mjs и item-upgrade-service.test.mjs. Их проверки входят в последний полный прогон 4021/0 для кода 69a4ac23. После него менялись только документы; повторный прогон не нужен.

Подтверждены отдельные физические вклады, сохранение чужих/curse effects, отсутствие накопления при sync и native prepare, новая база после source edits, ограниченные projections и сохранённые choices. Native подтверждение dnd5e/MIDI и его границы описаны в записях партий выше. Отметка реализации не закрывает всю многопользовательскую приёмку.

Реально открыто: два спорных правила поглощения (35 implemented, 2 candidate, 11 existing-curse, 43 unavailable), полная связка каталожной матрицы с исполняемыми сценариями и остаток live GM/player/synthetic-token/transfer workflow. Два candidate не допускаются к автоматизации до решения правил. Активный Gamemaster по-прежнему возвращает Unknown socket command: disarm.reassign-responder; текущий запрос с отсутствующим QA operationId не менял игровой мир.

Точные несоответствия контракта оставлены открытыми: effectKey сейчас входит в сериализованный key, но не возвращается отдельным полем Contribution; targetData читает доступную native модель цели, отдельная authority-проверка раскрытия target fields в этом адаптере не доказана. Это не отмечено как выполненное.

### Контракт Contribution — 1.4.279

Добавлен отдельный effectKey, совпадающий с существующим компонентом JSON tuple key. Полные keys и managed AE identities не меняются: повторный sync не должен заменять эффекты. Дополнена существующая проверка идентичности, новые test cases не добавлялись. Проверка authority данных цели остаётся открытой: адаптер читает native Actor.system, без собственного socket-запроса; менять условия игрокам без проверки реального маршрута нельзя.

Проверки 1.4.279: профильные projection/lifecycle 18 passed / 0 failed; node --test tests/*.test.mjs — 4021 passed / 0 failed; node --check — 796 JS/MJS, JSON parse — 46 файлов, ошибок 0; git diff --check чисто. Новые test cases не добавлены.
