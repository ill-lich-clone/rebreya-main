# Storage Administration and Corpse Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить административное наполнение Storage, добавить ручное состояние поломки и смешанный Lootgen, убрать рамки piles и сделать распознавание трупов единым во всех runtime-маршрутах.

**Architecture:** Канонический `StorageService` остаётся владельцем persisted token/container state, а `StorageCommandService` — владельцем авторизации и транзакционного deposit. Новый небольшой corpse-target модуль устраняет browser ESM cache split; UI вызывает только существующий публичный module API. Sequencer-интеграция сохраняется как backward cleanup без создания новых эффектов.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript ESM, ApplicationV2/Handlebars, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-storage-administration-and-corpse-routing-design.md`

## Global Constraints

- Работать только в `lich_branch`; перед правками соблюдать Git-процесс из `AGENTS.md`.
- Storage schema остаётся version 1; отсутствующий `mixGeneratedLoot` нормализуется в `false`.
- Player gameplay deposit сохраняет открывающее поведение; административный intent принимается только от GM.
- Complete corpse marker `{version:1,status:"complete"}` разрешает уже материализованный труп без повторной проверки HP; живой нематериализованный NPC остаётся запрещён.
- Corpse materialization не запускает обычный Lootgen.
- Модульная версия результата — `1.4.195`, entrypoint — `scripts/main-1.4.195.js`.
- Каждый production change начинается с сфокусированного теста, который сначала падает по ожидаемой причине.

---

### Task 1: Единый corpse-target контракт

**Files:**
- Create: `scripts/data/storage-corpse-target.js`
- Modify: `scripts/data/corpse-storage-materializer.js`
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/data/storage-object-kind.js`
- Modify: `scripts/integrations/storage-token-hooks.js`
- Modify: `scripts/main.js`
- Test: `tests/corpse-storage-materializer.test.mjs`
- Test: `tests/storage-service.test.mjs`
- Test: `tests/storage-socket.test.mjs`
- Test: `tests/storage-token-hooks.test.mjs`
- Test: `tests/storage-module-api.test.mjs`
- Test: `tests/module-manifest.test.mjs`

**Interfaces:**
- Produces: `CORPSE_MATERIALIZATION_VERSION = 1`.
- Produces: `isDeadNpcStorageTarget(token) -> boolean` for strict live dead-NPC eligibility.
- Produces: `isMaterializedCorpseStorageState(state) -> boolean` for exact complete v1 markers.
- Produces: `isCorpseStorageTarget(token) -> boolean` for runtime access: strict dead NPC OR unmarked NPC with a complete persisted marker.
- Consumes: raw `flags.rebreya-main.storage` without importing `storage-service.js`, avoiding a dependency cycle.

- [ ] **Step 1: Write failing routing and cache-key tests**

Add behavior tests proving a materialized NPC with HP `7` is accepted by module snapshot/configuration, authoritative socket access, and token hooks, while an unmaterialized living NPC is rejected. Extend the manifest test with literal expected imports:

```js
const corpseTargetCacheKey = "storage-corpse-target.js?v=1.4.195-storage-corpse-target";
for (const source of [mainSource, storageServiceSource, storageCommandSource, materializerSource, storageTokenHooksSource]) {
  assert.equal(source.includes(corpseTargetCacheKey), true);
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/corpse-storage-materializer.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/storage-token-hooks.test.mjs tests/storage-module-api.test.mjs tests/module-manifest.test.mjs
```

Expected: FAIL because `storage-corpse-target.js` and materialized-positive-HP routing do not exist and imports still diverge.

- [ ] **Step 3: Implement the canonical predicate module and route every owner through it**

Create the lightweight module with this contract:

```js
import { MODULE_ID } from "../constants.js";

export const CORPSE_MATERIALIZATION_VERSION = 1;

export function isMaterializedCorpseStorageState(state) {
  return Number(state?.corpseMaterialization?.version) === CORPSE_MATERIALIZATION_VERSION
    && state?.corpseMaterialization?.status === "complete";
}

export function isDeadNpcStorageTarget(token) {
  const document = token?.document ?? token;
  const actor = document?.actor ?? token?.actor;
  const actorStorage = actor?.getFlag?.(MODULE_ID, "storage") ?? actor?.flags?.[MODULE_ID]?.storage;
  const hp = actor?.system?.attributes?.hp?.value;
  return actor?.type === "npc"
    && actorStorage?.enabled !== true
    && typeof hp === "number"
    && Number.isFinite(hp)
    && hp <= 0;
}

export function isCorpseStorageTarget(token) {
  if (isDeadNpcStorageTarget(token)) return true;
  const document = token?.document ?? token;
  const actor = document?.actor ?? token?.actor;
  const actorStorage = actor?.getFlag?.(MODULE_ID, "storage") ?? actor?.flags?.[MODULE_ID]?.storage;
  const storage = document?.getFlag?.(MODULE_ID, "storage") ?? document?.flags?.[MODULE_ID]?.storage;
  return actor?.type === "npc"
    && actorStorage?.enabled !== true
    && isMaterializedCorpseStorageState(storage);
}
```

Import this exact URL from all listed runtime owners:

```js
"./storage-corpse-target.js?v=1.4.195-storage-corpse-target"
```

Use the equivalent `./data/` or `../data/` relative prefix while retaining the identical query. Re-export old predicate symbols from `corpse-storage-materializer.js` and `storage-object-kind.js` only for compatibility; do not duplicate implementations. Use `isCorpseStorageTarget()` in main resolution, command access, and pointer binding; keep `isDeadNpcStorageTarget()` for pre-materialization and commit-time recheck.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS; the living NPC rejection tests remain green.

- [ ] **Step 5: Commit the corpse routing slice**

```powershell
git add -- scripts/data/storage-corpse-target.js scripts/data/corpse-storage-materializer.js scripts/data/storage-service.js scripts/data/storage-command-service.js scripts/data/storage-object-kind.js scripts/integrations/storage-token-hooks.js scripts/main.js tests/corpse-storage-materializer.test.mjs tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/storage-token-hooks.test.mjs tests/storage-module-api.test.mjs tests/module-manifest.test.mjs
git commit -m "fix: unify corpse storage target routing"
```

### Task 2: Mixed manual and generated first-open state

**Files:**
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/ui/storage-app.js`
- Modify: `templates/storage-app.hbs`
- Test: `tests/storage-service.test.mjs`
- Test: `tests/storage-app.test.mjs`
- Test: `tests/storage-module-api.test.mjs`

**Interfaces:**
- Produces state field: `mixGeneratedLoot:boolean`, normalized from exact `true`, default `false`.
- Extends `configureStorageToken(tokenUuid, config, request)` with optional `config.mixGeneratedLoot:boolean`.
- Extends GM snapshot/configuration projection with `mixGeneratedLoot:boolean`.

- [ ] **Step 1: Write failing state and first-open tests**

Add literal behavior cases:

```js
assert.equal(buildStorageTokenState({}).mixGeneratedLoot, false);
assert.equal(buildStorageTokenState({ mixGeneratedLoot: true }).mixGeneratedLoot, true);
```

Add three open tests: manual rows + default flag skips `generate` and returns only manual content with `generatedNow:false`; manual coins + `true` invokes `generate` exactly once and merges both balances; no manual content + default false still invokes the current default normalized Lootgen form exactly once.

Add UI/API tests proving the configuration checkbox reflects snapshot state and save sends:

```js
{
  baseName: "Сундук",
  templateId: "",
  mixGeneratedLoot: true
}
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/storage-service.test.mjs tests/storage-app.test.mjs tests/storage-module-api.test.mjs
```

Expected: FAIL because the state field, branch, projection, and checkbox are absent.

- [ ] **Step 3: Implement normalized state and first-open decision table**

Add to `buildStorageTokenState()`:

```js
mixGeneratedLoot: source.mixGeneratedLoot === true,
```

In `#openOnce()`, after corpse materialization returns `null`, calculate manual availability from unclaimed `manualRows` and unclaimed positive `manualCoins`. If manual content exists and `mixGeneratedLoot !== true`, do not call `generate`; persist empty generated rows/coins, transition to `opened`, and return `generatedNow:false`. Otherwise call the existing generator with `current.template?.form ?? normalizeLootgenForm({})`. Preserve single-flight and one-write behavior.

