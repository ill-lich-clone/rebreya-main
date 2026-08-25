# Journal Scene Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a GM to drop `JournalEntry` documents onto the scene as non-claimable Rebreya storage references outside the native Notes layer, with correct note/pile presentation and a shared first-read notification.

**Architecture:** `storage-transfer-drop.js` remains the only canvas-drop owner and routes non-Notes-layer Journal drops through a new public API and GM-only typed command. `StorageCommandService` authoritatively resolves the Journal and delegates the detached canonical row to the existing `StorageGroundPileService`; presentation remains pure in `storage-pile-presentation.js`, while the existing Journal read transaction owns the shared marker, pile refresh, and public chat message.

**Tech Stack:** Foundry VTT 13, dnd5e, JavaScript ES modules, Foundry Hooks and typed sockets, ApplicationV2, Node.js built-in test runner, PNG raster assets with alpha transparency.

**Spec:** `docs/superpowers/specs/2026-08-24-journal-scene-items-design.md`

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`, and never force push.
- Before edits run the complete Git preflight from `AGENTS.md`; stop if the branch is behind `origin/lich_branch`, the base conflicts, or foreign uncommitted changes overlap this task.
- Preserve Foundry's native Journal Note creation exactly when `canvas.activeLayer === canvas.notes`.
- Intercept only exact `type: "JournalEntry"` plus a non-empty `uuid`; never intercept `JournalEntryPage`.
- Journal scene drop is GM-only at the authoritative command boundary and always re-resolves the live `JournalEntry` by UUID.
- Journal rows remain reference-only, non-stackable, quantity one, and unavailable to claim, bulk claim, durability, Item materialization, or quantity editing.
- Do not create a second canvas hook, storage owner, Journal resolver, Application, or world-setting writer.
- Do not modify the source Journal's ownership, name, pages, flags, or lifecycle.
- Chat and compact command results must not expose Journal UUIDs, raw document data, flags, secret HTML, or page contents.
- Keep all source, JSON, templates, and Russian text in UTF-8.
- Every production behavior follows RED → GREEN; run focused owner tests after each task and the complete `AGENTS.md` verification once at the end.

---

### Task 1: Route Journal drops by active canvas layer

**Files:**
- Modify: `tests/storage-transfer-drop.test.mjs`
- Modify: `scripts/integrations/storage-transfer-drop.js:125-192`

**Interfaces:**
- Consumes: Foundry drag data `{ type: "JournalEntry", uuid, x, y }`, `canvas.scene.id`, `canvas.activeLayer`, and `canvas.notes`.
- Produces: `transferFoundryJournalDropToCanvas(canvas, data, moduleApi) -> Promise<{handled:boolean,result?:object}>` and a synchronous `handleStorageCanvasDrop()` decision.

- [ ] **Step 1: Add failing layer-routing tests**

Add imports for `transferFoundryJournalDropToCanvas` and tests with literal expectations:

```js
test("NotesLayer leaves JournalEntry drops entirely to Foundry", async () => {
  const calls = [];
  const notes = {};
  const canvas = { notes, activeLayer: notes, scene: { id: "scene" } };
  const handled = handleStorageCanvasDrop(canvas, {
    type: "JournalEntry", uuid: "JournalEntry.notes", x: 120, y: 180
  }, {
    async dropStorageJournalToScene(...args) { calls.push(args); }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handled, true);
  assert.deepEqual(calls, []);
});

test("non-Notes layers route JournalEntry drops only to the Journal scene API", async () => {
  const calls = [];
  const canvas = { notes: {}, activeLayer: {}, scene: { id: "scene" } };
  assert.equal(handleStorageCanvasDrop(canvas, {
    type: "JournalEntry", uuid: "JournalEntry.notes", x: 120, y: 180
  }, {
    async dropStorageJournalToScene(...args) {
      calls.push(args);
      return { changed: true };
    }
  }), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["JournalEntry.notes", { sceneId: "scene", x: 120, y: 180 }]]);
});

