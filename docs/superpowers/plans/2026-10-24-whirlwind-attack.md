# Круговая атака Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить оружию с `lchWhirl` активность, которая одним броском атакует всех вокруг в существующей досягаемости, наносит половину урона и ограничивает дополнительные эффекты одной поражённой целью.

**Architecture:** Чистые правила проекции и обработки пакетов находятся в отдельном небольшом файле. `CombatAttackService` остаётся владельцем orchestration атаки и досягаемости; существующий `registerCombatHooks` подключает lifecycle и damage callbacks. `RogueAutomationService` сообщает выбранную цель и маркирует свой дополнительный урон для адресного применения.

**Tech Stack:** JavaScript ESM, Foundry VTT 13, установленная dnd5e 5.2.5, текущий MIDI-QOL, Node test runner. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-24-whirlwind-attack-design.md` (согласована пользователем).

## Global Constraints

- Ограничение круговой атаки «один раз в ход» не автоматизируется: нет счётчика, флага использования, блокировки или сброса по ходу.
- Дополнительный урон «Скрытой атаки» также делится пополам и не распространяется на остальных.
- Все фракции включены; сам атакующий исключён; используется фактическая досягаемость проекта.
- Сохраняются обычные и авторские активности, формулы, расходы ресурсов и собственные ограничения способностей.
- Runtime-правки требуют повышения `module.json` с 1.5.0 до 1.5.1 и `scripts/main-1.5.1.js`, импортирующего только `scripts/main.js`.
- Все изменения и push только в `lich_branch`; чужие изменения и опережение remote требуют остановки по AGENTS.md.

## Review Focus

1. Несколько токенов одного связанного Actor: выбор эффекта относится к конкретному поражённому токену, не ко всем копиям Actor.
2. Отмена броска, пустая область и повторное открытие листа: нет расхода до подтверждения, дубликатов активности и зависшего target context.
3. Разные размеры, граница досягаемости и бонус `lchReach`: результаты совпадают с обычной рукопашной атакой проекта.
4. Нечётный смешанный урон, крит, сопротивление и иммунитет: половина применяется один раз в штатном расчёте, до финального округления/HP mutation.
5. MIDI выключен или новый workflow начинается одновременно: контекст урона не протекает в другие атаки; native карточка сохраняет адресность и множитель.

---

### Task 1: Проекция дополнительной активности без перезаписи оружия

**Files:**
- Create: `scripts/combat/whirlwind-attack.js`, `tests/whirlwind-attack.test.mjs`.
- Modify: `scripts/combat/attack-service.js` (рядом с `repairFirearmActivities`), `scripts/combat/hooks.js` (существующие item/actor lifecycle callbacks), `scripts/data/gear-compendium.js` (weapon projection).
- Test: `tests/gear-compendium.test.mjs`, `tests/combat-attack-service.test.mjs`.

**Interfaces:**
- `buildWhirlwindActivity(item, baseActivity) -> object | null`: native attack activity с постоянным id `lchWhirlAttack01`, именем «Круговая атака» и `flags.rebreya-main.whirlwindAttack` с версией схемы и source activity id. Источник — обычная melee attack activity предмета; пользовательские attack/damage/consumption настройки сохраняются, uses/recovery круговой атаки не создаются.
- `isWhirlwindActivity(activity) -> boolean`: проверяет managed marker и наличие `lchWhirl` у weapon.
- `CombatAttackService.repairWhirlwindActivities(document) -> Promise<{updated:number}>`: Actor или Item, запись только изменений managed activity пользователем с правом обновления; не удаляет чужую активность при конфликте id.

- [x] Написать failing tests: свойство создаёт одну дополнительную melee activity; обычная и пользовательская активности глубоко равны исходным; повторный repair не пишет документ; снятие свойства удаляет только managed activity; коллизия id не перезаписывает авторский документ; оружие без свойства не меняется.
- [x] Выполнить `node --test tests/whirlwind-attack.test.mjs tests/gear-compendium.test.mjs tests/combat-attack-service.test.mjs`, подтвердить падение новых assertions.
- [x] Реализовать helpers и repair; подключить к существующим lifecycle callbacks и каталожной проекции. Не создавать второй набор hooks. Защитить update recursion локальным update option, не флагом игрового лимита.
- [x] Повторить focused-команду; все тесты должны пройти.
- [x] Обновить паспорт владельцев проекции и repair вместе с сигнатурами.

### Task 2: Один бросок против всех в существующей досягаемости

**Files:**
- Modify: `scripts/combat/attack-service.js` (`#resolveFinalMeleeReachFeet`, `applyDnd5ePreUseActivity`, `applyMidiHitsChecked`), `scripts/combat/hooks.js`.
- Test: `tests/whirlwind-attack.test.mjs`, `tests/combat-attack-service.test.mjs`.

