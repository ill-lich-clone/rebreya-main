# Craftsman V0.1 Dual Archetypes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить полностью работоспособный Item класса «Ремесленник V0.1» с двумя независимыми штатными выборами — Исследованием «Механик» и Специальностью «Конструктор» — и дословными Markdown-описаниями из зафиксированной ревизии Google-документа.

**Architecture:** Модуль регистрирует Item-типы `rebreya-main.research` и `rebreya-main.specialty`, наследующие модель dnd5e `subclass`, но не участвующие в единственном штатном слоте подкласса. Специализированные `ResearchChoice` и `SpecialtyChoice` наследуют `ItemChoiceAdvancement`, принимают только свой тип Item и связывают выбранный архетип с Item класса через стандартные флаги dnd5e. Импортёр сначала синхронизирует умения, затем архетипы в отдельный управляемый компендий, затем класс. Один безопасный Markdown-рендерер обслуживает описания и проверяет сохранение видимого текста. Стандартный лист получает отдельную секцию через существующий context-патч, Tidy5e — через официальный custom-content API.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, ES modules, Handlebars, Tidy5e custom-content API, CSS, `node:test`, PowerShell, Git.

## Global Constraints

- Эталон текста: Google Doc `D&D Ремесленник V0.1`, document id `1txV83llt1cC6PEFQCUA5FB53HOquCPEIelxOdua9bf8`, revision id `AIroW34SYHbxIEd8hfh8j8hzbnG0i0cRyrMv3r2tLosHyzGf2l4OIqoMC8xBU220H_tJnksnZGuBtol42YomSQ`.
- Любой текст класса, Механика и Конструктора переносится дословно: без сокращений, пересказа, перестановки, исправления опечаток и замены терминов. Markdown-маркеры не должны добавлять или удалять видимые слова.
- В первый этап не входят рантайм-автоматизация гаджетов, Actor/Token конструкта, транспорта, ремонта, магического крафта, Опыта Души, реакций, зон, атак и состояний.
- Класс не содержит Advancement типа `Subclass`. Исследование и Специальность — независимые настоящие Items, а не `feat` и не составной подкласс.
- Каждый новый тест сначала должен падать по ожидаемой причине; только затем пишется реализация.
- Перед каждым блоком правок выполнить `git status --short --branch`, `git branch --show-current` и `git fetch origin --prune`. Продолжать только на `lich_branch`, при чистом дереве и если `git merge-base --is-ancestor origin/main HEAD` завершился кодом `0`.
- После каждого логического блока просмотреть `git diff`, выполнить указанные тесты, сделать осмысленный commit. В конце запушить `lich_branch` обычным push без `--force`.
- Если появляются посторонние незакоммиченные изменения или конфликт с `origin/main`, остановить работу и сообщить пользователю.

---

### Task 1: Безопасный Markdown и контроль потери текста

**Files:**

- Create: `scripts/data/markdown-description.js`
- Create: `tests/markdown-description.test.mjs`
- Modify: `scripts/data/classes-compendium.js`

- [ ] **Step 1: Зафиксировать падающие тесты публичного контракта**

Создать `tests/markdown-description.test.mjs` с тестами следующих экспортов:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeDescriptionHtml,
  canonicalizeDescriptionMarkdown,
  renderDescriptionMarkdown,
  verifyDescriptionTextPreserved
} from "../scripts/data/markdown-description.js";

test("description markdown renders the supported structural blocks", () => {
  const markdown = [
    "## Конструкт",
    "",
    "*3-й уровень, умение конструктора*",
    "",
    "**Природа конструкта.** Текст.",
    "",
    "- Первый вариант",
    "  - Вложенный вариант",
    "",
    "> Сл = 8 + БМ + Интеллект",
    "",
    "| КД | Хиты |",
    "| --- | --- |",
    "| 13 | 5 + пять ваших уровней |"
  ].join("\n");

  const html = renderDescriptionMarkdown(markdown);
  assert.match(html, /<h2>Конструкт<\/h2>/u);
  assert.match(html, /<em>3-й уровень, умение конструктора<\/em>/u);
  assert.match(html, /<strong>Природа конструкта\.<\/strong>/u);
  assert.match(html, /<ul>[\s\S]*<ul>/u);
  assert.match(html, /<blockquote>/u);
  assert.match(html, /<table>[\s\S]*<thead>[\s\S]*<tbody>/u);
});

test("raw html is escaped and Foundry UUID labels retain visible text", () => {
  const markdown = "<script>alert(1)</script> @UUID[Compendium.dnd5e.items.Item.abc]{Щит [Shield]}";
  const html = renderDescriptionMarkdown(markdown);
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /@UUID\[Compendium\.dnd5e\.items\.Item\.abc\]\{Щит \[Shield\]\}/u);
});

