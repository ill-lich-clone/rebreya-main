# Personalised item instances on the map and after pickup

Status: spec and plan approved by the user on 2026-10-18; implemented in release 1.4.395 and verified by offline regression tests. Live Foundry validation was unavailable.
Scope is the existing narrative-item flow.

## User-visible result

Dragging any canonical personalisable gear Item onto the map selects one
narrative variant for each physical copy. Inspection shows that instance's
chosen title and description. Pickup by a character or a group preserves the
same variant and text. Opening an instance with an empty name restores its
previously selected title, without choosing another variant.

## Confirmed causes and owners

- Map drops enter StorageCommandService.dropItemToScene and persist plain
  itemData in a ground-pile row. No Item Document is created there, so the
  preCreateItem/preCreateActor narrative integration does not run.
- StorageApp.#openRowSource opens the source UUID or openTradeEntry instead of
  the row's saved itemData, hiding any personalised instance description.
- applyLootgenNarrativeVariant currently leaves Item.name unchanged, and the
  creation patch has no name or sheet-open restoration. This was intentional
  in the old September specification; the current user request changes it.

## Intended changes

1. Keep variant selection and instance repair in the canonical narrative
   catalogue. New personalised Items receive the selected title as their
   name when a title exists. Preserve the base name separately as metadata.
   Existing selected identity and saved text remain authoritative; do not
   reselect a variant when flags already identify it, even after a catalogue
   change. A missing saved title may use that exact variant ID as a fallback.
2. Add one pure storage-row adapter around that catalogue. It personalises
   canonical gear rows, sets non-stacking metadata and projects the chosen
   title to row.name. A quantity-N ordinary row becomes N quantity-one rows,
   preserving total quantity and unique row IDs. Already selected copies keep
   their variant. Skip Journal/coin/material/unrelated rows and claimed rows;
   preserve recursive container structure and existing physical state.
3. Inject the same row-preparation dependency from main.js into the existing
   StorageService and StorageGroundPileService. Prepare incoming ground rows
   after duplicate-mutation detection, before storing/presenting them.
   Storage writes/opening repair eligible legacy rows once through the same
   helper and persist that result through the existing repository. Reopening
   an unchanged store performs no write or random draw. Existing auth, queues,
   mutation IDs, rollback and active-GM routing remain the owners of writes.
4. Storage inspection opens a detached, read-only Item built from saved
   itemData. It must not edit or personalise the source compendium. Missing
   instance data retains the existing source-document fallback.
5. Extend the existing narrative integration with sheet-open name repair for
   both Foundry ApplicationV1/V2. Restore only an empty name from saved
   narrativeTitle (or its exact saved variant ID). Preserve a non-empty custom
   rename. Persist only on an editable real world/embedded Item; read-only or
   temporary previews use a local projection. Never mutate compendium Items.
6. Personalised Items in the group inventory open their actual instance,
   including its selected description, rather than following its source link.

## Preserved contracts

No new socket command, setting or flag-schema migration. Preserve existing
APIs, source IDs/UUIDs, formulas, ranks, costs, budgets/spending, fractional
material quantities, durability, upgrades, container identity, transaction
receipts, recovery, permissions, and non-personalisable Item behaviour.
Keep saved instance text authoritative during pickup/retry; prohibit merging
personalised instances even when they happen to share a selected variant.
No fuzzy recognition by a generic name such as Book.

## Required regression evidence

Before runtime edits, demonstrate failures for: real map-pile creation from a
canonical Book with generic text; inspection of saved instance data without
source lookup; exact variant/title/description preservation on character and
group pickup; empty-name restoration with zero random draws; unchanged custom
name and compendium; quantity-N splitting with no item loss; repeated opening
without regeneration/write; identical selected variants remaining separate;
legacy rows, nested containers and unrelated fractional material behaviour.
Use existing owner tests and small pure tests for the storage-row adapter.

## Release and validation

Advance 1.4.394 to 1.4.395, retain historical entrypoints, and update every
importer of each modified runtime owner to one canonical cache URL. Update
README and the relevant function-passport sections. Run focused tests, one
full Node suite, all tracked JS/MJS syntax checks plus new files, all tracked
JSON parsing, and diff checks. Obtain an independent Gemini diff review,
commit only task files on lich_branch and push without force.

Live acceptance: create/inspect/pick up a disposable personalised item in an
authenticated Foundry v13 world if available; report the exact limit if no
authorised session is reachable. Screenshots alone do not prove saved data.
