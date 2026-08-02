# Token-Anchored Storage Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storage interaction spatially anchored to the scene token, generate player-first opens once through the active GM, play the supplied 10-foot positional sound, expose compact loot controls, and let GMs edit generated contents without revealing built-in loot types in token names.

**Architecture:** A reusable storage-access module supplies identical distance and visibility primitives to the client preflight and authoritative command service. A DOM overlay controller owns the token action bubble and feedback, while `StorageApp` performs one-time token-relative placement before becoming a normal draggable Foundry window. `StorageService` keeps generation single-flight and invokes a non-fatal generated-open callback that delegates native AmbientSound lifecycle to `StorageOpenSoundService` on the active GM.

**Tech Stack:** Foundry VTT v13 ApplicationV2 and embedded AmbientSound documents, vanilla ES modules, Handlebars, CSS, Node test runner.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Do not use force push.
- Keep the module independent of Item Piles, BG3 HUD, Sequencer, and other optional modules.
- Players may interact only through the active-GM authoritative storage command path.
- Player interaction range is five feet; the opening AmbientSound radius is ten scene distance units.
- Distant-click feedback text is `Подойдите ближе` and remains visible for exactly 2,000 ms.
- The supplied audio is copied from `D:/груз/0cab96e988b889b.mp3`, uses volume `0.8`, and its temporary AmbientSound is deleted after 1,250 ms.
- The compact application defaults to 430 px wide and at most `min(560px, viewport height - 32px)` high.
- Built-in Actor names remain descriptive; built-in prototype and default scene token names become `Сундук`.
- Preserve explicit GM token renames and all unrelated shared-worktree changes.

---

## File Map

- Create `scripts/data/storage-access.js`: shared token resolution, distance, visibility, and client-only preflight result.
- Create `scripts/ui/storage-token-overlay.js`: DOM bubble/feedback ownership, token-to-viewport geometry, lifecycle hooks, and cleanup.
- Create `scripts/data/storage-open-sound-service.js`: active-GM AmbientSound creation, timed removal, and stale cleanup.
- Modify `scripts/integrations/storage-token-hooks.js`: route token clicks through preflight and the overlay controller.
- Modify `scripts/data/storage-service.js`: generated-open callback and GM row mutation primitives.
- Modify `scripts/data/storage-command-service.js`: consume shared access helpers without weakening authoritative checks.
- Modify `scripts/data/builtin-storage-presets.js`: generic prototype token names.
- Modify `scripts/data/builtin-storage-actor-service.js`: prototype synchronization and conservative placed-token migration.
- Modify `scripts/ui/storage-app.js`: compact context, row editing, and initial token anchoring/detach.
- Modify `scripts/main.js`: compose new services, expose GM row APIs, pass anchor intent, and clean stale audio.
- Modify `templates/storage-app.hbs`: dense item rows, GM quantity/delete controls, and anchor pointer.
- Modify `styles/main.css`: token overlay, feedback, compact application, scroll region, and pointer styles.
- Add `assets/storage/sounds/chest-open.mp3`: supplied opening clip.
- Create `tests/storage-access.test.mjs`, `tests/storage-token-overlay.test.mjs`, and `tests/storage-open-sound-service.test.mjs`.
- Modify `tests/storage-token-hooks.test.mjs`, `tests/storage-service.test.mjs`, `tests/storage-socket.test.mjs`, `tests/storage-module-api.test.mjs`, `tests/storage-app.test.mjs`, `tests/builtin-storage-presets.test.mjs`, and `tests/builtin-storage-actor-service.test.mjs`.

---

### Task 1: Shared Storage Access and Token Overlay Geometry

**Files:**
- Create: `scripts/data/storage-access.js`
- Create: `scripts/ui/storage-token-overlay.js`
- Create: `tests/storage-access.test.mjs`
- Create: `tests/storage-token-overlay.test.mjs`
- Modify: `scripts/data/storage-command-service.js:1-15,119-149`
- Modify: `scripts/main.js:299-334,1100-1106`

**Interfaces:**
- Produces: `storageTokenDocument(token) -> TokenDocument|null`.
- Produces: `storageTokenCenter(token, { canvas } = {}) -> { x:number, y:number }`.
- Produces: `measureStorageTokenDistance(characterToken, storageToken, { canvas } = {}) -> number`.
- Produces: `isStorageTokenVisible(storageToken, { canvas } = {}) -> boolean`.
- Produces: `preflightStorageAccess(storageToken, { game, canvas } = {}) -> { allowed:boolean, reason:"ok"|"distance"|"character"|"scene"|"visibility", characterTokenUuid:string }`.
- Produces: `storageTokenViewportBounds(token, { canvas, window } = {}) -> { left:number, top:number, right:number, bottom:number, width:number, height:number }|null`.
- Produces: `placeTokenOverlay({ tokenBounds, overlaySize, viewport, gap = 10, margin = 8 }) -> { left:number, top:number, placement:"above"|"below", pointerLeft:number }`.
- Consumes: `StorageCommandService` keeps its injected `measureDistance` and `isVisibleTo` functions, now imported from `storage-access.js` by `main.js`.

