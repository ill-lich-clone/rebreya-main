# Coin sync, icons, and container sound design

## Observable result

- The existing gear spreadsheet sync imports the corrected four coin Items into `world.rebreya-gear`.
- Copper, silver, gold, and platinum coin Items each use a distinct transparent PNG produced for the module.
- Coin Items remain ordinary gear-compendium templates; dragging them changes only `manualCoins` and creates tiny `0.5 x 0.5` ground tokens where applicable.
- Opening a storage container as GM with only that container token selected plays its opening sound exactly once.

## Ownership and constraints

- Reuse the existing gear importer and gear-compendium presentation pipeline. Do not add a coin document service, world folder, or second currency owner.
- Keep `manualCoins` as the only physical-currency state.
- Diagnose the repeated sound from the actual storage-open call graph and fix the existing event owner, without global sound suppression.
- Add focused failing tests before each production change. Update the function passport for changed methods.

## Verification

- Focused gear sync/icon/asset and storage-open sound tests pass.
- Full Node suite, tracked JS/MJS syntax, tracked JSON parsing, and `git diff --check` pass before commit and push.