test("markdown and rendered html have identical canonical visible text", () => {
  const markdown = "### Единая система\n\n**Эффект.** Исходный текст автора.";
  const html = renderDescriptionMarkdown(markdown);
  assert.equal(canonicalizeDescriptionMarkdown(markdown), canonicalizeDescriptionHtml(html));
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});
```

- [ ] **Step 2: Убедиться, что тест падает из-за отсутствующего модуля**

Run: `node --test tests/markdown-description.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` для `scripts/data/markdown-description.js`.

- [ ] **Step 3: Реализовать детерминированный рендерер**

В `scripts/data/markdown-description.js` экспортировать ровно четыре функции из теста. Реализация должна:

- сначала экранировать `&`, `<`, `>` и кавычки;
- временно защищать целиком токены `@UUID[uuid]{label}`;
- поддерживать заголовки `#`–`######`, `*emphasis*`, `**strong**`, абзацы, `<br>`, упорядоченные и неупорядоченные списки с двухпробельной вложенностью, цитаты и таблицы;
- не разрешать сырой HTML;
- возвращать Foundry UUID-токены без изменения их видимой подписи;
- сравнивать канонический текст после удаления только Markdown/HTML-маркеров, UUID-адреса и технических пробелов между блоками;
- бросать `Error("Description renderer changed visible text")`, если формы расходятся.

Точка входа должна проверять себя перед возвратом:

```js
export function renderDescriptionMarkdown(markdown) {
  const source = normalizeNewlines(String(markdown ?? ""));
  const html = renderBlocks(source);
  verifyDescriptionTextPreserved(source, html);
  return html;
}
```

- [ ] **Step 4: Подключить рендерер к существующему импортёру**

В `scripts/data/classes-compendium.js` импортировать `renderDescriptionMarkdown`, заменить локальный `toHtmlParagraphs` на делегирование новому модулю и не менять вызовы создания описаний. Это сохраняет обратную совместимость всех существующих классов и одновременно включает расширенную разметку.

- [ ] **Step 5: Запустить точечные и регрессионные тесты**

Run: `node --test tests/markdown-description.test.mjs tests/classes-compendium.test.mjs`

Expected: оба файла проходят; существующие описания и таблицы не ломаются.

- [ ] **Step 6: Проверить diff и зафиксировать блок**

Run: `git diff --check`

Run: `git diff -- scripts/data/markdown-description.js scripts/data/classes-compendium.js tests/markdown-description.test.mjs`

Commit: `feat: add safe markdown class descriptions`

---

### Task 2: Два Item-типа и два специализированных Advancement

**Files:**

- Create: `scripts/integrations/craftsman-archetype-types.js`
- Create: `tests/craftsman-archetype-types.test.mjs`
- Modify: `scripts/constants.js`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Modify: `module.json`
- Modify: `lang/ru.json`
- Modify: `tests/module-manifest.test.mjs`

- [ ] **Step 1: Написать падающие тесты manifest и регистрации**

В `tests/module-manifest.test.mjs` проверить `documentTypes.Item.research` и `documentTypes.Item.specialty`, включая `description.value` и `description.chat` в `htmlFields`.

В `tests/craftsman-archetype-types.test.mjs` создать Foundry/dnd5e stubs и проверить:

```js
assert.equal(CONFIG.Item.dataModels["rebreya-main.research"].prototype instanceof SubclassData, true);
assert.equal(CONFIG.Item.dataModels["rebreya-main.specialty"].prototype instanceof SubclassData, true);
assert.deepEqual([...ResearchChoice.VALID_TYPES], ["rebreya-main.research"]);
assert.deepEqual([...SpecialtyChoice.VALID_TYPES], ["rebreya-main.specialty"]);
assert.deepEqual([...CONFIG.DND5E.advancementTypes.ResearchChoice.validItemTypes], ["class"]);
assert.deepEqual([...CONFIG.DND5E.advancementTypes.SpecialtyChoice.validItemTypes], ["class"]);
assert.equal(CONFIG.DND5E.advancementTypes.ItemGrant.validItemTypes.has("rebreya-main.research"), true);
assert.equal(CONFIG.DND5E.advancementTypes.ItemGrant.validItemTypes.has("rebreya-main.specialty"), true);
assert.equal(ItemChoiceAdvancement.VALID_TYPES.has("rebreya-main.research"), false);
assert.equal(ItemChoiceAdvancement.VALID_TYPES.has("rebreya-main.specialty"), false);
```

Также проверить чистую функцию уникальности:

```js
assert.equal(hasDuplicateCraftsmanArchetype(actor, {
  type: "rebreya-main.research",
  system: { classIdentifier: "craftsman-v01" }
}), true);
assert.equal(hasDuplicateCraftsmanArchetype(actor, {
  type: "rebreya-main.specialty",
  system: { classIdentifier: "craftsman-v01" }
}), false);
```

- [ ] **Step 2: Убедиться, что тесты падают до реализации**

Run: `node --test tests/craftsman-archetype-types.test.mjs tests/module-manifest.test.mjs`

Expected: импорт нового модуля или manifest assertions падают.

