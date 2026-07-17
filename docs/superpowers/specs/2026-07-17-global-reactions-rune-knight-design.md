# Global Reactions and Rune Knight Automation Design

**Date:** 2026-07-17

**Status:** Approved for implementation

## Goal

Introduce one reaction coordinator for the entire Rebreya module and use it to
implement the complete Rune Knight mechanics from the Fighter V0.28 source.
The result must prefer MIDI-QOL workflows and DAE effects, remain safe for
multi-user Foundry worlds, and avoid hot-path scans or polling that would make
combat noticeably slower.

## Scope

This delivery has two inseparable parts:

1. create the module-wide reaction queue and migrate every existing Rebreya
   reaction path to it;
2. implement Rune Knight runes, resources, recharge rules, Giant's Might, Runic
   Shield, Great Stature, Master of Runes, and Runic Juggernaut.

The remaining Fighter work identified during the audit, including Eldritch
Knight spellcasting, Extra Feat, high-level base Fighter features, Riposte,
Great Weapon Fighting, and new Interception triggers, remains required but is
deliberately handled by later specifications. The global reaction API built
here is the required foundation for those later reaction features.

## Confirmed Rules

- `ReactionQueueService` is the only code allowed to show reaction dialogs.
  This rule applies to the entire module, not only Rune Knight features.
- A reaction offer remains open for exactly 10 seconds. Timeout, closing the
  window, disconnecting, or returning no answer means decline and spends
  neither the normal reaction nor any feature resource.
- Candidates are processed sequentially. In combat they follow the current
  `combat.turns` initiative order. Outside combat they are shuffled once for
  that trigger and then processed in the resulting order.
- After an accepted reaction, the source provider re-evaluates whether the
  trigger still exists. The queue stops only when the trigger is gone. A
  successful Counterspell can remove its spell-cast trigger, while an
  opportunity-attack movement trigger can remain available for other eligible
  creatures.
- Rune passives are always active while the actor owns the selected rune item.
  Runes are not assigned to weapons, armor, shields, or other equipment.
- MIDI-QOL is the primary attack, target, hit, save, and damage workflow. DAE
  is the primary passive and timed-effect mechanism. Native dnd5e activities
  remain a limited fallback when MIDI or DAE is unavailable.
- Giant's Might has uses equal to the actor's proficiency bonus and recovers
  all uses on a long rest. It is not fixed at two uses.
- A dnd5e short rest represents the Rune Knight's 10-minute break for rune
  recharge.

## Architecture

### Reaction Queue Service

Create `scripts/combat/reaction-queue-service.js`. The service is class-neutral
and rule-neutral. It receives trigger descriptions from providers instead of
searching for named features itself. Its public request is conceptually:

```js
await reactionQueue.resolve({
  triggerId,
  kind,
  workflowId,
  candidates,
  isTriggerValid,
  revalidateCandidate,
  promptCandidate,
  executeReaction
});
```

`triggerId` is stable across duplicate Foundry and MIDI hooks. A candidate
contains stable actor, token, source item/activity, controlling-user, and
provider identifiers. Provider callbacks return structured results rather
than mutating queue internals.

The active GM is the sole queue coordinator. It resolves actor and token UUIDs,
orders candidates, requests a prompt from the active owning client, validates
the authenticated response, and executes the accepted reaction through the
provider. If no active player owns the actor, the active GM receives the
prompt. A candidate is never prompted on multiple clients.

The service wraps the existing `CombatAttackService` reaction ledger. It
checks availability before the prompt but consumes the normal reaction only
after feature payment and the reaction effect have succeeded. Provider
resources follow the same transactional boundary. A failed application must
not leave a spent normal reaction or feature use.

Only one candidate dialog is active for a queue. The ten-second timer uses an
abortable prompt wrapper that closes the Foundry application when time expires.
The provider is called again after every accepted reaction to determine
whether the original trigger remains valid. Declines and timeouts advance to
the next candidate without changing the trigger.

Existing Counterspell, Spell Shatter, provoked attack, Parry, Interception,
and any other reaction paths found by the implementation inventory are moved
to this service in the same delivery. Individual services may discover
candidates and apply their own rule, but may not create a reaction dialog or
implement their own candidate ordering and timeout.

### Reaction Capability Index

Create a small event-driven capability index owned by the reaction service.
For each active scene it maps reaction kind to the actor and token UUIDs that
can currently provide that reaction. Providers register stable automation IDs
and a cheap eligibility predicate.

The index is built lazily and invalidated only by relevant item, Active Effect,
actor, token, combat, canvas, or ownership changes. A hook first checks whether
the index contains any provider for its event kind. Expensive token distance,
line-of-sight, disposition, resource, and workflow checks run only for indexed
candidates.

The service does not poll, scan every world actor, or recompute visibility for
every token on every d20 roll. Trigger de-duplication and completed results use
bounded TTL maps, and workflow locks are removed in `finally` so runtime memory
cannot grow with an entire campaign history.

