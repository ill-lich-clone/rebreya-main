# Glossary Items and Feat Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать Item-компендиум терминов и превратить упоминания других черт и терминов в описаниях черт в устойчивые Foundry `@UUID`-ссылки.

**Architecture:** Импорт сохраняет lossless-снимок `Глоссарий 0.1` и производный каталог табличных терминов. `GlossaryCompendiumService` объединяет его с единым shared-владельцем состояний и точечными разделами `Глоссарий.txt`, синхронизируя Item-документы со стабильными ID. Чистый HTML-linkifier получает индекс фактических UUID из actions/glossary/feats и меняет только текстовые узлы перед sync черт.

**Tech Stack:** Node.js ESM, Foundry VTT 13 CompendiumCollection/Item, dnd5e feat items, existing managed-compendium sync, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-20-lootgen-narratives-and-feat-links-design.md`

## Global Constraints

- Этот план выполняется после Task 1 плана `2026-09-20-lootgen-narrative-variants.md`, который создаёт общий `tools/import-reference-data.mjs` и sheet definitions.
- Работать только в `lich_branch`; до изменений выполнить обязательный Git-процесс из `AGENTS.md`.
- Источник: тот же spreadsheet, лист `Глоссарий 0.1`, диапазон `A1:B1000`, плюс `Глоссарий.txt` для отсутствующих состояний.
- Термины являются Item типа `feat` без механической автоматизации; actions и feats не дублировать.
- В описания вставляются только `@UUID[...]`-ссылки; tooltip/UI не добавлять.
- Linkifier не меняет HTML tags/attributes, `<a>`, существующие UUID tokens и self-reference.
- Не запускать Foundry, browser bridge или живые клиентские тесты.
- После narrative-плана повысить версию с `1.4.314` до `1.4.315`, создать `scripts/main-1.4.315.js` и обновить version query у изменённых импортов.
- Новые и изменённые методы занести в `docs/function-passport.md`.

## Review Focus

- Одинаковое отображаемое имя в двух каталогах должно считаться неоднозначным и оставаться текстом; тест принадлежит Task 4.
- Склонённые формы вроде `сбитого с ног` должны ссылаться на канонический Item, сохраняя исходный текст; тест принадлежит Task 4.
- Название черты внутри HTML-атрибута или существующего `<a>` не должно меняться; тест принадлежит Task 4.
- Переиспользуемый существующий feat document ID должен победить заранее вычисленный ID; тест принадлежит Task 5.
- Повторная синхронизация не должна вкладывать UUID-ссылки друг в друга и не должна создавать второй glossary Item; тест принадлежит Task 5.

---

### Task 1: Save and normalize the glossary sheet

**Files:**
- Modify: `tools/reference-import/sheet-definitions.mjs`
- Create: `tools/reference-import/glossary-pipeline.mjs`
- Modify: `tools/import-reference-data.mjs`
- Create: `data/source/glossary-0.1.snapshot.json`
- Create: `data/glossary-terms.json`
- Modify: `tests/reference-data-import.test.mjs`

**Interfaces:**
- Consumes: common importer from the narrative plan.
- Produces: `GLOSSARY_SHEET_DEFINITION`; `buildGlossaryArtifacts({ spreadsheetId, importedAt, values }) -> { snapshot, catalog }`; CLI target `glossary`.

- [ ] **Step 1: Write failing glossary import tests**

```js
test("glossary import preserves every nonempty row and emits described terms", () => {
  const values = [
    ["ГЛОССАРИЙ СВОЙСТВ ОРУЖИЯ И АТАК"],
    ["Источник: тест"],
    [],
    ["Термин", "Описание"],
    ["СВОЙСТВА ОРУЖИЯ"],
    ["Тяжёлое [Lich]", "Свойство оружия."]
  ];
  const result = buildGlossaryArtifacts({ spreadsheetId: "sheet-id", importedAt: "2026-09-20T00:00:00.000Z", values });
  assert.equal(result.snapshot.rowCount, 2);
  assert.deepEqual(result.snapshot.preambleRows.map(row => row.values), [values[0], values[1]]);
  assert.deepEqual(result.snapshot.rows[1].values, ["Тяжёлое [Lich]", "Свойство оружия."]);
  assert.deepEqual(result.catalog.terms.map(term => term.name), ["Тяжёлое"]);
  assert.equal(result.catalog.terms[0].sourceLabel, "Lich");
});
```

Add cases for duplicate normalized term names with conflicting descriptions, blank name with a description, CRLF normalization, and deterministic `termId` independent of source row order.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/reference-data-import.test.mjs`

Expected: FAIL with missing glossary pipeline exports.

