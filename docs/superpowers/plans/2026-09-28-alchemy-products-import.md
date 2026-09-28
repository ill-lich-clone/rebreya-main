# Alchemy Products Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended when the user explicitly selects subagent execution) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the revised ordinary-equipment source without stable-ID churn and add a managed Foundry compendium containing all 230 alchemical products, their player-visible text mechanics, deterministic prices/rarities/weights, and 460 unique generated images.

**Architecture:** Two offline import paths own source ingestion. The existing equipment importer remains the only owner of ordinary gear and moves to `Взрывчатка V0.1`; a new narrow alchemy CLI reads one fixed Google Sheets range and writes `data/alchemy-products.json`. Runtime loads that neutral catalog into the existing economy model, then one `AlchemyCompendiumService` projects it into a managed dnd5e Item pack through the existing folder and managed-sync infrastructure. Image generation is an offline, manifest-driven 5×5 workflow; only final WebP assets and the reviewed manifest enter runtime data.

**Tech Stack:** Node.js ESM, built-in `node:test`, Google Sheets v4 through the existing read-only client, Foundry VTT 13, dnd5e consumable Items, existing managed compendium utilities, `gpt-6-luna` image workers, and `ffmpeg`/`ffprobe` 8.1.1.

**Spec:** `docs/superpowers/specs/2026-09-28-alchemy-products-import-design.md`

## Global Constraints

- Work only on `lich_branch`. Before the first edit and again before the final push run the repository Git preflight from `AGENTS.md`; stop on foreign uncommitted changes, a remote `lich_branch` lead, or a conflicting `origin/main` update.
- Current planned release is `1.4.339` from `1.4.338`. If `module.json` has advanced before execution, allocate the next patch version and substitute it consistently instead of reusing `1.4.339`.
- Keep this release text-only mechanically: no Activities, Active Effects, application hooks, actor flags, reagent counters, crafting UI, sockets, or automatic rolls.
- Players always see the complete recipe, including the field named `Частный катализатор`; do not create a GM-only description block.
- Use source number `№`, never physical row, as alchemy identity. Canonical IDs are `alchemy-<№>` and document IDs come from `createStableGearDocumentId()`.
- The approved alchemy number set is `1..234` excluding exactly `36`, `52`, `67`, and `76`. They were the early duplicates of retained `221` (`Масло ускользания [Oil of slipperiness]`), `226` (`Масло эфирности [Oil of etherealness]`), `227` (`Масло остроты [Oil of sharpness]`), and `135` (`Яд вурдалака`), respectively. No other gap or duplicate is accepted.
- Keep exact source type values limited to `Зелье`, `Вещество`, `Яд (Оружейный)`, `Яд (Поглощаемый)`, `Яд (Вдыхаемый)`, `Яд (Контактный)`, `Бомба`, `Масло`, and `Побочный продукт`.
- Price strings may normalize whitespace and `×` to `*`, but the formula for a rank must otherwise match the approved table exactly. Foundry stores the maximum gp value; the source formula appears in the description and flags.
- Weight is the rank in pounds. Rarity is rank-derived and not independently editable.
- Generate images only as 1254×1254 5×5 grids. Repairs are also grids. Never stretch X and Y independently; crop the visible bounds, pad the shorter axis to a square, then scale uniformly to 512×512.
- Only `gpt-6-luna` subagents generate image grids. Give every worker disjoint grid IDs and paths. The root agent owns manifest order, visual review, crop coordinates, final validation, commits, and all architectural decisions.
- Intermediate grids live under ignored `tmp/alchemy-image-grids/` and are not runtime dependencies. Commit final WebP files and `data/alchemy-image-assets.json` only.
- Update the relevant `docs/function-passport.md` section in the same commit as every new or changed function contract. Update `README.md` for public CLI usage.
- Add focused tests before implementation, run them RED then GREEN, and do not weaken existing importer or managed-sync guards.

## Locked File Map

