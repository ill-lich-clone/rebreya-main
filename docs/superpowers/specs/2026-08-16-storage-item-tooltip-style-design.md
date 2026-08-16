# Storage Item Tooltip Style Design

## Goal

Make item-name tooltips inside the storage window readable and visually consistent with the existing storage item popover.

## Scope

- Change only the tooltip pseudo-elements attached to `.rm-storage-item__icon.rm-tooltip-anchor` inside `.rebreya-storage-app`.
- Keep the existing tooltip text source, hover/focus behavior, expanded-item suppression, storage actions, and click handling unchanged.
- Do not change the generic `.rm-tooltip-anchor` styling used elsewhere.

## Visual behavior

- Use the storage UI's nearly opaque dark overlay surface, stronger gold border, light text, and established shadow treatment.
- Size the tooltip to its label instead of enforcing the generic 180 px minimum width, while retaining a bounded maximum width for long names.
- Display the tooltip below the item icon. This keeps it away from the compact storage window header and prevents the translucent overlap shown in the reported screenshots.
- Reorient the tooltip arrow so it points upward toward the item icon.

## Verification

- Add focused CSS contract assertions to `tests/storage-app.test.mjs` before changing the stylesheet.
- Verify that the storage-specific rules provide the opaque surface, compact sizing, downward placement, and matching arrow orientation.
- Run the focused storage test, then the repository's complete required verification suite.
- Perform visual browser verification when an authenticated Foundry scene is available; otherwise report that limitation and request a post-reload screenshot from the user.

## Documentation impact

This change introduces no methods, public API, data flow, or state mutation. `docs/function-passport.md` and `README.md` do not require updates.
