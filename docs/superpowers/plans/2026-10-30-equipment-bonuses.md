# Equipment Bonuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить базовый КД магических доспехов, включить магические оружейные шаблоны для NPC, добавить классовые бонусы семи семейств фокусировок и бонусы механизированной одежды на кукле.

**Architecture:** Расширить существующие catalog/projection/template owners; вычисляемые бонусы соединить с подготовкой native dnd5e данных через один equipment adapter. Три независимо проверяемых блока реализуются последовательно в текущей рабочей копии и выпускаются вместе, поскольку пользователь поручил все изменения одной задачей. Новых settings, socket commands и транзакционных сервисов не добавлять.

**Tech Stack:** Foundry VTT 13, установленная dnd5e 5.2.5, browser ESM JavaScript, Node test runner, PowerShell/Git.

**Spec:** `docs/superpowers/specs/2026-10-30-equipment-bonuses-design.md`.

## Global Constraints

- Работать только в `lich_branch`; текущая ветка и remote совпадают. Не менять чужие файлы, не создавать worktree с другой веткой.
- Все существующие настройки, авторские attack/save formulas, количество, заряды, восстановления и ручной КД сохранить.
- Ограниченные классом бонусы не записывать в глобальные `system.bonuses.msak/rsak/spell.dc`.
- Изменение одежды: +1 к проверкам Силы и к действующему множителю грузоподъёмности, стандартное ×15 → ×16; только при реальном placement на кукле, без суммирования копий.
- Базы доспехов брать из canonical `model.gear`, не создавать вторую таблицу числовых КД. Неоднозначные шаблоны сохраняют выбор базы.
- Один release 1.5.27, forwarder только импортирует `./main.js`. Не вводить новые зависимости.
- Изменённые методы внести в паспорт, public behavior — в README; только после проверок commit и push в `origin lich_branch`.

## Review Focus

- Старые owned-копии с нулевой базой: исправить только доказанный профиль, сохранить ненулевой ручной КД и выбранный template gear ID — Task 1.
- NPC без активного владельца/с активным player owner и Token synthetic Actor: сохранить существующую авторизацию и единственный prompt — Task 2.
- Мультикласс, неизвестный `sourceClass`, фиксированные attack/DC и несколько предметов: усиливать только определённый класс, не менять фиксированные значения, не дублировать вклад — Task 3.
- Повторная preparation на одном экземпляре, reload, снятие и удаление: не накапливать вычисляемые бонусы и не менять `_source` — Tasks 3–4.
- Одежда в legacy owned-копии, ghost, нестандартная проверка навыка через Силу, ручной capacity override, транспорт и импланты: единый predicate и сохранение текущих правил — Task 4.

---

### Task 1: Базовые параметры магических доспехов

**Files:** modify `scripts/data/magic-items-compendium.js`, `scripts/data/magic-item-embedded-sync.js`, `scripts/main.js`; create `scripts/data/magic-armor-profile.js`; test `tests/magic-items-compendium.test.mjs`, `tests/magic-item-equipped-sync.test.mjs`, new `tests/magic-armor-profile.test.mjs`.

**Interfaces:** pure `resolveMagicArmorProfile(item, gear = []) -> { gearId, type, armor, strength, properties } | null`; `MagicItemsCompendiumService` получает optional `gearProvider: () => Promise<Array>`; composition передаёт `async () => (await this.getModel()).gear`. Existing `createMagicItemData(item, folders, icons, activityOptions)` сохраняет сигнатуру, принимает `activityOptions.gear`.

- [ ] Добавить тесты resolver: Кираса → 14/dex 2, Кольчуга → 16, Латы → 18/strength 15, проклёпанная кожа → 12, Щит → 2, Баклер → 1. Сравнивать с реальным `data/gear.json`; `Любой`/категории без базы → null; входные данные не мутируются.
- [ ] Добавить assertions `createMagicItemData`: профиль переносится в native armor/type/strength/properties, magic bonus отдельно +1/+2/+3 и ровно один раз. `mgc` и профильные свойства объединяются.
- [ ] Добавить embedded regressions: armor.value 0/отсутствует исправляется по доказанной базе; ручной 19 сохраняется; templated `magicEquipmentGearId` не заменяется профилем другого доспеха; повторный patch unchanged; quantity/description/uses.spent/user effects не меняются.
- [ ] Запустить `node --test tests/magic-armor-profile.test.mjs tests/magic-items-compendium.test.mjs tests/magic-item-equipped-sync.test.mjs`, подтвердить реальные ожидаемые FAIL до реализации.
- [ ] Реализовать resolver по точному subtype/baseItem либо выбранному `magicEquipmentGearId`; не угадывать профиль по общему heavy fallback классификатора. Подключить gearProvider к sync один раз на batch; включить resolved profile в signature/projection и безопасный zero-only owned repair.
- [ ] Повторить focused-команду; ожидается 0 failed.

