# Sorcerer and Spell Automation Design

## Goal

Implement the V0.11 Sorcerer casting rules and metamagic as real Foundry
mechanics, while adding a reusable Counterspell workflow for every caster.

## Confirmed Requirements

- The implementation consists of two isolated services:
  `spell-automation-service` and `sorcerer-automation-service`.
- The spell service contains no Sorcerer identifiers, resource rules, or
  metamagic knowledge. The Sorcerer service contains no Counterspell reaction
  queue or generic visibility logic.
- Their only integration surface is a documented spell-cast context stored on
  the activity usage configuration and MIDI workflow flags.
- A Sorcerer does not consume native dnd5e spell slots. Casting a spell of
  level 1 through 9 creates a virtual slot for that cast and spends Sorcery
  Points according to the V0.11 table.
- Counterspell is a new Rebreya-owned copy of the standard third-level spell.
  It is available through the normal Sorcerer known-spell choice at level 5
  when a player selects it; it is never granted automatically.
- Counterspell follows the base rules: a counterspell cast at a level at least
  equal to its target automatically succeeds; otherwise the countering caster
  rolls its spellcasting ability against DC 10 + target spell level.
- A counterspell may itself be counterspelled. Reactions require a visible
  verbal or somatic component and the target cast to be within the reaction
  spell's range.
- Subtle Spell removes verbal and somatic components from the cast context, so
  that cast does not open a Counterspell reaction window.
- The V0.11 cooldown, exhaustion override, and high-level safe-cast limits are
  part of the Sorcerer implementation.
- The complete V0.11 metamagic catalogue is represented by owned option items.
  A variant enters a selectable pool only after its handler changes the active
  spell workflow or creates its stated durable effect; no option is cosmetic.
- When the source does not state a Sorcery Point cost, the cost is zero. This
  applies to `Драконья защита`; it grants the stated resistance through the
  start of the caster's next turn without spending points.

## Service Boundaries

### Spell Automation Service

`scripts/combat/spell-automation-service.js` owns reusable spell workflow
behavior. It creates a `SpellCastContext` at `dnd5e.preUseActivity` for every
spell activity and reads only generic data:

```js
{
  id,                       // unique cast attempt id
  parentId,                 // counterspell target attempt, otherwise null
  actorUuid,
  activityUuid,
  spellUuid,
  spellLevel,
  rangeFeet,
  components: { verbal, somatic, material },
  visible: true,
  targetUuids: [],
  cancelled: false,
  modifiers: {}
}
```

The service discovers eligible Counterspell owners by item, reaction
availability, token distance, line-of-sight/visibility, and V/S components.
It prompts candidates sequentially in deterministic combat order; a declined
reaction moves to the next candidate. A declared Counterspell becomes a child
cast attempt and can receive its own reaction queue. A successful child marks
its parent cancelled. If that child is countered, the parent remains valid.
Only a non-cancelled root attempt is allowed to finish its dnd5e activity.

The service charges a Counterspell before its ability check, exactly as a
normal spell cast. It delegates payment to the cast context's supplied usage
configuration: Sorcerer Counterspells are paid through the Sorcerer service,
while other casters retain native spell-slot consumption. The service does not
import or query a class-specific service.

The Rebreya Counterspell item is a standard dnd5e third-level reaction spell
with V/S components, a 60-foot range, upcast support, and an automation flag
identifying only the generic Counterspell behavior.

### Sorcerer Automation Service

`scripts/combat/sorcerer-automation-service.js` owns the class identifier,
Sorcery Point resource, virtual slot rules, cooldowns, exhaustion, and
metamagic. It receives the same pre-use hook before the spell service and
enriches an otherwise generic cast context for a spell whose advancement root
is the Sorcerer class. This source-root check prevents a multiclass spell on
the same actor from being paid with Sorcery Points.

The service creates an owned `Единицы чародейства` feature at first level. Its
item uses maximum is synchronized from the existing `sorcery-points` scale;
spent uses represent spent points, and its recovery restores all uses on a
long rest. The service also synchronizes the item after class-level changes
and after the class is newly added.

For a level 1 through 9 Sorcerer spell, the casting dialog selects a virtual
slot level allowed by the spell and the Sorcerer's maximum spell level. It
shows and validates these exact costs:

| Virtual slot level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sorcery Points | 2 | 3 | 5 | 6 | 7 | 9 | 10 | 11 | 13 |

After confirmation, the service prevents native slot consumption for this
activity, records the selected virtual level in the cast context, and spends
the points. Cancelling the dialog or failing any validation spends nothing.
A later successful Counterspell does not refund points, matching normal spell
slot rules.

