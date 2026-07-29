# Party Inventory Book Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing party inventory as a scrollable Rebreya book page with the character-sheet artwork, active group title, compact header actions, and fixed right-side book tabs.

**Architecture:** Keep `InventoryApp` state, actions, services, and permissions intact. Restructure only the Handlebars application shell into a scrollable page plus a fixed navigation rail, then add inventory-scoped CSS for the artwork header and right-side tabs.

**Tech Stack:** Foundry VTT v13 `ApplicationV2`, Handlebars templates, vanilla CSS, Node `node:test`, Codex in-app Browser.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Do not force-push.
- The default window size is exactly `1440 × 920`.
- The right-side rail is exactly `112px` wide at every resizable window width.
- The artwork header is exactly `300px` high and uses `/modules/rebreya-main/assets/ui/rebreya-character-header.webp`.
- The book page, including its artwork header, scrolls as one surface; the right-side rail stays fixed relative to the application.
- Use `group.name` as the title and `actor.name` only as its fallback.
- Remove `Партийная логистика` and the redundant `Группа: …` strip.
- Preserve all existing `data-action`, `data-tab`, permission, service, socket, and document-mutation behavior.
- Do not modify Forien Quest Log files or introduce a Foundry Tabs controller.
- Add automated tests before production changes and observe the expected RED failure.
- Validate the final rendered result in Foundry through the Codex browser profile.

---

## File Structure

- Modify `tests/inventory-app-context.test.mjs`: layout and style contracts for the inventory application.
- Modify `scripts/ui/inventory-app.js`: default application dimensions only.
- Modify `templates/inventory-app.hbs`: outer stage, scrollable page, artwork header, title, compact actions, and right-side navigation.
- Modify `styles/main.css`: inventory-scoped book layout, artwork, compact header controls, tab rail, focus states, and resizing behavior.
- Do not modify data services or Foundry integration files.

---

### Task 1: Book Page Structure And Window Contract

**Files:**
- Modify: `tests/inventory-app-context.test.mjs:407-420`
- Modify: `scripts/ui/inventory-app.js:2867-2881`
- Modify: `templates/inventory-app.hbs:1-110`

**Interfaces:**
- Consumes: existing `InventoryApp.activeTab`, `tabs.isInventory` through `tabs.isDowntime`, `group`, `actor`, `canManage`, and existing `data-action` listeners.
- Produces: `.rm-inventory-book`, `.rm-inventory-book__page`, `.rm-inventory-book__header`, `.rm-inventory-book__title`, `.rm-inventory-book__actions`, and `.rm-inventory-book__tabs`.

- [ ] **Step 1: Update the window-size test and add a template structure test**

Replace the current `InventoryApp keeps the wide party inventory window size` expectations and add the following adjacent test:

```js
test("InventoryApp reserves window space for right-side book tabs", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");

  try {
    assert.equal(InventoryApp.DEFAULT_OPTIONS.position.width, 1440);
    assert.equal(InventoryApp.DEFAULT_OPTIONS.position.height, 920);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp template renders a scrollable book page beside right-side tabs", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const pageIndex = template.indexOf('class="rm-shell rm-inventory-shell rm-inventory-shell--compact rm-inventory-book__page scrollable"');
  const tabsIndex = template.indexOf('class="rm-inventory-book__tabs"');

  assert.match(template, /class="rm-inventory-book"/u);
  assert.ok(pageIndex >= 0, "expected the scrollable book page");
  assert.ok(tabsIndex > pageIndex, "expected the tab rail after the book page");
  assert.match(template, /\{\{#if group\}\}\{\{group\.name\}\}\{\{else\}\}\{\{actor\.name\}\}\{\{\/if\}\}/u);
  assert.doesNotMatch(template, /Партийная логистика/u);
  assert.doesNotMatch(template, /<span>Группа:\s*\{\{group\.name\}\}/u);

  for (const tab of ["inventory", "party", "craft", "calendar", "travel", "transport", "downtime"]) {
    assert.match(template, new RegExp(`data-action="switch-tab"[^>]+data-tab="${tab}"`, "u"));
  }

  assert.match(template, /class="rm-inventory-book__actions"[\s\S]*data-action="open-actor-sheet"/u);
  assert.match(template, /\{\{#if canManage\}\}[\s\S]*data-action="add-food"[\s\S]*data-action="add-water"[\s\S]*\{\{\/if\}\}/u);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="reserves window space|scrollable book page" tests/inventory-app-context.test.mjs
```

