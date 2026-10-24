# Player Sync Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove avoidable player action waits and repeated intents while preserving quantities, permissions and recovery of multi-document transfers.

**Architecture:** Keep SocketCommandBus, the existing scheduler, UiRefreshCoordinator and HeroDollService as their canonical owners. Join identical pending requests, canonicalize actor footprints and render independent apps independently. Route eligible owned singleton doll edits through native Documents; retain GM workflows for splits, swaps and transfers.

**Tech Stack:** Foundry 13, dnd5e, native JavaScript ESM, Node test runner; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-player-sync-simplification-design.md` (approved 2026-10-25).

## Global Constraints

- Work and push only on `lich_branch`; stop for unrelated dirty work or remote advancement.
- User explicitly authorized continuous plan + implementation + tests + version + commit + push; no second plan-approval pause.
- Preserve IDs, quantities, fractional precision, held/equipped rules, slot/preset/ghost semantics, access checks, formulas, prices, budgets, currencies and recovery receipts.
- No new global lock, rollback engine, framework, dependency or replacement public API.
- Timeout is an unknown outcome, not cancellation; never change intent ID merely because it timed out.
- Owner fast path excludes quantity changes, cross-Actor transfers, occupied-slot swaps and legacy normalization.
- Retain native Foundry ownership/concurrent-update semantics; never claim cross-client atomicity.
- Bump module from 1.5.2 to 1.5.3, update forwarder, relevant runtime imports/cache URLs and passport.
- Run focused tests per change and the required full verification once before the final runtime commit.

## Review Focus

- A pending request's original payload is mutated by its caller: duplicate comparison must use a detached original, not a live reference (Task 1).
- Same world Actor represented by ID/UUID and a group source represented by Actor/Item: scheduling must overlap; different synthetic Actors remain independent (Task 2).
- Requests arrive during an active render or a render throws: same app remains ordered, unrelated callers complete independently (Task 3).
- An Item disappears or a slot changes between owner writes: no false success or rollback of someone else's newer fields (Task 4).
- A timeout or concurrent identical click occurs during a durable operation: preserve original intent, no new transaction or false failure UI (Tasks 1 and 4).

## Task 1: Join matching pending socket requests

**Files:** `scripts/infrastructure/foundry/socket-command-bus.js`, `tests/world-mutation-infrastructure.test.mjs`, `tests/privileged-mutation-gateway.test.mjs`.

**Interfaces:** Preserve `request(command, payload, {requestId = ""} = {}) -> Promise`. Identical pending correlation + serialized payload returns the same promise; conflicting payload still rejects `duplicate-request`. Existing result/error/timeout correlation remains unchanged.

- [x] Add regressions: three matching requests emit once and resolve/reject together; reordered object keys remain identical; mutated caller payload conflicts; timeout frees pending state; different IDs remain independent.
- [x] Run `node --test tests/world-mutation-infrastructure.test.mjs tests/privileged-mutation-gateway.test.mjs`; observe the new matching-pending test fail.
- [x] Store detached comparable payload and shared promise in the existing pending entry; reuse existing serializable-payload constraints. Avoid changes to server completed/in-flight dedup.
- [x] Re-run these suites; expected zero failures. Preserve the conflicting-payload rejection test.

## Task 2: Canonical scheduling footprints

**Files:** `scripts/application/socket-command-scheduling.js`, `scripts/main.js`, affected command registration owners if found; `tests/world-mutation-infrastructure.test.mjs`, `tests/main-composition-root.test.mjs`.

**Interfaces:** Keep `aggregateKey(kind, identity) -> string` and `normalizeAggregateKeys(keys) -> frozen string[]`. Canonical actor keys use bare world ID for world actors, full UUID for synthetic actors. Group Actor keys share the same Actor resource. Document keys retain document identity and add their owning Actor conflict where relevant.

- [x] Add tests demonstrating world ID/UUID overlap, distinct synthetic Actors, group/Item footprints and unrelated actors progressing while a conflicting actor is held.
- [x] Run focused infrastructure/composition tests; expected new canonicalization assertions fail.
- [x] Normalize identities in the existing scheduling owner, and declare source/target actor keys for hero commands and other inspected registrations that omit their known owner. Keep non-Actor documents and exclusive policies unchanged.
- [x] Re-run infrastructure/composition and affected registration suites; expected zero failures. Audit registrations for synthetic IDs without inferring unknown token identity.

## Task 3: Independent UI refreshes

**Files:** `scripts/infrastructure/ui/ui-refresh-coordinator.js`, `tests/ui-refresh-coordinator.test.mjs`.

**Interfaces:** Preserve `request(tasks = []) -> Promise<PromiseSettledResult[]>`. Coalesce pending same-turn tasks by key, serialize each app's own render, allow different keys concurrently; returned promise includes only this caller's requested tasks.

- [x] Add tests: held render A does not delay B; first caller does not await later same-key work; same-key pending requests coalesce; failures and reentrant requests do not strand callers.
- [x] Run `node --test tests/ui-refresh-coordinator.test.mjs`; expected independent-caller regression fails.
- [x] Replace the global batch drain with pending/active entries per existing app key; retain settled-result error isolation and microtask batching.
- [x] Re-run the suite plus `tests/background-refresh-focus.test.mjs`; expected zero failures.

## Task 4: Native owner doll route and stable intents

**Files:** `scripts/data/hero-doll-service.js`, `scripts/ui/inventory-app.js` only if its pending intent/error handling needs correction, `tests/hero-doll-instances.test.mjs`, new `tests/hero-doll-owner-route.test.mjs`, existing `tests/helpers/item-instance-documents-fixture.mjs` if Foundry-double semantics need completion.

**Interfaces:** Keep public `assignItemToSlot(actor, slotId, dropData)` and `clearSlot(actor, slotId)` return contracts and existing GM executors. Existing `#submitAssignment` chooses owner route only for a validated same-Actor singleton and permitted non-swap placement, without discarding a pre-existing ambiguous GM intent. Reuse current slot/equipped builders; per-client Actor order and pending-intent sharing stay inside HeroDollService.