```text
tools/import-alchemy-products.mjs                 # sole alchemy import CLI
tools/alchemy-import/source.mjs                   # fixed sheet/range/column boundary
tools/alchemy-import/parsers.mjs                  # strict number/formula/null parsing
tools/alchemy-import/adapter.mjs                  # 22 cells -> neutral product record
tools/alchemy-import/catalog.mjs                  # whole-catalog invariants
tools/alchemy-import/diff.mjs                     # dry-run report/removal guards
tools/alchemy-import/serialization.mjs            # deterministic JSON + atomic single-file write
data/alchemy-products.json                        # canonical 230-product runtime catalog

tools/alchemy-images.mjs                          # plan/process/validate/contact-sheet CLI
tools/alchemy-images/manifest.mjs                 # deterministic 5×5 allocation and QA state
tools/alchemy-images/processing.mjs               # ffmpeg crop/pad/scale and ffprobe checks
data/alchemy-image-assets.json                     # reviewed grid/crop/hash manifest
templates/icons/Alchemy/*.webp                    # 230 Foundry icons
assets/top-down/items/alchemy/*.webp               # 230 transparent top-down images

scripts/data/alchemy-product-rules.js              # reviewed text-only global/type rules
scripts/data/alchemy-compendium.js                 # dnd5e projection and managed pack owner
tests/fixtures/alchemy-import/*.json               # compact/live formatted-value fixtures
tests/alchemy-*.test.mjs                           # focused import/runtime/image tests
```

Do not add a second equipment importer, a second managed-sync implementation, a new application service, or a new startup hook. Reuse `tools/equipment-import/google-sheets-client.mjs`, `scripts/data/compendium-utils.js`, `scripts/data/gear-document-ids.js`, and `scripts/data/managed-compendium-sync.js`.

## Review Focus

1. **Stable gear identity:** moving rows or renaming the explosives tab may update `sourceRef`, but every surviving `sourceIdentity` must retain its previous `id`; only the two approved ordinary items may disappear.
2. **Strict alchemy source:** exactly 230 rows, 22 cells, the approved number set, exact type vocabulary, and rank-bound formula mapping must be checked before writing JSON.
3. **Player-visible projection:** descriptions must escape sheet text, show every non-empty recipe/mechanics field and the original price formula, and contain no secret block, Activity, or Active Effect.
4. **Image integrity:** manifest order must match numeric product order; each visible object/frame gets reviewed crop coordinates; non-square crops are padded, never distorted; all 460 final hashes must be unique.
5. **Idempotent world sync:** rerunning startup must produce no duplicate documents or folders, must delete only stale managed alchemy documents, and must preserve unmanaged documents even when names collide.

---

### Task 1: Migrate ordinary gear to the revised sheets without identity churn

**Files:**

- Modify: `module.json`
- Create: `scripts/main-1.4.339.js` with exactly `import "./main.js";`
- Modify: `tools/equipment-import/sheet-registry.mjs`
- Modify: `tools/top-down-item-assets.mjs`
- Modify: `tests/equipment-import-gear-profiles.test.mjs`
- Modify: `tests/equipment-import-pipeline.test.mjs`
- Modify: `tests/equipment-import-base-gear.test.mjs`
- Modify: `tests/equipment-import-cli.test.mjs`
- Modify: `tests/top-down-item-manifest.test.mjs`
- Modify: `tests/top-down-item-processing.test.mjs`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/fixtures/equipment-import/cli-workbook-snapshot.json`
- Regenerate: `data/gear.json`
- Regenerate: `data/top-down-item-assets.json`
- Regenerate: `scripts/data/top-down-item-texture-catalog.js`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
SHEET_REGISTRY.explosives.sheetTitle === "Взрывчатка V0.1";

// New maintenance command, using the existing pure synchronizer.
node tools/top-down-item-assets.mjs sync
```

- [ ] **Write regression tests first.** Change fixture/test source refs to `Взрывчатка V0.1` and add a before/after fixture where ordinary rows shift after removing `Кислота (флакон)` and `Алхимический огонь (фляга)`. Assert the two names are removed, all surviving `sourceIdentity -> id` pairs are unchanged, and `identityChurn.length === 0`.
- [ ] Add a CLI test showing the first dry-run is blocked only by `removals-not-allowed` for two records, not by `identity-churn`, `large-removal`, additions, or unrelated deletions.
- [ ] Add `sync` to `tools/top-down-item-assets.mjs`: call `synchronizeTopDownManifest({manifest,gear,materials})`, validate the result, write it atomically, and report added/updated/removed counts. Test that removed canonical gear entries leave the manifest while accepted surviving assets retain QA/hash/placement and receive current `sourceRef`.
- [ ] Run RED:

  ```powershell
  node --test tests/equipment-import-base-gear.test.mjs tests/equipment-import-gear-profiles.test.mjs tests/equipment-import-pipeline.test.mjs tests/equipment-import-cli.test.mjs tests/top-down-item-manifest.test.mjs tests/top-down-item-processing.test.mjs tests/module-manifest.test.mjs
  ```

  Expected: failures for the old sheet title, absent shifted-row regression, missing `sync` command, and old release entrypoint.
