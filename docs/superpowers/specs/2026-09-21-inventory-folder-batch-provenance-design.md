# Inventory folder batch actions, provenance, and pinned folders

## Status

Approved conversational design for implementation. This specification covers one release of the existing Rebreya Main party inventory. It does not replace the inventory application, folder tree, ingress planner, mutation gateway, or active-GM ownership model.

## Observable result

Players can organize and operate on party-inventory folders without losing access to important destinations while scrolling:

- a folder context menu offers **Продать всё** and **Разобрать всё**;
- the confirmation dialog asks whether nested folders are included; direct contents are the default;
- the client sends one typed batch command and the active GM processes items strictly one at a time;
- unsuitable items are skipped and included in the final report;
- dismantling is available only for an item that currently belongs to a folder;
- dismantle outputs pass through current incoming-loot rules, then fall back to the source item's folder;
- every inventory Item can show up to ten recent acquisition sources through an info button immediately before the quantity metric;
- each user can pin folders into a sticky drop-target strip that remains visible while the main inventory scrolls;
- the price metric caption is shortened from **Цена за 1 шт.** to **1 шт.**.

## Existing owners and constraints

- `scripts/data/inventory-service.js` remains the authoritative owner of inventory reads and mutations.
- `scripts/data/inventory-folder-tree.js` remains the pure owner of folder normalization, traversal, and projection.
- `scripts/application/inventory-ingress-planner.js` and the existing ingress-rule compiler remain the only rule-evaluation path.
- `scripts/ui/inventory-app.js` remains the only ApplicationV2 owner for the party inventory UI.
- `scripts/main.js` remains the composition root and typed-command registration owner.
- UI code must not update Actor inventory flags, Items, or world settings directly.
- A player operation requiring GM authority must use one exact typed command with sender authorization on the active GM.
- Folder Item operations are sequential. Neither the client nor the active GM uses `Promise.all` for sale or dismantle mutations.
- Existing single-item durable sale and dismantle operations remain the mutation primitives. A new batch layer orchestrates them; it does not introduce a second sale/dismantle implementation.

## 1. Folder batch command

### Contract

Add one typed command for folder actions. Its exact payload contains:

```js
{
  groupActorId: string,
  folderId: string,
  action: "sell" | "dismantle",
  includeDescendants: boolean,
  operationId: string
}
```

The public module API exposes one corresponding method used by InventoryApp. The validator rejects extra keys, blank identifiers, unknown actions, and non-boolean recursion. Authorization requires the authenticated sender to have the existing party-inventory participation/organization capability for the exact group. Socket identity, not payload identity, determines the sender.

The command uses a group-scoped scheduling key. The client makes one socket request after confirmation. The active GM re-reads the group Actor, folder state, membership, current Items, and permissions before selecting work.

### Item selection

The direct folder contents are selected by default. When `includeDescendants` is true, descendants are traversed deterministically using the canonical folder tree. Each Item ID appears at most once. The active GM captures a stable ordered list before processing; folder changes made after that point do not add new work to the running batch.

If the folder no longer exists, the command fails before any mutation. If a captured Item disappears or moves out of the selected scope before its turn, it is reported as skipped. The implementation must not silently fall back to the inventory root.

### Sequential execution and report

Items are processed in deterministic folder/item order with `await` inside a normal loop. Each child operation receives a deterministic mutation ID derived from the batch operation ID, action, and Item ID. Existing child mutation journals provide per-item retry safety. This design deliberately does not add a separate persisted batch queue: after a process/GM failover, completed child mutations remain safe and the user may run the folder action again for remaining Items.

The result is detached plain data:

```js
{
  action: "sell" | "dismantle",
  folderId: string,
  includeDescendants: boolean,
  processed: Array<object>,
  skipped: Array<{ itemId: string, itemName: string, code: string, message: string }>,
  failed: Array<{ itemId: string, itemName: string, code: string, message: string }>,
  stopped: boolean,
  totals: object
}
```

Known ineligible cases are `skipped` and processing continues. Ordinary isolated item failures are recorded in `failed` and processing continues. A reconciliation-required or invariant failure sets `stopped:true` and stops the remaining queue so later mutations cannot obscure a state-integrity problem.

### Confirmation UI

The folder context menu adds **Продать всё** and **Разобрать всё** without removing the existing create, rename, color, popout, and delete actions. Each action opens a DialogV2 confirmation that:

- names the selected folder;
- shows a non-authoritative count of direct eligible/skipped Items from the current cached snapshot;
- has an unchecked **Включая вложенные папки** checkbox;
- explains that the active GM will revalidate the final set;
- sends exactly one batch request after confirmation.

