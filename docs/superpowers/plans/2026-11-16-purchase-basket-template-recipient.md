# Purchase Basket Template Recipient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show the template picker to the player who bought the Item through Rebreya Gen.

**Architecture:** Main's existing basket transaction suppresses the create-time picker for purchases it fulfills for another user. The public API delivers the committed receipt to the existing template integration on the requester client. The socket command and receipt stay unchanged.

**Tech Stack:** Foundry embedded Item operations, JavaScript, Node test runner.

### Scope and review

Follow the approved [design](../specs/2026-11-16-purchase-basket-template-recipient-design.md) in the existing `lich_branch` checkout. Preserve direct active-GM purchases, template rules and existing recovery behavior. Test the two sides of the route, compensation and unrelated Items.

### Route the template picker

- [x] Add failing tests to `tests/purchase-basket-foundry-operations.test.mjs` and `tests/purchase-basket-command-dispatch.test.mjs`. Assert that only purchases fulfilled for another user carry the creation skip option, that the purchaser receives the picker from a committed receipt, and that compensated purchases and Items outside the receipt's Actor do not open it.
- [x] In `PurchaseBasketFoundryOperations.applyItems`, compare the authenticated requester ID with the local creator ID and pass the existing skip option for a delegated creation.
- [x] In `RebreyaMainModule.purchaseItemBasket`, preserve the active-GM direct path. On a remote committed result, start the purchaser-side picker off the purchase result's critical path.
- [x] In `magic-weapon-template.js`, reuse the create hook's template dispatcher. Resolve Items from the committed receipt in order, check their Actor and current ownership, and keep the Item deduplication already implemented by the template processors.
- [x] Verify red then green. Review the whole diff against the design. Record the changed contracts in the function passport, bump the module version and affected import cache keys, run the full test, syntax and JSON checks, then commit and push `lich_branch`.
