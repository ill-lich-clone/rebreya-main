# Storage Adjacency and Character Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow diagonally adjacent players to open storage and drag storage rows directly onto owned character tokens.

**Architecture:** Keep distance normalization in `storage-access.js`, shared by local preflight and authoritative commands. Extend the existing canvas storage-row handler to resolve a character token at the drop point before falling back to the existing scene-ground transfer.

**Tech Stack:** Foundry VTT v13, JavaScript ES modules, Node.js test runner.

## Global Constraints

- Square-grid diagonal adjacency is one five-foot step.
- Non-square and gridless scenes retain Foundry path measurement.
- Character transfer uses the existing authoritative `claimStorageRow` command and OWNER validation.
- A drop without a character target retains ground-pile behavior.

---

### Task 1: Square-grid adjacency

**Files:**
- Modify: `scripts/data/storage-access.js`
- Test: `tests/storage-access.test.mjs`

**Interfaces:**
- Consumes: token documents and `canvas.scene.grid` metadata.
- Produces: unchanged `measureStorageTokenDistance(characterToken, storageToken, { canvas })` signature.

- [x] **Step 1: Write the failing diagonal test**

Add a square-grid case with one token at `(0, 0)` and another at `(100, 100)`, grid size `100`, grid distance `5`, and a Euclidean `measurePath` result. Assert `measureStorageTokenDistance(...) === 5`.

- [x] **Step 2: Run the test to verify RED**

Run: `node --test tests/storage-access.test.mjs`

Expected: FAIL with actual distance approximately `7.071`.

- [x] **Step 3: Implement square-grid footprint steps**

For square grids, convert every occupied cell center to integer grid coordinates and calculate the minimum Chebyshev step count:

```js
const columnSteps = Math.abs(left.column - right.column);
const rowSteps = Math.abs(left.row - right.row);
const distance = Math.max(columnSteps, rowSteps) * scene.grid.distance;
```

Use the existing Foundry measurement fallback when the scene grid is not square or required grid metadata is absent.

- [x] **Step 4: Run the distance tests to verify GREEN**

Run: `node --test tests/storage-access.test.mjs tests/storage-token-hooks.test.mjs tests/storage-socket.test.mjs`

Expected: all tests pass.

### Task 2: Storage row drop onto character token

**Files:**
- Modify: `scripts/integrations/storage-transfer-drop.js`
- Test: `tests/storage-transfer-drop.test.mjs`

**Interfaces:**
- Consumes: `canvas.tokens.placeables`, storage drag payload, canvas `x` and `y`.
- Produces: `transferStorageDropToCanvas` targeting either `character` or `scene` without changing its public signature.

- [x] **Step 1: Write the failing character-target test**

Create a canvas fixture with a visible character token whose document occupies the drop point. Drop a storage payload at that point and assert the API call uses:

```js
[tokenUuid, rowId, "character", mutationId, {
  quantity: 1,
  target: { actorUuid: "Actor.hero" }
}]
```

- [x] **Step 2: Run the test to verify RED**

Run: `node --test tests/storage-transfer-drop.test.mjs`

Expected: FAIL because the current call uses destination `scene`.

- [x] **Step 3: Add character token resolution**

Resolve the topmost visible character token containing the canvas point. If found, call existing `transferStorageDropToCharacter(token.actor, payload, moduleApi, { prompt })`; otherwise preserve the current scene transfer. Do not perform client-side ownership checks because the authoritative command already rejects unowned actors without consuming the row.

- [x] **Step 4: Run transfer tests to verify GREEN**

Run: `node --test tests/storage-transfer-drop.test.mjs tests/storage-socket.test.mjs`

Expected: all tests pass, including scene fallback.

### Task 3: Release graph and verification

**Files:**
- Modify: `module.json`
- Modify: `scripts/main.js`
- Create: `scripts/main-1.4.131.js`
- Test: `tests/module-manifest.test.mjs`
- Test: `tests/storage-main-registration.test.mjs`

**Interfaces:**
- Produces: Foundry module version `1.4.131` and fresh import URLs for changed modules.

- [x] **Step 1: Update release metadata and cache keys**

Set `module.json` version to `1.4.131`, load `scripts/main-1.4.131.js`, forward it to `main.js?v=1.4.131-storage-character-drop`, and update imports of `storage-access.js` and `storage-transfer-drop.js` to the same release key.

- [x] **Step 2: Update manifest assertions**

Change exact version, entrypoint, and cache-key expectations to `1.4.131`.

- [x] **Step 3: Run full verification**

Run: `node --test tests/*.test.mjs`

Expected: zero failures.

- [x] **Step 4: Commit and push**

```text
git commit -m "fix: support adjacent storage and character drops"
git push origin lich_branch
```
