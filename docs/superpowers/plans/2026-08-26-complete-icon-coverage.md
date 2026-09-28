# Complete Icon Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, slice, install, and wire 443 individual WebP icons so every document in the approved audit has individual artwork.

**Architecture:** Extend the existing `tools/icon-pipeline.py`; do not create another adapter. It consumes a deterministic target manifest, emits 18 row-major 5×5 prompts, applies each generated sheet with FFmpeg, and audits installed files. Existing named-icon lookup remains the runtime mechanism, with narrow additions for downtime, states, and transport.

**Tech Stack:** Python 3, existing `tools/icon-pipeline.py`, FFmpeg 8.1/FFprobe, built-in ImageGen, Foundry VTT 13 JavaScript ES modules, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-missing-icon-grid-pipeline-design.md`

## Global Constraints

- Work only in `lich_branch`; never force push.
- Do not create a new adapter; extend `tools/icon-pipeline.py`.
- Generate exactly 443 unique WebP targets in 18 strict row-major 5×5 sheets.
- Slice only with FFmpeg/FFprobe into 256×256 WebP.
- Never overwrite an existing individual icon implicitly.
- Do not change game rules, document IDs, advancement, sockets, permissions, or world-state.
- Generated source sheets and previews stay ignored under `tmp/imagegen/`.
- Update `docs/function-passport.md` for every changed or added method.

---

### Task 1: Existing pipeline target manifest

**Files:**
- Modify: `tools/icon-pipeline.py`
- Create: `tests/icon-pipeline.test.mjs`

**Interfaces:**
- Produces: CLI `grid-manifest --targets <json> --out <json>` and manifest schema `{version, targets, batches}`.
- Each target is `{targetId,name,category,context,outputRelPath}`; each batch target additionally has `{index,row,column}`.

- [ ] **Step 1: Write failing manifest tests**

Create Node tests that run the existing Python entrypoint with a small fixture manifest and assert deterministic row-major placement, stable batch IDs, rejection of duplicate `targetId`/`outputRelPath`, and Windows-safe paths. Add a production-manifest assertion for 443 unique targets and 18 batches.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/icon-pipeline.test.mjs`

Expected: FAIL because `grid-manifest` does not exist.

- [ ] **Step 3: Extend `tools/icon-pipeline.py` minimally**

Add manifest dataclasses and pure validators to the existing file. Reuse `normalize_icon_name()` and `sanitize_filename_stem()`. Batch placement must be:

```python
batch_index = target_index // 25
cell_index = target_index % 25
row = cell_index // 5
column = cell_index % 5
```

The command writes UTF-8 JSON atomically under `tmp/imagegen/` and never mutates source catalogs.

- [ ] **Step 4: Build the 443-target input from the approved audit**

Generate a temporary target list from the audited names. Map categories to `Backgrounds`, `Feats`, `Classes/<owner>`, `AbilitiesByRace/<race>`, `Actions`, `Downtime`, `States`, and `Transport`. Deduplicate repeated Craftsman names only inside the same output scope. Do not commit the temporary input or generated batch manifest.

- [ ] **Step 5: Run tests and production manifest validation**

Run:

```powershell
node --test tests/icon-pipeline.test.mjs
python tools/icon-pipeline.py grid-manifest --targets tmp/imagegen/icon-grid-targets.json --out tmp/imagegen/icon-grid-manifest.json
```

Expected: PASS; output reports `targets=443`, `batches=18`, last batch size `18`.

### Task 2: Prompt and FFmpeg application in the existing adapter

**Files:**
- Modify: `tools/icon-pipeline.py`
- Modify: `tests/icon-pipeline.test.mjs`

**Interfaces:**
- Produces: CLI `grid-prompt --manifest <json> --batch <id>` and `grid-apply --manifest <json> --batch <id> --image <path> [--overwrite]`.
- Consumes: manifest schema from Task 1 and installed `ffprobe`/`ffmpeg` executables.

- [ ] **Step 1: Add failing prompt/apply tests**

Assert that prompt output contains exactly the occupied names in numbered row-major order and the strict 5×5/no-text style contract. Generate a synthetic square test sheet, apply it, and assert the expected occupied output files are decodable WebP at exactly 256×256. Assert rejection of missing, corrupt, non-square input and an existing destination without `--overwrite`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test tests/icon-pipeline.test.mjs`

Expected: FAIL because `grid-prompt` and `grid-apply` do not exist.

- [ ] **Step 3: Implement prompt generation**

Build one concise ImageGen prompt with exact numbered subjects, consistent dark fantasy/gold-frame treatment, safe margins, strict grid geometry, and no text. The prompt must identify unused cells in the final batch as empty black cells.

- [ ] **Step 4: Implement FFprobe validation and one FFmpeg filter graph**

Probe width/height, require a non-zero square, scale once to `1280x1280`, split into occupied outputs, crop at `(column*256,row*256)`, and encode each mapped file with `libwebp` at 256×256. Create parent directories, write through temporary siblings, validate every result, then atomically rename. Do not mark success until all occupied outputs pass validation.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/icon-pipeline.test.mjs`

