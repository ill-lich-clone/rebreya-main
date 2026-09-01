# Top-Down Item Textures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить 1015 уникальных прозрачных top-down WebP для canonical gear/material Item и использовать их только для одиночных ground-pile токенов.

**Architecture:** Tracked JSON manifest и build-time tool владеют asset coverage, atlas layout, обработкой и generated runtime-каталогом. Чистый resolver выбирает texture по module-owned `gearId`/`materialId`, а существующий `deriveGroundPilePresentation()` применяет её только в single ordinary branch; world-state по-прежнему изменяет только `StorageGroundPileService`.

**Tech Stack:** Node.js ESM/test runner, Foundry VTT 13, dnd5e, ImageMagick 7, FFmpeg 8, rembg fallback, WebP 512×512 с alpha.

**Spec:** `docs/superpowers/specs/2026-09-01-top-down-item-textures-design.md`

## Global Constraints

- Работать и коммитить только в `lich_branch`; force push запрещён.
- Не менять stable `gearId`, `materialId`, UUID, document IDs или `Item.img`.
- Не создавать новый canvas-drop hook, socket route или world-state owner.
- Multi-item piles, coin/journal presentations и built-in storage preset textures должны остаться без изменений.
- Runtime fallback обязан сохранить текущую `row.img ?? row.itemData.img ?? generic` цепочку.
- Новых flags не вводить.
- Production code писать только после наблюдаемого RED focused-теста.
- Live QA не выполнять на этом этапе по прямому указанию пользователя; оставить его явно pending.

---

### Task 1: Manifest contract and deterministic coverage

**Files:**
- Create: `tools/top-down-items/manifest.mjs`
- Create: `tests/top-down-item-manifest.test.mjs`
- Create/generated: `data/top-down-item-assets.json`

**Interfaces:**
- Produces: `buildCanonicalTopDownEntries({ gear, materials }) -> entry[]`
- Produces: `synchronizeTopDownManifest({ manifest, gear, materials }) -> manifest`
- Produces: `validateTopDownManifest({ manifest, gear, materials }) -> true` or throws diagnostics
- Manifest key: `${sourceType}:${sourceId}`; stable atlas assignment: `atlasId`, `cellIndex`.

- [ ] **Step 1: Write RED coverage and stability tests**

  Add literal assertions that actual catalogs yield 1015 unique keys, 41 primary atlases, fixed cell indexes `0..24`, exact paths `assets/top-down/items/<type>/<id>.webp`, and that synchronizing an existing accepted entry preserves its atlas/cell/status/hash. Add failures for duplicate key/path, unknown active ID and missing canonical ID.

- [ ] **Step 2: Verify RED**

  Run: `node --test tests/top-down-item-manifest.test.mjs`

  Expected: FAIL because `tools/top-down-items/manifest.mjs` does not exist.

- [ ] **Step 3: Implement the minimal manifest module**

  Use this public shape:

  ```text
  TOP_DOWN_MANIFEST_SCHEMA_VERSION = 1
  TOP_DOWN_ATLAS_CAPACITY = 25
  topDownEntryKey(entry) -> "<sourceType>:<sourceId>"
  buildCanonicalTopDownEntries({ gear, materials }) -> TopDownEntry[]
  synchronizeTopDownManifest({ manifest, gear, materials }) -> TopDownManifest
  validateTopDownManifest({ manifest, gear, materials }) -> true; invalid input throws Error with all diagnostics
  ```

  Initial entries use `status: "planned"`, `technicalQa: "pending"`, `visualQa: "pending"`, empty hashes, deterministic `primary-001`…`primary-041`, and a prompt input derived from canonical name/type/description without changing stable IDs.

- [ ] **Step 4: Verify GREEN and generate manifest**

  Run focused test, then run a small Node ESM command importing the module and writing pretty JSON plus final newline to `data/top-down-item-assets.json`. Re-run the focused test against the generated file.

- [ ] **Step 5: Commit the independently valid manifest layer**

  Stage only the three Task 1 files and commit `feat: add top-down item asset manifest`.

### Task 2: Atlas processing and asset validation tool

**Files:**
- Create: `tools/top-down-items/image-processing.mjs`
- Create: `tools/top-down-item-assets.mjs`
- Create: `tests/top-down-item-processing.test.mjs`

