# Party Inventory Layout Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the book tabs outside the inventory window, expose the character-sheet artwork, and consolidate the party summary into a compact header control stack.

**Architecture:** Foundry's `.window-content` returns to a single full-width page while the tab rail is absolutely positioned beyond its right edge. The header owns the existing summary markup and a CSS-only cargo tooltip; the body starts directly with active-tab content. Artwork is rendered through the same masked pseudo-element pattern used by the character sheet, without tint overlays.

**Tech Stack:** Foundry VTT 13 ApplicationV2, Handlebars, scoped CSS, Node.js `node:test`.

## Global Constraints

- Work only on `lich_branch`; never push directly to `main` or `master`.
- Inventory window size is `1320px × 920px`.
- Use `assets/ui/rebreya-character-header.webp` with the character-sheet mask and no tint overlay.
- Preserve all existing `data-action` values, permission gates, tab state, drag/drop behavior, and data formatting.
- Add no JavaScript listeners or application state for the cargo tooltip.

---

### Task 1: Lock the refined template and layout contract

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `InventoryApp.DEFAULT_OPTIONS`, `templates/inventory-app.hbs`, and `styles/main.css`.
- Produces: regression assertions for the `1320 × 920` window, external absolute tab rail, masked artwork, header summary, cargo tooltip, and removed details disclosure.

- [ ] **Step 1: Update the window-size assertion and write failing template assertions**

Assert:

```js
assert.equal(InventoryApp.DEFAULT_OPTIONS.position.width, 1320);
assert.equal(InventoryApp.DEFAULT_OPTIONS.position.height, 920);
assert.match(template, /class="rm-inventory-book__summary"/u);
assert.match(template, /class="rm-inventory-book__cargo-tooltip"/u);
assert.doesNotMatch(template, /Подробнее по складу/u);
assert.doesNotMatch(template, /class="rm-compact-pill-strip rm-compact-pill-strip--primary"/u);
```

- [ ] **Step 2: Write failing CSS assertions**

Assert that `.window-content` is positioned and overflow-visible, the page owns scrolling, the tab rail is absolute with a negative right offset, the artwork pseudo-element uses the shared image and mask, and the header contains no shade selector.

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```powershell
node --test --test-name-pattern="external book tabs|compact header summary" tests/inventory-app-context.test.mjs
```

Expected: failures on the old `1440px` width, grid tab column, body summary, and missing tooltip markup.

### Task 2: Refine the inventory template and CSS

**Files:**
- Modify: `scripts/ui/inventory-app.js:2873`
- Modify: `templates/inventory-app.hbs:6-94`
- Modify: `styles/main.css:4259-4450`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: existing `party.dashboard.*`, `summary.*`, `rmNum`, `canManage`, and the seven `switch-tab` actions.
- Produces: `.rm-inventory-book__controls`, `.rm-inventory-book__summary`, `.rm-inventory-book__cargo`, `.rm-inventory-book__cargo-bar`, and `.rm-inventory-book__cargo-tooltip`.

- [ ] **Step 1: Restore the page-width window**

Set:

```js
position: {
  width: 1320,
  height: 920
}
```

- [ ] **Step 2: Move summary markup into the header**

Keep the existing action row. Below it, render one full-width cargo card with the current weight value and meter, followed by equal food, water, and energy cards. Move the details values into tooltip markup associated with the cargo bar using `tabindex="0"` and `aria-describedby`.

- [ ] **Step 3: Remove redundant body markup**

Delete the old primary pill strip and the complete `rm-compact-pill-details` block so active-tab content begins immediately after any context warning or action feedback.

- [ ] **Step 4: Make the tabs external**

Replace the `.window-content` grid with a positioned full-width container. Absolutely position `.rm-inventory-book__tabs` at the page's right edge using a negative `right` offset, keep it fixed while `.rm-inventory-book__page` scrolls, and allow rail shadows/focus outlines to overflow.

- [ ] **Step 5: Match the character-sheet artwork treatment**

Render the header image in `::before` with:

```css
background-image: var(--rm-character-sheet-header-image);
-webkit-mask-image: linear-gradient(180deg, #000 0%, #000 58%, rgb(0 0 0 / 0.72) 75%, transparent 100%);
mask-image: linear-gradient(180deg, #000 0%, #000 58%, rgb(0 0 0 / 0.72) 75%, transparent 100%);
```

Remove the template shade element and all tint-gradient layers from the inventory header.

- [ ] **Step 6: Style the compact summary and tooltip**

Make the control stack match the width of the action row. Preserve the cargo progress bar. Reveal the tooltip on `.rm-inventory-book__cargo-bar:hover` and `:focus-visible`, with a readable bordered panel that does not intercept pointer input.

- [ ] **Step 7: Run the focused test and confirm GREEN**

Run:

```powershell
node --test --test-name-pattern="external book tabs|compact header summary" tests/inventory-app-context.test.mjs
```

Expected: both tests pass.

### Task 3: Regression, review, and Foundry verification

**Files:**
- Verify: `scripts/ui/inventory-app.js`
- Verify: `templates/inventory-app.hbs`
- Verify: `styles/main.css`
- Verify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: the completed refinement diff.
- Produces: reviewed code, live visual evidence, a clean commit, and `origin/lich_branch`.

- [ ] **Step 1: Run inventory regression tests**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Request one `gpt-5.6-terra` review**

Review only concrete layout, overflow, accessibility, Handlebars, and regression risks. Verify every finding locally before changing code.

- [ ] **Step 3: Verify in Foundry**

Log in with the CODEX profile, open the inventory, and verify the external rail, un-tinted artwork, cargo tooltip hover/focus, raised warehouse panel, tab switching, independent page scroll, and absence of new console errors.

- [ ] **Step 4: Run the full suite and inspect the final diff**

Run:

```powershell
node --test
git diff --check
git diff --stat
git status --short --branch
```

Expected: all tests pass, no whitespace errors, and only scoped task files are modified.

- [ ] **Step 5: Commit and push**

```powershell
git add scripts/ui/inventory-app.js styles/main.css templates/inventory-app.hbs tests/inventory-app-context.test.mjs
git commit -m "fix: refine party inventory book layout"
git push origin lich_branch
```

Do not use force push.