Expected: PASS.

### Task 3: Runtime named-icon owners

**Files:**
- Modify: `scripts/data/downtime-compendium.js`
- Modify: `scripts/data/states-compendium.js`
- Modify: `scripts/data/transport-compendium.js`
- Modify: `scripts/data/transport-actor-builder.js`
- Modify: `tests/downtime-compendium.test.mjs`
- Modify: `tests/states-compendium.test.mjs`
- Modify: `tests/transport-compendium.test.mjs`
- Modify: `tests/transport-actor-builder.test.mjs`

**Interfaces:**
- Downtime/states consume `Map<string,string>` from `buildNamedIconLookup()` and publish resolved `img` in managed document data/signatures.
- `buildTransportActorData(rawEntry, {iconLookup = null} = {})` resolves exact transport names before `resolveTransportDefaultArtwork(typeLabel)`.

- [ ] **Step 1: Write failing named-icon tests**

Add exact-name map fixtures and assert custom paths win while empty lookup preserves the existing fallback. Assert signatures change when only the resolved image changes.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```powershell
node --test tests/downtime-compendium.test.mjs tests/states-compendium.test.mjs tests/transport-compendium.test.mjs tests/transport-actor-builder.test.mjs
```

- [ ] **Step 3: Add minimal lookup wiring**

Follow the existing background/actions pattern. Search category folder first and module icon root second. Bump only the template/signature versions required to refresh managed documents.

- [ ] **Step 4: Run focused tests**

Expected: all selected tests PASS.

### Task 4: Generate and install 18 sheets

**Files:**
- Create: 443 paths under `templates/icons/Backgrounds`, `Feats`, `Classes`, `AbilitiesByRace`, `Actions`, `Downtime`, `States`, and `Transport`
- Temporary only: `tmp/imagegen/sheets/*`

**Interfaces:**
- Consumes: `grid-prompt` and `grid-apply` from Tasks 1–2.
- Produces: 443 decodable module-owned WebP assets.

- [ ] **Step 1: Generate pilot prompt and first sheet**

Run `grid-prompt` for batch `icon-grid-001`, generate one square image with built-in ImageGen, save it under `tmp/imagegen/sheets/`, and visually inspect the full sheet before slicing.

- [ ] **Step 2: Apply and inspect pilot outputs**

Run `grid-apply`, build a preview, and inspect representative tiles at original resolution. Reject and regenerate the pilot if geometry, ordering, text prohibition, framing, or readability fails.

- [ ] **Step 3: Generate remaining 17 sheets sequentially**

For each batch, print its exact prompt, generate through built-in ImageGen, inspect the sheet, apply via FFmpeg, and record completion in the ignored receipt. Retry only a failed batch, at most twice.

- [ ] **Step 4: Audit installed assets**

Run the existing adapter audit plus grid manifest audit. Expected: all 443 targets present, normalized names match runtime keys, and no target remains on fallback.

- [ ] **Step 5: Decode every asset**

Use FFprobe to assert 256×256 WebP and FFmpeg full-decode for all 443 files. Report counts and actual failures only.

### Task 5: Documentation, full verification, commit, and push

**Files:**
- Modify: `docs/icon-generation-pipeline.md`
- Modify: `docs/function-passport.md`
- Modify: implementation/tests/assets from Tasks 1–4

**Interfaces:**
- Documents current CLI commands, owners, data flow, restrictions, and focused tests.

- [ ] **Step 1: Update current-state documentation**

Document the new commands on the existing `tools/icon-pipeline.py`; do not describe a second adapter. Update only the relevant function-passport sections for changed methods.

- [ ] **Step 2: Run focused and full verification once on unchanged HEAD**

Run:

```powershell
node --test tests/icon-pipeline.test.mjs tests/downtime-compendium.test.mjs tests/states-compendium.test.mjs tests/transport-compendium.test.mjs tests/transport-actor-builder.test.mjs
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

- [ ] **Step 3: Review and stage only task files**

Inspect `git diff --stat` and substantive `git diff`; stage explicit paths only, never `git add -A`.

- [ ] **Step 4: Commit and push**

```powershell
git commit -m "feat: add complete individual icon coverage"
git push -u origin lich_branch
```