### Task 2: NPC в существующем адаптере шаблонов

**Files:** modify `scripts/integrations/magic-weapon-template.js`; test `tests/magic-weapon-template.test.mjs`.

**Interfaces:** сохранить public `handleCreatedMagicWeaponItem`, `handleActorRenderMagicWeapons`, `registerMagicWeaponTemplateHook` и update/template flags. Общий внутренний predicate принимает owned actor типов `character|npc`; другие типы по-прежнему отклоняются.

- [ ] Добавить падающие tests на NPC create/drop оружия +1/+2/+3 и именного шаблона, fallback существующей NPC-копии при render; отмена не меняет Item; повторный render готового шаблона не вызывает prompt.
- [ ] Покрыть GM с активным player owner, current-user guard, actor без OWNER, неподдерживаемый тип и synthetic NPC. Сохранить действующие character tests без ослабления assertions.
- [ ] Выполнить `node --test tests/magic-weapon-template.test.mjs`, подтвердить FAIL только новых сценариев.
- [ ] Расширить canonical actor predicate и render gate; подключить недостающие штатные NPC render hooks к тому же обработчику с сохранением единственной регистрации. Не создавать отдельный NPC adapter.
- [ ] Повторить focused-команду, ожидается 0 failed.

### Task 3: Классовые бонусы магических фокусировок

**Files:** create `scripts/integrations/equipment-bonuses.js`; modify `scripts/data/magic-items-compendium.js`, `scripts/data/magic-item-embedded-sync.js`, `scripts/main.js`; test new `tests/equipment-bonuses.test.mjs`, existing `tests/magic-items-compendium.test.mjs`, `tests/magic-item-equipped-sync.test.mjs`, `tests/main-magic-item-lifecycle.test.mjs`.

**Interfaces:** `getClassSpellcastingItemBonus(spell) -> number` читает exact magicItemId и `spell.system.sourceClass`; `applyClassSpellcastingItemBonuses(item) -> void` меняет только prepared native Activities; `registerEquipmentBonusPatches({CONFIG=globalThis.CONFIG}={}) -> object` один раз оборачивает поддерживаемые native preparation methods, безопасно пропускает отсутствующие capabilities. Таблица семейств хранится единожды и экспортируется как `CLASS_SPELLCASTING_ITEM_FAMILIES`; catalog audit и runtime используют её совместно.

- [ ] Добавить табличные падающие tests для 7 семейств × +1/+2/+3 и классов из spec; amulet worn, остальные held там, где это требует текст; attunement учитывается. Неактивный/сломанный/снятый предмет → 0, неизвестный класс → 0, чужой класс → 0; strongest copy семьи, разные допустимые семейства складываются.
- [ ] Добавить integration-shaped fixtures native attack/save Activities: бонус атаки +2 и вычисляемой Сл +2; авторские `@prof`/dice formulas сохраняют свой вклад, fixed attack/explicit DC не меняются; повторная preparation и снятие убирают только наш вклад; `_source` неизменен.
- [ ] Закрепить исходные отрицательные тесты глобальных bonuses и сохранение utility activities/uses.recovery/spent. Добавить положительные assertions scoped runtime пути и корректности audit текста новых бонусов.
- [ ] Запустить `node --test tests/equipment-bonuses.test.mjs tests/magic-items-compendium.test.mjs tests/magic-item-equipped-sync.test.mjs tests/main-magic-item-lifecycle.test.mjs`, увидеть FAIL новых сценариев.
- [ ] Реализовать deterministic resolver: `sourceClass` разрешать через `actor.spellcastingClasses`/canonical class identity, без угадывания по spell ability. Использовать существующие held-items и broken-item predicates. Старые копии узнавать по canonical identity, не только новой metadata.
- [ ] Подключить подготовку Activities перед оригинальным `Item5e.prepareFinalAttributes()`, чтобы штатные labels, native rolls и MIDI получили тот же бонус. Сохранить чужие подготовленные вклады; отслеживать только собственную добавку для повторного вызова. Не писать Actor/Item Documents или `_source` при preparation. Подключить adapter один раз из composition с dnd5e/capability guard.
- [ ] Обновить managed definition/audit notes для семейств; сохранить весь прежний resource/utility lifecycle. Повторить focused tests, ожидается 0 failed.

