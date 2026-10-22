# Inventory Coin Weight and Capacity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the preserved Native execution method. Use TDD and one independent final Gemini review.

**Goal:** Count coins at 50/lb and make committed member capacity edits persist and refresh the shown group immediately.

**Architecture:** Extend the existing read-only inventory weight adapter. Extend the existing group command/service/refresh flow for scoped member updates; keep the current formula and repository owners.

**Tech Stack:** JavaScript ESM, Foundry v13/dnd5e 5.2.5, Node test runner, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-22-inventory-coin-weight-capacity-design.md` (approved by the user on 2026-10-22).

## Global Constraints

- Use the current installed checkout on lich_branch; no main/master edits, force push or parallel product-code worker.
- Coin weight is actual count /50 lb for cp/sp/ep/gp/pp, independent of value, conversion or native currency-weight settings.
- Preserve native Item weights, units, nesting, malformed-hierarchy fallback and weightlessContents; no currency/Item writes in the adapter.
- Preserve STR x multiplier + bonus, current numeric normalization, blank fallbacks, role/vehicle rules and W+U / B+C storage accounting.
- Capture the shown group before await. Preserve existing method calls; explicit invalid scope cannot fall back to a different group.
- Native group writes use validated typed commands, current membership/permission checks and the existing repository/active-GM guards.
- Deliver 1.4.399 with synchronized forwarder/cache imports and README/passport updates; commit/push only this task's files after all checks.

## Review Focus

1. Native contents/totalWeight getters already include container currency when enabled: replace that contribution rather than adding coins twice.
2. Nested magical bags suppress physical coin weight while retaining internal used capacity; wallet coins remain outside those bags.
3. Same member in groups A/B, shown A while B is active, and switching scope during await must never write/refresh B.
4. An inactive authorized client must reach the active GM; missing/removed member or lost authority must fail before a wrong write.
5. A saved value with stale UI is insufficient: the real refresh selector must include the group window; source/formula assertions alone do not prove the screenshot case.

## Task 1: Add fixed coin weight to the canonical adapter

**Files:** `scripts/data/inventory-weight.js`; new `tests/inventory-weight.test.mjs`; affected assertions in `tests/group-inventory-migration.test.mjs`.

**Interfaces:** Preserve `buildActorInventoryWeightSnapshot(actor) -> {weightLb,magicalContainers}` and `buildInventoryStorageProfile(snapshots,baseCapacityLb)` unchanged. Add private `currencyWeightLb(currency={}) -> number`; count finite nonnegative integer currency amounts, tolerating numeric strings and ignoring invalid values. Inside the snapshot, use the existing normalized parent/child graph and private carried/contents currency-delta helpers.

- [x] Add pure regressions first. Every pure denomination count 50 -> 1 lb; 1 coin -> 0.02 lb; mixed pp=10/gp=15/sp=20/cp=5 -> 1 lb; invalid/empty balances -> 0. A 10 lb Item plus that wallet -> 11 lb; a separate 50-coin Item weighing 1 lb plus a 50-coin wallet -> 2 lb.
- [x] Add native/fallback container fixtures. Shell 1 lb + contents 2 lb + 50 contained coins -> 4 lb whether native currencyWeight is 0 or 1. Nested shells 1+1, contents 2, outer coins25, inner coins50, wallet50 -> 6.5 lb. Include a native kg getter whose currency contribution differs from the fixed pound ratio; assert corrected pounds and original non-currency weight.
- [x] Add magical-bag fixtures: 15 lb shell with 50 contained coins and 50 wallet coins -> physical16, internal used1; storage profile with base capacity100 and bag limit500 -> weight17/capacity600. Cover nested bags, unknown capacity, detached async getters and malformed hierarchy; source data must remain unchanged.
- [x] Run `node --test --test-reporter=tap tests/inventory-weight.test.mjs`; verify failures are missing coin weight/double-counting, not fixture/import errors.
- [x] Implement wallet addition once. For native container totals/contents, add fixed coin pounds minus their native currency contribution, recursively accounting only for carried descendants and stopping physical propagation at weightlessContents. For fallback contents, use corrected child Item weights plus the container's fixed currency weight. Reuse existing conversion, caches and cycle-normalized graph.
- [x] Run the new suite and `tests/group-inventory-migration.test.mjs`. Update old expected weights only where existing fixtures actually hold currency, deriving each difference from the coin count; retain all original assertions. Add group/member wallet snapshot assertions proving summary and group load agree. No partial runtime push before the shared release gate below.

## Task 2: Persist and refresh capacity edits in their captured scope

**Files:** `scripts/application/group-registry-mutation-commands.js`, `scripts/data/inventory-service.js`, `scripts/main.js`, `scripts/ui/inventory-app.js`; tests `group-command-dispatch`, `group-inventory-migration`, `inventory-app-context` and appropriate existing refresh tests.

**Interfaces:**
- Export `GROUP_PARTY_MEMBER_UPDATE_COMMAND = "group.party.member.update"` and `isValidGroupPartyMemberUpdatePayload(payload) -> boolean` for exact `{groupActorId,actorId,patch}` with nonempty clean IDs and a known-field plain patch. Preserve all recognized updatePartyMember fields/coercions, including structurally validated tools metadata; reject extra/prototype keys and non-serializable values.
- `RebreyaMainModule.updatePartyMember(actorId,patch={}, {groupActorId=""}={})` captures scope before awaiting and routes native edits through PrivilegedMutationGateway; legacy calls remain supported.
- `InventoryService.updatePartyMember(actorId,patch={}, {groupActorId="",guard,inventoryActor}={})` supplies the captured Actor/guard to existing `#writeMemberStates`. Explicit group resolution and membership checks run before repository mutation and are rechecked inside its queue; the repository retains its before/after-write active-GM guard. A supplied non-group inventoryActor selects the legacy route even if the active group changes; pass that Actor into the existing legacy write permission check rather than resolving scope again.

