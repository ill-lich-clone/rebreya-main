# Socket Command Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить ложные `Socket command timed out after 10000 ms` у игроков: подтверждать принятие команды до ожидания очереди, выполнять независимые операции параллельно, не включать UI-refresh в socket response и сократить durable journal сложных inventory-операций до двух записей.

**Architecture:** `SocketCommandBus` остаётся единственным typed transport и получает двухфазный протокол `accepted/result`. `WorldMutationCoordinator` становится планировщиком по пересекающимся aggregate keys с честным exclusive barrier. `PrivilegedMutationGateway` использует тот же immutable scheduling policy для локального active-GM и удалённого путей. Inventory mutations возвращают authoritative result до refresh, а сложные sale/dismantle/ingress переходят на prepared receipt с заранее выделенными document IDs и одной terminal-записью.

**Tech Stack:** Foundry VTT 13 public API, dnd5e, ES modules, Node.js built-in test runner, обязательный `statuscounter >= 3.0.4`.

**Spec:** `docs/superpowers/specs/2026-09-12-socket-command-latency-design.md`

## Global Constraints

- Базовый исследовательский commit: `5dff3f9c`. Перед реализацией заново выполнить обязательный Git-процесс из `AGENTS.md` и убедиться, что ветка `lich_branch` не отстала от `origin/lich_branch` или `origin/main` конфликтующим образом.
- Сохранить channel `module.rebreya-main`, request/result envelopes, payload shapes, public API, hooks и world-setting keys. Единственное сетевое расширение — additive envelope `rebreya.command.accepted`.
- Не добавлять `socketlib`, второй socket dispatcher, прямые privileged mutations из UI или новые world settings для telemetry.
- Проверки sender identity, authorization, active GM, envelope size и mutation idempotency не ослаблять. Результат принимать только от ожидаемого active GM.
- Для read-only команд не использовать mutation coordinator и completed-idempotency cache.
- Новая simple inventory mutation сохраняет одну terminal journal write. Новая sale, dismantle и complex ingress mutation делает ровно `start(prepared)` + `finish(terminal)` независимо от количества строк.
- Старые nonterminal journal records продолжают обслуживаться legacy recovery path. Их формат и семантику не переписывать.
- Все новые и изменённые методы документировать в профильном разделе `docs/function-passport.md` в том же commit, где меняется метод.
- При первом runtime-изменении поднять версию с `1.4.288` до `1.4.289`, создать тонкий `scripts/main-1.4.289.js`, переключить `module.json` и удалить только устаревший tracked forwarder `scripts/main-1.4.288.js`. Если к началу реализации версия уже изменилась, выбрать следующий свободный patch и синхронно поправить manifest test.
- Сохранять JavaScript, JSON, Markdown и русские строки в UTF-8.
- После каждого task: focused tests, `git diff --check`, `git diff --stat`, содержательный `git diff`, затем task-specific commit. Push выполнить после итоговой полной проверки.

## File Map

- Create: `scripts/infrastructure/foundry/socket-command-trace.js` — bounded in-memory aggregation и slow/failed warning sink без payload и имён.
- Create: `scripts/application/socket-command-scheduling.js` — immutable scheduling policy, aggregate-key normalization и resolution.
- Modify: `scripts/application/world-mutation-coordinator.js` — keyed/exclusive scheduler и scoped idempotency.
- Modify: `scripts/infrastructure/foundry/socket-command-bus.js` — accepted envelope, два timeout phase, sender validation, policy-aware execution и trace events.
- Modify: `scripts/application/privileged-mutation-gateway.js` — одна policy definition для remote/direct путей, scoped direct execution и один same-ID reattach.
- Modify: `scripts/main.js` — dependency injection, scheduling classification всех typed commands, background inventory refresh.
- Modify: `scripts/data/inventory-service.js` — coarse prepared receipts, stable target IDs, batched writes и recovery.
- Modify: `tests/world-mutation-infrastructure.test.mjs` — coordinator, scheduling и socket protocol coverage.
- Create: `tests/socket-command-trace.test.mjs` — telemetry privacy/threshold coverage.
- Modify: `tests/privileged-mutation-gateway.test.mjs` — direct/remote scheduling parity и timeout reattach.
- Modify: `tests/group-command-dispatch.test.mjs` — registration classification and read-bypass coverage.
- Modify: `tests/ui-refresh-coordinator.test.mjs` and `tests/background-refresh-focus.test.mjs` — refresh no longer extends socket completion.
- Modify: `tests/durable-mutation-journal.test.mjs`, `tests/inventory-simple-transfer.test.mjs`, `tests/inventory-transfer-imports.test.mjs`, `tests/inventory-mutation-recovery.test.mjs` — write budgets, prepared plans, stable-ID retry and legacy compatibility.
- Modify: `tests/module-manifest.test.mjs`, `module.json`, versioned forwarder — client cache invalidation.
- Modify: `docs/function-passport.md` sections 2, 7 and 19; modify `README.md` only if implementation changes a documented public API.