For spell levels 1 through 5, the service records a per-spell cooldown for a
number of rounds equal to the virtual slot level. Casting during that cooldown
requires an explicit override and applies one exhaustion level. For levels 6
through 9, one cast at each virtual level is safe after each long rest; a
second cast requires the same explicit risky override and applies exhaustion.
Long rest clears cooldowns, high-level safe-cast records, and restores the
Sorcery Point resource.

## Metamagic Model

Metamagic choices are separate owned feature items, following the established
Fighter maneuver and Rogue Cunning Strike pattern. Native ItemChoice
advancements grant three choices at level 3 and the additional choices stated
by the V0.11 class progression. Source-specific extended lists are additional
choice pools, not automatic grants.

The Sorcerer cast dialog offers only owned, valid options and permits one
option per cast unless a selected option explicitly allows stacking. Its cost
is added to the virtual-slot cost before points are spent. The service writes
only neutral modifier values into `SpellCastContext.modifiers`; the spell
service uses the component and cancellation fields but does not interpret
class-specific option names.

| Option | Cost | Rule-changing result |
| --- | ---: | --- |
| Careful Spell | 1 | Selected creatures, up to the Charisma modifier (minimum one), automatically succeed on this cast's saving throw. |
| Distant Spell | 1 | Doubles a range of at least 5 feet, or changes Touch to 30 feet for this cast. |
| Heightened Spell | 3 | One selected target has disadvantage on its first saving throw against this cast. |
| Subtle Spell | 1 | Removes verbal and somatic components from the cast context. |
| Extended Spell | 1 | Doubles a qualifying duration once, capped at 24 hours, including created effect durations. |
| Twinned Spell | Spell level; 1 for a cantrip | Valid single-target, non-self spell receives a second selected target in range. |
| Empowered Spell | 1 | Lets the caster reroll up to the Charisma modifier's worth of this cast's damage dice and retain the rerolls. It may stack with one other metamagic choice. |
| Quickened Spell | 2 | Treats a one-action spell as a bonus-action cast for this usage only. |
| Seeking Spell | 2 | On a missed spell attack, offers one reroll and requires the rerolled d20 result. It may stack with one other metamagic choice. |

Advanced, epic, and source-specific V0.11 metamagic entries use the same
option-item contract. Each entry is represented by a dedicated handler in the
Sorcerer service before it is included in a selectable pool; no entry is
exposed as a cosmetic-only choice.

## Casting Dialog Layout

The casting dialog is a single compact decision surface. It never renders a
vertical stack of controls when a choice is represented by several buttons.
The `rebreya-sorcerer-choice-row` CSS class uses a non-wrapping horizontal
flex row with horizontal overflow for a narrow screen:

```css
.rebreya-sorcerer-choice-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.35rem;
  overflow-x: auto;
}
```

- Virtual slot levels and every variable point cost use one horizontal group
  of explicit amount buttons, for example `1`, `2`, and `3`. The selected
  amount is visible and immediately updates the total Sorcery Point cost.
- Metamagic options use horizontally aligned toggle buttons. The dialog
  enforces the normal one-option limit, or the documented two-option limit
  when Empowered Spell or Seeking Spell is one of the selections.
- A rule that permits several selected creatures uses checkboxes in the same
  horizontal row. The service enforces its exact maximum before confirmation.
- Target-dependent rules retain the normal Foundry target picker; the dialog
  presents only the additional amount, option, and eligible-target controls.

## Cross-Service Contract and Hook Order

The combat hook registration invokes `sorcererAutomationService` first at
`dnd5e.preUseActivity`, then invokes `spellAutomationService` with the same
usage configuration. The first service may add or update
`flags.rebreya-main.spellCast`; the second service reads and completes it. The
spell service never reaches into the Sorcerer service, and the Sorcerer
service never registers reaction queues.

Both services fail closed for invalid data: they show a warning and prevent a
Sorcerer cast when points, a valid virtual level, or a required metamagic
target are unavailable. A generic non-Sorcerer spell continues through native
dnd5e behavior if it has no Rebreya automation flag.

## Testing and Verification

Add isolated Node test suites for both services and expand the class
compendium tests. Required coverage includes:

- resource creation, scale synchronization, long-rest recovery, each virtual
  slot cost, native slot preservation, cooldowns, and exhaustion overrides;
- valid and invalid metamagic selection, each base modifier, and the two
  stacking exceptions;
- component visibility, reaction eligibility, automatic and checked
  Counterspell results, resource spending, and a three-cast counterspell
  chain that restores the original spell;
- no Sorcerer import or class identifier in the spell service, and no
  Counterspell reaction queue in the Sorcerer service;
- Rebreya Counterspell's third-level spell data and availability in the
  Sorcerer known-spell selection path.

After automated tests, use the CODEX profile in the live Foundry world only
for read-only inspection and non-destructive manual verification. Creating or
changing world actors, items, or scenes requires separate confirmation.
