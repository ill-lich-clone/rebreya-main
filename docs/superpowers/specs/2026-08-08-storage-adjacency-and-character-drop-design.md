# Storage adjacency and character drop

## Goal

Make a storage token openable from every immediately adjacent square, including a diagonal square, and allow a player to drag a storage row directly onto an owned character token.

## Distance behavior

On a square grid, distance between token footprints is measured in grid steps. Orthogonally and diagonally adjacent occupied squares are both one step, so both are within the five-foot access limit. Larger tokens use the nearest pair of occupied squares. Non-square or gridless scenes retain Foundry's native path measurement.

The same distance function remains shared by the player's local preflight and the active GM's authoritative command validation.

## Storage-row drop behavior

When a storage-row payload is dropped on the canvas, the handler first searches the drop point for a visible character token. If one is present, the row is claimed to that character through the existing authoritative `claimStorageRow` command with destination `character`. The existing quantity prompt is preserved.

The server continues to require OWNER permission for a non-GM sender. A drop on an unowned character is rejected without removing the source row. If no character token is under the point, existing behavior remains unchanged and the row is placed on the scene as a ground pile.

## Tests

- A one-cell diagonal gap on a five-foot square grid measures five feet.
- Larger token footprints use their nearest occupied squares.
- Dropping a storage row on an owned character targets that actor.
- Dropping away from characters still targets the scene point.
- Existing authorization and storage regression suites remain green.
