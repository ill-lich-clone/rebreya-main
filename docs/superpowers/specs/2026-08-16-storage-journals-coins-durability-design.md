# Storage Journals, Coin Piles, and Ground-Item Durability Design

## Goal

Deliver four focused storage improvements without introducing a second inventory or currency owner:

1. hide an item tooltip while its storage popover is open;
2. let a GM place a Journal Entry inside scene storage so authorized nearby players can read it there without gaining Journal ownership;
3. create four world coin templates whose canvas drops produce native Rebreya currency piles, including a persistent empty coin pile;
4. ensure every durability-eligible Item placed on the scene, including ordinary armor such as a cuirass, carries durability into the ground token.

## Scope and ownership

The existing storage subsystem remains the sole owner of scene containers and ground piles:

- orchestration and access: `scripts/data/storage-service.js` and `scripts/data/storage-command-service.js`;
- drag source resolution: `scripts/data/storage-deposit-source.js`;
- ground-pile state and presentation: `scripts/data/storage-ground-pile-service.js` and `scripts/data/storage-pile-presentation.js`;
- UI: `scripts/ui/storage-app.js`, `templates/storage-app.hbs`, and `styles/main.css`;
- composition, API, and typed commands: `scripts/main.js`;
- durability rules and initialization: `scripts/data/durability-service.js` and `scripts/data/durability-rules.js`.

A small built-in coin-template service may be added beside `builtin-storage-actor-service.js`. It owns only the managed world folder and Item templates; it never owns stored currency values.

## 1. Storage tooltip fix

The current tooltip is shown by both hover and `focus-visible`. Clicking an item retains focus while the popover is rendered in the higher storage popover layer, leaving the tooltip visible behind that window.

When the item button has `aria-expanded="true"`, its tooltip pseudo-elements must remain hidden regardless of hover or focus. Closing the popover restores normal tooltip behavior. This is a UI-only change and must not alter popover focus, keyboard access, or layering.

## 2. Journal Entries inside storage

### Stored representation

A Journal Entry is stored as a non-quantified reference row:

```js
{
  rowKind: "journal",
  rowId: "journal-...",
  sourceId: "JournalEntry.<id>",
  sourceType: "journal",
  name: "Название журнала",
  img: "path/to/image.webp",
  quantity: 1
}
```

The reference is accepted only from a resolved `JournalEntry` document. Journal pages are not accepted as independent rows. Only a GM may add or remove journal rows. A player cannot inject an arbitrary UUID into storage.

`storage-container-snapshot.js` must normalize and preserve journal rows through nested containers, portable Item materialization, scene restoration, and rekeying. Journal rows never become embedded dnd5e Items.

### Reading and authorization

The public module API gains a read operation such as:

```js
readStorageJournal(tokenUuid, rowId, request)
```

The player route uses an exact-key typed command such as `storage.journal.read`. Its request includes the storage token UUID, nested path, row ID, and the selected character-token context already used by storage access checks.

The active GM must, on every read:

1. resolve the storage token and run the canonical distance, visibility, scene, and character-ownership checks;
2. resolve the requested nested path and prove that the unclaimed visible row at that path is the requested `journal` row;
3. resolve the Journal Entry UUID from the authoritative row rather than trusting a client-supplied Journal UUID;
4. return a read-only snapshot with secret/GM-only content removed before it crosses the socket boundary.

Reading never changes `JournalEntry.ownership`. Consequently the Journal Entry does not appear in the player's sidebar and cannot be opened through its normal UUID outside the storage flow. The storage UI opens a dedicated read-only viewer. It has no edit, ownership, drag, export, or claim controls.

If the original Journal Entry is edited, the next read reflects the new content. If it is deleted or no longer resolvable, the viewer reports that the journal is unavailable; the broken reference remains removable by a GM.

