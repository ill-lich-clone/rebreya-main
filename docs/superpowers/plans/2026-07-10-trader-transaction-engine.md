# Trader Transaction Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trader purchase, sale, and rollback durable and idempotent, decrement finite stock exactly once, and compensate every partial Actor/Item mutation.

**Architecture:** Add a pure phased `TradeTransactionService`, a queued Foundry `TraderStateRepository`, and narrow transaction ports on `TraderService`. Live composition injects the new engine and typed commands; the existing public UI methods keep their signatures and delegate to legacy code only when the new engine was not installed before an operation began.

**Tech Stack:** Foundry VTT v13 ESM, JavaScript private fields, existing `WorldMutationCoordinator`/`SocketCommandBus`, Node `node:test`, no new dependencies.

## Global Constraints

- Work only on branch `lich_branch`; never force-push.
- Keep `TRADER_STATE.version` exactly `1`; do not perform a destructive migration.
- New transaction fields are additive inside existing `tradeLog` rows.
- Live `RebreyaMainModule` must inject and prefer the new transaction service.
- Legacy trade execution is bootstrap fallback only; never fall back after a transaction is prepared.
- Typed commands are exactly `trader.purchase` and `trader.sell` on `module.rebreya-main`.
- Never trust client prices, payout values, stock snapshots, currency totals, or raw item data.
- Transaction IDs are 8-128 characters from `[A-Za-z0-9_-]` and identify one immutable request.
- Retain every nonterminal transaction plus the latest 20 terminal rows.
- Retain every nonterminal document receipt plus the latest 64 terminal receipts.
- Sold items do not enter trader assortment in this slice.
- Every production behavior change requires a focused RED test before implementation.
- Run `node --test tests/*.test.mjs` before every task commit.

---

### Task 1: Transaction Model And Queued Trader State Repository

**Files:**
- Create: `scripts/features/trading/trade-transaction-model.js`
- Create: `scripts/infrastructure/foundry/trader-state-repository.js`
- Modify: `scripts/data/trader-service.js`
- Create: `tests/trade-transaction-model.test.mjs`
- Create: `tests/trader-state-repository.test.mjs`

**Interfaces:**
- Consumes: `WorldMutationCoordinator.run(key, operation)` from `scripts/application/world-mutation-coordinator.js`.
- Produces: `normalizeTraderState`, `normalizeTradeTransaction`, `retainTradeLog`, `requestsMatch`, `TradeTransactionError`, and `TraderStateRepository`.

- [ ] **Step 1: Write model RED tests**

Add tests requiring exact constants and normalization:

```js
assert.equal(TRADE_TRANSACTION_STATUS.PREPARED, "prepared");
assert.equal(TRADE_TRANSACTION_STATUS.RECONCILIATION_REQUIRED, "reconciliation-required");

const legacy = normalizeTradeTransaction({ id: "legacy-1", type: "purchase" });
assert.equal(legacy.status, "committed");
assert.equal(legacy.transactionId, "legacy-1");

assert.equal(requestsMatch(
  { actorId: "a", itemKey: "i", quantity: 1 },
  { quantity: 1, itemKey: "i", actorId: "a" }
), true);
```

Add retention fixtures with 23 terminal and 2 nonterminal rows. Expect both nonterminal rows and only the newest 20 terminal rows.

- [ ] **Step 2: Verify model RED**

Run:

```powershell
node --test tests/trade-transaction-model.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `trade-transaction-model.js`.

- [ ] **Step 3: Implement the pure model**

Export these exact values and functions:

```js
export const TRADE_TRANSACTION_STATUS = Object.freeze({
  PREPARED: "prepared",
  APPLYING: "applying",
  COMMITTED: "committed",
  COMPENSATING: "compensating",
  COMPENSATED: "compensated",
  RECONCILIATION_REQUIRED: "reconciliation-required"
});

export const TERMINAL_TRADE_STATUSES = new Set(["committed", "compensated"]);

export class TradeTransactionError extends Error {
  constructor(code, message, { transactionId = "", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TradeTransactionError";
    this.code = code;
    this.transactionId = transactionId;
  }
}

const REQUEST_KEYS = Object.freeze([
  "actorId", "cityId", "traderKey", "itemKey", "itemUuid", "quantity", "requestedByUserId"
]);

export function isValidTradeTransactionId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{8,128}$/u.test(value);
}

export function requestsMatch(left = {}, right = {}) {
  return REQUEST_KEYS.every((key) => (
    key === "quantity"
      ? Math.max(0, Math.floor(Number(left[key]) || 0)) === Math.max(0, Math.floor(Number(right[key]) || 0))
      : String(left[key] ?? "").trim() === String(right[key] ?? "").trim()
  ));
}