Expose the boolean from `getStorageSnapshot()`, accept only exact boolean config in `configureStorageToken()`, include it in `StorageApp._prepareContext()`, render:

```hbs
<label class="rm-storage-config__toggle">
  <input type="checkbox" name="mixGeneratedLoot" {{#if configuration.mixGeneratedLoot}}checked{{/if}}>
  <span>Подмешивать случайный лут</span>
</label>
```

Read `form.elements.mixGeneratedLoot.checked` on save.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS and generation call counts match the decision table.

- [ ] **Step 5: Commit the mixed-loot slice**

```powershell
git add -- scripts/data/storage-service.js scripts/main.js scripts/ui/storage-app.js templates/storage-app.hbs tests/storage-service.test.mjs tests/storage-app.test.mjs tests/storage-module-api.test.mjs
git commit -m "feat: configure mixed storage loot"
```

### Task 3: Authorized administrative deposit presentation

**Files:**
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/ui/storage-app.js`
- Test: `tests/storage-service.test.mjs`
- Test: `tests/storage-socket.test.mjs`
- Test: `tests/storage-app.test.mjs`

**Interfaces:**
- Extends deposit payload with optional exact `administrative:boolean`.
- Extends `depositStorageItem(..., request)` with `request.administrative === true`.
- Extends `StorageService.depositRow(token, row, {quantity, path, presentation = "gameplay"})`, where allowed presentation values are `"gameplay"` and `"administrative"`.

- [ ] **Step 1: Write failing deposit tests**

Add service table cases proving administrative deposit produces:

```js
[
  ["unopened", "unopened", "unopened"],
  ["empty", "unopened", "unopened"],
  ["opened", "opened", "opened"]
]
```

and existing gameplay deposit into empty remains `opened/opened`. Add nested unopened storage coverage. Add command tests proving a player payload with `administrative:true` is rejected before target mutation and a GM request passes `presentation:"administrative"`. Add StorageApp drop test proving configure mode sends `{administrative:true}` while ordinary mode omits it.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/storage-app.test.mjs
```

Expected: FAIL because deposit always writes `opened/opened` and the payload validator rejects or ignores administrative intent.

- [ ] **Step 3: Implement the authoritative presentation policy**

Allow `administrative` in `isValidStorageDepositPayload()`. In `StorageCommandService.deposit()` reject it unless `sender?.isGM === true`, then call:

```js
await this.storageService.depositRow(access.storageToken, source.row, {
  quantity,
  path,
  presentation: payload.administrative === true ? "administrative" : "gameplay"
});
```

In `depositRow()`, validate the presentation enum. Gameplay writes `opened/opened`. Administrative writes `opened/opened` only when the current scoped state is opened; otherwise it writes `unopened/unopened`. In `main.depositStorageItem()`, serialize the optional boolean. In `StorageApp.#onDrop()`, add `administrative:true` to the request only when `this.configure === true`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS, including rollback and nested-path regressions.

- [ ] **Step 5: Commit the administrative deposit slice**

```powershell
git add -- scripts/data/storage-service.js scripts/data/storage-command-service.js scripts/main.js scripts/ui/storage-app.js tests/storage-service.test.mjs tests/storage-socket.test.mjs tests/storage-app.test.mjs
git commit -m "fix: preserve storage state during admin deposits"
```

### Task 4: GM broken-state toggle for stored rows

**Files:**
- Modify: `scripts/data/durability-rules.js`
- Modify: `scripts/data/storage-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/ui/storage-app.js`
- Modify: `templates/storage-app.hbs`
- Modify: `styles/main.css`
- Test: `tests/durability-rules.test.mjs`
- Test: `tests/storage-service.test.mjs`
- Test: `tests/storage-module-api.test.mjs`
- Test: `tests/storage-app.test.mjs`

