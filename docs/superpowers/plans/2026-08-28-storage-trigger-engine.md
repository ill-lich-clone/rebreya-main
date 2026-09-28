# Native Storage Trigger Engine Implementation Plan

> **For Codex:** Execute in this chat with focused TDD. Keep commits independently reviewable and preserve the approved design in `docs/superpowers/specs/2026-08-27-storage-trigger-engine-design.md`.

**Goal:** Give root and nested storage native, durable, active-GM trigger chains for open/claim/empty events plus a separate wide GM editor.

**Architecture:** A pure `StorageTriggerService` owns normalized versioned config, graph validation, repeat/run ledger and execution. Storage state persists its section through `StorageService`; `StorageCommandService` invokes triggers at authoritative boundaries. A dnd5e adapter and injected Foundry presentation/macro dependencies execute effects. Revisioned GM-only typed commands back a detached ApplicationV2 editor.

**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, ApplicationV2/Handlebars, Node test runner.

---

### Task 1: Versioned schema, validation, and durable state

**Files:** create `scripts/data/storage-trigger-service.js`, `tests/storage-trigger-service.test.mjs`; modify `scripts/data/storage-service.js`, `scripts/data/storage-container-snapshot.js`, their focused tests.

1. RED tests for empty v1 normalization, opaque unsupported definitions, exact event/repeat/step validators, duplicate/missing/cyclic/cross-chain targets, serializable variables, bounded receipts, root/nested independence, and legacy no-write projection.
2. Implement pure constants/normalizers/compiler. Preserve unknown chain definitions byte-for-byte as `unsupported` and block their execution/save mutation except explicit deletion.
3. Extend storage state normalization and scoped writes with `readTriggerState`, revisioned `saveTriggerDefinitions`, `resetTriggerExecutions`, and runtime-state commit methods. Config writes increment revision; runtime writes retain definitions/revision.
4. Re-run focused tests.

### Task 2: Runtime executor and adapters

**Files:** create `scripts/data/storage-trigger-dnd5e-adapter.js`; extend trigger service/tests.

1. RED tests for ordered chains, branches, prior result conditions, variables, repeat modes, safe beforeOpen denial, post-event failure, once receipt timing, macro return normalization/frozen context, and fingerprint rebinding.
2. Implement built-ins: item condition, variable/prior-result condition, check/save, consume item, damage, requester dialog, chat, notification, set/remove variable, branch, allow/deny/finish, macro.
3. Re-resolve Actor/Item/Macro on active GM. Accept macro only as exact Macro and only `{outcome,variables}`; forbid deny outside `beforeOpen` and arbitrary jumps.
4. Persist each completed step/run through injected storage runtime methods; prune deterministic terminal receipts. Document macro crash window in exposed help metadata.
5. Re-run focused tests.

### Task 3: Authoritative storage event integration

**Files:** modify `scripts/data/storage-command-service.js`, `scripts/data/storage-service.js`, `tests/storage-socket.test.mjs`, `tests/storage-service.test.mjs`.

1. RED tests: access precedes beforeOpen; denial precedes materialization/write; afterOpen sees commit; row/coin/bulk afterClaim uses compact committed result; emptied fires once after nonempty→empty and before root pile deletion; retries reuse receipts; nested scopes independent; player responses redact trigger internals.
2. Inject trigger service into command service and create one sanitized server context builder.
3. Invoke beforeOpen/afterOpen in gameplay `open`; add internal administrative open path used only by GM configuration preparation that bypasses all events.
4. Invoke afterClaim once after successful row/coin/bulk commits; detect exact-scope nonempty→empty and invoke emptied before root deletion.
5. Keep post-event errors GM-visible/logged without rollback. Re-run focused tests.

### Task 4: GM-only typed editor commands and public composition

**Files:** modify `scripts/main.js`, `tests/storage-main-registration.test.mjs`, `tests/security.test.mjs`; possibly create a focused command payload module only if existing command owner becomes unclear.

1. RED exact-payload tests for `storage.triggers.read`, `.save`, `.reset`; all GM-only. Read accepts token/path only; save accepts expected revision/full detached definition/operation ID; reset accepts token/path/operation ID.
2. Register commands and inject trigger/dnd5e/macro/presentation dependencies in `scripts/main.js` only.
3. Expose module methods `getStorageTriggers`, `saveStorageTriggers`, `resetStorageTriggerExecutions`, `openStorageTriggerEditor`; do not expose gameplay bypass.
4. Ensure ordinary snapshots/socket results omit definitions, variables, DCs, item/macro IDs, branches and runtime errors.
5. Re-run focused tests.

### Task 5: Separate wide ApplicationV2 editor

**Files:** create `scripts/ui/storage-trigger-editor.js`, `templates/storage-trigger-editor.hbs`, focused UI test; modify `scripts/ui/storage-app.js`, `templates/storage-app.hbs`, `styles/main.css`, `tests/storage-app.test.mjs`.

1. RED UI tests for compact config section/count/open/reset, separate stable window identity per token/path, four tabs, chain CRUD/enable/rename, ordered steps/reorder, inspector, nested branch labels, Macro drop, inline validation, dirty close, revision conflict preserving draft, explicit reload.
2. Implement detached draft editor at wide desktop dimensions; UI never writes flags or executes actions.
3. Save one full definition through expected revision; reset separate. Unsupported chains remain read-only and round-trip unchanged; only explicit delete removes them.
4. Wire root/nested current path from StorageApp. Re-run focused tests.

### Task 6: Documentation, full verification, and delivery

**Files:** modify `docs/function-passport.md`; update `README.md` only if public API is documented there.

1. Update signatures, owners, data flow, invariants, socket routes and focused tests in the storage passport section.
2. Run all trigger/storage focused suites, then the full `AGENTS.md` verification once after final source changes.
3. Inspect `git diff --check`, stat and substantive diff. Stage task files only.
4. Commit coherent slices (domain/state, runtime/integration, editor/composition) and push each to `origin/lich_branch`; never force push.
