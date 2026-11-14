# Native NEXT for Singleton Encounters Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline in this chat.

**Goal:** Use native Foundry turns when no shared Rebreya turn has been formed.

**Architecture:** GroupedCombatService decides at macro start and active GM reconciliation. Native combat uses normal Foundry start/navigation while a published singleton-only journal becomes inactive. Shared combat keeps the existing grouped runtime.

**Tech stack:** Foundry VTT 13/14 JavaScript, Node test runner.

**Spec:** [Native NEXT for individual turns](../specs/2026-11-14-native-next-for-singletons-design.md).

## Global constraints

- Preserve existing combat positions, authority, shared-effect providers and their recovery contracts.
- Keep 1.5.85 and older forwarders. Release 1.5.86 on lich_branch.
- Exercise the test path in live Foundry without advancing another player's fight.

## Review focus

- Unrolled compatible NPCs form a shared group only when its final member count exceeds one.
- Unsupported grouped-effect providers must not block the ordinary start.
- Legacy all-singleton mode changes no initiative, round, current actor or step receipt.
- Pending or blocked recovery and any saved shared group remain protected.
- Native direct updates and NEXT work after conversion and a new shared group still activates at the round boundary.

## Task 1: Route singleton encounters to native lifecycle

- [x] Write tests for native singleton start, acting combatant preservation when initiative changes, singleton legacy and interrupted reconciliation, blocked/shared history, provider checks after a tied roll, and native wrapper delegation. Run RED.
- [x] Implement classification before first grouped write, active-GM reconciliation, and native routing for the dormant state. Update passports, README and release/canonical importer versions. Run GREEN.
- [x] Complete independent review and resolve findings. Preserve both published forwarders and prevent position corrections from replaying recognized turn-effect hooks.
- [x] Confirm served build and measure live NEXT. On an isolated five-token encounter, the legacy singleton pipeline emitted 65 Combat updates and returned after 1336 ms. Native and retired-manually-to-native routes each emitted one Combat update and returned after 67 and 50 ms. The test client rendered at 1 FPS even while idle. Its GM was an observer and the active GM still emitted the legacy movement update. The disposable combat and all five test tokens were removed.

Run the full suite, diff and JS/JSON checks before committing. Release the task files on `lich_branch` and push to origin.
