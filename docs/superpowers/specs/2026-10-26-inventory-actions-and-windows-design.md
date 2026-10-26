# Inventory actions, transfer quantity, and second window

## Observable result

The user can edit item quantity again. A button at the top of the inventory opens a second full inventory window for the same group. Both windows expose the complete inventory and normal controls, retain independent local filters/search/scroll, and refresh after mutations. Folder windows continue to show their subtree. After approving the design, the user identified the sale socket mismatch as a consequence of merging Users and explicitly deferred that error; authenticated transport and sale behavior are outside the repair scope.

The user approved this transfer behavior on 2026-10-26: dragging a stack between folders, inventory windows, and a character asks for quantity without requiring Shift; a singleton transfers immediately. Cancel, Escape, or closing the quantity dialog performs no mutation. Selecting the entire stack transfers it once; selecting part preserves the correct remainder. The existing menu transfer uses the same quantity selection and mutation owners.

## Confirmed current behavior and owners

- `scripts/main.js` is the only composition root and owns socket dispatch, window registration, and scoped refresh.
- `scripts/ui/inventory-app.js` owns inventory presentation and delegated folder/item drop handling. Normal internal drop currently moves the whole stack; Shift and the context menu invoke `promptInventoryPartialTransfer`.
- `scripts/data/inventory-service.js` owns inventory mutations. Sales already have a typed active-GM command. `updateItemQuantity` currently requires direct Actor ownership and writes locally.
- `scripts/integrations/inventory-sync.js` owns reconciliation of native dnd5e drops onto character sheets. It shares a canonical ESM URL and one transient transfer session with inventory UI.
- Foundry 13.351 server source forwards custom socket messages with the authenticated User ID as the second listener argument. The reported `sender-mismatch` comes from comparing that ID with the envelope's sender, before sale execution. The reason these IDs differ in the reported session is still unconfirmed; stale authentication is a hypothesis, not a diagnosis. Foundry exposes the connection identity at `game.socket.session.userId`.
- `InventoryApp` already supports explicit group scope, folder scope, view identity, and close cleanup. Additional full windows must reuse this class.

## Approach

The user selected extending the existing window and transfer services. Reuse their quantity dialog/planner, active-GM authorization, transaction/recovery, and refresh mechanisms. Consolidate user intent and prevent double execution at the appropriate event boundary; keep native dnd5e hooks that confirm creation/debit. Removing every distinct hook would discard required reconciliation. A new inventory implementation or independent transfer executor would duplicate state and is rejected.

Implementation choices left to the builder: accessible icon/label and placement alongside existing top controls; additional-window registry naming; focused helper extraction when needed to share selection. No new dependencies or settings are needed. Repeated clicks may reuse the second full window, matching folder-popout behavior.

## Contracts to preserve

- Preserve existing prices, sale eligibility, currency credits, quantity precision, relative quantity input, zero-quantity removal semantics, material unit weight/price, authored Item data, formulas, and budget spending.
- Preserve singleton container/upgrade graph transfer, native character-sheet compatibility, ownership and exact group membership checks, active-GM election, sender binding, idempotency, and ambiguous-operation recovery. Never accept the claimed envelope identity as authenticated transport identity or silently execute as another User.
- Preserve all existing settings, Actor/User flags, public API call signatures and return behavior; optional explicit group context may be added compatibly to prevent actions in a secondary window from targeting another selected group.
- Preserve folder hierarchy limits, pinned folders, folder windows, ingress rules, and scope of existing public entry points. A full second window has `rootFolderId: null`; it does not create an extra folder or bypass domain rules.
- Preserve external catalog/compendium issuance semantics. Quantity selection concerns transfer of existing stacks, including existing character-to-party import; do not convert a copy source into a debit source. Storage uses its existing claim/ingress owner.
- Protect authenticated transport verification. Reproduce the legitimate failure using the actual connection contract before choosing a socket repair. If identity drift requires reconnect/reload, reject before dispatch with an actionable explanation; do not mask it by removing security checks.

## Deliberate behavior changes

1. Add the second full-window button, instance registration, scoped refresh, and cleanup.
2. Show quantity selection for movable stacks on ordinary drag/drop across the approved destinations. Singleton moves do not show the dialog. Same-destination no-op does not split a stack. Shift is no longer required.
3. Leave the sale socket mismatch unchanged, as explicitly requested after the user identified a User merge. Preserve authenticated sender validation and existing sale tests.
4. Restore quantity editing for users already entitled to the control, using validated authoritative mutation when direct permissions are insufficient. Do not expand rights to unrelated groups or characters.

## Regression and acceptance checks

Pin the requirements before changing runtime code. Tests must execute production owners with fake Documents/transport/DOM, rather than merely asserting helper structure.

- Authenticated player sale: correct source/group, requested quantity, one debit and one currency credit; authorized GM result correlates. Mismatched sender, forged GM, unknown User, unauthorized group and duplicate/replayed request remain protected.
- Quantity edit: absolute and relative input, ordinary and fractional material quantities, zero removal, cancellation, permissions, exact group scope, and synchronized views.
- Main, second full window and folder window: unique instance IDs; correct root/group; independent search/filter state; mutation refresh reaches both; closing removes only that instance; existing launchers still work.
- Drag/drop: folder-to-folder, root-to-folder, folder-to-root, window-to-window, party-to-character and character-to-party; whole/partial/cancel/singleton; stale quantity, changed permissions or removed destination; native drop produces no second copy/debit; material precision; composed singleton retains its graph and old recovery guarantees.
- Existing menu quantity selection and pending-operation retry continue to work.

Focused suites are chosen by the function passports (`inventory-app-context`, `inventory-folder-quantity-transfer`, `inventory-sync-hooks`, `inventory-simple-transfer`, `group-inventory-migration`, `world-mutation-infrastructure`, `main-composition-root`, `ui-refresh-coordinator`) and extended where necessary. Run the repository's full Node test suite, all tracked JS/MJS syntax checks, JSON parsing, and `git diff --check` before commit.

Live acceptance must report exact Foundry/dnd5e versions and GM/player coverage. The available browser currently reaches `/join`; authenticated live interaction is unavailable. Use disposable fixtures in a test world and report any live checks that remain unavailable honestly.

## Delivery

Update relevant function-passport sections (including `docs/item-instance-passport.md`) and README for public API additions. Bump `module.json` and its forwarding entry point together and update changed canonical module cache URLs. Work only on `lich_branch`, stage task files explicitly, review the diff, commit, and push without force. Record this specification, the approved implementation plan, commit and verification counts in the task report.

## Review state

The user approved this specification and requested implementation on 2026-10-26, with the sale socket error deferred as described above. The independent builder review returned "nothing important left". Baseline focused suites passed: 298 tests, 0 failures. The local Foundry MCP bridge reports no connected module, and the browser reaches `/join`, so live verification is not yet available. No product code has been changed before approval.