export function normalizeTradeTransaction(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const transactionId = String(source.transactionId ?? source.id ?? "").trim();
  const requestedStatus = String(source.status ?? "").trim();
  const status = Object.values(TRADE_TRANSACTION_STATUS).includes(requestedStatus)
    ? requestedStatus
    : TRADE_TRANSACTION_STATUS.COMMITTED;
  return {
    ...structuredClone(source),
    transactionId,
    kind: source.kind === "sale" || source.type === "sale" ? "sale" : "purchase",
    status,
    phase: String(source.phase ?? (status === "committed" ? "committed" : "prepared")),
    request: Object.fromEntries(REQUEST_KEYS.map((key) => [
      key,
      key === "quantity"
        ? Math.max(1, Math.floor(Number(source.request?.[key] ?? source[key]) || 1))
        : String(source.request?.[key] ?? source[key] ?? "").trim()
    ])),
    result: source.result && typeof source.result === "object" ? structuredClone(source.result) : null,
    error: source.error && typeof source.error === "object" ? structuredClone(source.error) : null,
    compensation: source.compensation && typeof source.compensation === "object"
      ? structuredClone(source.compensation)
      : null,
    rollback: source.rollback && typeof source.rollback === "object" ? structuredClone(source.rollback) : null
  };
}

export function retainTradeLog(rows = [], { terminalLimit = 20 } = {}) {
  const normalized = rows.map((row) => normalizeTradeTransaction(row));
  const nonterminal = normalized.filter((row) => !TERMINAL_TRADE_STATUSES.has(row.status));
  const terminal = normalized
    .filter((row) => TERMINAL_TRADE_STATUSES.has(row.status))
    .sort((left, right) => Number(right.updatedAt ?? right.createdAt ?? 0) - Number(left.updatedAt ?? left.createdAt ?? 0))
    .slice(0, terminalLimit);
  return [...nonterminal, ...terminal];
}
```

Legacy rows without `status` normalize to `committed`; preserve legacy labels/totals/rollback fields via safe spread plus explicit normalized transaction fields.

- [ ] **Step 4: Write repository RED tests**

Use a blocked first `settings.set` and two concurrent `mutate` calls. Assert:

```js
assert.equal(maxInFlightWrites, 1);
assert.deepEqual(savedMutationIds, ["one", "two"]);
```

Add tests for fresh read inside queue, rejection recovery without a write, `findTransaction`, `mutateTransaction`, normalization, and retention after every mutation.

- [ ] **Step 5: Verify repository RED**

Run:

```powershell
node --test tests/trader-state-repository.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `trader-state-repository.js`.

- [ ] **Step 6: Implement `TraderStateRepository`**

Use this exact public contract:

```js
export class TraderStateRepository {
  #coordinator;
  #gameProvider;
  #normalizeState;

  constructor({ coordinator, gameProvider, normalizeState }) {
    this.#coordinator = coordinator;
    this.#gameProvider = gameProvider;
    this.#normalizeState = normalizeState;
  }

  read() {
    return this.#normalizeState(structuredClone(
      this.#gameProvider()?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.TRADER_STATE) ?? {}
    ));
  }

  mutate(mutator) {
    return this.#coordinator.run("traderState", async () => {
      const state = this.read();
      const result = await mutator(state);
      state.tradeLog = retainTradeLog(state.tradeLog);
      const committed = this.#normalizeState(structuredClone(state));
      await this.#gameProvider()?.settings?.set?.(MODULE_ID, SETTINGS_KEYS.TRADER_STATE, committed);
      return result;
    });
  }

  findTransaction(transactionId) {
    return this.read().tradeLog.find((row) => row.transactionId === transactionId) ?? null;
  }

  mutateTransaction(transactionId, mutator) {
    return this.mutate(async (state) => {
      const row = state.tradeLog.find((entry) => entry.transactionId === transactionId);
      if (!row) throw new TradeTransactionError("transaction-not-found", "Trade transaction was not found", { transactionId });
      return mutator(row, state);
    });
  }
}
```

`mutate` must queue the complete fresh-read → clone/normalize → awaited mutator → retention → one `game.settings.set(MODULE_ID, SETTINGS_KEYS.TRADER_STATE, state)` transaction under key `traderState`.

Export `createEmptyTraderState` and `normalizeTraderState` from `trader-service.js`; `normalizeTraderState` must normalize every `tradeLog` row with `normalizeTradeTransaction` and run `retainTradeLog`.

