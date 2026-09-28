# Lootgen Narrative Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сохранять таблицу нарративных вариантов локально и доставлять один случайно выбранный, изменённый и нестакаемый Item через все маршруты Lootgen до карты, контейнера и чарника.

**Architecture:** Offline-importer сохраняет lossless-снимок листа и строит проверенный runtime-каталог по стабильным `gearId`. Lootgen сначала выбирает базовый предмет по прежним вероятностям, затем один раз выбирает его нарративный вариант через инъецированный RNG; `narrativeVariantId` и snapshot текста проходят рядом с descriptor, а Item builder применяет их до persistence. Descriptor v2, расчёт цены и механика базового предмета не меняются.

**Tech Stack:** Node.js ESM, Foundry VTT 13, dnd5e Item data, Google Sheets API client из `tools/equipment-import/`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-20-lootgen-narratives-and-feat-links-design.md`

## Global Constraints

- Работать только в `lich_branch`; до изменений выполнить обязательный Git-процесс из `AGENTS.md`.
- Источник: spreadsheet `1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk`, лист `Нарративное заполнение`, диапазон `A1:D4000`.
- Lossless-снимок содержит четыре исходных столбца и ровно 3996 строк данных; runtime не читает Google Sheets.
- Выбор варианта происходит после выбора базового предмета и не меняет вероятность выпадения `gearId`.
- Меняется только `system.description.value`; имя, цена, ранг и механика базового Item сохраняются.
- Нарративный Item всегда имеет quantity `1` и не merge-ится даже с тем же вариантом.
- Descriptor v2 не расширять полями нарратива.
- Не запускать Foundry, browser bridge или живые клиентские тесты.
- При клиентских изменениях поднять `module.json` с `1.4.313` до `1.4.314` и синхронно создать versioned forwarder.
- Новые и изменённые методы занести в `docs/function-passport.md` в том же implementation commit.

## Review Focus

- Две строки источника с одинаковым текстом, но разными предметами должны получить разные `variantId`; тест принадлежит Task 2.
- Значения RNG `0` и близкое к `1` должны выбирать первый и последний вариант без выхода за границы; тест принадлежит Task 3.
- Нарративный контейнер и нарративный предмет внутри контейнера должны сохранить разные варианты; тест принадлежит Task 4.
- Старое persisted state без narrative fields должно выдаваться как раньше; тест принадлежит Task 5.
- Retry после изменения локального каталога должен выдать сохранённый `itemData`, а не новый текст; тест принадлежит Task 5.

---

### Task 1: Lossless sheet snapshot and deterministic import command

**Files:**
- Create: `tools/reference-import/sheet-definitions.mjs`
- Create: `tools/reference-import/narrative-pipeline.mjs`
- Create: `tools/import-reference-data.mjs`
- Create: `data/source/narrative-filling.snapshot.json`
- Create: `data/lootgen-narrative-variants.json`
- Test: `tests/reference-data-import.test.mjs`

**Interfaces:**
- Consumes: `createGoogleSheetsClient()`, `loadGoogleServiceAccount()` and `buildRawSheetSnapshot()` from the existing equipment importer.
- Produces: `NARRATIVE_SHEET_DEFINITION`; `buildNarrativeArtifacts({ spreadsheetId, importedAt, values, gear }) -> { snapshot, catalog }`; CLI `node tools/import-reference-data.mjs --apply --target narratives`.

- [ ] **Step 1: Write the failing importer tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildNarrativeArtifacts } from "../tools/reference-import/narrative-pipeline.mjs";

test("narrative import preserves source cells and joins every row to one gear id", () => {
  const values = [
    ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
    ["Энциклопедия (20 томов)", "Следы копоти", "Края страниц обуглены.", "3"]
  ];
  const result = buildNarrativeArtifacts({
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values,
    gear: [{ id: "энциклопедия-20-томов", name: "Энциклопедия (20 томов)" }]
  });
  assert.deepEqual(result.snapshot.headers, values[0]);
  assert.deepEqual(result.snapshot.rows[0].values, values[1]);
  assert.equal(result.catalog.variants[0].gearId, "энциклопедия-20-томов");
  assert.equal(result.catalog.variants[0].rank, 3);
});

test("narrative import rejects unknown and ambiguous gear names", () => {
  const values = [
    ["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"],
    ["Книга", "Пометки", "На полях есть записи.", "1"]
  ];
  assert.throws(() => buildNarrativeArtifacts({
    spreadsheetId: "sheet-id",
    importedAt: "2026-09-20T00:00:00.000Z",
    values,
    gear: [{ id: "book-a", name: "Книга" }, { id: "book-b", name: "Книга" }]
  }), /ambiguous gear name/u);
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `node --test tests/reference-data-import.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `narrative-pipeline.mjs`.

