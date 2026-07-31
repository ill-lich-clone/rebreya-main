# Transport Speed Repair and Fuel Reminder Design

## Status

Approved by the user on 2026-07-31.

## Goal

Repair transport speed import so native D&D5e group cards and the party
inventory receive the source combat and travel speeds. Let a concrete party
transport select one item from its group's warehouse as fuel and consume that
item when travel advances by one or eight hours, without ever blocking travel.

## Root Cause

`TransportCompendiumService` currently normalizes every catalog row and then
passes that normalized object back through `buildTransportActorData`, which
normalizes it a second time. Structured values such as `combatSpeed`,
`travelSpeed`, and `weight` become the string `[object Object]`. Their numeric
values are consequently written as null or zero to the managed compendium and
then copied into world instances.

The fix must build Actor data exactly once from a raw catalog row. A managed
compendium resync must detect the corrected signature and update templates.
Concrete world instances must repair missing speed fields from their canonical
managed source without replacing their artwork, hit points, reserve, ownership,
or other live state.

## Speed Mapping

- Combat speed remains in native `system.attributes.movement` and in the raw
  Rebreya transport flags.
- Travel speed remains in native `system.attributes.travel.speeds` and in
  `flags.rebreya-main.transport.travelSpeed`.
- Land and mechanical vehicles write their primary combat speed to `walk` so
  the native D&D5e group member card shows it.
- Water and air vehicles retain their category-specific `swim` or `fly` speed;
  the party inventory reads their explicit travel speed rather than deriving it
  from the native group card.
- Existing concrete instances with a missing or zero imported speed are
  repaired from their canonical source. Deliberate non-zero world overrides are
  preserved.

## Fuel Configuration

Fuel configuration belongs to the concrete world transport Actor under
`flags.rebreya-main.transport.instanceState`:

- `fuelItemId`: embedded Item ID from the owning group Actor;
- `fuelItemName`: last known display name for resilient UI feedback;
- `fuelPerMile`: finite non-negative quantity consumed per traveled mile.

The transport Actor already records `groupActorId`, so its sheet can resolve
the owning managed group. The Rebreya panel on the vehicle sheet adds:

- a select containing the group's current warehouse items;
- a numeric field for quantity per mile;
- a save action available to authorized group managers;
- a compact readout of the selected item and calculated hourly consumption.

The source table's per-mile amount is the initial `fuelPerMile` for a newly
created instance when its cadence is `mile`. Selecting the actual warehouse
item remains manual. Mount feed with a daily cadence is not automatically
consumed by this feature.

Deleting the selected warehouse item does not invalidate the transport Actor.
The sheet shows the saved name as missing and allows another item to be chosen.

## Travel Consumption

Fuel consumption is attached to the existing successful travel-advance flow:

1. Resolve the active concrete transport and its fuel configuration.
2. Advance the route and world time using the existing travel behavior.
3. Determine the actual miles added by this action from the before/after travel
   progress, so route-end clamping is respected.
4. Calculate `required = traveledMiles * fuelPerMile`.
5. Resolve `fuelItemId` inside the active group's embedded inventory.
6. Deduct `min(available, required)` using the existing inventory mutation
   boundary and refresh open inventory applications.
7. Notify the user of the amount consumed. If the item is missing or the
   available quantity is insufficient, show a warning with the deficit.

Fuel is a soft gameplay reminder. Missing configuration, a missing item,
insufficient stock, or a failed deduction never cancels or rewinds travel,
world-time advancement, or route progress. An insufficient stack is reduced to
zero and the full requested movement still completes.

Fractional quantities are supported and rounded with the inventory service's
existing precision rules. Rewinding travel does not refund fuel because it is a
manual correction tool, not reverse simulation.

## Authorization and Mutation

- Only users who may manage the owning party can save fuel configuration.
- Player writes use an exact typed socket payload and are revalidated by the
  active GM.
- The server re-resolves the transport through the target group and the fuel
  Item through that group's embedded inventory; clients cannot submit arbitrary
  document updates or quantities.
- Travel consumption uses the group captured for that travel operation so a
  context switch cannot deduct another group's inventory.

## Error Handling

- Invalid speed source data fails compendium synchronization with a clear
  mapping error rather than silently producing zero.
- Invalid fuel rates and foreign Item IDs are rejected when saving.
- Missing or insufficient fuel produces a warning but travel succeeds.
- A failed inventory mutation produces an error notification and leaves travel
  completed; no retry is performed automatically to avoid double consumption.

## Test Strategy

- Reproduce and prevent double normalization in compendium synchronization.
- Assert the `Кипятильник` maps to 100 ft combat speed and 10 mph travel speed.
- Assert a concrete zero-speed instance is repaired from its canonical source
  while non-zero overrides and live state are preserved.
- Validate exact fuel-configuration payloads, permissions, and group Item
  membership.
- Verify the vehicle sheet exposes the group Item selector and per-mile field.
- Verify `+1` and `+8` travel actions deduct distance-based quantities.
- Verify destination clamping consumes only actual newly traveled miles.
- Verify insufficient, missing, and unconfigured fuel never block travel and
  produce the expected warning result.
- Verify rewinding does not refund fuel.
- Run focused transport/travel/inventory tests and the complete test suite.

## Non-goals

- Blocking or shortening travel because fuel is unavailable.
- Automatically choosing a fuel Item by name.
- Refunding fuel when travel is rewound.
- Automating daily mount feed.
- Changing the source spreadsheet at Foundry runtime.
