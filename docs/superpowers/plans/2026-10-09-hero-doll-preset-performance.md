# Hero Doll Preset Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Reduce Apply read/render/write overhead without weakening transaction checks, expose root rollback cause.
**Architecture:** Existing service coalesces Actor placement; driver reuses actors per pass and selectively suppresses Item renders; workflow journals original batch failure. No second owner or transaction mechanism.
**Tech Stack:** Foundry13 Documents, JavaScript, Node fault-injection tests.
**Spec:** docs/superpowers/specs/2026-10-09-hero-doll-preset-performance.md

## Task1

- [x] RED regressions for reads/writes/render options and original rollback diagnostics.
- [x] Minimal service/driver/workflow edits; focused GREEN including all prior rollback/recovery tests.
- [x] Release1.4.368, canonical workflow/driver cache graph, current passport updates.
- [x] Full tests/syntax/JSON/diff; fresh review; commit/push lich_branch.

## Review Focus

Coalesced Actor before/after must preserve strict equality/CAS and rollback ownership. Never omit unchanged receipt verification. Reused Actor references must still resolve fresh Item collections per lookup. Render suppression must apply only forward preset Item placements, preserving hooks/authority/rollback. Original cause must survive checkpoint-loss retries and terminal receipts; active-GM loss never compensates. No claim about user's unknown root cause without evidence.
