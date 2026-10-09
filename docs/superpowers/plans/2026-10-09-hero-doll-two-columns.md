# Hero Doll Two Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Always render doll left and inventory right.
**Architecture:** One scoped two-track grid; minimum654px content with root horizontal scrolling, no one-column overrides.
**Tech Stack:** CSS Grid/container queries, Foundry13, Node tests, browser layout verification.
**Spec:** docs/superpowers/specs/2026-10-09-hero-doll-two-columns.md

## Task1

- [x] Pin two tracks, minimum widths, scroll and absence of breakpoint override with RED regression.
- [x] Remove layout container overrides, update scoped grid and overflow; focused GREEN.
- [x] Verify rendered layout across widths; release1.4.367, update cache guards and passport.
- [x] Full tests/syntax/JSON/diff; fresh review; commit and push lich_branch.

## Review Focus

Every width must preserve two actual tracks. Narrow containers must scroll rather than enlarge the outer sheet or clip unreachable inventory. Preserve anatomical slots, template paths, all Actor behavior, and unchanged ESM cache keys.