- [ ] Set the explosives title to `Взрывчатка V0.1`; update only source-coordinate fixtures, never stable identity keys. Bump the module to the selected release version and add its one-line forwarder without deleting older compatibility forwarders.
- [ ] Run a live dry-run without deletion permission:

  ```powershell
  node tools/import-equipment.mjs
  ```

  Expected gear diff: `+0`, `-2`, `churn:0`; removals are exactly the two approved names. Stop if any other add/remove or churn appears.
- [ ] Apply only after reviewing that report:

  ```powershell
  node tools/import-equipment.mjs --apply --allow-removals
  node tools/top-down-item-assets.mjs sync
  node tools/top-down-item-assets.mjs generate-runtime-catalog
  node tools/top-down-item-assets.mjs validate
  ```

  Expected: `data/gear.json` has 806 rows; the combined legacy top-down manifest has 1418 accepted entries (806 gear + 612 materials); old acid/fire assets may remain unreferenced but no runtime manifest entry remains.
- [ ] Verify scoped stale-title removal:

  ```powershell
  rg -n "Взрывчатка V0\.0" tools/equipment-import data/gear.json data/top-down-item-assets.json tests --glob 'equipment-import-*'
  ```

  Expected: no matches. Historical design documents are not rewritten.
- [ ] Update the equipment/top-down passport contracts and run GREEN for the focused set.
- [ ] Checkpoint:

  ```powershell
  git add module.json scripts/main-1.4.339.js tools/equipment-import/sheet-registry.mjs tools/top-down-item-assets.mjs tests/equipment-import-gear-profiles.test.mjs tests/equipment-import-pipeline.test.mjs tests/equipment-import-base-gear.test.mjs tests/equipment-import-cli.test.mjs tests/top-down-item-manifest.test.mjs tests/top-down-item-processing.test.mjs tests/module-manifest.test.mjs tests/fixtures/equipment-import/cli-workbook-snapshot.json data/gear.json data/top-down-item-assets.json scripts/data/top-down-item-texture-catalog.js docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "feat: sync revised ordinary gear catalog"
  git push -u origin lich_branch
  ```

### Task 2: Define the strict alchemy source and row adapter

**Files:**

- Create: `tools/alchemy-import/source.mjs`
- Create: `tools/alchemy-import/parsers.mjs`
- Create: `tools/alchemy-import/adapter.mjs`
- Create: `tools/alchemy-import/catalog.mjs`
- Create: `tests/alchemy-import-adapter.test.mjs`
- Create: `tests/fixtures/alchemy-import/products-formatted-values.json`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export const ALCHEMY_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
export const ALCHEMY_SHEET = Object.freeze({
  sheetId: 179310389,
  sheetTitle: "Алхимические продукты V1",
  range: "'Алхимические продукты V1'!A3:V996",
  dataStartRow: 3,
  width: 22
});
export const ALCHEMY_COLUMNS = Object.freeze([
  "sourceNumber", "name", "productType", "priceFormula", "rank", "reagentLevel",
  "effect", "catalystEffect", "fire", "water", "earth", "air", "positive", "negative",
  "mandatoryComponent", "craftingDc", "privateCatalyst", "activation", "duration",
  "requirements", "simplifiedCreation", "radiusOrEmanation"
]);

