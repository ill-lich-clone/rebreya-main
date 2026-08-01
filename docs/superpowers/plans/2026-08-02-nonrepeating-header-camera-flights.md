# Non-Repeating Header Camera Flights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obvious back-and-forth Inventory and Transport header motion with long, seamless camera-flight compositions that visibly pan and zoom without frequent repetition.

**Architecture:** Keep the existing animated `::before` artwork and `::after` atmosphere layers. Give each layer a closed multi-stop CSS keyframe route, and use coprime camera/atmosphere durations so the complete composition repeats only after 10–13 minutes without JavaScript state.

**Tech Stack:** CSS animations, Handlebars-rendered Foundry VTT UI, Node.js test runner, live Foundry browser QA.

## Global Constraints

- Work only on `lich_branch` and push without force.
- Preserve unrelated user changes if the working tree changes during implementation.
- Animate only `transform` and `opacity`; all translation values remain percentages.
- Keep horizontal camera positions inside `-2.5%` through `2.5%` and preserve the existing `inset: -2.5%` overscan.
- Inventory uses camera motion and warm glare only; it must not show steam or smoke.
- Transport uses camera motion, warm reflected glare, and drifting steam.
- Preserve the 300 px header, stacking order, clickability, Travel parallax, and `prefers-reduced-motion` behavior.

---

### Task 1: Protect the multi-stop closed-loop behavior

**Files:**
- Modify: `tests/inventory-header-motion.test.mjs`
- Modify: `styles/main.css:4334-4510`

**Interfaces:**
- Consumes: four existing CSS animation names and their Inventory/Transport header selectors.
- Produces: regression coverage for forward-only, multi-stop, seamless, independently timed animation loops.

- [ ] **Step 1: Write the failing behavior test**

Require camera declarations of `37s ease-in-out infinite` and `41s ease-in-out infinite` without `alternate`, and overlay declarations of `17s ease-in-out infinite` and `19s ease-in-out infinite`. Parse each keyframe block and require at least seven percentage stops for each camera and five for each overlay. Require identical transforms at `0%` and `100%`, plus identical overlay opacity at those endpoints. Require every camera to contain both a scale increase and a later decrease, proving that each route includes an approach and a pull-back.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs
```

Expected: FAIL because production CSS still uses 22/24/10/12-second `alternate` animations with two stops.

- [ ] **Step 3: Implement four closed CSS routes**

Replace each two-stop keyframe block with uneven percentage stops. Keep camera coordinates within the five-percentage-point range and close every route by repeating its initial transform at `100%`. Use a unique route for each tab. Set camera durations to 37 and 41 seconds and overlay durations to 17 and 19 seconds, with no `alternate` direction.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
```

Expected: all focused tests pass.

### Task 2: Verify motion and complete the branch

**Files:**
- No additional production files.
- Save screenshots only under `C:/Users/ill_lich/AppData/Local/Temp/`.

**Interfaces:**
- Consumes: live Foundry at `http://127.0.0.1:30000/`.
- Produces: rendered evidence and a pushed `lich_branch` commit.

- [ ] **Step 1: Verify Inventory in live Foundry**

Reload the player session, open Inventory, and sample computed transforms at the start, after two seconds, and across a later zoom segment. Confirm camera and glare move, the image fills the crop, controls remain clickable, and no steam is present.

- [ ] **Step 2: Verify Transport in live Foundry**

Open Transport and sample the same points. Confirm distinct camera motion, visible glare and steam, a framed locomotive, clickable controls, and no missing asset or module console error.

- [ ] **Step 3: Run full verification**

Run:

```powershell
node --test
git diff --check
git status --short
```

Expected: all tests pass, the diff has no whitespace errors, and only intended files are modified.

- [ ] **Step 4: Review, commit, and push**

Review the complete diff against the design, commit with `feat: vary header camera flights`, fetch `origin`, confirm `origin/lich_branch` is not ahead, and push normally to `origin/lich_branch`.
