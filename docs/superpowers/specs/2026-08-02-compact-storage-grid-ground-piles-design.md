# Compact Storage Grid and Ground Piles Design

## Goal

Replace the current storage row list with a token-anchored icon grid and let authorized users move a chosen quantity of loot to a character, the Rebreya group inventory, or the active scene.

Scene drops become Rebreya-owned ground piles. A ground pile is a specialized, already-open storage token with the same contents model, access rules, compact window, active-GM authority, and concurrency guarantees as a chest. The feature does not call, inspect, or depend on Item Piles.

## Scope

This design covers:

- an automatically sized storage icon grid;
- an item popover opened by left click;
- document links for source items;
- quantity-aware click claims and drag-and-drop transfers;
- supported drops into owned actor sheets, the Rebreya group inventory, and the active canvas;
- Rebreya ground-pile creation, merging, renaming, retexturing, and deletion;
- generated PNG token art for the lootgen categories;
- active-GM validation, serialization, and retry safety;
- GM editing controls inside the item popover.

It does not add an Item Piles compatibility path, import Item Piles concepts at runtime, or require BG3 HUD. Coins remain a separate compact cell and retain their existing claim behavior; the new partial-transfer protocol applies to item rows.

## Compact Storage Window

The storage application remains initially anchored above its scene token and keeps the existing pointer that identifies the owning chest or pile. The content area becomes an icon-only CSS grid.

- Up to six positions use a compact three-column layout, normally `3 x 2`.
- Every cell contains the item image and a quantity badge in a corner.
- The quantity badge is shown when quantity is greater than one.
- A coin summary, when present, occupies a separate compact cell.
- The window has no pages or paging arrows.
- More than six positions cause the grid and application window to grow in both dimensions toward an approximately square layout.
- The window stays clamped around the token and inside the visible viewport.
- Normal scrolling appears only when the full grid cannot fit inside the viewport.
- Dragging the Foundry window header keeps the existing detach behavior.

The layout recomputes after every successful content mutation. Removing positions therefore shrinks the window without requiring it to be reopened.

## Item Popover

Left-clicking an item icon opens one persistent popover anchored to that grid cell. Only one item popover can be open in an application.

The player popover contains:

- the item name as a clickable Foundry document link;
- `Забрать себе`;
- `В группу`.

The link resolves the row's canonical source document using the existing lootgen `sourceType` and `sourceId` pipeline. When a canonical document cannot be resolved, the name remains visible as plain text instead of creating a broken link.

The GM popover additionally contains:

- a quantity input with a minimum of one;
- a save action;
- a delete action.

Generated and manually added rows use the same controls. Clicking the active icon again, clicking outside the popover, pressing Escape, removing the row, or closing the application closes it.

## Quantity Selection

Every item operation accepts a positive integer quantity no greater than the authoritative amount currently available in the source row.

- When the row quantity is one, the operation proceeds immediately.
- When it is greater than one, the destination opens a compact `Сколько перенести?` dialog before any state mutation.
- The dialog defaults to the full available quantity and constrains the input to `1..available`.
- Cancelling or closing the dialog performs no operation.
- The active GM validates the quantity again; client-provided availability is display-only.

The dialog is used by `Забрать себе`, `В группу`, actor-sheet drops, group-inventory drops, and canvas drops.

## Drag Payload and Supported Destinations

Dragging a storage icon emits a Rebreya claim payload rather than a normal embedded Item copy. The payload identifies the source storage token, stable row ID, requesting user, and a unique mutation ID. It does not contain authority to grant or remove content.

Supported destinations are:

1. An owned character sheet. A `dropActorSheetData` handler intercepts the Rebreya payload, prevents native Foundry from independently copying it, asks for quantity, and routes the transfer through the active GM.
2. The Rebreya group inventory. Its existing drop surface recognizes the payload, asks for quantity, and routes the same authoritative transfer.
3. The active canvas. A `dropCanvasData` handler asks for quantity and requests creation or merging of a ground pile at the drop point.

Unsupported applications ignore the custom payload without changing the source. A rejected target, cancelled quantity dialog, insufficient permission, stale row, or network error leaves the source unchanged.

## Quantity-Aware Storage Rows

The existing all-or-nothing storage claim operation becomes quantity-aware while preserving stable row IDs and legacy claimed-row behavior.

- A full transfer marks the row claimed using the current mechanism.
- A partial transfer keeps the row visible and decreases both `row.quantity` and `row.itemData.system.quantity`.
- A later transfer can claim the remaining amount.
- Generated and manual rows follow the same mutation rules.
- Empty-state calculation continues to consider remaining item rows and coins.

Storage snapshots are refreshed after every mutation so every open client sees the new badge amount or row removal.

## Authoritative Transfer Protocol

All transfers are executed by the active GM through one `StorageTransferService`. The service serializes operations per source token and uses the mutation ID as an idempotency key.

For each request it:

1. Resolves the current source token and row.
2. Verifies the requesting user's access, ownership, active scene, visibility, distance, destination permission, and authoritative quantity.
3. Records or resumes the mutation under its unique ID.
4. Adds the chosen quantity to the destination using the existing once-safe inventory grant methods or the ground-pile service.
5. Decrements or fully claims the source row.
6. Publishes the resulting storage snapshots.

The destination grant and source decrement retain enough mutation state to resume safely after an interrupted request. A retry does not add the destination item twice and continues any incomplete source decrement. Concurrent requests for the same final units are serialized; the later request fails cleanly if the quantity is no longer available.

## Ground-Pile Model

A ground pile is an unlinked token derived from one restored Rebreya storage prototype actor. Its concrete contents and presentation live on the token, so every placed pile is independent.