**Interfaces:**
- Produces: `markDurabilityIntact(flag) -> {outcome:"intact"|"ignored",nextFlag,appliedDamage:0}`.
- Produces: `StorageService.setRowBroken(token, rowId, broken, {path=[]}) -> storageState`.
- Produces public API: `setStorageRowBroken(tokenUuid, rowId, broken, request={})` restricted to GM.

- [ ] **Step 1: Write failing durability and UI/API tests**

Add a rules test that repairing a broken canonical flag preserves metadata and returns:

```js
{
  state: "intact",
  breakStage: 0,
  hp: { value: 5, max: 5 }
}
```

Add service tests proving `setRowBroken(..., true)` yields broken/1/0, false yields intact/0/max, only the selected detached row changes, and Journal/missing/ineligible/destroyed/malformed durability is rejected. Add API GM/player permission tests. Add UI context/template/action tests proving only an editable canonical intact/broken row exposes `Сломано`, checked for broken, and change calls the new API with exact nested path.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/durability-rules.test.mjs tests/storage-service.test.mjs tests/storage-module-api.test.mjs tests/storage-app.test.mjs
```

Expected: FAIL because repair transition, service mutation, public API, and checkbox do not exist.

- [ ] **Step 3: Implement canonical repair and stored-row mutation**

Implement `markDurabilityIntact()` beside `markDurabilityBroken()` by cloning the flag, requiring exact eligible non-destroyed durability and a positive finite `hp.max`, setting intact state/break stage/full HP, and preserving all other properties. `StorageService.setRowBroken()` validates exact boolean and a canonical `version:1`, `eligible !== false`, `state` in `intact|broken`, positive safe finite max; it applies `markDurabilityBroken()` or `markDurabilityIntact()` inside `#mutateEditableRow()`.

Add `RebreyaMainModule.setStorageRowBroken()` with the same GM guard/resolution/ground-pile refresh pattern as `updateStorageRowQuantity()`. In UI context calculate:

```js
const durability = row.itemData?.flags?.[MODULE_ID]?.durability;
const canToggleBroken = configurationEnabled
  && durability?.version === 1
  && durability?.eligible !== false
  && ["intact", "broken"].includes(clean(durability?.state))
  && Number.isFinite(Number(durability?.hp?.max))
  && Number(durability.hp.max) > 0;
```

Render a checked checkbox in the existing edit block and handle its `change` event by calling `setStorageRowBroken(tokenUuid,rowId,input.checked,#pathRequest())`, disabling it while awaited and refreshing only after success.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS and existing derived-name tests still prove ` (сломан)` is presentation-only.

- [ ] **Step 5: Commit the broken-toggle slice**

```powershell
git add -- scripts/data/durability-rules.js scripts/data/storage-service.js scripts/main.js scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/durability-rules.test.mjs tests/storage-service.test.mjs tests/storage-module-api.test.mjs tests/storage-app.test.mjs
git commit -m "feat: toggle stored item breakage"
```

### Task 5: Remove and reconcile ground-pile frames

**Files:**
- Modify: `scripts/integrations/storage-ground-pile-frame.js`
- Modify: `scripts/integrations/storage-token-hooks.js`
- Test: `tests/storage-ground-pile-frame.test.mjs`
- Test: `tests/storage-token-hooks.test.mjs`

**Interfaces:**
- Preserves `GroundPileFrameController.ensure(token) -> Promise<boolean>` for callers, but changes its effect from creation to cleanup.
- Cleanup targets both `rebreya-main.ground-pile-frame.<uuid>` and `rebreya-main.ground-pile-frame.v2.<uuid>`.

- [ ] **Step 1: Replace creation expectations with failing cleanup tests**