- [ ] **Step 7: Run focused and full GREEN**

```powershell
node --test tests/trade-transaction-model.test.mjs tests/trader-state-repository.test.mjs tests/trader-service.test.mjs tests/security.test.mjs
node --test tests/*.test.mjs
```

Expected: all pass with no warnings.

- [ ] **Step 8: Commit**

```powershell
git add scripts/features/trading/trade-transaction-model.js scripts/infrastructure/foundry/trader-state-repository.js scripts/data/trader-service.js tests/trade-transaction-model.test.mjs tests/trader-state-repository.test.mjs
git commit -m "feat: add durable trader transaction state"
```

### Task 2: Idempotent Purchase And Stock Compensation Engine

**Files:**
- Create: `scripts/features/trading/trade-transaction-service.js`
- Create: `tests/trade-purchase-transaction.test.mjs`

**Interfaces:**
- Consumes: Task 1 model/repository.
- Produces: `TradeTransactionService.purchase(request, context)` and the purchase operations port.

- [ ] **Step 1: Write purchase state-machine RED tests**

Create an in-memory operations port with counters and injectable failures. Cover:

```js
const request = {
  transactionId: "trade_purchase_001",
  actorId: "actor-a",
  cityId: "city-a",
  traderKey: "shop-a",
  itemKey: "gear:sword",
  quantity: 1,
  requestedByUserId: "player-a"
};
```

Required assertions:

- stock `1` becomes `0` after commit;
- two concurrent IDs competing for stock `1` produce one commit and one `stock-unavailable` without negative stock;
- repeating the committed ID returns the stored result and does not call document ports again;
- same ID with changed quantity fails `transaction-conflict`;
- item failure restores stock and finishes `compensated`;
- currency failure compensates item then stock;
- compensation failure finishes `reconciliation-required` and includes the ID;
- a persisted `item-applied` phase resumes without applying the item twice.

- [ ] **Step 2: Verify purchase RED**

```powershell
node --test tests/trade-purchase-transaction.test.mjs
```

Expected: missing `trade-transaction-service.js`.

- [ ] **Step 3: Implement purchase orchestration**

Use this exact constructor and method:

```js
export class TradeTransactionService {
  constructor({ repository, operations, now = () => Date.now() }) {}
  async purchase(request, context = {}) {}
}
```

The `operations` port must implement:

```js
preparePurchase(request, context)
applyPurchaseItem(transaction)
applyPurchaseCurrency(transaction)
readPurchaseReceipts(transaction)
compensatePurchaseCurrency(transaction)
compensatePurchaseItem(transaction)
```

`preparePurchase` returns trusted descriptor fields: Actor/trader/item labels, `traderId`, current stock entry, exact Actor quantity delta (including pack expansion), exact price/currency delta, sanitized item data, and legacy audit fields.

Inside one repository mutation, reject conflicting duplicate requests, reserve stock, and create `prepared`/`stock-reserved`. Each side effect is followed by a journal checkpoint. On caught errors persist `compensating`, run reverse compensation, and finish `compensated` or `reconciliation-required`.

- [ ] **Step 4: Verify purchase GREEN and failure matrix**

```powershell
node --test tests/trade-purchase-transaction.test.mjs
```

Expected: all purchase, concurrency, duplicate, resume, and compensation tests pass.

- [ ] **Step 5: Run full suite and commit**

```powershell
node --test tests/*.test.mjs
git add scripts/features/trading/trade-transaction-service.js tests/trade-purchase-transaction.test.mjs
git commit -m "feat: add idempotent trader purchases"
```

### Task 3: Foundry Trade Ports, Server-Recomputed Sale, And Legacy Delegation

**Files:**
- Modify: `scripts/features/trading/trade-transaction-service.js`
- Modify: `scripts/data/trader-service.js`
- Create: `tests/trade-sale-transaction.test.mjs`
- Modify: `tests/trader-service.test.mjs`
- Modify: `tests/security.test.mjs`

**Interfaces:**
- Consumes: `TradeTransactionService` and `TraderStateRepository`.
- Produces: Foundry operations port on `TraderService`, sale state machine, `setTransactionService` delegation.

- [ ] **Step 1: Write sale and port RED tests**

Add tests proving:

- the current Item and market are reloaded and client preview amounts are ignored;
- item deletion/update occurs before payout;
- item mutation failure yields no payout;
- payout failure restores the exact item quantity/data and finishes compensated;
- duplicate committed sale does not delete/pay twice;
- full-item and partial-stack sales both return committed server results;
- Actor currency update includes a receipt for the same transaction ID;
- an Item quantity update includes its transaction marker in the same update;
- live delegation uses the new service when installed and never calls legacy after `prepared`.

