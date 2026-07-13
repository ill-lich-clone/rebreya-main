# Sorcerer Casting Modes and Recharge Design

## Goal

Make every spell owned by a Rebreya Sorcerer castable through either Sorcery
Points or its normal dnd5e resource, offer metamagic independently of that
choice, and make cooldowns advance reliably at every owner-turn boundary.

This design supersedes the source-root restriction in
`2026-07-11-sorcerer-spell-automation-design.md`. A spell no longer needs a
`flags.dnd5e.advancementRoot` that points to the Sorcerer class.

## Confirmed Behavior

- Sorcerer automation applies to a spell activity when its actor owns the
  `sorcerer-rework-v011` class item. The spell may have been granted by the
  class, an origin, a feat, an item, a consumable, or another source.
- Every eligible spell presents one combined casting dialog. The casting mode
  and metamagic selection are independent decisions in that dialog.
- A leveled spell offers two casting modes:
  - **Sorcery Points:** spend the virtual-slot cost plus selected metamagic
    cost, suppress the spell's normal slot, charge, and linked-source
    consumption, and apply the Sorcerer cooldown or high-level repeat rule.
  - **Normal:** preserve the complete native dnd5e consumption configuration
    and spend Sorcery Points only for selected metamagic.
- If the actor cannot afford the Sorcery Point casting mode, that mode is
  unavailable. The normal mode remains available.
- If the actor cannot afford selected metamagic, confirmation is unavailable
  until the selection is changed. Casting without metamagic remains possible.
- Cantrips use normal casting because they do not create a virtual slot. They
  still show the same metamagic controls and pay only the metamagic cost.
- Cancelling the combined dialog cancels the cast and consumes nothing.
- A failed or cancelled final dnd5e activity rolls back every Sorcery Point,
  cooldown, high-level-use, exhaustion, and temporary metamagic mutation made
  by that attempt.

## Eligibility and Source Handling

Eligibility is actor-based rather than advancement-based:

1. Resolve the actor from the activity or its item.
2. Verify that the activity belongs to a spell item and the actor owns a class
   item whose identifier is `sorcerer-rework-v011`.
3. Treat level 0 as a normal cantrip cast with optional metamagic.
4. Treat levels 1 through the actor's maximum spell level as eligible for both
   casting modes.

A non-Sorcerer actor and a non-spell activity continue through native dnd5e
without a Sorcerer prompt or resource mutation.

Normal mode must not rewrite `usageConfig.consume`, `usageConfig.cause`, the
selected slot, or activity resource targets. Sorcery Point mode explicitly
sets native spell-slot consumption, direct activity-resource consumption, and
linked-source consumption to false while retaining action-economy handling.

## Combined Casting Dialog

The existing Sorcerer `DialogV2` becomes one stable decision surface with:

- a casting-mode control for leveled spells;
- the legal virtual slot levels and exact V0.11 cost when Sorcery Points mode
  is selected;
- the actor's owned, currently legal metamagic options for every spell,
  including cantrips and normal casts;
- live slot, metamagic, and total Sorcery Point costs;
- the existing exhaustion override only when Sorcery Points mode encounters a
  cooldown or high-level repeat restriction;
- a confirmation control that remains enabled whenever the selected mode and
  metamagic are affordable and valid.

Metamagic validation remains based on the active spell's range, target,
duration, attack, saving throw, damage, and component data. Switching casting
mode does not discard a still-valid metamagic selection.

## Payment and Cooldown Semantics

The resolved cast plan records `castingMode` as either `sorcery` or `normal`.
Its payment is calculated as follows:

| Spell and mode | Sorcery Point payment | Native consumption | Cooldown |
| --- | ---: | --- | --- |
| Cantrip, normal | Metamagic only | Preserved | None |
| Level 1-9, normal | Metamagic only | Preserved | None |
| Level 1-5, sorcery | Virtual slot + metamagic | Suppressed | Spell-level owner turns |
| Level 6-9, sorcery | Virtual slot + metamagic | Suppressed | One safe cast per slot level per long rest |

The payment lock remains actor-scoped so simultaneous casts cannot overspend
the resource. Rollback restores the exact pre-cast state for both casting
modes. A normal cast with metamagic participates in the same lock and rollback
path but does not create or mutate cooldown state.

## Combat Progression

Foundry V13 emits `combatTurn` for movement within a round and `combatRound`
when advancing from the final combatant to the first combatant of the next
round. Sorcerer cooldown processing listens to both initiating-client hooks
and routes them through the same handler.

The handler resolves the actor whose turn is about to begin and decrements
only that actor's owner-turn cooldown records. It ignores backward movement so
rewinding a turn or round cannot make a cooldown expire. When a cooldown
changes, all matching Sorcerer usage cards retain one footer and display the
new remaining value or `Перезарядка: готово`.

## Tooltip and Resize Warnings

The dnd5e 5.2.5 tooltip exception is an upstream asynchronous race: a rich
tooltip finishes resolving after `game.tooltip.element` has been removed, and
the system then reads `.dataset` from `null`. The browser's ResizeObserver
warning is likewise a layout notification rather than a Sorcerer resource
error.

This module will not monkey-patch the dnd5e tooltip implementation. The single
stable casting dialog and the removal of invalid cantrip interception avoid
unnecessary cancellation and DOM churn in the Sorcerer workflow. A remaining
tooltip warning caused solely by hovering a disappearing dnd5e content link is
outside this module's resource and cooldown logic.

## Testing and Verification

The Sorcerer service tests must add failing-first coverage for:

- a spell without `advancementRoot` using Sorcery Points when its actor owns
  the Sorcerer class;
- the same spell using normal consumption without a cooldown;
- insufficient virtual-slot points leaving normal casting available;
- normal casting charging only selected metamagic;
- a cantrip casting normally with and without paid metamagic;
- a spell on a non-Sorcerer actor bypassing the service;
- Sorcery Point mode suppressing slot, activity-resource, and linked-source
  consumption while normal mode preserves them;
- cancellation and final-use failure rolling back each mode's Sorcery Point
  payment;
- a first-in-initiative Sorcerer cooldown decrementing through
  `combatRound`;
- an ordinary within-round owner turn decrementing through `combatTurn`;
- backward turn and round movement leaving cooldowns unchanged;
- cooldown chat cards continuing to contain exactly one updated footer.

Run the focused Sorcerer test suite first, followed by the repository's full
Node test suite and the existing static/module checks. Live Foundry verification
should cover a class-granted spell, an externally granted spell, a cantrip,
both casting modes, a normal cast with metamagic, and a round transition with
the Sorcerer first in initiative.
