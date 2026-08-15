# Public City Market Basic Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать на публичной вкладке «Рынок» города только материалы, связанные с обычными товарами городской экономики через `linkedGoodId`.

**Architecture:** Фильтрация остаётся в application projection `buildPublicCitySnapshot()` до расчёта строки цены. UI получает уже безопасный `materialRows`; Trader Engine продолжает единолично рассчитывать модификатор и окончательную цену. Общий public economy snapshot и GM mechanical model не меняются.

**Tech Stack:** Foundry VTT 13 module, JavaScript ES modules, Node.js test runner.

## Global Constraints

- Канонический признак базового рыночного материала — непустой `material.linkedGoodId`.
- Не изменять `data/materials.json`, material importer, Trader V2 или торговый workflow.
- Не фильтровать данные в `scripts/ui/city-app.js` или `templates/city-app.hbs`.
- Не рассчитывать цену вне `getMaterialPriceModifier()` и `applyMarketPrice()`.
- Общий публичный экран экономики и GM analytics остаются без изменений.
- Обновить раздел 3 `docs/function-passport.md` в том же implementation commit.
- Не добавлять в индекс незатреканный `assets/storage/furniture/`.

---

### Task 0: Commit the already verified panorama normalization fix

**Files:**
- Modify: `scripts/data/normalizer.js`
- Modify: `scripts/data/importer.js`
- Create: `tests/city-normalizer.test.mjs`
- Modify: `docs/function-passport.md` (section 3)
- Modify: `module.json`
- Create: `scripts/main-1.4.137.js`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/storage-main-registration.test.mjs`

**Interfaces:**
- Consumes: city source field `image`/`img` from `data/cities.json`.
- Produces: normalized city model with `image`; module version `1.4.137` and canonical `scripts/main-1.4.137.js` forwarder.

- [ ] **Step 1: Re-run the focused panorama checks on the current working tree**

Run:

```powershell
node --test tests/city-normalizer.test.mjs tests/city-public-assets.test.mjs tests/public-economy-read-model.test.mjs tests/city-public-ui.test.mjs tests/economy-city-connections.test.mjs tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs
```

Expected: the real `data/cities.json` path for Цугенгрим survives normalization and every focused UI/manifest test passes.

- [ ] **Step 2: Review and commit only the panorama task files**

Run:

```powershell
git diff --check
git diff --stat
git diff -- docs/function-passport.md module.json scripts/data/importer.js scripts/data/normalizer.js scripts/main-1.4.137.js tests/city-normalizer.test.mjs tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs
git add -- docs/function-passport.md module.json scripts/data/importer.js scripts/data/normalizer.js scripts/main-1.4.137.js tests/city-normalizer.test.mjs tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "fix: preserve city panoramas during normalization"
```

Expected: the commit contains only the panorama pipeline, its regression and release metadata; `assets/storage/furniture/` remains untracked.

### Task 1: Filter the public city market projection

**Files:**
- Modify: `tests/public-economy-read-model.test.mjs`
- Modify: `scripts/application/public-economy-read-model.js:45-56`
- Modify: `docs/function-passport.md` (section 3)

**Interfaces:**
- Consumes: `buildPublicCitySnapshot({ model, city, presentation, traders, tradersError })`, `material.linkedGoodId`, `getMaterialPriceModifier(model, city, material)`, `applyMarketPrice(priceGold, modifier, weight)`.
- Produces: unchanged public city snapshot shape whose `materialRows` contains only linked economy materials.

- [ ] **Step 1: Write the failing projection test**

Add after the existing final-price test in `tests/public-economy-read-model.test.mjs`:

```js
test("public city market exposes only materials linked to economy goods", () => {
  const { model, city } = fixture();
  model.materials.push({
    id: "monster-saliva",
    name: "Слюна чудовища",
    priceGold: 25,
    weight: 6,
    linkedGoodId: null
  });

  const snapshot = buildPublicCitySnapshot({ model, city, presentation: {}, traders: [] });

  assert.deepEqual(snapshot.materialRows.map((row) => row.materialId), ["iron"]);
});
```

- [ ] **Step 2: Run RED and verify the real failure**

Run:

```powershell
node --test tests/public-economy-read-model.test.mjs
```

Expected: the new test fails because the actual IDs are `["iron", "monster-saliva"]` instead of `["iron"]`; all pre-existing tests stay green.

- [ ] **Step 3: Apply the minimal projection filter**

In `buildPublicCitySnapshot()`, filter before the existing `map()` and leave the price calculation untouched:

```js
materialRows: (model?.materials ?? [])
  .filter((material) => Boolean(clean(material?.linkedGoodId)))
  .map((material) => {
    const modifier = getMaterialPriceModifier(model, city, material);
    const pricing = applyMarketPrice(material.priceGold, modifier, material.weight);
    return {
      materialId: material.id,
      name: material.name,
      finalPriceGold: pricing.finalPriceGold,
      finalWeight: pricing.finalWeight
    };
  }),
```

- [ ] **Step 4: Update the current-state function passport**

In section 3 of `docs/function-passport.md`, update the `Public read models` description to state that public city `materialRows` includes only materials with a non-empty `linkedGoodId`, while prices still delegate to Trader Engine. Add the focused projection test to the section's test ownership if it is not already present.

- [ ] **Step 5: Run focused GREEN checks**

Run:

```powershell
node --test tests/public-economy-read-model.test.mjs tests/city-public-ui.test.mjs tests/economy-public-ui.test.mjs
```

Expected: every test passes; no test is failed or skipped.

- [ ] **Step 6: Review and commit only the task files**

Run:

```powershell
git diff --check
git diff --stat
git diff -- scripts/application/public-economy-read-model.js tests/public-economy-read-model.test.mjs docs/function-passport.md
git add -- scripts/application/public-economy-read-model.js tests/public-economy-read-model.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: limit public city market to economy materials"
```

Expected: the commit contains the projection, regression test, and matching passport update; it does not contain `assets/storage/furniture/`.

### Task 2: Final integrated verification and publication

**Files:**
- Verify: all tracked `tests/*.test.mjs`, `*.js`, `*.mjs`, and `*.json`
- Verify: branch and staged/unstaged Git state

**Interfaces:**
- Consumes: the committed panorama normalization fix and Task 1 public projection filter.
- Produces: verified `lich_branch` published to `origin` without force push.

- [ ] **Step 1: Run the complete AGENTS.md verification once on final HEAD**

Run:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: all tests pass with zero failed/skipped; every JS/MJS file passes syntax checking; every tracked JSON file parses; `git diff --check` reports no errors.

- [ ] **Step 2: Confirm the authorized foreign assets remain isolated**

Run:

```powershell
git status --short --branch
git diff --name-only HEAD
```

Expected: `assets/storage/furniture/` remains untracked and absent from every task commit; no unexpected tracked changes remain.

- [ ] **Step 3: Push the verified branch**

Run:

```powershell
git push -u origin lich_branch
```

Expected: normal non-force push succeeds and `origin/lich_branch` points to final verified HEAD.
