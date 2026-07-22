# Ремесленник V0.1: два нативных подкласса dnd5e — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Заменить обходные Item-типы Исследования/Специальности на два независимых нативных `subclass`-трека dnd5e для `craftsman-v01`, опубликовать все 12 вариантов из зафиксированной ревизии Google Docs и сохранить полный уровневый жизненный цикл обоих подклассов.

**Architecture:** Два Advancement-класса наследуют системный `SubclassAdvancement`, а два Flow-класса — системный `SubclassFlow`; различие между осями задаётся флагом `flags.rebreya-main.craftsmanTrack`. Все варианты публикуются в `world.rebreya-subclasses`. Узкий патч отношений Item, `AdvancementManager` и листов применяется только к `craftsman-v01`; остальные классы передаются исходной логике dnd5e без изменений.

**Tech Stack:** Foundry VTT 13, установленная система dnd5e, ES modules, Handlebars, Tidy5e Sheet API, `node:test`, JSON-компендиумы Foundry.

## Global Constraints

- Перед каждым набором правок выполнять `git status --short --branch`, `git branch --show-current`, `git fetch origin` и `git merge-base --is-ancestor origin/main HEAD`. Работать только в `lich_branch`.
- При чужих незакоммиченных изменениях либо если `origin/main` перестал быть предком `HEAD`, остановить работу и сообщить пользователю.
- Не сокращать, не пересказывать и не исправлять видимый авторский текст. Разрешена только невидимая Markdown-разметка.
- Канонический документ: Google Docs `1txV83llt1cC6PEFQCUA5FB53HOquCPEIelxOdua9bf8`, ревизия `AIroW34SYHbxIEd8hfh8j8hzbnG0i0cRyrMv3r2tLosHyzGf2l4OIqoMC8xBU220H_tJnksnZGuBtol42YomSQ`.
- Не создавать 35 сочетаний Исследование × Специальность. На Actor должны существовать ровно два независимо связанных Item типа `subclass`.
- Не подменять отсутствующие подсистемы фиктивными Active Effects или Activities. Гаджеты, Объект исследования, расширенный крафт, Actor/Token Конструкта, транспорт и авторские зелья остаются текстом выданных feature Items до отдельных реализаций.
- Старые `rebreya-main.research` и `rebreya-main.specialty` сохраняются в `module.json` и `CONFIG.Item.dataModels` только на период чтения и миграции существующих Actor; новые персонажи их не получают.
- После каждого этапа запускать указанный сфокусированный тест и делать отдельный осмысленный коммит. В конце запускать полный `node --test`, `git diff --check`, проверять итоговый diff, увеличивать версию модуля, затем обычный push `lich_branch` без force.

---

## Task 1: Зафиксировать системные контракты и общую модель двух треков

**Files:**

- Modify: `scripts/constants.js`
- Create: `scripts/integrations/craftsman-subclass-tracks.js`
- Create: `tests/craftsman-subclass-tracks.test.mjs`

### Step 1: Написать падающие тесты модели

В `tests/craftsman-subclass-tracks.test.mjs` покрыть:

- `CRAFTSMAN_CLASS_IDENTIFIER === "craftsman-v01"`;
- треки только `research` и `specialty`;
- `getCraftsmanSubclassTrack(item)` принимает только Item `type: "subclass"`, `system.classIdentifier: "craftsman-v01"` и допустимый флаг;
- `getCraftsmanSubclasses(classItem)` возвращает `{ research, specialty }` независимо от порядка Actor Items;
- два Item одного трека распознаются как нарушение, а по одному Item каждой оси — нет;
- обычный класс и подкласс другого класса не считаются Ремесленником.

Тестовые данные должны включать два настоящих `subclass`, а не старые модульные типы.

### Step 2: Подтвердить RED

Run: `node --test tests/craftsman-subclass-tracks.test.mjs`

Expected: падение импорта, потому что `craftsman-subclass-tracks.js` ещё не создан.

### Step 3: Добавить константы и чистые helper-функции

В `scripts/constants.js` экспортировать:

```js
export const CRAFTSMAN_CLASS_IDENTIFIER = "craftsman-v01";
export const CRAFTSMAN_TRACK_FLAG = "craftsmanTrack";
export const CRAFTSMAN_ARCHETYPE_ID_FLAG = "archetypeId";
export const CRAFTSMAN_TRACKS = Object.freeze({
  RESEARCH: "research",
  SPECIALTY: "specialty"
});
```

В новом модуле экспортировать функции `isCraftsmanClass(item)`, `getCraftsmanSubclassTrack(item)`, `getCraftsmanSubclasses(classItemOrActor)`, `hasCraftsmanTrackDuplicate(actor, candidate, { excludeId = "" })` и `assertValidCraftsmanSubclass(item, expectedTrack)`.

`getCraftsmanSubclasses` обязан перебирать `actor.items.contents`, `actor.items`, либо `actor.items.values()` и классифицировать Item только по типу, `system.classIdentifier` и флагу, никогда по имени. При дубле helper выбрасывает ошибку с Actor ID и названием трека: неоднозначное состояние нельзя молча разрешать выбором первого Item.

### Step 4: Подтвердить GREEN

Run: `node --test tests/craftsman-subclass-tracks.test.mjs`

Expected: все тесты проходят.

### Step 5: Commit

```powershell
git add scripts/constants.js scripts/integrations/craftsman-subclass-tracks.js tests/craftsman-subclass-tracks.test.mjs
git commit -m "feat: define Craftsman subclass tracks"
```

---

## Task 2: Реализовать два нативных Advancement и два нативных Flow

**Files:**

- Create: `scripts/integrations/craftsman-subclass-advancements.js`
- Modify: `scripts/integrations/craftsman-archetype-types.js`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Create: `tests/craftsman-subclass-advancements.test.mjs`
- Modify: `tests/craftsman-archetype-types.test.mjs`
- Modify: `lang/ru.json`

### Step 1: Написать контрактные тесты наследования и регистрации

Стабами установить:

- `game.dnd5e.documents.advancement.SubclassAdvancement`;
- `game.dnd5e.applications.advancement.SubclassFlow`;
- `game.dnd5e.applications.CompendiumBrowser.selectOne`;
- `CONFIG.DND5E.advancementTypes`;
- `fromUuid`, `Item.implementation.fromDropData`, notifications и минимальный `foundry.utils`.

