# Transport Actor Compendium and Party Control Design

## Status

Approved by the user on 2026-07-31.

## Goal

Add a dedicated Rebreya transport compendium sourced from the Google Sheet
`Ребрея: Оружие, огнестрел и снаряжение`, tab `Транспорт V0.1`, and turn every
transport row into a D&D5e `vehicle` Actor.

A transport Actor dragged from the compendium onto a managed party Group token
must become a new independent world Actor, join that specific group, and appear
in the party inventory's `Транспорт` tab. The tab must control the live state of
that Actor rather than maintain a detached copy.

## Source Data

- Spreadsheet ID:
  `1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk`
- Sheet: `Транспорт V0.1`
- Sheet ID: `743566278`
- Source range: `A1:T64`
- Data rows: 62
- Categories:
  - `Скакун`
  - `Водный транспорт`
  - `Воздушный транспорт`
  - `Механический транспорт`

The canonical runtime dataset is checked into the module. Runtime Foundry
clients must not depend on Google Drive availability. Updating the spreadsheet
does not silently modify a running world; source changes are imported into the
module dataset deliberately and reviewed in Git.

The twenty source columns are:

1. Название
2. Год изобретения (распространения)
3. Тип транспорта
4. Цена
5. Цена аренды
6. Ранг
7. Вес
8. Хиты
9. КД
10. Скорость (сражение)
11. Разгон (футы)
12. Скорость путешествия
13. Граница поломки (к20)
14. Потребление топлива или корма
15. Экипаж
16. Пассажиры
17. Сила
18. Размер
19. Грузоподъемность
20. Описание

Source notes are part of the interpretation:

- fuel consumption is stated per mile;
- mount feed consumption is stated per day regardless of distance;
- locomotive capacity can contain both its own capacity and the weight it can
  tow on rails.

## Selected Compendium Architecture

Use a managed world Actor compendium named `world.rebreya-transport`, labeled
`Транспорт Ребреи`.

This follows the existing module architecture used by the gear, material,
class, and construct compendia. An active GM creates and synchronizes the pack
from versioned module data. Stable source IDs and signatures make the operation
idempotent, update changed managed entries, and remove obsolete managed entries.

A bundled static `module.json` pack was rejected because the module's existing
data pipeline does not use packaged database artifacts and managed JavaScript
data is easier to review, migrate, and test.

Putting transport into the gear Item compendium was rejected because an Item
cannot provide the independent sheet, hit points, prototype token, and instance
state required by this workflow.

## Stable Document Identity

Each source row receives:

- a stable source ID based on its source row identity;
- a stable 16-character Foundry document ID, for example
  `lchtransport0001`;
- a signature that includes the transport template version and normalized
  source data.

Compendium synchronization only manages Actor documents carrying both:

- `flags.rebreya-main.managed = true`;
- the matching transport source ID.

World instances created from the pack are not managed compendium documents.
They retain source provenance but are never overwritten by later pack
synchronization.

## Vehicle Actor Mapping

Every entry is an Actor with:

- `type: "vehicle"`;
- replaceable Actor portrait and prototype-token artwork;
- a linked prototype token so token bars and the Actor sheet share state;
- a prototype token size derived from the normalized D&D5e size;
- HP on the first token bar.

Category-specific default artwork is used when no dedicated art exists. The
artwork is only a default and remains editable on every imported world Actor.

### Native D&D5e fields

| Source | D&D5e destination |
| --- | --- |
| Название | `name` and prototype-token name |
| Тип транспорта | normalized `system.details.type` |
| Цена | `system.attributes.price` |
| Вес | `system.traits.weight` |
| Хиты | `system.attributes.hp.value/max` |
| КД | flat `system.attributes.ac` |
| Скорость (сражение) | `system.attributes.movement` |
| Скорость путешествия | `system.attributes.travel` |
| Экипаж | `system.crew.max` |
| Пассажиры | `system.passengers.max` |
| Сила | `system.abilities.str.value` |
| Размер | `system.traits.size` |
| Грузоподъемность | `system.attributes.capacity.cargo` |
| Описание | vehicle biography/description field |

Where D&D5e requires structured numeric units, the importer stores the
normalized number and unit. The original text is also retained in module flags
when normalization would lose information.

