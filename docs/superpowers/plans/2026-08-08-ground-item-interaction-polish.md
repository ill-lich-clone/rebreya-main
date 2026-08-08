# Ground Item Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct square-grid ground-drop range, resize single-item ground tokens, silence selection-only storage warnings, and add styled storage item-name tooltips.

**Architecture:** Reuse the existing square-cell distance primitive for point drops, classify ground-pile contents only at token creation, defer storage access validation to explicit pointer clicks, and attach the existing shared tooltip attributes directly in the storage template.

**Tech Stack:** Foundry VTT v13 JavaScript module, Handlebars, CSS, Node.js built-in test runner.

## Global Constraints

- A whole orthogonally or diagonally adjacent square counts as five feet.
- Non-square and gridless scenes keep Foundry native measurement.
- Only a newly created single ordinary-item pile with no coins uses `0.5 × 0.5`.
- Token control alone produces no access feedback.
- Storage tooltips use `rm-tooltip-anchor` and `data-rm-tooltip`, never native `title`.
- No live Foundry testing; the user validates the world manually.

---

### Task 1: Square-cell point distance

**Files:**
- Modify: `scripts/data/storage-access.js`
- Test: `tests/storage-access.test.mjs`

**Interfaces:**
- Produces: `measureStoragePointDistance(characterToken, point, { canvas }) -> number` using square-cell Chebyshev steps when possible.

- [ ] **Step 1: Add a failing adjacent-cell test**

Assert that points `{x: 199, y: 199}` and `{x: 101, y: 199}` measure five feet from a 1×1 character at `{x: 0, y: 0}`, while `{x: 200, y: 50}` measures ten feet on a 100px/5ft square grid.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-access.test.mjs`
Expected: the far corner of the adjacent cell returns more than five feet.

- [ ] **Step 3: Implement cell-based point measurement**

For each character footprint center, use `measureSquareGridSteps(from, point, sceneGrid)` before falling back to `measureGridDistance`.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/storage-access.test.mjs tests/storage-socket.test.mjs`
Expected: PASS.

### Task 2: Single-item ground-token size

**Files:**
- Modify: `scripts/data/storage-ground-pile-service.js`
- Test: `tests/storage-ground-pile-service.test.mjs`

**Interfaces:**
- Produces: newly created single ordinary-item piles centered at the request point with width/height `0.5`; multi-row, coin, and container snapshots retain preset size.

- [ ] **Step 1: Add failing size tests**

Assert a single sword created at `{x:300,y:400}` has `{width:0.5,height:0.5,x:275,y:375}`. Add snapshot assertions that two distinct rows, coins, and a row with `rowKind: "container"` remain `1 × 1`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-ground-pile-service.test.mjs`
Expected: single-item token remains `1 × 1`.

- [ ] **Step 3: Implement creation-time classification**

Use `rows.length === 1`, no positive coins, and `rows[0].rowKind !== "container"` to select size `0.5`; otherwise use the prototype width/height. Preserve point-centered coordinate calculation.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/storage-ground-pile-service.test.mjs`
Expected: PASS.

### Task 3: Explicit-click storage access

**Files:**
- Modify: `scripts/integrations/storage-token-hooks.js`
- Test: `tests/storage-token-hooks.test.mjs`

**Interfaces:**
- Produces: `controlToken` only binds the storage pointer handler; `pointertap` invokes `showTokenActions` and its access validation.

- [ ] **Step 1: Add a failing control-only test**

Trigger `controlToken(storageToken, true)` and assert `shown` and `feedback` stay empty. Then invoke the bound left `pointertap` and assert the expected actions or warning appears.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-token-hooks.test.mjs`
Expected: control immediately shows actions.

- [ ] **Step 3: Remove selection-side validation**

Keep `bindPointerClick(token)` in `controlToken`, but remove the direct `showTokenActions(token)` call. Update existing action tests to perform an explicit pointer tap.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/storage-token-hooks.test.mjs`
Expected: PASS.

### Task 4: Storage item-name tooltip and release

**Files:**
- Modify: `templates/storage-app.hbs`
- Test: `tests/storage-app.test.mjs`
- Modify: `module.json`
- Create: `scripts/main-1.4.133.js`
- Modify: `scripts/main.js`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/storage-main-registration.test.mjs`

**Interfaces:**
- Produces: item icon buttons with `class="rm-storage-item__icon rm-tooltip-anchor" data-rm-tooltip="{{name}}"`.
- Produces: Foundry module release `1.4.133` with fresh cache keys for modified storage modules.

- [ ] **Step 1: Add a failing tooltip template test**

Assert the item icon contains `rm-tooltip-anchor`, `data-rm-tooltip="{{name}}"`, and no `title` attribute.

- [ ] **Step 2: Run RED**

Run: `node --test tests/storage-app.test.mjs`
Expected: the styled tooltip attributes are absent.

- [ ] **Step 3: Add shared tooltip attributes**

Modify only the item icon button. Coins remain unchanged because the requested tooltip is an item name.

- [ ] **Step 4: Bump release and cache keys**

Set `module.json` to `1.4.133`, create `scripts/main-1.4.133.js` forwarding to `main.js?v=1.4.133-ground-item-polish`, and refresh imports for `storage-access.js`, `storage-ground-pile-service.js`, and `storage-token-hooks.js`.

- [ ] **Step 5: Run full verification**

Run: `node --test tests/*.test.mjs`
Expected: all tests pass. Then run `git diff --check`.

- [ ] **Step 6: Commit and push**

Commit as `fix: polish ground item interactions`, fetch and confirm the branch is not behind `origin/main`, then push `lich_branch` without force.
