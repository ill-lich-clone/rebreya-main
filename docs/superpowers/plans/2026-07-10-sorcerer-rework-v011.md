# Sorcerer Rework V0.11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Sorcerer Rework V0.11 as a native dnd5e class compendium entry with linked feature text, rendered tables, full-caster configuration, spell choices, and starting-equipment packages.

**Architecture:** The class remains data-driven through `data/sorcerer-rework-v011.json`; the existing generic compendium service creates the class, subclass, feature, advancement, and package items. Extend the generic service only where a data-driven class needs two spell-choice advancements and Markdown tables. Register the equipment packages in the existing shared package registry so the established expansion service creates gear and currency.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, ES modules, Node.js built-in test runner.

## Global Constraints

- Work only on branch `lich_branch`; never commit or push to `main` or `master`.
- Run `git status`, `git branch --show-current`, and `git fetch origin` before edits.
- Preserve the original source in `ДнД реворк чародея V0.11.md`.
- Use `sorcerer-rework-v011` as the class identifier and `class:sorcerer` as the spell-list restriction.
- The first pass must not implement expenditure of sorcery points, cooldowns, exhaustion, or metamagic effects.
- Configure the class as `full` spellcasting with Charisma and native dnd5e ItemChoice advancements for cantrips and known spells.
- Use only the ten completed origins; do not create a selectable `Отмеченный феями` subclass.

---

### Task 1: Support table descriptions and multiple spell selections

**Files:**
- Modify: `scripts/data/classes-compendium.js:250-265,744-782,3100-3119,3693-3695`
- Modify: `tests/classes-compendium.test.mjs`

**Interfaces:**
- Consumes: class data with `spellChoices: Array<SpellChoice>`; retains compatibility with legacy `spellChoice`.
- Produces: `createClassSystem` and `createFeatureEntryData` descriptions containing escaped HTML tables; `buildClassAdvancement` containing one ItemChoice per `spellChoices` entry.

- [ ] **Step 1: Write failing table-rendering test**

```js
test("class descriptions render escaped Markdown tables", () => {
  const system = createClassSystem({
    name: "Тест",
    identifier: "table-test",
    hitDie: "d6",
    description: "| A | B |\\n| :--- | ---: |\\n| <x> | 2 |"
  });
  assert.match(system.description.value, /<table>/u);
  assert.match(system.description.value, /<th>A<\\/th>/u);
  assert.match(system.description.value, /&lt;x&gt;/u);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because tables are paragraphs**

Run: `node --test --test-name-pattern="render escaped Markdown tables" tests/classes-compendium.test.mjs`

Expected: failure because `system.description.value` has no `<table>`.

- [ ] **Step 3: Implement safe table conversion**

Add `parseMarkdownTableRow`, `isMarkdownTableDivider`, and `formatDescriptionBlocks`. A valid table begins with a pipe-delimited header followed by a divider row containing only alignment markers, then one or more pipe-delimited rows. Escape every cell with `escapeHtml`; render the header in `<thead>` and rows in `<tbody>`. `toHtmlParagraphs` must call this block formatter and continue to pass ordinary blocks through `formatParagraphLines`.

- [ ] **Step 4: Run the focused table test and the complete compendium test file**

Run: `node --test tests/classes-compendium.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Write failing tests for two spell-choice advancements**

```js
test("class data exposes independent cantrip and spell selections", () => {
  const normalized = normalizeClassCompendiumData({
    class: {
      name: "Тестовый кастер", identifier: "test-caster", hitDie: "d6",
      spellChoices: [
        { title: "Заговоры", level: 1, choices: { 1: { count: 2 } }, restriction: { level: "0", list: ["class:sorcerer"] }, spell: { ability: ["cha"], uses: { requireSlot: false } } },
        { title: "Заклинания", level: 1, choices: { 1: { count: 2 } }, restriction: { level: "available", list: ["class:sorcerer"] }, spell: { ability: ["cha"] } }
      ]
    }
  });
  const choices = buildClassAdvancement(normalized.classData, {})
    .filter(entry => entry.type === "ItemChoice" && entry.configuration.type === "spell");
  assert.equal(choices.length, 2);
  assert.equal(choices[0].configuration.restriction.level, "0");
  assert.deepEqual(choices[1].configuration.restriction.list, ["class:sorcerer"]);
});
```

