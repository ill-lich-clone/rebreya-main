# Ground item interaction polish

## Goal

Make ground-item placement follow square-grid adjacency, present ordinary dropped items at an appropriate token size, avoid irrelevant storage warnings during token movement, and expose item names in the storage grid using the module tooltip style.

## Adjacent-square placement

On a square grid, a drop point in the character's occupied cell or any of the eight immediately adjacent cells is within five feet. The whole destination cell is valid; distance is not measured from the character center to the exact cursor pixel. Larger characters use the nearest occupied cell. Gridless and non-square scenes retain Foundry's native path measurement.

The same `measureStoragePointDistance` function remains the authoritative input for dropping rows from storage and ordinary inventory items onto the scene.

## Ground token size

A newly created ground pile containing one distinct ordinary item row and no coins uses a `0.5 × 0.5` token centered on the requested point. A pile with multiple distinct rows, coins, or a portable/native container remains `1 × 1` (or the preset's larger dimensions). Existing tokens are not resized retroactively when their contents change.

## Storage selection feedback

Controlling a storage or ground-pile token must not immediately run access validation or show warnings. Hovering continues to bind the pointer handler. The access check and any distance, ownership, scene, or visibility feedback run only after an explicit left pointer click intended to open the storage actions.

## Storage item tooltips

Each item icon in the compact storage grid receives the existing `rm-tooltip-anchor` class and `data-rm-tooltip` value containing its item name. The shared module tooltip CSS supplies the visual style and supports both hover and keyboard focus. The native `title` attribute is not added.

## Tests

- Every pixel inside an orthogonally or diagonally adjacent square measures five feet on a square grid.
- A point two squares away measures ten feet.
- A single ordinary ground item creates a centered `0.5 × 0.5` token.
- Multi-row, coin, and container piles retain their normal size.
- Merely controlling a storage token shows neither actions nor warnings; a subsequent explicit click performs the access check.
- Storage item icons expose the shared styled tooltip with the complete item name and no native title.