Проверить:

- явно именованные JS-классы `ResearchSubclassAdvancement` и `SpecialtySubclassAdvancement` наследуют системный `SubclassAdvancement`, а их `name`/`typeName` равны соответственно `ResearchSubclassAdvancement`/`ResearchSubclass` и `SpecialtySubclassAdvancement`/`SpecialtySubclass`;
- их `metadata.apps.flow` наследуют системный `SubclassFlow` и сохраняют системный template `systems/dnd5e/templates/advancement/subclass-flow.hbs`;
- регистрация создаёт `CONFIG.DND5E.advancementTypes.ResearchSubclass` и `.SpecialtySubclass` с `validItemTypes: new Set(["class"])`;
- `availableForItem` разрешает соответствующий Advancement только классу `craftsman-v01` и только один раз на ось;
- `summaryForLevel` с заглавной `F` читает `value.document`, а не одиночный `item.subclass`; lowercase `summaryforLevel` допустим только как compatibility alias для опечатки установленной dnd5e;
- Browser получает `types: new Set(["subclass"])`, `additional.class: { "craftsman-v01": 1 }` и arbitrary-фильтр `{ k: "flags.rebreya-main.craftsmanTrack", o: "exact", v: track }`;
- drag-and-drop принимает только `subclass` Ремесленника нужного трека и отклоняет другой класс, другую ось и Item другого типа;
- `apply`, `restore` и fallback `reverse` валидируют трек и не создают второй Item той же оси.

Оператор должен быть именно `exact`: это имя сравнителя в установленной dnd5e, а не `eq`.

### Step 2: Подтвердить RED

Run: `node --test tests/craftsman-subclass-advancements.test.mjs tests/craftsman-archetype-types.test.mjs`

Expected: отсутствуют новые Advancement-классы; старый тест всё ещё ожидает `ResearchChoice`/`SpecialtyChoice`.

### Step 3: Реализовать tracked subclass Flow

Создать фабрику `createTrackedSubclassFlow(SubclassFlow, track)`. Наследник сохраняет `defaultOptions` родителя и переопределяет только:

- `_onBrowseCompendium` — тот же `CompendiumBrowser.selectOne`, но с дополнительным arbitrary-фильтром трека;
- `_onDrop` — системный разбор drag payload плюс `assertValidCraftsmanSubclass`;
- сообщение об ошибке — отдельные ключи локализации для неверного класса, неверной оси и дубликата.

Не копировать системный Handlebars-шаблон и не создавать собственную библиотеку выбора.

### Step 4: Реализовать tracked subclass Advancement

Создать фабрику `createTrackedSubclassAdvancement(SubclassAdvancement, Flow, track)`, возвращающую явно именованный `ResearchSubclassAdvancement` или `SpecialtySubclassAdvancement`: dnd5e выводит persisted `typeName` из `constructor.name.replace(/Advancement$/, "")`, поэтому анонимный `class extends` недопустим. Наследник должен:

- переопределить `metadata` только для title, hint, icon и `apps.flow`;
- использовать родительские `configuredForLevel`, создание source Item и dnd5e-флаги;
- перед `super.apply` разрешить source UUID и проверить тип, classIdentifier, track и отсутствие дубля;
- в `summaryForLevel` вывести anchor `this.value.document`; при необходимости добавить lowercase alias, делегирующий uppercase-методу;
- в `reverse` использовать `this.value.document`, а если ссылка уже не разрешается — Item своей оси из `getCraftsmanSubclasses(this.item)`.

Экспортировать `registerCraftsmanSubclassAdvancements()` и `getCraftsmanSubclassAdvancementClasses()`.

### Step 5: Оставить старые типы только для миграции

Из `scripts/integrations/craftsman-archetype-types.js` удалить создание и регистрацию `ResearchChoice`/`SpecialtyChoice`, а также расширение `ItemGrant.validItemTypes`. Оставить регистрацию data model старых типов под новым явным экспортом `registerLegacyCraftsmanArchetypeTypes()`; duplicate guard старых Item не расширять новой логикой.

В `extendDnd5eItemTypes()` на `init`, до dnd5e `i18nInit`, вызвать сначала legacy-регистрацию, затем `registerCraftsmanSubclassAdvancements()`: система локализует каждый зарегистрированный `documentClass`, поэтому поздняя регистрация недопустима. Обновить старые тесты так, чтобы они подтверждали только читаемость legacy Items и отсутствие старых Advancement в `CONFIG.DND5E.advancementTypes`.

### Step 6: Подтвердить GREEN

Run: `node --test tests/craftsman-subclass-advancements.test.mjs tests/craftsman-archetype-types.test.mjs`

Expected: все тесты проходят, Flow использует нативный шаблон и системный Browser.

### Step 7: Commit

```powershell
git add scripts/integrations/craftsman-subclass-advancements.js scripts/integrations/craftsman-archetype-types.js scripts/integrations/dnd5e-sheet-extensions.js tests/craftsman-subclass-advancements.test.mjs tests/craftsman-archetype-types.test.mjs lang/ru.json
git commit -m "feat: add native Craftsman subclass advancements"
```

---

## Task 3: Перенести все 12 вариантов и весь доступный текст дословно

**Files:**

- Modify: `data/craftsman-v01.json`
- Create: `tests/fixtures/craftsman-v01-source-revision.json`
- Modify: `tests/classes-compendium.test.mjs`

### Step 1: Создать независимый manifest зафиксированной ревизии

Из указанной ревизии Google Docs сформировать `tests/fixtures/craftsman-v01-source-revision.json`. Корневые поля: `documentId` со значением `1txV83llt1cC6PEFQCUA5FB53HOquCPEIelxOdua9bf8`, `revision` со значением `AIroW34SYHbxIEd8hfh8j8hzbnG0i0cRyrMv3r2tLosHyzGf2l4OIqoMC8xBU220H_tJnksnZGuBtol42YomSQ` и объект `entries`. Каждый ключ `entries` соответствует одной production-записи, а значение содержит вычисленный по реальному видимому тексту 16-символьный `visibleTextFingerprint`.

