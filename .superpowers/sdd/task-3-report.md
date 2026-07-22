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

## Reviewer-fix amendment

Reviewer feedback identified that a positional hook actor and `options.sourceActor` could disagree when no source UUID was supplied. The resolver previously selected the direct source in that case rather than failing open.

- Added a focused native-fallback test with distinct positional and direct source actors, both otherwise eligible for fire bypass.
- RED command: `node --test tests/elemental-adept-automation-service.test.mjs`
  - Result: 28 passing, 1 failing. The new conflicting-source test received `true` instead of the expected `false`, proving the attribution gap.
- Fixed `#resolveDamageSourceActor` to return `null` unless every available positional/direct actor candidate agrees when no source UUID is present. The existing UUID path already required equivalence with every resolved candidate.
- GREEN command: `node --test tests/elemental-adept-automation-service.test.mjs`
  - Result: 29 passing, 0 failing, 0 cancelled.
- `git diff --check` passed after the amendment.

## Second reviewer-fix amendment

The previous guard compared the positional actor with only the first direct-source expression. It could therefore ignore a conflicting `options.midi.sourceActor` when `options.sourceActor` was also supplied.

- Added focused tests proving that native damage fails open when `options.sourceActor` and `options.midi.sourceActor` conflict, and that Midi damage also fails open when the UUID resolves to one of those conflicting sources.
- Added a direct-only positive test to retain valid explicit-source behavior.
- RED command: `node --test tests/elemental-adept-automation-service.test.mjs`
  - Result: 30 passing, 2 failing. Both new conflict tests returned `true` rather than the expected `false`.
- Reworked the resolver to gather the positional actor, `options.sourceActor`, `options.midi.sourceActor`, and the resolved source UUID document. It returns a source only when every present actor has the same identity.
- GREEN command: `node --test tests/elemental-adept-automation-service.test.mjs`
  - Result: 32 passing, 0 failing, 0 cancelled.
- `git diff --check` passed after the amendment.
