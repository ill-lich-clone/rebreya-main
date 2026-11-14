# Remove automatic weapon movement tracking

The user directed us to remove the October weapon movement tracker that adds an Actor write on every NEXT, with grouped turns retained.

- Remove automatic tracking of feet for weapon attachments. Ordinary and grouped turn changes, and token movement, never write `weaponModMovement`. Any old values are ignored without a world migration.
- Preserve the attachment catalog, authored thresholds, bonuses, and action ownership. Use the existing unknown-condition prompt when a player explicitly aims and the distance is unknown. A valid aim still stores the confirmed distance for the shot. Keep the existing decision payload and accept valid outstanding decisions.
- Keep cancellation of aim on movement, turn change and combat end, including temporary movement overrides. Preserve the inventory lock and active GM checks. Use targeted cleanup of managed aim effects.
- Preserve reaction refresh and the order of grouped phases, effect steps and receipts. Keep Foundry movement history, mounted charge movement, and token light hooks.

Keeping a shadow distance counter would leave another movement tracking path and reintroduce state recovery concerns. Removing the entire aim mechanic would also remove bonuses and authored rules. Removing the automatic tracker and reusing the existing prompt addresses the requested write without either change.

Observable verification: one Rebreya Actor update for a clean ordinary turn (reaction), no movement counter write in grouped phases or during a move, and an explicit aim decision still enforces the existing distance rule.