export function buildAlchemySourceSnapshot({ spreadsheetId, metadata, values });
export function normalizeAlchemyPriceFormula(value);
export function priceProfileForRank(rank);
export function adaptAlchemyRow(row);
export function adaptAlchemyCatalog(snapshot);
export function validateAlchemyCatalog(products);
```

The neutral record is locked to:

```js
{
  id, sourceNumber, name, productType, priceFormula, priceMaximumGp,
  rank, reagentLevel, effect, catalystEffect,
  aspects: { fire, water, earth, air, positive, negative },
  mandatoryComponent, craftingDc, privateCatalyst, activation,
  duration, requirements, simplifiedCreation, radiusOrEmanation,
  rarity, weight, icon, topDownImage, sourceRef
}
```

- [ ] Save a sanitized `FORMATTED_VALUE` fixture for A3:V996 with the 230 nonblank source rows and no credentials/metadata beyond spreadsheet ID, sheet ID/title, range, values, and deterministic fingerprint.
- [ ] Write tests for exact column positions A–V, row-number tracing, blank/`—` to `null`, significant `0` retention, strict integers, exact type vocabulary, and rejection of any non-string Google scalar.
- [ ] Parameterize ranks 1–9 and assert formula normalization, maximum gp, rarity, and `weight === rank`:

  ```js
  [
    [1, "(1d6+1) * 5", 35, "common"],
    [2, "(1d6+1) * 40", 280, "uncommon"],
    [3, "(1d6+1) * 50", 350, "uncommon"],
    [4, "(1d6+1) * 400", 2800, "rare"],
    [5, "(1d6+1) * 500", 3500, "rare"],
    [6, "(1d8+1) * 4000", 36000, "veryRare"],
    [7, "(1d8+1) * 5000", 45000, "veryRare"],
    [8, "2d6 * 10000", 120000, "veryRare"],
    [9, "2d6 * 12500", 150000, "legendary"]
  ];
  ```

- [ ] Assert that whitespace and `×` normalize, but a different die, multiplier, rank, or trailing text fails before serialization.
- [ ] Assert exactly 230 products, unique names and IDs, exact number set `1..234 - {36,52,67,76}`, and exact live type counts: 109 potions, 23 substances, 7 weapon poisons, 4 ingested poisons, 6 inhaled poisons, 2 contact poisons, 63 bombs, 15 oils, and 1 by-product.
- [ ] Assert physical row independence: moving the same source-number row changes only `sourceRef`; `id`, image paths, and future document ID remain stable.
- [ ] Run RED:

  ```powershell
  node --test tests/alchemy-import-adapter.test.mjs
  ```

  Expected: module-not-found.
- [ ] Implement only strict source/parse/adapt/catalog behavior. Use `canonicalCatalogId(name)` only for the filename slug; prefix paths with `sourceNumber` so equal or renamed slugs cannot collide:

  ```text
  templates/icons/Alchemy/<№>-<slug>.webp
  assets/top-down/items/alchemy/<№>-<slug>.webp
  ```

  These are repository-relative canonical paths. `createAlchemyItemData()` prefixes them with `modules/rebreya-main/` when it builds Foundry `img` and `topDownImage` URLs.

- [ ] Run GREEN, update the passport with every exported signature and invariant, then checkpoint:

  ```powershell
  git add tools/alchemy-import/source.mjs tools/alchemy-import/parsers.mjs tools/alchemy-import/adapter.mjs tools/alchemy-import/catalog.mjs tests/alchemy-import-adapter.test.mjs tests/fixtures/alchemy-import/products-formatted-values.json docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "test: define alchemy product source contract"
  git push -u origin lich_branch
  ```

### Task 3: Build the dry-run-first alchemy importer and canonical catalog

**Files:**

- Create: `tools/import-alchemy-products.mjs`
- Create: `tools/alchemy-import/diff.mjs`
- Create: `tools/alchemy-import/serialization.mjs`
- Create: `tests/alchemy-import-cli.test.mjs`
- Create: `tests/alchemy-import-serialization.test.mjs`
- Create: `data/alchemy-products.json`
- Modify: `README.md`
- Modify: `docs/function-passport.md`

**Interfaces:**

```text
node tools/import-alchemy-products.mjs [--apply] [--allow-removals]
  [--credentials <path>] [--spreadsheet-id <id>]
  [--snapshot <path>] [--write-snapshot <path>] [--help]
