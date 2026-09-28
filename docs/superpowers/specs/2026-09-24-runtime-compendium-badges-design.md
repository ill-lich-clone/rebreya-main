# Runtime compendium badges

## Result

Every current managed document in the 17 Rebreya world compendiums displays its verified base artwork with a small badge in the upper-right corner. All 808 gear documents share one badge. The 3,191 reviewed artworks and the 504 existing ordinary gear icons are the immutable image inputs. Document IDs, UUIDs, mechanics, flags, and user-created documents remain unchanged.

## Ownership and storage

- `tools/icon-pipeline.py` prepares a deterministic manifest and compressed base WebP assets from the accepted review set. The manifest identifies each target by `packId + documentId`; display names never identify output files.
- Bundled marker PNGs are defaults. Editable copies and generated composites live in Foundry's persistent module storage via the v13 `FilePicker.uploadPersistent` API. The source artwork remains separate.
- On startup only the elected active GM checks marker bytes and manifest fingerprints. Unchanged packs require no recomposition or upload. A changed badge rebuilds only its pack; changing the shared gear badge rebuilds all gear icons.
- The existing `#syncManagedCompendia(model)` owns the startup batch. Shared managed sync projects only the expected `img` into document create/update data; it does not change mechanics or identities. Existing icon migrations respect the projected path.

## Build transaction

For each pack, fetch and validate the source images and badge, compose on canvas at source dimensions with the badge occupying 34% of the side and a 1.2% inset, encode WebP, and upload with a fingerprinted filename in persistent module storage. Resume an interrupted upload by listing existing output files. Publish the pack checkpoint only after every target file has uploaded. If a pack fails, retain its last complete checkpoint and use its prior images; if there is none, retain the unbadged icons. Continue other packs.

Generated paths are immutable for a fingerprint, allowing browser caches to update without rewriting existing files. The base icon is not scaled or cropped. The generated image is square and opaque. A changed marker only changes the relevant pack's fingerprint and paths.

## Validation

Before world mutation, validate 3,695 unique pack/document pairs, all 17 pack IDs, source file existence, square art dimensions, and marker PNG geometry. A missing or ambiguous target is a hard error for its pack. Focused tests cover manifest identity, composition geometry, active-GM gate, unchanged startup, per-pack rebuild/checkpoint, resume, failure rollback, and managed sync image projection. Full AGENTS.md checks and live GM sync follow.