- [ ] **Step 3: Implement the glossary pipeline and CLI branch**

```js
export const GLOSSARY_SHEET_DEFINITION = Object.freeze({
  sheetTitle: "Глоссарий 0.1",
  range: "A1:B1000",
  headerRow: 4,
  dataStartRow: 5
});
```

Preserve nonempty rows 1–3 as `preambleRows`; read the exact `Термин`/`Описание` headers from row 4; and store nonempty rows from row 5 as snapshot `rows`. `rowCount` counts those data/section rows, not the header or preamble. Normalize described rows into `{ termId, name, description, section, sourceLabel, aliases: [] }`: strip only a terminal source marker like ` [Lich]` or ` [PHB+]` from the Item name and keep its contents in `sourceLabel`. A non-described row updates the current `section`; it remains present in the lossless snapshot but is not emitted as an Item term. Generate `termId` from normalized section/name, not the row number.

- [ ] **Step 4: Generate and assert checked-in artifacts**

Run:

```powershell
node tools/import-reference-data.mjs --apply --target glossary
node --test tests/reference-data-import.test.mjs
```

Expected: PASS; snapshot headers/rows match the fetched sheet, and every runtime term has nonempty `termId`, `name`, and `description`.

- [ ] **Step 5: Commit**

```powershell
git add tools/reference-import/sheet-definitions.mjs tools/reference-import/glossary-pipeline.mjs tools/import-reference-data.mjs tests/reference-data-import.test.mjs data/source/glossary-0.1.snapshot.json data/glossary-terms.json
git commit -m "feat: import glossary term catalog"
```

### Task 2: Establish one shared owner for status reference content

**Files:**
- Create: `scripts/data/status-reference-data.js`
- Modify: `scripts/integrations/dnd5e-sheet-status-references.js:1-330`
- Create: `tests/status-reference-data.test.mjs`
- Modify: `tests/dnd5e-sheet-downtime-tab.test.mjs:2200-2281`

**Interfaces:**
- Produces: `STATUS_REFERENCE_DATA`, `getStatusReferenceDefinition(statusId)`, `renderStatusReferenceDescription(definition)`.
- Consumes: existing Russian labels/icons supplied by dnd5e sheet integration.

- [ ] **Step 1: Write a failing shared-owner parity test**

```js
test("shared status definitions include prone and keep sheet presentation text", () => {
  const prone = getStatusReferenceDefinition("prone");
  assert.equal(prone.canonicalName, "Сбитый с ног");
  assert.ok(prone.aliases.includes("Лежащий ничком"));
  assert.match(renderStatusReferenceDescription(prone), /может только ползти/u);
});
```

Add `bloodied` with canonical name `Окровавленный`, source metadata pointing to `Глоссарий.txt`, and aliases used by feat text. Preserve every existing status ID and presentation assertion.

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
node --test tests/status-reference-data.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```

Expected: FAIL because the shared data module does not exist.

- [ ] **Step 3: Extract the immutable data and adapt the sheet renderer**

```js
export const STATUS_REFERENCE_DATA = Object.freeze({
  prone: Object.freeze({
    statusId: "prone",
    canonicalName: "Сбитый с ног",
    aliases: Object.freeze(["Лежащий ничком", "сбитого с ног", "сбитым с ног"]),
    subtitle: "Базовое состояние",
    bullets: Object.freeze([
      "Сбитое с ног существо способно перемещаться только ползая, пока не встанет, прервав тем самым это состояние.",
      "Существо совершает с помехой броски атаки.",
      "Броски атаки по существу совершаются с преимуществом, если нападающий находится в пределах 5 футов от него. В противном случае дальнобойные атаки совершаются с помехой.",
      "Когда существо поднимается из положения ничком, то оно провоцирует атаки."
    ])
  }),
  bloodied: Object.freeze({
    statusId: "bloodied",
    canonicalName: "Окровавленный",
    aliases: Object.freeze(["окровавленного", "окровавленным"]),
    subtitle: "Состояние Rebreya",
    paragraphs: Object.freeze([
      "Любое существо становится окровавленным, если у него меньше половины хитов. Само по себе это состояние не несёт каких либо эффектов, но на него могут ссылаться другие умения и особенности.",
      "Рекомендуется записывать свои хиты в формате «Максимальные хиты / Половина от максимальных хитов ». Имейте в виду, что если ваши максимальные хиты меняются, то это также приводит к пересчёту половины ваших хитов"
    ])
  })
});
```

Move all existing definitions byte-for-byte into this module, except `prone`, whose canonical glossary wording above intentionally replaces the shorter existing summary; add `bloodied` from the exact `Глоссарий.txt` text. Keep `getDnd5eSheetStatusPresentation()` public contract unchanged by importing the shared definition and rendering it through the existing HTML helpers; update the focused expected text for `prone` without changing its HTML shape.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test tests/status-reference-data.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/status-reference-data.js scripts/integrations/dnd5e-sheet-status-references.js tests/status-reference-data.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
git commit -m "refactor: share status reference definitions"
```

