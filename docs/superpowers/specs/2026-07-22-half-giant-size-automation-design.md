# Half-Giant and Creature Size Automation Design

**Date:** 2026-07-22

## Goal

Implement the player-character size modifiers defined in the Google Doc `БЕТА Заметки о землях Тейванкаля, 2-я редакция`, repair racial ability advancements across the Teyvankal race compendium, and automate the Half-Giant's `Великанье племя` choice.

The change must:

- apply size Armor Class, Strength-check, Dexterity-check, and base-reach rules dynamically to character actors only;
- add weapon and other reach bonuses on top of the actor's size-based reach;
- preserve temporary size changes and restore the correct modifiers when the size changes again;
- generate a valid ability advancement for every race that defines ability changes;
- configure one owned `Великанье племя` Item in place instead of creating six owned feature variants;
- keep `Нечеловеческая сила` limited to raising the Strength maximum to 22 without raising the current Strength score.

## Authoritative Size Table

The source document defines the following player-facing values:

| Size | AC | Strength checks | Dexterity checks | Base melee reach |
| --- | ---: | ---: | ---: | ---: |
| Tiny (`tiny`) | +2 | -2 | +2 | 0 ft. |
| Small (`sm`) | +1 | -1 | +1 | 5 ft. |
| Medium (`med`) | 0 | 0 | 0 | 5 ft. |
| Large (`lg`) | -1 | +1 | -1 | 10 ft. |
| Huge (`huge`) | -2 | +2 | -2 | 15 ft. |
| Gargantuan (`grg`) | -3 | +3 | -3 | 20 ft. |

Food, water, weight, occupied space, and carrying-capacity multipliers are outside this implementation. Native dnd5e remains responsible for token footprint and its existing size behavior.

## Dynamic Size Modifier Service

A focused size automation service owns one managed actor Active Effect for each non-Medium character whose size has non-zero modifiers. The effect is identified by a stable module flag rather than its localized name.

The effect applies additive changes to:

- `system.attributes.ac.bonus`;
- `system.abilities.str.bonuses.check`;
- `system.abilities.dex.bonuses.check`.

Medium characters do not need a zero-value effect. The service deletes a stale managed effect when a character returns to Medium size. It never edits the actor's source Armor Class or ability scores.

Synchronization runs for existing actors at module readiness and after relevant actor or Active Effect create, update, and delete hooks. It reads the prepared `system.traits.size`, so racial size, manual size changes, and temporary class or spell transformations all use the same table. Module update options and a per-actor queue prevent recursive hooks and duplicate effects. Actor types other than `character` are ignored.

When no authorized owner can update an actor, combat and sheet preparation continue unchanged and the service logs the failed repair. The next authorized ready, sheet-render, or size-change pass retries it.

## Reach Calculation

Reach is calculated at melee-activity use time rather than persisted into weapon Items. This avoids rewriting every weapon when an actor changes size.

The calculation is:

```text
size base reach + weapon reach bonus + independent racial/class reach bonus
```

For module weapons, `flags.rebreya-main.lichWeaponPropertyValues.reachBonus` and the `lchReach` property are additive weapon bonuses. Thus a Large character has 10-foot base reach and an `Алебарда` with `Досягаемость 5` attacks at 15 feet.

For ordinary dnd5e melee weapons without `lchReach`, a declared reach above the normal Medium 5-foot baseline is converted to an additive bonus. A normal 5-foot weapon adds zero; a standard 10-foot reach weapon adds 5. Existing racial and class bonuses such as Bugbear long limbs and Rune Knight reach remain independent additions rather than replacing size or weapon reach.

Ranged activities are unchanged. The computed reach is written only to the transient activity used for the attack; the owned Item's stored range is not mutated.

## Racial Ability Advancement Repair

The current generator loses Russian clauses because its morphology regex uses JavaScript `\w`, and several generic `+2/+1` texts produce only the `+2` step. The repair combines a corrected Unicode parser with explicit structured overrides for irregular races.

The parser must recognize Russian `увеличивается`, `увеличиваются`, `увеличьте`, `уменьшается`, and `уменьшаются` forms. Common distributions are represented with dnd5e `AbilityScoreImprovement` advancements, including:

- a flexible two-point increase;
- `+2/+1` distributions;
- fixed `+2` plus a restricted `+1` choice;
- fixed and unrestricted combinations already present in the race source data.