- [ ] **Step 6: Run the focused spell-choice test and confirm it fails because only `spellChoice` is supported**

Run: `node --test --test-name-pattern="independent cantrip and spell selections" tests/classes-compendium.test.mjs`

Expected: failure with zero ItemChoice entries.

- [ ] **Step 7: Implement `spellChoices` with legacy compatibility**

Normalize `rawClass.spellChoices` when it is an array. When it is absent, wrap the normalized legacy `rawClass.spellChoice` object in a one-element array. Store `spellChoices` in `classData`; replace `buildSpellChoiceAdvancement` with `buildSpellChoiceAdvancements` returning one ItemChoice per normalized entry and use spread syntax in `buildClassAdvancement`.

- [ ] **Step 8: Run the compendium test file and commit the completed task**

Run: `node --test tests/classes-compendium.test.mjs`

Commit: `git add scripts/data/classes-compendium.js tests/classes-compendium.test.mjs && git commit -m "feat: support sorcerer spell choice advancements"`

### Task 2: Register Sorcerer starting-equipment packages

**Files:**
- Create: `scripts/data/sorcerer-starting-equipment.js`
- Modify: `scripts/data/class-starting-equipment.js`
- Modify: `tests/classes-compendium.test.mjs`

**Interfaces:**
- Consumes: shared registry exports `CLASS_STARTING_EQUIPMENT_CONFIGS` and the gear identifiers `kop-e`, `kinzhal`, `kristall-fokusirovka`, and `nabor-issledovatelya-podzemeliy`.
- Produces: source type `sorcererStartingEquipmentPackage`, packages `a` and `b`, and a registry entry for `sorcerer-rework-v011`.

- [ ] **Step 1: Write a failing package-definition test**

```js
test("sorcerer packages expose both updated starting-equipment choices", () => {
  const config = getClassStartingEquipmentConfig("sorcerer-rework-v011");
  assert.ok(config);
  assert.deepEqual(config.getPackage("a").items.map(item => [item.gearId, item.quantity ?? 1]), [
    ["kop-e", 1], ["kinzhal", 2], ["kristall-fokusirovka", 1], ["nabor-issledovatelya-podzemeliy", 1]
  ]);
  assert.deepEqual(config.getPackage("a").currency, { gp: 28 });
  assert.deepEqual(config.getPackage("b").currency, { gp: 50 });
});
```

- [ ] **Step 2: Run the package test and confirm it fails because the registry has no sorcerer entry**

Run: `node --test --test-name-pattern="sorcerer packages expose" tests/classes-compendium.test.mjs`

Expected: failure because `config` is null.

- [ ] **Step 3: Implement frozen package data and registry wiring**

Create `sorcerer-starting-equipment.js` matching the export shape of the existing four package modules. Package `a` has the four exact items above and `{ gp: 28 }`; package `b` has no items and `{ gp: 50 }`. Import its constants and selectors in `class-starting-equipment.js` and append the matching configuration object with hint `Выберите А или Б:`.

- [ ] **Step 4: Run the focused test and all class-compendium tests**

