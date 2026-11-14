# Next turn render and automation implementation plan

> **Execution:** `superpowers:executing-plans`, with TDD and independent final review. Work on `lich_branch` only.

**Goal:** Remove confirmed redundant work on Next and at the round boundary while preserving movement, reactions, resources, effects and expiry.
**Spec:** [Next turn design](../specs/2026-11-14-next-turn-render-and-automation-design.md).
**Constraints:** Foundry 13/14 compatibility of Rebreya; no world data migration; authentic execution in Foundry for FPS claims; leave the user's trace out of Git. Use current scripts and lifecycle hooks, not a second combat loop.

## Review focus

- BG3 receives combined `flags`, `system.spells` and `items`, or flags from a remote owner (Task 1).
- Synthetic actors and external reaction providers can observe the two persisted turn flags (Task 2).
- Obsidian's state write succeeds, then effect reconciliation fails and the turn is retried (Task 2).
- An off-scene synthetic actor gains an immunity after boot, or an old effect is copied, moved or has its expiry edited (Task 3).
- Active GM switches or a delete fails; expiry remains recoverable without skipping the exact hour (Task 3).

## Task 1: BG3 portrait and cache identity

**Owner:** installed `bg3-inspired-hotbar/scripts/bg3-hotbar.js` (`_onUpdateActor`); reversible record under `tools/local-module-patches/2026-11-14-bg3-turn-render/`.

- [ ] Run actual-source tests: two flag updates invoke the portrait twice total (`assert.equal(portraitRenders, 2)`, red: 4); combined flags, spell slots and items render each relevant part once and still clean invalid items. Updates to a different actor do not render; incoming own flags route to `socketUpdateData`. Before changing the installed module, also capture the exact original files and hashes in a local backup.
- [ ] Keep the existing early actor check and initial portrait refresh, remove the later redundant portrait call. Keep passive/spell/filter and link handling independent. Test against the actual source rather than a copied helper.
- [ ] Bump BG3 to 3.4.9 with a new forwarder; retain published loaders and synchronize versioned module imports, including the classes Rebreya dynamically imports by installed version. Save a reversible patch and before/after hashes; check forward/reverse against copies and run BG3 runtime policy tests.

## Task 2: Curse sync, installed-item lookup and turn records

**Owners:** `scripts/combat/curse-upgrade-automation-service.js`, `scripts/data/item-upgrade-service.js`, `scripts/combat/hooks.js`, `scripts/combat/attack-service.js`. Tests: curse lifecycle/hooks, item-upgrade service, combat attack and grouped phases.

- [ ] Pin ownership and diff rules. `actorUpdated(actor, changed, options)` must produce `0` `syncActor` calls for movement/reaction-only flat or nested patches, including Foundry `==` keys and `_stats`, `1` for a mixed change, retaining burden logic on temp HP. Item/ActiveEffect changes and startup still reconcile. External reaction providers still see both saved flags on update, including synthetic actors.
- [ ] For ordinary and grouped turns, verify chain expiry and obsidian prompt/AC use the same actor, logical turn and event receipt; unchanged actors incur `0` full reconciliations. A rejected write must remain retryable and repair derived effects if a prior write succeeded. Include existing chain, duplicate event and receipt tests. Use `currentActor`/`previousActor` from the canonical owner, retain legacy targeting/identity behavior, and scope work to those actors. Reconcile qualifying changes and stale curse markers through existing lifecycle and startup; do not skip genuinely stale owned effects.
- [ ] Resolve installed upgrade IDs through `items.get(id)` for live collections and one fallback lookup for arrays or simplified collections. Assert authored install order, skipped missing children, and no full collection traversal for keyed lookups. Update all runtime imports of the changed owner to one cache key.
- [ ] Keep both movement and reaction contracts: movement starts at 0 with the current combat/round/turn/token and accumulates native traveled distance; reaction refresh retains uses and spending receipts; aim cleanup is retried after a failed delete. Test ordinary and grouped flows. Keep authored state writes and public API; skip unrelated side effects only with a positive proof. Leave the reaction capability index on its public event path when external providers may depend on those flags.

## Task 3: Round boundary world scans

**Owners:** `TreatWoundsService.cleanupExpiredEffects(worldTime)` plus its lifecycle registration in `scripts/main.js`, and `CurseUpgradeAutomationService.expireOutsideCombat()`.

- [ ] Pin one initial world scan, then `0` additional scene walks on clock ticks with no changed candidates. Include older off-scene synthetic token immunities, creation/update/removal, import or duplication of an actor or scene, token actor re-link, active GM takeover, reload, deleted-parent/id-safe retry, and expiry at exactly `startTime + 3600`. Keep errors observable, retain candidates on failed deletion, and recheck the live marker and authority before delete.
- [ ] Populate a per-client candidate list from one startup scan of the world actors and each placed token actor (only resolve each once). Maintain it from Actor, Token, Scene and ActiveEffect changes that can supply or replace immunity. Expiry re-checks only those actors, with direct fallback when lifecycle is not registered (e.g. isolated fixtures); missing or invalid stamps must not cause premature cleanup. Keep current coordinator and delete semantics.
- [ ] For curse world expiry, first measure legacy empty-world and populated paths. Avoid a repeated world scan for clock changes if nothing affecting candidate eligibility changed. Invalidate from relevant Actor/Item/ActiveEffect lifecycle, handle GM takeover, and re-check current combat membership at cleanup time. Preserve obsidian AC timeout and out-of-combat chain deletion. Test expired/unexpired, newly equipped, lost authority, already-deleted and repeat/retry cases.

## Task 4: Integration, release and live Next verification

- [ ] Check the remaining Next call paths (Foundry/dnd5e recovery and timed effects, DAE repeats, MIDI, Effect Macro, auras, trackers and any local start macro). Replay ordinary turns and round transition, and grouped turns where available. Preserve all required dispatch and resource recovery; apply an additional patch only for a reproduced redundant call, pinning successful effects as well as the removed call in red/green. Do not change optional rules or replace the camera based on an isolated pan trace.
- [ ] Bump Rebreya to 1.5.84 or the next unused patch version. Add a one-line versioned forwarder, retain previous supported URLs, update README, each relevant function passport and version assertions. Exercise focused tests followed by `node --test tests/*.test.mjs`, `node --check` for all tracked JS/MJS (including the new loader), JSON validation, and `git diff --check`. Review the staged diff and local patch independently.
- [ ] Compare HTTPS manifests and exact import bytes for Rebreya and BG3. When the server has re-read the manifests, verify installed versions and actual loaded JS modules in an authenticated client. Capture a marked `Next` within a round and another at the boundary, comparing matching baseline if available: long tasks, frame times and duration/counts of targeted work. Use only authorized client sessions; if no live measurement is attainable, report the precise blocker and what the automated runs and HTTPS verify separately.
- [ ] Stage only task files, commit to `lich_branch`, push without force, and report versions, commit, checks and live evidence. Leave the profiling trace and unrelated work in place.
