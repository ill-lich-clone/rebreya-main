# Rebreya Gray-Gold Theme Design

## Goal

Replace the brown and turquoise visual foundation of every Rebreya window with an inherited dark gray and muted gold theme modeled on the dnd5e character-sheet palette.

## Scope

- Modify the existing `styles/main.css`; do not add a second override stylesheet.
- Preserve layout, spacing, dimensions, selectors, responsive behavior, and application logic.
- Keep red, green, and amber colors only where they communicate danger, success, or warning states.
- Use Foundry's denim texture for the window background and neutral gray surfaces for panels, rows, fields, and overlays.

## Architecture

The `:root` block owns a small semantic token system. Primitive color tokens describe the dnd5e-inspired palette, while surface, border, text, and interaction tokens describe usage. Existing public `--rm-*` variables remain as compatibility aliases so older component rules continue to inherit the new theme during migration.

Hard-coded brown and turquoise literals in component rules are replaced with semantic tokens. Component-specific rules may still define opacity and state meaning, but they must consume the shared palette rather than introduce another brown surface.

## Token Roles

- `--rm-color-ink`: deepest window background.
- `--rm-color-dark`: dark structural background.
- `--rm-color-surface`: normal panel and input surface.
- `--rm-color-surface-raised`: raised panel, row, and control surface.
- `--rm-color-surface-hover`: hover and selected neutral surface.
- `--rm-color-gold`: standard dnd5e-style border and accent.
- `--rm-color-gold-bright`: emphasized labels and active controls.
- `--rm-surface-window`: denim texture plus ink background.
- `--rm-surface-panel`, `--rm-surface-panel-strong`, `--rm-surface-row`, `--rm-surface-input`, `--rm-surface-subtle`: inherited component surfaces.
- `--rm-border-subtle`, `--rm-border-default`, `--rm-border-strong`: shared border strengths.
- `--rm-text-primary`, `--rm-text-secondary`, `--rm-text-dim`: text hierarchy.

## Safety

Automated tests read the final stylesheet and require the semantic token contract, the denim texture, compatibility aliases, and removal of the dominant legacy brown/turquoise literals. Existing JavaScript and template tests ensure this visual refactor does not alter application behavior.