---

### Task 1: Add privacy-safe timing telemetry and characterization tests

**Files:**

- Create: `scripts/infrastructure/foundry/socket-command-trace.js`
- Create: `tests/socket-command-trace.test.mjs`
- Modify: `scripts/infrastructure/foundry/socket-command-bus.js`
- Modify: `scripts/application/world-mutation-coordinator.js`
- Modify: `scripts/main.js`
- Modify: `docs/function-passport.md` section 2
- Modify: `module.json`, `scripts/main-1.4.289.js`, `tests/module-manifest.test.mjs`

- [ ] **Step 1: Write failing trace-sink tests**

Cover these exact behaviors:

```js
const emitted = [];
const warned = [];
const trace = createSocketCommandTraceSink({
  onRecord: (record) => emitted.push(record),
  warn: (record) => warned.push(record),
  slowTotalMs: 1_000,
  slowQueueMs: 250,
});

trace({ phase: "received", command: "inventory.item.take", requestId: "r1", senderId: "p1", at: 0 });
trace({ phase: "queue-start", command: "inventory.item.take", requestId: "r1", senderId: "p1", at: 300 });
trace({ phase: "completed", command: "inventory.item.take", requestId: "r1", senderId: "p1", at: 1_200, outcome: "ok" });

assert.equal(emitted.length, 1);
assert.equal(warned.length, 1);
assert.equal(emitted[0].queueMs, 300);
assert.equal(emitted[0].totalMs, 1_200);
assert.equal("payload" in emitted[0], false);
assert.equal("actorName" in emitted[0], false);
```

Also assert: fast success emits a record but does not warn; failure warns; counters accept only `journal-write`, `document-write`, and `refresh-scheduled`; completed spans are removed so the sink stays bounded.

- [ ] **Step 2: Run the new test and confirm missing-module failure**

Run: `node --test tests/socket-command-trace.test.mjs`

Expected: FAIL because `socket-command-trace.js` does not exist.

- [ ] **Step 3: Implement the trace event contract**

Export only internal primitives:

```js
export const NOOP_SOCKET_COMMAND_TRACE = () => {};

export function createSocketCommandTraceSink({
  onRecord = () => {},
  warn = (record) => console.warn("Rebreya slow socket command", record),
  slowTotalMs = 1_000,
  slowQueueMs = 250,
  maxOpenSpans = 512,
} = {}) {
  const spans = new Map();
  return (event) => {
    const key = `${event.senderId}\0${event.command}\0${event.requestId}`;
    const span = spans.get(key) ?? {
      command: event.command,
      requestId: event.requestId,
      senderId: event.senderId,
      receivedAt: event.at,
      journalWrites: 0,
      documentWrites: 0,
    };
    if (event.phase === "queue-start") span.queueStartedAt = event.at;
    if (event.phase === "authorized") span.authorizedAt = event.at;
    if (event.phase === "execute-end") span.executeEndedAt = event.at;
    if (event.phase === "journal-write") span.journalWrites += Number(event.count ?? 1);
    if (event.phase === "document-write") span.documentWrites += Number(event.count ?? 1);
    if (event.phase === "refresh-scheduled") span.refreshScheduledAt = event.at;
    spans.set(key, span);
    if (event.phase !== "completed") {
      while (spans.size > maxOpenSpans) spans.delete(spans.keys().next().value);
      return;
    }
    spans.delete(key);
    const record = Object.freeze({
      ...span,
      outcome: event.outcome,
      mode: event.mode,
      keys: Object.freeze([...(event.keys ?? [])]),
      completedAt: event.at,
      queueMs: Math.max(0, (span.queueStartedAt ?? span.receivedAt) - span.receivedAt),
      totalMs: Math.max(0, event.at - span.receivedAt),
    });
    onRecord(record);
    if (record.outcome !== "ok" || record.totalMs >= slowTotalMs || record.queueMs >= slowQueueMs) warn(record);
  };
}
```

Do not copy arbitrary fields from events into the final record. In particular, never record payloads, user/actor/item names, chat content or journal data.

- [ ] **Step 4: Add injectable no-op trace calls at existing lifecycle points**

Add optional `trace = NOOP_SOCKET_COMMAND_TRACE` and `now = () => performance.now()` dependencies to bus/coordinator constructors. In `scripts/main.js`, create one sink, retain it as an internal `socketCommandTrace` dependency, and inject that same function into the coordinator and bus. This gives `InventoryService` a composition-owned trace callback to use in Task 8 without importing infrastructure into the data layer. At this task, characterize the existing behavior with events only: `received`, `queue-start`, `authorized`, `execute-end`, `completed`. Do not change queueing or timeout semantics yet.

- [ ] **Step 5: Perform the one release-version bump**

Set `module.json.version` to `1.4.289`, point `esmodules` to `scripts/main-1.4.289.js`, make that file contain only:

```js
import "./main.js";
```

Update the exact version/forwarder assertions in `tests/module-manifest.test.mjs` and remove `scripts/main-1.4.288.js` only after confirming it is the tracked old forwarder.

- [ ] **Step 6: Update passport and verify**

Document the trace contract and injected dependencies in passport section 2.

Run:

```powershell
node --test tests/socket-command-trace.test.mjs tests/world-mutation-infrastructure.test.mjs tests/module-manifest.test.mjs
git diff --check
git diff --stat
git diff -- scripts/infrastructure/foundry/socket-command-trace.js scripts/infrastructure/foundry/socket-command-bus.js scripts/application/world-mutation-coordinator.js scripts/main.js module.json tests docs/function-passport.md
```

Expected: all selected tests pass; commit as `feat: add socket command timing telemetry`.

---

### Task 2: Replace the outer world queue with a fair scoped scheduler

**Files:**

- Create: `scripts/application/socket-command-scheduling.js`
- Modify: `scripts/application/world-mutation-coordinator.js`
- Modify: `tests/world-mutation-infrastructure.test.mjs`
- Modify: `docs/function-passport.md` section 2

- [ ] **Step 1: Add failing scheduler tests**

Add tests proving all of the following:

- normalized keys are trimmed, deduplicated and sorted;
- two keyed operations with disjoint keys enter concurrently;
- overlapping keys serialize in arrival order;
- an exclusive operation waits for current keyed work, blocks later keyed work, then releases it;
- a rejected operation releases all keys;
- duplicate `requestId` joins the same in-flight promise and completed results remain bounded;
- legacy `run(key, operation)` and `runIdempotent(key, requestId, operation)` still work.

Use deferred gates so ordering is deterministic:

```js
const first = createDeferred();
const second = createDeferred();
const entered = [];

const a = coordinator.runScoped({ keys: ["actor:a"] }, async () => {
  entered.push("a");
  await first.promise;
  return "A";
});
const b = coordinator.runScoped({ keys: ["actor:b"] }, async () => {
  entered.push("b");
  await second.promise;
  return "B";
});

await flushTasks();
assert.deepEqual(entered, ["a", "b"]);
```

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `node --test --test-name-pattern="scoped|exclusive|disjoint|overlapping" tests/world-mutation-infrastructure.test.mjs`

Expected: FAIL because scoped APIs do not exist.

- [ ] **Step 3: Implement immutable policy helpers**

In `socket-command-scheduling.js`, export:

```js
export const QUERY_SCHEDULING = Object.freeze({ mode: "query" });
export const EXCLUSIVE_MUTATION_SCHEDULING = Object.freeze({ mode: "exclusive-mutation" });

export function keyedMutationScheduling(keys) {
  if (typeof keys !== "function") throw new TypeError("Keyed scheduling requires a key resolver");
  return Object.freeze({ mode: "keyed-mutation", keys });
}

export function normalizeAggregateKeys(keys) {
  const normalized = [...new Set((keys ?? []).map((key) => String(key ?? "").trim()).filter(Boolean))].sort();
  if (!normalized.length) throw new Error("Mutation scheduling resolved no aggregate keys");
  return Object.freeze(normalized);
}

export function aggregateKey(kind, identity) {
  const cleanKind = String(kind ?? "").trim();
  const cleanIdentity = String(identity ?? "").trim();
  if (!cleanKind || !cleanIdentity) throw new Error("Aggregate key requires kind and identity");
  return `${cleanKind}:${cleanIdentity}`;
}
```

Keep policies immutable after registration. Resolvers may read validated payload/context, but must not mutate either.

- [ ] **Step 4: Implement `runScoped` with a fair exclusive barrier**

Use one FIFO pending list and an active-key set. A later independent keyed job may bypass an earlier keyed job only if it does not overlap that waiting job. Nothing may bypass the first waiting exclusive job. Exclusive starts only when no scoped job is active.

Public signatures:

```js
runScoped({ keys, exclusive = false } = {}, operation)
runIdempotentScoped({ keys, exclusive = false, requestId } = {}, operation)
```

Refactor idempotency storage through one private helper so legacy and scoped calls share the same in-flight/completed cache without nesting queues. Emit `queued` and `queue-start` trace events through optional metadata supplied by the caller.

- [ ] **Step 5: Update passport and verify**

Run:

```powershell
node --test tests/world-mutation-infrastructure.test.mjs
git diff --check
git diff --stat
git diff -- scripts/application/socket-command-scheduling.js scripts/application/world-mutation-coordinator.js tests/world-mutation-infrastructure.test.mjs docs/function-passport.md
```

Expected: coordinator suite passes; commit as `feat: add scoped world mutation scheduling`.

---

### Task 3: Add `accepted` envelopes and phase-specific timeouts to the socket bus

**Files:**

- Modify: `scripts/infrastructure/foundry/socket-command-bus.js`
- Modify: `tests/world-mutation-infrastructure.test.mjs`
- Modify: `docs/function-passport.md` section 2

