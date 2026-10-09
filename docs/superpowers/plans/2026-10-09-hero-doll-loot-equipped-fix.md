# Hero Doll Loot Equipped Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Fix confirmed signet-ring preset rollback and avoid the extra rollback work.
**Architecture:** Existing service generates schema-compatible equipped patches and matching before receipts; driver/workflow verification unchanged.
**Tech Stack:** Foundry13/dnd5e, JavaScript, Node document fixtures.
**Spec:** docs/superpowers/specs/2026-10-09-hero-doll-loot-equipped-fix.md

## Task1

- [x] RED regressions for no-equipped loot Apply/clear and legacy normalization/compensation.
- [x] Schema-aware equipment/remainder patches, keep empty Item existence receipt; focused GREEN.
- [x] Release1.4.369/service cache, passport updates.
- [x] Full tests/syntax/JSON/diff and fresh review; commit/push lich_branch.

## Review Focus

No Item-type migration and no guessed support by type lists: current equipped field support drives patch. Empty receipts must still validate Item existence. Both assignment and preset legacy remainders must omit unsupported equipped and preserve quantity, grip and compensation fingerprint. Real weapon/armor equipped and durability constraints remain enforced. Live timing remains unmeasured.
