# Scoped UI Refresh Implementation Plan

1. Add failing unit tests for a keyed refresh coordinator: same-key coalescing, independent
   keys, requests arriving during a drain, and recovery after rejection.
2. Implement the coordinator and wire one instance into the main module. Make legacy full
   refresh and the three scoped refresh methods share it.
3. Add failing Mechanus routing tests, then remove redundant command/UI refreshes and make the
   setting callback refresh cosmology only.
4. Add failing downtime tests, then make the sheet helper local-only, route refreshes by Actor,
   and make `downtime-updated` the sole success refresh broadcast, including create requests.
5. Add failing inventory tests, then route socket mutations and document hooks through one
   trailing mutation-aware scheduler; make render context document-read-only by ensuring the
   backing Actor on explicit open.
6. Add failing background-render focus tests, then remove implicit bring-to-front behaviour
   from trader and loot generator render hooks.
7. Run focused tests, the complete available test suite, syntax/lint checks, and inspect the
   staged diff. Commit only files belonging to this fix and push `lich_branch` without force.
