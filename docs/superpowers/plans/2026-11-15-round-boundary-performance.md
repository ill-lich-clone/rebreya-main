# Round Boundary Performance Plan

> **For agentic workers:** Use superpowers:executing-plans. Check steps as the work is verified.

**Goal:** Remove the measured redundant work at the round boundary while preserving clock and recovery behavior.

**Architecture:** Keep group mutations in one active-GM queue. Move the calendar-only write into a small setting bound to the persisted registry generation. Keep D&D 5e Combatant recovery intact and guard the known native item recovery implementation at its entry point.

**Tech Stack:** Foundry world settings, D&D 5e item system models, Node tests, Chrome CPU and Long Tasks profiles.

**Spec:** `docs/superpowers/specs/2026-11-15-round-boundary-performance-design.md`.

- [x] Extend group repository tests to require small-setting-only time writes and guard checks. Pin reads on a fresh client, concurrency, date changes, failed writes, deleted and re-created groups, and persistence of unrelated data.
- [x] Register `groupClockState`. Implement current-generation clock reads and writes in `GroupStateRepository`. Registry commits fold in effective clocks and advance the generation in the same write. Preserve the injected fallback when the setting is not registered.
- [x] Add focused D&D tests for the empty result with only other periods, delegation for round profile on item or an activity, fallback for unfamiliar data or version, and duplicate installation. Install in the composition root for the installed supported D&D system.
- [x] Bump Rebreya Main, update versioned imports and forwarder, module checks and function passport. Run owner tests, review and all required repository checks.
- [x] Confirm real runtime after full load. Measure 160 native NEXT on Мицелия in the background. Verify 10 time steps, setting sizes/events, no unintended actor/item/effect writes, and final test combat cleanup.

Review the failure ordering at both persistence points, the clocks selected by an old snapshot after a date write, and delegation through data-model inheritance. The live test should distinguish a shorter main-thread task from network acknowledgement latency.

The full suite passed 5,927 tests with 2 skipped. JavaScript, JSON, manifest and diff checks passed. Independent review caught legacy registry writes and an exact D&D recovery result edge. The final regression checks cover both.

The client on Foundry 14.369 and dnd5e 6.0.6 loaded the new methods and published a fresh Rebreya Main 1.5.90 notice. The server package registry still listed 1.5.89. The live test used the original 16 Мицелия tokens and 160 NEXT after full initialization. Baseline round-boundary tasks were 71–92 ms. The patched run had zero tasks of at least 50 ms on the ten boundaries and one 71 ms task on an ordinary turn. Full round recovery still ran for all 16 participants and took 20–25 ms per round. The 1,658,303-byte registry was not written during the run. Ten clock writes were 158 bytes each. Both clocks advanced 60 seconds, no actor, item or effect writes occurred during the transitions, and the temporary combat was removed. Detached stock item and activity recovery also returned the expected zero spent uses for matching round profiles.