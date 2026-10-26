# Firearm damage duplication

## Observable result

Changing proficiency in a firearm's item sheet, or changing its firearm properties, must not add an extra copy of its base damage. Submitting an unchanged set of firearm properties in a different order must not reset the magazine, current misfire, or jam. Existing intentional additional damage parts, including parts with a formula equal to base damage, must remain intact. The three identified unintended duplicates in the current Rebreya world are removed without changing other item fields.

## Evidence and ownership

`CombatAttackService` persists firearm activities during property synchronization and activity repair. Its shared `sourceData` helper currently requests `toObject(false)`, which serializes prepared D&D 5e data. The system inserts base damage into prepared attack activities when `includeBase` is true, so persisting that prepared array adds a second base damage part. Foundry's default `toObject()` returns the underlying source instead. The user observed the symptom when setting proficiency on the weapon sheet; the sheet also contains the weapon-property controls, so the actual submitted update must be verified rather than assumed.

The current catalog templates for musket and flintlock pistol contain base damage and no extra attack damage. Stored actor items with one duplicate were identified as Harlif's musket and flintlock pistol and Roland's rifle. Two other weapons contain deliberately differentiated base/full-damage actions and must not be altered merely because formulas coincide.

## Approach and contracts

Use the existing owner and serialize activity source data in both firearm paths; retain all authored fields and formulas, existing hooks, properties, ammunition state, settings, and public APIs. Preserve the fallback for plain objects and documents without a working serializer. No automatic blanket deduplication is safe because an intentional additional part can match the base formula.

Foundry compares property arrays in order. The item-sheet form can submit the same Set in a different order when proficiency changes, causing the existing property synchronizer to reset firearm state. Before Foundry computes its diff, the combat hook asks the attack service to omit only an unchanged, valid firearm property set from that update. A genuinely changed set, non-array input, duplicate values, or unavailable source retains the existing path; actual removal or restoration of Misfire and Reload retains its established semantics.

Repair the three observed world items through the active GM's Foundry document APIs, using their actor, item, and attack activity IDs and rechecking the exact base and one duplicate before changing only that activity's additional parts. Skip and report any changed or ambiguous item. Do not change the two intentionally differentiated weapons. If the bridge is unavailable, a temporary active-GM ready hook may execute these exact guarded updates after the GM reloads. Remove the hook after verification and retain an inert compatibility stub at its served URL for clients that cached the temporary import. This one-off world correction is not a generic migration or a new module API. The D&D system may prune an empty `flags.dnd5e.riders` marker when updating an activity; its absence is equivalent to no riders.

Increase the client-facing module version and forwarder; update the function passport for the changed serialization contract. Confirm the actual proficiency scenario in a live Foundry world if a GM connection is available, and otherwise report the limitation.

## Verification

Regression tests first model a real activity with distinct source and prepared representations. Exercise both firearm property synchronization and activity repair, including proficiency together with a submitted properties collection, an authored extra damage part, empty parts, and repeated saves. Tests must prove that the saved source does not gain a prepared base part. Run focused tests and the project's full runtime checks before commit. Verify the targeted world updates by rereading the documents.
