# Trader Transaction Engine Design

**Date:** 2026-07-10

**Status:** Approved for implementation

## Goal

Make trader purchase, sale, and rollback durable, idempotent, and compensating. A purchase must consume finite trader stock exactly once; no failure may silently leave a free item, duplicated payout, repeated rollback, or an untracked partial operation.

## Scope

This slice covers only `TraderService` operations:

- purchase from a generated trader;
- sale of an owned Actor item to a trader;
- rollback of a committed purchase or sale;
- trader stock reservation and release;
- transaction journal retention and reconciliation state;
- typed player/non-active-GM commands for purchase and sale.

Party inventory take/sell/import/drag remains a separate later spec. Sold items are not added to trader assortment in this slice because that would change current product behavior rather than repair atomicity.

## Selected Approach

Use a persistent phased journal inside the existing `TRADER_STATE.tradeLog`. New optional transaction fields are additive; `TRADER_STATE.version` remains `1`, and legacy audit rows without transaction fields normalize as terminal committed records.

Rejected alternatives:

- in-memory idempotency plus `try/catch` compensation cannot recover across GM reload/failover or an ambiguous checkpoint failure;
- a separate transaction world setting gives cleaner storage isolation but expands persisted schema and migration scope without being necessary for this slice.

## Architecture

### `TradeTransactionService`

New application service in `scripts/features/trading/trade-transaction-service.js`. It owns purchase, sale, compensation, retry/resume, and rollback state machines. It depends on explicit ports for trader-state mutations, pricing/preparation, Actor/Item document mutations, time, and ID generation.

It does not read UI preview prices and does not access Foundry globals directly.

### `TraderStateRepository`

New Foundry adapter in `scripts/infrastructure/foundry/trader-state-repository.js`. It uses the shared `WorldMutationCoordinator` and one `traderState` queue key. A mutation performs fresh setting read, normalization, mutation, retention, and one setting write inside the queue.

The repository exposes:

```js
read()
mutate(mutator)
findTransaction(transactionId)
mutateTransaction(transactionId, mutator)
```

All transaction journal and stock changes go through this repository. Existing unqueued `TraderService.#writeState` remains only for catalog/metadata legacy callers until they receive their own repository migration.

### Legacy boundary

`TraderService.purchaseItem`, `sellItem`, and `rollbackTradeAuditEntry` delegate to an injected `TradeTransactionService` when present. The live `RebreyaMainModule` always constructs and injects the new service.

The previous implementations remain explicitly named and documented as legacy bootstrap fallback. Fallback selection happens before an operation starts. Once a transaction ID is prepared, errors never switch to the legacy implementation.

## Typed Commands

The live socket bus adds:

```text
trader.purchase
trader.sell
```

Purchase payload:

```js
{
  transactionId,
  legacy: false,
  actorId,
  cityId,
  traderKey,
  itemKey,
  quantity
}
```

Sale payload:

```js
{
  transactionId,
  actorId,
  cityId,
  traderKey,
  itemUuid,
  quantity
}
```

Payloads have exact keys. IDs are trimmed non-empty strings, `transactionId` is 8-128 characters from `[A-Za-z0-9_-]`, and quantity is a positive integer. Prices, payout, stock state, item snapshots, and currency totals are never accepted from the client.

Only the active GM executes the command. It reloads the Actor, trader state, market inputs, item document, and current currency. Actor ownership is checked against the declared Foundry user as defense in depth; raw module sockets still do not provide cryptographically trusted sender identity.

The command result includes the stable `transactionId` and stored committed result. Duplicate delivery resumes the journal or returns the stored result.

## Journal Model

Transaction rows extend existing audit records with:

```js
{
  transactionId,
  kind: "purchase" | "sale",
  status: "prepared" | "applying" | "committed"
    | "compensating" | "compensated" | "reconciliation-required",
  phase,
  request: {
    actorId, cityId, traderKey, itemKey, itemUuid, quantity, requestedByUserId
  },
  stock: { itemKey, before, after, delta },
  item: {
    itemId, itemUuid, beforeQuantity, afterQuantity, delta,
    created, rawItemData
  },
  currency: { beforeCopper, afterCopper, deltaCopper },
  result,
  error: { code, message, phase } | null,
  compensation: { phase, attempts, error } | null,
  rollback: {
    transactionId, status, phase, startedAt, completedAt, error
  } | null,
  createdAt,
  updatedAt,
  committedAt,
  compensatedAt
}
```

Rows that originally lack transaction fields normalize with `legacy: true`, `status: "committed"`, and `transactionId` derived from their audit ID. Legacy audit fields such as `type`, actor/trader/item labels, totals, verification, and `rolledBack` remain populated so existing UI keeps working.