- [x] Add owner tests before code: owner without GM equips/clears/moves singleton, 0 custom calls and 0 world writes, same item ID/quantity, held state and ghost behavior preserved; non-owner and invalid slot rejected before writes.
- [x] Add fallback tests for stack/split, group source, occupied slot, normalize and existing ambiguous GM intent. Verify no accidental local fallback after an unknown remote outcome.
- [x] Add repeat-click and partial-failure tests using real service + bus where appropriate: one pending intent; confirmed rejection permits retry; unknown outcome preserves ID; deleted item/concurrent changed slot cannot produce false success or overwrite later state.
- [x] Run owner and existing hero instance/preset/service suites, observe newly required owner behavior fail.
- [x] Implement narrowly in HeroDollService. Read fresh Actor/Item state at execution, reuse validators and equipped/held logic, apply minimal slot patches. Restore only affected fields still matching this operation's attempted values on failure; report ambiguous/changed state instead of resetting newer changes. No durable journal in eligible path.
- [x] Classify other player mutation routes in the passport: native owner, GM-required, deferred multi-document. Update timeout/unknown-outcome display and intent retention only where needed; no broad migration of other behaviors.
- [x] Run owner/hero/inventory focused suites; expected zero failures, including all pre-existing quantity/transfer/recovery tests.

## Task 5: Integration, release and verification

**Files:** `module.json`, new `scripts/main-1.5.3.js` (retain published `main-1.5.2.js` compatibility forwarder), runtime cache imports of changed modules, `README.md` relevant API section, `docs/function-passport.md`, this plan.

**Interfaces:** Public API and persisted schemas unchanged. The deliberate duplicate-request contract and native owner eligibility are documented.