- [ ] **Step 1: Write failing access and geometry tests**

```js
test("player preflight returns distance without authorizing an action", () => {
  const result = preflightStorageAccess(storageToken, { game, canvas: makeCanvas({ distance: 10 }) });
  assert.deepEqual(result, {
    allowed: false,
    reason: "distance",
    characterTokenUuid: "Scene.scene.Token.hero"
  });
});

test("overlay clamps horizontally and flips below a token near the top edge", () => {
  assert.deepEqual(placeTokenOverlay({
    tokenBounds: { left: 10, top: 4, right: 110, bottom: 104, width: 100, height: 100 },
    overlaySize: { width: 180, height: 40 },
    viewport: { width: 320, height: 240 }
  }), { left: 8, top: 114, placement: "below", pointerLeft: 52 });
});
```

- [ ] **Step 2: Run the focused tests and verify missing exports fail**

Run: `node --test tests/storage-access.test.mjs tests/storage-token-overlay.test.mjs`

Expected: FAIL because `storage-access.js` and `storage-token-overlay.js` do not exist.

- [ ] **Step 3: Implement shared access helpers and pure overlay placement**

```js
export const MAX_STORAGE_DISTANCE_FEET = 5;

export function preflightStorageAccess(storageToken, {
  game = globalThis.game,
  canvas = globalThis.canvas
} = {}) {
  if (game?.user?.isGM === true) return { allowed: true, reason: "ok", characterTokenUuid: "" };
  const characterToken = (canvas?.tokens?.controlled ?? [])
    .find((token) => token?.actor?.type === "character"
      && token.actor.testUserPermission?.(game?.user, "OWNER") === true);
  const characterTokenUuid = String(characterToken?.document?.uuid ?? characterToken?.uuid ?? "").trim();
  if (!characterToken) return { allowed: false, reason: "character", characterTokenUuid };
  if (storageTokenDocument(characterToken)?.parent?.id !== storageTokenDocument(storageToken)?.parent?.id) {
    return { allowed: false, reason: "scene", characterTokenUuid };
  }
  if (!isStorageTokenVisible(storageToken, { canvas })) {
    return { allowed: false, reason: "visibility", characterTokenUuid };
  }
  if (measureStorageTokenDistance(characterToken, storageToken, { canvas }) > MAX_STORAGE_DISTANCE_FEET) {
    return { allowed: false, reason: "distance", characterTokenUuid };
  }
  return { allowed: true, reason: "ok", characterTokenUuid };
}
```

Use `canvas.stage.worldTransform.apply` on the token world bounds and add the canvas element's `getBoundingClientRect()` offset. Clamp `left` to `[margin, viewport.width - overlay.width - margin]`; prefer `tokenBounds.top - gap - overlay.height`, and flip to `tokenBounds.bottom + gap` when the preferred top is less than `margin`.

- [ ] **Step 4: Replace duplicated access primitives in the composition root**

```js
import {
  isStorageTokenVisible,
  measureStorageTokenDistance
} from "./data/storage-access.js";

this.storageCommandService = new StorageCommandService({
  storageService: this.storageService,
  inventoryService: this.inventoryService,
  resolveToken: (uuid) => globalThis.fromUuid?.(uuid),
  measureDistance: (from, to) => measureStorageTokenDistance(from, to),
  isVisibleTo: (storageToken) => isStorageTokenVisible(storageToken)
});
```

Delete `storageTokenObject`, `storageTokenCenter`, `measureStorageTokenDistance`, and `isStorageTokenVisibleTo` from `scripts/main.js`. Keep `StorageCommandService.#resolveAccess` authoritative and retain its five-foot rejection.

- [ ] **Step 5: Run focused and authoritative access tests**

Run: `node --test tests/storage-access.test.mjs tests/storage-token-overlay.test.mjs tests/storage-socket.test.mjs`

Expected: PASS, including existing hidden-token, ownership, scene, and five-foot enforcement tests.

- [ ] **Step 6: Commit the shared access foundation**

```powershell
git add scripts/data/storage-access.js scripts/ui/storage-token-overlay.js scripts/data/storage-command-service.js scripts/main.js tests/storage-access.test.mjs tests/storage-token-overlay.test.mjs tests/storage-socket.test.mjs
git commit -m "feat: add storage token access geometry"
```

---

### Task 2: Token-Anchored Action Bubble and Distance Feedback

**Files:**
- Modify: `scripts/ui/storage-token-overlay.js`
- Modify: `scripts/integrations/storage-token-hooks.js`
- Modify: `styles/main.css:12561-12575`
- Modify: `tests/storage-token-overlay.test.mjs`
- Modify: `tests/storage-token-hooks.test.mjs`

