# Door Trigger Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать дверям Foundry VTT 13 настраиваемые замки и ловушки через общий движок триггеров Rebreya, сохранив штатное управление дверями и существующее поведение хранилищ.

**Architecture:** `WallDocument` получает собственный versioned flag и отдельный authoritative command service, а общий `TriggerTargetCoordinator` связывает нейтральный trigger engine с storage/door persistence adapters. Canvas-интеграция один раз подменяет текущий `CONFIG.Canvas.doorControlClass` наследником: enabled закрытая дверь показывает одно действие «Открыть», обычный ПКМ сохраняет native поведение, а GM `Ctrl+ПКМ` открывает общий редактор для exact Wall.

**Tech Stack:** Foundry VTT 13 build 351, dnd5e 5.2.5, JavaScript ES modules, ApplicationV2/Handlebars, Foundry typed socket commands, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-door-trigger-target-design.md`

## Global Constraints

- Реализовать только двери как trigger targets; они не становятся loot storage и не получают rows, coins, generation или claim API.
- Door events строго `beforeOpen` и `afterOpen`; storage продолжает поддерживать `beforeOpen`, `afterOpen`, `afterClaim`, `emptied`.
- GM `Ctrl + ПКМ` открывает конфигурацию exact Wall; обычный ПКМ остаётся native `CLOSED ↔ LOCKED`; enabled `CLOSED`/`LOCKED` ЛКМ показывает overlay с единственной кнопкой `Открыть`; `OPEN` ЛКМ остаётся native close.
- Для gameplay-open игрок и GM обязаны передать controlled owned character token той же сцены; authoritative дистанция — не более `10 ft` от footprint персонажа до ближайшей точки wall segment.
- Secret doors не доступны игрокам; exact live wall, scene, sender ownership, controlled state и distance перепроверяются active GM.
- `LOCKED` без active supported `beforeOpen` chain не открывается; `LOCKED` с такой цепочкой открывается только после terminal allow; `CLOSED` без цепочки открывается штатно.
- Door commands: `door.open`, `door.triggers.read`, `door.triggers.save`, `door.triggers.reset`; mutating commands используют stable operation/mutation ID, exact payload fingerprint, per-wall queue и durable trigger receipts.
- Persisted flag: `flags.rebreya-main.doorTriggerTarget = {version:1, enabled, triggers}`; `enabled:false` сохраняет definitions/runtime; unconfigured doors не получают eager flags.
- Ошибка `afterOpen` после committed wall update логируется и не закрывает дверь; retry не повторяет wall update, trap, damage, sound или chat side effects.
- UI не пишет flags напрямую; все privileged mutations идут через active-GM typed commands.
- При client-visible изменениях поднять `module.json` с `1.4.196` до `1.4.197`, создать `scripts/main-1.4.197.js`, обновить `esmodules` и cache keys затронутых dynamic/static imports.
- Новые и изменённые методы документировать в `docs/function-passport.md`; публичный API документировать в `README.md`.
- Работать только в `lich_branch`, не использовать `git add -A`, перед каждым task review проверять чужие изменения, после полной проверки commit и push без force.
- Live QA выполнять только в уже аутентифицированной Foundry-сессии; не обходить `/join`, пароли и permission checks.

## File Structure

### New files

- `scripts/data/door-trigger-target.js` — schema/normalization и единственный persistence owner флага двери.
- `scripts/data/door-access.js` — pure geometry и client-side access preflight для exact wall.
- `scripts/application/trigger-target-coordinator.js` — нейтральный dispatch read/save/reset/execute по target kind.
- `scripts/data/storage-trigger-target-adapter.js` — adapter существующего `StorageService` к coordinator без второго storage owner.
- `scripts/data/door-trigger-target-adapter.js` — adapter door repository к coordinator.
- `scripts/application/door-trigger-command-service.js` — validators, GM configuration commands и authoritative open transaction.
- `scripts/ui/door-trigger-overlay.js` — anchored one-button overlay и compact feedback для DoorControl.
- `scripts/integrations/door-trigger-hooks.js` — idempotent subclass текущего `CONFIG.Canvas.doorControlClass`.
- `tests/door-trigger-target.test.mjs` — door flag schema, save/reset и event restrictions.
- `tests/door-access.test.mjs` — segment geometry и preflight.
- `tests/trigger-target-coordinator.test.mjs` — adapter dispatch, persistence injection и storage compatibility.
- `tests/door-trigger-command-service.test.mjs` — validation, authorization, locked rules, transaction/idempotency.
- `tests/door-trigger-hooks.test.mjs` — LMB/RMB/Ctrl+RMB routing and inheritance.
- `tests/door-trigger-overlay.test.mjs` — exact one-button presentation and anchoring.

### Modified files

- `scripts/data/storage-trigger-service.js` — разрешить coordinator передавать target-specific runtime persistence в execution context, сохранив прежний constructor fallback.
- `scripts/data/storage-command-service.js` — исполнять storage triggers через coordinator adapter; storage contract остаётся прежним.
- `scripts/ui/storage-trigger-editor.js` — превратить storage-specific transport в target descriptor callbacks при сохранении export `StorageTriggerEditor`.
- `templates/storage-trigger-editor.hbs` — нейтральный heading, доступные event tabs и door-only enabled toggle.
- `styles/main.css` — стили enabled toggle и door overlay; не менять storage layout.
- `scripts/main.js` — composition, typed routes, public API, editor instances и hook registration.
- `scripts/main-1.4.197.js` — versioned forwarder, содержащий только `import "./main.js";`.
- `module.json` — version/entrypoint `1.4.197`.
- `tests/storage-trigger-service.test.mjs`, `tests/storage-socket.test.mjs`, `tests/storage-trigger-editor.test.mjs`, `tests/storage-main-registration.test.mjs`, `tests/module-manifest.test.mjs`, `tests/security.test.mjs` — regression/contracts/registration/cache checks.
- `README.md`, `docs/function-passport.md` — public surface, owner/data flow/constraints/focused tests.

---

### Task 1: Door State Owner and Segment Access

**Files:**
- Create: `scripts/data/door-trigger-target.js`
- Create: `scripts/data/door-access.js`
- Create: `tests/door-trigger-target.test.mjs`
- Create: `tests/door-access.test.mjs`
- Modify: `docs/function-passport.md`
- Read narrowly: `scripts/data/storage-trigger-service.js`, `scripts/data/storage-access.js`

**Interfaces:**
- Consumes: `createEmptyStorageTriggerState()`, `normalizeStorageTriggerState(value)`, `validateStorageTriggerDefinitions(value)` from `scripts/data/storage-trigger-service.js`.
- Produces: `DOOR_TRIGGER_EVENTS = Object.freeze(["beforeOpen", "afterOpen"])`; `createEmptyDoorTriggerTargetState() -> {version:1,enabled:false,triggers}`; `normalizeDoorTriggerTargetState(value) -> DoorTriggerTargetState`; `readDoorTriggerTarget(wall) -> {configured:boolean,...DoorTriggerTargetState}`; `DoorTriggerTargetRepository.read(wall)`, `.saveDefinitions(wall,{enabled,definitions,expectedRevision})`, `.updateRuntime(wall,mutate)`, `.resetExecutions(wall)`.
- Produces: `nearestPointOnSegment(point,a,b) -> {x,y}`; `measureDoorDistanceFeet(characterToken,wall,{canvas}) -> number`; `preflightDoorAccess(wall,{game,canvas}) -> {allowed,reason,characterTokenUuid,distance}`.

- [ ] **Step 1: Add failing flag-schema tests**

```js
test("door target defaults are detached and do not configure the wall", () => {
  const first = readDoorTriggerTarget({ flags: {} });
  const second = readDoorTriggerTarget({ flags: {} });
  assert.equal(first.configured, false);
  assert.equal(first.enabled, false);
  assert.deepEqual(Object.keys(first.triggers.chainsByEvent), ["beforeOpen", "afterOpen", "afterClaim", "emptied"]);
  first.triggers.chainsByEvent.beforeOpen.push({ id: "changed" });
  assert.equal(second.triggers.chainsByEvent.beforeOpen.length, 0);
});

