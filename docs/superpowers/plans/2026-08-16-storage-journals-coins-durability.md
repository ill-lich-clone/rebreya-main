# Storage Journals, Coin Piles, and Ground-Item Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver secure storage Journal reading, managed physical-coin templates and persistent coin piles, tooltip suppression, and canonical durability projection for every eligible ground Item.

**Architecture:** Keep `scripts/main.js` as the only composition root and extend the existing storage owner instead of adding a parallel inventory or currency subsystem. Journal rows remain authoritative references validated and rendered by the active GM; coin templates are managed drag sources whose values are converted into `manualCoins`; ground-pile presentation derives from visible Item rows, unclaimed coins, and a persisted pure-coin identity; durability is derived non-mutatingly before the source can be consumed.

**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, ApplicationV2/Handlebars, exact-key typed socket commands, Node 24 test runner, PNG/zlib verification, Codex `imagegen` skill.

## Global Constraints

- Read `docs/superpowers/specs/2026-08-16-storage-journals-coins-durability-design.md` completely before implementation; its base commit is `a84c998`.
- Preserve Foundry VTT 13, dnd5e, and `statuscounter >= 3.0.4` compatibility.
- `manualCoins` remains the only owner of physical currency; managed Coin Items are drag templates and must never become ordinary storage or ground rows.
- Do not create a second storage/inventory owner; extend `StorageService`, `StorageCommandService`, and `StorageGroundPileService`.
- Never change `JournalEntry.ownership`, grant temporary ownership, or open the normal Journal sheet on the player client.
- Resolve a Journal UUID only from the authoritative unclaimed row at the validated token/path/row ID; the read payload must contain no Journal UUID.
- Remove unrevealed `section.secret` content on the active GM before serializing a player response; CSS-only hiding is forbidden.
- Journal rows cannot be claimed, dragged, quantity-edited, transferred, or materialized as dnd5e Items; GM deletion of a broken reference remains available.
- Coin mutations and managed-template sync execute on the active GM; stable mutation IDs must make retries non-duplicating.
- Preserve existing damaged/broken durability exactly. Derive only missing eligible durability through `DurabilityService`, without updating world or compendium source documents.
- `scripts/main.js` remains the sole composition root. The current versioned forwarder and the new release forwarder may only import `scripts/main.js`.
- Use TDD for every behavior task: add the focused test, run it and observe the expected failure, then write the minimum production change.
- Every new, changed, or removed method and typed command must be reflected in sections 8 and/or 14 of `docs/function-passport.md` in the same commit as the code.
- Update `README.md` in the same commit whenever the public module API changes.
- Do not use `git add -A`; stage only the files named by the current task.

## Mandatory Git Preflight and Stop Conditions

Run before the first implementation edit:

```powershell
git status --short --branch
git branch --show-current
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git log --oneline HEAD..origin/main
git rev-list --left-right --count HEAD...origin/lich_branch
git log --oneline HEAD..origin/lich_branch
git merge-base --is-ancestor a84c998 HEAD
```

Expected starting state:

- branch is exactly `lich_branch`;
- worktree has no unrelated or foreign changes;
- `HEAD...origin/main` reports zero commits behind;
- `HEAD...origin/lich_branch` reports `0 0`;
- `a84c998` is an ancestor of `HEAD`.

Stop and report to the user instead of editing if the branch is not `lich_branch`, the worktree contains somebody else's changes, `origin/lich_branch` is ahead, `origin/main` introduces conflicting work, or the base commit is absent. Never force-push.

## File and Interface Map

### New production files

- `scripts/data/storage-journal-reader.js` — whitelist and sanitize a live `JournalEntry` into a serializable read-only player snapshot.
- `scripts/data/builtin-coin-template-service.js` — immutable denomination catalog plus active-GM world folder/Item reconciliation.
- `scripts/ui/storage-journal-viewer.js` — open a snapshot-only DialogV2 reader without resolving a Journal UUID client-side.
- `templates/storage-journal-viewer.hbs` — render sanitized text and whitelisted media pages with no edit/export/drag controls.
- `assets/storage/piles/coins.png` — original mixed-denomination pile token with verified non-opaque alpha.
- `scripts/main-1.4.140.js` — import-only release forwarder.

### New focused tests

- `tests/storage-journal-reader.test.mjs` — secret stripping, live refresh, whitelisting, missing Journal behavior, and ownership immutability.
- `tests/storage-journal-viewer.test.mjs` — snapshot-only read-only viewer contract.
- `tests/builtin-coin-template-service.test.mjs` — folder/template reconciliation, repair, duplicate safety, and non-active-GM no-op.
- `tests/storage-asset.test.mjs` — PNG signature, color type, decompressed alpha samples, and subject coverage.

### Existing production owners to modify

- `scripts/data/storage-container-snapshot.js` — normalize and identify reference-only Journal rows.
- `scripts/data/storage-container-item-service.js` — retain Journal references in portable snapshots while never creating Journal Items.
- `scripts/data/storage-service.js` — preserve reference rows and reject claim/quantity mutation for them.
- `scripts/data/storage-deposit-source.js` — resolve authoritative Journal and managed coin-template sources; reject Journal storage-row moves.
- `scripts/data/storage-command-service.js` — exact validators, access/security checks, active-GM Journal/coin routes, and pre-consumption durability preparation.
- `scripts/data/storage-ground-pile-service.js` — coin-map merges, persistent pure-coin marker, retry lookup, and cleanup rules.
- `scripts/data/storage-pile-presentation.js` — derive names/textures from rows plus coins.
- `scripts/data/durability-service.js` — expose non-mutating existing-or-derived durability.
- `scripts/data/durability-rules.js` — make managed Coin Items explicitly ineligible.
- `scripts/ui/storage-transfer-ui.js` — validate bounded embedded-coin and unbounded world-template quantities.
- `scripts/integrations/storage-transfer-drop.js` — branch managed Coin Item drops to the coin API.
- `scripts/ui/storage-app.js`, `templates/storage-app.hbs`, `styles/main.css` — Journal-only actions/viewer and expanded-tooltip suppression.
- `scripts/main.js` — construct services, register commands, publish APIs, sync templates, and update cache keys.
- `module.json` — patch release version and import-only forwarder entry.

### Exact interfaces produced by this plan

```js
// scripts/data/storage-container-snapshot.js
export function isStorageJournalRow(row): boolean;

// scripts/data/storage-journal-reader.js
export class StorageJournalReader {
  async read(journalUuid): Promise<StorageJournalSnapshot>;
}

// scripts/data/builtin-coin-template-service.js
export const BUILTIN_COIN_FOLDER_NAME = "МОНЕТЫ";
export const BUILTIN_COIN_TEMPLATE_FLAG = "storageCoinTemplate";
export const BUILTIN_COIN_TEMPLATES: readonly CoinTemplateDefinition[];
export function readBuiltinCoinDenomination(item): "pp" | "gp" | "sp" | "cp" | "";
export function buildBuiltinCoinItemData(definition, folderId): object;
export class BuiltinCoinTemplateService {
  async sync(): Promise<{folder, items} | null>;
}

// scripts/data/durability-service.js
DurabilityService.prototype.getOrBuildDurability = async function(item, options = {}): Promise<object | null>;

// scripts/data/storage-pile-presentation.js
export function deriveGroundPilePresentation(
  rows = [],
  { coins = {}, preserveEmptyCoinPile = false } = {}
): {name: string, img: string, categoryKey: string};

// scripts/data/storage-ground-pile-service.js
StorageGroundPileService.prototype.findProcessedMutationAtPoint = function({sceneId, x, y, mutationId});
StorageGroundPileService.prototype.transferCoinsToScene = async function({coins, sceneId, x, y, mutationId, ownerUserId = ""});

// public module API in scripts/main.js
readStorageJournal(tokenUuid, rowId, request = {}): Promise<StorageJournalSnapshot>;
dropStorageCoinsToScene(itemUuid, denomination, request = {}): Promise<object>;

// exact typed commands
export const STORAGE_JOURNAL_READ_COMMAND = "storage.journal.read";
export const STORAGE_COIN_DROP_COMMAND = "storage.coin.drop";
```

