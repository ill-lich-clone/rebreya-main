# Inventory coin weight and capacity controls

Status: approved by the user on 2026-10-22; implemented as release 1.4.399. Final verification and delivery are recorded in the linked implementation plan.

## Observable result

1. Inventory weight includes physical coins at exactly 50 coins per pound.
   Sum actual coin counts, independently of their monetary value: 50 cp,
   50 gp or any mixed 50 coins weigh 1 lb. A single coin weighs 0.02 lb.
   Include the group's wallet and each member's wallet once. Supported
   native denominations are cp/sp/ep/gp/pp; denomination conversion and
   currency balances remain unchanged.
2. The same rule applies to currency held inside containers. Preserve normal
   nesting, native Item weight, unit conversion and weightlessContents:
   ordinary containers transmit coin weight; magical containers suppress
   physical contents weight while their internal used capacity includes it.
   Replace only the native currency contribution with the fixed ratio, so
   enabled/disabled dnd5e currency-weight settings cannot omit or double-count
   coins in the module's inventory. Do not change global dnd5e settings.
3. Editing SТR override, cargo multiplier or cargo bonus updates the saved
   member state, the member's capacity and the displayed group's capacity
   after the field's existing change/commit event. Values survive reopening.
   Screenshot acceptance: STR 18 with multiplier 20 and bonus 200 gives
   560 lb for Гартар, replacing 270 lb; with the other components unchanged,
   the group capacity changes from 2130 to 2420 lb.
4. Preserve current numeric rules and fallbacks: blank STR/multiplier uses
   Actor/default values; STR is nonnegative integer, multiplier >= 1 and
   bonus >= 0 retain their current two-decimal handling. Preserve existing
   role-specific transport/vehicle capacity rules and magical storage W+U /
   B+C accounting. No new expression language or formula setting is needed.

## Confirmed diagnosis

- buildActorInventoryWeightSnapshot sums root Items but omits Actor currency.
  A read-only reproduction with 10 pp + 15 gp + 20 sp + 5 cp returns 0 lb
  instead of 1 lb. Container currency currently depends on native getters.
- Installed dnd5e 5.2.5 currencyWeight returns zero when its setting is off;
  container contentsWeight includes that native currency contribution.
- RebreyaMainModule.updatePartyMember refreshes only the edited member Actor.
  The existing inventory refresh filter selects windows by inventory/group
  Actor ID. A reproduction through the actual public method records only the
  member ID, excluding the shown group's window. The numeric capacity
  expression itself matches the requested example.
- The field handler also omits the displayed group ID, and member updates
  bypass the typed active-GM command path used by adjacent group defaults.
  Preserve the shown group across async work and route authorized native
  group edits through the existing privileged-mutation infrastructure.

## Owners and data flow

- scripts/data/inventory-weight.js remains the sole read-only weight owner.
  Add fixed currency accounting there; preserve native getters and adjust
  their currency contribution rather than replacing the entire weight model.
- scripts/ui/inventory-app.js captures the displayed native group ID before
  awaiting a party-field update. Existing controls/layout remain in place.
- scripts/main.js extends updatePartyMember with an optional group scope,
  retains legacy calls, routes native edits through an exact typed group
  command, and refreshes both the captured group and the member after commit.
- scripts/application/group-registry-mutation-commands.js owns the validated
  member command alongside the existing group default command. Authorization
  verifies the sender may manage that group; the service verifies current
  membership before writing. No caller-controlled arbitrary setting writes.
- InventoryService.updatePartyMember uses its existing #writeMemberStates,
  captured Group Actor and authority guard; GroupContextService/repository
  remain the only persisted native group-state owners. Legacy scope retains
  its supported route. A missing explicit group never falls back to another.

## Preserved contracts

Keep quantities, balances, currency conversion, authored Item weight/price,
capacity defaults, role rules, storage/container identity, source flags,
legacy state, membership, permissions and active-GM safety. Physical coin
Items retain ordinary Item weight and are counted once; do not synthesize
coin Items, move currency or infer duplicate holdings from equal amounts.
Do not rerender unrelated groups or change the active group to perform edits.

## Required regression evidence

- Mixed/pure denominations, zero and single coin, group/member wallets,
  ordinary/magical/nested containers, native and fallback weight paths,
  currency weight enabled/disabled and metric conversion: exact /50 result,
  no duplicate native contribution and immutable source data.
- Real member update and snapshot round-trip for STR 18 / multiplier 20 /
  bonus 200; 270 -> 560 member capacity and 2130 -> 2420 group capacity.
  Blank overrides, decimal inputs and role-specific baselines stay valid.
- Exercise the actual UI change handler, persisted group-state owner and
  real refresh selection so an unrelated member-only refresh cannot pass.
- Displayed group A while B is active, active-group switch during await,
  inactive authorized client, unauthorized sender, removed member/missing
  group and unchanged unrelated group. Validate exact typed payloads and
  authority before/after queued writes.

## Delivery and validation

Implement with regression-first tests after written specification/plan review.
Release 1.4.399 from current 1.4.398 with synchronized forwarder, affected
canonical import cache keys and any changed template cache key. Update README
and function passport. Run focused tests, the full Node suite, tracked/new
JS/MJS syntax checks, tracked JSON parsing and git diff --check. Review the
diff independently with Gemini, commit task files and push lich_branch.

Baseline: 165 existing group migration/command tests pass. Working branch is
clean and synced; origin/main is an ancestor. Local Foundry MCP bridge reports
disconnected; live acceptance remains unavailable until a session is exposed.
Use offline evidence honestly and do not claim a live GM/player UI pass.
