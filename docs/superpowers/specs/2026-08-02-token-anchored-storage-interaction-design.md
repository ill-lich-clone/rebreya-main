# Token-Anchored Storage Interaction Design

## Goal

Make scene storage interaction independent of BG3 HUD and give the player an immediate, spatially clear response: controls appear above the clicked chest, first opening changes the chest before playing a native positional sound, and the compact loot window initially points back to that chest.

The change also lets a GM correct already-generated contents and removes loot-type metagaming from built-in token names.

## Scope

This design covers:

- a DOM action bubble anchored above a storage token;
- local distance feedback on the token;
- one-time server-authoritative generation when either a player or GM opens a chest first;
- a native Foundry positional opening sound with a 10-foot radius;
- one-time token-relative placement of a compact storage window;
- GM deletion and quantity editing for unclaimed manual and generated rows;
- generic scene names for built-in storage tokens.

It does not replace the existing inventory grant pipeline, add coin editing, add a new actor type to dnd5e, or depend on Item Piles, BG3 HUD, Sequencer, or another module.

## Interaction Bubble

`storage-token-hooks.js` will stop creating a bottom-centered menu. A focused controller will own one DOM bubble at a time.

On left-clicking a storage token:

- a GM always sees `Открыть` and a gear button;
- a player receives a local preflight check using the controlled owned character, current scene, visibility, and the same five-foot distance calculation used by the authoritative command;
- a nearby player sees `Открыть`;
- a player farther than five feet sees `Подойдите ближе` above the token for exactly 2,000 ms and no action buttons;
- other preflight failures, such as no owned controlled character, continue to use a normal notification.

The bubble is positioned from the token's canvas center transformed into viewport coordinates. It tracks canvas pan, zoom, token movement, and window resize while visible. It closes on outside click, Escape, scene change, token deletion, or opening an action. Position is clamped to the viewport and flips below the token when there is not enough room above it.

The local preflight is only UX. `StorageCommandService` remains the authority and repeats all ownership, scene, visibility, and distance checks before any generation or grant.

## First Open and Concurrency

First opening works identically whether initiated by a player or GM:

1. The client sends the existing open request with the storage token UUID and controlled character token UUID.
2. The active GM validates access.
3. If the token is still `unopened`, the active GM generates contents exactly once.
4. The active GM persists the generated rows and coins, changes state and display mode to `opened`, and updates the token texture.
5. The single-flight opening task invokes the positional sound callback once.
6. The requesting client receives the shared snapshot and opens the compact window.

The sound callback belongs inside the per-token single-flight operation, not after each socket request. Two simultaneous first-open requests therefore await the same promise, receive the same contents, and produce one texture transition and one sound.

Opening an already-generated or empty token does not generate again and does not replay the opening sound. Resetting a storage token returns it to `unopened`, so its next successful first open generates and plays again.

## Native Positional Sound

The supplied `D:/груз/0cab96e988b889b.mp3` is a 0.268-second mono MP3. It will be copied into the module under `assets/storage/sounds/`.

A small `StorageOpenSoundService` owned by the active GM will create a temporary embedded `AmbientSound` document at the storage token center with:

- `path` pointing to the module asset;
- `radius: 10` scene distance units;
- `repeat: false`;
- `volume: 0.8`;
- volume easing enabled;
- wall constraints enabled;
- a module flag identifying the sound as temporary.

The sound document is deleted 1,250 ms after creation, covering the supplied 268 ms clip plus a safety buffer. Active-GM initialization also removes stale flagged opening sounds left by an interrupted session. Audio preload is best-effort. Failure to preload, create, play, or delete the temporary sound is logged but never rolls back an already-opened chest.

The texture/state update completes before the AmbientSound document is created, preserving the visible order: closed chest, opened chest, sound, loot window.

## Compact Token-Linked Window

The storage ApplicationV2 uses a default width of 430 px and a maximum height of `min(560px, viewport height - 32px)`, with an internal scroll area. Player rows use a dense list rather than the current wide cards. Claim controls remain available for self and party inventory.