**Interfaces:**
- Consumes: `preflightStorageAccess`, `storageTokenViewportBounds`, and `placeTokenOverlay` from Task 1.
- Produces: `StorageTokenOverlayController({ document, window, canvasProvider, setTimeout, clearTimeout, logger })`.
- Produces: `controller.showActions(token, actions)`, `controller.showFeedback(token, text, { durationMs = 2000 })`, `controller.reposition()`, and `controller.destroy()`.
- Produces: `registerStorageTokenHooks` option `overlayController`; production registration creates one default controller.
- Produces: every Open/Configure action calls `moduleApi.openStorageApp({ tokenUuid, configure, anchorToToken: true })`.

- [ ] **Step 1: Add failing controller lifecycle and hook tests**

```js
test("distance failure renders token-local feedback for two seconds without actions", () => {
  pointertap({ button: 0 });
  assert.equal(overlay.feedback[0].text, "Подойдите ближе");
  assert.equal(overlay.feedback[0].durationMs, 2000);
  assert.equal(overlay.actions.length, 0);
});

test("GM token actions remain available without a controlled character", () => {
  pointertap({ button: 0 });
  assert.deepEqual(overlay.actions[0].actions.map(({ id }) => id), ["open", "configure"]);
});
```

Also assert that outside pointerdown, Escape, `canvasReady`, `canvasTearDown`, `deleteToken`, and action completion remove the active DOM node; `canvasPan`, `updateToken`, and window resize call `reposition()`.

- [ ] **Step 2: Run focused tests and verify the old bottom menu fails expectations**

Run: `node --test tests/storage-token-overlay.test.mjs tests/storage-token-hooks.test.mjs`

Expected: FAIL because the old `defaultShowActions` owns a bottom-centered menu and has no preflight feedback.

- [ ] **Step 3: Implement the single overlay controller**

```js
showFeedback(token, text, { durationMs = 2000 } = {}) {
  this.#replaceNode(token, "rm-storage-token-feedback");
  this.node.textContent = text;
  this.feedbackTimer = this.setTimeout(() => this.close(), durationMs);
  this.reposition();
}

showActions(token, actions) {
  this.#replaceNode(token, "rm-storage-token-actions");
  for (const action of actions) this.node.append(this.#actionButton(action));
  this.reposition();
}
```

The controller stores only one active token and node, uses an `AbortController` for DOM listeners, subscribes to Foundry hooks passed by the integration, and removes every listener/timer in `destroy()`.

- [ ] **Step 4: Route left-clicks through local preflight**

```js
const showTokenActions = (token) => {
  const game = gameProvider();
  if (game?.user?.isGM === true) {
    overlay.showActions(token, buildStorageTokenActions(moduleApi, token, { isGM: true }));
    return;
  }
  const access = preflightStorageAccess(token, { game, canvas: canvasProvider() });
  if (access.reason === "distance") {
    overlay.showFeedback(token, "Подойдите ближе", { durationMs: 2000 });
    return;
  }
  if (!access.allowed) {
    notifyStoragePreflightFailure(access.reason);
    return;
  }
  overlay.showActions(token, buildStorageTokenActions(moduleApi, token, { isGM: false }));
};
```

Pass `anchorToToken: true` in both action callbacks. Do not remove the server-side open check.

- [ ] **Step 5: Replace bottom-HUD CSS with token bubble styles**

```css
.rm-storage-token-actions,
.rm-storage-token-feedback {
  position: fixed;
  z-index: 1100;
  transform-origin: center bottom;
  pointer-events: auto;
}

.rm-storage-token-actions::after,
.rm-storage-token-feedback::after {
  position: absolute;
  left: var(--rm-storage-pointer-left);
  width: 0.75rem;
  height: 0.75rem;
  content: "";
  transform: translateX(-50%) rotate(45deg);
}
```

Use `data-placement="above|below"` to put the pointer on the correct edge. Keep the bubble independent of BG3 HUD selectors.

- [ ] **Step 6: Run overlay tests and commit**

Run: `node --test tests/storage-access.test.mjs tests/storage-token-overlay.test.mjs tests/storage-token-hooks.test.mjs tests/storage-socket.test.mjs`

Expected: PASS.

```powershell
git add scripts/ui/storage-token-overlay.js scripts/integrations/storage-token-hooks.js styles/main.css tests/storage-token-overlay.test.mjs tests/storage-token-hooks.test.mjs
git commit -m "feat: anchor storage actions above tokens"
```

---

### Task 3: Single-Flight Open Callback and Native Positional Sound

**Files:**
- Create: `scripts/data/storage-open-sound-service.js`
- Create: `tests/storage-open-sound-service.test.mjs`
- Modify: `scripts/data/storage-service.js:142-229`
- Modify: `tests/storage-service.test.mjs`
- Add: `assets/storage/sounds/chest-open.mp3`

**Interfaces:**
- Produces: `StorageService({ generate, onGeneratedOpen = async () => {} })`.
- Produces callback payload: `{ token: TokenDocument, state: StorageTokenState, context: object }` after the opened state/texture write succeeds.
- Produces: `StorageOpenSoundService({ gameProvider, isActiveGm, audioHelper, setTimeout, logger })`.
- Produces: `playForToken(token) -> Promise<AmbientSoundDocument|null>` and `cleanupStale(scene) -> Promise<number>`.
- Uses flag: `flags.rebreya-main.temporaryStorageOpenSound = true`.

