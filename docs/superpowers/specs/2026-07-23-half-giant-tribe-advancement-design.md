# Half-Giant Tribe Advancement Design

## Goal

Move the Half-Giant tribe choice into the dnd5e Advancement wizard used when the race is added. The player or GM must select exactly one of six tribes before the race can be completed. The actor receives one configured `Великанье племя` feature rather than a separate feature for every tribe.

## User Experience

The race Advancement wizard contains a visible step titled `Великанье племя` with exactly these choices:

1. Холмовой великан
2. Каменный великан
3. Ледяной великан
4. Огненный великан
5. Облачный великан
6. Штормовой великан

There is no random option. One selection is required before the wizard can continue. No second dialog opens above or below the Advancement window.

The Advancement configures the single granted `Великанье племя` Item on the actor. It does not grant tribe-specific option Items. The Item name includes the selected tribe and contains only the automation for that tribe.

## Architecture

Register a module-owned `GiantTribe` Advancement type during dnd5e initialization, following the existing custom Craftsman Advancement registration pattern. The type is valid only for race Items and uses a small dedicated flow backed by dnd5e's public Advancement base APIs.

The Half-Giant race definition includes one level-zero `GiantTribe` Advancement after its automatic racial feature grant. Its configuration stores the six allowed tribe identifiers. Its value stores the one resolved identifier.

The flow renders a required single-select control. Applying the step finds the already granted `Великанье племя` feature in the Advancement manager's cloned actor and replaces its managed name, effects, activities, and tribe flag with the selected configuration. The completed Advancement transaction therefore writes the race and the already configured feature to the real actor atomically.

The existing post-creation dialog is removed from the normal creation path. Sheet repair remains responsible for migrating legacy or incomplete owned features without silently selecting a tribe.

## Tribe Results

- Hill: advantage mode for Survival checks.
- Stone: descriptive only; no passive automation.
- Frost: cold resistance.
- Fire: smith's tools proficiency.
- Cloud: +2 to Deception and Persuasion checks.
- Storm: the manual targeted touch activity that rolls `1d4` lightning damage.

The generic `Выбрать племя` activity is removed. A tribe is changed through the race Item's standard Advancement choice modification workflow, which reconfigures the same owned feature.

## Reversal and Migration

Reversing or deleting the race removes the granted racial feature through the existing ItemGrant linkage. The custom Advancement clears its stored choice and does not create or delete independent tribe Items.

Existing characters keep their saved `flags.rebreya-main.raceAutomation.giantTribe` value. Repair normalizes their selected effects and activities. An unconfigured legacy feature remains visibly unresolved until its race Advancement is edited; repair must not guess a default tribe.

## Error Handling

- Reject values outside the six configured tribe identifiers.
- Do not allow the Advancement step to complete without a selection.
- If the granted feature cannot be found in the cloned actor, raise an Advancement error and keep the wizard on the tribe step.
- Preserve unrelated user-authored activities or effects when reconfiguring an existing owned feature.
- Do not depend on window z-index, `createItem` hook timing, or the active owner client to obtain the initial choice.

## Testing

Automated tests must cover:

- Half-Giant race data contains one `GiantTribe` Advancement with six choices.
- Other races do not receive this Advancement.
- Empty and unknown selections are rejected.
- Each selection configures the same feature Item with the expected name, flag, effects, and activities.
- Switching a saved choice removes the previous managed automation without duplicating activities.
- Reversal clears the Advancement value without creating tribe Items.
- Legacy configured features remain repairable, while unconfigured features receive no guessed tribe.
- The custom Advancement type is registered during module initialization.

Live verification uses the supplied Foundry actor and confirms that the tribe step appears inside the race wizard, only one choice can be selected, completion produces one configured feature, and all temporary test data is removed afterwards.
