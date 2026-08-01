# Loot templates and scene storage design

## Goal

Add reusable Lootgen templates and use them to populate Rebreya storage containers placed on scenes. A player opens a nearby container through an explicit action, takes contents either to their character or the party inventory, and sees the container become empty once everything is claimed. The feature must not depend on Item Piles.

## Terminology and boundaries

`Storage` is a Rebreya-defined role, not a new dnd5e `Actor.type`. A storage actor remains a native `npc` actor and is marked by `flags.rebreya-main.storage`. This follows the safe extension model used by Item Piles while keeping all UI and behavior owned by Rebreya.

Each placed storage token is an independent instance. Its template binding, manual contents, generated contents, state, and original display name are stored in its Rebreya token data. Copying the same base storage actor onto two scenes must not share or overwrite their loot.

The first increment covers only scene storage containers and Lootgen. The template service is generic so future module tools can select and apply templates without duplicating serialization or validation.

## Template catalog

The module owns a world-scoped catalog of named Lootgen templates. A template contains a validated snapshot of the current Lootgen generation form, including rank range, item count, budget, magic chance, broken-equipment chance, source toggles, and type filters. It does not contain generated items.

Lootgen adds a `Сохранить шаблон` button at the bottom of its controls. It asks the GM for a non-empty unique template name, snapshots the current form, persists it to the catalog, and reports success or validation errors. The same catalog exposes list, read, create, update, and delete operations for later consumers.

The storage configuration UI lists templates by name. Assigning a template copies its validated generation settings into the individual token configuration. Editing or deleting the catalog entry later never changes an already configured token or its generated loot.

## Storage actor and token state

A GM creates or marks a native `npc` actor as `Хранилище`; Rebreya renders its storage-focused configuration surface rather than a combat sheet. The actor supplies identity and artwork. A scene token is the operational storage instance and contains:

- the immutable base name used to derive the empty display name;
- an optional template snapshot and its display name;
- zero or more manually added item sources and coins;
- generated item sources and coins;
- one of `unopened`, `opened`, or `empty` states.

The GM-only gear action on a storage token opens its configuration surface. It lets the GM select or clear a template, tune the copied settings, add or remove manual items/coins, reset an unopened instance, and inspect the current state. Manual entries are retained and appear alongside template-generated loot at opening.

## Opening and claiming flow

1. A player left-clicks a visible storage token within 5 feet of their controlled character.
2. Rebreya offers the explicit `Открыть` action. Players without an eligible controlled character, outside the range, or unable to see the token do not receive an actionable control.
3. On the first successful open, the active GM validates the request, generates the assigned template exactly once, merges the result with manual entries, and persists the complete item/coin payload. The storage becomes `opened`.
4. Rebreya displays a custom item grid. For each item and for coins, the player can choose the existing Lootgen destinations: their character or the party inventory.
5. Every claim is validated and committed by the active GM, then the grid is refreshed for all viewers. Claims are idempotent so a repeated socket request cannot duplicate an item or currency.
6. When no items or coins remain, the storage becomes `empty` and the token display name is rendered as `<base name> (пусто)`. Resetting or adding content removes the suffix and returns it to the appropriate state.

The UI is owned by Rebreya; it does not invoke or require Item Piles. Item sources retain the same normalized data used by Lootgen so durability, type information, and direct inventory grants remain compatible.

## Permissions and safety

- Only GMs may create templates, configure storage, add manual content, reset a storage instance, or alter a template binding.
- A player may open and claim only a visible storage token in 5-foot interaction range.
- All state-changing player requests travel through the existing socket command bus to the active GM. The server-side handler resolves the scene/token, validates state, distance, visibility, recipient, and a stable mutation ID before writing.
- Storage configuration and generated contents are plain validated data. No arbitrary UUID, actor, or item payload supplied by a player is trusted.

## User interface

- Lootgen: a bottom `Сохранить шаблон` button and a minimal name dialog.
- Storage token, player: left-click opens the contextual `Открыть` action; successful opening shows the storage grid and individual `себе` / `в склад` actions.
- Storage token, GM: the same player flow plus a gear action that opens configuration.
- Empty storage: visually remains selectable but offers an empty-state message rather than generated items; its display name includes `(пусто)`.

## Testing and acceptance criteria

Tests are added before production changes and cover:

- normalization and persistence of a named Lootgen template;
- template assignment snapshots settings per token and isolates two tokens using the same base actor;
- first open creates contents once and merges manual content;
- invalid range, visibility, state, or recipient requests are rejected;
- claim-to-self and claim-to-party use the corresponding Lootgen-style mutations without duplication;
- final claim marks the storage empty and derives the empty name;
- GM-only configuration and the presence of the Lootgen save button.

Relevant existing Lootgen and inventory tests remain green. The full Node test suite is run before publication.