- [ ] **Step 3: Добавить константы и manifest-типы**

В `scripts/constants.js` добавить:

```js
export const RESEARCH_ITEM_TYPE = `${MODULE_ID}.research`;
export const SPECIALTY_ITEM_TYPE = `${MODULE_ID}.specialty`;
export const CRAFTSMAN_ARCHETYPES_COMPENDIUM_NAME = "rebreya-craftsman-archetypes";
export const CRAFTSMAN_ARCHETYPES_COMPENDIUM_LABEL = "Ремесленник: архетипы";
```

В `module.json` добавить `research` и `specialty` рядом с `state` и `downtime`. В `lang/ru.json` добавить ключи единственного и множественного числа, названия Advancement и сообщения о дубликате.

- [ ] **Step 4: Реализовать DataModel без глобального singleton**

В `scripts/integrations/craftsman-archetype-types.js` создать фабрику наследников `CONFIG.Item.dataModels.subclass`. Обе модели наследуют `classIdentifier`, `advancement` и `advancementClassLinked`, меняют subtitle/favorite label и проверяют дубликат по паре `(type, system.classIdentifier)`. Проверка игнорирует текущий Item при update и отменяет только создание второго Item той же оси того же класса.

Публичный контракт файла состоит из `hasDuplicateCraftsmanArchetype(actor, candidate, { excludeId = "" } = {})` и `registerCraftsmanArchetypeTypes()`.

- [ ] **Step 5: Реализовать специализированные Advancement**

Классы наследуют `game.dnd5e.documents.advancement.ItemChoiceAdvancement`, каждый объявляет собственный новый `Set`, не изменяя `ItemChoiceAdvancement.VALID_TYPES`:

```js
class ResearchChoiceAdvancement extends ItemChoiceAdvancement {
  static VALID_TYPES = new Set([RESEARCH_ITEM_TYPE]);
}

class SpecialtyChoiceAdvancement extends ItemChoiceAdvancement {
  static VALID_TYPES = new Set([SPECIALTY_ITEM_TYPE]);
}
```

Зарегистрировать их в `CONFIG.DND5E.advancementTypes` с `validItemTypes: new Set(["class"])`; config/flow берутся из унаследованной metadata. Добавить оба новых Item type в `CONFIG.DND5E.advancementTypes.ItemGrant.validItemTypes`, чтобы архетипы могли содержать штатные вложенные выдачи, но не расширять список типов документов, которые сам `ItemGrant` способен выдать. Экспортировать созданные классы через тестовый accessor `getCraftsmanAdvancementClasses()`.

- [ ] **Step 6: Подключить регистрацию к init**

Импортировать и вызвать `registerCraftsmanArchetypeTypes()` внутри `extendDnd5eItemTypes()` после проверки dnd5e. Отсутствие dnd5e возвращает `false` и не меняет глобальные CONFIG.

- [ ] **Step 7: Запустить тесты и зафиксировать блок**

Run: `node --test tests/craftsman-archetype-types.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs`

Expected: все тесты проходят; базовый `ItemChoiceAdvancement.VALID_TYPES` не расширен.

Run: `git diff --check`

Commit: `feat: register craftsman archetype types`

---

### Task 3: Нормализация данных и управляемый компендий архетипов

**Files:**

- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`

- [ ] **Step 1: Написать падающие тесты двух независимых осей**

Добавить fixture-объект класса с `researches` и `specialties` и проверить:

```js
const advancements = buildClassAdvancement(craftsman.classData, {
  featureUuidById,
  archetypeUuidById
});
const research = advancements.find((entry) => entry.type === "ResearchChoice");
const specialty = advancements.find((entry) => entry.type === "SpecialtyChoice");