- [ ] **Step 3: Implement declarations, validation and lossless serialization**

```js
// tools/reference-import/sheet-definitions.mjs
export const REFERENCE_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
export const NARRATIVE_SHEET_DEFINITION = Object.freeze({
  sheetTitle: "Нарративное заполнение",
  range: "A1:D4000",
  headers: Object.freeze(["Оригинальный предмет", "Название", "Нарративное описание", "Ранг"])
});
```

```js
// tools/reference-import/narrative-pipeline.mjs
import { createHash } from "node:crypto";

const clean = value => String(value ?? "").trim();
const stableVariantId = fields => createHash("sha256")
  .update(fields.join("\u0000"), "utf8").digest("hex").slice(0, 24);

export function buildNarrativeArtifacts({ spreadsheetId, importedAt, values, gear }) {
  const [headers = [], ...sourceRows] = values;
  const gearByName = new Map();
  for (const item of gear) {
    const key = clean(item.name).toLocaleLowerCase("ru");
    const bucket = gearByName.get(key) ?? [];
    bucket.push(item);
    gearByName.set(key, bucket);
  }
  const rows = sourceRows.filter(row => row.some(cell => clean(cell))).map((row, index) => ({
    rowNumber: index + 2,
    values: headers.map((_header, column) => String(row[column] ?? ""))
  }));
  const variants = rows.map(({ rowNumber, values: row }) => {
    const [sourceName, title, description, rawRank] = row.map(clean);
    const matches = gearByName.get(sourceName.toLocaleLowerCase("ru")) ?? [];
    if (matches.length !== 1) throw new Error(`${matches.length ? "ambiguous" : "unknown"} gear name at row ${rowNumber}: ${sourceName}`);
    const rank = Number(rawRank);
    if (!title || !description || !Number.isSafeInteger(rank) || rank < 0) throw new Error(`invalid narrative row ${rowNumber}`);
    return { variantId: stableVariantId([matches[0].id, title, description, String(rank)]), gearId: matches[0].id, sourceName, title, description, rank };
  });
  if (new Set(variants.map(row => row.variantId)).size !== variants.length) throw new Error("duplicate narrative variantId");
  return {
    snapshot: { schemaVersion: 1, spreadsheetId, sheetTitle: "Нарративное заполнение", range: "A1:D4000", importedAt, headers, rowCount: rows.length, rows },
    catalog: { schemaVersion: 1, source: { spreadsheetId, sheetTitle: "Нарративное заполнение" }, variants }
  };
}
```

Implement the CLI with the same argument discipline as `tools/import-equipment.mjs`: default dry-run, `--apply`, the only initial target `--target narratives`, `--credentials`, and `--snapshot`. It must fetch only the declared narrative range, reject credentials in snapshots, print row counts and hashes, and write through temporary files plus atomic rename when `--apply` is present. The glossary plan later extends the target enum without changing narrative behavior.

- [ ] **Step 4: Run importer tests and create the checked-in artifacts**

Run:

```powershell
node --test tests/reference-data-import.test.mjs
node tools/import-reference-data.mjs --apply --target narratives
```

Expected: PASS; `data/source/narrative-filling.snapshot.json` has `rowCount: 3996`, and `data/lootgen-narrative-variants.json` has 3996 variants covering 160 `gearId` values.

- [ ] **Step 5: Add artifact assertions and rerun**

```js
test("checked-in narrative artifacts match the approved sheet shape", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/source/narrative-filling.snapshot.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(readFileSync(new URL("../data/lootgen-narrative-variants.json", import.meta.url), "utf8"));
  assert.equal(snapshot.rowCount, 3996);
  assert.equal(catalog.variants.length, 3996);
  assert.equal(new Set(catalog.variants.map(row => row.gearId)).size, 160);
  assert.ok(catalog.variants.some(row => row.gearId === "энциклопедия-20-томов"));
});
```

