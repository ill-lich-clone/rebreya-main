# Groups Card Grid Design

## Goal

Replace the cramped inventory-style group rows with a dedicated two-column card grid that presents group state and actions clearly.

## Layout

- Keep the existing window header and summary.
- Render groups in a responsive two-column grid, collapsing to one column on narrow windows.
- Each card contains the group image, full name, actor ID, status badges, member count, and initialization date.
- Group metadata must use available card width without the narrow first-column wrapping seen in the current shared inventory row.

## States And Actions

- Active registered group: show `Активная` and `Зарегистрирована` badges, `Открыть лист`, and a non-interactive `Текущая группа` indicator.
- Registered inactive group: show `Зарегистрирована`, `Открыть лист`, and primary action `Сделать активной`.
- Unregistered group: show `Не зарегистрирована`, `Открыть лист`, and primary action `Зарегистрировать`.
- Put the infrequent `Перенести legacy` action inside an ellipsis menu. Keep its current enabled/disabled rules and existing module API call.

## Architecture

- Add groups-window-specific template classes and CSS instead of reusing `.rm-compact-item` inventory layout rules.
- Preserve the existing `GroupsApp` context fields and action names wherever possible.
- Add only display-oriented context labels needed to avoid complex Handlebars conditionals.
- Do not change group registration, active-group selection, migration data, socket behavior, or repository state.

## Verification

- Template tests cover the dedicated grid and all three state-specific primary actions.
- Tests confirm legacy migration remains available through the overflow menu.
- Existing group migration and module tests continue to pass.
- Verify the cards remain readable at the default 920px window width and collapse to one column at narrow widths.
