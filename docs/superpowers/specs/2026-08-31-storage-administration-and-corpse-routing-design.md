# Storage Administration and Corpse Routing Design

## Goal

Make storage administration independent from gameplay opening, allow a GM to mark stored durable items as broken, remove persistent frames from ground piles, make corpse storage resolution consistent across browser module instances, and support an explicit mixture of manual and generated loot.

## Scope

This change extends the existing Storage owners and UI. It does not create a second storage application, a second persistence owner, or a replacement socket layer.

In scope:

- administrative drag-and-drop into the Storage configuration window;
- a persisted mixed-loot option on storage state;
- GM durability editing for stored rows;
- removal and cleanup of Rebreya ground-pile frame effects;
- dead NPC and materialized-corpse target resolution;
- focused tests, runtime verification, version bump, and function passport updates.

Out of scope:

- changing ordinary player deposits or their authorization;
- changing Lootgen generation formulas or template contents;
- changing standard Foundry token selection borders;
- repairing or destroying source Items outside storage;
- changing corpse item matching or corpse loot composition.

## Existing Owners

- `scripts/data/storage-service.js` owns token-scoped and nested storage state.
- `scripts/data/storage-command-service.js` owns authoritative deposit transactions and sender authorization.
- `scripts/main.js` owns public API composition and exact TokenDocument resolution.
- `scripts/ui/storage-app.js` and `templates/storage-app.hbs` own the Storage ApplicationV2 interaction.
- `scripts/data/durability-rules.js` owns canonical durability transitions.
- `scripts/integrations/storage-ground-pile-frame.js` owns Rebreya Sequencer frame effects.
- `scripts/data/corpse-storage-materializer.js` owns one-time corpse row materialization.
- `scripts/integrations/storage-token-hooks.js` owns corpse and storage token actions.

These owners remain canonical after the change.

## 1. Administrative Drag-and-Drop

The configuration dropzone must no longer use an indistinguishable gameplay deposit. The public deposit request gains an explicit administrative intent that is accepted only for a GM sender. The authoritative command continues to resolve the source, validate quantity and containment, consume or copy the source, write the target, and roll back through the existing transaction path.

`StorageService.depositRow()` receives a server-selected presentation policy rather than trusting the UI to choose state directly:

- gameplay deposit preserves the current behavior and results in `state: "opened"`, `displayMode: "opened"`;
- administrative deposit preserves `opened` storage as `opened`;
- administrative deposit preserves `unopened` storage as `unopened`;
- administrative deposit changes `empty` storage to `unopened` and selects the closed texture;
- nested storage applies the same scoped-state rules without overwriting sibling state.

The configuration window sends administrative intent only from its dedicated dropzone. Ordinary Storage windows, scene drops, and player deposits retain gameplay intent. Authorization is repeated by the active GM; a player cannot set the administrative flag to suppress gameplay opening.

## 2. Manual Broken-State Toggle

The item popover exposes a GM-only checkbox labelled `Сломано` when the row contains an eligible canonical Rebreya durability flag. Journal rows, coin controls, ineligible items, and rows without applicable durability do not expose the control.

Checking the control applies the existing canonical broken transition:

- `state: "broken"`;
- `breakStage: 1`;
- `hp.value: 0`;
- the existing maximum HP, material profile, construction, size, AC, threshold, eligibility, and compatible metadata remain intact.

Unchecking the control repairs the stored row to:

- `state: "intact"`;
- `breakStage: 0`;
- `hp.value` equal to the existing positive `hp.max`;
- the same non-state durability metadata.

Only the detached `itemData.flags.rebreya-main.durability` inside the selected storage row changes. The original world, compendium, or Actor Item is not updated. The existing derived-name formatter adds or removes ` (сломан)` from presentation without persisting a second display-only name mutation.

The mutation remains a GM configuration operation through the existing public module API and `StorageService.updateRowDurability()`. It refreshes the exact root or nested storage snapshot and ground-pile presentation through existing owners.

## 3. Ground-Pile Frame Removal

Rebreya stops creating persistent Sequencer rounded-rectangle frames for ground piles. The integration still performs cleanup so worlds do not retain effects created by older module versions.

For each recognized ground-pile token, cleanup removes both names:

- `rebreya-main.ground-pile-frame.<tokenUuid>`;
- `rebreya-main.ground-pile-frame.v2.<tokenUuid>`.

Cleanup runs under the existing active-GM guard during startup reconciliation and relevant token create/draw hooks. It is idempotent and becomes a safe no-op when Sequencer is absent, inactive, or has no matching effects. It does not change token texture, size, storage state, visibility, or Foundry's standard selection outline.

## 4. Corpse Storage Resolution

### Root cause

The same `isDeadNpcStorageTarget()` source is currently loaded through different browser module URLs: versioned from `main.js` and unversioned through Storage services and token hooks. Browser ESM treats these URLs as distinct module instances, and the unversioned instance can remain stale in client cache. This permits the canvas action layer to recognize a corpse while the public API or authoritative command rejects the same TokenDocument.

### Canonical predicate

Move the lightweight target predicate to a dedicated module with one new versioned URL. `main.js`, `storage-service.js`, `storage-command-service.js`, `corpse-storage-materializer.js`, and `storage-token-hooks.js` consume that exact canonical module. `corpse-storage-materializer.js` may re-export the predicate for backward compatibility, but it must not own a second implementation.