Explicit expectations cover all 34 current Teyvankal races. A race with ability-change text must not silently generate zero ability advancements. Tests also assert the configured fixed values, point totals, caps, and allowed abilities for each non-generic race.

Irregular races use structured overrides rather than increasingly permissive text heuristics. This includes Minotaurs, Centaurs, Leonids, Half-Giants, Nephilim, Ashen, and Golems. Fixed penalties stay inside the ability advancement. When a race requires the player to choose a negative ability, the owned race Item stores that choice and owns one managed transfer effect that applies the penalty. Removing the race therefore removes the penalty. Cancelled choices remain visibly unresolved and are retried from actor-sheet repair handling rather than guessing a value.

The Half-Giant advancement is:

- Strength +2 fixed;
- Constitution or Wisdom +2 choice;
- Dexterity -2 fixed.

`Нечеловеческая сила` remains a separate transfer effect on `system.abilities.str.max` with upgrade value 22. It does not add to `system.abilities.str.value`. No additional Belt of Giant Strength mutation is introduced in this scope.

Generated compendium changes affect new race acquisitions. Existing base ability scores are never silently rewritten; live validation may remove and re-add the race on the designated test actor to exercise the repaired advancement flow.

## Giant Tribe Owned-Item Configuration

The source compendium continues to contain one `Великанье племя` feature. When that feature is granted to an actor, race automation prompts the authorized owning user to choose one of six tribes and updates the same owned Item.

The configured Item stores a stable value in a module flag and is renamed, for example, to `Великанье племя (Ледяной великан)`. Its source identifier remains stable. A managed `Выбрать племя` utility activity permits recovery after a cancelled dialog and deliberate reconfiguration. A per-Item pending guard prevents duplicate dialogs from create and sheet-render hooks.

Reconfiguration removes the previous managed tribe effects and activities before adding the newly selected configuration. Only one tribe can be active on an Item.

The choices behave as follows:

- **Hill:** a transfer effect upgrades `system.skills.sur.roll.mode` to native dnd5e advantage.
- **Stone:** records and displays the choice, with no mechanical automation.
- **Frost:** a transfer effect adds `cold` to `system.traits.dr.value`.
- **Fire:** a transfer effect upgrades `system.tools.smith.value` to proficiency.
- **Cloud:** transfer effects add 2 to `system.skills.dec.bonuses.check` and `system.skills.per.bonuses.check`.
- **Storm:** supplies a damage activity that rolls `1d4` lightning damage against one selected creature. Contact timing remains a player-controlled decision.

The generic `promptCustomEffect` activity and the dormant set of all tribe effects are removed from this feature. Stone and Storm are not presented as fully automatic in generated automation metadata.

## Ownership, Repair, and Existing Items

Prompt routing follows the established Elemental Adept ownership policy: an active owning player handles their actor; a GM handles the prompt only when no active player owner is available. Automated updates carry module options to prevent recursive handling.

An unconfigured existing `Великанье племя` Item is repaired when its actor sheet renders. Existing configured choices are left intact unless their stored value or managed effect is invalid. Invalid values are cleared and prompted again; the service never chooses a tribe automatically.

## Tests

Automated tests cover:

- the full six-row size table;
- character-only managed effect creation, update, deduplication, and removal;
- size changes caused by actor updates and Active Effect lifecycle changes;
- Large AC -1, Strength +1, and Dexterity -1 application;
- base reach for every size;
- Large plus a 5-foot `lchReach` weapon producing 15 feet;
- ordinary dnd5e 5- and 10-foot melee ranges being converted to zero and +5 bonuses;
- stacking independent Bugbear or Rune Knight reach with size and weapon reach;
- no ranged-attack reach mutation and no owned-Item mutation;
- every race with ability-change text producing an expected advancement;
- Half-Giant Strength +2, Constitution/Wisdom +2 choice, and Dexterity -2;
- irregular fixed values and restricted choices;
- chosen negative penalties being removable with the race Item;
- tribe prompt ownership, cancellation repair, saved flags, in-place rename, and reconfiguration;
- each passive tribe effect and absence of an effect for Stone;
- Storm's single-target `1d4` lightning activity;
- `Нечеловеческая сила` changing only the Strength maximum.

After the automated suite passes, the generated compendia are synchronized and the behavior is validated in the live Foundry world on actor `Actor.1Z9T8jbHwoAOTyTy`: re-add the Half-Giant race, complete its ability advancement, choose and change tribes, inspect the visible size effect, change size temporarily, and attack with normal and reach weapons while confirming activity reach and chat damage.
