import { DurableMutationJournal } from "../../application/durable-mutation-journal.js";
import { SETTINGS_KEYS } from "../../constants.js";

function clone(value) {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeState(value) {
  return {
    version: 1,
    records: Array.isArray(value?.records)
      ? value.records.filter((record) => record && typeof record === "object" && !Array.isArray(record)).map(clone)
      : []
  };
}

export class PurchaseBasketJournalRepository {
  #journal;

  constructor({ worldSettingMutationRepository } = {}) {
    if (typeof worldSettingMutationRepository?.readObject !== "function"
      || typeof worldSettingMutationRepository?.replaceObject !== "function") {
      throw new TypeError("worldSettingMutationRepository must support readObject and replaceObject");
    }
    this.#journal = new DurableMutationJournal({
      readState: () => worldSettingMutationRepository.readObject(
        SETTINGS_KEYS.PURCHASE_BASKET_JOURNAL,
        { normalize: normalizeState }
      ),
      writeState: (state) => worldSettingMutationRepository.replaceObject(
        SETTINGS_KEYS.PURCHASE_BASKET_JOURNAL,
        state,
        { normalize: normalizeState }
      ),
      normalizeState
    });
  }

  find(id) {
    return this.#journal.find(id);
  }

  start(record) {
    return this.#journal.start(record);
  }

  checkpoint(id, expectedPhase, nextPhase, patch = {}) {
    return this.#journal.checkpoint(id, expectedPhase, nextPhase, patch);
  }

  finish(id, result) {
    return this.#journal.finish(id, result);
  }
}