- [ ] **Step 1: Write failing single-flight callback tests**

```js
test("simultaneous first opens write and invoke the generated callback once", async () => {
  const opened = [];
  const service = new StorageService({
    generate: async () => ({ rows: [{ rowId: "generated" }], coins: {} }),
    onGeneratedOpen: async (payload) => opened.push(payload)
  });
  const [first, second] = await Promise.all([service.open(token), service.open(token)]);
  assert.equal(first.generatedNow, true);
  assert.equal(second.generatedNow, true);
  assert.equal(opened.length, 1);
  assert.equal(readStorageState(token).displayMode, "opened");
});

test("generated-open callback failure does not roll back opened storage", async () => {
  const service = new StorageService({ onGeneratedOpen: async () => { throw new Error("audio"); } });
  await service.open(token);
  assert.equal(readStorageState(token).state, "opened");
});
```

- [ ] **Step 2: Write failing AmbientSound lifecycle tests**

```js
test("opening sound is a temporary native 10-unit AmbientSound", async () => {
  await service.playForToken(token);
  assert.deepEqual(created[0], {
    x: 150,
    y: 250,
    path: "modules/rebreya-main/assets/storage/sounds/chest-open.mp3",
    radius: 10,
    repeat: false,
    volume: 0.8,
    easing: true,
    walls: true,
    hidden: false,
    flags: { "rebreya-main": { temporaryStorageOpenSound: true } }
  });
  timers.runAfter(1250);
  assert.deepEqual(deleted, ["sound-1"]);
});
```

Also test inactive GM returns `null`, preload/create/delete failures are logged and non-fatal, and `cleanupStale` deletes only flagged AmbientSound IDs.

- [ ] **Step 3: Run the focused tests and verify failures**

Run: `node --test tests/storage-service.test.mjs tests/storage-open-sound-service.test.mjs`

Expected: FAIL because the callback and sound service do not exist.

- [ ] **Step 4: Invoke the callback inside `#openOnce` after persistence**

```js
const next = await this.#write(token, {
  ...current,
  generatedRows: generated?.rows,
  generatedCoins: generated?.coins,
  state: "opened",
  displayMode: "opened"
});
try {
  await this.onGeneratedOpen({ token: resolveDocument(token), state: clone(next), context: clone(context) });
}
catch (error) {
  this.logger?.warn?.(`${MODULE_ID} | Storage opened callback failed.`, error);
}
```

Store `logger` in the constructor. Never invoke this callback when current state is `opened` or `empty`.

- [ ] **Step 5: Implement temporary native AmbientSound lifecycle**

```js
const [sound] = await scene.createEmbeddedDocuments("AmbientSound", [{
  x: center.x,
  y: center.y,
  path: STORAGE_OPEN_SOUND_PATH,
  radius: 10,
  repeat: false,
  volume: 0.8,
  easing: true,
  walls: true,
  hidden: false,
  flags: { [MODULE_ID]: { [TEMPORARY_SOUND_FLAG]: true } }
}]);
this.setTimeout(() => this.#delete(scene, sound?.id), 1250);
return sound ?? null;
```

Call `AudioHelper.preloadSound(STORAGE_OPEN_SOUND_PATH)` best-effort before creation. Resolve scene from `token.parent`; resolve coordinates with `storageTokenCenter`.

- [ ] **Step 6: Copy the supplied audio asset and verify its stream**

Run: `Copy-Item -LiteralPath 'D:\груз\0cab96e988b889b.mp3' -Destination 'assets\storage\sounds\chest-open.mp3'`

Run: `ffprobe -v error -show_entries stream=codec_name,channels,sample_rate -show_entries format=duration -of default=noprint_wrappers=1 'assets/storage/sounds/chest-open.mp3'`

Expected: MP3, mono, 44,100 Hz, duration `0.268` seconds when rounded to three decimals.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test tests/storage-service.test.mjs tests/storage-open-sound-service.test.mjs`

Expected: PASS.

```powershell
git add scripts/data/storage-service.js scripts/data/storage-open-sound-service.js tests/storage-service.test.mjs tests/storage-open-sound-service.test.mjs assets/storage/sounds/chest-open.mp3
git commit -m "feat: play positional sound on first storage open"
```

---

### Task 4: Compose Active-GM Sound and Player-First Opening

**Files:**
- Modify: `scripts/main.js:1089-1106,1539-1576,3030-3038,3226-3245`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`

**Interfaces:**
- Consumes: `StorageOpenSoundService.playForToken(token)` and `cleanupStale(scene)` from Task 3.
- Produces: `RebreyaMainModule.storageOpenSoundService`.
- Produces: `openStorageApp({ tokenUuid, configure = false, anchorToToken = false })`.
- Preserves: `openStorage(tokenUuid, request)` uses `STORAGE_OPEN_COMMAND` for non-active-GM clients.