Ground-pile state differs from a chest in these ways:

- it starts in the already-open state and never generates loot;
- it uses the compact storage grid immediately;
- it does not play the chest-opening sound;
- it is marked with a Rebreya ground-pile flag;
- losing its final item row and any remaining coin content deletes its scene token instead of displaying `(пусто)`.

The active GM owns all token creation, updates, and deletion. A GM may also move or delete the token normally. Players must satisfy the same owned-character, visibility, active-scene, and five-foot interaction rules used by storage. A player canvas drop point must also be within five feet of the controlled character used for the request; a GM may place a pile anywhere on the active scene.

## Ground-Pile Merging

A canvas drop on empty scene space creates a new ground pile. A drop whose point intersects an existing Rebreya ground-pile token adds the item to that pile instead.

Rows are considered the same stack when their canonical lootgen identity matches, including broken/intact state where applicable. A matching row increases its quantity and `itemData.system.quantity`; otherwise a new stable row is appended. The service does not automatically merge neighboring tokens merely because they are close.

Adding content to ordinary closed or configured chest tokens is outside this flow. Canvas merging targets only tokens explicitly marked as ground piles.

## Dynamic Ground-Pile Presentation

After every create, merge, partial take, full take, GM edit, or delete, the active GM derives the token name and texture from the remaining visible rows.

- One position with quantity one: exact item name and original item icon.
- One position with quantity greater than one: `Имя предмета (N)` and original item icon.
- Multiple positions with one normalized lootgen `typeLabel`: a localized `Куча <категории>` name with no count and that category's pile texture.
- Multiple positions from different categories: `Куча предметов` with the generic mixed-pile texture.
- Returning from multiple positions to one position automatically restores the remaining item's name and icon.

The category source of truth is the same `typeLabel` already produced and filtered by lootgen. A small presentation catalog maps normalized labels to Russian pile names and bundled asset paths. Unknown or custom labels safely use `Куча предметов` and the generic mixed texture.

## Pile Token Assets

The module includes transparent square PNG tokens with no lettering for the current lootgen categories:

- ammunition;
- explosives;
- armor;
- tools;
- implants;
- upgrades;
- potions;
- attachments;
- firearms;
- weapons;
- equipment;
- treasure;
- materials;
- mixed items.

The images share one readable top-down fantasy-token style, a restrained frame, centered opaque contents, and generous transparent padding. They are stored under `assets/storage/piles/` and referenced only through the presentation catalog. A single-item pile always uses the item's own icon instead of a category asset.

The built-in image-generation workflow creates flat chroma-key sources, removes the key locally, validates the alpha channel and transparent corners, and copies the final PNG files into the project. No runtime image generation is involved.

## Permissions and Errors

- The active GM is the sole document authority.
- A player may take from a chest or pile only through a controlled owned character within five feet.
- Character-sheet drops require ownership of the target actor.
- Group-inventory drops require the module's existing group inventory permission.
- Invalid or excessive quantities are rejected before destination mutation.
- A vanished source, target, scene, or row produces a notification and no new mutation.
- Failure to resolve a source document disables only the document link; it does not prevent a stored item from being claimed when valid item data exists.
- Deleting an emptied ground-pile token also closes any anchored overlay or storage application for that token.
- Ordinary chests retain the current opened/empty textures, manual texture buttons, and `(пусто)` naming.

## Component Boundaries

- `StorageApp`: responsive grid, item popover, quantity prompts, source drag payloads, and GM row actions.
- `StorageTransferService`: active-GM validation, per-source serialization, idempotent mutation lifecycle, partial source claims, and destination routing.
- `StorageGroundPileService`: prototype restoration, scene token creation, hit-tested merging, stack aggregation, presentation refresh, and empty-token cleanup.
- `StoragePilePresentationCatalog`: normalized lootgen type labels, localized pile names, and PNG paths.
- actor-sheet integration: intercepts only Rebreya storage claim payloads.
- group-inventory integration: accepts the same payload through the existing drop zone.
- canvas integration: accepts the payload and delegates to the ground-pile service.

These components use Rebreya flags and APIs only. They do not query Item Piles APIs, flags, hooks, actors, or DOM.

## Verification

Automated tests cover:

- three-column layout up to six items and automatic near-square growth afterward;
- no pager controls;
- quantity badges and coin cell rendering;
- popover open, close, link fallback, player actions, and GM controls;
- quantity dialog validation and cancellation;
- partial and full source claims for generated and manual rows;
- actor-sheet and group-inventory payload interception;
- canvas pile creation and hit-tested merging;
- same-item stack aggregation and non-matching row append;
- single-item, category, mixed, and back-to-single presentation changes;
- player distance and destination permission enforcement;
- active-GM idempotency and concurrent quantity races;
- automatic deletion of an empty ground pile while ordinary empty chests remain;
- bundled PNG existence, alpha transparency, and presentation-catalog coverage;
- absence of Item Piles calls in the new storage transfer and ground-pile modules.

Live Foundry verification uses player and GM sessions to confirm:

1. A chest opens above its token as an icon grid with six compact cells.
2. Left click opens an anchored item card whose name link and claim buttons work.
3. Partial click claims reduce the badge without duplicating items.
4. Dragging to an owned character sheet and the Rebreya group inventory asks for quantity and removes only that amount.
5. Dragging to the canvas creates a correctly named and textured pile.
6. Dropping the same item on that pile increases its stack.
7. Adding/removing categories changes pile name and PNG.
8. Taking the last content deletes the ground token.
9. BG3 HUD does not cover or replace the token-anchored storage interaction.
