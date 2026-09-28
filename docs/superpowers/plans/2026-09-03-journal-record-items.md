# Journal Record Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a character record a storage Journal reference as one idempotent inventory Item and reopen its exact source by clicking the Item name.

**Architecture:** Extend the existing storage Journal command/viewer route. `StorageCommandService` remains authoritative for Actor/source resolution and delegates only pure record-flag/item-data shaping to a small data helper; the existing dnd5e sheet integration binds direct clicks only for valid record Items and reuses the existing sanitized viewer.

**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, ApplicationV2 `DialogV2`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-03-journal-record-items-design.md`

## Global Constraints

- Work only on `lich_branch`, starting implementation from commit `5a381199`.
- Persist records as dnd5e `loot` Items with `flags.rebreya-main.journalRecord` version `1`; do not add a manifest Item type.
- Preserve the current `StorageJournalReader`, `StorageJournalViewer`, storage access checks, marker behavior, and ordinary Foundry Journal/Item actions.
- Player mutations and protected reads route through exact typed commands to active GM.
- Duplicate identity is exact `(documentName, sourceUuid)` within one Actor; deletion allows recreation.
- Version client changes as `1.4.217` with an import-only `scripts/main-1.4.217.js` and fresh relevant cache keys.
- Update `README.md` and the Journal/storage section of `docs/function-passport.md` for all public/new/changed methods.

---

### Task 1: Pure Journal record Item contract

**Files:**
- Create: `scripts/data/journal-record-item.js`
- Create: `tests/journal-record-item.test.mjs`

**Interfaces:**
- Produces: `readJournalRecordFlag(item) -> { version:1, sourceUuid, documentName } | null`
- Produces: `isJournalRecordItem(item) -> boolean`
- Produces: `findJournalRecordItem(actor, reference) -> Item | null`
- Produces: `buildJournalRecordItemData(row) -> plain ItemData`

- [ ] **Step 1: Write failing contract tests**

Cover exact Journal/page flags, malformed versions/names/UUIDs, exact identity matching, distinct page/parent identity, and detached ItemData:

```js
const data = buildJournalRecordItemData({
  sourceId: "JournalEntry.notes.JournalEntryPage.page-a",
  sourceDocumentName: "JournalEntryPage",
  name: "Полевые заметки",
  img: ""
});
assert.equal(data.type, "loot");
assert.deepEqual(data.flags[MODULE_ID].journalRecord, {
  version: 1,
  sourceUuid: "JournalEntry.notes.JournalEntryPage.page-a",
  documentName: "JournalEntryPage"
});
assert.equal(data.img, "icons/svg/book.svg");
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/journal-record-item.test.mjs`

Expected: FAIL because `scripts/data/journal-record-item.js` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Use exact-key/trimmed validation for the flag, compare only `sourceUuid` and `documentName`, iterate `actor.items.contents` or the collection iterator, and construct quantity-one/zero-weight/zero-price ItemData without retaining the source row object.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/journal-record-item.test.mjs`

Expected: all tests pass.

### Task 2: Authoritative record and read-record commands

**Files:**
- Modify: `scripts/data/storage-command-service.js`
- Modify: `tests/storage-socket.test.mjs`

**Interfaces:**
- Produces validator `isValidStorageJournalRecordPayload(payload)` for exact `{ tokenUuid, characterTokenUuid, rowId, mutationId, path? }`
- Produces validator `isValidJournalRecordReadPayload(payload)` for exact `{ itemUuid }`
- Produces `StorageCommandService.recordJournal(payload,{sender}) -> {created,actorId,itemId,itemUuid}`
- Produces `StorageCommandService.readJournalRecord(payload,{sender}) -> {name,pages}`

- [ ] **Step 1: Add failing validator and service tests**

Assert that record execution repeats `#resolveAccess`, requires opened/unclaimed canonical Journal row and character Actor, writes one embedded Item to `access.character`, persists exact authoritative reference, reuses the existing Item on sequential/concurrent retries, and recreates after deletion. Assert page/parent distinction.

Assert read-record live-resolves only an embedded Item, validates its flag and parent character Actor, allows GM or OWNER sender, calls the injected `journalReader` with the exact stored UUID/document name, returns its UUID-free snapshot, and does not call storage marker/refresh/chat paths. Assert malformed/unmarked Items and non-owners fail closed.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-socket.test.mjs`

Expected: FAIL because validators/methods are missing.

- [ ] **Step 3: Implement the minimal command paths**

Import Task 1 helpers. Execute `recordJournal` inside the existing root `storageQueueKey(tokenUuid)` queue, build identity only from the authoritative row, and call `access.character.createEmbeddedDocuments("Item", [itemData], { renderSheet: false })` only when no matching Item exists. `readJournalRecord` must use an injected UUID resolver and `sender.testUserPermission`/Actor ownership checks without storage proximity.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/storage-socket.test.mjs tests/journal-record-item.test.mjs`

Expected: all tests pass.

### Task 3: Viewer and ordinary storage-read action

**Files:**
- Modify: `scripts/ui/storage-journal-viewer.js`
- Modify: `scripts/ui/storage-app.js`
- Modify: `tests/storage-journal-viewer.test.mjs`
- Modify: `tests/storage-app.test.mjs`

**Interfaces:**
- Changes: `openStorageJournalViewer(snapshot,{onRecord?,renderTemplate?,dialogClass?})`
- Consumes: public `recordStorageJournal(tokenUuid,rowId,mutationId,request)`