- [x] Add failing service/snapshot tests: STR18/default multiplier15/bonus0 gives270; set multiplier20/bonus200 ->560, with remaining capacity1860 giving group2130 ->2420. Test fields independently, STR override, blanks, decimals, reopened state, unrelated group, and unchanged transport/vehicle rules.
- [x] Add a real UI change-handler regression using `inventorySnapshotCache.actor.type`/`inventoryActorId` to capture the shown native group (same pattern as party-default-field). Pin exact strings "20"/"200", member ID and group option. Use the existing expanded-row/scroll preservation.
- [x] Add typed-route tests for exact/invalid payloads, owned native group on an inactive client, unauthorized sender, member removed before queued write, missing/wrong-type group, authority loss, and group A while B is active. Validate that existing tools/legacy API updates still normalize normally.
- [x] Add a real refresh-selection regression: register an open inventory view with group ID and a member sheet, perform the public member update and flush the existing refresh coordinator. Both must refresh after commit; an unrelated group's window must not. Observe RED with the current member-only refresh IDs.
- [x] Implement command beside group.party.defaults.update: authorize the sender for captured group, use keyed group scheduling, call the service with captured group/authority guard, and refresh captured group plus member. An inactive requester schedules its local refresh for those same IDs. Preserve legacy path and target its captured inventory Actor (resolve through `getInventoryActor({create:false})`, never create one for a refresh).
- [x] Pass the shown native group ID from the existing party-field handler. Preserve the existing change/commit trigger and numeric controls; do not add an expression language or replace the arithmetic.
- [x] Run focused suites: `node --test --test-reporter=tap tests/inventory-weight.test.mjs tests/group-inventory-migration.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-app-context.test.mjs` plus the selected real refresh suite. Require zero failures.

### Shared release, review and Git gate

