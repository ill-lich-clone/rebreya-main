# Safe Socket Strangler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use `superpowers:test-driven-development` for each task and the task brief as the exact source of requirements.

**Goal:** Ship the first safe Strangler Rewrite slice: a canonical runtime entrypoint, typed world-mutation sockets, active-GM serialization, and a fail-closed legacy setting relay.

**Architecture:** Keep the existing `RebreyaMainModule` as the composition root for unported features. Add pure application coordination and Foundry adapters beside it, then route only recognized mutations through those adapters. The active versioned entrypoint becomes a compatibility forwarder instead of a second full copy.

**Tech Stack:** Foundry VTT v13 ESM, JavaScript modules, Node `node:test`, no new runtime dependencies.

## Global Constraints

- Work only on branch `lich_branch`; never force-push.
- Do not change the persisted `GROUP_STATE` schema or perform destructive migrations.
- Keep existing unported features operational through the legacy handler.
- Only the deterministically selected active GM may execute world-mutating socket requests.
- Use the existing `module.rebreya-main` socket channel (`module.${MODULE_ID}`).
- The current versioned entrypoint imports exactly `./main.js?v=1.4.93-npc-held-natural`, the same canonical URL as supported 1.4.67-1.4.92 forwarders.
- Typed request/result event names are exactly `rebreya.command` and `rebreya.command.result`.
- Typed command names are exactly `group.calendar.patch`, `group.travel.replaceState`, and `cosmology.setMechanus`.
- There is no remote registry-replacement or caller-selected setting/section command. The travel compatibility command may replace only normalized `travelState` for the sender's group.
- Reject typed envelopes whose serialized form exceeds 65536 bytes.
- Reject arbitrary legacy `setSetting` writes and answer a correlated `setSettingResult` failure when `requestId` is present.
- Keep the request timeout at 10000 ms.
- Do not add a production dependency.
- Every production behavior change must be preceded by a focused failing test.
- Run `node --test tests/*.test.mjs` once before each task commit.

---

### Task 1: Canonical Entrypoint And Legacy Boundary

**Files:**
- Modify: `scripts/main-1.4.93.js`
- Modify: `tests/module-manifest.test.mjs`
- Create: `scripts/legacy/settings-socket-relay.js`
- Modify: `scripts/settings.js`

- [ ] Change the manifest-entrypoint test first so the current versioned entrypoint must be one import-only forwarder containing `@rebreya-role active-version-forwarder`, importing exactly `./main.js?v=1.4.93-npc-held-natural`, and containing no `RebreyaMainModule` implementation or lifecycle hooks.
- [ ] Run `node --test tests/module-manifest.test.mjs` and record the expected RED caused by the current duplicated full entrypoint.
- [ ] Replace `scripts/main-1.4.93.js` with the thin forwarder.
- [ ] Mark `scripts/main.js` with `@rebreya-role canonical-composition-root` and make source-inspection manifest tests read implementation details from that canonical file.
- [ ] Move the legacy socket relay constants and response compatibility into `scripts/legacy/settings-socket-relay.js`; mark its public API `@deprecated` and make world-setting requests fail closed.
- [ ] Re-export only the temporary compatibility symbols from `scripts/settings.js`; setting registration remains in `scripts/settings.js`.
- [ ] Run the focused manifest/settings tests and then the full suite.
- [ ] Commit with a meaningful task-scoped message.

### Task 2: Mutation Coordinator And Typed Socket Bus

**Files:**
- Create: `scripts/application/world-mutation-coordinator.js`
- Create: `scripts/infrastructure/foundry/active-gm.js`
- Create: `scripts/infrastructure/foundry/socket-command-bus.js`
- Create: `tests/world-mutation-infrastructure.test.mjs`

- [ ] Write focused tests for keyed serialization, queue recovery after rejection, bounded duplicate-request reuse, deterministic active-GM election, active-GM fallback for a single mocked GM, request/result correlation, unknown-command rejection, and the 65536-byte envelope limit.
- [ ] Run `node --test tests/world-mutation-infrastructure.test.mjs` and record RED because the new modules do not exist.
- [ ] Implement the dependency-free coordinator and Foundry adapters with injectable game/timer/id factories for isolated tests.
- [ ] Ensure a duplicate request ID returns the original settled result without re-running its handler.
- [ ] Ensure inactive GMs and players do not execute registered handlers.
- [ ] Run the focused test and then the full suite.
- [ ] Commit with a meaningful task-scoped message.

### Task 3: Atomic Group State Repository