- [ ] **Step 1: Add failing composition and player-first concurrency tests**

```js
test("player-first simultaneous opens share generation and one sound", async () => {
  const calls = [];
  storageService.onGeneratedOpen = async ({ token }) => calls.push(token.uuid);
  const request = { tokenUuid: storageToken.uuid, characterTokenUuid: characterToken.uuid };
  await Promise.all([
    commandService.open(request, { sender: player }),
    commandService.open(request, { sender: player })
  ]);
  assert.equal(generationCount, 1);
  assert.deepEqual(calls, [storageToken.uuid]);
});
```

Assert `openStorageApp({ anchorToToken: true })` forwards `{ configure, anchorToToken: true }` to `new StorageApp`, and a direct API call without that flag remains centered.

- [ ] **Step 2: Run focused tests and verify composition failures**

Run: `node --test tests/storage-socket.test.mjs tests/main-composition-root.test.mjs tests/storage-module-api.test.mjs`

Expected: FAIL because the sound service is not composed and the app does not receive anchor intent.

- [ ] **Step 3: Compose the sound callback and stale cleanup**

```js
this.storageOpenSoundService = new StorageOpenSoundService({
  gameProvider: () => globalThis.game,
  isActiveGm: isActiveGmClient
});
this.storageService = new StorageService({
  generate: (form, context) => this.generateStorageLoot(form, context),
  onGeneratedOpen: ({ token }) => this.storageOpenSoundService.playForToken(token)
});
```

In `initialize()`, after built-in storage restoration, call `await this.storageOpenSoundService.cleanupStale(globalThis.canvas?.scene)` inside its own `try/catch` warning block.

- [ ] **Step 4: Forward one-time token anchoring to `StorageApp`**

```js
async openStorageApp({ tokenUuid, configure = false, anchorToToken = false } = {}) {
  // existing authoritative configure/open operation
  const key = `${safeTokenUuid}:${configure ? "configure" : "open"}`;
  let app = this.storageApps.get(key);
  if (!app) {
    app = new StorageApp(this, safeTokenUuid, { configure, anchorToToken });
    this.storageApps.set(key, app);
  }
  else if (anchorToToken) {
    app.requestTokenAnchor?.();
  }
  await app.render({ force: true });
  bringAppToFront(app);
  return app;
}
```

The authoritative open completes before the app renders, preserving texture → sound → window ordering. Do not play sound in `openStorageApp`; only the single-flight callback owns it.

- [ ] **Step 5: Run socket/composition tests and commit**

Run: `node --test tests/storage-service.test.mjs tests/storage-open-sound-service.test.mjs tests/storage-socket.test.mjs tests/main-composition-root.test.mjs tests/storage-module-api.test.mjs`

Expected: PASS.

```powershell
git add scripts/main.js tests/storage-socket.test.mjs tests/main-composition-root.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: wire player-first storage opening"
```

---

### Task 5: GM Editing of Generated and Manual Rows

**Files:**
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/main.js:3089-3117,3162-3203`
- Modify: `tests/storage-service.test.mjs`
- Modify: `tests/storage-module-api.test.mjs`

**Interfaces:**
- Produces: `StorageService.updateRowQuantity(token, rowId, quantity) -> Promise<StorageTokenState>`.
- Produces: `StorageService.deleteRow(token, rowId) -> Promise<StorageTokenState>`.
- Produces: `RebreyaMainModule.updateStorageRowQuantity(tokenUuid, rowId, quantity)` and `deleteStorageRow(tokenUuid, rowId)`; both are GM-only.
- Row lookup uses exact stable `row.rowId` across `manualRows` and `generatedRows`; claimed rows and missing IDs reject.

- [ ] **Step 1: Add failing row mutation tests**

```js
test("GM quantity edit updates row and embedded item quantity", async () => {
  const next = await service.updateRowQuantity(token, "generated-1", 4);
  assert.equal(next.generatedRows[0].quantity, 4);
  assert.equal(next.generatedRows[0].itemData.system.quantity, 4);
});

test("deleting the final unclaimed row empties storage", async () => {
  const next = await service.deleteRow(token, "generated-1");
  assert.equal(next.state, "empty");
  assert.equal(next.displayMode, "empty");
  assert.equal(token.name, "Сундук (пусто)");
});
```

Also assert manual-row mutation, non-positive/fractional/NaN quantity rejection, claimed-row rejection, missing stable ID rejection, and remaining coins preserving `opened`.

- [ ] **Step 2: Run service/API tests and verify missing methods fail**

Run: `node --test tests/storage-service.test.mjs tests/storage-module-api.test.mjs`

Expected: FAIL because the generic row mutation methods do not exist.

- [ ] **Step 3: Implement stable row mutation and state recalculation**

```js
async updateRowQuantity(token, rowId, quantity) {
  const amount = Number(quantity);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Количество должно быть целым числом не меньше 1.");
  return this.#mutateEditableRow(token, rowId, (row) => {
    const next = clone(row);
    next.quantity = amount;
    next.itemData ??= {};
    next.itemData.system ??= {};
    next.itemData.system.quantity = amount;
    return next;
  });
}
```

`#mutateEditableRow` checks `claimedRowIds`, searches manual then generated rows by exact non-empty `rowId`, applies the mutation to one collection, recalculates content with `hasUnclaimedContent`, and writes `opened`/`empty` state plus matching display mode. If the token is still `unopened`, quantity edits preserve `unopened`; deleting its last pre-generation manual row also preserves `unopened`.

