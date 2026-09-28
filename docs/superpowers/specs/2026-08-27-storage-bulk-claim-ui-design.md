# Storage Bulk Claim UI Design

**Date:** 2026-08-27

**Status:** Approved in chat

## Goal

Replace the visually broken inline `Залутать всё` controls with one rounded bottom action that opens a standard Foundry choice dialog, without changing the authoritative bulk-claim transaction.

## Observable behavior

- A claimable storage view shows one rounded `Забрать всё` control below the item and coin grid.
- The control is visually separate from the grid and its popover layer.
- Activating it opens a standard `DialogV2` with:
  - `Забрать всё себе`;
  - `Забрать в инвентарь`;
  - the standard close/cancel affordance.
- `Забрать всё себе` dispatches the existing bulk claim with `destination: "self"`.
- `Забрать в инвентарь` dispatches the existing bulk claim with `destination: "party"`.
- Closing the dialog performs no mutation and no snapshot refresh.
- Journal-only storage continues to omit the bulk action.
- If the authoritative result reports `sourceDeleted: true`, the storage app closes exactly as it does now.

## Ownership and scope

- Presentation owner: `scripts/ui/storage-app.js`.
- Template owner: `templates/storage-app.hbs`.
- Styling owner: the storage section of `styles/main.css`.
- Focused tests: `tests/storage-app.test.mjs`.
- Authoritative mutation remains `RebreyaMainModule.claimStorageAll()` → the existing typed storage command → `StorageCommandService.claimAll()`.

This change must not modify claim payloads, authorization, inventory ingress planning, source debit, durable recovery, refresh coordination, or ground-pile deletion.

## Design

`StorageApp._prepareContext()` retains the existing `canClaimAll` derivation. The template renders one footer-like action after the grid rather than the current three-element action strip before it.

Clicking the action calls one UI helper that awaits `DialogV2.wait()` or the project-equivalent standard Foundry dialog API. The helper resolves to `"self"`, `"party"`, or `null`. Only a non-null destination reaches the existing private bulk-claim method.

The dialog labels use user-facing inventory language while preserving the canonical internal destination names:

| UI label | Destination |
|---|---|
| `Забрать всё себе` | `self` |
| `Забрать в инвентарь` | `party` |

The bottom control uses the existing rounded inventory action language, but receives a storage-specific class so it does not inherit `.rm-storage-item__actions` two-column layout. It remains reachable by keyboard and exposes an accessible label identical to its visible text.

## Error handling

- Dialog cancellation is a normal no-op.
- Errors from `claimStorageAll()` use the existing storage error notification path.
- A stale or cancelled inventory-ingress choice returns without closing the popover/app or requesting another stale snapshot.
- Repeated clicks while the dialog or claim is pending must not produce concurrent bulk mutations. `StorageApp` owns a local boolean pending guard covering both dialog wait and authoritative claim; the bottom control renders disabled while that guard is set and the guard is cleared in `finally`.

## Verification

Focused tests must prove:

1. the old inline `Залутать всё`, `Себе`, and `В группу` strip is absent;
2. `Забрать всё` is rendered after the grid only when `canClaimAll` is true;
3. dialog cancellation does not call `claimStorageAll()`;
4. each dialog action maps to the exact existing destination;
5. one click produces at most one authoritative call;
6. `sourceDeleted: true` closes the app;
7. Journal-only storage has no bulk action.

No README contract change is required unless implementation exposes a new public UI helper. Any new or changed method must be reflected in the storage section of `docs/function-passport.md` in the implementation commit.