Run: `node --test tests/classes-compendium.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit the completed task**

Commit: `git add scripts/data/sorcerer-starting-equipment.js scripts/data/class-starting-equipment.js tests/classes-compendium.test.mjs && git commit -m "feat: add sorcerer starting equipment"`

### Task 3: Add complete V0.11 Sorcerer class data

**Files:**
- Create: `data/sorcerer-rework-v011.json`
- Modify: `scripts/data/classes-compendium.js:31-36`
- Modify: `tests/classes-compendium.test.mjs`
- Add to commit: `ДнД реворк чародея V0.11.md`

**Interfaces:**
- Consumes: the locally exported source Markdown and generic class schema.
- Produces: one class, ten subclasses, class feature grants, four scales, two spell choice advancements, and two package feature definitions.

- [ ] **Step 1: Write failing Sorcerer data tests**

```js
test("sorcerer V0.11 is a full Charisma caster with source-table progressions", () => {
  const sorcerer = normalizeClassCompendiumData(loadJson("data/sorcerer-rework-v011.json"));
  const system = createClassSystem(sorcerer.classData, [], sorcerer.sourceLabel);
  assert.equal(sorcerer.classData.identifier, "sorcerer-rework-v011");
  assert.equal(system.spellcasting.progression, "full");
  assert.equal(system.spellcasting.ability, "cha");
  assert.equal(sorcerer.classData.spellChoices.length, 2);
  assert.equal(sorcerer.classData.scaleAdvancements.find(scale => scale.identifier === "sorcery-points").progression[20], 153);
  assert.equal(sorcerer.subclasses.length, 10);
  assert.equal(sorcerer.subclasses.some(entry => entry.name === "Отмеченный феями"), false);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the data source is not registered**

Run: `node --test --test-name-pattern="sorcerer V0.11" tests/classes-compendium.test.mjs`

Expected: failure opening `data/sorcerer-rework-v011.json`.

- [ ] **Step 3: Create the full data source from the exported Markdown**

Transcribe all prose and table values from `ДнД реворк чародея V0.11.md` into JSON strings. Set class features at levels 1, 2, 3, 4, 5, 10, 17, and 20. Preserve the source’s class table and spell-cost table in the class description. Create subclass records for: Наследие драконьей крови, Дикая магия, Божественная душа, Теневая магия, Штормовое колдовство, Аберрантный разум, Заводная душа, Лунное чародейство, Дитя песков, Химтековое сердце. Assign their feature levels exactly as stated in the source. Do not add `Отмеченный феями`.

Use `spellcasting: { "progression": "full", "ability": "cha" }`. Use two `spellChoices`: cantrips at levels 1, 4, and 10 with restriction level `"0"` and `requireSlot: false`; known spells with restriction level `"available"`, choices equal to the gains in the V0.11 table, and `replacement: true` at every class level. Both restrictions use `["class:sorcerer"]` and both spell configurations use Charisma.

Create scale identifiers `sorcery-points`, `cantrips-known`, `spells-known`, and `maximum-spell-level`, using the exact progression values in the V0.11 table. Set `classFeatureRootFolder` to `Чародей (Реворк V0.11)` and add `modules/${MODULE_ID}/data/sorcerer-rework-v011.json` to `CLASS_DATA_PATHS`.

- [ ] **Step 4: Write and run relationship/advancement assertions**

Add assertions that the 1st-level grant includes `Происхождение чародея` and `Чародейское заклинательство`, the subclass advancement is at level 1, the first-level package choice includes both package UUIDs, the class description has `<table>`, and a feature description naming another unique Sorcerer feature contains `@UUID[`.

Run: `node --test tests/classes-compendium.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit the completed task**

Commit: `git add data/sorcerer-rework-v011.json scripts/data/classes-compendium.js tests/classes-compendium.test.mjs 'ДнД реворк чародея V0.11.md' && git commit -m "feat: add sorcerer rework compendium"`

### Task 4: Validate the integrated class

**Files:**
- Verify: `data/sorcerer-rework-v011.json`
- Verify: `scripts/data/classes-compendium.js`
- Verify: `scripts/data/sorcerer-starting-equipment.js`
- Verify: `tests/classes-compendium.test.mjs`

**Interfaces:**
- Consumes: all outputs of Tasks 1–3.
- Produces: verified class integration ready to synchronize in Foundry.

- [ ] **Step 1: Validate JSON and whitespace**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('data/sorcerer-rework-v011.json','utf8')); console.log('valid JSON')"` and `git diff --check origin/main...HEAD`.

Expected: `valid JSON` and no whitespace errors.

- [ ] **Step 2: Run all available focused regression suites**

Run: `node --test tests/classes-compendium.test.mjs tests/fighter-automation-service.test.mjs tests/paladin-automation-service.test.mjs tests/rogue-automation-service.test.mjs`.

Expected: zero failures.

- [ ] **Step 3: Inspect the final change set**

Run: `git diff --check origin/main...HEAD`, `git status --short --branch`, and `git diff --stat origin/main...HEAD`.

Expected: only the Sorcerer integration, its source document, tests, and documented design/plan commits differ from `origin/main`.

- [ ] **Step 4: Commit any verification-only corrections and push the branch**

Run: `git push origin lich_branch`.

Expected: branch is published without force push.
