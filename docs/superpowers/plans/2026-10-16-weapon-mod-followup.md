# Weapon Mod Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выполнить десять замечаний пользователя к панели, выбору деталей, модернизации и числовым бонусам.

**Architecture:** Сохранить существующие UI/mutation/automation owners. Фильтр делегирует pure rules, источники ссылаются на реальные Documents. Native огнестрельные броски проходят через прежний общий adapter.

**Tech Stack:** Foundry13.351, dnd5e5.2.5, MIDI13.0.61, ESM/Handlebars/CSS, Node tests; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-16-weapon-mod-followup-design.md`. Прямые замечания пользователя уточняют уже утверждённый дизайн; исполнение Native сохраняется.

## Global Constraints

- lich_branch; сохранить typed authorization, journal, quantity/formulas/500gp и все обычные upgrades.
- Одна часть и500 зм сразу; нет календаря. Отсутствующие совместимые Items только просматриваются.
- Product меняется после RED владельца; UI не пишет world state напрямую.
- Изображения38 и topology3/6/2 не меняются. Новый patch/entrypoint/cache/stylesheet epoch в одной задаче.

## Review Focus

- Native fwак: огнестрел не должен молча выходить до modifiers; test task1.
- Нет owned части или world source: не создавать бесплатный Item; test task2/3.
- Один child на двух mounts: не дублировать instance/action/bonus; test task3.
- Перерисовка после установки: активная под-вкладка и old upgrades handlers сохраняются; test task3.
- Cancel/499gp/потерянный ответ modernization: сохранить прежние деньги/детали/retry; task2 existing+UI regression.

### Task 1: Native числовые бонусы

**Files:** `scripts/integrations/item-upgrade-roll-adapter.js`, `tests/weapon-mod-roll-modifiers.test.mjs`; при необходимости прежние combat owner tests.
**Interfaces:** Общий predicate native weapon activity распознаёт `fwak`/weapon+firearm. `preRollAttack/preRollDamage` сохраняют signatures и guard.

- [ ] RED: actual-shape activity `actionType:"fwak",attack.type:{classification:"weapon",value:"firearm"}` и реальный installed tactical-grip projection: parts получает ровно"1"; повтор не добавляет второй"1". Spell/посторонний Item unchanged; attack bonus не становится damage bonus.
- [ ] Минимальное исправление общего predicate. GREEN: `node --test tests/weapon-mod-roll-modifiers.test.mjs tests/item-upgrade-roll-adapter.test.mjs tests/combat-attack-service.test.mjs` (реальные существующие test paths уточнить по rg).

### Task 2: Совместимый компактный каталог и paid модернизация

**Files:** `scripts/integrations/weapon-mod-panel.js`, tests panel; существующие catalog/rules только если чистая проверка нужна для отсутствующей строки.
**Interfaces:** `buildWeaponModCatalogView` сохраняет existing fields, дополняет source UUID и группой. Для отсутствующей строки validate canonical candidate quantity1, не выдавать Item. Ссылки открывают доступный Document; install остаётся `installWeaponModWithChoices`→typed command.

- [ ] RED: top rows только совместимые прицелы, отсутствующий compatible остаётся, несовместимый скрыт; owned/absent разделены; source link не вызывает install; no prose.
- [ ] RED: UI выбор настоящей modern части + native confirm true → реальный service списывает500gp, устанавливает1; cancel и499 не пишут. Нет owned modern частей → явное сообщение, не бесплатная генерация.
- [ ] Минимальная реализация и GREEN panel/rules/rebuild tests; snapshot исходных монет/частей сохраняется на отказах.

### Task 3: Под-вкладки, квадратные карточки и связи

**Files:** `weapon-mod-panel.js`, `item-upgrade-sheet.js`, `templates/item-mods-tab.hbs`, `dnd5e-sheet-extensions.js` только context, `styles/main.css`, panel/branding tests.
**Interfaces:** Под-вкладки локальны существующему Mods part, не native primary group. Existing old upgrade mount/listeners остаются; состояние под-вкладки связано с app и сохраняется на rerender. Геометрия задаётся одним layout helper в normalized1000x600.

- [ ] RED: template subnav ниже штатного separator, панели имеют independent names/visibility; world/custom unsupported hosts сохраняют old upgrades. Rerender сохраняет active subtab.
- [ ] RED: title на рамке, отсутствует поясняющая строка; filled image квадрат/полная ширина; один physical child primary marker и linked tile; connector endpoints на границах, без overlap при400/788px diagram.
- [ ] Минимальные HTML/CSS/bind правки и GREEN panel+branding. Проверить native лист в browser, узкий/широкий, LKM/PKM/links, обе группы, subtab switching и cleanup.

### Task 4: Проверка и выпуск

**Files:** README, function passport, новый followup verification report; module.json/main forwarder/cache cohort и released cache assertions.

- [ ] Одно независимое review всего diff; один проход исправлений подтверждённых Important. Обновить паспорт изменённых методов и матрицу всех10 пунктов, записать native/DOM evidence и ограничения.
- [ ] Поднять patch (следующий после389), entrypoint и stylesheet epoch; проверить один canonical URL каждого затронутого owner. Full `node --test tests/*.test.mjs`; все JS/MJS syntax, JSON parse, diff check/stat/содержательный diff. Report только реальные counts/errors.
- [ ] Scoped commit/push lich_branch, clean и HEAD...origin/lich_branch0 0. Итог: результат, spec/plan/report links, native QA границы.