test("door save rejects storage-only chains and checks revision", async () => {
  const wall = fakeWall();
  const repository = new DoorTriggerTargetRepository();
  const definitions = createEmptyStorageTriggerState().chainsByEvent;
  definitions.afterClaim.push(validFinishChain("claim"));
  await assert.rejects(
    repository.saveDefinitions(wall, { enabled: true, definitions: { chainsByEvent: definitions }, expectedRevision: 0 }),
    /afterClaim/u
  );
});

test("future door target versions remain configured but cannot execute or be overwritten", async () => {
  const wall = fakeWall({ doorTriggerTarget: { version: 99, enabled: true, payload: { future: true } } });
  const repository = new DoorTriggerTargetRepository();
  const snapshot = readDoorTriggerTarget(wall);
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.unsupported, true);
  assert.equal(snapshot.enabled, false);
  await assert.rejects(repository.saveDefinitions(wall, {
    enabled: true,
    definitions: { chainsByEvent: createEmptyStorageTriggerState().chainsByEvent },
    expectedRevision: 0
  }), /новой версией/u);
});
```

- [ ] **Step 2: Add failing geometry/preflight tests**

```js
test("nearest segment distance handles diagonal walls and exact ten-foot boundary", () => {
  const canvas = squareCanvas({ size: 100, distance: 5 });
  const wall = fakeWall({ c: [300, 0, 300, 600] });
  assert.equal(measureDoorDistanceFeet(fakeCharacter({ x: 0, y: 0, width: 2, height: 2 }), wall, { canvas }), 10);
  assert.equal(preflightDoorAccess(wall, { game: ownedPlayer(), canvas }).allowed, true);
});

test("door preflight requires controlled owned character and rejects secret doors", () => {
  assert.equal(preflightDoorAccess(fakeWall({ door: SECRET }), playerContext({ controlled: [] })).reason, "character");
  assert.equal(preflightDoorAccess(fakeWall({ door: SECRET }), playerContext({ controlled: [ownedCharacter()] })).reason, "secret");
});
```

- [ ] **Step 3: Run the new tests and confirm the red state**

Run: `node --test tests/door-trigger-target.test.mjs tests/door-access.test.mjs`

Expected: both files fail with `ERR_MODULE_NOT_FOUND` for the two new modules.

- [ ] **Step 4: Implement the door flag owner**

```js
export const DOOR_TRIGGER_EVENTS = Object.freeze(["beforeOpen", "afterOpen"]);
export const DOOR_TRIGGER_TARGET_FLAG = "doorTriggerTarget";

export function createEmptyDoorTriggerTargetState() {
  return { version: 1, enabled: false, triggers: createEmptyStorageTriggerState() };
}

export function readDoorTriggerTarget(wall) {
  const raw = wall?.flags?.[MODULE_ID]?.[DOOR_TRIGGER_TARGET_FLAG];
  return { configured: raw != null, ...normalizeDoorTriggerTargetState(raw) };
}

export class DoorTriggerTargetRepository {
  async saveDefinitions(wall, { enabled, definitions, expectedRevision }) {
    const current = readDoorTriggerTarget(wall);
    if (current.triggers.revision !== expectedRevision) throw revisionConflict();
    const candidate = normalizeAndValidateDoorDefinitions(current, definitions);
    return this.#write(wall, { version: 1, enabled: enabled === true, triggers: candidate });
  }
}
```

Normalization must always emit all four engine buckets, but `afterClaim` and `emptied` must remain empty; unsupported future chains remain opaque under the same rules as storage. `updateRuntime` preserves `enabled`, definitions and revision; `resetExecutions` clears only once/run ledgers and preserves variables.

- [ ] **Step 5: Implement nearest-segment geometry and preflight**

```js
export function nearestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return { x: start.x + t * dx, y: start.y + t * dy };
}