- [ ] **Step 2: Verify sale RED**

```powershell
node --test tests/trade-sale-transaction.test.mjs tests/trader-service.test.mjs tests/security.test.mjs
```

Expected: sale method/ports/delegation assertions fail against current code.

- [ ] **Step 3: Extend `TradeTransactionService`**

Add:

```js
async sale(request, context = {}) {}
```

Required operations port additions:

```js
prepareSale(request, context)
applySaleItem(transaction)
applySaleCurrency(transaction)
readSaleReceipts(transaction)
compensateSaleCurrency(transaction)
compensateSaleItem(transaction)
```

Persist `prepared`; apply/checkpoint `item-removed`; apply/checkpoint `currency-applied`; then `committed`. Compensation reverses payout first if applied, then restores the item.

- [ ] **Step 4: Refactor `TraderService` into the Foundry port**

Add:

```js
setTransactionService(service) { this.transactionService = service; }
```

Public methods keep their existing positional arguments and delegate:

```js
purchaseItem(cityId, traderKey, itemKey, quantity, options = {})
sellItem(cityId, traderKey, preview, quantity, options = {})
```

When a transaction service is installed, normalize a semantic request and call it. Otherwise call renamed `purchaseItemLegacy` / `sellItemLegacy`, both marked `@deprecated`. Do not catch a new-engine error and call legacy.

Expose `createFoundryTradeOperations()` returning all Task 2/3 port methods. Preparation reuses current canonical item/pricing logic. Sale preparation calls `createSalePreview` from current `itemUuid` on the active GM and discards client price values.

Actor receipt path is `flags.rebreya-main.tradeReceipts.<transactionId>`. Item marker path is `flags.rebreya-main.tradeTransactions.<transactionId>`. Document updates must change the value and marker in the same Foundry update call. Prune only terminal receipts beyond 64.

- [ ] **Step 5: Run focused/full GREEN and commit**

```powershell
node --test tests/trade-sale-transaction.test.mjs tests/trade-purchase-transaction.test.mjs tests/trader-service.test.mjs tests/security.test.mjs
node --test tests/*.test.mjs
git add scripts/features/trading/trade-transaction-service.js scripts/data/trader-service.js tests/trade-sale-transaction.test.mjs tests/trader-service.test.mjs tests/security.test.mjs
git commit -m "feat: add compensating trader sales"
```

### Task 4: Idempotent Rollback And Audit Compatibility

**Files:**
- Modify: `scripts/features/trading/trade-transaction-service.js`
- Modify: `scripts/data/trader-service.js`
- Create: `tests/trade-rollback-transaction.test.mjs`
- Modify: `tests/security.test.mjs`

**Interfaces:**
- Consumes: committed purchase/sale transaction rows and Foundry operations port.
- Produces: `TradeTransactionService.rollback(transactionId, { rollbackTransactionId, requestedByUserId })`.

- [ ] **Step 1: Write rollback RED tests**

Cover:

- purchase of one 20-arrow pack records Actor item delta `20`; rollback removes `20`, refunds one pack price, and releases stock `1`;
- partial purchase stack rollback removes only that transaction's delta;
- sale rollback debits exact payout and restores exact sold quantity/raw data;
- two concurrent rollback calls apply phases once;
- repeated committed rollback returns stored result;
- failure after one rollback phase resumes without repeating it;
- failed rollback compensation marks `reconciliation-required`;
- legacy committed audit rows still use compatibility rollback and render correctly.

- [ ] **Step 2: Verify rollback RED**

```powershell
node --test tests/trade-rollback-transaction.test.mjs tests/security.test.mjs
```

Expected: current rollback removes pack count instead of Actor delta and lacks phased idempotency.

- [ ] **Step 3: Implement phased rollback**

Add:

```js
async rollback(transactionId, {
  rollbackTransactionId,
  requestedByUserId = ""
} = {}) {}
```

Store the nested rollback state on the original row. Checkpoint every phase and use original `item.afterQuantity - item.beforeQuantity`, currency delta, and stock delta. Only after all phases succeed set legacy `rolledBack`, `rolledBackAt`, and `rolledBackByUserId`.

`TraderService.rollbackTradeAuditEntry(entryId, options = {})` delegates transaction rows to the new engine. Legacy rows retain the old compatibility implementation, explicitly marked deprecated.

- [ ] **Step 4: Update audit normalization/view**

