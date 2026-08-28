import { MODULE_ID } from "../../constants.js";
import { PURCHASE_DENOMINATION_COPPER } from "../../application/purchase-basket-command.js";

function clone(value) {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function operationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function actorItems(actor) {
  if (Array.isArray(actor?.items)) return actor.items;
  if (Array.isArray(actor?.items?.contents)) return actor.items.contents;
  return actor?.items ? [...actor.items] : [];
}

function resolveActor(game, actorId) {
  return game?.actors?.get?.(actorId)
    ?? game?.actors?.contents?.find?.((actor) => String(actor?.id) === actorId)
    ?? null;
}

function documentKind(document) {
  return document?.documentName ?? document?.constructor?.documentName ?? "";
}

function currencyToCopper(actor) {
  const currency = actor?.system?.currency ?? {};
  return Object.entries(PURCHASE_DENOMINATION_COPPER).reduce((total, [denomination, multiplier]) => {
    const amount = Number(currency[denomination] ?? 0);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw operationError("currency-invalid", `Actor ${denomination} currency is invalid`);
    }
    return total + (amount * multiplier);
  }, 0);
}

function normalizedCurrency(totalCopper) {
  let remaining = Math.max(0, Math.floor(totalCopper));
  const pp = Math.floor(remaining / PURCHASE_DENOMINATION_COPPER.pp);
  remaining -= pp * PURCHASE_DENOMINATION_COPPER.pp;
  const gp = Math.floor(remaining / PURCHASE_DENOMINATION_COPPER.gp);
  remaining -= gp * PURCHASE_DENOMINATION_COPPER.gp;
  const sp = Math.floor(remaining / PURCHASE_DENOMINATION_COPPER.sp);
  remaining -= sp * PURCHASE_DENOMINATION_COPPER.sp;
  return { pp, gp, ep: 0, sp, cp: remaining };
}

function currencyPatch(totalCopper) {
  return Object.fromEntries(
    Object.entries(normalizedCurrency(totalCopper)).map(([denomination, amount]) => [
      `system.currency.${denomination}`,
      amount
    ])
  );
}

function sanitizeItemData(source, request, row, moduleId) {
  const itemData = clone(typeof source?.toObject === "function" ? source.toObject() : source?._source);
  if (!itemData || typeof itemData !== "object" || Array.isArray(itemData)) {
    throw operationError("source-invalid", `Item source '${row.sourceUuid}' has no serializable data`);
  }
  for (const key of ["_id", "id", "folder", "ownership", "permission", "sort", "parent", "pack", "_stats"]) {
    delete itemData[key];
  }
  itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};
  itemData.system.quantity = row.quantity;
  itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
  itemData.flags[moduleId] = itemData.flags[moduleId] && typeof itemData.flags[moduleId] === "object"
    ? itemData.flags[moduleId]
    : {};
  itemData.flags[moduleId].purchaseBasketTransaction = {
    version: 1,
    transactionId: request.transactionId,
    rowId: row.rowId,
    sourceUuid: row.sourceUuid
  };
  return itemData;
}

function transactionFlag(item, moduleId) {
  return item?.flags?.[moduleId]?.purchaseBasketTransaction
    ?? item?._source?.flags?.[moduleId]?.purchaseBasketTransaction
    ?? item?.getFlag?.(moduleId, "purchaseBasketTransaction")
    ?? null;
}

export class PurchaseBasketFoundryOperations {
  #fromUuid;
  #gameProvider;
  #moduleId;

  constructor({ gameProvider, fromUuid, moduleId = MODULE_ID } = {}) {
    if (typeof gameProvider !== "function") throw new TypeError("gameProvider must be a function");
    if (typeof fromUuid !== "function") throw new TypeError("fromUuid must be a function");
    this.#gameProvider = gameProvider;
    this.#fromUuid = fromUuid;
    this.#moduleId = moduleId;
  }

