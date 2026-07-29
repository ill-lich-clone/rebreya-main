# Party Inventory Layout Refinement

## Goal

Refine the approved book-style party inventory so the tab rail no longer
consumes application width, the character-sheet artwork remains visible, and
the inventory summary uses the header space more efficiently.

## Window and tabs

- Restore the inventory application width to `1320px`; keep the `920px` height.
- The inventory page occupies the full application content width.
- The seven book tabs are absolutely positioned to the right of the
  application page and do not participate in grid or intrinsic width
  calculation.
- The tab rail remains fixed relative to the application while the page
  scrolls.
- Application and content containers allow the rail and its focus/shadow
  treatment to render outside the page bounds without clipping.

## Header artwork

- Use `assets/ui/rebreya-character-header.webp`.
- Process the artwork exactly like the character-sheet insertion: the image
  itself and the same bottom `mask-image` fade.
- Do not place dark gradients, shades, opacity layers, or other tint overlays
  over the artwork.
- Keep the Modesto group title and the compact action buttons readable through
  their existing text shadow and local button backgrounds only.

## Header controls and summary

The right side of the header is one compact control stack:

1. A row containing `Лист склада`, `Еда`, and `Вода`.
2. A full-width `Груз` card spanning from the left edge of `Лист склада` to the
   right edge of `Вода`.
3. A single row of three equal compact cards: `Еда`, `Вода`, and `Энергия`.

The cargo card preserves the visual progress bar and its current state
classes. Hovering or keyboard-focusing the cargo bar reveals a styled,
non-interactive tooltip containing:

- distinct inventory positions;
- total item quantity;
- party currency label;
- free carrying capacity.

The tooltip is implemented with template markup and scoped CSS, without new
application state or JavaScript listeners.

## Content cleanup

- Remove the old full-width four-card summary from the page body.
- Remove the entire `Подробнее по складу` details disclosure.
- Start the active tab content immediately after the header, with only compact
  page padding, so the `Склад` panel moves upward.
- Preserve all existing inventory actions, permissions, tab state, drag/drop
  behavior, data formatting, and other tab contents.

## Verification

- Extend source contract tests for the external tab rail, character-sheet image
  treatment, compact header summary, cargo tooltip, and removed details block.
- Run the inventory-focused tests and the full `node --test` suite.
- In Foundry using the CODEX profile, verify:
  - page width is not enlarged by the tabs;
  - tabs visibly sit outside the right page edge;
  - artwork matches the character-sheet treatment and has no tint overlay;
  - cargo tooltip appears on hover and keyboard focus;
  - tab switching and independent page scrolling still work;
  - no new console errors are produced.