Внести отдельную запись для описания класса, каждого классового умения, каждого описания подкласса и каждого доступного умения подкласса. В production JSON и manifest нельзя хранить один и тот же ожидаемый fingerprint в одной записи: тест берёт ожидаемое значение только из fixture и вычисляет фактическое по `descriptionMarkdown`.

### Step 2: Написать падающие тесты состава и уровней

В `tests/classes-compendium.test.mjs` заменить ожидания двух вариантов на полный состав:

```js
const expectedResearches = [
  "Оружейник", "Бронник", "Алхимик", "Артефактор", "Оккультист", "Врачеватель", "Механик"
];
const expectedSpecialties = [
  "Штурмовик", "Защитник", "Конструктор", "Артиллерист", "Тактик"
];
```

Проверить уровни завершённых веток:

- Оружейник: `[2, 2, 5, 5, 9, 13]`;
- Бронник: `[2, 2, 5, 5, 9, 13]`;
- Алхимик: `[2, 2, 5, 5, 9, 13]`;
- Артефактор: `[2, 2, 5, 5, 9, 13]`;
- Механик: `[2, 5, 5, 9, 13]`;
- Конструктор: `[3, 3, 6, 10, 15]`.

Проверить отсутствие придуманных features у Оккультиста, Врачевателя, Штурмовика, Защитника, Артиллериста и Тактика. Для Алхимика проверить, что повторяющиеся авторские заголовки `Умение обращаться с зельями` не переименованы и не объединены; уникальность обеспечивается `id`, а не изменением видимого текста.

### Step 3: Подтвердить RED

Run: `node --test --test-name-pattern="craftsman" tests/classes-compendium.test.mjs`

Expected: найдено только одно Исследование и одна Специальность.

### Step 4: Механически заполнить `data/craftsman-v01.json`

Использовать стабильные archetype IDs:

- `craftsman-research-weaponsmith`;
- `craftsman-research-armorer`;
- `craftsman-research-alchemist`;
- `craftsman-research-artificer`;
- `craftsman-research-occultist`;
- `craftsman-research-healer`;
- `craftsman-research-mechanic`;
- `craftsman-specialty-assault`;
- `craftsman-specialty-defender`;
- `craftsman-specialty-constructor`;
- `craftsman-specialty-artillerist`;
- `craftsman-specialty-tactician`.

Зафиксировать соответствующие document IDs, полученные существующим `stableHashId` для этих идентификаторов:

| Archetype ID | Document ID |
| --- | --- |
| `craftsman-research-weaponsmith` | `fjf9y91usmmvo000` |
| `craftsman-research-armorer` | `18cjg6m14nk7hb00` |
| `craftsman-research-alchemist` | `9vn2lec3950y0000` |
| `craftsman-research-artificer` | `1my4r33ufb9eb000` |
| `craftsman-research-occultist` | `15zlg081ybp89o00` |
| `craftsman-research-healer` | `1jneoaf1wzh47000` |
| `craftsman-research-mechanic` | `a028poqh8xfm0000` |
| `craftsman-specialty-assault` | `1xaf4xz14cr1zo00` |
| `craftsman-specialty-defender` | `jej063u8aytv0000` |
| `craftsman-specialty-constructor` | `1xoogq41lnvp5q00` |
| `craftsman-specialty-artillerist` | `1dct6o91ps9ye900` |
| `craftsman-specialty-tactician` | `4488d4505bp50000` |

Для каждого варианта и умения:

- перенести все абзацы, списки, таблицы и повторения в исходном порядке;
- добавить Markdown headings, emphasis, lists, tables и blockquotes без изменения канонического видимого текста;
- указать `sourceRange` и `sourceFingerprint` для аудита, но тестовое эталонное значение брать из fixture;
- оставить `features: []`, если документ содержит только вводный текст;
- сохранить существующие IDs Механика и Конструктора;
- задать явный стабильный `documentId` для каждого из 12 вариантов, чтобы UUID не зависел от порядка массива.

Только Артефактор получает `spellcasting` по разделу «Использование заклинаний» и его таблицам. Полный список заклинаний переносится в видимый текст без сокращений; механически представимые поля прогрессии и подготовки записываются в `system.spellcasting`. Остальные незавершённые варианты не получают магической прогрессии по предположению.

### Step 5: Усилить тест дословности

Для каждой записи вычислить:

```js
const visible = canonicalizeDescriptionMarkdown(entry.descriptionMarkdown);
assert.equal(sourceFingerprint(visible), sourceManifest.entries[key].visibleTextFingerprint);
assert.equal(canonicalizeDescriptionHtml(renderDescriptionMarkdown(entry.descriptionMarkdown)), visible);
```

Также проверить, что множество ключей fixture в точности совпадает с множеством class/archetype/feature записей. Так пропущенное умение или лишний придуманный блок не сможет пройти тест.

### Step 6: Подтвердить GREEN

Run: `node --test --test-name-pattern="craftsman" tests/classes-compendium.test.mjs`

Expected: 12 вариантов, правильные уровни, все fingerprints и Markdown round-trip проходят.

### Step 7: Commit

```powershell
git add data/craftsman-v01.json tests/fixtures/craftsman-v01-source-revision.json tests/classes-compendium.test.mjs
git commit -m "data: add every Craftsman research and specialty"
```

---

## Task 4: Публиковать обе оси как обычные subclass Items

**Files:**

- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`

### Step 1: Переписать тесты построителей на native subclass

Удалить ожидания `ResearchChoice`, `SpecialtyChoice`, `configuration.type` и пула legacy-пака. Добавить ожидания:

- `buildCraftsmanSubclassAdvancements(classData)` возвращает `ResearchSubclass` уровня 2 и `SpecialtySubclass` уровня 3;
- оба имеют стабильные `_id`, пустую `configuration` и `value: { document: null, uuid: null }`;
- `buildCraftsmanSubclassDefinitions` создаёт Item `type: "subclass"`, `system.classIdentifier: "craftsman-v01"`, правильный `system.identifier`, `flags.rebreya-main.craftsmanTrack` и `archetypeId`;
- все 12 Item попадают в `world.rebreya-subclasses`;
- папки имеют пути `Архетипы/Ремесленник V0.1/Исследования` и `Архетипы/Ремесленник V0.1/Специальности`;
- повторная синхронизация обновляет документы с теми же `_id` и UUID;
- отсутствие UUID любого объявленного варианта прерывает построение класса с идентификатором отсутствующего archetype.

### Step 2: Подтвердить RED

Run: `node --test --test-name-pattern="craftsman|subclass pack" tests/classes-compendium.test.mjs`

Expected: определения всё ещё имеют legacy Item types и legacy pack.

### Step 3: Заменить нормализацию и построители

В `normalizeCraftsmanArchetypeAxis` устанавливать `type: "subclass"`, сохраняя `axis`, `archetypeId`, `documentId`, source revision, spellcasting и features.

Заменить:

- `buildCraftsmanChoiceAdvancements` → `buildCraftsmanSubclassAdvancements`;
- `buildCraftsmanArchetypeDefinitions` → `buildCraftsmanSubclassDefinitions`;
- `createCraftsmanArchetypeSystem` общей веткой `createSubclassSystem` либо эквивалентной структурой без legacy Item type;
- `createCraftsmanArchetypeEntryData` → `createCraftsmanSubclassEntryData`.

Данные класса должны содержать ровно:

```js
{
  type: "ResearchSubclass",
  level: 2,
  configuration: {},
  value: { document: null, uuid: null }
}
```

и аналогичный `SpecialtySubclass` уровня 3. UUID вариантов не записываются в Advancement: их выбирает нативный Browser. Перед публикацией class Item отдельно валидировать полную карту 12 UUID.

### Step 4: Объединить синхронизацию с `world.rebreya-subclasses`

`syncSubclassesPack` должен объединять обычные `normalizedData.subclasses` и Craftsman definitions в одном вызове `syncFlaggedManagedDocuments`. Для Craftsman entry записывать:

```js
flags: {
  "rebreya-main": {
    managed: true,
    sourceType: "subclass",
    subclassId: entry.archetypeId,
    archetypeId: entry.archetypeId,
    craftsmanTrack: entry.axis,
    classIdentifier: "craftsman-v01",
    sourceRevision: entry.sourceRevision,
    signature: entry.signature
  }
}
```

Возвращать `{ pack, subclassUuidById }`; карта включает обычные `subclassId` и Craftsman `archetypeId`. Порядок `ClassesCompendiumService.sync()`:

1. features;
2. общий subclass pack;
3. class pack с проверенной картой UUID;
4. безопасная очистка управляемых документов старого pack.

### Step 5: Сохранить feature grants и spellcasting

Для каждого Craftsman subclass оставить вложенные `ItemGrant` на уровнях из Task 3. Ключ feature UUID остаётся `${classIdentifier}::${axis}::${archetypeId}::${featureId}`. `system.spellcasting` Артефактора проходит через существующий `normalizeSpellcastingData`; у остальных остаётся `progression: "none"`, если документ не задаёт иначе.

### Step 6: Подтвердить GREEN

Run: `node --test --test-name-pattern="craftsman|subclass pack" tests/classes-compendium.test.mjs`

Expected: все варианты имеют type `subclass`, лежат в стандартном паке и class advancement содержит два native-derived типа.

### Step 7: Commit

```powershell
git add scripts/data/classes-compendium.js tests/classes-compendium.test.mjs
git commit -m "feat: publish Craftsman tracks as native subclasses"
```

---

## Task 5: Расширить связь class ↔ subclass и уровневый AdvancementManager

**Files:**

- Create: `scripts/integrations/craftsman-multi-subclass.js`
- Create: `tests/craftsman-multi-subclass.test.mjs`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`

### Step 1: Написать тесты совместимой связи

Стаб Item5e должен подтвердить:

- у обычного класса исходный getter `subclass` вызывается без изменений;
- у `craftsman-v01` `class.subclass` всегда возвращает Исследование, даже если Специальность раньше в Actor Items;
- оба subclass Item через штатный getter `.class` связываются с одним class Item;
- объект `{ research, specialty }` возвращает обе оси;
- дубликат трека вызывает явную ошибку.

### Step 2: Написать тесты порядка level-change

Для повышения 1→3 ожидать группы flow в порядке:

1. race;
2. class;
3. research;
4. specialty;
5. связанные feature Items;
6. финальный уровень.

На 2-м уровне должен возникнуть `ResearchSubclass`, на 3-м — независимо `SpecialtySubclass`. Для понижения 3→1 ожидать обратный безопасный порядок: dependent features, specialty, research, class, race. Отдельно проверить:

- уровни 5/6/9/10/13/15 обрабатывают вложенные Advancement обоих subclass;
- замена выбора на уровне 2 через `forModifyChoices` сохраняет Специальность уровня 3;
- замена выбора на уровне 3 сохраняет Исследование;
- обычный класс вызывает сохранённый оригинальный `createLevelChangeSteps` ровно один раз.

### Step 3: Подтвердить RED

Run: `node --test tests/craftsman-multi-subclass.test.mjs`

Expected: системный manager обходит только `classItem.subclass`.

### Step 4: Патч Item5e getter

`registerCraftsmanSubclassItemLinks()` должен сохранить исходный descriptor `CONFIG.Item.documentClass.prototype.subclass` и определить wrapper один раз под Symbol-флагом. Wrapper:

```js
if (!isCraftsmanClass(this)) return originalGetter.call(this);
return getCraftsmanSubclasses(this).research;
```

Это сохраняет совместимость dnd5e spellcasting: Артефактор как Исследование остаётся значением одиночного `class.subclass`, а Специальность доступна через общий helper.

### Step 5: Патч `createLevelChangeSteps` только для Ремесленника

Экспортировать чистый `createCraftsmanLevelChangeSteps(manager, classItem, levelDelta)`, повторяющий установленный алгоритм dnd5e, но использующий массив `[research, specialty].filter(Boolean)` вместо одного `classItem.subclass`.

Forward для каждого offset:

```js
pushSteps(flowsForLevel(raceItem, characterLevel), stepData);
pushSteps(flowsForLevel(classItem, classLevel), stepData);
pushSteps(flowsForLevel(research, classLevel), stepData);
pushSteps(flowsForLevel(specialty, classLevel), stepData);
pushSteps(getItemFlows(characterLevel, classLevel), stepData);
```

Reverse выполняет те же группы в обратном порядке. Финальный synthetic step и изменение `classItem.system.levels` должны совпасть с системным алгоритмом. `registerCraftsmanAdvancementManagerPatch()` вызывает helper только если `isCraftsmanClass(classItem)`, иначе `original.call(this, classItem, levelDelta)`.