### Rune Knight Automation Service

Create `scripts/combat/rune-knight-automation-service.js` for class-specific
runtime behavior and `scripts/data/rune-knight-automation.js` for stable
feature metadata. The runtime service is injected with the reaction queue,
combat status service, socket command bus, and narrow MIDI/DAE adapters. The
reaction queue contains no Rune Knight identifiers.

All handlers identify features by `flags.rebreya-main.featureId`, automation
ID, activity ID, or source type. Russian names are migration fallbacks only.
Cross-actor damage, effects, and workflow changes execute on the active GM or
authenticated workflow owner through existing module infrastructure.

## Rune Items and Recharge

The existing Rune Knight `ItemChoice` advancements remain the source of known
runes. Each generated rune item gains:

- a passive transfer effect;
- one activation activity where the rune has an activated state;
- `system.uses.max = 1` before Master of Runes and `2` after it;
- short-rest and long-rest recovery;
- stable flags describing save ability, duration, trigger, damage, and
  reaction-provider kind.

Actor repair synchronizes the maximum without refilling already spent uses
outside a valid rest. Removing or replacing a rune removes its passive and any
source-owned runtime effects. Duplicate item and rest hooks are idempotent.

Rune save DC is always `8 + proficiency bonus + Constitution modifier`.

## Rune Mechanics

### Stone Rune

The passive DAE effect grants advantage on Insight and upgrades darkvision to
120 feet. When a visible creature ends its turn within 30 feet, the reaction
queue offers Stone Rune. On acceptance the rune use and normal reaction are
spent, the target rolls a Wisdom save, and a failed target becomes charmed,
incapacitated, and speed zero for up to one minute. The target repeats the save
at the end of each turn. Source flags drive repeat saves, expiry, and cleanup.

### Frost Rune

The passive effect grants advantage on Animal Handling and Performance. The
bonus-action activation applies a ten-minute DAE effect that adds `+2` to
Strength- and Constitution-based checks and saving throws.

### Cloud Rune

The passive effect grants advantage on Sleight of Hand and Deception. After an
attack hits the Rune Knight or another visible creature within 30 feet, Cloud
Rune opens a reaction offer before damage is finalized. The player selects a
different creature within 30 feet of the Rune Knight, excluding the attacker.
MIDI removes the original hit target, applies the unchanged attack total to
the new target's AC, and routes all attack effects and damage to the new target
only if that total hits. The original target receives no damage.

### Fire Rune

The passive grants expertise for proficient tool checks through the dnd5e roll
configuration hook. After a weapon hit, the rune can be activated before
damage finalization. It adds `2d6` fire damage and forces a Strength save. On a
failure, the target is restrained for up to one minute, takes `2d6` fire damage
at the start of each turn, and repeats the save at the end of each turn.

### Hill Rune

The passive effect grants advantage on saves against poison and resistance to
poison damage. Its bonus-action activation applies resistance to bludgeoning,
piercing, and slashing damage for one minute through DAE damage-trait changes.

### Storm Rune

The passive effect grants advantage on Arcana and prevents surprise while the
actor is capable of acting. Its bonus-action activation applies a one-minute
prophetic state. While active, an attack roll, saving throw, or ability check
by a creature within 60 feet registers a reaction trigger before the roll is
finalized. On acceptance, the Rune Knight chooses advantage or disadvantage;
the MIDI/dnd5e roll configuration is changed once and the normal reaction is
spent. The activation use is spent only when prophetic state begins, not for
each later reaction.

## Other Rune Knight Features

### Bonus Proficiencies and Rune Carver

The subclass grants smith's tools and the Giant language through native dnd5e
advancement data. Rune Carver retains the current rune choices at levels 3, 7,
10, and 15; actor repair restores missing advancement links without duplicating
selected runes.

### Giant's Might

Giant's Might is a bonus-action activity lasting one minute. Its item uses
maximum is `@prof`, with full long-rest recovery. The DAE effect grants
advantage on Strength checks and saves and records the chosen size increase.
When physical space permits, the owned token and actor size increase by one
category. If no item uses remain, the dialog offers payment with one dominance
die; payment is committed only if the form is successfully applied.

Once per actor turn, after a weapon or unarmed hit, MIDI offers the additional
damage. The die is `1d6`, becomes `1d8` with Great Stature, and becomes `1d10`
with Runic Juggernaut. A source-turn key prevents duplicate damage across MIDI
hooks and multiple workflows.

### Runic Shield

After an attack hits a visible creature within 60 feet, Runic Shield enters
the common reaction queue before damage. On acceptance the attacker rerolls
the attack d20 and must use the new result. MIDI recalculates hit targets before
damage. The feature has `@prof` uses and long-rest recovery.

### Great Stature

