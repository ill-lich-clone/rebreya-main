# Hero doll native update regression

This repairs the approved player-sync specification, without changing its scope or public contracts. The user reported false `stale-slot` errors from version 1.5.3 at `HeroDollService.#writeOwnerAssignment:444` and a 5–10 second period of failed follow-up interactions. Previous authorization covers implementation, checks, versioning, commit and push to `lich_branch`.

## Evidence and cause

- Installed Foundry 13 `common/abstract/document.mjs:700` adds `_id` to the caller's update object.
- `client/data/client-backend.mjs:205–221` expands dotted paths, deletes the original object's keys and assigns the expanded data back into that same object.
- The owner route passes its expected `itemPatch` directly to `item.update`, then reads `itemPatch["system.equipped"]` after the await. That key is now absent, so a successful boolean write is compared to `undefined`. The same mutable object is used by compensation checks.
- The existing fake Item applies dotted fields without mutating the argument, hiding the failure. No evidence supports a coordinator lock TTL or a need to increase delays.
- Foundry updates the visible document before awaiting its post-operation completion; visual change alone does not prove the native update Promise has settled. Exact live latency remains unmeasured because the available browser profile is occupied.

## Observable result and preserved contracts

Successful singleton equip/clear/move must not throw `stale-slot` merely because Foundry normalizes its input. A later queued assignment proceeds after native acknowledgement without artificial cooldown/retry. Preserve permissions, ID/quantity, heldHands, ghosts/presets, real-conflict checks and compensation. Keep complex GM workflows and ambiguous remote intent IDs unchanged.

## Approach

Pass a disposable shallow copy of the flat boolean Item patch to the native update; keep the original expected values for verification and recovery. The sole patch value is a primitive boolean, so deep cloning or a new snapshot abstraction is unnecessary. Do not remove verification, add timers or change native Document confirmation semantics.

## Verification and release

Regressions must emulate Foundry's mutation of the original update argument for assign and clear, successful early visible changes with pending acknowledgement, and compensation after a failed placement. Existing genuine-conflict and hook-cancellation tests remain. Update the passport, bump to 1.5.4, keep published forwarders, and refresh only the changed hero service's ESM cache key. Run focused and full required checks; commit and push `lich_branch`.
