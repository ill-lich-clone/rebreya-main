# Усовершенствования: только бонусы и простые эффекты

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). R4 — правила/value, R7 — простая автоматизация.

## Согласованный объём

Пользователь: проклятья уже готовы; остальные усовершенствования делать только с бонусами и простыми эффектами. Сложные отмечать «Усовершенствования нет в реализации». Их не переносить в следующую партию без нового запроса.

data/upgrades.json содержит 91 профиль: Материал 68, Зачарование 12, Проклятье 11. [Матрица объёма](upgrade-scope.md) фиксирует решение по каждому. Это классификация будущей реализации, не отчёт о готовых новых эффектах.

Простое: постоянный бонус/свойство, изменение базовых данных или одно условие на известные данные текущей атаки/цели через существующего владельца. Допускается один сохранённый выбор типа урона при установке. Сложное: новый ресурс, следующая атака/последний час, аура, реакция, перемещение, дополнительные заклинания, новый многошаговый workflow.

Если техническая проверка покажет, что кандидат требует такой механизм, перевести всю строку в «нет реализации» с причиной. Не выдавать простой фрагмент сложного профиля за готовое целое.

## Владельцы

scripts/data/item-upgrade-service.js владеет capacity/installed и installedUpgrade. Host хранит installed[{itemId,slotIndex}], child — installedUpgrade.hostItemId и system.container. installItemUpgrade() уже отделяет единицу upgrade stack.

Проклятья: scripts/combat/curse-upgrade-automation-service.js, curse-upgrade-{saves,damage,attacks}.js, scripts/integrations/curse-upgrade-socket.js. [Паспорт](../../../curse-upgrades-function-passport.md) и [спецификация](../../../curse-upgrades-automation-spec.md). Сохранять 11 реализаций, их долги/cooldowns/MIDI/native и «Пожирателя проклятий».

Паспорт: 14–16 и curse passport; UI — scripts/integrations/item-upgrade-sheet.js. Идентичность: productId → catalog gearId, не название.

## R4: общие правила и value

Manifest всех 91 IDs: {productId,gearId,type,decision,ruleSource,owner,tests,reason}.
decision: existing-curse / simple-candidate / simple-implemented / unavailable-complex / unavailable-no-rule. Только проверенная целиком строка становится simple-implemented.

absolyutnaya-pustota и khrebet-beskonechnoy-ploti имеют пустой effect: unavailable-no-rule, без блокировки остальных. Недоступные профили в новом installation/lootgen selector получают пояснение «Усовершенствования нет в реализации»; их не выдавать как работающую автоматизированную возможность. Каталог, старые world Items и пользовательские установленные upgrades не удалять; показывать статус, сохранять исторические данные.

Предлагаемый pure scripts/data/item-upgrade-rules.js:

- resolveUpgradeProfile(storedProfile,catalogProfile): сохранённый явный профиль выше каталога; fallback только stable ID;

- validateUpgradeInstallation(host,installed,candidate): compatibility, capacity, slot conflict, quantity и availability;

- evaluateUpgradeActivation(host,actor,profile): carried/equipped/held/attuned по конкретному правилу.
Один rules owner используется установкой и лутгеном. Existing install/remove/capacity владеет writes; read старого неподходящего профиля ничего не удаляет.

Предлагаемый pure scripts/data/item-value.js:
evaluateItemValue(descriptor,catalog) → {baseValue,upgradeValue,contentsValue,totalValue,diagnostics}.
Value — неотрицательный safe integer в медном эквиваленте. Existing resolveLootgenItemValue() в scripts/ui/lootgen-app.js: explicit value, иначе round(priceGold*100). Reuse/вынести эту политику, сохранив legacy callers; для новых descriptors различать известный 0 и отсутствующую цену.

total = base + сумма installed upgrades + contents. Оболочка/upgrade считаются по разу. Installed child не считается дополнительно ordinary contents. Если base цена уже содержит component, descriptor явно перечисляет included component IDs; не угадывать по названию.
Unknown price исключается из budget generation; explicit zero допускается при bounded count. Сломанность сохраняет existing pricing policy. Не пересчитывать массово world Items/магазины.

Focused: item-upgrade-service, gear-compendium, equipment-import-gear-profiles, curse-upgrade-automation-service; новые item-upgrade-rules, item-value, upgrade-automation-manifest.
Assertions: base1000+200+300=1500; zero/unknown/negative/overflow; duplicate component; nested contents; saved profile precedence; unavailable не выдаётся генератором.

## R7: две партии

1. Пассивные бонусы/простые данные: AC, saves, skills, HP max, speed, weight, stealth/strength requirement доспеха.
2. Простой damage/поглощение и predicates текущей атаки/цели: без нового state хода/раунда/ресурса.

Предлагаемый scripts/automation/item-upgrade-automation-service.js владеет только простыми непроклятыми проекциями. Использовать existing native/combat adapter. Если поддержанного пути нет и нужен отдельный engine, строку исключить согласно правилу пользователя.

Ключ: actorUuid+hostItemId+upgradeItemId+effectKey+projectionVersion. Sync идемпотентен; base отделён от derived, повтор sync не увеличивает бонус. Снятие/перенос/потеря условий убирают только свой managed contribution. Stacking задаётся правилом, не совпадением имён. Один queued sync через existing lifecycle, не hook на upgrade.

Weapon modifier относится только к своему host и нужной части damage. Второй weapon/secondary packet не получает лишнего бонуса. MIDI capability явно обозначена; init без него не падает.

Готовность: все simple-candidate переведены в simple-implemented с тестами либо unavailable с причиной. 11 curses — только regression. Нет обещания автоматически реализовать весь каталог.

Проверки: install/remove/reload/sync×3; два источника; wrong host; unheld weapon; чужие effects; host transfer; weight минимум0; source stealth; один/несколько damage packets; active GM. Existing curse suite зелёный. Live проверяет фактические modifier paths и отсутствие двойного бонуса.