  async prepare(request) {
    const actor = this.#actor(request.actorId);
    const items = [];
    let totalPriceCopper = 0;

    for (const row of request.rows) {
      const source = await this.#fromUuid(row.sourceUuid);
      if (!source || documentKind(source) !== "Item") {
        throw operationError("source-unavailable", `Purchase source is not an available Item: ${row.sourceUuid}`);
      }
      const unitCopper = row.unitPrice.value * PURCHASE_DENOMINATION_COPPER[row.unitPrice.denomination];
      totalPriceCopper += unitCopper * row.quantity;
      if (!Number.isSafeInteger(totalPriceCopper)) {
        throw operationError("price-overflow", "Purchase total exceeds the supported currency range");
      }
      items.push({
        rowId: row.rowId,
        sourceUuid: row.sourceUuid,
        itemData: sanitizeItemData(source, request, row, this.#moduleId)
      });
    }

    const beforeCopper = currencyToCopper(actor);
    if (beforeCopper < totalPriceCopper) {
      throw operationError("insufficient-funds", "Actor does not have enough currency for this purchase");
    }
    return {
      actorId: request.actorId,
      items,
      totalPriceCopper,
      currency: {
        beforeCopper,
        afterCopper: beforeCopper - totalPriceCopper
      }
    };
  }

  async readReceipts(record) {
    const actor = this.#actor(record.request.actorId);
    const expectedRows = new Set(record.descriptor.items.map((item) => item.rowId));
    const matches = actorItems(actor).filter((item) => {
      const flag = transactionFlag(item, this.#moduleId);
      return flag?.version === 1
        && flag.transactionId === record.id
        && expectedRows.has(flag.rowId);
    });
    matches.sort((left, right) => {
      const leftRow = transactionFlag(left, this.#moduleId)?.rowId ?? "";
      const rightRow = transactionFlag(right, this.#moduleId)?.rowId ?? "";
      return leftRow.localeCompare(rightRow);
    });

    const currentCopper = currencyToCopper(actor);
    const { beforeCopper, afterCopper } = record.descriptor.currency;
    const currency = currentCopper === afterCopper
      ? "after"
      : (currentCopper === beforeCopper ? "before" : "other");
    return {
      itemUuids: matches.map((item) => String(item.uuid ?? `${actor.uuid}.Item.${item.id}`)),
      currency
    };
  }

  async applyItems(record) {
    const actor = this.#actor(record.request.actorId);
    if (typeof actor.createEmbeddedDocuments !== "function") {
      throw operationError("actor-item-create-unavailable", "Actor cannot create embedded Items");
    }
    const created = await actor.createEmbeddedDocuments(
      "Item",
      record.descriptor.items.map((item) => clone(item.itemData))
    );
    return created.map((item) => String(item.uuid ?? `${actor.uuid}.Item.${item.id}`));
  }

  async applyCurrency(record) {
    const actor = this.#actor(record.request.actorId);
    const currentCopper = currencyToCopper(actor);
    const { beforeCopper, afterCopper } = record.descriptor.currency;
    if (currentCopper === afterCopper) return;
    if (currentCopper !== beforeCopper) {
      throw operationError("currency-changed", "Actor currency changed after purchase preparation");
    }
    if (typeof actor.update !== "function") {
      throw operationError("actor-update-unavailable", "Actor currency cannot be updated");
    }
    await actor.update(currencyPatch(afterCopper));
    if (currencyToCopper(actor) !== afterCopper) {
      throw operationError("currency-update-unconfirmed", "Actor currency update was not confirmed");
    }
  }

  async compensateItems(record) {
    const actor = this.#actor(record.request.actorId);
    const expectedRows = new Set(record.descriptor.items.map((item) => item.rowId));
    const ids = actorItems(actor).filter((item) => {
      const flag = transactionFlag(item, this.#moduleId);
      return item?.parent === actor
        && flag?.version === 1
        && flag.transactionId === record.id
        && expectedRows.has(flag.rowId);
    }).map((item) => String(item.id ?? "")).filter(Boolean);
    if (!ids.length) return;
    if (typeof actor.deleteEmbeddedDocuments !== "function") {
      throw operationError("actor-item-delete-unavailable", "Actor cannot delete compensated Items");
    }
    await actor.deleteEmbeddedDocuments("Item", ids);
  }

  #actor(actorId) {
    const actor = resolveActor(this.#gameProvider(), actorId);
    if (!actor) throw operationError("actor-not-found", `Purchase Actor was not found: ${actorId}`);
    return actor;
  }
}