assert.equal(research.level, 2);
assert.equal(research.configuration.type, "rebreya-main.research");
assert.deepEqual(research.configuration.pool, [{ uuid: archetypeUuidById.get("craftsman-research-mechanic") }]);
assert.equal(specialty.level, 3);
assert.equal(specialty.configuration.type, "rebreya-main.specialty");
assert.deepEqual(specialty.configuration.pool, [{ uuid: archetypeUuidById.get("craftsman-specialty-constructor") }]);
assert.equal(advancements.some((entry) => entry.type === "Subclass"), false);
```

Проверить определения и вложенные выдачи:

```js
assert.deepEqual(mechanic.system.advancement.map((entry) => entry.level), [2, 5, 5, 9, 13]);
assert.deepEqual(constructor.system.advancement.map((entry) => entry.level), [3, 3, 6, 10, 15]);
assert.equal(mechanic.type, "rebreya-main.research");
assert.equal(constructor.type, "rebreya-main.specialty");
assert.equal(mechanic.system.classIdentifier, "craftsman-v01");
assert.equal(constructor.system.classIdentifier, "craftsman-v01");
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test --test-name-pattern="craftsman|archetype" tests/classes-compendium.test.mjs`

Expected: отсутствуют нормализованные `researches`, `specialties` и специализированные Advancement.

- [ ] **Step 3: Расширить нормализованную модель**

`normalizeClassCompendiumData` должен возвращать:

```js
{
  classData,
  classFeatures,
  subclasses,
  researches,
  specialties,
  sourceLabel,
  sourceRevision
}
```

Для каждого архетипа нормализовать `archetypeId`, `name`, `descriptionMarkdown`, `features`, `classIdentifier`, `documentId` и `sourceRevision`. Ключ feature UUID сделать однозначным:

```js
`${classIdentifier}::${axis}::${archetypeId}::${featureId}`
```

Где `axis` равен `research` или `specialty`.

- [ ] **Step 4: Построить записи архетипов и специализированные choices**

Экспортировать для тестов `buildCraftsmanArchetypeDefinitions(normalizedData)`, `buildCraftsmanArchetypeAdvancements(archetype, context)` и `buildCraftsmanChoiceAdvancements(classData, context)`.

Каждый архетип получает `system.description.value`, `system.classIdentifier` и вложенные `ItemGrant` с feature UUID. Каждый ItemGrant имеет стабильный `_id`, `configuration.items`, `value.added` и правильный level. Если хотя бы один обязательный feature UUID отсутствует, бросить ошибку с `featureId`.

В `buildClassAdvancement`:

- добавить `ResearchChoice` и `SpecialtyChoice` из `archetypeUuidById`;
- не добавлять `buildSubclassAdvancement` при `classData.archetypeTracks === "research-specialty"`;
- для всех остальных классов оставить существующий `Subclass` без изменений;
- бросить понятную ошибку при отсутствующем UUID `craftsman-research-mechanic` или `craftsman-specialty-constructor`.

- [ ] **Step 5: Добавить синхронизацию `world.rebreya-craftsman-archetypes`**

Создать `syncCraftsmanArchetypesPack` по паттерну `syncSubclassesPack`, но с:

```js
itemTypes: [RESEARCH_ITEM_TYPE, SPECIALTY_ITEM_TYPE]
```

Флаги управляемого документа:

```js
{
  [MODULE_ID]: {
    managed: true,
    sourceType: axis,
    archetypeId,
    classIdentifier,
    sourceRevision,
    signature
  }
}
```

Порядок `ClassesCompendiumService.sync()` изменить на features → craftsman archetypes → subclasses → classes. Возвращаемое значение дополнить `craftsmanArchetypesPack`.

- [ ] **Step 6: Проверить idempotency и сохранение существующих классов**

Добавить тест с двумя последовательными синхронизациями: UUID обоих архетипов не меняются, записи обновляются на месте, managed-документы других source types не удаляются. Отдельный тест подтверждает, что Воин, Варвар, Паладин, Плут и Чародей всё ещё получают штатный `Subclass`.

- [ ] **Step 7: Запустить тесты и зафиксировать блок**

Run: `node --test tests/classes-compendium.test.mjs tests/managed-compendium-sync.test.mjs`

Expected: все тесты проходят, включая существующие классы.

Run: `git diff --check`

Commit: `feat: sync craftsman dual archetypes`

---

### Task 4: Дословные данные Ремесленника, Механика и Конструктора

**Files:**

- Create: `data/craftsman-v01.json`
- Modify: `data/gear.json`
- Modify: `scripts/data/item-classification.js`
- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `tests/gear-compendium.test.mjs`

- [ ] **Step 1: Повторно прочитать зафиксированную ревизию перед переносом**

Через Google Drive получить документ id `1txV83llt1cC6PEFQCUA5FB53HOquCPEIelxOdua9bf8`. Сверить полученный revision id с `AIroW34SYHbxIEd8hfh8j8hzbnG0i0cRyrMv3r2tLosHyzGf2l4OIqoMC8xBU220H_tJnksnZGuBtol42YomSQ`. Если revision отличается, не смешивать тексты и остановиться для согласования.

- [ ] **Step 2: Сначала написать тесты структурных данных**

Добавить проверки:

```js
assert.equal(craftsman.classData.identifier, "craftsman-v01");
assert.equal(craftsman.classData.hitDie, "d8");
assert.equal(craftsman.classData.spellcasting.progression, "none");
assert.deepEqual(craftsman.classData.saveProficiencies, ["con", "int"]);
assert.equal(craftsman.classData.skillChoiceCount, 2);
assert.deepEqual(craftsman.classData.skillPool, ["prc", "his", "slt", "arc", "med", "nat", "inv"]);
assert.deepEqual(craftsman.classData.scaleAdvancements.find((entry) => entry.identifier === "gadgets").progression, {
  "1": 2, "5": 3, "9": 4, "13": 5, "17": 6
});
assert.deepEqual(craftsman.classData.scaleAdvancements.find((entry) => entry.identifier === "soul-xp").progression, {
  "2": 200, "3": 300, "4": 400, "5": 500, "6": 600, "7": 700, "8": 800,
  "9": 900, "10": 1000, "11": 5000, "12": 10000, "13": 20000, "14": 30000,
  "15": 30000, "16": 30000, "17": 40000, "18": 40000, "19": 40000, "20": 40000
});
```

Проверить уровни базовых умений:

```js
assert.deepEqual(craftsman.classFeatures.map(({ name, level }) => [name, level]), [
  ["Задорный гаджет", 1],
  ["Рука творца", 1],
  ["Душа творца", 2],
  ["Прикладной работник", 2],
  ["Подходящий инструмент", 3],
  ["Проблеск гениальности", 7],
  ["Крепкие чертежи", 7],
  ["Эксперт в обращении с магическими предметами", 11],
  ["Учённый по магическим предметам", 14],
  ["Сердце создателя", 17],
  ["Мастер в общении с магическими предметами", 18],
  ["Душа изобретателя", 20],
  ["Потенциал творца", 20]
]);
```

Проверить точные заголовки и уровни Механика:

```js
assert.deepEqual(mechanic.features.map(({ name, level }) => [name, level]), [
  ["Умение обращаться с транспортом", 2],
  ["Дополнительная атака", 5],
  ["Продвинутое улучшение", 5],
  ["Индивидуальная компоновка", 9],
  ["Единая система", 13]
]);
```

Проверить точные заголовки и уровни Конструктора:

```js
assert.deepEqual(constructor.features.map(({ name, level }) => [name, level]), [
  ["Сборка своего конструкта", 3],
  ["Боевой режим", 3],
  ["Дополнительная атака", 6],
  ["Безграничный проблеск", 10],
  ["Абсолютная машина", 15]
]);
```

- [ ] **Step 3: Убедиться, что тесты падают без файла данных**

Run: `node --test --test-name-pattern="craftsman" tests/classes-compendium.test.mjs`

Expected: `data/craftsman-v01.json` отсутствует или класс не входит в `CLASS_DATA_PATHS`.

- [ ] **Step 4: Перенести базовый класс дословно и оформить Markdown**

Создать `data/craftsman-v01.json` в UTF-8. Указать:

```json
{
  "sourceLabel": "D&D Ремесленник V0.1",
  "sourceRevision": "AIroW34SYHbxIEd8hfh8j8hzbnG0i0cRyrMv3r2tLosHyzGf2l4OIqoMC8xBU220H_tJnksnZGuBtol42YomSQ",
  "class": {
    "identifier": "craftsman-v01",
    "name": "Ремесленник V0.1",
    "archetypeTracks": "research-specialty",
    "hitDie": "d8",
    "primaryAbility": ["int"],
    "saveProficiencies": ["con", "int"],
    "armorProficiencies": ["lgt", "med", "hvy", "shl"],
    "skillChoiceCount": 2,
    "skillPool": ["prc", "his", "slt", "arc", "med", "nat", "inv"],
    "wealth": "5d4*10",
    "spellcasting": { "progression": "none", "ability": "int" }
  }
}
```

Полные `descriptionMarkdown` класса и каждого умения переносить непосредственно из зафиксированной ревизии. Сохранить авторские формы «Спассброски», «Учённый», упоминания уровней воина, повторы, скобки и английские названия без исправлений. Использовать заголовки, курсив уровневых строк, полужирные авторские метки, списки, вложенные списки, таблицы и цитаты, но не добавлять поясняющий текст.

- [ ] **Step 5: Закодировать владения, шкалы и стандартные Advancement**

Добавить выбор одного простого оружия, фиксированное владение инструментами жестянщика и выбор двух ремесленных инструментов. Сохранить уровни младшей черты `3/6/9/12/15/18` и ASI `4/8/12/16/19` через уже существующие builders. Выборы Исследования и Специальности заменяют текстовые заглушки «Направление исследований» и «Специальность ремесленника».

- [ ] **Step 6: Закодировать стартовое снаряжение штатной моделью dnd5e**

В управляемом gear data отсутствуют Items с точными названиями «Инструменты вора» и «Инструменты ремонтника». Добавить в `data/gear.json` два обычных Item типа «Инструменты» с ids `instrumenty-vora` и `instrumenty-remontnika`, пустым описанием и нулевыми ценой/весом: ревизия класса не задаёт им дополнительных характеристик, поэтому их нельзя выдумывать. В `scripts/data/item-classification.js` классифицировать название «Инструменты вора» как dnd5e tool subtype `thief`; «Инструменты ремонтника» остаются subtype `art`. В `tests/gear-compendium.test.mjs` проверить типы и стабильные document ids:

```js
assert.equal(createStableGearDocumentId("instrumenty-vora"), "re8ae4d6d637951f");
assert.equal(createStableGearDocumentId("instrumenty-remontnika"), "r154c7529b59a643");
assert.equal(createDnd5eItemData(thievesTools).system.type.value, "thief");
assert.equal(createDnd5eItemData(repairTools).system.type.value, "art");
```

В `class.startingEquipment` создать стабильные `_id` и группы для:

- двух простых оружий на выбор (`type: "weapon"`, `key: "sim"`, `count: 2`);
- лёгкого арбалета и 20 болтов;
- выбора между проклёпанным кожаным и чешуйчатым доспехом;
- выбора между инструментами вора и инструментами ремонтника;
- набора исследователя подземелий.

Использовать следующие стабильные UUID управляемого Rebreya-компендия и не подменять предметы похожими:

```text
Compendium.world.rebreya-gear.Item.rce9214b101b9929  Арбалет, легкий
Compendium.world.rebreya-gear.Item.r4ae22a7b477a684  Арбалетные болты (20)
Compendium.world.rebreya-gear.Item.rffd47916c3ad6a9  Проклёпанный кожаный доспех
Compendium.world.rebreya-gear.Item.r54844a44f4a83e1  Чешуйчатый доспех
Compendium.world.rebreya-gear.Item.re8ae4d6d637951f  Инструменты вора
Compendium.world.rebreya-gear.Item.r154c7529b59a643  Инструменты ремонтника
Compendium.world.rebreya-gear.Item.r3b246edf3f10322  Набор исследователя подземелий
```

- [ ] **Step 7: Перенести Механика дословно**

Создать research с `archetypeId: "craftsman-research-mechanic"`. В описание research включить полный вводный блок Механика. В пять feature Items перенести без потерь весь текст от заголовка «Умение обращаться с транспортом» до конца «Единая система», включая оба гаджета, все варианты индивидуальной компоновки и все ограничения.

- [ ] **Step 8: Перенести Конструктора дословно**

Создать specialty с `archetypeId: "craftsman-specialty-constructor"`. В описание specialty включить полный вводный блок Конструктора. В пять feature Items перенести без потерь весь текст от «Сборка своего конструкта» до конца «Абсолютная машина», включая таблицу характеристик Конструкта, варианты корпуса, действия, все боевые режимы, владения, природу и пересборку.

- [ ] **Step 9: Добавить проверки дословности после рендера**

Для каждого `descriptionMarkdown` класса, 13 базовых feature Items, research, 5 feature Items Механика, specialty и 5 feature Items Конструктора:

```js
const html = renderDescriptionMarkdown(entry.descriptionMarkdown);
assert.equal(canonicalizeDescriptionMarkdown(entry.descriptionMarkdown), canonicalizeDescriptionHtml(html));
assert.doesNotMatch(entry.descriptionMarkdown, /\b(?:TODO|TBD)\b/u);
assert.doesNotMatch(entry.descriptionMarkdown, /сокращён|краткое описание|см\. документ/iu);
```

Отдельно сравнить каждый Markdown-блок с соответствующим диапазоном абзацев зафиксированной ревизии, удаляя только добавленные Markdown-маркеры и технические переводы строк. Любое расхождение исправлять в данных, а не ослаблением канонизатора.

- [ ] **Step 10: Подключить data path, запустить тесты и зафиксировать блок**

Добавить `modules/rebreya-main/data/craftsman-v01.json` в `CLASS_DATA_PATHS`.

Run: `node --test tests/markdown-description.test.mjs tests/classes-compendium.test.mjs tests/gear-compendium.test.mjs`

Expected: все Craftsman assertions и прежние class tests проходят.

Run: `git diff --check`

Run: `git diff --word-diff -- data/craftsman-v01.json`

Commit: `feat: add verbatim craftsman class content`

---

### Task 5: Секция архетипов на стандартном листе и Tidy5e

**Files:**

- Create: `scripts/integrations/craftsman-archetype-sheet.js`
- Create: `templates/craftsman-archetypes.hbs`
- Create: `templates/craftsman-archetypes-standard.hbs`
- Create: `tests/craftsman-archetype-sheet.test.mjs`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Modify: `styles/main.css`

- [ ] **Step 1: Написать падающие тесты snapshot и стандартного context**

Проверить чистую функцию:

```js
assert.deepEqual(buildCraftsmanArchetypeSheetState(actor), {
  visible: true,
  title: "Архетипы Ремесленника",
  research: {
    label: "Исследование",
    name: "Механик",
    itemId: "research-1",
    itemUuid: "Actor.actor-1.Item.research-1",
    requiredLevel: 2,
    selected: true
  },
  specialty: {
    label: "Специальность",
    name: "Конструктор",
    itemId: "specialty-1",
    itemUuid: "Actor.actor-1.Item.specialty-1",
    requiredLevel: 3,
    selected: true
  }
});
```

Добавить случаи уровня 1/2 без выбора: `name: "Не выбрано"`, правильный `requiredLevel`, `selected: false`. Для Actor без класса `craftsman-v01` ожидать `visible: false`.

Проверить, что `ensureCraftsmanArchetypePartDefinition(CharacterActorSheet)` добавляет отдельный ApplicationV2 part сразу после `features`, не создаёт новую вкладку и не меняет определения остальных parts.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test tests/craftsman-archetype-sheet.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` для нового модуля.

