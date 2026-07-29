# Party Inventory Header Grid and Panel Design

## Goal

Keep the party token entirely to the left of the party name at every supported
window size, while giving every compact header control and metric one shared
visual surface.

## Root cause

The crest and the 260 px wallet currently share a 124 px CSS Grid container.
The wallet establishes a 260 px intrinsic grid track, so `justify-items: center`
centers the 104 px crest against that wider track. The adjacent heading is still
positioned after the 124 px flex basis, which lets the crest overlap the party
name.

## Selected layout

- Remove the `rm-inventory-book__identity-column` wrapper.
- Make `rm-inventory-book__identity` an explicit two-column grid:
  - column one is 124 px and owns only the 104 px crest;
  - column two owns the party name and active-tab title;
  - the wallet occupies a second row spanning both columns and remains 260 px
    wide.
- Preserve the current 18 px column gap and 4 px row gap.
- Keep the active-tab title position relative to the heading unchanged.
- Preserve all crest and currency actions, permissions, data attributes, and
  accessible labels.

This structure makes the crest position independent of wallet width. The crest
cannot enter the heading column because the grid assigns the two elements to
different tracks.

## Shared panel surface

Add `rm-inventory-book__panel` to:

- the warehouse-sheet, food, and water action buttons;
- the cargo article;
- all three supply articles;
- all four currency controls in editable and read-only states.

The shared class owns:

- one nearly opaque dark background;
- one gold-gray border;
- a 6 px radius;
- one inset highlight and restrained drop shadow;
- primary text color.

Semantic classes continue to own layout, sizing, hover behavior, the cargo
meter, and supply text arrangement. Compact labels use one 10 px uppercase
style, and compact values use one 13 px bold style. Dynamic supply state classes
must not recolor the shared surface.

## Interaction and data

No application data or action handlers change. The existing
`edit-party-crest`, `edit-currency-root`, `edit-currency`, `open-actor-sheet`,
`add-food`, and `add-water` actions remain attached to the same semantic
elements.

## Verification

- A template/CSS contract test fails if the identity grid areas or the shared
  panel class are removed.
- The focused inventory test suite passes.
- Live Foundry inspection verifies that the crest right edge remains left of
  the party-name left edge with a positive gap.
- Live computed styles verify that actions, cargo, supplies, and currencies
  share the same background, border, radius, and shadow.
- The full Node test suite and `git diff --check` pass before publication.
