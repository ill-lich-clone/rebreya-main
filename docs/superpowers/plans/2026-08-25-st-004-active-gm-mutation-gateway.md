# ST-004 Active-GM Mutation Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every ST-004 privileged world mutation through one validated command path so that only the elected active GM writes, concurrent independent edits are preserved, and inactive GMs and players never write the affected world settings locally.

**Architecture:** `RebreyaMainModule` composes one `PrivilegedMutationGateway`, one `SocketCommandBus`, and one `WorldMutationCoordinator` per module instance. The gateway owns active-GM/direct-versus-typed routing and operation identity; typed sockets own authenticated transport, validation, authorization, correlation, and active-GM-only execution; repositories own fresh read-modify-write persistence under setting-scoped queues and may commit only through the gateway's active-GM guard.

**Tech Stack:** Foundry VTT 13.351, dnd5e, ECMAScript modules, Foundry world settings and module sockets, Node.js test runner.

**Spec:** This document is both the ST-004 technical specification and the ordered implementation plan. It intentionally covers no audit finding other than ST-004.

## Global Constraints

- Runtime target remains Foundry VTT 13; no dnd5e behavior or version contract changes.
- `scripts/main.js` remains the only composition root and the only publisher of `game.rebreyaMain` and the module API.
- `scripts/main-<version>.js` remains an import-only forwarder and must not be changed for this work.
- Public API method names and successful return shapes remain compatible unless a batch explicitly states otherwise; `operationId` is an internal gateway concern, not a new macro argument.
- UI code must not write world settings or decide which GM is authoritative.
- Transport authorization uses the authenticated socket sender supplied to `handleSocketMessage(message, senderId)`; payload `senderId`, `userId`, or equivalent identity fields are never trusted.
- Every affected setting mutation performs its read inside the same queue that contains its write.
- No executor may call the outer `world` queue recursively.
- Runtime and documentation changes for one migration owner are made in that owner's separate commit.
- Every new, changed, or removed method must update the relevant section of `docs/function-passport.md` in the same implementation commit.
- Source, JSON, templates, and Russian text remain valid UTF-8.
- Do not redesign unrelated mutation protocols, inventories, trading transactions, calendar transitions, crafting workflows, UI layouts, or multi-document recovery.

---

## 1. Confirmed ST-004 Scope

### 1.1 Observable acceptance result

The implementation is complete only when all four statements are demonstrated by focused tests:

1. A privileged world mutation is executed by exactly the elected active GM module instance.
2. An inactive GM and a player use an exact validated typed command. Unauthorized players receive a correlated `unauthorized` result and still perform no local write.
3. Two simulated module instances with separate coordinators cannot independently write the same shared world setting.
4. Two concurrent independent edits to one object-valued setting both survive in the final authoritative value.

### 1.2 Current defect

The affected public methods either check only `game.user.isGM`, contain no execution gate, or use legacy untyped socket messages. `WorldMutationCoordinator` currently serializes only work scheduled in one browser instance. Two GM browsers therefore own independent in-memory queues and can each read and replace the same object-valued setting.

The lost-update pattern is:

```text
GM A reads { a }
GM B reads { a }
GM A writes { a, b }
GM B writes { a, c }
final value = { a, c }    # b is lost
```

The required path is:

```text
caller
  -> PrivilegedMutationGateway.mutate(command, exactPayload)
      -> elected active GM: direct validated execution
      -> every other client: SocketCommandBus.request(command, exactPayload, same operationId)
          -> only elected active GM handles request
  -> repository reads fresh state inside setting queue
  -> repository writes once
  -> authoritative result
  -> composition-owned scoped refresh
```

### 1.3 Cosmology control example

`setMechanusEnabled(enabled)` is the behavioral control, not a template to copy mechanically:

- it rejects non-GM access;
- it routes an inactive GM through typed command `cosmology.setMechanus`;
- only the active GM calls the setting writer;
- `tests/group-command-dispatch.test.mjs` already proves that the inactive GM produces no local setting write.

ST-004 generalizes this route, adds player authorization, stable retry identity, repository fresh-read queues, and a two-instance regression. Cosmology itself is not migrated or renamed by this plan.

---

## 2. Writer Inventory

| Owner | Public methods in scope | Physical state | Current weakness | Target command(s) |
|---|---|---|---|---|
| `GlobalEventsService` | `createGlobalEvent`, `updateGlobalEvent`, `deleteGlobalEvent`, `duplicateGlobalEvent`, `importDefaultGlobalEventTemplates` | `globalEventsState` | no active-GM route; cached/full-array replacement | `global-events.*` |
| `EconomyRepository` | `updateCityPresentation`, `resetCityPresentation` | `cityPresentationOverrides` | any GM writes locally; stale object replacement | `economy.city-presentation.update` |
| `EconomyRepository` | `setConnectionActive` | `connectionStates` | no execution gate; stale object replacement | `economy.connection.set-active` |
| `EconomyRepository` | `updateReferenceDescription` | `referenceNotes` | no execution gate; stale object replacement | `economy.reference.update-description` |
| `EconomyRepository` | `updateTradeRouteMetadata` | `tradeRouteOverrides` | no execution gate; stale object replacement | `economy.trade-route.update-metadata` |
| `EconomyRepository` | `updateStatePolicy` | `statePolicies` | no execution gate; stale object replacement | `economy.state-policy.update` |
| Economy composition | `resetWorldData` | the five economy settings plus trader state | no active-GM route; concurrent `Promise.all` replacement | `economy.world-data.reset` |
| `TraderService` / `TraderStateRepository` | `recordTraderAudit`, `updateTraderMetadata` | `traderState` | any GM writes locally; audit uses legacy untyped event; fallback direct setting writer exists | `trader.audit.record`, `trader.metadata.update` |
| `DowntimeService` | `grantDowntimeWeeks`, `revokeDowntimeWeeks`, `clearDowntimeHistory`, `createDowntimeRequest`, `updateDowntimeRequest`, `setDowntimeRequestStatus`, `setDowntimeRequestChecks`, `recordDowntimeCheckResult`, `continueDowntimeProject`, `closeDowntimeProject` | `groupState` | several no-gate methods; inactive GM executes locally; player operations use legacy untyped request/result pairs | `downtime.*` |
| `GroupContextService` | `registerPartyGroup`, `setActivePartyGroup` | Group Actor managed flag plus `groupState` | any GM executes locally; no typed route | `group.registry.register`, `group.registry.activate` |
| `InventoryService` group-state compatibility caller | `mergeLegacyInventoryIntoGroup` | Group Actors plus `groupState` | any GM executes locally; stale whole-registry compatibility replacement | `group.inventory.merge-legacy` |
| `GroupStateRepository` | `mutateRegistry`, `mutateGroupState`, legacy whole-registry compatibility write | `groupState` | queue is browser-local; no active-GM persistence guard | repository gateway commit on `setting:groupState` |

