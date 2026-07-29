# Party Inventory Book Layout Design

## Goal

Restyle the existing party inventory application as a Rebreya book-like sheet:

- reuse the character-sheet header artwork;
- make the active group name the visual title;
- move application tabs outside the page as right-side book tabs;
- preserve every existing inventory workflow and permission rule.

This is a presentation-only change. Inventory, group, crafting, calendar, travel, transport, and downtime data contracts remain unchanged.

## Approved Direction

Use a two-layer layout:

1. an outer application stage that owns the fixed right-side tab rail;
2. an inner scrollable book page containing the artwork header, summary, feedback, and active tab content.

The page scrolls as one surface. The artwork header leaves the viewport with the rest of the page, matching the character sheet. The right-side tab rail stays fixed relative to the application window.

## Application Size

Increase the default window from `1320 × 900` to `1440 × 920`.

Reserve `112px` of the new width for the external tab rail. At the default window size, the book page retains at least the current `1320px` useful content width.

The application remains resizable. At narrower widths, the page shrinks while the tab rail retains its `112px` width. Tab labels do not overlap the page content.

## Outer Stage

The template root becomes an outer stage with two siblings:

- the scrollable book page;
- the right-side tab navigation.

Only the book page owns vertical scrolling. The stage itself must not clip the tab shadows or active-tab protrusion.

All new selectors remain scoped below `.rebreya-inventory-app` or `.rm-inventory-book` so the change cannot alter generic Rebreya tabs or other Foundry applications.

## Header Artwork

The top of the book page contains a `300px`-high artwork header using:

`/modules/rebreya-main/assets/ui/rebreya-character-header.webp`

The image uses:

- centered top positioning;
- `background-size: cover`;
- a dark overlay for title and button contrast;
- a lower fade into the normal inventory page background, modeled after the character-sheet mask.

The header is normal page content rather than a sticky or fixed layer.

## Group Title

Remove:

- the `Партийная логистика` eyebrow;
- the separate `Группа: …` information strip.

Display the active group name as the main title in the artwork header. Use the same visual language as `.rm-character-sheet-brand`:

- `var(--dnd5e-font-modesto)`;
- `36px` high-contrast text at the default window size;
- dark multi-layer text shadow;
- no interactive behavior.

The title source is `group.name`. If no group context exists, fall back to `actor.name` so the error/fallback state still has a meaningful heading.

Group-context warnings remain visible below the header.

## Header Actions

Place the existing actions in the upper-right portion of the artwork header:

- open inventory actor sheet;
- edit food supply;
- edit water supply.

Each action receives its own compact visual container. Actions must not be wrapped in one shared toolbar background.

Buttons retain their existing `data-action` values and permission rules. The food and water actions remain hidden when `canManage` is false.

The compact controls use icon plus short label, with a minimum interactive target of `36px`.

## Right-Side Book Tabs

Move the existing seven navigation buttons out of the page and into a vertical rail on its right:

1. Инвентарь
2. Группа
3. Крафт
4. Календарь
5. Путешествие
6. Транспорт
7. Простой

The labels remain horizontal. Tabs look like physical index tabs protruding from the book:

- rounded outer-right corners;
- squared or visually joined inner-left edge;
- restrained dark surfaces and Rebreya gold borders;
- subtle depth through border and shadow;
- active tab wider or shifted toward the page and visually connected to it;
- clear hover and keyboard-focus states.

The implementation reuses the Forien Quest Log structural principle—navigation outside the scrollable body—but not its global selectors or horizontal tab CSS.

The existing `data-action="switch-tab"` and `data-tab` contract remains unchanged. No Foundry Tabs controller migration is included.

## Content Below The Header

After the header fade, preserve the current order:

1. group-context warning, when present;
2. primary logistics summary;
3. expandable detailed summary;
4. action feedback;
5. active tab panel.

The old inline horizontal tab bar is removed from this flow.

Existing summary, item, party, crafting, calendar, travel, transport, and downtime markup should change only where required by the new outer structure.

## Rendering And State

`InventoryApp` keeps its current state model:

- `activeTab`;
- search and sort state;
- expanded party members;
- scroll restoration;
- focus restoration;
- render listener cleanup.

`setActiveTab` continues to set `activeTab` and force a render. Existing scroll preservation behavior remains unchanged.

No service method, socket command, permission check, or Foundry document mutation is changed by this work.

## Error State

The `hasError` state remains renderable even when the complete book context is unavailable. It renders a single framed error page without the artwork header or tab rail.

## Automated Tests

Add focused contract tests before production changes. They must prove:

- the default application dimensions reserve space for the external tabs;
- the template contains a distinct book page and right-side navigation sibling;
- the main title uses `group.name` with `actor.name` fallback;
- `Партийная логистика` and the redundant `Группа:` strip are absent;
- all seven existing tab actions and identifiers remain present;
- header actions keep their existing action identifiers and permission gating;
- the artwork path is referenced by inventory-specific CSS;
- the tab rail is right-aligned and vertical;
- the page, not the outer stage, owns vertical scrolling;
- active, hover, and focus-visible tab states are styled.

Run the existing inventory context, integration, and stylesheet tests after the focused tests pass.

## Visual QA

Use Foundry VTT with the Codex profile and password supplied by the user.

Target flow:

`Foundry loads → party inventory opens → artwork title and right-side tabs render → switching tabs changes the visible panel without layout breakage`.

Verify:

- the page resembles the character-sheet visual language;
- the header image is not stretched or visibly tiled;
- the group title remains readable over bright and dark parts of the image;
- action controls do not overlap the title;
- all seven tabs fit within the default window;
- the active tab is obvious and visually joined to the page;
- scrolling moves the header and content while leaving the tab rail in place;
- inventory rows, dialogs, context menus, drag-and-drop, and tab switching still work;
- resizing does not clip the right rail or create a horizontal scroll trap;
- no new relevant browser console errors or warnings appear.

Capture a final screenshot outside the repository for review.

## Out Of Scope

- changing inventory data or business rules;
- changing group membership semantics;
- replacing `InventoryApp` tab state with Foundry's Tabs controller;
- altering Forien Quest Log files;
- creating new artwork;
- redesigning the contents of the individual inventory tabs.