### Step 6: Подтвердить GREEN

Run: `node --test tests/craftsman-multi-subclass.test.mjs`

Expected: оба трека проходят повышение/понижение, регрессия обычного класса отсутствует.

### Step 7: Commit

```powershell
git add scripts/integrations/craftsman-multi-subclass.js tests/craftsman-multi-subclass.test.mjs scripts/integrations/dnd5e-sheet-extensions.js
git commit -m "feat: advance both Craftsman subclasses"
```

---

## Task 6: Разрешить нативный drag/drop и независимую замену осей

**Files:**

- Modify: `scripts/integrations/craftsman-multi-subclass.js`
- Modify: `tests/craftsman-multi-subclass.test.mjs`
- Modify: `lang/ru.json`

### Step 1: Добавить падающие тесты sheet drop

Проверить:

- второй Craftsman subclass другой оси разрешён;
- второй subclass той же оси отклонён;
- subclass без `craftsmanTrack`, с другим `classIdentifier` или неизвестным треком отклонён;
- duplicate `system.identifier` по-прежнему отклонён;
- drop subclass другого класса полностью делегируется исходному CharacterActorSheet;
- core `preCreateItem` разрешает одну ось каждого типа и отклоняет duplicate/unknown track как для Standard, так и для Tidy/programmatic create;
- валидный create из `AdvancementManager` с `options.isAdvancement === true` проходит ту же проверку без ложной блокировки;
- `openCraftsmanSubclassChoice(actor, classId, "research")` вызывает `AdvancementManager.forModifyChoices(actor, classId, 2)`;
- для `specialty` используется уровень 3.

### Step 2: Подтвердить RED

Run: `node --test --test-name-pattern="drop|modify" tests/craftsman-multi-subclass.test.mjs`

Expected: штатная проверка блокирует второй subclass из-за `cls.subclass`.

### Step 3: Реализовать общий create-инвариант и узкий CharacterActorSheet patch

Зарегистрировать core `preCreateItem(document, data, options, userId)` hook как общий invariant для Standard, Tidy и programmatic create. Ограничить его embedded character Actor и входящими `subclass` Ремесленника: проверять managed source, `classIdentifier`, известный `craftsmanTrack` и отсутствие другой оси того же типа. Сохранить Hook ID и снимать его при unregister. `options.isAdvancement` не отключает проверки формы данных, но валидный create из AdvancementManager должен проходить.

Отдельно сохранить исходный Standard `CharacterActorSheet._onDropSingleItem`, потому что его singleton-проверка выполняется до core create hook. Для Item не типа `subclass` и subclass не Ремесленника вызвать исходный метод. Для валидного Craftsman subclass:

1. проверить duplicate identifier;
2. проверить `classIdentifier` и track;
3. проверить отсутствие Item той же оси;
4. вызвать generic `_onDropSingleItem` прототипа-родителя CharacterActorSheet, минуя только системную проверку «у класса уже есть один subclass».

Патч и hook должны устанавливаться один раз, иметь симметричный unregister и не изменять поведение NPC/обычных классов. Не патчить приватные/скомпилированные классы Tidy: их create-пути покрывает core hook.

### Step 4: Реализовать нативное изменение выбора

`openCraftsmanSubclassChoice` не открывает собственный dialog. Он находит class Item и запускает:

```js
const manager = AdvancementManager.forModifyChoices(actor, classId, track === "research" ? 2 : 3);
if (manager.steps.length) manager.render({ force: true });
```

Таким образом замена использует родной reverse/forward/restore цикл, тот же `SubclassFlow` template и тот же Browser.

### Step 5: Подтвердить GREEN

Run: `node --test --test-name-pattern="drop|modify" tests/craftsman-multi-subclass.test.mjs`

Expected: разные оси совместимы, дубль оси и неверный subclass блокируются.

### Step 6: Commit

```powershell
git add scripts/integrations/craftsman-multi-subclass.js tests/craftsman-multi-subclass.test.mjs lang/ru.json
git commit -m "feat: support native Craftsman subclass changes"
```

---

## Task 7: Встроить обе оси в штатную карточку класса Standard Sheet

**Files:**

- Create: `templates/craftsman-actor-classes.hbs`
- Create: `templates/craftsman-character-features.hbs`
- Rewrite: `scripts/integrations/craftsman-archetype-sheet.js`
- Rewrite: `tests/craftsman-archetype-sheet.test.mjs`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Modify: `tests/dnd5e-sheet-downtime-tab.test.mjs`
- Modify: `styles/main.css`
- Delete: `templates/craftsman-archetypes-standard.hbs`

### Step 1: Написать падающие тесты context

Новый `prepareCraftsmanClassCardContext(context)` должен:

- добавить `context.itemContext[classId].craftsmanSubclasses` с двумя view models;
- показывать icon, name, UUID, itemId, requiredLevel и `needsSelection` каждой оси;
- не оставлять второй Craftsman subclass ни в `context.subclasses`, ни в уже подготовленных feature sections как несвязанный loose Item;
- не изменять item context обычного класса;
- для уровня 1 не требовать выбора, на уровне 2 требовать Исследование, на уровне 3 — Специальность;
- давать action открытия Item, удаления Item и `openCraftsmanSubclassChoice` для соответствующего уровня.

Шаблонный тест должен подтвердить, что обе оси находятся внутри `<div class="class pill-lg">`, а отдельного заголовка «Архетипы Ремесленника» больше нет.

### Step 2: Подтвердить RED

Run: `node --test tests/craftsman-archetype-sheet.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs`

Expected: код всё ещё добавляет отдельный PART `craftsmanArchetypes`.

### Step 3: Патч подготовки features context

Перед штатным `_prepareFeaturesContext` упорядочить только Craftsman subclasses так, чтобы Исследование было первым и штатная логика связала его с class card. После штатной подготовки:

- вычислить обе оси через helper;
- удалить оставшуюся Специальность из `context.subclasses`;
- удалить тот же Item по ID из уже собранных `context.sections[*].items`/эквивалентной prepared feature-коллекции: штатный метод до возврата копирует остаток через spread, поэтому одной очистки `context.subclasses` недостаточно;
- записать plain view model в `context.itemContext[classId].craftsmanSubclasses`;
- заменить `ctx.needsSubclass` на отдельные `research.needsSelection` и `specialty.needsSelection` для Ремесленника.