- [x] Bump module.json to1.4.399, add minimal `scripts/main-1.4.399.js`, retain historical forwarders, update reverse import closure of changed owners to one canonical URL each. Preserve unaffected cache keys. Update affected release assertions and any changed template URL only if a template actually changes.
- [x] Update README user behaviour and all new/changed methods in the appropriate function-passport sections. Record tests and deliberate fixed coin rule; no generated architecture snapshot unless otherwise required.
- [x] Run `node --test --test-reporter=tap tests/*.test.mjs`; record passed/failed/skipped and actual failures. Run `node --check` over tracked/new JS/MJS, PowerShell ConvertFrom-Json over tracked JSON, and `git diff --check`. Rerun only affected checks after subsequent changes.
- [x] Obtain one compact independent Gemini review against this spec/plan. Verify findings in source; one fix pass for material issues with RED/GREEN evidence, recording rulings. Live-test the screenshot example and coin/container scenarios only if an authorized Foundry test session is available; otherwise state the limitation.
- [x] Fetch/check remote divergence and final task scope. Inspect complete/staged diff, stage exact task files, commit `fix(inventory): count coins and refresh scoped cargo edits`, push `origin lich_branch` without force, and verify clean status/zero divergence.

## Diagnosis and approval record

Spec commit55283902; user approved specification and plan on 2026-10-22, choosing Native execution in this checkout. Runtime implementation completed; final validation/review/delivery follows below. Baseline165/165 passed. Read-only reproductions show a 50-coin wallet weighs0 and updatePartyMember emits only the member ID for refresh, excluding its group inventory view. Installed system5.2.5; local Foundry bridge disconnected. Gemini's missing-wallet-weight finding was verified; its proposed change to transport capacity was rejected because role-specific rules are preserved by the approved spec, and template field aliases already match the service.

## Execution evidence and rulings

- Used the approved installed checkout on lich_branch; no new worktree. Remote main remains an ancestor.
- Regression-first: weight tests initially failed8/8; member/UI routes and screenshot snapshots failed on missing command, scope/refresh and270 instead of560. New queued sender-access and replaced-Actor membership cases also failed before their fixes. Final focused command: `node --test --test-reporter=tap tests/inventory-weight.test.mjs tests/group-inventory-migration.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-app-context.test.mjs tests/inventory-refresh-coordinator.test.mjs`:312passed,0failed,0skipped.
- Ruling: preserve an unknown native currency contribution for detached Item data without a currency schema; explicit currency uses /50. This preserves existing native fixtures/contracts. Cost if wrong: an unsupported detached shape could retain its native ratio until raw currency is available.
- Ruling: distinguish omitted inventoryActor (undefined, resolve as before) from explicit null/NPC (captured legacy scope), refining the planned default. Cost if wrong: callers explicitly passing null would select legacy; existing callers were audited and covered.
- Test fixture corrections retained all original contracts: compare the unrelated group after normal repository initialization; assert refreshed view identities rather than counts affected by the test’s explicit coordinator flush.
- Gemini preliminary exploration identified omitted wallet weight, confirmed in source; proposed transport changes were rejected because the approved existing role rules and arithmetic remain authoritative.
- Local Foundry MCP bridge disconnected; no live GM/player acceptance claimed.

Final checks (2026-10-23): full `node --test --test-reporter=tap tests/*.test.mjs`4917passed/0failed/1skipped (4918total). The skipped existing test is `hero-doll-presets-ui.test.mjs`: rendered ghost removal/escaping/read-only controls; Handlebars was absent from default Node resolution. Re-ran that whole file with NODE_PATH set to installed Foundry resources/app/node_modules:5passed/0failed/0skipped, including the skipped case. No new test skips. `node --check`1044tracked/new JS/MJS passed; PowerShell ConvertFrom-Json58tracked JSON passed; `git diff --check` passed.

Independent final review: Antigravity CLI gemini-3.8-flash-high, signed-in account, exit0/statusSUCCESS, no material findings. Reviewed currency deltas/units, nested magical bags, captured scope, queued sender checks, refresh and numeric/transport preservation. No deferred minors or review fix pass. Git delivery uses only task files on lich_branch; final commit ID and push result are reported in the chat.
