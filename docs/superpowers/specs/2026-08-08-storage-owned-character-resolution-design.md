# Storage owned-character resolution

## Goal

Make player storage interactions independent of whichever canvas object is selected, and make a storage row dropped on an owned character enter that character's inventory instead of becoming a map object.

## Character resolution

For a non-GM user, storage access searches visible character tokens on the current scene for actors the user owns. Non-character tokens and map objects are ignored even when controlled.

Candidates must satisfy the existing storage access distance rule. The nearest eligible character to the storage token is selected. If multiple candidates are equally near, an eligible controlled character wins; otherwise selection is deterministic by token id. If no eligible character exists, the existing warning is shown.

The resolved character token UUID is carried through the storage window and every subsequent claim or deposit command. The authoritative GM-side command service continues to validate ownership, scene, visibility, and distance rather than trusting the client choice.

## Drag and drop

The document-level drag controller uses the actual pointer viewport position to detect an owned character token beneath a dragged storage row. A successful drop sends the existing `claimStorageRow` command with destination `character`, the target actor UUID, and the resolved character token UUID.

The operation remains atomic: the source storage row is removed only after the item is successfully created or merged in the character inventory. Dropping away from a character retains the existing map-drop behavior. Dropping on an unowned character is rejected and does not remove the row.

Dragging a scene item such as a wall calendar into storage uses the same nearest-owned-character resolution. Selecting that item cannot replace or hide the player's character for access checks.

## Tests

- A selected non-character object does not prevent storage access when an owned character is nearby.
- The nearest eligible owned character is selected; an eligible controlled character breaks equal-distance ties.
- The resolved character token UUID is preserved by the storage app and sent with claims and deposits.
- A storage row dropped at a character's viewport position enters that owned actor's inventory.
- Drops away from characters still create the existing scene object.
- Unowned and out-of-range characters are rejected without losing the source item.

