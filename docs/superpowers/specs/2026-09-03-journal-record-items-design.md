# Journal Record Items Design

## Goal

After a character reads a Journal reference through the existing Rebreya storage flow, the reader can record it as an inventory item. Clicking that item directly in the standard dnd5e character inventory reopens the exact Journal entry or page in the existing sanitized read-only viewer.

## Scope and observable behavior

- An ordinary successful storage Journal read opens the existing `StorageJournalViewer` with one action button labelled `Записать` instead of `Закрыть`.
- Activating `Записать` creates a record Item on the exact character resolved by the authoritative storage-access route.
- The record stores the exact authoritative source identity: `sourceUuid` and `documentName` (`JournalEntry` or `JournalEntryPage`).
- Clicking the record name in the standard dnd5e character inventory opens that exact source in the existing sanitized Journal viewer.
- A Journal opened from a record Item has no `Записать`, `Закрыть`, or storage-progression action buttons. The window chrome may still close the dialog normally.
- Ordinary Foundry Journal opening and every unmarked Item keep their existing behavior.
- Journal records are not claimable storage rows and do not introduce a second Journal UI, global Journal hook, or alternate sanitizer.

## Existing owners

- `scripts/ui/storage-app.js` owns the storage-row read interaction.
- `scripts/data/storage-command-service.js` owns authoritative storage access, row resolution, serialization, and Journal commands.
- `scripts/data/storage-journal-reader.js` owns live Journal resolution and sanitized snapshots.
- `scripts/ui/storage-journal-viewer.js` owns the read-only Journal dialog.
- `scripts/integrations/dnd5e-sheet-extensions.js` already owns character-sheet render integration and is the only place allowed to bind the direct inventory click.
- `scripts/main.js` remains the sole composition root, typed-command registrar, and public API publisher.

No new application, Journal render hook, or competing UI owner will be added.

## Record Item contract

The persisted record is a native dnd5e `loot` Item so that it remains visible in the standard character inventory. It is semantically a Rebreya custom record through the exact module-owned flag:

```js
{
  name: authoritativeJournalName,
  type: "loot",
  img: authoritativeRowImage || "icons/svg/book.svg",
  system: {
    quantity: 1,
    weight: 0,
    price: { value: 0, denomination: "gp" }
  },
  flags: {
    "rebreya-main": {
      journalRecord: {
        version: 1,
        sourceUuid: "JournalEntry.notes",
        documentName: "JournalEntry"
      }
    }
  }
}
```

`JournalEntryPage` records retain the page UUID and `documentName: "JournalEntryPage"`; they never collapse to their parent Journal. Runtime readers accept only version `1`, a non-empty trimmed UUID, and one of the two exact document names. Presentation fields such as Item name or image are not authoritative source identity.

The Item remains an ordinary `loot` document to dnd5e. No new manifest Item type or data model is introduced.

## Recording flow and authorization

The ordinary storage read result is passed to `openStorageJournalViewer` with an explicit record callback. The viewer exposes `Записать` only when that callback is present. The callback invokes `recordStorageJournal(tokenUuid, rowId, mutationId, request)` with the current nested storage path, selected character-token UUID, and a stable mutation ID generated once for that viewer action. Its typed command is `storage.journal.record` with exact payload `{ tokenUuid, characterTokenUuid, rowId, mutationId, path? }`.

The corresponding typed command is authenticated but does not trust client Journal or Actor identifiers. On the active GM, `StorageCommandService`:

1. enters the existing root-storage queue;
2. repeats the current `#resolveAccess()` checks;
3. requires the target storage scope to be opened;
4. resolves the unclaimed canonical Journal row by `rowId`;
5. derives `sourceUuid`, `documentName`, name, and image only from that authoritative row;
6. requires `access.character.type === "character"`;
7. finds or creates the record Item on `access.character`.

Player clients never create embedded Items locally. GM reads retain their existing no-marker behavior; recording still requires a concrete character resolved by the same character-token request rather than silently choosing `game.user.character`.

## Idempotency contract

Within one Actor, the stable identity is the exact pair `(documentName, sourceUuid)` from `journalRecord`.

- If a valid matching record already exists, the command returns that Item with `created: false` and creates nothing.
- If no matching record exists, it creates one Item and returns `created: true`.
- A deleted record may be created again later.
- A parent `JournalEntry` and one of its `JournalEntryPage` documents are distinct identities.
- Two pages of the same Journal are distinct identities.
- Renaming the Journal or changing its image does not create a second Item and does not rewrite an existing record as a side effect.
- Root-storage queue serialization prevents concurrent clicks for the same source and Actor from both creating Items.
- The stable mutation ID also participates in the typed transport retry contract, but duplicate prevention does not depend only on process-local request caching.