`purchaseTraderItem`, `sellTraderItem`, trader rollback, calendar, travel, transport, inventory organization, and cosmology commands are not migration targets. Existing typed contracts for those operations must continue to pass.

---

## 3. Exact Gateway Contract

### 3.1 Canonical interface

Create `scripts/application/privileged-mutation-gateway.js` with this public application contract:

```js
export const PRIVILEGED_WORLD_QUEUE_KEY = "world";

export class PrivilegedMutationGateway {
  constructor({
    commandBus,
    coordinator,
    gameProvider,
    getActiveGm,
    isActiveGmClient,
    operationIdFactory,
    maxTimeoutRetries = 1
  });

  registerCommand(command, {
    validate,
    authorize,
    execute
  });

  mutate(command, payload, {
    operationId = ""
  } = {});

  commit(queueKey, operation);
}
```

Required semantics:

- `registerCommand` rejects an empty or duplicate command and requires `validate`, `authorize`, and `execute` functions.
- `mutate` clones the serializable payload once, chooses or generates one non-empty `operationId`, and preserves that ID for the full call including its one permitted timeout retry.
- Client-side validation runs before routing. Active-GM validation and authorization run again at the authoritative execution boundary.
- If `isActiveGmClient(gameProvider())` is true, `mutate` executes locally through `WorldMutationCoordinator.runIdempotent("world", idempotencyKey, operation)`.
- Otherwise `mutate` calls `SocketCommandBus.request(command, payload, { requestId: operationId })` even when the current user is another GM. It never calls a repository locally.
- `commit(queueKey, operation)` is the only repository write entrypoint. It rejects `queueKey === "world"`, asserts active-GM authority before entering the setting queue, supplies an `assertActiveGm()` guard to the operation, and asserts authority again after the operation resolves.
- `execute` receives the exact payload and this immutable context:

```js
{
  command,                 // exact registered command
  operationId,             // same value as socket requestId
  requestId: operationId,
  sender,                  // authenticated Foundry User
  source,                  // "direct-active-gm" | "typed-command"
  assertActiveGm           // throws code "active-gm-changed"
}
```

- `execute` is a composition-owned closure. It is not exported as a public API and does not refresh UI before persistence succeeds.
- Results and errors retain the current `SocketCommandBus` envelope size limit and correlated result format.

`registerCommand` stores one immutable definition and registers a `SocketCommandBus` adapter using the same `validate` and `authorize` functions. The adapter calls one private `#executeRegistered(command, payload, context)` helper with `source: "typed-command"`; the direct path calls that same helper with `source: "direct-active-gm"`. The socket bus supplies the outer `world` `runIdempotent` call for inbound requests, while the gateway supplies it for direct requests. The adapter must not enqueue `world` a second time.

`#executeRegistered` calls `assertActiveGm()` immediately before and after the domain executor. A domain executor with more than one privileged `await` passes the same guard into its service/workflow and calls it between privileged phases. A guard failure before a write is `active-gm-changed`; a guard failure after an awaited write is mapped to `ambiguous-outcome`, because the write may already be durable and must not be repeated automatically.

### 3.2 Idempotency key

Both direct and socket paths use the same exact key:

```js
const idempotencyKey = `${sender.id}\u0000${command}\u0000${operationId}`;
```

`operationId` identifies one user intent. It is not regenerated because an acknowledgement was lost.

### 3.3 SocketCommandBus extension

Change only the outbound signature:

```js
request(command, payload, { requestId = "" } = {})
```

- A supplied non-empty `requestId` is used verbatim after trimming.
- An omitted ID continues to use the existing factory, preserving all existing typed callers.
- Duplicate pending correlation remains rejected.
- The inbound active-GM-only gate, authenticated transport-sender comparison, exact command lookup, validation, authorization, and result correlation remain in `SocketCommandBus`.
- Existing commands that register directly on `SocketCommandBus` keep their behavior. ST-004 commands register through `PrivilegedMutationGateway.registerCommand`.

### 3.4 Timeout retry policy

The gateway performs at most one automatic retry, only for `SocketCommandError.code === "request-timeout"`.

Before retrying it verifies that the elected active GM ID is unchanged from the first attempt. The retry reuses the same command, payload, sender, and `operationId`. It must not retry validation failures, authorization failures, domain failures, oversized envelopes, missing sockets, or an active-GM election change.

If the second attempt times out, or authority changes after the first request, reject with:

```js
{
  name: "PrivilegedMutationError",
  code: "ambiguous-outcome",
  command,
  operationId,
  message: "Privileged mutation outcome is ambiguous; refresh authoritative state before trying again."
}
```

Do not generate a new ID or silently apply the mutation again. The UI/API caller refreshes authoritative state. The in-memory replay guarantee is bounded by the existing coordinator's 256 completed results and the lifetime of the elected active-GM module instance. This plan does not add a new durable journal for single-setting mutations; therefore no automatic retry crosses an active-GM change or module reload.

---

## 4. Responsibility Split

### 4.1 Composition root: `scripts/main.js`

Composition owns:

- construction order: coordinator -> typed bus -> gateway -> repositories -> services;
- exactly one production gateway per `RebreyaMainModule`;
- registration of every exact command contract;
- sender-aware authorization callbacks;
- capture of group scope before the first `await`;
- executor calls into the existing canonical service/repository;
- authoritative post-commit broadcasts and scoped refresh;
- preservation of public API names and result shapes.

Composition must not:

- read-modify-write a world setting;
- place domain merge rules in socket handlers;
- trust an identity supplied in a payload;
- refresh before the authoritative result is known;
- register a parallel Foundry hook, module API, or socket listener.

### 4.2 Typed sockets

`SocketCommandBus` owns:

- `rebreya.command` / `rebreya.command.result` envelopes;
- request correlation by `requestId + command + userId`;
- 65,536-byte envelope validation and the 10-second attempt timeout;
- binding `message.senderId` to the authenticated transport sender;
- resolving the real Foundry User;
- authoritative `validate -> authorize -> execute` ordering;
- ignoring a command request on inactive GM and player instances;
- in-flight and bounded completed result reuse through the shared coordinator.

Typed sockets do not own domain state, UI refresh, or setting merge logic.

### 4.3 Repositories

Repositories own:

- the physical setting key;
- normalization and detached reads;
- a fresh authoritative read inside the setting queue;
- mutation of a draft or domain aggregate;
- a single normalized setting write;
- cache/model update only after a successful write;
- `assertActiveGm()` immediately before and after the setting write.

Repositories do not decide whether a sender is allowed to request a domain operation and do not emit socket messages.

---

## 5. Repository Persistence Contract

### 5.1 Generic object-setting repository

Create `scripts/infrastructure/foundry/world-setting-mutation-repository.js`:

```js
export class WorldSettingMutationRepository {
  constructor({ mutationGateway, gameProvider });

  readObject(settingKey, { normalize } = {});

  mutateObject(settingKey, mutator, {
    normalize,
    afterCommit = null
  } = {});

  replaceObject(settingKey, value, options = {});
}
```

`mutateObject` executes this algorithm:

```js
return mutationGateway.commit(`setting:${settingKey}`, async ({ assertActiveGm }) => {
  const settings = requireSettings(gameProvider());
  const current = normalize(clone(settings.get(MODULE_ID, settingKey)));
  const result = await mutator(current);
  const committed = normalize(clone(current));
  assertActiveGm();
  await settings.set(MODULE_ID, settingKey, committed);
  assertActiveGm();
  return afterCommit ? afterCommit(result, clone(committed)) : result;
});
```

The mutator must never receive the live setting object. A failed mutator performs zero writes. A failed write performs no cache update. The repository supports object-valued settings only; it is not a replacement for Actor or embedded-document persistence.

If `normalize` is omitted, both `readObject` and mutation methods use a default that returns a detached plain object or `{}` for a non-object/array input. `replaceObject` delegates to `mutateObject`, clears every own key on the fresh draft, assigns a detached normalized replacement, and never calls `settings.set` directly.

### 5.2 Exact queue keys

| State | Inner queue key |
|---|---|
| Global events | `setting:globalEventsState` |
| City presentation overrides | `setting:cityPresentationOverrides` |
| Connection states | `setting:connectionStates` |
| Reference notes | `setting:referenceNotes` |
| Trade-route overrides | `setting:tradeRouteOverrides` |
| State policies | `setting:statePolicies` |
| Trader state | `setting:traderState` |
| Group registry/state | `setting:groupState` |

Every ST-004 public command additionally runs on outer queue `world`. The outer queue orders public intents, including multi-setting reset. Inner queues protect repository callers such as active-GM schedulers that do not originate from a public ST-004 command.

### 5.3 Specialized repositories

- `TraderStateRepository.mutate()` must call `mutationGateway.commit("setting:traderState", ...)` and retain its transaction/audit normalization.
- `GroupStateRepository.mutateRegistry()` and `mutateGroupState()` must call `mutationGateway.commit("setting:groupState", ...)` and retain a fresh read within that call.
- Stale whole-registry replacement is not an allowed public persistence primitive. Batch 5 replaces the known `InventoryService.mergeLegacyInventoryIntoGroup` compatibility callback with `mutateGroupState`, removes `replaceRegistry` and `GroupContextService.setRegistry`, and requires zero runtime references to either removed method.
- `TraderService` must not fall back to direct `game.settings.set` when its repository is absent. Mutation without `TraderStateRepository` is a configuration error.

---

## 6. Typed Command Catalog

All payloads are plain serializable objects with an exact top-level key set. Unknown top-level keys, blank required IDs, non-finite numbers, functions, class instances, and dangerous object keys are invalid. Domain services remain responsible for authoritative entity existence, domain ranges, and state-transition rules.

### 6.1 Global events — GM only

| Command | Exact payload | Executor |
|---|---|---|
| `global-events.create` | `{ data }` where `data` is a plain object | `GlobalEventsService.createGlobalEvent(data)` |
| `global-events.update` | `{ eventId, patch }` | `GlobalEventsService.updateGlobalEvent(eventId, patch)` |
| `global-events.delete` | `{ eventId }` | `GlobalEventsService.deleteGlobalEvent(eventId)` |
| `global-events.duplicate` | `{ eventId }` | `GlobalEventsService.duplicateGlobalEvent(eventId)` |
| `global-events.import-defaults` | `{}` | `GlobalEventsService.importDefaultGlobalEventTemplates()` |

Authorization is exactly `sender?.isGM === true`.

`GlobalEventsService` must replace cached full-array read/replace mutations with one private fresh-state helper. `duplicateGlobalEvent` must not call `createGlobalEvent` while holding the same setting queue; both operations build their change inside one `mutateObject(globalEventsState, ...)` call.

### 6.2 City/economy — GM only

| Command | Exact payload | Additional validation |
|---|---|---|
| `economy.city-presentation.update` | `{ cityId, patch }` | patch keys are a non-empty subset of `description`, `image`; `null` means reset |
| `economy.connection.set-active` | `{ connectionId, isActive }` | `isActive` is boolean |
| `economy.reference.update-description` | `{ entryType, entryId, description }` | strings; description may normalize to empty for deletion |
| `economy.trade-route.update-metadata` | `{ connectionId, patch }` | patch keys subset of `description`, `additionalPricePercent`; number finite |
| `economy.state-policy.update` | `{ stateId, patch }` | patch keys subset of `taxPercent`, `generalDutyPercent`, `bilateralDuties`; all duties finite |
| `economy.world-data.reset` | `{}` | no extra keys |

`resetCityPresentation` constructs a null patch and uses `economy.city-presentation.update`; it does not register a second command. `resetWorldData` runs as one outer `world` intent and replaces the affected settings sequentially, not through `Promise.all`. The plan guarantees ordering against concurrent edits, not atomic rollback across several settings.

### 6.3 Legacy trader writers

| Command | Exact payload | Authorization |
|---|---|---|
| `trader.audit.record` | `{ operation }` | GM, or owner of the Actor identified by `operation.actorId` |
| `trader.metadata.update` | `{ cityId, traderKey, patch }` | GM only; patch keys subset of `portrait`, `description` |

The audit executor discards/overwrites any payload identity and calls:

```js
traderService.recordTradeAudit(operation, {
  senderId: context.sender.id
});
```

The current raw `trader-audit` mutation event, its mutation allowlist entry, and its handler are removed after all callers use `trader.audit.record`. Trader purchase, sale, rollback, transaction markers, and their existing command names do not change.

### 6.4 Downtime commands

| Command | Exact payload | Authorization |
|---|---|---|
| `downtime.weeks.grant` | `{ groupId, actorIds, weeks, reason, fromIsoDate }` | GM only |
| `downtime.weeks.revoke` | `{ groupId, actorIds, weeks, reason }` | GM only |
| `downtime.history.clear` | `{ groupId }` | GM only |
| `downtime.request.create` | `{ groupId, actorId, actionId, title, description, weeks, craftProject, targetActionSelections }` | GM or owner of target member Actor |
| `downtime.request.update` | `{ groupId, actorId, requestId, actionId, title, description, weeks, craftProject, targetActionSelections }` | GM or owner of target member Actor |
| `downtime.request.set-status` | `{ groupId, requestId, status, result }` | GM only |
| `downtime.request.set-checks` | `{ groupId, requestId, checks }` | GM only |
| `downtime.request.record-check` | `{ groupId, actorId, requestId, checkId, result }` | GM or owner of target member Actor |
| `downtime.project.continue` | `{ groupId, actorId, requestId, checkId, result }` | GM or owner of target member Actor |
| `downtime.project.close` | `{ groupId, actorId, requestId }` | GM or owner of target member Actor |

For owner-capable commands, authorization requires all of:

1. `groupId` resolves to a registered managed group;
2. `actorId` is a current member of that exact group;
3. `sender.isGM === true` or the sender has OWNER permission on that exact Actor.

The active executor stamps attribution from `context.sender.id`: `submittedByUserId`, `recordedByUserId`, or `projectClosedByUserId` as appropriate. The payload cannot select attribution.

Composition canonicalizes optional public arguments before calling the gateway, so each typed payload always contains the exact keys shown above: absent strings become `""`, absent arrays become `[]`, absent `craftProject` becomes `null`, and omitted `result` becomes `""` or the command's existing plain result object. Validators require `craftProject` to be `null` or a plain object, `targetActionSelections`, `actorIds`, and `checks` to be arrays, `weeks` to be a positive finite number where applicable, and `result` to be a serializable plain value accepted by the existing domain method. Authoritative action, request, Actor, and group validation still occurs in `DowntimeService`.

Admin public wrappers capture the exact current group ID before the first `await`. Add explicit group scope to service methods that currently resolve the active group implicitly:

```js
grantWeeks({ groupId = "", actorIds = [], weeks = 0, reason = "", fromIsoDate = "" } = {});
revokeWeeks({ groupId = "", actorIds = [], weeks = 0, reason = "" } = {});
clearHistory({ groupId = "" } = {});
setRequestStatus(requestId, status, { groupId = "", result = "" } = {});
setRequestChecks(requestId, checks = [], { groupId = "" } = {});
```

Remove the five legacy downtime mutation request/result pairs and their pending-request plumbing after all five player-capable paths use typed commands. Keep `downtime-updated` only as a non-authoritative post-commit refresh notification; it must not carry or trigger a mutation.

### 6.5 Group registry and legacy inventory merge — GM only

| Command | Exact payload | Executor |
|---|---|---|
| `group.registry.register` | `{ groupActorId }` | `GroupContextService.registerGroup(groupActorId)` |
| `group.registry.activate` | `{ groupActorId }` | `GroupContextService.setActiveGroup(groupActorId)` |
| `group.inventory.merge-legacy` | `{ groupActorId }` | existing `runInventoryMutation(() => InventoryService.mergeLegacyInventoryIntoGroup(groupActorId))` |

Validation requires a non-empty Actor ID; authorization requires `sender?.isGM === true`; the executor verifies that the target is a dnd5e group Actor. `registerPartyGroup`, `setActivePartyGroup`, and `mergeLegacyInventoryIntoGroup` call the gateway even for players, so an unauthorized player gets a typed `unauthorized` response and no local Actor or setting write.

The existing managed-flag plus registry behavior and public result shapes remain unchanged. The implementation must not claim transactional rollback across the Actor flag and world setting.

`GroupContextService.registerGroup(groupActorId, { guard = null } = {})` and `setActiveGroup(groupActorId, { guard = null } = {})` accept the gateway guard internally. They call it before and after `groupActor.setFlag` and before entering the group-state repository. This prevents a client that lost election from beginning the registry write; it does not add rollback for an already committed Actor flag.

---

## 7. Cache, Refresh, and Failure Ordering

For every writer:

1. validate payload;
2. authorize authenticated sender;
3. capture exact group/entity scope;
4. enter outer `world` command queue;
5. enter inner physical-setting queue;
6. read fresh authoritative setting;
7. apply domain mutation to detached state;
8. verify active-GM authority;
9. write once;
10. update service cache/model from the committed value;
11. return authoritative result;
12. broadcast non-authoritative refresh if needed;
13. requester performs scoped refresh.

A repository or domain failure skips cache update and refresh. A refresh failure after commit must not turn the committed mutation into a second mutation attempt. It may be logged/reported separately while the authoritative result remains committed.

If the post-write authority check fails, report `ambiguous-outcome` with the original command and operation ID. Do not reinterpret that result as a safe failure and do not retry it automatically.

Global-event and economy model rebuilds occur after the setting commit and before returning the authoritative domain result. Inactive requesters must not rebuild from a speculative local payload.

---

## 8. Focused Two-Instance Regression Design

Create `tests/privileged-mutation-gateway.test.mjs` in the gateway batch and extend it in the final verification batch.

### 8.1 Harness

Build a deterministic in-memory socket network with:

- shared users: elected `gm-a`, inactive `gm-b`, and `player-a`;
- one shared object-valued setting store;
- separate `game` objects, `WorldMutationCoordinator`, `SocketCommandBus`, `PrivilegedMutationGateway`, and repository instances for each simulated module instance;
- socket broadcast to every instance with the real sender ID passed as `transportSenderId`;
- per-instance setting-write counters;
- deferred gates around the first repository mutation.

The harness must not share a coordinator between instances. Sharing only the fake Foundry users, socket network, and setting store reproduces real browsers.

### 8.2 Required tests