- [x] Update passport signatures/dataflow/tests and README, bump version/forwarder and cache references. Verify no stale release entrypoint and no multiple ESM identities for modified shared owners.
- [x] Fresh independent review of final diff against approved spec, including five Review Focus cases. Resolve important findings with regression tests; record decisions and limitations in ledger.
- [x] Run `node --test tests/*.test.mjs`, collect exact pass/fail counts and actual failures. Run `node --check` on tracked JS/MJS plus new runtime files; parse tracked JSON; run `git diff --check`.
- [x] Attempt existing live Foundry test connection; use only a dedicated test world for mutations. If unavailable, report the exact limitation without claiming GM/player runtime validation.
- [x] Verify branch/remote and final diff, stage only task files, commit and `git push -u origin lich_branch`. Record final commit and checks. Expected clean branch synchronized with origin.

## Execution decisions

- Use the existing clean `lich_branch` checkout as requested, without another worktree.
- One final runtime commit after full verification, rather than one commit per task, so no intermediate unversioned release is committed. Plan/spec and progress still preserve task boundaries.
- The current 159-test baseline was already verified on unchanged source during the approved investigation; reuse it and add focused regressions.
- Scratch ledger and command logs used `.superpowers/sdd/2026-10-25-player-sync-simplification/`; shell-only skill helpers were adapted to PowerShell. Important rulings and results are retained below; scratch files are removed after successful release.
## Review and verification record

- Tasks 1–4 followed regression RED → GREEN: shared pending bus 56/56; scheduling/registration 289/289; refresh 34/34; owner/instance/inventory workflows 146 passed, 1 existing skip, 0 failed.
- Fresh independent Gemini 3.8 Flash High review found a valid partial-failure case: when another Item takes the target slot, restore this operation's equipped flag only if source quantity, hands and placements still match. Added a failing assertion and fixed it; combined owner/presets/refresh/manifest checks: 146/146 passed.
- Two critical review claims were disproved by original source and tests: `clearSlot` supplies the full Item UUID; authorization explicitly handles a missing Item before the typed `item-not-found` rejection. The existing fingerprint supports primitive/array comparisons by design. Same-key self-awaited renders are a self-dependency; current composition tasks do not do this, and supported non-awaited reentrancy is tested. No actionable review findings remain.
- Published entrypoints remain available, including 1.5.2; the new manifest points only to 1.5.3. All forwarders import bare `main.js`, preserving one composition root. Local HTTP HEAD confirmed `Cache-Control: no-store` for main.js. All runtime imports of the five changed owners share `?v=1.5.3`; a regression test enforces this. Unchanged subsystem cache keys remain unchanged.
- Live GM/player validation unavailable: no Foundry MCP tool was exposed; Playwright reported its shared browser profile already in use. No browser was taken over and no production-world mutation was performed. Native replication behavior across real clients remains to be checked in a dedicated test world.
- Integration choice is explicit user authorization: commit and push only `lich_branch`, with no main/master merge, force push or new PR. Final spec remains `docs/superpowers/specs/2026-10-24-player-sync-simplification-design.md`.
- Full `node --test tests/*.test.mjs`: 5019 total, 5018 passed, 0 failed, 1 skipped. The existing rendered-ghost template test skips because Foundry Handlebars is not available to Node (`NODE_PATH`); new owner ghost behavior is covered separately.
- First full run exposed four test integration failures after the release bump: stale 1.5.2 manifest expectation and test prototype/instance imports using the previous ESM URLs. Updated test imports to the actual runtime URLs without removing assertions; affected composition/manifest suites passed 126/126, then the full suite passed as above.
- `node --check` across all tracked JS/MJS and new runtime/test files: 1059 checked, 0 errors. Both subsequently changed test files were checked again. `Get-Content -Raw -Encoding UTF8 <tracked JSON> | ConvertFrom-Json`: 58 checked, 0 errors. `git diff --check`: clean.
- Pre-commit fetch: current branch `lich_branch`, `HEAD...origin/lich_branch = 0/0`, `HEAD...origin/main = 91/0`, no incoming main commits or unrelated dirty files. Release commit message: `fix: reduce player action contention and simplify hero equipment`; final commit hash and push result are reported with delivery.