- [ ] **Step 4: Expose guarded GM module APIs**

```js
async updateStorageRowQuantity(tokenUuid, rowId, quantity) {
  if (!globalThis.game?.user?.isGM) throw new Error("Изменять предметы может только мастер.");
  const token = await this.#resolveStorageToken(tokenUuid);
  return this.storageService.updateRowQuantity(token, cleanSocketId(rowId), quantity);
}

async deleteStorageRow(tokenUuid, rowId) {
  if (!globalThis.game?.user?.isGM) throw new Error("Удалять предметы может только мастер.");
  const token = await this.#resolveStorageToken(tokenUuid);
  return this.storageService.deleteRow(token, cleanSocketId(rowId));
}
```

Replace `removeManualStorageItem` internals with a compatibility delegation to `deleteStorageRow` so existing callers do not break.

- [ ] **Step 5: Run service/API tests and commit**

Run: `node --test tests/storage-service.test.mjs tests/storage-module-api.test.mjs tests/storage-socket.test.mjs`

Expected: PASS.

```powershell
git add scripts/data/storage-service.js scripts/main.js tests/storage-service.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: edit generated storage contents"
```

---

### Task 6: Compact Token-Linked Storage Window

**Files:**
- Modify: `scripts/ui/storage-app.js`
- Modify: `templates/storage-app.hbs`
- Modify: `styles/main.css:12577-12757`
- Modify: `tests/storage-app.test.mjs`
- Modify: `tests/storage-token-overlay.test.mjs`

**Interfaces:**
- Consumes: `storageTokenViewportBounds` and `placeTokenOverlay` geometry from Task 1.
- Consumes: module APIs `updateStorageRowQuantity` and `deleteStorageRow` from Task 5.
- Produces: `StorageApp(moduleApi, tokenUuid, { configure, anchorToToken })`.
- Produces: `requestTokenAnchor()`, `repositionToToken()`, and detach-on-header-pointerdown behavior.
- Produces row actions: `storage-update-row` and `storage-delete-row`.

- [ ] **Step 1: Add failing context, action, and anchoring tests**

```js
test("storage app is compact and exposes GM row controls", async () => {
  assert.equal(StorageApp.DEFAULT_OPTIONS.position.width, 430);
  const context = await createApp().app._prepareContext();
  assert.equal(context.rows[0].canEdit, true);
  assert.match(template, /data-action="storage-update-row"/u);
  assert.match(template, /data-action="storage-delete-row"/u);
});

test("first token render anchors and header drag detaches", async () => {
  app.requestTokenAnchor();
  app._onRender({}, {});
  assert.deepEqual(app.positions.at(-1), { left: 120, top: 80 });
  listeners.pointerdown({ target: header });
  assert.equal(root.classList.contains("is-token-anchored"), false);
});
```

Assert players never receive edit controls, subsequent ordinary rerenders preserve a user-moved position, and `canvasPan` only repositions while anchored.

- [ ] **Step 2: Run focused tests and verify old 720×680/card UI fails**

Run: `node --test tests/storage-app.test.mjs tests/storage-token-overlay.test.mjs`

Expected: FAIL because the current app is 720×680, uses wide cards, and has no anchor lifecycle.

- [ ] **Step 3: Implement compact context and GM row actions**

```js
static DEFAULT_OPTIONS = {
  classes: ["rebreya-main", "rebreya-storage-app"],
  window: { title: "Хранилище", icon: "fa-solid fa-box-open", resizable: true },
  position: { width: 430, height: "auto" }
};

const rows = (this.snapshot?.rows ?? []).map((row) => ({
  ...clone(row),
  rowId: clean(row.rowId),
  quantity: Math.max(1, Number(row.quantity ?? row.itemData?.system?.quantity ?? 1)),
  canEdit: configurationEnabled
}));
```

For `storage-update-row`, read `control.closest("[data-storage-row]").querySelector("[data-storage-quantity]").value` and call `updateStorageRowQuantity`. For `storage-delete-row`, call `deleteStorageRow`. Refresh only after the mutation succeeds.

- [ ] **Step 4: Implement initial anchor and detach**

