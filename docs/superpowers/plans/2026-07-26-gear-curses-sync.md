# Gear Curses Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the checked-in gear importer consume the current Google Sheets export and rebuild `data/gear.json` with every curse product from the common equipment compendium.

**Architecture:** Keep `tools/import-gear.ps1` as the single catalog generator. Expand its explicit base-sheet aliases for the current Google export, then update the checked-in workbook snapshot and regenerate both gear catalogs while preserving enrichment from the existing `data/gear.json`.

**Tech Stack:** PowerShell 5.1, XLSX Open XML, JSON, Node.js built-in test runner.

## Global Constraints

- `Общий компендиум снаряжения V0.1` remains the source of truth for base item fields.
- Profile sheets only enrich matching base products with mechanics.
- Do not modify Actor-owned items or character sheets.
- Do not include transport or implant automation in this change.
- Preserve existing catalog enrichment during regeneration.

---

### Task 1: Accept the current Google Sheets workbook

**Files:**
- Modify: `tests/gear-import-script.test.mjs`
- Modify: `tools/import-gear.ps1`
- Replace: `docs/Ребрея_ Оружие, огнестрел и снаряжение.xlsx`

**Interfaces:**
- Consumes: the current Google Sheets XLSX export.
- Produces: `Read-NamedWorksheetWithHeader` resolving the current exported base-sheet name and a successful temporary catalog import.

- [ ] **Step 1: Replace the fixture workbook with the current export**

Copy `C:\Users\ill_lich\AppData\Local\Temp\rebreya-gear-current.xlsx` to
`docs/Ребрея_ Оружие, огнестрел и снаряжение.xlsx`.

- [ ] **Step 2: Add the failing import assertions**

Extend `tests/gear-import-script.test.mjs` with the expected curse names:

```js
const expectedCurses = [
  "Проклятье молниеносной реакции",
  "Проклятье преследующего успеха",
  "Проклятье жизни и смерти",
  "Проклятье тяжести жизни",
  "Проклятье кровопускания",
  "Проклятье скорбящего прошлого",
  "Проклятье притягивание снарядов",
  "Проклятье огненной души",
  "Проклятье воли к жизни",
  "Проклятье цепей",
  "Проклятье обсидиана"
];
assert.deepEqual(
  expectedCurses.filter((name) => !gear.some((entry) => entry.name === name)),
  []
);
assert.equal(new Set(gear.map((entry) => entry.id)).size, gear.length);
```

- [ ] **Step 3: Run the focused test and verify the current failure**

Run: `node --test tests/gear-import-script.test.mjs`

Expected: FAIL because the importer cannot resolve the current base worksheet.

- [ ] **Step 4: Add the current exported sheet alias**

Add the explicit Google-export alias to the base worksheet candidates:

```powershell
$gearWorksheet = Read-NamedWorksheetWithHeader $zip $sharedStrings @(
  "Общий компендиум снаряжения V0.1",
  "Общий компендиум снаряжения V0.",
  "Немагическое снаряжение V0.1"
)
```

- [ ] **Step 5: Run the focused test**

Run: `node --test tests/gear-import-script.test.mjs`

Expected: PASS and the temporary output contains all 11 curse products.

### Task 2: Regenerate and audit the catalogs

**Files:**
- Modify: `data/gear.json`
- Modify if generated content changes: `data/upgrades.json`
- Test: `tests/gear-compendium.test.mjs`

**Interfaces:**
- Consumes: fixed `tools/import-gear.ps1`, fresh workbook snapshot, current `data/materials.json`, and old `data/gear.json` as enrichment.
- Produces: checked-in catalogs loadable by the existing compendium pipeline.

- [ ] **Step 1: Add the failing checked-in catalog assertion**

Add a data test that loads `data/gear.json`, checks all 11 expected curse names,
checks unique IDs, and verifies every curse is an `Усовершенствование`.

- [ ] **Step 2: Verify the data test fails**

Run: `node --test tests/gear-compendium.test.mjs`

Expected: FAIL because the checked-in catalog does not yet contain the 11 curses.

- [ ] **Step 3: Regenerate into temporary files**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/import-gear.ps1 `
  -WorkbookPath "docs/Ребрея_ Оружие, огнестрел и снаряжение.xlsx" `
  -MaterialsPath data/materials.json `
  -EnrichmentSourcePath data/gear.json `
  -OutputPath "$env:TEMP/rebreya-gear-audit.json" `
  -UpgradesOutputPath "$env:TEMP/rebreya-upgrades-audit.json" `
  -AllowUnmatchedProfiles
```

Inspect item counts, duplicate IDs, removed names, added names, and changed base
fields before replacing tracked JSON.

- [ ] **Step 4: Write the audited generated catalogs**

Run the same importer with:

```powershell
-OutputPath data/gear.json -UpgradesOutputPath data/upgrades.json
```

- [ ] **Step 5: Run focused catalog tests**

Run:

```powershell
node --test tests/gear-import-script.test.mjs tests/gear-compendium.test.mjs tests/gear-catalog-sync.test.mjs
```

Expected: all focused tests PASS.

### Task 3: Final verification and publication

**Files:**
- Verify all files modified in Tasks 1–2.

**Interfaces:**
- Consumes: completed importer and regenerated catalogs.
- Produces: one reviewed implementation commit pushed to `origin/lich_branch`.

- [ ] **Step 1: Review the final diff**

Run:

```powershell
git status --short
git diff --check
git diff --stat
git diff -- tools/import-gear.ps1 tests/gear-import-script.test.mjs tests/gear-compendium.test.mjs
```

Confirm `Trace-20260724T044510.json` remains untracked and unchanged.

- [ ] **Step 2: Run the full test suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 3: Commit implementation**

```powershell
git add -- tools/import-gear.ps1 tests/gear-import-script.test.mjs tests/gear-compendium.test.mjs data/gear.json data/upgrades.json "docs/Ребрея_ Оружие, огнестрел и снаряжение.xlsx"
git commit -m "fix: sync curse gear from current workbook"
```

- [ ] **Step 4: Push without force**

Run: `git push origin lich_branch`

