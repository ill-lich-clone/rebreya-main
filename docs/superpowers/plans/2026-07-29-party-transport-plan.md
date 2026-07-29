# Party Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add a party inventory `Транспорт` tab backed by transport stored on the group actor/token, and use the selected transport speed in travel calculations.

**Architecture:** `InventoryService` detects transport candidates from the group inventory first and compatible party actors second. `GroupContextService` owns the persisted `transportState`, while `TravelService` receives speed metadata from `InventoryService` through a provider instead of duplicating transport data.

**Tech Stack:** Foundry VTT module JavaScript, Handlebars templates, CSS, Node test runner.

## Global Constraints

- Work only on `lich_branch`.
- Do not commit or push to `main` or `master`.
- Keep the group actor inventory as the primary source for transport.
- Do not duplicate speed, cargo, or durability fields into travel state.

---

### Task 1: Transport State

**Files:**
- Modify: `scripts/data/group-context-service.js`
- Test: `tests/group-context-service.test.mjs`
- Test: `tests/group-command-dispatch.test.mjs`

**Interfaces:**
- Produces: `normalizeGroupTransportState(value): { activeTransportId: string }`
- Produces: `group.transport.replaceState` typed socket command.

- [x] **Step 1: Write failing tests** for default `transportState`, trimmed active ids, and command dispatch.
- [x] **Step 2: Run tests** and verify missing state/export failures.
- [x] **Step 3: Add normalizer and command registration.**
- [ ] **Step 4: Re-run group context and command tests.**

### Task 2: Transport Discovery

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Produces: `getTransportSnapshot({ partySnapshot, inventorySnapshot, transportState, context })`
- Produces: `getActiveTransportSpeedMeta({ context })`

- [x] **Step 1: Write failing context tests** for tab data and selection.
- [x] **Step 2: Detect transport in group actor inventory items first.**
- [x] **Step 3: Keep compatible actor/member transport detection.**
- [ ] **Step 4: Re-run inventory context tests.**

### Task 3: Inventory UI

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `moduleApi.getTransportSnapshot(options)`
- Consumes: `moduleApi.setActiveTransport(activeTransportId)`

- [x] **Step 1: Add tab context and click handler.**
- [x] **Step 2: Add Handlebars tab markup.**
- [ ] **Step 3: Add CSS for transport summaries and rows.**
- [ ] **Step 4: Re-run inventory UI tests.**

### Task 4: Travel Speed Integration

**Files:**
- Modify: `scripts/data/travel-service.js`
- Modify: `scripts/main.js`
- Test: `tests/travel-service.test.mjs`

**Interfaces:**
- Produces: `TravelService.setSpeedProvider(speedProvider)`

- [x] **Step 1: Write failing speed-provider test.**
- [x] **Step 2: Add provider resolution to travel snapshots and route recalculation.**
- [x] **Step 3: Wire provider from main module API to inventory service.**
- [ ] **Step 4: Re-run travel tests.**

### Task 5: Verification And Delivery

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run targeted Node tests.**
- [ ] **Step 2: Run available broader checks.**
- [ ] **Step 3: Inspect `git diff`.**
- [ ] **Step 4: Commit and push `lich_branch`.**
