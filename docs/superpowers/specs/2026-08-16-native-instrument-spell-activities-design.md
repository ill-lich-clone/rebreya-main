# Native Instrument Spell Activities Design

## Статус и наблюдаемый результат

После синхронизации managed-компендиума три магических инструмента — `Бандура Фоклучан`, `Лира Кли` и `Лютня Досс` — содержат отдельную нативную dnd5e `cast`-activity для каждого указанного в описании заклинания. Когда пользователь добавляет любой из этих предметов актёру, dnd5e штатно создаёт связанные cached-spell Items, показывает их в книге заклинаний, расходует отдельное использование соответствующего инструмента и восстанавливает его на рассвете.

Целевой актёр для ручной проверки — `Actor.J10Qou0x62CNVbj0` (Кэссиди Редсмит), но реализация не должна содержать его UUID или особое поведение для конкретного актёра.

## Границы задачи

В задачу входят только три перечисленных инструмента, их списки заклинаний и независимые ограничения «одно применение каждого заклинания до следующего рассвета».

В задачу не входят:

- изменения куклы героя, слотов экипировки или обычных/SRD-предметов;
- миграция, исправление или удаление уже существующих embedded Items у Кэссиди либо других актёров;
- автоматизация урона за игру без настройки, помехи целям против очарования и иных текстовых свойств инструментов;
- добавление заклинаний остальным магическим предметам;
- общий движок автоматизации предметных заклинаний.

## Жёсткое ограничение: только нативный dnd5e

Автоматизация строится исключительно на data model dnd5e 5.2.5:

- `system.activities` типа `cast` на самом магическом предмете;
- официальный linked-spell UUID из `dnd5e.spells`;
- штатные cached spells с `flags.dnd5e.cachedFor`, создаваемые и удаляемые самой системой;
- нативные `activityUses`, recovery `dawn` и обычный workflow использования linked spell;
- нативное отображение cached spells в spellbook.

Запрещены Rebreya-hooks `createItem`/`updateItem`/`deleteItem`, runtime-сервис ремонта актёров, макросы, Active Effects для учёта использований, собственный ресурс зарядов, socket-команды, actor-specific migration и fallback-копии заклинаний. Модуль только публикует корректные данные Item; жизненным циклом linked/cached spells управляет dnd5e.

## Владелец и data flow

Владелец shape магических предметов — `scripts/data/magic-items-compendium.js`, источник описаний — корневой `magicItem.js`, lifecycle managed-пака — существующий `scripts/data/managed-compendium-sync.js`.

Поток данных:

1. `MagicItemsCompendiumService.sync()` строит три Item с нативными `cast`-activities и обновляет их в managed-компендиуме по существующей signature-based схеме.
2. Пользователь удаляет старую копию инструмента у актёра и снова перетаскивает обновлённую копию из компендиума.
3. dnd5e при создании embedded Item разрешает UUID заклинаний и создаёт отдельные cached-spell Items.
4. Использование cached spell штатно связывается с исходной activity, расходует её `activityUses` и не расходует ячейку заклинаний актёра.
5. Нативное восстановление `dawn` возвращает использование только соответствующей activity.
6. При удалении инструмента dnd5e удаляет только cached spells, созданные для его activities.

Модуль не сканирует актёров и не пытается сопоставлять старые вручную созданные заклинания.

## Канонические заклинания

Каждая строка ниже создаёт отдельную activity с официальным UUID 2014-пака `dnd5e.spells`.

### Бандура Фоклучан

| Заклинание | Уровень | UUID |
| --- | ---: | --- |
| Дубинка / Shillelagh | 0 | `Compendium.dnd5e.spells.Item.VzgFzcmocr1X1cp4` |
| Защита от зла и добра / Protection from Evil and Good | 1 | `Compendium.dnd5e.spells.Item.xmDBqZhRVrtLP8h2` |
| Левитация / Levitate | 2 | `Compendium.dnd5e.spells.Item.MRxldJd6C4bsBo3O` |
| Невидимость / Invisibility | 2 | `Compendium.dnd5e.spells.Item.1N8dDMMgZ1h1YJ3B` |
| Огонь фей / Faerie Fire | 1 | `Compendium.dnd5e.spells.Item.nqBDWkVOfcGZt4YU` |
| Опутывание / Entangle | 1 | `Compendium.dnd5e.spells.Item.gMrWeG8fMDPRFiVe` |
| Полёт / Fly | 3 | `Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t` |
| Разговор с животными / Speak with Animals | 1 | `Compendium.dnd5e.spells.Item.aL1F8fvYLtNzUbKu` |

### Лира Кли

| Заклинание | Уровень | UUID |
| --- | ---: | --- |
| Защита от зла и добра / Protection from Evil and Good | 1 | `Compendium.dnd5e.spells.Item.xmDBqZhRVrtLP8h2` |
| Изменение формы камня / Stone Shape | 4 | `Compendium.dnd5e.spells.Item.QvGcdRUSNRKEQJlK` |
| Левитация / Levitate | 2 | `Compendium.dnd5e.spells.Item.MRxldJd6C4bsBo3O` |
| Невидимость / Invisibility | 2 | `Compendium.dnd5e.spells.Item.1N8dDMMgZ1h1YJ3B` |
| Огненная стена / Wall of Fire | 4 | `Compendium.dnd5e.spells.Item.X3DrXgxjwI2dvkD6` |
| Полёт / Fly | 3 | `Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t` |
| Стена ветров / Wind Wall | 3 | `Compendium.dnd5e.spells.Item.ew6GA8dJy2spQmFW` |

### Лютня Досс