- [ ] **Step 1: Add failing protocol tests**

Add deterministic fake-timer tests for:

1. active GM emits `rebreya.command.accepted` before waiting on a blocked mutation queue;
2. result arriving before accepted acts as implicit acceptance;
3. no accepted/result for 10,000 ms rejects with `request-timeout`;
4. accepted switches the timer to 60,000 ms and expiry rejects with `operation-timeout`;
5. accepted/result whose `transportSenderId` differs from envelope `senderId` is ignored;
6. accepted/result from a user other than the expected active GM is ignored;
7. wrong command, requestId or forUserId is ignored;
8. query execution bypasses the coordinator;
9. same mutation request delivered twice joins one in-flight execution.

Use the additive envelope exactly:

```js
{
  type: "rebreya.command.accepted",
  command: "inventory.item.take",
  requestId: "request-1",
  forUserId: "player-1",
  senderId: "gm-1",
}
```

- [ ] **Step 2: Run focused protocol tests and confirm failures**

Run: `node --test --test-name-pattern="accepted|operation-timeout|expected active GM|query" tests/world-mutation-infrastructure.test.mjs`

Expected: FAIL because accepted envelopes and phase timers do not exist.

- [ ] **Step 3: Extend registration and pending-request state**

Export `COMMAND_ACCEPTED_TYPE` and `COMPLETION_TIMEOUT_MS = 60_000`. Change registration to:

```js
register(command, { validate, authorize, execute, scheduling })
```

The stored definition is frozen. Missing `scheduling` falls back to `EXCLUSIVE_MUTATION_SCHEDULING` only when `requireExplicitScheduling` is false; strict startup enforcement comes in Task 6.

Pending client entries must retain:

```js
{
  command,
  requestId,
  forUserId,
  expectedActiveGmId,
  phase: "acceptance",
  timeoutId,
  resolve,
  reject,
}
```

Capture `expectedActiveGmId` when emitting the request. Both `#handleAccepted(message, transportSenderId)` and `#handleResult(message, transportSenderId)` must validate transport sender, envelope sender, expected active GM, command, request and recipient before touching the timer or promise.

- [ ] **Step 4: Change active-GM request handling order**

Implement this order:

1. validate envelope and transport sender;
2. resolve command and sender user;
3. shape-validate payload;
4. resolve immutable scheduling policy and normalized keys;
5. synchronously create/find the mutation in-flight promise, then emit accepted;
6. for queries, emit accepted immediately before execution;
7. immediately before `execute`, re-check current active GM and run fresh authorization;
8. emit result.

Mutation execution must call:

```js
coordinator.runIdempotentScoped(
  { keys, exclusive, requestId: `${sender.id}\0${command}\0${requestId}` },
  executeAuthorized,
);
```

Queries call `executeAuthorized()` directly and never enter the coordinator or completed cache.

- [ ] **Step 5: Wire trace events without payloads**

Emit accepted, queue, authorization, execution, response and completed timestamps. Include only command/request/sender/outcome, mode and normalized keys. Preserve envelope-size checks for accepted and result packets.

- [ ] **Step 6: Update passport and verify**

Run:

```powershell
node --test tests/world-mutation-infrastructure.test.mjs tests/socket-command-trace.test.mjs
git diff --check
git diff --stat
git diff -- scripts/infrastructure/foundry/socket-command-bus.js tests/world-mutation-infrastructure.test.mjs docs/function-passport.md
```

Expected: all bus/coordinator tests pass; commit as `feat: acknowledge typed socket commands`.

---

### Task 4: Make the privileged gateway use the same scheduling policy

**Files:**

- Modify: `scripts/application/privileged-mutation-gateway.js`
- Modify: `tests/privileged-mutation-gateway.test.mjs`
- Modify: `docs/function-passport.md` section 2

- [ ] **Step 1: Add failing direct/remote parity tests**

Prove:

- `registerCommand` forwards the exact same frozen policy to the bus;
- active-GM direct execution calls `runIdempotentScoped` with the resolved keys;
- a remotely received command is outer-scheduled by the bus only once;
- active-GM/auth checks occur again after queue wait;
- both `request-timeout` and `operation-timeout` permit one re-emit with the same request ID only while active GM is unchanged;
- a changed or missing active GM prevents retry and returns an ambiguous-result error;
- `commit(innerKey, operation)` keeps its existing repository-level queue and active-GM guards.

- [ ] **Step 2: Run the focused suite and confirm failures**

Run: `node --test tests/privileged-mutation-gateway.test.mjs`

Expected: new parity tests FAIL.

- [ ] **Step 3: Implement the shared definition**

Change the public internal signature to:

```js
registerCommand(command, { validate, authorize, execute, scheduling })
```