```

```js
export function diffAlchemyCatalogs({ current, next });
export function evaluateAlchemyDiffGuards({ diff, allowRemovals });
export function serializeAlchemyCatalog(products);
export async function writeAlchemyCatalogAtomic({ cwd, content, fsImpl });
```

- [ ] Write CLI tests with injected client/filesystem/stdout/stderr. Cover default dry-run, help, unknown options, Google errors without secret leakage, snapshot mode, no-write validation failure, atomic rename failure, removal permission, and identity churn as an unconditional blocker.
- [ ] Write deterministic serialization tests: numeric source order, two-space JSON, final newline, stable output on a second run, and parse-after-write verification.
- [ ] Run RED:

  ```powershell
  node --test tests/alchemy-import-cli.test.mjs tests/alchemy-import-serialization.test.mjs
  ```

- [ ] Reuse only `loadGoogleServiceAccount()` and `createGoogleSheetsClient()` from the equipment importer. Resolve sheet metadata and require the approved `sheetId`/title before fetching the fixed formatted-value range. Do not fetch Google data during Foundry startup.
- [ ] Print a concise catalog diff with added/changed/unchanged/removed counts and per-record IDs. A stable source number changing canonical ID is always identity churn and cannot be bypassed. Any removal needs `--allow-removals`.
- [ ] Run the live dry-run, review 230 additions and zero removals/churn, then apply:

  ```powershell
  node tools/import-alchemy-products.mjs
  node tools/import-alchemy-products.mjs --apply
  node tools/import-alchemy-products.mjs
  ```

  Expected: first run reports `+230`; after apply, the second dry-run reports `+0 ~0 =230 -0 churn:0` and no file diff.
- [ ] Verify `data/alchemy-products.json` has exactly 230 records and no `36`, `52`, `67`, or `76`; inspect ranks 1, 6, 8, and 9 for correct formula/max/rarity/weight.
- [ ] Document CLI usage and text-only scope in README, update the passport, run GREEN, and checkpoint:

  ```powershell
  git add tools/import-alchemy-products.mjs tools/alchemy-import/diff.mjs tools/alchemy-import/serialization.mjs tests/alchemy-import-cli.test.mjs tests/alchemy-import-serialization.test.mjs data/alchemy-products.json README.md docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "feat: import alchemy product catalog"
  git push -u origin lich_branch
  ```

### Task 4: Create the manifest-driven 5×5 image processing pipeline

**Files:**

- Create: `tools/alchemy-images.mjs`
- Create: `tools/alchemy-images/manifest.mjs`
- Create: `tools/alchemy-images/processing.mjs`
- Create: `tests/alchemy-image-manifest.test.mjs`
- Create: `tests/alchemy-image-processing.test.mjs`
- Create: `data/alchemy-image-assets.json`
- Modify: `.gitignore` only if `tmp/alchemy-image-grids/` is not already ignored
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export const ALCHEMY_GRID_SIZE = 1254;
export const ALCHEMY_GRID_CAPACITY = 25;
export const ALCHEMY_NOMINAL_BOUNDARIES = Object.freeze([0, 251, 502, 752, 1003, 1254]);

export function buildAlchemyImageManifest(products);
export function synchronizeAlchemyImageManifest({ manifest, products });
export function validateAlchemyImageManifest({ manifest, products, moduleRoot, requireAccepted });
export function computeSquarePad({ width, height });
export function buildFfmpegFilter({ crop, pad, kind });
export function inspectProcessedAlchemyImage(path);
```

CLI:

```text
node tools/alchemy-images.mjs plan --grid-id <id>
node tools/alchemy-images.mjs process-grid --grid-id <id> --source <1254x1254.png>
node tools/alchemy-images.mjs contact-sheet --kind <icon|topDown> --output <path>
node tools/alchemy-images.mjs validate [--require-accepted]
```

- [ ] Write manifest tests for numeric product order; 10 primary grids per kind; nine full grids plus five populated cells in grid 10; stable `icon-primary-001..010` and `topdown-primary-001..010` IDs; disjoint cells; expected output paths; and 20 explicitly empty trailing cells in each final primary grid.
- [ ] Write validation tests for missing/duplicate product assignments, crossing the nominal neighbor region, absent/invalid reviewed crop bounds, two objects in one cell (represented as failed visual QA), stale hashes, duplicate final hashes, and any accepted entry whose file does not exist.
- [ ] Write crop math tests for square, portrait 1:1.2, and landscape 1.2:1 visible boxes. Assert the filter first crops, then pads to `max(width,height)`, then uses one `scale=512:512` operation; reject filters that scale unequal source axes before padding.
- [ ] Test top-down padding as transparent RGBA and icon padding as a manifest-specified frame/background color. Use `ffprobe` assertions for 512×512 dimensions and alpha on every top-down output.
- [ ] Run RED:

  ```powershell
  node --test tests/alchemy-image-manifest.test.mjs tests/alchemy-image-processing.test.mjs
  ```

- [ ] Implement atomic manifest writes and `ffmpeg` execution with argument arrays, never shell-built command strings. `process-grid` must refuse an unreviewed crop and must update status/hash only after output verification.
- [ ] Initialize `data/alchemy-image-assets.json` from the 230-product catalog. Every entry starts `planned`/`pending`; no placeholder final file is accepted.
- [ ] Run GREEN, update the passport, and checkpoint tools plus the planned manifest:

  ```powershell
  git add tools/alchemy-images.mjs tools/alchemy-images/manifest.mjs tools/alchemy-images/processing.mjs tests/alchemy-image-manifest.test.mjs tests/alchemy-image-processing.test.mjs data/alchemy-image-assets.json .gitignore docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "feat: add alchemy image grid pipeline"
  git push -u origin lich_branch
  ```

### Task 5: Generate, review, and slice all 460 product images