export function measureDoorDistanceFeet(characterToken, wall, { canvas = globalThis.canvas } = {}) {
  const [x1, y1, x2, y2] = wall?.c ?? wall?.document?.c ?? [];
  return Math.min(...characterFootprintPoints(characterToken, { canvas }).map((point) => {
    const nearest = nearestPointOnSegment(point, { x: x1, y: y1 }, { x: x2, y: y2 });
    return pixelsToSceneDistance(point, nearest, characterToken, wall, canvas);
  }));
}
```

`preflightDoorAccess` must inspect only controlled tokens, require `actor.type === "character"`, OWNER permission, same Scene, non-hidden token and distance `<= 10`; a secret wall is rejected when `game.user.isGM !== true`. Unlike storage it must not grant a GM bypass for character/distance requirements.

- [ ] **Step 6: Run focused tests green**

Run: `node --test tests/door-trigger-target.test.mjs tests/door-access.test.mjs`

Expected: all tests pass, including short/long/diagonal/off-grid segment cases, exact 10 ft and greater-than-10 ft.

- [ ] **Step 7: Record domain methods in the function passport**

Add the Task 1 exports and repository methods to the storage/trigger passport section with flag ownership, no-eager-write rule, allowed door events, exact 10-foot geometry and `tests/door-trigger-target.test.mjs` / `tests/door-access.test.mjs` as focused coverage.

- [ ] **Step 8: Review and commit the domain slice**

Run: `git diff --check; git diff -- scripts/data/door-trigger-target.js scripts/data/door-access.js tests/door-trigger-target.test.mjs tests/door-access.test.mjs`

```powershell
git add scripts/data/door-trigger-target.js scripts/data/door-access.js tests/door-trigger-target.test.mjs tests/door-access.test.mjs docs/function-passport.md
git commit -m "feat: add door trigger target state"
```

---

### Task 2: Neutral Trigger Target Coordinator and Storage Regression

**Files:**
- Create: `scripts/application/trigger-target-coordinator.js`
- Create: `scripts/data/storage-trigger-target-adapter.js`
- Create: `scripts/data/door-trigger-target-adapter.js`
- Create: `tests/trigger-target-coordinator.test.mjs`
- Modify: `scripts/data/storage-trigger-service.js`
- Modify: `scripts/data/storage-command-service.js`
- Modify: `tests/storage-trigger-service.test.mjs`
- Modify: `tests/storage-socket.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Consumes: `StorageTriggerService.execute(event,state,context)`; `StorageService.saveTriggerDefinitions`, `.updateTriggerRuntime`, `.resetTriggerExecutions`; `DoorTriggerTargetRepository` from Task 1.
- Produces: `createTriggerTargetRef(kind,uuid,{path=[]}) -> frozen {kind,uuid,path}`; `path` must be empty for `kind:"door"`.
- Produces: `new TriggerTargetCoordinator({triggerService,adapters})`; `.read(ref,{document})`; `.saveDefinitions(ref,{document,enabled,definitions,expectedRevision})`; `.resetExecutions(ref,{document})`; `.execute(ref,event,context,{document})`.
- Adapter contract: `{read(ref,{document}),saveDefinitions(ref,input,{document}),updateRuntime(ref,mutate,{document}),resetExecutions(ref,{document})}`; each read returns `{enabled,triggers,document}`.

- [ ] **Step 1: Write failing coordinator tests**

```js
test("coordinator dispatches by kind and injects exact persistence", async () => {
  const commits = [];
  const coordinator = new TriggerTargetCoordinator({
    triggerService: { async execute(event, state, context) { await context.persistRuntime(context, () => {}); return { allowed: true }; } },
    adapters: { door: fakeAdapter({ commits }) }
  });
  const ref = createTriggerTargetRef("door", "Scene.room.Wall.door");
  assert.deepEqual(await coordinator.execute(ref, "beforeOpen", { runId: "open-1" }), { allowed: true });
  assert.deepEqual(commits, ["Scene.room.Wall.door"]);
});

test("storage adapter delegates to canonical StorageService with exact nested path", async () => {
  const calls = [];
  const adapter = new StorageTriggerTargetAdapter({ storageService: fakeStorageService(calls) });
  await adapter.resetExecutions(createTriggerTargetRef("storage", "Scene.a.Token.chest", { path: ["bag"] }), { document: fakeStorageToken() });
  assert.deepEqual(calls, [["reset", ["bag"]]]);
});
```

- [ ] **Step 2: Run focused tests red**

Run: `node --test tests/trigger-target-coordinator.test.mjs tests/storage-trigger-service.test.mjs tests/storage-socket.test.mjs`

Expected: coordinator module is missing; existing storage tests still pass independently.

- [ ] **Step 3: Implement coordinator and adapters**

```js
export class TriggerTargetCoordinator {
  constructor({ triggerService, adapters }) {
    this.triggerService = triggerService;
    this.adapters = new Map(Object.entries(adapters ?? {}));
  }

  async execute(ref, event, context = {}, options = {}) {
    const adapter = this.#adapter(ref);
    const snapshot = await adapter.read(ref, options);
    if (snapshot.enabled === false) return { allowed: true, completedChainIds: [] };
    return this.triggerService.execute(event, snapshot.triggers, {
      ...context,
      targetKind: ref.kind,
      targetUuid: ref.uuid,
      persistRuntime: (_context, mutate) => adapter.updateRuntime(ref, mutate, options)
    });
  }
}
```

Storage adapter must report `enabled:true` because storage trigger sections are always executable, and delegate every write to existing `StorageService`; door adapter delegates only to `DoorTriggerTargetRepository`.

- [ ] **Step 4: Make engine persistence target-aware without breaking fallback**

```js
async #commit(state, context, mutate) {
  mutate(state);
  const persistRuntime = typeof context.persistRuntime === "function"
    ? context.persistRuntime
    : this.persistRuntime;
  await persistRuntime(context, mutate);
}
```

Add a storage-trigger-service test proving the constructor `persistRuntime` remains used when context does not supply one, and context persistence wins when supplied.

- [ ] **Step 5: Route storage execution and admin writes through coordinator**

Change `StorageCommandService` constructor from `triggerService` to `triggerTargetCoordinator`, and replace its direct calls with:

```js
const target = createTriggerTargetRef("storage", payload.tokenUuid, { path });
return this.triggerTargetCoordinator.execute(
  target,
  event,
  this.#triggerContext(event, payload, sender, access, extra),
  { document: access.storageToken }
);
```

`readTriggers`, `saveTriggers`, and `resetTriggers` keep their existing payload/result and authorization but call coordinator read/save/reset. Do not change snapshot secrecy, mutation fingerprints, queue keys, error strings, storage flags or public storage APIs.

- [ ] **Step 6: Run storage and coordinator regression tests green**

Run: `node --test tests/trigger-target-coordinator.test.mjs tests/storage-trigger-service.test.mjs tests/storage-socket.test.mjs tests/storage-service.test.mjs`

Expected: all pass; nested storage persistence, open/claim ordering and runtime receipts are unchanged.