### Step 4: Заменить PART features, а не добавлять новый PART

`templates/craftsman-character-features.hbs` повторяет системный `character-features.hbs`:

```hbs
<section class="tab {{ tab.cssClass }}" data-tab="{{ tab.id }}" data-group="{{ tab.group }}">
    {{> "modules/rebreya-main/templates/craftsman-actor-classes.hbs" }}
    {{> "systems/dnd5e/templates/inventory/inventory.hbs" }}
</section>
```

`craftsman-actor-classes.hbs` сохраняет системную разметку для обычных классов. Внутри существующей Craftsman pill выводит class icon, затем icon Исследования, затем icon Специальности; в `name-stacked` выводит обе подписи. Для отсутствующей доступной оси выводит plus action, вызывающий `openCraftsmanSubclassChoice`. У каждого выбранного Item остаются системные `showDocument` и `deleteDocument` controls.

`ensureCraftsmanClassCardDefinition(CharacterActorSheet)` меняет только `CharacterActorSheet.PARTS.features.template` и добавляет action. Не создавать `PARTS.craftsmanArchetypes`.

### Step 5: Удалить отдельный Standard block и его CSS

Удалить `templates/craftsman-archetypes-standard.hbs`, ветку `partId === "craftsmanArchetypes"`, старый state title и стили отдельной секции. Добавить только компактные модификаторы внутри `.class.pill-lg`, не меняющие обычные class pills.

### Step 6: Подтвердить GREEN

Run: `node --test tests/craftsman-archetype-sheet.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs`

Expected: две оси находятся в штатной class pill; старый отдельный PART отсутствует.

### Step 7: Commit

```powershell
git add templates/craftsman-actor-classes.hbs templates/craftsman-character-features.hbs scripts/integrations/craftsman-archetype-sheet.js tests/craftsman-archetype-sheet.test.mjs scripts/integrations/dnd5e-sheet-extensions.js tests/dnd5e-sheet-downtime-tab.test.mjs styles/main.css
git rm templates/craftsman-archetypes-standard.hbs
git commit -m "feat: show both Craftsman subclasses in class card"
```

---

## Task 8: Встроить обе оси в штатную область классов Tidy5e

**Files:**

- Create: `templates/craftsman-tidy-class-subclasses.hbs`
- Modify: `scripts/integrations/craftsman-archetype-sheet.js`
- Modify: `tests/craftsman-archetype-sheet.test.mjs`
- Modify: `styles/main.css`
- Delete: `templates/craftsman-archetypes.hbs`

### Step 1: Написать падающие тесты Tidy API

Проверить регистрацию через официальный `api.models.HandlebarsContent` и `api.registerCharacterContent`:

- `enabled` true только для Actor с `craftsman-v01`;
- для Quadrone `injectParams.selector === ".class-list"` и position помещает содержимое внутрь штатной области классов;
- для Classic используется отдельный существующий selector, а `onRender.nodes` переносит fragment рядом со строкой Craftsman `[data-item-id="<classId>"]`; тест обязан подтвердить ненулевой `nodes.length` в реалистичном Classic DOM;
- `getData` возвращает обе оси из настоящих `subclass` Items;
- повторный hook/API вызов идемпотентен;
- click на выбранной оси открывает Item, а click по отсутствующей доступной оси запускает native `forModifyChoices` уровня 2 или 3;
- Quadrone не дублирует штатную singleton-summary, а Classic не оставляет Specialty в `orphanedSubclasses`/features и не показывает `SubclassMismatchWarn`;
- legacy Item types не участвуют в новом Tidy view model.

### Step 2: Подтвердить RED

Run: `node --test --test-name-pattern="Tidy" tests/craftsman-archetype-sheet.test.mjs`

Expected: старый content вставляется в `[data-tab-contents-for='features']` отдельным блоком.

### Step 3: Перенести Tidy content в layout-specific class areas

Новый Handlebars template рендерит две компактные записи с иконками и названиями внутри штатной области классов. Не использовать заголовок отдельной секции. Создать две официальные регистрации: Quadrone якорится на `.class-list`; Classic якорится на существующий стабильный контейнер и через `onRender.nodes` перемещает fragment рядом со строкой Craftsman по `data-item-id`. `.class-list` в установленной Tidy 13.3.0 существует только в Quadrone, поэтому общий selector для двух layouts запрещён. `onRender` привязывает:

- `showDocument` к `item.sheet.render(true)`;
- `openCraftsmanSubclassChoice` к native AdvancementManager;
- повторную привязку без накопления listeners.

Для Quadrone удалить/скрыть только штатную singleton-summary Ремесленника, иначе одна ось будет продублирована. Для Classic удалить/скрыть только orphaned Specialty и связанное mismatch-warning, не затрагивая настоящие orphaned subclasses других классов. Зарегистрировать layouts `classic` и `quadrone` идемпотентно через официальный API; поскольку API не возвращает unregister token, `enabled` должен учитывать активное поколение регистрации.

### Step 4: Удалить общий старый template

Удалить `templates/craftsman-archetypes.hbs` и все ссылки на него. Очистить CSS `.rebreya-craftsman-archetypes` и оставить только классы нового inline-фрагмента.

### Step 5: Подтвердить GREEN

Run: `node --test --test-name-pattern="Tidy" tests/craftsman-archetype-sheet.test.mjs`

Expected: официальный API регистрируется один раз для каждого layout, Quadrone использует `.class-list`, Classic реально вставляет fragment рядом со строкой класса, singleton/orphan дубли отсутствуют, обе оси интерактивны.

### Step 6: Commit

```powershell
git add templates/craftsman-tidy-class-subclasses.hbs scripts/integrations/craftsman-archetype-sheet.js tests/craftsman-archetype-sheet.test.mjs styles/main.css
git rm templates/craftsman-archetypes.hbs
git commit -m "feat: integrate Craftsman subclasses with Tidy classes"
```

---

## Task 9: Мигрировать существующих Actor без потери choices и grants

**Files:**

- Create: `scripts/data/craftsman-subclass-migration.js`
- Create: `tests/craftsman-subclass-migration.test.mjs`
- Modify: `scripts/main.js`
- Modify: `scripts/constants.js`
- Modify: `scripts/settings.js`

