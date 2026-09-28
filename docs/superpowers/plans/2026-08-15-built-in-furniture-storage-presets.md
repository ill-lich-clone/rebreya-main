# Built-in Furniture Storage Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the eight approved fantasy household storage types as built-in Actors managed by the existing storage preset owner.

**Architecture:** Extend `BUILTIN_STORAGE_PRESETS` with explicit texture sets and per-preset token names. Keep `BuiltinStorageActorService` as the only lifecycle owner, changing only its hard-coded chest naming so new Actors and automatic scene-token migrations use `preset.prototypeToken.name`.

**Tech Stack:** Foundry VTT 13 document data, dnd5e NPC prototype tokens, JavaScript ES modules, Node test runner.

## Global Constraints

- Work only on `lich_branch`; preserve unrelated shared-worktree changes and stage exact task files only.
- Register exactly `barrel`, `wicker-basket`, `provision-sack`, `ceramic-storage-jar`, `wardrobe`, `kitchen-hutch`, `dresser`, and `bedside-cabinet` after the three existing coin chests.
- Do not register `writing-desk`, `pantry-cupboard`, `storage-bench`, or any `wooden-crate-*` asset.
- Reuse `BuiltinStorageActorService`; do not add a hook, service, world setting, UI change, template change, or public API.
- All new presets use storage kind `chest`, unlinked default-size tokens, and `CHEST_OBJECT_DURABILITY`.
- One-texture furniture maps the same WebP to `unopened`, `opened`, and `empty`.
- Update `docs/function-passport.md` for every changed function or method.

---

### Task 1: Extend the canonical built-in storage catalog and owner

**Files:**
- Modify: `tests/builtin-storage-presets.test.mjs`
- Modify: `tests/builtin-storage-actor-service.test.mjs`
- Modify: `scripts/data/builtin-storage-presets.js`
- Modify: `scripts/data/builtin-storage-actor-service.js`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Consumes: existing `BUILTIN_STORAGE_PRESETS`, `GROUND_PILE_STORAGE_PRESET`, `buildBuiltinStorageActorData(preset, folderId)`, and `BuiltinStorageActorService.sync()`.
- Produces: an immutable 11-entry `BUILTIN_STORAGE_PRESETS`; a 12-entry internal sync sequence including `ground-pile`; per-preset prototype-token names and storage base names.

- [ ] **Step 1: Expand catalog tests before production code**

Replace the three-entry expectation with the exact ordered definitions from the approved specification. Assert:

```js
assert.equal(BUILTIN_STORAGE_PRESETS.length, 11);
assert.deepEqual(
  BUILTIN_STORAGE_PRESETS.map(({ id, name, prototypeToken }) => [id, name, prototypeToken.name]),
  [
    ["wood-dark-copper", "Сундук — медные монеты", "Сундук"],
    ["wood-dark-silver", "Сундук — серебряные монеты", "Сундук"],
    ["wood-dark-gold", "Сундук — золотые монеты", "Сундук"],
    ["barrel", "Бочка", "Бочка"],
    ["wicker-basket", "Плетёная корзина", "Плетёная корзина"],
    ["provision-sack", "Мешок припасов", "Мешок припасов"],
    ["ceramic-storage-jar", "Керамический сосуд", "Керамический сосуд"],
    ["wardrobe", "Платяной шкаф", "Платяной шкаф"],
    ["kitchen-hutch", "Кухонный буфет", "Кухонный буфет"],
    ["dresser", "Комод", "Комод"],
    ["bedside-cabinet", "Прикроватная тумба", "Прикроватная тумба"]
  ]
);
```

Assert the four exact three-state mappings, the four repeated single-file mappings, deep immutability, existing durability data, rejection of the four excluded asset families, and 21 unique real WebP paths.

- [ ] **Step 2: Expand owner tests before production code**

Add expectations that `buildBuiltinStorageActorData()` for `barrel` produces Actor name, prototype-token name, and storage `baseName` equal to `Бочка`, while the existing coin preset remains `Сундук`. Update sync expectations to 12 Actors in exact preset order plus `ground-pile`, 13 creation attempts after restoring one removed Actor, and 12 attempts when one preset rejects.

Add a scene-token migration fixture proving an automatically inherited coin Actor name is changed to `Сундук`, while an explicitly customized token name is not updated.

- [ ] **Step 3: Run focused tests and verify the red state**

Run:

```powershell
node --test tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs
```

Expected: failures show the catalog still has three presets and new per-preset token naming is absent.

- [ ] **Step 4: Generalize the preset factory and add eight definitions**

Change the private factory to consume explicit `{ unopened, opened, empty }` paths and an optional token name. Keep the existing three coin definitions byte-for-byte equivalent in behavior, then append the eight approved definitions with paths rooted at `modules/rebreya-main/assets/storage/furniture`. Return the same deep-frozen shape and durability data as existing non-pile presets.

- [ ] **Step 5: Remove hard-coded chest naming from generic actor state**

In `initialStorageState(preset)`, use `preset.prototypeToken.name` as the non-pile `baseName`. In scene-token migration, keep the existing guard that protects custom names but update the automatic target to `preset.prototypeToken.name`. Do not change pile behavior, access checks, active-GM ownership, actor contents, or texture preservation.

- [ ] **Step 6: Run focused tests and verify the green state**

Run:

```powershell
node --test tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 7: Update the storage function passport**

Extend section `8. Хранилища, контейнеры и piles на сцене` with:

- catalog owner `scripts/data/builtin-storage-presets.js`;
- lifecycle owner `BuiltinStorageActorService.sync()`;
- `buildBuiltinStorageActorData(preset, folderId)` input/output contract;
- data flow from immutable preset through active-GM sync to Actor prototype and guarded scene-token migration;
- invariants for custom token names, actor contents, texture sets, and excluded assets;
- focused tests `builtin-storage-presets.test.mjs` and `builtin-storage-actor-service.test.mjs`.

- [ ] **Step 8: Run complete verification**

Run:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: zero test, syntax, JSON, or whitespace failures.

- [ ] **Step 9: Review and publish only task files**

Review `git diff --stat`, the substantive diff, exact staged paths, and remote divergence. Commit only the plan, two production files, two focused tests, and function passport:

```powershell
git add -- docs/superpowers/plans/2026-08-15-built-in-furniture-storage-presets.md docs/function-passport.md scripts/data/builtin-storage-presets.js scripts/data/builtin-storage-actor-service.js tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs
git commit -m "feat: register fantasy furniture storage presets"
git push -u origin lich_branch
```