**Files:**
- Create: `scripts/infrastructure/foundry/group-state-repository.js`
- Modify: `scripts/data/group-context-service.js`
- Create: `tests/group-state-repository.test.mjs`
- Modify: `tests/group-context-service.test.mjs`

- [ ] Write failing tests proving the repository queue covers the complete fresh-read, mutation, normalization, and setting-write transaction; concurrent registrations of two groups must preserve both.
- [ ] Add failure-recovery and different-group serialization tests; the setting is one global value, so the queue key is global rather than per group.
- [ ] Run the focused tests and record RED because the repository does not exist and `registerGroup` still performs stale read-modify-write.
- [ ] Implement `read`, `mutateRegistry`, `mutateGroupState`, and a clearly deprecated `replaceRegistry` compatibility method using the injected `WorldMutationCoordinator`.
- [ ] Make `registerGroup` and `setActiveGroup` use mutation callbacks whose fresh read occurs inside the queue.
- [ ] Do not change the registry schema. Keep the existing player `setRegistry` relay temporarily until Task 4 migrates its remaining player call sites.
- [ ] Run focused tests and then the full suite.
- [ ] Commit with a meaningful task-scoped message.

### Task 4: Typed Command Wiring And Raw Setting Shutdown

**Files:**
- Modify: `scripts/data/group-context-service.js`
- Modify: `scripts/data/calendar-service.js`
- Modify: `scripts/data/travel-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/legacy/settings-socket-relay.js`
- Modify: `tests/group-context-service.test.mjs`
- Modify: `tests/calendar-service.test.mjs`
- Create: `tests/group-command-dispatch.test.mjs`

- [ ] Replace the positive raw `setSetting` tests with failing tests proving no setting is written and a correlated failure with code `raw-setting-disabled` is emitted.
- [ ] Add failing black-box tests for `group.calendar.patch`, normalized `group.travel.replaceState`, `cosmology.setMechanus`, unknown-command rejection, sender-group authorization, and `Promise.all` date/time patches preserving both latest fields.
- [ ] Run the focused tests and record RED before production edits.
- [ ] Construct one coordinator and one `SocketCommandBus` in `RebreyaMainModule`; pass the coordinator to the group repository and dispatch typed messages before legacy branches.
- [ ] Make calendar send only changed `isoDate`/`timeOfDaySeconds` fields for non-active clients. Make travel use the normalized travel replacement command for non-active clients.
- [ ] Validate calendar/travel payload shape on the active GM; authorize only GM senders or senders whose owned character belongs to the requested managed group. This is defense in depth, not cryptographic authentication.
- [ ] Register `cosmology.setMechanus` as GM-only and route non-active GM calls through it.
- [ ] Make `GroupContextService.setRegistry` a deprecated GM-only compatibility method and remove `requestSettingsUpdate` from the live composition root/group service.
- [ ] Reject legacy `setSetting` without a write/refresh and emit correlated `setSettingResult { ok: false, errorCode: "raw-setting-disabled" }` when possible.
- [ ] Run focused tests and then the full suite.
- [ ] Commit with a meaningful task-scoped message.

### Task 5: Active-GM Legacy Socket Gate

**Files:**
- Modify: `scripts/main.js`
- Modify: `tests/downtime-service.test.mjs`
- Modify: `tests/inventory-service.test.mjs` if the existing fixture is the tighter home for inventory request coverage

- [ ] Add failing tests showing two active GM clients receive one request but only the elected GM mutates, and two concurrent legacy mutation requests execute serially.
- [ ] Run the focused tests and record RED.
- [ ] Classify existing world-mutating request types in one explicit allowlist and route them through the same active-GM `world` coordinator before invoking the unchanged legacy handler.
- [ ] Keep result, refresh, and display messages outside the mutation queue.
- [ ] Verify a failed legacy mutation does not poison the next queued request.
- [ ] Run focused tests and then `node --test tests/*.test.mjs`.
- [ ] Commit with a meaningful task-scoped message.

### Task 6: Whole-Branch Verification And Handoff

**Files:**
- Modify only if review finds a concrete defect.

- [ ] Generate task review packages and obtain clean spec-compliance and quality verdicts for Tasks 1-5.
- [ ] Obtain a final whole-branch code review.
- [ ] Inspect `git diff origin/main...HEAD` and `git status --short --branch`.
- [ ] Run `node --test tests/*.test.mjs` from a clean working tree.
- [ ] Run `node --check` for every reachable/current JavaScript source, including `scripts/main-1.4.93.js` and excluding historical full entrypoints.
- [ ] Push `lich_branch` to `origin` without force.
