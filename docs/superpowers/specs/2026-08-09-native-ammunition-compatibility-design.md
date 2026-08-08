# Native Ammunition Compatibility Design

## Goal

Make native dnd5e ammunition deterministic for ordinary ranged weapons and make the Artificer infusion "Повторный выстрел" operate without ammunition, including for existing actor-owned items.

## Data Model

Every ordinary ranged weapon with the dnd5e `amm` property receives one exact `system.ammunition.type`:

| Weapon family | Ammunition subtype |
| --- | --- |
| Bows | `arrow` |
| Crossbows | `crossbowBolt` |
| Blowguns | `blowgunNeedle` |
| Slings | `slingBullet` |

Firearms continue using the module's magazine and reserve-ammunition mechanics and do not use native dnd5e ammunition selection. Existing Rebreya ammunition rows already cover the required standard subtypes; the synchronizer must preserve those subtypes and must not create duplicate catalog rows.

## Runtime Compatibility

Before an ordinary weapon attack roll, the module validates the selected ammunition item against the weapon's exact subtype and a positive quantity. Missing, empty, zero-quantity, or incompatible selections are removed from the roll configuration and its dialog options.

An active, non-suppressed enchantment named `Повторный выстрел` or `Repeating Shot`, or originating from the known Artificer compendium item, disables native ammunition selection and consumption for that weapon. Removing or suppressing the enchantment restores normal typed ammunition behavior.

## Existing Items

The active GM repairs actor-owned ordinary ranged weapons during module initialization. The repair assigns a canonical ammunition type from the weapon base item or Rebreya gear identity, removes incompatible persisted activity ammunition IDs, and clears incompatible entries from `flags.dnd5e.last`. It also repairs actor-owned ammunition consumables when their Rebreya gear identity identifies a canonical subtype.

The migration is idempotent and updates only fields that are missing or incompatible. It never replaces the complete item system, name, effects, upgrades, or other user customization.

## Failure Handling

One malformed actor item must not abort repairs for other actors. Failures are logged with actor and item identity. Non-GM clients do not perform migration writes.

## Verification

Tests cover catalog generation for each weapon family, existing-item repair, incompatible and zero-quantity selections, valid ammunition preservation, and Repeating Shot bypass/restoration.