Run: `node --test tests/reference-data-import.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the importer and source artifacts**

```powershell
git add tools/reference-import/sheet-definitions.mjs tools/reference-import/narrative-pipeline.mjs tools/import-reference-data.mjs tests/reference-data-import.test.mjs data/source/narrative-filling.snapshot.json data/lootgen-narrative-variants.json
git commit -m "feat: import lootgen narrative catalog"
```

### Task 2: Runtime narrative catalog and Item mutation

**Files:**
- Create: `scripts/data/lootgen-narrative-catalog.js`
- Test: `tests/lootgen-narrative-catalog.test.mjs`

**Interfaces:**
- Consumes: `data/lootgen-narrative-variants.json`.
- Produces: `normalizeLootgenNarrativeCatalog(raw)`, `selectLootgenNarrativeVariant(candidate, random)`, `pickLootgenNarrativeFields(value)`, `applyLootgenNarrativeVariant(itemData, variant)`, `hasLootgenNarrative(itemOrData)` and `loadLootgenNarrativeCatalog()`.

- [ ] **Step 1: Write failing pure-domain tests**

```js
test("catalog groups variants and applies only the description plus module flags", () => {
  const catalog = normalizeLootgenNarrativeCatalog({ schemaVersion: 1, variants: [{
    variantId: "book-scorched", gearId: "book", sourceName: "Книга", title: "Следы копоти", description: "Края обуглены.", rank: 1
  }] });
  const selected = selectLootgenNarrativeVariant({ sourceType: "gear", sourceId: "book", narrativeVariants: catalog.byGearId.get("book") }, () => 0);
  const item = applyLootgenNarrativeVariant({ name: "Книга", system: { description: { value: "base" }, quantity: 5 }, flags: {} }, selected);
  assert.equal(item.name, "Книга");
  assert.equal(item.system.quantity, 1);
  assert.match(item.system.description.value, /Следы копоти/u);
  assert.equal(item.flags["rebreya-main"].narrativeVariantId, "book-scorched");
  assert.equal(hasLootgenNarrative(item), true);
});
```

Add rejection cases for duplicate IDs, duplicate semantic rows, unknown schema, empty descriptions, cross-gear identical text producing distinct IDs, and HTML characters being escaped.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/lootgen-narrative-catalog.test.mjs`

Expected: FAIL with missing module/export.

- [ ] **Step 3: Implement the pure catalog**

```js
export function selectLootgenNarrativeVariant(candidate, random) {
  const variants = Array.isArray(candidate?.narrativeVariants) ? candidate.narrativeVariants : [];
  if (!variants.length) return null;
  const draw = Number(random());
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError("random must return a number in [0,1)");
  return structuredClone(variants[Math.min(variants.length - 1, Math.floor(draw * variants.length))]);
}

export function applyLootgenNarrativeVariant(itemData, variant) {
  const result = structuredClone(itemData);
  if (!variant) return result;
  result.system ??= {};
  result.system.description ??= {};
  result.system.description.value = `<h3>${escapeHtml(variant.title)}</h3><p>${escapeHtml(variant.description).replace(/\n/gu, "<br>")}</p>`;
  result.system.quantity = 1;
  result.flags ??= {};
  result.flags[MODULE_ID] = { ...(result.flags[MODULE_ID] ?? {}), narrativeVariantId: variant.variantId, narrativeGearId: variant.gearId, nonStackable: true };
  return result;
}

export function pickLootgenNarrativeFields(value = {}) {
  return Object.fromEntries([
    "narrativeVariantId",
    "narrativeGearId",
    "narrativeTitle",
    "narrativeDescription"
  ].filter(key => value[key] !== undefined).map(key => [key, structuredClone(value[key])]));
}
```