**Files:**

- Modify repeatedly: `data/alchemy-image-assets.json`
- Create: `templates/icons/Alchemy/<№>-<slug>.webp` (230 files)
- Create: `assets/top-down/items/alchemy/<№>-<slug>.webp` (230 files)
- Temporary only: `tmp/alchemy-image-grids/*.png`

- [ ] Generate the manifest prompts for `icon-primary-001` and `topdown-primary-001`. Include the ordered 25 cell assignments verbatim, require exactly one object per populated cell, wide gutters, no text/watermarks, and exact 1254×1254 output.
- [ ] Spawn the first two image workers with `model: "gpt-6-luna"`, `fork_turns: "none"`, and explicit disjoint grid IDs/paths. Each worker must read the `imagegen` skill and may write only its assigned source grid under `tmp/alchemy-image-grids/`.
- [ ] Root visually inspects both pilot grids before scaling out: verify style against existing `templates/icons/Goods`, strict overhead/transparent presentation for top-down, correct cell order, one object per cell, and no boundary crossing.
- [ ] Within every ranked family, preserve one recognizable art direction while making every product/rank visibly unique through silhouette, materials, color, ornament, and effect intensity. A different file hash without a meaningful visual difference is not sufficient.
- [ ] Dispatch the remaining 18 primary grids in waves of at most three Luna workers (four total collaboration slots including root). Never let two workers own the same grid ID or manifest entries.
- [ ] For every returned grid, verify exact 1254×1254 dimensions, open a full-resolution preview, and mark each cell individually. Record visible-object/frame crop `{x,y,width,height}` and padding color/mode in the manifest; do not copy nominal 251-pixel cells as final crop bounds unless the visible border genuinely matches them.
- [ ] Put every rejected/missing/misordered product into the next 5×5 repair manifest. Fill unused repair cells as `EMPTY`; generate the repair grid through another Luna worker. Never request or accept a one-off image.
- [ ] After all entries pass visual QA, process grids with `ffmpeg` and inspect contact sheets:

  ```powershell
  node tools/alchemy-images.mjs contact-sheet --kind icon --output tmp/alchemy-icons-contact.webp
  node tools/alchemy-images.mjs contact-sheet --kind topDown --output tmp/alchemy-topdown-contact.webp
  node tools/alchemy-images.mjs validate --require-accepted
  ```

- [ ] Verify exactly 230 files in each final directory, 460 unique SHA-256 hashes, 512×512 dimensions, alpha on all top-down files, no image-path mismatch with `data/alchemy-products.json`, and no distorted visible aspect ratio.
- [ ] Commit in reviewable asset batches; never use `git add -A`:

  ```powershell
  git add templates/icons/Alchemy
  git diff --cached --check
  git diff --cached --stat
  git commit -m "assets: add alchemy foundry icons"
  git push -u origin lich_branch

  git add assets/top-down/items/alchemy data/alchemy-image-assets.json
  git diff --cached --check
  git diff --cached --stat
  git commit -m "assets: add alchemy top-down artwork"
  git push -u origin lich_branch
  ```

### Task 6: Load alchemy products into the canonical runtime model

**Files:**

- Modify: `scripts/data/importer.js`
- Modify: `scripts/data/normalizer.js`
- Modify: `scripts/engine/economy-engine.js`
- Create: `tests/alchemy-catalog-data.test.mjs`
- Modify: `tests/gear-catalog-sync.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function normalizeAlchemyProducts(rawAlchemyProducts);

// normalizeEconomyDataset result
dataset.alchemyProducts;

// buildEconomyModel result
model.alchemyProducts;
model.alchemyProductById;
```

- [ ] Write tests proving the loader treats `alchemy-products.json` as optional only when absent in a legacy/test base path, preserves every canonical field, rejects duplicate IDs, and builds a 230-entry `alchemyProductById` map in production data.
- [ ] Add production-data checks for both asset paths, exact number set, rank-derived values, and source rows. Do not make these tests depend on Google access.
- [ ] Run RED:

  ```powershell
  node --test tests/alchemy-catalog-data.test.mjs tests/gear-catalog-sync.test.mjs
  ```

- [ ] Add one optional fetch in `loadFromBasePath()`, normalize the neutral records without inventing defaults for required fields, and expose the array/map from `buildEconomyModel()`. Do not merge alchemy into ordinary `gear` or `gearById`.
- [ ] Run GREEN, update the importer/normalizer/model passport entries, and checkpoint:

  ```powershell
  git add scripts/data/importer.js scripts/data/normalizer.js scripts/engine/economy-engine.js tests/alchemy-catalog-data.test.mjs tests/gear-catalog-sync.test.mjs docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "feat: load alchemy product catalog"
  git push -u origin lich_branch
  ```