The Journal snapshot is deliberately UUID-free:

```js
{
  rowId: "journal-row",
  name: "Полевые заметки",
  img: "icons/sundries/books/book-red-exclamation.webp",
  pages: [{
    pageId: "page-1",
    name: "Вход",
    type: "text",
    sort: 0,
    title: { show: true, level: 1 },
    content: "<p>Только публичный текст</p>",
    src: "",
    caption: ""
  }]
}
```

The exact socket payloads are:

```js
// storage.journal.read
{
  tokenUuid: "Scene.scene.Token.chest",
  characterTokenUuid: "Scene.scene.Token.hero",
  rowId: "journal-row",
  path: ["bag-row"] // omitted at root
}

// storage.coin.drop
{
  itemUuid: "Item.gold-template",
  denomination: "gp",
  characterTokenUuid: "Scene.scene.Token.hero",
  sceneId: "scene",
  x: 320,
  y: 480,
  quantity: 25,
  mutationId: "storage-coin-drop-..."
}
```

---

### Task 1: Suppress the tooltip while a storage popover is expanded

**Files:**
- Modify: `tests/storage-app.test.mjs:228-240`
- Modify: `styles/main.css:1085-1137,12993-13005`

**Interfaces:**
- Consumes: existing `aria-expanded="{{active}}"` on `.rm-storage-item__icon`.
- Produces: a storage-scoped CSS override; no JavaScript or public API changes.

- [ ] **Step 1: Add the failing CSS contract test**

Add an assertion beside the current tooltip-anchor assertions:

```js
assert.match(
  css,
  /\.rm-storage-item__icon\.rm-tooltip-anchor\[aria-expanded="true"\]\[data-rm-tooltip\]::before,[\s\S]*?::after\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden/isu
);
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
node --test tests/storage-app.test.mjs
```

Expected: FAIL because no expanded-state rule forces the pseudo-elements back to hidden.

- [ ] **Step 3: Add the storage-specific override after the global tooltip rules**

```css
.rm-storage-item__icon.rm-tooltip-anchor[aria-expanded="true"][data-rm-tooltip]::before,
.rm-storage-item__icon.rm-tooltip-anchor[aria-expanded="true"][data-rm-tooltip]::after {
  opacity: 0;
  visibility: hidden;
  transform: translate(-50%, 4px);
}
```

Do not remove focus, alter popover focus management, or change z-index/pointer events.

- [ ] **Step 4: Re-run the focused test**

Run `node --test tests/storage-app.test.mjs`.

Expected: all storage-app tests PASS.

- [ ] **Step 5: Commit only this UI fix**

```powershell
git add tests/storage-app.test.mjs styles/main.css
git commit -m "fix: hide expanded storage item tooltips"
```

### Task 2: Add the Journal reference-row model and portable-container preservation

**Files:**
- Modify: `tests/storage-container-snapshot.test.mjs:39-157`
- Modify: `tests/storage-container-item-service.test.mjs`
- Modify: `scripts/data/storage-container-snapshot.js:46-93,135-184,149-163`
- Modify: `scripts/data/storage-container-item-service.js:193-230,284-355`
- Modify: `docs/function-passport.md`, section 8 only

**Interfaces:**
- Produces: `isStorageJournalRow(row)` and canonical row shape `{rowKind:"journal", rowId, sourceId, sourceType:"journal", name, img, quantity:1}`.
- Preserves: the UUID reference and row ID through normalization/rekeying/portable snapshot capture.
- Prohibits: `itemData` or embedded Item creation for a Journal row.

- [ ] **Step 1: Write failing snapshot tests**

Cover root and nested rows, portable serialization, and rekeying:

```js
const journal = {
  rowKind: "journal",
  rowId: "journal-row",
  sourceId: "JournalEntry.secret-notes",
  sourceType: "journal",
  name: "Полевые заметки",
  img: "icons/book.webp",
  quantity: 99,
  itemData: { type: "loot" }
};
const normalized = buildStorageContainerSnapshot(snapshot("root", "Сундук", [journal]));
assert.deepEqual(normalized.state.manualRows[0], {
  rowKind: "journal",
  rowId: "journal-row",
  stackKey: "",
  sourceId: "JournalEntry.secret-notes",
  sourceType: "journal",
  name: "Полевые заметки",
  img: "icons/book.webp",
  quantity: 1
});
assert.equal(isStorageJournalRow(normalized.state.manualRows[0]), true);
assert.equal("itemData" in normalized.state.manualRows[0], false);
assert.equal(rekeyStorageContainerSnapshot(normalized).state.manualRows[0].sourceId, "JournalEntry.secret-notes");
```

In `storage-container-item-service.test.mjs`, materialize a container containing one ordinary Item plus a Journal row. Assert that only the root and ordinary Item are sent to `createEmbeddedDocuments`, then capture the root again and assert the Journal row remains in its stored snapshot.

- [ ] **Step 2: Run the two focused files and verify RED**

```powershell
node --test tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs
```

Expected: FAIL because Journal rows currently normalize as Item rows and `#materializeChildren` attempts to create a dnd5e Item.

- [ ] **Step 3: Implement canonical Journal normalization**

Add `normalizeJournalRow` before `normalizeRows` and route Journal rows before container/item normalization:

```js
export function isStorageJournalRow(row) {
  return row?.rowKind === "journal" || clean(row?.sourceType) === "journal";
}

function normalizeJournalRow(row, createId) {
  return {
    rowKind: "journal",
    rowId: clean(row?.rowId) || createId("journal"),
    stackKey: "",
    sourceId: clean(row?.sourceId),
    sourceType: "journal",
    name: clean(row?.name) || "Журнал",
    img: clean(row?.img),
    quantity: 1
  };
}
```

Reject a missing `sourceId` with a deterministic `TypeError`; do not silently convert a broken shape into an Item.

- [ ] **Step 4: Prevent portable Item materialization while preserving references**

Import `isStorageJournalRow`. In `#materializeChildren`, `continue` before `plainItemData` for Journal rows. In `captureFromItem`, merge unclaimed Journal rows from `base.state.manualRows` and `base.state.generatedRows` into the reconstructed physical child rows, reset them into `manualRows`, and include them when deriving `opened` versus `empty`.

The merge must clone reference rows and deduplicate by `rowId`; it must not call `fromUuid` or create an Item.

- [ ] **Step 5: Re-run focused tests**

Run the Step 2 command.

Expected: both files PASS; existing nested Item/container tests remain unchanged.

- [ ] **Step 6: Update passport section 8 and commit**

Document the new `isStorageJournalRow()` contract, reference-only data flow, portable snapshot rule, and focused tests.

```powershell
git add scripts/data/storage-container-snapshot.js scripts/data/storage-container-item-service.js tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs docs/function-passport.md
git commit -m "feat: preserve journal references in storage snapshots"
```

