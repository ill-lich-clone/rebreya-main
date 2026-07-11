# Sorcerer Task 4 Report — Base Metamagic

## Status

Complete. The nine base metamagic options are selectable native feature items and each changes cast, targeting, save, duration, activation, damage, or attack-roll behavior.

## Implementation

- Added the nine `sorcererMetamagic` items with owned `metamagicId`, `cost`, and `stacking` flags.
- Added native `ItemChoice` grants: three selections at level 3, one at level 10, and one at level 17.
- Implemented eligibility, owned-option validation, costs, and the one-base-option stacking rule with one Empowered or Seeking additive option.
- Implemented Careful, Distant, Heightened, Subtle, Extended, Twinned, Empowered, Quickened, and Seeking behavior.
- Added compact non-wrapping, horizontally scrollable choice rows with live point-total previews.
- Added a neutral preflight/resume contract: Sorcerer selects without paying, generic spell reactions inspect the neutral `spellCast.components`, and Sorcerer pays exactly once only after `reactionCheckComplete`.

## Boundary Review

- `SpellAutomationService` has no Sorcerer imports or Sorcerer-specific identifiers; it only consumes the neutral shared cast context and completion marker.
- Counterspell resolution remains owned by the generic service.
- Hook changes only sequence the neutral preflight, generic reaction check, Sorcerer finalization, and Seeking post-attack handler.

## Verification

- RED: metamagic progression and neutral component tests failed before their implementations; all nine option and handshake tests also failed before the handlers were added.
- Targeted: `node --test tests/classes-compendium.test.mjs tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs` — 111 passed.
- Full: `node --test <all tests/*.test.mjs>` — 917 passed.
- Syntax checks passed for changed JavaScript files; Sorcerer JSON parsed successfully; `git diff --check` was clean.

## Commit

`feat: automate sorcerer metamagic` (local only; no push)
