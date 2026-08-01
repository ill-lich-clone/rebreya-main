# Visible Inventory and Transport Header Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Inventory and Transport header animations visibly move within two seconds at any window size while retaining smooth Victorian ambience.

**Architecture:** Keep the existing `::before` camera layer and `::after` atmosphere layer. Increase camera travel and zoom using percentage-only `translate3d()` values, then strengthen the Inventory glare and Transport glare/steam through opacity and percentage transforms only.

**Tech Stack:** Handlebars-rendered Foundry VTT UI, CSS animations, Node.js test runner, live Foundry browser QA.

## Global Constraints

- Work only on `lich_branch` and push without force.
- Preserve all user-owned uncommitted storage and loot generator work.
- Camera motion spans at most five percentage points and contains no pixel translations.
- Inventory uses camera motion and warm glare only; it must not show steam or smoke.
- Transport uses camera motion, warm reflected glare, and drifting steam.
- Continuous animation is limited to `transform` and `opacity`.
- Preserve the 300 px header, stacking order, clickability, Travel parallax, and `prefers-reduced-motion` behavior.

---

### Task 1: Specify visibly stronger relative motion

**Files:**
- Modify: `tests/inventory-header-motion.test.mjs`

**Interfaces:**
- Consumes: production CSS in `styles/main.css`.
- Produces: regression coverage for durations, percentage transforms, glare/steam layers, and reduced motion.

- [ ] **Step 1: Update the failing CSS behavior test**

Change the camera assertions to require `22s` for Inventory and `24s` for Transport. Require the following exact camera endpoints:

```css
@keyframes rm-inventory-header-camera {
  from { transform: translate3d(-2.5%, 1%, 0) scale(1.04); }
  to { transform: translate3d(2.5%, -1.5%, 0) scale(1.12); }
}

@keyframes rm-transport-header-camera {
  from { transform: translate3d(-3%, 0.8%, 0) scale(1.03); }
  to { transform: translate3d(2%, -1.2%, 0) scale(1.11); }
}
```

Assert that every header animation keyframe block contains no `px`, `filter`, `background-position`, or layout-property animation. Assert that Inventory's overlay background includes a `linear-gradient` glare and no steam-named animation, while Transport keeps radial steam gradients plus a linear glare.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="slow compositor-friendly" tests/inventory-header-motion.test.mjs
```

Expected: FAIL because production CSS still declares `42s`, `48s`, and the smaller transform ranges.

- [ ] **Step 3: Commit the test after GREEN with Task 2**

Do not commit a red test separately. Stage it together with the production CSS after Task 2 passes.

---

### Task 2: Implement visible camera, glare, and steam motion

**Files:**
- Modify: `styles/main.css:4334-4508`
- Test: `tests/inventory-header-motion.test.mjs`

**Interfaces:**
- Consumes: header modifiers `rm-inventory-book__header--inventory` and `rm-inventory-book__header--transport`.
- Produces: four CSS animations named `rm-inventory-header-camera`, `rm-transport-header-camera`, `rm-inventory-header-light`, and `rm-transport-header-steam`.

- [ ] **Step 1: Implement responsive overscan and camera durations**

Use `inset: -2.5%` for animated artwork overscan. Set Inventory camera duration to `22s` and Transport to `24s`, retaining `ease-in-out infinite alternate`.

- [ ] **Step 2: Strengthen the Inventory glare without steam**

Use one warm radial glow and one narrow diagonal linear highlight in `rm-inventory-book__header--inventory::after`. Animate it for `10s` between opacity `0.22` and `0.48` with `translate3d(-2.5%, 1%, 0)` to `translate3d(2.5%, -1%, 0)`.

- [ ] **Step 3: Strengthen Transport steam and reflected glare**

Keep the three soft radial steam gradients and add a narrow warm diagonal linear gradient. Animate the overlay for `12s` between opacity `0.18` and `0.42` with `translate3d(-2.5%, 1.5%, 0)` to `translate3d(2.5%, -2%, 0)`.

- [ ] **Step 4: Implement the exact camera keyframes**

Use the percentage-only endpoints specified in Task 1. Do not animate `filter`, `background-position`, masks, dimensions, positions, or inset.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Stage only the feature hunks and commit**

The working copy of `styles/main.css` contains user-owned storage styles below the header section. Build an index-only patch containing the header animation hunks, verify `git diff --cached`, and leave the storage hunk unstaged.

```powershell
git commit -m "feat: make inventory header motion visible"
```

---

### Task 3: Verify the rendered motion in live Foundry

**Files:**
- No tracked files.
- Save screenshots only under `C:/Users/ill_lich/AppData/Local/Temp/`.

**Interfaces:**
- Consumes: live Foundry at `http://127.0.0.1:30000/` and the player-facing Inventory application.
- Produces: browser evidence for both header modes.

- [ ] **Step 1: Reload the live player session**

Open Foundry as an available player, open Party Inventory, and reload after the CSS edit so Foundry revalidates `main.css`.

- [ ] **Step 2: Verify Inventory**

Confirm the header is 300 px tall, the `22s` camera and `10s` glare animations are running, and computed transforms change visibly over two seconds. Confirm the overlay contains no steam treatment and does not intercept pointer events.

- [ ] **Step 3: Verify Transport**

Switch through the visible Transport tab. Confirm the `24s` camera and `12s` steam/glare animations are running, transforms change visibly over two seconds, the locomotive stays framed, and controls remain clickable.

- [ ] **Step 4: Capture evidence and inspect errors**

Save one Inventory and one Transport screenshot outside the repository. Confirm no relevant `rebreya-main` console errors and no missing CSS or WebP responses.

- [ ] **Step 5: Run full verification and push**

Run:

```powershell
node --test
git diff --check origin/lich_branch...HEAD
git fetch origin
git push origin lich_branch
```

Expected: complete test suite passes, remote is not ahead, and normal push succeeds.