### Task 3: Synchronize the glossary Item compendium

**Files:**
- Modify: `scripts/constants.js:12-17,129-130`
- Create: `scripts/data/glossary-compendium.js`
- Create: `tests/glossary-compendium.test.mjs`

**Interfaces:**
- Consumes: `data/glossary-terms.json`, `STATUS_REFERENCE_DATA`, `syncManagedDocumentsOnActiveGm()` and `createStableGearDocumentId(seed)`.
- Produces: `GLOSSARY_COMPENDIUM_NAME`, `GLOSSARY_COMPENDIUM_LABEL`; `loadGlossaryTermCatalog()`; `normalizeGlossaryEntries({ terms, statuses, statusLabels })`; `GlossaryCompendiumService.sync()`.

- [ ] **Step 1: Write failing normalization and sync tests**

```js
test("glossary entries merge sheet terms and statuses with stable item ids", () => {
  const entries = normalizeGlossaryEntries({
    terms: [{ termId: "heavy", name: "Тяжёлое", description: "Свойство оружия.", section: "Свойства оружия", aliases: [] }],
    statuses: STATUS_REFERENCE_DATA,
    statusLabels: new Map([["prone", "Сбитый с ног"], ["bloodied", "Окровавленный"]])
  });
  const prone = entries.find(entry => entry.name === "Сбитый с ног");
  assert.equal(prone.documentId, createStableGearDocumentId("glossary:status:prone"));
  assert.ok(prone.aliases.includes("Лежащий ничком"));
});
```

Add a fake-pack sync test asserting type `feat`, folders `Состояния`/`Свойства оружия`, `flags.rebreya-main.glossaryTermId`, observer ownership, no activities/effects, and idempotent update rather than duplicate creation.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/glossary-compendium.test.mjs`

Expected: FAIL with missing module/export.

- [ ] **Step 3: Implement constants and compendium service**

```js
export const GLOSSARY_COMPENDIUM_NAME = "rebreya-glossary";
export const GLOSSARY_COMPENDIUM_LABEL = "Термины Rebreya";
```

Follow the `ActionsCompendiumService` pattern: load and validate `data/glossary-terms.json` once, ensure `world.rebreya-glossary`, prepare normalized folders, use stable `_id`, sync by `glossaryTermId`, and include aliases/source in module flags and signature. Build `statusLabels` from localized `CONFIG.statusEffects` labels with explicit `prone`/`bloodied` overrides, so every shared status definition gets a real Item name without duplicating label ownership. Reject duplicate normalized names and aliases during normalization rather than silently choosing one.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/glossary-compendium.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/constants.js scripts/data/glossary-compendium.js tests/glossary-compendium.test.mjs
git commit -m "feat: add glossary item compendium"
```

### Task 4: Build the pure HTML-safe feat reference linker

**Files:**
- Create: `scripts/data/feat-reference-linker.js`
- Create: `tests/feat-reference-linker.test.mjs`

**Interfaces:**
- Consumes: targets `{ uuid, canonicalName, aliases, kind, sourceId }`.
- Produces: `buildFeatReferenceMatcher(targets)` and `linkFeatDescriptionHtml(html, { matcher, selfUuid="" }) -> { html, linked, ambiguous }`.

- [ ] **Step 1: Write failing matcher and HTML tests**

