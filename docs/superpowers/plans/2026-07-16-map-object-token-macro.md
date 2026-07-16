# Map Object Token Macro Implementation Plan

> **Required subskill:** Use `superpowers:subagent-driven-development` to execute this plan task by task, and use `superpowers:test-driven-development` for every behavior change.

**Goal:** Add a managed GM macro that opens a small object-stat form and places a transparent, unlinked object token with its own name, HP, AC, and damage threshold on the active scene.

**Architecture:** A focused data service owns validation, managed world-document synchronization, and Actor/Token payload construction. A separate Foundry integration owns the DialogV2 form and the temporary canvas placement interaction. `RebreyaMainModule` exposes one public entry point used by a managed world macro and synchronizes the supporting macro/template Actor only on the active GM client.

**Tech Stack:** Foundry VTT v13 document APIs, dnd5e ActorDelta token data, DialogV2, PIXI canvas events, Node.js built-in test runner.

## Global Constraints

- Work only on `lich_branch`; do not force-push and do not modify unrelated user changes.
- The user-visible macro is named `Создать объект на карте` and is available only to GMs by default.
- Exactly one managed NPC Actor template named `Rebreya: Объект карты` is synchronized in the world; placed tokens are unlinked and keep independent synthetic Actor data.
- The token texture is a module-owned fully transparent image. Token name and HP bar remain visible, sight is disabled, and disposition is neutral.
- The form fields are: name, HP, AC, damage threshold, and size. Defaults are `Объект`, `10`, `10`, `0`, and `1`.
- Limits are: name required; HP `1..1000000`; AC `0..100`; damage threshold `0..1000000`; size `0.25..20`, in `0.25` increments.
- After confirmation, the next left click on the active scene places one token. Escape or right click cancels and removes every temporary listener.
- Managed Actor, Macro, and token documents carry stable `rebreya-main` flags so synchronization is idempotent and ownership is explicit.
- The macro command calls the public module API; it must not duplicate implementation logic in the command string.

---

### Task 1: Build the object data service with managed world documents

**Files:**
- Create: `scripts/data/map-object-token-service.js`
- Create: `tests/map-object-token-service.test.mjs`
- Create: `assets/transparent-object-token.svg`

**Step 1: Write failing normalization and payload tests**

Add tests that import the service module and assert:

- omitted values normalize to the documented defaults;
- numeric strings normalize to numbers;
- empty names, out-of-range values, and sizes outside quarter-cell increments fail with clear errors;
- `buildMapObjectTemplateActorData()` produces a hidden/default-ownership `npc` Actor with the managed source flag and transparent prototype token defaults;
- `buildMapObjectTokenData()` produces an unlinked neutral token, uses the transparent texture, always displays name and HP bar, disables sight, stores HP/AC/damage threshold in `delta.system.attributes`, and carries the managed object flag;
- token coordinates center the requested token size on the supplied snapped point.

Run:

```powershell
node --test tests/map-object-token-service.test.mjs
```

Expected: FAIL because `scripts/data/map-object-token-service.js` does not exist.

**Step 2: Implement the pure data builders**

In `scripts/data/map-object-token-service.js`, export:

- `MAP_OBJECT_ACTOR_SOURCE_ID`;
- `MAP_OBJECT_MACRO_SOURCE_ID`;
- `MAP_OBJECT_MACRO_NAME`;
- `MAP_OBJECT_TEMPLATE_ACTOR_NAME`;
- `TRANSPARENT_OBJECT_TOKEN_PATH`;
- `normalizeMapObjectInput(raw)`;
- `buildMapObjectTemplateActorData()`;
- `buildMapObjectMacroData()`;
- `buildMapObjectTokenData({ actor, input, point, gridSize })`.

Use plain object payloads compatible with Foundry v13. Put HP at `delta.system.attributes.hp.value/max/temp/tempmax`, damage threshold at `delta.system.attributes.hp.dt`, and flat AC at `delta.system.attributes.ac.calc/flat`.

Add `assets/transparent-object-token.svg` as a valid empty SVG with no visible paint.

**Step 3: Write failing managed-sync and creation tests**

Use lightweight fake collections/documents to assert:

- a non-GM or non-active GM performs no writes;
- first active-GM sync creates exactly one Actor and one Macro;
- a second sync updates/reuses managed documents without creating duplicates;
- existing same-name user documents without the stable source flag are not adopted or overwritten;
- `createToken()` delegates to the scene embedded-document API with normalized payload data.

Run the focused test and confirm the new cases fail before service behavior exists.

**Step 4: Implement `MapObjectTokenService`**

Use injected providers for `game`, `Actor`, `Macro`, and `isActiveGmClient` so tests stay independent of Foundry globals. Implement:

- `syncManagedDocuments()`;
- `getManagedTemplateActor()`;
- `createToken(rawInput, { scene, point, gridSize })`.

Find managed documents only by the stable module source flag. Create or update only module-owned fields. Return the created/reused documents from sync for diagnostics.

**Step 5: Run focused tests**

```powershell
node --test tests/map-object-token-service.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add scripts/data/map-object-token-service.js tests/map-object-token-service.test.mjs assets/transparent-object-token.svg
git commit -m "feat: add map object token data service"
```

---

### Task 2: Add the dialog and one-click canvas placement flow