### Task 7: Project products into safe player-visible dnd5e Items

**Files:**

- Modify: `scripts/constants.js`
- Create: `scripts/data/alchemy-product-rules.js`
- Create: `scripts/data/alchemy-compendium.js`
- Create: `tests/alchemy-compendium.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export const ALCHEMY_COMPENDIUM_NAME = "rebreya-alchemy";
export const ALCHEMY_COMPENDIUM_LABEL = "Алхимия Ребреи";

export function getAlchemyTypeRules(productType);
export function resolveAlchemyConsumableSubtype(productType, validTypes);
export function buildAlchemyFolderPath(product);
export function buildAlchemyDescriptionHtml(product);
export function buildAlchemySignature(product);
export function createAlchemyItemData(product, folderIdByPath);
export class AlchemyCompendiumService {
  async sync(products = []);
}
```

- [ ] Transcribe the approved Google Doc rules into `alchemy-product-rules.js` as reviewed plain text grouped by applicable source type/subtype. Do not add behavior absent from the document and do not convert prose into automation.
- [ ] Write projection tests for subtype mapping: potions/oils -> `potion`, all four poison types -> `poison`, substances -> `food`, bombs/by-product -> `trinket`, with a validated runtime fallback if an installed dnd5e vocabulary lacks the preferred key. Preserve the exact source type in flags regardless of native mapping.
- [ ] Write folder tests for `Зелья/Ранг N`, `Масла/Ранг N`, `Вещества/Ранг N`, `Бомбы/Ранг N`, `Побочные продукты/Ранг N`, and `Яды/<подтип>/Ранг N`.
- [ ] Write description tests with malicious HTML-like source text. Assert escaping plus stable section order: effect; catalyst effect; activation/duration/requirements/zone; price formula; all recipe fields; applicable global/type rules. Empty fields omit their section, but no populated recipe field is hidden from players.
- [ ] Write Item-shape tests for `type: "consumable"`, stable `_id`, explicit icon, `system.price.value`, `system.price.denomination: "gp"`, rank weight, dnd5e rarity, `system.type`, zero Activities/Effects, observer pack ownership, `topDownImage`, all approved managed flags, and a signature covering every visible/source field plus template version.
- [ ] Write service tests using Foundry stubs: create/update/unchanged/delete stale managed; preserve unmanaged documents and name collisions; stable IDs across rename/source-row changes; build every desired document and validate both asset paths before the first pack mutation; no duplicate folders on rerun.
- [ ] Run RED:

  ```powershell
  node --test tests/alchemy-compendium.test.mjs
  ```

- [ ] Implement with `ensureCompendiumFolders()`, `ensurePackSidebarFolder()`, `createStableGearDocumentId()`, and `syncManagedDocuments()`. Do not copy their lifecycle logic. Pack metadata is `world.rebreya-alchemy`, Item-only, dnd5e, player observer, source book `Rebreya`.
- [ ] Run GREEN, update the passport, and checkpoint:

  ```powershell
  git add scripts/constants.js scripts/data/alchemy-product-rules.js scripts/data/alchemy-compendium.js tests/alchemy-compendium.test.mjs docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "feat: add managed alchemy compendium"
  git push -u origin lich_branch
  ```

### Task 8: Wire alchemy into the single startup composition root

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `docs/function-passport.md`

- [ ] Add failing composition tests for one `AlchemyCompendiumService` import/instance, one call to `sync(model.alchemyProducts)`, placement inside the active-GM managed-compendium batch, current release cache key, and an isolated warning path that does not prevent later compendia from syncing.
- [ ] Run RED:

  ```powershell
  node --test tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
  ```

- [ ] Import `alchemy-compendium.js` with the selected release cache key, instantiate it beside the existing materials/gear compendium owners, and sync after ordinary gear and before unrelated magic/action packs. Keep its `try/catch` separate.
- [ ] Do not add a hook, API method, socket route, setting, or UI surface. The existing `#syncManagedCompendia(model)` remains the only lifecycle owner.
- [ ] Run GREEN, update the composition passport entry, and checkpoint:

  ```powershell
  git add scripts/main.js tests/main-composition-root.test.mjs tests/module-manifest.test.mjs docs/function-passport.md
  git diff --cached --check
  git diff --cached --stat
  git diff --cached
  git commit -m "feat: sync alchemy compendium at startup"
  git push -u origin lich_branch
  ```

