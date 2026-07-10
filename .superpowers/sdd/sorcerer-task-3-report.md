# Task 3 — Sorcery Points and virtual-slot casting

Status: complete

Commit SHA: `HEAD` (`feat: automate sorcerer spell points`)

## Files

- `scripts/combat/sorcerer-automation-service.js` — isolated Sorcery Points, virtual-slot, cooldown, exhaustion, and long-rest service.
- `scripts/combat/hooks.js` and `scripts/main.js` — service registration and hooks without coupling it to spell/reaction automation.
- `data/sorcerer-rework-v011.json` and `scripts/data/classes-compendium.js` — native level-one `sorcerer-sorcery-points` resource with scale-based maximum and long-rest recovery.
- `tests/sorcerer-automation-service.test.mjs` and `tests/classes-compendium.test.mjs` — behavior and compendium coverage.

## Tests

- RED observed: the requested Sorcery Points tests failed with `ERR_MODULE_NOT_FOUND` before the service existed.
- `node --test tests/sorcerer-automation-service.test.mjs tests/classes-compendium.test.mjs` — 61 passed.
- `node --test tests/*.test.mjs` — 898 passed.
- `node --check` passed for the four changed JavaScript sources; the Sorcerer JSON parsed successfully; `git diff --check` passed.

## Risks

- Dialog behavior is covered with a `DialogV2` fixture, but it has not been exercised in a live Foundry client.
- Cooldown timing uses `game.combat.round`; outside combat it falls back to round zero, so repeated out-of-combat low-level casts require the explicit exhaustion override until a long rest.