Journal rows expose `Прочитать` only. `claimStorageRow`, storage-row dragging, quantity editing, transfers to characters or party inventory, and ground-item durability must reject or omit journal rows.

## 3. World coin templates and coin piles

### Managed world Items

On active-GM initialization, a built-in service idempotently ensures a root Item folder named `МОНЕТЫ` and these four managed Item templates:

| Denomination | Item name | Currency key |
|---|---|---|
| Platinum | `Платиновая монета` | `pp` |
| Gold | `Золотая монета` | `gp` |
| Silver | `Серебряная монета` | `sp` |
| Copper | `Медная монета` | `cp` |

Each template has a stable Rebreya flag identifying its denomination. Sync finds Items by that flag, not by mutable name or folder position. It repairs managed mechanical fields and images without deleting duplicates or overwriting unrelated user Items.

The Items are drag templates, not currency storage. Dropping a world template on the canvas asks for a positive safe-integer quantity and does not consume the template. The resulting amount is written to the existing `manualCoins` currency map. No regular Item row is created.

If a flagged coin Item somehow exists as an owned embedded Item, a drop may consume no more than its actual quantity. The active GM re-resolves the source, denomination, quantity, authority, and target point before mutation.

### Presentation rules

Ground-pile presentation is derived from both visible Item rows and unclaimed coins:

1. One non-zero denomination with no Item rows uses that denomination's name and icon.
2. Two or more non-zero denominations with no Item rows use the name `Куча монет` and the new bundled coin-pile image.
3. Treasure-category rows plus any coins remain `Куча сокровищ` and use the existing treasure presentation.
4. Other Item rows plus coins follow the existing Item-category/mixed-pile presentation rather than pretending to be a pure coin pile.
5. A pure coin pile remembers its coin-pile identity after all coins are claimed. It remains on the scene as `Куча монет (пусто)` with the coin-pile image.
6. Adding coins to that empty token reopens it and recomputes the normal presentation.
7. Empty ordinary and treasure piles retain the existing cleanup behavior and are deleted.

Dropping coins onto an existing ground pile uses the current point-containment and mutation-id idempotency rules. The currency maps are added denomination by denomination. A retry with the same mutation ID must not duplicate coins.

### Coin-pile asset

Generate one original, transparent-background raster token for `assets/storage/piles/coins.png`. It should depict an exaggerated fantasy mound of mixed platinum, gold, silver, and copper coins, readable at Foundry token scale and stylistically compatible with the existing photorealistic pile assets. The supplied meme screenshot is mood and scale reference only; no frame, UI, text, or recognizable copied composition may appear in the asset.

The generated source must be inspected, converted to a verified alpha PNG if needed, copied into the repository, and referenced only through the storage presentation catalog.

## 4. Ground-item durability

### Root cause

A ground pile serializes the source Item into `row.itemData`. Native token durability projection reads only `row.itemData.flags.rebreya-main.durability`. Older world Items, compendium Items, and other Items that have not passed through the inventory creation hook may lack that flag even when `isDurabilityEligible()` returns true. The ground token then has no projected HP.

### Required behavior

The canonical durability service must expose a non-mutating operation that returns the existing durability flag or builds the same initial flag used by `initializeItem()`. The storage drop flow calls it on the active GM before consuming the source and writes the returned flag into the cloned ground row.

- Existing damaged, broken, or otherwise initialized durability is preserved exactly.
- An eligible uninitialized Item receives an initial durability flag based on the existing model, material, construction, and size rules.
- Armor such as an ordinary cuirass therefore projects HP, AC, and damage threshold onto its single-item ground token.
- Items excluded by `isDurabilityEligible()` remain excluded. In particular, coin templates and Journal Entry rows never receive durability.
- Compendium and world source documents are not mutated merely because they were copied to the scene.

The source must be prepared before source consumption so a failed durability calculation cannot delete or decrement the Item. Existing storage rollback behavior remains responsible for failures after consumption.

## Data flow

