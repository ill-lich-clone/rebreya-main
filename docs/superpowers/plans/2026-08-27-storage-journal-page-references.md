# Storage Journal Page References Implementation Plan

> **For Codex:** Execute this plan in the current session with focused TDD and a review checkpoint after each task.

**Goal:** Dragging a `JournalEntryPage` from a journal description onto a non-Notes canvas layer creates a live storage reference to that exact page, while whole-journal drops and native Notes Layer behavior remain unchanged.

**Architecture:** Extend the existing journal source union with authoritative `sourceUuid` and `documentName`. Route both Foundry journal document kinds through the existing active-GM command, persist the expected document kind on journal rows, and make the existing reader return either all pages or exactly the referenced page. Legacy rows without a document kind normalize as `JournalEntry`.

**Tech Stack:** Foundry VTT 13, ES modules, Node test runner.

---

### Task 1: Define the source and canvas-routing contract

**Files:**
- Modify: `tests/storage-deposit-source.test.mjs`
- Modify: `tests/storage-transfer-drop.test.mjs`
- Modify: `scripts/data/storage-deposit-source.js`
- Modify: `scripts/integrations/storage-transfer-drop.js`

1. Add failing tests for exact canonical/Foundry `JournalEntryPage` payloads, authoritative document-kind validation, non-Notes routing, and Notes Layer passthrough for both journal kinds.
2. Run `node --test tests/storage-deposit-source.test.mjs tests/storage-transfer-drop.test.mjs` and record the expected failures.
3. Replace journal-only `journalUuid` source references with `{ kind: "journal", sourceUuid, documentName }`, resolving the UUID again on the active GM and rejecting a document whose resolved kind differs.
4. Store `sourceDocumentName` on the resulting journal row and route both `JournalEntry` and `JournalEntryPage` through the existing canvas helper outside Notes Layer.
5. Re-run the focused tests.

### Task 2: Preserve the document kind and read exactly one live page

**Files:**
- Modify: `tests/storage-container-snapshot.test.mjs`
- Modify: `tests/storage-service.test.mjs`
- Modify: `tests/storage-journal-reader.test.mjs`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `scripts/data/storage-container-snapshot.js`
- Modify: `scripts/data/storage-journal-reader.js`
- Modify: `scripts/data/storage-command-service.js`

1. Add failing tests proving page rows survive normalization/deposit, old rows default to `JournalEntry`, page reads expose no sibling pages, and the GM command passes the authoritative row kind to the reader.
2. Run the four focused suites and record expected failures.
3. Normalize `sourceDocumentName` to `JournalEntry` or `JournalEntryPage`; default missing legacy values to `JournalEntry`.
4. Extend `StorageJournalReader.read(sourceUuid, { documentName })` to resolve and validate the exact document. For a page, serialize only that page and use its parent name as the journal title without exposing UUIDs or siblings.
5. Have `readJournal` pass the row's normalized expected kind while keeping the read marker keyed only by `rowId`.
6. Re-run the focused suites.

### Task 3: Broaden the typed scene command and public API

**Files:**
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`

1. Add failing tests for exact `{ sourceUuid, documentName, mutationId, sceneId, x, y }` validation, page identity in idempotency fingerprints, and the broadened public API.
2. Run the two focused suites and record expected failures.
3. Change the existing command payload and public API to neutral source identity; active GM resolves and verifies the exact kind through the existing deposit-source service.
4. Keep command name, permission model, compact result, rollback, and ground-pile transfer unchanged.
5. Re-run the focused suites.

### Task 4: Document and verify

**Files:**
- Modify: `docs/function-passport.md`

1. Update the storage deposit, journal reader, scene-drop API/command, integration routing, constraints, data flow, and focused-test entries.
2. Run all focused suites touched above.
3. Run the full project verification required by `AGENTS.md` once after the final source change.
4. Inspect `git diff --check`, `git diff --stat`, and the substantive diff; stage only task files.
5. Commit with `feat(storage): support journal page references` and push `lich_branch`.