```js
test("inactive GM routes through typed command and performs zero local setting writes", async () => {
  // gm-b calls gateway.mutate(...)
  // assert one rebreya.command envelope from gm-b
  // assert gm-b repository/settings.set count is 0
  // assert gm-a executor count is 1 and gm-a setting write count is 1
  // assert authoritative result resolves back to gm-b
});

test("player uses typed command but unauthorized player never writes", async () => {
  // player-a calls the same GM-only command
  // assert correlated unauthorized error
  // assert every local/player write count is 0 and active executor count is 0
});

test("active direct and inactive typed concurrent independent edits preserve both fields", async () => {
  // block gm-a direct patch after its fresh read
  // start gm-b typed patch while the first command owns outer world queue
  // release the first command
  // assert second read observes first committed field
  // assert final shared setting contains both independent fields
  // assert gm-b local write count remains 0
});

test("timeout retry reuses operation id and active GM executes once", async () => {
  // drop the first result, not the first request
  // trigger the one timeout retry
  // assert both request envelopes have the same requestId
  // assert active execution count is 1 through runIdempotent replay
});

test("gateway does not retry an ambiguous operation after active GM changes", async () => {
  // change elected active GM between timeout and retry decision
  // assert code ambiguous-outcome and only the first request was sent
});
```

### 8.3 Writer-specific coverage

- Global events: two queued independent event edits both survive and cache reflects committed state.
- Economy: two city presentation patches for different city IDs both survive; inactive GM makes no direct repository call.
- Trader: audit and metadata use gateway; authenticated sender overwrites payload identity.
- Downtime: inactive GM uses typed route; player owner is accepted, non-owner rejected; admin operations reject players; legacy mutation requests no longer execute.
- Groups: inactive GM registration/activation/legacy merge uses typed routes; only the active instance performs Actor and setting writes.
- Group repository: concurrent mutations read fresh registry inside one setting queue, active-GM guard rejects a direct inactive write, and legacy inventory merge no longer replaces a stale whole registry.

---

## 9. Invariants and Forbidden Changes

### 9.1 Required invariants

- One elected active GM is the only client that begins an affected setting write.
- Every non-active client uses the same typed command contract as every other non-active client.
- Authorization is evaluated on the active GM against the real Foundry User.
- A physical setting has one canonical inner queue key.
- Direct active and inbound typed commands share the active instance's outer `world` coordinator.
- Read, mutate, normalize, and write are contained in one repository queue operation.
- Independent edits are patches/mutators over a fresh draft, never stale full-object replacements from UI/composition.
- Operation identity is stable across the one allowed timeout retry.
- A lost acknowledgement never causes a retry with a new ID.
- Cache/model/refresh follows commit and cannot become the authority.
- Existing public successful return shapes remain compatible.
- Existing typed purchase/sale/calendar/travel/transport/inventory/cosmology commands remain behaviorally unchanged.

### 9.2 Forbidden changes

- Do not solve this with `game.user.isGM` alone.
- Do not let inactive GMs execute locally and rely on last-write-wins.
- Do not add a second module API, composition root, socket listener, app, or hook.
- Do not place `game.settings.set` in UI, command validators, or composition methods.
- Do not accept a full replacement object when the operation is a field/entity patch.
- Do not trust payload sender identity or active-group selection after an `await`.
- Do not run `Promise.all` over writes that participate in `resetWorldData`.
- Do not call gateway `mutate()` or queue key `world` from inside a command executor or repository commit.
- Do not add an unbounded in-memory or durable idempotency ledger.
- Do not retry across active-GM election change or module reload.
- Do not turn refresh notifications into mutation messages.
- Do not change unrelated world settings, Actor schemas, domain calculations, transaction workflows, or UI behavior.
- Do not claim multi-setting or Actor-plus-setting atomicity that this plan does not implement.

---

## 10. Migration Batches

Each batch has one behavioral owner and ends in its own commit and push. Later batches begin only after `origin/lich_branch` contains the previous batch.

### Batch 0: Privileged gateway and typed transport identity

**Behavior owner:** `PrivilegedMutationGateway`.

**Files:**
- Create: `scripts/application/privileged-mutation-gateway.js`
- Modify: `scripts/infrastructure/foundry/socket-command-bus.js`
- Modify: `scripts/main.js` (construction only; no writer migration)
- Create: `tests/privileged-mutation-gateway.test.mjs`
- Modify: `tests/world-mutation-infrastructure.test.mjs`
- Modify: `docs/function-passport.md` sections 1 and 2

**Interfaces:**
- Produces: `registerCommand`, `mutate`, `commit`; explicit `SocketCommandBus.request(..., {requestId})`.
- Consumes: existing `WorldMutationCoordinator`, `getActiveGm`, `isActiveGmClient`.

- [ ] Write failing gateway tests for active direct routing, inactive typed routing, unauthorized player routing, same-ID timeout retry, election-change refusal, and repository commit guard.
- [ ] Extend bus tests for explicit request ID while preserving factory-generated IDs for old callers.
- [ ] Implement the gateway with one outer queue key and exact execution context.
- [ ] Reorder composition construction without migrating any ST-004 writer.
- [ ] Run `node --test tests/privileged-mutation-gateway.test.mjs tests/world-mutation-infrastructure.test.mjs tests/main-composition-root.test.mjs` and expect zero failures.
- [ ] Update passport signatures, data flow, constraints, and focused tests.
- [ ] Commit only Batch 0 files with message `feat: add active GM mutation gateway`.

### Batch 1: Generic world-setting mutation repository

**Behavior owner:** `WorldSettingMutationRepository`.

**Files:**
- Create: `scripts/infrastructure/foundry/world-setting-mutation-repository.js`
- Modify: `scripts/main.js` (construct/inject only)
- Create: `tests/world-setting-mutation-repository.test.mjs`
- Modify: `docs/function-passport.md` section 2

**Interfaces:**
- Consumes: `PrivilegedMutationGateway.commit(queueKey, operation)`.
- Produces: `readObject`, `mutateObject`, `replaceObject`.

- [ ] Write failing tests proving fresh read inside queue, zero write on mutator failure, normalization before write, post-commit callback ordering, active-GM guard, and independent edit preservation.
- [ ] Implement the object-setting repository exactly as Section 5 specifies.
- [ ] Inject one repository instance in composition without changing current writers.
- [ ] Run `node --test tests/world-setting-mutation-repository.test.mjs tests/privileged-mutation-gateway.test.mjs` and expect zero failures.
- [ ] Update passport and commit with message `feat: add queued world setting repository`.

