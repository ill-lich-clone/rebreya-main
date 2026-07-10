import { MODULE_ID, SETTINGS_KEYS } from "../../constants.js";
import {
  TradeTransactionError,
  retainTradeLog
} from "../../features/trading/trade-transaction-model.js";

function clone(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }

  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

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
    return this.#normalizeState(clone(
      this.#gameProvider()?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.TRADER_STATE) ?? {}
    ));
  }

  mutate(mutator) {
    return this.#coordinator.run("traderState", async () => {
      const state = this.read();
      const result = await mutator(state);
      state.tradeLog = retainTradeLog(state.tradeLog);
      const committed = this.#normalizeState(clone(state));
      await this.#gameProvider()?.settings?.set?.(
        MODULE_ID,
        SETTINGS_KEYS.TRADER_STATE,
        committed
      );
      return result;
    });
  }

  findTransaction(transactionId) {
    return this.read().tradeLog.find((row) => row.transactionId === transactionId) ?? null;
  }

  mutateTransaction(transactionId, mutator) {
    return this.mutate(async (state) => {
      const row = state.tradeLog.find((entry) => entry.transactionId === transactionId);
      if (!row) {
        throw new TradeTransactionError(
          "transaction-not-found",
          "Trade transaction was not found",
          { transactionId }
        );
      }
      return mutator(row, state);
    });
  }
}
