# NPC Hero Doll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить существующую куклу с пресетами в штатный NPC sheet мастера.

**Architecture:** Общий HeroDollService разрешает character/npc с прежней авторизацией. Существующие tab/context/render владельцы расширяются на NPC, не добавляя character-only части.

**Tech Stack:** Foundry 13, dnd5e ApplicationV2, JavaScript, Node test runner.

**Spec:** docs/superpowers/specs/2026-10-09-npc-hero-doll-design.md

## Global Constraints

lich_branch; current clean checkout; world Actor UUID contract preserved; no quantity/grip/preset/recovery changes; GM or OWNER; release 1.4.365 and affected import/template/style cache keys.

## Task 1: NPC doll end to end

- [x] Add regression tests in hero-doll-instances, hero-doll-presets and dnd5e-sheet-downtime-tab; observe RED for NPC authorization and registration.
- [x] Extend ensureHeroDollTabDefinition with character-only parts option; register NPC class; reuse context and sidebar patches and bind doll for NPC render hooks.
- [x] Allow character/npc in authoritative assignment and preset checks; extend scoped sidebar CSS.
- [x] Run focused tests to GREEN. Update passport, README and release/cache guards.
- [x] Full suite, tracked JS syntax, tracked JSON parsing, diff review; fresh final code review; commit and push lich_branch.

## Review Focus

NPC inherits BaseActorSheet rather than CharacterActorSheet; preserve native PARTS/TABS and permission semantics. Do not leak downtime/implant behavior to NPC. Render binding must work through both actor-sheet and ApplicationV2 hooks. Preserve world-only command contract and reject unsupported Actor types. Release cache references must invalidate changed service and sheet integration.