- [ ] **Step 3: Реализовать единый sheet-state**

Экспортировать `buildCraftsmanArchetypeSheetState(actor)`, `ensureCraftsmanArchetypePartDefinition(CharacterActorSheet)` и `registerCraftsmanTidyContent()`.

Находить класс по `item.type === "class" && item.system.identifier === "craftsman-v01"`, архетипы — по модульному Item type и `system.classIdentifier === "craftsman-v01"`. Не использовать имя Item как идентификатор.

- [ ] **Step 4: Подключить стандартный лист через отдельный ApplicationV2 part**

`ensureCraftsmanArchetypePartDefinition` перестраивает `CharacterActorSheet.PARTS`, вставляя сразу после `features` part `craftsmanArchetypes` с container `{ classes: ["tab-body"], id: "tabs" }` и template `modules/rebreya-main/templates/craftsman-archetypes-standard.hbs`. Эта же функция добавляет в `CharacterActorSheet.DEFAULT_OPTIONS.actions` действие `openCraftsmanArchetype`, которое получает `data-item-id`, находит Item только в `this.actor.items` и вызывает `item.sheet.render(true)`. В `registerDnd5eSheetExtensions` вызвать регистрацию рядом с `ensureHeroDollTabDefinition`.

В `patchHeroDollPartContext` для `partId === "craftsmanArchetypes"` добавить `craftsmanArchetypes: buildCraftsmanArchetypeSheetState(this.actor)`. `templates/craftsman-archetypes-standard.hbs` выводит обёртку с `data-tab="features" data-group="primary"` только при `visible: true` и подключает общий partial `templates/craftsman-archetypes.hbs`. Так обе секции принадлежат штатной вкладке «Умения», а строки «Не выбрано» не маскируются под Item.

