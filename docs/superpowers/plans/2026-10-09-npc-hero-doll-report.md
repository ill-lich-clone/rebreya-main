# NPC Hero Doll — task report

Spec: `docs/superpowers/specs/2026-10-09-npc-hero-doll-design.md`.
Plan: `docs/superpowers/plans/2026-10-09-npc-hero-doll.md`.

## Result

Release 1.4.365 adds the existing doll and presets to native NPCActorSheet. GM/OWNER authorization now accepts character/npc; all other Actor types and unauthorized senders remain rejected. Existing physical item workflows, quantity, heldHands, flags, presets, ghosts, idempotence and compensation remain canonical. Native NPC feature sections and other contexts are untouched; character-only tabs are not installed. Both render routes bind the same controls. Client import/template/style cache URLs and versioned forwarder updated.

World Actor UUID contract remains unchanged (world NPC and linked tokens). Synthetic unlinked token Actors and third-party sheets remain outside the supported contract. User waived live Foundry verification and will inspect the interface themselves.

## Evidence and review

- Initial regression RED: 123/126 passed; NPC tab absent, assignment/preset authorization rejected NPC.
- Focused GREEN: `node --test tests/hero-doll-*.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` — 190/190, zero failures/skips.
- Initial full `node --test tests/*.test.mjs` — 4451/4451, zero failures/skips. NODE_PATH points to installed Foundry node_modules so actual Handlebars test runs.
- Tracked JS/MJS + new forwarder: `node --check` — 935 files, zero failures. Tracked JSON parse: 55 files, zero failures. Changed integration and test rechecked after review fix.
- Gemini provided a compact contract checklist; actual installed dnd5e source confirmed NPC/BaseActorSheet integration.
- Fresh Astra review found Important: shared context patch would regroup NPC feats into character origin sections. Regression reproduced changed Actions section (RED); NPC now delegates every non-doll context to original handler (GREEN).
- Reviewer Minor: stale cache statement in passport. Corrected as part of the mandatory current-state passport update. No deferred findings or unresolved rulings.

Final full suite after review fix: `node --test tests/*.test.mjs` — 4451/4451 passed, zero failed/skipped. `git diff --check` passed. Remote lich_branch was checked again before commit: zero incoming commits. This report is included in the feature commit; commit/push receipt is in the task's final response.

Task 1: complete — regressions RED→GREEN, NPC feature-section review fix RED→GREEN, focused 190/190 and final suite 4451/4451.
