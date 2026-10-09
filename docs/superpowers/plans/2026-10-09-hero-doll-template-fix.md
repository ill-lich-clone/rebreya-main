# Hero Doll Template Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Restore character/NPC sheet opening after invalid template query regression.
**Architecture:** Correct existing template constant; preserve the existing UI/service owners and cache ESM through release version.
**Tech Stack:** Foundry13 server socket template loader, dnd5e ApplicationV2, Node tests.
**Spec:** docs/superpowers/specs/2026-10-09-hero-doll-template-fix.md

## Task 1

- [x] Reproduce server path.extname rejection with registered PARTS regression before runtime edits (RED: hero-doll-tab.hbs?v=1.4.365).
- [x] Remove template query; keep canonical .hbs file and all sheet/preset behavior.
- [x] Release1.4.366, new forwarder, sheet ESM cache invalidation, update release guards and passport.
- [x] Focused/full tests, syntax/JSON/diff checks; fresh final review; commit and push lich_branch.

## Review Focus

Template socket paths are filesystem paths, not browser URLs. Both character and NPC registration must use the valid existing file. Module-owned partial paths must stay valid. Do not remove client code/style cache invalidation or alter Actor behavior.
