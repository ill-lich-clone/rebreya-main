# Party Inventory Header Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the party crest from overlapping the party name and unify every compact party-header block under one panel surface.

**Architecture:** Replace the nested crest-and-wallet grid with explicit identity grid areas, then add one reusable panel class whose modifiers retain each element's semantic layout. No application data or handlers change.

**Tech Stack:** Foundry VTT ApplicationV2, Handlebars, CSS, Node.js test runner

## Global Constraints

- Work only on `lich_branch`.
- Preserve every existing header action, permission gate, data attribute, and accessible label.
- Keep the crest 104 px, the crest column 124 px, the column gap 18 px, and the wallet 260 px.
- Use one nearly opaque neutral surface; do not restore colored cargo or energy panels.
- Do not add dependencies.

---

### Task 1: Lock the grid and shared-surface contracts

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `templates/inventory-app.hbs` and `styles/main.css` as rendered-source contracts.
- Produces: regression coverage for identity grid areas and the shared `rm-inventory-book__panel` surface.

- [ ] **Step 1: Write the failing assertions**

Add assertions to the existing header-layout test that require:

```js
assert.doesNotMatch(template, /rm-inventory-book__identity-column/u);
assert.match(template, /class="rm-inventory-book__crest-button rm-inventory-book__identity-crest"/u);
assert.match(template, /class="rm-currency-compact rm-inventory-book__wallet"/u);
assert.equal((template.match(/rm-inventory-book__panel/gu) ?? []).length, 14);
assert.match(css, /\.rm-inventory-book__identity\s*\{[^}]*grid-template-columns:\s*124px minmax\(0,\s*1fr\);/u);
assert.match(css, /\.rm-inventory-book__identity-crest\s*\{[^}]*grid-area:\s*crest;/u);
assert.match(css, /\.rm-inventory-book__wallet\s*\{[^}]*grid-area:\s*wallet;/u);
assert.match(css, /\.rm-inventory-book__panel\s*\{[^}]*border-radius:\s*6px;[^}]*background:/u);
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test --test-name-pattern="positions external book tabs" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the wrapper still exists and the shared panel class and
grid-area rules do not.

### Task 2: Implement explicit identity grid areas

**Files:**
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: existing party identity, currency summary, and permissions.
- Produces: `crest`, `heading`, and `wallet` grid areas with unchanged actions.

- [ ] **Step 1: Flatten the identity markup**

Move the crest and wallet out of `rm-inventory-book__identity-column`. Add
`rm-inventory-book__identity-crest` to both editable and read-only crest
elements. Keep the heading between the crest and wallet in source order.

- [ ] **Step 2: Add the grid**

Implement:

```css
.rebreya-inventory-app .rm-inventory-book__identity {
  display: grid;
  grid-template-columns: 124px minmax(0, 1fr);
  grid-template-areas:
    "crest heading"
    "wallet wallet";
  column-gap: 18px;
  row-gap: 4px;
}

.rebreya-inventory-app .rm-inventory-book__identity-crest {
  grid-area: crest;
  justify-self: center;
}

.rebreya-inventory-app .rm-inventory-book__heading {
  grid-area: heading;
}

.rebreya-inventory-app .rm-inventory-book__wallet {
  grid-area: wallet;
  justify-self: start;
}
```

Remove the obsolete identity-column rule.

- [ ] **Step 3: Verify GREEN for the grid contract**

Run the focused command from Task 1. Expected: the grid assertions pass; shared
panel assertions remain failing until Task 3.

### Task 3: Apply one header-panel surface

**Files:**
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: existing semantic action, cargo, supply, and currency classes.
- Produces: shared `rm-inventory-book__panel` visual component.

- [ ] **Step 1: Apply the component class**

Add `rm-inventory-book__panel` to the three action buttons, cargo article,
three supply articles, and eight editable/read-only currency elements in the
template branches.

- [ ] **Step 2: Centralize the surface**

Add:

```css
.rebreya-inventory-app .rm-inventory-book__panel {
  border: 1px solid rgb(var(--rm-color-gold-rgb) / 0.3);
  border-radius: 6px;
  background: rgb(var(--rm-color-ink-rgb) / 0.94);
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 0.035),
    0 3px 10px rgb(0 0 0 / 0.28);
  color: var(--rm-text-primary);
}
```

Remove duplicate surface declarations from action, cargo/supply, and wallet
coin rules. Keep action hover/focus behavior as a modifier.

- [ ] **Step 3: Unify compact typography**

Use 10 px uppercase muted labels and 13 px bold primary values across cargo,
supply, and wallet elements. Keep action-button text at 12 px because it is a
control label rather than a metric label.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs
```

Expected: all inventory context tests pass.

### Task 4: Live QA and publication

**Files:**
- Verify: `templates/inventory-app.hbs`
- Verify: `styles/main.css`
- Verify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: rendered Foundry party inventory.
- Produces: verified and published `lich_branch`.

- [ ] **Step 1: Verify live geometry**

Open Foundry at `http://localhost:30000/` as `CODEX`. Open the party inventory
from the group-token launcher. Measure crest and title bounds and require:

```text
crest.right < title.left
```

- [ ] **Step 2: Verify shared computed styles**

Compare one action, cargo, supply, and currency panel. Require equal computed
background color, border, border radius, and box shadow.

- [ ] **Step 3: Verify rendered behavior**

Capture a screenshot, exercise the inventory launcher and one header control,
and confirm there are no relevant console errors.

- [ ] **Step 4: Run repository checks**

```powershell
git diff --check
node --test
```

Expected: clean diff and all tests passing.

- [ ] **Step 5: Review, commit, and push**

Review staged diff, commit with:

```powershell
git commit -m "fix: unify party inventory header layout"
git push origin lich_branch
```