On the first render caused by a token action, the app:

- resolves the storage token;
- measures the rendered application;
- opens centered above the token and clamps to the viewport;
- flips below the token if necessary;
- displays a tooltip-style pointer toward the token.

This anchoring is initial impact, not permanent ownership of the window. Once the user begins dragging the window, it detaches, the pointer disappears, and the application behaves like a normal movable Foundry window. Canvas pan or zoom only repositions an application while it remains in its initial anchored state.

Configuration mode uses the same compact shell as player mode and retains template selection, texture buttons, reset, manual item drop, and the generic-name field.

## GM Editing of Existing Contents

When configuration mode is open, every currently unclaimed visible row exposes:

- a number input with minimum quantity one;
- a delete button.

The controls apply to both `manualRows` and `generatedRows`. Claimed rows are not editable because they are no longer storage contents.

New GM-only module APIs resolve a row by stable `rowId` and mutate the correct source collection. Quantity changes update both the row-level quantity and `itemData.system.quantity` so later grants contain the edited amount. Deletion removes the row from its source collection.

After either mutation, storage state is recalculated:

- remaining rows or unclaimed coins keep the token `opened`;
- no remaining rows and no unclaimed coins make the token `empty`, use the empty texture, and add `(пусто)` to its display name.

Invalid quantities, missing rows, non-GM callers, and stale row IDs fail without partial mutation and show the existing storage action error notification.

## Built-In Actor and Token Names

The three actor names remain descriptive in the Actor directory:

- `Сундук — медные монеты`;
- `Сундук — серебряные монеты`;
- `Сундук — золотые монеты`.

Their prototype tokens use the generic name and base name `Сундук`. New scene tokens therefore reveal no loot type.

Active-GM restoration updates existing built-in actor prototypes. It also migrates existing placed tokens that still use a built-in preset name to `Сундук`, including the stored `baseName`, so empty-state naming remains `Сундук (пусто)`. A name explicitly changed by the GM to something other than a built-in preset name is preserved.

## Component Boundaries

- `StorageTokenOverlayController`: DOM bubble, distance feedback, canvas-to-viewport positioning, and cleanup.
- `StorageAccessPreflight`: client-side UX-only access result; authoritative checks remain in `StorageCommandService`.
- `StorageService`: single-flight state transition and an optional once-per-generation opened callback.
- `StorageOpenSoundService`: active-GM AmbientSound lifecycle and stale cleanup.
- `StorageApp`: compact rendering, one-time token anchoring, detach-on-drag, and GM row controls.
- `BuiltinStorageActorService`: generic prototype naming and conservative migration of default scene token names.

These units communicate through explicit methods and do not inspect BG3 HUD or Item Piles DOM.

## Error Handling

- Distance failure during the local click preflight displays `Подойдите ближе` at the storage token.
- A race where the token moves after preflight is rejected by the authoritative GM check and reported normally.
- Missing or deleted tokens close their bubble and prevent window anchoring; the application falls back to Foundry's default centered placement only if contents were already opened successfully.
- Audio failures are non-fatal.
- DOM overlays are removed on scene teardown and module re-registration to prevent duplicates.

## Verification

Automated tests will cover:

- player and GM action sets;
- token-relative bubble positioning, viewport clamping, and distance feedback;
- authoritative distance enforcement remaining intact;
- player-first generation through the active GM;
- simultaneous opens sharing one generation and one sound callback;
- no sound on reopening an already-opened token;
- AmbientSound data, cleanup, and non-fatal failure;
- initial window anchoring, flip, and detach behavior;
- generated and manual row quantity changes and deletion;
- empty-state recalculation after GM edits;
- generic built-in prototype names and conservative existing-token migration;
- compact template and CSS contracts.

Live Foundry verification will use BG3 HUD and confirm that the bubble is above the chest, distant clicks show token-local feedback, player-first opening changes texture before spatial audio, the compact window initially points to the chest, and GM edits persist across close and reopen.