### Step 1: Написать миграционные fixtures

Создать Actor fixtures со следующими состояниями:

1. class `craftsman-v01` с `ResearchChoice`, `SpecialtyChoice`, legacy research/specialty Items и их выданными feature Items;
2. только одна выбранная legacy-ось;
3. уже мигрированный Actor;
4. частично созданный новый subclass при сохранённом legacy Item;
5. частично заполненный `ItemGrant.value.added` либо переписанные feature flags без grant value;
6. отсутствующий source subclass UUID;
7. отсутствующий feature source;
8. сторонний документ в `world.rebreya-craftsman-archetypes` без `flags.rebreya-main.managed`;
9. Actor, импортированный после того, как world migration version уже стала текущей.

### Step 2: Написать падающие тесты двухфазной миграции

Проверить:

- `archetypeId` сопоставляет старый Item с новым `subclass` source;
- class advancement types становятся `ResearchSubclass`/`SpecialtySubclass`, уровни 2/3 и `value.document/uuid` указывают на новые embedded Items;
- у новых subclass Items валиден `flags.dnd5e.sourceId`, а `advancementOrigin`/`advancementRoot` отсутствуют, как после штатного `SubclassAdvancement.apply`;
- feature Items сохраняются, их origin/root переводятся со старого archetype Item ID на точный `newSubclassId.itemGrantAdvancementId`;
- каждый новый subclass `ItemGrant.value.added` содержит отображение `{ [embeddedFeatureId]: sourceFeatureUuid }`, поэтому level-down удаляет feature, а повторный level-up не создаёт дубль;
- каждая ось мигрируется независимо;
- повторный запуск не создаёт дубли;
- при любой недостающей source-ссылке legacy Items не удаляются;
- при ошибке после любой mutation boundary полные class/feature/legacy/partial-native snapshots восстанавливаются, включая legacy Item с прежним ID после частичного удаления;
- при текущей world migration version всё равно сканируется Actor без актуального actor flag, импортированный позже;
- сторонний документ legacy pack не удаляется.

### Step 3: Подтвердить RED

Run: `node --test tests/craftsman-subclass-migration.test.mjs`

Expected: migration service отсутствует.

### Step 4: Реализовать preflight и mutation plan

Экспортировать `CraftsmanSubclassMigrationService`. Для каждого Actor GM-проход должен сначала без записи построить plan:

- найти class Item и legacy advancement каждой оси;
- найти embedded legacy Item по типу и `archetypeId`;
- разрешить новый source из `world.rebreya-subclasses` по `flags.rebreya-main.archetypeId` и проверить track/classIdentifier;
- сопоставить feature Items по module flags `featureId`, `archetypeId`, `axis`, а не по имени;
- получить новый Advancement `_id` из опубликованного class source;
- сопоставить каждый feature с точным `ItemGrant` нового subclass по configured source UUID/уровню и подготовить его `value.added`;
- убедиться, что все будущие feature roots/origins разрешаются в `newSubclassId.itemGrantAdvancementId`; на самом subclass root/origin не планировать.

Если preflight не полон, бросить ошибку с Actor ID, axis и отсутствующим идентификатором до первой записи.

### Step 5: Реализовать транзакционное применение

Для Actor с успешным preflight:

1. сохранить полные source snapshots class Item, затрагиваемых feature Items, всех legacy Items, уже существующих partial-native subclass Items и actor migration flag;
2. создать только отсутствующие embedded `subclass` Items с sourceId и новыми ID; удалить с них `advancementOrigin`/`advancementRoot`;
3. обновить class advancement values и `ItemGrant.value.added` каждого нового subclass;
4. перепривязать feature origins/roots к точному ItemGrant нового subclass;
5. повторно прочитать Actor и проверить обе связи, sourceId, отсутствие subclass root/origin, все feature links и grant maps;
6. только после проверки удалить legacy embedded Items;
7. записать actor flag версии миграции последним.

При исключении восстановить полные class/features/partial-native snapshots, пересоздать уже удалённые legacy Items с исходными ID, удалить только созданные этим запуском новые Items и восстановить actor flag. Для состояния «новый Item уже есть, legacy ещё есть» не создавать второй новый Item: сверить и починить class value, grant maps и feature links, затем завершить валидацию и удаление идемпотентно. Actor flag считается подсказкой, а не заменой структурной проверки: crash между вызовами document API должен сходиться при повторном запуске.

Добавить скрытую world setting `SETTINGS_KEYS.CRAFTSMAN_SUBCLASS_MIGRATION_VERSION`; значение повышать только после полного GM-прохода всех Actor. Даже при текущем world version выполнять дешёвый scan actor flags/структуры и мигрировать импортированных позже персонажей; world setting не должен быть единственным условием раннего выхода.

### Step 6: Вызвать миграцию после публикации паков

В `RebreyaMainModule` создать service. В GM initialize выполнить `classesCompendium.sync()`, затем `craftsmanSubclassMigration.migrateWorldActors()`. Ошибка миграции показывает одно GM notification и логирует точные Actor/axis IDs, но не препятствует загрузке мира.

### Step 7: Подтвердить GREEN

Run: `node --test tests/craftsman-subclass-migration.test.mjs`

Expected: выборы и выданные features сохраняются, fail-closed и повторный запуск проходят.

### Step 8: Commit

```powershell
git add scripts/data/craftsman-subclass-migration.js tests/craftsman-subclass-migration.test.mjs scripts/main.js scripts/constants.js scripts/settings.js
git commit -m "feat: migrate Craftsman archetypes to subclasses"
```

---

## Task 10: Безопасно вывести legacy pack из публикации

**Files:**

- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `scripts/constants.js`

### Step 1: Написать падающие тесты retirement

Проверить `retireLegacyCraftsmanArchetypesPack(pack)`:

- функция вызывается только после успешного `syncSubclassesPack` и проверки 12 новых UUID;
- удаляются только документы с `flags.rebreya-main.managed === true` и `sourceType` `research`/`specialty`;
- сторонние документы и папки с ними сохраняются;
- отсутствие старого pack является нормальным no-op;
- metadata нового `world.rebreya-subclasses` допускает только `itemTypes: ["subclass"]`;
- `ClassesCompendiumService.sync()` больше не возвращает старый pack как рабочий источник.