### Task 3: Resolve Journal deposits authoritatively and block every Item-transfer path

**Files:**
- Modify: `tests/storage-deposit-source.test.mjs:91-126,207-239,436-500`
- Modify: `tests/storage-service.test.mjs`
- Modify: `tests/storage-socket.test.mjs:194-237,554-623`
- Modify: `scripts/data/storage-deposit-source.js:88-115,135-197,300-358,448-461`
- Modify: `scripts/data/storage-service.js:116-177,418-489,492-608`
- Modify: `scripts/data/storage-command-service.js:52-70,118-128,364-461,501-605`
- Modify: `scripts/main.js:3261-3308`
- Modify: `docs/function-passport.md`, section 8 only

**Interfaces:**
- Consumes: Foundry drag data `{type:"JournalEntry", uuid}`.
- Produces: deposit source `{kind:"journal", mode:"copy", available:1, row, sourceKey, journal, canUserMove, consume, restore}`.
- Security: only `sender.isGM === true` may deposit; resolving a `JournalEntryPage`, arbitrary UUID, or Journal storage-row drag fails.

- [ ] **Step 1: Add failing deposit-source tests**

```js
assert.deepEqual(parseStorageDepositDragData({
  type: "JournalEntry",
  uuid: "JournalEntry.notes"
}), { kind: "journal", journalUuid: "JournalEntry.notes" });
assert.equal(parseStorageDepositDragData({
  type: "JournalEntryPage",
  uuid: "JournalEntry.notes.JournalEntryPage.page"
}), null);
```

Resolve a fake `{documentName:"JournalEntry"}` and assert the exact canonical row, `available === 1`, `mode === "copy"`, GM-only `canUserMove`, a `{kind:"copy"}` receipt, and zero Journal updates/deletes. Resolve the same source to a `JournalEntryPage` and expect rejection.

Add a source-storage test asserting `resolveStorageDepositSource({kind:"storage-row", ...})` rejects a Journal row before cloning/claiming it. Extend `singleGroundItem` coverage so a Journal-only pile is never converted to an Item source.

- [ ] **Step 2: Add failing service/socket guards**

Assert all of the following:

```js
await assert.rejects(storageService.claim(token, {
  kind: "row", rowId: "journal-row", quantity: 1
}), /журнал.*нельзя забрать/iu);

await assert.rejects(storageService.updateRowQuantity(token, "journal-row", 2), /журнал/iu);

assert.equal(isValidStorageDepositPayload({
  tokenUuid: token.uuid,
  characterTokenUuid: "",
  source: { kind: "journal", journalUuid: "JournalEntry.notes" },
  quantity: 1,
  mutationId: "journal-deposit"
}), true);
```

Also assert extra keys fail, quantity other than `1` fails at execution, player deposit is rejected before `consume`, GM deposit stores one reference row, `claimRow` rejects it before inventory/materialization, and GM `deleteStorageRow` still removes it.

- [ ] **Step 3: Run the focused files and verify RED**

```powershell
node --test tests/storage-deposit-source.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs
```

Expected: FAIL because Journal drag data and exact source keys are unsupported and Journal rows enter generic quantity/claim paths.

- [ ] **Step 4: Implement the Journal source**

Add `isJournalEntryDocument`, `buildJournalRow`, and `resolveJournalSource`. The source must resolve `sourceRef.journalUuid` with the injected `fromUuid`, require a `JournalEntry` document, derive `sourceId` only from `journal.uuid`, and return a copy receipt without mutating the Journal.

Add exact parser support for `{kind:"journal", journalUuid}` and Foundry `type:"JournalEntry"`; do not accept page types.

- [ ] **Step 5: Add defense-in-depth row guards**

- In `StorageService.claim`, reject `isStorageJournalRow(row)` before reading or writing `itemData`.
- In `depositRow`, require amount `1`, force empty `stackKey`, and never call the Item quantity helper for Journal rows.
- In `updateRowQuantity`, reject Journal rows; leave `deleteRow` available.
- In `StorageCommandService.claimRow`, reject the authoritative Journal row before destination selection/materialization.
- In `StorageCommandService.deposit`, accept the exact Journal source shape, re-resolve it on the active GM, require `sender.isGM`, quantity `1`, and then use the existing rollback transaction.
- In `resolveStorageRowSource` and `singleGroundItem`, reject Journal rows.
- In `RebreyaMainModule.depositStorageItem`, preserve `{kind:"journal", journalUuid}` instead of coercing it to an Item source.

- [ ] **Step 6: Re-run the focused files**

Run the Step 3 command.

Expected: all tests PASS and no existing Item/container deposit test changes behavior.

- [ ] **Step 7: Update passport and commit**

Record the Journal source shape, GM-only deposit path, non-claimability, and source-row/materialization exclusions.

```powershell
git add scripts/data/storage-deposit-source.js scripts/data/storage-service.js scripts/data/storage-command-service.js scripts/main.js tests/storage-deposit-source.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs docs/function-passport.md
git commit -m "feat: add gm-only journal storage rows"
```

### Task 4: Add the secure active-GM Journal reader and exact typed command

**Files:**
- Create: `scripts/data/storage-journal-reader.js`
- Create: `tests/storage-journal-reader.test.mjs`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `tests/security.test.mjs:9-28`
- Modify: `scripts/data/storage-command-service.js:91-128,218-250,284-315`
- Modify: `scripts/main.js:101-119,266-273,1129-1138,1402-1436,3196-3277`
- Modify: `README.md:286-292` and storage usage section
- Modify: `docs/function-passport.md`, section 8 only

**Interfaces:**
- Produces: `StorageJournalReader.read(journalUuid)`, `StorageCommandService.readJournal(payload, {sender})`, `readStorageJournal(tokenUuid, rowId, request)`, and `storage.journal.read`.
- Consumes: only `{tokenUuid, characterTokenUuid, rowId, path?}` from the client.
- Returns: whitelisted UUID-free snapshot; no `ownership`, flags, sheet, embedded document, or edit metadata.

- [ ] **Step 1: Write the failing reader/security tests**

Create a fake Journal with an unrevealed secret block and inject an `enrichHtml` spy that models Foundry 13's `secrets:false` behavior. Assert:

```js
const beforeOwnership = structuredClone(journal.ownership);
const snapshot = await reader.read(journal.uuid);
assert.equal(JSON.stringify(snapshot).includes("Тайный пароль"), false);
assert.equal(JSON.stringify(snapshot).includes("section class=\"secret\""), false);
assert.deepEqual(journal.ownership, beforeOwnership);
assert.equal(journal.updateCalls.length, 0);
assert.equal("uuid" in snapshot, false);
assert.equal("ownership" in snapshot, false);
assert.deepEqual(enrichCalls[0].options, {
  relativeTo: journal.pages.contents[0],
  secrets: false,
  documents: false,
  links: false,
  embeds: false,
  rolls: false,
  custom: false
});
```

Change the live page content and read again; assert the second snapshot changes. Return `null` from the resolver and assert a safe unavailable error while no storage row is mutated.

- [ ] **Step 2: Add failing exact-payload and authorization tests**

Add `isValidStorageJournalReadPayload` coverage for root/path forms, rejected `journalUuid`, extra keys, invalid paths, and empty IDs. In the command harness assert:

- distance, scene, visibility, and selected-character ownership reuse `#resolveAccess`;
- the row is resolved from `readStorageStateAtPath` and must be unclaimed `rowKind:"journal"`;
- `journalReader.read` receives `row.sourceId`, even if the request object is polluted with another UUID before validator invocation;
- claimed/missing/ordinary rows fail closed;
- ownership remains byte-for-byte unchanged.