**Interfaces:**
- `CombatAttackService.getMeleeReachFeet(item, options={}) -> number`: делегирует каноническому расчёту; обычные атаки используют тот же расчёт без изменения результата.
- `CombatAttackService.prepareWhirlwindUse(activity, usageConfig, messageConfig) -> boolean`: валидирует source token и сцену, собирает всех creature tokens через существующую геометрию рукопашной досягаемости, устанавливает targets текущего применения и serializable context карточки. Пустая область возвращает false с уведомлением до расхода.
- `CombatAttackService.resolveWhirlwindHits(workflow) -> boolean`: один существующий attackRoll, отдельное сравнение с КД каждой цели с сохранением штатных natural 1/20 и критов; никаких дополнительных attack rolls.

- [x] Написать failing tests: союзник/нейтральный/враг включены; атакующий и токен вне reach исключены; ручные targets не сужают область; изменение размера/бонусов влияет на boundary; один Roll против КД 12 и 18 при total 15 даёт одно попадание; natural 1/20 сохраняют поведение обычной атаки.
- [x] Добавить проверки отсутствия combat/turn tracker и успешного повторного применения в одном ходу; отмена и отсутствие source token не расходуют ресурсы и не оставляют targets следующему workflow.
- [x] Запустить focused-команду Task 1 и подтвердить падение новых тестов.
- [x] Реализовать методы в существующем attack owner; пройти реальный порядок dnd5e/MIDI hooks, чтобы targets были установлены до проверки дальности и roll. Не использовать глобальный последний attack context.
- [x] Повторить focused-команду; обновить соответствующие сигнатуры в паспорте.

### Task 3: Половина урона и адресные дополнительные эффекты

**Files:**
- Modify: `scripts/combat/whirlwind-attack.js`, `scripts/combat/attack-service.js`, `scripts/combat/rogue-automation-service.js`, `scripts/combat/hooks.js`.
- Test: `tests/whirlwind-attack.test.mjs`, `tests/rogue-automation-service.test.mjs`, `tests/combat-attack-service.test.mjs`.

**Interfaces:**
- `buildWhirlwindDamagePackets({baseDamage, extraDamage, selectedTargetUuid, targetUuid}) -> object[]`: создаёт независимые типизированные пакеты, не изменяя формулы; адресный extraDamage включается только для selectedTargetUuid; множитель круговой атаки 0.5 применяется ровно один раз.
- `CombatAttackService.applyWhirlwindDamage(actor, damages, options) -> boolean`: интеграция пакетов со штатным damage calculation до resistance/immunity и HP mutation. Сериализуемый контекст содержит use/workflow id и token UUID; повторный callback не умножает второй раз.
- `RogueAutomationService.applyMidiPreDamageRoll(...)`: для круговой атаки выбирает конкретный поражённый token, маркирует адресный extraDamage и эффект. Для остальных атак существующий путь остаётся прежним.

