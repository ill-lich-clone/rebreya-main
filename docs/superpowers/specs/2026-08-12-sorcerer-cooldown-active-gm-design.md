# Sorcerer virtual-slot cooldown: active-GM turn processing

## Goal

Make a Sorcerer's virtual-slot cooldown tick exactly once when that Actor's turn starts, regardless of which player advanced combat.

## Root cause

`combatTurn` and `combatRound` run before the Combat document update on the initiating client. When BG3 HUD advances combat from a player who does not own the next Actor, that client cannot persist the Actor flag. Other clients do not repeat the pre-update handler.

## Design

`scripts/combat/hooks.js` will remove the Sorcerer cooldown calls from `combatTurn` and `combatRound`. It will register one `combatTurnChange` callback instead. The callback is delivered after the Combat update to every client; it will call the service only on `isActiveGmClient(globalThis.game)`.

The callback compares the prior and current Combat history records and only routes a strictly forward transition to `SorcererAutomationService.handleCombatTurnChange(combat, current, { direction: 1 })`. Equal states and backward transitions do nothing, including combat rewinds. A round increase is forward even where the current turn resets to zero, so the first initiative participant receives one tick. Removing the two pre-update registrations prevents the round-boundary double tick.

The service remains the sole owner of cooldown arithmetic, Actor flag persistence, sheet-visible flag data, and best-effort chat-card refresh. Actor persistence is awaited before chat-card updates; card failures remain isolated through `Promise.allSettled`.

## Boundaries

- No BG3 HUD changes and no UI-specific hook.
- No new socket command: the existing active-GM primitive is sufficient because `combatTurnChange` reaches the active GM after persistence.
- No direct UI world-state mutation and no second cooldown owner.
- No active GM means no mutation, matching the existing `isActiveGmClient` no-op contract.

## Verification

Focused tests will cover non-owner End Turn, post-update active-GM-only mutation, first initiative at a new round, no double tick, rewind, unrelated Actors, first-level reaction readiness, and isolated chat-card failure. Run the focused suite and the repository-wide Node syntax, JSON, and test checks before commit.