- [ ] **Step 3: Run reader/socket/registration/security tests and verify RED**

```powershell
node --test tests/storage-journal-reader.test.mjs tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs
```

Expected: FAIL because the reader, validator, command constant, route, and public API do not exist.

- [ ] **Step 4: Implement the whitelist reader**

`StorageJournalReader` must:

1. resolve the supplied authoritative UUID and require `documentName === "JournalEntry"`;
2. enumerate `journal.pages.contents` (or collection values), sorted by numeric `sort` then ID;
3. copy only `pageId`, `name`, `type`, `sort`, `title.show`, `title.level`, `src`, and `caption`;
4. for text pages call Foundry 13 `CONFIG.ux.TextEditor.implementation.enrichHTML` with `secrets:false` and every link/embed/roll/custom option disabled;
5. return plain cloned values and omit Journal/page UUIDs, ownership, flags, sheet data, and raw `text.content`;
6. throw a generic Russian unavailable error when resolution or enrichment fails so raw GM content never becomes a fallback response.

Foundry 13 removes `section.secret:not(.revealed)` at enrichment time when `secrets:false`; keep an output guard that rejects any remaining unrevealed secret section instead of sending it.

- [ ] **Step 5: Implement command access and composition**

Add the exact validator and `readJournal` method. Run `#resolveAccess` on every request, require opened state, resolve `path`, locate the unclaimed row by `rowId`, require `isStorageJournalRow`, then call the reader with `row.sourceId`.

In `scripts/main.js`:

- construct `this.storageJournalReader` with `fromUuid` and the Foundry TextEditor implementation;
- inject it into `StorageCommandService`;
- register `STORAGE_JOURNAL_READ_COMMAND` with exact validation and `Boolean(sender)` authorization;
- publish `readStorageJournal`, routing directly only on the active GM and otherwise through `SocketCommandBus`;
- build the payload without any Journal UUID.

For non-GM `getStorageSnapshot` results, omit `sourceId` from Journal rows. GM snapshots may retain it for configuration diagnostics.

- [ ] **Step 6: Re-run focused tests**

Run the Step 3 command.

Expected: all tests PASS, including explicit absence of secret text and ownership writes.

- [ ] **Step 7: Update public docs/passport and commit**

Add `readStorageJournal(tokenUuid, rowId, request)` to `README.md`; explain storage-only access, selected character checks, no sidebar visibility/ownership, live contents, read-only result, and unavailable behavior. Add the reader, data flow, typed command, security constraints, and tests to passport section 8.

```powershell
git add scripts/data/storage-journal-reader.js scripts/data/storage-command-service.js scripts/main.js tests/storage-journal-reader.test.mjs tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs README.md docs/function-passport.md
git commit -m "feat: add secure storage journal reading"
```

### Task 5: Render Journal rows as read-only storage actions

**Files:**
- Create: `scripts/ui/storage-journal-viewer.js`
- Create: `templates/storage-journal-viewer.hbs`
- Create: `tests/storage-journal-viewer.test.mjs`
- Modify: `tests/storage-app.test.mjs`
- Modify: `scripts/ui/storage-app.js:135-185,403-451,453-565`
- Modify: `templates/storage-app.hbs:74-143`
- Modify: `styles/main.css:12959-13162` and adjacent storage viewer styles
- Modify: `docs/function-passport.md`, section 8 UI line

**Interfaces:**
- Consumes: `moduleApi.readStorageJournal(tokenUuid, rowId, {path, characterTokenUuid})`.
- Produces: `openStorageJournalViewer(snapshot, dependencies?)` using snapshot data only.
- UI invariants: Journal article has no `draggable` or `data-storage-row-drag`; popover shows `Прочитать`, plus GM delete only.

- [ ] **Step 1: Add failing template/context/action tests**

Build a Journal row snapshot and assert prepared context has:

```js
assert.equal(row.isJournal, true);
assert.equal(row.canDrag, false);
assert.equal(row.canClaim, false);
assert.equal(row.canOpenSource, false);
assert.equal(row.showQuantity, false);
```

Assert the Journal template branch contains `data-action="storage-read-journal"` and does not render `storage-claim-self`, `storage-claim-party`, quantity input, or `data-storage-row-drag` for that branch. Simulate the click and assert the exact API call includes the current nested path and selected character; assert the injected viewer receives only the returned snapshot.

Create viewer tests asserting the template has no UUID attribute and no edit, export, ownership, claim, or drag action; text uses the already-sanitized `content`, and image/video/PDF branches use only whitelisted `src`/`caption` fields.

- [ ] **Step 2: Run UI tests and verify RED**

```powershell
node --test tests/storage-app.test.mjs tests/storage-journal-viewer.test.mjs
```

Expected: FAIL because Journal rows still inherit generic drag/claim/open-source behavior and the viewer does not exist.

- [ ] **Step 3: Add explicit Journal view-model flags and drag defense**

In `_prepareContext`, derive `isJournal` from `rowKind`, set `canDrag/canClaim/canOpenSource/showQuantity`, and expose `canDelete` separately from quantity editing. In `#claimRow`, `#openRowSource`, and `#onDragStart`, reject Journal rows as a client-side defense even though the GM route also rejects them.

Update the article so drag attributes are emitted only within `{{#if canDrag}}`. Add a dedicated Journal popover branch before generic Item actions. Keep GM delete wired to `deleteStorageRow`; never show quantity controls for Journals.

- [ ] **Step 4: Add the snapshot-only viewer**

`openStorageJournalViewer` must render `templates/storage-journal-viewer.hbs` and open a DialogV2 with only a close button. It must not call `fromUuid`, render a document sheet, or expose source IDs. Render text content as already-sanitized HTML and use non-editable media elements with no autoplay.

Inject the viewer opener through `StorageApp` options for tests, with the real helper as default. Add scoped viewer typography/scroll/media CSS under `.rebreya-storage-journal-viewer`.

- [ ] **Step 5: Re-run focused UI tests**

Run the Step 2 command.

Expected: both files PASS; ordinary Item/container/coin popovers retain their behavior.

- [ ] **Step 6: Update passport UI entry and commit**

```powershell
git add scripts/ui/storage-app.js scripts/ui/storage-journal-viewer.js templates/storage-app.hbs templates/storage-journal-viewer.hbs styles/main.css tests/storage-app.test.mjs tests/storage-journal-viewer.test.mjs docs/function-passport.md
git commit -m "feat: add read-only storage journal viewer"
```

### Task 6: Reconcile the managed МОНЕТЫ folder and four world Item templates

