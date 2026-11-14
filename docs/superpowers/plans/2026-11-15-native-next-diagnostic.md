# Native NEXT Diagnostic Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans.

**Goal:** Compare native turn navigation without Rebreya's grouped runtime and NEXT aim sweep.

**Architecture:** The composition root passes one temporary code switch to GroupedCombatService. The service routes macro starts to native Foundry, regular turn handlers continue, and group-only runtime, status, socket ingress and reconciliation stay paused.

**Spec:** [Native NEXT diagnostic](../specs/2026-11-15-native-next-diagnostic-design.md).

- [x] Verify the diagnostic on a flagged combat, native macro start, unchanged journals, native actor selection and a reaction refresh with an inventory that fails if inspected.
- [x] Implement the code switch and native fallback, then bump the module and changed import URLs to 1.5.87.
- [x] Verify served code and live behavior as the active GM in Foundry 14.369. On a disposable five-token encounter on «Тест2», the start macro and three ordinary NEXT calls succeeded while ignoring a saved shared group. Each NEXT emitted one Combat update and one Rebreya reaction write. The longest frame gaps were 187–292 ms during NEXT, with a 285 ms gap at idle. The saved journal was identical and all test objects were removed.
- [x] Finish checks. Full suite passed 5914, with 2 skipped. The focused suite passed 115 after guarding direct recovery. JavaScript syntax, JSON and diff checks passed.

Release the task on `lich_branch` and push it to origin.