The loader fetches `modules/rebreya-main/data/lootgen-narrative-variants.json` once, validates it with `normalizeLootgenNarrativeCatalog`, freezes the result and exposes `byGearId` plus `byVariantId`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/lootgen-narrative-catalog.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data/lootgen-narrative-catalog.js tests/lootgen-narrative-catalog.test.mjs
git commit -m "feat: add lootgen narrative runtime catalog"
```

### Task 3: Select one variant without biasing base-item probability

**Files:**
- Modify: `scripts/data/lootgen-source-catalog.js:51-112,218-238`
- Modify: `scripts/data/lootgen-generator.js:102-104,185-216,227-417`
- Modify: `scripts/data/lootgen-container-generation.js:9-91`
- Test: `tests/lootgen-source-catalog.test.mjs`
- Test: `tests/lootgen-generator.test.mjs`
- Test: `tests/lootgen-container-budget.test.mjs`

**Interfaces:**
- Consumes: catalog `byGearId` and `selectLootgenNarrativeVariant(candidate, random)` from Task 2.
- Produces: candidates with optional `narrativeVariants`; selected rows with `narrativeVariantId`, `narrativeTitle`, `narrativeDescription`, `narrativeGearId`, `stackable:false`.

- [ ] **Step 1: Write failing selection and probability tests**

```js
test("generator selects base gear before drawing its narrative variant", () => {
  const draws = [0.75, 0.99];
  const result = generateLootgenResult({
    mundanePool: [
      { sourceType: "gear", sourceId: "book", name: "Книга", value: 1, stackable: true, narrativeVariants: [variantA, variantB] },
      { sourceType: "gear", sourceId: "rope", name: "Верёвка", value: 1, stackable: true }
    ],
    itemCount: 1, budgetValue: 1, includeCoins: false,
    random: () => draws.shift()
  });
  assert.equal(result.rows[0].sourceId, "rope");
  assert.equal(result.rows[0].narrativeVariantId, undefined);
  assert.equal(draws.length, 1, "no narrative draw is consumed for ordinary gear");
});

test("narrative selection keeps one non-stackable row", () => {
  const result = generateLootgenResult({ mundanePool: [narrativeCandidate], itemCount: 1, budgetValue: 20, includeCoins: false, random: () => 0.999999 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].narrativeVariantId, variantB.variantId);
  assert.equal(result.rows[0].quantity, 1);
  assert.equal(result.rows[0].stackable, false);
});
```

Add a container-generation test proving root and child variant fields survive independently. `candidateIdentity()` and the container exclusion key remain the base `sourceType/sourceId`, while only persisted/aggregation row identity includes `narrativeVariantId`; this prevents a rejected base item from retrying forever under a different narrative.

- [ ] **Step 2: Run focused tests and verify failures**

Run:

```powershell
node --test tests/lootgen-source-catalog.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-container-budget.test.mjs
```

Expected: FAIL because candidates and rows lack narrative fields.

- [ ] **Step 3: Inject the catalog into the source owner**

Extend `LootgenSourceCatalog` with `getNarrativeCatalog=loadLootgenNarrativeCatalog`; load it in the existing `Promise.all`, and pass `narrativeCatalog.byGearId.get(String(gearItem.id)) ?? []` into `buildLootgenMundaneCandidate`. Do not expand one base candidate into N candidates.

```js
return {
  sourceType: "gear",
  sourceId: String(gearItem?.id ?? ""),
  // existing fields
  narrativeVariants: structuredClone(narrativeVariants)
};
```

- [ ] **Step 4: Apply the variant immediately after each base pick**

```js
function withNarrativeVariant(candidate, random) {
  const variant = selectLootgenNarrativeVariant(candidate, random);
  if (!variant) return { ...candidate };
  return {
    ...candidate,
    narrativeVariantId: variant.variantId,
    narrativeGearId: variant.gearId,
    narrativeTitle: variant.title,
    narrativeDescription: variant.description,
    stackable: false
  };
}
```

Call it after `weightedRandomPick` in both normal and container generation. Keep `candidateIdentity()` and the container candidate-exclusion key based on the base candidate. Add a separate persisted row key that includes `narrativeVariantId` for aggregation/storage identity. Copy narrative fields into the aggregate seed object. The repeat loop must continue filtering `stackable === false`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/lootgen-source-catalog.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-container-budget.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/data/lootgen-source-catalog.js scripts/data/lootgen-generator.js scripts/data/lootgen-container-generation.js tests/lootgen-source-catalog.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-container-budget.test.mjs
git commit -m "feat: select narrative loot variants"
```

