# Miceliya NEXT Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to work through the checks.

**Goal**: Remove redundant Actor and effect writes and unnecessary group registry reads on NEXT.

**Architecture**: Keep the existing reaction ledger and effect owners. Narrow the Auto Tycoon refresh trigger to changes its UI can observe and use existing narrow group reads.

**Tech Stack**: Foundry document hooks, ES modules, Node test runner, Chrome CPU and Long Tasks profiles.

- [x] Pin full and spent reaction behavior in the ordinary transition tests. Keep grouped and explicit refresh assertions.
- [x] Add hook and embedded document regressions for unchanged implant effects and Foundry-normalized curse descriptions. Preserve meaningful Actor, effect and Item updates.
- [x] Pin Auto Tycoon refresh on year and registration changes, with no refresh on time-only changes. Verify the existing permissions and context contracts through the narrow reads and legacy API.
- [x] Implement and version both modules. Run the focused tests, the full suites, syntax, manifest and diff checks.
- [x] Verify actual imports and wait for Rebreya Main startup in the live world. Run the original scene through 160 NEXT transitions in a temporary combat, capture effects and long tasks, and clean up the fixture.

Rebreya Main 1.5.88 passed 5,918 tests and skipped 2. Auto Tycoon 0.9.44 passed 464 and skipped 15. Manifest, JavaScript syntax and JSON checks passed.

Foundry 14.369 loaded both new entrypoints. The active GM observed a fresh Rebreya Main 1.5.88 completion notice before opening «Мицелия фон путешествия». The background browser measured the same 16 original tokens in the same order across ten rounds. It recorded long tasks of 50 ms or more on 16 of 160 transitions, down from 132. The total fell from 216 to 16. Ordinary transitions had 6 long tasks and a 66 ms peak, down from 177 and 317 ms. Each of the ten round boundaries had a task between 122 and 152 ms while saving the group calendar. Reaction and ActiveEffect writes fell from 160 and 69 to zero. The CPU profile had no Auto Tycoon group scans. The temporary combat was removed, all 16 tokens remained, and the normal round boundaries advanced the world clock by 60 seconds.
