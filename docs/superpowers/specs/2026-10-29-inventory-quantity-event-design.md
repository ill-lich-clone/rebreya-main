# Inventory quantity event lifetime repair

## Observable result and approval scope

Saving the existing quantity dialog updates the selected Item in the displayed group. This repairs the quantity-editing contract already approved in `2026-10-26-inventory-actions-and-windows-design.md` and the later native-owner specification; no new behavior or approval is required. The user supplied the exact production failure on 1.5.19: `Cannot read properties of null (reading 'dataset')` at inventory-app.js:7899.

## Cause and approach

The click listener reads `event.currentTarget.dataset.sourceType` after awaiting the quantity dialog. A dispatched DOM Event clears currentTarget when synchronous dispatch finishes, before the dialog resolves. Existing fake click events never cleared it and concealed the failure.

Capture the primitive source type with item ID, displayed quantity and group before awaiting. Reuse that value for dialog step and parser precision. Keeping an Event alive or changing persistence/socket services would address the wrong owner. The only sensible repair is in the existing InventoryApp listener.

## Contracts

Preserve public signatures, absolute/relative inputs, ordinary precision 2, material precision 12, cancellation, zero removal, displayed group and optimistic quantity, permissions, native-owner routing and existing legacy routes. No settings, authored formulas, prices, weights or budgets change. The deliberate behavior change is solely that saving now reaches the existing API after real DOM event dispatch.

## Verification and delivery

Regression invokes the real registered listener with native EventTarget/Event semantics and a deferred dialog, covering ordinary absolute/relative/zero, fractional material and cancellation. Preserve existing tests. Update the function passport, bump module/forwarder and the InventoryApp importer cache URL coherently, run full repository checks, independent final review, commit and push lich_branch. Live Foundry checks require an authenticated session; report availability honestly.