Expected:

- size assertions report `1320 !== 1440` and `900 !== 920`;
- the structure test reports that `.rm-inventory-book` or the scrollable page is missing.

- [ ] **Step 3: Change the default window size**

In `InventoryApp.DEFAULT_OPTIONS.position`, set:

```js
position: {
  width: 1440,
  height: 920
}
```

- [ ] **Step 4: Restructure the successful template state**

Keep the existing `hasError` branch unchanged. In the successful branch:

1. Add the outer stage:

```hbs
<section class="rm-inventory-book">
```

2. Make the existing shell the first child and sole scroll owner:

```hbs
<section class="rm-shell rm-inventory-shell rm-inventory-shell--compact rm-inventory-book__page scrollable">
```

3. Replace the old compact header and redundant group strip with:

```hbs
<header class="rm-inventory-book__header">
  <div class="rm-inventory-book__header-shade" aria-hidden="true"></div>
  <div class="rm-inventory-book__heading">
    <h2 class="rm-inventory-book__title">{{#if group}}{{group.name}}{{else}}{{actor.name}}{{/if}}</h2>
  </div>

  <div class="rm-inventory-book__actions">
    <button type="button" class="rm-inventory-book__action" data-action="open-actor-sheet" title="Открыть лист склада">
      <i class="fa-solid fa-up-right-from-square"></i>
      <span>Лист склада</span>
    </button>
    {{#if canManage}}
      <button type="button" class="rm-inventory-book__action" data-action="add-food" title="Добавить еду">
        <i class="fa-solid fa-bread-slice"></i>
        <span>Еда</span>
      </button>
      <button type="button" class="rm-inventory-book__action" data-action="add-water" title="Добавить воду">
        <i class="fa-solid fa-droplet"></i>
        <span>Вода</span>
      </button>
    {{/if}}
  </div>
</header>
```

4. Wrap the existing warning, summary, feedback, and active panels after the header in:

```hbs
<div class="rm-inventory-book__content">
```

5. Remove the old inline `.rm-tabs.rm-tabs--compact` block from the content.

6. After closing the book page, add its sibling navigation:

```hbs
<nav class="rm-inventory-book__tabs" aria-label="Разделы партийного инвентаря">
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isInventory}}is-active{{/if}}" data-action="switch-tab" data-tab="inventory">Инвентарь</button>
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isParty}}is-active{{/if}}" data-action="switch-tab" data-tab="party">Группа</button>
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isCraft}}is-active{{/if}}" data-action="switch-tab" data-tab="craft">Крафт</button>
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isCalendar}}is-active{{/if}}" data-action="switch-tab" data-tab="calendar">Календарь</button>
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isTravel}}is-active{{/if}}" data-action="switch-tab" data-tab="travel">Путешествие</button>
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isTransport}}is-active{{/if}}" data-action="switch-tab" data-tab="transport">Транспорт</button>
  <button type="button" class="rm-inventory-book__tab {{#if tabs.isDowntime}}is-active{{/if}}" data-action="switch-tab" data-tab="downtime">Простой</button>
</nav>
```

7. Close `.rm-inventory-book`.