**Files:**
- Create: `scripts/integrations/map-object-token-macro.js`
- Create: `tests/map-object-token-macro.test.mjs`

**Step 1: Write failing dialog tests**

Assert that `promptMapObjectInput()`:

- opens DialogV2 with the five documented fields and defaults;
- returns normalized submitted form data;
- returns `null` when cancelled;
- reports validation failures without starting placement.

Use an injected DialogV2 fake and a tiny form/form-data stub instead of a browser DOM.

Run:

```powershell
node --test tests/map-object-token-macro.test.mjs
```

Expected: FAIL because the integration module does not exist.

**Step 2: Implement the DialogV2 form**

Export `promptMapObjectInput({ DialogV2, notifyError })`. Escape user-visible values in generated markup. Keep the callback responsible only for collecting raw values; use the Task 1 normalizer as the single validation source.

**Step 3: Write failing placement tests**

Assert that `waitForMapObjectPlacement()`:

- resolves the first primary-button stage event to a snapped scene point;
- resolves `null` on Escape;
- resolves `null` on right click;
- removes stage and document listeners on every completion path;
- never resolves more than once.

Assert that `runMapObjectTokenMacro()` rejects non-GM use, requires an active scene, chains prompt to placement to `service.createToken`, and sends a concise success/cancel/error notification.

**Step 4: Implement placement and the macro runner**

Export:

- `waitForMapObjectPlacement({ canvas, documentTarget })`;
- `runMapObjectTokenMacro({ service, game, canvas, DialogV2, documentTarget, notifications })`.

Read the stage pointer through the Foundry/PIXI event's local-position API, snap with `canvas.grid.getSnappedPoint()` when available, and use grid-size rounding as a fallback. Register temporary listeners only after the form succeeds, and always clean them in a single finalize function.

**Step 5: Run focused tests**

```powershell
node --test tests/map-object-token-macro.test.mjs tests/map-object-token-service.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add scripts/integrations/map-object-token-macro.js tests/map-object-token-macro.test.mjs
git commit -m "feat: add map object placement macro flow"
```

---

### Task 3: Wire the managed macro into the module and ship a new version

**Files:**
- Modify: `scripts/main.js`
- Delete: `scripts/main-1.4.96.js`
- Create: `scripts/main-1.4.97.js`
- Modify: `module.json`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/main-composition-root.test.mjs` if needed by existing composition assertions

**Step 1: Write failing composition/manifest assertions**

Add assertions that:

- the manifest version and active script are `1.4.97` and `scripts/main-1.4.97.js`;
- the composition root imports and constructs `MapObjectTokenService`;
- `RebreyaMainModule` exposes `createMapObjectToken()`;
- initialization attempts managed Actor/Macro synchronization without making non-active clients write.

Run the focused tests and confirm they fail against `1.4.96`.

**Step 2: Wire the service and public API**

In `scripts/main.js`:

- import `MapObjectTokenService`, `runMapObjectTokenMacro`, and the existing active-GM helper;
- construct `this.mapObjectTokenService` with Foundry providers;
- call `syncManagedDocuments()` during initialization inside its own guarded warning block;
- add `createMapObjectToken(options = {})` that delegates to `runMapObjectTokenMacro()` and returns its result.

The managed macro command from Task 1 must be exactly a small API call such as:

```js
await game.rebreyaMain?.createMapObjectToken?.();
```

**Step 3: Bump the module entry version**

Set `module.json` to `1.4.97`, replace the forwarder with `scripts/main-1.4.97.js`, and use a distinct cache-busting import query for the new feature.

**Step 4: Run focused and full checks**

```powershell
node --test tests/map-object-token-service.test.mjs tests/map-object-token-macro.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs
node --test tests/*.test.mjs
```

Expected: all tests PASS.

**Step 5: Live Foundry verification**

Restart the local Foundry world and verify through the in-app browser:

- `main-1.4.97.js` loads with no `rebreya-main` console error;
- the world Macros directory contains one `Создать объект на карте` macro and one hidden managed Actor exists;
- running the macro opens the five-field form;
- entering test values, confirming, and clicking the scene creates one transparent token whose name and HP bar are visible and whose synthetic Actor has the chosen HP, AC, and damage threshold;
- Escape and right click cancel placement without leaving a later click armed;
- running initialization again does not duplicate the managed Actor or Macro.

**Step 6: Inspect and commit integration**

```powershell
git diff --check
git diff --stat
git status --short
git add scripts/main.js scripts/main-1.4.96.js scripts/main-1.4.97.js module.json tests/module-manifest.test.mjs tests/main-composition-root.test.mjs
git commit -m "feat: ship transparent map object macro"
```

Only stage files that actually changed.

---

### Task 4: Final review and branch publication

**Files:**
- Review all changes from the branch merge base through `HEAD`.

**Step 1: Run branch-wide review**

Generate a review package from the merge base and dispatch the final code reviewer. Resolve every Critical or Important finding and rerun the covering focused tests.

**Step 2: Run final verification**

```powershell
git diff --check origin/main...HEAD
node --test tests/*.test.mjs
git status --short --branch
```

Confirm the worktree is clean, the branch is `lich_branch`, and it is not behind `origin/main`.

**Step 3: Push without force**

```powershell
git push origin lich_branch
```

Report the commit range, test count, and exact live verification performed.