**Interfaces:**
- Consumes: manifest schema from Task 1.
- Produces: `atlasCellGeometry({ atlasSize, cellIndex })`.
- Produces: `validateProcessedAsset(metadata, entry)`.
- CLI commands: `plan`, `process-atlas`, `validate`, `generate-runtime-catalog`, `contact-sheet`.

- [ ] **Step 1: Write RED geometry and QA tests**

  Assert literal crop rectangles for a 3000×3000 5×5 atlas, reject non-divisible atlas sizes, invalid cells, non-WebP/512×512/no-alpha/empty/bbox-near-edge metadata, duplicate hashes and gutter intersections. Assert scale classes map to fixed occupancy limits.

- [ ] **Step 2: Verify RED**

  Run: `node --test tests/top-down-item-processing.test.mjs`

  Expected: FAIL because the processing module is missing.

- [ ] **Step 3: Implement pure geometry/validation, then CLI orchestration**

  `process-atlas` must normalize once, crop mathematically, chroma-key per cell, trim alpha, scale into transparent 512×512 and write lossless WebP. It must refuse accepted-file overwrite unless `--force`. External commands are invoked through `spawnSync` with argument arrays, never shell-built strings.

- [ ] **Step 4: Verify GREEN with a synthetic 5×5 atlas**

  Generate the fixture in a temporary directory with ImageMagick, process it, then assert the real output metadata and deterministic paths. Delete only the verified temporary directory after the test.

- [ ] **Step 5: Commit the processing tool**

  Stage only Task 2 files and commit `feat: add deterministic top-down atlas pipeline`.

### Task 3: Generate and approve all production assets

**Files:**
- Modify: `data/top-down-item-assets.json`
- Create: `assets/top-down/items/gear/*.webp`
- Create: `assets/top-down/items/material/*.webp`
- Local resumable inputs: ignored task-specific atlas workspace outside the repository.

**Interfaces:**
- Consumes: `node tools/top-down-item-assets.mjs plan` batch prompts and layouts.
- Produces: 1015 manifest entries with `status: "accepted"`, passing technical and visual QA, unique content hashes.

- [ ] **Step 1: Generate each planned 5×5 atlas**

  For every pending `atlasId`, generate the exact 25 named cells in current pile-art style: strict orthographic 90° overhead, objects lying flat, solid chroma background, no text/frame/out-of-cell shadow/neighbor overlap. The final primary atlas has 15 populated and 10 explicitly empty cells.

- [ ] **Step 2: Process and technically validate each atlas immediately**

  Run `process-atlas`, then `validate`. Reject cells touching gutters, losing alpha details, becoming empty, or violating scale-class occupancy. Retry failures in append-only retry atlases; do not accept approximations.

- [ ] **Step 3: Perform visual camera/identity QA using contact sheets**

  Inspect every contact sheet. Mark accepted only when the image is truly overhead and matches the exact ID; front/three-quarter objects, baked checkerboard, halos, clipped silhouettes, wrong identities and near-duplicates are rejected and regenerated.

- [ ] **Step 4: Verify complete production coverage**

  Run: `node tools/top-down-item-assets.mjs validate`

  Expected: 1015 accepted, 0 pending/rejected/missing/duplicate, 745 gear, 270 material, all 512×512 WebP with alpha.

- [ ] **Step 5: Commit assets in bounded batches**

  Commit completed atlas batches with explicit file lists; never `git add -A`. Final asset commit message: `assets: complete unique top-down item set`.

### Task 4: Generated runtime catalog and identity resolver

**Files:**
- Create/generated: `scripts/data/top-down-item-texture-catalog.js`
- Create: `scripts/data/top-down-item-texture-resolver.js`
- Create: `tests/top-down-item-texture-resolver.test.mjs`

**Interfaces:**
- Produces: `TOP_DOWN_ITEM_TEXTURES: ReadonlyMap<string,string>`.
- Produces: `resolveTopDownItemTexture(row, { textures = TOP_DOWN_ITEM_TEXTURES } = {}) -> string | null`.

- [ ] **Step 1: Write RED resolver tests**

  Use real row objects. Assert distinct literal paths for `rapira`, `dlinnyy-mech`, `adamantovaya-pulya-10` and `ekspansivnye-puli-5`, material lookup, support for old gear flags with `gearId` but no flag `sourceId`, rejection of conflicting identities, unknown IDs and external Item without module identity. Assert no input mutation.