Ensure `normalizeTradeAuditRecord` preserves normalized transaction/rollback fields. `getTradeAuditLog` continues returning the latest 20 view rows while repository storage retains all nonterminal rows. Add `statusLabel` values for compensating, compensated, and reconciliation-required without changing legacy committed labels.

- [ ] **Step 5: Run focused/full GREEN and commit**

```powershell
node --test tests/trade-rollback-transaction.test.mjs tests/security.test.mjs tests/trade-transaction-model.test.mjs
node --test tests/*.test.mjs
git add scripts/features/trading/trade-transaction-service.js scripts/data/trader-service.js tests/trade-rollback-transaction.test.mjs tests/security.test.mjs
git commit -m "fix: make trader rollback idempotent"
```

### Task 5: Live Composition, Typed Commands, And UI-Compatible Requests

**Files:**
- Modify: `scripts/main.js`
- Modify: `scripts/ui/trader-app.js`
- Modify: `scripts/ui/trader-app-v2.js`
- Create: `tests/trader-command-dispatch.test.mjs`
- Modify: `tests/trader-service.test.mjs`

**Interfaces:**
- Consumes: repository/service/Foundry ports from Tasks 1-4.
- Produces: live `trader.purchase`/`trader.sell` commands and transaction ID propagation.

- [ ] **Step 1: Write live wiring RED tests**

Black-box `RebreyaMainModule` tests must prove:

- it constructs one `TraderStateRepository` with the shared coordinator;
- it installs one `TradeTransactionService` into `TraderService`;
- only active GM executes exact-key purchase/sale payloads;
- unknown/extra fields, invalid IDs, non-positive quantities, missing users, and unauthorized Actors are rejected before document writes;
- purchase/sale handlers ignore client price/payout fields because such fields make the payload invalid;
- duplicate command delivery with the same transaction ID returns the committed stored result;
- player/non-active-GM public API preserves existing UI result shapes.

- [ ] **Step 2: Verify wiring RED**

```powershell
node --test tests/trader-command-dispatch.test.mjs tests/trader-service.test.mjs
```

Expected: commands are unregistered and live `TraderService` has no transaction service.

- [ ] **Step 3: Wire live composition**

In `RebreyaMainModule` construct `TraderStateRepository` with the existing shared `worldMutationCoordinator`, then construct `TradeTransactionService` with `traderService.createFoundryTradeOperations()`, and call `traderService.setTransactionService(service)` before socket commands are registered.

Register exact commands:

```js
trader.purchase
trader.sell
```

Validators enforce the Global Constraints. Authorize the declared sender against Actor ownership as defense in depth. Handlers pass only semantic IDs/quantity and the declared sender ID.

Update `purchaseTraderItem` and `sellTraderItem` to create or accept a stable transaction ID. Active GM calls the service locally; other clients request the typed command. Do not pass price or raw preview data through the socket.

Both trader UIs create one transaction ID immediately before dispatch and keep it for the lifetime of the pending operation. A timeout/reconciliation error displays the ID; no automatic second operation with a new ID is started.

- [ ] **Step 4: Verify no legacy fallback after preparation**

Inject a failure after stock reservation and assert the live API returns `transaction-compensated` or `reconciliation-required`, with zero calls to legacy purchase/sale.

- [ ] **Step 5: Run focused/full GREEN and commit**

```powershell
node --test tests/trader-command-dispatch.test.mjs tests/trader-service.test.mjs tests/security.test.mjs
node --test tests/*.test.mjs
git add scripts/main.js scripts/ui/trader-app.js scripts/ui/trader-app-v2.js tests/trader-command-dispatch.test.mjs tests/trader-service.test.mjs
git commit -m "feat: enable durable trader transactions"
```

### Task 6: Whole-Branch Verification And Push

**Files:**
- Modify only for concrete review findings.

- [ ] Generate review packages and obtain clean spec-compliance/code-quality verdicts for Tasks 1-5.
- [ ] Run a final whole-branch review from the pre-slice `origin/lich_branch` commit.
- [ ] Fetch `origin`; stop on foreign branch updates or a conflict with current `origin/main`.
- [ ] Run:

```powershell
node --test tests/*.test.mjs
```

Expected: zero failures.

- [ ] Run `node --check` for all current `scripts/**/*.js`, excluding archived versioned entrypoints and including `scripts/main-1.4.93.js`.
- [ ] Run `git diff --check`, inspect the complete diff, and confirm a clean worktree.
- [ ] Perform the required live Foundry smoke test if a running world with two GMs and one player is available. If it is unavailable, report that limitation explicitly rather than claiming runtime verification.
- [ ] Push `lich_branch` to `origin` without force.
