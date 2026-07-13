# Runtime Integrity and Maintenance Design

## Purpose

Make Rebreya Main's persistent mutations reliable, centralize repeated infrastructure without changing game rules, remove proven legacy code, and turn `README.md` into the authoritative map for future maintainers and agents.

This work is split into independently testable phases. Each phase must leave the module runnable and the full test suite green.

## Global constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Before editing, fetch `origin`, verify a clean worktree, and confirm that `origin/main` or `origin/master` has no conflicting updates.
- Never use force push without explicit permission.
- Preserve existing game mechanics and automation behavior unless this specification explicitly fixes it.
- Every behavior change starts with a failing regression test.
- Refactors migrate one consumer group at a time and keep focused plus full-suite verification green.
- Runtime automations are retained, tested, and documented. They are not removed as part of cleanup.

## Phase 1: Runtime mutation integrity

### Performer automation

`Active Performance` currently tries to create an `ActiveEffect` directly from the invoking player's client. That fails when the target Actor is not owned by that player.

Introduce a strict typed socket command handled only by the active GM. The request identifies the source Actor, the Performer Item, the target Actor, and the resolved check outcome. The active GM must:

1. authenticate the transport sender;
2. verify that the sender owns the source Actor or is a GM;
3. verify that the source Item is the `ispolnitel` feat with the active-performance activity;
4. derive the die formula and ally/enemy mode server-side;
5. replace any existing managed Performer die on the target;
6. create the new `ActiveEffect`;
7. update the failure counter only after effect creation is acknowledged.

Repeated delivery must not create duplicate effects or double-increment uses. Old actor-owned copies with the canonical identifier must continue to migrate. A missing identifier may use the managed feat ID/name only as a migration fallback, never as authorization for arbitrary Items.

### Crafting, inventory, and loot claims

Persistent multi-document workflows need explicit phase records and compensation instead of relying on a sequence of unrelated Foundry writes.

- Craft queueing: reserve materials, persist the task, then commit; compensate materials if the task cannot be persisted.
- Craft cancellation: persist cancellation intent, restore materials, then remove/finalize the task.
- Craft completion: preserve the completed task until the output Item exists, then finalize it.
- Inventory take/import: record source and target quantities, apply the target mutation, apply the source mutation, and compensate the target on failure.
- Inventory sale: debit the item and credit currency through a recoverable workflow; never leave only one side committed.
- Loot claims: use a stable claim ID and durable claim state so a repeated request returns the previous outcome rather than granting value twice.

The existing trader transaction journal is the reference for idempotency and recoverable phases, but the new workflows should share only small generic primitives. Do not force unrelated domain payloads into the trader schema.

### EffectMacro routing

The compatibility socket listener must use the authenticated transport sender and active-GM election. Exactly one GM runs the original EffectMacro combat hook for a request. Duplicate request IDs are coalesced through the world mutation coordinator.

### Deferred sender binding

Socket sender spoofing is not considered an urgent table risk for the current trusted group, but new commands must bind the envelope sender to Foundry's authenticated transport sender. The shared bus should gain this validation while it is being extended, without broad legacy-protocol redesign.

## Phase 2: Managed compendium synchronization

Create one shared managed-compendium lifecycle module. It owns:

- active-GM gating;
- pack lookup/creation and metadata checks;
- document indexing by stable managed source ID;
- create/update/delete diff calculation;
- folder preparation;
- icon-only updates;
- deterministic summaries for logging and tests.

Synchronization must not delete all managed documents before replacements exist. Existing documents with stable IDs are updated in place. New documents are created before obsolete managed documents are removed. Unmanaged documents are never deleted.

Migrate compendium services one at a time. Each migration must preserve its feature-specific normalization, signatures, deterministic IDs, folders, icons, and public service methods. The shared lifecycle must not import feature-specific data or become a general-purpose dumping ground.

## Phase 3: Repository cleanup

### Versioned entrypoint archive

Before removal, copy obsolete `scripts/main-1.4.*.js` files to:

`D:\FoundryVTT\Backups\rebreya-main-entrypoints-2026-07-13`

Generate a SHA-256 manifest in that directory and verify every archived file against it. Keep only canonical `scripts/main.js` and the active `scripts/main-1.4.93.js` forwarder in the repository.

### Legacy applications

Remove the legacy trader application and template after all runtime call sites and tests use Trader V2. The current inventory application and required ApplicationV2/legacy sheet integration hooks remain unless separately proven obsolete.

### Shared helpers

Consolidate helpers only when their behavior is identical and their dependency direction stays clear:

- Foundry collection conversion;
- deep cloning;
- HTML escaping;
- narrowly defined text normalization;
- narrowly defined numeric parsing.

Do not perform a repository-wide search-and-replace. Migrate one domain at a time, compare fallback and normalization semantics, and delete a local helper only after its focused tests pass.

### Dead functions

Remove functions that have no runtime or test call sites and have a verified replacement or no remaining responsibility. Initial candidates include obsolete status normalizers, old metamagic advancement construction, unused quest/trader adapters, and unused downtime UI option lookup. Deletion is coupled to focused tests for the owning module.

## Phase 4: README as the maintenance contract

Rewrite `README.md` to describe the current module rather than historical intent. It must include:

- active manifest entrypoint and module initialization flow;
- architecture map and dependency direction;
- public `game.rebreyaMain` API grouped by domain;
- world settings, state ownership, and persistence schemas;
- socket command routing, authenticated sender rules, active-GM rules, idempotency, and mutation coordination;
- managed compendium lifecycle and the list of feature-specific compendium services;
- a complete automation catalog.

Each automation catalog entry records:

- user-facing feature name;
- source service and registration hook;
- triggering Foundry/dnd5e/Midi hook or activity;
- required Items, flags, identifiers, targets, and permissions;
- whether it runs locally or through the active GM;
- documents/effects it creates or updates;
- cleanup/rest behavior;
- focused test file.

The README also defines anti-duplication rules: check shared helpers and the architecture map before adding utilities, extend the shared compendium lifecycle instead of copying it, keep socket mutations in typed handlers, and update the automation catalog with every behavior change.

## Error handling and observability

- Domain failures return stable error codes suitable for UI messages and tests.
- Partial mutations retain enough journal evidence to retry or compensate.
- Active-GM handlers log command, request ID, phase, and sanitized document identities without dumping full Actor or Item data.
- Compendium synchronization logs counts for unchanged, created, updated, and deleted managed documents.
- Cleanup scripts and archive verification print deterministic summaries.

## Verification

Every phase requires:

1. focused tests, including injected write failures and duplicate request delivery;
2. `node --test tests/*.test.mjs`;
3. syntax checks for tracked JS/MJS files;
4. JSON parsing checks;
5. missing-relative-import scan;
6. `git diff --check`;
7. final Git status and diff review.

Live Foundry smoke checks cover Performer on a self-owned Actor, another player's Actor, and an NPC; two simultaneous GM clients for EffectMacro and compendium sync; and one forced retry for each persistent workflow.

## Delivery

Use small, meaningful commits on `lich_branch`. After all phases and documentation pass verification, fetch `origin` again, re-check divergence and conflicts, push `lich_branch` normally, and never force push.