### Task 4: Preserve variants through prepared graphs and storage snapshots

**Files:**
- Modify: `scripts/application/lootgen-generated-state.js:53-105`
- Modify: `scripts/data/lootgen-container-generation.js:67-84`
- Modify: `scripts/data/storage-container-item-service.js:328-390,502-535`
- Modify: `scripts/data/storage-container-snapshot.js:48-62`
- Test: `tests/lootgen-generated-state.test.mjs`
- Test: `tests/storage-container-snapshot.test.mjs`
- Test: `tests/storage-container-item-service.test.mjs`

**Interfaces:**
- Consumes: selected row narrative fields from Task 3.
- Produces: optional `narrativeVariantId/title/description/gearId` on generated rows and storage rows; every `buildItemData(row)` call receives those fields.

- [ ] **Step 1: Write failing route-parity tests**

Add fixtures that generate: a plain book, an upgraded book, a narrative container root, and a narrative book nested inside it. Assert that each prepared root `itemData.flags[MODULE_ID].narrativeVariantId` equals its row value; capture and re-prepare the storage snapshot and assert the same IDs remain.

```js
assert.equal(state.rows[0].narrativeVariantId, "book-a");
assert.equal(state.rows[0].itemData.flags[MODULE_ID].narrativeVariantId, "book-a");
assert.equal(restored.state.manualRows[0].narrativeVariantId, "book-b");
```

- [ ] **Step 2: Run focused tests and verify failures**

Run:

```powershell
node --test tests/lootgen-generated-state.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs
```

Expected: FAIL on missing narrative IDs in upgraded and nested paths.

- [ ] **Step 3: Thread narrative data beside descriptor**

In `buildLootgenGeneratedState`, capture the generated row in the closures:

```js
buildBase: (sourceType, sourceId) => buildItemData({
  sourceType,
  sourceId,
  quantity: 1,
  isBroken: descriptor.isBroken,
  ...pickLootgenNarrativeFields(row)
})
```

In container generation, copy `pickLootgenNarrativeFields(child.row)` into each non-container storage row and copy the selected root fields into `snapshot.presentation.itemData` by using the common builder during preparation. Do not add narrative fields to `normalizeLootgenComposition()`.

- [ ] **Step 4: Preserve narrative fields in storage normalize/capture/materialize**

`normalizeItemRow()` must retain the optional fields already present. Extend `appendHost(composition, quantity, fallback, parentId, member, narrativeFields={})`; when it rebuilds a composition host, pass those fields to `buildItemData`. During `#captureItemTree`, read narrative flags from captured `itemData` and project them back onto the storage row.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/lootgen-generated-state.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/application/lootgen-generated-state.js scripts/data/lootgen-container-generation.js scripts/data/storage-container-item-service.js scripts/data/storage-container-snapshot.js tests/lootgen-generated-state.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs
git commit -m "feat: preserve narrative variants in loot state"
```

### Task 5: Deliver the modified Item and forbid inventory merging

**Files:**
- Modify: `scripts/data/inventory-service.js:589-610,5902-5977,6686-6786`
- Modify: `scripts/main.js:1595-1603,7049-7085`
- Test: `tests/inventory-simple-transfer.test.mjs`
- Test: `tests/inventory-mutation-recovery.test.mjs`
- Test: `tests/runtime-graph-inventory.test.mjs`

**Interfaces:**
- Consumes: `applyLootgenNarrativeVariant()` and `hasLootgenNarrative()` from Task 2; persisted rows from Task 4.
- Produces: `buildLootgenItemData()` always applies or preserves narrative content; `itemsCanMergeInInventory()` rejects narrative operands.

- [ ] **Step 1: Write failing builder, merge and retry tests**

```js
test("lootgen character grant persists the prepared narrative item without rebuilding the base", async () => {
  const row = { quantity: 1, itemData: preparedNarrativeItem };
  await service.addLootgenRowToCharacterOnce(row, actor, "grant-narrative");
  assert.equal(actor.created[0].system.description.value, preparedNarrativeItem.system.description.value);
  assert.equal(actor.created[0].flags[MODULE_ID].narrativeVariantId, "book-a");
});

