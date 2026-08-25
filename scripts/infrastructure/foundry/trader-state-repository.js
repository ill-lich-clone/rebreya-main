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

function createCoordinatorCompatibilityGateway(coordinator) {
  if (typeof coordinator?.run !== "function") return null;
  return {
    commit(queueKey, operation) {
      return coordinator.run(queueKey, () => operation(Object.freeze({
        assertActiveGm() {}
      })));
    }
  };
}

export class TraderStateRepository {
  #gameProvider;
  #mutationGateway;
  #normalizeState;

  constructor({ mutationGateway, coordinator = null, gameProvider, normalizeState }) {
    mutationGateway ??= createCoordinatorCompatibilityGateway(coordinator);
    if (typeof mutationGateway?.commit !== "function") {
      throw new TypeError("mutationGateway must provide commit");
    }
    this.#mutationGateway = mutationGateway;
    this.#gameProvider = gameProvider;
    this.#normalizeState = normalizeState;
  }

  read() {
    const settings = this.#requireSettings();
    return this.#readFrom(settings);
  }

  mutate(mutator) {
    return this.#mutationGateway.commit("setting:traderState", async ({ assertActiveGm }) => {
      const settings = this.#requireSettings({ write: true });
      const state = this.#readFrom(settings);
      const result = await mutator(state);
      state.tradeLog = retainTradeLog(state.tradeLog);
      const committed = this.#normalizeState(clone(state));
      assertActiveGm();
      await settings.set(
        MODULE_ID,
        SETTINGS_KEYS.TRADER_STATE,
        committed
      );
      assertActiveGm();
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

  #readFrom(settings) {
    return this.#normalizeState(clone(
      settings.get(MODULE_ID, SETTINGS_KEYS.TRADER_STATE) ?? {}
    ));
  }

  #requireSettings({ write = false } = {}) {
    const settings = this.#gameProvider()?.settings;
    if (typeof settings?.get !== "function" || (write && typeof settings?.set !== "function")) {
      throw new TradeTransactionError(
        "trader-state-unavailable",
        "Trader state setting is unavailable"
      );
    }
    return settings;
  }
}
