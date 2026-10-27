# Registered group inventory: native owner operations

## User direction and observable result

The user explicitly requested implementation through tests, version, commit and push in lich_branch: grant group participants OWNER on the warehouse, use native Document APIs like the existing hero-doll owner route, and remove unnecessary custom sockets, journals and blocking. This follows the user-approved native-concurrency policy in the 2026-10-24 player-sync design; the user accepts ordinary Foundry concurrency and does not want speculative duplication protection on routine actions. The chosen approach and native execution in this chat are established; no additional product decision is pending.

Users owning character members of a registered managed Group Actor receive explicit OWNER on that Group Actor. Existing groups reconcile on active-GM startup; registration, membership, character ownership and User changes reconcile grants. Only the elected active GM changes ownership. Membership changes remove only grants issued by this feature, restoring recorded prior permissions and preserving pre-existing manual owners/default ownership. Synchronization is idempotent and does not run for unrelated Item edits or loop on its own flag update.

After permissions are assigned, ordinary actions use native Actor/Item APIs without an active GM, custom command, world journal read/write or coordinator queue: quantity/delete, currency/conversion/supplies, folders and same-group whole/partial placement, ingress-rule CRUD, ordinary take/import between owned Actors, catalog/manual additions through existing ingress rules, and warehouse sale. Member permissions are decided through the documented Actor.canUserModify(User,"update") capability, not an isGM switch. Existing services remain the behavior owners.

Ordinary manual dismantle and folder sale/dismantle use this same native route, preserving existing output calculations and material ingress routing. External coin grants retain their previous journal; only explicitly local catalog/manual grants choose native currency writes.

## Preserve the actual game contracts

- Preserve API signatures/results, price and sale eligibility/treasure multiplier, material logical quantities/unit prices/weights (12 decimals), ordinary two-decimal quantities, authored formulas, budgets and currency denominations.
- Preserve quantity dialog cancellation, exact group/destination, all ingress routing/skip/dismantle rules, acquisition history and catalog icons. Never bypass a rule simply to obtain a native path.
- Preserve instance restrictions for partial splits (contents/upgrades/independent state/equipped/held), character membership checks and native source-before/after accounting. Reuse current pure rules and Document driver; do not build a second inventory or change dnd5e schemas.
- Ordinary native writes perform only the necessary document changes; pending identical local intent shares a Promise. Native Foundry concurrency is accepted. No new distributed lock, durable receipt store, setting, transaction framework or blanket GM fallback due solely to multiple writes.
- Small per-action snapshots/observed-write checks may handle rejected or write-then-throw native calls, as in hero-doll. They do not add network round trips for journals. Do not restore another user's later edits or silently swallow errors.
- Existing explicit GM commands and old persisted recovery records remain available for their prior callers. Complex runtime container/upgrade graphs and external storage/loot/trader-world operations retain their established privileged adapters; they are outside ordinary loose-item moves. Missing ownership uses the existing validated fallback; real permission denial does not silently grant rights.

## Implementation owners

GroupContextService owns explicit group inventory ownership synchronization and its per-Actor grant provenance. Extend group-registry-lifecycle for narrowly scoped Actor/User changes and the existing startup/registration composition; UI never changes permissions.

InventoryService selects native ownership before any journal/coordinator/socket work. Native folder splits extend ItemInstanceWorkflow with a direct non-journal execution entry point reusing ItemInstanceDocuments and planItemInstanceMutation. Native ingress reuses planner, derived rows and target-receipt Document helpers in memory, including histories/rules; no durable journal is created. Native warehouse sale reuses resolveInventorySaleQuote and currency/source helpers. Main routes already-owned organization/direct-ingress actions locally and refreshes through the current scoped coordinator.

All changed methods are reflected in function passports. Keep established canonical module URLs for stateful owners; bump the manifest and forwarder together and preserve published old forwarders.

## Approaches

Selected by the user: capability-based native owner route alongside the existing privileged compatibility routes, mirroring hero-doll. Merely granting OWNER leaves current !isGM socket dispatch in place and does not meet the request. Replacing the inventory or removing external-document authority changes unrelated behavior and is rejected. Removing checks while keeping world-journal writes also fails to remove the expensive dependency.

## Acceptance and verification

- Permission tests exercise registration, existing groups, multiple owners, member join/leave, changed character ownership, preserving manual/default permissions, no-op sync and active-GM-only writes.
- Native production-owner tests provide real capability-bearing fake Documents and make every custom socket, world-journal call and coordinator queue throw. Assert correct resulting quantity/currency/folders/rules/items and zero calls, with no active GM.
- Cover ordinary whole/partial and fractional/material transfer, cancel/no-op, forbidden complex split, acquisition history, ingress skip/folder/dismantle, eligibility/formulas, and native failure propagation/limited compensation. Existing privileged and recovery suites remain enforced.
- Verify scoped view refresh and denial/fallback for unowned Actors. Run focused tests in RED→GREEN order before runtime edits, then the full Node test suite, tracked JS/MJS syntax, JSON parse and diff checks before commit.
- Attempt live test-world inspection through existing tools. If still unauthenticated/unavailable, report the precise limit without claiming a live pass.

## Delivery

Work in current lich_branch, baseline clean and synchronized after fetch. Starting module version 1.5.16; target 1.5.17 unless concurrent state requires reassessment. Stage task files explicitly, inspect diff, commit and push without force. One independent specification builder check and one final code review; implement inline as the user previously selected. User's request to carry this chosen native approach through delivery takes precedence over repeating approval questions.
