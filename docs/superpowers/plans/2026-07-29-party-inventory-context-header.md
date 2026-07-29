# Party Inventory Context Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move party currency and active-tab identity into the shared illustrated header while reducing the inventory panel heading to subdued left-aligned metadata.

**Architecture:** `InventoryApp` remains the single source of prepared UI context and adds one derived `activeTabLabel`. The existing currency controls move unchanged from the inventory-only branch into the shared identity column; the inventory branch keeps its drop surface and replaces its title, hint, and highlighted value badge with one metadata row.

**Tech Stack:** Foundry VTT v13 ApplicationV2, JavaScript modules, Handlebars, scoped CSS, Node test runner.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Preserve existing currency persistence permissions and inventory drop behavior.
- Show the currency wallet on every inventory application tab.
- Do not add new dependencies or force-push.

---

### Task 1: Shared party context header

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `InventoryApp.activeTab`, `summary.currency`, `canEditCurrency`, and the existing `edit-currency-root` / `edit-currency` actions.
- Produces: `activeTabLabel: string` in template context and shared `.rm-inventory-book__wallet`, `.rm-inventory-book__section-title`, and `.rm-inventory-book__inventory-meta` surfaces.

- [ ] **Step 1: Write failing context and template contract tests**

Add a context test that calls `setActiveTab("calendar", { render: false })`, prepares context, and asserts:

```js
assert.equal(context.activeTabLabel, "Календарь");
```

Extend the compact-header contract to assert:

```js
assert.match(template, /class="rm-inventory-book__section-title">\{\{activeTabLabel\}\}/u);
assert.match(template, /class="rm-currency-compact rm-inventory-book__wallet"/u);
assert.match(template, /class="rm-inventory-book__inventory-meta"[\s\S]*inventoryCount[\s\S]*totalItemValueLabel/u);
assert.doesNotMatch(template, /<h3>Склад<\/h3>/u);
assert.doesNotMatch(template, /Перетащите предмет в область склада/u);
assert.doesNotMatch(template, /class="rm-inventory-value-summary"/u);
```

Also assert that the wallet appears before `{{#if tabs.isInventory}}`, proving it is shared across tabs.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="active tab label|compact header summary" tests/inventory-app-context.test.mjs
```

Expected: FAIL because `activeTabLabel` and the new shared/header metadata markup do not exist.

- [ ] **Step 3: Add the active-tab label**

Add a frozen label map near `InventoryApp`:

```js
const INVENTORY_TAB_LABELS = Object.freeze({
  inventory: "Инвентарь",
  party: "Группа",
  craft: "Крафт",
  calendar: "Календарь",
  travel: "Путешествие",
  transport: "Транспорт",
  downtime: "Простой"
});
```

Use its keys in `setActiveTab`, and return:

```js
activeTabLabel: INVENTORY_TAB_LABELS[this.activeTab] ?? INVENTORY_TAB_LABELS.inventory,
```

- [ ] **Step 4: Move wallet and simplify inventory metadata**

In `templates/inventory-app.hbs`:

- wrap the crest and wallet in `.rm-inventory-book__identity-column`;
- move the existing currency root and its permission-gated controls below the crest;
- add `<p class="rm-inventory-book__section-title">{{activeTabLabel}}</p>` below the party title;
- remove the inventory-only currency block, `Склад` heading, drop hint, and value summary;
- add:

```hbs
<div class="rm-inventory-book__inventory-meta">
  <span>{{rmNum inventoryCount precision=0}} поз.</span>
  <span aria-hidden="true">·</span>
  <span>Стоимость вещей: <strong>{{summary.totalItemValueLabel}}</strong></span>
</div>
```

Keep the `rm-inventory-drop-surface` and `data-action="inventory-dropzone"` attributes on the panel.

- [ ] **Step 5: Style the new hierarchy**

In `styles/main.css`:

- make `.rm-inventory-book__identity` align to the start;
- add a 104px identity column;
- make the header wallet a two-column grid with compact denomination controls;
- style `.rm-inventory-book__section-title` as a small gold-gray subtitle under the party name;
- style `.rm-inventory-book__inventory-meta` as a left-aligned muted row with no filled badge;
- remove obsolete `.rm-inventory-value-summary` styling only after confirming no other template uses it.

- [ ] **Step 6: Run focused tests and inventory regressions**

Run:

```powershell
node --test --test-name-pattern="active tab label|compact header summary|currency" tests/inventory-app-context.test.mjs
node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs tests/party-inventory-crest.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the implementation**

```powershell
git add -- scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs docs/superpowers/plans/2026-07-29-party-inventory-context-header.md
git commit -m "feat: move party context into inventory header"
```

---

### Task 2: Review, live QA, and publication

**Files:**
- Modify only if verification finds a reproducible issue: the Task 1 files and their matching tests.

**Interfaces:**
- Consumes: the complete Task 1 diff.
- Produces: a reviewed, tested, committed, and synchronized `origin/lich_branch`.

- [ ] **Step 1: Request a read-only Terra review**

Ask the existing `gpt-5.6-terra` reviewer to inspect the diff for context
correctness, permission regressions, Handlebars scope mistakes, header overflow,
and stale inventory-only currency markup. The reviewer must not edit files.

- [ ] **Step 2: Validate in live Foundry**

Use the CODEX profile and verify:

1. currencies are below the crest on every tab;
2. currency editing still opens and saves for permitted users;
3. the active-tab subtitle updates after switching tabs;
4. the inventory panel has no `Склад` or drag-hint text;
5. position count and item value form one restrained left-aligned row;
6. inventory drop, filtering, sorting, scrolling, and external bookmarks still work;
7. no clipping, overlap, or relevant console errors appear.

- [ ] **Step 3: Fix only reproduced defects with RED-GREEN tests**

For each defect, add the smallest failing assertion to
`tests/inventory-app-context.test.mjs`, run it RED, implement the fix, and rerun
it GREEN. Commit fixes only when changes are necessary.

- [ ] **Step 4: Run fresh final verification**

```powershell
node --test
git diff --check
git status --short --branch
```

Expected: all tests PASS, diff check exits 0, and no unrelated files are changed.

- [ ] **Step 5: Re-fetch and verify the integration boundary**

```powershell
git fetch origin
git branch --show-current
git merge-base --is-ancestor origin/main HEAD
git status --short
```

Expected: `lich_branch`, current `origin/main` is an ancestor, and the worktree is clean.

- [ ] **Step 6: Push without force and verify synchronization**

```powershell
git push origin lich_branch
git status --short --branch
git rev-parse HEAD
git rev-parse origin/lich_branch
```

Expected: local and remote hashes match.
