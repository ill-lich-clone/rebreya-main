# Active Effects and Harlif Reload Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Steps use checkbox syntax for tracking.

**Goal** — Migrate four services to Foundry v14 ActiveEffect changes and fix confirmation for an empty single-shot weapon.

**Architecture** — The shared effect adapter handles the v13 document format. The magazine editor stages the sole available cartridge before using the existing service transaction.

**Tech stack** — Foundry VTT 14.369, dnd5e 6, JavaScript, Node test runner and Foundry QA.

**Spec** — [Активные эффекты v14 и перезарядка Харлифа](../specs/2026-11-21-active-effects-and-harlif-reload.md)

- [x] Add failing focused tests for native size, sorcerer, rogue and paladin effect payloads and single-shot editor confirmation. Preserve assertions on values, timing, flags, and resource costs.
- [x] Author typed rows in the four services and translate them for v13 at the shared adapter. Verify size effect repair and ID retention.
- [x] Handle the one-cartridge confirmation in the existing editor. Verify explicit selection, empty stock, ambiguous stock, and unloading. Replay the player activity and confirmation on the Harlif snapshot.
- [x] Update the function passport, bump the entrypoint and modified import URLs, run focused and full checks, and review the diff.
- Commit and push on `lich_branch`.