Store one frozen definition and pass its scheduling object unchanged to `socketBus.register`. When the bus invokes gateway `execute`, pass `{ alreadyScheduled: true }` in internal context so the gateway does not acquire a second outer lock. Direct active-GM calls resolve the same policy and acquire `runIdempotentScoped` themselves.

Keep the existing idempotency key exactly:

```js
`${sender.id}\0${command}\0${operationId}`
```

- [ ] **Step 4: Generalize the single retry into same-ID reattach**

Classify only `request-timeout` and `operation-timeout` as ambiguous transport outcomes. Reuse the existing request ID and payload once; never generate a new operation ID. Before re-emitting, compare the current active-GM ID with the original expected ID. Preserve `maxTimeoutRetries` compatibility and cap it at one.

- [ ] **Step 5: Update passport and verify**

Run:

```powershell
node --test tests/privileged-mutation-gateway.test.mjs tests/world-mutation-infrastructure.test.mjs
git diff --check
git diff --stat
git diff -- scripts/application/privileged-mutation-gateway.js tests/privileged-mutation-gateway.test.mjs docs/function-passport.md
```

Expected: both suites pass; commit as `feat: align privileged mutation scheduling`.

---

### Task 5: Classify query, inventory and storage commands

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `tests/world-mutation-infrastructure.test.mjs`
- Modify: `docs/function-passport.md` sections 2 and 7

- [ ] **Step 1: Add failing registration-policy tests**

Capture the definitions registered by `RebreyaMainModule` and assert these exact query commands use `QUERY_SCHEDULING`:

```text
storage.open
storage.journal.read
storage.journal.read-record
storage.triggers.read
door.triggers.read
```

Assert representative inventory/storage payloads resolve the expected normalized keys, and assert a slow mutation on inventory actor A does not delay a query or a mutation on inventory actor B.

- [ ] **Step 2: Add composition-root key helpers**

Use explicit aggregate prefixes and validated identifiers:

```js
const actorKey = (id) => aggregateKey("actor", id);
const documentKey = (uuid) => aggregateKey("document", uuid);
const groupKey = (id) => aggregateKey("group", id);
const storageKey = (uuid) => aggregateKey("storage", uuid);
const lootKey = (id) => aggregateKey("loot", id);
```

Resolvers run only after payload shape validation. If a command cannot derive an exact document key, use the narrow domain key listed below; do not use a silent empty-key fallback.

- [ ] **Step 3: Apply the inventory matrix**

| Command family | Keys |
|---|---|
| take/move/return/transfer | source inventory actor/group + target actor/group |
| sale/dismantle/currency/folder mutation | inventory actor or group actor |
| character item import | group actor + source `itemUuid` document |
| loot ingress | group actor + `lootId` |
| direct/manual ingress | group actor + `inventory-ingress:<sourceOrigin>` |
| inventory reset/migration with unknown footprint | exclusive mutation |

Sort/deduplicate through `normalizeAggregateKeys`; never depend on payload field order.

- [ ] **Step 4: Apply the storage matrix**

| Command family | Keys |
|---|---|
| read/open commands listed above | query |
| trigger save/delete | storage token UUID |
| journal record/claim | storage UUID + character/group actor when present |
| item/currency transfer | storage UUID + target actor/group |
| storage migration/reset with unknown footprint | exclusive mutation |

- [ ] **Step 5: Verify and document**

Run:

```powershell
node --test tests/group-command-dispatch.test.mjs tests/world-mutation-infrastructure.test.mjs tests/inventory-simple-transfer.test.mjs
git diff --check
git diff --stat
git diff -- scripts/main.js tests/group-command-dispatch.test.mjs tests/world-mutation-infrastructure.test.mjs docs/function-passport.md
```

Expected: classification and regression tests pass; commit as `feat: scope inventory and storage socket queues`.

---

### Task 6: Classify every remaining command and enable strict startup validation

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `tests/privileged-mutation-gateway.test.mjs`
- Modify: `docs/function-passport.md` section 2

- [ ] **Step 1: Add a failing completeness test**

Instantiate the composition root with `requireExplicitScheduling: true` and assert all direct-bus and gateway registrations succeed. Add an isolated assertion that a missing policy throws an error naming its command.

- [ ] **Step 2: Classify remaining commands with the following table**

| Domain | Scheduling |
|---|---|
| group registry, calendar, travel, transport, downtime | keyed by group; include affected actor when payload identifies one |
| trader purchase/sale/metadata/audit | keyed by trader document + buyer/seller actor or group |
| combat, grapple, scene activity, performer, disarm | keyed by exact scene/document/actor IDs; use `combat:<sceneId>` when a narrower validated ID is unavailable |
| durability and door mutation | keyed by affected item/token/scene document |
| reputation | keyed by affected group/actor; otherwise `reputation:world` |
| lootgen publish/claim/prepare | keyed by loot/message identity + group/character actor |
| cosmology/global-event/economy setting mutation | keyed by the exact setting/domain name |
| destructive reset, migration, bulk repair with unknown footprint | exclusive mutation |