```js
test("linker links longest visible text and preserves the original Russian form", () => {
  const matcher = buildFeatReferenceMatcher([
    { uuid: "Compendium.world.rebreya-glossary.Item.prone00000000001", canonicalName: "Сбитый с ног", aliases: ["сбитого с ног"], kind: "term", sourceId: "prone" },
    { uuid: "Compendium.world.rebreya-feats.Item.feat000000000001", canonicalName: "Меткий стрелок", aliases: [], kind: "feat", sourceId: "marksman" }
  ]);
  const result = linkFeatDescriptionHtml("<p>Цель становится сбитого с ног и получает Меткий стрелок.</p>", { matcher });
  assert.match(result.html, /@UUID\[Compendium\.world\.rebreya-glossary\.Item\.prone00000000001\]\{сбитого с ног\}/u);
  assert.match(result.html, /@UUID\[Compendium\.world\.rebreya-feats\.Item\.feat000000000001\]\{Меткий стрелок\}/u);
});

test("linker skips tags anchors uuid tokens self links and ambiguous names", () => {
  const matcher = buildFeatReferenceMatcher([
    { uuid: "Compendium.world.rebreya-feats.Item.feat000000000001", canonicalName: "Меткий стрелок", aliases: [], kind: "feat", sourceId: "marksman" },
    { uuid: "Compendium.world.rebreya-glossary.Item.term000000000001", canonicalName: "Дубль", aliases: [], kind: "term", sourceId: "duplicate-a" },
    { uuid: "Compendium.world.rebreya-glossary.Item.term000000000002", canonicalName: "Дубль", aliases: [], kind: "term", sourceId: "duplicate-b" }
  ]);
  const html = '<p title="Меткий стрелок"><a>Меткий стрелок</a> @UUID[Compendium.x.Item.y]{Меткий стрелок} Меткий стрелок</p>';
  const result = linkFeatDescriptionHtml(html, { matcher, selfUuid: "Compendium.world.rebreya-feats.Item.feat000000000001" });
  assert.equal(result.html, html);
  const ambiguous = linkFeatDescriptionHtml("<p>Дубль</p>", { matcher });
  assert.equal(ambiguous.html, "<p>Дубль</p>");
  assert.deepEqual(ambiguous.ambiguous, ["Дубль"]);
});
```

Add tests for longest-first overlap, word boundaries, case-insensitive matching with preserved display text, duplicate aliases yielding `ambiguous`, malformed but pass-through HTML, repeated invocation, and text inside table cells.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/feat-reference-linker.test.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement deterministic matching and token-aware traversal**

```js
export function buildFeatReferenceMatcher(targets) {
  const aliases = new Map();
  for (const target of targets) {
    for (const label of [target.canonicalName, ...(target.aliases ?? [])]) {
      const key = normalizeReferenceText(label);
      const bucket = aliases.get(key) ?? [];
      bucket.push({ ...target, label });
      aliases.set(key, bucket);
    }
  }
  return Object.freeze({ aliases, labels: [...aliases.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b, "ru")) });
}

function normalizeReferenceText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru").replace(/ё/gu, "е").replace(/\s+/gu, " ");
}
```

Implement a scanner that emits tags, existing UUID tokens and text segments; track `<a>` depth. Only link text segments outside anchors. Build one alternation regex from escaped labels, enforce Unicode letter/number boundaries, and leave buckets with more than one distinct UUID unchanged while recording them in `ambiguous`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/feat-reference-linker.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/feat-reference-linker.js tests/feat-reference-linker.test.mjs
git commit -m "feat: link feat descriptions to item references"
```

### Task 5: Build actual UUID targets and integrate feat synchronization

**Files:**
- Create: `scripts/data/compendium-item-reference-index.js`
- Modify: `scripts/data/feats-compendium.js:46-107,213-230,492-527,617-665`
- Modify: `tests/feats-compendium.test.mjs`
- Create: `tests/compendium-item-reference-index.test.mjs`

**Interfaces:**
- Consumes: packs `world.rebreya-actions`, `world.rebreya-glossary`, `world.rebreya-feats`; matcher from Task 4.
- Produces: `buildCompendiumItemReferenceIndex({ actions, glossary, feats, desiredFeats })`; `FeatsCompendiumService.sync()` with linked normalized descriptions and deterministic IDs for missing feat documents.

- [ ] **Step 1: Write failing actual-ID and idempotency tests**

```js
test("reference index keeps an existing feat document id and preallocates only missing ids", () => {
  const index = buildCompendiumItemReferenceIndex({
    feats: [fakeDocument({ id: "ExistingFeat0001", featId: "marksman", name: "Меткий стрелок" })],
    desiredFeats: [{ featId: "marksman", name: "Меткий стрелок" }, { featId: "new-feat", name: "Новая черта" }],
    actions: [], glossary: []
  });
  assert.equal(index.documentIdByFeatId.get("marksman"), "ExistingFeat0001");
  assert.equal(index.documentIdByFeatId.get("new-feat"), createStableGearDocumentId("feat:new-feat"));
});
```

In `feats-compendium.test.mjs`, sync twice against fake packs and assert: one UUID token per mention, no self-link, same final HTML on second sync, and a newly created feat uses the preallocated `_id` referenced by another feat.

- [ ] **Step 2: Run focused tests and verify failures**

Run:

```powershell
node --test tests/compendium-item-reference-index.test.mjs tests/feat-reference-linker.test.mjs tests/feats-compendium.test.mjs
```

Expected: FAIL because the index and sync integration do not exist.

- [ ] **Step 3: Implement actual target resolution**

Index only managed documents with nonempty stable source flags. For a desired feat ID, choose the document ID in this order: existing managed document ID, valid `desiredFeat.documentId` from the source bundle, then `createStableGearDocumentId('feat:'+featId)`. Build UUIDs exactly as `Compendium.world.<pack>.Item.<documentId>`. If a normalized alias resolves to multiple UUIDs, retain it as ambiguous rather than applying priority by pack.

- [ ] **Step 4: Link normalized descriptions before managed sync**

After `normalizeFeatItems(rawItems)` and `getPackDocuments(pack)`, build the target index and map feats:

```js
const linkedFeats = feats.map(feat => {
  const documentId = referenceIndex.documentIdByFeatId.get(feat.featId);
  const selfUuid = `Compendium.world.${FEATS_COMPENDIUM_NAME}.Item.${documentId}`;
  const next = foundry.utils.deepClone(feat);
  next.documentId = documentId;
  next.system.description.value = linkFeatDescriptionHtml(next.system.description.value, { matcher: referenceIndex.matcher, selfUuid }).html;
  next.system.description.chat = linkFeatDescriptionHtml(next.system.description.chat, { matcher: referenceIndex.matcher, selfUuid }).html;
  return next;
});
```

Use `linkedFeats` consistently for signatures, folders, create and update. Existing `@UUID` tokens remain stable, so the second sync produces no nested links.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/compendium-item-reference-index.test.mjs tests/feat-reference-linker.test.mjs tests/feats-compendium.test.mjs tests/markdown-description.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/data/compendium-item-reference-index.js scripts/data/feats-compendium.js tests/compendium-item-reference-index.test.mjs tests/feats-compendium.test.mjs
git commit -m "feat: resolve feat and glossary item links"
```

