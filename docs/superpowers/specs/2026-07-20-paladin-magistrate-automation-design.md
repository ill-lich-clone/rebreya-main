# Paladin Magistrate Automation Design

## Goal

Automate the playable mechanics of `paladin-oath-magistrate` without moving the
subclass out of `data/paladin-rework-v01.json`.

## Confirmed Requirements

- `paladin-oath-magistrate` stays inline inside `data/paladin-rework-v01.json`.
- `PaladinAutomationService` remains the only runtime owner for Paladin class
  automation.
- `scripts/data/classes-compendium.js` remains the owner for generated Paladin
  activities, Active Effects, uses, and compendium flags.
- No `subclassDataPaths` loader is needed for Paladin data.
- Every automated rule is identified by stable IDs and
  `flags.rebreya-main.paladinAutomation`; Russian names are fallback only.
- Cross-owner mutations use the active-GM socket path, matching Lay on Hands.
- Reactions use the shared `ReactionQueueService`; do not open direct reaction
  dialogs from Paladin code.
- Temporary effects have origin, explicit duration, cleanup rule, and module
  flags that make them auditable.

## Current State

The Paladin service already supports:

- prepared-spell selection on first spellcasting and long rest;
- Lay on Hands, including active-GM routing for targets the player cannot edit;
- Divine Smite damage, once-per-turn tracking, spell-slot spending, and variant
  selection;
- passive Aura of Protection through Active Auras.

The Magistrate oath is only partially represented:

- `magistrate-accusation-smite` and `magistrate-detention-smite` appear in the
  Divine Smite variant list;
- selecting those variants currently changes only the chat label and does not
  roll the required save or apply the stated effect;
- `Глас закона`, `Державная юрисдикция`, `Аура гражданского порядка`,
  `Неотвратимый приговор`, and `Верховный магистрат` have no runtime behavior.

## Data Contract

Add optional automation metadata to the existing feature entries in
`data/paladin-rework-v01.json`. The class compendium builder copies this into
generated items and activities under `flags.rebreya-main.paladinAutomation`.

```json
{
  "automation": {
    "kind": "magistrateSmite",
    "variant": "accusation",
    "saveAbility": "cha",
    "duration": "sourceNextTurn"
  }
}
```

Required automation kinds:

| Feature ID | Kind | Runtime Meaning |
| --- | --- | --- |
| `magistrate-accusation-smite` | `magistrateSmite` | Charisma save, failure blocks advantage on d20 tests until the Paladin's next turn. |
| `magistrate-detention-smite` | `magistrateSmite` | Wisdom save, success applies speed -10, failure applies speed -10 and no reactions until the Paladin's next turn. |
| `magistrate-voice-of-law` | `magistrateLaw` | Creates a one-hour aura/law record and a chat card; prohibited-action enforcement is manual in the first implementation. |
| `magistrate-sovereign-jurisdiction` | `magistrateJurisdiction` | Bonus action, one target within 60 ft, one-minute legal status. |
| `magistrate-aura-civic-order` | `magistrateCivicOrder` | Reaction candidate when a protected creature in Aura of Protection takes damage. |
| `magistrate-inevitable-sentence` | `magistrateInevitableSentence` | Passive modifier for targets under legal supervision. |
| `magistrate-high-magistrate` | `magistrateHighMagistrate` | Bonus action self stance for 10 minutes, long-rest use, optional 5th-level slot refresh. |

## Shared Runtime Helpers

### Saving Throws

`PaladinAutomationService` needs one Paladin-owned save helper:

```js
async resolvePaladinSave(target, {
  sourceActor,
  ability,
  dc,
  disadvantage = false,
  flavor = ""
})
```

The DC is resolved from `sourceActor.system.attributes.spelldc` first, then
falls back to `8 + proficiency + Charisma modifier`. If the target cannot be
updated locally, the save request and following effect application route to the
active GM.

### Effect Identity

Every temporary Magistrate effect uses:

```js
flags: {
  "rebreya-main": {
    paladinAutomation: {
      kind: "magistrateEffect",
      effect: "accusationNoAdvantage",
      sourceActorUuid,
      sourceItemUuid,
      targetActorUuid,
      expires: "sourceNextTurn"
    }
  }
}
```

Effect IDs are stable per source actor, target actor, and effect name. Reapplying
the same effect refreshes duration instead of stacking duplicates.

### Duration Cleanup

- `sourceNextTurn`: delete at the start of the source Paladin's next turn.
- `targetNextTurn`: delete at the start of the affected target's next turn.
- `oneMinute`: ten rounds when combat exists, otherwise 60 seconds.
- `tenMinutes`: 100 rounds when combat exists, otherwise 600 seconds.
- `oneHour`: 600 rounds when combat exists, otherwise 3600 seconds.
- Long rest removes high-magistrate use state and any self stance.

## Magistrate Smite Variants

### Accusation Smite

Trigger: the Paladin selects `magistrate-accusation-smite` in the Divine Smite
dialog after a weapon hit.

Flow:

1. Spend the selected spell slot and append normal Divine Smite radiant damage.
2. Roll a Charisma save for the chosen hit target.
3. On failure, apply `accusationNoAdvantage` until the start of the Paladin's
   next turn.
4. On success, apply no additional effect.
5. Create a short chat note with DC, save result, and effect outcome.

The no-advantage effect is enforced in `dnd5e.preRollD20Test`: if the roll actor
has the effect, requested advantage is stripped before the roll is configured.
Disadvantage is preserved.

### Detention Smite

Trigger: the Paladin selects `magistrate-detention-smite` in the Divine Smite
dialog after a weapon hit.

Flow:

1. Spend the selected spell slot and append normal Divine Smite radiant damage.
2. Roll a Wisdom save for the chosen hit target.
3. On success, apply `detentionSlow` until the start of the Paladin's next turn.
4. On failure, apply `detentionSlow` and `detentionNoReaction` until the start of
   the Paladin's next turn.
5. Create a short chat note with DC, save result, and effect outcome.

`detentionSlow` subtracts 10 ft from every finite movement speed using normal
Active Effect changes. `detentionNoReaction` integrates with
`CombatAttackService.canUseReaction`; a suppressed actor returns
`canUse: false` with reason `reactionSuppressed`.

## Sovereign Jurisdiction

Generated activity:

- activation: bonus action;
- range: 60 ft;
- target: one creature other than self;
- uses: no item use pool unless the source text later adds one.

Runtime flow:

1. Resolve exactly one target.
2. Infer relationship from token disposition when possible; otherwise prompt the
   Paladin to choose `ally`, `enemy`, or `neutral`.
3. Remove any previous `magistrateJurisdiction` effect created by this Paladin.
4. Apply a one-minute legal status to the target.

Ally status, `protectedByLaw`:

- grants temporary hit points equal to the Paladin's Charisma modifier;
- marks the target as protected for Civic Order;
- while inside Aura of Protection, grants half cover;
- once per round, allows adding `1d4` to one d20 test. This uses the existing
  `dnd5e.preRollD20Test`/`dnd5e.d20Roll` pattern from Performer, not the
  attack-only boost dialog.

Enemy status, `supervisedByLaw`:

- immediately rolls or applies `1d4` psychic damage when the status is created
  if the target understands the Paladin's language. The first implementation
  prompts the Paladin with `understands language?`;
- while inside Aura of Protection, applies Open Position;
- marks the target for Inevitable Sentence.

Neutral status, `lawOrphan`:

- applies no mechanical effect;
- creates a chat note that the target received no benefit or penalty.

## Civic Order Reaction

Trigger: a creature inside the Paladin's Aura of Protection is about to take
damage.

Eligibility:

- Paladin owns `magistrate-aura-civic-order`;
- target is not the Paladin;
- target is inside Aura of Protection;
- Paladin can use a reaction;
- target is visible and exists on the active scene.

Flow:

1. Register a reaction candidate through `ReactionCapabilityIndex`.
2. Resolve the prompt through `ReactionQueueService`.
3. On accept, consume the Paladin's reaction.
4. Prevent the damage to the original target.
5. Apply the exact prevented damage to the Paladin. This damage cannot be
   reduced or prevented by Rebreya automation.
6. If the target has `protectedByLaw`, apply absorption equal to the Paladin's
   Charisma modifier until the start of the target's next turn.

This feature must never run from a local direct dialog. It follows the same
transport and rollback expectations as Rune Knight reactions.

## Inevitable Sentence

Passive feature.

When the Divine Smite target has `supervisedByLaw` from the same Paladin:

- the Paladin may Divine Smite that target more than once in the same turn;
- Magistrate smite-variant saving throws against that target roll with
  disadvantage;
- the base rule "still once per one attack" remains intact. A single damage
  roll cannot receive the same Divine Smite twice.

The implementation should not globally disable the existing once-per-turn key.
It should bypass the key only for the supervised target and only for that attack.

## High Magistrate

Generated activity:

- activation: bonus action;
- target: self;
- duration: 10 minutes;
- uses: one per long rest;
- optional refresh action: spend one 5th-level spell slot to restore the use.

Runtime stance:

- sets `highMagistrateActive` on the Paladin for 10 minutes;
- expands Sovereign Jurisdiction to all creatures inside Aura of Protection;
- allied protected creatures receive `+5 AC` instead of half cover, capped at
  the Paladin's current AC;
- enemy supervised creatures become `frightened` value 4 while inside Aura of
  Protection;
- the Paladin may trigger Voice of Law as part of the same bonus action. In the
  first implementation this creates the Voice of Law chat/law card only.

The AC cap cannot be expressed as a static Active Effect. It needs runtime
calculation on AC-related sheet refresh or a defensive Active Effect update
whenever the Paladin or ally AC changes.

## Voice of Law

The source text creates broad table-law prohibitions. Full enforcement touches
attacks, advantage, lying, spell levels, forced movement, reactions, and flight.

First implementation:

- create a one-hour self/aura record;
- present a compact prompt for the prohibited action;
- post a chat card and store structured state on the Paladin effect;
- automatically enforce only these prohibitions if chosen:
  - no advantage: reuse the `accusationNoAdvantage` d20 hook for affected actors;
  - no reactions: reuse `reactionSuppressed`;
  - no flight: remove or suppress fly speed through an Active Effect.

The other prohibitions are recorded as manual until each has a focused runtime
hook and tests.

## Testing Requirements

Focused tests live in `tests/paladin-automation-service.test.mjs` and
`tests/classes-compendium.test.mjs`.

Required test groups:

- class data keeps Magistrate inline and generated items expose
  `paladinAutomation` metadata;
- Accusation Smite rolls a Charisma save and strips advantage only on failure;
- Detention Smite rolls a Wisdom save, slows on success, and suppresses
  reactions only on failure;
- reaction suppression changes `CombatAttackService.canUseReaction`;
- Sovereign Jurisdiction replaces the previous target status from the same
  Paladin and grants ally/enemy/neutral outcomes;
- protected-by-law `1d4` can be spent once per round on d20 tests;
- Civic Order uses `ReactionQueueService`, redirects exact damage, and rolls
  back if reaction payment fails;
- Inevitable Sentence bypasses the Divine Smite turn key only for supervised
  targets;
- High Magistrate consumes one use, can be restored with a 5th-level slot, and
  applies its aura modifications only while active;
- Voice of Law stores the chosen law and enforces only explicitly implemented
  prohibitions.

Full verification after implementation:

```powershell
node --test tests\paladin-automation-service.test.mjs tests\classes-compendium.test.mjs tests\combat-attack-service.test.mjs tests\reaction-queue-service.test.mjs
node --test tests\*.test.mjs
git diff --check
```

## Out Of Scope For The First Automation Pass

- Moving Paladin subclasses into separate files.
- Building a general rules engine for every Voice of Law prohibition.
- Rewriting Active Auras ownership.
- Changing the Paladin source text.
- Changing economy, travel, inventory, or lootgen behavior.
