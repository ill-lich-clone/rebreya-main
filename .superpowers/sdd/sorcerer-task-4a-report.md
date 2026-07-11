# Sorcerer Task 4A — Real Metamagic Lifecycle Fixes

## Status

Completed on `lich_branch` without pushing. The implementation uses the installed D&D5e 5.2.5 activity, save, attack, damage, and usage-message lifecycle points; generic spell automation remains class-neutral.

## Confirmed P1 resolutions

1. DialogV2 selections are now validated and persisted as the resolved preflight plan, including virtual slot level, metamagic IDs, target/die IDs, cost inputs, and resolved activity changes. Finalization consumes that exact plan.
2. The DialogV2 metamagic picker provides compact target and damage-die inputs in the horizontal `.rebreya-sorcerer-choice-row`. Selected document, target, and die IDs are revalidated before payment; forged values fail before any state changes.
3. Base metamagic now changes actual D&D5e lifecycle data: save-roll configuration (Careful/Heightened), temporary activity/item clones (Distant, Subtle, Extended, Quickened), native token targets (Twinned), evaluated Die results and chat rolls (Empowered), and the real attack reroll method (Seeking). Generic Counterspell sees neutral cast-context components only.
4. Seeking creates its pending record at pre-use, reads only the supported `dnd5e.rollAttack` context (`subject`, `ammoUpdate`), gates on the actual roll's `isFailure`, and rerolls with `activity.rollAttack` while retaining its originating usage-message reference.

## Payment and cancellation safety

- Preflight and generic reaction cancellation do not spend Sorcery Points.
- Finalization pays once, after generic reaction completion. The actor-local payment lock spans payment, resumed activity use, and rollback, preventing a canceled cast from restoring a stale point total over a following cast.
- A failed final Twinned cast restores both the prior native target selection and its Sorcery Point payment.
- Temporary clone updates do not persist on the world spell item. In D&D5e 5.2.5, `preUseActivity` receives a per-use item clone.

## Verification

- RED→GREEN regression coverage was added for resolved DialogV2 selections, target/die controls and forged values, real lifecycle hook objects, persisted remote save overrides, native Subtle properties, Seeking context/origin, clone-safe Distant values, Twinned rollback, and payment rollback ordering.
- Focused suites: `node --test tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs` — 76 passing, 0 failing.
- Full suite: `node --test tests/*.test.mjs` — 935 passing, 0 failing.
- Syntax checks passed for the three changed combat scripts; `git diff --check` passed (Git emitted only CRLF conversion warnings).
- Independent read-only review was requested twice. The final follow-up review found no actionable P1s, including after the payment-lock regression fix.

## Remaining limitation

The payment queue serializes operations for the actor on the casting client. D&D5e 5.2.5 does not expose a conditional document-update/CAS operation through this lifecycle for a cross-client resource transaction; normal actor ownership routes the cast lifecycle through the owner client.