The completion dialog/report displays processed, skipped, failed, total currency, and material outputs. Cancel and close perform no mutation and show no success notification.

## 2. Sale rules

Create one canonical sale-pricing helper used by both single-item and folder batch sale.

- Magical Items are never sold through this inventory flow. They are skipped in a batch and rejected by the single-item command.
- A treasure sells for 100% of its unit price.
- Every other non-magical sellable Item sells for 50% of its unit price.
- An Item without a positive price is skipped/rejected.

Treasure detection uses the canonical D&D5e Item classification (`system.type.value === "treasure"`) produced by the existing Rebreya **Сокровища** projection. Any compatibility fallback must live beside that helper and be covered by a focused test; UI labels or Item names are not authoritative classification.

The existing currency receipt and source-debit compensation order remain unchanged. Only the sale multiplier becomes classification-aware.

## 3. Dismantle folder requirement and ingress routing

### Folder gate

An authoritative dismantle operation re-reads `inventoryFolders` and requires the source Item to have a valid non-null folder membership. An Item at inventory root cannot be dismantled. The UI hides or disables its single-item dismantle action, but the service check is authoritative.

Deleting or moving the folder before execution cannot route output to root. The operation fails or is skipped before target credit.

### Output routing

For every material output, build a trusted ingress row from the server-derived material ItemData and evaluate it through the existing ingress planner/rule compiler. The requested fallback folder is the source Item's current folder.

Resolution order is:

1. A matching `folder` rule routes the material to that folder.
2. A matching `skip` rule produces no material target and records that outcome.
3. With no matching rule, the material is credited to the source Item's folder.

A material output is never recursively dismantled. An impossible or stale rule result fails closed. The target merge candidate must be in the resolved destination folder; a material stack in another folder is not merged across folder boundaries.

The chosen destination and rule revision become part of the durable dismantle record before target credit. Recovery uses the recorded destination and never re-routes an already prepared operation through newer rules.

## 4. Item acquisition history

### Stored schema

Add a module-owned versioned Item flag, owned by a small pure helper module rather than by the UI:

```js
flags["rebreya-main"].inventoryAcquisitionHistory = {
  version: 1,
  entries: [{
    recordedAt: number,
    worldTime: number | null,
    quantity: number,
    method: "lootgen" | "storage" | "transfer" | "manual" | "dismantle" | "other",
    sceneId: string,
    sceneName: string,
    sourceType: string,
    sourceId: string,
    sourceName: string,
    detail: string
  }]
}
```

Normalization accepts only detached plain data, trims and bounds display strings, rejects non-finite quantities/timestamps, sorts newest first, and keeps at most ten entries. Missing or invalid legacy data normalizes to an empty history without a read-time write.

`recordedAt` establishes deterministic recency; `worldTime` is informative when available. IDs are stored only when known. Names are never inferred from an unrelated currently selected token or scene.

### Capture points

Every canonical group-inventory ingress prepares one acquisition entry before target creation or merge:

- Lootgen: known generated source plus the explicitly known/current scene when available;
- storage: storage/token/Actor name and its scene when available;
- external Item transfer/import: source Actor/token and explicit source scene when available;
- manual addition: **Ручное добавление** and the acting user;
- dismantle: **Разбор — <имя предмета>**, output quantity, and the authoritative scene/source context.

For dismantled materials, the latest known provenance of the source Item is copied into `detail` when available, so the material can show both the dismantled Item and its earlier monster/storage origin. Missing scene or source fields stay empty rather than being guessed.

Moving an Item between folders in the same group does not create an acquisition event. When an incoming stack merges into an existing stack, the new event is appended to the target Item history in the same authoritative mutation that changes quantity. Existing history is preserved, normalized, and capped to the newest ten entries.

Existing Items without the flag remain valid and display **Источник не записан**.

### Information dialog

Each inventory Item row receives a compact info button immediately before the quantity metric. It opens a read-only DialogV2 showing up to ten entries newest-first with quantity, scene, source, method, and time when available. Handlebars escaping or DOM `textContent` is required for every stored display value. The button remains available for empty legacy history and then shows the explicit empty-state message.

The price metric caption changes from **Цена за 1 шт.** to **1 шт.**. Price calculation and formatting do not otherwise change.

## 5. Personal pinned folders

### User state

Upgrade the client-scoped/user-scoped `inventoryFolderUi` schema to version 2:

```js
{
  version: 2,
  groups: {
    [groupActorId]: {
      expandedFolderIds: string[],
      pinnedFolderIds: string[]
    }
  }
}
```