On first acquisition, the owning client rolls `3d4` once, stores the height
increase on an actor flag, and posts the result to chat. Repeated repair and
sheet-render hooks do not reroll it. Its combat contribution changes Giant's
Might damage to `1d8`.

### Master of Runes

Master of Runes synchronizes every known rune to two activations. A short or
long rest recovers all rune activations. Synchronization preserves spent uses
when the feature is first added during an adventuring day.

### Runic Juggernaut

Runic Juggernaut changes Giant's Might damage to `1d10`. Giant's Might offers
the normal increase or Huge size when space permits. While Huge through this
feature, MIDI and native activity configuration add 5 feet to melee reach for
that form only. Effect removal restores token size and reach without changing
unrelated token or weapon data.

## MIDI-QOL and DAE Contract

MIDI hooks are used at the earliest safe point for each rule:

- pre-roll configuration for Storm Rune;
- hit confirmation before damage for Cloud Rune, Fire Rune, Runic Shield, and
  Giant's Might;
- damage configuration for rune damage dice;
- workflow target and hit-target updates for redirection and rerolls.

DAE owns persistent passive effects and timed self/target effects. Each effect
has module source flags and explicit duration or special duration. The runtime
service handles only behavior DAE cannot express safely: cross-actor prompts,
resource transactions, repeated saves and damage, token size, and workflow
rewrites.

Without MIDI, generated activities, item uses, DAE passives, and manual target
effects remain usable. The module does not pretend that native fallback can
fully redirect an already resolved attack.

## Performance Contract

- No interval, animation-frame, or combat polling is introduced.
- No world-wide actor scan runs from an attack, damage, save, check, movement,
  or combat-turn hook.
- Hot hooks return after constant-time capability-index checks when no relevant
  reaction exists.
- Distance and visibility are evaluated only for indexed candidates on the
  active scene and only after cheap ownership, resource, condition, and
  trigger-kind checks.
- Actor feature lookups use cached stable-ID sets invalidated by document
  changes instead of repeated localized-name searches.
- At most one reaction dialog and one ten-second timer exist per active queue.
- Socket messages contain UUIDs and minimal decision payloads rather than full
  Actor, Item, Token, or workflow snapshots.
- Bounded de-duplication and queue state is cleaned in `finally` on success,
  decline, timeout, abort, or error.
- Tests instrument provider and geometry calls so a trigger with no indexed
  provider performs no distance or line-of-sight work.

## Failure and Concurrency Handling

- A stale or deleted actor, token, item, activity, effect, or workflow makes
  that candidate ineligible and advances the queue.
- Losing range, sight, reaction availability, or a rune use during the prompt
  invalidates acceptance without spending anything.
- An invalid or unauthenticated socket response is ignored until timeout.
- Duplicate trigger delivery returns the in-progress or cached result and
  never opens a second dialog.
- A provider exception is logged with trigger and candidate IDs, releases its
  lock, and advances only when the trigger remains valid.
- Feature payment and reaction consumption use a rollback-capable transaction.
  A failed effect or workflow mutation restores any payment already made.
- Rest and actor-repair mutations are idempotent and coalesced per actor.

## Testing

Add focused suites for the reaction queue, reaction capability index, Rune
Knight data generation, and Rune Knight runtime. Required coverage includes:

- combat initiative ordering and deterministic injected random ordering
  outside combat;
- ten-second timeout, explicit decline, closed dialog, disconnected owner,
  and no resource consumption for all four cases;
- queue continuation for a persistent trigger and termination for an
  invalidated Counterspell-style trigger;
- active-GM coordination, owning-client prompts, authenticated responses,
  duplicate trigger suppression, and failed-provider lock cleanup;
- constant-time early exit and zero geometry calls when the capability index
  has no matching provider;
- migration of every existing reaction prompt to the shared service and a
  source-level guard against direct reaction dialogs in combat services;
- all rune passive effects, activities, use maximums, short/long-rest recovery,
  Master of Runes synchronization, and rune save DC;
- Stone and Fire repeated saves, timed damage, expiry, and cleanup;
- Cloud target redirection and original-target protection;
- Storm pre-roll advantage/disadvantage and normal reaction spending;
- Giant's Might `@prof` uses, dominance fallback, size, once-per-turn damage,
  die progression, and long-rest recovery;
- Runic Shield reroll and mandatory new-result hit calculation;
- Great Stature one-time height roll and Runic Juggernaut reach cleanup;
- duplicate MIDI/dnd5e hooks not applying damage, effects, saves, payments, or
  prompts twice.

Verification requires focused tests, syntax checks for every changed module,
`git diff --check`, and the complete `node --test tests/*.test.mjs` suite before
the implementation commit is pushed.

## Explicit Non-Goals

- No rune-to-equipment inscription UI or persistence.
- No polling-based aura, range, or reaction discovery.
- No unrelated rewrite of MIDI-QOL, DAE, combat status, or socket services.
- No implementation of the deferred Fighter and Eldritch Knight feature set
  in this first delivery.
