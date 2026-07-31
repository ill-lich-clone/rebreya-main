import { MODULE_ID } from "../constants.js";

export const TRANSPORT_CONSUME_FUEL_COMMAND = "group.transport.consumeFuel";

const PAYLOAD_KEYS = Object.freeze(["appliedMiles", "groupActorId"]);

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isSafeId(value) {
  const clean = cleanId(value);
  return clean.length > 0
    && clean.length <= 128
    && !["__proto__", "prototype", "constructor"].includes(clean);
}

function toNumber(value) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function collectionGet(collection, id) {
  return collection?.get?.(id)
    ?? collectionValues(collection).find((entry) => entry?.id === id)
    ?? null;
}

function readTransport(actor) {
  return actor?.getFlag?.(MODULE_ID, "transport")
    ?? actor?.flags?.[MODULE_ID]?.transport
    ?? null;
}

function emptyResult({ configured = false, itemName = "" } = {}) {
  return {
    configured,
    required: 0,
    consumed: 0,
    shortage: 0,
    itemName: cleanId(itemName),
    warning: ""
  };
}

export function validateTransportFuelConsumptionPayload(payload) {
  const miles = toNumber(payload?.appliedMiles);
  return hasExactKeys(payload, PAYLOAD_KEYS)
    && isSafeId(payload.groupActorId)
    && miles != null
    && miles >= 0;
}

export function registerTransportFuelCommand(commandBus, service, { authorize } = {}) {
  if (typeof commandBus?.register !== "function") {
    throw new TypeError("Transport fuel command bus is required");
  }
  if (typeof service?.consumeForTravel !== "function") {
    throw new TypeError("Transport fuel service is required");
  }
  if (typeof authorize !== "function") {
    throw new TypeError("Transport fuel authorization is required");
  }
  commandBus.register(TRANSPORT_CONSUME_FUEL_COMMAND, {
    validate: validateTransportFuelConsumptionPayload,
    authorize,
    execute: (payload) => service.consumeForTravel(payload)
  });
}

export class TransportFuelService {
  constructor({ groupContextService } = {}) {
    if (!groupContextService?.resolveForGroup) {
      throw new TypeError("Transport fuel service requires the group context service");
    }
    this.groupContextService = groupContextService;
  }

  async consumeForTravel(payload) {
    const requestedMiles = toNumber(payload?.appliedMiles);
    if (
      hasExactKeys(payload, PAYLOAD_KEYS)
      && isSafeId(payload.groupActorId)
      && requestedMiles != null
      && requestedMiles < 0
    ) {
      return emptyResult();
    }
    if (!validateTransportFuelConsumptionPayload(payload)) {
      throw new Error("Некорректный запрос списания топлива транспорта.");
    }
    const context = this.groupContextService.resolveForGroup(payload.groupActorId);
    const activeTransportId = cleanId(context?.groupState?.transportState?.activeTransportId);
    const actorId = activeTransportId.startsWith("member:") ? activeTransportId.slice(7) : "";
    const actor = (context?.members ?? []).find((member) => member?.id === actorId);
    const transport = readTransport(actor);
    if (
      actor?.type !== "vehicle"
      || transport?.instance !== true
      || cleanId(transport.groupActorId) !== cleanId(context?.groupId)
    ) {
      return emptyResult();
    }

    const state = transport.instanceState ?? {};
    const fuelItemId = cleanId(state.fuelItemId);
    const itemName = cleanId(state.fuelItemName);
    const fuelPerMile = Math.max(0, toNumber(state.fuelPerMile) ?? 0);
    const appliedMiles = Math.max(0, requestedMiles ?? 0);
    if (!fuelItemId || fuelPerMile <= 0) return emptyResult({ itemName });
    if (appliedMiles <= 0) return emptyResult({ configured: true, itemName });

    const required = roundQuantity(appliedMiles * fuelPerMile);
    if (required <= 0) return emptyResult({ configured: true, itemName });
    const item = collectionGet(context?.groupActor?.items, fuelItemId);
    if (!item) {
      return {
        configured: true,
        required,
        consumed: 0,
        shortage: required,
        itemName,
        warning: `Топливо «${itemName || fuelItemId}» не найдено на складе группы.`
      };
    }

    const available = Math.max(0, toNumber(item.system?.quantity ?? item.toObject?.()?.system?.quantity) ?? 0);
    const consumed = roundQuantity(Math.min(available, required));
    const shortage = roundQuantity(Math.max(0, required - consumed));
    try {
      if (consumed > 0) {
        const nextQuantity = roundQuantity(available - consumed);
        if (nextQuantity <= 0) await item.delete?.();
        else await item.update?.({ "system.quantity": nextQuantity });
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to consume transport fuel.`, error);
      return {
        configured: true,
        required,
        consumed: 0,
        shortage: required,
        itemName: cleanId(item.name) || itemName,
        warning: `Не удалось списать топливо «${cleanId(item.name) || itemName}». Путешествие продолжено.`
      };
    }

    return {
      configured: true,
      required,
      consumed,
      shortage,
      itemName: cleanId(item.name) || itemName,
      warning: shortage > 0
        ? `Топливо «${cleanId(item.name) || itemName}»: не хватило ${shortage}. Путешествие продолжено.`
        : ""
    };
  }
}