- [ ] **Step 2: Verify RED**

  Run: `node --test tests/top-down-item-texture-resolver.test.mjs`

  Expected: FAIL because resolver/catalog exports do not exist.

- [ ] **Step 3: Generate catalog and implement minimal resolver**

  Generate only accepted manifest entries. Normalize strings without name inference. Require module `sourceType` and at least one matching canonical identity; if multiple available IDs disagree, return `null`.

- [ ] **Step 4: Verify GREEN and determinism**

  Run resolver test and `node tools/top-down-item-assets.mjs generate-runtime-catalog`; a second generation must produce no diff.

- [ ] **Step 5: Commit runtime lookup layer**

  Stage Task 4 files and commit `feat: resolve top-down ground item textures`.

### Task 5: Single-item ground-pile integration through focused TDD

**Files:**
- Modify: `scripts/data/storage-pile-presentation.js`
- Modify: `tests/storage-pile-presentation.test.mjs`
- Modify: `tests/storage-ground-pile-service.test.mjs`
- Modify only if a real regression needs coverage: `tests/builtin-storage-presets.test.mjs`

**Interfaces:**
- Consumes: `resolveTopDownItemTexture(row)` from Task 4.
- Preserves: `deriveGroundPilePresentation(rows, options)` public signature and all non-single branches.

- [ ] **Step 1: Write RED presentation tests**

  Assert a managed single gear/material uses its unique top-down path while unknown/external single rows retain current Item image. Assert same-category and mixed two-row piles retain exact existing category paths, and coin/journal results remain exact.

- [ ] **Step 2: Verify RED**

  Run: `node --test tests/storage-pile-presentation.test.mjs`

  Expected: only new managed-single assertions fail because current code returns `row.img`.

- [ ] **Step 3: Implement the one-branch production change**

  Import the resolver with the new release query suffix and change only single ordinary image selection:

  ```js
  img: resolveTopDownItemTexture(row)
    ?? (clean(row.img ?? row.itemData?.img) || GENERIC_PRESENTATION.img)
  ```

  Do not alter the multi-item, coin or journal branches.

- [ ] **Step 4: Add service-level RED/GREEN regression cases**

  Add real service harness cases for create single, merge to existing category/mixed texture, remove back to survivor top-down, duplicate mutation idempotency, coins and preset/container texture preservation. Run focused tests after each RED/GREEN cycle.

- [ ] **Step 5: Run the focused storage contour and commit**

  Run:

  ```powershell
  node --test tests/top-down-item-texture-resolver.test.mjs tests/storage-pile-presentation.test.mjs tests/storage-ground-pile-service.test.mjs tests/builtin-storage-presets.test.mjs
  ```

  Commit `feat: use top-down textures for single ground items`.

### Task 6: Passport, release version and automated verification

**Files:**
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.207.js`
- Modify import query suffixes in touched runtime files as required by repository cache conventions.

**Interfaces:**
- Documents all new/changed method signatures, owner, data flow, constraints and focused tests.
- `scripts/main-1.4.207.js` contains only `import "./main.js";`.

- [ ] **Step 1: Update function passport**

  Update only the storage/ground-pile section with manifest/catalog tool contracts, `resolveTopDownItemTexture`, changed single-item texture precedence, unchanged multi/coin/preset rules and focused tests.

- [ ] **Step 2: Bump version and forwarder**

  Set `module.json.version` to `1.4.207`, set `esmodules` to `scripts/main-1.4.207.js`, create the forwarder, and ensure no runtime configuration references `main-1.4.206.js`.

- [ ] **Step 3: Run complete automated verification once on unchanged HEAD**

  Run the exact `AGENTS.md` Node tests, JS syntax checks, JSON parsing and `git diff --check`. Also run `node tools/top-down-item-assets.mjs validate`.

- [ ] **Step 4: Review diff and commit/push**

  Inspect `git diff --stat` and substantive diff, stage only task files, commit `feat: add unique top-down ground item textures`, and push `lich_branch` without force.

- [ ] **Step 5: Record deferred live QA**

  Report automated passed/failed counts and explicitly state that Foundry GM/player live QA remains pending by user instruction; do not claim the full specification criterion “live QA passed”.