### Step 2: Подтвердить RED

Run: `node --test --test-name-pattern="legacy Craftsman pack" tests/classes-compendium.test.mjs`

Expected: `syncCraftsmanArchetypesPack` всё ещё публикует legacy Items.

### Step 3: Реализовать безопасную очистку

Удалить рабочий вызов `syncCraftsmanArchetypesPack`. Открыть существующий `world.rebreya-craftsman-archetypes`, отфильтровать только управляемые модулем документы двух legacy source types, удалить их через Foundry document API, затем удалить только ставшие пустыми управляемые папки. Константы имени старого pack оставить с префиксом `LEGACY_`, потому что они нужны retirement и migration diagnostics.

### Step 4: Подтвердить GREEN

Run: `node --test --test-name-pattern="legacy Craftsman pack" tests/classes-compendium.test.mjs`

Expected: новые subclass уже опубликованы, управляемые legacy документы удалены, сторонние сохранены.

### Step 5: Commit

```powershell
git add scripts/data/classes-compendium.js tests/classes-compendium.test.mjs scripts/constants.js
git commit -m "refactor: retire legacy Craftsman archetype pack"
```

---

## Task 11: Интеграционная регрессия, manifest и ручная Foundry-проверка

**Files:**

- Modify: `module.json`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/dnd5e-sheet-downtime-tab.test.mjs`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-22-craftsman-native-dual-subclasses-design.md` only if implementation reveals an explicitly approved contract correction

### Step 1: Обновить manifest-тесты до изменения версии

Проверить:

- версия модуля увеличена с `1.4.107` на следующий patch;
- legacy `documentTypes.Item.research/specialty` пока присутствуют только для миграции;
- ни один preload/Part/template не ссылается на удалённые `craftsman-archetypes.hbs` и `craftsman-archetypes-standard.hbs`;
- production imports содержат новые advancement, lifecycle и migration modules;
- старые `ResearchChoice`/`SpecialtyChoice` не регистрируются.

### Step 2: Запустить сфокусированный suite

Run:

```powershell
node --test tests/craftsman-subclass-tracks.test.mjs tests/craftsman-subclass-advancements.test.mjs tests/craftsman-multi-subclass.test.mjs tests/craftsman-archetype-sheet.test.mjs tests/craftsman-subclass-migration.test.mjs tests/classes-compendium.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/module-manifest.test.mjs
```

Expected: все тесты проходят без skipped/failed.

### Step 3: Запустить полный suite и статические проверки

Run:

```powershell
node --test
git diff --check
rg -n "ResearchChoice|SpecialtyChoice|craftsmanArchetypes|craftsman-archetypes-standard|rebreya-craftsman-archetypes" scripts templates tests module.json
```

Expected:

- полный suite проходит;
- `git diff --check` не выводит ошибок;
- `ResearchChoice`/`SpecialtyChoice` встречаются только в migration fixtures/service;
- `rebreya-craftsman-archetypes` встречается только в legacy retirement/migration diagnostics;
- удалённые template имена и отдельный sheet part отсутствуют.

### Step 4: Ручная проверка в Foundry VTT 13

На новом Character Actor:

1. добавить `Ремесленник V0.1` из `world.rebreya-classes`;
2. повысить до уровня 2 и убедиться, что стандартный SubclassFlow/Browser показывает ровно 7 Исследований;
3. выбрать Механика и проверить embedded Item `type: subclass`, classIdentifier и track flag;
4. повысить до уровня 3 и убедиться, что второй стандартный SubclassFlow/Browser показывает ровно 5 Специальностей;
5. выбрать Конструктора и проверить одновременное наличие обоих subclass Items;
6. проверить обе иконки и оба названия внутри одной class pill Standard Sheet;
7. повторить отображение в Tidy classic и quadrone;
8. повысить/понизить через 5, 6, 9, 10, 13, 15 и проверить выдачу/отзыв features обеих осей;
9. заменить только Исследование через native modify choices и убедиться, что Специальность сохранилась;
10. заменить только Специальность и убедиться, что Исследование сохранилось;
11. проверить Артефактора: class spellcasting использует Исследование как совместимый `class.subclass`;
12. проверить обычный класс с одним подклассом;
13. открыть Actor старого формата и проверить автоматическую миграцию без потери features;
14. открыть все 12 subclass Items и визуально сверить видимый текст с указанной ревизией Google Docs, включая повторяющиеся заголовки Алхимика.

### Step 5: Просмотреть итоговый diff

Run:

```powershell
git status --short --branch
git diff --stat
git diff -- data/craftsman-v01.json scripts/data/classes-compendium.js scripts/integrations/craftsman-subclass-advancements.js scripts/integrations/craftsman-multi-subclass.js scripts/data/craftsman-subclass-migration.js scripts/integrations/craftsman-archetype-sheet.js templates styles/main.css module.json
```

Expected: только изменения этой реализации; никаких чужих файлов и сокращений текста.

### Step 6: Финальный commit и push

```powershell
git add module.json tests/module-manifest.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/classes-compendium.test.mjs
git commit -m "test: verify native dual Craftsman subclasses"
git status --short --branch
git log --oneline origin/lich_branch..HEAD
git push origin lich_branch
```

Expected: push без force успешен; `lich_branch` отслеживает `origin/lich_branch`, рабочее дерево чистое.

---

## Completion Criteria

- На Actor находятся два независимых Item `type: "subclass"`: одно Исследование и одна Специальность.
- Оба выбираются нативным SubclassFlow и стандартным Compendium Browser из `world.rebreya-subclasses`.
- В компендиуме опубликованы все 7 Исследований и все 5 Специальностей, без 35 составных вариантов.
- Полный доступный текст каждой записи дословно совпадает с зафиксированной ревизией; незавершённым веткам не придуманы features.
- Обе оси проходят повышение, понижение, замену и вложенные ItemGrant независимо.
- Standard Sheet и Tidy5e показывают обе оси в штатной области класса, без отдельного блока архетипов.
- Обычные классы сохраняют системное правило одного подкласса.
- Миграция существующих Actor идемпотентна, fail-closed и сохраняет выданные features.
- Полный test suite, `git diff --check`, ручной Foundry checklist и push `lich_branch` завершены успешно.