### Batch 2: Global events migration

**Behavior owner:** `GlobalEventsService`.

**Files:**
- Create: `scripts/application/global-events-mutation-commands.js`
- Modify: `scripts/data/global-events-service.js`
- Modify: `scripts/main.js`
- Create: `tests/global-events-service.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `docs/function-passport.md` sections 2 and 4

**Interfaces:**
- Produces: five command constants and exact validators from Section 6.1.
- Consumes: gateway and `WorldSettingMutationRepository`.

- [ ] Write focused failing tests for all five mutations, GM-only authorization, inactive-GM typed routing, fresh queued event state, duplicate/import non-nesting, and cache update after commit.
- [ ] Replace direct `saveGlobalEvents` setting writes with one private queued event-state mutator.
- [ ] Register commands through the gateway and route existing public methods without changing their successful results.
- [ ] Run `node --test tests/global-events-service.test.mjs tests/group-command-dispatch.test.mjs tests/calendar-transition-coordinator.test.mjs`.
- [ ] Update passport and commit with message `fix: route global events through active GM`.

### Batch 3: City and economy migration

**Behavior owner:** `EconomyRepository`.

**Files:**
- Create: `scripts/application/economy-mutation-commands.js`
- Modify: `scripts/data/repository.js`
- Modify: `scripts/main.js`
- Modify: `tests/city-presentation-overrides.test.mjs`
- Modify: `tests/economy-city-connections.test.mjs`
- Modify: `tests/main-composition-root.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `docs/function-passport.md` sections 2 and 3

**Interfaces:**
- Produces: six command constants/validators from Section 6.2.
- Consumes: gateway and queued object-setting repository.

- [ ] Write failing tests for exact schemas, GM authorization, inactive-GM no-local-write, independent city/route/policy edits, and ordered reset.
- [ ] Inject the queued repository into `EconomyRepository` and replace all six direct setting writers.
- [ ] Route public composition methods through gateway; map reset presentation to the update command.
- [ ] Make `resetWorldData` sequential under outer `world`; preserve current returned model and notification behavior.
- [ ] Run the focused economy/city/composition/dispatch tests listed above.
- [ ] Update passport and commit with message `fix: serialize economy world writers`.

### Batch 4: Legacy trader writer migration

**Behavior owner:** trader state persistence.

**Files:**
- Create: `scripts/application/trader-public-mutation-commands.js`
- Modify: `scripts/infrastructure/foundry/trader-state-repository.js`
- Modify: `scripts/data/trader-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/trader-state-repository.test.mjs`
- Modify: `tests/trader-service.test.mjs`
- Modify: `tests/trader-command-dispatch.test.mjs`
- Modify: `docs/function-passport.md` sections 2 and 5

**Interfaces:**
- Produces: `trader.audit.record`, `trader.metadata.update` exact contracts.
- Consumes: gateway commit for `setting:traderState` and gateway public routing.

- [ ] Write failing tests for active-only repository commit, audit sender binding, owner/GM authorization, metadata GM-only authorization, inactive-GM routing, and removal of raw audit execution.
- [ ] Migrate `TraderStateRepository` from direct coordinator use to gateway commit.
- [ ] Remove the direct-setting fallback from trader mutations.
- [ ] Route audit and metadata public methods through gateway and remove legacy `trader-audit` mutation plumbing.
- [ ] Prove purchase, sale, rollback, marker, and transaction tests remain unchanged and passing.
- [ ] Update passport and commit with message `fix: route trader writers through active GM`.

### Batch 5: Group-state persistence and group registry routes

**Behavior owner:** `GroupStateRepository` and its registry facade.

