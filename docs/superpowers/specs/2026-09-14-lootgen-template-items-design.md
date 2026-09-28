# Lootgen template Items and storage assignment

## Status

Approved direction, pending user review of this written specification. This document defines the design only; implementation is a separate stage.

## Goal

Replace the world-setting-backed Lootgen template catalog with ordinary Foundry Item documents of the module-defined type `rebreya-main.lootgen-template`. A GM edits these Items through the existing Lootgen UI and assigns one to a storage by dragging the Item into a dedicated template field.

Assignment copies an immutable normalized template snapshot into the selected root or nested storage. Later edits or deletion of the source Item do not change or break that storage. Existing storage snapshots continue to work without migration. Existing templates in the current world setting are converted to Items automatically once by the active GM.

## User-visible behavior

### Lootgen templates

- Foundry displays the module-defined Item subtype as `Шаблон лут-генератора`.
- Saving a new template from Lootgen creates a World Item in the module-owned `Шаблоны Lootgen` Item folder.
- Opening such an Item opens Lootgen in template-editing mode with the Item's normalized form loaded.
- Saving in template-editing mode updates that exact Item rather than creating another template.
- Template listing, applying, renaming, and deletion in Lootgen operate on Item documents rather than the legacy world setting.
- A template Item remains a configuration document. It cannot be granted as loot, deposited as an ordinary storage row, used by inventory ingress, or treated as physical equipment.

### Storage configuration

- The `Шаблон Lootgen` select is replaced by a template drop field.
- The field accepts only a resolvable Item whose exact type is `rebreya-main.lootgen-template`.
- A valid drop displays the source Item icon and name and immediately assigns a normalized snapshot through the authoritative storage mutation route.
- The field exposes explicit actions to open/edit the source Item when it still exists, replace it by another drop, and clear the assignment.
- Missing or deleted sources are shown as unavailable, but the stored snapshot remains valid.
- Assigning a template does not reset or regenerate an already opened storage. The configuration explains that the template will be used on the next first-open after `Сбросить содержимое`.
- Reset remains explicit and preserves the assigned template, manual rows, manual coins, texture set, and mix-generated-loot choice while clearing generated contents and returning the storage to `unopened`.
- Manual content keeps the existing rule: when `mixGeneratedLoot` is false, first-open does not generate random loot. The UI must state this next to the template field whenever manual content exists.

### Snapshot semantics

- Dropping a template copies its current normalized form into the storage.
- Editing the source Item later affects only future assignments.
- To apply an edited template to an existing storage, the GM drops the Item into that storage again.
- Generation never requires the source Item to still exist and never resolves it during player open.
- A player opening storage cannot choose or alter a template.

## Foundry document model

### Manifest subtype

`module.json` adds the module subtype key `lootgen-template` under `documentTypes.Item`. Foundry stores the qualified type as `rebreya-main.lootgen-template`.

The subtype is registered during `init`, before documents are prepared, using `CONFIG.Item.dataModels["rebreya-main.lootgen-template"]`. It uses a dedicated `foundry.abstract.TypeDataModel` rather than inheriting a physical dnd5e Item model. This avoids quantity, price, activities, container, equipment, and inventory semantics.

The model schema is versioned and contains only module-owned template data:

```js
system: {
  schemaVersion: 1,
  form: { /* normalized Lootgen form */ }
}
```

The canonical Item name and image remain the Foundry document's root `name` and `img`. The implementation must validate and normalize `system.form` at every Item create/update, migration, assignment, and Lootgen load boundary. Unknown future schema versions fail closed with an explanatory UI error and are never silently rewritten.

Optional migration identity is stored under:

```js
flags: {
  "rebreya-main": {
    lootgenTemplate: {
      legacyTemplateId: "..."
    }
  }
}
```

Only migrated Items receive `legacyTemplateId`. Newly created templates need no secondary identity beyond their Foundry UUID.

### Sheet integration

A subtype-specific Item sheet adapter is registered through the supported Foundry v13 sheet registration API. It does not duplicate the Lootgen form. Rendering/opening the sheet delegates to the existing composition-owned Lootgen application in template-editing mode. The binding contains only the Item UUID; every load and save re-resolves the current document.

If the source is not editable by the current user, Lootgen opens read-only or reports that the template cannot be edited. Only GMs may create, migrate, update, or delete template Items through module APIs.

## Storage snapshot schema

The existing storage `template` field remains backward-compatible.

Legacy snapshots continue to normalize and generate:

```js
template: {
  name: "Legacy template",
  form: { /* normalized form */ }
}
```

New assignments store:

```js
template: {
  version: 2,
  name: "Bandit cache",
  img: "icons/...webp",
  form: { /* normalized form */ },
  sourceUuid: "Item...",
  assignedAt: 1234567890
}
```

`form` is the only generation input. `sourceUuid`, `name`, `img`, and `assignedAt` are presentation and provenance. They never grant authority and are not dereferenced during player open.

Storage normalization must preserve valid legacy snapshots byte-semantically apart from the existing canonical form normalization. It must reject malformed new snapshots without damaging the rest of the storage state.

## Ownership and data flow

### Canonical owners

- Item schema, projection, validation, and legacy conversion: a focused Lootgen template Item service under `scripts/data/`.
- World Item creation/update/delete and migration orchestration: the same service or a narrow repository owned by it.
- Lootgen editing state: existing `LootgenApp`.
- Storage snapshot persistence and first-open behavior: existing `StorageService`.
- Authorization, token/path re-resolution, and root-token serialization: existing `StorageCommandService`.
- Composition, public API compatibility, socket registration, and lifecycle wiring: `scripts/main.js`.
- Storage drag UI: existing `StorageApp` and `templates/storage-app.hbs`.

No second Lootgen application, storage application, generation engine, socket bus, or settings repository is introduced.

### Assignment flow

1. The Storage UI reads Foundry drag data and extracts only an Item UUID.
2. The UI sends `{ tokenUuid, path, itemUuid, operationId }`; it does not send or trust template form data.
3. The active GM re-resolves the storage token/path and Item.
4. The command verifies GM authority, exact Item subtype, supported schema version, and normalized form.
5. The command builds the detached version-2 snapshot from the authoritative Item.
6. The snapshot is written through `StorageService.configure()` inside the existing root storage queue.
7. The command returns a compact safe projection and StorageApp refreshes its snapshot.

Clearing a template uses the same route with an explicit clear operation. Reusing an operation ID with different token, path, Item, or sender is rejected.

### First-open flow

Player open remains `player -> SocketCommandBus -> active GM -> StorageCommandService.open() -> StorageService.open()`. `StorageService` generates only on the existing first-open boundary and uses only `current.template.form`. Item lookup, Item permission checks, template migration, and catalog refresh are prohibited from this path.

Template assignment/clear and first-open must share the existing root storage queue. This removes the current race where direct GM configuration and a simultaneous player open can read and write different storage snapshots. Other storage configuration writes touching the same state must enter the same queue or use an equivalent atomic patch owned by the command service; UI code must not write flags directly.

## Legacy migration

### Source

The existing `SETTINGS_KEYS.LOOTGEN_TEMPLATES` world setting remains readable as migration input. Existing storage documents do not depend on this setting because they already contain detached `{name, form}` snapshots.

### Execution

- Migration runs only on the active GM after the Item subtype, settings, Lootgen normalization, and world collections are ready.
- It creates or resolves one module-owned Item folder named `Шаблоны Lootgen`.
- For each valid legacy template, it searches for an Item with the exact module flag `legacyTemplateId`.
- Missing Items are created from the legacy name and normalized form. Existing matching Items are left unchanged so user edits are never overwritten.
- Duplicate matching Items are reported and not multiplied; the migration picks no arbitrary document for destructive repair.
- Invalid legacy rows are reported individually and keep migration incomplete.
- A migration setting records schema version, completion, migrated legacy IDs, and errors. Completion is written only after every valid legacy row has a corresponding Item and no unresolved error remains.
- Once complete, startup does not recreate Items deleted intentionally by the GM.
- The legacy template payload is retained for rollback/recovery but is no longer a runtime catalog after completion.
- A partial run is safe to repeat after reload or active-GM reassignment.

No storage token, Actor prototype, generated loot, or old storage template snapshot is rewritten by this migration.

## Public API compatibility

Existing public methods remain available so UI and external callers do not break abruptly:

- `listLootgenTemplates()` returns safe projections derived from Item documents.
- `getLootgenTemplate(idOrUuid)` accepts a current Item UUID/ID and may resolve a migrated legacy ID through the migration flag.
- `saveLootgenTemplate(payload)` creates a new Item unless an explicit editable Item UUID is supplied.
- `removeLootgenTemplate(idOrUuid)` deletes the resolved template Item after the existing confirmation path.

Returned projections retain `{ id, name, form }` and may add `{ uuid, img, schemaVersion }`. Callers must not receive live mutable Item data.

The existing world-setting catalog class becomes migration/compatibility code only. It must not remain a second writable template owner.

## Validation and failure behavior