**Files:**
- Create: `scripts/data/builtin-coin-template-service.js`
- Create: `tests/builtin-coin-template-service.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `scripts/main.js:101-108,1104-1118,1587-1595,1639-1646`
- Modify: `docs/function-passport.md`, section 8 only

**Interfaces:**
- Produces: catalog/service interfaces from the File and Interface Map.
- Stable flag: `flags.rebreya-main.storageCoinTemplate = {version:1, denomination}`.
- Managed data: canonical name, `type:"loot"`, icon, root Item folder, `system.quantity:1`, `system.type.value:"treasure"`, and `flags.rebreya-main.sourceType:"coinTemplate"`.

- [ ] **Step 1: Write the failing service tests**

Define the exact catalog:

```js
[
  ["pp", "Платиновая монета", "icons/commodities/currency/coins-assorted-mix-platinum.webp"],
  ["gp", "Золотая монета", "icons/commodities/currency/coins-plain-gold.webp"],
  ["sp", "Серебряная монета", "icons/commodities/currency/coins-assorted-mix-silver.webp"],
  ["cp", "Медная монета", "icons/commodities/currency/coins-assorted-mix-copper.webp"]
]
```

Test:

- inactive/non-active GM returns `null` without reading or creating folders/Items;
- first sync creates one root `Item` folder named `МОНЕТЫ` and exactly four Items;
- second sync creates nothing;
- a renamed/moved flagged Item is found by flag and repaired to canonical managed fields;
- an unflagged Item with the same name remains untouched and does not count as managed;
- two flagged Items for one denomination produce no third Item, repair only the deterministic first `(sort,id)`, never delete either duplicate, and log one warning.

- [ ] **Step 2: Run the focused service test and verify RED**

```powershell
node --test tests/builtin-coin-template-service.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the immutable catalog and sync service**

Use the established `BuiltinStorageActorService` active-GM/folder/provider pattern. Resolve existing managed Items only with `readBuiltinCoinDenomination`; sort duplicates deterministically. Repair canonical name, type, img, folder, quantity, treasure type, sourceType, and stable flag on the primary managed Item. Do not delete duplicates and do not update unrelated Items.

- [ ] **Step 4: Compose and initialize the service**

Construct `this.builtinCoinTemplateService` in `RebreyaMainModule`. Add `restoreBuiltinCoinTemplates()` with the same error boundary style as storage actors, and call it during `initialize()` immediately after `restoreBuiltinStorageActors()`.

Extend `main-composition-root.test.mjs` to verify successful forwarding and warning/null behavior on sync failure.

- [ ] **Step 5: Run service and composition tests**

```powershell
node --test tests/builtin-coin-template-service.test.mjs tests/main-composition-root.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Update passport and commit**

Document `BuiltinCoinTemplateService.sync()`, catalog/flag ownership, active-GM lifecycle, duplicate policy, and the rule that Item quantity is not currency state.

```powershell
git add scripts/data/builtin-coin-template-service.js scripts/main.js tests/builtin-coin-template-service.test.mjs tests/main-composition-root.test.mjs docs/function-passport.md
git commit -m "feat: maintain built-in coin templates"
```

### Task 7: Generate and verify the original transparent coin-pile PNG

**Files:**
- Create: `assets/storage/piles/coins.png`
- Create: `tests/storage-asset.test.mjs`

**Interfaces:**
- Produces: a square transparent raster token consumed only by `storage-pile-presentation.js` in Task 8.
- Requires: Codex `imagegen` skill, built-in image generation first, local chroma-key removal, and real pixel-alpha verification.

- [ ] **Step 1: Write the failing PNG test before generating the asset**

The Node test must:

1. read `assets/storage/piles/coins.png` and validate the eight-byte PNG signature;
2. parse `IHDR` and require 8-bit color type `6` (RGBA) or `4` (grayscale+alpha), square dimensions, and non-interlaced data;
3. concatenate `IDAT`, inflate with `node:zlib`, reverse PNG filters 0-4 row-by-row, and collect the alpha byte from every pixel;
4. assert `Math.min(...alpha) < 255` and `Math.max(...alpha) > 0` so the file has actual transparency plus a visible subject;
5. assert at least one corner pixel has alpha `0`.

Core assertions:

```js
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok([4, 6].includes(header.colorType));
assert.equal(header.bitDepth, 8);
assert.equal(header.interlace, 0);
assert.equal(header.width, header.height);
assert.ok(alpha.some((value) => value < 255));
assert.ok(alpha.some((value) => value > 0));
assert.equal(cornerAlpha.some((value) => value === 0), true);
```

- [ ] **Step 2: Run the asset test and verify RED**

```powershell
node --test tests/storage-asset.test.mjs
```

Expected: FAIL with `ENOENT` for `assets/storage/piles/coins.png`.

- [ ] **Step 3: Invoke the `imagegen` skill and generate the source with the built-in tool**

Use this prompt without the meme screenshot as an edit target; any available screenshot is mood/scale reference only:

```text
Use case: stylized-concept
Asset type: Foundry VTT fantasy storage-pile token
Primary request: an original exaggerated mound of mixed platinum, gold, silver, and copper coins, clearly readable at small token scale
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal
Subject: one compact overflowing mound made only of many mixed fantasy coins; distinct platinum, gold, silver, and copper colors; strong silhouette
Style/medium: highly detailed photorealistic fantasy game asset, stylistically compatible with realistic storage pile tokens
Composition/framing: centered square top-down three-quarter token view, generous transparent-margin equivalent, no cropped coins
Lighting/mood: dramatic but clean studio-like highlights on metal, no cast shadow or floor plane
Constraints: original composition; no frame; no UI; no text; no watermark; no logos; no characters; no chest; no pouch; no recognizable copied meme composition; background must be one uniform #00ff00 with no gradient, texture, reflection, shadow, or lighting variation; do not use #00ff00 in the subject
Avoid: cartoon outlines, flat icon style, blurry heap, monochrome gold-only pile
```

Generate a square source, inspect it visually, and iterate only if denomination contrast or small-token silhouette is unclear.

- [ ] **Step 4: Remove chroma key into the repository asset**

Copy the selected built-in result to `tmp/imagegen/coins-source.png`, then use the installed helper from the current `imagegen` skill:

```powershell
$helper = Join-Path $env:USERPROFILE '.codex\skills\.system\imagegen\scripts\remove_chroma_key.py'
python $helper --input tmp/imagegen/coins-source.png --out assets/storage/piles/coins.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
```

If a key-color fringe remains, retry once with `--edge-contract 1`. If built-in generation or chroma removal cannot produce a valid asset, stop and ask before switching to the CLI `gpt-image-1.5` true-transparency fallback; do not silently downgrade.

- [ ] **Step 5: Inspect and verify the final alpha PNG**

Open `assets/storage/piles/coins.png` over a checkerboard/dark preview, confirm no green halo, and run:

```powershell
node --test tests/storage-asset.test.mjs
python -c "from PIL import Image; p='assets/storage/piles/coins.png'; im=Image.open(p); a=im.getchannel('A'); print(im.mode, im.size, a.getextrema(), a.getpixel((0,0)))"
```

Expected: Node test PASS; Pillow reports `RGBA`, a non-opaque alpha range such as `(0, 255)`, and corner alpha `0`.

- [ ] **Step 6: Commit the test and final asset only**

Do not track `tmp/imagegen` sources.

```powershell
git add assets/storage/piles/coins.png tests/storage-asset.test.mjs
git commit -m "feat: add transparent mixed coin pile token"
```

### Task 8: Derive coin-aware pile presentation and preserve empty pure coin piles

**Files:**
- Modify: `tests/storage-pile-presentation.test.mjs`
- Modify: `tests/storage-ground-pile-service.test.mjs`
- Modify: `scripts/data/storage-pile-presentation.js:13-77`
- Modify: `scripts/data/storage-ground-pile-service.js:37-59,110-179,181-303`
- Modify: `docs/function-passport.md`, section 8 only

**Interfaces:**
- Produces: new `deriveGroundPilePresentation` signature, `findProcessedMutationAtPoint`, and `transferCoinsToScene`.
- Persists: `flags.rebreya-main.groundPile.coinPile === true` only when the current pile is pure coins or its preserved empty successor.
- Currency storage: denomination values are added only to `storage.manualCoins`; no coin row is created.

- [ ] **Step 1: Add failing pure presentation tests**

Assert the complete matrix:

```js
assert.equal(deriveGroundPilePresentation([], { coins: { gp: 8 } }).name, "Золотая монета");
assert.match(deriveGroundPilePresentation([], { coins: { gp: 8 } }).img, /coins-plain-gold\.webp$/u);
assert.deepEqual(deriveGroundPilePresentation([], { coins: { gp: 8, sp: 3 } }), {
  name: "Куча монет",
  img: `modules/${MODULE_ID}/assets/storage/piles/coins.png`,
  categoryKey: "coins"
});
assert.equal(deriveGroundPilePresentation([], { preserveEmptyCoinPile: true }).name, "Куча монет (пусто)");
```

Also test:

- treasure-category row(s) plus coins => `Куча сокровищ`/`treasure.png`;
- one ordinary row plus coins retains the ordinary single-Item presentation;
- multiple same-category ordinary rows plus coins retain that category;
- mixed ordinary rows plus coins retain `Куча предметов`.

- [ ] **Step 2: Add failing ground-pile lifecycle tests**

Cover:

- `transferCoinsToScene({coins:{gp:5}})` creates a token with zero rows and `manualCoins.gp === 5`;
- a second denomination at the contained point merges into the same token and changes it to `Куча монет`;
- the same mutation ID returns `duplicate:true` without adding again;
- coins merged into a treasure pile keep treasure presentation;
- claiming all coins from a pure pile and calling `refreshAfterStorageMutation` retains the token as `Куча монет (пусто)`, state/displayMode `empty`, coin image, and `coinPile:true`;
- adding coins to that token reopens it and recomputes single/multi-denomination presentation;
- empty ordinary and treasure piles still delete;
- snapshot transfers with coins pass the coin map into presentation.

- [ ] **Step 3: Run presentation and pile tests and verify RED**

```powershell
node --test tests/storage-pile-presentation.test.mjs tests/storage-ground-pile-service.test.mjs
```

Expected: FAIL because presentation ignores coins and cleanup always deletes an empty pile.

- [ ] **Step 4: Implement coin-aware pure presentation**

Add a `coins` definition to the presentation catalog pointing only to `assets/storage/piles/coins.png`. Normalize positive denomination amounts and follow this order:

1. no rows + one denomination => canonical denomination name/icon;
2. no rows + two or more denominations => mixed coin pile;
3. no rows + no coins + preserved identity => empty coin pile;
4. treasure rows + any coins => treasure;
5. all other rows => existing row-only derivation.

- [ ] **Step 5: Implement coin mutation and identity persistence**

- `transferCoinsToScene` must reject an all-zero map and delegate to the existing prepared snapshot transaction with `rows:[]`.
- `findProcessedMutationAtPoint` must require the active GM, resolve the exact scene/contained pile, and return the existing duplicate result only when `groundPile.mutationIds` contains the stable ID.
- Every create/merge derives presentation with visible rows and unclaimed combined coins.
- `#writePile` sets state/displayMode to `empty` only for the preserved empty coin pile and writes `groundPile.coinPile` from the derived pure-coin category.
- `refreshAfterStorageMutation` reads the previous marker before cleanup. Preserve only a previously pure coin pile; delete all other empty piles.
- Never write denomination values outside `manualCoins`; reset `coinsClaimed:false` only when positive incoming coins are added.