- [ ] **Step 7: Update the coordinator data flow in the function passport**

Document `createTriggerTargetRef`, all coordinator methods, both adapter contracts, the context-level `persistRuntime` precedence, and that storage remains owned by `StorageService` with unchanged public payloads and results.

- [ ] **Step 8: Review and commit the common execution slice**

Run: `git diff --check; git diff -- scripts/application/trigger-target-coordinator.js scripts/data/storage-trigger-target-adapter.js scripts/data/door-trigger-target-adapter.js scripts/data/storage-trigger-service.js scripts/data/storage-command-service.js tests/trigger-target-coordinator.test.mjs tests/storage-trigger-service.test.mjs tests/storage-socket.test.mjs`

```powershell
git add scripts/application/trigger-target-coordinator.js scripts/data/storage-trigger-target-adapter.js scripts/data/door-trigger-target-adapter.js scripts/data/storage-trigger-service.js scripts/data/storage-command-service.js tests/trigger-target-coordinator.test.mjs tests/storage-trigger-service.test.mjs tests/storage-socket.test.mjs docs/function-passport.md
git commit -m "refactor: share trigger target execution"
```

---

### Task 3: Authoritative Door Commands and Transaction

**Files:**
- Create: `scripts/application/door-trigger-command-service.js`
- Create: `tests/door-trigger-command-service.test.mjs`
- Modify: `tests/security.test.mjs`
- Modify: `docs/function-passport.md`
- Read narrowly: `scripts/data/storage-command-service.js:validators`, `scripts/data/storage-command-service.js:#runMutation`, `scripts/infrastructure/foundry/world-mutation-coordinator.js`

**Interfaces:**
- Consumes: coordinator APIs from Task 2; `measureDoorDistanceFeet`; exact Foundry wall fields `door`, `ds`, `parent`; injected `resolveDocument(uuid)` and `isControlledToken(token,sender)`.
- Produces validators: `isValidDoorOpenPayload(payload)`, `isValidDoorTriggerReadPayload(payload)`, `isValidDoorTriggerSavePayload(payload)`, `isValidDoorTriggerResetPayload(payload)`.
- Produces: `DoorTriggerCommandService.readTriggers(payload,{sender})`, `.saveTriggers(payload,{sender})`, `.resetTriggers(payload,{sender})`, `.open(payload,{sender})`.
- Payloads: open `{wallUuid,characterTokenUuid,mutationId}`; read `{wallUuid}`; save `{wallUuid,enabled,definitions,expectedRevision,operationId}`; reset `{wallUuid,operationId}`.
- Produces stable errors: `DOOR_CHARACTER_REQUIRED` (`Выберите своего персонажа.`), `DOOR_CHARACTER_UNAVAILABLE` (`Выбранный персонаж недоступен.`), `DOOR_SCENE_MISMATCH` (`Персонаж должен находиться на сцене с дверью.`), `DOOR_DISTANCE` (`Подойдите к двери на расстояние не более 10 футов.`), `DOOR_UNAVAILABLE` (`Дверь недоступна.` for secret/missing/not-a-door player cases), `DOOR_DISABLED` (`Механика двери Rebreya выключена.`), `DOOR_STATE_CHANGED` (`Состояние двери уже изменилось.`), `DOOR_LOCKED` (`Дверь заперта.`), and sanitized `DOOR_TRIGGER_DENIED`.

- [ ] **Step 1: Write exact validator and authorization tests**

```js
test("door payload validators reject extra keys and unstable ids", () => {
  assert.equal(isValidDoorOpenPayload({ wallUuid: WALL, characterTokenUuid: HERO, mutationId: "open-1" }), true);
  assert.equal(isValidDoorOpenPayload({ wallUuid: WALL, characterTokenUuid: HERO, mutationId: "", extra: true }), false);
  assert.equal(isValidDoorTriggerSavePayload({ wallUuid: WALL, enabled: true, definitions, expectedRevision: 0, operationId: "save-1" }), true);
});

test("configuration commands require GM and exact live Wall", async () => {
  await assert.rejects(service.readTriggers({ wallUuid: WALL }, { sender: player }), /только мастер/u);
  await assert.rejects(service.readTriggers({ wallUuid: TOKEN_UUID }, { sender: gm }), /не является дверью/u);
});
```

- [ ] **Step 2: Write failing open transaction matrix**

Use table tests for:

```js
[
  { ds: CLOSED, chains: [], expected: OPEN },
  { ds: LOCKED, chains: [], error: "DOOR_LOCKED" },
  { ds: LOCKED, chains: [disabledChain()], error: "DOOR_LOCKED" },
  { ds: LOCKED, chains: [activeAllowChain()], expected: OPEN },
  { ds: CLOSED, chains: [activeDenyChain()], error: "DOOR_TRIGGER_DENIED" }
]
```

Also assert player secret-door rejection, wrong scene, not controlled, not OWNER, distance `>10`, state changing to OPEN between gate and commit, duplicate `mutationId`, fingerprint mismatch, and `afterOpen` exception after one wall update.

Execute real common-engine chains through the service for `conditionItem`, ability/save branching, damage and Macro; assert the Macro context is deeply frozen, contains `targetKind:"door"` / exact `targetUuid`, and contains no storage rows, coins, template/source IDs or mutable Foundry documents. Cover `onceGlobal` and `oncePerCharacter` with two mutation IDs and two character Actors.

Add an active-GM restart case: create a fresh service over a wall already `OPEN` with matching durable `mutationId:beforeOpen` / `mutationId:afterOpen` receipts, retry the same payload, and assert compact success with zero additional wall updates and trigger effects. An `OPEN` wall without matching receipts must return the stable changed-state error.

- [ ] **Step 3: Run command tests red**

Run: `node --test tests/door-trigger-command-service.test.mjs tests/security.test.mjs`

Expected: new service module missing; security regression stays green when run alone.

- [ ] **Step 4: Implement strict payload validators and live resolution**