test("two equal narrative items never merge", async () => {
  actor.items.set("existing", fakeItem(preparedNarrativeItem));
  await service.addLootgenRowToCharacterOnce({ quantity: 1, itemData: preparedNarrativeItem }, actor, "grant-second");
  assert.equal(actor.created.length, 1);
  assert.equal(actor.updated.length, 0);
});
```

Add cases for ordinary gear still merging, old rows without narrative fields remaining compatible, retry reusing journal `itemData`, and prepared graph grants preserving root narrative flags.

- [ ] **Step 2: Run focused tests and verify failures**

Run:

```powershell
node --test tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/runtime-graph-inventory.test.mjs
```

Expected: FAIL because narrative flags do not affect merge and base reconstruction does not apply the selected text.

- [ ] **Step 3: Apply narrative data in the canonical builder**

After base Item construction and before durability formatting, resolve the variant snapshot from the row. If `allowPersistedItemData` is true, treat sanitized persisted `itemData` as authoritative and do not reselect or replace its text. For a new row, validate `narrativeVariantId` against its carried `gearId/title/description`, then call `applyLootgenNarrativeVariant`.

```js
if (hasLootgenNarrative(sourceItem) || hasLootgenNarrative(acceptedItem)) return false;
```

Place this guard at the start of `itemsCanMergeInInventory`. Force `safeQuantity` to `1` for a narrative row before journal receipts are calculated.

- [ ] **Step 4: Verify every main composition route passes prepared Item data**

Keep `addLootgenRowToCharacterOnce(..., { allowPersistedItemData:true })` as the authoritative character path. In `generateStorageLoot`, both composed and simple branches must store the modified `itemData`; no caller may reduce a narrative row to only `sourceType/sourceId`. Add a composition-root source assertion in the tests so regressions fail if `buildItemData` is bypassed.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/runtime-graph-inventory.test.mjs tests/lootgen-generated-state.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/data/inventory-service.js scripts/main.js tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/runtime-graph-inventory.test.mjs tests/lootgen-generated-state.test.mjs
git commit -m "feat: deliver nonstacking narrative loot items"
```

### Task 6: Documentation, version bump and offline verification

**Files:**
- Modify: `docs/function-passport.md`
- Modify: `README.md` only if the importer is documented as a user-facing maintenance command
- Modify: `module.json`
- Create: `scripts/main-1.4.314.js`
- Remove: no existing versioned forwarder

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: current passport entries, cache-busting module version and a forwarder containing only `import "./main.js";`.

- [ ] **Step 1: Update the function passport**

Document exact signatures, owners, data flow, invariants and focused tests for the importer, narrative catalog, source selection, generated state/storage propagation, Item application and merge guard. Update the existing Lootgen/profile sections instead of adding a second owner.

- [ ] **Step 2: Raise the module version and forwarder**

After verifying that `1.4.314` is still unused, update both `version` and `esmodules` in `module.json`; create `scripts/main-1.4.314.js`:

```js
import "./main.js";
```

Update every import query that references a changed Lootgen module to `?v=1.4.314`, including the three imports in `scripts/main.js` for `lootgen-generated-state.js`, `lootgen-generator.js` and `lootgen-source-catalog.js`, plus internal imports of changed modules found by:

```powershell
rg -n "lootgen-(narrative-catalog|source-catalog|generator|container-generation)|lootgen-generated-state|storage-container-(snapshot|item-service)" scripts --glob '*.js'
```

- [ ] **Step 3: Run focused verification**

Run:

```powershell
node --test tests/reference-data-import.test.mjs tests/lootgen-narrative-catalog.test.mjs tests/lootgen-source-catalog.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-container-budget.test.mjs tests/lootgen-generated-state.test.mjs tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/runtime-graph-inventory.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 4: Run the required full offline verification once**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Record passed/failed counts and real errors. Do not start Foundry or the bridge.

- [ ] **Step 5: Commit and push**

```powershell
git add docs/function-passport.md module.json scripts/main-1.4.314.js
git add README.md
git commit -m "docs: document narrative loot pipeline"
git push -u origin lich_branch
```

If `README.md` did not change, omit it from `git add`. Before the commit, inspect `git diff --stat`, `git diff`, and `git diff --check` and stage only files owned by this plan.
