# Bag of Holding Weightless Contents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly synced «Сумка хранения» ignore the weight of its contents while retaining its own 15-pound weight.

**Architecture:** Extend the existing special-case template in the managed magic-items compendium generator. Use dnd5e's native `weightlessContents` container property so the system remains responsible for inventory weight and capacity calculations.

**Tech Stack:** JavaScript ES modules, Foundry VTT 13, dnd5e, Node.js built-in test runner.

## Global Constraints

- Change only the managed compendium template; do not migrate actor-owned items.
- Keep the container capacity at 500 lb and 64 ft³.
- Use native dnd5e data fields; do not intercept inventory weight calculations.
- Preserve the existing `mgc` property.

---

### Task 1: Generate a native weightless «Сумка хранения»

**Files:**
- Modify: `tests/magic-items-compendium.test.mjs`
- Modify: `scripts/data/magic-items-compendium.js`

**Interfaces:**
- Consumes: `createMagicItemData(item, folderIdByPath, iconLookup)` and the existing `bagOfHolding` automation definition.
- Produces: a `container` item whose `system.weight` is `{ value: 15, units: "lb" }` and whose `system.properties` contains both `"mgc"` and `"weightlessContents"`.

- [ ] **Step 1: Write the failing test**

Extend the existing «Сумка хранения» assertions:

```js
assert.equal(hoardingPouch.type, "container");
assert.deepEqual(hoardingPouch.system.weight, { value: 15, units: "lb" });
assert.deepEqual(
  [...hoardingPouch.system.properties].sort(),
  ["mgc", "weightlessContents"]
);
assert.equal(hoardingPouch.system.capacity?.weight?.value, 500);
assert.equal(hoardingPouch.system.capacity?.volume?.value, 64);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --test tests/magic-items-compendium.test.mjs
```

Expected: FAIL because the generated bag currently weighs 0 and lacks `weightlessContents`.

- [ ] **Step 3: Write the minimal implementation**

In the existing `bagOfHolding` branch of `createMagicItemData`, set:

```js
systemData.weight = { value: 15, units: "lb" };
systemData.properties = ["mgc", "weightlessContents"];
```

Keep the existing capacity and `backpack` subtype assignments unchanged.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
node --test tests/magic-items-compendium.test.mjs
npm test
git diff --check
```

Expected: the focused suite passes; the full suite has no new failures. If the known Counterspell baseline failure remains, record it separately.

- [ ] **Step 5: Commit and push**

```powershell
git add -- scripts/data/magic-items-compendium.js tests/magic-items-compendium.test.mjs
git commit -m "fix: ignore bag of holding contents weight"
git push origin lich_branch
```