When one command touches multiple aggregates, return every key. Do not label a command `query` if it writes documents, settings, flags or messages.

- [ ] **Step 3: Enable strict registration**

Construct `SocketCommandBus` and `PrivilegedMutationGateway` in `scripts/main.js` with explicit scheduling required. Missing policy must fail during module startup rather than degrade silently. Keep the non-strict constructor default only for compatibility in isolated tests and downstream internal consumers.

- [ ] **Step 4: Verify the full registration set**

Run:

```powershell
node --test tests/group-command-dispatch.test.mjs tests/privileged-mutation-gateway.test.mjs tests/world-mutation-infrastructure.test.mjs
git diff --check
git diff --stat
git diff -- scripts/main.js tests/group-command-dispatch.test.mjs tests/privileged-mutation-gateway.test.mjs docs/function-passport.md
```

Expected: every typed command has one explicit policy and tests pass; commit as `feat: classify socket command scheduling`.

---

### Task 7: Remove UI refresh from socket completion latency

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/ui-refresh-coordinator.test.mjs`
- Modify: `tests/background-refresh-focus.test.mjs`
- Modify: `docs/function-passport.md` section 19

- [ ] **Step 1: Write failing refresh-latency tests**

Change the existing `runInventoryMutation` test so the default call resolves after the authoritative operation while a deferred inventory refresh is still pending:

```js
const refreshGate = createDeferred();
module.inventoryApp.refresh = () => refreshGate.promise;

const result = await module.runInventoryMutation(async () => ({ ok: true }));
assert.deepEqual(result, { ok: true });
assert.equal(refreshGate.settled, false);
```

Also assert:

- interaction hold is released before the returned promise resolves;
- a refresh rejection produces the existing warning but cannot reject or rewrite the authoritative result;
- `{ awaitRefresh: true }` still waits for explicit non-socket callers;
- no socket command executor invokes `runInventoryMutation` with `awaitRefresh: true`.

- [ ] **Step 2: Run focused tests and confirm default-behavior failure**

Run: `node --test tests/ui-refresh-coordinator.test.mjs tests/background-refresh-focus.test.mjs`

Expected: the new default-background assertion FAILS.

- [ ] **Step 3: Change the method contract**

Use this signature:

```js
async runInventoryMutation(operation, { awaitRefresh = false } = {})
```

After the authoritative operation settles, release the interaction hold, schedule an exact refresh, emit `refresh-scheduled` telemetry, and return/rethrow the operation result. If `awaitRefresh` is false, attach a separate rejection handler that reports the refresh warning. Remove the function-valued simple-vs-legacy exception after every inventory socket registration uses background refresh.

- [ ] **Step 4: Update passport and verify**

Run:

```powershell
node --test tests/ui-refresh-coordinator.test.mjs tests/background-refresh-focus.test.mjs tests/group-command-dispatch.test.mjs
git diff --check
git diff --stat
git diff -- scripts/main.js tests/ui-refresh-coordinator.test.mjs tests/background-refresh-focus.test.mjs docs/function-passport.md
```

Expected: UI refresh tests pass; commit as `fix: complete inventory sockets before refresh`.

---

### Task 8: Add coarse prepared-receipt primitives for inventory recovery

**Files:**

- Modify: `scripts/data/inventory-service.js`
- Modify: `tests/durable-mutation-journal.test.mjs`
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `docs/function-passport.md` section 7

- [ ] **Step 1: Write failing prepared-record tests**

Add coverage that a prepared record contains:

```js
{
  schema: "inventory-coarse-v1",
  kind: "sale" | "dismantle" | "complex-ingress",
  fingerprint,
  senderId,
  sources,
  targets,
  before,
  economicPlan,
  plannedItemIds,
  mergeBefore,
  currencyBefore,
  folderBefore,
}
```

Assert fingerprint conflicts reject, and a new record never calls `checkpoint`. Retain existing tests proving legacy version-1 nonterminal records still resume via the old path.

- [ ] **Step 2: Make test document creation honor Foundry stable-ID options**

Update inventory test fakes so `createEmbeddedDocuments("Item", data, options)` records `options`, preserves supplied `_id` when `keepId: true`, preserves nested IDs when `keepEmbeddedIds: true`, and rejects an existing `_id`. This makes duplicate/collision tests meaningful.

- [ ] **Step 3: Implement private prepared-plan helpers**

Add focused private methods with these responsibilities:

```js
#createPreparedMutationRecord({ kind, mutationId, fingerprint, senderId, sources, targets, before, economicPlan, plannedItemIds, mergeBefore, currencyBefore, folderBefore })
#assertPreparedMutationIdentity(existing, expected)
#allocateCollisionFreeItemId(reservedIds)
#remapPlannedItemGraph(items, idMap)
#createPlannedItems(actor, items)
#traceMutationWrite({ command, requestId, senderId, phase, count })
```

Capture the composition-owned callback in the `InventoryService` constructor as an injected no-op-safe function. The data layer must not import `socket-command-trace.js` or write directly to console.

`#createPlannedItems` must call the public Foundry V13 API:

```js
actor.createEmbeddedDocuments("Item", itemData, {
  keepId: true,
  keepEmbeddedIds: true,
});
```

Before mutation, inspect fresh target documents under the acquired aggregate locks. Allocate collision-free IDs, then remap every in-plan container/parent reference before writing. If runtime state introduces a collision, rebuild the in-memory plan graph and use the new IDs consistently; never partially keep the old graph.

- [ ] **Step 4: Add bounded telemetry counters**

Count journal state writes and Foundry document write calls, not rows. Route counters through the injected trace sink keyed by command/request/sender. Do not record item data, quantities, currency values or names in telemetry.

- [ ] **Step 5: Update passport and verify**

Run:

```powershell
node --test tests/durable-mutation-journal.test.mjs tests/inventory-mutation-recovery.test.mjs
git diff --check
git diff --stat
git diff -- scripts/data/inventory-service.js tests/durable-mutation-journal.test.mjs tests/inventory-mutation-recovery.test.mjs docs/function-passport.md
```

Expected: prepared primitives and unchanged legacy recovery pass; commit as `feat: add coarse inventory recovery receipts`.

---

### Task 9: Convert sale and dismantle to two journal writes

**Files:**

- Modify: `scripts/data/inventory-service.js`
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `tests/inventory-simple-transfer.test.mjs`
- Modify: `docs/function-passport.md` section 7

- [ ] **Step 1: Add failing write-budget and lost-ack tests**

For each of sale and dismantle, assert:

- a successful operation makes exactly two journal persistence calls;
- no `checkpoint` call occurs;
- document mutation order is target credit before source debit;
- retry with the same mutation ID returns the same terminal outcome without duplicate credit/debit;
- failure before source debit compensates the credited target from in-memory receipts and writes one terminal failure/reconciliation record;
- ambiguous document acknowledgement is classified by inspecting fresh source state and exact planned target IDs;
- an unprovable state returns `reconciliation-required` instead of replaying value.

- [ ] **Step 2: Run the new tests and confirm current multi-write behavior**

Run: `node --test --test-name-pattern="sale|dismantle|journal write|lost acknowledgement" tests/inventory-mutation-recovery.test.mjs tests/inventory-simple-transfer.test.mjs`

Expected: write-budget tests FAIL because current code checkpoints phases.

- [ ] **Step 3: Rewrite sale as one prepared plan**

Inside the already-scoped lock:

1. reload source item, inventory actor and currency state;
2. derive quantity/value and capture before revisions/quantities;
3. `start(preparedRecord)`;
4. apply currency credit;
5. apply source debit;
6. `finish(terminalRecord)`.

Store compensation receipts only in memory during the active attempt. On same-ID recovery, compare exact prepared before/after state; finish a demonstrably completed missing step, otherwise return a terminal reconciliation-required outcome. Do not add replacement checkpoints.

- [ ] **Step 4: Rewrite dismantle as one prepared plan**

Use the same six-stage shape, with material credit before source debit. Preallocate every newly created material Item ID and batch compatible material creates/updates. Recovery identifies credits by those IDs plus recorded merge-before state.

- [ ] **Step 5: Update passport and verify**

Run:

```powershell
node --test tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs tests/durable-mutation-journal.test.mjs
git diff --check
git diff --stat
git diff -- scripts/data/inventory-service.js tests/inventory-simple-transfer.test.mjs tests/inventory-mutation-recovery.test.mjs docs/function-passport.md
```

Expected: sale/dismantle write budgets and recovery cases pass; commit as `perf: simplify inventory sale and dismantle recovery`.

---

### Task 10: Convert complex ingress to one batch plan and two journal writes

**Files:**

- Modify: `scripts/data/inventory-service.js`
- Modify: `tests/inventory-transfer-imports.test.mjs`
- Modify: `tests/inventory-mutation-recovery.test.mjs`
- Modify: `docs/function-passport.md` section 7

- [ ] **Step 1: Add failing batch/write-budget tests**

Cover a 20-row ingress containing creates, merges, currency, portable containers and a folder change. Assert:

- journal persistence count is exactly two independent of row count;
- target creates are grouped into the minimum safe `createEmbeddedDocuments` batches;
- compatible updates are grouped;
- folder state is written at most once;
- the full container tree exists before source debit;
- all created IDs equal the prepared plan IDs;
- retry after lost create/update/source-debit acknowledgement cannot duplicate any row;
- an ID collision remaps the entire plan graph before the first write;
- simple eligible ingress still uses `recordTerminal` and one journal write.

- [ ] **Step 2: Run the focused tests and confirm checkpoint failures**

Run: `node --test --test-name-pattern="20-row|complex ingress|container|journal write|collision" tests/inventory-transfer-imports.test.mjs tests/inventory-mutation-recovery.test.mjs`