### Task 6: Compose sync order, document contracts and verify offline

**Files:**
- Modify: `scripts/main.js:1-40,1526-1550,4313-4406`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.315.js`

**Interfaces:**
- Consumes: `GlossaryCompendiumService` and linked `FeatsCompendiumService`.
- Produces: active-GM sync order `actions -> glossary -> feats`.

- [ ] **Step 1: Write a failing composition-order source test**

```js
test("managed compendia sync actions and glossary before feats", () => {
  const source = readFileSync(new URL("../scripts/main.js", import.meta.url), "utf8");
  const actions = source.indexOf("await this.actionsCompendium.sync()");
  const glossary = source.indexOf("await this.glossaryCompendium.sync()");
  const feats = source.indexOf("await this.featsCompendium.sync()");
  assert.ok(actions >= 0 && actions < glossary && glossary < feats);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/main-composition-root.test.mjs`

Expected: FAIL because glossary service/order is absent.

- [ ] **Step 3: Wire the service and reorder sync blocks**

Instantiate `this.glossaryCompendium = new GlossaryCompendiumService()` beside the existing compendium services. Move the existing actions sync block before glossary; add a guarded glossary sync block; run feats after both. Preserve existing error isolation and user notification style.

- [ ] **Step 4: Update the function passport**

Document the importer/catalog, shared status owner, glossary service, target index, linkifier, feat sync transformation and composition order with exact signatures and focused tests. Replace the old status-description ownership statement instead of duplicating it.

- [ ] **Step 5: Raise the module version and refresh import queries**

Update `module.json` to version `1.4.315` and `scripts/main-1.4.315.js`; the forwarder contains only:

```js
import "./main.js";
```

Set changed compendium/link/status imports to `?v=1.4.315`. Find every reference before editing:

```powershell
rg -n "feats-compendium|glossary-compendium|feat-reference-linker|compendium-item-reference-index|status-reference-data|dnd5e-sheet-status-references" scripts --glob '*.js'
```

- [ ] **Step 6: Run focused verification**

Run:

```powershell
node --test tests/reference-data-import.test.mjs tests/status-reference-data.test.mjs tests/glossary-compendium.test.mjs tests/feat-reference-linker.test.mjs tests/compendium-item-reference-index.test.mjs tests/feats-compendium.test.mjs tests/markdown-description.test.mjs tests/main-composition-root.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Run the required full offline verification once on final HEAD**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Record passed/failed counts and real errors. Do not start Foundry or the bridge.

- [ ] **Step 8: Commit and push**

```powershell
git add scripts/main.js tests/main-composition-root.test.mjs docs/function-passport.md
git add module.json scripts/main-1.4.315.js
git commit -m "feat: sync glossary links before feats"
git push -u origin lich_branch
```

Before commit, inspect `git diff --stat`, `git diff`, and `git diff --check`; stage only files owned by this plan.