- [ ] **Step 6: Re-run focused tests**

Run the Step 3 command.

Expected: PASS for all presentation, merge, retry, empty-identity, and ordinary cleanup cases.

- [ ] **Step 7: Update passport and commit**

Record exact signatures, manualCoins ownership, `coinPile` marker meaning, mutation-ID lookup, and cleanup invariants.

```powershell
git add scripts/data/storage-pile-presentation.js scripts/data/storage-ground-pile-service.js tests/storage-pile-presentation.test.mjs tests/storage-ground-pile-service.test.mjs docs/function-passport.md
git commit -m "feat: support persistent physical coin piles"
```

### Task 9: Route managed Coin Item drops through an exact idempotent active-GM command

**Files:**
- Modify: `tests/storage-deposit-source.test.mjs`
- Modify: `tests/storage-transfer-ui.test.mjs`
- Modify: `tests/storage-transfer-drop.test.mjs:116-184`
- Modify: `tests/storage-socket.test.mjs:194-237,342-471`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `scripts/data/storage-deposit-source.js:88-115,194-297,448-461`
- Modify: `scripts/ui/storage-transfer-ui.js:59-92`
- Modify: `scripts/integrations/storage-transfer-drop.js:124-162`
- Modify: `scripts/data/storage-command-service.js:91-162,684-779`
- Modify: `scripts/main.js:104-119,266-273,1129-1138,1402-1436,3261-3338`
- Modify: `README.md` storage/API sections
- Modify: `docs/function-passport.md`, section 8 only

**Interfaces:**
- Produces: managed source `{kind:"coin-template", denomination, mode, available, ...}`, `promptStorageCoinQuantity(maxQuantity?)`, `StorageCommandService.dropCoinsToScene`, `storage.coin.drop`, and `dropStorageCoinsToScene`.
- World source: copy mode, unbounded except positive safe integer.
- Embedded Actor source: move mode, bounded by actual `system.quantity` and owner permission.

- [ ] **Step 1: Add failing managed-source tests**

Use flagged world and embedded Items. Assert `readBuiltinCoinDenomination` is authoritative, resolver kind/denomination are correct, world `consume` is a copy, embedded partial/full consume and restore reuse the existing Item receipt semantics, and unflagged loot remains an ordinary Item source.

Assert attempting to deposit a managed Coin Item into storage rejects it before `StorageService.depositRow`; it may only use the scene coin route.

- [ ] **Step 2: Add failing quantity/drop integration tests**

`promptStorageCoinQuantity(null)` must prompt with default `1`, accept a positive safe integer, reject zero/fraction/unsafe integers, and have no artificial maximum. With an embedded max, reject values above max.

In `transferFoundryItemDropToCanvas`, make `inspectStorageDepositSource` return:

```js
{ kind: "coin-template", denomination: "gp", available: null, mode: "copy" }
```

Assert it calls:

```js
dropStorageCoinsToScene("Item.gold-template", "gp", {
  sceneId: "scene",
  x: 240,
  y: 360,
  quantity: 25
});
```

Ordinary and container Item tests must still call `dropStorageItemToScene`.

- [ ] **Step 3: Add failing socket command tests**

Test the exact `storage.coin.drop` payload and reject extra keys, invalid denomination, non-safe quantity, empty UUID, and non-finite point. Execution tests must prove:

- non-active clients mutate only through the socket route;
- active GM re-resolves the Item and compares payload denomination to the stable flag;
- player requests require owned same-scene character context within five feet;
- move sources require owner permission and cannot exceed actual quantity;
- `findProcessedMutationAtPoint` is checked before source resolution so a retry still succeeds after an embedded source was consumed;
- same mutation ID adds currency once;
- a transfer failure restores an embedded source;
- no Item row is passed to the pile service.

- [ ] **Step 4: Run all four focused files and verify RED**

```powershell
node --test tests/storage-deposit-source.test.mjs tests/storage-transfer-ui.test.mjs tests/storage-transfer-drop.test.mjs tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs
```

Expected: FAIL because managed coin resolution, unbounded prompt, coin API, validator, and command are absent.

- [ ] **Step 5: Implement managed coin source and prompt branching**

