# Усовершенствования: каталог, правила, стоимость

Входной индекс: [паспорт функций](function-passport.md), разделы 13–15. R4 — правила/value; R7 runtime — 1.4.255. [Паспорт простых усовершенствований](simple-item-upgrades-function-passport.md) описывает 35 подключённых профилей, native проекцию, броски, поглощение и lifecycle.

## Каталог

Владелец `scripts/data/upgrade-automation-manifest.js`, решения `data/upgrade-automation-manifest.json`.

- `buildUpgradeAutomationManifest(upgrades, gear, decisions)` → detached rows, сортировка по productId. Private `indexRows(rows, field)` проверяет уникальность; `fail(code,id)` бросает explicit catalog error. Join только `productId === gear.id`; нет name fallback. Отсутствующие/лишние решения, дубликаты и неизвестные статусы отклоняются. Row содержит профиль, gearId, тип, reason, effectKind, owner/test/capability mappings и `ruleSource {file,productId,sourceSheet,sourceSheetRow}`. Для доступного статуса обязательны owner и existing test evidence.
- `getUpgradeAvailability(productId, manifest=[])` → `{decision,available,label,reason}`. Доступны только existing-curse/simple-implemented; неизвестный ID → unavailable-no-rule. Все 91 строки сохранены: 11 проклятий, 35 реализованных простых, 2 кандидата, 43 недоступных. Planned-R7 tests не являются свидетельством реализации.
- `loadUpgradeAutomationManifest()` → cached Promise rows; параллельно читает три static JSON с version query и `cache:no-store`, не пишет документы/settings. Ошибка сбрасывает promise для следующей попытки. Runtime не извлекает эффекты из русской прозы.
- Focused: `tests/upgrade-automation-manifest.test.mjs`; матрица решений в `docs/superpowers/specs/2026-09-07-module-development/upgrade-scope.md` синхронна JSON.

## Pure правила

Владелец `scripts/data/item-upgrade-rules.js`, без Foundry globals.

- `UpgradeRuleError(code, details={})`: code/details плюс пользовательское объяснение; unavailable/incompatible/capacity/slot-conflict/invalid-quantity.
- `resolveUpgradeProfile(storedProfile,catalogProfile)` возвращает detached сохранённый object целиком; при его отсутствии — каталог. Не смешивает custom effect с каталогом.
- `validateUpgradeCapacity(host,installed,capacity)` проверяет singleton host, целое capacity 1–3, позиции всех слотов и их уникальность; возвращает capacity. Снижение ниже максимального занятого slotIndex запрещено, даже когда installed.length меньше.
- `validateUpgradeInstallation(host,installed,candidate)` → `{allowed:true,slotIndex}`; host `{id,compatibilityTags,capacity,quantity,isEquipped,isHeld,isAttuned,isBroken}`, candidate `{sourceId,slotIndex?,profile,availability}`. Проверяет доступность, singleton host, совместимость, capacity и занятый slot; выбирает первый свободный. Основные tags — альтернативы; weapon qualifiers melee/ranged/nonmetal/brass-knuckles-or-metal-gauntlet обязательны дополнительно, согласно каноническому importer mapping. Неизвестный tag отклоняется. `outerwear,shield` допускает обе категории.
- `evaluateUpgradeActivation(host,actor,profile)` → `{supported,active,reason}`. Явная `profile.activation`: carried/equipped/held/attuned; неизвестная/отсутствующая policy не активна. `worksWhenBroken:false` отключает broken host. actor зарезервирован для расширения существующих predicates.
- Focused: `tests/item-upgrade-rules.test.mjs`.

## Foundry adapter и запись

Владелец остаётся `scripts/data/item-upgrade-service.js`. Actor owner permission и existing installed links сохранены.

- `ItemUpgradeService(moduleApi=null,{getManifest=loadUpgradeAutomationManifest}={})` принимает composition API; второй аргумент — dependency injection для тестов. Единственный runtime экземпляр создаёт `scripts/main.js`.
- `getUpgradeProjection(item)` → `{sourceId,profile,availability,legacyOverride,choices,choiceOptions,requiresChoice}`. Stable source — `flags.rebreya-main.gearId`; stored profile — `flags.rebreya-main.upgrade`. Exported `profileSignature(profile)` сравнивает сериализуемые профили независимо от порядка object keys. Отличающийся custom профиль сохраняется и помечается неподтверждённым для новой установки; чтение ничего не изменяет. Choices читает из child flag `upgradeChoices`; invalid/missing обязательный выбор даёт requiresChoice.
- `buildUpgradeHostDescriptor(item)` адаптирует тип dnd5e в canonical tags; явные редкие qualifiers берёт из `flags.rebreya-main.upgradeCompatibilityTags`. Состояние рук/экипировки читает через `getItemHeldHands`/`isItemEquipped`, attuned — native boolean, broken — canonical durability state. Имена не используются.
- `installItemUpgrade(hostItem,upgradeItem,options={})` / alias `installUpgrade`: projection → quantity/previous-host checks → pure validation → прежняя установка. Upgrade stack отделяет одну единицу; host stack требует R3 split. `options.capacity` не меняет вместимость и при несовпадении отклоняется. New slotIndex — только целое допустимое значение. Каталожный источник не изменяется.
- `options.choices` либо сохранённые choices проверяются до любых create/update/split. Нормализованный object сохраняется в `flags.rebreya-main.upgradeChoices` только установленной единицы, не остатка исходного stack. Remove и повторная установка сохраняют выбор. API не вызывает UI; отсутствующий обязательный выбор даёт UpgradeRuleError invalid-choice с объяснением.
- `removeItemUpgrade(hostItem,upgradeItemOrId)` / `removeUpgrade`: private `resolveActorItem` разрешает только child того же Actor; validates remaining slots до первой записи. Unavailable/custom исторический child разрешено снять без удаления профиля.
- `setItemUpgradeCapacity(hostItem,capacity)` / `setUpgradeCapacity`: pure validation до Item.update, без clamp входного аргумента. Public сигнатуры в game.rebreyaMain сохранены.
- Прежняя многошаговая запись install/remove не стала durable workflow в R4. Этот этап не обещает recovery между create/update при сбое; R3 journal не подменяется.
- Focused: `tests/item-upgrade-service.test.mjs`, regressions `curse-upgrade-automation-service`, `equipment-import-gear-profiles`, `gear-compendium`.