```js
requestTokenAnchor() {
  this.anchorRequested = true;
  this.anchorDetached = false;
}

async repositionToToken() {
  if (!this.anchorRequested || this.anchorDetached) return false;
  const token = await globalThis.fromUuid?.(this.tokenUuid);
  const root = getAppElement(this);
  const bounds = storageTokenViewportBounds(token?.object ?? token);
  if (!root || !bounds) return false;
  const placement = placeTokenOverlay({
    tokenBounds: bounds,
    overlaySize: root.getBoundingClientRect(),
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    gap: 14,
    margin: 16
  });
  this.setPosition({ left: placement.left, top: placement.top });
  root.classList.add("is-token-anchored");
  root.dataset.anchorPlacement = placement.placement;
  root.style.setProperty("--rm-storage-pointer-left", `${placement.pointerLeft}px`);
  return true;
}
```

After render, schedule one `requestAnimationFrame` measurement. A pointerdown on `.window-header` calls `#detachAnchor()`, removes pointer classes, and unsubscribes anchor-only canvas/update listeners. Override `close()` to abort all listeners before calling `super.close()`.

- [ ] **Step 5: Convert template and CSS to dense scrollable rows**

```hbs
<div class="rm-storage-list">
  {{#each rows}}
    <article class="rm-storage-item" data-storage-row data-row-id="{{rowId}}">
      <img src="{{img}}" alt="">
      <div class="rm-storage-item__body"><strong>{{name}}</strong><span>{{typeLabel}}</span></div>
      {{#if canEdit}}
        <input data-storage-quantity type="number" min="1" step="1" value="{{quantity}}">
        <button data-action="storage-update-row" data-row-id="{{rowId}}" title="Сохранить количество"><i class="fa-solid fa-check"></i></button>
        <button data-action="storage-delete-row" data-row-id="{{rowId}}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
      {{else}}
        <span>×{{quantity}}</span>
      {{/if}}
      <div class="rm-storage-item__actions">
        <button type="button" class="rm-button rm-button--primary" data-action="storage-claim-self" data-row-id="{{rowId}}">Себе</button>
        <button type="button" class="rm-button rm-button--secondary" data-action="storage-claim-party" data-row-id="{{rowId}}">В группу</button>
      </div>
    </article>
  {{/each}}
</div>
```

Retain the self/party button markup shown above. Set `.rm-storage-shell { max-height: min(560px, calc(100vh - 32px)); }`, `.rm-storage-list { overflow-y: auto; }`, and add `::before` pointer styles only while `.is-token-anchored` is present.

- [ ] **Step 6: Run UI tests and commit**

Run: `node --test tests/storage-app.test.mjs tests/storage-token-overlay.test.mjs tests/storage-module-api.test.mjs`

Expected: PASS.

```powershell
git add scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/storage-app.test.mjs tests/storage-token-overlay.test.mjs
git commit -m "feat: compact token-linked storage window"
```

---

### Task 7: Generic Built-In Token Names and Conservative Migration

**Files:**
- Modify: `scripts/data/builtin-storage-presets.js`
- Modify: `scripts/data/builtin-storage-actor-service.js`
- Modify: `tests/builtin-storage-presets.test.mjs`
- Modify: `tests/builtin-storage-actor-service.test.mjs`

**Interfaces:**
- Produces: `BUILTIN_STORAGE_TOKEN_NAME = "Сундук"`.
- `buildBuiltinStorageActorData` retains `data.name === preset.name` but sets `prototypeToken.name` and storage `baseName` to `Сундук`.
- `BuiltinStorageActorService.sync()` updates existing built-in prototypes and migrates only placed tokens whose current name exactly matches a built-in preset name.

- [ ] **Step 1: Add failing prototype and migration tests**

```js
test("built-in actors keep descriptive names but prototypes are generic", () => {
  const data = buildBuiltinStorageActorData(BUILTIN_STORAGE_PRESETS[0], "storage-folder");
  assert.equal(data.name, "Сундук — медные монеты");
  assert.equal(data.prototypeToken.name, "Сундук");
  assert.equal(data.prototypeToken.flags[MODULE_ID].storage.baseName, "Сундук");
});

test("sync migrates preset-named scene tokens and preserves custom names", async () => {
  await harness.service.sync();
  assert.equal(defaultToken.name, "Сундук");
  assert.equal(defaultToken.flags[MODULE_ID].storage.baseName, "Сундук");
  assert.equal(customToken.name, "Тайник капитана");
});
```

Also assert an existing actor's descriptive Actor name remains untouched while its prototype token name/baseName are corrected.

- [ ] **Step 2: Run built-in storage tests and verify failures**

Run: `node --test tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs`

Expected: FAIL because prototype names and base names are currently preset names and existing documents are skipped.

- [ ] **Step 3: Make new prototypes generic**

```js
export const BUILTIN_STORAGE_TOKEN_NAME = "Сундук";

function createPreset(id, name, openedFile) {
  return deepFreeze({
    id,
    name,
    textures,
    prototypeToken: {
      name: BUILTIN_STORAGE_TOKEN_NAME,
      actorLink: false,
      texture: { src: textures.unopened }
    }
  });
}
```

Build initial storage state with `baseName: BUILTIN_STORAGE_TOKEN_NAME`.

- [ ] **Step 4: Synchronize prototypes and conservatively migrate scene tokens**