- [ ] **Step 5: Добавить общий Handlebars partial для Tidy5e**

`templates/craftsman-archetypes.hbs` рендерит две строки внутри `.pills-lg`. Для выбранной строки использовать элемент с `data-action="openCraftsmanArchetype"`, `data-item-id` и `data-uuid`; селектор `.pills-lg [data-item-id]` подключает штатный `ContextMenu5e` стандартного dnd5e-листа к inventory секции умений. Для невыбранной строки вывести текст и уровень выбора без `data-item-id`. Не добавлять собственное удаление Item. `templates/craftsman-archetypes-standard.hbs` только создаёт tab-обёртку и подключает этот partial.

- [ ] **Step 6: Зарегистрировать Tidy5e только через официальный API**

В `registerCraftsmanTidyContent()` подписаться на `Hooks.once("tidy5e-sheet.ready", (api) => registerCraftsmanTidyContentWithApi(api))` и внутри `registerCraftsmanTidyContentWithApi` вызвать:

```js
api.registerCharacterContent(new api.models.HandlebarsContent({
  path: "/modules/rebreya-main/templates/craftsman-archetypes.hbs",
  enabled: (context) => buildCraftsmanArchetypeSheetState(context.actor).visible,
  getData: (context) => buildCraftsmanArchetypeSheetState(context.actor),
  injectParams: {
    selector: "[data-tab-contents-for='features']",
    position: "afterbegin"
  },
  onRender: ({ app, element }) => bindCraftsmanArchetypeRows(element, app.actor)
}), { layout: ["classic", "quadrone"] });
```

