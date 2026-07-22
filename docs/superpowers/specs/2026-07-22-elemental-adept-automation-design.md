# Elemental Adept Automation Design

**Date:** 2026-07-22

## Goal

Automate the repeatable `Стихийный адепт` feat for dnd5e 5.2.5 and Midi-QOL while preserving the feat as one owned Item per acquisition. Each owned copy is configured in place after it is added to a character, following the existing `Оружие +1` template workflow.

The automation must:

- ask the owning player to choose acid, cold, fire, lightning, or thunder damage;
- hide damage types already selected by another owned copy;
- classify the first copy as a general feat and later copies as minor feats;
- treat active spell-damage die results of 1 or 2 as 3 for selected types;
- ignore resistance and Midi-QOL absorption for matching spell damage;
- work for spells cast from any source, not only a class spell list.

## Source Feat and Owned-Item State

The source compendium contains one repeatable feat with identifier `stihiynyy-adept`. It remains a single source document and does not receive an `ItemChoice` advancement or generate child option Items.

Each configured owned copy stores a module flag with stable machine data:

```js
flags["rebreya-main"].elementalAdept = {
  configured: true,
  damageType: "fire",
  label: "Огонь"
}
```

The configured Item is renamed to `Стихийный адепт: <стихия>`. Its `system.identifier` remains `stihiynyy-adept` so source identity, repeatability, and migration remain stable.

The first owned copy on an actor uses `system.type.subtype = "general"`. A copy created while another Elemental Adept copy already exists uses `system.type.subtype = "minor"`. This classification is applied before opening the damage-type dialog, so cancelling an earlier prompt cannot make two later copies compete for the general slot. Existing copies are not reclassified when an older copy is later removed: classification records acquisition order rather than current count.

## Configuration Workflow

A focused `ElementalAdeptAutomationService` follows the ownership, concurrency, and repair patterns used by `magic-weapon-template.js`:

1. Listen for creation of an actor-owned feat whose identifier is `stihiynyy-adept` and whose Elemental Adept flag is not configured.
2. Only the current owning player handles the prompt; a GM handles it only when there is no active player owner.
3. Serialize configuration per actor and guard the Item with an in-memory pending key so create and sheet-render hooks cannot open duplicate or competing dialogs.
4. Apply the Item's general/minor classification before prompting.
5. Scan other configured Elemental Adept Items on the actor and remove their damage types from the five dialog choices.
6. Immediately before applying the selection, verify that the selected type is still available. If another client acquired it first, warn and reopen with the refreshed list.
7. Update the same Item with its name and selected-damage flag. Use a module update option to prevent recursive handling.
8. Show a confirmation notification.

Closing or cancelling the dialog leaves the Item unnamed by element and without a selected-damage flag, while preserving its already assigned general/minor classification. Actor-sheet render hooks retry unresolved Items, matching the repair behavior of magic equipment templates.

If all five damage types are already configured, the newly added unresolved copy cannot represent a legal acquisition. The service warns the user and deletes only that unresolved copy. It never changes or deletes configured copies.

Deleting a configured copy naturally makes its damage type available to the next prompt because availability is derived from current owned Items rather than a separate actor flag.

## Identifying Spell Damage

The automation must not depend on class, spellbook membership, preparation mode, or payment method. A roll or damage application is considered spell damage when the available dnd5e/Midi context identifies it semantically as a spell, including any of:

- the activity reports itself as a spell activity;
- the activity's Item is of type `spell`;
- the damage description contains the `spell` property supplied by dnd5e/Midi-QOL.

This covers normal class spells, feats, granted spells, scrolls, magic items, and other casting sources when their activity produces spell-tagged damage. Ordinary weapon or feature damage from the same actor must not receive Elemental Adept benefits.

## Minimum Die Result

The `dnd5e.rollDamage` hook receives completed damage rolls and their activity context. For a spell-damage roll whose `roll.options.type` is one of the actor's configured Elemental Adept types:

1. Traverse all nested die terms.
2. Change only active die results equal to 1 or 2 to 3.
3. Leave inactive, discarded, rerolled, and non-die terms unchanged.
4. Re-evaluate the roll total using the roll's native total evaluator.
5. Persist the changed roll data to its chat message when a parent message is available.

Mixed damage is handled per roll. For example, a fire-selected actor rolling fire and radiant parts changes only the fire dice. The handler must be idempotent so duplicate system/module hook delivery cannot increase results beyond 3 or update chat repeatedly without a change.

Elemental Adept runs after post-roll effects that can replace die results. In particular, the shared `dnd5e.rollDamage` orchestration awaits the Sorcerer's Empowered Spell rerolls before applying the minimum result. Chat-message updates for the same roll are serialized so an earlier snapshot cannot overwrite the final rerolled and adjusted results.

## Resistance and Absorption

Elemental Adept must not grant global source-trait bypasses because those would also affect weapon and feature damage.

For Midi-QOL, the service listens to `midi-qol.dnd5ePreCalculateDamage`, where Midi has already provided the source actor and has not yet applied resistance or absorption. When the damage is spell-tagged and its type is selected on the source actor, the service adds that type to:

```js
options.ignore.resistance
options.ignore.absorption
```

Both entries are Sets and are merged with existing ignore state rather than replacing it. Midi-QOL then performs its normal damage calculation while skipping only those two modifiers for matching types.

A `dnd5e.preCalculateDamage` fallback handles native dnd5e damage application when Midi-QOL is unavailable. Native dnd5e has resistance but no absorption trait, so the fallback adds only the matching type to `options.ignore.resistance`. It uses source-actor and spell metadata when present and does nothing when attribution is ambiguous; it must never guess that target damage came from the active user's actor.

Immunity, vulnerability, damage modification/reduction, saving-throw multipliers, and damage threshold are not ignored.

## Integration

The service is exported as a focused module rather than adding feat-specific behavior to the generic `FeatChoiceAutomationService`.

Registration adds:

- `createItem` handling for initial configuration;
- actor-sheet render repair hooks for cancelled or interrupted configuration;
- `dnd5e.rollDamage` for die-result adjustment;
- `midi-qol.dnd5ePreCalculateDamage` for resistance and absorption bypass;
- `dnd5e.preCalculateDamage` as the native fallback.

The source feat's automation metadata changes from manual to full and documents the runtime service. No generated choice-option Items are added.

## Error Handling and Ownership

- An invalid or unavailable selection leaves the Item unresolved and reports a warning.
- Item update failure reports an error and leaves the original Item intact.
- The pending guard is released in `finally`.
- Hook handlers fail open for combat: errors are logged and normal dnd5e/Midi processing continues.
- Automated update/delete options prevent recursive prompts.
- Only the unresolved Item being configured may be deleted when no legal types remain.

## Tests

Unit and data tests cover:

- recognizing only the Elemental Adept source feat;
- current-user/owner prompt routing and GM fallback;
- selecting each supported type and mutating the same Item;
- keeping the stable source identifier;
- first-copy `general` and repeated-copy `minor` classification;
- hiding types already configured on other copies;
- cancellation followed by sheet-render repair;
- two unresolved copies preserving one general and one minor classification;
- concurrent configuration rejecting a damage type acquired by another prompt;
- deletion of a sixth unresolved copy after all five types are owned;
- no child feat Items or `ItemChoice` advancement in generated data;
- active 1 and 2 results becoming 3, with totals and chat rolls updated;
- inactive dice, unrelated types, non-spell damage, and actors without the feat remaining unchanged;
- mixed-type spell damage;
- spell activities originating from non-class sources;
- merging resistance and absorption ignore Sets without changing immunity or vulnerability;
- native dnd5e fallback behavior;
- idempotent hook registration and roll processing;
- ordering after Sorcerer Empowered Spell rerolls and preservation of both changes in chat.

After automated tests, the feature is validated in the live Foundry world on actor `Actor.1Z9T8jbHwoAOTyTy` by adding multiple feat copies, confirming filtered choices and subtype display, casting matching and non-matching spell damage, checking chat totals, and applying damage to targets with resistance and Midi-QOL absorption.
