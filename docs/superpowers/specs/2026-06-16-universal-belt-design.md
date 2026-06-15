# Universal Belt [Lich] Design

Date: 2026-06-16
Status: approved for implementation planning

## Goal

Add the Rebreya "Universal Belt [Lich]" rule to the dnd5e character inventory sheet. The belt gives each actor three visible quick-access item slots at the far left of the existing container row. One slot is available by default; the second and third are unlocked by paying 500 gp each.

The feature must support both native dnd5e item types and Rebreya-managed items. It must not rely on a narrow type whitelist.

## User Rule

Each adventurer has a safe belt place for one item. A character can buy up to two additional belt places for 500 gp each. A belt place can hold a potion, alchemist's fire, grenade, dagger, magic consumable, armor, material, or any other physical item the player puts there. If the player puts nonsense there, the GM resolves that at the table.

Using the item from the belt is still manual for movement accounting. This implementation will open the normal item-use flow but will not spend movement automatically.

## Chosen Architecture

Use virtual belt slots backed by Rebreya flags, not real dnd5e container Items.

Actor-level state:

- unlocked belt slot count, clamped to `1..3`.

Item-level state:

- belt slot number, `1..3`, on the embedded actor Item currently assigned to that slot.

The assigned item remains a normal Foundry embedded Item. This preserves dnd5e and Rebreya data, activities, charges, item usage, sheets, and standard item context-menu behavior.

This avoids fake container Items because fake containers would pollute actor inventory, inherit delete behavior, and require defensive code against many native container actions.

## UI

Render three belt slots as the first entries in the native dnd5e container strip on the character inventory tab.

The slots should reuse the native container grid sizing so they respond like containers on different sheet widths. They should have a distinct circular belt style so they read as belt slots, not backpacks.

Slot states:

- unlocked empty: circular slot ready for drop.
- unlocked occupied: item image and name/tooltip.
- locked: lock icon and purchase affordance.

Belt slots are not normal Items and cannot be deleted through native container controls.

## Drag And Drop

Dropping any physical embedded Item with `system.quantity` onto an unlocked belt slot assigns exactly one unit to that slot.

If the source stack quantity is greater than 1:

- create or keep a separate one-quantity embedded Item for the belt slot;
- decrement the source stack by 1.

If the source stack quantity is 1:

- move that existing embedded Item into the slot by setting its belt flag.

If the target belt slot already has an item:

- first remove the old item from the belt;
- merge it back into a compatible normal inventory stack when possible;
- otherwise leave it as a normal inventory Item.

Compatibility for merge should prefer stable Rebreya identity flags (`gearId`, `magicItemId`, `materialId`, `sourceType`) and native identity fields, then fall back only where safe.

## Item Eligibility

Do not block by item type.

An item is eligible when it is an embedded actor Item and has physical quantity data through `system.quantity`. This includes native dnd5e physical items and Rebreya gear, magic items, materials, weapons, equipment, loot, tools, consumables, and similar future physical item documents.

Documents without physical quantity, such as spells, class features, classes, subclasses, and purely service items, are not belt items.

## Interactions

Left click or primary action on an occupied belt slot uses the normal dnd5e item-use flow for that Item, equivalent to using it from inventory. No movement is spent automatically.

Right click opens the standard dnd5e item context menu plus one Rebreya action:

- `Убрать из пояса`

Removing from the belt clears the item belt flag and merges the one-quantity belt item back into a compatible normal stack when possible.

## Purchasing Slots

Slot 1 is always unlocked.

Slots 2 and 3 are bought sequentially for 500 gp each. Actor owners may buy their own slots.

Payment uses only gp and pp:

- 1 pp = 10 gp.
- Prefer spending gp first, then pp as needed.
- Make change back into gp.

Example: 495 gp + 1 pp can buy one slot and leaves 5 gp.

If the actor has less than 500 gp equivalent across gp and pp, the purchase fails with a notification and no state changes.

## Permissions

The implementation should respect Foundry permissions. A player can modify their own actor if they own it. If a permission edge case requires GM authority, use the existing Rebreya socket namespace and a class/character automation message type, not a downtime-specific message type.

## Out Of Scope

This design does not automate movement spending.

This design does not create real dnd5e container Items.

This design does not validate whether an item physically makes sense on a belt beyond requiring item quantity data.

## Test Focus

Manual or automated verification should cover:

- one unlocked and two locked slots on a fresh actor;
- sequential purchase of slot 2 and slot 3;
- gp/pp payment and change making;
- insufficient funds failure;
- drag stack of 5 into a slot leaves 4 normal and 1 belted;
- moving a quantity-1 item into a slot;
- replacing an occupied slot returns the old item to normal inventory;
- removing from belt via context menu;
- using a belted item opens the normal item-use flow;
- Rebreya gear, magic item, material, weapon, armor, and native dnd5e consumable are accepted;
- spells and class features are rejected.
