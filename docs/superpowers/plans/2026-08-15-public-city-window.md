# Public City Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:subagent-driven-development` only when the user explicitly authorizes subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать существующие окна города и экономики доступными игрокам в безопасном публичном режиме с панорамами, редактируемыми описаниями, фактическими городскими ценами материалов, мировым дефицитом и доступом к существующим торговцам.

**Architecture:** `CityEconomyApp`, `EconomyApp` и `openCityApp(cityId)` остаются единственными каноническими поверхностями. Чистый application read model формирует detached player-safe snapshots; `EconomyRepository` владеет presentation overrides; composition root авторизует GM-мутации и выполняет scoped refresh.

**Tech Stack:** Foundry VTT 13, dnd5e, JavaScript ES modules, ApplicationV2/Handlebars, CSS, Node.js test runner, PowerShell для обязательных проверок.

## Global Constraints

- Перед каждым изменяющим этапом выполнить Git-проверки из `AGENTS.md`; работать и коммитить только в `lich_branch`.
- Прочитать перед реализацией `docs/superpowers/specs/2026-08-15-public-city-window-design.md` и профильные разделы 3, 5 и 19 `docs/function-passport.md`, не загружая паспорт целиком.
- Не создавать второй City app, второй Trader app, новый composition root или новый торговый workflow.
- `openCityApp(cityId)` остаётся единственной точкой открытия города; `openTrader()` продолжает делегировать Trader V2.
- UI не рассчитывает цену и не пишет `game.settings`; public contexts не содержат закрытых механических полей.
- Фактическая цена материала обязана использовать `getMaterialPriceModifier()` и `applyMarketPrice()` из `scripts/engine/trader-engine.js`.
- Любой игрок может открыть любой город; просмотр города и покупка у его торговцев не ограничиваются travel state.
- Source JSON, шаблоны и русские строки сохраняются в UTF-8 без повреждения кириллицы.
- Каждый production change проходит RED → GREEN; не писать production code до подтверждённого ожидаемого падения focused-теста.
- Новые и изменённые методы документируются в `docs/function-passport.md` в том же implementation commit, где их контракт становится публичным.

## File Structure

- `data/cities.json` — базовые `description` и явный `image` каждого города.
- `tools/import-xlsx.ps1` — сохраняет image path при следующей генерации `cities.json`.
- `scripts/data/city-presentation-overrides.js` — чистая нормализация, merge и patch presentation overrides.
- `scripts/data/repository.js` — единственный владелец чтения/записи `cityPresentationOverrides`.
- `scripts/application/public-economy-read-model.js` — detached player-safe snapshots города и общей экономики.
- `scripts/ui/city-presentation-ui.js` — тестируемые DialogV2/FilePicker adapters для GM-редактирования.
- `scripts/ui/city-app.js`, `templates/city-app.hbs` — role-aware City app в одной app instance.
- `scripts/ui/economy-app.js`, `templates/economy-app.hbs` — role-aware Economy app.
- `scripts/hooks.js` — публичная кнопка запуска Economy в существующей группе Scene Controls.
- `templates/inventory-app.hbs` — кликабельные исходный и целевой города в travel summary.
- `scripts/main.js`, `scripts/constants.js`, `scripts/settings.js` — public API, авторизация, setting и scoped city refresh.
- `styles/main.css` — стили публичных режимов, строго scoped к приложениям модуля.
- `tests/city-public-assets.test.mjs` — полнота 300 image paths.
- `tests/city-presentation-overrides.test.mjs` — нормализация и persistence contract.
- `tests/public-economy-read-model.test.mjs` — фактические цены и запрет утечки механики.
- `tests/city-public-ui.test.mjs` — player/GM city modes и редакторы.
- `tests/economy-public-ui.test.mjs` — player/GM economy modes.
- Existing focused suites: `tests/main-composition-root.test.mjs`, `tests/ui-refresh-coordinator.test.mjs`, `tests/inventory-app-context.test.mjs`, `tests/background-refresh-focus.test.mjs`, `tests/style-theme.test.mjs`, `tests/economy-city-connections.test.mjs`.

---

### Task 1: Add canonical city panorama paths

**Files:**
- Modify: `data/cities.json`
- Modify: `tools/import-xlsx.ps1:740-765`
- Create: `tests/city-public-assets.test.mjs`

**Interfaces:**
- Consumes: existing city shape `{ id, name, description, ... }`.
- Produces: every city has `image: "assets/Карты/Карты городов/Пейзажи 2x1/<city.name>.webp"`.

- [ ] **Step 1: Write the failing asset coverage test**

Create `tests/city-public-assets.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CITY_ART_PREFIX = "assets/Карты/Карты городов/Пейзажи 2x1/";

test("all economy cities declare a canonical panorama path", async () => {
  const cities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  assert.equal(cities.length, 300);
  assert.deepEqual(
    cities.filter((city) => city.image !== `${CITY_ART_PREFIX}${city.name}.webp`).map((city) => city.id),
    []
  );
});

test("declared city panoramas match the Foundry Data asset folder when it is available", async (context) => {
  const assetUrl = new URL("../../../assets/Карты/Карты городов/Пейзажи 2x1/", import.meta.url);
  const assetPath = fileURLToPath(assetUrl);
  if (!existsSync(assetPath)) {
    context.skip("Foundry Data city panorama folder is not mounted");
    return;
  }
  const cities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const files = new Set(await readdir(assetPath));
  assert.deepEqual(cities.filter((city) => !files.has(`${city.name}.webp`)).map((city) => city.name), []);
});

test("city importer preserves the canonical panorama convention", async () => {
  const importer = await readFile(new URL("../tools/import-xlsx.ps1", import.meta.url), "utf8");
  assert.match(importer, /image\s*=\s*"assets\/Карты\/Карты городов\/Пейзажи 2x1\/\$name\.webp"/u);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/city-public-assets.test.mjs
```

Expected: the first and third tests fail because `image` and importer mapping do not exist.

- [ ] **Step 3: Add the importer field and mechanically update the JSON**

In the city object assembled by `tools/import-xlsx.ps1`, keep the existing `$name` binding and insert the image field immediately after `description`:

```powershell
$cities += [pscustomobject][ordered]@{
  id = New-UniqueSlug -Value $name -UsedIds $usedCityIds
  name = $name
  description = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'B')
  image = "assets/Карты/Карты городов/Пейзажи 2x1/$name.webp"
  type = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'C')
}
```

Apply a mechanical UTF-8 rewrite to current `data/cities.json` using the same formula:

```powershell
$cityJsonPath = (Resolve-Path -LiteralPath 'data/cities.json').Path
$sourceCityRows = Get-Content -Raw -Encoding UTF8 -LiteralPath $cityJsonPath | ConvertFrom-Json
$cityRows = foreach ($cityRow in $sourceCityRows) {
  $imagePath = "assets/Карты/Карты городов/Пейзажи 2x1/$($cityRow.name).webp"
  $ordered = [ordered]@{}
  foreach ($property in $cityRow.PSObject.Properties) {
    $ordered[$property.Name] = $property.Value
    if ($property.Name -eq 'description') { $ordered.image = $imagePath }
  }
  [pscustomobject]$ordered
}
$jsonText = $cityRows | ConvertTo-Json -Depth 100
[IO.File]::WriteAllText($cityJsonPath, $jsonText + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
```

Review the resulting diff to ensure only the 300 `image` fields and unavoidable JSON formatter whitespace changed. If the formatter rewrites unrelated values, discard only this generated attempt and produce the equivalent `apply_patch` insertions instead.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/city-public-assets.test.mjs tests/economy-city-connections.test.mjs
```

Expected: all tests pass, 0 fail (the external-folder test may report skipped only outside the Foundry Data checkout).

- [ ] **Step 5: Commit the canonical source data**

```powershell
git add -- data/cities.json tools/import-xlsx.ps1 tests/city-public-assets.test.mjs
git diff --cached --check
git commit -m "data: map city panoramas"
```

---

### Task 2: Add repository-owned city presentation overrides

**Files:**
- Create: `scripts/data/city-presentation-overrides.js`
- Modify: `scripts/constants.js:159-185`
- Modify: `scripts/settings.js:217-245`
- Modify: `scripts/data/repository.js:255-420`
- Modify: `docs/function-passport.md` section 3
- Create: `tests/city-presentation-overrides.test.mjs`

**Interfaces:**
- Consumes: base city `{ id, description, image }`, raw world setting, patch `{ description?: string|null, image?: string|null }`.
- Produces:
  - `normalizeCityPresentationOverrides(raw, knownCityIds)`.
  - `mergeCityPresentation(city, overrides)`.
  - `patchCityPresentationOverrides(raw, cityId, patch, knownCityIds)`.
  - `EconomyRepository#getCityPresentations()`.
  - `EconomyRepository#getCityPresentation(cityId)`.
  - `EconomyRepository#updateCityPresentation(cityId, patch)`.
  - `SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES = "cityPresentationOverrides"`.

- [ ] **Step 1: Write failing normalization and setting tests**

Create `tests/city-presentation-overrides.test.mjs` with these behaviors:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeCityPresentation,
  normalizeCityPresentationOverrides,
  patchCityPresentationOverrides
} from "../scripts/data/city-presentation-overrides.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { registerSettings } from "../scripts/settings.js";

test("city presentation overrides keep only known cities and supported fields", () => {
  const normalized = normalizeCityPresentationOverrides({
    known: { description: "  Новый текст  ", image: " worlds/a.webp ", leaked: 7 },
    missing: { description: "Скрыть" }
  }, new Set(["known"]));
  assert.deepEqual(normalized, {
    known: { description: "Новый текст", image: "worlds/a.webp" }
  });
});

test("null patch fields reset to the base city presentation", () => {
  const current = { known: { description: "Override", image: "worlds/custom.webp" } };
  const next = patchCityPresentationOverrides(current, "known", { description: null }, new Set(["known"]));
  assert.deepEqual(next, { known: { image: "worlds/custom.webp" } });
  assert.deepEqual(mergeCityPresentation({
    id: "known", description: "Base", image: "assets/base.webp"
  }, next), {
    cityId: "known",
    baseDescription: "Base",
    baseImage: "assets/base.webp",
    description: "Base",
    image: "worlds/custom.webp",
    descriptionOverridden: false,
    imageOverridden: true
  });
});

test("unknown city presentation patches fail closed", () => {
  assert.throws(
    () => patchCityPresentationOverrides({}, "missing", { description: "x" }, new Set(["known"])),
    /Unknown city/u
  );
});

test("city presentation setting key is stable", () => {
  assert.equal(SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES, "cityPresentationOverrides");
  assert.equal(MODULE_ID, "rebreya-main");
});