Expected: complex-ingress write-budget/batching tests FAIL.

- [ ] **Step 3: Build the complete plan before the first world mutation**

Under all resolved aggregate locks, reload sources and target actor, then compute one prepared record for the entire batch. Include every create/update/currency/folder/source-debit action and all preallocated IDs. Validate source revisions and quantities before `start`.

- [ ] **Step 4: Execute grouped document operations**

Apply in this order:

1. target item creates with `keepId` and `keepEmbeddedIds`;
2. target merge updates;
3. currency update;
4. single folder-state update when needed;
5. source debits only after the complete portable container tree exists;
6. terminal `finish`.

Keep per-call in-memory receipts for compensation. Do not write per-row or per-phase checkpoints.

- [ ] **Step 5: Implement exact retry classification**

On repeated mutation ID, inspect planned item IDs, recorded merge-before values, current source state and currency/folder before state. Finish only the missing provable step. If observed state can match more than one history, write/return terminal `reconciliation-required`; never guess and never duplicate value.

- [ ] **Step 6: Update passport and verify**

Run:

```powershell
node --test tests/inventory-transfer-imports.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-simple-transfer.test.mjs tests/durable-mutation-journal.test.mjs
git diff --check
git diff --stat
git diff -- scripts/data/inventory-service.js tests/inventory-transfer-imports.test.mjs tests/inventory-mutation-recovery.test.mjs docs/function-passport.md
```

Expected: 20-row, container, retry and simple-path suites pass; commit as `perf: batch complex inventory ingress recovery`.

---

### Task 11: Run complete verification, live Foundry smoke tests, commit final docs and push

**Files:**

- Modify: `docs/function-passport.md` sections 2, 7 and 19 for final consistency
- Modify: `README.md` only if a public API contract changed
- Modify: `docs/superpowers/specs/2026-09-12-socket-command-latency-design.md` only if implementation exposed a factual mismatch

- [ ] **Step 1: Audit implementation against the specification**

Confirm:

- accepted is emitted after validation/scheduling but before queue wait;
- queries bypass coordinator/cache;
- no result is trusted without transport/envelope/expected-GM agreement;
- auth and active-GM status are fresh immediately before execute;
- disjoint keys overlap, conflicting keys serialize, exclusive is fair;
- refresh is outside socket completion;
- simple/complex journal write budgets are 1/2;
- legacy nonterminal records still use legacy recovery;
- trace records contain no payload or names.

- [ ] **Step 2: Run the complete automated verification once on unchanged HEAD**

```powershell
node --test tests/*.test.mjs

$files = git ls-files '*.js' '*.mjs'
$syntaxFailed = 0
foreach ($file in $files) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { $syntaxFailed++ }
}
if ($syntaxFailed -ne 0) { throw "$syntaxFailed JavaScript syntax checks failed" }

$json = git ls-files '*.json'
$jsonFailed = 0
foreach ($file in $json) {
  try { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
  catch { Write-Error "$file`: $($_.Exception.Message)"; $jsonFailed++ }
}
if ($jsonFailed -ne 0) { throw "$jsonFailed JSON parse checks failed" }

git diff --check
git diff --stat
git diff
```

Record passed/failed counts and real errors, not the full successful log.

- [ ] **Step 3: Run live Foundry VTT 13 two-client smoke tests**

Use one GM and one player client with the module enabled:

1. block/slow mutation A beyond 10 seconds and issue unrelated mutation B; player receives accepted for A and B completes independently;
2. issue two mutations on the same actor; they serialize and both complete;
3. run sale, dismantle and 20-row complex ingress; no false 10-second timeout, no duplicate value, journal writes are 2 per complex operation;
4. keep an inventory render/refresh slow; socket result still completes before render;
5. disconnect/reconnect player after accepted and retry same ID; outcome is returned or explicitly reconciliation-required, never duplicated;
6. change active GM between emit and retry; old-GM result is ignored and no unsafe reattach occurs;
7. inspect GM/player consoles for uncaught errors and privacy-sensitive telemetry.

Do not claim runtime success from Node tests alone. If the local Foundry world is unavailable, report live smoke as not run and do not state that the player-client bug is fully verified.

- [ ] **Step 4: Finalize docs and commit**

Ensure passport signatures, owners, data flow, constraints and focused tests describe current code rather than history. Update README only if callers must know a changed public option or return contract.

Run `git diff --check`, inspect the final diff, and commit documentation-only follow-ups as `docs: finalize socket latency redesign` if there are any.

- [ ] **Step 5: Push safely**

Confirm current branch is `lich_branch`, then:

```powershell
git status --short --branch
git log --oneline origin/lich_branch..HEAD
git push -u origin lich_branch
git status --short --branch
```

Expected: push succeeds without force; working tree is clean. Final report includes commit IDs, automated counts, live-smoke results, any reconciliation limitation, and the deployed module version.
