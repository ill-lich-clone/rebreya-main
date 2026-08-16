# Built-in Storage Folder Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the oldest Actor folder named `Хранилища` at any nesting level and reconcile every managed built-in storage Actor into it without deleting duplicate folders.

**Architecture:** Extend the existing `BuiltinStorageActorService` only. Its active-GM `sync()` deterministically selects a canonical matching folder, passes that folder ID into both create and existing-Actor paths, and includes a folder move in the existing managed `actor.update()` only when needed.

**Tech Stack:** Foundry VTT 13, dnd5e 5.x Actor/Folder documents, native ES modules, Node.js `node:test` and `node:assert/strict`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Before edits run the complete Git preflight from `AGENTS.md`; stop if remote `lich_branch` advanced, upstream `main` conflicts, or unrelated work overlaps the target files.
- Preserve all unrelated working-tree changes and stage only files listed in this plan.
- Keep `BuiltinStorageActorService` as the only lifecycle owner; add no hook, socket, setting, UI path, public API, or second service.
- Run only on the active GM and move only Actor documents with a valid built-in storage preset flag.
- Match Actor folders whose trimmed name is exactly `Хранилища` at any nesting level.
- Prefer the lowest numeric `_stats.createdTime`; known times precede missing times; resolve ties and missing-time candidates by string `id`.
- Never delete or rename duplicate folders and never overwrite Actor names, storage contents, texture state, or unrelated user fields.
- Update section 8 of `docs/function-passport.md` for the changed lifecycle behavior and method signature.
- Keep JavaScript, Markdown, JSON, and Russian text in valid UTF-8.

---

## File Structure

- Modify `tests/builtin-storage-actor-service.test.mjs`: add the regression fixtures and assertions for deterministic folder selection and existing-Actor reconciliation.
- Modify `scripts/data/builtin-storage-actor-service.js`: add the stable folder comparator, reuse nested matching folders, and pass the canonical folder ID through existing-Actor sync.
- Modify `docs/function-passport.md`: update the current storage lifecycle contract, data flow, constraints, and focused tests in section 8.

### Task 1: Deterministic folder reuse and Actor reconciliation

**Files:**
- Modify: `tests/builtin-storage-actor-service.test.mjs:32-80,147-188`
- Modify: `scripts/data/builtin-storage-actor-service.js:28-40,98-163,183-200`
- Modify: `docs/function-passport.md:108-123`
- Reference: `docs/superpowers/specs/2026-08-16-builtin-storage-folder-reconciliation-design.md`

**Interfaces:**
- Consumes: `collectionValues(collection)`, `readPresetId(actor)`, `BuiltinStorageActorService.sync()`, Foundry Folder fields `{ id, name, type, folder, _stats.createdTime }`, and Actor `folder` as either an ID string, Folder-like object, or null.
- Produces: internal `compareBuiltinStorageFolders(left, right): number`; changed private method `#syncExistingActor(actor, preset, folderId): Promise<void>`; unchanged public `BuiltinStorageActorService.sync(): Promise<{ folder, actors } | null>` with deterministic `result.folder`.

- [ ] **Step 1: Add a test fixture that records managed Actor updates**

In `tests/builtin-storage-actor-service.test.mjs`, add this helper after `createHarness()` so tests exercise the real service update payload without adding test-only branches to production:

```js
function makeActorUpdatable(actor) {
  actor.updates = [];
  actor.update = async function update(patch) {
    this.updates.push(structuredClone(patch));
  };
  return actor;
}
```

- [ ] **Step 2: Write the failing deterministic-selection test**

Add a table-driven test after `active GM creates the root folder...`. It must put the wrong candidate first to prove selection does not depend on collection order:

```js
test("sync reuses the deterministic oldest storage folder at any nesting level", async () => {
  const cases = [
    {
      name: "oldest known creation time",
      folders: [
        { id: "newer-root", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null, _stats: { createdTime: 200 } },
        { id: "oldest-nested", name: ` ${BUILTIN_STORAGE_FOLDER_NAME} `, type: "Actor", folder: "parent-folder", _stats: { createdTime: 100 } }
      ],
      expectedId: "oldest-nested"
    },
    {
      name: "known time before missing time",
      folders: [
        { id: "missing-time", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: "parent-folder" },
        { id: "known-time", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null, _stats: { createdTime: 300 } }
      ],
      expectedId: "known-time"
    },
    {
      name: "stable ID tie break for equal known times",
      folders: [
        { id: "known-z", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null, _stats: { createdTime: 400 } },
        { id: "known-a", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: "parent-folder", _stats: { createdTime: 400 } }
      ],
      expectedId: "known-a"
    },
    {
      name: "stable ID tie break",
      folders: [
        { id: "folder-z", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null },
        { id: "folder-a", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: "parent-folder" }
      ],
      expectedId: "folder-a"
    }
  ];

  for (const fixture of cases) {
    const harness = createHarness();
    harness.folders.push(
      { id: `ignored-${fixture.name}`, name: "Другая папка", type: "Actor", folder: null },
      ...structuredClone(fixture.folders)
    );

    const result = await harness.service.sync();

    assert.equal(result.folder.id, fixture.expectedId, fixture.name);
    assert.equal(harness.folderCreates.length, 0, fixture.name);
    assert.equal(harness.actorCreates.length, EXPECTED_SYNC_IDS.length, fixture.name);
    assert.equal(harness.actorCreates.every(({ data }) => data.folder === fixture.expectedId), true, fixture.name);
  }
});
```

- [ ] **Step 3: Write the failing reconciliation test**

Add a regression test that first creates all built-ins, then reproduces the real split-folder world and asserts every managed Actor is moved while user data survives:

```js
test("sync reconciles existing built-in Actors into the oldest storage folder without deleting duplicates", async () => {
  const harness = createHarness();
  await harness.service.sync();
  const initialFolderCreates = harness.folderCreates.length;
  const canonical = {
    id: "storage-oldest",
    name: BUILTIN_STORAGE_FOLDER_NAME,
    type: "Actor",
    folder: "under-hand-folder",
    _stats: { createdTime: 100 }
  };
  const duplicate = {
    id: "storage-newer",
    name: BUILTIN_STORAGE_FOLDER_NAME,
    type: "Actor",
    folder: null,
    _stats: { createdTime: 200 }
  };
  harness.folders.splice(0, harness.folders.length, duplicate, canonical);

  for (const actor of harness.actors) {
    actor.folder = duplicate.id;
    actor.name = `Пользовательское имя ${actor.id}`;
    makeActorUpdatable(actor);
  }
  const preservedName = harness.actors[0].name;
  const preservedRows = [{ rowId: "kept-row", name: "Содержимое", quantity: 1 }];
  harness.actors[0].prototypeToken.flags[MODULE_ID].storage.manualRows = structuredClone(preservedRows);

  const result = await harness.service.sync();

  assert.equal(result.folder, canonical);
  assert.equal(harness.folderCreates.length, initialFolderCreates);
  assert.deepEqual(harness.folders, [duplicate, canonical]);
  assert.equal(harness.actors[0].name, preservedName);
  for (const actor of harness.actors) {
    assert.equal(actor.updates.length, 1);
    assert.equal(actor.updates[0].folder, canonical.id);
  }
  assert.deepEqual(
    harness.actors[0].updates[0][`prototypeToken.flags.${MODULE_ID}.storage`].manualRows,
    preservedRows
  );
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```powershell
node --test tests/builtin-storage-actor-service.test.mjs
```

Expected: the deterministic-selection cases fail because the current code ignores nested matches or returns collection order; the reconciliation test fails because existing update payloads lack `folder`.

- [ ] **Step 5: Implement deterministic folder comparison**

Add this internal helper after `readPresetId()` in `scripts/data/builtin-storage-actor-service.js`:

```js
function compareBuiltinStorageFolders(left, right) {
  const leftCreated = left?._stats?.createdTime;
  const rightCreated = right?._stats?.createdTime;
  const leftHasCreated = Number.isFinite(leftCreated);
  const rightHasCreated = Number.isFinite(rightCreated);
  if (leftHasCreated && rightHasCreated && leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  if (leftHasCreated !== rightHasCreated) return leftHasCreated ? -1 : 1;
  const leftId = String(left?.id ?? "");
  const rightId = String(right?.id ?? "");
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}
```

Replace the root-only `.find()` inside `#ensureFolder(game)` with deterministic selection across all nesting levels:

```js
const existing = collectionValues(game?.folders)
  .filter((folder) => (
    folder?.type === "Actor"
    && String(folder?.name ?? "").trim() === BUILTIN_STORAGE_FOLDER_NAME
  ))
  .sort(compareBuiltinStorageFolders)[0];
if (existing) return existing;
```

Keep the existing `Folder.create({ name, type: "Actor", folder: null })` fallback unchanged.

- [ ] **Step 6: Reconcile existing managed Actors in the same update**

Pass `folder.id` from `sync()`:

```js
await this.#syncExistingActor(existing, preset, folder.id);
```

Change the private method signature and prepend a conditional `folder` field to its existing update payload:

```js
async #syncExistingActor(actor, preset, folderId) {
  if (typeof actor?.update !== "function") return;
  const currentFolderId = typeof actor?.folder === "string"
    ? actor.folder
    : actor?.folder?.id ?? null;
  const current = actor.prototypeToken?.flags?.[MODULE_ID]?.storage ?? {};
  const initial = initialStorageState(preset);
  const currentDurability = actor.prototypeToken?.flags?.[MODULE_ID]?.[STORAGE_OBJECT_DURABILITY_FLAG];
  const durability = preset.groundPile === true
    ? null
    : normalizeStorageObjectDurability(currentDurability ?? CHEST_OBJECT_DURABILITY);
  await actor.update({
    ...(String(currentFolderId ?? "") !== String(folderId ?? "") ? { folder: folderId } : {}),
    "prototypeToken.name": preset.prototypeToken.name,
    [`prototypeToken.flags.${MODULE_ID}.storage`]: buildStorageTokenState({
      ...initial,
      ...current,
      baseName: preset.prototypeToken.name,
      textures: current.textures ?? preset.textures
    }),
    ...(durability ? {
      [`prototypeToken.flags.${MODULE_ID}.${STORAGE_OBJECT_DURABILITY_FLAG}`]: durability,
      "prototypeToken.delta.system.attributes.hp": {
        value: durability.hp.value,
        max: durability.hp.max,
        dt: durability.damageThreshold
      },
      "prototypeToken.delta.system.attributes.ac": { calc: "flat", flat: durability.ac },
      "prototypeToken.bar1.attribute": "attributes.hp"
    } : {}),
    ...(preset.groundPile === true ? {
      [`flags.${MODULE_ID}.groundPilePrototype`]: { enabled: true },
      [`prototypeToken.flags.${MODULE_ID}.groundPile`]: { enabled: true }
    } : {})
  });
}
```

Do not add deletion, renaming, folder updates for non-built-in Actors, or a second migration pass.

- [ ] **Step 7: Run the focused test and verify GREEN**

Run:

```powershell
node --test tests/builtin-storage-actor-service.test.mjs
```

Expected: all tests in the file pass with zero failures and no warnings.

- [ ] **Step 8: Update the function passport**

In section 8 of `docs/function-passport.md`, extend the `Встроенные Actor` contract to state:

```markdown
`sync()` выбирает среди Actor-папок `Хранилища` на любом уровне самую старую по `_stats.createdTime` с детерминированным fallback по ID, создаёт корневую папку только при отсутствии совпадений и переносит все Actor с built-in preset flag в выбранную папку через тот же managed `actor.update()`. Одноимённые папки не удаляются.
```

Update the listed internal signature to `#syncExistingActor(actor, preset, folderId)` and retain `tests/builtin-storage-actor-service.test.mjs` as the focused owner test. Do not alter the concurrent Journal contracts in the same section.

- [ ] **Step 9: Run focused storage verification after documentation changes**

Run:

```powershell
node --test tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs tests/storage-main-registration.test.mjs tests/module-manifest.test.mjs
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 10: Run the complete verification once on the final HEAD**

Run exactly from the repository root:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: Node reports zero failed tests; `git diff --check`, every syntax check, and every JSON parse exit successfully. Record the exact passed/failed counts and any real errors without pasting full successful logs.

- [ ] **Step 11: Inspect only the task diff**

Run:

```powershell
git diff --check
git diff --stat -- scripts/data/builtin-storage-actor-service.js tests/builtin-storage-actor-service.test.mjs docs/function-passport.md
git diff -- scripts/data/builtin-storage-actor-service.js tests/builtin-storage-actor-service.test.mjs docs/function-passport.md
git status --short --branch
```

Expected: only the intended storage changes are selected for this task; unrelated user files remain unstaged and unchanged by this implementation.

- [ ] **Step 12: Commit and publish only the task files**

Run:

```powershell
git add -- scripts/data/builtin-storage-actor-service.js tests/builtin-storage-actor-service.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "fix: reconcile built-in storage folders"
git push -u origin lich_branch
```

Do not stage with `git add -A`. Report the commit hash, push result, focused/full test counts, and that duplicate folders were intentionally preserved.
