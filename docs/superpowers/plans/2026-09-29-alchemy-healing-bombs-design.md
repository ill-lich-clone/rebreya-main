# Alchemy Healing and Bombs Design

## Scope

- Add native healing activities only to `alchemy-77` through `alchemy-85`.
- Add one `Бросить бомбу` activity to all 63 products whose exact source type is `Бомба`.
- Preserve every other alchemy product as descriptive-only content.

## Healing behavior

Each healing activity targets exactly one creature selected by the user. It never substitutes the item's owner or controlled token. The activity uses dnd5e's native `heal` model with the catalog formula and consumes one item use; a one-use auto-destroy consumable decrements a stack quantity through dnd5e 5.2.5.

## Bomb behavior

Using `Бросить бомбу` requires one source token for the owning actor. Before placement, the currently open character sheet is minimized if it was not already minimized. The public dnd5e `TokenPlacement.place()` preview displays the product's top-down image and selects the explosion point. Cancellation consumes nothing. The sheet is restored in a `finally` path after success, cancellation, or failure, while a sheet that was already minimized remains minimized.

The active GM creates an unlinked bomb object token and a linked circular MeasuredTemplate at the selected point. The activity carries a fixed save DC and damage data from the approved catalog. MIDI resolves targets, saves, half damage, and the family-specific result. Instantaneous bomb artifacts are removed after the workflow; the sticky-bomb zone persists for one minute.

Family-specific results reuse canonical Rebreya owners: alchemical fire applies decaying fire damage, acid damages equipped armor durability, electrical applies lightning weakness, cryogenic applies the valued restrained status, frightening applies the valued frightened status with the explosion point as source, and stinking applies valued nausea. Sticky bombs create difficult terrain and repeat their save on entry or turn start until expiry.

All placement and cleanup mutations use a validated typed command authorized against ownership of the throwing actor. The catalog remains the source of exact formulas, DCs, radii, values, and durations; runtime code consumes normalized definitions rather than parsing item description text.

## Failure behavior

- Missing target for healing: native activity validation stops use.
- Missing source token, canvas, dnd5e token placement, MIDI, or active GM: show an explicit error and consume nothing.
- Cancelled placement: create no scene documents and consume nothing.
- Failed scene mutation: no workflow continuation and no item consumption.
- Failed family effect: report the error, restore the character sheet, and clean transient scene artifacts.