- [ ] **Step 1: Add failing UI tests**

Assert ordinary reads create only `{action:"record",label:"Записать"}`, invoke one stable callback, close after `{created:true|false}`, keep the dialog open on rejection, and show the exact created/existing notifications. Assert a call without `onRecord` creates `buttons: []`.

Assert `StorageApp.#readJournal` supplies an `onRecord` callback carrying its exact token/path/character context and refreshes only the established storage state path.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-journal-viewer.test.mjs tests/storage-app.test.mjs`

Expected: FAIL because the viewer is close-only and the callback is absent.

- [ ] **Step 3: Implement viewer capability and callback**

Construct the record button only when `onRecord` is a function. Give it a callback that awaits the operation, emits the exact notification, and returns normally only on success; do not render source metadata. Generate one mutation ID in `StorageApp.#readJournal` for the displayed viewer and reuse it if the button callback is invoked again.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/storage-journal-viewer.test.mjs tests/storage-app.test.mjs`

Expected: all tests pass.

### Task 4: Composition root, typed routes, and public API

**Files:**
- Modify: `scripts/main.js`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `tests/storage-module-api.test.mjs`
- Modify: `tests/security.test.mjs`

**Interfaces:**
- Produces constants `STORAGE_JOURNAL_RECORD_COMMAND = "storage.journal.record"` and `STORAGE_JOURNAL_READ_RECORD_COMMAND = "storage.journal.read-record"`
- Produces public `recordStorageJournal(tokenUuid,rowId,mutationId="",request={})`
- Produces public `readJournalRecord(itemUuid)`

- [ ] **Step 1: Add failing registration/API tests**

Assert both routes use exact validators, authenticated senders, and active-GM direct execution versus player socket routing. Assert recording captures the controlled character token and stable mutation ID, while read-record sends only `{itemUuid}`. Assert no raw socket listener or client-side `createEmbeddedDocuments` path is introduced.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-main-registration.test.mjs tests/storage-module-api.test.mjs tests/security.test.mjs`

Expected: FAIL because commands and API methods are absent.

- [ ] **Step 3: Wire the existing owner**

Inject `fromUuid` into `StorageCommandService`, register the two typed routes beside `storage.journal.read`, and add the two public methods using `isActiveGmClient` and `socketCommandBus.request` exactly like the existing Journal API.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/storage-main-registration.test.mjs tests/storage-module-api.test.mjs tests/security.test.mjs`

Expected: all tests pass.

### Task 5: Direct dnd5e inventory link

**Files:**
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Create: `tests/dnd5e-journal-record-link.test.mjs`

**Interfaces:**
- Consumes: `isJournalRecordItem(item)` and public `readJournalRecord(item.uuid)`
- Consumes: existing `openStorageJournalViewer(snapshot)` in buttonless mode

- [ ] **Step 1: Add failing DOM integration tests**

Build an Actor-sheet root containing the real dnd5e inventory row/item-name selector used by the current sheet integration. Assert only a valid flagged Item gets one idempotent click listener; clicking prevents the ordinary action, calls `readJournalRecord` with the embedded Item UUID, and opens the returned snapshot with no record callback. Assert unmarked/malformed Items and ordinary Journal links receive no listener and retain default events.

- [ ] **Step 2: Run RED**

Run: `node --test tests/dnd5e-journal-record-link.test.mjs`

Expected: FAIL because the binding does not exist.

- [ ] **Step 3: Extend the existing actor-sheet render owner**

Add one exported focused binder used from the existing `onRenderActorSheet` character branch. Resolve row Item IDs against the authoritative rendered Actor collection, mark bound controls with a module-owned dataset key, and import/reuse the existing viewer. Do not register another hook.

- [ ] **Step 4: Run GREEN and related sheet regressions**

Run: `node --test tests/dnd5e-journal-record-link.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/item-sheet-branding.test.mjs`

Expected: all tests pass.

### Task 6: Version, cache graph, docs, and full verification

**Files:**
- Modify: `module.json`
- Create: `scripts/main-1.4.217.js`
- Modify: relevant imports in `scripts/main.js` and integration files
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `README.md`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Manifest version/entrypoint: `1.4.217` / `scripts/main-1.4.217.js`
- Runtime forwarder contents: `import "./main.js";`

- [ ] **Step 1: Add failing manifest/cache assertions**

Assert version `1.4.217`, exact entrypoint, import-only forwarder, and fresh `1.4.217-journal-record-items` keys for every changed runtime import edge.

- [ ] **Step 2: Run RED**

Run: `node --test tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs`

Expected: FAIL against version `1.4.216` and stale imports.

- [ ] **Step 3: Update version, cache graph, README, and passport**

Document the two public API methods, exact typed payloads, Actor authorization, flag schema, viewer modes, direct-click boundary, and idempotency contract. Keep the passport current-state-only.

- [ ] **Step 4: Run all focused tests**

Run:

```powershell
node --test tests/journal-record-item.test.mjs tests/storage-journal-viewer.test.mjs tests/storage-app.test.mjs tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/storage-module-api.test.mjs tests/dnd5e-journal-record-link.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/item-sheet-branding.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs
```

- [ ] **Step 5: Run the complete repository verification once**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

- [ ] **Step 6: Inspect and publish**

Run `git status --short --branch`, `git diff --stat`, and substantive `git diff`. Stage only files listed by this plan, commit with an informative message, and `git push -u origin lich_branch` without force.
