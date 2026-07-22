# Task 3 — Elemental Adept resistance and absorption bypass

## Status

Complete.

## Implementation

- Added `applyMidiPreCalculateDamage(actor, damages, options)` to merge spell-tagged, configured elemental damage types into `options.ignore.resistance` and `options.ignore.absorption`.
- Added `applyDnd5ePreCalculateDamage(actor, damages, options)` as the native fallback; it changes resistance only.
- Source attribution accepts the hook actor or explicit source actor, resolves `options.midi.sourceActorUuid` (or `options.sourceActorUuid`) through the injected `fromUuid`/`uuidResolver`, and fails open when identities conflict or cannot resolve.
- Added a per-options Midi marker (symbol plus service-local `WeakSet` fallback) so the native handler does not repeat a Midi calculation.
- Ignore-set merging preserves existing `Set` instances and tolerates absent or boolean ignore configuration. Immunity, vulnerability, modification, threshold, and save settings are not mutated.

## Files

- `scripts/combat/elemental-adept-automation-service.js`
- `tests/elemental-adept-automation-service.test.mjs`

## TDD evidence

RED command:

```powershell
node --test tests/elemental-adept-automation-service.test.mjs
```

Result: 23 passing, 5 failing. Each new test failed as expected with `TypeError` because `applyMidiPreCalculateDamage` or `applyDnd5ePreCalculateDamage` did not yet exist; there were no test setup errors.

GREEN command:

```powershell
node --test tests/elemental-adept-automation-service.test.mjs
```

Result: 28 passing, 0 failing, 0 cancelled.

## Verification

```powershell
node --check scripts/combat/elemental-adept-automation-service.js
node --test tests/*.test.mjs
git diff --check
```

Results:

- Syntax check passed.
- Full suite passed once: 1,781 passing, 0 failing, 0 cancelled.
- `git diff --check` passed.

## Self-review

- Matching is per damage description and requires semantic spell evidence, so weapon/feature damage cannot acquire a global bypass.
- Multiple selected matching types are merged independently.
- Existing resistance/absorption Sets are mutated in place; unrelated ignore settings are left intact.
- UUID attribution rejects unresolved or conflicting source actors, and errors fail open.
- The native method cannot alter absorption and exits when the same options have already been seen by the Midi method.

## Concerns

No implementation concerns. Hook registration and live Foundry validation are intentionally outside Task 3 and remain for later tasks.

## Commit

Implementation commit: `12fb694` (`feat(feats): bypass elemental adept damage resistance`).
