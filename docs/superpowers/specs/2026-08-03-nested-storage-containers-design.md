# Nested Storage Containers Design

## Goal

Make every Rebreya storage object portable and nestable without Item Piles: chests, bags, and ground piles can be moved into another storage, opened there as independent containers, carried as mechanical dnd5e Items, and restored as tokens on a scene without losing contents or presentation.

## Confirmed behavior

- The item-action popover renders above the storage grid and never changes grid tracks, shell height, or item positions.
- Dragging a storage token onto another storage token for one second shows the existing `Отпустите, чтобы добавить` feedback.
- A successful whole-container deposit removes the source token from the scene only after the target mutation commits.
- The nested container retains its name, image, storage kind, textures, state, contents, coins, and nested descendants.
- Clicking a nested container opens it inside the same compact storage window. A breadcrumb identifies the current container and provides navigation back to its parent.
- Taking a container to a character or the party converts it to a normal dnd5e Item with Rebreya-owned container data. The Item remains an interactive mechanical container.
- Dropping that Item on a scene recreates a Rebreya storage token with the same contents and presentation.
- Dropping the Item into another storage moves the complete container snapshot into that storage.
- Durable chests and bags remain after becoming empty. Ephemeral ground piles are removed when empty.
- Containers never stack and always have quantity `1`.
- A container cannot contain itself, one of its ancestors, or a snapshot that would create a cycle.

## Chosen architecture

Store nested containers as recursive, module-owned snapshots inside storage rows. This avoids hidden Actors or Tokens, dangling UUID references, and scene-dependent permissions. A snapshot is a pure serializable value and therefore survives socket transport, inventory transfer, scene changes, and world reloads.

Each container row has `rowKind: "container"` and a `container` value with:

- stable `containerId`;
- `storageKind`: `chest`, `bag`, or `pile`;
- `name`, `img`, and optional actor/preset identity;
- normalized Rebreya storage state;
- token presentation needed to reconstruct a scene token.

Ordinary item rows keep `rowKind: "item"`. Container rows use a unique stack key derived from `containerId`, cannot be partially transferred, and are never merged.

## Portable dnd5e Items

Inventory containers use a standard dnd5e Item type rather than a custom document subtype. The Item stores the recursive snapshot under `flags.rebreya-main.storageContainer`. This keeps the world loadable even when optional integrations are absent and allows the Item to participate in normal inventory ownership and drag-and-drop.

Rebreya adds an `Открыть контейнер` action to supported Item sheets and intercepts its drag payload. Moving the Item consumes the source Item only after the destination mutation succeeds. Dropping it on a scene reconstructs a token; dropping it into storage creates a nested container row.

## Nested mutation addressing

All reads and writes address a container with a root token or portable Item UUID plus a path of container row IDs. The active-GM command service resolves the path against the latest state, validates every segment, and performs one authoritative root update. Commands include the path in their idempotency and queue keys.

Claiming, depositing, editing, and opening nested contents use the same services as root storage. A stale or invalid path fails without mutating source or destination.

## Token-to-token transfer

The module observes Foundry token drag lifecycle and tracks the storage target under the pointer. After one second over a valid target it highlights the target and shows the feedback above the token. On drop, the active GM:

1. validates ownership, visibility, distance, target type, and cycle rules;
2. reads the complete source snapshot;
3. deposits it into the target as one container row;
4. deletes the source token;
5. rolls the target back if token deletion fails.

Ordinary token movement remains unchanged when the drop does not finish over a valid storage target or the one-second state was not reached.

## Storage window

The item-action popover becomes a single sibling overlay under `.rm-storage-shell`, outside `.rm-storage-grid`. The active icon supplies anchor coordinates after render; the overlay clamps to the window and points back to the selected icon. The grid no longer receives expanded-item padding.

For a container row the popover shows `Открыть`, transfer actions, and GM controls. Opening replaces the displayed snapshot with the child snapshot while keeping one ApplicationV2 window. The header and breadcrumb show the current container. Closing the window does not change navigation state or storage data.

## Startup repair and Item Piles removal

Foundry validates each manifest `esmodules` entry as a real package file. The current query-string entry is invalid and makes the package unavailable, which prevents Rebreya custom Item subtypes from registering and produces `rebreya-main.state` and `rebreya-main.gadget` validation errors.

Version `1.4.118` uses a real versioned entry file in `module.json`. The wrapper imports the canonical composition root with a browser cache key, while the manifest itself contains only an existing filesystem path. No world Item migration is required.

All obsolete Item Piles helpers, documentation, manifest relationships, lifecycle hooks, flags-as-authority behavior, and runtime/test assumptions are removed. Rebreya storage recognition depends only on Rebreya actor, token, and Item flags.

## Limits and validation

- Maximum nesting depth is eight containers.
- The existing socket envelope size limit remains authoritative; oversized snapshots are rejected before mutation.
- Recursive normalization strips document IDs that must not be duplicated while preserving Rebreya container IDs.
- Cycle detection uses every `containerId` in the source and target ancestry.
- Players can move only containers they own and must satisfy the existing five-foot and visibility rules. Active GMs retain administrative access.

## Failure and rollback

- Target storage is written before a movable source is consumed.
- Failure to consume or delete the source restores the exact target root snapshot.
- Failure after source consumption attempts source restoration and reports an aggregate error if either rollback fails.
- Duplicate mutation IDs return the recorded result.
- Live storage windows refresh from the root update hook and preserve the deepest still-valid breadcrumb path.

## Verification

- Regression test proving the manifest entry resolves to a real file and Rebreya document types remain declared.
- Source scan proving no Item Piles runtime or documentation references remain.
- Popover test proving it is outside the grid and grid CSS has no expanded padding.
- Service tests for recursive normalization, depth, cycles, non-stacking, root and nested path mutation.
- Command tests for token-to-token moves, rollback, permissions, idempotency, and source deletion.
- Inventory tests for token-to-Item conversion, opening the Item, Item-to-storage transfer, and Item-to-token restoration.
- UI tests for breadcrumb navigation, nested live refresh, LKM/PKM behavior, and container actions.
- Full automated suite followed by live Foundry verification after a world restart.