Do not alter any markup within the individual active-tab panels.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="reserves window space|scrollable book page" tests/inventory-app-context.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 6: Run the complete inventory UI test file**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs
```

Expected: PASS with no failures.

- [ ] **Step 7: Review and commit the structural change**

Run:

```powershell
git diff --check
git diff -- scripts/ui/inventory-app.js templates/inventory-app.hbs tests/inventory-app-context.test.mjs
git add -- scripts/ui/inventory-app.js templates/inventory-app.hbs tests/inventory-app-context.test.mjs
git commit -m "feat: restructure party inventory as book page"
```

---

### Task 2: Artwork Header And Right-Side Book Tab Styling

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `styles/main.css:4247-4545`

**Interfaces:**
- Consumes: markup classes created by Task 1.
- Produces: a `112px` fixed rail, `300px` scrolling artwork header, `36px` Modesto title, compact header actions, and active/hover/focus tab states.

- [ ] **Step 1: Add the failing CSS contract test**

Add:

```js
test("InventoryApp styles the scrolling artwork page and fixed right-side book tabs", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.rebreya-inventory-app\s+\.window-content\s*\{[\s\S]*overflow:\s*hidden;/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+112px;/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__page\s*\{[\s\S]*overflow-y:\s*auto;/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__header\s*\{[\s\S]*height:\s*300px;[\s\S]*rebreya-character-header\.webp/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__title\s*\{[\s\S]*font-family:\s*var\(--dnd5e-font-modesto\);[\s\S]*font-size:\s*36px;/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__tabs\s*\{[\s\S]*grid-auto-flow:\s*row;/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__tab\.is-active/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__tab:hover/u);
  assert.match(css, /\.rebreya-inventory-app\s+\.rm-inventory-book__tab:focus-visible/u);
});
```

- [ ] **Step 2: Run the CSS contract and verify RED**

Run:

```powershell
node --test --test-name-pattern="scrolling artwork page" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the new inventory-book selectors do not exist.

- [ ] **Step 3: Give the application a non-scrolling outer content surface**

Update the inventory application rules:

```css
.rebreya-inventory-app .window-content {
  overflow: hidden;
  padding: 0;
  background: transparent !important;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border-radius: var(--rm-radius-window);
}
```

Do not change `.window-content` for any other application.

- [ ] **Step 4: Style the outer stage and scrollable page**

Add inventory-scoped rules:

```css
.rebreya-inventory-app .rm-inventory-book {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
}

.rebreya-inventory-app .rm-inventory-book__page {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0;
  border: 1px solid var(--rm-border-subtle);
  border-radius: var(--rm-radius-window) 0 var(--rm-radius-window) var(--rm-radius-window);
  background: var(--rm-surface-window);
}

.rebreya-inventory-app .rm-inventory-book__content {
  display: grid;
  gap: 12px;
  padding: 0 14px 14px;
}
```

- [ ] **Step 5: Style the artwork header and title**

Add:

```css
.rebreya-inventory-app .rm-inventory-book__header {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  height: 300px;
  min-height: 300px;
  padding: 28px 30px;
  overflow: hidden;
  background-image: url("/modules/rebreya-main/assets/ui/rebreya-character-header.webp");
  background-position: center top;
  background-repeat: no-repeat;
  background-size: cover;
}

.rebreya-inventory-app .rm-inventory-book__header::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 44%;
  background: linear-gradient(180deg, transparent, var(--rm-surface-window));
  pointer-events: none;
}

.rebreya-inventory-app .rm-inventory-book__header-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgb(0 0 0 / 0.72), rgb(0 0 0 / 0.2) 55%, rgb(0 0 0 / 0.48));
  pointer-events: none;
}

.rebreya-inventory-app .rm-inventory-book__heading,
.rebreya-inventory-app .rm-inventory-book__actions {
  position: relative;
  z-index: 1;
}

.rebreya-inventory-app .rm-inventory-book__title {
  margin: 0;
  color: #d8dce2;
  font-family: var(--dnd5e-font-modesto);
  font-size: 36px;
  font-weight: 700;
  line-height: 0.94;
  text-shadow:
    0 1px 0 rgb(0 0 0 / 0.95),
    0 2px 3px rgb(0 0 0 / 0.86),
    0 0 10px rgb(0 0 0 / 0.62);
}
```

- [ ] **Step 6: Style each header action as its own compact container**

Add:

```css
.rebreya-inventory-app .rm-inventory-book__actions {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 8px;
}

.rebreya-inventory-app .rm-inventory-book__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid rgb(var(--rm-color-gold-rgb) / 0.58);
  border-radius: 8px;
  background: rgb(var(--rm-color-ink-rgb) / 0.82);
  color: var(--rm-text-primary);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.42);
}
```

Add matching `:hover` and `:focus-visible` rules using the existing gold border and a visible `2px` outline.

- [ ] **Step 7: Style the right-side tab rail**

Add:

```css
.rebreya-inventory-app .rm-inventory-book__tabs {
  align-self: start;
  display: grid;
  grid-auto-flow: row;
  gap: 7px;
  width: 112px;
  padding: 30px 0 20px;
}

.rebreya-inventory-app .rm-inventory-book__tab {
  position: relative;
  left: 0;
  width: 104px;
  min-height: 42px;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--rm-border-default);
  border-left: 0;
  border-radius: 0 9px 9px 0;
  background: linear-gradient(90deg, var(--rm-surface-1), var(--rm-surface-2));
  color: var(--rm-text-secondary);
  font-weight: 600;
  text-align: left;
  box-shadow: 4px 5px 12px rgb(0 0 0 / 0.32);
}

.rebreya-inventory-app .rm-inventory-book__tab:hover {
  width: 108px;
  border-color: var(--rm-border-strong);
  color: var(--rm-text-primary);
}

.rebreya-inventory-app .rm-inventory-book__tab:focus-visible {
  outline: 2px solid var(--rm-ui-active);
  outline-offset: 2px;
}

.rebreya-inventory-app .rm-inventory-book__tab.is-active {
  left: -8px;
  width: 112px;
  border-color: rgb(var(--rm-color-gold-rgb) / 0.76);
  background: linear-gradient(90deg, rgb(var(--rm-color-gold-rgb) / 0.30), var(--rm-surface-2));
  color: var(--rm-text-primary);
  font-weight: 700;
}
```

The tab rail must not receive `overflow-y: auto` or `position: sticky`; it remains fixed because only its sibling page scrolls.

- [ ] **Step 8: Add narrow-window containment rules**

At the existing inventory responsive section, add:

```css
@media (max-width: 1200px) {
  .rebreya-inventory-app .rm-inventory-book__title {
    font-size: 30px;
    white-space: normal;
  }

  .rebreya-inventory-app .rm-inventory-book__actions {
    flex-direction: column;
  }

  .rebreya-inventory-app .rm-inventory-book__action {
    width: 100%;
  }
}
```

Do not collapse or move the rail to the top.

- [ ] **Step 9: Run the CSS contract and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="scrolling artwork page" tests/inventory-app-context.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Run focused inventory regression tests**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Review and commit the visual CSS**

Run:

```powershell
git diff --check
git diff -- styles/main.css tests/inventory-app-context.test.mjs
git add -- styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: style party inventory book layout"
```

---

### Task 3: Foundry Browser QA And Visual Refinement

**Files:**
- Modify only if QA finds a defect: `tests/inventory-app-context.test.mjs`
- Modify only if QA finds a defect: `templates/inventory-app.hbs`
- Modify only if QA finds a defect: `styles/main.css`
- Store screenshots outside the repository.

**Interfaces:**
- Consumes: completed book layout from Tasks 1 and 2.
- Produces: browser-verified layout and any test-backed visual defect fixes.

- [ ] **Step 1: Define the target flow**

Use:

```text
Foundry loads → Codex profile opens → party inventory opens → artwork title and right-side tabs render → switching from Инвентарь to Группа changes the visible panel → scrolling moves the artwork while tabs remain fixed.
```

- [ ] **Step 2: Connect to Foundry through the in-app Browser**

Follow the Browser skill setup, name the browser session `rebreya-party-inventory-qa`, acquire the current Foundry tab, and navigate to the existing local Foundry URL if necessary.

Do not inspect browser cookies, profile files, local storage, or saved passwords. Use the visible login form and the user-supplied password `666` only when Foundry requests it.

- [ ] **Step 3: Open the party inventory**

Use the visible Rebreya inventory control or Foundry UI entry that calls `game.rebreyaMain.openInventoryApp()`.

If the control cannot be located semantically, use the browser's page evaluation only to call the already-exposed public module API:

```js
await game.rebreyaMain.openInventoryApp();
```

- [ ] **Step 4: Collect initial browser evidence**

Verify:

```text
Page identity: Foundry VTT world is loaded.
Not blank: canvas/sidebar and the party inventory window are present.
No framework overlay: no fatal Foundry or module error dialog is present.
Console health: no new relevant error or warning caused by the inventory render.
Screenshot: the complete default 1440 × 920 inventory window is visible.
```

Capture the screenshot outside the repository.

- [ ] **Step 5: Exercise the primary interaction**

Click the right-side `Группа` tab and verify:

- `.rm-inventory-book__tab[data-tab="party"]` gains `.is-active`;
- the inventory panel disappears;
- the party panel becomes visible;
- the page width does not change;
- the tab rail remains aligned with the right edge.

- [ ] **Step 6: Exercise scrolling**

Scroll `.rm-inventory-book__page` down far enough that `.rm-inventory-book__header` leaves the viewport.

Verify the bounding rectangle of `.rm-inventory-book__tabs` remains unchanged within a `1px` tolerance.

- [ ] **Step 7: Check resizing**

Resize the inventory window narrower while keeping it large enough for its controls. Verify:

- the rail remains `112px` wide;
- labels do not overlap the page;
- the title wraps or shrinks without colliding with header actions;
- no horizontal scroll trap appears.

- [ ] **Step 8: Fix each visual defect through TDD**

For every reproducible defect:

1. add a focused failing assertion to `tests/inventory-app-context.test.mjs`;
2. run it and observe the expected RED failure;
3. make the smallest template or CSS correction;
4. rerun it and observe GREEN;
5. repeat the browser interaction and capture fresh evidence.

Do not make untested visual corrections.

- [ ] **Step 9: Commit browser-driven refinements if any**

If files changed during QA:

```powershell
git diff --check
git add -- tests/inventory-app-context.test.mjs templates/inventory-app.hbs styles/main.css
git commit -m "fix: refine party inventory book layout"
```

If no files changed, do not create an empty commit.

---

### Task 4: Final Verification And Push

**Files:**
- Verify all modified files.
- Do not add generated reports or screenshots to the repository.

**Interfaces:**
- Consumes: all prior task commits.
- Produces: tested and pushed `lich_branch`.

- [ ] **Step 1: Inspect repository state and final diff**

Run:

```powershell
git status --short --branch
git diff --check
git diff origin/lich_branch...HEAD --stat
git diff origin/lich_branch...HEAD
```

Confirm only the approved spec, plan, tests, inventory application, template, and stylesheet changed.

- [ ] **Step 2: Run the full relevant automated suite**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/quest-log-ui.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 3: Confirm commit history and clean worktree**

Run:

```powershell
git status --short --branch
git log --oneline origin/lich_branch..HEAD
```

Expected: clean working tree and only meaningful task commits.

- [ ] **Step 4: Push without force**

Run:

```powershell
git push origin lich_branch
```

Do not use `--force` or `--force-with-lease`.

- [ ] **Step 5: Report QA evidence**

Report:

- user-visible changes;
- exact automated test command and pass count;
- Foundry URL and viewport used;
- browser page-identity, nonblank, overlay, console, screenshot, and interaction results;
- remaining untested risks;
- final commit hashes and push result.

Place final screenshots together at the end of the response.
