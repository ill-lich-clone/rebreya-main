# Built-in Storage Chests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three self-restoring Rebreya storage NPCs whose scene tokens automatically and manually switch between closed, opened, and empty chest textures.

**Architecture:** A pure preset catalog owns stable IDs and module asset paths. An active-GM world service creates only missing folder/Actor documents, while `StorageService` remains the single owner of per-token logical and visual state; `StorageApp` and `RebreyaMainModule` expose a GM-only texture selector without involving Item Piles.

**Tech Stack:** Foundry VTT 13, dnd5e Actor/Token documents, native ES modules, Handlebars ApplicationV2, Node.js test runner, FFmpeg/libwebp.

## Global Constraints

- Work only on branch `lich_branch`; never commit or push directly to `main`/`master`.
- Fetch `origin` before implementation and stop only for unknown foreign changes or a real conflict with the current mainline.
- Do not use Item Piles for storage state, contents, actor creation, or texture switching.
- Run world-document restoration only on the active GM client.
- Create three presets with stable IDs `wood-dark-copper`, `wood-dark-silver`, and `wood-dark-gold`.
- Use one shared closed texture and one shared empty texture; only the opened texture differs by coin metal.
- Preserve existing built-in actors and their user edits; create only a missing folder or missing preset Actor.
- Store every placed token's configuration and loot independently in `flags.rebreya-main.storage`.
- Manual texture buttons change `displayMode` and `texture.src` only; they never change logical state or contents.
- Existing storage tokens without a complete texture set retain their previous behavior.
- Never force-push.

---

### Task 1: Re-encoded chest assets and immutable preset catalog

**Files:**
- Create: `assets/storage/chests/wood-dark-closed.webp`
- Create: `assets/storage/chests/wood-dark-copper-open.webp`
- Create: `assets/storage/chests/wood-dark-silver-open.webp`
- Create: `assets/storage/chests/wood-dark-gold-open.webp`
- Create: `assets/storage/chests/wood-dark-empty.webp`
- Create: `scripts/data/builtin-storage-presets.js`
- Create: `tests/builtin-storage-presets.test.mjs`

**Interfaces:**
- Consumes: five named source images under `D:\ЛИЧный хлам\🎲 ДнД для поляны\Материал для кампаний\Токены\Сундуки`.
- Produces: frozen `BUILTIN_STORAGE_PRESETS: readonly Preset[]`, where each preset has `{ id, name, textures: { unopened, opened, empty }, prototypeToken }`, and every path starts with `modules/rebreya-main/assets/storage/chests/`.

- [ ] **Step 1: Write the failing catalog and asset test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { BUILTIN_STORAGE_PRESETS } from "../scripts/data/builtin-storage-presets.js";

const expected = [
  ["wood-dark-copper", "Сундук — медные монеты", "wood-dark-copper-open.webp"],
  ["wood-dark-silver", "Сундук — серебряные монеты", "wood-dark-silver-open.webp"],
  ["wood-dark-gold", "Сундук — золотые монеты", "wood-dark-gold-open.webp"]
];

test("built-in storage catalog exposes the three immutable coin presets", () => {
  assert.equal(Object.isFrozen(BUILTIN_STORAGE_PRESETS), true);
  assert.deepEqual(BUILTIN_STORAGE_PRESETS.map(({ id, name }) => [id, name]),
    expected.map(([id, name]) => [id, name]));
  for (const [index, preset] of BUILTIN_STORAGE_PRESETS.entries()) {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.textures), true);
    assert.equal(Object.isFrozen(preset.prototypeToken), true);
    assert.match(preset.textures.unopened, /wood-dark-closed\.webp$/u);
    assert.match(preset.textures.opened, new RegExp(`${expected[index][2]}$`, "u"));
    assert.match(preset.textures.empty, /wood-dark-empty\.webp$/u);
    assert.equal(preset.prototypeToken.actorLink, false);
    assert.equal(preset.prototypeToken.texture.src, preset.textures.unopened);
  }
});