This contract avoids accidental duplicates while preserving an explicit recovery path after deliberate Item deletion.

## Reopening from the character inventory

The existing dnd5e character-sheet render owner inspects Actor Items and binds only inventory rows whose Item contains a valid `journalRecord` flag. The binding targets the existing clickable Item-name control and is idempotent per rendered DOM node.

On click it prevents the normal Item action only for the matched record and invokes `readJournalRecord(itemUuid)`. Its typed command is `storage.journal.read-record` with exact payload `{ itemUuid }`. Ordinary Item rows, malformed record flags, non-character Actor sheets, and Foundry Journal links are untouched.

The active-GM command re-resolves the Item UUID, requires an embedded Item whose parent is a character Actor, verifies that the authenticated sender is GM or has OWNER permission on that Actor, validates the stored flag, and uses the same `StorageJournalReader` to read the live source. It returns only the existing UUID-free sanitized snapshot. The client opens `StorageJournalViewer` without any dialog buttons.

Reopening a record does not require proximity to the original storage and does not mutate the storage read marker. A deleted or invalid source fails closed with the existing generic Journal-unavailable error.

## Viewer modes

`openStorageJournalViewer(snapshot, options)` gains an explicit mode through capabilities rather than source inference:

- ordinary storage read: `onRecord` is a function, so buttons contain only `record` / `Записать`;
- record Item read: `onRecord` is absent and `buttons` is an empty array.

The template and sanitizer remain unchanged. No source UUID is inserted into rendered HTML.

## Public API and compatibility

`game.rebreyaMain` and `game.modules.get("rebreya-main").api` gain the two Journal operations needed by the existing UI owners:

- `recordStorageJournal(tokenUuid, rowId, mutationId = "", request = {})` records the currently authoritative storage Journal row for the resolved reader and returns `{ created, actorId, itemId, itemUuid }`;
- `readJournalRecord(itemUuid)` reads a persisted record Item and returns the existing sanitized `{ name, pages }` snapshot.

Both methods route through active GM and exact typed payload validators and will be documented consistently in `README.md` and `docs/function-passport.md`. Existing `readStorageJournal()` behavior and signature remain compatible.

The implementation must bump `module.json` from `1.4.216` to `1.4.217`, create `scripts/main-1.4.217.js` as an import-only forwarder, update the relevant browser module cache keys, and update manifest/cache assertions. No previous forwarder is modified.

## Errors and presentation

- Record creation failures leave the Journal viewer open and show the error through the existing notification surface.
- A successful first creation closes the viewer and reports `Запись добавлена в инвентарь.`; an idempotent repeat closes it and reports `Эта запись уже есть в инвентаре.`.
- Failure to reopen a deleted/inaccessible Journal shows the generic unavailable message and does not fall back to ordinary Foundry Journal rendering.
- No UUID, flags, or internal access context is exposed in chat or rendered Journal content.

## Focused verification

Focused tests must prove:

- the ordinary reader viewer contains `Записать` and no `Закрыть` button;
- the authoritative command creates the Item on the Actor selected by existing storage access;
- the persisted flag contains the exact authoritative `sourceUuid` and `documentName` for both Journal and page references;
- a direct click on a valid record row opens the exact source in buttonless mode;
- repeated and concurrent record commands create at most one matching Item per Actor;
- deleting the Item permits a later recreation;
- ordinary Foundry Journals, malformed/unmarked Items, and ordinary Item inventory clicks remain unchanged;
- typed payload validation, sender ownership, active-GM routing, public API registration, versioned entrypoint, and cache keys remain exact.

Focused coverage belongs in `tests/storage-journal-viewer.test.mjs`, `tests/storage-app.test.mjs`, `tests/storage-socket.test.mjs`, `tests/storage-main-registration.test.mjs`, a new focused `tests/dnd5e-journal-record-link.test.mjs` that exercises the existing sheet-integration owner, and `tests/module-manifest.test.mjs`. Implementation must use test-first red/green cycles before production changes.

Before commit, run all focused tests plus the complete repository checks from `AGENTS.md`, inspect `git diff --check`, `git diff --stat`, and the substantive diff, then commit and push only task files to `origin/lich_branch` without force.
