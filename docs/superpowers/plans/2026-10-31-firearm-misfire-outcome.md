# Firearm Misfire Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline.

**Goal:** Misfire forces the actual attack to miss; a scoped cancel restores that attack, plus jam/reload icons.
**Architecture:** Extend canonical CombatAttackService, existing combat hooks and chat actions. Bridge pre-roll config.workflow.id into roll.options, preserve per-shot outcome on the existing card/workflow. Native OWNER updates only; use installed MIDI workflow APIs for hit/damage continuation.
**Tech Stack:** JS ESM, native D20Roll, Foundry13.351/dnd5e5.2.5/MIDI13.0.61, Node tests/CSS.
**Spec:** docs/superpowers/specs/2026-10-31-firearm-misfire-outcome-design.md

## Global Constraints

No new attack roll, ammo/budget spending, talisman automation, threshold increase, custom sockets/receipts/queues. Do not remove later jam or alter unrelated attacks. Preserve authored formulas, bonuses, quantities and1/3/6. Existing owner-only reload stays. Only lich_branch/own files.

## Review Focus

- Natural20, forced hits and EC hits must still miss during jam, before HP application.
- Cancel natural1 remains miss; rolled attack/damage are not rerolled or double spent.
- Old message vs later weapon jam and later card reroll: cancellation must address only the saved shot.
- Native parent-less roll must map to MIDI card by pre-roll workflow ID; no duplicate status card.
- Author/GM ownership, reload-only privacy and reload-vs-jam icon states survive refresh/re-render.

### Task1: Outcome bridge and miss guards

Files: scripts/combat/attack-service.js, scripts/combat/hooks.js, focused combat/environment tests. Optionally a small pure helper for D20 snapshot/restore if needed, with CombatAttackService remaining owner.

- [x] RED bridge and per-shot jam19/nat20 miss; no-check/success unaffected; damage guard scoped to snapshot.
- [x] GREEN pre-roll workflow ID, post-roll state + card; preserve current shot flags, D20 options and MIDI miss state; hitsChecked hit-benefit gate; damage pre-hook.
- [x] Focused checks and live native forced miss/HP unchanged.

### Task2: Cancel and state icons

- [x] RED cancel original hit/miss/critical, matching jam only, same ammo/threshold and no repeat attack roll; author/GM permissions and repeated action status; icons/reload owner-only.
- [x] GREEN cancel API + existing chat hook/button, message status update and native hit/damage continuation; warning/reload badges reuse current reaction styling.
- [x] Native live cancel/resume, reload/cancel visibility, fixture cleanup.

### Task3: Delivery

- [x] Release/cache/forwarder/passport/README/spec/plan updates.
- [x] Full tests + JS/JSON/diff, affected reruns after fixes.
- [x] Fresh whole-change review, Important fixes RED→GREEN, own commits/push lich_branch and verify.

## Verification evidence

- User confirmed cancellation in the current MIDI session is sufficient. SaveToChatCard=false unchanged; missing context disables Cancel with a tooltip. No unrequested workflow persistence layer.
- Focused: `node --test tests/combat-attack-service.test.mjs tests/environment-automation-service.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs tests/storage-main-registration.test.mjs` —216 passed/0 failed.
- Full: `node --test tests/*.test.mjs` —5397 passed/0 failed/1 skipped (5398 total). Initial full run found only stale combat/hooks cache expectation in storage-main-registration; corrected that key and reran full.
- `node --check`:1139 JS/MJS,0 errors. PowerShell ConvertFrom-Json:65 JSON,0 errors. Final diff check clean.
- Native Foundry13.351/dnd5e5.2.5/MIDI13.0.61, testovyj3, disposable actual MidiAttackActivity. Attack29+jam7 =>red miss,0 hits,0 damage rolls,target80/80. Actual Cancel button restored same29=>hit,damage15,HP65,ammo0 andthreshold10 unchanged. Screenshots inspected: jam-before-cancel.png/jam-after-cancel.png in ignored task workspace.
- Additional current-source native attack−6+jam thenCancel =>still0 hits,HP80,ammo0/threshold10, showing cancellation does not force an ordinary miss to hit. Unit1/19/20 and ready damage/lazy MIDI tracker restore pin other cases.
- History test confirmed MIDI setting prevents workflow restoration after F5. No setting changed; expired Cancel disabled and Reload remains usable. Rebind after asynchronous module initialization/renderChatLog tested; game.ready alone preceded completion of bootstrap.
- Native origin-less Roll maps to actual MIDI card by pre-roll workflow ID; status is merged in it. Force miss, late forced/EC hits, module hit-boost suppression, native/MIDI damage guards, owner/GM controls, stale successful reroll/later weapon jam, source escaping and icons covered.
- Own actors4wQNcEXbIUmFMCwY/YaWyaPiWMFknEY0n, sceneu0SqnDULUiZPpYNO and16 fixture messages removed; CODEX scene/targets restored. Original Actor9l5K3URGU5nvhy13 full toObject snapshot unchanged. Production HP not changed by QA.
- Final cache1.5.38; interim35/36/37 forwarders retained for clients which loaded them during live feedback.

## Final review and fix pass

Fresh Astra reviewed `d08a000d..c2435dbf`: no Critical/Important runtime findings; independently focused215/215 and diff check clean. README advertised the new method at the wrong public level; corrected to `game.rebreyaMain.combatAttackService.cancelFirearmMisfire(message)` (documentation contract, no delegate added).

An additional native probe confirmed recursive flag merging retained old original options/critical override when the incoming field was undefined. The fix atomically replaces only the per-shot flag using deletion+fresh value in one update. Owner regression `per-shot snapshots replace stale fields under native recursive JSON flag updates` failed first, then passed; real disposable ChatMessage probe confirmed stale fields removed and unrelated flag retained. Follow-up full suite5397 passed/0 failed/1 skipped; focused216/216. No further review needed for the covered fix pass.

Scope decisions: current-session cancellation explicitly confirmed by user; no recovery across unsaved MIDI context and no settings change. Distributed concurrent cancellation/durable recovery remain excluded per user instructions. Reviewed installed Foundry13.351/dnd5e5.2.5/MIDI13.0.61, no broader version claim. Reviewer inspected supplied live artifacts without independently mutating the browser. These are verification/scope limits, not new deferred runtime work.