test("JournalEntryPage and malformed Journal drag data preserve Foundry behavior", () => {
  const canvas = { notes: {}, activeLayer: {}, scene: { id: "scene" } };
  assert.equal(handleStorageCanvasDrop(canvas, {
    type: "JournalEntryPage", uuid: "JournalEntry.notes.JournalEntryPage.page", x: 1, y: 2
  }, {}), true);
  assert.equal(handleStorageCanvasDrop(canvas, { type: "JournalEntry", uuid: "", x: 1, y: 2 }, {}), true);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test tests/storage-transfer-drop.test.mjs
```

Expected: FAIL because non-Notes `JournalEntry` data currently returns `true` and never calls `dropStorageJournalToScene`.

- [ ] **Step 3: Implement the dedicated integration helper and synchronous branch**

Add a helper that validates the exact scene point and calls only the new API:

```js
export async function transferFoundryJournalDropToCanvas(canvas, data, moduleApi) {
  const journalUuid = clean(data?.uuid);
  if (clean(data?.type) !== "JournalEntry" || !journalUuid) return { handled: false };
  if (typeof moduleApi?.dropStorageJournalToScene !== "function") {
    throw new Error("API переноса записей журнала Rebreya на сцену недоступен.");
  }
  const sceneId = clean(canvas?.scene?.id ?? data?.sceneId);
  const x = Number(data?.x);
  const y = Number(data?.y);
  if (!sceneId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Не удалось определить место для записи журнала на сцене.");
  }
  const result = await moduleApi.dropStorageJournalToScene(journalUuid, { sceneId, x, y });
  return { handled: true, result };
}
```

Place this branch before Item handling:

```js
if (clean(data?.type) === "JournalEntry" && clean(data?.uuid)) {
  if (canvas?.activeLayer === canvas?.notes) return true;
  void transferFoundryJournalDropToCanvas(canvas, data, moduleApi, options).catch(notifyDropError);
  return false;
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

```powershell
node --test tests/storage-transfer-drop.test.mjs
```

Expected: all drop integration tests pass; existing Item, Coin, portable container, and storage-row routes remain unchanged.

- [ ] **Step 5: Commit the integration boundary**

```powershell
git add -- tests/storage-transfer-drop.test.mjs scripts/integrations/storage-transfer-drop.js
git diff --cached --check
git commit -m "feat(storage): route journal drops outside notes layer"
```

---

### Task 2: Register the GM-only Journal scene command and public API

**Files:**
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `tests/security.test.mjs`
- Modify: `scripts/data/storage-command-service.js:218-257`
- Modify: `scripts/main.js:299-308, 1750-1813, 3985-4035`

**Interfaces:**
- Consumes: exact command payload `{ journalUuid, mutationId, sceneId, x, y }`.
- Produces: `isValidStorageJournalDropPayload(payload)`, exported `STORAGE_JOURNAL_DROP_COMMAND = "storage.journal.drop-to-scene"`, and `dropStorageJournalToScene(journalUuid, request)`.

- [ ] **Step 1: Add failing exact-payload and registration tests**

In `storage-socket.test.mjs`, import the new validator and add:

```js
test("Journal scene drop accepts only the exact GM command payload", () => {
  const payload = {
    journalUuid: "JournalEntry.notes",
    mutationId: "journal-scene-1",
    sceneId: "scene",
    x: 100,
    y: 200
  };
  assert.equal(isValidStorageJournalDropPayload(payload), true);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, journalUuid: " notes " }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, x: Number.NaN }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, characterTokenUuid: "Token.hero" }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, extra: true }), false);
});
```

Extend `storage-main-registration.test.mjs` so it asserts the exported constant, validator import, one socket registration with `sender?.isGM === true`, and a public method. Add a direct/player routing test whose expected player envelope is:

```js
{
  command: STORAGE_JOURNAL_DROP_COMMAND,
  payload: {
    journalUuid: "JournalEntry.notes",
    mutationId: "player-journal-drop",
    sceneId: "scene",
    x: 100,
    y: 200
  }
}
```

Add `dropStorageJournalToScene` and the new command literal to the API/command allowlist assertions in `security.test.mjs`.

- [ ] **Step 2: Run the focused tests and confirm RED**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs
```

Expected: FAIL because the validator, command constant, registration, and public API do not exist.

- [ ] **Step 3: Implement the validator and composition wiring**

Add the exact validator beside the Item/Coin scene validators:

```js
export function isValidStorageJournalDropPayload(payload) {
  return hasExactKeys(payload, ["journalUuid", "mutationId", "sceneId", "x", "y"])
    && isTrimmedString(payload.journalUuid, { required: true })
    && isTrimmedString(payload.mutationId, { required: true, max: 160 })
    && isTrimmedString(payload.sceneId, { required: true, max: 160 })
    && Number.isFinite(payload.x)
    && Number.isFinite(payload.y);
}
```

Wire the command in `main.js`:

```js
export const STORAGE_JOURNAL_DROP_COMMAND = "storage.journal.drop-to-scene";

this.socketCommandBus.register(STORAGE_JOURNAL_DROP_COMMAND, {
  validate: isValidStorageJournalDropPayload,
  authorize: (_payload, { sender }) => sender?.isGM === true,
  execute: (payload, { sender }) => this.storageCommandService.dropJournalToScene(payload, { sender })
});
```

Add the public local-or-socket route without `characterTokenUuid`:

```js
async dropStorageJournalToScene(journalUuid, request = {}) {
  const payload = {
    journalUuid: cleanSocketId(journalUuid),
    sceneId: cleanSocketId(request.sceneId),
    x: Number(request.x),
    y: Number(request.y),
    mutationId: cleanSocketId(request.mutationId) || createSocketRequestId("storage-journal-scene")
  };
  return isActiveGmClient(globalThis.game)
    ? this.storageCommandService.dropJournalToScene(payload, { sender: globalThis.game?.user })
    : this.socketCommandBus.request(STORAGE_JOURNAL_DROP_COMMAND, payload);
}
```

- [ ] **Step 4: Run the focused tests and confirm GREEN**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs
```

Expected: command validation, GM-only socket authorization, direct execution, and socket routing pass.

- [ ] **Step 5: Commit command plumbing**

```powershell
git add -- tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs scripts/data/storage-command-service.js scripts/main.js
git diff --cached --check
git commit -m "feat(storage): register journal scene drop command"
```

---

### Task 3: Perform authoritative, idempotent Journal scene drops

**Files:**
- Modify: `tests/storage-socket.test.mjs`
- Modify: `scripts/data/storage-command-service.js:321-368, 1358-1570`

**Interfaces:**
- Consumes: `resolveStorageDepositSource({ kind: "journal", journalUuid })` and `StorageGroundPileService.findProcessedMutationAtPoint()` / `transferToScene()`.
- Produces: `StorageCommandService.dropJournalToScene(payload, { sender }) -> Promise<{changed,created,merged,duplicate}>`.

- [ ] **Step 1: Extend the socket harness and add failing authoritative tests**

Add `processedGroundMutations = new Set()` to the existing `createHarness()` destructuring. Replace the `findProcessedMutationAtPoint()` and `transferToScene()` bodies with:

```js
findProcessedMutationAtPoint(request) {
  executionOrder.push("find");
  groundFindCalls.push(clone(request));
  return processedCoinMutations.has(request.mutationId)
    || processedGroundMutations.has(request.mutationId)
    ? { created: false, merged: false, duplicate: true }
    : null;
},
async transferToScene(request) {
  executionOrder.push("transfer");
  if (groundFailure) throw groundFailure;
  groundCalls.push(clone(request));
  processedGroundMutations.add(request.mutationId);
  return { created: true, merged: false, duplicate: false };
}
```

Add tests proving:

```js
test("GM Journal scene drop re-resolves one canonical reference and returns a compact result", async () => {
  const events = [];
  const harness = createHarness({
    depositSource: {
      kind: "journal",
      mode: "copy",
      available: 1,
      row: {
        rowKind: "journal", rowId: "source-row", stackKey: "",
        sourceId: "JournalEntry.authoritative", sourceType: "journal",
        name: "Заметки Гартара", img: "icons/book.webp", quantity: 1
      },
      canUserMove: () => true,
      async consume(quantity) { events.push(["consume", quantity]); return { kind: "copy" }; },
      async restore(receipt) { events.push(["restore", receipt.kind]); }
    }
  });
  const payload = {
    journalUuid: "JournalEntry.authoritative", mutationId: "journal-drop",
    sceneId: "scene", x: 100, y: 200
  };
  const result = await harness.service.dropJournalToScene(payload, { sender: harness.gm });
  assert.deepEqual(events, [["consume", 1]]);
  assert.equal(harness.groundCalls[0].quantity, 1);
  assert.equal(harness.groundCalls[0].row.rowKind, "journal");
  assert.deepEqual(Object.keys(result).sort(), ["changed", "created", "duplicate", "merged"]);
  assert.equal(JSON.stringify(result).includes("JournalEntry"), false);
});
```

Add separate literal tests for non-GM rejection before resolver/consume, wrong source kind/mode/availability, rollback after ground transfer failure, a same-payload retry creating one row, and reusing `mutationId` with another Journal/scene/point/sender rejecting as a fingerprint conflict.

- [ ] **Step 2: Run the focused service tests and confirm RED**

```powershell
node --test tests/storage-socket.test.mjs
```

Expected: FAIL because `dropJournalToScene()` is absent.

- [ ] **Step 3: Implement the mutation key, authorization, resolution, and rollback flow**

Use one mutation key derived from the outer mutation ID alone so the existing fingerprint cache rejects reuse with changed request data:

```js
function journalSceneMutationKey(mutationId) {
  return ["storage", "journal-scene", requireMutationId(mutationId)].join(":");
}
```

Implement the service method with this order:

```js
async dropJournalToScene(payload = {}, { sender } = {}) {
  if (!isValidStorageJournalDropPayload(payload)) {
    throw new Error("Некорректная команда переноса записи журнала на сцену.");
  }
  if (sender?.isGM !== true) throw new Error("Переносить записи журнала на сцену может только мастер.");
  if (typeof this.groundPileService?.findProcessedMutationAtPoint !== "function"
    || typeof this.groundPileService?.transferToScene !== "function") {
    throw new Error("Сервис наземных куч Rebreya недоступен.");
  }
  const mutationKey = journalSceneMutationKey(payload.mutationId);
  const fingerprint = mutationRequestFingerprint(payload, sender);
  const pointRequest = {
    sceneId: payload.sceneId, x: payload.x, y: payload.y, mutationId: mutationKey
  };
  const authorize = async () => {
    if (sender?.isGM !== true) throw new Error("Переносить записи журнала на сцену может только мастер.");
  };
  return this.#runMutation([
    `${payload.journalUuid}:journal`, `${payload.sceneId}:scene`
  ], mutationKey, async () => {
    const duplicate = this.groundPileService.findProcessedMutationAtPoint(pointRequest);
    if (duplicate) return {
      changed: false,
      created: duplicate.created === true,
      merged: duplicate.merged === true,
      duplicate: true
    };
    const source = await this.resolveDepositSource({
      kind: "journal", journalUuid: payload.journalUuid
    }, {
      fromUuid: this.resolveDocument,
      resolveToken: this.resolveToken,
      storageService: this.storageService,
      containerItemService: this.containerItemService
    });
    if (!source || source.kind !== "journal" || source.mode !== "copy"
      || source.available !== 1 || source.canUserMove?.(sender) !== true
      || !isStorageJournalRow(source.row)
      || typeof source.consume !== "function" || typeof source.restore !== "function") {
      throw new Error("Источник записи журнала для сцены недоступен.");
    }
    let receipt = null;
    try {
      receipt = await source.consume(1);
      const created = await this.groundPileService.transferToScene({
        row: clone(source.row), quantity: 1,
        sceneId: payload.sceneId, x: payload.x, y: payload.y,
        mutationId: mutationKey, ownerUserId: clean(sender.id)
      });
      return {
        changed: created?.duplicate !== true,
        created: created?.created === true,
        merged: created?.merged === true,
        duplicate: created?.duplicate === true
      };
    }
    catch (error) {
      if (receipt) await source.restore(receipt);
      throw error;
    }
  }, { fingerprint, authorize });
}
```

When both transfer and restore fail, preserve both errors with the same `AggregateError` rollback pattern already used by Item and Coin scene drops.

- [ ] **Step 4: Run focused Storage command tests and confirm GREEN**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-deposit-source.test.mjs
```

Expected: authoritative re-resolution, GM-only behavior, idempotency, fingerprint binding, and rollback pass without changing the existing Journal deposit contract.

- [ ] **Step 5: Commit the authoritative use case**

```powershell
git add -- tests/storage-socket.test.mjs scripts/data/storage-command-service.js
git diff --cached --check
git commit -m "feat(storage): create journal ground references"
```

---

### Task 4: Add note assets and pure Journal pile presentation

**Files:**
- Create: `assets/storage/piles/journal-note.png`
- Create: `assets/storage/piles/journal-notes.png`
- Modify: `tests/storage-asset.test.mjs`
- Modify: `tests/storage-pile-presentation.test.mjs`
- Modify: `scripts/data/storage-pile-presentation.js:19-125`

**Interfaces:**
- Consumes: canonical Journal rows and `readJournalRowIds` from authoritative storage state.
- Produces: `deriveGroundPilePresentation(rows, { coins, preserveEmptyCoinPile, readJournalRowIds })` with `journal-note` and `journal-notes` categories.

- [ ] **Step 1: Add failing asset and presentation tests**

Extend the real-alpha PNG test loop with:

```js
for (const file of ["journal-note.png", "journal-notes.png"]) {
  test(`${file} is a square PNG with real alpha transparency`, async () => {
    const png = await readFile(new URL(`../assets/storage/piles/${file}`, import.meta.url));
    const { header, idat } = parsePng(png);
    assert.ok(header);
    assert.ok([4, 6].includes(header.colorType));
    assert.equal(header.bitDepth, 8);
    assert.equal(header.interlace, 0);
    assert.equal(header.width, header.height);
    const bytesPerPixel = header.colorType === 6 ? 4 : 2;
    const rows = unfilterRows(inflateSync(idat), header.width, header.height, bytesPerPixel);
    const alphaOffset = bytesPerPixel - 1;
    const alpha = rows.flatMap((row) => Array.from(
      { length: header.width }, (_, x) => row[x * bytesPerPixel + alphaOffset]
    ));
    assert.ok(alpha.some((value) => value === 0));
    assert.ok(alpha.some((value) => value > 0));
  });
}
```

Add presentation cases with literal expected objects:

```js
const journal = (rowId, name) => ({
  rowKind: "journal", rowId, stackKey: "", sourceId: `JournalEntry.${rowId}`,
  sourceType: "journal", name, img: "icons/book.webp", quantity: 1
});

assert.deepEqual(deriveGroundPilePresentation([journal("gartar", "Заметки Гартара")]), {
  name: "Заметки Гартара",
  img: `modules/${MODULE_ID}/assets/storage/piles/journal-note.png`,
  categoryKey: "journal-note"
});
assert.equal(deriveGroundPilePresentation(
  [journal("gartar", "Заметки Гартара")], { readJournalRowIds: ["gartar"] }
).name, "Заметки Гартара (прочитано)");
assert.equal(deriveGroundPilePresentation([
  journal("first", "Первая"), journal("second", "Вторая")
]).categoryKey, "journal-notes");
```

Also assert ordinary Item + Journal uses the Item, coins + Journal uses coin presentation, and `{ preserveEmptyCoinPile: true }` beats Journal-only fallback. Update the existing treasure + coins expectation to the ordinary-row presentation required by the spec (`Рубин`, `icons/ruby.webp`, `single`).

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
node --test tests/storage-asset.test.mjs tests/storage-pile-presentation.test.mjs
```

Expected: FAIL because both PNGs and Journal-only presentation categories are absent.

- [ ] **Step 3: Generate and save both transparent assets**

Use the `imagegen` skill with two exact prompts and save the final PNG outputs at the module-owned paths:

```text
journal-note.png: square fantasy VTT token asset, one physical folded handwritten note with two slightly offset pages, weathered parchment, centered and readable at 64px, realistic painted game-item style matching existing Rebreya storage pile icons, transparent background, no text, no frame, no logo, no watermark

journal-notes.png: square fantasy VTT token asset, a small irregular pile of several distinct folded notes and loose weathered parchment sheets, centered and readable at 64px, realistic painted game-item style matching existing Rebreya storage pile icons, transparent background, no text, no frame, no logo, no watermark
```

Inspect both generated files visually and reject outputs whose corners are opaque, whose subject touches the image boundary, or whose silhouette is unreadable at token scale.

- [ ] **Step 4: Implement the pure priority order**

Import `isStorageJournalRow` from `storage-container-snapshot.js`, add both presentation definitions before `coins`/`mixed-items`, and implement this order:

```js
export function deriveGroundPilePresentation(rows = [], {
  coins = {},
  preserveEmptyCoinPile = false,
  readJournalRowIds = []
} = {}) {
  const availableRows = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === "object");
  const referenceRows = availableRows.filter((row) => isStorageJournalRow(row));
  const ordinaryRows = availableRows.filter((row) => !isStorageJournalRow(row));
  const journalRows = referenceRows.filter((row) => (
    row.rowKind === "journal"
    && clean(row.sourceType).toLowerCase() === "journal"
    && clean(row.sourceId)
    && clean(row.rowId)
    && Number(row.quantity) === 1
  ));
  const readIds = new Set((Array.isArray(readJournalRowIds) ? readJournalRowIds : []).map(clean).filter(Boolean));
```

Run existing single/same-category/mixed rules against `ordinaryRows` first and ignore coins/Journal rows in those calculations. Only when `ordinaryRows.length === 0`, apply positive coin and preserved-empty coin rules; only after those rules, return one canonical Journal note or `Куча заметок`. Keep the existing generic fallback for malformed/empty inputs.

- [ ] **Step 5: Run asset and presentation tests and confirm GREEN**

```powershell
node --test tests/storage-asset.test.mjs tests/storage-pile-presentation.test.mjs
```

Expected: both PNGs pass square/alpha checks and every presentation priority returns the literal expected name, icon, and category key.

- [ ] **Step 6: Commit assets and pure presentation**

```powershell
git add -- assets/storage/piles/journal-note.png assets/storage/piles/journal-notes.png tests/storage-asset.test.mjs tests/storage-pile-presentation.test.mjs scripts/data/storage-pile-presentation.js
git diff --cached --check
git commit -m "feat(storage): present journal notes on scene"
```

---

### Task 5: Preserve reference-only Journal rows through ground pile creation, merge, and refresh

**Files:**
- Modify: `tests/storage-ground-pile-service.test.mjs`
- Modify: `scripts/data/storage-ground-pile-service.js:205-280, 360-428, 463-505`

**Interfaces:**
- Consumes: `deriveGroundPilePresentation(..., { readJournalRowIds })` from Task 4.
- Produces: Journal-safe `StorageGroundPileService.transferToScene()` and marker-aware `refreshAfterStorageMutation()`.

- [ ] **Step 1: Add failing ground-pile lifecycle tests**

Define a canonical fixture without `itemData`:

```js
const journalNote = {
  rowKind: "journal", rowId: "source-note", stackKey: "",
  sourceId: "JournalEntry.gartar", sourceType: "journal",
  name: "Заметки Гартара", img: "icons/book.webp", quantity: 1
};
```

Add tests proving:

```js
const { service, tokens } = createHarness();
await service.transferToScene({
  row: journalNote, quantity: 1, sceneId: "scene",
  x: 300, y: 400, mutationId: "journal-first"
});
assert.equal(tokens[0].name, "Заметки Гартара");
assert.equal(tokens[0].texture.src.endsWith("/journal-note.png"), true);
assert.equal(readStorageState(tokens[0]).manualRows[0].itemData, undefined);

await service.transferToScene({
  row: { ...journalNote, rowId: "source-second", sourceId: "JournalEntry.second", name: "Вторая" },
  quantity: 1, sceneId: "scene", x: 300, y: 400, mutationId: "journal-second"
});
assert.equal(readStorageState(tokens[0]).manualRows.length, 2);
assert.deepEqual(readStorageState(tokens[0]).manualRows.map((row) => row.quantity), [1, 1]);
assert.equal(tokens[0].name, "Куча заметок");
```

Add an Item + Journal case that remains the Item, then claim/remove the Item and assert the surviving Journal becomes `Заметки Гартара`. Add a refresh state with `readJournalRowIds: [journalRowId]` and assert `Заметки Гартара (прочитано)` without deleting the token.

- [ ] **Step 2: Run the ground owner test and confirm RED**

```powershell
node --test tests/storage-ground-pile-service.test.mjs
```

Expected: FAIL because `#prepareRow()` adds `itemData`, Journal merge can stack, and presentation calls omit `readJournalRowIds`.

- [ ] **Step 3: Make row preparation and merging Journal-safe**

In `#prepareRow()` branch before Item quantity materialization:

```js
const prepared = clone(row);
prepared.rowId = clean(this.idFactory()) || `pile-row-${Date.now()}`;
if (isStorageJournalRow(prepared)) {
  if (amount !== 1) throw new Error("Ссылку на журнал можно положить только в количестве 1.");
  prepared.quantity = 1;
  prepared.stackKey = "";
  delete prepared.itemData;
  return prepared;
}
```

In the merge loop, always append an incoming Journal row rather than searching `rowIdentity()` and incrementing quantity:

```js
if (isStorageJournalRow(incoming)) {
  manualRows.push(clone(incoming));
  continue;
}
```

- [ ] **Step 4: Thread shared read markers into every presentation call**

For candidate, new-token, refresh, and legacy-repair calls, pass the state marker:

```js
deriveGroundPilePresentation(visibleRows(candidate), {
  coins: unclaimedCoins(candidate),
  preserveEmptyCoinPile: groundFlag.coinPile === true,
  readJournalRowIds: candidate.readJournalRowIds
});
```

Use `storage.readJournalRowIds`, `state.readJournalRowIds`, or `migration.state.readJournalRowIds` at the corresponding call site.

- [ ] **Step 5: Run ground and presentation tests and confirm GREEN**

```powershell
node --test tests/storage-ground-pile-service.test.mjs tests/storage-pile-presentation.test.mjs tests/storage-container-snapshot.test.mjs
```

Expected: Journal rows remain reference-only and quantity one, nearby rows merge correctly, Item/coin priorities remain intact, and marker refresh updates token name/icon without deleting the Journal-only pile.

- [ ] **Step 6: Commit ground lifecycle behavior**

```powershell
git add -- tests/storage-ground-pile-service.test.mjs scripts/data/storage-ground-pile-service.js
git diff --cached --check
git commit -m "fix(storage): preserve journal ground references"
```

---

### Task 6: Publish first-read state to the scene, open UIs, and public chat

**Files:**
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-app.test.mjs`
- Modify: `scripts/data/storage-command-service.js:520-584, 722-741`
- Modify: `scripts/ui/storage-app.js:150-175`

**Interfaces:**
- Consumes: `StorageService.markJournalRead() -> { changed, rowId, state }`, `StorageGroundPileService.refreshAfterStorageMutation(token, state)`, and injected `createChatMessage(data)`.
- Produces: one sanitized public message on the first successful read and shared `(прочитано)` presentation.

- [ ] **Step 1: Extend the command harness and add failing first-read tests**

Add `playerName = "Игрок"`, `createChatMessage = null`, and `logger = null` to the existing `createHarness()` destructuring. Replace the player fixture line with:

```js
const player = { id: "player", name: playerName, isGM: false };
const chatMessages = [];
const warnings = [];
```

Add these two fields to `commandDependencies`:

```js
createChatMessage: createChatMessage ?? (async (data) => {
  chatMessages.push(clone(data));
  return data;
}),
logger: logger ?? {
  warn(...args) { warnings.push(args); }
}
```

Return `chatMessages` and `warnings` from the harness.

Add a test with HTML-bearing names:

```js
const harness = createHarness({
  playerName: "<Игрок>",
  journalReader: { async read() { return { name: "Snapshot", pages: [] }; } }
});
await harness.storageService.configure(harness.storageToken, {
  state: "opened",
  manualRows: [{
    rowKind: "journal", rowId: "journal-row", stackKey: "",
    sourceId: "JournalEntry.notes", sourceType: "journal",
    name: "Запись <тайна>", quantity: 1
  }]
});
const request = {
  tokenUuid: harness.storageToken.uuid,
  characterTokenUuid: harness.characterToken.uuid,
  rowId: "journal-row"
};
await harness.service.readJournal(request, { sender: harness.player });
await harness.service.readJournal(request, { sender: harness.player });
assert.equal(harness.refreshCalls.length, 1);
assert.equal(harness.chatMessages.length, 1);
assert.equal(harness.chatMessages[0].whisper, undefined);
assert.match(harness.chatMessages[0].content, /&lt;Игрок&gt;.*Запись &lt;тайна&gt;/u);
assert.equal(JSON.stringify(harness.chatMessages).includes("JournalEntry.notes"), false);
```

Extend the reader-failure test to assert zero refresh/chat. Add a `createChatMessage` rejection case that still leaves `readJournalRowIds` committed and records one warning. For nested Journal state, assert refresh receives the root scene token and the live root state from `readStorageState(access.storageToken)`, not the nested `marked.state`.

Change `storage-app.test.mjs` literal expectations from `(прочитана)` to `(прочитано)` and retain the existing `updateToken` / `${MODULE_ID}.storageUpdated` subscription tests as proof that other open clients refresh from the authoritative token update.

- [ ] **Step 2: Run command and UI tests and confirm RED**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-app.test.mjs
```

Expected: FAIL because `readJournal()` ignores `markJournalRead().changed`, does not refresh/publish, and UI still uses `(прочитана)`.

- [ ] **Step 3: Add a sanitized Journal read publisher**

Add a private method beside `#publishClaimMessage()`:

```js
async #publishJournalReadMessage({ sender, row } = {}) {
  if (!this.createChatMessage) return false;
  const readerName = escapeFoundryHtml(clean(sender?.name) || "Игрок");
  const journalName = escapeFoundryHtml(clean(row?.name) || "Запись");
  try {
    await this.createChatMessage({
      content: `<p><strong>${readerName}</strong> прочитал запись «<strong>${journalName}</strong>».</p>`
    });
    return true;
  }
  catch (error) {
    this.logger?.warn?.(`${MODULE_ID} | Storage Journal read ChatMessage creation failed.`, error);
    return false;
  }
}
```

- [ ] **Step 4: Refresh and publish only after the first committed marker**

Replace the ignored marker result with:

```js
const marked = await this.storageService.markJournalRead(access.storageToken, rowId, { path });
if (marked.changed === true) {
  const rootState = readStorageState(access.storageToken);
  await this.groundPileService?.refreshAfterStorageMutation?.(access.storageToken, rootState);
  await this.#publishJournalReadMessage({ sender, row });
}
return snapshot;
```

Keep reader execution before marker write. Do not publish or refresh when the reader throws or `changed === false`; do not roll back the marker if chat creation fails.

- [ ] **Step 5: Update the shared UI suffix**

In `StorageApp` change only the Journal read suffix:

```js
const itemName = item.journalRead
  ? `${baseItemName} (прочитано)`
  : baseItemName;
```

- [ ] **Step 6: Run focused read, pile, and UI tests and confirm GREEN**

```powershell
node --test tests/storage-socket.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-app.test.mjs tests/storage-service.test.mjs
```

Expected: first read commits marker → refreshes root pile → publishes one safe public message; retry and reader failure produce no extra presentation effects; chat failure does not undo the marker; open apps continue refreshing through existing hooks.

- [ ] **Step 7: Commit shared read presentation**

```powershell
git add -- tests/storage-socket.test.mjs tests/storage-app.test.mjs scripts/data/storage-command-service.js scripts/ui/storage-app.js
git diff --cached --check
git commit -m "feat(storage): announce first journal reads"
```

---

### Task 7: Document contracts, bump browser cache keys, and verify the release

**Files:**
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `README.md:14-18, 258-311`
- Modify: `docs/function-passport.md:129-162`
- Modify: `module.json`
- Create: `scripts/main-1.4.161.js`
- Modify: `scripts/main.js` import cache keys for `storage-command-service.js`, `storage-ground-pile-service.js`, and `storage-transfer-drop.js`
- Modify: `scripts/data/storage-ground-pile-service.js` import cache key for `storage-pile-presentation.js`

**Interfaces:**
- Consumes: all public methods, command names, signatures, priorities, and test evidence from Tasks 1-6.
- Produces: current user documentation, current function passport, and release entrypoint `1.4.161`.

- [ ] **Step 1: Make release metadata tests fail on the old version**

Update registration/composition expectations to require:

```js
assert.equal(manifest.version, "1.4.161");
assert.deepEqual(manifest.esmodules, ["scripts/main-1.4.161.js"]);
assert.equal(forwarder.trim(), [
  "// @rebreya-role versioned-entrypoint-cache-forwarder",
  "import \"./main.js?v=1.4.161-journal-scene-items\";"
].join("\n"));
```

Update exact cache-key assertions for the four changed Storage modules to `1.4.161-journal-scene-items`.

- [ ] **Step 2: Run release-focused tests and confirm RED**

```powershell
node --test tests/storage-main-registration.test.mjs tests/main-composition-root.test.mjs
```

Expected: FAIL against version `1.4.160`, the old forwarder, and old Storage import cache keys.

- [ ] **Step 3: Update manifest, forwarder, and changed-module cache keys**

Set `module.json` to:

```json
"version": "1.4.161",
"esmodules": [
  "scripts/main-1.4.161.js"
]
```

Create the forwarder with exactly:

```js
// @rebreya-role versioned-entrypoint-cache-forwarder
import "./main.js?v=1.4.161-journal-scene-items";
```

Keep all composition in `scripts/main.js`; only update the query strings of changed imports.

- [ ] **Step 4: Update README and function passport to current behavior**

In `README.md`, document:

```text
dropStorageJournalToScene(journalUuid, { sceneId, x, y, mutationId? })
```

State the Notes-layer/native boundary, GM-only authoritative re-resolution, quantity-one/non-claimable rule, one-note/two-note presentation, `(прочитано)` marker, and one public first-read chat message.

In `docs/function-passport.md` update the Storage section with the exact validator, command, public API, service method, payload, fingerprint binding, presentation signature/priority, reference-only ground merge rule, read refresh order, ChatMessage failure policy, cache keys, and focused tests. Replace the old UI suffix `(прочитана)` with `(прочитано)` and add `storage.journal.drop-to-scene` to the typed command list.

- [ ] **Step 5: Run the complete focused Storage suite**

```powershell
node --test tests/storage-transfer-drop.test.mjs tests/storage-deposit-source.test.mjs tests/storage-socket.test.mjs tests/storage-pile-presentation.test.mjs tests/storage-ground-pile-service.test.mjs tests/storage-app.test.mjs tests/storage-service.test.mjs tests/storage-asset.test.mjs tests/storage-main-registration.test.mjs tests/main-composition-root.test.mjs tests/security.test.mjs
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 6: Run the complete project verification once on unchanged HEAD**

```powershell
$ErrorActionPreference = 'Stop'
node --test tests/*.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }
git diff --check
if ($LASTEXITCODE -ne 0) { throw "git diff --check failed" }
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
}
$json = git ls-files '*.json'
foreach ($file in $json) {
  Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null
}
```

Record the total passed/failed count and any real errors. Do not rerun the full suite unless HEAD or the working tree changes afterward.

- [ ] **Step 7: Perform the Foundry smoke test**

On Foundry VTT 13 after every connected client reloads `1.4.161`:

1. Select Journal Notes tools and drop a `JournalEntry`; verify Foundry creates a native Note and Rebreya creates no pile.
2. Select Token tools and drop the same Journal; verify a 0.5×0.5 note token with the Journal name and `journal-note.png`.
3. Drop a second Journal at the same point; verify `Куча заметок` and `journal-notes.png`.
4. Drop a book Item at the same point; verify the token shows the book, not a pile of notes/items.
5. Remove/claim only the book; verify the remaining note presentation returns without allowing Journal claim.
6. Read the note as a player; verify all clients see `<имя> (прочитано)` and one public chat message naming the reader and note.
7. Read it again; verify no second public message.
8. Confirm the source Journal name, pages, ownership, and flags are unchanged.

- [ ] **Step 8: Commit and push the completed implementation**

Before commit inspect only task files with `git status --short`, `git diff --stat`, and a substantive `git diff`. Then:

```powershell
git add -- README.md docs/function-passport.md module.json scripts/main-1.4.161.js scripts/main.js scripts/data/storage-ground-pile-service.js tests/storage-main-registration.test.mjs tests/main-composition-root.test.mjs
git diff --cached --check
git commit -m "docs(storage): publish journal scene item behavior"
git push -u origin lich_branch
```

Verify `git status --short --branch` is clean and `git rev-parse HEAD` equals `git rev-parse origin/lich_branch`.

---

## Completion Criteria

- Native Foundry Note creation remains exclusive to the active Notes layer.
- Non-Notes Journal drops use one GM-only typed command and one authoritative Journal resolver.
- One reference shows its source name/icon, two references show `Куча заметок`, and ordinary Items/coins retain priority.
- Journal rows stay quantity one, reference-only, non-stackable, and non-claimable.
- First successful read updates the scene token and every open Storage UI, adds `(прочитано)`, and publishes exactly one sanitized public message.
- Reader failure, chat failure, duplicate drop, duplicate read, forged payload, and non-GM command paths satisfy the specified failure policies.
- Both new PNGs are square, visibly useful at token scale, and contain real alpha transparency.
- README, `docs/function-passport.md`, manifest version, cache keys, and forwarder describe the shipped `1.4.161` state.
- Focused and full verification pass; all commits are pushed only to `origin/lich_branch` without force push.