**Files:**
- Create: `scripts/application/group-registry-mutation-commands.js`
- Modify: `scripts/infrastructure/foundry/group-state-repository.js`
- Modify: `scripts/data/group-context-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/data/inventory-service.js` only at the whole-registry compatibility persistence callback in `mergeLegacyInventoryIntoGroup`
- Modify: `tests/group-state-repository.test.mjs`
- Modify: `tests/group-context-service.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `docs/function-passport.md` sections 2 and 6

**Interfaces:**
- Produces: active-only `setting:groupState` commit, two registry commands, and the exact legacy-merge command.
- Consumes: gateway and existing group normalization functions.

- [ ] Write failing tests that an inactive repository cannot write, concurrent registry edits use fresh state, inactive GM registration/activation/legacy merge route typed, and players are unauthorized without local Actor or setting writes.
- [ ] Migrate registry/state mutation to `mutationGateway.commit("setting:groupState", ...)`.
- [ ] Change the known `InventoryService.mergeLegacyInventoryIntoGroup` compatibility persistence callback to `mutateGroupState(groupActorId, mutator)`, then remove `GroupContextService.setRegistry` and `GroupStateRepository.replaceRegistry`; `rg` must show no runtime caller.
- [ ] Register and route group registration/activation/legacy-merge commands; preserve managed flag, first-active selection, inventory refresh, Quest Log refresh, and SmallTime sync ordering after commit.
- [ ] Run all four focused group tests listed in Files.
- [ ] Update passport and commit with message `fix: enforce active GM group state writes`.

### Batch 6: Downtime migration

**Behavior owner:** `DowntimeService`.

**Files:**
- Create: `scripts/application/downtime-mutation-commands.js`
- Modify: `scripts/data/downtime-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/downtime-service.test.mjs`
- Modify: `tests/group-command-dispatch.test.mjs`
- Verify without planned edits: `tests/character-downtime-service.test.mjs`, `tests/dnd5e-sheet-downtime-tab.test.mjs`, `tests/inventory-app-context.test.mjs`
- Modify: `docs/function-passport.md` sections 2, 6, and 10

**Interfaces:**
- Produces: ten downtime command contracts and explicit service group scope.
- Consumes: active-only `GroupStateRepository` and gateway.

- [ ] Write failing dispatch tests for every command's exact schema and authorization class.
- [ ] Add required explicit group scope to admin service methods and capture it before the first await.
- [ ] Route all public downtime writers through the gateway and stamp sender attribution from command context.
- [ ] Remove legacy downtime mutation request/result handlers, constants, pending maps, and tests; retain only the post-commit refresh broadcast.
- [ ] Prove inactive GM no-local-write, owner success, non-owner rejection, admin player rejection, and concurrent group-state edit preservation.
- [ ] Run the focused downtime, group dispatch, character adapter, sheet, and inventory UI tests affected by call-shape preservation.
- [ ] Update passport and commit with message `fix: migrate downtime to typed active GM commands`.

### Batch 7: Cross-instance acceptance regression and final ST-004 review

**Behavior owner:** ST-004 verification harness; no new runtime behavior.

**Files:**
- Modify: `tests/privileged-mutation-gateway.test.mjs`
- Verify without planned edits: existing focused tests from Batches 2-6

**Interfaces:**
- Consumes all prior batch contracts.
- Produces executable proof of the four acceptance statements in Section 1.1.

- [ ] Run `rg -n "game\\.settings\\.set|settings\\?\\.set|settings\\.set"` over the affected owners and classify every remaining write as repository-internal, unrelated, or a defect.
- [ ] Run `rg` for removed legacy trader/downtime mutation event names and require zero runtime matches.
- [ ] Complete the two-instance tests from Section 8 with separate coordinators and one shared setting store.
- [ ] Verify every public writer in Section 2 routes through `PrivilegedMutationGateway.mutate`.
- [ ] Run the full project verification once on the unchanged final HEAD.
- [ ] Commit test-only coverage or necessary gap fixes with message `test: cover active GM mutation gateway`.

---

## 11. Completion Verification

Every implementation batch runs its focused tests before its commit. Batch 7 runs the full suite once:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Required report:

- exact commands run;
- passed/failed counts;
- real failure text if any;
- confirmation that the inactive instance performed zero local writes;
- confirmation that both concurrent edits exist in the final setting;
- commit hash for each completed batch;
- confirmation that `docs/function-passport.md` matches current methods.

---

## 12. Self-Review Checklist for This Specification

- [x] Scope is limited to ST-004 writers and their shared gateway/persistence substrate.
- [x] Direct and typed routes share an exact operation identity and the active instance's coordinator.
- [x] Queue keys are explicit and tied to physical settings.
- [x] Sender authorization is based on authenticated Foundry users.
- [x] Retry behavior distinguishes safe same-ID replay from ambiguous outcome.
- [x] Repository fresh-read placement prevents independent edit loss.
- [x] Two simulated module instances are required and may not share a coordinator.
- [x] Each migration batch has one behavioral owner and a separate commit.
- [x] Runtime methods are accompanied by passport updates.
- [x] No placeholder, unspecified validator, or open architectural decision remains.

---

## 13. Self-Contained Implementation Handoffs

Use one new task per batch. Do not combine prompts or continue a completed batch in the same task.

### Handoff 0 — Gateway foundation

**Recommended model: Sol high.** The batch defines the active-GM, socket, queue, and retry contract used by every later writer.

```text
Implement Batch 0 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification before editing, then reread only Batch 0 and Sections 3, 4, 8, and 9. The behavior owner is the new scripts/application/privileged-mutation-gateway.js. Touch only the gateway, SocketCommandBus explicit-requestId extension, construction wiring in scripts/main.js, focused gateway/infrastructure tests, and sections 1-2 of docs/function-passport.md.

Observable result: active GM executes direct, inactive GM/player route typed, unauthorized player never writes, one timeout retry reuses the operation ID, and an election change stops retry with ambiguous-outcome. Do not migrate any domain writer yet. Preserve all existing typed commands and SocketCommandBus defaults.

Use focused TDD. Required focused tests:
node --test tests/privileged-mutation-gateway.test.mjs tests/world-mutation-infrastructure.test.mjs tests/main-composition-root.test.mjs

Update docs/function-passport.md for every new/changed method. Before edits run git status --short --branch, git branch --show-current, git fetch origin, compare HEAD with origin/main and origin/lich_branch, and stop for foreign changes or remote advance. Work only on lich_branch. Before commit run focused tests, the AGENTS.md full verification, git diff --check, git diff --stat, and review the substantive diff. Stage only Batch 0 files, commit `feat: add active GM mutation gateway`, and push with `git push -u origin lich_branch`. Never force-push.
```

### Handoff 1 — Queued world-setting repository

**Recommended model: Terra medium.** The contract is fully specified and isolated to one infrastructure owner.

```text
Implement Batch 1 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification, then focus on Sections 5, 7, 9, and Batch 1. The owner is scripts/infrastructure/foundry/world-setting-mutation-repository.js. Batch 0 must already be present on origin/lich_branch.

Create the exact readObject/mutateObject/replaceObject contract. Reads must occur inside `setting:<settingKey>` for mutations; drafts and committed values are detached; active authority is checked immediately before and after setting write; cache callbacks occur only after success. Inject one instance in scripts/main.js but migrate no writer.

Required focused tests:
node --test tests/world-setting-mutation-repository.test.mjs tests/privileged-mutation-gateway.test.mjs

Update section 2 of docs/function-passport.md. Follow the complete lich_branch Git process from AGENTS.md: status/branch/fetch, compare origin/main and origin/lich_branch, stop on foreign work or remote advance, inspect diff/check/stat, run full verification, stage only Batch 1 files, commit `feat: add queued world setting repository`, push -u, and never force-push.
```

### Handoff 2 — Global events

**Recommended model: Terra medium.** This is one service owner with a new focused test and exact command catalog.

```text
Implement Batch 2 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification first, then Sections 6.1, 7-9, and Batch 2. Read only sections 2 and 4 of docs/function-passport.md. The behavior owner is scripts/data/global-events-service.js.

Add exact commands global-events.create/update/delete/duplicate/import-defaults, all GM-only. Route existing public methods through PrivilegedMutationGateway. Replace cached full-array read/replace writes with one fresh queued globalEventsState mutation helper. Duplicate/import must not nest the same setting queue. Cache and economy rebuild happen only after commit. Preserve public method results and existing calendar integration.

Required focused tests:
node --test tests/global-events-service.test.mjs tests/group-command-dispatch.test.mjs tests/calendar-transition-coordinator.test.mjs

Update the passport for all changed/new/removed methods. Follow the complete AGENTS.md Git process on lich_branch, stop on foreign changes or remote advance, run full verification before commit, stage only Batch 2 files, commit `fix: route global events through active GM`, push -u, and never force-push.
```

### Handoff 3 — City and economy

**Recommended model: Terra medium.** The gateway and repository contracts are already fixed; this batch is a single repository migration.

```text
Implement Batch 3 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification, then Sections 5, 6.2, 7-9, and Batch 3. Read only sections 2 and 3 of docs/function-passport.md. The behavior owner is EconomyRepository in scripts/data/repository.js.

