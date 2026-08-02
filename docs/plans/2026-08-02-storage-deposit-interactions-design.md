# Storage Deposit and Interaction Design

## Goal

Make Rebreya storage tokens work as self-contained Foundry containers: item cards inside the compact storage window must respond reliably to left and right clicks, and items from owned inventories, the party inventory, ground piles, world items, or compendiums must be droppable directly onto a storage token.

## Confirmed interaction model

- Left click on an item icon toggles its styled popover.
- Right click on an item icon opens the same popover and suppresses the browser context menu.
- The popover keeps the fixed item name/link and the available take/edit actions.
- Dragging a supported item over a storage token for one second highlights the token and shows `Отпустите, чтобы добавить` above it.
- Dropping a stack asks how many items to add.
- Items from owned character inventories, the party inventory, and Rebreya ground piles are moved: the accepted quantity is removed from the source only after the storage mutation succeeds.
- World and compendium items are copied and leave the source unchanged.
- A previously empty storage becomes opened again, restores its opened texture/name, and updates every open storage window immediately.

## Chosen approach

Use module-owned canvas drag listeners plus Foundry's native item drag payloads. The listener resolves the storage token under the pointer, waits one second before showing feedback through the existing token overlay controller, and submits the drop through the active-GM socket command service.

This is preferred over patching PIXI/Foundry prototypes because it is isolated to the module and easier to remove or adapt. It also covers BG3 HUD because the drop target and feedback are anchored to the token rather than a HUD button. Keeping deposits only in the open storage window was rejected because it does not support the agreed direct-on-token workflow.

## Data and mutation flow

1. Parse and validate the Foundry drag payload without changing its source.
2. Resolve the item document and classify the source as owned actor, party inventory, Rebreya ground pile, world item, or compendium item.
3. Check that the target is a Rebreya storage token and that the sender owns the movable source when a move is requested.
4. Enforce the existing visibility and five-foot access rules for non-GM users.
5. Prompt for a quantity when the source stack contains more than one item.
6. Send an idempotent deposit command to the active GM.
7. Merge an equivalent unclaimed row in storage or append a new manual row. Equivalence uses the stable source UUID when available and a normalized item-data identity fallback for local ground-pile snapshots.
8. For move sources, decrement or delete the source only as part of the successful authoritative mutation. Compendium/world sources are not modified.
9. If the storage was empty, change it to opened and select the opened texture.
10. Emit the storage update hook so all open windows refresh immediately.

## Failure behavior

- Unsupported payloads never activate the token drop feedback.
- A player who is too far away sees the existing short `Подойдите ближе` token feedback.
- Permission, stale-source, invalid-quantity, or full-race failures leave both source and storage unchanged and show one concise notification.
- Drag leave, drag end, drop, Escape, scene changes, and controller destruction always clear the delayed feedback and token highlight.
- Duplicate socket requests return the recorded result rather than adding the item twice.

## Existing-token investigation

The current storage-empty mutation updates the same token and does not create a replacement. The visually duplicated chest will be checked by scene token UUID and Rebreya flags during the live test. A token will only be removed if it is positively identified as the test chest deliberately left by the previous verification.

## Cache and live-client behavior

The running Foundry client currently has an older canonical module script and a `1.4.110` stylesheet loaded. The implementation will advance the module/cache version used by dynamic storage imports so the fixed handlers and styles load together after a normal reload, without relying on the temporary live-test stylesheet link.

## Verification

- Unit tests for LKM/PKM popover handling and context-menu suppression.
- Unit tests for the one-second token hover state and cleanup.
- Command/service tests for copy, move, partial quantities, row merging, permissions, idempotency, and rollback.
- Regression tests proving emptying a normal chest never creates another token.
- Full available test suite and source checks for Item Piles references.
- Live Foundry verification with character, party, compendium, and ground-pile sources; tooltip interaction; real-time refresh; texture/name restoration; and scene-token UUID inspection.
