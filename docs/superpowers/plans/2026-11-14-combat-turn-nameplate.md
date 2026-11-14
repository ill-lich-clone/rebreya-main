# Combat turn nameplate implementation plan

> Implement with superpowers:executing-plans and TDD. Spec: [combat turn nameplate](../specs/2026-11-14-combat-turn-nameplate-design.md).

1. Add failing focused tests for successful, interrupted and superseded camera moves, two-second lifetime, native nameplate restoration, and visible/secret tokens. Use fake DOM/timers and existing grouped-combat fixture.
2. Add a local nameplate presenter using the Foundry viewport coordinate API. Render text safely and pause only the native nameplate's renderable property during display. Connect to existing camera success and clear on pending/new turns, combat deletion and canvas teardown.
3. Add namespaced CSS with different entries and a shared exit, reduced motion, and bundled Russo One with OFL. Keep a single element and no frame polling. Update the passport, setting hint, README, manifest and forwarder.
4. Run focused and full checks, review, commit and push only lich_branch. Live UI requires explicit authorization and a test world.