test("city presentation overrides register as hidden world state", () => {
  const previousGame = globalThis.game;
  const registered = [];
  globalThis.game = { settings: { register(moduleId, key, config) { registered.push({ moduleId, key, config }); } } };
  try {
    registerSettings();
    const entry = registered.find((candidate) => candidate.key === SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES);
    assert.equal(entry?.moduleId, MODULE_ID);
    assert.deepEqual({
      scope: entry?.config.scope,
      config: entry?.config.config,
      type: entry?.config.type,
      default: entry?.config.default
    }, { scope: "world", config: false, type: Object, default: {} });
  }
  finally {
    globalThis.game = previousGame;
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/city-presentation-overrides.test.mjs
```

Expected: module-not-found or missing export failure for `city-presentation-overrides.js`.

- [ ] **Step 3: Implement pure normalization and patch semantics**

Create `scripts/data/city-presentation-overrides.js` with constants and functions matching this contract:

```js
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_IMAGE_PATH_LENGTH = 1024;

function clean(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

export function normalizeCityPresentationOverrides(raw, knownCityIds = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const [cityId, value] of Object.entries(source)) {
    if (knownCityIds && !knownCityIds.has(cityId)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const description = clean(value.description, MAX_DESCRIPTION_LENGTH);
    const image = clean(value.image, MAX_IMAGE_PATH_LENGTH);
    const entry = {};
    if (description) entry.description = description;
    if (image) entry.image = image;
    if (Object.keys(entry).length) result[cityId] = entry;
  }
  return result;
}

export function patchCityPresentationOverrides(raw, cityId, patch = {}, knownCityIds = null) {
  const cleanCityId = String(cityId ?? "").trim();
  if (!cleanCityId || (knownCityIds && !knownCityIds.has(cleanCityId))) {
    throw new Error(`Unknown city '${cleanCityId}'`);
  }
  const next = normalizeCityPresentationOverrides(raw, knownCityIds);
  const entry = { ...(next[cleanCityId] ?? {}) };
  for (const [field, limit] of [["description", MAX_DESCRIPTION_LENGTH], ["image", MAX_IMAGE_PATH_LENGTH]]) {
    if (!Object.hasOwn(patch, field)) continue;
    const value = patch[field] === null ? "" : clean(patch[field], limit);
    if (value) entry[field] = value;
    else delete entry[field];
  }
  if (Object.keys(entry).length) next[cleanCityId] = entry;
  else delete next[cleanCityId];
  return next;
}

export function mergeCityPresentation(city, overrides = {}) {
  const baseDescription = clean(city?.description, MAX_DESCRIPTION_LENGTH);
  const baseImage = clean(city?.image, MAX_IMAGE_PATH_LENGTH);
  const entry = normalizeCityPresentationOverrides(overrides)?.[city?.id] ?? {};
  return {
    cityId: city.id,
    baseDescription,
    baseImage,
    description: entry.description || baseDescription,
    image: entry.image || baseImage,
    descriptionOverridden: Boolean(entry.description),
    imageOverridden: Boolean(entry.image)
  };
}
```

- [ ] **Step 4: Wire the setting and repository owner**

Add the constant and hidden world setting. In `EconomyRepository` add:

```js
getCityPresentationOverrides() {
  const knownCityIds = new Set(this.#model?.cities?.map((city) => city.id) ?? []);
  return normalizeCityPresentationOverrides(
    this.#getObjectSetting(SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES),
    knownCityIds
  );
}

getCityPresentation(cityId) {
  return this.getCityPresentations()[cityId] ?? null;
}

getCityPresentations() {
  const overrides = this.getCityPresentationOverrides();
  return Object.fromEntries(
    (this.#model?.cities ?? []).map((city) => [city.id, mergeCityPresentation(city, overrides)])
  );
}

async updateCityPresentation(cityId, patch = {}) {
  const knownCityIds = new Set(this.#model?.cities?.map((city) => city.id) ?? []);
  const next = patchCityPresentationOverrides(
    this.getCityPresentationOverrides(), cityId, patch, knownCityIds
  );
  await game.settings.set(MODULE_ID, SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES, next);
  return this.getCityPresentation(cityId);
}
```

Include the new setting in `resetWorldData()` and import the pure helpers at the top of `repository.js`.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
node --test tests/city-presentation-overrides.test.mjs tests/economy-city-connections.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 6: Record the repository functions in the passport**

In section 3 add `getCityPresentationOverrides()`, `getCityPresentations()`, `getCityPresentation(cityId)` and `updateCityPresentation(cityId, patch)`, setting ownership, single-read bulk merge, null-reset semantics, the GM authorization boundary at composition, and `tests/city-presentation-overrides.test.mjs`.

- [ ] **Step 7: Commit the repository contract**

```powershell
git add -- scripts/data/city-presentation-overrides.js scripts/constants.js scripts/settings.js scripts/data/repository.js tests/city-presentation-overrides.test.mjs docs/function-passport.md
git diff --cached --check
git commit -m "feat: persist city presentation overrides"
```

---

### Task 3: Build player-safe public economy read models

**Files:**
- Create: `scripts/application/public-economy-read-model.js`
- Create: `tests/public-economy-read-model.test.mjs`
- Modify: `docs/function-passport.md` section 3

**Interfaces:**
- Consumes: canonical `model`, detailed city snapshot, merged presentation and trader summaries.
- Produces:
  - `buildPublicCitySnapshot({ model, city, presentation, traders, tradersError })`.
  - `buildPublicEconomySnapshot(model, cityPresentations = {})`.
  - `selectPublicCityRows(cities, filters)`.
  - `buildPublicFilterOptions(cities, selectedState = "all")`.

- [ ] **Step 1: Write failing actual-price and non-leakage tests**

Create a minimal model fixture with one linked material and one city:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicCitySnapshot,
  buildPublicEconomySnapshot,
  buildPublicFilterOptions,
  selectPublicCityRows
} from "../scripts/application/public-economy-read-model.js";

function fixture() {
  const material = { id: "iron", name: "Железо", priceGold: 10, weight: 1, linkedGoodId: "zhelezo" };
  const city = {
    id: "city-a", name: "Город А", state: "Страна", regionId: "region-a", regionName: "Регион",
    cityType: "Промышленный", type: "Город", population: 10,
    production: 99, demand: 88, totalDeficit: 77,
    goodsRows: [{ goodId: "zhelezo", priceModifierPercent: 0.25, production: 3, demand: 8 }]
  };
  return {
    material,
    city,
    model: {
      materials: [material],
      cities: [city],
      materialById: new Map([[material.id, material]]),
      overview: { deficitGoods: [{ goodId: "zhelezo", deficit: 5 }] }
    }
  };
}

test("public city snapshot exposes final material price without mechanics", () => {
  const { model, city } = fixture();
  const snapshot = buildPublicCitySnapshot({
    model,
    city,
    presentation: { description: "Текст", image: "assets/city.webp" },
    traders: []
  });
  assert.deepEqual(snapshot.materialRows, [{
    materialId: "iron", name: "Железо", finalPriceGold: 12.5, finalWeight: 1
  }]);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["priceModifierPercent", "production", "demand", "balance", "surplus", "deficit", "importSources"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("public city snapshot preserves the actual minimum-price selling weight", () => {
  const { model, city, material } = fixture();
  material.priceGold = 0.01;
  city.goodsRows[0].priceModifierPercent = -0.8;
  const snapshot = buildPublicCitySnapshot({ model, city, presentation: {}, traders: [] });
  assert.deepEqual(snapshot.materialRows[0], {
    materialId: "iron", name: "Железо", finalPriceGold: 0.01, finalWeight: 5
  });
});

test("public economy exposes base prices and world deficit only", () => {
  const { model } = fixture();
  const snapshot = buildPublicEconomySnapshot(model, {
    "city-a": { description: "Public", image: "worlds/override.webp" }
  });
  assert.deepEqual(snapshot.materialRows, [{
    materialId: "iron", name: "Железо", basePriceGold: 10, baseWeight: 1, worldDeficit: 5, hasWorldDeficit: true
  }]);
  assert.equal(snapshot.cities[0].image, "worlds/override.webp");
  assert.equal(JSON.stringify(snapshot).includes("priceModifierPercent"), false);
});

test("public city filters sort by name without mechanical sort keys", () => {
  const rows = [{ id: "b", name: "Бета", state: "S", regionId: "r", regionName: "R", cityType: "Порт" }, { id: "a", name: "Альфа", state: "S", regionId: "r", regionName: "R", cityType: "Порт" }];
  assert.deepEqual(selectPublicCityRows(rows, { search: "аль" }).map((row) => row.id), ["a"]);
  assert.deepEqual(selectPublicCityRows(rows, {}).map((row) => row.id), ["a", "b"]);
  assert.deepEqual(buildPublicFilterOptions(rows, "S"), {
    stateOptions: [{ value: "S", label: "S" }],
    regionOptions: [{ value: "r", label: "R (S)" }],
    cityTypeOptions: [{ value: "Порт", label: "Порт" }]
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/public-economy-read-model.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimal read model**

In `scripts/application/public-economy-read-model.js`, import:

```js
import { applyMarketPrice, getMaterialPriceModifier } from "../engine/trader-engine.js";
```

Map material rows with:

```js
const modifier = getMaterialPriceModifier(model, city, material);
const pricing = applyMarketPrice(material.priceGold, modifier, material.weight);
return {
  materialId: material.id,
  name: material.name,
  finalPriceGold: pricing.finalPriceGold,
  finalWeight: pricing.finalWeight
};
```

Public city rows contain only `id`, `name`, `state`, `regionId`, `regionName`, `cityType`, `type`, effective `description`, effective `image`, `materialRows`, normalized trader summaries and optional `tradersError`. Public economy rows contain only safe city identity fields merged with the effective entry from `cityPresentations`, plus base material rows and `worldDeficit` resolved from `model.overview.deficitGoods` by `linkedGoodId`; linked materials use `hasWorldDeficit: true` even when the value is zero, while unlinked materials use `{ worldDeficit: null, hasWorldDeficit: false }`.

`selectPublicCityRows` supports `search`, `state`, `regionId`, `cityType` and always sorts by Russian city name. It must not read population, deficit, surplus or self-sufficiency.

`buildPublicFilterOptions` derives options only from safe city fields. Region labels use `${regionName} (${state})`, deduplicate by `regionId`, and respect `selectedState` without reading mechanical summaries.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
node --test tests/public-economy-read-model.test.mjs tests/trader-service.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 5: Record the read-model functions in the passport**

In section 3 add the four exact exported signatures, final-price delegation to Trader Engine, forbidden public fields, world-deficit source, and `tests/public-economy-read-model.test.mjs`.

- [ ] **Step 6: Commit the safe read model**

```powershell
git add -- scripts/application/public-economy-read-model.js tests/public-economy-read-model.test.mjs docs/function-passport.md
git diff --cached --check
git commit -m "feat: build public economy read models"
```

---

### Task 4: Expose authorized composition methods and scoped city refresh

**Files:**
- Modify: `scripts/main.js:1290-1305,2938-2990,5330-5400`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/ui-refresh-coordinator.test.mjs`
- Modify: `docs/function-passport.md` sections 3 and 19

**Interfaces:**
- Consumes: repository methods from Task 2 and read-model functions from Task 3.
- Produces:
  - `getPublicCitySnapshot(cityId): Promise<PublicCitySnapshot|null>`.
  - `getPublicEconomySnapshot(): Promise<PublicEconomySnapshot>`.
  - `getCityPresentation(cityId): CityPresentation|null`.
  - `updateCityPresentation(cityId, patch): Promise<CityPresentation>`; GM-only.
  - `resetCityPresentation(cityId, fields = ["description", "image"]): Promise<CityPresentation>`; GM-only.
  - `refreshCityViews({ cityIds = [] } = {}): Promise<void>`; internal scoped refresh.

- [ ] **Step 1: Add failing composition and refresh assertions**

Extend `tests/main-composition-root.test.mjs` to assert the exact method names and imports exist, `openCityApp` still has one `cityApps` cache, and `getPublicCitySnapshot` calls the read model rather than returning `getCitySnapshot()` directly.

Extend `tests/ui-refresh-coordinator.test.mjs` with a fixture containing city apps `a` and `b`:

```js
test("city presentation refresh targets only requested city apps", async () => {
  const fixture = createModuleFixture();
  fixture.moduleApi.cityApps.set("a", fixture.createApp("city-a"));
  fixture.moduleApi.cityApps.set("b", fixture.createApp("city-b"));
  await fixture.moduleApi.refreshCityViews({ cityIds: ["b"] });
  assert.deepEqual(fixture.calls.map((call) => call.name), ["city-b"]);
});
```

Add a composition authorization assertion using the existing source-contract style:

```js
assert.match(updateMethodSource, /game\.user\?\.isGM\s*!==\s*true/u);
assert.match(updateMethodSource, /City presentation updates require a GM/u);
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs
```

Expected: failures for missing public methods and `refreshCityViews`.

- [ ] **Step 3: Implement public reads and fail-closed GM mutations**

Import the Task 3 builders into `scripts/main.js`. Implement:

```js
async getPublicCitySnapshot(cityId) {
  const model = await this.getModel();
  const city = this.getCitySnapshot(cityId);
  if (!city) return null;
  let traders = [];
  let tradersError = "";
  try {
    traders = await this.getCityTraderSummaries(cityId);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to load public traders for '${cityId}'.`, error);
    tradersError = "Не удалось загрузить торговцев города.";
  }
  return buildPublicCitySnapshot({
    model,
    city,
    presentation: this.repository.getCityPresentation(cityId),
    traders,
    tradersError
  });
}

async getPublicEconomySnapshot() {
  const model = await this.getModel();
  return buildPublicEconomySnapshot(model, this.repository.getCityPresentations());
}

getCityPresentation(cityId) {
  return this.repository.getCityPresentation(cityId);
}

async updateCityPresentation(cityId, patch = {}) {
  if (game.user?.isGM !== true) throw new Error("City presentation updates require a GM");
  const result = await this.repository.updateCityPresentation(cityId, patch);
  await this.refreshCityViews({ cityIds: [cityId] });
  return result;
}

async resetCityPresentation(cityId, fields = ["description", "image"]) {
  if (game.user?.isGM !== true) throw new Error("City presentation updates require a GM");
  const allowed = new Set(["description", "image"]);
  const patch = Object.fromEntries((fields ?? []).filter((field) => allowed.has(field)).map((field) => [field, null]));
  if (!Object.keys(patch).length) return this.getCityPresentation(cityId);
  const result = await this.repository.updateCityPresentation(cityId, patch);
  await this.refreshCityViews({ cityIds: [cityId] });
  return result;
}
```

Both mutations must reject before repository access for a player. An empty/invalid reset field list performs no setting write: return the current presentation immediately instead of calling `updateCityPresentation` with an empty patch.

- [ ] **Step 4: Implement scoped refresh**

Use existing `#appRefreshTask` and `uiRefreshCoordinator`:

```js
async refreshCityViews({ cityIds = [] } = {}) {
  const requested = new Set((cityIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean));
  const apps = requested.size
    ? [...requested].map((id) => this.cityApps.get(id)).filter(Boolean)
    : [...this.cityApps.values()];
  const tasks = apps.map((app) => this.#appRefreshTask(app)).filter(Boolean);
  await this.uiRefreshCoordinator.request(tasks);
}
```

After a successful update/reset, call `refreshCityViews({ cityIds: [cityId] })`; do not call `refreshOpenApps()`.

- [ ] **Step 5: Update the function passport for the new contracts**

In sections 3 and 19 document the five external methods, `refreshCityViews` as internal, GM-only mutation, detached public snapshots, final-price ownership, and the new focused tests. Remove no existing method.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
node --test tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs tests/public-economy-read-model.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Commit the composition contract**

```powershell
git add -- scripts/main.js tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs docs/function-passport.md
git diff --cached --check
git commit -m "feat: expose public city read models"
```

---

### Task 5: Implement the role-aware public City app

**Files:**
- Create: `scripts/ui/city-presentation-ui.js`
- Modify: `scripts/ui/city-app.js:164-390`
- Modify: `templates/city-app.hbs`
- Modify: `styles/main.css:1410-1600` and responsive section near `styles/main.css:9460`
- Create: `tests/city-public-ui.test.mjs`
- Modify: `tests/background-refresh-focus.test.mjs`
- Modify: `tests/style-theme.test.mjs`
- Modify: `docs/function-passport.md` section 19

**Interfaces:**
- Consumes: `moduleApi.getPublicCitySnapshot`, `updateCityPresentation`, `resetCityPresentation`, `openTrader`.
- Produces:
  - `resolveCityViewMode({ isGM, requestedMode }) -> "admin"|"public"`.
  - `promptCityDescription({ city, dialogClass }) -> Promise<string|null>`.
  - `openCityImagePicker({ current, pickerClass, onSelected, onError })`.
  - One `CityEconomyApp` with `viewMode`, `publicTab` and existing `activeTab`.

- [ ] **Step 1: Write failing helper and app-context tests**

Create `tests/city-public-ui.test.mjs` and test the pure helpers first:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  openCityImagePicker,
  resolveCityViewMode
} from "../scripts/ui/city-presentation-ui.js";

test("players are locked to public city mode", () => {
  assert.equal(resolveCityViewMode({ isGM: false, requestedMode: "admin" }), "public");
  assert.equal(resolveCityViewMode({ isGM: true, requestedMode: "admin" }), "admin");
});

test("city image picker delegates the selected path without writing settings", async () => {
  let options;
  class Picker { constructor(value) { options = value; } render() {} }
  const selected = [];
  openCityImagePicker({ current: "base.webp", pickerClass: Picker, onSelected: async (path) => selected.push(path) });
  await options.callback(" worlds/city.webp ");
  assert.deepEqual(selected, ["worlds/city.webp"]);
});
```

Add an ApplicationV2 harness and a real player-context assertion:

```js
test("player CityEconomyApp prepares only the public snapshot", async () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  class TestApplication { constructor() {} async _onRender() {} }
  globalThis.foundry = {
    applications: { api: { ApplicationV2: TestApplication, HandlebarsApplicationMixin: (Base) => Base, DialogV2: {} } }
  };
  globalThis.game = { user: { isGM: false }, settings: { get: () => false } };
  const calls = [];
  try {
    const { CityEconomyApp } = await import(`../scripts/ui/city-app.js?public-player=${Date.now()}`);
    const app = new CityEconomyApp({
      async getPublicCitySnapshot(cityId) { calls.push(["public", cityId]); return { id: cityId, materialRows: [], traders: [] }; },
      getCitySnapshot() { throw new Error("player must not request the mechanical city snapshot"); }
    }, "city-a");
    const context = await app._prepareContext();
    assert.equal(context.isPublicView, true);
    assert.equal(context.canEditPresentation, false);
    assert.deepEqual(calls, [["public", "city-a"]]);
    const missing = new CityEconomyApp({ async getPublicCitySnapshot() { return null; } }, "missing");
    const missingContext = await missing._prepareContext();
    assert.equal(missingContext.hasError, true);
    assert.match(missingContext.errorMessage, /Город не найден/u);
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  }
});
```

Add a source/template contract for retained GM mode and exact controls:

```js
const [source, template] = await Promise.all([
  readFile(new URL("../scripts/ui/city-app.js", import.meta.url), "utf8"),
  readFile(new URL("../templates/city-app.hbs", import.meta.url), "utf8")
]);
assert.match(source, /resolveCityViewMode/u);
assert.match(source, /this\.moduleApi\.getCitySnapshot\(this\.cityId\)/u);
assert.doesNotMatch(source, /travelState|originCityId|destinationCityId/u);
for (const action of ["city-public-tab", "toggle-city-view", "open-trader", "edit-city-description", "edit-city-image", "reset-city-description", "reset-city-image"]) {
  assert.match(template, new RegExp(`data-action="${action}"`, "u"), action);
}
assert.match(template, /{{#if canEditPresentation}}[\s\S]*data-action="edit-city-description"[\s\S]*{{\/if}}/u);
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/city-public-ui.test.mjs
```

Expected: module-not-found for `city-presentation-ui.js` or missing public context.

- [ ] **Step 3: Implement testable GM editor adapters**

Use the same FilePicker resolution pattern as `party-inventory-crest.js`:

```js
export function resolveCityViewMode({ isGM = false, requestedMode = "admin" } = {}) {
  return isGM && requestedMode === "admin" ? "admin" : "public";
}

export function openCityImagePicker({
  current = "",
  pickerClass = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker,
  onSelected,
  onError
} = {}) {
  if (typeof pickerClass !== "function") throw new Error("Foundry image picker is unavailable.");
  const picker = new pickerClass({
    type: "image",
    current: String(current ?? "").trim(),
    callback: async (path) => {
      const selected = String(path ?? "").trim();
      if (!selected) return;
      try { await onSelected?.(selected); }
      catch (error) { onError?.(error); }
    }
  });
  void picker.render({ force: true });
  return picker;
}

export async function promptCityDescription({ city, dialogClass = globalThis.foundry?.applications?.api?.DialogV2 } = {}) {
  if (typeof dialogClass?.prompt !== "function") throw new Error("Foundry dialog is unavailable.");
  return dialogClass.prompt({
    window: { title: `Описание: ${String(city?.name ?? "Город").trim()}` },
    content: `<form class="rm-city-description-dialog"><textarea name="description" maxlength="5000" rows="12">${foundry.utils.escapeHTML(String(city?.description ?? ""))}</textarea></form>`,
    ok: {
      label: "Сохранить",
      callback: (_event, button) => String(button?.form?.elements?.description?.value ?? "").trim()
    },
    rejectClose: false
  });
}
```

`promptCityDescription` uses `DialogV2.prompt`, a textarea capped at 5000 characters, returns trimmed text, and returns `null` on close.

- [ ] **Step 4: Add public mode to the existing CityEconomyApp**

Initialize:

```js
this.viewMode = resolveCityViewMode({ isGM: game.user?.isGM === true, requestedMode: "admin" });
this.publicTab = "city";
```

At the start of `_prepareContext`, resolve the mode again so a player can never force admin state. In public mode return only:

```js
{
  hasError: !publicCity,
  isPublicView: true,
  isGmViewer: game.user?.isGM === true,
  canEditPresentation: game.user?.isGM === true,
  publicCity,
  publicTabs: {
    isCity: this.publicTab === "city",
    isMarket: this.publicTab === "market",
    isTraders: this.publicTab === "traders"
  }
}
```

Do not fetch `getModel`, `getCitySnapshot` or analytics fields in the player branch. Keep the current GM analytics code in the `admin` branch unchanged except for adding the view toggle.

Bind public tabs, GM view toggle, description prompt, FilePicker, per-field reset and existing `openTrader`. Every mutation awaits module API, reports failures through `ui.notifications`, and does not optimistically replace authoritative values.

- [ ] **Step 5: Add the cinematic Handlebars branch**

Wrap the current template in `{{#if isPublicView}} ... {{else}} existing GM markup {{/if}}`. The public branch must use only `publicCity`:

```hbs
<!-- public-city:start -->
<section class="rm-public-city-shell scrollable">
  <header class="rm-public-city-hero">
    {{#if publicCity.image}}
      <img class="rm-public-city-hero__image" src="{{publicCity.image}}" alt="">
    {{/if}}
    <div class="rm-public-city-hero__copy">
      <span>{{publicCity.state}} / {{publicCity.regionName}}</span>
      <h2>{{publicCity.name}}</h2>
      <p>{{publicCity.description}}</p>
    </div>
    {{#if canEditPresentation}}
      <div class="rm-public-city-hero__actions">
        <button type="button" data-action="edit-city-description">Изменить описание</button>
        <button type="button" data-action="reset-city-description">Сбросить описание</button>
        <button type="button" data-action="edit-city-image">Выбрать изображение</button>
        <button type="button" data-action="reset-city-image">Сбросить изображение</button>
        <button type="button" data-action="toggle-city-view" data-view-mode="admin">Экономика GM</button>
      </div>
    {{/if}}
  </header>
  <nav class="rm-public-city-tabs">
    <button type="button" data-action="city-public-tab" data-tab="city">Город</button>
    <button type="button" data-action="city-public-tab" data-tab="market">Рынок</button>
    <button type="button" data-action="city-public-tab" data-tab="traders">Торговцы</button>
  </nav>
  {{#if publicTabs.isCity}}
    <section class="rm-public-city-story"><p>{{publicCity.description}}</p></section>
  {{/if}}
  {{#if publicTabs.isMarket}}
    <section class="rm-public-city-market">
      {{#each publicCity.materialRows}}
        <article><span>{{name}}</span><strong>{{rmNum finalPriceGold}} зм за {{rmNum finalWeight}} фнт.</strong></article>
      {{/each}}
    </section>
  {{/if}}
  {{#if publicTabs.isTraders}}
    <section class="rm-public-city-traders">
      {{#if publicCity.tradersError}}<p class="rm-empty">{{publicCity.tradersError}}</p>{{/if}}
      {{#each publicCity.traders}}
        <article><span>{{name}}</span><button type="button" data-action="open-trader" data-trader-key="{{traderKey}}">Открыть лавку</button></article>
      {{/each}}
    </section>
  {{/if}}
</section>
<!-- public-city:end -->
```

Market rows show `name`, `finalPriceGold` and `finalWeight` only. Trader rows use `data-action="open-trader"` and `data-trader-key`; they show `publicCity.tradersError` locally when present. The hero uses a CSS gradient fallback when `publicCity.image` is empty; do not hide the tabs. Whitelist tab values to `city`, `market`, `traders` before assigning `this.publicTab`.

In the existing GM header add one `data-action="toggle-city-view" data-view-mode="public"` button. Both buttons update `viewMode` on the same app instance and call `render({ force: true })`.

- [ ] **Step 6: Add scoped cinematic styles and responsive behavior**

Create styles only under `.rebreya-city-app .rm-public-city-*`. Match the dark inventory visual language: full-width 2:1 hero, left-to-right dark gradient, serif display name, gold active tab, responsive material/trader grids. At narrow widths stack grids and keep all buttons visible without horizontal clipping.

Extend `style-theme.test.mjs` to assert the public selectors exist and remain scoped. Extend `background-refresh-focus.test.mjs` so `_onRender` contains no `bringAppToFront(this)`.

- [ ] **Step 7: Run focused tests and verify GREEN**

```powershell
node --test tests/city-public-ui.test.mjs tests/background-refresh-focus.test.mjs tests/style-theme.test.mjs tests/trader-ui-transaction-lifecycle.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 8: Record the City UI functions and mode flow in the passport**

In section 19 document `resolveCityViewMode`, `promptCityDescription`, `openCityImagePicker`, player/public versus GM/admin `_prepareContext` flow, canonical `openTrader` delegation and `tests/city-public-ui.test.mjs`.

- [ ] **Step 9: Commit the public city interface**

```powershell
git add -- scripts/ui/city-presentation-ui.js scripts/ui/city-app.js templates/city-app.hbs styles/main.css tests/city-public-ui.test.mjs tests/background-refresh-focus.test.mjs tests/style-theme.test.mjs docs/function-passport.md
git diff --cached --check
git commit -m "feat: add public city view"
```

---

### Task 6: Implement the player-safe Economy app

**Files:**
- Modify: `scripts/ui/economy-app.js:177-365`
- Modify: `scripts/hooks.js:532-560`
- Modify: `templates/economy-app.hbs`
- Modify: `styles/main.css:1413-1585` and responsive section near `styles/main.css:9680`
- Create: `tests/economy-public-ui.test.mjs`
- Modify: `tests/bg3-hotbar-compat.test.mjs:457-560`
- Modify: `tests/style-theme.test.mjs`
- Modify: `docs/function-passport.md` section 19

**Interfaces:**
- Consumes: `moduleApi.getPublicEconomySnapshot()`, `selectPublicCityRows()`, `buildPublicFilterOptions()`, existing `openCityApp(cityId)`.
- Produces: player context `{ isPublicView, cities, materialRows, filters, filterOptions, counts }`; GM context remains current; existing Economy scene-control button is visible to players when `showEconomyButton` is enabled.

- [ ] **Step 1: Write failing player/GM context tests**

Use a small ApplicationV2 harness. Stub `game.user.isGM = false` and the public API:

```js
const moduleApi = {
  async getPublicEconomySnapshot() {
    return {
      cities: [{ id: "a", name: "Альфа", state: "S", regionId: "r", regionName: "R", cityType: "Порт", image: "a.webp" }],
      materialRows: [{ materialId: "iron", name: "Железо", basePriceGold: 10, baseWeight: 1, worldDeficit: 5, hasWorldDeficit: true }]
    };
  },
  async getModel() { throw new Error("player context must not request the mechanical model"); }
};
```

Complete the real assertion with:

```js
test("player EconomyApp never requests the mechanical model", async () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const previousLocalStorage = globalThis.localStorage;
  class TestApplication { constructor() {} async _onRender() {} }
  globalThis.foundry = {
    applications: { api: { ApplicationV2: TestApplication, HandlebarsApplicationMixin: (Base) => Base, DialogV2: {} } }
  };
  globalThis.game = { user: { isGM: false }, settings: { get: () => false }, world: { id: "test" } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  try {
    const { EconomyApp } = await import(`../scripts/ui/economy-app.js?public-player=${Date.now()}`);
    const context = await new EconomyApp(moduleApi)._prepareContext();
    assert.equal(context.isPublicView, true);
    assert.deepEqual(context.materialRows, [{ materialId: "iron", name: "Железо", basePriceGold: 10, baseWeight: 1, worldDeficit: 5, hasWorldDeficit: true }]);
    for (const forbidden of ["summary", "stateOverview", "tradeAuditLog", "activeEvents", "dataSource"]) {
      assert.equal(Object.hasOwn(context, forbidden), false, forbidden);
    }
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
    globalThis.localStorage = previousLocalStorage;
  }
});
```

Add a source contract proving the GM branch still calls `getModel()` and inspect only the marked public template branch:

```js
const [source, template] = await Promise.all([
  readFile(new URL("../scripts/ui/economy-app.js", import.meta.url), "utf8"),
  readFile(new URL("../templates/economy-app.hbs", import.meta.url), "utf8")
]);
assert.match(source, /const model = await this\.moduleApi\.getModel\(\)/u);
const start = template.indexOf("<!-- public-economy:start -->");
const end = template.indexOf("<!-- public-economy:end -->", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const publicBranch = template.slice(start, end);
for (const forbidden of ["rollback-trade-audit", "priceModifierPercent", "production", "demand", "netBalance", "open-world-routes", "open-global-events"]) {
  assert.equal(publicBranch.includes(forbidden), false, forbidden);
}
```

Extend `tests/bg3-hotbar-compat.test.mjs` with a player launcher contract using the existing `withSceneControlsHandlerForUser()` helper:

```js
test("scene controls expose Economy to non-GM users", () => {
  withSceneControlsHandlerForUser({ isGM: false }, (handler) => {
    const controls = { tokens: { name: "tokens", order: 20, tools: {} } };
    handler(controls);

    const economyTool = controls["rebreya-main-rebreya"].tools["rebreya-main-economy"];
    assert.equal(economyTool.visible, true);
    assert.equal(economyTool.title, "REBREYA_MAIN.Controls.OpenEconomy");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test tests/economy-public-ui.test.mjs tests/bg3-hotbar-compat.test.mjs
```

Expected: player context calls `getModel()` and the player launcher is hidden; both new contracts fail for their intended reason.

- [ ] **Step 3: Add an early player-safe context branch**

At the beginning of `_prepareContext()`:

```js
if (game.user?.isGM !== true) {
  const snapshot = await this.moduleApi.getPublicEconomySnapshot();
  const selectedCities = selectPublicCityRows(snapshot.cities, this.filters);
  const filterOptions = buildPublicFilterOptions(snapshot.cities, this.filters.state);
  return {
    hasError: false,
    isPublicView: true,
    filters: this.filters,
    cities: selectedCities.slice(0, MAX_VISIBLE_CITIES),
    materialRows: snapshot.materialRows,
    filteredCityCount: selectedCities.length,
    totalCityCount: snapshot.cities.length,
    cityListLimited: selectedCities.length > MAX_VISIBLE_CITIES,
    stateOptions: filterOptions.stateOptions,
    regionOptions: filterOptions.regionOptions,
    cityTypeOptions: filterOptions.cityTypeOptions
  };
}
```

Import `buildPublicFilterOptions` and `selectPublicCityRows` from Task 3's module. Do not reuse mechanical state/region summaries and do not expose the existing mechanical sort choices in player mode.

In `buildToolsRecord()` change only the Economy tool visibility from the GM-only condition to the existing setting:

```js
visible: showEconomyButton,
```

Do not expose the GM-only Groups, Cosmology or Lootgen buttons. Keep the existing `createSafeAction(() => game.rebreyaMain?.openEconomyApp?.())` route; role-aware `_prepareContext()` decides which Economy view is rendered.

- [ ] **Step 4: Add the public economy template branch**

Place the public branch between `<!-- public-economy:start -->` and `<!-- public-economy:end -->`. It contains:

- header and safe filters;
- city cards with panorama, name, state/region/type and `data-action="open-city"`;
- a base-material table with columns `Материал`, `Базовая цена`, `Единица`, `Мировой дефицит`;
- `—` for unlinked materials without a world-deficit value.

Use this concrete branch shape and retain the current GM markup in `{{else}}`:

```hbs
{{#if isPublicView}}
  <!-- public-economy:start -->
  <section class="rm-shell rm-public-economy-shell scrollable">
    <header class="rm-public-economy-header"><h2>Экономика Ребреи</h2></header>
    <section class="rm-public-economy-filters">
      <input type="search" data-filter="search" value="{{filters.search}}" placeholder="Найти город">
      <select data-filter="state"><option value="all">Все государства</option>{{#each stateOptions}}<option value="{{value}}" {{#if (rmEq value ../filters.state)}}selected{{/if}}>{{label}}</option>{{/each}}</select>
      <select data-filter="regionId"><option value="all">Все регионы</option>{{#each regionOptions}}<option value="{{value}}" {{#if (rmEq value ../filters.regionId)}}selected{{/if}}>{{label}}</option>{{/each}}</select>
      <select data-filter="cityType"><option value="all">Все типы</option>{{#each cityTypeOptions}}<option value="{{value}}" {{#if (rmEq value ../filters.cityType)}}selected{{/if}}>{{label}}</option>{{/each}}</select>
    </section>
    <section class="rm-public-economy-cities">
      {{#each cities}}
        <button type="button" class="rm-public-economy-city" data-action="open-city" data-city-id="{{id}}">
          {{#if image}}<img src="{{image}}" alt="">{{/if}}
          <strong>{{name}}</strong><span>{{state}} / {{regionName}} / {{cityType}}</span>
        </button>
      {{/each}}
    </section>
    <section class="rm-public-economy-materials">
      <table class="rm-table">
        <thead><tr><th>Материал</th><th>Базовая цена</th><th>Единица</th><th>Мировой дефицит</th></tr></thead>
        <tbody>{{#each materialRows}}<tr><td>{{name}}</td><td>{{rmNum basePriceGold}} зм</td><td>{{rmNum baseWeight}} фнт.</td><td>{{#if hasWorldDeficit}}{{rmNum worldDeficit}}{{else}}—{{/if}}</td></tr>{{/each}}</tbody>
      </table>
    </section>
  </section>
  <!-- public-economy:end -->
{{/if}}
```

Wrap this branch and the current template with `{{#if isPublicView}}` / `{{else}}`; the current GM branch remains byte-for-byte where practical. Player markup must not reference `production`, `demand`, `netBalance`, `priceModifierPercent`, state policy, routes, events or audit.

- [ ] **Step 5: Add scoped public economy styles**

Use `.rebreya-economy-app .rm-public-economy-*` selectors. City cards keep the existing economy density, gain a restrained 2:1 thumbnail, and stack cleanly on narrow Foundry windows. Do not add a second stylesheet.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
node --test tests/economy-public-ui.test.mjs tests/public-economy-read-model.test.mjs tests/bg3-hotbar-compat.test.mjs tests/style-theme.test.mjs tests/background-refresh-focus.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Record the role-aware Economy context in the passport**

In section 19 update `EconomyApp._prepareContext()` data flow, the player-safe early branch, safe filters, public Scene Controls launcher and focused tests `tests/economy-public-ui.test.mjs` / `tests/bg3-hotbar-compat.test.mjs`.

- [ ] **Step 8: Commit the public economy interface**

```powershell
git add -- scripts/application/public-economy-read-model.js scripts/ui/economy-app.js scripts/hooks.js templates/economy-app.hbs styles/main.css tests/public-economy-read-model.test.mjs tests/economy-public-ui.test.mjs tests/bg3-hotbar-compat.test.mjs tests/style-theme.test.mjs docs/function-passport.md
git diff --cached --check
git commit -m "feat: add player economy view"
```

---

### Task 7: Make both travel summary cities open the canonical City app

**Files:**
- Modify: `templates/inventory-app.hbs:586-593`
- Modify: `tests/inventory-app-context.test.mjs:2570-2620`

**Interfaces:**
- Consumes: existing `travel.originCityId`, `travel.destinationCityId`, `travel.plan.originName`, `travel.plan.destinationName`, and existing `travel-open-city` handler.
- Produces: two summary buttons that delegate `openCityApp(cityId)`; existing per-leg links remain.

- [ ] **Step 1: Extend the focused travel test and verify RED**

Add a template contract asserting both summary IDs are wired:

```js
assert.match(template, /data-action="travel-open-city" data-city-id="{{travel\.originCityId}}">{{travel\.plan\.originName}}<\/button>/u);
assert.match(template, /data-action="travel-open-city" data-city-id="{{travel\.destinationCityId}}">{{travel\.plan\.destinationName}}<\/button>/u);
```

Extend the existing fake-button handler test to click origin and destination buttons and expect:

```js
assert.deepEqual(
  calls.filter((call) => call[0] === "openCityApp"),
  [["openCityApp", "origin-city"], ["openCityApp", "destination-city"]]
);
```

Run:

```powershell
node --test tests/inventory-app-context.test.mjs
```

Expected: the summary markup assertion fails because the names are currently `<strong>` elements.

- [ ] **Step 2: Replace summary labels with canonical action buttons**

In `templates/inventory-app.hbs` replace only the two summary `<strong>` elements:

```hbs
<button type="button" class="rm-link-button rm-travel-city-link" data-action="travel-open-city" data-city-id="{{travel.originCityId}}">{{travel.plan.originName}}</button>
<span>→</span>
<button type="button" class="rm-link-button rm-travel-city-link" data-action="travel-open-city" data-city-id="{{travel.destinationCityId}}">{{travel.plan.destinationName}}</button>
```

Do not add a second DOM listener; reuse the existing handler in `scripts/ui/inventory-app.js:5793-5800`.

- [ ] **Step 3: Run focused tests and verify GREEN**

```powershell
node --test tests/inventory-app-context.test.mjs tests/city-public-ui.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 4: Commit the travel entry points**

```powershell
git add -- templates/inventory-app.hbs tests/inventory-app-context.test.mjs
git diff --cached --check
git commit -m "feat: link travel cities to public views"
```

---

### Task 8: Finish documentation, regression coverage, and full verification

**Files:**
- Modify: `README.md` sections “ApplicationV2-окна”, “Публичный API”, “Persisted state” and extension rules
- Modify: `docs/function-passport.md` sections 3, 5 and 19
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/background-refresh-focus.test.mjs`
- Modify: `tests/style-theme.test.mjs`

**Interfaces:**
- Consumes: final method names and behavior from Tasks 1-7.
- Produces: current-state documentation and one verified feature commit range on `lich_branch`.

- [ ] **Step 1: Add final regression assertions before documentation edits**

Ensure the focused suites explicitly assert:

```js
// one canonical City app registry and one canonical Trader route
assert.doesNotMatch(mainSource, /publicCityApps|playerCityApps|new PublicCityApp/u);
assert.match(mainSource, /return this\.openTraderV2\(cityId, traderKey, options\)/u);

// public templates never display the forbidden mechanics
function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}
const publicTemplateBranch = between(
  economyTemplate,
  "<!-- public-economy:start -->",
  "<!-- public-economy:end -->"
);
for (const forbidden of ["priceModifierPercent", "selfSufficiencyRate", "routePriceModifierPercent"]) {
  assert.equal(publicTemplateBranch.includes(forbidden), false, forbidden);
}
```

Run all feature-focused tests once and confirm any new assertion fails for a real missing contract before changing production or docs.

- [ ] **Step 2: Update README and finish the function passport**

Document:

- player/GM split in the existing Economy and City apps;
- public Economy launcher in the existing Scene Controls group;
- actual city material price versus base price in global economy;
- unrestricted viewing and remote trader access;
- `getPublicCitySnapshot`, `getPublicEconomySnapshot`, `getCityPresentation`, `updateCityPresentation`, `resetCityPresentation`;
- `cityPresentationOverrides` ownership and reset behavior;
- existing travel source/target links;
- focused test files and `refreshCityViews` scope.

The passport must describe current state, not implementation history. Confirm every new/changed method signature matches production exactly.

- [ ] **Step 3: Run the complete project verification once on unchanged HEAD**

```powershell
node --test tests/*.test.mjs
git diff --check

$scriptFiles = git ls-files '*.js' '*.mjs'
foreach ($scriptFile in $scriptFiles) { node --check $scriptFile }

$jsonFiles = git ls-files '*.json'
foreach ($jsonFile in $jsonFiles) { Get-Content -Raw -Encoding UTF8 $jsonFile | ConvertFrom-Json | Out-Null }
```

Record totals as passed/failed/skipped and list only real errors. Do not rerun the full suite unless HEAD changes after this command.

- [ ] **Step 4: Review the complete task diff**

```powershell
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- data/cities.json scripts/constants.js scripts/settings.js scripts/data/repository.js scripts/application/public-economy-read-model.js scripts/main.js scripts/hooks.js scripts/ui/city-presentation-ui.js scripts/ui/city-app.js scripts/ui/economy-app.js templates/city-app.hbs templates/economy-app.hbs templates/inventory-app.hbs styles/main.css README.md docs/function-passport.md
```

Confirm no unrelated work, no second City/Trader app, no player context leakage, no direct setting write from UI, no missing passport method and no corrupted Cyrillic.

- [ ] **Step 5: Commit documentation and final regression contracts**

```powershell
git add -- README.md docs/function-passport.md tests/main-composition-root.test.mjs tests/background-refresh-focus.test.mjs tests/style-theme.test.mjs
git diff --cached --check
git commit -m "docs: document public city surfaces"
```

- [ ] **Step 6: Push the completed branch without force**

```powershell
git status --short --branch
git push -u origin lich_branch
```

Expected: branch is synchronized with `origin/lich_branch`, working tree is clean, and the final report names the commit range and verification totals.