Detect the stable coin flag before generic Item/container resolution. Reuse the embedded Item consume/restore mechanics; return `available:null` to inspection for a world template and a finite maximum for embedded Items.

Add `promptStorageCoinQuantity(maxQuantity = null)` with safe-integer validation. In the canvas hook, branch on `inspected.kind === "coin-template"`; call the coin API and never call the generic Item-drop API for that branch.

- [ ] **Step 6: Implement the typed active-GM command**

Add exact validator and `dropCoinsToScene(payload,{sender})`. Required execution order:

1. validate stable mutation ID/scene point/quantity/denomination;
2. ask `groundPileService.findProcessedMutationAtPoint` and return a duplicate immediately when present;
3. resolve the authoritative Item source on active GM;
4. require managed coin kind and exact denomination match;
5. validate source maximum, owner permission, sender character scene/distance;
6. consume embedded source when applicable;
7. call `transferCoinsToScene({coins:{[denomination]:quantity}, ...})`;
8. restore the source on failure.

Register `STORAGE_COIN_DROP_COMMAND = "storage.coin.drop"` and publish `dropStorageCoinsToScene`. Generate a stable mutation ID in the public API when the caller omits one.

- [ ] **Step 7: Re-run focused tests**

Run the Step 4 command.

Expected: PASS; retries do not duplicate `manualCoins`, and ordinary Item drops remain unchanged.

- [ ] **Step 8: Update README/passport and commit**

Document template names/folder, public coin-drop API, prompt rules, manualCoins ownership, active-GM re-resolution, and typed command.

```powershell
git add scripts/data/storage-deposit-source.js scripts/ui/storage-transfer-ui.js scripts/integrations/storage-transfer-drop.js scripts/data/storage-command-service.js scripts/main.js tests/storage-deposit-source.test.mjs tests/storage-transfer-ui.test.mjs tests/storage-transfer-drop.test.mjs tests/storage-socket.test.mjs tests/storage-main-registration.test.mjs README.md docs/function-passport.md
git commit -m "feat: route coin templates to physical currency piles"
```

### Task 10: Expose non-mutating durability derivation and exclude Coin templates

**Files:**
- Modify: `tests/durability-service.test.mjs:253-312`
- Modify: `tests/durability-rules.test.mjs:245-365`
- Modify: `scripts/data/durability-service.js:208-237,301-383`
- Modify: `scripts/data/durability-rules.js:1-3,243-259`
- Modify: `docs/function-passport.md`, section 14 only

**Interfaces:**
- Produces: `await durabilityService.getOrBuildDurability(item, {sourceType?, sourceId?})`.
- Returns: a plain clone of existing durability, a newly derived initial flag, or `null` for ineligible Items.
- Side effects: no `item.update`, delete, hook, journal, or source mutation.

- [ ] **Step 1: Add failing service tests**

Cover an ordinary uninitialized cuirass (`type:"equipment"`, nonmagical), an existing damaged flag, and an ineligible Item:

```js
const derived = await service.getOrBuildDurability(cuirass);
assert.equal(derived.eligible, true);
assert.equal(derived.state, "intact");
assert.equal(derived.hp.value, derived.hp.max);
assert.equal(cuirass.updates.length, 0);

const preserved = await service.getOrBuildDurability(damagedCuirass);
assert.deepEqual(preserved, damagedFlag);
assert.notEqual(preserved, damagedFlag);
assert.equal(damagedCuirass.updates.length, 0);
```

Assert `initializeItem` still performs exactly one update and uses the same derived initial flag.

- [ ] **Step 2: Add failing eligibility test for managed Coin Items**

```js
assert.equal(isDurabilityEligible({
  type: "loot",
  flags: { [MODULE_ID]: {
    sourceType: "coinTemplate",
    storageCoinTemplate: { version: 1, denomination: "gp" }
  }}
}), false);
```

Keep functional unflagged loot eligible.

- [ ] **Step 3: Run durability tests and verify RED**

```powershell
node --test tests/durability-service.test.mjs tests/durability-rules.test.mjs
```

Expected: FAIL because `getOrBuildDurability` is missing and the managed Coin Item is currently eligible as loot.

- [ ] **Step 4: Implement one canonical non-mutating path**

Add public async `getOrBuildDurability`. It must run `isDurabilityEligible`, return `getDurability(item)` when present, otherwise call the existing private initial-flag builder. Refactor `#readOrBuildFlag` to delegate to it. Keep `initializeItem(force:true)` rebuilding through the same private builder; normal initialization may call the new method before `#commitUpdate`.

Add `coinTemplate`/`storageCoinTemplate` exclusion in `isDurabilityEligible` without importing the storage service into durability rules.

- [ ] **Step 5: Re-run focused durability tests**

Run the Step 3 command.

Expected: PASS; existing damaged data is preserved and source documents remain untouched.

- [ ] **Step 6: Update passport section 14 and commit**

Document signature, model/material/construction/size data flow, no-mutation guarantee, existing-flag precedence, and coin exclusion.

```powershell
git add scripts/data/durability-service.js scripts/data/durability-rules.js tests/durability-service.test.mjs tests/durability-rules.test.mjs docs/function-passport.md
git commit -m "feat: derive ground item durability without source mutation"
```

### Task 11: Prepare durability before any ground-row source consumption

**Files:**
- Modify: `tests/storage-socket.test.mjs:357-471,909-end`
- Modify: `tests/native-durability-hooks.test.mjs:137-165`
- Modify: `scripts/data/storage-command-service.js:218-250,364-461,684-779`
- Modify: `scripts/main.js:1129-1138`
- Modify: `docs/function-passport.md`, sections 8 and 14

**Interfaces:**
- Consumes: `DurabilityService.getOrBuildDurability` injected into `StorageCommandService`.
- Produces: a cloned ground row whose `itemData.flags.rebreya-main.durability` exists for eligible Items before `consume`.
- Applies to: world, compendium, embedded Item canvas drops and storage-row claims to scene.

- [ ] **Step 1: Add failing ordered integration tests**

Extend the socket harness with `durabilityService` and event logging. For an uninitialized ordinary cuirass assert:

```js
assert.deepEqual(events, ["derive", "consume", "transfer"]);
assert.deepEqual(
  groundRequests[0].row.itemData.flags[MODULE_ID].durability,
  derivedFlag
);
assert.equal(sourceItem.updates.length, 0);
```

Add cases for:

- existing damaged durability copied exactly, including HP/state/timestamp;
- ineligible Item returns `null` and gains no flag;
- derivation throws before `consume`, leaving source quantity/deletion unchanged and making no pile call;
- storage-row-to-scene derives from `transferRow.itemData` before ground creation;
- Journal claim remains rejected and Coin template uses the separate coin command.

In `native-durability-hooks.test.mjs`, use a normal cuirass ground row carrying the derived flag and assert projection writes token HP `{value,max,dt}`, flat AC, and `bar1.attribute === "attributes.hp"`.

- [ ] **Step 2: Run focused integration tests and verify RED**

```powershell
node --test tests/storage-socket.test.mjs tests/native-durability-hooks.test.mjs
```

Expected: FAIL because the command consumes/transfers the source row without calling durability derivation.

- [ ] **Step 3: Inject and validate DurabilityService**

Add `durabilityService` to the `StorageCommandService` constructor and require `getOrBuildDurability` when supplied. Inject `this.durabilityService` from `scripts/main.js`.

Add a private ground-row preparer that clones the row, skips container/Journal/coin special sources, calls `getOrBuildDurability(sourceItem ?? row.itemData)`, and writes the returned clone under `itemData.flags[MODULE_ID].durability` without altering the input.