Assert that `ensure()` calls `endEffects()` once for each existing legacy/v2 name, never constructs `Sequence`, returns safely when Sequencer is inactive, and ignores non-ground-pile tokens. Extend hook tests so immediate registration/current canvas, `createToken`, `drawToken`, and `canvasReady` all invoke idempotent cleanup for recognized piles.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/storage-ground-pile-frame.test.mjs tests/storage-token-hooks.test.mjs
```

Expected: FAIL because current code constructs and plays a persistent Sequence and canvas startup does not reconcile piles.

- [ ] **Step 3: Convert the controller to cleanup-only behavior**

Remove geometry/shape/Sequence code. Keep active-GM, ground-pile, Sequencer-active, UUID, scene, and EffectManager guards. For each exact name, call `getEffects({name,sceneId})`; call `endEffects({name,sceneId})` only when at least one matching effect exists. Return true after a valid cleanup pass and false for guarded no-op/error.

In token hooks rename the local helper to `cleanupGroundPileFrame`, invoke it for the current `canvas.tokens.placeables` at registration and on `canvasReady`, and retain create/draw calls. Do not change token textures or standard Foundry selection borders.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS and no test observes a new Sequence play.

- [ ] **Step 5: Commit the frame cleanup slice**

```powershell
git add -- scripts/integrations/storage-ground-pile-frame.js scripts/integrations/storage-token-hooks.js tests/storage-ground-pile-frame.test.mjs tests/storage-token-hooks.test.mjs
git commit -m "fix: remove persistent ground pile frames"
```

### Task 6: Version, function passport, and complete verification

**Files:**
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Create: `scripts/main-1.4.195.js`
- Delete: none; historical forwarders remain tracked, but runtime configuration references only the new forwarder.
- Test: `tests/module-manifest.test.mjs`
- Test: `tests/storage-main-registration.test.mjs`

**Interfaces:**
- Manifest `version` becomes `1.4.195`.
- Manifest `esmodules` becomes exactly `["scripts/main-1.4.195.js"]`.
- Forwarder content is exactly `import "./main.js?v=1.4.195";` plus final newline.

- [ ] **Step 1: Write/update failing manifest and public-registration tests**

Update literal version expectations to `1.4.195`; assert the new public `setStorageRowBroken()` method is registered/exposed and the manifest points only to the new forwarder.

- [ ] **Step 2: Run release-focused tests and verify RED**

```powershell
node --test tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs
```

Expected: FAIL while manifest/forwarder/passport are still on `1.4.194` or registration is incomplete.

- [ ] **Step 3: Update release files and current-state passport**

Patch `module.json`, create the forwarder, and update Storage passport entries for:

- canonical corpse predicates and complete-marker resolution;
- `mixGeneratedLoot` normalization/first-open table;
- `depositRow(...,{presentation})` and GM-only administrative intent;
- `markDurabilityIntact()`, `setRowBroken()`, and `setStorageRowBroken()`;
- cleanup-only ground-pile frame lifecycle;
- focused tests and unchanged schema/version invariants.

Do not add historical prose to the passport.

- [ ] **Step 4: Run all focused Storage tests**

```powershell
node --test tests/durability-rules.test.mjs tests/corpse-storage-materializer.test.mjs tests/storage-service.test.mjs tests/storage-app.test.mjs tests/storage-module-api.test.mjs tests/storage-socket.test.mjs tests/storage-token-hooks.test.mjs tests/storage-ground-pile-frame.test.mjs tests/native-durability-hooks.test.mjs tests/module-manifest.test.mjs tests/storage-main-registration.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 5: Perform live Foundry verification when an authenticated test-world session is available**

Verify Foundry build 351/dnd5e 5.2.5: unopened admin drop remains closed; ordinary player deposit opens; manual-only and mixed first open; broken toggle and derived name; existing pile frames disappear; reported dead devil opens/configures. Inspect console for new exceptions. If the in-app browser is at `/join` without credentials, report live QA as unavailable and do not infer it from unit tests.

- [ ] **Step 6: Run the complete repository gate**

```powershell
node --test tests/*.test.mjs
git diff --check
$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }
$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: `0 failed`, every JavaScript file parses, every tracked JSON file parses, and `git diff --check` emits no errors.

- [ ] **Step 7: Review and commit only current-task files**

```powershell
git diff --check
git diff --stat
git diff
git status --short
git add -- docs/function-passport.md module.json scripts/main-1.4.195.js
git commit -m "release: ship storage administration fixes"
git push -u origin lich_branch
```

Confirm `origin/lich_branch` contains every task commit and the working tree is clean.