| Заклинание | Уровень | UUID |
| --- | ---: | --- |
| Дружба с животными / Animal Friendship | 1 | `Compendium.dnd5e.spells.Item.hDOENzjuj5WpLq7B` |
| Защита от энергии / Protection from Energy (только огонь) | 3 | `Compendium.dnd5e.spells.Item.j8NtLXOOJ3GAKF8I` |
| Защита от яда / Protection from Poison | 2 | `Compendium.dnd5e.spells.Item.MAxM77CDUu8dgIRQ` |
| Защита от зла и добра / Protection from Evil and Good | 1 | `Compendium.dnd5e.spells.Item.xmDBqZhRVrtLP8h2` |
| Левитация / Levitate | 2 | `Compendium.dnd5e.spells.Item.MRxldJd6C4bsBo3O` |
| Невидимость / Invisibility | 2 | `Compendium.dnd5e.spells.Item.1N8dDMMgZ1h1YJ3B` |
| Полёт / Fly | 3 | `Compendium.dnd5e.spells.Item.yfbK8gZqESlaoY5t` |

Для `Protection from Energy` используется официальный общий spell Item. Ограничение «только огонь» явно остаётся в названии activity и в исходном описании предмета; отдельный runtime-фильтр выбора типа урона не добавляется, поскольку у dnd5e нет нативной специализированной fire-only копии этого заклинания.

## Контракт каждой activity

Каждая activity:

- имеет тип `cast`, активацию `action` и ссылку на один UUID из таблиц выше;
- показывает linked spell в spellbook;
- использует базовую характеристику заклинателя актёра без фиксированного override атаки или Сл;
- игнорирует обычные компоненты заклинания через штатные настройки item-cast activity;
- имеет собственные uses: максимум `1`, начальное spent `0`, recovery `recoverAll` с периодом `dawn`;
- расходует ровно `1` собственного `activityUses` при использовании;
- не требует и не расходует spell slot актёра.

Activities получают детерминированные stable IDs. ID должен учитывать одновременно identity инструмента и identity заклинания, поэтому одинаковое заклинание на разных инструментах остаётся тремя разными ресурсами. Например, `Fly` на Бандуре, Лире и Лютне можно применить по одному разу с каждого предмета до рассвета; это не общий ресурс `3/день`.

## Managed sync и совместимость

Новый shape activities и отдельная версия этого shape входят в magic-item signature только для трёх целевых инструментов. Этого достаточно, чтобы managed sync обновил их существующие документы без глобального повышения `MAGIC_TEMPLATE_VERSION` и массовой перезаписи остальных магических предметов. Stable document IDs самих инструментов не меняются; unmanaged документы и остальные managed magic items не затрагиваются.

Существующие actor-owned копии намеренно не мигрируются. Для Кэссиди после синхронизации пользователь вручную:

1. удаляет старые три инструмента;
2. удаляет ранее созданные вручную дубли заклинаний этих инструментов;
3. добавляет каждый обновлённый инструмент из компендиума заново.

После этого cached spells принадлежат нативным activity links и удаляются вместе со своим инструментом.

## Ошибки и отсутствие fallback

Если официальный spell UUID недоступен или несовместим с установленной системой, модуль не создаёт поддельный spell Item и не запускает альтернативную автоматизацию. Ошибка должна быть видна при ручной smoke-проверке, а точные UUID и activity shape защищаются focused-тестами. Такой отказ предпочтительнее скрытого расхождения с нативным dnd5e.

## Изменяемые файлы

- `scripts/data/magic-items-compendium.js` — таблица определений и нативный activity shape;
- `tests/magic-items-compendium.test.mjs` — focused-контракт для трёх инструментов;
- `docs/function-passport.md`, раздел 15 — новые или изменённые builder-методы, signature/data flow и профильные тесты;
- `module.json` и versioned forwarder — только если этого требует обычный release-процесс реализации.

`magicItem.js` остаётся каноническим источником текста и не требует изменения, если списки в описаниях уже совпадают с таблицами. Публичный API модуля не меняется, поэтому README не требует нового API-раздела.

## Проверка и критерии готовности

Focused-тесты должны доказать:

- точные наборы из `8`, `7` и `7` activities для Бандуры, Лиры и Лютни соответственно;
- точные UUID и уровни всех linked spells;
- нативный тип `cast`, spellbook visibility, actor spellcasting ability без фиксированной Сл, отсутствие расхода spell slots;
- отдельные `1/dawn` activity uses и consumption `activityUses: 1` для каждой строки;
- детерминированность IDs и различие IDs одинаковых заклинаний на разных инструментах;
- включение activities и их отдельной версии в signature только трёх целевых инструментов;
- отсутствие activities у контрольного магического предмета вне этих трёх;
- отсутствие actor UUID, actor mutation hooks и нового runtime-сервиса в реализации.

Ручная проверка в Foundry VTT 13 / dnd5e 5.2.5 на Кэссиди должна подтвердить:

1. после повторного добавления каждого инструмента появляются его cached spells;
2. одинаковые заклинания от разных инструментов видны как отдельные источники и имеют независимые uses;
3. применение заклинания расходует только use исходной activity и не расходует ячейку актёра;
4. повторное применение той же activity до рассвета заблокировано, а применение того же заклинания с другого инструмента доступно;
5. recovery на рассвете восстанавливает каждую activity;
6. удаление одного инструмента удаляет только его cached spells.

Перед завершением реализации также обязательны полный Node test suite, syntax-check всех tracked JS/MJS, parse-check всех tracked JSON и Git-проверки из `AGENTS.md`.