Implement the six exact economy commands. Both city update/reset use economy.city-presentation.update. Every setting writer uses WorldSettingMutationRepository and a fresh draft. resetWorldData is one outer world command and writes its settings sequentially, not Promise.all. Preserve model rebuild, notification, refresh, and public return shapes. Do not change economy calculations, read models, assets, UI, or trader transaction behavior.

Required focused tests are the city presentation, economy connections, main composition, and group command dispatch tests named in Batch 3.

Update docs/function-passport.md for changed methods. Follow the complete lich_branch Git process from AGENTS.md, including fetch/comparisons, stop conditions, full verification, diff review, explicit staging, commit `fix: serialize economy world writers`, push -u, and no force-push.
```

### Handoff 4 — Trader writers

**Recommended model: Terra high.** The persistence change must preserve existing transaction, rollback, and audit invariants.

```text
Implement Batch 4 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification, then Sections 5.3, 6.3, 7-9, and Batch 4. Read only sections 2 and 5 of docs/function-passport.md. The behavior owner is trader state persistence across TraderStateRepository and TraderService.

Add exact typed commands trader.audit.record and trader.metadata.update. Audit authorization is GM or owner of operation.actorId; the active executor always supplies authenticated context.sender.id and ignores payload identity. Migrate TraderStateRepository to gateway commit key setting:traderState, remove direct setting mutation fallback, and remove legacy raw trader-audit mutation plumbing. Do not change purchase, sale, rollback, transaction IDs, markers, audit retention, or nonterminal preservation.

Run the trader repository, service, command dispatch, purchase, sale, rollback, and UI lifecycle focused tests before the full verification.

Update docs/function-passport.md. Follow all AGENTS.md Git requirements on lich_branch, stop on foreign work or remote advance, stage only Batch 4 files, commit `fix: route trader writers through active GM`, push -u, and never force-push.
```

### Handoff 5 — Group state and registry

**Recommended model: Sol high.** This batch protects shared group world-state and includes Actor flag plus registry ordering.

```text
Implement Batch 5 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification, then Sections 5.2-5.3, 6.5, 7-9, and Batch 5. Read only sections 2 and 6 of docs/function-passport.md. The behavior owner is the physical group-state persistence boundary in GroupStateRepository; the InventoryService edit is limited to its known legacy whole-registry compatibility callback.

Migrate group setting writes to PrivilegedMutationGateway.commit(`setting:groupState`, ...), preserving a fresh read in the queue. Add typed GM-only commands group.registry.register, group.registry.activate, and group.inventory.merge-legacy. An inactive GM routes; a player sends typed and is rejected; neither performs local Actor/settings writes. Preserve current public results and post-commit refresh/Quest Log/SmallTime ordering. In InventoryService.mergeLegacyInventoryIntoGroup, replace only the known setRegistry(nextRegistry) compatibility persistence callback with mutateGroupState(groupActorId, mutator), then remove GroupContextService.setRegistry and GroupStateRepository.replaceRegistry after rg shows no runtime caller. Do not redesign inventory migration or multi-document recovery.

Required focused tests:
node --test tests/group-state-repository.test.mjs tests/group-context-service.test.mjs tests/group-command-dispatch.test.mjs tests/group-inventory-migration.test.mjs

Update docs/function-passport.md. Follow every AGENTS.md Git step on lich_branch, stop on foreign work or remote advance, run full verification, explicitly stage only Batch 5 files, commit `fix: enforce active GM group state writes`, push -u, and never force-push.
```

### Handoff 6 — Downtime

**Recommended model: Sol high.** This is the largest migration and combines typed sender authorization with shared group-state preservation.

```text
Implement Batch 6 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification, then Sections 6.4, 7-9, and Batch 6. Read only sections 2, 6, and 10 of docs/function-passport.md. The behavior owner is DowntimeService; GroupStateRepository from Batch 5 is the persistence boundary.

Implement all ten exact downtime commands. GM-only admin commands and owner-capable commands must use authenticated sender authorization against the exact registered group and member Actor. Capture groupId before the first await, add explicit group scope to service methods listed in Section 6.4, and stamp audit attribution from context.sender.id. Route every public downtime writer through the gateway. Remove legacy downtime mutation request/result constants, pending maps, handlers, and tests; keep downtime-updated only as a non-authoritative post-commit refresh broadcast. Preserve all public successful return shapes, craft payload validation, request accounting, schedule behavior, and UI adapters.

Run tests/downtime-service.test.mjs and tests/group-command-dispatch.test.mjs plus any affected character downtime, dnd5e sheet, and inventory app focused tests. Then run the full AGENTS.md verification.

Update docs/function-passport.md for every signature and route. Follow the full lich_branch fetch/comparison/stop/diff/stage/commit/push process. Commit `fix: migrate downtime to typed active GM commands`; never force-push.
```

### Handoff 7 — Final acceptance regression

**Recommended model: Sol high.** This is the final risk-focused review of active-GM authority, cross-instance concurrency, and scope containment.

```text
Complete Batch 7 only from:
D:\FoundryVTT\Data\modules\rebreya-main\docs\superpowers\plans\2026-08-25-st-004-active-gm-mutation-gateway.md

Read the full specification and verify Batches 0-6 are present on origin/lich_branch. This is a verification/gap-fix task, not a redesign. The owner is the ST-004 two-instance harness in tests/privileged-mutation-gateway.test.mjs.

Use two simulated module instances with separate WorldMutationCoordinator, SocketCommandBus, gateway, repository, and game objects; share only users, socket network, and setting store. Prove inactive GM zero local writes, player typed rejection, exactly one active executor, preserved concurrent independent edits, same-ID timeout replay, and no retry across election change. Inventory every remaining affected settings.set and removed legacy event name. Fix only demonstrated ST-004 gaps. Do not expand into unrelated findings or refactors.

Run the complete verification from AGENTS.md once on the final unchanged HEAD and report passed/failed counts and any real error. Update docs/function-passport.md only if a runtime method changed during a gap fix.

Follow the mandatory Git process on lich_branch, stop on foreign changes or remote advance, inspect diff/check/stat, stage only Batch 7 files, commit `test: cover active GM mutation gateway`, push -u, and never force-push.
```