The unmaterialized target rule remains strict:

- Scene token resolves to an Actor;
- Actor type is exactly `npc`;
- Actor is not marked as a normal Rebreya storage Actor;
- resolved synthetic or linked Actor HP is a finite number at or below zero.

### Materialized corpse rule

After a token has the exact complete `corpseMaterialization` marker version 1, that marker is sufficient for Storage resolution and configuration. Live HP is no longer an additional requirement for resolving the already-materialized storage. This prevents an erroneous legacy object projection or later HP drift from making persisted corpse rows unreachable.

Startup durability reconciliation remains responsible for removing `objectDurability`, removing token AC/max/DT overrides, restoring corpse HP to zero, and restoring the prototype bar. The complete marker and stored rows survive reconciliation.

Sender permission, scene, visibility, distance, and active-GM authorization remain unchanged. An unmaterialized living NPC does not become storage.

The `ResizeObserver loop completed with undelivered notifications` warning is not part of this failure and is not addressed by this change.

## 5. Manual and Generated Loot Mode

Storage state gains a normalized boolean `mixGeneratedLoot`, defaulting to `false` for missing and existing data. It is exposed to GMs as `Подмешивать случайный лут` in the configuration form.

First-open behavior is:

| Manual content | `mixGeneratedLoot` | Result |
|---|---:|---|
| none | false | Generate as before, using the selected template or the current default Lootgen form. |
| none | true | Generate as before, using the selected template or the current default Lootgen form. |
| present | false | Reveal only manual rows and coins; do not call Lootgen. |
| present | true | Generate once, using the selected template or the current default Lootgen form, and combine generated rows/coins with manual rows/coins. |

Manual content means at least one unclaimed manual row or a positive manual coin balance. Template absence retains the current behavior: every generation route normalizes and uses the default Lootgen form. Therefore the checkbox controls whether generation is mixed into manual content, not whether a template is mandatory.

The first-open single-flight, generated result persistence, claim markers, reset semantics, and complete corpse marker keep their current idempotency guarantees. A second open never regenerates. Corpse materialization remains authoritative and never runs ordinary Lootgen, regardless of `mixGeneratedLoot`.

Administrative additions do not themselves run Lootgen. They preserve or restore the unopened state according to section 1, leaving the first gameplay open to apply this table.

## UI and Error Handling

The configuration form adds the mixed-loot checkbox beside template selection. Saving configuration submits `baseName`, `templateId`, and `mixGeneratedLoot` together through the existing public API.

The row popover adds the broken checkbox inside the existing GM edit block. While its mutation is pending, the control is disabled by the existing action/pending discipline. Failure leaves authoritative state unchanged, reports the existing Storage action notification, and refreshes only after a successful mutation.

No new window, global hook owner, or unvalidated direct world-setting write is introduced.

## Compatibility and Persistence

- Foundry target remains generation 13; live verification uses build 351.
- The supported runtime remains dnd5e 5.2.5 for the exercised world.
- Storage schema remains version 1 because the new boolean is backward-compatible and normalized from missing data.
- Existing public Storage methods remain available; new optional request fields default to current gameplay behavior.
- Existing saved storages normalize `mixGeneratedLoot` to `false`.
- Client-delivered changes require module version `1.4.195`, `scripts/main-1.4.195.js`, and the matching `module.json` entrypoint.

## Verification

Focused automated coverage must prove:

- gameplay deposit still opens storage;
- administrative deposit preserves unopened/opened and converts empty to unopened;
- a player cannot request administrative deposit semantics;
- manual-only and mixed first-open branches call or skip generation exactly once;
- missing manual content continues to generate with the default false flag;
- broken toggle mutates only the selected storage row and repairs to full maximum HP;
- ineligible, Journal, and coin rows do not expose or accept the durability toggle;
- old and v2 ground-pile effects are removed and no new frame effect is played;
- the canvas action, public API, snapshot resolver, and authoritative command agree on the same dead unlinked NPC fixture;
- a complete corpse marker remains resolvable even with a stale positive HP projection;
- a living unmaterialized NPC remains rejected;
- nested storage and existing deposit rollback/idempotency behavior remain intact;
- manifest and versioned forwarder point only to `1.4.195`.

Focused owners include `tests/storage-service.test.mjs`, `tests/storage-app.test.mjs`, `tests/storage-module-api.test.mjs`, `tests/storage-socket.test.mjs`, `tests/storage-token-hooks.test.mjs`, `tests/storage-ground-pile-frame.test.mjs`, `tests/native-durability-hooks.test.mjs`, `tests/module-manifest.test.mjs`, and `tests/storage-main-registration.test.mjs`.

Before completion, run the repository's full Node test suite, JavaScript syntax checks, JSON parsing checks, and `git diff --check`. Live Foundry verification must cover GM configuration, a normal player deposit, first opening in manual-only and mixed modes, the broken toggle, an existing ground pile, and the dead NPC shown in the reported scenario. Any unavailable live player or authenticated browser path must be reported explicitly rather than inferred from unit tests.

## Documentation

Update the Storage and durability sections of `docs/function-passport.md` for every new or changed public/internal method, state field, data flow, invariant, and focused test. Update `README.md` only if the user-facing public module API contract changes beyond optional backward-compatible request fields.