## UI

Владелец `scripts/integrations/item-upgrade-sheet.js`.

- `installItemUpgradeWithChoices(hostItem,upgradeItem,moduleApi)` используется обоими существующими drop handlers. Read-only projection → при необходимости DialogV2 с finite choiceOptions → canonical install API. Отмена/закрытие возвращает null до записи/анимации/уведомления об успехе; уже выбранный тип не спрашивает снова. `namedItem("damageType")` читает native dialog form. `createUpgradeAvailabilityHtml` также показывает необходимость выбора либо его сохранённый тип.

- `bindItemUpgradeSheet(root,app,moduleApi)` запускает read-only status projection через existing service, затем сохраняет прежние drop/capacity/remove listeners.
- `renderItemUpgradeAvailability(root,item,service)` асинхронно проецирует один upgrade либо installed children. WeakMap token подавляет устаревший render; повтор заменяет только собственную status section. Ошибка каталога видна текстом, без unhandled rejection. Host показывает статус в mods, source upgrade — в native details/description. Документы не обновляет.
- `createUpgradeAvailabilityHtml(item,projection)` экранирует имя/label/reason, сохраняет Item name, сообщает о legacy override. Недоступные строки имеют текст «Усовершенствования нет в реализации» и причину. CSS ограничен `.rm-item-upgrades__availability`.
- Focused: `tests/item-upgrade-service.test.mjs`, native live Item sheets.

## Типы поглощения

`scripts/data/item-upgrade-choices.js`: `getUpgradeChoiceOptions(sourceId,damageTypes=systemTypes)` пересекает фиксированный полный каталог правила с типами системы. Чешуя монстра — fire/cold/acid/poison/lightning; Зачарование поглощения — 13 обычных типов dnd5e, без healing/tempHP/произвольных ключей. `validateUpgradeChoices(sourceId,choices,damageTypes)` принимает только `{damageType}` для этих двух профилей и только пустой object для остальных; возвращает detached normalized object либо invalid-choice. Для Node/не загруженного CONFIG fallback — тот же finite каталог. Эта функция общая для install, projection и R8 generation; не выполняет выбор случайно. Focused: `tests/item-upgrade-choices.test.mjs`, service split/reinstall и absorption projection tests.

## Полная стоимость

Владелец `scripts/data/item-value.js`.

- `ItemValueError(code,details={})` сохраняет code/details; unknown-price/overflow/invalid-descriptor/unsupported-container.
- `addItemValue(a,b)` и private `multiplyItemValue(value,quantity)` допускают только неотрицательные safe integer copper values; проверяют переполнение результата.
- `evaluateItemValue(descriptor,catalogReader)` → `{baseValue,upgradeValue,contentsValue,totalValue,diagnostics}`. Descriptor v2 с unique instanceKey, sourceType/sourceId, quantity, boolean isBroken, upgrades и container. Обычная quantity — positive safe integer; composed host — quantity1; upgrade slots 1–3 уникальны, choices — object. Private `readComponent` вызывает synchronous `catalogReader.resolveValueComponent` с detached input, проверяет явный priceKnown:true, цену и форму optional upgradeProfile/includedUpgradeSourceIds. Private `record/id/invalid` проверяют DTO.
- base = unitValue×quantity; upgradeValue — сумма отдельных installed components. includedUpgradeSourceIds — multiset: каждое включение исключает ровно один matching child. Даже included child должен иметь известную цену. Цены сломанного предмета определяет reader по isBroken; новой скидки R4 не вводит.
- Любой non-null container → unsupported-container до R9; `readContainerValueNodes` зарезервирован, сейчас не вызывается. ContentsValue=0. Расчёт не меняет источники и не пересчитывает world Items.
- `resolveLootgenItemValue(rawValue,fallbackGold=0)` — прежняя legacy money policy: positive floored raw value, иначе rounded gold×100 (включая explicit legacy 0). Export того же имени в `scripts/ui/lootgen-app.js` делегирует сюда. Генератор/старые шаблоны пока сохраняют прежнюю семантику; новый evaluator — контракт для R8/R9.
- Focused: `tests/item-value.test.mjs`, `tests/lootgen-app-context.test.mjs`.