Reading version 1 preserves normalized `expandedFolderIds` and initializes `pinnedFolderIds` to an empty array. Writes preserve both fields and other groups. Both arrays are normalized against current folder IDs. Deleted or inaccessible folders disappear from the projected personal state without mutating Actor folder state.

Add a personal `setInventoryFolderPinned(groupActorId, folderId, pinned)` API beside `setInventoryFolderExpanded`. It writes only the current User flag through the existing per-user mutation queue. It performs no Actor/world mutation and requires the folder to exist when pinning.

### UI and drag/drop

The folder context menu shows **Закрепить** or **Открепить** according to the current user's state. In the main inventory item mode, a compact sticky strip appears below the toolbar when at least one folder is pinned. It remains inside the visible scroll area with explicit background, border, and stacking context.

Each pinned shortcut displays folder color, name, and recursive Item count. It is a shortcut only: it does not duplicate folder contents or alter expansion. The strip is omitted from folder popouts and from ingress-rule editing mode.

Pinned shortcuts are exact same-group folder drop targets. Drag hover uses cached state only. Drop re-reads a fresh group snapshot, verifies group/folder/permissions, then invokes the existing typed Item-to-folder move API. A stale pinned target warns and refreshes; it never falls back to root. No new socket route is introduced for the move itself.

Keyboard focus, accessible names, visible focus styling, narrow-window wrapping, and drag-target feedback are required.

## 6. Error handling and notifications

- Active-GM absence returns the existing structured availability error; the player never performs the privileged mutation locally.
- Authorization failures are not converted into skipped Items.
- Missing/moved/ineligible Items become explicit report rows with stable codes.
- Cancellation is silent.
- An entirely empty/unsuitable batch completes with a report and no Item/currency writes.
- A reconciliation-required child failure stops the batch and is surfaced prominently.
- Source-history write failures participate in the owning target mutation; an Item quantity must not advance while its required provenance update is silently lost.
- UI refresh occurs once after the batch result, not after every child operation.

## 7. Tests and verification

### Focused automated coverage

- `tests/inventory-folder-tree.test.mjs`
  - deterministic direct/recursive folder Item selection;
  - normalization of pinned IDs without input mutation.
- `tests/inventory-folder-socket.test.mjs`
  - v1-to-v2 User state migration;
  - independent users/groups and stale pinned-folder removal;
  - personal pin writes preserve expansion state.
- `tests/inventory-app-context.test.mjs`
  - folder context actions and recursion dialog;
  - one batch API call per confirmation;
  - sticky pinned projection and pinned drop through the existing move API;
  - info-button projection, empty history, and **1 шт.** caption.
- `tests/group-command-dispatch.test.mjs`
  - exact batch payload validation, sender authorization, active-GM route, and group-scoped scheduling.
- `tests/inventory-mutation-recovery.test.mjs`
  - treasure 100%, ordinary 50%, magical/zero-price skip;
  - strict sequential execution and deterministic child IDs;
  - ordinary skip/failure continuation and reconciliation stop;
  - folder-required dismantle;
  - ingress folder/skip/fallback routing recorded before credit;
  - destination-scoped material merging and retry behavior.
- A focused provenance test file or the closest existing owner test
  - normalization/cap at ten;
  - create and merge history updates;
  - dismantle material detail inheritance;
  - no event for same-group folder movement.
- `tests/main-composition-root.test.mjs` and `tests/module-manifest.test.mjs`
  - one registered command/API owner and current release/cache keys.

### Live Foundry verification

Use Foundry VTT 13 with the installed dnd5e world and verify:

- GM and player folder context menus;
- one batch request from a player and sequential active-GM effects;
- direct versus recursive confirmation;
- sale totals for treasure/ordinary/magical mixes;
- dismantle routing by matching folder rule, skip rule, and fallback;
- info dialog with long Russian names and ten entries;
- personal pins differ between two users;
- pinned drag remains usable after scrolling to the bottom;
- narrow viewport and default/alternate theme layout;
- no new console exceptions, duplicate hooks, or deprecation warnings.

### Release checks

- Update `docs/function-passport.md` for every new/changed method and data flow.
- Update the relevant README inventory contract.
- Increment `module.json` version, create the matching minimal `scripts/main-<version>.js` forwarder, update `esmodules`, and synchronize changed inbound cache keys.
- Run focused tests during TDD, then once on the final tree run:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

## Non-goals

- No replacement inventory application or new framework.
- No parallel per-Item mutations.
- No direct UI writes to Actor Items or folder flags.
- No automatic sale of magical Items.
- No recursive dismantling of material outputs.
- No backfill that invents provenance for existing Items.
- No persisted resumable parent batch queue in this release.