### Task 4: Механизированная одежда на кукле

**Files:** modify `scripts/integrations/equipment-bonuses.js`, `scripts/data/gear-compendium.js`, `scripts/data/hero-doll-service.js`, `scripts/data/inventory-service.js`; test `tests/equipment-bonuses.test.mjs`, `tests/gear-compendium.test.mjs`, `tests/hero-doll-service.test.mjs`, `tests/group-inventory-migration.test.mjs`.

**Interfaces:** `getMechanizedClothingBonuses(actor) -> { strengthCheckBonus:number, capacityMultiplierBonus:number }`, возвращает `{1,1}` только для реального Item с `gearId:mekhanizirovannaya-odezhda` в `flags.rebreya-main.heroDoll.slots.clothing.itemId`; иначе `{0,0}`. Shared read-only resolver используется native preparation и `InventoryService.getPartySnapshot()`.

- [ ] Добавить падающие tests: catalog garment совместим с `clothing`; legacy owned копия без slots тоже надевается; новые unrelated вещи слот не получают. Одежда в сумке, ghost, удалённый ID, другая вещь/слот → `{0,0}`; реальный garment → `{1,1}`; несколько копий → один вклад.
- [ ] Проверить prepared ability check и Athletics/любой skill с ability str: +1; attacks, damage, saves, str.value неизменны. Повторный prepare/снятие/замена возвращают исходные значения, пользовательская check formula сохранена.
- [ ] Закрепить inventory capacity: STR 10 ×15 = 150, с одеждой ×16 = 160, после снятия 150; ручной ×20 + flat 7 → 217; strOverride сохраняется; роли transport/mount с explicit cargo не получают STR-бонуса; coins/container storage semantics неизменны.
- [ ] Закрепить native encumbrance maximum ×16/15 при стандартной системе; сохранить metric conversion, size/powerful-build multipliers, flat bonuses и имплантный вклад. Не увеличивать автоматически encumbered/heavily thresholds: предмет меняет грузоподъёмность, не эти правила.
- [ ] Запустить `node --test tests/equipment-bonuses.test.mjs tests/gear-compendium.test.mjs tests/hero-doll-service.test.mjs tests/group-inventory-migration.test.mjs`, подтвердить FAIL новых сценариев.
- [ ] Реализовать exact-ID garment projection/legacy slots fallback в существующем владельце. Перед native actor derived preparation добавить prepared str.bonuses.check и коэффициент maximum через тот же equipment adapter; не записывать world settings/Actor flags. В inventory прибавить read-only capacityMultiplierBonus к текущему выбранному множителю, сохранив transport branch.
- [ ] В карточке одежды явно отразить ×15→×16 поверх противоречивого исходного описания; не менять import snapshot или другие авторские тексты. Повторить focused tests до 0 failed.

### Task 5: Выпуск, live QA, документация и Git

**Files:** modify `module.json`, `scripts/main.js`, README.md, docs/function-passport.md, профильные паспорта при необходимости; rename `scripts/main-1.5.26.js` → `scripts/main-1.5.27.js`; обновить cache keys всех затронутых runtime importers, чтобы для общего helper оставался один ESM URL.