`bindCraftsmanArchetypeRows` в пределах уже внедрённого блока перехватывает click по `data-action="openCraftsmanArchetype"`, останавливает всплытие неизвестного Tidy action и открывает embedded Item по `data-item-id`; повторный render не должен накапливать listeners. Selector `[data-tab-contents-for='features']` подтверждён установленной версией Tidy5e и закрепляется тестом. Не использовать `renderActorSheet`, `querySelector` для ручной вставки и `insertAdjacentHTML`.

- [ ] **Step 7: Добавить стили и тест официальной регистрации**

В `styles/main.css` оформить компактный блок в текущей теме модуля: заголовок, две строки, подписи осей, hover/focus для выбранного Item и приглушённый текст «Не выбрано». Стили ограничить корневым классом `.rebreya-craftsman-archetypes`.

Тест должен подтвердить один вызов `registerCharacterContent`, `HandlebarsContent`, два layout, наличие `injectParams.selector`, открытие Item из `onRender`-обработчика и отсутствие строк `insertAdjacentHTML` и ручного render-hook в новом модуле.

- [ ] **Step 8: Запустить тесты и зафиксировать блок**

Run: `node --test tests/craftsman-archetype-sheet.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/main-composition-root.test.mjs`

Expected: новая секция и существующие sheet extensions проходят.

Run: `git diff --check`

Commit: `feat: show craftsman archetypes on actor sheets`

---

### Task 6: Уровневый жизненный цикл, ошибки целостности и регрессия

**Files:**