```js
async #syncExistingActor(actor, preset) {
  const storage = buildStorageTokenState({
    ...actor.prototypeToken?.flags?.[MODULE_ID]?.storage,
    baseName: BUILTIN_STORAGE_TOKEN_NAME,
    textures: actor.prototypeToken?.flags?.[MODULE_ID]?.storage?.textures ?? preset.textures
  });
  await actor.update({
    "prototypeToken.name": BUILTIN_STORAGE_TOKEN_NAME,
    [`prototypeToken.flags.${MODULE_ID}.storage`]: storage
  });
}
```

Iterate `game.scenes.contents[].tokens.contents`. A token is eligible only when its `actorId` belongs to a built-in preset Actor and `String(token.name).trim() === preset.name`. Update eligible tokens with `name: BUILTIN_STORAGE_TOKEN_NAME` and a cloned storage flag whose `baseName` is generic. Do not update a token named anything else.

- [ ] **Step 5: Run built-in tests and commit**

Run: `node --test tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs tests/main-composition-root.test.mjs`

Expected: PASS.

```powershell
git add scripts/data/builtin-storage-presets.js scripts/data/builtin-storage-actor-service.js tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs
git commit -m "feat: hide built-in chest loot names"
```

---

### Task 8: Integrated Verification, Live Foundry Check, and Push

**Files:**
- Modify only files required by failures found in this verification task.
- Verify: `module.json`, all changed JS/MJS/JSON, all storage assets, and the active Foundry world.

**Interfaces:**
- Consumes the completed interaction bubble, active-GM open flow, AmbientSound lifecycle, compact app, GM mutations, and built-in migration.
- Produces a tested `lich_branch` pushed normally to `origin/lich_branch`.

- [ ] **Step 1: Run focused storage suite**

Run:

```powershell
node --test tests/storage-access.test.mjs tests/storage-token-overlay.test.mjs tests/storage-token-hooks.test.mjs tests/storage-service.test.mjs tests/storage-open-sound-service.test.mjs tests/storage-socket.test.mjs tests/storage-module-api.test.mjs tests/storage-app.test.mjs tests/builtin-storage-presets.test.mjs tests/builtin-storage-actor-service.test.mjs tests/main-composition-root.test.mjs tests/security.test.mjs
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run repository-wide static and automated checks**

Run:

```powershell
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -LiteralPath $file | ConvertFrom-Json | Out-Null }
node --test tests/*.test.mjs
```

Expected: every command exits zero.

- [ ] **Step 3: Review the final diff and asset inventory**

Run:

```powershell
git status --short --branch
git diff --stat origin/lich_branch...HEAD
git diff --name-status origin/lich_branch...HEAD
ffprobe -v error -show_entries stream=codec_name,channels,sample_rate -show_entries format=duration -of default=noprint_wrappers=1 assets/storage/sounds/chest-open.mp3
```

Expected: only planned storage files, documentation, tests, and the supplied MP3 are present; the audio remains mono MP3 at 44,100 Hz and about 0.268 seconds.

- [ ] **Step 4: Verify the complete scene interaction in live Foundry**

Open `https://vtt.rebreya.com/` with profile `кодекс`, enter password `666`, and use the active scene:

1. Reload the world as GM and confirm `Хранилища` contains three descriptive Actors whose prototype token name is `Сундук`.
2. Place a built-in chest and confirm its scene label is `Сундук`.
3. With BG3 HUD enabled, left-click the chest as GM and confirm Open/gear controls appear above it.
4. As a player farther than five feet, left-click and confirm `Подойдите ближе` appears on the token for two seconds with no Open button.
5. Move within five feet and open first as the player; confirm the active GM generates exactly one content set, the token texture changes first, the native positional sound plays from the chest with a 10-foot radius, and the compact window points to the chest.
6. Drag the compact window and confirm it detaches and remains freely movable.
7. Open GM configuration, change a generated row quantity, delete another generated/manual row, close, reopen, and confirm persistence.
8. Remove the final row/coins and confirm empty texture plus `Сундук (пусто)`.
9. Reset and open again; confirm one new generation and one new sound.

- [ ] **Step 5: Fix only reproducible verification failures, then repeat Steps 1-4**

For each failure, add or tighten the smallest focused regression test first, run it red, make the minimal fix, rerun it green, and commit only the exact affected files. For a detached-window regression, use:

```powershell
git add scripts/ui/storage-app.js tests/storage-app.test.mjs
git commit -m "fix: keep storage window detached after drag"
```

Do not absorb unrelated worktree changes into these fixes.

- [ ] **Step 6: Fetch and confirm the branch still contains current main**

Run:

```powershell
git fetch origin
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
```

Expected: working tree clean and the first count is `0`. If it is not `0`, stop before push and reconcile only after checking for conflicts and foreign changes.

- [ ] **Step 7: Push without force**

Run: `git push origin lich_branch`

Expected: `origin/lich_branch` advances to the verified local HEAD. Never use `--force` or `--force-with-lease`.
