# Nausea And Paladin Smite Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply fixed Nausea 2 from any installed implant that still requires union, automate its roll penalties, and announce a successfully used paladin smite in chat.

**Architecture:** Extend the existing numeric status change builder so Nausea applies its rules through normal Active Effect changes. Let the implant service coordinate one shared Nausea status through the combat status service: it raises a weaker foreign value temporarily, leaves an equal or stronger value untouched, and restores only state it changed. Add the paladin message only after the smite has successfully added damage and spent its spell slot.

**Tech Stack:** Foundry VTT Active Effects, dnd5e 5.x actor data, ES modules, Node.js test runner.

## Global Constraints

- Work only on `lich_branch`.
- Do not change unrelated implant automation.
- Nausea from implants is fixed at 2 and does not stack by implant count.
- Do not automate voluntary swallowing restrictions or Nausea recovery actions in this change.
- A cancelled or failed paladin smite must not create a chat message.
- Keep the user-owned `Trace-20260724T044510.json` untouched.

---

### Task 1: Numeric Nausea Penalties

**Files:**
- Modify: `scripts/combat/status-service.js`
- Test: `tests/combat-status.test.mjs`

**Interfaces:**
- Consumes: `buildDynamicStatusChanges(definition, value)` and the existing numeric `rebreya-nauseated` status definition.
- Produces: Active Effect changes of `-value` for all attack bonuses, all saving throws, and spell save DC.

- [x] **Step 1: Write the failing test**

Add a test that applies `rebreya-nauseated` with value `2` and asserts these additive changes:

```js
[
  ["system.bonuses.mwak.attack", "-2"],
  ["system.bonuses.rwak.attack", "-2"],
  ["system.bonuses.msak.attack", "-2"],
  ["system.bonuses.rsak.attack", "-2"],
  ["system.bonuses.abilities.save", "-2"],
  ["system.bonuses.spell.dc", "-2"]
]
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/combat-status.test.mjs`

Expected: FAIL because Nausea currently has no dynamic Active Effect changes.

- [x] **Step 3: Add the minimal dynamic change builder**

Define a Nausea key list and return additive `-value` changes when `definition.key === "nauseated"`. Preserve the existing Frightened behavior.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/combat-status.test.mjs`

Expected: PASS.

### Task 2: Fixed Nausea 2 From Ununited Implants

**Files:**
- Modify: `scripts/data/implant-service.js`
- Modify: `scripts/main.js`
- Test: `tests/implant-service.test.mjs`

**Interfaces:**
- Consumes: planned implant entries with `compatibility.requiresUnion`, `state.installed`, and `state.united`.
- Produces: one shared `rebreya-nauseated` status with a minimum value of `2` while at least one qualifying implant exists, without overwriting an equal or stronger foreign source.

- [x] **Step 1: Write the failing tests**

Cover these transitions:

```js
// One or more installed implants without required union:
assert.equal(statusService.getStatus(actor, "rebreya-nauseated").value, 2);

// Union or removal of the last qualifying implant restores the foreign source:
assert.equal(statusService.getStatus(actor, "rebreya-nauseated").value, previousValue);
```

Also verify two qualifying implants still produce value `2`, not `4`.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/implant-service.test.mjs`

Expected: FAIL because the aggregate implant effect currently has no statuses.

- [x] **Step 3: Synchronize nausea through the combat status service**

Detect whether at least one installed implant still requires union. When true, create Nausea 2 only if absent or temporarily raise a weaker status while remembering its value and metadata. When false, clear an implant-created status or restore the remembered foreign status. Leave equal or stronger foreign Nausea untouched.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/implant-service.test.mjs`

Expected: PASS.

### Task 3: Paladin Smite Chat Message

**Files:**
- Modify: `scripts/combat/paladin-automation-service.js`
- Test: `tests/paladin-automation-service.test.mjs`

**Interfaces:**
- Consumes: the final `#divineSmiteLabel(slotLevel, selectedVariants)` after successful damage configuration and spell-slot spending.
- Produces: one `ChatMessage.create` call using the paladin actor as speaker and the selected smite label as visible flavor.

- [x] **Step 1: Write the failing tests**

Extend the successful smite test to capture chat messages and assert one message contains:

```text
Божественная кара (1 ур.): Небесная кара
```

Add or extend a cancelled/failed smite case to assert that no message is created.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/paladin-automation-service.test.mjs`

Expected: FAIL because successful smites currently do not create a general chat announcement.

- [x] **Step 3: Create the message after successful application**

Store the smite label once, use it for damage configuration, then call `ChatMessage.create` only after slot spending succeeds. Use `speakerForActor(actor)` and escape visible actor/smite text.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/paladin-automation-service.test.mjs`

Expected: PASS.

### Task 4: Verification And Delivery

**Files:**
- Review: all files changed by Tasks 1–3.

**Interfaces:**
- Consumes: completed Nausea, implant, and smite implementations.
- Produces: one reviewed commit pushed to `origin/lich_branch`.

- [x] **Step 1: Run focused tests together**

Run:

```powershell
node --test tests/combat-status.test.mjs tests/implant-service.test.mjs tests/paladin-automation-service.test.mjs
```

Expected: PASS.

- [x] **Step 2: Run available repository checks**

Run the project test command from `package.json`. If the known unrelated baseline failures remain, confirm no new failures were introduced.

- [x] **Step 3: Review changes**

Run:

```powershell
git diff --check
git diff --stat
git diff
git status --short
```

Confirm only the planned code, tests, and this plan are changed.

- [x] **Step 4: Commit and push**

Run:

```powershell
git add docs/superpowers/plans/2026-07-26-nausea-and-paladin-smite-chat.md scripts/combat/status-service.js scripts/data/implant-service.js scripts/combat/paladin-automation-service.js tests/combat-status.test.mjs tests/implant-service.test.mjs tests/paladin-automation-service.test.mjs
git commit -m "feat: automate nausea and announce paladin smites"
git push origin lich_branch
```

Expected: push succeeds without force.
