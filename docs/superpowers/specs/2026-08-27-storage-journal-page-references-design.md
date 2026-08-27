# Storage Journal Page References Design

**Date:** 2026-08-27

**Status:** Approved in chat

## Goal

Allow a single `JournalEntryPage` dragged from a journal description to become a live storage reference on the scene, while preserving whole-journal drops and Foundry's native Notes Layer behavior.

## Observable behavior

- Dragging a whole `JournalEntry` to a non-Notes canvas layer keeps the current Rebreya ground-reference behavior.
- Dragging a `JournalEntryPage` to a non-Notes canvas layer creates a ground storage reference to that exact page, not to its parent journal.
- Opening the resulting row shows only the selected page.
- Later edits to the source page are visible because the row is a live reference, not a copied snapshot.
- Dragging either source on the active Notes Layer remains entirely owned by Foundry.
- Deleting or making the source inaccessible produces a controlled read error and does not reveal the parent journal or UUID to a player.

## Ownership and scope

- Canvas integration owner: `scripts/integrations/storage-transfer-drop.js`.
- Canonical source resolution owner: the existing storage deposit-source module used by `resolveStorageDepositSource()`.
- Authoritative drop owner: the existing `storage.journal.drop-to-scene` typed command and `StorageCommandService.dropJournalToScene()`.
- Ground-row owner: existing storage row/snapshot builders and `StorageGroundPileService`.
- Safe read owner: the existing storage Journal reader and viewer.
- Composition/public API owner: `scripts/main.js`.

No parallel canvas hook, scene transfer service, viewer, or Journal state owner may be introduced.

## Canonical reference model

The Journal source union gains two authoritative variants:

```js
{ kind: "journal", documentName: "JournalEntry", sourceUuid }
{ kind: "journal", documentName: "JournalEntryPage", sourceUuid }
```

`sourceUuid` is derived only from the document returned by `fromUuid()`. The client-supplied drag `type` is routing input, never authority. A resolved page must have `documentName === "JournalEntryPage"` and a real `JournalEntry` parent. A resolved whole journal must have `documentName === "JournalEntry"`.

The persisted storage row remains `rowKind: "journal"` and reference-only. It records the authoritative `sourceId` plus the expected Journal document kind so a later read cannot substitute a page for a journal or vice versa. Its display name is the page name for a page reference and the journal name for a whole-journal reference.

Existing rows without the new discriminator normalize as whole `JournalEntry` references. No eager migration write is required.

## Canvas and typed-command flow

`handleStorageCanvasDrop()` recognizes exact `JournalEntry` and `JournalEntryPage` drag types with non-empty UUIDs.

- On `canvas.notes`, it returns `true` and performs no Rebreya work.
- On other layers, it prevents the native drop and delegates to the one existing Journal scene helper.

The public `dropStorageJournalToScene()` entrypoint is broadened to accept either Journal source UUID. The typed payload uses a neutral `sourceUuid` name; the active GM re-resolves it and determines the authoritative document kind. The server does not trust a client-provided parent UUID, page name, document kind, permissions, or rendered content.

Idempotency remains bound to the exact source UUID, scene, point, sender, and mutation ID. Reusing a mutation ID for the parent journal after dropping a page, or for another page, is rejected.

## Safe live reading

For a whole journal, the reader retains its current safe multi-page projection.

For a page reference, the reader:

1. re-resolves the exact page UUID;
2. verifies the expected `JournalEntryPage` kind and real parent;
3. applies the same ownership and visibility policy used by whole-journal reads;
4. sanitizes and enriches only that page;
5. returns the existing UUID-free viewer snapshot shape with exactly one page.

The player-facing snapshot, chat announcement, transfer result, and storage grid must not contain the page UUID, parent Journal UUID, or hidden sibling page metadata.

The existing `readJournalRowIds` marker continues to key by storage `rowId`; page and whole-journal references therefore share the same first-read semantics without changing source documents.

## Failure and recovery

- Invalid, missing, or wrongly typed UUIDs fail before scene mutation.
- Failure after source resolution follows the existing consume/restore contract; Journal consumption remains a no-op copy receipt.
- Retry after a created ground reference does not create a duplicate row.
- A page removed after placement remains a visible row but produces a controlled unavailable-source error on read; it is removable by the existing GM row control.

## Verification

Focused coverage must extend:

- `tests/storage-transfer-drop.test.mjs` for layer routing of both Journal types;
- `tests/storage-deposit-source.test.mjs` for exact authoritative page resolution and parent validation;
- `tests/storage-socket.test.mjs` for typed payload validation, fingerprint binding, authorization, retry, and safe compact results;
- `tests/storage-main-registration.test.mjs` and `tests/security.test.mjs` for public API/active-GM routing;
- `tests/storage-journal-reader.test.mjs` for page-only live content and no sibling/UUID leakage;
- storage snapshot/presentation tests for page naming and backward normalization.

Implementation must update the relevant storage methods and data flow in `docs/function-passport.md`. Update the README only if the documented public scene-drop API signature changes.