- [ ] Обновить описание каждого нового/изменённого метода в актуальном паспорте: сигнатуры, владелец, поток данных, ограничения и focused tests. README описывает NPC, классовые условия, clothing placement и ×16, без заявления об автоматизации иных свойств фокусировок.
- [ ] Синхронно повысить version/entrypoint до 1.5.27 и версии managed signatures. Проверить `tests/module-manifest.test.mjs` и отсутствие runtime ссылок на прежний entrypoint.
- [ ] Выполнить один полный `node --test tests/*.test.mjs`, `git diff --check`; `node --check` для всех tracked JS/MJS; парсинг всех tracked JSON через `ConvertFrom-Json`. Зафиксировать totals и реальные ошибки, после исправлений повторить affected checks.
- [ ] Провести доступный live QA через существующую авторизованную Foundry сессию: exact build/system, NPC weapon drop, shield/armor AC, sourceClass мультикласс, native/MIDI attack/DC, garment equip/remove/check/capacity и reload. Playwright занят чужим профилем — не закрывать его; исследовать доступный browser binding/bridge. Если сессия недоступна, честно перечислить непроверенные live сценарии.
- [ ] Заказать обязательный whole-change review по spec/plan; исправить существенные замечания и повторить affected checks. Для native execution это один свежий reviewer, не параллельные implementers.
- [ ] Перед commit повторно проверить branch/status, `git diff --check`, `git diff --stat` и содержательный diff. Индексировать только файлы задачи; осмысленный commit `fix: complete equipment armor and spellcasting bonuses`; `git push -u origin lich_branch`, без force push.
- [ ] В отчёте указать commit, release, spec/plan paths, passed/failed commands и границы live проверки.

## Self-review

Все требования spec распределены между Tasks 1–5; каждый Review Focus закреплён конкретными регрессиями. Общие функции и названия совместимы между tasks. Произвольные доспехи не получают выдуманной базы; отрицательные global-bonus assertions сохраняются. До подтверждения плана product code не меняется.

## Исполнительские решения и review

Пользователь разрешил продолжать в общей копии и сохранять его параллельные правки. Параллельный выпуск боеприпасов поднял общий manifest до 1.5.28; его версия и forwarder сохранены, новые equipment cache keys остаются 1.5.27. Опубликованный forwarder 1.5.26 сохранён для обратной совместимости.

Независимый review выявил два важных случая; регрессии сначала падали (4 failures), затем прошли: native maximum получает +1/15 к своему multiplier (поэтому ×20→×21), а флакон с кровью требует настройки и наличия при владельце, без equipped. В существующем учёте inventory переносимая сила имплантов до этой задачи не учитывалась; это расхождение не расширялось и не исправлялось в текущей задаче.

## Проверенные результаты

Полный Node test runner: 5355 passed, 0 failed, 1 skipped (5356 tests); единственный skip — существующая rendered ghost проверка без Foundry Handlebars/NODE_PATH. Синтаксис: 1127 JS/MJS checked, 0 failed; JSON: 65 checked, 0 failed; git diff --check: 0. После review изменённые equipment resolver/adapter повторно прошли node --check. Профильный повтор проверяющего: 26 passed, 0 failed, нерешённых Important/Critical замечаний нет. Live-проверка не проведена: Playwright-профиль занят, Foundry MCP bridge не подключён, Computer Use остановлен из-за невозможности установить URL; ограничения не обходились.

## Выпуск снаряжения 1.5.29 — согласованная поправка

1. Зафиксировать ожидаемые manifest/forwarder/equipment cache keys 1.5.29 в существующих release-тестах и увидеть RED.
2. Синхронно обновить manifest, добавить тонкий forwarder, перевести только собственные cache keys 1.5.27→1.5.29 и README; прежние forwarders и независимое исправление боеприпасов сохранить.
3. Выполнить release/focused тесты, полную runtime/JSON проверку, diff review, commit и push в lich_branch. Новых методов или игрового поведения нет.

Проверка поправки 1.5.29: RED release tests — 12 failed до обновления runtime; GREEN release/equipment/armor — 88 passed, 0 failed. Полный `node --test tests/*.test.mjs`: 5355 passed, 0 failed, 1 skipped (прежняя Foundry Handlebars зависимость); `node --check`: 1128 JS/MJS, 0 failed; `ConvertFrom-Json`: 65 JSON, 0 failed; `git diff --check`: 0. Аудит diff подтвердил только замену equipment cache keys, единственный активный entrypoint и сохранённые forwarders 1.5.27/1.5.28.
