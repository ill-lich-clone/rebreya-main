# Firearm Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. The user's concrete screenshot and request supply the intended visual change.

**Goal:** One readable styled status block for misfire and empty magazine from a single shot.
**Architecture:** Keep existing CombatAttackService chat-note owner and string flags. Consume reports state; current shot publishes its combined status after the existing check. Reuse native Roll/chat and originating-card sync.
**Tech Stack:** JS ESM, scoped CSS, Foundry13/dnd5e5.2.5, Node tests.
**Spec:** docs/superpowers/specs/2026-10-31-firearm-chat-design.md

## Global Constraints

Preserve quantities, 1/3/6, formulas, check order, actual Roll, jam mutations, notifications, visibility, result objects, createMessage:false. No new sockets/hooks/queues/receipts. Keep native privacy fallback and string-note flags. Only own files/commits on lich_branch.

## Review Focus

- Last round with success or jam: one status message, correct unchanged spending and roll count.
- Native parent exists vs pre-use aborted before parent exists: status must remain visible and private.
- No misfire property and area-fire: empty warning remains, no added d20.
- Malicious weapon text and repeated card sync: escaped content and exactly one own section.
- createMessage:false and unrelated subsequent shot: no delayed messages or cross-shot aggregation.

### Task1: Status aggregation and presentation

Files: scripts/combat/attack-service.js, styles/main.css, tests/combat-attack-service.test.mjs.

- [x] RED: last-round standalone success/jam, no-check empty and suppression; parent sync/fallback; authored text escaped; area-fire one status/no new d20.
- [x] GREEN: remove early empty publication, pass current ammo to existing misfire publisher, publish combined formatted note. Preserve jam before-card fallback and Roll object. Style existing note marker, retain safe replacement.
- [x] Focused tests and native disposable UI checks, cancellation/visibility and cleanup.
- [x] User refinement: reuse reaction chat styling; RED author/other user/ownership/deleted item/idempotent render and one openMagazineEditor click. GREEN address-only firearmReload flag carried by standalone/parent/fallback; existing render hook mounts local author-only action; test click opens draft with no writes.
- [x] User refinement2: RED owner-only hint visibility/empty-only block plus private reload notices. GREEN hidden-by-default owner rows, disclose to author through existing hook, whisper standalone reload-only notifications.

### Task2: Delivery

- [x] Version/cache/forwarder, passport and README updates.
- [x] Full tests, JS/JSON/diff checks. Reuse successful results unless code changes.
- [ ] Fresh whole-change review; fix Important findings RED→GREEN.
- [ ] Commit/push own paths to lich_branch and verify remote/working tree.

## Verification evidence

- Final focused: `node --test tests/combat-attack-service.test.mjs tests/environment-automation-service.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` —190 passed/0 failed.
- Final full: `node --test tests/*.test.mjs` —5381 passed/0 failed/1 skipped (5382 total). Earlier runs before user refinements are superseded.
- Full syntax run checked1133 JS/MJS and65 JSON with0 errors. Final changed service/main and both new forwarders rechecked with `node --check` (1134 JS/MJS total coverage); final JSON/diff check before commit.
- Native Foundry13.351/dnd5e5.2.5, world testovyj3, disposable Actor uR0cwUKjlFPAb1mQ: one status for last-round success and one status for jam; current1→0 unchanged, normal attack Roll remains separate in public API. Actual private native Roll parent kept whisper recipients/blind, exactly1 status block and native reload target.
- Author/other-viewer DOM: author sees hint/button; rendering as another author shows only misfire result with no reload hint or button. Button opens existing editor, cancel leaves the whole fixture unchanged. Actual no-check empty-only status and programmatic reload confirmation each whisper only to attacking user.
- Screenshots inspected: author-final.png and other-viewer-final.png in `.superpowers/sdd/2026-10-31-firearm-chat/`; private-final.png records parent path before last visibility refinement. Collapsed Foundry sidebar initially produced an off-screen black crop; expanded through ui.sidebar.expand() and recaptured. No console errors; pre-existing deprecation warnings only.
- Original Actor9l5K3URGU5nvhy13 entire toObject snapshot unchanged. All owned fixture messages and fixture cleaned.
- Final release1.5.34 includes a33 compatibility forwarder because intermediate33 was loaded during live user feedback; only current service/style caches advance to34, unchanged subsystem caches retained.