test("all built-in storage assets are real WebP files", async () => {
  const paths = new Set(BUILTIN_STORAGE_PRESETS.flatMap(({ textures }) => Object.values(textures)));
  assert.equal(paths.size, 5);
  for (const modulePath of paths) {
    const relativePath = modulePath.replace(/^modules\/rebreya-main\//u, "../");
    const url = new URL(relativePath, import.meta.url);
    await access(url);
    const bytes = await readFile(url);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `node --test tests/builtin-storage-presets.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `builtin-storage-presets.js`.

- [ ] **Step 3: Re-encode the five sources through FFmpeg**

```powershell
$sourceDir = 'D:\ЛИЧный хлам\🎲 ДнД для поляны\Материал для кампаний\Токены\Сундуки'
$targetDir = 'assets\storage\chests'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$files = @{
  'Chest_Wood_Ashen_A_1x1.webp' = 'wood-dark-closed.webp'
  'Treasure_Chest_Wood_Dark_A1_Coins_Copper_1x1.webp' = 'wood-dark-copper-open.webp'
  'Treasure_Chest_Wood_Dark_A1_Coins_Silver_1x1.webp' = 'wood-dark-silver-open.webp'
  'Treasure_Chest_Wood_Dark_A1_Coins_Gold_1x1.webp' = 'wood-dark-gold-open.webp'
  'Treasure_Chest_Wood_Dark_A1_Empty_A_1x1.webp' = 'wood-dark-empty.webp'
}
foreach ($entry in $files.GetEnumerator()) {
  ffmpeg -hide_banner -loglevel error -y -i (Join-Path $sourceDir $entry.Key) `
    -frames:v 1 -c:v libwebp -lossless 1 -compression_level 6 `
    (Join-Path $targetDir $entry.Value)
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed for $($entry.Key)" }
}
```

Expected: five non-empty WebP files in `assets/storage/chests/`, with alpha retained by libwebp.

- [ ] **Step 4: Implement the immutable catalog**

```js
const ROOT = "modules/rebreya-main/assets/storage/chests";
const CLOSED = `${ROOT}/wood-dark-closed.webp`;
const EMPTY = `${ROOT}/wood-dark-empty.webp`;

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function preset(id, name, openedFile) {
  const textures = {
    unopened: CLOSED,
    opened: `${ROOT}/${openedFile}`,
    empty: EMPTY
  };
  return deepFreeze({
    id,
    name,
    textures,
    prototypeToken: {
      name,
      actorLink: false,
      texture: { src: textures.unopened }
    }
  });
}

export const BUILTIN_STORAGE_PRESETS = Object.freeze([
  preset("wood-dark-copper", "Сундук — медные монеты", "wood-dark-copper-open.webp"),
  preset("wood-dark-silver", "Сундук — серебряные монеты", "wood-dark-silver-open.webp"),
  preset("wood-dark-gold", "Сундук — золотые монеты", "wood-dark-gold-open.webp")
]);
```

- [ ] **Step 5: Run the focused test and inspect the encoded streams**

Run: `node --test tests/builtin-storage-presets.test.mjs`

Run:

```powershell
Get-ChildItem -LiteralPath 'assets\storage\chests' -Filter '*.webp' | ForEach-Object {
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,pix_fmt `
    -of compact=p=0:nk=1 $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "FFprobe failed for $($_.Name)" }
}
```

Expected: test PASS; all five streams report codec `webp` and an alpha-capable pixel format.

- [ ] **Step 6: Commit the asset/catalog slice**

```powershell
git add -- assets/storage/chests scripts/data/builtin-storage-presets.js tests/builtin-storage-presets.test.mjs
git commit -m "feat: add built-in storage chest assets"
```

---

### Task 2: Active-GM restoration of the folder and three NPC Actors

**Files:**
- Create: `scripts/data/builtin-storage-actor-service.js`
- Create: `tests/builtin-storage-actor-service.test.mjs`

**Interfaces:**
- Consumes: `BUILTIN_STORAGE_PRESETS` from Task 1 and `isActiveGmClient(game)` from `scripts/infrastructure/foundry/active-gm.js`.
- Produces: `BUILTIN_STORAGE_FOLDER_NAME = "Хранилища"`, `BUILTIN_STORAGE_PRESET_FLAG = "builtinStoragePreset"`, `buildBuiltinStorageActorData(preset, folderId)`, and `BuiltinStorageActorService.sync(): Promise<{ folder, actors } | null>`.

- [ ] **Step 1: Write failing builder and restoration tests**

Create a harness with mutable `game.folders.contents`, `game.actors.contents`, fake `Folder.create`, fake `Actor.create`, and active/inactive GM users. Assert all of the following in named tests:

```js
assert.equal(data.type, "npc");
assert.equal(data.folder, "storage-folder");
assert.equal(data.flags[MODULE_ID].storage.enabled, true);
assert.equal(data.flags[MODULE_ID].builtinStoragePreset.id, "wood-dark-copper");
assert.equal(data.prototypeToken.actorLink, false);
assert.equal(data.prototypeToken.texture.src, preset.textures.unopened);
assert.deepEqual(data.prototypeToken.flags[MODULE_ID].storage.textures, preset.textures);
assert.equal(data.prototypeToken.flags[MODULE_ID].storage.state, "unopened");
assert.equal(data.prototypeToken.flags[MODULE_ID].storage.displayMode, "unopened");
```

Also prove:

```js
assert.equal(await inactiveService.sync(), null);
assert.equal(folderCreates.length, 0);
assert.equal(actorCreates.length, 0);

await activeService.sync();
assert.equal(folderCreates.length, 1);
assert.equal(actorCreates.length, 3);

await activeService.sync();
assert.equal(folderCreates.length, 1);
assert.equal(actorCreates.length, 3);
```

Delete one generated actor from the fake collection, rename another, call `sync()` again, and assert that exactly the deleted preset returns while the renamed actor remains unchanged.

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `node --test tests/builtin-storage-actor-service.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the new service.

- [ ] **Step 3: Implement testable Actor data construction**

Use this exact document shape in `buildBuiltinStorageActorData`:

```js
return {
  name: preset.name,
  type: "npc",
  img: preset.textures.unopened,
  folder: folderId,
  flags: {
    [MODULE_ID]: {
      storage: { enabled: true },
      [BUILTIN_STORAGE_PRESET_FLAG]: { id: preset.id }
    }
  },
  prototypeToken: {
    ...clone(preset.prototypeToken),
    flags: {
      [MODULE_ID]: {
        storage: {
          version: 1,
          baseName: preset.name,
          template: null,
          manualRows: [],
          manualCoins: { pp: 0, gp: 0, sp: 0, cp: 0 },
          generatedRows: [],
          generatedCoins: { pp: 0, gp: 0, sp: 0, cp: 0 },
          claimedRowIds: [],
          coinsClaimed: false,
          state: "unopened",
          textures: clone(preset.textures),
          displayMode: "unopened"
        }
      }
    }
  }
};
```

The builder must clone mutable payloads so a Foundry document mutation cannot alter the frozen catalog.

- [ ] **Step 4: Implement active-GM idempotent synchronization**

Constructor dependencies:

```js
constructor({
  gameProvider = () => globalThis.game,
  folderProvider = () => globalThis.Folder,
  actorProvider = () => globalThis.Actor,
  isActiveGm = isActiveGmClient,
  logger = console
} = {})
```

`sync()` must:

1. Return `null` before reading/creating documents when `isActiveGm(game) !== true`.
2. Find only a root folder with `folder.type === "Actor"`, `folder.folder == null`, and name `Хранилища`.
3. Create it via `Folder.create({ name: "Хранилища", type: "Actor", folder: null })` when absent.
4. Match actors only by `actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG)?.id` or the equivalent raw flag.
5. Call `Actor.create(buildBuiltinStorageActorData(preset, folder.id), { renderSheet: false })` only for missing preset IDs.
6. Catch/log each individual Actor creation failure and continue with the other presets.
7. Never update, rename, move, or re-texture an existing matched Actor.

- [ ] **Step 5: Run the focused service tests**

Run: `node --test tests/builtin-storage-actor-service.test.mjs tests/builtin-storage-presets.test.mjs`

Expected: all tests PASS, including inactive-GM, idempotency, selective restore, preservation, and per-preset failure isolation.

- [ ] **Step 6: Commit the restoration service**

```powershell
git add -- scripts/data/builtin-storage-actor-service.js tests/builtin-storage-actor-service.test.mjs
git commit -m "feat: restore built-in storage actors"
```

---

### Task 3: Per-token visual state and automatic texture transitions

**Files:**
- Modify: `scripts/data/storage-service.js:1-252`
- Modify: `tests/storage-service.test.mjs:1-75`

**Interfaces:**
- Consumes: existing `buildStorageTokenState`, `readStorageState`, `StorageService.open`, `StorageService.claim`, and `StorageService.configure`.
- Produces: exported `STORAGE_TEXTURE_MODES`, normalized `state.textures`, normalized `state.displayMode`, and `StorageService.setTextureMode(token, mode)`.

- [ ] **Step 1: Upgrade the fake token patcher before adding behavior tests**

Replace the one-key `createStorageToken().update()` parser with a loop that applies every dot path, so a single write can assert both flags and `texture.src`:

```js
async update(patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = this;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = structuredClone(value);
  }
  return this;
}
```

- [ ] **Step 2: Write failing state-transition and compatibility tests**

Add tests using:

```js
const textures = {
  unopened: "closed.webp",
  opened: "open.webp",
  empty: "empty.webp"
};
```

Prove these exact contracts:

```js
await service.configure(token, { textures, displayMode: "unopened" });
await service.open(token);
assert.equal(readStorageState(token).displayMode, "opened");
assert.equal(token.texture.src, "open.webp");

await service.claim(token, { kind: "row", rowId: "generated" });
assert.equal(readStorageState(token).state, "empty");
assert.equal(readStorageState(token).displayMode, "empty");
assert.equal(token.texture.src, "empty.webp");

await service.configure(token, { state: "unopened", displayMode: "unopened" });
assert.equal(token.texture.src, "closed.webp");
```

Then open a chest with two rows, call `setTextureMode(token, "unopened")`, claim only one row, and assert that logical state remains `opened` and manual `displayMode === "unopened"` is preserved. Assert invalid mode and incomplete textures reject. Assert an old token without textures never receives a `texture.src` update.

- [ ] **Step 3: Run the focused test and verify behavioral failures**

Run: `node --test tests/storage-service.test.mjs`

Expected: FAIL because texture fields and `setTextureMode` do not exist.

- [ ] **Step 4: Normalize only complete texture sets**

Add:

```js
export const STORAGE_TEXTURE_MODES = Object.freeze(["unopened", "opened", "empty"]);
const STORAGE_TEXTURE_MODE_SET = new Set(STORAGE_TEXTURE_MODES);

function normalizeTextures(value) {
  if (!value || typeof value !== "object") return null;
  const textures = Object.fromEntries(STORAGE_TEXTURE_MODES.map((mode) => [
    mode,
    String(value[mode] ?? "").trim()
  ]));
  return STORAGE_TEXTURE_MODES.every((mode) => textures[mode]) ? textures : null;
}
```

In `buildStorageTokenState`, return `textures` and a `displayMode` that uses the supplied valid mode only when textures are complete; otherwise retain a harmless logical-state fallback while leaving `textures: null`.

- [ ] **Step 5: Make `#write` atomically persist flags, name, and optional texture**

Build one patch:

```js
const patch = {
  ["flags." + MODULE_ID + "." + STORAGE_TOKEN_FLAG]: normalized,
  name: deriveStorageDisplayName(normalized)
};
const texturePath = normalized.textures?.[normalized.displayMode];
if (texturePath) patch["texture.src"] = texturePath;
await document.update(patch);
```

- [ ] **Step 6: Apply automatic transitions without clobbering intermediate manual display**

- In `#openOnce`, write `state: "opened", displayMode: "opened"`.
- In both `claim` branches, compute `nextState`; write `displayMode: nextState === "empty" ? "empty" : current.displayMode`.
- Add `setTextureMode(token, mode)` that rejects a mode outside `STORAGE_TEXTURE_MODE_SET`, rejects absent/incomplete textures, and calls `#write(token, { ...current, displayMode: mode })` without touching logical `state` or loot fields.

- [ ] **Step 7: Run the focused storage tests**

Run: `node --test tests/storage-service.test.mjs tests/storage-socket.test.mjs`

Expected: all tests PASS; the existing access/distance/visibility/socket behavior stays unchanged.

- [ ] **Step 8: Commit automatic token visuals**

```powershell
git add -- scripts/data/storage-service.js tests/storage-service.test.mjs
git commit -m "feat: synchronize storage token textures"
```

---

### Task 4: GM-only buttons 1–2–3 and module API

**Files:**
- Modify: `scripts/main.js:3070-3193`
- Modify: `scripts/ui/storage-app.js:50-165`
- Modify: `templates/storage-app.hbs:1-55`
- Modify: `styles/main.css:12489-12640`
- Modify: `tests/storage-app.test.mjs:1-75`
- Create: `tests/storage-module-api.test.mjs`

**Interfaces:**
- Consumes: `StorageService.setTextureMode(token, mode)` from Task 3 and `getStorageSnapshot(tokenUuid)`.
- Produces: `RebreyaMainModule.setStorageTextureMode(tokenUuid, mode): Promise<StorageState>` and UI actions with `data-action="storage-set-texture"` plus `data-mode`.

- [ ] **Step 1: Write failing UI context and template tests**

Extend the fake snapshot with `textures` and `displayMode`, then assert:

```js
assert.equal(context.configuration.canSetTexture, true);
assert.equal(context.configuration.displayMode, "opened");
assert.deepEqual(context.configuration.textureModes.map(({ mode, label, number }) => [mode, label, number]), [
  ["unopened", "Закрытый", "1"],
  ["opened", "Открытый", "2"],
  ["empty", "Пустой", "3"]
]);
```

Read `templates/storage-app.hbs` and assert one `storage-set-texture` action is rendered inside an `{{#if configuration.canSetTexture}}` block. Add a second context case with `textures: null` and assert `canSetTexture === false`.

- [ ] **Step 2: Write failing module API authorization tests**

In `tests/storage-module-api.test.mjs`, use the same complete Foundry global harness pattern as `tests/main-composition-root.test.mjs`, import `RebreyaMainModule`, and create a real instance. Supply a marked NPC storage token through `globalThis.fromUuid`, replace only `moduleApi.storageService.setTextureMode`, and verify the public method behaviorally:

```js
let textureWrites = 0;
moduleApi.storageService.setTextureMode = async (actualToken, actualMode) => {
  textureWrites += 1;
  assert.equal(actualToken, token);
  assert.equal(actualMode, "opened");
  return { state: "unopened", displayMode: "opened" };
};
globalThis.game.user.isGM = false;
await assert.rejects(
  moduleApi.setStorageTextureMode("Scene.scene.Token.chest", "opened"),
  /только мастер/u
);
assert.equal(textureWrites, 0);
globalThis.game.user.isGM = true;
const result = await moduleApi.setStorageTextureMode("Scene.scene.Token.chest", "opened");
assert.deepEqual(result, { state: "unopened", displayMode: "opened" });
assert.equal(textureWrites, 1);
```

The composition root owns GM authorization; `StorageService` owns mode validation and persistence.

- [ ] **Step 3: Run the focused tests and verify the red state**

Run: `node --test tests/storage-app.test.mjs tests/storage-module-api.test.mjs`

Expected: FAIL on missing context, template controls, and API method.

- [ ] **Step 4: Expose texture data in GM snapshots and implement the guarded API**

In the GM-only branch of `getStorageSnapshot`, add deep clones of `state.textures` and `state.displayMode`. Add:

```js
async setStorageTextureMode(tokenUuid, mode) {
  if (!globalThis.game?.user?.isGM) {
    throw new Error("Менять текстуру хранилища может только мастер.");
  }
  const token = await this.#resolveStorageToken(tokenUuid);
  return this.storageService.setTextureMode(token, mode);
}
```

Update `resetStorageToken` with `displayMode: "unopened"`. When `addManualStorageItem` changes an empty token back to `opened`, also set `displayMode: "opened"` so this real state transition restores the open texture.

- [ ] **Step 5: Add UI context, click handling, markup, and compact styles**

In `_prepareContext`, set `canSetTexture` only when configuration is enabled and all three non-empty texture paths exist. Supply the three exact mode descriptors and `active: snapshot.displayMode === mode`.

In `#onClick`:

```js
else if (action === "storage-set-texture") {
  await this.moduleApi.setStorageTextureMode(this.tokenUuid, clean(control.dataset.mode));
}
```

In the configuration form, render a labeled `rm-storage-texture-modes` block with three buttons showing number and Russian label. Add `aria-pressed="{{active}}"`; active styling must be visually distinct and use existing gray/gold variables/classes rather than a new theme.

- [ ] **Step 6: Run the focused UI and storage suites**

Run: `node --test tests/storage-app.test.mjs tests/storage-module-api.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs`

Expected: all tests PASS; player context still hides configuration and buttons.

- [ ] **Step 7: Commit the GM texture controls**

```powershell
git add -- scripts/main.js scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/storage-app.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: add storage texture controls"
```

---

### Task 5: Composition-root restoration, manifest cache version, and release verification

**Files:**
- Modify: `scripts/main.js:1-170,1011-1110,1531-1563`
- Modify: `module.json:7`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/module-manifest.test.mjs:60-72`

**Interfaces:**
- Consumes: `BuiltinStorageActorService` from Task 2.
- Produces: `moduleApi.builtinStorageActorService`, `moduleApi.restoreBuiltinStorageActors()`, and a guarded call during `RebreyaMainModule.initialize()`.

- [ ] **Step 1: Write failing wiring behavior and version tests**

In the existing Foundry composition harness in `tests/main-composition-root.test.mjs`, import `BuiltinStorageActorService` and assert the real constructed module owns one. Then replace only that external-world service, call the public restoration boundary, and assert its observable result:

```js
assert.ok(moduleApi.builtinStorageActorService instanceof BuiltinStorageActorService);
let syncCalls = 0;
moduleApi.builtinStorageActorService = {
  async sync() {
    syncCalls += 1;
    return { folder: { id: "storage-folder" }, actors: [{ id: "copper" }] };
  }
};
assert.deepEqual(await moduleApi.restoreBuiltinStorageActors(), {
  folder: { id: "storage-folder" },
  actors: [{ id: "copper" }]
});
assert.equal(syncCalls, 1);
```

Add a second case whose `sync()` throws and verify `restoreBuiltinStorageActors()` resolves to `null` after logging the isolated startup warning; it must not reject and prevent the rest of module initialization.

Change the manifest expectation in `tests/module-manifest.test.mjs` to `1.4.113`.

- [ ] **Step 2: Run focused tests and verify the red state**

Run: `node --test tests/main-composition-root.test.mjs tests/module-manifest.test.mjs`

Expected: FAIL because the service is not wired and manifest is still `1.4.112`.

- [ ] **Step 3: Wire the restoration service and isolate startup failure**

Import and construct:

```js
this.builtinStorageActorService = new BuiltinStorageActorService({
  gameProvider: () => globalThis.game,
  folderProvider: () => globalThis.Folder,
  actorProvider: () => globalThis.Actor,
  isActiveGm: isActiveGmClient
});
```

Add this public failure boundary:

```js
async restoreBuiltinStorageActors() {
  try {
    return await this.builtinStorageActorService.sync();
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to restore built-in storage actors.`, error);
    return null;
  }
}
```

Immediately after managed-document synchronization in `initialize()`, call `await this.restoreBuiltinStorageActors();`.

This lets the module finish initializing even if Foundry rejects one world document operation.

- [ ] **Step 4: Bump the module version**

Set `module.json` version to exactly `1.4.113`. Do not alter compatibility, dependencies, styles, or entrypoint arrays.

- [ ] **Step 5: Run the complete automated suite and structural checks**

Run: `node --test tests/*.test.mjs`

Run: `git diff --check`

Run: `git status --short`

Expected: all Node tests PASS, diff check is silent, and status contains only the planned feature files.

- [ ] **Step 6: Review the complete diff against the specification**

Run: `git diff origin/lich_branch...HEAD -- scripts/data/builtin-storage-presets.js scripts/data/builtin-storage-actor-service.js scripts/data/storage-service.js scripts/ui/storage-app.js scripts/main.js templates/storage-app.hbs styles/main.css module.json tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs tests/storage-service.test.mjs tests/storage-app.test.mjs tests/storage-module-api.test.mjs tests/main-composition-root.test.mjs`

Verify each spec requirement maps to a passing test: three/five catalog counts, active-GM-only restoration, preservation/idempotency, automatic transitions, manual texture-only changes, player rejection, legacy compatibility, and static module paths.

- [ ] **Step 7: Commit release wiring**

```powershell
git add -- scripts/main.js module.json tests/main-composition-root.test.mjs tests/module-manifest.test.mjs
git commit -m "feat: initialize built-in storage chests"
```

- [ ] **Step 8: Run the live Foundry smoke test**

At `https://vtt.rebreya.com/`, sign in with the existing Codex test profile, reload the world, and verify:

1. Actor directory contains root folder `Хранилища` and exactly the three flagged built-in actors.
2. Deleting one built-in actor and reloading restores only that actor.
3. Dragging each actor to the active scene creates a closed, unlinked storage token.
4. Player flow still requires the existing two clicks and 5-foot/visibility checks.
5. First opening generates contents and selects the metal-specific opened texture.
6. Taking the final row/coins changes the name suffix to `(пусто)` and selects the shared empty texture.
7. Reset selects the shared closed texture.
8. GM gear mode buttons 1, 2, and 3 switch only appearance and survive an app rerender.

- [ ] **Step 9: Push without force and verify the remote tip**

```powershell
git status --short
git push origin lich_branch
git rev-parse HEAD
git rev-parse origin/lich_branch
```

Expected: push succeeds without `--force`; both hashes match; no uncommitted feature changes remain.
