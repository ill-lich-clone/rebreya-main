# Safe Socket Strangler Design

**Date:** 2026-07-10

**Status:** Approved for implementation

## Goal

Introduce the first Strangler Rewrite slice without replacing working game features: make the live entrypoint canonical, route world mutations through one active GM, replace the arbitrary world-setting socket write with typed commands, and keep the unported runtime available as an explicit legacy fallback.

## Safety Contract

- No destructive data migration and no change to persisted `GROUP_STATE` schema in this slice.
- The current `scripts/main.js` runtime remains the fallback for every feature not explicitly moved to the new application/infrastructure files.
- `module.json` continues loading a versioned file for Foundry cache busting, but that file becomes a thin legacy compatibility shim that imports the canonical runtime.
- New socket code is preferred when it recognizes a typed command. Unrecognized messages continue through the existing handler.
- World-mutation requests are handled by one deterministically selected active GM and serialized before they reach legacy feature handlers.
- The generic `setSetting` request is never allowed to write a world setting. It receives a negative compatibility response so old clients fail closed instead of hanging.
- Payloads have a hard serialized-size limit and a strict envelope/command allowlist.
- The protocol does not claim cryptographic sender authentication: Foundry's raw module socket does not provide trusted sender metadata to the callback. Authorization therefore uses the declared sender mapped to a current Foundry user, while the removal of arbitrary setting writes limits the blast radius.

## Runtime Layout

### Canonical and legacy entrypoints

- `scripts/main-1.4.93.js` is a cache-busted legacy shim only and imports the exact shared URL `./main.js?v=1.4.93-npc-held-natural`, matching the supported 1.4.67-1.4.92 forwarders so Foundry cannot instantiate the composition root twice.
- `scripts/main.js` is the canonical composition root loaded by that shim and by tests, marked `@rebreya-role canonical-composition-root`.
- Unported feature modules keep their existing paths and behavior. They are legacy by ownership, not copied or renamed during this slice.

### New application layer

- `scripts/application/world-mutation-coordinator.js` owns keyed promise queues and bounded idempotency results. It has no Foundry dependency.

### New Foundry infrastructure

- `scripts/infrastructure/foundry/active-gm.js` deterministically selects the one active GM and exposes `isActiveGmClient`.
- `scripts/infrastructure/foundry/socket-command-bus.js` validates typed request/result envelopes, enforces the payload limit, correlates client requests, and dispatches allowlisted handlers only on the active GM.
- `scripts/infrastructure/foundry/group-state-repository.js` owns serialized reads and writes of `SETTINGS_KEYS.GROUP_STATE` and exposes a narrow group-section update operation.

### Legacy boundary

- `scripts/legacy/settings-socket-relay.js` contains the deprecated arbitrary-setting protocol constants/response compatibility only. It is not a write path.
- `scripts/settings.js` remains responsible for Foundry setting registration and may re-export legacy symbols temporarily for source compatibility, marked `@deprecated`.

## Typed Protocol

Requests use the existing `module.rebreya-main` channel (`module.${MODULE_ID}`):

```js
{
  type: "rebreya.command",
  command: "group.calendar.patch",
  requestId: "...",
  senderId: "...",
  payload: { groupActorId, patch: { isoDate: "1200-02-03" } }
}
```

Results use:

```js
{
  type: "rebreya.command.result",
  command: "group.calendar.patch",
  requestId: "...",
  forUserId: "...",
  senderId: "...",
  ok: true,
  data: { ... }
}
```

The first allowlisted group commands are `group.calendar.patch` and `group.travel.replaceState`. A calendar patch accepts only `isoDate` and `timeOfDaySeconds`, validates them on the active GM, and applies only fields that changed on the client; it cannot select another setting or group-state section. The travel compatibility command accepts only a normalized `travelState` for the sender's own group; it exists to preserve the current player travel UI until route/progress commands are split further. There is no `group.registry.replace` or caller-selected section/key command. Downtime, inventory, trade, quest, migration, and balances continue through their dedicated GM-side application operations.

The first GM-only command is `cosmology.setMechanus`. It replaces the only other caller of the legacy arbitrary setting relay.

## Concurrency Model

The composition root classifies legacy socket requests that mutate world state. The active GM runs those handlers through the coordinator's single `world` queue. Result/display messages bypass the queue. Typed commands use the same queue. Duplicate typed `requestId` values return the cached result and do not execute a mutation twice.

`GroupStateRepository.mutateGroupState` reads the latest registry inside the queue, runs a server-owned mutation callback, normalizes the resulting registry, and then persists it. Calendar commands patch only changed date/time fields, so simultaneous calendar actions preserve each other. The travel compatibility command replaces only `travelState`; it cannot touch other group fields. Full-registry replacement remains a deprecated GM-only compatibility operation until each legacy writer is moved to a mutation callback.

## Error Handling

- Invalid envelopes, oversized payloads, unknown commands, inactive-GM handling, missing users, unauthorized groups, and forbidden sections fail without a setting write.
- A typed request always receives a correlated success or failure result from the active GM when a handler starts.
- Legacy `setSetting` receives `setSettingResult` with `ok: false` and a migration error message.
- Queue failures do not poison later operations; cleanup happens in `finally`.

## Verification

- Unit tests cover active-GM election, queue serialization/recovery/idempotency, envelope validation, timeout/result correlation, allowlisting, and payload limit.
- Integration tests cover raw `setSetting` rejection, typed calendar/travel updates, unauthorized section rejection, concurrent section preservation, and one-GM-only handling.
- Manifest tests read the actual manifest entrypoint and require it to be a thin forwarder to canonical `main.js`.
- The complete `node --test tests/*.test.mjs` suite and syntax checks must pass before push.

## Deferred Strangler Slices

The following accepted fixes remain required but are deliberately not mixed into this socket foundation:

1. inventory/trading transaction journal with idempotent phases and compensations, including decrementing trader stock;
2. per-group crafting state;
3. non-destructive compendium diff/upsert with preflight validation and active-GM lock;
4. extraction of combat/sheet god files;
5. removal of legacy implementations only after characterization tests and a real-world smoke test.
