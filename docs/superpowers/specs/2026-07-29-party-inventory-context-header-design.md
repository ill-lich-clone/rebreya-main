# Party Inventory Context Header Design

## Goal

Move persistent party information into the shared illustrated header and remove
inventory-only labels that repeat what the active bookmark already communicates.
The result should use the quiet left side of the workshop artwork without adding
another visually dominant block.

## Selected layout

- Keep the editable party crest in the upper-left identity area.
- Place the four party currencies directly below the crest in a compact two-by-two
  wallet. The same controls remain visible and editable on every tab.
- Keep the party name to the right of the crest. Add the active tab label directly
  below it as a smaller, right-running subtitle.
- On the inventory tab, remove the `Склад` heading and the
  `Перетащите предмет в область склада` hint. The full panel remains a drop target.
- Replace the separate highlighted item-value block with one subdued metadata row
  on the left: item position count followed by total item value. Both values use
  the same typographic treatment.

## Rejected alternatives

- Putting item value to the right of the last currency would keep the wallet
  inventory-specific and would not solve the empty left side on other tabs.
- Keeping currencies inside the inventory panel would continue to make persistent
  party state disappear while switching tabs.

## Data and interaction

- `InventoryApp` exposes an `activeTabLabel` derived from the validated active tab.
- Existing currency data and `canEditCurrency` permission are reused unchanged.
- Existing `edit-currency-root` and `edit-currency` actions move with the wallet;
  currency persistence behavior does not change.
- Existing tab switching, inventory filtering, sorting, and drop handling remain
  unchanged.

## Visual rules

- The wallet is subordinate to the crest and party name: compact dark surfaces,
  restrained borders, and denomination accents only on the small values.
- The active-tab subtitle uses the existing gold/gray vocabulary but stays much
  smaller than the party name.
- The inventory metadata line has no filled badge or gold block. It aligns left
  above the toolbar and reads like secondary table information.

## Verification

- Template contract tests prove the wallet sits outside the inventory-only branch,
  redundant strings are gone, and metadata is grouped on the left.
- Context tests prove every supported tab receives the correct Russian label and
  invalid tabs fall back to `Инвентарь`.
- Existing currency interaction tests continue to cover editing.
- Focused inventory tests, the full Node test suite, `git diff --check`, and live
  Foundry rendering are run before publication.