```js
export function isValidDoorOpenPayload(payload) {
  return exactKeys(payload, ["wallUuid", "characterTokenUuid", "mutationId"])
    && isWallUuid(payload.wallUuid)
    && isTokenUuid(payload.characterTokenUuid)
    && isStableId(payload.mutationId);
}

async #resolveOpenAccess(payload, sender) {
  const wall = await this.resolveDocument(payload.wallUuid);
  const characterToken = await this.resolveDocument(payload.characterTokenUuid);
  assertDoorWall(wall);
  assertSameScene(wall, characterToken);
  assertOwnedControlledCharacter(characterToken, sender);
  assertPlayerCanSeeDoor(wall, sender);
  assertWithinTenFeet(characterToken, wall, this.measureDistance);
  return { wall, characterToken, character: characterToken.actor };
}
```

Apply the same trimmed UUID/stable-ID length limits and 500 KB detached definitions cap used by the storage typed validators. Player-facing invalid/secret failures share `DOOR_UNAVAILABLE`, so command results cannot disclose a hidden wall's existence or trigger configuration.

GM config routes only require authenticated `sender.isGM`, exact live `WallDocument`, and door type; they must not require a controlled character.

- [ ] **Step 5: Implement per-wall idempotent open transaction**

```js
async open(payload, { sender } = {}) {
  const key = `door:open:${payload.mutationId}`;
  const fingerprint = commandFingerprint(payload, sender);
  return this.#runMutation([`door:${payload.wallUuid}`], key, async () => {
    const access = await this.#resolveDoorAndCharacter(payload, sender);
    const target = createTriggerTargetRef("door", payload.wallUuid);
    const snapshot = await this.coordinator.read(target, { document: access.wall });
    const replay = matchingDoorOpenRun(snapshot.triggers, payload.mutationId, fingerprint);
    if (Number(access.wall.ds) === OPEN && replay.beforeOpenComplete) {
      await this.#executeAfterOpen(target, payload, sender, access);
      return { wallUuid: payload.wallUuid, state: OPEN, opened: true, replayed: true };
    }
    this.#assertOpenableState(access.wall);
    const activeBeforeOpen = countActiveSupportedChains(snapshot.triggers, "beforeOpen");
    if (Number(access.wall.ds) === LOCKED && activeBeforeOpen === 0) throw doorLockedError();
    const gate = await this.coordinator.execute(target, "beforeOpen", this.#context(payload, sender, access, "beforeOpen"), { document: access.wall });
    if (gate.allowed === false) throw triggerDeniedError(gate);
    const live = await this.#resolveDoorAndCharacter(payload, sender);
    this.#assertOpenableState(live.wall);
    await live.wall.update({ ds: OPEN }, { sound: true, rebreyaDoorTriggerBypass: true });
    await this.#executeAfterOpen(target, payload, sender, live);
    return { wallUuid: payload.wallUuid, state: OPEN, opened: true };
  }, { fingerprint, authorize: () => this.#resolveDoorAndCharacter(payload, sender) });
}
```

`#resolveDoorAndCharacter` validates document kinds, enabled/supported target, sender ownership/control, same scene, secret-door policy and distance but leaves the `ds` decision to `#assertOpenableState`, allowing a restart replay to inspect receipts on an already-open wall. `matchingDoorOpenRun` requires the stored `beforeOpen` run fingerprint to match sender/wall/character/event inputs; it must not treat a merely completed unrelated run as authorization. On an `OPEN` matching replay, `#executeAfterOpen` uses the same durable `mutationId:afterOpen` run and therefore resumes or returns its existing receipt without a second wall update. Use `mutationId:beforeOpen` and `mutationId:afterOpen` as durable run IDs. Cache only successful committed results; access/validation failures must release fingerprints. Catch and log `afterOpen` errors after wall update, return `{postCommitWarning:true}` without rollback, and let retry resume the same durable receipt.

- [ ] **Step 6: Implement GM read/save/reset using the coordinator**

`readTriggers` returns `{wallUuid,enabled,triggers}`. `saveTriggers` and `resetTriggers` use `operationId`, sender-bound fingerprint and the same `door:<wallUuid>` queue as open so editor writes cannot race the transaction.

- [ ] **Step 7: Run authoritative tests green**

Run: `node --test tests/door-trigger-command-service.test.mjs tests/door-trigger-target.test.mjs tests/trigger-target-coordinator.test.mjs tests/security.test.mjs`

Expected: all pass and side-effect counters remain exactly one on retries.

- [ ] **Step 8: Record command contracts in the function passport**

Document all four validators/methods, payload/result shapes, sender authorization, access revalidation, queue/fingerprint/run IDs, `LOCKED` matrix and post-commit `afterOpen` rule with the Task 3 focused tests.

- [ ] **Step 9: Review and commit the command slice**

Run: `git diff --check; git diff -- scripts/application/door-trigger-command-service.js tests/door-trigger-command-service.test.mjs tests/security.test.mjs`

```powershell
git add scripts/application/door-trigger-command-service.js tests/door-trigger-command-service.test.mjs tests/security.test.mjs docs/function-passport.md
git commit -m "feat: add authoritative door open commands"
```

---

### Task 4: Target-Neutral Trigger Editor

**Files:**
- Modify: `scripts/ui/storage-trigger-editor.js`
- Modify: `templates/storage-trigger-editor.hbs`
- Modify: `styles/main.css`
- Modify: `tests/storage-trigger-editor.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Consumes: current trigger schema/builders and module API methods for storage/door.
- Produces: `TriggerEditor(moduleApi,target,options)` where target is `{kind:"storage",uuid,path}` or `{kind:"door",uuid,path:[]}` and options include `{targetName,availableEvents,canToggleEnabled}`.
- Preserves: `StorageTriggerEditor` export as a thin constructor wrapper with unchanged signature `(moduleApi,tokenUuid,{path,storageName})`.
- Produces: door wrapper path from main using `new TriggerEditor(api,{kind:"door",uuid:wallUuid,path:[]},{targetName,availableEvents:["beforeOpen","afterOpen"],canToggleEnabled:true})`.

- [ ] **Step 1: Extend editor tests before implementation**

```js
test("door editor exposes two events and saves enabled state", async () => {
  const calls = [];
  const app = new TriggerEditor(fakeDoorApi(calls), { kind: "door", uuid: WALL, path: [] }, {
    targetName: "Северная дверь",
    availableEvents: ["beforeOpen", "afterOpen"],
    canToggleEnabled: true
  });
  await app._prepareContext();
  assert.deepEqual(app.events.map(({ event }) => event), ["beforeOpen", "afterOpen"]);
  await app.save({ enabled: true });
  assert.equal(calls[0].enabled, true);
});

