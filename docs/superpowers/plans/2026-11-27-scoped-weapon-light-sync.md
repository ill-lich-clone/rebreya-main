# Scoped Weapon Light Sync Implementation Plan

**Goal:** Eliminate world-light scans from ordinary upgrade and item writes.

**Architecture:** Keep startup indexing and actor-keyed reconciliation in ItemUpgradeAutomationService. Route relevant token events from existing combat hooks into the same owner.

**Tech Stack:** Foundry VTT 14, dnd5e 6, Node test runner and Foundry QA.

1. Pin the unneeded world-light reads and the ambient-light lifecycle with focused tests. Confirm the regression fails against 1.6.11.
2. Index tracked lights at startup and reconcile by actor. Preserve cleanup for token ownership changes and deletion. Refresh the index when a client acquires GM authority again.
3. Update both function passports and versioned runtime entry point. Run the same incident QA before and after and run the full runtime checks.
