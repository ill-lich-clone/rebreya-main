# CPR Compatibility Across Updates Implementation Plan

> Use superpowers:executing-plans; write regression tests before runtime edits.

**Goal:** Preserve the legendary-action fix across CPR version and minifier-name changes without patching unrelated or already fixed callbacks.
**Architecture:** Identify the registered CPR combat callback through its setting onChange source and inspect its error signature; retain existing filtered combat proxy and setting lifecycle.
**Tech Stack:** Foundry 13, JavaScript, Node test runner.
**Spec:** docs/superpowers/specs/2026-11-01-cpr-updates-design.md

## Global constraints
No modification to CPR itself; valid legendary actions and settings must remain intact; maintain source hook identity for enable/disable; no hardcoded CPR version or function name; bump module version and cache key, update passport.

## Review focus
Current and later versions; renamed callbacks; unrelated callbacks; fixed handler; initially disabled setting and dynamic changes; no module; valid and empty mixed groups; callback source changes.

### Task 1: Hook identity and regression
- [ ] Write failing tests for changed version and renamed CPR callback, preserved valid actions, fixed callback and unrelated callback with matching markers; verify red.
- [ ] Identify hook from CPR setting registration and recognize the actual vulnerable source; preserve off/on behavior; run focused tests and check actual installed source.

### Task 2: Release and verification
- [ ] Update version, forwarder, runtime import, README, manifest tests and function passport.
- [ ] Run focused and full tests, JS and JSON validation, inspect Git diff, commit and push lich_branch.