### Journal placement and reading

```text
GM drops JournalEntry into storage configuration
  -> resolve authoritative JournalEntry
  -> store rowKind=journal reference at current container path
  -> player opens storage and selects Прочитать
  -> typed command to active GM
  -> canonical storage access + row/path validation
  -> GM-safe journal snapshot
  -> local read-only viewer
```

### Coin placement

```text
World Item template drag
  -> resolve managed denomination flag
  -> quantity prompt
  -> exact typed canvas-drop command
  -> active-GM source/point/authority validation
  -> idempotent merge into manualCoins
  -> recompute token name, texture, and empty-pile marker
```

### Durable Item placement

```text
Item drag
  -> active-GM source resolution
  -> durability service returns existing-or-derived flag
  -> clone flag into row.itemData
  -> consume movable source when applicable
  -> create or merge ground pile
  -> native durability projection writes token HP/AC/bar
```

## Failure handling and security

- Typed commands use exact-key validation and derive all privileged UUIDs from authoritative storage state.
- Journal reads fail closed when the token, path, row, Journal Entry, selected character, visibility, or distance is invalid.
- Secret Journal content must be removed before serialization to a player; hiding it only with client CSS is forbidden.
- Coin drops are active-GM mutations with stable mutation IDs; retries cannot duplicate currency.
- Managed coin-template sync is idempotent and active-GM-only.
- Journal rows cannot enter Item claim/materialization paths, and coin templates cannot enter ordinary ground-row durability paths.
- Existing source rollback and reconciliation rules remain unchanged.

## Verification

Focused automated coverage must include:

- `tests/storage-app.test.mjs`: expanded item buttons suppress their tooltip; journal rows show read-only actions and no claim/drag controls.
- `tests/storage-container-snapshot.test.mjs`: journal references survive nested/portable snapshot normalization without becoming Items.
- `tests/storage-deposit-source.test.mjs`: only resolved Journal Entries and managed coin templates produce their special source types.
- `tests/storage-socket.test.mjs`: exact journal-read and coin-drop payloads, active-GM authorization, distance/visibility enforcement, journal non-claimability, denomination/quantity validation, and idempotent mutations.
- a focused journal-reader test: secrets are absent from the returned player snapshot, ownership is untouched, and deleted Journals fail safely.
- a focused built-in coin-template service test: folder creation, four templates, stable-flag matching, repair, duplicate safety, and non-GM no-op.
- `tests/storage-ground-pile-service.test.mjs` and `tests/storage-pile-presentation.test.mjs`: single denomination, two denominations, treasure plus coins, empty persistent coin pile, ordinary empty-pile deletion, merging, and retry idempotency.
- durability-focused storage tests: an uninitialized cuirass receives derived durability before scene creation, damaged durability is preserved, and ineligible rows remain without durability.
- asset and manifest checks: the coin-pile image exists, is a valid transparent PNG, and runtime imports continue through `scripts/main.js` plus the versioned forwarder.

Before commit, run the relevant focused tests and the repository-wide verification required by `AGENTS.md`:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

## Documentation and compatibility

- Update the storage and public API sections of `README.md` for journal reading, coin templates, and empty coin piles.
- Update storage and durability sections of `docs/function-passport.md` for every added, changed, or removed method and typed command.
- Preserve Foundry VTT 13, dnd5e, and `statuscounter >= 3.0.4` compatibility.
- `scripts/main.js` remains the only composition root.
- The versioned `scripts/main-<version>.js` entrypoint remains an import-only forwarder.

## Out of scope

- Taking a Journal Entry into a character or party inventory.
- Editing a Journal Entry through the storage viewer.
- Permanently or temporarily changing Journal ownership.
- Displaying the referenced Journal Entry in the player's sidebar.
- Replacing party or character currency with physical coin Items.
- Adding electrum or custom denominations.
- Refactoring unrelated storage, inventory, or durability behavior.