- [ ] **Step 4: Move preparation before consumption**

In `dropItemToScene`, prepare the row after all authority/quantity/point checks but before `source.consume(quantity)`. Reuse that prepared row after consumption. A derivation error must occur with `receipt === null`.

In `claimRow`, run the same preparation only for destination `scene`, before `groundPileService.transferToScene` and before `storageService.claim`. Other destinations retain existing Item initialization behavior.

- [ ] **Step 5: Re-run focused integration tests**

Run the Step 2 command.

Expected: PASS with `derive -> consume -> transfer` ordering, exact damage preservation, and HP/bar projection.

- [ ] **Step 6: Update both passport sections and commit**

Section 8 must describe the pre-consumption storage drop data flow and rollback boundary. Section 14 must name storage as a consumer of `getOrBuildDurability` and state that world/compendium sources are not mutated.

```powershell
git add scripts/data/storage-command-service.js scripts/main.js tests/storage-socket.test.mjs tests/native-durability-hooks.test.mjs docs/function-passport.md
git commit -m "fix: carry durability into every ground item row"
```

### Task 12: Release wiring, manifest/API documentation audit, and full verification

**Files:**
- Create: `scripts/main-1.4.140.js`
- Modify: `module.json:6,16`
- Modify: `tests/module-manifest.test.mjs:61-78,248-268`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `tests/security.test.mjs:9-28`
- Modify if coverage audit finds omissions: `README.md`
- Modify if coverage audit finds omissions: `docs/function-passport.md`, sections 8 and 14 only

**Interfaces:**
- Publishes: release `1.4.140` through an import-only forwarder.
- Verifies: one composition root, both new commands/services/APIs registered, asset referenced only by pile presentation, and no second currency owner.

- [ ] **Step 1: Add failing manifest/registration assertions**

Update expected manifest version/entrypoint to `1.4.140` and assert the new file is exactly:

```js
// @rebreya-role versioned-entrypoint-cache-forwarder
import "./main.js";
```

Extend registration/security tests to assert:

- `storage.journal.read` and `storage.coin.drop` constants, validators, registrations, and executions;
- construction of `StorageJournalReader` and `BuiltinCoinTemplateService`;
- injection of `DurabilityService` into `StorageCommandService`;
- public `readStorageJournal` and `dropStorageCoinsToScene` methods;
- no `Item Piles` dependency and no second currency store;
- `assets/storage/piles/coins.png` is referenced by `storage-pile-presentation.js`, not `main.js` or template sync.

- [ ] **Step 2: Run release-focused tests and verify RED**

```powershell
node --test tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs tests/storage-asset.test.mjs
```

Expected: FAIL until manifest/forwarder expectations and any remaining composition assertions are updated.

- [ ] **Step 3: Add release forwarder and update manifest**

Create only the two-line forwarder above. Set `module.json.version` to `1.4.140` and `esmodules` to `scripts/main-1.4.140.js`. Do not add query strings and do not put service construction in the forwarder.

- [ ] **Step 4: Audit README and passport against the final diff**

Use targeted searches:

```powershell
rg -n "readStorageJournal|dropStorageCoinsToScene|storage\.journal\.read|storage\.coin\.drop|BuiltinCoinTemplateService|getOrBuildDurability|transferCoinsToScene|findProcessedMutationAtPoint|deriveGroundPilePresentation|isStorageJournalRow" scripts README.md docs/function-passport.md
```

For every declaration in the result, confirm the current signature, owner, data flow, constraints, and focused tests are present in passport section 8 or 14. Confirm README documents both public APIs and observed user behavior. Do not add history or implementation chronology.

- [ ] **Step 5: Run every focused cluster once on the final HEAD**

```powershell
node --test tests/storage-app.test.mjs tests/storage-journal-viewer.test.mjs
node --test tests/storage-container-snapshot.test.mjs tests/storage-container-item-service.test.mjs
node --test tests/storage-deposit-source.test.mjs tests/storage-service.test.mjs
node --test tests/storage-journal-reader.test.mjs tests/storage-socket.test.mjs
node --test tests/builtin-coin-template-service.test.mjs tests/main-composition-root.test.mjs
node --test tests/storage-transfer-ui.test.mjs tests/storage-transfer-drop.test.mjs
node --test tests/storage-ground-pile-service.test.mjs tests/storage-pile-presentation.test.mjs tests/storage-asset.test.mjs
node --test tests/durability-service.test.mjs tests/durability-rules.test.mjs tests/native-durability-hooks.test.mjs
node --test tests/storage-main-registration.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs
```

Expected: every command reports zero failures. Record passed/failed counts and only real error output if a command fails.

- [ ] **Step 6: Run the repository-wide verification once**

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected readiness report:

- focused tests: zero failures;
- full Node suite: zero failures, with passed/failed counts recorded;
- every tracked JS/MJS: `node --check` exit 0;
- every tracked JSON: UTF-8 parse succeeds;
- `git diff --check`: no output;
- `assets/storage/piles/coins.png`: asset test proves a real alpha channel and transparent corners.

- [ ] **Step 7: Review final scope and commit release wiring/docs**

```powershell
git diff --stat
git diff -- module.json scripts/main-1.4.140.js tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs README.md docs/function-passport.md
git status --short
```

Stage only the release/audit files that actually changed:

```powershell
git add module.json scripts/main-1.4.140.js tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs tests/security.test.mjs
git add README.md docs/function-passport.md
git commit -m "chore: publish storage equipment upgrades"
```

If README/passport were already complete and unchanged, omit them from `git add`.

- [ ] **Step 8: Recheck remote safety and push `lich_branch`**

```powershell
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git log --oneline HEAD..origin/main
git rev-list --left-right --count HEAD...origin/lich_branch
git log --oneline HEAD..origin/lich_branch
git status --short --branch
git push -u origin lich_branch
```

Stop before push if `origin/lich_branch` contains commits not in local HEAD or fetched `origin/main` conflicts with this work. Never use force push.

## Final Manual Acceptance Checklist

Run in Foundry VTT 13 with an active GM and one player:

- [ ] Hover/focus an Item, open its popover, and confirm the tooltip disappears until the popover closes.
- [ ] As GM, drag a JournalEntry into root and nested storage; as player, read it only while the owned selected character is on the same scene, can see storage, and is within five feet.
- [ ] Confirm unrevealed secret sections are absent, edits appear on the next read, deletion reports unavailable, ownership is unchanged, and no sidebar Journal appears.
- [ ] Confirm Journal rows offer only `Прочитать`; GM additionally has delete; no claim, drag, quantity, character, party, or scene materialization path works.
- [ ] Confirm `МОНЕТЫ` contains pp/gp/sp/cp templates after active-GM initialization and repeated initialization creates no duplicates.
- [ ] Drop one denomination, multiple denominations, and coins onto existing treasure/ordinary piles; confirm names, images, and `manualCoins` values match the specification.
- [ ] Claim all currency from a pure coin pile and confirm `Куча монет (пусто)` remains; add coins and confirm it reopens; empty ordinary/treasure piles still disappear.
- [ ] Drop uninitialized world, compendium, and embedded ordinary cuirasses; confirm the source is not initialized merely by copying, the ground row has durability, and the token shows HP/AC/bar.
- [ ] Drop a damaged Item and confirm exact HP/state/timestamp preservation; drop an ineligible Item/Coin template and confirm no durability flag is synthesized.

Implementation is complete only when automated verification and this manual acceptance checklist are both satisfied.