### Task 9: Run integration, asset, and idempotency verification

**Files:**

- Modify only if a real defect is found: files owned by Tasks 1–8 and their focused tests
- Regenerate if architecture source changed: `docs/rebreya-module-architecture.html`
- Final audit: `README.md`, `docs/function-passport.md`, `module.json`

- [ ] Run the focused integration cluster:

  ```powershell
  node --test tests/alchemy-*.test.mjs tests/equipment-import-*.test.mjs tests/top-down-item-*.test.mjs tests/gear-catalog-sync.test.mjs tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
  node tools/import-alchemy-products.mjs
  node tools/import-equipment.mjs
  node tools/alchemy-images.mjs validate --require-accepted
  node tools/top-down-item-assets.mjs validate
  ```

  Expected: all tests pass; both importer dry-runs have no semantic diff; both asset validators pass.
- [ ] Run the complete repository checks exactly as required:

  ```powershell
  node --test tests/*.test.mjs
  git diff --check

  $files = git ls-files '*.js' '*.mjs'
  foreach ($file in $files) { node --check $file }

  $json = git ls-files '*.json'
  foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
  ```

- [ ] Run `node tools/generate-architecture-map.mjs`; include the generated architecture snapshot only if the command reports a content change caused by the new service/data flow.
- [ ] Inspect production invariants with small read-only scripts: 230 alchemy records; 230 icon paths; 230 top-down paths; 460 unique final hashes; 806 ordinary gear records; no ordinary acid/fire names; no stale V0.0 refs in owned runtime/import/generated paths.
- [ ] Review the complete branch diff against the five Review Focus items and the design acceptance criteria. If fixes are needed, add the smallest focused regression, implement, rerun the affected focused set, then rerun the full checks.
- [ ] Commit any final generated documentation or verified fix explicitly and push; do not create an empty commit.

### Task 10: Validate in live Foundry and complete the branch

**Files:** none unless live validation exposes a defect.

- [ ] Start Foundry VTT 13 with dnd5e and the module at the selected release version. Log in as the active GM and wait for managed compendium synchronization.
- [ ] Confirm `world.rebreya-alchemy` is created under the intended sidebar folder with label `Алхимия Ребреи`, player observer access, exactly 230 managed Items, and no duplicate document IDs or folders.
- [ ] Inspect at least one rank-1, rank-6, rank-8, and rank-9 product plus one product of every source type. Confirm formula text, maximum numeric gp, rarity, weight, full visible recipe, type rules, icon, top-down flag, and no Activities/Effects.
- [ ] Confirm ordinary gear lacks `Кислота (флакон)` and `Алхимический огонь (фляга)`, while several items after each former row still have their pre-migration document IDs.
- [ ] Reload/restart once. Confirm the second sync is idempotent: 230 products, unchanged IDs, no duplicate folders, no spurious updates, and an intentionally added unmanaged test Item remains untouched. Remove only that disposable test Item afterward.
- [ ] If live Foundry is unavailable, report this single check as unverified; do not describe the release as live-validated.
- [ ] Re-run Git preflight/status, confirm the working tree is clean, and push the final `lich_branch`. Record commit IDs and exact passed/failed counts in the handoff.
- [ ] Use `superpowers:requesting-code-review` for the completed branch. Apply only verified findings, rerun affected tests, then use `superpowers:finishing-a-development-branch` to present integration options. Do not merge to `main` without a separate user instruction.

## Plan Self-Review Checklist

- [ ] Every acceptance criterion in the design spec maps to at least one implementation step and one test or live check above.
- [ ] The plan never derives identity from physical row for either surviving ordinary gear or alchemy products.
- [ ] The plan accounts for the existing top-down manifest/runtime catalog shrinking from 1420 to 1418 after the two ordinary-item removals.
- [ ] The plan makes all recipes player-visible and leaves mechanics as text only.
- [ ] The plan uses exact maximum prices, rank weights, rarity mapping, and the current 22-column sheet layout including price in column D.
- [ ] The plan mandates Luna grid generation, exact 1254×1254 5×5 sources, visible-boundary crops, repair grids, ffmpeg padding without distortion, and 460 final 512×512 WebPs.
- [ ] Runtime depends only on tracked local data/assets, not Google Drive, Sheets, image generation, or temporary grids.
- [ ] Version bump, one-line forwarder, function passport, README, focused tests, full checks, Git commits, pushes, review, and live Foundry validation are all explicit.
