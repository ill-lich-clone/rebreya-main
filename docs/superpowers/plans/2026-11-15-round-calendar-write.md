# Round Calendar Write Plan

> **For agentic workers:** Use superpowers:executing-plans to execute and record each verification step.

**Goal**: Remove full registry copies from the calendar patch used at the round boundary.

**Architecture**: Add a narrow repository mutation under the existing group setting lock. Keep the game's clock, Foundry's Setting and its hooks, the legacy context fallback and date-transition journal.

**Tech Stack**: Foundry settings, ES modules, Node test runner, Chrome CPU and Long Tasks profiles.

- [x] Add calendar and repository regressions that catch nested archive traversal, lost concurrent writes, wrong legacy key selection, and failed-write leaks. Confirm the relevant failures against the old path.
- [x] Implement the calendar-only patch and route `CalendarService.patchGroupCalendar` through it for time-only patches. Retain the existing world fallback, command and date-transition flow.
- [x] Bump Rebreya Main to 1.5.89 and update its forwarder, touched import cache keys, tests and function passport.
- [x] Run owner tests, full tests, syntax, JSON, diff and version checks. Confirm actual runtime imports and startup in Foundry.
- [x] Repeat 160 NEXT transitions on the original 16 tokens without focusing the window. Verify normal clock advancement and compare boundary CPU stacks and long tasks. Remove the temporary combat.

The focused suite passed 190 tests. The full suite passed 5,920 and skipped 2. JavaScript, JSON, manifest, diff checks and independent review passed.

The client loaded the changed time-only dispatcher and scoped writer and posted a fresh 1.5.89 completion notice. The server's installed-package list still reported 1.5.88 during this run. The current manifest served 1.5.89.

All 160 NEXT transitions used original tokens in the previous order. Grig had 112 items, down from 115 in the prior sample, and one additional non-GM was connected. All ten round boundaries kept a single calendar setting update and a single world time update. Both clocks advanced by exactly 60 seconds. Boundary long tasks fell from 122–152 ms to 71–92 ms. Total long tasks went from 16 to 15. The new boundary stacks had no full registry normalization. The remaining sampled work included Foundry setting document updates and dnd5e combat resource recovery. No actor or Active Effect writes were observed. The temporary combat was removed and all original tokens remained.