Examples include dual locomotive capacity (`5/500 тонн`), two-mode combat
speeds (`40/80 футов`), and non-standard price or consumption strings.

### Rebreya transport fields

Values not represented by the D&D5e vehicle data model live in
`flags.rebreya-main.transport`:

- `sourceId`
- `sourceRow`
- `typeLabel`
- `defaultGroupRole`
- `inventionYear`
- `rentalPrice`
- `rank`
- `accelerationFt`
- `breakdownThreshold`
- `consumption`
- `consumptionAmount`
- `consumptionUnit`
- `consumptionPeriod` (`mile` or `day`)
- `combatSpeedRaw`
- `travelSpeedRaw`
- `weightRaw`
- `cargoCapacityRaw`
- `cargoCapacityLb`
- `towedCapacityLb`
- `priceRaw`
- `rentalPriceRaw`
- exact source values needed for display or future migration.

Missing source values remain absent or null. The importer must not invent
tabletop statistics merely because a spreadsheet cell contains a dash.

`Скакун` entries use `defaultGroupRole: "mount"`. All other entries use
`defaultGroupRole: "transport"`.

## Independent World Instances

Every accepted drop creates a new world Actor, even when another Actor from the
same compendium entry already exists.

The instance receives:

- a new Foundry Actor ID;
- a unique instance ID;
- source compendium UUID and source ID;
- the target group Actor ID;
- initial live state.

The source compendium Actor is never added directly to a group because D&D5e
groups only accept world Actors.

Initial instance state is:

- current HP copied from maximum HP when HP is present;
- condition `operational`;
- current fuel/feed `0`;
- tank/feed capacity unset;
- fuel/feed unit inferred from the consumption string when possible.

Users enter the tank or feed-storage capacity manually because the spreadsheet
contains consumption but does not contain tank capacity. Current reserve and
capacity are values of the individual world Actor.

## Drop Onto Party Group Token

The module handles Actor drops on the canvas only when all conditions hold:

- the drop target is a token whose Actor is a managed D&D5e `group`;
- the source is a Rebreya transport Actor from the managed transport pack;
- the current user is allowed to manage that party through the existing group
  authorization model.

The operation is:

1. Resolve the transport compendium Actor.
2. Resolve the party Group token under the drop coordinates.
3. Ask the active GM to execute the mutation when the dropping client is not
   the active GM.
4. Validate source pack, source flags, target group, sender, and permissions on
   the GM.
5. Clone the source into a new world Actor without the managed-compendium flag.
6. Add the world Actor through `groupActor.system.addMember`.
7. Create or update the module member state with the Actor's default
   `mount`/`transport` role.
8. Refresh party inventory applications.
9. Suppress Foundry's normal token creation for that accepted drop.

Dropping the same source again repeats the whole process and creates a separate
Actor.

Drops on empty canvas space, non-group tokens, unmanaged groups, and Actors from
other packs keep normal Foundry behavior.

If world Actor creation succeeds but group membership fails, the module deletes
the newly created orphan Actor as a compensating action and reports the error.

The socket command uses an exact payload schema and accepts only source Actor
UUIDs from the configured transport pack. It must not accept arbitrary Actor
creation data from a player.

## Party Capacity Integration

Transport membership must affect the party inventory's cargo calculations.

The existing transport profile reader is corrected to use actual D&D5e vehicle
paths:

- `system.attributes.capacity.cargo.value`
- `system.crew.max`
- `system.passengers.max`
- the D&D5e travel-speed structure used by the installed system version.

For members with `transport` or `mount` role:

- explicit vehicle cargo capacity is the base capacity when present;
- `memberState.capBonusLb` remains an additive adjustment;
- legacy member-state behavior remains as fallback when no explicit vehicle
  capacity exists.

This ensures that importing a vehicle immediately changes the group's visible
capacity without requiring a second manual capacity entry.

Legacy transport Items stored in the group inventory remain readable and
selectable for backward compatibility, but Actor instances become the primary
workflow.

## Transport Tab State Control

The existing `Транспорт` tab keeps its overview and transport list and adds a
control panel for the selected Actor instance.

The panel shows:

- portrait, name, category, and condition;
- active/inactive status;
- current and maximum HP;
- current fuel/feed reserve;
- manually entered tank/feed capacity;
- reserve unit;
- read-only consumption;
- speed, acceleration, AC, breakdown threshold;
- cargo capacity, current party load, and free capacity;
- crew and passenger capacity;
- a button to open the full Actor sheet.

Editable controls for authorized users are:

- current HP;
- condition: `operational`, `damaged`, or `broken`;
- current fuel/feed reserve;
- tank/feed capacity;
- active transport selection.

Maximum HP and source characteristics remain read-only in the party panel and
can be changed from the full Actor sheet when a GM intentionally overrides the
source statistics.

State writes target the world Actor:

- HP uses native `system.attributes.hp.value`;
- condition and reserve state use
  `flags.rebreya-main.transport.instanceState`.

Fuel/feed validation requires finite non-negative values. When capacity is set,
current reserve cannot exceed it. An unset capacity is distinct from zero.

Player state edits use a typed active-GM socket command. The GM re-resolves the
Actor through the party Group and ignores arbitrary Actor UUIDs outside the
authorized group.

Active transport selection remains in
`groupState.transportState.activeTransportId`.

## Compatibility and Migration

- Existing group transport Items continue to appear.
- Existing vehicle members continue to appear.
- Existing `activeTransportId` values remain valid.
- Actor-only state controls are hidden for legacy Item entries that do not have
  a world Actor.
- No automatic conversion or deletion of existing Items occurs.
- Managed pack synchronization never rewrites imported world Actor instances.

## Error Handling

User-facing errors distinguish:

- unavailable or invalid transport pack;
- invalid source Actor;
- missing party token;
- insufficient party permissions;
- missing active GM;
- failed world Actor creation;
- failed group membership;
- invalid HP or fuel/feed values.

Errors do not silently fall back to creating an unrelated canvas token after
the module has accepted the drop.

## Test Strategy

### Dataset and mapping

- Assert exactly 62 unique transport source records.
- Assert all source IDs and Foundry document IDs are unique and stable.
- Assert representative mount, water, air, mechanical, and locomotive rows map
  to the expected D&D5e and Rebreya fields.
- Assert raw dual capacities and dual speeds are preserved.
- Assert dashes do not become fabricated statistics.

### Compendium synchronization

- Skip non-active-GM and non-D&D5e clients.
- Create an Actor pack with the expected metadata.
- Create, update, keep, and delete managed documents idempotently.
- Reject or recreate an incompatible pack.
- Do not create technical world copies during synchronization.

### Group-token drop

- Accept a valid transport drop on a managed Group token.
- Preserve normal Foundry behavior on empty canvas and unrelated tokens.
- Create a new world Actor on every valid drop.
- Assign `mount` or `transport` member role.
- Add the Actor to native D&D5e group membership.
- Validate and execute player requests through the active GM.
- Reject forged source UUIDs and unauthorized target groups.
- Remove an orphan Actor when membership fails.

### Inventory and state

- Read native vehicle cargo, crew, passengers, HP, AC, and speed correctly.
- Apply Actor cargo capacity to party capacity.
- Display the Actor control panel only for Actor-backed entries.
- Update current HP and instance state with validated values.
- Prevent reserve from exceeding a configured capacity.
- Keep each duplicate Actor's state independent.
- Preserve legacy Item transport behavior.

### Verification

- Run focused transport, compendium, group-context, socket, and inventory UI
  tests.
- Run the full available Node test suite.
- Run `git diff --check`.
- Open Foundry using the Codex profile and visually verify:
  - compendium Actor sheets;
  - drop onto the intended party token;
  - no accidental canvas token on an accepted group drop;
  - independent duplicate instances;
  - HP, condition, tank/feed capacity, and reserve editing;
  - capacity and active travel speed updates.

## Non-goals

- Automatically scraping Google Sheets at Foundry runtime.
- Inventing missing spreadsheet combat statistics.
- Full fuel consumption automation during travel in this iteration.
- Automatic breakdown rolls in this iteration.
- Converting or deleting existing transport Items.
- Supplying bespoke artwork for every one of the 62 vehicles.