- [x] До runtime-правки закрепить integration fixture установленного dnd5e/MIDI: какие roll options/properties проходят до типизированных damage packets и какой callback вызывается до сопротивлений. Предпочесть существующие hooks `dnd5e.preCalculateDamage` и маркированные пакеты; подтвердить сериализацию карточки без потери target UUID. Не использовать поздний `midi-qol.preTargetDamageApplication` для деления уже рассчитанной потери HP.
- [x] Написать failing tests: базовый урон 10 получают по 5 все поражённые цели; extraDamage 6 добавляет 3 только выбранному токену; другой токен того же Actor не получает extra; miss не может быть выбран; обычный Sneak Attack вне круговой сохраняет прежний путь.
- [x] Добавить assertions для нечётного/смешанного урона, crit, сопротивления, иммунитета, повторного damage callback, двух независимых workflow и native карточки без MIDI. Округление и traits сравнивать со штатным damage calculator, не со вновь написанным его аналогом.
- [x] Добавить regression для собственного лимита Sneak Attack: он сохраняется, хотя лимита круговой нет; выбранный Cunning Strike не применяется остальным.
- [x] Запустить `node --test tests/whirlwind-attack.test.mjs tests/rogue-automation-service.test.mjs tests/combat-attack-service.test.mjs`, подтвердить падение новых assertions.
- [x] Реализовать packets и hook adapter; обычный штатный workflow применяет HP/traits. Не делать второй прямой `Actor.applyDamage` после завершения workflow.
- [x] Просмотреть остальные дополнительные hit/damage effects в существующих обработчиках и направить адресные эффекты круговой на ту же выбранную цель; постоянные части базового урона оружия сохраняются у всех. Зафиксировать regression на обнаруженные применимые обработчики, без общей перестройки automation services.
- [x] Повторить focused-команду и обновить паспорт повреждённых методов.

### Task 4: Live-проверка, релизная версия и Git

**Files:**
- Modify: `README.md` (оружейная автоматизация), `docs/function-passport.md`, `module.json`.
- Rename: `scripts/main-1.5.0.js` → `scripts/main-1.5.1.js`; содержимое — только import `scripts/main.js`.
- Modify: `tests/module-manifest.test.mjs`, если закрепляет текущую версию.

- [x] Обновить README: активность, все фракции, существующая reach, половина урона и Sneak Attack, отсутствие автоматического лимита.
- [x] Поднять версию и esmodules вместе; проверить runtime-конфигурацию на старый entrypoint.
- [ ] В доступном Foundry world подтвердить точные runtime версии; проверить предмет с `lchWhirl`, существующее оружие, один бросок против нескольких КД, половину damage, выбор единственной bonus target, повторное использование в одном ходу, игрока/GM, reload без дубликатов и обычную атаку. Тестовые документы убрать; сохранить компактные результаты. Недоступную live-проверку явно отметить.
- [x] Выполнить один полный проход `node --test tests/*.test.mjs`, `git diff --check`, `node --check` всех tracked JS/MJS и `ConvertFrom-Json` всех tracked JSON. Для нового forwarder отдельно выполнить `node --check` до staging. Отчёт: passed/failed и реальные ошибки.
- [x] Независимый review соответствия spec/plan, адресности extraDamage, сохранения авторских данных и hook timing; исправления проверять затронутыми focused-тестами. Gemini использовать только если headless command permission стал доступен, иначе доступного reviewer.
- [x] Проверить `git diff --stat`, содержательный diff и отсутствие чужих изменений. Stage только файлы задачи, включая spec/plan; commit `feat: add whirlwind weapon attack activity`; `git push -u origin lich_branch`.

## Self-review

Покрытие: активность и сохранение документов — Task 1; все цели/reach/один бросок/отсутствие лимита — Task 2; половина урона и адресные эффекты — Task 3; runtime evidence, версия, документация и Git — Task 4. Все пять Review Focus условий включены в тестовые шаги. Риск интеграции damage packets вынесен в первый проверяемый шаг Task 3; passing pure helpers без подтверждения фактического hook path не считается выполнением задачи.

## Execution

Рекомендуется native: реализация Codex в текущем чате через `executing-plans`, с независимым review готового изменения. Части тесно связаны порядком hooks и packet contract; отдельный implementer на каждый шаг увеличит передачу контекста. План и native-выполнение подтверждены пользователем до реализации.

## Результат выполнения

Реализовано в текущем чате. Независимое ревью: три Important замечания устранены через RED→GREEN. Полный suite: 4985 passed, 0 failed, 1 skipped. Статические проверки зелёные. Live QA недоступна: отдельная GM-сессия отсутствует, MCP Bridge не подключён; соответствующий шаг оставлен открытым. Подробности: `docs/whirlwind-attack-verification.md`. Старый forwarder 1.5.0 сохранён для кэшированных manifests; добавлен 1.5.1.
