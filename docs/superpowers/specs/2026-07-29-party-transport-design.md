# Party Transport Design

**Goal:** add a `Транспорт` tab to the party inventory so transport stored directly on the group actor/token can be selected and used for travel speed, cargo capacity, and durability.

## Decisions

- The group actor inventory is the main transport source. If a transport item is placed into the group token/actor, it appears in the `Транспорт` tab.
- `groupState.transportState.activeTransportId` stores only the selected transport id. Speed, cargo, durability, passengers, and other fields are read from the transport item or compatible actor data.
- The travel tab asks the inventory service for active transport speed. If no transport is active, travel keeps the current walking fallback of `3 мили/час`.
- Player changes go through a typed socket command, with the same group authorization model as other party inventory actions.
- Vehicle actors and members marked as `transport` or `mount` remain supported as compatibility sources, but they are not the primary workflow.

## UI Shape

- Add a top-level inventory tab named `Транспорт`.
- Show summary cards for active transport, speed, cargo capacity, and durability.
- Show one row per detected transport source with a select button.
- Keep empty state explicit: no transport in the group inventory or linked group members.

## Testing

- Inventory context exposes the transport tab and active transport data.
- Transport selection delegates to the module API.
- Group transport state is normalized and stored separately from travel state.
- Travel timing uses active transport speed when selected.
