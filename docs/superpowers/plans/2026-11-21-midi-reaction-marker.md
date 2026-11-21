# Midi-QOL reaction marker implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Show and clear the native Midi-QOL marker for a spent Rebreya reaction.

**Architecture:** The combat ledger owns transitions under its existing per-actor queue. The Midi adapter projects the transitions through the installed Midi-QOL API.

**Tech stack:** Foundry 14, dnd5e, Midi-QOL 14.6.8, Node tests and Foundry QA.

**Spec:** `docs/superpowers/specs/2026-11-21-midi-reaction-marker-design.md`.

- [x] Extend the focused Interception test to exercise duplicated damage requests, the marker, and actor-specific turn resets. Pin the native receipt case and run the tests before runtime edits.
- [x] Add the adapter call, update the combat ledger transitions, update the function passport, and bump the manifest and changed runtime import keys to 1.6.2.
- [x] Run focused tests and a Foundry QA scenario over a read-only snapshot of «Ульфрик (копия)». Verify one spend, no double application, and the marker lifecycle.
- [x] Run the full runtime checks and review the diff before publishing the commit to `lich_branch`.