- Non-GM assignment, clearing, migration, creation, update, and deletion fail before mutation.
- Dragging an ordinary Item, embedded Actor Item, malformed UUID, unsupported template version, or invalid form leaves storage unchanged and shows one actionable error.
- World and compendium Item UUIDs may be assigned if they resolve to the exact subtype; editing still follows Foundry ownership. Because assignment stores a snapshot, later pack locking or deletion is harmless.
- A failed storage write leaves the prior template snapshot intact.
- A failed migration Item creation leaves the legacy setting untouched and migration incomplete.
- A failed Item update leaves the prior Item form intact.
- Assigning to an opened/empty storage succeeds as configuration but does not mutate generated rows. The UI explicitly indicates that reset is required before regeneration.
- Storage open keeps its compact socket acknowledgement and never sends the template form or generated rows back in the command result.

## Scope exclusions

- No live link that automatically updates assigned storages.
- No automatic reset or regeneration when a template is assigned or edited.
- No player-side template editing or assignment.
- No physical inventory behavior for template Items.
- No migration of existing storage snapshots into Item links.
- No deletion of the legacy setting payload in this change.
- No redesign of Lootgen generation rules or storage access/distance rules.
- No replacement of the existing StorageApp or LootgenApp.

## Focused verification

Implementation begins with failing focused Node tests and then the smallest owner changes.

Required automated coverage:

- Manifest declares `lootgen-template` and the current versioned entrypoint remains valid.
- Item subtype registration uses `rebreya-main.lootgen-template`, a dedicated model, label, and icon without depending on a physical dnd5e Item model.
- Template Item normalization accepts canonical forms and rejects malformed/future schemas.
- Lootgen create/edit/apply/delete APIs operate on detached Item projections.
- Migration converts every legacy row once, resumes partial runs, avoids duplicates, preserves user-edited migrated Items, and does not recreate intentionally deleted Items after completion.
- Existing storage `{name, form}` snapshots open unchanged.
- A valid Item drop stores an authoritative detached version-2 snapshot.
- Editing/deleting the source Item does not change or break assigned storage.
- Re-dropping the edited Item replaces only the template snapshot.
- Invalid/non-template Item drops and unauthorized callers do not mutate storage.
- Assignment to an opened storage preserves generated/manual contents and requires explicit reset before another generation.
- Manual-content and `mixGeneratedLoot:false` behavior remains unchanged and is represented correctly in UI context.
- Template assignment and simultaneous player first-open serialize on the same root token and produce one deterministic result.
- Storage open still invokes generation once and returns a compact socket acknowledgement.
- Template Items are rejected from ordinary inventory/storage deposit and loot transfer routes.
- Hook/sheet registration is idempotent across repeated initialization fixtures.

Expected focused files include:

- `tests/lootgen-template-item.test.mjs` (new owner test)
- `tests/lootgen-template-catalog.test.mjs`
- `tests/lootgen-app-context.test.mjs`
- `tests/storage-service.test.mjs`
- `tests/storage-socket.test.mjs`
- `tests/storage-app.test.mjs`
- `tests/storage-main-registration.test.mjs`
- `tests/module-manifest.test.mjs`
- `tests/main-composition-root.test.mjs`

Before commit, run the repository's complete Node suite, `git diff --check`, JavaScript syntax checks, and JSON parsing checks from `AGENTS.md`.

Per user instruction, implementation completion does **not** require launching Foundry, connecting a browser, or running live GM/player UI tests. The final report must clearly state that runtime UI behavior remains for manual user verification and provide this checklist:

1. Migrated template Items appear once in `Шаблоны Lootgen`.
2. Opening and saving an Item edits it through Lootgen.
3. Dropping it into a new unopened barrel shows the assigned snapshot.
4. A player first-open generates from that snapshot and changes the barrel presentation.
5. Editing the Item does not change the already assigned barrel.
6. Re-dropping plus explicit reset makes the next first-open use the new revision.
7. An old configured storage still opens using its legacy snapshot.

## Definition of done

- The world setting is no longer the runtime owner of templates after successful migration.
- Existing setting templates are represented by exactly one editable Foundry Item each.
- New templates are created and edited as Items through Lootgen.
- Storage assignment is drag-and-drop, authoritative, snapshot-based, and serialized with open.
- Existing storages and their generated/manual contents are preserved.
- All required automated and repository checks pass.
- `docs/function-passport.md` and the relevant README API/UI section describe the final implemented methods, ownership, migration, and data flow in the same implementation commit.
- `module.json` version and `scripts/main-<version>.js` are advanced together for all player-delivered changes.
