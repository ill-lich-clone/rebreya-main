# Restore inventory template loading in Foundry v13

Status: approved by the user on 2026-10-17; implementation-plan review pending.

## Observable result

The existing party-inventory button and `game.rebreyaMain.openInventoryApp()`
open the inventory window without Foundry's template-extension error. Folder
popouts continue to use the same InventoryApp class and load the same template.

## Confirmed cause

`InventoryApp.PARTS.main.template` currently contains
`modules/rebreya-main/templates/inventory-app.hbs?v=1.4.377`.
Foundry 13.351's `getTemplate()` sends this string unchanged through the
`template` socket event. Server `Files.loadTemplate()` treats it as a filesystem
path and validates `path.extname()`: the suffix is `.377`, which is rejected.
The real `templates/inventory-app.hbs` exists and has the accepted `.hbs` suffix.

Commit `b333be25` introduced a query parameter on 2026-10-13; `657f93b99` later
changed its value. Existing UI tests stub the Handlebars mixin and therefore
do not exercise the server's template-path validation.

## Owner and deliberate behavior changes

- Keep template ownership in `scripts/ui/inventory-app.js`, using the existing
  plain path `modules/${MODULE_ID}/templates/inventory-app.hbs` in PARTS.
- Advance module version from `1.4.393` to `1.4.394`; add
  `scripts/main-1.4.394.js` with exactly `import "./main.js";` and retain all
  published forwarders.
- Change all three composition imports of `inventory-app.js` to the same
  `?v=1.4.394` URL so existing clients load the corrected class on refresh.
  Preserve the other runtime owners' current cache keys.
- Update the relevant function-passport section and release assertions.

## Preserved contracts

Preserve all public APIs, ApplicationV2 lifecycle, template contents, dimensions,
tabs, folder actions, permissions, settings, flags, authored formulas, quantities,
fractional material mass, currency, budgets and spending, inventory transactions,
recovery, and loot-claim behavior. Opening and closing a window must not require
a data migration or change existing items.

## Regression evidence required before the fix

Add a focused test in `tests/inventory-app-context.test.mjs` that imports the
actual InventoryApp with the existing Foundry stub, asserts its exact plain
template path, verifies an accepted filesystem extension without stripping a
query/hash, and verifies the corresponding file exists. Run it against the old
code and confirm failure. Preserve canonical-import and historical-forwarder
assertions in `tests/module-manifest.test.mjs` while updating release values.

## Validation and limits

Run focused inventory/context and manifest tests, then the repository's full
Node suite, JavaScript syntax checks, JSON parsing, and `git diff --check` before
commit. Review the diff, commit only task files on `lich_branch`, and push it.
Live acceptance should open the existing window, close/reopen it, and check for
template errors in a reachable authenticated Foundry v13 session. No such session
is currently exposed by the available browser tools; report that limit if it
remains unavailable.

The reported missing loot-chat message, missing ActiveEffect, midi-qol roll
failure, ResizeObserver warnings, and `null` asset requests are separate log
entries. This fix does not suppress them or claim to resolve their causes.
