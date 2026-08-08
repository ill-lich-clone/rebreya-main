# Storage Owned-Character Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storage access ignore selected map objects, use the nearest owned character, and deliver storage rows dropped on character tokens into their inventories.

**Architecture:** Centralize nearest-owned-character selection in `storage-access.js` and propagate its token UUID from the token action into `StorageApp` requests. Extend the document-level drop controller to resolve character tokens from real viewport coordinates so it intercepts the drop before Foundry creates a map object.

**Tech Stack:** Foundry VTT v13 JavaScript module, ApplicationV2, Node.js built-in test runner.

## Global Constraints

- Non-character canvas objects never participate in character selection.
- The nearest visible owned character on the storage scene wins; an eligible controlled character breaks equal-distance ties.
- GM-side commands remain authoritative for ownership, scene, visibility, and distance.
- A failed character drop must not remove the source storage row.
- Do not perform live Foundry tests; the user will verify in the running world.

---

### Task 1: Resolve and propagate the nearest owned character

**Files:**
- Modify: `scripts/data/storage-access.js`
- Modify: `scripts/integrations/storage-token-hooks.js`
- Test: `tests/storage-access.test.mjs`
- Test: `tests/storage-token-hooks.test.mjs`

**Interfaces:**
- Produces: `preflightStorageAccess(storageToken, { game, canvas }) -> { allowed, reason, characterTokenUuid }` using scene placeables rather than only controlled tokens.
- Produces: `buildStorageTokenActions(moduleApi, token, { isGM, characterTokenUuid })` forwarding the resolved UUID to `openStorageApp`.

- [ ] **Step 1: Write failing selection and action-propagation tests**

Add cases equivalent to:

```js
assert.equal(preflightStorageAccess(chest, {
  game: { user },
  canvas: { tokens: { controlled: [calendar], placeables: [calendar, fartherHero, nearerHero] } }
}).characterTokenUuid, nearerHero.document.uuid);

await shownActions[0].callback();
assert.equal(openCalls[0].characterTokenUuid, characterToken.document.uuid);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/storage-access.test.mjs tests/storage-token-hooks.test.mjs`
Expected: FAIL because preflight ignores `placeables` and the open action omits `characterTokenUuid`.

- [ ] **Step 3: Implement nearest eligible selection**

Build candidates from `canvas.tokens.placeables`, filter to visible owned characters on the storage scene, compute `measureStorageTokenDistance`, then sort by distance, controlled tie-break, and stable token id. Return the closest candidate within `MAX_STORAGE_DISTANCE_FEET`. Pass its UUID into the player open action:

```js
buildStorageTokenActions(moduleApi, token, {
  isGM: false,
  characterTokenUuid: access.characterTokenUuid
});
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/storage-access.test.mjs tests/storage-token-hooks.test.mjs`
Expected: PASS.

### Task 2: Preserve character identity through the storage window

**Files:**
- Modify: `scripts/main.js`
- Modify: `scripts/ui/storage-app.js`
- Test: `tests/storage-app.test.mjs`

**Interfaces:**
- Consumes: `openStorageApp({ tokenUuid, configure, anchorToToken, path, characterTokenUuid })`.
- Produces: `StorageApp` request options containing `characterTokenUuid` for open, claim, coin claim, and deposit operations.

- [ ] **Step 1: Write failing request-propagation tests**

Construct `StorageApp` with a resolved UUID, trigger representative claim and deposit actions, and assert:

```js
assert.equal(claimArgs.at(-1).characterTokenUuid, "Scene.scene.Token.hero");
assert.equal(depositArgs.at(-1).characterTokenUuid, "Scene.scene.Token.hero");
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/storage-app.test.mjs`
Expected: FAIL because `StorageApp` discards the character UUID.

- [ ] **Step 3: Store and include the UUID**

Accept `characterTokenUuid` in `openStorageApp`, send it to `openStorage`, pass it into the `StorageApp` constructor, and have the app merge it into its common request object:

```js
#pathRequest() {
  return {
    ...(this.path.length ? { path: [...this.path] } : {}),
    ...(this.characterTokenUuid ? { characterTokenUuid: this.characterTokenUuid } : {})
  };
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/storage-app.test.mjs tests/storage-token-hooks.test.mjs`
Expected: PASS.

### Task 3: Intercept storage-row drops on character tokens

**Files:**
- Modify: `scripts/integrations/storage-token-drop.js`
- Test: `tests/storage-token-drop.test.mjs`
- Modify: `module.json`

**Interfaces:**
- Consumes: parsed drag source `{ kind: "storage-row", tokenUuid, rowId, quantity, path? }`.
- Produces: `claimStorageRow(tokenUuid, rowId, "character", mutationId, { quantity, target, path, characterTokenUuid })` from a viewport-coordinate character drop.

- [ ] **Step 1: Write a failing viewport character-drop test**

Create a character token whose viewport bounds contain the event coordinates, drag a storage-row payload, and assert that the controller calls:

```js
moduleApi.claimStorageRow(
  "Scene.scene.Token.chest",
  "row-shovel",
  "character",
  "deposit-test",
  {
    quantity: 1,
    target: { actorUuid: "Actor.hero" },
    characterTokenUuid: "Scene.scene.Token.hero"
  }
);
```

Also assert propagation is stopped so the canvas hook cannot create a scene item.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/storage-token-drop.test.mjs`
Expected: FAIL because HTML drag hit-testing only recognizes storage tokens.

- [ ] **Step 3: Add character viewport targeting**

When the source kind is `storage-row`, search visible character placeables using `boundsProvider` and real `clientX/clientY`. Activate the character target immediately. On drop, prompt quantity and call `claimStorageRow` with destination `character`, actor UUID, and token UUID. Keep existing storage-target hold behavior and canvas fall-through when no character is under the pointer.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/storage-token-drop.test.mjs tests/storage-transfer-drop.test.mjs`
Expected: PASS.

- [ ] **Step 5: Bump module version and run full verification**

Increment the patch version in `module.json`, then run:

```text
npm test
git diff --check
```

Expected: all tests pass and the diff has no whitespace errors.

- [ ] **Step 6: Commit and push**

Commit with `fix: resolve player character storage drops`, confirm `lich_branch` is not behind `origin/main`, and push `lich_branch` without force.

