# Party Inventory Logistics Header Design

## Status

Approved by the user on 2026-08-02.

## Goal

Replace the party inventory header's low-value action and energy controls with
a compact logistics summary. The right side of the shared header must show, in
order, carrying capacity, the current route, and the three consumable resources
food, water, and transport fuel. The existing left identity block and right
logistics block remain horizontally aligned.

## Selected Layout

The shared header keeps its current two-column composition. Only the contents
of the right controls column change:

1. A full-width cargo row retains the current used/capacity value, meter, and
   tooltip.
2. A full-width route row shows the current route's origin and destination on
   the left and remaining travel days on the right.
3. A three-column resource row shows equal-width Food, Water, and Fuel cards.

The warehouse-sheet button, separate Food and Water action buttons, and the
Energy card are removed from the shared header. Energy remains available in
party-member data and the Party tab; this change does not alter energy rules or
persistence.

The scrollable inventory page receives `data-tab="{{activeTab}}"` so CSS and
future diagnostics can identify the currently rendered book tab without
reconstructing it from modifier classes.

## Cargo Presentation

The cargo row continues to show current party inventory weight against total
party capacity and keeps its current tooltip details. When free capacity is
negative, only the displayed cargo value becomes red. The panel background and
border do not change color, preserving the shared surface and horizontal visual
rhythm.

## Route Presentation

When a travel plan is active, the route row shows:

- `originName → destinationName` on the left;
- the existing prepared `remainingTravelDays` value, formatted as days, on the
  right.

When no route is active, it shows `Маршрут не выбран` and a neutral em dash.
The route row is a read-only summary. Route selection and travel advancement
remain on the Travel tab, and the detailed Travel progress bar remains there.

## Resource Interaction and Empty States

Food and Water retain their current quantities and estimated-day labels. The
standalone header buttons and their click handlers are removed. An authorized
user changes either quantity by opening the existing supply prompt from the
card's context menu:

- right-click Food to edit food pounds;
- right-click Water to edit water gallons.

The visible cards remain read-only for users without inventory-management
permission. Editable cards receive a title explaining the right-click action,
and the context-menu handler prevents the browser menu only when it is going to
open the supply prompt.

The primary quantity text for Food or Water becomes red when its quantity is
zero. Positive quantities keep the normal primary text color. Existing
days-left severity metadata may continue to style secondary state, but must not
recolor the shared panel surface.

## Fuel Range

Fuel range is derived from the active concrete transport's authoritative fuel
configuration and the selected fuel Item in the active group inventory:

- `fuelItemId` selects the embedded group Item;
- `fuelPerMile` is the configured quantity consumed per traveled mile;
- available fuel is the selected Item's current `system.quantity`;
- available range is `floor(availableQuantity / fuelPerMile)` miles.

Rounding down prevents the header from claiming that the party can complete a
whole mile it cannot fully fuel. The Fuel card shows the whole-mile range as
its primary value and the selected Item name as its secondary label.

Fuel display states are:

- configured fuel with positive range: `<range> миль`, normal value color;
- configured fuel with zero range, an empty stack, or a missing selected Item:
  `0 миль`, red value color;
- no active concrete transport: `—`, with `Транспорт не выбран`;
- active transport without a selected fuel Item or positive per-mile rate:
  `—`, with `Топливо не настроено`.

The range is informational and does not change the existing soft fuel
consumption behavior: travel remains allowed when fuel is missing or
insufficient.

## Data Flow

`InventoryService.getTransportSnapshot` already resolves the active group,
active concrete transport, and party inventory. It will expose a normalized
fuel-range view derived from those same documents. `InventoryApp` will pass the
travel and transport snapshots into the shared header context without creating
or mutating Foundry documents during render.

No new setting, flag, socket command, or persistent field is introduced. Fuel
configuration remains under
`flags.rebreya-main.transport.instanceState`, and the group Item remains the
single source of available fuel quantity.

## Styling

- The right logistics column keeps its current width and grid alignment.
- Cargo and route are full-width rows.
- Food, Water, and Fuel use three equal columns.
- All rows retain `rm-inventory-book__panel` surfaces.
- Red status applies to the requested value text only: overloaded cargo, zero
  food, zero water, and configured zero-mile fuel range.
- Long city and fuel names truncate or wrap within their own grid track and do
  not change the two-block header width.

## Test Strategy

- Template contract test for `data-tab="{{activeTab}}"`.
- Template contract tests proving the warehouse, Food, Water, and Energy header
  controls are gone and the Cargo, Route, Food, Water, and Fuel rows exist in
  the selected order.
- Context test for active-route city labels and remaining travel days, plus the
  no-route fallback.
- Context/service tests for positive fuel range, floor rounding, empty/missing
  fuel, unconfigured fuel, and no active transport.
- Interaction test proving right-click Food and Water use the existing supply
  prompts and unauthorized cards do not bind mutations.
- CSS contract tests for the full-width rows, equal resource columns, and
  value-only red states.
- Focused inventory, travel, transport, and fuel tests followed by the complete
  Node test suite and `git diff --check`.

## Non-goals

- Changing energy rules or removing per-member energy from the Party tab.
- Adding route selection or travel controls to the shared header.
- Changing fuel consumption, shortage warnings, or travel authorization.
- Adding a replacement warehouse action elsewhere in the header.
- Changing the overall inventory window dimensions or the existing two-block
  identity/logistics composition.