Retention keeps every nonterminal row (`prepared`, `applying`, `compensating`, `reconciliation-required`) plus the latest 20 terminal rows. Actor/item receipts are bounded to the latest 64 terminal transaction markers while all nonterminal markers are retained.

## Purchase State Machine

1. Validate the request and rebuild the current trader snapshot and item data.
2. In one trader-state mutation, verify fresh stock, decrement it, and insert a `prepared` row with all before/after deltas. Phase becomes `stock-reserved`.
3. Apply the exact Actor item delta. A created/updated Item receives the transaction marker in the same document operation. Checkpoint `item-applied`.
4. Debit Actor currency and write its transaction receipt in the same Actor update. Checkpoint `currency-applied`.
5. Store the result and mark `committed`.

On failure, compensate in reverse:

1. restore currency only if its receipt shows this transaction applied it;
2. remove only the item delta applied by this transaction;
3. release only this transaction's stock reservation;
4. mark `compensated`.

If a mutation and its compensation both fail, preserve all evidence and mark `reconciliation-required`. The caller receives a reconciliation error containing `transactionId`; it must not retry with a new legacy operation.

## Sale State Machine

1. Reload the Item and Actor and recompute the sale offer on the active GM from current market state. Ignore client preview amounts.
2. Insert a `prepared` journal row with sanitized `rawItemData`, exact item delta, and exact payout delta.
3. Decrement or delete the Item. Checkpoint `item-removed`.
4. Credit Actor currency and write its receipt in the same Actor update. Checkpoint `currency-applied`.
5. Store the result and mark `committed`.

If payout fails, restore only the removed item quantity. If a later checkpoint fails, receipts plus current document state determine whether the phase already applied. Sold items do not change trader stock.

## Idempotency And Recovery

- A transaction ID identifies one immutable request. Reusing it with different request fields fails with `transaction-conflict`.
- A duplicate committed request returns the stored result without touching documents.
- A duplicate compensated request returns the stored compensation error/result without reapplying.
- A duplicate nonterminal request resumes from its persisted phase.
- Legacy rows never enter the new resume state machine; they keep the compatibility rollback path.
- Document receipts distinguish an applied side effect from a failed call when the following journal checkpoint did not persist.
- Concurrent operations serialize through the active GM `world` queue and the repository `traderState` queue. The keys are different, so there is no self-deadlock.

## Rollback

Rollback is a nested phased operation on a committed journal row. The rollback ID is stable and repeated calls resume or return the existing result.

Purchase rollback:

- remove `item.afterQuantity - item.beforeQuantity`, not the number of purchased packs;
- refund the exact recorded currency delta;
- release the exact recorded stock delta;
- then set legacy `rolledBack` fields.

Sale rollback:

- debit the exact recorded payout;
- restore the exact item delta from `rawItemData`;
- then set legacy `rolledBack` fields.

If any rollback compensation fails, the original row becomes `reconciliation-required`; another click cannot apply the completed rollback phases twice.

## Error Contract

Errors use stable codes:

- `transaction-conflict`;
- `stock-unavailable`;
- `funds-unavailable`;
- `item-unavailable`;
- `unauthorized-actor`;
- `transaction-compensated`;
- `reconciliation-required`.

Every post-prepare error includes `transactionId`. UI refreshes after committed or compensated terminal results and displays a GM-facing reconciliation warning for nonterminal failures.

## Testing

TDD coverage must include:

- finite stock decrement and two concurrent buyers competing for the final unit;
- duplicate in-flight, committed, compensated, and conflicting transaction IDs;
- purchase failure after stock, item, currency, and journal checkpoints;
- compensation failure producing `reconciliation-required`;
- response loss followed by the same transaction ID;
- sale offer recomputation and rejection of client price data;
- sale item failure producing no payout and payout failure restoring the item;
- ammunition pack rollback removing the full Actor quantity delta;
- concurrent/double rollback;
- final journal write failure and phase recovery from document receipts;
- retention of all nonterminal rows plus 20 terminal rows;
- unchanged legacy audit rendering and existing Trader UI method signatures;
- active-GM typed command validation and authorization;
- complete project suite and JavaScript syntax checks.

## Rollout Safety

- No destructive migration and no `TRADER_STATE.version` increment.
- Existing audit rows remain readable and rollback-compatible.
- Live composition selects the new transaction service when available; legacy is bootstrap fallback only.
- There is no automatic per-operation fallback after `prepared` is persisted.
- A live Foundry smoke test must cover player purchase/sale, two active GMs, failure notification, reload, and retry with the same transaction ID before merging this slice.