- Modify: `tests/craftsman-archetype-types.test.mjs`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `tests/craftsman-archetype-sheet.test.mjs`
- Modify: `module.json`

- [ ] **Step 1: Добавить интеграционный тест повышения и понижения уровня**

На stub Advancement Manager смоделировать уровни `1 → 2 → 3 → 5 → 6 → 9 → 10 → 13 → 15`, затем обратный путь. Проверить:

- уровень 2 создаёт только research «Механик» и выдаёт его level-2 feature;
- уровень 3 сохраняет research, создаёт specialty «Конструктор» и выдаёт оба level-3 feature;
- уровни 5/9/13 меняют только набор умений Механика;
- уровни 6/10/15 меняют только набор умений Конструктора;
- откат ниже порога отзывает только соответствующие feature Items;
- `flags.dnd5e.advancementRoot` обоих архетипов указывает на Item класса;
- `flags.dnd5e.advancementOrigin` каждого выданного умения указывает на Advancement своего архетипа.

- [ ] **Step 2: Добавить тест замены выбора и дубликатов**

В тестовых данных добавить второй research и второй specialty. Замена research должна удалить старый research и его выдачи, сохранить specialty и его выдачи. Попытка прямого добавления второго research для `craftsman-v01` должна вернуть `false` и показать локализованное уведомление; research другого classIdentifier разрешён.

- [ ] **Step 3: Добавить тесты отказа синхронизации**

Проверить, что сборка класса бросает ошибки:

```text
Missing craftsman archetype UUID: craftsman-research-mechanic
Missing craftsman archetype UUID: craftsman-specialty-constructor
```

И что синхронизация не создаёт/не обновляет Item класса после такой ошибки. Отсутствие dnd5e пропускает регистрацию типов; отсутствие Tidy5e не влияет на компендии и стандартный лист.

- [ ] **Step 4: Обновить версию manifest**

После прохождения всех тестов увеличить `module.json.version` с `1.4.104` до `1.4.105`. Не менять compatibility без отдельной причины.

- [ ] **Step 5: Запустить полный доступный набор проверок**

Run:

```powershell
node --test tests/markdown-description.test.mjs tests/craftsman-archetype-types.test.mjs tests/classes-compendium.test.mjs tests/craftsman-archetype-sheet.test.mjs tests/gear-compendium.test.mjs tests/module-manifest.test.mjs tests/managed-compendium-sync.test.mjs tests/main-composition-root.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```

Expected: exit code `0`, все перечисленные тесты проходят.

Run: `node --test tests/*.test.mjs`

Expected: exit code `0`. Если PowerShell не раскрывает glob для Node, выполнить `Get-ChildItem tests -Filter *.test.mjs | ForEach-Object { node --test $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`.

- [ ] **Step 6: Выполнить ручную проверку в Foundry**

В тестовом мире dnd5e под GM:

1. Запустить синхронизацию класса.
2. Убедиться, что появились `world.rebreya-classes`, `world.rebreya-class-features`, `world.rebreya-craftsman-archetypes`.
3. Перетащить «Ремесленник V0.1» на нового персонажа.
4. Проверить выбор Механика на 2-м уровне и Конструктора на 3-м.
5. Проверить выдачи на 2/3/5/6/9/10/13/15 и отзывы при понижении.
6. Открыть каждый Item и визуально сверить Markdown, списки, таблицы и полный текст с зафиксированной ревизией Google Doc.
7. Проверить секцию на стандартном листе dnd5e.
8. Включить Tidy5e и проверить ту же секцию в layout `classic` и `quadrone`.
9. Отключить Tidy5e и убедиться, что стандартный лист и Advancement продолжают работать.

- [ ] **Step 7: Финальный diff, commit и push**

Run: `git status --short --branch`

Run: `git diff --check`

Run: `git diff --stat origin/main...HEAD`

Run: `git diff origin/main...HEAD -- module.json scripts data templates styles tests docs`

Commit: `test: verify craftsman dual archetype lifecycle`

Run: `git push origin lich_branch`

Expected: обычный push завершается успешно, ветка `origin/lich_branch` указывает на финальный commit, рабочее дерево чистое.

---

## Definition of Done

- Item «Ремесленник V0.1» переносится на Actor и повышается по уровням.
- На 2-м уровне независимо выбирается Item research «Механик», на 3-м — Item specialty «Конструктор».
- Оба архетипа имеют собственные вложенные Advancement и корректно выдают/отзывают умения по уровню класса.
- На классе нет `Subclass` Advancement, а другие классы модуля сохраняют штатное поведение подклассов.
- Все описания перенесены целиком из зафиксированной ревизии, максимально размечены Markdown и проходят каноническую проверку без потери видимого текста.
- Стандартный dnd5e и Tidy5e показывают обе оси отдельной секцией и открывают настоящие embedded Items.
- Не заявлена автоматизация подсистем, исключённых из первого этапа.
- Полный тестовый набор проходит, diff проверен, commits осмысленны, `lich_branch` запушена без force push.