test("storage wrapper retains four tabs and old API calls", async () => {
  const app = new StorageTriggerEditor(storageApi, "Scene.a.Token.chest", { path: ["bag"] });
  const context = await app._prepareContext();
  assert.deepEqual(context.events.map(({ event }) => event), ["beforeOpen", "afterOpen", "afterClaim", "emptied"]);
});
```

- [ ] **Step 2: Run editor tests red**

Run: `node --test tests/storage-trigger-editor.test.mjs`

Expected: `TriggerEditor` export/door transport is absent.

- [ ] **Step 3: Generalize transport while preserving editor behavior**

```js
const TARGET_TRANSPORT = {
  storage: {
    read: (api, target) => api.getStorageTriggers(target.uuid, { path: target.path }),
    save: (api, target, input) => api.saveStorageTriggers(target.uuid, input.definitions, input.expectedRevision, input.operationId, { path: target.path }),
    reset: (api, target, operationId) => api.resetStorageTriggerExecutions(target.uuid, operationId, { path: target.path })
  },
  door: {
    read: (api, target) => api.getDoorTriggers(target.uuid),
    save: (api, target, input) => api.saveDoorTriggers(target.uuid, input.enabled, input.definitions, input.expectedRevision, input.operationId),
    reset: (api, target, operationId) => api.resetDoorTriggerExecutions(target.uuid, operationId)
  }
};
```

Keep draft detachment, revision conflicts, dirty-close confirmation, opaque chains, Item/Token/Macro drops, lock/trap templates and 1120×720 dimensions unchanged. For a door, lock template goes to `beforeOpen`, trap to `afterOpen`; hidden events must never enter the draft.

- [ ] **Step 4: Add neutral heading and conditional enabled control**

```hbs
<header class="rm-trigger-editor__heading">
  <strong>Триггеры — {{targetKindLabel}}</strong><span>{{targetName}}</span>
  {{#if canToggleEnabled}}<label class="rm-trigger-editor__enabled"><input type="checkbox" data-field="target.enabled" {{#if enabled}}checked{{/if}}> Механика двери включена</label>{{/if}}
</header>
```

Storage must render no enabled toggle and keep its current trigger summary workflow. Add only scoped `.rebreya-storage-trigger-editor`/`.rm-trigger-editor` CSS.

- [ ] **Step 5: Run editor regression green**

Run: `node --test tests/storage-trigger-editor.test.mjs tests/storage-app.test.mjs`

Expected: door-only controls pass; all existing storage editor/drop/template/dirty-state tests pass.

- [ ] **Step 6: Update the editor contract in the function passport**

Document `TriggerEditor`, its exact target/options shapes, transport mapping, two-event door restriction, conditional enabled toggle, and the preserved `StorageTriggerEditor` wrapper signature.

- [ ] **Step 7: Review and commit the editor slice**

Run: `git diff --check; git diff -- scripts/ui/storage-trigger-editor.js templates/storage-trigger-editor.hbs styles/main.css tests/storage-trigger-editor.test.mjs`

```powershell
git add scripts/ui/storage-trigger-editor.js templates/storage-trigger-editor.hbs styles/main.css tests/storage-trigger-editor.test.mjs docs/function-passport.md
git commit -m "feat: support door trigger configuration"
```

---

### Task 5: Door Overlay and Native Canvas Routing

**Files:**
- Create: `scripts/ui/door-trigger-overlay.js`
- Create: `scripts/integrations/door-trigger-hooks.js`
- Create: `tests/door-trigger-overlay.test.mjs`
- Create: `tests/door-trigger-hooks.test.mjs`
- Modify: `styles/main.css`
- Modify: `docs/function-passport.md`
- Read narrowly: `scripts/ui/storage-token-overlay.js`, `scripts/integrations/storage-token-hooks.js`, installed Foundry `DoorControl` methods `_onMouseDown` and `_onRightDown`.

**Interfaces:**
- Consumes module API: `getDoorTriggerPreflight(wallUuid)`, `attemptDoorOpen(wallUuid,mutationId,{characterTokenUuid})`, `openDoorTriggerEditor(wallUuid)`.
- Produces: `DoorTriggerOverlayController.showOpen(doorControl,{onOpen})`, `.showFeedback(doorControl,message)`, `.clear(wallUuid?)`.
- Produces: `registerDoorTriggerHooks(moduleApi,{CONFIG,game,canvas,overlayController}) -> {DoorControlClass,unregister}`; registration is idempotent and subclasses whatever class is configured at call time.
- Produces: `isCtrlModified(event,{keyboard}) -> boolean`, true for `event.ctrlKey`, `event.nativeEvent.ctrlKey`, `event.data.originalEvent.ctrlKey`, or `keyboard.isModifierActive("Control")`.

- [ ] **Step 1: Write overlay tests**

```js
test("door overlay renders exactly one Open action anchored to control bounds", () => {
  const overlay = new DoorTriggerOverlayController({ document: fakeDocument() });
  const node = overlay.showOpen(fakeDoorControl({ x: 400, y: 220 }), { onOpen() {} });
  assert.equal(node.querySelectorAll("button").length, 1);
  assert.equal(node.querySelector("button").textContent.trim(), "Открыть");
  assert.equal(node.querySelector("[data-action='configure']"), null);
});
```

- [ ] **Step 2: Write native routing matrix tests**

```js
test("door control preserves native paths and intercepts only specified gestures", async () => {
  await control(CLOSED, { enabled: false })._onMouseDown(leftClick());
  assert.equal(baseCalls.left, 1);
  await control(OPEN, { enabled: true })._onMouseDown(leftClick());
  assert.equal(baseCalls.left, 2);
  await control(CLOSED, { enabled: true })._onMouseDown(leftClick());
  assert.equal(overlays.open, 1);
  await control(CLOSED, { enabled: true })._onRightDown(rightClick());
  assert.equal(baseCalls.right, 1);
  await control(CLOSED, { enabled: true, gm: true })._onRightDown(ctrlRightClick());
  assert.deepEqual(editorCalls, [WALL]);
});
```

Also test `LOCKED`, player Ctrl+RMB, secret doors, out-of-range feedback, no controlled character, repeated hook registration, pan/redraw/wall-update/wall-delete/canvas-teardown cleanup, no duplicate global toast, and that the wrapper tag prevents wrapping its own subclass.

- [ ] **Step 3: Run UI integration tests red**

Run: `node --test tests/door-trigger-overlay.test.mjs tests/door-trigger-hooks.test.mjs`

Expected: both new modules are missing.

- [ ] **Step 4: Implement one-button overlay**

Use `doorControl.getBounds()` or its visible PIXI bounds, transform through `canvas.stage.worldTransform`, clamp to viewport with the same safe placement rules tested by `storage-token-overlay.js`, and remove the node when canvas/scene changes, control is destroyed, native action runs, or open resolves. The callback must disable the button until the request settles and reuse one overlay per wall UUID.

- [ ] **Step 5: Implement idempotent DoorControl subclass**

```js
const WRAPPER = Symbol.for("rebreya-main.door-trigger-control");

export function createDoorTriggerControlClass(BaseDoorControl, api, overlay) {
  if (BaseDoorControl?.[WRAPPER]) return BaseDoorControl;
  class RebreyaDoorControl extends BaseDoorControl {
    static [WRAPPER] = true;
    async _onMouseDown(event) {
      if (Number(this.wall?.document?.ds) === OPEN) return super._onMouseDown(event);
      const preflight = api.getDoorTriggerPreflight(this.wall?.document?.uuid);
      if (!preflight?.configured || !preflight.enabled) return super._onMouseDown(event);
      event.stopPropagation?.();
      return overlay.showOpen(this, { onOpen: () => api.attemptDoorOpen(this.wall.document.uuid, crypto.randomUUID(), { characterTokenUuid: preflight.characterTokenUuid }) });
    }
    async _onRightDown(event) {
      if (game.user?.isGM === true && isCtrlModified(event)) {
        event.stopPropagation?.();
        return api.openDoorTriggerEditor(this.wall?.document?.uuid);
      }
      return super._onRightDown(event);
    }
  }
  return RebreyaDoorControl;
}
```

`getDoorTriggerPreflight` is synchronous/read-only, reads local flag and runs Task 1 preflight; it must not write the flag. The overlay button invokes the active-GM command and translates exact error codes to Russian feedback. Do not attach listeners per canvas draw and do not access Foundry private fields.

- [ ] **Step 6: Run UI tests green**

Run: `node --test tests/door-trigger-overlay.test.mjs tests/door-trigger-hooks.test.mjs tests/storage-token-overlay.test.mjs`

Expected: route matrix and overlay pass; storage overlay placement regression remains green.

- [ ] **Step 7: Record canvas integration methods in the function passport**

Document overlay/controller methods, `isCtrlModified`, hook registration/wrapper tagging, all native-vs-intercepted mouse routes and teardown behavior with the Task 5 focused tests.

- [ ] **Step 8: Review and commit the canvas slice**

Run: `git diff --check; git diff -- scripts/ui/door-trigger-overlay.js scripts/integrations/door-trigger-hooks.js styles/main.css tests/door-trigger-overlay.test.mjs tests/door-trigger-hooks.test.mjs`

```powershell
git add scripts/ui/door-trigger-overlay.js scripts/integrations/door-trigger-hooks.js styles/main.css tests/door-trigger-overlay.test.mjs tests/door-trigger-hooks.test.mjs docs/function-passport.md
git commit -m "feat: add door trigger canvas controls"
```

---

### Task 6: Composition Root, Typed Sockets, Public API, Version and Docs

**Files:**
- Modify: `scripts/main.js`
- Create: `scripts/main-1.4.197.js`
- Modify: `module.json`
- Modify: `tests/storage-main-registration.test.mjs`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `README.md`
- Modify: `docs/function-passport.md`

**Interfaces:**
- Consumes all services/adapters/hooks from Tasks 1–5.
- Produces module API: `getDoorTriggerPreflight(wallUuid)`, `getDoorTriggers(wallUuid)`, `saveDoorTriggers(wallUuid,enabled,definitions,expectedRevision,operationId)`, `resetDoorTriggerExecutions(wallUuid,operationId)`, `attemptDoorOpen(wallUuid,mutationId,{characterTokenUuid})`, `openDoorTriggerEditor(wallUuid)`.
- Produces typed routes exactly `door.open`, `door.triggers.read`, `door.triggers.save`, `door.triggers.reset` with Task 3 validators and active-GM handlers.

- [ ] **Step 1: Extend registration and manifest tests first**

```js
assert.match(main, /this\.doorTriggerCommandService = new DoorTriggerCommandService\(\{/u);
assert.match(main, /registerDoorTriggerHooks\(moduleApi/u);
assert.match(main, /async attemptDoorOpen\(/u);
assert.match(main, /async openDoorTriggerEditor\(/u);
assert.deepEqual(manifest.esmodules, ["scripts/main-1.4.197.js"]);
assert.equal((await readFile("scripts/main-1.4.197.js", "utf8")).trim(), 'import "./main.js";');
```

Add assertions that every new command is registered once with its exact validator and handler, and every changed import cache key contains `1.4.197-door-trigger-target`.

- [ ] **Step 2: Run registration tests red**

Run: `node --test tests/storage-main-registration.test.mjs tests/module-manifest.test.mjs`

Expected: missing door composition/API/routes and manifest still reports `1.4.196`.

- [ ] **Step 3: Wire coordinator and command service in `scripts/main.js`**

```js
this.doorTriggerRepository = new DoorTriggerTargetRepository();
this.triggerTargetCoordinator = new TriggerTargetCoordinator({
  triggerService: this.storageTriggerService,
  adapters: {
    storage: new StorageTriggerTargetAdapter({ storageService: this.storageService }),
    door: new DoorTriggerTargetAdapter({ repository: this.doorTriggerRepository })
  }
});
this.doorTriggerCommandService = new DoorTriggerCommandService({
  coordinator: this.triggerTargetCoordinator,
  resolveDocument: (uuid) => globalThis.fromUuid?.(uuid),
  measureDistance: measureDoorDistanceFeet,
  logger: console
});
```

Pass the same coordinator into `StorageCommandService`. Build door macro context through the existing dnd5e adapter/prompt broker and preserve storage context fields; for a door add `targetKind:"door"`, `targetUuid:wallUuid`, `wallUuid`, and omit storage rows/coins/path.

- [ ] **Step 4: Register typed commands and public API**

Follow the existing active-GM socket registration pattern:

```js
registerCommand("door.open", { validate: isValidDoorOpenPayload, execute: (payload, context) => this.doorTriggerCommandService.open(payload, context) });
registerCommand("door.triggers.read", { validate: isValidDoorTriggerReadPayload, execute: (payload, context) => this.doorTriggerCommandService.readTriggers(payload, context) });
```

The four API methods must call local active-GM service or the existing typed command client exactly as storage does. Store editors in a distinct `doorTriggerEditors` map keyed by wall UUID; reuse and focus an existing window, remove it from the map on close, and dynamically import the editor with the new cache key.

- [ ] **Step 5: Register the DoorControl integration at init/ready**

Invoke `registerDoorTriggerHooks(moduleApi,{hooks:Hooks})` once at the lifecycle point where `CONFIG.Canvas.doorControlClass` exists, before canvas controls are constructed. Registration must be safe on hot reload and must not replace an already Rebreya-tagged class.

- [ ] **Step 6: Bump client version and forwarder**

Apply these exact runtime values:

```json
"version": "1.4.197",
"esmodules": ["scripts/main-1.4.197.js"]
```

`scripts/main-1.4.197.js` must contain only:

```js
import "./main.js";
```

Update cache-busting suffixes for every modified client module imported by `scripts/main.js` or another browser module to `v=1.4.197-door-trigger-target`. Do not add queries to the versioned forwarder.

- [ ] **Step 7: Update README and function passport**

In `README.md`, document the six new API methods, gestures, 10-foot requirement, `LOCKED` rule and the fact that doors are not loot storage. In the storage/trigger section of `docs/function-passport.md`, record exact signatures, owner (`DoorTriggerCommandService`/repository/coordinator), flag data flow, authorization, idempotency, post-commit rule, UI integration, and focused test files. Update the existing `StorageCommandService`/`StorageTriggerService` entries to reflect coordinator persistence.

- [ ] **Step 8: Run registration and all focused suites**

Run:

```powershell
node --test tests/door-trigger-target.test.mjs tests/door-access.test.mjs tests/trigger-target-coordinator.test.mjs tests/door-trigger-command-service.test.mjs tests/door-trigger-overlay.test.mjs tests/door-trigger-hooks.test.mjs tests/storage-trigger-service.test.mjs tests/storage-trigger-editor.test.mjs tests/storage-socket.test.mjs tests/storage-service.test.mjs tests/storage-main-registration.test.mjs tests/module-manifest.test.mjs tests/security.test.mjs
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 9: Review and commit the integration slice**

Run: `git diff --check; git diff --stat; git diff -- scripts/main.js scripts/main-1.4.197.js module.json tests/storage-main-registration.test.mjs tests/module-manifest.test.mjs README.md docs/function-passport.md`

```powershell
git add scripts/main.js scripts/main-1.4.197.js module.json tests/storage-main-registration.test.mjs tests/module-manifest.test.mjs README.md docs/function-passport.md
git commit -m "feat: wire door trigger targets"
```

---

### Task 7: Full Verification, Live Foundry QA and Push

**Files:**
- Verify: all files changed by Tasks 1–6
- Modify only if a verification failure exposes a defect; add the reproducing focused test with that fix

**Interfaces:**
- Consumes the completed door trigger feature at version `1.4.197`.
- Produces a pushed `lich_branch` commit chain with automated verification evidence and an explicit live-QA result or authentication blocker.

- [ ] **Step 1: Recheck shared Git state before final verification**

Run:

```powershell
git status --short --branch
git branch --show-current
git fetch origin
git rev-list --left-right --count HEAD...origin/lich_branch
git log --oneline HEAD..origin/lich_branch
git rev-list --left-right --count HEAD...origin/main
git log --oneline HEAD..origin/main
```

Expected: current branch is `lich_branch`, working tree contains no foreign changes, and `origin/lich_branch` is not ahead. Stop and report if those invariants fail.

- [ ] **Step 2: Run the complete Node test suite once**

Run: `node --test tests/*.test.mjs`

Expected: all tests pass; record the exact passed/failed counts for the final report.

- [ ] **Step 3: Run syntax, JSON and diff checks**

```powershell
git diff --check
$taskJsFiles = git ls-files '*.js' '*.mjs'
foreach ($taskFile in $taskJsFiles) { node --check $taskFile }
$taskJsonFiles = git ls-files '*.json'
foreach ($taskFile in $taskJsonFiles) { Get-Content -Raw -Encoding UTF8 $taskFile | ConvertFrom-Json | Out-Null }
```

Expected: zero output from `git diff --check`, every JS/MJS exits 0, every JSON parses.

- [ ] **Step 4: Perform authenticated live Foundry QA if a session is available**

Use the browser-control skill against an already authenticated GM/player session and execute this exact matrix:

1. GM `Ctrl+ПКМ` on an unconfigured ordinary door opens the exact editor without changing `ds`.
2. Save enabled lock on `beforeOpen` and trap on `afterOpen`; close/reopen editor and confirm persistence.
3. Ordinary GM ПКМ toggles `CLOSED ↔ LOCKED` and never opens the editor.
4. Player within 10 ft LMB gets one `Открыть` button; successful chain opens the door once and trap fires once.
5. Player farther than 10 ft, without controlled owned character, and at a secret door receives correct feedback and no update.
6. `LOCKED` without active `beforeOpen` remains locked; enabled allowing chain opens it.
7. `OPEN` LMB closes natively; disabled/unconfigured door retains all native mouse behavior.
8. Existing chest trigger editor and open/claim flows remain functional.
9. Long and diagonal walls remain accessible near either edge; pan/redraw/reload removes stale overlays and does not double-wrap DoorControl.
10. Browser console shows no new exceptions, template failures or deprecation warnings during the matrix.

If only `/join` is available, do not enter or infer credentials; record live QA as blocked by missing authenticated session, not as passed.

- [ ] **Step 5: Inspect final commits and push**

Run:

```powershell
git status --short --branch
git log --oneline -7
git push -u origin lich_branch
```

Expected: push succeeds without force and `git status --short --branch` reports the branch synchronized with `origin/lich_branch`.

- [ ] **Step 6: Report the result**

Report observable behavior, version `1.4.197`, commit hashes, pushed branch, full/focused test counts, syntax/JSON/diff results, and either the live QA matrix result or the exact authentication blocker. Mention no feature as complete unless its required automated checks passed.
